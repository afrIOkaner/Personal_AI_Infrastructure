#!/usr/bin/env bun
/**
 * ============================================================================
 * PAI Shell — Model Router
 * ============================================================================
 *
 * Central routing engine that resolves inference tiers (fast/standard/smart)
 * to specific provider + model combinations. Handles:
 *
 * - Tier resolution: fast → Qwen3-8B on Ollama, standard → Qwen3-Coder-30B, etc.
 * - Fallback chains: if primary provider unavailable, try next in chain
 * - Provider lifecycle: initialization, health checking, instance management
 * - Usage tracking: token counts, latency, cost per request
 * - Prompt-based tool calling: for models without native function calling
 *
 * Usage:
 *   import { ModelRouter } from './ModelRouter';
 *   const router = new ModelRouter();
 *   await router.initialize(settings);
 *   const response = await router.complete('standard', messages, tools);
 *
 * CLI:
 *   bun ModelRouter.ts status    — show provider health
 *   bun ModelRouter.ts test      — test routing for all tiers
 *
 * ============================================================================
 */

import type {
  InferenceTier,
  ProviderName,
  ProviderConfig,
  ProviderHealth,
  ChatMessage,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ToolDefinition,
  ModelRoutingConfig,
  TierConfig,
  TierRoute,
  PAIOSSSettings,
  UsageRecord,
  ToolCallingStrategy,
} from './types';

import type { Provider } from './providers/Provider';
import { createProvider } from './providers';

// ─── Prompt-based tool calling ──────────────────────────────────────────────

/**
 * When a model doesn't support native tool calling, we inject the tool
 * schemas into the system prompt and ask the model to output structured
 * JSON tool calls. This function builds that prompt injection.
 */
function buildToolCallingSystemPrompt(tools: ToolDefinition[]): string {
  const toolDescriptions = tools.map(t => {
    const params = JSON.stringify(t.function.parameters, null, 2);
    return `### ${t.function.name}\n${t.function.description}\nParameters:\n\`\`\`json\n${params}\n\`\`\``;
  }).join('\n\n');

  return `
You have access to the following tools. When you need to use a tool, respond with ONLY a JSON object in this exact format (no other text before or after):

\`\`\`json
{"tool_calls": [{"name": "tool_name", "arguments": {"param1": "value1"}}]}
\`\`\`

If you want to call multiple tools, include them all in the tool_calls array.
If you don't need to use any tools, respond normally with text.

Available tools:

${toolDescriptions}
`;
}

/**
 * Parse tool calls from a text response (for prompt-based tool calling).
 * Looks for JSON blocks containing tool_calls.
 */
function parseToolCallsFromText(text: string): { toolCalls: Array<{ name: string; arguments: string }> } | null {
  // Try to find JSON with tool_calls
  const jsonMatch = text.match(/\{[\s\S]*"tool_calls"[\s\S]*\}/);
  if (!jsonMatch) return null;

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    if (Array.isArray(parsed.tool_calls)) {
      return {
        toolCalls: parsed.tool_calls.map((tc: { name: string; arguments: unknown }) => ({
          name: tc.name,
          arguments: typeof tc.arguments === 'string'
            ? tc.arguments
            : JSON.stringify(tc.arguments),
        })),
      };
    }
  } catch {
    // Not valid JSON
  }
  return null;
}

// ─── Model Router ───────────────────────────────────────────────────────────

export class ModelRouter {
  private providers: Map<ProviderName, Provider> = new Map();
  private providerConfigs: Map<ProviderName, ProviderConfig> = new Map();
  private routingConfig: ModelRoutingConfig | null = null;
  private healthCache: Map<ProviderName, ProviderHealth> = new Map();
  private usageLog: UsageRecord[] = [];

