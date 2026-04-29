import { describe, expect, it } from "vitest";
import { createDaemonClient, newIdempotencyKey } from "@/lib/daemon";

// Idempotency-Key wiring on the client side. The daemon's own caching
// behavior (TTL, replay, eviction) is covered by web_server.rs unit
// tests. What we pin here:
//   - newIdempotencyKey() never returns empty
//   - The header is attached on POST when a key is provided
//   - The header is NOT attached on GET (idempotent by spec)
//   - Different calls with the same key produce identical
//     Idempotency-Key headers (so the client genuinely dedupes —
//     this is the property that prevents a flaky-network double-spawn)

describe("newIdempotencyKey", () => {
  it("never returns empty", () => {
    for (let i = 0; i < 10; i++) {
      const k = newIdempotencyKey();
      expect(k).toBeTruthy();
      expect(k.length).toBeGreaterThan(0);
    }
  });

  it("returns distinct values across calls", () => {
    const a = newIdempotencyKey();
    const b = newIdempotencyKey();
    expect(a).not.toBe(b);
  });
});

describe("Idempotency-Key header wiring", () => {
  it("attaches Idempotency-Key on destructive POST when key is set", async () => {
    const seen: Array<Record<string, string>> = [];
    const fakeFetch: typeof fetch = async (_input, init) => {
      seen.push(
        Object.fromEntries(
          Object.entries((init?.headers ?? {}) as Record<string, string>),
        ),
      );
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };
    const client = createDaemonClient({ fetch: fakeFetch });
    const key = "test-restart-pod-02-abc123";
    await client.postPodRestart("02", undefined, key);
    expect(seen[0]?.["Idempotency-Key"]).toBe(key);
  });

  it("does NOT attach Idempotency-Key when no key supplied", async () => {
    const seen: Array<Record<string, string>> = [];
    const fakeFetch: typeof fetch = async (_input, init) => {
      seen.push(
        Object.fromEntries(
          Object.entries((init?.headers ?? {}) as Record<string, string>),
        ),
      );
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };
    const client = createDaemonClient({ fetch: fakeFetch });
    await client.postPodRestart("02");
    expect(seen[0]?.["Idempotency-Key"]).toBeUndefined();
  });

  it("does NOT attach Idempotency-Key on GET requests", async () => {
    // GETs are idempotent by HTTP spec; sending a key on them just
    // wastes header bytes and could confuse log analytics.
    const seen: Array<Record<string, string>> = [];
    const fakeFetch: typeof fetch = async (_input, init) => {
      seen.push(
        Object.fromEntries(
          Object.entries((init?.headers ?? {}) as Record<string, string>),
        ),
      );
      return new Response(
        JSON.stringify({
          logged_in: true,
          email: "x@y",
          tier: "operator",
          agents: [],
          included: [],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    };
    const client = createDaemonClient({ fetch: fakeFetch });
    await client.getState();
    expect(seen[0]?.["Idempotency-Key"]).toBeUndefined();
  });

  it("reuses the same key across multiple retries (dedupe property)", async () => {
    // The whole point of Idempotency-Key is that a single user gesture
    // mints ONE key and any retries reuse it. If the client minted a
    // fresh key on each call the daemon couldn't dedupe.
    const seen: string[] = [];
    const fakeFetch: typeof fetch = async (_input, init) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      const k = headers["Idempotency-Key"];
      if (k) seen.push(k);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };
    const client = createDaemonClient({ fetch: fakeFetch });
    const key = newIdempotencyKey();
    await client.postPodRestart("02", undefined, key);
    await client.postPodRestart("02", undefined, key);
    await client.postPodRestart("02", undefined, key);
    expect(seen).toEqual([key, key, key]);
  });

  it("attaches the header on postInstall (long-running job mint)", async () => {
    // postInstall mints a job_id; if the user double-clicks Install,
    // both clicks must dedupe to the same job_id via the same key.
    const seen: Array<Record<string, string>> = [];
    const fakeFetch: typeof fetch = async (_input, init) => {
      seen.push(
        Object.fromEntries(
          Object.entries((init?.headers ?? {}) as Record<string, string>),
        ),
      );
      return new Response(JSON.stringify({ job_id: "job-123" }), {
        status: 200,
      });
    };
    const client = createDaemonClient({ fetch: fakeFetch });
    const key = newIdempotencyKey();
    await client.postInstall("nemoclaw", "02", undefined, key);
    expect(seen[0]?.["Idempotency-Key"]).toBe(key);
  });
});
