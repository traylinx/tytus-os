import http from 'node:http';
import { readFileSync, statSync } from 'node:fs';
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

// Vite's transform middleware intercepts `.js` URLs before the static
// public-dir handler runs, which means files served from
// `app/public/__tytus_externals/*.js` bounce off the SPA fallback and
// come back as `text/html`. The importmap in `index.html` rewrites
// `react` / `react-dom` / `@tytus/host-api` etc. to URLs under that
// prefix — installed apps loaded via dynamic `import()` from jsDelivr
// then fail to fetch their externals and the whole app load rejects.
//
// This plugin registers a middleware that runs BEFORE Vite's transform
// pipeline and serves the shim files from disk verbatim. Production
// builds don't need this — the static `public/` copy lands as-is in
// `dist/`.
const externalsServerPlugin = (): Plugin => {
  const PREFIX = '/__tytus_externals/';
  const PUBLIC_DIR = path.resolve(__dirname, 'public/__tytus_externals');
  return {
    name: 'tytus-externals-server',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url || !req.url.startsWith(PREFIX)) return next();
        const rel = req.url.slice(PREFIX.length).split('?')[0].split('#')[0];
        // Reject path traversal — the shim filenames are flat (no slashes).
        if (rel.includes('/') || rel.includes('\\') || rel.includes('..')) {
          res.statusCode = 400;
          res.end('bad path');
          return;
        }
        const filePath = path.join(PUBLIC_DIR, rel);
        try {
          const stat = statSync(filePath);
          if (!stat.isFile()) return next();
          const body = readFileSync(filePath);
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
          res.setHeader('Cache-Control', 'no-store');
          res.end(body);
        } catch {
          next();
        }
      });
    },
  };
};

export default defineConfig({
  base: './',
  plugins: [react(), daemonProxyPlugin(), externalsServerPlugin()],
  server: {
    host: 'localhost',
    port: 4242,
    strictPort: true,
    fs: {
      // Allow the dev server to read the sibling docs/ folder (one level
      // above app/). The Help app uses import.meta.glob to bundle every
      // user-manual markdown file at build time. Production output is
      // fully static (vite build inlines the markdown into JS chunks),
      // so this allowance only affects the dev server's file watcher.
      allow: ['..'],
    },
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
  //
  // The W5 dynamic-loader resolves bundled app entry urls as
  // `@tytus/app-<id>` package identifiers. Vite resolves those through
  // the workspace symlinks under node_modules/@tytus/, but its dep-
  // optimizer needs the explicit `include` listing so the first click
  // on the App Store → Open path doesn't trigger a visible prebundle
  // stall the first time each app loads.
  optimizeDeps: {
    exclude: ['@sqlite.org/sqlite-wasm'],
    include: [
      '@tytus/app-memo',
      '@tytus/app-music-player',
      '@tytus/app-sheet',
      '@tytus/app-studio',
      '@tytus/app-voice-recorder',
    ],
  },
  worker: {
    format: 'es',
  },
});
