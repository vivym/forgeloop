import { describe, expect, it, vi } from 'vitest';
import type { ExecutorResult } from '@forgeloop/contracts';
import { InMemoryP0Repository, type TraceEventRecord } from '../../packages/db/src';
import type { Artifact, Decision, ReviewPacket } from '../../packages/domain/src/index';
import { finalizePackageRunWithExecutorResult } from '../../packages/workflow/src';
import {
  seedReadyStartedPackageRun,
  succeededExecutorResult,
  succeededSelfReview,
} from '../helpers/p0-runtime-fixtures';

class LeasingRepository extends InMemoryP0Repository {
  calls = 0;
  insideLease = false;
  leaseReadCount = 0;
  leaseCheckTimes: string[] = [];

  override async getRunSession(runSessionId: string) {
    if (this.insideLease) {
      this.leaseReadCount += 1;
    }

    return super.getRunSession(runSessionId);
  }

  override async withActiveRunWorkerLease<T>(
    runSessionId: string,
    lease: { workerId: string; leaseToken: string; now: string },
    write: (repository: LeasingRepository) => Promise<T>,
  ): Promise<T> {
    this.calls += 1;
    this.leaseCheckTimes.push(lease.now);
    return super.withActiveRunWorkerLease(runSessionId, lease, async (repository) => {
      this.insideLease = true;
      try {
        return await write(repository as LeasingRepository);
      } finally {
        this.insideLease = false;
      }
    });
  }
}

class ArtifactConcurrencyDetectingRepository extends InMemoryP0Repository {
  inFlightArtifactWrites = 0;
  maxConcurrentArtifactWrites = 0;

  override async saveArtifact(artifact: Artifact): Promise<void> {
    this.inFlightArtifactWrites += 1;
    this.maxConcurrentArtifactWrites = Math.max(this.maxConcurrentArtifactWrites, this.inFlightArtifactWrites);
    try {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await super.saveArtifact(artifact);
    } finally {
      this.inFlightArtifactWrites -= 1;
    }
  }
}

class TraceFailingRepository extends InMemoryP0Repository {
  override async saveTraceEvent(_event: TraceEventRecord): Promise<void> {
    throw new Error('trace store unavailable');
  }
}

class TraceFailingLeasedRepository extends LeasingRepository {
  traceEventWriteInsideLease = false;

  override async saveTraceEvent(_event: TraceEventRecord): Promise<void> {
    this.traceEventWriteInsideLease ||= this.insideLease;
    throw new Error('trace store unavailable');
  }
}

const retryableFailedExecutorResult = (
  runSessionId: string,
  rawMetadata: ExecutorResult['raw_metadata'] = {},
): ExecutorResult => ({
  run_session_id: runSessionId,
  executor_type: 'mock',
  executor_version: 'test-executor',
  status: 'failed',
  started_at: '2026-05-05T00:00:00.000Z',
  finished_at: '2026-05-05T00:01:00.000Z',
  summary: 'Unit tests failed.',
  changed_files: [],
  checks: [
    {
      check_id: 'unit-tests',
      command: 'pnpm test tests/workflow',
      status: 'failed',
      exit_code: 1,
      duration_seconds: 2,
      blocks_review: true,
    },
  ],
  artifacts: [],
  failure: { kind: 'required_check_failed', message: 'Unit tests failed.', retryable: true },
  raw_metadata: rawMetadata,
});

const nonRetryableFailedExecutorResult = (runSessionId: string): ExecutorResult => ({
  run_session_id: runSessionId,
  executor_type: 'mock',
  executor_version: 'test-executor',
  status: 'failed',
  started_at: '2026-05-05T00:00:00.000Z',
  finished_at: '2026-05-05T00:01:00.000Z',
  summary: 'Executor process failed permanently.',
  changed_files: [],
  checks: [],
  artifacts: [],
  failure: { kind: 'executor_process_failed', message: 'Executor process failed permanently.', retryable: false },
  raw_metadata: {},
});

