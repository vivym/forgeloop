import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const codexRuntimeSuperpowersDogfoodCommand =
  'tsx --tsconfig apps/control-plane-api/tsconfig.json scripts/codex-runtime-superpowers-dogfood.ts';

type Sha256Digest = `sha256:${string}`;
type EnvLike = Record<string, string | undefined>;

export interface CodexRuntimeSuperpowersDogfoodCliConfig {
  controlPlaneUrl: string;
  actorId: string;
  generationRuntimeProfileId: string;
  generationCredentialBindingId: string;
  runExecutionRuntimeProfileId: string;
  runExecutionCredentialBindingId: string;
  projectId: string;
  sourceObjectType: 'requirement' | 'initiative' | 'bug' | 'tech_debt';
  sourceObjectId: string;
  leaderActorId: string;
  reviewerActorId: string;
  repoId?: string;
  boundaryQuestionId?: string;
  boundarySummaryRevisionId?: string;
  noSharedFilesystem: true;
  skipBootstrap: boolean;
}

export interface CodexRuntimeImportEvidence {
  runtime_profile_revision_digests: Sha256Digest[];
  credential_binding_version_digests: Sha256Digest[];
}

export interface CodexRuntimeSuperpowersDogfoodSeed {
  source_object_id: string;
  development_plan_id: string;
  development_plan_item_id: string;
}

export interface CodexRuntimeSuperpowersDogfoodReport {
  status: 'PASS';
  development_plan_item_id: string;
  boundary_brainstorming_session_id: string;
  boundary_summary_revision_id: string;
  spec_revision_id: string;
  execution_plan_revision_id: string;
  execution_id: string;
  runtime_profile_revision_digests: Sha256Digest[];
  credential_binding_version_digests: Sha256Digest[];
  no_shared_filesystem_worker: true;
  workspace_bundle_digest: Sha256Digest;
  mounted_task_workspace_digest: Sha256Digest;
  stale_boundary_negative_check: {
    blocked: true;
    blocker_code: 'STALE_BOUNDARY_SUMMARY';
    rebased_session_id: string;
    rebased_boundary_summary_revision_id: string;
  };
  changed_files: string[];
}

export interface CodexRuntimeSuperpowersDogfoodBlockerReport {
  status: 'BLOCKED';
  blocker_code: string;
  missing_env?: string[];
}

export interface CodexRuntimeSuperpowersDogfoodHttpClientDeps {
  fetchImpl?: typeof fetch;
  runRemoteWorkerOnce?: () => Promise<void>;
  runBootstrapImport?: () => Promise<Record<string, unknown>>;
  env?: EnvLike;
}

export class CodexRuntimeSuperpowersDogfoodBlocker extends Error {
  constructor(
    readonly blockerCode: string,
    readonly report: CodexRuntimeSuperpowersDogfoodBlockerReport,
  ) {
    super(blockerCode);
  }
}

export interface CodexRuntimeSuperpowersDogfoodClient {
  importCodexRuntime: () => Promise<CodexRuntimeImportEvidence>;
  smokeGenerationWorker: () => Promise<void>;
  startNoSharedFilesystemRunWorker: () => Promise<void>;
  seedSourceAndDevelopmentPlanItem: () => Promise<CodexRuntimeSuperpowersDogfoodSeed>;
  runBoundaryBrainstormingRound: (roundNumber: number) => Promise<{ boundary_brainstorming_session_id: string }>;
  answerBoundaryQuestion: () => Promise<void>;
  proposeBoundarySummary: () => Promise<{ boundary_summary_revision_id: string }>;
  mutateDevelopmentPlanItem: () => Promise<void>;
  assertStaleBoundaryBlocksSpecGeneration: () => Promise<{ blocked: true; blocker_code: 'STALE_BOUNDARY_SUMMARY' }>;
  rebaseBoundaryBrainstorming: () => Promise<{
    rebased_session_id: string;
    rebased_boundary_summary_revision_id: string;
  }>;
  approveBoundarySummary: () => Promise<{ boundary_summary_revision_id: string }>;
  generateAndApproveSpec: () => Promise<{ spec_revision_id: string }>;
  generateAndApproveExecutionPlan: () => Promise<{ execution_plan_revision_id: string }>;
  startExecution: () => Promise<{
    execution_id: string;
    workspace_bundle_digest: Sha256Digest;
    mounted_task_workspace_digest: Sha256Digest;
    changed_files: string[];
  }>;
  writeReport: (report: CodexRuntimeSuperpowersDogfoodReport, markdown: string) => Promise<{ report_path: string }>;
}

const hostCodexHomeFragment = ['~', '.codex'].join('/');
const unsafeReportFragments = [
  '/Users/',
  '/home/',
  '/tmp/',
  hostCodexHomeFragment,
  '.codex',
  'OPENAI_API_KEY',
  'Bearer ',
  'http://',
  'https://',
  '127.0.0.1',
  'localhost',
  'docker-exec:',
];
const publicIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const publicChangedFilePattern = /^docs\/[A-Za-z0-9._/-]+$/;

