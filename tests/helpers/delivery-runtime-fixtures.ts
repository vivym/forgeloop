import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { ArtifactRef, CheckResult, ExecutorResult, RunSpec, SelfReviewResult } from '@forgeloop/contracts';
import type {
  Artifact,
  CodexRuntimeProfileRevision,
  ExecutionPackage,
  Plan,
  PlanRevision,
  Project,
  ProjectRepo,
  ReviewPacket,
  RunCommand,
  RunSession,
  Spec,
  SpecRevision,
  WorkItem,
} from '../../packages/domain/src/index';
import {
  codexCanonicalDigest,
  codexCredentialPayloadDigest,
  codexRuntimeNetworkPolicyDigest,
  codexRuntimeProfileRevisionDigest,
  transitionExecutionPackage,
  transitionRunSession,
} from '../../packages/domain/src/index';
import { buildPackageRuntimePolicySnapshot, runtimePolicyFromDocument } from '../../packages/executor/src/index';

import { AppModule } from '../../apps/control-plane-api/src/app.module';
import {
  DELIVERY_REPOSITORY,
  RUN_DURABILITY_MODE,
} from '../../apps/control-plane-api/src/modules/core/control-plane-tokens';
import { DELIVERY_RUN_WORKER } from '../../apps/control-plane-api/src/modules/run-control/run-worker.token';
import { seedItemScopedSpecPlan } from './item-scoped-artifact-fixtures';
import { InMemoryDeliveryRepository, type DeliveryRepository } from '../../packages/db/src';
import { createWorkflowPolicyRepoRoot } from './runtime-policy-repo';

const now = '2026-05-05T00:00:00.000Z';
const later = '2026-05-05T00:01:00.000Z';
const runtimeNow = '2026-05-20T00:00:00.000Z';
const expiresAt = '2026-05-20T01:00:00.000Z';
const digestA = `sha256:${'a'.repeat(64)}`;
const digestB = `sha256:${'b'.repeat(64)}`;
const digestC = `sha256:${'c'.repeat(64)}`;
const actorOwner = 'actor-owner';
const actorReviewer = 'actor-reviewer';
const actorQa = 'actor-qa';
const requirementIntakeContext: WorkItem['intake_context'] = {
  type: 'requirement',
  stakeholder_problem: 'Delivery teams need a ready execution package fixture.',
  desired_outcome: 'Runtime fixtures preserve Work Item driver intake data.',
  acceptance_criteria: ['Work Item fixture can seed the delivery runtime.'],
  in_scope: ['Runtime delivery fixtures'],
};
let readyExecutionPackageSeedCounter = 0;
const ownerHeaders = {
  'x-forgeloop-actor-id': actorOwner,
  'x-forgeloop-actor-class': 'human_admin',
};
const reviewerHeaders = {
  'x-forgeloop-actor-id': actorReviewer,
  'x-forgeloop-actor-class': 'human',
};

const requiredChecks = [
  {
    check_id: 'unit-tests',
    display_name: 'Unit tests',
    command: 'pnpm test tests/workflow',
    timeout_seconds: 120,
    blocks_review: true,
  },
  {
    check_id: 'lint',
    display_name: 'Lint',
    command: 'pnpm lint',
    timeout_seconds: 60,
    blocks_review: false,
  },
] as const;

const summaryArtifact: ArtifactRef = {
  kind: 'execution_summary',
  name: 'summary',
  content_type: 'text/markdown',
  local_ref: 'artifacts/run-session/summary.md',
};

const diffArtifact: ArtifactRef = {
  kind: 'diff',
  name: 'diff',
  content_type: 'text/x-diff',
  local_ref: 'artifacts/run-session/diff.patch',
};

const successfulChecks = (): CheckResult[] =>
  requiredChecks.map((check) => ({
    check_id: check.check_id,
    command: check.command,
    status: 'succeeded',
    exit_code: 0,
    duration_seconds: 2,
    blocks_review: check.blocks_review,
  }));

const packagePolicyFieldsFor = (executionPackage: ExecutionPackage): Pick<
  ExecutionPackage,
  | 'validation_strategy'
  | 'validation_strategy_version'
  | 'validation_public_summary'
  | 'policy_snapshot_status'
  | 'policy_snapshot_version'
  | 'package_policy_snapshot'
> => ({
  validation_strategy: 'checks_required',
  validation_strategy_version: 1,
  validation_public_summary: 'Required checks and package path policy are frozen for this test package.',
  policy_snapshot_status: 'captured',
  policy_snapshot_version: 1,
  package_policy_snapshot: buildPackageRuntimePolicySnapshot({
    loadedPolicy: runtimePolicyFromDocument({
      document: {
        codex: { primary_executor: 'mock', network_mode: 'disabled' },
        path_policy: {
          allowed_paths: executionPackage.allowed_paths,
          forbidden_paths: executionPackage.forbidden_paths,
        },
        observability: { public_summary: 'Required checks and package path policy are frozen for this test package.' },
      },
      markdownBody: '',
      loadedAt: now,
    }),
    executionPackageChecks: executionPackage.required_checks,
    executionPackagePathPolicy: {
      allowed_paths: executionPackage.allowed_paths,
      forbidden_paths: executionPackage.forbidden_paths,
    },
    validationStrategy: 'checks_required',
    sourceMutationPolicy: executionPackage.source_mutation_policy,
  }),
});

const localCodexPackagePolicyFieldsFor = (executionPackage: ExecutionPackage): ReturnType<typeof packagePolicyFieldsFor> => ({
  validation_strategy: 'checks_required',
  validation_strategy_version: 1,
  validation_public_summary: 'Required checks and local Codex package path policy are frozen for this test package.',
  policy_snapshot_status: 'captured',
  policy_snapshot_version: 1,
  package_policy_snapshot: buildPackageRuntimePolicySnapshot({
    loadedPolicy: runtimePolicyFromDocument({
      document: {
        codex: { primary_executor: 'app_server', network_mode: 'disabled' },
        path_policy: {
          allowed_paths: executionPackage.allowed_paths,
          forbidden_paths: executionPackage.forbidden_paths,
        },
        observability: { public_summary: 'Required checks and local Codex package path policy are frozen for this test package.' },
      },
      markdownBody: '',
      loadedAt: now,
    }),
    executionPackageChecks: executionPackage.required_checks,
    executionPackagePathPolicy: {
      allowed_paths: executionPackage.allowed_paths,
      forbidden_paths: executionPackage.forbidden_paths,
    },
    validationStrategy: 'checks_required',
    sourceMutationPolicy: executionPackage.source_mutation_policy,
  }),
});

