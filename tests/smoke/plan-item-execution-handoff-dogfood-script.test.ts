import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

import { startWorkflowExecutionBodySchema } from '../../apps/control-plane-api/src/modules/plan-item-workflows/plan-item-workflow.dto';
import {
  loadPlanItemExecutionHandoffRealDogfoodConfig,
  planItemExecutionHandoffRealDogfoodStartBody,
  runPlanItemExecutionHandoffRealDogfood,
} from '../../scripts/plan-item-execution-handoff-real-dogfood';
import {
  planItemExecutionHandoffDogfoodCommand,
  planItemExecutionHandoffProductStartRoute,
} from '../../scripts/plan-item-execution-handoff-dogfood';
import { scanCodexRuntimeSuperpowersNoBaggage } from '../../scripts/check-codex-runtime-superpowers-no-baggage';

const execFileAsync = promisify(execFile);
const dogfoodReportMarker = 'PLAN_ITEM_EXECUTION_HANDOFF_DOGFOOD_REPORT_JSON:';
const realReportMarker = 'PLAN_ITEM_EXECUTION_HANDOFF_REAL_DOGFOOD_REPORT_JSON:';

type DogfoodReport = {
  status: string;
  source: string;
  workflow_id: string;
  route_calls: Array<{ route: string; runtime_call: boolean; status: string }>;
  execution_start: {
    route: string;
    body_keys: string[];
    accepted_public_start_root: string;
    rejected_public_start_roots: string[];
  };
  session_continuity: {
    same_codex_session: boolean;
    resume_thread: boolean;
    thread_digest: string;
    input_capsule_digest: string;
    output_capsule_digest: string;
  };
  no_baggage: {
    owner_actor_id_rejected: boolean;
    legacy_public_package_starts_rejected: boolean;
    old_start_roots_rejected: boolean;
    public_report_policy: string;
  };
};

const parseMarkedJson = <T>(stdout: string, marker: string): T => {
  const reportLine = stdout.split(/\r?\n/).find((line) => line.startsWith(marker));
  if (reportLine === undefined) {
    throw new Error(`Dogfood output did not contain ${marker}`);
  }
  return JSON.parse(reportLine.slice(marker.length)) as T;
};

const dogfoodChildEnv = (): NodeJS.ProcessEnv => {
  const keysToKeep = [
    'PATH',
    'HOME',
    'USER',
    'SHELL',
    'TMPDIR',
    'TEMP',
    'TMP',
    'LANG',
    'LC_ALL',
    'PNPM_HOME',
    'COREPACK_HOME',
  ];
  const noProxy = 'localhost,127.0.0.1,::1,*';
  const env: NodeJS.ProcessEnv = {
    NO_PROXY: noProxy,
    no_proxy: noProxy,
    NODE_USE_ENV_PROXY: '0',
    HTTP_PROXY: '',
    HTTPS_PROXY: '',
    ALL_PROXY: '',
    http_proxy: '',
    https_proxy: '',
    all_proxy: '',
    npm_config_proxy: '',
    npm_config_http_proxy: '',
    npm_config_https_proxy: '',
    npm_config_all_proxy: '',
    npm_config_noproxy: '',
    npm_config_no_proxy: '',
    GLOBAL_AGENT_HTTP_PROXY: '',
    GLOBAL_AGENT_HTTPS_PROXY: '',
    GLOBAL_AGENT_NO_PROXY: '',
  };
  for (const key of keysToKeep) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return env;
};