  /**
   * Initialize the router with PAI-OSS settings.
   * Instantiates and initializes all enabled providers.
   */
  async initialize(settings: PAIOSSSettings): Promise<void> {
    this.routingConfig = settings.modelRouting;

    // Initialize each enabled provider
    for (const [name, config] of Object.entries(settings.providers)) {
      if (!config.enabled) continue;

      const providerName = name as ProviderName;
      this.providerConfigs.set(providerName, config);

      try {
        const provider = createProvider(providerName);
        await provider.initialize(config);
        this.providers.set(providerName, provider);
      } catch (err) {
        console.error(`Failed to initialize provider ${name}:`, err);
      }
    }
  }

  /**
   * Complete a chat request using the tier routing configuration.
   * Tries the primary provider first, then fallbacks in order.
   */
  async complete(
    tier: InferenceTier,
    messages: ChatMessage[],
    tools?: ToolDefinition[],
    options?: Partial<ChatCompletionRequest>,
  ): Promise<ChatCompletionResponse> {
    if (!this.routingConfig) {
      throw new Error('ModelRouter not initialized. Call initialize() first.');
    }

    const tierConfig = this.routingConfig[tier];
    if (!tierConfig) {
      throw new Error(`No routing configuration for tier: ${tier}`);
    }

    // Build the chain: primary + fallbacks
    const chain: TierRoute[] = [tierConfig.primary, ...(tierConfig.fallback || [])];

    let lastError: Error | null = null;

    for (const route of chain) {
      const provider = this.providers.get(route.provider);
      if (!provider) {
        lastError = new Error(`Provider ${route.provider} not initialized`);
        continue;
      }

      // Check cached health (skip if recently failed)
      const health = this.healthCache.get(route.provider);
      if (health && !health.available && (Date.now() - health.lastChecked) < 30000) {
        lastError = new Error(`Provider ${route.provider} recently failed: ${health.error}`);
        continue;
      }

      try {
        const result = await this.executeRequest(
          provider,
          route,
          tier,
          messages,
          tools,
          options,
        );
        return result;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        console.error(`Provider ${route.provider}/${route.model} failed:`, lastError.message);

        // Update health cache
        this.healthCache.set(route.provider, {
          name: route.provider,
          available: false,
          error: lastError.message,
          lastChecked: Date.now(),
        });
      }
    }

    throw new Error(`All providers failed for tier ${tier}. Last error: ${lastError?.message}`);
  }

  /**
   * Execute a request against a specific provider, handling tool calling
   * strategy differences.
   */
  private async executeRequest(
    provider: Provider,
    route: TierRoute,
    tier: InferenceTier,
    messages: ChatMessage[],
    tools?: ToolDefinition[],
    options?: Partial<ChatCompletionRequest>,
  ): Promise<ChatCompletionResponse> {
    const config = this.providerConfigs.get(route.provider);
    const strategy = config?.toolCallingStrategy || 'native';
    const start = Date.now();

    let request: ChatCompletionRequest = {
      model: route.model,
      messages: [...messages],
      ...options,
    };

    // Handle tool calling strategy
    if (tools?.length) {
      if (strategy === 'native' && provider.supportsToolCalling) {
        // Model supports native tool calling — pass tools directly
        request.tools = tools;
        request.tool_choice = 'auto';
      } else if (strategy === 'prompt-based' || (strategy === 'hybrid' && !provider.supportsToolCalling)) {
        // Inject tool schemas into system prompt
        const toolPrompt = buildToolCallingSystemPrompt(tools);
        const systemMsg = request.messages.find(m => m.role === 'system');
        if (systemMsg) {
          systemMsg.content = (systemMsg.content || '') + '\n\n' + toolPrompt;
        } else {
          request.messages.unshift({
            role: 'system',
            content: toolPrompt,
          });
        }
      } else if (strategy === 'hybrid') {
        // Try native first
        request.tools = tools;
        request.tool_choice = 'auto';
      }
    }

    const response = await provider.complete(request);
    const latencyMs = Date.now() - start;

    // If using prompt-based tool calling, parse tool calls from text
    if (tools?.length && (strategy === 'prompt-based' || (strategy === 'hybrid' && !provider.supportsToolCalling))) {
      const choice = response.choices[0];
      if (choice?.message?.content) {
        const parsed = parseToolCallsFromText(choice.message.content);
        if (parsed) {
          choice.message.tool_calls = parsed.toolCalls.map((tc, i) => ({
            id: `call_${Date.now()}_${i}`,
            type: 'function' as const,
            function: {
              name: tc.name,
              arguments: tc.arguments,
            },
          }));
          choice.message.content = null;
          choice.finish_reason = 'tool_calls';
        }
      }
    }

    // Tag response with metadata
    response._provider = route.provider;
    response._tier = tier;
    response._latencyMs = latencyMs;

    // Track usage
    this.trackUsage(route, tier, response, latencyMs);

    return response;
  }

