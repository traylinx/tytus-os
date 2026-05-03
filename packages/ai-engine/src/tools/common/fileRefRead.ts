/**
 * `fileRefReadTool(host, opts)` — common tool factory that reads a
 * FileNode by id and exposes its contents to the model. Wraps
 * `host.fs.read` + `host.fs.getNodeById` with the engine-level consent
 * layer (D12: engine UX policy, NOT a host sandbox).
 *
 * Scope presets (per spec §"fileRef.read consent"):
 *   - 'doc-only'         scopes 1+2 (active doc + tab neighbors)      [Sheet, Memo, Studio:text]
 *   - 'doc-and-siblings' scopes 1+2+3 (above + sibling-file approval)  [Studio:code/markdown/json]
 *   - 'doc-only-strict'  scope 1 only (active doc only)               [reserved]
 *
 * Reads outside the preset's allowed scopes are gated by per-call
 * approval (scope 4 / "Anywhere else") via the injected `requestApproval`
 * callback. App code calling `host.fs.read()` directly bypasses this
 * consent — engine-level UX, not security.
 */

import type { HostClient, ToolDef } from '../../types';

export type ConsentScopePreset =
  | 'doc-only'
  | 'doc-and-siblings'
  | 'doc-only-strict';

/** Policy result for an attempted read. */
export type ConsentScope =
  /** 1 — the active document. Auto-approved by every preset. */
  | 'active'
  /** 2 — tab neighbors. Auto-approved by 'doc-only' and 'doc-and-siblings'. */
  | 'tab-neighbor'
  /** 3 — siblings of the active doc's parent folder. Auto-approved
   *  by 'doc-and-siblings' only; 'doc-only' requires per-call approval. */
  | 'sibling'
  /** 4 — anywhere else. Always requires per-call approval. */
  | 'other';

export interface FileRefReadFactoryOpts {
  scope?: ConsentScopePreset;
  /**
   * The active document's FileNode id at session creation time. The
   * factory uses it to classify reads (active vs sibling vs other) for
   * the consent decision. Apps that change the active document mid-
   * session call the engine's `setActiveDocument` (M2.5).
   */
  activeDocumentId: string;
  /**
   * The FileNode ids of the open tab neighbors. Used to classify
   * reads as scope 2 (auto-approved). Empty when the app only opens
   * one doc per window.
   */
  tabNeighborIds?: string[];
  /**
   * Approval callback fired per scope-3 / scope-4 read that needs user
   * consent. Returns true to allow, false to deny. The engine renders
   * the chip; this factory delegates to the renderer.
   */
  requestApproval?: (
    scope: ConsentScope,
    fileNodeId: string,
    name: string,
  ) => Promise<boolean>;
  /** Telemetry hook — every approved read is logged into "What did the
   *  agent see?". Optional in the factory; engine's session wires it
   *  to the visibility log. */
  onRead?: (info: {
    scope: ConsentScope;
    fileNodeId: string;
    name: string;
    sizeBytes: number;
  }) => void;
}

/** Compute which scope a read falls into. */
export function classifyScope(
  fileNodeId: string,
  opts: {
    activeDocumentId: string;
    activeDocumentParentId?: string | null;
    tabNeighborIds?: string[];
    candidateParentId?: string | null;
  },
): ConsentScope {
  if (fileNodeId === opts.activeDocumentId) return 'active';
  if ((opts.tabNeighborIds ?? []).includes(fileNodeId)) return 'tab-neighbor';
  if (
    opts.activeDocumentParentId &&
    opts.candidateParentId === opts.activeDocumentParentId
  ) {
    return 'sibling';
  }
  return 'other';
}

/** Whether a scope is auto-approved under a preset (no per-call chip). */
export function presetAutoApproves(
  preset: ConsentScopePreset,
  scope: ConsentScope,
): boolean {
  switch (preset) {
    case 'doc-only-strict':
      return scope === 'active';
    case 'doc-only':
      return scope === 'active' || scope === 'tab-neighbor';
    case 'doc-and-siblings':
      return (
        scope === 'active' || scope === 'tab-neighbor' || scope === 'sibling'
      );
  }
}

const TOOL_NAME = 'fileRef.read';

const TOOL_PARAMETERS = {
  type: 'object' as const,
  properties: {
    fileNodeId: {
      type: 'string',
      description:
        'The FileNode id of the file to read. Resolve via fileRef.list or by reading paths the user pinned in their request.',
    },
  },
  required: ['fileNodeId'],
};

/**
 * Build the fileRef.read ToolDef bound to a HostClient + a consent
 * preset. The returned tool is suitable to pass to
 * `createSession({ tools: [...] })`.
 */
export function fileRefReadTool(
  host: HostClient,
  opts: FileRefReadFactoryOpts,
): ToolDef {
  const preset = opts.scope ?? 'doc-only';
  return {
    name: TOOL_NAME,
    description:
      'Read the contents of a file in the user\'s VFS by FileNode id. Returns text. Approval required for files outside the active document\'s folder.',
    parameters: TOOL_PARAMETERS,
    requiresApproval: 'first-time-per-session',
    execute: async (args, ctx) => {
      const fileNodeId =
        args && typeof args === 'object'
          ? (args as { fileNodeId?: unknown }).fileNodeId
          : undefined;
      if (typeof fileNodeId !== 'string' || fileNodeId.length === 0) {
        throw new Error(
          'fileRef.read: missing or invalid fileNodeId argument',
        );
      }

      const node = await host.fs.getNodeById(fileNodeId);
      if (!node) {
        throw new Error(`fileRef.read: file not found: ${fileNodeId}`);
      }
      if (node.isDirectory) {
        throw new Error(
          `fileRef.read: ${fileNodeId} is a directory; use fileRef.list instead`,
        );
      }

      // Resolve the active doc's parent for scope classification.
      let activeParentId: string | null = null;
      if (opts.activeDocumentId !== fileNodeId) {
        const active = await host.fs.getNodeById(opts.activeDocumentId);
        activeParentId = active?.parentId ?? null;
      }
      const scope = classifyScope(fileNodeId, {
        activeDocumentId: opts.activeDocumentId,
        activeDocumentParentId: activeParentId,
        tabNeighborIds: opts.tabNeighborIds,
        candidateParentId: node.parentId,
      });

      // Apply preset auto-approval. `ctx.approvalAlreadyGranted` is true
      // when the chip was approved earlier this session — short-circuit
      // for first-time-per-session tools.
      const autoApproved = presetAutoApproves(preset, scope);
      if (!autoApproved && !ctx.approvalAlreadyGranted) {
        const approved = opts.requestApproval
          ? await opts.requestApproval(scope, fileNodeId, node.name)
          : false;
        if (!approved) {
          throw new Error(
            `fileRef.read: user declined access to "${node.name}" (scope=${scope})`,
          );
        }
      }

      const content = await host.fs.read(fileNodeId);
      // Engine consumers want text; bytes go to a separate tool (M2.5+).
      const text =
        typeof content === 'string'
          ? content
          : new TextDecoder('utf-8').decode(content);

      opts.onRead?.({
        scope,
        fileNodeId,
        name: node.name,
        sizeBytes: text.length,
      });

      return { fileNodeId, name: node.name, text, scope };
    },
  };
}
