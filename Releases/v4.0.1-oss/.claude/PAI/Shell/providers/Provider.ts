/**
 * ============================================================================
 * PAI Shell — Provider Interface
 * ============================================================================
 *
 * Abstract interface that all providers must implement. Providers are the
 * bridge between PAI Shell and any LLM backend — whether it's a local model
 * server (Ollama, llama.cpp), a commercial API (OpenAI, Anthropic, OpenRouter),
 * or a CLI agent (Claude Code, Codex, Gemini CLI, Aider).
 *
 * Two categories:
 * - API Providers: call an HTTP endpoint with chat completions format
 * - CLI Agent Providers: spawn a subprocess that handles tool execution itself
 *
 * ============================================================================
 */

import type {
  ChatMessage,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
  ProviderConfig,
  ProviderHealth,
  ProviderName,
  ProviderType,
  ToolDefinition,
} from '../types';

/**
 * Base provider interface — every provider (API or CLI agent) implements this.
 */
export interface Provider {
  /** Unique provider name */
  readonly name: ProviderName;

  /** Whether this is an API provider or CLI agent */
  readonly type: ProviderType;

  /** Whether this provider supports native tool/function calling */
  readonly supportsToolCalling: boolean;

  /** Whether this provider supports streaming responses */
  readonly supportsStreaming: boolean;

  /** Maximum context window in tokens (model-dependent) */
  readonly maxContextWindow: number;

  /**
   * Send a chat completion request and get a full response.
   * This is the primary inference method.
   */
  complete(request: ChatCompletionRequest): Promise<ChatCompletionResponse>;

  /**
   * Stream a chat completion response as SSE chunks.
   * Returns an async iterable of chunks.
   * Throws if streaming is not supported.
   */
  stream(request: ChatCompletionRequest): AsyncIterable<ChatCompletionChunk>;

  /**
   * List models available from this provider.
   * For local providers, returns currently loaded/available models.
   * For API providers, returns supported models.
   */
  listModels(): Promise<string[]>;

  /**
   * Health check — verify the provider is reachable and functional.
   * Returns availability status with optional latency and error info.
   */
  healthCheck(): Promise<ProviderHealth>;

  /**
   * Initialize the provider with configuration.
   * Called once when the provider is first loaded.
   */
  initialize(config: ProviderConfig): Promise<void>;
}

/**
 * Base class for API providers that use the OpenAI-compatible
 * /v1/chat/completions endpoint.
 *
 * Handles common HTTP request/response logic, leaving subclasses
 * to customize URL, headers, and any request/response transforms.
 */
export abstract class BaseAPIProvider implements Provider {
  abstract readonly name: ProviderName;
  readonly type: ProviderType = 'api';
  abstract readonly supportsToolCalling: boolean;
  abstract readonly supportsStreaming: boolean;
  abstract readonly maxContextWindow: number;

  protected baseUrl: string = '';
  protected apiKey: string = '';
  protected timeout: number = 30000;
  protected customHeaders: Record<string, string> = {};

  async initialize(config: ProviderConfig): Promise<void> {
    this.baseUrl = config.baseUrl || this.baseUrl;
    this.timeout = config.timeout || this.timeout;
    this.customHeaders = config.customHeaders || {};

    // Resolve API key from environment if prefixed with $
    if (config.apiKey) {
      this.apiKey = config.apiKey.startsWith('$')
        ? process.env[config.apiKey.slice(1)] || ''
        : config.apiKey;
    }
  }

