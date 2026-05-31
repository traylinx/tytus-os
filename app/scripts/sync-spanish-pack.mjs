#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const localePath = path.join(root, 'src/i18n/locales/es.ts');
const packPath = path.join(root, '..', 'language-packs/tytus-os-es/tytus-os.es.json');

const read = (p) => fs.readFileSync(p, 'utf8');

function parseLocaleTs(file) {
  const body = read(file);
  const out = {};
  const re = /[\n\r]\s*(['"])(.*?)\1\s*:\s*(['"])((?:\\.|(?!\3).)*)\3\s*,/gs;
  for (const m of body.matchAll(re)) {
    out[m[2]] = Function(`return ${m[3]}${m[4]}${m[3]}`)();
  }
  return out;
}

const existing = fs.existsSync(packPath)
  ? JSON.parse(read(packPath))
  : {};

const pack = {
  locale: 'es',
  name: existing.name || 'Spanish',
  nativeName: existing.nativeName || 'Español',
  version: existing.version || '1.0.0',
  author: existing.author || 'Tytus OS',
  strings: parseLocaleTs(localePath),
};

fs.mkdirSync(path.dirname(packPath), { recursive: true });
fs.writeFileSync(packPath, `${JSON.stringify(pack, null, 2)}\n`);
console.log(`Synced ${Object.keys(pack.strings).length} Spanish strings to ${path.relative(root, packPath)}`);
