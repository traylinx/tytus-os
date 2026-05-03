import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  // Mirror the dev server's fs.allow so the docs registry's
  // import.meta.glob('../../../../docs/user-manual/*.md') can read the
  // sibling docs/ folder during vitest runs (one level above app/).
  // Same allowance the dev server has in vite.config.ts.
  server: {
    fs: {
      allow: [".."],
    },
  },
  test: {
    environment: "happy-dom",
    globals: false,
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    setupFiles: ["./src/test/setup.ts"],
  },
});
