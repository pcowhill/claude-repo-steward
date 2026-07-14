import { describe, expect, it } from 'vitest';
import { validateProposals } from '../src/core/proposals';
import { NormalizedEventSchema } from '../src/core/events';
import { proposal } from './helpers';

describe('proposal schema validation', () => {
  it('accepts every fixture proposal shape', () => {
    const { valid, invalid } = validateProposals([
      proposal({ actionType: 'add_label' }),
      proposal({ actionType: 'post_readiness_assessment' }),
      proposal({ actionType: 'open_draft_docs_pull_request', target: { kind: 'branch', name: 'repo-steward/x' } }),
    ]);
    expect(valid).toHaveLength(3);
    expect(invalid).toHaveLength(0);
  });

  it('rejects unknown action types', () => {
    const rogue = { ...proposal({ actionType: 'add_label' }), actionType: 'delete_repository', payload: {} };
    const { valid, invalid } = validateProposals([rogue]);
    expect(valid).toHaveLength(0);
    expect(invalid).toHaveLength(1);
    expect(invalid[0].errors.join(' ')).toContain('actionType');
  });

  it('rejects payloads that do not match the action type', () => {
    const bad = { ...proposal({ actionType: 'add_label' }), payload: { nope: true } };
    const { invalid } = validateProposals([bad]);
    expect(invalid).toHaveLength(1);
  });

  it('rejects out-of-range confidence', () => {
    const bad = proposal({ actionType: 'add_label', confidence: 1.4 });
    const { invalid } = validateProposals([bad]);
    expect(invalid).toHaveLength(1);
  });

  it('quarantines invalid entries without dropping valid ones', () => {
    const { valid, invalid } = validateProposals([proposal({ actionType: 'add_label' }), null, 42, 'nope']);
    expect(valid).toHaveLength(1);
    expect(invalid).toHaveLength(3);
  });
});

describe('normalized event schema', () => {
  const base = {
    id: 'evt-1',
    type: 'issue.opened',
    timestamp: '2026-07-14T00:00:00Z',
    repository: { owner: 'orbitops', name: 'readiness-tracker' },
    actor: 'priya-shah',
    source: 'simulator',
    correlationId: 'run-1',
    target: { kind: 'issue', number: 42 },
  };

  it('parses a minimal event and applies defaults', () => {
    const parsed = NormalizedEventSchema.safeParse(base);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.changedFiles).toEqual([]);
      expect(parsed.data.linkedIssues).toEqual([]);
    }
  });

  it('rejects unknown event types', () => {
    expect(NormalizedEventSchema.safeParse({ ...base, type: 'issue.deleted' }).success).toBe(false);
  });

  it('rejects malformed targets', () => {
    expect(NormalizedEventSchema.safeParse({ ...base, target: { kind: 'issue' } }).success).toBe(false);
  });
});
