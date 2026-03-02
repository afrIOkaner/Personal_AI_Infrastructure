/**
 * ============================================================================
 * PAI Shell — Tool Registry
 * ============================================================================
 *
 * Central registry for all tools available to the agentic loop.
 * Each tool is defined as an OpenAI function-calling compatible definition
 * paired with a handler function.
 *
 * The registry provides:
 * - Tool definitions (for the model's `tools` parameter)
 * - Tool handlers (for executing tool calls)
 * - Tool discovery (listing available tools)
 *
 * ============================================================================
 */

import type { ToolDefinition, ToolHandler } from '../types';
import { createFileTools } from './file-tools';
import { createCodeTools } from './code-tools';
import { createTerminalTools } from './terminal-tools';
import { createSearchTools } from './search-tools';
import { createAgentTools } from './agent-tools';

export interface ToolRegistry {
  /** Get all tool definitions for the model */
  getDefinitions(): ToolDefinition[];

  /** Get a specific tool handler by name */
  getHandler(name: string): ToolHandler | undefined;

  /** List all registered tool names */
  listTools(): string[];
}

/**
 * Create a tool registry with all PAI Shell tools.
 */
export function createToolRegistry(paiDir: string): ToolRegistry {
  const handlers = new Map<string, ToolHandler>();

  // Register all tool categories
  const toolSets = [
    ...createFileTools(paiDir),
    ...createCodeTools(paiDir),
    ...createTerminalTools(paiDir),
    ...createSearchTools(paiDir),
    ...createAgentTools(paiDir),
  ];

  for (const handler of toolSets) {
    handlers.set(handler.definition.function.name, handler);
  }

  return {
    getDefinitions(): ToolDefinition[] {
      return Array.from(handlers.values()).map(h => h.definition);
    },

    getHandler(name: string): ToolHandler | undefined {
      return handlers.get(name);
    },

    listTools(): string[] {
      return Array.from(handlers.keys());
    },
  };
}
