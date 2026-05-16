export const automationDogfoodCommand = 'tsx --tsconfig apps/control-plane-api/tsconfig.json scripts/automation-dogfood.ts';

export const requiredAutomationDogfoodSummaryMarkers = [
  'Automation daemon dogfood',
  'Plan draft: PASSED',
  'ExecutionPackage drafts: PASSED',
  'Action runs: PASSED',
  'Action-run restart recovery: PASSED',
  'Run enqueue disabled: PASSED',
];

export const expectedAutomationDogfoodActionTypes = [
  'ensure_package_drafts',
  'ensure_plan_draft',
  'project_runtime_snapshot',
] as const;

export interface AutomationDogfoodSummaryInput {
  planDraftCreated: boolean;
  packageDraftCount: number;
  completedActionTypes: string[];
  actionRunCount: number;
  nonSucceededActionRunCount: number;
  runSessionCount: number;
  restartRecoveredFromActionRuns: boolean;
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

export const renderAutomationDogfoodSummary = (input: AutomationDogfoodSummaryInput): string => {
  const completedActionTypes = [...new Set(input.completedActionTypes)].sort();
  const packageDraftPassed = input.packageDraftCount === 1;
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
  ].join('\n');
};

export const automationDogfoodExitCode = (input: AutomationDogfoodSummaryInput): 0 | 1 =>
  input.planDraftCreated &&
  input.packageDraftCount === 1 &&
  automationDogfoodActionRunsPassed(input) &&
  input.runSessionCount === 0 &&
  input.restartRecoveredFromActionRuns
    ? 0
    : 1;