export const succeededSelfReview = (): SelfReviewResult => ({
  status: 'succeeded',
  summary: 'The implementation follows the approved package plan.',
  spec_plan_alignment: 'The changed files match the package scope.',
  test_assessment: 'Required checks passed.',
  risk_notes: [],
  follow_up_questions: [],
});

export const succeededExecutorResult = (runSessionId: string): ExecutorResult => ({
  run_session_id: runSessionId,
  executor_type: 'mock',
  executor_version: 'test-executor',
  status: 'succeeded',
  started_at: now,
  finished_at: later,
  summary: 'Executor completed the package.',
  changed_files: [{ repo_id: 'repo-1', path: 'packages/workflow/src/index.ts', change_kind: 'modified' }],
  checks: successfulChecks(),
  artifacts: [summaryArtifact, diffArtifact],
  raw_metadata: {},
});

const baseRecords = (): {
  project: Project;
  projectRepo: ProjectRepo;
  workItem: WorkItem;
  spec: Spec;
  specRevision: SpecRevision;
  plan: Plan;
  planRevision: PlanRevision;
  executionPackage: ExecutionPackage;
} => {
  const project: Project = {
    id: 'project-1',
    name: 'Forgeloop',
    repo_ids: ['repo-1'],
    owner_actor_id: actorOwner,
    created_at: now,
    updated_at: now,
  };
  const projectRepo: ProjectRepo = {
    id: 'project-repo-1',
    repo_id: 'repo-1',
    project_id: project.id,
    name: 'forgeloop',
    status: 'active',
    local_path: '/workspace/forgeloop',
    default_branch: 'main',
    base_commit_sha: 'abc123',
    created_at: now,
    updated_at: now,
  };
  const workItem: WorkItem = {
    id: 'work-item-1',
    project_id: project.id,
    kind: 'requirement',
    title: 'Ship package workflow',
    goal: 'Execute generated packages.',
    success_criteria: ['A review packet is produced for successful runs.'],
    priority: 'P0',
    risk: 'medium',
    driver_actor_id: actorOwner,
    intake_context: requirementIntakeContext,
    phase: 'execution',
    activity_state: 'idle',
    gate_state: 'none',
    resolution: 'none',
    current_spec_id: 'spec-1',
    current_plan_id: 'plan-1',
    created_at: now,
    updated_at: now,
  };
  const spec: Spec = {
    id: 'spec-1',
    work_item_id: workItem.id,
    entity_type: 'spec',
    status: 'approved',
    editing_state: 'idle',
    gate_state: 'approved',
    resolution: 'approved',
    current_revision_id: 'spec-revision-1',
    created_at: now,
    updated_at: now,
  };
  const specRevision: SpecRevision = {
    id: 'spec-revision-1',
    spec_id: spec.id,
    work_item_id: workItem.id,
    revision_number: 1,
    summary: 'Approved package execution spec',
    content: 'Spec body',
    background: 'Background',
    goals: ['Execute packages'],
    scope_in: ['Workflow package'],
    scope_out: ['Executor implementation'],
    acceptance_criteria: ['Successful runs produce review packets'],
    risk_notes: [],
    test_strategy_summary: 'Workflow tests',
    artifact_refs: [],
    created_at: now,
  };
  const plan: Plan = {
    id: 'plan-1',
    work_item_id: workItem.id,
    entity_type: 'plan',
    status: 'approved',
    editing_state: 'idle',
    gate_state: 'approved',
    resolution: 'approved',
    current_revision_id: 'plan-revision-1',
    created_at: now,
    updated_at: now,
  };
  const planRevision: PlanRevision = {
    id: 'plan-revision-1',
    plan_id: plan.id,
    work_item_id: workItem.id,
    revision_number: 1,
    summary: 'Approved package execution plan',
    content: 'Plan body',
    implementation_summary: 'Add workflow orchestration.',
    split_strategy: 'One workflow package task.',
    dependency_order: ['execution-package-1'],
    test_matrix: ['pnpm test tests/workflow'],
    risk_mitigations: [],
    rollback_notes: 'Revert workflow package changes.',
    based_on_spec_revision_id: specRevision.id,
    artifact_refs: [],
    created_at: now,
  };
  const generatedPackage = transitionExecutionPackage(undefined, {
    type: 'generate_package',
    id: 'execution-package-1',
    work_item_id: workItem.id,
    spec_id: spec.id,
    spec_revision_id: specRevision.id,
    plan_id: plan.id,
    plan_revision_id: planRevision.id,
    project_id: project.id,
    repo_id: projectRepo.repo_id,
    objective: 'Implement the package execution workflow.',
    owner_actor_id: actorOwner,
    reviewer_actor_id: actorReviewer,
    qa_owner_actor_id: actorQa,
    required_checks: [...requiredChecks],
    required_artifact_kinds: ['execution_summary'],
    allowed_paths: ['packages/workflow/**', 'tests/workflow/**'],
    forbidden_paths: ['packages/db/**'],
    source_mutation_policy: 'path_policy_scoped',
    at: now,
  });
  const executionPackage = transitionExecutionPackage(
    {
      ...generatedPackage,
      ...packagePolicyFieldsFor(generatedPackage),
    },
    { type: 'mark_ready', at: now },
  );

  return { project, projectRepo, workItem, spec, specRevision, plan, planRevision, executionPackage };
};

