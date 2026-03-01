/**
 * ============================================================================
 * OpenRouter Provider
 * ============================================================================
 *
 * Connects to OpenRouter (openrouter.ai) — a unified API gateway that
 * proxies 200+ models from 20+ providers (Anthropic, OpenAI, Google,
 * Meta, Mistral, DeepSeek, etc.) through a single OpenAI-compatible endpoint.
 *
 * Key value: one API key, all models, full tool calling passthrough.
 *
 * Supports: tool calling (model-dependent), streaming, model listing.
 *
 * Configuration:
 *   apiKey: "$OPENROUTER_API_KEY" (resolved from env)
 *   models: wide selection (anthropic/claude-*, openai/gpt-*, etc.)
 *
 * ============================================================================
 */

import { BaseAPIProvider } from './Provider';
import type {
  ProviderConfig,
  ProviderHealth,
  ProviderName,
  ChatCompletionResponse,
} from '../types';

export class OpenRouterProvider extends BaseAPIProvider {
  readonly name: ProviderName = 'openrouter';
  readonly supportsToolCalling = true;
  readonly supportsStreaming = true;
  maxContextWindow = 128000;  // Model-dependent, but OpenRouter typically supports large contexts

  constructor() {
    super();
    this.baseUrl = 'https://openrouter.ai/api';
  }

  async initialize(config: ProviderConfig): Promise<void> {
    await super.initialize(config);
    this.baseUrl = config.baseUrl || 'https://openrouter.ai/api';
    if (config.maxContextWindow) {
      this.maxContextWindow = config.maxContextWindow;
    }
  }

  protected buildHeaders(): Record<string, string> {
    const headers = super.buildHeaders();
    // OpenRouter recommends these headers for ranking/analytics
    headers['HTTP-Referer'] = 'https://pai.local';
    headers['X-Title'] = 'PAI Shell';
    return headers;
  }

  /**
   * OpenRouter's model listing endpoint
   */
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
      if (!this.apiKey) {
        return {
          name: this.name,
          available: false,
          error: 'No OPENROUTER_API_KEY configured',
          lastChecked: Date.now(),
        };
      }
      // Quick model list check to verify API key works
      const response = await fetch(`${this.baseUrl}/v1/models`, {
        headers: this.buildHeaders(),
        signal: AbortSignal.timeout(10000),
      });
      return {
        name: this.name,
        available: response.ok,
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

  /**
   * Extract cost information from OpenRouter's response headers
   */
  protected transformResponse(raw: unknown): ChatCompletionResponse {
    const response = raw as ChatCompletionResponse;
    return response;
  }
}
