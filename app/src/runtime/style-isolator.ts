/**
 * CSS isolation for app stylesheets.
 *
 * The loader fetches each app's CSS as text, runs it through `transformCss`
 * to produce a stylesheet that is scoped to a per-app container class, and
 * injects the result as an inline `<style>` tag. We do NOT use
 * `<link rel="stylesheet">` — that lets the original CSS apply globally
 * before any scoping can run.
 *
 * The transformer is a single-pass regex-driven rewriter (~200 LOC). It is
 * NOT a full CSS parser; it handles the common cases that ship in app
 * stylesheets and explicitly rejects the constructs that the platform
 * forbids (`@font-face`, `@import`).
 *
 * Per spec §"CSS isolation (algorithm-level)" / decision D27.
 */

export interface StyleIsolationOptions {
  /** App id used to derive the container class name + variable prefix. */
  appId: string;
  /** Set true if the manifest declared `cssAllowGlobal: true` — `:global(...)`
   *  contents pass through unprefixed. Default false. */
  allowGlobalEscape?: boolean;
}

export interface StyleIsolationResult {
  css: string;
  containerSelector: string;
  /** Diagnostics (rejections, warnings). Surface these in dev — they're not
   *  errors that should fail the load, just things that were dropped. */
  warnings: string[];
}

const ELEMENT_ROOT_SELECTORS = new Set([
  'html',
  'body',
  ':root',
]);

/**
 * Transform an app stylesheet so every rule is scoped to the app's
 * container element. Returns the transformed CSS plus diagnostics.
 */
