import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  automationDogfoodExitCode,
  automationDogfoodCommand,
  expectedAutomationDogfoodActionTypes,
  renderAutomationDogfoodSummary,
  requiredAutomationDogfoodSummaryMarkers,
} from '../../scripts/automation-dogfood-summary';

const rootUrl = new URL('../..', import.meta.url);

const readText = (path: string) => readFileSync(new URL(path, rootUrl), 'utf8');
const readJson = (path: string) => JSON.parse(readFileSync(new URL(path, rootUrl), 'utf8'));

describe('automation dogfood script', () => {
  it('is registered as the root automation:dogfood command', () => {
    expect(automationDogfoodCommand).toBe('tsx --tsconfig apps/control-plane-api/tsconfig.json scripts/automation-dogfood.ts');
    expect(readJson('package.json').scripts).toMatchObject({
      'automation:dogfood': automationDogfoodCommand,
    });
  });

  it('uses product automation settings routes instead of old public P0 routes', () => {
    const source = readText('scripts/automation-dogfood.ts');

    expect(source).toContain('/automation/projects/${project.id}/capabilities');
    expect(source).not.toMatch(/\/p0\/projects\/[^'"`]+\/automation\/capabilities/);
    expect(source).not.toContain('/p0/manual-path-holds');
  });

  it('renders required public-safe summary markers', () => {
    const requiredMarkers = [
      'Automation daemon dogfood',
      'Plan draft: PASSED',
      'ExecutionPackage drafts: PASSED',
      'Action runs: PASSED',
      'Action-run restart recovery: PASSED',
      'Run enqueue disabled: PASSED',
    ];
    const summary = renderAutomationDogfoodSummary({
      planDraftCreated: true,
      packageDraftCount: 1,
      completedActionTypes: ['ensure_plan_draft', 'ensure_package_drafts', 'project_runtime_snapshot'],
      actionRunCount: 3,
      nonSucceededActionRunCount: 0,
      runSessionCount: 0,
      restartRecoveredFromActionRuns: true,
    });

    expect(requiredAutomationDogfoodSummaryMarkers).toEqual(requiredMarkers);
    expect(expectedAutomationDogfoodActionTypes).toEqual([
      'ensure_package_drafts',
      'ensure_plan_draft',
      'project_runtime_snapshot',
    ]);
    for (const marker of requiredMarkers) {
      expect(summary).toContain(marker);
    }
    expect(summary).toContain('no run session was enqueued');
    expect(summary).not.toContain(process.cwd());
    expect(summary).not.toContain('automation-dogfood-secret');
    expect(summary).not.toContain('x-forgeloop');
  });

  it('fails the dogfood gate unless every expected daemon artifact is present exactly once', () => {
    const passing = {
      planDraftCreated: true,
      packageDraftCount: 1,
      completedActionTypes: ['ensure_plan_draft', 'ensure_package_drafts', 'project_runtime_snapshot'],
      actionRunCount: 3,
      nonSucceededActionRunCount: 0,
      runSessionCount: 0,
      restartRecoveredFromActionRuns: true,
    } as const;

    expect(automationDogfoodExitCode(passing)).toBe(0);
    expect(automationDogfoodExitCode({ ...passing, planDraftCreated: false })).toBe(1);
    expect(automationDogfoodExitCode({ ...passing, packageDraftCount: 0 })).toBe(1);
    expect(automationDogfoodExitCode({ ...passing, packageDraftCount: 2 })).toBe(1);
    expect(automationDogfoodExitCode({ ...passing, completedActionTypes: ['ensure_plan_draft'] })).toBe(1);
    expect(
      automationDogfoodExitCode({
        ...passing,
        completedActionTypes: ['ensure_plan_draft', 'ensure_plan_draft', 'ensure_package_drafts', 'project_runtime_snapshot'],
        actionRunCount: 4,
      }),
    ).toBe(1);
    expect(
      automationDogfoodExitCode({
        ...passing,
        completedActionTypes: ['ensure_plan_draft', 'ensure_package_drafts', 'project_runtime_snapshot', 'unexpected_action'],
        actionRunCount: 4,
      }),
    ).toBe(1);
    expect(automationDogfoodExitCode({ ...passing, actionRunCount: 4 })).toBe(1);
    expect(automationDogfoodExitCode({ ...passing, actionRunCount: 4, nonSucceededActionRunCount: 1 })).toBe(1);
    expect(automationDogfoodExitCode({ ...passing, runSessionCount: 1 })).toBe(1);
    expect(automationDogfoodExitCode({ ...passing, restartRecoveredFromActionRuns: false })).toBe(1);
  });
});
