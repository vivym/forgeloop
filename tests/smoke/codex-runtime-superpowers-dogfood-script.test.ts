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
  loadCodexRuntimeSuperpowersDogfoodCliConfig,
  renderCodexRuntimeSuperpowersDogfoodBlockerReport,
  renderCodexRuntimeSuperpowersDogfoodReport,
  runCodexRuntimeSuperpowersDogfood,
  sanitizeCodexRemoteWorkerDogfoodEnv,
  type CodexRuntimeSuperpowersDogfoodClient,
} from '../../scripts/codex-runtime-superpowers-dogfood';

const digest = (seed: string): string => `sha256:${createHash('sha256').update(seed).digest('hex')}`;
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
  boundarySecond?: PhaseEvidenceOverride;
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
  runBoundaryBrainstormingRound: vi.fn(async (roundNumber: number) => {
    const evidence =
      roundNumber === 1
        ? {
            boundary_brainstorming_session_id: 'boundary-session-1',
            ai_turn_count: 1,
            follow_up_path_covered: false,
            summary_request_change_path_covered: false,
            output_schema_versions: ['boundary_round_result.v1'],
            runtime_job_digests: [digest('boundary-runtime-job-a')],
            app_server_evidence_digests: [digest('boundary-app-server-a')],
            cleanup_status: 'completed' as const,
            ...overrides?.boundaryInitial,
          }
        : {
            boundary_brainstorming_session_id: 'boundary-session-2',
            ai_turn_count: 2,
            follow_up_path_covered: true,
            summary_request_change_path_covered: true,
            output_schema_versions: ['boundary_round_result.v1'],
            runtime_job_digests: [digest('boundary-runtime-job-b')],
            app_server_evidence_digests: [digest('boundary-app-server-b')],
            cleanup_status: 'completed' as const,
            ...overrides?.boundarySecond,
          };
    return evidence;
  }),
  answerBoundaryQuestion: vi.fn(async () => undefined),
  proposeBoundarySummary: vi.fn(async () => ({ boundary_summary_revision_id: 'boundary-summary-revision-1' })),
  mutateDevelopmentPlanItem: vi.fn(async () => undefined),
  assertStaleBoundaryBlocksSpecGeneration: vi.fn(async () => ({
    blocked: true,
    blocker_code: 'STALE_BOUNDARY_SUMMARY',
  })),
  rebaseBoundaryBrainstorming: vi.fn(async () => ({
    rebased_session_id: 'boundary-session-rebased',
    rebased_boundary_summary_revision_id: 'boundary-summary-revision-rebased',
    ai_turn_count: 1,
    follow_up_path_covered: false,
    summary_request_change_path_covered: false,
    output_schema_versions: ['boundary_round_result.v1'],
    runtime_job_digests: [digest('boundary-rebase-runtime-job-a')],
    app_server_evidence_digests: [digest('boundary-rebase-app-server-a')],
    cleanup_status: 'completed',
    ...overrides?.boundaryRebase,
  })),
  approveBoundarySummary: vi.fn(async () => ({ boundary_summary_revision_id: 'boundary-summary-revision-rebased' })),
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
      runBoundaryBrainstormingRound: vi.fn(async (roundNumber: number) => {
        calls.push(`runBoundaryBrainstormingRound:${roundNumber}`);
        return {
          boundary_brainstorming_session_id: `boundary-session-${roundNumber}`,
          ai_turn_count: roundNumber === 1 ? 1 : 2,
          follow_up_path_covered: roundNumber === 2,
          summary_request_change_path_covered: roundNumber === 2,
          output_schema_versions: boundaryEvidence.output_schema_versions,
          app_server_evidence_digests:
            roundNumber === 1 ? [digest('boundary-app-server-a')] : [digest('boundary-app-server-b'), digest('boundary-app-server-c')],
          runtime_job_digests: roundNumber === 1 ? [digest('boundary-a')] : [digest('boundary-b'), digest('boundary-c')],
          cleanup_status: 'completed' as const,
        };
      }),
      answerBoundaryQuestion: vi.fn(async () => {
        calls.push('answerBoundaryQuestion');
      }),
      proposeBoundarySummary: vi.fn(async () => {
        calls.push('proposeBoundarySummary');
        return { boundary_summary_revision_id: 'boundary-summary-revision-1' };
      }),
      mutateDevelopmentPlanItem: vi.fn(async () => {
        calls.push('mutateDevelopmentPlanItem');
      }),
      assertStaleBoundaryBlocksSpecGeneration: vi.fn(async () => {
        calls.push('assertStaleBoundaryBlocksSpecGeneration');
        return { blocked: true, blocker_code: 'STALE_BOUNDARY_SUMMARY' };
      }),
      rebaseBoundaryBrainstorming: vi.fn(async () => {
        calls.push('rebaseBoundaryBrainstorming');
        return {
          rebased_session_id: 'boundary-session-rebased',
          rebased_boundary_summary_revision_id: 'boundary-summary-revision-rebased',
          ai_turn_count: 1,
          follow_up_path_covered: false,
          summary_request_change_path_covered: false,
          output_schema_versions: boundaryRebaseEvidence.output_schema_versions,
          app_server_evidence_digests: boundaryRebaseEvidence.app_server_evidence_digests,
          runtime_job_digests: boundaryRebaseEvidence.runtime_job_digests,
          cleanup_status: 'completed' as const,
        };
      }),
      approveBoundarySummary: vi.fn(async () => {
        calls.push('approveBoundarySummary');
        return { boundary_summary_revision_id: 'boundary-summary-revision-rebased' };
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
      'runBoundaryBrainstormingRound:1',
      'answerBoundaryQuestion',
      'runBoundaryBrainstormingRound:2',
      'proposeBoundarySummary',
      'mutateDevelopmentPlanItem',
      'assertStaleBoundaryBlocksSpecGeneration',
      'rebaseBoundaryBrainstorming',
      'approveBoundarySummary',
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
      boundary_ai_turn_count: 4,
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

  it('blocks PASS orchestration when current fixed-round methods lack observed runtime evidence', async () => {
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
      runBoundaryBrainstormingRound: vi.fn(async (roundNumber: number) => ({
        boundary_brainstorming_session_id: `boundary-session-${roundNumber}`,
        ...emptyEvidence,
      })),
      answerBoundaryQuestion: vi.fn(async () => undefined),
      proposeBoundarySummary: vi.fn(async () => ({ boundary_summary_revision_id: 'boundary-summary-revision-1' })),
      mutateDevelopmentPlanItem: vi.fn(async () => undefined),
      assertStaleBoundaryBlocksSpecGeneration: vi.fn(async () => ({
        blocked: true,
        blocker_code: 'STALE_BOUNDARY_SUMMARY',
      })),
      rebaseBoundaryBrainstorming: vi.fn(async () => ({
        rebased_session_id: 'boundary-session-rebased',
        rebased_boundary_summary_revision_id: 'boundary-summary-revision-rebased',
        ...emptyEvidence,
      })),
      approveBoundarySummary: vi.fn(async () => ({ boundary_summary_revision_id: 'boundary-summary-revision-rebased' })),
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
      blockerCode: 'codex_runtime_superpowers_observed_runtime_evidence_missing',
    });
    expect(client.writeReport).not.toHaveBeenCalled();
  });

  it('blocks PASS orchestration when observed schemas do not prove the expected phase schema', async () => {
    const client = completeDogfoodClientWithPhaseEvidence({
      boundaryInitial: {
        output_schema_versions: ['unexpected_schema.v1'],
      },
      boundarySecond: {
        output_schema_versions: ['unexpected_schema.v1'],
      },
    });

    await expect(runCodexRuntimeSuperpowersDogfood({ client })).rejects.toMatchObject({
      blockerCode: 'codex_runtime_superpowers_observed_runtime_evidence_missing',
    });
    expect(client.writeReport).not.toHaveBeenCalled();
  });

  it('blocks PASS orchestration when a phase has no observed schema versions', async () => {
    const client = completeDogfoodClientWithPhaseEvidence({
      boundaryInitial: {
        output_schema_versions: [],
      },
      boundarySecond: {
        output_schema_versions: [],
      },
    });

    await expect(runCodexRuntimeSuperpowersDogfood({ client })).rejects.toMatchObject({
      blockerCode: 'codex_runtime_superpowers_observed_runtime_evidence_missing',
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
      blockerCode: 'codex_runtime_superpowers_observed_runtime_evidence_missing',
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

  it('does not require pre-known Boundary question or summary revision ids in CLI config', () => {
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

    expect(config.boundaryQuestionId).toBeUndefined();
    expect(config.boundarySummaryRevisionId).toBeUndefined();
    expect(config.repoId).toBe('repo-1');
    expect(config.repoLocalPath).toBe('/repo/current');
    expect(config.repoBaseCommitSha).toBe('abc123');
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

  it('discovers Boundary AI artifacts and verifies the stale/superseded Boundary check through product API calls', async () => {
    const requests: Array<{ method: string; path: string; body?: unknown }> = [];
    const workerCalls: string[] = [];
    const boundarySession1Responses = [
      {
        id: 'boundary-session-1',
        questions: [{ id: 'question-1', status: 'open', required: true }],
      },
      {
        id: 'boundary-session-1',
        latest_summary_revision_id: 'boundary-summary-revision-1',
        questions: [{ id: 'question-1', status: 'answered', required: true, answered_by_answer_id: 'answer-1' }],
      },
    ];
    const boundarySession2OpenQuestion = {
      id: 'boundary-session-2',
      questions: [{ id: 'question-2', status: 'open', required: true }],
    };
    let rebaseAnswered = false;
    let rebaseContinued = false;
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
      if (method === 'POST' && path === '/development-plans/development-plan-1/items/item-1/boundary-brainstorming') {
        return jsonResponse({ id: 'boundary-session-1' });
      }
      if (method === 'GET' && path === '/boundary-brainstorming-sessions/boundary-session-1') {
        return jsonResponse(boundarySession1Responses.shift() ?? boundarySession1Responses[boundarySession1Responses.length - 1]);
      }
      if (method === 'GET' && path === '/boundary-brainstorming-sessions/boundary-session-2') {
        if (rebaseAnswered && rebaseContinued) {
          return jsonResponse({
            id: 'boundary-session-2',
            latest_summary_revision_id: 'boundary-summary-revision-2',
            questions: [{ id: 'question-2', status: 'answered', required: true, answered_by_answer_id: 'answer-2' }],
          });
        }
        return jsonResponse(boundarySession2OpenQuestion);
      }
      if (method === 'POST' && path === '/boundary-brainstorming-sessions/boundary-session-1/answers') {
        return jsonResponse({ id: 'answer-1' });
      }
      if (method === 'POST' && path === '/boundary-brainstorming-sessions/boundary-session-2/answers') {
        rebaseAnswered = true;
        return jsonResponse({ id: 'answer-2' });
      }
      if (method === 'POST' && path === '/boundary-brainstorming-sessions/boundary-session-1/continue') {
        return jsonResponse({ id: 'boundary-session-1' });
      }
      if (method === 'POST' && path === '/boundary-brainstorming-sessions/boundary-session-2/continue') {
        rebaseContinued = true;
        return jsonResponse({ id: 'boundary-session-2' });
      }
      if (method === 'POST' && path === '/boundary-brainstorming-sessions/boundary-session-1/summary-revisions/boundary-summary-revision-1/approve') {
        return jsonResponse({ boundary_summary_revision_id: 'boundary-summary-revision-1' });
      }
      if (method === 'PATCH' && path === '/development-plans/development-plan-1/items/item-1') {
        return jsonResponse({ id: 'item-1', revision_id: 'item-revision-2' });
      }
      if (method === 'POST' && path === '/development-plans/development-plan-1/items/item-1/spec-revisions/generate') {
        return jsonResponse({ message: 'stale_boundary_summary_revision' }, 400);
      }
      if (method === 'POST' && path === '/development-plans/development-plan-1/items/item-1/boundary-brainstorming/restart') {
        return jsonResponse({ id: 'boundary-session-2' });
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
      },
      {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        runRemoteWorkerOnce: async () => {
          workerCalls.push('worker');
        },
      },
    );

    await client.seedSourceAndDevelopmentPlanItem();
    const firstBoundaryRound = await client.runBoundaryBrainstormingRound(1);
    await client.answerBoundaryQuestion();
    const secondBoundaryRound = await client.runBoundaryBrainstormingRound(2);
    expect(await client.proposeBoundarySummary()).toEqual({ boundary_summary_revision_id: 'boundary-summary-revision-1' });
    await client.mutateDevelopmentPlanItem();
    await expect(client.assertStaleBoundaryBlocksSpecGeneration()).resolves.toEqual({
      blocked: true,
      blocker_code: 'STALE_BOUNDARY_SUMMARY',
    });
    const rebaseEvidence = await client.rebaseBoundaryBrainstorming();
    expect(rebaseEvidence).toMatchObject({
      rebased_session_id: 'boundary-session-2',
      rebased_boundary_summary_revision_id: 'boundary-summary-revision-2',
      output_schema_versions: [],
      cleanup_status: 'completed',
    });
    expect([
      firstBoundaryRound.output_schema_versions,
      firstBoundaryRound.runtime_job_digests,
      firstBoundaryRound.app_server_evidence_digests,
      secondBoundaryRound.output_schema_versions,
      secondBoundaryRound.runtime_job_digests,
      secondBoundaryRound.app_server_evidence_digests,
      rebaseEvidence.output_schema_versions,
      rebaseEvidence.runtime_job_digests,
      rebaseEvidence.app_server_evidence_digests,
    ]).toEqual([[], [], [], [], [], [], [], [], []]);

    expect(workerCalls).toEqual(['worker', 'worker', 'worker', 'worker']);
    expect(requests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: 'POST',
          path: '/boundary-brainstorming-sessions/boundary-session-1/answers',
          body: expect.objectContaining({ question_id: 'question-1' }),
        }),
        expect.objectContaining({
          method: 'POST',
          path: '/boundary-brainstorming-sessions/boundary-session-1/summary-revisions/boundary-summary-revision-1/approve',
        }),
        expect.objectContaining({
          method: 'PATCH',
          path: '/development-plans/development-plan-1/items/item-1',
        }),
        expect.objectContaining({
          method: 'POST',
          path: '/development-plans/development-plan-1/items/item-1/spec-revisions/generate',
        }),
        expect.objectContaining({
          method: 'POST',
          path: '/development-plans/development-plan-1/items/item-1/boundary-brainstorming/restart',
        }),
        expect.objectContaining({
          method: 'POST',
          path: '/boundary-brainstorming-sessions/boundary-session-2/answers',
          body: expect.objectContaining({ question_id: 'question-2' }),
        }),
        expect.objectContaining({
          method: 'POST',
          path: '/boundary-brainstorming-sessions/boundary-session-2/continue',
        }),
      ]),
    );
  });

  it('keeps invoking the generation worker until the Boundary question is visible', async () => {
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
    await client.runBoundaryBrainstormingRound(1);
    await client.answerBoundaryQuestion();

    expect(workerCalls).toEqual(['generation', 'generation']);
    expect(requests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: 'POST',
          path: '/boundary-brainstorming-sessions/boundary-session-1/answers',
          body: expect.objectContaining({ question_id: 'question-1' }),
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
    await expect(client.runBoundaryBrainstormingRound(1)).rejects.toMatchObject({
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
    await expect(client.runBoundaryBrainstormingRound(1)).rejects.toMatchObject({
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

  it('blocks execution when runtime job evidence cannot be observed from the run result projection yet', async () => {
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
        runRemoteWorkerOnce: async () => {
          workerCalls.push('worker');
        },
      },
    );

    await client.seedSourceAndDevelopmentPlanItem();
    await expect(client.startExecution()).rejects.toMatchObject({
      blockerCode: 'codex_runtime_superpowers_execution_runtime_job_evidence_missing',
    });

    expect(workerCalls).toEqual(['worker']);
    expect(requests).toEqual([
      { method: 'POST', path: '/development-plans' },
      { method: 'POST', path: '/development-plans/development-plan-1/items' },
      { method: 'POST', path: '/development-plans/development-plan-1/items/item-1/execution/start' },
      { method: 'GET', path: '/query/development-plans/development-plan-1/items/item-1' },
      { method: 'GET', path: '/run-sessions/run-session-1' },
    ]);
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
