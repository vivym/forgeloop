import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import type { WorkItem } from '@forgeloop/domain';

import {
  InMemoryDeliveryRepository,
  type ClaimAutomationActionRunInput,
  type CreateOrReplayAutomationActionRunInput,
  type DeliveryRepository,
} from '../../packages/db/src/index';

const now = '2026-05-05T00:00:00.000Z';
const later = '2026-05-05T00:01:00.000Z';
const afterRetry = '2026-05-05T00:10:00.000Z';
const buildManualScopeKey = (scope: { object_type: string; object_id: string }) =>
  `${scope.object_type}:${scope.object_id}`;

type ActionInputOverrides = Partial<CreateOrReplayAutomationActionRunInput> & Partial<ClaimAutomationActionRunInput>;

const createActionInput = (
  id: string,
  overrides: ActionInputOverrides = {},
): CreateOrReplayAutomationActionRunInput => ({
  id,
  action_type: 'ensure_plan_draft',
  target_object_type: 'work_item',
  target_object_id: 'work-item-automation',
  target_revision_id: 'spec-revision-automation',
  target_status: 'approved',
  target_version: 1,
  idempotency_key: `${id}-idem`,
  automation_scope: 'repo:project-automation:repo-1',
  automation_settings_version: 1,
  capability_fingerprint: 'capability-a',
  precondition_fingerprint: 'precondition-a',
  action_input_json: { work_item_id: 'work-item-automation', spec_revision_id: 'spec-revision-automation' },
  now,
  ...overrides,
});

const claimSeedAction = async (repository: DeliveryRepository, id: string, overrides: ActionInputOverrides = {}) =>
  repository.claimAutomationActionRun({
    ...createActionInput(id, overrides),
    claim_token: `${id}-claim-1`,
    locked_until: '2026-05-05T00:05:00.000Z',
    ...overrides,
  });

const expectDefaultOff = async (repository: DeliveryRepository) => {
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
      canGenerateSpecDraft: false,
      canGeneratePlanDraft: false,
      canGeneratePackageDrafts: false,
      canEnqueueRuns: false,
    },
  });
};

