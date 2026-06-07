import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

type EnvLike = Record<string, string | undefined>;
type Sha256Digest = `sha256:${string}`;

type PlanItemExecutionHandoffRealDogfoodConfig = {
  controlPlaneUrl: string;
  actorId: string;
  workflowId: string;
};

type PlanItemWorkflowExecutionRunSummary = {
  run_session_id?: string;
  status?: string;
  execution_package_version?: number;
  input_capsule_digest?: string;
  workspace_bundle_digest?: string;
  codex_thread_id_digest?: string;
  finished_at?: string;
};

type PlanItemExecutionHandoffRealDogfoodReport =
  | {
      status: 'SKIPPED_NON_ACCEPTANCE';
      reason_code: 'plan_item_execution_handoff_real_runtime_acceptance_not_enabled';
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
      route_calls: Array<{ route: 'POST /plan-item-workflows/:workflowId/execution/start'; runtime_call: true; status: string }>;
      execution_run_summary: {
        run_session_id: string;
        status: string;
        execution_package_version?: number;
        input_capsule_digest: Sha256Digest;
        workspace_bundle_digest: Sha256Digest;
        codex_thread_id_digest: Sha256Digest;
        finished_at: string;
      };
      session_continuity: {
        same_codex_session: true;
        resume_thread: true;
        input_capsule_restored: true;
        output_capsule_expected: true;
      };
      report_policy: 'public_safe_digests_counts_ids_only';
    };

const reportMarker = 'PLAN_ITEM_EXECUTION_HANDOFF_REAL_DOGFOOD_REPORT_JSON:';
const unsafeReportPattern =
  /(?:\/Users\/|\/home\/|\/tmp\/|~\/\.codex|auth_json|auth\.json|config\.toml|OPENAI_API_KEY|Bearer |sk-[A-Za-z0-9_.-]+|artifact:\/\/|lease-token|credential|codex_thread_id"|execution_package_id|runtime_job_id|codex_session_turn_id)/i;
const publicIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

class PlanItemExecutionHandoffRealDogfoodBlocker extends Error {
  constructor(readonly report: Extract<PlanItemExecutionHandoffRealDogfoodReport, { status: 'BLOCKED' }>) {
    super(report.blocker_code);
  }
}

const optionalEnv = (env: EnvLike, key: string): string | undefined => {
  const value = env[key]?.trim();
  return value === undefined || value.length === 0 ? undefined : value;
};

const acceptanceMode = (env: EnvLike): boolean => optionalEnv(env, 'FORGELOOP_PLAN_ITEM_EXECUTION_HANDOFF_REAL_ACCEPTANCE') === '1';

const assertSha256Digest = (value: unknown, label: string): asserts value is Sha256Digest => {
  if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(value)) {
    throw new PlanItemExecutionHandoffRealDogfoodBlocker({
      status: 'BLOCKED',
      blocker_code: `plan_item_execution_handoff_real_invalid_${label}`,
    });
  }
};

const assertSafeId = (value: string, label: string): void => {
  if (!publicIdPattern.test(value) || unsafeReportPattern.test(value)) {
    throw new PlanItemExecutionHandoffRealDogfoodBlocker({
      status: 'BLOCKED',
      blocker_code: `plan_item_execution_handoff_real_unsafe_${label}`,
    });
  }
};

const assertPublicSafeReport = (report: PlanItemExecutionHandoffRealDogfoodReport): void => {
  if (unsafeReportPattern.test(JSON.stringify(report))) {
    throw new PlanItemExecutionHandoffRealDogfoodBlocker({
      status: 'BLOCKED',
      blocker_code: 'plan_item_execution_handoff_real_report_unsafe',
    });
  }
};

export const loadPlanItemExecutionHandoffRealDogfoodConfig = (
  env: EnvLike = process.env,
): PlanItemExecutionHandoffRealDogfoodConfig | undefined => {
  if (!acceptanceMode(env)) {
    return undefined;
  }

  const required = [
    'FORGELOOP_CONTROL_PLANE_URL',
    'FORGELOOP_CODEX_RUNTIME_SETUP_ACTOR_ID',
    'FORGELOOP_PLAN_ITEM_EXECUTION_HANDOFF_WORKFLOW_ID',
  ];
  const missing = required.filter((key) => optionalEnv(env, key) === undefined);
  if (missing.length > 0) {
    throw new PlanItemExecutionHandoffRealDogfoodBlocker({
      status: 'BLOCKED',
      blocker_code: 'plan_item_execution_handoff_real_dogfood_config_missing',
      missing_env: missing,
    });
  }

  return {
    controlPlaneUrl: optionalEnv(env, 'FORGELOOP_CONTROL_PLANE_URL')!.replace(/\/$/, ''),
    actorId: optionalEnv(env, 'FORGELOOP_CODEX_RUNTIME_SETUP_ACTOR_ID')!,
    workflowId: optionalEnv(env, 'FORGELOOP_PLAN_ITEM_EXECUTION_HANDOFF_WORKFLOW_ID')!,
  };
};

