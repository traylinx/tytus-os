import { describe, expect, it } from 'vitest';
import {
  BUNDLED_DOCS_VINTAGE_HASH,
  DOCS,
  resolveCitation,
} from './registry';

describe('docs registry citation resolver', () => {
  it('resolves Cortex doc_id to bundled docs when vintage matches', () => {
    const doc = DOCS[0];
    const resolved = resolveCitation(doc.docId, null, BUNDLED_DOCS_VINTAGE_HASH);

    expect(resolved.kind).toBe('bundled');
    if (resolved.kind === 'bundled') {
      expect(resolved.doc.slug).toBe(doc.slug);
    }
  });

  it('suppresses bundled deep-link when live corpus hash drifts', () => {
    const doc = DOCS[0];
    const resolved = resolveCitation(doc.docId, null, 'newer-cortex-corpus');

    expect(resolved).toEqual({ kind: 'external', reason: 'hash-drift' });
  });
});
