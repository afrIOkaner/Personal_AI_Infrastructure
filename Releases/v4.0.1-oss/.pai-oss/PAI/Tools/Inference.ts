#!/usr/bin/env bun
/**
 * ============================================================================
 * INFERENCE - Unified inference tool with three run levels (PAI-OSS)
 * ============================================================================
 *
 * PURPOSE:
 * Single inference tool with configurable speed/capability trade-offs.
 * Routes through ModelRouter to any configured provider (local or API).
 *
 * Replaces the original Claude CLI-based Inference.ts with a
 * provider-agnostic version that preserves the same public interface.
 *
 * USAGE:
 *   bun Inference.ts --level fast <system_prompt> <user_prompt>
 *   bun Inference.ts --level standard <system_prompt> <user_prompt>
 *   bun Inference.ts --level smart <system_prompt> <user_prompt>
 *   bun Inference.ts --json --level fast <system_prompt> <user_prompt>
 *
 * OPTIONS:
 *   --level <fast|standard|smart>  Run level (default: standard)
 *   --json                         Expect and parse JSON response
 *   --timeout <ms>                 Custom timeout (default varies by level)
 *
 * DEFAULTS BY LEVEL:
 *   fast:     timeout=15s
 *   standard: timeout=30s
 *   smart:    timeout=90s
 *
 * ============================================================================
 */

import { ModelRouter } from '../Shell/ModelRouter';
import { DEFAULT_SETTINGS } from '../Shell/defaults';
import type { InferenceTier, PAIOSSSettings, ChatMessage } from '../Shell/types';

// ─── Public Types (preserved from original) ─────────────────────────────────

export type InferenceLevel = 'fast' | 'standard' | 'smart';

export interface InferenceOptions {
  systemPrompt: string;
  userPrompt: string;
  level?: InferenceLevel;
  expectJson?: boolean;
  timeout?: number;
}

export interface InferenceResult {
  success: boolean;
  output: string;
  parsed?: unknown;
  error?: string;
  latencyMs: number;
  level: InferenceLevel;
}

// ─── Level Configuration ────────────────────────────────────────────────────

const LEVEL_CONFIG: Record<InferenceLevel, { defaultTimeout: number }> = {
  fast: { defaultTimeout: 15000 },
  standard: { defaultTimeout: 30000 },
  smart: { defaultTimeout: 90000 },
};

// ─── Singleton Router ───────────────────────────────────────────────────────

let _router: ModelRouter | null = null;

async function getRouter(): Promise<ModelRouter> {
  if (_router) return _router;

  _router = new ModelRouter();

  // Try to load settings from settings.json, fall back to defaults
  let settings: PAIOSSSettings = DEFAULT_SETTINGS;
  const settingsPaths = [
    `${process.env.PAI_DIR || `${process.env.HOME}/.pai-oss`}/settings.json`,
  ];

  for (const path of settingsPaths) {
    try {
      const raw = await Bun.file(path).text();
      const parsed = JSON.parse(raw);
      if (parsed.providers && parsed.modelRouting) {
        settings = {
          providers: parsed.providers,
          modelRouting: parsed.modelRouting,
          cliAgentRouting: parsed.cliAgentRouting,
        };
        break;
      }
    } catch {
      // Settings file doesn't exist or doesn't have OSS config — use defaults
    }
  }

  await _router.initialize(settings);
  return _router;
}

// ─── Main Inference Function ────────────────────────────────────────────────

/**
 * Run inference with configurable level.
 * Drop-in replacement for the original Claude CLI-based inference.
 */
export async function inference(options: InferenceOptions): Promise<InferenceResult> {
  const level = options.level || 'standard';
  const config = LEVEL_CONFIG[level];
  const startTime = Date.now();
  const timeout = options.timeout || config.defaultTimeout;

  try {
    const router = await getRouter();

    // Build messages
    const messages: ChatMessage[] = [
      { role: 'system', content: options.systemPrompt },
      { role: 'user', content: options.userPrompt },
    ];

    // Create a timeout race
    const completionPromise = router.complete(
      level as InferenceTier,
      messages,
      undefined,
      {
        model: '',
        messages: [],
        response_format: options.expectJson ? { type: 'json_object' } : undefined,
      }
    );

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`Timeout after ${timeout}ms`)), timeout);
    });

    const response = await Promise.race([completionPromise, timeoutPromise]);
    const output = response.choices[0]?.message?.content?.trim() || '';
    const latencyMs = Date.now() - startTime;

    // Parse JSON if requested
    if (options.expectJson) {
      const jsonMatch = output.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          return { success: true, output, parsed, latencyMs, level };
        } catch {
          return { success: false, output, error: 'Failed to parse JSON response', latencyMs, level };
        }
      }
      return { success: false, output, error: 'No JSON found in response', latencyMs, level };
    }

    return { success: true, output, latencyMs, level };
  } catch (err) {
    return {
      success: false,
      output: '',
      error: err instanceof Error ? err.message : String(err),
      latencyMs: Date.now() - startTime,
      level,
    };
  }
}

// ─── CLI Entry Point ────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  // Parse flags
  let expectJson = false;
  let timeout: number | undefined;
  let level: InferenceLevel = 'standard';
  const positionalArgs: string[] = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--json') {
      expectJson = true;
    } else if (args[i] === '--level' && args[i + 1]) {
      const requestedLevel = args[i + 1].toLowerCase();
      if (['fast', 'standard', 'smart'].includes(requestedLevel)) {
        level = requestedLevel as InferenceLevel;
      } else {
        console.error(`Invalid level: ${args[i + 1]}. Use fast, standard, or smart.`);
        process.exit(1);
      }
      i++;
    } else if (args[i] === '--timeout' && args[i + 1]) {
      timeout = parseInt(args[i + 1], 10);
      i++;
    } else {
      positionalArgs.push(args[i]);
    }
  }

  if (positionalArgs.length < 2) {
    console.error('Usage: bun Inference.ts [--level fast|standard|smart] [--json] [--timeout <ms>] <system_prompt> <user_prompt>');
    process.exit(1);
  }

  const [systemPrompt, userPrompt] = positionalArgs;

  const result = await inference({
    systemPrompt,
    userPrompt,
    level,
    expectJson,
    timeout,
  });

  if (result.success) {
    if (expectJson && result.parsed) {
      console.log(JSON.stringify(result.parsed));
    } else {
      console.log(result.output);
    }
  } else {
    console.error(`Error: ${result.error}`);
    process.exit(1);
  }
}

// Run if executed directly
if (import.meta.main) {
  main().catch(console.error);
}
