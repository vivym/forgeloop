import { describe, expect, it } from 'vitest';
import { InMemoryP0Repository } from '../../packages/db/src';
import type { ReviewPacket } from '../../packages/domain/src/index';
import { finalizePackageRunWithExecutorResult } from '../../packages/workflow/src';
import {
  seedReadyStartedPackageRun,
  succeededExecutorResult,
  succeededSelfReview,
} from '../helpers/p0-runtime-fixtures';

class LeasingRepository extends InMemoryP0Repository {
  calls = 0;

  override async withActiveRunWorkerLease<T>(
    runSessionId: string,
    lease: { workerId: string; leaseToken: string; now: string },
    write: (repository: LeasingRepository) => Promise<T>,
  ): Promise<T> {
    this.calls += 1;
    return super.withActiveRunWorkerLease(runSessionId, lease, write);
  }
}

describe('execution finalizer', () => {
  it('is idempotent when retrying a succeeded executor result after partial persistence', async () => {
    const repo = new InMemoryP0Repository();
    const context = await seedReadyStartedPackageRun(repo);
    const result = succeededExecutorResult(context.runSession.id);

    const first = await finalizePackageRunWithExecutorResult({
      repository: repo,
      runSessionId: context.runSession.id,
      executorResult: result,
      selfReview: async () => succeededSelfReview(),
      now: () => '2026-05-07T00:00:00.000Z',
    });
    const second = await finalizePackageRunWithExecutorResult({
      repository: repo,
      runSessionId: context.runSession.id,
      executorResult: result,
      selfReview: async () => succeededSelfReview(),
      now: () => '2026-05-07T00:00:01.000Z',
    });

    expect(second).toEqual(first);
    expect(await repo.listReviewPacketsForPackage(context.executionPackage.id)).toHaveLength(1);
  });

  it('does not replay terminal side effects when retrying a matching succeeded terminal run', async () => {
    const repo = new InMemoryP0Repository();
    const context = await seedReadyStartedPackageRun(repo);
    const result = succeededExecutorResult(context.runSession.id);
    const runSessionId = context.runSession.id;
    const runSpec = context.runSession.run_spec!;
    const packageId = context.executionPackage.id;
    const terminalAt = '2026-05-07T00:00:00.000Z';

    await repo.saveRunSession({
      ...context.runSession,
      status: 'succeeded',
      executor_type: 'mock',
      executor_result: result,
      run_spec: runSpec,
      changed_files: result.changed_files,
      check_results: result.checks,
      artifacts: result.artifacts,
      log_refs: [],
      summary: result.summary,
      started_at: terminalAt,
      finished_at: terminalAt,
      updated_at: terminalAt,
    });
    await repo.saveExecutionPackage({
      ...context.executionPackage,
      phase: 'review',
      activity_state: 'awaiting_human',
      gate_state: 'awaiting_human_review',
      updated_at: terminalAt,
    });
    await repo.saveReviewPacket({
      id: `review-packet:${runSessionId}`,
      run_session_id: runSessionId,
      execution_package_id: packageId,
      reviewer_actor_id: 'actor-reviewer',
      spec_revision_id: runSpec.spec_revision_id,
      plan_revision_id: runSpec.plan_revision_id,
      status: 'ready',
      decision: 'none',
      changed_files: result.changed_files,
      check_result_summary: '2 checks passed.',
      self_review: succeededSelfReview(),
      risk_notes: [],
      requested_changes: [],
      created_at: terminalAt,
      updated_at: terminalAt,
    } satisfies ReviewPacket);

    const first = await finalizePackageRunWithExecutorResult({
      repository: repo,
      runSessionId,
      executorResult: result,
      selfReview: async () => succeededSelfReview(),
      now: () => '2026-05-07T00:00:00.000Z',
    });
    const packageAfterFirst = await repo.getExecutionPackage(packageId);
    const historiesAfterFirst = await repo.listStatusHistory(runSessionId, 'run_session');
    const eventsAfterFirst = await repo.listObjectEvents(runSessionId, 'run_session');
    const artifactsAfterFirst = await repo.listArtifactsForObject('run_session', runSessionId);
    const reviewPacketsAfterFirst = await repo.listReviewPacketsForPackage(packageId);

    const second = await finalizePackageRunWithExecutorResult({
      repository: repo,
      runSessionId,
      executorResult: result,
      selfReview: async () => succeededSelfReview(),
      now: () => '2026-05-07T00:00:01.000Z',
    });
    const packageAfterSecond = await repo.getExecutionPackage(packageId);
    const historiesAfterSecond = await repo.listStatusHistory(runSessionId, 'run_session');
    const eventsAfterSecond = await repo.listObjectEvents(runSessionId, 'run_session');
    const artifactsAfterSecond = await repo.listArtifactsForObject('run_session', runSessionId);
    const reviewPacketsAfterSecond = await repo.listReviewPacketsForPackage(packageId);

    expect(second).toEqual(first);
    expect(packageAfterSecond).toEqual(packageAfterFirst);
    expect(historiesAfterSecond).toEqual(historiesAfterFirst);
    expect(eventsAfterSecond).toEqual(eventsAfterFirst);
    expect(artifactsAfterSecond).toEqual(artifactsAfterFirst);
    expect(reviewPacketsAfterSecond).toEqual(reviewPacketsAfterFirst);
  });

  it('fences terminal writes through the active worker lease even when now is omitted', async () => {
    const repo = new LeasingRepository();
    const context = await seedReadyStartedPackageRun(repo);
    const result = succeededExecutorResult(context.runSession.id);
    const runSessionId = context.runSession.id;
    const runSpec = context.runSession.run_spec!;
    const packageId = context.executionPackage.id;
    const terminalAt = '2026-05-07T00:00:00.000Z';
    const lease = await repo.claimRunWorkerLease({
      run_session_id: runSessionId,
      worker_id: 'worker-1',
      lease_token: 'lease-1',
      now: terminalAt,
      expires_at: '2026-05-09T00:10:00.000Z',
    });

    await repo.saveRunSession({
      ...context.runSession,
      status: 'succeeded',
      executor_type: 'mock',
      executor_result: result,
      run_spec: runSpec,
      changed_files: result.changed_files,
      check_results: result.checks,
      artifacts: result.artifacts,
      log_refs: [],
      summary: result.summary,
      started_at: terminalAt,
      finished_at: terminalAt,
      updated_at: terminalAt,
    });
    await repo.saveExecutionPackage({
      ...context.executionPackage,
      phase: 'review',
      activity_state: 'awaiting_human',
      gate_state: 'awaiting_human_review',
      updated_at: terminalAt,
    });
    await repo.saveReviewPacket({
      id: `review-packet:${runSessionId}`,
      run_session_id: runSessionId,
      execution_package_id: packageId,
      reviewer_actor_id: 'actor-reviewer',
      spec_revision_id: runSpec.spec_revision_id,
      plan_revision_id: runSpec.plan_revision_id,
      status: 'ready',
      decision: 'none',
      changed_files: result.changed_files,
      check_result_summary: '2 checks passed.',
      self_review: succeededSelfReview(),
      risk_notes: [],
      requested_changes: [],
      created_at: terminalAt,
      updated_at: terminalAt,
    } satisfies ReviewPacket);

    const finalResult = await finalizePackageRunWithExecutorResult({
      repository: repo,
      runSessionId,
      executorResult: result,
      selfReview: async () => succeededSelfReview(),
      workerLease: { workerId: lease.worker_id, leaseToken: lease.lease_token },
    });

    expect(finalResult).toMatchObject({ runSessionId, status: 'succeeded', reviewPacketId: `review-packet:${runSessionId}` });
    expect(repo.calls).toBe(1);
  });

  it('rejects a stale worker lease when finalizing without now', async () => {
    const repo = new LeasingRepository();
    const context = await seedReadyStartedPackageRun(repo);
    const result = succeededExecutorResult(context.runSession.id);
    const runSessionId = context.runSession.id;
    const runSpec = context.runSession.run_spec!;
    const terminalAt = '2026-05-07T00:00:00.000Z';

    await repo.saveRunSession({
      ...context.runSession,
      status: 'succeeded',
      executor_type: 'mock',
      executor_result: result,
      run_spec: runSpec,
      changed_files: result.changed_files,
      check_results: result.checks,
      artifacts: result.artifacts,
      log_refs: [],
      summary: result.summary,
      started_at: terminalAt,
      finished_at: terminalAt,
      updated_at: terminalAt,
    });
    await repo.saveExecutionPackage({
      ...context.executionPackage,
      phase: 'review',
      activity_state: 'awaiting_human',
      gate_state: 'awaiting_human_review',
      updated_at: terminalAt,
    });

    await expect(
      finalizePackageRunWithExecutorResult({
        repository: repo,
        runSessionId,
        executorResult: result,
        selfReview: async () => succeededSelfReview(),
        workerLease: { workerId: 'worker-1', leaseToken: 'stale-token' },
      }),
    ).rejects.toThrow('Run session run-session-1 does not have an active worker lease');
    expect(repo.calls).toBe(1);
  });
});
