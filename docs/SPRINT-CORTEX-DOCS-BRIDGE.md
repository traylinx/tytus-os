# SPRINT-TYTUS-CORTEX-DOCS-BRIDGE

## Origin: user request

Add live shared Cortex documentation search and answers to TytusOS via a secure daemon bridge, without duplicating embeddings or Cortex. Bundled docs remain offline fallback; Help app gains an "Ask Tytus Docs" live mode that calls a local tytus daemon, which proxies to the Traylinx Cortex API against the same Postgres/pgvector `memories` table powering traylinx.com/chatbot.

## Phases

### Phase 0: Pre-sprint gates (blocking)

**Goal:** Resolve the known blockers before any phase ships. None of Phases 1–4 begin until every Phase 0 gate is green and signed off in the sprint scorecard. Phase 0 produces no shipped code in this repo, but its outputs (staging URL, keychain-wrapper status, registry stable-ID status, cross-repo owners) become inputs to subsequent phases.

**Unit baseline for re-scope decisions:**
- Trivial extension: <= 80 LOC changed, no new dependency, no persistence/schema migration, <= 1 unit.
- Small extension: 81-250 LOC changed, no schema migration, <= 3 units.
- Non-trivial extension: > 250 LOC, any schema/persistence migration, any new auth primitive, or any cross-platform secret-store behavior change, > 3 units.
- Any "non-trivial" finding pauses the sprint and requires an explicit re-estimate before implementation starts.

**Criteria:**
- **Gate A — Cortex staging reachability:** confirm a Traylinx Cortex staging environment exists, has the docs-hub / traylinx-public-references / traylinx-user-manuals corpus loaded, and is reachable from a developer machine. If not, stand it up before Phase 1 starts, or create a contract-equivalent mock with these exact properties: implements `POST /docs/search`, `POST /docs/answer`, `GET /docs/sources`; enforces bearer-token auth with 401/403 branches; returns at least 10 deterministic corpus fixtures across the three source IDs; includes stable `doc_id`, optional `anchor`, source URL, score, corpus hash, source versions, API version; supports 429 and 5xx fixture modes. Output: staging base URL or mock base URL + auth path + fixture hash recorded in the sprint doc.
- **Gate B — Keychain wrapper status:** confirm whether the `tytus-cli` auth crate keychain wrapper supports an additional named entry (`tytus-daemon-docs`) on macOS Keychain / libsecret / Windows Credential Manager. Output: one of {"supported as-is", "trivial extension", "small extension", "non-trivial — re-scope Phase 2"} using the unit baseline above. If non-trivial, Phase 2 scope is re-estimated before sprint start.
- **Gate C — Registry stable-ID status:** confirm whether `app/src/lib/docs/registry.ts` already exposes a stable per-doc ID or can be extended to without touching existing routes. Output: one of {"present", "trivial extension", "small extension", "non-trivial — re-scope Phase 3"} using the unit baseline above. If non-trivial, Phase 3 scope is re-estimated or the deep-link claim is dropped before sprint start.
- **Gate D — Cross-repo coordination plan:** Phase 1 ships in `traylinx/cortex` (separate repo, separate CI/deploy). Record: named PR owner on the Cortex side, named reviewer on the TytusOS side, merge→staging→prod cadence, sprint-board mirror item tracking the Cortex PR, and rollback procedure if the Cortex deploy regresses post-merge (revert PR + daemon circuit-breaker absorbs failures via Phase 2 degraded envelope).
- **Gate E — Doc ID stability policy:** TytusOS owner decides during Phase 0. Preferred option: maintain a `doc_id` alias map (`old_slug → current_slug`) checked into the corpus + registry, populated on rename, because docs marketing URLs can evolve. Alternate option only if alias-map work is non-trivial by the unit baseline: "never-rename" enforced via a CI check in the docs repo that fails on path rename for any doc with a registered `doc_id`. Hand-wavy "guaranteed not to change" is not acceptable; one mechanism must be selected before Phase 1.

