/**
 * ============================================================================
 * PAI Shell — Search Tools
 * ============================================================================
 *
 * Code and text search tools: grep, ripgrep, semantic search.
 * These provide fast workspace-wide search capabilities.
 *
 * ============================================================================
 */

import type { ToolHandler } from '../types';

export function createSearchTools(paiDir: string): ToolHandler[] {
  return [
    // ─── Grep Search ────────────────────────────────────────────
    {
      definition: {
        type: 'function',
        function: {
          name: 'grep_search',
          description: 'Search for text or regex patterns in files. Uses ripgrep (rg) if available, falls back to grep. Returns matching lines with file paths and line numbers. Case-insensitive by default.',
          parameters: {
            type: 'object',
            properties: {
              pattern: {
                type: 'string',
                description: 'The search pattern (text or regex).',
              },
              directory: {
                type: 'string',
                description: 'Root directory to search. Defaults to current working directory.',
              },
              includePattern: {
                type: 'string',
                description: 'File glob pattern to include (e.g., "*.ts", "*.py"). Optional.',
              },
              isRegex: {
                type: 'boolean',
                description: 'Whether the pattern is a regex (default: false).',
              },
              maxResults: {
                type: 'number',
                description: 'Maximum number of matching lines to return (default: 50).',
              },
            },
            required: ['pattern'],
          },
        },
      },
      execute: async (args) => {
        const pattern = args.pattern as string;
        const directory = (args.directory as string) || process.cwd();
        const includePattern = args.includePattern as string | undefined;
        const isRegex = args.isRegex as boolean || false;
        const maxResults = (args.maxResults as number) || 50;

        try {
          // Build ripgrep command
          const rgArgs = ['rg', '--no-heading', '--line-number', '-i'];

          if (!isRegex) {
            rgArgs.push('--fixed-strings');
          }

          if (includePattern) {
            rgArgs.push('--glob', includePattern);
          }

          rgArgs.push('--max-count', String(maxResults));
          rgArgs.push('--', pattern, directory);

          const proc = Bun.spawn(rgArgs, {
            stdout: 'pipe',
            stderr: 'pipe',
          });

          const exitCode = await proc.exited;
          const stdout = await new Response(proc.stdout).text();
          const stderr = await new Response(proc.stderr).text();

          if (exitCode === 1) {
            // No matches
            return `No matches found for "${pattern}" in ${directory}`;
          }

          if (exitCode > 1 && stderr) {
            // ripgrep might not be available, fall back to grep
            const grepArgs = ['grep', '-rn', '-i'];
            if (!isRegex) grepArgs.push('-F');
            if (includePattern) grepArgs.push('--include', includePattern);
            grepArgs.push('--', pattern, directory);

            const grepProc = Bun.spawn(grepArgs, {
              stdout: 'pipe',
              stderr: 'pipe',
            });

            const grepExitCode = await grepProc.exited;
            const grepStdout = await new Response(grepProc.stdout).text();

            if (grepExitCode === 1) {
              return `No matches found for "${pattern}" in ${directory}`;
            }

            const lines = grepStdout.split('\n').filter(Boolean).slice(0, maxResults);
            return `Found ${lines.length} match(es) for "${pattern}":\n${lines.join('\n')}`;
          }

          const lines = stdout.split('\n').filter(Boolean);
          return `Found ${lines.length} match(es) for "${pattern}":\n${lines.join('\n')}`;
        } catch (err) {
          return `Error searching: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },

    // ─── Find Files ─────────────────────────────────────────────
    {
      definition: {
        type: 'function',
        function: {
          name: 'find_files',
          description: 'Find files by name pattern in a directory tree. Uses fd if available, falls back to find.',
          parameters: {
            type: 'object',
            properties: {
              namePattern: {
                type: 'string',
                description: 'File name pattern to search for (e.g., "*.test.ts", "README*").',
              },
              directory: {
                type: 'string',
                description: 'Root directory to search. Defaults to current working directory.',
              },
              type: {
                type: 'string',
                description: 'Filter by type: "file", "directory", or "any" (default: "file").',
                enum: ['file', 'directory', 'any'],
              },
              maxResults: {
                type: 'number',
                description: 'Maximum number of results (default: 50).',
              },
            },
            required: ['namePattern'],
          },
        },
      },
      execute: async (args) => {
        const namePattern = args.namePattern as string;
        const directory = (args.directory as string) || process.cwd();
        const type = (args.type as string) || 'file';
        const maxResults = (args.maxResults as number) || 50;

        try {
          // Try fd first (faster)
          const fdArgs = ['fd', '--no-ignore-vcs'];
          if (type === 'file') fdArgs.push('--type', 'f');
          if (type === 'directory') fdArgs.push('--type', 'd');
          fdArgs.push('--max-results', String(maxResults));
          fdArgs.push(namePattern, directory);

          const proc = Bun.spawn(fdArgs, {
            stdout: 'pipe',
            stderr: 'pipe',
          });

          const exitCode = await proc.exited;
          const stdout = await new Response(proc.stdout).text();

          if (exitCode === 0 || (exitCode === 1 && !stdout)) {
            const files = stdout.split('\n').filter(Boolean);
            if (files.length === 0) {
              return `No files matching "${namePattern}" in ${directory}`;
            }
            return `Found ${files.length} file(s):\n${files.join('\n')}`;
          }

          // Fall back to find
          const findArgs = ['find', directory];
          if (type === 'file') findArgs.push('-type', 'f');
          if (type === 'directory') findArgs.push('-type', 'd');
          findArgs.push('-name', namePattern);
          findArgs.push('-maxdepth', '10');

          const findProc = Bun.spawn(findArgs, {
            stdout: 'pipe',
            stderr: 'pipe',
          });

          await findProc.exited;
          const findStdout = await new Response(findProc.stdout).text();
          const files = findStdout.split('\n').filter(Boolean).slice(0, maxResults);

          if (files.length === 0) {
            return `No files matching "${namePattern}" in ${directory}`;
          }
          return `Found ${files.length} file(s):\n${files.join('\n')}`;
        } catch (err) {
          return `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },
  ];
}
