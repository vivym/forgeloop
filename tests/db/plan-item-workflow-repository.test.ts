import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

import { afterEach, describe, expect, it } from 'vitest';
import {
  codexCanonicalDigest,
  codexCredentialPayloadDigest,
  codexRuntimeProfileRevisionDigest,
  codexWorkspaceAcquisitionDigest,
  DomainError,
  type BoundarySummaryRevision,
  type CodexCredentialBinding,
  type CodexCredentialBindingVersion,
  type CodexDockerNetworkProxyConfig,
  type CodexLaunchTarget,
  type CodexRuntimeProfile,
  type CodexRuntimeProfileRevision,
  type CodexRuntimeScope,
  type DevelopmentPlan,
  type DevelopmentPlanItem,
  type ExecutionPackage,
  type ExecutionPlanRevision,
  type InternalArtifactObject,
  type PlanItemWorkflowQueuedAction,
  type PlanItemWorkflow,
  type PlanItemWorkflowTransition,
  type RunSession,
} from '@forgeloop/domain';

import {
  createDbClient,
  DrizzleDeliveryRepository,
  InMemoryDeliveryRepository,
  type AttachCodexSessionRunnerRuntimeJobInput,
  type CodexLaunchLease,
  type DeliveryRepository,
  assertResettableDatabaseUrl,
  resetForgeloopDatabase,
} from '../../packages/db/src/index';

const now = '2026-05-31T00:00:00.000Z';
const later = '2026-05-31T00:01:00.000Z';
const runtimeExpiresAt = '2026-05-31T00:20:00.000Z';
function isResettableDatabaseUrl(databaseUrl: string): boolean {
  try {
    assertResettableDatabaseUrl(databaseUrl);
    return true;
  } catch {
    return false;
  }
}

const drizzleDatabaseUrl = process.env.FORGELOOP_TEST_DATABASE_URL ?? process.env.FORGELOOP_DATABASE_URL;
const drizzleTest =
  drizzleDatabaseUrl !== undefined && isResettableDatabaseUrl(drizzleDatabaseUrl) ? it : it.skip;
const activePools: Array<{ end: () => Promise<void> }> = [];

interface WorkflowQueuedActionRepositoryFixture {
  workflowId: string;
  sessionId: string;
  actorId: string;
  boundaryRevisionId: string;
  specRevisionId: string;
  implementationPlanRevisionId: string;
}

afterEach(async () => {
  await Promise.all(activePools.splice(0).map((pool) => pool.end()));
});

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

