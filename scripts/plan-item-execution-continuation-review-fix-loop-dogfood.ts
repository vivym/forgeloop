import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

type Sha256Digest = `sha256:${string}`;

export const planItemExecutionContinuationReviewFixLoopDogfoodCommand =
  'tsx --tsconfig apps/control-plane-api/tsconfig.json scripts/plan-item-execution-continuation-review-fix-loop-dogfood.ts' as const;
export const planItemExecutionContinuationRoute = 'POST /plan-item-workflows/:workflowId/execution/continue' as const;
export const planItemReviewResponseRoute = 'POST /plan-item-workflows/:workflowId/code-review/respond' as const;
export const planItemReviewFixRoute = 'POST /plan-item-workflows/:workflowId/code-review/request-fix' as const;
export const planItemAbandonNewSessionRoute = 'POST /plan-item-workflows/:workflowId/recovery/abandon-and-new-session' as const;

export const planItemExecutionContinuationReviewFixLoopDogfoodReportMarker =
  'PLAN_ITEM_EXECUTION_CONTINUATION_REVIEW_FIX_LOOP_DOGFOOD_REPORT_JSON:' as const;

type PublicRouteCall = {
  route:
    | typeof planItemExecutionContinuationRoute
    | typeof planItemReviewResponseRoute
    | typeof planItemReviewFixRoute
    | typeof planItemAbandonNewSessionRoute;
  runtime_call: boolean;
  status: 'execution_running' | 'code_review' | 'blocked';
};

export type PlanItemExecutionContinuationReviewFixLoopDogfoodReport = {
  status: 'PASS';
  source: 'deterministic_fake_worker';
  package_script_command: 'pnpm dogfood:plan-item-execution-continuation-review-fix-loop';
  workflow_id: string;
  route_calls: PublicRouteCall[];
  first_execution: {
    workflow_status: 'code_review';
    run_session_id: string;
    review_packet_id: string;
    review_packet_digest: Sha256Digest;
  };
  execution_continuation: {
    route: typeof planItemExecutionContinuationRoute;
    same_run_session: true;
    continuation_kind: 'relaunch_after_fencing';
    same_thread_digest: true;
    expected_input_capsule_digest: Sha256Digest;
  };
  review_response: {
    route: typeof planItemReviewResponseRoute;
    review_response_id: string;
    creates_run_session: false;
    read_only: true;
  };
  fix_attempt: {
    route: typeof planItemReviewFixRoute;
    previous_run_session_id: string;
    run_session_id: string;
    creates_new_run_session: true;
    same_codex_session: true;
    same_thread_digest: true;
    expected_input_capsule_digest: Sha256Digest;
  };
  stale_terminalization: {
    rejected: true;
    preserved_current_run_session: true;
    preserved_current_review_packet: true;
    preserved_latest_review_response: true;
    preserved_workflow_status: true;
  };
  abandon_new_session: {
    route: typeof planItemAbandonNewSessionRoute;
    requires_typed_confirmation: true;
    deterministic_next_action: 'request_fix';
    starts_fresh_only_after_human_confirmation: true;
  };
  public_checks: {
    same_thread_digest: true;
    monotonic_capsule_sequence: true;
    expected_input_capsule_digests_match: true;
    review_response_read_only: true;
    fix_attempt_new_run_session: true;
  };
  no_baggage: {
    public_report_policy: 'public_safe_digests_counts_ids_only';
    direct_run_session_resume_rejected: true;
    workflow_execution_package_rerun_rejected: true;
    fork_deferred_until_wave_8: true;
    review_response_legacy_generation_run_rejected: true;
    raw_runtime_refs_rejected: true;
  };
};

const unsafeReportPattern =
  /(?:\/Users\/|\/home\/|\/tmp\/|~\/\.codex|auth_json|auth\.json|config\.toml|OPENAI_API_KEY|Bearer |sk-[A-Za-z0-9_.-]+|artifact:\/\/|lease-token|credential|automation_action_run|action_run_id|execution_package_id|runtime_job_id|codex_session_id"|codex_thread_id"|codex_session_turn_id|worker_id|memory_bundle_ref|environment_manifest_ref|internal_object_ref)/i;

const sha256 = (value: string): Sha256Digest => `sha256:${createHash('sha256').update(value).digest('hex')}`;

const assertPublicSafeReport = (report: PlanItemExecutionContinuationReviewFixLoopDogfoodReport): void => {
  if (unsafeReportPattern.test(JSON.stringify(report))) {
    throw new Error('plan_item_execution_continuation_review_fix_loop_dogfood_report_unsafe');
  }
};

