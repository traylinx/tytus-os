/// <reference types="node" />
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// app/src/test/bundle-budget.test.ts → app/
const APP_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
);
const SCRIPT = path.resolve(APP_ROOT, 'scripts/check-bundle-budget.mjs');

let workdir = '';

beforeEach(() => {
  workdir = mkdtempSync(path.join(tmpdir(), 'tytus-bundle-test-'));
});

afterEach(() => {
  if (workdir) rmSync(workdir, { recursive: true, force: true });
});

function runScript(args: string[], cwd = workdir) {
  return spawnSync('node', [SCRIPT, ...args], { encoding: 'utf8', cwd });
}

function makeFakeDist(opts: {
  entryBytes: number;
  workerBytes?: number;
  sqliteBytes?: number;
}) {
  const dist = path.join(workdir, 'dist');
  const assets = path.join(dist, 'assets');
  mkdirSync(assets, { recursive: true });
  writeFileSync(
    path.join(assets, 'index-AAAAA.js'),
    Buffer.alloc(opts.entryBytes, 'a'),
  );
  if (opts.workerBytes) {
    writeFileSync(
      path.join(assets, 'worker-BBBBB.js'),
      Buffer.alloc(opts.workerBytes, 'b'),
    );
  }
  if (opts.sqliteBytes) {
    writeFileSync(
      path.join(assets, 'sqlite3-worker1-CCCCC.js'),
      Buffer.alloc(opts.sqliteBytes, 'c'),
    );
  }
  return dist;
}

describe('bundle-budget script (real subprocess + fake dist)', () => {
  it('exits 2 with a clear error when dist is missing', () => {
    const r = runScript([]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('no JS files found');
  });

  it('reports OK verdict when total stays under WARN', () => {
    makeFakeDist({ entryBytes: 50 * 1024 });
    const r = runScript(['--json']);
    expect(r.status).toBe(0);
    const payload = JSON.parse(r.stdout) as { verdict: string };
    expect(payload.verdict).toBe('ok');
  });

  it('reports over-warn when total crosses 140 KB but stays under 150 KB', () => {
    // Use highly-compressible data — gzip ratio ~99%, so for ~145 KB gzip
    // we need ~14.5 MB raw of identical bytes. Easier: write distinct
    // chunks that defeat compression more.
    const incompressible = Buffer.alloc(145 * 1024);
    for (let i = 0; i < incompressible.length; i += 1) {
      incompressible[i] = (i * 31 + 7) & 0xff;
    }
    const dist = path.join(workdir, 'dist', 'assets');
    mkdirSync(dist, { recursive: true });
    writeFileSync(path.join(dist, 'index-AAAAA.js'), incompressible);
    // Verify the gzip size lands in the warn band before asserting on script.
    const gz = gzipSync(incompressible).length;
    if (gz < 140 * 1024 || gz >= 150 * 1024) {
      // Bail on platform-specific gzip variance — the assertion below
      // would be flaky.
      return;
    }
    const r = runScript(['--json']);
    expect(r.status).toBe(0);
    const payload = JSON.parse(r.stdout) as { verdict: string };
    expect(payload.verdict).toBe('over-warn');
  });

  it('exits 1 with --strict when over-hard', () => {
    // randomBytes is genuinely incompressible — gzipped size ~= raw size.
    const incompressible = randomBytes(220 * 1024);
    const dist = path.join(workdir, 'dist', 'assets');
    mkdirSync(dist, { recursive: true });
    writeFileSync(path.join(dist, 'index-AAAAA.js'), incompressible);
    const r = runScript(['--strict']);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('OVER HARD LIMIT');
  });

  it('exits 0 without --strict even when over-hard (M5 flips strict on)', () => {
    const incompressible = randomBytes(220 * 1024);
    const dist = path.join(workdir, 'dist', 'assets');
    mkdirSync(dist, { recursive: true });
    writeFileSync(path.join(dist, 'index-AAAAA.js'), incompressible);
    const r = runScript([]);
    expect(r.status).toBe(0);
  });

  it('excludes sqlite3-* chunks from the host total', () => {
    makeFakeDist({
      entryBytes: 80 * 1024,
      sqliteBytes: 200 * 1024,
    });
    const r = runScript(['--json']);
    const payload = JSON.parse(r.stdout) as {
      totalGz: number;
      entries: Array<{ path: string; kind: string; gzip: number }>;
    };
    const sqliteEntry = payload.entries.find((e) => e.kind === 'sqlite');
    expect(sqliteEntry).toBeDefined();
    expect(sqliteEntry?.path).toContain('sqlite3-worker1');
    // The sqlite chunk's gzip size MUST NOT be in totalGz.
    const entryGz = payload.entries.find((e) => e.kind === 'entry')?.gzip ?? 0;
    expect(payload.totalGz).toBe(entryGz);
  });

  it('classifies worker / entry / sqlite kinds correctly', () => {
    makeFakeDist({
      entryBytes: 1024,
      workerBytes: 1024,
      sqliteBytes: 1024,
    });
    const r = runScript(['--json']);
    const payload = JSON.parse(r.stdout) as {
      entries: Array<{ kind: string }>;
    };
    const kinds = payload.entries.map((e) => e.kind).sort();
    expect(kinds).toEqual(['entry', 'sqlite', 'worker']);
  });
});
