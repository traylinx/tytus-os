import type { LucideIcon } from 'lucide-react';
import { BookOpen, Briefcase, CalendarDays, Code2, FileText, LayoutDashboard, ListChecks, Sparkles } from 'lucide-react';
import type { ForgeCardKind, ForgeMode } from './repo/forgeRepo';
import type { StudioActionKey } from './recipes/studyPack';

export interface ForgeQuest {
  mode: ForgeMode;
  title: string;
  goal: string;
  icon: LucideIcon;
  seed: string;
}

export const QUESTS: ForgeQuest[] = [
  {
    mode: 'study',
    title: 'Study something',
    goal: 'Understand material and create a study pack',
    icon: BookOpen,
    seed: '# Photosynthesis\nPlants convert light into chemical energy.\nChlorophyll captures sunlight.\nNeed to remember light reactions and Calvin cycle.\nTODO: review ATP and NADPH.',
  },
  {
    mode: 'work',
    title: 'Prepare a meeting',
    goal: 'Turn rough meeting material into a client-ready deliverable',
    icon: Briefcase,
    seed: '# Client meeting\nNeed executive summary, decision log, risks, and follow-up.\nTODO: confirm owner and deadline.\nPrepare next-step proposal.',
  },
  {
    mode: 'dev',
    title: 'Build a sprint',
    goal: 'Turn a product idea into phases, gates, and handoff notes',
    icon: Code2,
    seed: '# Sprint idea\nBuild the smallest valuable implementation.\nNeed phases, tests, risks, and UAT.\nTODO: define acceptance criteria.',
  },
  {
    mode: 'life',
    title: 'Plan life/trip',
    goal: 'Organize personal chaos into a useful plan',
    icon: CalendarDays,
    seed: '# Weekend plan\nCheap food, two museums, no stress.\nNeed packing list, budget, and reminders.',
  },
];

export const CARD_KINDS: Array<{ kind: ForgeCardKind; label: string }> = [
  { kind: 'markdown', label: 'Markdown' },
  { kind: 'text', label: 'Text' },
  { kind: 'json', label: 'JSON' },
  { kind: 'table', label: 'Table' },
  { kind: 'code', label: 'Code' },
];

export const KIND_LABEL: Record<string, string> = {
  markdown: 'Markdown',
  text: 'Text',
  code: 'Code',
  json: 'JSON',
  table: 'Table',
  voice: 'Voice',
  agent_result: 'Agent result',
  output: 'Output',
};

export const outputTone: Record<string, string> = {
  summary: '#a78bfa',
  tasks: '#67e8f9',
  quiz: '#f9a8d4',
  proposal: '#fbbf24',
  study_plan: '#86efac',
  memory_hook: '#fdba74',
  storyboard: '#93c5fd',
  custom: '#c4b5fd',
};

export const STUDIO_ACTIONS: Array<{ key: StudioActionKey; label: string; hint: string; icon: LucideIcon }> = [
  { key: 'summary', label: 'Briefing', hint: 'Clean executive digest', icon: Sparkles },
  { key: 'tasks', label: 'Action list', hint: 'Next steps + owners', icon: ListChecks },
  { key: 'quiz', label: 'Quiz', hint: 'Study checks', icon: BookOpen },
  { key: 'study_plan', label: 'Plan', hint: 'Timeline / routine', icon: CalendarDays },
  { key: 'storyboard', label: 'Storyboard', hint: 'Presentation flow', icon: LayoutDashboard },
  { key: 'proposal', label: 'Report', hint: 'Client-ready outline', icon: FileText },
];