const runSpecFor = (executionPackage: ExecutionPackage, runSessionId: string): RunSpec => ({
  run_session_id: runSessionId,
  execution_package_id: executionPackage.id,
  project_id: executionPackage.project_id,
  expected_package_version: executionPackage.version,
  work_item_id: executionPackage.work_item_id,
  spec_revision_id: executionPackage.spec_revision_id,
  plan_revision_id: executionPackage.plan_revision_id,
  executor_type: 'mock',
  repo: {
    repo_id: executionPackage.repo_id,
    local_path: '/workspace/forgeloop',
    base_branch: 'main',
    base_commit_sha: 'abc123',
  },
  objective: executionPackage.objective,
  context: {
    spec_revision_summary: 'Approved package execution spec',
    plan_revision_summary: 'Approved package execution plan',
    package_instructions: executionPackage.objective,
    required_checks: [...requiredChecks],
  },
  review_context: { latest_decision: 'none', requested_changes: [] },
  workflow_only: true,
  source_mutation_policy: executionPackage.source_mutation_policy ?? 'path_policy_scoped',
  allowed_paths: executionPackage.allowed_paths,
  forbidden_paths: executionPackage.forbidden_paths,
  required_checks: [...requiredChecks],
  artifact_policy: { requested_artifacts: ['execution_summary', 'diff', 'changed_files', 'check_output'] },
  timeout_seconds: 3600,
  idempotency_key: runSessionId,
});

const saveBaseRecords = async (
  repository: DeliveryRepository,
  executionPackage: ExecutionPackage,
  records: ReturnType<typeof baseRecords>,
): Promise<void> => {
  await repository.saveProject(records.project);
  await repository.saveProjectRepo(records.projectRepo);
  await repository.saveWorkItem(records.workItem);
  await repository.saveSpec(records.spec);
  await repository.saveSpecRevision(records.specRevision);
  await repository.savePlan(records.plan);
  await repository.savePlanRevision(records.planRevision);
  await repository.saveExecutionPackage(executionPackage);
};

export const seedReadyExecutionPackage = async (repository: DeliveryRepository): Promise<ExecutionPackage> => {
  const suffix = `-${++readyExecutionPackageSeedCounter}`;
  const records = baseRecords();
  records.project = { ...records.project, id: `project${suffix}`, repo_ids: [...records.project.repo_ids] };
  records.projectRepo = { ...records.projectRepo, id: `project-repo${suffix}`, project_id: records.project.id };
  records.workItem = {
    ...records.workItem,
    id: `work-item${suffix}`,
    project_id: records.project.id,
    current_spec_id: `spec${suffix}`,
    current_spec_revision_id: `spec-revision${suffix}`,
    current_plan_id: `plan${suffix}`,
    current_plan_revision_id: `plan-revision${suffix}`,
  };
  records.spec = {
    ...records.spec,
    id: `spec${suffix}`,
    work_item_id: records.workItem.id,
    current_revision_id: `spec-revision${suffix}`,
    approved_revision_id: `spec-revision${suffix}`,
  };
  records.specRevision = {
    ...records.specRevision,
    id: `spec-revision${suffix}`,
    spec_id: records.spec.id,
    work_item_id: records.workItem.id,
  };
  records.plan = {
    ...records.plan,
    id: `plan${suffix}`,
    work_item_id: records.workItem.id,
    current_revision_id: `plan-revision${suffix}`,
    approved_revision_id: `plan-revision${suffix}`,
  };
  records.planRevision = {
    ...records.planRevision,
    id: `plan-revision${suffix}`,
    plan_id: records.plan.id,
    work_item_id: records.workItem.id,
    based_on_spec_revision_id: records.specRevision.id,
  };
  records.executionPackage = {
    ...records.executionPackage,
    id: `execution-package${suffix}`,
    work_item_id: records.workItem.id,
    spec_id: records.spec.id,
    spec_revision_id: records.specRevision.id,
    plan_id: records.plan.id,
    plan_revision_id: records.planRevision.id,
    project_id: records.project.id,
  };
  await saveBaseRecords(repository, records.executionPackage, records);
  await repository.appendObjectEvent({
    id: `work-item-seeded-event${suffix}`,
    object_type: 'work_item',
    object_id: records.workItem.id,
    event_type: 'work_item_seeded',
    actor_type: 'system',
    metadata: {},
    payload: { work_item_id: records.workItem.id },
    created_at: now,
  });
  await repository.appendObjectEvent({
    id: `execution-package-seeded-event${suffix}`,
    object_type: 'execution_package',
    object_id: records.executionPackage.id,
    event_type: 'execution_package_seeded',
    actor_type: 'system',
    metadata: {},
    payload: { execution_package_id: records.executionPackage.id },
    created_at: now,
  });
  return records.executionPackage;
};

export const seedReadyLocalCodexExecutionPackage = async (repository: DeliveryRepository): Promise<ExecutionPackage> => {
  const executionPackage = await seedReadyExecutionPackage(repository);
  const localCodexPackage = {
    ...executionPackage,
    ...localCodexPackagePolicyFieldsFor(executionPackage),
  };
  await repository.saveExecutionPackage(localCodexPackage);
  return localCodexPackage;
};

