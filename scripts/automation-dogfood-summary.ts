export const automationDogfoodCommand = 'tsx --tsconfig apps/control-plane-api/tsconfig.json scripts/automation-dogfood.ts';

export const requiredAutomationDogfoodSummaryMarkers = [
  'Automation daemon dogfood',
  'Plan draft: PASSED',
  'ExecutionPackage drafts: PASSED',
  'Action runs: PASSED',
  'Action-run restart recovery: PASSED',
  'Run enqueue disabled: PASSED',
  'App-server dogfood:',
];

export const expectedAutomationDogfoodActionTypes = [
  'ensure_package_drafts',
  'ensure_plan_draft',
  'project_runtime_snapshot',
] as const;
export const expectedAutomationDogfoodPackageDraftCount = 2;

export type AutomationDogfoodAppServerStatus = 'passed' | 'skipped' | 'blocked' | 'failed';

const publicDogfoodReasonCodes = new Set([
  'fake_generation_mode',
  'generation_disabled',
  'app_server_endpoint_missing',
  'app_server_endpoint_invalid',
  'app_server_artifact_root_missing',
  'app_server_artifact_root_invalid',
  'automation_dogfood_failed',
  'codex_generation_disabled',
  'codex_generation_safety_unavailable',
  'codex_generation_sandbox_invalid',
  'codex_app_server_unavailable',
  'codex_generation_timeout',
  'codex_generation_cancelled',
  'codex_generation_concurrency_limit_exceeded',
  'codex_generation_raw_log_too_large',
  'codex_generation_turn_failed',
  'generated_output_invalid_json',
  'generated_output_ambiguous',
  'generated_output_schema_invalid',
  'generated_output_too_large',
  'generated_package_dependency_invalid',
  'generated_package_manifest_invalid',
  'generated_package_policy_invalid',
  'generated_spec_draft_invalid',
  'generated_plan_draft_invalid',
  'generated_payload_idempotency_drift',
]);

export interface AutomationDogfoodSummaryInput {
  planDraftCreated: boolean;
  packageDraftCount: number;
  completedActionTypes: string[];
  actionRunCount: number;
  nonSucceededActionRunCount: number;
  runSessionCount: number;
  restartRecoveredFromActionRuns: boolean;
  appServerDogfood: {
    status: AutomationDogfoodAppServerStatus;
    reasonCode?: string;
  };
}

export const hasExactlyExpectedAutomationDogfoodActionTypes = (actionTypes: readonly string[]): boolean => {
  const sorted = [...actionTypes].sort();
  return (
    sorted.length === expectedAutomationDogfoodActionTypes.length &&
    expectedAutomationDogfoodActionTypes.every((actionType, index) => sorted[index] === actionType)
  );
};

const automationDogfoodActionRunsPassed = (input: AutomationDogfoodSummaryInput): boolean =>
  input.actionRunCount === expectedAutomationDogfoodActionTypes.length &&
  input.nonSucceededActionRunCount === 0 &&
  hasExactlyExpectedAutomationDogfoodActionTypes(input.completedActionTypes);

const appServerPreflightSkipped = (input: AutomationDogfoodSummaryInput): boolean =>
  input.appServerDogfood.status === 'skipped' && input.appServerDogfood.reasonCode !== 'fake_generation_mode';

const publicDogfoodReasonCode = (reasonCode: string | undefined): string | undefined => {
  if (reasonCode === undefined) {
    return undefined;
  }
  return publicDogfoodReasonCodes.has(reasonCode) ? reasonCode : 'automation_dogfood_failed';
};

const dogfoodStatusText = (status: string, reasonCode?: string): string => {
  const publicReasonCode = publicDogfoodReasonCode(reasonCode);
  return `${status.toUpperCase()}${publicReasonCode === undefined ? '' : ` (${publicReasonCode})`}`;
};

export const renderAutomationDogfoodSummary = (input: AutomationDogfoodSummaryInput): string => {
  if (appServerPreflightSkipped(input)) {
    return [
      '# Automation daemon dogfood',
      '',
      '- Plan draft: SKIPPED',
      '- ExecutionPackage drafts: SKIPPED',
      '- Action runs: SKIPPED',
      '- Action-run restart recovery: SKIPPED',
      '- Run enqueue disabled: SKIPPED',
      `- App-server dogfood: ${dogfoodStatusText(input.appServerDogfood.status, input.appServerDogfood.reasonCode)}`,
    ].join('\n');
  }

  const completedActionTypes = [...new Set(input.completedActionTypes)].sort();
  const packageDraftPassed = input.packageDraftCount === expectedAutomationDogfoodPackageDraftCount;
  const actionRunsPassed = automationDogfoodActionRunsPassed(input);
  const runSessionLine =
    input.runSessionCount === 0
      ? '- Run enqueue disabled: PASSED (no run session was enqueued)'
      : `- Run enqueue disabled: FAILED (${input.runSessionCount} run session(s) were enqueued)`;
  return [
    '# Automation daemon dogfood',
    '',
    `- Plan draft: ${input.planDraftCreated ? 'PASSED' : 'FAILED'}`,
    `- ExecutionPackage drafts: ${packageDraftPassed ? 'PASSED' : 'FAILED'} (${input.packageDraftCount} draft package(s))`,
    `- Action runs: ${actionRunsPassed ? 'PASSED' : 'FAILED'} (${completedActionTypes.join(', ') || 'none'}; ${input.actionRunCount} total, ${input.nonSucceededActionRunCount} incomplete)`,
    `- Action-run restart recovery: ${input.restartRecoveredFromActionRuns ? 'PASSED' : 'FAILED'}`,
    runSessionLine,
    `- App-server dogfood: ${dogfoodStatusText(input.appServerDogfood.status, input.appServerDogfood.reasonCode)}`,
  ].join('\n');
};

export const automationDogfoodExitCode = (input: AutomationDogfoodSummaryInput): 0 | 1 =>
  appServerPreflightSkipped(input)
    ? 0
    : input.planDraftCreated &&
        input.packageDraftCount === expectedAutomationDogfoodPackageDraftCount &&
        automationDogfoodActionRunsPassed(input) &&
        input.runSessionCount === 0 &&
        input.restartRecoveredFromActionRuns &&
        (input.appServerDogfood.status === 'passed' ||
          (input.appServerDogfood.status === 'skipped' && input.appServerDogfood.reasonCode === 'fake_generation_mode'))
      ? 0
      : 1;
