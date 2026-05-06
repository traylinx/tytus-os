# Technical Design — VS Code Web Base

## Files to own

Primary implementation should stay inside:

```text
packages/app-forge/src/
```

Expected target structure:

```text
packages/app-forge/src/
  Forge.tsx                         # composition only
  workbench/
    types.ts
    fileAccess.ts                   # showOpenFilePicker/showDirectoryPicker adapter
    language.ts                     # filename -> Monaco language
    workbenchState.ts               # open editors / active file helpers
  workbench/components/
    WorkbenchShell.tsx
    ActivityBar.tsx
    PrimarySidebar.tsx
    ExplorerPane.tsx
    WelcomePage.tsx
    EditorTabs.tsx
    EditorGroup.tsx
    SecondarySidebar.tsx
    StatusBar.tsx
    SearchPane.tsx
    PlaceholderPane.tsx
  workbench/editor/
    WorkbenchMonacoEditor.tsx
    monacoLoader.ts
    monacoTheme.ts
```

Keep existing old Forge files only as hidden future feature implementation:

```text
repo/forgeRepo.ts
recipes/studyPack.ts
hooks/useForgeData.ts
```

Do not let old repo state drive default UI.

## Core types

```ts
type WorkbenchFileKind = 'file' | 'directory';

type WorkbenchFile = {
  id: string;
  name: string;
  path: string;
  kind: WorkbenchFileKind;
  content?: string;
  children?: WorkbenchFile[];
  fileHandle?: FileSystemFileHandle;
  directoryHandle?: FileSystemDirectoryHandle;
};

type OpenEditor = {
  id: string;
  name: string;
  path: string;
  language: string;
  content: string;
  dirty: boolean;
  fileHandle?: FileSystemFileHandle;
};

type WorkbenchState = {
  folderOpened: boolean;
  rootName: string | null;
  tree: WorkbenchFile[];
  openEditors: OpenEditor[];
  activeEditorId: string | null;
};
```

## File opening strategy

Primary:

```ts
await window.showDirectoryPicker({ mode: 'readwrite' })
await window.showOpenFilePicker({ multiple: true })
```

Fallback only when unsupported:

```ts
<input type="file" multiple>
<input type="file" webkitdirectory>
```

Fallback UI/copy must say **Browser fallback**, not the main path.

## Important browser reality

Browser File System Access API is still permission-based and shows native chooser dialogs. That is normal. It should not be described as upload.

If browser lacks the API, fallback may use upload-looking picker. That is acceptable only as a fallback and should be clearly labeled.

## Monaco strategy

Use existing dependency:

```json
"monaco-editor": "^0.55.1"
```

Do:

- lazy load Monaco
- register workers
- one model per open editor
- update model language by file extension
- update status bar from cursor position
- dispose models on tab close

Do not:

- use old `ArtifactEditor` for file workbench long-term
- use Forge card ids as editor ids in the base shell

## Persistence strategy

For base sprint:

- Use session state for opened files/folders.
- Save edited files via File System Access API handle when available.
- Store Open Recent metadata in local storage/app storage only if low-risk.
- Do **not** auto-load old Forge SQLite workspaces into the base shell.

SQLite Forge data becomes future extension/artifact data, not the workbench filesystem.

## Integration strategy later

After base acceptance:

- Agent Chat reads active editor + selected files.
- Pods/AIL attach through right Chat panel.
- Recipes appear as commands/tasks/extensions.
- Media tools become custom editors/viewers.
- API Tester/JSON/table/photo/video logic becomes editor/viewer contributions.