const baseRuntimeProfileRevision = (
  executionPackage: ExecutionPackage,
  targetKind: 'generation' | 'run_execution',
  suffix: string,
): CodexRuntimeProfileRevision => {
  const codexConfigToml =
    targetKind === 'run_execution'
      ? 'approval_policy = "never"\nsandbox_mode = "danger-full-access"\n'
      : 'approval_policy = "never"\nsandbox_mode = "read-only"\n';
  const revisionWithoutDigest: CodexRuntimeProfileRevision = {
    id: `profile-${targetKind}-revision-${suffix}`,
    profile_id: `profile-${targetKind}-${suffix}`,
    revision_number: 1,
    status: 'active',
    environment: 'test',
    docker_image: 'ghcr.io/forgeloop/codex-worker:test',
    docker_image_digest: digestA,
    target_kind: targetKind,
    source_access_mode: targetKind === 'run_execution' ? 'path_policy_scoped' : 'artifact_only',
    codex_config_toml: codexConfigToml,
    codex_config_digest: codexCanonicalDigest(codexConfigToml),
    expected_effective_config_digest: digestB,
    effective_config_assertions:
      targetKind === 'run_execution'
        ? {
            target_kind: 'run_execution',
            approval_policy: 'never',
            sandbox_type: 'danger-full-access',
            writable_roots_policy: 'task_workspace_only',
          }
        : {
            target_kind: 'generation',
            approval_policy: 'never',
            source_write_policy: 'artifact_only',
            forbidden_writable_roots: ['workspace'],
          },
    app_server_required: true,
    allowed_driver_kind: 'app_server',
    network_policy: { mode: 'disabled' },
    resource_limits: {
      cpu_ms: 120_000,
      memory_mb: 1024,
      pids: 64,
      fds: 256,
      workspace_bytes: 268_435_456,
      artifact_bytes: 134_217_728,
      timeout_ms: 120_000,
      output_limit_bytes: 1_000_000,
      run_output_limit_bytes: 5_000_000,
    },
    docker_policy: {
      network_disabled: true,
      app_server_only: true,
      rootless: true,
      read_only_rootfs: true,
      no_new_privileges: true,
      drop_capabilities: ['ALL'],
    },
    allowed_scopes: [{ project_id: executionPackage.project_id, repo_id: executionPackage.repo_id }],
    profile_digest: digestC,
    created_by_actor_id: actorOwner,
    created_at: now,
  };
  return { ...revisionWithoutDigest, profile_digest: codexRuntimeProfileRevisionDigest(revisionWithoutDigest) };
};

export const seedActiveRunExecutionProfile = async (
  repository: DeliveryRepository,
  executionPackage: ExecutionPackage,
  suffix = executionPackage.id,
): Promise<CodexRuntimeProfileRevision> => {
  const revision = baseRuntimeProfileRevision(executionPackage, 'run_execution', suffix);
  await repository.createCodexRuntimeProfileWithRevision({
    profile: {
      id: revision.profile_id,
      name: 'Run execution test profile',
      environment: revision.environment,
      target_kind: revision.target_kind,
      active_revision_id: revision.id,
      created_by_actor_id: actorOwner,
      created_at: now,
      updated_at: now,
    },
    revision,
  });
  return revision;
};

export const seedActiveGenerationProfile = async (
  repository: DeliveryRepository,
  executionPackage: ExecutionPackage,
): Promise<CodexRuntimeProfileRevision> => {
  const revision = baseRuntimeProfileRevision(executionPackage, 'generation', executionPackage.id);
  await repository.createCodexRuntimeProfileWithRevision({
    profile: {
      id: revision.profile_id,
      name: 'Generation test profile',
      environment: revision.environment,
      target_kind: revision.target_kind,
      active_revision_id: revision.id,
      created_by_actor_id: actorOwner,
      created_at: now,
      updated_at: now,
    },
    revision,
  });
  return revision;
};

export const seedSingleCredentialBinding = async (
  repository: DeliveryRepository,
  profileRevision: CodexRuntimeProfileRevision,
  executionPackage: ExecutionPackage,
  suffix = 'default',
) => {
  const secretPayload = { auth: { access_token: `unsafe-db-access-token-${suffix}` } };
  const bindingId = `credential-binding-${suffix}-${executionPackage.id}`;
  const versionId = `credential-binding-version-${suffix}-${executionPackage.id}`;
  await repository.createCodexCredentialBindingWithVersion({
    binding: {
      id: bindingId,
      profile_id: profileRevision.profile_id,
      project_id: executionPackage.project_id,
      repo_id: executionPackage.repo_id,
      provider: 'unsafe_db',
      purpose: 'model_provider',
      active_version_id: versionId,
      created_by_actor_id: actorOwner,
      created_at: now,
      updated_at: now,
    },
    version: {
      id: versionId,
      binding_id: bindingId,
      version_number: 1,
      status: 'active',
      payload_digest: codexCredentialPayloadDigest(secretPayload),
      created_by_actor_id: actorOwner,
      created_at: now,
    },
    secret_payload_json: secretPayload,
  });
  return { bindingId, versionId };
};

const seedCodexWorker = async (
  repository: DeliveryRepository,
  profileRevision: CodexRuntimeProfileRevision,
  executionPackage: ExecutionPackage,
  suffix: string,
  overrides: {
    targetKinds?: readonly ('generation' | 'run_execution')[];
    dockerImageDigests?: readonly string[];
    networkPolicyDigests?: readonly string[];
    activeLeaseCount?: number;
    maxConcurrency?: number;
  } = {},
) => {
  const bootstrapToken = `bootstrap-token-${suffix}-${executionPackage.id}`;
  const sessionToken = `session-token-${suffix}-${executionPackage.id}`;
  const networkPolicyDigest = codexRuntimeNetworkPolicyDigest(profileRevision.network_policy);
  await repository.createCodexWorkerBootstrapToken({
    id: `bootstrap-${suffix}-${executionPackage.id}`,
    worker_identity: `worker-identity-${suffix}-${executionPackage.id}`,
    bootstrap_token_hash: codexCredentialPayloadDigest(bootstrapToken),
    bootstrap_token_version: 1,
    status: 'active',
    allowed_scopes_json: [{ project_id: executionPackage.project_id, repo_id: executionPackage.repo_id }],
    allowed_capabilities_json: {
      target_kinds: overrides.targetKinds ?? [profileRevision.target_kind],
      docker_image_digests: overrides.dockerImageDigests ?? [profileRevision.docker_image_digest],
      network_policy_digests: overrides.networkPolicyDigests ?? [networkPolicyDigest],
    },
    created_by_actor_id: actorOwner,
    created_at: runtimeNow,
    expires_at: expiresAt,
  });
  await repository.upsertCodexWorkerRegistration({
    worker_id: `worker-${suffix}-${executionPackage.id}`,
    worker_identity: `worker-identity-${suffix}-${executionPackage.id}`,
    version: 'codex-worker-test-v1',
    bootstrap_token_hash: codexCredentialPayloadDigest(bootstrapToken),
    bootstrap_token_version: 1,
    session_token: sessionToken,
    session_expires_at: expiresAt,
    status: 'online',
    control_channel_status: 'connected',
    allowed_scopes: [{ project_id: executionPackage.project_id, repo_id: executionPackage.repo_id }],
    capabilities: overrides.targetKinds ?? [profileRevision.target_kind],
    docker_image_digests: overrides.dockerImageDigests ?? [profileRevision.docker_image_digest],
    network_policy_digests: overrides.networkPolicyDigests ?? [networkPolicyDigest],
    host_worker_uid: 501,
    host_worker_gid: 20,
    lease_count: overrides.activeLeaseCount ?? 0,
    max_concurrency: overrides.maxConcurrency ?? 2,
    session_public_key_id: `session-key-${suffix}`,
    session_public_key_algorithm: 'x25519',
    session_public_key_material: 'base64-public-key-material',
    session_public_key_expires_at: expiresAt,
    now: runtimeNow,
  });
  await repository.heartbeatCodexWorker({
    worker_id: `worker-${suffix}-${executionPackage.id}`,
    session_token: sessionToken,
    nonce: `nonce-${suffix}`,
    nonce_timestamp: runtimeNow,
    status: 'online',
    control_channel_status: 'connected',
    active_lease_count: overrides.activeLeaseCount ?? 0,
    capabilities: overrides.targetKinds ?? [profileRevision.target_kind],
    now: runtimeNow,
  });
};

