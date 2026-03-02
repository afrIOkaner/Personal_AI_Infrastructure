/**
 * ============================================================================
 * Claude Code CLI Agent Provider
 * ============================================================================
 *
 * Spawns the `claude` CLI binary as a subprocess for inference.
 * This allows PAI-OSS to optionally use Claude Code for tasks that
 * benefit from its built-in tool ecosystem.
 *
 * Modes:
 * - Print mode: `claude --print` — one-shot text generation (no tools)
 * - Interactive mode: `claude -p` — full agentic execution with tools
 *
 * When used as a provider, this spawns Claude Code in print mode for
 * pure inference. For full agentic delegation (with Claude Code's own
 * tools), use the DelegateToCLIAgent tool instead.
 *
 * ============================================================================
 */

import { BaseCLIAgentProvider } from './Provider';
import type {
  ProviderConfig,
  ProviderName,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatMessage,
} from '../types';

export class ClaudeCodeProvider extends BaseCLIAgentProvider {
  readonly name: ProviderName = 'claude-code';
  readonly supportsToolCalling = false;  // In print mode, tools disabled
  readonly supportsStreaming = false;
  maxContextWindow = 200000;

  constructor() {
    super();
    this.binary = 'claude';
  }

  async initialize(config: ProviderConfig): Promise<void> {
    await super.initialize(config);
    if (!this.binary) {
      this.binary = 'claude';
    }
  }

  /**
   * Map PAI tier to Claude model name
   */
  private resolveModel(requestModel: string): string {
    const tierMap: Record<string, string> = {
      'fast': 'haiku',
      'standard': 'sonnet',
      'smart': 'opus',
      'reasoning': 'opus',
    };
    return tierMap[requestModel] || requestModel;
  }

  protected buildArgs(request: ChatCompletionRequest): string[] {
    const model = this.resolveModel(request.model);

    // Extract system prompt
    const systemMsg = request.messages.find(m => m.role === 'system');
    const args = [
      '--print',
      '--model', model,
      '--tools', '',              // Disable tools for pure inference
      '--output-format', 'text',
      '--setting-sources', '',    // Disable hooks to prevent recursion
    ];

    if (systemMsg?.content) {
      args.push('--system-prompt', systemMsg.content);
    }

    return args;
  }

  protected parseOutput(stdout: string, stderr: string, exitCode: number): ChatCompletionResponse {
    const content = stdout.trim();

    if (exitCode !== 0) {
      return {
        id: `claude-${Date.now()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: 'claude',
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: `Error: ${stderr || `Process exited with code ${exitCode}`}`,
          },
          finish_reason: 'stop',
        }],
      };
    }

    return {
      id: `claude-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: 'claude',
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content,
        },
        finish_reason: 'stop',
      }],
    };
  }

  /**
   * Override complete to properly pipe the user message via stdin
   */
  async complete(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const args = this.buildArgs(request);
    const start = Date.now();

    // Build environment WITHOUT ANTHROPIC_API_KEY
    // (forces subscription auth, prevents double billing)
    const env = { ...process.env };
    delete env.ANTHROPIC_API_KEY;
    delete env.CLAUDECODE;

    return new Promise((resolve, reject) => {
      const { spawn } = require('child_process') as typeof import('child_process');

      const proc = spawn(this.binary, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env,
      });

      let stdout = '';
      let stderr = '';

      // Write the last user message as stdin
      const lastUserMsg = [...request.messages].reverse().find(m => m.role === 'user');
      if (lastUserMsg?.content) {
        proc.stdin.write(lastUserMsg.content);
      }
      proc.stdin.end();

      proc.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
      proc.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

      const timeoutId = setTimeout(() => {
        proc.kill('SIGTERM');
        reject(new Error(`Claude Code timed out after ${this.timeout}ms`));
      }, this.timeout);

      proc.on('close', (code: number | null) => {
        clearTimeout(timeoutId);
        const result = this.parseOutput(stdout, stderr, code || 0);
        result._provider = this.name;
        result._latencyMs = Date.now() - start;
        resolve(result);
      });

      proc.on('error', (err: Error) => {
        clearTimeout(timeoutId);
        reject(new Error(`Failed to spawn claude: ${err.message}`));
      });
    });
  }
}
