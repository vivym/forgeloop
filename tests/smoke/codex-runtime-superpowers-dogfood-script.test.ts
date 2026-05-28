import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  CodexRuntimeSuperpowersDogfoodBlocker,
  FilesystemCodexRuntimeSuperpowersDogfoodReporter,
  codexRuntimeSuperpowersDogfoodCommand,
  createCodexRuntimeSuperpowersDogfoodHttpClient,
  collectCodexAppServerPhaseEvidence,
  deriveCodexAppServerEvidence,
  loadCodexRuntimeSuperpowersDogfoodCliConfig,
  renderCodexRuntimeSuperpowersDogfoodBlockerReport,
  renderCodexRuntimeSuperpowersDogfoodReport,
  runCodexRuntimeSuperpowersDogfood,
  sanitizeCodexRemoteWorkerDogfoodEnv,
  type CodexRuntimeSuperpowersDogfoodCliConfig,
  type CodexRuntimeSuperpowersDogfoodClient,
} from '../../scripts/codex-runtime-superpowers-dogfood';

const digest = (seed: string): string => `sha256:${createHash('sha256').update(seed).digest('hex')}`;
const publicDigest = (seed: string): string => `sha256:${createHash('sha256').update(JSON.stringify(seed)).digest('hex')}`;
const fixedReportPath = 'docs/superpowers/reports/codex-runtime-real-dogfood-pass.md';

const boundaryEvidence = {
  mode: 'initial' as const,
  session_id: 'boundary-session-initial',
  approved_summary_revision_id: 'boundary-summary-revision-initial',
  ai_turn_count: 3,
  follow_up_path_covered: true,
  summary_request_change_path_covered: true,
  output_schema_versions: ['boundary_round_result.v1'],
  app_server_evidence_digests: [digest('boundary-app-server-a')],
  runtime_job_digests: [digest('boundary-a'), digest('boundary-b'), digest('boundary-c')],
  cleanup_status: 'completed' as const,
};

const boundaryRebaseEvidence = {
  ...boundaryEvidence,
  mode: 'rebase' as const,
  session_id: 'boundary-session-rebased',
  approved_summary_revision_id: 'boundary-summary-revision-rebased',
  ai_turn_count: 1,
  follow_up_path_covered: false,
  summary_request_change_path_covered: false,
  app_server_evidence_digests: [digest('boundary-rebase-app-server-a')],
  runtime_job_digests: [digest('boundary-rebase-a')],
};

const specEvidence = {
  spec_revision_id: 'spec-revision-1',
  output_schema_versions: ['spec_revision.v1'],
  app_server_evidence_digests: [digest('spec-app-server-a')],
  runtime_job_digests: [digest('spec-a')],
  cleanup_status: 'completed' as const,
};

const executionPlanEvidence = {
  execution_plan_revision_id: 'execution-plan-revision-1',
  output_schema_versions: ['execution_plan_revision.v1'],
  app_server_evidence_digests: [digest('plan-app-server-a')],
  runtime_job_digests: [digest('plan-a')],
  cleanup_status: 'completed' as const,
};

const executionEvidence = {
  execution_id: 'execution-1',
  workspace_bundle_digest: digest('workspace-bundle'),
  mounted_task_workspace_digest: digest('mounted-task-workspace'),
  changed_files: [fixedReportPath],
  output_schema_versions: ['codex_run_execution_result.v1'],
  app_server_evidence_digests: [digest('execution-app-server-a')],
  runtime_job_digests: [digest('execution-a')],
  cleanup_status: 'completed' as const,
};

const runtimeAppServerEvidence = {
  app_server_attempted: true,
  selected_execution_mode: 'app_server',
  runtime_profile_id: 'profile-runtime',
  runtime_profile_revision_id: 'profile-runtime-revision',
  runtime_profile_digest: digest('runtime-profile'),
  runtime_target_kind: 'generation',
  source_access_mode: 'artifact_only',
  environment: 'test',
  launch_lease_id: 'launch-lease-1',
  worker_id: 'worker-1',
  docker_image_digest: digest('docker-image'),
  container_id_digest: digest('container-id'),
  app_server_effective_config_digest: digest('effective-config'),
  docker_policy_self_check_digest: digest('policy-self-check'),
};

const codexAppServerEvidence = {
  mode: 'dockerized_app_server' as const,
  output_schema_versions: [
    'boundary_round_result.v1',
    'spec_revision.v1',
    'execution_plan_revision.v1',
    'codex_run_execution_result.v1',
  ],
  runtime_job_digests: [digest('r')],
  app_server_evidence_digests: [digest('app-server-r')],
  phases: [
    {
      phase: 'boundary_initial' as const,
      expected_output_schema_version: 'boundary_round_result.v1',
      observed_output_schema_versions: ['boundary_round_result.v1'],
      runtime_job_digests: [digest('boundary-a')],
      app_server_evidence_digests: [digest('boundary-app-server-a')],
      cleanup_status: 'completed' as const,
    },
    {
      phase: 'boundary_rebase' as const,
      expected_output_schema_version: 'boundary_round_result.v1',
      observed_output_schema_versions: ['boundary_round_result.v1'],
      runtime_job_digests: [digest('boundary-rebase-a')],
      app_server_evidence_digests: [digest('boundary-rebase-app-server-a')],
      cleanup_status: 'completed' as const,
    },
    {
      phase: 'spec' as const,
      expected_output_schema_version: 'spec_revision.v1',
      observed_output_schema_versions: ['spec_revision.v1'],
      runtime_job_digests: [digest('spec-a')],
      app_server_evidence_digests: [digest('spec-app-server-a')],
      cleanup_status: 'completed' as const,
    },
    {
      phase: 'execution_plan' as const,
      expected_output_schema_version: 'execution_plan_revision.v1',
      observed_output_schema_versions: ['execution_plan_revision.v1'],
      runtime_job_digests: [digest('plan-a')],
      app_server_evidence_digests: [digest('plan-app-server-a')],
      cleanup_status: 'completed' as const,
    },
    {
      phase: 'execution' as const,
      expected_output_schema_version: 'codex_run_execution_result.v1',
      observed_output_schema_versions: ['codex_run_execution_result.v1'],
      runtime_job_digests: [digest('execution-a')],
      app_server_evidence_digests: [digest('execution-app-server-a')],
      cleanup_status: 'completed' as const,
    },
  ],
};

const safeReport = () => ({
  status: 'PASS' as const,
  package_script_command: 'pnpm dogfood:codex-runtime:superpowers' as const,
  development_plan_item_id: 'item-1',
  boundary_brainstorming_session_id: 'boundary-session-1',
  boundary_summary_revision_id: 'boundary-summary-revision-1',
  spec_revision_id: 'spec-revision-1',
  execution_plan_revision_id: 'execution-plan-revision-1',
  execution_id: 'execution-1',
  runtime_profile_revision_digests: [digest('a')],
  credential_binding_version_digests: [digest('b')],
  codex_app_server_evidence: codexAppServerEvidence,
  no_shared_filesystem_worker: true as const,
  workspace_bundle_digest: digest('c'),
  mounted_task_workspace_digest: digest('d'),
  stale_boundary_negative_check: {
    blocked: true as const,
    blocker_code: 'STALE_BOUNDARY_SUMMARY' as const,
    rebased_session_id: 'boundary-session-2',
    rebased_boundary_summary_revision_id: 'boundary-summary-revision-2',
  },
  boundary_ai_turn_count: 4,
  boundary_follow_up_path_covered: true,
  boundary_summary_request_change_path_covered: true,
  cleanup_status: 'completed' as const,
  changed_files: [fixedReportPath],
  report_path: fixedReportPath as const,
});

type PhaseEvidenceOverride = {
  output_schema_versions?: string[];
  runtime_job_digests?: string[];
  app_server_evidence_digests?: string[];
  cleanup_status?: 'completed' | 'blocked';
  ai_turn_count?: number;
  follow_up_path_covered?: boolean;
  summary_request_change_path_covered?: boolean;
};

const completeDogfoodClientWithPhaseEvidence = (overrides?: {
  boundaryInitial?: PhaseEvidenceOverride;
  boundaryRebase?: PhaseEvidenceOverride;
  spec?: PhaseEvidenceOverride;
  executionPlan?: PhaseEvidenceOverride;
  execution?: PhaseEvidenceOverride;
}): CodexRuntimeSuperpowersDogfoodClient => ({
  importCodexRuntime: vi.fn(async () => ({
    runtime_profile_revision_digests: [digest('a')],
    credential_binding_version_digests: [digest('b')],
  })),
  smokeGenerationWorker: vi.fn(async () => undefined),
  startNoSharedFilesystemRunWorker: vi.fn(async () => undefined),
  seedSourceAndDevelopmentPlanItem: vi.fn(async () => ({
    source_object_id: 'requirement-1',
    development_plan_id: 'development-plan-1',
    development_plan_item_id: 'item-1',
  })),
  completeBoundaryBrainstorming: vi.fn(async (mode: 'initial' | 'rebase') =>
    mode === 'initial'
      ? {
          ...boundaryEvidence,
          ...overrides?.boundaryInitial,
        }
      : {
          ...boundaryRebaseEvidence,
          ...overrides?.boundaryRebase,
        },
  ),
  mutateDevelopmentPlanItem: vi.fn(async () => undefined),
  assertStaleBoundaryBlocksSpecGeneration: vi.fn(async () => ({
    blocked: true,
    blocker_code: 'STALE_BOUNDARY_SUMMARY',
  })),
  generateAndApproveSpec: vi.fn(async () => ({
    ...specEvidence,
    ...overrides?.spec,
  })),
  generateAndApproveExecutionPlan: vi.fn(async () => ({
    ...executionPlanEvidence,
    ...overrides?.executionPlan,
  })),
  startExecution: vi.fn(async () => ({
    ...executionEvidence,
    ...overrides?.execution,
  })),
  writeReport: vi.fn(async () => ({ report_path: fixedReportPath })),
});

type BoundarySessionFixture = {
  id: string;
  status?: 'draft' | 'ai_turn_running' | 'waiting_for_leader' | 'summary_proposed' | 'approved' | 'changes_requested' | 'stale' | 'cancelled';
  questions?: Array<{ id: string; status?: string; required?: boolean; answered_by_answer_id?: string }>;
  latest_summary_revision_id?: string;
  approved_summary_revision_id?: string;
  current_round_runtime_job_id?: string;
};

const boundaryHttpClientConfig = (
  overrides?: Partial<CodexRuntimeSuperpowersDogfoodCliConfig>,
): CodexRuntimeSuperpowersDogfoodCliConfig => ({
  controlPlaneUrl: 'http://control-plane.invalid',
  actorId: 'actor-setup',
  generationRuntimeProfileId: 'profile-generation',
  generationCredentialBindingId: 'binding-generation',
  runExecutionRuntimeProfileId: 'profile-run',
  runExecutionCredentialBindingId: 'binding-run',
  projectId: 'project-1',
  sourceObjectType: 'requirement',
  sourceObjectId: 'requirement-1',
  leaderActorId: 'actor-leader',
  reviewerActorId: 'actor-reviewer',
  repoId: 'repo-1',
  repoLocalPath: '/repo/current',
  repoBaseCommitSha: 'abc123',
  noSharedFilesystem: true,
  skipBootstrap: true,
  remoteRuntimeJobWaitTimeoutMs: 100,
  remoteRuntimeJobPollIntervalMs: 0,
  boundaryMaxAiTurns: 6,
  ...overrides,
});

const createBoundaryStateLoopClient = (input: {
  boundarySessionResponses: BoundarySessionFixture[];
  initialSessionId?: string;
  rebaseSessionId?: string;
  config?: Partial<CodexRuntimeSuperpowersDogfoodCliConfig>;
}) => {
  const requests: Array<{ method: string; path: string; body?: unknown }> = [];
  const workerCalls: string[] = [];
  const boundarySessionResponses = [...input.boundarySessionResponses];
  const lastBoundarySessionResponse = boundarySessionResponses.at(-1);
  const initialSessionId = input.initialSessionId ?? 'boundary-session-1';
  const rebaseSessionId = input.rebaseSessionId ?? 'boundary-session-rebased';
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const parsedUrl = new URL(String(url));
    const path = parsedUrl.pathname;
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' && init.body.length > 0 ? JSON.parse(init.body) : undefined;
    requests.push({ method, path, body });

    if (method === 'POST' && path === '/development-plans') {
      return jsonResponse({ id: 'development-plan-1' });
    }
    if (method === 'POST' && path === '/development-plans/development-plan-1/items') {
      return jsonResponse({ id: 'item-1' });
    }
    if (method === 'POST' && path === '/development-plans/development-plan-1/items/item-1/boundary-brainstorming') {
      return jsonResponse({ id: initialSessionId });
    }
    if (method === 'POST' && path === '/development-plans/development-plan-1/items/item-1/boundary-brainstorming/restart') {
      return jsonResponse({ id: rebaseSessionId });
    }
    if (method === 'GET' && path.startsWith('/boundary-brainstorming-sessions/')) {
      return jsonResponse(boundarySessionResponses.shift() ?? lastBoundarySessionResponse);
    }
    if (method === 'GET' && path.startsWith('/internal/codex-runtime/runtime-jobs/')) {
      const runtimeJobId = decodeURIComponent(path.split('/').pop()!);
      return jsonResponse({
        runtime_job: {
          id: runtimeJobId,
          status: 'terminal',
          terminal_status: 'succeeded',
          terminal_result_json: {
            output_schema_version: 'boundary_round_result.v1',
            runtime_evidence: runtimeAppServerEvidence,
          },
        },
      });
    }
    if (method === 'POST' && path.endsWith('/answers')) {
      const questionId = typeof body?.question_id === 'string' ? body.question_id : 'unknown';
      return jsonResponse({ id: `answer-${questionId}` });
    }
    if (method === 'POST' && path.endsWith('/continue')) {
      return jsonResponse({ id: path.split('/')[2] });
    }
    if (method === 'POST' && path.includes('/summary-revisions/') && path.endsWith('/request-changes')) {
      const revisionId = decodeURIComponent(path.split('/summary-revisions/')[1].split('/')[0]);
      return jsonResponse({ boundary_summary_revision_id: revisionId });
    }
    if (method === 'POST' && path.includes('/summary-revisions/') && path.endsWith('/approve')) {
      const revisionId = decodeURIComponent(path.split('/summary-revisions/')[1].split('/')[0]);
      return jsonResponse({ boundary_summary_revision_id: revisionId });
    }
    throw new Error(`unexpected request ${method} ${path}`);
  });
  const client = createCodexRuntimeSuperpowersDogfoodHttpClient(boundaryHttpClientConfig(input.config), {
    fetchImpl: fetchImpl as unknown as typeof fetch,
    env: {
      FORGELOOP_TRUSTED_ACTOR_HEADER_SECRET: 'test-secret',
      FORGELOOP_AUTOMATION_ACTOR_ID: 'automation-actor',
      FORGELOOP_AUTOMATION_DAEMON_IDENTITY: 'automation-daemon',
    },
    runRemoteWorkerOnce: async (targetKind) => {
      workerCalls.push(targetKind ?? 'generation');
    },
  });

  return { client, requests, workerCalls };
};