  /**
   * Track usage for billing/analytics
   */
  private trackUsage(
    route: TierRoute,
    tier: InferenceTier,
    response: ChatCompletionResponse,
    latencyMs: number,
  ): void {
    const record: UsageRecord = {
      timestamp: Date.now(),
      provider: route.provider,
      model: route.model,
      tier,
      promptTokens: response.usage?.prompt_tokens || 0,
      completionTokens: response.usage?.completion_tokens || 0,
      totalTokens: response.usage?.total_tokens || 0,
      latencyMs,
      success: true,
    };

    // Estimate cost for API providers
    // Local providers are effectively free
    if (['openrouter', 'openai', 'anthropic'].includes(route.provider)) {
      // Rough cost estimates — should be configurable
      record.costUsd = (record.promptTokens * 0.000003) + (record.completionTokens * 0.000015);
    } else {
      record.costUsd = 0;
    }

    this.usageLog.push(record);

    // Keep only last 1000 records in memory
    if (this.usageLog.length > 1000) {
      this.usageLog = this.usageLog.slice(-1000);
    }
  }

  /**
   * Get health status for all providers.
   */
  async checkHealth(): Promise<ProviderHealth[]> {
    const results: ProviderHealth[] = [];

    for (const [name, provider] of this.providers) {
      const health = await provider.healthCheck();
      this.healthCache.set(name, health);
      results.push(health);
    }

    return results;
  }

  /**
   * Get a specific provider by name.
   */
  getProvider(name: ProviderName): Provider | undefined {
    return this.providers.get(name);
  }

  /**
   * List all available (initialized) providers.
   */
  listProviders(): ProviderName[] {
    return Array.from(this.providers.keys());
  }

  /**
   * Get usage statistics.
   */
  getUsageStats(): {
    totalRequests: number;
    totalTokens: number;
    totalCost: number;
    byProvider: Record<string, { requests: number; tokens: number; cost: number }>;
    byTier: Record<string, { requests: number; avgLatencyMs: number }>;
  } {
    const byProvider: Record<string, { requests: number; tokens: number; cost: number }> = {};
    const byTier: Record<string, { requests: number; avgLatencyMs: number; totalLatency: number }> = {};

    let totalRequests = 0;
    let totalTokens = 0;
    let totalCost = 0;

    for (const record of this.usageLog) {
      totalRequests++;
      totalTokens += record.totalTokens;
      totalCost += record.costUsd || 0;

      // By provider
      if (!byProvider[record.provider]) {
        byProvider[record.provider] = { requests: 0, tokens: 0, cost: 0 };
      }
      byProvider[record.provider].requests++;
      byProvider[record.provider].tokens += record.totalTokens;
      byProvider[record.provider].cost += record.costUsd || 0;

      // By tier
      if (!byTier[record.tier]) {
        byTier[record.tier] = { requests: 0, avgLatencyMs: 0, totalLatency: 0 };
      }
      byTier[record.tier].requests++;
      (byTier[record.tier] as { totalLatency: number }).totalLatency += record.latencyMs;
    }

    // Calculate averages
    const byTierResult: Record<string, { requests: number; avgLatencyMs: number }> = {};
    for (const [tier, data] of Object.entries(byTier)) {
      byTierResult[tier] = {
        requests: data.requests,
        avgLatencyMs: Math.round((data as { totalLatency: number }).totalLatency / data.requests),
      };
    }

    return { totalRequests, totalTokens, totalCost, byProvider, byTier: byTierResult };
  }
}

