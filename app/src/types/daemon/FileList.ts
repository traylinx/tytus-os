export type FileEntryKind = "file" | "dir";

export interface FileListEntry {
  name: string;
  path: string;
  kind: FileEntryKind;
  size: number;
  modified_at: number | null;
  readonly: boolean;
}

export interface FileList {
  source: string;
  path: string;
  root_label: string;
  root_path: string;
  entries: FileListEntry[];
  readonly: boolean;
}

export interface FileMutationSource {
  source: string;
  path?: string;
  binding?: number;
}

export interface FileUploadBody extends FileMutationSource {
  name: string;
  content_base64: string;
}

export interface FileCopyMoveBody extends FileMutationSource {
  destination_path?: string;
  new_name?: string;
}
