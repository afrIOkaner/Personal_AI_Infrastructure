/**
 * ============================================================================
 * PAI Shell — Code Editing Tools
 * ============================================================================
 *
 * Precise code editing operations: string replacement, multi-edit, and
 * structured insertions. These mirror Claude Code's edit semantics:
 * exact string match → replace.
 *
 * ============================================================================
 */

import type { ToolHandler } from '../types';

export function createCodeTools(paiDir: string): ToolHandler[] {
  return [
    // ─── Replace String in File ─────────────────────────────────
    {
      definition: {
        type: 'function',
        function: {
          name: 'replace_in_file',
          description: 'Replace an exact string occurrence in a file. The oldString must match exactly (including whitespace and indentation). Include surrounding context lines to ensure uniqueness. Only replaces ONE occurrence.',
          parameters: {
            type: 'object',
            properties: {
              filePath: {
                type: 'string',
                description: 'The absolute path to the file to edit.',
              },
              oldString: {
                type: 'string',
                description: 'The exact literal text to find and replace. Must match exactly including whitespace.',
              },
              newString: {
                type: 'string',
                description: 'The exact replacement text.',
              },
            },
            required: ['filePath', 'oldString', 'newString'],
          },
        },
      },
      execute: async (args) => {
        const filePath = args.filePath as string;
        const oldString = args.oldString as string;
        const newString = args.newString as string;

        try {
          const content = await Bun.file(filePath).text();

          // Count occurrences
          const occurrences = content.split(oldString).length - 1;
          if (occurrences === 0) {
            // Try to help debug: show nearby content
            const lines = content.split('\n');
            const firstWords = oldString.split('\n')[0].trim().slice(0, 40);
            const nearbyLines = lines
              .map((line, i) => ({ line, num: i + 1 }))
              .filter(({ line }) => line.includes(firstWords.slice(0, 20)))
              .slice(0, 3)
              .map(({ line, num }) => `  L${num}: ${line.slice(0, 100)}`)
              .join('\n');

            return `Error: oldString not found in ${filePath}. No exact match exists.\n` +
              (nearbyLines ? `Nearby matches for "${firstWords}":\n${nearbyLines}` : 'No similar content found.');
          }

          if (occurrences > 1) {
            return `Error: oldString matches ${occurrences} locations in ${filePath}. Include more context to make it unique.`;
          }

          // Perform replacement
          const newContent = content.replace(oldString, newString);
          await Bun.write(filePath, newContent);

          // Show what changed
          const oldLines = oldString.split('\n').length;
          const newLines = newString.split('\n').length;
          return `Successfully replaced ${oldLines} line(s) with ${newLines} line(s) in ${filePath}`;
        } catch (err) {
          return `Error editing file: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },

    // ─── Multi-Replace ──────────────────────────────────────────
    {
      definition: {
        type: 'function',
        function: {
          name: 'multi_replace',
          description: 'Apply multiple string replacements to one or more files. Each replacement has filePath, oldString, and newString. Replacements are applied sequentially.',
          parameters: {
            type: 'object',
            properties: {
              replacements: {
                type: 'array',
                description: 'Array of replacement operations.',
                items: {
                  type: 'object',
                  properties: {
                    filePath: {
                      type: 'string',
                      description: 'Absolute path to the file.',
                    },
                    oldString: {
                      type: 'string',
                      description: 'Exact text to find.',
                    },
                    newString: {
                      type: 'string',
                      description: 'Replacement text.',
                    },
                  },
                  required: ['filePath', 'oldString', 'newString'],
                },
              },
            },
            required: ['replacements'],
          },
        },
      },
      execute: async (args) => {
        const replacements = args.replacements as Array<{
          filePath: string;
          oldString: string;
          newString: string;
        }>;

        const results: string[] = [];
        let successes = 0;
        let failures = 0;

        // Cache file contents to handle multiple edits to the same file
        const fileCache = new Map<string, string>();

        for (let i = 0; i < replacements.length; i++) {
          const rep = replacements[i];
          try {
            // Load file content (from cache or disk)
            let content = fileCache.get(rep.filePath);
            if (content === undefined) {
              content = await Bun.file(rep.filePath).text();
            }

            const occurrences = content.split(rep.oldString).length - 1;
            if (occurrences === 0) {
              failures++;
              results.push(`[${i + 1}] FAILED: oldString not found in ${rep.filePath}`);
              continue;
            }
            if (occurrences > 1) {
              failures++;
              results.push(`[${i + 1}] FAILED: ${occurrences} matches in ${rep.filePath}`);
              continue;
            }

            content = content.replace(rep.oldString, rep.newString);
            fileCache.set(rep.filePath, content);
            successes++;
            results.push(`[${i + 1}] OK: ${rep.filePath}`);
          } catch (err) {
            failures++;
            results.push(`[${i + 1}] ERROR: ${err instanceof Error ? err.message : String(err)}`);
          }
        }

        // Write all cached files to disk
        for (const [filePath, content] of fileCache) {
          await Bun.write(filePath, content);
        }

        return `Multi-replace: ${successes} succeeded, ${failures} failed\n${results.join('\n')}`;
      },
    },

    // ─── Insert at Line ─────────────────────────────────────────
    {
      definition: {
        type: 'function',
        function: {
          name: 'insert_at_line',
          description: 'Insert text at a specific line number in a file. The existing content at that line and below is shifted down.',
          parameters: {
            type: 'object',
            properties: {
              filePath: {
                type: 'string',
                description: 'The absolute path to the file.',
              },
              lineNumber: {
                type: 'number',
                description: 'The 1-based line number to insert at.',
              },
              content: {
                type: 'string',
                description: 'The text to insert.',
              },
            },
            required: ['filePath', 'lineNumber', 'content'],
          },
        },
      },
      execute: async (args) => {
        const filePath = args.filePath as string;
        const lineNumber = args.lineNumber as number;
        const insertContent = args.content as string;

        try {
          const content = await Bun.file(filePath).text();
          const lines = content.split('\n');

          const idx = Math.max(0, Math.min(lines.length, lineNumber - 1));
          const newLines = insertContent.split('\n');
          lines.splice(idx, 0, ...newLines);

          await Bun.write(filePath, lines.join('\n'));
          return `Inserted ${newLines.length} line(s) at line ${lineNumber} in ${filePath}`;
        } catch (err) {
          return `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },
  ];
}
