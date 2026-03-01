# PAI-OSS — Provider-Agnostic Personal AI Infrastructure

> Fork of PAI v4.0.1 that replaces Claude Code with an open, provider-agnostic orchestration layer.

## What Changed

PAI-OSS replaces Claude Code's closed-source agent loop with **PAI Shell** — a Bun-powered agentic CLI that routes through any LLM provider while preserving PAI's full infrastructure (Algorithm, Skills, Hooks, Agents, Memory).

### Architecture

```
┌─────────────────────────────────────────────────┐
│                  PAI Shell                       │
│  (Agentic REPL with tool execution loop)         │
├─────────────────────────────────────────────────┤
│              Model Router                        │
│  Tier routing: fast → standard → smart           │
│  Fallback chains, health checks, usage tracking  │
├────────────┬────────────┬───────────────────────┤
│  API       │  API       │  CLI Agent             │
│  Providers │  Providers │  Providers             │
├────────────┼────────────┼───────────────────────┤
│  Ollama    │  OpenRouter│  Claude Code           │
│  llama.cpp │  OpenAI    │  Codex                 │
│  Custom    │  Anthropic │  Gemini CLI            │
│            │            │  Aider                 │
└────────────┴────────────┴───────────────────────┘
```

### Two-Layer Provider System

**API Providers** — HTTP endpoints using OpenAI Chat Completions format:
- **Ollama** — Local models at `localhost:11434`
- **llama.cpp** — Local models at `localhost:8080`
- **OpenRouter** — 100+ models via API
- **OpenAI** — GPT-4o, o3, etc.
- **Anthropic** — Claude models (with format translation)
- **Custom** — Any OpenAI-compatible server (vLLM, LM Studio, Groq, Together, etc.)

**CLI Agent Providers** — Subprocess delegation:
- **Claude Code** — Anthropic's coding agent
- **Codex** — OpenAI's coding agent
- **Gemini CLI** — Google's CLI agent
- **Aider** — Open-source AI pair programmer

### Tier System (replaces Haiku/Sonnet/Opus)

| Tier | Purpose | Default |
|------|---------|---------|
| `fast` | Quick tasks, classification | Qwen3-8B on Ollama |
| `standard` | Balanced reasoning, most work | Qwen3-Coder-30B on Ollama |
| `smart` | Deep reasoning, complex analysis | DeepSeek-R1-32B on Ollama |
| `reasoning` | Extended reasoning, strategic | Qwen3-8B-gemini-distill on Ollama |

Each tier has configurable fallback chains (e.g., Ollama → OpenRouter → OpenAI).

## Quick Start

```bash
# 1. Generate default settings
bun ~/.claude/PAI/Shell/pai-shell.ts --init

# 2. Edit settings to match your setup
vim ~/.claude/pai-oss-settings.json

# 3. Check provider health
bun ~/.claude/PAI/Shell/pai-shell.ts --status

# 4. Run interactively
bun ~/.claude/PAI/Shell/pai-shell.ts

# 5. Or single-shot
bun ~/.claude/PAI/Shell/pai-shell.ts -p "Analyze this codebase"
```

## File Structure

```
PAI/Shell/
├── pai-shell.ts           # Main entry point — agentic REPL
├── ModelRouter.ts         # Tier routing, fallbacks, health checks
├── types.ts               # Core type definitions (OpenAI-compatible)
├── defaults.ts            # Default provider/routing configuration
├── providers/
│   ├── Provider.ts        # Abstract interface + BaseAPIProvider + BaseCLIAgentProvider
│   ├── OllamaProvider.ts
│   ├── LlamaCppProvider.ts
│   ├── OpenRouterProvider.ts
│   ├── OpenAIProvider.ts
│   ├── AnthropicProvider.ts
│   ├── GenericOpenAIProvider.ts
│   ├── ClaudeCodeProvider.ts
│   ├── CodexProvider.ts
│   ├── GeminiCLIProvider.ts
│   ├── AiderProvider.ts
│   └── index.ts           # Provider registry
├── tools/
│   ├── index.ts           # Tool registry
│   ├── file-tools.ts      # read_file, write_file, list_directory, glob_search, file_info
│   ├── code-tools.ts      # replace_in_file, multi_replace, insert_at_line
│   ├── terminal-tools.ts  # run_command, run_background (with security validator)
│   ├── search-tools.ts    # grep_search, find_files
│   └── agent-tools.ts     # ask_user, web_fetch, delegate_to_agent, todo_write, think
└── lib/                   # Shared utilities (future)

PAI/Tools/
├── Inference.ts           # Unified inference (routes through ModelRouter)
└── Inference.ts.original  # Original Claude CLI-based version (backup)
```

## Configuration

Settings are loaded from `~/.claude/pai-oss-settings.json` (preferred) or `~/.claude/settings.json`.

```jsonc
{
  "providers": {
    "ollama": {
      "enabled": true,
      "type": "api",
      "baseUrl": "http://localhost:11434",
      "supportsToolCalling": true,
      "toolCallingStrategy": "native"
    },
    "openrouter": {
      "enabled": true,
      "type": "api",
      "apiKey": "$OPENROUTER_API_KEY",
      "supportsToolCalling": true
    }
  },
  "modelRouting": {
    "fast": {
      "primary": { "provider": "ollama", "model": "qwen3:8b" },
      "fallback": [{ "provider": "openrouter", "model": "qwen/qwen3-8b" }]
    },
    "standard": {
      "primary": { "provider": "ollama", "model": "qwen3-coder:30b-a3b" },
      "fallback": [{ "provider": "openrouter", "model": "deepseek/deepseek-chat-v3" }]
    }
  }
}
```

## Tool Calling

PAI Shell supports three tool calling strategies:

1. **Native** — Model supports OpenAI `tools` parameter (Qwen3, DeepSeek, etc.)
2. **Prompt-based** — Tool schemas injected into system prompt, JSON parsed from output
3. **Hybrid** — Try native first, fall back to prompt-based

Configure per-provider via `toolCallingStrategy` in settings.

## What's Preserved from PAI v4.0.1

- **Algorithm** — The continuously upgrading execution framework
- **Skills** — All 30+ skills (Research, Security, Media, etc.)
- **Hooks** — Event-driven automation (adapted for PAI Shell)
- **Agents** — Custom agent composition and delegation
- **Memory** — Session history, work logs, learning patterns
- **TELOS** — Life OS and project tracking
- **Inference.ts** — Same public API, now routes through ModelRouter
