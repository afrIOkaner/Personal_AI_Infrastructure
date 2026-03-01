#!/usr/bin/env bun
/**
 * ============================================================================
 * PAI Shell — Provider-Agnostic Agentic CLI
 * ============================================================================
 *
 * The PAI Shell is the core execution engine for PAI-OSS. It replaces
 * Claude Code's closed-source agent loop with an open, provider-agnostic
 * equivalent that preserves PAI's full infrastructure:
 *
 * - Algorithm, Skills, Hooks, Agents, Memory
 * - Tool execution (Read, Write, Edit, Bash, Grep, Glob, etc.)
 * - Multi-provider routing (Ollama, llama.cpp, OpenRouter, OpenAI, etc.)
 * - CLI agent delegation (Claude Code, Codex, Gemini CLI, Aider)
 *
 * USAGE:
 *   bun pai-shell.ts                     Interactive REPL mode
 *   bun pai-shell.ts --print "prompt"    Single-shot (print & exit)
 *   bun pai-shell.ts -p "prompt"         Alias for --print
 *   bun pai-shell.ts --tier smart        Override default tier
 *   bun pai-shell.ts --provider ollama   Force a specific provider
 *   bun pai-shell.ts --max-turns 50      Override max agentic turns
 *   bun pai-shell.ts --no-tools          Disable tool execution
 *   bun pai-shell.ts --verbose           Show routing/debug info
 *   bun pai-shell.ts --status            Show provider health
 *   bun pai-shell.ts --init              Generate default settings.json
 *
 * ENVIRONMENT:
 *   PAI_DIR           PAI root directory (default: ~/.claude)
 *   PAI_TIER          Default inference tier (default: standard)
 *   PAI_PROVIDER      Force a specific provider
 *   PAI_MAX_TURNS     Max agentic tool loop turns (default: 30)
 *   PAI_VERBOSE       Enable verbose output
 *
 * ============================================================================
 */

import { ModelRouter } from './ModelRouter';
import { DEFAULT_SETTINGS } from './defaults';
import { createToolRegistry, type ToolRegistry } from './tools/index';
import type {
  InferenceTier,
  PAIOSSSettings,
  ChatMessage,
  ChatCompletionResponse,
  ToolCall,
  ToolDefinition,
  ProviderName,
  ShellSession,
} from './types';

// ─── Configuration ──────────────────────────────────────────────────────────

const PAI_DIR = process.env.PAI_DIR || `${process.env.HOME}/.claude`;
const DEFAULT_TIER: InferenceTier = (process.env.PAI_TIER as InferenceTier) || 'standard';
const DEFAULT_MAX_TURNS = parseInt(process.env.PAI_MAX_TURNS || '30', 10);
const VERBOSE = process.env.PAI_VERBOSE === '1' || process.env.PAI_VERBOSE === 'true';

// ─── Settings Loader ────────────────────────────────────────────────────────

async function loadSettings(): Promise<PAIOSSSettings> {
  const paths = [
    `${PAI_DIR}/pai-oss-settings.json`,
    `${PAI_DIR}/settings.json`,
  ];

  for (const path of paths) {
    try {
      const raw = await Bun.file(path).text();
      const parsed = JSON.parse(raw);
      if (parsed.providers && parsed.modelRouting) {
        return {
          providers: parsed.providers,
          modelRouting: parsed.modelRouting,
          cliAgentRouting: parsed.cliAgentRouting,
        };
      }
    } catch {
      // try next path
    }
  }

  return DEFAULT_SETTINGS;
}

// ─── System Prompt Builder ──────────────────────────────────────────────────

async function buildSystemPrompt(): Promise<string> {
  const parts: string[] = [];

  // Load SYSTEM.md / SKILL.md (PAI's core identity)
  const systemPaths = [
    `${PAI_DIR}/PAI/SKILL.md`,
    `${PAI_DIR}/CLAUDE.md`,
  ];

  for (const path of systemPaths) {
    try {
      const content = await Bun.file(path).text();
      parts.push(content);
      break; // Use the first one found
    } catch {
      // try next
    }
  }

  // Load dynamic context (user info, recent work, etc.)
  try {
    const userCtx = await Bun.file(`${PAI_DIR}/PAI/USER/CONTEXT.md`).text();
    parts.push(`\n\n<user-context>\n${userCtx}\n</user-context>`);
  } catch {
    // No user context available
  }

  // Add PAI-OSS identifier
  parts.push(`\n\n<pai-oss>
You are running inside PAI Shell (PAI-OSS), a provider-agnostic agentic CLI.
You have access to tools for file operations, code editing, terminal commands, and more.
Use tools when needed to accomplish the user's request.
Work autonomously until the task is complete.
</pai-oss>`);

  return parts.join('\n');
}

