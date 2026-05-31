import { describe, expect, it } from 'vitest';
import {
  DomainError,
  type BoundarySummaryRevision,
  type DevelopmentPlan,
  type ExecutionPlanRevision,
  type InternalArtifactObject,
  type PlanItemWorkflow,
  type PlanItemWorkflowTransition,
} from '@forgeloop/domain';

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

const transitionInput = {
  id: 'transition-1',
  workflow_id: 'workflow-1',
  from_status: 'not_started',
  to_status: 'brainstorming',
  actor_id: 'actor-tech',
  reason: 'Start brainstorming.',
  evidence_object_type: 'manual_decision',
  evidence_object_id: 'decision-1',
  codex_session_id: 'session-1',
  codex_session_turn_id: 'turn-1',
  created_at: now,
} as const;

const manualDecisionInput = {
  id: 'decision-1',
  workflow_id: 'workflow-1',
  codex_session_id: 'session-1',
  kind: 'start_brainstorming',
  reason: 'Start.',
  created_by_actor_id: 'actor-tech',
  created_at: now,
} as const;

const readinessRecordInput = {
  id: 'readiness-1',
  workflow_id: 'workflow-1',
  development_plan_id: 'plan-1',
  development_plan_item_id: 'item-1',
  codex_session_id: 'session-1',
  approved_boundary_summary_revision_id: 'boundary-summary-revision-1',
  approved_spec_revision_id: 'spec-revision-1',
  approved_implementation_plan_revision_id: 'implementation-plan-revision-1',
  readiness_state: 'ready',
  blocker_codes: [],
  supporting_evidence: [{ object_type: 'commit', object_id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }],
  created_by_actor_id: 'actor-tech',
  created_at: now,
} as const;

const executionPlanRevisionInput: ExecutionPlanRevision = {
  id: 'implementation-plan-revision-1',
  execution_plan_id: 'implementation-plan-1',
  development_plan_item_id: 'item-1',
  based_on_spec_revision_id: 'spec-revision-1',
  revision_number: 1,
  summary: 'Approved implementation plan.',
  content: 'Implementation plan content.',
  workflow_id: 'workflow-1',
  codex_session_id: 'session-1',
  codex_session_turn_id: 'turn-1',
  created_at: now,
};

const boundarySummaryRevisionInput: BoundarySummaryRevision = {
  id: 'boundary-summary-revision-1',
  boundary_summary_id: 'boundary-summary-1',
  development_plan_item_id: 'item-1',
  workflow_id: 'workflow-1',
  codex_session_id: 'session-1',
  codex_session_turn_id: 'turn-1',
  revision_number: 1,
  status: 'approved',
  summary: 'Approved boundary.',
  decisions: [],
  unresolved_questions: [],
  created_by_actor_id: 'actor-tech',
  created_at: now,
};

const specRevisionInput = {
  id: 'spec-revision-1',
  spec_id: 'spec-1',
  work_item_id: 'work-item-1',
  development_plan_item_id: 'item-1',
  workflow_id: 'workflow-1',
  codex_session_id: 'session-1',
  codex_session_turn_id: 'turn-1',
  revision_number: 1,
  summary: 'Approved spec.',
  content: 'Spec content.',
  background: 'Background.',
  goals: ['Goal.'],
  scope_in: ['In scope.'],
  scope_out: ['Out of scope.'],
  acceptance_criteria: ['Accepted.'],
  risk_notes: [],
  test_strategy_summary: 'Run focused tests.',
  created_at: now,
} as const;

const internalArtifactObjectInput: InternalArtifactObject = {
  id: 'internal-artifact-1',
  artifact_id: 'artifact-1',
  ref: 'artifact://internal/generated_payload/codex_session/session-1/artifact-1',
  storage_key: 'objects/sha256/aa/' + 'a'.repeat(64),
  kind: 'generated_payload',
  content_type: 'application/json',
  size_bytes: '12',
  digest: 'sha256:' + 'a'.repeat(64),
  visibility: 'internal',
  owner_type: 'codex_session',
  owner_id: 'session-1',
  idempotency_key: 'internal-artifact-1',
  request_digest: 'sha256:internal-artifact-request',
  metadata_json: {},
  created_by_actor_type: 'system',
  created_by_actor_id: 'actor-tech',
  created_at: now,
};

const seedWorkflowActiveApprovalFields = async (
  repository: InMemoryDeliveryRepository,
) => {
  await repository.saveBoundarySummaryRevision(boundarySummaryRevisionInput);
  await repository.saveSpecRevision(specRevisionInput);
  await repository.saveExecutionPlanRevision(executionPlanRevisionInput);
  await repository.saveWorkflowManualDecision(manualDecisionInput);
  await repository.applyPlanItemWorkflowTransition({
    transition: {
      ...transitionInput,
      id: 'transition-seed-start-brainstorming',
      from_status: 'not_started',
      to_status: 'brainstorming',
      evidence_object_type: 'manual_decision',
      evidence_object_id: 'decision-1',
      codex_session_turn_id: undefined,
    },
  });
  await repository.applyPlanItemWorkflowTransition({
    transition: {
      ...transitionInput,
      id: 'transition-seed-boundary-review',
      from_status: 'brainstorming',
      to_status: 'boundary_review',
      evidence_object_type: 'boundary_summary_revision',
      evidence_object_id: 'boundary-summary-revision-1',
      codex_session_turn_id: undefined,
    },
  });
  await repository.applyPlanItemWorkflowTransition({
    transition: {
      ...transitionInput,
      id: 'transition-seed-spec-queued',
      from_status: 'boundary_review',
      to_status: 'spec_generation_queued',
      evidence_object_type: 'boundary_summary_revision',
      evidence_object_id: 'boundary-summary-revision-1',
      codex_session_turn_id: undefined,
    },
    projection_patch: {
      active_boundary_summary_revision_id: 'boundary-summary-revision-1',
    },
  });
  await repository.applyPlanItemWorkflowTransition({
    transition: {
      ...transitionInput,
      id: 'transition-seed-spec-review',
      from_status: 'spec_generation_queued',
      to_status: 'spec_review',
      evidence_object_type: 'spec_revision',
      evidence_object_id: 'spec-revision-1',
      codex_session_turn_id: undefined,
    },
  });
  await repository.applyPlanItemWorkflowTransition({
    transition: {
      ...transitionInput,
      id: 'transition-seed-plan-queued',
      from_status: 'spec_review',
      to_status: 'implementation_plan_generation_queued',
      evidence_object_type: 'spec_revision',
      evidence_object_id: 'spec-revision-1',
      codex_session_turn_id: undefined,
    },
    projection_patch: {
      active_spec_doc_revision_id: 'spec-revision-1',
    },
  });
  await repository.applyPlanItemWorkflowTransition({
    transition: {
      ...transitionInput,
      id: 'transition-seed-plan-review',
      from_status: 'implementation_plan_generation_queued',
      to_status: 'implementation_plan_review',
      evidence_object_type: 'implementation_plan_revision',
      evidence_object_id: 'implementation-plan-revision-1',
      codex_session_turn_id: undefined,
    },
  });
};

const seedWorkflowRepositoryEvidence = async (repository: InMemoryDeliveryRepository) => {
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
};

const seedWorkflowWithSnapshot = async (repository: InMemoryDeliveryRepository) => {
  await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
  await repository.createCodexSessionTurn({
    ...turnInput,
    id: 'turn-seed',
    input_digest: 'sha256:turn-seed',
  });
  const claimed = await repository.claimCodexSessionLease({
    ...leaseInput,
    lease_id: 'lease-seed',
    lease_token_hash: 'sha256:lease-token-seed',
  });
  await repository.terminalizeCodexSessionTurn({
    session_id: 'session-1',
    turn_id: 'turn-seed',
    lease_id: claimed.lease.id,
    lease_token_hash: 'sha256:lease-token-seed',
    lease_epoch: 1,
    worker_id: 'worker-1',
    worker_session_digest: 'sha256:worker-session',
    status: 'succeeded',
    expected_previous_snapshot_digest: undefined,
    output_snapshot: {
      ...snapshotInput,
      created_from_turn_id: 'turn-seed',
    },
    now: '2026-05-31T00:02:00.000Z',
  });
};

const snapshotInput = {
  id: 'snapshot-1',
  codex_session_id: 'session-1',
  sequence: 1,
  artifact_ref: 'artifact://internal/codex_session_snapshot/codex_session/session-1/snapshot-1',
  digest: 'sha256:snapshot-1',
  size_bytes: '123',
  manifest_digest: 'sha256:manifest-1',
  runtime_profile_revision_id: 'profile-revision-1',
  created_from_turn_id: 'turn-1',
  created_by_actor_id: 'actor-tech',
  created_at: '2026-05-31T00:02:00.000Z',
} as const;

const terminalizeTurnWithSnapshot = async (
  repository: InMemoryDeliveryRepository,
  options: {
    turn_id?: string;
    turn_input_digest?: string;
    previous_snapshot_digest?: string;
    snapshot_id?: string;
    snapshot_sequence?: number;
    snapshot_digest?: string;
    manifest_digest?: string;
    lease_id?: string;
    lease_token_hash?: string;
    claim_now?: string;
    terminalize_now?: string;
    codex_thread_id?: string;
    codex_thread_id_digest?: string;
  } = {},
) => {
  const turnId = options.turn_id ?? 'turn-1';
  const snapshotId = options.snapshot_id ?? 'snapshot-1';
  const snapshotDigest = options.snapshot_digest ?? `sha256:${snapshotId}`;
  const claimNow = options.claim_now ?? '2026-05-31T00:01:00.000Z';
  const terminalizeNow = options.terminalize_now ?? '2026-05-31T00:02:00.000Z';
  await repository.createCodexSessionTurn({
    ...turnInput,
    id: turnId,
    input_digest: options.turn_input_digest ?? `sha256:${turnId}`,
    expected_previous_snapshot_digest: options.previous_snapshot_digest,
    created_at: claimNow,
    updated_at: claimNow,
  });
  const claimed = await repository.claimCodexSessionLease({
    ...leaseInput,
    lease_id: options.lease_id ?? `lease-${turnId}`,
    lease_token_hash: options.lease_token_hash ?? `sha256:lease-${turnId}`,
    expected_previous_snapshot_digest: options.previous_snapshot_digest,
    now: claimNow,
  });
  await repository.terminalizeCodexSessionTurn({
    session_id: 'session-1',
    turn_id: turnId,
    lease_id: claimed.lease.id,
    lease_token_hash: claimed.lease.lease_token_hash,
    lease_epoch: claimed.lease.lease_epoch,
    worker_id: 'worker-1',
    worker_session_digest: 'sha256:worker-session',
    status: 'succeeded',
    expected_previous_snapshot_digest: options.previous_snapshot_digest,
    output_snapshot: {
      ...snapshotInput,
      id: snapshotId,
      sequence: options.snapshot_sequence ?? 1,
      artifact_ref: `artifact://internal/codex_session_snapshot/codex_session/session-1/${snapshotId}`,
      digest: snapshotDigest,
      manifest_digest: options.manifest_digest ?? `sha256:manifest-${snapshotId}`,
      created_from_turn_id: turnId,
      created_at: terminalizeNow,
    },
    ...(options.codex_thread_id === undefined ? {} : { codex_thread_id: options.codex_thread_id }),
    ...(options.codex_thread_id_digest === undefined ? {} : { codex_thread_id_digest: options.codex_thread_id_digest }),
    now: terminalizeNow,
  });
};

const applyWorkflowProjectionTransition = async (
  repository: InMemoryDeliveryRepository,
  input: {
    transition_id: string;
    from_status: PlanItemWorkflow['status'];
    to_status: PlanItemWorkflow['status'];
    evidence_object_type: typeof transitionInput.evidence_object_type;
    evidence_object_id: string;
    projection_patch?: Parameters<InMemoryDeliveryRepository['applyPlanItemWorkflowTransition']>[0]['projection_patch'];
    supporting_evidence?: Parameters<InMemoryDeliveryRepository['applyPlanItemWorkflowTransition']>[0]['transition']['supporting_evidence'];
    actor_id?: string;
    codex_session_turn_id?: string;
  },
) =>
  repository.applyPlanItemWorkflowTransition({
    transition: {
      ...transitionInput,
      id: input.transition_id,
      from_status: input.from_status,
      to_status: input.to_status,
      actor_id: input.actor_id ?? 'actor-tech',
      evidence_object_type: input.evidence_object_type,
      evidence_object_id: input.evidence_object_id,
      codex_session_turn_id: input.codex_session_turn_id,
      ...(input.supporting_evidence === undefined ? {} : { supporting_evidence: input.supporting_evidence }),
    },
    projection_patch: input.projection_patch,
  });