describe('Plan Item execution handoff dogfood scripts', () => {
  it('package.json exposes Task 8 handoff dogfood scripts', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> };

    expect(packageJson.scripts['dogfood:plan-item-execution-handoff']).toBe(
      'tsx --tsconfig apps/control-plane-api/tsconfig.json scripts/plan-item-execution-handoff-dogfood.ts',
    );
    expect(packageJson.scripts['dogfood:plan-item-execution-handoff:real']).toBe(
      'tsx --tsconfig apps/control-plane-api/tsconfig.json scripts/plan-item-execution-handoff-real-dogfood.ts',
    );
    expect(planItemExecutionHandoffDogfoodCommand).toBe(packageJson.scripts['dogfood:plan-item-execution-handoff']);
  });

  it('deterministic dogfood preserves workflow-owned execution start and public-safe continuity evidence', async () => {
    const result = await execFileAsync('pnpm', ['dogfood:plan-item-execution-handoff'], {
      env: dogfoodChildEnv(),
      maxBuffer: 1024 * 1024 * 4,
    });
    const report = parseMarkedJson<DogfoodReport>(result.stdout, dogfoodReportMarker);

    expect(result.stdout).toContain('start execution from Plan Item Workflow');
    expect(report).toMatchObject({
      status: 'PASS',
      source: 'deterministic_fake_worker',
      execution_start: {
        route: planItemExecutionHandoffProductStartRoute,
        body_keys: ['actor_id', 'idempotency_key', 'rationale_markdown'],
        accepted_public_start_root: 'PlanItemWorkflow',
      },
      session_continuity: {
        same_codex_session: true,
        resume_thread: true,
      },
      no_baggage: {
        owner_actor_id_rejected: true,
        legacy_public_package_starts_rejected: true,
        old_start_roots_rejected: true,
        public_report_policy: 'public_safe_digests_counts_ids_only',
      },
    });
    expect(report.route_calls).toEqual([
      { route: planItemExecutionHandoffProductStartRoute, runtime_call: true, status: 'execution_running' },
    ]);
    expect(report.execution_start.rejected_public_start_roots).toEqual([
      'Source',
      'Spec',
      'Implementation Plan',
      'generic Work Item',
      'DevelopmentPlanItem',
      'ExecutionPackage',
    ]);
    expect(report.execution_start.body_keys).not.toContain('owner_actor_id');
    expect(JSON.stringify(report)).not.toMatch(
      /\/execution-packages\/[^"']+\/(?:run|rerun|force-rerun)|latest_snapshot_|CodexSessionSnapshot|codex_session_snapshot|artifact:\/\/|\/Users\/|lease-token|credential|auth_json/i,
    );
  });

  it('real dogfood skips locally unless acceptance mode and credentials are explicit', async () => {
    const result = await execFileAsync('pnpm', ['dogfood:plan-item-execution-handoff:real'], {
      env: dogfoodChildEnv(),
      maxBuffer: 1024 * 1024,
    });
    const report = parseMarkedJson<{ status: string; reason_code: string }>(result.stdout, realReportMarker);

    expect(report).toEqual({
      status: 'SKIPPED_NON_ACCEPTANCE',
      reason_code: 'plan_item_execution_handoff_real_runtime_acceptance_not_enabled',
    });
  });

  it('real dogfood start request uses only the workflow execution start DTO', () => {
    const config = loadPlanItemExecutionHandoffRealDogfoodConfig({
      FORGELOOP_PLAN_ITEM_EXECUTION_HANDOFF_REAL_ACCEPTANCE: '1',
      FORGELOOP_CONTROL_PLANE_URL: 'http://control-plane.local',
      FORGELOOP_CODEX_RUNTIME_SETUP_ACTOR_ID: 'actor-tech-lead',
      FORGELOOP_PLAN_ITEM_EXECUTION_HANDOFF_WORKFLOW_ID: 'workflow-1',
    });

    expect(config).toBeDefined();
    const body = planItemExecutionHandoffRealDogfoodStartBody(config!);

    expect(startWorkflowExecutionBodySchema.parse(body)).toEqual({
      actor_id: 'actor-tech-lead',
      idempotency_key: 'plan-item-execution-handoff-real-dogfood',
      rationale_markdown: 'Start Plan Item execution handoff real runtime dogfood.',
    });
    expect(body).not.toHaveProperty('owner_actor_id');
    expect(body).not.toHaveProperty('runtime_profile_id');
    expect(body).not.toHaveProperty('credential_binding_id');
  });

  it('real dogfood acceptance path reports public-safe continuity evidence only', async () => {
    const config = loadPlanItemExecutionHandoffRealDogfoodConfig({
      FORGELOOP_PLAN_ITEM_EXECUTION_HANDOFF_REAL_ACCEPTANCE: '1',
      FORGELOOP_CONTROL_PLANE_URL: 'http://control-plane.local',
      FORGELOOP_CODEX_RUNTIME_SETUP_ACTOR_ID: 'actor-tech-lead',
      FORGELOOP_PLAN_ITEM_EXECUTION_HANDOFF_WORKFLOW_ID: 'workflow-1',
    });
    const requestBodies: unknown[] = [];
    const events: string[] = [];
    const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
      events.push(`fetch:${String(url)}`);
      requestBodies.push(init?.body === undefined ? undefined : JSON.parse(String(init.body)));
      if (String(url) === 'http://control-plane.local/query/development-plans/development-plan-1/items/item-1') {
        return new Response(
          JSON.stringify({
            plan_item_workflow: {
              id: 'workflow-1',
              status: 'code_review',
              execution_run_summary: {
                run_session_id: 'run-session-visible',
                execution_package_id: 'execution-package-hidden',
                runtime_job_id: 'runtime-job-hidden',
                codex_session_turn_id: 'turn-hidden',
                status: 'succeeded',
                execution_package_version: 3,
                input_capsule_digest: `sha256:${'1'.repeat(64)}`,
                workspace_bundle_digest: `sha256:${'2'.repeat(64)}`,
                codex_thread_id_digest: `sha256:${'3'.repeat(64)}`,
                finished_at: '2026-06-06T00:10:00.000Z',
              },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({
          id: 'workflow-1',
          development_plan_id: 'development-plan-1',
          development_plan_item_id: 'item-1',
          status: 'execution_running',
          execution_run_summary: {
            run_session_id: 'run-session-visible',
            execution_package_id: 'execution-package-hidden',
            runtime_job_id: 'runtime-job-hidden',
            codex_session_turn_id: 'turn-hidden',
            status: 'queued',
            execution_package_version: 3,
            input_capsule_digest: `sha256:${'1'.repeat(64)}`,
            workspace_bundle_digest: `sha256:${'2'.repeat(64)}`,
            codex_thread_id_digest: `sha256:${'3'.repeat(64)}`,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;

    const report = await runPlanItemExecutionHandoffRealDogfood(config!, {
      fetchImpl,
      runRemoteWorkerOnce: async () => {
        events.push('worker:run_execution');
        return { processed: 1 };
      },
    });

    expect(events).toEqual([
      'fetch:http://control-plane.local/plan-item-workflows/workflow-1/execution/start',
      'worker:run_execution',
      'fetch:http://control-plane.local/query/development-plans/development-plan-1/items/item-1',
    ]);
    expect(requestBodies).toEqual([
      {
        actor_id: 'actor-tech-lead',
        idempotency_key: 'plan-item-execution-handoff-real-dogfood',
        rationale_markdown: 'Start Plan Item execution handoff real runtime dogfood.',
      },
      undefined,
    ]);
    expect(report).toMatchObject({
      status: 'PASS',
      workflow_id: 'workflow-1',
      remote_worker: { processed: 1 },
      route_calls: [{ status: 'execution_running' }],
      execution_run_summary: {
        run_session_id: 'run-session-visible',
        status: 'succeeded',
        input_capsule_digest: `sha256:${'1'.repeat(64)}`,
        workspace_bundle_digest: `sha256:${'2'.repeat(64)}`,
        codex_thread_id_digest: `sha256:${'3'.repeat(64)}`,
        finished_at: '2026-06-06T00:10:00.000Z',
      },
      session_continuity: {
        same_codex_session: true,
        resume_thread: true,
        input_capsule_restored: true,
        output_capsule_expected: true,
      },
    });
    expect(JSON.stringify(report)).not.toMatch(/execution-package-hidden|runtime-job-hidden|turn-hidden|artifact:\/\/|\/Users\/|lease-token|credential/i);
  });

  it('real dogfood blocks start-only running responses without terminal handoff evidence', async () => {
    const config = loadPlanItemExecutionHandoffRealDogfoodConfig({
      FORGELOOP_PLAN_ITEM_EXECUTION_HANDOFF_REAL_ACCEPTANCE: '1',
      FORGELOOP_CONTROL_PLANE_URL: 'http://control-plane.local',
      FORGELOOP_CODEX_RUNTIME_SETUP_ACTOR_ID: 'actor-tech-lead',
      FORGELOOP_PLAN_ITEM_EXECUTION_HANDOFF_WORKFLOW_ID: 'workflow-1',
    });
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({
          id: 'workflow-1',
          status: 'execution_running',
          execution_run_summary: {
            run_session_id: 'run-session-visible',
            status: 'running',
            input_capsule_digest: `sha256:${'1'.repeat(64)}`,
            workspace_bundle_digest: `sha256:${'2'.repeat(64)}`,
            codex_thread_id_digest: `sha256:${'3'.repeat(64)}`,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )) as typeof fetch;

    await expect(runPlanItemExecutionHandoffRealDogfood(config!, { fetchImpl })).rejects.toMatchObject({
      report: {
        status: 'BLOCKED',
        blocker_code: 'plan_item_execution_handoff_real_item_linkage_missing',
      },
    });
  });

  it('no-baggage guard flags Task 8 public-start and stale-continuity names', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'forgeloop-plan-item-execution-handoff-no-baggage-'));
    const forbiddenLines = [
      'await fetch("/execution-packages/package-1/run");',
      'await fetch("/execution-packages/package-1/rerun");',
      'await fetch("/execution-packages/package-1/force-rerun");',
      'await fetch("/requirements/requirement-1/execution/start");',
      'await fetch("/specs/spec-1/execution/start");',
      'await fetch("/implementation-plans/plan-1/execution/start");',
      'await fetch("/work-items/item-1/execution/start");',
      'await fetch("/development-plan-items/item-1/execution/start");',
      'const latest_snapshot_digest = "sha256:old";',
      'type PublicDto = CodexSessionSnapshot;',
      'const old = codex_session_snapshot;',
      'const body = { owner_' + 'actor_id: actorId };',
      'const label = "Start from Execution Package";',
      'const legacy = { archive_bytes_base64: "AAAA" };',
    ];
    try {
      const fixtureFile = 'apps/web/src/features/development-plans/plan-item-workflow-workspace.tsx';
      mkdirSync(join(tempRoot, 'apps/web/src/features/development-plans'), { recursive: true });
      writeFileSync(join(tempRoot, fixtureFile), forbiddenLines.join('\n'));

      const result = scanCodexRuntimeSuperpowersNoBaggage({
        rootDir: tempRoot,
        files: [fixtureFile],
        allowlist: [],
      });

      expect(result.violations.map((violation) => violation.excerpt)).toEqual(forbiddenLines);
      expect(result.violations.map((violation) => violation.pattern)).toEqual([
        'legacy_public_execution_package_start',
        'legacy_public_execution_package_start',
        'legacy_public_execution_package_start',
        'legacy_public_execution_start_root',
        'legacy_public_execution_start_root',
        'legacy_public_execution_start_root',
        'legacy_public_execution_start_root',
        'legacy_public_execution_start_root',
        'legacy_codex_session_snapshot',
        'legacy_codex_session_snapshot',
        'legacy_codex_session_snapshot',
        'public_owner_actor_alias',
        'execution_package_start_root_label',
        'legacy_inline_workspace_bundle_bytes',
      ]);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
