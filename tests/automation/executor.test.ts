import { describe, expect, it } from 'vitest';

import { automationPreconditionFingerprint, type AutomationPrecondition } from '../../packages/domain/src/index';
import {
  AutomationHttpError,
  createFakeSpecDraftGenerator,
  executeActionRun,
  executeClaimedAction,
  type AutomationActionResponse,
  type AutomationActionRunRecord,
  type AutomationGenerationWorkItemContextV1,
  type AutomationExecutorClient,
  type EnsureSpecDraftCommandInput,
  type NextAction,
  type SpecDraftGenerator,
} from '../../packages/automation/src/index';

const repoScope = 'repo:project-1:repo-1' as const;

const baseAction = (overrides: Partial<NextAction> = {}): NextAction => ({
  actionType: 'ensure_plan_draft',
  targetObjectType: 'work_item',
  targetObjectId: 'work-item-1',
  targetRevisionId: 'spec-revision-1',
  targetStatus: 'approved',
  automationScope: repoScope,
  automationSettingsVersion: 3,
  capabilityFingerprint: 'capability-fingerprint-1',
  preconditionFingerprint: 'precondition-fingerprint-1',
  idempotencyKey: 'idempotency-key-1',
  actionInputJson: {
    work_item_id: 'work-item-1',
    spec_revision_id: 'spec-revision-1',
  },
  ...overrides,
});

const claimedAction = (overrides: Partial<AutomationActionRunRecord> = {}): AutomationActionRunRecord => ({
  id: 'action-run-1',
  actionType: 'ensure_plan_draft',
  targetObjectType: 'work_item',
  targetObjectId: 'work-item-1',
  targetRevisionId: 'spec-revision-1',
  targetStatus: 'approved',
  idempotencyKey: 'idempotency-key-1',
  automationScope: repoScope,
  automationSettingsVersion: 3,
  capabilityFingerprint: 'capability-fingerprint-1',
  preconditionFingerprint: 'precondition-fingerprint-1',
  actionInputJson: {
    work_item_id: 'persisted-work-item',
    spec_revision_id: 'persisted-spec-revision',
  },
  status: 'running',
  attempt: 1,
  claimToken: 'claim-token-1',
  ...overrides,
});

const claimedSpecDraftAction = (overrides: Partial<AutomationActionRunRecord> = {}): AutomationActionRunRecord =>
  claimedAction({
    actionType: 'ensure_spec_draft',
    targetObjectType: 'work_item',
    targetObjectId: 'work-item-1',
    targetRevisionId: undefined,
    targetStatus: 'triage',
    actionInputJson: {
      work_item_id: 'work-item-1',
    },
    ...overrides,
  });

const specDraftContext = (): AutomationGenerationWorkItemContextV1 => ({
  context_version: 'generation_context.work_item.v1',
  action_run_id: 'action-run-1',
  work_item: {
    id: 'work-item-1',
    project_id: 'project-1',
    title: 'Spec draft work item',
    goal: 'Ship the spec draft path',
    success_criteria: ['Draft spec exists'],
    risk: 'low',
    priority: 'high',
    kind: 'initiative',
  },
  repos: [
    {
      project_id: 'project-1',
      repo_id: 'repo-1',
      default_branch: 'main',
      policy_status: 'missing',
    },
  ],
});

const commandPreconditionFor = (action: AutomationActionRunRecord): AutomationPrecondition =>
  ({
    automation_scope: action.automationScope,
    project_id: 'project-1',
    repo_id: 'repo-1',
    target_object_type: action.targetObjectType,
    target_object_id: action.targetObjectId,
    ...(action.targetRevisionId === undefined ? {} : { target_revision_id: action.targetRevisionId }),
    ...(action.targetVersion === undefined ? {} : { target_version: action.targetVersion }),
    target_status: action.targetStatus,
    automation_settings_version: action.automationSettingsVersion,
    capability_fingerprint: action.capabilityFingerprint,
    required_capability:
      action.actionType === 'ensure_spec_draft'
        ? 'canGenerateSpecDraft'
        : action.actionType === 'ensure_package_drafts' || action.targetObjectType === 'plan_revision'
        ? 'canGeneratePackageDrafts'
        : 'canGeneratePlanDraft',
    actor_class: 'automation_daemon',
  }) as AutomationPrecondition;

