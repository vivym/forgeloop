import { describe, expect, it } from 'vitest';

import {
  appendRunEvents,
  latestContinuationNotice,
  latestPlanStep,
  runArtifactsForDetail,
  workerLeaseLabel,
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

  it('excludes run log refs from run detail artifact views', () => {
    const artifacts = runArtifactsForDetail({
      artifacts: [{ kind: 'diff', name: 'diff.patch' }],
      log_refs: [{ kind: 'diff', name: 'raw-codex.jsonl' }],
    });

    expect(artifacts).toEqual([{ kind: 'diff', name: 'diff.patch' }]);
  });

  it('derives worker lease labels without using driver status as lease status', () => {
    expect(
      workerLeaseLabel(
        { worker_id: 'worker-1', driver_status: 'active' },
        [
          {
            id: 'event-1',
            sequence: 1,
            event_type: 'worker_lease_acquired',
            payload: { worker_id: 'worker-2', lease_status: 'active' },
          },
        ],
      ),
    ).toBe('worker-2 / active');

    expect(workerLeaseLabel({ worker_id: 'worker-1', driver_status: 'active' }, [])).toBe('worker-1 / status unavailable');
  });

  it('derives the current plan step only from plan_updated events', () => {
    const events = appendRunEvents([], [
      {
        id: 'event-1',
        sequence: 1,
        event_type: 'plan_updated',
        payload: { current_step: 'Implement console' },
      },
      {
        id: 'event-2',
        sequence: 2,
        event_type: 'command_completed',
        payload: { status: 'failed' },
      },
    ]);

    expect(latestPlanStep(events)).toBe('Implement console');
  });
});