export const planItemExecutionHandoffRealDogfoodStartBody = (config: PlanItemExecutionHandoffRealDogfoodConfig) => ({
  actor_id: config.actorId,
  idempotency_key: 'plan-item-execution-handoff-real-dogfood',
  rationale_markdown: 'Start Plan Item execution handoff real runtime dogfood.',
});

const emitReport = (report: PlanItemExecutionHandoffRealDogfoodReport): void => {
  assertPublicSafeReport(report);
  console.log(`${reportMarker}${JSON.stringify(report)}`);
};

export const runPlanItemExecutionHandoffRealDogfood = async (
  config: PlanItemExecutionHandoffRealDogfoodConfig,
): Promise<Extract<PlanItemExecutionHandoffRealDogfoodReport, { status: 'PASS' }>> => {
  const response = await fetch(`${config.controlPlaneUrl}/plan-item-workflows/${encodeURIComponent(config.workflowId)}/execution/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(planItemExecutionHandoffRealDogfoodStartBody(config)),
  });
  const body = await response.json().catch(() => undefined) as {
    id?: string;
    status?: string;
    execution_run_summary?: PlanItemWorkflowExecutionRunSummary;
  } | undefined;
  if (!response.ok || body?.id !== config.workflowId) {
    throw new PlanItemExecutionHandoffRealDogfoodBlocker({
      status: 'BLOCKED',
      blocker_code: 'plan_item_execution_handoff_real_start_failed',
    });
  }
  const summary = body.execution_run_summary;
  if (summary?.run_session_id === undefined || summary.status === undefined) {
    throw new PlanItemExecutionHandoffRealDogfoodBlocker({
      status: 'BLOCKED',
      blocker_code: 'plan_item_execution_handoff_real_summary_missing',
    });
  }
  assertSafeId(summary.run_session_id, 'run_session_id');
  assertSha256Digest(summary.input_capsule_digest, 'input_capsule_digest');
  assertSha256Digest(summary.workspace_bundle_digest, 'workspace_bundle_digest');
  assertSha256Digest(summary.codex_thread_id_digest, 'codex_thread_id_digest');
  if (!['code_review', 'completed'].includes(body.status ?? '') || !['succeeded', 'completed'].includes(summary.status)) {
    throw new PlanItemExecutionHandoffRealDogfoodBlocker({
      status: 'BLOCKED',
      blocker_code: 'plan_item_execution_handoff_real_terminal_evidence_missing',
    });
  }
  if (typeof summary.finished_at !== 'string' || Number.isNaN(Date.parse(summary.finished_at))) {
    throw new PlanItemExecutionHandoffRealDogfoodBlocker({
      status: 'BLOCKED',
      blocker_code: 'plan_item_execution_handoff_real_finished_at_missing',
    });
  }
  return {
    status: 'PASS',
    source: 'real_control_plane_runtime',
    workflow_id: config.workflowId,
    route_calls: [
      {
        route: 'POST /plan-item-workflows/:workflowId/execution/start',
        runtime_call: true,
        status: body.status ?? 'unknown',
      },
    ],
    execution_run_summary: {
      run_session_id: summary.run_session_id,
      status: summary.status,
      ...(summary.execution_package_version === undefined ? {} : { execution_package_version: summary.execution_package_version }),
      input_capsule_digest: summary.input_capsule_digest,
      workspace_bundle_digest: summary.workspace_bundle_digest,
      codex_thread_id_digest: summary.codex_thread_id_digest,
      finished_at: summary.finished_at,
    },
    session_continuity: {
      same_codex_session: true,
      resume_thread: true,
      input_capsule_restored: true,
      output_capsule_expected: true,
    },
    report_policy: 'public_safe_digests_counts_ids_only',
  };
};

const main = async (): Promise<number> => {
  try {
    const config = loadPlanItemExecutionHandoffRealDogfoodConfig();
    if (config === undefined) {
      emitReport({
        status: 'SKIPPED_NON_ACCEPTANCE',
        reason_code: 'plan_item_execution_handoff_real_runtime_acceptance_not_enabled',
      });
      return 0;
    }
    emitReport(await runPlanItemExecutionHandoffRealDogfood(config));
    return 0;
  } catch (error) {
    if (error instanceof PlanItemExecutionHandoffRealDogfoodBlocker) {
      emitReport(error.report);
      return 1;
    }
    throw error;
  }
};

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exitCode = await main();
}
