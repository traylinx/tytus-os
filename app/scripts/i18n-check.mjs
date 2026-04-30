#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const srcRoot = path.join(root, 'src');
const allowPath = path.join(root, 'scripts', 'i18n-hardcoded.allowlist.json');
const writeAllowlist = process.argv.includes('--write-allowlist');

const read = (p) => fs.readFileSync(p, 'utf8');

function parseLocaleTs(file) {
  const body = read(file);
  const out = new Map();
  const re = /[\n\r]\s*(['"])(.*?)\1\s*:\s*(['"])((?:\\.|(?!\3).)*)\3\s*,/gs;
  for (const m of body.matchAll(re)) {
    // Locale files are repo-owned TypeScript literals; Function handles single-quoted strings.
    const value = Function(`return ${m[3]}${m[4]}${m[3]}`)();
    out.set(m[2], value);
  }
  return out;
}

function walk(dir, acc = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', 'coverage'].includes(ent.name)) continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, acc);
    else if (/\.tsx$/.test(ent.name) && !/\.test\.tsx$/.test(ent.name)) acc.push(p);
  }
  return acc;
}

function lineOf(source, index) {
  return source.slice(0, index).split(/\r?\n/).length;
}

function isHumanText(text) {
  const s = text.replace(/\s+/g, ' ').trim();
  if (s.length < 2) return false;
  if (!/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/.test(s)) return false;
  if (/^[A-Z0-9_./:#{}()[\]-]+$/.test(s)) return false;
  if (/^(http|https|mailto):/i.test(s)) return false;
  // Avoid false positives from TypeScript generic type spans like
  // useState<Foo | null>(null); const x = useState<Bar>(...).
  if (/\b(useState|useMemo|useCallback|const|let|interface|type|return)\b/.test(s)) return false;
  return true;
}

function hardcodedFindings() {
  const findings = [];
  for (const file of walk(srcRoot)) {
    const rel = path.relative(root, file);
    if (rel.startsWith('src/i18n/')) continue;
    const source = read(file);

    // JSX text nodes: <div>Hello</div>. Deliberately conservative:
    // no braces, no nested tags, only visible text between tags.
    const textRe = />\s*([^<>{}][^<>{}]*)\s*</g;
    for (const m of source.matchAll(textRe)) {
      const text = m[1].replace(/\s+/g, ' ').trim();
      if (isHumanText(text)) findings.push({ file: rel, line: lineOf(source, m.index), kind: 'text', text });
    }

    // User-visible attributes. Template strings are allowed only when they
    // contain t(...); otherwise they are still hardcoded UI text.
    const attrRe = /\b(aria-label|title|placeholder)=(['"])(.*?)\2/g;
    for (const m of source.matchAll(attrRe)) {
      const text = m[3].replace(/\s+/g, ' ').trim();
      if (isHumanText(text)) findings.push({ file: rel, line: lineOf(source, m.index), kind: m[1], text });
    }
  }
  return findings.sort((a, b) => `${a.file}:${a.line}:${a.text}`.localeCompare(`${b.file}:${b.line}:${b.text}`));
}

function keyOf(f) {
  return `${f.file}|${f.kind}|${f.text}`;
}

const errors = [];
const en = parseLocaleTs(path.join(srcRoot, 'i18n/locales/en.ts'));
const es = parseLocaleTs(path.join(srcRoot, 'i18n/locales/es.ts'));
for (const key of en.keys()) if (!es.has(key)) errors.push(`es missing key: ${key}`);
for (const key of es.keys()) if (!en.has(key)) errors.push(`es has extra key not in en: ${key}`);

const packPath = path.join(root, '..', 'language-packs/tytus-os-es/tytus-os.es.json');
if (fs.existsSync(packPath)) {
  const pack = JSON.parse(read(packPath));
  const strings = pack.strings || {};
  for (const [key, value] of es) {
    if (strings[key] !== value) errors.push(`Spanish package drift for key: ${key}`);
  }
  for (const key of Object.keys(strings)) {
    if (!es.has(key)) errors.push(`Spanish package has extra key: ${key}`);
  }
}

const findings = hardcodedFindings();
if (writeAllowlist) {
  const allow = {
    generatedAt: new Date().toISOString(),
    note: 'Baseline of existing hardcoded UI strings. New strings should use t(key) unless intentionally allowlisted.',
    entries: findings.map((f) => ({ file: f.file, kind: f.kind, text: f.text })),
  };
  fs.writeFileSync(allowPath, `${JSON.stringify(allow, null, 2)}\n`);
  console.log(`Wrote ${allow.entries.length} hardcoded-string allowlist entries.`);
  process.exit(errors.length ? 1 : 0);
}

const allow = fs.existsSync(allowPath) ? JSON.parse(read(allowPath)) : { entries: [] };
const allowed = new Set((allow.entries || []).map(keyOf));
const newHardcoded = findings.filter((f) => !allowed.has(keyOf(f)));
for (const f of newHardcoded) errors.push(`new hardcoded UI string: ${f.file}:${f.line} [${f.kind}] ${JSON.stringify(f.text)}`);

if (errors.length) {
  console.error(`i18n check failed (${errors.length})`);
  for (const err of errors.slice(0, 80)) console.error(`- ${err}`);
  if (errors.length > 80) console.error(`... ${errors.length - 80} more`);
  process.exit(1);
}
console.log(`i18n check passed: ${en.size} keys, ${findings.length} baseline hardcoded strings, no new drift.`);
