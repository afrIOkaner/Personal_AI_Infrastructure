/**
 * ============================================================================
 * Aider CLI Agent Provider
 * ============================================================================
 *
 * Spawns the `aider` tool as a subprocess. Uses --message and --yes
 * for non-interactive operation.
 *
 * Aider excels at code editing tasks — it's model-agnostic, git-aware,
 * and produces clean diffs. Best for focused code modification tasks.
 *
 * Note: Aider handles its own model selection via --model flag.
 * It supports OpenAI, Anthropic, and local models through its own
 * model routing.
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

export class AiderProvider extends BaseCLIAgentProvider {
  readonly name: ProviderName = 'aider';
  readonly supportsToolCalling = false;
  readonly supportsStreaming = false;
  maxContextWindow = 128000;  // Model-dependent

  constructor() {
    super();
    this.binary = 'aider';
    this.timeout = 300000;  // Code editing can take a while
  }

  async initialize(config: ProviderConfig): Promise<void> {
    await super.initialize(config);
    if (!this.binary) {
      this.binary = 'aider';
    }
  }

  protected buildArgs(request: ChatCompletionRequest): string[] {
    const args = [
      '--yes',          // Auto-confirm changes
      '--no-stream',    // Cleaner output for pipe
      '--no-git',       // Let PAI handle git
    ];

    // Add model if specified
    if (request.model && !['fast', 'standard', 'smart', 'reasoning'].includes(request.model)) {
      args.push('--model', request.model);
    }

    // Extract the last user message as the prompt
    const lastUserMsg = [...request.messages].reverse().find(m => m.role === 'user');
    if (lastUserMsg?.content) {
      args.push('--message', lastUserMsg.content);
    }

    return args;
  }

  protected parseOutput(stdout: string, stderr: string, exitCode: number): ChatCompletionResponse {
    const content = stdout.trim();

    return {
      id: `aider-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: 'aider',
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