describe('execution finalizer', () => {
  it('persists artifacts sequentially during leased finalization', async () => {
    const repo = new ArtifactConcurrencyDetectingRepository();
    const context = await seedReadyStartedPackageRun(repo);
    const result = succeededExecutorResult(context.runSession.id);
    const lease = await repo.claimRunWorkerLease({
      run_session_id: context.runSession.id,
      worker_id: 'worker-1',
      lease_token: 'lease-token-1',
      now: '2026-05-07T00:00:00.000Z',
      lease_duration_ms: 60_000,
    });

    await finalizePackageRunWithExecutorResult({
      repository: repo,
      runSessionId: context.runSession.id,
      executorResult: result,
      selfReview: async () => succeededSelfReview(),
      workerLease: { workerId: lease.worker_id, leaseToken: lease.lease_token },
      now: () => '2026-05-07T00:00:00.000Z',
    });

    expect(repo.maxConcurrentArtifactWrites).toBe(1);
    expect(await repo.listArtifactsForObject('run_session', context.runSession.id)).toHaveLength(result.artifacts.length);
  });

  it('writes terminal evidence trace events, links, and artifact refs', async () => {
    const repo = new InMemoryP0Repository();
    const context = await seedReadyStartedPackageRun(repo);
    const result = succeededExecutorResult(context.runSession.id);

    const finalResult = await finalizePackageRunWithExecutorResult({
      repository: repo,
      runSessionId: context.runSession.id,
      executorResult: result,
      selfReview: async () => succeededSelfReview(),
      now: () => '2026-05-07T00:00:00.000Z',
    });
    const terminalTraceEvent = (await repo.listTraceEventsForSubject('run_session', context.runSession.id)).find(
      (event) => event.event_type === 'run_terminal_evidence_recorded',
    );

    expect(finalResult.reviewPacketId).toBe(`review-packet:${context.runSession.id}`);
    expect(terminalTraceEvent).toMatchObject({
      subject_type: 'run_session',
      subject_id: context.runSession.id,
      payload: {
        run_session_id: context.runSession.id,
        execution_package_id: context.executionPackage.id,
        work_item_id: context.executionPackage.work_item_id,
        status: 'succeeded',
        review_packet_id: `review-packet:${context.runSession.id}`,
      },
    });
    expect(await repo.listTraceLinks(terminalTraceEvent!.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relationship: 'belongs_to',
          object_type: 'work_item',
          object_id: context.executionPackage.work_item_id,
        }),
        expect.objectContaining({
          relationship: 'belongs_to',
          object_type: 'execution_package',
          object_id: context.executionPackage.id,
        }),
        expect.objectContaining({
          relationship: 'generated_by',
          object_type: 'run_session',
          object_id: context.runSession.id,
        }),
        expect.objectContaining({
          relationship: 'supports',
          object_type: 'review_packet',
          object_id: `review-packet:${context.runSession.id}`,
        }),
      ]),
    );
    expect(await repo.listTraceArtifactRefs(terminalTraceEvent!.id)).toHaveLength(result.artifacts.length);
  });

  it('keeps terminal records when finalizer trace writes fail', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const repo = new TraceFailingRepository();
    const context = await seedReadyStartedPackageRun(repo);
    const result = succeededExecutorResult(context.runSession.id);
    const preexistingDecision: Decision = {
      id: 'decision-before-finalizer',
      object_type: 'review_packet',
      object_id: 'review-packet-before-finalizer',
      actor_id: 'actor-reviewer',
      decision: 'approved',
      summary: 'Preexisting terminal decision.',
      created_at: '2026-05-06T00:00:00.000Z',
    };
    await repo.saveDecision(preexistingDecision);

    try {
      const finalResult = await finalizePackageRunWithExecutorResult({
        repository: repo,
        runSessionId: context.runSession.id,
        executorResult: result,
        selfReview: async () => succeededSelfReview(),
        now: () => '2026-05-07T00:00:00.000Z',
      });

      expect(finalResult).toEqual({
        runSessionId: context.runSession.id,
        status: 'succeeded',
        reviewPacketId: `review-packet:${context.runSession.id}`,
      });
      expect(await repo.getRunSession(context.runSession.id)).toMatchObject({ status: 'succeeded', summary: result.summary });
      expect(await repo.listReviewPacketsForPackage(context.executionPackage.id)).toHaveLength(1);
      expect(await repo.listArtifactsForObject('run_session', context.runSession.id)).toHaveLength(result.artifacts.length);
      expect(await repo.listDecisionsForObject(preexistingDecision.object_type, preexistingDecision.object_id)).toEqual([
        preexistingDecision,
      ]);
      expect(await repo.listTraceEventsForSubject('run_session', context.runSession.id)).toEqual([]);
      expect(warnSpy).toHaveBeenCalledWith(
        '[forgeloop:p0.trace] best-effort trace write failed',
        expect.objectContaining({ source: 'workflow-finalizer', error: 'trace store unavailable' }),
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('keeps leased terminal records when finalizer trace writes fail after the lease transaction', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const repo = new TraceFailingLeasedRepository();
    const context = await seedReadyStartedPackageRun(repo);
    const result = succeededExecutorResult(context.runSession.id);
    const lease = await repo.claimRunWorkerLease({
      run_session_id: context.runSession.id,
      worker_id: 'worker-1',
      lease_token: 'lease-token-1',
      now: '2026-05-07T00:00:00.000Z',
      lease_duration_ms: 60_000,
    });

    try {
      const finalResult = await finalizePackageRunWithExecutorResult({
        repository: repo,
        runSessionId: context.runSession.id,
        executorResult: result,
        selfReview: async () => succeededSelfReview(),
        workerLease: { workerId: lease.worker_id, leaseToken: lease.lease_token },
        now: () => '2026-05-07T00:00:00.000Z',
      });

      expect(finalResult).toEqual({
        runSessionId: context.runSession.id,
        status: 'succeeded',
        reviewPacketId: `review-packet:${context.runSession.id}`,
      });
      expect(repo.traceEventWriteInsideLease).toBe(false);
      expect(await repo.getRunSession(context.runSession.id)).toMatchObject({ status: 'succeeded', summary: result.summary });
      expect(await repo.listReviewPacketsForPackage(context.executionPackage.id)).toHaveLength(1);
      expect(await repo.listArtifactsForObject('run_session', context.runSession.id)).toHaveLength(result.artifacts.length);
      expect(warnSpy).toHaveBeenCalledWith(
        '[forgeloop:p0.trace] best-effort trace write failed',
        expect.objectContaining({ source: 'workflow-finalizer', error: 'trace store unavailable' }),
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

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

  it('reconciles a matching terminal failed retry without replaying terminal side effects', async () => {
    const repo = new InMemoryP0Repository();
    const context = await seedReadyStartedPackageRun(repo);
    const runSessionId = context.runSession.id;
    const terminalAt = '2026-05-07T00:00:00.000Z';
    const persistedResult = retryableFailedExecutorResult(runSessionId, { nested: { beta: true, alpha: 1 } });
    const semanticallyEqualResult = retryableFailedExecutorResult(runSessionId, { nested: { alpha: 1, beta: true } });

    await repo.saveRunSession({
      ...context.runSession,
      status: 'failed',
      executor_type: 'mock',
      executor_result: persistedResult,
      run_spec: context.runSession.run_spec!,
      changed_files: persistedResult.changed_files,
      check_results: persistedResult.checks,
      artifacts: [],
      log_refs: [],
      summary: persistedResult.summary,
      failure_kind: persistedResult.failure!.kind,
      failure_reason: persistedResult.failure!.message,
      started_at: terminalAt,
      finished_at: terminalAt,
      updated_at: terminalAt,
    });

    const first = await finalizePackageRunWithExecutorResult({
      repository: repo,
      runSessionId,
      executorResult: semanticallyEqualResult,
      selfReview: async () => succeededSelfReview(),
      now: () => '2026-05-07T00:00:01.000Z',
    });
    const packageAfterFirst = await repo.getExecutionPackage(context.executionPackage.id);
    const runAfterFirst = await repo.getRunSession(runSessionId);
    const historiesAfterFirst = await repo.listStatusHistory(runSessionId, 'run_session');
    const eventsAfterFirst = await repo.listObjectEvents(runSessionId, 'run_session');
    const artifactsAfterFirst = await repo.listArtifactsForObject('run_session', runSessionId);

    const second = await finalizePackageRunWithExecutorResult({
      repository: repo,
      runSessionId,
      executorResult: semanticallyEqualResult,
      selfReview: async () => succeededSelfReview(),
      now: () => '2026-05-07T00:00:02.000Z',
    });
    const packageAfterSecond = await repo.getExecutionPackage(context.executionPackage.id);
    const runAfterSecond = await repo.getRunSession(runSessionId);

    expect(first).toEqual({ runSessionId, status: 'failed' });
    expect(second).toEqual(first);
    expect(packageAfterFirst).toMatchObject({
      phase: 'ready',
      activity_state: 'idle',
      gate_state: 'none',
      last_failure_summary: 'Unit tests failed.',
      updated_at: '2026-05-07T00:00:01.000Z',
    });
    expect(packageAfterSecond).toEqual(packageAfterFirst);
    expect(runAfterFirst?.updated_at).toBe(terminalAt);
    expect(runAfterSecond).toEqual(runAfterFirst);
    expect(historiesAfterFirst).toHaveLength(0);
    expect(eventsAfterFirst).toHaveLength(0);
    expect(artifactsAfterFirst).toHaveLength(0);
    expect(await repo.listReviewPacketsForPackage(context.executionPackage.id)).toHaveLength(0);
  });

  it('reconciles a matching terminal nonretryable failure to blocked without review packet', async () => {
    const repo = new InMemoryP0Repository();
    const context = await seedReadyStartedPackageRun(repo);
    const runSessionId = context.runSession.id;
    const terminalAt = '2026-05-07T00:00:00.000Z';
    const result = nonRetryableFailedExecutorResult(runSessionId);

    await repo.saveRunSession({
      ...context.runSession,
      status: 'failed',
      executor_type: 'mock',
      executor_result: result,
      run_spec: context.runSession.run_spec!,
      changed_files: result.changed_files,
      check_results: result.checks,
      artifacts: [],
      log_refs: [],
      summary: result.summary,
      failure_kind: result.failure!.kind,
      failure_reason: result.failure!.message,
      started_at: terminalAt,
      finished_at: terminalAt,
      updated_at: terminalAt,
    });

    const finalResult = await finalizePackageRunWithExecutorResult({
      repository: repo,
      runSessionId,
      executorResult: result,
      selfReview: async () => succeededSelfReview(),
      now: () => '2026-05-07T00:00:01.000Z',
    });
    const updatedPackage = await repo.getExecutionPackage(context.executionPackage.id);

    expect(finalResult).toEqual({ runSessionId, status: 'failed' });
    expect(updatedPackage).toMatchObject({
      activity_state: 'blocked',
      blocked_reason: 'Executor process failed permanently.',
    });
    expect(await repo.listReviewPacketsForPackage(context.executionPackage.id)).toHaveLength(0);
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
    expect(repo.leaseReadCount).toBeGreaterThan(0);
  });

  it('runs self-review outside the worker lease fence', async () => {
    const repo = new LeasingRepository();
    const context = await seedReadyStartedPackageRun(repo);
    const result = succeededExecutorResult(context.runSession.id);
    const runSessionId = context.runSession.id;
    const lease = await repo.claimRunWorkerLease({
      run_session_id: runSessionId,
      worker_id: 'worker-1',
      lease_token: 'lease-1',
      now: '2026-05-07T00:00:00.000Z',
      expires_at: '2026-05-09T00:10:00.000Z',
    });
    let selfReviewRanInsideLease = true;

    const finalResult = await finalizePackageRunWithExecutorResult({
      repository: repo,
      runSessionId,
      executorResult: result,
      selfReview: async () => {
        selfReviewRanInsideLease = repo.insideLease;
        return succeededSelfReview();
      },
      workerLease: { workerId: lease.worker_id, leaseToken: lease.lease_token },
      now: () => '2026-05-07T00:00:01.000Z',
    });

    expect(finalResult).toEqual({ runSessionId, status: 'succeeded', reviewPacketId: `review-packet:${runSessionId}` });
    expect(selfReviewRanInsideLease).toBe(false);
    expect(repo.calls).toBe(2);
  });

  it('refreshes the worker lease check timestamp before post-review writes', async () => {
    const repo = new LeasingRepository();
    const context = await seedReadyStartedPackageRun(repo);
    const result = succeededExecutorResult(context.runSession.id);
    const runSessionId = context.runSession.id;
    const lease = await repo.claimRunWorkerLease({
      run_session_id: runSessionId,
      worker_id: 'worker-1',
      lease_token: 'lease-1',
      now: '2026-05-07T00:00:00.000Z',
      expires_at: '2026-05-07T00:00:02.000Z',
    });
    const times = [
      '2026-05-07T00:00:00.000Z',
      '2026-05-07T00:00:01.000Z',
      '2026-05-07T00:00:03.000Z',
    ];

    await expect(
      finalizePackageRunWithExecutorResult({
        repository: repo,
        runSessionId,
        executorResult: result,
        selfReview: async () => succeededSelfReview(),
        workerLease: { workerId: lease.worker_id, leaseToken: lease.lease_token },
        now: () => times.shift() ?? '2026-05-07T00:00:03.000Z',
      }),
    ).rejects.toThrow('Run session run-session-1 does not have an active worker lease');
    expect(repo.calls).toBe(2);
    expect(repo.leaseCheckTimes).toEqual(['2026-05-07T00:00:01.000Z', '2026-05-07T00:00:03.000Z']);
    expect(await repo.listReviewPacketsForPackage(context.executionPackage.id)).toHaveLength(0);
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
