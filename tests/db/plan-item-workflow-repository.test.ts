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

  it('rejects candidate fork lease and archived fork selection', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    await repository.createCodexSessionFork({
      id: 'session-fork',
      workflow_id: 'workflow-1',
      parent_session_id: 'session-1',
      forked_from_snapshot_id: 'snapshot-1',
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

  it('selects candidate fork as active only when neither session is running or leased', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    await repository.createCodexSessionFork({
      id: 'session-fork',
      workflow_id: 'workflow-1',
      parent_session_id: 'session-1',
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

  it('copies workflow session maps through transaction state', async () => {
    const repository = new InMemoryDeliveryRepository();

    await repository.withDeliveryTransaction(async (transaction) => {
      await transaction.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
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
  });
});
