/**
 * Prompt loader. Reads versioned markdown prompts from the engine's
 * bundle root via the injected AssetResolver. The prompt's frontmatter
 * carries `(app, mode, version, model_min)` — engine logs the
 * `(app, mode, version)` triple on every `done` so quality regressions
 * correlate to prompt edits.
 *
 * Per spec §"Prompts via injected AssetResolver".
 */

import type { AppId, AppMode, AssetResolver } from './types';

export interface PromptDocument {
  /** Frontmatter fields (loosely typed). The engine reads `version` for
   *  telemetry; the rest are advisory. */
  frontmatter: Record<string, string>;
  /** Markdown body sans the frontmatter block. */
  body: string;
}

/** Default file-naming scheme: `${app}-${mode}.md`. */
export function promptPath(app: AppId, mode: AppMode): string {
  return `prompts/${app}-${mode}.md`;
}

/** Parse a prompt markdown file with optional `---`-delimited frontmatter. */
export function parsePromptDocument(text: string): PromptDocument {
  // Match a leading `---\n...\n---\n` block (no whitespace before).
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (!match) {
    return { frontmatter: {}, body: text };
  }
  const frontmatter: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (key) frontmatter[key] = value;
  }
  return {
    frontmatter,
    body: text.slice(match[0].length),
  };
}

/**
 * Load + parse the prompt for the given (app, mode). Throws if the
 * AssetResolver can't find the prompt — apps fall back to a built-in
 * minimal prompt when this fails (engine's pure-TS contract: never
 * silently swallow asset failures).
 */
export async function loadPrompt(
  assets: AssetResolver,
  app: AppId,
  mode: AppMode,
  promptVersion?: string,
): Promise<PromptDocument> {
  const path = promptVersion
    ? `prompts/${app}-${mode}@${promptVersion}.md`
    : promptPath(app, mode);
  const text = await assets.text(path);
  return parsePromptDocument(text);
}
