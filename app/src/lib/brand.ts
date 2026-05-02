export const TYTUS_WALLPAPERS = [
  { id: '/wallpapers/tytusOS-bg1.png', name: 'Tytus Aurora' },
  { id: '/wallpapers/tytusOS-bg2.png', name: 'Tytus Ember' },
  { id: '/wallpapers/tytusOS-bg3.png', name: 'Tytus Spectrum' },
  { id: '/wallpapers/tytusOS-bg4.png', name: 'Tytus Night' },
] as const;

export const DEFAULT_TYTUS_WALLPAPER = TYTUS_WALLPAPERS[2].id;

/** Sentinel stored in `state.theme.wallpaper` when the user has uploaded
 *  their own image. The actual bytes live in SQLite (`wallpaper_custom`). */
export const CUSTOM_WALLPAPER_SENTINEL = 'custom';

export const isTytusWallpaper = (value: string): boolean =>
  TYTUS_WALLPAPERS.some((wallpaper) => wallpaper.id === value);

/** Color value stored in theme.wallpaper. Accepts:
 *   - `#abc` / `#aabbcc` / `#aabbccdd`
 *   - `rgb(...)` / `rgba(...)`
 *   - `hsl(...)` / `hsla(...)`
 *  Anything else is rejected so legacy values still flow through the
 *  preset-or-default reset path in App.tsx. */
const COLOR_RE = /^(#([0-9a-fA-F]{3,8})|rgb[a]?\(.+\)|hsl[a]?\(.+\))$/;
export const isColorValue = (value: string): boolean => COLOR_RE.test(value.trim());

export type BackgroundDescriptor =
  | { kind: 'preset'; url: string; name: string }
  | { kind: 'custom' }
  | { kind: 'color'; value: string }
  | { kind: 'unknown' };

/** Parse a `state.theme.wallpaper` value into one of the four kinds.
 *  `'unknown'` is returned for legacy / corrupt values; App.tsx resets
 *  those to DEFAULT_TYTUS_WALLPAPER on next render. */
export const parseBackground = (value: string): BackgroundDescriptor => {
  if (value === CUSTOM_WALLPAPER_SENTINEL) return { kind: 'custom' };
  if (isColorValue(value)) return { kind: 'color', value: value.trim() };
  const preset = TYTUS_WALLPAPERS.find((w) => w.id === value);
  if (preset) return { kind: 'preset', url: preset.id, name: preset.name };
  return { kind: 'unknown' };
};

/** True for any value the renderer knows how to display without a fall-back. */
export const isValidBackgroundValue = (value: string): boolean =>
  parseBackground(value).kind !== 'unknown';
