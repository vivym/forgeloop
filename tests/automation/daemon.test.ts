import { describe, expect, it } from 'vitest';

import { codexCanonicalDigest } from '../../packages/domain/src/index';
import {
  createCodexGenerationRuntime,
  createFakeBoundaryRoundRuntimeResult,
  createFakeGeneratedExecutionPlanRevision,
  createFakeGeneratedSpecRevision,
  createFakePackageDraftSet,
  createFakePlanDraft,
  createFakeSpecDraft,
} from '../../packages/codex-runtime/src/index';
import { generationPlanningForDaemon, loadAutomationDaemonConfig } from '../../apps/automation-daemon/src/config';
import { AutomationDaemon, type AutomationDaemonClient } from '../../apps/automation-daemon/src/automation-daemon';
import {
  createAutomationDaemonGenerationRuntime,
  createLeasedDockerCodexGenerationRuntime,
  createRemoteCodexGenerationRuntime,
} from '../../apps/automation-daemon/src/generation-runtime';
import {
  projectRuntimeSnapshotIdempotencyKey,
  type AutomationGenerationPackageContextV1,
  AutomationHttpError,
  AutomationActionResponse,
  AutomationActionRunRecord,
  BlockActionInput,
  ClaimNextActionInput,
  CompleteActionInput,
  FailActionInput,
  GatePendingActionInput,
  NextAction,
  RuntimeSnapshot,
  WorkflowPolicyDigestStatus,
} from '../../packages/automation/src/index';

const repoScope = 'repo:project-1:repo-1' as const;
const parserVersion = 'workflow-md-parser:v1';

const baseSnapshot = (overrides: Partial<RuntimeSnapshot> = {}): RuntimeSnapshot => ({
  generatedAt: '2026-05-16T00:00:00.000Z',
  projects: [
    {
      projectId: 'project-1',
      automationScope: repoScope,
      automationSettingsVersion: 3,
      capabilityFingerprint: 'capability-fingerprint-1',
    },
  ],
  repos: [
    {
      projectId: 'project-1',
      repoId: 'repo-1',
      automationScope: repoScope,
      automationSettingsVersion: 3,
      capabilityFingerprint: 'capability-fingerprint-1',
      daemonInternalLocalPath: '/workspace/repo-1',
    },
  ],
  planRevisionsRequiringPackages: [],
  runEnqueueDisabledPackages: [],
  activeHolds: [],
  recentActionRuns: [],
  runEnqueueDisabledReason: 'run_enqueue_disabled_by_scope',
  ...overrides,
});

const validEnv = () => ({
  FORGELOOP_CONTROL_PLANE_URL: 'http://127.0.0.1:3000',
  FORGELOOP_TRUSTED_ACTOR_HEADER_SECRET: 'secret-1',
  FORGELOOP_AUTOMATION_DAEMON_IDENTITY: 'daemon-1',
  FORGELOOP_AUTOMATION_ACTOR_ID: 'actor-1',
  FORGELOOP_AUTOMATION_ALLOWED_REPO_ROOTS: ['/workspace'].join(':'),
});

const claimedPackageAction = (overrides: Partial<AutomationActionRunRecord> = {}): AutomationActionRunRecord => ({
  id: 'package-action-run-1',
  actionType: 'ensure_package_drafts',
  targetObjectType: 'plan_revision',
  targetObjectId: 'plan-revision-1',
  targetRevisionId: 'default:plan-revision-1',
  targetStatus: 'approved',
  idempotencyKey: 'package-action-run-1-idempotency',
  automationScope: repoScope,
  automationSettingsVersion: 3,
  capabilityFingerprint: 'capability-fingerprint-1',
  preconditionFingerprint: 'precondition-fingerprint-1',
  actionInputJson: {
    plan_revision_id: 'plan-revision-1',
    generation_key: 'default:plan-revision-1',
  },
  status: 'running',
  attempt: 1,
  claimToken: 'claim-token-1',
  ...overrides,
});

const claimedProjectionAction = (overrides: Partial<AutomationActionRunRecord> = {}): AutomationActionRunRecord => ({
  id: 'projection-action-run-1',
  actionType: 'project_runtime_snapshot',
  targetObjectType: 'repo',
  targetObjectId: 'repo-1',
  targetStatus: 'loaded',
  idempotencyKey: 'projection-action-run-1-idempotency',
  automationScope: repoScope,
  automationSettingsVersion: 3,
  capabilityFingerprint: 'capability-fingerprint-1',
  preconditionFingerprint: 'projection-precondition-fingerprint-1',
  actionInputJson: {
    repo_id: 'repo-1',
    policy_status: 'loaded',
    policy_digest: 'workflow-digest-1',
    parser_version: parserVersion,
  },
  status: 'running',
  attempt: 1,
  claimToken: 'claim-token-1',
  ...overrides,
});

const packageTarget = () => ({
  targetObjectType: 'plan_revision',
  targetObjectId: 'plan-revision-1',
  targetRevisionId: 'default:plan-revision-1',
  targetStatus: 'approved',
  projectId: 'project-1',
  repoId: 'repo-1',
  automationScope: repoScope,
  generationKey: 'default:plan-revision-1',
} as const);

class FakeDaemonClient implements AutomationDaemonClient {
  readonly calls: Array<{ method: string; args: unknown[] }> = [];
  snapshot: RuntimeSnapshot = baseSnapshot();
  actionToClaim: AutomationActionRunRecord | null = claimedPackageAction();

  async runtimeSnapshot(): Promise<RuntimeSnapshot> {
    this.calls.push({ method: 'runtimeSnapshot', args: [] });
    return this.snapshot;
  }

  async createOrReplayAction(action: NextAction): Promise<AutomationActionResponse> {
    this.calls.push({ method: 'createOrReplayAction', args: [action] });
    return { action: { ...claimedPackageAction(), status: 'pending' } };
  }

  async claimNextAction(input: ClaimNextActionInput): Promise<AutomationActionResponse> {
    this.calls.push({ method: 'claimNextAction', args: [input] });
    return { action: this.actionToClaim };
  }

  async completeAction(actionRunId: string, input: CompleteActionInput): Promise<AutomationActionResponse> {
    this.calls.push({ method: 'completeAction', args: [actionRunId, input] });
    return { action: this.actionToClaim === null ? null : { ...this.actionToClaim, status: 'succeeded' } };
  }

  async gatePendingAction(actionRunId: string, input: GatePendingActionInput): Promise<AutomationActionResponse> {
    this.calls.push({ method: 'gatePendingAction', args: [actionRunId, input] });
    return { action: this.actionToClaim === null ? null : { ...this.actionToClaim, status: 'gate_pending' } };
  }

  async blockAction(actionRunId: string, input: BlockActionInput): Promise<AutomationActionResponse> {
    this.calls.push({ method: 'blockAction', args: [actionRunId, input] });
    return { action: this.actionToClaim === null ? null : { ...this.actionToClaim, status: 'blocked' } };
  }

  async failAction(actionRunId: string, input: FailActionInput): Promise<AutomationActionResponse> {
    this.calls.push({ method: 'failAction', args: [actionRunId, input] });
    return { action: this.actionToClaim === null ? null : { ...this.actionToClaim, status: 'failed' } };
  }

  async ensurePackageDrafts(planRevisionId: string, input: Record<string, unknown>): Promise<unknown> {
    this.calls.push({ method: 'ensurePackageDrafts', args: [planRevisionId, input] });
    return { status: 'created' };
  }

  async packageDraftsGenerationContext(
    planRevisionId: string,
    input: { generationKey: string; actionRunId: string; claimToken: string },
  ): Promise<AutomationGenerationPackageContextV1> {
    this.calls.push({ method: 'packageDraftsGenerationContext', args: [planRevisionId, input] });
    return {
      context_version: 'generation_context.package.v1',
      action_run_id: input.actionRunId,
      generation_key: input.generationKey,
      work_item: {
        id: 'work-item-1',
        project_id: 'project-1',
        title: 'Package draft work item',
        goal: 'Ship the package draft path',
        success_criteria: ['Draft packages exist'],
        risk: 'low',
        priority: 'high',
        kind: 'initiative',
      },
      spec_revision: {
        id: input.specRevisionId,
        spec_id: 'spec-1',
        summary: 'Approved spec',
        content: 'Approved spec content',
        background: 'Plan draft generation should use the daemon runtime.',
        goals: ['Generate a Plan draft'],
        scope_in: ['Plan draft command boundary'],
        scope_out: ['Package draft generation'],
        acceptance_criteria: ['Plan draft payload is sent to the command boundary'],
        risk_notes: ['Keep the Plan draft human gated.'],
        test_strategy_summary: 'Run daemon and API command tests.',
        structured_document: { source: 'daemon-test' },
      },
      plan_revision: {
        id: planRevisionId,
        plan_id: 'plan-1',
        summary: 'Approved plan',
        content: 'Approved plan content',
        implementation_summary: 'Implement packages',
        split_strategy: 'Split into API and tests',
        dependency_order: ['api', 'tests'],
        test_matrix: ['pnpm test'],
        risk_mitigations: ['Keep command boundary narrow.'],
        rollback_notes: 'Revert generated packages.',
        structured_document: { source: 'daemon-test' },
      },
      repos: [
        {
          project_id: 'project-1',
          repo_id: 'repo-1',
          default_branch: 'main',
          policy_status: 'loaded',
          policy_digest: 'workflow-digest-1',
          parser_version: parserVersion,
        },
      ],
      package_policy: {
        allowed_repo_ids: ['repo-1'],
        path_policy_summary: 'apps/control-plane-api/** and tests/** only',
        required_check_policy_summary: 'pnpm test',
        source_mutation_policy_default: 'path_policy_scoped',
      },
    };
  }

  async requestManualPathHold(input: Record<string, unknown>): Promise<unknown> {
    this.calls.push({ method: 'requestManualPathHold', args: [input] });
    return { status: 'active' };
  }
}

const loadedPolicy = (): WorkflowPolicyDigestStatus => ({
  status: 'loaded',
  policyDigest: 'workflow-digest-1',
  parserVersion,
  policyPath: 'WORKFLOW.md',
});

const daemonOptions = (client: AutomationDaemonClient) => ({
  client,
  actorId: 'daemon-actor',
  daemonIdentity: 'daemon-1',
  claimToken: 'claim-token-1',
  allowedRepoRoots: ['/workspace'],
  policyParserVersion: parserVersion,
  policyLoader: async () => loadedPolicy(),
  noClaimBackoffMs: 25,
  loopIntervalMs: 1_000,
});

