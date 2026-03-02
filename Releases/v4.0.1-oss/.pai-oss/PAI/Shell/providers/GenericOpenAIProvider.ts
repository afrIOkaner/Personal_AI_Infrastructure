/**
 * ============================================================================
 * Generic OpenAI-Compatible Provider
 * ============================================================================
 *
 * Connects to any server that implements the OpenAI Chat Completions API.
 * This includes: vLLM, LM Studio, Together AI, Groq, Fireworks, Anyscale,
 * DeepInfra, Perplexity, Cerebras, and any custom deployment.
 *
 * Configuration:
 *   baseUrl: "http://your-server:port" (required)
 *   apiKey: optional, depends on the server
 *
 * ============================================================================
 */

import { BaseAPIProvider } from './Provider';
import type {
  ProviderConfig,
  ProviderName,
} from '../types';

export class GenericOpenAIProvider extends BaseAPIProvider {
  readonly name: ProviderName = 'custom';
  readonly supportsToolCalling: boolean = true;
  readonly supportsStreaming: boolean = true;
  maxContextWindow = 32768;

  async initialize(config: ProviderConfig): Promise<void> {
    await super.initialize(config);
    if (!this.baseUrl) {
      throw new Error('GenericOpenAIProvider requires a baseUrl in configuration');
    }
    if (config.maxContextWindow) {
      this.maxContextWindow = config.maxContextWindow;
    }
    // Allow config to override capability flags
    if (config.supportsToolCalling !== undefined) {
      (this as { supportsToolCalling: boolean }).supportsToolCalling = config.supportsToolCalling;
    }
    if (config.supportsStreaming !== undefined) {
      (this as { supportsStreaming: boolean }).supportsStreaming = config.supportsStreaming;
    }
  }
}
