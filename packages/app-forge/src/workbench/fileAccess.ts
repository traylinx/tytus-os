import { languageForPath, isProbablyTextFile } from './language';
import type { BrowserDirectoryHandleLike, BrowserFileHandleLike, WorkbenchFile, WorkbenchFolder } from './types';

type BrowserWindow = Window & {
  showOpenFilePicker?: (options?: unknown) => Promise<BrowserFileHandleLike[]>;
  showDirectoryPicker?: (options?: unknown) => Promise<BrowserDirectoryHandleLike>;
};

type FallbackFile = File & { webkitRelativePath?: string };

const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', '.next', '.turbo', 'coverage', '.cache']);

export function hasFileSystemAccessApi(): boolean {
  const pickerHost = getFileSystemAccessHost();
  return Boolean(pickerHost?.showOpenFilePicker && pickerHost.showDirectoryPicker);
}

export async function openFiles(): Promise<WorkbenchFile[]> {
  const picker = getFileSystemAccessHost()?.showOpenFilePicker;
  if (!picker) return fallbackOpenFiles(false);
  const handles = await picker({ multiple: true });
  const files = await Promise.all(handles.map((handle) => fileFromHandle(handle, handle.name, 'local-file')));
  return sortWorkbenchFiles(files.filter(Boolean) as WorkbenchFile[]);
}

export async function openFolder(): Promise<WorkbenchFolder> {
  const picker = getFileSystemAccessHost()?.showDirectoryPicker;
  if (!picker) {
    const files = await fallbackOpenFiles(true);
    return { name: 'Browser fallback folder', files };
  }
  const handle = await picker({ mode: 'readwrite' });
  const files: WorkbenchFile[] = [];
  await collectDirectoryFiles(handle, handle.name, files, 0, 320);
  return { name: handle.name, handle, files: sortWorkbenchFiles(files) };
}

function getFileSystemAccessHost(): BrowserWindow | null {
  const current = window as BrowserWindow;
  if (typeof current.showOpenFilePicker === 'function' && typeof current.showDirectoryPicker === 'function') {
    return current;
  }

  // Tytus apps can run inside an app frame. Chromium exposes the File System
  // Access API on the top-level browsing context more reliably than on some
  // embedded contexts. Same-origin access is best-effort; cross-origin/sandboxed
  // frames throw and correctly fall back to the browser file input.
  try {
    const topWindow = window.top as BrowserWindow | null;
    if (
      topWindow &&
      topWindow !== current &&
      typeof topWindow.showOpenFilePicker === 'function' &&
      typeof topWindow.showDirectoryPicker === 'function'
    ) {
      return topWindow;
    }
  } catch {
    // Cross-origin or sandboxed top access. Fall through to explicit fallback.
  }

  return null;
}

async function fileFromHandle(handle: BrowserFileHandleLike, path: string, source: WorkbenchFile['source']): Promise<WorkbenchFile | null> {
  const file = await handle.getFile();
  if (!isProbablyTextFile(path, file.size)) return null;
  const content = await file.text();
  return {
    id: stableId(path),
    name: handle.name,
    path,
    language: languageForPath(path),
    content,
    dirty: false,
    handle,
    size: file.size,
    source,
  };
}

async function collectDirectoryFiles(
  handle: BrowserDirectoryHandleLike,
  prefix: string,
  out: WorkbenchFile[],
  depth: number,
  limit: number,
): Promise<void> {
  if (out.length >= limit || depth > 8) return;
  for await (const entry of handle.values()) {
    if (out.length >= limit) break;
    if (entry.kind === 'directory') {
      if (SKIP_DIRS.has(entry.name)) continue;
      await collectDirectoryFiles(entry as BrowserDirectoryHandleLike, `${prefix}/${entry.name}`, out, depth + 1, limit);
      continue;
    }
    const fileEntry = entry as BrowserFileHandleLike;
    const file = await fileFromHandle(fileEntry, `${prefix}/${fileEntry.name}`, 'local-folder');
    if (file) out.push(file);
  }
}

function fallbackOpenFiles(directory: boolean): Promise<WorkbenchFile[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.style.display = 'none';
    if (directory) input.setAttribute('webkitdirectory', '');
    input.onchange = async () => {
      const selected = Array.from(input.files ?? []) as FallbackFile[];
      const files = await Promise.all(selected.map(async (file) => {
        const path = file.webkitRelativePath || file.name;
        if (!isProbablyTextFile(path, file.size)) return null;
        return {
          id: stableId(path),
          name: file.name,
          path,
          language: languageForPath(path),
          content: await file.text(),
          dirty: false,
          size: file.size,
          source: directory ? 'local-folder' : 'local-file',
        } satisfies WorkbenchFile;
      }));
      input.remove();
      resolve(sortWorkbenchFiles(files.filter(Boolean) as WorkbenchFile[]));
    };
    document.body.append(input);
    input.click();
  });
}

export async function saveWorkbenchFile(file: WorkbenchFile): Promise<WorkbenchFile> {
  if (!file.handle?.createWritable) {
    downloadFallback(file);
    return { ...file, dirty: false };
  }
  const writable = await file.handle.createWritable();
  await writable.write(file.content);
  await writable.close();
  return { ...file, dirty: false };
}

function downloadFallback(file: WorkbenchFile): void {
  const blob = new Blob([file.content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = file.name;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function stableId(path: string): string {
  let hash = 0;
  for (let i = 0; i < path.length; i += 1) hash = (hash * 31 + path.charCodeAt(i)) | 0;
  return `${path.replace(/[^a-z0-9]/gi, '-').toLowerCase()}-${Math.abs(hash)}`;
}

function sortWorkbenchFiles(files: WorkbenchFile[]): WorkbenchFile[] {
  return [...files].sort((a, b) => a.path.localeCompare(b.path));
}
