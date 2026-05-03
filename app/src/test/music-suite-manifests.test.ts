/// <reference types="node" />
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// app/src/test/music-suite-manifests.test.ts → repo root.
const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
);
const CLI = path.resolve(REPO_ROOT, 'packages/host-api/bin/tytus-app.mjs');

function validate(manifestPath: string) {
  return spawnSync('node', [CLI, 'validate', manifestPath], {
    encoding: 'utf8',
  });
}

describe('Music suite — manifests pass tytus-app validate', () => {
  for (const id of ['music-creator', 'music-player', 'voice-recorder']) {
    it(`${id} manifest is structurally valid`, () => {
      const r = validate(
        path.resolve(REPO_ROOT, `packages/app-${id}/tytus-app.json`),
      );
      expect(r.status, r.stdout + r.stderr).toBe(0);
      expect(r.stdout).toContain('[OK]');
    });
  }
});

describe('Music suite — cross-app share declarations are paired', () => {
  it('voice-recorder declares the share that music-creator consumes', () => {
    // Read both manifests and check the pair: music-creator's
    // permissions include `storage.shared.voice_recordings`, and
    // voice-recorder's `storage.shares` maps that key to its physical
    // table. Without both sides declaring, the runtime resolver
    // returns no shared tables — install-time validation catches the
    // missing pair.
    const fs = require('node:fs') as typeof import('node:fs');
    const creator = JSON.parse(
      fs.readFileSync(
        path.resolve(REPO_ROOT, 'packages/app-music-creator/tytus-app.json'),
        'utf8',
      ),
    ) as {
      permissions: string[];
    };
    const recorder = JSON.parse(
      fs.readFileSync(
        path.resolve(REPO_ROOT, 'packages/app-voice-recorder/tytus-app.json'),
        'utf8',
      ),
    ) as {
      storage?: { shares?: Record<string, string> };
    };
    expect(creator.permissions).toContain('storage.shared.voice_recordings');
    expect(recorder.storage?.shares?.voice_recordings).toBe(
      'app_voice_recorder_recordings',
    );
  });
});
