import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

import { signAutomationRequest } from '../packages/automation/src/index';
import {
  codexCanonicalDigest,
  type PlanItemWorkflowPublicDto,
  type PlanItemWorkflowQueuedAction,
} from '../packages/domain/src/index';
import {
  codexRuntimeDogfoodBootstrapTokenForTarget,
  codexRuntimeDogfoodWorkerIdentityForTarget,
} from './codex-runtime-dogfood-bootstrap';

type EnvLike = Record<string, string | undefined>;
type Sha256Digest = `sha256:${string}`;
type WorkflowArtifactType = 'boundary-summary' | 'spec-doc' | 'implementation-plan-doc';
type QueueKind = PlanItemWorkflowQueuedAction['kind'];
type QueueStatus = PlanItemWorkflowQueuedAction['status'];

type RouteCall = {
  route: string;
  status: string;
  runtime_call: boolean;
  queued_action_kind?: QueueKind;
};

type CompletedActionProof = {
  kind: QueueKind;
  status: Extract<QueueStatus, 'succeeded'>;
  output_capsule_digest: Sha256Digest;
  output_capsule_sequence: number;
  codex_thread_id_digest: Sha256Digest;
};

type PlanItemProjection = {
  id: string;
  title?: string;
  plan_item_workflow?: PlanItemWorkflowPublicDto;
  runtime_boundary?: {
    type: 'execution_package';
    id: string;
    phase: string;
    activity_state: string;
    gate_state: string;
    implementation_plan_revision_id?: string;
  };
  executions?: unknown[];
  code_review_handoffs?: unknown[];
  qa_handoffs?: unknown[];
};

type PublicExecutionPackageProof = {
  phase: string;
  activity_state: string;
  gate_state: string;
  resolution: string;
  current_run_session_id?: string;
  last_run_session_id?: string;
  current_review_packet_id?: string;
};

type NoExecutionRuntimeStateCreated = {
  run_session_count: number;
  execution_worker_job_count: number;
  workspace_bundle_count: number;
  pr_count: number;
  review_loop_count: number;
};

type DogfoodConfig = {
  controlPlaneUrl: string;
  actorId: string;
  projectId: string;
  planningInputId: string;
  planningInputType: 'requirement' | 'initiative' | 'bug' | 'tech_debt';
  developmentPlanId?: string;
  developmentPlanItemId?: string;
  autoSeedProductSource: boolean;
  generationRuntimeProfileId?: string;
  generationRuntimeProfileRevisionId?: string;
  generationCredentialBindingId?: string;
  generationCredentialBindingVersionId?: string;
  skipBootstrap: boolean;
  remoteRuntimeJobWaitTimeoutMs: number;
  remoteRuntimeJobPollIntervalMs: number;
  env: EnvLike;
};

type DogfoodReport =
  | {
      status: 'SKIPPED_NON_ACCEPTANCE';
      reason_code: 'real_runtime_acceptance_not_enabled';
    }
  | {
      status: 'BLOCKED';
      blocker_code: string;
      missing_env?: string[];
      route_calls?: RouteCall[];
    }
  | {
      status: 'PASS';
      source: 'real_control_plane_runtime';
      workflow_id: string;
      development_plan_id: string;
      development_plan_item_id: string;
      route_calls: RouteCall[];
      session_continuity: {
        same_codex_thread_id_digest: true;
        codex_thread_id_digest: Sha256Digest;
        generation_turn_count: number;
      };
      queued_actions: CompletedActionProof[];
      capsule_sequence: {
        monotonic: true;
        sequences: number[];
      };
      artifacts: {
        boundary_summary_revision_id: string;
        spec_revision_id: string;
        implementation_plan_revision_id: string;
      };
      readiness: {
        state: 'ready';
        workflow_status: 'execution_ready';
        blocker_codes: string[];
      };
      no_execution_runtime_state_created: {
        run_session_count: number;
        execution_worker_job_count: number;
        workspace_bundle_count: number;
        pr_count: number;
        review_loop_count: number;
      };
      execution_package_boundary: {
        execution_package_count: 1;
        phase: 'draft';
        activity_state: 'idle';
        gate_state: 'not_submitted';
        resolution: 'none';
        run_session_count: 0;
      };
      report_policy: 'public_safe_digests_counts_ids_only';
    };

const reportMarker = 'REAL_DOGFOOD_REPORT_JSON:';
const routeStartBrainstorming = 'POST /development-plans/:developmentPlanId/items/:itemId/workflow/start-brainstorming';
const routeMessages = 'POST /plan-item-workflows/:workflowId/messages';
const routeRunAction = 'POST /plan-item-workflows/:workflowId/actions/:actionId/run';
const routeApproveArtifact = 'POST /plan-item-workflows/:workflowId/artifacts/:artifactType/revisions/:revisionId/approve';
const routeRequestChanges = 'POST /plan-item-workflows/:workflowId/artifacts/:artifactType/revisions/:revisionId/request-changes';
const routeReadiness = 'POST /plan-item-workflows/:workflowId/execution-readiness/evaluate';
const requiredRuntimeKinds = new Set<QueueKind>([
  'generate_boundary_summary',
  'generate_spec_doc',
  'revise_spec_doc',
  'generate_implementation_plan_doc',
  'revise_implementation_plan_doc',
]);
const publicIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const unsafeReportPattern =
  /(?:\/Users\/|\/home\/|\/tmp\/|~\/\.codex|\.codex|auth_json|auth\.json|config\.toml|OPENAI_API_KEY|Bearer |sk-[A-Za-z0-9_.-]+|https?:\/\/|127\.0\.0\.1|localhost|artifact:\/\/|prompt transcript|codex_thread_id")/i;

class RealDogfoodBlocker extends Error {
  constructor(readonly blockerCode: string, readonly report: Extract<DogfoodReport, { status: 'BLOCKED' }>) {
    super(blockerCode);
  }
}

const optionalEnv = (env: EnvLike, key: string): string | undefined => {
  const value = env[key]?.trim();
  return value === undefined || value.length === 0 ? undefined : value;
};

const positiveIntEnv = (env: EnvLike, key: string, defaultValue: number): number => {
  const raw = optionalEnv(env, key);
  if (raw === undefined) return defaultValue;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new RealDogfoodBlocker(`${key}_must_be_positive_integer`, {
      status: 'BLOCKED',
      blocker_code: `${key}_must_be_positive_integer`,
    });
  }
  return value;
};

