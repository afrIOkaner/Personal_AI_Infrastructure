/**
 * ============================================================================
 * OpenAI Provider
 * ============================================================================
 *
 * Connects to the OpenAI API (api.openai.com).
 * Standard OpenAI-compatible endpoint — this is the reference implementation
 * since the format is literally OpenAI's own.
 *
 * Supports: tool calling, streaming, structured output, model listing.
 *
 * Configuration:
 *   apiKey: "$OPENAI_API_KEY" (resolved from env)
 *
 * ============================================================================
 */

import { BaseAPIProvider } from './Provider';
import type {
  ProviderConfig,
  ProviderHealth,
  ProviderName,
} from '../types';

export class OpenAIProvider extends BaseAPIProvider {
  readonly name: ProviderName = 'openai';
  readonly supportsToolCalling = true;
  readonly supportsStreaming = true;
  maxContextWindow = 128000;

  constructor() {
    super();
    this.baseUrl = 'https://api.openai.com';
  }

  async initialize(config: ProviderConfig): Promise<void> {
    await super.initialize(config);
    this.baseUrl = config.baseUrl || 'https://api.openai.com';
    if (config.maxContextWindow) {
      this.maxContextWindow = config.maxContextWindow;
    }
  }

  async healthCheck(): Promise<ProviderHealth> {
    const start = Date.now();
    try {
      if (!this.apiKey) {
        return {
          name: this.name,
          available: false,
          error: 'No OPENAI_API_KEY configured',
          lastChecked: Date.now(),
        };
      }
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
}