**Files:**
- Sprint scorecard (this doc) — Phase 0 results section.
- No code changes in this phase.

**Tests:**
- N/A — Phase 0 is a gating checklist. Each gate is signed off by name in the scorecard.

### Phase 1: Cortex docs query API (Traylinx Cortex repo)

**Goal:** Ship a read-only Cortex HTTP surface (`/docs/search`, `/docs/answer`, `/docs/sources`) in the `traylinx/cortex` service, reusing the existing mistral-embed 1024d corpus. No new ingestion, no schema changes. This phase MUST be deployed to the Phase-0-confirmed staging environment before Phase 2 begins. PR owner and rollback procedure are the Phase 0 Gate D outputs.

**Criteria:**
- Three endpoints: `POST /docs/search` (snippets + citations + scores), `POST /docs/answer` (grounded answer + citations + model/version), `GET /docs/sources` (corpus source IDs, per-source version, last-refreshed timestamp, **corpus content hash**, API version).
- Filters on search/answer: `app`, `source` allowlist, `k` (server-clamped, **max k = 20**, default 5), `min_score` (0.0–1.0).
- **Concrete limits:** per-request timeout 10s server-side; max query length 2,000 chars (413 over); max response payload 256 KB; per-token rate budget **60 req/min sustained, burst 20**; 429 includes `Retry-After` in seconds.
- Auth via `tytus-daemon-docs` service token, scoped to docs read only — no DB access, no broader Cortex memory read.
- Citations carry stable `doc_id` + optional `anchor` from corpus metadata, conforming to the Phase 0 Gate E policy (never-rename CI check OR alias map). If the alias map path was chosen, `/docs/sources` includes the current alias map version.
- Response shape versioned via `X-Cortex-Docs-API: v1`; error envelope matches existing Cortex conventions.
- **Token lifecycle:** shared service token issued via Cortex admin CLI, rotated quarterly (90d), revocable through the same CLI. Documented in the API reference doc.
- **Logging/PII threat model (resolved):** request bodies are NOT logged at any level by default; not persisted beyond request span. The previously proposed SHA-256-of-query info log is **dropped** — short doc-lookup queries are low-entropy and the hash is reversible via dictionary attack. Debug logging of full bodies is gated behind an off-by-default flag intended only for local development; production deploys must reject that flag.

**Files:**
- `traylinx/cortex` service: new `docs` router + handler module.
- Cortex secrets manager entry for `tytus-daemon-docs` token.
- `docs/hubs/documentation/architecture/cortex/documentation-ingestion.md` — append "Docs Query API" section pointing at the new endpoints.
- Cortex API reference doc (OpenAPI snippet) for the three endpoints, including token lifecycle + logging policy.

**Tests:**
- Unit tests per endpoint: happy path, filter application, k/min_score/length clamping, unknown source rejection.
- Auth tests: missing token → 401; wrong-scope token → 403; correct token → 200.
- Rate-limit test: 60/min sustained passes; 21st burst request → 429 with `Retry-After`.
- Logging test: query text never appears in any log level by default; debug-flag gate refuses to enable in a prod-marked environment.
- Integration test against Phase 0 Gate A staging: at least one citation resolves to a real doc URL/anchor in the corpus.

### Phase 2: tytus daemon docs bridge

**Goal:** Add `/api/help/search`, `/api/help/answer`, `/api/help/sources` to the local tytus daemon in `services/tytus-cli/`, forwarding to the Phase 1 Cortex endpoints with a token loaded from the keychain entry confirmed in Phase 0 Gate B.