const acceptanceMode = (env: EnvLike): boolean => optionalEnv(env, 'FORGELOOP_REAL_RUNTIME_ACCEPTANCE') === '1';

const assertSha256Digest = (value: unknown, label: string): asserts value is Sha256Digest => {
  if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(value)) {
    throw new RealDogfoodBlocker('plan_item_workflow_real_dogfood_report_unsafe', {
      status: 'BLOCKED',
      blocker_code: `invalid_${label}`,
    });
  }
};

const assertSafeId = (value: string, label: string): void => {
  if (!publicIdPattern.test(value) || value.includes('..') || unsafeReportPattern.test(value)) {
    throw new RealDogfoodBlocker('plan_item_workflow_real_dogfood_report_unsafe', {
      status: 'BLOCKED',
      blocker_code: `unsafe_${label}`,
    });
  }
};

const assertPublicSafeReport = (report: DogfoodReport): void => {
  const serialized = JSON.stringify(report);
  if (unsafeReportPattern.test(serialized)) {
    throw new RealDogfoodBlocker('plan_item_workflow_real_dogfood_report_unsafe', {
      status: 'BLOCKED',
      blocker_code: 'plan_item_workflow_real_dogfood_report_unsafe',
    });
  }
};

const emitReport = (report: DogfoodReport): void => {
  assertPublicSafeReport(report);
  console.log(`${reportMarker}${JSON.stringify(report)}`);
};

const blocker = (code: string, extra: Omit<Extract<DogfoodReport, { status: 'BLOCKED' }>, 'status' | 'blocker_code'> = {}) =>
  new RealDogfoodBlocker(code, { status: 'BLOCKED', blocker_code: code, ...extra });

export const loadPlanItemWorkflowRealDogfoodConfig = (env: EnvLike = process.env): DogfoodConfig | undefined => {
  if (!acceptanceMode(env)) {
    return undefined;
  }

  const required = [
    'FORGELOOP_CONTROL_PLANE_URL',
    'FORGELOOP_CODEX_RUNTIME_SETUP_ACTOR_ID',
    'FORGELOOP_CODEX_DOGFOOD_PROJECT_ID',
    'FORGELOOP_CODEX_DOGFOOD_PLANNING_INPUT_ID',
  ];
  const missing = required.filter((key) => optionalEnv(env, key) === undefined);
  if (missing.length > 0) {
    throw blocker('plan_item_workflow_real_dogfood_config_missing', { missing_env: missing });
  }

  const developmentPlanId = optionalEnv(env, 'FORGELOOP_PLAN_ITEM_WORKFLOW_DOGFOOD_DEVELOPMENT_PLAN_ID');
  const developmentPlanItemId = optionalEnv(env, 'FORGELOOP_PLAN_ITEM_WORKFLOW_DOGFOOD_ITEM_ID');
  if ((developmentPlanId === undefined) !== (developmentPlanItemId === undefined)) {
    throw blocker('plan_item_workflow_real_dogfood_plan_item_pair_missing');
  }

  const planningInputType = optionalEnv(env, 'FORGELOOP_CODEX_DOGFOOD_PLANNING_INPUT_TYPE') ?? 'requirement';
  if (planningInputType !== 'requirement' && planningInputType !== 'initiative' && planningInputType !== 'bug' && planningInputType !== 'tech_debt') {
    throw blocker('plan_item_workflow_real_dogfood_planning_input_type_invalid');
  }

  return {
    controlPlaneUrl: optionalEnv(env, 'FORGELOOP_CONTROL_PLANE_URL')!.replace(/\/$/, ''),
    actorId: optionalEnv(env, 'FORGELOOP_CODEX_RUNTIME_SETUP_ACTOR_ID')!,
    projectId: optionalEnv(env, 'FORGELOOP_CODEX_DOGFOOD_PROJECT_ID')!,
    planningInputId: optionalEnv(env, 'FORGELOOP_CODEX_DOGFOOD_PLANNING_INPUT_ID')!,
    planningInputType,
    ...(developmentPlanId === undefined ? {} : { developmentPlanId }),
    ...(developmentPlanItemId === undefined ? {} : { developmentPlanItemId }),
    autoSeedProductSource:
      developmentPlanId === undefined &&
      (optionalEnv(env, 'FORGELOOP_PLAN_ITEM_WORKFLOW_DOGFOOD_CREATE_SOURCE') === '1' ||
        optionalEnv(env, 'FORGELOOP_CODEX_DOGFOOD_CREATE_SOURCE') === '1'),
    ...(optionalEnv(env, 'FORGELOOP_CODEX_GENERATION_RUNTIME_PROFILE_ID') === undefined
      ? {}
      : { generationRuntimeProfileId: optionalEnv(env, 'FORGELOOP_CODEX_GENERATION_RUNTIME_PROFILE_ID') }),
    ...(optionalEnv(env, 'FORGELOOP_CODEX_GENERATION_RUNTIME_PROFILE_REVISION_ID') === undefined
      ? {}
      : { generationRuntimeProfileRevisionId: optionalEnv(env, 'FORGELOOP_CODEX_GENERATION_RUNTIME_PROFILE_REVISION_ID') }),
    ...(optionalEnv(env, 'FORGELOOP_CODEX_GENERATION_CREDENTIAL_BINDING_ID') === undefined
      ? {}
      : { generationCredentialBindingId: optionalEnv(env, 'FORGELOOP_CODEX_GENERATION_CREDENTIAL_BINDING_ID') }),
    ...(optionalEnv(env, 'FORGELOOP_CODEX_GENERATION_CREDENTIAL_BINDING_VERSION_ID') === undefined
      ? {}
      : { generationCredentialBindingVersionId: optionalEnv(env, 'FORGELOOP_CODEX_GENERATION_CREDENTIAL_BINDING_VERSION_ID') }),
    skipBootstrap: optionalEnv(env, 'FORGELOOP_CODEX_DOGFOOD_SKIP_BOOTSTRAP') === '1',
    remoteRuntimeJobWaitTimeoutMs: positiveIntEnv(env, 'FORGELOOP_CODEX_REMOTE_RUNTIME_JOB_WAIT_TIMEOUT_MS', 600_000),
    remoteRuntimeJobPollIntervalMs: positiveIntEnv(env, 'FORGELOOP_CODEX_REMOTE_RUNTIME_JOB_POLL_INTERVAL_MS', 1_000),
    env,
  };
};