const applyWorkflowTransition = async (
  repository: InMemoryDeliveryRepository,
  transition: PlanItemWorkflowTransition,
) => {
  await repository.applyPlanItemWorkflowTransition({ transition });
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

  it('rejects creating an initial session with an existing workflow id', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);

    await expectDomainErrorCode(
      () =>
        repository.createPlanItemWorkflowWithInitialSession({
          ...baseWorkflowInput,
          codex_session_id: 'session-2',
        }),
      'workflow_invalid_transition',
    );
    await expect(repository.getPlanItemWorkflow('workflow-1')).resolves.toMatchObject({
      development_plan_item_id: 'item-1',
      status: 'not_started',
    });
    await expect(repository.getCodexSession('session-2')).resolves.toBeUndefined();
  });

  it('rejects creating an initial session with an existing Codex session id', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);

    await expectDomainErrorCode(
      () =>
        repository.createPlanItemWorkflowWithInitialSession({
          ...baseWorkflowInput,
          id: 'workflow-2',
          development_plan_item_id: 'item-2',
        }),
      'workflow_invalid_transition',
    );
    await expect(repository.getPlanItemWorkflow('workflow-2')).resolves.toBeUndefined();
    await expect(repository.getCodexSession('session-1')).resolves.toMatchObject({
      owner_id: 'workflow-1',
      status: 'idle',
    });
  });

  it('rejects saving a missing Plan Item Workflow', async () => {
    const repository = new InMemoryDeliveryRepository();

    await expectDomainErrorCode(
      () =>
        repository.savePlanItemWorkflow({
          id: 'workflow-missing',
          development_plan_id: 'plan-1',
          development_plan_item_id: 'item-1',
          status: 'not_started',
          active_codex_session_id: 'session-1',
          created_by_actor_id: 'actor-tech',
          created_at: now,
          updated_at: now,
        }),
      'workflow_invalid_transition',
    );
    await expect(repository.getPlanItemWorkflow('workflow-missing')).resolves.toBeUndefined();
  });

  it('rejects saving a Plan Item Workflow with changed immutable identity fields', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    const workflow = await repository.getPlanItemWorkflow('workflow-1');
    if (workflow === undefined) throw new Error('Expected seeded workflow');

    await expectDomainErrorCode(
      () =>
        repository.savePlanItemWorkflow({
          ...workflow,
          development_plan_id: 'plan-drifted',
          development_plan_item_id: 'item-drifted',
          created_by_actor_id: 'actor-drifted',
          created_at: '2026-05-30T00:00:00.000Z',
          status: 'in_progress',
          active_codex_session_id: undefined,
          active_boundary_summary_revision_id: 'boundary-summary-revision-1',
          active_spec_doc_revision_id: 'spec-doc-revision-1',
          active_implementation_plan_doc_revision_id: 'implementation-plan-doc-revision-1',
          updated_at: '2026-05-31T00:01:00.000Z',
        }),
      'workflow_invalid_transition',
    );
    await expect(repository.getPlanItemWorkflow('workflow-1')).resolves.toMatchObject({
      development_plan_id: 'plan-1',
      development_plan_item_id: 'item-1',
      created_by_actor_id: 'actor-tech',
      created_at: now,
      status: 'not_started',
      active_codex_session_id: 'session-1',
    });
  });

  it('rejects saving a Plan Item Workflow with direct status changes and preserves the original row', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    const workflow = await repository.getPlanItemWorkflow('workflow-1');
    if (workflow === undefined) throw new Error('Expected seeded workflow');

    await expectDomainErrorCode(
      () =>
        repository.savePlanItemWorkflow({
          ...workflow,
          status: 'in_progress',
          updated_at: '2026-05-31T00:01:00.000Z',
        }),
      'workflow_invalid_transition',
    );

    await expect(repository.getPlanItemWorkflow('workflow-1')).resolves.toMatchObject({
      development_plan_id: 'plan-1',
      development_plan_item_id: 'item-1',
      created_by_actor_id: 'actor-tech',
      status: 'not_started',
      active_codex_session_id: 'session-1',
      updated_at: now,
    });
  });

  it('allows saving a Plan Item Workflow with only updated_at changed', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    const workflow = await repository.getPlanItemWorkflow('workflow-1');
    if (workflow === undefined) throw new Error('Expected seeded workflow');

    await repository.savePlanItemWorkflow({
      ...workflow,
      updated_at: '2026-05-31T00:01:00.000Z',
    });

    await expect(repository.getPlanItemWorkflow('workflow-1')).resolves.toMatchObject({
      development_plan_id: 'plan-1',
      development_plan_item_id: 'item-1',
      created_by_actor_id: 'actor-tech',
      status: 'not_started',
      active_codex_session_id: 'session-1',
      updated_at: '2026-05-31T00:01:00.000Z',
    });
  });

  it('rejects saving a Plan Item Workflow with direct active session changes and preserves the original row', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    await repository.createPlanItemWorkflowWithInitialSession({
      ...baseWorkflowInput,
      id: 'workflow-other',
      codex_session_id: 'session-other',
      development_plan_item_id: 'item-other',
    });
    const workflow = await repository.getPlanItemWorkflow('workflow-1');
    if (workflow === undefined) throw new Error('Expected seeded workflow');

    await expectDomainErrorCode(
      () =>
        repository.savePlanItemWorkflow({
          ...workflow,
          active_codex_session_id: 'session-missing',
          updated_at: '2026-05-31T00:01:00.000Z',
        }),
      'workflow_invalid_transition',
    );
    await expect(repository.getPlanItemWorkflow('workflow-1')).resolves.toEqual(workflow);

    await expectDomainErrorCode(
      () =>
        repository.savePlanItemWorkflow({
          ...workflow,
          active_codex_session_id: 'session-other',
          updated_at: '2026-05-31T00:02:00.000Z',
        }),
      'workflow_invalid_transition',
    );
    await expect(repository.getPlanItemWorkflow('workflow-1')).resolves.toEqual(workflow);
  });

  it('rejects saving a Plan Item Workflow with direct active evidence projection changes and preserves the original row', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    const workflow = await repository.getPlanItemWorkflow('workflow-1');
    if (workflow === undefined) throw new Error('Expected seeded workflow');

    await expectDomainErrorCode(
      () =>
        repository.savePlanItemWorkflow({
          ...workflow,
          active_boundary_summary_revision_id: 'boundary-summary-revision-1',
          active_spec_doc_revision_id: 'spec-doc-revision-1',
          active_implementation_plan_doc_revision_id: 'implementation-plan-doc-revision-1',
          execution_package_id: 'execution-package-1',
          previous_status: 'not_started',
          updated_at: '2026-05-31T00:01:00.000Z',
        }),
      'workflow_invalid_transition',
    );
    await expect(repository.getPlanItemWorkflow('workflow-1')).resolves.toEqual(workflow);
  });

  it('applies a workflow approval transition and service-owned projection patch atomically', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    await repository.createCodexSessionTurn(turnInput);
    await repository.saveWorkflowManualDecision(manualDecisionInput);
    await repository.saveBoundarySummaryRevision(boundarySummaryRevisionInput);

    await applyWorkflowProjectionTransition(repository, {
      transition_id: 'transition-start',
      from_status: 'not_started',
      to_status: 'brainstorming',
      evidence_object_type: 'manual_decision',
      evidence_object_id: 'decision-1',
    });

    await applyWorkflowProjectionTransition(repository, {
      transition_id: 'transition-boundary',
      from_status: 'brainstorming',
      to_status: 'boundary_review',
      evidence_object_type: 'boundary_summary_revision',
      evidence_object_id: 'boundary-summary-revision-1',
    });

    const submittedWorkflow = await repository.getPlanItemWorkflow('workflow-1');
    expect(submittedWorkflow).toMatchObject({
      status: 'boundary_review',
      updated_at: now,
    });
    expect(submittedWorkflow?.active_boundary_summary_revision_id).toBeUndefined();

    await applyWorkflowProjectionTransition(repository, {
      transition_id: 'transition-boundary-approval',
      from_status: 'boundary_review',
      to_status: 'spec_generation_queued',
      evidence_object_type: 'boundary_summary_revision',
      evidence_object_id: 'boundary-summary-revision-1',
      projection_patch: { active_boundary_summary_revision_id: 'boundary-summary-revision-1' },
    });

    await expect(repository.getPlanItemWorkflow('workflow-1')).resolves.toMatchObject({
      status: 'spec_generation_queued',
      active_boundary_summary_revision_id: 'boundary-summary-revision-1',
      updated_at: now,
    });
    expect((await repository.getPlanItemWorkflow('workflow-1'))?.previous_status).toBeUndefined();
    await expect(repository.listPlanItemWorkflowTransitions('workflow-1')).resolves.toHaveLength(3);
  });

  it('rejects submission transitions that try to set active document projection patches', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    await repository.createCodexSessionTurn(turnInput);
    await repository.saveWorkflowManualDecision(manualDecisionInput);
    await repository.saveBoundarySummaryRevision(boundarySummaryRevisionInput);
    await repository.saveSpecRevision(specRevisionInput);
    await repository.saveExecutionPlanRevision(executionPlanRevisionInput);

    await applyWorkflowProjectionTransition(repository, {
      transition_id: 'transition-start',
      from_status: 'not_started',
      to_status: 'brainstorming',
      evidence_object_type: 'manual_decision',
      evidence_object_id: 'decision-1',
    });

    await expectDomainErrorCode(
      () =>
        applyWorkflowProjectionTransition(repository, {
          transition_id: 'transition-boundary-submission-patch',
          from_status: 'brainstorming',
          to_status: 'boundary_review',
          evidence_object_type: 'boundary_summary_revision',
          evidence_object_id: 'boundary-summary-revision-1',
          projection_patch: { active_boundary_summary_revision_id: 'boundary-summary-revision-1' },
        }),
      'workflow_invalid_transition',
    );
    const rejectedBoundaryPatchWorkflow = await repository.getPlanItemWorkflow('workflow-1');
    expect(rejectedBoundaryPatchWorkflow).toMatchObject({
      status: 'brainstorming',
    });
    expect(rejectedBoundaryPatchWorkflow?.active_boundary_summary_revision_id).toBeUndefined();

    await applyWorkflowProjectionTransition(repository, {
      transition_id: 'transition-boundary-submission',
      from_status: 'brainstorming',
      to_status: 'boundary_review',
      evidence_object_type: 'boundary_summary_revision',
      evidence_object_id: 'boundary-summary-revision-1',
    });
    await applyWorkflowProjectionTransition(repository, {
      transition_id: 'transition-boundary-approval',
      from_status: 'boundary_review',
      to_status: 'spec_generation_queued',
      evidence_object_type: 'boundary_summary_revision',
      evidence_object_id: 'boundary-summary-revision-1',
      projection_patch: { active_boundary_summary_revision_id: 'boundary-summary-revision-1' },
    });

    await expectDomainErrorCode(
      () =>
        applyWorkflowProjectionTransition(repository, {
          transition_id: 'transition-spec-submission-patch',
          from_status: 'spec_generation_queued',
          to_status: 'spec_review',
          evidence_object_type: 'spec_revision',
          evidence_object_id: 'spec-revision-1',
          projection_patch: { active_spec_doc_revision_id: 'spec-revision-1' },
        }),
      'workflow_invalid_transition',
    );
    const rejectedSpecPatchWorkflow = await repository.getPlanItemWorkflow('workflow-1');
    expect(rejectedSpecPatchWorkflow).toMatchObject({
      status: 'spec_generation_queued',
    });
    expect(rejectedSpecPatchWorkflow?.active_spec_doc_revision_id).toBeUndefined();

    await applyWorkflowProjectionTransition(repository, {
      transition_id: 'transition-spec-submission',
      from_status: 'spec_generation_queued',
      to_status: 'spec_review',
      evidence_object_type: 'spec_revision',
      evidence_object_id: 'spec-revision-1',
    });
    await applyWorkflowProjectionTransition(repository, {
      transition_id: 'transition-spec-approval',
      from_status: 'spec_review',
      to_status: 'implementation_plan_generation_queued',
      evidence_object_type: 'spec_revision',
      evidence_object_id: 'spec-revision-1',
      projection_patch: { active_spec_doc_revision_id: 'spec-revision-1' },
    });

    await expectDomainErrorCode(
      () =>
        applyWorkflowProjectionTransition(repository, {
          transition_id: 'transition-plan-submission-patch',
          from_status: 'implementation_plan_generation_queued',
          to_status: 'implementation_plan_review',
          evidence_object_type: 'implementation_plan_revision',
          evidence_object_id: 'implementation-plan-revision-1',
          projection_patch: { active_implementation_plan_doc_revision_id: 'implementation-plan-revision-1' },
        }),
      'workflow_invalid_transition',
    );
    const rejectedPlanPatchWorkflow = await repository.getPlanItemWorkflow('workflow-1');
    expect(rejectedPlanPatchWorkflow).toMatchObject({
      status: 'implementation_plan_generation_queued',
    });
    expect(rejectedPlanPatchWorkflow?.active_implementation_plan_doc_revision_id).toBeUndefined();
  });

  it('applies execution readiness transition and active implementation plan projection atomically', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession({
      ...baseWorkflowInput,
      actor_id: 'actor-product',
    });
    await seedWorkflowActiveApprovalFields(repository);
    await repository.saveExecutionReadinessRecord({
      ...readinessRecordInput,
      supporting_evidence: [{ object_type: 'implementation_plan_revision', object_id: 'implementation-plan-revision-1' }],
    });

    await applyWorkflowProjectionTransition(repository, {
      transition_id: 'transition-readiness-with-active-plan',
      from_status: 'implementation_plan_review',
      to_status: 'execution_ready',
      actor_id: 'actor-product',
      evidence_object_type: 'execution_readiness_record',
      evidence_object_id: 'readiness-1',
      supporting_evidence: [{ object_type: 'implementation_plan_revision', object_id: 'implementation-plan-revision-1' }],
      projection_patch: { active_implementation_plan_doc_revision_id: 'implementation-plan-revision-1' },
    });

    await expect(repository.getPlanItemWorkflow('workflow-1')).resolves.toMatchObject({
      status: 'execution_ready',
      active_implementation_plan_doc_revision_id: 'implementation-plan-revision-1',
      updated_at: now,
    });
  });

  it('rejects direct execution readiness transitions without the active implementation plan projection patch', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession({
      ...baseWorkflowInput,
      actor_id: 'actor-product',
    });
    await seedWorkflowActiveApprovalFields(repository);
    await repository.saveExecutionReadinessRecord({
      ...readinessRecordInput,
      supporting_evidence: [{ object_type: 'implementation_plan_revision', object_id: 'implementation-plan-revision-1' }],
    });

    await expectDomainErrorCode(
      () =>
        applyWorkflowTransition(repository, {
          ...transitionInput,
          id: 'transition-readiness-without-active-plan-patch',
          from_status: 'implementation_plan_review',
          to_status: 'execution_ready',
          actor_id: 'actor-product',
          reason: 'Mark ready.',
          evidence_object_type: 'execution_readiness_record',
          evidence_object_id: 'readiness-1',
          supporting_evidence: [{ object_type: 'implementation_plan_revision', object_id: 'implementation-plan-revision-1' }],
          codex_session_turn_id: undefined,
        }),
      'workflow_invalid_transition',
    );
    const workflow = await repository.getPlanItemWorkflow('workflow-1');
    expect(workflow).toMatchObject({
      status: 'implementation_plan_review',
    });
    expect(workflow?.active_implementation_plan_doc_revision_id).toBeUndefined();
  });

  it('rejects duplicate atomic workflow transition ids without updating workflow projections', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    await repository.createCodexSessionTurn(turnInput);
    await repository.saveWorkflowManualDecision(manualDecisionInput);
    await applyWorkflowTransition(repository, transitionInput);
    await repository.saveBoundarySummaryRevision(boundarySummaryRevisionInput);
    const workflow = await repository.getPlanItemWorkflow('workflow-1');
    if (workflow === undefined) throw new Error('Expected seeded workflow');

    await expectDomainErrorCode(
      () =>
        applyWorkflowProjectionTransition(repository, {
          transition_id: 'transition-1',
          from_status: 'boundary_review',
          to_status: 'spec_generation_queued',
          evidence_object_type: 'boundary_summary_revision',
          evidence_object_id: 'boundary-summary-revision-1',
          projection_patch: { active_boundary_summary_revision_id: 'boundary-summary-revision-1' },
        }),
      'workflow_invalid_transition',
    );

    await expect(repository.getPlanItemWorkflow('workflow-1')).resolves.toEqual(workflow);
    await expect(repository.listPlanItemWorkflowTransitions('workflow-1')).resolves.toEqual([transitionInput]);
  });

  it('rejects saving a missing Codex Session', async () => {
    const repository = new InMemoryDeliveryRepository();

    await expectDomainErrorCode(
      () =>
        repository.saveCodexSession({
          id: 'session-missing',
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
        }),
      'workflow_invalid_transition',
    );
    await expect(repository.getCodexSession('session-missing')).resolves.toBeUndefined();
  });

  it('rejects saving a Codex Session with changed immutable ownership fields', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    const session = await repository.getCodexSession('session-1');
    if (session === undefined) throw new Error('Expected seeded Codex session');

    await expectDomainErrorCode(
      () =>
        repository.saveCodexSession({
          ...session,
          owner_id: 'workflow-drifted',
          runtime_profile_id: 'profile-drifted',
          runtime_profile_revision_id: 'profile-revision-drifted',
          credential_binding_id: 'credential-drifted',
          credential_binding_version_id: 'credential-version-drifted',
          created_by_actor_id: 'actor-drifted',
          created_at: '2026-05-30T00:00:00.000Z',
          status: 'running',
          role: 'inactive_fork',
          active_lease_id: 'lease-1',
          latest_snapshot_id: 'snapshot-1',
          latest_snapshot_digest: 'sha256:snapshot-1',
          latest_turn_id: 'turn-1',
          latest_turn_digest: 'sha256:turn-1',
          codex_thread_id: 'thread-1',
          codex_thread_id_digest: 'sha256:thread-1',
          lease_epoch: 1,
          archived_at: '2026-05-31T00:01:00.000Z',
          updated_at: '2026-05-31T00:01:00.000Z',
        }),
      'workflow_invalid_transition',
    );
    await expect(repository.getCodexSession('session-1')).resolves.toMatchObject({
      owner_id: 'workflow-1',
      runtime_profile_id: 'profile-1',
      runtime_profile_revision_id: 'profile-revision-1',
      credential_binding_id: 'credential-1',
      credential_binding_version_id: 'credential-version-1',
      created_by_actor_id: 'actor-tech',
      created_at: now,
      status: 'idle',
      role: 'active',
      lease_epoch: 0,
    });
  });

  it('rejects saving a Codex Session with changed latest, thread, or lease fields and preserves the original session', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    await repository.createCodexSessionTurn(turnInput);
    const claimed = await repository.claimCodexSessionLease(leaseInput);
    await repository.terminalizeCodexSessionTurn({
      session_id: 'session-1',
      turn_id: 'turn-1',
      lease_id: claimed.lease.id,
      lease_token_hash: 'sha256:lease-token',
      lease_epoch: 1,
      worker_id: 'worker-1',
      worker_session_digest: 'sha256:worker-session',
      status: 'succeeded',
      expected_previous_snapshot_digest: undefined,
      output_snapshot: snapshotInput,
      codex_thread_id: 'thread-1',
      codex_thread_id_digest: 'sha256:thread-1',
      now: '2026-05-31T00:02:00.000Z',
    });
    const session = await repository.getCodexSession('session-1');
    if (session === undefined) throw new Error('Expected terminalized Codex session');

    await expectDomainErrorCode(
      () =>
        repository.saveCodexSession({
          ...session,
          latest_snapshot_id: 'snapshot-drifted',
          latest_snapshot_digest: 'sha256:snapshot-drifted',
          latest_turn_id: 'turn-drifted',
          latest_turn_digest: 'sha256:turn-drifted',
          codex_thread_id: 'thread-drifted',
          codex_thread_id_digest: 'sha256:thread-drifted',
          active_lease_id: 'lease-drifted',
          lease_epoch: 99,
          status: 'archived',
          role: 'inactive_fork',
          archived_at: '2026-05-31T00:03:00.000Z',
          updated_at: '2026-05-31T00:03:00.000Z',
        }),
      'workflow_invalid_transition',
    );

    await expect(repository.getCodexSession('session-1')).resolves.toEqual(session);
  });

  it('rejects saving a Codex Session with direct archived_at changes and preserves audit-owned state', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    const session = await repository.getCodexSession('session-1');
    if (session === undefined) throw new Error('Expected seeded Codex session');

    await expectDomainErrorCode(
      () =>
        repository.saveCodexSession({
          ...session,
          archived_at: '2026-05-31T00:04:00.000Z',
          updated_at: '2026-05-31T00:04:00.000Z',
        }),
      'workflow_invalid_transition',
    );

    const savedSession = await repository.getCodexSession('session-1');
    expect(savedSession?.archived_at).toBe(session.archived_at);
    expect(savedSession).toMatchObject({
      status: 'idle',
      role: 'active',
      updated_at: now,
    });
  });

  it('rejects saving a Codex Session with a role change on an existing active session and preserves active ownership', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    const session = await repository.getCodexSession('session-1');
    if (session === undefined) throw new Error('Expected seeded Codex session');

    await expectDomainErrorCode(
      () =>
        repository.saveCodexSession({
          ...session,
          role: 'inactive_fork',
          updated_at: '2026-05-31T00:01:00.000Z',
        }),
      'workflow_invalid_transition',
    );

    await expect(repository.getCodexSession('session-1')).resolves.toMatchObject({
      owner_id: 'workflow-1',
      runtime_profile_id: 'profile-1',
      runtime_profile_revision_id: 'profile-revision-1',
      credential_binding_id: 'credential-1',
      credential_binding_version_id: 'credential-version-1',
      created_by_actor_id: 'actor-tech',
      status: 'idle',
      role: 'active',
      lease_epoch: 0,
      updated_at: now,
    });
    await expect(repository.getPlanItemWorkflow('workflow-1')).resolves.toMatchObject({
      active_codex_session_id: 'session-1',
    });
  });

  it('rejects saving a candidate fork as active and preserves original role and active ownership', async () => {
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

    await expectDomainErrorCode(
      () =>
        repository.saveCodexSession({
          ...fork,
          role: 'active',
          updated_at: '2026-05-31T00:01:00.000Z',
        }),
      'workflow_invalid_transition',
    );

    await expect(repository.getCodexSession('session-fork')).resolves.toMatchObject({
      role: 'candidate_fork',
      updated_at: now,
    });
    await expect(repository.getPlanItemWorkflow('workflow-1')).resolves.toMatchObject({
      active_codex_session_id: 'session-1',
    });
  });

  it('rejects saving a Codex Session with direct status changes and preserves the active lease state', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    await repository.createCodexSessionTurn(turnInput);
    await repository.claimCodexSessionLease(leaseInput);
    const runningSession = await repository.getCodexSession('session-1');
    if (runningSession === undefined) throw new Error('Expected running Codex session');

    await expectDomainErrorCode(
      () =>
        repository.saveCodexSession({
          ...runningSession,
          status: 'idle',
          updated_at: '2026-05-31T00:01:00.000Z',
        }),
      'workflow_invalid_transition',
    );
    await expect(repository.getCodexSession('session-1')).resolves.toEqual(runningSession);
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
      lease_epoch: 2,
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
      now: '2026-05-31T00:00:00.500Z',
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
      lease_epoch: 2,
      now: '2026-05-31T00:00:00.500Z',
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

  it('rejects lease claim when owner workflow no longer points at the previous active session', async () => {
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
    await repository.selectActiveCodexSessionFork({
      workflow_id: 'workflow-1',
      selected_codex_session_id: 'session-fork',
      manual_decision_id: 'decision-fork-before-lease',
      transition_id: 'transition-fork-before-lease',
      actor_id: 'actor-tech',
      reason: 'Use the alternate path.',
      now: '2026-05-31T00:03:00.000Z',
    });

    await expectDomainErrorCode(() => repository.claimCodexSessionLease(leaseInput), 'codex_session_lease_conflict');
  });

  it('rejects lease claim for inactive role or candidate fork sessions', async () => {
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
          ...leaseInput,
          session_id: 'session-fork',
          lease_id: 'lease-candidate',
        }),
      'codex_session_lease_conflict',
    );
    await repository.selectActiveCodexSessionFork({
      workflow_id: 'workflow-1',
      selected_codex_session_id: 'session-fork',
      manual_decision_id: 'decision-fork-before-lease-role-check',
      transition_id: 'transition-fork-before-lease-role-check',
      actor_id: 'actor-tech',
      reason: 'Use the alternate path.',
      now: '2026-05-31T00:03:00.000Z',
    });
    await expectDomainErrorCode(() => repository.claimCodexSessionLease(leaseInput), 'codex_session_lease_conflict');
  });

  it('rejects direct workflow active session mutation before lease claim', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    const workflow = await repository.getPlanItemWorkflow('workflow-1');
    if (workflow === undefined) throw new Error('Expected seeded workflow');

    await expectDomainErrorCode(
      () => repository.savePlanItemWorkflow({ ...workflow, active_codex_session_id: 'session-other' }),
      'workflow_invalid_transition',
    );
    await expect(repository.getPlanItemWorkflow('workflow-1')).resolves.toEqual(workflow);
  });

  it('rejects lease claim for blocked session status', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    await repository.createCodexSessionTurn(turnInput);
    const claimed = await repository.claimCodexSessionLease(leaseInput);
    await repository.terminalizeCodexSessionTurn({
      session_id: 'session-1',
      turn_id: 'turn-1',
      lease_id: claimed.lease.id,
      lease_token_hash: 'sha256:lease-token',
      lease_epoch: 1,
      worker_id: 'worker-1',
      worker_session_digest: 'sha256:worker-session',
      status: 'failed',
      expected_previous_snapshot_digest: undefined,
      now: '2026-05-31T00:02:00.000Z',
    });

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

  it.each([
    { label: 'terminal status', serviceOwnedFields: { status: 'succeeded' } },
    { label: 'output snapshot id', serviceOwnedFields: { output_snapshot_id: 'snapshot-1' } },
    { label: 'output snapshot digest', serviceOwnedFields: { output_snapshot_digest: 'sha256:snapshot-1' } },
    { label: 'output object type', serviceOwnedFields: { output_object_type: 'artifact' } },
    { label: 'output object id', serviceOwnedFields: { output_object_id: 'artifact-1' } },
    { label: 'thread digest', serviceOwnedFields: { codex_thread_id_digest: 'sha256:thread-1' } },
    { label: 'lease id', serviceOwnedFields: { lease_id: 'lease-1' } },
    { label: 'lease epoch', serviceOwnedFields: { lease_epoch: 1 } },
    { label: 'automation action run id', serviceOwnedFields: { automation_action_run_id: 'action-run-1' } },
    { label: 'runtime job id', serviceOwnedFields: { runtime_job_id: 'runtime-job-1' } },
  ])('rejects creating a turn with caller-supplied $label', async ({ serviceOwnedFields }) => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);

    await expectDomainErrorCode(
      () =>
        repository.createCodexSessionTurn({
          ...turnInput,
          ...serviceOwnedFields,
        }),
      'workflow_invalid_transition',
    );
    await expect(repository.getCodexSessionTurn('turn-1')).resolves.toBeUndefined();
  });

  it('rejects saving a Codex session turn that does not already exist', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);

    await expectDomainErrorCode(() => repository.saveCodexSessionTurn(turnInput), 'workflow_invalid_transition');
    await expect(repository.getCodexSessionTurn('turn-1')).resolves.toBeUndefined();
  });

  it('rejects saving a Codex session turn with changed immutable ownership fields', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    await repository.createCodexSessionTurn(turnInput);

    await expectDomainErrorCode(
      () =>
        repository.saveCodexSessionTurn({
          ...turnInput,
          codex_session_id: 'session-other',
          workflow_id: 'workflow-other',
          created_by_actor_id: 'actor-other',
          created_at: '2026-05-31T00:01:00.000Z',
          status: 'succeeded',
          output_snapshot_id: 'snapshot-1',
          output_snapshot_digest: 'sha256:snapshot-1',
          updated_at: '2026-05-31T00:02:00.000Z',
        }),
      'workflow_invalid_transition',
    );
    await expect(repository.getCodexSessionTurn('turn-1')).resolves.toMatchObject({
      codex_session_id: 'session-1',
      workflow_id: 'workflow-1',
      created_by_actor_id: 'actor-tech',
      created_at: now,
      status: 'running',
    });
  });

  it('rejects saving a Codex session turn with changed output, lease, or provenance fields without mutating the original turn', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    await repository.createCodexSessionTurn(turnInput);
    const claimed = await repository.claimCodexSessionLease(leaseInput);
    await repository.terminalizeCodexSessionTurn({
      session_id: 'session-1',
      turn_id: 'turn-1',
      lease_id: claimed.lease.id,
      lease_token_hash: 'sha256:lease-token',
      lease_epoch: 1,
      worker_id: 'worker-1',
      worker_session_digest: 'sha256:worker-session',
      status: 'succeeded',
      expected_previous_snapshot_digest: undefined,
      output_snapshot: snapshotInput,
      now: '2026-05-31T00:02:00.000Z',
    });
    const originalTurn = await repository.getCodexSessionTurn('turn-1');
    if (originalTurn === undefined) throw new Error('Expected terminalized turn');

    await expectDomainErrorCode(
      () =>
        repository.saveCodexSessionTurn({
          ...originalTurn,
          intent: 'address_review_feedback',
          input_digest: 'sha256:drifted-input',
          expected_previous_snapshot_digest: 'sha256:drifted-previous',
          output_snapshot_id: 'snapshot-drifted',
          output_snapshot_digest: 'sha256:snapshot-drifted',
          lease_id: 'lease-drifted',
          lease_epoch: 99,
          created_at: '2026-05-31T00:01:00.000Z',
          created_by_actor_id: 'actor-drifted',
          status: 'failed',
          output_object_type: 'internal_artifact',
          output_object_id: 'snapshot-drifted',
          codex_thread_id_digest: 'sha256:thread-drifted',
          automation_action_run_id: 'automation-run-1',
          runtime_job_id: 'runtime-job-1',
          updated_at: '2026-05-31T00:03:00.000Z',
        }),
      'workflow_invalid_transition',
    );

    await expect(repository.getCodexSessionTurn('turn-1')).resolves.toEqual(originalTurn);
  });

  it('rejects saving a Codex session turn with changed output object refs or service provenance and preserves the original turn', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    await repository.createCodexSessionTurn(turnInput);
    const originalTurn = await repository.getCodexSessionTurn('turn-1');
    if (originalTurn === undefined) throw new Error('Expected seeded turn');

    await expectDomainErrorCode(
      () =>
        repository.saveCodexSessionTurn({
          ...originalTurn,
          output_object_type: 'internal_artifact',
          output_object_id: 'artifact-1',
          codex_thread_id_digest: 'sha256:thread-1',
          automation_action_run_id: 'automation-run-1',
          runtime_job_id: 'runtime-job-1',
          updated_at: '2026-05-31T00:01:00.000Z',
        }),
      'workflow_invalid_transition',
    );

    await expect(repository.getCodexSessionTurn('turn-1')).resolves.toEqual(originalTurn);
  });

  it('rejects saving a Codex session turn with direct status changes and preserves the original turn', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    await repository.createCodexSessionTurn(turnInput);
    const originalTurn = await repository.getCodexSessionTurn('turn-1');
    if (originalTurn === undefined) throw new Error('Expected seeded turn');

    await expectDomainErrorCode(
      () =>
        repository.saveCodexSessionTurn({
          ...originalTurn,
          status: 'succeeded',
          updated_at: '2026-05-31T00:01:00.000Z',
        }),
      'workflow_invalid_transition',
    );
    await expectDomainErrorCode(
      () =>
        repository.saveCodexSessionTurn({
          ...originalTurn,
          status: 'stale',
          updated_at: '2026-05-31T00:02:00.000Z',
        }),
      'workflow_invalid_transition',
    );
    await expect(repository.getCodexSessionTurn('turn-1')).resolves.toEqual(originalTurn);
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

  it('rejects creating a turn for an inactive previous session because turns require the selected active fork', async () => {
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
    await repository.selectActiveCodexSessionFork({
      workflow_id: 'workflow-1',
      selected_codex_session_id: 'session-fork',
      manual_decision_id: 'decision-fork-before-inactive-turn-check',
      transition_id: 'transition-fork-before-inactive-turn-check',
      actor_id: 'actor-tech',
      reason: 'Use the alternate path.',
      now: '2026-05-31T00:03:00.000Z',
    });

    await expectDomainErrorCode(
      () =>
        repository.createCodexSessionTurn({
          ...turnInput,
          id: 'turn-previous-active',
          input_digest: 'sha256:turn-previous-active',
        }),
      'workflow_active_session_missing',
    );
  });

  it('rejects creating a turn for a blocked session because turns are created before lease claim sets running', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    await repository.createCodexSessionTurn(turnInput);
    const claimed = await repository.claimCodexSessionLease(leaseInput);
    await repository.terminalizeCodexSessionTurn({
      session_id: 'session-1',
      turn_id: 'turn-1',
      lease_id: claimed.lease.id,
      lease_token_hash: 'sha256:lease-token',
      lease_epoch: 1,
      worker_id: 'worker-1',
      worker_session_digest: 'sha256:worker-session',
      status: 'failed',
      expected_previous_snapshot_digest: undefined,
      now: '2026-05-31T00:02:00.000Z',
    });

    await expectDomainErrorCode(
      () =>
        repository.createCodexSessionTurn({
          ...turnInput,
          id: 'turn-blocked',
          input_digest: 'sha256:turn-blocked',
        }),
      'workflow_active_session_missing',
    );
  });

  it('rejects creating a turn for the previous active session after fork selection', async () => {
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
    await repository.selectActiveCodexSessionFork({
      workflow_id: 'workflow-1',
      selected_codex_session_id: 'session-fork',
      manual_decision_id: 'decision-fork-before-turn',
      transition_id: 'transition-fork-before-turn',
      actor_id: 'actor-tech',
      reason: 'Use the alternate path.',
      now: '2026-05-31T00:03:00.000Z',
    });

    await expectDomainErrorCode(
      () =>
        repository.createCodexSessionTurn({
          ...turnInput,
          id: 'turn-previous-active',
          input_digest: 'sha256:turn-previous-active',
        }),
      'workflow_active_session_missing',
    );
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

  it('rejects terminalization with only a Codex thread id before mutation', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    await repository.createCodexSessionTurn(turnInput);
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
          output_snapshot: { ...snapshotInput },
          codex_thread_id: 'thread-1',
          now: '2026-05-31T00:02:00.000Z',
        }),
      'codex_session_stale_terminalization',
    );

    await expect(repository.getCodexSession('session-1')).resolves.toMatchObject({
      status: 'running',
      active_lease_id: claimed.lease.id,
    });
    const session = await repository.getCodexSession('session-1');
    expect(session?.codex_thread_id).toBeUndefined();
    expect(session?.codex_thread_id_digest).toBeUndefined();
    await expect(repository.getCodexSessionTurn('turn-1')).resolves.toMatchObject({ status: 'running' });
    await expect(repository.getCodexSessionSnapshot('snapshot-1')).resolves.toBeUndefined();
  });

  it('rejects terminalization with only a Codex thread digest before mutation', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    await repository.createCodexSessionTurn(turnInput);
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
          output_snapshot: { ...snapshotInput },
          codex_thread_id_digest: 'sha256:thread-1',
          now: '2026-05-31T00:02:00.000Z',
        }),
      'codex_session_stale_terminalization',
    );

    await expect(repository.getCodexSession('session-1')).resolves.toMatchObject({
      status: 'running',
      active_lease_id: claimed.lease.id,
    });
    const session = await repository.getCodexSession('session-1');
    expect(session?.codex_thread_id).toBeUndefined();
    expect(session?.codex_thread_id_digest).toBeUndefined();
    await expect(repository.getCodexSessionTurn('turn-1')).resolves.toMatchObject({ status: 'running' });
    await expect(repository.getCodexSessionSnapshot('snapshot-1')).resolves.toBeUndefined();
  });

  it('allows first terminalization to bind a Codex thread id and digest', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    await repository.createCodexSessionTurn(turnInput);
    const claimed = await repository.claimCodexSessionLease(leaseInput);

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
      codex_thread_id: 'thread-1',
      codex_thread_id_digest: 'sha256:thread-1',
      now: '2026-05-31T00:02:00.000Z',
    });

    expect(terminalized.session).toMatchObject({
      codex_thread_id: 'thread-1',
      codex_thread_id_digest: 'sha256:thread-1',
    });
    expect(terminalized.turn).toMatchObject({ codex_thread_id_digest: 'sha256:thread-1' });
  });

  it('rejects later terminalization with a different Codex thread binding before mutation', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    await repository.createCodexSessionTurn(turnInput);
    const claimed = await repository.claimCodexSessionLease(leaseInput);
    await repository.terminalizeCodexSessionTurn({
      session_id: 'session-1',
      turn_id: 'turn-1',
      lease_id: claimed.lease.id,
      lease_token_hash: 'sha256:lease-token',
      lease_epoch: 1,
      worker_id: 'worker-1',
      worker_session_digest: 'sha256:worker-session',
      status: 'succeeded',
      expected_previous_snapshot_digest: undefined,
      codex_thread_id: 'thread-1',
      codex_thread_id_digest: 'sha256:thread-1',
      now: '2026-05-31T00:02:00.000Z',
    });
    await repository.createCodexSessionTurn({
      ...turnInput,
      id: 'turn-2',
      input_digest: 'sha256:turn-2',
      created_at: '2026-05-31T00:03:00.000Z',
      updated_at: '2026-05-31T00:03:00.000Z',
    });
    const secondClaim = await repository.claimCodexSessionLease({
      ...leaseInput,
      lease_id: 'lease-2',
      lease_token_hash: 'sha256:lease-token-2',
      expected_previous_snapshot_digest: undefined,
      now: '2026-05-31T00:04:00.000Z',
      expires_at: '2026-05-31T00:09:00.000Z',
    });

    await expectDomainErrorCode(
      () =>
        repository.terminalizeCodexSessionTurn({
          session_id: 'session-1',
          turn_id: 'turn-2',
          lease_id: secondClaim.lease.id,
          lease_token_hash: 'sha256:lease-token-2',
          lease_epoch: 2,
          worker_id: 'worker-1',
          worker_session_digest: 'sha256:worker-session',
          status: 'succeeded',
          expected_previous_snapshot_digest: undefined,
          output_snapshot: {
            ...snapshotInput,
            id: 'snapshot-2',
            sequence: 2,
            artifact_ref: 'artifact://internal/codex_session_snapshot/codex_session/session-1/snapshot-2',
            digest: 'sha256:snapshot-2',
            manifest_digest: 'sha256:manifest-2',
            created_from_turn_id: 'turn-2',
          },
          codex_thread_id: 'thread-2',
          codex_thread_id_digest: 'sha256:thread-2',
          now: '2026-05-31T00:05:00.000Z',
        }),
      'codex_session_stale_terminalization',
    );

    await expect(repository.getCodexSession('session-1')).resolves.toMatchObject({
      status: 'running',
      active_lease_id: 'lease-2',
      lease_epoch: 2,
      codex_thread_id: 'thread-1',
      codex_thread_id_digest: 'sha256:thread-1',
    });
    await expect(repository.getCodexSessionTurn('turn-2')).resolves.toMatchObject({ status: 'running' });
    await expect(repository.getCodexSessionSnapshot('snapshot-2')).resolves.toBeUndefined();
    await expect(repository.renewCodexSessionLease({
      session_id: 'session-1',
      lease_id: 'lease-2',
      lease_token_hash: 'sha256:lease-token-2',
      worker_id: 'worker-1',
      worker_session_digest: 'sha256:worker-session',
      lease_epoch: 2,
      now: '2026-05-31T00:05:30.000Z',
      expires_at: '2026-05-31T00:10:00.000Z',
    })).resolves.toMatchObject({ id: 'lease-2', status: 'active' });
  });

  it('preserves an existing Codex thread binding when later terminalization omits both fields', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    await repository.createCodexSessionTurn(turnInput);
    const claimed = await repository.claimCodexSessionLease(leaseInput);
    await repository.terminalizeCodexSessionTurn({
      session_id: 'session-1',
      turn_id: 'turn-1',
      lease_id: claimed.lease.id,
      lease_token_hash: 'sha256:lease-token',
      lease_epoch: 1,
      worker_id: 'worker-1',
      worker_session_digest: 'sha256:worker-session',
      status: 'succeeded',
      expected_previous_snapshot_digest: undefined,
      codex_thread_id: 'thread-1',
      codex_thread_id_digest: 'sha256:thread-1',
      now: '2026-05-31T00:02:00.000Z',
    });
    await repository.createCodexSessionTurn({
      ...turnInput,
      id: 'turn-2',
      input_digest: 'sha256:turn-2',
      created_at: '2026-05-31T00:03:00.000Z',
      updated_at: '2026-05-31T00:03:00.000Z',
    });
    const secondClaim = await repository.claimCodexSessionLease({
      ...leaseInput,
      lease_id: 'lease-2',
      lease_token_hash: 'sha256:lease-token-2',
      expected_previous_snapshot_digest: undefined,
      now: '2026-05-31T00:04:00.000Z',
      expires_at: '2026-05-31T00:09:00.000Z',
    });

    const terminalized = await repository.terminalizeCodexSessionTurn({
      session_id: 'session-1',
      turn_id: 'turn-2',
      lease_id: secondClaim.lease.id,
      lease_token_hash: 'sha256:lease-token-2',
      lease_epoch: 2,
      worker_id: 'worker-1',
      worker_session_digest: 'sha256:worker-session',
      status: 'succeeded',
      expected_previous_snapshot_digest: undefined,
      now: '2026-05-31T00:05:00.000Z',
    });

    expect(terminalized.session).toMatchObject({
      codex_thread_id: 'thread-1',
      codex_thread_id_digest: 'sha256:thread-1',
    });
  });

  it('allows later terminalization with the same Codex thread id and digest', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    await repository.createCodexSessionTurn(turnInput);
    const claimed = await repository.claimCodexSessionLease(leaseInput);
    await repository.terminalizeCodexSessionTurn({
      session_id: 'session-1',
      turn_id: 'turn-1',
      lease_id: claimed.lease.id,
      lease_token_hash: 'sha256:lease-token',
      lease_epoch: 1,
      worker_id: 'worker-1',
      worker_session_digest: 'sha256:worker-session',
      status: 'succeeded',
      expected_previous_snapshot_digest: undefined,
      codex_thread_id: 'thread-1',
      codex_thread_id_digest: 'sha256:thread-1',
      now: '2026-05-31T00:02:00.000Z',
    });
    await repository.createCodexSessionTurn({
      ...turnInput,
      id: 'turn-2',
      input_digest: 'sha256:turn-2',
      created_at: '2026-05-31T00:03:00.000Z',
      updated_at: '2026-05-31T00:03:00.000Z',
    });
    const secondClaim = await repository.claimCodexSessionLease({
      ...leaseInput,
      lease_id: 'lease-2',
      lease_token_hash: 'sha256:lease-token-2',
      expected_previous_snapshot_digest: undefined,
      now: '2026-05-31T00:04:00.000Z',
      expires_at: '2026-05-31T00:09:00.000Z',
    });

    const terminalized = await repository.terminalizeCodexSessionTurn({
      session_id: 'session-1',
      turn_id: 'turn-2',
      lease_id: secondClaim.lease.id,
      lease_token_hash: 'sha256:lease-token-2',
      lease_epoch: 2,
      worker_id: 'worker-1',
      worker_session_digest: 'sha256:worker-session',
      status: 'succeeded',
      expected_previous_snapshot_digest: undefined,
      codex_thread_id: 'thread-1',
      codex_thread_id_digest: 'sha256:thread-1',
      now: '2026-05-31T00:05:00.000Z',
    });

    expect(terminalized.session).toMatchObject({
      status: 'idle',
      codex_thread_id: 'thread-1',
      codex_thread_id_digest: 'sha256:thread-1',
    });
    expect(terminalized.turn).toMatchObject({ codex_thread_id_digest: 'sha256:thread-1' });
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
            artifact_ref: 'artifact://internal/codex_session_snapshot/codex_session/session-1/snapshot-drifted',
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
      artifact_ref: 'artifact://internal/codex_session_snapshot/codex_session/session-1/snapshot-1',
      digest: 'sha256:snapshot-1',
    });
  });

  it('rejects terminalization when output snapshot provenance points at a different turn', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    await repository.createCodexSessionTurn(turnInput);
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
            ...snapshotInput,
            id: 'snapshot-2',
            sequence: 2,
            artifact_ref: 'artifact://internal/codex_session_snapshot/codex_session/session-1/snapshot-2',
            digest: 'sha256:snapshot-2',
            manifest_digest: 'sha256:manifest-2',
            created_from_turn_id: 'turn-2',
          },
          now: '2026-05-31T00:03:00.000Z',
        }),
      'codex_session_snapshot_stale',
    );

    await expect(repository.getCodexSession('session-1')).resolves.toMatchObject({
      status: 'running',
      active_lease_id: claimed.lease.id,
    });
    await expect(repository.getCodexSessionTurn('turn-1')).resolves.toMatchObject({ status: 'running' });
    await expect(repository.getCodexSessionSnapshot('snapshot-2')).resolves.toBeUndefined();
  });

  it('rejects snapshots with non-internal artifact refs before saving them', async () => {
    const repository = new InMemoryDeliveryRepository();

    await expectDomainErrorCode(
      () =>
        repository.createCodexSessionSnapshot({
          ...snapshotInput,
          artifact_ref: 'artifact://snapshot-unsafe',
        }),
      'workflow_invalid_transition',
    );
    await expect(repository.getCodexSessionSnapshot('snapshot-1')).resolves.toBeUndefined();
  });

  it.each([
    {
      label: 'wrong kind',
      artifact_ref: 'artifact://internal/execution_summary/codex_session/session-1/snapshot-1',
    },
    {
      label: 'wrong owner_type',
      artifact_ref: 'artifact://internal/codex_session_snapshot/run_session/session-1/snapshot-1',
    },
    {
      label: 'wrong owner_id',
      artifact_ref: 'artifact://internal/codex_session_snapshot/codex_session/session-other/snapshot-1',
    },
    {
      label: 'wrong artifact_id',
      artifact_ref: 'artifact://internal/codex_session_snapshot/codex_session/session-1/snapshot-other',
    },
  ])('rejects snapshots with $label in artifact refs before saving them', async ({ artifact_ref }) => {
    const repository = new InMemoryDeliveryRepository();

    await expectDomainErrorCode(
      () =>
        repository.createCodexSessionSnapshot({
          ...snapshotInput,
          artifact_ref,
        }),
      'workflow_invalid_transition',
    );
    await expect(repository.getCodexSessionSnapshot('snapshot-1')).resolves.toBeUndefined();
  });

  it('rejects creating a snapshot for a missing Codex session before saving it', async () => {
    const repository = new InMemoryDeliveryRepository();

    await expectDomainErrorCode(
      () =>
        repository.createCodexSessionSnapshot({
          ...snapshotInput,
          codex_session_id: 'session-missing',
          artifact_ref: 'artifact://internal/codex_session_snapshot/codex_session/session-missing/snapshot-1',
        }),
      'workflow_invalid_transition',
    );
    await expect(repository.getCodexSessionSnapshot('snapshot-1')).resolves.toBeUndefined();
  });

  it('rejects creating a snapshot when created_from_turn_id is missing or belongs to another session before saving it', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    await repository.createPlanItemWorkflowWithInitialSession({
      ...baseWorkflowInput,
      id: 'workflow-other',
      codex_session_id: 'session-other',
      development_plan_item_id: 'item-other',
    });
    await repository.createCodexSessionTurn({
      ...turnInput,
      id: 'turn-other',
      codex_session_id: 'session-other',
      workflow_id: 'workflow-other',
      input_digest: 'sha256:turn-other',
    });

    const { created_from_turn_id: _createdFromTurnId, ...snapshotWithoutTurnProvenance } = snapshotInput;
    await expectDomainErrorCode(
      () => repository.createCodexSessionSnapshot(snapshotWithoutTurnProvenance),
      'codex_session_snapshot_stale',
    );
    await expect(repository.getCodexSessionSnapshot('snapshot-1')).resolves.toBeUndefined();

    await expectDomainErrorCode(
      () =>
        repository.createCodexSessionSnapshot({
          ...snapshotInput,
          created_from_turn_id: 'turn-missing',
        }),
      'codex_session_snapshot_stale',
    );
    await expect(repository.getCodexSessionSnapshot('snapshot-1')).resolves.toBeUndefined();

    await expectDomainErrorCode(
      () =>
        repository.createCodexSessionSnapshot({
          ...snapshotInput,
          id: 'snapshot-2',
          artifact_ref: 'artifact://internal/codex_session_snapshot/codex_session/session-1/snapshot-2',
          digest: 'sha256:snapshot-2',
          manifest_digest: 'sha256:manifest-2',
          created_from_turn_id: 'turn-other',
        }),
      'codex_session_snapshot_stale',
    );
    await expect(repository.getCodexSessionSnapshot('snapshot-2')).resolves.toBeUndefined();
  });

  it('rejects snapshots whose sequence is not greater than the current session maximum', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    await repository.createCodexSessionTurn(turnInput);
    await repository.createCodexSessionSnapshot({
      ...snapshotInput,
      id: 'snapshot-2',
      sequence: 2,
      artifact_ref: 'artifact://internal/codex_session_snapshot/codex_session/session-1/snapshot-2',
      digest: 'sha256:snapshot-2',
      manifest_digest: 'sha256:manifest-2',
    });

    await expectDomainErrorCode(
      () =>
        repository.createCodexSessionSnapshot({
          ...snapshotInput,
          id: 'snapshot-1',
          sequence: 1,
          artifact_ref: 'artifact://internal/codex_session_snapshot/codex_session/session-1/snapshot-1',
          digest: 'sha256:snapshot-1',
          manifest_digest: 'sha256:manifest-1',
        }),
      'workflow_invalid_transition',
    );

    await expect(repository.getCodexSessionSnapshot('snapshot-2')).resolves.toMatchObject({
      sequence: 2,
      digest: 'sha256:snapshot-2',
    });
    await expect(repository.getCodexSessionSnapshot('snapshot-1')).resolves.toBeUndefined();
    const session = await repository.getCodexSession('session-1');
    expect(session?.latest_snapshot_id).toBeUndefined();
    expect(session?.latest_snapshot_digest).toBeUndefined();
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
            artifact_ref: 'artifact://internal/codex_session_snapshot/codex_session/session-1/snapshot-2',
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
    await terminalizeTurnWithSnapshot(repository, { turn_id: 'turn-1', snapshot_id: 'snapshot-1' });
    await terminalizeTurnWithSnapshot(repository, {
      turn_id: 'turn-2',
      snapshot_id: 'snapshot-2',
      snapshot_sequence: 2,
      previous_snapshot_digest: 'sha256:snapshot-1',
      claim_now: '2026-05-31T00:03:00.000Z',
      terminalize_now: '2026-05-31T00:04:00.000Z',
    });

    const fork = await repository.createCodexSessionFork({
      id: 'session-fork',
      workflow_id: 'workflow-1',
      parent_session_id: 'session-1',
      forked_from_snapshot_id: 'snapshot-1',
      fork_reason: 'Try the older checkpoint.',
      created_by_actor_id: 'actor-tech',
      now: '2026-05-31T00:05:00.000Z',
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
    await terminalizeTurnWithSnapshot(repository, {
      turn_id: 'turn-1',
      snapshot_id: 'snapshot-1',
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
    await terminalizeTurnWithSnapshot(repository, { turn_id: 'turn-1', snapshot_id: 'snapshot-1' });
    await terminalizeTurnWithSnapshot(repository, {
      turn_id: 'turn-2',
      snapshot_id: 'snapshot-2',
      snapshot_sequence: 2,
      previous_snapshot_digest: 'sha256:snapshot-1',
      claim_now: '2026-05-31T00:03:00.000Z',
      terminalize_now: '2026-05-31T00:04:00.000Z',
    });

    const fork = await repository.createCodexSessionFork({
      id: 'session-fork',
      workflow_id: 'workflow-1',
      parent_session_id: 'session-1',
      forked_from_turn_id: 'turn-1',
      fork_reason: 'Try the first turn output.',
      created_by_actor_id: 'actor-tech',
      now: '2026-05-31T00:05:00.000Z',
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

    await expectDomainErrorCode(
      () =>
        repository.saveCodexSessionTurn({
          ...turnInput,
          status: 'succeeded',
          output_snapshot_id: 'snapshot-missing',
          output_snapshot_digest: 'sha256:snapshot-missing',
          updated_at: '2026-05-31T00:02:00.000Z',
        }),
      'workflow_invalid_transition',
    );
  });

  it('rejects turn-based fork when the turn output snapshot belongs to another session', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    await repository.createPlanItemWorkflowWithInitialSession({
      ...baseWorkflowInput,
      id: 'workflow-other',
      codex_session_id: 'session-other',
      development_plan_item_id: 'item-other',
    });
    await repository.createCodexSessionTurn(turnInput);
    await repository.createCodexSessionTurn({
      ...turnInput,
      id: 'turn-other',
      codex_session_id: 'session-other',
      workflow_id: 'workflow-other',
      input_digest: 'sha256:turn-other',
    });
    await repository.createCodexSessionSnapshot({
      ...snapshotInput,
      id: 'snapshot-other',
      codex_session_id: 'session-other',
      artifact_ref: 'artifact://internal/codex_session_snapshot/codex_session/session-other/snapshot-other',
      digest: 'sha256:snapshot-other',
      created_from_turn_id: 'turn-other',
    });

    await expectDomainErrorCode(
      () =>
        repository.saveCodexSessionTurn({
          ...turnInput,
          status: 'succeeded',
          output_snapshot_id: 'snapshot-other',
          output_snapshot_digest: 'sha256:snapshot-other',
          updated_at: '2026-05-31T00:02:00.000Z',
        }),
      'workflow_invalid_transition',
    );
  });

  it('rejects turn-based fork when the turn output snapshot digest differs from persisted snapshot', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    await terminalizeTurnWithSnapshot(repository, { turn_id: 'turn-1', snapshot_id: 'snapshot-1' });

    const terminalizedTurn = await repository.getCodexSessionTurn('turn-1');
    if (terminalizedTurn === undefined) throw new Error('Expected terminalized turn');
    await expectDomainErrorCode(
      () =>
        repository.saveCodexSessionTurn({
          ...terminalizedTurn,
          output_snapshot_digest: 'sha256:stale-snapshot-1',
        }),
      'workflow_invalid_transition',
    );
  });

  it('rejects turn-based fork when the persisted output snapshot came from a different turn', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    await repository.createCodexSessionTurn(turnInput);

    await expectDomainErrorCode(
      () =>
        repository.createCodexSessionSnapshot({
          ...snapshotInput,
          created_from_turn_id: 'turn-other',
        }),
      'codex_session_snapshot_stale',
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
    await terminalizeTurnWithSnapshot(repository, { turn_id: 'turn-1', snapshot_id: 'snapshot-1' });
    await terminalizeTurnWithSnapshot(repository, {
      turn_id: 'turn-2',
      snapshot_id: 'snapshot-2',
      snapshot_sequence: 2,
      previous_snapshot_digest: 'sha256:snapshot-1',
      claim_now: '2026-05-31T00:03:00.000Z',
      terminalize_now: '2026-05-31T00:04:00.000Z',
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
          now: '2026-05-31T00:05:00.000Z',
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
    await repository.createPlanItemWorkflowWithInitialSession({
      ...baseWorkflowInput,
      id: 'workflow-other',
      codex_session_id: 'session-other',
      development_plan_item_id: 'item-other',
    });
    await repository.createCodexSessionTurn({
      ...turnInput,
      id: 'turn-other',
      codex_session_id: 'session-other',
      workflow_id: 'workflow-other',
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

  it('rejects saving a fork when immutable provenance fields change', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    await terminalizeTurnWithSnapshot(repository, { turn_id: 'turn-1', snapshot_id: 'snapshot-1' });
    const fork = await repository.createCodexSessionFork({
      id: 'session-fork',
      workflow_id: 'workflow-1',
      parent_session_id: 'session-1',
      forked_from_turn_id: 'turn-1',
      forked_from_snapshot_id: 'snapshot-1',
      fork_reason: 'Try another approach.',
      created_by_actor_id: 'actor-tech',
      now: '2026-05-31T00:04:00.000Z',
    });

    const provenanceDrifts = [
      { forked_from_session_id: 'session-drifted' },
      { forked_from_turn_id: 'turn-drifted' },
      { forked_from_snapshot_id: 'snapshot-drifted' },
      { fork_reason: 'Rewrite the fork reason.' },
    ];

    for (const drift of provenanceDrifts) {
      await expectDomainErrorCode(
        () =>
          repository.saveCodexSession({
            ...fork,
            ...drift,
            updated_at: '2026-05-31T00:05:00.000Z',
          }),
        'workflow_invalid_transition',
      );
    }

    await repository.saveCodexSession({
      ...fork,
      updated_at: '2026-05-31T00:05:00.000Z',
    });
    await expect(repository.getCodexSession('session-fork')).resolves.toMatchObject({
      role: 'candidate_fork',
      status: 'idle',
      forked_from_session_id: 'session-1',
      forked_from_turn_id: 'turn-1',
      forked_from_snapshot_id: 'snapshot-1',
      fork_reason: 'Try another approach.',
      updated_at: '2026-05-31T00:05:00.000Z',
    });
  });

  it('rejects fork creation when requested snapshot is missing or belongs to another session', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    await repository.createPlanItemWorkflowWithInitialSession({
      ...baseWorkflowInput,
      id: 'workflow-other',
      codex_session_id: 'session-other',
      development_plan_item_id: 'item-other',
    });
    await repository.createCodexSessionTurn({
      ...turnInput,
      id: 'turn-other',
      codex_session_id: 'session-other',
      workflow_id: 'workflow-other',
      input_digest: 'sha256:turn-other',
    });
    await repository.createCodexSessionSnapshot({
      ...snapshotInput,
      id: 'snapshot-other',
      codex_session_id: 'session-other',
      artifact_ref: 'artifact://internal/codex_session_snapshot/codex_session/session-other/snapshot-other',
      digest: 'sha256:snapshot-other',
      created_from_turn_id: 'turn-other',
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
      transition_id: 'transition-fork',
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
    await expect(repository.listPlanItemWorkflowTransitions('workflow-1')).resolves.toEqual([
      {
        id: 'transition-fork',
        workflow_id: 'workflow-1',
        from_status: 'not_started',
        to_status: 'not_started',
        actor_id: 'actor-tech',
        reason: 'Use the alternate path.',
        evidence_object_type: 'manual_decision',
        evidence_object_id: 'decision-fork',
        codex_session_id: 'session-1',
        created_at: '2026-05-31T00:03:00.000Z',
      },
    ]);
  });

  it('rejects fork selection with duplicate transition id without switching active session', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    await repository.createCodexSessionTurn(turnInput);
    await repository.saveWorkflowManualDecision(manualDecisionInput);
    await applyWorkflowTransition(repository, transitionInput);
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
        repository.selectActiveCodexSessionFork({
          workflow_id: 'workflow-1',
          selected_codex_session_id: 'session-fork',
          manual_decision_id: 'decision-fork',
          transition_id: 'transition-1',
          actor_id: 'actor-tech',
          reason: 'Use the alternate path.',
          now: '2026-05-31T00:03:00.000Z',
        }),
      'workflow_invalid_transition',
    );
    await expect(repository.getPlanItemWorkflow('workflow-1')).resolves.toMatchObject({ active_codex_session_id: 'session-1' });
    await expect(repository.getCodexSession('session-1')).resolves.toMatchObject({ role: 'active' });
    await expect(repository.getCodexSession('session-fork')).resolves.toMatchObject({ role: 'candidate_fork' });
    await expect(repository.getWorkflowManualDecision('decision-fork')).resolves.toBeUndefined();
    await expect(repository.listPlanItemWorkflowTransitions('workflow-1')).resolves.toEqual([transitionInput]);
  });

  it('stores a workflow transition only when workflow, session, and turn provenance match', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    await repository.createCodexSessionTurn(turnInput);
    await repository.saveWorkflowManualDecision(manualDecisionInput);

    await applyWorkflowTransition(repository, transitionInput);

    await expect(repository.listPlanItemWorkflowTransitions('workflow-1')).resolves.toEqual([transitionInput]);
  });

  it('rejects workflow transitions with missing workflow, missing session, or foreign session provenance', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    await repository.createPlanItemWorkflowWithInitialSession({
      ...baseWorkflowInput,
      id: 'workflow-other',
      codex_session_id: 'session-other',
      development_plan_item_id: 'item-other',
    });
    await repository.saveWorkflowManualDecision(manualDecisionInput);

    await expectDomainErrorCode(
      () =>
        applyWorkflowTransition(repository, {
          ...transitionInput,
          id: 'transition-missing-workflow',
          workflow_id: 'workflow-missing',
        }),
      'workflow_invalid_transition',
    );
    await expectDomainErrorCode(
      () =>
        applyWorkflowTransition(repository, {
          ...transitionInput,
          id: 'transition-missing-session',
          codex_session_id: 'session-missing',
        }),
      'workflow_invalid_transition',
    );
    await expectDomainErrorCode(
      () =>
        applyWorkflowTransition(repository, {
          ...transitionInput,
          id: 'transition-foreign-session',
          codex_session_id: 'session-other',
        }),
      'workflow_invalid_transition',
    );
    await expect(repository.listPlanItemWorkflowTransitions('workflow-1')).resolves.toHaveLength(0);
  });

  it('rejects workflow transitions with missing or foreign turn provenance', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    await repository.createPlanItemWorkflowWithInitialSession({
      ...baseWorkflowInput,
      id: 'workflow-other',
      codex_session_id: 'session-other',
      development_plan_item_id: 'item-other',
    });
    await repository.createCodexSessionTurn(turnInput);
    await repository.createCodexSessionTurn({
      ...turnInput,
      id: 'turn-other',
      codex_session_id: 'session-other',
      workflow_id: 'workflow-other',
      input_digest: 'sha256:turn-other',
    });
    await repository.saveWorkflowManualDecision(manualDecisionInput);

    await expectDomainErrorCode(
      () =>
        applyWorkflowTransition(repository, {
          ...transitionInput,
          id: 'transition-missing-turn',
          codex_session_turn_id: 'turn-missing',
        }),
      'workflow_invalid_transition',
    );
    await expectDomainErrorCode(
      () =>
        applyWorkflowTransition(repository, {
          ...transitionInput,
          id: 'transition-foreign-turn',
          codex_session_turn_id: 'turn-other',
        }),
      'workflow_invalid_transition',
    );
    await expect(repository.listPlanItemWorkflowTransitions('workflow-1')).resolves.toHaveLength(0);
  });

  it('rejects workflow transitions with evidence object types outside the contract', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    await repository.createCodexSessionTurn(turnInput);

    await expectDomainErrorCode(
      () =>
        applyWorkflowTransition(repository, {
          ...transitionInput,
          evidence_object_type: 'codex_session_turn',
          evidence_object_id: 'turn-1',
        }),
      'workflow_invalid_transition',
    );
    await expect(repository.listPlanItemWorkflowTransitions('workflow-1')).resolves.toHaveLength(0);
  });

  it('rejects workflow transitions when the evidence type is illegal for the requested status change', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);

    await expectDomainErrorCode(
      () =>
        applyWorkflowTransition(repository, {
          ...transitionInput,
          id: 'transition-wrong-evidence-type',
          from_status: 'implementation_plan_review',
          to_status: 'execution_ready',
          evidence_object_type: 'commit',
          evidence_object_id: 'a'.repeat(40),
          codex_session_turn_id: undefined,
        }),
      'workflow_invalid_transition',
    );
    await expect(repository.listPlanItemWorkflowTransitions('workflow-1')).resolves.toHaveLength(0);
  });

  it('rejects workflow transitions that fail full contract validation', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    await repository.saveWorkflowManualDecision(manualDecisionInput);

    await expectDomainErrorCode(
      () =>
        applyWorkflowTransition(repository, {
          ...transitionInput,
          actor_id: '',
        }),
      'workflow_invalid_transition',
    );
    await expectDomainErrorCode(
      () =>
        applyWorkflowTransition(repository, {
          ...transitionInput,
          supporting_evidence: [{ object_type: 'codex_session_turn', object_id: 'turn-1' }],
        }),
      'workflow_invalid_transition',
    );
    await expect(repository.listPlanItemWorkflowTransitions('workflow-1')).resolves.toHaveLength(0);
  });

  it('rejects manual decision transitions with missing, foreign, or mismatched decision evidence', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    await repository.createPlanItemWorkflowWithInitialSession({
      ...baseWorkflowInput,
      id: 'workflow-other',
      codex_session_id: 'session-other',
      development_plan_item_id: 'item-other',
    });
    await repository.saveWorkflowManualDecision(manualDecisionInput);
    await repository.saveWorkflowManualDecision({
      ...manualDecisionInput,
      id: 'decision-foreign-workflow',
      workflow_id: 'workflow-other',
      codex_session_id: 'session-other',
    });
    await repository.saveWorkflowManualDecision({
      ...manualDecisionInput,
      id: 'decision-foreign-workflow-session',
      workflow_id: 'workflow-other',
      codex_session_id: 'session-other',
    });
    await repository.saveWorkflowManualDecision({
      ...manualDecisionInput,
      id: 'decision-wrong-actor',
      created_by_actor_id: 'actor-other',
    });

    await expectDomainErrorCode(
      () =>
        applyWorkflowTransition(repository, {
          ...transitionInput,
          id: 'transition-missing-decision',
          evidence_object_id: 'decision-missing',
        }),
      'workflow_invalid_transition',
    );
    await expectDomainErrorCode(
      () =>
        applyWorkflowTransition(repository, {
          ...transitionInput,
          id: 'transition-foreign-workflow-decision',
          evidence_object_id: 'decision-foreign-workflow',
        }),
      'workflow_invalid_transition',
    );
    await expectDomainErrorCode(
      () =>
        applyWorkflowTransition(repository, {
          ...transitionInput,
          id: 'transition-foreign-workflow-session-decision',
          evidence_object_id: 'decision-foreign-workflow-session',
        }),
      'workflow_invalid_transition',
    );
    await expectDomainErrorCode(
      () =>
        applyWorkflowTransition(repository, {
          ...transitionInput,
          id: 'transition-wrong-actor-decision',
          evidence_object_id: 'decision-wrong-actor',
        }),
      'workflow_invalid_transition',
    );
    await expect(repository.listPlanItemWorkflowTransitions('workflow-1')).resolves.toHaveLength(0);
  });

  it('rejects document gate evidence without matching workflow session provenance', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    await repository.createCodexSessionTurn(turnInput);
    await repository.saveBoundarySummaryRevision({
      ...boundarySummaryRevisionInput,
      id: 'boundary-missing-session',
      boundary_summary_id: 'boundary-summary-missing-session',
      codex_session_id: undefined,
    });
    await repository.saveBoundarySummaryRevision({
      ...boundarySummaryRevisionInput,
      id: 'boundary-foreign-session',
      boundary_summary_id: 'boundary-summary-foreign-session',
      codex_session_id: 'session-foreign',
    });
    await repository.saveSpecRevision({
      ...specRevisionInput,
      id: 'spec-missing-session',
      codex_session_id: undefined,
    });
    await repository.saveSpecRevision({
      ...specRevisionInput,
      id: 'spec-foreign-session',
      codex_session_id: 'session-foreign',
    });
    await repository.saveExecutionPlanRevision({
      ...executionPlanRevisionInput,
      id: 'implementation-plan-missing-session',
      execution_plan_id: 'implementation-plan-missing-session',
      codex_session_id: undefined,
    });
    await repository.saveExecutionPlanRevision({
      ...executionPlanRevisionInput,
      id: 'implementation-plan-foreign-session',
      execution_plan_id: 'implementation-plan-foreign-session',
      codex_session_id: 'session-foreign',
    });

    await expectDomainErrorCode(
      () =>
        applyWorkflowTransition(repository, {
          ...transitionInput,
          id: 'transition-boundary-missing-session',
          from_status: 'brainstorming',
          to_status: 'boundary_review',
          evidence_object_type: 'boundary_summary_revision',
          evidence_object_id: 'boundary-missing-session',
        }),
      'workflow_invalid_transition',
    );
    await expectDomainErrorCode(
      () =>
        applyWorkflowTransition(repository, {
          ...transitionInput,
          id: 'transition-boundary-foreign-session',
          from_status: 'brainstorming',
          to_status: 'boundary_review',
          evidence_object_type: 'boundary_summary_revision',
          evidence_object_id: 'boundary-foreign-session',
        }),
      'workflow_invalid_transition',
    );
    await expectDomainErrorCode(
      () =>
        applyWorkflowTransition(repository, {
          ...transitionInput,
          id: 'transition-spec-missing-session',
          from_status: 'spec_generation_queued',
          to_status: 'spec_review',
          evidence_object_type: 'spec_revision',
          evidence_object_id: 'spec-missing-session',
        }),
      'workflow_invalid_transition',
    );
    await expectDomainErrorCode(
      () =>
        applyWorkflowTransition(repository, {
          ...transitionInput,
          id: 'transition-spec-foreign-session',
          from_status: 'spec_generation_queued',
          to_status: 'spec_review',
          evidence_object_type: 'spec_revision',
          evidence_object_id: 'spec-foreign-session',
        }),
      'workflow_invalid_transition',
    );
    await expectDomainErrorCode(
      () =>
        applyWorkflowTransition(repository, {
          ...transitionInput,
          id: 'transition-plan-missing-session',
          from_status: 'implementation_plan_generation_queued',
          to_status: 'implementation_plan_review',
          evidence_object_type: 'implementation_plan_revision',
          evidence_object_id: 'implementation-plan-missing-session',
        }),
      'workflow_invalid_transition',
    );
    await expectDomainErrorCode(
      () =>
        applyWorkflowTransition(repository, {
          ...transitionInput,
          id: 'transition-plan-foreign-session',
          from_status: 'implementation_plan_generation_queued',
          to_status: 'implementation_plan_review',
          evidence_object_type: 'implementation_plan_revision',
          evidence_object_id: 'implementation-plan-foreign-session',
        }),
      'workflow_invalid_transition',
    );
    await expect(repository.listPlanItemWorkflowTransitions('workflow-1')).resolves.toHaveLength(0);
  });

  it('rejects document gate evidence without matching development plan item provenance', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    await repository.createCodexSessionTurn(turnInput);
    await repository.saveBoundarySummaryRevision({
      ...boundarySummaryRevisionInput,
      id: 'boundary-foreign-item',
      boundary_summary_id: 'boundary-summary-foreign-item',
      development_plan_item_id: 'item-foreign',
    });
    await repository.saveSpecRevision({
      ...specRevisionInput,
      id: 'spec-foreign-item',
      development_plan_item_id: 'item-foreign',
    });
    await repository.saveExecutionPlanRevision({
      ...executionPlanRevisionInput,
      id: 'implementation-plan-foreign-item',
      execution_plan_id: 'implementation-plan-foreign-item',
      development_plan_item_id: 'item-foreign',
    });

    await expectDomainErrorCode(
      () =>
        applyWorkflowTransition(repository, {
          ...transitionInput,
          id: 'transition-boundary-foreign-item',
          from_status: 'brainstorming',
          to_status: 'boundary_review',
          evidence_object_type: 'boundary_summary_revision',
          evidence_object_id: 'boundary-foreign-item',
        }),
      'workflow_invalid_transition',
    );
    await expectDomainErrorCode(
      () =>
        applyWorkflowTransition(repository, {
          ...transitionInput,
          id: 'transition-spec-foreign-item',
          from_status: 'spec_generation_queued',
          to_status: 'spec_review',
          evidence_object_type: 'spec_revision',
          evidence_object_id: 'spec-foreign-item',
        }),
      'workflow_invalid_transition',
    );
    await expectDomainErrorCode(
      () =>
        applyWorkflowTransition(repository, {
          ...transitionInput,
          id: 'transition-plan-foreign-item',
          from_status: 'implementation_plan_generation_queued',
          to_status: 'implementation_plan_review',
          evidence_object_type: 'implementation_plan_revision',
          evidence_object_id: 'implementation-plan-foreign-item',
        }),
      'workflow_invalid_transition',
    );
    await expect(repository.listPlanItemWorkflowTransitions('workflow-1')).resolves.toHaveLength(0);
  });

  it('rejects execution readiness transitions with missing or foreign readiness evidence', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession({
      ...baseWorkflowInput,
      actor_id: 'actor-product',
    });
    await repository.createPlanItemWorkflowWithInitialSession({
      ...baseWorkflowInput,
      id: 'workflow-other',
      codex_session_id: 'session-other',
      development_plan_item_id: 'item-other',
      actor_id: 'actor-product',
    });
    await seedWorkflowActiveApprovalFields(repository);
    await repository.saveExecutionPlanRevision(executionPlanRevisionInput);
    await repository.saveExecutionReadinessRecord({
      ...readinessRecordInput,
      supporting_evidence: [{ object_type: 'implementation_plan_revision', object_id: 'implementation-plan-revision-1' }],
    });
    await repository.saveExecutionReadinessRecord({
      ...readinessRecordInput,
      id: 'readiness-foreign',
      workflow_id: 'workflow-other',
      development_plan_item_id: 'item-other',
      codex_session_id: 'session-other',
      supporting_evidence: [{ object_type: 'implementation_plan_revision', object_id: 'implementation-plan-revision-1' }],
    });

    const readinessTransition = {
      ...transitionInput,
      id: 'transition-readiness',
      from_status: 'implementation_plan_review',
      to_status: 'execution_ready',
      actor_id: 'actor-product',
      reason: 'Mark ready.',
      evidence_object_type: 'execution_readiness_record',
      evidence_object_id: 'readiness-1',
      supporting_evidence: [{ object_type: 'implementation_plan_revision', object_id: 'implementation-plan-revision-1' }],
      codex_session_turn_id: undefined,
    } as const;

    await expectDomainErrorCode(
      () =>
        applyWorkflowTransition(repository, {
          ...readinessTransition,
          id: 'transition-missing-readiness',
          evidence_object_id: 'readiness-missing',
        }),
      'workflow_invalid_transition',
    );
    await expectDomainErrorCode(
      () =>
        applyWorkflowTransition(repository, {
          ...readinessTransition,
          id: 'transition-foreign-readiness',
          evidence_object_id: 'readiness-foreign',
        }),
      'workflow_invalid_transition',
    );

    await repository.applyPlanItemWorkflowTransition({
      transition: readinessTransition,
      projection_patch: { active_implementation_plan_doc_revision_id: 'implementation-plan-revision-1' },
    });

    await expect(repository.listPlanItemWorkflowTransitions('workflow-1')).resolves.toContainEqual(readinessTransition);
  });

  it('rejects execution readiness transitions when readiness is not ready or lacks implementation plan support', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession({
      ...baseWorkflowInput,
      actor_id: 'actor-product',
    });
    await seedWorkflowActiveApprovalFields(repository);
    await repository.saveExecutionPlanRevision(executionPlanRevisionInput);
    await repository.saveExecutionReadinessRecord({
      ...readinessRecordInput,
      id: 'readiness-not-ready',
      readiness_state: 'not_ready',
      blocker_codes: ['missing_tests'],
      supporting_evidence: [{ object_type: 'implementation_plan_revision', object_id: 'implementation-plan-revision-1' }],
    });
    await repository.saveExecutionReadinessRecord({
      ...readinessRecordInput,
      id: 'readiness-missing-plan-support',
      supporting_evidence: [{ object_type: 'commit', object_id: 'a'.repeat(40) }],
    });

    const readinessTransition = {
      ...transitionInput,
      id: 'transition-readiness',
      from_status: 'implementation_plan_review',
      to_status: 'execution_ready',
      actor_id: 'actor-product',
      reason: 'Mark ready.',
      evidence_object_type: 'execution_readiness_record',
      evidence_object_id: 'readiness-not-ready',
      supporting_evidence: [{ object_type: 'implementation_plan_revision', object_id: 'implementation-plan-revision-1' }],
      codex_session_turn_id: undefined,
    } as const;

    await expectDomainErrorCode(
      () => applyWorkflowTransition(repository, readinessTransition),
      'workflow_invalid_transition',
    );
    await expectDomainErrorCode(
      () =>
        applyWorkflowTransition(repository, {
          ...readinessTransition,
          id: 'transition-readiness-missing-plan-support',
          evidence_object_id: 'readiness-missing-plan-support',
        }),
      'workflow_invalid_transition',
    );
    await expectDomainErrorCode(
      () =>
        applyWorkflowTransition(repository, {
          ...readinessTransition,
          id: 'transition-readiness-missing-transition-support',
          evidence_object_id: 'readiness-1',
          supporting_evidence: [{ object_type: 'commit', object_id: 'a'.repeat(40) }],
        }),
      'workflow_invalid_transition',
    );
    const transitions = await repository.listPlanItemWorkflowTransitions('workflow-1');
    expect(transitions).not.toContainEqual(readinessTransition);
    expect(transitions).toHaveLength(6);
  });

  it('accepts execution readiness transitions with ready revision-matched readiness and implementation plan support', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession({
      ...baseWorkflowInput,
      actor_id: 'actor-product',
    });
    await seedWorkflowActiveApprovalFields(repository);
    await repository.saveExecutionPlanRevision(executionPlanRevisionInput);
    await repository.saveExecutionReadinessRecord({
      ...readinessRecordInput,
      supporting_evidence: [{ object_type: 'implementation_plan_revision', object_id: 'implementation-plan-revision-1' }],
    });

    const readinessTransition = {
      ...transitionInput,
      id: 'transition-readiness-with-support',
      from_status: 'implementation_plan_review',
      to_status: 'execution_ready',
      actor_id: 'actor-product',
      reason: 'Mark ready.',
      evidence_object_type: 'execution_readiness_record',
      evidence_object_id: 'readiness-1',
      supporting_evidence: [{ object_type: 'implementation_plan_revision', object_id: 'implementation-plan-revision-1' }],
      codex_session_turn_id: undefined,
    } as const;

    await repository.applyPlanItemWorkflowTransition({
      transition: readinessTransition,
      projection_patch: { active_implementation_plan_doc_revision_id: 'implementation-plan-revision-1' },
    });

    await expect(repository.listPlanItemWorkflowTransitions('workflow-1')).resolves.toContainEqual(readinessTransition);
  });

  it('rejects workflow transitions with unresolved repository or internal artifact evidence', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);

    await expectDomainErrorCode(
      () =>
        applyWorkflowTransition(repository, {
          ...transitionInput,
          id: 'transition-unresolved-commit',
          from_status: 'execution_running',
          to_status: 'code_review',
          evidence_object_type: 'commit',
          evidence_object_id: 'a'.repeat(40),
          codex_session_turn_id: undefined,
        }),
      'workflow_invalid_transition',
    );
    await expectDomainErrorCode(
      () =>
        applyWorkflowTransition(repository, {
          ...transitionInput,
          id: 'transition-unresolved-pr',
          from_status: 'code_review',
          to_status: 'qa',
          evidence_object_type: 'pull_request',
          evidence_object_id: 'https://github.com/owner/repo/pull/123',
          codex_session_turn_id: undefined,
        }),
      'workflow_invalid_transition',
    );
    await expectDomainErrorCode(
      () =>
        applyWorkflowTransition(repository, {
          ...transitionInput,
          id: 'transition-unresolved-internal-artifact-support',
          supporting_evidence: [{ object_type: 'internal_artifact', object_id: 'internal-artifact-missing' }],
        }),
      'workflow_invalid_transition',
    );
    await expect(repository.listPlanItemWorkflowTransitions('workflow-1')).resolves.toHaveLength(0);
  });

  it('rejects workflow transitions with foreign repository or internal artifact evidence', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    await seedWorkflowRepositoryEvidence(repository);
    await repository.createOrReplayInternalArtifactObject({
      ...internalArtifactObjectInput,
      id: 'internal-artifact-foreign',
      artifact_id: 'artifact-foreign',
      ref: 'artifact://internal/generated_payload/codex_session/session-foreign/artifact-foreign',
      owner_id: 'session-foreign',
    });

    await expectDomainErrorCode(
      () =>
        applyWorkflowTransition(repository, {
          ...transitionInput,
          id: 'transition-foreign-pr',
          from_status: 'code_review',
          to_status: 'qa',
          evidence_object_type: 'pull_request',
          evidence_object_id: 'https://github.com/other/repo/pull/123',
          codex_session_turn_id: undefined,
        }),
      'workflow_invalid_transition',
    );
    await expectDomainErrorCode(
      () =>
        applyWorkflowTransition(repository, {
          ...transitionInput,
          id: 'transition-foreign-internal-artifact-support',
          supporting_evidence: [{ object_type: 'internal_artifact', object_id: 'internal-artifact-foreign' }],
        }),
      'workflow_invalid_transition',
    );
    await expect(repository.listPlanItemWorkflowTransitions('workflow-1')).resolves.toHaveLength(0);
  });

  it('rejects duplicate workflow manual decision ids without overwriting evidence', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    const decision = manualDecisionInput;

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

  it('rejects manual decisions with missing workflow or session provenance', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);

    await expectDomainErrorCode(
      () =>
        repository.saveWorkflowManualDecision({
          ...manualDecisionInput,
          id: 'decision-missing-workflow',
          workflow_id: 'workflow-missing',
        }),
      'workflow_invalid_transition',
    );
    await expectDomainErrorCode(
      () =>
        repository.saveWorkflowManualDecision({
          ...manualDecisionInput,
          id: 'decision-missing-session',
          codex_session_id: 'session-missing',
        }),
      'workflow_invalid_transition',
    );
  });

  it('rejects manual decisions that fail full contract validation before saving them', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);

    await expectDomainErrorCode(
      () =>
        repository.saveWorkflowManualDecision({
          ...manualDecisionInput,
          id: 'decision-invalid-kind',
          kind: 'not_a_decision',
        }),
      'workflow_invalid_transition',
    );
    await expect(repository.getWorkflowManualDecision('decision-invalid-kind')).resolves.toBeUndefined();
  });

  it('rejects manual decisions with missing or foreign selected fork provenance', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    await repository.createPlanItemWorkflowWithInitialSession({
      ...baseWorkflowInput,
      id: 'workflow-other',
      codex_session_id: 'session-other',
      development_plan_item_id: 'item-other',
    });
    await repository.createCodexSessionTurn(turnInput);
    await repository.createCodexSessionTurn({
      ...turnInput,
      id: 'turn-other',
      codex_session_id: 'session-other',
      workflow_id: 'workflow-other',
      input_digest: 'sha256:turn-other',
    });
    await repository.createCodexSessionFork({
      id: 'session-other-fork',
      workflow_id: 'workflow-other',
      parent_session_id: 'session-other',
      forked_from_turn_id: 'turn-other',
      fork_reason: 'Try another workflow.',
      created_by_actor_id: 'actor-tech',
      now,
    });

    await expectDomainErrorCode(
      () =>
        repository.saveWorkflowManualDecision({
          ...manualDecisionInput,
          id: 'decision-missing-selected-fork',
          kind: 'fork_select',
          selected_codex_session_id: 'session-missing',
        }),
      'workflow_invalid_transition',
    );
    await expectDomainErrorCode(
      () =>
        repository.saveWorkflowManualDecision({
          ...manualDecisionInput,
          id: 'decision-foreign-selected-fork',
          kind: 'fork_select',
          selected_codex_session_id: 'session-other-fork',
        }),
      'workflow_invalid_transition',
    );
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
          transition_id: 'transition-duplicate-decision',
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
          transition_id: 'transition-current',
          actor_id: 'actor-tech',
          reason: 'Keep current path.',
          now: '2026-05-31T00:03:00.000Z',
        }),
      'codex_session_fork_invalid',
    );
  });

  it('selects inactive fork as active and makes the previous active session inactive', async () => {
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
    await repository.selectActiveCodexSessionFork({
      workflow_id: 'workflow-1',
      selected_codex_session_id: 'session-inactive-fork',
      manual_decision_id: 'decision-inactive-fork',
      transition_id: 'transition-inactive-fork',
      actor_id: 'actor-tech',
      reason: 'Use an inactive fork.',
      now: '2026-05-31T00:03:00.000Z',
    });
    const selected = await repository.selectActiveCodexSessionFork({
      workflow_id: 'workflow-1',
      selected_codex_session_id: 'session-1',
      manual_decision_id: 'decision-reactivate-original',
      transition_id: 'transition-reactivate-original',
      actor_id: 'actor-tech',
      reason: 'Return to the original path.',
      now: '2026-05-31T00:04:00.000Z',
    });

    expect(selected.workflow.active_codex_session_id).toBe('session-1');
    await expect(repository.getCodexSession('session-1')).resolves.toMatchObject({ role: 'active' });
    await expect(repository.getCodexSession('session-inactive-fork')).resolves.toMatchObject({ role: 'inactive_fork' });
    await expect(repository.getWorkflowManualDecision('decision-reactivate-original')).resolves.toMatchObject({
      kind: 'fork_select',
      selected_codex_session_id: 'session-1',
    });
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

    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    await repository.createCodexSessionTurn(turnInput);
    await repository.claimCodexSessionLease(leaseInput);
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
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    await repository.createCodexSessionTurn(turnInput);
    await repository.claimCodexSessionLease(leaseInput);
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

  it('rejects stale terminalization attempts with missing or foreign provenance', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    await repository.createPlanItemWorkflowWithInitialSession({
      ...baseWorkflowInput,
      id: 'workflow-other',
      codex_session_id: 'session-other',
      development_plan_item_id: 'item-other',
    });
    await repository.createCodexSessionTurn(turnInput);
    await repository.createCodexSessionTurn({
      ...turnInput,
      id: 'turn-other',
      codex_session_id: 'session-other',
      workflow_id: 'workflow-other',
      input_digest: 'sha256:turn-other',
    });
    await repository.claimCodexSessionLease(leaseInput);
    await repository.claimCodexSessionLease({
      ...leaseInput,
      session_id: 'session-other',
      workflow_id: 'workflow-other',
      lease_id: 'lease-other',
      lease_token_hash: 'sha256:lease-other',
    });

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

    await expectDomainErrorCode(
      () =>
        repository.saveStaleCodexSessionTerminalizationAttempt({
          ...attempt,
          id: 'stale-missing-session',
          codex_session_id: 'session-missing',
        }),
      'workflow_invalid_transition',
    );
    await expectDomainErrorCode(
      () =>
        repository.saveStaleCodexSessionTerminalizationAttempt({
          ...attempt,
          id: 'stale-missing-turn',
          codex_session_turn_id: 'turn-missing',
        }),
      'workflow_invalid_transition',
    );
    await expectDomainErrorCode(
      () =>
        repository.saveStaleCodexSessionTerminalizationAttempt({
          ...attempt,
          id: 'stale-foreign-turn',
          codex_session_turn_id: 'turn-other',
        }),
      'workflow_invalid_transition',
    );
    await expectDomainErrorCode(
      () =>
        repository.saveStaleCodexSessionTerminalizationAttempt({
          ...attempt,
          id: 'stale-missing-lease',
          lease_id: 'lease-missing',
        }),
      'workflow_invalid_transition',
    );
    await expectDomainErrorCode(
      () =>
        repository.saveStaleCodexSessionTerminalizationAttempt({
          ...attempt,
          id: 'stale-foreign-lease',
          lease_id: 'lease-other',
        }),
      'workflow_invalid_transition',
    );
    await expectDomainErrorCode(
      () =>
        repository.saveStaleCodexSessionTerminalizationAttempt({
          ...attempt,
          id: 'stale-lease-epoch-mismatch',
          lease_epoch: 2,
        }),
      'workflow_invalid_transition',
    );
    await expect(repository.listStaleCodexSessionTerminalizationAttempts('session-1')).resolves.toHaveLength(0);
  });

  it('rejects duplicate execution readiness record ids without overwriting evidence', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    const record = readinessRecordInput;

    await repository.saveExecutionReadinessRecord(record);

    await expectDomainErrorCode(
      () =>
        repository.saveExecutionReadinessRecord({
          ...record,
          readiness_state: 'not_ready',
          blocker_codes: ['missing_tests'],
          supporting_evidence: [{ object_type: 'pull_request', object_id: '42' }],
        }),
      'workflow_invalid_transition',
    );
    await expect(repository.getExecutionReadinessRecord('readiness-1')).resolves.toMatchObject({
      readiness_state: 'ready',
      blocker_codes: [],
      supporting_evidence: [{ object_type: 'commit', object_id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }],
    });
  });

  it('rejects execution readiness records with mismatched workflow plan or item provenance', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);

    await expectDomainErrorCode(
      () =>
        repository.saveExecutionReadinessRecord({
          ...readinessRecordInput,
          id: 'readiness-plan-mismatch',
          development_plan_id: 'plan-other',
        }),
      'workflow_invalid_transition',
    );
    await expectDomainErrorCode(
      () =>
        repository.saveExecutionReadinessRecord({
          ...readinessRecordInput,
          id: 'readiness-item-mismatch',
          development_plan_item_id: 'item-other',
        }),
      'workflow_invalid_transition',
    );
  });

  it('rejects execution readiness records with missing or foreign workflow session provenance', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    await repository.createPlanItemWorkflowWithInitialSession({
      ...baseWorkflowInput,
      id: 'workflow-other',
      codex_session_id: 'session-other',
      development_plan_item_id: 'item-other',
    });

    await expectDomainErrorCode(
      () =>
        repository.saveExecutionReadinessRecord({
          ...readinessRecordInput,
          id: 'readiness-missing-workflow',
          workflow_id: 'workflow-missing',
        }),
      'workflow_invalid_transition',
    );
    await expectDomainErrorCode(
      () =>
        repository.saveExecutionReadinessRecord({
          ...readinessRecordInput,
          id: 'readiness-missing-session',
          codex_session_id: 'session-missing',
        }),
      'workflow_invalid_transition',
    );
    await expectDomainErrorCode(
      () =>
        repository.saveExecutionReadinessRecord({
          ...readinessRecordInput,
          id: 'readiness-foreign-session',
          codex_session_id: 'session-other',
        }),
      'workflow_invalid_transition',
    );
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
