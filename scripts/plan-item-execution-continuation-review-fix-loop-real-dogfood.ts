import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

import type {
  AbandonWorkflowSessionBodyDto,
  ContinueWorkflowExecutionBodyDto,
  RequestWorkflowReviewFixBodyDto,
  RespondToWorkflowReviewBodyDto,
} from '../apps/control-plane-api/src/modules/plan-item-workflows/plan-item-workflow.dto';

type EnvLike = Record<string, string | undefined>;
type Sha256Digest = `sha256:${string}`;

type PlanItemExecutionContinuationReviewFixLoopRealDogfoodConfig = {
  controlPlaneUrl: string;
  actorId: string;
  workflowId: string;
  reviewPacketId: string;
  reviewPacketDigest: Sha256Digest;
};

type WorkflowProjection = {
  id?: string;
  status?: string;
  execution_run_summary?: {
    run_session_id?: string;
    status?: string;
    input_capsule_digest?: string;
    codex_thread_id_digest?: string;
  };
  queued_actions?: Array<{
    kind?: string;
    status?: string;
    expected_input_capsule_digest?: string;
    output_capsule_digest?: string;
    output_capsule_sequence?: number;
    codex_thread_id_digest?: string;
  }>;
  attempt_history?: Array<{
    run_session_id?: string;
    attempt_kind?: string;
    previous_run_session_id?: string;
  }>;
  latest_review_response?: {
    id?: string;
    status?: string;
    previous_run_session_id?: string;
  };
  current_review_packet?: {
    id?: string;
    digest?: string;
  };
};

type PlanItemExecutionContinuationReviewFixLoopRealDogfoodReport =
  | {
      status: 'SKIPPED_NON_ACCEPTANCE';
      reason_code: 'plan_item_execution_continuation_review_fix_loop_real_runtime_acceptance_not_enabled';
    }
  | {
      status: 'BLOCKED';
      blocker_code: string;
      missing_env?: string[];
    }
  | {
      status: 'PASS';
      source: 'real_control_plane_runtime';
      workflow_id: string;
      route_calls: Array<{
        route:
          | 'POST /plan-item-workflows/:workflowId/execution/continue'
          | 'POST /plan-item-workflows/:workflowId/code-review/respond'
          | 'POST /plan-item-workflows/:workflowId/code-review/request-fix';
        runtime_call: true;
        status: string;
      }>;
      same_thread_digest: true;
      monotonic_capsule_sequence: true;
      expected_input_capsule_digests_match: true;
      review_response_read_only: true;
      fix_attempt_new_run_session: true;
      report_policy: 'public_safe_digests_counts_ids_only';
    };

type PlanItemExecutionContinuationReviewFixLoopRealDogfoodDeps = {
  fetchImpl?: typeof fetch;
};

const reportMarker = 'PLAN_ITEM_EXECUTION_CONTINUATION_REVIEW_FIX_LOOP_REAL_DOGFOOD_REPORT_JSON:';
const unsafeReportPattern =
  /(?:\/Users\/|\/home\/|\/tmp\/|~\/\.codex|auth_json|auth\.json|config\.toml|OPENAI_API_KEY|Bearer |sk-[A-Za-z0-9_.-]+|artifact:\/\/|lease-token|credential|automation_action_run|action_run_id|execution_package_id|runtime_job_id|codex_session_id"|codex_thread_id"|codex_session_turn_id|worker_id|memory_bundle_ref|environment_manifest_ref|internal_object_ref)/i;
const publicIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

class PlanItemExecutionContinuationReviewFixLoopRealDogfoodBlocker extends Error {
  constructor(readonly report: Extract<PlanItemExecutionContinuationReviewFixLoopRealDogfoodReport, { status: 'BLOCKED' }>) {
    super(report.blocker_code);
  }
}

const optionalEnv = (env: EnvLike, key: string): string | undefined => {
  const value = env[key]?.trim();
  return value === undefined || value.length === 0 ? undefined : value;
};

const acceptanceMode = (env: EnvLike): boolean => optionalEnv(env, 'FORGELOOP_WAVE7_REAL_DOGFOOD_ACCEPTANCE') === '1';

