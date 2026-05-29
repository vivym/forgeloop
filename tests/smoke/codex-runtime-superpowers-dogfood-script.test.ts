import { execFileSync } from 'node:child_process';
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
      seedPlanningInputAndDevelopmentPlanItem: vi.fn(async () => {
        calls.push('seedPlanningInputAndDevelopmentPlanItem');
        return { planning_input_id: 'requirement-1', development_plan_id: 'development-plan-1', development_plan_item_id: 'item-1' };
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
      generateAndApproveImplementationPlanDoc: vi.fn(async () => {
        calls.push('generateAndApproveImplementationPlanDoc');
        return { implementation_plan_revision_id: 'implementation-plan-revision-1' };
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
      'seedPlanningInputAndDevelopmentPlanItem',
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
      'generateAndApproveImplementationPlanDoc',
      'startExecution',
      'writeReport',
    ]);
    expect(result.report).toMatchObject({
      status: 'PASS',
      development_plan_item_id: 'item-1',
      boundary_brainstorming_session_id: 'boundary-session-rebased',
      boundary_summary_revision_id: 'boundary-summary-revision-rebased',
      spec_revision_id: 'spec-revision-1',
      implementation_plan_revision_id: 'implementation-plan-revision-1',
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
      implementation_plan_revision_id: 'implementation-plan-revision-1',
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
      implementation_plan_revision_id: 'implementation-plan-revision-1',
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
      FORGELOOP_CODEX_DOGFOOD_REPO_ID: 'repo-1',
      FORGELOOP_CODEX_DOGFOOD_REPO_PATH: '/repo/current',
      FORGELOOP_CODEX_DOGFOOD_REPO_BASE_COMMIT_SHA: 'abc123',
      FORGELOOP_CODEX_DOGFOOD_PLANNING_INPUT_ID: 'requirement-1',
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
        FORGELOOP_CODEX_DOGFOOD_PLANNING_INPUT_ID: 'requirement-1',
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
      if (method === 'POST' && path === '/requirements') {
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
        planningInputType: 'requirement',
        planningInputId: 'source-placeholder',
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

    await expect(client.seedPlanningInputAndDevelopmentPlanItem()).resolves.toEqual({
      planning_input_id: 'work-item-created',
      development_plan_id: 'development-plan-1',
      development_plan_item_id: 'item-1',
    });
    await client.importCodexRuntime();

    expect(requests.map((request) => `${request.method} ${request.path}`)).toEqual([
      'POST /projects',
      'POST /projects/project-created/repos',
      'POST /requirements',
      'POST /development-plans',
      'POST /development-plans/development-plan-1/items',
    ]);
    expect(bootstrapPatches[0]).toMatchObject({
      FORGELOOP_CODEX_DOGFOOD_PROJECT_ID: 'project-created',
      FORGELOOP_CODEX_ALLOWED_SCOPE_PROJECT_ID: 'project-created',
      FORGELOOP_CODEX_DOGFOOD_REPO_ID: 'repo-1',
      FORGELOOP_CODEX_ALLOWED_SCOPE_REPO_ID: 'repo-1',
      FORGELOOP_CODEX_DOGFOOD_PLANNING_INPUT_ID: 'work-item-created',
    });
  });

  it('reports public-safe product API status and reason when a dogfood API call fails', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        {
          code: 'path_policy_docs_allowlist_required',
          message: 'Docs-only dogfood execution requires docs/** in the approved Implementation Plan Doc allowed_paths.',
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
        planningInputType: 'requirement',
        planningInputId: 'requirement-1',
        leaderActorId: 'actor-leader',
        reviewerActorId: 'actor-reviewer',
        noSharedFilesystem: true,
        skipBootstrap: true,
      },
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );

    await expect(client.seedPlanningInputAndDevelopmentPlanItem()).rejects.toMatchObject({
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
      if (method === 'POST' && path === '/requirements') {
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
        planningInputType: 'requirement',
        planningInputId: 'requirement-1',
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

    await client.seedPlanningInputAndDevelopmentPlanItem();
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
        planningInputType: 'requirement',
        planningInputId: 'requirement-1',
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

    await client.seedPlanningInputAndDevelopmentPlanItem();
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
        planningInputType: 'requirement',
        planningInputId: 'requirement-1',
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

    await client.seedPlanningInputAndDevelopmentPlanItem();
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
        planningInputType: 'requirement',
        planningInputId: 'requirement-1',
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

    await client.seedPlanningInputAndDevelopmentPlanItem();
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
        planningInputType: 'requirement',
        planningInputId: 'requirement-1',
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

    await client.seedPlanningInputAndDevelopmentPlanItem();
    await expect(client.generateAndApproveSpec()).rejects.toMatchObject({
      blockerCode: 'codex_runtime_superpowers_dogfood_spec_runtime_job_missing',
    });
    expect(workerCalls).toEqual([]);
  });

  it('requires scheduled Implementation Plan Doc generation runtime job metadata before invoking the worker', async () => {
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
      if (method === 'POST' && path === '/development-plans/development-plan-1/items/item-1/implementation-plan-revisions/generate') {
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
        planningInputType: 'requirement',
        planningInputId: 'requirement-1',
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

    await client.seedPlanningInputAndDevelopmentPlanItem();
    await expect(client.generateAndApproveImplementationPlanDoc()).rejects.toMatchObject({
      blockerCode: 'codex_runtime_superpowers_dogfood_implementation_plan_runtime_job_missing',
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
        planningInputType: 'requirement',
        planningInputId: 'requirement-1',
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

    await client.seedPlanningInputAndDevelopmentPlanItem();
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
        planningInputType: 'requirement',
        planningInputId: 'requirement-1',
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

    await client.seedPlanningInputAndDevelopmentPlanItem();
    await expect(client.generateAndApproveSpec()).rejects.toMatchObject({
      blockerCode: 'codex_runtime_superpowers_product_generation_action_failed',
      report: {
        action_run_id: 'action-run-1',
        action_run_status: 'failed',
      },
    });
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
        planningInputType: 'requirement',
        planningInputId: 'requirement-1',
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

    await client.seedPlanningInputAndDevelopmentPlanItem();
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
        planningInputType: 'requirement',
        planningInputId: 'requirement-1',
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

    await client.seedPlanningInputAndDevelopmentPlanItem();
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
        planningInputType: 'requirement',
        planningInputId: 'requirement-1',
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

    await client.seedPlanningInputAndDevelopmentPlanItem();
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
