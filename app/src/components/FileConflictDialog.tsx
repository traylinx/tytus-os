// ============================================================
// FileConflictDialog — Replace / Keep both / Skip / Cancel-all
// ============================================================
//
// Shown by Phase 3.6 file ops (drag-drop, paste, restore) when the
// destination already contains an item with the same name. The
// caller passes the ordered conflict list; the dialog returns
// resolutions (with optional "apply to all") via the `onResolve`
// callback. Dialog is modal — only one collision flow runs at a
// time.

import { memo, useState, useEffect } from "react";
import { CONFLICT_RESOLUTIONS, type ConflictResolution } from "@/lib/files/conflict";
import { registerShortcut } from "@/lib/shortcuts";

export interface FileConflict {
  /** Display name (the file/folder being dragged in). */
  name: string;
  /** Human-readable destination context — e.g. "Documents/" — for clarity. */
  destLabel?: string;
}

interface FileConflictDialogProps {
  open: boolean;
  conflicts: FileConflict[];
  onResolve: (
    resolutions: ConflictResolution[],
    applyToAll: boolean,
  ) => void;
  onCancel: () => void;
}

const FileConflictDialog = memo(function FileConflictDialog({
  open,
  conflicts,
  onResolve,
  onCancel,
}: FileConflictDialogProps) {
  const [applyAll, setApplyAll] = useState(true);
  const [pickedAll, setPickedAll] = useState<ConflictResolution>("keep-both");
  const [perItem, setPerItem] = useState<ConflictResolution[]>([]);

  // Reset state when the dialog opens with a new batch.
  useEffect(() => {
    if (open) {
      setApplyAll(conflicts.length > 1);
      setPickedAll("keep-both");
      setPerItem(conflicts.map(() => "keep-both"));
    }
  }, [open, conflicts]);

  // Esc closes the dialog as Cancel-all.
  useEffect(() => {
    if (!open) return;
    return registerShortcut("modal", "Esc", () => {
      onCancel();
    });
  }, [open, onCancel]);

  if (!open || conflicts.length === 0) return null;

  const submit = () => {
    if (applyAll) {
      onResolve(
        conflicts.map(() => pickedAll),
        true,
      );
    } else {
      onResolve(perItem, false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[6000] flex items-center justify-center"
      style={{ background: "var(--bg-scrim)" }}
    >
      <div
        className="rounded-lg max-w-lg w-full p-6 space-y-4"
        style={{
          background: "var(--bg-window)",
          color: "var(--text-primary)",
          border: "1px solid var(--border-default)",
          boxShadow: "var(--shadow-xl)",
        }}
      >
        <div>
          <h2 className="text-lg font-semibold">
            Items already exist
          </h2>
          <p className="text-sm text-[var(--text-secondary)] mt-1">
            {conflicts.length === 1
              ? `"${conflicts[0].name}" already exists${conflicts[0].destLabel ? ` in ${conflicts[0].destLabel}` : ""}.`
              : `${conflicts.length} items already exist at the destination.`}
          </p>
        </div>

        {conflicts.length > 1 && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={applyAll}
              onChange={(e) => setApplyAll(e.target.checked)}
            />
            Apply to all {conflicts.length} items
          </label>
        )}

        {applyAll || conflicts.length === 1 ? (
          <div className="flex flex-col gap-1">
            {(CONFLICT_RESOLUTIONS.filter((r) => r !== "cancel-all") as ConflictResolution[]).map((r) => (
              <label key={r} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="resolution"
                  checked={pickedAll === r}
                  onChange={() => setPickedAll(r)}
                />
                {labelFor(r)}
              </label>
            ))}
          </div>
        ) : (
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {conflicts.map((c, i) => (
              <div key={i} className="flex items-center justify-between gap-3 text-xs">
                <span className="truncate">{c.name}</span>
                <select
                  value={perItem[i] ?? "keep-both"}
                  onChange={(e) => {
                    const next = [...perItem];
                    next[i] = e.target.value as ConflictResolution;
                    setPerItem(next);
                  }}
                  className="text-[var(--text-primary)]"
                  style={{ background: "var(--bg-input)" }}
                >
                  {(CONFLICT_RESOLUTIONS.filter((r) => r !== "cancel-all") as ConflictResolution[]).map((r) => (
                    <option key={r} value={r}>
                      {labelFor(r)}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 rounded text-sm"
            style={{
              border: "1px solid var(--border-default)",
              color: "var(--text-primary)",
            }}
          >
            Cancel all
          </button>
          <button
            type="button"
            onClick={submit}
            className="px-3 py-1.5 rounded text-sm font-medium"
            style={{
              background: "var(--accent-primary)",
              color: "var(--text-on-accent)",
            }}
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
});

function labelFor(r: ConflictResolution): string {
  switch (r) {
    case "replace":
      return "Replace existing";
    case "keep-both":
      return "Keep both (rename)";
    case "skip":
      return "Skip";
    case "cancel-all":
      return "Cancel all";
  }
}

export default FileConflictDialog;
