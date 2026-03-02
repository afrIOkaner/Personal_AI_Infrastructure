/**
 * ============================================================================
 * PAI Shell — File Tools
 * ============================================================================
 *
 * Filesystem operations: read, write, list directory, glob search.
 * These mirror Claude Code's built-in file tools with the same semantics.
 *
 * ============================================================================
 */

import type { ToolHandler } from '../types';
import { readdir, stat } from 'node:fs/promises';
import { join, resolve, relative } from 'node:path';
import { Glob } from 'bun';

export function createFileTools(paiDir: string): ToolHandler[] {
  return [
    // ─── Read File ──────────────────────────────────────────────
    {
      definition: {
        type: 'function',
        function: {
          name: 'read_file',
          description: 'Read the contents of a file. You can optionally specify a line range. Line numbers are 1-indexed.',
          parameters: {
            type: 'object',
            properties: {
              filePath: {
                type: 'string',
                description: 'The absolute path to the file to read.',
              },
              startLine: {
                type: 'number',
                description: 'The 1-based line number to start reading from. Optional.',
              },
              endLine: {
                type: 'number',
                description: 'The 1-based inclusive line number to stop reading at. Optional.',
              },
            },
            required: ['filePath'],
          },
        },
      },
      execute: async (args) => {
        const filePath = args.filePath as string;
        const startLine = args.startLine as number | undefined;
        const endLine = args.endLine as number | undefined;

        try {
          const content = await Bun.file(filePath).text();
          const lines = content.split('\n');

          if (startLine !== undefined || endLine !== undefined) {
            const start = Math.max(1, startLine || 1) - 1;
            const end = Math.min(lines.length, endLine || lines.length);
            const slice = lines.slice(start, end);
            return `File: ${filePath} (lines ${start + 1}-${end} of ${lines.length})\n${slice.join('\n')}`;
          }

          return `File: ${filePath} (${lines.length} lines)\n${content}`;
        } catch (err) {
          return `Error reading file: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },

    // ─── Write File ─────────────────────────────────────────────
    {
      definition: {
        type: 'function',
        function: {
          name: 'write_file',
          description: 'Create a new file or overwrite an existing file with the given content. Creates parent directories if needed.',
          parameters: {
            type: 'object',
            properties: {
              filePath: {
                type: 'string',
                description: 'The absolute path to the file to write.',
              },
              content: {
                type: 'string',
                description: 'The full content to write to the file.',
              },
            },
            required: ['filePath', 'content'],
          },
        },
      },
      execute: async (args) => {
        const filePath = args.filePath as string;
        const content = args.content as string;

        try {
          // Ensure parent directory exists
          const dir = filePath.substring(0, filePath.lastIndexOf('/'));
          await Bun.spawn(['mkdir', '-p', dir]).exited;

          await Bun.write(filePath, content);
          const lines = content.split('\n').length;
          return `Successfully wrote ${lines} lines to ${filePath}`;
        } catch (err) {
          return `Error writing file: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },

    // ─── List Directory ─────────────────────────────────────────
    {
      definition: {
        type: 'function',
        function: {
          name: 'list_directory',
          description: 'List the contents of a directory. Returns file and directory names with type indicators (/ suffix for directories).',
          parameters: {
            type: 'object',
            properties: {
              path: {
                type: 'string',
                description: 'The absolute path to the directory to list.',
              },
            },
            required: ['path'],
          },
        },
      },
      execute: async (args) => {
        const dirPath = args.path as string;

        try {
          const entries = await readdir(dirPath, { withFileTypes: true });
          const formatted = entries
            .sort((a, b) => {
              // Directories first, then files
              if (a.isDirectory() && !b.isDirectory()) return -1;
              if (!a.isDirectory() && b.isDirectory()) return 1;
              return a.name.localeCompare(b.name);
            })
            .map(e => e.isDirectory() ? `${e.name}/` : e.name);

          return `Directory: ${dirPath}\n${formatted.join('\n')}`;
        } catch (err) {
          return `Error listing directory: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },

    // ─── Glob Search ────────────────────────────────────────────
    {
      definition: {
        type: 'function',
        function: {
          name: 'glob_search',
          description: 'Search for files matching a glob pattern. Returns absolute file paths. Examples: **/*.ts, src/**/*.json, **/test*.py',
          parameters: {
            type: 'object',
            properties: {
              pattern: {
                type: 'string',
                description: 'Glob pattern to match files against.',
              },
              directory: {
                type: 'string',
                description: 'Root directory to search from. Defaults to current working directory.',
              },
              maxResults: {
                type: 'number',
                description: 'Maximum number of results to return (default: 100).',
              },
            },
            required: ['pattern'],
          },
        },
      },
      execute: async (args) => {
        const pattern = args.pattern as string;
        const directory = (args.directory as string) || process.cwd();
        const maxResults = (args.maxResults as number) || 100;

        try {
          const glob = new Glob(pattern);
          const matches: string[] = [];

          for await (const match of glob.scan({ cwd: directory, absolute: true })) {
            matches.push(match);
            if (matches.length >= maxResults) break;
          }

          if (matches.length === 0) {
            return `No files matching pattern: ${pattern} in ${directory}`;
          }

          return `Found ${matches.length} file(s) matching "${pattern}":\n${matches.join('\n')}`;
        } catch (err) {
          return `Error searching: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },

    // ─── File Info ──────────────────────────────────────────────
    {
      definition: {
        type: 'function',
        function: {
          name: 'file_info',
          description: 'Get metadata about a file or directory: size, modification time, permissions.',
          parameters: {
            type: 'object',
            properties: {
              path: {
                type: 'string',
                description: 'The absolute path to check.',
              },
            },
            required: ['path'],
          },
        },
      },
      execute: async (args) => {
        const filePath = args.path as string;

        try {
          const info = await stat(filePath);
          return JSON.stringify({
            path: filePath,
            type: info.isDirectory() ? 'directory' : info.isFile() ? 'file' : 'other',
            size: info.size,
            modified: info.mtime.toISOString(),
            created: info.birthtime.toISOString(),
            permissions: `0${(info.mode & 0o777).toString(8)}`,
          }, null, 2);
        } catch (err) {
          return `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },
  ];
}
