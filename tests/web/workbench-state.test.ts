import { describe, expect, it } from 'vitest';

import {
  buildObservationEvidencePayload,
  groupReleaseBlockers,
  isActiveCockpit,
  releaseNextActionLabel,
} from '../../apps/web/src/workbenchState';

describe('workbench state helpers', () => {
  it('only treats cockpit data as active when it matches the selected work item', () => {
    expect(isActiveCockpit({ work_item: { id: 'work-item-1' } }, 'work-item-1')).toBe(true);
    expect(isActiveCockpit({ work_item: { id: 'work-item-1' } }, 'work-item-2')).toBe(false);
    expect(isActiveCockpit({}, 'work-item-1')).toBe(false);
    expect(isActiveCockpit({ work_item: { id: 'work-item-1' } }, '')).toBe(false);
  });

  it('groups release blockers by category while preserving blocker details', () => {
    const groups = groupReleaseBlockers([
      {
        code: 'missing_work_item',
        category: 'structural',
        overrideable: false,
        message: 'Link at least one work item.',
      },
      {
        code: 'missing_observation_plan',
        category: 'planning',
        overrideable: true,
        message: 'Add an observation plan.',
      },
      {
        code: 'failed_required_check',
        category: 'risk',
        overrideable: true,
        message: 'Required check failed.',
        object_type: 'execution_package',
        object_id: 'package-1',
      },
    ]);

    expect(groups).toEqual([
      {
        id: 'structural',
        label: 'Structural',
        blockers: [
          {
            code: 'missing_work_item',
            category: 'structural',
            overrideable: false,
            message: 'Link at least one work item.',
          },
        ],
      },
      {
        id: 'risk',
        label: 'Risk',
        blockers: [
          {
            code: 'failed_required_check',
            category: 'risk',
            overrideable: true,
            message: 'Required check failed.',
            object_type: 'execution_package',
            object_id: 'package-1',
          },
        ],
      },
      {
        id: 'planning',
        label: 'Planning',
        blockers: [
          {
            code: 'missing_observation_plan',
            category: 'planning',
            overrideable: true,
            message: 'Add an observation plan.',
          },
        ],
      },
    ]);
  });

  it('renders release next action labels from backend action strings', () => {
    expect(releaseNextActionLabel('submit_for_approval')).toBe('Submit for approval');
    expect(releaseNextActionLabel('close_completed')).toBe('Close completed');
    expect(releaseNextActionLabel('manual_override_required')).toBe('Manual override required');
  });

  it('builds release observation evidence payloads with observation links only', () => {
    const payload = buildObservationEvidencePayload({
      actorId: 'actor-owner',
      summary: 'Observed healthy rollout.',
      severity: 'info',
      observedAt: '2026-05-11T00:00:00.000Z',
      links: [
        { object_type: 'artifact', object_id: 'artifact-1', relationship: 'observed' },
        { object_type: 'decision', object_id: 'decision-1', relationship: 'generated_by' },
      ],
      metrics: { error_rate: 0.01, healthy: true },
      notes: 'No regression detected.',
    });

    expect(payload).toEqual({
      actor_id: 'actor-owner',
      evidence_type: 'observation_note',
      summary: 'Observed healthy rollout.',
      extra: {
        observation: {
          source: 'human',
          severity: 'info',
          summary: 'Observed healthy rollout.',
          observed_at: '2026-05-11T00:00:00.000Z',
          actor_id: 'actor-owner',
          links: [
            { object_type: 'artifact', object_id: 'artifact-1', relationship: 'observed' },
            { object_type: 'decision', object_id: 'decision-1', relationship: 'generated_by' },
          ],
          metrics: { error_rate: 0.01, healthy: true },
          notes: 'No regression detected.',
        },
      },
      redacted: false,
      status: 'current',
    });
    expect(JSON.stringify(payload)).not.toMatch(/incident|change/i);
  });
});
