import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "FileManager.tsx"), "utf8");

describe("BindFolderModal registration recovery", () => {
  it("closes from the registered binding instead of waiting for pod verification", () => {
    const start = source.indexOf("const recoverCompletedBind = useCallback");
    const end = source.indexOf("// Close modal on stream success", start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const block = source.slice(start, end);

    expect(block).toContain("const binding = await findRecoveredBinding()");
    expect(block).toContain("const ok = await persistTargetSelection()");
    expect(block).toContain("if (ok) onSuccess()");
    expect(block).not.toContain("allSelectedPodsProvisioned");
    expect(block).not.toContain("provisionedSelectorsForBinding(binding");
  });

  it("starts recovery while the bind job is still streaming", () => {
    expect(source).toContain("bindRegistrationRecoveryStartedRef");
    expect(source).toContain("void recoverCompletedBind()");
  });

  it("wires a per-folder sync-now action", () => {
    expect(source).toContain("postSharedFoldersSyncNow");
    expect(source).toContain("files.shared.syncNow");
    expect(source).toContain("files.shared.retrySync");
  });

  it("reprovisions selected targets when live grants are missing", () => {
    expect(source).toContain("selectedProvisionSelectorsNeedingProvision");
    expect(source).toContain("liveGrantNeedsRepair");
    expect(source).toContain("grant_missing / verification_error");
  });
});
