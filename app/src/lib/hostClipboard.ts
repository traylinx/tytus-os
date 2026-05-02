// ============================================================
// hostClipboard — Sprint B Phase 5.4 host browser clipboard wrapper
// ============================================================
//
// `navigator.clipboard` is a permissioned API. The user has to grant
// access (sometimes per-call, sometimes once-per-session, browser-
// dependent). This wrapper:
//
//   • Gates every read behind a recorded permission state so we don't
//     re-prompt on every paste (P5.4f).
//   • Maps Clipboard API errors to a friendly string for the deny
//     toast (P5.4d). Detects browser name from userAgent for the help
//     pointer.
//   • Never auto-prompts: the caller decides when to invoke this
//     (almost always tied to a user gesture — Cmd+V keypress or a
//     "Paste from clipboard" menu item).
//
// The internal Tytus OS clipboard (Sprint A Phase 4.6) is separate
// and never touches navigator.clipboard.

export type ClipboardPermissionState = 'granted' | 'denied' | 'prompt';

export type ClipboardPayload =
  | { kind: 'text'; text: string }
  | { kind: 'image'; blob: Blob; suggestedName: string }
  | { kind: 'files'; files: File[] }
  | { kind: 'empty' };

export interface ClipboardReadResult {
  ok: boolean;
  permission: ClipboardPermissionState;
  payload: ClipboardPayload;
  /** Set when ok=false. Caller maps to a localised toast. */
  reason?: 'permission-denied' | 'unavailable' | 'empty' | 'unknown';
  /** Browser-detect hint for the deny toast: "Chrome", "Safari", etc. */
  browserName?: string;
}

/**
 * Best-effort detection of the host browser. Used purely for the
 * "enable in {browser} settings" pointer in the deny toast — we don't
 * branch behaviour on this (real branches go on feature checks).
 */
export function detectBrowserName(ua: string = typeof navigator !== 'undefined' ? navigator.userAgent : ''): string {
  if (!ua) return 'browser';
  if (/Edg\//.test(ua)) return 'Edge';
  if (/OPR\//.test(ua)) return 'Opera';
  if (/Chrome\//.test(ua)) return 'Chrome';
  if (/Firefox\//.test(ua)) return 'Firefox';
  if (/Safari\//.test(ua)) return 'Safari';
  return 'browser';
}

/**
 * Probe the current permission state without prompting. Returns
 * 'prompt' on browsers that don't expose the Permissions API for
 * 'clipboard-read' (Safari, Firefox).
 */
export async function probePermission(): Promise<ClipboardPermissionState> {
  if (typeof navigator === 'undefined' || !('permissions' in navigator)) {
    return 'prompt';
  }
  try {
    // Some browsers (notably Firefox) reject 'clipboard-read' as an
    // unknown name. Treat that as "we can't tell — prompt-on-use".
    const status = await navigator.permissions.query({
      name: 'clipboard-read' as PermissionName,
    });
    if (status.state === 'granted') return 'granted';
    if (status.state === 'denied') return 'denied';
    return 'prompt';
  } catch {
    return 'prompt';
  }
}

/**
 * Read whatever's on the host clipboard, gated by the permission
 * cache. Caller MUST invoke from a user-gesture handler (keypress,
 * click) so the permission prompt has a real gesture to attach to.
 *
 * Honors permission RECOVERY (P5.4f): if the cache says 'denied' but
 * the read succeeds, we return permission='granted' so the caller can
 * upgrade its cached state.
 */
export async function readClipboard(): Promise<ClipboardReadResult> {
  const browserName = detectBrowserName();
  if (typeof navigator === 'undefined' || !navigator.clipboard) {
    return {
      ok: false,
      permission: 'denied',
      payload: { kind: 'empty' },
      reason: 'unavailable',
      browserName,
    };
  }

  const clip = navigator.clipboard;

  // Try the rich `read()` API first — supports image/* and text/*.
  // `read()` is Chromium / recent Edge / recent Safari (text-only on
  // some configurations). Firefox lacks read() entirely; we fall back
  // to readText() below.
  if (typeof clip.read === 'function') {
    try {
      const items = await clip.read();
      for (const item of items) {
        // Prefer image/* over text — most users paste an image
        // expecting it to land as an image, not a hex string of bytes.
        const imageType = item.types.find((t) => t.startsWith('image/'));
        if (imageType) {
          const blob = await item.getType(imageType);
          const ext = imageType.split('/')[1] ?? 'png';
          const stamp = new Date()
            .toISOString()
            .replace(/[-:]/g, '')
            .replace('T', '-')
            .slice(0, 15);
          return {
            ok: true,
            permission: 'granted',
            payload: {
              kind: 'image',
              blob,
              suggestedName: `pasted-${stamp}.${ext}`,
            },
            browserName,
          };
        }
      }
      // No image — try text from the same items array
      for (const item of items) {
        const textType = item.types.find((t) => t === 'text/plain');
        if (textType) {
          const blob = await item.getType(textType);
          const text = await blob.text();
          if (text) {
            return {
              ok: true,
              permission: 'granted',
              payload: { kind: 'text', text },
              browserName,
            };
          }
        }
      }
      // Items exist but no usable kind.
      return {
        ok: false,
        permission: 'granted',
        payload: { kind: 'empty' },
        reason: 'empty',
        browserName,
      };
    } catch (err) {
      // NotAllowedError → denied; everything else → unknown.
      const denied =
        err instanceof Error &&
        (err.name === 'NotAllowedError' || /denied|permission/i.test(err.message));
      return {
        ok: false,
        permission: denied ? 'denied' : 'prompt',
        payload: { kind: 'empty' },
        reason: denied ? 'permission-denied' : 'unknown',
        browserName,
      };
    }
  }

  // Fallback for browsers without read() — text only.
  if (typeof clip.readText === 'function') {
    try {
      const text = await clip.readText();
      if (text) {
        return {
          ok: true,
          permission: 'granted',
          payload: { kind: 'text', text },
          browserName,
        };
      }
      return {
        ok: false,
        permission: 'granted',
        payload: { kind: 'empty' },
        reason: 'empty',
        browserName,
      };
    } catch (err) {
      const denied =
        err instanceof Error &&
        (err.name === 'NotAllowedError' || /denied|permission/i.test(err.message));
      return {
        ok: false,
        permission: denied ? 'denied' : 'prompt',
        payload: { kind: 'empty' },
        reason: denied ? 'permission-denied' : 'unknown',
        browserName,
      };
    }
  }

  return {
    ok: false,
    permission: 'denied',
    payload: { kind: 'empty' },
    reason: 'unavailable',
    browserName,
  };
}
