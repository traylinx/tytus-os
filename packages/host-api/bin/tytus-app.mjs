#!/usr/bin/env node
/**
 * tytus-app — manifest validator CLI.
 *
 * Usage:
 *   tytus-app validate <path>           — validate one manifest file
 *   tytus-app validate <dir>            — validate every tytus-app.json under <dir>
 *   tytus-app validate <path> --json    — machine-readable output
 *
 * Exit codes:
 *   0 — every manifest is valid
 *   1 — one or more manifests failed validation
 *   2 — usage error (no path, missing file, etc.)
 */

import { readFileSync, statSync, readdirSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const SCHEMA_PATH = resolve(__dirname, '../src/manifest.schema.json');

function usage() {
  process.stderr.write(
    'Usage: tytus-app validate <path-to-manifest-or-dir> [--json]\n',
  );
  process.exit(2);
}

function loadSchema() {
  try {
    return JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
  } catch (err) {
    process.stderr.write(
      `tytus-app: cannot read schema at ${SCHEMA_PATH}: ${err.message}\n`,
    );
    process.exit(2);
  }
}

function findManifests(target) {
  let stats;
  try {
    stats = statSync(target);
  } catch (err) {
    process.stderr.write(`tytus-app: cannot stat ${target}: ${err.message}\n`);
    process.exit(2);
  }
  if (stats.isFile()) return [target];
  if (!stats.isDirectory()) {
    process.stderr.write(`tytus-app: not a file or directory: ${target}\n`);
    process.exit(2);
  }
  const out = [];
  walk(target, out);
  return out;
}

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) {
      continue;
    }
    const full = join(dir, name);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      walk(full, out);
    } else if (name === 'tytus-app.json') {
      out.push(full);
    }
  }
}

function loadManifest(path) {
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    return { error: `cannot read: ${err.message}` };
  }
  try {
    return { manifest: JSON.parse(raw) };
  } catch (err) {
    return { error: `invalid JSON: ${err.message}` };
  }
}

/**
 * Semantic checks that JSON Schema can't express cleanly.
 * Returns array of { path, message } issues — empty = clean.
 */
function semanticChecks(manifest) {
  const issues = [];

  // 1. shared-storage permission keys must match `^[a-z][a-z0-9_]*$` snake-case
  for (const perm of manifest.permissions ?? []) {
    if (typeof perm === 'string' && perm.startsWith('storage.shared.')) {
      const key = perm.slice('storage.shared.'.length);
      if (!/^[a-z][a-z0-9_]*$/.test(key)) {
        issues.push({
          path: '/permissions',
          message: `invalid storage share key: "${key}" (must be snake_case starting with a letter)`,
        });
      }
    }
  }

  // 2. storage.shares values must be physical-named tables for THIS app
  if (manifest.storage?.shares && manifest.id) {
    const sqlAppId = manifest.id.replaceAll('-', '_');
    const expectedPrefix = `app_${sqlAppId}_`;
    for (const [key, table] of Object.entries(manifest.storage.shares)) {
      if (!table.startsWith(expectedPrefix)) {
        issues.push({
          path: `/storage/shares/${key}`,
          message: `share table "${table}" must start with "${expectedPrefix}" (this app's prefix)`,
        });
      }
    }
  }

  // 3. alias manifests should NOT carry a real entry — flag if they do
  if (manifest.kind === 'alias' && manifest.entry?.module && manifest.entry.module !== '') {
    issues.push({
      path: '/entry/module',
      message: `alias manifests should not declare an entry.module — they redirect to aliasOf`,
    });
  }

  // 4. fileAssociations: extension must match mimeType naming convention loosely
  for (const [i, assoc] of (manifest.contributes?.fileAssociations ?? []).entries()) {
    if (assoc.mimeType.startsWith('application/x-tytus-') && !assoc.extension.startsWith('.tytus-')) {
      // not strictly an error — flag as warning later; for now skip
    }
    if (assoc.extension.includes('..') || assoc.extension.includes('/')) {
      issues.push({
        path: `/contributes/fileAssociations/${i}/extension`,
        message: `extension "${assoc.extension}" contains illegal characters`,
      });
    }
  }

  // 5. icons should look like a Pascal-case Lucide name
  if (manifest.icon && !/^[A-Z][A-Za-z0-9]*$/.test(manifest.icon)) {
    issues.push({
      path: '/icon',
      message: `icon "${manifest.icon}" is not a valid Lucide icon name (PascalCase, alphanumeric)`,
    });
  }

  return issues;
}

function formatAjvErrors(errors) {
  return (errors ?? []).map((e) => ({
    path: e.instancePath || '/',
    message: `${e.message ?? 'invalid'}${
      e.params && Object.keys(e.params).length
        ? ' ' + JSON.stringify(e.params)
        : ''
    }`,
  }));
}

function validateOne(manifestPath, validator) {
  const { manifest, error } = loadManifest(manifestPath);
  if (error) {
    return { path: manifestPath, ok: false, issues: [{ path: '/', message: error }] };
  }
  const schemaOk = validator(manifest);
  const schemaIssues = schemaOk ? [] : formatAjvErrors(validator.errors);
  const semanticIssues = semanticChecks(manifest);
  const issues = [...schemaIssues, ...semanticIssues];
  return { path: manifestPath, ok: issues.length === 0, issues };
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.length < 1) usage();
  const cmd = argv[0];
  if (cmd !== 'validate') usage();

  const target = argv[1];
  if (!target) usage();
  const jsonOutput = argv.includes('--json');

  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const schema = loadSchema();
  const validate = ajv.compile(schema);

  const manifests = findManifests(resolve(process.cwd(), target));
  if (manifests.length === 0) {
    process.stderr.write(`tytus-app: no tytus-app.json found under ${target}\n`);
    process.exit(2);
  }

  const results = manifests.map((p) => validateOne(p, validate));

  if (jsonOutput) {
    process.stdout.write(JSON.stringify({ results }, null, 2) + '\n');
  } else {
    for (const r of results) {
      const tag = r.ok ? 'OK' : 'FAIL';
      process.stdout.write(`[${tag}] ${r.path}\n`);
      for (const issue of r.issues) {
        process.stdout.write(`        ${issue.path}: ${issue.message}\n`);
      }
    }
    const failed = results.filter((r) => !r.ok).length;
    const passed = results.length - failed;
    process.stdout.write(
      `\n${passed} passed, ${failed} failed (${results.length} total)\n`,
    );
  }

  const anyFailed = results.some((r) => !r.ok);
  process.exit(anyFailed ? 1 : 0);
}

main();