class FakeAutomationClient implements AutomationExecutorClient {
  readonly calls: Array<{ method: string; args: unknown[] }> = [];
  actionToClaim: AutomationActionRunRecord | null = claimedAction();
  createOrReplayResponse?: AutomationActionResponse;
  commandError?: AutomationHttpError;
  contextError?: AutomationHttpError;

  async createOrReplayAction(action: NextAction) {
    this.calls.push({ method: 'createOrReplayAction', args: [action] });
    if (this.createOrReplayResponse !== undefined) {
      return this.createOrReplayResponse;
    }
    return { action: { ...claimedAction(), status: 'pending' as const } };
  }

  async claimNextAction(input: { claimToken: string; leaseMs?: number; limit?: number; automationScope?: string }) {
    this.calls.push({ method: 'claimNextAction', args: [input] });
    return { action: this.actionToClaim };
  }

  async completeAction(actionRunId: string, input: Record<string, unknown>) {
    this.calls.push({ method: 'completeAction', args: [actionRunId, input] });
    return { action: this.actionToClaim === null ? null : { ...this.actionToClaim, status: 'succeeded' as const } };
  }

  async gatePendingAction(actionRunId: string, input: Record<string, unknown>) {
    this.calls.push({ method: 'gatePendingAction', args: [actionRunId, input] });
    return { action: this.actionToClaim === null ? null : { ...this.actionToClaim, status: 'gate_pending' as const } };
  }

  async blockAction(actionRunId: string, input: Record<string, unknown>) {
    this.calls.push({ method: 'blockAction', args: [actionRunId, input] });
    return { action: this.actionToClaim === null ? null : { ...this.actionToClaim, status: 'blocked' as const } };
  }

  async failAction(actionRunId: string, input: Record<string, unknown>) {
    this.calls.push({ method: 'failAction', args: [actionRunId, input] });
    return { action: this.actionToClaim === null ? null : { ...this.actionToClaim, status: 'failed' as const } };
  }

  async ensurePlanDraft(workItemId: string, input: Record<string, unknown>) {
    this.calls.push({ method: 'ensurePlanDraft', args: [workItemId, input] });
    if (this.commandError !== undefined) {
      throw this.commandError;
    }
    return { status: 'created' };
  }

  async ensurePackageDrafts(planRevisionId: string, input: Record<string, unknown>) {
    this.calls.push({ method: 'ensurePackageDrafts', args: [planRevisionId, input] });
    if (this.commandError !== undefined) {
      throw this.commandError;
    }
    return { status: 'created' };
  }

  async specDraftGenerationContext(workItemId: string, input: { actionRunId: string; claimToken: string }) {
    this.calls.push({ method: 'specDraftGenerationContext', args: [workItemId, input] });
    if (this.contextError !== undefined) {
      throw this.contextError;
    }
    return specDraftContext();
  }

  async ensureSpecDraft(workItemId: string, input: EnsureSpecDraftCommandInput) {
    this.calls.push({ method: 'ensureSpecDraft', args: [workItemId, input] });
    if (this.commandError !== undefined) {
      throw this.commandError;
    }
    return { status: 'created', spec_id: 'spec-1', spec_revision_id: 'spec-revision-1' };
  }

  async requestManualPathHold(input: Record<string, unknown>) {
    this.calls.push({ method: 'requestManualPathHold', args: [input] });
    if (this.commandError !== undefined) {
      throw this.commandError;
    }
    return { status: 'active' };
  }
}

