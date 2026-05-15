import { describe, expect, it } from 'vitest';

import { InMemoryP0Repository, type P0Repository } from '../../packages/db/src/index';

const now = '2026-05-05T00:00:00.000Z';
const later = '2026-05-05T00:01:00.000Z';
const buildManualScopeKey = (scope: { object_type: string; object_id: string }) =>
  `${scope.object_type}:${scope.object_id}`;

const expectDefaultOff = async (repository: P0Repository) => {
  await expect(
    repository.resolveAutomationProjectSettings({ project_id: 'project-automation', repo_id: 'repo-1' }),
  ).resolves.toMatchObject({
    project_id: 'project-automation',
    repo_id: 'repo-1',
    scope_type: 'repo',
    preset: 'off',
    version: 0,
    capabilities_json: {
      canProjectRuntimeState: false,
      canGeneratePlanDraft: false,
      canGeneratePackageDrafts: false,
      canEnqueueRuns: false,
    },
  });
};

describe('automation repository primitives', () => {
  it('resolves default-off settings and enforces version CAS', async () => {
    const repository = new InMemoryP0Repository();

    await expectDefaultOff(repository);

    const enabled = await repository.setAutomationProjectSettings({
      id: 'automation-settings-cas',
      project_id: 'project-automation',
      repo_id: 'repo-1',
      scope_type: 'repo',
      preset: 'draft_only',
      expected_version: 0,
      reason: 'local dogfood',
      evidence_refs: [],
      actor: { actor_id: 'actor-admin', actor_class: 'human_admin' },
      now,
    });

    expect(enabled.version).toBe(1);
    expect(enabled.capabilities_json.canGeneratePackageDrafts).toBe(true);
    await expect(
      repository.disableAutomationProjectSettings({
        project_id: 'project-automation',
        repo_id: 'repo-1',
        expected_version: 0,
        reason: 'stale disable',
        evidence_refs: [],
        actor: { actor_id: 'actor-admin', actor_class: 'human_admin' },
        now: later,
      }),
    ).rejects.toThrow(/version/i);
  });

  it('replays manual hold idempotency after resolution and propagates ancestor holds', async () => {
    const repository = new InMemoryP0Repository();
    await seedPackageGraph(repository);

    const hold = await repository.requestManualPathHold({
      id: 'hold-plan',
      object_type: 'plan_revision',
      object_id: 'plan-revision-automation',
      scope_key: buildManualScopeKey({ object_type: 'plan_revision', object_id: 'plan-revision-automation' }),
      reason_code: 'needs_human_plan_review',
      reason: 'Plan must be reviewed manually.',
      evidence_refs: [],
      requested_by: 'daemon-1',
      requested_at: now,
      idempotency_key: 'hold-plan-idem',
      source_automation_action_id: 'automation-action-plan',
    });

    expect(
      (await repository.listActiveManualPathHolds({
        object_type: 'execution_package',
        object_id: 'execution-package-automation',
      })).map((activeHold) => activeHold.id),
    ).toEqual(['hold-plan']);

    await repository.resolveManualPathHold({
      hold_id: hold.id,
      resolved_by: 'actor-admin',
      resolved_at: later,
      resolution: 'reviewed',
    });

    await expect(
      repository.requestManualPathHold({
        ...hold,
        id: 'hold-plan-new-id',
        requested_at: later,
        idempotency_key: 'hold-plan-idem',
      }),
    ).resolves.toMatchObject({ id: hold.id, status: 'resolved', source_automation_action_id: 'automation-action-plan' });
  });

  it('replays terminal idempotency records and rejects precondition drift', async () => {
    const repository = new InMemoryP0Repository();

    const claim = await repository.claimCommandIdempotency({
      id: 'command-record',
      command_name: 'ensure_plan',
      idempotency_key: 'command-key',
      target_object_type: 'work_item',
      target_object_id: 'work-item-automation',
      target_revision_id: 'spec-revision-automation',
      target_version: 1,
      precondition_fingerprint: 'fingerprint-a',
      precondition_json: { automation_settings_version: 1 },
      actor_scope: 'daemon-1',
      claim_token: 'claim-1',
      locked_until: '2026-05-05T00:05:00.000Z',
      now,
    });
    expect(claim.status).toBe('running');

    await expect(
      repository.claimCommandIdempotency({
        ...claim,
        id: 'command-record-drift',
        precondition_fingerprint: 'fingerprint-b',
        claim_token: 'claim-drift',
        now,
      }),
    ).rejects.toThrow(/precondition|fingerprint/i);

    const completed = await repository.completeCommandIdempotency({
      idempotency_key: 'command-key',
      claim_token: 'claim-1',
      result_json: { object_id: 'plan-revision-automation' },
      finished_at: later,
    });

    expect(
      await repository.claimCommandIdempotency({
        ...claim,
        id: 'command-record-replay',
        claim_token: 'claim-replay',
        now: later,
      }),
    ).toEqual(completed);
  });

  it('resumes deterministic package generation runs and rejects manifest drift', async () => {
    const repository = new InMemoryP0Repository();

    const first = await repository.claimExecutionPackageGenerationRun({
      plan_revision_id: 'plan-revision-automation',
      generation_key: 'default:plan-revision-automation',
      generator_version: 'mock-plan-splitter@1',
      policy_digest: 'sha256-policy-a',
      manifest_digest: 'sha256-manifest-a',
      expected_package_count: 2,
      expected_package_keys: ['api', 'tests'],
      claim_token: 'claim-1',
      now,
      locked_until: '2026-05-05T00:05:00.000Z',
    });

    expect(first.status).toBe('running');
    await expect(
      repository.claimExecutionPackageGenerationRun({
        plan_revision_id: 'plan-revision-automation',
        generation_key: 'default:plan-revision-automation',
        generator_version: 'mock-plan-splitter@2',
        policy_digest: 'sha256-policy-a',
        manifest_digest: 'sha256-manifest-b',
        expected_package_count: 1,
        expected_package_keys: ['api'],
        claim_token: 'claim-2',
        now,
        locked_until: '2026-05-05T00:05:00.000Z',
      }),
    ).rejects.toThrow(/manifest/i);
  });

  it('claims action runs and lists due gate-pending work', async () => {
    const repository = new InMemoryP0Repository();

    const claimed = await repository.claimAutomationActionRun({
      id: 'action-run-1',
      action_type: 'generate_execution_packages',
      target_object_type: 'plan_revision',
      target_object_id: 'plan-revision-automation',
      target_status: 'approved',
      idempotency_key: 'action-idem-1',
      automation_scope: 'project:project-automation',
      automation_settings_version: 1,
      capability_fingerprint: 'capability-a',
      claim_token: 'action-claim-1',
      locked_until: '2026-05-05T00:05:00.000Z',
      now,
    });

    expect(claimed.status).toBe('running');
    await repository.markAutomationActionGatePending({
      id: claimed.id,
      idempotency_key: claimed.idempotency_key,
      claim_token: 'action-claim-1',
      reason: 'manual_path_hold_active',
      next_attempt_at: later,
      now,
    });

    await expect(repository.listClaimableAutomationActionRuns({ now: later, limit: 5 })).resolves.toMatchObject([
      { id: claimed.id, status: 'gate_pending' },
    ]);
  });
});

