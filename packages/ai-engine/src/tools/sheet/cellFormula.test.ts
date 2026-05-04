/**
 * Tests for the `sheet.cellFormula` tool. Covers operator coverage
 * (+ - * / SUM AVG CONCAT), happy-path numeric + string evaluation,
 * unsupported syntax → `unsupported_formula` error envelope, and
 * argument-shape validation.
 */
import { describe, expect, it } from 'vitest';
import {
  CELL_FORMULA_TOOL_NAME,
  cellFormulaTool,
  evaluateFormula,
  parseCellFormulaArgs,
} from './cellFormula';

describe('sheet.cellFormula', () => {
  it('exposes the canonical tool name + parameters', () => {
    expect(CELL_FORMULA_TOOL_NAME).toBe('sheet.cellFormula');
    const tool = cellFormulaTool();
    expect(tool.name).toBe('sheet.cellFormula');
    expect(tool.requiresApproval).toBe(false);
    expect(tool.parameters.required).toEqual(['formula', 'refs']);
  });

  it('happy path: arithmetic with named refs', () => {
    expect(evaluateFormula('a + b', { a: '2', b: '3' })).toBe('5');
    expect(evaluateFormula('a - b', { a: '5', b: '2' })).toBe('3');
    expect(evaluateFormula('a * b', { a: '4', b: '5' })).toBe('20');
    expect(evaluateFormula('a / b', { a: '10', b: '4' })).toBe('2.5');
  });

  it('operator coverage: precedence + parentheses', () => {
    expect(evaluateFormula('1 + 2 * 3', {})).toBe('7');
    expect(evaluateFormula('(1 + 2) * 3', {})).toBe('9');
    expect(evaluateFormula('10 / 2 + 3', {})).toBe('8');
    expect(evaluateFormula('-x + 1', { x: '4' })).toBe('-3');
  });

  it('SUM, AVG, CONCAT', () => {
    expect(evaluateFormula('SUM(1, 2, 3)', {})).toBe('6');
    expect(evaluateFormula('SUM(a, b, c)', { a: '1', b: '2', c: '3' })).toBe('6');
    expect(evaluateFormula('AVG(2, 4, 6)', {})).toBe('4');
    expect(evaluateFormula("CONCAT(a, b)", { a: 'hello ', b: 'world' })).toBe(
      'hello world',
    );
    expect(evaluateFormula('CONCAT(a, x, b)', { a: 'q=', x: '7', b: '!' })).toBe(
      'q=7!',
    );
  });

  it('case-insensitive function names', () => {
    expect(evaluateFormula('sum(1, 2)', {})).toBe('3');
    expect(evaluateFormula('Avg(2, 4)', {})).toBe('3');
    expect(evaluateFormula('concat(a, b)', { a: 'x', b: 'y' })).toBe('xy');
  });

  it('returns { value } envelope through the tool surface', async () => {
    const tool = cellFormulaTool();
    const out = (await tool.execute(
      { formula: 'a + b', refs: { a: '2', b: '5' } },
      { sessionId: 's', appId: 'sheet', approvalAlreadyGranted: false },
    )) as { value?: string; error?: string };
    expect(out.value).toBe('7');
    expect(out.error).toBeUndefined();
  });

  it('error: unsupported syntax returns { error: "unsupported_formula" }', async () => {
    const tool = cellFormulaTool();
    const out1 = (await tool.execute(
      { formula: 'a == b', refs: { a: '1', b: '1' } },
      { sessionId: 's', appId: 'sheet', approvalAlreadyGranted: false },
    )) as { error?: string };
    expect(out1.error).toBe('unsupported_formula');

    const out2 = (await tool.execute(
      { formula: 'UNKNOWN(1, 2)', refs: {} },
      { sessionId: 's', appId: 'sheet', approvalAlreadyGranted: false },
    )) as { error?: string };
    expect(out2.error).toBe('unsupported_formula');

    const out3 = (await tool.execute(
      { formula: 'a + b', refs: { a: '1' } }, // ref `b` missing
      { sessionId: 's', appId: 'sheet', approvalAlreadyGranted: false },
    )) as { error?: string };
    expect(out3.error).toBe('unsupported_formula');
  });

  it('error: division by zero', async () => {
    const tool = cellFormulaTool();
    const out = (await tool.execute(
      { formula: 'a / b', refs: { a: '4', b: '0' } },
      { sessionId: 's', appId: 'sheet', approvalAlreadyGranted: false },
    )) as { error?: string; detail?: string };
    expect(out.error).toBe('unsupported_formula');
    expect(out.detail).toMatch(/zero/);
  });

  it('error: invalid args (missing formula or non-object refs) throw', () => {
    expect(() => parseCellFormulaArgs({})).toThrow(/formula/);
    expect(() => parseCellFormulaArgs({ formula: '', refs: {} })).toThrow(
      /formula/,
    );
    expect(() => parseCellFormulaArgs({ formula: 'a + 1', refs: [] })).toThrow(
      /refs/,
    );
    expect(() =>
      parseCellFormulaArgs({ formula: 'a + 1', refs: { a: 1 } }),
    ).toThrow(/string/);
  });
});
