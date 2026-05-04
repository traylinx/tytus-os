/**
 * `@tytus/ai-engine` Studio-tools barrel.
 *
 * Exports the four Studio-specific tools introduced in W6 PR-Studio-Engine
 * (M6.x): `studioReadDocument`, `studioReadBlock`, `studioReplaceBlock`,
 * `studioInsertBlock`. Apps build the quad via `makeStudioTools({ db })`
 * and pass it through `createSession({ tools: STUDIO_TOOLS })`.
 *
 * The pure read helpers (`readDocument`, `readBlock`) are also exported
 * so apps can preview values inline without going through a tool round-
 * trip — the engine session uses the tool form, the UI uses the bare
 * function (Studio's ⌘K modal builds context this way).
 */
import type { AppDb } from '@tytus/host-api';
import type { ToolDef } from '../../types';
import { studioReadDocumentTool } from './readDocument';
import { studioReadBlockTool } from './readBlock';
import { studioReplaceBlockTool } from './replaceBlock';
import { studioInsertBlockTool } from './insertBlock';

export type {
  StudioReadDocumentArgs,
  StudioReadDocumentFactoryOpts,
  StudioReadDocumentResult,
} from './readDocument';
export {
  STUDIO_READ_DOCUMENT_TOOL_NAME,
  parseStudioReadDocumentArgs,
  readDocument,
  studioReadDocumentTool,
} from './readDocument';

export type {
  StudioReadBlockArgs,
  StudioReadBlockFactoryOpts,
  StudioReadBlockResult,
} from './readBlock';
export {
  STUDIO_READ_BLOCK_TOOL_NAME,
  parseStudioReadBlockArgs,
  readBlock,
  studioReadBlockTool,
} from './readBlock';

export type {
  StudioReplaceBlockArgs,
  StudioReplaceBlockFactoryOpts,
} from './replaceBlock';
export {
  STUDIO_REPLACE_BLOCK_TOOL_NAME,
  parseStudioReplaceBlockArgs,
  studioReplaceBlockTool,
} from './replaceBlock';

export type {
  StudioInsertBlockArgs,
  StudioInsertBlockFactoryOpts,
} from './insertBlock';
export {
  STUDIO_INSERT_BLOCK_TOOL_NAME,
  parseStudioInsertBlockArgs,
  studioInsertBlockTool,
} from './insertBlock';

/**
 * Build the STUDIO_TOOLS quad bound to a single AppDb. Apps call this
 * once per Studio session and pass the result to `createSession`.
 */
export function makeStudioTools(opts: { db: AppDb }): ToolDef[] {
  return [
    studioReadDocumentTool({ db: opts.db }),
    studioReadBlockTool({ db: opts.db }),
    studioReplaceBlockTool({ db: opts.db }),
    studioInsertBlockTool({ db: opts.db }),
  ];
}