export const seedOnlineCompatibleCodexWorker = (
  repository: DeliveryRepository,
  profileRevision: CodexRuntimeProfileRevision,
  executionPackage: ExecutionPackage,
  overrides: { activeLeaseCount?: number; maxConcurrency?: number } = {},
) => seedCodexWorker(repository, profileRevision, executionPackage, 'compatible', overrides);

export const seedOnlineCodexWorkerWithDockerMismatch = (
  repository: DeliveryRepository,
  profileRevision: CodexRuntimeProfileRevision,
  executionPackage: ExecutionPackage,
) => seedCodexWorker(repository, profileRevision, executionPackage, 'docker-mismatch', { dockerImageDigests: [digestB] });

export const seedOnlineCodexWorkerWithNetworkMismatch = (
  repository: DeliveryRepository,
  profileRevision: CodexRuntimeProfileRevision,
  executionPackage: ExecutionPackage,
) => seedCodexWorker(repository, profileRevision, executionPackage, 'network-mismatch', { networkPolicyDigests: [digestB] });

export const seedQueuedPackageRun = async (
  repository: DeliveryRepository,
): Promise<{ executionPackage: ExecutionPackage; runSession: RunSession }> => {
  const records = baseRecords();
  const runSessionId = 'run-session-1';
  const executionPackage = transitionExecutionPackage(records.executionPackage, {
    type: 'run',
    run_session_id: runSessionId,
    at: now,
  });
  const runSession = transitionRunSession(undefined, {
    type: 'create',
    id: runSessionId,
    execution_package_id: executionPackage.id,
    requested_by_actor_id: actorOwner,
    executor_type: 'mock',
    at: now,
  });

  await saveBaseRecords(repository, executionPackage, records);
  await repository.saveRunSession(runSession);

  return { executionPackage, runSession };
};

export const seedReadyStartedPackageRun = async (
  repository: DeliveryRepository,
): Promise<{ executionPackage: ExecutionPackage; runSession: RunSession }> => {
  const { executionPackage, runSession } = await seedQueuedPackageRun(repository);
  const startedAt = '2026-05-05T00:00:30.000Z';
  const startedPackage: ExecutionPackage = {
    ...executionPackage,
    phase: 'execution',
    activity_state: 'ai_running',
    updated_at: startedAt,
  };
  const startedRunSession: RunSession = {
    ...runSession,
    status: 'running',
    executor_type: 'mock',
    run_spec: runSpecFor(executionPackage, runSession.id),
    started_at: startedAt,
    updated_at: startedAt,
  };

  await repository.saveExecutionPackage(startedPackage);
  await repository.saveRunSession(startedRunSession);

  return { executionPackage: startedPackage, runSession: startedRunSession };
};

export const seedRunningRunWithCommand = async (
  repository: DeliveryRepository,
  command: Partial<RunCommand>,
): Promise<{ runSession: RunSession; command: RunCommand }> => {
  const { runSession } = await seedReadyStartedPackageRun(repository);
  const persistedCommand: RunCommand = {
    id: command.id ?? `run-command:${runSession.id}:continue`,
    run_session_id: command.run_session_id ?? runSession.id,
    command_type: command.command_type ?? 'continue',
    status: command.status ?? 'pending',
    actor_id: command.actor_id ?? actorOwner,
    payload: command.payload ?? {},
    created_at: command.created_at ?? now,
    updated_at: command.updated_at ?? now,
    ...(command.target_thread_id === undefined ? {} : { target_thread_id: command.target_thread_id }),
    ...(command.target_turn_id === undefined ? {} : { target_turn_id: command.target_turn_id }),
    ...(command.claimed_by_worker_id === undefined ? {} : { claimed_by_worker_id: command.claimed_by_worker_id }),
    ...(command.claimed_at === undefined ? {} : { claimed_at: command.claimed_at }),
    ...(command.applied_at === undefined ? {} : { applied_at: command.applied_at }),
    ...(command.failure_reason === undefined ? {} : { failure_reason: command.failure_reason }),
    ...(command.driver_ack === undefined ? {} : { driver_ack: command.driver_ack }),
  };

  await repository.saveRunCommand(persistedCommand);

  return { runSession, command: persistedCommand };
};

export const monotonicTestClock = (startIso: string, incrementMs = 1): (() => string) => {
  let current = new Date(startIso).getTime();

  return () => {
    const value = new Date(current).toISOString();
    current += incrementMs;
    return value;
  };
};