**Criteria:**
- Daemon binds to `127.0.0.1` only; rejects requests whose `Origin`/`Host` indicates a non-loopback or non-tray caller.
- Endpoints accept the Phase 1 filter shape and forward verbatim; daemon never accepts a Cortex URL or token from the UI.
- **Token storage:** OS keychain entry `tytus-daemon-docs` accessed through the `tytus-cli` auth crate keychain wrapper (same store used for Sentinel/device-auth tokens). Backing store per platform: macOS Keychain / libsecret / Windows Credential Manager. Wrapper extension (if needed per Gate B) is in scope here.
- Token absent → endpoints return 503 with `{ status: "degraded", reason: "docs_token_missing" }`.
- Network failures and Cortex 5xx → `{ status: "degraded", reason, fallback: "bundled" }`.
- **Concrete client behavior:** per-request timeout 12s (Cortex 10s + 2s slack); 429 honored via `Retry-After`; exponential backoff base 500ms, max 8s, jitter ±25%; circuit breaker opens after **5 consecutive 429/5xx**, cool-down 60s, half-open on next request after cool-down.
- `GET /api/help/sources` cached in-memory **5 minutes** (corpus hash changes are rare; 60s added drift-detection lag with no real load benefit). Includes corpus hash so the app can detect drift. Search/answer not cached.
- Logging: request id + latency + Cortex status only; query body never logged at any level by default.
- Metrics emitted from daemon: `tytus_help_requests_total{endpoint,status}`, `tytus_help_breaker_open_total`, `tytus_help_cortex_429_total`, `tytus_help_cortex_5xx_total`, `tytus_help_latency_ms{quantile=p50|p95}`. Alert thresholds: breaker open > 3 times in 10 minutes, 429 rate > 10% for 10 minutes, Cortex 5xx rate > 5% for 10 minutes, p95 latency > 4s for 15 minutes. Alerts are warning-level in beta and feed the rollback decision in Gate D.

**Files:**
- `services/tytus-cli/` daemon HTTP router: new `help` module with three handlers + thin Cortex client (with backoff + breaker).
- `services/tytus-cli/` auth/secret loader: extend (per Gate B output) to read the `tytus-daemon-docs` keychain entry.
- `services/tytus-cli/` tests directory for handlers, client, breaker, and bind-scope.

**Tests:**
- Handler unit tests with a fake Cortex transport: 200 passthrough, 401/403/5xx mapping, 12s timeout → degraded envelope.
- 429 + breaker tests: `Retry-After` honored; 5 consecutive failures open the breaker; breaker auto-closes after 60s cool-down via half-open probe.
- Bind-scope test: daemon refuses non-loopback connection attempts.
- Secret-missing test: endpoints return 503 with `docs_token_missing`.
- Filter forwarding test: `app`/`source`/`k` reach the Cortex client unchanged; unknown fields stripped.
- Source-cache test: two `GET /sources` calls within 5min hit Cortex once; cache exposes corpus hash to callers.

### Phase 3: Help app live "Ask Tytus Docs" mode + citation contract

**Goal:** Extend `app/src/apps/Help.tsx` with a live search/ask mode backed by a new docs client that talks only to the daemon, and implement the citation→bundled-doc resolver per the Phase 0 Gate C and Gate E outputs.

**Criteria:**
- `app/src/lib/docs/cortexClient.ts` (new) calls daemon endpoints via the existing host/tray bridge — no direct `fetch` to Cortex or pod URLs.
- **Citation ID contract:** corpus citations carry `{ doc_id, anchor? }` from Phase 1. The bundled docs registry exposes the same `doc_id` keys. `doc_id` stability is enforced per Gate E (never-rename CI check or alias map). If Gate C returned "non-trivial — re-scope," this phase ships without deep-linking and all citations open externally (see fallback UX below).
- **Corpus drift guard:** Help reads the corpus hash from `GET /api/help/sources` and compares against the bundled-docs vintage hash baked into the registry at build time. On mismatch, deep-links are suppressed for diverged docs (those open externally) and a one-line drift notice appears in the status banner.
- **External-citation UX (defined):** "external open" on a desktop tray app means the host bridge invokes the OS default browser via the existing tray/host shell-open surface (the same mechanism used for any other outbound link from TytusOS). It is **not** an in-app webview. The host bridge does not gain a new surface for this phase; if the existing surface lacks a shell-open primitive, that gap is recorded as a Phase 3 verification finding before declaring the phase done.
- Live mode UI: search input + answer panel with inline citations; bundled deep-link when contract is satisfied + hashes match, otherwise external open per above.
- Anchor fallback: if `doc_id` resolves but `anchor` is absent or stale, open the top of the bundled doc and show a small "section moved" hint beside the citation. If the `doc_id` itself is unknown, suppress bundled deep-link and use external open. If corpus hash drift is detected, suppress bundled deep-links for affected docs and use external open.
- Daemon `degraded` / `docs_token_missing` / offline → auto-fallback to existing bundled `registry.ts` browser + non-blocking status banner.
- Bundled docs browser, diagnostics tab, existing routes unchanged when live mode is off.

