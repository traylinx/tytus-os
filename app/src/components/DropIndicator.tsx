// ============================================================
// DropIndicator — outline / shimmer overlay for drop targets
// ============================================================
//
// Used by Desktop, FileManager pane, Dock app icons, and the Trash
// drop target. Renders absolutely-positioned within a target
// element so the parent only has to be `position: relative`. Pure
// CSS — no animation library.

import { memo } from "react";

interface DropIndicatorProps {
  /** True while a drag is over this target. */
  active: boolean;
  /** Visual variant: "outline" for grids/lists, "ring" for icon targets. */
  variant?: "outline" | "ring";
  /** Override the default accent — used by Trash to glow red on hover. */
  color?: string;
  /** Whether to render a subtle inner fill in addition to the border. */
  fill?: boolean;
}

const DropIndicator = memo(function DropIndicator({
  active,
  variant = "outline",
  color,
  fill = false,
}: DropIndicatorProps) {
  if (!active) return null;
  const accent = color ?? "var(--accent-primary)";
  if (variant === "ring") {
    return (
      <div
        className="absolute inset-0 pointer-events-none rounded-md"
        style={{
          boxShadow: `0 0 0 2px ${accent}, 0 0 24px ${accent}`,
          background: fill ? `${accent}1A` /* 10% */ : "transparent",
          transition: "box-shadow 120ms ease",
        }}
      />
    );
  }
  return (
    <div
      className="absolute inset-1 pointer-events-none rounded-lg"
      style={{
        border: `2px dashed ${accent}`,
        background: fill ? `${accent}10` : "transparent",
        animation: "dropPulse 1.6s ease-in-out infinite",
      }}
    />
  );
});

export default DropIndicator;