const createProjectRepoWorkItem = async (app: INestApplication) => {
  const server = app.getHttpServer();
  const project = (
    await request(server).post('/projects').send({ name: 'Forgeloop', owner_actor_id: actorOwner }).expect(201)
  ).body;

  await request(server)
    .post(`/projects/${project.id}/repos`)
    .send({
      repo_id: 'repo-1',
      name: 'forgeloop',
      local_path: await createWorkflowPolicyRepoRoot(),
      default_branch: 'main',
      base_commit_sha: 'abc123',
    })
    .expect(201);

  const workItem = (
    await request(server)
      .post('/work-items')
      .send({
        project_id: project.id,
        kind: 'requirement',
        title: 'Ship delivery control plane API',
        goal: 'Expose the delivery loop commands over REST.',
        success_criteria: ['Spec, plan, package, run, and review commands are available.'],
        priority: 'P0',
        risk: 'medium',
        driver_actor_id: actorOwner,
        intake_context: requirementIntakeContext,
      })
      .expect(201)
  ).body;

  return { project, workItem };
};

const approveSpec = async (app: INestApplication, workItemId: string): Promise<string> => {
  const { spec } = await seedItemScopedSpecPlan(app, workItemId, {
    actorId: actorOwner,
    reviewerActorId: actorReviewer,
    includePlan: false,
  });
  return spec.id;
};

const approvePlan = async (app: INestApplication, workItemId: string): Promise<string> => {
  const { planRevision } = await seedItemScopedSpecPlan(app, workItemId, {
    actorId: actorOwner,
    reviewerActorId: actorReviewer,
  });
  return planRevision!.id;
};

export const seedReadyExecutionPackageThroughApi = async (app: INestApplication): Promise<ExecutionPackage> => {
  const server = app.getHttpServer();
  const { workItem } = await createProjectRepoWorkItem(app);

  await approveSpec(app, workItem.id);
  const planRevisionId = await approvePlan(app, workItem.id);

  const executionPackage = (
    await request(server)
      .post(`/plan-revisions/${planRevisionId}/execution-packages`)
      .send({
        repo_id: 'repo-1',
        objective: 'Implement the delivery API package.',
        owner_actor_id: actorOwner,
        reviewer_actor_id: actorReviewer,
        qa_owner_actor_id: actorQa,
        required_checks: [...requiredChecks],
        required_artifact_kinds: ['execution_summary'],
        allowed_paths: ['apps/control-plane-api/**', 'tests/api/**'],
        forbidden_paths: ['packages/db/**'],
      })
      .expect(201)
  ).body as ExecutionPackage;

  const readyPackage = (await request(server)
    .post(`/execution-packages/${executionPackage.id}/mark-ready`)
    .set(ownerHeaders)
    .send({ actor_id: actorOwner, expected_package_version: executionPackage.version })
    .expect(201)).body as { id: string; scope_ref?: unknown };
  if ('work_item_id' in readyPackage) {
    throw new Error('Public execution package response exposed work_item_id');
  }
  if (!('scope_ref' in readyPackage)) {
    throw new Error('Public execution package response did not include scope_ref');
  }

  const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
  const persistedPackage = await repository.getExecutionPackage(readyPackage.id);
  if (persistedPackage === undefined) {
    throw new Error(`Expected persisted execution package ${readyPackage.id}`);
  }
  return persistedPackage;
};

export const seedReadyExecutionPackageRunSession = async (
  repository: DeliveryRepository,
  options: { durabilityMode?: 'durable' | 'volatile_demo' } = {},
): Promise<{ executionPackage: ExecutionPackage; runSession: RunSession }> => {
  const executionPackage = await seedReadyExecutionPackage(repository);
  const runSessionId = `run-session-fixture-${readyExecutionPackageSeedCounter}`;
  const runningPackage = transitionExecutionPackage(executionPackage, {
    type: 'run',
    run_session_id: runSessionId,
    at: now,
  });
  const runSession = transitionRunSession(undefined, {
    type: 'create',
    id: runSessionId,
    execution_package_id: executionPackage.id,
    requested_by_actor_id: actorOwner,
    executor_type: 'mock',
    run_spec: runSpecFor(executionPackage, runSessionId),
    at: now,
  });

  await repository.saveExecutionPackage(runningPackage);
  const persistedRunSession: RunSession = {
    ...runSession,
    runtime_metadata: {
      durability_mode: options.durabilityMode ?? 'volatile_demo',
      recovery_attempt_count: 0,
      effective_dangerous_mode: 'not_requested',
    },
  };
  await repository.saveRunSession(persistedRunSession);
  await repository.appendRunEvent({
    id: `run-event-queued-${persistedRunSession.id}`,
    run_session_id: persistedRunSession.id,
    event_type: 'run_queued',
    source: 'api',
    visibility: 'public',
    summary: 'Run queued.',
    payload: { execution_package_id: runningPackage.id },
    created_at: now,
  });

  return { executionPackage: runningPackage, runSession: persistedRunSession };
};

export const seedAppWithRunSession = async (
  options: { durabilityMode?: 'durable' | 'volatile_demo' } = {},
): Promise<{ app: INestApplication; repo: InMemoryDeliveryRepository; runSessionId: string }> => {
  let moduleBuilder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DELIVERY_RUN_WORKER)
    .useValue({ kick: () => undefined, drainOnce: async () => undefined });
  if (options.durabilityMode !== undefined) {
    moduleBuilder = moduleBuilder.overrideProvider(RUN_DURABILITY_MODE).useValue(options.durabilityMode);
  }
  const moduleRef = await moduleBuilder.compile();
  const app = moduleRef.createNestApplication();
  await app.init();

  const repo = app.get(DELIVERY_REPOSITORY) as InMemoryDeliveryRepository;
  const { runSession } = await seedReadyExecutionPackageRunSession(repo, options);

  return { app, repo, runSessionId: runSession.id };
};

const createTestApp = async (): Promise<{ app: INestApplication; repo: InMemoryDeliveryRepository }> => {
  const repo = new InMemoryDeliveryRepository();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DELIVERY_REPOSITORY)
    .useValue(repo)
    .overrideProvider(DELIVERY_RUN_WORKER)
    .useValue({ kick: () => undefined, drainOnce: async () => undefined })
    .compile();
  const app = moduleRef.createNestApplication();
  await app.init();

  return { app, repo };
};