describe('Codex runtime Superpowers dogfood script', () => {
  it('orchestrates the strict product loop through central config/auth and no-shared-filesystem execution', async () => {
    const calls: string[] = [];
    const client: CodexRuntimeSuperpowersDogfoodClient = {
      importCodexRuntime: vi.fn(async () => {
        calls.push('importCodexRuntime');
        return {
          runtime_profile_revision_digests: [digest('a'), digest('b')],
          credential_binding_version_digests: [digest('c'), digest('d')],
        };
      }),
      smokeGenerationWorker: vi.fn(async () => {
        calls.push('smokeGenerationWorker');
      }),
      startNoSharedFilesystemRunWorker: vi.fn(async () => {
        calls.push('startNoSharedFilesystemRunWorker');
      }),
      seedSourceAndDevelopmentPlanItem: vi.fn(async () => {
        calls.push('seedSourceAndDevelopmentPlanItem');
        return { source_object_id: 'requirement-1', development_plan_id: 'development-plan-1', development_plan_item_id: 'item-1' };
      }),
      completeBoundaryBrainstorming: vi.fn(async (mode: 'initial' | 'rebase') => {
        calls.push(`completeBoundaryBrainstorming:${mode}`);
        return {
          mode,
          session_id: mode === 'initial' ? 'boundary-session-initial' : 'boundary-session-rebased',
          approved_summary_revision_id:
            mode === 'initial' ? 'boundary-summary-revision-initial' : 'boundary-summary-revision-rebased',
          ai_turn_count: mode === 'initial' ? 3 : 2,
          follow_up_path_covered: mode === 'initial',
          summary_request_change_path_covered: mode === 'initial',
          output_schema_versions: boundaryEvidence.output_schema_versions,
          app_server_evidence_digests:
            mode === 'initial' ? [digest('boundary-initial-app-server')] : [digest('boundary-rebase-app-server')],
          runtime_job_digests:
            mode === 'initial'
              ? [digest('boundary-initial-a'), digest('boundary-initial-b'), digest('boundary-initial-c')]
              : [digest('boundary-rebase-a'), digest('boundary-rebase-b')],
          cleanup_status: 'completed' as const,
        };
      }),
      mutateDevelopmentPlanItem: vi.fn(async () => {
        calls.push('mutateDevelopmentPlanItem');
      }),
      assertStaleBoundaryBlocksSpecGeneration: vi.fn(async () => {
        calls.push('assertStaleBoundaryBlocksSpecGeneration');
        return { blocked: true, blocker_code: 'STALE_BOUNDARY_SUMMARY' };
      }),
      generateAndApproveSpec: vi.fn(async () => {
        calls.push('generateAndApproveSpec');
        return specEvidence;
      }),
      generateAndApproveExecutionPlan: vi.fn(async () => {
        calls.push('generateAndApproveExecutionPlan');
        return executionPlanEvidence;
      }),
      startExecution: vi.fn(async () => {
        calls.push('startExecution');
        return executionEvidence;
      }),
      writeReport: vi.fn(async (report) => {
        calls.push('writeReport');
        return { report_path: report.report_path };
      }),
    };

    const result = await runCodexRuntimeSuperpowersDogfood({ client });

    expect(calls).toEqual([
      'seedSourceAndDevelopmentPlanItem',
      'importCodexRuntime',
      'smokeGenerationWorker',
      'startNoSharedFilesystemRunWorker',
      'completeBoundaryBrainstorming:initial',
      'mutateDevelopmentPlanItem',
      'assertStaleBoundaryBlocksSpecGeneration',
      'completeBoundaryBrainstorming:rebase',
      'generateAndApproveSpec',
      'generateAndApproveExecutionPlan',
      'startExecution',
      'writeReport',
    ]);
    expect(result.report).toMatchObject({
      status: 'PASS',
      development_plan_item_id: 'item-1',
      boundary_brainstorming_session_id: 'boundary-session-rebased',
      boundary_summary_revision_id: 'boundary-summary-revision-rebased',
      spec_revision_id: 'spec-revision-1',
      execution_plan_revision_id: 'execution-plan-revision-1',
      execution_id: 'execution-1',
      no_shared_filesystem_worker: true,
      stale_boundary_negative_check: {
        blocked: true,
        blocker_code: 'STALE_BOUNDARY_SUMMARY',
        rebased_session_id: 'boundary-session-rebased',
        rebased_boundary_summary_revision_id: 'boundary-summary-revision-rebased',
      },
      package_script_command: 'pnpm dogfood:codex-runtime:superpowers',
      codex_app_server_evidence: expect.objectContaining({
        mode: 'dockerized_app_server',
        output_schema_versions: expect.arrayContaining([
          'boundary_round_result.v1',
          'spec_revision.v1',
          'execution_plan_revision.v1',
          'codex_run_execution_result.v1',
        ]),
      }),
      boundary_ai_turn_count: 5,
      boundary_follow_up_path_covered: true,
      boundary_summary_request_change_path_covered: true,
      cleanup_status: 'completed',
      changed_files: [fixedReportPath],
      report_path: fixedReportPath,
    });
    expect(result.reportPath).toBe(fixedReportPath);
  });

  it('renders a public-safe report with product object names and digests only', () => {
    const markdown = renderCodexRuntimeSuperpowersDogfoodReport(safeReport());

    expect(codexRuntimeSuperpowersDogfoodCommand).toBe(
      'tsx --tsconfig apps/control-plane-api/tsconfig.json scripts/codex-runtime-superpowers-dogfood.ts',
    );
    expect(markdown).toContain('Codex Runtime Superpowers Dogfood');
    expect(markdown).toContain('Command: pnpm dogfood:codex-runtime:superpowers');
    expect(markdown).toContain('Development Plan Item: item-1');
    expect(markdown).toContain('Boundary Brainstorming Session: boundary-session-1');
    expect(markdown).toContain('Codex app-server mode: dockerized_app_server');
    expect(markdown).toContain('Codex output schemas: boundary_round_result.v1, spec_revision.v1, execution_plan_revision.v1, codex_run_execution_result.v1');
    expect(markdown).toContain('Phase boundary_initial: expected_schema=boundary_round_result.v1 observed_schemas=boundary_round_result.v1');
    expect(markdown).toContain('Phase spec: expected_schema=spec_revision.v1 observed_schemas=spec_revision.v1');
    expect(markdown).toContain('Boundary AI turns: 4');
    expect(markdown).toContain('Follow-up path covered: true');
    expect(markdown).toContain('Summary request-change path covered: true');
    expect(markdown).toContain('Cleanup status: completed');
    expect(markdown).toContain(`Report path: ${fixedReportPath}`);
    expect(markdown).toContain(`workspace_bundle_digest=${digest('c')}`);
    expect(markdown).toContain(`mounted_task_workspace_digest=${digest('d')}`);
    expect(markdown).not.toContain('/Users/');
    expect(markdown).not.toContain('/tmp/');
    expect(markdown).not.toContain('~/.codex');
    expect(markdown).not.toContain('OPENAI_API_KEY');
    expect(markdown).not.toContain('docker-exec:');
    expect(markdown).not.toContain('localhost');
    expect(markdown).not.toContain('container');
  });

  it('rejects unsafe public report values and path-traversal report filenames', async () => {
    const report = safeReport();

    expect(() =>
      renderCodexRuntimeSuperpowersDogfoodReport({
        ...report,
        changed_files: ['/home/runner/.codex/auth.json', 'http://127.0.0.1:3000/internal', 'Bearer secret'],
      }),
    ).toThrow(/codex_runtime_superpowers_dogfood_report_unsafe/);

    expect(() =>
      renderCodexRuntimeSuperpowersDogfoodReport({
        ...report,
        runtime_profile_revision_digests: ['runtime-profile-revision-1'],
      }),
    ).toThrow(/codex_runtime_superpowers_dogfood_report_unsafe/);

    expect(() =>
      renderCodexRuntimeSuperpowersDogfoodReport({
        ...report,
        credential_binding_version_digests: ['sha256:not-a-real-digest'],
      }),
    ).toThrow(/codex_runtime_superpowers_dogfood_report_unsafe/);

    expect(() =>
      renderCodexRuntimeSuperpowersDogfoodReport({
        ...report,
        workspace_bundle_digest: 'workspace-bundle-1',
      }),
    ).toThrow(/codex_runtime_superpowers_dogfood_report_unsafe/);

    expect(() =>
      renderCodexRuntimeSuperpowersDogfoodReport({
        ...report,
        mounted_task_workspace_digest: 'sha256:not-a-real-digest',
      }),
    ).toThrow(/codex_runtime_superpowers_dogfood_report_unsafe/);

    expect(() =>
      renderCodexRuntimeSuperpowersDogfoodReport({
        ...report,
        codex_app_server_evidence: {
          ...report.codex_app_server_evidence,
          runtime_job_digests: [],
        },
      }),
    ).toThrow(/codex_runtime_superpowers_dogfood_report_unsafe/);

    expect(() =>
      renderCodexRuntimeSuperpowersDogfoodReport({
        ...report,
        codex_app_server_evidence: {
          ...report.codex_app_server_evidence,
          app_server_evidence_digests: [],
        },
      }),
    ).toThrow(/codex_runtime_superpowers_dogfood_report_unsafe/);

    expect(() =>
      renderCodexRuntimeSuperpowersDogfoodReport({
        ...report,
        codex_app_server_evidence: {
          ...report.codex_app_server_evidence,
          runtime_job_digests: ['http://127.0.0.1:1234'],
        },
      }),
    ).toThrow(/codex_runtime_superpowers_dogfood_report_unsafe/);

    expect(() =>
      renderCodexRuntimeSuperpowersDogfoodReport({
        ...report,
        codex_app_server_evidence: {
          ...report.codex_app_server_evidence,
          runtime_job_digests: ['/tmp/runtime-job-1'],
        },
      }),
    ).toThrow(/codex_runtime_superpowers_dogfood_report_unsafe/);

    expect(() =>
      renderCodexRuntimeSuperpowersDogfoodReport({
        ...report,
        codex_app_server_evidence: {
          ...report.codex_app_server_evidence,
          app_server_evidence_digests: ['container-123'],
        },
      }),
    ).toThrow(/codex_runtime_superpowers_dogfood_report_unsafe/);

    expect(() =>
      renderCodexRuntimeSuperpowersDogfoodReport({
        ...report,
        codex_app_server_evidence: {
          ...report.codex_app_server_evidence,
          phases: [
            {
              ...report.codex_app_server_evidence.phases[0],
              runtime_job_digests: [],
            },
          ],
        },
      }),
    ).toThrow(/codex_runtime_superpowers_dogfood_report_unsafe/);

    expect(() =>
      renderCodexRuntimeSuperpowersDogfoodReport({
        ...report,
        codex_app_server_evidence: {
          ...report.codex_app_server_evidence,
          phases: [
            {
              ...report.codex_app_server_evidence.phases[0],
              app_server_evidence_digests: [],
            },
          ],
        },
      }),
    ).toThrow(/codex_runtime_superpowers_dogfood_report_unsafe/);

    const tempRoot = mkdtempSync(join(tmpdir(), 'forgeloop-dogfood-report-'));
    try {
      await expect(
        new FilesystemCodexRuntimeSuperpowersDogfoodReporter(tempRoot).write(
          { ...report, execution_id: '../outside' },
          renderCodexRuntimeSuperpowersDogfoodReport(report),
        ),
      ).rejects.toThrow(/execution_id_invalid/);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('blocks PASS orchestration when phase methods lack observed runtime evidence', async () => {
    const emptyEvidence = {
      output_schema_versions: [],
      runtime_job_digests: [],
      app_server_evidence_digests: [],
      cleanup_status: 'completed' as const,
    };
    const client: CodexRuntimeSuperpowersDogfoodClient = {
      importCodexRuntime: vi.fn(async () => ({
        runtime_profile_revision_digests: [digest('a')],
        credential_binding_version_digests: [digest('b')],
      })),
      smokeGenerationWorker: vi.fn(async () => undefined),
      startNoSharedFilesystemRunWorker: vi.fn(async () => undefined),
      seedSourceAndDevelopmentPlanItem: vi.fn(async () => ({
        source_object_id: 'requirement-1',
        development_plan_id: 'development-plan-1',
        development_plan_item_id: 'item-1',
      })),
      completeBoundaryBrainstorming: vi.fn(async (mode: 'initial' | 'rebase') => ({
        mode,
        session_id: mode === 'initial' ? 'boundary-session-initial' : 'boundary-session-rebased',
        approved_summary_revision_id:
          mode === 'initial' ? 'boundary-summary-revision-initial' : 'boundary-summary-revision-rebased',
        ai_turn_count: mode === 'initial' ? 3 : 2,
        follow_up_path_covered: mode === 'initial',
        summary_request_change_path_covered: mode === 'initial',
        ...emptyEvidence,
      })),
      mutateDevelopmentPlanItem: vi.fn(async () => undefined),
      assertStaleBoundaryBlocksSpecGeneration: vi.fn(async () => ({
        blocked: true,
        blocker_code: 'STALE_BOUNDARY_SUMMARY',
      })),
      generateAndApproveSpec: vi.fn(async () => ({
        spec_revision_id: 'spec-revision-1',
        output_schema_versions: ['spec_revision.v1'],
        runtime_job_digests: [],
        app_server_evidence_digests: [],
        cleanup_status: 'completed' as const,
      })),
      generateAndApproveExecutionPlan: vi.fn(async () => ({
        execution_plan_revision_id: 'execution-plan-revision-1',
        output_schema_versions: ['execution_plan_revision.v1'],
        runtime_job_digests: [],
        app_server_evidence_digests: [],
        cleanup_status: 'completed' as const,
      })),
      startExecution: vi.fn(async () => ({
        execution_id: 'execution-1',
        workspace_bundle_digest: digest('workspace-bundle'),
        mounted_task_workspace_digest: digest('mounted-task-workspace'),
        changed_files: [fixedReportPath],
        output_schema_versions: ['codex_run_execution_result.v1'],
        runtime_job_digests: [],
        app_server_evidence_digests: [],
        cleanup_status: 'completed' as const,
      })),
      writeReport: vi.fn(async () => ({ report_path: fixedReportPath })),
    };

    await expect(runCodexRuntimeSuperpowersDogfood({ client })).rejects.toMatchObject({
      blockerCode: 'codex_runtime_superpowers_app_server_phase_evidence_missing',
    });
    expect(client.writeReport).not.toHaveBeenCalled();
  });

  it('blocks app-server evidence derivation when required phase evidence is absent or incomplete', () => {
    expect(() =>
      deriveCodexAppServerEvidence(
        collectCodexAppServerPhaseEvidence({
          boundary: [{ ...boundaryEvidence, app_server_evidence_digests: [] }, boundaryRebaseEvidence],
          spec: { ...specEvidence, app_server_evidence_digests: [] },
          executionPlan: { ...executionPlanEvidence, app_server_evidence_digests: [] },
          execution: { ...executionEvidence, app_server_evidence_digests: [] },
        }),
      ),
    ).toThrow(/codex_runtime_superpowers_app_server_phase_evidence_missing/);

    expect(() =>
      deriveCodexAppServerEvidence(
        collectCodexAppServerPhaseEvidence({
          boundary: [
            boundaryEvidence,
            {
              ...boundaryEvidence,
              mode: 'rebase' as const,
              session_id: 'boundary-session-rebased',
              approved_summary_revision_id: 'boundary-summary-revision-rebased',
              runtime_job_digests: [],
            },
          ],
          spec: specEvidence,
          executionPlan: executionPlanEvidence,
          execution: executionEvidence,
        }),
      ),
    ).toThrow(/codex_runtime_superpowers_app_server_phase_evidence_missing/);

    expect(() =>
      deriveCodexAppServerEvidence(
        collectCodexAppServerPhaseEvidence({
          boundary: [
            boundaryEvidence,
            {
              ...boundaryEvidence,
              mode: 'rebase' as const,
              session_id: 'boundary-session-rebased',
              approved_summary_revision_id: 'boundary-summary-revision-rebased',
            },
          ],
          spec: { ...specEvidence, cleanup_status: 'blocked' },
          executionPlan: executionPlanEvidence,
          execution: executionEvidence,
        }),
      ),
    ).toThrow(/codex_runtime_superpowers_app_server_phase_evidence_missing/);
  });

  it('blocks PASS orchestration when Boundary follow-up coverage is missing across initial and rebase', async () => {
    const client = completeDogfoodClientWithPhaseEvidence({
      boundaryInitial: {
        follow_up_path_covered: false,
      },
    });

    await expect(runCodexRuntimeSuperpowersDogfood({ client })).rejects.toMatchObject({
      blockerCode: 'codex_runtime_superpowers_boundary_coverage_missing',
    });
    expect(client.writeReport).not.toHaveBeenCalled();
  });

  it('blocks PASS orchestration when Boundary coverage evidence has malformed runtime types', async () => {
    const client = completeDogfoodClientWithPhaseEvidence({
      boundaryInitial: {
        ai_turn_count: '3',
        follow_up_path_covered: 'true',
        summary_request_change_path_covered: 'true',
      } as unknown as PhaseEvidenceOverride,
    });

    await expect(runCodexRuntimeSuperpowersDogfood({ client })).rejects.toMatchObject({
      blockerCode: 'codex_runtime_superpowers_boundary_coverage_evidence_missing',
    });
    expect(client.writeReport).not.toHaveBeenCalled();
  });

  it('blocks PASS orchestration when Boundary summary request-change coverage is missing across initial and rebase', async () => {
    const client = completeDogfoodClientWithPhaseEvidence({
      boundaryInitial: {
        follow_up_path_covered: true,
        summary_request_change_path_covered: false,
      },
      boundaryRebase: {
        follow_up_path_covered: true,
        summary_request_change_path_covered: false,
      },
    });

    await expect(runCodexRuntimeSuperpowersDogfood({ client })).rejects.toMatchObject({
      blockerCode: 'codex_runtime_superpowers_boundary_coverage_missing',
    });
    expect(client.writeReport).not.toHaveBeenCalled();
  });

  it('blocks PASS orchestration when observed schemas do not prove the expected phase schema', async () => {
    const client = completeDogfoodClientWithPhaseEvidence({
      boundaryInitial: {
        output_schema_versions: ['unexpected_schema.v1'],
      },
      boundaryRebase: {
        output_schema_versions: ['unexpected_schema.v1'],
      },
    });

    await expect(runCodexRuntimeSuperpowersDogfood({ client })).rejects.toMatchObject({
      blockerCode: 'codex_runtime_superpowers_app_server_phase_evidence_missing',
    });
    expect(client.writeReport).not.toHaveBeenCalled();
  });

  it('blocks PASS orchestration when a phase has no observed schema versions', async () => {
    const client = completeDogfoodClientWithPhaseEvidence({
      boundaryInitial: {
        output_schema_versions: [],
      },
      boundaryRebase: {
        output_schema_versions: [],
      },
    });

    await expect(runCodexRuntimeSuperpowersDogfood({ client })).rejects.toMatchObject({
      blockerCode: 'codex_runtime_superpowers_app_server_phase_evidence_missing',
    });
    expect(client.writeReport).not.toHaveBeenCalled();
  });

  it('blocks PASS orchestration when a phase cleanup did not complete', async () => {
    const client = completeDogfoodClientWithPhaseEvidence({
      spec: {
        cleanup_status: 'blocked',
      },
    });

    await expect(runCodexRuntimeSuperpowersDogfood({ client })).rejects.toMatchObject({
      blockerCode: 'codex_runtime_superpowers_app_server_phase_evidence_missing',
    });
    expect(client.writeReport).not.toHaveBeenCalled();
  });

  it('reports a public-safe strict blocker instead of using a non-executable placeholder client', () => {
    expect(() => loadCodexRuntimeSuperpowersDogfoodCliConfig({})).toThrow(CodexRuntimeSuperpowersDogfoodBlocker);

    const markdown = renderCodexRuntimeSuperpowersDogfoodBlockerReport({
      status: 'BLOCKED',
      blocker_code: 'codex_runtime_superpowers_dogfood_config_missing',
      missing_env: ['FORGELOOP_CONTROL_PLANE_URL', 'FORGELOOP_CODEX_RUNTIME_SETUP_ACTOR_ID'],
    });

    expect(markdown).toContain('Codex Runtime Superpowers Dogfood');
    expect(markdown).toContain('Status: BLOCKED');
    expect(markdown).toContain('codex_runtime_superpowers_dogfood_config_missing');
    expect(markdown).not.toContain('/Users/');
    expect(markdown).not.toContain('/tmp/');
    expect(markdown).not.toContain('~/.codex');
    expect(markdown).not.toContain('OPENAI_API_KEY');
    expect(markdown).not.toContain('docker-exec:');
  });

  it('renders public-safe phase details in app-server phase-evidence blocker reports', () => {
    const markdown = renderCodexRuntimeSuperpowersDogfoodBlockerReport({
      status: 'BLOCKED',
      blocker_code: 'codex_runtime_superpowers_app_server_phase_evidence_missing',
      cleanup_status: 'blocked',
      codex_app_server_evidence: {
        phases: [
          {
            ...codexAppServerEvidence.phases[0],
            cleanup_status: 'blocked',
          },
          codexAppServerEvidence.phases[2],
        ],
      },
    });

    expect(markdown).toContain(
      `Phase boundary_initial: expected_schema=boundary_round_result.v1 observed_schemas=boundary_round_result.v1 cleanup=blocked runtime_jobs=${digest('boundary-a')} app_server=${digest('boundary-app-server-a')}`,
    );
    expect(markdown).toContain(
      `Phase spec: expected_schema=spec_revision.v1 observed_schemas=spec_revision.v1 cleanup=completed runtime_jobs=${digest('spec-a')} app_server=${digest('spec-app-server-a')}`,
    );
    expect(markdown).toContain('Cleanup status: blocked');
    expect(markdown).not.toContain('/Users/');
    expect(markdown).not.toContain('/tmp/');
    expect(markdown).not.toContain('~/.codex');
    expect(markdown).not.toContain('OPENAI_API_KEY');
    expect(markdown).not.toContain('docker-exec:');
    expect(markdown).not.toContain('localhost');
    expect(markdown).not.toContain('container');
  });

  it('rejects unsafe phase details in app-server phase-evidence blocker reports', () => {
    expect(() =>
      renderCodexRuntimeSuperpowersDogfoodBlockerReport({
        status: 'BLOCKED',
        blocker_code: 'codex_runtime_superpowers_app_server_phase_evidence_missing',
        cleanup_status: 'completed',
        codex_app_server_evidence: {
          phases: [
            {
              ...codexAppServerEvidence.phases[0],
              runtime_job_digests: ['/tmp/runtime-job-1'],
            },
          ],
        },
      }),
    ).toThrow(/codex_runtime_superpowers_dogfood_report_unsafe/);

    expect(() =>
      renderCodexRuntimeSuperpowersDogfoodBlockerReport({
        status: 'BLOCKED',
        blocker_code: 'codex_runtime_superpowers_app_server_phase_evidence_missing',
        cleanup_status: 'completed',
        codex_app_server_evidence: {
          phases: [
            {
              ...codexAppServerEvidence.phases[0],
              app_server_evidence_digests: ['container-123'],
            },
          ],
        },
      }),
    ).toThrow(/codex_runtime_superpowers_dogfood_report_unsafe/);

    expect(() =>
      renderCodexRuntimeSuperpowersDogfoodBlockerReport({
        status: 'BLOCKED',
        blocker_code: 'codex_runtime_superpowers_app_server_phase_evidence_missing',
        cleanup_status: 'completed',
        codex_app_server_evidence: {
          phases: [
            {
              ...codexAppServerEvidence.phases[0],
              cleanup_status: 'deleted' as 'completed',
            },
          ],
        },
      }),
    ).toThrow(/codex_runtime_superpowers_dogfood_report_unsafe/);
  });

  it('does not require pre-known Boundary summary revision ids in CLI config', () => {
    const config = loadCodexRuntimeSuperpowersDogfoodCliConfig({
      FORGELOOP_CONTROL_PLANE_URL: 'http://control-plane.invalid',
      FORGELOOP_CODEX_RUNTIME_SETUP_ACTOR_ID: 'actor-setup',
      FORGELOOP_CODEX_GENERATION_RUNTIME_PROFILE_ID: 'profile-generation',
      FORGELOOP_CODEX_GENERATION_CREDENTIAL_BINDING_ID: 'binding-generation',
      FORGELOOP_CODEX_RUN_EXECUTION_RUNTIME_PROFILE_ID: 'profile-run',
      FORGELOOP_CODEX_RUN_EXECUTION_CREDENTIAL_BINDING_ID: 'binding-run',
      FORGELOOP_CODEX_DOGFOOD_PROJECT_ID: 'project-1',
      FORGELOOP_CODEX_DOGFOOD_REPO_ID: 'repo-1',
      FORGELOOP_CODEX_DOGFOOD_REPO_PATH: '/repo/current',
      FORGELOOP_CODEX_DOGFOOD_REPO_BASE_COMMIT_SHA: 'abc123',
      FORGELOOP_CODEX_DOGFOOD_SOURCE_OBJECT_ID: 'requirement-1',
      FORGELOOP_CODEX_NO_SHARED_FILESYSTEM: '1',
    });

    expect(config.boundarySummaryRevisionId).toBeUndefined();
    expect(config.repoId).toBe('repo-1');
    expect(config.repoLocalPath).toBe('/repo/current');
    expect(config.repoBaseCommitSha).toBe('abc123');
  });

  it('loads bounded Boundary dogfood loop settings from env', () => {
    const config = loadCodexRuntimeSuperpowersDogfoodCliConfig({
      FORGELOOP_CONTROL_PLANE_URL: 'http://control-plane.invalid',
      FORGELOOP_CODEX_RUNTIME_SETUP_ACTOR_ID: 'actor-setup',
      FORGELOOP_CODEX_DOGFOOD_PROJECT_ID: 'project-1',
      FORGELOOP_CODEX_DOGFOOD_SOURCE_OBJECT_ID: 'requirement-1',
      FORGELOOP_CODEX_NO_SHARED_FILESYSTEM: '1',
      FORGELOOP_CODEX_DOGFOOD_BOUNDARY_MAX_AI_TURNS: '6',
    });

    expect(config.boundaryMaxAiTurns).toBe(6);
  });

  it('defaults the bounded Boundary dogfood loop to 8 AI turns', () => {
    const config = loadCodexRuntimeSuperpowersDogfoodCliConfig({
      FORGELOOP_CONTROL_PLANE_URL: 'http://control-plane.invalid',
      FORGELOOP_CODEX_RUNTIME_SETUP_ACTOR_ID: 'actor-setup',
      FORGELOOP_CODEX_DOGFOOD_PROJECT_ID: 'project-1',
      FORGELOOP_CODEX_DOGFOOD_SOURCE_OBJECT_ID: 'requirement-1',
      FORGELOOP_CODEX_NO_SHARED_FILESYSTEM: '1',
    });

    expect(config.boundaryMaxAiTurns).toBe(8);
  });

  it('rejects a zero Boundary dogfood loop max AI turn setting', () => {
    expect(() =>
      loadCodexRuntimeSuperpowersDogfoodCliConfig({
        FORGELOOP_CONTROL_PLANE_URL: 'http://control-plane.invalid',
        FORGELOOP_CODEX_RUNTIME_SETUP_ACTOR_ID: 'actor-setup',
        FORGELOOP_CODEX_DOGFOOD_PROJECT_ID: 'project-1',
        FORGELOOP_CODEX_DOGFOOD_SOURCE_OBJECT_ID: 'requirement-1',
        FORGELOOP_CODEX_NO_SHARED_FILESYSTEM: '1',
        FORGELOOP_CODEX_DOGFOOD_BOUNDARY_MAX_AI_TURNS: '0',
      }),
    ).toThrow(/FORGELOOP_CODEX_DOGFOOD_BOUNDARY_MAX_AI_TURNS_must_be_positive_integer/);
  });

  it('defaults the dogfood repo base commit to the current repository HEAD', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'forgeloop-dogfood-base-'));
    const previousCwd = process.cwd();
    try {
      execFileSync('git', ['init'], { cwd: tempDir });
      writeFileSync(join(tempDir, 'README.md'), '# Dogfood repo\n');
      execFileSync('git', ['add', 'README.md'], { cwd: tempDir });
      execFileSync('git', ['-c', 'user.name=Dogfood Test', '-c', 'user.email=dogfood@example.test', 'commit', '-m', 'initial'], {
        cwd: tempDir,
      });
      const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: tempDir, encoding: 'utf8' }).trim();

      process.chdir(tempDir);
      const config = loadCodexRuntimeSuperpowersDogfoodCliConfig({
        FORGELOOP_CONTROL_PLANE_URL: 'http://control-plane.invalid',
        FORGELOOP_CODEX_RUNTIME_SETUP_ACTOR_ID: 'actor-setup',
        FORGELOOP_CODEX_DOGFOOD_PROJECT_ID: 'project-1',
        FORGELOOP_CODEX_DOGFOOD_REPO_ID: 'repo-1',
        FORGELOOP_CODEX_DOGFOOD_SOURCE_OBJECT_ID: 'requirement-1',
        FORGELOOP_CODEX_NO_SHARED_FILESYSTEM: '1',
      });

      expect(realpathSync(config.repoLocalPath!)).toBe(realpathSync(tempDir));
      expect(config.repoBaseCommitSha).toBe(head);
      expect(config.repoBaseCommitSha).toMatch(/^[0-9a-f]{40}$/);
    } finally {
      process.chdir(previousCwd);
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('auto-seeds the product source before runtime bootstrap in strict dogfood mode', async () => {
    const requests: Array<{ method: string; path: string; body?: unknown }> = [];
    const bootstrapPatches: Array<Record<string, string | undefined> | undefined> = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const parsedUrl = new URL(String(url));
      const path = parsedUrl.pathname;
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      requests.push({ method, path, body });

      if (method === 'POST' && path === '/projects') {
        return jsonResponse({ id: 'project-created' });
      }
      if (method === 'POST' && path === '/projects/project-created/repos') {
        return jsonResponse({ id: 'project-repo-1' });
      }
      if (method === 'POST' && path === '/source-objects/requirement') {
        return jsonResponse({ id: 'work-item-created' });
      }
      if (method === 'POST' && path === '/development-plans') {
        return jsonResponse({ id: 'development-plan-1' });
      }
      if (method === 'POST' && path === '/development-plans/development-plan-1/items') {
        return jsonResponse({ id: 'item-1' });
      }
      throw new Error(`unexpected request ${method} ${path}`);
    });
    const client = createCodexRuntimeSuperpowersDogfoodHttpClient(
      {
        controlPlaneUrl: 'http://control-plane.invalid',
        actorId: 'actor-setup',
        projectId: 'project-placeholder',
        sourceObjectType: 'requirement',
        sourceObjectId: 'source-placeholder',
        leaderActorId: 'actor-leader',
        reviewerActorId: 'actor-reviewer',
        repoId: 'repo-1',
        repoLocalPath: '/repo/current',
        repoBaseCommitSha: 'abc123',
        noSharedFilesystem: true,
        skipBootstrap: false,
        autoSeedProductSource: true,
      },
      {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        runBootstrapImport: async (patch) => {
          bootstrapPatches.push(patch);
          return {
            generation_runtime_profile_id: 'profile-generation',
            generation_runtime_profile_revision_id: 'profile-generation-revision',
            generation_credential_binding_id: 'binding-generation',
            run_execution_runtime_profile_id: 'profile-run',
            run_execution_runtime_profile_revision_id: 'profile-run-revision',
            run_execution_credential_binding_id: 'binding-run',
          };
        },
      },
    );

    await expect(client.seedSourceAndDevelopmentPlanItem()).resolves.toEqual({
      source_object_id: 'work-item-created',
      development_plan_id: 'development-plan-1',
      development_plan_item_id: 'item-1',
    });
    await client.importCodexRuntime();

    expect(requests.map((request) => `${request.method} ${request.path}`)).toEqual([
      'POST /projects',
      'POST /projects/project-created/repos',
      'POST /source-objects/requirement',
      'POST /development-plans',
      'POST /development-plans/development-plan-1/items',
    ]);
    expect(bootstrapPatches[0]).toMatchObject({
      FORGELOOP_CODEX_DOGFOOD_PROJECT_ID: 'project-created',
      FORGELOOP_CODEX_ALLOWED_SCOPE_PROJECT_ID: 'project-created',
      FORGELOOP_CODEX_DOGFOOD_REPO_ID: 'repo-1',
      FORGELOOP_CODEX_ALLOWED_SCOPE_REPO_ID: 'repo-1',
      FORGELOOP_CODEX_DOGFOOD_SOURCE_OBJECT_ID: 'work-item-created',
    });
  });

  it('reports public-safe product API status and reason when a dogfood API call fails', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        {
          code: 'path_policy_docs_allowlist_required',
          message: 'Docs-only dogfood execution requires docs/** in the approved Execution Plan allowed_paths.',
          error: 'Bad Request',
          statusCode: 400,
        },
        400,
      ),
    );
    const client = createCodexRuntimeSuperpowersDogfoodHttpClient(
      {
        controlPlaneUrl: 'http://control-plane.invalid',
        actorId: 'actor-setup',
        generationRuntimeProfileId: 'profile-generation',
        generationCredentialBindingId: 'binding-generation',
        runExecutionRuntimeProfileId: 'profile-run',
        runExecutionCredentialBindingId: 'binding-run',
        projectId: 'project-1',
        sourceObjectType: 'requirement',
        sourceObjectId: 'requirement-1',
        leaderActorId: 'actor-leader',
        reviewerActorId: 'actor-reviewer',
        noSharedFilesystem: true,
        skipBootstrap: true,
      },
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );

    await expect(client.seedSourceAndDevelopmentPlanItem()).rejects.toMatchObject({
      blockerCode: 'codex_runtime_superpowers_product_api_unavailable',
      report: {
        product_api_status: 400,
        product_api_reason: 'path_policy_docs_allowlist_required',
      },
    });

    const markdown = renderCodexRuntimeSuperpowersDogfoodBlockerReport({
      status: 'BLOCKED',
      blocker_code: 'codex_runtime_superpowers_product_api_unavailable',
      product_api_status: 400,
      product_api_reason: 'path_policy_docs_allowlist_required',
    });
    expect(markdown).toContain('Product API status: 400');
    expect(markdown).toContain('Product API reason: path_policy_docs_allowlist_required');
    expect(markdown).not.toContain('DevelopmentPlanItem development-plan-item-1');
  });

  it('sanitizes import-only host Codex env before invoking no-shared remote workers', () => {
    const baseEnv = {
      FORGELOOP_CONTROL_PLANE_URL: 'http://control-plane.invalid',
      FORGELOOP_CODEX_NO_SHARED_FILESYSTEM: '1',
      FORGELOOP_WORKER_IDENTITY: 'codex-worker',
      FORGELOOP_CODEX_DOGFOOD_PROJECT_ID: 'project-1',
      FORGELOOP_CODEX_DOGFOOD_REPO_ID: 'repo-1',
      FORGELOOP_CODEX_CONFIG_TOML_PATH: '/Users/dev/.codex/config.toml',
      FORGELOOP_CODEX_AUTH_JSON_PATH: '/Users/dev/.codex/auth.json',
      FORGELOOP_CODEX_HOME: '/Users/dev/.codex',
      CODEX_HOME: '/Users/dev/.codex',
      FORGELOOP_AUTOMATION_ALLOWED_REPO_ROOTS: '/Users/dev/repo',
    };
    const sanitized = sanitizeCodexRemoteWorkerDogfoodEnv(baseEnv);

    expect(sanitized).toMatchObject({
      FORGELOOP_CONTROL_PLANE_URL: 'http://control-plane.invalid',
      FORGELOOP_CODEX_NO_SHARED_FILESYSTEM: '1',
      FORGELOOP_WORKER_IDENTITY: 'codex-worker-generation',
      FORGELOOP_CODEX_WORKER_ID: 'codex-worker-generation',
      FORGELOOP_CODEX_WORKER_CAPABILITIES: 'generation',
      FORGELOOP_CODEX_WORKER_SCOPES_JSON: JSON.stringify([{ project_id: 'project-1' }]),
    });
    expect(sanitized.FORGELOOP_CODEX_CONFIG_TOML_PATH).toBeUndefined();
    expect(sanitized.FORGELOOP_CODEX_AUTH_JSON_PATH).toBeUndefined();
    expect(sanitized.FORGELOOP_CODEX_HOME).toBeUndefined();
    expect(sanitized.CODEX_HOME).toBeUndefined();
    expect(sanitized.FORGELOOP_AUTOMATION_ALLOWED_REPO_ROOTS).toBeUndefined();

    const runWorkerEnv = sanitizeCodexRemoteWorkerDogfoodEnv(baseEnv, 'run_execution');
    expect(runWorkerEnv).toMatchObject({
      FORGELOOP_WORKER_IDENTITY: 'codex-worker-run-execution',
      FORGELOOP_CODEX_WORKER_ID: 'codex-worker-run-execution',
      FORGELOOP_CODEX_WORKER_CAPABILITIES: 'run_execution',
      FORGELOOP_CODEX_WORKER_SCOPES_JSON: JSON.stringify([{ project_id: 'project-1', repo_id: 'repo-1' }]),
    });
  });

  it('drives Boundary brainstorming from session state through follow-up and summary revision loops', async () => {
    const requests: Array<{ method: string; path: string; body?: unknown }> = [];
    const workerCalls: string[] = [];
    const runtimeJobIds = ['runtime-job-a', 'runtime-job-b', 'runtime-job-c', 'runtime-job-d'];
    const boundarySessionResponses = [
      {
        id: 'boundary-session-1',
        status: 'ai_turn_running',
        current_round_runtime_job_id: 'runtime-job-a',
        questions: [],
      },
      {
        id: 'boundary-session-1',
        status: 'waiting_for_leader',
        questions: [{ id: 'question-1', status: 'open', required: true }],
      },
      {
        id: 'boundary-session-1',
        status: 'ai_turn_running',
        current_round_runtime_job_id: 'runtime-job-b',
        questions: [{ id: 'question-1', status: 'answered', required: true, answered_by_answer_id: 'answer-1' }],
      },
      {
        id: 'boundary-session-1',
        status: 'waiting_for_leader',
        questions: [
          { id: 'question-1', status: 'answered', required: true, answered_by_answer_id: 'answer-1' },
          { id: 'question-2', status: 'open', required: true },
        ],
      },
      {
        id: 'boundary-session-1',
        status: 'ai_turn_running',
        current_round_runtime_job_id: 'runtime-job-c',
        questions: [
          { id: 'question-1', status: 'answered', required: true, answered_by_answer_id: 'answer-1' },
          { id: 'question-2', status: 'answered', required: true, answered_by_answer_id: 'answer-2' },
        ],
      },
      {
        id: 'boundary-session-1',
        status: 'summary_proposed',
        latest_summary_revision_id: 'summary-1',
        questions: [
          { id: 'question-1', status: 'answered', required: true, answered_by_answer_id: 'answer-1' },
          { id: 'question-2', status: 'answered', required: true, answered_by_answer_id: 'answer-2' },
        ],
      },
      {
        id: 'boundary-session-1',
        status: 'ai_turn_running',
        current_round_runtime_job_id: 'runtime-job-d',
        questions: [
          { id: 'question-1', status: 'answered', required: true, answered_by_answer_id: 'answer-1' },
          { id: 'question-2', status: 'answered', required: true, answered_by_answer_id: 'answer-2' },
        ],
      },
      {
        id: 'boundary-session-1',
        status: 'summary_proposed',
        latest_summary_revision_id: 'summary-2',
        questions: [
          { id: 'question-1', status: 'answered', required: true, answered_by_answer_id: 'answer-1' },
          { id: 'question-2', status: 'answered', required: true, answered_by_answer_id: 'answer-2' },
        ],
      },
    ];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const parsedUrl = new URL(String(url));
      const path = parsedUrl.pathname;
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      requests.push({ method, path, body });

      if (method === 'POST' && path === '/projects') {
        return jsonResponse({ id: 'project-1' });
      }
      if (method === 'POST' && path === '/projects/project-1/repos') {
        return jsonResponse({ id: 'project-repo-1' });
      }
      if (method === 'POST' && path === '/source-objects/requirement') {
        return jsonResponse({ id: 'requirement-1' });
      }
      if (method === 'POST' && path === '/development-plans') {
        return jsonResponse({ id: 'development-plan-1' });
      }
      if (method === 'POST' && path === '/development-plans/development-plan-1/items') {
        return jsonResponse({ id: 'item-1' });
      }
      if (method === 'PATCH' && path === '/development-plans/development-plan-1/items/item-1') {
        return jsonResponse({ id: 'item-1' });
      }
      if (method === 'POST' && path === '/development-plans/development-plan-1/items/item-1/spec-revisions/generate') {
        return jsonResponse({ code: 'stale_boundary_summary_revision' }, 400);
      }
      if (method === 'POST' && path === '/development-plans/development-plan-1/items/item-1/boundary-brainstorming') {
        return jsonResponse({ id: 'boundary-session-1' });
      }
      if (method === 'GET' && path === '/boundary-brainstorming-sessions/boundary-session-1') {
        return jsonResponse(boundarySessionResponses.shift() ?? boundarySessionResponses[boundarySessionResponses.length - 1]);
      }
      if (method === 'GET' && path.startsWith('/internal/codex-runtime/runtime-jobs/')) {
        const runtimeJobId = decodeURIComponent(path.split('/').pop()!);
        return jsonResponse({
          runtime_job: {
            id: runtimeJobId,
            status: 'terminal',
            terminal_status: 'succeeded',
            terminal_result_json: {
              output_schema_version: 'boundary_round_result.v1',
              runtime_evidence: runtimeAppServerEvidence,
            },
          },
        });
      }
      if (method === 'POST' && path === '/boundary-brainstorming-sessions/boundary-session-1/answers') {
        const questionId = typeof body?.question_id === 'string' ? body.question_id : 'unknown';
        return jsonResponse({ id: questionId === 'question-1' ? 'answer-1' : 'answer-2' });
      }
      if (method === 'POST' && path === '/boundary-brainstorming-sessions/boundary-session-1/continue') {
        return jsonResponse({ id: 'boundary-session-1' });
      }
      if (
        method === 'POST' &&
        path === '/boundary-brainstorming-sessions/boundary-session-1/summary-revisions/summary-1/request-changes'
      ) {
        return jsonResponse({ boundary_summary_revision_id: 'summary-1' });
      }
      if (
        method === 'POST' &&
        path === '/boundary-brainstorming-sessions/boundary-session-1/summary-revisions/summary-2/approve'
      ) {
        return jsonResponse({ boundary_summary_revision_id: 'summary-2' });
      }
      throw new Error(`unexpected request ${method} ${path}`);
    });
    const client = createCodexRuntimeSuperpowersDogfoodHttpClient(
      {
        controlPlaneUrl: 'http://control-plane.invalid',
        actorId: 'actor-setup',
        generationRuntimeProfileId: 'profile-generation',
        generationCredentialBindingId: 'binding-generation',
        runExecutionRuntimeProfileId: 'profile-run',
        runExecutionCredentialBindingId: 'binding-run',
        projectId: 'project-1',
        sourceObjectType: 'requirement',
        sourceObjectId: 'requirement-1',
        leaderActorId: 'actor-leader',
        reviewerActorId: 'actor-reviewer',
        repoId: 'repo-1',
        repoLocalPath: '/repo/current',
        repoBaseCommitSha: 'abc123',
        noSharedFilesystem: true,
        skipBootstrap: true,
        remoteRuntimeJobWaitTimeoutMs: 100,
        remoteRuntimeJobPollIntervalMs: 0,
        boundaryMaxAiTurns: 6,
      },
      {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        env: {
          FORGELOOP_TRUSTED_ACTOR_HEADER_SECRET: 'test-secret',
          FORGELOOP_AUTOMATION_ACTOR_ID: 'automation-actor',
          FORGELOOP_AUTOMATION_DAEMON_IDENTITY: 'automation-daemon',
        },
        runRemoteWorkerOnce: async (targetKind) => {
          workerCalls.push(targetKind ?? 'generation');
        },
      },
    );

    await client.seedSourceAndDevelopmentPlanItem();
    const initialBoundary = await client.completeBoundaryBrainstorming('initial');
    expect(initialBoundary).toMatchObject({
      mode: 'initial',
      session_id: 'boundary-session-1',
      approved_summary_revision_id: 'summary-2',
      ai_turn_count: 4,
      follow_up_path_covered: true,
      summary_request_change_path_covered: true,
      runtime_job_digests: runtimeJobIds.map(publicDigest),
      app_server_evidence_digests: [expect.stringMatching(/^sha256:[a-f0-9]{64}$/)],
      cleanup_status: 'completed',
    });
    expect(initialBoundary.output_schema_versions).toEqual(['boundary_round_result.v1']);
    await client.mutateDevelopmentPlanItem();
    await expect(client.assertStaleBoundaryBlocksSpecGeneration()).resolves.toEqual({
      blocked: true,
      blocker_code: 'STALE_BOUNDARY_SUMMARY',
    });

    expect(workerCalls).toEqual(['generation', 'generation', 'generation', 'generation']);
    const requestOrder = requests.map((request) => `${request.method} ${request.path}`);
    const boundaryApproveRequest =
      'POST /boundary-brainstorming-sessions/boundary-session-1/summary-revisions/summary-2/approve';
    const staleItemPatchRequest = 'PATCH /development-plans/development-plan-1/items/item-1';
    const staleSpecGenerateRequest = 'POST /development-plans/development-plan-1/items/item-1/spec-revisions/generate';
    expect(requestOrder).toContain(
      'POST /boundary-brainstorming-sessions/boundary-session-1/summary-revisions/summary-1/request-changes',
    );
    expect(requestOrder).toContain(boundaryApproveRequest);
    expect(requestOrder).toContain(staleItemPatchRequest);
    expect(requestOrder).toContain(staleSpecGenerateRequest);
    expect(requestOrder.indexOf(boundaryApproveRequest)).toBeLessThan(requestOrder.indexOf(staleItemPatchRequest));
    expect(requestOrder.indexOf(staleItemPatchRequest)).toBeLessThan(requestOrder.indexOf(staleSpecGenerateRequest));
    expect(
      requestOrder.filter(
        (request) =>
          request.startsWith('POST /boundary-brainstorming-sessions/boundary-session-1/summary-revisions/') &&
          request.endsWith('/approve'),
      ),
    ).toHaveLength(1);
    expect(
      requestOrder.indexOf(
        'POST /boundary-brainstorming-sessions/boundary-session-1/summary-revisions/summary-1/request-changes',
      ),
    ).toBeLessThan(
      requestOrder.indexOf(
        'POST /boundary-brainstorming-sessions/boundary-session-1/summary-revisions/summary-2/approve',
      ),
    );
    expect(requests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: 'POST',
          path: '/boundary-brainstorming-sessions/boundary-session-1/answers',
          body: expect.objectContaining({ question_id: 'question-1' }),
        }),
        expect.objectContaining({
          method: 'POST',
          path: '/boundary-brainstorming-sessions/boundary-session-1/answers',
          body: expect.objectContaining({ question_id: 'question-2' }),
        }),
        expect.objectContaining({
          method: 'POST',
          path: '/boundary-brainstorming-sessions/boundary-session-1/continue',
        }),
        expect.objectContaining({
          method: 'POST',
          path: '/boundary-brainstorming-sessions/boundary-session-1/summary-revisions/summary-1/request-changes',
        }),
        expect.objectContaining({
          method: 'POST',
          path: '/boundary-brainstorming-sessions/boundary-session-1/summary-revisions/summary-2/approve',
        }),
      ]),
    );
    expect(requests).toEqual(
      expect.arrayContaining(
        runtimeJobIds.map((runtimeJobId) =>
          expect.objectContaining({
            method: 'GET',
            path: `/internal/codex-runtime/runtime-jobs/${runtimeJobId}`,
          }),
        ),
      ),
    );
    expect(requestOrder).toEqual(
      expect.arrayContaining([
        'POST /boundary-brainstorming-sessions/boundary-session-1/answers',
        'POST /boundary-brainstorming-sessions/boundary-session-1/continue',
        'POST /boundary-brainstorming-sessions/boundary-session-1/answers',
        'POST /boundary-brainstorming-sessions/boundary-session-1/continue',
        'POST /boundary-brainstorming-sessions/boundary-session-1/summary-revisions/summary-1/request-changes',
        'POST /boundary-brainstorming-sessions/boundary-session-1/summary-revisions/summary-2/approve',
      ]),
    );
    expect(requestOrder.indexOf('POST /boundary-brainstorming-sessions/boundary-session-1/answers')).toBeLessThan(
      requestOrder.indexOf('POST /boundary-brainstorming-sessions/boundary-session-1/continue'),
    );
    expect(requestOrder.filter((request) => request === 'POST /boundary-brainstorming-sessions/boundary-session-1/answers')).toHaveLength(2);
  });

  it('blocks an already approved initial Boundary summary that skipped the required request-change path', async () => {
    const { client } = createBoundaryStateLoopClient({
      boundarySessionResponses: [
        {
          id: 'boundary-session-1',
          status: 'approved',
          approved_summary_revision_id: 'summary-approved',
          questions: [],
        },
      ],
    });

    await client.seedSourceAndDevelopmentPlanItem();
    await expect(client.completeBoundaryBrainstorming('initial')).rejects.toMatchObject({
      blockerCode: 'codex_runtime_superpowers_boundary_unexpected_state',
    });
  });

  it('rebases Boundary brainstorming through restart and approves the current summary without request changes', async () => {
    const { client, requests } = createBoundaryStateLoopClient({
      boundarySessionResponses: [
        {
          id: 'boundary-session-rebased',
          status: 'summary_proposed',
          latest_summary_revision_id: 'summary-rebased',
          questions: [],
        },
      ],
    });

    await client.seedSourceAndDevelopmentPlanItem();
    const rebasedBoundary = await client.completeBoundaryBrainstorming('rebase');

    expect(rebasedBoundary).toMatchObject({
      mode: 'rebase',
      session_id: 'boundary-session-rebased',
      approved_summary_revision_id: 'summary-rebased',
      ai_turn_count: 0,
      follow_up_path_covered: false,
      summary_request_change_path_covered: false,
      runtime_job_digests: [],
      app_server_evidence_digests: [],
      cleanup_status: 'completed',
    });
    const requestOrder = requests.map((request) => `${request.method} ${request.path}`);
    expect(requestOrder).toContain(
      'POST /development-plans/development-plan-1/items/item-1/boundary-brainstorming/restart',
    );
    expect(requestOrder).not.toContain('POST /development-plans/development-plan-1/items/item-1/boundary-brainstorming');
    expect(requestOrder).toContain(
      'POST /boundary-brainstorming-sessions/boundary-session-rebased/summary-revisions/summary-rebased/approve',
    );
    expect(requestOrder.some((request) => request.endsWith('/request-changes'))).toBe(false);
  });

  it('continues after Boundary changes_requested state and can later approve the revised summary', async () => {
    const { client, requests } = createBoundaryStateLoopClient({
      boundarySessionResponses: [
        {
          id: 'boundary-session-rebased',
          status: 'changes_requested',
          questions: [{ id: 'question-change', status: 'open', required: true }],
        },
        {
          id: 'boundary-session-rebased',
          status: 'summary_proposed',
          latest_summary_revision_id: 'summary-after-change',
          questions: [
            { id: 'question-change', status: 'answered', required: true, answered_by_answer_id: 'answer-question-change' },
          ],
        },
      ],
    });

    await client.seedSourceAndDevelopmentPlanItem();
    const rebasedBoundary = await client.completeBoundaryBrainstorming('rebase');

    expect(rebasedBoundary).toMatchObject({
      mode: 'rebase',
      approved_summary_revision_id: 'summary-after-change',
      follow_up_path_covered: false,
      summary_request_change_path_covered: false,
      app_server_evidence_digests: [],
      cleanup_status: 'completed',
    });
    expect(requests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: 'POST',
          path: '/boundary-brainstorming-sessions/boundary-session-rebased/answers',
          body: expect.objectContaining({ question_id: 'question-change' }),
        }),
        expect.objectContaining({
          method: 'POST',
          path: '/boundary-brainstorming-sessions/boundary-session-rebased/continue',
          body: expect.objectContaining({
            leader_input_markdown: 'Continue after requested Boundary Summary changes and keep the strict dogfood boundary current.',
          }),
        }),
        expect.objectContaining({
          method: 'POST',
          path: '/boundary-brainstorming-sessions/boundary-session-rebased/summary-revisions/summary-after-change/approve',
        }),
      ]),
    );
  });

  it('blocks stale or cancelled Boundary session states as unexpected', async () => {
    for (const status of ['stale', 'cancelled'] as const) {
      const { client } = createBoundaryStateLoopClient({
        boundarySessionResponses: [
          {
            id: `boundary-session-${status}`,
            status,
            questions: [],
          },
        ],
        initialSessionId: `boundary-session-${status}`,
      });

      await client.seedSourceAndDevelopmentPlanItem();
      await expect(client.completeBoundaryBrainstorming('initial')).rejects.toMatchObject({
        blockerCode: 'codex_runtime_superpowers_boundary_unexpected_state',
      });
    }
  });

  it('blocks when Boundary AI turns exceed the configured max', async () => {
    const { client, workerCalls } = createBoundaryStateLoopClient({
      boundarySessionResponses: [
        {
          id: 'boundary-session-1',
          status: 'ai_turn_running',
          current_round_runtime_job_id: 'runtime-job-a',
          questions: [],
        },
        {
          id: 'boundary-session-1',
          status: 'waiting_for_leader',
          questions: [],
        },
        {
          id: 'boundary-session-1',
          status: 'ai_turn_running',
          current_round_runtime_job_id: 'runtime-job-b',
          questions: [],
        },
      ],
      config: {
        boundaryMaxAiTurns: 1,
      },
    });

    await client.seedSourceAndDevelopmentPlanItem();
    await expect(client.completeBoundaryBrainstorming('initial')).rejects.toMatchObject({
      blockerCode: 'codex_runtime_superpowers_boundary_max_turns_exceeded',
    });
    expect(workerCalls).toEqual(['generation']);
  });

  it('blocks when the Boundary state loop exhausts bounded iterations', async () => {
    const { client } = createBoundaryStateLoopClient({
      boundarySessionResponses: [
        {
          id: 'boundary-session-rebased',
          status: 'waiting_for_leader',
          questions: [],
        },
      ],
      config: {
        boundaryMaxAiTurns: 1,
      },
    });

    await client.seedSourceAndDevelopmentPlanItem();
    await expect(client.completeBoundaryBrainstorming('rebase')).rejects.toMatchObject({
      blockerCode: 'codex_runtime_superpowers_boundary_loop_exhausted',
    });
  });

  it('continues Boundary brainstorming from session state when the Boundary question is visible', async () => {
    const requests: Array<{ method: string; path: string; body?: unknown }> = [];
    const workerCalls: string[] = [];
    const boundarySessionResponses = [
      {
        id: 'boundary-session-1',
        status: 'ai_turn_running',
        questions: [],
      },
      {
        id: 'boundary-session-1',
        status: 'waiting_for_leader',
        questions: [{ id: 'question-1', status: 'open', required: true }],
      },
      {
        id: 'boundary-session-1',
        latest_summary_revision_id: 'boundary-summary-revision-1',
        questions: [{ id: 'question-1', status: 'answered', required: true, answered_by_answer_id: 'answer-1' }],
      },
      {
        id: 'boundary-session-1',
        latest_summary_revision_id: 'boundary-summary-revision-1-revised',
        questions: [{ id: 'question-1', status: 'answered', required: true, answered_by_answer_id: 'answer-1' }],
      },
    ];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const parsedUrl = new URL(String(url));
      const path = parsedUrl.pathname;
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      requests.push({ method, path, body });

      if (method === 'POST' && path === '/development-plans') {
        return jsonResponse({ id: 'development-plan-1' });
      }
      if (method === 'POST' && path === '/development-plans/development-plan-1/items') {
        return jsonResponse({ id: 'item-1' });
      }
      if (method === 'POST' && path === '/development-plans/development-plan-1/items/item-1/boundary-brainstorming') {
        return jsonResponse({ id: 'boundary-session-1' });
      }
      if (method === 'GET' && path === '/boundary-brainstorming-sessions/boundary-session-1') {
        return jsonResponse(boundarySessionResponses.shift() ?? boundarySessionResponses[boundarySessionResponses.length - 1]);
      }
      if (method === 'POST' && path === '/boundary-brainstorming-sessions/boundary-session-1/answers') {
        return jsonResponse({ id: 'answer-1' });
      }
      if (method === 'POST' && path === '/boundary-brainstorming-sessions/boundary-session-1/continue') {
        return jsonResponse({ id: 'boundary-session-1' });
      }
      if (method === 'POST' && path === '/boundary-brainstorming-sessions/boundary-session-1/summary-revisions/boundary-summary-revision-1/approve') {
        return jsonResponse({ boundary_summary_revision_id: 'boundary-summary-revision-1' });
      }
      if (
        method === 'POST' &&
        path === '/boundary-brainstorming-sessions/boundary-session-1/summary-revisions/boundary-summary-revision-1/request-changes'
      ) {
        return jsonResponse({ boundary_summary_revision_id: 'boundary-summary-revision-1' });
      }
      if (
        method === 'POST' &&
        path === '/boundary-brainstorming-sessions/boundary-session-1/summary-revisions/boundary-summary-revision-1-revised/approve'
      ) {
        return jsonResponse({ boundary_summary_revision_id: 'boundary-summary-revision-1-revised' });
      }
      throw new Error(`unexpected request ${method} ${path}`);
    });
    const client = createCodexRuntimeSuperpowersDogfoodHttpClient(
      {
        controlPlaneUrl: 'http://control-plane.invalid',
        actorId: 'actor-setup',
        generationRuntimeProfileId: 'profile-generation',
        generationCredentialBindingId: 'binding-generation',
        runExecutionRuntimeProfileId: 'profile-run',
        runExecutionCredentialBindingId: 'binding-run',
        projectId: 'project-1',
        sourceObjectType: 'requirement',
        sourceObjectId: 'requirement-1',
        leaderActorId: 'actor-leader',
        reviewerActorId: 'actor-reviewer',
        noSharedFilesystem: true,
        skipBootstrap: true,
        remoteRuntimeJobWaitTimeoutMs: 100,
        remoteRuntimeJobPollIntervalMs: 0,
      },
      {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        runRemoteWorkerOnce: async (targetKind) => {
          workerCalls.push(targetKind ?? 'generation');
        },
      },
    );

    await client.seedSourceAndDevelopmentPlanItem();
    await client.completeBoundaryBrainstorming('initial');

    expect(workerCalls).toEqual(['generation']);
    expect(requests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: 'POST',
          path: '/boundary-brainstorming-sessions/boundary-session-1/answers',
          body: expect.objectContaining({ question_id: 'question-1' }),
        }),
        expect.objectContaining({
          method: 'POST',
          path: '/boundary-brainstorming-sessions/boundary-session-1/summary-revisions/boundary-summary-revision-1/request-changes',
        }),
      ]),
    );
  });

  it('fails fast when the Boundary generation runtime job terminalizes failed', async () => {
    const requests: Array<{ method: string; path: string; body?: unknown }> = [];
    const workerCalls: string[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const parsedUrl = new URL(String(url));
      const path = parsedUrl.pathname;
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      requests.push({ method, path, body });

      if (method === 'POST' && path === '/development-plans') {
        return jsonResponse({ id: 'development-plan-1' });
      }
      if (method === 'POST' && path === '/development-plans/development-plan-1/items') {
        return jsonResponse({ id: 'item-1' });
      }
      if (method === 'POST' && path === '/development-plans/development-plan-1/items/item-1/boundary-brainstorming') {
        return jsonResponse({ id: 'boundary-session-1' });
      }
      if (method === 'GET' && path === '/boundary-brainstorming-sessions/boundary-session-1') {
        return jsonResponse({
          id: 'boundary-session-1',
          status: 'ai_turn_running',
          questions: [],
          current_round_runtime_job_id: 'runtime-job-1',
        });
      }
      if (method === 'GET' && path === '/internal/codex-runtime/runtime-jobs/runtime-job-1') {
        return jsonResponse({
          runtime_job: {
            id: 'runtime-job-1',
            status: 'terminal',
            terminal_status: 'failed',
            terminal_reason_code: 'generated_output_schema_invalid',
          },
        });
      }
      throw new Error(`unexpected request ${method} ${path}`);
    });
    const client = createCodexRuntimeSuperpowersDogfoodHttpClient(
      {
        controlPlaneUrl: 'http://control-plane.invalid',
        actorId: 'actor-setup',
        generationRuntimeProfileId: 'profile-generation',
        generationCredentialBindingId: 'binding-generation',
        runExecutionRuntimeProfileId: 'profile-run',
        runExecutionCredentialBindingId: 'binding-run',
        projectId: 'project-1',
        sourceObjectType: 'requirement',
        sourceObjectId: 'requirement-1',
        leaderActorId: 'actor-leader',
        reviewerActorId: 'actor-reviewer',
        noSharedFilesystem: true,
        skipBootstrap: true,
        remoteRuntimeJobWaitTimeoutMs: 60_000,
        remoteRuntimeJobPollIntervalMs: 0,
      },
      {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        env: {
          FORGELOOP_TRUSTED_ACTOR_HEADER_SECRET: 'test-secret',
          FORGELOOP_AUTOMATION_ACTOR_ID: 'automation-actor',
          FORGELOOP_AUTOMATION_DAEMON_IDENTITY: 'automation-daemon',
        },
        runRemoteWorkerOnce: async (targetKind) => {
          workerCalls.push(targetKind ?? 'generation');
        },
      },
    );

    await client.seedSourceAndDevelopmentPlanItem();
    await expect(client.completeBoundaryBrainstorming('initial')).rejects.toMatchObject({
      blockerCode: 'codex_runtime_superpowers_runtime_job_failed',
      report: {
        runtime_job_id: 'runtime-job-1',
        runtime_job_terminal_status: 'failed',
        runtime_job_reason_code: 'generated_output_schema_invalid',
      },
    });

    expect(workerCalls).toEqual(['generation']);
    expect(requests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: 'GET',
          path: '/internal/codex-runtime/runtime-jobs/runtime-job-1',
        }),
      ]),
    );
  });

  it('times out when a remote worker invocation does not settle', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const parsedUrl = new URL(String(url));
      const path = parsedUrl.pathname;
      const method = init?.method ?? 'GET';

      if (method === 'POST' && path === '/development-plans') {
        return jsonResponse({ id: 'development-plan-1' });
      }
      if (method === 'POST' && path === '/development-plans/development-plan-1/items') {
        return jsonResponse({ id: 'item-1' });
      }
      if (method === 'POST' && path === '/development-plans/development-plan-1/items/item-1/boundary-brainstorming') {
        return jsonResponse({ id: 'boundary-session-1' });
      }
      if (method === 'GET' && path === '/boundary-brainstorming-sessions/boundary-session-1') {
        return jsonResponse({
          id: 'boundary-session-1',
          status: 'ai_turn_running',
          questions: [],
        });
      }
      throw new Error(`unexpected request ${method} ${path}`);
    });
    const client = createCodexRuntimeSuperpowersDogfoodHttpClient(
      {
        controlPlaneUrl: 'http://control-plane.invalid',
        actorId: 'actor-setup',
        generationRuntimeProfileId: 'profile-generation',
        generationCredentialBindingId: 'binding-generation',
        runExecutionRuntimeProfileId: 'profile-run',
        runExecutionCredentialBindingId: 'binding-run',
        projectId: 'project-1',
        sourceObjectType: 'requirement',
        sourceObjectId: 'requirement-1',
        leaderActorId: 'actor-leader',
        reviewerActorId: 'actor-reviewer',
        noSharedFilesystem: true,
        skipBootstrap: true,
        remoteRuntimeJobWaitTimeoutMs: 5,
        remoteRuntimeJobPollIntervalMs: 0,
      },
      {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        runRemoteWorkerOnce: async () => new Promise<void>(() => undefined),
      },
    );

    await client.seedSourceAndDevelopmentPlanItem();
    await expect(client.completeBoundaryBrainstorming('initial')).rejects.toMatchObject({
      blockerCode: 'codex_runtime_superpowers_remote_worker_invocation_timed_out',
    });
  });

  it('requires scheduled Spec generation runtime job metadata before invoking the worker', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const parsedUrl = new URL(String(url));
      const path = parsedUrl.pathname;
      const method = init?.method ?? 'GET';

      if (method === 'POST' && path === '/development-plans') {
        return jsonResponse({ id: 'development-plan-1' });
      }
      if (method === 'POST' && path === '/development-plans/development-plan-1/items') {
        return jsonResponse({ id: 'item-1' });
      }
      if (method === 'POST' && path === '/development-plans/development-plan-1/items/item-1/spec-revisions/generate') {
        return jsonResponse({ action_run: { id: 'action-run-1' } });
      }
      throw new Error(`unexpected request ${method} ${path}`);
    });
    const workerCalls: string[] = [];
    const client = createCodexRuntimeSuperpowersDogfoodHttpClient(
      {
        controlPlaneUrl: 'http://control-plane.invalid',
        actorId: 'actor-setup',
        generationRuntimeProfileId: 'profile-generation',
        generationCredentialBindingId: 'binding-generation',
        runExecutionRuntimeProfileId: 'profile-run',
        runExecutionCredentialBindingId: 'binding-run',
        projectId: 'project-1',
        sourceObjectType: 'requirement',
        sourceObjectId: 'requirement-1',
        leaderActorId: 'actor-leader',
        reviewerActorId: 'actor-reviewer',
        noSharedFilesystem: true,
        skipBootstrap: true,
      },
      {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        runRemoteWorkerOnce: async (targetKind) => {
          workerCalls.push(targetKind ?? 'generation');
        },
      },
    );

    await client.seedSourceAndDevelopmentPlanItem();
    await expect(client.generateAndApproveSpec()).rejects.toMatchObject({
      blockerCode: 'codex_runtime_superpowers_dogfood_spec_runtime_job_missing',
    });
    expect(workerCalls).toEqual([]);
  });

  it('requires scheduled Execution Plan generation runtime job metadata before invoking the worker', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const parsedUrl = new URL(String(url));
      const path = parsedUrl.pathname;
      const method = init?.method ?? 'GET';

      if (method === 'POST' && path === '/development-plans') {
        return jsonResponse({ id: 'development-plan-1' });
      }
      if (method === 'POST' && path === '/development-plans/development-plan-1/items') {
        return jsonResponse({ id: 'item-1' });
      }
      if (method === 'POST' && path === '/development-plans/development-plan-1/items/item-1/execution-plan-revisions/generate') {
        return jsonResponse({ action_run: { id: 'action-run-1' } });
      }
      throw new Error(`unexpected request ${method} ${path}`);
    });
    const workerCalls: string[] = [];
    const client = createCodexRuntimeSuperpowersDogfoodHttpClient(
      {
        controlPlaneUrl: 'http://control-plane.invalid',
        actorId: 'actor-setup',
        generationRuntimeProfileId: 'profile-generation',
        generationCredentialBindingId: 'binding-generation',
        runExecutionRuntimeProfileId: 'profile-run',
        runExecutionCredentialBindingId: 'binding-run',
        projectId: 'project-1',
        sourceObjectType: 'requirement',
        sourceObjectId: 'requirement-1',
        leaderActorId: 'actor-leader',
        reviewerActorId: 'actor-reviewer',
        noSharedFilesystem: true,
        skipBootstrap: true,
      },
      {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        runRemoteWorkerOnce: async (targetKind) => {
          workerCalls.push(targetKind ?? 'generation');
        },
      },
    );

    await client.seedSourceAndDevelopmentPlanItem();
    await expect(client.generateAndApproveExecutionPlan()).rejects.toMatchObject({
      blockerCode: 'codex_runtime_superpowers_dogfood_execution_plan_runtime_job_missing',
    });
    expect(workerCalls).toEqual([]);
  });

  it('returns Spec runtime job schema, app-server evidence, and runtime job digest from runtime projection', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const parsedUrl = new URL(String(url));
      const path = parsedUrl.pathname;
      const method = init?.method ?? 'GET';

      if (method === 'POST' && path === '/development-plans') {
        return jsonResponse({ id: 'development-plan-1' });
      }
      if (method === 'POST' && path === '/development-plans/development-plan-1/items') {
        return jsonResponse({ id: 'item-1' });
      }
      if (method === 'POST' && path === '/development-plans/development-plan-1/items/item-1/spec-revisions/generate') {
        return jsonResponse({ action_run: { id: 'action-run-spec' }, runtime_job: { id: 'runtime-job-spec' } });
      }
      if (method === 'GET' && path === '/query/development-plans/development-plan-1/items/item-1') {
        return jsonResponse({ specs: [{ current_revision_id: 'spec-revision-1' }] });
      }
      if (method === 'GET' && path === '/internal/codex-runtime/runtime-jobs/runtime-job-spec') {
        return jsonResponse({
          runtime_job: {
            id: 'runtime-job-spec',
            status: 'terminal',
            terminal_status: 'succeeded',
            input: {
              schema_version: 'codex_generation_workload.v1',
              output_schema_version: 'spec_revision.v1',
            },
            terminal_result_json: {
              output_schema_version: 'spec_revision.v1',
              runtime_evidence: runtimeAppServerEvidence,
            },
          },
          artifacts: [
            {
              kind: 'generated_payload',
              metadata_json: {
                output_schema_version: 'spec_revision.v1',
                generated_payload: { schema_version: 'spec_revision.v1' },
              },
            },
          ],
        });
      }
      if (method === 'GET' && path === '/internal/automation/runtime-snapshot') {
        return jsonResponse({ recent_action_runs: [{ id: 'action-run-spec', status: 'succeeded' }] });
      }
      if (method === 'POST' && path === '/development-plans/development-plan-1/items/item-1/spec/submit-for-approval') {
        return jsonResponse({ id: 'spec-revision-1' });
      }
      if (method === 'POST' && path === '/development-plans/development-plan-1/items/item-1/spec/approve') {
        return jsonResponse({ id: 'spec-revision-1' });
      }
      throw new Error(`unexpected request ${method} ${path}`);
    });
    const client = createCodexRuntimeSuperpowersDogfoodHttpClient(boundaryHttpClientConfig(), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      env: {
        FORGELOOP_TRUSTED_ACTOR_HEADER_SECRET: 'test-secret',
        FORGELOOP_AUTOMATION_ACTOR_ID: 'automation-actor',
        FORGELOOP_AUTOMATION_DAEMON_IDENTITY: 'automation-daemon',
      },
      runRemoteWorkerOnce: async () => undefined,
    });

    await client.seedSourceAndDevelopmentPlanItem();

    await expect(client.generateAndApproveSpec()).resolves.toMatchObject({
      spec_revision_id: 'spec-revision-1',
      output_schema_versions: ['spec_revision.v1'],
      app_server_evidence_digests: [expect.stringMatching(/^sha256:[a-f0-9]{64}$/)],
      runtime_job_digests: [expect.stringMatching(/^sha256:[a-f0-9]{64}$/)],
      cleanup_status: 'completed',
    });
  });

  it('returns Execution Plan runtime job schema, app-server evidence, and runtime job digest from runtime projection', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const parsedUrl = new URL(String(url));
      const path = parsedUrl.pathname;
      const method = init?.method ?? 'GET';

      if (method === 'POST' && path === '/development-plans') {
        return jsonResponse({ id: 'development-plan-1' });
      }
      if (method === 'POST' && path === '/development-plans/development-plan-1/items') {
        return jsonResponse({ id: 'item-1' });
      }
      if (method === 'POST' && path === '/development-plans/development-plan-1/items/item-1/execution-plan-revisions/generate') {
        return jsonResponse({ action_run: { id: 'action-run-plan' }, runtime_job: { id: 'runtime-job-plan' } });
      }
      if (method === 'GET' && path === '/query/development-plans/development-plan-1/items/item-1') {
        return jsonResponse({ execution_plans: [{ current_revision_id: 'execution-plan-revision-1' }] });
      }
      if (method === 'GET' && path === '/internal/codex-runtime/runtime-jobs/runtime-job-plan') {
        return jsonResponse({
          runtime_job: {
            id: 'runtime-job-plan',
            status: 'terminal',
            terminal_status: 'succeeded',
            input: {
              schema_version: 'codex_generation_workload.v1',
              output_schema_version: 'execution_plan_revision.v1',
            },
            terminal_result_json: {
              output_schema_version: 'execution_plan_revision.v1',
              runtime_evidence: runtimeAppServerEvidence,
            },
          },
          artifacts: [
            {
              kind: 'generated_payload',
              metadata_json: {
                output_schema_version: 'execution_plan_revision.v1',
                generated_payload: { schema_version: 'execution_plan_revision.v1' },
              },
            },
          ],
        });
      }
      if (method === 'GET' && path === '/internal/automation/runtime-snapshot') {
        return jsonResponse({ recent_action_runs: [{ id: 'action-run-plan', status: 'succeeded' }] });
      }
      if (method === 'POST' && path === '/development-plans/development-plan-1/items/item-1/execution-plan/submit-for-approval') {
        return jsonResponse({ id: 'execution-plan-revision-1' });
      }
      if (method === 'POST' && path === '/development-plans/development-plan-1/items/item-1/execution-plan/approve') {
        return jsonResponse({ id: 'execution-plan-revision-1' });
      }
      throw new Error(`unexpected request ${method} ${path}`);
    });
    const client = createCodexRuntimeSuperpowersDogfoodHttpClient(boundaryHttpClientConfig(), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      env: {
        FORGELOOP_TRUSTED_ACTOR_HEADER_SECRET: 'test-secret',
        FORGELOOP_AUTOMATION_ACTOR_ID: 'automation-actor',
        FORGELOOP_AUTOMATION_DAEMON_IDENTITY: 'automation-daemon',
      },
      runRemoteWorkerOnce: async () => undefined,
    });

    await client.seedSourceAndDevelopmentPlanItem();

    await expect(client.generateAndApproveExecutionPlan()).resolves.toMatchObject({
      execution_plan_revision_id: 'execution-plan-revision-1',
      output_schema_versions: ['execution_plan_revision.v1'],
      app_server_evidence_digests: [expect.stringMatching(/^sha256:[a-f0-9]{64}$/)],
      runtime_job_digests: [expect.stringMatching(/^sha256:[a-f0-9]{64}$/)],
      cleanup_status: 'completed',
    });
  });

  it('marks generation runtime cleanup failure evidence as blocked and rejects unsafe cleanup summaries', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const parsedUrl = new URL(String(url));
      const path = parsedUrl.pathname;
      const method = init?.method ?? 'GET';

      if (method === 'POST' && path === '/development-plans') {
        return jsonResponse({ id: 'development-plan-1' });
      }
      if (method === 'POST' && path === '/development-plans/development-plan-1/items') {
        return jsonResponse({ id: 'item-1' });
      }
      if (method === 'POST' && path === '/development-plans/development-plan-1/items/item-1/spec-revisions/generate') {
        return jsonResponse({ action_run: { id: 'action-run-cleanup' }, runtime_job: { id: 'runtime-job-cleanup' } });
      }
      if (method === 'GET' && path === '/query/development-plans/development-plan-1/items/item-1') {
        return jsonResponse({ specs: [{ current_revision_id: 'spec-revision-1' }] });
      }
      if (method === 'GET' && path === '/internal/codex-runtime/runtime-jobs/runtime-job-cleanup') {
        return jsonResponse({
          runtime_job: {
            id: 'runtime-job-cleanup',
            status: 'terminal',
            terminal_status: 'succeeded',
            input: { output_schema_version: 'spec_revision.v1' },
            terminal_result_json: {
              output_schema_version: 'spec_revision.v1',
              runtime_evidence: runtimeAppServerEvidence,
            },
          },
          artifacts: [
            {
              kind: 'cleanup_failure_evidence',
              metadata_json: {
                reason_code: 'codex_runtime_cleanup_failed',
                public_summary: 'Remote Codex app-server cleanup failed after generation.',
              },
            },
          ],
        });
      }
      if (method === 'GET' && path === '/internal/automation/runtime-snapshot') {
        return jsonResponse({ recent_action_runs: [{ id: 'action-run-cleanup', status: 'succeeded' }] });
      }
      if (method === 'POST' && path === '/development-plans/development-plan-1/items/item-1/spec/submit-for-approval') {
        return jsonResponse({ id: 'spec-revision-1' });
      }
      if (method === 'POST' && path === '/development-plans/development-plan-1/items/item-1/spec/approve') {
        return jsonResponse({ id: 'spec-revision-1' });
      }
      throw new Error(`unexpected request ${method} ${path}`);
    });
    const client = createCodexRuntimeSuperpowersDogfoodHttpClient(boundaryHttpClientConfig(), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      env: {
        FORGELOOP_TRUSTED_ACTOR_HEADER_SECRET: 'test-secret',
        FORGELOOP_AUTOMATION_ACTOR_ID: 'automation-actor',
        FORGELOOP_AUTOMATION_DAEMON_IDENTITY: 'automation-daemon',
      },
      runRemoteWorkerOnce: async () => undefined,
    });

    await client.seedSourceAndDevelopmentPlanItem();
    const result = await client.generateAndApproveSpec();

    expect(result).toMatchObject({
      spec_revision_id: 'spec-revision-1',
      output_schema_versions: ['spec_revision.v1'],
      runtime_job_digests: [expect.stringMatching(/^sha256:[a-f0-9]{64}$/)],
      app_server_evidence_digests: [expect.stringMatching(/^sha256:[a-f0-9]{64}$/)],
      cleanup_status: 'blocked',
    });
    expect(() =>
      deriveCodexAppServerEvidence(
        collectCodexAppServerPhaseEvidence({
          boundary: [boundaryEvidence, boundaryRebaseEvidence],
          spec: result,
          executionPlan: executionPlanEvidence,
          execution: executionEvidence,
        }),
      ),
    ).toThrow(/codex_runtime_superpowers_app_server_phase_evidence_missing/);
  });

  it('rejects unsafe runtime cleanup failure summaries before reporting phase evidence', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const parsedUrl = new URL(String(url));
      const path = parsedUrl.pathname;
      const method = init?.method ?? 'GET';

      if (method === 'POST' && path === '/development-plans') {
        return jsonResponse({ id: 'development-plan-1' });
      }
      if (method === 'POST' && path === '/development-plans/development-plan-1/items') {
        return jsonResponse({ id: 'item-1' });
      }
      if (method === 'POST' && path === '/development-plans/development-plan-1/items/item-1/spec-revisions/generate') {
        return jsonResponse({ action_run: { id: 'action-run-unsafe-cleanup' }, runtime_job: { id: 'runtime-job-unsafe-cleanup' } });
      }
      if (method === 'GET' && path === '/query/development-plans/development-plan-1/items/item-1') {
        return jsonResponse({ specs: [{ current_revision_id: 'spec-revision-1' }] });
      }
      if (method === 'GET' && path === '/internal/codex-runtime/runtime-jobs/runtime-job-unsafe-cleanup') {
        return jsonResponse({
          runtime_job: {
            id: 'runtime-job-unsafe-cleanup',
            status: 'terminal',
            terminal_status: 'succeeded',
            input: { output_schema_version: 'spec_revision.v1' },
            terminal_result_json: {
              output_schema_version: 'spec_revision.v1',
              runtime_evidence: runtimeAppServerEvidence,
            },
          },
          artifacts: [
            {
              kind: 'cleanup_failure_evidence',
              metadata_json: {
                reason_code: 'codex_runtime_cleanup_failed',
                public_summary: 'Cleanup failed for /tmp/private container-123 config.toml.',
              },
            },
          ],
        });
      }
      if (method === 'GET' && path === '/internal/automation/runtime-snapshot') {
        return jsonResponse({ recent_action_runs: [{ id: 'action-run-unsafe-cleanup', status: 'succeeded' }] });
      }
      if (method === 'POST' && path === '/development-plans/development-plan-1/items/item-1/spec/submit-for-approval') {
        return jsonResponse({ id: 'spec-revision-1' });
      }
      if (method === 'POST' && path === '/development-plans/development-plan-1/items/item-1/spec/approve') {
        return jsonResponse({ id: 'spec-revision-1' });
      }
      throw new Error(`unexpected request ${method} ${path}`);
    });
    const client = createCodexRuntimeSuperpowersDogfoodHttpClient(boundaryHttpClientConfig(), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      env: {
        FORGELOOP_TRUSTED_ACTOR_HEADER_SECRET: 'test-secret',
        FORGELOOP_AUTOMATION_ACTOR_ID: 'automation-actor',
        FORGELOOP_AUTOMATION_DAEMON_IDENTITY: 'automation-daemon',
      },
      runRemoteWorkerOnce: async () => undefined,
    });

    await client.seedSourceAndDevelopmentPlanItem();
    await expect(client.generateAndApproveSpec()).rejects.toThrow(
      /codex_runtime_superpowers_dogfood_report_unsafe:cleanup_failure_public_summary/,
    );
  });

  it('does not let a stale Spec projection mask a failed runtime job', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const parsedUrl = new URL(String(url));
      const path = parsedUrl.pathname;
      const method = init?.method ?? 'GET';

      if (method === 'POST' && path === '/development-plans') {
        return jsonResponse({ id: 'development-plan-1' });
      }
      if (method === 'POST' && path === '/development-plans/development-plan-1/items') {
        return jsonResponse({ id: 'item-1' });
      }
      if (method === 'POST' && path === '/development-plans/development-plan-1/items/item-1/spec-revisions/generate') {
        return jsonResponse({ action_run: { id: 'action-run-1' }, runtime_job: { id: 'runtime-job-1' } });
      }
      if (method === 'GET' && path === '/query/development-plans/development-plan-1/items/item-1') {
        return jsonResponse({ specs: [{ current_revision_id: 'spec-revision-stale' }] });
      }
      if (method === 'GET' && path === '/internal/codex-runtime/runtime-jobs/runtime-job-1') {
        return jsonResponse({
          runtime_job: {
            id: 'runtime-job-1',
            status: 'terminal',
            terminal_status: 'failed',
            terminal_reason_code: 'generated_output_schema_invalid',
          },
        });
      }
      throw new Error(`unexpected request ${method} ${path}`);
    });
    const client = createCodexRuntimeSuperpowersDogfoodHttpClient(
      {
        controlPlaneUrl: 'http://control-plane.invalid',
        actorId: 'actor-setup',
        generationRuntimeProfileId: 'profile-generation',
        generationCredentialBindingId: 'binding-generation',
        runExecutionRuntimeProfileId: 'profile-run',
        runExecutionCredentialBindingId: 'binding-run',
        projectId: 'project-1',
        sourceObjectType: 'requirement',
        sourceObjectId: 'requirement-1',
        leaderActorId: 'actor-leader',
        reviewerActorId: 'actor-reviewer',
        noSharedFilesystem: true,
        skipBootstrap: true,
        remoteRuntimeJobWaitTimeoutMs: 60_000,
        remoteRuntimeJobPollIntervalMs: 0,
      },
      {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        env: {
          FORGELOOP_TRUSTED_ACTOR_HEADER_SECRET: 'test-secret',
          FORGELOOP_AUTOMATION_ACTOR_ID: 'automation-actor',
          FORGELOOP_AUTOMATION_DAEMON_IDENTITY: 'automation-daemon',
        },
        runRemoteWorkerOnce: async () => undefined,
      },
    );

    await client.seedSourceAndDevelopmentPlanItem();
    await expect(client.generateAndApproveSpec()).rejects.toMatchObject({
      blockerCode: 'codex_runtime_superpowers_runtime_job_failed',
      report: {
        runtime_job_id: 'runtime-job-1',
        runtime_job_terminal_status: 'failed',
        runtime_job_reason_code: 'generated_output_schema_invalid',
      },
    });
  });

  it('fails fast when the product generation action terminalizes failed after a succeeded runtime job', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const parsedUrl = new URL(String(url));
      const path = parsedUrl.pathname;
      const method = init?.method ?? 'GET';

      if (method === 'POST' && path === '/development-plans') {
        return jsonResponse({ id: 'development-plan-1' });
      }
      if (method === 'POST' && path === '/development-plans/development-plan-1/items') {
        return jsonResponse({ id: 'item-1' });
      }
      if (method === 'POST' && path === '/development-plans/development-plan-1/items/item-1/spec-revisions/generate') {
        return jsonResponse({ action_run: { id: 'action-run-1' }, runtime_job: { id: 'runtime-job-1' } });
      }
      if (method === 'GET' && path === '/query/development-plans/development-plan-1/items/item-1') {
        return jsonResponse({ specs: [] });
      }
      if (method === 'GET' && path === '/internal/codex-runtime/runtime-jobs/runtime-job-1') {
        return jsonResponse({
          runtime_job: {
            id: 'runtime-job-1',
            status: 'terminal',
            terminal_status: 'succeeded',
            terminal_reason_code: 'completed',
          },
        });
      }
      if (method === 'GET' && path === '/internal/automation/runtime-snapshot') {
        return jsonResponse({ recent_action_runs: [{ id: 'action-run-1', status: 'failed' }] });
      }
      throw new Error(`unexpected request ${method} ${path}`);
    });
    const client = createCodexRuntimeSuperpowersDogfoodHttpClient(
      {
        controlPlaneUrl: 'http://control-plane.invalid',
        actorId: 'actor-setup',
        generationRuntimeProfileId: 'profile-generation',
        generationCredentialBindingId: 'binding-generation',
        runExecutionRuntimeProfileId: 'profile-run',
        runExecutionCredentialBindingId: 'binding-run',
        projectId: 'project-1',
        sourceObjectType: 'requirement',
        sourceObjectId: 'requirement-1',
        leaderActorId: 'actor-leader',
        reviewerActorId: 'actor-reviewer',
        noSharedFilesystem: true,
        skipBootstrap: true,
        remoteRuntimeJobWaitTimeoutMs: 60_000,
        remoteRuntimeJobPollIntervalMs: 0,
      },
      {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        env: {
          FORGELOOP_TRUSTED_ACTOR_HEADER_SECRET: 'test-secret',
          FORGELOOP_AUTOMATION_ACTOR_ID: 'automation-actor',
          FORGELOOP_AUTOMATION_DAEMON_IDENTITY: 'automation-daemon',
        },
        runRemoteWorkerOnce: async () => undefined,
      },
    );

    await client.seedSourceAndDevelopmentPlanItem();
    await expect(client.generateAndApproveSpec()).rejects.toMatchObject({
      blockerCode: 'codex_runtime_superpowers_product_generation_action_failed',
      report: {
        action_run_id: 'action-run-1',
        action_run_status: 'failed',
      },
    });
  });

  it('returns Execution runtime job schema, app-server evidence, and runtime job digest from derived runtime job projection', async () => {
    const requests: Array<{ method: string; path: string }> = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const parsedUrl = new URL(String(url));
      const path = parsedUrl.pathname;
      const method = init?.method ?? 'GET';
      requests.push({ method, path });

      if (method === 'POST' && path === '/development-plans') {
        return jsonResponse({ id: 'development-plan-1' });
      }
      if (method === 'POST' && path === '/development-plans/development-plan-1/items') {
        return jsonResponse({ id: 'item-1' });
      }
      if (method === 'POST' && path === '/development-plans/development-plan-1/items/item-1/execution/start') {
        return jsonResponse({
          id: 'execution-1',
          runtime_evidence_refs: [
            { type: 'execution_package', id: 'execution-package-1' },
            { type: 'run_session', id: 'run-session-1' },
          ],
        });
      }
      if (method === 'GET' && path === '/query/development-plans/development-plan-1/items/item-1') {
        return jsonResponse({
          executions: [
            {
              id: 'execution-1',
              runtime_evidence: {
                workspace_bundle_digest: digest('w'),
                workspace_bundle_manifest_digest: digest('x'),
                mounted_task_workspace_digest: digest('m'),
                changed_files: ['docs/superpowers/reports/codex-runtime-superpowers-dogfood.md'],
              },
            },
          ],
        });
      }
      if (method === 'GET' && path === '/run-sessions/run-session-1') {
        return jsonResponse({ id: 'run-session-1', status: 'running' });
      }
      if (method === 'GET' && path === '/execution-packages/execution-package-1') {
        return jsonResponse({ id: 'execution-package-1', version: 7 });
      }
      if (method === 'GET' && path === '/internal/codex-runtime/runtime-jobs/1976ff6d-d61e-47ea-8073-4d8bad9e1e24') {
        return jsonResponse({
          runtime_job: {
            id: '1976ff6d-d61e-47ea-8073-4d8bad9e1e24',
            status: 'terminal',
            terminal_status: 'succeeded',
            input: {
              schema_version: 'codex_run_execution_workload.v1',
              output_schema_version: 'codex_run_execution_result.v1',
            },
            terminal_result_json: {
              output_schema_version: 'codex_run_execution_result.v1',
              runtime_evidence: {
                ...runtimeAppServerEvidence,
                runtime_target_kind: 'run_execution',
                source_access_mode: 'path_policy_scoped',
              },
            },
          },
          artifacts: [],
        });
      }
      throw new Error(`unexpected request ${method} ${path}`);
    });
    const workerCalls: string[] = [];
    const client = createCodexRuntimeSuperpowersDogfoodHttpClient(
      {
        controlPlaneUrl: 'http://control-plane.invalid',
        actorId: 'actor-setup',
        generationRuntimeProfileId: 'profile-generation',
        generationCredentialBindingId: 'binding-generation',
        runExecutionRuntimeProfileId: 'profile-run',
        runExecutionCredentialBindingId: 'binding-run',
        projectId: 'project-1',
        sourceObjectType: 'requirement',
        sourceObjectId: 'requirement-1',
        leaderActorId: 'actor-leader',
        reviewerActorId: 'actor-reviewer',
        noSharedFilesystem: true,
        skipBootstrap: true,
      },
      {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        env: {
          FORGELOOP_TRUSTED_ACTOR_HEADER_SECRET: 'test-secret',
          FORGELOOP_AUTOMATION_ACTOR_ID: 'automation-actor',
          FORGELOOP_AUTOMATION_DAEMON_IDENTITY: 'automation-daemon',
        },
        runRemoteWorkerOnce: async () => {
          workerCalls.push('worker');
        },
      },
    );

    await client.seedSourceAndDevelopmentPlanItem();
    await expect(client.startExecution()).resolves.toMatchObject({
      execution_id: 'execution-1',
      workspace_bundle_digest: digest('w'),
      mounted_task_workspace_digest: digest('m'),
      changed_files: ['docs/superpowers/reports/codex-runtime-superpowers-dogfood.md'],
      output_schema_versions: ['codex_run_execution_result.v1'],
      app_server_evidence_digests: [expect.stringMatching(/^sha256:[a-f0-9]{64}$/)],
      runtime_job_digests: [expect.stringMatching(/^sha256:[a-f0-9]{64}$/)],
      cleanup_status: 'completed',
    });

    expect(workerCalls).toEqual(['worker']);
    expect(requests).toEqual(
      expect.arrayContaining([
        { method: 'GET', path: '/execution-packages/execution-package-1' },
        { method: 'GET', path: '/internal/codex-runtime/runtime-jobs/1976ff6d-d61e-47ea-8073-4d8bad9e1e24' },
      ]),
    );
  });

  it('blocks execution dogfood when worker runtime evidence is still missing after polling', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const parsedUrl = new URL(String(url));
      const path = parsedUrl.pathname;
      const method = init?.method ?? 'GET';

      if (method === 'POST' && path === '/development-plans') {
        return jsonResponse({ id: 'development-plan-1' });
      }
      if (method === 'POST' && path === '/development-plans/development-plan-1/items') {
        return jsonResponse({ id: 'item-1' });
      }
      if (method === 'POST' && path === '/development-plans/development-plan-1/items/item-1/execution/start') {
        return jsonResponse({
          id: 'execution-1',
          runtime_evidence_refs: [
            { type: 'execution_package', id: 'execution-package-1' },
            { type: 'run_session', id: 'run-session-1' },
          ],
        });
      }
      if (method === 'GET' && path === '/query/development-plans/development-plan-1/items/item-1') {
        return jsonResponse({ executions: [{ id: 'execution-1' }] });
      }
      if (method === 'GET' && path === '/run-sessions/run-session-1') {
        return jsonResponse({ id: 'run-session-1', status: 'running' });
      }
      throw new Error(`unexpected request ${method} ${path}`);
    });
    const client = createCodexRuntimeSuperpowersDogfoodHttpClient(
      {
        controlPlaneUrl: 'http://control-plane.invalid',
        actorId: 'actor-setup',
        generationRuntimeProfileId: 'profile-generation',
        generationCredentialBindingId: 'binding-generation',
        runExecutionRuntimeProfileId: 'profile-run',
        runExecutionCredentialBindingId: 'binding-run',
        projectId: 'project-1',
        sourceObjectType: 'requirement',
        sourceObjectId: 'requirement-1',
        leaderActorId: 'actor-leader',
        reviewerActorId: 'actor-reviewer',
        noSharedFilesystem: true,
        skipBootstrap: true,
        remoteRuntimeJobWaitTimeoutMs: 20,
        remoteRuntimeJobPollIntervalMs: 0,
      },
      {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        runRemoteWorkerOnce: async () => undefined,
      },
    );

    await client.seedSourceAndDevelopmentPlanItem();
    await expect(client.startExecution()).rejects.toMatchObject({
      blockerCode: 'codex_runtime_superpowers_execution_runtime_evidence_missing',
    });
  });

  it('fails fast when the run execution run session terminalizes failed', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const parsedUrl = new URL(String(url));
      const path = parsedUrl.pathname;
      const method = init?.method ?? 'GET';

      if (method === 'POST' && path === '/development-plans') {
        return jsonResponse({ id: 'development-plan-1' });
      }
      if (method === 'POST' && path === '/development-plans/development-plan-1/items') {
        return jsonResponse({ id: 'item-1' });
      }
      if (method === 'POST' && path === '/development-plans/development-plan-1/items/item-1/execution/start') {
        return jsonResponse({
          id: 'execution-1',
          runtime_evidence_refs: [
            { type: 'execution_package', id: 'execution-package-1' },
            { type: 'run_session', id: 'run-session-1' },
          ],
        });
      }
      if (method === 'GET' && path === '/query/development-plans/development-plan-1/items/item-1') {
        return jsonResponse({ executions: [{ id: 'execution-1' }] });
      }
      if (method === 'GET' && path === '/run-sessions/run-session-1') {
        return jsonResponse({ id: 'run-session-1', status: 'failed', failure_reason: 'codex_runtime_job_failed' });
      }
      if (method === 'GET' && path === '/execution-packages/execution-package-1') {
        return jsonResponse({ id: 'execution-package-1', version: 7 });
      }
      if (method === 'GET' && path === '/internal/codex-runtime/runtime-jobs/1976ff6d-d61e-47ea-8073-4d8bad9e1e24') {
        return jsonResponse({
          runtime_job: {
            id: '1976ff6d-d61e-47ea-8073-4d8bad9e1e24',
            status: 'terminal',
            terminal_status: 'failed',
            terminal_reason_code: 'codex_workspace_bundle_invalid',
          },
          artifacts: [
            {
              kind: 'startup_failure_evidence',
              metadata_json: {
                reason_code: 'codex_workspace_bundle_invalid',
                failure_subcode: 'job_temp_root_already_exists',
              },
            },
          ],
        });
      }
      throw new Error(`unexpected request ${method} ${path}`);
    });
    const client = createCodexRuntimeSuperpowersDogfoodHttpClient(
      {
        controlPlaneUrl: 'http://control-plane.invalid',
        actorId: 'actor-setup',
        generationRuntimeProfileId: 'profile-generation',
        generationCredentialBindingId: 'binding-generation',
        runExecutionRuntimeProfileId: 'profile-run',
        runExecutionCredentialBindingId: 'binding-run',
        projectId: 'project-1',
        sourceObjectType: 'requirement',
        sourceObjectId: 'requirement-1',
        leaderActorId: 'actor-leader',
        reviewerActorId: 'actor-reviewer',
        noSharedFilesystem: true,
        skipBootstrap: true,
        remoteRuntimeJobWaitTimeoutMs: 60_000,
        remoteRuntimeJobPollIntervalMs: 0,
      },
      {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        env: {
          FORGELOOP_TRUSTED_ACTOR_HEADER_SECRET: 'test-secret',
          FORGELOOP_AUTOMATION_ACTOR_ID: 'automation-actor',
          FORGELOOP_AUTOMATION_DAEMON_IDENTITY: 'automation-daemon',
        },
        runRemoteWorkerOnce: async () => undefined,
      },
    );

    await client.seedSourceAndDevelopmentPlanItem();
    await expect(client.startExecution()).rejects.toMatchObject({
      blockerCode: 'codex_runtime_superpowers_run_execution_failed',
      report: {
        runtime_job_id: '1976ff6d-d61e-47ea-8073-4d8bad9e1e24',
        runtime_job_terminal_status: 'failed',
        runtime_job_reason_code: 'codex_workspace_bundle_invalid',
        runtime_job_failure_subcode: 'job_temp_root_already_exists',
        run_session_id: 'run-session-1',
        run_session_status: 'failed',
        run_session_failure_reason: 'codex_runtime_job_failed',
      },
    });
  });
});

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
