/**
 * ============================================================================
 * Anthropic Provider
 * ============================================================================
 *
 * Connects to the Anthropic Messages API (api.anthropic.com).
 *
 * IMPORTANT: Anthropic does NOT use the OpenAI-compatible format.
 * They have their own request/response schema. This provider translates
 * between PAI's OpenAI-format types and Anthropic's native format.
 *
 * Request differences:
 * - System prompt is a top-level `system` field, not a message
 * - Messages use `content` as an array of content blocks
 * - Tool calling uses `tool_use` / `tool_result` content blocks
 * - Auth uses `x-api-key` header, not Bearer token
 *
 * Supports: tool calling, streaming, model listing.
 *
 * Configuration:
 *   apiKey: "$ANTHROPIC_API_KEY" (resolved from env)
 *
 * ============================================================================
 */

import { BaseAPIProvider } from './Provider';
import type {
  ProviderConfig,
  ProviderHealth,
  ProviderName,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatMessage,
  ToolCall,
} from '../types';

// ─── Anthropic-specific types ───────────────────────────────────────────────

interface AnthropicRequest {
  model: string;
  max_tokens: number;
  system?: string;
  messages: AnthropicMessage[];
  tools?: AnthropicTool[];
  temperature?: number;
  top_p?: number;
  stream?: boolean;
}

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

interface AnthropicContentBlock {
  type: 'text' | 'tool_use' | 'tool_result';
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: string;
}

interface AnthropicTool {
  name: string;
  description: string;
  input_schema: unknown;
}

interface AnthropicResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  content: AnthropicContentBlock[];
  model: string;
  stop_reason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence';
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

// ─── Provider ───────────────────────────────────────────────────────────────

export class AnthropicProvider extends BaseAPIProvider {
  readonly name: ProviderName = 'anthropic';
  readonly supportsToolCalling = true;
  readonly supportsStreaming = true;
  maxContextWindow = 200000;  // Claude models support 200K

  private apiVersion = '2023-06-01';

  constructor() {
    super();
    this.baseUrl = 'https://api.anthropic.com';
  }

  async initialize(config: ProviderConfig): Promise<void> {
    await super.initialize(config);
    this.baseUrl = config.baseUrl || 'https://api.anthropic.com';
    if (config.maxContextWindow) {
      this.maxContextWindow = config.maxContextWindow;
    }
  }

  /**
   * Anthropic uses x-api-key header, not Bearer token
   */
  protected buildHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'x-api-key': this.apiKey,
      'anthropic-version': this.apiVersion,
      ...this.customHeaders,
    };
  }

  /**
   * Anthropic uses /v1/messages, not /v1/chat/completions
   */
  protected getCompletionsUrl(): string {
    return `${this.baseUrl}/v1/messages`;
  }

  /**
   * Transform OpenAI-format request to Anthropic-format request
   */
  protected transformRequest(request: ChatCompletionRequest): unknown {
    // Extract system prompt from messages
    const systemMessages = request.messages.filter(m => m.role === 'system');
    const systemPrompt = systemMessages.map(m => m.content).join('\n\n');

    // Convert non-system messages to Anthropic format
    const messages: AnthropicMessage[] = [];
    for (const msg of request.messages) {
      if (msg.role === 'system') continue;

      if (msg.role === 'tool') {
        // Tool results in Anthropic format are user messages with tool_result content
        const lastMsg = messages[messages.length - 1];
        if (lastMsg?.role === 'user' && Array.isArray(lastMsg.content)) {
          (lastMsg.content as AnthropicContentBlock[]).push({
            type: 'tool_result',
            tool_use_id: msg.tool_call_id,
            content: msg.content || '',
          });
        } else {
          messages.push({
            role: 'user',
            content: [{
              type: 'tool_result',
              tool_use_id: msg.tool_call_id,
              content: msg.content || '',
            }],
          });
        }
        continue;
      }

      if (msg.role === 'assistant' && msg.tool_calls?.length) {
        // Assistant messages with tool calls → tool_use content blocks
        const content: AnthropicContentBlock[] = [];
        if (msg.content) {
          content.push({ type: 'text', text: msg.content });
        }
        for (const tc of msg.tool_calls) {
          content.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.function.name,
            input: JSON.parse(tc.function.arguments),
          });
        }
        messages.push({ role: 'assistant', content });
        continue;
      }

      // Standard text messages
      messages.push({
        role: msg.role as 'user' | 'assistant',
        content: msg.content || '',
      });
    }

    // Build Anthropic request
    const anthropicRequest: AnthropicRequest = {
      model: request.model,
      max_tokens: request.max_tokens || 4096,
      messages,
      stream: request.stream,
    };

    if (systemPrompt) {
      anthropicRequest.system = systemPrompt;
    }

    if (request.temperature !== undefined) {
      anthropicRequest.temperature = request.temperature;
    }

    if (request.top_p !== undefined) {
      anthropicRequest.top_p = request.top_p;
    }

    // Convert tools
    if (request.tools?.length) {
      anthropicRequest.tools = request.tools.map(t => ({
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters,
      }));
    }

    return anthropicRequest;
  }

  /**
   * Transform Anthropic-format response to OpenAI-format response
   */
  protected transformResponse(raw: unknown): ChatCompletionResponse {
    const anthropic = raw as AnthropicResponse;

    // Extract text content and tool calls
    let textContent = '';
    const toolCalls: ToolCall[] = [];

    for (const block of anthropic.content) {
      if (block.type === 'text' && block.text) {
        textContent += block.text;
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id!,
          type: 'function',
          function: {
            name: block.name!,
            arguments: JSON.stringify(block.input),
          },
        });
      }
    }

    // Map stop_reason to finish_reason
    const finishReason = anthropic.stop_reason === 'tool_use'
      ? 'tool_calls' as const
      : anthropic.stop_reason === 'max_tokens'
        ? 'length' as const
        : 'stop' as const;

    const message: ChatMessage = {
      role: 'assistant',
      content: textContent || null,
    };

    if (toolCalls.length > 0) {
      message.tool_calls = toolCalls;
    }

    return {
      id: anthropic.id,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: anthropic.model,
      choices: [{
        index: 0,
        message,
        finish_reason: finishReason,
      }],
      usage: {
        prompt_tokens: anthropic.usage.input_tokens,
        completion_tokens: anthropic.usage.output_tokens,
        total_tokens: anthropic.usage.input_tokens + anthropic.usage.output_tokens,
      },
    };
  }

  async listModels(): Promise<string[]> {
    // Anthropic doesn't have a model listing endpoint
    return [
      'claude-opus-4-20250514',
      'claude-sonnet-4-20250514',
      'claude-haiku-4-5-20251001',
    ];
  }

  async healthCheck(): Promise<ProviderHealth> {
    const start = Date.now();
    if (!this.apiKey) {
      return {
        name: this.name,
        available: false,
        error: 'No ANTHROPIC_API_KEY configured',
        lastChecked: Date.now(),
      };
    }
    // Simple connectivity check — just verify the API responds
    try {
      const response = await fetch(`${this.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'hi' }],
        }),
        signal: AbortSignal.timeout(10000),
      });
      // We expect either 200 or a non-5xx error (auth issues are "available but misconfigured")
      return {
        name: this.name,
        available: response.status < 500,
        latencyMs: Date.now() - start,
        error: response.ok ? undefined : `Status ${response.status}`,
        lastChecked: Date.now(),
      };
    } catch (err) {
      return {
        name: this.name,
        available: false,
        error: err instanceof Error ? err.message : String(err),
        lastChecked: Date.now(),
      };
    }
  }
}
