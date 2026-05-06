import type { ForgeLanguage } from './types';

const EXTENSION_LANGUAGE: Record<string, ForgeLanguage> = {
  md: 'markdown',
  markdown: 'markdown',
  json: 'json',
  jsonc: 'json',
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  css: 'css',
  scss: 'css',
  less: 'css',
  html: 'html',
  htm: 'html',
  xml: 'xml',
  svg: 'xml',
  yml: 'yaml',
  yaml: 'yaml',
  py: 'python',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  csv: 'csv',
  txt: 'text',
  log: 'text',
};

export function languageForPath(path: string): ForgeLanguage {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return EXTENSION_LANGUAGE[ext] ?? 'text';
}

export function labelForLanguage(language: ForgeLanguage): string {
  const labels: Record<ForgeLanguage, string> = {
    markdown: 'Markdown',
    json: 'JSON',
    typescript: 'TypeScript',
    javascript: 'JavaScript',
    css: 'CSS',
    html: 'HTML',
    xml: 'XML',
    yaml: 'YAML',
    python: 'Python',
    shell: 'Shell',
    csv: 'CSV',
    text: 'Plain Text',
  };
  return labels[language];
}

export function isProbablyTextFile(path: string, size: number): boolean {
  if (size > 1_500_000) return false;
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  const binary = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'mp3', 'wav', 'flac', 'mp4', 'mov', 'zip', 'gz', 'tar', 'pdf', 'dmg', 'sqlite', 'db']);
  return !binary.has(ext);
}