describe('spec draft generation fixtures', () => {
  it('creates schema-versioned fake Spec drafts from public WorkItem context', async () => {
    const result = await createFakeSpecDraftGenerator().generateSpecDraft(specDraftContext());

    expect(result).toMatchObject({
      generated: {
        schema_version: 'spec_draft.v1',
        summary: 'Draft spec for Spec draft work item',
        goals: ['Ship the spec draft path'],
        acceptance_criteria: ['Draft spec exists'],
      },
      generationArtifacts: [],
    });
  });
});

const execute = (client: FakeAutomationClient, action: NextAction = baseAction()) =>
  executeClaimedAction({
    client,
    action,
    claimToken: 'claim-token-1',
    actorId: 'daemon-actor',
  });

describe('automation executor', () => {
  it('creates or replays an action before claiming it', async () => {
    const client = new FakeAutomationClient();

    await execute(client);

    expect(client.calls.map((call) => call.method).slice(0, 2)).toEqual(['createOrReplayAction', 'claimNextAction']);
  });

  it('calls the ensure plan draft endpoint with persisted action input and claim binding fields', async () => {
    const client = new FakeAutomationClient();
    client.actionToClaim = claimedAction({
      actionInputJson: {
        work_item_id: 'persisted-work-item',
        spec_revision_id: 'persisted-spec-revision',
      },
    });

    await execute(client, baseAction({ targetObjectId: 'stale-next-action-work-item' }));

    const ensureCall = client.calls.find((call) => call.method === 'ensurePlanDraft');
    expect(ensureCall?.args).toEqual([
      'persisted-work-item',
      expect.objectContaining({
        action_run_id: 'action-run-1',
        claim_token: 'claim-token-1',
        idempotency_key: 'idempotency-key-1',
        spec_revision_id: 'persisted-spec-revision',
        automation_precondition: expect.objectContaining({
          automation_scope: repoScope,
          project_id: 'project-1',
          repo_id: 'repo-1',
          required_capability: 'canGeneratePlanDraft',
          actor_class: 'automation_daemon',
        }),
      }),
    ]);
  });

  it('sends a command precondition whose fingerprint matches the claimed target-aware action identity', async () => {
    const client = new FakeAutomationClient();
    const action = claimedAction({ targetVersion: 7 });
    const expectedPreconditionFingerprint = automationPreconditionFingerprint(commandPreconditionFor(action));
    client.actionToClaim = {
      ...action,
      preconditionFingerprint: expectedPreconditionFingerprint,
    };

    await execute(client);

    const ensureCall = client.calls.find((call) => call.method === 'ensurePlanDraft');
    const commandInput = ensureCall?.args[1] as { automation_precondition?: AutomationPrecondition } | undefined;
    expect(commandInput?.automation_precondition).toMatchObject({
      target_object_type: 'work_item',
      target_object_id: 'work-item-1',
      target_revision_id: 'spec-revision-1',
      target_version: 7,
      target_status: 'approved',
    });
    expect(automationPreconditionFingerprint(commandInput?.automation_precondition as AutomationPrecondition)).toBe(
      expectedPreconditionFingerprint,
    );
  });

  it('treats replayed succeeded actions as complete without claiming or re-entering commands', async () => {
    const client = new FakeAutomationClient();
    client.actionToClaim = null;
    client.createOrReplayResponse = {
      action: { ...claimedAction({ status: 'succeeded' }), status: 'succeeded' },
    };

    const result = await execute(client);

    expect(result).toEqual({ actionRunId: 'action-run-1', status: 'succeeded', retryable: false });
    expect(client.calls.map((call) => call.method)).toEqual(['createOrReplayAction']);
  });

  it('routes ensure_package_drafts to the plan revision package endpoint', async () => {
    const client = new FakeAutomationClient();
    client.actionToClaim = claimedAction({
      actionType: 'ensure_package_drafts',
      targetObjectType: 'plan_revision',
      targetObjectId: 'plan-revision-1',
      targetRevisionId: 'default:plan-revision-1',
      actionInputJson: {
        plan_revision_id: 'plan-revision-1',
        generation_key: 'default:plan-revision-1',
      },
    });

    await execute(
      client,
      baseAction({
        actionType: 'ensure_package_drafts',
        targetObjectType: 'plan_revision',
        targetObjectId: 'plan-revision-1',
        targetRevisionId: 'default:plan-revision-1',
        actionInputJson: {
          plan_revision_id: 'plan-revision-1',
          generation_key: 'default:plan-revision-1',
        },
      }),
    );

    expect(client.calls.find((call) => call.method === 'ensurePackageDrafts')?.args).toEqual([
      'plan-revision-1',
      expect.objectContaining({
        action_run_id: 'action-run-1',
        generation_key: 'default:plan-revision-1',
      }),
    ]);
  });

  it('executes claimed Spec draft actions with fake generation and completes the action', async () => {
    const client = new FakeAutomationClient();
    const action = claimedSpecDraftAction();

    const result = await executeActionRun({
      client,
      action,
      actorId: 'daemon-actor',
      daemonIdentity: 'daemon-1',
      specDraftGenerator: createFakeSpecDraftGenerator(),
    });

    expect(result).toMatchObject({ actionRunId: 'action-run-1', status: 'succeeded', retryable: false });
    expect(client.calls.map((call) => call.method)).toEqual([
      'specDraftGenerationContext',
      'ensureSpecDraft',
      'completeAction',
    ]);
    const ensureCall = client.calls.find((call) => call.method === 'ensureSpecDraft');
    expect(ensureCall?.args).toEqual([
      'work-item-1',
      expect.objectContaining({
        action_run_id: 'action-run-1',
        claim_token: 'claim-token-1',
        idempotency_key: 'idempotency-key-1',
        generated_spec_draft: expect.objectContaining({ schema_version: 'spec_draft.v1' }),
        generation_artifacts: [],
        automation_precondition: expect.objectContaining({
          required_capability: 'canGenerateSpecDraft',
          target_object_type: 'work_item',
          target_object_id: 'work-item-1',
          target_status: 'triage',
        }),
      }),
    ]);
  });

  it('blocks Spec draft actions when generation is disabled', async () => {
    const client = new FakeAutomationClient();

    const result = await executeActionRun({
      client,
      action: claimedSpecDraftAction(),
      actorId: 'daemon-actor',
      daemonIdentity: 'daemon-1',
    });

    expect(result).toMatchObject({ actionRunId: 'action-run-1', status: 'blocked', retryable: false, reasonCode: 'generation_disabled' });
    expect(client.calls.map((call) => call.method)).not.toContain('ensureSpecDraft');
    expect(client.calls.find((call) => call.method === 'blockAction')?.args).toEqual([
      'action-run-1',
      expect.objectContaining({
        claim_token: 'claim-token-1',
        idempotency_key: 'idempotency-key-1',
        retryable: false,
        result_json: { status: 422, code: 'generation_disabled' },
      }),
    ]);
  });

  it('blocks invalid generated Spec draft payloads before calling the command endpoint', async () => {
    const client = new FakeAutomationClient();
    const invalidGenerator: SpecDraftGenerator = {
      mode: 'fake',
      async generateSpecDraft() {
        return { generated: { schema_version: 'spec_draft.v1' }, generationArtifacts: [] };
      },
    };

    const result = await executeActionRun({
      client,
      action: claimedSpecDraftAction(),
      actorId: 'daemon-actor',
      daemonIdentity: 'daemon-1',
      specDraftGenerator: invalidGenerator,
    });

    expect(result).toMatchObject({
      actionRunId: 'action-run-1',
      status: 'blocked',
      retryable: false,
      reasonCode: 'generated_spec_draft_invalid',
    });
    expect(client.calls.map((call) => call.method)).toContain('specDraftGenerationContext');
    expect(client.calls.map((call) => call.method)).not.toContain('ensureSpecDraft');
  });

  it('fails retryably when Spec draft generation context transport fails', async () => {
    const client = new FakeAutomationClient();
    client.contextError = new AutomationHttpError(503, { code: 'context_unavailable', raw_prompt: 'must-not-leak' });

    const result = await executeActionRun({
      client,
      action: claimedSpecDraftAction(),
      actorId: 'daemon-actor',
      daemonIdentity: 'daemon-1',
      specDraftGenerator: createFakeSpecDraftGenerator(),
    });

    expect(result).toMatchObject({ actionRunId: 'action-run-1', status: 'failed', retryable: true, reasonCode: 'context_unavailable' });
    const failCall = client.calls.find((call) => call.method === 'failAction');
    expect(JSON.stringify(failCall)).not.toContain('must-not-leak');
    expect(failCall?.args).toEqual([
      'action-run-1',
      expect.objectContaining({
        retryable: true,
        result_json: { status: 503, code: 'context_unavailable' },
      }),
    ]);
  });

  it('binds package draft commands to the generation key in the target-aware precondition', async () => {
    const client = new FakeAutomationClient();
    const expectedPrecondition = {
      automation_scope: repoScope,
      project_id: 'project-1',
      repo_id: 'repo-1',
      target_object_type: 'plan_revision',
      target_object_id: 'plan-revision-1',
      target_revision_id: 'retry:plan-revision-1',
      target_status: 'approved',
      automation_settings_version: 3,
      capability_fingerprint: 'capability-fingerprint-1',
      required_capability: 'canGeneratePackageDrafts',
      command_concurrency_token: 'retry:plan-revision-1',
      actor_class: 'automation_daemon',
    } as AutomationPrecondition;
    client.actionToClaim = claimedAction({
      actionType: 'ensure_package_drafts',
      targetObjectType: 'plan_revision',
      targetObjectId: 'plan-revision-1',
      targetRevisionId: 'retry:plan-revision-1',
      targetStatus: 'approved',
      preconditionFingerprint: automationPreconditionFingerprint(expectedPrecondition),
      actionInputJson: {
        plan_revision_id: 'plan-revision-1',
        generation_key: 'retry:plan-revision-1',
      },
    });

    await execute(
      client,
      baseAction({
        actionType: 'ensure_package_drafts',
        targetObjectType: 'plan_revision',
        targetObjectId: 'plan-revision-1',
      }),
    );

    const ensureCall = client.calls.find((call) => call.method === 'ensurePackageDrafts');
    const commandInput = ensureCall?.args[1] as { automation_precondition?: AutomationPrecondition } | undefined;
    expect(commandInput?.automation_precondition).toMatchObject({
      command_concurrency_token: 'retry:plan-revision-1',
    });
    expect(automationPreconditionFingerprint(commandInput?.automation_precondition as AutomationPrecondition)).toBe(
      automationPreconditionFingerprint(expectedPrecondition),
    );
  });

  it('maps stale preconditions to gate_pending', async () => {
    const client = new FakeAutomationClient();
    client.commandError = new AutomationHttpError(409, { code: 'automation_precondition_stale' });

    const result = await execute(client);

    expect(result).toMatchObject({ actionRunId: 'action-run-1', status: 'gate_pending', retryable: true });
    expect(client.calls.find((call) => call.method === 'gatePendingAction')?.args).toEqual([
      'action-run-1',
      expect.objectContaining({
        claim_token: 'claim-token-1',
        idempotency_key: 'idempotency-key-1',
        reason: 'automation_precondition_stale',
      }),
    ]);
  });

  it('binds manual path commands to the scope and reason concurrency token', async () => {
    const client = new FakeAutomationClient();
    const expectedPrecondition = {
      automation_scope: repoScope,
      project_id: 'project-1',
      repo_id: 'repo-1',
      target_object_type: 'work_item',
      target_object_id: 'work-item-ambiguous',
      target_revision_id: 'spec-revision-ambiguous',
      target_status: 'approved',
      automation_settings_version: 3,
      capability_fingerprint: 'capability-fingerprint-1',
      required_capability: 'canGeneratePlanDraft',
      command_concurrency_token: 'work_item:work-item-ambiguous:multi_repo_ambiguity',
      actor_class: 'automation_daemon',
    } as AutomationPrecondition;
    client.actionToClaim = claimedAction({
      actionType: 'request_manual_path',
      targetObjectType: 'work_item',
      targetObjectId: 'work-item-ambiguous',
      targetRevisionId: 'spec-revision-ambiguous',
      targetStatus: 'approved',
      preconditionFingerprint: automationPreconditionFingerprint(expectedPrecondition),
      actionInputJson: {
        object_type: 'work_item',
        object_id: 'work-item-ambiguous',
        scope_key: 'work_item:work-item-ambiguous',
        reason_code: 'multi_repo_ambiguity',
        reason: 'Choose the canonical repository path manually.',
      },
    });

    await execute(
      client,
      baseAction({
        actionType: 'request_manual_path',
        targetObjectType: 'work_item',
        targetObjectId: 'work-item-ambiguous',
        targetRevisionId: 'spec-revision-ambiguous',
      }),
    );

    const manualPathCall = client.calls.find((call) => call.method === 'requestManualPathHold');
    const commandInput = manualPathCall?.args[0] as { automation_precondition?: AutomationPrecondition } | undefined;
    expect(commandInput?.automation_precondition).toMatchObject({
      target_revision_id: 'spec-revision-ambiguous',
      command_concurrency_token: 'work_item:work-item-ambiguous:multi_repo_ambiguity',
    });
    expect(automationPreconditionFingerprint(commandInput?.automation_precondition as AutomationPrecondition)).toBe(
      automationPreconditionFingerprint(expectedPrecondition),
    );
  });

  it('maps active holds to blocked', async () => {
    const client = new FakeAutomationClient();
    client.commandError = new AutomationHttpError(422, { code: 'manual_path_hold_active' });

    const result = await execute(client);

    expect(result).toMatchObject({ actionRunId: 'action-run-1', status: 'blocked', retryable: false });
    expect(client.calls.find((call) => call.method === 'blockAction')?.args).toEqual([
      'action-run-1',
      expect.objectContaining({
        claim_token: 'claim-token-1',
        idempotency_key: 'idempotency-key-1',
        retryable: false,
      }),
    ]);
  });

  it('maps blocked gates and automation holds to blocked', async () => {
    for (const code of ['automation_gate_blocked', 'automation_hold_active']) {
      const client = new FakeAutomationClient();
      client.commandError = new AutomationHttpError(422, { code });

      const result = await execute(client);

      expect(result).toMatchObject({ actionRunId: 'action-run-1', status: 'blocked', retryable: false, reasonCode: code });
      expect(client.calls.find((call) => call.method === 'blockAction')?.args).toEqual([
        'action-run-1',
        expect.objectContaining({
          claim_token: 'claim-token-1',
          idempotency_key: 'idempotency-key-1',
          retryable: false,
        }),
      ]);
      expect(client.calls.map((call) => call.method)).not.toContain('failAction');
    }
  });

  it('maps idempotency conflicts to failed with retryable=false', async () => {
    const client = new FakeAutomationClient();
    client.commandError = new AutomationHttpError(409, { code: 'command_idempotency_conflict' });

    const result = await execute(client);

    expect(result).toMatchObject({ actionRunId: 'action-run-1', status: 'failed', retryable: false });
    expect(client.calls.find((call) => call.method === 'failAction')?.args).toEqual([
      'action-run-1',
      expect.objectContaining({
        claim_token: 'claim-token-1',
        idempotency_key: 'idempotency-key-1',
        retryable: false,
      }),
    ]);
  });

  it('fails malformed plan draft action input before calling command endpoints', async () => {
    const client = new FakeAutomationClient();
    client.actionToClaim = claimedAction({
      actionInputJson: {
        work_item_id: 'persisted-work-item',
      },
    });

    const result = await execute(client);

    expect(result).toMatchObject({
      actionRunId: 'action-run-1',
      status: 'failed',
      retryable: false,
      reasonCode: 'invalid_action_input_json',
    });
    expect(client.calls.map((call) => call.method)).not.toContain('ensurePlanDraft');
    expect(client.calls.find((call) => call.method === 'failAction')?.args).toEqual([
      'action-run-1',
      expect.objectContaining({
        claim_token: 'claim-token-1',
        idempotency_key: 'idempotency-key-1',
        retryable: false,
        result_json: {
          status: 422,
          code: 'invalid_action_input_json',
        },
      }),
    ]);
  });

  it('fails malformed project runtime snapshot input instead of completing synthesized projection data', async () => {
    const client = new FakeAutomationClient();
    client.actionToClaim = claimedAction({
      actionType: 'project_runtime_snapshot',
      targetObjectType: 'repo',
      targetObjectId: 'repo-1',
      targetRevisionId: undefined,
      targetStatus: 'loaded',
      actionInputJson: {
        repo_id: 'repo-1',
        policy_status: 'loaded',
      },
    });

    const result = await execute(
      client,
      baseAction({
        actionType: 'project_runtime_snapshot',
        targetObjectType: 'repo',
        targetObjectId: 'repo-1',
        targetStatus: 'loaded',
        actionInputJson: {
          repo_id: 'repo-1',
          policy_status: 'loaded',
          parser_version: 'workflow-md-parser:v1',
        },
      }),
    );

    expect(result).toMatchObject({
      actionRunId: 'action-run-1',
      status: 'failed',
      retryable: false,
      reasonCode: 'invalid_action_input_json',
    });
    expect(client.calls.map((call) => call.method)).not.toContain('completeAction');
    expect(client.calls.find((call) => call.method === 'failAction')?.args).toEqual([
      'action-run-1',
      expect.objectContaining({
        claim_token: 'claim-token-1',
        idempotency_key: 'idempotency-key-1',
        retryable: false,
      }),
    ]);
  });

  it('completes project_runtime_snapshot without calling draft commands and only uses current public-safe observation fields', async () => {
    const client = new FakeAutomationClient();
    client.actionToClaim = claimedAction({
      actionType: 'project_runtime_snapshot',
      targetObjectType: 'repo',
      targetObjectId: 'repo-1',
      targetRevisionId: undefined,
      targetStatus: 'loaded',
      actionInputJson: {
        repo_id: 'repo-1',
        policy_status: 'loaded',
        policy_digest: 'workflow-digest-1',
        parser_version: 'workflow-md-parser:v1',
        reason_code: 'loaded',
        observed_at: '2026-05-15T00:00:01.000Z',
        last_known_good_policy_digest: 'must-not-copy',
      },
    });

    const result = await execute(
      client,
      baseAction({
        actionType: 'project_runtime_snapshot',
        targetObjectType: 'repo',
        targetObjectId: 'repo-1',
        targetStatus: 'loaded',
        actionInputJson: {
          repo_id: 'repo-1',
          policy_status: 'loaded',
          policy_digest: 'workflow-digest-1',
          parser_version: 'workflow-md-parser:v1',
          reason_code: 'loaded',
        },
      }),
    );

    expect(result).toMatchObject({ actionRunId: 'action-run-1', status: 'succeeded', retryable: false });
    expect(client.calls.map((call) => call.method)).not.toContain('ensurePlanDraft');
    expect(client.calls.map((call) => call.method)).not.toContain('ensurePackageDrafts');
    expect(client.calls.find((call) => call.method === 'completeAction')?.args).toEqual([
      'action-run-1',
      {
        claim_token: 'claim-token-1',
        idempotency_key: 'idempotency-key-1',
        result_json: {
          repo_id: 'repo-1',
          policy_status: 'loaded',
          policy_digest: 'workflow-digest-1',
          parser_version: 'workflow-md-parser:v1',
          reason_code: 'loaded',
          observed_at: '2026-05-15T00:00:01.000Z',
        },
      },
    ]);
  });

  it('never calls run enqueue', async () => {
    const client = new FakeAutomationClient();

    await execute(client);

    expect(JSON.stringify(client.calls)).not.toContain('enqueue');
  });
});
