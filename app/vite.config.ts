import http from 'node:http';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// tytus-cli writes its current HTTP port to `/tmp/tytus/tray-web.port`
// every time the daemon starts. The port can change on every restart
// (it's an OS-assigned ephemeral). Vite's built-in proxy reads its
// target ONCE at startup, so a daemon restart strands the dev proxy
// on a dead port until vite is bounced. The plugin below re-reads the
// file on every /api/* request so vite tracks daemon restarts live.
const TRAY_PORT_FILE = '/tmp/tytus/tray-web.port';

const discoverDaemonPort = (): number | null => {
  try {
    const raw = readFileSync(TRAY_PORT_FILE, 'utf8').trim();
    const port = Number.parseInt(raw, 10);
    if (Number.isFinite(port) && port > 0 && port < 65_536) return port;
  } catch {
    // file missing or unreadable; daemon offline.
  }
  return null;
};

const daemonProxyPlugin = (): Plugin => ({
  name: 'tytus-daemon-proxy',
  configureServer(server) {
    server.middlewares.use('/api', (req, res) => {
      const port = discoverDaemonPort();
      if (port === null) {
        res.statusCode = 502;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'daemon_offline', detail: 'tray-web.port missing' }));
        return;
      }
      // Phase 2 §11 security floor: daemon's strict same-origin guard
      // expects Sec-Fetch-Site. Server-to-server hops drop it; forge
      // here so the dev proxy matches the production browser path.
      const headers = { ...req.headers, 'sec-fetch-site': 'same-origin' };
      delete (headers as Record<string, unknown>).host;

      const upstream = http.request(
        {
          host: '127.0.0.1',
          port,
          method: req.method,
          path: '/api' + (req.url ?? ''),
          headers,
        },
        (proxyRes) => {
          res.statusCode = proxyRes.statusCode ?? 502;
          for (const [k, v] of Object.entries(proxyRes.headers)) {
            if (v !== undefined) res.setHeader(k, v as string | string[]);
          }
          proxyRes.pipe(res);
        },
      );
      upstream.on('error', (err) => {
        res.statusCode = 502;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'daemon_unreachable', detail: err.message, port }));
      });
      req.pipe(upstream);
    });
  },
});

export default defineConfig({
  base: './',
  plugins: [react(), daemonProxyPlugin()],
  server: {
    port: 4242,
    strictPort: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  // @sqlite.org/sqlite-wasm ships pre-bundled — Vite's prebundle would
  // strip its workers and break the WASM loader. Excluding here matches
  // the package's official Vite setup. We use the OPFS SAH-Pool VFS so
  // no COOP/COEP headers are required (keeps the tytus-cli tray HTTP
  // server simple in production).
  optimizeDeps: {
    exclude: ['@sqlite.org/sqlite-wasm'],
  },
  worker: {
    format: 'es',
  },
});
