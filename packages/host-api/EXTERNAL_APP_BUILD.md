# Building External Tytus Apps (install transport B)

This is the build contract for **installed apps** loaded by the Tytus
OS shell at runtime via dynamic `import('https://cdn…/app.js')`. If you
are building a **bundled** workspace package inside `tytus-os/packages/`,
you don't need this doc — Vite handles the entry point for you.

## TL;DR

External Tytus apps are vanilla ESM modules whose default export is
`bootApp(env): Component`. They externalise React + `@tytus/host-api`
so the host's already-loaded singletons are reused (single React tree
across the OS).

```ts
// src/index.ts
import type { AppBootEnv } from '@tytus/host-api';
import App from './App';

export default function bootApp(_env: AppBootEnv) {
  return App;
}
```

The shell does:

```ts
const mod = await import('https://cdn.jsdelivr.net/gh/<you>/<repo>@<tag>/dist/index.js');
const Component = mod.default(env);
// then mounts <Component /> into the app's window.
```

## What the host gives you (and what you must externalise)

The host shell ships its own React, ReactDOM, and `@tytus/host-api`. To
avoid two Reacts living in the same tab (which silently breaks hooks,
context, and Suspense), your bundle MUST mark these as **externals**:

| Bare import specifier | Why externalise |
|-----------------------|------------------|
| `react`               | Single React instance for the whole OS. |
| `react-dom`           | Same — `react-dom` is also keyed by React identity. |
| `react/jsx-runtime`   | The automatic JSX runtime (TS `jsx: 'react-jsx'`). |
| `@tytus/host-api`     | The `validateManifest` + error classes are singletons too. |

The host ships an `<script type="importmap">` in `app/index.html` that
maps each of those specifiers to a small shim served from
`/__tytus_externals/*.js`. The shims read the host's already-loaded
modules off `window.__TYTUS_EXTERNALS__`, populated at boot by
`installHostExternals()` in `app/src/runtime/externals/`.

The browser resolves `import 'react'` inside your CDN-served bundle by
walking through that importmap → fetching `/__tytus_externals/react.js`
→ getting the host's React instance. No bundler magic on your side
beyond marking the specifier as external.

## URL shape

The host expects `entry.url` in `tytus-app.json` to be:

```
https://<cdn-host>/<path>/<filename>.js
```

Two things matter:

1. **`https://` only.** The runtime validator rejects `http://`, `data:`,
   `blob:`, and `file://`.
2. **Correct CORS + MIME.** The browser refuses to dynamic-import a
   module that is not served with `Content-Type: application/javascript`
   (or `text/javascript`) and the right CORS headers. Both jsDelivr and
   GitHub Pages do this correctly.

### Recommended CDNs

```
# jsDelivr — pinned to a tag (recommended)
https://cdn.jsdelivr.net/gh/<owner>/<repo>@v0.1.0/dist/index.js

# jsDelivr — pinned to a commit (more reproducible)
https://cdn.jsdelivr.net/gh/<owner>/<repo>@a1b2c3d/dist/index.js

# GitHub Pages
https://<owner>.github.io/<repo>/dist/index.js
```

## Vite config snippet

```ts
// vite.config.ts inside your external app repo
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    lib: {
      entry: 'src/index.ts',
      formats: ['es'],
      fileName: () => 'index.js',
    },
    rollupOptions: {
      external: [
        'react',
        'react-dom',
        'react/jsx-runtime',
        '@tytus/host-api',
      ],
      output: {
        // Preserve the bare specifiers — the host's importmap rewrites
        // them at load time.
        preserveModules: false,
        entryFileNames: 'index.js',
        chunkFileNames: '[name]-[hash].js',
      },
    },
    target: 'es2022',
    minify: 'esbuild',
    sourcemap: true,
  },
});
```

## esbuild / Rollup equivalents

Same idea — flag the four specifiers as externals. esbuild:

```ts
build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  format: 'esm',
  bundle: true,
  external: ['react', 'react-dom', 'react/jsx-runtime', '@tytus/host-api'],
  target: 'es2022',
});
```

## tytus-app.json shape

```json
{
  "$schema": "https://tytus.traylinx.com/schema/app/v1.json",
  "id": "tytus-app-text-editor",
  "name": "Text Editor",
  "version": "0.1.0",
  "icon": "FileText",
  "category": "Productivity",
  "description": "Lightweight text editor.",
  "kind": "installed",
  "window": {
    "defaultSize": { "width": 800, "height": 600 },
    "minSize":     { "width": 400, "height": 300 }
  },
  "permissions": ["vfs.user.documents", "storage.app"],
  "entry": {
    "url": "https://cdn.jsdelivr.net/gh/traylinx/tytus-app-text-editor@v0.1.0/dist/index.js"
  }
}
```

`entry.module` and `entry.url` are mutually exclusive. Bundled apps
stay on `entry.module`; installed apps use `entry.url`.

## What you cannot do

- **Don't bundle React.** A second React copy will break hooks across
  the host ↔ app boundary in confusing ways.
- **Don't bundle `@tytus/host-api`.** The host-side runtime helpers
  are singletons too.
- **Don't import the host's loader.** Installed apps consume
  `@tytus/host-api` types only; the loader (`app/src/runtime/`) is
  shell-private.
- **Don't execute host shell commands through `@tytus/host-api`.**
  The public host surface intentionally has no command-runner API.
  The built-in Terminal talks to the local tray daemon's PTY endpoints,
  but that is an interactive system app path, not a capability granted
  to installed apps. Apps that need validation should surface copyable
  commands or ask the user to open Terminal until a future allow-listed,
  non-shell host check API exists.
- **Don't ship `@font-face`** rules in your CSS — declare fonts in
  `manifest.entry.fonts[]`. The host's CSS isolation rejects
  `@font-face`.

## Local development

While iterating, point `entry.url` at a local server:

```json
"entry": { "url": "https://localhost:5174/dist/index.js" }
```

…and run your external app's dev server with HTTPS + open CORS. The
runtime validator allows any `https://` URL — there is no allowlist.
For un-trusted third-party apps the App Store SHOULD pin
`entry.url` to a commit-hash before install (TODO: future sprint).