const requestJson = async <T>(
  config: DogfoodConfig,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> => {
  const response = await fetch(`${config.controlPlaneUrl}${path}`, {
    method: init.method ?? 'GET',
    ...(init.body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(init.body) }),
  });
  const bodyText = await response.text();
  if (!response.ok) {
    throw blocker('plan_item_workflow_real_dogfood_product_api_unavailable', {
      route_calls: [{ route: path.replace(/\/[0-9a-f-]{36}/gi, '/:id'), status: String(response.status), runtime_call: false }],
    });
  }
  return JSON.parse(bodyText) as T;
};

const planningInputCreatePath = (type: DogfoodConfig['planningInputType']): string => {
  switch (type) {
    case 'requirement':
      return '/requirements';
    case 'initiative':
      return '/initiatives';
    case 'bug':
      return '/bugs';
    case 'tech_debt':
      return '/tech-debt';
  }
};

const seedPlanItemIfNeeded = async (config: DogfoodConfig): Promise<{ developmentPlanId: string; itemId: string }> => {
  if (config.developmentPlanId !== undefined && config.developmentPlanItemId !== undefined) {
    return { developmentPlanId: config.developmentPlanId, itemId: config.developmentPlanItemId };
  }

  let planningInputId = config.planningInputId;
  if (config.autoSeedProductSource) {
    const planningInput = await requestJson<{ id: string }>(config, planningInputCreatePath(config.planningInputType), {
      method: 'POST',
      body: {
        project_id: config.projectId,
        title: 'Plan Item Workflow real runtime dogfood input',
        goal: 'Validate Wave 5 Plan Item Workflow same-session generation continuity.',
        success_criteria: [
          'Boundary, Spec Doc, and Implementation Plan Doc are generated through PlanItemWorkflow queued actions.',
          'Execution Ready is evaluated without starting execution.',
        ],
        priority: 'P0',
        risk: 'high',
        driver_actor_id: config.actorId,
        intake_context: {
          type: config.planningInputType,
          stakeholder_problem: 'Wave 5 requires credentialed runtime proof.',
          desired_outcome: 'The Plan Item Workflow reaches Execution Ready with one continuous Codex session.',
          acceptance_criteria: ['The real dogfood report is public-safe and contains only digests, ids, counts, and status codes.'],
          in_scope: ['PlanItemWorkflow queued generation'],
        },
      },
    });
    planningInputId = planningInput.id;
    config.planningInputId = planningInput.id;
    config.env.FORGELOOP_CODEX_DOGFOOD_PLANNING_INPUT_ID = planningInput.id;
  }

  const plan = await requestJson<{ id: string }>(config, '/development-plans', {
    method: 'POST',
    body: {
      project_id: config.projectId,
      source_ref: { type: config.planningInputType, id: planningInputId },
      title: 'Plan Item Workflow Real Runtime Dogfood',
      actor_id: config.actorId,
    },
  });
  const item = await requestJson<{ id: string }>(config, `/development-plans/${encodeURIComponent(plan.id)}/items`, {
    method: 'POST',
    body: {
      title: 'Validate Plan Item Workflow runtime continuity',
      summary: 'Run Boundary, Spec Doc, Implementation Plan Doc, and Execution Ready through Wave 5 queued actions.',
      responsible_role: 'tech_lead',
      driver_actor_id: config.actorId,
      reviewer_actor_id: config.actorId,
      risk: 'high',
      dependency_hints: [],
      affected_surfaces: ['plan-item-workflow', 'codex-runtime'],
      release_impact: 'release_scoped',
    },
  });
  return { developmentPlanId: plan.id, itemId: item.id };
};

