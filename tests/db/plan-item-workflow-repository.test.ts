import { describe, expect, it } from 'vitest';
import { DomainError, type BoundarySummaryRevision, type DevelopmentPlan } from '@forgeloop/domain';

import { InMemoryDeliveryRepository } from '../../packages/db/src/index';

const now = '2026-05-31T00:00:00.000Z';

const expectDomainErrorCode = async (action: () => Promise<unknown>, code: string) => {
  try {
    await action();
    throw new Error(`Expected DomainError ${code}`);
  } catch (error) {
    if (error instanceof Error && error.message === `Expected DomainError ${code}`) throw error;
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe(code as DomainError['code']);
  }
};

const baseWorkflowInput = {
  id: 'workflow-1',
  codex_session_id: 'session-1',
  development_plan_id: 'plan-1',
  development_plan_item_id: 'item-1',
  runtime_profile_id: 'profile-1',
  runtime_profile_revision_id: 'profile-revision-1',
  credential_binding_id: 'credential-1',
  credential_binding_version_id: 'credential-version-1',
  actor_id: 'actor-tech',
  now,
};

const turnInput = {
  id: 'turn-1',
  codex_session_id: 'session-1',
  workflow_id: 'workflow-1',
  intent: 'continue_execution',
  status: 'running',
  input_digest: 'sha256:turn-input',
  expected_previous_snapshot_digest: undefined,
  created_by_actor_id: 'actor-tech',
  created_at: now,
  updated_at: now,
} as const;

const leaseInput = {
  session_id: 'session-1',
  workflow_id: 'workflow-1',
  lease_id: 'lease-1',
  lease_token_hash: 'sha256:lease-token',
  worker_id: 'worker-1',
  worker_session_digest: 'sha256:worker-session',
  expected_previous_snapshot_digest: undefined,
  now,
  expires_at: '2026-05-31T00:05:00.000Z',
};

const seedWorkflowWithSnapshot = async (repository: InMemoryDeliveryRepository) => {
  await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
  const session = await repository.getCodexSession('session-1');
  if (session === undefined) throw new Error('Expected seeded Codex session');
  await repository.saveCodexSession({
    ...session,
    latest_snapshot_id: 'snapshot-1',
    latest_snapshot_digest: 'sha256:snapshot-1',
  });
};

const snapshotInput = {
  id: 'snapshot-1',
  codex_session_id: 'session-1',
  sequence: 1,
  artifact_ref: 'artifact://snapshot-1',
  digest: 'sha256:snapshot-1',
  size_bytes: '123',
  manifest_digest: 'sha256:manifest-1',
  runtime_profile_revision_id: 'profile-revision-1',
  created_from_turn_id: 'turn-1',
  created_by_actor_id: 'actor-tech',
  created_at: '2026-05-31T00:02:00.000Z',
} as const;