const runSessionForEvidence = (
  executionPackageId: string,
  id: string,
  input: Partial<RunSession> = {},
): RunSession => ({
  id,
  execution_package_id: executionPackageId,
  requested_by_actor_id: actorOwner,
  status: 'succeeded',
  executor_type: 'mock',
  changed_files: [{ repo_id: 'repo-1', path: 'apps/control-plane-api/src/modules/run-control/run-control.service.ts', change_kind: 'modified' }],
  check_results: successfulChecks(),
  artifacts: [
    {
      kind: 'execution_summary',
      name: 'Execution summary',
      content_type: 'text/markdown',
      local_ref: `artifacts/${id}/summary.md`,
      digest: `sha256:${id}:summary`,
    },
  ],
  log_refs: [],
  summary: `Run ${id} completed.`,
  created_at: now,
  updated_at: later,
  finished_at: later,
  ...input,
});

const reviewPacketForEvidence = (
  executionPackage: ExecutionPackage,
  runSession: RunSession,
  input: Partial<ReviewPacket> = {},
): ReviewPacket => ({
  id: `review-packet:${runSession.id}`,
  run_session_id: runSession.id,
  execution_package_id: executionPackage.id,
  reviewer_actor_id: executionPackage.reviewer_actor_id,
  spec_revision_id: executionPackage.spec_revision_id,
  plan_revision_id: executionPackage.plan_revision_id,
  status: 'ready',
  decision: 'none',
  changed_files: runSession.changed_files,
  check_result_summary: 'Required checks passed.',
  self_review: succeededSelfReview(),
  risk_notes: [],
  requested_changes: [],
  created_at: runSession.finished_at ?? runSession.updated_at,
  updated_at: runSession.finished_at ?? runSession.updated_at,
  ...input,
});

export const seedEvidenceChainBase = async (): Promise<{
  app: INestApplication;
  repo: InMemoryDeliveryRepository;
  records: ReturnType<typeof baseRecords>;
  executionPackage: ExecutionPackage;
}> => {
  const { app, repo } = await createTestApp();
  const records = baseRecords();
  await saveBaseRecords(repo, records.executionPackage, records);

  return { app, repo, records, executionPackage: records.executionPackage };
};

