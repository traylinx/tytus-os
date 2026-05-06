export type ActivityView = 'explorer' | 'search' | 'source-control' | 'run' | 'extensions';
export type SecondaryTab = 'chat' | 'outputs';

export type ForgeLanguage =
  | 'markdown'
  | 'json'
  | 'typescript'
  | 'javascript'
  | 'css'
  | 'html'
  | 'xml'
  | 'yaml'
  | 'python'
  | 'shell'
  | 'csv'
  | 'text';

export type BrowserFileHandleLike = {
  kind?: 'file';
  name: string;
  getFile: () => Promise<File>;
  createWritable?: () => Promise<{ write: (data: string | Blob) => Promise<void>; close: () => Promise<void> }>;
};

export type BrowserDirectoryHandleLike = {
  kind?: 'directory';
  name: string;
  values: () => AsyncIterable<BrowserFileHandleLike | BrowserDirectoryHandleLike>;
};

export type WorkbenchFile = {
  id: string;
  name: string;
  path: string;
  language: ForgeLanguage;
  content: string;
  dirty: boolean;
  handle?: BrowserFileHandleLike;
  size?: number;
  source: 'local-file' | 'local-folder' | 'sample' | 'generated';
};

export type WorkbenchFolder = {
  name: string;
  handle?: BrowserDirectoryHandleLike;
  files: WorkbenchFile[];
};

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  body: string;
};

export type OutputArtifact = {
  id: string;
  title: string;
  kind: 'briefing' | 'action-list' | 'quiz' | 'plan' | 'storyboard' | 'report' | 'local-draft';
  body: string;
  createdAt: number;
};

export type CursorPosition = { lineNumber: number; column: number };
