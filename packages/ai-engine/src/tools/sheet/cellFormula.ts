/**
 * `cellFormulaTool()` — Sheet-specific tool that evaluates a tiny
 * formula language with named refs and returns the computed value as
 * a string. The model uses this to compute derived columns before
 * proposing a `sheet.writeRange` patch.
 *
 * Grammar (hand-rolled recursive-descent — NO mathjs / NO real expr lib):
 *
 *   Expr    := Term (('+' | '-') Term)*
 *   Term    := Factor (('*' | '/') Factor)*
 *   Factor  := Number | Ref | '(' Expr ')' | Func
 *   Func    := ('SUM' | 'AVG' | 'CONCAT') '(' ArgList? ')'
 *   ArgList := Expr (',' Expr)*
 *   Ref     := Identifier   (resolved through the args.refs map)
 *
 * Numbers parse with `Number()`; non-numeric values from `refs` only
 * make sense inside CONCAT (which stringifies every argument). The
 * arithmetic operators inside CONCAT still do numeric math; CONCAT
 * itself glues string representations of evaluated sub-expressions.
 *
 * Returns:
 *   - `{ value: string }` on success — caller writes this string to a cell.
 *   - `{ error: 'unsupported_formula', detail }` on parse / type failure.
 *
 * Bound at session-creation time with no extra context — purely
 * functional. Apps still wrap it in the same factory shape as
 * cellReadRange / cellReadSheet for symmetry.
 */
import type { ToolDef } from '../../types';

export interface CellFormulaArgs {
  formula: string;
  refs: Record<string, string>;
}

export type CellFormulaResult =
  | { value: string }
  | { error: 'unsupported_formula'; detail: string };

const TOOL_NAME = 'sheet.cellFormula';

const TOOL_PARAMETERS = {
  type: 'object' as const,
  properties: {
    formula: {
      type: 'string',
      description:
        'Tiny formula. Supports + - * /, parentheses, named refs, and SUM(...) / AVG(...) / CONCAT(...).',
    },
    refs: {
      type: 'object',
      description:
        'Named references. Keys are identifiers used in the formula; values are the cell payload as strings.',
      additionalProperties: { type: 'string' },
    },
  },
  required: ['formula', 'refs'],
};

/** Coerce + shape-check a CellFormulaArgs payload. Throws on bad shape. */
export function parseCellFormulaArgs(raw: unknown): CellFormulaArgs {
  if (!raw || typeof raw !== 'object') {
    throw new Error('sheet.cellFormula: args must be an object');
  }
  const a = raw as Record<string, unknown>;
  if (typeof a.formula !== 'string' || a.formula.length === 0) {
    throw new Error('sheet.cellFormula: formula must be a non-empty string');
  }
  if (!a.refs || typeof a.refs !== 'object' || Array.isArray(a.refs)) {
    throw new Error('sheet.cellFormula: refs must be an object map');
  }
  const refs: Record<string, string> = {};
  for (const [k, v] of Object.entries(a.refs as Record<string, unknown>)) {
    if (typeof v !== 'string') {
      throw new Error(`sheet.cellFormula: ref "${k}" must be a string`);
    }
    refs[k] = v;
  }
  return { formula: a.formula, refs };
}

// ─── Parser ─────────────────────────────────────────────────────────────

type Token =
  | { kind: 'num'; value: number }
  | { kind: 'ident'; value: string }
  | { kind: 'op'; value: '+' | '-' | '*' | '/' | '(' | ')' | ',' };

const FUNC_NAMES = new Set(['SUM', 'AVG', 'CONCAT']);

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i++;
      continue;
    }
    if (ch === '+' || ch === '-' || ch === '*' || ch === '/' || ch === '(' || ch === ')' || ch === ',') {
      out.push({ kind: 'op', value: ch });
      i++;
      continue;
    }
    // Number literal.
    if ((ch >= '0' && ch <= '9') || ch === '.') {
      let j = i;
      while (
        j < src.length &&
        ((src[j] >= '0' && src[j] <= '9') || src[j] === '.')
      ) {
        j++;
      }
      const slice = src.slice(i, j);
      const n = Number(slice);
      if (!Number.isFinite(n)) {
        throw new Error(`bad number literal: "${slice}"`);
      }
      out.push({ kind: 'num', value: n });
      i = j;
      continue;
    }
    // Identifier — letters, digits (after first char), underscores. The
    // formula language is case-insensitive for the function names so
    // SUM/sum/Sum all match.
    if ((ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z') || ch === '_') {
      let j = i;
      while (
        j < src.length &&
        ((src[j] >= 'A' && src[j] <= 'Z') ||
          (src[j] >= 'a' && src[j] <= 'z') ||
          (src[j] >= '0' && src[j] <= '9') ||
          src[j] === '_')
      ) {
        j++;
      }
      out.push({ kind: 'ident', value: src.slice(i, j) });
      i = j;
      continue;
    }
    throw new Error(`unexpected character "${ch}" at offset ${i}`);
  }
  return out;
}

interface EvalCtx {
  refs: Record<string, string>;
}

/** Result of evaluating a sub-expression. We thread strings through so
 *  CONCAT can stringify untouched ref values; numeric ops coerce. */
type Val = { kind: 'num'; value: number } | { kind: 'str'; value: string };

function asNumber(v: Val, where: string): number {
  if (v.kind === 'num') return v.value;
  const n = Number(v.value);
  if (!Number.isFinite(n)) {
    throw new Error(`${where}: cannot coerce "${v.value}" to number`);
  }
  return n;
}

