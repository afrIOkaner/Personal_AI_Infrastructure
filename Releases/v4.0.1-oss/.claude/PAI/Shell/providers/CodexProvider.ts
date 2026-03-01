/**
 * ============================================================================
 * OpenAI Codex CLI Agent Provider
 * ============================================================================
 *
 * Spawns the `codex` CLI binary (OpenAI's agentic coding tool) as a
 * subprocess. Uses --quiet and --approval-mode full-auto for
 * non-interactive operation.
 *
 * Codex excels at code editing and repository-level tasks.
 * Best delegated to for complex multi-file refactoring work.
 *
 * ============================================================================
 */

import { BaseCLIAgentProvider } from './Provider';
import type {
  ProviderConfig,
  ProviderName,
  ChatCompletionRequest,
  ChatCompletionResponse,
} from '../types';

export class CodexProvider extends BaseCLIAgentProvider {
  readonly name: ProviderName = 'codex';
  readonly supportsToolCalling = false;
  readonly supportsStreaming = false;
  maxContextWindow = 128000;

  constructor() {
    super();
    this.binary = 'codex';
    this.timeout = 300000;  // Codex tasks can take a while
  }

  async initialize(config: ProviderConfig): Promise<void> {
    await super.initialize(config);
    if (!this.binary) {
      this.binary = 'codex';
    }
  }

  protected buildArgs(request: ChatCompletionRequest): string[] {
    const args = [
      '--quiet',
      '--approval-mode', 'full-auto',
    ];

    // Add model if specified and not a tier name
    if (request.model && !['fast', 'standard', 'smart', 'reasoning'].includes(request.model)) {
      args.push('--model', request.model);
    }

    // Extract the last user message as the prompt
    const lastUserMsg = [...request.messages].reverse().find(m => m.role === 'user');
    if (lastUserMsg?.content) {
      args.push(lastUserMsg.content);
    }

    return args;
  }

  protected parseOutput(stdout: string, stderr: string, exitCode: number): ChatCompletionResponse {
    const content = stdout.trim();

    return {
      id: `codex-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: 'codex',
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: exitCode !== 0
            ? `Error (exit ${exitCode}): ${stderr || content}`
            : content,
        },
        finish_reason: 'stop',
      }],
    };
  }
}