const generationPlanning = {
  mode: 'fake',
  tasks: {
    package_drafts: { enabled: true, promptVersion: 'package-drafts.fake.v1', outputSchemaVersion: 'package_drafts.v1' },
  },
} as const;

const generatedRemotePackageDrafts = () =>
  ({
    ...createFakePackageDraftSet({
    generation_key: 'default:plan-revision-1',
    plan_revision: { id: 'plan-revision-1', dependency_order: ['api'] },
    repos: [{ repo_id: 'repo-1' }],
    }).generated,
    packages: createFakePackageDraftSet({
      generation_key: 'default:plan-revision-1',
      plan_revision: { id: 'plan-revision-1', dependency_order: ['api'] },
      repos: [{ repo_id: 'repo-1' }],
    }).generated.packages.map((pkg) => ({ ...pkg, allowed_paths: [], forbidden_paths: [] })),
  });

type RemoteGenerationTaskFixture = {
  method:
    | 'generateSpecDraft'
    | 'generatePlanDraft'
    | 'generatePackageDrafts'
    | 'generateBoundaryBrainstormingRound'
    | 'generateDevelopmentPlanItemSpecRevision'
    | 'generateDevelopmentPlanItemExecutionPlanRevision';
  taskKind:
    | 'spec_draft'
    | 'plan_draft'
    | 'package_drafts'
    | 'boundary_brainstorming_round'
    | 'development_plan_item_spec_revision'
    | 'development_plan_item_execution_plan_revision';
  promptVersion: string;
  outputSchemaVersion: string;
  context: Record<string, unknown>;
  generatedPayload: Record<string, unknown>;
};

const remoteGenerationTaskFixtures = (): RemoteGenerationTaskFixture[] => [
  {
    method: 'generateSpecDraft',
    taskKind: 'spec_draft',
    promptVersion: 'spec-draft.remote.v1',
    outputSchemaVersion: 'spec_draft.v1',
    context: {
      work_item: {
        id: 'work-item-1',
        title: 'Remote Spec draft',
        goal: 'Generate a Spec draft through remote runtime',
        success_criteria: ['Spec draft payload exists'],
      },
    },
    generatedPayload: createFakeSpecDraft({
      work_item: {
        id: 'work-item-1',
        title: 'Remote Spec draft',
        goal: 'Generate a Spec draft through remote runtime',
        success_criteria: ['Spec draft payload exists'],
      },
    }).generated,
  },
  {
    method: 'generatePlanDraft',
    taskKind: 'plan_draft',
    promptVersion: 'plan-draft.remote.v1',
    outputSchemaVersion: 'plan_draft.v1',
    context: {
      work_item: {
        id: 'work-item-1',
        title: 'Remote Plan draft',
        goal: 'Generate a Plan draft through remote runtime',
        success_criteria: ['Plan draft payload exists'],
      },
      spec_revision: { id: 'spec-revision-1', risk_notes: ['Keep remote runtime gated'] },
    },
    generatedPayload: {
      ...createFakePlanDraft({
        work_item: {
          id: 'work-item-1',
          title: 'Remote Plan draft',
          goal: 'Generate a Plan draft through remote runtime',
          success_criteria: ['Plan draft payload exists'],
        },
        spec_revision: { id: 'spec-revision-1', risk_notes: ['Keep remote runtime gated'] },
      }).generated,
      dependency_order: ['design-slice', 'validation-slice'],
      test_matrix: ['Focused runtime validation', 'Remote worker validation'],
    },
  },
  {
    method: 'generatePackageDrafts',
    taskKind: 'package_drafts',
    promptVersion: 'package-drafts.remote.v1',
    outputSchemaVersion: 'package_drafts.v1',
    context: { context_version: 'generation_context.package.v1' },
    generatedPayload: generatedRemotePackageDrafts(),
  },
  {
    method: 'generateBoundaryBrainstormingRound',
    taskKind: 'boundary_brainstorming_round',
    promptVersion: 'boundary-round.remote.v1',
    outputSchemaVersion: 'boundary_round_result.v1',
    context: { session_id: 'boundary-session-1', round_id: 'boundary-round-1' },
    generatedPayload: createFakeBoundaryRoundRuntimeResult({
      session_id: 'boundary-session-1',
      round_id: 'boundary-round-1',
    }).generated,
  },
  {
    method: 'generateDevelopmentPlanItemSpecRevision',
    taskKind: 'development_plan_item_spec_revision',
    promptVersion: 'development-plan-item-spec-revision.remote.v1',
    outputSchemaVersion: 'spec_revision.v1',
    context: {
      development_plan_item_id: 'development-plan-item-1',
      approved_boundary_summary_revision_id: 'boundary-summary-revision-1',
    },
    generatedPayload: createFakeGeneratedSpecRevision({
      development_plan_item_id: 'development-plan-item-1',
      approved_boundary_summary_revision_id: 'boundary-summary-revision-1',
    }).generated,
  },
  {
    method: 'generateDevelopmentPlanItemExecutionPlanRevision',
    taskKind: 'development_plan_item_execution_plan_revision',
    promptVersion: 'development-plan-item-execution-plan-revision.remote.v1',
    outputSchemaVersion: 'execution_plan_revision.v1',
    context: {
      development_plan_item_id: 'development-plan-item-1',
      approved_spec_revision_id: 'spec-revision-1',
      allowed_paths: ['docs/**'],
      forbidden_paths: ['.git/**', 'node_modules/**'],
    },
    generatedPayload: {
      ...createFakeGeneratedExecutionPlanRevision({
        development_plan_item_id: 'development-plan-item-1',
        approved_spec_revision_id: 'spec-revision-1',
        allowed_paths: ['docs/**'],
        forbidden_paths: ['.git/**', 'node_modules/**'],
      }).generated,
      validation_strategy: ['Run focused runtime validation', 'Run remote worker validation'],
      required_checks: [
        {
          check_id: 'focused-runtime-validation',
          command: 'pnpm test',
          timeout_seconds: 120,
          blocks_review: true,
        },
      ],
    },
  },
];

