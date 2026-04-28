#!/usr/bin/env node
// Phase 2 live GET-only probe.
//
// Reads /tmp/tytus/tray-web.port to find a running tytus-cli daemon and
// hits each Phase 2 read-only endpoint to confirm:
//
//   - response shapes match the fixture-derived TypeScript types.
//   - X-Content-Type-Options: nosniff is set on every JSON response.
//
// Skips gracefully if no daemon is running so CI without a live tray
// stays green. Run manually against a live daemon via:
//
//   npm run probe
//
// NOTE: this script never makes destructive POSTs. Per the sprint, A4
// (logout), A5 (daemon restart), A6 (connect/disconnect) are mock-only
// — see vitest. Cross-origin POST denial is in the cargo test suite.

import { readFileSync } from 'node:fs';

const PORT_FILE = '/tmp/tytus/tray-web.port';

const tryReadPort = () => {
  try {
    const raw = readFileSync(PORT_FILE, 'utf8').trim();
    const port = Number.parseInt(raw, 10);
    if (Number.isFinite(port) && port > 0 && port < 65_536) return port;
  } catch {
    return null;
  }
  return null;
};

const port = tryReadPort();
if (port === null) {
  console.log('skip: no daemon port file at', PORT_FILE);
  process.exit(0);
}
const base = `http://127.0.0.1:${port}`;
console.log('probing daemon at', base);

const required = (response, headerName, want) => {
  const value = response.headers.get(headerName.toLowerCase());
  if (value !== want) {
    throw new Error(
      `expected ${headerName}=${want} on ${response.url}, got ${value ?? '<missing>'}`,
    );
  }
};

const probeGet = async (path, shapeCheck) => {
  const url = `${base}${path}`;
  const r = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!r.ok) {
    throw new Error(`${path}: HTTP ${r.status}`);
  }
  required(r, 'X-Content-Type-Options', 'nosniff');
  const body = await r.json();
  shapeCheck(body, path);
  console.log(`  ok ${path}`);
};

const requireKeys = (body, keys, path) => {
  for (const k of keys) {
    if (!(k in body)) throw new Error(`${path}: missing key ${k}`);
  }
};

try {
  await probeGet('/api/state', (b, path) =>
    requireKeys(
      b,
      [
        'logged_in',
        'email',
        'tier',
        'units_used',
        'units_limit',
        'agents',
        'included',
        'forwarders',
        'daemon_running',
        'tunnel_active',
      ],
      path,
    ),
  );
  await probeGet('/api/daemon/status', (b, path) =>
    requireKeys(b, ['pid', 'running'], path),
  );
  await probeGet('/api/settings', (b, path) =>
    requireKeys(b, ['autostart_tray', 'autostart_tunnel'], path),
  );
  await probeGet('/api/launchers', (b, path) =>
    requireKeys(b, ['editors', 'terminal_available'], path),
  );
  await probeGet('/api/catalog', (b, path) =>
    requireKeys(b, ['version', 'agents'], path),
  );
  console.log('phase 2 probe: all GETs OK');
} catch (e) {
  console.error('probe failed:', e.message);
  process.exit(1);
}
