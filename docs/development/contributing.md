# Contributing

Whether you're adding an app, fixing a window-manager bug, or wiring Phase 2 — these are the rules.

## Getting set up

```bash
git clone git@github.com:traylinx/tytus-os.git
cd tytus-os/app
npm install
npm run dev          # http://localhost:4242
npm run typecheck    # tsc -b --noEmit
npm run build        # tsc -b && vite build
npm run test:smoke   # interactive smoke (needs dev server running)
```

Node 20+ required. Vite 7 doesn't support Node 18.

## Branch model

- `main` is the only long-lived branch.
- Make a topic branch per feature: `git checkout -b feat/pod-inspector-streaming`.
- Open a PR. CI doesn't exist yet — verify locally with `npm run typecheck && npm run build && npm run test:smoke`.

## Commit messages

Follow this shape:

```
Fix: brief description (≤ 60 chars)

Body explains the *why* — what broke, what changed, what was verified.
Wrap at 72 chars. No marketing fluff.
```

Use prefixes: `Fix:`, `Add:`, `Refactor:`, `Docs:`, `Test:`, `Chore:`.

For bug fixes, include:
- A line stating what triggered the bug
- A line stating how the fix avoids re-introducing it
- A line stating the verification (smoke step, manual repro, etc.)

Example: see commit `3e81059` for window interactions or `378ae8d` for the dock infinite loop.

## Code style

- **TypeScript strict.** No `any`. Use `unknown` + type guards if you must.
- **`memo()` every component** unless it intentionally re-renders every parent tick.
- **`useCallback` for every dispatch wrapper.** Bare arrow functions in deps arrays cause re-renders.
- **No `useEffect` that dispatches actions causing the deps to change.** That was the dock infinite-loop bug. Either clear the trigger flag, or move the side effect out of global state.
- **One app per file.** Don't split apps across multiple files unless the file would exceed ~600 lines.
- **No comments that restate the code.** Only document the *why* — non-obvious constraints, browser quirks, intentional surprises.

## Folder conventions

```
app/src/
├── apps/             one .tsx per installed app
├── components/       shared UI (window manager, dock, etc.)
├── components/ui/    shadcn primitives (don't edit; copy + modify if you need a variant)
├── hooks/            one file per hook
├── lib/              cross-cutting helpers (cn, soon: daemonClient)
└── types/            shared types
```

## Adding a new app

See [adding-an-app.md](adding-an-app.md).

## Updating the user manual

Manual pages live in `docs/user-manual/*.md`. The Help app picks them up via Vite glob — drop a new `.md`, restart dev, it appears in the sidebar. Full workflow (deep-link routing, sidebar ordering, regenerating the bundled `tytus-cli/os-docs.md`): see [user-manual.md](user-manual.md).

## Dropping an app

1. `registry.ts` — remove the entry
2. `AppRouter.tsx` — remove the case
3. Delete the `.tsx` file
4. `grep -r '<id>'` and clean up references
5. Run `npm run typecheck` to catch anything you missed

## Pre-PR checklist

- [ ] `npm run typecheck` clean
- [ ] `npm run build` clean (no warnings, except the chunk-size note)
- [ ] `npm run test:smoke` green
- [ ] If you changed window/dock/launcher behavior, the smoke covers it (extend `scripts/smoke.mjs` if needed)
- [ ] If you added an app, manual sanity-check it opens and closes
- [ ] If you touched any `docs/user-manual/*.md` or `docs/troubleshooting/*.md`, regenerate the bundled LLM reference: `cd ../tytus-cli && ./scripts/regen-os-docs.sh && cargo build --release --bin tytus --bin tytus-mcp`
- [ ] Commit message explains *why*

## Things to avoid

- Adding a global Redux/Zustand/etc. store. Use the existing `useOSStore` Context.
- Adding a routing library (react-router, wouter). The hash-fragment router lives in App.tsx. Extending that is fine; replacing it isn't.
- Adding an animation library. Inline CSS keyframes in component-local `<style>` blocks are fine and keep bundle small.
- Hard-coding daemon endpoints anywhere outside the (future) `lib/daemon.ts`.
- Phoning home. No analytics, no crash reporting, no feature flags. We're a desktop shell, not a SaaS.

## Things to embrace

- Bundle splitting (`React.lazy` per app) when bundle pressure justifies it
- Storybook for the shadcn primitives if anyone has time
- Per-app keyboard shortcut registration (today shortcuts are global in App.tsx)
- A "Phase 2" daemon-client module that abstracts every endpoint into a typed function

## Questions

Open a GitHub Discussion or ping in the repo issues.
