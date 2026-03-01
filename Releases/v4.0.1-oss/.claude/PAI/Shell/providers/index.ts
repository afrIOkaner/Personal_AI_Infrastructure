/**
 * ============================================================================
 * Provider Registry
 * ============================================================================
 *
 * Central registry that maps provider names to their implementations.
 * Used by ModelRouter to instantiate and manage providers.
 *
 * ============================================================================
 */

export { type Provider, BaseAPIProvider, BaseCLIAgentProvider } from './Provider';
export { OllamaProvider } from './OllamaProvider';
export { LlamaCppProvider } from './LlamaCppProvider';
export { OpenRouterProvider } from './OpenRouterProvider';
export { OpenAIProvider } from './OpenAIProvider';
export { AnthropicProvider } from './AnthropicProvider';
export { GenericOpenAIProvider } from './GenericOpenAIProvider';
export { ClaudeCodeProvider } from './ClaudeCodeProvider';
export { CodexProvider } from './CodexProvider';
export { GeminiCLIProvider } from './GeminiCLIProvider';
export { AiderProvider } from './AiderProvider';

import type { Provider } from './Provider';
import type { ProviderName } from '../types';
import { OllamaProvider } from './OllamaProvider';
import { LlamaCppProvider } from './LlamaCppProvider';
import { OpenRouterProvider } from './OpenRouterProvider';
import { OpenAIProvider } from './OpenAIProvider';
import { AnthropicProvider } from './AnthropicProvider';
import { GenericOpenAIProvider } from './GenericOpenAIProvider';
import { ClaudeCodeProvider } from './ClaudeCodeProvider';
import { CodexProvider } from './CodexProvider';
import { GeminiCLIProvider } from './GeminiCLIProvider';
import { AiderProvider } from './AiderProvider';

/**
 * Create a new provider instance by name.
 */
export function createProvider(name: ProviderName): Provider {
  switch (name) {
    case 'ollama':      return new OllamaProvider();
    case 'llamacpp':    return new LlamaCppProvider();
    case 'openrouter':  return new OpenRouterProvider();
    case 'openai':      return new OpenAIProvider();
    case 'anthropic':   return new AnthropicProvider();
    case 'custom':      return new GenericOpenAIProvider();
    case 'claude-code': return new ClaudeCodeProvider();
    case 'codex':       return new CodexProvider();
    case 'gemini-cli':  return new GeminiCLIProvider();
    case 'aider':       return new AiderProvider();
    default:
      throw new Error(`Unknown provider: ${name}`);
  }
}

/**
 * All known provider names.
 */
export const ALL_PROVIDERS: ProviderName[] = [
  'ollama', 'llamacpp', 'openrouter', 'openai', 'anthropic', 'custom',
  'claude-code', 'codex', 'gemini-cli', 'aider',
];