describe('automation repository primitives', () => {
  it('resolves default-off settings and enforces version CAS', async () => {
    const repository = new InMemoryDeliveryRepository();

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
    const repository = new InMemoryDeliveryRepository();
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

  it('suppresses runtime package draft eligibility for active work item ancestor holds', async () => {
    const repository = new InMemoryDeliveryRepository();
    await seedPackageEligibilityGraph(repository);

    await expect(repository.getRuntimeSnapshotData()).resolves.toMatchObject({
      plan_revisions_requiring_packages: [
        expect.objectContaining({
          target_object_type: 'plan_revision',
          target_object_id: 'plan-revision-automation',
          target_revision_id: 'default:plan-revision-automation',
        }),
      ],
    });

    await repository.requestManualPathHold({
      id: 'hold-work-item-package-ancestor',
      object_type: 'work_item',
      object_id: 'work-item-automation',
      scope_key: buildManualScopeKey({ object_type: 'work_item', object_id: 'work-item-automation' }),
      reason_code: 'needs_human_triage',
      reason: 'Human triage required before package drafting.',
      evidence_refs: [],
      requested_by: 'daemon-1',
      requested_at: now,
      idempotency_key: 'hold-work-item-package-ancestor-idem',
    });

    await expect(repository.getRuntimeSnapshotData()).resolves.toMatchObject({
      plan_revisions_requiring_packages: [],
    });
  });

  it('suppresses runtime package draft eligibility for active spec revision ancestor holds', async () => {
    const repository = new InMemoryDeliveryRepository();
    await seedPackageEligibilityGraph(repository);

    await expect(repository.getRuntimeSnapshotData()).resolves.toMatchObject({
      plan_revisions_requiring_packages: [
        expect.objectContaining({
          target_object_type: 'plan_revision',
          target_object_id: 'plan-revision-automation',
          target_revision_id: 'default:plan-revision-automation',
        }),
      ],
    });

    await repository.requestManualPathHold({
      id: 'hold-spec-revision-package-ancestor',
      object_type: 'spec_revision',
      object_id: 'spec-revision-automation',
      scope_key: buildManualScopeKey({ object_type: 'spec_revision', object_id: 'spec-revision-automation' }),
      reason_code: 'needs_human_spec_review',
      reason: 'Spec review required before package drafting.',
      evidence_refs: [],
      requested_by: 'daemon-1',
      requested_at: now,
      idempotency_key: 'hold-spec-revision-package-ancestor-idem',
    });

    await expect(repository.getRuntimeSnapshotData()).resolves.toMatchObject({
      plan_revisions_requiring_packages: [],
    });
  });

  it('projects only eligible work items requiring Spec drafts', async () => {
    const repository = new InMemoryDeliveryRepository();
    await seedSpecEligibilityGraph(repository);

    await expect(repository.getRuntimeSnapshotData()).resolves.toMatchObject({
      work_items_requiring_spec: [
        expect.objectContaining({
          target_object_type: 'work_item',
          target_object_id: 'work-item-needs-spec',
          target_status: 'triage',
          project_id: 'project-automation',
          repo_id: 'repo-1',
          automation_scope: 'repo:project-automation:repo-1',
        }),
      ],
    });

    await repository.saveWorkItem(
      specWorkItem('work-item-terminal', {
        phase: 'done',
        resolution: 'completed',
      }),
    );
    await repository.saveSpec({
      id: 'spec-existing',
      work_item_id: 'work-item-with-spec',
      entity_type: 'spec',
      status: 'draft',
      editing_state: 'idle',
      gate_state: 'not_submitted',
      resolution: 'none',
      current_revision_id: 'spec-revision-existing',
      created_at: now,
      updated_at: now,
    });
    await repository.saveWorkItem(
      specWorkItem('work-item-with-spec', {
        current_spec_id: 'spec-existing',
        current_spec_revision_id: 'spec-revision-existing',
      }),
    );
    await repository.requestManualPathHold({
      id: 'hold-work-item-spec',
      object_type: 'work_item',
      object_id: 'work-item-held',
      scope_key: buildManualScopeKey({ object_type: 'work_item', object_id: 'work-item-held' }),
      reason_code: 'needs_human_spec_review',
      reason: 'Human must choose the first Spec draft path.',
      evidence_refs: [],
      requested_by: 'daemon-1',
      requested_at: now,
      idempotency_key: 'hold-work-item-spec-idem',
    });
    await repository.saveWorkItem(specWorkItem('work-item-held'));
    await repository.saveProject({
      id: 'project-no-spec-capability',
      name: 'No Spec Capability',
      repo_ids: ['repo-no-spec'],
      owner_actor_id: 'actor-admin',
      created_at: now,
      updated_at: now,
    });
    await repository.saveProjectRepo({
      id: 'project-repo-no-spec-capability',
      repo_id: 'repo-no-spec',
      project_id: 'project-no-spec-capability',
      name: 'repo-no-spec',
      status: 'active',
      local_path: '/workspace/repo-no-spec',
      default_branch: 'main',
      base_commit_sha: 'abc123',
      created_at: now,
      updated_at: now,
    });
    await repository.setAutomationProjectSettings({
      id: 'automation-settings-no-spec-capability',
      project_id: 'project-no-spec-capability',
      repo_id: 'repo-no-spec',
      scope_type: 'repo',
      preset: 'ready_projection',
      expected_version: 0,
      reason: 'projection only',
      evidence_refs: [],
      actor: { actor_id: 'actor-admin', actor_class: 'human_admin' },
      now,
    });
    await repository.saveWorkItem(
      specWorkItem('work-item-no-spec-capability', {
        project_id: 'project-no-spec-capability',
      }),
    );
    await repository.createOrReplayAutomationActionRun({
      id: 'automation-action-spec-suppressed',
      action_type: 'ensure_spec_draft',
      target_object_type: 'work_item',
      target_object_id: 'work-item-suppressed',
      target_status: 'triage',
      idempotency_key: 'automation-action-spec-suppressed-idem',
      automation_scope: 'repo:project-automation:repo-1',
      automation_settings_version: 1,
      capability_fingerprint: 'capability-a',
      precondition_fingerprint: 'precondition-spec-suppressed',
      action_input_json: { work_item_id: 'work-item-suppressed' },
      now,
    });
    await repository.saveWorkItem(specWorkItem('work-item-suppressed'));

    const targetIds = (await repository.getRuntimeSnapshotData()).work_items_requiring_spec.map(
      (target) => target.target_object_id,
    );
    expect(targetIds).toEqual(['work-item-needs-spec']);
  });

  it('replays terminal idempotency records and rejects precondition drift', async () => {
    const repository = new InMemoryDeliveryRepository();

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
    const repository = new InMemoryDeliveryRepository();

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
    const repository = new InMemoryDeliveryRepository();

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
      precondition_fingerprint: 'precondition-action-1',
      action_input_json: { plan_revision_id: 'plan-revision-automation' },
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

  it('creates pending action runs and claims the next eligible run', async () => {
    const repository: DeliveryRepository = new InMemoryDeliveryRepository();

    const pending = await repository.createOrReplayAutomationActionRun(createActionInput('action-pending'));

    expect(pending).toMatchObject({
      id: 'action-pending',
      status: 'pending',
      attempt: 0,
      precondition_fingerprint: 'precondition-a',
      action_input_json: { work_item_id: 'work-item-automation', spec_revision_id: 'spec-revision-automation' },
    });
    expect(pending.claim_token).toBeUndefined();

    const claimed = await repository.claimNextAutomationActionRun({
      now: later,
      claim_token: 'claim-next-1',
      locked_until: '2026-05-05T00:06:00.000Z',
      limit: 10,
    });

    expect(claimed).toMatchObject({
      id: pending.id,
      status: 'running',
      claim_token: 'claim-next-1',
      attempt: 1,
      claimed_at: later,
      started_at: later,
    });
    await expect(
      repository.getClaimedAutomationActionRun({ id: pending.id, claim_token: 'claim-next-1' }),
    ).resolves.toMatchObject({ id: pending.id, status: 'running' });
  });

  it('rejects idempotency replay when mutating preconditions or action input drift', async () => {
    const repository: DeliveryRepository = new InMemoryDeliveryRepository();
    const input = createActionInput('action-conflict');

    await repository.createOrReplayAutomationActionRun(input);
    await expect(
      repository.createOrReplayAutomationActionRun({ ...input, precondition_fingerprint: 'precondition-b' }),
    ).rejects.toThrow(/idempotency|identity|precondition/i);
    await expect(
      repository.createOrReplayAutomationActionRun({
        ...input,
        action_input_json: { work_item_id: 'work-item-automation', spec_revision_id: 'changed' },
      }),
    ).rejects.toThrow(/idempotency|identity|action/i);
  });

  it('treats action input replay as stable across JSON key order', async () => {
    const repository: DeliveryRepository = new InMemoryDeliveryRepository();
    const input = createActionInput('action-canonical-json', {
      action_input_json: {
        work_item_id: 'work-item-automation',
        spec_revision_id: 'spec-revision-automation',
        nested: { beta: 2, alpha: 1 },
        list: [{ zeta: true, alpha: false }],
      },
    });

    const created = await repository.createOrReplayAutomationActionRun(input);
    await expect(
      repository.createOrReplayAutomationActionRun({
        ...input,
        action_input_json: {
          list: [{ alpha: false, zeta: true }],
          nested: { alpha: 1, beta: 2 },
          spec_revision_id: 'spec-revision-automation',
          work_item_id: 'work-item-automation',
        },
      }),
    ).resolves.toMatchObject({ id: created.id, status: 'pending' });
  });

  it('rejects a different idempotency key for an existing durable action id', async () => {
    const repository: DeliveryRepository = new InMemoryDeliveryRepository();
    const input = createActionInput('action-duplicate-id');

    await repository.createOrReplayAutomationActionRun(input);
    await expect(
      repository.createOrReplayAutomationActionRun({
        ...input,
        idempotency_key: 'action-duplicate-id-new-key',
      }),
    ).rejects.toThrow(/idempotency|identity|duplicate/i);
  });

  it('claims only eligible statuses and skips gated, terminal, and live running actions', async () => {
    const repository: DeliveryRepository = new InMemoryDeliveryRepository();

    await repository.createOrReplayAutomationActionRun(createActionInput('claim-pending'));

    const dueGate = await claimSeedAction(repository, 'claim-gate-due');
    await repository.markAutomationActionGatePending({
      id: dueGate.id,
      idempotency_key: dueGate.idempotency_key,
      claim_token: 'claim-gate-due-claim-1',
      reason: 'manual_path_hold_active',
      next_attempt_at: later,
      now,
    });

    const futureGate = await claimSeedAction(repository, 'skip-gate-future');
    await repository.markAutomationActionGatePending({
      id: futureGate.id,
      idempotency_key: futureGate.idempotency_key,
      claim_token: 'skip-gate-future-claim-1',
      reason: 'manual_path_hold_active',
      next_attempt_at: afterRetry,
      now,
    });

    const retryableFailed = await claimSeedAction(repository, 'claim-failed-retry');
    await repository.completeAutomationActionRun({
      id: retryableFailed.id,
      idempotency_key: retryableFailed.idempotency_key,
      claim_token: 'claim-failed-retry-claim-1',
      status: 'failed',
      retryable: true,
      next_attempt_at: later,
      finished_at: now,
    });

    const retryableBlocked = await claimSeedAction(repository, 'claim-blocked-retry');
    await repository.completeAutomationActionRun({
      id: retryableBlocked.id,
      idempotency_key: retryableBlocked.idempotency_key,
      claim_token: 'claim-blocked-retry-claim-1',
      status: 'blocked',
      retryable: true,
      next_attempt_at: later,
      finished_at: now,
    });

    const terminalSkipped = await claimSeedAction(repository, 'skip-terminal');
    await repository.completeAutomationActionRun({
      id: terminalSkipped.id,
      idempotency_key: terminalSkipped.idempotency_key,
      claim_token: 'skip-terminal-claim-1',
      status: 'skipped',
      retryable: false,
      finished_at: now,
    });

    await claimSeedAction(repository, 'claim-running-expired', {
      locked_until: later,
      now,
    });
    await claimSeedAction(repository, 'skip-running-live', {
      locked_until: afterRetry,
      now,
    });

    const claimedIds = [];
    for (let index = 0; index < 5; index += 1) {
      const claimed = await repository.claimNextAutomationActionRun({
        now: '2026-05-05T00:02:00.000Z',
        claim_token: `claim-next-${index}`,
        locked_until: afterRetry,
        limit: 20,
      });
      if (claimed !== undefined) {
        claimedIds.push(claimed.id);
      }
    }

    expect(claimedIds.sort()).toEqual(
      ['claim-blocked-retry', 'claim-failed-retry', 'claim-gate-due', 'claim-pending', 'claim-running-expired'].sort(),
    );
    expect(claimedIds).not.toContain('skip-gate-future');
    expect(claimedIds).not.toContain('skip-terminal');
    expect(claimedIds).not.toContain('skip-running-live');
  });

  it('starts reclaimed actions with fresh result and retry state', async () => {
    const repository: DeliveryRepository = new InMemoryDeliveryRepository();
    const retryableFailed = await claimSeedAction(repository, 'claim-fresh-state');
    await repository.completeAutomationActionRun({
      id: retryableFailed.id,
      idempotency_key: retryableFailed.idempotency_key,
      claim_token: 'claim-fresh-state-claim-1',
      status: 'failed',
      retryable: true,
      next_attempt_at: later,
      result_json: { reason: 'transient_failure' },
      finished_at: now,
    });

    const reclaimed = await repository.claimNextAutomationActionRun({
      now: later,
      claim_token: 'claim-fresh-state-claim-2',
      locked_until: afterRetry,
      limit: 10,
    });
    expect(reclaimed).toMatchObject({ id: retryableFailed.id, status: 'running', attempt: 2 });
    expect(reclaimed?.result_json).toBeUndefined();
    expect(reclaimed?.reason).toBeUndefined();
    expect(reclaimed?.retryable).toBeUndefined();
    expect(reclaimed?.next_attempt_at).toBeUndefined();
    expect(reclaimed?.finished_at).toBeUndefined();

    await repository.completeAutomationActionRun({
      id: retryableFailed.id,
      idempotency_key: retryableFailed.idempotency_key,
      claim_token: 'claim-fresh-state-claim-2',
      status: 'blocked',
      finished_at: afterRetry,
    });
    const laterClaimableIds = (
      await repository.listClaimableAutomationActionRuns({
        now: '2026-05-05T00:11:00.000Z',
        limit: 10,
      })
    ).map((actionRun) => actionRun.id);
    expect(laterClaimableIds).not.toContain(retryableFailed.id);
  });

  it('compares action lease timestamps chronologically instead of lexically', async () => {
    const repository: DeliveryRepository = new InMemoryDeliveryRepository();
    await claimSeedAction(repository, 'claim-iso-variant-expired', {
      locked_until: '2026-05-05T00:00:00Z',
      now,
    });

    await expect(
      repository.listClaimableAutomationActionRuns({
        now: '2026-05-05T00:00:00.500Z',
        limit: 10,
      }),
    ).resolves.toEqual([expect.objectContaining({ id: 'claim-iso-variant-expired', status: 'running' })]);
    await expect(
      repository.claimNextAutomationActionRun({
        now: '2026-05-05T00:00:00.500Z',
        claim_token: 'claim-iso-variant-expired-2',
        locked_until: afterRetry,
        limit: 10,
      }),
    ).resolves.toMatchObject({ id: 'claim-iso-variant-expired', status: 'running', attempt: 2 });
  });

  it('uses project runtime snapshot stable observation identity for replay and latest projection lookup', async () => {
    const repository: DeliveryRepository = new InMemoryDeliveryRepository();
    const snapshotInput = createActionInput('snapshot-action', {
      action_type: 'project_runtime_snapshot',
      target_object_type: 'repo',
      target_object_id: 'repo-1',
      target_revision_id: undefined,
      target_status: 'observed',
      idempotency_key: 'snapshot-stable-key',
      automation_scope: 'repo:project-automation:repo-1',
      automation_settings_version: 1,
      capability_fingerprint: 'capability-a',
      precondition_fingerprint: 'snapshot-precondition-a',
      action_input_json: {
        repo_id: 'repo-1',
        policy_status: 'loaded',
        policy_digest: 'policy-a',
        parser_version: 'workflow-md-parser:v1',
        reason_code: 'loaded',
        observed_at: now,
        last_known_good: { repo_id: 'repo-1', policy_status: 'loaded', policy_digest: 'older' },
      },
    });

    const created = await repository.createOrReplayAutomationActionRun(snapshotInput);
    await expect(
      repository.createOrReplayAutomationActionRun({
        ...snapshotInput,
        target_object_type: 'repo',
        target_object_id: 'repo-1-renamed',
        target_status: 'reobserved',
        automation_scope: 'repo:project-automation:repo-1',
        automation_settings_version: 99,
        capability_fingerprint: 'capability-b',
        action_input_json: {
          repo_id: 'repo-1',
          policy_status: 'loaded',
          policy_digest: 'policy-a',
          parser_version: 'workflow-md-parser:v1',
          reason_code: 'loaded',
          observed_at: later,
          last_known_good: { repo_id: 'repo-1', policy_status: 'loaded', policy_digest: 'newer' },
        },
      }),
    ).resolves.toMatchObject({ id: created.id, status: 'pending' });
    await expect(
      repository.createOrReplayAutomationActionRun({
        ...snapshotInput,
        automation_scope: 'repo:project-other:repo-1',
      }),
    ).rejects.toThrow(/idempotency|identity|policy/i);
    await expect(
      repository.createOrReplayAutomationActionRun({
        ...snapshotInput,
        action_input_json: {
          repo_id: 'repo-1',
          policy_status: 'loaded',
          policy_digest: 'policy-b',
          parser_version: 'workflow-md-parser:v1',
          reason_code: 'loaded',
        },
      }),
    ).rejects.toThrow(/idempotency|identity|policy/i);

    const claimed = await repository.claimNextAutomationActionRun({
      now: later,
      claim_token: 'snapshot-claim',
      locked_until: afterRetry,
      limit: 10,
    });
    await repository.completeAutomationActionRun({
      id: claimed?.id ?? '',
      idempotency_key: claimed?.idempotency_key ?? '',
      claim_token: 'snapshot-claim',
      status: 'succeeded',
      finished_at: later,
      result_json: { projected: true },
    });

    const newer = await repository.createOrReplayAutomationActionRun({
      ...snapshotInput,
      id: 'snapshot-action-newer',
      idempotency_key: 'snapshot-stable-key-newer',
    });
    const claimedNewer = await repository.claimNextAutomationActionRun({
      now: '2026-05-05T00:02:00.000Z',
      claim_token: 'snapshot-claim-newer',
      locked_until: afterRetry,
      limit: 10,
    });
    await repository.completeAutomationActionRun({
      id: claimedNewer?.id ?? '',
      idempotency_key: claimedNewer?.idempotency_key ?? '',
      claim_token: 'snapshot-claim-newer',
      status: 'succeeded',
      finished_at: '2026-05-05T00:03:00.000Z',
      result_json: { projected: true, newer: true },
    });

    const otherProject = await repository.createOrReplayAutomationActionRun({
      ...snapshotInput,
      id: 'snapshot-action-other-project',
      idempotency_key: 'snapshot-stable-key-other-project',
      automation_scope: 'repo:project-other:repo-1',
      now: '2026-05-05T00:04:00.000Z',
    });
    const claimedOtherProject = await repository.claimNextAutomationActionRun({
      now: '2026-05-05T00:04:00.000Z',
      claim_token: 'snapshot-claim-other-project',
      locked_until: afterRetry,
      limit: 10,
      automation_scope: 'repo:project-other:repo-1',
    });
    await repository.completeAutomationActionRun({
      id: claimedOtherProject?.id ?? '',
      idempotency_key: claimedOtherProject?.idempotency_key ?? '',
      claim_token: 'snapshot-claim-other-project',
      status: 'succeeded',
      finished_at: '2026-05-05T00:05:00.000Z',
      result_json: { projected: true, otherProject: true },
    });

    await expect(
      repository.latestCompletedProjectionActionRun({
        automation_scope: 'repo:project-automation:repo-1',
        repo_id: 'repo-1',
        policy_status: 'loaded',
        policy_digest: 'policy-a',
        parser_version: 'workflow-md-parser:v1',
        reason_code: 'loaded',
      }),
    ).resolves.toMatchObject({ id: newer.id, status: 'succeeded' });
    await expect(
      repository.latestCompletedProjectionActionRun({
        automation_scope: 'repo:project-other:repo-1',
        repo_id: 'repo-1',
        policy_status: 'loaded',
        policy_digest: 'policy-a',
        parser_version: 'workflow-md-parser:v1',
        reason_code: 'loaded',
      }),
    ).resolves.toMatchObject({ id: otherProject.id, status: 'succeeded' });
  });

  it('pushes latest completed projection action lookup filters into Drizzle SQL', () => {
    const source = readFileSync('packages/db/src/repositories/drizzle-delivery-repository.ts', 'utf8');
    const methodStart = source.indexOf('async latestCompletedProjectionActionRun(');
    const methodEnd = source.indexOf('\n  async claimAutomationActionRun', methodStart);
    expect(methodStart).toBeGreaterThanOrEqual(0);
    expect(methodEnd).toBeGreaterThan(methodStart);
    const methodSource = source.slice(methodStart, methodEnd);

    expect(methodSource).toContain('automation_action_runs.automationScope');
    expect(methodSource).toContain('automation_action_runs.actionInputJson');
    expect(methodSource).toMatch(/actionInputJson[\s\S]*->>[\s\S]*repo_id/);
    expect(methodSource).toMatch(/actionInputJson[\s\S]*->>[\s\S]*policy_status/);
    expect(methodSource).toMatch(/actionInputJson[\s\S]*->>[\s\S]*parser_version/);
    expect(methodSource).toMatch(/actionInputJson[\s\S]*->>[\s\S]*policy_digest/);
    expect(methodSource).toMatch(/actionInputJson[\s\S]*->>[\s\S]*reason_code/);
    expect(methodSource).toContain('.limit(1)');
    expect(methodSource).not.toContain('.find(');
  });

  it('keeps runtime snapshot action-run queries bounded in the Drizzle repository', () => {
    const source = readFileSync('packages/db/src/repositories/drizzle-delivery-repository.ts', 'utf8');
    const methodStart = source.indexOf('async getRuntimeSnapshotData(): Promise<RuntimeSnapshotRepositoryData>');
    const methodEnd = source.indexOf('\n  async saveRelease', methodStart);
    expect(methodStart).toBeGreaterThanOrEqual(0);
    expect(methodEnd).toBeGreaterThan(methodStart);
    const methodSource = source.slice(methodStart, methodEnd);

    expect(methodSource).not.toContain('const allActions');
    const actionRunQueries = [
      ...methodSource.matchAll(/this\.db\s*\.\s*select\(\)\s*\.\s*from\(automation_action_runs\)[\s\S]*?;/g),
    ].map(([query]) => query);
    expect(actionRunQueries.length).toBeGreaterThanOrEqual(3);
    expect(actionRunQueries).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/orderBy\([\s\S]*automation_action_runs\.finishedAt[\s\S]*automation_action_runs\.updatedAt[\s\S]*automation_action_runs\.createdAt[\s\S]*automation_action_runs\.id[\s\S]*\)\s*\.limit\((50|RUNTIME_SNAPSHOT_RECENT_ACTION_RUN_LIMIT)\)/),
        expect.stringMatching(/where\([\s\S]*automation_action_runs\.actionType[\s\S]*project_runtime_snapshot[\s\S]*automation_action_runs\.status[\s\S]*succeeded[\s\S]*\)[\s\S]*\.limit\(/),
        expect.stringMatching(/where\([\s\S]*automation_action_runs\.actionType[\s\S]*ensure_plan_draft[\s\S]*ensure_package_drafts[\s\S]*\)[\s\S]*\.limit\(/),
      ]),
    );
    for (const query of actionRunQueries) {
      expect(query).toContain('.limit(');
    }
  });

  it('honors claim-next project, repo, and scope filters', async () => {
    const repository: DeliveryRepository = new InMemoryDeliveryRepository();

    await repository.createOrReplayAutomationActionRun(
      createActionInput('filter-repo-1', {
        automation_scope: 'repo:project-a:repo-1',
        target_object_id: 'work-item-a',
        idempotency_key: 'filter-repo-1-key',
      }),
    );
    await repository.createOrReplayAutomationActionRun(
      createActionInput('filter-repo-2', {
        automation_scope: 'repo:project-a:repo-2',
        target_object_id: 'work-item-b',
        idempotency_key: 'filter-repo-2-key',
      }),
    );
    await repository.createOrReplayAutomationActionRun(
      createActionInput('filter-project-b', {
        automation_scope: 'repo:project-b:repo-1',
        target_object_id: 'work-item-c',
        idempotency_key: 'filter-project-b-key',
      }),
    );

    await expect(
      repository.claimNextAutomationActionRun({
        now: later,
        claim_token: 'filter-claim',
        locked_until: afterRetry,
        limit: 10,
        project_id: 'project-a',
        repo_id: 'repo-1',
        automation_scope: 'repo:project-a:repo-1',
      }),
    ).resolves.toMatchObject({ id: 'filter-repo-1' });
    await expect(
      repository.claimNextAutomationActionRun({
        now: later,
        claim_token: 'filter-claim-empty',
        locked_until: afterRetry,
        limit: 10,
        project_id: 'project-c',
        repo_id: 'repo-9',
        automation_scope: 'repo:project-c:repo-9',
      }),
    ).resolves.toBeUndefined();
  });

  it('allows only one concurrent claimant to win a pending action', async () => {
    const repository: DeliveryRepository = new InMemoryDeliveryRepository();

    const pending = await repository.createOrReplayAutomationActionRun(createActionInput('concurrent-action'));
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        repository.claimNextAutomationActionRun({
          now: later,
          claim_token: `concurrent-claim-${index}`,
          locked_until: afterRetry,
          limit: 10,
        }),
      ),
    );

    expect(results.filter((result) => result?.id === pending.id)).toHaveLength(1);
  });
});

