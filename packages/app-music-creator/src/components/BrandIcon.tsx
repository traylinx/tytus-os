// ============================================================
// BrandIcon — Render a branded image asset as an app icon.
// ============================================================
//
// Workspace-package edition (W4 of the apps-platform sprint).
// Same surface as the legacy in-tree component, with one
// structural change: theme awareness no longer reaches into the
// shell's `useOS()` store. Workspace apps are insulated from
// shell internals — instead we listen to the browser's
// `prefers-color-scheme` media query.
//
// Apps that ship their own brand mark (e.g. Juli3ta) declare their
// icon as `juli3ta:mark`. The default `mark` variant is theme-aware:
// on dark theme it renders the white silhouette, on light theme
// the ink silhouette. Other variants (`mark-white`, `mark-ink`,
// `icon`) are pinned and ignore the theme.

import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';

type BrandSpec = {
  /** Public path to the asset file. */
  src: string;
  /**
   * Visual scale applied via CSS transform. Layout box stays at the
   * caller-requested `size`; the rendered pixels grow from center.
   * The bare-silhouette PNGs ship with ~25–30% transparent padding
   * around the mark — without scaling, the mark reads tiny inside
   * a dock / launcher / desktop-icon cell sized for Lucide outlines.
   */
  scale?: number;
  /** Optional drop-shadow filter for cream-on-dark surfaces. */
  filter?: string;
};

const JULI3TA_MARKS: Record<string, BrandSpec> = {
  // The mark PNGs ship with ~30% transparent padding on each side
  // (the rendered silhouette fills only ~70% of its bounding box).
  // Scaling 2.0 makes the silhouette match Lucide outline weight at
  // the same caller-passed `size`. Layout box stays at `size` — only
  // the rendered pixels grow via CSS transform — so neighbouring
  // chrome doesn't shift.
  'mark-cream': { src: '/brand/juli3ta/mark-cream-256.png', scale: 2.0 },
  'mark-ink': { src: '/brand/juli3ta/mark-ink-256.png', scale: 2.0 },
  'mark-white': { src: '/brand/juli3ta/mark-white-256.png', scale: 2.0 },
  // App-icon tile — the rounded gradient square. Reserved for big-logo
  // surfaces (loading splash, large empty states). NEVER used in dock /
  // launcher / titlebar — those use the bare silhouette so the brand
  // doesn't fight the chrome. No scale: the tile is already padded
  // to the corner radius the brand kit specifies (22%).
  icon: { src: '/brand/juli3ta/icon-gradient-256.png' },
};

const REGISTRY: Record<string, Record<string, BrandSpec>> = {
  juli3ta: JULI3TA_MARKS,
};

/** True if the icon name is a brand-asset reference like "juli3ta:mark". */
export function isBrandIconName(name: string): boolean {
  if (!name || !name.includes(':')) return false;
  const [slug] = name.split(':');
  return slug in REGISTRY;
}

// ── prefers-color-scheme hook ────────────────────────────────
//
// Replaces the legacy `useOS()` theme read. Workspace packages don't
// reach into the shell's store; the browser's media query is the
// portable, framework-agnostic equivalent. SSR-safe via the
// `typeof window` guard (the workspace package is browser-only today,
// but the guard costs nothing and lets the component be imported
// from a server-side test that has no `window`).
function usePrefersDark(): boolean {
  const [isDark, setIsDark] = useState<boolean>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => setIsDark(e.matches);
    // addEventListener is the modern API; older Safari only had addListener.
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const legacy = mql as unknown as { addListener: (fn: (e: MediaQueryListEvent) => void) => void; removeListener: (fn: (e: MediaQueryListEvent) => void) => void };
    legacy.addListener(onChange);
    return () => legacy.removeListener(onChange);
  }, []);
  return isDark;
}

interface BrandIconProps {
  name: string;
  size?: number;
  className?: string;
  style?: CSSProperties;
  /** Override alt text. Defaults to the slug (e.g. "JULI3TA"). */
  alt?: string;
  /**
   * Override the per-spec scale. Use 1 to render the PNG at exactly
   * `size` (in-app titlebars / dense contexts where overflow would
   * collide with chrome). Default behaviour applies the spec's scale,
   * which oversizes mark variants for dock/launcher/desktop fill.
   */
  scale?: number;
}

export function BrandIcon({ name, size = 24, className, style, alt, scale: scaleProp }: BrandIconProps) {
  const [slug, variant = 'mark'] = name.split(':');
  const variants = REGISTRY[slug];
  const prefersDark = usePrefersDark();

  let spec: BrandSpec | undefined;
  if (variant === 'mark') {
    // Theme-aware: white on dark, ink on light. Matches the brand
    // kit's "cream → dark surfaces, ink → light surfaces" rule but
    // uses the harder-contrast white instead of cream so the dock
    // / launcher silhouette doesn't fade against grey chrome.
    spec = prefersDark
      ? variants?.['mark-white']
      : variants?.['mark-ink'];
  } else {
    spec = variants?.[variant];
  }
  if (!spec) return null;
  const altText = alt ?? slug.charAt(0).toUpperCase() + slug.slice(1);
  const scale = scaleProp ?? spec.scale ?? 1;
  return (
    <img
      src={spec.src}
      alt={altText}
      width={size}
      height={size}
      style={{
        width: size,
        height: size,
        objectFit: 'contain',
        display: 'inline-block',
        verticalAlign: 'middle',
        userSelect: 'none',
        pointerEvents: 'none',
        ...(scale !== 1 ? { transform: `scale(${scale})`, transformOrigin: 'center' } : null),
        ...(spec.filter ? { filter: spec.filter } : null),
        ...style,
      }}
      className={className}
      draggable={false}
    />
  );
}
