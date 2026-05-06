# Decision — Forge Base Must Be VS Code for the Web First

## Checked facts

### vscode.dev

Official docs describe VS Code for the Web as a free, zero-install Microsoft Visual Studio Code experience running entirely in the browser. It supports lightweight code browsing/editing, search, syntax highlighting, and web-compatible extensions.

Reference: https://code.visualstudio.com/docs/editor/vscode-web

### microsoft/vscode repository

`github.com/microsoft/vscode` is the **Code - OSS** repository. It is where Microsoft develops the open-source base under MIT. The branded Visual Studio Code product has Microsoft-specific customizations and is released under the Microsoft product license.

References:

- https://github.com/microsoft/vscode
- https://github.com/microsoft/vscode/wiki/Differences-between-the-repository-and-Visual-Studio-Code
- https://code.visualstudio.com/license

### Monaco Editor

Monaco is the embeddable editor engine. It is not the full VS Code workbench.

Reference: https://microsoft.github.io/monaco-editor/typedoc/

## Decision

Forge base = **Tytus-native VS Code-for-the-Web clone shell + Monaco editor**.

Not:

- full VS Code fork
- Code Server
- Theia
- old Forge notebook/source/studio layout

## Why

| Option | Verdict | Reason |
| --- | --- | --- |
| Fork `microsoft/vscode` | Reject | Huge product/build system, license/product boundary complexity, not Tytus-native. |
| Embed Code Server | Reject | Server-hosted VS Code, wrong for embedded Tytus OS app. |
| Use Theia | Reject for now | Heavy IDE framework, overkill before base UX is accepted. |
| Use Monaco only | Accept as engine | Correct editor engine, but we must build workbench shell around it. |
| Tytus-native shell based on `vscode.dev` | Accept | Best balance: professional base, local-first, host APIs, later AI extensions. |

## Product principle

First build a convincing IDE/workbench base.

Then connect special Tytus features as extensions/panels:

- Agent Chat
- local AIL
- pods/swarm
- recipe/artifact generation
- media/screen/voice tools
- JSON/API/table/media viewers

No special feature is allowed to distort the base shell during this sprint.
