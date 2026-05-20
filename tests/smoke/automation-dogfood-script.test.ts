import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  automationDogfoodExitCode,
  automationDogfoodCommand,
  expectedAutomationDogfoodActionTypes,
  expectedAutomationDogfoodPackageDraftCount,
  renderAutomationDogfoodSummary,
  requiredAutomationDogfoodSummaryMarkers,
} from '../../scripts/automation-dogfood-summary';
import { loadDogfoodGenerationRuntimeConfig, requestedGenerationMode } from '../../scripts/automation-dogfood';

const rootUrl = new URL('../..', import.meta.url);

const readText = (path: string) => readFileSync(new URL(path, rootUrl), 'utf8');
const readJson = (path: string) => JSON.parse(readFileSync(new URL(path, rootUrl), 'utf8'));
const emptyDogfoodResult = {
  planDraftCreated: false,
  packageDraftCount: 0,
  completedActionTypes: [],
  actionRunCount: 0,
  nonSucceededActionRunCount: 0,
  runSessionCount: 0,
  restartRecoveredFromActionRuns: false,
};

describe('automation dogfood script', () => {
  it('is registered as the root automation:dogfood command', () => {
    expect(automationDogfoodCommand).toBe('tsx --tsconfig apps/control-plane-api/tsconfig.json scripts/automation-dogfood.ts');
    expect(readJson('package.json').scripts).toMatchObject({
      'automation:dogfood': automationDogfoodCommand,
    });
  });

  it('uses product automation settings routes instead of old public delivery routes', () => {
    const source = readText('scripts/automation-dogfood.ts');

    expect(source).toContain('/automation/projects/${project.id}/capabilities');
    expect(source).not.toMatch(new RegExp(['/', 'p', '0', String.raw`/projects/[^'"\`]+/automation/capabilities`].join('')));
    expect(source).not.toContain('/' + 'p' + '0' + '/manual-path-holds');
  });

  it('renders required public-safe summary markers', () => {
    const requiredMarkers = [
      'Automation daemon dogfood',
      'Plan draft: PASSED',
      'ExecutionPackage drafts: PASSED',
      'Action runs: PASSED',
      'Action-run restart recovery: PASSED',
      'Run enqueue disabled: PASSED',
      'App-server dogfood:',
    ];
    const summary = renderAutomationDogfoodSummary({
      planDraftCreated: true,
      packageDraftCount: expectedAutomationDogfoodPackageDraftCount,
      completedActionTypes: ['ensure_plan_draft', 'ensure_package_drafts', 'project_runtime_snapshot'],
      actionRunCount: 3,
      nonSucceededActionRunCount: 0,
      runSessionCount: 0,
      restartRecoveredFromActionRuns: true,
      appServerDogfood: { status: 'skipped', reasonCode: 'fake_generation_mode' },
    });

    expect(requiredAutomationDogfoodSummaryMarkers).toEqual(requiredMarkers);
    expect(expectedAutomationDogfoodActionTypes).toEqual([
      'ensure_package_drafts',
      'ensure_plan_draft',
      'project_runtime_snapshot',
    ]);
    expect(expectedAutomationDogfoodPackageDraftCount).toBe(2);
    for (const marker of requiredMarkers) {
      expect(summary).toContain(marker);
    }
    expect(summary).toContain('no run session was enqueued');
    expect(summary).toContain('App-server dogfood: SKIPPED');
    expect(summary).not.toContain(process.cwd());
    expect(summary).not.toContain('automation-dogfood-secret');
    expect(summary).not.toContain('x-forgeloop');
  });

  it('reports skipped app-server dogfood preconditions without failing the local fake gate', () => {
    const summary = renderAutomationDogfoodSummary({
      planDraftCreated: false,
      packageDraftCount: 0,
      completedActionTypes: [],
      actionRunCount: 0,
      nonSucceededActionRunCount: 0,
      runSessionCount: 0,
      restartRecoveredFromActionRuns: false,
      appServerDogfood: { status: 'skipped', reasonCode: 'app_server_endpoint_missing' },
    });

    expect(summary).toContain('App-server dogfood: SKIPPED (app_server_endpoint_missing)');
    expect(automationDogfoodExitCode({ ...emptyDogfoodResult, appServerDogfood: { status: 'skipped', reasonCode: 'app_server_endpoint_missing' } })).toBe(0);
  });

  it('parses dogfood generation env without hiding explicit conflicts', () => {
    expect(requestedGenerationMode({ FORGELOOP_CODEX_AUTOMATION_GENERATION: 'codex' })).toBe('app_server');
    expect(requestedGenerationMode({ FORGELOOP_CODEX_GENERATION_DRIVER: 'app_server' })).toBe('app_server');
    expect(() =>
      requestedGenerationMode({
        FORGELOOP_CODEX_AUTOMATION_GENERATION: 'fake',
        FORGELOOP_CODEX_GENERATION_DRIVER: 'app_server',
      }),
    ).toThrow(/conflicts/);
    expect(() => requestedGenerationMode({ FORGELOOP_CODEX_GENERATION_DRIVER: 'disabled' })).toThrow(
      /must_be_fake_or_app_server/,
    );
  });

  it('does not create a fake runtime for disabled or app-server preflight skips', () => {
    const disabled = loadDogfoodGenerationRuntimeConfig({ FORGELOOP_CODEX_AUTOMATION_GENERATION: 'disabled' });
    expect(disabled.planning.mode).toBe('disabled');
    expect(disabled.runtime).toBeUndefined();
    expect(disabled.appServerDogfood).toEqual({ status: 'skipped', reasonCode: 'generation_disabled' });

    const missingEndpoint = loadDogfoodGenerationRuntimeConfig({ FORGELOOP_CODEX_AUTOMATION_GENERATION: 'codex' });
    expect(missingEndpoint.planning.mode).toBe('app_server');
    expect(missingEndpoint.runtime).toBeUndefined();
    expect(missingEndpoint.appServerDogfood).toEqual({ status: 'skipped', reasonCode: 'app_server_endpoint_missing' });
  });

  it('redacts non-allowlisted app-server dogfood reason text from public summaries', () => {
    const summary = renderAutomationDogfoodSummary({
      planDraftCreated: false,
      packageDraftCount: 0,
      completedActionTypes: [],
      actionRunCount: 1,
      nonSucceededActionRunCount: 1,
      runSessionCount: 0,
      restartRecoveredFromActionRuns: false,
      appServerDogfood: { status: 'failed', reasonCode: `${process.cwd()}/automation-dogfood-secret` },
    });

    expect(summary).toContain('App-server dogfood: FAILED (automation_dogfood_failed)');
    expect(summary).not.toContain(process.cwd());
    expect(summary).not.toContain('automation-dogfood-secret');
  });

  it('does not hard-code fake runtime when codex app-server mode is requested', () => {
    const source = readText('scripts/automation-dogfood.ts');

    expect(source).toContain('FORGELOOP_CODEX_AUTOMATION_GENERATION');
    expect(source).toContain('FORGELOOP_CODEX_APP_SERVER_ENDPOINT');
    expect(source).not.toContain("generationRuntime: createCodexGenerationRuntime({ mode: 'fake' })");
  });

  it('fails the dogfood gate unless every expected daemon artifact is present exactly once', () => {
    const passing = {
      planDraftCreated: true,
      packageDraftCount: expectedAutomationDogfoodPackageDraftCount,
      completedActionTypes: ['ensure_plan_draft', 'ensure_package_drafts', 'project_runtime_snapshot'],
      actionRunCount: 3,
      nonSucceededActionRunCount: 0,
      runSessionCount: 0,
      restartRecoveredFromActionRuns: true,
      appServerDogfood: { status: 'skipped', reasonCode: 'fake_generation_mode' },
    } as const;

    expect(automationDogfoodExitCode(passing)).toBe(0);
    expect(automationDogfoodExitCode({ ...passing, planDraftCreated: false })).toBe(1);
    expect(automationDogfoodExitCode({ ...passing, packageDraftCount: 0 })).toBe(1);
    expect(automationDogfoodExitCode({ ...passing, packageDraftCount: 1 })).toBe(1);
    expect(automationDogfoodExitCode({ ...passing, packageDraftCount: 3 })).toBe(1);
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