const syncGenerationWorkerEnvFromBootstrap = (config: DogfoodConfig, summary: Record<string, unknown>): void => {
  const workerIdentity = typeof summary.generation_worker_identity === 'string' ? summary.generation_worker_identity : undefined;
  if (workerIdentity !== undefined) {
    config.env.FORGELOOP_CODEX_GENERATION_WORKER_IDENTITY = workerIdentity;
  }
  const runtimeProfileId = typeof summary.generation_runtime_profile_id === 'string' ? summary.generation_runtime_profile_id : undefined;
  if (runtimeProfileId !== undefined) {
    config.generationRuntimeProfileId = runtimeProfileId;
    config.env.FORGELOOP_CODEX_GENERATION_RUNTIME_PROFILE_ID = runtimeProfileId;
  }
  const runtimeProfileRevisionId =
    typeof summary.generation_runtime_profile_revision_id === 'string' ? summary.generation_runtime_profile_revision_id : undefined;
  if (runtimeProfileRevisionId !== undefined) {
    config.generationRuntimeProfileRevisionId = runtimeProfileRevisionId;
    config.env.FORGELOOP_CODEX_GENERATION_RUNTIME_PROFILE_REVISION_ID = runtimeProfileRevisionId;
  }
  const credentialBindingId = typeof summary.generation_credential_binding_id === 'string' ? summary.generation_credential_binding_id : undefined;
  if (credentialBindingId !== undefined) {
    config.generationCredentialBindingId = credentialBindingId;
    config.env.FORGELOOP_CODEX_GENERATION_CREDENTIAL_BINDING_ID = credentialBindingId;
  }
  const credentialBindingVersionId =
    typeof summary.generation_credential_binding_version_id === 'string' ? summary.generation_credential_binding_version_id : undefined;
  if (credentialBindingVersionId !== undefined) {
    config.generationCredentialBindingVersionId = credentialBindingVersionId;
    config.env.FORGELOOP_CODEX_GENERATION_CREDENTIAL_BINDING_VERSION_ID = credentialBindingVersionId;
  }
  const dockerImageDigest = typeof summary.docker_image_digest === 'string' ? summary.docker_image_digest : undefined;
  if (dockerImageDigest !== undefined) {
    config.env.FORGELOOP_CODEX_WORKER_DOCKER_IMAGE_DIGESTS = dockerImageDigest;
  }
  const networkPolicyDigest = typeof summary.network_policy_digest === 'string' ? summary.network_policy_digest : undefined;
  if (networkPolicyDigest !== undefined) {
    config.env.FORGELOOP_CODEX_WORKER_NETWORK_POLICY_DIGESTS = networkPolicyDigest;
  }
  const networkProviderConfigDigest =
    typeof summary.network_provider_config_digest === 'string' ? summary.network_provider_config_digest : undefined;
  if (networkProviderConfigDigest !== undefined) {
    config.env.FORGELOOP_CODEX_WORKER_NETWORK_PROVIDER_CONFIG_DIGESTS = networkProviderConfigDigest;
  }
};

const importRuntimeIfNeeded = async (config: DogfoodConfig): Promise<void> => {
  if (config.skipBootstrap) {
    if (
      config.generationRuntimeProfileId === undefined ||
      config.generationRuntimeProfileRevisionId === undefined ||
      config.generationCredentialBindingId === undefined ||
      config.generationCredentialBindingVersionId === undefined
    ) {
      throw blocker('plan_item_workflow_real_dogfood_generation_runtime_config_missing', {
        missing_env: [
          'FORGELOOP_CODEX_GENERATION_RUNTIME_PROFILE_ID',
          'FORGELOOP_CODEX_GENERATION_RUNTIME_PROFILE_REVISION_ID',
          'FORGELOOP_CODEX_GENERATION_CREDENTIAL_BINDING_ID',
          'FORGELOOP_CODEX_GENERATION_CREDENTIAL_BINDING_VERSION_ID',
        ].filter(
          (key) =>
            (key === 'FORGELOOP_CODEX_GENERATION_RUNTIME_PROFILE_ID' && config.generationRuntimeProfileId === undefined) ||
            (key === 'FORGELOOP_CODEX_GENERATION_RUNTIME_PROFILE_REVISION_ID' && config.generationRuntimeProfileRevisionId === undefined) ||
            (key === 'FORGELOOP_CODEX_GENERATION_CREDENTIAL_BINDING_ID' && config.generationCredentialBindingId === undefined) ||
            (key === 'FORGELOOP_CODEX_GENERATION_CREDENTIAL_BINDING_VERSION_ID' && config.generationCredentialBindingVersionId === undefined),
        ),
      });
    }
    return;
  }
  const modulePath = './codex-runtime-dogfood-bootstrap';
  const module = (await import(modulePath)) as { runCodexRuntimeDogfoodBootstrap: () => Promise<Record<string, unknown>> };
  try {
    const summary = await module.runCodexRuntimeDogfoodBootstrap();
    syncGenerationWorkerEnvFromBootstrap(config, summary);
  } catch {
    throw blocker('plan_item_workflow_real_dogfood_runtime_bootstrap_failed');
  }
};