  /**
   * Build request headers. Override in subclasses for custom auth schemes.
   */
  protected buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.customHeaders,
    };
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }
    return headers;
  }

  /**
   * Transform the request before sending. Override for provider-specific
   * request format differences (e.g., Anthropic's message format).
   */
  protected transformRequest(request: ChatCompletionRequest): unknown {
    return request;
  }

  /**
   * Transform the response after receiving. Override for provider-specific
   * response format differences.
   */
  protected transformResponse(raw: unknown): ChatCompletionResponse {
    return raw as ChatCompletionResponse;
  }

  /**
   * Get the completions endpoint URL.
   */
  protected getCompletionsUrl(): string {
    return `${this.baseUrl}/v1/chat/completions`;
  }

  async complete(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const url = this.getCompletionsUrl();
    const headers = this.buildHeaders();
    const body = this.transformRequest({ ...request, stream: false });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Provider ${this.name} returned ${response.status}: ${errorText}`);
      }

      const raw = await response.json();
      const result = this.transformResponse(raw);

      // Tag with provider metadata
      result._provider = this.name;

      return result;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async *stream(request: ChatCompletionRequest): AsyncIterable<ChatCompletionChunk> {
    if (!this.supportsStreaming) {
      throw new Error(`Provider ${this.name} does not support streaming`);
    }

    const url = this.getCompletionsUrl();
    const headers = this.buildHeaders();
    const body = this.transformRequest({ ...request, stream: true });

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Provider ${this.name} returned ${response.status}: ${errorText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body for streaming');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6);
        if (data === '[DONE]') return;

        try {
          yield JSON.parse(data) as ChatCompletionChunk;
        } catch {
          // Skip invalid JSON chunks
        }
      }
    }
  }

  async listModels(): Promise<string[]> {
    try {
      const response = await fetch(`${this.baseUrl}/v1/models`, {
        headers: this.buildHeaders(),
      });
      if (!response.ok) return [];
      const data = await response.json() as { data?: Array<{ id: string }> };
      return (data.data || []).map((m) => m.id);
    } catch {
      return [];
    }
  }

  async healthCheck(): Promise<ProviderHealth> {
    const start = Date.now();
    try {
      const models = await this.listModels();
      return {
        name: this.name,
        available: models.length > 0,
        latencyMs: Date.now() - start,
        modelsLoaded: models,
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

/**
 * Base class for CLI agent providers that delegate to external CLI tools
 * (Claude Code, Codex, Gemini CLI, Aider).
 *
 * These providers spawn a subprocess and capture its output.
 * They handle tool execution internally — PAI Shell delegates
 * the full task to them rather than managing tool calls.
 */
export abstract class BaseCLIAgentProvider implements Provider {
  abstract readonly name: ProviderName;
  readonly type: ProviderType = 'cli-agent';
  abstract readonly supportsToolCalling: boolean;
  abstract readonly supportsStreaming: boolean;
  abstract readonly maxContextWindow: number;

  protected binary: string = '';
  protected timeout: number = 120000;  // CLI agents need more time

  async initialize(config: ProviderConfig): Promise<void> {
    this.binary = config.binary || this.binary;
    this.timeout = config.timeout || this.timeout;
  }

  /**
   * Build subprocess arguments from the chat completion request.
   * Each CLI agent has different flag conventions.
   */
  protected abstract buildArgs(request: ChatCompletionRequest): string[];

  /**
   * Parse the subprocess output into a ChatCompletionResponse.
   */
  protected abstract parseOutput(stdout: string, stderr: string, exitCode: number): ChatCompletionResponse;

  async complete(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const args = this.buildArgs(request);
    const start = Date.now();

    return new Promise((resolve, reject) => {
      const { spawn } = require('child_process') as typeof import('child_process');

      const proc = spawn(this.binary, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env },
      });

      let stdout = '';
      let stderr = '';

      // Write the last user message as stdin prompt
      const lastUserMsg = [...request.messages].reverse().find(m => m.role === 'user');
      if (lastUserMsg?.content) {
        proc.stdin.write(lastUserMsg.content);
        proc.stdin.end();
      }

      proc.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
      proc.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

      const timeoutId = setTimeout(() => {
        proc.kill('SIGTERM');
        reject(new Error(`CLI agent ${this.name} timed out after ${this.timeout}ms`));
      }, this.timeout);

      proc.on('close', (code: number | null) => {
        clearTimeout(timeoutId);
        const result = this.parseOutput(stdout, stderr, code || 0);
        result._provider = this.name;
        result._latencyMs = Date.now() - start;
        resolve(result);
      });

      proc.on('error', (err: Error) => {
        clearTimeout(timeoutId);
        reject(new Error(`Failed to spawn ${this.binary}: ${err.message}`));
      });
    });
  }

  async *stream(_request: ChatCompletionRequest): AsyncIterable<ChatCompletionChunk> {
    throw new Error(`CLI agent provider ${this.name} does not support streaming`);
  }

  async listModels(): Promise<string[]> {
    // CLI agents typically don't expose model lists
    return [];
  }

  async healthCheck(): Promise<ProviderHealth> {
    const start = Date.now();
    try {
      const { execSync } = require('child_process') as typeof import('child_process');
      execSync(`which ${this.binary}`, { timeout: 5000 });
      return {
        name: this.name,
        available: true,
        latencyMs: Date.now() - start,
        lastChecked: Date.now(),
      };
    } catch {
      return {
        name: this.name,
        available: false,
        error: `Binary '${this.binary}' not found in PATH`,
        lastChecked: Date.now(),
      };
    }
  }
}