async function seedPackageGraph(repository: DeliveryRepository): Promise<void> {
  await repository.saveWorkItem({
    id: 'work-item-automation',
    project_id: 'project-automation',
    kind: 'requirement',
    title: 'Automation graph',
    goal: 'Test hold propagation.',
    success_criteria: ['Ancestor holds block packages.'],
    priority: 'P0',
    risk: 'medium',
    driver_actor_id: 'actor-admin',
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

const specWorkItem = (id: string, overrides: Partial<WorkItem> = {}): WorkItem => ({
  id,
  project_id: 'project-automation',
  kind: 'requirement',
  title: `Spec draft target ${id}`,
  goal: 'Create a Spec draft.',
  success_criteria: ['Spec draft exists.'],
  priority: 'p1',
  risk: 'low',
  driver_actor_id: 'actor-admin',
  phase: 'triage',
  activity_state: 'idle',
  gate_state: 'none',
  resolution: 'none',
  created_at: now,
  updated_at: now,
  ...overrides,
});

async function seedSpecEligibilityGraph(repository: DeliveryRepository): Promise<void> {
  await repository.saveProject({
    id: 'project-automation',
    name: 'Automation project',
    repo_ids: ['repo-1'],
    owner_actor_id: 'actor-admin',
    created_at: now,
    updated_at: now,
  });
  await repository.saveProjectRepo({
    id: 'project-repo-automation',
    repo_id: 'repo-1',
    project_id: 'project-automation',
    name: 'repo-1',
    status: 'active',
    local_path: '/workspace/repo-1',
    default_branch: 'main',
    base_commit_sha: 'abc123',
    created_at: now,
    updated_at: now,
  });
  await repository.setAutomationProjectSettings({
    id: 'automation-settings-spec-eligibility',
    project_id: 'project-automation',
    repo_id: 'repo-1',
    scope_type: 'repo',
    preset: 'draft_only',
    expected_version: 0,
    reason: 'enable Spec draft eligibility',
    evidence_refs: [],
    actor: { actor_id: 'actor-admin', actor_class: 'human_admin' },
    now,
  });
  await repository.saveWorkItem(specWorkItem('work-item-needs-spec'));
}

async function seedPackageEligibilityGraph(repository: DeliveryRepository): Promise<void> {
  await repository.saveProject({
    id: 'project-automation',
    name: 'Automation project',
    repo_ids: ['repo-1'],
    owner_actor_id: 'actor-admin',
    created_at: now,
    updated_at: now,
  });
  await repository.saveProjectRepo({
    id: 'project-repo-automation',
    repo_id: 'repo-1',
    project_id: 'project-automation',
    name: 'repo-1',
    status: 'active',
    local_path: '/workspace/repo-1',
    default_branch: 'main',
    base_commit_sha: 'abc123',
    created_at: now,
    updated_at: now,
  });
  await repository.setAutomationProjectSettings({
    id: 'automation-settings-package-eligibility',
    project_id: 'project-automation',
    repo_id: 'repo-1',
    scope_type: 'repo',
    preset: 'draft_only',
    expected_version: 0,
    reason: 'enable package eligibility',
    evidence_refs: [],
    actor: { actor_id: 'actor-admin', actor_class: 'human_admin' },
    now,
  });
  await repository.saveWorkItem({
    id: 'work-item-automation',
    project_id: 'project-automation',
    kind: 'requirement',
    title: 'Automation graph',
    goal: 'Test package eligibility.',
    success_criteria: ['Ancestor holds block package drafting.'],
    priority: 'P0',
    risk: 'medium',
    driver_actor_id: 'actor-admin',
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
  await repository.saveSpec({
    id: 'spec-automation',
    work_item_id: 'work-item-automation',
    entity_type: 'spec',
    status: 'approved',
    editing_state: 'idle',
    gate_state: 'approved',
    resolution: 'approved',
    current_revision_id: 'spec-revision-automation',
    approved_revision_id: 'spec-revision-automation',
    approved_at: now,
    approved_by_actor_id: 'actor-admin',
    created_at: now,
    updated_at: now,
  });
  await repository.saveSpecRevision({
    id: 'spec-revision-automation',
    spec_id: 'spec-automation',
    work_item_id: 'work-item-automation',
    revision_number: 1,
    summary: 'Spec',
    content: 'Spec',
    background: 'Background',
    goals: ['Test package eligibility'],
    scope_in: ['Automation'],
    scope_out: [],
    acceptance_criteria: ['Eligible package projection is present'],
    risk_notes: [],
    test_strategy_summary: 'Repository tests',
    structured_document: {},
    artifact_refs: [],
    created_at: now,
  });
  await repository.savePlan({
    id: 'plan-automation',
    work_item_id: 'work-item-automation',
    entity_type: 'plan',
    status: 'approved',
    editing_state: 'idle',
    gate_state: 'approved',
    resolution: 'approved',
    current_revision_id: 'plan-revision-automation',
    approved_revision_id: 'plan-revision-automation',
    approved_at: now,
    approved_by_actor_id: 'actor-admin',
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
    dependency_order: [],
    test_matrix: ['pnpm test'],
    risk_mitigations: [],
    rollback_notes: 'Revert',
    structured_document: {},
    artifact_refs: [],
    created_at: now,
  });
}