const assertSha256Digest = (value: unknown, label: string): asserts value is Sha256Digest => {
  if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(value)) {
    throw new PlanItemExecutionContinuationReviewFixLoopRealDogfoodBlocker({
      status: 'BLOCKED',
      blocker_code: `plan_item_execution_continuation_review_fix_loop_real_invalid_${label}`,
    });
  }
};

const assertSafeId = (value: string, label: string): void => {
  if (!publicIdPattern.test(value) || unsafeReportPattern.test(value)) {
    throw new PlanItemExecutionContinuationReviewFixLoopRealDogfoodBlocker({
      status: 'BLOCKED',
      blocker_code: `plan_item_execution_continuation_review_fix_loop_real_unsafe_${label}`,
    });
  }
};

const assertPublicSafeReport = (report: PlanItemExecutionContinuationReviewFixLoopRealDogfoodReport): void => {
  if (unsafeReportPattern.test(JSON.stringify(report))) {
    throw new PlanItemExecutionContinuationReviewFixLoopRealDogfoodBlocker({
      status: 'BLOCKED',
      blocker_code: 'plan_item_execution_continuation_review_fix_loop_real_report_unsafe',
    });
  }
};

const emitReport = (report: PlanItemExecutionContinuationReviewFixLoopRealDogfoodReport): void => {
  assertPublicSafeReport(report);
  console.log(`${reportMarker}${JSON.stringify(report)}`);
};

export const loadPlanItemExecutionContinuationReviewFixLoopRealDogfoodConfig = (
  env: EnvLike = process.env,
): PlanItemExecutionContinuationReviewFixLoopRealDogfoodConfig | undefined => {
  if (!acceptanceMode(env)) {
    return undefined;
  }

  const required = [
    'FORGELOOP_CONTROL_PLANE_URL',
    'FORGELOOP_CODEX_RUNTIME_SETUP_ACTOR_ID',
    'FORGELOOP_WAVE7_WORKFLOW_ID',
    'FORGELOOP_WAVE7_REVIEW_PACKET_ID',
    'FORGELOOP_WAVE7_REVIEW_PACKET_DIGEST',
  ];
  const missing = required.filter((key) => optionalEnv(env, key) === undefined);
  if (missing.length > 0) {
    throw new PlanItemExecutionContinuationReviewFixLoopRealDogfoodBlocker({
      status: 'BLOCKED',
      blocker_code: 'plan_item_execution_continuation_review_fix_loop_real_config_missing',
      missing_env: missing,
    });
  }

  const digest = optionalEnv(env, 'FORGELOOP_WAVE7_REVIEW_PACKET_DIGEST')!;
  assertSha256Digest(digest, 'review_packet_digest');
  return {
    controlPlaneUrl: optionalEnv(env, 'FORGELOOP_CONTROL_PLANE_URL')!.replace(/\/$/, ''),
    actorId: optionalEnv(env, 'FORGELOOP_CODEX_RUNTIME_SETUP_ACTOR_ID')!,
    workflowId: optionalEnv(env, 'FORGELOOP_WAVE7_WORKFLOW_ID')!,
    reviewPacketId: optionalEnv(env, 'FORGELOOP_WAVE7_REVIEW_PACKET_ID')!,
    reviewPacketDigest: digest,
  };
};

export const continueBodyForPlanItemExecutionContinuationReviewFixLoopRealDogfood = (
  config: PlanItemExecutionContinuationReviewFixLoopRealDogfoodConfig,
): ContinueWorkflowExecutionBodyDto => ({
  actor_id: config.actorId,
  idempotency_key: 'plan-item-execution-continuation-review-fix-loop-real-continue',
  input_markdown: 'Continue the interrupted Plan Item execution in the same Codex session.',
});

export const respondBodyForPlanItemExecutionContinuationReviewFixLoopRealDogfood = (
  config: PlanItemExecutionContinuationReviewFixLoopRealDogfoodConfig,
): RespondToWorkflowReviewBodyDto => ({
  actor_id: config.actorId,
  idempotency_key: 'plan-item-execution-continuation-review-fix-loop-real-respond',
  expected_review_packet_id: config.reviewPacketId,
  expected_review_packet_digest: config.reviewPacketDigest,
  response_prompt_markdown: 'Respond to the current Review Packet without modifying source files.',
});

