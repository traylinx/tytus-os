# SPRINT — Forge VS Code Web Base

## North Star

Forge must first feel like `https://vscode.dev/` running inside Tytus OS.

When opened with no folder, user sees:

- Activity Bar
- Explorer side bar
- `NO FOLDER OPENED`
- Open Folder / Open Recent / Open Remote Repository / Connect to Tunnel buttons
- Welcome tab
- Welcome page with Start / Walkthroughs / Recent
- Right Chat side panel
- Status bar

When a folder/file is opened, user sees:

- workspace tree
- open editors list
- editor tabs
- Monaco editor with syntax highlighting
- status bar with language/position
- no notebook/studio/source-card UI in primary layout

## Hard rules

1. Base app first. No AI product layout until base passes UAT.
2. Do not keep the previous Forge notebook/source/studio visible shell.
3. Do not auto-open old SQLite Forge cards on boot.
4. Do not show persisted demo data unless user opens recent.
5. Do not use browser `<input type=file webkitdirectory>` as primary folder opening because browser labels it as upload.
6. Use File System Access API first: `showDirectoryPicker()` / `showOpenFilePicker()`.
7. No protected JULI3TA/music changes.
8. No full VS Code fork. Use local sample only as reference.
9. No fake AI. Chat is placeholder until connected.

Protected-path gate:

```bash
if git diff --name-only | grep -Ei 'juli|juli3ta|music|audio|player|packages/app-music|app-julieta'; then
  echo "Protected JULI3TA/music path changed — stop" >&2
  exit 1
fi
```

## In-scope

### Phase 0 — Clean reset to base-only mental model

Goal: remove wrong product assumptions from first screen.

Tasks:

- Stop deriving first screen from SQLite Forge workspace/card state.
- Add explicit UI state: `folderOpened`, `openedFolder`, `openEditors`, `activeEditorId`.
- On boot, always show Welcome + `NO FOLDER OPENED` unless a folder/file was opened in this session or Open Recent selected.
- Keep old Forge repo/recipes compiled but hidden.
- Keep app registration in Tytus OS.

Acceptance:

- Fresh hard refresh shows VS Code welcome, not `Study something` / `Raw material`.
- Explorer says `NO FOLDER OPENED`.
- No Studio/Forge recipe panel visible by default.

### Phase 1 — File System Access API

Goal: local computer feel, not upload feel.

Tasks:

- Implement `fileAccess.ts` adapter:
  - `openFiles()` via `window.showOpenFilePicker()`.
  - `openFolder()` via `window.showDirectoryPicker()`.
  - recursive file collection with max file count + max file size.
  - fallback only when API missing, labeled as browser fallback.
- Store file entries in session state as `WorkbenchFile`.
- Preserve relative paths from directory handle.
- Do not persist file content to Forge SQLite yet unless user saves/export later.

Acceptance:

- Clicking Open Folder opens native folder chooser, not upload wording when browser supports API.
- Explorer tree shows folder/file hierarchy.
- Clicking a file opens editor tab.

### Phase 2 — VS Code shell fidelity

Goal: match `vscode.dev` visual structure.

Tasks:

- Activity Bar icons/order:
  - Explorer
  - Search
  - Source Control
  - Run and Debug
  - Extensions
  - Accounts bottom
  - Manage bottom
- Primary Side Bar:
  - `EXPLORER` title
  - `NO FOLDER OPENED` state
  - workspace tree state
  - Open Editors section
- Editor Group:
  - tabs with active tab styling
  - Welcome tab with close button visual
  - breadcrumb line for opened file
  - editor actions top-right
- Center Welcome page:
  - title `Tytus Forge`
  - subtitle `Forge anything into work`
  - Start actions
  - Walkthrough cards
  - Recent list
  - Show welcome checkbox
- Status bar:
  - VS Code blue
  - branch/status left
  - line/col/spaces/encoding/eol/language right
- Right secondary side bar:
  - CHAT tab
  - OUTPUTS tab
  - empty agent placeholder like VS Code chat

Acceptance:

- Side-by-side with `vscode.dev` screenshot: same structural layout and proportions.
- No oversized purple Tytus bar in editor area.
- No `TYTUS EXTENSIONS` primary panel on default boot.

### Phase 3 — Monaco editor integration for files

Goal: real editor base.

Tasks:

- Create `WorkbenchMonacoEditor.tsx` separate from old `ArtifactEditor`.
- Create Monaco model per open file.
- Language detection by filename.
- Track dirty state.
- Save back to FileSystemFileHandle when available.
- `Cmd/Ctrl+S` saves active editor.
- Position changes update status bar.

Acceptance:

- Open `.md`, `.json`, `.ts`, `.css`, `.html` files.
- Syntax highlighting correct.
- Edits mark tab dirty.
- Save clears dirty state.
- Status bar language and position update.

### Phase 4 — Minimal command/workbench behavior

Goal: not just visual clone; useful base.

Tasks:

- Keyboard shortcuts:
  - `Cmd/Ctrl+O` open file
  - `Cmd/Ctrl+K` command palette placeholder
  - `Cmd/Ctrl+S` save
  - `Cmd/Ctrl+W` close tab
- Tab close button.
- Open Recent uses previous session folder/file list when available.
- Search panel filters opened/workspace files.
- Source Control / Run / Extensions can be honest placeholders.

Acceptance:

- User can navigate without understanding Forge concepts.
- App works as a basic web code editor before any AI integration.

### Phase 5 — Park Tytus powers as extension surfaces only

Goal: prepare future without polluting base.

Tasks:

- Chat side panel stays present but not fake.
- Run and Debug can expose `Run Forge recipe` only as developer/extension action, not default UI.
- Extensions panel lists future Tytus capabilities as disabled/coming soon:
  - Agents
  - Pods
  - local AIL
  - Swarm
  - Media tools
  - Artifact recipes
- Old Forge SQLite workspaces/cards remain behind Open Recent or developer command only.

Acceptance:

- Product looks like VS Code base.
- Tytus features do not dominate the first impression.

## Out of scope for this sprint

- Full VS Code extension API.
- Real Git implementation.
- Terminal/xterm.
- Debug adapter protocol.
- Marketplace.
- AI agent execution.
- JULI3TA/music changes.
- Full OS real-files daemon bridge.

## Definition of done

- App opens to VS Code-like welcome/no-folder state.
- Folder/file opening uses native File System Access API first.
- Explorer tree works.
- Monaco tabs work.
- Chat panel placeholder exists.
- No old Forge notebook/studio UI on first screen.
- Typecheck/build/tests pass.
- Protected JULI3TA/music scan clean.
