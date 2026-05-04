/**
 * Rolling context window with summary fallback.
 *
 * Per spec §"Context window with summary fallback":
 *   1. Drop oldest non-pinned turn.
 *   2. If still over budget, run a single recursive `summary` call
 *      and replace dropped turns with a `<context_summary>` block.
 *   3. If summary fails, surface "Older context dropped" banner and
 *      proceed without summary.
 *   4. Settings → AI → Privacy → "Never summarize dropped turns" can
 *      disable summary; banner becomes the primary path.
 *   5. Rate-limit awareness: summary call doesn't fire while the parent
 *      is rate-limited.
 *
 * M2 ships the rolling-window logic + the summary-fallback contract.
 * Apps subscribe to `onTrim(callback)` to render the banner; the
 * actual `summarize` call is injected (M2.4 wires it to a chat-intent
 * call against the same model).
 */

export interface ContextTurn {
  /** Stable id — `pinned` turns share an id pattern apps recognize. */
  id: string;
  /** 'user' | 'assistant' | 'tool' | 'system' — drives prompt rendering. */
  role: 'user' | 'assistant' | 'tool' | 'system';
  /** Approximate token count for the rendered turn. The engine seeds
   *  this from the model's tokenizer once the turn is finalized; until
   *  then a heuristic 1-token-per-4-chars estimate is used. */
  approxTokens: number;
  /** When set, the turn is pinned and never dropped. System prompts +
   *  the user's initial framing are typically pinned. */
  pinned?: boolean;
  /** The actual content — opaque to the window manager. */
  content: unknown;
}

export interface ContextTrimResult {
  /** The kept turns in original order. */
  kept: ContextTurn[];
  /** The dropped turns (oldest first). */
  dropped: ContextTurn[];
  /** When summary was successful, the synthesized summary block goes
   *  here; the renderer prepends it to `kept` before sending. */
  summaryBlock?: string;
  /** When summary was attempted but failed, the raw banner reason. */
  summaryError?: string;
}

export interface SummaryFn {
  (
    droppedTurns: ContextTurn[],
    opts: { signal?: AbortSignal },
  ): Promise<string>;
}

/**
 * Trim the conversation history to fit the budget, keeping pinned
 * turns and the most recent ones. When dropping is necessary AND
 * `summary` is provided, attempt a single summary call to compress the
 * dropped turns into a `<context_summary>` block.
 *
 * Pure function modulo the injected `summary` call.
 */
export async function trimContext(
  turns: ContextTurn[],
  budget: number,
  opts: {
    summary?: SummaryFn;
    /** When true, never call the summary fn (Settings opt-out). */
    disableSummary?: boolean;
    /** When true, parent request was rate-limited; skip summary to
     *  avoid stacking rate-limit hits. */
    parentRateLimited?: boolean;
    signal?: AbortSignal;
  } = {},
): Promise<ContextTrimResult> {
  // 1. Greedy drop: walk the conversation oldest → newest, dropping
  //    non-pinned turns until total is within budget.
  const total = turns.reduce((s, t) => s + t.approxTokens, 0);
  if (total <= budget) {
    return { kept: turns.slice(), dropped: [] };
  }
  const kept: ContextTurn[] = [];
  const dropped: ContextTurn[] = [];
  // Reserve pinned turns first so we know how much slack non-pinned has.
  const pinned = turns.filter((t) => t.pinned);
  const pinnedTokens = pinned.reduce((s, t) => s + t.approxTokens, 0);
  let nonPinnedSlack = Math.max(0, budget - pinnedTokens);

  // Walk newest → oldest among non-pinned turns, keeping until slack runs out.
  const nonPinnedNewestFirst = turns
    .filter((t) => !t.pinned)
    .slice()
    .reverse();
  const keptIds = new Set<string>(pinned.map((t) => t.id));
  for (const t of nonPinnedNewestFirst) {
    if (t.approxTokens <= nonPinnedSlack) {
      keptIds.add(t.id);
      nonPinnedSlack -= t.approxTokens;
    }
  }
  for (const t of turns) {
    if (keptIds.has(t.id)) kept.push(t);
    else dropped.push(t);
  }

  // 2. If we kept nothing or the whole conversation fit, no summary.
  if (dropped.length === 0) {
    return { kept, dropped };
  }

  // 3. Summarize the dropped turns when allowed.
  if (!opts.summary || opts.disableSummary || opts.parentRateLimited) {
    return { kept, dropped };
  }
  try {
    const summaryBlock = await opts.summary(dropped, {
      signal: opts.signal,
    });
    return { kept, dropped, summaryBlock };
  } catch (err) {
    return {
      kept,
      dropped,
      summaryError:
        err instanceof Error ? err.message : 'summary call failed',
    };
  }
}
