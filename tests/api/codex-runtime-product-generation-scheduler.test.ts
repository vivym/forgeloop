import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProductGenerationResultService } from '../../apps/control-plane-api/src/modules/automation/product-generation-result.service';
import { CodexRuntimeService } from '../../apps/control-plane-api/src/modules/codex-runtime/codex-runtime.service';
import { ProductGenerationRuntimeSchedulerService } from '../../apps/control-plane-api/src/modules/codex-runtime/product-generation-runtime-scheduler.service';
import { DELIVERY_REPOSITORY } from '../../apps/control-plane-api/src/modules/core/control-plane-tokens';
import { ControlPlaneRuntimeService } from '../../apps/control-plane-api/src/modules/core/control-plane-runtime.service';
import { CodexSessionLeaseService } from '../../apps/control-plane-api/src/modules/plan-item-workflows/codex-session-lease.service';
import { automationActorIdHeaderName } from '../../packages/automation/src';
import {
  codexCanonicalDigest,
  codexCredentialPayloadDigest,
  validateCodexRuntimeJobTerminalResult,
  type CodexGenerationRuntimeJobResult,
  type CodexGenerationWorkloadV1,
  type CodexRuntimeJob,
  type ContextManifest,
} from '../../packages/domain/src';
import { InMemoryDeliveryRepository, type CreateOrReplayAutomationActionRunInput, type DeliveryRepository } from '../../packages/db/src';
import {
  seedDevelopmentPlanItem,
} from '../helpers/plan-item-workflow-fixtures';

const now = '2026-05-31T00:01:30.000Z';
const expectedThreadDigest = codexCanonicalDigest({ kind: 'codex_app_server_thread_id', thread_id: 'thread-1' });

