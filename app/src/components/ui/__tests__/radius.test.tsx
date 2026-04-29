// Phase 2 — pin the radius contract for shared UI primitives.
// These tests fail loudly if a primitive's default radius changes, or if
// the cn/twMerge override semantics regress so callers can no longer
// replace a default radius from outside.
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';

import { Button } from '../button';
import { Input } from '../input';
import { Textarea } from '../textarea';
import { Card } from '../card';
import { cn } from '@/lib/utils';

describe('UI primitives — radius defaults', () => {
  it('Button defaults to rounded-button', () => {
    const { container } = render(<Button>x</Button>);
    expect(container.firstElementChild?.className).toContain('rounded-button');
  });

  it('Input defaults to rounded-input', () => {
    const { container } = render(<Input />);
    expect(container.firstElementChild?.className).toContain('rounded-input');
  });

  it('Textarea defaults to rounded-input', () => {
    const { container } = render(<Textarea />);
    expect(container.firstElementChild?.className).toContain('rounded-input');
  });

  it('Card defaults to rounded-card', () => {
    const { container } = render(<Card>c</Card>);
    expect(container.firstElementChild?.className).toContain('rounded-card');
  });
});

describe('cn() — semantic radius aliases participate in conflict group', () => {
  it('rounded-none overrides rounded-button', () => {
    const out = cn('rounded-button', 'rounded-none');
    expect(out).not.toContain('rounded-button');
    expect(out).toContain('rounded-none');
  });

  it('rounded-md overrides rounded-input', () => {
    const out = cn('rounded-input', 'rounded-md');
    expect(out).not.toContain('rounded-input');
    expect(out).toContain('rounded-md');
  });

  it('user className overrides primitive default', () => {
    const { container } = render(<Button className="rounded-none">x</Button>);
    const cls = container.firstElementChild?.className ?? '';
    expect(cls).toContain('rounded-none');
    expect(cls).not.toContain('rounded-button');
  });

  it('rounded-card overrides rounded-window (semantic-vs-semantic)', () => {
    const out = cn('rounded-window', 'rounded-card');
    expect(out).not.toContain('rounded-window');
    expect(out).toContain('rounded-card');
  });

  it('rounded-full still wins over semantic aliases', () => {
    const out = cn('rounded-card', 'rounded-full');
    expect(out).not.toContain('rounded-card');
    expect(out).toContain('rounded-full');
  });
});