**Files:**
- `app/src/apps/Help.tsx` — live mode UI, status banner, citation rendering, fallback wiring, drift handling.
- `app/src/lib/docs/cortexClient.ts` — new client (search/answer/sources) over the daemon bridge.
- `app/src/lib/docs/registry.ts` — add (per Gate C) a stable-ID export + citation resolver helper; existing browser behavior unchanged.

**Tests:**
- Component tests for Help: live mode renders results + citations; degraded state renders bundled browser + banner; toggling live/offline does not unmount diagnostics.
- Client tests for `cortexClient.ts`: shapes requests correctly, surfaces daemon error envelopes, never constructs Cortex URLs.
- Resolver tests: known `doc_id` resolves to a bundled file when hashes match; resolver returns "external-only" when hashes diverge or `doc_id` is unknown; alias-map path (if Gate E selected it) resolves an old slug to the current bundled file.
- External-open test: external-only citation invokes the host shell-open surface, not an in-app webview.
- Snapshot test for the bundled-docs path proving no regression when live mode is disabled.

### Phase 4: Status surface, gated rollout, and acceptance QA

**Goal:** Surface docs corpus/source/version/online status in Settings/About, gate live mode behind a feature flag with a clean rollback, and run the blocking acceptance QA matrix. The Atomek/JULI3TA/Chat help-routing changes proposed earlier are **out of scope for this sprint** — they are a separate concern from the bridge itself and would balloon the surface without aiding the bridge ship; they go to a follow-up sprint that depends on this one.

**Criteria:**
- Settings/About panel shows: live docs online/offline, corpus source IDs, last-refreshed timestamp, **corpus hash + bundled-docs vintage hash (with drift indicator)**, daemon version, and Cortex API version.
- **Feature flag `help.liveDocs` defaults OFF.** Flips ON only via explicit Settings toggle by the user. The previously proposed first-successful-query auto-flip and 1.5s probe are both dropped — single-call probes flap and implicit flips surprise users.
- `docs/user-manual/atomek.md` line about "Atomek has embedded docs" updated to describe bundled-as-fallback + live Cortex when daemon is reachable and flag is on.
- `docs/user-manual/resource-fabric.md` notes Help live mode uses the daemon bridge (no direct fetch).
- Rollback path: setting `help.liveDocs=false` returns Help to pre-sprint bundled-only behavior with no further changes.
- **Acceptance QA matrix (blocking gate, owner: named in scorecard):** four installs must each land in a usable Help state before phase sign-off — (1) daemon running + valid token + flag on, (2) daemon stopped, (3) daemon up but no service token, (4) corpus-hash drift. Results recorded with screenshots in the scorecard.

**Files:**
- `app/src/apps/Settings.tsx` (or About panel) — docs status section incl. hash drift indicator.
- `docs/user-manual/atomek.md` — update embedded-docs sentence.
- `docs/user-manual/resource-fabric.md` — daemon-bridge note.
- Feature flag config wherever TytusOS flags live in `app/`.

**Tests:**
- Settings/About component test: renders all status fields including drift indicator; handles `sources` failure gracefully.
- Flag tests: default-off renders bundled-only Help; explicit on → live mode; degraded daemon with flag on still falls back without crashing; manual off restores pre-sprint behavior.
- Acceptance QA matrix executed and signed off (see Criteria) — sprint cannot ship without all four states green.
