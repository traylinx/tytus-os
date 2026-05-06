import { Code2, FileText, Table2 } from 'lucide-react';
import type { ForgeCard, ForgeCardKind } from './repo/forgeRepo';
import { KIND_LABEL } from './forgeConstants';

export function iconForKind(kind: ForgeCardKind) {
  if (kind === 'table') return <Table2 size={14} />;
  if (kind === 'code' || kind === 'json') return <Code2 size={14} />;
  return <FileText size={14} />;
}

export function defaultContent(kind: ForgeCardKind): string {
  if (kind === 'json') return '{\n  "idea": "paste structured data here"\n}';
  if (kind === 'table') return 'Item,Status\nForge MVP,In progress\nQA,Pending';
  if (kind === 'code') return '// Paste a snippet here\nfunction forge(input) {\n  return input.trim();\n}';
  return '# Raw material\nPaste something messy here.\nTODO: turn it into an artifact.';
}

export function draftTitle(kind: ForgeCardKind, draft: string): string {
  const first = draft.split(/\r?\n/).map((l) => l.trim()).find(Boolean);
  if (!first) return `${KIND_LABEL[kind]} source`;
  return first.replace(/^#{1,6}\s+/, '').slice(0, 44);
}

export function tighten(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');
}

export function synthesizeLocallyFromPrompt(prompt: string, cards: ForgeCard[]): string {
  const lines = cards.flatMap((c) => c.content.split(/\r?\n/)).map((l) => l.trim()).filter(Boolean);
  const evidence = lines.slice(0, 8).map((l) => `- ${l}`).join('\n') || '- No source material yet.';
  return [
    '# Local synthesis',
    '',
    `Prompt: ${prompt}`,
    '',
    'Mode: deterministic local extraction. No AI model was called in this build.',
    '',
    'Relevant source lines:',
    evidence,
    '',
    'Next best action: run a recipe, review the generated artifact, then promote useful output back into sources.',
  ].join('\n');
}