// ─── CLI Entry Point ────────────────────────────────────────────────────────

async function main() {
  const command = process.argv[2];

  if (!command || command === 'help') {
    console.log(`
PAI Model Router

Commands:
  status  — Check health of all configured providers
  test    — Test inference through each tier
  usage   — Show usage statistics
  help    — Show this help

Configuration is loaded from settings.json → providers + modelRouting sections.
`);
    return;
  }

  // Load settings
  const settingsPath = `${process.env.HOME}/.pai-oss/settings.json`;
  let settings: PAIOSSSettings;

  try {
    const raw = await Bun.file(settingsPath).text();
    const parsed = JSON.parse(raw);
    settings = {
      providers: parsed.providers || {},
      modelRouting: parsed.modelRouting || {},
    };
  } catch (err) {
    console.error(`Failed to load settings from ${settingsPath}:`, err);
    process.exit(1);
  }

  const router = new ModelRouter();
  await router.initialize(settings);

  switch (command) {
    case 'status': {
      console.log('\n🔍 Checking provider health...\n');
      const health = await router.checkHealth();
      for (const h of health) {
        const icon = h.available ? '✅' : '❌';
        const latency = h.latencyMs ? `${h.latencyMs}ms` : 'N/A';
        const models = h.modelsLoaded?.length
          ? h.modelsLoaded.slice(0, 5).join(', ') + (h.modelsLoaded.length > 5 ? '...' : '')
          : 'N/A';
        console.log(`  ${icon} ${h.name.padEnd(15)} latency=${latency.padEnd(8)} models=${models}`);
        if (h.error) {
          console.log(`     └─ ${h.error}`);
        }
      }
      break;
    }

    case 'test': {
      console.log('\n🧪 Testing tier routing...\n');
      const tiers: InferenceTier[] = ['fast', 'standard', 'smart'];
      for (const tier of tiers) {
        try {
          console.log(`  Testing ${tier} tier...`);
          const response = await router.complete(tier, [
            { role: 'system', content: 'Respond with exactly one word.' },
            { role: 'user', content: 'Say "working".' },
          ]);
          const content = response.choices[0]?.message?.content || 'No content';
          console.log(`  ✅ ${tier}: "${content.slice(0, 50)}" via ${response._provider} (${response._latencyMs}ms)`);
        } catch (err) {
          console.log(`  ❌ ${tier}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      break;
    }

    case 'usage': {
      const stats = router.getUsageStats();
      console.log('\n📊 Usage Statistics\n');
      console.log(`  Total requests: ${stats.totalRequests}`);
      console.log(`  Total tokens:   ${stats.totalTokens}`);
      console.log(`  Total cost:     $${stats.totalCost.toFixed(4)}`);
      if (Object.keys(stats.byProvider).length) {
        console.log('\n  By Provider:');
        for (const [name, data] of Object.entries(stats.byProvider)) {
          console.log(`    ${name}: ${data.requests} requests, ${data.tokens} tokens, $${data.cost.toFixed(4)}`);
        }
      }
      if (Object.keys(stats.byTier).length) {
        console.log('\n  By Tier:');
        for (const [tier, data] of Object.entries(stats.byTier)) {
          console.log(`    ${tier}: ${data.requests} requests, avg ${data.avgLatencyMs}ms`);
        }
      }
      break;
    }

    default:
      console.error(`Unknown command: ${command}. Run 'bun ModelRouter.ts help' for usage.`);
      process.exit(1);
  }
}

if (import.meta.main) {
  main().catch(console.error);
}