// ─── Agentic Tool Loop ─────────────────────────────────────────────────────

interface AgentLoopOptions {
  router: ModelRouter;
  tools: ToolRegistry;
  tier: InferenceTier;
  messages: ChatMessage[];
  toolDefs: ToolDefinition[];
  maxTurns: number;
  verbose: boolean;
  onContent?: (content: string) => void;
  onToolCall?: (name: string, args: Record<string, unknown>) => void;
  onToolResult?: (name: string, result: string, success: boolean) => void;
}

/**
 * The core agentic loop. Sends messages to the model, executes any
 * requested tool calls, appends results, and repeats until the model
 * produces a final text response (no more tool calls) or we hit max turns.
 */
async function runAgentLoop(opts: AgentLoopOptions): Promise<string> {
  const { router, tools, tier, messages, toolDefs, maxTurns, verbose, onContent, onToolCall, onToolResult } = opts;
  let turn = 0;
  let finalContent = '';

  while (turn < maxTurns) {
    turn++;

    if (verbose) {
      console.error(`\n[PAI Shell] Turn ${turn}/${maxTurns} — sending to ${tier} tier...`);
    }

    // Send to model
    const response: ChatCompletionResponse = await router.complete(
      tier,
      messages,
      toolDefs.length > 0 ? toolDefs : undefined,
    );

    const choice = response.choices[0];
    if (!choice) {
      throw new Error('No response choice from model');
    }

    const assistantMsg = choice.message;

    // Append assistant message to conversation
    messages.push({
      role: 'assistant',
      content: assistantMsg.content,
      tool_calls: assistantMsg.tool_calls,
    });

    // If the model produced text content, emit it
    if (assistantMsg.content) {
      finalContent = assistantMsg.content;
      onContent?.(assistantMsg.content);
    }

    // Check if there are tool calls to execute
    if (!assistantMsg.tool_calls || assistantMsg.tool_calls.length === 0) {
      // No tool calls — model is done
      if (verbose) {
        console.error(`[PAI Shell] Model completed after ${turn} turns`);
        if (response._provider) {
          console.error(`[PAI Shell] Provider: ${response._provider}, Model: ${response.model}, Latency: ${response._latencyMs}ms`);
        }
      }
      break;
    }

    // Execute tool calls
    if (verbose) {
      console.error(`[PAI Shell] ${assistantMsg.tool_calls.length} tool call(s) to execute`);
    }

    for (const toolCall of assistantMsg.tool_calls) {
      const toolName = toolCall.function.name;
      let args: Record<string, unknown> = {};

      try {
        args = JSON.parse(toolCall.function.arguments);
      } catch {
        // If arguments aren't valid JSON, pass as raw string
        args = { _raw: toolCall.function.arguments };
      }

      onToolCall?.(toolName, args);

      // Execute the tool
      const handler = tools.getHandler(toolName);
      if (!handler) {
        const errorMsg = `Unknown tool: ${toolName}`;
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify({ error: errorMsg }),
        });
        onToolResult?.(toolName, errorMsg, false);
        continue;
      }

      try {
        const startTime = Date.now();
        const result = await handler.execute(args);
        const duration = Date.now() - startTime;

        if (verbose) {
          console.error(`[PAI Shell] Tool ${toolName} completed in ${duration}ms`);
        }

        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: result,
        });
        onToolResult?.(toolName, result.slice(0, 200), true);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify({ error: errorMsg }),
        });
        onToolResult?.(toolName, errorMsg, false);
      }
    }
  }

  if (turn >= maxTurns) {
    console.error(`\n[PAI Shell] Warning: Hit max turns (${maxTurns}). Model may not have completed.`);
  }

  return finalContent;
}