describe('Plan Item Workflow repository', () => {
  it('creates workflow with initial active Codex Session', async () => {
    const repository = new InMemoryDeliveryRepository();

    const created = await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);

    expect(created.workflow).toMatchObject({
      id: 'workflow-1',
      status: 'not_started',
      active_codex_session_id: 'session-1',
    });
    expect(created.session).toMatchObject({
      id: 'session-1',
      status: 'idle',
      role: 'active',
      owner_id: 'workflow-1',
      lease_epoch: 0,
    });
  });

  it('rejects a second active workflow for the same Plan Item', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);

    await expect(
      repository.createPlanItemWorkflowWithInitialSession({
        ...baseWorkflowInput,
        id: 'workflow-2',
        codex_session_id: 'session-2',
      }),
    ).rejects.toThrow(DomainError);
  });

  it('claims only the workflow active session and rejects a second active lease', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);

    const claimed = await repository.claimCodexSessionLease(leaseInput);

    expect(claimed.lease).toMatchObject({ status: 'active', lease_epoch: 1 });
    await expectDomainErrorCode(
      () =>
        repository.claimCodexSessionLease({
          session_id: 'session-1',
          workflow_id: 'workflow-1',
          lease_id: 'lease-2',
          lease_token_hash: 'sha256:other',
          worker_id: 'worker-2',
          worker_session_digest: 'sha256:worker-session-2',
          expected_previous_snapshot_digest: undefined,
          now,
          expires_at: '2026-05-31T00:05:00.000Z',
        }),
      'codex_session_lease_conflict',
    );
  });

  it('recovers an expired active lease at claim time and allows a new claim', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    const expiredClaim = await repository.claimCodexSessionLease({
      ...leaseInput,
      expires_at: '2026-05-31T00:01:00.000Z',
    });

    const recovered = await repository.claimCodexSessionLease({
      ...leaseInput,
      lease_id: 'lease-2',
      lease_token_hash: 'sha256:lease-token-2',
      worker_id: 'worker-2',
      worker_session_digest: 'sha256:worker-session-2',
      now: '2026-05-31T00:02:00.000Z',
      expires_at: '2026-05-31T00:07:00.000Z',
    });

    expect(recovered.lease).toMatchObject({ id: 'lease-2', status: 'active', lease_epoch: 2 });
    expect(recovered.session).toMatchObject({
      id: 'session-1',
      status: 'running',
      active_lease_id: 'lease-2',
      lease_epoch: 2,
    });
    await expect(repository.getCodexSession('session-1')).resolves.toMatchObject({ active_lease_id: 'lease-2' });
    await expect(repository.renewCodexSessionLease({
      session_id: 'session-1',
      lease_id: expiredClaim.lease.id,
      lease_token_hash: 'sha256:lease-token',
      worker_id: 'worker-1',
      worker_session_digest: 'sha256:worker-session',
      lease_epoch: 1,
      now: '2026-05-31T00:02:30.000Z',
      expires_at: '2026-05-31T00:08:00.000Z',
    })).rejects.toMatchObject({ code: 'codex_session_lease_conflict' });
  });

  it('does not recover an expired active lease before rejecting a claim for the wrong workflow', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    await repository.createPlanItemWorkflowWithInitialSession({
      ...baseWorkflowInput,
      id: 'workflow-2',
      codex_session_id: 'session-2',
      development_plan_item_id: 'item-2',
    });
    await repository.claimCodexSessionLease({
      ...leaseInput,
      expires_at: '2026-05-31T00:01:00.000Z',
    });

    await expectDomainErrorCode(
      () =>
        repository.claimCodexSessionLease({
          ...leaseInput,
          workflow_id: 'workflow-2',
          lease_id: 'lease-2',
          lease_token_hash: 'sha256:lease-token-2',
          worker_id: 'worker-2',
          worker_session_digest: 'sha256:worker-session-2',
          now: '2026-05-31T00:02:00.000Z',
          expires_at: '2026-05-31T00:07:00.000Z',
        }),
      'codex_session_lease_conflict',
    );

    await expect(repository.getCodexSession('session-1')).resolves.toMatchObject({
      status: 'running',
      active_lease_id: 'lease-1',
    });
    await expect(repository.renewCodexSessionLease({
      session_id: 'session-1',
      lease_id: 'lease-1',
      lease_token_hash: 'sha256:lease-token',
      worker_id: 'worker-1',
      worker_session_digest: 'sha256:worker-session',
      lease_epoch: 1,
      now: '2026-05-31T00:00:30.000Z',
      expires_at: '2026-05-31T00:08:00.000Z',
    })).resolves.toMatchObject({ id: 'lease-1', status: 'active' });
  });

  it('does not recover an expired active lease before rejecting a claim with a stale snapshot expectation', async () => {
    const repository = new InMemoryDeliveryRepository();
    await seedWorkflowWithSnapshot(repository);
    await repository.claimCodexSessionLease({
      ...leaseInput,
      expected_previous_snapshot_digest: 'sha256:snapshot-1',
      expires_at: '2026-05-31T00:01:00.000Z',
    });

    await expectDomainErrorCode(
      () =>
        repository.claimCodexSessionLease({
          ...leaseInput,
          lease_id: 'lease-2',
          lease_token_hash: 'sha256:lease-token-2',
          worker_id: 'worker-2',
          worker_session_digest: 'sha256:worker-session-2',
          expected_previous_snapshot_digest: 'sha256:stale',
          now: '2026-05-31T00:02:00.000Z',
          expires_at: '2026-05-31T00:07:00.000Z',
        }),
      'codex_session_snapshot_stale',
    );

    await expect(repository.getCodexSession('session-1')).resolves.toMatchObject({
      status: 'running',
      active_lease_id: 'lease-1',
      latest_snapshot_digest: 'sha256:snapshot-1',
    });
    await expect(repository.renewCodexSessionLease({
      session_id: 'session-1',
      lease_id: 'lease-1',
      lease_token_hash: 'sha256:lease-token',
      worker_id: 'worker-1',
      worker_session_digest: 'sha256:worker-session',
      lease_epoch: 1,
      now: '2026-05-31T00:00:30.000Z',
      expires_at: '2026-05-31T00:08:00.000Z',
    })).resolves.toMatchObject({ id: 'lease-1', status: 'active' });
  });

  it('rejects reusing a released lease id', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    await repository.createCodexSessionTurn(turnInput);
    await repository.claimCodexSessionLease(leaseInput);
    await repository.terminalizeCodexSessionTurn({
      session_id: 'session-1',
      turn_id: 'turn-1',
      lease_id: 'lease-1',
      lease_token_hash: 'sha256:lease-token',
      lease_epoch: 1,
      worker_id: 'worker-1',
      worker_session_digest: 'sha256:worker-session',
      status: 'succeeded',
      expected_previous_snapshot_digest: undefined,
      now: '2026-05-31T00:02:00.000Z',
    });

    await expectDomainErrorCode(() => repository.claimCodexSessionLease(leaseInput), 'codex_session_lease_conflict');
  });

  it('rejects lease claim when session is missing', async () => {
    const repository = new InMemoryDeliveryRepository();

    await expectDomainErrorCode(() => repository.claimCodexSessionLease(leaseInput), 'codex_session_lease_conflict');
  });

  it('rejects lease claim when owner workflow is missing', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.saveCodexSession({
      id: 'session-1',
      owner_type: 'plan_item_workflow',
      owner_id: 'workflow-1',
      status: 'idle',
      role: 'active',
      runtime_profile_id: 'profile-1',
      runtime_profile_revision_id: 'profile-revision-1',
      credential_binding_id: 'credential-1',
      credential_binding_version_id: 'credential-version-1',
      lease_epoch: 0,
      created_by_actor_id: 'actor-tech',
      created_at: now,
      updated_at: now,
    });

    await expectDomainErrorCode(() => repository.claimCodexSessionLease(leaseInput), 'codex_session_lease_conflict');
  });

  it('rejects lease claim for inactive role or candidate fork sessions', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    const session = await repository.getCodexSession('session-1');
    if (session === undefined) throw new Error('Expected seeded Codex session');

    await repository.saveCodexSession({ ...session, role: 'inactive_fork' });
    await expectDomainErrorCode(() => repository.claimCodexSessionLease(leaseInput), 'codex_session_lease_conflict');

    await repository.saveCodexSession({ ...session, role: 'candidate_fork' });
    await expectDomainErrorCode(() => repository.claimCodexSessionLease(leaseInput), 'codex_session_lease_conflict');
  });

  it('rejects lease claim when workflow active session does not match', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    const workflow = await repository.getPlanItemWorkflow('workflow-1');
    if (workflow === undefined) throw new Error('Expected seeded workflow');
    await repository.savePlanItemWorkflow({ ...workflow, active_codex_session_id: 'session-other' });

    await expectDomainErrorCode(() => repository.claimCodexSessionLease(leaseInput), 'codex_session_lease_conflict');
  });

  it('rejects lease claim for disallowed session statuses', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    const session = await repository.getCodexSession('session-1');
    if (session === undefined) throw new Error('Expected seeded Codex session');

    await repository.saveCodexSession({ ...session, status: 'archived', archived_at: now });
    await expectDomainErrorCode(() => repository.claimCodexSessionLease(leaseInput), 'codex_session_lease_conflict');

    await repository.saveCodexSession({ ...session, status: 'running' });
    await expectDomainErrorCode(() => repository.claimCodexSessionLease(leaseInput), 'codex_session_lease_conflict');
  });

  it('rejects lease claim when expected snapshot digest is stale', async () => {
    const repository = new InMemoryDeliveryRepository();
    await seedWorkflowWithSnapshot(repository);

    await expectDomainErrorCode(
      () =>
        repository.claimCodexSessionLease({
          ...leaseInput,
          expected_previous_snapshot_digest: 'sha256:stale',
        }),
      'codex_session_snapshot_stale',
    );
  });

  it('rejects creating a turn for a missing session', async () => {
    const repository = new InMemoryDeliveryRepository();

    await expectDomainErrorCode(() => repository.createCodexSessionTurn(turnInput), 'workflow_active_session_missing');
  });

  it('rejects creating a turn when workflow does not own the session', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);

    await expectDomainErrorCode(
      () =>
        repository.createCodexSessionTurn({
          ...turnInput,
          workflow_id: 'workflow-other',
        }),
      'workflow_active_session_missing',
    );
  });

  it('rejects creating a turn when expected snapshot digest is stale', async () => {
    const repository = new InMemoryDeliveryRepository();
    await seedWorkflowWithSnapshot(repository);

    await expectDomainErrorCode(
      () =>
        repository.createCodexSessionTurn({
          ...turnInput,
          expected_previous_snapshot_digest: 'sha256:stale',
        }),
      'codex_session_snapshot_stale',
    );
  });

  it('rejects creating a turn for a candidate fork because turns are created before lease claim sets running', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    await repository.createCodexSessionTurn(turnInput);
    await repository.createCodexSessionFork({
      id: 'session-fork',
      workflow_id: 'workflow-1',
      parent_session_id: 'session-1',
      forked_from_turn_id: 'turn-1',
      fork_reason: 'Try another approach.',
      created_by_actor_id: 'actor-tech',
      now,
    });

    await expectDomainErrorCode(
      () =>
        repository.createCodexSessionTurn({
          ...turnInput,
          id: 'turn-fork',
          codex_session_id: 'session-fork',
        }),
      'workflow_active_session_missing',
    );
  });

  it('rejects creating a turn for an inactive fork because turns are created before lease claim sets running', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    await repository.createCodexSessionTurn(turnInput);
    await repository.createCodexSessionFork({
      id: 'session-fork',
      workflow_id: 'workflow-1',
      parent_session_id: 'session-1',
      forked_from_turn_id: 'turn-1',
      fork_reason: 'Try another approach.',
      created_by_actor_id: 'actor-tech',
      now,
    });
    const fork = await repository.getCodexSession('session-fork');
    if (fork === undefined) throw new Error('Expected seeded fork');
    await repository.saveCodexSession({ ...fork, role: 'inactive_fork' });

    await expectDomainErrorCode(
      () =>
        repository.createCodexSessionTurn({
          ...turnInput,
          id: 'turn-fork',
          codex_session_id: 'session-fork',
        }),
      'workflow_active_session_missing',
    );
  });

  it('rejects creating a turn for an archived session because turns are created before lease claim sets running', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    const session = await repository.getCodexSession('session-1');
    if (session === undefined) throw new Error('Expected seeded Codex session');
    await repository.saveCodexSession({ ...session, status: 'archived', archived_at: now });

    await expectDomainErrorCode(() => repository.createCodexSessionTurn(turnInput), 'workflow_active_session_missing');
  });

  it('rejects creating a turn when workflow active session does not match', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    const workflow = await repository.getPlanItemWorkflow('workflow-1');
    if (workflow === undefined) throw new Error('Expected seeded workflow');
    await repository.savePlanItemWorkflow({ ...workflow, active_codex_session_id: 'session-other' });

    await expectDomainErrorCode(() => repository.createCodexSessionTurn(turnInput), 'workflow_active_session_missing');
  });

  it('rejects candidate fork lease and archived fork selection', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    await repository.createCodexSessionTurn(turnInput);
    await repository.createCodexSessionFork({
      id: 'session-fork',
      workflow_id: 'workflow-1',
      parent_session_id: 'session-1',
      forked_from_turn_id: 'turn-1',
      fork_reason: 'Try another approach.',
      created_by_actor_id: 'actor-tech',
      now,
    });

    await expectDomainErrorCode(
      () =>
        repository.claimCodexSessionLease({
          session_id: 'session-fork',
          workflow_id: 'workflow-1',
          lease_id: 'lease-fork',
          lease_token_hash: 'sha256:fork',
          worker_id: 'worker-1',
          worker_session_digest: 'sha256:worker-session',
          expected_previous_snapshot_digest: undefined,
          now,
          expires_at: '2026-05-31T00:05:00.000Z',
        }),
      'codex_session_lease_conflict',
    );
  });

  it('renews and terminalizes active lease without leaving active lease behind', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    await repository.createCodexSessionTurn(turnInput);
    const claimed = await repository.claimCodexSessionLease(leaseInput);

    await expect(
      repository.renewCodexSessionLease({
        session_id: 'session-1',
        lease_id: claimed.lease.id,
        lease_token_hash: 'sha256:lease-token',
        worker_id: 'worker-1',
        worker_session_digest: 'sha256:worker-session',
        lease_epoch: 1,
        now: '2026-05-31T00:01:00.000Z',
        expires_at: '2026-05-31T00:10:00.000Z',
      }),
    ).resolves.toMatchObject({ heartbeat_at: '2026-05-31T00:01:00.000Z' });

    const terminalized = await repository.terminalizeCodexSessionTurn({
      session_id: 'session-1',
      turn_id: 'turn-1',
      lease_id: claimed.lease.id,
      lease_token_hash: 'sha256:lease-token',
      lease_epoch: 1,
      worker_id: 'worker-1',
      worker_session_digest: 'sha256:worker-session',
      status: 'succeeded',
      expected_previous_snapshot_digest: undefined,
      output_snapshot: {
        ...snapshotInput,
      },
      codex_thread_id: 'thread-1',
      codex_thread_id_digest: 'sha256:thread-1',
      now: '2026-05-31T00:02:00.000Z',
    });

    expect(terminalized.session).toMatchObject({
      status: 'idle',
      latest_snapshot_id: 'snapshot-1',
      latest_snapshot_digest: 'sha256:snapshot-1',
      codex_thread_id_digest: 'sha256:thread-1',
    });
    expect(terminalized.session).not.toHaveProperty('active_lease_id');
    await expect(repository.getCodexSessionSnapshot('snapshot-1')).resolves.toMatchObject({ digest: 'sha256:snapshot-1' });
  });

  it('rejects terminalization when a reused output snapshot id has drifted durable identity', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    await repository.createCodexSessionTurn(turnInput);
    await repository.createCodexSessionSnapshot(snapshotInput);
    const claimed = await repository.claimCodexSessionLease(leaseInput);

    await expectDomainErrorCode(
      () =>
        repository.terminalizeCodexSessionTurn({
          session_id: 'session-1',
          turn_id: 'turn-1',
          lease_id: claimed.lease.id,
          lease_token_hash: 'sha256:lease-token',
          lease_epoch: 1,
          worker_id: 'worker-1',
          worker_session_digest: 'sha256:worker-session',
          status: 'succeeded',
          expected_previous_snapshot_digest: undefined,
          output_snapshot: {
            id: 'snapshot-1',
            codex_session_id: 'session-1',
            sequence: 1,
            artifact_ref: 'artifact://snapshot-drifted',
            digest: 'sha256:snapshot-drifted',
            size_bytes: '123',
            manifest_digest: 'sha256:manifest-1',
            runtime_profile_revision_id: 'profile-revision-1',
            created_from_turn_id: 'turn-1',
            created_by_actor_id: 'actor-tech',
            created_at: '2026-05-31T00:03:00.000Z',
          },
          now: '2026-05-31T00:03:00.000Z',
        }),
      'codex_session_snapshot_stale',
    );

    const session = await repository.getCodexSession('session-1');
    expect(session).toMatchObject({
      status: 'running',
      active_lease_id: claimed.lease.id,
    });
    expect(session?.latest_snapshot_id).toBeUndefined();
    expect(session?.latest_snapshot_digest).toBeUndefined();

    const turn = await repository.getCodexSessionTurn('turn-1');
    expect(turn).toMatchObject({
      status: 'running',
    });
    expect(turn?.output_snapshot_id).toBeUndefined();
    expect(turn?.output_snapshot_digest).toBeUndefined();
    await expect(repository.getCodexSessionSnapshot('snapshot-1')).resolves.toMatchObject({
      artifact_ref: 'artifact://snapshot-1',
      digest: 'sha256:snapshot-1',
    });
  });

  it('rejects terminalizing an older non-latest running turn without moving the session backward', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    await repository.createCodexSessionTurn({ ...turnInput, id: 'turn-1', input_digest: 'sha256:turn-1' });
    await repository.createCodexSessionTurn({
      ...turnInput,
      id: 'turn-2',
      input_digest: 'sha256:turn-2',
      created_at: '2026-05-31T00:01:00.000Z',
      updated_at: '2026-05-31T00:01:00.000Z',
    });
    await repository.claimCodexSessionLease(leaseInput);

    await expectDomainErrorCode(
      () =>
        repository.terminalizeCodexSessionTurn({
          session_id: 'session-1',
          turn_id: 'turn-1',
          lease_id: 'lease-1',
          lease_token_hash: 'sha256:lease-token',
          lease_epoch: 1,
          worker_id: 'worker-1',
          worker_session_digest: 'sha256:worker-session',
          status: 'succeeded',
          expected_previous_snapshot_digest: undefined,
          now: '2026-05-31T00:02:00.000Z',
        }),
      'codex_session_stale_terminalization',
    );

    await expect(repository.getCodexSession('session-1')).resolves.toMatchObject({
      status: 'running',
      latest_turn_id: 'turn-2',
      latest_turn_digest: 'sha256:turn-2',
      active_lease_id: 'lease-1',
    });
    await expect(repository.getCodexSessionTurn('turn-1')).resolves.toMatchObject({ status: 'running' });
  });

  it('rejects stale terminalization without updating latest snapshot fields or turn status', async () => {
    const repository = new InMemoryDeliveryRepository();
    await seedWorkflowWithSnapshot(repository);
    await repository.createCodexSessionTurn({
      ...turnInput,
      expected_previous_snapshot_digest: 'sha256:snapshot-1',
    });
    const claimed = await repository.claimCodexSessionLease({
      ...leaseInput,
      expected_previous_snapshot_digest: 'sha256:snapshot-1',
    });

    await expectDomainErrorCode(
      () =>
        repository.terminalizeCodexSessionTurn({
          session_id: 'session-1',
          turn_id: 'turn-1',
          lease_id: claimed.lease.id,
          lease_token_hash: 'sha256:lease-token',
          lease_epoch: 1,
          worker_id: 'worker-1',
          worker_session_digest: 'sha256:worker-session',
          status: 'succeeded',
          expected_previous_snapshot_digest: 'sha256:stale',
          output_snapshot: {
            ...snapshotInput,
            id: 'snapshot-2',
            sequence: 2,
            artifact_ref: 'artifact://snapshot-2',
            digest: 'sha256:snapshot-2',
            manifest_digest: 'sha256:manifest-2',
            created_at: '2026-05-31T00:03:00.000Z',
          },
          codex_thread_id: 'thread-1',
          codex_thread_id_digest: 'sha256:thread-1',
          now: '2026-05-31T00:03:00.000Z',
        }),
      'codex_session_stale_terminalization',
    );

    await expect(repository.getCodexSession('session-1')).resolves.toMatchObject({
      status: 'running',
      latest_snapshot_id: 'snapshot-1',
      latest_snapshot_digest: 'sha256:snapshot-1',
      active_lease_id: claimed.lease.id,
    });
    const session = await repository.getCodexSession('session-1');
    expect(session?.codex_thread_id).toBeUndefined();
    expect(session?.codex_thread_id_digest).toBeUndefined();
    await expect(repository.getCodexSessionTurn('turn-1')).resolves.toMatchObject({
      status: 'running',
      expected_previous_snapshot_digest: 'sha256:snapshot-1',
    });
    const turn = await repository.getCodexSessionTurn('turn-1');
    expect(turn?.output_snapshot_id).toBeUndefined();
    expect(turn?.output_snapshot_digest).toBeUndefined();
    await expect(repository.getCodexSessionSnapshot('snapshot-2')).resolves.toBeUndefined();
  });

  it('forks from the requested persisted snapshot instead of parent latest', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    await repository.createCodexSessionSnapshot(snapshotInput);
    await repository.createCodexSessionSnapshot({
      ...snapshotInput,
      id: 'snapshot-2',
      sequence: 2,
      artifact_ref: 'artifact://snapshot-2',
      digest: 'sha256:snapshot-2',
      manifest_digest: 'sha256:manifest-2',
      created_from_turn_id: 'turn-2',
      created_at: '2026-05-31T00:03:00.000Z',
    });
    const session = await repository.getCodexSession('session-1');
    if (session === undefined) throw new Error('Expected seeded Codex session');
    await repository.saveCodexSession({
      ...session,
      latest_snapshot_id: 'snapshot-2',
      latest_snapshot_digest: 'sha256:snapshot-2',
    });

    const fork = await repository.createCodexSessionFork({
      id: 'session-fork',
      workflow_id: 'workflow-1',
      parent_session_id: 'session-1',
      forked_from_snapshot_id: 'snapshot-1',
      fork_reason: 'Try the older checkpoint.',
      created_by_actor_id: 'actor-tech',
      now: '2026-05-31T00:04:00.000Z',
    });

    expect(fork).toMatchObject({
      id: 'session-fork',
      latest_snapshot_id: 'snapshot-1',
      latest_snapshot_digest: 'sha256:snapshot-1',
      forked_from_snapshot_id: 'snapshot-1',
    });
  });

  it('does not inherit parent Codex thread identity when forking from a historical snapshot', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    await repository.createCodexSessionSnapshot(snapshotInput);
    const session = await repository.getCodexSession('session-1');
    if (session === undefined) throw new Error('Expected seeded Codex session');
    await repository.saveCodexSession({
      ...session,
      latest_snapshot_id: 'snapshot-1',
      latest_snapshot_digest: 'sha256:snapshot-1',
      codex_thread_id: 'thread-parent-current',
      codex_thread_id_digest: 'sha256:thread-parent-current',
    });

    const fork = await repository.createCodexSessionFork({
      id: 'session-fork',
      workflow_id: 'workflow-1',
      parent_session_id: 'session-1',
      forked_from_snapshot_id: 'snapshot-1',
      fork_reason: 'Try the older checkpoint without current thread baggage.',
      created_by_actor_id: 'actor-tech',
      now: '2026-05-31T00:04:00.000Z',
    });

    expect(fork).toMatchObject({
      id: 'session-fork',
      latest_snapshot_id: 'snapshot-1',
      latest_snapshot_digest: 'sha256:snapshot-1',
      forked_from_snapshot_id: 'snapshot-1',
    });
    expect(fork.codex_thread_id).toBeUndefined();
    expect(fork.codex_thread_id_digest).toBeUndefined();
  });

  it('forks from a turn output snapshot instead of a newer parent latest snapshot', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    await repository.createCodexSessionTurn(turnInput);
    await repository.createCodexSessionSnapshot(snapshotInput);
    await repository.saveCodexSessionTurn({
      ...turnInput,
      status: 'succeeded',
      output_snapshot_id: 'snapshot-1',
      output_snapshot_digest: 'sha256:snapshot-1',
      updated_at: '2026-05-31T00:02:00.000Z',
    });
    await repository.createCodexSessionSnapshot({
      ...snapshotInput,
      id: 'snapshot-2',
      sequence: 2,
      artifact_ref: 'artifact://snapshot-2',
      digest: 'sha256:snapshot-2',
      manifest_digest: 'sha256:manifest-2',
      created_from_turn_id: 'turn-2',
      created_at: '2026-05-31T00:03:00.000Z',
    });
    const session = await repository.getCodexSession('session-1');
    if (session === undefined) throw new Error('Expected seeded Codex session');
    await repository.saveCodexSession({
      ...session,
      latest_snapshot_id: 'snapshot-2',
      latest_snapshot_digest: 'sha256:snapshot-2',
    });

    const fork = await repository.createCodexSessionFork({
      id: 'session-fork',
      workflow_id: 'workflow-1',
      parent_session_id: 'session-1',
      forked_from_turn_id: 'turn-1',
      fork_reason: 'Try the first turn output.',
      created_by_actor_id: 'actor-tech',
      now: '2026-05-31T00:04:00.000Z',
    });

    expect(fork).toMatchObject({
      id: 'session-fork',
      latest_snapshot_id: 'snapshot-1',
      latest_snapshot_digest: 'sha256:snapshot-1',
      forked_from_turn_id: 'turn-1',
    });
    expect(fork.forked_from_snapshot_id).toBeUndefined();
  });

  it('rejects turn-based fork when the turn output snapshot is missing', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    await repository.createCodexSessionTurn(turnInput);
    await repository.saveCodexSessionTurn({
      ...turnInput,
      status: 'succeeded',
      output_snapshot_id: 'snapshot-missing',
      output_snapshot_digest: 'sha256:snapshot-missing',
      updated_at: '2026-05-31T00:02:00.000Z',
    });

    await expectDomainErrorCode(
      () =>
        repository.createCodexSessionFork({
          id: 'session-fork',
          workflow_id: 'workflow-1',
          parent_session_id: 'session-1',
          forked_from_turn_id: 'turn-1',
          fork_reason: 'Try the missing turn output.',
          created_by_actor_id: 'actor-tech',
          now: '2026-05-31T00:04:00.000Z',
        }),
      'codex_session_fork_invalid',
    );
  });

  it('rejects turn-based fork when the turn output snapshot belongs to another session', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    await repository.createCodexSessionTurn(turnInput);
    await repository.saveCodexSessionTurn({
      ...turnInput,
      status: 'succeeded',
      output_snapshot_id: 'snapshot-other',
      output_snapshot_digest: 'sha256:snapshot-other',
      updated_at: '2026-05-31T00:02:00.000Z',
    });
    await repository.saveCodexSession({
      id: 'session-other',
      owner_type: 'plan_item_workflow',
      owner_id: 'workflow-1',
      status: 'idle',
      role: 'inactive_fork',
      runtime_profile_id: 'profile-1',
      runtime_profile_revision_id: 'profile-revision-1',
      credential_binding_id: 'credential-1',
      credential_binding_version_id: 'credential-version-1',
      lease_epoch: 0,
      created_by_actor_id: 'actor-tech',
      created_at: now,
      updated_at: now,
    });
    await repository.createCodexSessionSnapshot({
      ...snapshotInput,
      id: 'snapshot-other',
      codex_session_id: 'session-other',
      artifact_ref: 'artifact://snapshot-other',
      digest: 'sha256:snapshot-other',
    });

    await expectDomainErrorCode(
      () =>
        repository.createCodexSessionFork({
          id: 'session-fork',
          workflow_id: 'workflow-1',
          parent_session_id: 'session-1',
          forked_from_turn_id: 'turn-1',
          fork_reason: 'Try the foreign turn output.',
          created_by_actor_id: 'actor-tech',
          now: '2026-05-31T00:04:00.000Z',
        }),
      'codex_session_fork_invalid',
    );
  });

  it('rejects turn-based fork when the turn output snapshot digest differs from persisted snapshot', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    await repository.createCodexSessionTurn(turnInput);
    await repository.createCodexSessionSnapshot(snapshotInput);
    await repository.saveCodexSessionTurn({
      ...turnInput,
      status: 'succeeded',
      output_snapshot_id: 'snapshot-1',
      output_snapshot_digest: 'sha256:stale-snapshot-1',
      updated_at: '2026-05-31T00:02:00.000Z',
    });

    await expectDomainErrorCode(
      () =>
        repository.createCodexSessionFork({
          id: 'session-fork',
          workflow_id: 'workflow-1',
          parent_session_id: 'session-1',
          forked_from_turn_id: 'turn-1',
          fork_reason: 'Try the stale turn output.',
          created_by_actor_id: 'actor-tech',
          now: '2026-05-31T00:04:00.000Z',
        }),
      'codex_session_fork_invalid',
    );
  });

  it('does not inherit parent latest snapshot when forking from a turn without output snapshot', async () => {
    const repository = new InMemoryDeliveryRepository();
    await seedWorkflowWithSnapshot(repository);
    await repository.createCodexSessionTurn({
      ...turnInput,
      expected_previous_snapshot_digest: 'sha256:snapshot-1',
    });

    const fork = await repository.createCodexSessionFork({
      id: 'session-fork',
      workflow_id: 'workflow-1',
      parent_session_id: 'session-1',
      forked_from_turn_id: 'turn-1',
      fork_reason: 'Try the pre-output turn.',
      created_by_actor_id: 'actor-tech',
      now: '2026-05-31T00:04:00.000Z',
    });

    expect(fork).toMatchObject({
      id: 'session-fork',
      forked_from_turn_id: 'turn-1',
    });
    expect(fork.latest_snapshot_id).toBeUndefined();
    expect(fork.latest_snapshot_digest).toBeUndefined();
    expect(fork.forked_from_snapshot_id).toBeUndefined();
  });

  it('rejects fork creation when requested turn and snapshot fork points do not match', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    await repository.createCodexSessionTurn(turnInput);
    await repository.createCodexSessionSnapshot(snapshotInput);
    await repository.saveCodexSessionTurn({
      ...turnInput,
      status: 'succeeded',
      output_snapshot_id: 'snapshot-1',
      output_snapshot_digest: 'sha256:snapshot-1',
      updated_at: '2026-05-31T00:02:00.000Z',
    });
    await repository.createCodexSessionSnapshot({
      ...snapshotInput,
      id: 'snapshot-2',
      sequence: 2,
      artifact_ref: 'artifact://snapshot-2',
      digest: 'sha256:snapshot-2',
      manifest_digest: 'sha256:manifest-2',
      created_from_turn_id: 'turn-2',
      created_at: '2026-05-31T00:03:00.000Z',
    });

    await expectDomainErrorCode(
      () =>
        repository.createCodexSessionFork({
          id: 'session-fork',
          workflow_id: 'workflow-1',
          parent_session_id: 'session-1',
          forked_from_turn_id: 'turn-1',
          forked_from_snapshot_id: 'snapshot-2',
          fork_reason: 'Try mismatched provenance.',
          created_by_actor_id: 'actor-tech',
          now: '2026-05-31T00:04:00.000Z',
        }),
      'codex_session_fork_invalid',
    );
  });

  it('rejects fork creation without an explicit turn or snapshot fork point', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);

    await expectDomainErrorCode(
      () =>
        repository.createCodexSessionFork({
          id: 'session-fork',
          workflow_id: 'workflow-1',
          parent_session_id: 'session-1',
          fork_reason: 'Missing fork point.',
          created_by_actor_id: 'actor-tech',
          now: '2026-05-31T00:04:00.000Z',
        }),
      'codex_session_fork_invalid',
    );
  });

  it('rejects fork creation when requested turn is missing or belongs to another session', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    await repository.saveCodexSession({
      id: 'session-other',
      owner_type: 'plan_item_workflow',
      owner_id: 'workflow-1',
      status: 'idle',
      role: 'inactive_fork',
      runtime_profile_id: 'profile-1',
      runtime_profile_revision_id: 'profile-revision-1',
      credential_binding_id: 'credential-1',
      credential_binding_version_id: 'credential-version-1',
      lease_epoch: 0,
      created_by_actor_id: 'actor-tech',
      created_at: now,
      updated_at: now,
    });
    await repository.saveCodexSessionTurn({
      ...turnInput,
      id: 'turn-other',
      codex_session_id: 'session-other',
      input_digest: 'sha256:turn-other',
    });

    await expectDomainErrorCode(
      () =>
        repository.createCodexSessionFork({
          id: 'session-fork-missing',
          workflow_id: 'workflow-1',
          parent_session_id: 'session-1',
          forked_from_turn_id: 'turn-missing',
          fork_reason: 'Missing turn.',
          created_by_actor_id: 'actor-tech',
          now: '2026-05-31T00:04:00.000Z',
        }),
      'codex_session_fork_invalid',
    );
    await expectDomainErrorCode(
      () =>
        repository.createCodexSessionFork({
          id: 'session-fork-foreign',
          workflow_id: 'workflow-1',
          parent_session_id: 'session-1',
          forked_from_turn_id: 'turn-other',
          fork_reason: 'Foreign turn.',
          created_by_actor_id: 'actor-tech',
          now: '2026-05-31T00:04:00.000Z',
        }),
      'codex_session_fork_invalid',
    );
  });

  it('forks from a requested parent-session turn without requiring a snapshot', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    await repository.createCodexSessionTurn(turnInput);

    const fork = await repository.createCodexSessionFork({
      id: 'session-fork',
      workflow_id: 'workflow-1',
      parent_session_id: 'session-1',
      forked_from_turn_id: 'turn-1',
      fork_reason: 'Try another approach.',
      created_by_actor_id: 'actor-tech',
      now: '2026-05-31T00:04:00.000Z',
    });

    expect(fork).toMatchObject({
      id: 'session-fork',
      role: 'candidate_fork',
      forked_from_session_id: 'session-1',
      forked_from_turn_id: 'turn-1',
    });
    expect(fork.forked_from_snapshot_id).toBeUndefined();
  });

  it('rejects fork creation when requested snapshot is missing or belongs to another session', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    await repository.saveCodexSession({
      id: 'session-other',
      owner_type: 'plan_item_workflow',
      owner_id: 'workflow-1',
      status: 'idle',
      role: 'inactive_fork',
      runtime_profile_id: 'profile-1',
      runtime_profile_revision_id: 'profile-revision-1',
      credential_binding_id: 'credential-1',
      credential_binding_version_id: 'credential-version-1',
      lease_epoch: 0,
      created_by_actor_id: 'actor-tech',
      created_at: now,
      updated_at: now,
    });
    await repository.createCodexSessionSnapshot({
      ...snapshotInput,
      id: 'snapshot-other',
      codex_session_id: 'session-other',
      artifact_ref: 'artifact://snapshot-other',
      digest: 'sha256:snapshot-other',
    });

    await expectDomainErrorCode(
      () =>
        repository.createCodexSessionFork({
          id: 'session-fork-missing',
          workflow_id: 'workflow-1',
          parent_session_id: 'session-1',
          forked_from_snapshot_id: 'snapshot-missing',
          fork_reason: 'Missing checkpoint.',
          created_by_actor_id: 'actor-tech',
          now: '2026-05-31T00:04:00.000Z',
        }),
      'codex_session_fork_invalid',
    );
    await expectDomainErrorCode(
      () =>
        repository.createCodexSessionFork({
          id: 'session-fork-foreign',
          workflow_id: 'workflow-1',
          parent_session_id: 'session-1',
          forked_from_snapshot_id: 'snapshot-other',
          fork_reason: 'Foreign checkpoint.',
          created_by_actor_id: 'actor-tech',
          now: '2026-05-31T00:04:00.000Z',
        }),
      'codex_session_fork_invalid',
    );
  });

  it('selects candidate fork as active only when neither session is running or leased', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    await repository.createCodexSessionTurn(turnInput);
    await repository.createCodexSessionFork({
      id: 'session-fork',
      workflow_id: 'workflow-1',
      parent_session_id: 'session-1',
      forked_from_turn_id: 'turn-1',
      fork_reason: 'Try another approach.',
      created_by_actor_id: 'actor-tech',
      now,
    });

    const selected = await repository.selectActiveCodexSessionFork({
      workflow_id: 'workflow-1',
      selected_codex_session_id: 'session-fork',
      manual_decision_id: 'decision-fork',
      actor_id: 'actor-tech',
      reason: 'Use the alternate path.',
      now: '2026-05-31T00:03:00.000Z',
    });

    expect(selected.workflow.active_codex_session_id).toBe('session-fork');
    await expect(repository.getCodexSession('session-1')).resolves.toMatchObject({ role: 'inactive_fork' });
    await expect(repository.getWorkflowManualDecision('decision-fork')).resolves.toMatchObject({
      kind: 'fork_select',
      selected_codex_session_id: 'session-fork',
    });
  });

  it('rejects duplicate workflow manual decision ids without overwriting evidence', async () => {
    const repository = new InMemoryDeliveryRepository();
    const decision = {
      id: 'decision-1',
      workflow_id: 'workflow-1',
      codex_session_id: 'session-1',
      kind: 'start_brainstorming',
      reason: 'Start.',
      created_by_actor_id: 'actor-tech',
      created_at: now,
    } as const;

    await repository.saveWorkflowManualDecision(decision);

    await expectDomainErrorCode(
      () =>
        repository.saveWorkflowManualDecision({
          ...decision,
          kind: 'mark_ready',
          reason: 'Overwrite attempt.',
        }),
      'workflow_invalid_transition',
    );
    await expect(repository.getWorkflowManualDecision('decision-1')).resolves.toMatchObject({
      kind: 'start_brainstorming',
      reason: 'Start.',
    });
  });

  it('rejects fork selection with duplicate manual decision id without switching active session', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    await repository.createCodexSessionTurn(turnInput);
    await repository.createCodexSessionFork({
      id: 'session-fork',
      workflow_id: 'workflow-1',
      parent_session_id: 'session-1',
      forked_from_turn_id: 'turn-1',
      fork_reason: 'Try another approach.',
      created_by_actor_id: 'actor-tech',
      now,
    });
    await repository.saveWorkflowManualDecision({
      id: 'decision-duplicate',
      workflow_id: 'workflow-1',
      codex_session_id: 'session-1',
      kind: 'start_brainstorming',
      reason: 'Existing evidence.',
      created_by_actor_id: 'actor-tech',
      created_at: now,
    });

    await expectDomainErrorCode(
      () =>
        repository.selectActiveCodexSessionFork({
          workflow_id: 'workflow-1',
          selected_codex_session_id: 'session-fork',
          manual_decision_id: 'decision-duplicate',
          actor_id: 'actor-tech',
          reason: 'Use the alternate path.',
          now: '2026-05-31T00:03:00.000Z',
        }),
      'workflow_invalid_transition',
    );
    await expect(repository.getPlanItemWorkflow('workflow-1')).resolves.toMatchObject({ active_codex_session_id: 'session-1' });
    await expect(repository.getCodexSession('session-1')).resolves.toMatchObject({ role: 'active' });
    await expect(repository.getCodexSession('session-fork')).resolves.toMatchObject({ role: 'candidate_fork' });
    await expect(repository.getWorkflowManualDecision('decision-duplicate')).resolves.toMatchObject({
      kind: 'start_brainstorming',
      reason: 'Existing evidence.',
    });
  });

  it('rejects selecting the current active Codex session', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);

    await expectDomainErrorCode(
      () =>
        repository.selectActiveCodexSessionFork({
          workflow_id: 'workflow-1',
          selected_codex_session_id: 'session-1',
          manual_decision_id: 'decision-current',
          actor_id: 'actor-tech',
          reason: 'Keep current path.',
          now: '2026-05-31T00:03:00.000Z',
        }),
      'codex_session_fork_invalid',
    );
  });

  it('rejects selecting a non-candidate fork session', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    await repository.createCodexSessionTurn(turnInput);
    await repository.createCodexSessionFork({
      id: 'session-inactive-fork',
      workflow_id: 'workflow-1',
      parent_session_id: 'session-1',
      forked_from_turn_id: 'turn-1',
      fork_reason: 'Try another approach.',
      created_by_actor_id: 'actor-tech',
      now,
    });
    const inactiveFork = await repository.getCodexSession('session-inactive-fork');
    if (inactiveFork === undefined) throw new Error('Expected seeded fork');
    await repository.saveCodexSession({ ...inactiveFork, role: 'inactive_fork' });

    await expectDomainErrorCode(
      () =>
        repository.selectActiveCodexSessionFork({
          workflow_id: 'workflow-1',
          selected_codex_session_id: 'session-inactive-fork',
          manual_decision_id: 'decision-inactive-fork',
          actor_id: 'actor-tech',
          reason: 'Use an inactive fork.',
          now: '2026-05-31T00:03:00.000Z',
        }),
      'codex_session_fork_invalid',
    );
  });

  it('copies workflow session maps through transaction state', async () => {
    const repository = new InMemoryDeliveryRepository();

    await repository.withDeliveryTransaction(async (transaction) => {
      await transaction.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
      await transaction.createCodexSessionTurn(turnInput);
      await transaction.createCodexSessionSnapshot(snapshotInput);
      await transaction.claimCodexSessionLease(leaseInput);
      await transaction.saveStaleCodexSessionTerminalizationAttempt({
        id: 'stale-1',
        codex_session_id: 'session-1',
        codex_session_turn_id: 'turn-1',
        lease_id: 'lease-1',
        lease_epoch: 1,
        worker_id: 'worker-1',
        worker_session_digest: 'sha256:worker-session',
        failure_code: 'codex_session_lease_conflict',
        created_at: now,
      });
      await transaction.saveWorkflowManualDecision({
        id: 'decision-1',
        workflow_id: 'workflow-1',
        codex_session_id: 'session-1',
        kind: 'start_brainstorming',
        reason: 'Start.',
        created_by_actor_id: 'actor-tech',
        created_at: now,
      });
    });

    await expect(repository.getPlanItemWorkflow('workflow-1')).resolves.toMatchObject({ active_codex_session_id: 'session-1' });
    await expect(repository.getCodexSession('session-1')).resolves.toMatchObject({ active_lease_id: 'lease-1' });
    await expect(repository.getCodexSessionTurn('turn-1')).resolves.toMatchObject({ status: 'running' });
    await expect(repository.getCodexSessionSnapshot('snapshot-1')).resolves.toMatchObject({ digest: 'sha256:snapshot-1' });
    await expect(repository.renewCodexSessionLease({
      session_id: 'session-1',
      lease_id: 'lease-1',
      lease_token_hash: 'sha256:lease-token',
      worker_id: 'worker-1',
      worker_session_digest: 'sha256:worker-session',
      lease_epoch: 1,
      now: '2026-05-31T00:01:00.000Z',
      expires_at: '2026-05-31T00:10:00.000Z',
    })).resolves.toMatchObject({ id: 'lease-1' });
    await expect(repository.listStaleCodexSessionTerminalizationAttempts('session-1')).resolves.toHaveLength(1);
    await expect(repository.getWorkflowManualDecision('decision-1')).resolves.toMatchObject({ kind: 'start_brainstorming' });
  });

  it('scans boundary summary revisions by id and stores stale terminalization attempts', async () => {
    const repository = new InMemoryDeliveryRepository();
    const revision: BoundarySummaryRevision = {
      id: 'boundary-revision-1',
      boundary_summary_id: 'boundary-summary-1',
      development_plan_item_id: 'item-1',
      revision_number: 1,
      status: 'approved',
      summary: 'Approved boundary.',
      decisions: [],
      unresolved_questions: [],
      created_by_actor_id: 'actor-tech',
      created_at: now,
    };

    await repository.saveBoundarySummaryRevision(revision);
    await repository.saveStaleCodexSessionTerminalizationAttempt({
      id: 'stale-1',
      codex_session_id: 'session-1',
      codex_session_turn_id: 'turn-1',
      lease_id: 'lease-1',
      lease_epoch: 1,
      worker_id: 'worker-1',
      worker_session_digest: 'sha256:worker-session',
      failure_code: 'codex_session_lease_conflict',
      created_at: now,
    });

    await expect(repository.getBoundarySummaryRevisionById('boundary-revision-1')).resolves.toEqual(revision);
    await expect(repository.listStaleCodexSessionTerminalizationAttempts('session-1')).resolves.toHaveLength(1);
  });

  it('rejects duplicate stale terminalization attempt ids', async () => {
    const repository = new InMemoryDeliveryRepository();
    const attempt = {
      id: 'stale-1',
      codex_session_id: 'session-1',
      codex_session_turn_id: 'turn-1',
      lease_id: 'lease-1',
      lease_epoch: 1,
      worker_id: 'worker-1',
      worker_session_digest: 'sha256:worker-session',
      failure_code: 'codex_session_lease_conflict',
      created_at: now,
    } as const;

    await repository.saveStaleCodexSessionTerminalizationAttempt(attempt);

    await expectDomainErrorCode(
      () =>
        repository.saveStaleCodexSessionTerminalizationAttempt({
          ...attempt,
          codex_session_id: 'session-2',
        }),
      'workflow_invalid_transition',
    );
  });

  it('rejects duplicate execution readiness record ids without overwriting evidence', async () => {
    const repository = new InMemoryDeliveryRepository();
    const record = {
      id: 'readiness-1',
      workflow_id: 'workflow-1',
      codex_session_id: 'session-1',
      readiness_state: 'ready',
      blocker_codes: [],
      supporting_evidence: [{ type: 'commit', id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }],
      created_by_actor_id: 'actor-tech',
      created_at: now,
    } as const;

    await repository.saveExecutionReadinessRecord(record);

    await expectDomainErrorCode(
      () =>
        repository.saveExecutionReadinessRecord({
          ...record,
          readiness_state: 'blocked',
          blocker_codes: ['missing_tests'],
          supporting_evidence: [{ type: 'pull_request', id: '42' }],
        }),
      'workflow_invalid_transition',
    );
    await expect(repository.getExecutionReadinessRecord('readiness-1')).resolves.toMatchObject({
      readiness_state: 'ready',
      blocker_codes: [],
      supporting_evidence: [{ type: 'commit', id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }],
    });
  });

  it('resolves narrow repository evidence only for matching workflow project repos', async () => {
    const repository = new InMemoryDeliveryRepository();
    const developmentPlan: DevelopmentPlan = {
      id: 'plan-1',
      project_id: 'project-1',
      revision_id: 'plan-revision-1',
      title: 'Plan',
      status: 'active',
      source_refs: [{ type: 'requirement', id: 'requirement-1' }],
      items: [],
      created_at: now,
      updated_at: now,
    };
    await repository.saveDevelopmentPlan(developmentPlan);
    await repository.saveProjectRepo({
      id: 'repo-1',
      repo_id: 'repo-1',
      project_id: 'project-1',
      name: 'owner/repo',
      status: 'active',
      local_path: '/tmp/repo',
      default_branch: 'main',
      remote_url: 'https://github.com/owner/repo.git',
      base_commit_sha: 'a'.repeat(40),
      created_at: now,
      updated_at: now,
    });
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);

    await expect(
      repository.resolveWorkflowRepositoryEvidence({
        evidence_object_type: 'commit',
        evidence_object_id: 'ABCDEF1234567890ABCDEF1234567890ABCDEF12',
        workflow_id: 'workflow-1',
        development_plan_id: 'plan-1',
        development_plan_item_id: 'item-1',
      }),
    ).resolves.toEqual({ repository_id: 'repo-1', resolved_ref: 'abcdef1234567890abcdef1234567890abcdef12' });
    await expect(
      repository.resolveWorkflowRepositoryEvidence({
        evidence_object_type: 'pull_request',
        evidence_object_id: 'https://github.com/other/repo/pull/1',
        workflow_id: 'workflow-1',
        development_plan_id: 'plan-1',
        development_plan_item_id: 'item-1',
      }),
    ).resolves.toBeUndefined();
    await expect(
      repository.resolveWorkflowRepositoryEvidence({
        evidence_object_type: 'pull_request',
        evidence_object_id: 'please see owner/repo/pull/123',
        workflow_id: 'workflow-1',
        development_plan_id: 'plan-1',
        development_plan_item_id: 'item-1',
      }),
    ).resolves.toBeUndefined();
    await expect(
      repository.resolveWorkflowRepositoryEvidence({
        evidence_object_type: 'pull_request',
        evidence_object_id: 'https://github.com/owner/repo/pull/123',
        workflow_id: 'workflow-1',
        development_plan_id: 'plan-1',
        development_plan_item_id: 'item-1',
      }),
    ).resolves.toEqual({ repository_id: 'repo-1', resolved_ref: 'https://github.com/owner/repo/pull/123' });
  });
});
