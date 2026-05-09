# Files

Files is the Finder-like browser for Tytus. It covers local Tytus Home, shared folders, and pod workspaces. Use Atomek when you need an editor, markdown preview, chat context, patch previews, or local agent work against those files.

## Sources

| Source | Path | Scope |
|---|---|---|
| Tytus Home | `~/Tytus` | local user workspace |
| Inbox | `~/Tytus/Inbox` or `/app/workspace/inbox` on a pod | incoming files/tasks |
| Outbox | `~/Tytus/Outbox` | prepared files for agents/pods |
| Downloads | `~/Tytus/Downloads` or pod downloads | generated/downloaded outputs |
| Shared | configured shared folder / garagetytus binding | account-wide shared storage |
| Pod NN workspace | `/app/workspace` | selected pod filesystem |

## Normal use

- Use **Browse** for Tytus Home and source switching.
- Use **Inbox** and **Downloads** for pod-specific folders.
- Use **Shared** for account-level shared folders. Shared folders are not pod-scoped; pod selection does not change the binding list.
- Use the pod sidebar when you need `/app/workspace` on a specific pod.

## Empty folders

A missing pod inbox or downloads directory should render as a friendly empty state, not raw CLI stderr. If you see `tytus ls: no such path`, report it as a Files empty-state bug.

## Files vs Atomek

| Need | Use |
|---|---|
| Browse or move through Tytus Home, Shared, Inbox, Outbox, Downloads | Files |
| Open a local folder for editing | Atomek |
| Ask AI about the active file | Atomek chat |
| Run tests or local tools with folder context | Atomek -> Computer / Agents or Terminal |
| Inspect generated artifacts and patch previews | Atomek Outputs |

Files owns broad navigation. Atomek owns editing and agent interaction. Do not duplicate full editor behavior in Files.

## Safety

File operations must be root-anchored to the selected source. Path traversal, symlink escape, null bytes, and double-encoded traversal must be rejected by daemon-side tests before write operations ship broadly.

## Shared folders

Shared folders use the account-level sharing system. Manage global defaults and diagnostics in **Settings -> Sharing**. Use Files -> Shared for browsing/opening the configured source.
