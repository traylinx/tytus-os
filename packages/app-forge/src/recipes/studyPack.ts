import type { ForgeCard, ForgeMode, ForgeOutputKind } from '../repo/forgeRepo';

export interface RecipeOutputDraft {
  kind: ForgeOutputKind;
  title: string;
  content: string;
  sourceCardIds: string[];
}

export type StudioActionKey = 'summary' | 'tasks' | 'quiz' | 'study_plan' | 'storyboard' | 'proposal';

const STOP = new Set(['the', 'and', 'for', 'with', 'from', 'this', 'that', 'into', 'your', 'you', 'are', 'need', 'must', 'should']);

function linesFrom(cards: ForgeCard[]): string[] {
  return cards
    .flatMap((c) => c.content.split(/\r?\n/))
    .map((l) => l.trim())
    .filter(Boolean);
}

function sourceIds(cards: ForgeCard[]): string[] {
  return cards.map((c) => c.id);
}

function stripMarkdown(line: string): string {
  return line
    .replace(/^#{1,6}\s+/, '')
    .replace(/^[-*]\s+/, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .trim();
}

function keywords(lines: string[], limit = 8): string[] {
  const counts = new Map<string, number>();
  for (const line of lines) {
    for (const raw of line.toLowerCase().match(/[a-z0-9äöüß-]{4,}/gi) ?? []) {
      const word = raw.replace(/^-|-$/g, '');
      if (!word || STOP.has(word)) continue;
      counts.set(word, (counts.get(word) ?? 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([w]) => w);
}

function summary(lines: string[]): string {
  const cleaned = lines.map(stripMarkdown).filter((l) => !/^todo[:\s-]/i.test(l));
  if (cleaned.length === 0) return 'No source material yet. Add notes, a transcript, JSON, or a table card.';
  return cleaned.slice(0, 5).map((l) => `- ${l}`).join('\n');
}

function tasks(lines: string[]): string {
  const taskLines = lines
    .map(stripMarkdown)
    .filter((l) => /^(todo|review|prepare|write|send|check|fix|build|create|analyze|need|must|should)\b/i.test(l));
  const fallback = keywords(lines, 5).map((k) => `Review ${k}`);
  const out = taskLines.length > 0 ? taskLines : fallback;
  return out.length ? out.map((l) => `- [ ] ${l.replace(/^todo[:\s-]*/i, '')}`).join('\n') : '- [ ] Add more source material';
}

function quiz(lines: string[]): string {
  const heads = lines
    .filter((l) => /^#{1,3}\s+/.test(l))
    .map(stripMarkdown)
    .slice(0, 6);
  const terms = heads.length ? heads : keywords(lines, 6);
  if (terms.length === 0) return '1. What is the main idea?\n   Answer: Add source material first.';
  return terms.map((term, i) => `${i + 1}. Explain “${term}” in one sentence.\n   Answer: Check the source card and say it back simply.`).join('\n\n');
}

function studyPlan(lines: string[]): string {
  const terms = keywords(lines, 5);
  return [
    '1. Read the summary once without editing.',
    '2. Answer the quiz from memory.',
    terms.length ? `3. Revisit weak spots: ${terms.join(', ')}.` : '3. Add source material and repeat.',
    '4. Teach the topic out loud in two minutes.',
    '5. Mark remaining gaps as tasks.',
  ].join('\n');
}

function memoryHook(lines: string[]): string {
  const terms = keywords(lines, 6);
  if (terms.length === 0) return 'Make it sticky: turn the core idea into one vivid sentence.';
  return `Make it sticky: ${terms.slice(0, 4).join(' → ')}. Turn those words into a rhyme, acronym, or 20-second chant.`;
}

function storyboard(lines: string[]): string {
  const clean = lines.map(stripMarkdown).slice(0, 5);
  const scenes = clean.length ? clean : ['Drop raw material', 'Find the pattern', 'Make the artifact', 'Review it', 'Ship it'];
  return scenes.map((s, i) => `Scene ${i + 1}: ${s}`).join('\n');
}

export function makeStudyPack(cards: ForgeCard[]): RecipeOutputDraft[] {
  const lines = linesFrom(cards);
  const ids = sourceIds(cards);
  return [
    { kind: 'summary', title: 'Study summary', content: summary(lines), sourceCardIds: ids },
    { kind: 'tasks', title: 'Study tasks', content: tasks(lines), sourceCardIds: ids },
    { kind: 'quiz', title: 'Quiz boss fight', content: quiz(lines), sourceCardIds: ids },
    { kind: 'study_plan', title: 'Study plan', content: studyPlan(lines), sourceCardIds: ids },
    { kind: 'memory_hook', title: 'Memory hook', content: memoryHook(lines), sourceCardIds: ids },
    { kind: 'storyboard', title: '60-second recap storyboard', content: storyboard(lines), sourceCardIds: ids },
  ];
}

export function makeMeetingDeliverable(cards: ForgeCard[]): RecipeOutputDraft[] {
  const lines = linesFrom(cards);
  const ids = sourceIds(cards);
  const clean = lines.map(stripMarkdown).filter(Boolean);
  return [
    { kind: 'summary', title: 'Executive summary', content: summary(lines), sourceCardIds: ids },
    { kind: 'tasks', title: 'Action items', content: tasks(lines), sourceCardIds: ids },
    {
      kind: 'proposal',
      title: 'Client-ready outline',
      content: ['# Proposal outline', '', '## Context', ...clean.slice(0, 3).map((l) => `- ${l}`), '', '## Recommended next step', '- Confirm scope, owner, timeline, and success metric.'].join('\n'),
      sourceCardIds: ids,
    },
    { kind: 'custom', title: 'Risk checklist', content: '- Missing decision maker\n- Unclear deadline\n- No acceptance criteria\n- Data/source gaps', sourceCardIds: ids },
  ];
}

export function makeSprintPlan(cards: ForgeCard[]): RecipeOutputDraft[] {
  const lines = linesFrom(cards);
  const ids = sourceIds(cards);
  return [
    { kind: 'summary', title: 'Sprint goal', content: summary(lines), sourceCardIds: ids },
    { kind: 'tasks', title: 'Implementation phases', content: '- [ ] Scaffold\n- [ ] Core UX\n- [ ] Data model\n- [ ] Runtime integration\n- [ ] QA/UAT\n- [ ] Handoff docs', sourceCardIds: ids },
    { kind: 'custom', title: 'Gates', content: '- typecheck\n- tests\n- build\n- manual UAT\n- regression smoke', sourceCardIds: ids },
  ];
}


export function makeLifePlan(cards: ForgeCard[]): RecipeOutputDraft[] {
  const lines = linesFrom(cards);
  const ids = sourceIds(cards);
  const clean = lines.map(stripMarkdown).filter(Boolean);
  const focus = keywords(lines, 5);
  return [
    {
      kind: 'summary',
      title: 'Simple plan',
      content: summary(lines),
      sourceCardIds: ids,
    },
    {
      kind: 'tasks',
      title: 'Next actions',
      content: tasks(lines),
      sourceCardIds: ids,
    },
    {
      kind: 'custom',
      title: 'Packing / prep checklist',
      content: [
        '- [ ] Confirm time and place',
        '- [ ] Prepare essentials',
        '- [ ] Check budget / tickets / access',
        '- [ ] Save addresses and backup plan',
        clean[0] ? `- [ ] Re-check: ${clean[0]}` : '- [ ] Add concrete details',
      ].join('\n'),
      sourceCardIds: ids,
    },
    {
      kind: 'storyboard',
      title: 'Low-stress timeline',
      content: [
        'Morning: handle the highest-friction item first.',
        focus.length ? `Midday: focus on ${focus.slice(0, 3).join(', ')}.` : 'Midday: pick one useful activity.',
        'Evening: leave buffer and write one note for tomorrow.',
      ].join('\n'),
      sourceCardIds: ids,
    },
  ];
}

export function outputsForMode(mode: ForgeMode, cards: ForgeCard[]): RecipeOutputDraft[] {
  if (mode === 'work') return makeMeetingDeliverable(cards);
  if (mode === 'dev') return makeSprintPlan(cards);
  if (mode === 'life') return makeLifePlan(cards);
  return makeStudyPack(cards);
}

export function outputsForStudioAction(
  mode: ForgeMode,
  cards: ForgeCard[],
  action: StudioActionKey,
): RecipeOutputDraft[] {
  const fullRecipe = outputsForMode(mode, cards);
  const direct = fullRecipe.find((output) => output.kind === action);
  if (direct) return [renameForAction(direct, action)];

  const lines = linesFrom(cards);
  const ids = sourceIds(cards);

  if (action === 'quiz') {
    return [{ kind: 'quiz', title: 'Challenge questions', content: quiz(lines), sourceCardIds: ids }];
  }
  if (action === 'study_plan') {
    return [{ kind: 'study_plan', title: mode === 'dev' ? 'Execution plan' : 'Practical plan', content: fallbackPlan(mode, lines), sourceCardIds: ids }];
  }
  if (action === 'storyboard') {
    return [{ kind: 'storyboard', title: 'Artifact storyboard', content: storyboard(lines), sourceCardIds: ids }];
  }
  if (action === 'proposal') {
    return [{ kind: 'proposal', title: reportTitle(mode), content: reportForMode(mode, lines), sourceCardIds: ids }];
  }

  return fullRecipe.slice(0, 1);
}

function renameForAction(output: RecipeOutputDraft, action: StudioActionKey): RecipeOutputDraft {
  if (action === 'summary' && !/brief/i.test(output.title)) return { ...output, title: 'Briefing' };
  if (action === 'tasks' && !/action/i.test(output.title)) return { ...output, title: 'Action list' };
  return output;
}

function fallbackPlan(mode: ForgeMode, lines: string[]): string {
  if (mode === 'dev') {
    return [
      '1. Define the smallest shippable slice.',
      '2. Create the data model and one golden path.',
      '3. Add tests around persistence and UI behavior.',
      '4. Run typecheck, test, build.',
      '5. Capture screenshots and handoff notes.',
    ].join('\n');
  }
  if (mode === 'work') {
    return [
      '1. Extract decisions and blockers.',
      '2. Assign owners and dates.',
      '3. Draft the client-facing summary.',
      '4. Confirm risks before sending.',
    ].join('\n');
  }
  return studyPlan(lines);
}

function reportTitle(mode: ForgeMode): string {
  if (mode === 'dev') return 'Sprint handoff report';
  if (mode === 'life') return 'Personal plan report';
  if (mode === 'work') return 'Client-ready report';
  return 'Study report';
}

function reportForMode(mode: ForgeMode, lines: string[]): string {
  const clean = lines.map(stripMarkdown).filter(Boolean);
  const body = clean.length ? clean.slice(0, 6).map((l) => `- ${l}`).join('\n') : '- Add source material first.';
  if (mode === 'dev') {
    return ['# Sprint handoff', '', '## Goal', summary(lines), '', '## Evidence', body, '', '## Gates', '- typecheck\n- tests\n- build\n- manual UAT'].join('\n');
  }
  if (mode === 'work') {
    return ['# Client-ready report', '', '## Executive brief', summary(lines), '', '## Decisions / risks', body, '', '## Recommended next step', '- Confirm owner, scope, deadline, and acceptance criteria.'].join('\n');
  }
  if (mode === 'life') {
    return ['# Personal plan', '', '## Snapshot', summary(lines), '', '## Checklist', tasks(lines), '', '## Keep it easy', '- Remove one unnecessary step before executing.'].join('\n');
  }
  return ['# Study report', '', '## Summary', summary(lines), '', '## Key checks', quiz(lines), '', '## Next step', '- Teach it back in two minutes.'].join('\n');
}
