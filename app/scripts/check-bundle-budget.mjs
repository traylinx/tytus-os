#!/usr/bin/env node
/**
 * Bundle budget check — Apps Platform M1 scaffold.
 *
 * Walks `dist/**` for the host bundle's JS chunks (excluding source
 * maps), gzips each, and reports per-file sizes plus the total. The
 * goal: keep the host boot bundle ≤ 150 KB gzip by the end of the
 * sprint (currently ~649 KB; the loader + per-app extraction in
 * M3-M7 shrinks it).
 *
 * Behavior:
 *   warn  ≥ WARN_BYTES (default 140 KB)
 *   fail  ≥ HARD_BYTES (default 150 KB) when --strict is set;
 *         otherwise prints a warning but exits 0.
 *
 * M5 flips `--strict` on by default + wires this into CI. Until then
 * the script reports without gating so M2-M4 can iterate without
 * tripping the budget every commit.
 *
 * Usage:
 *   node scripts/check-bundle-budget.mjs              # report only
 *   node scripts/check-bundle-budget.mjs --strict     # fail at HARD_BYTES
 *   node scripts/check-bundle-budget.mjs --json       # machine output
 *   node scripts/check-bundle-budget.mjs --dist=PATH  # custom dist root
 */

import { readFileSync, statSync, readdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join, relative } from 'node:path';

const WARN_BYTES = 140 * 1024;
const HARD_BYTES = 150 * 1024;

const argv = process.argv.slice(2);
const strict = argv.includes('--strict');
const jsonOutput = argv.includes('--json');
const distArg = argv.find((a) => a.startsWith('--dist='));
const distRoot = distArg ? distArg.slice('--dist='.length) : 'dist';

function findJsFiles(root) {
  const out = [];
  let stats;
  try {
    stats = statSync(root);
  } catch {
    return [];
  }
  if (!stats.isDirectory()) return [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const s = statSync(full);
      if (s.isDirectory()) {
        stack.push(full);
      } else if (name.endsWith('.js') && !name.endsWith('.map')) {
        out.push(full);
      }
    }
  }
  return out;
}

function classify(name) {
  // sqlite3-* must be checked before 'worker', since sqlite3-worker1-*.js
  // contains both substrings and we treat those as vendored sqlite-wasm
  // assets that don't count against the host bundle.
  if (name.includes('sqlite3-')) return 'sqlite';
  if (name.includes('worker')) return 'worker';
  if (/^index-/.test(name) || name === 'index.js') return 'entry';
  return 'chunk';
}

function gzipSize(buf) {
  return gzipSync(buf).length;
}

function fmt(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${bytes} B`;
}

function main() {
  const files = findJsFiles(distRoot);
  if (files.length === 0) {
    process.stderr.write(
      `[bundle-budget] no JS files found under ${distRoot}/. Run \`npm run build\` first.\n`,
    );
    process.exit(2);
  }

  const entries = files.map((path) => {
    const buf = readFileSync(path);
    const gz = gzipSize(buf);
    const rel = relative(process.cwd(), path);
    return {
      path: rel,
      raw: buf.byteLength,
      gzip: gz,
      kind: classify(rel.split('/').pop() ?? ''),
    };
  });

  // Entry / chunk / worker tally drives the host-boot-bundle gate.
  // sqlite3-* chunks are excluded because they're vendored from the
  // sqlite-wasm package and treated as platform infrastructure.
  const hostEntries = entries.filter((e) => e.kind !== 'sqlite');
  const totalRaw = hostEntries.reduce((s, e) => s + e.raw, 0);
  const totalGz = hostEntries.reduce((s, e) => s + e.gzip, 0);

  const verdict =
    totalGz >= HARD_BYTES
      ? 'over-hard'
      : totalGz >= WARN_BYTES
        ? 'over-warn'
        : 'ok';

  if (jsonOutput) {
    process.stdout.write(
      JSON.stringify(
        {
          distRoot,
          warnBytes: WARN_BYTES,
          hardBytes: HARD_BYTES,
          totalRaw,
          totalGz,
          verdict,
          strict,
          entries: entries.sort((a, b) => b.gzip - a.gzip),
        },
        null,
        2,
      ) + '\n',
    );
  } else {
    process.stdout.write(`Bundle budget — host boot bundle\n`);
    process.stdout.write(`  Warn at: ${fmt(WARN_BYTES)}\n`);
    process.stdout.write(`  Hard at: ${fmt(HARD_BYTES)}\n`);
    process.stdout.write(`  Strict:  ${strict ? 'yes' : 'no (M5 flips on)'}\n\n`);
    const sorted = entries.sort((a, b) => b.gzip - a.gzip);
    for (const e of sorted) {
      const tag = e.kind === 'sqlite' ? '(sqlite — excluded)' : `(${e.kind})`;
      process.stdout.write(
        `  ${fmt(e.gzip).padStart(10)}  gzip   ${fmt(e.raw).padStart(10)}  raw   ${e.path}  ${tag}\n`,
      );
    }
    process.stdout.write(`\n  Host total (excl. sqlite): ${fmt(totalGz)} gzip\n`);
    process.stdout.write(`  Verdict: ${verdict}\n`);
  }

  if (verdict === 'over-hard') {
    process.stderr.write(
      `\n[bundle-budget] OVER HARD LIMIT (${fmt(totalGz)} > ${fmt(HARD_BYTES)})\n`,
    );
    if (strict) process.exit(1);
  } else if (verdict === 'over-warn') {
    process.stderr.write(
      `\n[bundle-budget] over warn threshold (${fmt(totalGz)} > ${fmt(WARN_BYTES)})\n`,
    );
  }
  process.exit(0);
}

main();
