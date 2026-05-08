import type { AiContextPart } from '@tytus/host-api';

const MAX_PARTS = 8;
const MAX_TEXT_CHARS = 12_000;
const MAX_TOTAL_CHARS = 28_000;

const scrub = (text: string): string =>
  text
    .replace(/(sk-[A-Za-z0-9_-]{12,})/g, '[redacted-api-key]')
    .replace(/(Bearer\s+)[A-Za-z0-9._-]{16,}/gi, '$1[redacted-token]')
    .slice(0, MAX_TEXT_CHARS);

export const sanitizeContext = (
  parts: readonly AiContextPart[] | undefined,
): AiContextPart[] => {
  if (!parts?.length) return [];
  const out: AiContextPart[] = [];
  let used = 0;
  for (const part of parts.slice(0, MAX_PARTS)) {
    const text = scrub(part.text ?? '');
    const remaining = MAX_TOTAL_CHARS - used;
    if (remaining <= 0) break;
    const clipped = text.slice(0, remaining);
    used += clipped.length;
    out.push({
      kind: part.kind,
      title: String(part.title ?? 'Context').slice(0, 240),
      text: clipped,
    });
  }
  return out;
};

export const contextToSystemMessage = (
  parts: readonly AiContextPart[],
): string | null => {
  if (parts.length === 0) return null;
  return [
    'You are Atomek/Tytus assistant embedded in a developer workspace.',
    'Use the provided bounded context. Do not claim file access beyond it.',
    ...parts.map((part, index) =>
      `\n[Context ${index + 1}: ${part.kind} — ${part.title}]\n${part.text}`,
    ),
  ].join('\n');
};