const assertPublicSafeReport = (markdown: string): void => {
  const unsafeFragment = unsafeReportFragments.find((fragment) => markdown.includes(fragment));
  if (unsafeFragment !== undefined) {
    throw new Error(`codex_runtime_superpowers_dogfood_report_unsafe:${unsafeFragment}`);
  }
};

const assertPublicSafeId = (value: string, label: string): void => {
  if (!publicIdPattern.test(value) || value.includes('..')) {
    throw new Error(`codex_runtime_superpowers_dogfood_report_unsafe:${label}`);
  }
};

const assertPublicSafeChangedFile = (value: string): void => {
  if (!publicChangedFilePattern.test(value) || value.includes('..') || value.startsWith('/') || value.includes('://')) {
    throw new Error('codex_runtime_superpowers_dogfood_report_unsafe:changed_file');
  }
};

const optionalEnv = (env: EnvLike, key: string): string | undefined => {
  const value = env[key]?.trim();
  return value === undefined || value.length === 0 ? undefined : value;
};

export const sanitizeCodexRemoteWorkerDogfoodEnv = (env: EnvLike = process.env): EnvLike => {
  const sanitized: EnvLike = { ...env };
  for (const key of [
    'FORGELOOP_AUTOMATION_ALLOWED_REPO_ROOTS',
    'FORGELOOP_CODEX_CONFIG_TOML_PATH',
    'FORGELOOP_CODEX_AUTH_JSON_PATH',
    'FORGELOOP_CODEX_HOME',
    'CODEX_HOME',
  ]) {
    delete sanitized[key];
  }
  return sanitized;
};

