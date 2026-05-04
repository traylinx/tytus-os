/**
 * Runtime tool registry — tools are registered via injection at
 * `createSession({ tools: [...] })`, NOT via compile-time imports
 * from app packages. This keeps the dep graph one-way: apps depend
 * on the engine; the engine never depends on apps.
 *
 * Per spec §"Tool registration via injection".
 */

import type { ToolDef } from '../types';

export interface ToolRegistry {
  /** Look up a registered tool by name. */
  get(name: string): ToolDef | undefined;
  /** All registered tool names. */
  names(): string[];
  /** Every registered tool. The engine renders these into the OpenAI
   *  tools schema array on each request. */
  all(): ToolDef[];
}

/**
 * Build a frozen ToolRegistry from a list of ToolDefs. Duplicate tool
 * names throw — apps must dedupe before passing the array.
 */
export function createToolRegistry(tools: ToolDef[]): ToolRegistry {
  const map = new Map<string, ToolDef>();
  for (const t of tools) {
    if (!t || typeof t.name !== 'string' || t.name.length === 0) {
      throw new Error('createToolRegistry: tool definitions require a non-empty name');
    }
    if (map.has(t.name)) {
      throw new Error(`createToolRegistry: duplicate tool name "${t.name}"`);
    }
    map.set(t.name, t);
  }
  const list = Array.from(map.values());
  return {
    get: (name) => map.get(name),
    names: () => Array.from(map.keys()),
    all: () => list.slice(),
  };
}