export const requestFixBodyForPlanItemExecutionContinuationReviewFixLoopRealDogfood = (
  config: PlanItemExecutionContinuationReviewFixLoopRealDogfoodConfig,
): RequestWorkflowReviewFixBodyDto => ({
  actor_id: config.actorId,
  idempotency_key: 'plan-item-execution-continuation-review-fix-loop-real-request-fix',
  expected_review_packet_id: config.reviewPacketId,
  expected_review_packet_digest: config.reviewPacketDigest,
  fix_instruction_markdown: 'Apply the requested Review Packet changes in a new run attempt.',
});

export const abandonBodyForPlanItemExecutionContinuationReviewFixLoopRealDogfood = (
  config: PlanItemExecutionContinuationReviewFixLoopRealDogfoodConfig,
): AbandonWorkflowSessionBodyDto => ({
  actor_id: config.actorId,
  idempotency_key: 'plan-item-execution-continuation-review-fix-loop-real-abandon',
  next_action: 'request_fix',
  confirmation_phrase: 'abandon current session and start new session',
  reason: 'Real dogfood fallback body fixture only; the acceptance path does not abandon by default.',
});

const postWorkflowCommand = async (
  fetchImpl: typeof fetch,
  config: PlanItemExecutionContinuationReviewFixLoopRealDogfoodConfig,
  path: string,
  body: ContinueWorkflowExecutionBodyDto | RespondToWorkflowReviewBodyDto | RequestWorkflowReviewFixBodyDto,
): Promise<WorkflowProjection> => {
  const response = await fetchImpl(`${config.controlPlaneUrl}/plan-item-workflows/${encodeURIComponent(config.workflowId)}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => undefined)) as WorkflowProjection | undefined;
  if (!response.ok || payload?.id !== config.workflowId || payload.status === undefined) {
    throw new PlanItemExecutionContinuationReviewFixLoopRealDogfoodBlocker({
      status: 'BLOCKED',
      blocker_code: 'plan_item_execution_continuation_review_fix_loop_real_command_failed',
    });
  }
  return payload;
};

const runSessionIds = (workflow: WorkflowProjection): string[] =>
  [
    ...(workflow.execution_run_summary?.run_session_id === undefined ? [] : [workflow.execution_run_summary.run_session_id]),
    ...(workflow.attempt_history ?? []).flatMap((attempt) => (attempt.run_session_id === undefined ? [] : [attempt.run_session_id])),
  ];

const capsuleSequences = (workflow: WorkflowProjection): number[] =>
  (workflow.queued_actions ?? [])
    .flatMap((action) => (action.output_capsule_sequence === undefined ? [] : [action.output_capsule_sequence]))
    .sort((left, right) => left - right);

const latestCapsuleSignal = (workflow: WorkflowProjection) => {
  const signal = (workflow.queued_actions ?? []).findLast(
    (action) => action.expected_input_capsule_digest !== undefined || action.output_capsule_digest !== undefined,
  );
  if (signal?.expected_input_capsule_digest !== undefined) assertSha256Digest(signal.expected_input_capsule_digest, 'expected_input_capsule_digest');
  if (signal?.output_capsule_digest !== undefined) assertSha256Digest(signal.output_capsule_digest, 'output_capsule_digest');
  return signal;
};

const expectedInputDigestsMatch = (workflows: WorkflowProjection[]): boolean => {
  const signals = workflows.map(latestCapsuleSignal);
  if (signals.some((signal) => signal === undefined)) {
    return false;
  }
  for (let index = 1; index < signals.length; index += 1) {
    if (signals[index - 1]?.output_capsule_digest !== signals[index]?.expected_input_capsule_digest) {
      return false;
    }
  }
  return true;
};

export const runPlanItemExecutionContinuationReviewFixLoopRealDogfood = async (
  config: PlanItemExecutionContinuationReviewFixLoopRealDogfoodConfig,
  deps: PlanItemExecutionContinuationReviewFixLoopRealDogfoodDeps = {},
): Promise<Extract<PlanItemExecutionContinuationReviewFixLoopRealDogfoodReport, { status: 'PASS' }>> => {
  assertSafeId(config.workflowId, 'workflow_id');
  assertSafeId(config.reviewPacketId, 'review_packet_id');
  assertSha256Digest(config.reviewPacketDigest, 'review_packet_digest');

  const fetchImpl = deps.fetchImpl ?? fetch;
  const continued = await postWorkflowCommand(
    fetchImpl,
    config,
    '/execution/continue',
    continueBodyForPlanItemExecutionContinuationReviewFixLoopRealDogfood(config),
  );
  const responded = await postWorkflowCommand(
    fetchImpl,
    config,
    '/code-review/respond',
    respondBodyForPlanItemExecutionContinuationReviewFixLoopRealDogfood(config),
  );
  const fixed = await postWorkflowCommand(
    fetchImpl,
    config,
    '/code-review/request-fix',
    requestFixBodyForPlanItemExecutionContinuationReviewFixLoopRealDogfood(config),
  );

  const continuedRunIds = new Set(runSessionIds(continued));
  const respondedRunIds = new Set(runSessionIds(responded));
  const fixedRunIds = new Set(runSessionIds(fixed));
  const reviewResponseReadOnly =
    responded.latest_review_response?.id !== undefined &&
    responded.latest_review_response.status !== 'failed' &&
    respondedRunIds.size === continuedRunIds.size &&
    [...continuedRunIds].every((id) => respondedRunIds.has(id));
  const fixAttemptNewRunSession = fixedRunIds.size > respondedRunIds.size && [...respondedRunIds].every((id) => fixedRunIds.has(id));
  const threadDigests = [continued, responded, fixed].flatMap((workflow) => {
    const digest = workflow.execution_run_summary?.codex_thread_id_digest;
    return digest === undefined ? [] : [digest];
  });
  for (const digest of threadDigests) assertSha256Digest(digest, 'codex_thread_id_digest');
  const sameThreadDigest = threadDigests.length >= 2 && new Set(threadDigests).size === 1;
  const sequences = [continued, responded, fixed].flatMap(capsuleSequences);
  const monotonicCapsuleSequence = sequences.length > 0 && sequences.every((sequence, index) => index === 0 || sequence > sequences[index - 1]!);

  if (!sameThreadDigest || !monotonicCapsuleSequence || !expectedInputDigestsMatch([continued, responded, fixed]) || !reviewResponseReadOnly || !fixAttemptNewRunSession) {
    throw new PlanItemExecutionContinuationReviewFixLoopRealDogfoodBlocker({
      status: 'BLOCKED',
      blocker_code: 'plan_item_execution_continuation_review_fix_loop_real_evidence_missing',
    });
  }

  return {
    status: 'PASS',
    source: 'real_control_plane_runtime',
    workflow_id: config.workflowId,
    route_calls: [
      { route: 'POST /plan-item-workflows/:workflowId/execution/continue', runtime_call: true, status: continued.status! },
      { route: 'POST /plan-item-workflows/:workflowId/code-review/respond', runtime_call: true, status: responded.status! },
      { route: 'POST /plan-item-workflows/:workflowId/code-review/request-fix', runtime_call: true, status: fixed.status! },
    ],
    same_thread_digest: true,
    monotonic_capsule_sequence: true,
    expected_input_capsule_digests_match: true,
    review_response_read_only: true,
    fix_attempt_new_run_session: true,
    report_policy: 'public_safe_digests_counts_ids_only',
  };
};

const main = async (): Promise<number> => {
  try {
    const config = loadPlanItemExecutionContinuationReviewFixLoopRealDogfoodConfig();
    if (config === undefined) {
      emitReport({
        status: 'SKIPPED_NON_ACCEPTANCE',
        reason_code: 'plan_item_execution_continuation_review_fix_loop_real_runtime_acceptance_not_enabled',
      });
      return 0;
    }
    emitReport(await runPlanItemExecutionContinuationReviewFixLoopRealDogfood(config));
    return 0;
  } catch (error) {
    if (error instanceof PlanItemExecutionContinuationReviewFixLoopRealDogfoodBlocker) {
      emitReport(error.report);
      return 1;
    }
    throw error;
  }
};

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exitCode = await main();
}
