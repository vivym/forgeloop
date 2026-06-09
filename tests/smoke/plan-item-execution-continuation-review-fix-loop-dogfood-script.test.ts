import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

import {
  abandonWorkflowSessionBodySchema,
  continueWorkflowExecutionBodySchema,
  requestWorkflowReviewFixBodySchema,
  respondToWorkflowReviewBodySchema,
} from '../../apps/control-plane-api/src/modules/plan-item-workflows/plan-item-workflow.dto';
import {
  buildPlanItemExecutionContinuationReviewFixLoopDogfoodReport,
  planItemExecutionContinuationReviewFixLoopDogfoodCommand,
  planItemExecutionContinuationReviewFixLoopDogfoodReportMarker,
} from '../../scripts/plan-item-execution-continuation-review-fix-loop-dogfood';
import {
  abandonBodyForPlanItemExecutionContinuationReviewFixLoopRealDogfood,
  continueBodyForPlanItemExecutionContinuationReviewFixLoopRealDogfood,
  loadPlanItemExecutionContinuationReviewFixLoopRealDogfoodConfig,
  requestFixBodyForPlanItemExecutionContinuationReviewFixLoopRealDogfood,
  respondBodyForPlanItemExecutionContinuationReviewFixLoopRealDogfood,
  runPlanItemExecutionContinuationReviewFixLoopRealDogfood,
} from '../../scripts/plan-item-execution-continuation-review-fix-loop-real-dogfood';

const execFileAsync = promisify(execFile);
const realReportMarker = 'PLAN_ITEM_EXECUTION_CONTINUATION_REVIEW_FIX_LOOP_REAL_DOGFOOD_REPORT_JSON:';
const digestA = `sha256:${'a'.repeat(64)}` as const;
const digestB = `sha256:${'b'.repeat(64)}` as const;
const digestC = `sha256:${'c'.repeat(64)}` as const;
const digestD = `sha256:${'d'.repeat(64)}` as const;

type DogfoodReport = ReturnType<typeof buildPlanItemExecutionContinuationReviewFixLoopDogfoodReport>;

const parseMarkedJson = <T>(stdout: string, marker: string): T => {
  const reportLine = stdout.split(/\r?\n/).find((line) => line.startsWith(marker));
  if (reportLine === undefined) {
    throw new Error(`Dogfood output did not contain ${marker}`);
  }
  return JSON.parse(reportLine.slice(marker.length)) as T;
};

const dogfoodChildEnv = (): NodeJS.ProcessEnv => {
  const keysToKeep = ['PATH', 'HOME', 'USER', 'SHELL', 'TMPDIR', 'TEMP', 'TMP', 'LANG', 'LC_ALL', 'PNPM_HOME', 'COREPACK_HOME'];
  const env: NodeJS.ProcessEnv = {
    NO_PROXY: 'localhost,127.0.0.1,::1,*',
    no_proxy: 'localhost,127.0.0.1,::1,*',
    NODE_USE_ENV_PROXY: '0',
    HTTP_PROXY: '',
    HTTPS_PROXY: '',
    ALL_PROXY: '',
    http_proxy: '',
    https_proxy: '',
    all_proxy: '',
  };
  for (const key of keysToKeep) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return env;
};

