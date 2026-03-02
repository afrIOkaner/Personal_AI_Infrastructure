/**
 * ============================================================================
 * llama.cpp Provider
 * ============================================================================
 *
 * Connects to a llama.cpp server instance at localhost:8080.
 * llama.cpp's --api-oai mode exposes an OpenAI-compatible endpoint.
 *
 * Supports: tool calling (model-dependent), streaming, model info.
 *
 * Configuration:
 *   baseUrl: "http://localhost:8080" (default)
 *
 * Note: llama.cpp typically serves one model at a time. The "model" field
 * in requests is mostly informational — the server uses whatever model
 * was loaded at startup.
 *
 * ============================================================================
 */

import { BaseAPIProvider } from './Provider';
import type {
  ProviderConfig,
  ProviderHealth,
  ProviderName,
} from '../types';

export class LlamaCppProvider extends BaseAPIProvider {
  readonly name: ProviderName = 'llamacpp';
  readonly supportsToolCalling = true;
  readonly supportsStreaming = true;
  maxContextWindow = 32768;  // Depends on model and launch args

  constructor() {
    super();
    this.baseUrl = 'http://localhost:8080';
  }

  async initialize(config: ProviderConfig): Promise<void> {
    await super.initialize(config);
    if (!this.baseUrl) {
      this.baseUrl = 'http://localhost:8080';
    }
    if (config.maxContextWindow) {
      this.maxContextWindow = config.maxContextWindow;
    }
  }

  /**
   * llama.cpp server has a /health endpoint
   */
  async healthCheck(): Promise<ProviderHealth> {
    const start = Date.now();
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) {
        return {
          name: this.name,
          available: false,
          error: `llama.cpp returned status ${response.status}`,
          lastChecked: Date.now(),
        };
      }
      const health = await response.json() as { status?: string; model?: string };
      return {
        name: this.name,
        available: health.status === 'ok' || health.status === 'no slot available',
        latencyMs: Date.now() - start,
        modelsLoaded: health.model ? [health.model] : [],
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
   * llama.cpp /v1/models returns the currently loaded model
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
}
