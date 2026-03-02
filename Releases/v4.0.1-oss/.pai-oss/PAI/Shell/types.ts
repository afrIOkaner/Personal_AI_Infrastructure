/**
 * ============================================================================
 * PAI Shell — Core Type Definitions
 * ============================================================================
 *
 * Universal types for the provider-agnostic PAI orchestration layer.
 * All types follow the OpenAI Chat Completions API format as the de facto
 * standard, since Ollama, llama.cpp, vLLM, LM Studio, OpenRouter, and
 * OpenAI all implement this protocol.
 *
 * ============================================================================
 */

// ─── Inference Tiers ────────────────────────────────────────────────────────

export type InferenceTier = 'fast' | 'standard' | 'smart' | 'reasoning';

// ─── Provider Types ─────────────────────────────────────────────────────────

export type ProviderType = 'api' | 'cli-agent';

export type ProviderName =
  // API providers (OpenAI-compatible)
  | 'ollama'
  | 'llamacpp'
  | 'openrouter'
  | 'openai'
  | 'anthropic'
  | 'custom'
  // CLI agent providers
  | 'claude-code'
  | 'codex'
  | 'gemini-cli'
  | 'aider';

// ─── OpenAI-Compatible Message Types ────────────────────────────────────────

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;  // Only for role: 'tool'
  name?: string;          // Optional function name for tool results
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;  // JSON string
  };
}

// ─── Tool / Function Definitions ────────────────────────────────────────────

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: JsonSchema;
    strict?: boolean;
  };
}

export interface JsonSchema {
  type: string;
  properties?: Record<string, JsonSchema & { description?: string; enum?: string[] }>;
  required?: string[];
  items?: JsonSchema;
  description?: string;
  enum?: string[];
  additionalProperties?: boolean;
  default?: unknown;
}

// ─── Chat Completion Request ────────────────────────────────────────────────

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  tool_choice?: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } };
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  stream?: boolean;
  stop?: string | string[];
  response_format?: { type: 'text' | 'json_object' };
}

// ─── Chat Completion Response ───────────────────────────────────────────────

export interface ChatCompletionResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: ChatCompletionChoice[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  // PAI extensions
  _provider?: ProviderName;
  _tier?: InferenceTier;
  _latencyMs?: number;
}

export interface ChatCompletionChoice {
  index: number;
  message: ChatMessage;
  finish_reason: 'stop' | 'tool_calls' | 'length' | 'content_filter' | null;
}

// ─── Streaming Types ────────────────────────────────────────────────────────

export interface ChatCompletionChunk {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: ChatCompletionChunkChoice[];
}

export interface ChatCompletionChunkChoice {
  index: number;
  delta: Partial<ChatMessage>;
  finish_reason: 'stop' | 'tool_calls' | 'length' | 'content_filter' | null;
}

// ─── Provider Configuration ─────────────────────────────────────────────────

export interface ProviderConfig {
  enabled: boolean;
  type: ProviderType;
  baseUrl?: string;
  apiKey?: string;           // Can reference env vars like "$OPENROUTER_API_KEY"
  binary?: string;           // For CLI agents: path to binary
  models?: string[];         // Available models for this provider
  defaultModel?: string;     // Default model when none specified
  maxContextWindow?: number; // Max tokens the provider/model supports
  supportsToolCalling?: boolean;
  supportsStreaming?: boolean;
  toolCallingStrategy?: ToolCallingStrategy;
  customHeaders?: Record<string, string>;
  timeout?: number;          // Request timeout in ms
}

export type ToolCallingStrategy = 'native' | 'prompt-based' | 'hybrid';

// ─── Model Routing Configuration ────────────────────────────────────────────

export interface TierRoute {
  provider: ProviderName;
  model: string;
}

export interface TierConfig {
  primary: TierRoute;
  fallback?: TierRoute[];
}

export interface ModelRoutingConfig {
  fast: TierConfig;
  standard: TierConfig;
  smart: TierConfig;
  reasoning?: TierConfig;
}

export interface CLIAgentRoutingConfig {
  delegation?: ProviderName;    // For Task tool spawns
  codeEditing?: ProviderName;   // For code editing tasks
  research?: ProviderName;      // For research tasks
}

// ─── Settings Schema (PAI-OSS extensions) ───────────────────────────────────

export interface PAIOSSSettings {
  providers: Record<ProviderName, ProviderConfig>;
  modelRouting: ModelRoutingConfig;
  cliAgentRouting?: CLIAgentRoutingConfig;
}

// ─── Provider Health ────────────────────────────────────────────────────────

export interface ProviderHealth {
  name: ProviderName;
  available: boolean;
  latencyMs?: number;
  modelsLoaded?: string[];
  error?: string;
  lastChecked: number;
}

// ─── Usage Tracking ─────────────────────────────────────────────────────────

export interface UsageRecord {
  timestamp: number;
  provider: ProviderName;
  model: string;
  tier: InferenceTier;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  latencyMs: number;
  costUsd?: number;  // null for local providers
  success: boolean;
  error?: string;
}

// ─── PAI Shell Session ──────────────────────────────────────────────────────

export interface ShellSession {
  id: string;
  startedAt: number;
  messages: ChatMessage[];
  systemPrompt: string;
  tier: InferenceTier;
  provider?: ProviderName;
  model?: string;
  tokenCount: number;
  maxTokens: number;
}

// ─── Tool Execution ─────────────────────────────────────────────────────────

export interface ToolExecutionResult {
  toolCallId: string;
  name: string;
  result: string;
  success: boolean;
  durationMs: number;
}

export interface ToolHandler {
  definition: ToolDefinition;
  execute: (args: Record<string, unknown>) => Promise<string>;
}