export const seedEvidenceChainScenario = async (): Promise<{
  app: INestApplication;
  repo: InMemoryDeliveryRepository;
  workItemId: string;
  executionPackageId: string;
  currentReviewPacketId: string;
  changesRequestedReviewPacketId: string;
  unlinkedReviewPacketId: string;
}> => {
  const { app, repo, records } = await seedEvidenceChainBase();
  const executionPackage: ExecutionPackage = {
    ...records.executionPackage,
    required_artifact_kinds: ['execution_summary', 'logs', 'diff'],
    last_run_session_id: 'run-session-approved',
    phase: 'review',
    activity_state: 'awaiting_human',
    gate_state: 'review_approved',
    resolution: 'completed',
    updated_at: '2026-05-05T00:05:00.000Z',
  };
  await repo.saveExecutionPackage(executionPackage);

  const changesRequestedRun = runSessionForEvidence(executionPackage.id, 'run-session-changes-requested', {
    created_at: '2026-05-05T00:01:00.000Z',
    updated_at: '2026-05-05T00:02:00.000Z',
    finished_at: '2026-05-05T00:02:00.000Z',
    summary: 'Initial run completed before review changes were requested.',
    log_refs: [
      {
        kind: 'logs',
        name: 'Raw Codex log',
        content_type: 'application/jsonl',
        local_ref: 'artifacts/run-session-changes-requested/raw-codex.jsonl',
      },
    ],
  });
  const unlinkedRun = runSessionForEvidence(executionPackage.id, 'run-session-unlinked-history', {
    status: 'failed',
    failure_kind: 'required_check_failed',
    failure_reason: 'Unit tests failed.',
    check_results: [
      {
        check_id: 'unit-tests',
        command: 'pnpm test tests/workflow',
        status: 'failed',
        exit_code: 1,
        duration_seconds: 3,
        blocks_review: true,
      },
    ],
    artifacts: [],
    created_at: '2026-05-05T00:03:00.000Z',
    updated_at: '2026-05-05T00:03:30.000Z',
    finished_at: '2026-05-05T00:03:30.000Z',
    summary: 'Unlinked historical rerun failed checks.',
  });
  const approvedRun = runSessionForEvidence(executionPackage.id, 'run-session-approved', {
    created_at: '2026-05-05T00:04:00.000Z',
    updated_at: '2026-05-05T00:05:00.000Z',
    finished_at: '2026-05-05T00:05:00.000Z',
    summary: 'Rerun addressed requested changes and passed review.',
    log_refs: [
      {
        kind: 'logs',
        name: 'Raw Codex log',
        content_type: 'application/jsonl',
        local_ref: 'artifacts/run-session-approved/raw-codex.jsonl',
      },
    ],
  });

  await repo.saveRunSession(changesRequestedRun);
  await repo.saveRunSession(unlinkedRun);
  await repo.saveRunSession(approvedRun);

  const changesRequestedPacket = reviewPacketForEvidence(executionPackage, changesRequestedRun, {
    id: 'review-packet-changes-requested',
    status: 'completed',
    decision: 'changes_requested',
    summary: 'Changes requested for missing validation.',
    reviewed_by_actor_id: actorReviewer,
    reviewed_at: '2026-05-05T00:02:30.000Z',
    requested_changes: [{ summary: 'Add missing validation coverage.', severity: 'blocking' }],
    completed_at: '2026-05-05T00:02:30.000Z',
    updated_at: '2026-05-05T00:02:30.000Z',
  });
  const unlinkedPacket = reviewPacketForEvidence(executionPackage, unlinkedRun, {
    id: 'review-packet-unlinked-history',
    status: 'ready',
    decision: 'none',
    check_result_summary: 'Required checks failed.',
    risk_notes: ['Unlinked historical rerun should remain visible.'],
  });
  const approvedPacket = reviewPacketForEvidence(executionPackage, approvedRun, {
    id: 'review-packet-approved',
    status: 'completed',
    decision: 'approved',
    summary: 'Rerun approved.',
    reviewed_by_actor_id: actorReviewer,
    reviewed_at: '2026-05-05T00:05:30.000Z',
    completed_at: '2026-05-05T00:05:30.000Z',
    updated_at: '2026-05-05T00:05:30.000Z',
  });

  await repo.saveReviewPacket(changesRequestedPacket);
  await repo.saveReviewPacket(unlinkedPacket);
  await repo.saveReviewPacket(approvedPacket);
  await repo.saveDecision({
    id: 'decision-review-packet-changes-requested',
    object_type: 'review_packet',
    object_id: changesRequestedPacket.id,
    actor_id: actorReviewer,
    decision: 'changes_requested',
    summary: 'Changes requested for missing validation.',
    created_at: '2026-05-05T00:02:30.000Z',
  });
  await repo.saveDecision({
    id: 'decision-review-packet-approved',
    object_type: 'review_packet',
    object_id: approvedPacket.id,
    actor_id: actorReviewer,
    decision: 'approved',
    summary: 'Rerun approved.',
    created_at: '2026-05-05T00:05:30.000Z',
  });

  const artifacts: Artifact[] = [
    {
      id: 'artifact-approved-summary',
      object_type: 'run_session',
      object_id: approvedRun.id,
      ref: approvedRun.artifacts[0]!,
      created_at: '2026-05-05T00:05:00.000Z',
    },
    {
      id: 'artifact-approved-raw-metadata',
      object_type: 'run_session',
      object_id: approvedRun.id,
      ref: {
        kind: 'raw_metadata',
        name: 'Raw metadata',
        content_type: 'application/json',
        local_ref: 'artifacts/run-session-approved/raw-metadata.json',
        raw_ref: { local_ref: 'artifacts/run-session-approved/internal.jsonl' },
      } as never,
      created_at: '2026-05-05T00:05:01.000Z',
    },
    {
      id: 'artifact-changes-summary',
      object_type: 'run_session',
      object_id: changesRequestedRun.id,
      ref: changesRequestedRun.artifacts[0]!,
      created_at: '2026-05-05T00:02:00.000Z',
    },
  ];
  for (const artifact of artifacts) {
    await repo.saveArtifact(artifact);
  }

  await repo.appendRunEvent({
    id: 'run-event-approved-public',
    run_session_id: approvedRun.id,
    event_type: 'run_succeeded',
    source: 'executor',
    visibility: 'public',
    summary: 'Run succeeded.',
    payload: { status: 'succeeded', internal_output: 'summary only' },
    created_at: '2026-05-05T00:05:00.000Z',
  });
  await repo.appendRunEvent({
    id: 'run-event-approved-internal',
    run_session_id: approvedRun.id,
    event_type: 'command_output_delta',
    source: 'codex',
    visibility: 'internal',
    summary: 'Raw command output.',
    payload: { text: 'secret command output' },
    raw_ref: 'local://raw-command-output.jsonl',
    created_at: '2026-05-05T00:05:01.000Z',
  });

  await repo.saveTraceEvent({
    id: 'trace-event:run-replacement:run-session-approved',
    event_type: 'run_replacement_recorded',
    subject_type: 'run_session',
    subject_id: approvedRun.id,
    actor_id: actorOwner,
    summary: 'Run run-session-approved replaces run-session-changes-requested.',
    payload: {
      mode: 'rerun_package',
      execution_package_id: executionPackage.id,
      work_item_id: records.workItem.id,
      new_run_session_id: approvedRun.id,
      previous_run_session_id: changesRequestedRun.id,
      previous_review_packet_id: changesRequestedPacket.id,
      new_review_packet_id: approvedPacket.id,
    },
    created_at: '2026-05-05T00:04:00.000Z',
  });
  await repo.saveTraceLink({
    id: 'trace-link:approved:belongs-to-work-item',
    trace_event_id: 'trace-event:run-replacement:run-session-approved',
    relationship: 'belongs_to',
    object_type: 'work_item',
    object_id: records.workItem.id,
    created_at: '2026-05-05T00:04:00.000Z',
  });
  await repo.saveTraceLink({
    id: 'trace-link:approved:generated-by-run',
    trace_event_id: 'trace-event:run-replacement:run-session-approved',
    relationship: 'generated_by',
    object_type: 'run_session',
    object_id: approvedRun.id,
    created_at: '2026-05-05T00:04:00.000Z',
  });
  await repo.saveTraceLink({
    id: 'trace-link:approved:generated-by-review-packet',
    trace_event_id: 'trace-event:run-replacement:run-session-approved',
    relationship: 'generated_by',
    object_type: 'review_packet',
    object_id: approvedPacket.id,
    created_at: '2026-05-05T00:04:00.000Z',
  });
  await repo.saveTraceLink({
    id: 'trace-link:approved:supersedes-run',
    trace_event_id: 'trace-event:run-replacement:run-session-approved',
    relationship: 'supersedes',
    object_type: 'run_session',
    object_id: changesRequestedRun.id,
    created_at: '2026-05-05T00:04:00.000Z',
  });
  await repo.saveTraceLink({
    id: 'trace-link:approved:replaces-packet',
    trace_event_id: 'trace-event:run-replacement:run-session-approved',
    relationship: 'replaces',
    object_type: 'review_packet',
    object_id: changesRequestedPacket.id,
    created_at: '2026-05-05T00:04:00.000Z',
  });
  await repo.saveTraceArtifactRef({
    id: 'trace-artifact-ref:approved-summary',
    trace_event_id: 'trace-event:run-replacement:run-session-approved',
    artifact_id: 'artifact-approved-summary',
    ref: approvedRun.artifacts[0]!,
    created_at: '2026-05-05T00:05:00.000Z',
  });

  return {
    app,
    repo,
    workItemId: records.workItem.id,
    executionPackageId: executionPackage.id,
    currentReviewPacketId: approvedPacket.id,
    changesRequestedReviewPacketId: changesRequestedPacket.id,
    unlinkedReviewPacketId: unlinkedPacket.id,
  };
};
