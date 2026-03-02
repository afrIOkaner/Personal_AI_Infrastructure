/**
 * ============================================================================
 * Gemini CLI Agent Provider
 * ============================================================================
 *
 * Spawns the `gemini` CLI binary (Google's agentic coding tool) as a
 * subprocess. Uses --prompt for non-interactive operation.
 *
 * Gemini CLI has built-in web search and code tools.
 * Useful for research-oriented tasks.
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

export class GeminiCLIProvider extends BaseCLIAgentProvider {
  readonly name: ProviderName = 'gemini-cli';
  readonly supportsToolCalling = false;
  readonly supportsStreaming = false;
  maxContextWindow = 1000000;  // Gemini models support very large contexts

  constructor() {
    super();
    this.binary = 'gemini';
    this.timeout = 180000;
  }

  async initialize(config: ProviderConfig): Promise<void> {
    await super.initialize(config);
    if (!this.binary) {
      this.binary = 'gemini';
    }
  }

  protected buildArgs(request: ChatCompletionRequest): string[] {
    const args: string[] = [];

    // Add model if specified
    if (request.model && !['fast', 'standard', 'smart', 'reasoning'].includes(request.model)) {
      args.push('--model', request.model);
    }

    // Extract the last user message as the prompt
    const lastUserMsg = [...request.messages].reverse().find(m => m.role === 'user');
    if (lastUserMsg?.content) {
      args.push('--prompt', lastUserMsg.content);
    }

    // Auto-approve tool calls for non-interactive use
    args.push('--yolo');

    return args;
  }

  protected parseOutput(stdout: string, stderr: string, exitCode: number): ChatCompletionResponse {
    const content = stdout.trim();

    return {
      id: `gemini-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: 'gemini',
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
