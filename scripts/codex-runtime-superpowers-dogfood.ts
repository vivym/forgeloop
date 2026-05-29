import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { signAutomationRequest } from '../packages/automation/src/index';
import { codexCanonicalDigest } from '../packages/domain/src/index';

export const codexRuntimeSuperpowersDogfoodCommand =
  'tsx --tsconfig apps/control-plane-api/tsconfig.json scripts/codex-runtime-superpowers-dogfood.ts';

type Sha256Digest = `sha256:${string}`;
type EnvLike = Record<string, string | undefined>;

export interface CodexRuntimeSuperpowersDogfoodCliConfig {
  controlPlaneUrl: string;
  actorId: string;
  generationRuntimeProfileId?: string;
  generationCredentialBindingId?: string;
  runExecutionRuntimeProfileId?: string;
  runExecutionCredentialBindingId?: string;
  projectId: string;
  planningInputType: 'requirement' | 'initiative' | 'bug' | 'tech_debt';
  planningInputId: string;
  leaderActorId: string;
  reviewerActorId: string;
  repoId?: string;
  repoLocalPath?: string;
  repoBaseCommitSha?: string;
  autoSeedProductSource?: boolean;
  boundaryQuestionId?: string;
  boundarySummaryRevisionId?: string;
  noSharedFilesystem: true;
  skipBootstrap: boolean;
  remoteRuntimeJobWaitTimeoutMs?: number;
  remoteRuntimeJobPollIntervalMs?: number;
}

export interface CodexRuntimeImportEvidence {
  runtime_profile_revision_digests: Sha256Digest[];
  credential_binding_version_digests: Sha256Digest[];
}

export interface CodexRuntimeSuperpowersDogfoodSeed {
  planning_input_id: string;
  development_plan_id: string;
  development_plan_item_id: string;
}

export interface CodexRuntimeSuperpowersDogfoodReport {
  status: 'PASS';
  development_plan_item_id: string;
  boundary_brainstorming_session_id: string;
  boundary_summary_revision_id: string;
  spec_revision_id: string;
  implementation_plan_revision_id: string;
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
  product_api_status?: number;
  product_api_reason?: string;
  runtime_job_id?: string;
  runtime_job_terminal_status?: string;
  runtime_job_reason_code?: string;
  runtime_job_failure_subcode?: string;
  action_run_id?: string;
  action_run_status?: string;
  run_session_id?: string;
  run_session_status?: string;
  run_session_failure_reason?: string;
}

