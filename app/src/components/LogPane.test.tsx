import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import LogPane from '@/components/LogPane';

describe('LogPane', () => {
  it('renders empty text when no lines are present', () => {
    render(<LogPane lines={[]} status="subscribing" emptyText="Connecting…" />);
    expect(screen.getByText('Connecting…')).toBeTruthy();
  });

  it('caps visible lines to maxLines', () => {
    const { container } = render(<LogPane lines={['one', 'two', 'three']} maxLines={2} />);
    expect(screen.queryByText(/one/)).toBeNull();
    expect(container.textContent).toBe('two\nthree');
  });

  it('filters blank lines when requested', () => {
    render(<LogPane lines={['', 'ready', '  ']} filterBlank />);
    expect(screen.getByText('ready')).toBeTruthy();
  });
});
