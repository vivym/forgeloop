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
export type AutomationDogfoodRuntimeMode = 'local_docker' | 'remote_outbound';

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
  'codex_launch_lease_denied',
  'codex_launch_materialization_denied',
  'codex_worker_unavailable',
  'codex_worker_docker_policy_unavailable',
  'codex_app_server_effective_config_mismatch',
  'codex_runtime_workspace_isolation_unavailable',
  'codex_docker_runtime_evidence_unsafe',
  'codex_runtime_profile_invalid',
  'codex_docker_runtime_required',
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
    runtimeMode?: AutomationDogfoodRuntimeMode;
    blockerCode?: string;
    dockerizedAppServerEvidence?: {
      dockerImageDigest?: string;
      networkPolicyDigest?: string;
      effectiveConfigDigest?: string;
      containerIdDigest?: string;
    } & Record<string, unknown>;
    artifacts?: Array<{
      name?: string;
      digest?: string;
    } & Record<string, unknown>>;
    timingBuckets?: {
      queue?: string;
      execution?: string;
      terminalization?: string;
    } & Record<string, unknown>;
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

const digestPattern = /^sha256:[a-f0-9]{64}$/;
const safeDigest = (value: string | undefined): string | undefined => (value !== undefined && digestPattern.test(value) ? value : undefined);

const timingBucketPattern = /^(?:<\d+(?:ms|s|m)|\d+-\d+(?:ms|s|m)|>\d+(?:ms|s|m))$/;
const safeTimingBucket = (value: string | undefined): string | undefined =>
  value !== undefined && timingBucketPattern.test(value) ? value : undefined;

const safeArtifactName = (value: string | undefined): string | undefined =>
  value !== undefined && /^[a-z0-9][a-z0-9._-]{0,63}$/.test(value) ? value : undefined;

const appServerEvidenceLines = (appServerDogfood: AutomationDogfoodSummaryInput['appServerDogfood']): string[] => {
  const lines: string[] = [];
  if (appServerDogfood.runtimeMode !== undefined) {
    lines.push(`- Remote runtime mode: ${appServerDogfood.runtimeMode}`);
  }
  const blockerCode = publicDogfoodReasonCode(appServerDogfood.blockerCode);
  if (blockerCode !== undefined) {
    lines.push(`- Public blocker code: ${blockerCode}`);
  }
  const evidence = appServerDogfood.dockerizedAppServerEvidence;
  if (evidence !== undefined) {
    const parts = [
      ['docker_image_digest', safeDigest(evidence.dockerImageDigest)],
      ['network_policy_digest', safeDigest(evidence.networkPolicyDigest)],
      ['effective_config_digest', safeDigest(evidence.effectiveConfigDigest)],
      ['container_id_digest', safeDigest(evidence.containerIdDigest)],
    ]
      .filter((entry): entry is [string, string] => entry[1] !== undefined)
      .map(([name, value]) => `${name}=${value}`);
    if (parts.length > 0) {
      lines.push(`- Dockerized app-server evidence: ${parts.join(' ')}`);
    }
  }
  const artifacts = (appServerDogfood.artifacts ?? [])
    .map((artifact) => {
      const name = safeArtifactName(artifact.name);
      const digest = safeDigest(artifact.digest);
      return name === undefined || digest === undefined ? undefined : `${name}=${digest}`;
    })
    .filter((entry): entry is string => entry !== undefined);
  if (artifacts.length > 0) {
    lines.push(`- Remote runtime artifacts: ${artifacts.join(' ')}`);
  }
  const timing = appServerDogfood.timingBuckets;
  if (timing !== undefined) {
    const parts = [
      ['queue', safeTimingBucket(timing.queue)],
      ['execution', safeTimingBucket(timing.execution)],
      ['terminalization', safeTimingBucket(timing.terminalization)],
    ]
      .filter((entry): entry is [string, string] => entry[1] !== undefined)
      .map(([name, value]) => `${name}=${value}`);
    if (parts.length > 0) {
      lines.push(`- Remote runtime timing: ${parts.join(' ')}`);
    }
  }
  return lines;
};

const hasDockerizedAppServerEvidence = (appServerDogfood: AutomationDogfoodSummaryInput['appServerDogfood']): boolean =>
  appServerDogfood.runtimeMode !== undefined &&
  safeDigest(appServerDogfood.dockerizedAppServerEvidence?.dockerImageDigest) !== undefined &&
  safeDigest(appServerDogfood.dockerizedAppServerEvidence?.networkPolicyDigest) !== undefined &&
  safeDigest(appServerDogfood.dockerizedAppServerEvidence?.effectiveConfigDigest) !== undefined &&
  safeDigest(appServerDogfood.dockerizedAppServerEvidence?.containerIdDigest) !== undefined &&
  (appServerDogfood.artifacts ?? []).some(
    (artifact) => safeArtifactName(artifact.name) !== undefined && safeDigest(artifact.digest) !== undefined,
  ) &&
  safeTimingBucket(appServerDogfood.timingBuckets?.queue) !== undefined &&
  safeTimingBucket(appServerDogfood.timingBuckets?.execution) !== undefined &&
  safeTimingBucket(appServerDogfood.timingBuckets?.terminalization) !== undefined;

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
      ...appServerEvidenceLines(input.appServerDogfood),
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
    ...appServerEvidenceLines(input.appServerDogfood),
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
        ((input.appServerDogfood.status === 'passed' && hasDockerizedAppServerEvidence(input.appServerDogfood)) ||
          (input.appServerDogfood.status === 'skipped' && input.appServerDogfood.reasonCode === 'fake_generation_mode'))
      ? 0
      : 1;
