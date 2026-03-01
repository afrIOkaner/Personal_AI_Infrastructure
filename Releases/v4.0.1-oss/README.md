<div align="center">

# PAI v4.0.1-OSS — Provider-Agnostic Personal AI Infrastructure

**Full fork of PAI v4.0.1 replacing Claude Code with an open, provider-agnostic orchestration layer.**

[![Providers](https://img.shields.io/badge/Providers-10-22C55E?style=flat)](.claude/PAI/Shell/providers/)
[![Tools](https://img.shields.io/badge/Tools-14-3B82F6?style=flat)](.claude/PAI/Shell/tools/)
[![Lines](https://img.shields.io/badge/New_TS-4%2C479_lines-F97316?style=flat)](.claude/PAI/Shell/)
[![Skills](https://img.shields.io/badge/Skills-63-8B5CF6?style=flat)](.claude/skills/)
[![Hooks](https://img.shields.io/badge/Hooks-21-10B981?style=flat)](.claude/hooks/)
[![Algorithm](https://img.shields.io/badge/Algorithm-v3.6.0-D97706?style=flat)](.claude/PAI/Algorithm/)

</div>

---

## What Is This?

PAI-OSS replaces Claude Code's closed-source agent loop with **PAI Shell** — a Bun-powered agentic CLI that routes through any LLM provider while preserving PAI's full infrastructure (Algorithm, Skills, Hooks, Agents, Memory, TELOS).

> For the complete architecture, configuration reference, and file structure, see **[PAI-OSS-README.md](PAI-OSS-README.md)**.

---

## What Changed (from v4.0.1)

### PAI Shell — New Provider-Agnostic Orchestration Layer

A complete agentic CLI with an interactive REPL, single-shot `--print` mode, and a tool execution loop that gives the model filesystem access, code editing, terminal execution, search, and agent delegation — all routed through any configured LLM provider.

### ModelRouter — Tier-Based Routing Engine

Resolves inference tiers (`fast` / `standard` / `smart` / `reasoning`) to specific provider + model combinations with fallback chains, health checks, and usage tracking. Replaces hard-coded Haiku/Sonnet/Opus references.

### 10 Providers (6 API + 4 CLI Agent)

| Type | Provider | Description |
|------|----------|-------------|
| API | **Ollama** | Local models at `localhost:11434` |
| API | **llama.cpp** | Local models at `localhost:8080` |
| API | **OpenRouter** | 100+ commercial models via API |
| API | **OpenAI** | GPT-4o, o3, etc. |
| API | **Anthropic** | Claude models (with format translation) |
| API | **Generic OpenAI** | Any OpenAI-compatible server (vLLM, LM Studio, Groq, Together, etc.) |
| CLI Agent | **Claude Code** | Anthropic's coding agent |
| CLI Agent | **Codex** | OpenAI's coding agent |
| CLI Agent | **Gemini CLI** | Google's CLI agent |
| CLI Agent | **Aider** | Open-source AI pair programmer |

### 14 Tools

| Category | Tools |
|----------|-------|
| File | `read_file`, `write_file`, `list_directory`, `glob_search`, `file_info` |
| Code | `replace_in_file`, `multi_replace`, `insert_at_line` |
| Terminal | `run_command`, `run_background` |
| Search | `grep_search`, `find_files` |
| Agent | `ask_user`, `web_fetch`, `delegate_to_agent`, `todo_write`, `think` |

### Tool Calling Strategies

Three strategies to handle models with and without native function calling:
- **Native** — model supports OpenAI `tools` parameter
- **Prompt-based** — tool schemas injected into system prompt, JSON parsed from output
- **Hybrid** — try native first, fall back to prompt-based

### Provider-Agnostic Inference.ts

Same public API (`InferenceLevel`, `InferenceOptions`, `InferenceResult`, `inference()`), now routes through ModelRouter instead of spawning `claude --print`. All existing hooks and tools that call `Inference.ts` work without changes.

### Default Configuration

Local-first: Ollama and llama.cpp enabled by default. Commercial APIs (OpenRouter, OpenAI, Anthropic) disabled by default. Each tier has configurable fallback chains.

---

## Files Changed (from v4.0.1)

| Path | Change |
|------|--------|
| `PAI/Shell/pai-shell.ts` | **New** — Agentic REPL entry point (696 lines) |
| `PAI/Shell/ModelRouter.ts` | **New** — Tier routing engine (507 lines) |
| `PAI/Shell/types.ts` | **New** — Core type definitions (241 lines) |
| `PAI/Shell/defaults.ts` | **New** — Default provider/routing config (176 lines) |
| `PAI/Shell/providers/Provider.ts` | **New** — Abstract interface + base classes (378 lines) |
| `PAI/Shell/providers/*.ts` | **New** — 10 provider implementations + registry |
| `PAI/Shell/tools/*.ts` | **New** — 14 tool definitions + handlers + registry |
| `PAI/Tools/Inference.ts` | **Replaced** — Routes through ModelRouter (same public API) |
| `PAI/Tools/Inference.ts.original` | **Backup** — Original Claude CLI-based version |
| `PAI-OSS-README.md` | **New** — Full architecture & configuration reference |

---

## What's Preserved from v4.0.1

Everything outside `PAI/Shell/` and `PAI/Tools/Inference.ts` is unchanged:

- **Algorithm v3.6.0** — The continuously upgrading execution framework
- **63 Skills** across 13 categories — Research, Security, Media, Thinking, etc.
- **21 Hooks** — Event-driven automation (session lifecycle, voice, history)
- **Agent System** — Custom agent composition, delegation, parallel execution
- **Memory System** — Session history, work logs, learning patterns
- **TELOS** — Life OS, goals, projects, beliefs
- **338 Workflows** — All skill workflows intact
- **v4.0.1 Patch Fixes** — Upgrade path, temperature units, statusline fixes, spinner tips sync

---

## Quick Start

```bash
# 1. Generate default settings
bun ~/.claude/PAI/Shell/pai-shell.ts --init

# 2. Edit provider settings
vim ~/.claude/pai-oss-settings.json

# 3. Check provider health
bun ~/.claude/PAI/Shell/pai-shell.ts --status

# 4. Run interactively
bun ~/.claude/PAI/Shell/pai-shell.ts

# 5. Or single-shot mode
bun ~/.claude/PAI/Shell/pai-shell.ts -p "Analyze this codebase"
```

---

## Base Version

This release includes all changes from [PAI v4.0.1](../v4.0.1/README.md) (upgrade path improvements, temperature unit preferences, statusline fixes, spinner tips sync, FAQ fixes).