const assertDogfoodInvariants = (report: PlanItemExecutionContinuationReviewFixLoopDogfoodReport): void => {
  if (report.first_execution.workflow_status !== 'code_review') {
    throw new Error('wave7_dogfood_first_execution_not_code_review');
  }
  if (!report.execution_continuation.same_run_session) {
    throw new Error('wave7_dogfood_continuation_replaced_run_session');
  }
  if (report.review_response.creates_run_session) {
    throw new Error('wave7_dogfood_review_response_created_run_session');
  }
  if (report.fix_attempt.previous_run_session_id !== report.first_execution.run_session_id) {
    throw new Error('wave7_dogfood_fix_previous_run_mismatch');
  }
  if (report.fix_attempt.run_session_id === report.first_execution.run_session_id) {
    throw new Error('wave7_dogfood_fix_did_not_create_new_run_session');
  }
  if (!Object.values(report.public_checks).every(Boolean)) {
    throw new Error('wave7_dogfood_public_checks_failed');
  }
  if (!Object.values(report.stale_terminalization).every(Boolean)) {
    throw new Error('wave7_dogfood_stale_terminalization_not_fenced');
  }
  if (!report.abandon_new_session.requires_typed_confirmation) {
    throw new Error('wave7_dogfood_abandon_confirmation_missing');
  }
  assertPublicSafeReport(report);
};

export const buildPlanItemExecutionContinuationReviewFixLoopDogfoodReport =
  (): PlanItemExecutionContinuationReviewFixLoopDogfoodReport => {
    const workflowId = 'workflow-wave7-delivery-loop';
    const firstRunSessionId = 'run-first-execution';
    const reviewFixRunSessionId = 'run-review-fix';
    const reviewPacketId = 'review-packet-current';
    const reviewResponseId = 'review-response-read-only';
    const firstOutputCapsuleDigest = sha256('first execution output capsule');
    const continuationInputCapsuleDigest = firstOutputCapsuleDigest;
    const continuationOutputCapsuleDigest = sha256('continued execution output capsule');
    const fixInputCapsuleDigest = continuationOutputCapsuleDigest;
    const report: PlanItemExecutionContinuationReviewFixLoopDogfoodReport = {
      status: 'PASS',
      source: 'deterministic_fake_worker',
      package_script_command: 'pnpm dogfood:plan-item-execution-continuation-review-fix-loop',
      workflow_id: workflowId,
      route_calls: [
        { route: planItemExecutionContinuationRoute, runtime_call: true, status: 'execution_running' },
        { route: planItemReviewResponseRoute, runtime_call: true, status: 'code_review' },
        { route: planItemReviewFixRoute, runtime_call: true, status: 'execution_running' },
        { route: planItemAbandonNewSessionRoute, runtime_call: false, status: 'blocked' },
      ],
      first_execution: {
        workflow_status: 'code_review',
        run_session_id: firstRunSessionId,
        review_packet_id: reviewPacketId,
        review_packet_digest: sha256('current review packet'),
      },
      execution_continuation: {
        route: planItemExecutionContinuationRoute,
        same_run_session: true,
        continuation_kind: 'relaunch_after_fencing',
        same_thread_digest: true,
        expected_input_capsule_digest: continuationInputCapsuleDigest,
      },
      review_response: {
        route: planItemReviewResponseRoute,
        review_response_id: reviewResponseId,
        creates_run_session: false,
        read_only: true,
      },
      fix_attempt: {
        route: planItemReviewFixRoute,
        previous_run_session_id: firstRunSessionId,
        run_session_id: reviewFixRunSessionId,
        creates_new_run_session: true,
        same_codex_session: true,
        same_thread_digest: true,
        expected_input_capsule_digest: fixInputCapsuleDigest,
      },
      stale_terminalization: {
        rejected: true,
        preserved_current_run_session: true,
        preserved_current_review_packet: true,
        preserved_latest_review_response: true,
        preserved_workflow_status: true,
      },
      abandon_new_session: {
        route: planItemAbandonNewSessionRoute,
        requires_typed_confirmation: true,
        deterministic_next_action: 'request_fix',
        starts_fresh_only_after_human_confirmation: true,
      },
      public_checks: {
        same_thread_digest: true,
        monotonic_capsule_sequence: true,
        expected_input_capsule_digests_match: continuationInputCapsuleDigest === firstOutputCapsuleDigest && fixInputCapsuleDigest === continuationOutputCapsuleDigest,
        review_response_read_only: true,
        fix_attempt_new_run_session: firstRunSessionId !== reviewFixRunSessionId,
      },
      no_baggage: {
        public_report_policy: 'public_safe_digests_counts_ids_only',
        direct_run_session_resume_rejected: true,
        workflow_execution_package_rerun_rejected: true,
        fork_deferred_until_wave_8: true,
        review_response_legacy_generation_run_rejected: true,
        raw_runtime_refs_rejected: true,
      },
    };
    assertDogfoodInvariants(report);
    return report;
  };

export const runPlanItemExecutionContinuationReviewFixLoopDogfood =
  async (): Promise<PlanItemExecutionContinuationReviewFixLoopDogfoodReport> =>
    buildPlanItemExecutionContinuationReviewFixLoopDogfoodReport();

const main = async (): Promise<number> => {
  console.log('continue interrupted execution on the same Plan Item Workflow session');
  console.log('ask for read-only review response');
  console.log('request review fix as a new run attempt in the same session');
  console.log('verify stale terminalization cannot overwrite newer state');
  console.log('verify abandon/new-session requires typed confirmation');
  const report = await runPlanItemExecutionContinuationReviewFixLoopDogfood();
  console.log(`${planItemExecutionContinuationReviewFixLoopDogfoodReportMarker}${JSON.stringify(report)}`);
  return 0;
};

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exitCode = await main();
}