const createDrizzleWorkflowRepository = async () => {
  if (drizzleDatabaseUrl === undefined) {
    throw new Error('Expected FORGELOOP_TEST_DATABASE_URL or FORGELOOP_DATABASE_URL');
  }
  await resetForgeloopDatabase(drizzleDatabaseUrl);
  const { db, pool } = createDbClient({ connectionString: drizzleDatabaseUrl });
  activePools.push(pool);
  const repository = new DrizzleDeliveryRepository(db);
  await seedDrizzleWorkflowParents(repository);
  return repository;
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

const baseDevelopmentPlanItem: DevelopmentPlanItem = {
  id: 'item-1',
  development_plan_id: 'plan-1',
  revision_id: 'item-revision-1',
  source_ref: { type: 'requirement', id: 'requirement-1' },
  title: 'Workflow item',
  summary: 'Exercise workflow persistence.',
  driver_actor_id: 'actor-product',
  responsible_role: 'developer',
  reviewer_actor_id: 'actor-tech',
  leader_actor_id: 'actor-tech',
  leader_delegate_actor_ids: [],
  risk: 'medium',
  dependency_hints: [],
  affected_surfaces: ['packages/db'],
  boundary_status: 'not_started',
  spec_status: 'missing',
  implementation_plan_status: 'missing',
  execution_status: 'not_started',
  review_status: 'missing',
  qa_handoff_status: 'missing',
  release_impact: 'none',
  next_action: 'Start workflow.',
  created_at: now,
  updated_at: now,
};

const turnInput = {
  id: 'turn-1',
  codex_session_id: 'session-1',
  workflow_id: 'workflow-1',
  intent: 'continue_execution',
  status: 'running',
  input_digest: 'sha256:turn-input',
  expected_input_capsule_digest: undefined,
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
  expected_input_capsule_digest: undefined,
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

const queuedActionFixture = (
  fixture: WorkflowQueuedActionRepositoryFixture,
  overrides: Partial<PlanItemWorkflowQueuedAction> = {},
): PlanItemWorkflowQueuedAction => ({
  id: testUuid('plan-item-workflow-action-1'),
  workflow_id: fixture.workflowId,
  codex_session_id: fixture.sessionId,
  kind: 'generate_spec_doc',
  status: 'queued',
  source_revision_id: fixture.boundaryRevisionId,
  expected_input_capsule_digest: `sha256:${'a'.repeat(64)}`,
  context_preview_digest: `sha256:${'b'.repeat(64)}`,
  idempotency_key: `sha256:${'c'.repeat(64)}`,
  created_by_actor_id: fixture.actorId,
  created_at: '2026-06-03T00:00:00.000Z',
  updated_at: '2026-06-03T00:00:00.000Z',
  ...overrides,
});

const workflowQueuedActionRepositoryContract = (
  createRepository: () => Promise<{ repository: DeliveryRepository; fixture: WorkflowQueuedActionRepositoryFixture }>,
  testCase: typeof it = it,
) => {
  testCase('records workflow messages before attaching queued actions', async () => {
    const { repository, fixture } = await createRepository();
    const messageId = testUuid('plan-item-workflow-message-1');
    const action = queuedActionFixture(fixture, {
      id: testUuid('plan-item-workflow-action-from-message'),
      created_from_message_id: messageId,
      idempotency_key: `sha256:${'9'.repeat(64)}`,
    });
    await repository.savePlanItemWorkflowMessage({
      id: messageId,
      workflow_id: fixture.workflowId,
      codex_session_id: fixture.sessionId,
      actor_id: fixture.actorId,
      action: 'answer_boundary_question',
      body_markdown: 'Scope is API and UI.',
      client_message_id: 'client-message-1',
      created_at: '2026-06-03T00:00:00.000Z',
    });
    await repository.createOrReplayPlanItemWorkflowQueuedAction(action);

    const updated = await repository.attachPlanItemWorkflowMessageQueuedAction({
      workflow_id: fixture.workflowId,
      message_id: messageId,
      queued_action_id: action.id,
    });

    expect(updated).toMatchObject({
      id: messageId,
      client_message_id: 'client-message-1',
      created_queued_action_id: action.id,
    });
    await expect(repository.listPlanItemWorkflowMessages(fixture.workflowId)).resolves.toEqual([updated]);
  });

  testCase('creates or replays workflow queued actions by scoped idempotency key', async () => {
    const { repository, fixture } = await createRepository();
    const input = queuedActionFixture(fixture);

    const first = await repository.createOrReplayPlanItemWorkflowQueuedAction(input);
    const second = await repository.createOrReplayPlanItemWorkflowQueuedAction({
      ...input,
      id: testUuid('plan-item-workflow-action-duplicate'),
    });

    expect(second.id).toBe(first.id);
    await expect(repository.listPlanItemWorkflowQueuedActions(fixture.workflowId)).resolves.toEqual([first]);
    await expect(repository.listActivePlanItemWorkflowQueuedActions(fixture.workflowId)).resolves.toEqual([first]);
  });

  testCase('claims queued action by compare-and-set and replays duplicate run claims', async () => {
    const { repository, fixture } = await createRepository();
    const action = await repository.createOrReplayPlanItemWorkflowQueuedAction(queuedActionFixture(fixture));

    const first = await repository.claimOrReplayPlanItemWorkflowQueuedActionRun({
      workflow_id: action.workflow_id,
      action_id: action.id,
      now: '2026-06-03T00:01:00.000Z',
    });

    expect(first).toMatchObject({
      claimed: true,
      action: expect.objectContaining({ id: action.id, status: 'running', updated_at: '2026-06-03T00:01:00.000Z' }),
    });

    const second = await repository.claimOrReplayPlanItemWorkflowQueuedActionRun({
      workflow_id: action.workflow_id,
      action_id: action.id,
      now: '2026-06-03T00:01:01.000Z',
    });

    expect(second).toMatchObject({
      claimed: false,
      action: expect.objectContaining({ id: action.id, status: 'running', updated_at: '2026-06-03T00:01:00.000Z' }),
    });
  });

  testCase('marks dependent queued actions stale during request-changes cascade', async () => {
    const { repository, fixture } = await createRepository();
    const specAction = await repository.createOrReplayPlanItemWorkflowQueuedAction(
      queuedActionFixture(fixture, {
        id: testUuid('plan-item-workflow-action-spec'),
        kind: 'generate_spec_doc',
        source_revision_id: fixture.boundaryRevisionId,
        idempotency_key: `sha256:${'d'.repeat(64)}`,
        created_at: '2026-06-03T00:00:00.000Z',
        updated_at: '2026-06-03T00:00:00.000Z',
      }),
    );
    const planAction = await repository.createOrReplayPlanItemWorkflowQueuedAction(
      queuedActionFixture(fixture, {
        id: testUuid('plan-item-workflow-action-plan'),
        kind: 'generate_implementation_plan_doc',
        source_revision_id: fixture.specRevisionId,
        idempotency_key: `sha256:${'e'.repeat(64)}`,
        created_at: '2026-06-03T00:00:01.000Z',
        updated_at: '2026-06-03T00:00:01.000Z',
      }),
    );
    await repository.createOrReplayPlanItemWorkflowQueuedAction(
      queuedActionFixture(fixture, {
        id: testUuid('plan-item-workflow-action-running'),
        kind: 'generate_spec_doc',
        source_revision_id: fixture.boundaryRevisionId,
        idempotency_key: `sha256:${'f'.repeat(64)}`,
        created_at: '2026-06-03T00:00:02.000Z',
        updated_at: '2026-06-03T00:00:02.000Z',
      }),
    );
    await repository.claimOrReplayPlanItemWorkflowQueuedActionRun({
      workflow_id: fixture.workflowId,
      action_id: testUuid('plan-item-workflow-action-running'),
      now: '2026-06-03T00:01:00.000Z',
    });

    const stale = await repository.markDependentPlanItemWorkflowQueuedActionsStale({
      workflow_id: specAction.workflow_id,
      reason: 'boundary_changes_requested',
      action_kinds: ['generate_spec_doc', 'generate_implementation_plan_doc'],
      now: '2026-06-03T00:02:00.000Z',
    });

    expect(stale.map((action) => action.id)).toEqual([specAction.id, planAction.id]);
    await expect(
      repository.getPlanItemWorkflowQueuedAction({
        workflow_id: fixture.workflowId,
        action_id: testUuid('plan-item-workflow-action-running'),
      }),
    ).resolves.toMatchObject({ status: 'running' });
  });
};

const tokenHash = (token: string) => codexCredentialPayloadDigest(token);
const bytesDigest = (bytes: Uint8Array | string) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const testUuid = (seed: string): string => {
  const hex = createHash('sha256').update(seed).digest('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

const workspaceBundleArchiveFixture = (input: { bundle_id: string; created_at?: string; files?: Record<string, string> }) => {
  const files = Object.entries(input.files ?? { 'README.md': 'workspace bundle fixture\n' }).map(([path, content]) => {
    const bytes = Buffer.from(content, 'utf8');
    return {
      path,
      type: 'file',
      digest: bytesDigest(bytes),
      size_bytes: bytes.byteLength,
    };
  });
  const manifest = {
    schema_version: 'workspace_bundle.v1',
    bundle_id: input.bundle_id,
    created_at: input.created_at ?? now,
    allowed_paths: ['**'],
    forbidden_paths: [],
    entries: files.sort((left, right) => left.path.localeCompare(right.path) || left.type.localeCompare(right.type)),
  };
  const archive = Buffer.from(
    JSON.stringify({
      schema_version: 'workspace_bundle_archive.v1',
      manifest,
      entries: Object.entries(input.files ?? { 'README.md': 'workspace bundle fixture\n' })
        .map(([path, content]) => ({
          path,
          type: 'file',
          content_base64: Buffer.from(content, 'utf8').toString('base64'),
        }))
        .sort((left, right) => left.path.localeCompare(right.path) || left.type.localeCompare(right.type)),
    }),
    'utf8',
  );
  return {
    archive,
    archive_digest: bytesDigest(archive),
    manifest_digest: bytesDigest(JSON.stringify(manifest)),
  };
};

const dockerProxyConfig = (): CodexDockerNetworkProxyConfig => {
  const configWithoutDigest = {
    proxy_image: 'ghcr.io/forgeloop/codex-net-proxy',
    proxy_image_digest: `sha256:${'1'.repeat(64)}`,
    self_test_image: 'ghcr.io/forgeloop/codex-net-self-test',
    self_test_image_digest: `sha256:${'2'.repeat(64)}`,
  };

  return {
    ...configWithoutDigest,
    provider_config_digest: codexCanonicalDigest(configWithoutDigest),
  };
};

const dockerProxyNetworkPolicy = () => {
  const allowlistRules = [
    {
      id: 'openai',
      protocol: 'https' as const,
      host: 'api.openai.com',
      purpose: 'model_provider' as const,
    },
  ];
  return {
    mode: 'egress_allowlist' as const,
    provider: 'docker_network_proxy' as const,
    allowlist_rules: allowlistRules,
    provider_config: dockerProxyConfig(),
    egress_allowlist_digest: codexCanonicalDigest({
      provider: 'docker_network_proxy',
      allowlist_rules: allowlistRules,
    }),
    self_test_digest: dockerProxyConfig().self_test_image_digest,
  };
};

const runtimeProfileRevision = (
  overrides: Partial<CodexRuntimeProfileRevision> = {},
): { profile: CodexRuntimeProfile; revision: CodexRuntimeProfileRevision } => {
  const targetKind = overrides.target_kind ?? 'run_execution';
  const sourceAccessMode = overrides.source_access_mode ?? 'path_policy_scoped';
  const profile: CodexRuntimeProfile = {
    id: overrides.profile_id ?? `runtime-profile-${targetKind}`,
    name: 'Codex run execution docker runtime',
    environment: overrides.environment ?? 'test',
    target_kind: targetKind,
    active_revision_id: overrides.id ?? `runtime-profile-revision-${targetKind}`,
    created_by_actor_id: overrides.created_by_actor_id ?? 'actor-admin',
    created_at: overrides.created_at ?? now,
    updated_at: overrides.created_at ?? now,
  };
  const codexConfigToml = overrides.codex_config_toml ?? 'model = "gpt-5"\napproval_policy = "never"\n';
  const revisionWithoutDigest: CodexRuntimeProfileRevision = {
    id: profile.active_revision_id ?? 'runtime-profile-revision-run_execution',
    profile_id: profile.id,
    revision_number: overrides.revision_number ?? 1,
    status: overrides.status ?? 'active',
    environment: profile.environment,
    docker_image: overrides.docker_image ?? 'ghcr.io/forgeloop/codex-runtime',
    docker_image_digest: overrides.docker_image_digest ?? `sha256:${'a'.repeat(64)}`,
    target_kind: profile.target_kind,
    source_access_mode: sourceAccessMode,
    codex_config_toml: codexConfigToml,
    codex_config_digest: overrides.codex_config_digest ?? codexCanonicalDigest(codexConfigToml),
    expected_effective_config_digest: overrides.expected_effective_config_digest ?? `sha256:${'b'.repeat(64)}`,
    effective_config_assertions:
      overrides.effective_config_assertions ??
      (targetKind === 'generation'
        ? {
            target_kind: 'generation',
            approval_policy: 'never',
            source_write_policy: 'artifact_only',
            forbidden_writable_roots: ['workspace'],
          }
        : {
            target_kind: 'run_execution',
            approval_policy: 'never',
            sandbox_type: 'danger-full-access',
            writable_roots_policy: 'task_workspace_only',
          }),
    app_server_required: true,
    allowed_driver_kind: 'app_server',
    network_policy: overrides.network_policy ?? dockerProxyNetworkPolicy(),
    resource_limits: overrides.resource_limits ?? {
      cpu_ms: 120_000,
      memory_mb: 4096,
      pids: 512,
      fds: 1024,
      workspace_bytes: 2_000_000_000,
      artifact_bytes: 500_000_000,
      timeout_ms: 600_000,
      output_limit_bytes: 1_000_000,
      run_output_limit_bytes: 1_000_000,
    },
    docker_policy: overrides.docker_policy ?? {
      app_server_only: true,
      rootless: true,
      read_only_rootfs: true,
      no_new_privileges: true,
      drop_capabilities: ['ALL'],
    },
    allowed_scopes: overrides.allowed_scopes ?? [{ project_id: 'project-1', repo_id: 'repo-1' }],
    profile_digest: `sha256:${'c'.repeat(64)}`,
    created_by_actor_id: profile.created_by_actor_id,
    created_at: overrides.created_at ?? now,
  };
  const revision = {
    ...revisionWithoutDigest,
    ...overrides,
    profile_digest: codexRuntimeProfileRevisionDigest({ ...revisionWithoutDigest, ...overrides }),
  };

  return { profile, revision };
};

const runtimeCredential = (
  overrides: Partial<CodexCredentialBinding> = {},
  versionOverrides: Partial<CodexCredentialBindingVersion> = {},
) => {
  const secretPayload = {
    env: {
      OPENAI_API_KEY: 'sk-test-private-key',
    },
  };
  const binding: CodexCredentialBinding = {
    id: overrides.id ?? 'credential-binding-run_execution',
    profile_id: overrides.profile_id ?? 'runtime-profile-run_execution',
    project_id: overrides.project_id ?? 'project-1',
    repo_id: overrides.repo_id ?? 'repo-1',
    provider: overrides.provider ?? 'unsafe_db',
    purpose: overrides.purpose ?? 'model_provider',
    active_version_id: versionOverrides.id ?? 'credential-version-run_execution',
    created_by_actor_id: overrides.created_by_actor_id ?? 'actor-admin',
    created_at: overrides.created_at ?? now,
    updated_at: overrides.updated_at ?? now,
  };
  const version: CodexCredentialBindingVersion = {
    id: binding.active_version_id ?? 'credential-version-run_execution',
    binding_id: binding.id,
    version_number: versionOverrides.version_number ?? 1,
    status: versionOverrides.status ?? 'active',
    payload_digest: versionOverrides.payload_digest ?? codexCredentialPayloadDigest(secretPayload),
    created_by_actor_id: versionOverrides.created_by_actor_id ?? 'actor-admin',
    created_at: versionOverrides.created_at ?? now,
  };

  return { binding, version, secretPayload };
};

const runExecutionTarget = (overrides: Partial<CodexLaunchTarget> = {}): CodexLaunchTarget => ({
  target_type: overrides.target_type ?? 'run_session',
  target_id: overrides.target_id ?? 'session-1',
  target_kind: overrides.target_kind ?? 'run_execution',
  project_id: overrides.project_id ?? 'project-1',
  repo_id: overrides.repo_id ?? 'repo-1',
});

const executionPackage = (overrides: Partial<ExecutionPackage> = {}): ExecutionPackage => ({
  id: overrides.id ?? 'execution-package-1',
  work_item_id: overrides.work_item_id ?? 'item-1',
  development_plan_item_id: overrides.development_plan_item_id ?? 'item-1',
  workflow_id: overrides.workflow_id ?? 'workflow-1',
  codex_session_id: overrides.codex_session_id ?? 'session-1',
  codex_session_turn_id: overrides.codex_session_turn_id ?? 'turn-1',
  spec_id: overrides.spec_id ?? 'spec-1',
  spec_revision_id: overrides.spec_revision_id ?? 'spec-revision-1',
  plan_id: overrides.plan_id ?? 'plan-1',
  plan_revision_id: overrides.plan_revision_id ?? 'plan-revision-1',
  project_id: overrides.project_id ?? 'project-1',
  repo_id: overrides.repo_id ?? 'repo-1',
  objective: overrides.objective ?? 'Continue Codex session.',
  owner_actor_id: overrides.owner_actor_id ?? 'actor-owner',
  reviewer_actor_id: overrides.reviewer_actor_id ?? 'actor-reviewer',
  qa_owner_actor_id: overrides.qa_owner_actor_id ?? 'actor-qa',
  phase: overrides.phase ?? 'execution',
  activity_state: overrides.activity_state ?? 'idle',
  gate_state: overrides.gate_state ?? 'not_submitted',
  resolution: overrides.resolution ?? 'none',
  required_checks: overrides.required_checks ?? [],
  required_artifact_kinds: overrides.required_artifact_kinds ?? ['execution_summary'],
  allowed_paths: overrides.allowed_paths ?? ['packages/**'],
  forbidden_paths: overrides.forbidden_paths ?? [],
  source_mutation_policy: overrides.source_mutation_policy ?? 'path_policy_scoped',
  version: overrides.version ?? 1,
  created_at: overrides.created_at ?? now,
  updated_at: overrides.updated_at ?? now,
});

const runSession = (overrides: Partial<RunSession> = {}): RunSession => ({
  id: overrides.id ?? 'runtime-run-session-1',
  execution_package_id: overrides.execution_package_id ?? 'execution-package-1',
  workflow_id: overrides.workflow_id ?? 'workflow-1',
  codex_session_id: overrides.codex_session_id ?? 'session-1',
  codex_session_turn_id: overrides.codex_session_turn_id ?? 'turn-1',
  requested_by_actor_id: overrides.requested_by_actor_id ?? 'actor-owner',
  status: overrides.status ?? 'running',
  changed_files: overrides.changed_files ?? [],
  check_results: overrides.check_results ?? [],
  artifacts: overrides.artifacts ?? [],
  log_refs: overrides.log_refs ?? [],
  runtime_metadata:
    overrides.runtime_metadata ??
    {
      durability_mode: 'durable',
      recovery_attempt_count: 0,
      effective_dangerous_mode: 'confirmed',
    },
  created_at: overrides.created_at ?? now,
  updated_at: overrides.updated_at ?? now,
  started_at: overrides.started_at ?? now,
});

const workflowRunExecutionWorkload = (
  overrides: {
    runtime_job_id?: string;
    workflow_id?: string;
    codex_session_id?: string;
    codex_session_turn_id?: string;
    run_session_id?: string;
    execution_package_id?: string;
    execution_package_version?: number;
  } = {},
): Record<string, unknown> => {
  const workflowId = overrides.workflow_id ?? 'workflow-1';
  const codexSessionId = overrides.codex_session_id ?? 'session-1';
  const codexSessionTurnId = overrides.codex_session_turn_id ?? 'turn-1';

  return {
    schema_version: 'codex_run_execution_workload.v1',
    runtime_job_id: overrides.runtime_job_id ?? 'attached-runtime-job-1',
    plan_item_workflow_id: workflowId,
    development_plan_id: 'plan-1',
    development_plan_item_id: 'item-1',
    run_session_id: overrides.run_session_id ?? 'runtime-run-session-1',
    execution_package_id: overrides.execution_package_id ?? 'execution-package-1',
    execution_package_version: overrides.execution_package_version ?? 1,
    workspace_bundle_id: 'attached-pending-bundle-1',
    workspace_bundle_digest: `sha256:${'4'.repeat(64)}`,
    package_prompt_ref: 'artifact://codex-runtime-jobs/attached-runtime-job-1/prompt',
    package_prompt_digest: `sha256:${'5'.repeat(64)}`,
    execution_context_ref: 'artifact://codex-runtime-jobs/attached-runtime-job-1/context',
    execution_context_digest: `sha256:${'6'.repeat(64)}`,
    path_policy_digest: `sha256:${'7'.repeat(64)}`,
    output_schema_version: 'codex_run_execution_result.v1',
    created_at: now,
    expires_at: runtimeExpiresAt,
    workspace_acquisition_json: {
      manifest_digest: `sha256:${'8'.repeat(64)}`,
      size_bytes: 128,
    },
    codex_session_runtime_context: {
      schema_version: 'codex_session_runtime_context.v1',
      codex_session_id: codexSessionId,
      codex_session_turn_id: codexSessionTurnId,
      lease_id: 'lease-1',
      lease_epoch: 1,
      worker_id: 'worker-drizzle',
      worker_session_digest: tokenHash('session-token-1'),
      expected_input_capsule_digest: `sha256:${'1'.repeat(64)}`,
      turn_group_status: 'complete',
      continuation: {
        kind: 'resume_thread',
        codex_thread_id: 'thread-1',
        codex_thread_id_digest: codexCanonicalDigest({ kind: 'codex_app_server_thread_id', thread_id: 'thread-1' }),
      },
    },
    codex_session_terminalization: {
      schema_version: 'codex_session_terminalization.v1',
      lease_token: 'lease-token-secret',
      codex_session_id: codexSessionId,
      codex_session_turn_id: codexSessionTurnId,
      expected_input_capsule_digest: `sha256:${'1'.repeat(64)}`,
      input_capsule_id: 'capsule-1',
      input_capsule_ref: 'artifact://internal/codex_runtime_capsule/codex_session/session-1/capsule-1',
      input_capsule_digest: `sha256:${'1'.repeat(64)}`,
      input_memory_bundle_ref: 'artifact://internal/codex_memory_bundle/codex_session/session-1/memory-1',
      input_memory_bundle_digest: `sha256:${'2'.repeat(64)}`,
      input_environment_manifest_ref: 'artifact://internal/codex_environment_manifest/codex_session/session-1/env-1',
      input_environment_manifest_digest: `sha256:${'3'.repeat(64)}`,
    },
  };
};

const createInternalArtifactObject = (
  repository: DeliveryRepository,
  input: {
    id: string;
    artifact_id: string;
    ref: string;
    kind: InternalArtifactObject['kind'];
    owner_type: InternalArtifactObject['owner_type'];
    owner_id: string;
    size_bytes: number;
    digest: string;
    metadata_json?: Record<string, unknown>;
    idempotency_key?: string;
    content_type?: string;
    created_by_actor_type?: InternalArtifactObject['created_by_actor_type'];
    created_by_actor_id?: string;
  },
) =>
  repository.createOrReplayInternalArtifactObject({
    id: input.id,
    artifact_id: input.artifact_id,
    ref: input.ref,
    storage_key: `objects/${input.digest.slice('sha256:'.length)}`,
    kind: input.kind,
    content_type: input.content_type ?? 'application/vnd.forgeloop.workspace-bundle',
    size_bytes: String(input.size_bytes),
    digest: input.digest,
    visibility: 'internal',
    owner_type: input.owner_type,
    owner_id: input.owner_id,
    idempotency_key: input.idempotency_key ?? input.artifact_id,
    request_digest: tokenHash(`internal-object-request:${input.id}`),
    metadata_json: input.metadata_json ?? {},
    created_by_actor_type: input.created_by_actor_type ?? 'run_worker',
    created_by_actor_id: input.created_by_actor_id ?? 'run-worker-1',
    created_at: now,
  });

const seedRuntimeWorker = async (
  repository: DeliveryRepository,
  overrides: {
    worker_id?: string;
    worker_identity?: string;
    bootstrap_token_id?: string;
    bootstrap_token_raw?: string;
    session_token?: string;
    session_expires_at?: string;
    session_public_key_expires_at?: string;
    capabilities?: readonly CodexLaunchTarget['target_kind'][];
    allowedScopes?: readonly CodexRuntimeScope[];
    docker_image_digests?: readonly string[];
    network_policy_digests?: readonly string[];
    network_provider_config_digests?: readonly string[];
    lease_count?: number;
    max_concurrency?: number;
  } = {},
) => {
  const workerId = overrides.worker_id ?? 'worker-1';
  const workerIdentity = overrides.worker_identity ?? (workerId === 'worker-1' ? 'local-worker-1' : `local-${workerId}`);
  const bootstrapTokenRaw = overrides.bootstrap_token_raw ?? 'bootstrap-token-raw';
  const sessionToken = overrides.session_token ?? 'session-token-1';
  const capabilities = overrides.capabilities ?? ['run_execution'];
  const allowedScopes = overrides.allowedScopes ?? [{ project_id: 'project-1', repo_id: 'repo-1' }];
  const dockerImageDigests = overrides.docker_image_digests ?? [`sha256:${'a'.repeat(64)}`];
  const networkPolicyDigests = overrides.network_policy_digests ?? [codexCanonicalDigest(runtimeProfileRevision().revision.network_policy)];
  const networkProviderConfigDigests = overrides.network_provider_config_digests ?? [dockerProxyConfig().provider_config_digest];
  await repository.createCodexWorkerBootstrapToken({
    id: overrides.bootstrap_token_id ?? `bootstrap-token-${workerId}`,
    worker_identity: workerIdentity,
    bootstrap_token_hash: tokenHash(bootstrapTokenRaw),
    bootstrap_token_version: 1,
    status: 'active',
    allowed_scopes_json: allowedScopes,
    allowed_capabilities_json: {
      target_kinds: capabilities,
      docker_image_digests: dockerImageDigests,
      network_policy_digests: networkPolicyDigests,
      network_provider_config_digests: networkProviderConfigDigests,
    },
    created_by_actor_id: 'actor-admin',
    created_at: now,
    expires_at: runtimeExpiresAt,
  });

  const worker = await repository.upsertCodexWorkerRegistration({
    worker_id: workerId,
    worker_identity: workerIdentity,
    version: '0.1.0',
    bootstrap_token_hash: tokenHash(bootstrapTokenRaw),
    bootstrap_token_version: 1,
    session_token: sessionToken,
    session_expires_at: overrides.session_expires_at ?? runtimeExpiresAt,
    status: 'online',
    control_channel_status: 'connected',
    allowed_scopes: allowedScopes,
    capabilities,
    docker_image_digests: dockerImageDigests,
    network_policy_digests: networkPolicyDigests,
    network_provider_config_digests: networkProviderConfigDigests,
    host_worker_uid: 501,
    host_worker_gid: 20,
    lease_count: overrides.lease_count ?? 0,
    max_concurrency: overrides.max_concurrency ?? 2,
    labels: { host: 'test-host' },
    session_public_key_id: 'session-key-1',
    session_public_key_algorithm: 'x25519',
    session_public_key_material: 'public-key-material',
    session_public_key_expires_at: overrides.session_public_key_expires_at ?? runtimeExpiresAt,
    now,
  });
  await repository.heartbeatCodexWorker({
    worker_id: worker.id,
    session_token: sessionToken,
    nonce: `runtime-worker-heartbeat-${worker.id}`,
    nonce_timestamp: now,
    status: 'online',
    control_channel_status: 'connected',
    active_lease_count: 0,
    capabilities,
    now,
  });

  return { worker, sessionToken };
};

const createAcceptedSessionRuntimeJob = async (
  repository: DeliveryRepository,
  overrides: Partial<Parameters<DeliveryRepository['createOrReplayCodexRuntimeJobWithLeaseAndEnvelope']>[0]> = {},
) => {
  const { profile, revision } = runtimeProfileRevision();
  const { binding, version, secretPayload } = runtimeCredential({ profile_id: profile.id });
  await repository.createCodexRuntimeProfileWithRevision({ profile, revision });
  await repository.createCodexCredentialBindingWithVersion({
    binding,
    version,
    secret_payload_json: secretPayload,
  });
  const runtimeJobId = overrides.runtime_job_id ?? 'attached-runtime-job-1';
  const runSessionId = runtimeJobId === 'attached-runtime-job-1' ? 'runtime-run-session-1' : `runtime-run-session-${runtimeJobId}`;
  const bundleId = runtimeJobId === 'attached-runtime-job-1' ? 'attached-pending-bundle-1' : `attached-pending-bundle-${runtimeJobId}`;
  const bundleObjectId =
    runtimeJobId === 'attached-runtime-job-1'
      ? '22222222-2222-4222-8222-222222222223'
      : testUuid(`artifact-object:${runtimeJobId}`);
  const pendingBundleId =
    runtimeJobId === 'attached-runtime-job-1'
      ? '22222222-2222-4222-8222-222222222222'
      : testUuid(`pending-bundle:${runtimeJobId}`);
  const runWorkerLeaseToken = `run-worker-token-${runtimeJobId}`;
  const target = overrides.target ?? runExecutionTarget({ target_id: runSessionId });
  const isWorkflowExecutionWorkload = overrides.input_json?.schema_version === 'codex_run_execution_workload.v1';
  const run = runSession({
    id: target.target_id,
    execution_package_id: overrides.execution_package_id ?? 'execution-package-1',
  });
  if (!isWorkflowExecutionWorkload) {
    delete run.codex_session_id;
    delete run.codex_session_turn_id;
  }
  await repository.saveExecutionPackage(executionPackage({ id: run.execution_package_id }));
  await repository.saveRunSession(run);
  const runWorkerLease = await repository.claimRunWorkerLease({
    run_session_id: run.id,
    worker_id: 'run-worker-1',
    lease_token: runWorkerLeaseToken,
    now,
    expires_at: runtimeExpiresAt,
  });
  const archiveFixture = workspaceBundleArchiveFixture({ bundle_id: bundleId });
  const workspaceAcquisitionJson = {
    schema_version: 'workspace_bundle_acquisition.v1',
    bundle_id: bundleId,
    archive_ref: `artifact://internal/workspace_bundle/run_session/${run.id}/${bundleId}`,
    archive_digest: archiveFixture.archive_digest,
    manifest_digest: archiveFixture.manifest_digest,
    size_bytes: archiveFixture.archive.byteLength,
    expires_at: runtimeExpiresAt,
  };
  const pendingBundle = {
    bundle_id: bundleId,
    pending_artifact_ref: workspaceAcquisitionJson.archive_ref,
    internal_artifact_object_id: bundleObjectId,
    archive_digest: workspaceAcquisitionJson.archive_digest,
    manifest_digest: workspaceAcquisitionJson.manifest_digest,
    run_worker_lease_id: runWorkerLease.id,
    size_bytes: archiveFixture.archive.byteLength,
    workspace_acquisition_digest: codexWorkspaceAcquisitionDigest(workspaceAcquisitionJson)!,
    workspace_acquisition_json: workspaceAcquisitionJson,
    expires_at: runtimeExpiresAt,
  };
  await createInternalArtifactObject(repository, {
    id: pendingBundle.internal_artifact_object_id,
    artifact_id: pendingBundle.bundle_id,
    ref: pendingBundle.pending_artifact_ref,
    kind: 'workspace_bundle',
    owner_type: 'run_session',
    owner_id: run.id,
    size_bytes: pendingBundle.size_bytes,
    digest: pendingBundle.archive_digest,
    metadata_json: {
      manifest_digest: pendingBundle.manifest_digest,
      execution_package_id: run.execution_package_id,
      run_worker_lease_id: runWorkerLease.id,
    },
  });
  const pendingBundleRecord = {
    ...pendingBundle,
    id: pendingBundleId,
    run_session_id: run.id,
    execution_package_id: run.execution_package_id,
    request_digest: tokenHash(`attached-pending-workspace-request-${runtimeJobId}`),
    created_at: now,
  };
  await repository.createPendingWorkspaceBundleArtifact(pendingBundleRecord);
  const reusableWorker = await repository.findAvailableCodexWorker({
      project_id: target.project_id,
      ...(target.repo_id === undefined ? {} : { repo_id: target.repo_id }),
      target_kind: target.target_kind,
      docker_image_digest: revision.docker_image_digest,
      network_policy_digest: codexCanonicalDigest(revision.network_policy),
      network_provider_config_digest: dockerProxyConfig().provider_config_digest,
      now,
    });
  const worker =
    reusableWorker?.id === 'worker-1'
      ? reusableWorker
      : (
          await seedRuntimeWorker(repository, {
            capabilities: [target.target_kind],
            docker_image_digests: [revision.docker_image_digest],
            network_policy_digests: [codexCanonicalDigest(revision.network_policy)],
            network_provider_config_digests: [dockerProxyConfig().provider_config_digest],
          })
        ).worker;
  const sessionToken = 'session-token-1';
  const input = {
    runtime_job_id: runtimeJobId,
    launch_lease_id: 'attached-launch-lease-1',
    envelope_id: 'attached-runtime-envelope-1',
    job_request_id: 'attached-runtime-job-request-1',
    target,
    launch_attempt: 1,
    worker_id: worker.id,
    runtime_profile_revision_id: revision.id,
    runtime_profile_digest: revision.profile_digest,
    credential_binding_id: binding.id,
    credential_binding_version_id: version.id,
    credential_payload_digest: version.payload_digest,
    docker_image_digest: revision.docker_image_digest,
    network_policy_digest: codexCanonicalDigest(revision.network_policy),
    network_provider_config_digest: dockerProxyConfig().provider_config_digest,
    input_json: { codex_session_id: 'session-1', task: 'continue Codex session' },
    input_digest: tokenHash('attached-runtime-input-1'),
    workspace_acquisition_json: pendingBundle.workspace_acquisition_json,
    workspace_acquisition_digest: pendingBundle.workspace_acquisition_digest,
    pending_workspace_bundle: pendingBundleRecord,
    execution_package_id: run.execution_package_id,
    run_worker_lease_id: runWorkerLease.id,
    run_worker_lease_token_hash: tokenHash(runWorkerLeaseToken),
    run_session_status: 'running',
    run_session_updated_at: now,
    execution_package_version: 1,
    workflow_id: 'workflow-1',
    codex_session_id: 'session-1',
    codex_session_turn_id: 'turn-1',
    expires_at: runtimeExpiresAt,
    now: '2026-05-31T00:04:00.000Z',
    ...overrides,
  };
  await repository.createOrReplayCodexRuntimeJobWithLeaseAndEnvelope(input);
  const accepted = await repository.acceptCodexRuntimeJob({
    runtime_job_id: input.runtime_job_id,
    worker_id: worker.id,
    worker_session_token: sessionToken,
    nonce: `accept-nonce-${input.runtime_job_id}`,
    nonce_timestamp: later,
    accepted_worker_session_digest: tokenHash(sessionToken),
    accepted_session_public_key_id: 'session-key-1',
    accepted_session_epoch: 1,
    idempotency_key: `accept-${input.runtime_job_id}`,
    request_digest: tokenHash(`accept-request-${input.runtime_job_id}`),
    now: later,
  });

  return { input, accepted };
};

const codexSessionRuntimeContextInput = (
  continuation: Record<string, unknown>,
  contextOverrides: Record<string, unknown> = {},
): Record<string, unknown> => {
  const context = {
    schema_version: 'codex_session_runtime_context.v1',
    codex_session_id: 'session-1',
    codex_session_turn_id: 'turn-1',
    lease_id: 'lease-1',
    lease_epoch: 1,
    worker_id: 'worker-1',
    worker_session_digest: tokenHash('session-token-1'),
    ...(continuation.kind === 'resume_thread'
      ? {
          runner_runtime_job_id: 'runtime-job-1',
          runner_launch_lease_id: 'launch-lease-1',
        }
      : {}),
    turn_group_status: 'intermediate',
    ...contextOverrides,
    continuation,
  };
  return {
    codex_session_runtime_context: context,
    task: 'continue Codex session',
  };
};

const resumeThreadRuntimeInput = (contextOverrides: Record<string, unknown> = {}): Record<string, unknown> =>
  codexSessionRuntimeContextInput(
    {
      kind: 'resume_thread',
      codex_thread_id: 'thread-1',
      codex_thread_id_digest: codexCanonicalDigest({ kind: 'codex_app_server_thread_id', thread_id: 'thread-1' }),
    },
    contextOverrides,
  );

const staleResumeThreadRuntimeInput = (contextOverrides: Record<string, unknown> = {}): Record<string, unknown> =>
  codexSessionRuntimeContextInput(
    {
      kind: 'resume_thread',
      codex_thread_id: 'thread-2',
      codex_thread_id_digest: codexCanonicalDigest({ kind: 'codex_app_server_thread_id', thread_id: 'thread-2' }),
    },
    contextOverrides,
  );

const startThreadRuntimeInput = (): Record<string, unknown> =>
  codexSessionRuntimeContextInput({
    kind: 'start_thread',
  });

const validGenerationTerminalResult = (summary = 'completed') => {
  const generatedPayload = { summary };
  return {
    task_kind: 'spec_draft' as const,
    prompt_version: 'prompt-v1',
    output_schema_version: 'spec-draft.v1',
    generated_payload: generatedPayload,
    generated_payload_digest: codexCanonicalDigest(generatedPayload),
    generation_artifacts: [],
    public_summary: summary,
  };
};

const replayProtectionFor = (path: string, bodyDigest: string) => ({
  method: 'POST' as const,
  path,
  body_digest: bodyDigest,
});

const attachCodexSessionRunnerRuntimeJob = (
  repository: DeliveryRepository,
  input: Omit<AttachCodexSessionRunnerRuntimeJobInput, 'worker_session_token' | 'nonce' | 'nonce_timestamp' | 'replay_protection'> & {
    nonce?: string;
    worker_session_token?: string;
  },
) => {
  const nonce = input.nonce ?? `attach-nonce-${input.attached_runtime_job_id}-${input.idempotency_key}`;
  return repository.attachCodexSessionRunnerRuntimeJob({
    ...input,
    worker_session_token: input.worker_session_token ?? 'session-token-1',
    nonce,
    nonce_timestamp: input.now,
    replay_protection: replayProtectionFor(
      `/internal/codex-workers/${input.worker_id}/runtime-jobs/${input.attached_runtime_job_id}/session-runner/attach`,
      input.request_digest,
    ),
  });
};

const claimSessionRuntimeJobEnvelope = (
  repository: DeliveryRepository,
  input: Awaited<ReturnType<typeof createAcceptedSessionRuntimeJob>>['input'],
  nonce: string,
) =>
  repository.claimCodexLaunchTokenEnvelope({
    runtime_job_id: input.runtime_job_id,
    envelope_id: input.envelope_id,
    worker_id: input.worker_id,
    worker_session_token: 'session-token-1',
    nonce,
    nonce_timestamp: later,
    accepted_worker_session_digest: tokenHash('session-token-1'),
    key_id: 'session-key-1',
    accepted_session_epoch: 1,
    claim_request_id: `claim-${input.runtime_job_id}`,
    request_digest: tokenHash(`claim-request-${input.runtime_job_id}`),
    replay_protection: replayProtectionFor(
      `/codex-runtime/jobs/${input.runtime_job_id}/launch-token-envelope/claim`,
      tokenHash(`claim-request-${input.runtime_job_id}`),
    ),
    now: later,
  });

const materializeSessionRuntimeJob = async (
  repository: DeliveryRepository,
  input: Awaited<ReturnType<typeof createAcceptedSessionRuntimeJob>>['input'],
  nonce: string,
) => {
  const lease = await publicLaunchLeaseStatus(repository, input.launch_lease_id);
  if (lease === undefined) {
    throw new Error(`Expected launch lease ${input.launch_lease_id}`);
  }
  return repository.materializeCodexRuntimeJob({
    runtime_job_id: input.runtime_job_id,
    launch_lease_id: input.launch_lease_id,
    worker_id: input.worker_id,
    worker_session_token: 'session-token-1',
    nonce,
    nonce_timestamp: later,
    launch_token_hash: lease.lease_token_hash,
    accepted_worker_session_digest: tokenHash('session-token-1'),
    accepted_session_public_key_id: 'session-key-1',
    accepted_session_epoch: 1,
    materialization_request_id: `materialize-${input.runtime_job_id}`,
    request_digest: tokenHash(`materialize-request-${input.runtime_job_id}`),
    replay_protection: replayProtectionFor(
      `/codex-runtime/jobs/${input.runtime_job_id}/materializations`,
      tokenHash(`materialize-request-${input.runtime_job_id}`),
    ),
    active_fence: {
      run_worker_lease_id: input.run_worker_lease_id,
      run_worker_lease_token_hash: input.run_worker_lease_token_hash,
      run_session_status: input.run_session_status,
      run_session_updated_at: input.run_session_updated_at,
      execution_package_version: input.execution_package_version,
    },
    now: later,
  });
};

const startSessionRuntimeJob = (
  repository: DeliveryRepository,
  input: Awaited<ReturnType<typeof createAcceptedSessionRuntimeJob>>['input'],
  nonce: string,
) =>
  repository.startCodexRuntimeJob({
    runtime_job_id: input.runtime_job_id,
    worker_id: input.worker_id,
    worker_session_token: 'session-token-1',
    nonce,
    nonce_timestamp: later,
    idempotency_key: `start-${input.runtime_job_id}`,
    request_digest: tokenHash(`start-request-${input.runtime_job_id}`),
    runtime_evidence_digest: tokenHash(`runtime-evidence-${input.runtime_job_id}`),
    launch_materialization_digest: tokenHash(`launch-materialization-${input.runtime_job_id}`),
    replay_protection: replayProtectionFor(
      `/codex-runtime/jobs/${input.runtime_job_id}/start`,
      tokenHash(`start-request-${input.runtime_job_id}`),
    ),
    now: later,
  });

const bindCodexSessionThread = async (repository: DeliveryRepository) => {
  await repository.createCodexSessionTurn(turnInput);
  const claimed = await repository.claimCodexSessionLease(leaseInput);
  await repository.terminalizeCodexSessionTurn({
    session_id: 'session-1',
    turn_id: 'turn-1',
    lease_id: claimed.lease.id,
    lease_token_hash: claimed.lease.lease_token_hash,
    lease_epoch: claimed.lease.lease_epoch,
    worker_id: 'worker-1',
    worker_session_digest: 'sha256:worker-session',
    status: 'succeeded',
    expected_input_capsule_digest: undefined,
    output_capsule: { ...runtimeCapsuleInput },
    ...outputContinuationInput({ turnId: 'turn-1' }),
    codex_thread_id: 'thread-1',
    codex_thread_id_digest: codexCanonicalDigest({ kind: 'codex_app_server_thread_id', thread_id: 'thread-1' }),
    now: '2026-05-31T00:02:00.000Z',
  });
  await repository.createCodexSessionTurn({
    ...turnInput,
    id: 'turn-2',
    input_digest: 'sha256:turn-2',
    expected_input_capsule_digest: 'sha256:capsule-1',
    created_at: '2026-05-31T00:03:00.000Z',
    updated_at: '2026-05-31T00:03:00.000Z',
  });
};

const startSessionRunnerRuntimeJob = async (repository: DeliveryRepository) => {
  const { input } = await createAcceptedSessionRuntimeJob(repository, {
    runtime_job_id: 'runtime-job-1',
    launch_lease_id: 'launch-lease-1',
    envelope_id: 'runtime-envelope-1',
    job_request_id: 'runtime-job-request-1',
    input_json: startThreadRuntimeInput(),
    input_digest: tokenHash('runner-start-thread-input'),
    execution_package_id: 'execution-package-runner-1',
    codex_session_turn_id: 'turn-1',
  });
  await claimSessionRuntimeJobEnvelope(repository, input, 'claim-runner-runtime-nonce');
  await materializeSessionRuntimeJob(repository, input, 'materialize-runner-runtime-nonce');
  return startSessionRuntimeJob(repository, input, 'start-runner-runtime-nonce');
};

const createRunnerLaunchLease = async (
  repository: DeliveryRepository,
  overrides: Partial<Parameters<DeliveryRepository['createOrReplayCodexLaunchLease']>[0]> = {},
) => {
  const { profile, revision } = runtimeProfileRevision({
    profile_id: 'runner-runtime-profile-run_execution',
    id: 'runner-runtime-profile-revision-run_execution',
  });
  const { binding, version, secretPayload } = runtimeCredential(
    {
      id: 'runner-credential-binding-run_execution',
      profile_id: profile.id,
    },
    { id: 'runner-credential-version-run_execution' },
  );
  await repository.createCodexRuntimeProfileWithRevision({ profile, revision });
  await repository.createCodexCredentialBindingWithVersion({
    binding,
    version,
    secret_payload_json: secretPayload,
  });
  const { worker } = await seedRuntimeWorker(repository, {
    worker_id: 'runner-worker-1',
    worker_identity: 'runner-worker-identity-1',
    bootstrap_token_id: 'runner-bootstrap-token-1',
    bootstrap_token_raw: 'runner-bootstrap-token-raw',
    session_token: 'runner-session-token-1',
  });

  return repository.createOrReplayCodexLaunchLease({
    id: 'launch-lease-1',
    lease_request_id: 'runner-launch-lease-request-1',
    target: runExecutionTarget({ target_id: 'session-1' }),
    worker_id: worker.id,
    runtime_profile_revision_id: revision.id,
    runtime_profile_digest: revision.profile_digest,
    credential_binding_id: binding.id,
    credential_binding_version_id: version.id,
    credential_payload_digest: version.payload_digest,
    docker_image_digest: revision.docker_image_digest,
    network_policy_digest: codexCanonicalDigest(revision.network_policy),
    network_provider_config_digest: dockerProxyConfig().provider_config_digest,
    launch_token: 'runner-launch-token-1',
    launch_attempt: 99,
    expires_at: runtimeExpiresAt,
    now,
    ...overrides,
  });
};

const publicLaunchLeaseStatus = async (
  repository: DeliveryRepository,
  launchLeaseId: string,
): Promise<CodexLaunchLease | undefined> =>
  repository.getCodexLaunchLeasePublicStatus({
    launch_lease_id: launchLeaseId,
  });

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

const uuidFixture = {
  orgId: '10000000-0000-4000-8000-000000000001',
  actorTechId: '10000000-0000-4000-8000-000000000002',
  actorProductId: '10000000-0000-4000-8000-000000000003',
  projectId: '10000000-0000-4000-8000-000000000004',
  developmentPlanId: '10000000-0000-4000-8000-000000000005',
  developmentPlanRevisionId: '10000000-0000-4000-8000-000000000006',
  developmentPlanItemId: '10000000-0000-4000-8000-000000000007',
  workflowId: '10000000-0000-4000-8000-000000000008',
  sessionId: '10000000-0000-4000-8000-000000000009',
  credentialBindingId: '10000000-0000-4000-8000-000000000010',
  credentialBindingVersionId: '10000000-0000-4000-8000-000000000011',
  runtimeProfileId: '10000000-0000-4000-8000-000000000012',
  runtimeProfileRevisionId: '10000000-0000-4000-8000-000000000013',
  turnId: '10000000-0000-4000-8000-000000000014',
  leaseId: '10000000-0000-4000-8000-000000000015',
  capsuleId: '10000000-0000-4000-8000-000000000016',
  decisionId: '10000000-0000-4000-8000-000000000017',
  transitionId: '10000000-0000-4000-8000-000000000018',
  forkSessionId: '10000000-0000-4000-8000-000000000019',
  forkDecisionId: '10000000-0000-4000-8000-000000000020',
  forkTransitionId: '10000000-0000-4000-8000-000000000021',
  staleAttemptId: '10000000-0000-4000-8000-000000000022',
  readinessId: '10000000-0000-4000-8000-000000000023',
  boundarySummaryId: '10000000-0000-4000-8000-000000000024',
  boundarySummaryRevisionId: '10000000-0000-4000-8000-000000000025',
  specId: '10000000-0000-4000-8000-000000000026',
  specRevisionId: '10000000-0000-4000-8000-000000000027',
  executionPlanId: '10000000-0000-4000-8000-000000000028',
  executionPlanRevisionId: '10000000-0000-4000-8000-000000000029',
} as const;

const drizzleWorkflowInput = {
  id: uuidFixture.workflowId,
  codex_session_id: uuidFixture.sessionId,
  development_plan_id: uuidFixture.developmentPlanId,
  development_plan_item_id: uuidFixture.developmentPlanItemId,
  runtime_profile_id: uuidFixture.runtimeProfileId,
  runtime_profile_revision_id: uuidFixture.runtimeProfileRevisionId,
  credential_binding_id: uuidFixture.credentialBindingId,
  credential_binding_version_id: uuidFixture.credentialBindingVersionId,
  actor_id: uuidFixture.actorTechId,
  now,
};

const drizzleTurnInput = {
  id: uuidFixture.turnId,
  codex_session_id: uuidFixture.sessionId,
  workflow_id: uuidFixture.workflowId,
  intent: 'continue_execution',
  status: 'running',
  input_digest: 'sha256:drizzle-turn-input',
  expected_input_capsule_digest: undefined,
  created_by_actor_id: uuidFixture.actorTechId,
  created_at: now,
  updated_at: now,
} as const;

const drizzleLeaseInput = {
  session_id: uuidFixture.sessionId,
  workflow_id: uuidFixture.workflowId,
  lease_id: uuidFixture.leaseId,
  lease_token_hash: 'sha256:drizzle-lease-token',
  worker_id: 'worker-drizzle',
  worker_session_digest: 'sha256:worker-session-drizzle',
  expected_input_capsule_digest: undefined,
  now,
  expires_at: '2026-05-31T00:05:00.000Z',
};

const drizzleRuntimeCapsuleInput = {
  id: uuidFixture.capsuleId,
  codex_session_id: uuidFixture.sessionId,
  sequence: 1,
  artifact_ref: `artifact://internal/codex_runtime_capsule/codex_session/${uuidFixture.sessionId}/${uuidFixture.capsuleId}`,
  digest: 'sha256:drizzle-capsule-1',
  size_bytes: '123',
  manifest_digest: 'sha256:drizzle-manifest-1',
  thread_state_digest: 'sha256:drizzle-thread-state-1',
  memory_state_digest: 'sha256:drizzle-memory-state-1',
  environment_manifest_digest: 'sha256:drizzle-environment-manifest-1',
  codex_thread_id_digest: 'sha256:drizzle-thread-1',
  codex_cli_version: '0.1.0-test',
  app_server_protocol_digest: 'sha256:drizzle-app-server-protocol-1',
  runtime_profile_revision_id: uuidFixture.runtimeProfileRevisionId,
  trusted_runtime_manifest_digest: 'sha256:drizzle-trusted-runtime-manifest-1',
  credential_binding_lineage_digest: 'sha256:drizzle-credential-binding-lineage-1',
  created_from_turn_id: uuidFixture.turnId,
  created_by_actor_id: uuidFixture.actorTechId,
  created_at: '2026-05-31T00:02:00.000Z',
} as const;

const seedDrizzleWorkflowParents = async (repository: DeliveryRepository) => {
  await repository.saveOrganization({
    id: uuidFixture.orgId,
    name: 'Forgeloop Test Org',
    created_at: now,
    updated_at: now,
  });
  await repository.saveActor({
    id: uuidFixture.actorTechId,
    org_id: uuidFixture.orgId,
    display_name: 'Tech Actor',
    actor_type: 'human',
    created_at: now,
    updated_at: now,
  });
  await repository.saveActor({
    id: uuidFixture.actorProductId,
    org_id: uuidFixture.orgId,
    display_name: 'Product Actor',
    actor_type: 'human',
    created_at: now,
    updated_at: now,
  });
  await repository.saveProject({
    id: uuidFixture.projectId,
    name: 'Forgeloop',
    repo_ids: ['repo-drizzle'],
    owner_actor_id: uuidFixture.actorTechId,
    created_at: now,
    updated_at: now,
  });
  await repository.saveProjectRepo({
    id: 'repo-drizzle',
    repo_id: 'repo-drizzle',
    project_id: uuidFixture.projectId,
    name: 'owner/repo',
    status: 'active',
    local_path: '/tmp/repo',
    default_branch: 'main',
    remote_url: 'https://github.com/owner/repo.git',
    base_commit_sha: 'a'.repeat(40),
    created_at: now,
    updated_at: now,
  });
  await repository.saveDevelopmentPlan({
    id: uuidFixture.developmentPlanId,
    project_id: uuidFixture.projectId,
    revision_id: uuidFixture.developmentPlanRevisionId,
    title: 'Drizzle plan',
    status: 'active',
    source_refs: [{ type: 'requirement', id: 'requirement-drizzle' }],
    items: [],
    created_at: now,
    updated_at: now,
  });
  await repository.saveDevelopmentPlanItem({
    id: uuidFixture.developmentPlanItemId,
    development_plan_id: uuidFixture.developmentPlanId,
    revision_id: uuidFixture.developmentPlanRevisionId,
    source_ref: { type: 'requirement', id: 'requirement-drizzle' },
    title: 'Drizzle workflow item',
    summary: 'Exercise Drizzle workflow persistence.',
    driver_actor_id: uuidFixture.actorTechId,
    responsible_role: 'developer',
    reviewer_actor_id: uuidFixture.actorProductId,
    leader_actor_id: uuidFixture.actorProductId,
    leader_delegate_actor_ids: [],
    risk: 'medium',
    dependency_hints: [],
    affected_surfaces: ['packages/db'],
    boundary_status: 'not_started',
    spec_status: 'missing',
    implementation_plan_status: 'missing',
    execution_status: 'not_started',
    review_status: 'missing',
    qa_handoff_status: 'missing',
    release_impact: 'none',
    next_action: 'Start workflow.',
    created_at: now,
    updated_at: now,
  } satisfies DevelopmentPlanItem);
};

const seedDrizzleWorkflow = async (repository: DeliveryRepository) => {
  await repository.createPlanItemWorkflowWithInitialSession(drizzleWorkflowInput);
  await repository.createCodexSessionTurn(drizzleTurnInput);
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

const seedWorkflowWithCapsule = async (repository: InMemoryDeliveryRepository) => {
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
    expected_input_capsule_digest: undefined,
    output_capsule: {
      ...runtimeCapsuleInput,
      created_from_turn_id: 'turn-seed',
    },
    ...outputContinuationInput({ turnId: 'turn-seed' }),
    now: '2026-05-31T00:02:00.000Z',
  });
};

const runtimeCapsuleInput = {
  id: 'capsule-1',
  codex_session_id: 'session-1',
  sequence: 1,
  artifact_ref: 'artifact://internal/codex_runtime_capsule/codex_session/session-1/capsule-1',
  digest: 'sha256:capsule-1',
  size_bytes: '123',
  manifest_digest: 'sha256:manifest-1',
  thread_state_digest: 'sha256:thread-state-1',
  memory_state_digest: 'sha256:memory-state-1',
  environment_manifest_digest: 'sha256:environment-manifest-1',
  codex_thread_id_digest: 'sha256:thread-1',
  codex_cli_version: '0.1.0-test',
  app_server_protocol_digest: 'sha256:app-server-protocol-1',
  runtime_profile_revision_id: 'profile-revision-1',
  trusted_runtime_manifest_digest: 'sha256:trusted-runtime-manifest-1',
  credential_binding_lineage_digest: 'sha256:credential-binding-lineage-1',
  created_from_turn_id: 'turn-1',
  created_by_actor_id: 'actor-tech',
  created_at: '2026-05-31T00:02:00.000Z',
} as const;

const outputContinuationInput = (input: { sessionId?: string; turnId: string; suffix?: string }) => {
  const sessionId = input.sessionId ?? 'session-1';
  const suffix = input.suffix ?? input.turnId;
  return {
    output_memory_bundle_ref: `artifact://internal/codex_memory_bundle/codex_session/${sessionId}/memory-${suffix}`,
    output_memory_bundle_digest: `sha256:memory-${suffix}`,
    output_environment_manifest_ref: `artifact://internal/codex_environment_manifest/codex_session/${sessionId}/environment-${suffix}`,
    output_environment_manifest_digest: `sha256:environment-${suffix}`,
  };
};

const runExecutionTerminalResult = (overrides: Record<string, unknown> = {}) => ({
  task_kind: 'run_execution',
  output_schema_version: 'codex_run_execution_result.v1',
  execution_package_id: 'execution-package-1',
  execution_package_version: 1,
  run_session_id: 'runtime-run-session-1',
  workspace_bundle_digest: `sha256:${'a'.repeat(64)}`,
  workspace_bundle_manifest_digest: `sha256:${'b'.repeat(64)}`,
  mounted_task_workspace_digest: `sha256:${'c'.repeat(64)}`,
  changed_files: ['README.md'],
  check_results: [],
  execution_artifacts: [],
  public_summary: 'Execution completed.',
  ...overrides,
});

const seedWorkflowExecutionRunning = async (repository: InMemoryDeliveryRepository) => {
  await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
  await seedWorkflowActiveApprovalFields(repository);
  await repository.saveExecutionPackage(executionPackage({
    phase: 'draft',
    plan_id: 'implementation-plan-1',
    plan_revision_id: 'implementation-plan-revision-1',
    execution_plan_id: 'implementation-plan-1',
    execution_plan_revision_id: 'implementation-plan-revision-1',
  }));
  await repository.saveExecutionReadinessRecord({
    ...readinessRecordInput,
    supporting_evidence: [
      { object_type: 'implementation_plan_revision', object_id: 'implementation-plan-revision-1' },
      { object_type: 'execution_package', object_id: 'execution-package-1' },
    ],
  });
  await applyWorkflowProjectionTransition(repository, {
    transition_id: 'transition-execution-ready',
    from_status: 'implementation_plan_review',
    to_status: 'execution_ready',
    evidence_object_type: 'execution_readiness_record',
    evidence_object_id: 'readiness-1',
    supporting_evidence: [
      { object_type: 'implementation_plan_revision', object_id: 'implementation-plan-revision-1' },
      { object_type: 'execution_package', object_id: 'execution-package-1' },
    ],
    projection_patch: {
      active_implementation_plan_doc_revision_id: 'implementation-plan-revision-1',
      active_execution_readiness_record_id: 'readiness-1',
      execution_package_id: 'execution-package-1',
    },
  });
  await applyWorkflowProjectionTransition(repository, {
    transition_id: 'transition-execution-running',
    from_status: 'execution_ready',
    to_status: 'execution_running',
    evidence_object_type: 'execution_package',
    evidence_object_id: 'execution-package-1',
  });
  await repository.createCodexSessionTurn(turnInput);
  const claimedSessionLease = await repository.claimCodexSessionLease({ ...leaseInput, expires_at: runtimeExpiresAt });
  const runtime = await createAcceptedSessionRuntimeJob(repository, {
    input_json: workflowRunExecutionWorkload(),
    input_digest: tokenHash('workflow-run-execution-runtime-input'),
  });
  await claimSessionRuntimeJobEnvelope(repository, runtime.input, 'claim-workflow-terminalization');
  await materializeSessionRuntimeJob(repository, runtime.input, 'materialize-workflow-terminalization');
  const runtimeJob = await startSessionRuntimeJob(repository, runtime.input, 'start-workflow-terminalization');

  return { claimedSessionLease, runtime, runtimeJob };
};

const workflowExecutionTerminalizationInput = (
  seeded: Awaited<ReturnType<typeof seedWorkflowExecutionRunning>>,
  terminalStatus: 'succeeded' | 'failed' | 'cancelled' = 'succeeded',
) => {
  const isSuccess = terminalStatus === 'succeeded';
  const terminalizedAt = '2026-05-31T00:10:00.000Z';
  const outputCapsule = {
    ...runtimeCapsuleInput,
    id: 'capsule-execution-output',
    sequence: 1,
    artifact_ref: 'artifact://internal/codex_runtime_capsule/codex_session/session-1/capsule-execution-output',
    digest: 'sha256:capsule-execution-output',
    manifest_digest: 'sha256:manifest-execution-output',
    thread_state_digest: 'sha256:thread-state-execution-output',
    memory_state_digest: 'sha256:memory-state-execution-output',
    environment_manifest_digest: 'sha256:environment-manifest-execution-output',
    app_server_protocol_digest: 'sha256:app-server-protocol-execution-output',
    trusted_runtime_manifest_digest: 'sha256:trusted-runtime-manifest-execution-output',
    credential_binding_lineage_digest: 'sha256:credential-binding-lineage-execution-output',
    created_from_turn_id: 'turn-1',
    created_at: terminalizedAt,
  };

  return {
    workflow_id: 'workflow-1',
    codex_session_id: 'session-1',
    codex_session_turn_id: 'turn-1',
    run_session_id: seeded.runtime.input.target.target_id,
    runtime_job_id: seeded.runtime.input.runtime_job_id,
    expected_workflow_status: 'execution_running',
    expected_run_session_status: 'running',
    expected_run_session_updated_at: now,
    runtime_job_terminalization: {
      runtime_job_id: seeded.runtime.input.runtime_job_id,
      launch_lease_id: seeded.runtime.input.launch_lease_id,
      worker_id: seeded.runtime.input.worker_id,
      worker_session_token: 'session-token-1',
      nonce: `terminalize-workflow-execution-${terminalStatus}`,
      nonce_timestamp: terminalizedAt,
      terminal_status: terminalStatus,
      reason_code: isSuccess ? 'completed' : terminalStatus === 'cancelled' ? 'user_cancelled' : 'runtime_failed',
      terminal_result_json: isSuccess ? runExecutionTerminalResult() : undefined,
      idempotency_key: `terminalize-workflow-execution-${terminalStatus}`,
      request_digest: tokenHash(`terminalize-workflow-execution-${terminalStatus}`),
      now: terminalizedAt,
    },
    codex_session_turn_terminalization: {
      session_id: 'session-1',
      turn_id: 'turn-1',
      lease_id: seeded.claimedSessionLease.lease.id,
      lease_token_hash: seeded.claimedSessionLease.lease.lease_token_hash,
      lease_epoch: seeded.claimedSessionLease.lease.lease_epoch,
      worker_id: seeded.claimedSessionLease.lease.worker_id,
      worker_session_digest: seeded.claimedSessionLease.lease.worker_session_digest,
      status: terminalStatus,
      expected_input_capsule_digest: undefined,
      ...(isSuccess
        ? {
            output_capsule: outputCapsule,
            ...outputContinuationInput({ turnId: 'turn-1', suffix: 'execution-output' }),
            codex_thread_id: 'thread-1',
            codex_thread_id_digest: 'sha256:thread-1',
          }
        : { failure_code: terminalStatus === 'cancelled' ? 'user_cancelled' : 'runtime_failed' }),
      now: terminalizedAt,
    },
    run_session_update: {
      status: terminalStatus === 'succeeded' ? 'succeeded' : terminalStatus,
      summary: isSuccess ? 'Execution completed.' : undefined,
      failure_kind: terminalStatus === 'failed' ? 'executor_error' : undefined,
      failure_reason: terminalStatus === 'failed' ? 'Runtime failed.' : terminalStatus === 'cancelled' ? 'Execution cancelled.' : undefined,
      finished_at: terminalizedAt,
      updated_at: terminalizedAt,
    },
    workflow_transition: {
      id: `transition-workflow-execution-${terminalStatus}`,
      actor_id: 'actor-tech',
      reason: isSuccess ? 'Execution completed.' : 'Execution stopped before code review.',
      created_at: terminalizedAt,
    },
    stale_attempt: {
      id: `stale-workflow-execution-${terminalStatus}`,
      codex_session_id: 'session-1',
      codex_session_turn_id: 'turn-1',
      lease_id: seeded.claimedSessionLease.lease.id,
      lease_epoch: seeded.claimedSessionLease.lease.lease_epoch,
      worker_id: seeded.claimedSessionLease.lease.worker_id,
      worker_session_digest: seeded.claimedSessionLease.lease.worker_session_digest,
      expected_input_capsule_digest: undefined,
      attempted_output_capsule_digest: isSuccess ? outputCapsule.digest : undefined,
      failure_code: 'codex_session_stale_terminalization',
      created_at: terminalizedAt,
    },
  };
};

const terminalizeTurnWithCapsule = async (
  repository: InMemoryDeliveryRepository,
  options: {
    turn_id?: string;
    turn_input_digest?: string;
    previous_capsule_digest?: string;
    capsule_id?: string;
    capsule_sequence?: number;
    capsule_digest?: string;
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
  const capsuleId = options.capsule_id ?? 'capsule-1';
  const capsuleDigest = options.capsule_digest ?? `sha256:${capsuleId}`;
  const claimNow = options.claim_now ?? '2026-05-31T00:01:00.000Z';
  const terminalizeNow = options.terminalize_now ?? '2026-05-31T00:02:00.000Z';
  await repository.createCodexSessionTurn({
    ...turnInput,
    id: turnId,
    input_digest: options.turn_input_digest ?? `sha256:${turnId}`,
    expected_input_capsule_digest: options.previous_capsule_digest,
    created_at: claimNow,
    updated_at: claimNow,
  });
  const claimed = await repository.claimCodexSessionLease({
    ...leaseInput,
    lease_id: options.lease_id ?? `lease-${turnId}`,
    lease_token_hash: options.lease_token_hash ?? `sha256:lease-${turnId}`,
    expected_input_capsule_digest: options.previous_capsule_digest,
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
    expected_input_capsule_digest: options.previous_capsule_digest,
    output_capsule: {
      ...runtimeCapsuleInput,
      id: capsuleId,
      sequence: options.capsule_sequence ?? 1,
      artifact_ref: `artifact://internal/codex_runtime_capsule/codex_session/session-1/${capsuleId}`,
      digest: capsuleDigest,
      manifest_digest: options.manifest_digest ?? `sha256:manifest-${capsuleId}`,
      created_from_turn_id: turnId,
      created_at: terminalizeNow,
    },
    ...outputContinuationInput({ turnId }),
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
    codex_session_id?: string;
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
      codex_session_id: input.codex_session_id ?? transitionInput.codex_session_id,
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
  describe('queued action persistence contract', () => {
    workflowQueuedActionRepositoryContract(async () => {
      const repository = new InMemoryDeliveryRepository();
      await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
      return {
        repository,
        fixture: {
          workflowId: 'workflow-1',
          sessionId: 'session-1',
          actorId: 'actor-tech',
          boundaryRevisionId: 'boundary-summary-revision-1',
          specRevisionId: 'spec-revision-1',
          implementationPlanRevisionId: 'implementation-plan-revision-1',
        },
      };
    });
  });

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

  it('rejects two active execution runs for one CodexSession in memory', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    await repository.createCodexSessionTurn(turnInput);
    await repository.saveExecutionPackage(executionPackage({ id: 'execution-package-1' }));
    await repository.saveExecutionPackage(executionPackage({ id: 'execution-package-2' }));

    await repository.saveRunSession(runSession({ id: 'run-session-1', execution_package_id: 'execution-package-1' }));

    await expect(
      repository.saveRunSession(runSession({ id: 'run-session-2', execution_package_id: 'execution-package-2' })),
    ).rejects.toMatchObject<Partial<DomainError>>({
      name: 'DomainError',
      code: 'workflow_execution_already_running',
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

  it('rejects creating a workflow when persisted Plan Item belongs to another Development Plan', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.saveDevelopmentPlanItem(baseDevelopmentPlanItem);

    await expectDomainErrorCode(
      () =>
        repository.createPlanItemWorkflowWithInitialSession({
          ...baseWorkflowInput,
          development_plan_id: 'plan-other',
        }),
      'workflow_invalid_transition',
    );
    await expect(repository.getPlanItemWorkflow('workflow-1')).resolves.toBeUndefined();
    await expect(repository.getCodexSession('session-1')).resolves.toBeUndefined();
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

  it('applies active document projection patches during artifact submission and rejects mismatched evidence', async () => {
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

    await applyWorkflowProjectionTransition(repository, {
      transition_id: 'transition-boundary-submission-patch',
      from_status: 'brainstorming',
      to_status: 'boundary_review',
      evidence_object_type: 'boundary_summary_revision',
      evidence_object_id: 'boundary-summary-revision-1',
      projection_patch: { active_boundary_summary_revision_id: 'boundary-summary-revision-1' },
    });
    await expect(repository.getPlanItemWorkflow('workflow-1')).resolves.toMatchObject({
      status: 'boundary_review',
      active_boundary_summary_revision_id: 'boundary-summary-revision-1',
    });
    await applyWorkflowProjectionTransition(repository, {
      transition_id: 'transition-boundary-approval',
      from_status: 'boundary_review',
      to_status: 'spec_generation_queued',
      evidence_object_type: 'boundary_summary_revision',
      evidence_object_id: 'boundary-summary-revision-1',
      projection_patch: { active_boundary_summary_revision_id: 'boundary-summary-revision-1' },
    });

    await applyWorkflowProjectionTransition(repository, {
      transition_id: 'transition-spec-submission-patch',
      from_status: 'spec_generation_queued',
      to_status: 'spec_review',
      evidence_object_type: 'spec_revision',
      evidence_object_id: 'spec-revision-1',
      projection_patch: { active_spec_doc_revision_id: 'spec-revision-1' },
    });
    await expect(repository.getPlanItemWorkflow('workflow-1')).resolves.toMatchObject({
      status: 'spec_review',
      active_spec_doc_revision_id: 'spec-revision-1',
    });
    await applyWorkflowProjectionTransition(repository, {
      transition_id: 'transition-spec-approval',
      from_status: 'spec_review',
      to_status: 'implementation_plan_generation_queued',
      evidence_object_type: 'spec_revision',
      evidence_object_id: 'spec-revision-1',
      projection_patch: { active_spec_doc_revision_id: 'spec-revision-1' },
    });

    await applyWorkflowProjectionTransition(repository, {
      transition_id: 'transition-plan-submission-patch',
      from_status: 'implementation_plan_generation_queued',
      to_status: 'implementation_plan_review',
      evidence_object_type: 'implementation_plan_revision',
      evidence_object_id: 'implementation-plan-revision-1',
      projection_patch: { active_implementation_plan_doc_revision_id: 'implementation-plan-revision-1' },
    });
    await expect(repository.getPlanItemWorkflow('workflow-1')).resolves.toMatchObject({
      status: 'implementation_plan_review',
      active_implementation_plan_doc_revision_id: 'implementation-plan-revision-1',
    });

    await expectDomainErrorCode(
      () =>
        applyWorkflowProjectionTransition(repository, {
          transition_id: 'transition-plan-mismatched-patch',
          from_status: 'implementation_plan_review',
          to_status: 'execution_ready',
          evidence_object_type: 'execution_readiness_record',
          evidence_object_id: 'readiness-missing',
          projection_patch: { active_implementation_plan_doc_revision_id: 'implementation-plan-revision-mismatch' },
        }),
      'workflow_invalid_transition',
    );
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
      supporting_evidence: [
        { object_type: 'implementation_plan_revision', object_id: 'implementation-plan-revision-1' },
        { object_type: 'execution_package', object_id: 'execution-package-1' },
      ],
    });
    await repository.saveExecutionPackage(executionPackage({
      id: 'execution-package-1',
      phase: 'draft',
      plan_id: 'implementation-plan-1',
      plan_revision_id: 'implementation-plan-revision-1',
      execution_plan_id: 'implementation-plan-1',
      execution_plan_revision_id: 'implementation-plan-revision-1',
    }));

    await applyWorkflowProjectionTransition(repository, {
      transition_id: 'transition-readiness-with-active-plan',
      from_status: 'implementation_plan_review',
      to_status: 'execution_ready',
      actor_id: 'actor-product',
      evidence_object_type: 'execution_readiness_record',
      evidence_object_id: 'readiness-1',
      supporting_evidence: [
        { object_type: 'implementation_plan_revision', object_id: 'implementation-plan-revision-1' },
        { object_type: 'execution_package', object_id: 'execution-package-1' },
      ],
      projection_patch: {
        active_implementation_plan_doc_revision_id: 'implementation-plan-revision-1',
        execution_package_id: 'execution-package-1',
      },
    });

    await expect(repository.getPlanItemWorkflow('workflow-1')).resolves.toMatchObject({
      status: 'execution_ready',
      active_implementation_plan_doc_revision_id: 'implementation-plan-revision-1',
      execution_package_id: 'execution-package-1',
      updated_at: now,
    });
  });

  it('rejects execution readiness execution package projection without matching readiness support', async () => {
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
    await repository.saveExecutionPackage(executionPackage({
      id: 'execution-package-1',
      phase: 'draft',
      plan_id: 'implementation-plan-1',
      plan_revision_id: 'implementation-plan-revision-1',
      execution_plan_id: 'implementation-plan-1',
      execution_plan_revision_id: 'implementation-plan-revision-1',
    }));

    await expectDomainErrorCode(
      () =>
        applyWorkflowProjectionTransition(repository, {
          transition_id: 'transition-readiness-package-without-readiness-support',
          from_status: 'implementation_plan_review',
          to_status: 'execution_ready',
          actor_id: 'actor-product',
          evidence_object_type: 'execution_readiness_record',
          evidence_object_id: 'readiness-1',
          supporting_evidence: [
            { object_type: 'implementation_plan_revision', object_id: 'implementation-plan-revision-1' },
            { object_type: 'execution_package', object_id: 'execution-package-1' },
          ],
          projection_patch: {
            active_implementation_plan_doc_revision_id: 'implementation-plan-revision-1',
            execution_package_id: 'execution-package-1',
          },
        }),
      'workflow_invalid_transition',
    );
    const workflow = await repository.getPlanItemWorkflow('workflow-1');
    expect(workflow).toMatchObject({
      status: 'implementation_plan_review',
    });
    expect(workflow?.execution_package_id).toBeUndefined();
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

  it('rejects product transitions that use candidate fork evidence and preserves workflow state', async () => {
    const candidateSessionId = 'session-candidate-fork';

    const createRepositoryWithCandidateFork = async () => {
      const repository = new InMemoryDeliveryRepository();
      await repository.createPlanItemWorkflowWithInitialSession({
        ...baseWorkflowInput,
        actor_id: 'actor-product',
      });
      await repository.createCodexSessionTurn(turnInput);
      await repository.createCodexSessionFork({
        id: candidateSessionId,
        workflow_id: 'workflow-1',
        parent_session_id: 'session-1',
        forked_from_turn_id: 'turn-1',
        fork_reason: 'Try another approach.',
        created_by_actor_id: 'actor-tech',
        now,
      });
      return repository;
    };

    const manualRepository = await createRepositoryWithCandidateFork();
    await manualRepository.saveWorkflowManualDecision({
      ...manualDecisionInput,
      id: 'decision-candidate-start',
      codex_session_id: candidateSessionId,
      created_by_actor_id: 'actor-product',
    });
    const manualWorkflowBefore = await manualRepository.getPlanItemWorkflow('workflow-1');

    await expectDomainErrorCode(
      () =>
        applyWorkflowTransition(manualRepository, {
          ...transitionInput,
          id: 'transition-candidate-manual-start',
          actor_id: 'actor-product',
          evidence_object_id: 'decision-candidate-start',
          codex_session_id: candidateSessionId,
          codex_session_turn_id: undefined,
        }),
      'workflow_invalid_transition',
    );
    await expect(manualRepository.getPlanItemWorkflow('workflow-1')).resolves.toEqual(manualWorkflowBefore);
    await expect(manualRepository.listPlanItemWorkflowTransitions('workflow-1')).resolves.toHaveLength(0);

    const documentRepository = await createRepositoryWithCandidateFork();
    await documentRepository.saveWorkflowManualDecision(manualDecisionInput);
    await applyWorkflowProjectionTransition(documentRepository, {
      transition_id: 'transition-active-start-before-candidate-doc',
      from_status: 'not_started',
      to_status: 'brainstorming',
      evidence_object_type: 'manual_decision',
      evidence_object_id: 'decision-1',
    });
    await documentRepository.saveBoundarySummaryRevision({
      ...boundarySummaryRevisionInput,
      id: 'boundary-candidate',
      boundary_summary_id: 'boundary-summary-candidate',
      codex_session_id: candidateSessionId,
    });
    const documentWorkflowBefore = await documentRepository.getPlanItemWorkflow('workflow-1');

    await expectDomainErrorCode(
      () =>
        applyWorkflowProjectionTransition(documentRepository, {
          transition_id: 'transition-candidate-boundary',
          from_status: 'brainstorming',
          to_status: 'boundary_review',
          evidence_object_type: 'boundary_summary_revision',
          evidence_object_id: 'boundary-candidate',
          codex_session_id: candidateSessionId,
        }),
      'workflow_invalid_transition',
    );
    await expect(documentRepository.getPlanItemWorkflow('workflow-1')).resolves.toEqual(documentWorkflowBefore);
    await expect(documentRepository.listPlanItemWorkflowTransitions('workflow-1')).resolves.toHaveLength(1);

    const readinessRepository = await createRepositoryWithCandidateFork();
    await seedWorkflowActiveApprovalFields(readinessRepository);
    await readinessRepository.saveExecutionReadinessRecord({
      ...readinessRecordInput,
      id: 'readiness-candidate',
      codex_session_id: candidateSessionId,
      supporting_evidence: [{ object_type: 'implementation_plan_revision', object_id: 'implementation-plan-revision-1' }],
    });
    const readinessWorkflowBefore = await readinessRepository.getPlanItemWorkflow('workflow-1');

    await expectDomainErrorCode(
      () =>
        readinessRepository.applyPlanItemWorkflowTransition({
          transition: {
            ...transitionInput,
            id: 'transition-candidate-readiness',
            from_status: 'implementation_plan_review',
            to_status: 'execution_ready',
            actor_id: 'actor-product',
            reason: 'Mark ready.',
            evidence_object_type: 'execution_readiness_record',
            evidence_object_id: 'readiness-candidate',
            codex_session_id: candidateSessionId,
            codex_session_turn_id: undefined,
            supporting_evidence: [{ object_type: 'implementation_plan_revision', object_id: 'implementation-plan-revision-1' }],
          },
          projection_patch: { active_implementation_plan_doc_revision_id: 'implementation-plan-revision-1' },
        }),
      'workflow_invalid_transition',
    );
    await expect(readinessRepository.getPlanItemWorkflow('workflow-1')).resolves.toEqual(readinessWorkflowBefore);
    await expect(readinessRepository.listPlanItemWorkflowTransitions('workflow-1')).resolves.toHaveLength(6);
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
          latest_capsule_id: 'capsule-1',
          latest_capsule_digest: 'sha256:capsule-1',
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
      expected_input_capsule_digest: undefined,
      output_capsule: runtimeCapsuleInput,
      ...outputContinuationInput({ turnId: 'turn-1' }),
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
          latest_capsule_id: 'capsule-drifted',
          latest_capsule_digest: 'sha256:capsule-drifted',
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

  it('persists and clears session-bound Codex runner ownership', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);

    await repository.markCodexSessionRunnerOwner({
      session_id: 'session-1',
      runner_worker_id: 'worker-1',
      runner_launch_lease_id: 'launch-lease-1',
      runner_runtime_job_id: 'runtime-job-1',
      runner_expires_at: '2026-05-31T00:20:00.000Z',
      now: '2026-05-31T00:00:00.000Z',
    });
    await repository.markCodexSessionRunnerOwner({
      session_id: 'session-1',
      runner_worker_id: 'worker-1',
      runner_launch_lease_id: 'launch-lease-1',
      runner_runtime_job_id: 'runtime-job-1',
      runner_expires_at: '2026-05-31T00:30:00.000Z',
      now: '2026-05-31T00:01:00.000Z',
    });

    await expect(repository.getCodexSession('session-1')).resolves.toMatchObject({
      runner_worker_id: 'worker-1',
      runner_launch_lease_id: 'launch-lease-1',
      runner_runtime_job_id: 'runtime-job-1',
      runner_expires_at: '2026-05-31T00:30:00.000Z',
    });

    await repository.clearCodexSessionRunnerOwner({
      session_id: 'session-1',
      runner_launch_lease_id: 'launch-lease-1',
      terminal_reason_code: 'succeeded',
      now: '2026-05-31T00:10:00.000Z',
    });

    await expect(repository.getCodexSession('session-1')).resolves.toMatchObject({
      runner_worker_id: undefined,
      runner_launch_lease_id: undefined,
      runner_runtime_job_id: undefined,
      runner_expires_at: undefined,
    });
  });

  it('rejects overwriting a live session runner owner with a different tuple', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    await repository.markCodexSessionRunnerOwner({
      session_id: 'session-1',
      runner_worker_id: 'worker-1',
      runner_launch_lease_id: 'launch-lease-1',
      runner_runtime_job_id: 'runtime-job-1',
      runner_expires_at: '2026-05-31T00:20:00.000Z',
      now: '2026-05-31T00:00:00.000Z',
    });

    await expectDomainErrorCode(
      () =>
        repository.markCodexSessionRunnerOwner({
          session_id: 'session-1',
          runner_worker_id: 'worker-2',
          runner_launch_lease_id: 'launch-lease-2',
          runner_runtime_job_id: 'runtime-job-2',
          runner_expires_at: '2026-05-31T00:30:00.000Z',
          now: '2026-05-31T00:10:00.000Z',
        }),
      'codex_session_runner_unavailable',
    );
    await expect(repository.getCodexSession('session-1')).resolves.toMatchObject({
      runner_worker_id: 'worker-1',
      runner_launch_lease_id: 'launch-lease-1',
      runner_runtime_job_id: 'runtime-job-1',
      runner_expires_at: '2026-05-31T00:20:00.000Z',
    });
  });

  it('fails closed when clearing or renewing a stale session runner owner', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    await bindCodexSessionThread(repository);
    await startSessionRunnerRuntimeJob(repository);
    await repository.markCodexSessionRunnerOwner({
      session_id: 'session-1',
      runner_worker_id: 'worker-1',
      runner_launch_lease_id: 'launch-lease-1',
      runner_runtime_job_id: 'runtime-job-1',
      runner_expires_at: '2026-05-31T00:20:00.000Z',
      now: '2026-05-31T00:00:00.000Z',
    });

    await expectDomainErrorCode(
      () =>
        repository.clearCodexSessionRunnerOwner({
          session_id: 'session-1',
          runner_launch_lease_id: 'stale-launch-lease',
          terminal_reason_code: 'succeeded',
          now: '2026-05-31T00:10:00.000Z',
        }),
      'codex_session_runner_unavailable',
    );
    await expectDomainErrorCode(
      () =>
        repository.renewCodexSessionRunnerOwner({
          session_id: 'session-1',
          runner_worker_id: 'worker-2',
          runner_launch_lease_id: 'launch-lease-1',
          runner_runtime_job_id: 'runtime-job-1',
          runner_expires_at: '2026-05-31T00:30:00.000Z',
          now: '2026-05-31T00:10:00.000Z',
        }),
      'codex_session_runner_unavailable',
    );
    await expect(
      repository.renewCodexSessionRunnerOwner({
        session_id: 'session-1',
        runner_worker_id: 'worker-1',
        runner_launch_lease_id: 'launch-lease-1',
        runner_runtime_job_id: 'runtime-job-1',
        runner_expires_at: '2026-05-31T00:30:00.000Z',
        now: '2026-05-31T00:10:00.000Z',
      }),
    ).resolves.toMatchObject({
      runner_worker_id: 'worker-1',
      runner_launch_lease_id: 'launch-lease-1',
      runner_runtime_job_id: 'runtime-job-1',
      runner_expires_at: '2026-05-31T00:30:00.000Z',
    });
  });

  it('rejects attaching a missing later-turn runtime job to the persisted session runner owner', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    await bindCodexSessionThread(repository);
    await startSessionRunnerRuntimeJob(repository);
    await repository.markCodexSessionRunnerOwner({
      session_id: 'session-1',
      runner_worker_id: 'worker-1',
      runner_launch_lease_id: 'launch-lease-1',
      runner_runtime_job_id: 'runtime-job-1',
      runner_expires_at: '2026-05-31T00:20:00.000Z',
      now: '2026-05-31T00:02:30.000Z',
    });

    await expectDomainErrorCode(
      () =>
        attachCodexSessionRunnerRuntimeJob(repository, {
          session_id: 'session-1',
          runner_launch_lease_id: 'launch-lease-1',
          runner_runtime_job_id: 'runtime-job-1',
          runner_expires_at: '2026-05-31T00:30:00.000Z',
          attached_runtime_job_id: 'attached-runtime-job-1',
          worker_id: 'worker-1',
          runtime_evidence_digest: 'sha256:runtime-evidence-live-runner',
          launch_materialization_digest: 'sha256:launch-materialization-live-runner',
          idempotency_key: 'attach-runtime-job-1',
          request_digest: 'sha256:attach-runtime-job-1',
          now: '2026-05-31T00:06:00.000Z',
        }),
      'codex_runtime_job_unavailable',
    );
    await expect(repository.getCodexSession('session-1')).resolves.toMatchObject({
      runner_launch_lease_id: 'launch-lease-1',
      runner_runtime_job_id: 'runtime-job-1',
    });
  });

  it('rejects attaching a later-turn runtime job when the persisted runner runtime job is missing', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    await bindCodexSessionThread(repository);
    await repository.markCodexSessionRunnerOwner({
      session_id: 'session-1',
      runner_worker_id: 'worker-1',
      runner_launch_lease_id: 'launch-lease-1',
      runner_runtime_job_id: 'runtime-job-1',
      runner_expires_at: '2026-05-31T00:20:00.000Z',
      now: '2026-05-31T00:02:30.000Z',
    });
    await createAcceptedSessionRuntimeJob(repository, {
      input_json: resumeThreadRuntimeInput({ codex_session_turn_id: 'turn-2' }),
      codex_session_turn_id: 'turn-2',
      input_digest: tokenHash('attached-runtime-resume-input'),
    });

    await expectDomainErrorCode(
      () =>
        attachCodexSessionRunnerRuntimeJob(repository, {
          session_id: 'session-1',
          runner_launch_lease_id: 'launch-lease-1',
          runner_runtime_job_id: 'runtime-job-1',
          runner_expires_at: '2026-05-31T00:30:00.000Z',
          attached_runtime_job_id: 'attached-runtime-job-1',
          worker_id: 'worker-1',
          runtime_evidence_digest: 'sha256:runtime-evidence-live-runner',
          launch_materialization_digest: 'sha256:launch-materialization-live-runner',
          idempotency_key: 'attach-runtime-job-1',
          request_digest: 'sha256:attach-runtime-job-1',
          now: '2026-05-31T00:06:00.000Z',
        }),
      'codex_runtime_job_unavailable',
    );
    await expect(repository.getCodexRuntimeJob({ runtime_job_id: 'attached-runtime-job-1' })).resolves.toMatchObject({
      status: 'accepted',
    });
    await expect(publicLaunchLeaseStatus(repository, 'attached-launch-lease-1')).resolves.toMatchObject({ status: 'active' });
  });

  it('attaches an accepted later-turn runtime job using the persisted session runner owner', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    await bindCodexSessionThread(repository);
    await startSessionRunnerRuntimeJob(repository);
    await repository.markCodexSessionRunnerOwner({
      session_id: 'session-1',
      runner_worker_id: 'worker-1',
      runner_launch_lease_id: 'launch-lease-1',
      runner_runtime_job_id: 'runtime-job-1',
      runner_expires_at: '2026-05-31T00:20:00.000Z',
      now: '2026-05-31T00:02:30.000Z',
    });
    await createAcceptedSessionRuntimeJob(repository, {
      input_json: resumeThreadRuntimeInput({ codex_session_turn_id: 'turn-2' }),
      codex_session_turn_id: 'turn-2',
      input_digest: tokenHash('attached-runtime-resume-input'),
    });

    const attached = await attachCodexSessionRunnerRuntimeJob(repository, {
      session_id: 'session-1',
      runner_launch_lease_id: 'launch-lease-1',
      runner_runtime_job_id: 'runtime-job-1',
      runner_expires_at: '2026-05-31T00:30:00.000Z',
      attached_runtime_job_id: 'attached-runtime-job-1',
      worker_id: 'worker-1',
      runtime_evidence_digest: 'sha256:runtime-evidence-live-runner',
      launch_materialization_digest: 'sha256:launch-materialization-live-runner',
      idempotency_key: 'attach-runtime-job-1',
      request_digest: 'sha256:attach-runtime-job-1',
      now: '2026-05-31T00:06:00.000Z',
    });

    expect(attached).toMatchObject({
      id: 'attached-runtime-job-1',
      worker_id: 'worker-1',
      launch_lease_id: 'attached-launch-lease-1',
      codex_session_id: 'session-1',
      codex_session_turn_id: 'turn-2',
      status: 'running',
      runtime_evidence_digest: 'sha256:runtime-evidence-live-runner',
      launch_materialization_digest: 'sha256:launch-materialization-live-runner',
      started_at: '2026-05-31T00:06:00.000Z',
    });
    await expect(publicLaunchLeaseStatus(repository, 'attached-launch-lease-1')).resolves.toMatchObject({ status: 'materialized' });
    await expect(publicLaunchLeaseStatus(repository, 'launch-lease-1')).resolves.toMatchObject({ status: 'materialized' });
    await expect(repository.getCodexSession('session-1')).resolves.toMatchObject({
      runner_launch_lease_id: 'launch-lease-1',
      runner_runtime_job_id: 'runtime-job-1',
      runner_expires_at: '2026-05-31T00:30:00.000Z',
    });

    await expect(
      attachCodexSessionRunnerRuntimeJob(repository, {
        session_id: 'session-1',
        runner_launch_lease_id: 'launch-lease-1',
        runner_runtime_job_id: 'runtime-job-1',
        runner_expires_at: '2026-05-31T00:40:00.000Z',
        attached_runtime_job_id: 'attached-runtime-job-1',
        worker_id: 'worker-1',
        nonce: 'attach-runtime-job-1-replay',
        runtime_evidence_digest: 'sha256:runtime-evidence-live-runner',
        launch_materialization_digest: 'sha256:launch-materialization-live-runner',
        idempotency_key: 'attach-runtime-job-1',
        request_digest: 'sha256:attach-runtime-job-1',
        now: '2026-05-31T00:07:00.000Z',
      }),
    ).resolves.toMatchObject({
      id: 'attached-runtime-job-1',
      status: 'running',
    });
    await expect(repository.getCodexSession('session-1')).resolves.toMatchObject({
      runner_launch_lease_id: 'launch-lease-1',
      runner_runtime_job_id: 'runtime-job-1',
      runner_expires_at: '2026-05-31T00:40:00.000Z',
    });
  });

  it('requires the runner worker session proof when attaching a later-turn runtime job', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    await bindCodexSessionThread(repository);
    await startSessionRunnerRuntimeJob(repository);
    await repository.markCodexSessionRunnerOwner({
      session_id: 'session-1',
      runner_worker_id: 'worker-1',
      runner_launch_lease_id: 'launch-lease-1',
      runner_runtime_job_id: 'runtime-job-1',
      runner_expires_at: '2026-05-31T00:20:00.000Z',
      now: '2026-05-31T00:02:30.000Z',
    });
    await createAcceptedSessionRuntimeJob(repository, {
      input_json: resumeThreadRuntimeInput({ codex_session_turn_id: 'turn-2' }),
      codex_session_turn_id: 'turn-2',
      input_digest: tokenHash('attached-runtime-resume-input'),
    });

    await expectDomainErrorCode(
      () =>
        attachCodexSessionRunnerRuntimeJob(repository, {
          session_id: 'session-1',
          runner_launch_lease_id: 'launch-lease-1',
          runner_runtime_job_id: 'runtime-job-1',
          runner_expires_at: '2026-05-31T00:30:00.000Z',
          attached_runtime_job_id: 'attached-runtime-job-1',
          worker_id: 'worker-1',
          worker_session_token: 'forged-session-token',
          runtime_evidence_digest: 'sha256:runtime-evidence-live-runner',
          launch_materialization_digest: 'sha256:launch-materialization-live-runner',
          idempotency_key: 'attach-runtime-job-1',
          request_digest: 'sha256:attach-runtime-job-1',
          now: '2026-05-31T00:06:00.000Z',
        }),
      'codex_runtime_job_unavailable',
    );

    await expect(repository.getCodexRuntimeJob({ runtime_job_id: 'attached-runtime-job-1' })).resolves.toMatchObject({
      status: 'accepted',
    });
    const rejectedJob = await repository.getCodexRuntimeJob({ runtime_job_id: 'attached-runtime-job-1' });
    expect(rejectedJob?.runtime_evidence_digest).toBeUndefined();
    expect(rejectedJob?.launch_materialization_digest).toBeUndefined();
  });

  it('renews the runner runtime job expiry while the runner owner is heartbeating', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    await bindCodexSessionThread(repository);
    await startSessionRunnerRuntimeJob(repository);
    await repository.markCodexSessionRunnerOwner({
      session_id: 'session-1',
      runner_worker_id: 'worker-1',
      runner_launch_lease_id: 'launch-lease-1',
      runner_runtime_job_id: 'runtime-job-1',
      runner_expires_at: '2026-05-31T00:20:00.000Z',
      now: '2026-05-31T00:02:30.000Z',
    });

    await repository.renewCodexSessionRunnerOwner({
      session_id: 'session-1',
      runner_worker_id: 'worker-1',
      runner_launch_lease_id: 'launch-lease-1',
      runner_runtime_job_id: 'runtime-job-1',
      runner_expires_at: '2026-05-31T00:30:00.000Z',
      now: '2026-05-31T00:10:00.000Z',
    });
    await createAcceptedSessionRuntimeJob(repository, {
      input_json: resumeThreadRuntimeInput({ codex_session_turn_id: 'turn-2' }),
      codex_session_turn_id: 'turn-2',
      input_digest: tokenHash('attached-runtime-resume-input'),
    });

    await expect(
      attachCodexSessionRunnerRuntimeJob(repository, {
        session_id: 'session-1',
        runner_launch_lease_id: 'launch-lease-1',
        runner_runtime_job_id: 'runtime-job-1',
        runner_expires_at: '2026-05-31T00:30:00.000Z',
        attached_runtime_job_id: 'attached-runtime-job-1',
        worker_id: 'worker-1',
        runtime_evidence_digest: 'sha256:runtime-evidence-live-runner',
        launch_materialization_digest: 'sha256:launch-materialization-live-runner',
        idempotency_key: 'attach-runtime-job-1',
        request_digest: 'sha256:attach-runtime-job-1',
        now: '2026-05-31T00:19:00.000Z',
      }),
    ).resolves.toMatchObject({
      id: 'attached-runtime-job-1',
      status: 'running',
    });
  });

  it('attaches a later turn after the intermediate start-thread runtime job terminalizes', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    await bindCodexSessionThread(repository);
    await startSessionRunnerRuntimeJob(repository);
    await repository.markCodexSessionRunnerOwner({
      session_id: 'session-1',
      runner_worker_id: 'worker-1',
      runner_launch_lease_id: 'launch-lease-1',
      runner_runtime_job_id: 'runtime-job-1',
      runner_expires_at: '2026-05-31T00:20:00.000Z',
      now: '2026-05-31T00:02:30.000Z',
    });
    await repository.terminalizeCodexRuntimeJob({
      runtime_job_id: 'runtime-job-1',
      launch_lease_id: 'launch-lease-1',
      worker_id: 'worker-1',
      worker_session_token: 'session-token-1',
      nonce: 'terminalize-intermediate-runner-turn',
      nonce_timestamp: '2026-05-31T00:04:00.000Z',
      terminal_status: 'succeeded',
      reason_code: 'completed',
      terminal_result_json: validGenerationTerminalResult('intermediate turn completed'),
      idempotency_key: 'terminalize-intermediate-runner-turn',
      request_digest: 'sha256:terminalize-intermediate-runner-turn',
      replay_protection: replayProtectionFor('/codex-runtime/jobs/runtime-job-1/terminal', 'sha256:terminalize-intermediate-runner-turn'),
      now: '2026-05-31T00:04:00.000Z',
    });
    await expect(repository.getCodexRuntimeJob({ runtime_job_id: 'runtime-job-1' })).resolves.toMatchObject({
      status: 'terminal',
      terminal_status: 'succeeded',
    });
    await expect(publicLaunchLeaseStatus(repository, 'launch-lease-1')).resolves.toMatchObject({ status: 'materialized' });
    await createAcceptedSessionRuntimeJob(repository, {
      input_json: resumeThreadRuntimeInput({ codex_session_turn_id: 'turn-2' }),
      codex_session_turn_id: 'turn-2',
      input_digest: tokenHash('attached-runtime-resume-input'),
    });

    await expect(
      attachCodexSessionRunnerRuntimeJob(repository, {
        session_id: 'session-1',
        runner_launch_lease_id: 'launch-lease-1',
        runner_runtime_job_id: 'runtime-job-1',
        runner_expires_at: '2026-05-31T00:30:00.000Z',
        attached_runtime_job_id: 'attached-runtime-job-1',
        worker_id: 'worker-1',
        runtime_evidence_digest: 'sha256:runtime-evidence-live-runner',
        launch_materialization_digest: 'sha256:launch-materialization-live-runner',
        idempotency_key: 'attach-runtime-job-1',
        request_digest: 'sha256:attach-runtime-job-1',
        now: '2026-05-31T00:06:00.000Z',
      }),
    ).resolves.toMatchObject({
      id: 'attached-runtime-job-1',
      status: 'running',
    });
    await expect(publicLaunchLeaseStatus(repository, 'launch-lease-1')).resolves.toMatchObject({ status: 'materialized' });
    await expect(publicLaunchLeaseStatus(repository, 'attached-launch-lease-1')).resolves.toMatchObject({ status: 'materialized' });
  });

  it('rejects attaching a resume-thread runtime job for a different Codex thread binding', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    await bindCodexSessionThread(repository);
    await startSessionRunnerRuntimeJob(repository);
    await repository.markCodexSessionRunnerOwner({
      session_id: 'session-1',
      runner_worker_id: 'worker-1',
      runner_launch_lease_id: 'launch-lease-1',
      runner_runtime_job_id: 'runtime-job-1',
      runner_expires_at: '2026-05-31T00:20:00.000Z',
      now: '2026-05-31T00:02:30.000Z',
    });
    await createAcceptedSessionRuntimeJob(repository, {
      input_json: staleResumeThreadRuntimeInput({ codex_session_turn_id: 'turn-2' }),
      codex_session_turn_id: 'turn-2',
      input_digest: tokenHash('attached-runtime-stale-thread-input'),
    });

    await expectDomainErrorCode(
      () =>
        attachCodexSessionRunnerRuntimeJob(repository, {
          session_id: 'session-1',
          runner_launch_lease_id: 'launch-lease-1',
          runner_runtime_job_id: 'runtime-job-1',
          runner_expires_at: '2026-05-31T00:30:00.000Z',
          attached_runtime_job_id: 'attached-runtime-job-1',
          worker_id: 'worker-1',
          runtime_evidence_digest: 'sha256:runtime-evidence-live-runner',
          launch_materialization_digest: 'sha256:launch-materialization-live-runner',
          idempotency_key: 'attach-runtime-job-1',
          request_digest: 'sha256:attach-runtime-job-1',
          now: '2026-05-31T00:06:00.000Z',
        }),
      'codex_runtime_job_unavailable',
    );
    await expect(repository.getCodexRuntimeJob({ runtime_job_id: 'attached-runtime-job-1' })).resolves.toMatchObject({
      status: 'accepted',
    });
    await expect(publicLaunchLeaseStatus(repository, 'attached-launch-lease-1')).resolves.toMatchObject({ status: 'active' });
  });

  it('rejects attaching a runtime job whose launch lease is the session runner launch lease', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    await repository.createCodexSessionTurn(turnInput);
    await createAcceptedSessionRuntimeJob(repository, {
      input_json: resumeThreadRuntimeInput({ codex_session_turn_id: 'turn-2' }),
      codex_session_turn_id: 'turn-2',
      input_digest: tokenHash('attached-runtime-resume-input'),
    });
    await repository.markCodexSessionRunnerOwner({
      session_id: 'session-1',
      runner_worker_id: 'worker-1',
      runner_launch_lease_id: 'attached-launch-lease-1',
      runner_runtime_job_id: 'runtime-job-1',
      runner_expires_at: '2026-05-31T00:20:00.000Z',
      now: '2026-05-31T00:00:00.000Z',
    });

    await expectDomainErrorCode(
      () =>
        attachCodexSessionRunnerRuntimeJob(repository, {
          session_id: 'session-1',
          runner_launch_lease_id: 'attached-launch-lease-1',
          runner_runtime_job_id: 'runtime-job-1',
          runner_expires_at: '2026-05-31T00:30:00.000Z',
          attached_runtime_job_id: 'attached-runtime-job-1',
          worker_id: 'worker-1',
          runtime_evidence_digest: 'sha256:runtime-evidence-live-runner',
          launch_materialization_digest: 'sha256:launch-materialization-live-runner',
          idempotency_key: 'attach-runtime-job-1',
          request_digest: 'sha256:attach-runtime-job-1',
          now: '2026-05-31T00:06:00.000Z',
        }),
      'codex_runtime_job_unavailable',
    );
    await expect(publicLaunchLeaseStatus(repository, 'attached-launch-lease-1')).resolves.toMatchObject({ status: 'active' });
  });

  it('rejects attaching a runtime job without a matching resume-thread context', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    await bindCodexSessionThread(repository);
    await startSessionRunnerRuntimeJob(repository);
    await repository.markCodexSessionRunnerOwner({
      session_id: 'session-1',
      runner_worker_id: 'worker-1',
      runner_launch_lease_id: 'launch-lease-1',
      runner_runtime_job_id: 'runtime-job-1',
      runner_expires_at: '2026-05-31T00:20:00.000Z',
      now: '2026-05-31T00:02:30.000Z',
    });
    await createAcceptedSessionRuntimeJob(repository);

    await expectDomainErrorCode(
      () =>
        attachCodexSessionRunnerRuntimeJob(repository, {
          session_id: 'session-1',
          runner_launch_lease_id: 'launch-lease-1',
          runner_runtime_job_id: 'runtime-job-1',
          runner_expires_at: '2026-05-31T00:30:00.000Z',
          attached_runtime_job_id: 'attached-runtime-job-1',
          worker_id: 'worker-1',
          runtime_evidence_digest: 'sha256:runtime-evidence-live-runner',
          launch_materialization_digest: 'sha256:launch-materialization-live-runner',
          idempotency_key: 'attach-runtime-job-1',
          request_digest: 'sha256:attach-runtime-job-1',
          now: '2026-05-31T00:06:00.000Z',
        }),
      'codex_runtime_job_unavailable',
    );
    await expect(repository.getCodexRuntimeJob({ runtime_job_id: 'attached-runtime-job-1' })).resolves.toMatchObject({
      status: 'accepted',
    });
    await expect(publicLaunchLeaseStatus(repository, 'attached-launch-lease-1')).resolves.toMatchObject({ status: 'active' });
  });

  it('rejects attaching a start-thread runtime job to a persisted session runner', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    await bindCodexSessionThread(repository);
    await startSessionRunnerRuntimeJob(repository);
    await repository.markCodexSessionRunnerOwner({
      session_id: 'session-1',
      runner_worker_id: 'worker-1',
      runner_launch_lease_id: 'launch-lease-1',
      runner_runtime_job_id: 'runtime-job-1',
      runner_expires_at: '2026-05-31T00:20:00.000Z',
      now: '2026-05-31T00:02:30.000Z',
    });
    await createAcceptedSessionRuntimeJob(repository, {
      input_json: startThreadRuntimeInput(),
      input_digest: tokenHash('attached-runtime-start-thread-input'),
    });

    await expectDomainErrorCode(
      () =>
        attachCodexSessionRunnerRuntimeJob(repository, {
          session_id: 'session-1',
          runner_launch_lease_id: 'launch-lease-1',
          runner_runtime_job_id: 'runtime-job-1',
          runner_expires_at: '2026-05-31T00:30:00.000Z',
          attached_runtime_job_id: 'attached-runtime-job-1',
          worker_id: 'worker-1',
          runtime_evidence_digest: 'sha256:runtime-evidence-live-runner',
          launch_materialization_digest: 'sha256:launch-materialization-live-runner',
          idempotency_key: 'attach-runtime-job-1',
          request_digest: 'sha256:attach-runtime-job-1',
          now: '2026-05-31T00:06:00.000Z',
        }),
      'codex_runtime_job_unavailable',
    );
    await expect(publicLaunchLeaseStatus(repository, 'attached-launch-lease-1')).resolves.toMatchObject({ status: 'active' });
  });

  it('rejects attaching a resume-thread runtime job with stale runner context', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    await bindCodexSessionThread(repository);
    await startSessionRunnerRuntimeJob(repository);
    await repository.markCodexSessionRunnerOwner({
      session_id: 'session-1',
      runner_worker_id: 'worker-1',
      runner_launch_lease_id: 'launch-lease-1',
      runner_runtime_job_id: 'runtime-job-1',
      runner_expires_at: '2026-05-31T00:20:00.000Z',
      now: '2026-05-31T00:02:30.000Z',
    });
    await createAcceptedSessionRuntimeJob(repository, {
      input_json: codexSessionRuntimeContextInput(
        {
          kind: 'resume_thread',
          codex_thread_id: 'thread-1',
          codex_thread_id_digest: codexCanonicalDigest({ kind: 'codex_app_server_thread_id', thread_id: 'thread-1' }),
        },
        { codex_session_turn_id: 'turn-2', runner_launch_lease_id: 'launch-lease-stale' },
      ),
      codex_session_turn_id: 'turn-2',
      input_digest: tokenHash('attached-runtime-stale-runner-input'),
    });

    await expectDomainErrorCode(
      () =>
        attachCodexSessionRunnerRuntimeJob(repository, {
          session_id: 'session-1',
          runner_launch_lease_id: 'launch-lease-1',
          runner_runtime_job_id: 'runtime-job-1',
          runner_expires_at: '2026-05-31T00:30:00.000Z',
          attached_runtime_job_id: 'attached-runtime-job-1',
          worker_id: 'worker-1',
          runtime_evidence_digest: 'sha256:runtime-evidence-live-runner',
          launch_materialization_digest: 'sha256:launch-materialization-live-runner',
          idempotency_key: 'attach-runtime-job-1',
          request_digest: 'sha256:attach-runtime-job-1',
          now: '2026-05-31T00:06:00.000Z',
        }),
      'codex_runtime_job_unavailable',
    );
    await expect(publicLaunchLeaseStatus(repository, 'attached-launch-lease-1')).resolves.toMatchObject({ status: 'active' });
  });

  it('rejects attaching a resume-thread runtime job when the attached launch fence is stale', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    await bindCodexSessionThread(repository);
    await startSessionRunnerRuntimeJob(repository);
    await repository.markCodexSessionRunnerOwner({
      session_id: 'session-1',
      runner_worker_id: 'worker-1',
      runner_launch_lease_id: 'launch-lease-1',
      runner_runtime_job_id: 'runtime-job-1',
      runner_expires_at: '2026-05-31T00:20:00.000Z',
      now: '2026-05-31T00:02:30.000Z',
    });
    await createAcceptedSessionRuntimeJob(repository, {
      input_json: resumeThreadRuntimeInput({ codex_session_turn_id: 'turn-2' }),
      codex_session_turn_id: 'turn-2',
      input_digest: tokenHash('attached-runtime-resume-input'),
    });
    const run = await repository.getRunSession('runtime-run-session-1');
    if (run === undefined) throw new Error('Expected seeded run session');
    await repository.saveRunSession({
      ...run,
      status: 'succeeded',
      updated_at: '2026-05-31T00:05:00.000Z',
    });

    await expectDomainErrorCode(
      () =>
        attachCodexSessionRunnerRuntimeJob(repository, {
          session_id: 'session-1',
          runner_launch_lease_id: 'launch-lease-1',
          runner_runtime_job_id: 'runtime-job-1',
          runner_expires_at: '2026-05-31T00:30:00.000Z',
          attached_runtime_job_id: 'attached-runtime-job-1',
          worker_id: 'worker-1',
          runtime_evidence_digest: 'sha256:runtime-evidence-live-runner',
          launch_materialization_digest: 'sha256:launch-materialization-live-runner',
          idempotency_key: 'attach-runtime-job-1',
          request_digest: 'sha256:attach-runtime-job-1',
          now: '2026-05-31T00:06:00.000Z',
        }),
      'codex_runtime_job_unavailable',
    );
    await expect(repository.getCodexRuntimeJob({ runtime_job_id: 'attached-runtime-job-1' })).resolves.toMatchObject({
      status: 'accepted',
    });
    await expect(publicLaunchLeaseStatus(repository, 'attached-launch-lease-1')).resolves.toMatchObject({ status: 'active' });
  });

  it('rejects generic materialization for resume-thread Codex Session runtime jobs', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    await repository.createCodexSessionTurn(turnInput);
    const { input } = await createAcceptedSessionRuntimeJob(repository, {
      input_json: resumeThreadRuntimeInput(),
      input_digest: tokenHash('attached-runtime-resume-input'),
    });
    await claimSessionRuntimeJobEnvelope(repository, input, 'claim-resume-materialize-nonce');

    await expectDomainErrorCode(
      () => materializeSessionRuntimeJob(repository, input, 'materialize-resume-generic-nonce'),
      'codex_session_runner_unavailable',
    );

    const job = await repository.getCodexRuntimeJob({ runtime_job_id: input.runtime_job_id });
    expect(job).toMatchObject({ status: 'accepted' });
    expect(job?.materializing_at).toBeUndefined();
    await expect(publicLaunchLeaseStatus(repository, input.launch_lease_id)).resolves.toMatchObject({ status: 'active' });
  });

  it('rejects generic start for attached resume-thread Codex Session runtime jobs', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    await bindCodexSessionThread(repository);
    await startSessionRunnerRuntimeJob(repository);
    await repository.markCodexSessionRunnerOwner({
      session_id: 'session-1',
      runner_worker_id: 'worker-1',
      runner_launch_lease_id: 'launch-lease-1',
      runner_runtime_job_id: 'runtime-job-1',
      runner_expires_at: '2026-05-31T00:20:00.000Z',
      now: '2026-05-31T00:02:30.000Z',
    });
    const { input } = await createAcceptedSessionRuntimeJob(repository, {
      input_json: resumeThreadRuntimeInput(),
      input_digest: tokenHash('attached-runtime-resume-input'),
    });
    const attached = await attachCodexSessionRunnerRuntimeJob(repository, {
      session_id: 'session-1',
      runner_launch_lease_id: 'launch-lease-1',
      runner_runtime_job_id: 'runtime-job-1',
      runner_expires_at: '2026-05-31T00:30:00.000Z',
      attached_runtime_job_id: input.runtime_job_id,
      worker_id: 'worker-1',
      runtime_evidence_digest: tokenHash(`runtime-evidence-${input.runtime_job_id}`),
      launch_materialization_digest: tokenHash(`launch-materialization-${input.runtime_job_id}`),
      idempotency_key: `start-${input.runtime_job_id}`,
      request_digest: tokenHash(`start-request-${input.runtime_job_id}`),
      now: '2026-05-31T00:06:00.000Z',
    });
    expect(attached).toMatchObject({
      status: 'running',
      start_idempotency_key: `start-${input.runtime_job_id}`,
    });

    await expectDomainErrorCode(
      () => startSessionRuntimeJob(repository, input, 'start-attached-resume-generic-nonce'),
      'codex_session_runner_unavailable',
    );

    await expect(repository.getCodexRuntimeJob({ runtime_job_id: input.runtime_job_id })).resolves.toMatchObject({
      status: 'running',
      runtime_evidence_digest: tokenHash(`runtime-evidence-${input.runtime_job_id}`),
      launch_materialization_digest: tokenHash(`launch-materialization-${input.runtime_job_id}`),
    });
    await expect(publicLaunchLeaseStatus(repository, input.launch_lease_id)).resolves.toMatchObject({ status: 'materialized' });
    await expect(repository.getCodexSession('session-1')).resolves.toMatchObject({
      runner_launch_lease_id: 'launch-lease-1',
      runner_runtime_job_id: 'runtime-job-1',
      runner_expires_at: '2026-05-31T00:30:00.000Z',
    });
  });

  it('allows generic materialization and start for start-thread Codex Session runtime jobs', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    await repository.createCodexSessionTurn(turnInput);
    const { input } = await createAcceptedSessionRuntimeJob(repository, {
      input_json: startThreadRuntimeInput(),
      input_digest: tokenHash('attached-runtime-start-thread-input'),
    });
    await claimSessionRuntimeJobEnvelope(repository, input, 'claim-start-thread-nonce');
    await expect(materializeSessionRuntimeJob(repository, input, 'materialize-start-thread-nonce')).resolves.toMatchObject({
      lease_id: input.launch_lease_id,
      materialized_at: later,
    });
    await expect(startSessionRuntimeJob(repository, input, 'start-start-thread-nonce')).resolves.toMatchObject({
      id: input.runtime_job_id,
      status: 'running',
      runtime_evidence_digest: tokenHash(`runtime-evidence-${input.runtime_job_id}`),
    });
    await expect(publicLaunchLeaseStatus(repository, input.launch_lease_id)).resolves.toMatchObject({ status: 'materialized' });
  });

  it('allows generic materialization and start for non-session runtime jobs', async () => {
    const repository = new InMemoryDeliveryRepository();
    const { input } = await createAcceptedSessionRuntimeJob(repository, {
      runtime_job_id: 'one-shot-runtime-job-1',
      launch_lease_id: 'one-shot-launch-lease-1',
      envelope_id: 'one-shot-runtime-envelope-1',
      job_request_id: 'one-shot-runtime-job-request-1',
      input_json: { task: 'draft standalone output' },
      input_digest: tokenHash('one-shot-runtime-input'),
      workflow_id: undefined,
      codex_session_id: undefined,
      codex_session_turn_id: undefined,
    });
    await claimSessionRuntimeJobEnvelope(repository, input, 'claim-one-shot-nonce');
    await expect(materializeSessionRuntimeJob(repository, input, 'materialize-one-shot-nonce')).resolves.toMatchObject({
      lease_id: input.launch_lease_id,
      materialized_at: later,
    });
    await expect(startSessionRuntimeJob(repository, input, 'start-one-shot-nonce')).resolves.toMatchObject({
      id: input.runtime_job_id,
      status: 'running',
    });
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
          expected_input_capsule_digest: undefined,
          now,
          expires_at: '2026-05-31T00:05:00.000Z',
        }),
      'codex_session_lease_conflict',
    );
  });

  it('recovers an expired active lease before accepting a new claim', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    const expiredClaim = await repository.claimCodexSessionLease({
      ...leaseInput,
      expires_at: '2026-05-31T00:01:00.000Z',
    });

    const secondClaim = await repository.claimCodexSessionLease({
      ...leaseInput,
      lease_id: 'lease-2',
      lease_token_hash: 'sha256:lease-token-2',
      worker_id: 'worker-2',
      worker_session_digest: 'sha256:worker-session-2',
      now: '2026-05-31T00:02:00.000Z',
      expires_at: '2026-05-31T00:07:00.000Z',
    });

    await expect(repository.getCodexSession('session-1')).resolves.toMatchObject({
      status: 'running',
      active_lease_id: 'lease-2',
      lease_epoch: 2,
    });
    expect(secondClaim.lease).toMatchObject({ id: 'lease-2', status: 'active', lease_epoch: 2 });
    await expect(repository.renewCodexSessionLease({
      session_id: 'session-1',
      lease_id: expiredClaim.lease.id,
      lease_token_hash: 'sha256:lease-token',
      worker_id: 'worker-1',
      worker_session_digest: 'sha256:worker-session',
      lease_epoch: 1,
      now: '2026-05-31T00:02:30.000Z',
      expires_at: '2026-05-31T00:08:00.000Z',
    })).rejects.toThrow(/codex_session_lease_conflict/);
    await expect(repository.renewCodexSessionLease({
      session_id: 'session-1',
      lease_id: secondClaim.lease.id,
      lease_token_hash: 'sha256:lease-token-2',
      worker_id: 'worker-2',
      worker_session_digest: 'sha256:worker-session-2',
      lease_epoch: 2,
      now: '2026-05-31T00:02:30.000Z',
      expires_at: '2026-05-31T00:08:00.000Z',
    })).resolves.toMatchObject({ id: 'lease-2', status: 'active' });
  });

  it('recovers an expired active lease before creating the next turn', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    await repository.createCodexSessionTurn(turnInput);
    await repository.claimCodexSessionLease({
      ...leaseInput,
      expires_at: '2026-05-31T00:01:00.000Z',
    });

    await repository.createCodexSessionTurn({
      ...turnInput,
      id: 'turn-2',
      input_digest: 'sha256:turn-input-2',
      created_at: '2026-05-31T00:02:00.000Z',
      updated_at: '2026-05-31T00:02:00.000Z',
    });

    await expect(repository.renewCodexSessionLease({
      session_id: 'session-1',
      lease_id: 'lease-1',
      lease_token_hash: 'sha256:lease-token',
      worker_id: 'worker-1',
      worker_session_digest: 'sha256:worker-session',
      lease_epoch: 1,
      now: '2026-05-31T00:02:30.000Z',
      expires_at: '2026-05-31T00:08:00.000Z',
    })).rejects.toThrow(/codex_session_lease_conflict/);
    await expect(repository.getCodexSession('session-1')).resolves.toMatchObject({
      status: 'recovering',
      latest_turn_id: 'turn-2',
      latest_turn_digest: 'sha256:turn-input-2',
      lease_epoch: 1,
    });
  });

  it('explicitly recovers an expired active lease before claiming a recovering session', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    await repository.claimCodexSessionLease({
      ...leaseInput,
      expires_at: '2026-05-31T00:01:00.000Z',
    });

    const recovered = await repository.recoverCodexSessionLeaseForClaim({
      session_id: 'session-1',
      workflow_id: 'workflow-1',
      lease_id: 'lease-1',
      lease_token_hash: 'sha256:lease-token',
      worker_id: 'worker-1',
      worker_session_digest: 'sha256:worker-session',
      lease_epoch: 1,
      expected_input_capsule_digest: undefined,
      now: '2026-05-31T00:02:00.000Z',
    });

    expect(recovered.lease).toMatchObject({
      id: 'lease-1',
      status: 'fenced',
      fenced_at: '2026-05-31T00:02:00.000Z',
    });
    expect(recovered.session).toMatchObject({
      id: 'session-1',
      status: 'recovering',
      lease_epoch: 1,
    });
    expect(recovered.session).not.toHaveProperty('active_lease_id');

    const claimed = await repository.claimCodexSessionLease({
      ...leaseInput,
      lease_id: 'lease-2',
      lease_token_hash: 'sha256:lease-token-2',
      worker_id: 'worker-2',
      worker_session_digest: 'sha256:worker-session-2',
      now: '2026-05-31T00:03:00.000Z',
      expires_at: '2026-05-31T00:08:00.000Z',
    });

    expect(claimed.lease).toMatchObject({ id: 'lease-2', status: 'active', lease_epoch: 2 });
    expect(claimed.session).toMatchObject({
      id: 'session-1',
      status: 'running',
      active_lease_id: 'lease-2',
      lease_epoch: 2,
    });
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

  it('does not recover an expired active lease before rejecting a strict claim with a stale capsule expectation', async () => {
    const repository = new InMemoryDeliveryRepository();
    await seedWorkflowWithCapsule(repository);
    await repository.claimCodexSessionLease({
      ...leaseInput,
      expected_input_capsule_digest: 'sha256:capsule-1',
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
          expected_input_capsule_digest: 'sha256:stale',
          now: '2026-05-31T00:02:00.000Z',
          expires_at: '2026-05-31T00:07:00.000Z',
        }),
      'codex_session_lease_conflict',
    );

    await expect(repository.getCodexSession('session-1')).resolves.toMatchObject({
      status: 'running',
      active_lease_id: 'lease-1',
      latest_capsule_digest: 'sha256:capsule-1',
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
      expected_input_capsule_digest: undefined,
      output_capsule: { ...runtimeCapsuleInput },
      ...outputContinuationInput({ turnId: 'turn-1' }),
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
      expected_input_capsule_digest: undefined,
      now: '2026-05-31T00:02:00.000Z',
    });

    await expectDomainErrorCode(() => repository.claimCodexSessionLease(leaseInput), 'codex_session_lease_conflict');
  });

  it('rejects lease claim when expected capsule digest is stale', async () => {
    const repository = new InMemoryDeliveryRepository();
    await seedWorkflowWithCapsule(repository);

    await expectDomainErrorCode(
      () =>
        repository.claimCodexSessionLease({
          ...leaseInput,
          expected_input_capsule_digest: 'sha256:stale',
        }),
      'codex_runtime_capsule_stale',
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

  it('rejects creating a turn when expected capsule digest is stale', async () => {
    const repository = new InMemoryDeliveryRepository();
    await seedWorkflowWithCapsule(repository);

    await expectDomainErrorCode(
      () =>
        repository.createCodexSessionTurn({
          ...turnInput,
          expected_input_capsule_digest: 'sha256:stale',
        }),
      'codex_runtime_capsule_stale',
    );
  });

  it.each([
    { label: 'terminal status', serviceOwnedFields: { status: 'succeeded' } },
    { label: 'output capsule id', serviceOwnedFields: { output_capsule_id: 'capsule-1' } },
    { label: 'output capsule digest', serviceOwnedFields: { output_capsule_digest: 'sha256:capsule-1' } },
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
          output_capsule_id: 'capsule-1',
          output_capsule_digest: 'sha256:capsule-1',
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
      expected_input_capsule_digest: undefined,
      output_capsule: runtimeCapsuleInput,
      ...outputContinuationInput({ turnId: 'turn-1' }),
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
          expected_input_capsule_digest: 'sha256:drifted-previous',
          output_capsule_id: 'capsule-drifted',
          output_capsule_digest: 'sha256:capsule-drifted',
          lease_id: 'lease-drifted',
          lease_epoch: 99,
          created_at: '2026-05-31T00:01:00.000Z',
          created_by_actor_id: 'actor-drifted',
          status: 'failed',
          output_object_type: 'internal_artifact',
          output_object_id: 'capsule-drifted',
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
      expected_input_capsule_digest: undefined,
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
          expected_input_capsule_digest: undefined,
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
      expected_input_capsule_digest: undefined,
      output_capsule: {
        ...runtimeCapsuleInput,
      },
      ...outputContinuationInput({ turnId: 'turn-1' }),
      codex_thread_id: 'thread-1',
      codex_thread_id_digest: 'sha256:thread-1',
      now: '2026-05-31T00:02:00.000Z',
    });

    expect(terminalized.session).toMatchObject({
      status: 'idle',
      latest_capsule_id: 'capsule-1',
      latest_capsule_digest: 'sha256:capsule-1',
      codex_thread_id_digest: 'sha256:thread-1',
    });
    expect(terminalized.session).not.toHaveProperty('active_lease_id');
    await expect(repository.getCodexRuntimeCapsule('capsule-1')).resolves.toMatchObject({ digest: 'sha256:capsule-1' });
  });

  it('terminalizes successful workflow execution atomically across runtime job, run, session turn, capsule, and workflow', async () => {
    const repository = new InMemoryDeliveryRepository();
    const seeded = await seedWorkflowExecutionRunning(repository);

    const terminalized = await repository.terminalizeWorkflowExecution(
      workflowExecutionTerminalizationInput(seeded, 'succeeded'),
    );

    expect(terminalized).toMatchObject({
      stale: false,
      runtime_job: { id: seeded.runtime.input.runtime_job_id, status: 'terminal', terminal_status: 'succeeded' },
      run_session: { id: seeded.runtime.input.target.target_id, status: 'succeeded', finished_at: '2026-05-31T00:10:00.000Z' },
      session: {
        id: 'session-1',
        status: 'idle',
        latest_capsule_id: 'capsule-execution-output',
        latest_capsule_digest: 'sha256:capsule-execution-output',
        latest_memory_bundle_ref: 'artifact://internal/codex_memory_bundle/codex_session/session-1/memory-execution-output',
        latest_memory_bundle_digest: 'sha256:memory-execution-output',
        latest_environment_manifest_ref: 'artifact://internal/codex_environment_manifest/codex_session/session-1/environment-execution-output',
        latest_environment_manifest_digest: 'sha256:environment-execution-output',
      },
      turn: { id: 'turn-1', status: 'succeeded', output_capsule_id: 'capsule-execution-output' },
      workflow: { id: 'workflow-1', status: 'code_review' },
    });
    await expect(repository.getCodexRuntimeCapsule('capsule-execution-output')).resolves.toMatchObject({
      id: 'capsule-execution-output',
      created_from_turn_id: 'turn-1',
    });
    await expect(repository.listStaleCodexSessionTerminalizationAttempts('session-1')).resolves.toEqual([]);
  });

  it.each([
    ['failed' as const, 'failed' as const],
    ['cancelled' as const, 'cancelled' as const],
  ])('terminalizes %s workflow execution into blocked state with the same guarded predicates', async (terminalStatus, runStatus) => {
    const repository = new InMemoryDeliveryRepository();
    const seeded = await seedWorkflowExecutionRunning(repository);

    const terminalized = await repository.terminalizeWorkflowExecution(
      workflowExecutionTerminalizationInput(seeded, terminalStatus),
    );

    expect(terminalized).toMatchObject({
      stale: false,
      runtime_job: { id: seeded.runtime.input.runtime_job_id, status: 'terminal', terminal_status: terminalStatus },
      run_session: { id: seeded.runtime.input.target.target_id, status: runStatus, finished_at: '2026-05-31T00:10:00.000Z' },
      session: { id: 'session-1', status: 'blocked' },
      turn: { id: 'turn-1', status: terminalStatus },
      workflow: { id: 'workflow-1', status: 'blocked' },
    });
    const session = await repository.getCodexSession('session-1');
    expect(session?.latest_capsule_id).toBeUndefined();
    expect(session?.latest_capsule_digest).toBeUndefined();
    expect(session?.latest_memory_bundle_ref).toBeUndefined();
    expect(session?.latest_environment_manifest_ref).toBeUndefined();
    await expect(repository.getCodexRuntimeCapsule('capsule-execution-output')).resolves.toBeUndefined();
  });

  it('records stale workflow execution terminalization evidence without mutating active state', async () => {
    const repository = new InMemoryDeliveryRepository();
    const seeded = await seedWorkflowExecutionRunning(repository);
    const staleInput = workflowExecutionTerminalizationInput(seeded, 'succeeded');
    const attempted = {
      ...staleInput,
      codex_session_turn_terminalization: {
        ...staleInput.codex_session_turn_terminalization,
        lease_epoch: seeded.claimedSessionLease.lease.lease_epoch + 1,
      },
      stale_attempt: {
        ...staleInput.stale_attempt,
        id: 'stale-workflow-execution-lease-epoch',
        lease_epoch: seeded.claimedSessionLease.lease.lease_epoch + 1,
        failure_code: 'codex_session_stale_terminalization',
      },
    };

    const result = await repository.terminalizeWorkflowExecution(attempted);

    expect(result).toMatchObject({
      stale: true,
      stale_attempt: { id: 'stale-workflow-execution-lease-epoch', lease_epoch: 2 },
    });
    await expect(repository.listStaleCodexSessionTerminalizationAttempts('session-1')).resolves.toEqual([
      expect.objectContaining({ id: 'stale-workflow-execution-lease-epoch', lease_epoch: 2 }),
    ]);
    await expect(repository.getPlanItemWorkflow('workflow-1')).resolves.toMatchObject({ status: 'execution_running' });
    const runtimeJob = await repository.getCodexRuntimeJob({ runtime_job_id: seeded.runtime.input.runtime_job_id });
    expect(runtimeJob).toMatchObject({ status: 'running' });
    expect(runtimeJob?.terminal_status).toBeUndefined();
    const runSession = await repository.getRunSession(seeded.runtime.input.target.target_id);
    expect(runSession).toMatchObject({ status: 'running' });
    expect(runSession?.finished_at).toBeUndefined();
    await expect(repository.getCodexSession('session-1')).resolves.toMatchObject({
      status: 'running',
      active_lease_id: seeded.claimedSessionLease.lease.id,
    });
    await expect(repository.getCodexSessionTurn('turn-1')).resolves.toMatchObject({ status: 'running' });
    await expect(repository.getCodexRuntimeCapsule('capsule-execution-output')).resolves.toBeUndefined();
  });

  it('rejects successful terminalization without an output capsule before mutation', async () => {
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
          expected_input_capsule_digest: undefined,
          codex_thread_id: 'thread-1',
          codex_thread_id_digest: 'sha256:thread-1',
          now: '2026-05-31T00:02:00.000Z',
        }),
      'codex_runtime_capsule_stale',
    );

    await expect(repository.getCodexSession('session-1')).resolves.toMatchObject({
      status: 'running',
      active_lease_id: claimed.lease.id,
    });
    const session = await repository.getCodexSession('session-1');
    expect(session?.latest_capsule_id).toBeUndefined();
    expect(session?.latest_capsule_digest).toBeUndefined();
    expect(session?.codex_thread_id_digest).toBeUndefined();
    await expect(repository.getCodexSessionTurn('turn-1')).resolves.toMatchObject({ status: 'running' });
    const turn = await repository.getCodexSessionTurn('turn-1');
    expect(turn?.output_capsule_id).toBeUndefined();
    expect(turn?.output_capsule_digest).toBeUndefined();
    expect(turn?.codex_thread_id_digest).toBeUndefined();
  });

  it('rejects failed terminalization with output continuation before mutation', async () => {
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
          status: 'failed',
          expected_input_capsule_digest: undefined,
          output_capsule: { ...runtimeCapsuleInput },
          ...outputContinuationInput({ turnId: 'turn-1' }),
          failure_code: 'codex_runtime_capsule_missing',
          now: '2026-05-31T00:02:00.000Z',
        }),
      'codex_runtime_capsule_stale',
    );

    const session = await repository.getCodexSession('session-1');
    expect(session).toMatchObject({
      status: 'running',
      active_lease_id: claimed.lease.id,
    });
    expect(session?.latest_capsule_id).toBeUndefined();
    expect(session?.latest_capsule_digest).toBeUndefined();
    expect(session?.latest_memory_bundle_ref).toBeUndefined();
    expect(session?.latest_memory_bundle_digest).toBeUndefined();
    expect(session?.latest_environment_manifest_ref).toBeUndefined();
    expect(session?.latest_environment_manifest_digest).toBeUndefined();
    const turn = await repository.getCodexSessionTurn('turn-1');
    expect(turn).toMatchObject({ status: 'running' });
    expect(turn?.output_capsule_id).toBeUndefined();
    expect(turn?.output_capsule_digest).toBeUndefined();
    expect(turn?.output_memory_bundle_ref).toBeUndefined();
    expect(turn?.output_memory_bundle_digest).toBeUndefined();
    expect(turn?.output_environment_manifest_ref).toBeUndefined();
    expect(turn?.output_environment_manifest_digest).toBeUndefined();
    await expect(repository.getCodexRuntimeCapsule('capsule-1')).resolves.toBeUndefined();
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
          expected_input_capsule_digest: undefined,
          output_capsule: { ...runtimeCapsuleInput },
          ...outputContinuationInput({ turnId: 'turn-1' }),
          codex_thread_id: 'thread-1',
          now: '2026-05-31T00:02:00.000Z',
        }),
      'codex_session_thread_binding_stale',
    );

    await expect(repository.getCodexSession('session-1')).resolves.toMatchObject({
      status: 'running',
      active_lease_id: claimed.lease.id,
    });
    const session = await repository.getCodexSession('session-1');
    expect(session?.codex_thread_id).toBeUndefined();
    expect(session?.codex_thread_id_digest).toBeUndefined();
    await expect(repository.getCodexSessionTurn('turn-1')).resolves.toMatchObject({ status: 'running' });
    await expect(repository.getCodexRuntimeCapsule('capsule-1')).resolves.toBeUndefined();
  });

  it('requires Codex thread id and digest for app-server-backed terminalization before mutation', async () => {
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
          expected_input_capsule_digest: undefined,
          output_capsule: { ...runtimeCapsuleInput },
          ...outputContinuationInput({ turnId: 'turn-1' }),
          app_server_thread_binding_required: true,
          now: '2026-05-31T00:02:00.000Z',
        }),
      'codex_app_server_thread_id_missing',
    );

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
          expected_input_capsule_digest: undefined,
          output_capsule: { ...runtimeCapsuleInput },
          ...outputContinuationInput({ turnId: 'turn-1' }),
          app_server_thread_binding_required: true,
          codex_thread_id: 'thread-1',
          now: '2026-05-31T00:02:00.000Z',
        }),
      'codex_app_server_thread_id_missing',
    );

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
          expected_input_capsule_digest: undefined,
          output_capsule: { ...runtimeCapsuleInput },
          ...outputContinuationInput({ turnId: 'turn-1' }),
          app_server_thread_binding_required: true,
          codex_thread_id_digest: 'sha256:thread-1',
          now: '2026-05-31T00:02:00.000Z',
        }),
      'codex_app_server_thread_id_missing',
    );

    await expect(repository.getCodexSession('session-1')).resolves.toMatchObject({
      status: 'running',
      active_lease_id: claimed.lease.id,
    });
    const session = await repository.getCodexSession('session-1');
    expect(session?.codex_thread_id).toBeUndefined();
    expect(session?.codex_thread_id_digest).toBeUndefined();
    await expect(repository.getCodexSessionTurn('turn-1')).resolves.toMatchObject({ status: 'running' });
    await expect(repository.getCodexRuntimeCapsule('capsule-1')).resolves.toBeUndefined();
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
          expected_input_capsule_digest: undefined,
          output_capsule: { ...runtimeCapsuleInput },
          ...outputContinuationInput({ turnId: 'turn-1' }),
          codex_thread_id_digest: 'sha256:thread-1',
          now: '2026-05-31T00:02:00.000Z',
        }),
      'codex_session_thread_binding_stale',
    );

    await expect(repository.getCodexSession('session-1')).resolves.toMatchObject({
      status: 'running',
      active_lease_id: claimed.lease.id,
    });
    const session = await repository.getCodexSession('session-1');
    expect(session?.codex_thread_id).toBeUndefined();
    expect(session?.codex_thread_id_digest).toBeUndefined();
    await expect(repository.getCodexSessionTurn('turn-1')).resolves.toMatchObject({ status: 'running' });
    await expect(repository.getCodexRuntimeCapsule('capsule-1')).resolves.toBeUndefined();
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
      expected_input_capsule_digest: undefined,
      output_capsule: { ...runtimeCapsuleInput },
      ...outputContinuationInput({ turnId: 'turn-1' }),
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
      expected_input_capsule_digest: undefined,
      output_capsule: { ...runtimeCapsuleInput },
      ...outputContinuationInput({ turnId: 'turn-1' }),
      codex_thread_id: 'thread-1',
      codex_thread_id_digest: 'sha256:thread-1',
      now: '2026-05-31T00:02:00.000Z',
    });
    await repository.createCodexSessionTurn({
      ...turnInput,
      id: 'turn-2',
      input_digest: 'sha256:turn-2',
      expected_input_capsule_digest: 'sha256:capsule-1',
      created_at: '2026-05-31T00:03:00.000Z',
      updated_at: '2026-05-31T00:03:00.000Z',
    });
    const secondClaim = await repository.claimCodexSessionLease({
      ...leaseInput,
      lease_id: 'lease-2',
      lease_token_hash: 'sha256:lease-token-2',
      expected_input_capsule_digest: 'sha256:capsule-1',
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
          expected_input_capsule_digest: 'sha256:capsule-1',
          output_capsule: {
            ...runtimeCapsuleInput,
            id: 'capsule-2',
            sequence: 2,
            artifact_ref: 'artifact://internal/codex_runtime_capsule/codex_session/session-1/capsule-2',
            digest: 'sha256:capsule-2',
            manifest_digest: 'sha256:manifest-2',
            created_from_turn_id: 'turn-2',
          },
          ...outputContinuationInput({ turnId: 'turn-2' }),
          codex_thread_id: 'thread-2',
          codex_thread_id_digest: 'sha256:thread-2',
          now: '2026-05-31T00:05:00.000Z',
        }),
      'codex_session_thread_binding_stale',
    );

    await expect(repository.getCodexSession('session-1')).resolves.toMatchObject({
      status: 'running',
      active_lease_id: 'lease-2',
      lease_epoch: 2,
      codex_thread_id: 'thread-1',
      codex_thread_id_digest: 'sha256:thread-1',
    });
    await expect(repository.getCodexSessionTurn('turn-2')).resolves.toMatchObject({ status: 'running' });
    await expect(repository.getCodexRuntimeCapsule('capsule-2')).resolves.toBeUndefined();
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
      expected_input_capsule_digest: undefined,
      output_capsule: { ...runtimeCapsuleInput },
      ...outputContinuationInput({ turnId: 'turn-1' }),
      codex_thread_id: 'thread-1',
      codex_thread_id_digest: 'sha256:thread-1',
      now: '2026-05-31T00:02:00.000Z',
    });
    await repository.createCodexSessionTurn({
      ...turnInput,
      id: 'turn-2',
      input_digest: 'sha256:turn-2',
      expected_input_capsule_digest: 'sha256:capsule-1',
      created_at: '2026-05-31T00:03:00.000Z',
      updated_at: '2026-05-31T00:03:00.000Z',
    });
    const secondClaim = await repository.claimCodexSessionLease({
      ...leaseInput,
      lease_id: 'lease-2',
      lease_token_hash: 'sha256:lease-token-2',
      expected_input_capsule_digest: 'sha256:capsule-1',
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
      expected_input_capsule_digest: 'sha256:capsule-1',
      output_capsule: {
        ...runtimeCapsuleInput,
        id: 'capsule-2',
        sequence: 2,
        artifact_ref: 'artifact://internal/codex_runtime_capsule/codex_session/session-1/capsule-2',
        digest: 'sha256:capsule-2',
        manifest_digest: 'sha256:manifest-2',
        thread_state_digest: 'sha256:thread-state-2',
        memory_state_digest: 'sha256:memory-state-2',
        environment_manifest_digest: 'sha256:environment-manifest-2',
        app_server_protocol_digest: 'sha256:app-server-protocol-2',
        trusted_runtime_manifest_digest: 'sha256:trusted-runtime-manifest-2',
        credential_binding_lineage_digest: 'sha256:credential-binding-lineage-2',
        created_from_turn_id: 'turn-2',
      },
      ...outputContinuationInput({ turnId: 'turn-2' }),
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
      expected_input_capsule_digest: undefined,
      output_capsule: { ...runtimeCapsuleInput },
      ...outputContinuationInput({ turnId: 'turn-1' }),
      codex_thread_id: 'thread-1',
      codex_thread_id_digest: 'sha256:thread-1',
      now: '2026-05-31T00:02:00.000Z',
    });
    await repository.createCodexSessionTurn({
      ...turnInput,
      id: 'turn-2',
      input_digest: 'sha256:turn-2',
      expected_input_capsule_digest: 'sha256:capsule-1',
      created_at: '2026-05-31T00:03:00.000Z',
      updated_at: '2026-05-31T00:03:00.000Z',
    });
    const secondClaim = await repository.claimCodexSessionLease({
      ...leaseInput,
      lease_id: 'lease-2',
      lease_token_hash: 'sha256:lease-token-2',
      expected_input_capsule_digest: 'sha256:capsule-1',
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
      expected_input_capsule_digest: 'sha256:capsule-1',
      output_capsule: {
        ...runtimeCapsuleInput,
        id: 'capsule-2',
        sequence: 2,
        artifact_ref: 'artifact://internal/codex_runtime_capsule/codex_session/session-1/capsule-2',
        digest: 'sha256:capsule-2',
        manifest_digest: 'sha256:manifest-2',
        thread_state_digest: 'sha256:thread-state-2',
        memory_state_digest: 'sha256:memory-state-2',
        environment_manifest_digest: 'sha256:environment-manifest-2',
        app_server_protocol_digest: 'sha256:app-server-protocol-2',
        trusted_runtime_manifest_digest: 'sha256:trusted-runtime-manifest-2',
        credential_binding_lineage_digest: 'sha256:credential-binding-lineage-2',
        created_from_turn_id: 'turn-2',
      },
      ...outputContinuationInput({ turnId: 'turn-2' }),
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

  it('rejects terminalization when a reused output capsule id has drifted durable identity', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    await repository.createCodexSessionTurn(turnInput);
    await repository.createCodexRuntimeCapsule(runtimeCapsuleInput);
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
          expected_input_capsule_digest: undefined,
          output_capsule: {
            id: 'capsule-1',
            codex_session_id: 'session-1',
            sequence: 1,
            artifact_ref: 'artifact://internal/codex_runtime_capsule/codex_session/session-1/capsule-drifted',
            digest: 'sha256:capsule-drifted',
            size_bytes: '123',
            manifest_digest: 'sha256:manifest-1',
            runtime_profile_revision_id: 'profile-revision-1',
            created_from_turn_id: 'turn-1',
            created_by_actor_id: 'actor-tech',
            created_at: '2026-05-31T00:03:00.000Z',
          },
          ...outputContinuationInput({ turnId: 'turn-1' }),
          now: '2026-05-31T00:03:00.000Z',
        }),
      'codex_runtime_capsule_stale',
    );

    const session = await repository.getCodexSession('session-1');
    expect(session).toMatchObject({
      status: 'running',
      active_lease_id: claimed.lease.id,
    });
    expect(session?.latest_capsule_id).toBeUndefined();
    expect(session?.latest_capsule_digest).toBeUndefined();

    const turn = await repository.getCodexSessionTurn('turn-1');
    expect(turn).toMatchObject({
      status: 'running',
    });
    expect(turn?.output_capsule_id).toBeUndefined();
    expect(turn?.output_capsule_digest).toBeUndefined();
    await expect(repository.getCodexRuntimeCapsule('capsule-1')).resolves.toMatchObject({
      artifact_ref: 'artifact://internal/codex_runtime_capsule/codex_session/session-1/capsule-1',
      digest: 'sha256:capsule-1',
    });
  });

  it('rejects terminalization when output capsule provenance points at a different turn', async () => {
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
          expected_input_capsule_digest: undefined,
          output_capsule: {
            ...runtimeCapsuleInput,
            id: 'capsule-2',
            sequence: 2,
            artifact_ref: 'artifact://internal/codex_runtime_capsule/codex_session/session-1/capsule-2',
            digest: 'sha256:capsule-2',
            manifest_digest: 'sha256:manifest-2',
            created_from_turn_id: 'turn-2',
          },
          ...outputContinuationInput({ turnId: 'turn-1', suffix: 'wrong-turn' }),
          now: '2026-05-31T00:03:00.000Z',
        }),
      'codex_runtime_capsule_stale',
    );

    await expect(repository.getCodexSession('session-1')).resolves.toMatchObject({
      status: 'running',
      active_lease_id: claimed.lease.id,
    });
    await expect(repository.getCodexSessionTurn('turn-1')).resolves.toMatchObject({ status: 'running' });
    await expect(repository.getCodexRuntimeCapsule('capsule-2')).resolves.toBeUndefined();
  });

  it('rejects capsules with non-internal artifact refs before saving them', async () => {
    const repository = new InMemoryDeliveryRepository();

    await expectDomainErrorCode(
      () =>
        repository.createCodexRuntimeCapsule({
          ...runtimeCapsuleInput,
          artifact_ref: 'artifact://capsule-unsafe',
        }),
      'workflow_invalid_transition',
    );
    await expect(repository.getCodexRuntimeCapsule('capsule-1')).resolves.toBeUndefined();
  });

  it.each([
    {
      label: 'wrong kind',
      artifact_ref: 'artifact://internal/execution_summary/codex_session/session-1/capsule-1',
    },
    {
      label: 'wrong owner_type',
      artifact_ref: 'artifact://internal/codex_runtime_capsule/run_session/session-1/capsule-1',
    },
    {
      label: 'wrong owner_id',
      artifact_ref: 'artifact://internal/codex_runtime_capsule/codex_session/session-other/capsule-1',
    },
    {
      label: 'wrong artifact_id',
      artifact_ref: 'artifact://internal/codex_runtime_capsule/codex_session/session-1/capsule-other',
    },
  ])('rejects capsules with $label in artifact refs before saving them', async ({ artifact_ref }) => {
    const repository = new InMemoryDeliveryRepository();

    await expectDomainErrorCode(
      () =>
        repository.createCodexRuntimeCapsule({
          ...runtimeCapsuleInput,
          artifact_ref,
        }),
      'workflow_invalid_transition',
    );
    await expect(repository.getCodexRuntimeCapsule('capsule-1')).resolves.toBeUndefined();
  });

  it('rejects creating a capsule for a missing Codex session before saving it', async () => {
    const repository = new InMemoryDeliveryRepository();

    await expectDomainErrorCode(
      () =>
        repository.createCodexRuntimeCapsule({
          ...runtimeCapsuleInput,
          codex_session_id: 'session-missing',
          artifact_ref: 'artifact://internal/codex_runtime_capsule/codex_session/session-missing/capsule-1',
        }),
      'workflow_invalid_transition',
    );
    await expect(repository.getCodexRuntimeCapsule('capsule-1')).resolves.toBeUndefined();
  });

  it('rejects creating a capsule when created_from_turn_id is missing or belongs to another session before saving it', async () => {
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

    const { created_from_turn_id: _createdFromTurnId, ...capsuleWithoutTurnProvenance } = runtimeCapsuleInput;
    await expectDomainErrorCode(
      () => repository.createCodexRuntimeCapsule(capsuleWithoutTurnProvenance),
      'codex_runtime_capsule_stale',
    );
    await expect(repository.getCodexRuntimeCapsule('capsule-1')).resolves.toBeUndefined();

    await expectDomainErrorCode(
      () =>
        repository.createCodexRuntimeCapsule({
          ...runtimeCapsuleInput,
          created_from_turn_id: 'turn-missing',
        }),
      'codex_runtime_capsule_stale',
    );
    await expect(repository.getCodexRuntimeCapsule('capsule-1')).resolves.toBeUndefined();

    await expectDomainErrorCode(
      () =>
        repository.createCodexRuntimeCapsule({
          ...runtimeCapsuleInput,
          id: 'capsule-2',
          artifact_ref: 'artifact://internal/codex_runtime_capsule/codex_session/session-1/capsule-2',
          digest: 'sha256:capsule-2',
          manifest_digest: 'sha256:manifest-2',
          created_from_turn_id: 'turn-other',
        }),
      'codex_runtime_capsule_stale',
    );
    await expect(repository.getCodexRuntimeCapsule('capsule-2')).resolves.toBeUndefined();
  });

  it('rejects capsules whose sequence is not greater than the current session maximum', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    await repository.createCodexSessionTurn(turnInput);
    await repository.createCodexRuntimeCapsule({
      ...runtimeCapsuleInput,
      id: 'capsule-2',
      sequence: 2,
      artifact_ref: 'artifact://internal/codex_runtime_capsule/codex_session/session-1/capsule-2',
      digest: 'sha256:capsule-2',
      manifest_digest: 'sha256:manifest-2',
    });

    await expectDomainErrorCode(
      () =>
        repository.createCodexRuntimeCapsule({
          ...runtimeCapsuleInput,
          id: 'capsule-1',
          sequence: 1,
          artifact_ref: 'artifact://internal/codex_runtime_capsule/codex_session/session-1/capsule-1',
          digest: 'sha256:capsule-1',
          manifest_digest: 'sha256:manifest-1',
        }),
      'workflow_invalid_transition',
    );

    await expect(repository.getCodexRuntimeCapsule('capsule-2')).resolves.toMatchObject({
      sequence: 2,
      digest: 'sha256:capsule-2',
    });
    await expect(repository.getCodexRuntimeCapsule('capsule-1')).resolves.toBeUndefined();
    const session = await repository.getCodexSession('session-1');
    expect(session?.latest_capsule_id).toBeUndefined();
    expect(session?.latest_capsule_digest).toBeUndefined();
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
          expected_input_capsule_digest: undefined,
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

  it('rejects stale terminalization without updating latest capsule fields or turn status', async () => {
    const repository = new InMemoryDeliveryRepository();
    await seedWorkflowWithCapsule(repository);
    await repository.createCodexSessionTurn({
      ...turnInput,
      expected_input_capsule_digest: 'sha256:capsule-1',
    });
    const claimed = await repository.claimCodexSessionLease({
      ...leaseInput,
      expected_input_capsule_digest: 'sha256:capsule-1',
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
          expected_input_capsule_digest: 'sha256:stale',
          output_capsule: {
            ...runtimeCapsuleInput,
            id: 'capsule-2',
            sequence: 2,
            artifact_ref: 'artifact://internal/codex_runtime_capsule/codex_session/session-1/capsule-2',
            digest: 'sha256:capsule-2',
            manifest_digest: 'sha256:manifest-2',
            created_at: '2026-05-31T00:03:00.000Z',
          },
          ...outputContinuationInput({ turnId: 'turn-1', suffix: 'stale' }),
          codex_thread_id: 'thread-1',
          codex_thread_id_digest: 'sha256:thread-1',
          now: '2026-05-31T00:03:00.000Z',
        }),
      'codex_session_stale_terminalization',
    );

    await expect(repository.getCodexSession('session-1')).resolves.toMatchObject({
      status: 'running',
      latest_capsule_id: 'capsule-1',
      latest_capsule_digest: 'sha256:capsule-1',
      active_lease_id: claimed.lease.id,
    });
    const session = await repository.getCodexSession('session-1');
    expect(session?.codex_thread_id).toBeUndefined();
    expect(session?.codex_thread_id_digest).toBeUndefined();
    await expect(repository.getCodexSessionTurn('turn-1')).resolves.toMatchObject({
      status: 'running',
      expected_input_capsule_digest: 'sha256:capsule-1',
    });
    const turn = await repository.getCodexSessionTurn('turn-1');
    expect(turn?.output_capsule_id).toBeUndefined();
    expect(turn?.output_capsule_digest).toBeUndefined();
    await expect(repository.getCodexRuntimeCapsule('capsule-2')).resolves.toBeUndefined();
  });

  it('forks from the requested persisted capsule instead of parent latest', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    await terminalizeTurnWithCapsule(repository, { turn_id: 'turn-1', capsule_id: 'capsule-1' });
    await terminalizeTurnWithCapsule(repository, {
      turn_id: 'turn-2',
      capsule_id: 'capsule-2',
      capsule_sequence: 2,
      previous_capsule_digest: 'sha256:capsule-1',
      claim_now: '2026-05-31T00:03:00.000Z',
      terminalize_now: '2026-05-31T00:04:00.000Z',
    });

    const fork = await repository.createCodexSessionFork({
      id: 'session-fork',
      workflow_id: 'workflow-1',
      parent_session_id: 'session-1',
      forked_from_capsule_id: 'capsule-1',
      fork_reason: 'Try the older checkpoint.',
      created_by_actor_id: 'actor-tech',
      now: '2026-05-31T00:05:00.000Z',
    });

    expect(fork).toMatchObject({
      id: 'session-fork',
      latest_capsule_id: 'capsule-1',
      latest_capsule_digest: 'sha256:capsule-1',
      forked_from_capsule_id: 'capsule-1',
    });
  });

  it('does not inherit parent Codex thread identity when forking from a historical capsule', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    await terminalizeTurnWithCapsule(repository, {
      turn_id: 'turn-1',
      capsule_id: 'capsule-1',
      codex_thread_id: 'thread-parent-current',
      codex_thread_id_digest: 'sha256:thread-parent-current',
    });

    const fork = await repository.createCodexSessionFork({
      id: 'session-fork',
      workflow_id: 'workflow-1',
      parent_session_id: 'session-1',
      forked_from_capsule_id: 'capsule-1',
      fork_reason: 'Try the older checkpoint without current thread baggage.',
      created_by_actor_id: 'actor-tech',
      now: '2026-05-31T00:04:00.000Z',
    });

    expect(fork).toMatchObject({
      id: 'session-fork',
      latest_capsule_id: 'capsule-1',
      latest_capsule_digest: 'sha256:capsule-1',
      forked_from_capsule_id: 'capsule-1',
    });
    expect(fork.codex_thread_id).toBeUndefined();
    expect(fork.codex_thread_id_digest).toBeUndefined();
  });

  it('forks from a turn output capsule instead of a newer parent latest capsule', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    await terminalizeTurnWithCapsule(repository, { turn_id: 'turn-1', capsule_id: 'capsule-1' });
    await terminalizeTurnWithCapsule(repository, {
      turn_id: 'turn-2',
      capsule_id: 'capsule-2',
      capsule_sequence: 2,
      previous_capsule_digest: 'sha256:capsule-1',
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
      latest_capsule_id: 'capsule-1',
      latest_capsule_digest: 'sha256:capsule-1',
      forked_from_turn_id: 'turn-1',
    });
    expect(fork.forked_from_capsule_id).toBeUndefined();
  });

  it('rejects turn-based fork when the turn output capsule is missing', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    await repository.createCodexSessionTurn(turnInput);

    await expectDomainErrorCode(
      () =>
        repository.saveCodexSessionTurn({
          ...turnInput,
          status: 'succeeded',
          output_capsule_id: 'capsule-missing',
          output_capsule_digest: 'sha256:capsule-missing',
          updated_at: '2026-05-31T00:02:00.000Z',
        }),
      'workflow_invalid_transition',
    );
  });

  it('rejects turn-based fork when the turn output capsule belongs to another session', async () => {
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
    await repository.createCodexRuntimeCapsule({
      ...runtimeCapsuleInput,
      id: 'capsule-other',
      codex_session_id: 'session-other',
      artifact_ref: 'artifact://internal/codex_runtime_capsule/codex_session/session-other/capsule-other',
      digest: 'sha256:capsule-other',
      created_from_turn_id: 'turn-other',
    });

    await expectDomainErrorCode(
      () =>
        repository.saveCodexSessionTurn({
          ...turnInput,
          status: 'succeeded',
          output_capsule_id: 'capsule-other',
          output_capsule_digest: 'sha256:capsule-other',
          updated_at: '2026-05-31T00:02:00.000Z',
        }),
      'workflow_invalid_transition',
    );
  });

  it('rejects turn-based fork when the turn output capsule digest differs from persisted capsule', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    await terminalizeTurnWithCapsule(repository, { turn_id: 'turn-1', capsule_id: 'capsule-1' });

    const terminalizedTurn = await repository.getCodexSessionTurn('turn-1');
    if (terminalizedTurn === undefined) throw new Error('Expected terminalized turn');
    await expectDomainErrorCode(
      () =>
        repository.saveCodexSessionTurn({
          ...terminalizedTurn,
          output_capsule_digest: 'sha256:stale-capsule-1',
        }),
      'workflow_invalid_transition',
    );
  });

  it('rejects turn-based fork when the persisted output capsule came from a different turn', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    await repository.createCodexSessionTurn(turnInput);

    await expectDomainErrorCode(
      () =>
        repository.createCodexRuntimeCapsule({
          ...runtimeCapsuleInput,
          created_from_turn_id: 'turn-other',
        }),
      'codex_runtime_capsule_stale',
    );
  });

  it('does not inherit parent latest capsule when forking from a turn without output capsule', async () => {
    const repository = new InMemoryDeliveryRepository();
    await seedWorkflowWithCapsule(repository);
    await repository.createCodexSessionTurn({
      ...turnInput,
      expected_input_capsule_digest: 'sha256:capsule-1',
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
    expect(fork.latest_capsule_id).toBeUndefined();
    expect(fork.latest_capsule_digest).toBeUndefined();
    expect(fork.forked_from_capsule_id).toBeUndefined();
  });

  it('rejects fork creation when requested turn and capsule fork points do not match', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    await terminalizeTurnWithCapsule(repository, { turn_id: 'turn-1', capsule_id: 'capsule-1' });
    await terminalizeTurnWithCapsule(repository, {
      turn_id: 'turn-2',
      capsule_id: 'capsule-2',
      capsule_sequence: 2,
      previous_capsule_digest: 'sha256:capsule-1',
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
          forked_from_capsule_id: 'capsule-2',
          fork_reason: 'Try mismatched provenance.',
          created_by_actor_id: 'actor-tech',
          now: '2026-05-31T00:05:00.000Z',
        }),
      'codex_session_fork_invalid',
    );
  });

  it('rejects fork creation without an explicit turn or capsule fork point', async () => {
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

  it('forks from a requested parent-session turn without requiring a capsule', async () => {
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
    expect(fork.forked_from_capsule_id).toBeUndefined();
  });

  it('rejects saving a fork when immutable provenance fields change', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    await terminalizeTurnWithCapsule(repository, { turn_id: 'turn-1', capsule_id: 'capsule-1' });
    const fork = await repository.createCodexSessionFork({
      id: 'session-fork',
      workflow_id: 'workflow-1',
      parent_session_id: 'session-1',
      forked_from_turn_id: 'turn-1',
      forked_from_capsule_id: 'capsule-1',
      fork_reason: 'Try another approach.',
      created_by_actor_id: 'actor-tech',
      now: '2026-05-31T00:04:00.000Z',
    });

    const provenanceDrifts = [
      { forked_from_session_id: 'session-drifted' },
      { forked_from_turn_id: 'turn-drifted' },
      { forked_from_capsule_id: 'capsule-drifted' },
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
      forked_from_capsule_id: 'capsule-1',
      fork_reason: 'Try another approach.',
      updated_at: '2026-05-31T00:05:00.000Z',
    });
  });

  it('rejects fork creation when requested capsule is missing or belongs to another session', async () => {
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
    await repository.createCodexRuntimeCapsule({
      ...runtimeCapsuleInput,
      id: 'capsule-other',
      codex_session_id: 'session-other',
      artifact_ref: 'artifact://internal/codex_runtime_capsule/codex_session/session-other/capsule-other',
      digest: 'sha256:capsule-other',
      created_from_turn_id: 'turn-other',
    });

    await expectDomainErrorCode(
      () =>
        repository.createCodexSessionFork({
          id: 'session-fork-missing',
          workflow_id: 'workflow-1',
          parent_session_id: 'session-1',
          forked_from_capsule_id: 'capsule-missing',
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
          forked_from_capsule_id: 'capsule-other',
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

  it('invalidates workflow readiness records and rejects invalidated execution readiness evidence', async () => {
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

    await expect(repository.invalidateExecutionReadinessRecordsForWorkflow({
      workflow_id: 'workflow-1',
      reason: 'artifact_change_requested',
      now: later,
    })).resolves.toBe(1);
    await expect(repository.invalidateExecutionReadinessRecordsForWorkflow({
      workflow_id: 'workflow-1',
      reason: 'artifact_change_requested',
      now: later,
    })).resolves.toBe(0);
    await expect(repository.getExecutionReadinessRecord('readiness-1')).resolves.toMatchObject({
      invalidated_at: later,
      invalidated_reason: 'artifact_change_requested',
    });

    await expectDomainErrorCode(
      () =>
        applyWorkflowTransition(repository, {
          ...transitionInput,
          id: 'transition-invalidated-readiness',
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
  });

  it('rejects old inactive fork evidence after selecting a new active fork', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession({
      ...baseWorkflowInput,
      actor_id: 'actor-product',
    });
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
      manual_decision_id: 'decision-fork-select',
      transition_id: 'transition-fork-select',
      actor_id: 'actor-tech',
      reason: 'Use the alternate path.',
      now: '2026-05-31T00:03:00.000Z',
    });
    await repository.saveWorkflowManualDecision({
      ...manualDecisionInput,
      id: 'decision-old-session-start',
      codex_session_id: 'session-1',
      created_by_actor_id: 'actor-product',
    });
    await repository.saveBoundarySummaryRevision(boundarySummaryRevisionInput);
    const workflowBeforeManual = await repository.getPlanItemWorkflow('workflow-1');

    await expectDomainErrorCode(
      () =>
        applyWorkflowTransition(repository, {
          ...transitionInput,
          id: 'transition-old-session-manual-start',
          actor_id: 'actor-product',
          evidence_object_id: 'decision-old-session-start',
          codex_session_turn_id: undefined,
        }),
      'workflow_invalid_transition',
    );
    await expect(repository.getPlanItemWorkflow('workflow-1')).resolves.toEqual(workflowBeforeManual);
    await expect(repository.listPlanItemWorkflowTransitions('workflow-1')).resolves.toHaveLength(1);

    await repository.saveWorkflowManualDecision({
      ...manualDecisionInput,
      id: 'decision-new-session-start',
      codex_session_id: 'session-fork',
      created_by_actor_id: 'actor-product',
    });
    await applyWorkflowTransition(repository, {
      ...transitionInput,
      id: 'transition-new-session-start',
      actor_id: 'actor-product',
      evidence_object_id: 'decision-new-session-start',
      codex_session_id: 'session-fork',
      codex_session_turn_id: undefined,
    });
    const workflowBeforeDocument = await repository.getPlanItemWorkflow('workflow-1');

    await expectDomainErrorCode(
      () =>
        applyWorkflowProjectionTransition(repository, {
          transition_id: 'transition-old-session-boundary',
          from_status: 'brainstorming',
          to_status: 'boundary_review',
          evidence_object_type: 'boundary_summary_revision',
          evidence_object_id: 'boundary-summary-revision-1',
          codex_session_id: 'session-1',
        }),
      'workflow_invalid_transition',
    );
    await expect(repository.getPlanItemWorkflow('workflow-1')).resolves.toEqual(workflowBeforeDocument);
    await expect(repository.listPlanItemWorkflowTransitions('workflow-1')).resolves.toHaveLength(2);
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

  it('rejects active-session workflow transitions supported by candidate fork-owned internal artifacts', async () => {
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
    await repository.saveWorkflowManualDecision(manualDecisionInput);
    await repository.createOrReplayInternalArtifactObject({
      ...internalArtifactObjectInput,
      id: 'internal-artifact-fork',
      artifact_id: 'artifact-fork',
      ref: 'artifact://internal/generated_payload/codex_session/session-fork/artifact-fork',
      owner_id: 'session-fork',
    });
    const workflowBefore = await repository.getPlanItemWorkflow('workflow-1');

    await expectDomainErrorCode(
      () =>
        applyWorkflowTransition(repository, {
          ...transitionInput,
          id: 'transition-fork-artifact-support',
          codex_session_turn_id: undefined,
          supporting_evidence: [{ object_type: 'internal_artifact', object_id: 'internal-artifact-fork' }],
        }),
      'workflow_invalid_transition',
    );
    await expect(repository.getPlanItemWorkflow('workflow-1')).resolves.toEqual(workflowBefore);
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
      await transaction.createCodexRuntimeCapsule(runtimeCapsuleInput);
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
    await expect(repository.getCodexRuntimeCapsule('capsule-1')).resolves.toMatchObject({ digest: 'sha256:capsule-1' });
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
    await expect(repository.listStaleCodexSessionTerminalizationAttempts('session-1')).resolves.toHaveLength(0);
  });

  it('stores stale terminalization attempts with the attempted lease epoch', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    await repository.createCodexSessionTurn(turnInput);
    await repository.claimCodexSessionLease(leaseInput);

    await repository.saveStaleCodexSessionTerminalizationAttempt({
      id: 'stale-lease-epoch-mismatch',
      codex_session_id: 'session-1',
      codex_session_turn_id: 'turn-1',
      lease_id: 'lease-1',
      lease_epoch: 2,
      worker_id: 'worker-1',
      worker_session_digest: 'sha256:worker-session',
      attempted_output_capsule_digest: 'sha256:attempted-output',
      failure_code: 'codex_session_stale_terminalization',
      created_at: now,
    });

    await expect(repository.listStaleCodexSessionTerminalizationAttempts('session-1')).resolves.toEqual([
      expect.objectContaining({
        id: 'stale-lease-epoch-mismatch',
        lease_id: 'lease-1',
        lease_epoch: 2,
        attempted_output_capsule_digest: 'sha256:attempted-output',
      }),
    ]);
  });

  it('does not downgrade a terminalized turn when stale marking races behind success', async () => {
    const repository = new InMemoryDeliveryRepository();
    await repository.createPlanItemWorkflowWithInitialSession(baseWorkflowInput);
    await repository.createCodexSessionTurn(turnInput);
    const claimed = await repository.claimCodexSessionLease(leaseInput);
    await repository.terminalizeCodexSessionTurn({
      session_id: 'session-1',
      turn_id: 'turn-1',
      lease_id: claimed.lease.id,
      lease_token_hash: claimed.lease.lease_token_hash,
      lease_epoch: claimed.lease.lease_epoch,
      worker_id: claimed.lease.worker_id,
      worker_session_digest: claimed.lease.worker_session_digest,
      status: 'succeeded',
      expected_input_capsule_digest: undefined,
      output_capsule: { ...runtimeCapsuleInput },
      ...outputContinuationInput({ turnId: 'turn-1' }),
      codex_thread_id: 'thread-1',
      codex_thread_id_digest: 'sha256:thread-1',
      now: '2026-05-31T00:02:00.000Z',
    });

    await repository.markCodexSessionTurnStale({
      session_id: 'session-1',
      turn_id: 'turn-1',
      now: '2026-05-31T00:03:00.000Z',
    });

    await expect(repository.getCodexSessionTurn('turn-1')).resolves.toMatchObject({
      status: 'succeeded',
      lease_id: claimed.lease.id,
      lease_epoch: claimed.lease.lease_epoch,
      codex_thread_id_digest: 'sha256:thread-1',
    });
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

describe('Plan Item Workflow Drizzle repository critical paths', () => {
  describe('queued action persistence contract', () => {
    workflowQueuedActionRepositoryContract(
      async () => {
        const repository = await createDrizzleWorkflowRepository();
        await repository.createPlanItemWorkflowWithInitialSession(drizzleWorkflowInput);
        return {
          repository,
          fixture: {
            workflowId: uuidFixture.workflowId,
            sessionId: uuidFixture.sessionId,
            actorId: uuidFixture.actorTechId,
            boundaryRevisionId: uuidFixture.boundarySummaryRevisionId,
            specRevisionId: uuidFixture.specRevisionId,
            implementationPlanRevisionId: uuidFixture.executionPlanRevisionId,
          },
        };
      },
      drizzleTest,
    );
  });

  drizzleTest('rejects two active execution runs for one CodexSession', async () => {
    const repository = await createDrizzleWorkflowRepository();
    await repository.createPlanItemWorkflowWithInitialSession(drizzleWorkflowInput);
    await repository.createCodexSessionTurn(drizzleTurnInput);
    const packageOne = executionPackage({
      id: '10000000-0000-4000-8000-000000000101',
      work_item_id: uuidFixture.developmentPlanItemId,
      development_plan_item_id: uuidFixture.developmentPlanItemId,
      workflow_id: uuidFixture.workflowId,
      codex_session_id: uuidFixture.sessionId,
      codex_session_turn_id: uuidFixture.turnId,
      spec_id: uuidFixture.specId,
      spec_revision_id: uuidFixture.specRevisionId,
      plan_id: uuidFixture.developmentPlanId,
      plan_revision_id: uuidFixture.executionPlanRevisionId,
      project_id: uuidFixture.projectId,
      owner_actor_id: uuidFixture.actorTechId,
      reviewer_actor_id: uuidFixture.actorProductId,
      qa_owner_actor_id: uuidFixture.actorProductId,
    });
    const packageTwo = { ...packageOne, id: '10000000-0000-4000-8000-000000000102' };
    await repository.saveExecutionPackage(packageOne);
    await repository.saveExecutionPackage(packageTwo);

    await repository.saveRunSession(
      runSession({
        id: '10000000-0000-4000-8000-000000000103',
        execution_package_id: packageOne.id,
        workflow_id: uuidFixture.workflowId,
        codex_session_id: uuidFixture.sessionId,
        codex_session_turn_id: uuidFixture.turnId,
        requested_by_actor_id: uuidFixture.actorTechId,
      }),
    );

    await expect(
      repository.saveRunSession(
        runSession({
          id: '10000000-0000-4000-8000-000000000104',
          execution_package_id: packageTwo.id,
          workflow_id: uuidFixture.workflowId,
          codex_session_id: uuidFixture.sessionId,
          codex_session_turn_id: uuidFixture.turnId,
          requested_by_actor_id: uuidFixture.actorTechId,
        }),
      ),
    ).rejects.toMatchObject<Partial<DomainError>>({
      name: 'DomainError',
      code: 'workflow_execution_already_running',
    });
  });

  drizzleTest('persists, renews, and clears session-bound runner ownership', async () => {
    const repository = await createDrizzleWorkflowRepository();
    await repository.createPlanItemWorkflowWithInitialSession(drizzleWorkflowInput);

    await expect(
      repository.markCodexSessionRunnerOwner({
        session_id: uuidFixture.sessionId,
        runner_worker_id: '10000000-0000-4000-8000-000000000030',
        runner_launch_lease_id: '10000000-0000-4000-8000-000000000031',
        runner_runtime_job_id: '10000000-0000-4000-8000-000000000032',
        runner_expires_at: '2026-05-31T00:20:00.000Z',
        now,
      }),
    ).resolves.toMatchObject({
      runner_worker_id: '10000000-0000-4000-8000-000000000030',
      runner_launch_lease_id: '10000000-0000-4000-8000-000000000031',
      runner_runtime_job_id: '10000000-0000-4000-8000-000000000032',
      runner_expires_at: '2026-05-31T00:20:00.000Z',
    });

    await expectDomainErrorCode(
      () =>
        repository.markCodexSessionRunnerOwner({
          session_id: uuidFixture.sessionId,
          runner_worker_id: '10000000-0000-4000-8000-000000000033',
          runner_launch_lease_id: '10000000-0000-4000-8000-000000000034',
          runner_runtime_job_id: '10000000-0000-4000-8000-000000000035',
          runner_expires_at: '2026-05-31T00:30:00.000Z',
          now: '2026-05-31T00:10:00.000Z',
        }),
      'codex_session_runner_unavailable',
    );

    await expect(
      repository.renewCodexSessionRunnerOwner({
        session_id: uuidFixture.sessionId,
        runner_worker_id: '10000000-0000-4000-8000-000000000030',
        runner_launch_lease_id: '10000000-0000-4000-8000-000000000031',
        runner_runtime_job_id: '10000000-0000-4000-8000-000000000032',
        runner_expires_at: '2026-05-31T00:40:00.000Z',
        now: '2026-05-31T00:10:00.000Z',
      }),
    ).resolves.toMatchObject({
      runner_expires_at: '2026-05-31T00:40:00.000Z',
    });

    await expect(
      repository.clearCodexSessionRunnerOwner({
        session_id: uuidFixture.sessionId,
        runner_launch_lease_id: '10000000-0000-4000-8000-000000000031',
        terminal_reason_code: 'succeeded',
        now: '2026-05-31T00:11:00.000Z',
      }),
    ).resolves.toMatchObject({
      runner_worker_id: undefined,
      runner_launch_lease_id: undefined,
      runner_runtime_job_id: undefined,
      runner_expires_at: undefined,
    });
  });

  drizzleTest('serializes lease renewal on the Codex session object lock', async () => {
    if (drizzleDatabaseUrl === undefined) {
      throw new Error('Expected FORGELOOP_TEST_DATABASE_URL or FORGELOOP_DATABASE_URL');
    }
    const repository = await createDrizzleWorkflowRepository();
    await repository.createPlanItemWorkflowWithInitialSession(drizzleWorkflowInput);
    await repository.claimCodexSessionLease({
      ...drizzleLeaseInput,
      expires_at: '2026-05-31T00:05:00.000Z',
    });
    const lockClient = createDbClient({ connectionString: drizzleDatabaseUrl });
    activePools.push(lockClient.pool);
    const connection = await lockClient.pool.connect();
    try {
      await connection.query('begin');
      await connection.query('select pg_advisory_xact_lock(hashtext($1::text))', [`codex-session:${uuidFixture.sessionId}`]);
      let renewed = false;
      const renewPromise = repository
        .renewCodexSessionLease({
          session_id: uuidFixture.sessionId,
          lease_id: uuidFixture.leaseId,
          lease_token_hash: 'sha256:drizzle-lease-token',
          worker_id: 'worker-drizzle',
          worker_session_digest: 'sha256:worker-session-drizzle',
          lease_epoch: 1,
          now: '2026-05-31T00:01:00.000Z',
          expires_at: '2026-05-31T00:06:00.000Z',
        })
        .then((lease) => {
          renewed = true;
          return lease;
        });
      await new Promise((resolve) => setTimeout(resolve, 75));
      expect(renewed).toBe(false);
      await connection.query('commit');
      await expect(renewPromise).resolves.toMatchObject({
        id: uuidFixture.leaseId,
        status: 'active',
        heartbeat_at: '2026-05-31T00:01:00.000Z',
      });
    } finally {
      await connection.query('rollback').catch(() => undefined);
      connection.release();
    }
  });

  drizzleTest('persists workflow/session transitions and enforces lease fencing', async () => {
    const repository = await createDrizzleWorkflowRepository();

    const created = await repository.createPlanItemWorkflowWithInitialSession(drizzleWorkflowInput);

    expect(created.workflow).toMatchObject({
      id: uuidFixture.workflowId,
      status: 'not_started',
      active_codex_session_id: uuidFixture.sessionId,
    });
    expect(created.session).toMatchObject({
      id: uuidFixture.sessionId,
      status: 'idle',
      role: 'active',
      owner_id: uuidFixture.workflowId,
      lease_epoch: 0,
    });
    await expect(repository.getActivePlanItemWorkflowByItem(uuidFixture.developmentPlanItemId)).resolves.toMatchObject({
      id: uuidFixture.workflowId,
    });

    await expectDomainErrorCode(
      () =>
        repository.savePlanItemWorkflow({
          ...created.workflow,
          status: 'brainstorming',
          updated_at: '2026-05-31T00:01:00.000Z',
        }),
      'workflow_invalid_transition',
    );

    await repository.saveWorkflowManualDecision({
      id: uuidFixture.decisionId,
      workflow_id: uuidFixture.workflowId,
      codex_session_id: uuidFixture.sessionId,
      kind: 'start_brainstorming',
      reason: 'Start.',
      created_by_actor_id: uuidFixture.actorTechId,
      created_at: now,
    });
    const transitioned = await repository.applyPlanItemWorkflowTransition({
      transition: {
        id: uuidFixture.transitionId,
        workflow_id: uuidFixture.workflowId,
        from_status: 'not_started',
        to_status: 'brainstorming',
        actor_id: uuidFixture.actorTechId,
        reason: 'Start brainstorming.',
        evidence_object_type: 'manual_decision',
        evidence_object_id: uuidFixture.decisionId,
        codex_session_id: uuidFixture.sessionId,
        created_at: '2026-05-31T00:01:00.000Z',
      },
    });
    expect(transitioned).toMatchObject({
      id: uuidFixture.workflowId,
      status: 'brainstorming',
      updated_at: '2026-05-31T00:01:00.000Z',
    });
    await expect(repository.listPlanItemWorkflowTransitions(uuidFixture.workflowId)).resolves.toHaveLength(1);

    await repository.createCodexSessionTurn(drizzleTurnInput);
    const claimed = await repository.claimCodexSessionLease(drizzleLeaseInput);
    expect(claimed.lease).toMatchObject({ status: 'active', lease_epoch: 1 });
    await expectDomainErrorCode(
      () =>
        repository.claimCodexSessionLease({
          ...drizzleLeaseInput,
          lease_id: '10000000-0000-4000-8000-000000000030',
          lease_token_hash: 'sha256:drizzle-other-lease-token',
          worker_id: 'worker-drizzle-other',
          worker_session_digest: 'sha256:worker-session-drizzle-other',
        }),
      'codex_session_lease_conflict',
    );

    const terminalized = await repository.terminalizeCodexSessionTurn({
      session_id: uuidFixture.sessionId,
      turn_id: uuidFixture.turnId,
      lease_id: uuidFixture.leaseId,
      lease_token_hash: 'sha256:drizzle-lease-token',
      lease_epoch: 1,
      worker_id: 'worker-drizzle',
      worker_session_digest: 'sha256:worker-session-drizzle',
      status: 'succeeded',
      expected_input_capsule_digest: undefined,
      output_capsule: drizzleRuntimeCapsuleInput,
      ...outputContinuationInput({ sessionId: uuidFixture.sessionId, turnId: uuidFixture.turnId }),
      codex_thread_id: 'thread-drizzle',
      codex_thread_id_digest: 'sha256:thread-drizzle',
      now: '2026-05-31T00:02:00.000Z',
    });
    expect(terminalized.session).toMatchObject({
      status: 'idle',
      latest_capsule_id: uuidFixture.capsuleId,
      latest_capsule_digest: 'sha256:drizzle-capsule-1',
      codex_thread_id_digest: 'sha256:thread-drizzle',
    });
    expect(terminalized.session).not.toHaveProperty('active_lease_id');
    await expect(repository.getCodexRuntimeCapsule(uuidFixture.capsuleId)).resolves.toMatchObject({
      id: uuidFixture.capsuleId,
      sequence: 1,
      created_from_turn_id: uuidFixture.turnId,
    });

    await expectDomainErrorCode(
      () =>
        repository.terminalizeCodexSessionTurn({
          session_id: uuidFixture.sessionId,
          turn_id: uuidFixture.turnId,
          lease_id: uuidFixture.leaseId,
          lease_token_hash: 'sha256:drizzle-lease-token',
          lease_epoch: 1,
          worker_id: 'worker-drizzle',
          worker_session_digest: 'sha256:worker-session-drizzle',
          status: 'succeeded',
          expected_input_capsule_digest: undefined,
          now: '2026-05-31T00:03:00.000Z',
        }),
      'codex_session_stale_terminalization',
    );
    await repository.saveStaleCodexSessionTerminalizationAttempt({
      id: uuidFixture.staleAttemptId,
      codex_session_id: uuidFixture.sessionId,
      codex_session_turn_id: uuidFixture.turnId,
      lease_id: uuidFixture.leaseId,
      lease_epoch: 1,
      worker_id: 'worker-drizzle',
      worker_session_digest: 'sha256:worker-session-drizzle',
      attempted_output_capsule_digest: 'sha256:ignored',
      failure_code: 'codex_session_stale_terminalization',
      created_at: '2026-05-31T00:03:00.000Z',
    });
    await expect(repository.listStaleCodexSessionTerminalizationAttempts(uuidFixture.sessionId)).resolves.toHaveLength(1);
  });

  drizzleTest('recovers an expired active lease before creating the next turn', async () => {
    const repository = await createDrizzleWorkflowRepository();
    await seedDrizzleWorkflow(repository);
    await repository.claimCodexSessionLease({
      ...drizzleLeaseInput,
      expires_at: '2026-05-31T00:01:00.000Z',
    });

    await repository.createCodexSessionTurn({
      ...drizzleTurnInput,
      id: '10000000-0000-4000-8000-000000000031',
      input_digest: 'sha256:drizzle-turn-input-2',
      created_at: '2026-05-31T00:02:00.000Z',
      updated_at: '2026-05-31T00:02:00.000Z',
    });

    await expectDomainErrorCode(
      () =>
        repository.renewCodexSessionLease({
          session_id: uuidFixture.sessionId,
          lease_id: uuidFixture.leaseId,
          lease_token_hash: 'sha256:drizzle-lease-token',
          worker_id: 'worker-drizzle',
          worker_session_digest: 'sha256:worker-session-drizzle',
          lease_epoch: 1,
          now: '2026-05-31T00:02:30.000Z',
          expires_at: '2026-05-31T00:08:00.000Z',
        }),
      'codex_session_lease_conflict',
    );
    await expect(repository.getCodexSession(uuidFixture.sessionId)).resolves.toMatchObject({
      status: 'recovering',
      latest_turn_id: '10000000-0000-4000-8000-000000000031',
      latest_turn_digest: 'sha256:drizzle-turn-input-2',
      lease_epoch: 1,
    });
  });

  drizzleTest('persists stale terminalization attempts with attempted lease epoch', async () => {
    const repository = await createDrizzleWorkflowRepository();
    await seedDrizzleWorkflow(repository);
    await repository.claimCodexSessionLease(drizzleLeaseInput);

    await repository.saveStaleCodexSessionTerminalizationAttempt({
      id: uuidFixture.staleAttemptId,
      codex_session_id: uuidFixture.sessionId,
      codex_session_turn_id: uuidFixture.turnId,
      lease_id: uuidFixture.leaseId,
      lease_epoch: 2,
      worker_id: 'worker-drizzle',
      worker_session_digest: 'sha256:worker-session-drizzle',
      attempted_output_capsule_digest: 'sha256:attempted-drizzle-output',
      failure_code: 'codex_session_stale_terminalization',
      created_at: '2026-05-31T00:03:00.000Z',
    });

    await expect(repository.listStaleCodexSessionTerminalizationAttempts(uuidFixture.sessionId)).resolves.toEqual([
      expect.objectContaining({
        id: uuidFixture.staleAttemptId,
        lease_id: uuidFixture.leaseId,
        lease_epoch: 2,
        attempted_output_capsule_digest: 'sha256:attempted-drizzle-output',
      }),
    ]);
  });

  drizzleTest('rejects failed terminalization with output continuation before mutation', async () => {
    const repository = await createDrizzleWorkflowRepository();
    await seedDrizzleWorkflow(repository);
    const claimed = await repository.claimCodexSessionLease(drizzleLeaseInput);

    await expectDomainErrorCode(
      () =>
        repository.terminalizeCodexSessionTurn({
          session_id: uuidFixture.sessionId,
          turn_id: uuidFixture.turnId,
          lease_id: claimed.lease.id,
          lease_token_hash: claimed.lease.lease_token_hash,
          lease_epoch: claimed.lease.lease_epoch,
          worker_id: 'worker-drizzle',
          worker_session_digest: 'sha256:worker-session-drizzle',
          status: 'failed',
          expected_input_capsule_digest: undefined,
          output_capsule: drizzleRuntimeCapsuleInput,
          ...outputContinuationInput({ sessionId: uuidFixture.sessionId, turnId: uuidFixture.turnId }),
          failure_code: 'codex_runtime_capsule_missing',
          now: '2026-05-31T00:02:00.000Z',
        }),
      'codex_runtime_capsule_stale',
    );

    const session = await repository.getCodexSession(uuidFixture.sessionId);
    expect(session).toMatchObject({
      status: 'running',
      active_lease_id: claimed.lease.id,
    });
    expect(session?.latest_capsule_id).toBeUndefined();
    expect(session?.latest_capsule_digest).toBeUndefined();
    expect(session?.latest_memory_bundle_ref).toBeUndefined();
    expect(session?.latest_memory_bundle_digest).toBeUndefined();
    expect(session?.latest_environment_manifest_ref).toBeUndefined();
    expect(session?.latest_environment_manifest_digest).toBeUndefined();
    const turn = await repository.getCodexSessionTurn(uuidFixture.turnId);
    expect(turn).toMatchObject({ status: 'running' });
    expect(turn?.output_capsule_id).toBeUndefined();
    expect(turn?.output_capsule_digest).toBeUndefined();
    expect(turn?.output_memory_bundle_ref).toBeUndefined();
    expect(turn?.output_memory_bundle_digest).toBeUndefined();
    expect(turn?.output_environment_manifest_ref).toBeUndefined();
    expect(turn?.output_environment_manifest_digest).toBeUndefined();
    await expect(repository.getCodexRuntimeCapsule(uuidFixture.capsuleId)).resolves.toBeUndefined();
  });

  drizzleTest('preserves a terminalized turn when stale marking races behind success', async () => {
    const repository = await createDrizzleWorkflowRepository();
    await seedDrizzleWorkflow(repository);
    const claimed = await repository.claimCodexSessionLease(drizzleLeaseInput);
    await repository.terminalizeCodexSessionTurn({
      session_id: uuidFixture.sessionId,
      turn_id: uuidFixture.turnId,
      lease_id: claimed.lease.id,
      lease_token_hash: claimed.lease.lease_token_hash,
      lease_epoch: claimed.lease.lease_epoch,
      worker_id: 'worker-drizzle',
      worker_session_digest: 'sha256:worker-session-drizzle',
      status: 'succeeded',
      expected_input_capsule_digest: undefined,
      codex_thread_id: 'thread-drizzle',
      codex_thread_id_digest: 'sha256:thread-drizzle',
      now: '2026-05-31T00:02:00.000Z',
    });

    await repository.markCodexSessionTurnStale({
      session_id: uuidFixture.sessionId,
      turn_id: uuidFixture.turnId,
      now: '2026-05-31T00:03:00.000Z',
    });

    await expect(repository.getCodexSessionTurn(uuidFixture.turnId)).resolves.toMatchObject({
      status: 'succeeded',
      lease_id: claimed.lease.id,
      lease_epoch: claimed.lease.lease_epoch,
      codex_thread_id_digest: 'sha256:thread-drizzle',
    });
  });

  drizzleTest('rejects persisted Plan Item Workflow plan/item mismatch', async () => {
    const repository = await createDrizzleWorkflowRepository();

    await expectDomainErrorCode(
      () =>
        repository.createPlanItemWorkflowWithInitialSession({
          ...drizzleWorkflowInput,
          development_plan_id: '20000000-0000-4000-8000-000000000005',
        }),
      'workflow_invalid_transition',
    );
    await expect(repository.getPlanItemWorkflow(uuidFixture.workflowId)).resolves.toBeUndefined();
    await expect(repository.getCodexSession(uuidFixture.sessionId)).resolves.toBeUndefined();
  });

  drizzleTest('persists explicit fork selection with manual decision and transition ledger', async () => {
    const repository = await createDrizzleWorkflowRepository();
    await seedDrizzleWorkflow(repository);

    const claimed = await repository.claimCodexSessionLease(drizzleLeaseInput);
    await repository.terminalizeCodexSessionTurn({
      session_id: uuidFixture.sessionId,
      turn_id: uuidFixture.turnId,
      lease_id: claimed.lease.id,
      lease_token_hash: claimed.lease.lease_token_hash,
      lease_epoch: claimed.lease.lease_epoch,
      worker_id: 'worker-drizzle',
      worker_session_digest: 'sha256:worker-session-drizzle',
      status: 'succeeded',
      expected_input_capsule_digest: undefined,
      output_capsule: drizzleRuntimeCapsuleInput,
      ...outputContinuationInput({ sessionId: uuidFixture.sessionId, turnId: uuidFixture.turnId }),
      now: '2026-05-31T00:02:00.000Z',
    });

    const fork = await repository.createCodexSessionFork({
      id: uuidFixture.forkSessionId,
      workflow_id: uuidFixture.workflowId,
      parent_session_id: uuidFixture.sessionId,
      forked_from_turn_id: uuidFixture.turnId,
      fork_reason: 'Try another approach.',
      created_by_actor_id: uuidFixture.actorTechId,
      now: '2026-05-31T00:03:00.000Z',
    });
    expect(fork).toMatchObject({
      id: uuidFixture.forkSessionId,
      role: 'candidate_fork',
      latest_capsule_id: uuidFixture.capsuleId,
      latest_capsule_digest: 'sha256:drizzle-capsule-1',
    });
    await expectDomainErrorCode(
      () =>
        repository.claimCodexSessionLease({
          ...drizzleLeaseInput,
          session_id: uuidFixture.forkSessionId,
          lease_id: '10000000-0000-4000-8000-000000000031',
        }),
      'codex_session_lease_conflict',
    );

    const selected = await repository.selectActiveCodexSessionFork({
      workflow_id: uuidFixture.workflowId,
      selected_codex_session_id: uuidFixture.forkSessionId,
      manual_decision_id: uuidFixture.forkDecisionId,
      transition_id: uuidFixture.forkTransitionId,
      actor_id: uuidFixture.actorTechId,
      reason: 'Use the alternate path.',
      now: '2026-05-31T00:04:00.000Z',
    });
    expect(selected.workflow).toMatchObject({
      id: uuidFixture.workflowId,
      active_codex_session_id: uuidFixture.forkSessionId,
    });
    expect(selected.selectedSession).toMatchObject({ id: uuidFixture.forkSessionId, role: 'active' });
    await expect(repository.getCodexSession(uuidFixture.sessionId)).resolves.toMatchObject({ role: 'inactive_fork' });
    await expect(repository.getWorkflowManualDecision(uuidFixture.forkDecisionId)).resolves.toMatchObject({
      kind: 'fork_select',
      selected_codex_session_id: uuidFixture.forkSessionId,
    });
    await expect(repository.listPlanItemWorkflowTransitions(uuidFixture.workflowId)).resolves.toHaveLength(1);
  });
});
