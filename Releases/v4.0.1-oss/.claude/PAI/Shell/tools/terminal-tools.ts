/**
 * ============================================================================
 * PAI Shell — Terminal Tools
 * ============================================================================
 *
 * Terminal/shell command execution with security validation.
 * Commands run in the user's shell with configurable timeouts.
 *
 * Security: A blocklist prevents obviously destructive commands.
 * This is a soft guard — the user owns their system.
 *
 * ============================================================================
 */

import type { ToolHandler } from '../types';

// ─── Security Validator ─────────────────────────────────────────────────────

const DANGEROUS_PATTERNS = [
  /\brm\s+-rf?\s+\/(?!\w)/i,         // rm -rf / (but allow rm -rf /path/to/dir)
  /\bmkfs\b/i,                        // filesystem format
  /\bdd\s+.*of=\/dev\//i,            // dd to raw device
  /\b:?\(\)\s*\{.*:;\s*\};/,         // fork bomb
  /\bshutdown\b/i,                     // shutdown
  /\breboot\b/i,                       // reboot
  /\bchmod\s+-R\s+777\s+\//i,        // chmod 777 /
];

function validateCommand(command: string): string | null {
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(command)) {
      return `Command blocked by security validator: matches pattern ${pattern.source}`;
    }
  }
  return null;
}

export function createTerminalTools(paiDir: string): ToolHandler[] {
  return [
    // ─── Run Command ────────────────────────────────────────────
    {
      definition: {
        type: 'function',
        function: {
          name: 'run_command',
          description: 'Execute a shell command and return its output (stdout + stderr). Use for running scripts, package managers, git commands, compilation, etc. Commands run in bash with a configurable timeout.',
          parameters: {
            type: 'object',
            properties: {
              command: {
                type: 'string',
                description: 'The shell command to execute.',
              },
              workingDirectory: {
                type: 'string',
                description: 'Working directory for the command. Defaults to current directory.',
              },
              timeout: {
                type: 'number',
                description: 'Timeout in milliseconds (default: 30000). Set to 0 for no timeout.',
              },
            },
            required: ['command'],
          },
        },
      },
      execute: async (args) => {
        const command = args.command as string;
        const cwd = (args.workingDirectory as string) || process.cwd();
        const timeout = (args.timeout as number) ?? 30000;

        // Security check
        const blocked = validateCommand(command);
        if (blocked) return blocked;

        try {
          const proc = Bun.spawn(['bash', '-c', command], {
            cwd,
            stdout: 'pipe',
            stderr: 'pipe',
            env: process.env,
          });

          // Handle timeout
          let timedOut = false;
          let timer: ReturnType<typeof setTimeout> | null = null;

          if (timeout > 0) {
            timer = setTimeout(() => {
              timedOut = true;
              proc.kill();
            }, timeout);
          }

          const exitCode = await proc.exited;
          if (timer) clearTimeout(timer);

          const stdout = await new Response(proc.stdout).text();
          const stderr = await new Response(proc.stderr).text();

          if (timedOut) {
            return `Command timed out after ${timeout}ms.\nPartial stdout:\n${stdout.slice(0, 5000)}\nPartial stderr:\n${stderr.slice(0, 2000)}`;
          }

          // Truncate very long outputs
          const maxOutput = 60000;
          let output = '';

          if (stdout) {
            output += stdout.length > maxOutput
              ? `${stdout.slice(0, maxOutput)}\n\n[...truncated ${stdout.length - maxOutput} bytes]`
              : stdout;
          }

          if (stderr) {
            output += (output ? '\n\nSTDERR:\n' : 'STDERR:\n') +
              (stderr.length > 10000
                ? `${stderr.slice(0, 10000)}\n\n[...truncated]`
                : stderr);
          }

          output += `\n\nExit code: ${exitCode}`;
          return output || `Command completed with exit code ${exitCode}`;
        } catch (err) {
          return `Error running command: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },

    // ─── Run Background Command ─────────────────────────────────
    {
      definition: {
        type: 'function',
        function: {
          name: 'run_background',
          description: 'Start a command as a background process (e.g., dev servers, watchers). Returns the process PID. Use for long-running processes that should not block.',
          parameters: {
            type: 'object',
            properties: {
              command: {
                type: 'string',
                description: 'The shell command to run in the background.',
              },
              workingDirectory: {
                type: 'string',
                description: 'Working directory for the command.',
              },
            },
            required: ['command'],
          },
        },
      },
      execute: async (args) => {
        const command = args.command as string;
        const cwd = (args.workingDirectory as string) || process.cwd();

        const blocked = validateCommand(command);
        if (blocked) return blocked;

        try {
          const proc = Bun.spawn(['bash', '-c', command], {
            cwd,
            stdout: 'ignore',
            stderr: 'ignore',
            env: process.env,
          });

          return `Background process started. PID: ${proc.pid}`;
        } catch (err) {
          return `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },
  ];
}