// ─── Print Mode (Single-Shot) ───────────────────────────────────────────────

async function runPrintMode(
  prompt: string,
  tier: InferenceTier,
  maxTurns: number,
  noTools: boolean,
  verbose: boolean,
): Promise<void> {
  const settings = await loadSettings();
  const router = new ModelRouter();
  await router.initialize(settings);

  const systemPrompt = await buildSystemPrompt();
  const tools = noTools ? null : createToolRegistry(PAI_DIR);
  const toolDefs = tools ? tools.getDefinitions() : [];

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: prompt },
  ];

  const result = await runAgentLoop({
    router,
    tools: tools || createEmptyRegistry(),
    tier,
    messages,
    toolDefs,
    maxTurns,
    verbose,
    onContent: (content) => {
      // In print mode, we only output final content
    },
    onToolCall: verbose ? (name, args) => {
      console.error(`  → ${name}(${JSON.stringify(args).slice(0, 100)}...)`);
    } : undefined,
  });

  // Print the final result
  console.log(result);
}

// ─── Interactive REPL Mode ──────────────────────────────────────────────────

async function runInteractiveMode(
  tier: InferenceTier,
  maxTurns: number,
  noTools: boolean,
  verbose: boolean,
): Promise<void> {
  const settings = await loadSettings();
  const router = new ModelRouter();
  await router.initialize(settings);

  const systemPrompt = await buildSystemPrompt();
  const tools = noTools ? null : createToolRegistry(PAI_DIR);
  const toolDefs = tools ? tools.getDefinitions() : [];

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
  ];

  // Session info
  const providers = router.listProviders();
  console.log(`\n╔══════════════════════════════════════════════════════════╗`);
  console.log(`║  PAI Shell — Provider-Agnostic Agentic CLI              ║`);
  console.log(`╠══════════════════════════════════════════════════════════╣`);
  console.log(`║  Tier:      ${tier.padEnd(44)}║`);
  console.log(`║  Providers: ${providers.join(', ').padEnd(44)}║`);
  console.log(`║  Tools:     ${(toolDefs.length + ' available').padEnd(44)}║`);
  console.log(`║  Max turns: ${String(maxTurns).padEnd(44)}║`);
  console.log(`╠══════════════════════════════════════════════════════════╣`);
  console.log(`║  Commands:                                              ║`);
  console.log(`║    /quit or /exit    — Exit the shell                   ║`);
  console.log(`║    /status           — Show provider health             ║`);
  console.log(`║    /usage            — Show usage statistics            ║`);
  console.log(`║    /tier <name>      — Change inference tier            ║`);
  console.log(`║    /clear            — Clear conversation history       ║`);
  console.log(`║    /compact          — Summarize history to save tokens ║`);
  console.log(`║    /verbose          — Toggle verbose mode              ║`);
  console.log(`╚══════════════════════════════════════════════════════════╝\n`);

  const reader = createLineReader();
  let currentTier = tier;
  let isVerbose = verbose;

  while (true) {
    const input = await reader.prompt('> ');
    if (input === null) break; // EOF

    const trimmed = input.trim();
    if (!trimmed) continue;

    // Handle commands
    if (trimmed.startsWith('/')) {
      const handled = await handleCommand(trimmed, router, messages, currentTier, isVerbose);
      if (handled === 'quit') break;
      if (handled === 'verbose-toggle') {
        isVerbose = !isVerbose;
        console.log(`Verbose mode: ${isVerbose ? 'ON' : 'OFF'}`);
      }
      if (typeof handled === 'object' && handled.tier) {
        currentTier = handled.tier;
        console.log(`Tier changed to: ${currentTier}`);
      }
      continue;
    }

    // Add user message
    messages.push({ role: 'user', content: trimmed });

    try {
      await runAgentLoop({
        router,
        tools: tools || createEmptyRegistry(),
        tier: currentTier,
        messages,
        toolDefs,
        maxTurns,
        verbose: isVerbose,
        onContent: (content) => {
          console.log(`\n${content}\n`);
        },
        onToolCall: (name, args) => {
          const argsStr = JSON.stringify(args);
          const preview = argsStr.length > 120 ? argsStr.slice(0, 120) + '...' : argsStr;
          console.error(`  ⚡ ${name}(${preview})`);
        },
        onToolResult: (name, result, success) => {
          const icon = success ? '✓' : '✗';
          if (isVerbose) {
            console.error(`  ${icon} ${name} → ${result.slice(0, 150)}`);
          }
        },
      });
    } catch (err) {
      console.error(`\nError: ${err instanceof Error ? err.message : String(err)}\n`);
    }
  }

  console.log('\nGoodbye.\n');
}

