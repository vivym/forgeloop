import { describe, expect, it } from 'vitest';

import {
  appendRunEvents,
  latestContinuationNotice,
  nextRunEventCursor,
  visibleRunArtifacts,
} from '../../apps/web/src/workbenchState';

describe('run console state', () => {
  it('appends events in sequence order without duplicates', () => {
    const events = appendRunEvents(
      [{ id: 'event-1', sequence: 1, cursor: '0000000001' }],
      [
        { id: 'event-1', sequence: 1, cursor: '0000000001' },
        { id: 'event-2', sequence: 2, cursor: '0000000002' },
      ],
    );

    expect(events.map((event) => event.id)).toEqual(['event-1', 'event-2']);
    expect(nextRunEventCursor(events)).toBe('0000000002');
  });

  it('detects fallback continuation mode for UI labeling', () => {
    const events = appendRunEvents([], [
      {
        id: 'event-1',
        sequence: 1,
        cursor: '0000000001',
        event_type: 'user_input',
        payload: { continuity: 'resume_fallback' },
      },
    ]);

    expect(latestContinuationNotice(events)).toBe(
      'Continuation resumed through fallback; live subagent continuity is not guaranteed.',
    );
  });

  it('detects same-thread continuation mode for UI labeling', () => {
    const events = appendRunEvents([], [
      {
        id: 'event-1',
        sequence: 1,
        cursor: '0000000001',
        event_type: 'user_input',
        payload: { continuity: 'thread_continuation' },
      },
    ]);

    expect(latestContinuationNotice(events)).toBe(
      'Continuation started as a new turn; live subagent continuity is not guaranteed.',
    );
  });

  it('filters internal logs and raw refs out of existing run artifact views', () => {
    const artifacts = visibleRunArtifacts([
      { kind: 'diff', path: 'artifacts/diff.patch' },
      { kind: 'logs', path: 'artifacts/raw-codex.jsonl' },
      { kind: 'trace', raw_ref: { path: 'artifacts/internal.jsonl' } },
    ]);

    expect(artifacts).toEqual([{ kind: 'diff', path: 'artifacts/diff.patch' }]);
  });
});
