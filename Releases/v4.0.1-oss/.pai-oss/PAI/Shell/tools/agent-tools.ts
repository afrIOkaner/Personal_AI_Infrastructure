/**
 * ============================================================================
 * PAI Shell — Agent Tools
 * ============================================================================
 *
 * High-level agent tools: user interaction, planning, delegation to
 * CLI agents, web fetching, and task management.
 *
 * ============================================================================
 */

import type { ToolHandler } from '../types';

export function createAgentTools(paiDir: string): ToolHandler[] {
  return [
    // ─── Ask User ───────────────────────────────────────────────
    {
      definition: {
        type: 'function',
        function: {
          name: 'ask_user',
          description: 'Ask the user a question and wait for their response. Use when you need clarification, confirmation, or user input to proceed.',
          parameters: {
            type: 'object',
            properties: {
              question: {
                type: 'string',
                description: 'The question to ask the user.',
              },
            },
            required: ['question'],
          },
        },
      },
      execute: async (args) => {
        const question = args.question as string;

        // Print the question and read from stdin
        console.log(`\n❓ ${question}`);
        process.stdout.write('Your answer: ');

        const reader = Bun.stdin.stream().getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            reader.releaseLock();
            return buffer || '[No response]';
          }

          buffer += decoder.decode(value, { stream: true });
          const newlineIdx = buffer.indexOf('\n');
          if (newlineIdx >= 0) {
            reader.releaseLock();
            return buffer.slice(0, newlineIdx).trim() || '[Empty response]';
          }
        }
      },
    },

    // ─── Web Fetch ──────────────────────────────────────────────
    {
      definition: {
        type: 'function',
        function: {
          name: 'web_fetch',
          description: 'Fetch content from a URL. Returns the response body as text. Useful for reading web pages, APIs, documentation, etc.',
          parameters: {
            type: 'object',
            properties: {
              url: {
                type: 'string',
                description: 'The URL to fetch.',
              },
              headers: {
                type: 'object',
                description: 'Optional HTTP headers to include.',
              },
              maxLength: {
                type: 'number',
                description: 'Maximum response length in characters (default: 50000).',
              },
            },
            required: ['url'],
          },
        },
      },
      execute: async (args) => {
        const url = args.url as string;
        const headers = (args.headers as Record<string, string>) || {};
        const maxLength = (args.maxLength as number) || 50000;

        try {
          const response = await fetch(url, {
            headers: {
              'User-Agent': 'PAI-Shell/1.0',
              ...headers,
            },
          });

          if (!response.ok) {
            return `HTTP ${response.status} ${response.statusText} for ${url}`;
          }

          const contentType = response.headers.get('content-type') || '';
          let text = await response.text();

          // Truncate if needed
          if (text.length > maxLength) {
            text = text.slice(0, maxLength) + `\n\n[...truncated ${text.length - maxLength} characters]`;
          }

          return `URL: ${url}\nContent-Type: ${contentType}\nLength: ${text.length}\n\n${text}`;
        } catch (err) {
          return `Error fetching ${url}: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },

    // ─── Delegate to CLI Agent ──────────────────────────────────
    {
      definition: {
        type: 'function',
        function: {
          name: 'delegate_to_agent',
          description: 'Delegate a task to a CLI agent (Claude Code, Codex, Gemini CLI, or Aider). The agent will execute the task autonomously and return its result. Use for complex coding tasks where a specialized agent would be more effective.',
          parameters: {
            type: 'object',
            properties: {
              agent: {
                type: 'string',
                description: 'Which agent to delegate to.',
                enum: ['claude-code', 'codex', 'gemini-cli', 'aider'],
              },
              prompt: {
                type: 'string',
                description: 'The detailed task description/prompt for the agent.',
              },
              workingDirectory: {
                type: 'string',
                description: 'Working directory for the agent. Defaults to current directory.',
              },
              timeout: {
                type: 'number',
                description: 'Timeout in milliseconds (default: 300000 = 5 minutes).',
              },
            },
            required: ['agent', 'prompt'],
          },
        },
      },
      execute: async (args) => {
        const agent = args.agent as string;
        const prompt = args.prompt as string;
        const cwd = (args.workingDirectory as string) || process.cwd();
        const timeout = (args.timeout as number) || 300000;

        // Build agent command
        let command: string[];
        switch (agent) {
          case 'claude-code':
            command = ['claude', '--print', '--output-format', 'text'];
            break;
          case 'codex':
            command = ['codex', '--quiet', '--approval-mode', 'full-auto'];
            break;
          case 'gemini-cli':
            command = ['gemini', '--prompt', prompt, '--yolo'];
            break;
          case 'aider':
            command = ['aider', '--yes', '--no-stream', '--no-git', '--message', prompt];
            break;
          default:
            return `Unknown agent: ${agent}. Supported: claude-code, codex, gemini-cli, aider`;
        }

        try {
          // Check if the agent binary exists
          const whichProc = Bun.spawn(['which', command[0]], { stdout: 'pipe', stderr: 'pipe' });
          await whichProc.exited;
          const whichOut = await new Response(whichProc.stdout).text();
          if (!whichOut.trim()) {
            return `Agent "${agent}" not found. Ensure ${command[0]} is installed and in PATH.`;
          }

          console.error(`  → Delegating to ${agent}...`);

          const proc = Bun.spawn(command, {
            cwd,
            stdout: 'pipe',
            stderr: 'pipe',
            stdin: agent === 'claude-code' || agent === 'codex'
              ? new Response(prompt).body!
              : undefined,
            env: process.env,
          });

          // Timeout handler
          let timedOut = false;
          const timer = setTimeout(() => {
            timedOut = true;
            proc.kill();
          }, timeout);

          const exitCode = await proc.exited;
          clearTimeout(timer);

          const stdout = await new Response(proc.stdout).text();
          const stderr = await new Response(proc.stderr).text();

          if (timedOut) {
            return `Agent ${agent} timed out after ${timeout / 1000}s.\nPartial output:\n${stdout.slice(0, 10000)}`;
          }

          if (stdout) {
            return `Agent ${agent} completed (exit: ${exitCode}):\n\n${stdout.slice(0, 50000)}`;
          }

          if (stderr) {
            return `Agent ${agent} (exit: ${exitCode}):\n\nSTDERR:\n${stderr.slice(0, 10000)}`;
          }

          return `Agent ${agent} completed with exit code ${exitCode} (no output)`;
        } catch (err) {
          return `Error delegating to ${agent}: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },

    // ─── Todo Write ─────────────────────────────────────────────
    {
      definition: {
        type: 'function',
        function: {
          name: 'todo_write',
          description: 'Track tasks on a todo list. Use frequently to plan and track multi-step work.',
          parameters: {
            type: 'object',
            properties: {
              todos: {
                type: 'array',
                description: 'Array of todo items.',
                items: {
                  type: 'object',
                  properties: {
                    id: {
                      type: 'number',
                      description: 'Unique ID for the todo.',
                    },
                    title: {
                      type: 'string',
                      description: 'Short task description (3-7 words).',
                    },
                    status: {
                      type: 'string',
                      description: 'Task status.',
                      enum: ['not-started', 'in-progress', 'completed'],
                    },
                  },
                  required: ['id', 'title', 'status'],
                },
              },
            },
            required: ['todos'],
          },
        },
      },
      execute: async (args) => {
        const todos = args.todos as Array<{ id: number; title: string; status: string }>;

        const formatted = todos.map(t => {
          const icon = t.status === 'completed' ? '✅' :
                      t.status === 'in-progress' ? '🔄' : '⬜';
          return `  ${icon} [${t.id}] ${t.title}`;
        }).join('\n');

        // Also write to a file for persistence
        const todoPath = `${paiDir}/PAI/Shell/.todos.json`;
        try {
          await Bun.write(todoPath, JSON.stringify(todos, null, 2));
        } catch {
          // Non-critical
        }

        console.error(`\n📋 Todo List:\n${formatted}\n`);
        return `Todo list updated with ${todos.length} item(s):\n${formatted}`;
      },
    },

    // ─── Think / Plan ───────────────────────────────────────────
    {
      definition: {
        type: 'function',
        function: {
          name: 'think',
          description: 'Use this tool to think through a problem step by step before acting. Write out your reasoning, analysis, and plan. The content is not shown to the user — it is only for your own planning.',
          parameters: {
            type: 'object',
            properties: {
              reasoning: {
                type: 'string',
                description: 'Your step-by-step reasoning and analysis.',
              },
            },
            required: ['reasoning'],
          },
        },
      },
      execute: async (args) => {
        // Think tool is a no-op — it exists so the model can use it for planning
        return 'Thinking captured. Proceed with your plan.';
      },
    },
  ];
}
