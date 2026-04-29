#!/usr/bin/env node
// scripts/audit-radius.mjs — design-consistency guardrail.
//
// What it catches (on standard UI surfaces):
//   - inline `borderRadius:` style props
//   - bare `rounded` Tailwind utility (ambiguous)
//   - arbitrary `rounded-[Npx]` Tailwind utility (off-token)
//   - native <input type=text|search|...> outside a primitive
//
// What it allows:
//   - geometry-by-design: rounded-full, rounded-[inherit], game cells,
//     scrollbar thumbs, chart markers, toggle knobs (matched per-file or
//     by line-comment escape `// audit:radius-allow <reason>`)
//   - native <input type=checkbox|radio|range|color|file|hidden> — these are
//     not text controls and don't need primitive wrapping
//
// Allowlist: scripts/audit-radius.allowlist.json
// Run: `npm run audit:radius` (added in Phase 1)
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, '..');
const SRC = join(REPO, 'src');
const ALLOWLIST_PATH = join(__dirname, 'audit-radius.allowlist.json');

const allowlist = JSON.parse(readFileSync(ALLOWLIST_PATH, 'utf8'));

const NATIVE_NON_TEXT_TYPES = new Set([
  'checkbox', 'radio', 'range', 'color', 'file', 'hidden', 'submit', 'reset', 'button', 'image',
]);

const ALLOW_COMMENT = /\/\/\s*audit:radius-allow\b/;

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === 'dist' || name === '.git') continue;
      yield* walk(p);
    } else if (/\.(tsx?|jsx?|css)$/.test(name)) {
      yield p;
    }
  }
}

function isFileAllowed(rel) {
  return allowlist.files?.some((f) => rel === f || rel.startsWith(f + '/'));
}

function isLineAllowed(rel, line, source) {
  // per-file rules: allowlist.lines maps "rel" -> [line numbers]
  const lines = allowlist.lines?.[rel];
  if (lines && lines.includes(line)) return true;
  // line-level escape comment
  return ALLOW_COMMENT.test(source);
}

const violations = [];
function add(kind, rel, line, source, hint) {
  violations.push({ kind, rel, line, source: source.trim().slice(0, 200), hint });
}

for (const path of walk(SRC)) {
  const rel = relative(REPO, path);
  if (isFileAllowed(rel)) continue;
  const text = readFileSync(path, 'utf8');
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const ln = i + 1;
    const src = lines[i];

    // 1. inline borderRadius (JSX style props)
    if (/\bborderRadius\s*:/.test(src) && !/['"]?border-radius['"]?\s*:/.test(src)) {
      // CSS-string `border-radius:` (in template literals like markdown rewrites) is allowed
      if (!isLineAllowed(rel, ln, src)) {
        add('inline-borderRadius', rel, ln, src,
          'replace with rounded-* utility or move into a primitive');
      }
    }

    // 2. arbitrary rounded-[...]
    const arb = src.match(/className=[^>]*?rounded-\[[^\]]+\]/);
    if (arb && !isLineAllowed(rel, ln, src)) {
      add('arbitrary-radius-class', rel, ln, src,
        'use a token alias (rounded-md/lg/xl/full) or semantic alias (rounded-button/input/card/window/dialog/menu/toast/dock)');
    }

    // 3. bare `rounded` (no suffix, no -[, no -<token>)
    // Matches `rounded` followed by space, quote, or end-of-class — but NOT rounded-foo / rounded-[
    const bareMatch = src.match(/className=[^>]*?\brounded(?![-\w\[])/);
    if (bareMatch && !isLineAllowed(rel, ln, src)) {
      add('bare-rounded', rel, ln, src,
        'replace with explicit token or semantic alias');
    }

    // 4. native <input> outside primitive
    const inputTag = src.match(/<input\b([^>]*)/);
    if (inputTag) {
      const attrs = inputTag[1] || '';
      // Skip if no type or text-like type
      const typeMatch = attrs.match(/\btype\s*=\s*["'{]?(\w+)/);
      const t = typeMatch ? typeMatch[1].toLowerCase() : 'text';
      if (NATIVE_NON_TEXT_TYPES.has(t)) continue;
      // Skip if it carries a className with rounded
      if (/\brounded[-\b]/.test(attrs)) continue;
      if (!isLineAllowed(rel, ln, src)) {
        add('native-text-input-no-radius', rel, ln, src,
          'use <Input/> primitive or add rounded-input className');
      }
    }
  }
}

if (violations.length === 0) {
  console.log('audit:radius PASS — 0 violations across', [...walk(SRC)].length, 'files');
  process.exit(0);
}

const by = violations.reduce((acc, v) => {
  acc[v.kind] = (acc[v.kind] || 0) + 1;
  return acc;
}, {});
console.error('audit:radius FAIL — ' + violations.length + ' violation(s):');
for (const [k, n] of Object.entries(by)) console.error('  ' + n + '  ' + k);
console.error('');
for (const v of violations) {
  console.error(v.rel + ':' + v.line + ' [' + v.kind + ']');
  console.error('  ' + v.source);
  console.error('  → ' + v.hint);
}
process.exit(1);