async function seedPackageGraph(repository: P0Repository): Promise<void> {
  await repository.saveWorkItem({
    id: 'work-item-automation',
    project_id: 'project-automation',
    kind: 'requirement',
    title: 'Automation graph',
    goal: 'Test hold propagation.',
    success_criteria: ['Ancestor holds block packages.'],
    priority: 'P0',
    risk: 'medium',
    owner_actor_id: 'actor-admin',
    phase: 'plan',
    activity_state: 'idle',
    gate_state: 'none',
    resolution: 'none',
    current_spec_id: 'spec-automation',
    current_spec_revision_id: 'spec-revision-automation',
    current_plan_id: 'plan-automation',
    current_plan_revision_id: 'plan-revision-automation',
    created_at: now,
    updated_at: now,
  });
  await repository.savePlanRevision({
    id: 'plan-revision-automation',
    plan_id: 'plan-automation',
    work_item_id: 'work-item-automation',
    based_on_spec_revision_id: 'spec-revision-automation',
    revision_number: 1,
    summary: 'Plan',
    content: 'Plan',
    implementation_summary: 'Implement',
    split_strategy: 'Single package',
    dependency_order: ['execution-package-automation'],
    test_matrix: ['pnpm test'],
    risk_mitigations: [],
    rollback_notes: 'Revert',
    structured_document: {},
    artifact_refs: [],
    created_at: now,
  });
  await repository.saveExecutionPackage({
    id: 'execution-package-automation',
    work_item_id: 'work-item-automation',
    spec_id: 'spec-automation',
    spec_revision_id: 'spec-revision-automation',
    plan_id: 'plan-automation',
    plan_revision_id: 'plan-revision-automation',
    project_id: 'project-automation',
    repo_id: 'repo-1',
    objective: 'Implement package',
    owner_actor_id: 'actor-admin',
    reviewer_actor_id: 'actor-admin',
    qa_owner_actor_id: 'actor-admin',
    phase: 'draft',
    activity_state: 'idle',
    gate_state: 'not_submitted',
    resolution: 'none',
    required_checks: [],
    required_artifact_kinds: [],
    allowed_paths: [],
    forbidden_paths: [],
    version: 0,
    created_at: now,
    updated_at: now,
  });
}
