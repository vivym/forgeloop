import { describe, expect, it } from 'vitest';

import { automationPreconditionFingerprint, type AutomationPrecondition } from '../../packages/domain/src/index';
import {
  createFakeSpecDraft,
  type CodexGenerationRuntime,
  type GeneratedPlanDraftV1,
  type GeneratedSpecDraftV1,
} from '../../packages/codex-runtime/src/index';
import {
  AutomationHttpError,
  executeActionRun,
  executeClaimedAction,
  type AutomationActionResponse,
  type AutomationActionRunRecord,
  type AutomationGenerationPlanningConfig,
  type AutomationGenerationWorkItemContextV1,
  type AutomationExecutorClient,
  type EnsureSpecDraftCommandInput,
  type NextAction,
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
  planContext?: Awaited<ReturnType<FakeAutomationClient['planDraftGenerationContext']>>;

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

  async planDraftGenerationContext(
    workItemId: string,
    input: { specRevisionId: string; actionRunId: string; claimToken: string },
  ) {
    this.calls.push({ method: 'planDraftGenerationContext', args: [workItemId, input] });
    if (this.contextError !== undefined) {
      throw this.contextError;
    }
    return this.planContext ?? {
      context_version: 'generation_context.plan.v1' as const,
      action_run_id: input.actionRunId,
      work_item: {
        id: workItemId,
        project_id: 'project-1',
        title: 'Draft generated spec',
        goal: 'Create a deterministic spec draft',
        success_criteria: ['Spec draft command is submitted'],
        risk: 'low',
        priority: 'P1',
        kind: 'requirement',
      },
      spec_revision: {
        id: input.specRevisionId,
        spec_id: 'spec-1',
        summary: 'Approved spec',
        content: 'Approved spec body',
        background: 'Existing tests cover executor wiring',
        goals: ['Generate a plan draft'],
        scope_in: ['Plan draft generation'],
        scope_out: ['Executor behavior change'],
        acceptance_criteria: ['Plan context is available'],
        risk_notes: [],
        test_strategy_summary: 'Executor unit tests',
        structured_document: { sections: ['approved-spec'] },
      },
      repos: [
        {
          project_id: 'project-1',
          repo_id: 'repo-1',
          default_branch: 'main',
          policy_status: 'loaded',
          policy_digest: 'sha256:workflow-policy-digest',
          parser_version: 'workflow-md-parser:v1',
        },
      ],
    };
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

const validPlanGenerationContext = (): Awaited<ReturnType<FakeAutomationClient['planDraftGenerationContext']>> => ({
  context_version: 'generation_context.plan.v1',
  action_run_id: 'action-run-1',
  work_item: {
    id: 'work-item-1',
    project_id: 'project-1',
    title: 'Draft generated plan',
    goal: 'Create a deterministic plan draft',
    success_criteria: ['Plan draft command is submitted'],
    risk: 'low',
    priority: 'P1',
    kind: 'requirement',
  },
  spec_revision: {
    id: 'spec-revision-1',
    spec_id: 'spec-1',
    summary: 'Approved spec',
    content: 'Approved spec body',
    background: 'Existing tests cover executor wiring',
    goals: ['Generate a plan draft'],
    scope_in: ['Plan draft generation'],
    scope_out: ['Executor behavior change'],
    acceptance_criteria: ['Plan context is available'],
    risk_notes: [],
    test_strategy_summary: 'Executor unit tests',
    structured_document: { sections: ['approved-spec'] },
  },
  repos: [
    {
      project_id: 'project-1',
      repo_id: 'repo-1',
      default_branch: 'main',
      policy_status: 'loaded',
      policy_digest: 'sha256:workflow-policy-digest',
      parser_version: 'workflow-md-parser:v1',
    },
  ],
});

const validGeneratedPlanDraft = (overrides: Partial<GeneratedPlanDraftV1> = {}): GeneratedPlanDraftV1 => ({
  schema_version: 'plan_draft.v1',
  summary: 'Generated plan summary',
  content: 'Generated plan body',
  implementation_summary: 'Implement the approved spec through command boundaries.',
  split_strategy: 'Create one API package and one test package.',
  dependency_order: ['api', 'tests'],
  test_matrix: ['pnpm test tests/api', 'pnpm test tests/automation'],
  risk_mitigations: ['Keep the command boundary narrow.'],
  rollback_notes: 'Revert the generated plan draft.',
  structured_document: { generated_by: 'test' },
  ...overrides,
});

const validGeneratedSpecDraft = (overrides: Partial<GeneratedSpecDraftV1> = {}): GeneratedSpecDraftV1 => ({
  schema_version: 'spec_draft.v1',
  summary: 'Generated spec summary',
  content: 'Generated spec body',
  background: 'Spec generation runtime context',
  goals: ['Generate a spec draft'],
  scope_in: ['Spec draft generation'],
  scope_out: ['Submitting or approving specs'],
  acceptance_criteria: ['Spec draft command is submitted'],
  risk_notes: ['Keep human gates intact'],
  test_strategy_summary: 'Executor unit tests',
  structured_document: { generated_by: 'test' },
  ...overrides,
});

const fakeGenerationRuntimeReturning = (
  result: Awaited<ReturnType<CodexGenerationRuntime['generatePlanDraft']>>,
  inputs: unknown[] = [],
): CodexGenerationRuntime => ({
  async generateSpecDraft() {
    throw new Error('unexpected_spec_generation');
  },
  async generatePlanDraft(input) {
    inputs.push(input);
    return result;
  },
  async generatePackageDrafts() {
    throw new Error('unexpected_package_generation');
  },
});

const fakeSpecGenerationRuntimeReturning = (
  result: Awaited<ReturnType<CodexGenerationRuntime['generateSpecDraft']>>,
  inputs: unknown[] = [],
): CodexGenerationRuntime => ({
  async generateSpecDraft(input) {
    inputs.push(input);
    return result;
  },
  async generatePlanDraft() {
    throw new Error('unexpected_plan_generation');
  },
  async generatePackageDrafts() {
    throw new Error('unexpected_package_generation');
  },
});

const defaultPlanGenerationRuntime = (): CodexGenerationRuntime =>
  fakeGenerationRuntimeReturning({
    taskKind: 'plan_draft',
    promptVersion: 'plan-draft.fake.v1',
    outputSchemaVersion: 'plan_draft.v1',
    generated: validGeneratedPlanDraft(),
    generationArtifacts: [],
    publicSummary: 'Plan generated.',
  });

const generationPlanning = (overrides: {
  spec_draft?: Partial<AutomationGenerationPlanningConfig['tasks']['spec_draft']>;
  plan_draft?: Partial<AutomationGenerationPlanningConfig['tasks']['plan_draft']>;
  package_drafts?: Partial<AutomationGenerationPlanningConfig['tasks']['package_drafts']>;
} = {}): AutomationGenerationPlanningConfig => ({
  mode: 'fake',
  tasks: {
    spec_draft: {
      enabled: true,
      promptVersion: 'spec-draft.fake.v1',
      outputSchemaVersion: 'spec_draft.v1',
      ...overrides.spec_draft,
    },
    plan_draft: {
      enabled: true,
      promptVersion: 'plan-draft.fake.v1',
      outputSchemaVersion: 'plan_draft.v1',
      ...overrides.plan_draft,
    },
    package_drafts: {
      enabled: false,
      promptVersion: 'package-drafts.fake.v1',
      outputSchemaVersion: 'package_drafts.v1',
      ...overrides.package_drafts,
    },
  },
});

const planGenerationPlanning = (
  overrides: Partial<AutomationGenerationPlanningConfig['tasks']['plan_draft']> = {},
): AutomationGenerationPlanningConfig => generationPlanning({ spec_draft: { enabled: false }, plan_draft: overrides });

describe('spec draft generation fixtures', () => {
  it('creates schema-versioned fake Spec drafts from public WorkItem context', async () => {
    const result = createFakeSpecDraft(specDraftContext());

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
    generationRuntime: defaultPlanGenerationRuntime(),
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

  it('generates and sends a Plan draft payload before ensurePlanDraft', async () => {
    const client = new FakeAutomationClient();
    client.planContext = validPlanGenerationContext();
    const runtime = fakeGenerationRuntimeReturning({
      taskKind: 'plan_draft',
      promptVersion: 'plan-draft.fake.v1',
      outputSchemaVersion: 'plan_draft.v1',
      generated: validGeneratedPlanDraft({ summary: 'Generated summary' }),
      generationArtifacts: [
        {
          kind: 'logs',
          name: 'plan-generation.json',
          content_type: 'application/json',
          storage_uri: 'artifact://plan-generation.json',
          digest: 'sha256:plan',
        },
      ],
      publicSummary: 'Plan generated.',
    });

    await executeActionRun({
      client,
      action: claimedAction(),
      actorId: 'actor-automation',
      daemonIdentity: 'daemon-main',
      generationRuntime: runtime,
    });

    expect(client.calls.find((call) => call.method === 'ensurePlanDraft')?.args[1]).toMatchObject({
      generated_plan_draft: { summary: 'Generated summary' },
      generation_artifacts: [
        {
          kind: 'logs',
          name: 'plan-generation.json',
          content_type: 'application/json',
          storage_uri: 'artifact://plan-generation.json',
          digest: 'sha256:plan',
        },
      ],
    });
  });

  it('blocks Plan draft actions when the Plan generation task is disabled', async () => {
    const client = new FakeAutomationClient();

    const result = await executeActionRun({
      client,
      action: claimedAction(),
      actorId: 'actor-automation',
      daemonIdentity: 'daemon-main',
      generationRuntime: defaultPlanGenerationRuntime(),
      generationPlanning: planGenerationPlanning({ enabled: false }),
    });

    expect(result).toMatchObject({ actionRunId: 'action-run-1', status: 'blocked', retryable: false, reasonCode: 'generation_disabled' });
    expect(client.calls.map((call) => call.method)).not.toContain('planDraftGenerationContext');
    expect(client.calls.map((call) => call.method)).not.toContain('ensurePlanDraft');
  });

  it('uses the claimed Plan action prompt and output schema versions for generation', async () => {
    const client = new FakeAutomationClient();
    const runtimeInputs: unknown[] = [];
    const runtime = fakeGenerationRuntimeReturning(
      {
        taskKind: 'plan_draft',
        promptVersion: 'plan-draft.fake.v3',
        outputSchemaVersion: 'plan_draft.v1',
        generated: validGeneratedPlanDraft(),
        generationArtifacts: [],
        publicSummary: 'Plan generated.',
      },
      runtimeInputs,
    );

    await executeActionRun({
      client,
      action: claimedAction({
        actionInputJson: {
          work_item_id: 'persisted-work-item',
          spec_revision_id: 'persisted-spec-revision',
          prompt_version: 'plan-draft.fake.v3',
          output_schema_version: 'plan_draft.v1',
        },
      }),
      actorId: 'actor-automation',
      daemonIdentity: 'daemon-main',
      generationRuntime: runtime,
      generationPlanning: planGenerationPlanning({ promptVersion: 'plan-draft.fake.v2' }),
    });

    expect(runtimeInputs[0]).toMatchObject({
      promptVersion: 'plan-draft.fake.v3',
      outputSchemaVersion: 'plan_draft.v1',
    });
  });

  it('fails retryably when app-server Plan draft output fails schema validation', async () => {
    const client = new FakeAutomationClient();
    client.planContext = validPlanGenerationContext();
    const runtime: CodexGenerationRuntime = {
      async generateSpecDraft() {
        throw new Error('unexpected_spec_generation');
      },
      async generatePlanDraft() {
        throw new Error('generated_output_schema_invalid');
      },
      async generatePackageDrafts() {
        throw new Error('unexpected_package_generation');
      },
    };

    const result = await executeActionRun({
      client,
      action: claimedAction(),
      actorId: 'actor-automation',
      daemonIdentity: 'daemon-main',
      generationRuntime: runtime,
      generationPlanning: planGenerationPlanning(),
    });

    expect(result).toMatchObject({
      actionRunId: 'action-run-1',
      status: 'failed',
      retryable: true,
      reasonCode: 'generated_output_schema_invalid',
    });
    expect(client.calls.map((call) => call.method)).toContain('planDraftGenerationContext');
    expect(client.calls.map((call) => call.method)).not.toContain('ensurePlanDraft');
    expect(client.calls.find((call) => call.method === 'failAction')?.args).toEqual([
      'action-run-1',
      expect.objectContaining({
        retryable: true,
        result_json: { status: 422, code: 'generated_output_schema_invalid' },
      }),
    ]);
    expect(client.calls.map((call) => call.method)).not.toContain('blockAction');
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

  it('blocks ensure_package_drafts until Package runtime wiring is enabled', async () => {
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

    const result = await execute(
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

    expect(result).toMatchObject({
      actionRunId: 'action-run-1',
      status: 'failed',
      retryable: false,
      reasonCode: 'package_generation_runtime_not_wired',
    });
    expect(client.calls.map((call) => call.method)).not.toContain('ensurePackageDrafts');
    expect(client.calls.find((call) => call.method === 'failAction')?.args).toEqual([
      'action-run-1',
      expect.objectContaining({
        retryable: false,
        result_json: { status: 422, code: 'package_generation_runtime_not_wired' },
      }),
    ]);
  });

  it('executes claimed Spec draft actions with fake generation and completes the action', async () => {
    const client = new FakeAutomationClient();
    const action = claimedSpecDraftAction();
    const runtimeInputs: unknown[] = [];
    const runtime = fakeSpecGenerationRuntimeReturning(
      {
        taskKind: 'spec_draft',
        promptVersion: 'spec-draft.fake.v2',
        outputSchemaVersion: 'spec_draft.v1',
        generated: validGeneratedSpecDraft({ summary: 'Runtime-generated spec' }),
        generationArtifacts: [],
        publicSummary: 'Spec generated.',
      },
      runtimeInputs,
    );

    const result = await executeActionRun({
      client,
      action,
      actorId: 'daemon-actor',
      daemonIdentity: 'daemon-1',
      generationRuntime: runtime,
      generationPlanning: generationPlanning({ spec_draft: { promptVersion: 'spec-draft.fake.v2' } }),
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
        generated_spec_draft: expect.objectContaining({ schema_version: 'spec_draft.v1', summary: 'Runtime-generated spec' }),
        generation_artifacts: [],
        automation_precondition: expect.objectContaining({
          required_capability: 'canGenerateSpecDraft',
          target_object_type: 'work_item',
          target_object_id: 'work-item-1',
          target_status: 'triage',
        }),
      }),
    ]);
    expect(runtimeInputs[0]).toMatchObject({
      actionRunId: 'action-run-1',
      projectId: 'project-1',
      repoIds: ['repo-1'],
      promptVersion: 'spec-draft.fake.v2',
      outputSchemaVersion: 'spec_draft.v1',
      policyDigests: {},
    });
  });

  it('uses persisted Spec action prompt and output schema versions for generation', async () => {
    const client = new FakeAutomationClient();
    const runtimeInputs: unknown[] = [];
    const runtime = fakeSpecGenerationRuntimeReturning(
      {
        taskKind: 'spec_draft',
        promptVersion: 'spec-draft.persisted.v1',
        outputSchemaVersion: 'spec_draft.v1',
        generated: validGeneratedSpecDraft(),
        generationArtifacts: [],
        publicSummary: 'Spec generated.',
      },
      runtimeInputs,
    );

    await executeActionRun({
      client,
      action: claimedSpecDraftAction({
        actionInputJson: {
          work_item_id: 'work-item-1',
          prompt_version: 'spec-draft.persisted.v1',
          output_schema_version: 'spec_draft.v1',
        },
      }),
      actorId: 'daemon-actor',
      daemonIdentity: 'daemon-1',
      generationRuntime: runtime,
      generationPlanning: generationPlanning({ spec_draft: { promptVersion: 'spec-draft.planning.v1' } }),
    });

    expect(runtimeInputs[0]).toMatchObject({
      promptVersion: 'spec-draft.persisted.v1',
      outputSchemaVersion: 'spec_draft.v1',
    });
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
    const invalidRuntime: CodexGenerationRuntime = {
      async generateSpecDraft() {
        return {
          taskKind: 'spec_draft',
          promptVersion: 'spec-draft.fake.v1',
          outputSchemaVersion: 'spec_draft.v1',
          generated: { schema_version: 'spec_draft.v1' } as GeneratedSpecDraftV1,
          generationArtifacts: [],
          publicSummary: 'Spec generated.',
        };
      },
      async generatePlanDraft() {
        throw new Error('unexpected_plan_generation');
      },
      async generatePackageDrafts() {
        throw new Error('unexpected_package_generation');
      },
    };

    const result = await executeActionRun({
      client,
      action: claimedSpecDraftAction(),
      actorId: 'daemon-actor',
      daemonIdentity: 'daemon-1',
      generationRuntime: invalidRuntime,
      generationPlanning: generationPlanning(),
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

  it('blocks Spec draft generation when Codex safety enforcement is unavailable', async () => {
    const client = new FakeAutomationClient();
    const unsafeRuntime: CodexGenerationRuntime = {
      async generateSpecDraft() {
        throw new Error('codex_generation_safety_unavailable');
      },
      async generatePlanDraft() {
        throw new Error('unexpected_plan_generation');
      },
      async generatePackageDrafts() {
        throw new Error('unexpected_package_generation');
      },
    };

    const result = await executeActionRun({
      client,
      action: claimedSpecDraftAction(),
      actorId: 'daemon-actor',
      daemonIdentity: 'daemon-1',
      generationRuntime: unsafeRuntime,
      generationPlanning: generationPlanning(),
    });

    expect(result).toMatchObject({
      actionRunId: 'action-run-1',
      status: 'blocked',
      retryable: false,
      reasonCode: 'codex_generation_safety_unavailable',
    });
    expect(client.calls.map((call) => call.method)).toContain('specDraftGenerationContext');
    expect(client.calls.map((call) => call.method)).not.toContain('ensureSpecDraft');
    expect(client.calls.find((call) => call.method === 'blockAction')?.args).toEqual([
      'action-run-1',
      expect.objectContaining({
        retryable: false,
        result_json: { status: 422, code: 'codex_generation_safety_unavailable' },
      }),
    ]);
    expect(client.calls.map((call) => call.method)).not.toContain('failAction');
  });

  it('fails retryably when Spec draft generation context transport fails', async () => {
    const client = new FakeAutomationClient();
    client.contextError = new AutomationHttpError(503, { code: 'context_unavailable', raw_prompt: 'must-not-leak' });

    const result = await executeActionRun({
      client,
      action: claimedSpecDraftAction(),
      actorId: 'daemon-actor',
      daemonIdentity: 'daemon-1',
      generationRuntime: fakeSpecGenerationRuntimeReturning({
        taskKind: 'spec_draft',
        promptVersion: 'spec-draft.fake.v1',
        outputSchemaVersion: 'spec_draft.v1',
        generated: validGeneratedSpecDraft(),
        generationArtifacts: [],
        publicSummary: 'Spec generated.',
      }),
      generationPlanning: generationPlanning(),
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

  it('blocks retry package draft commands while Package runtime wiring is gated', async () => {
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

    const result = await execute(
      client,
      baseAction({
        actionType: 'ensure_package_drafts',
        targetObjectType: 'plan_revision',
        targetObjectId: 'plan-revision-1',
      }),
    );

    expect(result).toMatchObject({
      actionRunId: 'action-run-1',
      status: 'failed',
      retryable: false,
      reasonCode: 'package_generation_runtime_not_wired',
    });
    expect(client.calls.map((call) => call.method)).not.toContain('ensurePackageDrafts');
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