describe('Plan Item execution continuation review fix-loop dogfood scripts', () => {
  it('package.json exposes Wave 7 dogfood scripts', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> };

    expect(packageJson.scripts['dogfood:plan-item-execution-continuation-review-fix-loop']).toBe(
      'tsx --tsconfig apps/control-plane-api/tsconfig.json scripts/plan-item-execution-continuation-review-fix-loop-dogfood.ts',
    );
    expect(packageJson.scripts['dogfood:plan-item-execution-continuation-review-fix-loop:real']).toBe(
      'tsx --tsconfig apps/control-plane-api/tsconfig.json scripts/plan-item-execution-continuation-review-fix-loop-real-dogfood.ts',
    );
    expect(planItemExecutionContinuationReviewFixLoopDogfoodCommand).toBe(
      packageJson.scripts['dogfood:plan-item-execution-continuation-review-fix-loop'],
    );
  });

  it('deterministic dogfood reports the complete continuation, review response, fix, stale, and abandon loop', async () => {
    const result = await execFileAsync('pnpm', ['dogfood:plan-item-execution-continuation-review-fix-loop'], {
      env: dogfoodChildEnv(),
      maxBuffer: 1024 * 1024,
    });
    const report = parseMarkedJson<DogfoodReport>(result.stdout, planItemExecutionContinuationReviewFixLoopDogfoodReportMarker);

    expect(result.stdout).toContain('continue interrupted execution');
    expect(result.stdout).toContain('read-only review response');
    expect(result.stdout).toContain('request review fix');
    expect(report).toMatchObject({
      status: 'PASS',
      source: 'deterministic_fake_worker',
      first_execution: { workflow_status: 'code_review' },
      execution_continuation: { same_run_session: true, same_thread_digest: true },
      review_response: { creates_run_session: false, read_only: true },
      fix_attempt: { creates_new_run_session: true, same_codex_session: true, same_thread_digest: true },
      stale_terminalization: {
        rejected: true,
        preserved_current_run_session: true,
        preserved_current_review_packet: true,
        preserved_latest_review_response: true,
        preserved_workflow_status: true,
      },
      abandon_new_session: {
        requires_typed_confirmation: true,
        deterministic_next_action: 'request_fix',
      },
      public_checks: {
        same_thread_digest: true,
        monotonic_capsule_sequence: true,
        expected_input_capsule_digests_match: true,
        review_response_read_only: true,
        fix_attempt_new_run_session: true,
      },
      no_baggage: {
        direct_run_session_resume_rejected: true,
        workflow_execution_package_rerun_rejected: true,
        fork_deferred_until_wave_8: true,
        review_response_legacy_generation_run_rejected: true,
        raw_runtime_refs_rejected: true,
      },
    });
    expect(report.fix_attempt.run_session_id).not.toBe(report.first_execution.run_session_id);
    expect(JSON.stringify(report)).not.toMatch(
      /codex_thread_id"|codex_session_id"|codex_session_turn_id|artifact:\/\/|\/Users\/|lease-token|worker_id|credential|automation_action_run|action_run_id/i,
    );
  });

  it('real dogfood skips locally unless acceptance mode is explicit', async () => {
    const result = await execFileAsync('pnpm', ['dogfood:plan-item-execution-continuation-review-fix-loop:real'], {
      env: dogfoodChildEnv(),
      maxBuffer: 1024 * 1024,
    });
    const report = parseMarkedJson<{ status: string; reason_code: string }>(result.stdout, realReportMarker);

    expect(report).toEqual({
      status: 'SKIPPED_NON_ACCEPTANCE',
      reason_code: 'plan_item_execution_continuation_review_fix_loop_real_runtime_acceptance_not_enabled',
    });
  });

  it('real dogfood command bodies use only Wave 7 public product DTOs', () => {
    const config = loadPlanItemExecutionContinuationReviewFixLoopRealDogfoodConfig({
      FORGELOOP_WAVE7_REAL_DOGFOOD_ACCEPTANCE: '1',
      FORGELOOP_CONTROL_PLANE_URL: 'http://control-plane.local',
      FORGELOOP_CODEX_RUNTIME_SETUP_ACTOR_ID: 'actor-tech-lead',
      FORGELOOP_WAVE7_WORKFLOW_ID: 'workflow-1',
      FORGELOOP_WAVE7_REVIEW_PACKET_ID: 'review-packet-1',
      FORGELOOP_WAVE7_REVIEW_PACKET_DIGEST: digestA,
    });

    expect(config).toBeDefined();
    expect(continueWorkflowExecutionBodySchema.parse(continueBodyForPlanItemExecutionContinuationReviewFixLoopRealDogfood(config!))).toEqual({
      actor_id: 'actor-tech-lead',
      idempotency_key: 'plan-item-execution-continuation-review-fix-loop-real-continue',
      input_markdown: 'Continue the interrupted Plan Item execution in the same Codex session.',
    });
    expect(respondToWorkflowReviewBodySchema.parse(respondBodyForPlanItemExecutionContinuationReviewFixLoopRealDogfood(config!))).toMatchObject({
      actor_id: 'actor-tech-lead',
      expected_review_packet_id: 'review-packet-1',
      expected_review_packet_digest: digestA,
    });
    expect(requestWorkflowReviewFixBodySchema.parse(requestFixBodyForPlanItemExecutionContinuationReviewFixLoopRealDogfood(config!))).toMatchObject({
      actor_id: 'actor-tech-lead',
      expected_review_packet_id: 'review-packet-1',
      expected_review_packet_digest: digestA,
    });
    expect(abandonWorkflowSessionBodySchema.parse(abandonBodyForPlanItemExecutionContinuationReviewFixLoopRealDogfood(config!))).toMatchObject({
      actor_id: 'actor-tech-lead',
      next_action: 'request_fix',
      confirmation_phrase: 'abandon current session and start new session',
    });
  });

  it('real dogfood acceptance path requires same thread, monotonic capsules, read-only response, and a new fix run', async () => {
    const config = loadPlanItemExecutionContinuationReviewFixLoopRealDogfoodConfig({
      FORGELOOP_WAVE7_REAL_DOGFOOD_ACCEPTANCE: '1',
      FORGELOOP_CONTROL_PLANE_URL: 'http://control-plane.local',
      FORGELOOP_CODEX_RUNTIME_SETUP_ACTOR_ID: 'actor-tech-lead',
      FORGELOOP_WAVE7_WORKFLOW_ID: 'workflow-1',
      FORGELOOP_WAVE7_REVIEW_PACKET_ID: 'review-packet-1',
      FORGELOOP_WAVE7_REVIEW_PACKET_DIGEST: digestA,
    });
    const fetchImpl = (async (url: RequestInfo | URL) => {
      const route = String(url);
      if (route.endsWith('/execution/continue')) {
        return new Response(
          JSON.stringify({
            id: 'workflow-1',
            status: 'code_review',
            execution_run_summary: {
              run_session_id: 'run-first',
              status: 'succeeded',
              input_capsule_digest: digestA,
              codex_thread_id_digest: digestD,
            },
            queued_actions: [{ kind: 'continue_execution', status: 'succeeded', expected_input_capsule_digest: digestA, output_capsule_digest: digestB, output_capsule_sequence: 1, codex_thread_id_digest: digestD }],
            attempt_history: [{ run_session_id: 'run-first', attempt_kind: 'first_execution' }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (route.endsWith('/code-review/respond')) {
        return new Response(
          JSON.stringify({
            id: 'workflow-1',
            status: 'code_review',
            execution_run_summary: {
              run_session_id: 'run-first',
              status: 'succeeded',
              input_capsule_digest: digestB,
              codex_thread_id_digest: digestD,
            },
            queued_actions: [{ kind: 'respond_to_review', status: 'succeeded', expected_input_capsule_digest: digestB, output_capsule_digest: digestC, output_capsule_sequence: 2, codex_thread_id_digest: digestD }],
            attempt_history: [{ run_session_id: 'run-first', attempt_kind: 'first_execution' }],
            latest_review_response: { id: 'review-response-1', status: 'succeeded', previous_run_session_id: 'run-first' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({
          id: 'workflow-1',
          status: 'execution_running',
          execution_run_summary: {
            run_session_id: 'run-fix',
            status: 'queued',
            input_capsule_digest: digestC,
            codex_thread_id_digest: digestD,
          },
          queued_actions: [{ kind: 'request_fix', status: 'succeeded', expected_input_capsule_digest: digestC, output_capsule_digest: digestD, output_capsule_sequence: 3, codex_thread_id_digest: digestD }],
          attempt_history: [
            { run_session_id: 'run-first', attempt_kind: 'first_execution' },
            { run_session_id: 'run-fix', attempt_kind: 'review_fix', previous_run_session_id: 'run-first' },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;

    const report = await runPlanItemExecutionContinuationReviewFixLoopRealDogfood(config!, { fetchImpl });

    expect(report).toMatchObject({
      status: 'PASS',
      same_thread_digest: true,
      monotonic_capsule_sequence: true,
      expected_input_capsule_digests_match: true,
      review_response_read_only: true,
      fix_attempt_new_run_session: true,
    });
    expect(JSON.stringify(report)).not.toMatch(/artifact:\/\/|\/Users\/|credential|automation_action_run|action_run_id|codex_session_id"/i);
  });
});
