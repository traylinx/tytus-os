import { describe, expect, it } from "vitest";

import { sharedFolderSyncCategory } from "./FileManager";
import type { Binding, SharedFolderSyncStatus } from "../types/daemon/Binding";

// Minimal Binding carrying just the sync_status under test.
const b = (sync?: SharedFolderSyncStatus): Binding =>
  ({
    auto_sync: true,
    bound_at: "",
    bucket: "cv",
    interval_sec: 60,
    local_path: "/Users/x/CV",
    plist_label: "",
    pods_provisioned: [],
    schema_version: 1,
    workdir: "/w",
    sync_status: sync,
  }) as Binding;

describe("sharedFolderSyncCategory — Phase 4 truthful state mapping", () => {
  it("returns null without sync_status", () => {
    expect(sharedFolderSyncCategory(b(undefined))).toBeNull();
  });

  it("live in-flight sync wins over endpoint health", () => {
    expect(sharedFolderSyncCategory(b({ state: "syncing", phase: "initial_resync" }))).toBe(
      "initialSyncing",
    );
    expect(sharedFolderSyncCategory(b({ state: "syncing" }))).toBe("syncing");
  });

  it("dead endpoint => failed even when local baseline says synced", () => {
    expect(
      sharedFolderSyncCategory(
        b({
          state: "synced",
          endpoint_health: { state: "failed", reachable: false, consecutive_failures: 128, stale: false },
        }),
      ),
    ).toBe("failed");
  });

  it(">=3 consecutive failures => failed", () => {
    expect(
      sharedFolderSyncCategory(
        b({ state: "synced", endpoint_health: { state: "ok", reachable: true, consecutive_failures: 3, stale: false } }),
      ),
    ).toBe("failed");
  });

  it("ok endpoint => synced; with excluded deps => syncedExcludes", () => {
    expect(
      sharedFolderSyncCategory(
        b({ state: "synced", endpoint_health: { state: "ok", reachable: true, consecutive_failures: 0, stale: false } }),
      ),
    ).toBe("synced");
    expect(
      sharedFolderSyncCategory(
        b({ state: "synced", endpoint_health: { state: "ok", reachable: true, stale: false, excluded: { dependency: 124 } } }),
      ),
    ).toBe("syncedExcludes");
  });

  it("degraded endpoint => degraded", () => {
    expect(
      sharedFolderSyncCategory(
        b({ state: "synced", endpoint_health: { state: "degraded", reachable: true, consecutive_failures: 1, stale: false } }),
      ),
    ).toBe("degraded");
  });

  it("stale or missing health is never trusted as synced (backward compat)", () => {
    // stale health
    expect(
      sharedFolderSyncCategory(
        b({ state: "synced", endpoint_health: { state: "ok", reachable: true, stale: true } }),
      ),
    ).toBe("unknown");
    // old daemon: no endpoint_health at all
    expect(sharedFolderSyncCategory(b({ state: "synced" }))).toBe("unknown");
  });

  it("pending is preserved", () => {
    expect(sharedFolderSyncCategory(b({ state: "pending" }))).toBe("pending");
  });
});