const sanitizeGenerationWorkerEnv = (config: DogfoodConfig): EnvLike => {
  const env: EnvLike = { ...config.env };
  for (const key of [
    'FORGELOOP_AUTOMATION_ALLOWED_REPO_ROOTS',
    'FORGELOOP_CODEX_CONFIG_TOML_PATH',
    'FORGELOOP_CODEX_AUTH_JSON_PATH',
    'FORGELOOP_CODEX_HOME',
    'CODEX_HOME',
  ]) {
    delete env[key];
  }

  const baseWorkerIdentity = optionalEnv(config.env, 'FORGELOOP_WORKER_IDENTITY');
  const generationWorkerIdentity = optionalEnv(config.env, 'FORGELOOP_CODEX_GENERATION_WORKER_IDENTITY');
  if (generationWorkerIdentity !== undefined) {
    env.FORGELOOP_WORKER_IDENTITY = generationWorkerIdentity;
    env.FORGELOOP_WORKER_ID = generationWorkerIdentity;
  } else if (baseWorkerIdentity !== undefined) {
    const workerIdentity = codexRuntimeDogfoodWorkerIdentityForTarget(baseWorkerIdentity, 'generation');
    env.FORGELOOP_WORKER_IDENTITY = workerIdentity;
    env.FORGELOOP_WORKER_ID = workerIdentity;
  }

  env.FORGELOOP_CODEX_ALLOWED_SCOPE_PROJECT_ID = config.projectId;
  env.FORGELOOP_CODEX_WORKER_CAPABILITIES = 'generation';
  env.FORGELOOP_CODEX_WORKER_SCOPES_JSON = JSON.stringify([{ project_id: config.projectId }]);
  env.FORGELOOP_CODEX_NO_SHARED_FILESYSTEM = '1';
  env.FORGELOOP_CODEX_REMOTE_WORKER_RUN_MODE = 'run_once';

  if (
    env.FORGELOOP_WORKER_BOOTSTRAP_TOKEN !== undefined &&
    env.FORGELOOP_WORKER_IDENTITY !== undefined &&
    env.FORGELOOP_CODEX_WORKER_DOCKER_IMAGE_DIGESTS !== undefined &&
    env.FORGELOOP_CODEX_WORKER_NETWORK_POLICY_DIGESTS !== undefined &&
    env.FORGELOOP_CODEX_WORKER_NETWORK_PROVIDER_CONFIG_DIGESTS !== undefined
  ) {
    env.FORGELOOP_WORKER_BOOTSTRAP_TOKEN = codexRuntimeDogfoodBootstrapTokenForTarget(env.FORGELOOP_WORKER_BOOTSTRAP_TOKEN, {
      workerIdentity: env.FORGELOOP_WORKER_IDENTITY,
      allowedScope: { project_id: config.projectId },
      allowedCapabilities: {
        target_kinds: ['generation'],
        docker_image_digests: [env.FORGELOOP_CODEX_WORKER_DOCKER_IMAGE_DIGESTS],
        network_policy_digests: [env.FORGELOOP_CODEX_WORKER_NETWORK_POLICY_DIGESTS],
        network_provider_config_digests: [env.FORGELOOP_CODEX_WORKER_NETWORK_PROVIDER_CONFIG_DIGESTS],
      },
    });
  }

  return env;
};

const runGenerationWorkerOnce = async (config: DogfoodConfig): Promise<void> => {
  const modulePath = './codex-remote-worker-dogfood';
  const module = (await import(modulePath)) as {
    loadCodexRemoteWorkerDogfoodConfig: (env?: EnvLike) => unknown;
    runCodexRemoteWorkerDogfood: (config?: unknown) => Promise<{ processed: number }>;
  };
  try {
    const workerConfig = module.loadCodexRemoteWorkerDogfoodConfig(sanitizeGenerationWorkerEnv(config));
    await module.runCodexRemoteWorkerDogfood(workerConfig);
  } catch {
    throw blocker('plan_item_workflow_real_dogfood_generation_worker_failed');
  }
};

const fetchPlanItemProjection = async (
  config: DogfoodConfig,
  developmentPlanId: string,
  itemId: string,
): Promise<PlanItemProjection> =>
  requestJson<PlanItemProjection>(
    config,
    `/query/development-plans/${encodeURIComponent(developmentPlanId)}/items/${encodeURIComponent(itemId)}`,
  );

const workflowFromProjection = (projection: PlanItemProjection): PlanItemWorkflowPublicDto => {
  const workflow = projection.plan_item_workflow;
  if (workflow === undefined) {
    throw blocker('plan_item_workflow_real_dogfood_workflow_projection_missing');
  }
  return workflow;
};

const activeAction = (workflow: PlanItemWorkflowPublicDto, kind: QueueKind): PlanItemWorkflowQueuedAction => {
  const action = workflow.queued_actions.find((candidate) => candidate.kind === kind && candidate.status === 'queued');
  if (action === undefined) {
    throw blocker('plan_item_workflow_real_dogfood_queued_action_missing');
  }
  return action;
};

const captureSucceededAction = (action: PlanItemWorkflowQueuedAction): CompletedActionProof => {
  if (action.status !== 'succeeded') {
    throw blocker('plan_item_workflow_real_dogfood_queued_action_not_succeeded');
  }
  assertSha256Digest(action.output_capsule_digest, 'output_capsule_digest');
  assertSha256Digest(action.codex_thread_id_digest, 'codex_thread_id_digest');
  if (!Number.isInteger(action.output_capsule_sequence) || action.output_capsule_sequence < 0) {
    throw blocker('plan_item_workflow_real_dogfood_capsule_sequence_missing');
  }
  return {
    kind: action.kind,
    status: 'succeeded',
    output_capsule_digest: action.output_capsule_digest,
    output_capsule_sequence: action.output_capsule_sequence,
    codex_thread_id_digest: action.codex_thread_id_digest,
  };
};

