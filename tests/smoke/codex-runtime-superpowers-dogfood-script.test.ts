import { mkdtempSync, rmSync } from 'node:fs';
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

const digest = (seed: string): string => `sha256:${seed.repeat(64).slice(0, 64)}`;

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
        return { boundary_brainstorming_session_id: `boundary-session-${roundNumber}` };
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
        };
      }),
      approveBoundarySummary: vi.fn(async () => {
        calls.push('approveBoundarySummary');
        return { boundary_summary_revision_id: 'boundary-summary-revision-rebased' };
      }),
      generateAndApproveSpec: vi.fn(async () => {
        calls.push('generateAndApproveSpec');
        return { spec_revision_id: 'spec-revision-1' };
      }),
      generateAndApproveExecutionPlan: vi.fn(async () => {
        calls.push('generateAndApproveExecutionPlan');
        return { execution_plan_revision_id: 'execution-plan-revision-1' };
      }),
      startExecution: vi.fn(async () => {
        calls.push('startExecution');
        return {
          execution_id: 'execution-1',
          workspace_bundle_digest: digest('e'),
          mounted_task_workspace_digest: digest('f'),
          changed_files: ['docs/superpowers/reports/codex-runtime-superpowers-dogfood.md'],
        };
      }),
      writeReport: vi.fn(async (report) => {
        calls.push('writeReport');
        return { report_path: `docs/superpowers/reports/${report.execution_id}.md` };
      }),
    };

    const result = await runCodexRuntimeSuperpowersDogfood({ client });

    expect(calls).toEqual([
      'importCodexRuntime',
      'smokeGenerationWorker',
      'startNoSharedFilesystemRunWorker',
      'seedSourceAndDevelopmentPlanItem',
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
      changed_files: ['docs/superpowers/reports/codex-runtime-superpowers-dogfood.md'],
    });
    expect(result.reportPath).toBe('docs/superpowers/reports/execution-1.md');
  });

  it('renders a public-safe report with product object names and digests only', () => {
    const markdown = renderCodexRuntimeSuperpowersDogfoodReport({
      status: 'PASS',
      development_plan_item_id: 'item-1',
      boundary_brainstorming_session_id: 'boundary-session-1',
      boundary_summary_revision_id: 'boundary-summary-revision-1',
      spec_revision_id: 'spec-revision-1',
      execution_plan_revision_id: 'execution-plan-revision-1',
      execution_id: 'execution-1',
      runtime_profile_revision_digests: [digest('a')],
      credential_binding_version_digests: [digest('b')],
      no_shared_filesystem_worker: true,
      workspace_bundle_digest: digest('c'),
      mounted_task_workspace_digest: digest('d'),
      stale_boundary_negative_check: {
        blocked: true,
        blocker_code: 'STALE_BOUNDARY_SUMMARY',
        rebased_session_id: 'boundary-session-2',
        rebased_boundary_summary_revision_id: 'boundary-summary-revision-2',
      },
      changed_files: ['docs/superpowers/reports/codex-runtime-superpowers-dogfood.md'],
    });

    expect(codexRuntimeSuperpowersDogfoodCommand).toBe(
      'tsx --tsconfig apps/control-plane-api/tsconfig.json scripts/codex-runtime-superpowers-dogfood.ts',
    );
    expect(markdown).toContain('Codex Runtime Superpowers Dogfood');
    expect(markdown).toContain('Development Plan Item: item-1');
    expect(markdown).toContain('Boundary Brainstorming Session: boundary-session-1');
    expect(markdown).toContain(`workspace_bundle_digest=${digest('c')}`);
    expect(markdown).toContain(`mounted_task_workspace_digest=${digest('d')}`);
    expect(markdown).not.toContain('/Users/');
    expect(markdown).not.toContain('/tmp/');
    expect(markdown).not.toContain('~/.codex');
    expect(markdown).not.toContain('OPENAI_API_KEY');
    expect(markdown).not.toContain('docker-exec:');
  });

  it('rejects unsafe public report values and path-traversal report filenames', async () => {
    const safeReport = {
      status: 'PASS' as const,
      development_plan_item_id: 'item-1',
      boundary_brainstorming_session_id: 'boundary-session-1',
      boundary_summary_revision_id: 'boundary-summary-revision-1',
      spec_revision_id: 'spec-revision-1',
      execution_plan_revision_id: 'execution-plan-revision-1',
      execution_id: 'execution-1',
      runtime_profile_revision_digests: [digest('a')],
      credential_binding_version_digests: [digest('b')],
      no_shared_filesystem_worker: true as const,
      workspace_bundle_digest: digest('c'),
      mounted_task_workspace_digest: digest('d'),
      stale_boundary_negative_check: {
        blocked: true as const,
        blocker_code: 'STALE_BOUNDARY_SUMMARY' as const,
        rebased_session_id: 'boundary-session-2',
        rebased_boundary_summary_revision_id: 'boundary-summary-revision-2',
      },
      changed_files: ['docs/superpowers/reports/codex-runtime-superpowers-dogfood.md'],
    };

    expect(() =>
      renderCodexRuntimeSuperpowersDogfoodReport({
        ...safeReport,
        changed_files: ['/home/runner/.codex/auth.json', 'http://127.0.0.1:3000/internal', 'Bearer secret'],
      }),
    ).toThrow(/codex_runtime_superpowers_dogfood_report_unsafe/);

    const tempRoot = mkdtempSync(join(tmpdir(), 'forgeloop-dogfood-report-'));
    try {
      await expect(
        new FilesystemCodexRuntimeSuperpowersDogfoodReporter(tempRoot).write(
          { ...safeReport, execution_id: '../outside' },
          renderCodexRuntimeSuperpowersDogfoodReport(safeReport),
        ),
      ).rejects.toThrow(/execution_id_invalid/);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
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
      FORGELOOP_CODEX_DOGFOOD_SOURCE_OBJECT_ID: 'requirement-1',
      FORGELOOP_CODEX_NO_SHARED_FILESYSTEM: '1',
    });

    expect(config.boundaryQuestionId).toBeUndefined();
    expect(config.boundarySummaryRevisionId).toBeUndefined();
  });

  it('sanitizes import-only host Codex env before invoking no-shared remote workers', () => {
    const sanitized = sanitizeCodexRemoteWorkerDogfoodEnv({
      FORGELOOP_CONTROL_PLANE_URL: 'http://control-plane.invalid',
      FORGELOOP_CODEX_NO_SHARED_FILESYSTEM: '1',
      FORGELOOP_CODEX_CONFIG_TOML_PATH: '/Users/dev/.codex/config.toml',
      FORGELOOP_CODEX_AUTH_JSON_PATH: '/Users/dev/.codex/auth.json',
      FORGELOOP_CODEX_HOME: '/Users/dev/.codex',
      CODEX_HOME: '/Users/dev/.codex',
      FORGELOOP_AUTOMATION_ALLOWED_REPO_ROOTS: '/Users/dev/repo',
    });

    expect(sanitized).toMatchObject({
      FORGELOOP_CONTROL_PLANE_URL: 'http://control-plane.invalid',
      FORGELOOP_CODEX_NO_SHARED_FILESYSTEM: '1',
    });
    expect(sanitized.FORGELOOP_CODEX_CONFIG_TOML_PATH).toBeUndefined();
    expect(sanitized.FORGELOOP_CODEX_AUTH_JSON_PATH).toBeUndefined();
    expect(sanitized.FORGELOOP_CODEX_HOME).toBeUndefined();
    expect(sanitized.CODEX_HOME).toBeUndefined();
    expect(sanitized.FORGELOOP_AUTOMATION_ALLOWED_REPO_ROOTS).toBeUndefined();
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
    const boundarySession2Responses = [
      {
        id: 'boundary-session-2',
        latest_summary_revision_id: 'boundary-summary-revision-2',
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
        return jsonResponse(boundarySession1Responses.shift() ?? boundarySession1Responses[boundarySession1Responses.length - 1]);
      }
      if (method === 'GET' && path === '/boundary-brainstorming-sessions/boundary-session-2') {
        return jsonResponse(boundarySession2Responses.shift() ?? boundarySession2Responses[boundarySession2Responses.length - 1]);
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
    await client.runBoundaryBrainstormingRound(1);
    await client.answerBoundaryQuestion();
    await client.runBoundaryBrainstormingRound(2);
    expect(await client.proposeBoundarySummary()).toEqual({ boundary_summary_revision_id: 'boundary-summary-revision-1' });
    await client.mutateDevelopmentPlanItem();
    await expect(client.assertStaleBoundaryBlocksSpecGeneration()).resolves.toEqual({
      blocked: true,
      blocker_code: 'STALE_BOUNDARY_SUMMARY',
    });
    await expect(client.rebaseBoundaryBrainstorming()).resolves.toEqual({
      rebased_session_id: 'boundary-session-2',
      rebased_boundary_summary_revision_id: 'boundary-summary-revision-2',
    });

    expect(workerCalls).toEqual(['worker', 'worker', 'worker']);
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
      ]),
    );
  });

  it('reads execution evidence from the Development Plan Item projection after the worker applies the run result', async () => {
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
        return jsonResponse({ id: 'execution-1' });
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
    await expect(client.startExecution()).resolves.toEqual({
      execution_id: 'execution-1',
      workspace_bundle_digest: digest('w'),
      mounted_task_workspace_digest: digest('m'),
      changed_files: ['docs/superpowers/reports/codex-runtime-superpowers-dogfood.md'],
    });

    expect(workerCalls).toEqual(['worker']);
    expect(requests).toEqual([
      { method: 'POST', path: '/development-plans' },
      { method: 'POST', path: '/development-plans/development-plan-1/items' },
      { method: 'POST', path: '/development-plans/development-plan-1/items/item-1/execution/start' },
      { method: 'GET', path: '/query/development-plans/development-plan-1/items/item-1' },
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
        return jsonResponse({ id: 'execution-1' });
      }
      if (method === 'GET' && path === '/query/development-plans/development-plan-1/items/item-1') {
        return jsonResponse({ executions: [{ id: 'execution-1' }] });
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
});

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