const canonicalPublicDigest = (value: unknown): Sha256Digest =>
  `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;

export const loadCodexRuntimeSuperpowersDogfoodCliConfig = (
  env: EnvLike = process.env,
): CodexRuntimeSuperpowersDogfoodCliConfig => {
  const requiredKeys = [
    'FORGELOOP_CONTROL_PLANE_URL',
    'FORGELOOP_CODEX_RUNTIME_SETUP_ACTOR_ID',
    'FORGELOOP_CODEX_GENERATION_RUNTIME_PROFILE_ID',
    'FORGELOOP_CODEX_GENERATION_CREDENTIAL_BINDING_ID',
    'FORGELOOP_CODEX_RUN_EXECUTION_RUNTIME_PROFILE_ID',
    'FORGELOOP_CODEX_RUN_EXECUTION_CREDENTIAL_BINDING_ID',
    'FORGELOOP_CODEX_DOGFOOD_PROJECT_ID',
    'FORGELOOP_CODEX_DOGFOOD_SOURCE_OBJECT_ID',
  ];
  const missing = requiredKeys.filter((key) => optionalEnv(env, key) === undefined);
  if (missing.length > 0) {
    throw new CodexRuntimeSuperpowersDogfoodBlocker('codex_runtime_superpowers_dogfood_config_missing', {
      status: 'BLOCKED',
      blocker_code: 'codex_runtime_superpowers_dogfood_config_missing',
      missing_env: missing,
    });
  }
  if (optionalEnv(env, 'FORGELOOP_CODEX_NO_SHARED_FILESYSTEM') !== '1') {
    throw new CodexRuntimeSuperpowersDogfoodBlocker('codex_runtime_superpowers_no_shared_filesystem_required', {
      status: 'BLOCKED',
      blocker_code: 'codex_runtime_superpowers_no_shared_filesystem_required',
      missing_env: ['FORGELOOP_CODEX_NO_SHARED_FILESYSTEM=1'],
    });
  }
  const repoId = optionalEnv(env, 'FORGELOOP_CODEX_DOGFOOD_REPO_ID');
  const boundaryQuestionId = optionalEnv(env, 'FORGELOOP_CODEX_DOGFOOD_BOUNDARY_QUESTION_ID');
  const boundarySummaryRevisionId = optionalEnv(env, 'FORGELOOP_CODEX_DOGFOOD_BOUNDARY_SUMMARY_REVISION_ID');
  const config: CodexRuntimeSuperpowersDogfoodCliConfig = {
    controlPlaneUrl: optionalEnv(env, 'FORGELOOP_CONTROL_PLANE_URL')!.replace(/\/$/, ''),
    actorId: optionalEnv(env, 'FORGELOOP_CODEX_RUNTIME_SETUP_ACTOR_ID')!,
    generationRuntimeProfileId: optionalEnv(env, 'FORGELOOP_CODEX_GENERATION_RUNTIME_PROFILE_ID')!,
    generationCredentialBindingId: optionalEnv(env, 'FORGELOOP_CODEX_GENERATION_CREDENTIAL_BINDING_ID')!,
    runExecutionRuntimeProfileId: optionalEnv(env, 'FORGELOOP_CODEX_RUN_EXECUTION_RUNTIME_PROFILE_ID')!,
    runExecutionCredentialBindingId: optionalEnv(env, 'FORGELOOP_CODEX_RUN_EXECUTION_CREDENTIAL_BINDING_ID')!,
    projectId: optionalEnv(env, 'FORGELOOP_CODEX_DOGFOOD_PROJECT_ID')!,
    sourceObjectType: (optionalEnv(env, 'FORGELOOP_CODEX_DOGFOOD_SOURCE_OBJECT_TYPE') ?? 'requirement') as
      | 'requirement'
      | 'initiative'
      | 'bug'
      | 'tech_debt',
    sourceObjectId: optionalEnv(env, 'FORGELOOP_CODEX_DOGFOOD_SOURCE_OBJECT_ID')!,
    leaderActorId: optionalEnv(env, 'FORGELOOP_CODEX_DOGFOOD_LEADER_ACTOR_ID') ?? optionalEnv(env, 'FORGELOOP_CODEX_RUNTIME_SETUP_ACTOR_ID')!,
    reviewerActorId:
      optionalEnv(env, 'FORGELOOP_CODEX_DOGFOOD_REVIEWER_ACTOR_ID') ?? optionalEnv(env, 'FORGELOOP_CODEX_RUNTIME_SETUP_ACTOR_ID')!,
    noSharedFilesystem: true,
    skipBootstrap: optionalEnv(env, 'FORGELOOP_CODEX_DOGFOOD_SKIP_BOOTSTRAP') === '1',
  };
  if (repoId !== undefined) {
    config.repoId = repoId;
  }
  if (boundaryQuestionId !== undefined) {
    config.boundaryQuestionId = boundaryQuestionId;
  }
  if (boundarySummaryRevisionId !== undefined) {
    config.boundarySummaryRevisionId = boundarySummaryRevisionId;
  }
  return config;
};

export const renderCodexRuntimeSuperpowersDogfoodReport = (report: CodexRuntimeSuperpowersDogfoodReport): string => {
  for (const [label, value] of Object.entries({
    development_plan_item_id: report.development_plan_item_id,
    boundary_brainstorming_session_id: report.boundary_brainstorming_session_id,
    boundary_summary_revision_id: report.boundary_summary_revision_id,
    spec_revision_id: report.spec_revision_id,
    execution_plan_revision_id: report.execution_plan_revision_id,
    execution_id: report.execution_id,
    rebased_session_id: report.stale_boundary_negative_check.rebased_session_id,
    rebased_boundary_summary_revision_id: report.stale_boundary_negative_check.rebased_boundary_summary_revision_id,
  })) {
    assertPublicSafeId(value, label);
  }
  for (const changedFile of report.changed_files) {
    assertPublicSafeChangedFile(changedFile);
  }
  const lines = [
    '# Codex Runtime Superpowers Dogfood',
    '',
    `- Status: ${report.status}`,
    `- Development Plan Item: ${report.development_plan_item_id}`,
    `- Boundary Brainstorming Session: ${report.boundary_brainstorming_session_id}`,
    `- Boundary Summary Revision: ${report.boundary_summary_revision_id}`,
    `- Spec Revision: ${report.spec_revision_id}`,
    `- Execution Plan Revision: ${report.execution_plan_revision_id}`,
    `- Execution: ${report.execution_id}`,
    `- Runtime profile revision digests: ${report.runtime_profile_revision_digests.join(', ')}`,
    `- Credential binding version digests: ${report.credential_binding_version_digests.join(', ')}`,
    `- No shared filesystem worker: ${String(report.no_shared_filesystem_worker)}`,
    `- Runtime evidence: workspace_bundle_digest=${report.workspace_bundle_digest} mounted_task_workspace_digest=${report.mounted_task_workspace_digest}`,
    [
      '- Stale boundary negative check:',
      `blocked=${String(report.stale_boundary_negative_check.blocked)}`,
      `blocker_code=${report.stale_boundary_negative_check.blocker_code}`,
      `rebased_session_id=${report.stale_boundary_negative_check.rebased_session_id}`,
      `rebased_boundary_summary_revision_id=${report.stale_boundary_negative_check.rebased_boundary_summary_revision_id}`,
    ].join(' '),
    `- Changed files: ${report.changed_files.join(', ')}`,
    '',
  ];
  const markdown = `${lines.join('\n')}\n`;
  assertPublicSafeReport(markdown);
  return markdown;
};

export const renderCodexRuntimeSuperpowersDogfoodBlockerReport = (
  report: CodexRuntimeSuperpowersDogfoodBlockerReport,
): string => {
  const lines = [
    '# Codex Runtime Superpowers Dogfood',
    '',
    `- Status: ${report.status}`,
    `- Strict blocker: ${report.blocker_code}`,
    ...(report.missing_env === undefined || report.missing_env.length === 0
      ? []
      : [`- Missing configuration: ${report.missing_env.join(', ')}`]),
    '',
  ];
  const markdown = `${lines.join('\n')}\n`;
  assertPublicSafeReport(markdown);
  return markdown;
};

export const runCodexRuntimeSuperpowersDogfood = async (input: {
  client: CodexRuntimeSuperpowersDogfoodClient;
}): Promise<{ report: CodexRuntimeSuperpowersDogfoodReport; reportPath: string }> => {
  const importedRuntime = await input.client.importCodexRuntime();
  await input.client.smokeGenerationWorker();
  await input.client.startNoSharedFilesystemRunWorker();
  const seed = await input.client.seedSourceAndDevelopmentPlanItem();
  await input.client.runBoundaryBrainstormingRound(1);
  await input.client.answerBoundaryQuestion();
  await input.client.runBoundaryBrainstormingRound(2);
  await input.client.proposeBoundarySummary();
  await input.client.mutateDevelopmentPlanItem();
  const staleBoundaryCheck = await input.client.assertStaleBoundaryBlocksSpecGeneration();
  const rebasedBoundary = await input.client.rebaseBoundaryBrainstorming();
  const approvedBoundary = await input.client.approveBoundarySummary();
  const spec = await input.client.generateAndApproveSpec();
  const executionPlan = await input.client.generateAndApproveExecutionPlan();
  const execution = await input.client.startExecution();
  const report: CodexRuntimeSuperpowersDogfoodReport = {
    status: 'PASS',
    development_plan_item_id: seed.development_plan_item_id,
    boundary_brainstorming_session_id: rebasedBoundary.rebased_session_id,
    boundary_summary_revision_id: approvedBoundary.boundary_summary_revision_id,
    spec_revision_id: spec.spec_revision_id,
    execution_plan_revision_id: executionPlan.execution_plan_revision_id,
    execution_id: execution.execution_id,
    runtime_profile_revision_digests: importedRuntime.runtime_profile_revision_digests,
    credential_binding_version_digests: importedRuntime.credential_binding_version_digests,
    no_shared_filesystem_worker: true,
    workspace_bundle_digest: execution.workspace_bundle_digest,
    mounted_task_workspace_digest: execution.mounted_task_workspace_digest,
    stale_boundary_negative_check: {
      blocked: staleBoundaryCheck.blocked,
      blocker_code: staleBoundaryCheck.blocker_code,
      rebased_session_id: rebasedBoundary.rebased_session_id,
      rebased_boundary_summary_revision_id: rebasedBoundary.rebased_boundary_summary_revision_id,
    },
    changed_files: execution.changed_files,
  };
  const markdown = renderCodexRuntimeSuperpowersDogfoodReport(report);
  const written = await input.client.writeReport(report, markdown);
  return { report, reportPath: written.report_path };
};

export class FilesystemCodexRuntimeSuperpowersDogfoodReporter {
  constructor(private readonly rootDir = process.cwd()) {}

  async write(report: CodexRuntimeSuperpowersDogfoodReport, markdown: string): Promise<{ report_path: string }> {
    assertPublicSafeId(report.execution_id, 'execution_id_invalid');
    const reportPath = join('docs', 'superpowers', 'reports', `${report.execution_id}.md`);
    const absolutePath = resolve(this.rootDir, reportPath);
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, markdown, 'utf8');
    return { report_path: reportPath };
  }
}

const requestJson = async <T>(
  config: CodexRuntimeSuperpowersDogfoodCliConfig,
  path: string,
  init: { method?: string; body?: unknown } = {},
  deps: Pick<CodexRuntimeSuperpowersDogfoodHttpClientDeps, 'fetchImpl'> = {},
) => {
  const requestInit: RequestInit = {
    method: init.method ?? 'GET',
    ...(init.body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(init.body) }),
  };
  const response = await (deps.fetchImpl ?? fetch)(`${config.controlPlaneUrl}${path}`, requestInit);
  if (!response.ok) {
    throw new CodexRuntimeSuperpowersDogfoodBlocker('codex_runtime_superpowers_product_api_unavailable', {
      status: 'BLOCKED',
      blocker_code: 'codex_runtime_superpowers_product_api_unavailable',
    });
  }
  return (await response.json()) as T;
};

const requestRaw = async (
  config: CodexRuntimeSuperpowersDogfoodCliConfig,
  path: string,
  init: { method?: string; body?: unknown } = {},
  deps: Pick<CodexRuntimeSuperpowersDogfoodHttpClientDeps, 'fetchImpl'> = {},
): Promise<{ ok: boolean; status: number; bodyText: string }> => {
  const requestInit: RequestInit = {
    method: init.method ?? 'GET',
    ...(init.body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(init.body) }),
  };
  const response = await (deps.fetchImpl ?? fetch)(`${config.controlPlaneUrl}${path}`, requestInit);
  return { ok: response.ok, status: response.status, bodyText: await response.text() };
};

const digestFromPublicId = (value: string): Sha256Digest => canonicalPublicDigest(value);

const runRemoteWorkerOnce = async (env: EnvLike = process.env): Promise<void> => {
  const modulePath = './codex-remote-worker-dogfood';
  const module = (await import(modulePath)) as {
    loadCodexRemoteWorkerDogfoodConfig: (env?: EnvLike) => unknown;
    runCodexRemoteWorkerDogfood: (config?: unknown) => Promise<unknown>;
  };
  const workerConfig = module.loadCodexRemoteWorkerDogfoodConfig(sanitizeCodexRemoteWorkerDogfoodEnv(env));
  await module.runCodexRemoteWorkerDogfood(workerConfig);
};

const runBootstrapImport = async (): Promise<Record<string, unknown>> => {
  const modulePath = './codex-runtime-dogfood-bootstrap';
  const module = (await import(modulePath)) as { runCodexRuntimeDogfoodBootstrap: () => Promise<Record<string, unknown>> };
  return module.runCodexRuntimeDogfoodBootstrap();
};

export const createCodexRuntimeSuperpowersDogfoodHttpClient = (
  config: CodexRuntimeSuperpowersDogfoodCliConfig,
  deps: CodexRuntimeSuperpowersDogfoodHttpClientDeps = {},
): CodexRuntimeSuperpowersDogfoodClient => {
  let developmentPlanId: string | undefined;
  let developmentPlanItemId: string | undefined;
  let boundarySessionId: string | undefined;
  let boundarySummaryRevisionId: string | undefined = config.boundarySummaryRevisionId;
  let specRevisionId: string | undefined;
  let executionPlanRevisionId: string | undefined;
  const fetchDeps: Pick<CodexRuntimeSuperpowersDogfoodHttpClientDeps, 'fetchImpl'> =
    deps.fetchImpl === undefined ? {} : { fetchImpl: deps.fetchImpl };
  const invokeRemoteWorkerOnce = deps.runRemoteWorkerOnce ?? (() => runRemoteWorkerOnce(deps.env));
  const invokeBootstrapImport = deps.runBootstrapImport ?? runBootstrapImport;

  const requireState = (value: string | undefined, code: string): string => {
    if (value === undefined) {
      throw new CodexRuntimeSuperpowersDogfoodBlocker(code, { status: 'BLOCKED', blocker_code: code });
    }
    return value;
  };
  type BoundarySessionApiResponse = {
    id: string;
    questions?: Array<{ id: string; status?: string; required?: boolean; answered_by_answer_id?: string }>;
    latest_summary_revision_id?: string;
    approved_summary_revision_id?: string;
  };
  type DevelopmentPlanItemProjection = {
    specs?: Array<{ current_revision_id?: string; approved_revision_id?: string; id?: string }>;
    execution_plans?: Array<{ current_revision_id?: string; approved_revision_id?: string; id?: string }>;
    executions?: Array<{
      id: string;
      runtime_evidence?: {
        workspace_bundle_digest?: string;
        workspace_bundle_manifest_digest?: string;
        mounted_task_workspace_digest?: string;
        changed_files?: string[];
      };
    }>;
  };
  const isSha256Digest = (value: unknown): value is Sha256Digest =>
    typeof value === 'string' && value.startsWith('sha256:') && value.length > 'sha256:'.length;
  const fetchBoundarySession = async (): Promise<BoundarySessionApiResponse> => {
    const sessionId = requireState(boundarySessionId, 'codex_runtime_superpowers_dogfood_boundary_session_missing');
    return requestJson<BoundarySessionApiResponse>(config, `/boundary-brainstorming-sessions/${sessionId}`, {}, fetchDeps);
  };
  const latestBoundarySummaryRevisionId = async (): Promise<string> => {
    const session = await fetchBoundarySession();
    const revisionId = session.latest_summary_revision_id ?? session.approved_summary_revision_id;
    boundarySummaryRevisionId = requireState(revisionId, 'codex_runtime_superpowers_dogfood_boundary_summary_revision_id_missing');
    return boundarySummaryRevisionId;
  };
  const fetchDevelopmentPlanItemProjection = async (): Promise<DevelopmentPlanItemProjection> => {
    const planId = requireState(developmentPlanId, 'codex_runtime_superpowers_dogfood_plan_missing');
    const itemId = requireState(developmentPlanItemId, 'codex_runtime_superpowers_dogfood_item_missing');
    return requestJson<DevelopmentPlanItemProjection>(config, `/query/development-plans/${planId}/items/${itemId}`, {}, fetchDeps);
  };
  const currentSpecRevisionId = async (): Promise<string | undefined> => {
    const item = await fetchDevelopmentPlanItemProjection();
    return item.specs?.[0]?.approved_revision_id ?? item.specs?.[0]?.current_revision_id;
  };
  const currentExecutionPlanRevisionId = async (): Promise<string | undefined> => {
    const item = await fetchDevelopmentPlanItemProjection();
    return item.execution_plans?.[0]?.approved_revision_id ?? item.execution_plans?.[0]?.current_revision_id;
  };
  const requireExecutionRuntimeEvidence = async (executionId: string): Promise<{
    workspace_bundle_digest: Sha256Digest;
    mounted_task_workspace_digest: Sha256Digest;
    changed_files: string[];
  }> => {
    const execution = (await fetchDevelopmentPlanItemProjection()).executions?.find((candidate) => candidate.id === executionId);
    const evidence = execution?.runtime_evidence;
    if (
      evidence === undefined ||
      !isSha256Digest(evidence.workspace_bundle_digest) ||
      !isSha256Digest(evidence.mounted_task_workspace_digest) ||
      !Array.isArray(evidence.changed_files) ||
      evidence.changed_files.length === 0 ||
      evidence.changed_files.some((path) => typeof path !== 'string' || path.trim().length === 0)
    ) {
      throw new CodexRuntimeSuperpowersDogfoodBlocker('codex_runtime_superpowers_execution_runtime_evidence_missing', {
        status: 'BLOCKED',
        blocker_code: 'codex_runtime_superpowers_execution_runtime_evidence_missing',
      });
    }
    return {
      workspace_bundle_digest: evidence.workspace_bundle_digest,
      mounted_task_workspace_digest: evidence.mounted_task_workspace_digest,
      changed_files: evidence.changed_files,
    };
  };

  return {
    async importCodexRuntime() {
      if (!config.skipBootstrap) {
        const summary = await invokeBootstrapImport();
        return {
          runtime_profile_revision_digests: [
            digestFromPublicId(String(summary.generation_runtime_profile_revision_id)),
            digestFromPublicId(String(summary.run_execution_runtime_profile_revision_id)),
          ],
          credential_binding_version_digests: [
            digestFromPublicId(String(summary.generation_credential_binding_id)),
            digestFromPublicId(String(summary.run_execution_credential_binding_id)),
          ],
        };
      }
      return {
        runtime_profile_revision_digests: [
          digestFromPublicId(config.generationRuntimeProfileId),
          digestFromPublicId(config.runExecutionRuntimeProfileId),
        ],
        credential_binding_version_digests: [
          digestFromPublicId(config.generationCredentialBindingId),
          digestFromPublicId(config.runExecutionCredentialBindingId),
        ],
      };
    },
    async smokeGenerationWorker() {
      await invokeRemoteWorkerOnce();
    },
    async startNoSharedFilesystemRunWorker() {
      if (!config.noSharedFilesystem) {
        throw new CodexRuntimeSuperpowersDogfoodBlocker('codex_runtime_superpowers_no_shared_filesystem_required', {
          status: 'BLOCKED',
          blocker_code: 'codex_runtime_superpowers_no_shared_filesystem_required',
        });
      }
      await invokeRemoteWorkerOnce();
    },
    async seedSourceAndDevelopmentPlanItem() {
      const plan = await requestJson<{ id: string }>(config, '/development-plans', {
        method: 'POST',
        body: {
          project_id: config.projectId,
          source_ref: { type: config.sourceObjectType, id: config.sourceObjectId },
          title: 'Codex Runtime Superpowers Dogfood',
          actor_id: config.actorId,
        },
      }, fetchDeps);
      developmentPlanId = plan.id;
      const item = await requestJson<{ id: string }>(config, `/development-plans/${encodeURIComponent(plan.id)}/items`, {
        method: 'POST',
        body: {
          title: 'Strict Codex runtime Superpowers dogfood',
          summary: 'Validate the Superpowers product loop through centralized Codex runtime distribution.',
          responsible_role: 'tech_lead',
          driver_actor_id: config.actorId,
          reviewer_actor_id: config.reviewerActorId,
          risk: 'high',
          dependency_hints: [],
          affected_surfaces: ['codex-runtime', 'superpowers'],
          release_impact: 'release_scoped',
        },
      }, fetchDeps);
      developmentPlanItemId = item.id;
      return {
        source_object_id: config.sourceObjectId,
        development_plan_id: plan.id,
        development_plan_item_id: item.id,
      };
    },
    async runBoundaryBrainstormingRound(roundNumber) {
      const planId = requireState(developmentPlanId, 'codex_runtime_superpowers_dogfood_plan_missing');
      const itemId = requireState(developmentPlanItemId, 'codex_runtime_superpowers_dogfood_item_missing');
      if (roundNumber === 1) {
        const session = await requestJson<{ id: string }>(config, `/development-plans/${planId}/items/${itemId}/boundary-brainstorming`, {
          method: 'POST',
          body: {
            actor_id: config.leaderActorId,
            leader_actor_id: config.leaderActorId,
            initial_leader_context_markdown: 'Strict Codex runtime Superpowers dogfood boundary kickoff.',
          },
        }, fetchDeps);
        boundarySessionId = session.id;
        await invokeRemoteWorkerOnce();
        return { boundary_brainstorming_session_id: session.id };
      }
      const sessionId = requireState(boundarySessionId, 'codex_runtime_superpowers_dogfood_boundary_session_missing');
      await requestJson(config, `/boundary-brainstorming-sessions/${sessionId}/continue`, {
        method: 'POST',
        body: {
          actor_id: config.leaderActorId,
          leader_input_markdown: 'Continue after Leader answers and propose the strict dogfood Boundary Summary.',
        },
      }, fetchDeps);
      await invokeRemoteWorkerOnce();
      return { boundary_brainstorming_session_id: sessionId };
    },
    async answerBoundaryQuestion() {
      const sessionId = requireState(boundarySessionId, 'codex_runtime_superpowers_dogfood_boundary_session_missing');
      const session = await fetchBoundarySession();
      const discoveredQuestionId = session.questions?.find(
        (question) => question.answered_by_answer_id === undefined && (question.required === true || question.status === 'open'),
      )?.id;
      const questionId = requireState(
        config.boundaryQuestionId ?? discoveredQuestionId,
        'codex_runtime_superpowers_dogfood_boundary_question_id_missing',
      );
      await requestJson(config, `/boundary-brainstorming-sessions/${sessionId}/answers`, {
        method: 'POST',
        body: {
          question_id: questionId,
          text: 'Limit the execution to a docs-only dogfood report and preserve centralized Codex runtime distribution.',
          actor_id: config.leaderActorId,
        },
      }, fetchDeps);
    },
    async proposeBoundarySummary() {
      boundarySummaryRevisionId = config.boundarySummaryRevisionId ?? (await latestBoundarySummaryRevisionId());
      return { boundary_summary_revision_id: boundarySummaryRevisionId };
    },
    async mutateDevelopmentPlanItem() {
      const planId = requireState(developmentPlanId, 'codex_runtime_superpowers_dogfood_plan_missing');
      const itemId = requireState(developmentPlanItemId, 'codex_runtime_superpowers_dogfood_item_missing');
      const sessionId = requireState(boundarySessionId, 'codex_runtime_superpowers_dogfood_boundary_session_missing');
      const revisionId = requireState(boundarySummaryRevisionId, 'codex_runtime_superpowers_dogfood_boundary_summary_revision_id_missing');
      const approved = await requestJson<{ id?: string; revision_id?: string; boundary_summary_revision_id?: string }>(
        config,
        `/boundary-brainstorming-sessions/${sessionId}/summary-revisions/${revisionId}/approve`,
        {
          method: 'POST',
          body: {
            actor_id: config.leaderActorId,
            final_decision: 'Approve the first Boundary Summary revision so the stale item-revision gate can be verified.',
          },
        },
        fetchDeps,
      );
      boundarySummaryRevisionId = approved.boundary_summary_revision_id ?? approved.id ?? approved.revision_id ?? revisionId;
      await requestJson(config, `/development-plans/${planId}/items/${itemId}`, {
        method: 'PATCH',
        body: {
          actor_id: config.leaderActorId,
          summary:
            'Validate the Superpowers product loop through centralized Codex runtime distribution after stale-boundary negative evidence.',
        },
      }, fetchDeps);
    },
    async assertStaleBoundaryBlocksSpecGeneration() {
      const planId = requireState(developmentPlanId, 'codex_runtime_superpowers_dogfood_plan_missing');
      const itemId = requireState(developmentPlanItemId, 'codex_runtime_superpowers_dogfood_item_missing');
      const response = await requestRaw(
        config,
        `/development-plans/${planId}/items/${itemId}/spec-revisions/generate`,
        {
          method: 'POST',
          body: { actor_id: config.actorId },
        },
        fetchDeps,
      );
      if (response.ok) {
        throw new CodexRuntimeSuperpowersDogfoodBlocker('codex_runtime_superpowers_stale_boundary_check_failed', {
          status: 'BLOCKED',
          blocker_code: 'codex_runtime_superpowers_stale_boundary_check_failed',
        });
      }
      if (
        !response.bodyText.includes('stale_boundary_summary_revision')
      ) {
        throw new CodexRuntimeSuperpowersDogfoodBlocker('codex_runtime_superpowers_stale_boundary_check_unexpected', {
          status: 'BLOCKED',
          blocker_code: 'codex_runtime_superpowers_stale_boundary_check_unexpected',
        });
      }
      return { blocked: true, blocker_code: 'STALE_BOUNDARY_SUMMARY' };
    },
    async rebaseBoundaryBrainstorming() {
      const planId = requireState(developmentPlanId, 'codex_runtime_superpowers_dogfood_plan_missing');
      const itemId = requireState(developmentPlanItemId, 'codex_runtime_superpowers_dogfood_item_missing');
      const session = await requestJson<{ id: string }>(config, `/development-plans/${planId}/items/${itemId}/boundary-brainstorming/restart`, {
        method: 'POST',
        body: {
          actor_id: config.leaderActorId,
          leader_actor_id: config.leaderActorId,
          initial_leader_context_markdown:
            'Rebase the strict Codex runtime dogfood boundary after the Development Plan Item revision changed; previous Leader answers still apply unless a new blocker exists.',
        },
      }, fetchDeps);
      boundarySessionId = session.id;
      await invokeRemoteWorkerOnce();
      const revisionId = await latestBoundarySummaryRevisionId();
      return {
        rebased_session_id: session.id,
        rebased_boundary_summary_revision_id: revisionId,
      };
    },
    async approveBoundarySummary() {
      const sessionId = requireState(boundarySessionId, 'codex_runtime_superpowers_dogfood_boundary_session_missing');
      const revisionId = requireState(boundarySummaryRevisionId, 'codex_runtime_superpowers_dogfood_boundary_summary_revision_id_missing');
      const approved = await requestJson<{ id?: string; revision_id?: string; boundary_summary_revision_id?: string }>(
        config,
        `/boundary-brainstorming-sessions/${sessionId}/summary-revisions/${revisionId}/approve`,
        {
          method: 'POST',
          body: {
            actor_id: config.leaderActorId,
            final_decision: 'Approve the strict Codex runtime Superpowers dogfood boundary.',
          },
        },
        fetchDeps,
      );
      boundarySummaryRevisionId = approved.boundary_summary_revision_id ?? approved.id ?? approved.revision_id ?? revisionId;
      return { boundary_summary_revision_id: boundarySummaryRevisionId };
    },
    async generateAndApproveSpec() {
      const planId = requireState(developmentPlanId, 'codex_runtime_superpowers_dogfood_plan_missing');
      const itemId = requireState(developmentPlanItemId, 'codex_runtime_superpowers_dogfood_item_missing');
      await requestJson(config, `/development-plans/${planId}/items/${itemId}/spec-revisions/generate`, {
        method: 'POST',
        body: { actor_id: config.actorId },
      }, fetchDeps);
      await invokeRemoteWorkerOnce();
      specRevisionId = await currentSpecRevisionId();
      await requestJson(config, `/development-plans/${planId}/items/${itemId}/spec/submit-for-approval`, {
        method: 'POST',
        body: { actor_id: config.actorId },
      }, fetchDeps);
      await requestJson(config, `/development-plans/${planId}/items/${itemId}/spec/approve`, {
        method: 'POST',
        body: { actor_id: config.reviewerActorId, rationale: 'Strict dogfood Spec approved.' },
      }, fetchDeps);
      specRevisionId = (await currentSpecRevisionId()) ?? specRevisionId;
      return { spec_revision_id: requireState(specRevisionId, 'codex_runtime_superpowers_dogfood_spec_revision_missing') };
    },
    async generateAndApproveExecutionPlan() {
      const planId = requireState(developmentPlanId, 'codex_runtime_superpowers_dogfood_plan_missing');
      const itemId = requireState(developmentPlanItemId, 'codex_runtime_superpowers_dogfood_item_missing');
      await requestJson(config, `/development-plans/${planId}/items/${itemId}/execution-plan-revisions/generate`, {
        method: 'POST',
        body: { actor_id: config.actorId },
      }, fetchDeps);
      await invokeRemoteWorkerOnce();
      executionPlanRevisionId = await currentExecutionPlanRevisionId();
      await requestJson(config, `/development-plans/${planId}/items/${itemId}/execution-plan/submit-for-approval`, {
        method: 'POST',
        body: { actor_id: config.actorId },
      }, fetchDeps);
      await requestJson(config, `/development-plans/${planId}/items/${itemId}/execution-plan/approve`, {
        method: 'POST',
        body: { actor_id: config.reviewerActorId, rationale: 'Strict dogfood Execution Plan approved.' },
      }, fetchDeps);
      executionPlanRevisionId = (await currentExecutionPlanRevisionId()) ?? executionPlanRevisionId;
      return {
        execution_plan_revision_id: requireState(
          executionPlanRevisionId,
          'codex_runtime_superpowers_dogfood_execution_plan_revision_missing',
        ),
      };
    },
    async startExecution() {
      const planId = requireState(developmentPlanId, 'codex_runtime_superpowers_dogfood_plan_missing');
      const itemId = requireState(developmentPlanItemId, 'codex_runtime_superpowers_dogfood_item_missing');
      const execution = await requestJson<{ id: string; changed_files?: string[] }>(
        config,
        `/development-plans/${planId}/items/${itemId}/execution/start`,
        {
          method: 'POST',
          body: { actor_id: config.actorId },
        },
        fetchDeps,
      );
      await invokeRemoteWorkerOnce();
      const evidence = await requireExecutionRuntimeEvidence(execution.id);
      return {
        execution_id: execution.id,
        workspace_bundle_digest: evidence.workspace_bundle_digest,
        mounted_task_workspace_digest: evidence.mounted_task_workspace_digest,
        changed_files: evidence.changed_files,
      };
    },
    async writeReport(report, markdown) {
      return new FilesystemCodexRuntimeSuperpowersDogfoodReporter().write(report, markdown);
    },
  };
};

const main = async (): Promise<number> => {
  const config = loadCodexRuntimeSuperpowersDogfoodCliConfig();
  const result = await runCodexRuntimeSuperpowersDogfood({ client: createCodexRuntimeSuperpowersDogfoodHttpClient(config) });
  console.log(renderCodexRuntimeSuperpowersDogfoodReport(result.report));
  console.log(`Report path: ${result.reportPath}`);
  return 0;
};

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error: unknown) => {
      if (error instanceof CodexRuntimeSuperpowersDogfoodBlocker) {
        console.error(renderCodexRuntimeSuperpowersDogfoodBlockerReport(error.report));
      } else {
        console.error(
          renderCodexRuntimeSuperpowersDogfoodBlockerReport({
            status: 'BLOCKED',
            blocker_code: 'codex_runtime_superpowers_dogfood_failed',
          }),
        );
      }
      process.exitCode = 1;
    });
}
