import { readFileSync } from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Discover the running daemon's HTTP port. tytus-cli writes the port to
// `/tmp/tytus/tray-web.port` whenever the tray is running. If the file is
// missing or empty, dev mode falls back to a placeholder loopback target so
// vite still boots — the SPA will surface daemon_offline via the banner.
const TRAY_PORT_FILE = '/tmp/tytus/tray-web.port';
const FALLBACK_DAEMON_TARGET = 'http://127.0.0.1:0';

const discoverDaemonTarget = (): string => {
  try {
    const raw = readFileSync(TRAY_PORT_FILE, 'utf8').trim();
    const port = Number.parseInt(raw, 10);
    if (Number.isFinite(port) && port > 0 && port < 65_536) {
      return `http://127.0.0.1:${port}`;
    }
  } catch {
    // file missing or unreadable; fall through.
  }
  return FALLBACK_DAEMON_TARGET;
};

export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    port: 4242,
    strictPort: false,
    proxy: {
      // Phase 2 §11 security floor: when the SPA POSTs through the dev
      // proxy, the underlying request is server-to-server and would
      // normally NOT carry Sec-Fetch-Site. The daemon's strict guard
      // would reject it. We forge the header here so daemon-side
      // behaviour matches production where the browser sends it
      // directly. This is safe because the dev proxy only listens on
      // 127.0.0.1 and the dev port is not routable from elsewhere.
      '/api': {
        target: discoverDaemonTarget(),
        changeOrigin: false,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.setHeader('Sec-Fetch-Site', 'same-origin');
          });
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
