// ============================================================
// Memo — Brain bridge
// ============================================================
//
// Thin wrapper over the W4-shipped @tytus/host-api daemon client.
// Two responsibilities:
//
//   1. appendMemo(slug, title, body) — POSTs a Logseq-outliner-formatted
//      entry to /api/brain/append. Used by Memo on every save where the
//      memo's `mirror_to_brain` flag is true. Sebastian's Brain is a
//      Logseq vault; every line MUST start with `- ` (the outliner
//      bullet prefix). The wikilink + title goes on the parent bullet,
//      body lines go on indented `  - ` children.
//
//   2. searchBacklinks(slug) — GETs /api/brain/search?q=[[slug]]. Used
//      by the Memo editor's "Brain backlinks" panel to surface every
//      Brain entry (journal/page/memo) that links to this memo. The
//      shape returned is BrainSearchResult[] from host-api.
//
// Why a bridge instead of going through host.daemon directly:
//
//   The W2/W3 host-api work shipped a `host.daemon.callPodEndpoint`
//   primitive but did NOT add a typed `host.daemon.brain` namespace.
//   The W4 daemon clients (createDaemonClient + postBrainAppend +
//   getBrainSearch) live in @tytus/host-api but are not pre-wired onto
//   HostClient. Apps that want them must construct their own client.
//   This bridge centralises that construction so Memo's UI doesn't see
//   the raw HTTP surface.
//
//   In a future host-api revision the typed brain namespace can land on
//   `host.daemon.brain` and this file collapses to a thin re-export.
//   Deferred deliberately to avoid a breaking host-api churn mid-wave.
//
// Note on baseUrl:
//
//   createDaemonClient PREPENDS /api/... to every request path (see
//   packages/host-api/src/daemon/clients.ts — postBrainAppend builds
//   `joinUrl(baseUrl, '/api/brain/append')`). So to land same-origin on
//   /api/brain/append (which the Vite dev proxy forwards to the
//   tytus-cli daemon), the baseUrl must be the empty string `''`, not
//   '/api'. Production behaves identically because the tytus-cli tray
//   server serves both the static shell and /api/* on the same origin.

import {
  createDaemonClient,
  type BrainEntry,
  type BrainSearchResult,
} from '@tytus/host-api';

export interface BrainBridge {
  /**
   * Append a memo to today's Brain journal in Logseq outliner format.
   *
   * Output shape (one POST = one entry; the body is a multi-line string):
   *   - [[slug]] Title
   *     - first body line
   *     - second body line
   *
   * Title and body are user-controlled strings. They are passed through
   * verbatim — Logseq treats `[[…]]` as the only structural marker and
   * is otherwise a plain markdown vault, so no escaping is needed for
   * legitimate user prose. Multi-line bodies are split on `\n` and each
   * line is prefixed with the indented bullet (`  - `).
   */
  appendMemo(
    slug: string,
    title: string,
    body: string,
    signal?: AbortSignal,
  ): Promise<void>;

  /**
   * Search the Brain for `[[slug]]` occurrences. Returns up to 20
   * results (capped here, not relying on a server default). The caller
   * is responsible for caching — this method is one round-trip per call.
   */
  searchBacklinks(
    slug: string,
    signal?: AbortSignal,
  ): Promise<BrainSearchResult[]>;
}

export interface CreateBrainBridgeOpts {
  /**
   * Origin prefix passed to createDaemonClient. Use `''` (empty string)
   * for same-origin requests in the Tytus shell — the daemon client
   * already prepends `/api/...` to every path. See module-level note.
   */
  baseUrl: string;
  /** Optional bearer key. Same-origin in Tytus does not need one. */
  apiKey?: string;
  /** For tests — defaults to global fetch via createDaemonClient. */
  fetchImpl?: typeof fetch;
}

const SEARCH_LIMIT = 20;

export function createBrainBridge(opts: CreateBrainBridgeOpts): BrainBridge {
  const client = createDaemonClient({
    baseUrl: opts.baseUrl,
    apiKey: opts.apiKey,
    fetchImpl: opts.fetchImpl,
  });

  return {
    async appendMemo(slug, title, body, signal) {
      const lines = body.split('\n').map((line) => `  - ${line}`);
      const composed = [`- [[${slug}]] ${title}`, ...lines].join('\n');
      const entry: BrainEntry = {
        kind: 'journal',
        body: composed,
        sourceApp: 'memo',
        tags: ['memo', `slug:${slug}`],
      };
      await client.postBrainAppend(entry, { signal });
    },

    async searchBacklinks(slug, signal) {
      const q = `[[${slug}]]`;
      return client.getBrainSearch(q, { limit: SEARCH_LIMIT, signal });
    },
  };
}