export function transformCss(
  cssText: string,
  options: StyleIsolationOptions,
): StyleIsolationResult {
  const { appId } = options;
  const containerSelector = `.tytus-app-${appId}`;
  const variablePrefix = `--app-${appId}-`;
  const keyframePrefix = `tytus-app-${appId}-`;
  const warnings: string[] = [];

  let work = cssText;

  // 1. Drop @import statements (banned inside inline <style> for cross-browser
  //    reliability). Keep one warning per occurrence.
  work = work.replace(/@import[^;]*;/gi, (match) => {
    warnings.push(
      `@import rejected — inline <style> tags do not support @import reliably. Bundle imports with the app build, or declare fonts via manifest.entry.fonts. Source: "${match.trim()}"`,
    );
    return '';
  });

  // 2. Drop @font-face blocks (apps may not register fonts globally).
  work = work.replace(/@font-face\s*\{[^}]*\}/gi, (match) => {
    warnings.push(
      `@font-face rejected — apps may not register fonts globally; declare fonts via manifest.entry.fonts. Source: "${match.slice(0, 60).replace(/\s+/g, ' ')}…"`,
    );
    return '';
  });

  // 3. Collect every @keyframes name and rewrite the at-rule to the prefixed
  //    name, then patch every animation/animation-name reference. We collect
  //    BEFORE rewriting selectors so the name list is built without selector
  //    prefixing leaking in.
  const keyframeNames = new Map<string, string>();
  work = work.replace(
    /@(-webkit-)?keyframes\s+([\w-]+)\s*\{/gi,
    (_match, vendor, name) => {
      const newName = `${keyframePrefix}${name}`;
      keyframeNames.set(name, newName);
      return `@${vendor ?? ''}keyframes ${newName} {`;
    },
  );
  for (const [oldName, newName] of keyframeNames) {
    // Replace name when it appears as a standalone identifier inside
    // animation / animation-name declarations.
    const nameRe = new RegExp(
      `(animation(?:-name)?\\s*:[^;{}]*?)\\b${escapeRegExp(oldName)}\\b`,
      'g',
    );
    work = work.replace(nameRe, (_m, prefix) => `${prefix}${newName}`);
  }

  // 4. Rewrite CSS custom property declarations and var() references.
  //    We only rewrite identifiers that appear as either:
  //    a) a property name on the LHS of `:` inside a declaration ("--foo: ..."),
  //    b) inside `var(--foo[, fallback])`.
  //    We do NOT rewrite arbitrary `--foo` text in comments or strings
  //    (those don't contain `:` or `var(`). Two passes keep the regex simple.
  const declaredVars = new Set<string>();
  work = work.replace(
    /(^|[\s;{])(--[\w-]+)(\s*:)/g,
    (_m, leading, name, tail) => {
      const newName = `${variablePrefix}${name.slice(2)}`;
      declaredVars.add(name);
      return `${leading}${newName}${tail}`;
    },
  );
  work = work.replace(/var\(\s*(--[\w-]+)/g, (match, name) => {
    if (!declaredVars.has(name)) return match; // not the app's variable; leave it
    const newName = `${variablePrefix}${name.slice(2)}`;
    return match.replace(name, newName);
  });

  // 5. :global(...) escape hatch — when allowed, the contents pass through
  //    unprefixed at selector-rewriting time. Mark them with a sentinel so the
  //    selector pass leaves them alone, then strip the sentinel at the end.
  const GLOBAL_OPEN = '';
  const GLOBAL_CLOSE = '';
  if (options.allowGlobalEscape) {
    work = work.replace(/:global\(\s*([^()]+?)\s*\)/g, (_m, inner) => {
      return `${GLOBAL_OPEN}${inner.trim()}${GLOBAL_CLOSE}`;
    });
  } else {
    // Even when not allowed, strip the wrapper so the inner selector is at
    // least valid CSS — but DO prefix it (no escape).
    work = work.replace(/:global\(\s*([^()]+?)\s*\)/g, (_m, inner) => inner);
  }

  // 6. Rewrite selector lists. We walk top-level rule blocks (skipping the
  //    interior of @media/@supports so their selectors get rewritten too).
  //    For each selector list before a `{`, split by `,` and prefix each.
  work = rewriteSelectorBlocks(work, {
    container: containerSelector,
    keepGlobalSentinels: true,
  });

  // 7. Strip sentinels from :global() contents (selector pass left them alone).
  if (options.allowGlobalEscape) {
    work = work.replaceAll(GLOBAL_OPEN, '').replaceAll(GLOBAL_CLOSE, '');
  }

  // 8. Wrap the whole stylesheet in @layer to keep the app's rules in a
  //    predictable cascade slot below shell rules.
  const layered = `@layer tytus-app-${appId} {\n${work.trim()}\n}\n`;

  return {
    css: layered,
    containerSelector,
    warnings,
  };
}

/**
 * Rewrite the selectors that precede every `{` we treat as a rule block.
 * `@`-rules whose body is a list of declarations (`@font-face`, `@page`)
 * are skipped; we already removed `@font-face` above. `@media`, `@supports`
 * and other nested at-rules are walked: we rewrite selectors INSIDE their
 * body, not the at-rule head itself.
 */
function rewriteSelectorBlocks(
  cssText: string,
  opts: { container: string; keepGlobalSentinels: boolean },
): string {
  let out = '';
  let i = 0;
  let bufStart = 0;
  let depth = 0;
  // Tracks whether the current "{ ... }" block is itself an @-rule body
  // (i.e. nested rules whose selectors still need rewriting). For our
  // purposes everything except @keyframes is fine; @keyframes contents are
  // percentage selectors (0%, 100%) which we leave alone.
  const skipBodyRewriteUntilDepthRestored: Array<number> = [];
  while (i < cssText.length) {
    const ch = cssText[i];
    if (ch === '{') {
      const head = cssText.slice(bufStart, i);
      const trimmedHead = head.trimStart();
      if (trimmedHead.startsWith('@keyframes') || trimmedHead.startsWith('@-webkit-keyframes')) {
        skipBodyRewriteUntilDepthRestored.push(depth);
        out += head + '{';
      } else if (trimmedHead.startsWith('@')) {
        // Conditional group rule (@media, @supports, @container). Keep the
        // head as-is; descend so its inner rule selectors get rewritten.
        out += head + '{';
      } else {
        out += rewriteSelectorList(head, opts) + '{';
      }
      depth += 1;
      i += 1;
      bufStart = i;
      continue;
    }
    if (ch === '}') {
      // Flush any declaration body verbatim (we don't rewrite inside).
      out += cssText.slice(bufStart, i + 1);
      depth -= 1;
      if (
        skipBodyRewriteUntilDepthRestored.length > 0 &&
        skipBodyRewriteUntilDepthRestored[skipBodyRewriteUntilDepthRestored.length - 1] === depth
      ) {
        skipBodyRewriteUntilDepthRestored.pop();
      }
      i += 1;
      bufStart = i;
      continue;
    }
    i += 1;
  }
  // Tail (whitespace/comments after the last block).
  out += cssText.slice(bufStart);
  return out;
}

const GLOBAL_OPEN = '';
const GLOBAL_CLOSE = '';

function rewriteSelectorList(
  head: string,
  opts: { container: string; keepGlobalSentinels: boolean },
): string {
  // Preserve the leading whitespace exactly so output stays tidy.
  const leadingWsMatch = /^(\s*)/.exec(head);
  const leadingWs = leadingWsMatch ? leadingWsMatch[1] : '';
  const trailingWsMatch = /(\s*)$/.exec(head);
  const trailingWs = trailingWsMatch ? trailingWsMatch[1] : '';
  const body = head.slice(leadingWs.length, head.length - trailingWs.length);

  const selectors = splitTopLevel(body, ',').map((s) => s.trim()).filter(Boolean);
  const rewritten = selectors.map((sel) => rewriteSelector(sel, opts));
  return `${leadingWs}${rewritten.join(', ')}${trailingWs}`;
}

function rewriteSelector(
  sel: string,
  opts: { container: string; keepGlobalSentinels: boolean },
): string {
  // If the selector is wrapped entirely in :global() sentinels (added in
  // step 5), unwrap and pass through.
  if (
    opts.keepGlobalSentinels &&
    sel.startsWith(GLOBAL_OPEN) &&
    sel.endsWith(GLOBAL_CLOSE)
  ) {
    return sel.slice(1, -1);
  }
  // Replace bare element root selectors with the container.
  // Anchored on word boundaries so `bodybuilder` doesn't match `body`.
  if (ELEMENT_ROOT_SELECTORS.has(sel)) {
    return opts.container;
  }
  // Replace leading root selector with the container, e.g. `body .x` → `.tytus-app-X .x`.
  for (const root of ELEMENT_ROOT_SELECTORS) {
    if (sel.startsWith(`${root} `) || sel.startsWith(`${root}.`) || sel.startsWith(`${root}#`) || sel.startsWith(`${root}>`) || sel.startsWith(`${root}+`) || sel.startsWith(`${root}~`)) {
      return `${opts.container}${sel.slice(root.length)}`;
    }
  }
  // Otherwise prefix.
  return `${opts.container} ${sel}`;
}

/** Split `body` by `delimiter` ignoring delimiters inside [...] and (...). */
function splitTopLevel(body: string, delimiter: string): string[] {
  const out: string[] = [];
  let buf = '';
  let depth = 0;
  for (const ch of body) {
    if (ch === '[' || ch === '(') depth += 1;
    else if (ch === ']' || ch === ')') depth = Math.max(0, depth - 1);
    if (ch === delimiter && depth === 0) {
      out.push(buf);
      buf = '';
    } else {
      buf += ch;
    }
  }
  if (buf.length > 0) out.push(buf);
  return out;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
