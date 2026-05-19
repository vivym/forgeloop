import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AppModule } from '../../apps/control-plane-api/src/app.module';
import {
  actorContextFromHeaders,
  actorSignatureHeaderName,
  actorTimestampHeaderName,
  trustedActorHeaderSignature,
} from '../../apps/control-plane-api/src/modules/auth/actor-context';
import { AutomationCommandService } from '../../apps/control-plane-api/src/modules/automation/automation-command.service';
import { DELIVERY_REPOSITORY } from '../../apps/control-plane-api/src/modules/core/control-plane-tokens';
import { ExecutionPackageService } from '../../apps/control-plane-api/src/modules/execution-packages/execution-package.service';
import { DELIVERY_RUN_WORKER } from '../../apps/control-plane-api/src/modules/run-control/run-worker.token';
import { SpecPlanService } from '../../apps/control-plane-api/src/modules/spec-plan/spec-plan.service';
import { InMemoryDeliveryRepository, type DeliveryRepository } from '../../packages/db/src/index';
import { signAutomationRequest } from '../../packages/automation/src/index';
import type { ArtifactRef } from '../../packages/contracts/src/index';
import {
  automationPreconditionFingerprint,
  buildManualScopeKey,
  resourceLimitDigest,
  transitionSpecPlan,
  transitionWorkItem,
  type AutomationPrecondition,
  type ExecutionPackage,
  type Plan,
  type PlanRevision,
  type Project,
  type ProjectRepo,
  type Release,
  type ReviewPacket,
  type ResourceLimitVector,
  type RunSession,
  type RuntimeSafetyAttestation,
  type Spec,
  type SpecRevision,
  type WorkItem,
} from '../../packages/domain/src/index';
import { seedReadyExecutionPackage, succeededSelfReview } from '../helpers/delivery-runtime-fixtures';
import { createWorkflowPolicyRepoRoot } from '../helpers/runtime-policy-repo';

const actorOwner = 'actor-owner';
const actorReviewer = 'actor-reviewer';
const humanAdminHeaders = {
  'x-forgeloop-actor-id': actorOwner,
  'x-forgeloop-actor-class': 'human_admin',
};
const reviewerHeaders = {
  'x-forgeloop-actor-id': actorReviewer,
  'x-forgeloop-actor-class': 'human',
};
const daemonHeaders = {
  'x-forgeloop-actor-id': 'daemon-actor',
  'x-forgeloop-actor-class': 'automation_daemon',
  'x-forgeloop-daemon-identity': 'daemon-1',
};
const automationSecret = 'test-secret';
const automationActorId = 'daemon-actor';
const automationDaemonIdentity = 'daemon-1';
const automationTestNow = '2026-05-05T00:00:00.000Z';
let seedCounter = 0;

const runtimeLimitVector = (overrides: Partial<ResourceLimitVector> = {}): ResourceLimitVector => ({
  cpu_ms: 1_000,
  memory_mb: 512,
  pids: 32,
  fds: 64,
  workspace_bytes: 1_048_576,
  artifact_bytes: 1_048_576,
  timeout_ms: 30_000,
  output_limit_bytes: 100_000,
  run_output_limit_bytes: 500_000,
  ...overrides,
});

type ApprovedSpecContext = {
  project: { id: string };
  workItem: WorkItem;
  spec: Spec;
  specRevisionId: string;
};

type AutomationCommandTestService = AutomationCommandService & {
  listExecutionPackages(workItemId: string): Promise<ExecutionPackage[]>;
  listPlanRevisions(planId: string): Promise<PlanRevision[]>;
  ensurePlanDraftForApprovedSpec(
    workItemId: string,
    specRevisionId: string,
    automationPrecondition: AutomationPrecondition,
    idempotencyKey: string,
    generated: typeof generatedPlanDraft,
    generationArtifacts: ArtifactRef[],
  ): Promise<{ plan_id: string; plan_revision_id: string; status: 'created' | 'existing'; generated_payload_digest?: string }>;
  ensureExecutionPackageDraftsForPlanRevision(input: {
    planRevisionId: string;
    automationPrecondition: AutomationPrecondition;
    actorContext: { authenticatedActorId?: string; actorClass?: string; daemonIdentity?: string };
    idempotencyKey: string;
    generationKey?: string;
    regenerationApproval?: {
      supersededGenerationKey: string;
      supersededExecutionPackageSetId: string;
      supersedeCommandId: string;
    };
  }): Promise<{ execution_package_set_id: string; package_ids: string[]; status: 'created' | 'existing' }>;
  supersedeExecutionPackageGenerationRun(input: {
    planRevisionId: string;
    generationKey: string;
    expectedGenerationRunVersion: number;
    reason: string;
    evidenceRefs: ArtifactRef[];
    approvedBy: { actor_id: string; actor_class: 'human' | 'human_admin' };
    idempotencyKey: string;
  }): Promise<{
    execution_package_set_id: string;
    status: 'superseded';
    next_generation_key: string;
    supersede_command_id: string;
  }>;
  enqueueRunIfPackageStillReady(input: {
    packageId: string;
    expectedPackageVersion: number;
    automationPrecondition: AutomationPrecondition;
    idempotencyKey: string;
    actorContext: { authenticatedActorId?: string; actorClass?: string; daemonIdentity?: string };
    executorType: 'mock' | 'local_codex';
    workflowOnly: boolean;
    runtimeSafetyAttestation?: RuntimeSafetyAttestation;
  }): Promise<{ status: 'accepted'; run_session_id: string; execution_package_id: string }>;
};

class OverlapDetectingRepository extends InMemoryDeliveryRepository {
  delayActiveRunChecks = false;
  activeRunChecksInFlight = 0;
  maxActiveRunChecksInFlight = 0;

  override async findActiveRunSessionForPackage(executionPackageId: string) {
    this.activeRunChecksInFlight += 1;
    this.maxActiveRunChecksInFlight = Math.max(this.maxActiveRunChecksInFlight, this.activeRunChecksInFlight);
    try {
      if (this.delayActiveRunChecks) {
        await delay(25);
      }
      return await super.findActiveRunSessionForPackage(executionPackageId);
    } finally {
      this.activeRunChecksInFlight -= 1;
    }
  }
}

class HideCurrentPlanOnceRepository extends InMemoryDeliveryRepository {
  hideCurrentPlanForWorkItemId?: string;
  private hiddenCurrentPlan = false;

  override async getWorkItem(id: string) {
    const workItem = await super.getWorkItem(id);
    if (
      workItem !== undefined &&
      this.hideCurrentPlanForWorkItemId === id &&
      this.hiddenCurrentPlan === false
    ) {
      this.hiddenCurrentPlan = true;
      const { current_plan_id: _currentPlanId, ...withoutCurrentPlan } = workItem;
      return withoutCurrentPlan as WorkItem;
    }
    return workItem;
  }
}

const proxiedRepository = (initialRepository: DeliveryRepository): {
  proxy: DeliveryRepository;
  setTarget: (repository: DeliveryRepository) => void;
} => {
  let target = initialRepository;
  return {
    proxy: new Proxy({} as DeliveryRepository, {
      get: (_proxyTarget, property) => {
        const value = Reflect.get(target as object, property);
        return typeof value === 'function' ? value.bind(target) : value;
      },
      set: (_proxyTarget, property, value) => Reflect.set(target as object, property, value),
    }),
    setTarget: (repository) => {
      target = repository;
    },
  };
};

const createTestApp = async (
  repositoryOverride?: DeliveryRepository,
  runWorkerOverride: { kick: () => void; drainOnce: () => Promise<void> } = {
    kick: () => undefined,
    drainOnce: async () => undefined,
  },
): Promise<{ app: INestApplication; repository: DeliveryRepository; service: AutomationCommandTestService }> => {
  const repository = proxiedRepository(repositoryOverride ?? new InMemoryDeliveryRepository());

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DELIVERY_REPOSITORY)
      .useValue(repository.proxy)
      .overrideProvider(DELIVERY_RUN_WORKER)
      .useValue(runWorkerOverride)
      .compile();
    const app = moduleRef.createNestApplication({ rawBody: true });
    await app.init();

    const server = app.getHttpServer();
    const projectRouteProbe = await request(server).post('/projects').send({ name: 'route-probe' });
    const projectRepoRouteProbe =
      projectRouteProbe.status === 201
        ? await request(server)
            .post(`/projects/${projectRouteProbe.body.id}/repos`)
            .send({
              repo_id: 'route-probe-repo',
              name: 'route-probe',
              local_path: '/tmp/route-probe',
              base_commit_sha: 'route-probe-sha',
            })
        : { status: projectRouteProbe.status };
    const workItemRouteProbe =
      projectRepoRouteProbe.status === 201
        ? await request(server)
            .post('/work-items')
            .send({
              project_id: projectRouteProbe.body.id,
              kind: 'requirement',
              title: 'route-probe',
              goal: 'Verify Work Item route readiness.',
              success_criteria: ['Route is mounted and shares repository state.'],
              priority: 'P1',
              risk: 'low',
              owner_actor_id: actorOwner,
            })
        : { status: projectRepoRouteProbe.status };
    const publicAutomationRouteProbe = await request(server).post('/automation/manual-path-holds').send({});
    const internalAutomationRouteProbe = await request(server).get('/internal/automation/runtime-snapshot');
    const routeProbeStatuses = [
      projectRouteProbe.status,
      projectRepoRouteProbe.status,
      workItemRouteProbe.status,
      publicAutomationRouteProbe.status,
      internalAutomationRouteProbe.status,
    ];
    if (
      routeProbeStatuses[0] === 201 &&
      routeProbeStatuses[1] === 201 &&
      routeProbeStatuses[2] === 201 &&
      routeProbeStatuses[3] === 400 &&
      routeProbeStatuses[4] === 401
    ) {
      if (repositoryOverride === undefined) {
        repository.setTarget(new InMemoryDeliveryRepository());
      }
      const automationCommandService = app.get(AutomationCommandService);
      const executionPackageService = app.get(ExecutionPackageService);
      const specPlanService = app.get(SpecPlanService);
      return {
        app,
        repository: app.get(DELIVERY_REPOSITORY) as DeliveryRepository,
        service: Object.assign(automationCommandService, {
          listExecutionPackages: executionPackageService.listExecutionPackages.bind(executionPackageService),
          listPlanRevisions: specPlanService.listPlanRevisions.bind(specPlanService),
        }),
      };
    }

    await app.close();
    if (!routeProbeStatuses.includes(404)) {
      throw new Error(`Unexpected automation command route probe statuses ${routeProbeStatuses.join(',')}`);
    }
  }

  throw new Error('Timed out waiting for automation command test routes to mount');
};

const signedAutomationPost = (app: INestApplication, pathAndQuery: string, body: Record<string, unknown>) => {
  const rawBody = JSON.stringify(body);
  const headers = signAutomationRequest({
    method: 'POST',
    pathAndQuery,
    rawBody,
    actorId: automationActorId,
    actorClass: 'automation_daemon',
    daemonIdentity: automationDaemonIdentity,
    timestamp: new Date().toISOString(),
    secret: automationSecret,
  });

  return request(app.getHttpServer())
    .post(pathAndQuery)
    .set(headers)
    .set('Content-Type', 'application/json')
    .send(rawBody);
};

const signedAutomationGet = (app: INestApplication, pathAndQuery: string) => {
  const headers = signAutomationRequest({
    method: 'GET',
    pathAndQuery,
    rawBody: Buffer.alloc(0),
    actorId: automationActorId,
    actorClass: 'automation_daemon',
    daemonIdentity: automationDaemonIdentity,
    timestamp: new Date().toISOString(),
    secret: automationSecret,
  });

  return request(app.getHttpServer()).get(pathAndQuery).set(headers);
};

const nextSeedId = (prefix: string): string => `${prefix}-${++seedCounter}`;

const seedProjectRepo = async (
  repository: DeliveryRepository,
  project: Project,
  overrides: Partial<Omit<ProjectRepo, 'id' | 'project_id' | 'created_at' | 'updated_at'>> = {},
): Promise<ProjectRepo> => {
  const repoId = overrides.repo_id ?? 'repo-1';
  const projectRepo: ProjectRepo = {
    id: nextSeedId('project-repo'),
    repo_id: repoId,
    project_id: project.id,
    name: overrides.name ?? 'forgeloop',
    status: overrides.status ?? 'active',
    local_path: overrides.local_path ?? (await createWorkflowPolicyRepoRoot()),
    default_branch: overrides.default_branch ?? 'main',
    base_commit_sha: overrides.base_commit_sha ?? 'abc123',
    ...(overrides.org_id !== undefined ? { org_id: overrides.org_id } : {}),
    ...(overrides.remote_url !== undefined ? { remote_url: overrides.remote_url } : {}),
    created_at: automationTestNow,
    updated_at: automationTestNow,
  };
  await repository.saveProjectRepo(projectRepo);
  if (!project.repo_ids.includes(repoId)) {
    project.repo_ids.push(repoId);
    await repository.saveProject({ ...project, repo_ids: [...project.repo_ids], updated_at: automationTestNow });
  }
  return projectRepo;
};

const seedProjectRepoWorkItem = async (app: INestApplication): Promise<{ project: { id: string }; workItem: WorkItem }> => {
  const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
  await repository.saveOrganization({
    id: 'org-automation-command-tests',
    name: 'Automation Command Tests',
    created_at: automationTestNow,
    updated_at: automationTestNow,
  });
  await repository.saveActor({
    id: actorOwner,
    org_id: 'org-automation-command-tests',
    display_name: 'Owner',
    actor_type: 'human',
    created_at: automationTestNow,
    updated_at: automationTestNow,
  });
  const project: Project = {
    id: nextSeedId('project'),
    name: 'Forgeloop',
    repo_ids: [],
    owner_actor_id: actorOwner,
    created_at: automationTestNow,
    updated_at: automationTestNow,
  };
  await repository.saveProject(project);
  await seedProjectRepo(repository, project);

  const workItem = transitionWorkItem(undefined, {
    type: 'create',
    id: nextSeedId('work-item'),
    project_id: project.id,
    kind: 'requirement',
    title: 'Ship automation plan drafts',
    goal: 'Generate plan drafts only after PRD approval.',
    success_criteria: ['Duplicate automation commands produce one plan draft.'],
    priority: 'P0',
    risk: 'medium',
    owner_actor_id: actorOwner,
    at: automationTestNow,
  });
  await repository.saveWorkItem(workItem);

  return { project, workItem };
};

const seedApprovedSpec = async (app: INestApplication): Promise<ApprovedSpecContext> => {
  const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
  const { project, workItem } = await seedProjectRepoWorkItem(app);
  const specRevisionId = nextSeedId('spec-revision');
  const createdSpec = transitionSpecPlan(undefined, {
    type: 'create',
    entity_type: 'spec',
    id: nextSeedId('spec'),
    work_item_id: workItem.id,
    at: automationTestNow,
  }) as Spec;
  const submittedSpec = transitionSpecPlan(createdSpec, { type: 'submit_for_approval', at: automationTestNow }) as Spec;
  const approvedSpec = transitionSpecPlan(submittedSpec, { type: 'approve', at: automationTestNow }) as Spec;
  const spec: Spec = {
    ...approvedSpec,
    current_revision_id: specRevisionId,
    approved_revision_id: specRevisionId,
    approved_at: automationTestNow,
    approved_by_actor_id: actorReviewer,
  };
  const specRevision: SpecRevision = {
    id: specRevisionId,
    spec_id: spec.id,
    work_item_id: workItem.id,
    revision_number: 1,
    summary: 'Approved automation command spec',
    content: 'Spec body',
    background: 'Automation command tests',
    goals: ['Generate deterministic automation command fixtures'],
    scope_in: ['Automation command boundary behavior'],
    scope_out: ['Product route behavior'],
    acceptance_criteria: ['Automation commands respect approved specs'],
    risk_notes: [],
    test_strategy_summary: 'Vitest automation command coverage',
    artifact_refs: [],
    created_at: automationTestNow,
  };
  const submittedWorkItem = transitionWorkItem(workItem, { type: 'submit_spec', at: automationTestNow });
  const approvedWorkItem = transitionWorkItem(submittedWorkItem, { type: 'approve_spec', at: automationTestNow });
  const updatedWorkItem: WorkItem = {
    ...approvedWorkItem,
    current_spec_id: spec.id,
    current_spec_revision_id: specRevision.id,
    updated_at: automationTestNow,
  };
  await repository.saveSpec(spec);
  await repository.saveSpecRevision(specRevision);
  await repository.saveWorkItem(updatedWorkItem);

  return { project, workItem: updatedWorkItem, spec, specRevisionId };
};

const seedApprovedPlan = async (app: INestApplication): Promise<ApprovedSpecContext & { plan: Plan; planRevisionId: string }> => {
  const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
  const ctx = await seedApprovedSpec(app);
  const planRevisionId = nextSeedId('plan-revision');
  const createdPlan = transitionSpecPlan(undefined, {
    type: 'create',
    entity_type: 'plan',
    id: nextSeedId('plan'),
    work_item_id: ctx.workItem.id,
    at: automationTestNow,
  }) as Plan;
  const submittedPlan = transitionSpecPlan(createdPlan, { type: 'submit_for_approval', at: automationTestNow }) as Plan;
  const approvedPlan = transitionSpecPlan(submittedPlan, { type: 'approve', at: automationTestNow }) as Plan;
  const plan: Plan = {
    ...approvedPlan,
    current_revision_id: planRevisionId,
    approved_revision_id: planRevisionId,
    approved_at: automationTestNow,
    approved_by_actor_id: actorReviewer,
  };
  const planRevision: PlanRevision = {
    id: planRevisionId,
    plan_id: plan.id,
    work_item_id: ctx.workItem.id,
    revision_number: 1,
    summary: 'Approved automation command plan',
    content: 'Plan body',
    implementation_summary: 'Exercise automation command boundaries.',
    split_strategy: 'Single automation command fixture.',
    dependency_order: [],
    test_matrix: ['pnpm vitest run tests/api/automation-commands.test.ts'],
    risk_mitigations: [],
    rollback_notes: 'Discard fixture records.',
    based_on_spec_revision_id: ctx.specRevisionId,
    artifact_refs: [],
    created_at: automationTestNow,
  };
  const submittedWorkItem = transitionWorkItem(ctx.workItem, { type: 'submit_plan', at: automationTestNow });
  const approvedWorkItem = transitionWorkItem(submittedWorkItem, { type: 'approve_plan', at: automationTestNow });
  const updatedWorkItem: WorkItem = {
    ...approvedWorkItem,
    current_plan_id: plan.id,
    current_plan_revision_id: planRevision.id,
    updated_at: automationTestNow,
  };
  await repository.savePlan(plan);
  await repository.savePlanRevision(planRevision);
  await repository.saveWorkItem(updatedWorkItem);

  return { ...ctx, workItem: updatedWorkItem, plan, planRevisionId };
};

const runtimeSafetyAttestation = (
  overrides: Partial<RuntimeSafetyAttestation> = {},
): RuntimeSafetyAttestation => ({
  attestation_scope: 'enqueue_preflight',
  hard_limit_mode: 'test_only_mock',
  environment: 'test',
  executor_type: 'mock',
  workflow_only: true,
  governor_id: 'test-governor',
  governor_provenance: 'test_only_mock',
  checked_at: '2026-05-05T00:31:00.000Z',
  max_command_timeout_ms: 120_000,
  max_hook_timeout_ms: 30_000,
  max_command_output_bytes: 1_000_000,
  max_run_output_bytes: 5_000_000,
  supports_cpu_limit: false,
  supports_memory_limit: false,
  supports_process_limit: false,
  supports_fd_limit: false,
  supports_workspace_disk_limit: false,
  supports_artifact_size_limit: false,
  network_mode: 'disabled',
  project_id: 'project-1',
  repo_id: 'repo-1',
  execution_package_id: 'execution-package-1',
  expected_package_version: 1,
  policy_digest: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
  policy_snapshot_version: 1,
  env_policy_digest: 'sha256:2222222222222222222222222222222222222222222222222222222222222222',
  command_policy_digest: 'sha256:3333333333333333333333333333333333333333333333333333333333333333',
  mount_policy_digest: 'sha256:4444444444444444444444444444444444444444444444444444444444444444',
  network_policy_digest: 'network-disabled',
  resource_limit_digest: resourceLimitDigest(runtimeLimitVector()),
  resource_limits: runtimeLimitVector(),
  sandbox_id: 'sandbox-1',
  sandbox_version: 'test-sandbox@1',
  sandbox_binary_digest: 'sandbox-binary-digest-1',
  sandbox_config_digest: 'sandbox-config-digest-1',
  sandbox_wrapper_environment_digest: 'sandbox-wrapper-env-digest-1',
  supports_filesystem_containment: true,
  supports_host_secret_isolation: true,
  supports_network_policy: true,
  supports_wrapper_env_isolation: true,
  supports_process_tree_kill: true,
  expires_at: '2026-05-05T00:36:00.000Z',
  ...overrides,
});

const runtimeSafetyAttestationForPackage = (
  executionPackage: ExecutionPackage,
  overrides: Partial<RuntimeSafetyAttestation> = {},
): RuntimeSafetyAttestation =>
  runtimeSafetyAttestation({
    project_id: executionPackage.project_id,
    repo_id: executionPackage.repo_id,
    execution_package_id: executionPackage.id,
    expected_package_version: executionPackage.version,
    policy_digest: executionPackage.package_policy_snapshot?.policy_digest,
    policy_snapshot_version: executionPackage.policy_snapshot_version,
    env_policy_digest: executionPackage.package_policy_snapshot?.env_policy_digest,
    command_policy_digest: executionPackage.package_policy_snapshot?.command_policy_digest,
    mount_policy_digest: executionPackage.package_policy_snapshot?.mount_policy_digest,
    network_policy_digest: executionPackage.package_policy_snapshot?.network_policy_digest,
    ...overrides,
  });

type ClaimedPlanDraftActionContext = ApprovedSpecContext & {
  precondition: AutomationPrecondition;
  actionId: string;
  claimToken: string;
  commandBody: Record<string, unknown>;
};

type ClaimedSpecDraftActionContext = {
  project: { id: string };
  workItem: WorkItem;
  precondition: AutomationPrecondition;
  actionId: string;
  claimToken: string;
  commandBody: Record<string, unknown>;
};

type ClaimedPackageDraftActionContext = ApprovedSpecContext & {
  plan: Plan;
  planRevisionId: string;
  precondition: AutomationPrecondition;
  actionId: string;
  claimToken: string;
  commandBody: Record<string, unknown>;
};

type ClaimedManualPathActionContext = {
  project: { id: string };
  workItem: WorkItem;
  precondition: AutomationPrecondition;
  actionId: string;
  claimToken: string;
  commandBody: Record<string, unknown>;
};