describe('automation daemon loop', () => {
  it('loads required config and path-list roots from the environment', () => {
    expect(
      loadAutomationDaemonConfig({
        FORGELOOP_CONTROL_PLANE_URL: 'http://127.0.0.1:3000',
        FORGELOOP_TRUSTED_ACTOR_HEADER_SECRET: 'secret-1',
        FORGELOOP_AUTOMATION_DAEMON_IDENTITY: 'daemon-1',
        FORGELOOP_AUTOMATION_ACTOR_ID: 'actor-1',
        FORGELOOP_AUTOMATION_ALLOWED_REPO_ROOTS: ['/workspace/a', '/workspace/b'].join(':'),
        FORGELOOP_AUTOMATION_LOOP_INTERVAL_MS: '1500',
        FORGELOOP_AUTOMATION_NO_CLAIM_BACKOFF_MS: '250',
      }),
    ).toMatchObject({
      controlPlaneUrl: 'http://127.0.0.1:3000',
      trustedActorHeaderSecret: 'secret-1',
      daemonIdentity: 'daemon-1',
      actorId: 'actor-1',
      allowedRepoRoots: ['/workspace/a', '/workspace/b'],
      loopIntervalMs: 1500,
      noClaimBackoffMs: 250,
      codexAutomationGeneration: 'disabled',
    });
  });

  it('loads legacy generation mode compatibility', () => {
    expect(loadAutomationDaemonConfig(validEnv())).toMatchObject({
      codexAutomationGeneration: 'disabled',
      generationPlanning: { mode: 'disabled' },
    });
    expect(
      loadAutomationDaemonConfig({
        ...validEnv(),
        FORGELOOP_CODEX_AUTOMATION_GENERATION: 'fake',
      }),
    ).toMatchObject({
      codexAutomationGeneration: 'fake',
      generationPlanning: { mode: 'fake' },
    });
    expect(
      loadAutomationDaemonConfig({
        ...validEnv(),
        FORGELOOP_CODEX_AUTOMATION_GENERATION: 'codex',
        FORGELOOP_CODEX_APP_SERVER_ENDPOINT: 'unix:/tmp/forgeloop-codex.sock',
        FORGELOOP_CODEX_GENERATION_ARTIFACT_ROOT: '/tmp/forgeloop-artifacts',
      }),
    ).toMatchObject({
      codexAutomationGeneration: 'app_server',
      generationPlanning: { mode: 'app_server' },
    });
  });

  it('builds an app_server generation runtime from governed runtime config', () => {
    const config = loadAutomationDaemonConfig({
      ...validEnv(),
      FORGELOOP_CODEX_GENERATION_DRIVER: 'app_server',
      FORGELOOP_CODEX_GENERATION_PACKAGE_DRAFTS_ENABLED: 'true',
      FORGELOOP_CODEX_APP_SERVER_ENDPOINT: 'unix:/tmp/forgeloop-codex.sock',
      FORGELOOP_CODEX_GENERATION_ARTIFACT_ROOT: '/tmp/forgeloop-artifacts',
    });

    expect(createAutomationDaemonGenerationRuntime(config)).toBeDefined();
  });

  it('terminalizes a leased generation session as failed when generation throws', async () => {
    const closed: Array<{ status: string; summary: string }> = [];
    const runtime = createLeasedDockerCodexGenerationRuntime({
      dockerImageDigest: 'sha256:docker',
      worker: {
        selectForLaunch: async () => ({ workerId: 'worker-1', sessionToken: 'worker-session-1' }),
        withLeaseSlot: async (operation) => operation(),
      },
      createLaunchLease: async () => ({ leaseId: 'lease-1', launchToken: 'launch-token-1' }),
      launcher: {
        launchFromLease: async () => ({
          endpoint: 'unix:/safe/codex.sock',
          containerWorkspacePath: '/workspace',
          publicEvidence: {},
          close: async (status, summary) => {
            closed.push({ status, summary });
          },
        }),
      },
      innerRuntimeFactory: () => ({
        generateSpecDraft: async () => {
          throw new Error('unexpected');
        },
        generatePlanDraft: async () => {
          throw new Error('unexpected');
        },
        generatePackageDrafts: async () => {
          throw new Error('generation failed');
        },
      }),
    });

    await expect(
      runtime.generatePackageDrafts({
        actionRunId: 'action-run-1',
        projectId: 'project-1',
        repoIds: ['repo-1'],
        context: {},
        promptVersion: 'package-drafts.v1',
        outputSchemaVersion: 'package_drafts.v1',
        policyDigests: {},
        orchestration: {
          targetType: 'automation_action_run',
          actionRunId: 'action-run-1',
          actionType: 'ensure_package_drafts',
          actionAttempt: 1,
          claimToken: 'claim-token-1',
          preconditionFingerprint: 'precondition-1',
          automationScope: repoScope,
          idempotencyKey: 'idempotency-1',
        },
      }),
    ).rejects.toThrow(/generation failed/);
    expect(closed).toEqual([{ status: 'failed', summary: 'generation failed' }]);
  });

  it('passes leased Docker private app-server transport into the generation runtime', async () => {
    const closed: Array<{ status: string; summary: string }> = [];
    const privateTransport = {
      request: async () => ({}),
    };
    const seenConfigs: Array<Parameters<typeof createCodexGenerationRuntime>[0]> = [];
    const runtime = createLeasedDockerCodexGenerationRuntime({
      dockerImageDigest: 'sha256:docker',
      worker: {
        selectForLaunch: async () => ({ workerId: 'worker-1', sessionToken: 'worker-session-1' }),
        withLeaseSlot: async (operation) => operation(),
      },
      createLaunchLease: async () => ({ leaseId: 'lease-1', launchToken: 'launch-token-1' }),
      launcher: {
        launchFromLease: async () => ({
          endpoint: `docker-exec:sha256:${'a'.repeat(64)}`,
          createTransport: () => privateTransport,
          containerWorkspacePath: '/workspace',
          publicEvidence: {},
          close: async (status, summary) => {
            closed.push({ status, summary });
          },
        }),
      },
      innerRuntimeFactory: (config) => {
        seenConfigs.push(config);
        return {
          generateSpecDraft: async () => {
            throw new Error('unexpected');
          },
          generatePlanDraft: async () => {
            throw new Error('unexpected');
          },
          generatePackageDrafts: async () => ({
            taskKind: 'package_drafts',
            promptVersion: 'package-drafts.v1',
            outputSchemaVersion: 'package_drafts.v1',
            generated: generatedRemotePackageDrafts(),
            generationArtifacts: [],
            publicSummary: 'generated',
          }),
        };
      },
    });

    await runtime.generatePackageDrafts({
      actionRunId: 'action-run-1',
      projectId: 'project-1',
      repoIds: ['repo-1'],
      context: {},
      promptVersion: 'package-drafts.v1',
      outputSchemaVersion: 'package_drafts.v1',
      policyDigests: {},
      orchestration: {
        targetType: 'automation_action_run',
        actionRunId: 'action-run-1',
        actionType: 'ensure_package_drafts',
        actionAttempt: 1,
        claimToken: 'claim-token-1',
        preconditionFingerprint: 'precondition-1',
        automationScope: repoScope,
        idempotencyKey: 'idempotency-1',
      },
    });

    expect(seenConfigs).toHaveLength(1);
    expect(seenConfigs[0]).toMatchObject({
      mode: 'app_server',
      appServerEndpoint: `docker-exec:sha256:${'a'.repeat(64)}`,
    });
    expect(seenConfigs[0]?.transportFactory?.(`docker-exec:sha256:${'a'.repeat(64)}`)).toBe(privateTransport);
    expect(closed).toEqual([{ status: 'succeeded', summary: 'generation complete' }]);
  });

  it('executes Package draft generation through a remote runtime job and writes through the command boundary', async () => {
    const client = new FakeDaemonClient();
    client.snapshot = baseSnapshot({
      planRevisionsRequiringPackages: [packageTarget()],
    });
    client.actionToClaim = claimedPackageAction();
    const remoteCalls: Array<{ method: string; args: unknown[] }> = [];
    const spec = generatedRemotePackageDrafts();
    const specDigest = codexCanonicalDigest(spec);
    const runtime = createRemoteCodexGenerationRuntime({
      runtimeProfileId: 'profile-1',
      credentialBindingId: 'credential-binding-1',
      waitTimeoutMs: 60_000,
      pollIntervalMs: 1_000,
      actionClaimRenewalMs: 30_000,
      now: () => '2026-05-23T00:00:00.000Z',
      sleep: async () => undefined,
      controlPlaneClient: {
        getStatus: async (input) => {
          remoteCalls.push({ method: 'getStatus', args: [input] });
          return {
            runtime_profile_revision_id: 'profile-rev-1',
            runtime_profile_digest: `sha256:${'1'.repeat(64)}`,
            credential_binding_id: 'credential-binding-1',
            credential_binding_version_id: 'credential-version-1',
            credential_payload_digest: `sha256:${'2'.repeat(64)}`,
            docker_image_digest: `sha256:${'3'.repeat(64)}`,
            network_policy_digest: `sha256:${'4'.repeat(64)}`,
          };
        },
        createRuntimeJob: async (input) => {
          remoteCalls.push({ method: 'createRuntimeJob', args: [input] });
          return {
            runtime_job: { id: String(input.runtime_job_id), status: 'queued' },
            replayed: false,
          };
        },
        renewAutomationActionRunClaim: async (actionRunId, input) => {
          remoteCalls.push({ method: 'renewAutomationActionRunClaim', args: [actionRunId, input] });
          return { action_run: { id: actionRunId, status: 'running' } };
        },
        getRuntimeJob: async (jobId) => {
          remoteCalls.push({ method: 'getRuntimeJob', args: [jobId] });
          return {
            runtime_job: {
              id: jobId,
              status: 'terminal',
              terminal_status: 'succeeded',
              terminal_reason_code: 'codex_runtime_job_succeeded',
              terminal_result_json: {
                task_kind: 'package_drafts',
                prompt_version: 'package-drafts.remote.v1',
                output_schema_version: 'package_drafts.v1',
                generated_payload: spec,
                generated_payload_digest: specDigest,
                generation_artifacts: [],
                public_summary: 'Remote runtime generated package drafts.',
              },
            },
          };
        },
        cancelRuntimeJob: async (jobId, input) => {
          remoteCalls.push({ method: 'cancelRuntimeJob', args: [jobId, input] });
          return {};
        },
      },
    });
    const daemon = new AutomationDaemon({
      ...daemonOptions(client),
      generationPlanning: {
        mode: 'app_server',
        tasks: {
          package_drafts: { enabled: true, promptVersion: 'package-drafts.remote.v1', outputSchemaVersion: 'package_drafts.v1' },
        },
      },
      generationRuntime: runtime,
    });

    const result = await daemon.runOnce();

    expect(result).toMatchObject({ plannedActionCount: 1, executed: { status: 'succeeded' } });
    expect(remoteCalls.map((call) => call.method)).toEqual([
      'getStatus',
      'createRuntimeJob',
      'renewAutomationActionRunClaim',
      'getRuntimeJob',
    ]);
    expect(remoteCalls.find((call) => call.method === 'createRuntimeJob')?.args[0]).toMatchObject({
      target: {
        target_type: 'automation_action_run',
        target_id: 'package-action-run-1',
        target_kind: 'generation',
        project_id: 'project-1',
        repo_id: 'repo-1',
      },
      action_type: 'ensure_package_drafts',
      action_attempt: 1,
      action_claim_token: 'claim-token-1',
      precondition_fingerprint: 'precondition-fingerprint-1',
      input_json: {
        schema_version: 'codex_generation_workload.v1',
        signed_context_ref: expect.stringMatching(/^artifact:\/\/codex-runtime-jobs\/codex-generation-job-[0-9a-f]+\/workload\/signed-context$/),
        signed_context_digest: expect.stringMatching(/^sha256:/),
      },
      workspace_acquisition_json: {
        schema_version: 'codex_generation_workspace_acquisition.v1',
        signed_context_json: expect.objectContaining({ context_version: 'generation_context.package.v1' }),
      },
    });
    expect(client.calls.map((call) => call.method)).toContain('ensurePackageDrafts');
    expect(client.calls.map((call) => call.method)).toContain('completeAction');
  });

  it('routes every generation runtime method through remote runtime jobs with task-specific validation', async () => {
    for (const fixture of remoteGenerationTaskFixtures()) {
      const remoteCalls: Array<{ method: string; args: unknown[] }> = [];
      const runtime = createRemoteCodexGenerationRuntime({
        runtimeProfileId: 'profile-1',
        credentialBindingId: 'credential-binding-1',
        waitTimeoutMs: 60_000,
        pollIntervalMs: 1_000,
        actionClaimRenewalMs: 30_000,
        now: () => '2026-05-23T00:00:00.000Z',
        sleep: async () => undefined,
        controlPlaneClient: {
          getStatus: async (input) => {
            remoteCalls.push({ method: 'getStatus', args: [input] });
            return {
              runtime_profile_revision_id: 'profile-rev-1',
              runtime_profile_digest: `sha256:${'1'.repeat(64)}`,
              credential_binding_id: 'credential-binding-1',
              credential_binding_version_id: 'credential-version-1',
              credential_payload_digest: `sha256:${'2'.repeat(64)}`,
              docker_image_digest: `sha256:${'3'.repeat(64)}`,
              network_policy_digest: `sha256:${'4'.repeat(64)}`,
            };
          },
          createRuntimeJob: async (input) => {
            remoteCalls.push({ method: 'createRuntimeJob', args: [input] });
            return {
              runtime_job: { id: String(input.runtime_job_id), status: 'queued' },
              replayed: false,
            };
          },
          renewAutomationActionRunClaim: async (actionRunId, input) => {
            remoteCalls.push({ method: 'renewAutomationActionRunClaim', args: [actionRunId, input] });
            return { action_run: { id: actionRunId, status: 'running' } };
          },
          getRuntimeJob: async (jobId) => {
            remoteCalls.push({ method: 'getRuntimeJob', args: [jobId] });
            return {
              runtime_job: {
                id: jobId,
                status: 'terminal',
                terminal_status: 'succeeded',
                terminal_reason_code: 'codex_runtime_job_succeeded',
                terminal_result_json: {
                  task_kind: fixture.taskKind,
                  prompt_version: fixture.promptVersion,
                  output_schema_version: fixture.outputSchemaVersion,
                  generated_payload: fixture.generatedPayload,
                  generated_payload_digest: codexCanonicalDigest(fixture.generatedPayload),
                  generation_artifacts: [],
                  public_summary: `Remote runtime generated ${fixture.taskKind}.`,
                },
              },
            };
          },
          cancelRuntimeJob: async (jobId, input) => {
            remoteCalls.push({ method: 'cancelRuntimeJob', args: [jobId, input] });
            return {};
          },
        },
      });
      const input = {
        actionRunId: `${fixture.taskKind}-action-run`,
        projectId: 'project-1',
        repoIds: ['repo-1'],
        context: fixture.context,
        promptVersion: fixture.promptVersion,
        outputSchemaVersion: fixture.outputSchemaVersion,
        policyDigests: {},
        orchestration: {
          targetType: 'automation_action_run' as const,
          actionRunId: `${fixture.taskKind}-action-run`,
          actionType: 'ensure_package_drafts' as const,
          actionAttempt: 1,
          claimToken: 'claim-token-1',
          preconditionFingerprint: 'precondition-fingerprint-1',
          automationScope: repoScope,
          idempotencyKey: `${fixture.taskKind}-idempotency`,
        },
      };

      const result =
        fixture.method === 'generateSpecDraft'
          ? await runtime.generateSpecDraft(input)
          : fixture.method === 'generatePlanDraft'
            ? await runtime.generatePlanDraft(input)
            : fixture.method === 'generatePackageDrafts'
              ? await runtime.generatePackageDrafts(input)
              : fixture.method === 'generateBoundaryBrainstormingRound'
                ? await runtime.generateBoundaryBrainstormingRound(input)
                : fixture.method === 'generateDevelopmentPlanItemSpecRevision'
                  ? await runtime.generateDevelopmentPlanItemSpecRevision(input)
                  : await runtime.generateDevelopmentPlanItemExecutionPlanRevision(input);

      expect(result).toMatchObject({
        taskKind: fixture.taskKind,
        promptVersion: fixture.promptVersion,
        outputSchemaVersion: fixture.outputSchemaVersion,
        generated: fixture.generatedPayload,
      });
      expect(remoteCalls.map((call) => call.method)).toEqual([
        'getStatus',
        'createRuntimeJob',
        'renewAutomationActionRunClaim',
        'getRuntimeJob',
      ]);
      expect(remoteCalls.find((call) => call.method === 'createRuntimeJob')?.args[0]).toMatchObject({
        input_json: {
          task_kind: fixture.taskKind,
          prompt_version: fixture.promptVersion,
          output_schema_version: fixture.outputSchemaVersion,
        },
        workspace_acquisition_json: {
          signed_context_json: fixture.context,
        },
      });
    }
  });

  it('cancels the remote runtime job when action claim renewal is lost while waiting', async () => {
    const cancelled: Array<{ jobId: string; input: Record<string, unknown> }> = [];
    const runtime = createRemoteCodexGenerationRuntime({
      runtimeProfileId: 'profile-1',
      credentialBindingId: 'credential-binding-1',
      waitTimeoutMs: 60_000,
      pollIntervalMs: 1_000,
      actionClaimRenewalMs: 30_000,
      now: () => '2026-05-23T00:00:00.000Z',
      sleep: async () => undefined,
      controlPlaneClient: {
        getStatus: async () => ({
          runtime_profile_revision_id: 'profile-rev-1',
          runtime_profile_digest: `sha256:${'1'.repeat(64)}`,
          credential_binding_id: 'credential-binding-1',
          credential_binding_version_id: 'credential-version-1',
          credential_payload_digest: `sha256:${'2'.repeat(64)}`,
          docker_image_digest: `sha256:${'3'.repeat(64)}`,
          network_policy_digest: `sha256:${'4'.repeat(64)}`,
        }),
        createRuntimeJob: async (input) => ({ runtime_job: { id: String(input.runtime_job_id), status: 'queued' } }),
        renewAutomationActionRunClaim: async () => {
          throw new Error('codex_control_plane_request_failed:409');
        },
        getRuntimeJob: async () => ({ runtime_job: { id: 'runtime-job-1', status: 'running' } }),
        cancelRuntimeJob: async (jobId, input) => {
          cancelled.push({ jobId, input });
          return {};
        },
      },
    });

    await expect(
      runtime.generatePackageDrafts({
        actionRunId: 'spec-action-run-1',
        projectId: 'project-1',
        repoIds: ['repo-1'],
        context: { context_version: 'generation_context.package.v1' },
        promptVersion: 'package-drafts.remote.v1',
        outputSchemaVersion: 'package_drafts.v1',
        policyDigests: {},
        orchestration: {
          targetType: 'automation_action_run',
          actionRunId: 'spec-action-run-1',
          actionType: 'ensure_package_drafts',
          actionAttempt: 1,
          claimToken: 'claim-token-1',
          preconditionFingerprint: 'precondition-fingerprint-1',
          automationScope: repoScope,
          idempotencyKey: 'spec-action-run-1-idempotency',
        },
      }),
    ).rejects.toThrow(/automation_action_claim_conflict/);

    expect(cancelled).toHaveLength(1);
    expect(cancelled[0]).toMatchObject({
      input: { reason_code: 'codex_runtime_job_cancelled' },
    });
  });

  it('keeps remote runtime job input stable across create replay attempts', async () => {
    const createInputs: Record<string, unknown>[] = [];
    let nowValue = '2026-05-23T00:00:00.000Z';
    const runtime = createRemoteCodexGenerationRuntime({
      runtimeProfileId: 'profile-1',
      credentialBindingId: 'credential-binding-1',
      waitTimeoutMs: 60_000,
      pollIntervalMs: 1_000,
      actionClaimRenewalMs: 30_000,
      now: () => nowValue,
      sleep: async () => undefined,
      controlPlaneClient: {
        getStatus: async () => ({
          runtime_profile_revision_id: 'profile-rev-1',
          runtime_profile_digest: `sha256:${'1'.repeat(64)}`,
          credential_binding_id: 'credential-binding-1',
          credential_binding_version_id: 'credential-version-1',
          credential_payload_digest: `sha256:${'2'.repeat(64)}`,
          docker_image_digest: `sha256:${'3'.repeat(64)}`,
          network_policy_digest: `sha256:${'4'.repeat(64)}`,
        }),
        createRuntimeJob: async (input) => {
          createInputs.push(input);
          return { runtime_job: { id: String(input.runtime_job_id), status: 'queued' } };
        },
        renewAutomationActionRunClaim: async () => {
          throw new Error('codex_control_plane_request_failed:503');
        },
        getRuntimeJob: async (jobId) => ({ runtime_job: { id: jobId, status: 'running' } }),
        cancelRuntimeJob: async () => ({}),
      },
    });
    const input = {
      actionRunId: 'spec-action-run-1',
      projectId: 'project-1',
      repoIds: ['repo-1'],
      context: { context_version: 'generation_context.package.v1' },
      promptVersion: 'package-drafts.remote.v1',
      outputSchemaVersion: 'package_drafts.v1',
      policyDigests: {},
      orchestration: {
        targetType: 'automation_action_run' as const,
        actionRunId: 'spec-action-run-1',
        actionType: 'ensure_package_drafts' as const,
        actionAttempt: 1,
        claimToken: 'claim-token-1',
        preconditionFingerprint: 'precondition-fingerprint-1',
        automationScope: repoScope,
        idempotencyKey: 'spec-action-run-1-idempotency',
      },
    };

    await expect(runtime.generatePackageDrafts(input)).rejects.toMatchObject({ code: 'codex_app_server_unavailable' });
    nowValue = '2026-05-23T00:01:00.000Z';
    await expect(runtime.generatePackageDrafts(input)).rejects.toMatchObject({ code: 'codex_app_server_unavailable' });

    expect(createInputs).toHaveLength(2);
    expect(createInputs[1]).toMatchObject({
      runtime_job_id: createInputs[0]?.runtime_job_id,
      job_request_id: createInputs[0]?.job_request_id,
      input_json: createInputs[0]?.input_json,
      workspace_acquisition_json: createInputs[0]?.workspace_acquisition_json,
    });
  });

  it('treats transient remote action claim renewal failures as retryable transport failures', async () => {
    const cancelled: Array<{ jobId: string; input: Record<string, unknown> }> = [];
    const runtime = createRemoteCodexGenerationRuntime({
      runtimeProfileId: 'profile-1',
      credentialBindingId: 'credential-binding-1',
      waitTimeoutMs: 60_000,
      pollIntervalMs: 1_000,
      actionClaimRenewalMs: 30_000,
      now: () => '2026-05-23T00:00:00.000Z',
      sleep: async () => undefined,
      controlPlaneClient: {
        getStatus: async () => ({
          runtime_profile_revision_id: 'profile-rev-1',
          runtime_profile_digest: `sha256:${'1'.repeat(64)}`,
          credential_binding_id: 'credential-binding-1',
          credential_binding_version_id: 'credential-version-1',
          credential_payload_digest: `sha256:${'2'.repeat(64)}`,
          docker_image_digest: `sha256:${'3'.repeat(64)}`,
          network_policy_digest: `sha256:${'4'.repeat(64)}`,
        }),
        createRuntimeJob: async (input) => ({ runtime_job: { id: String(input.runtime_job_id), status: 'queued' } }),
        renewAutomationActionRunClaim: async () => {
          throw new Error('codex_control_plane_request_failed:503');
        },
        getRuntimeJob: async () => ({ runtime_job: { id: 'runtime-job-1', status: 'running' } }),
        cancelRuntimeJob: async (jobId, input) => {
          cancelled.push({ jobId, input });
          return {};
        },
      },
    });

    await expect(
      runtime.generatePackageDrafts({
        actionRunId: 'spec-action-run-1',
        projectId: 'project-1',
        repoIds: ['repo-1'],
        context: { context_version: 'generation_context.package.v1' },
        promptVersion: 'package-drafts.remote.v1',
        outputSchemaVersion: 'package_drafts.v1',
        policyDigests: {},
        orchestration: {
          targetType: 'automation_action_run',
          actionRunId: 'spec-action-run-1',
          actionType: 'ensure_package_drafts',
          actionAttempt: 1,
          claimToken: 'claim-token-1',
          preconditionFingerprint: 'precondition-fingerprint-1',
          automationScope: repoScope,
          idempotencyKey: 'spec-action-run-1-idempotency',
        },
      }),
    ).rejects.toMatchObject({ name: 'CodexGenerationError', code: 'codex_app_server_unavailable', retryable: true });

    expect(cancelled).toHaveLength(1);
  });

  it('rejects remote terminal generation artifact refs that were not issued for the runtime job', async () => {
    const spec = generatedRemotePackageDrafts();
    const runtime = createRemoteCodexGenerationRuntime({
      runtimeProfileId: 'profile-1',
      credentialBindingId: 'credential-binding-1',
      waitTimeoutMs: 60_000,
      pollIntervalMs: 1_000,
      actionClaimRenewalMs: 30_000,
      now: () => '2026-05-23T00:00:00.000Z',
      sleep: async () => undefined,
      controlPlaneClient: {
        getStatus: async () => ({
          runtime_profile_revision_id: 'profile-rev-1',
          runtime_profile_digest: `sha256:${'1'.repeat(64)}`,
          credential_binding_id: 'credential-binding-1',
          credential_binding_version_id: 'credential-version-1',
          credential_payload_digest: `sha256:${'2'.repeat(64)}`,
          docker_image_digest: `sha256:${'3'.repeat(64)}`,
          network_policy_digest: `sha256:${'4'.repeat(64)}`,
        }),
        createRuntimeJob: async (input) => ({ runtime_job: { id: String(input.runtime_job_id), status: 'queued' } }),
        renewAutomationActionRunClaim: async (actionRunId) => ({ action_run: { id: actionRunId, status: 'running' } }),
        getRuntimeJob: async (jobId) => ({
          runtime_job: {
            id: jobId,
            status: 'terminal',
            terminal_status: 'succeeded',
            terminal_result_json: {
              task_kind: 'package_drafts',
              prompt_version: 'package-drafts.remote.v1',
              output_schema_version: 'package_drafts.v1',
              generated_payload: spec,
              generated_payload_digest: codexCanonicalDigest(spec),
              generation_artifacts: [
                {
                  kind: 'raw_metadata',
                  name: 'invented',
                  content_type: 'application/json',
                  digest: `sha256:${'5'.repeat(64)}`,
                  internal_ref: 'artifact://codex-runtime-jobs/other-job/artifacts/invented',
                },
              ],
              public_summary: 'Remote runtime generated package drafts.',
            },
          },
        }),
        cancelRuntimeJob: async () => ({}),
      },
    });

    await expect(
      runtime.generatePackageDrafts({
        actionRunId: 'spec-action-run-1',
        projectId: 'project-1',
        repoIds: ['repo-1'],
        context: { context_version: 'generation_context.package.v1' },
        promptVersion: 'package-drafts.remote.v1',
        outputSchemaVersion: 'package_drafts.v1',
        policyDigests: {},
        orchestration: {
          targetType: 'automation_action_run',
          actionRunId: 'spec-action-run-1',
          actionType: 'ensure_package_drafts',
          actionAttempt: 1,
          claimToken: 'claim-token-1',
          preconditionFingerprint: 'precondition-fingerprint-1',
          automationScope: repoScope,
          idempotencyKey: 'spec-action-run-1-idempotency',
        },
      }),
    ).rejects.toMatchObject({ name: 'CodexGenerationError', code: 'generated_output_schema_invalid' });
  });

  it('accepts canonical internal remote terminal generation artifact refs for the runtime job', async () => {
    const spec = generatedRemotePackageDrafts();
    const runtime = createRemoteCodexGenerationRuntime({
      runtimeProfileId: 'profile-1',
      credentialBindingId: 'credential-binding-1',
      waitTimeoutMs: 60_000,
      pollIntervalMs: 1_000,
      actionClaimRenewalMs: 30_000,
      now: () => '2026-05-23T00:00:00.000Z',
      sleep: async () => undefined,
      controlPlaneClient: {
        getStatus: async () => ({
          runtime_profile_revision_id: 'profile-rev-1',
          runtime_profile_digest: `sha256:${'1'.repeat(64)}`,
          credential_binding_id: 'credential-binding-1',
          credential_binding_version_id: 'credential-version-1',
          credential_payload_digest: `sha256:${'2'.repeat(64)}`,
          docker_image_digest: `sha256:${'3'.repeat(64)}`,
          network_policy_digest: `sha256:${'4'.repeat(64)}`,
        }),
        createRuntimeJob: async (input) => ({ runtime_job: { id: String(input.runtime_job_id), status: 'queued' } }),
        renewAutomationActionRunClaim: async (actionRunId) => ({ action_run: { id: actionRunId, status: 'running' } }),
        getRuntimeJob: async (jobId) => {
          const issuedInternalRef = `artifact://internal/codex_runtime_job_artifact/codex_runtime_job/${jobId}/artifact-1`;
          return {
            runtime_job: {
              id: jobId,
              status: 'terminal',
              terminal_status: 'succeeded',
              terminal_result_json: {
                task_kind: 'package_drafts',
                prompt_version: 'package-drafts.remote.v1',
                output_schema_version: 'package_drafts.v1',
                generated_payload: spec,
                generated_payload_digest: codexCanonicalDigest(spec),
                generation_artifacts: [
                  {
                    kind: 'raw_metadata',
                    name: 'generated-metadata.json',
                    content_type: 'application/json',
                    digest: `sha256:${'5'.repeat(64)}`,
                    internal_ref: issuedInternalRef,
                  },
                ],
                public_summary: 'Remote runtime generated package drafts.',
              },
            },
          };
        },
        cancelRuntimeJob: async () => ({}),
      },
    });

    await expect(
      runtime.generatePackageDrafts({
        actionRunId: 'spec-action-run-1',
        projectId: 'project-1',
        repoIds: ['repo-1'],
        context: { context_version: 'generation_context.package.v1' },
        promptVersion: 'package-drafts.remote.v1',
        outputSchemaVersion: 'package_drafts.v1',
        policyDigests: {},
        orchestration: {
          targetType: 'automation_action_run',
          actionRunId: 'spec-action-run-1',
          actionType: 'ensure_package_drafts',
          actionAttempt: 1,
          claimToken: 'claim-token-1',
          preconditionFingerprint: 'precondition-fingerprint-1',
          automationScope: repoScope,
          idempotencyKey: 'spec-action-run-1-idempotency',
        },
      }),
    ).resolves.toMatchObject({
      generationArtifacts: [
        {
          kind: 'raw_metadata',
          storage_uri: expect.stringMatching(
            /^artifact:\/\/internal\/codex_runtime_job_artifact\/codex_runtime_job\/codex-generation-job-[a-f0-9]+\/artifact-1$/,
          ),
        },
      ],
    });
  });

  it('rejects old-prefix remote terminal generation artifact refs even for the runtime job', async () => {
    const spec = generatedRemotePackageDrafts();
    const runtime = createRemoteCodexGenerationRuntime({
      runtimeProfileId: 'profile-1',
      credentialBindingId: 'credential-binding-1',
      waitTimeoutMs: 60_000,
      pollIntervalMs: 1_000,
      actionClaimRenewalMs: 30_000,
      now: () => '2026-05-23T00:00:00.000Z',
      sleep: async () => undefined,
      controlPlaneClient: {
        getStatus: async () => ({
          runtime_profile_revision_id: 'profile-rev-1',
          runtime_profile_digest: `sha256:${'1'.repeat(64)}`,
          credential_binding_id: 'credential-binding-1',
          credential_binding_version_id: 'credential-version-1',
          credential_payload_digest: `sha256:${'2'.repeat(64)}`,
          docker_image_digest: `sha256:${'3'.repeat(64)}`,
          network_policy_digest: `sha256:${'4'.repeat(64)}`,
        }),
        createRuntimeJob: async (input) => ({ runtime_job: { id: String(input.runtime_job_id), status: 'queued' } }),
        renewAutomationActionRunClaim: async (actionRunId) => ({ action_run: { id: actionRunId, status: 'running' } }),
        getRuntimeJob: async (jobId) => ({
          runtime_job: {
            id: jobId,
            status: 'terminal',
            terminal_status: 'succeeded',
            terminal_result_json: {
              task_kind: 'package_drafts',
              prompt_version: 'package-drafts.remote.v1',
              output_schema_version: 'package_drafts.v1',
              generated_payload: spec,
              generated_payload_digest: codexCanonicalDigest(spec),
              generation_artifacts: [
                {
                  kind: 'raw_metadata',
                  name: 'legacy-ref',
                  content_type: 'application/json',
                  digest: `sha256:${'5'.repeat(64)}`,
                  internal_ref: `artifact://codex-runtime-jobs/${jobId}/artifacts/legacy-ref`,
                },
              ],
              public_summary: 'Remote runtime generated package drafts.',
            },
          },
        }),
        cancelRuntimeJob: async () => ({}),
      },
    });

    await expect(
      runtime.generatePackageDrafts({
        actionRunId: 'spec-action-run-1',
        projectId: 'project-1',
        repoIds: ['repo-1'],
        context: { context_version: 'generation_context.package.v1' },
        promptVersion: 'package-drafts.remote.v1',
        outputSchemaVersion: 'package_drafts.v1',
        policyDigests: {},
        orchestration: {
          targetType: 'automation_action_run',
          actionRunId: 'spec-action-run-1',
          actionType: 'ensure_package_drafts',
          actionAttempt: 1,
          claimToken: 'claim-token-1',
          preconditionFingerprint: 'precondition-fingerprint-1',
          automationScope: repoScope,
          idempotencyKey: 'spec-action-run-1-idempotency',
        },
      }),
    ).rejects.toMatchObject({ name: 'CodexGenerationError', code: 'generated_output_schema_invalid' });
  });

  it('rejects remote generated payload artifact refs until daemon artifact fetch is implemented', async () => {
    const runtime = createRemoteCodexGenerationRuntime({
      runtimeProfileId: 'profile-1',
      credentialBindingId: 'credential-binding-1',
      waitTimeoutMs: 60_000,
      pollIntervalMs: 1_000,
      actionClaimRenewalMs: 30_000,
      now: () => '2026-05-23T00:00:00.000Z',
      sleep: async () => undefined,
      controlPlaneClient: {
        getStatus: async () => ({
          runtime_profile_revision_id: 'profile-rev-1',
          runtime_profile_digest: `sha256:${'1'.repeat(64)}`,
          credential_binding_id: 'credential-binding-1',
          credential_binding_version_id: 'credential-version-1',
          credential_payload_digest: `sha256:${'2'.repeat(64)}`,
          docker_image_digest: `sha256:${'3'.repeat(64)}`,
          network_policy_digest: `sha256:${'4'.repeat(64)}`,
        }),
        createRuntimeJob: async (input) => ({ runtime_job: { id: String(input.runtime_job_id), status: 'queued' } }),
        renewAutomationActionRunClaim: async (actionRunId) => ({ action_run: { id: actionRunId, status: 'running' } }),
        getRuntimeJob: async (jobId) => ({
          runtime_job: {
            id: jobId,
            status: 'terminal',
            terminal_status: 'succeeded',
            terminal_result_json: {
              task_kind: 'package_drafts',
              prompt_version: 'package-drafts.remote.v1',
              output_schema_version: 'package_drafts.v1',
              generated_payload: {
                schema_version: 'generated_payload_ref.v1',
                artifact: {
                  kind: 'generated_payload',
                  name: 'generated-payload.json',
                  content_type: 'application/json',
                  digest: `sha256:${'5'.repeat(64)}`,
                  internal_ref: `artifact://internal/codex_runtime_job_artifact/codex_runtime_job/${jobId}/generated_payload`,
                },
              },
              generated_payload_digest: `sha256:${'5'.repeat(64)}`,
              generation_artifacts: [
                {
                  kind: 'generated_payload',
                  name: 'generated-payload.json',
                  content_type: 'application/json',
                  digest: `sha256:${'5'.repeat(64)}`,
                  internal_ref: `artifact://internal/codex_runtime_job_artifact/codex_runtime_job/${jobId}/generated_payload`,
                },
              ],
              public_summary: 'Remote runtime generated an oversized spec.',
            },
          },
        }),
        cancelRuntimeJob: async () => ({}),
      },
    });

    await expect(
      runtime.generatePackageDrafts({
        actionRunId: 'spec-action-run-1',
        projectId: 'project-1',
        repoIds: ['repo-1'],
        context: { context_version: 'generation_context.package.v1' },
        promptVersion: 'package-drafts.remote.v1',
        outputSchemaVersion: 'package_drafts.v1',
        policyDigests: {},
        orchestration: {
          targetType: 'automation_action_run',
          actionRunId: 'spec-action-run-1',
          actionType: 'ensure_package_drafts',
          actionAttempt: 1,
          claimToken: 'claim-token-1',
          preconditionFingerprint: 'precondition-fingerprint-1',
          automationScope: repoScope,
          idempotencyKey: 'spec-action-run-1-idempotency',
        },
      }),
    ).rejects.toMatchObject({ name: 'CodexGenerationError', code: 'generated_output_too_large' });
  });

  it('caps remote runtime job polling sleep to the configured wait deadline', async () => {
    let monotonicNowMs = 0;
    const sleepDurations: number[] = [];
    const cancelled: Array<{ jobId: string; input: Record<string, unknown> }> = [];
    const runtime = createRemoteCodexGenerationRuntime({
      runtimeProfileId: 'profile-1',
      credentialBindingId: 'credential-binding-1',
      waitTimeoutMs: 1_000,
      pollIntervalMs: 5_000,
      actionClaimRenewalMs: 30_000,
      now: () => '2026-05-23T00:00:00.000Z',
      monotonicNowMs: () => monotonicNowMs,
      sleep: async (durationMs) => {
        sleepDurations.push(durationMs);
        monotonicNowMs += durationMs;
      },
      controlPlaneClient: {
        getStatus: async () => ({
          runtime_profile_revision_id: 'profile-rev-1',
          runtime_profile_digest: `sha256:${'1'.repeat(64)}`,
          credential_binding_id: 'credential-binding-1',
          credential_binding_version_id: 'credential-version-1',
          credential_payload_digest: `sha256:${'2'.repeat(64)}`,
          docker_image_digest: `sha256:${'3'.repeat(64)}`,
          network_policy_digest: `sha256:${'4'.repeat(64)}`,
        }),
        createRuntimeJob: async (input) => ({ runtime_job: { id: String(input.runtime_job_id), status: 'queued' } }),
        renewAutomationActionRunClaim: async (actionRunId) => ({ action_run: { id: actionRunId, status: 'running' } }),
        getRuntimeJob: async (jobId) => ({ runtime_job: { id: jobId, status: 'running' } }),
        cancelRuntimeJob: async (jobId, input) => {
          cancelled.push({ jobId, input });
          return {};
        },
      },
    });

    await expect(
      runtime.generatePackageDrafts({
        actionRunId: 'spec-action-run-1',
        projectId: 'project-1',
        repoIds: ['repo-1'],
        context: { context_version: 'generation_context.package.v1' },
        promptVersion: 'package-drafts.remote.v1',
        outputSchemaVersion: 'package_drafts.v1',
        policyDigests: {},
        orchestration: {
          targetType: 'automation_action_run',
          actionRunId: 'spec-action-run-1',
          actionType: 'ensure_package_drafts',
          actionAttempt: 1,
          claimToken: 'claim-token-1',
          preconditionFingerprint: 'precondition-fingerprint-1',
          automationScope: repoScope,
          idempotencyKey: 'spec-action-run-1-idempotency',
        },
      }),
    ).rejects.toMatchObject({ code: 'codex_runtime_job_expired' });

    expect(sleepDurations).toEqual([1_000]);
    expect(cancelled).toHaveLength(1);
    expect(cancelled[0]?.input).toMatchObject({ reason_code: 'codex_runtime_job_expired' });
  });

  it('does not sleep again when control-plane polling consumes the remote wait deadline', async () => {
    const sleepDurations: number[] = [];
    const cancelled: Array<{ jobId: string; input: Record<string, unknown> }> = [];
    const runtime = createRemoteCodexGenerationRuntime({
      runtimeProfileId: 'profile-1',
      credentialBindingId: 'credential-binding-1',
      waitTimeoutMs: 5,
      pollIntervalMs: 5,
      actionClaimRenewalMs: 30_000,
      now: () => '2026-05-23T00:00:00.000Z',
      sleep: async (durationMs) => {
        sleepDurations.push(durationMs);
      },
      controlPlaneClient: {
        getStatus: async () => ({
          runtime_profile_revision_id: 'profile-rev-1',
          runtime_profile_digest: `sha256:${'1'.repeat(64)}`,
          credential_binding_id: 'credential-binding-1',
          credential_binding_version_id: 'credential-version-1',
          credential_payload_digest: `sha256:${'2'.repeat(64)}`,
          docker_image_digest: `sha256:${'3'.repeat(64)}`,
          network_policy_digest: `sha256:${'4'.repeat(64)}`,
        }),
        createRuntimeJob: async (input) => ({ runtime_job: { id: String(input.runtime_job_id), status: 'queued' } }),
        renewAutomationActionRunClaim: async (actionRunId) => ({ action_run: { id: actionRunId, status: 'running' } }),
        getRuntimeJob: async (jobId) => {
          await new Promise((resolve) => setTimeout(resolve, 15));
          return { runtime_job: { id: jobId, status: 'running' } };
        },
        cancelRuntimeJob: async (jobId, input) => {
          cancelled.push({ jobId, input });
          return {};
        },
      },
    });

    await expect(
      runtime.generatePackageDrafts({
        actionRunId: 'spec-action-run-1',
        projectId: 'project-1',
        repoIds: ['repo-1'],
        context: { context_version: 'generation_context.package.v1' },
        promptVersion: 'package-drafts.remote.v1',
        outputSchemaVersion: 'package_drafts.v1',
        policyDigests: {},
        orchestration: {
          targetType: 'automation_action_run',
          actionRunId: 'spec-action-run-1',
          actionType: 'ensure_package_drafts',
          actionAttempt: 1,
          claimToken: 'claim-token-1',
          preconditionFingerprint: 'precondition-fingerprint-1',
          automationScope: repoScope,
          idempotencyKey: 'spec-action-run-1-idempotency',
        },
      }),
    ).rejects.toMatchObject({ code: 'codex_runtime_job_expired' });

    expect(sleepDurations).toEqual([]);
    expect(cancelled).toHaveLength(1);
    expect(cancelled[0]?.input).toMatchObject({ reason_code: 'codex_runtime_job_expired' });
  });

  it('times out a remote runtime job while action claim renewal is still stalled', async () => {
    const cancelled: Array<{ jobId: string; input: Record<string, unknown> }> = [];
    let renewalResolved = false;
    let getRuntimeJobCalled = false;
    const runtime = createRemoteCodexGenerationRuntime({
      runtimeProfileId: 'profile-1',
      credentialBindingId: 'credential-binding-1',
      waitTimeoutMs: 5,
      pollIntervalMs: 5,
      actionClaimRenewalMs: 30_000,
      now: () => '2026-05-23T00:00:00.000Z',
      sleep: async () => undefined,
      controlPlaneClient: {
        getStatus: async () => ({
          runtime_profile_revision_id: 'profile-rev-1',
          runtime_profile_digest: `sha256:${'1'.repeat(64)}`,
          credential_binding_id: 'credential-binding-1',
          credential_binding_version_id: 'credential-version-1',
          credential_payload_digest: `sha256:${'2'.repeat(64)}`,
          docker_image_digest: `sha256:${'3'.repeat(64)}`,
          network_policy_digest: `sha256:${'4'.repeat(64)}`,
        }),
        createRuntimeJob: async (input) => ({ runtime_job: { id: String(input.runtime_job_id), status: 'queued' } }),
        renewAutomationActionRunClaim: async (actionRunId) => {
          await new Promise((resolve) => setTimeout(resolve, 50));
          renewalResolved = true;
          return { action_run: { id: actionRunId, status: 'running' } };
        },
        getRuntimeJob: async (jobId) => {
          getRuntimeJobCalled = true;
          return { runtime_job: { id: jobId, status: 'running' } };
        },
        cancelRuntimeJob: async (jobId, input) => {
          cancelled.push({ jobId, input });
          return {};
        },
      },
    });

    await expect(
      runtime.generatePackageDrafts({
        actionRunId: 'spec-action-run-1',
        projectId: 'project-1',
        repoIds: ['repo-1'],
        context: { context_version: 'generation_context.package.v1' },
        promptVersion: 'package-drafts.remote.v1',
        outputSchemaVersion: 'package_drafts.v1',
        policyDigests: {},
        orchestration: {
          targetType: 'automation_action_run',
          actionRunId: 'spec-action-run-1',
          actionType: 'ensure_package_drafts',
          actionAttempt: 1,
          claimToken: 'claim-token-1',
          preconditionFingerprint: 'precondition-fingerprint-1',
          automationScope: repoScope,
          idempotencyKey: 'spec-action-run-1-idempotency',
        },
      }),
    ).rejects.toMatchObject({ code: 'codex_runtime_job_expired' });

    expect(renewalResolved).toBe(false);
    expect(getRuntimeJobCalled).toBe(false);
    expect(cancelled).toHaveLength(1);
    expect(cancelled[0]?.input).toMatchObject({ reason_code: 'codex_runtime_job_expired' });
  });

  it('times out a remote runtime job while runtime job polling is still stalled', async () => {
    const cancelled: Array<{ jobId: string; input: Record<string, unknown> }> = [];
    let pollResolved = false;
    const runtime = createRemoteCodexGenerationRuntime({
      runtimeProfileId: 'profile-1',
      credentialBindingId: 'credential-binding-1',
      waitTimeoutMs: 5,
      pollIntervalMs: 5,
      actionClaimRenewalMs: 30_000,
      now: () => '2026-05-23T00:00:00.000Z',
      sleep: async () => undefined,
      controlPlaneClient: {
        getStatus: async () => ({
          runtime_profile_revision_id: 'profile-rev-1',
          runtime_profile_digest: `sha256:${'1'.repeat(64)}`,
          credential_binding_id: 'credential-binding-1',
          credential_binding_version_id: 'credential-version-1',
          credential_payload_digest: `sha256:${'2'.repeat(64)}`,
          docker_image_digest: `sha256:${'3'.repeat(64)}`,
          network_policy_digest: `sha256:${'4'.repeat(64)}`,
        }),
        createRuntimeJob: async (input) => ({ runtime_job: { id: String(input.runtime_job_id), status: 'queued' } }),
        renewAutomationActionRunClaim: async (actionRunId) => ({ action_run: { id: actionRunId, status: 'running' } }),
        getRuntimeJob: async (jobId) => {
          await new Promise((resolve) => setTimeout(resolve, 50));
          pollResolved = true;
          return { runtime_job: { id: jobId, status: 'running' } };
        },
        cancelRuntimeJob: async (jobId, input) => {
          cancelled.push({ jobId, input });
          return {};
        },
      },
    });

    await expect(
      runtime.generatePackageDrafts({
        actionRunId: 'spec-action-run-1',
        projectId: 'project-1',
        repoIds: ['repo-1'],
        context: { context_version: 'generation_context.package.v1' },
        promptVersion: 'package-drafts.remote.v1',
        outputSchemaVersion: 'package_drafts.v1',
        policyDigests: {},
        orchestration: {
          targetType: 'automation_action_run',
          actionRunId: 'spec-action-run-1',
          actionType: 'ensure_package_drafts',
          actionAttempt: 1,
          claimToken: 'claim-token-1',
          preconditionFingerprint: 'precondition-fingerprint-1',
          automationScope: repoScope,
          idempotencyKey: 'spec-action-run-1-idempotency',
        },
      }),
    ).rejects.toMatchObject({ code: 'codex_runtime_job_expired' });

    expect(pollResolved).toBe(false);
    expect(cancelled).toHaveLength(1);
    expect(cancelled[0]?.input).toMatchObject({ reason_code: 'codex_runtime_job_expired' });
  });

  it('does not write a remote Package draft when the command boundary rejects a stale action claim', async () => {
    const client = new FakeDaemonClient();
    client.snapshot = baseSnapshot({
      planRevisionsRequiringPackages: [packageTarget()],
    });
    client.actionToClaim = claimedPackageAction();
    client.ensurePackageDrafts = async (workItemId, input) => {
      client.calls.push({ method: 'ensurePackageDrafts', args: [workItemId, input] });
      throw new AutomationHttpError(409, { code: 'automation_action_claim_conflict' }, 'automation_action_claim_conflict');
    };
    const spec = generatedRemotePackageDrafts();
    const runtime = createRemoteCodexGenerationRuntime({
      runtimeProfileId: 'profile-1',
      credentialBindingId: 'credential-binding-1',
      waitTimeoutMs: 60_000,
      pollIntervalMs: 1_000,
      actionClaimRenewalMs: 30_000,
      now: () => '2026-05-23T00:00:00.000Z',
      sleep: async () => undefined,
      controlPlaneClient: {
        getStatus: async () => ({
          runtime_profile_revision_id: 'profile-rev-1',
          runtime_profile_digest: `sha256:${'1'.repeat(64)}`,
          credential_binding_id: 'credential-binding-1',
          credential_binding_version_id: 'credential-version-1',
          credential_payload_digest: `sha256:${'2'.repeat(64)}`,
          docker_image_digest: `sha256:${'3'.repeat(64)}`,
          network_policy_digest: `sha256:${'4'.repeat(64)}`,
        }),
        createRuntimeJob: async (input) => ({ runtime_job: { id: String(input.runtime_job_id), status: 'queued' } }),
        renewAutomationActionRunClaim: async (actionRunId) => ({ action_run: { id: actionRunId, status: 'running' } }),
        getRuntimeJob: async (jobId) => ({
          runtime_job: {
            id: jobId,
            status: 'terminal',
            terminal_status: 'succeeded',
            terminal_result_json: {
              task_kind: 'package_drafts',
              prompt_version: 'package-drafts.remote.v1',
              output_schema_version: 'package_drafts.v1',
              generated_payload: spec,
              generated_payload_digest: codexCanonicalDigest(spec),
              generation_artifacts: [],
              public_summary: 'Remote runtime generated package drafts.',
            },
          },
        }),
        cancelRuntimeJob: async () => ({}),
      },
    });
    const daemon = new AutomationDaemon({
      ...daemonOptions(client),
      generationPlanning: {
        mode: 'app_server',
        tasks: {
          package_drafts: { enabled: true, promptVersion: 'package-drafts.remote.v1', outputSchemaVersion: 'package_drafts.v1' },
        },
      },
      generationRuntime: runtime,
    });

    const result = await daemon.runOnce();

    expect(result).toMatchObject({
      executed: { status: 'failed', retryable: false, reasonCode: 'automation_action_claim_conflict' },
    });
    expect(client.calls.map((call) => call.method)).toContain('ensurePackageDrafts');
    expect(client.calls.map((call) => call.method)).toContain('failAction');
    expect(client.calls.map((call) => call.method)).not.toContain('completeAction');
  });

  it('cancels a timed-out remote runtime job and blocks with public-safe runtime evidence', async () => {
    const client = new FakeDaemonClient();
    client.snapshot = baseSnapshot({
      planRevisionsRequiringPackages: [packageTarget()],
    });
    client.actionToClaim = claimedPackageAction();
    const cancelled: Array<{ jobId: string; input: Record<string, unknown> }> = [];
    const runtime = createRemoteCodexGenerationRuntime({
      runtimeProfileId: 'profile-1',
      credentialBindingId: 'credential-binding-1',
      waitTimeoutMs: 1_000,
      pollIntervalMs: 1_000,
      actionClaimRenewalMs: 30_000,
      now: () => '2026-05-23T00:00:00.000Z',
      sleep: async () => undefined,
      controlPlaneClient: {
        getStatus: async () => ({
          runtime_profile_revision_id: 'profile-rev-1',
          runtime_profile_digest: `sha256:${'1'.repeat(64)}`,
          credential_binding_id: 'credential-binding-1',
          credential_binding_version_id: 'credential-version-1',
          credential_payload_digest: `sha256:${'2'.repeat(64)}`,
          docker_image_digest: `sha256:${'3'.repeat(64)}`,
          network_policy_digest: `sha256:${'4'.repeat(64)}`,
        }),
        createRuntimeJob: async (input) => ({ runtime_job: { id: String(input.runtime_job_id), status: 'queued' } }),
        renewAutomationActionRunClaim: async (actionRunId) => ({ action_run: { id: actionRunId, status: 'running' } }),
        getRuntimeJob: async (jobId) => ({ runtime_job: { id: jobId, status: 'running' } }),
        cancelRuntimeJob: async (jobId, input) => {
          cancelled.push({ jobId, input });
          return {};
        },
      },
    });
    const daemon = new AutomationDaemon({
      ...daemonOptions(client),
      generationPlanning: {
        mode: 'app_server',
        tasks: {
          package_drafts: { enabled: true, promptVersion: 'package-drafts.remote.v1', outputSchemaVersion: 'package_drafts.v1' },
        },
      },
      generationRuntime: runtime,
    });

    const result = await daemon.runOnce();

    expect(result).toMatchObject({
      executed: { status: 'blocked', retryable: false, reasonCode: 'codex_runtime_job_expired' },
    });
    expect(cancelled).toHaveLength(1);
    expect(cancelled[0]?.input).toMatchObject({ reason_code: 'codex_runtime_job_expired' });
    expect(client.calls.map((call) => call.method)).toContain('blockAction');
    expect(JSON.stringify(client.calls)).not.toContain('launch-token');
  });

  it('throws early when required config is missing', () => {
    expect(() => loadAutomationDaemonConfig({})).toThrow(/FORGELOOP_CONTROL_PLANE_URL/);
  });

  it('fetches snapshot, loads policy digest, plans actions, creates/replays actions, claims and executes one action', async () => {
    const client = new FakeDaemonClient();
    client.snapshot = baseSnapshot({
      planRevisionsRequiringPackages: [packageTarget()],
    });
    const policyLoads: Array<{ repoRoot: string; allowedRepoRoots: string[]; parserVersion: string }> = [];
    const daemon = new AutomationDaemon({
      client,
      actorId: 'daemon-actor',
      daemonIdentity: 'daemon-1',
      claimToken: 'claim-token-1',
      allowedRepoRoots: ['/workspace'],
      policyParserVersion: parserVersion,
      policyLoader: async (input) => {
        policyLoads.push(input);
        return loadedPolicy();
      },
      noClaimBackoffMs: 25,
      loopIntervalMs: 1_000,
      generationPlanning,
      generationRuntime: createCodexGenerationRuntime({ mode: 'fake' }),
    });

    const result = await daemon.runOnce();

    expect(policyLoads).toEqual([{ repoRoot: '/workspace/repo-1', allowedRepoRoots: ['/workspace'], parserVersion }]);
    expect(result).toMatchObject({ plannedActionCount: 2, executed: { status: 'succeeded' } });
    expect(client.calls.map((call) => call.method)).toEqual([
      'runtimeSnapshot',
      'createOrReplayAction',
      'createOrReplayAction',
      'claimNextAction',
      'packageDraftsGenerationContext',
      'ensurePackageDrafts',
      'completeAction',
    ]);
    const createdActions = client.calls
      .filter((call) => call.method === 'createOrReplayAction')
      .map((call) => (call.args[0] as NextAction).actionType);
    expect(createdActions).toEqual(['ensure_package_drafts', 'project_runtime_snapshot']);
    expect(JSON.stringify(client.calls)).not.toContain('enqueue');
  });

  it('suppresses Plan and Package draft planning when no generation config is provided', async () => {
    const client = new FakeDaemonClient();
    client.snapshot = baseSnapshot({
      planRevisionsRequiringPackages: [packageTarget()],
      planRevisionsRequiringPackages: [packageTarget()],
    });
    client.actionToClaim = null;
    const daemon = new AutomationDaemon(daemonOptions(client));

    const result = await daemon.runOnce();

    expect(result).toMatchObject({ plannedActionCount: 1, executed: { status: 'skipped' } });
    expect(
      client.calls.filter((call) => call.method === 'createOrReplayAction').map((call) => (call.args[0] as NextAction).actionType),
    ).toEqual(['project_runtime_snapshot']);
  });

  it('suppresses Plan and Package draft planning for minimal environment config', async () => {
    const client = new FakeDaemonClient();
    client.snapshot = baseSnapshot({
      planRevisionsRequiringPackages: [packageTarget()],
      planRevisionsRequiringPackages: [packageTarget()],
    });
    client.actionToClaim = null;
    const config = loadAutomationDaemonConfig(validEnv());
    const generationPlanning = generationPlanningForDaemon(config);
    const daemon = new AutomationDaemon({
      ...daemonOptions(client),
      ...(generationPlanning === undefined ? {} : { generationPlanning }),
    });

    const result = await daemon.runOnce();

    expect(result).toMatchObject({ plannedActionCount: 1, executed: { status: 'skipped' } });
    expect(
      client.calls.filter((call) => call.method === 'createOrReplayAction').map((call) => (call.args[0] as NextAction).actionType),
    ).toEqual(['project_runtime_snapshot']);
  });

  it('claims policy projection before app_server generation actions', async () => {
    const client = new FakeDaemonClient();
    client.snapshot = baseSnapshot({
      repos: [
        {
          projectId: 'project-1',
          repoId: 'repo-1',
          automationScope: repoScope,
          automationSettingsVersion: 3,
          capabilityFingerprint: 'capability-fingerprint-1',
          daemonInternalLocalPath: '/workspace/repo-1',
          policyProjection: {
            automationScope: repoScope,
            repoId: 'repo-1',
            policyStatus: 'loaded',
            policyDigest: 'workflow-digest-1',
            parserVersion,
          },
        },
      ],
      planRevisionsRequiringPackages: [packageTarget()],
    });
    client.actionToClaim = claimedProjectionAction();
    const daemon = new AutomationDaemon({
      ...daemonOptions(client),
      generationPlanning: {
        mode: 'app_server',
        tasks: {
          package_drafts: { enabled: true, promptVersion: 'package-drafts.fake.v1', outputSchemaVersion: 'package_drafts.v1' },
        },
      },
    });

    const result = await daemon.runOnce();

    expect(result).toMatchObject({ plannedActionCount: 1, executed: { status: 'succeeded' } });
    expect(
      client.calls.filter((call) => call.method === 'createOrReplayAction').map((call) => (call.args[0] as NextAction).actionType),
    ).toEqual(['project_runtime_snapshot']);
    expect(client.calls.find((call) => call.method === 'claimNextAction')?.args[0]).toMatchObject({
      actionType: 'project_runtime_snapshot',
    });
    expect(client.calls.map((call) => call.method)).not.toContain('packageDraftsGenerationContext');
  });

  it('claims existing pending policy projection before app_server generation actions', async () => {
    const client = new FakeDaemonClient();
    const projectionIdempotencyKey = projectRuntimeSnapshotIdempotencyKey({
      automationScope: repoScope,
      repoId: 'repo-1',
      policyStatus: 'loaded',
      policyDigest: 'workflow-digest-1',
      parserVersion,
    });
    client.snapshot = baseSnapshot({
      recentActionRuns: [
        {
          id: 'pending-projection-action',
          actionType: 'project_runtime_snapshot',
          targetObjectType: 'repo',
          targetObjectId: 'repo-1',
          status: 'pending',
          idempotencyKey: projectionIdempotencyKey,
          automationScope: repoScope,
        },
      ],
      planRevisionsRequiringPackages: [packageTarget()],
    });
    client.actionToClaim = claimedProjectionAction({ id: 'pending-projection-action', idempotencyKey: projectionIdempotencyKey });
    const daemon = new AutomationDaemon({
      ...daemonOptions(client),
      generationPlanning: {
        mode: 'app_server',
        tasks: {
          package_drafts: { enabled: true, promptVersion: 'package-drafts.fake.v1', outputSchemaVersion: 'package_drafts.v1' },
        },
      },
    });

    const result = await daemon.runOnce();

    expect(result).toMatchObject({ plannedActionCount: 0, executed: { status: 'succeeded' } });
    expect(client.calls.filter((call) => call.method === 'createOrReplayAction')).toHaveLength(0);
    expect(client.calls.find((call) => call.method === 'claimNextAction')?.args[0]).toMatchObject({
      actionType: 'project_runtime_snapshot',
    });
    expect(client.calls.map((call) => call.method)).not.toContain('packageDraftsGenerationContext');
  });

  it('plans and executes Package draft actions when fake generation is enabled', async () => {
    const client = new FakeDaemonClient();
    client.snapshot = baseSnapshot({
      planRevisionsRequiringPackages: [packageTarget()],
    });
    client.actionToClaim = claimedPackageAction();
    const daemon = new AutomationDaemon({
      ...daemonOptions(client),
      generationPlanning,
      generationRuntime: createCodexGenerationRuntime({ mode: 'fake' }),
    });

    const result = await daemon.runOnce();

    expect(result).toMatchObject({ plannedActionCount: 2, executed: { status: 'succeeded' } });
    expect(client.calls.map((call) => call.method)).toEqual([
      'runtimeSnapshot',
      'createOrReplayAction',
      'createOrReplayAction',
      'claimNextAction',
      'packageDraftsGenerationContext',
      'ensurePackageDrafts',
      'completeAction',
    ]);
    expect(
      client.calls.filter((call) => call.method === 'createOrReplayAction').map((call) => (call.args[0] as NextAction).actionType),
    ).toEqual(['ensure_package_drafts', 'project_runtime_snapshot']);
  });

  it('returns no-claim backoff when nothing is claimable', async () => {
    const client = new FakeDaemonClient();
    client.snapshot = baseSnapshot({
      repos: [],
      projects: [],
    });
    client.actionToClaim = null;
    const daemon = new AutomationDaemon({
      client,
      actorId: 'daemon-actor',
      daemonIdentity: 'daemon-1',
      claimToken: 'claim-token-1',
      allowedRepoRoots: ['/workspace'],
      policyParserVersion: parserVersion,
      policyLoader: async () => loadedPolicy(),
      noClaimBackoffMs: 50,
      loopIntervalMs: 1_000,
    });

    const result = await daemon.runOnce();

    expect(result).toEqual({
      plannedActionCount: 0,
      backoffMs: 50,
      executed: {
        actionRunId: 'claim-token-1',
        status: 'skipped',
        retryable: false,
        reasonCode: 'no_claimable_action',
      },
    });
  });

  it('finishes the current iteration after stop is requested', async () => {
    const client = new FakeDaemonClient();
    let daemon!: AutomationDaemon;
    daemon = new AutomationDaemon({
      client,
      actorId: 'daemon-actor',
      daemonIdentity: 'daemon-1',
      claimToken: 'claim-token-1',
      allowedRepoRoots: ['/workspace'],
      policyParserVersion: parserVersion,
      policyLoader: async () => {
        daemon.stop();
        return loadedPolicy();
      },
      noClaimBackoffMs: 1,
      loopIntervalMs: 1,
      generationPlanning,
      generationRuntime: createCodexGenerationRuntime({ mode: 'fake' }),
      sleep: async () => undefined,
    });

    await daemon.run();

    expect(client.calls.filter((call) => call.method === 'runtimeSnapshot')).toHaveLength(1);
    expect(client.calls.map((call) => call.method)).toContain('completeAction');
  });

  it('continues after a transient iteration failure using backoff', async () => {
    const client = new FakeDaemonClient();
    client.snapshot = baseSnapshot({
      repos: [],
      projects: [],
    });
    client.actionToClaim = null;
    let attempts = 0;
    client.runtimeSnapshot = async () => {
      attempts += 1;
      client.calls.push({ method: 'runtimeSnapshot', args: [] });
      if (attempts === 1) {
        throw new Error('temporary control plane outage');
      }
      return client.snapshot;
    };
    const sleeps: number[] = [];
    let daemon!: AutomationDaemon;
    daemon = new AutomationDaemon({
      client,
      actorId: 'daemon-actor',
      daemonIdentity: 'daemon-1',
      claimToken: 'claim-token-1',
      allowedRepoRoots: ['/workspace'],
      policyParserVersion: parserVersion,
      policyLoader: async () => loadedPolicy(),
      noClaimBackoffMs: 50,
      loopIntervalMs: 1_000,
      sleep: async (ms) => {
        sleeps.push(ms);
        if (sleeps.length === 2) {
          daemon.stop();
        }
      },
    });

    await daemon.run();

    expect(attempts).toBe(2);
    expect(sleeps).toEqual([50, 50]);
    expect(client.calls.map((call) => call.method)).toContain('claimNextAction');
  });

  it('stop wakes the daemon while it is sleeping between iterations', async () => {
    const client = new FakeDaemonClient();
    client.snapshot = baseSnapshot({
      repos: [],
      projects: [],
    });
    client.actionToClaim = null;
    let sleepStarted!: () => void;
    const sleepStartedPromise = new Promise<void>((resolve) => {
      sleepStarted = resolve;
    });
    const daemon = new AutomationDaemon({
      client,
      actorId: 'daemon-actor',
      daemonIdentity: 'daemon-1',
      claimToken: 'claim-token-1',
      allowedRepoRoots: ['/workspace'],
      policyParserVersion: parserVersion,
      policyLoader: async () => loadedPolicy(),
      noClaimBackoffMs: 10_000,
      loopIntervalMs: 10_000,
      sleep: async () => {
        sleepStarted();
        await new Promise(() => undefined);
      },
    });

    const runPromise = daemon.run();
    await sleepStartedPromise;
    daemon.stop();
    const outcome = await Promise.race([
      runPromise.then(() => 'stopped'),
      new Promise<'timed_out'>((resolve) => {
        setTimeout(() => resolve('timed_out'), 50);
      }),
    ]);

    expect(outcome).toBe('stopped');
  });
});
