# Lope negotiation escalated

- Reason: 3 NEEDS_FIX rounds exhausted without PASS
- Phase: 0 negotiation-round-3
- Last verdict: NEEDS_FIX
- Confidence: 0.80
- Rationale: Ensemble (1 validators): PASS=0 NEEDS_FIX=1 FAIL=0.

## Required fixes

- Phase 0 Gates B/C: define unit baseline (story points or LOC bands) so "N-line extension"/"non-trivial" map to a decidable re-scope threshold, not free text.
- Phase 0 Gate A: specify mock-equivalence contract (which endpoints, which corpus fixtures, which auth behavior) if real staging unavailable — otherwise mock drift silently breaks Phase 1 integration test.
- Phase 2: add metrics + alert spec for breaker open events, 429 rate, Cortex 5xx rate, p50/p95 latency. Without telemetry, prod rollback in Gate D is reactive-only.
- Phase 3: define behavior when `doc_id` present but anchor missing/stale in bundled doc (open to top of file? suppress deep-link?). Currently underspecified vs hash-drift case.
- Gate E: clarify which option is preferred (CI check vs alias map) and who decides — currently reads as "pick one" without owner, risks Phase 0 stalling.

## Raw validator feedback

Ensemble (1 validators): PASS=0 NEEDS_FIX=1 FAIL=0.