function stringify(v: Val): string {
  if (v.kind === 'str') return v.value;
  // Trim trailing zeros for cleanliness — matches how a spreadsheet
  // would render `1` not `1.0`.
  return Number.isInteger(v.value) ? String(v.value) : String(v.value);
}

class Parser {
  private pos = 0;
  private readonly tokens: Token[];

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  consume(): Token | undefined {
    return this.tokens[this.pos++];
  }

  expectOp(op: string): void {
    const t = this.consume();
    if (!t || t.kind !== 'op' || t.value !== op) {
      throw new Error(`expected "${op}" but got ${t ? JSON.stringify(t) : 'end-of-input'}`);
    }
  }

  parseExpr(ctx: EvalCtx): Val {
    let left = this.parseTerm(ctx);
    while (true) {
      const t = this.peek();
      if (!t || t.kind !== 'op' || (t.value !== '+' && t.value !== '-')) break;
      this.consume();
      const right = this.parseTerm(ctx);
      const a = asNumber(left, t.value);
      const b = asNumber(right, t.value);
      left = { kind: 'num', value: t.value === '+' ? a + b : a - b };
    }
    return left;
  }

  parseTerm(ctx: EvalCtx): Val {
    let left = this.parseFactor(ctx);
    while (true) {
      const t = this.peek();
      if (!t || t.kind !== 'op' || (t.value !== '*' && t.value !== '/')) break;
      this.consume();
      const right = this.parseFactor(ctx);
      const a = asNumber(left, t.value);
      const b = asNumber(right, t.value);
      if (t.value === '/' && b === 0) {
        throw new Error('division by zero');
      }
      left = { kind: 'num', value: t.value === '*' ? a * b : a / b };
    }
    return left;
  }

  parseFactor(ctx: EvalCtx): Val {
    const t = this.consume();
    if (!t) throw new Error('unexpected end of input');
    // Unary +/-.
    if (t.kind === 'op' && (t.value === '+' || t.value === '-')) {
      const inner = this.parseFactor(ctx);
      const n = asNumber(inner, `unary ${t.value}`);
      return { kind: 'num', value: t.value === '-' ? -n : n };
    }
    if (t.kind === 'num') {
      return { kind: 'num', value: t.value };
    }
    if (t.kind === 'op' && t.value === '(') {
      const inner = this.parseExpr(ctx);
      this.expectOp(')');
      return inner;
    }
    if (t.kind === 'ident') {
      // Function call?
      const upper = t.value.toUpperCase();
      const next = this.peek();
      if (next && next.kind === 'op' && next.value === '(') {
        this.consume();
        if (!FUNC_NAMES.has(upper)) {
          throw new Error(`unknown function "${t.value}"`);
        }
        const args: Val[] = [];
        if (!(this.peek()?.kind === 'op' && this.peek()?.value === ')')) {
          args.push(this.parseExpr(ctx));
          while (this.peek()?.kind === 'op' && (this.peek() as { value: string }).value === ',') {
            this.consume();
            args.push(this.parseExpr(ctx));
          }
        }
        this.expectOp(')');
        return applyFunction(upper, args);
      }
      // Identifier resolves through `refs`.
      const v = ctx.refs[t.value];
      if (v === undefined) {
        throw new Error(`unknown ref "${t.value}"`);
      }
      // Try to parse as a number; fall back to string for CONCAT.
      const n = Number(v);
      if (v.trim() !== '' && Number.isFinite(n)) {
        return { kind: 'num', value: n };
      }
      return { kind: 'str', value: v };
    }
    throw new Error(`unexpected token: ${JSON.stringify(t)}`);
  }
}

function applyFunction(name: string, args: Val[]): Val {
  switch (name) {
    case 'SUM': {
      if (args.length === 0) return { kind: 'num', value: 0 };
      let s = 0;
      for (const v of args) s += asNumber(v, 'SUM');
      return { kind: 'num', value: s };
    }
    case 'AVG': {
      if (args.length === 0) {
        throw new Error('AVG requires at least 1 argument');
      }
      let s = 0;
      for (const v of args) s += asNumber(v, 'AVG');
      return { kind: 'num', value: s / args.length };
    }
    case 'CONCAT': {
      let out = '';
      for (const v of args) out += stringify(v);
      return { kind: 'str', value: out };
    }
    default:
      throw new Error(`unknown function "${name}"`);
  }
}

/** Evaluate a formula. Returns a string; throws on unsupported syntax. */
export function evaluateFormula(
  formula: string,
  refs: Record<string, string>,
): string {
  const tokens = tokenize(formula);
  if (tokens.length === 0) {
    throw new Error('empty formula');
  }
  const parser = new Parser(tokens);
  const result = parser.parseExpr({ refs });
  // Trailing tokens => parse error.
  if (parser.peek() !== undefined) {
    throw new Error(`unexpected trailing token: ${JSON.stringify(parser.peek())}`);
  }
  return stringify(result);
}

/** Build the sheet.cellFormula ToolDef. */
export function cellFormulaTool(): ToolDef {
  return {
    name: TOOL_NAME,
    description:
      'Evaluate a tiny formula with named refs. Returns { value } on success or { error: "unsupported_formula", detail } on parse failure. Supports + - * /, parentheses, and SUM/AVG/CONCAT.',
    parameters: TOOL_PARAMETERS,
    requiresApproval: false,
    execute: async (args): Promise<CellFormulaResult> => {
      const parsed = parseCellFormulaArgs(args);
      try {
        const value = evaluateFormula(parsed.formula, parsed.refs);
        return { value };
      } catch (err) {
        return {
          error: 'unsupported_formula',
          detail: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}

export const CELL_FORMULA_TOOL_NAME = TOOL_NAME;