const planDraftActionBody = (
  ctx: ApprovedSpecContext,
  precondition: AutomationPrecondition,
  actionId: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  id: actionId,
  action_type: 'ensure_plan_draft',
  target_object_type: 'work_item',
  target_object_id: ctx.workItem.id,
  target_revision_id: ctx.specRevisionId,
  target_status: 'approved',
  idempotency_key: `${actionId}-idempotency`,
  automation_scope: precondition.automation_scope,
  automation_settings_version: precondition.automation_settings_version,
  capability_fingerprint: precondition.capability_fingerprint,
  precondition_fingerprint: automationPreconditionFingerprint(precondition),
  action_input_json: {
    work_item_id: ctx.workItem.id,
    spec_revision_id: ctx.specRevisionId,
  },
  ...overrides,
});

const packageDraftActionBody = (
  ctx: ApprovedSpecContext & { planRevisionId: string },
  precondition: AutomationPrecondition,
  actionId: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => {
  const generationKey = `default:${ctx.planRevisionId}`;
  return {
    id: actionId,
    action_type: 'ensure_package_drafts',
    target_object_type: 'plan_revision',
    target_object_id: ctx.planRevisionId,
    target_revision_id: generationKey,
    target_status: 'approved',
    idempotency_key: `${actionId}-idempotency`,
    automation_scope: precondition.automation_scope,
    automation_settings_version: precondition.automation_settings_version,
    capability_fingerprint: precondition.capability_fingerprint,
    precondition_fingerprint: automationPreconditionFingerprint(precondition),
    action_input_json: {
      plan_revision_id: ctx.planRevisionId,
      generation_key: generationKey,
    },
    ...overrides,
  };
};

const generatedSpecDraft = {
  schema_version: 'spec_draft.v1',
  summary: 'Generated spec summary',
  content: 'Generated spec content',
  background: 'Generated background',
  goals: ['Goal 1'],
  scope_in: ['Scope in'],
  scope_out: ['Scope out'],
  acceptance_criteria: ['Criterion 1'],
  risk_notes: ['Risk 1'],
  test_strategy_summary: 'Run API and daemon tests.',
  structured_document: { source: 'test' },
};

const generatedPlanDraft = {
  schema_version: 'plan_draft.v1',
  summary: 'Generated Plan summary',
  content: 'Generated Plan content',
  implementation_summary: 'Implement the approved Spec through automation command boundaries.',
  split_strategy: 'Create one API package and one test package.',
  dependency_order: ['api', 'tests'],
  test_matrix: ['pnpm test tests/api', 'pnpm test tests/automation'],
  risk_mitigations: ['Keep the generated Plan draft scoped to draft creation.'],
  rollback_notes: 'Discard the generated Plan draft.',
  structured_document: { source: 'generated-plan-test' },
};

const generationArtifacts: ArtifactRef[] = [
  {
    kind: 'raw_metadata',
    name: 'raw-spec-output',
    content_type: 'application/json',
    local_ref: 'artifact://spec/raw-output.json',
  },
];

const planGenerationArtifacts: ArtifactRef[] = [
  {
    kind: 'logs',
    name: 'plan-generation.json',
    content_type: 'application/json',
    storage_uri: 'artifact://plan-generation.json',
    digest: 'sha256:plan-generation',
  },
];

const testStableJson = (value: unknown): string => {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => testStableJson(entry)).join(',')}]`;
  }
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${testStableJson(entry)}`)
    .join(',')}}`;
};

const testStripUndefined = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((entry) => testStripUndefined(entry));
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .map(([key, entry]) => [key, testStripUndefined(entry)]),
    );
  }
  return value;
};

const testGeneratedPayloadDigest = (value: unknown): string =>
  `sha256:${createHash('sha256').update(testStableJson(testStripUndefined(value))).digest('hex')}`;

const testPublicArtifactIdentity = (artifacts: ArtifactRef[]): Array<Record<string, unknown>> =>
  artifacts.map((artifact) =>
    testStripUndefined({
      kind: artifact.kind,
      name: artifact.name,
      content_type: artifact.content_type,
      storage_uri: artifact.storage_uri,
      digest: artifact.digest,
    }) as Record<string, unknown>,
  );

const testPlanCommandPrecondition = (
  precondition: AutomationPrecondition,
  generated: typeof generatedPlanDraft,
  artifacts: ArtifactRef[],
): { json: Record<string, unknown>; fingerprint: string } => {
  const generatedPayloadDigest = testGeneratedPayloadDigest({
    generated_plan_draft: generated,
    generation_artifacts: testPublicArtifactIdentity(artifacts),
  });
  const json = {
    automation_precondition: precondition,
    generated_payload_digest: generatedPayloadDigest,
    generation_artifact_identity: testPublicArtifactIdentity(artifacts),
  };
  return {
    json,
    fingerprint: testGeneratedPayloadDigest(json),
  };
};

const specDraftActionBody = (
  ctx: { project: { id: string }; workItem: WorkItem },
  precondition: AutomationPrecondition,
  actionId: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  id: actionId,
  action_type: 'ensure_spec_draft',
  target_object_type: 'work_item',
  target_object_id: ctx.workItem.id,
  target_status: ctx.workItem.phase,
  idempotency_key: `${actionId}-idempotency`,
  automation_scope: precondition.automation_scope,
  automation_settings_version: precondition.automation_settings_version,
  capability_fingerprint: precondition.capability_fingerprint,
  precondition_fingerprint: automationPreconditionFingerprint(precondition),
  action_input_json: {
    work_item_id: ctx.workItem.id,
  },
  ...overrides,
});

const manualPathActionBody = (
  ctx: { project: { id: string }; workItem: WorkItem },
  precondition: AutomationPrecondition,
  actionId: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => {
  const scopeKey = buildManualScopeKey({ object_type: 'work_item', object_id: ctx.workItem.id });
  return {
    id: actionId,
    action_type: 'request_manual_path',
    target_object_type: 'work_item',
    target_object_id: ctx.workItem.id,
    target_status: 'blocked',
    idempotency_key: `${actionId}-idempotency`,
    automation_scope: precondition.automation_scope,
    automation_settings_version: precondition.automation_settings_version,
    capability_fingerprint: precondition.capability_fingerprint,
    precondition_fingerprint: automationPreconditionFingerprint(precondition),
    action_input_json: {
      object_type: 'work_item',
      object_id: ctx.workItem.id,
      scope_key: scopeKey,
      reason_code: 'needs_human_triage',
      reason: 'Automation stopped for human triage.',
    },
    ...overrides,
  };
};

const seedClaimedSpecDraftAction = async (
  app: INestApplication,
  repository: DeliveryRepository,
  overrides: Record<string, unknown> = {},
): Promise<ClaimedSpecDraftActionContext> => {
  const ctx = await seedProjectRepoWorkItem(app);
  const settings = await repository.setAutomationProjectSettings({
    id: `automation-settings-spec-claim-binding-${overrides.id ?? 'default'}`,
    project_id: ctx.project.id,
    repo_id: 'repo-1',
    scope_type: 'repo',
    preset: 'draft_only',
    expected_version: 0,
    reason: 'enable Spec draft claim binding test',
    evidence_refs: [],
    actor: { actor_id: actorOwner, actor_class: 'human_admin' },
    now: '2026-05-05T00:00:00.000Z',
  });
  const precondition: AutomationPrecondition = {
    automation_scope: `repo:${ctx.project.id}:repo-1`,
    project_id: ctx.project.id,
    repo_id: 'repo-1',
    automation_settings_version: settings.version,
    capability_fingerprint: settings.capability_fingerprint,
    required_capability: 'canGenerateSpecDraft',
    actor_class: 'automation_daemon',
    daemon_identity: automationDaemonIdentity,
  };
  const actionId = typeof overrides.id === 'string' ? overrides.id : `action-spec-claim-binding-${ctx.workItem.id}`;
  await signedAutomationPost(app, '/internal/automation/actions', specDraftActionBody(ctx, precondition, actionId, overrides)).expect(201);
  const claimToken = `claim-${actionId}`;
  await signedAutomationPost(app, '/internal/automation/actions:claim-next', {
    claim_token: claimToken,
    lease_ms: 10 * 60 * 1000,
    limit: 1,
  }).expect(200);

  return {
    ...ctx,
    precondition,
    actionId,
    claimToken,
    commandBody: {
      action_run_id: actionId,
      claim_token: claimToken,
      idempotency_key: `${actionId}-idempotency`,
      automation_precondition: precondition,
      generated_spec_draft: generatedSpecDraft,
      generation_artifacts: generationArtifacts,
    },
  };
};

const seedCompletedPolicyProjectionAction = async (
  repository: DeliveryRepository,
  ctx: Pick<ClaimedSpecDraftActionContext, 'project' | 'precondition'>,
): Promise<void> => {
  const actionId = `projection-${ctx.project.id}`;
  const idempotencyKey = `${actionId}-idempotency`;
  const claimToken = `${actionId}-claim`;
  const projectionInput = {
    repo_id: 'repo-1',
    policy_status: 'loaded',
    policy_digest: 'sha256:workflow-policy-digest',
    parser_version: 'workflow-md-parser:v1',
  };
  await repository.claimAutomationActionRun({
    id: actionId,
    action_type: 'project_runtime_snapshot',
    target_object_type: 'repo',
    target_object_id: 'repo-1',
    target_status: 'loaded',
    idempotency_key: idempotencyKey,
    automation_scope: ctx.precondition.automation_scope,
    automation_settings_version: ctx.precondition.automation_settings_version,
    capability_fingerprint: ctx.precondition.capability_fingerprint,
    precondition_fingerprint: `${actionId}-precondition`,
    action_input_json: projectionInput,
    claim_token: claimToken,
    locked_until: '2026-05-05T00:10:00.000Z',
    now: '2026-05-05T00:00:00.000Z',
  });
  await repository.completeAutomationActionRun({
    id: actionId,
    idempotency_key: idempotencyKey,
    claim_token: claimToken,
    status: 'succeeded',
    result_json: projectionInput,
    finished_at: '2026-05-05T00:00:01.000Z',
  });
};

const seedClaimedPlanDraftAction = async (
  app: INestApplication,
  repository: DeliveryRepository,
  overrides: Record<string, unknown> = {},
  claimOverrides: Record<string, unknown> = {},
): Promise<ClaimedPlanDraftActionContext> => {
  const ctx = await seedApprovedSpec(app);
  const settings = await repository.setAutomationProjectSettings({
    id: `automation-settings-claim-binding-${overrides.id ?? 'default'}`,
    project_id: ctx.project.id,
    repo_id: 'repo-1',
    scope_type: 'repo',
    preset: 'draft_only',
    expected_version: 0,
    reason: 'enable plan draft claim binding test',
    evidence_refs: [],
    actor: { actor_id: actorOwner, actor_class: 'human_admin' },
    now: '2026-05-05T00:00:00.000Z',
  });
  const precondition: AutomationPrecondition = {
    automation_scope: `repo:${ctx.project.id}:repo-1`,
    project_id: ctx.project.id,
    repo_id: 'repo-1',
    automation_settings_version: settings.version,
    capability_fingerprint: settings.capability_fingerprint,
    required_capability: 'canGeneratePlanDraft',
    actor_class: 'automation_daemon',
    daemon_identity: automationDaemonIdentity,
  };
  const actionId = typeof overrides.id === 'string' ? overrides.id : `action-claim-binding-${ctx.workItem.id}`;
  const actionBody = planDraftActionBody(ctx, precondition, actionId, overrides);
  await signedAutomationPost(app, '/internal/automation/actions', actionBody).expect(201);
  const claimToken = `claim-${actionId}`;
  await signedAutomationPost(app, '/internal/automation/actions:claim-next', {
    claim_token: claimToken,
    lease_ms: 10 * 60 * 1000,
    limit: 1,
    ...claimOverrides,
  }).expect(200);

  return {
    ...ctx,
    precondition,
    actionId,
    claimToken,
    commandBody: {
      action_run_id: actionId,
      claim_token: claimToken,
      spec_revision_id: ctx.specRevisionId,
      idempotency_key: `${actionId}-idempotency`,
      automation_precondition: precondition,
      generated_plan_draft: generatedPlanDraft,
      generation_artifacts: planGenerationArtifacts,
    },
  };
};

const seedApprovedSpecAndClaimedPlanAction = async (
  app: INestApplication,
  repository: DeliveryRepository,
  overrides: { approvedRevisionId?: string; actionOverrides?: Record<string, unknown> } = {},
): Promise<ClaimedPlanDraftActionContext> => {
  const ctx = await seedClaimedPlanDraftAction(app, repository, overrides.actionOverrides);
  if ('approvedRevisionId' in overrides) {
    await repository.saveSpec({
      ...ctx.spec,
      approved_revision_id: overrides.approvedRevisionId,
    });
  }
  return ctx;
};

const seedClaimedPackageDraftAction = async (
  app: INestApplication,
  repository: DeliveryRepository,
  overrides: Record<string, unknown> = {},
): Promise<ClaimedPackageDraftActionContext> => {
  const ctx = await seedApprovedPlan(app);
  const settings = await repository.setAutomationProjectSettings({
    id: `automation-settings-package-claim-binding-${overrides.id ?? 'default'}`,
    project_id: ctx.project.id,
    repo_id: 'repo-1',
    scope_type: 'repo',
    preset: 'draft_only',
    expected_version: 0,
    reason: 'enable package draft claim binding test',
    evidence_refs: [],
    actor: { actor_id: actorOwner, actor_class: 'human_admin' },
    now: '2026-05-05T00:00:00.000Z',
  });
  const precondition: AutomationPrecondition = {
    automation_scope: `repo:${ctx.project.id}:repo-1`,
    project_id: ctx.project.id,
    repo_id: 'repo-1',
    automation_settings_version: settings.version,
    capability_fingerprint: settings.capability_fingerprint,
    required_capability: 'canGeneratePackageDrafts',
    actor_class: 'automation_daemon',
    daemon_identity: automationDaemonIdentity,
  };
  const actionId = typeof overrides.id === 'string' ? overrides.id : `action-package-claim-binding-${ctx.planRevisionId}`;
  const actionBody = packageDraftActionBody(ctx, precondition, actionId, overrides);
  await signedAutomationPost(app, '/internal/automation/actions', actionBody).expect(201);
  const claimToken = `claim-${actionId}`;
  await signedAutomationPost(app, '/internal/automation/actions:claim-next', {
    claim_token: claimToken,
    lease_ms: 10 * 60 * 1000,
    limit: 1,
  }).expect(200);

  return {
    ...ctx,
    precondition,
    actionId,
    claimToken,
    commandBody: {
      action_run_id: actionId,
      claim_token: claimToken,
      idempotency_key: `${actionId}-idempotency`,
      automation_precondition: precondition,
    },
  };
};

const seedClaimedManualPathAction = async (
  app: INestApplication,
  repository: DeliveryRepository,
  overrides: Record<string, unknown> = {},
): Promise<ClaimedManualPathActionContext> => {
  const ctx = await seedProjectRepoWorkItem(app);
  const settings = await repository.setAutomationProjectSettings({
    id: `automation-settings-manual-claim-binding-${overrides.id ?? 'default'}`,
    project_id: ctx.project.id,
    repo_id: 'repo-1',
    scope_type: 'repo',
    preset: 'draft_only',
    expected_version: 0,
    reason: 'enable manual path claim binding test',
    evidence_refs: [],
    actor: { actor_id: actorOwner, actor_class: 'human_admin' },
    now: '2026-05-05T00:00:00.000Z',
  });
  const precondition: AutomationPrecondition = {
    automation_scope: `repo:${ctx.project.id}:repo-1`,
    project_id: ctx.project.id,
    repo_id: 'repo-1',
    automation_settings_version: settings.version,
    capability_fingerprint: settings.capability_fingerprint,
    required_capability: 'canGeneratePlanDraft',
    actor_class: 'automation_daemon',
    daemon_identity: automationDaemonIdentity,
  };
  const actionId = typeof overrides.id === 'string' ? overrides.id : `action-manual-claim-binding-${ctx.workItem.id}`;
  const actionBody = manualPathActionBody(ctx, precondition, actionId, overrides);
  await signedAutomationPost(app, '/internal/automation/actions', actionBody).expect(201);
  const claimToken = `claim-${actionId}`;
  await signedAutomationPost(app, '/internal/automation/actions:claim-next', {
    claim_token: claimToken,
    lease_ms: 10 * 60 * 1000,
    limit: 1,
  }).expect(200);
  const scopeKey = buildManualScopeKey({ object_type: 'work_item', object_id: ctx.workItem.id });

  return {
    ...ctx,
    precondition,
    actionId,
    claimToken,
    commandBody: {
      action_run_id: actionId,
      claim_token: claimToken,
      object_type: 'work_item',
      object_id: ctx.workItem.id,
      scope_key: scopeKey,
      reason_code: 'needs_human_triage',
      reason: 'Automation stopped for human triage.',
      evidence_refs: [],
      requested_by: automationDaemonIdentity,
      idempotency_key: `${actionId}-idempotency`,
      automation_precondition: precondition,
    },
  };
};

const expectNoPlanDraftCommandWrites = async (
  service: AutomationCommandTestService,
  repository: DeliveryRepository,
  ctx: ClaimedPlanDraftActionContext,
): Promise<void> => {
  const workItem = await repository.getWorkItem(ctx.workItem.id);
  expect(workItem?.current_plan_id).toBeUndefined();
  await expect(service.listExecutionPackages(ctx.workItem.id)).resolves.toHaveLength(0);
  await expect(
    repository.listActiveManualPathHolds({
      object_type: 'work_item',
      object_id: ctx.workItem.id,
    }),
  ).resolves.toHaveLength(0);
};

const expectNoPackageDraftCommandWrites = async (service: AutomationCommandTestService, ctx: ClaimedPackageDraftActionContext): Promise<void> => {
  await expect(service.listExecutionPackages(ctx.workItem.id)).resolves.toHaveLength(0);
};

const expectNoManualPathCommandWrites = async (
  repository: DeliveryRepository,
  ctx: ClaimedManualPathActionContext,
): Promise<void> => {
  await expect(
    repository.listActiveManualPathHolds({
      object_type: 'work_item',
      object_id: ctx.workItem.id,
    }),
  ).resolves.toHaveLength(0);
};

describe('automation command boundaries', () => {
  const apps: INestApplication[] = [];

  beforeEach(() => {
    process.env.FORGELOOP_TRUSTED_ACTOR_HEADER_SECRET = automationSecret;
    process.env.FORGELOOP_AUTOMATION_TEST_NOW = automationTestNow;
  });

  afterEach(async () => {
    delete process.env.FORGELOOP_TRUSTED_ACTOR_HEADER_SECRET;
    delete process.env.FORGELOOP_AUTOMATION_TEST_NOW;
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it('serves product automation settings without old public automation routes', async () => {
    const { app } = await createTestApp();
    apps.push(app);
    const { project } = await seedProjectRepoWorkItem(app);

    await request(app.getHttpServer())
      .get(`/automation/projects/${project.id}/capabilities?repo_id=repo-1`)
      .set(humanAdminHeaders)
      .expect(200);

    const capabilityBody = {
      repo_id: 'repo-1',
      preset: 'draft_only',
      expected_version: 0,
      reason: 'old public automation route removal regression',
      evidence_refs: [],
      actor_context: { actor_id: actorOwner, actor_class: 'human_admin' },
    };
    const manualPathHoldBody = {
      object_type: 'work_item',
      object_id: 'work-item-old-route',
      scope_key: 'manual:work_item:work-item-old-route',
      reason_code: 'needs_human_triage',
      reason: 'old public automation route removal regression',
      evidence_refs: [],
      requested_by: 'test-reviewer',
      idempotency_key: 'old-public-delivery-manual-path-hold',
    };

    await request(app.getHttpServer()).get(`/p0/projects/${project.id}/automation/capabilities`).expect(404);
    await request(app.getHttpServer()).post(`/p0/projects/${project.id}/automation/capabilities`).send(capabilityBody).expect(404);
    await request(app.getHttpServer())
      .post(`/p0/projects/${project.id}/automation/capabilities:disable`)
      .send({ ...capabilityBody, reason: 'old public automation disable route removal regression' })
      .expect(404);
    await request(app.getHttpServer()).post('/p0/manual-path-holds').send(manualPathHoldBody).expect(404);
    await request(app.getHttpServer())
      .post('/p0/manual-path-holds/hold-old-route/resolve')
      .send({
        resolved_by: 'test-reviewer',
        resolution: 'resolved',
        reason: 'old public automation resolve route removal regression',
        evidence_refs: [],
        idempotency_key: 'old-public-delivery-manual-path-hold-resolve',
      })
      .expect(404);
  });

  it('rejects daemon actor capability updates and keeps production default off', async () => {
    const { app } = await createTestApp();
    apps.push(app);
    const { project } = await seedProjectRepoWorkItem(app);

    await request(app.getHttpServer())
      .post(`/automation/projects/${project.id}/capabilities`)
      .set(daemonHeaders)
      .send({
        repo_id: 'repo-1',
        preset: 'run_enqueue',
        expected_version: 0,
        reason: 'daemon attempt',
        evidence_refs: [],
        actor_context: { actor_id: 'daemon-1', actor_class: 'automation_daemon' },
      })
      .expect(403);

    const settings = await request(app.getHttpServer())
      .get(`/automation/projects/${project.id}/capabilities`)
      .query({ repo_id: 'repo-1' })
      .expect(200);

    expect(settings.body).toMatchObject({
      project_id: project.id,
      repo_id: 'repo-1',
      preset: 'off',
      version: 0,
      capabilities_json: {
        canProjectRuntimeState: false,
        canGeneratePlanDraft: false,
        canGeneratePackageDrafts: false,
        canEnqueueRuns: false,
      },
    });
  });

  it('disables product automation capabilities for a repo scope', async () => {
    const { app } = await createTestApp();
    apps.push(app);
    const { project } = await seedProjectRepoWorkItem(app);

    const enabled = await request(app.getHttpServer())
      .post(`/automation/projects/${project.id}/capabilities`)
      .set(humanAdminHeaders)
      .send({
        repo_id: 'repo-1',
        preset: 'draft_only',
        expected_version: 0,
        reason: 'enable draft automation before disable',
        evidence_refs: [],
        actor_context: { actor_id: actorOwner, actor_class: 'human_admin' },
      })
      .expect(201);

    const disabled = await request(app.getHttpServer())
      .post(`/automation/projects/${project.id}/capabilities:disable`)
      .set(humanAdminHeaders)
      .send({
        repo_id: 'repo-1',
        expected_version: enabled.body.version,
        reason: 'disable draft automation',
        evidence_refs: [],
        actor_context: { actor_id: actorOwner, actor_class: 'human_admin' },
      })
      .expect(201);

    expect(disabled.body).toMatchObject({
      project_id: project.id,
      repo_id: 'repo-1',
      preset: 'off',
      version: enabled.body.version + 1,
    });
  });

  it('rejects automation capability updates when body actor context does not match trusted headers', async () => {
    const { app } = await createTestApp();
    apps.push(app);
    const { project } = await seedProjectRepoWorkItem(app);

    await request(app.getHttpServer())
      .post(`/automation/projects/${project.id}/capabilities`)
      .set(daemonHeaders)
      .send({
        repo_id: 'repo-1',
        preset: 'run_enqueue',
        expected_version: 0,
        reason: 'spoofed body attempt',
        evidence_refs: [],
        actor_context: { actor_id: actorOwner, actor_class: 'human_admin' },
      })
      .expect(403);
  });

  it('preserves automation settings audit events after delivery service writes created earlier events', async () => {
    const { app, repository } = await createTestApp();
    apps.push(app);
    const { project } = await seedProjectRepoWorkItem(app);

    const settings = await request(app.getHttpServer())
      .post(`/automation/projects/${project.id}/capabilities`)
      .set(humanAdminHeaders)
      .send({
        repo_id: 'repo-1',
        preset: 'draft_only',
        expected_version: 0,
        reason: 'enable draft automation',
        evidence_refs: [],
        actor_context: { actor_id: actorOwner, actor_class: 'human_admin' },
      })
      .expect(201);

    await expect(repository.listObjectEvents(settings.body.id, 'automation_project_settings')).resolves.toEqual([
      expect.objectContaining({
        object_id: settings.body.id,
        event_type: 'automation_capabilities_updated',
      }),
    ]);
  });

  it('rejects automation actors, missing actor class headers, and body-only actors from delivery approval gates', async () => {
    const { app } = await createTestApp();
    apps.push(app);
    const { workItem } = await seedProjectRepoWorkItem(app);
    const server = app.getHttpServer();
    const createdSpec = (await request(server).post(`/work-items/${workItem.id}/specs`).send({}).expect(201)).body as Spec;
    await request(server).post(`/specs/${createdSpec.id}/generate-draft`).send({}).expect(201);
    await request(server)
      .post(`/specs/${createdSpec.id}/submit-for-approval`)
      .send({ actor_id: actorOwner })
      .expect(401);
    await request(server)
      .post(`/specs/${createdSpec.id}/submit-for-approval`)
      .set({ 'x-forgeloop-actor-id': actorOwner })
      .send({ actor_id: actorOwner })
      .expect(401);
    await request(server)
      .post(`/specs/${createdSpec.id}/submit-for-approval`)
      .set(daemonHeaders)
      .send({ actor_id: 'daemon-actor' })
      .expect(403);
    await request(server).post(`/specs/${createdSpec.id}/submit-for-approval`).set(humanAdminHeaders).send({ actor_id: actorOwner }).expect(201);

    await request(server)
      .post(`/specs/${createdSpec.id}/approve`)
      .set(daemonHeaders)
      .send({ actor_id: actorReviewer })
      .expect(403);
    await request(server)
      .post(`/specs/${createdSpec.id}/approve`)
      .set({ 'x-forgeloop-actor-id': 'daemon-actor' })
      .send({ actor_id: actorReviewer })
      .expect(401);
    await request(server)
      .post(`/specs/${createdSpec.id}/approve`)
      .send({ actor_id: actorReviewer })
      .expect(401);
  });

  it('keeps run enqueue disabled for daemon-facing automation planner and action API', async () => {
    const { app } = await createTestApp();
    apps.push(app);

    await signedAutomationGet(app, '/internal/automation/runtime-snapshot')
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({ run_enqueue_disabled_reason: 'run_enqueue_disabled_by_scope' });
      });

    await signedAutomationPost(app, '/internal/automation/actions', {
      id: 'action-run-enqueue-disabled',
      action_type: 'run_enqueue',
      target_object_type: 'execution_package',
      target_object_id: 'execution-package-1',
      target_status: 'ready',
      idempotency_key: 'action-run-enqueue-disabled-idempotency',
      automation_scope: 'repo:project-1:repo-1',
      automation_settings_version: 1,
      capability_fingerprint: 'capability-fingerprint-1',
      precondition_fingerprint: 'precondition-fingerprint-1',
      action_input_json: {
        execution_package_id: 'execution-package-1',
        expected_package_version: 1,
      },
    }).expect(400);
  });

  it('rejects request manual path actions with unsupported object types at the internal boundary', async () => {
    const { app } = await createTestApp();
    apps.push(app);

    await signedAutomationPost(app, '/internal/automation/actions', {
      id: 'action-manual-invalid-object-type',
      action_type: 'request_manual_path',
      target_object_type: 'work_item',
      target_object_id: 'work-item-1',
      target_status: 'blocked',
      idempotency_key: 'action-manual-invalid-object-type-idempotency',
      automation_scope: 'repo:project-1:repo-1',
      automation_settings_version: 1,
      capability_fingerprint: 'capability-fingerprint-1',
      precondition_fingerprint: 'precondition-fingerprint-1',
      action_input_json: {
        object_type: 'unsupported_object',
        object_id: 'work-item-1',
        scope_key: 'work_item:work-item-1',
        reason_code: 'needs_human_triage',
        reason: 'Automation stopped for human triage.',
      },
    }).expect(400);
  });

  it('creates and replays a Spec draft for a claimed automation action', async () => {
    const { app, repository } = await createTestApp();
    apps.push(app);
    const ctx = await seedClaimedSpecDraftAction(app, repository);

    const first = await signedAutomationPost(
      app,
      `/internal/automation/work-items/${ctx.workItem.id}/ensure-spec-draft`,
      ctx.commandBody,
    ).expect(201);
    const second = await signedAutomationPost(
      app,
      `/internal/automation/work-items/${ctx.workItem.id}/ensure-spec-draft`,
      ctx.commandBody,
    ).expect(201);

    expect(first.body).toMatchObject({ status: 'created' });
    expect(second.body).toMatchObject({
      status: 'existing',
      spec_id: first.body.spec_id,
      spec_revision_id: first.body.spec_revision_id,
    });
    const updatedWorkItem = await repository.getWorkItem(ctx.workItem.id);
    expect(updatedWorkItem?.current_spec_id).toBe(first.body.spec_id);
    const spec = await repository.getSpec(first.body.spec_id);
    expect(spec).toMatchObject({ work_item_id: ctx.workItem.id, current_revision_id: first.body.spec_revision_id });
    const revisions = await repository.listSpecRevisions(first.body.spec_id);
    expect(revisions).toHaveLength(1);
    expect(revisions[0]).toMatchObject({
      id: first.body.spec_revision_id,
      summary: generatedSpecDraft.summary,
      content: generatedSpecDraft.content,
      artifact_refs: generationArtifacts,
    });

    await signedAutomationGet(app, '/internal/automation/runtime-snapshot')
      .expect(200)
      .expect(({ body }) => {
        expect(JSON.stringify(body.recent_action_runs)).not.toContain('artifact://spec/raw-output.json');
      });
  });

  it('accepts claimed spec draft actions with generation prompt identity fields', async () => {
    const { app, repository } = await createTestApp();
    apps.push(app);
    const ctx = await seedProjectRepoWorkItem(app);
    const settings = await repository.setAutomationProjectSettings({
      id: 'automation-settings-versioned-spec-claim-binding',
      project_id: ctx.project.id,
      repo_id: 'repo-1',
      scope_type: 'repo',
      preset: 'draft_only',
      expected_version: 0,
      reason: 'enable versioned spec claim binding test',
      evidence_refs: [],
      actor: { actor_id: actorOwner, actor_class: 'human_admin' },
      now: '2026-05-05T00:00:00.000Z',
    });
    const precondition: AutomationPrecondition = {
      automation_scope: `repo:${ctx.project.id}:repo-1`,
      project_id: ctx.project.id,
      repo_id: 'repo-1',
      automation_settings_version: settings.version,
      capability_fingerprint: settings.capability_fingerprint,
      required_capability: 'canGenerateSpecDraft',
      actor_class: 'automation_daemon',
      daemon_identity: automationDaemonIdentity,
    };
    const actionId = 'action-versioned-spec-claim-binding';
    await signedAutomationPost(app, '/internal/automation/actions', specDraftActionBody(ctx, precondition, actionId, {
      action_input_json: {
        work_item_id: ctx.workItem.id,
        prompt_version: 'spec-draft.fake.v2',
        output_schema_version: 'spec_draft.v1',
      },
    })).expect(201);
    const claimToken = `claim-${actionId}`;
    await signedAutomationPost(app, '/internal/automation/actions:claim-next', {
      claim_token: claimToken,
      lease_ms: 10 * 60 * 1000,
      limit: 1,
    }).expect(200);
    const commandBody = {
      action_run_id: actionId,
      claim_token: claimToken,
      idempotency_key: `${actionId}-idempotency`,
      automation_precondition: precondition,
      generated_spec_draft: generatedSpecDraft,
      generation_artifacts: generationArtifacts,
    };

    await signedAutomationPost(app, `/internal/automation/work-items/${ctx.workItem.id}/ensure-spec-draft`, commandBody)
      .expect(201)
      .expect(({ body }) => {
        expect(body).toMatchObject({ status: 'created' });
      });
  });

  it('rejects Spec draft commands when the WorkItem already has a current Spec revision', async () => {
    const { app, repository } = await createTestApp();
    apps.push(app);
    const ctx = await seedClaimedSpecDraftAction(app, repository);
    const existingSpec = transitionSpecPlan(undefined, {
      type: 'create',
      entity_type: 'spec',
      id: 'existing-spec-for-command',
      work_item_id: ctx.workItem.id,
      at: automationTestNow,
    }) as Spec;
    const existingRevision: SpecRevision = {
      id: 'existing-spec-revision-for-command',
      spec_id: existingSpec.id,
      work_item_id: ctx.workItem.id,
      revision_number: 1,
      summary: 'Existing spec',
      content: 'Existing spec',
      background: 'Existing',
      goals: ['Existing'],
      scope_in: ['Existing'],
      scope_out: [],
      acceptance_criteria: ['Existing'],
      risk_notes: [],
      test_strategy_summary: 'Existing',
      artifact_refs: [],
      created_at: automationTestNow,
    };
    await repository.saveSpec({ ...existingSpec, current_revision_id: existingRevision.id });
    await repository.saveSpecRevision(existingRevision);
    await repository.saveWorkItem({
      ...ctx.workItem,
      current_spec_id: existingSpec.id,
      current_spec_revision_id: existingRevision.id,
      updated_at: automationTestNow,
    });

    await signedAutomationPost(
      app,
      `/internal/automation/work-items/${ctx.workItem.id}/ensure-spec-draft`,
      ctx.commandBody,
    ).expect(409);
  });

  it.each([
    {
      name: 'wrong required capability',
      preconditionOverride: { required_capability: 'canGeneratePlanDraft' },
    },
    {
      name: 'wrong claim token',
      bodyOverrides: { claim_token: 'claim-token-other' },
    },
    {
      name: 'wrong action type',
      actionOverrides: {
        action_type: 'ensure_plan_draft',
        target_revision_id: 'spec-revision-other',
        action_input_json: {
          work_item_id: 'work-item-other',
          spec_revision_id: 'spec-revision-other',
        },
      },
    },
    {
      name: 'wrong action input',
      actionOverrides: {
        action_input_json: { work_item_id: 'work-item-other' },
      },
    },
  ])('rejects Spec draft commands before writes for $name', async ({ actionOverrides = {}, bodyOverrides = {}, preconditionOverride = {} }) => {
    const { app, repository } = await createTestApp();
    apps.push(app);
    const ctx = await seedClaimedSpecDraftAction(app, repository, {
      id: `action-spec-reject-${String(actionOverrides.action_type ?? bodyOverrides.claim_token ?? preconditionOverride.required_capability ?? 'input').replace(/[^a-z0-9-]/gi, '-')}`,
      ...actionOverrides,
    });
    const precondition = { ...ctx.precondition, ...preconditionOverride };
    const body = {
      ...ctx.commandBody,
      automation_precondition: precondition,
      ...bodyOverrides,
    };

    const response = await signedAutomationPost(
      app,
      `/internal/automation/work-items/${ctx.workItem.id}/ensure-spec-draft`,
      body,
    );

    expect([400, 409, 422]).toContain(response.status);
    const workItemAfter = await repository.getWorkItem(ctx.workItem.id);
    expect(workItemAfter?.current_spec_id).toBeUndefined();
  });

  it('serves signed Spec draft generation context for a claimed action without exposing the claim token', async () => {
    const { app, repository } = await createTestApp();
    apps.push(app);
    const ctx = await seedClaimedSpecDraftAction(app, repository);
    const project = await repository.getProject(ctx.project.id);
    expect(project).toBeDefined();
    await seedProjectRepo(repository, project!, { repo_id: 'repo-2', name: 'secondary-repo' });
    await seedCompletedPolicyProjectionAction(repository, ctx);

    await signedAutomationGet(
      app,
      `/internal/automation/generation-context/work-items/${ctx.workItem.id}/spec-draft?action_run_id=${ctx.actionId}&claim_token=${ctx.claimToken}`,
    )
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          context_version: 'generation_context.work_item.v1',
          action_run_id: ctx.actionId,
          work_item: {
            id: ctx.workItem.id,
            project_id: ctx.workItem.project_id,
            title: ctx.workItem.title,
            goal: ctx.workItem.goal,
            success_criteria: ctx.workItem.success_criteria,
            risk: ctx.workItem.risk,
            priority: ctx.workItem.priority,
            kind: ctx.workItem.kind,
          },
          repos: [
            expect.objectContaining({
              project_id: ctx.workItem.project_id,
              repo_id: 'repo-1',
              default_branch: 'main',
              policy_status: 'loaded',
              policy_digest: 'sha256:workflow-policy-digest',
              parser_version: 'workflow-md-parser:v1',
            }),
          ],
        });
        expect(body.repos).toHaveLength(1);
        expect(JSON.stringify(body)).not.toContain(ctx.claimToken);
        expect(JSON.stringify(body)).not.toContain('repo-2');
      });
  });

  it('returns Plan generation context for an active claimed ensure_plan_draft action', async () => {
    const { app, repository } = await createTestApp();
    apps.push(app);
    const ctx = await seedApprovedSpecAndClaimedPlanAction(app, repository);
    const specRevision = await repository.getSpecRevision(ctx.specRevisionId);
    expect(specRevision).toBeDefined();
    await repository.saveSpecRevision({
      ...specRevision!,
      structured_document: { sections: ['goals', 'scope'] },
    });
    await seedCompletedPolicyProjectionAction(repository, ctx);

    await signedAutomationGet(
      app,
      `/internal/automation/generation-context/work-items/${ctx.workItem.id}/plan-draft?spec_revision_id=${ctx.specRevisionId}&action_run_id=${ctx.actionId}&claim_token=${ctx.claimToken}`,
    )
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          context_version: 'generation_context.plan.v1',
          action_run_id: ctx.actionId,
          work_item: { id: ctx.workItem.id },
          spec_revision: {
            id: ctx.specRevisionId,
            spec_id: ctx.spec.id,
            structured_document: { sections: ['goals', 'scope'] },
          },
          repos: [
            expect.objectContaining({
              project_id: ctx.workItem.project_id,
              repo_id: 'repo-1',
              default_branch: 'main',
              policy_status: 'loaded',
              policy_digest: 'sha256:workflow-policy-digest',
              parser_version: 'workflow-md-parser:v1',
            }),
          ],
        });
        expect(body.spec_revision).not.toHaveProperty('work_item_id');
        expect(body.spec_revision).not.toHaveProperty('artifact_refs');
        expect(JSON.stringify(body)).not.toContain(ctx.claimToken);
      });
  });

  it.each([
    { name: 'missing', approvedRevisionId: undefined },
    { name: 'stale', approvedRevisionId: 'spec-revision-stale' },
  ])('rejects Plan generation context when Spec approved_revision_id is $name', async ({ approvedRevisionId }) => {
    const { app, repository } = await createTestApp();
    apps.push(app);
    const ctx = await seedApprovedSpecAndClaimedPlanAction(app, repository, { approvedRevisionId });

    await signedAutomationGet(
      app,
      `/internal/automation/generation-context/work-items/${ctx.workItem.id}/plan-draft?spec_revision_id=${ctx.specRevisionId}&action_run_id=${ctx.actionId}&claim_token=${ctx.claimToken}`,
    ).expect(409);
  });

  it.each([
    { name: 'missing', targetRevisionId: undefined },
    { name: 'mismatched', targetRevisionId: 'spec-revision-other' },
  ])('rejects Plan generation context when action target_revision_id is $name', async ({ targetRevisionId }) => {
    const { app, repository } = await createTestApp();
    apps.push(app);
    const ctx = await seedApprovedSpecAndClaimedPlanAction(app, repository, {
      actionOverrides: {
        ...(targetRevisionId === undefined ? { target_revision_id: undefined } : { target_revision_id: targetRevisionId }),
      },
    });

    await signedAutomationGet(
      app,
      `/internal/automation/generation-context/work-items/${ctx.workItem.id}/plan-draft?spec_revision_id=${ctx.specRevisionId}&action_run_id=${ctx.actionId}&claim_token=${ctx.claimToken}`,
    ).expect(409);
  });

  it('returns Package generation context for an approved PlanRevision and active claim', async () => {
    const { app, repository } = await createTestApp();
    apps.push(app);
    const ctx = await seedClaimedPackageDraftAction(app, repository);
    const generationKey = `default:${ctx.planRevisionId}`;
    const planRevision = await repository.getPlanRevision(ctx.planRevisionId);
    expect(planRevision).toBeDefined();
    await repository.savePlanRevision({
      ...planRevision!,
      structured_document: { sections: ['split', 'tests'] },
    });
    await seedCompletedPolicyProjectionAction(repository, ctx);

    await signedAutomationGet(
      app,
      `/internal/automation/generation-context/plan-revisions/${ctx.planRevisionId}/package-drafts?generation_key=${generationKey}&action_run_id=${ctx.actionId}&claim_token=${ctx.claimToken}`,
    )
      .expect(200)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          context_version: 'generation_context.package.v1',
          action_run_id: ctx.actionId,
          generation_key: generationKey,
          work_item: { id: ctx.workItem.id },
          spec_revision: { id: ctx.specRevisionId, spec_id: ctx.spec.id },
          plan_revision: {
            id: ctx.planRevisionId,
            plan_id: ctx.plan.id,
            summary: 'Approved automation command plan',
            dependency_order: [],
            test_matrix: ['pnpm vitest run tests/api/automation-commands.test.ts'],
            structured_document: { sections: ['split', 'tests'] },
          },
          repos: [
            expect.objectContaining({
              project_id: ctx.workItem.project_id,
              repo_id: 'repo-1',
              default_branch: 'main',
              policy_status: 'loaded',
              policy_digest: 'sha256:workflow-policy-digest',
              parser_version: 'workflow-md-parser:v1',
            }),
          ],
        });
        expect(body.plan_revision).not.toHaveProperty('work_item_id');
        expect(body.plan_revision).not.toHaveProperty('artifact_refs');
        expect(JSON.stringify(body)).not.toContain(ctx.claimToken);
      });
  });

  it('rejects Package generation context when Plan approved_revision_id is stale', async () => {
    const { app, repository } = await createTestApp();
    apps.push(app);
    const ctx = await seedClaimedPackageDraftAction(app, repository);
    const generationKey = `default:${ctx.planRevisionId}`;
    await repository.savePlan({
      ...ctx.plan,
      approved_revision_id: 'plan-revision-stale',
    });

    await signedAutomationGet(
      app,
      `/internal/automation/generation-context/plan-revisions/${ctx.planRevisionId}/package-drafts?generation_key=${generationKey}&action_run_id=${ctx.actionId}&claim_token=${ctx.claimToken}`,
    ).expect(409);
  });

  it('rejects Spec draft generation context when the claim token is wrong', async () => {
    const { app, repository } = await createTestApp();
    apps.push(app);
    const ctx = await seedClaimedSpecDraftAction(app, repository);

    await signedAutomationGet(
      app,
      `/internal/automation/generation-context/work-items/${ctx.workItem.id}/spec-draft?action_run_id=${ctx.actionId}&claim_token=wrong-claim-token`,
    )
      .expect(409)
      .expect(({ body }) => {
        expect(body).toMatchObject({ code: 'automation_action_claim_conflict' });
      });
  });

  it('rejects Spec draft generation context for non-Spec actions', async () => {
    const { app, repository } = await createTestApp();
    apps.push(app);
    const ctx = await seedClaimedPlanDraftAction(app, repository);

    await signedAutomationGet(
      app,
      `/internal/automation/generation-context/work-items/${ctx.workItem.id}/spec-draft?action_run_id=${ctx.actionId}&claim_token=${ctx.claimToken}`,
    )
      .expect(409)
      .expect(({ body }) => {
        expect(body).toMatchObject({ code: 'automation_action_claim_conflict' });
      });
  });

  it('rejects Spec draft generation context when the requested WorkItem does not match the claim', async () => {
    const { app, repository } = await createTestApp();
    apps.push(app);
    const ctx = await seedClaimedSpecDraftAction(app, repository);

    await signedAutomationGet(
      app,
      `/internal/automation/generation-context/work-items/work-item-other/spec-draft?action_run_id=${ctx.actionId}&claim_token=${ctx.claimToken}`,
    )
      .expect(409)
      .expect(({ body }) => {
        expect(body).toMatchObject({ code: 'automation_action_claim_conflict' });
      });
  });

  it.each([
    {
      name: 'missing claim token',
      actionOverrides: {},
      bodyOverrides: { claim_token: undefined },
    },
    {
      name: 'expired claim token',
      actionOverrides: {},
      claimOverrides: { lease_ms: 1 },
      nowBeforeCommand: '2026-05-05T00:10:00.000Z',
    },
    {
      name: 'wrong action type',
      actionOverrides: {
        action_type: 'request_manual_path',
        action_input_json: {
          object_type: 'work_item',
          object_id: 'placeholder',
          scope_key: 'work_item:placeholder',
          reason_code: 'needs_human_triage',
          reason: 'Automation stopped for human triage.',
        },
      },
    },
    {
      name: 'wrong target',
      actionOverrides: { target_object_id: 'work-item-other' },
    },
    {
      name: 'wrong idempotency key',
      actionOverrides: { idempotency_key: 'wrong-action-idempotency-key' },
    },
    {
      name: 'wrong automation settings version',
      actionOverrides: { automation_settings_version: 999 },
    },
    {
      name: 'wrong capability fingerprint',
      actionOverrides: { capability_fingerprint: 'wrong-capability-fingerprint' },
    },
    {
      name: 'wrong precondition fingerprint',
      actionOverrides: { precondition_fingerprint: 'wrong-precondition-fingerprint' },
    },
    {
      name: 'wrong action_input_json',
      actionOverrides: {
        action_input_json: {
          work_item_id: 'work-item-other',
          spec_revision_id: 'spec-revision-other',
        },
      },
    },
  ])(
    'rejects internal plan draft commands before product writes when action claim binding has $name',
    async ({ actionOverrides, bodyOverrides = {}, claimOverrides = {}, nowBeforeCommand }) => {
      const { app, repository, service } = await createTestApp();
      apps.push(app);
      const ctx = await seedClaimedPlanDraftAction(
        app,
        repository,
        { id: `action-claim-binding-${String(actionOverrides.action_type ?? actionOverrides.target_object_id ?? actionOverrides.idempotency_key ?? actionOverrides.automation_settings_version ?? actionOverrides.capability_fingerprint ?? actionOverrides.precondition_fingerprint ?? 'default').replace(/[^a-z0-9-]/gi, '-')}`, ...actionOverrides },
        claimOverrides,
      );
      if (nowBeforeCommand !== undefined) {
        process.env.FORGELOOP_AUTOMATION_TEST_NOW = nowBeforeCommand;
      }
      const body = { ...ctx.commandBody, ...bodyOverrides };
      for (const [key, value] of Object.entries(body)) {
        if (value === undefined) {
          delete body[key];
        }
      }

      const response = await signedAutomationPost(
        app,
        `/internal/automation/work-items/${ctx.workItem.id}/ensure-plan-draft`,
        body,
      );

      expect([409, 422]).toContain(response.status);
      await expectNoPlanDraftCommandWrites(service, repository, ctx);
    },
  );

  it('accepts claimed plan draft commands with target-aware daemon preconditions', async () => {
    const { app, repository, service } = await createTestApp();
    apps.push(app);
    const ctx = await seedApprovedSpec(app);
    const settings = await repository.setAutomationProjectSettings({
      id: 'automation-settings-target-aware-claim-binding',
      project_id: ctx.project.id,
      repo_id: 'repo-1',
      scope_type: 'repo',
      preset: 'draft_only',
      expected_version: 0,
      reason: 'enable target-aware claim binding test',
      evidence_refs: [],
      actor: { actor_id: actorOwner, actor_class: 'human_admin' },
      now: '2026-05-05T00:00:00.000Z',
    });
    const precondition = {
      automation_scope: `repo:${ctx.project.id}:repo-1`,
      project_id: ctx.project.id,
      repo_id: 'repo-1',
      target_object_type: 'work_item',
      target_object_id: ctx.workItem.id,
      target_revision_id: ctx.specRevisionId,
      target_status: 'approved',
      automation_settings_version: settings.version,
      capability_fingerprint: settings.capability_fingerprint,
      required_capability: 'canGeneratePlanDraft',
      actor_class: 'automation_daemon',
    } as AutomationPrecondition;
    const actionId = `action-target-aware-claim-binding-${ctx.workItem.id}`;

    await signedAutomationPost(app, '/internal/automation/actions', planDraftActionBody(ctx, precondition, actionId)).expect(201);
    const claimToken = `claim-${actionId}`;
    await signedAutomationPost(app, '/internal/automation/actions:claim-next', {
      claim_token: claimToken,
      lease_ms: 10 * 60 * 1000,
      limit: 1,
    }).expect(200);

    await signedAutomationPost(app, `/internal/automation/work-items/${ctx.workItem.id}/ensure-plan-draft`, {
      action_run_id: actionId,
      claim_token: claimToken,
      spec_revision_id: ctx.specRevisionId,
      idempotency_key: `${actionId}-idempotency`,
      automation_precondition: precondition,
      generated_plan_draft: generatedPlanDraft,
      generation_artifacts: planGenerationArtifacts,
    }).expect(201);

    expect(await service.listPlanRevisions((await repository.getWorkItem(ctx.workItem.id))?.current_plan_id ?? '')).toHaveLength(1);
  });

  it('accepts claimed plan draft actions with generation prompt identity fields', async () => {
    const { app, repository, service } = await createTestApp();
    apps.push(app);
    const ctx = await seedApprovedSpec(app);
    const settings = await repository.setAutomationProjectSettings({
      id: 'automation-settings-versioned-plan-claim-binding',
      project_id: ctx.project.id,
      repo_id: 'repo-1',
      scope_type: 'repo',
      preset: 'draft_only',
      expected_version: 0,
      reason: 'enable versioned plan claim binding test',
      evidence_refs: [],
      actor: { actor_id: actorOwner, actor_class: 'human_admin' },
      now: '2026-05-05T00:00:00.000Z',
    });
    const precondition = {
      automation_scope: `repo:${ctx.project.id}:repo-1`,
      project_id: ctx.project.id,
      repo_id: 'repo-1',
      target_object_type: 'work_item',
      target_object_id: ctx.workItem.id,
      target_revision_id: ctx.specRevisionId,
      target_status: 'approved',
      automation_settings_version: settings.version,
      capability_fingerprint: settings.capability_fingerprint,
      required_capability: 'canGeneratePlanDraft',
      actor_class: 'automation_daemon',
    } as AutomationPrecondition;
    const actionId = `action-versioned-plan-claim-binding-${ctx.workItem.id}`;
    const actionInputJson = {
      work_item_id: ctx.workItem.id,
      spec_revision_id: ctx.specRevisionId,
      prompt_version: 'plan-draft.fake.v2',
      output_schema_version: 'plan_draft.v1',
    };

    await signedAutomationPost(
      app,
      '/internal/automation/actions',
      planDraftActionBody(ctx, precondition, actionId, { action_input_json: actionInputJson }),
    ).expect(201);
    const claimToken = `claim-${actionId}`;
    await signedAutomationPost(app, '/internal/automation/actions:claim-next', {
      claim_token: claimToken,
      lease_ms: 10 * 60 * 1000,
      limit: 1,
    }).expect(200);

    await signedAutomationPost(app, `/internal/automation/work-items/${ctx.workItem.id}/ensure-plan-draft`, {
      action_run_id: actionId,
      claim_token: claimToken,
      spec_revision_id: ctx.specRevisionId,
      idempotency_key: `${actionId}-idempotency`,
      automation_precondition: precondition,
      generated_plan_draft: generatedPlanDraft,
      generation_artifacts: planGenerationArtifacts,
    }).expect(201);

    expect(await service.listPlanRevisions((await repository.getWorkItem(ctx.workItem.id))?.current_plan_id ?? '')).toHaveLength(1);
  });

  it('daemon ensure-plan-draft requires generated Plan payload', async () => {
    const { app, repository } = await createTestApp();
    apps.push(app);
    const ctx = await seedApprovedSpecAndClaimedPlanAction(app, repository, {
      actionOverrides: { id: 'action-generated-plan-required' },
    });
    const { generated_plan_draft: _generatedPlanDraft, ...bodyWithoutGeneratedPlanDraft } = ctx.commandBody;

    await signedAutomationPost(
      app,
      `/internal/automation/work-items/${ctx.workItem.id}/ensure-plan-draft`,
      bodyWithoutGeneratedPlanDraft,
    ).expect(400);
  });

  it('persists generated Plan fields and generation artifacts', async () => {
    const { app, repository, service } = await createTestApp();
    apps.push(app);
    const ctx = await seedApprovedSpecAndClaimedPlanAction(app, repository, {
      actionOverrides: { id: 'action-generated-plan-persisted' },
    });

    await signedAutomationPost(app, `/internal/automation/work-items/${ctx.workItem.id}/ensure-plan-draft`, {
      ...ctx.commandBody,
      generated_plan_draft: {
        ...generatedPlanDraft,
        summary: 'Generated summary',
        structured_document: { sections: ['generated-plan'] },
      },
      generation_artifacts: planGenerationArtifacts,
    }).expect(201);

    const workItem = await repository.getWorkItem(ctx.workItem.id);
    const revisions = await service.listPlanRevisions(workItem?.current_plan_id ?? '');
    expect(revisions).toHaveLength(1);
    expect(revisions[0]).toMatchObject({
      summary: 'Generated summary',
      content: generatedPlanDraft.content,
      implementation_summary: generatedPlanDraft.implementation_summary,
      split_strategy: generatedPlanDraft.split_strategy,
      dependency_order: generatedPlanDraft.dependency_order,
      test_matrix: generatedPlanDraft.test_matrix,
      risk_mitigations: generatedPlanDraft.risk_mitigations,
      rollback_notes: generatedPlanDraft.rollback_notes,
      structured_document: { sections: ['generated-plan'] },
      artifact_refs: planGenerationArtifacts,
    });
  });

  it('blocks idempotency key reuse with a different generated Plan payload digest', async () => {
    const { app, repository } = await createTestApp();
    apps.push(app);
    const ctx = await seedApprovedSpecAndClaimedPlanAction(app, repository, {
      actionOverrides: { id: 'action-generated-plan-drift' },
    });
    const body = {
      ...ctx.commandBody,
      generated_plan_draft: generatedPlanDraft,
      generation_artifacts: planGenerationArtifacts,
    };

    await signedAutomationPost(app, `/internal/automation/work-items/${ctx.workItem.id}/ensure-plan-draft`, body).expect(201);
    await signedAutomationPost(app, `/internal/automation/work-items/${ctx.workItem.id}/ensure-plan-draft`, {
      ...body,
      generated_plan_draft: { ...generatedPlanDraft, summary: 'Generated Plan summary changed' },
    })
      .expect(409)
      .expect(({ body: responseBody }) => {
        expect(responseBody).toMatchObject({ code: 'generated_payload_idempotency_drift' });
      });
  });

  it('rejects generated Plan artifact refs with local paths before persistence', async () => {
    const { app, repository, service } = await createTestApp();
    apps.push(app);
    const ctx = await seedApprovedSpecAndClaimedPlanAction(app, repository, {
      actionOverrides: { id: 'action-generated-plan-local-artifact' },
    });

    await signedAutomationPost(app, `/internal/automation/work-items/${ctx.workItem.id}/ensure-plan-draft`, {
      ...ctx.commandBody,
      generated_plan_draft: generatedPlanDraft,
      generation_artifacts: [
        {
          kind: 'logs',
          name: 'raw-plan-output',
          content_type: 'application/json',
          local_ref: '/tmp/forgeloop/raw-plan-output.json',
        },
      ],
    })
      .expect(400)
      .expect(({ body }) => {
        expect(body).toMatchObject({ code: 'generation_artifact_unsafe' });
      });

    await expectNoPlanDraftCommandWrites(service, repository, ctx);
  });

  it.each(['artifact:///tmp/raw-plan-output.json', 'artifact:///Users/viv/raw-plan-output.json'])(
    'rejects generated Plan artifact storage URI that embeds a local path: %s',
    async (storageUri) => {
      const { app, repository, service } = await createTestApp();
      apps.push(app);
      const ctx = await seedApprovedSpecAndClaimedPlanAction(app, repository, {
        actionOverrides: { id: `action-generated-plan-local-uri-${storageUri.includes('tmp') ? 'tmp' : 'users'}` },
      });

      await signedAutomationPost(app, `/internal/automation/work-items/${ctx.workItem.id}/ensure-plan-draft`, {
        ...ctx.commandBody,
        generated_plan_draft: generatedPlanDraft,
        generation_artifacts: [
          {
            kind: 'logs',
            name: 'plan-generation.json',
            content_type: 'application/json',
            storage_uri: storageUri,
            digest: 'sha256:plan-generation',
          },
        ],
      })
        .expect(400)
        .expect(({ body }) => {
          expect(body).toMatchObject({ code: 'generation_artifact_unsafe' });
        });

      await expectNoPlanDraftCommandWrites(service, repository, ctx);
    },
  );

  it('rejects generated Plan payloads that fail runtime validation before persistence', async () => {
    const { app, repository, service } = await createTestApp();
    apps.push(app);
    const ctx = await seedApprovedSpecAndClaimedPlanAction(app, repository, {
      actionOverrides: { id: 'action-generated-plan-invalid-runtime-payload' },
    });

    await signedAutomationPost(app, `/internal/automation/work-items/${ctx.workItem.id}/ensure-plan-draft`, {
      ...ctx.commandBody,
      generated_plan_draft: {
        ...generatedPlanDraft,
        dependency_order: ['api', 'api'],
      },
      generation_artifacts: planGenerationArtifacts,
    })
      .expect(400)
      .expect(({ body }) => {
        expect(body).toMatchObject({ code: 'generated_plan_draft_invalid' });
      });

    await expectNoPlanDraftCommandWrites(service, repository, ctx);
  });

  it('includes generated payload digest when reusing an existing generated Plan revision', async () => {
    const { app, repository, service } = await createTestApp();
    apps.push(app);
    const ctx = await seedApprovedSpec(app);
    const settings = await repository.setAutomationProjectSettings({
      id: 'automation-settings-generated-plan-existing-digest',
      project_id: ctx.project.id,
      repo_id: 'repo-1',
      scope_type: 'repo',
      preset: 'draft_only',
      expected_version: 0,
      reason: 'enable generated plan existing digest test',
      evidence_refs: [],
      actor: { actor_id: actorOwner, actor_class: 'human_admin' },
      now: '2026-05-05T00:00:00.000Z',
    });
    const precondition = {
      automation_scope: `repo:${ctx.project.id}:repo-1`,
      project_id: ctx.project.id,
      repo_id: 'repo-1',
      automation_settings_version: settings.version,
      capability_fingerprint: settings.capability_fingerprint,
      required_capability: 'canGeneratePlanDraft',
      actor_class: 'automation_daemon',
      daemon_identity: automationDaemonIdentity,
    } as AutomationPrecondition;
    const automationService = service as AutomationCommandTestService;

    const first = await automationService.ensurePlanDraftForApprovedSpec(
      ctx.workItem.id,
      ctx.specRevisionId,
      precondition,
      'idem-plan-draft-existing-digest-first',
      generatedPlanDraft,
      planGenerationArtifacts,
    );
    const second = await automationService.ensurePlanDraftForApprovedSpec(
      ctx.workItem.id,
      ctx.specRevisionId,
      precondition,
      'idem-plan-draft-existing-digest-second',
      generatedPlanDraft,
      planGenerationArtifacts,
    );

    expect(second).toMatchObject({
      plan_revision_id: first.plan_revision_id,
      status: 'existing',
      generated_payload_digest: expect.stringMatching(/^sha256:/),
    });
  });

  it('includes generated payload digest when replaying the same generated Plan command idempotency key', async () => {
    const { app, repository } = await createTestApp();
    apps.push(app);
    const ctx = await seedApprovedSpecAndClaimedPlanAction(app, repository, {
      actionOverrides: { id: 'action-generated-plan-replay-digest' },
    });

    const first = await signedAutomationPost(
      app,
      `/internal/automation/work-items/${ctx.workItem.id}/ensure-plan-draft`,
      ctx.commandBody,
    ).expect(201);
    const replay = await signedAutomationPost(
      app,
      `/internal/automation/work-items/${ctx.workItem.id}/ensure-plan-draft`,
      ctx.commandBody,
    ).expect(201);

    expect(first.body).toMatchObject({ generated_payload_digest: expect.stringMatching(/^sha256:/) });
    expect(replay.body).toMatchObject({
      plan_revision_id: first.body.plan_revision_id,
      status: 'existing',
      generated_payload_digest: first.body.generated_payload_digest,
    });
  });

  it('includes generated payload digest when an existing Plan revision appears during attach', async () => {
    const repository = new HideCurrentPlanOnceRepository();
    const { app, service } = await createTestApp(repository);
    apps.push(app);
    const ctx = await seedApprovedSpec(app);
    const settings = await repository.setAutomationProjectSettings({
      id: 'automation-settings-generated-plan-race-digest',
      project_id: ctx.project.id,
      repo_id: 'repo-1',
      scope_type: 'repo',
      preset: 'draft_only',
      expected_version: 0,
      reason: 'enable generated plan race digest test',
      evidence_refs: [],
      actor: { actor_id: actorOwner, actor_class: 'human_admin' },
      now: '2026-05-05T00:00:00.000Z',
    });
    const precondition = {
      automation_scope: `repo:${ctx.project.id}:repo-1`,
      project_id: ctx.project.id,
      repo_id: 'repo-1',
      automation_settings_version: settings.version,
      capability_fingerprint: settings.capability_fingerprint,
      required_capability: 'canGeneratePlanDraft',
      actor_class: 'automation_daemon',
      daemon_identity: automationDaemonIdentity,
    } as AutomationPrecondition;
    const automationService = service as AutomationCommandTestService;
    const first = await automationService.ensurePlanDraftForApprovedSpec(
      ctx.workItem.id,
      ctx.specRevisionId,
      precondition,
      'idem-plan-draft-race-digest-first',
      generatedPlanDraft,
      planGenerationArtifacts,
    );
    repository.hideCurrentPlanForWorkItemId = ctx.workItem.id;

    const second = await automationService.ensurePlanDraftForApprovedSpec(
      ctx.workItem.id,
      ctx.specRevisionId,
      precondition,
      'idem-plan-draft-race-digest-second',
      generatedPlanDraft,
      planGenerationArtifacts,
    );

    expect(second).toMatchObject({
      plan_revision_id: first.plan_revision_id,
      status: 'existing',
      generated_payload_digest: expect.stringMatching(/^sha256:/),
    });
  });

  it('reports active generated Plan idempotency claims without labeling them as payload drift', async () => {
    const { app, repository, service } = await createTestApp();
    apps.push(app);
    const ctx = await seedApprovedSpec(app);
    const settings = await repository.setAutomationProjectSettings({
      id: 'automation-settings-generated-plan-active-command',
      project_id: ctx.project.id,
      repo_id: 'repo-1',
      scope_type: 'repo',
      preset: 'draft_only',
      expected_version: 0,
      reason: 'enable generated plan active command conflict test',
      evidence_refs: [],
      actor: { actor_id: actorOwner, actor_class: 'human_admin' },
      now: '2026-05-05T00:00:00.000Z',
    });
    const precondition = {
      automation_scope: `repo:${ctx.project.id}:repo-1`,
      project_id: ctx.project.id,
      repo_id: 'repo-1',
      automation_settings_version: settings.version,
      capability_fingerprint: settings.capability_fingerprint,
      required_capability: 'canGeneratePlanDraft',
      actor_class: 'automation_daemon',
      daemon_identity: automationDaemonIdentity,
    } as AutomationPrecondition;
    const commandPrecondition = testPlanCommandPrecondition(precondition, generatedPlanDraft, planGenerationArtifacts);
    await repository.claimCommandIdempotency({
      id: 'command-idem-active-generated-plan',
      command_name: 'ensure_plan_draft_for_approved_spec',
      idempotency_key: 'idem-plan-draft-active-generated-plan',
      target_object_type: 'work_item',
      target_object_id: ctx.workItem.id,
      target_revision_id: ctx.specRevisionId,
      precondition_json: commandPrecondition.json,
      precondition_fingerprint: commandPrecondition.fingerprint,
      actor_scope: `automation_daemon:${automationDaemonIdentity}`,
      claim_token: 'claim-active-generated-plan',
      locked_until: '2026-05-05T00:05:00.000Z',
      now: '2026-05-05T00:00:00.000Z',
    });

    await expect(
      (service as AutomationCommandTestService).ensurePlanDraftForApprovedSpec(
        ctx.workItem.id,
        ctx.specRevisionId,
        precondition,
        'idem-plan-draft-active-generated-plan',
        generatedPlanDraft,
        planGenerationArtifacts,
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'command_idempotency_conflict' }),
    });
  });

  it('rejects internal package draft commands before execution package writes on claim binding mismatch', async () => {
    const { app, repository, service } = await createTestApp();
    apps.push(app);
    const ctx = await seedClaimedPackageDraftAction(app, repository, {
      id: 'action-package-claim-binding-wrong-input',
      action_input_json: {
        plan_revision_id: 'plan-revision-other',
        generation_key: 'default:plan-revision-other',
      },
    });

    const response = await signedAutomationPost(
      app,
      `/internal/automation/plan-revisions/${ctx.planRevisionId}/ensure-package-drafts`,
      ctx.commandBody,
    );

    expect([409, 422]).toContain(response.status);
    await expectNoPackageDraftCommandWrites(service, ctx);
  });

  it('accepts claimed package draft actions with generation prompt identity fields', async () => {
    const { app, repository, service } = await createTestApp();
    apps.push(app);
    const ctx = await seedApprovedPlan(app);
    const settings = await repository.setAutomationProjectSettings({
      id: 'automation-settings-versioned-package-claim-binding',
      project_id: ctx.project.id,
      repo_id: 'repo-1',
      scope_type: 'repo',
      preset: 'draft_only',
      expected_version: 0,
      reason: 'enable versioned package claim binding test',
      evidence_refs: [],
      actor: { actor_id: actorOwner, actor_class: 'human_admin' },
      now: '2026-05-05T00:00:00.000Z',
    });
    const precondition: AutomationPrecondition = {
      automation_scope: `repo:${ctx.project.id}:repo-1`,
      project_id: ctx.project.id,
      repo_id: 'repo-1',
      automation_settings_version: settings.version,
      capability_fingerprint: settings.capability_fingerprint,
      required_capability: 'canGeneratePackageDrafts',
      actor_class: 'automation_daemon',
      daemon_identity: automationDaemonIdentity,
    };
    const actionId = 'action-versioned-package-claim-binding';
    await signedAutomationPost(app, '/internal/automation/actions', packageDraftActionBody(ctx, precondition, actionId, {
      action_input_json: {
        plan_revision_id: ctx.planRevisionId,
        generation_key: `default:${ctx.planRevisionId}`,
        prompt_version: 'package-drafts.fake.v2',
        output_schema_version: 'package_drafts.v1',
      },
    })).expect(201);
    const claimToken = `claim-${actionId}`;
    await signedAutomationPost(app, '/internal/automation/actions:claim-next', {
      claim_token: claimToken,
      lease_ms: 10 * 60 * 1000,
      limit: 1,
    }).expect(200);
    const commandBody = {
      action_run_id: actionId,
      claim_token: claimToken,
      idempotency_key: `${actionId}-idempotency`,
      automation_precondition: precondition,
    };

    await signedAutomationPost(
      app,
      `/internal/automation/plan-revisions/${ctx.planRevisionId}/ensure-package-drafts`,
      commandBody,
    ).expect(201);

    await expect(service.listExecutionPackages(ctx.workItem.id)).resolves.toHaveLength(1);
  });

  it('rejects internal manual path commands before manual hold writes on claim binding mismatch', async () => {
    const { app, repository } = await createTestApp();
    apps.push(app);
    const ctx = await seedClaimedManualPathAction(app, repository, {
      id: 'action-manual-claim-binding-wrong-input',
      action_input_json: {
        object_type: 'work_item',
        object_id: 'work-item-other',
        scope_key: 'work_item:other',
        reason_code: 'needs_human_triage',
        reason: 'Automation stopped for human triage.',
      },
    });

    const response = await signedAutomationPost(app, '/internal/automation/manual-path-holds', ctx.commandBody);

    expect([409, 422]).toContain(response.status);
    await expectNoManualPathCommandWrites(repository, ctx);
  });

  it('accepts planner-style manual path commands with target revision in the daemon precondition', async () => {
    const { app, repository } = await createTestApp();
    apps.push(app);
    const ctx = await seedApprovedSpec(app);
    const settings = await repository.setAutomationProjectSettings({
      id: 'automation-settings-manual-target-aware-claim-binding',
      project_id: ctx.project.id,
      repo_id: 'repo-1',
      scope_type: 'repo',
      preset: 'draft_only',
      expected_version: 0,
      reason: 'enable manual target-aware claim binding test',
      evidence_refs: [],
      actor: { actor_id: actorOwner, actor_class: 'human_admin' },
      now: '2026-05-05T00:00:00.000Z',
    });
    const scopeKey = buildManualScopeKey({ object_type: 'work_item', object_id: ctx.workItem.id });
    const precondition = {
      automation_scope: `repo:${ctx.project.id}:repo-1`,
      project_id: ctx.project.id,
      repo_id: 'repo-1',
      target_object_type: 'work_item',
      target_object_id: ctx.workItem.id,
      target_revision_id: ctx.specRevisionId,
      target_status: 'approved',
      automation_settings_version: settings.version,
      capability_fingerprint: settings.capability_fingerprint,
      required_capability: 'canGeneratePlanDraft',
      command_concurrency_token: `${scopeKey}:multi_repo_ambiguity`,
      actor_class: 'automation_daemon',
    } as AutomationPrecondition;
    const actionId = `action-manual-target-aware-claim-binding-${ctx.workItem.id}`;
    const actionInput = {
      object_type: 'work_item',
      object_id: ctx.workItem.id,
      scope_key: scopeKey,
      reason_code: 'multi_repo_ambiguity',
      reason: 'Automation target matches multiple repos; choose the canonical path manually.',
    };

    await signedAutomationPost(
      app,
      '/internal/automation/actions',
      manualPathActionBody(ctx, precondition, actionId, {
        target_revision_id: ctx.specRevisionId,
        target_status: 'approved',
        action_input_json: actionInput,
      }),
    ).expect(201);
    const claimToken = `claim-${actionId}`;
    await signedAutomationPost(app, '/internal/automation/actions:claim-next', {
      claim_token: claimToken,
      lease_ms: 10 * 60 * 1000,
      limit: 1,
    }).expect(200);

    await signedAutomationPost(app, '/internal/automation/manual-path-holds', {
      action_run_id: actionId,
      claim_token: claimToken,
      ...actionInput,
      evidence_refs: [],
      requested_by: automationDaemonIdentity,
      idempotency_key: `${actionId}-idempotency`,
      automation_precondition: precondition,
    }).expect(201);

    await expect(
      repository.listActiveManualPathHolds({
        object_type: 'work_item',
        object_id: ctx.workItem.id,
      }),
    ).resolves.toHaveLength(1);
  });

  it('rejects internal manual path commands with malformed evidence refs before manual hold writes', async () => {
    const { app, repository } = await createTestApp();
    apps.push(app);
    const ctx = await seedClaimedManualPathAction(app, repository, {
      id: 'action-manual-claim-binding-bad-evidence',
    });

    await signedAutomationPost(app, '/internal/automation/manual-path-holds', {
      ...ctx.commandBody,
      evidence_refs: [{ kind: 'diff' }],
    }).expect(400);
    await expectNoManualPathCommandWrites(repository, ctx);
  });

  it('requires signed actor headers when trusted actor signature enforcement is enabled', () => {
    const previousSecret = process.env.FORGELOOP_TRUSTED_ACTOR_HEADER_SECRET;
    const previousRequirement = process.env.FORGELOOP_REQUIRE_TRUSTED_ACTOR_SIGNATURE;
    process.env.FORGELOOP_TRUSTED_ACTOR_HEADER_SECRET = 'test-trusted-actor-secret';
    process.env.FORGELOOP_REQUIRE_TRUSTED_ACTOR_SIGNATURE = '1';
    try {
      expect(() => actorContextFromHeaders(humanAdminHeaders)).toThrow(/timestamp and signature/i);

      const timestamp = new Date().toISOString();
      const signedHeaders = {
        ...humanAdminHeaders,
        [actorTimestampHeaderName]: timestamp,
        [actorSignatureHeaderName]: trustedActorHeaderSignature(
          { actorId: actorOwner, actorClass: 'human_admin', timestamp },
          'test-trusted-actor-secret',
        ),
      };

      expect(actorContextFromHeaders(signedHeaders)).toEqual({
        authenticatedActorId: actorOwner,
        actorClass: 'human_admin',
      });
    } finally {
      if (previousSecret === undefined) {
        delete process.env.FORGELOOP_TRUSTED_ACTOR_HEADER_SECRET;
      } else {
        process.env.FORGELOOP_TRUSTED_ACTOR_HEADER_SECRET = previousSecret;
      }
      if (previousRequirement === undefined) {
        delete process.env.FORGELOOP_REQUIRE_TRUSTED_ACTOR_SIGNATURE;
      } else {
        process.env.FORGELOOP_REQUIRE_TRUSTED_ACTOR_SIGNATURE = previousRequirement;
      }
    }
  });

  it('ensures one plan draft for an approved spec under duplicate daemon and manual calls', async () => {
    const { app, repository, service } = await createTestApp();
    apps.push(app);
    const ctx = await seedApprovedSpec(app);
    const settings = await repository.setAutomationProjectSettings({
      id: 'automation-settings-plan-draft',
      project_id: ctx.project.id,
      repo_id: 'repo-1',
      scope_type: 'repo',
      preset: 'draft_only',
      expected_version: 0,
      reason: 'enable plan draft dogfood',
      evidence_refs: [],
      actor: { actor_id: actorOwner, actor_class: 'human_admin' },
      now: '2026-05-05T00:20:00.000Z',
    });
    const precondition: AutomationPrecondition = {
      automation_scope: `repo:${ctx.project.id}:repo-1`,
      project_id: ctx.project.id,
      repo_id: 'repo-1',
      automation_settings_version: settings.version,
      capability_fingerprint: settings.capability_fingerprint,
      required_capability: 'canGeneratePlanDraft',
      actor_class: 'automation_daemon',
      daemon_identity: 'daemon-1',
    };
    const automationService = service as AutomationCommandTestService;

    const [first, second] = await Promise.all([
      automationService.ensurePlanDraftForApprovedSpec(
        ctx.workItem.id,
        ctx.specRevisionId,
        precondition,
        'idem-plan-draft-1',
        generatedPlanDraft,
        planGenerationArtifacts,
      ),
      automationService.ensurePlanDraftForApprovedSpec(
        ctx.workItem.id,
        ctx.specRevisionId,
        precondition,
        'idem-plan-draft-1',
        generatedPlanDraft,
        planGenerationArtifacts,
      ),
    ]);

    expect(first.plan_revision_id).toBe(second.plan_revision_id);
    expect(first.status).toBe('created');
    expect(second.status).toBe('existing');
    await expect(service.listPlanRevisions(first.plan_id)).resolves.toHaveLength(1);
    const [revision] = (await service.listPlanRevisions(first.plan_id)) as PlanRevision[];
    expect(revision?.based_on_spec_revision_id).toBe(ctx.specRevisionId);
    expect(ctx.spec.current_revision_id).toBe(ctx.specRevisionId);
  });

  it('does not create duplicate plan drafts when equivalent commands use different idempotency keys', async () => {
    const { app, repository, service } = await createTestApp();
    apps.push(app);
    const ctx = await seedApprovedSpec(app);
    const settings = await repository.setAutomationProjectSettings({
      id: 'automation-settings-plan-draft-target-lock',
      project_id: ctx.project.id,
      repo_id: 'repo-1',
      scope_type: 'repo',
      preset: 'draft_only',
      expected_version: 0,
      reason: 'enable target lock dogfood',
      evidence_refs: [],
      actor: { actor_id: actorOwner, actor_class: 'human_admin' },
      now: '2026-05-05T00:21:00.000Z',
    });
    const precondition: AutomationPrecondition = {
      automation_scope: `repo:${ctx.project.id}:repo-1`,
      project_id: ctx.project.id,
      repo_id: 'repo-1',
      automation_settings_version: settings.version,
      capability_fingerprint: settings.capability_fingerprint,
      required_capability: 'canGeneratePlanDraft',
      actor_class: 'automation_daemon',
      daemon_identity: 'daemon-1',
    };
    const automationService = service as AutomationCommandTestService;

    const [first, second] = await Promise.all([
      automationService.ensurePlanDraftForApprovedSpec(
        ctx.workItem.id,
        ctx.specRevisionId,
        precondition,
        'idem-plan-draft-target-a',
        generatedPlanDraft,
        planGenerationArtifacts,
      ),
      automationService.ensurePlanDraftForApprovedSpec(
        ctx.workItem.id,
        ctx.specRevisionId,
        precondition,
        'idem-plan-draft-target-b',
        generatedPlanDraft,
        planGenerationArtifacts,
      ),
    ]);

    expect(second.plan_revision_id).toBe(first.plan_revision_id);
    await expect(service.listPlanRevisions(first.plan_id)).resolves.toHaveLength(1);
  });

  it('rejects malformed succeeded plan draft idempotency replay instead of re-entering side effects', async () => {
    const { app, repository, service } = await createTestApp();
    apps.push(app);
    const ctx = await seedApprovedSpec(app);
    const settings = await repository.setAutomationProjectSettings({
      id: 'automation-settings-plan-draft-malformed-replay',
      project_id: ctx.project.id,
      repo_id: 'repo-1',
      scope_type: 'repo',
      preset: 'draft_only',
      expected_version: 0,
      reason: 'enable plan draft',
      evidence_refs: [],
      actor: { actor_id: actorOwner, actor_class: 'human_admin' },
      now: '2026-05-05T00:00:00.000Z',
    });
    const precondition: AutomationPrecondition = {
      automation_scope: `repo:${ctx.project.id}:repo-1`,
      project_id: ctx.project.id,
      repo_id: 'repo-1',
      automation_settings_version: settings.version,
      capability_fingerprint: settings.capability_fingerprint,
      required_capability: 'canGeneratePlanDraft',
      actor_class: 'automation_daemon',
      daemon_identity: 'daemon-1',
    };
    const claim = await repository.claimCommandIdempotency({
      id: 'command-idem-malformed-plan-replay',
      command_name: 'ensure_plan_draft_for_approved_spec',
      idempotency_key: 'idem-plan-draft-malformed-replay',
      target_object_type: 'work_item',
      target_object_id: ctx.workItem.id,
      target_revision_id: ctx.specRevisionId,
      precondition_json: precondition as unknown as Record<string, unknown>,
      precondition_fingerprint: automationPreconditionFingerprint(precondition),
      actor_scope: 'automation_daemon:daemon-1',
      claim_token: 'claim-malformed-plan-replay',
      locked_until: '2026-05-05T00:05:00.000Z',
      now: '2026-05-05T00:00:00.000Z',
    });
    await repository.completeCommandIdempotency({
      idempotency_key: claim.idempotency_key,
      claim_token: 'claim-malformed-plan-replay',
      result_json: { malformed: true },
      finished_at: '2026-05-05T00:01:00.000Z',
    });

    await expect(
      (service as AutomationCommandTestService).ensurePlanDraftForApprovedSpec(
        ctx.workItem.id,
        ctx.specRevisionId,
        precondition,
        'idem-plan-draft-malformed-replay',
        generatedPlanDraft,
        planGenerationArtifacts,
      ),
    ).rejects.toThrow(/idempotency/i);
    expect((await repository.getWorkItem(ctx.workItem.id))?.current_plan_id).toBeUndefined();
  });

  it('rejects blocked plan draft idempotency replay instead of re-entering side effects', async () => {
    const { app, repository, service } = await createTestApp();
    apps.push(app);
    const ctx = await seedApprovedSpec(app);
    const settings = await repository.setAutomationProjectSettings({
      id: 'automation-settings-plan-draft-blocked-replay',
      project_id: ctx.project.id,
      repo_id: 'repo-1',
      scope_type: 'repo',
      preset: 'draft_only',
      expected_version: 0,
      reason: 'enable plan draft blocked replay test',
      evidence_refs: [],
      actor: { actor_id: actorOwner, actor_class: 'human_admin' },
      now: '2026-05-05T00:01:00.000Z',
    });
    const precondition: AutomationPrecondition = {
      automation_scope: `repo:${ctx.project.id}:repo-1`,
      project_id: ctx.project.id,
      repo_id: 'repo-1',
      automation_settings_version: settings.version,
      capability_fingerprint: settings.capability_fingerprint,
      required_capability: 'canGeneratePlanDraft',
      actor_class: 'automation_daemon',
      daemon_identity: 'daemon-1',
    };
    const claim = await repository.claimCommandIdempotency({
      id: 'command-idem-blocked-plan-replay',
      command_name: 'ensure_plan_draft_for_approved_spec',
      idempotency_key: 'idem-plan-draft-blocked-replay',
      target_object_type: 'work_item',
      target_object_id: ctx.workItem.id,
      target_revision_id: ctx.specRevisionId,
      precondition_json: precondition as unknown as Record<string, unknown>,
      precondition_fingerprint: automationPreconditionFingerprint(precondition),
      actor_scope: 'automation_daemon:daemon-1',
      claim_token: 'claim-blocked-plan-replay',
      locked_until: '2026-05-05T00:06:00.000Z',
      now: '2026-05-05T00:01:00.000Z',
    });
    await repository.blockCommandIdempotency({
      idempotency_key: claim.idempotency_key,
      claim_token: 'claim-blocked-plan-replay',
      result_json: { error: 'manual_path_hold_active' },
      finished_at: '2026-05-05T00:02:00.000Z',
    });

    await expect(
      (service as AutomationCommandTestService).ensurePlanDraftForApprovedSpec(
        ctx.workItem.id,
        ctx.specRevisionId,
        precondition,
        'idem-plan-draft-blocked-replay',
        generatedPlanDraft,
        planGenerationArtifacts,
      ),
    ).rejects.toThrow(/idempotency/i);
    expect((await repository.getWorkItem(ctx.workItem.id))?.current_plan_id).toBeUndefined();
  });

  it('does not overwrite a concurrently changed current spec while attaching an automation plan draft', async () => {
    const { app, repository, service } = await createTestApp();
    apps.push(app);
    const ctx = await seedApprovedSpec(app);
    const settings = await repository.setAutomationProjectSettings({
      id: 'automation-settings-plan-draft-current-spec-race',
      project_id: ctx.project.id,
      repo_id: 'repo-1',
      scope_type: 'repo',
      preset: 'draft_only',
      expected_version: 0,
      reason: 'enable plan draft race test',
      evidence_refs: [],
      actor: { actor_id: actorOwner, actor_class: 'human_admin' },
      now: '2026-05-05T00:03:00.000Z',
    });
    const concurrentSpec: Spec = {
      ...ctx.spec,
      id: 'spec-concurrent-current',
      current_revision_id: 'spec-revision-concurrent-current',
      updated_at: '2026-05-05T00:03:01.000Z',
    };
    const currentRevision = (await repository.getSpecRevision(ctx.specRevisionId)) as SpecRevision;
    await repository.saveSpec(concurrentSpec);
    await repository.saveSpecRevision({
      ...currentRevision,
      id: 'spec-revision-concurrent-current',
      spec_id: concurrentSpec.id,
      revision_number: 1,
      created_at: '2026-05-05T00:03:01.000Z',
    });
    const originalGetWorkItem = repository.getWorkItem.bind(repository);
    let getWorkItemCalls = 0;
    repository.getWorkItem = async (workItemId: string) => {
      getWorkItemCalls += 1;
      if (workItemId === ctx.workItem.id && getWorkItemCalls === 2) {
        const latest = await originalGetWorkItem(workItemId);
        await repository.saveWorkItem({
          ...latest!,
          current_spec_id: concurrentSpec.id,
          updated_at: '2026-05-05T00:03:02.000Z',
        });
      }
      return originalGetWorkItem(workItemId);
    };
    const precondition: AutomationPrecondition = {
      automation_scope: `repo:${ctx.project.id}:repo-1`,
      project_id: ctx.project.id,
      repo_id: 'repo-1',
      automation_settings_version: settings.version,
      capability_fingerprint: settings.capability_fingerprint,
      required_capability: 'canGeneratePlanDraft',
      actor_class: 'automation_daemon',
      daemon_identity: 'daemon-1',
    };

    await expect(
      (service as AutomationCommandTestService).ensurePlanDraftForApprovedSpec(
        ctx.workItem.id,
        ctx.specRevisionId,
        precondition,
        'idem-plan-draft-current-spec-race',
        generatedPlanDraft,
        planGenerationArtifacts,
      ),
    ).rejects.toThrow(/current spec changed/i);
    expect((await repository.getWorkItem(ctx.workItem.id))?.current_spec_id).toBe(concurrentSpec.id);
    expect((await repository.getWorkItem(ctx.workItem.id))?.current_plan_id).toBeUndefined();
  });

  it('rejects plan draft commands when the repo-scoped automation precondition is no longer active for the project', async () => {
    const { app, repository, service } = await createTestApp();
    apps.push(app);
    const ctx = await seedApprovedSpec(app);
    const settings = await repository.setAutomationProjectSettings({
      id: 'automation-settings-plan-draft-repo-moved',
      project_id: ctx.project.id,
      repo_id: 'repo-1',
      scope_type: 'repo',
      preset: 'draft_only',
      expected_version: 0,
      reason: 'enable repo-scoped plan draft',
      evidence_refs: [],
      actor: { actor_id: actorOwner, actor_class: 'human_admin' },
      now: '2026-05-05T00:21:30.000Z',
    });
    const [repo] = await repository.listProjectRepos(ctx.project.id);
    expect(repo).toBeDefined();
    await repository.saveProjectRepo({ ...repo!, status: 'archived', updated_at: '2026-05-05T00:21:31.000Z' });
    const precondition: AutomationPrecondition = {
      automation_scope: `repo:${ctx.project.id}:repo-1`,
      project_id: ctx.project.id,
      repo_id: 'repo-1',
      automation_settings_version: settings.version,
      capability_fingerprint: settings.capability_fingerprint,
      required_capability: 'canGeneratePlanDraft',
      actor_class: 'automation_daemon',
      daemon_identity: 'daemon-1',
    };

    await expect(
      (service as AutomationCommandTestService).ensurePlanDraftForApprovedSpec(
        ctx.workItem.id,
        ctx.specRevisionId,
        precondition,
        'idem-plan-draft-repo-moved',
        generatedPlanDraft,
        planGenerationArtifacts,
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'automation_precondition_stale' }),
    });
  });

  it('creates, replays, and resolves manual path holds through the product automation endpoint', async () => {
    const { app } = await createTestApp();
    apps.push(app);
    const { workItem } = await seedProjectRepoWorkItem(app);
    const scopeKey = buildManualScopeKey({ object_type: 'work_item', object_id: workItem.id });

    const first = await request(app.getHttpServer())
      .post('/automation/manual-path-holds')
      .send({
        object_type: 'work_item',
        object_id: workItem.id,
        scope_key: scopeKey,
        reason_code: 'needs_human_triage',
        reason: 'Automation stopped for human triage.',
        evidence_refs: [],
        requested_by: actorOwner,
        idempotency_key: 'manual-hold-idem-1',
      })
      .expect(201);

    const replayed = await request(app.getHttpServer())
      .post('/automation/manual-path-holds')
      .send({
        object_type: 'work_item',
        object_id: workItem.id,
        scope_key: scopeKey,
        reason_code: 'needs_human_triage',
        reason: 'Automation stopped for human triage.',
        evidence_refs: [],
        requested_by: actorOwner,
        idempotency_key: 'manual-hold-idem-1',
      })
      .expect(201);

    expect(replayed.body).toMatchObject({ id: first.body.id, status: 'active', scope_key: scopeKey });

    const resolved = await request(app.getHttpServer())
      .post(`/automation/manual-path-holds/${first.body.id}/resolve`)
      .set(reviewerHeaders)
      .send({
        resolved_by: actorReviewer,
        resolution: 'reviewed',
        evidence_refs: [],
      })
      .expect(201);

    expect(resolved.body).toMatchObject({ id: first.body.id, status: 'resolved', resolved_by: actorReviewer });
  });

  it('prevents a daemon from resolving its own manual path hold', async () => {
    const { app, repository } = await createTestApp();
    apps.push(app);
    const { project, workItem } = await seedProjectRepoWorkItem(app);
    const settings = await repository.setAutomationProjectSettings({
      id: 'automation-settings-manual-hold-daemon',
      project_id: project.id,
      repo_id: 'repo-1',
      scope_type: 'repo',
      preset: 'draft_only',
      expected_version: 0,
      reason: 'enable daemon manual holds',
      evidence_refs: [],
      actor: { actor_id: actorOwner, actor_class: 'human_admin' },
      now: '2026-05-05T00:22:00.000Z',
    });
    const scopeKey = buildManualScopeKey({ object_type: 'work_item', object_id: workItem.id });

    const hold = await request(app.getHttpServer())
      .post('/automation/manual-path-holds')
      .set(daemonHeaders)
      .send({
        object_type: 'work_item',
        object_id: workItem.id,
        scope_key: scopeKey,
        reason_code: 'needs_human_triage',
        reason: 'Automation stopped for human triage.',
        evidence_refs: [],
        requested_by: 'daemon-1',
        idempotency_key: 'manual-hold-daemon-own-idem',
        source_automation_action_id: 'automation-action-daemon-own-hold',
        actor_context: { actor_id: 'daemon-actor', actor_class: 'automation_daemon', daemon_identity: 'daemon-1' },
        automation_precondition: {
          automation_scope: `repo:${project.id}:repo-1`,
          project_id: project.id,
          repo_id: 'repo-1',
          automation_settings_version: settings.version,
          capability_fingerprint: settings.capability_fingerprint,
          required_capability: 'canGeneratePlanDraft',
          actor_class: 'automation_daemon',
          daemon_identity: 'daemon-1',
        },
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/automation/manual-path-holds/${hold.body.id}/resolve`)
      .set(daemonHeaders)
      .send({
        resolved_by: 'daemon-1',
        resolution: 'self resolved',
        evidence_refs: [],
      })
      .expect(403);
  });

  it('rejects daemon-origin manual path holds without an automation precondition', async () => {
    const { app } = await createTestApp();
    apps.push(app);
    const { workItem } = await seedProjectRepoWorkItem(app);

    await request(app.getHttpServer())
      .post('/automation/manual-path-holds')
      .set(daemonHeaders)
      .send({
        object_type: 'work_item',
        object_id: workItem.id,
        scope_key: buildManualScopeKey({ object_type: 'work_item', object_id: workItem.id }),
        reason_code: 'needs_human_triage',
        reason: 'Automation stopped for human triage.',
        evidence_refs: [],
        requested_by: 'daemon-1',
        idempotency_key: 'manual-hold-daemon-no-precondition-idem',
        actor_context: { actor_id: 'daemon-actor', actor_class: 'automation_daemon', daemon_identity: 'daemon-1' },
      })
      .expect(400);
  });

  it('rejects daemon-origin manual path holds without trusted actor headers', async () => {
    const { app, repository } = await createTestApp();
    apps.push(app);
    const { project, workItem } = await seedProjectRepoWorkItem(app);
    const settings = await repository.setAutomationProjectSettings({
      id: 'automation-settings-manual-hold-untrusted',
      project_id: project.id,
      repo_id: 'repo-1',
      scope_type: 'repo',
      preset: 'draft_only',
      expected_version: 0,
      reason: 'enable daemon manual holds',
      evidence_refs: [],
      actor: { actor_id: actorOwner, actor_class: 'human_admin' },
      now: '2026-05-05T00:23:30.000Z',
    });

    await request(app.getHttpServer())
      .post('/automation/manual-path-holds')
      .send({
        object_type: 'work_item',
        object_id: workItem.id,
        scope_key: buildManualScopeKey({ object_type: 'work_item', object_id: workItem.id }),
        reason_code: 'needs_human_triage',
        reason: 'Automation stopped for human triage.',
        evidence_refs: [],
        requested_by: 'daemon-1',
        idempotency_key: 'manual-hold-daemon-untrusted-idem',
        source_automation_action_id: 'automation-action-daemon-untrusted',
        actor_context: { actor_id: 'daemon-actor', actor_class: 'automation_daemon', daemon_identity: 'daemon-1' },
        automation_precondition: {
          automation_scope: `repo:${project.id}:repo-1`,
          project_id: project.id,
          repo_id: 'repo-1',
          automation_settings_version: settings.version,
          capability_fingerprint: settings.capability_fingerprint,
          required_capability: 'canGeneratePlanDraft',
          actor_class: 'automation_daemon',
          daemon_identity: 'daemon-1',
        },
      })
      .expect(401);
  });

  it('rejects manual path hold resolution without trusted actor headers', async () => {
    const { app } = await createTestApp();
    apps.push(app);
    const { workItem } = await seedProjectRepoWorkItem(app);
    const hold = await request(app.getHttpServer())
      .post('/automation/manual-path-holds')
      .send({
        object_type: 'work_item',
        object_id: workItem.id,
        scope_key: buildManualScopeKey({ object_type: 'work_item', object_id: workItem.id }),
        reason_code: 'needs_human_triage',
        reason: 'Automation stopped for human triage.',
        evidence_refs: [],
        requested_by: actorOwner,
        idempotency_key: 'manual-hold-resolve-untrusted-idem',
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/automation/manual-path-holds/${hold.body.id}/resolve`)
      .send({ resolved_by: actorReviewer, resolution: 'reviewed', evidence_refs: [] })
      .expect(401);
  });

  it('rejects manual path hold resolution attributed to a different actor than trusted headers', async () => {
    const { app } = await createTestApp();
    apps.push(app);
    const { workItem } = await seedProjectRepoWorkItem(app);
    const hold = await request(app.getHttpServer())
      .post('/automation/manual-path-holds')
      .send({
        object_type: 'work_item',
        object_id: workItem.id,
        scope_key: buildManualScopeKey({ object_type: 'work_item', object_id: workItem.id }),
        reason_code: 'needs_human_triage',
        reason: 'Automation stopped for human triage.',
        evidence_refs: [],
        requested_by: actorOwner,
        idempotency_key: 'manual-hold-resolve-spoof-idem',
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/automation/manual-path-holds/${hold.body.id}/resolve`)
      .set(humanAdminHeaders)
      .send({ resolved_by: actorReviewer, resolution: 'reviewed', evidence_refs: [] })
      .expect(403);
  });

  it('does not allow manual path hold resolution to be overwritten', async () => {
    const { app } = await createTestApp();
    apps.push(app);
    const { workItem } = await seedProjectRepoWorkItem(app);
    const scopeKey = buildManualScopeKey({ object_type: 'work_item', object_id: workItem.id });
    const hold = await request(app.getHttpServer())
      .post('/automation/manual-path-holds')
      .send({
        object_type: 'work_item',
        object_id: workItem.id,
        scope_key: scopeKey,
        reason_code: 'needs_human_triage',
        reason: 'Automation stopped for human triage.',
        evidence_refs: [],
        requested_by: actorOwner,
        idempotency_key: 'manual-hold-resolve-once-idem',
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/automation/manual-path-holds/${hold.body.id}/resolve`)
      .set(reviewerHeaders)
      .send({ resolved_by: actorReviewer, resolution: 'reviewed', evidence_refs: [] })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/automation/manual-path-holds/${hold.body.id}/resolve`)
      .set(humanAdminHeaders)
      .send({ resolved_by: actorOwner, resolution: 'changed after resolution', evidence_refs: [] })
      .expect(409);
  });

  it('rejects daemon-origin manual path holds when actor context no longer matches the precondition', async () => {
    const { app, repository } = await createTestApp();
    apps.push(app);
    const { project, workItem } = await seedProjectRepoWorkItem(app);
    const settings = await repository.setAutomationProjectSettings({
      id: 'automation-settings-manual-hold-mismatch',
      project_id: project.id,
      repo_id: 'repo-1',
      scope_type: 'repo',
      preset: 'draft_only',
      expected_version: 0,
      reason: 'enable daemon manual holds',
      evidence_refs: [],
      actor: { actor_id: actorOwner, actor_class: 'human_admin' },
      now: '2026-05-05T00:23:00.000Z',
    });

    await request(app.getHttpServer())
      .post('/automation/manual-path-holds')
      .set({ ...daemonHeaders, 'x-forgeloop-daemon-identity': 'daemon-2' })
      .send({
        object_type: 'work_item',
        object_id: workItem.id,
        scope_key: buildManualScopeKey({ object_type: 'work_item', object_id: workItem.id }),
        reason_code: 'needs_human_triage',
        reason: 'Automation stopped for human triage.',
        evidence_refs: [],
        requested_by: 'daemon-1',
        idempotency_key: 'manual-hold-daemon-mismatch-idem',
        source_automation_action_id: 'automation-action-daemon-mismatch',
        actor_context: { actor_id: 'daemon-actor', actor_class: 'automation_daemon', daemon_identity: 'daemon-2' },
        automation_precondition: {
          automation_scope: `repo:${project.id}:repo-1`,
          project_id: project.id,
          repo_id: 'repo-1',
          automation_settings_version: settings.version,
          capability_fingerprint: settings.capability_fingerprint,
          required_capability: 'canGeneratePlanDraft',
          actor_class: 'automation_daemon',
          daemon_identity: 'daemon-1',
        },
      })
      .expect(409);
  });

  it('ensures one execution package draft set for an approved plan revision under duplicate commands', async () => {
    const { app, repository, service } = await createTestApp();
    apps.push(app);
    const ctx = await seedApprovedPlan(app);
    const settings = await repository.setAutomationProjectSettings({
      id: 'automation-settings-package-draft',
      project_id: ctx.project.id,
      repo_id: 'repo-1',
      scope_type: 'repo',
      preset: 'draft_only',
      expected_version: 0,
      reason: 'enable package draft dogfood',
      evidence_refs: [],
      actor: { actor_id: actorOwner, actor_class: 'human_admin' },
      now: '2026-05-05T00:25:00.000Z',
    });
    const precondition: AutomationPrecondition = {
      automation_scope: `repo:${ctx.project.id}:repo-1`,
      project_id: ctx.project.id,
      repo_id: 'repo-1',
      automation_settings_version: settings.version,
      capability_fingerprint: settings.capability_fingerprint,
      required_capability: 'canGeneratePackageDrafts',
      actor_class: 'automation_daemon',
      daemon_identity: 'daemon-1',
    };
    const automationService = service as AutomationCommandTestService;

    const [first, second] = await Promise.all([
      automationService.ensureExecutionPackageDraftsForPlanRevision({
        planRevisionId: ctx.planRevisionId,
        automationPrecondition: precondition,
        actorContext: { authenticatedActorId: 'daemon-1', actorClass: 'automation_daemon', daemonIdentity: 'daemon-1' },
        idempotencyKey: 'idem-package-draft-1',
      }),
      automationService.ensureExecutionPackageDraftsForPlanRevision({
        planRevisionId: ctx.planRevisionId,
        automationPrecondition: precondition,
        actorContext: { authenticatedActorId: 'daemon-1', actorClass: 'automation_daemon', daemonIdentity: 'daemon-1' },
        idempotencyKey: 'idem-package-draft-1',
      }),
    ]);

    expect(second.execution_package_set_id).toBe(first.execution_package_set_id);
    expect(second.package_ids).toEqual(first.package_ids);
    expect(await service.listExecutionPackages(ctx.workItem.id)).toHaveLength(1);
    const [executionPackage] = (await service.listExecutionPackages(ctx.workItem.id)) as ExecutionPackage[];
    expect(executionPackage).toMatchObject({ phase: 'draft', gate_state: 'not_submitted', plan_revision_id: ctx.planRevisionId });
  });

  it('allows project-scoped package draft automation for repos in the project', async () => {
    const { app, repository, service } = await createTestApp();
    apps.push(app);
    const ctx = await seedApprovedPlan(app);
    const settings = await repository.setAutomationProjectSettings({
      id: 'automation-settings-package-project-scope',
      project_id: ctx.project.id,
      scope_type: 'project',
      preset: 'draft_only',
      expected_version: 0,
      reason: 'enable project scoped package drafts',
      evidence_refs: [],
      actor: { actor_id: actorOwner, actor_class: 'human_admin' },
      now: '2026-05-05T00:25:30.000Z',
    });
    const precondition: AutomationPrecondition = {
      automation_scope: `project:${ctx.project.id}`,
      project_id: ctx.project.id,
      automation_settings_version: settings.version,
      capability_fingerprint: settings.capability_fingerprint,
      required_capability: 'canGeneratePackageDrafts',
      actor_class: 'automation_daemon',
      daemon_identity: 'daemon-1',
    };

    await expect(
      (service as AutomationCommandTestService).ensureExecutionPackageDraftsForPlanRevision({
        planRevisionId: ctx.planRevisionId,
        automationPrecondition: precondition,
        actorContext: { authenticatedActorId: 'daemon-1', actorClass: 'automation_daemon', daemonIdentity: 'daemon-1' },
        idempotencyKey: 'idem-package-project-scope',
      }),
    ).resolves.toMatchObject({ status: 'created', package_ids: [expect.any(String)] });
  });

  it('blocks project-scoped package draft automation when multiple repos make the package repo ambiguous', async () => {
    const { app, repository, service } = await createTestApp();
    apps.push(app);
    const ctx = await seedApprovedPlan(app);
    const project = await repository.getProject(ctx.project.id);
    if (project === undefined) {
      throw new Error(`Missing seeded project ${ctx.project.id}`);
    }
    const workerRepoRoot = await createWorkflowPolicyRepoRoot({ prefix: 'forgeloop-worker-policy-repo-' });
    await seedProjectRepo(repository, project, {
      repo_id: 'repo-2',
      name: 'forgeloop-worker',
      local_path: workerRepoRoot,
      default_branch: 'main',
      base_commit_sha: 'def456',
    });
    const settings = await repository.setAutomationProjectSettings({
      id: 'automation-settings-package-project-scope-ambiguous',
      project_id: ctx.project.id,
      scope_type: 'project',
      preset: 'draft_only',
      expected_version: 0,
      reason: 'enable ambiguous project scoped package drafts',
      evidence_refs: [],
      actor: { actor_id: actorOwner, actor_class: 'human_admin' },
      now: '2026-05-05T00:25:40.000Z',
    });
    const precondition: AutomationPrecondition = {
      automation_scope: `project:${ctx.project.id}`,
      project_id: ctx.project.id,
      automation_settings_version: settings.version,
      capability_fingerprint: settings.capability_fingerprint,
      required_capability: 'canGeneratePackageDrafts',
      actor_class: 'automation_daemon',
      daemon_identity: 'daemon-1',
    };

    await expect(
      (service as AutomationCommandTestService).ensureExecutionPackageDraftsForPlanRevision({
        planRevisionId: ctx.planRevisionId,
        automationPrecondition: precondition,
        actorContext: { authenticatedActorId: 'daemon-1', actorClass: 'automation_daemon', daemonIdentity: 'daemon-1' },
        idempotencyKey: 'idem-package-project-scope-ambiguous',
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'automation_gate_blocked' }),
    });
  });

  it('rejects manual mark-ready when the package plan revision has no frozen spec revision target', async () => {
    const { app, repository, service } = await createTestApp();
    apps.push(app);
    const ctx = await seedApprovedPlan(app);
    const settings = await repository.setAutomationProjectSettings({
      id: 'automation-settings-package-mark-ready-missing-spec-target',
      project_id: ctx.project.id,
      repo_id: 'repo-1',
      scope_type: 'repo',
      preset: 'draft_only',
      expected_version: 0,
      reason: 'enable mark-ready stale graph test',
      evidence_refs: [],
      actor: { actor_id: actorOwner, actor_class: 'human_admin' },
      now: '2026-05-05T00:25:50.000Z',
    });
    const generated = await (service as AutomationCommandTestService).ensureExecutionPackageDraftsForPlanRevision({
      planRevisionId: ctx.planRevisionId,
      automationPrecondition: {
        automation_scope: `repo:${ctx.project.id}:repo-1`,
        project_id: ctx.project.id,
        repo_id: 'repo-1',
        automation_settings_version: settings.version,
        capability_fingerprint: settings.capability_fingerprint,
        required_capability: 'canGeneratePackageDrafts',
        actor_class: 'automation_daemon',
        daemon_identity: 'daemon-1',
      },
      actorContext: { authenticatedActorId: 'daemon-1', actorClass: 'automation_daemon', daemonIdentity: 'daemon-1' },
      idempotencyKey: 'idem-package-mark-ready-missing-spec-target',
    });
    const planRevision = await repository.getPlanRevision(ctx.planRevisionId);
    expect(planRevision).toBeDefined();
    const executionPackage = await repository.getExecutionPackage(generated.package_ids[0]!);
    expect(executionPackage).toBeDefined();
    await repository.savePlanRevision({ ...planRevision!, based_on_spec_revision_id: undefined });

    await request(app.getHttpServer())
      .post(`/execution-packages/${generated.package_ids[0]}/mark-ready`)
      .set(humanAdminHeaders)
      .send({ actor_id: actorOwner, expected_package_version: executionPackage!.version })
      .expect(422);
  });

  it('rejects manual mark-ready when the package version is stale', async () => {
    const { app } = await createTestApp();
    apps.push(app);
    const ctx = await seedApprovedPlan(app);
    const executionPackage = (await request(app.getHttpServer())
      .post(`/plan-revisions/${ctx.planRevisionId}/execution-packages`)
      .send({
        repo_id: 'repo-1',
        objective: 'Implement the package execution workflow.',
        owner_actor_id: actorOwner,
        reviewer_actor_id: actorReviewer,
        qa_owner_actor_id: actorOwner,
        required_checks: [
          {
            check_id: 'unit',
            display_name: 'Unit tests',
            command: 'pnpm test',
            timeout_seconds: 120,
            blocks_review: true,
          },
        ],
        required_artifact_kinds: ['execution_summary'],
        allowed_paths: ['apps/control-plane-api/**'],
        forbidden_paths: ['packages/db/**'],
      })
      .expect(201)).body as ExecutionPackage;
    const patched = (await request(app.getHttpServer())
      .patch(`/execution-packages/${executionPackage.id}`)
      .send({ objective: 'Edited after the caller read the draft.' })
      .expect(200)).body as ExecutionPackage;
    expect(patched.version).toBe(executionPackage.version + 1);

    await request(app.getHttpServer())
      .post(`/execution-packages/${executionPackage.id}/mark-ready`)
      .set(humanAdminHeaders)
      .send({ actor_id: actorOwner, expected_package_version: executionPackage.version })
      .expect(422)
      .expect(({ body }) => {
        expect(body).toMatchObject({ code: 'stale_execution_package_revision' });
      });
  });

  it('rejects stale package generation supersede versions', async () => {
    const { app, repository, service } = await createTestApp();
    apps.push(app);
    const ctx = await seedApprovedPlan(app);
    const settings = await repository.setAutomationProjectSettings({
      id: 'automation-settings-package-supersede-version',
      project_id: ctx.project.id,
      repo_id: 'repo-1',
      scope_type: 'repo',
      preset: 'draft_only',
      expected_version: 0,
      reason: 'enable package regeneration dogfood',
      evidence_refs: [],
      actor: { actor_id: actorOwner, actor_class: 'human_admin' },
      now: '2026-05-05T00:26:00.000Z',
    });
    const precondition: AutomationPrecondition = {
      automation_scope: `repo:${ctx.project.id}:repo-1`,
      project_id: ctx.project.id,
      repo_id: 'repo-1',
      automation_settings_version: settings.version,
      capability_fingerprint: settings.capability_fingerprint,
      required_capability: 'canGeneratePackageDrafts',
      actor_class: 'automation_daemon',
      daemon_identity: 'daemon-1',
    };
    const automationService = service as AutomationCommandTestService;

    await automationService.ensureExecutionPackageDraftsForPlanRevision({
      planRevisionId: ctx.planRevisionId,
      automationPrecondition: precondition,
      actorContext: { authenticatedActorId: 'daemon-1', actorClass: 'automation_daemon', daemonIdentity: 'daemon-1' },
      idempotencyKey: 'idem-package-supersede-version-default',
    });

    await expect(
      automationService.supersedeExecutionPackageGenerationRun({
        planRevisionId: ctx.planRevisionId,
        generationKey: `default:${ctx.planRevisionId}`,
        expectedGenerationRunVersion: 0,
        reason: 'stale approval attempt',
        evidenceRefs: [],
        approvedBy: { actor_id: actorReviewer, actor_class: 'human_admin' },
        idempotencyKey: 'idem-package-supersede-version-stale',
      }),
    ).rejects.toThrow(/version/i);
  });

  it('rejects non-default package regeneration when the supersede approval reference does not match', async () => {
    const { app, repository, service } = await createTestApp();
    apps.push(app);
    const ctx = await seedApprovedPlan(app);
    const settings = await repository.setAutomationProjectSettings({
      id: 'automation-settings-package-regeneration-approval',
      project_id: ctx.project.id,
      repo_id: 'repo-1',
      scope_type: 'repo',
      preset: 'draft_only',
      expected_version: 0,
      reason: 'enable package regeneration dogfood',
      evidence_refs: [],
      actor: { actor_id: actorOwner, actor_class: 'human_admin' },
      now: '2026-05-05T00:27:00.000Z',
    });
    const precondition: AutomationPrecondition = {
      automation_scope: `repo:${ctx.project.id}:repo-1`,
      project_id: ctx.project.id,
      repo_id: 'repo-1',
      automation_settings_version: settings.version,
      capability_fingerprint: settings.capability_fingerprint,
      required_capability: 'canGeneratePackageDrafts',
      actor_class: 'human_admin',
    };
    const automationService = service as AutomationCommandTestService;

    const defaultGeneration = await automationService.ensureExecutionPackageDraftsForPlanRevision({
      planRevisionId: ctx.planRevisionId,
      automationPrecondition: precondition,
      actorContext: { authenticatedActorId: actorReviewer, actorClass: 'human_admin' },
      idempotencyKey: 'idem-package-regeneration-default',
    });
    const supersede = await automationService.supersedeExecutionPackageGenerationRun({
      planRevisionId: ctx.planRevisionId,
      generationKey: `default:${ctx.planRevisionId}`,
      expectedGenerationRunVersion: 1,
      reason: 'regenerate with a corrected split',
      evidenceRefs: [],
      approvedBy: { actor_id: actorReviewer, actor_class: 'human_admin' },
      idempotencyKey: 'idem-package-regeneration-supersede',
    });

    await expect(
      automationService.ensureExecutionPackageDraftsForPlanRevision({
        planRevisionId: ctx.planRevisionId,
        automationPrecondition: precondition,
        actorContext: { authenticatedActorId: actorReviewer, actorClass: 'human_admin' },
        idempotencyKey: 'idem-package-regeneration-wrong-approval',
        generationKey: supersede.next_generation_key,
        regenerationApproval: {
          supersededGenerationKey: `default:${ctx.planRevisionId}`,
          supersededExecutionPackageSetId: `${defaultGeneration.execution_package_set_id}:wrong`,
          supersedeCommandId: supersede.supersede_command_id,
        },
      }),
    ).rejects.toThrow(/supersede approval|approval/i);

    const regenerated = await automationService.ensureExecutionPackageDraftsForPlanRevision({
      planRevisionId: ctx.planRevisionId,
      automationPrecondition: precondition,
      actorContext: { authenticatedActorId: actorReviewer, actorClass: 'human_admin' },
      idempotencyKey: 'idem-package-regeneration-approved',
      generationKey: supersede.next_generation_key,
      regenerationApproval: {
        supersededGenerationKey: `default:${ctx.planRevisionId}`,
        supersededExecutionPackageSetId: defaultGeneration.execution_package_set_id,
        supersedeCommandId: supersede.supersede_command_id,
      },
    });
    expect(regenerated).toMatchObject({
      status: 'created',
      execution_package_set_id: `generation:${ctx.planRevisionId}:${supersede.next_generation_key}`,
    });
  });

  it('persists package generation supersede evidence refs', async () => {
    const { app, repository, service } = await createTestApp();
    apps.push(app);
    const ctx = await seedApprovedPlan(app);
    const settings = await repository.setAutomationProjectSettings({
      id: 'automation-settings-package-regeneration-evidence',
      project_id: ctx.project.id,
      repo_id: 'repo-1',
      scope_type: 'repo',
      preset: 'draft_only',
      expected_version: 0,
      reason: 'enable package generation evidence test',
      evidence_refs: [],
      actor: { actor_id: actorOwner, actor_class: 'human_admin' },
      now: '2026-05-05T00:27:30.000Z',
    });
    const precondition: AutomationPrecondition = {
      automation_scope: `repo:${ctx.project.id}:repo-1`,
      project_id: ctx.project.id,
      repo_id: 'repo-1',
      automation_settings_version: settings.version,
      capability_fingerprint: settings.capability_fingerprint,
      required_capability: 'canGeneratePackageDrafts',
      actor_class: 'human_admin',
    };
    const generationKey = `default:${ctx.planRevisionId}`;
    await (service as AutomationCommandTestService).ensureExecutionPackageDraftsForPlanRevision({
      planRevisionId: ctx.planRevisionId,
      automationPrecondition: precondition,
      actorContext: { authenticatedActorId: actorReviewer, actorClass: 'human_admin' },
      idempotencyKey: 'idem-package-regeneration-evidence-default',
    });
    const evidenceRefs: ArtifactRef[] = [
      {
        kind: 'self_review',
        name: 'Package split approval',
        content_type: 'text/markdown',
        local_ref: 'docs/reviews/package-split.md',
      },
    ];

    await (service as AutomationCommandTestService).supersedeExecutionPackageGenerationRun({
      planRevisionId: ctx.planRevisionId,
      generationKey,
      expectedGenerationRunVersion: 1,
      reason: 'regenerate with evidence',
      evidenceRefs,
      approvedBy: { actor_id: actorReviewer, actor_class: 'human_admin' },
      idempotencyKey: 'idem-package-regeneration-evidence-supersede',
    });

    await expect(
      repository.getExecutionPackageGenerationRun({ plan_revision_id: ctx.planRevisionId, generation_key: generationKey }),
    ).resolves.toMatchObject({ evidence_refs: evidenceRefs });
  });

  it('rejects package generation when a package-generation manual hold is active', async () => {
    const { app, repository, service } = await createTestApp();
    apps.push(app);
    const ctx = await seedApprovedPlan(app);
    const settings = await repository.setAutomationProjectSettings({
      id: 'automation-settings-package-generation-hold',
      project_id: ctx.project.id,
      repo_id: 'repo-1',
      scope_type: 'repo',
      preset: 'draft_only',
      expected_version: 0,
      reason: 'enable package generation hold test',
      evidence_refs: [],
      actor: { actor_id: actorOwner, actor_class: 'human_admin' },
      now: '2026-05-05T00:28:00.000Z',
    });
    const generationKey = `default:${ctx.planRevisionId}`;
    await repository.requestManualPathHold({
      id: 'manual-hold-package-generation',
      object_type: 'package_generation',
      object_id: ctx.planRevisionId,
      scope_key: buildManualScopeKey({ object_type: 'package_generation', object_id: ctx.planRevisionId, generation_key: generationKey }),
      reason_code: 'needs_human_package_split',
      reason: 'Package split requires manual review.',
      evidence_refs: [],
      requested_by: actorReviewer,
      requested_at: '2026-05-05T00:28:01.000Z',
      idempotency_key: 'manual-hold-package-generation-idem',
      generation_key: generationKey,
    });
    const precondition: AutomationPrecondition = {
      automation_scope: `repo:${ctx.project.id}:repo-1`,
      project_id: ctx.project.id,
      repo_id: 'repo-1',
      automation_settings_version: settings.version,
      capability_fingerprint: settings.capability_fingerprint,
      required_capability: 'canGeneratePackageDrafts',
      actor_class: 'automation_daemon',
      daemon_identity: 'daemon-1',
    };

    await expect(
      (service as AutomationCommandTestService).ensureExecutionPackageDraftsForPlanRevision({
        planRevisionId: ctx.planRevisionId,
        automationPrecondition: precondition,
        actorContext: { authenticatedActorId: 'daemon-1', actorClass: 'automation_daemon', daemonIdentity: 'daemon-1' },
        idempotencyKey: 'idem-package-generation-held',
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'manual_path_hold_active' }),
    });
  });

  it('rejects package regeneration when the same idempotency key is reused for a different generation key', async () => {
    const { app, repository, service } = await createTestApp();
    apps.push(app);
    const ctx = await seedApprovedPlan(app);
    const settings = await repository.setAutomationProjectSettings({
      id: 'automation-settings-package-generation-idem-key',
      project_id: ctx.project.id,
      repo_id: 'repo-1',
      scope_type: 'repo',
      preset: 'draft_only',
      expected_version: 0,
      reason: 'enable package generation idempotency test',
      evidence_refs: [],
      actor: { actor_id: actorOwner, actor_class: 'human_admin' },
      now: '2026-05-05T00:29:00.000Z',
    });
    const precondition: AutomationPrecondition = {
      automation_scope: `repo:${ctx.project.id}:repo-1`,
      project_id: ctx.project.id,
      repo_id: 'repo-1',
      automation_settings_version: settings.version,
      capability_fingerprint: settings.capability_fingerprint,
      required_capability: 'canGeneratePackageDrafts',
      actor_class: 'human_admin',
    };
    const automationService = service as AutomationCommandTestService;
    const defaultGeneration = await automationService.ensureExecutionPackageDraftsForPlanRevision({
      planRevisionId: ctx.planRevisionId,
      automationPrecondition: precondition,
      actorContext: { authenticatedActorId: actorReviewer, actorClass: 'human_admin' },
      idempotencyKey: 'idem-package-generation-cross-key',
    });
    const supersede = await automationService.supersedeExecutionPackageGenerationRun({
      planRevisionId: ctx.planRevisionId,
      generationKey: `default:${ctx.planRevisionId}`,
      expectedGenerationRunVersion: 1,
      reason: 'regenerate split',
      evidenceRefs: [],
      approvedBy: { actor_id: actorReviewer, actor_class: 'human_admin' },
      idempotencyKey: 'idem-package-generation-cross-key-supersede',
    });

    await expect(
      automationService.ensureExecutionPackageDraftsForPlanRevision({
        planRevisionId: ctx.planRevisionId,
        automationPrecondition: precondition,
        actorContext: { authenticatedActorId: actorReviewer, actorClass: 'human_admin' },
        idempotencyKey: 'idem-package-generation-cross-key',
        generationKey: supersede.next_generation_key,
        regenerationApproval: {
          supersededGenerationKey: `default:${ctx.planRevisionId}`,
          supersededExecutionPackageSetId: defaultGeneration.execution_package_set_id,
          supersedeCommandId: supersede.supersede_command_id,
        },
      }),
    ).rejects.toThrow(/idempotency identity|fingerprint changed/i);
  });

  it('rejects package generation for plan revisions without a frozen spec revision target', async () => {
    const { app, repository, service } = await createTestApp();
    apps.push(app);
    const ctx = await seedApprovedPlan(app);
    const planRevision = await repository.getPlanRevision(ctx.planRevisionId);
    expect(planRevision).toBeDefined();
    await repository.savePlanRevision({
      ...planRevision!,
      based_on_spec_revision_id: undefined,
    });
    const settings = await repository.setAutomationProjectSettings({
      id: 'automation-settings-package-missing-spec-target',
      project_id: ctx.project.id,
      repo_id: 'repo-1',
      scope_type: 'repo',
      preset: 'draft_only',
      expected_version: 0,
      reason: 'enable package missing target test',
      evidence_refs: [],
      actor: { actor_id: actorOwner, actor_class: 'human_admin' },
      now: '2026-05-05T00:29:30.000Z',
    });
    const precondition: AutomationPrecondition = {
      automation_scope: `repo:${ctx.project.id}:repo-1`,
      project_id: ctx.project.id,
      repo_id: 'repo-1',
      automation_settings_version: settings.version,
      capability_fingerprint: settings.capability_fingerprint,
      required_capability: 'canGeneratePackageDrafts',
      actor_class: 'automation_daemon',
      daemon_identity: 'daemon-1',
    };

    await expect(
      (service as AutomationCommandTestService).ensureExecutionPackageDraftsForPlanRevision({
        planRevisionId: ctx.planRevisionId,
        automationPrecondition: precondition,
        actorContext: { authenticatedActorId: 'daemon-1', actorClass: 'automation_daemon', daemonIdentity: 'daemon-1' },
        idempotencyKey: 'idem-package-missing-spec-target',
      }),
    ).rejects.toThrow(/based on/i);
  });

  it('stores based_on_spec_revision_id for manually created plan revisions', async () => {
    const { app, repository } = await createTestApp();
    apps.push(app);
    const ctx = await seedApprovedSpec(app);
    const createdPlan = (await request(app.getHttpServer()).post(`/work-items/${ctx.workItem.id}/plans`).send({}).expect(201)).body as Plan;

    const revision = (await request(app.getHttpServer())
      .post(`/plans/${createdPlan.id}/revisions`)
      .send({
        summary: 'Manual plan revision',
        content: 'Plan body',
        implementation_summary: 'Implement the approved spec.',
        split_strategy: 'Single package',
        dependency_order: ['api-package'],
        test_matrix: ['pnpm test'],
        risk_mitigations: [],
        rollback_notes: 'Revert',
      })
      .expect(201)).body as PlanRevision;

    await expect(repository.getPlanRevision(revision.id)).resolves.toMatchObject({
      based_on_spec_revision_id: ctx.specRevisionId,
    });
  });

  it('rejects package generation routes when the plan revision has no frozen spec revision target', async () => {
    const { app, repository } = await createTestApp();
    apps.push(app);
    const ctx = await seedApprovedPlan(app);
    const planRevision = await repository.getPlanRevision(ctx.planRevisionId);
    expect(planRevision).toBeDefined();
    await repository.savePlanRevision({
      ...planRevision!,
      based_on_spec_revision_id: undefined,
    });

    await request(app.getHttpServer()).post(`/plan-revisions/${ctx.planRevisionId}/generate-packages`).send({}).expect(409);
    await request(app.getHttpServer())
      .post(`/plan-revisions/${ctx.planRevisionId}/execution-packages`)
      .send({
        repo_id: 'repo-1',
        objective: 'Implement the package execution workflow.',
        owner_actor_id: actorOwner,
        reviewer_actor_id: actorReviewer,
        qa_owner_actor_id: actorOwner,
        required_checks: [
          {
            check_id: 'unit',
            display_name: 'Unit tests',
            command: 'pnpm test',
            timeout_seconds: 120,
            blocks_review: true,
          },
        ],
        required_artifact_kinds: ['execution_summary'],
        allowed_paths: ['apps/control-plane-api/**'],
        forbidden_paths: ['packages/db/**'],
      })
      .expect(409);
  });

  it('replays generated packages instead of creating duplicate drafts', async () => {
    const { app, service } = await createTestApp();
    apps.push(app);
    const ctx = await seedApprovedPlan(app);

    const first = await request(app.getHttpServer()).post(`/plan-revisions/${ctx.planRevisionId}/generate-packages`).send({}).expect(201);
    const second = await request(app.getHttpServer()).post(`/plan-revisions/${ctx.planRevisionId}/generate-packages`).send({}).expect(201);

    expect(second.body[0].id).toBe(first.body[0].id);
    await expect(service.listExecutionPackages(ctx.workItem.id)).resolves.toHaveLength(1);
  });

  it('rejects run enqueue when runtime safety attestation is missing', async () => {
    const { app, repository, service } = await createTestApp();
    apps.push(app);
    const executionPackage = await seedReadyExecutionPackage(repository);
    const settings = await repository.setAutomationProjectSettings({
      id: 'automation-settings-run-enqueue',
      project_id: executionPackage.project_id,
      repo_id: executionPackage.repo_id,
      scope_type: 'repo',
      preset: 'run_enqueue',
      expected_version: 0,
      reason: 'enable run enqueue dogfood',
      evidence_refs: [],
      actor: { actor_id: actorOwner, actor_class: 'human_admin' },
      now: '2026-05-05T00:30:00.000Z',
    });
    const precondition: AutomationPrecondition = {
      automation_scope: `repo:${executionPackage.project_id}:${executionPackage.repo_id}`,
      project_id: executionPackage.project_id,
      repo_id: executionPackage.repo_id,
      automation_settings_version: settings.version,
      capability_fingerprint: settings.capability_fingerprint,
      required_capability: 'canEnqueueRuns',
      actor_class: 'automation_daemon',
      daemon_identity: 'daemon-1',
    };

    await expect(
      (service as AutomationCommandTestService).enqueueRunIfPackageStillReady({
        packageId: executionPackage.id,
        expectedPackageVersion: executionPackage.version,
        automationPrecondition: precondition,
        idempotencyKey: 'idem-run-enqueue-missing-safety',
        actorContext: { authenticatedActorId: 'daemon-1', actorClass: 'automation_daemon', daemonIdentity: 'daemon-1' },
        executorType: 'mock',
        workflowOnly: true,
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'runtime_hard_limits_unavailable' }),
    });
  });

  it('rejects run enqueue when a local Codex request uses a non-enforcing runtime attestation', async () => {
    const { app, repository, service } = await createTestApp();
    apps.push(app);
    const executionPackage = await seedReadyExecutionPackage(repository);
    const settings = await repository.setAutomationProjectSettings({
      id: 'automation-settings-run-enqueue-local-codex-safety',
      project_id: executionPackage.project_id,
      repo_id: executionPackage.repo_id,
      scope_type: 'repo',
      preset: 'run_enqueue',
      expected_version: 0,
      reason: 'enable run enqueue dogfood',
      evidence_refs: [],
      actor: { actor_id: actorOwner, actor_class: 'human_admin' },
      now: '2026-05-05T00:30:30.000Z',
    });
    const precondition: AutomationPrecondition = {
      automation_scope: `repo:${executionPackage.project_id}:${executionPackage.repo_id}`,
      project_id: executionPackage.project_id,
      repo_id: executionPackage.repo_id,
      automation_settings_version: settings.version,
      capability_fingerprint: settings.capability_fingerprint,
      required_capability: 'canEnqueueRuns',
      actor_class: 'automation_daemon',
      daemon_identity: 'daemon-1',
    };

    await expect(
      (service as AutomationCommandTestService).enqueueRunIfPackageStillReady({
        packageId: executionPackage.id,
        expectedPackageVersion: executionPackage.version,
        automationPrecondition: precondition,
        idempotencyKey: 'idem-run-enqueue-local-codex-non-enforcing',
        actorContext: { authenticatedActorId: 'daemon-1', actorClass: 'automation_daemon', daemonIdentity: 'daemon-1' },
        executorType: 'local_codex',
        workflowOnly: false,
        runtimeSafetyAttestation: runtimeSafetyAttestationForPackage(executionPackage, {
          executor_type: 'local_codex',
          workflow_only: false,
          environment: 'local_dogfood',
          hard_limit_mode: 'test_only_mock',
        }),
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'runtime_hard_limits_not_enforcing' }),
    });
  });

  it('replays a succeeded run enqueue command even when a later attestation is stale', async () => {
    const { app, repository, service } = await createTestApp();
    apps.push(app);
    const executionPackage = await seedReadyExecutionPackage(repository);
    const settings = await repository.setAutomationProjectSettings({
      id: 'automation-settings-run-enqueue-replay',
      project_id: executionPackage.project_id,
      repo_id: executionPackage.repo_id,
      scope_type: 'repo',
      preset: 'run_enqueue',
      expected_version: 0,
      reason: 'enable run enqueue replay',
      evidence_refs: [],
      actor: { actor_id: actorOwner, actor_class: 'human_admin' },
      now: '2026-05-05T00:31:00.000Z',
    });
    const precondition: AutomationPrecondition = {
      automation_scope: `repo:${executionPackage.project_id}:${executionPackage.repo_id}`,
      project_id: executionPackage.project_id,
      repo_id: executionPackage.repo_id,
      automation_settings_version: settings.version,
      capability_fingerprint: settings.capability_fingerprint,
      required_capability: 'canEnqueueRuns',
      actor_class: 'automation_daemon',
      daemon_identity: 'daemon-1',
    };
    const automationService = service as AutomationCommandTestService;

    const first = await automationService.enqueueRunIfPackageStillReady({
      packageId: executionPackage.id,
      expectedPackageVersion: executionPackage.version,
      automationPrecondition: precondition,
      idempotencyKey: 'idem-run-enqueue-replay-stale-attestation',
      actorContext: { authenticatedActorId: 'daemon-1', actorClass: 'automation_daemon', daemonIdentity: 'daemon-1' },
      executorType: 'mock',
      workflowOnly: true,
      runtimeSafetyAttestation: runtimeSafetyAttestationForPackage(executionPackage),
    });
    const replayed = await automationService.enqueueRunIfPackageStillReady({
      packageId: executionPackage.id,
      expectedPackageVersion: executionPackage.version,
      automationPrecondition: precondition,
      idempotencyKey: 'idem-run-enqueue-replay-stale-attestation',
      actorContext: { authenticatedActorId: 'daemon-1', actorClass: 'automation_daemon', daemonIdentity: 'daemon-1' },
      executorType: 'mock',
      workflowOnly: true,
      runtimeSafetyAttestation: runtimeSafetyAttestationForPackage(executionPackage, {
        checked_at: '2026-05-04T23:00:00.000Z',
      }),
    });

    expect(replayed).toEqual(first);
  });

  it('wakes the run worker after a successful run enqueue command', async () => {
    let kickCount = 0;
    const { app, repository, service } = await createTestApp(undefined, {
      kick: () => {
        kickCount += 1;
      },
      drainOnce: async () => undefined,
    });
    apps.push(app);
    const executionPackage = await seedReadyExecutionPackage(repository);
    const settings = await repository.setAutomationProjectSettings({
      id: 'automation-settings-run-enqueue-kick',
      project_id: executionPackage.project_id,
      repo_id: executionPackage.repo_id,
      scope_type: 'repo',
      preset: 'run_enqueue',
      expected_version: 0,
      reason: 'enable run enqueue wake-up test',
      evidence_refs: [],
      actor: { actor_id: actorOwner, actor_class: 'human_admin' },
      now: '2026-05-05T00:31:10.000Z',
    });
    const precondition: AutomationPrecondition = {
      automation_scope: `repo:${executionPackage.project_id}:${executionPackage.repo_id}`,
      project_id: executionPackage.project_id,
      repo_id: executionPackage.repo_id,
      automation_settings_version: settings.version,
      capability_fingerprint: settings.capability_fingerprint,
      required_capability: 'canEnqueueRuns',
      actor_class: 'automation_daemon',
      daemon_identity: 'daemon-1',
    };

    await (service as AutomationCommandTestService).enqueueRunIfPackageStillReady({
      packageId: executionPackage.id,
      expectedPackageVersion: executionPackage.version,
      automationPrecondition: precondition,
      idempotencyKey: 'idem-run-enqueue-kick',
      actorContext: { authenticatedActorId: 'daemon-1', actorClass: 'automation_daemon', daemonIdentity: 'daemon-1' },
      executorType: 'mock',
      workflowOnly: true,
      runtimeSafetyAttestation: runtimeSafetyAttestationForPackage(executionPackage),
    });

    expect(kickCount).toBe(1);
  });

  it('accepts run enqueue when the best-effort worker wake-up fails', async () => {
    const { app, repository, service } = await createTestApp(undefined, {
      kick: () => {
        throw new Error('wake-up unavailable');
      },
      drainOnce: async () => undefined,
    });
    apps.push(app);
    const executionPackage = await seedReadyExecutionPackage(repository);
    const settings = await repository.setAutomationProjectSettings({
      id: 'automation-settings-run-enqueue-kick-failure',
      project_id: executionPackage.project_id,
      repo_id: executionPackage.repo_id,
      scope_type: 'repo',
      preset: 'run_enqueue',
      expected_version: 0,
      reason: 'enable run enqueue best-effort wake-up test',
      evidence_refs: [],
      actor: { actor_id: actorOwner, actor_class: 'human_admin' },
      now: '2026-05-05T00:31:20.000Z',
    });
    const precondition: AutomationPrecondition = {
      automation_scope: `repo:${executionPackage.project_id}:${executionPackage.repo_id}`,
      project_id: executionPackage.project_id,
      repo_id: executionPackage.repo_id,
      automation_settings_version: settings.version,
      capability_fingerprint: settings.capability_fingerprint,
      required_capability: 'canEnqueueRuns',
      actor_class: 'automation_daemon',
      daemon_identity: 'daemon-1',
    };

    await expect(
      (service as AutomationCommandTestService).enqueueRunIfPackageStillReady({
        packageId: executionPackage.id,
        expectedPackageVersion: executionPackage.version,
        automationPrecondition: precondition,
        idempotencyKey: 'idem-run-enqueue-kick-failure',
        actorContext: { authenticatedActorId: 'daemon-1', actorClass: 'automation_daemon', daemonIdentity: 'daemon-1' },
        executorType: 'mock',
        workflowOnly: true,
        runtimeSafetyAttestation: runtimeSafetyAttestationForPackage(executionPackage),
      }),
    ).resolves.toMatchObject({ status: 'accepted', execution_package_id: executionPackage.id });
  });

  it('rejects run enqueue with a stale package version after a ready package edit', async () => {
    const { app, repository, service } = await createTestApp();
    apps.push(app);
    const executionPackage = await seedReadyExecutionPackage(repository);
    const settings = await repository.setAutomationProjectSettings({
      id: 'automation-settings-run-stale-after-edit',
      project_id: executionPackage.project_id,
      repo_id: executionPackage.repo_id,
      scope_type: 'repo',
      preset: 'run_enqueue',
      expected_version: 0,
      reason: 'enable run enqueue stale edit test',
      evidence_refs: [],
      actor: { actor_id: actorOwner, actor_class: 'human_admin' },
      now: '2026-05-05T00:31:20.000Z',
    });
    const patched = (await request(app.getHttpServer())
      .patch(`/execution-packages/${executionPackage.id}`)
      .send({ objective: 'Edited after ready before daemon enqueue.' })
      .expect(200)).body as ExecutionPackage;
    expect(patched.version).toBe(executionPackage.version + 1);
    const precondition: AutomationPrecondition = {
      automation_scope: `repo:${executionPackage.project_id}:${executionPackage.repo_id}`,
      project_id: executionPackage.project_id,
      repo_id: executionPackage.repo_id,
      automation_settings_version: settings.version,
      capability_fingerprint: settings.capability_fingerprint,
      required_capability: 'canEnqueueRuns',
      actor_class: 'automation_daemon',
      daemon_identity: 'daemon-1',
    };

    await expect(
      (service as AutomationCommandTestService).enqueueRunIfPackageStillReady({
        packageId: executionPackage.id,
        expectedPackageVersion: executionPackage.version,
        automationPrecondition: precondition,
        idempotencyKey: 'idem-run-stale-after-edit',
        actorContext: { authenticatedActorId: 'daemon-1', actorClass: 'automation_daemon', daemonIdentity: 'daemon-1' },
        executorType: 'mock',
        workflowOnly: true,
        runtimeSafetyAttestation: runtimeSafetyAttestationForPackage(executionPackage),
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'stale_execution_package_revision' }),
    });
    expect(await repository.listRunSessionsForPackage(executionPackage.id)).toHaveLength(0);
  });

  it('serializes duplicate manual run gate checks for the same package', async () => {
    const repository = new OverlapDetectingRepository();
    const { app } = await createTestApp(repository);
    apps.push(app);
    const executionPackage = await seedReadyExecutionPackage(repository);
    repository.delayActiveRunChecks = true;

    const results = await Promise.allSettled([
      request(app.getHttpServer())
        .post(`/execution-packages/${executionPackage.id}/run`)
        .set(humanAdminHeaders)
        .send({ workflow_only: true }),
      request(app.getHttpServer())
        .post(`/execution-packages/${executionPackage.id}/run`)
        .set(humanAdminHeaders)
        .send({ workflow_only: true }),
    ]);

    expect(repository.maxActiveRunChecksInFlight).toBe(1);
    expect(results.map((result) => (result.status === 'fulfilled' ? result.value.status : 500)).sort()).toEqual([201, 422]);
    expect(await repository.listRunSessionsForPackage(executionPackage.id)).toHaveLength(1);
  });

  it('blocks a run enqueue idempotency key after completion persistence fails post side effect', async () => {
    const { app, repository, service } = await createTestApp();
    apps.push(app);
    const executionPackage = await seedReadyExecutionPackage(repository);
    const settings = await repository.setAutomationProjectSettings({
      id: 'automation-settings-run-complete-failure',
      project_id: executionPackage.project_id,
      repo_id: executionPackage.repo_id,
      scope_type: 'repo',
      preset: 'run_enqueue',
      expected_version: 0,
      reason: 'enable run enqueue completion failure test',
      evidence_refs: [],
      actor: { actor_id: actorOwner, actor_class: 'human_admin' },
      now: '2026-05-05T00:31:35.000Z',
    });
    const originalComplete = repository.completeCommandIdempotency.bind(repository);
    let failCompletion = true;
    repository.completeCommandIdempotency = async (input) => {
      if (input.idempotency_key === 'idem-run-complete-failure' && failCompletion) {
        failCompletion = false;
        throw new Error('simulated command completion write failure');
      }
      return originalComplete(input);
    };
    const precondition: AutomationPrecondition = {
      automation_scope: `repo:${executionPackage.project_id}:${executionPackage.repo_id}`,
      project_id: executionPackage.project_id,
      repo_id: executionPackage.repo_id,
      automation_settings_version: settings.version,
      capability_fingerprint: settings.capability_fingerprint,
      required_capability: 'canEnqueueRuns',
      actor_class: 'automation_daemon',
      daemon_identity: 'daemon-1',
    };
    const input = {
      packageId: executionPackage.id,
      expectedPackageVersion: executionPackage.version,
      automationPrecondition: precondition,
      idempotencyKey: 'idem-run-complete-failure',
      actorContext: { authenticatedActorId: 'daemon-1', actorClass: 'automation_daemon', daemonIdentity: 'daemon-1' },
      executorType: 'mock' as const,
      workflowOnly: true,
      runtimeSafetyAttestation: runtimeSafetyAttestationForPackage(executionPackage),
    };

    await expect((service as AutomationCommandTestService).enqueueRunIfPackageStillReady(input)).rejects.toThrow(
      /simulated command completion write failure/i,
    );
    expect(await repository.listRunSessionsForPackage(executionPackage.id)).toHaveLength(1);
    let activeRunChecks = 0;
    const originalFindActiveRun = repository.findActiveRunSessionForPackage.bind(repository);
    repository.findActiveRunSessionForPackage = async (packageId) => {
      activeRunChecks += 1;
      return originalFindActiveRun(packageId);
    };
    await expect((service as AutomationCommandTestService).enqueueRunIfPackageStillReady(input)).rejects.toThrow(/idempotency/i);
    expect(activeRunChecks).toBe(0);
    expect(await repository.listRunSessionsForPackage(executionPackage.id)).toHaveLength(1);
  });

  it('allows project-scoped run enqueue automation for repo packages in the project', async () => {
    const { app, repository, service } = await createTestApp();
    apps.push(app);
    const executionPackage = await seedReadyExecutionPackage(repository);
    const settings = await repository.setAutomationProjectSettings({
      id: 'automation-settings-run-project-scope',
      project_id: executionPackage.project_id,
      scope_type: 'project',
      preset: 'run_enqueue',
      expected_version: 0,
      reason: 'enable project scoped run enqueue',
      evidence_refs: [],
      actor: { actor_id: actorOwner, actor_class: 'human_admin' },
      now: '2026-05-05T00:31:30.000Z',
    });
    const precondition: AutomationPrecondition = {
      automation_scope: `project:${executionPackage.project_id}`,
      project_id: executionPackage.project_id,
      automation_settings_version: settings.version,
      capability_fingerprint: settings.capability_fingerprint,
      required_capability: 'canEnqueueRuns',
      actor_class: 'automation_daemon',
      daemon_identity: 'daemon-1',
    };

    await expect(
      (service as AutomationCommandTestService).enqueueRunIfPackageStillReady({
        packageId: executionPackage.id,
        expectedPackageVersion: executionPackage.version,
        automationPrecondition: precondition,
        idempotencyKey: 'idem-run-project-scope',
        actorContext: { authenticatedActorId: 'daemon-1', actorClass: 'automation_daemon', daemonIdentity: 'daemon-1' },
        executorType: 'mock',
        workflowOnly: true,
        runtimeSafetyAttestation: runtimeSafetyAttestationForPackage(executionPackage),
      }),
    ).resolves.toMatchObject({ status: 'accepted', execution_package_id: executionPackage.id });
  });

  it('rejects run enqueue when a work item ancestor manual hold is active', async () => {
    const { app, repository, service } = await createTestApp();
    apps.push(app);
    const executionPackage = await seedReadyExecutionPackage(repository);
    const settings = await repository.setAutomationProjectSettings({
      id: 'automation-settings-run-work-item-hold',
      project_id: executionPackage.project_id,
      repo_id: executionPackage.repo_id,
      scope_type: 'repo',
      preset: 'run_enqueue',
      expected_version: 0,
      reason: 'enable ancestor hold test',
      evidence_refs: [],
      actor: { actor_id: actorOwner, actor_class: 'human_admin' },
      now: '2026-05-05T00:31:40.000Z',
    });
    await repository.requestManualPathHold({
      id: 'manual-hold-run-work-item-ancestor',
      object_type: 'work_item',
      object_id: executionPackage.work_item_id,
      scope_key: buildManualScopeKey({ object_type: 'work_item', object_id: executionPackage.work_item_id }),
      reason_code: 'needs_human_review',
      reason: 'Work item is held for manual review.',
      evidence_refs: [],
      requested_by: actorReviewer,
      requested_at: '2026-05-05T00:31:41.000Z',
      idempotency_key: 'manual-hold-run-work-item-ancestor-idem',
    });
    const precondition: AutomationPrecondition = {
      automation_scope: `repo:${executionPackage.project_id}:${executionPackage.repo_id}`,
      project_id: executionPackage.project_id,
      repo_id: executionPackage.repo_id,
      automation_settings_version: settings.version,
      capability_fingerprint: settings.capability_fingerprint,
      required_capability: 'canEnqueueRuns',
      actor_class: 'automation_daemon',
      daemon_identity: 'daemon-1',
    };

    await expect(
      (service as AutomationCommandTestService).enqueueRunIfPackageStillReady({
        packageId: executionPackage.id,
        expectedPackageVersion: executionPackage.version,
        automationPrecondition: precondition,
        idempotencyKey: 'idem-run-enqueue-work-item-hold',
        actorContext: { authenticatedActorId: 'daemon-1', actorClass: 'automation_daemon', daemonIdentity: 'daemon-1' },
        executorType: 'mock',
        workflowOnly: true,
        runtimeSafetyAttestation: runtimeSafetyAttestationForPackage(executionPackage),
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'manual_path_hold_active' }),
    });
  });

  it('rejects run enqueue when a terminal run session manual hold is still active', async () => {
    const { app, repository, service } = await createTestApp();
    apps.push(app);
    const executionPackage = await seedReadyExecutionPackage(repository);
    const terminalRun: RunSession = {
      id: 'run-session-held-terminal',
      execution_package_id: executionPackage.id,
      requested_by_actor_id: actorOwner,
      status: 'succeeded',
      executor_type: 'mock',
      changed_files: [],
      check_results: [],
      artifacts: [],
      log_refs: [],
      summary: 'Terminal run is under manual reconciliation.',
      created_at: '2026-05-05T00:31:42.000Z',
      updated_at: '2026-05-05T00:31:43.000Z',
      finished_at: '2026-05-05T00:31:43.000Z',
    };
    await repository.saveRunSession(terminalRun);
    await repository.requestManualPathHold({
      id: 'manual-hold-run-terminal',
      object_type: 'run_session',
      object_id: terminalRun.id,
      scope_key: buildManualScopeKey({ object_type: 'run_session', object_id: terminalRun.id }),
      reason_code: 'needs_human_review',
      reason: 'Terminal run needs manual reconciliation before another enqueue.',
      evidence_refs: [],
      requested_by: actorReviewer,
      requested_at: '2026-05-05T00:31:44.000Z',
      idempotency_key: 'manual-hold-run-terminal-idem',
    });
    const settings = await repository.setAutomationProjectSettings({
      id: 'automation-settings-run-terminal-hold',
      project_id: executionPackage.project_id,
      repo_id: executionPackage.repo_id,
      scope_type: 'repo',
      preset: 'run_enqueue',
      expected_version: 0,
      reason: 'enable terminal run hold test',
      evidence_refs: [],
      actor: { actor_id: actorOwner, actor_class: 'human_admin' },
      now: '2026-05-05T00:31:45.000Z',
    });
    const precondition: AutomationPrecondition = {
      automation_scope: `repo:${executionPackage.project_id}:${executionPackage.repo_id}`,
      project_id: executionPackage.project_id,
      repo_id: executionPackage.repo_id,
      automation_settings_version: settings.version,
      capability_fingerprint: settings.capability_fingerprint,
      required_capability: 'canEnqueueRuns',
      actor_class: 'automation_daemon',
      daemon_identity: 'daemon-1',
    };

    await expect(
      (service as AutomationCommandTestService).enqueueRunIfPackageStillReady({
        packageId: executionPackage.id,
        expectedPackageVersion: executionPackage.version,
        automationPrecondition: precondition,
        idempotencyKey: 'idem-run-enqueue-terminal-run-hold',
        actorContext: { authenticatedActorId: 'daemon-1', actorClass: 'automation_daemon', daemonIdentity: 'daemon-1' },
        executorType: 'mock',
        workflowOnly: true,
        runtimeSafetyAttestation: runtimeSafetyAttestationForPackage(executionPackage),
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'manual_path_hold_active' }),
    });
  });

  it('rejects run enqueue when a completed review packet manual hold is still active', async () => {
    const { app, repository, service } = await createTestApp();
    apps.push(app);
    const executionPackage = await seedReadyExecutionPackage(repository);
    const terminalRun: RunSession = {
      id: 'run-session-held-review-packet',
      execution_package_id: executionPackage.id,
      requested_by_actor_id: actorOwner,
      status: 'succeeded',
      executor_type: 'mock',
      changed_files: [],
      check_results: [],
      artifacts: [],
      log_refs: [],
      summary: 'Run with completed review packet.',
      created_at: '2026-05-05T00:31:46.000Z',
      updated_at: '2026-05-05T00:31:47.000Z',
      finished_at: '2026-05-05T00:31:47.000Z',
    };
    const reviewPacket: ReviewPacket = {
      id: 'review-packet-held-completed',
      run_session_id: terminalRun.id,
      execution_package_id: executionPackage.id,
      reviewer_actor_id: executionPackage.reviewer_actor_id,
      spec_revision_id: executionPackage.spec_revision_id,
      plan_revision_id: executionPackage.plan_revision_id,
      status: 'completed',
      decision: 'approved',
      summary: 'Completed review remains under manual hold.',
      changed_files: [],
      check_result_summary: 'Required checks passed.',
      self_review: succeededSelfReview(),
      risk_notes: [],
      reviewed_by_actor_id: actorReviewer,
      reviewed_at: '2026-05-05T00:31:48.000Z',
      requested_changes: [],
      created_at: '2026-05-05T00:31:48.000Z',
      updated_at: '2026-05-05T00:31:49.000Z',
      completed_at: '2026-05-05T00:31:49.000Z',
    };
    await repository.saveRunSession(terminalRun);
    await repository.saveReviewPacket(reviewPacket);
    await repository.requestManualPathHold({
      id: 'manual-hold-review-completed',
      object_type: 'review_packet',
      object_id: reviewPacket.id,
      scope_key: buildManualScopeKey({ object_type: 'review_packet', object_id: reviewPacket.id }),
      reason_code: 'needs_human_review',
      reason: 'Completed review packet needs manual reconciliation before another enqueue.',
      evidence_refs: [],
      requested_by: actorReviewer,
      requested_at: '2026-05-05T00:31:50.000Z',
      idempotency_key: 'manual-hold-review-completed-idem',
    });
    const settings = await repository.setAutomationProjectSettings({
      id: 'automation-settings-review-completed-hold',
      project_id: executionPackage.project_id,
      repo_id: executionPackage.repo_id,
      scope_type: 'repo',
      preset: 'run_enqueue',
      expected_version: 0,
      reason: 'enable completed review hold test',
      evidence_refs: [],
      actor: { actor_id: actorOwner, actor_class: 'human_admin' },
      now: '2026-05-05T00:31:51.000Z',
    });
    const precondition: AutomationPrecondition = {
      automation_scope: `repo:${executionPackage.project_id}:${executionPackage.repo_id}`,
      project_id: executionPackage.project_id,
      repo_id: executionPackage.repo_id,
      automation_settings_version: settings.version,
      capability_fingerprint: settings.capability_fingerprint,
      required_capability: 'canEnqueueRuns',
      actor_class: 'automation_daemon',
      daemon_identity: 'daemon-1',
    };

    await expect(
      (service as AutomationCommandTestService).enqueueRunIfPackageStillReady({
        packageId: executionPackage.id,
        expectedPackageVersion: executionPackage.version,
        automationPrecondition: precondition,
        idempotencyKey: 'idem-run-enqueue-completed-review-hold',
        actorContext: { authenticatedActorId: 'daemon-1', actorClass: 'automation_daemon', daemonIdentity: 'daemon-1' },
        executorType: 'mock',
        workflowOnly: true,
        runtimeSafetyAttestation: runtimeSafetyAttestationForPackage(executionPackage),
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'manual_path_hold_active' }),
    });
  });

  it('rejects run enqueue when an upstream execution package dependency is not completed', async () => {
    const { app, repository, service } = await createTestApp();
    apps.push(app);
    const executionPackage = await seedReadyExecutionPackage(repository);
    await repository.saveExecutionPackage({
      ...executionPackage,
      id: 'execution-package-upstream-not-complete',
      objective: 'Upstream dependency package.',
      phase: 'ready',
      activity_state: 'idle',
      gate_state: 'not_submitted',
      resolution: 'none',
      last_run_session_id: undefined,
    });
    await repository.saveExecutionPackageDependency({
      package_id: executionPackage.id,
      depends_on_package_id: 'execution-package-upstream-not-complete',
      dependency_type: 'blocks_run_enqueue',
      reason: 'Upstream package must complete first.',
      created_at: '2026-05-05T00:31:10.000Z',
      updated_at: '2026-05-05T00:31:10.000Z',
    });
    const settings = await repository.setAutomationProjectSettings({
      id: 'automation-settings-run-enqueue-dependency',
      project_id: executionPackage.project_id,
      repo_id: executionPackage.repo_id,
      scope_type: 'repo',
      preset: 'run_enqueue',
      expected_version: 0,
      reason: 'enable dependency gate test',
      evidence_refs: [],
      actor: { actor_id: actorOwner, actor_class: 'human_admin' },
      now: '2026-05-05T00:31:10.000Z',
    });
    const precondition: AutomationPrecondition = {
      automation_scope: `repo:${executionPackage.project_id}:${executionPackage.repo_id}`,
      project_id: executionPackage.project_id,
      repo_id: executionPackage.repo_id,
      automation_settings_version: settings.version,
      capability_fingerprint: settings.capability_fingerprint,
      required_capability: 'canEnqueueRuns',
      actor_class: 'automation_daemon',
      daemon_identity: 'daemon-1',
    };

    await expect(
      (service as AutomationCommandTestService).enqueueRunIfPackageStillReady({
        packageId: executionPackage.id,
        expectedPackageVersion: executionPackage.version,
        automationPrecondition: precondition,
        idempotencyKey: 'idem-run-enqueue-dependency-not-complete',
        actorContext: { authenticatedActorId: 'daemon-1', actorClass: 'automation_daemon', daemonIdentity: 'daemon-1' },
        executorType: 'mock',
        workflowOnly: true,
        runtimeSafetyAttestation: runtimeSafetyAttestationForPackage(executionPackage),
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'automation_gate_pending' }),
    });
  });

  it('rejects run enqueue when the package is linked to an active release gate', async () => {
    const { app, repository, service } = await createTestApp();
    apps.push(app);
    const executionPackage = await seedReadyExecutionPackage(repository);
    const release: Release = {
      id: 'release-run-enqueue-gate',
      org_id: 'org-1',
      project_id: executionPackage.project_id,
      title: 'Release gate blocks automation enqueue',
      phase: 'planning',
      activity_state: 'idle',
      gate_state: 'not_submitted',
      resolution: 'none',
      work_item_ids: [executionPackage.work_item_id],
      execution_package_ids: [executionPackage.id],
      created_by_actor_id: actorOwner,
      created_at: '2026-05-05T00:31:20.000Z',
      updated_at: '2026-05-05T00:31:20.000Z',
    };
    await repository.saveRelease(release);
    const settings = await repository.setAutomationProjectSettings({
      id: 'automation-settings-run-enqueue-release',
      project_id: executionPackage.project_id,
      repo_id: executionPackage.repo_id,
      scope_type: 'repo',
      preset: 'run_enqueue',
      expected_version: 0,
      reason: 'enable release gate test',
      evidence_refs: [],
      actor: { actor_id: actorOwner, actor_class: 'human_admin' },
      now: '2026-05-05T00:31:20.000Z',
    });
    const precondition: AutomationPrecondition = {
      automation_scope: `repo:${executionPackage.project_id}:${executionPackage.repo_id}`,
      project_id: executionPackage.project_id,
      repo_id: executionPackage.repo_id,
      automation_settings_version: settings.version,
      capability_fingerprint: settings.capability_fingerprint,
      required_capability: 'canEnqueueRuns',
      actor_class: 'automation_daemon',
      daemon_identity: 'daemon-1',
    };

    await expect(
      (service as AutomationCommandTestService).enqueueRunIfPackageStillReady({
        packageId: executionPackage.id,
        expectedPackageVersion: executionPackage.version,
        automationPrecondition: precondition,
        idempotencyKey: 'idem-run-enqueue-active-release',
        actorContext: { authenticatedActorId: 'daemon-1', actorClass: 'automation_daemon', daemonIdentity: 'daemon-1' },
        executorType: 'mock',
        workflowOnly: true,
        runtimeSafetyAttestation: runtimeSafetyAttestationForPackage(executionPackage),
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'automation_gate_pending' }),
    });
  });

  it('rejects run enqueue when the package no longer matches the current approved plan revision', async () => {
    const { app, repository, service } = await createTestApp();
    apps.push(app);
    const executionPackage = await seedReadyExecutionPackage(repository);
    const settings = await repository.setAutomationProjectSettings({
      id: 'automation-settings-run-enqueue-stale-plan',
      project_id: executionPackage.project_id,
      repo_id: executionPackage.repo_id,
      scope_type: 'repo',
      preset: 'run_enqueue',
      expected_version: 0,
      reason: 'enable stale graph check',
      evidence_refs: [],
      actor: { actor_id: actorOwner, actor_class: 'human_admin' },
      now: '2026-05-05T00:31:00.000Z',
    });
    const plan = await repository.getPlan(executionPackage.plan_id);
    expect(plan).toBeDefined();
    await repository.savePlan({
      ...plan!,
      current_revision_id: 'plan-revision-superseded-by-human',
      updated_at: '2026-05-05T00:31:30.000Z',
    });
    const precondition: AutomationPrecondition = {
      automation_scope: `repo:${executionPackage.project_id}:${executionPackage.repo_id}`,
      project_id: executionPackage.project_id,
      repo_id: executionPackage.repo_id,
      automation_settings_version: settings.version,
      capability_fingerprint: settings.capability_fingerprint,
      required_capability: 'canEnqueueRuns',
      actor_class: 'automation_daemon',
      daemon_identity: 'daemon-1',
    };

    await expect(
      (service as AutomationCommandTestService).enqueueRunIfPackageStillReady({
        packageId: executionPackage.id,
        expectedPackageVersion: executionPackage.version,
        automationPrecondition: precondition,
        idempotencyKey: 'idem-run-enqueue-stale-plan',
        actorContext: { authenticatedActorId: 'daemon-1', actorClass: 'automation_daemon', daemonIdentity: 'daemon-1' },
        executorType: 'mock',
        workflowOnly: true,
        runtimeSafetyAttestation: runtimeSafetyAttestationForPackage(executionPackage, {
          checked_at: '2026-05-05T00:31:00.000Z',
        }),
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'stale_execution_package_revision' }),
    });
  });

  it('rejects run enqueue when the package plan revision has no frozen spec revision target', async () => {
    const { app, repository, service } = await createTestApp();
    apps.push(app);
    const executionPackage = await seedReadyExecutionPackage(repository);
    const planRevision = await repository.getPlanRevision(executionPackage.plan_revision_id);
    expect(planRevision).toBeDefined();
    await repository.savePlanRevision({
      ...planRevision!,
      based_on_spec_revision_id: undefined,
    });
    const settings = await repository.setAutomationProjectSettings({
      id: 'automation-settings-run-enqueue-missing-spec-target',
      project_id: executionPackage.project_id,
      repo_id: executionPackage.repo_id,
      scope_type: 'repo',
      preset: 'run_enqueue',
      expected_version: 0,
      reason: 'enable missing plan target check',
      evidence_refs: [],
      actor: { actor_id: actorOwner, actor_class: 'human_admin' },
      now: '2026-05-05T00:32:00.000Z',
    });
    const precondition: AutomationPrecondition = {
      automation_scope: `repo:${executionPackage.project_id}:${executionPackage.repo_id}`,
      project_id: executionPackage.project_id,
      repo_id: executionPackage.repo_id,
      automation_settings_version: settings.version,
      capability_fingerprint: settings.capability_fingerprint,
      required_capability: 'canEnqueueRuns',
      actor_class: 'automation_daemon',
      daemon_identity: 'daemon-1',
    };

    await expect(
      (service as AutomationCommandTestService).enqueueRunIfPackageStillReady({
        packageId: executionPackage.id,
        expectedPackageVersion: executionPackage.version,
        automationPrecondition: precondition,
        idempotencyKey: 'idem-run-enqueue-missing-spec-target',
        actorContext: { authenticatedActorId: 'daemon-1', actorClass: 'automation_daemon', daemonIdentity: 'daemon-1' },
        executorType: 'mock',
        workflowOnly: true,
        runtimeSafetyAttestation: runtimeSafetyAttestationForPackage(executionPackage),
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'stale_execution_package_revision' }),
    });
  });

  it('rejects run enqueue when the package plan revision has no frozen spec revision target', async () => {
    const { app, repository } = await createTestApp();
    apps.push(app);
    const executionPackage = await seedReadyExecutionPackage(repository);
    const planRevision = await repository.getPlanRevision(executionPackage.plan_revision_id);
    expect(planRevision).toBeDefined();
    await repository.savePlanRevision({
      ...planRevision!,
      based_on_spec_revision_id: undefined,
    });

    await request(app.getHttpServer())
      .post(`/execution-packages/${executionPackage.id}/run`)
      .set(humanAdminHeaders)
      .send({ workflow_only: true })
      .expect(422);
  });
});
