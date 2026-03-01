/**
 * ============================================================================
 * Default Provider Configuration
 * ============================================================================
 *
 * Default settings for PAI-OSS providers and model routing.
 * This is used when no configuration exists in settings.json,
 * and as a template for `pai-shell init`.
 *
 * The default configuration prioritizes local models (Ollama/llama.cpp)
 * with OpenRouter as the fallback for commercial model access.
 *
 * ============================================================================
 */

import type { PAIOSSSettings } from './types';

export const DEFAULT_SETTINGS: PAIOSSSettings = {
  providers: {
    // ─── Local Providers (Primary) ──────────────────────────────
    ollama: {
      enabled: true,
      type: 'api',
      baseUrl: 'http://localhost:11434',
      maxContextWindow: 32768,
      supportsToolCalling: true,
      supportsStreaming: true,
      toolCallingStrategy: 'native',
    },
    llamacpp: {
      enabled: true,
      type: 'api',
      baseUrl: 'http://localhost:8080',
      maxContextWindow: 32768,
      supportsToolCalling: true,
      supportsStreaming: true,
      toolCallingStrategy: 'native',
    },

    // ─── Commercial API Providers (Fallback) ────────────────────
    openrouter: {
      enabled: false,
      type: 'api',
      apiKey: '$OPENROUTER_API_KEY',
      maxContextWindow: 128000,
      supportsToolCalling: true,
      supportsStreaming: true,
      toolCallingStrategy: 'native',
    },
    openai: {
      enabled: false,
      type: 'api',
      apiKey: '$OPENAI_API_KEY',
      maxContextWindow: 128000,
      supportsToolCalling: true,
      supportsStreaming: true,
      toolCallingStrategy: 'native',
    },
    anthropic: {
      enabled: false,
      type: 'api',
      apiKey: '$ANTHROPIC_API_KEY',
      maxContextWindow: 200000,
      supportsToolCalling: true,
      supportsStreaming: true,
      toolCallingStrategy: 'native',
    },
    custom: {
      enabled: false,
      type: 'api',
      baseUrl: 'http://localhost:8000',
      maxContextWindow: 32768,
      supportsToolCalling: false,
      supportsStreaming: true,
      toolCallingStrategy: 'prompt-based',
    },

    // ─── CLI Agent Providers ────────────────────────────────────
    'claude-code': {
      enabled: false,
      type: 'cli-agent',
      binary: 'claude',
      maxContextWindow: 200000,
      supportsToolCalling: false,
      supportsStreaming: false,
    },
    codex: {
      enabled: false,
      type: 'cli-agent',
      binary: 'codex',
      maxContextWindow: 128000,
      supportsToolCalling: false,
      supportsStreaming: false,
    },
    'gemini-cli': {
      enabled: false,
      type: 'cli-agent',
      binary: 'gemini',
      maxContextWindow: 1000000,
      supportsToolCalling: false,
      supportsStreaming: false,
    },
    aider: {
      enabled: false,
      type: 'cli-agent',
      binary: 'aider',
      maxContextWindow: 128000,
      supportsToolCalling: false,
      supportsStreaming: false,
    },
  },

  modelRouting: {
    // ─── Fast Tier ──────────────────────────────────────────────
    // For: hooks, auto-naming, ratings, quick lookups, classification
    // Target: <2s latency, fits in 6GB VRAM
    fast: {
      primary: {
        provider: 'ollama',
        model: 'Qwen3-8B-Q4_K_M',
      },
      fallback: [
        { provider: 'llamacpp', model: 'Qwen3-4B-Q8_0' },
        { provider: 'openrouter', model: 'meta-llama/llama-3.1-8b-instruct' },
      ],
    },

    // ─── Standard Tier ──────────────────────────────────────────
    // For: coding, tool use, general tasks, agent work
    // Target: <10s latency, best tool-calling reliability
    standard: {
      primary: {
        provider: 'ollama',
        model: 'Qwen3-Coder-30B-A3B-Instruct-Q5_K_M',
      },
      fallback: [
        { provider: 'llamacpp', model: 'Qwen3-Coder-30B-A3B-Instruct-Q5_K_M' },
        { provider: 'openrouter', model: 'qwen/qwen-2.5-coder-32b-instruct' },
      ],
    },

    // ─── Smart Tier ─────────────────────────────────────────────
    // For: complex reasoning, architecture, Algorithm work
    // Target: quality over speed, deep chain-of-thought
    smart: {
      primary: {
        provider: 'ollama',
        model: 'deepseek-r1-32b',
      },
      fallback: [
        { provider: 'llamacpp', model: 'deepseek-r1-32b' },
        { provider: 'openrouter', model: 'deepseek/deepseek-r1' },
      ],
    },

    // ─── Reasoning Tier ─────────────────────────────────────────
    // For: enhanced reasoning when smart tier is too slow
    // Target: faster than R1-32B, fits in GPU
    reasoning: {
      primary: {
        provider: 'ollama',
        model: 'Qwen3-8B-gemini-3-pro-preview-high-reasoning-distill-Q4_K_M',
      },
      fallback: [
        { provider: 'ollama', model: 'deepseek-r1-32b' },
        { provider: 'openrouter', model: 'deepseek/deepseek-r1' },
      ],
    },
  },

  cliAgentRouting: {
    delegation: undefined,       // Use PAI Shell by default
    codeEditing: undefined,      // Use PAI Shell by default
    research: undefined,         // Use PAI Shell by default
  },
};
