import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    port: 3000,
    // Proxy daemon API into dev server so the Tytus OS frontend can call it
    // without CORS or port-discovery during development.
    proxy: {
      '/api': 'http://127.0.0.1:0', // Phase 2: replace with discovered port from /tmp/tytus/tray-web.port
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
