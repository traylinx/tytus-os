import { describe, expect, it } from 'vitest';
import type { ForgeCard } from '../repo/forgeRepo';
import { makeLifePlan, makeMeetingDeliverable, makeSprintPlan, makeStudyPack, outputsForMode, outputsForStudioAction } from './studyPack';

const card = (content: string, id = 'c1'): ForgeCard => ({
  id,
  workspaceId: 'w1',
  kind: 'markdown',
  title: 'Raw',
  content,
  metadata: {},
  sourceCardIds: [],
  position: 1,
  createdAt: 1,
  updatedAt: 1,
});

describe('Forge recipes', () => {
  it('creates a complete study pack from notes', () => {
    const outputs = makeStudyPack([
      card('# Photosynthesis\nPlants convert light into chemical energy.\nTODO: review ATP and NADPH.'),
    ]);
    expect(outputs.map((o) => o.kind)).toEqual(['summary', 'tasks', 'quiz', 'study_plan', 'memory_hook', 'storyboard']);
    expect(outputs[0].content).toContain('Photosynthesis');
    expect(outputs[1].content).toContain('review ATP');
    expect(outputs.every((o) => o.sourceCardIds)).toBeTruthy();
  });

  it('creates meeting deliverables with proposal and risk checklist', () => {
    const outputs = makeMeetingDeliverable([card('Need owner\nPrepare follow-up\nDeadline unclear')]);
    expect(outputs.map((o) => o.title)).toContain('Client-ready outline');
    expect(outputs.map((o) => o.title)).toContain('Risk checklist');
  });

  it('creates a simple life plan for private planning', () => {
    const outputs = makeLifePlan([card('Museum at 11\nBudget 40 EUR\nNeed backup lunch plan')]);
    expect(outputs.map((o) => o.title)).toContain('Low-stress timeline');
    expect(outputs.map((o) => o.title)).toContain('Packing / prep checklist');
    expect(outputs[2].content).toContain('Confirm time and place');
  });

  it('routes dev mode to sprint plan and empty input stays useful', () => {
    const sprint = outputsForMode('dev', [card('# Build Forge\nNeed QA')]);
    expect(sprint.map((o) => o.title)).toEqual(['Sprint goal', 'Implementation phases', 'Gates']);

    const empty = makeSprintPlan([]);
    expect(empty[0].content).toContain('No source material yet');
  });

  it('creates only the requested studio artifact', () => {
    const outputs = outputsForStudioAction('study', [
      card('# Photosynthesis\nPlants convert light into chemical energy.\nTODO: review ATP'),
    ], 'quiz');

    expect(outputs).toHaveLength(1);
    expect(outputs[0].kind).toBe('quiz');
    expect(outputs[0].title).toContain('Quiz');
  });

  it('falls back to a useful report when the mode has no native proposal output', () => {
    const outputs = outputsForStudioAction('dev', [card('# Forge\nNeed implementation gates')], 'proposal');

    expect(outputs).toHaveLength(1);
    expect(outputs[0].kind).toBe('proposal');
    expect(outputs[0].title).toContain('Sprint handoff');
    expect(outputs[0].content).toContain('## Gates');
  });
});