const runQueuedAction = async (
  config: DogfoodConfig,
  routeCalls: RouteCall[],
  workflowId: string,
  action: PlanItemWorkflowQueuedAction,
): Promise<CompletedActionProof> => {
  const initial = await requestJson<{ queued_action: PlanItemWorkflowQueuedAction }>(
    config,
    `/plan-item-workflows/${encodeURIComponent(workflowId)}/actions/${encodeURIComponent(action.id)}/run`,
    { method: 'POST', body: { actor_id: config.actorId } },
  );
  routeCalls.push({ route: routeRunAction, status: initial.queued_action.status, runtime_call: true, queued_action_kind: action.kind });
  if (initial.queued_action.status === 'succeeded') {
    return captureSucceededAction(initial.queued_action);
  }
  if (initial.queued_action.status !== 'running') {
    throw blocker('plan_item_workflow_real_dogfood_queued_action_not_running');
  }

  const deadline = Date.now() + config.remoteRuntimeJobWaitTimeoutMs;
  while (Date.now() < deadline) {
    await runGenerationWorkerOnce(config);
    const replay = await requestJson<{ queued_action: PlanItemWorkflowQueuedAction }>(
      config,
      `/plan-item-workflows/${encodeURIComponent(workflowId)}/actions/${encodeURIComponent(action.id)}/run`,
      { method: 'POST', body: { actor_id: config.actorId } },
    );
    if (replay.queued_action.status === 'succeeded') {
      return captureSucceededAction(replay.queued_action);
    }
    if (replay.queued_action.status !== 'running') {
      throw blocker('plan_item_workflow_real_dogfood_queued_action_terminal_failed');
    }
    await new Promise((resolve) => setTimeout(resolve, config.remoteRuntimeJobPollIntervalMs));
  }
  throw blocker('plan_item_workflow_real_dogfood_queued_action_timeout');
};

const startWorkflow = async (
  config: DogfoodConfig,
  routeCalls: RouteCall[],
  developmentPlanId: string,
  itemId: string,
): Promise<PlanItemWorkflowPublicDto> => {
  const started = await requestJson<PlanItemWorkflowPublicDto>(
    config,
    `/development-plans/${encodeURIComponent(developmentPlanId)}/items/${encodeURIComponent(itemId)}/workflow/start-brainstorming`,
    {
      method: 'POST',
      body: planItemWorkflowRealDogfoodStartBody(config),
    },
  );
  routeCalls.push({ route: routeStartBrainstorming, status: started.status, runtime_call: false });
  return started;
};

export const planItemWorkflowRealDogfoodStartBody = (config: DogfoodConfig) => ({
  actor_id: config.actorId,
  reason: 'Start Wave 5 real runtime dogfood.',
});

const submitBoundaryAnswer = async (
  config: DogfoodConfig,
  routeCalls: RouteCall[],
  workflowId: string,
): Promise<PlanItemWorkflowPublicDto> => {
  const response = await requestJson<PlanItemWorkflowPublicDto>(
    config,
    `/plan-item-workflows/${encodeURIComponent(workflowId)}/messages`,
    {
      method: 'POST',
      body: {
        actor_id: config.actorId,
        action: 'answer_boundary_question',
        body_markdown:
          'Keep Wave 5 bounded to PlanItemWorkflow Brainstorming, Spec Doc, Implementation Plan Doc, and Execution Ready. Do not start execution.',
      },
    },
  );
  routeCalls.push({ route: routeMessages, status: response.status, runtime_call: false });
  return response;
};

const approveArtifact = async (
  config: DogfoodConfig,
  routeCalls: RouteCall[],
  workflowId: string,
  artifactType: WorkflowArtifactType,
  revisionId: string,
): Promise<PlanItemWorkflowPublicDto> => {
  const response = await requestJson<PlanItemWorkflowPublicDto>(
    config,
    `/plan-item-workflows/${encodeURIComponent(workflowId)}/artifacts/${artifactType}/revisions/${encodeURIComponent(revisionId)}/approve`,
    { method: 'POST', body: { actor_id: config.actorId, decision_markdown: `Approve ${artifactType} for real runtime dogfood.` } },
  );
  routeCalls.push({ route: routeApproveArtifact, status: response.status, runtime_call: false });
  return response;
};

const requestChanges = async (
  config: DogfoodConfig,
  routeCalls: RouteCall[],
  workflowId: string,
  artifactType: WorkflowArtifactType,
  revisionId: string,
): Promise<PlanItemWorkflowPublicDto> => {
  const response = await requestJson<PlanItemWorkflowPublicDto>(
    config,
    `/plan-item-workflows/${encodeURIComponent(workflowId)}/artifacts/${artifactType}/revisions/${encodeURIComponent(revisionId)}/request-changes`,
    { method: 'POST', body: { actor_id: config.actorId, reason_markdown: `Revise ${artifactType} once to prove queued changes.` } },
  );
  routeCalls.push({ route: routeRequestChanges, status: response.status, runtime_call: false });
  return response;
};

const evaluateReadiness = async (
  config: DogfoodConfig,
  routeCalls: RouteCall[],
  workflowId: string,
): Promise<PlanItemWorkflowPublicDto> => {
  const response = await requestJson<PlanItemWorkflowPublicDto>(
    config,
    `/plan-item-workflows/${encodeURIComponent(workflowId)}/execution-readiness/evaluate`,
    { method: 'POST', body: { actor_id: config.actorId, rationale_markdown: 'Evaluate Wave 5 readiness without execution.' } },
  );
  routeCalls.push({ route: routeReadiness, status: response.status, runtime_call: false });
  return response;
};

