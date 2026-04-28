export interface LogChunk {
  name: string;
  chunk: string;
  offset: number;
  size: number;
  truncated: boolean;
  missing: boolean;
}