// ─── Command Handler ────────────────────────────────────────────────────────

async function handleCommand(
  input: string,
  router: ModelRouter,
  messages: ChatMessage[],
  currentTier: InferenceTier,
  verbose: boolean,
): Promise<string | { tier: InferenceTier } | undefined> {
  const [cmd, ...args] = input.split(/\s+/);

  switch (cmd) {
    case '/quit':
    case '/exit':
    case '/q':
      return 'quit';

    case '/status': {
      console.log('\nChecking provider health...\n');
      const health = await router.checkHealth();
      for (const h of health) {
        const icon = h.available ? '✅' : '❌';
        const latency = h.latencyMs ? `${h.latencyMs}ms` : 'N/A';
        console.log(`  ${icon} ${h.name.padEnd(15)} ${latency}`);
        if (h.error) console.log(`     └─ ${h.error}`);
      }
      console.log('');
      return;
    }

    case '/usage': {
      const stats = router.getUsageStats();
      console.log(`\nUsage: ${stats.totalRequests} requests, ${stats.totalTokens} tokens, $${stats.totalCost.toFixed(4)}\n`);
      return;
    }

    case '/tier': {
      const newTier = args[0]?.toLowerCase();
      if (!newTier || !['fast', 'standard', 'smart', 'reasoning'].includes(newTier)) {
        console.log('Usage: /tier <fast|standard|smart|reasoning>');
        return;
      }
      return { tier: newTier as InferenceTier };
    }

    case '/clear':
      // Keep system prompt, remove everything else
      const systemMsg = messages.find(m => m.role === 'system');
      messages.length = 0;
      if (systemMsg) messages.push(systemMsg);
      console.log('Conversation cleared.\n');
      return;

    case '/compact': {
      // Summarize conversation history to save tokens
      const msgCount = messages.filter(m => m.role !== 'system').length;
      if (msgCount < 4) {
        console.log('Not enough messages to compact.\n');
        return;
      }

      console.log(`Compacting ${msgCount} messages...`);
      const systemMsg2 = messages.find(m => m.role === 'system');
      const conversationText = messages
        .filter(m => m.role !== 'system')
        .map(m => `${m.role}: ${(m.content || '').slice(0, 500)}`)
        .join('\n');

      try {
        const summary = await router.complete('fast', [
          { role: 'system', content: 'Summarize this conversation concisely, preserving all key decisions, code changes, and context needed to continue. Output only the summary.' },
          { role: 'user', content: conversationText },
        ]);

        const summaryText = summary.choices[0]?.message?.content || '';
        messages.length = 0;
        if (systemMsg2) messages.push(systemMsg2);
        messages.push({
          role: 'user',
          content: `[Previous conversation summary: ${summaryText}]`,
        });
        messages.push({
          role: 'assistant',
          content: 'Understood. I have the context from our previous conversation. How can I help?',
        });
        console.log(`Compacted ${msgCount} messages into summary.\n`);
      } catch (err) {
        console.error(`Compaction failed: ${err instanceof Error ? err.message : String(err)}\n`);
      }
      return;
    }

    case '/verbose':
      return 'verbose-toggle';

    default:
      console.log(`Unknown command: ${cmd}. Type /quit to exit.\n`);
      return;
  }
}

// ─── Line Reader (cross-platform stdin) ─────────────────────────────────────

function createLineReader(): { prompt: (prefix: string) => Promise<string | null> } {
  // Use Bun's native readline-like approach
  const decoder = new TextDecoder();

  return {
    prompt: async (prefix: string): Promise<string | null> => {
      process.stdout.write(prefix);

      // Read from stdin line by line
      const reader = Bun.stdin.stream().getReader();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          reader.releaseLock();
          return buffer || null;
        }

        buffer += decoder.decode(value, { stream: true });
        const newlineIdx = buffer.indexOf('\n');
        if (newlineIdx >= 0) {
          const line = buffer.slice(0, newlineIdx);
          reader.releaseLock();
          return line;
        }
      }
    },
  };
}

