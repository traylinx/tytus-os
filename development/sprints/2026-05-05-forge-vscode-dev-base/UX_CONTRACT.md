# UX Contract — Match vscode.dev Base First

## Default boot state

Must match the mental model in `vscode.dev`:

```text
Activity Bar | Explorer Side Bar | Editor Welcome | Chat Side Bar
```

Explorer side bar content:

```text
EXPLORER
NO FOLDER OPENED
You have not yet opened a folder.
[Open Folder]
[Open Recent]
You can open a remote repository or pull request without cloning.
[Open Remote Repository]
To connect to a machine that has Remote Tunnel Access enabled...
[Connect to Tunnel...]
```

Editor content:

```text
[Welcome tab]
Tytus Forge
Forge anything into work

Start
New File...
Open File...
Open Folder...
Open Repository...
Open Tunnel...

Recent
sprints ~

Walkthroughs
Get Started with Tytus Forge
Browse & Edit Remote Repositories...
Learn the Fundamentals
```

Right side:

```text
CHAT | OUTPUTS
Build with Agent
AI responses may be inaccurate.
Generate Agent Instructions
[Describe what to build]
```

## Visual measurements

- Activity bar: 48px wide.
- Primary sidebar: 300px wide.
- Secondary sidebar: 350–380px wide.
- Status bar: 22px high, VS Code blue (`#007acc`) unless Tytus theme overrides later.
- Tab bar: 35px high.
- Command center/title row: 34px high.
- Font: system UI, 12–14px in chrome.
- Editor font: Monaco default monospace through Monaco.

## What must disappear from first screen

- `Study something` as default workspace.
- `Raw material` as default open tab.
- `TYTUS EXTENSIONS` as default panel.
- Big purple buttons or giant status block.
- Studio tiles as default right panel.
- Notebook/source-card vocabulary as primary app chrome.

## Allowed Tytus branding

- Window title says `Forge` because Tytus OS app name.
- Small sparkle icon in app title/tab if subtle.
- Later: Tytus extension icons inside Extensions panel.

Not allowed:

- Branding that breaks the VS Code base illusion.
