import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  automationDogfoodExitCode,
  automationDogfoodCommand,
  renderAutomationDogfoodSummary,
  requiredAutomationDogfoodSummaryMarkers,
} from '../../scripts/automation-dogfood';

const rootUrl = new URL('../..', import.meta.url);

const readJson = (path: string) => JSON.parse(readFileSync(new URL(path, rootUrl), 'utf8'));

describe('automation dogfood script', () => {
  it('is registered as the root automation:dogfood command', () => {
    expect(automationDogfoodCommand).toBe('tsx --tsconfig apps/control-plane-api/tsconfig.json scripts/automation-dogfood.ts');
    expect(readJson('package.json').scripts).toMatchObject({
      'automation:dogfood': automationDogfoodCommand,
    });
  });

  it('renders required public-safe summary markers', () => {
    const summary = renderAutomationDogfoodSummary({
      planDraftCreated: true,
      packageDraftCount: 1,
      completedActionTypes: ['ensure_plan_draft', 'ensure_package_drafts', 'project_runtime_snapshot'],
      runSessionCount: 0,
      restartRecoveredFromActionRuns: true,
    });

    for (const marker of requiredAutomationDogfoodSummaryMarkers) {
      expect(summary).toContain(marker);
    }
    expect(summary).toContain('no run session was enqueued');
    expect(summary).not.toContain('/Users/');
  });

  it('fails the dogfood gate unless every expected daemon artifact is present exactly once', () => {
    expect(
      automationDogfoodExitCode({
        planDraftCreated: true,
        packageDraftCount: 1,
        completedActionTypes: ['ensure_plan_draft', 'ensure_package_drafts', 'project_runtime_snapshot'],
        runSessionCount: 0,
        restartRecoveredFromActionRuns: true,
      }),
    ).toBe(0);
    expect(
      automationDogfoodExitCode({
        planDraftCreated: true,
        packageDraftCount: 2,
        completedActionTypes: ['ensure_plan_draft', 'ensure_package_drafts', 'project_runtime_snapshot'],
        runSessionCount: 0,
        restartRecoveredFromActionRuns: true,
      }),
    ).toBe(1);
    expect(
      automationDogfoodExitCode({
        planDraftCreated: true,
        packageDraftCount: 1,
        completedActionTypes: ['ensure_plan_draft'],
        runSessionCount: 0,
        restartRecoveredFromActionRuns: true,
      }),
    ).toBe(1);
  });
});