export interface CodexRuntimeSuperpowersDogfoodHttpClientDeps {
  fetchImpl?: typeof fetch;
  runRemoteWorkerOnce?: (targetKind?: 'generation' | 'run_execution') => Promise<void>;
  runBootstrapImport?: (envPatch?: EnvLike) => Promise<Record<string, unknown>>;
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
  seedPlanningInputAndDevelopmentPlanItem: () => Promise<CodexRuntimeSuperpowersDogfoodSeed>;
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
  generateAndApproveImplementationPlanDoc: () => Promise<{ implementation_plan_revision_id: string }>;
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

const nonNegativeIntEnv = (env: EnvLike, key: string, defaultValue: number): number => {
  const raw = optionalEnv(env, key);
  if (raw === undefined) {
    return defaultValue;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${key}_must_be_non_negative_integer`);
  }
  return value;
};

export const sanitizeCodexRemoteWorkerDogfoodEnv = (
  env: EnvLike = process.env,
  targetKind: 'generation' | 'run_execution' = 'generation',
): EnvLike => {
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
  const baseWorkerIdentity = optionalEnv(env, 'FORGELOOP_WORKER_IDENTITY');
  if (baseWorkerIdentity !== undefined) {
    const targetSuffix = targetKind === 'generation' ? 'generation' : 'run-execution';
    sanitized.FORGELOOP_WORKER_IDENTITY = `${baseWorkerIdentity}-${targetSuffix}`;
    sanitized.FORGELOOP_CODEX_WORKER_ID = `${baseWorkerIdentity}-${targetSuffix}`;
  }
  const projectId = optionalEnv(env, 'FORGELOOP_CODEX_DOGFOOD_PROJECT_ID') ?? optionalEnv(env, 'FORGELOOP_CODEX_ALLOWED_SCOPE_PROJECT_ID');
  const repoId = optionalEnv(env, 'FORGELOOP_CODEX_DOGFOOD_REPO_ID') ?? optionalEnv(env, 'FORGELOOP_CODEX_ALLOWED_SCOPE_REPO_ID');
  if (projectId !== undefined) {
    sanitized.FORGELOOP_CODEX_ALLOWED_SCOPE_PROJECT_ID = projectId;
  }
  if (repoId !== undefined) {
    sanitized.FORGELOOP_CODEX_ALLOWED_SCOPE_REPO_ID = repoId;
  }
  if (targetKind === 'generation' && projectId !== undefined) {
    sanitized.FORGELOOP_CODEX_WORKER_CAPABILITIES = 'generation';
    sanitized.FORGELOOP_CODEX_WORKER_SCOPES_JSON = JSON.stringify([{ project_id: projectId }]);
  }
  if (targetKind === 'run_execution' && projectId !== undefined && repoId !== undefined) {
    sanitized.FORGELOOP_CODEX_WORKER_CAPABILITIES = 'run_execution';
    sanitized.FORGELOOP_CODEX_WORKER_SCOPES_JSON = JSON.stringify([{ project_id: projectId, repo_id: repoId }]);
  }
  return sanitized;
};

const canonicalPublicDigest = (value: unknown): Sha256Digest =>
  `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;

const planningInputCreatePath = (planningInputType: CodexRuntimeSuperpowersDogfoodCliConfig['planningInputType']): string => {
  switch (planningInputType) {
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

const resolveDogfoodRepoHead = (repoPath: string): string => {
  try {
    const head = execFileSync('git', ['rev-parse', '--verify', 'HEAD'], {
      cwd: repoPath,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (/^[0-9a-f]{40}$/.test(head)) {
      return head;
    }
  } catch {
    // Fall through to a public-safe blocker below.
  }
  throw new CodexRuntimeSuperpowersDogfoodBlocker('codex_runtime_superpowers_dogfood_repo_head_unavailable', {
    status: 'BLOCKED',
    blocker_code: 'codex_runtime_superpowers_dogfood_repo_head_unavailable',
  });
};

export const loadCodexRuntimeSuperpowersDogfoodCliConfig = (
  env: EnvLike = process.env,
): CodexRuntimeSuperpowersDogfoodCliConfig => {
  const requiredKeys = [
    'FORGELOOP_CONTROL_PLANE_URL',
    'FORGELOOP_CODEX_RUNTIME_SETUP_ACTOR_ID',
    'FORGELOOP_CODEX_DOGFOOD_PROJECT_ID',
    'FORGELOOP_CODEX_DOGFOOD_PLANNING_INPUT_ID',
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
  const repoLocalPath = optionalEnv(env, 'FORGELOOP_CODEX_DOGFOOD_REPO_PATH') ?? process.cwd();
  const repoBaseCommitSha = optionalEnv(env, 'FORGELOOP_CODEX_DOGFOOD_REPO_BASE_COMMIT_SHA') ?? resolveDogfoodRepoHead(repoLocalPath);
  const boundaryQuestionId = optionalEnv(env, 'FORGELOOP_CODEX_DOGFOOD_BOUNDARY_QUESTION_ID');
  const boundarySummaryRevisionId = optionalEnv(env, 'FORGELOOP_CODEX_DOGFOOD_BOUNDARY_SUMMARY_REVISION_ID');
  const skipBootstrap = optionalEnv(env, 'FORGELOOP_CODEX_DOGFOOD_SKIP_BOOTSTRAP') === '1';
  const config: CodexRuntimeSuperpowersDogfoodCliConfig = {
    controlPlaneUrl: optionalEnv(env, 'FORGELOOP_CONTROL_PLANE_URL')!.replace(/\/$/, ''),
    actorId: optionalEnv(env, 'FORGELOOP_CODEX_RUNTIME_SETUP_ACTOR_ID')!,
    projectId: optionalEnv(env, 'FORGELOOP_CODEX_DOGFOOD_PROJECT_ID')!,
    planningInputType: (optionalEnv(env, 'FORGELOOP_CODEX_DOGFOOD_PLANNING_INPUT_TYPE') ?? 'requirement') as
      | 'requirement'
      | 'initiative'
      | 'bug'
      | 'tech_debt',
    planningInputId: optionalEnv(env, 'FORGELOOP_CODEX_DOGFOOD_PLANNING_INPUT_ID')!,
    leaderActorId: optionalEnv(env, 'FORGELOOP_CODEX_DOGFOOD_LEADER_ACTOR_ID') ?? optionalEnv(env, 'FORGELOOP_CODEX_RUNTIME_SETUP_ACTOR_ID')!,
    reviewerActorId:
      optionalEnv(env, 'FORGELOOP_CODEX_DOGFOOD_REVIEWER_ACTOR_ID') ?? optionalEnv(env, 'FORGELOOP_CODEX_RUNTIME_SETUP_ACTOR_ID')!,
    repoLocalPath,
    repoBaseCommitSha,
    autoSeedProductSource: optionalEnv(env, 'FORGELOOP_CODEX_DOGFOOD_CREATE_SOURCE') === '1' || !skipBootstrap,
    noSharedFilesystem: true,
    skipBootstrap,
    remoteRuntimeJobWaitTimeoutMs: nonNegativeIntEnv(env, 'FORGELOOP_CODEX_REMOTE_RUNTIME_JOB_WAIT_TIMEOUT_MS', 600_000),
    remoteRuntimeJobPollIntervalMs: nonNegativeIntEnv(env, 'FORGELOOP_CODEX_REMOTE_RUNTIME_JOB_POLL_INTERVAL_MS', 1_000),
  };
  if (repoId !== undefined) {
    config.repoId = repoId;
  }
  const generationRuntimeProfileId = optionalEnv(env, 'FORGELOOP_CODEX_GENERATION_RUNTIME_PROFILE_ID');
  const generationCredentialBindingId = optionalEnv(env, 'FORGELOOP_CODEX_GENERATION_CREDENTIAL_BINDING_ID');
  const runExecutionRuntimeProfileId = optionalEnv(env, 'FORGELOOP_CODEX_RUN_EXECUTION_RUNTIME_PROFILE_ID');
  const runExecutionCredentialBindingId = optionalEnv(env, 'FORGELOOP_CODEX_RUN_EXECUTION_CREDENTIAL_BINDING_ID');
  if (generationRuntimeProfileId !== undefined) {
    config.generationRuntimeProfileId = generationRuntimeProfileId;
  }
  if (generationCredentialBindingId !== undefined) {
    config.generationCredentialBindingId = generationCredentialBindingId;
  }
  if (runExecutionRuntimeProfileId !== undefined) {
    config.runExecutionRuntimeProfileId = runExecutionRuntimeProfileId;
  }
  if (runExecutionCredentialBindingId !== undefined) {
    config.runExecutionCredentialBindingId = runExecutionCredentialBindingId;
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
    implementation_plan_revision_id: report.implementation_plan_revision_id,
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
    `- Implementation Plan Doc Revision: ${report.implementation_plan_revision_id}`,
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
  if (
    report.product_api_status !== undefined &&
    (!Number.isInteger(report.product_api_status) || report.product_api_status < 100 || report.product_api_status > 599)
  ) {
    throw new Error('codex_runtime_superpowers_dogfood_report_unsafe:product_api_status');
  }
  for (const [label, value] of Object.entries({
    product_api_reason: report.product_api_reason,
    runtime_job_id: report.runtime_job_id,
    runtime_job_terminal_status: report.runtime_job_terminal_status,
    runtime_job_reason_code: report.runtime_job_reason_code,
    runtime_job_failure_subcode: report.runtime_job_failure_subcode,
    action_run_id: report.action_run_id,
    action_run_status: report.action_run_status,
    run_session_id: report.run_session_id,
    run_session_status: report.run_session_status,
    run_session_failure_reason: report.run_session_failure_reason,
  })) {
    if (value !== undefined) {
      assertPublicSafeId(value, label);
    }
  }
  const lines = [
    '# Codex Runtime Superpowers Dogfood',
    '',
    `- Status: ${report.status}`,
    `- Strict blocker: ${report.blocker_code}`,
    ...(report.missing_env === undefined || report.missing_env.length === 0
      ? []
      : [`- Missing configuration: ${report.missing_env.join(', ')}`]),
    ...(report.product_api_status === undefined ? [] : [`- Product API status: ${report.product_api_status}`]),
    ...(report.product_api_reason === undefined ? [] : [`- Product API reason: ${report.product_api_reason}`]),
    ...(report.runtime_job_id === undefined ? [] : [`- Runtime job: ${report.runtime_job_id}`]),
    ...(report.runtime_job_terminal_status === undefined
      ? []
      : [`- Runtime job terminal status: ${report.runtime_job_terminal_status}`]),
    ...(report.runtime_job_reason_code === undefined ? [] : [`- Runtime job reason code: ${report.runtime_job_reason_code}`]),
    ...(report.runtime_job_failure_subcode === undefined
      ? []
      : [`- Runtime job failure subcode: ${report.runtime_job_failure_subcode}`]),
    ...(report.action_run_id === undefined ? [] : [`- Automation action run: ${report.action_run_id}`]),
    ...(report.action_run_status === undefined ? [] : [`- Automation action run status: ${report.action_run_status}`]),
    ...(report.run_session_id === undefined ? [] : [`- Run session: ${report.run_session_id}`]),
    ...(report.run_session_status === undefined ? [] : [`- Run session status: ${report.run_session_status}`]),
    ...(report.run_session_failure_reason === undefined ? [] : [`- Run session failure reason: ${report.run_session_failure_reason}`]),
    '',
  ];
  const markdown = `${lines.join('\n')}\n`;
  assertPublicSafeReport(markdown);
  return markdown;
};

export const runCodexRuntimeSuperpowersDogfood = async (input: {
  client: CodexRuntimeSuperpowersDogfoodClient;
}): Promise<{ report: CodexRuntimeSuperpowersDogfoodReport; reportPath: string }> => {
  const seed = await input.client.seedPlanningInputAndDevelopmentPlanItem();
  const importedRuntime = await input.client.importCodexRuntime();
  await input.client.smokeGenerationWorker();
  await input.client.startNoSharedFilesystemRunWorker();
  await input.client.runBoundaryBrainstormingRound(1);
  await input.client.answerBoundaryQuestion();
  await input.client.runBoundaryBrainstormingRound(2);
  await input.client.proposeBoundarySummary();
  await input.client.mutateDevelopmentPlanItem();
  const staleBoundaryCheck = await input.client.assertStaleBoundaryBlocksSpecGeneration();
  const rebasedBoundary = await input.client.rebaseBoundaryBrainstorming();
  const approvedBoundary = await input.client.approveBoundarySummary();
  const spec = await input.client.generateAndApproveSpec();
  const implementationPlanDoc = await input.client.generateAndApproveImplementationPlanDoc();
  const execution = await input.client.startExecution();
  const report: CodexRuntimeSuperpowersDogfoodReport = {
    status: 'PASS',
    development_plan_item_id: seed.development_plan_item_id,
    boundary_brainstorming_session_id: rebasedBoundary.rebased_session_id,
    boundary_summary_revision_id: approvedBoundary.boundary_summary_revision_id,
    spec_revision_id: spec.spec_revision_id,
    implementation_plan_revision_id: implementationPlanDoc.implementation_plan_revision_id,
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
  const bodyText = await response.text();
  if (!response.ok) {
    const productApiReason = productApiFailureReason(bodyText);
    throw new CodexRuntimeSuperpowersDogfoodBlocker('codex_runtime_superpowers_product_api_unavailable', {
      status: 'BLOCKED',
      blocker_code: 'codex_runtime_superpowers_product_api_unavailable',
      product_api_status: response.status,
      ...(productApiReason === undefined ? {} : { product_api_reason: productApiReason }),
    });
  }
  return JSON.parse(bodyText) as T;
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

const signedAutomationHeaders = (
  config: CodexRuntimeSuperpowersDogfoodCliConfig,
  pathAndQuery: string,
  env: EnvLike,
): Record<string, string> | undefined => {
  const secret = optionalEnv(env, 'FORGELOOP_TRUSTED_ACTOR_HEADER_SECRET');
  if (secret === undefined) {
    return undefined;
  }
  return signAutomationRequest({
    method: 'GET',
    pathAndQuery,
    rawBody: '',
    actorId: optionalEnv(env, 'FORGELOOP_AUTOMATION_ACTOR_ID') ?? config.actorId,
    actorClass: 'automation_daemon',
    daemonIdentity: optionalEnv(env, 'FORGELOOP_AUTOMATION_DAEMON_IDENTITY') ?? 'codex-runtime-superpowers-dogfood',
    timestamp: new Date().toISOString(),
    secret,
  });
};

const digestFromPublicId = (value: string): Sha256Digest => canonicalPublicDigest(value);

const stableUuidFromDigest = (input: Record<string, unknown>): string => {
  const hex = codexCanonicalDigest(input).slice('sha256:'.length);
  const variant = (8 + (Number.parseInt(hex[16]!, 16) % 4)).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

const assertPublicSafeReason = (value: string): boolean => publicIdPattern.test(value) && !value.includes('..');

const productApiFailureReason = (bodyText: string): string | undefined => {
  try {
    const body = JSON.parse(bodyText) as Record<string, unknown>;
    const code = typeof body.code === 'string' ? body.code.trim() : undefined;
    if (code !== undefined && assertPublicSafeReason(code)) {
      return code;
    }
    const message = typeof body.message === 'string' ? body.message : undefined;
    const reason = message?.split(':').pop()?.trim();
    return reason !== undefined && assertPublicSafeReason(reason) ? reason : undefined;
  } catch {
    return undefined;
  }
};

const runRemoteWorkerOnce = async (env: EnvLike = process.env, targetKind: 'generation' | 'run_execution' = 'generation'): Promise<void> => {
  const modulePath = './codex-remote-worker-dogfood';
  const module = (await import(modulePath)) as {
    loadCodexRemoteWorkerDogfoodConfig: (env?: EnvLike) => unknown;
    runCodexRemoteWorkerDogfood: (config?: unknown) => Promise<unknown>;
  };
  const workerConfig = module.loadCodexRemoteWorkerDogfoodConfig(sanitizeCodexRemoteWorkerDogfoodEnv(env, targetKind));
  await module.runCodexRemoteWorkerDogfood(workerConfig);
};

const runBootstrapImport = async (envPatch: EnvLike = {}): Promise<Record<string, unknown>> => {
  const modulePath = './codex-runtime-dogfood-bootstrap';
  const module = (await import(modulePath)) as { runCodexRuntimeDogfoodBootstrap: () => Promise<Record<string, unknown>> };
  const previousValues = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(envPatch)) {
    previousValues.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    return await module.runCodexRuntimeDogfoodBootstrap();
  } finally {
    for (const [key, value] of previousValues) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
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
  let implementationPlanRevisionId: string | undefined;
  let cachedBoundarySession: BoundarySessionApiResponse | undefined;
  const env = deps.env ?? process.env;
  const fetchDeps: Pick<CodexRuntimeSuperpowersDogfoodHttpClientDeps, 'fetchImpl'> =
    deps.fetchImpl === undefined ? {} : { fetchImpl: deps.fetchImpl };
  const invokeRemoteWorkerOnce = deps.runRemoteWorkerOnce ?? ((targetKind) => runRemoteWorkerOnce(env, targetKind));
  const invokeBootstrapImport = deps.runBootstrapImport ?? runBootstrapImport;

  const requireState = (value: string | undefined, code: string): string => {
    if (value === undefined) {
      throw new CodexRuntimeSuperpowersDogfoodBlocker(code, { status: 'BLOCKED', blocker_code: code });
    }
    return value;
  };
	const replaceDogfoodScope = (projectId: string, planningInputId: string): void => {
		config.projectId = projectId;
		config.planningInputId = planningInputId;
		env.FORGELOOP_CODEX_DOGFOOD_PROJECT_ID = projectId;
		env.FORGELOOP_CODEX_ALLOWED_SCOPE_PROJECT_ID = projectId;
		env.FORGELOOP_CODEX_DOGFOOD_PLANNING_INPUT_ID = planningInputId;
		if (config.repoId !== undefined) {
			env.FORGELOOP_CODEX_DOGFOOD_REPO_ID = config.repoId;
			env.FORGELOOP_CODEX_ALLOWED_SCOPE_REPO_ID = config.repoId;
		}
	};
  type BoundarySessionApiResponse = {
    id: string;
    status?: string;
    questions?: Array<{ id: string; status?: string; required?: boolean; answered_by_answer_id?: string }>;
    latest_summary_revision_id?: string;
    approved_summary_revision_id?: string;
    current_round_runtime_job_id?: string;
  };
  type DevelopmentPlanItemProjection = {
    specs?: Array<{ current_revision_id?: string; approved_revision_id?: string; id?: string }>;
    implementation_plan_docs?: Array<{ current_revision_id?: string; approved_revision_id?: string; id?: string }>;
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
  type RuntimeJobProjection = {
    id: string;
    status?: string;
    terminal_status?: string;
    terminal_reason_code?: string;
  };
  type RuntimeJobArtifactProjection = {
    kind?: string;
    metadata_json?: {
      failure_subcode?: string;
    };
  };
  type AutomationActionRunProjection = {
    id: string;
    status?: string;
  };
  type AutomationRuntimeSnapshotProjection = {
    recent_action_runs?: AutomationActionRunProjection[];
  };
  type RunSessionProjection = {
    id: string;
    status?: string;
    failure_reason?: string;
    runtime_metadata?: {
      driver_status?: string;
    };
  };
  const terminalRunSessionStatuses = new Set(['failed', 'timed_out', 'cancelled', 'stalled']);
  const isSha256Digest = (value: unknown): value is Sha256Digest =>
    typeof value === 'string' && value.startsWith('sha256:') && value.length > 'sha256:'.length;
  const fetchRuntimeJob = async (runtimeJobId: string): Promise<RuntimeJobProjection> => {
    const path = `/internal/codex-runtime/runtime-jobs/${encodeURIComponent(runtimeJobId)}`;
    const headers = signedAutomationHeaders(config, path, env);
    if (headers === undefined) {
      throw new CodexRuntimeSuperpowersDogfoodBlocker('codex_runtime_superpowers_runtime_job_status_auth_missing', {
        status: 'BLOCKED',
        blocker_code: 'codex_runtime_superpowers_runtime_job_status_auth_missing',
        runtime_job_id: runtimeJobId,
      });
    }
    const response = await (deps.fetchImpl ?? fetch)(`${config.controlPlaneUrl}${path}`, { headers });
    if (!response.ok) {
      throw new CodexRuntimeSuperpowersDogfoodBlocker('codex_runtime_superpowers_runtime_job_status_unavailable', {
        status: 'BLOCKED',
        blocker_code: 'codex_runtime_superpowers_runtime_job_status_unavailable',
        runtime_job_id: runtimeJobId,
      });
    }
    const body = (await response.json()) as { runtime_job?: RuntimeJobProjection };
    if (body.runtime_job === undefined) {
      throw new CodexRuntimeSuperpowersDogfoodBlocker('codex_runtime_superpowers_runtime_job_status_unavailable', {
        status: 'BLOCKED',
        blocker_code: 'codex_runtime_superpowers_runtime_job_status_unavailable',
        runtime_job_id: runtimeJobId,
      });
    }
    return body.runtime_job;
  };
  const fetchRuntimeJobWithArtifacts = async (
    runtimeJobId: string,
  ): Promise<{ runtime_job: RuntimeJobProjection; artifacts: RuntimeJobArtifactProjection[] }> => {
    const path = `/internal/codex-runtime/runtime-jobs/${encodeURIComponent(runtimeJobId)}`;
    const headers = signedAutomationHeaders(config, path, env);
    if (headers === undefined) {
      throw new CodexRuntimeSuperpowersDogfoodBlocker('codex_runtime_superpowers_runtime_job_status_auth_missing', {
        status: 'BLOCKED',
        blocker_code: 'codex_runtime_superpowers_runtime_job_status_auth_missing',
        runtime_job_id: runtimeJobId,
      });
    }
    const response = await (deps.fetchImpl ?? fetch)(`${config.controlPlaneUrl}${path}`, { headers });
    if (!response.ok) {
      throw new CodexRuntimeSuperpowersDogfoodBlocker('codex_runtime_superpowers_runtime_job_status_unavailable', {
        status: 'BLOCKED',
        blocker_code: 'codex_runtime_superpowers_runtime_job_status_unavailable',
        runtime_job_id: runtimeJobId,
      });
    }
    const body = (await response.json()) as {
      runtime_job?: RuntimeJobProjection;
      artifacts?: RuntimeJobArtifactProjection[];
    };
    if (body.runtime_job === undefined) {
      throw new CodexRuntimeSuperpowersDogfoodBlocker('codex_runtime_superpowers_runtime_job_status_unavailable', {
        status: 'BLOCKED',
        blocker_code: 'codex_runtime_superpowers_runtime_job_status_unavailable',
        runtime_job_id: runtimeJobId,
      });
    }
    return {
      runtime_job: body.runtime_job,
      artifacts: Array.isArray(body.artifacts) ? body.artifacts : [],
    };
  };
  const runtimeJobFailureSubcode = (artifacts: readonly RuntimeJobArtifactProjection[]): string | undefined => {
    const subcode = artifacts.find((artifact) => artifact.kind === 'startup_failure_evidence')?.metadata_json?.failure_subcode;
    return subcode === undefined || !publicIdPattern.test(subcode) ? undefined : subcode;
  };
  const inspectRuntimeJob = async (runtimeJobId: string | undefined): Promise<{ terminalSucceeded: boolean }> => {
    if (runtimeJobId === undefined) {
      return { terminalSucceeded: true };
    }
    const runtimeJob = await fetchRuntimeJob(runtimeJobId);
    if (runtimeJob.status !== 'terminal') {
      return { terminalSucceeded: false };
    }
    if (runtimeJob.terminal_status === 'succeeded') {
      return { terminalSucceeded: true };
    }
    throw new CodexRuntimeSuperpowersDogfoodBlocker('codex_runtime_superpowers_runtime_job_failed', {
      status: 'BLOCKED',
      blocker_code: 'codex_runtime_superpowers_runtime_job_failed',
      runtime_job_id: runtimeJob.id,
      ...(runtimeJob.terminal_status === undefined ? {} : { runtime_job_terminal_status: runtimeJob.terminal_status }),
      ...(runtimeJob.terminal_reason_code === undefined ? {} : { runtime_job_reason_code: runtimeJob.terminal_reason_code }),
    });
  };
  const runtimeJobIdForRunExecution = async (executionPackageId: string, runSessionId: string): Promise<string | undefined> => {
    const response = await (deps.fetchImpl ?? fetch)(`${config.controlPlaneUrl}/execution-packages/${encodeURIComponent(executionPackageId)}`);
    if (!response.ok) {
      return undefined;
    }
    const executionPackage = (await response.json()) as { version?: unknown };
    if (!Number.isInteger(executionPackage.version) || Number(executionPackage.version) < 0) {
      return undefined;
    }
    return stableUuidFromDigest({
      kind: 'codex_runtime_job',
      run_session_id: runSessionId,
      execution_package_id: executionPackageId,
      execution_package_version: Number(executionPackage.version),
    });
  };
  const fetchAutomationActionRun = async (actionRunId: string | undefined): Promise<AutomationActionRunProjection | undefined> => {
    if (actionRunId === undefined) {
      return undefined;
    }
    const path = '/internal/automation/runtime-snapshot';
    const headers = signedAutomationHeaders(config, path, env);
    if (headers === undefined) {
      throw new CodexRuntimeSuperpowersDogfoodBlocker('codex_runtime_superpowers_action_status_auth_missing', {
        status: 'BLOCKED',
        blocker_code: 'codex_runtime_superpowers_action_status_auth_missing',
        action_run_id: actionRunId,
      });
    }
    const response = await (deps.fetchImpl ?? fetch)(`${config.controlPlaneUrl}${path}`, { headers });
    if (!response.ok) {
      throw new CodexRuntimeSuperpowersDogfoodBlocker('codex_runtime_superpowers_action_status_unavailable', {
        status: 'BLOCKED',
        blocker_code: 'codex_runtime_superpowers_action_status_unavailable',
        action_run_id: actionRunId,
      });
    }
    const snapshot = (await response.json()) as AutomationRuntimeSnapshotProjection;
    return snapshot.recent_action_runs?.find((action) => action.id === actionRunId);
  };
  const inspectActionRun = async (actionRunId: string | undefined): Promise<{ succeeded: boolean }> => {
    const actionRun = await fetchAutomationActionRun(actionRunId);
    if (actionRun === undefined || actionRun.status === undefined || actionRun.status === 'pending' || actionRun.status === 'running') {
      return { succeeded: actionRunId === undefined };
    }
    if (actionRun.status === 'succeeded') {
      return { succeeded: true };
    }
    throw new CodexRuntimeSuperpowersDogfoodBlocker('codex_runtime_superpowers_product_generation_action_failed', {
      status: 'BLOCKED',
      blocker_code: 'codex_runtime_superpowers_product_generation_action_failed',
      action_run_id: actionRun.id,
      action_run_status: actionRun.status,
    });
  };
  const fetchRunSession = async (runSessionId: string | undefined): Promise<RunSessionProjection | undefined> => {
    if (runSessionId === undefined) {
      return undefined;
    }
    const response = await (deps.fetchImpl ?? fetch)(`${config.controlPlaneUrl}/run-sessions/${encodeURIComponent(runSessionId)}`);
    if (!response.ok) {
      return undefined;
    }
    return (await response.json()) as RunSessionProjection;
  };
  const throwIfRunSessionFailed = async (
    runSessionId: string | undefined,
    executionPackageId?: string,
  ): Promise<void> => {
    const runSession = await fetchRunSession(runSessionId);
    if (runSession?.status === undefined || !terminalRunSessionStatuses.has(runSession.status)) {
      return;
    }
    const runtimeJobId =
      runSession.id === undefined || executionPackageId === undefined
        ? undefined
        : await runtimeJobIdForRunExecution(executionPackageId, runSession.id);
    const runtimeJobDiagnostic =
      runtimeJobId === undefined ? undefined : await fetchRuntimeJobWithArtifacts(runtimeJobId).catch(() => undefined);
    throw new CodexRuntimeSuperpowersDogfoodBlocker('codex_runtime_superpowers_run_execution_failed', {
      status: 'BLOCKED',
      blocker_code: 'codex_runtime_superpowers_run_execution_failed',
      run_session_id: runSession.id,
      run_session_status: runSession.status,
      ...(runtimeJobDiagnostic?.runtime_job.id === undefined ? {} : { runtime_job_id: runtimeJobDiagnostic.runtime_job.id }),
      ...(runtimeJobDiagnostic?.runtime_job.terminal_status === undefined
        ? {}
        : { runtime_job_terminal_status: runtimeJobDiagnostic.runtime_job.terminal_status }),
      ...(runtimeJobDiagnostic?.runtime_job.terminal_reason_code === undefined
        ? {}
        : { runtime_job_reason_code: runtimeJobDiagnostic.runtime_job.terminal_reason_code }),
      ...(runtimeJobDiagnostic === undefined
        ? {}
        : (() => {
            const failureSubcode = runtimeJobFailureSubcode(runtimeJobDiagnostic.artifacts);
            return failureSubcode === undefined ? {} : { runtime_job_failure_subcode: failureSubcode };
          })()),
      ...(runSession.failure_reason === undefined || !publicIdPattern.test(runSession.failure_reason)
        ? {}
        : { run_session_failure_reason: runSession.failure_reason }),
    });
  };
  const fetchBoundarySession = async (): Promise<BoundarySessionApiResponse> => {
    const sessionId = requireState(boundarySessionId, 'codex_runtime_superpowers_dogfood_boundary_session_missing');
    cachedBoundarySession = await requestJson<BoundarySessionApiResponse>(config, `/boundary-brainstorming-sessions/${sessionId}`, {}, fetchDeps);
    return cachedBoundarySession;
  };
  const openBoundaryQuestionId = (session: BoundarySessionApiResponse | undefined): string | undefined =>
    session?.questions?.find(
      (question) => question.answered_by_answer_id === undefined && (question.required === true || question.status === 'open'),
    )?.id;
  const answerBoundaryQuestionById = async (sessionId: string, questionId: string, text: string): Promise<void> => {
    await requestJson(config, `/boundary-brainstorming-sessions/${sessionId}/answers`, {
      method: 'POST',
      body: {
        question_id: questionId,
        text,
        actor_id: config.leaderActorId,
      },
    }, fetchDeps);
    cachedBoundarySession = undefined;
  };
  const boundarySummaryRevisionIdFromSession = (session: BoundarySessionApiResponse | undefined): string | undefined =>
    session?.latest_summary_revision_id ?? session?.approved_summary_revision_id;
  const latestBoundarySummaryRevisionId = async (): Promise<string> => {
    const session = boundarySummaryRevisionIdFromSession(cachedBoundarySession) === undefined ? await fetchBoundarySession() : cachedBoundarySession;
    const revisionId = boundarySummaryRevisionIdFromSession(session);
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
  const currentImplementationPlanRevisionId = async (): Promise<string | undefined> => {
    const item = await fetchDevelopmentPlanItemProjection();
    return item.implementation_plan_docs?.[0]?.approved_revision_id ?? item.implementation_plan_docs?.[0]?.current_revision_id;
  };
  const fetchExecutionRuntimeEvidence = async (executionId: string): Promise<{
    workspace_bundle_digest: Sha256Digest;
    mounted_task_workspace_digest: Sha256Digest;
    changed_files: string[];
  } | undefined> => {
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
      return undefined;
    }
    return {
      workspace_bundle_digest: evidence.workspace_bundle_digest,
      mounted_task_workspace_digest: evidence.mounted_task_workspace_digest,
      changed_files: evidence.changed_files,
    };
  };
  const sleep = async (durationMs: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, durationMs));
  const invokeRemoteWorkerOnceWithinDeadline = async (
    targetKind: 'generation' | 'run_execution',
    deadline: number,
  ): Promise<void> => {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      throw new CodexRuntimeSuperpowersDogfoodBlocker('codex_runtime_superpowers_remote_worker_invocation_timed_out', {
        status: 'BLOCKED',
        blocker_code: 'codex_runtime_superpowers_remote_worker_invocation_timed_out',
      });
    }
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        invokeRemoteWorkerOnce(targetKind),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => {
            reject(
              new CodexRuntimeSuperpowersDogfoodBlocker('codex_runtime_superpowers_remote_worker_invocation_timed_out', {
                status: 'BLOCKED',
                blocker_code: 'codex_runtime_superpowers_remote_worker_invocation_timed_out',
              }),
            );
          }, remainingMs);
        }),
      ]);
    } catch (error) {
      if (error instanceof CodexRuntimeSuperpowersDogfoodBlocker) {
        throw error;
      }
      throw new CodexRuntimeSuperpowersDogfoodBlocker('codex_runtime_superpowers_remote_worker_invocation_failed', {
        status: 'BLOCKED',
        blocker_code: 'codex_runtime_superpowers_remote_worker_invocation_failed',
      });
    } finally {
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
    }
  };
  const invokeRemoteWorkerUntil = async <T>(input: {
    targetKind: 'generation' | 'run_execution';
    blockerCode: string;
    observe: () => Promise<T | undefined>;
    runtimeJobId?: () => string | undefined;
    actionRunId?: () => string | undefined;
    runSessionId?: () => string | undefined;
    executionPackageId?: () => string | undefined;
  }): Promise<T> => {
    const deadline = Date.now() + (config.remoteRuntimeJobWaitTimeoutMs ?? 600_000);
    while (true) {
      if (Date.now() >= deadline) {
        throw new CodexRuntimeSuperpowersDogfoodBlocker(input.blockerCode, { status: 'BLOCKED', blocker_code: input.blockerCode });
      }
      await invokeRemoteWorkerOnceWithinDeadline(input.targetKind, deadline);
      const observed = await input.observe();
      const runtimeJobInspection = await inspectRuntimeJob(input.runtimeJobId?.());
      const actionRunInspection = await inspectActionRun(input.actionRunId?.());
      await throwIfRunSessionFailed(input.runSessionId?.(), input.executionPackageId?.());
      if (observed !== undefined && runtimeJobInspection.terminalSucceeded && actionRunInspection.succeeded) {
        return observed;
      }
      if (Date.now() >= deadline) {
        throw new CodexRuntimeSuperpowersDogfoodBlocker(input.blockerCode, { status: 'BLOCKED', blocker_code: input.blockerCode });
      }
      await sleep(config.remoteRuntimeJobPollIntervalMs ?? 1_000);
    }
  };

  return {
		async importCodexRuntime() {
			if (!config.skipBootstrap) {
				const summary = await invokeBootstrapImport({
					FORGELOOP_CODEX_DOGFOOD_PROJECT_ID: config.projectId,
					FORGELOOP_CODEX_ALLOWED_SCOPE_PROJECT_ID: config.projectId,
					FORGELOOP_CODEX_DOGFOOD_REPO_ID: config.repoId,
					FORGELOOP_CODEX_ALLOWED_SCOPE_REPO_ID: config.repoId,
					FORGELOOP_CODEX_DOGFOOD_PLANNING_INPUT_ID: config.planningInputId,
				});
        env.FORGELOOP_CODEX_GENERATION_RUNTIME_PROFILE_ID = String(summary.generation_runtime_profile_id);
        env.FORGELOOP_CODEX_GENERATION_CREDENTIAL_BINDING_ID = String(summary.generation_credential_binding_id);
        env.FORGELOOP_CODEX_RUN_EXECUTION_RUNTIME_PROFILE_ID = String(summary.run_execution_runtime_profile_id);
        env.FORGELOOP_CODEX_RUN_EXECUTION_CREDENTIAL_BINDING_ID = String(summary.run_execution_credential_binding_id);
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
          digestFromPublicId(requireState(config.generationRuntimeProfileId, 'codex_runtime_superpowers_generation_runtime_profile_missing')),
          digestFromPublicId(requireState(config.runExecutionRuntimeProfileId, 'codex_runtime_superpowers_run_runtime_profile_missing')),
        ],
        credential_binding_version_digests: [
          digestFromPublicId(requireState(config.generationCredentialBindingId, 'codex_runtime_superpowers_generation_credential_missing')),
          digestFromPublicId(requireState(config.runExecutionCredentialBindingId, 'codex_runtime_superpowers_run_credential_missing')),
        ],
      };
    },
    async smokeGenerationWorker() {
      await invokeRemoteWorkerOnce('generation');
    },
    async startNoSharedFilesystemRunWorker() {
      if (!config.noSharedFilesystem) {
        throw new CodexRuntimeSuperpowersDogfoodBlocker('codex_runtime_superpowers_no_shared_filesystem_required', {
          status: 'BLOCKED',
          blocker_code: 'codex_runtime_superpowers_no_shared_filesystem_required',
        });
      }
      await invokeRemoteWorkerOnce('run_execution');
    },
    async seedPlanningInputAndDevelopmentPlanItem() {
      if (config.autoSeedProductSource === true) {
        const project = await requestJson<{ id: string }>(config, '/projects', {
          method: 'POST',
          body: {
            name: 'Forgeloop Codex Runtime Dogfood',
            owner_actor_id: config.actorId,
          },
        }, fetchDeps);
        replaceDogfoodScope(project.id, config.planningInputId);
        if (config.repoId !== undefined && config.repoLocalPath !== undefined && config.repoBaseCommitSha !== undefined) {
          await requestJson(config, `/projects/${encodeURIComponent(config.projectId)}/repos`, {
            method: 'POST',
            body: {
              repo_id: config.repoId,
              name: 'forgeloop',
              local_path: config.repoLocalPath,
              default_branch: 'main',
              base_commit_sha: config.repoBaseCommitSha,
            },
          }, fetchDeps);
        }
        const planningInput = await requestJson<{ id: string }>(config, planningInputCreatePath(config.planningInputType), {
          method: 'POST',
          body: {
            project_id: config.projectId,
            title: 'Codex runtime Superpowers dogfood source',
            goal: 'Validate the strict Superpowers product loop through centralized Codex runtime distribution.',
            success_criteria: ['Boundary, Spec, Implementation Plan Doc, and Execution complete through runtime-backed product APIs.'],
            priority: 'P0',
            risk: 'high',
            driver_actor_id: config.actorId,
            intake_context: {
              type: 'requirement',
              stakeholder_problem: 'Codex runtime closure needs a real Requirement document.',
              desired_outcome: 'The dogfood loop creates all product artifacts from a typed Requirement.',
              acceptance_criteria: ['The strict dogfood script completes without fixture-only source ids.'],
              in_scope: ['Codex runtime Superpowers dogfood'],
            },
          },
        }, fetchDeps);
        replaceDogfoodScope(config.projectId, planningInput.id);
      }
      const plan = await requestJson<{ id: string }>(config, '/development-plans', {
        method: 'POST',
        body: {
          project_id: config.projectId,
          source_ref: { type: config.planningInputType, id: config.planningInputId },
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
        planning_input_id: config.planningInputId,
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
        cachedBoundarySession = undefined;
        await invokeRemoteWorkerUntil({
          targetKind: 'generation',
          blockerCode: 'codex_runtime_superpowers_dogfood_boundary_question_id_missing',
          observe: async () => {
            const currentSession = await fetchBoundarySession();
            return openBoundaryQuestionId(currentSession) === undefined ? undefined : currentSession;
          },
          runtimeJobId: () => cachedBoundarySession?.current_round_runtime_job_id,
        });
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
      cachedBoundarySession = undefined;
      await invokeRemoteWorkerUntil({
        targetKind: 'generation',
        blockerCode: 'codex_runtime_superpowers_dogfood_boundary_summary_revision_id_missing',
        observe: async () => {
          const currentSession = await fetchBoundarySession();
          return boundarySummaryRevisionIdFromSession(currentSession) === undefined ? undefined : currentSession;
        },
        runtimeJobId: () => cachedBoundarySession?.current_round_runtime_job_id,
      });
      return { boundary_brainstorming_session_id: sessionId };
    },
    async answerBoundaryQuestion() {
      const sessionId = requireState(boundarySessionId, 'codex_runtime_superpowers_dogfood_boundary_session_missing');
      const discoveredQuestionId = openBoundaryQuestionId(cachedBoundarySession) ?? openBoundaryQuestionId(await fetchBoundarySession());
      const questionId = requireState(
        config.boundaryQuestionId ?? discoveredQuestionId,
        'codex_runtime_superpowers_dogfood_boundary_question_id_missing',
      );
      await answerBoundaryQuestionById(
        sessionId,
        questionId,
        'Limit the execution to a docs-only dogfood report and preserve centralized Codex runtime distribution.',
      );
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
      cachedBoundarySession = undefined;
      const rebaseState = await invokeRemoteWorkerUntil({
        targetKind: 'generation',
        blockerCode: 'codex_runtime_superpowers_dogfood_boundary_question_id_missing',
        observe: async () => {
          const currentSession = await fetchBoundarySession();
          const revisionId = boundarySummaryRevisionIdFromSession(currentSession);
          if (revisionId !== undefined) {
            return { revisionId };
          }
          const questionId = openBoundaryQuestionId(currentSession);
          return questionId === undefined ? undefined : { questionId };
        },
        runtimeJobId: () => cachedBoundarySession?.current_round_runtime_job_id,
      });
      if ('questionId' in rebaseState) {
        await answerBoundaryQuestionById(
          session.id,
          rebaseState.questionId,
          'The rebased boundary remains docs-only and must preserve centralized Codex runtime distribution without worker-local configuration.',
        );
        await requestJson(config, `/boundary-brainstorming-sessions/${session.id}/continue`, {
          method: 'POST',
          body: {
            actor_id: config.leaderActorId,
            leader_input_markdown: 'Continue after Leader rebase answer and propose the current strict dogfood Boundary Summary.',
          },
        }, fetchDeps);
        cachedBoundarySession = undefined;
        await invokeRemoteWorkerUntil({
          targetKind: 'generation',
          blockerCode: 'codex_runtime_superpowers_dogfood_boundary_summary_revision_id_missing',
          observe: async () => {
            const currentSession = await fetchBoundarySession();
            return boundarySummaryRevisionIdFromSession(currentSession) === undefined ? undefined : currentSession;
          },
          runtimeJobId: () => cachedBoundarySession?.current_round_runtime_job_id,
        });
      }
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
      const scheduled = await requestJson<{ action_run?: { id?: string }; runtime_job?: { id?: string } }>(
        config,
        `/development-plans/${planId}/items/${itemId}/spec-revisions/generate`,
        {
          method: 'POST',
          body: { actor_id: config.actorId },
        },
        fetchDeps,
      );
      const actionRunId = requireState(scheduled.action_run?.id, 'codex_runtime_superpowers_dogfood_spec_action_run_missing');
      const runtimeJobId = requireState(scheduled.runtime_job?.id, 'codex_runtime_superpowers_dogfood_spec_runtime_job_missing');
      specRevisionId = await invokeRemoteWorkerUntil({
        targetKind: 'generation',
        blockerCode: 'codex_runtime_superpowers_dogfood_spec_revision_id_missing',
        observe: currentSpecRevisionId,
        runtimeJobId: () => runtimeJobId,
        actionRunId: () => actionRunId,
      });
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
    async generateAndApproveImplementationPlanDoc() {
      const planId = requireState(developmentPlanId, 'codex_runtime_superpowers_dogfood_plan_missing');
      const itemId = requireState(developmentPlanItemId, 'codex_runtime_superpowers_dogfood_item_missing');
      const scheduled = await requestJson<{ action_run?: { id?: string }; runtime_job?: { id?: string } }>(
        config,
        `/development-plans/${planId}/items/${itemId}/implementation-plan-revisions/generate`,
        {
          method: 'POST',
          body: { actor_id: config.actorId },
        },
        fetchDeps,
      );
      const actionRunId = requireState(scheduled.action_run?.id, 'codex_runtime_superpowers_dogfood_implementation_plan_action_run_missing');
      const runtimeJobId = requireState(
        scheduled.runtime_job?.id,
        'codex_runtime_superpowers_dogfood_implementation_plan_runtime_job_missing',
      );
      implementationPlanRevisionId = await invokeRemoteWorkerUntil({
        targetKind: 'generation',
        blockerCode: 'codex_runtime_superpowers_dogfood_implementation_plan_revision_id_missing',
        observe: currentImplementationPlanRevisionId,
        runtimeJobId: () => runtimeJobId,
        actionRunId: () => actionRunId,
      });
      await requestJson(config, `/development-plans/${planId}/items/${itemId}/implementation-plan/submit-for-approval`, {
        method: 'POST',
        body: { actor_id: config.actorId },
      }, fetchDeps);
      await requestJson(config, `/development-plans/${planId}/items/${itemId}/implementation-plan/approve`, {
        method: 'POST',
        body: { actor_id: config.reviewerActorId, rationale: 'Strict dogfood Implementation Plan Doc approved.' },
      }, fetchDeps);
      implementationPlanRevisionId = (await currentImplementationPlanRevisionId()) ?? implementationPlanRevisionId;
      return {
        implementation_plan_revision_id: requireState(
          implementationPlanRevisionId,
          'codex_runtime_superpowers_dogfood_implementation_plan_revision_missing',
        ),
      };
    },
    async startExecution() {
      const planId = requireState(developmentPlanId, 'codex_runtime_superpowers_dogfood_plan_missing');
      const itemId = requireState(developmentPlanItemId, 'codex_runtime_superpowers_dogfood_item_missing');
      const execution = await requestJson<{
        id: string;
        changed_files?: string[];
        runtime_evidence_refs?: Array<{ type?: string; id?: string }>;
      }>(
        config,
        `/development-plans/${planId}/items/${itemId}/execution/start`,
        {
          method: 'POST',
          body: { actor_id: config.actorId },
        },
        fetchDeps,
      );
      const runSessionId = requireState(
        execution.runtime_evidence_refs?.find((ref) => ref.type === 'run_session' && typeof ref.id === 'string')?.id,
        'codex_runtime_superpowers_execution_run_session_missing',
      );
      const executionPackageId = requireState(
        execution.runtime_evidence_refs?.find((ref) => ref.type === 'execution_package' && typeof ref.id === 'string')?.id,
        'codex_runtime_superpowers_execution_package_missing',
      );
      const evidence = await invokeRemoteWorkerUntil({
        targetKind: 'run_execution',
        blockerCode: 'codex_runtime_superpowers_execution_runtime_evidence_missing',
        observe: () => fetchExecutionRuntimeEvidence(execution.id),
        runSessionId: () => runSessionId,
        executionPackageId: () => executionPackageId,
      });
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
