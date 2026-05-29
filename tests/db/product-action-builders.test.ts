import { describe, expect, it } from 'vitest';

import { laneTarget, navigateAction } from '../../packages/db/src/queries/product-action-builders';

describe('product action builders', () => {
  it('maps lane targets to canonical product routes without legacy route baggage', () => {
    const laneTargets = {
      requirements: '/requirements',
      bugs: '/bugs',
      'tech-debt': '/tech-debt',
      initiatives: '/initiatives',
      'spec-approver': '/reviews',
      'execution-owner': '/executions',
      reviewer: '/reviews',
      'qa-test-owner': '/qa',
      'release-owner': '/releases',
      manager: '/cockpit',
    } as const;

    for (const [laneId, href] of Object.entries(laneTargets)) {
      expect(laneTarget(laneId as keyof typeof laneTargets)).toEqual({ kind: 'route', href });
      expect(
        navigateAction({
          id: `open-${laneId}`,
          laneId: laneId as keyof typeof laneTargets,
          priority: 'primary',
          label: 'Open lane',
          target: laneTarget(laneId as keyof typeof laneTargets),
        }),
      ).toMatchObject({
        kind: 'navigate',
        target: { kind: 'route', href },
      });
    }

    expect(JSON.stringify(Object.values(laneTargets))).not.toMatch(/specs-plans|dashboard/);
  });
});