const assertContinuity = (actions: CompletedActionProof[]): { digest: Sha256Digest; sequences: number[] } => {
  const runtimeActions = actions.filter((action) => requiredRuntimeKinds.has(action.kind));
  if (runtimeActions.length < requiredRuntimeKinds.size) {
    throw blocker('plan_item_workflow_real_dogfood_runtime_generation_proof_missing');
  }
  const digests = new Set(runtimeActions.map((action) => action.codex_thread_id_digest));
  if (digests.size !== 1) {
    throw blocker('plan_item_workflow_real_dogfood_thread_digest_mismatch');
  }
  const sequences = actions.map((action) => action.output_capsule_sequence);
  const sorted = [...sequences].sort((left, right) => left - right);
  if (sequences.some((sequence, index) => sequence !== sorted[index] || (index > 0 && sequence <= sequences[index - 1]!))) {
    throw blocker('plan_item_workflow_real_dogfood_capsule_sequence_not_monotonic');
  }
  const [digest] = digests;
  assertSha256Digest(digest, 'codex_thread_id_digest');
  return { digest, sequences };
};

const assertReady = (workflow: PlanItemWorkflowPublicDto): void => {
  if (workflow.status !== 'execution_ready' || workflow.readiness?.state !== 'ready' || workflow.readiness.blocker_codes.length > 0) {
    throw blocker('plan_item_workflow_real_dogfood_readiness_not_ready');
  }
};

const assertNoExecutionRuntimeState = async (
  config: DogfoodConfig,
  developmentPlanId: string,
  itemId: string,
): Promise<{
  noExecutionRuntimeStateCreated: NoExecutionRuntimeStateCreated;
  executionPackageBoundary: Extract<DogfoodReport, { status: 'PASS' }>['execution_package_boundary'];
}> => {
  const projection = await fetchPlanItemProjection(config, developmentPlanId, itemId);
  const boundary = projection.runtime_boundary;
  if (boundary === undefined || boundary.type !== 'execution_package') {
    throw blocker('plan_item_workflow_real_dogfood_execution_package_boundary_missing');
  }
  assertSafeId(boundary.id, 'execution_package_boundary_id');
  const executionPackage = await requestJson<PublicExecutionPackageProof>(
    config,
    `/execution-packages/${encodeURIComponent(boundary.id)}`,
  );

  if (
    boundary.phase !== 'draft' ||
    boundary.activity_state !== 'idle' ||
    boundary.gate_state !== 'not_submitted' ||
    executionPackage.phase !== 'draft' ||
    executionPackage.activity_state !== 'idle' ||
    executionPackage.gate_state !== 'not_submitted' ||
    executionPackage.resolution !== 'none'
  ) {
    throw blocker('plan_item_workflow_real_dogfood_execution_package_boundary_started');
  }
  const runSessionCount = [executionPackage.current_run_session_id, executionPackage.last_run_session_id].filter(
    (id) => id !== undefined,
  ).length;
  const reviewLoopCount = executionPackage.current_review_packet_id === undefined ? 0 : 1;
  const executionCount = projection.executions?.length ?? 0;
  const codeReviewHandoffCount = projection.code_review_handoffs?.length ?? 0;
  const qaHandoffCount = projection.qa_handoffs?.length ?? 0;
  const noExecutionRuntimeStateCreated: NoExecutionRuntimeStateCreated = {
    run_session_count: runSessionCount,
    execution_worker_job_count: executionCount,
    workspace_bundle_count: executionCount,
    pr_count: codeReviewHandoffCount,
    review_loop_count: reviewLoopCount + codeReviewHandoffCount + qaHandoffCount,
  };

  if (Object.values(noExecutionRuntimeStateCreated).some((count) => count !== 0)) {
    throw blocker('plan_item_workflow_real_dogfood_execution_runtime_state_created');
  }

  return {
    noExecutionRuntimeStateCreated,
    executionPackageBoundary: {
      execution_package_count: 1,
      phase: 'draft',
      activity_state: 'idle',
      gate_state: 'not_submitted',
      resolution: 'none',
      run_session_count: noExecutionRuntimeStateCreated.run_session_count,
    },
  };
};

