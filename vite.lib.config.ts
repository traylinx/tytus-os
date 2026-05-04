/**
 * Shared Vite "library" config for every workspace package under
 * packages/app-*. Each package's `npm run build` invokes:
 *
 *     vite build --config ../../vite.lib.config.ts
 *
 * `process.cwd()` resolves to the package directory at build time, so
 * the entry, outDir, and tsconfig paths Just Work without per-package
 * boilerplate.
 *
 * What lands in `dist/`:
 *   - `index.js`   (ES module — the default export is `bootApp(env)`)
 *   - `index.js.map`
 *   - any CSS imported by the package's source (auto-extracted by Vite)
 *
 * The PROD dynamic-loader resolves `installed_apps.entry_url` to a
 * URL pointing at this chunk; the install pipeline (post-W5) writes
 * the resolved url at install time. In DEV the loader uses the
 * `@tytus/app-<id>` package identifier instead and Vite resolves it
 * through the workspace symlink.
 *
 * Externals: react / react-dom and any other workspace package the
 * app imports (`@tytus/host-api`, `@tytus/contracts`, `@tytus/ai-engine`,
 * etc.) are marked external so we don't pull a second copy of the
 * shell's dependencies into each app bundle.
 */

import path from 'node:path';
import { existsSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const PACKAGE_ROOT = process.cwd();

const PACKAGE_TSX_ENTRY = path.resolve(PACKAGE_ROOT, 'src/index.tsx');
const PACKAGE_TS_ENTRY = path.resolve(PACKAGE_ROOT, 'src/index.ts');

const ENTRY = existsSync(PACKAGE_TSX_ENTRY)
  ? PACKAGE_TSX_ENTRY
  : PACKAGE_TS_ENTRY;

export default defineConfig({
  plugins: [react()],
  build: {
    lib: {
      entry: ENTRY,
      formats: ['es'],
      fileName: 'index',
    },
    outDir: path.resolve(PACKAGE_ROOT, 'dist'),
    rollupOptions: {
      external: [
        'react',
        'react-dom',
        'react-dom/client',
        'react/jsx-runtime',
        'react/jsx-dev-runtime',
        /^@tytus\//,
        /^@tytus-os\//,
        // Common workspace-shared libs the apps reuse — keep them
        // external so each app's chunk stays small. Vite ignores
        // unknown externals if the package doesn't actually depend
        // on the listed name.
        'lucide-react',
      ],
    },
    sourcemap: true,
    emptyOutDir: true,
    target: 'es2022',
  },
});