describe('Product generation CodexSession scheduler', () => {
  let app: { get(token: unknown): unknown };
  let repository: DeliveryRepository;
  let scheduler: ProductGenerationRuntimeSchedulerService;

  beforeEach(() => {
    vi.stubEnv('FORGELOOP_AUTOMATION_TEST_NOW', now);
    repository = new InMemoryDeliveryRepository();
    const runtime = new ControlPlaneRuntimeService('test');
    app = {
      get(token: unknown) {
        if (token === DELIVERY_REPOSITORY) return repository;
        throw new Error(`Unexpected test provider lookup: ${String(token)}`);
      },
    };
    scheduler = new ProductGenerationRuntimeSchedulerService(repository, runtime);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('builds a trusted start-thread workload for an unbound active session and redacts it publicly', async () => {
    const seeded = await seedSchedulerWorkflow('aaaaaaaa');
    const turnId = await createTurn(seeded.workflow.id, seeded.workflow.active_codex_session_id, seeded.ids.actorTech, 'aaaaaaaa');

    const scheduled = await scheduler.schedule(
      scheduleInput(seeded.workflow.id, seeded.workflow.active_codex_session_id, turnId, seeded.ids.project, 'unbound-start'),
    );
    const runtimeJob = await repository.getCodexRuntimeJob({ runtime_job_id: scheduled.runtime_job.id });
    expect(runtimeJob).toBeDefined();

    const workload = runtimeJob!.input_json as CodexGenerationWorkloadV1;
    expect(workload.codex_session_runtime_context).toMatchObject({
      schema_version: 'codex_session_runtime_context.v1',
      codex_session_id: seeded.workflow.active_codex_session_id,
      codex_session_turn_id: turnId,
      lease_epoch: 1,
      worker_id: runtimeJob!.worker_id,
      worker_session_digest: expect.stringMatching(/^sha256:/),
      turn_group_status: 'intermediate',
      continuation: { kind: 'start_thread' },
    });
    expect(workload.codex_session_runtime_context?.lease_id).toEqual(expect.any(String));
    expect(workload.codex_session_terminalization).toMatchObject({
      schema_version: 'codex_session_terminalization.v1',
      lease_token: expect.any(String),
    });
    expect(workload.codex_session_terminalization?.lease_token).not.toHaveLength(0);
    expect(scheduled.runtime_job.input).toEqual({
      input_digest: runtimeJob!.input_digest,
      schema_version: 'codex_generation_workload.v1',
    });
    expect(JSON.stringify(scheduled.runtime_job)).not.toContain('codex_thread_id');
    expect(JSON.stringify(scheduled.runtime_job)).not.toContain('lease_token');
  });

  it('replays an existing session-backed runtime job without claiming a second session lease', async () => {
    const seeded = await seedSchedulerWorkflow('aaaaaaab');
    const turnId = await createTurn(seeded.workflow.id, seeded.workflow.active_codex_session_id, seeded.ids.actorTech, 'aaaaaaab');
    const input = scheduleInput(seeded.workflow.id, seeded.workflow.active_codex_session_id, turnId, seeded.ids.project, 'running-replay');

    const first = await scheduler.schedule(input);
    const firstAction = await repository.getAutomationActionRun(first.action_run.id);
    const firstRuntimeJob = (await repository.getCodexRuntimeJob({ runtime_job_id: first.runtime_job.id }))!;
    const firstWorkload = firstRuntimeJob.input_json as CodexGenerationWorkloadV1;
    expect(firstAction).toMatchObject({ attempt: 1 });
    expect(firstWorkload.codex_session_runtime_context).toMatchObject({ lease_epoch: 1 });
    await expect(repository.getCodexSessionTurn(turnId)).resolves.toMatchObject({ status: 'running' });

    const replay = await scheduler.schedule(input);

    const replayedAction = await repository.getAutomationActionRun(first.action_run.id);
    const replayedTurn = await repository.getCodexSessionTurn(turnId);
    const replayedRuntimeJob = (await repository.getCodexRuntimeJob({ runtime_job_id: replay.runtime_job.id }))!;
    expect(replay.runtime_job.id).toBe(first.runtime_job.id);
    expect(replayedAction).toMatchObject({ attempt: 1 });
    expect(replayedTurn).toMatchObject({ status: 'running' });
    expect(replayedRuntimeJob.input_digest).toBe(firstRuntimeJob.input_digest);
  });

  it('rebuilds expired session-backed runtime jobs instead of replaying dead launch fences', async () => {
    const seeded = await seedSchedulerWorkflow('aaaaaaac');
    const turnId = await createTurn(seeded.workflow.id, seeded.workflow.active_codex_session_id, seeded.ids.actorTech, 'aaaaaaac');
    const input = scheduleInput(seeded.workflow.id, seeded.workflow.active_codex_session_id, turnId, seeded.ids.project, 'expired-rebuild');

    const first = await scheduler.schedule(input);
    const firstAction = await repository.getAutomationActionRun(first.action_run.id);
    const firstRuntimeJob = (await repository.getCodexRuntimeJob({ runtime_job_id: first.runtime_job.id }))!;
    const firstWorkload = firstRuntimeJob.input_json as CodexGenerationWorkloadV1;
    const retryNow = new Date(Date.parse(firstRuntimeJob.expires_at) + 30_000).toISOString();
    vi.stubEnv('FORGELOOP_AUTOMATION_TEST_NOW', retryNow);
    await repository.heartbeatCodexWorker({
      worker_id: firstRuntimeJob.worker_id,
      session_token: `plan-item-workflow-session-${seeded.ids.project}`,
      nonce: 'expired-rebuild-worker-heartbeat',
      nonce_timestamp: retryNow,
      status: 'online',
      control_channel_status: 'connected',
      active_lease_count: 0,
      capabilities: ['generation'],
      now: retryNow,
    });
    const worker = await repository.findAvailableCodexWorker({
      project_id: seeded.ids.project,
      target_kind: 'generation',
      docker_image_digest: codexCanonicalDigest({ label: 'plan-item-workflow-generation-docker-image' }),
      network_policy_digest: codexCanonicalDigest({ mode: 'disabled' }),
      now: retryNow,
    });
    expect(worker).toBeDefined();

    const second = await scheduler.schedule(input);

    const secondAction = await repository.getAutomationActionRun(second.action_run.id);
    const secondRuntimeJob = (await repository.getCodexRuntimeJob({ runtime_job_id: second.runtime_job.id }))!;
    const secondWorkload = secondRuntimeJob.input_json as CodexGenerationWorkloadV1;
    expect(second.action_run.id).toBe(first.action_run.id);
    expect(second.runtime_job.id).not.toBe(first.runtime_job.id);
    expect(secondAction).toMatchObject({ attempt: 2, claimed_at: retryNow });
    expect(firstAction).toMatchObject({ attempt: 1 });
    expect(secondRuntimeJob.input_digest).not.toBe(firstRuntimeJob.input_digest);
    expect(secondWorkload).toMatchObject({
      created_at: retryNow,
      expires_at: new Date(Date.parse(retryNow) + 10 * 60 * 1000).toISOString(),
    });
    expect(secondWorkload.codex_session_runtime_context).toMatchObject({
      lease_epoch: 2,
      continuation: { kind: 'start_thread' },
    });
    expect(secondWorkload.codex_session_runtime_context?.lease_id).not.toBe(firstWorkload.codex_session_runtime_context?.lease_id);
    await expect(repository.getCodexSession(seeded.workflow.active_codex_session_id)).resolves.toMatchObject({
      status: 'running',
      active_lease_id: secondWorkload.codex_session_runtime_context?.lease_id,
    });
  });

  it('routes a bound active session to its live runner and builds a trusted resume-thread workload', async () => {
    const seeded = await seedSchedulerWorkflow('bbbbbbbb');
    const firstTurnId = await createTurn(seeded.workflow.id, seeded.workflow.active_codex_session_id, seeded.ids.actorTech, 'bbbbbb01');
    await bindSessionThread(seeded.workflow.active_codex_session_id, seeded.workflow.id, firstTurnId);
    const worker = await repository.findAvailableCodexWorker({
      project_id: seeded.ids.project,
      target_kind: 'generation',
      docker_image_digest: codexCanonicalDigest({ label: 'plan-item-workflow-generation-docker-image' }),
      network_policy_digest: codexCanonicalDigest({ mode: 'disabled' }),
      now,
    });
    expect(worker).toBeDefined();
    await repository.markCodexSessionRunnerOwner({
      session_id: seeded.workflow.active_codex_session_id,
      runner_worker_id: worker!.id,
      runner_runtime_job_id: 'runner-runtime-job-1',
      runner_launch_lease_id: 'runner-launch-lease-1',
      runner_expires_at: '2026-05-31T00:10:00.000Z',
      now,
    });
    const nextTurnId = await createTurn(seeded.workflow.id, seeded.workflow.active_codex_session_id, seeded.ids.actorTech, 'bbbbbb02', {
      expected_input_capsule_digest: 'sha256:capsule-thread-bind',
    });

    const scheduled = await scheduler.schedule(
      scheduleInput(seeded.workflow.id, seeded.workflow.active_codex_session_id, nextTurnId, seeded.ids.project, 'bound-resume'),
    );
    const runtimeJob = await repository.getCodexRuntimeJob({ runtime_job_id: scheduled.runtime_job.id });
    expect(runtimeJob).toBeDefined();
    expect(runtimeJob!.worker_id).toBe(worker!.id);

    const context = (runtimeJob!.input_json as CodexGenerationWorkloadV1).codex_session_runtime_context;
    expect(context).toMatchObject({
      codex_session_id: seeded.workflow.active_codex_session_id,
      codex_session_turn_id: nextTurnId,
      runner_runtime_job_id: 'runner-runtime-job-1',
      runner_launch_lease_id: 'runner-launch-lease-1',
      turn_group_status: 'intermediate',
      continuation: {
        kind: 'resume_thread',
        codex_thread_id: 'thread-1',
        codex_thread_id_digest: expectedThreadDigest,
      },
    });
  });

  it('routes a bound active session even when its single-concurrency runner worker is occupied by the live runner', async () => {
    const seeded = await seedSchedulerWorkflow('bbbbbbba');
    const runnerRuntimeJob = await createLiveSessionRunner(
      seeded.workflow.id,
      seeded.workflow.active_codex_session_id,
      seeded.ids.actorTech,
      seeded.ids.project,
      'bbbbba',
    );
    const workerSessionToken = `plan-item-workflow-session-${seeded.ids.project}`;
    const workerRecord = (repository as unknown as { codexWorkerRegistrations: Map<string, { registration: { max_concurrency: number } }> }).codexWorkerRegistrations.get(
      runnerRuntimeJob.worker_id,
    );
    expect(workerRecord).toBeDefined();
    workerRecord!.registration.max_concurrency = 1;
    await repository.heartbeatCodexWorker({
      worker_id: runnerRuntimeJob.worker_id,
      session_token: workerSessionToken,
      nonce: 'single-concurrency-runner-heartbeat',
      nonce_timestamp: now,
      status: 'online',
      control_channel_status: 'connected',
      active_lease_count: 1,
      capabilities: ['generation'],
      now,
    });
    await expect(
      repository.findAvailableCodexWorker({
        worker_id: runnerRuntimeJob.worker_id,
        project_id: seeded.ids.project,
        target_kind: 'generation',
        docker_image_digest: codexCanonicalDigest({ label: 'plan-item-workflow-generation-docker-image' }),
        network_policy_digest: codexCanonicalDigest({ mode: 'disabled' }),
        now,
      }),
    ).resolves.toBeUndefined();
    const nextTurnId = await createTurn(seeded.workflow.id, seeded.workflow.active_codex_session_id, seeded.ids.actorTech, 'bbbbba02', {
      expected_input_capsule_digest: 'sha256:capsule-thread-bind',
    });

    const scheduled = await scheduler.schedule(
      scheduleInput(
        seeded.workflow.id,
        seeded.workflow.active_codex_session_id,
        nextTurnId,
        seeded.ids.project,
        'bound-resume-single-concurrency',
      ),
    );

    const runtimeJob = (await repository.getCodexRuntimeJob({ runtime_job_id: scheduled.runtime_job.id }))!;
    const runtimeContext = (runtimeJob.input_json as CodexGenerationWorkloadV1).codex_session_runtime_context;
    expect(runtimeJob.worker_id).toBe(runnerRuntimeJob.worker_id);
    expect(runtimeContext).toMatchObject({
      runner_runtime_job_id: runnerRuntimeJob.id,
      runner_launch_lease_id: runnerRuntimeJob.launch_lease_id,
      continuation: { kind: 'resume_thread' },
    });
  });

  it('fails closed when the bound runner worker is no longer schedulable', async () => {
    const seeded = await seedSchedulerWorkflow('bbbbbbbc');
    const firstTurnId = await createTurn(seeded.workflow.id, seeded.workflow.active_codex_session_id, seeded.ids.actorTech, 'bbbbbc01');
    await bindSessionThread(seeded.workflow.active_codex_session_id, seeded.workflow.id, firstTurnId);
    await repository.markCodexSessionRunnerOwner({
      session_id: seeded.workflow.active_codex_session_id,
      runner_worker_id: 'missing-runner-worker',
      runner_runtime_job_id: 'runner-runtime-job-missing-worker',
      runner_launch_lease_id: 'runner-launch-lease-missing-worker',
      runner_expires_at: '2026-05-31T00:10:00.000Z',
      now,
    });
    const nextTurnId = await createTurn(seeded.workflow.id, seeded.workflow.active_codex_session_id, seeded.ids.actorTech, 'bbbbbc02', {
      expected_input_capsule_digest: 'sha256:capsule-thread-bind',
    });

    await expect(
      scheduler.schedule(
        scheduleInput(seeded.workflow.id, seeded.workflow.active_codex_session_id, nextTurnId, seeded.ids.project, 'runner-worker-missing'),
      ),
    ).rejects.toMatchObject({ code: 'codex_session_runner_unavailable' });

    await expect(repository.getCodexSessionTurn(nextTurnId)).resolves.toMatchObject({
      status: 'failed',
      lease_id: expect.any(String),
    });
  });

  it('fails closed when a bound session has no live runner owner', async () => {
    const seeded = await seedSchedulerWorkflow('cccccccc');
    const firstTurnId = await createTurn(seeded.workflow.id, seeded.workflow.active_codex_session_id, seeded.ids.actorTech, 'cccccc01');
    await bindSessionThread(seeded.workflow.active_codex_session_id, seeded.workflow.id, firstTurnId);
    const nextTurnId = await createTurn(seeded.workflow.id, seeded.workflow.active_codex_session_id, seeded.ids.actorTech, 'cccccc02', {
      expected_input_capsule_digest: 'sha256:capsule-thread-bind',
    });

    await expect(
      scheduler.schedule(scheduleInput(seeded.workflow.id, seeded.workflow.active_codex_session_id, nextTurnId, seeded.ids.project, 'runner-missing')),
    ).rejects.toMatchObject({ code: 'codex_session_runner_unavailable' });

    const actionRun = await repository.getAutomationActionRun(
      stableUuid({ kind: 'action-run', scenario: 'runner-missing', turnId: nextTurnId }),
    );
    expect(actionRun).toMatchObject({
      status: 'failed',
      result_json: expect.objectContaining({ product_generation_result: 'runtime_job_failed' }),
    });
    await expect(repository.getCodexSessionTurn(nextTurnId)).resolves.toMatchObject({
      status: 'failed',
      lease_id: expect.any(String),
    });
    expect((await repository.getCodexSessionTurn(nextTurnId))?.codex_thread_id_digest).toBeUndefined();
    await expect(scheduler.runtimeJobForAction(repository, actionRun!, 'boundary_brainstorming_round')).resolves.toBeUndefined();
  });

  it('rejects partial thread binding before creating a replacement runtime job', async () => {
    const seeded = await seedSchedulerWorkflow('dddddddd');
    const session = await repository.getCodexSession(seeded.workflow.active_codex_session_id);
    (repository as unknown as { codexSessions: Map<string, unknown> }).codexSessions.set(session!.id, {
      ...session!,
      codex_thread_id: 'thread-1',
      codex_thread_id_digest: undefined,
    });
    const turnId = await createTurn(seeded.workflow.id, seeded.workflow.active_codex_session_id, seeded.ids.actorTech, 'dddddd01');

    await expect(
      scheduler.schedule(scheduleInput(seeded.workflow.id, seeded.workflow.active_codex_session_id, turnId, seeded.ids.project, 'partial-binding')),
    ).rejects.toMatchObject({ code: 'codex_session_thread_binding_partial' });

    const actionRun = await repository.getAutomationActionRun(
      stableUuid({ kind: 'action-run', scenario: 'partial-binding', turnId }),
    );
    expect(actionRun).toMatchObject({
      status: 'failed',
      result_json: expect.objectContaining({
        product_generation_result: 'runtime_job_failed',
        reason_code: 'codex_session_thread_binding_partial',
      }),
    });
    await expect(repository.getCodexSessionTurn(turnId)).resolves.toMatchObject({
      status: 'failed',
      lease_id: expect.any(String),
    });
    await expect(scheduler.runtimeJobForAction(repository, actionRun!, 'boundary_brainstorming_round')).resolves.toBeUndefined();
  });

  it('ignores raw thread ids supplied in product action input', async () => {
    const seeded = await seedSchedulerWorkflow('eeeeeeee');
    const turnId = await createTurn(seeded.workflow.id, seeded.workflow.active_codex_session_id, seeded.ids.actorTech, 'eeeeee01');

    const scheduled = await scheduler.schedule(
      scheduleInput(seeded.workflow.id, seeded.workflow.active_codex_session_id, turnId, seeded.ids.project, 'raw-request-thread', {
        action_input_json: {
          codex_thread_id: 'attacker-thread',
          codex_thread_id_digest: codexCanonicalDigest({ kind: 'codex_app_server_thread_id', thread_id: 'attacker-thread' }),
        },
      }),
    );
    const runtimeJob = await repository.getCodexRuntimeJob({ runtime_job_id: scheduled.runtime_job.id });
    const context = (runtimeJob!.input_json as CodexGenerationWorkloadV1).codex_session_runtime_context;
    expect(context?.continuation).toEqual({ kind: 'start_thread' });
    expect(JSON.stringify(runtimeJob!.input_json.codex_session_runtime_context)).not.toContain('attacker-thread');
  });

  it('validates trusted thread terminal evidence on generation results', () => {
    const terminalResult = generationTerminalResult({
      codex_session_thread: {
        codex_thread_id: 'thread-1',
        codex_thread_id_digest: expectedThreadDigest,
        app_server_turn_id: 'turn-app-server-1',
      },
    });

    expect(() => schedulerRuntimeResultValidation(terminalResult)).not.toThrow();
  });

  it('terminalizes the CodexSession turn from trusted thread evidence before applying product output', async () => {
    const seeded = await seedSchedulerWorkflow('ffffffff');
    const turnId = await createTurn(seeded.workflow.id, seeded.workflow.active_codex_session_id, seeded.ids.actorTech, 'ffffff01');
    const scheduled = await scheduler.schedule(
      scheduleInput(seeded.workflow.id, seeded.workflow.active_codex_session_id, turnId, seeded.ids.project, 'terminal-bridge'),
    );
    const runtimeJob = (await repository.getCodexRuntimeJob({ runtime_job_id: scheduled.runtime_job.id }))!;
    const terminalResult = generationTerminalResult({
      codex_session_thread: {
        codex_thread_id: 'thread-1',
        codex_thread_id_digest: expectedThreadDigest,
        app_server_turn_id: 'app-server-turn-1',
      },
    });
    await terminalizeRuntimeJob(repository, runtimeJob, terminalResult, 'terminal-bridge');
    const applyBoundaryRoundRuntimeResult = vi.fn(async (input: { actionRun: { id: string }; runtime_job_id: string }) => {
      await repository.appendObjectEvent({
        id: `product-generation-result-applied-${input.runtime_job_id}`,
        object_type: 'automation_action_run',
        object_id: input.actionRun.id,
        event_type: 'product_generation_result_applied',
        actor_id: 'actor-tech',
        metadata: {
          runtime_job_id: input.runtime_job_id,
          generated_object_type: 'boundary_round',
          boundary_round_id: 'round-test',
        },
        created_at: now,
      });
      return { applied: true as const };
    });
    const resultWriter = new ProductGenerationResultService(
      repository,
      '/tmp/forgeloop-test-artifacts',
      { applyBoundaryRoundRuntimeResult } as never,
      {} as never,
      new ControlPlaneRuntimeService('test'),
    );

    await expect(
      resultWriter.handleGenerationRuntimeTerminal({
        runtimeJobId: runtimeJob.id,
        actionRunId: scheduled.action_run.id,
        terminalResult,
      }),
    ).resolves.toEqual({ applied: false, reason: 'invalid_precondition' });

    expect(applyBoundaryRoundRuntimeResult).not.toHaveBeenCalled();
    await expect(repository.getCodexSession(seeded.workflow.active_codex_session_id)).resolves.toMatchObject({
      status: 'running',
    });
    await expect(repository.getCodexSessionTurn(turnId)).resolves.toMatchObject({
      status: 'stale',
    });

    await expect(
      resultWriter.handleGenerationRuntimeTerminal({
        runtimeJobId: runtimeJob.id,
        actionRunId: scheduled.action_run.id,
        terminalResult,
      }),
    ).resolves.toEqual({ applied: false, reason: 'invalid_precondition' });
    expect(applyBoundaryRoundRuntimeResult).not.toHaveBeenCalled();
    await expect(repository.listStaleCodexSessionTerminalizationAttempts(seeded.workflow.active_codex_session_id)).resolves.toEqual([
      expect.objectContaining({
        codex_session_id: seeded.workflow.active_codex_session_id,
        codex_session_turn_id: turnId,
        attempted_codex_thread_id_digest: expectedThreadDigest,
        failure_code: 'codex_runtime_capsule_stale',
      }),
    ]);
  });

  it('clears the session runner owner after a complete successful first turn', async () => {
    const seeded = await seedSchedulerWorkflow('fffffffd');
    const turnId = await createTurn(seeded.workflow.id, seeded.workflow.active_codex_session_id, seeded.ids.actorTech, 'fffffffd');
    const scheduled = await scheduler.schedule({
      ...scheduleInput(seeded.workflow.id, seeded.workflow.active_codex_session_id, turnId, seeded.ids.project, 'terminal-complete-start'),
      codex_session_turn_group_status: 'complete',
    });
    const runtimeJob = (await repository.getCodexRuntimeJob({ runtime_job_id: scheduled.runtime_job.id }))!;
    expect((runtimeJob.input_json as CodexGenerationWorkloadV1).codex_session_runtime_context).toMatchObject({
      continuation: { kind: 'start_thread' },
      turn_group_status: 'complete',
    });
    await repository.markCodexSessionRunnerOwner({
      session_id: seeded.workflow.active_codex_session_id,
      runner_worker_id: runtimeJob.worker_id,
      runner_runtime_job_id: runtimeJob.id,
      runner_launch_lease_id: runtimeJob.launch_lease_id,
      runner_expires_at: '2026-05-31T00:10:00.000Z',
      now,
    });
    const terminalResult = generationTerminalResult({
      codex_session_thread: {
        codex_thread_id: 'thread-1',
        codex_thread_id_digest: expectedThreadDigest,
        app_server_turn_id: 'app-server-turn-complete',
      },
    });
    await terminalizeRuntimeJob(repository, runtimeJob, terminalResult, 'terminal-complete-start');
    const applyBoundaryRoundRuntimeResult = vi.fn(async (input: { actionRun: { id: string }; runtime_job_id: string }) => {
      await repository.appendObjectEvent({
        id: `product-generation-result-applied-${input.runtime_job_id}`,
        object_type: 'automation_action_run',
        object_id: input.actionRun.id,
        event_type: 'product_generation_result_applied',
        actor_id: 'actor-tech',
        metadata: {
          runtime_job_id: input.runtime_job_id,
          generated_object_type: 'boundary_round',
          boundary_round_id: 'round-test',
        },
        created_at: now,
      });
      return { applied: true as const };
    });
    const resultWriter = new ProductGenerationResultService(
      repository,
      '/tmp/forgeloop-test-artifacts',
      { applyBoundaryRoundRuntimeResult } as never,
      {} as never,
      new ControlPlaneRuntimeService('test'),
    );

    await expect(
      resultWriter.handleGenerationRuntimeTerminal({
        runtimeJobId: runtimeJob.id,
        actionRunId: scheduled.action_run.id,
        terminalResult,
      }),
    ).resolves.toEqual({ applied: false, reason: 'invalid_precondition' });

    const session = await repository.getCodexSession(seeded.workflow.active_codex_session_id);
    expect(session).toMatchObject({
      status: 'running',
    });
    expect(session?.runner_worker_id).toBe(runtimeJob.worker_id);
    expect(session?.runner_runtime_job_id).toBe(runtimeJob.id);
    expect(session?.runner_launch_lease_id).toBe(runtimeJob.launch_lease_id);
    expect(session?.runner_expires_at).toBe('2026-05-31T00:10:00.000Z');
  });

  it('fails session-backed successful runtime results that omit trusted thread evidence', async () => {
    const seeded = await seedSchedulerWorkflow('fffffff0');
    const turnId = await createTurn(seeded.workflow.id, seeded.workflow.active_codex_session_id, seeded.ids.actorTech, 'fffff001');
    const scheduled = await scheduler.schedule(
      scheduleInput(seeded.workflow.id, seeded.workflow.active_codex_session_id, turnId, seeded.ids.project, 'terminal-missing-thread'),
    );
    const runtimeJob = (await repository.getCodexRuntimeJob({ runtime_job_id: scheduled.runtime_job.id }))!;
    const terminalResult = generationTerminalResult();
    await terminalizeRuntimeJob(repository, runtimeJob, terminalResult, 'terminal-missing-thread');
    const applyBoundaryRoundRuntimeResult = vi.fn(async () => ({ applied: true as const }));
    const resultWriter = new ProductGenerationResultService(
      repository,
      '/tmp/forgeloop-test-artifacts',
      { applyBoundaryRoundRuntimeResult } as never,
      {} as never,
      new ControlPlaneRuntimeService('test'),
    );

    await expect(
      resultWriter.handleGenerationRuntimeTerminal({
        runtimeJobId: runtimeJob.id,
        actionRunId: scheduled.action_run.id,
        terminalResult,
      }),
    ).resolves.toEqual({ applied: false, reason: 'invalid_precondition' });

    expect(applyBoundaryRoundRuntimeResult).not.toHaveBeenCalled();
    await expect(repository.getCodexSession(seeded.workflow.active_codex_session_id)).resolves.toMatchObject({
      status: 'blocked',
    });
    await expect(repository.getCodexSessionTurn(turnId)).resolves.toMatchObject({
      status: 'failed',
      lease_id: expect.any(String),
    });
    await expect(repository.getAutomationActionRun(scheduled.action_run.id)).resolves.toMatchObject({
      status: 'failed',
      result_json: expect.objectContaining({ product_generation_result: 'invalid_precondition' }),
    });
  });

  it('fails the CodexSession turn when trusted product output is schema-invalid', async () => {
    const seeded = await seedSchedulerWorkflow('fffffff1');
    const turnId = await createTurn(seeded.workflow.id, seeded.workflow.active_codex_session_id, seeded.ids.actorTech, 'fffff100');
    const scheduled = await scheduler.schedule(
      scheduleInput(seeded.workflow.id, seeded.workflow.active_codex_session_id, turnId, seeded.ids.project, 'terminal-product-schema-invalid'),
    );
    const runtimeJob = (await repository.getCodexRuntimeJob({ runtime_job_id: scheduled.runtime_job.id }))!;
    await repository.markCodexSessionRunnerOwner({
      session_id: seeded.workflow.active_codex_session_id,
      runner_worker_id: runtimeJob.worker_id,
      runner_runtime_job_id: runtimeJob.id,
      runner_launch_lease_id: runtimeJob.launch_lease_id,
      runner_expires_at: '2026-05-31T00:10:00.000Z',
      now,
    });
    const invalidGeneratedPayload = {
      schema_version: 'boundary_round_result.v1',
      session_id: '   ',
      round_id: 'boundary-round-1',
      questions: [],
      proposed_decisions: [],
      needs_leader_input: false,
      public_summary: 'No questions.',
      artifacts: [],
    };
    const terminalResult = generationTerminalResult({
      generated_payload: invalidGeneratedPayload,
      generated_payload_digest: codexCanonicalDigest(invalidGeneratedPayload),
      codex_session_thread: {
        codex_thread_id: 'thread-1',
        codex_thread_id_digest: expectedThreadDigest,
        app_server_turn_id: 'app-server-turn-product-schema-invalid',
      },
    });
    await terminalizeRuntimeJob(repository, runtimeJob, terminalResult, 'terminal-product-schema-invalid');
    const applyBoundaryRoundRuntimeResult = vi.fn(async () => ({ applied: true as const }));
    const resultWriter = new ProductGenerationResultService(
      repository,
      '/tmp/forgeloop-test-artifacts',
      { applyBoundaryRoundRuntimeResult } as never,
      {} as never,
      new ControlPlaneRuntimeService('test'),
    );

    await expect(
      resultWriter.handleGenerationRuntimeTerminal({
        runtimeJobId: runtimeJob.id,
        actionRunId: scheduled.action_run.id,
        terminalResult,
      }),
    ).resolves.toEqual({ applied: false, reason: 'public_unsafe_payload' });

    expect(applyBoundaryRoundRuntimeResult).not.toHaveBeenCalled();
    await expect(repository.getCodexSessionTurn(turnId)).resolves.toMatchObject({
      status: 'failed',
    });
    expect((await repository.getCodexSessionTurn(turnId))?.codex_thread_id_digest).toBeUndefined();
    await expect(repository.getAutomationActionRun(scheduled.action_run.id)).resolves.toMatchObject({
      status: 'failed',
      result_json: expect.objectContaining({ product_generation_result: 'public_unsafe_payload' }),
      retryable: false,
    });
    const session = await repository.getCodexSession(seeded.workflow.active_codex_session_id);
    expect(session?.runner_worker_id).toBeUndefined();
    expect(session?.runner_runtime_job_id).toBeUndefined();
    expect(session?.runner_launch_lease_id).toBeUndefined();
    await expect(
      repository.findAvailableCodexWorker({
        worker_id: runtimeJob.worker_id,
        project_id: seeded.ids.project,
        target_kind: 'generation',
        docker_image_digest: codexCanonicalDigest({ label: 'plan-item-workflow-generation-docker-image' }),
        network_policy_digest: codexCanonicalDigest({ mode: 'disabled' }),
        now,
      }),
    ).resolves.toMatchObject({ id: runtimeJob.worker_id, active_lease_count: 0 });
  });

  it('clears the live runner when product output is rejected after trusted session terminalization', async () => {
    const seeded = await seedSchedulerWorkflow('fffffff1');
    const turnId = await createTurn(seeded.workflow.id, seeded.workflow.active_codex_session_id, seeded.ids.actorTech, 'fffff101');
    const scheduled = await scheduler.schedule(
      scheduleInput(seeded.workflow.id, seeded.workflow.active_codex_session_id, turnId, seeded.ids.project, 'terminal-product-rejected'),
    );
    const runtimeJob = (await repository.getCodexRuntimeJob({ runtime_job_id: scheduled.runtime_job.id }))!;
    await repository.markCodexSessionRunnerOwner({
      session_id: seeded.workflow.active_codex_session_id,
      runner_worker_id: runtimeJob.worker_id,
      runner_runtime_job_id: runtimeJob.id,
      runner_launch_lease_id: runtimeJob.launch_lease_id,
      runner_expires_at: '2026-05-31T00:10:00.000Z',
      now,
    });
    const terminalResult = generationTerminalResult({
      codex_session_thread: {
        codex_thread_id: 'thread-1',
        codex_thread_id_digest: expectedThreadDigest,
        app_server_turn_id: 'app-server-turn-product-rejected',
      },
    });
    await terminalizeRuntimeJob(repository, runtimeJob, terminalResult, 'terminal-product-rejected');
    const applyBoundaryRoundRuntimeResult = vi.fn(async () => ({ applied: false as const, reason: 'public_unsafe_payload' as const }));
    const resultWriter = new ProductGenerationResultService(
      repository,
      '/tmp/forgeloop-test-artifacts',
      { applyBoundaryRoundRuntimeResult } as never,
      {} as never,
      new ControlPlaneRuntimeService('test'),
    );

    await expect(
      resultWriter.handleGenerationRuntimeTerminal({
        runtimeJobId: runtimeJob.id,
        actionRunId: scheduled.action_run.id,
        terminalResult,
      }),
    ).resolves.toEqual({ applied: false, reason: 'invalid_precondition' });

    expect(applyBoundaryRoundRuntimeResult).not.toHaveBeenCalled();
    await expect(repository.getCodexSessionTurn(turnId)).resolves.toMatchObject({
      status: 'stale',
    });
    const session = await repository.getCodexSession(seeded.workflow.active_codex_session_id);
    expect(session?.runner_worker_id).toBe(runtimeJob.worker_id);
    expect(session?.runner_runtime_job_id).toBe(runtimeJob.id);
    expect(session?.runner_launch_lease_id).toBe(runtimeJob.launch_lease_id);
    await expect(
      repository.findAvailableCodexWorker({
        worker_id: runtimeJob.worker_id,
        project_id: seeded.ids.project,
        target_kind: 'generation',
        docker_image_digest: codexCanonicalDigest({ label: 'plan-item-workflow-generation-docker-image' }),
        network_policy_digest: codexCanonicalDigest({ mode: 'disabled' }),
        now,
      }),
    ).resolves.toMatchObject({ id: runtimeJob.worker_id, active_lease_count: 1 });
  });

  it('treats already-terminalized matching CodexSession turn evidence as idempotent before product output is applied', async () => {
    const seeded = await seedSchedulerWorkflow('fffffffc');
    const turnId = await createTurn(seeded.workflow.id, seeded.workflow.active_codex_session_id, seeded.ids.actorTech, 'fffffffc');
    const scheduled = await scheduler.schedule(
      scheduleInput(seeded.workflow.id, seeded.workflow.active_codex_session_id, turnId, seeded.ids.project, 'terminal-idempotent'),
    );
    const runtimeJob = (await repository.getCodexRuntimeJob({ runtime_job_id: scheduled.runtime_job.id }))!;
    const terminalResult = generationTerminalResult({
      codex_session_thread: {
        codex_thread_id: 'thread-1',
        codex_thread_id_digest: expectedThreadDigest,
        app_server_turn_id: 'app-server-turn-idempotent',
      },
    });
    await terminalizeRuntimeJob(repository, runtimeJob, terminalResult, 'terminal-idempotent');
    const workload = runtimeJob.input_json as CodexGenerationWorkloadV1;
    const runtimeContext = workload.codex_session_runtime_context!;
    const terminalization = workload.codex_session_terminalization!;
    const idempotentCapsuleId = stableUuid({ kind: 'idempotent-capsule', turnId });
    await repository.terminalizeCodexSessionTurn({
      session_id: runtimeContext.codex_session_id,
      turn_id: runtimeContext.codex_session_turn_id,
      lease_id: runtimeContext.lease_id,
      lease_token_hash: codexCredentialPayloadDigest(terminalization.lease_token),
      lease_epoch: runtimeContext.lease_epoch,
      worker_id: runtimeContext.worker_id,
      worker_session_digest: runtimeContext.worker_session_digest,
      status: 'succeeded',
      app_server_thread_binding_required: true,
      codex_thread_id: 'thread-1',
      codex_thread_id_digest: expectedThreadDigest,
      output_capsule: runtimeCapsule({
        id: idempotentCapsuleId,
        codex_session_id: runtimeContext.codex_session_id,
        sequence: 1,
        digest: 'sha256:idempotent-capsule',
        manifest_digest: 'sha256:idempotent-capsule-manifest',
        thread_state_digest: 'sha256:idempotent-thread-state',
        memory_state_digest: 'sha256:idempotent-memory-state',
        environment_manifest_digest: 'sha256:idempotent-environment-manifest',
        codex_thread_id_digest: expectedThreadDigest,
        app_server_protocol_digest: 'sha256:idempotent-app-server-protocol',
        trusted_runtime_manifest_digest: 'sha256:idempotent-trusted-runtime-manifest',
        credential_binding_lineage_digest: 'sha256:idempotent-credential-binding-lineage',
        created_from_turn_id: runtimeContext.codex_session_turn_id,
        created_by_actor_id: seeded.ids.actorTech,
      }),
      now,
    });
    const applyBoundaryRoundRuntimeResult = vi.fn(async (input: { actionRun: { id: string }; runtime_job_id: string }) => {
      await repository.appendObjectEvent({
        id: `product-generation-result-applied-${input.runtime_job_id}`,
        object_type: 'automation_action_run',
        object_id: input.actionRun.id,
        event_type: 'product_generation_result_applied',
        actor_id: 'actor-tech',
        metadata: {
          runtime_job_id: input.runtime_job_id,
          generated_object_type: 'boundary_round',
          boundary_round_id: 'round-test',
        },
        created_at: now,
      });
      return { applied: true as const };
    });
    const resultWriter = new ProductGenerationResultService(
      repository,
      '/tmp/forgeloop-test-artifacts',
      { applyBoundaryRoundRuntimeResult } as never,
      {} as never,
      new ControlPlaneRuntimeService('test'),
    );

    await expect(
      resultWriter.handleGenerationRuntimeTerminal({
        runtimeJobId: runtimeJob.id,
        actionRunId: scheduled.action_run.id,
        terminalResult,
      }),
    ).resolves.toEqual({ applied: true });

    expect(applyBoundaryRoundRuntimeResult).toHaveBeenCalledTimes(1);
    await expect(repository.listStaleCodexSessionTerminalizationAttempts(seeded.workflow.active_codex_session_id)).resolves.toHaveLength(0);
  });

  it('records stale CodexSession terminalization attempts without applying stale product output', async () => {
    const seeded = await seedSchedulerWorkflow('fffffffb');
    const turnId = await createTurn(seeded.workflow.id, seeded.workflow.active_codex_session_id, seeded.ids.actorTech, 'fffffffb');
    const scheduled = await scheduler.schedule(
      scheduleInput(seeded.workflow.id, seeded.workflow.active_codex_session_id, turnId, seeded.ids.project, 'terminal-stale'),
    );
    const runtimeJob = (await repository.getCodexRuntimeJob({ runtime_job_id: scheduled.runtime_job.id }))!;
    const terminalResult = generationTerminalResult({
      codex_session_thread: {
        codex_thread_id: 'thread-1',
        codex_thread_id_digest: expectedThreadDigest,
        app_server_turn_id: 'app-server-turn-stale',
      },
    });
    await terminalizeRuntimeJob(repository, runtimeJob, terminalResult, 'terminal-stale');
    await repository.markCodexSessionTurnStale({ session_id: seeded.workflow.active_codex_session_id, turn_id: turnId, now });
    const applyBoundaryRoundRuntimeResult = vi.fn(async () => ({ applied: true as const }));
    const resultWriter = new ProductGenerationResultService(
      repository,
      '/tmp/forgeloop-test-artifacts',
      { applyBoundaryRoundRuntimeResult } as never,
      {} as never,
      new ControlPlaneRuntimeService('test'),
    );

    await expect(
      resultWriter.handleGenerationRuntimeTerminal({
        runtimeJobId: runtimeJob.id,
        actionRunId: scheduled.action_run.id,
        terminalResult,
      }),
    ).resolves.toEqual({ applied: false, reason: 'invalid_precondition' });

    expect(applyBoundaryRoundRuntimeResult).not.toHaveBeenCalled();
    await expect(repository.listStaleCodexSessionTerminalizationAttempts(seeded.workflow.active_codex_session_id)).resolves.toEqual([
      expect.objectContaining({
        codex_session_id: seeded.workflow.active_codex_session_id,
        codex_session_turn_id: turnId,
        lease_id: (runtimeJob.input_json as CodexGenerationWorkloadV1).codex_session_runtime_context?.lease_id,
        attempted_codex_thread_id_digest: expectedThreadDigest,
        failure_code: 'codex_session_stale_terminalization',
      }),
    ]);
  });

  it('marks attempted running turns stale when thread binding evidence is stale', async () => {
    const seeded = await seedSchedulerWorkflow('fffffff1');
    const runnerRuntimeJob = await createLiveSessionRunner(
      seeded.workflow.id,
      seeded.workflow.active_codex_session_id,
      seeded.ids.actorTech,
      seeded.ids.project,
      'thread-binding-stale',
    );
    const nextTurnId = await createTurn(seeded.workflow.id, seeded.workflow.active_codex_session_id, seeded.ids.actorTech, 'fffffff1-next', {
      expected_input_capsule_digest: 'sha256:capsule-thread-bind',
    });
    await repository.heartbeatCodexWorker({
      worker_id: runnerRuntimeJob.worker_id,
      session_token: `plan-item-workflow-session-${seeded.ids.project}`,
      nonce: 'thread-binding-stale-worker-heartbeat',
      nonce_timestamp: now,
      status: 'online',
      control_channel_status: 'connected',
      active_lease_count: 0,
      capabilities: ['generation'],
      now,
    });
    const scheduled = await scheduler.schedule(
      scheduleInput(seeded.workflow.id, seeded.workflow.active_codex_session_id, nextTurnId, seeded.ids.project, 'thread-binding-stale'),
    );
    const runtimeJob = (await repository.getCodexRuntimeJob({ runtime_job_id: scheduled.runtime_job.id }))!;
    const staleTerminalResult = generationTerminalResult({
      codex_session_thread: {
        codex_thread_id: 'thread-2',
        codex_thread_id_digest: codexCanonicalDigest({ kind: 'codex_app_server_thread_id', thread_id: 'thread-2' }),
        app_server_turn_id: 'app-server-turn-stale-thread',
      },
    });
    await terminalizeAttachedRuntimeJob(repository, runtimeJob, staleTerminalResult, 'thread-binding-stale');
    const applyBoundaryRoundRuntimeResult = vi.fn(async () => ({ applied: true as const }));
    const resultWriter = new ProductGenerationResultService(
      repository,
      '/tmp/forgeloop-test-artifacts',
      { applyBoundaryRoundRuntimeResult } as never,
      {} as never,
      new ControlPlaneRuntimeService('test'),
    );

    await expect(
      resultWriter.handleGenerationRuntimeTerminal({
        runtimeJobId: runtimeJob.id,
        actionRunId: scheduled.action_run.id,
        terminalResult: staleTerminalResult,
      }),
    ).resolves.toEqual({ applied: false, reason: 'invalid_precondition' });

    expect(applyBoundaryRoundRuntimeResult).not.toHaveBeenCalled();
    await expect(repository.getCodexSessionTurn(nextTurnId)).resolves.toMatchObject({ status: 'stale' });
    await expect(repository.listStaleCodexSessionTerminalizationAttempts(seeded.workflow.active_codex_session_id)).resolves.toEqual([
      expect.objectContaining({
        codex_session_id: seeded.workflow.active_codex_session_id,
        codex_session_turn_id: nextTurnId,
        attempted_codex_thread_id_digest: codexCanonicalDigest({ kind: 'codex_app_server_thread_id', thread_id: 'thread-2' }),
        failure_code: 'codex_runtime_capsule_stale',
      }),
    ]);
  });

  it('marks attempted running turns stale when trusted lease terminalization sees stale thread evidence', async () => {
    const seeded = await seedSchedulerWorkflow('fffffffd');
    const firstTurnId = await createTurn(seeded.workflow.id, seeded.workflow.active_codex_session_id, seeded.ids.actorTech, 'fffffffd01');
    await bindSessionThread(seeded.workflow.active_codex_session_id, seeded.workflow.id, firstTurnId);
    const nextTurnId = await createTurn(seeded.workflow.id, seeded.workflow.active_codex_session_id, seeded.ids.actorTech, 'fffffffd02', {
      expected_input_capsule_digest: 'sha256:capsule-thread-bind',
    });
    const service = new CodexSessionLeaseService(repository, new ControlPlaneRuntimeService('test'));
    const claimed = await service.claim(seeded.workflow.active_codex_session_id, {
      workflow_id: seeded.workflow.id,
      lease_token: 'trusted-terminalization-stale-token',
      worker_id: 'trusted-terminalization-worker',
      worker_session_digest: 'sha256:trusted-terminalization-worker-session',
      expected_input_capsule_digest: 'sha256:capsule-thread-bind',
      expires_at: '2026-05-31T00:05:00.000Z',
    });

    await expect(
      service.terminalize(
        seeded.workflow.active_codex_session_id,
        nextTurnId,
        {
          lease_id: claimed.id,
          lease_token: 'trusted-terminalization-stale-token',
          lease_epoch: claimed.lease_epoch,
          worker_id: 'trusted-terminalization-worker',
          worker_session_digest: 'sha256:trusted-terminalization-worker-session',
          status: 'succeeded',
          expected_input_capsule_digest: 'sha256:capsule-thread-bind',
          ...trustedLeaseOutputCapsuleBody({
            sessionId: seeded.workflow.active_codex_session_id,
            turnId: nextTurnId,
            id: stableUuid({ kind: 'trusted-terminalization-stale-capsule', nextTurnId }),
            sequence: 2,
            digest: 'sha256:trusted-terminalization-stale-capsule',
            manifestDigest: 'sha256:trusted-terminalization-stale-capsule-manifest',
            codexThreadIdDigest: codexCanonicalDigest({ kind: 'codex_app_server_thread_id', thread_id: 'thread-2' }),
            actorId: seeded.ids.actorTech,
          }),
          codex_thread_id: 'thread-2',
          codex_thread_id_digest: codexCanonicalDigest({ kind: 'codex_app_server_thread_id', thread_id: 'thread-2' }),
        },
        { headers: { [automationActorIdHeaderName]: seeded.ids.actorTech } },
      ),
    ).rejects.toMatchObject({ code: 'codex_session_thread_binding_stale' });

    await expect(repository.getCodexSessionTurn(nextTurnId)).resolves.toMatchObject({ status: 'stale' });
    await expect(repository.listStaleCodexSessionTerminalizationAttempts(seeded.workflow.active_codex_session_id)).resolves.toEqual([
      expect.objectContaining({
        codex_session_id: seeded.workflow.active_codex_session_id,
        codex_session_turn_id: nextTurnId,
        attempted_codex_thread_id_digest: codexCanonicalDigest({ kind: 'codex_app_server_thread_id', thread_id: 'thread-2' }),
        failure_code: 'codex_session_thread_binding_stale',
      }),
    ]);
  });

  it('redacts trusted thread evidence from public terminal runtime job output', async () => {
    const seeded = await seedSchedulerWorkflow('gggggggg');
    const turnId = await createTurn(seeded.workflow.id, seeded.workflow.active_codex_session_id, seeded.ids.actorTech, 'gggggg01');
    const scheduled = await scheduler.schedule(
      scheduleInput(seeded.workflow.id, seeded.workflow.active_codex_session_id, turnId, seeded.ids.project, 'public-redaction'),
    );
    const runtimeJob = (await repository.getCodexRuntimeJob({ runtime_job_id: scheduled.runtime_job.id }))!;
    const terminalResult = generationTerminalResult({
      codex_session_thread: {
        codex_thread_id: 'thread-1',
        codex_thread_id_digest: expectedThreadDigest,
        app_server_turn_id: 'app-server-turn-1',
      },
    });
    await terminalizeRuntimeJob(repository, runtimeJob, terminalResult, 'public-redaction');
    const service = newCodexRuntimeService();

    const result = await service.getRuntimeJob(runtimeJob.id);
    const publicRuntimeJobJson = JSON.stringify(result.runtime_job);

    expect(result.runtime_job.terminal_result_json).toBeDefined();
    expect(publicRuntimeJobJson).not.toContain('codex_session_thread');
    expect(publicRuntimeJobJson).not.toContain('thread-1');
    expect(publicRuntimeJobJson).not.toContain('codex_thread_id');
    expect(publicRuntimeJobJson).not.toContain('codex_session_runtime_context');
    expect(publicRuntimeJobJson).not.toContain('codex_session_terminalization');
    expect(publicRuntimeJobJson).not.toContain('lease_token');
    expect(publicRuntimeJobJson).not.toContain('worker_session_digest');
    expect(publicRuntimeJobJson).not.toContain('runner_runtime_job_id');
    expect(publicRuntimeJobJson).not.toContain('runner_launch_lease_id');
    expect(JSON.stringify(result.runtime_job.terminal_result_json)).not.toContain('lease_id');
    expect(JSON.stringify(result.runtime_job.input)).not.toContain('lease_id');
  });

  it('terminalizes CodexSession turns when session-backed runtime jobs fail', async () => {
    const seeded = await seedSchedulerWorkflow('hhhhhhhh');
    const turnId = await createTurn(seeded.workflow.id, seeded.workflow.active_codex_session_id, seeded.ids.actorTech, 'hhhhhh01');
    const scheduled = await scheduler.schedule(
      scheduleInput(seeded.workflow.id, seeded.workflow.active_codex_session_id, turnId, seeded.ids.project, 'runtime-failed'),
    );
    const runtimeJob = (await repository.getCodexRuntimeJob({ runtime_job_id: scheduled.runtime_job.id }))!;
    const service = newCodexRuntimeService();

    await expect(terminalizeRuntimeJobThroughService(repository, service, runtimeJob, 'failed', 'codex_app_server_resume_failed', 'runtime-failed')).resolves.toMatchObject({
      runtime_job: {
        id: runtimeJob.id,
        terminal_status: 'failed',
        terminal_reason_code: 'codex_app_server_resume_failed',
      },
    });

    await expect(repository.getCodexSessionTurn(turnId)).resolves.toMatchObject({
      status: 'failed',
      lease_id: expect.any(String),
    });
    expect((await repository.getCodexSessionTurn(turnId))?.codex_thread_id_digest).toBeUndefined();
    await expect(repository.getAutomationActionRun(scheduled.action_run.id)).resolves.toMatchObject({
      status: 'failed',
      result_json: expect.objectContaining({
        product_generation_result: 'runtime_job_failed',
        terminal_status: 'failed',
        reason_code: 'codex_app_server_resume_failed',
      }),
      retryable: false,
    });
  });

  it('clears the session runner owner when a bound runtime job fails', async () => {
    const seeded = await seedSchedulerWorkflow('hhhhhhhb');
    await createLiveSessionRunner(
      seeded.workflow.id,
      seeded.workflow.active_codex_session_id,
      seeded.ids.actorTech,
      seeded.ids.project,
      'hhhhhb',
    );
    const nextTurnId = await createTurn(seeded.workflow.id, seeded.workflow.active_codex_session_id, seeded.ids.actorTech, 'hhhhhb02', {
      expected_input_capsule_digest: 'sha256:capsule-thread-bind',
    });
    const scheduled = await scheduler.schedule(
      scheduleInput(seeded.workflow.id, seeded.workflow.active_codex_session_id, nextTurnId, seeded.ids.project, 'runtime-failed-bound'),
    );
    const runtimeJob = (await repository.getCodexRuntimeJob({ runtime_job_id: scheduled.runtime_job.id }))!;
    const service = newCodexRuntimeService();

    await terminalizeRuntimeJobThroughService(repository, service, runtimeJob, 'failed', 'codex_app_server_resume_failed', 'runtime-failed-bound');

    const session = await repository.getCodexSession(seeded.workflow.active_codex_session_id);
    expect(session?.runner_worker_id).toBeUndefined();
    expect(session?.runner_runtime_job_id).toBeUndefined();
    expect(session?.runner_launch_lease_id).toBeUndefined();
    expect(session?.runner_expires_at).toBeUndefined();
  });

  it('clears the session runner owner when the first session runner job fails after owner registration', async () => {
    const seeded = await seedSchedulerWorkflow('hhhhhhhc');
    const turnId = await createTurn(seeded.workflow.id, seeded.workflow.active_codex_session_id, seeded.ids.actorTech, 'hhhhhc01');
    const scheduled = await scheduler.schedule(
      scheduleInput(seeded.workflow.id, seeded.workflow.active_codex_session_id, turnId, seeded.ids.project, 'runtime-failed-start-owner'),
    );
    const runtimeJob = (await repository.getCodexRuntimeJob({ runtime_job_id: scheduled.runtime_job.id }))!;
    await repository.markCodexSessionRunnerOwner({
      session_id: seeded.workflow.active_codex_session_id,
      runner_worker_id: runtimeJob.worker_id,
      runner_runtime_job_id: runtimeJob.id,
      runner_launch_lease_id: runtimeJob.launch_lease_id,
      runner_expires_at: '2026-05-31T00:10:00.000Z',
      now,
    });
    const service = newCodexRuntimeService();

    await terminalizeRuntimeJobThroughService(
      repository,
      service,
      runtimeJob,
      'failed',
      'codex_app_server_resume_failed',
      'runtime-failed-start-owner',
    );

    const session = await repository.getCodexSession(seeded.workflow.active_codex_session_id);
    expect(session?.runner_worker_id).toBeUndefined();
    expect(session?.runner_runtime_job_id).toBeUndefined();
    expect(session?.runner_launch_lease_id).toBeUndefined();
    expect(session?.runner_expires_at).toBeUndefined();
  });

  it('renews open CodexSession runner ownership from worker heartbeat', async () => {
    const seeded = await seedSchedulerWorkflow('hhhhhhhd');
    const turnId = await createTurn(seeded.workflow.id, seeded.workflow.active_codex_session_id, seeded.ids.actorTech, 'hhhhhd01');
    const scheduled = await scheduler.schedule(
      scheduleInput(seeded.workflow.id, seeded.workflow.active_codex_session_id, turnId, seeded.ids.project, 'runtime-heartbeat-renew'),
    );
    const runtimeJob = (await repository.getCodexRuntimeJob({ runtime_job_id: scheduled.runtime_job.id }))!;
    await repository.markCodexSessionRunnerOwner({
      session_id: seeded.workflow.active_codex_session_id,
      runner_worker_id: runtimeJob.worker_id,
      runner_runtime_job_id: runtimeJob.id,
      runner_launch_lease_id: runtimeJob.launch_lease_id,
      runner_expires_at: '2026-05-31T00:10:00.000Z',
      now,
    });
    const renewedExpiresAt = '2026-05-31T00:12:00.000Z';
    const sessionToken = `plan-item-workflow-session-${runtimeJob.project_id}`;
    const service = newCodexRuntimeService();

    await service.heartbeatWorker(runtimeJob.worker_id, {
      session_token: sessionToken,
      nonce: 'heartbeat-renew',
      nonce_timestamp: now,
      status: 'online',
      control_channel_status: 'connected',
      active_lease_count: 1,
      capabilities: ['generation'],
      codex_session_runners: [
        {
          session_id: seeded.workflow.active_codex_session_id,
          runner_runtime_job_id: runtimeJob.id,
          runner_launch_lease_id: runtimeJob.launch_lease_id,
          runner_expires_at: renewedExpiresAt,
        },
      ],
    });

    const session = await repository.getCodexSession(seeded.workflow.active_codex_session_id);
    expect(session?.runner_worker_id).toBe(runtimeJob.worker_id);
    expect(session?.runner_runtime_job_id).toBe(runtimeJob.id);
    expect(session?.runner_launch_lease_id).toBe(runtimeJob.launch_lease_id);
    expect(session?.runner_expires_at).toBe(renewedExpiresAt);
    await expect(repository.getCodexRuntimeJob({ runtime_job_id: runtimeJob.id })).resolves.toMatchObject({
      expires_at: renewedExpiresAt,
    });
  });

  function schedulerRuntimeResultValidation(result: CodexGenerationRuntimeJobResult) {
    return validateCodexRuntimeJobTerminalResult(result);
  }

  async function seedSchedulerWorkflow(idPrefix: string) {
    const seeded = await seedDevelopmentPlanItem(app as never, { idPrefix });
    const profileRevision = await repository.getActiveCodexRuntimeProfileRevision({
      project_id: seeded.ids.project,
      target_kind: 'generation',
      now,
    });
    if (profileRevision === undefined) {
      throw new Error('Expected generation runtime profile revision fixture');
    }
    const credentialCandidate = (
      await repository.listCodexCredentialBindingReadinessCandidates({
        project_id: seeded.ids.project,
        runtime_profile_id: profileRevision.profile_id,
        target_kind: 'generation',
        now,
      })
    ).find((candidate) => candidate.purpose === 'model_provider');
    const credential = credentialCandidate === undefined ? undefined : await repository.getCodexCredentialBindingPublic(credentialCandidate.id);
    if (credential?.active_version_id === undefined) {
      throw new Error('Expected generation credential fixture');
    }
    const created = await repository.createPlanItemWorkflowWithInitialSession({
      id: stableUuid({ kind: 'workflow', idPrefix }),
      codex_session_id: stableUuid({ kind: 'codex-session', idPrefix }),
      development_plan_id: seeded.plan.id,
      development_plan_item_id: seeded.item.id,
      runtime_profile_id: profileRevision.profile_id,
      runtime_profile_revision_id: profileRevision.id,
      credential_binding_id: credential.id,
      credential_binding_version_id: credential.active_version_id,
      actor_id: seeded.ids.actorTech,
      now,
    });
    return { ...seeded, workflow: created.workflow };
  }

  async function createTurn(
    workflowId: string,
    sessionId: string,
    actorId: string,
    suffix: string,
    options: { expected_input_capsule_digest?: string } = {},
  ): Promise<string> {
    const turnId = stableUuid({ kind: 'codex-session-turn', suffix });
    await repository.createCodexSessionTurn({
      id: turnId,
      workflow_id: workflowId,
      codex_session_id: sessionId,
      intent: 'continue_brainstorming',
      status: 'running',
      input_digest: codexCanonicalDigest({ kind: 'turn-input', turnId, expected: options.expected_input_capsule_digest ?? null }),
      ...(options.expected_input_capsule_digest === undefined
        ? {}
        : { expected_input_capsule_digest: options.expected_input_capsule_digest }),
      created_by_actor_id: actorId,
      created_at: now,
      updated_at: now,
    });
    return turnId;
  }

  async function bindSessionThread(sessionId: string, workflowId: string, turnId: string) {
    const claimed = await repository.claimCodexSessionLease({
      session_id: sessionId,
      workflow_id: workflowId,
      lease_id: stableUuid({ kind: 'binding-lease', sessionId, turnId }),
      lease_token_hash: codexCredentialPayloadDigest(`binding-token-${turnId}`),
      worker_id: 'binding-worker',
      worker_session_digest: 'sha256:binding-worker-session',
      expected_input_capsule_digest: undefined,
      now,
      expires_at: '2026-05-31T00:05:00.000Z',
    });
    const snapshotId = stableUuid({ kind: 'binding-capsule', sessionId, turnId });
    await repository.terminalizeCodexSessionTurn({
      session_id: sessionId,
      turn_id: turnId,
      lease_id: claimed.lease.id,
      lease_token_hash: claimed.lease.lease_token_hash,
      lease_epoch: claimed.lease.lease_epoch,
      worker_id: claimed.lease.worker_id,
      worker_session_digest: claimed.lease.worker_session_digest,
      status: 'succeeded',
      codex_thread_id: 'thread-1',
      codex_thread_id_digest: expectedThreadDigest,
      output_capsule: runtimeCapsule({
        id: snapshotId,
        codex_session_id: sessionId,
        sequence: 1,
        digest: 'sha256:capsule-thread-bind',
        manifest_digest: 'sha256:capsule-thread-bind-manifest',
        codex_thread_id_digest: expectedThreadDigest,
        created_from_turn_id: turnId,
        created_by_actor_id: 'actor-tech',
      }),
      now,
    });
  }

  async function createLiveSessionRunner(
    workflowId: string,
    sessionId: string,
    actorId: string,
    projectId: string,
    suffix: string,
  ): Promise<CodexRuntimeJob> {
    const runnerTurnId = await createTurn(workflowId, sessionId, actorId, `${suffix}-runner`);
    const scheduled = await scheduler.schedule(scheduleInput(workflowId, sessionId, runnerTurnId, projectId, `${suffix}-runner`));
    const runtimeJob = (await repository.getCodexRuntimeJob({ runtime_job_id: scheduled.runtime_job.id }))!;
    await terminalizeRuntimeJob(
      repository,
      runtimeJob,
      generationTerminalResult({
        codex_session_thread: {
          codex_thread_id: 'thread-1',
          codex_thread_id_digest: expectedThreadDigest,
          app_server_turn_id: `${suffix}-runner-app-server-turn`,
        },
      }),
      `${suffix}-runner`,
    );
    const snapshotId = stableUuid({ kind: 'runner-capsule', suffix });
    await repository.terminalizeCodexSessionTurn({
      session_id: sessionId,
      turn_id: runnerTurnId,
      lease_id: (runtimeJob.input_json as CodexGenerationWorkloadV1).codex_session_runtime_context!.lease_id,
      lease_token_hash: codexCredentialPayloadDigest(
        (runtimeJob.input_json as CodexGenerationWorkloadV1).codex_session_terminalization!.lease_token,
      ),
      lease_epoch: (runtimeJob.input_json as CodexGenerationWorkloadV1).codex_session_runtime_context!.lease_epoch,
      worker_id: runtimeJob.worker_id,
      worker_session_digest: (runtimeJob.input_json as CodexGenerationWorkloadV1).codex_session_runtime_context!.worker_session_digest,
      status: 'succeeded',
      app_server_thread_binding_required: true,
      codex_thread_id: 'thread-1',
      codex_thread_id_digest: expectedThreadDigest,
      output_capsule: runtimeCapsule({
        id: snapshotId,
        codex_session_id: sessionId,
        sequence: 1,
        digest: 'sha256:capsule-thread-bind',
        manifest_digest: 'sha256:capsule-thread-bind-manifest',
        codex_thread_id_digest: expectedThreadDigest,
        created_from_turn_id: runnerTurnId,
        created_by_actor_id: actorId,
      }),
      now,
    });
    await repository.markCodexSessionRunnerOwner({
      session_id: sessionId,
      runner_worker_id: runtimeJob.worker_id,
      runner_runtime_job_id: runtimeJob.id,
      runner_launch_lease_id: runtimeJob.launch_lease_id,
      runner_expires_at: '2026-05-31T00:10:00.000Z',
      now,
    });
    return runtimeJob;
  }

  async function terminalizeRuntimeJob(
    repository: DeliveryRepository,
    runtimeJob: CodexRuntimeJob,
    terminalResult: CodexGenerationRuntimeJobResult,
    suffix: string,
  ) {
    const terminalAt = '2026-05-31T00:02:00.000Z';
    const sessionToken = `plan-item-workflow-session-${runtimeJob.project_id}`;
    const acceptedWorkerSessionDigest = codexCredentialPayloadDigest(sessionToken);
    const sessionKey = `plan-item-workflow-session-key-${runtimeJob.project_id}`;
    const envelope = await repository.getCodexRuntimeJobEnvelope({ runtime_job_id: runtimeJob.id });
    expect(envelope).toBeDefined();
    const launchTokenHash = String(envelope!.ciphertext).replace(/^in-memory:/, '');
    const replayProtection = (step: string) => ({
      method: 'POST' as const,
      path: `/test/product-generation-runtime/${runtimeJob.id}/${suffix}/${step}`,
      body_digest: codexCanonicalDigest({ runtime_job_id: runtimeJob.id, suffix, step, body: true }),
    });
    await repository.acceptCodexRuntimeJob({
      runtime_job_id: runtimeJob.id,
      worker_id: runtimeJob.worker_id,
      worker_session_token: sessionToken,
      nonce: `${suffix}-accept`,
      nonce_timestamp: terminalAt,
      accepted_worker_session_digest: acceptedWorkerSessionDigest,
      accepted_session_public_key_id: sessionKey,
      accepted_session_epoch: 1,
      idempotency_key: `${suffix}-accept`,
      request_digest: codexCanonicalDigest({ suffix, step: 'accept' }),
      replay_protection: replayProtection('accept'),
      now: terminalAt,
    });
    await repository.claimCodexLaunchTokenEnvelope({
      runtime_job_id: runtimeJob.id,
      envelope_id: envelope!.id,
      worker_id: runtimeJob.worker_id,
      worker_session_token: sessionToken,
      nonce: `${suffix}-claim-envelope`,
      nonce_timestamp: terminalAt,
      accepted_worker_session_digest: acceptedWorkerSessionDigest,
      key_id: sessionKey,
      accepted_session_epoch: 1,
      claim_request_id: `${suffix}-claim-envelope`,
      request_digest: codexCanonicalDigest({ suffix, step: 'claim-envelope' }),
      replay_protection: replayProtection('claim-envelope'),
      now: terminalAt,
    });
    await repository.materializeCodexRuntimeJob({
      runtime_job_id: runtimeJob.id,
      launch_lease_id: runtimeJob.launch_lease_id,
      worker_id: runtimeJob.worker_id,
      worker_session_token: sessionToken,
      nonce: `${suffix}-materialize`,
      nonce_timestamp: terminalAt,
      launch_token_hash: launchTokenHash,
      accepted_worker_session_digest: acceptedWorkerSessionDigest,
      accepted_session_public_key_id: sessionKey,
      accepted_session_epoch: 1,
      materialization_request_id: `${suffix}-materialize`,
      request_digest: codexCanonicalDigest({ suffix, step: 'materialize' }),
      replay_protection: replayProtection('materialize'),
      now: terminalAt,
    });
    await repository.startCodexRuntimeJob({
      runtime_job_id: runtimeJob.id,
      worker_id: runtimeJob.worker_id,
      worker_session_token: sessionToken,
      nonce: `${suffix}-start`,
      nonce_timestamp: terminalAt,
      idempotency_key: `${suffix}-start`,
      request_digest: codexCanonicalDigest({ suffix, step: 'start' }),
      runtime_evidence_digest: codexCanonicalDigest({ suffix, step: 'runtime-evidence' }),
      launch_materialization_digest: codexCanonicalDigest({ suffix, step: 'launch-materialization' }),
      replay_protection: replayProtection('start'),
      now: terminalAt,
    });
    await repository.terminalizeCodexRuntimeJob({
      runtime_job_id: runtimeJob.id,
      launch_lease_id: runtimeJob.launch_lease_id,
      worker_id: runtimeJob.worker_id,
      worker_session_token: sessionToken,
      nonce: `${suffix}-terminal`,
      nonce_timestamp: terminalAt,
      terminal_status: 'succeeded',
      reason_code: 'completed',
      terminal_result_json: terminalResult as unknown as Record<string, unknown>,
      idempotency_key: `${suffix}-terminal`,
      request_digest: codexCanonicalDigest({ suffix, step: 'terminal' }),
      replay_protection: replayProtection('terminal'),
      now: terminalAt,
    });
  }

  async function terminalizeAttachedRuntimeJob(
    repository: DeliveryRepository,
    runtimeJob: CodexRuntimeJob,
    terminalResult: CodexGenerationRuntimeJobResult,
    suffix: string,
  ) {
    const terminalAt = '2026-05-31T00:02:00.000Z';
    const sessionToken = `plan-item-workflow-session-${runtimeJob.project_id}`;
    const acceptedWorkerSessionDigest = codexCredentialPayloadDigest(sessionToken);
    const sessionKey = `plan-item-workflow-session-key-${runtimeJob.project_id}`;
    const runtimeContext = (runtimeJob.input_json as CodexGenerationWorkloadV1).codex_session_runtime_context;
    expect(runtimeContext?.continuation.kind).toBe('resume_thread');
    const replayProtection = (step: string) => ({
      method: 'POST' as const,
      path: `/test/product-generation-runtime/${runtimeJob.id}/${suffix}/${step}`,
      body_digest: codexCanonicalDigest({ runtime_job_id: runtimeJob.id, suffix, step, body: true }),
    });
    await repository.acceptCodexRuntimeJob({
      runtime_job_id: runtimeJob.id,
      worker_id: runtimeJob.worker_id,
      worker_session_token: sessionToken,
      nonce: `${suffix}-accept`,
      nonce_timestamp: terminalAt,
      accepted_worker_session_digest: acceptedWorkerSessionDigest,
      accepted_session_public_key_id: sessionKey,
      accepted_session_epoch: 1,
      idempotency_key: `${suffix}-accept`,
      request_digest: codexCanonicalDigest({ suffix, step: 'accept' }),
      replay_protection: replayProtection('accept'),
      now: terminalAt,
    });
    await repository.attachCodexSessionRunnerRuntimeJob({
      session_id: runtimeContext!.codex_session_id,
      runner_runtime_job_id: runtimeContext!.runner_runtime_job_id!,
      runner_launch_lease_id: runtimeContext!.runner_launch_lease_id!,
      runner_expires_at: new Date(Date.parse(terminalAt) + 10 * 60 * 1000).toISOString(),
      attached_runtime_job_id: runtimeJob.id,
      worker_id: runtimeJob.worker_id,
      worker_session_token: sessionToken,
      nonce: `${suffix}-attach`,
      nonce_timestamp: terminalAt,
      runtime_evidence_digest: codexCanonicalDigest({ suffix, step: 'runtime-evidence' }),
      launch_materialization_digest: codexCanonicalDigest({ suffix, step: 'launch-materialization' }),
      idempotency_key: `${suffix}-attach`,
      request_digest: codexCanonicalDigest({ suffix, step: 'attach' }),
      replay_protection: replayProtection('attach'),
      now: terminalAt,
    });
    await repository.terminalizeCodexRuntimeJob({
      runtime_job_id: runtimeJob.id,
      launch_lease_id: runtimeJob.launch_lease_id,
      worker_id: runtimeJob.worker_id,
      worker_session_token: sessionToken,
      nonce: `${suffix}-terminal`,
      nonce_timestamp: terminalAt,
      terminal_status: 'succeeded',
      reason_code: 'completed',
      terminal_result_json: terminalResult as unknown as Record<string, unknown>,
      idempotency_key: `${suffix}-terminal`,
      request_digest: codexCanonicalDigest({ suffix, step: 'terminal' }),
      replay_protection: replayProtection('terminal'),
      now: terminalAt,
    });
  }

  async function terminalizeRuntimeJobThroughService(
    repository: DeliveryRepository,
    service: CodexRuntimeService,
    runtimeJob: CodexRuntimeJob,
    terminalStatus: 'failed' | 'cancelled',
    reasonCode: string,
    suffix: string,
  ) {
    const terminalAt = '2026-05-31T00:02:00.000Z';
    const sessionToken = `plan-item-workflow-session-${runtimeJob.project_id}`;
    const acceptedWorkerSessionDigest = codexCredentialPayloadDigest(sessionToken);
    const sessionKey = `plan-item-workflow-session-key-${runtimeJob.project_id}`;
    const envelope = await repository.getCodexRuntimeJobEnvelope({ runtime_job_id: runtimeJob.id });
    expect(envelope).toBeDefined();
    const launchTokenHash = String(envelope!.ciphertext).replace(/^in-memory:/, '');
    const replayProtection = (step: string, bodyDigest: string) => ({
      method: 'POST' as const,
      path: step === 'terminal' ? `/internal/codex-workers/${runtimeJob.worker_id}/runtime-jobs/${runtimeJob.id}/terminal` : `/test/product-generation-runtime/${runtimeJob.id}/${suffix}/${step}`,
      body_digest: bodyDigest,
    });
    const digest = (step: string) => codexCanonicalDigest({ runtime_job_id: runtimeJob.id, suffix, step, body: true });
    await repository.acceptCodexRuntimeJob({
      runtime_job_id: runtimeJob.id,
      worker_id: runtimeJob.worker_id,
      worker_session_token: sessionToken,
      nonce: `${suffix}-accept`,
      nonce_timestamp: terminalAt,
      accepted_worker_session_digest: acceptedWorkerSessionDigest,
      accepted_session_public_key_id: sessionKey,
      accepted_session_epoch: 1,
      idempotency_key: `${suffix}-accept`,
      request_digest: codexCanonicalDigest({ suffix, step: 'accept' }),
      replay_protection: replayProtection('accept', digest('accept')),
      now: terminalAt,
    });
    const runtimeContext = (runtimeJob.input_json as CodexGenerationWorkloadV1).codex_session_runtime_context;
    if (runtimeContext?.continuation.kind === 'resume_thread') {
      await repository.attachCodexSessionRunnerRuntimeJob({
        session_id: runtimeContext.codex_session_id,
        runner_runtime_job_id: runtimeContext.runner_runtime_job_id!,
        runner_launch_lease_id: runtimeContext.runner_launch_lease_id!,
        runner_expires_at: new Date(Date.parse(terminalAt) + 10 * 60 * 1000).toISOString(),
        attached_runtime_job_id: runtimeJob.id,
        worker_id: runtimeJob.worker_id,
        worker_session_token: sessionToken,
        nonce: `${suffix}-attach`,
        nonce_timestamp: terminalAt,
        runtime_evidence_digest: codexCanonicalDigest({ suffix, step: 'runtime-evidence' }),
        launch_materialization_digest: codexCanonicalDigest({ suffix, step: 'launch-materialization' }),
        idempotency_key: `${suffix}-start`,
        request_digest: codexCanonicalDigest({ suffix, step: 'start' }),
        replay_protection: replayProtection('attach', digest('start')),
        now: terminalAt,
      });
    } else {
    await repository.claimCodexLaunchTokenEnvelope({
      runtime_job_id: runtimeJob.id,
      envelope_id: envelope!.id,
      worker_id: runtimeJob.worker_id,
      worker_session_token: sessionToken,
      nonce: `${suffix}-claim-envelope`,
      nonce_timestamp: terminalAt,
      accepted_worker_session_digest: acceptedWorkerSessionDigest,
      key_id: sessionKey,
      accepted_session_epoch: 1,
      claim_request_id: `${suffix}-claim-envelope`,
      request_digest: codexCanonicalDigest({ suffix, step: 'claim-envelope' }),
      replay_protection: replayProtection('claim-envelope', digest('claim-envelope')),
      now: terminalAt,
    });
    await repository.materializeCodexRuntimeJob({
      runtime_job_id: runtimeJob.id,
      launch_lease_id: runtimeJob.launch_lease_id,
      worker_id: runtimeJob.worker_id,
      worker_session_token: sessionToken,
      nonce: `${suffix}-materialize`,
      nonce_timestamp: terminalAt,
      launch_token_hash: launchTokenHash,
      accepted_worker_session_digest: acceptedWorkerSessionDigest,
      accepted_session_public_key_id: sessionKey,
      accepted_session_epoch: 1,
      materialization_request_id: `${suffix}-materialize`,
      request_digest: codexCanonicalDigest({ suffix, step: 'materialize' }),
      replay_protection: replayProtection('materialize', digest('materialize')),
      now: terminalAt,
    });
    await repository.startCodexRuntimeJob({
      runtime_job_id: runtimeJob.id,
      worker_id: runtimeJob.worker_id,
      worker_session_token: sessionToken,
      nonce: `${suffix}-start`,
      nonce_timestamp: terminalAt,
      idempotency_key: `${suffix}-start`,
      request_digest: codexCanonicalDigest({ suffix, step: 'start' }),
      runtime_evidence_digest: codexCanonicalDigest({ suffix, step: 'runtime-evidence' }),
      launch_materialization_digest: codexCanonicalDigest({ suffix, step: 'launch-materialization' }),
      replay_protection: replayProtection('start', digest('start')),
      now: terminalAt,
    });
    }
    const terminalBody = {
      launch_lease_id: runtimeJob.launch_lease_id,
      worker_session_token: sessionToken,
      nonce: `${suffix}-terminal`,
      nonce_timestamp: terminalAt,
      terminal_status: terminalStatus,
      reason_code: reasonCode,
      terminal_idempotency_key: `${suffix}-terminal`,
      body_digest: '',
    };
    const body_digest = codexCanonicalDigest({ ...terminalBody, body_digest: undefined });
    return service.terminalizeRuntimeJob(runtimeJob.worker_id, runtimeJob.id, {
      ...terminalBody,
      body_digest,
    });
  }

  function newCodexRuntimeService() {
    return new CodexRuntimeService(
      repository,
      '/tmp/forgeloop-test-artifacts',
      new ProductGenerationResultService(
        repository,
        '/tmp/forgeloop-test-artifacts',
        { applyBoundaryRoundRuntimeResult: vi.fn(async () => ({ applied: true as const })) } as never,
        {} as never,
        new ControlPlaneRuntimeService('test'),
      ),
    );
  }
});

function scheduleInput(
  workflowId: string,
  sessionId: string,
  turnId: string,
  projectId: string,
  scenario: string,
  overrides: Partial<{ action_input_json: Record<string, unknown> }> = {},
): Parameters<ProductGenerationRuntimeSchedulerService['schedule']>[0] {
  const precondition = { workflow_id: workflowId, codex_session_id: sessionId, codex_session_turn_id: turnId, scenario };
  return {
    action_run: {
      id: stableUuid({ kind: 'action-run', scenario, turnId }),
      action_type: 'run_boundary_brainstorming_round',
      target_object_type: 'boundary_round',
      target_object_id: stableUuid({ kind: 'boundary-round', scenario, turnId }),
      target_status: 'queued',
      idempotency_key: `boundary-round:${scenario}:${turnId}`,
      automation_scope: `project:${projectId}`,
      automation_settings_version: 1,
      capability_fingerprint: 'boundary-brainstorming-runtime:v1',
      precondition_fingerprint: codexCanonicalDigest(precondition),
      action_input_json: {
        requested_by_actor_id: 'actor-tech',
        precondition_fingerprint_json: precondition,
        ...(overrides.action_input_json ?? {}),
      },
      workflow_id: workflowId,
      codex_session_id: sessionId,
      codex_session_turn_id: turnId,
      now,
    } satisfies CreateOrReplayAutomationActionRunInput,
    task_kind: 'boundary_brainstorming_round',
    prompt_version: 'boundary-brainstorming-round:v1',
    output_schema_version: 'boundary_round_result.v1',
    context_manifest: contextManifest(projectId),
    signed_context_json: { schema_version: 'test_signed_context.v1', scenario },
    project_id: projectId,
    repo_ids: [],
    context: { workflow_id: workflowId, codex_session_id: sessionId, codex_session_turn_id: turnId },
  };
}

function contextManifest(projectId: string): ContextManifest {
  return {
    id: stableUuid({ kind: 'context-manifest', projectId }),
    revision_id: stableUuid({ kind: 'context-manifest-revision', projectId }),
    source_ref: { type: 'requirement', id: stableUuid({ kind: 'requirement', projectId }) },
    project_id: projectId,
    development_plan_id: stableUuid({ kind: 'plan', projectId }),
    development_plan_revision_id: stableUuid({ kind: 'plan-revision', projectId }),
    development_plan_item_id: stableUuid({ kind: 'item', projectId }),
    development_plan_item_revision_id: stableUuid({ kind: 'item-revision', projectId }),
    actor_guidance: 'actor-tech',
    sources: [],
    generated_at: now,
    runtime_identity: 'test:codex-runtime-product-generation-scheduler',
    created_at: now,
    updated_at: now,
  };
}

function runtimeCapsule(input: {
  id: string;
  codex_session_id: string;
  sequence: number;
  digest: string;
  manifest_digest: string;
  codex_thread_id_digest: string;
  created_from_turn_id: string;
  created_by_actor_id: string;
  thread_state_digest?: string;
  memory_state_digest?: string;
  environment_manifest_digest?: string;
  app_server_protocol_digest?: string;
  trusted_runtime_manifest_digest?: string;
  credential_binding_lineage_digest?: string;
}) {
  return {
    id: input.id,
    codex_session_id: input.codex_session_id,
    sequence: input.sequence,
    artifact_ref: `artifact://internal/codex_runtime_capsule/codex_session/${input.codex_session_id}/${input.id}`,
    digest: input.digest,
    size_bytes: '123',
    manifest_digest: input.manifest_digest,
    thread_state_digest: input.thread_state_digest ?? `${input.digest}:thread-state`,
    memory_state_digest: input.memory_state_digest ?? `${input.digest}:memory-state`,
    environment_manifest_digest: input.environment_manifest_digest ?? `${input.digest}:environment-manifest`,
    codex_thread_id_digest: input.codex_thread_id_digest,
    codex_cli_version: '0.1.0-test',
    app_server_protocol_digest: input.app_server_protocol_digest ?? `${input.digest}:app-server-protocol`,
    runtime_profile_revision_id: 'runtime-profile-revision-1',
    trusted_runtime_manifest_digest: input.trusted_runtime_manifest_digest ?? `${input.digest}:trusted-runtime-manifest`,
    credential_binding_lineage_digest: input.credential_binding_lineage_digest ?? `${input.digest}:credential-binding-lineage`,
    created_from_turn_id: input.created_from_turn_id,
    created_by_actor_id: input.created_by_actor_id,
    created_at: now,
  };
}

function trustedLeaseOutputCapsuleBody(input: {
  sessionId: string;
  turnId: string;
  id: string;
  sequence: number;
  digest: string;
  manifestDigest: string;
  codexThreadIdDigest: string;
  actorId: string;
}) {
  const capsule = runtimeCapsule({
    id: input.id,
    codex_session_id: input.sessionId,
    sequence: input.sequence,
    digest: input.digest,
    manifest_digest: input.manifestDigest,
    codex_thread_id_digest: input.codexThreadIdDigest,
    created_from_turn_id: input.turnId,
    created_by_actor_id: input.actorId,
  });
  return {
    output_capsule_id: capsule.id,
    output_capsule_sequence: capsule.sequence,
    output_capsule_artifact_ref: capsule.artifact_ref,
    output_capsule_digest: capsule.digest,
    output_capsule_size_bytes: capsule.size_bytes,
    output_capsule_manifest_digest: capsule.manifest_digest,
    output_capsule_thread_state_digest: capsule.thread_state_digest,
    output_capsule_memory_state_digest: capsule.memory_state_digest,
    output_capsule_environment_manifest_digest: capsule.environment_manifest_digest,
    output_capsule_codex_thread_id_digest: capsule.codex_thread_id_digest,
    output_capsule_codex_cli_version: capsule.codex_cli_version,
    output_capsule_app_server_protocol_digest: capsule.app_server_protocol_digest,
    runtime_profile_revision_id: capsule.runtime_profile_revision_id,
    output_capsule_trusted_runtime_manifest_digest: capsule.trusted_runtime_manifest_digest,
    output_capsule_credential_binding_lineage_digest: capsule.credential_binding_lineage_digest,
  };
}

function generationTerminalResult(overrides: Partial<CodexGenerationRuntimeJobResult> = {}): CodexGenerationRuntimeJobResult {
  const generatedPayload = {
    schema_version: 'boundary_round_result.v1',
    session_id: 'boundary-session-1',
    round_id: 'boundary-round-1',
    questions: [],
    proposed_decisions: [],
    summary_proposal: {
      summary_markdown: 'No questions.',
      confirmed_scope: [],
      confirmed_out_of_scope: [],
      accepted_assumptions: [],
      open_risks: [],
      validation_expectations: [],
    },
    needs_leader_input: false,
    public_summary: 'No questions.',
    artifacts: [],
  };
  return {
    task_kind: 'boundary_brainstorming_round',
    prompt_version: 'boundary-brainstorming-round:v1',
    output_schema_version: 'boundary_round_result.v1',
    generated_payload: generatedPayload,
    generated_payload_digest: codexCanonicalDigest(generatedPayload),
    generation_artifacts: [],
    public_summary: 'Generated product artifact.',
    ...overrides,
  };
}

function stableUuid(input: Record<string, unknown>): string {
  const hex = codexCanonicalDigest(input).slice('sha256:'.length);
  const variant = ((Number.parseInt(hex[16] ?? '0', 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
