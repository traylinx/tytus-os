# Fix design: "Ask Tytus Docs" live path is dead

- **Status:** DESIGN — not implemented. Scopes a tytus-cli (+ backend) sprint.
- **Date:** 2026-06-20
- **Owner surface:** Help app → **Live Cortex → Ask Tytus Docs**
- **Companion:** `SPRINT-CORTEX-DOCS-BRIDGE.md` (the original bridge sprint this finishes)

## Symptom

In the Help app, "Ask Tytus Docs" always shows the pill **"live docs offline · bundled manual ready"** and never answers from the live corpus. Only the bundled manual works. This reproduces on **every** machine, not just one — it has never worked end-to-end.

## Root cause (two independent failures)

### 1. The docs bearer token is never provisioned

The tray daemon resolves a Cortex bearer token in `cortex_docs_token()`:

- `services/tytus-cli/tray/src/web_server.rs:4944` — checks, in order:
  1. env `TYTUS_CORTEX_DOCS_TOKEN`
  2. env `TRAYLINX_CORTEX_TOKEN`
  3. OS keychain `("com.traylinx.atomek", "tytus-daemon-docs")` (web_server.rs:4960)
- On miss → `HelpBridgeError::MissingToken` → handler returns **HTTP 503** `{status:"degraded", reason:"docs_token_missing", fallback:"bundled"}` (web_server.rs:4675).
- The web client reads `!res.ok` and sets the offline pill (`app/src/apps/Help.tsx`, `LiveDocsPanel`, via `getCortexDocsSources` in `app/src/lib/docs/cortexClient.ts`).

**Nothing in the codebase ever writes the `tytus-daemon-docs` keychain entry.** `grep -rn "tytus-daemon-docs"` returns exactly one hit — the read at web_server.rs:4960. The only token-writing path, `tytus cortex token rotate` (`cli/src/cortex.rs:700`), is for *local* Cortex's `INTERNAL_SERVICE_TOKEN` and is **explicitly disabled** in Tytus mode (cortex.rs:706: "ctx_* token rotation is unavailable while Cortex runs in Tytus mode"). So the token is structurally always absent → always 503.

### 2. The cloud docs endpoint is not deployed at the wired path

`cortex_api_base()` (web_server.rs:4930) defaults to `https://api.makakoo.com/ma-cortex/v1/api/v1`. Unauthenticated probe on 2026-06-20:

```
GET /ma-cortex/v1/api/v1/docs/sources -> 404
GET /ma-cortex/v1/api/v1/health       -> 404
GET /ma-cortex/health                 -> 404
```

Every path under `ma-cortex` 404s, including health — so there is no public docs backend responding there today. Even with a token, `cortex_docs_answer()` (`/docs/answer`) would 404.

> Note: `cortex_docs_sources()` synthesizes an OK response on a 404 from `/docs/sources` (web_server.rs:4721) — so with a token the *status pill* could flip to "online" while real Q&A (`/docs/answer`) still fails. Don't ship the token fix without a working answer backend, or the UI will lie.

## Request path

```
Help app (browser)
  → GET  localhost:<tray>/api/help/sources   (health/probe)
  → POST localhost:<tray>/api/help/answer    (the question)
       handler: web_server.rs handle_help_sources / handle_help_answer
       token:   cortex_docs_token()           ← FAILS HERE today
       upstream: {cortex_api_base()}/docs/{sources,answer}  ← 404 today
```

## Fix options

### Option A — Provision the docs token on login (cloud corpus)
Mint/fetch a docs-scoped token during the existing auth flow and write it to keychain `tytus-daemon-docs`; refresh it in the token-refresh daemon.
- **Pros:** matches the original bridge design; "no Cortex credentials in the browser" stays true; works for all users once shipped.
- **Cons:** requires the cloud `ma-cortex` `/docs/*` API to actually exist + a mint endpoint + scope. Today it 404s, so this is blocked on **backend deploy** (failure #2). Cross-repo: tytus-cli + `services/tytus-cortex` + auth.

### Option B — Point the bridge at local Cortex
Let `TYTUS_CORTEX_API_URL` (+ token) target the user's local Cortex (`tytus cortex up`, `127.0.0.1:8098`) and serve docs Q&A from there.
- **Pros:** works fully offline; no cloud dependency; reuses the local stack the user may already run.
- **Cons:** local Cortex is opt-in and most users won't have it; needs a `/docs/*` (or memory-search) capability in the Tytus-mode image; only helps local-profile users.

### Option C — Back "docs" with the existing memory/search API
Drop the dedicated `/docs/*` contract and answer from the Cortex memory-search the chat path already uses (the code already half-anticipates this: the 404 fallback labels sources `remote-memory-search`, web_server.rs:4725).
- **Pros:** reuses a backend that is already deployed and authenticated; smallest backend lift; one credential path for chat + docs.
- **Cons:** retrieval quality depends on what's indexed; needs the manual corpus ingested into that store; bundled manual remains the canonical offline fallback.

## Recommendation

Two-step, lowest-risk-first:

1. **Unblock the backend (failure #2) before any token work.** Decide the corpus home: cloud `ma-cortex` deploy (Option A) vs. reuse memory-search (Option C). C is the smaller lift and reuses a live, authenticated backend — recommended unless a dedicated docs corpus is already planned.
2. **Then provision the token (failure #1)** on the chosen backend: write `tytus-daemon-docs` (or reuse the existing user/chat token) into keychain at login, refresh in the daemon. Keep the env-var overrides as the dev/test escape hatch.

Do **not** ship step 2 alone — without step 1 the pill flips to "online" but answers 404.

## Files to touch (implementation)

- `services/tytus-cli/tray/src/web_server.rs` — `cortex_docs_token()` (token source), `cortex_api_base()` (target), `cortex_docs_{sources,search,answer}` (backend contract).
- `services/tytus-cli/cli/src/cortex.rs` / `auth/src/keychain.rs` — add a writer for `tytus-daemon-docs` (mint-on-login or reuse existing token); keychain `set_password` helper.
- `services/tytus-cli/cli/src/main.rs` (daemon) — refresh the docs token on the existing refresh tick.
- `services/tytus-cortex/**` — deploy `/docs/*` (Option A) OR confirm the memory-search contract (Option C).
- No change required in `services/tytus-os` — the web app already renders online/offline correctly; it just needs a non-503 backend.

## Verify

1. `curl -s localhost:<tray>/api/help/sources` → 200 (not 503 `docs_token_missing`).
2. Ask a question in Help → Ask Tytus Docs → grounded answer + citations, no offline pill.
3. Token absent (fresh machine) → still graceful 503 + bundled fallback (don't regress the offline path).
4. Ships in a tytus-cli release; bump + verify against the catalog like any CLI release.

## Open questions

- Is a dedicated docs corpus planned for cloud `ma-cortex`, or do we reuse memory-search? (Picks A vs C.)
- Should the docs token be its own scoped credential or the user's existing access token reused with a docs scope?
- Does the bundled-manual corpus need ingesting into whichever backend we choose, and who owns that pipeline?