// ─── Empty Registry (for --no-tools mode) ───────────────────────────────────

function createEmptyRegistry(): ToolRegistry {
  return {
    getDefinitions: () => [],
    getHandler: () => undefined,
    listTools: () => [],
  };
}

// ─── Status Command ─────────────────────────────────────────────────────────

async function runStatusCommand(): Promise<void> {
  const settings = await loadSettings();
  const router = new ModelRouter();
  await router.initialize(settings);

  console.log('\n🔍 PAI Shell — Provider Status\n');
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

  console.log('');
}

// ─── Init Command ───────────────────────────────────────────────────────────

async function runInitCommand(): Promise<void> {
  const outPath = `${PAI_DIR}/pai-oss-settings.json`;
  try {
    await Bun.file(outPath).text();
    console.log(`Settings file already exists: ${outPath}`);
    console.log('Delete it first if you want to regenerate.');
    return;
  } catch {
    // File doesn't exist — create it
  }

  await Bun.write(outPath, JSON.stringify(DEFAULT_SETTINGS, null, 2));
  console.log(`Created default settings: ${outPath}`);
  console.log('Edit this file to configure providers, models, and routing.');
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Parse flags
  let printPrompt: string | null = null;
  let tier: InferenceTier = DEFAULT_TIER;
  let maxTurns = DEFAULT_MAX_TURNS;
  let noTools = false;
  let verbose = VERBOSE;
  let forceProvider: ProviderName | null = null;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--print':
      case '-p':
        printPrompt = args[++i] || '';
        break;
      case '--tier':
      case '-t':
        tier = (args[++i] || 'standard') as InferenceTier;
        break;
      case '--provider':
        forceProvider = args[++i] as ProviderName;
        break;
      case '--max-turns':
        maxTurns = parseInt(args[++i] || '30', 10);
        break;
      case '--no-tools':
        noTools = true;
        break;
      case '--verbose':
      case '-v':
        verbose = true;
        break;
      case '--status':
        await runStatusCommand();
        return;
      case '--init':
        await runInitCommand();
        return;
      case '--help':
      case '-h':
        printUsage();
        return;
      default:
        // If no flag matches, treat remaining args as the prompt
        if (!printPrompt && !args[i].startsWith('-')) {
          printPrompt = args.slice(i).join(' ');
          i = args.length; // break out
        }
        break;
    }
  }

  if (printPrompt !== null) {
    await runPrintMode(printPrompt, tier, maxTurns, noTools, verbose);
  } else {
    await runInteractiveMode(tier, maxTurns, noTools, verbose);
  }
}

function printUsage(): void {
  console.log(`
PAI Shell — Provider-Agnostic Agentic CLI

Usage:
  bun pai-shell.ts                     Interactive REPL mode
  bun pai-shell.ts --print "prompt"    Single-shot (print & exit)
  bun pai-shell.ts -p "prompt"         Alias for --print
  bun pai-shell.ts --status            Show provider health
  bun pai-shell.ts --init              Generate default settings

Options:
  --tier <name>       Inference tier: fast, standard, smart, reasoning
  --provider <name>   Force a specific provider
  --max-turns <n>     Max agentic tool loop turns (default: 30)
  --no-tools          Disable tool execution
  --verbose, -v       Show routing & debug info
  --help, -h          Show this help

Interactive Commands:
  /quit, /exit        Exit the shell
  /status             Show provider health
  /usage              Show usage statistics
  /tier <name>        Change inference tier
  /clear              Clear conversation history
  /compact            Summarize history to save tokens
  /verbose            Toggle verbose mode
`);
}

// Run
if (import.meta.main) {
  main().catch((err) => {
    console.error(`Fatal error: ${err.message || err}`);
    process.exit(1);
  });
}

// ─── Exports ────────────────────────────────────────────────────────────────

export { runAgentLoop, buildSystemPrompt, loadSettings };
export type { AgentLoopOptions };
