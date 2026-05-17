import { describe, expect, it } from 'vitest';

import {
  createRoleWorkbenchRequestGate,
  roleWorkbenchItemDetailLabels,
  roleWorkbenchItemTitle,
  roleWorkbenchObjectLabel,
  roleWorkbenchTabs,
} from '../../apps/web/src/workbenchState';

describe('role workbench tabs', () => {
  it('includes the MVP role matrix in operational order', () => {
    expect(roleWorkbenchTabs.map((tab) => tab.id)).toEqual([
      'intake',
      'spec-approver',
      'execution-owner',
      'reviewer',
      'qa-test-owner',
      'release-owner',
      'manager-health',
    ]);
  });

  it('formats queue item titles and object labels from projection data', () => {
    const item = {
      id: 'item-1',
      object: { type: 'work_item', id: 'work-item-1' },
      title: 'Triage run reliability',
    };

    expect(roleWorkbenchItemTitle(item)).toBe('Triage run reliability');
    expect(roleWorkbenchObjectLabel(item)).toBe('work item / work-item-1');
  });

  it('formats compact detail labels without actor ranking data', () => {
    const labels = roleWorkbenchItemDetailLabels({
      id: 'quality_gaps',
      queue: 'manager_health',
      object: { type: 'manager_health_group', id: 'quality_gaps' },
      project_id: 'project-1',
      phase: 'approval',
      status: 'blocked',
      risk: 'high',
      owner_actor_id: 'actor-owner',
      reviewer_actor_id: 'actor-reviewer',
      qa_owner_actor_id: 'actor-qa',
      score: 98,
      rank: 1,
    });

    expect(labels).toEqual([
      'project: project-1',
      'phase: approval',
      'status: blocked',
      'risk: high',
      'owner: actor-owner',
      'reviewer: actor-reviewer',
      'qa: actor-qa',
    ]);
    expect(labels.join(' ')).not.toMatch(/score|rank/i);
  });

  it('guards role queue state from out-of-order responses', async () => {
    const gate = createRoleWorkbenchRequestGate();
    const rendered: string[] = [];
    const first = deferred('intake');
    const second = deferred('reviewer');
    const load = async (response: Promise<string>) => {
      const requestId = gate.begin();
      const value = await response;
      if (gate.isCurrent(requestId)) rendered.push(value);
    };

    const firstLoad = load(first.promise);
    const secondLoad = load(second.promise);
    second.resolve();
    await secondLoad;
    first.resolve();
    await firstLoad;

    expect(rendered).toEqual(['reviewer']);
  });

  it('invalidates pending role queue requests before switching tabs', async () => {
    const gate = createRoleWorkbenchRequestGate();
    const requestId = gate.begin();

    gate.invalidate();

    expect(gate.isCurrent(requestId)).toBe(false);
  });
});

function deferred(value: string) {
  let resolve!: () => void;
  const promise = new Promise<string>((next) => {
    resolve = () => next(value);
  });
  return { promise, resolve };
}
