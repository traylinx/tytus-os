/// <reference types="node" />
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// import.meta.url -> app/src/test/host-api-cli.test.ts -> services/tytus-os/
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..');
const CLI = path.resolve(REPO_ROOT, 'packages/host-api/bin/tytus-app.mjs');
const FIXTURES = path.resolve(REPO_ROOT, 'packages/host-api/test/fixtures');

function runCli(args: string[]) {
  const r = spawnSync('node', [CLI, ...args], { encoding: 'utf8' });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

describe('tytus-app validate (real subprocess + real fixture bytes)', () => {
  it('passes a well-formed manifest', () => {
    const r = runCli([
      'validate',
      path.join(FIXTURES, 'good-sheet-manifest.json'),
    ]);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toContain('[OK]');
    expect(r.stdout).toContain('1 passed, 0 failed');
  });

  it('rejects a manifest missing required fields', () => {
    const r = runCli([
      'validate',
      path.join(FIXTURES, 'bad-no-id-manifest.json'),
    ]);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain('[FAIL]');
    expect(r.stdout).toContain("must have required property 'id'");
    expect(r.stdout).toContain("must have required property 'window'");
  });

  it("rejects a manifest whose share table doesn't match this app's prefix", () => {
    const r = runCli([
      'validate',
      path.join(FIXTURES, 'bad-share-prefix-manifest.json'),
    ]);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain(
      'must start with "app_music_creator_"',
    );
  });

  it('passes an alias manifest (entry not required when kind=alias)', () => {
    const r = runCli([
      'validate',
      path.join(FIXTURES, 'alias-manifest.json'),
    ]);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toContain('[OK]');
  });

  it('emits machine-readable JSON with --json', () => {
    const r = runCli([
      'validate',
      path.join(FIXTURES, 'good-sheet-manifest.json'),
      '--json',
    ]);
    expect(r.code).toBe(0);
    const payload = JSON.parse(r.stdout);
    expect(payload.results).toHaveLength(1);
    expect(payload.results[0].ok).toBe(true);
    expect(payload.results[0].issues).toEqual([]);
  });

  it('exits 2 with usage error on missing args', () => {
    const r = runCli([]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('Usage');
  });

  it('exits 2 when path does not exist', () => {
    const r = runCli([
      'validate',
      path.join(FIXTURES, 'does-not-exist.json'),
    ]);
    expect(r.code).toBe(2);
  });
});
