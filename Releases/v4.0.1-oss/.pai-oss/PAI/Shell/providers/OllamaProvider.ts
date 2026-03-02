/**
 * ============================================================================
 * Ollama Provider
 * ============================================================================
 *
 * Connects to a local Ollama instance at localhost:11434.
 * Ollama natively exposes an OpenAI-compatible /v1/chat/completions endpoint,
 * so this provider is a thin wrapper over BaseAPIProvider.
 *
 * Supports: tool calling (model-dependent), streaming, model listing.
 *
 * Configuration:
 *   baseUrl: "http://localhost:11434" (default)
 *   models: auto-detected from running instance
 *
 * ============================================================================
 */

import { BaseAPIProvider } from './Provider';
import type {
  ProviderConfig,
  ProviderHealth,
  ProviderName,
  ChatCompletionRequest,
} from '../types';

export class OllamaProvider extends BaseAPIProvider {
  readonly name: ProviderName = 'ollama';
  readonly supportsToolCalling = true;
  readonly supportsStreaming = true;
  maxContextWindow = 32768;  // Model-dependent, conservative default

  constructor() {
    super();
    this.baseUrl = 'http://localhost:11434';
  }

  async initialize(config: ProviderConfig): Promise<void> {
    await super.initialize(config);
    if (!this.baseUrl) {
      this.baseUrl = 'http://localhost:11434';
    }
    // Update context window from config if specified
    if (config.maxContextWindow) {
      this.maxContextWindow = config.maxContextWindow;
    }
  }

  /**
   * Ollama uses /api/tags for model listing (not /v1/models)
   */
  async listModels(): Promise<string[]> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        headers: this.buildHeaders(),
      });
      if (!response.ok) return [];
      const data = await response.json() as { models?: Array<{ name: string }> };
      return (data.models || []).map((m) => m.name);
    } catch {
      return [];
    }
  }

  async healthCheck(): Promise<ProviderHealth> {
    const start = Date.now();
    try {
      // Ollama has a simple GET / endpoint that returns "Ollama is running"
      const response = await fetch(this.baseUrl, { signal: AbortSignal.timeout(5000) });
      if (!response.ok) {
        return {
          name: this.name,
          available: false,
          error: `Ollama returned status ${response.status}`,
          lastChecked: Date.now(),
        };
      }
      const models = await this.listModels();
      return {
        name: this.name,
        available: true,
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

  /**
   * Override to set Ollama-specific options in the request.
   * Ollama's OpenAI-compatible endpoint at /v1/chat/completions
   * accepts the standard format but also supports extra options.
   */
  protected transformRequest(request: ChatCompletionRequest): unknown {
    return {
      ...request,
      // Ollama-specific: keep_alive controls how long model stays loaded
      keep_alive: '30m',
    };
  }
}