export const runPlanItemWorkflowRealDogfood = async (config: DogfoodConfig): Promise<Extract<DogfoodReport, { status: 'PASS' }>> => {
  await importRuntimeIfNeeded(config);
  const routeCalls: RouteCall[] = [];
  const { developmentPlanId, itemId } = await seedPlanItemIfNeeded(config);
  const started = await startWorkflow(config, routeCalls, developmentPlanId, itemId);
  const workflowId = started.id;
  assertSafeId(workflowId, 'workflow_id');

  const completedActions: CompletedActionProof[] = [];
  completedActions.push(await runQueuedAction(config, routeCalls, workflowId, activeAction(started, 'continue_brainstorming')));
  let projectedWorkflow = workflowFromProjection(await fetchPlanItemProjection(config, developmentPlanId, itemId));

  projectedWorkflow = await submitBoundaryAnswer(config, routeCalls, workflowId);
  completedActions.push(await runQueuedAction(config, routeCalls, workflowId, activeAction(projectedWorkflow, 'continue_brainstorming')));
  projectedWorkflow = workflowFromProjection(await fetchPlanItemProjection(config, developmentPlanId, itemId));

  completedActions.push(await runQueuedAction(config, routeCalls, workflowId, activeAction(projectedWorkflow, 'generate_boundary_summary')));
  projectedWorkflow = workflowFromProjection(await fetchPlanItemProjection(config, developmentPlanId, itemId));
  const firstBoundaryRevisionId = projectedWorkflow.active_boundary_summary_revision_id;
  if (firstBoundaryRevisionId === undefined) throw blocker('plan_item_workflow_real_dogfood_boundary_revision_missing');

  projectedWorkflow = await approveArtifact(config, routeCalls, workflowId, 'boundary-summary', firstBoundaryRevisionId);
  completedActions.push(await runQueuedAction(config, routeCalls, workflowId, activeAction(projectedWorkflow, 'generate_spec_doc')));
  projectedWorkflow = workflowFromProjection(await fetchPlanItemProjection(config, developmentPlanId, itemId));
  const firstSpecRevisionId = projectedWorkflow.active_spec_doc_revision_id;
  if (firstSpecRevisionId === undefined) throw blocker('plan_item_workflow_real_dogfood_spec_revision_missing');

  projectedWorkflow = await requestChanges(config, routeCalls, workflowId, 'spec-doc', firstSpecRevisionId);
  completedActions.push(await runQueuedAction(config, routeCalls, workflowId, activeAction(projectedWorkflow, 'revise_spec_doc')));
  projectedWorkflow = workflowFromProjection(await fetchPlanItemProjection(config, developmentPlanId, itemId));
  const revisedSpecRevisionId = projectedWorkflow.active_spec_doc_revision_id;
  if (revisedSpecRevisionId === undefined || revisedSpecRevisionId === firstSpecRevisionId) {
    throw blocker('plan_item_workflow_real_dogfood_revised_spec_revision_missing');
  }

  projectedWorkflow = await approveArtifact(config, routeCalls, workflowId, 'spec-doc', revisedSpecRevisionId);
  completedActions.push(await runQueuedAction(config, routeCalls, workflowId, activeAction(projectedWorkflow, 'generate_implementation_plan_doc')));
  projectedWorkflow = workflowFromProjection(await fetchPlanItemProjection(config, developmentPlanId, itemId));
  const firstPlanRevisionId = projectedWorkflow.active_implementation_plan_doc_revision_id;
  if (firstPlanRevisionId === undefined) throw blocker('plan_item_workflow_real_dogfood_plan_revision_missing');

  projectedWorkflow = await requestChanges(config, routeCalls, workflowId, 'implementation-plan-doc', firstPlanRevisionId);
  completedActions.push(await runQueuedAction(config, routeCalls, workflowId, activeAction(projectedWorkflow, 'revise_implementation_plan_doc')));
  projectedWorkflow = workflowFromProjection(await fetchPlanItemProjection(config, developmentPlanId, itemId));
  const revisedPlanRevisionId = projectedWorkflow.active_implementation_plan_doc_revision_id;
  if (revisedPlanRevisionId === undefined || revisedPlanRevisionId === firstPlanRevisionId) {
    throw blocker('plan_item_workflow_real_dogfood_revised_plan_revision_missing');
  }

  projectedWorkflow = await approveArtifact(config, routeCalls, workflowId, 'implementation-plan-doc', revisedPlanRevisionId);
  const readyWorkflow = await evaluateReadiness(config, routeCalls, workflowId);
  assertReady(readyWorkflow);
  const { noExecutionRuntimeStateCreated, executionPackageBoundary } = await assertNoExecutionRuntimeState(config, developmentPlanId, itemId);
  const boundaryRevisionId = readyWorkflow.active_boundary_summary_revision_id;
  const specRevisionId = readyWorkflow.active_spec_doc_revision_id;
  const implementationPlanRevisionId = readyWorkflow.active_implementation_plan_doc_revision_id;
  if (boundaryRevisionId === undefined || specRevisionId === undefined || implementationPlanRevisionId === undefined) {
    throw blocker('plan_item_workflow_real_dogfood_artifact_revision_missing');
  }

  const continuity = assertContinuity(completedActions);
  const report: Extract<DogfoodReport, { status: 'PASS' }> = {
    status: 'PASS',
    source: 'real_control_plane_runtime',
    workflow_id: workflowId,
    development_plan_id: developmentPlanId,
    development_plan_item_id: itemId,
    route_calls: routeCalls,
    session_continuity: {
      same_codex_thread_id_digest: true,
      codex_thread_id_digest: continuity.digest,
      generation_turn_count: completedActions.length,
    },
    queued_actions: completedActions,
    capsule_sequence: {
      monotonic: true,
      sequences: continuity.sequences,
    },
    artifacts: {
      boundary_summary_revision_id: boundaryRevisionId,
      spec_revision_id: specRevisionId,
      implementation_plan_revision_id: implementationPlanRevisionId,
    },
    readiness: {
      state: 'ready',
      workflow_status: 'execution_ready',
      blocker_codes: [],
    },
    no_execution_runtime_state_created: noExecutionRuntimeStateCreated,
    execution_package_boundary: executionPackageBoundary,
    report_policy: 'public_safe_digests_counts_ids_only',
  };
  assertPublicSafeReport(report);
  return report;
};

const main = async (): Promise<number> => {
  const config = loadPlanItemWorkflowRealDogfoodConfig();
  if (config === undefined) {
    emitReport({ status: 'SKIPPED_NON_ACCEPTANCE', reason_code: 'real_runtime_acceptance_not_enabled' });
    console.log('SKIPPED_NON_ACCEPTANCE: set FORGELOOP_REAL_RUNTIME_ACCEPTANCE=1 to require real runtime continuity proof.');
    return 0;
  }

  try {
    const report = await runPlanItemWorkflowRealDogfood(config);
    emitReport(report);
    return 0;
  } catch (error) {
    if (error instanceof RealDogfoodBlocker) {
      emitReport(error.report);
      return 1;
    }
    const digest = `sha256:${createHash('sha256').update(String(error instanceof Error ? error.message : error)).digest('hex')}` as Sha256Digest;
    emitReport({ status: 'BLOCKED', blocker_code: 'plan_item_workflow_real_dogfood_unexpected_error', route_calls: [] });
    console.error(`plan_item_workflow_real_dogfood_unexpected_error:${digest}`);
    return 1;
  }
};

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
