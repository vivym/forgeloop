import { randomUUID } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { MessageEvent } from '@nestjs/common';
import {
  type AutomationActorClass,
  type AutomationActorContext,
  type AutomationPrecondition,
  type AutomationProjectSettings,
  type CommandIdempotencyRecord,
  type ExecutionPackage,
  type ManualPathHold,
  type ObjectEvent,
  type Plan,
  type PlanRevision,
  type Project,
  type ProjectRepo,
  type ReviewPacket,
  type RunCommand,
  type RunEvent,
  type RunRuntimeMetadata,
  type RunSession,
  type RuntimeSafetyAttestation,
  type Spec,
  type SpecRevision,
  type StatusHistory,
  type WorkItem,
  DomainError,
  isWorkItemAutomationTerminal,
  transitionExecutionPackage,
  transitionReviewPacket,
  transitionRunSession,
  transitionSpecPlan,
  transitionWorkItem,
  validateExecutionPackage,
  validateForceRerunAllowed,
  validatePackageEditAllowed,
} from '@forgeloop/domain';
import type { P0Repository, TraceLinkRecord } from '@forgeloop/db';
import type {
  ArtifactRef,
  EvidenceChainResponse,
  ExecutorType,
  PublicRunEvent,
  RunAcceptedResponse,
  RunEventListResponse,
  RunOperatorCommandResponse,
  SelfReviewInput,
  SelfReviewResult,
} from '@forgeloop/contracts';
import { publicRunEventSchema } from '@forgeloop/contracts';
import type { RunWorker } from '@forgeloop/run-worker';
import { buildRunSpec, loadRunContext } from '@forgeloop/workflow';
import { Observable } from 'rxjs';

import {
  P0_DEMO_ACTOR_ID_FALLBACK,
  P0_REPOSITORY,
  RUN_DURABILITY_MODE,
  type RunDurabilityMode,
} from '../modules/core/control-plane-tokens';
import {
  createRunEventStreamToken as signRunEventStreamToken,
  resolveRunEventStreamTokenSecret,
  type ActorContext,
  type RunEventStreamTokenPayload,
  verifyRunEventStreamToken,
} from './actor-context';
import type {
  ActorCommandDto,
  AutomationActorContextDto,
  CreateExecutionPackageDto,
  CreatePlanRevisionDto,
  CreateProjectDto,
  CreateProjectRepoDto,
  CreateSpecRevisionDto,
  CreateWorkItemDto,
  DisableAutomationCapabilitiesDto,
  PatchExecutionPackageDto,
  ReviewDecisionDto,
  RunControlDto,
  RunInputDto,
  RunPackageDto,
  RequestManualPathHoldDto,
  ResolveManualPathHoldDto,
  MarkPackageReadyDto,
  SetAutomationCapabilitiesDto,
} from './dto';
import {
  assertAutomationPreconditionStillCurrent,
  assertCommandCapabilityStillEnabled,
  assertNoActiveHolds,
  assertPackageRunEligible,
  assertRuntimeSafetyAttestation,
  automationPreconditionFingerprint,
  commandIdempotencyTarget,
  normalizeAutomationPrecondition,
} from './automation-command-helpers';
import { buildEvidenceChain } from './evidence-chain';
import { serializePublicRunSession } from './run-session-serialization';

export {
  P0_DEMO_ACTOR_ID_FALLBACK,
  P0_REPOSITORY,
  RUN_DURABILITY_MODE,
  type RunDurabilityMode,
} from '../modules/core/control-plane-tokens';

type RunReplacementRecordedPayload = {
  mode: 'rerun_package' | 'force_rerun_package';
  execution_package_id: string;
  work_item_id: string;
  new_run_session_id: string;
  previous_run_session_id: string;
  triggering_review_packet_id?: string;
  previous_review_packet_id?: string;
  new_review_packet_id?: string;
};

const actorOrSystem = (actorId: string | undefined): string => actorId ?? 'system';

const statusForPackage = (executionPackage: ExecutionPackage): string =>
  `${executionPackage.phase}/${executionPackage.activity_state}/${executionPackage.gate_state}`;

const traceReplacementModeFor = (mode: 'rerun' | 'force_rerun'): RunReplacementRecordedPayload['mode'] =>
  mode === 'rerun' ? 'rerun_package' : 'force_rerun_package';

export const RUN_WORKER = Symbol('RUN_WORKER');

const terminalRunStatuses = new Set<RunSession['status']>(['succeeded', 'failed', 'timed_out', 'cancelled']);
const commandClaimTtlMs = 5 * 60 * 1000;
const productGateRejectedActorClasses = new Set<AutomationActorClass>([
  'automation_daemon',
  'source_adapter',
  'external_tracker',
  'repo_policy',
]);
const uuidBackedP0IdPrefixes = new Set([
  'project',
  'work-item',
  'spec',
  'spec-revision',
  'plan',
  'plan-revision',
  'execution-package',
  'run-session',
  'decision',
]);
const streamPollMs = 500;
const runEventStreamTokenTtlMs = 60_000;
const beginningOfStreamCursor = '0000000000';

type RunEventAccessOptions = {
  after?: string;
  actorId?: string;
  actorContext?: ActorContext;
  streamToken?: string;
};

type EnsurePlanDraftResult = { plan_id: string; plan_revision_id: string; status: 'created' | 'existing' };
type CommandBoundaryOutcome<T> = { ok: true; value: T } | { ok: false; error: unknown };
type LegacyGeneratedPackageMetadata = {
  execution_package_set_id: string;
  generation_key: string;
  package_key: string;
  sequence: number;
  manifest_digest: string;
};
type EnsurePackageDraftsInput = {
  planRevisionId: string;
  automationPrecondition: AutomationPrecondition;
  actorContext: ActorContext;
  idempotencyKey: string;
  generationKey?: string;
  regenerationApproval?: {
    supersededGenerationKey: string;
    supersededExecutionPackageSetId: string;
    supersedeCommandId: string;
  };
};
type EnsurePackageDraftsResult = { execution_package_set_id: string; package_ids: string[]; status: 'created' | 'existing' };
type EnqueueRunInput = {
  packageId: string;
  expectedPackageVersion: number;
  automationPrecondition: AutomationPrecondition;
  idempotencyKey: string;
  actorContext: ActorContext;
  executorType: ExecutorType;
  workflowOnly: boolean;
  runtimeSafetyAttestation?: RuntimeSafetyAttestation;
};
type SupersedeExecutionPackageGenerationRunCommandInput = {
  planRevisionId: string;
  generationKey: string;
  expectedGenerationRunVersion: number;
  reason: string;
  evidenceRefs: ArtifactRef[];
  approvedBy: AutomationActorContext;
  idempotencyKey: string;
};
type SupersedeExecutionPackageGenerationRunResult = {
  execution_package_set_id: string;
  status: 'superseded';
  next_generation_key: string;
  supersede_command_id: string;
};

@Injectable()
export class P0Service {
  private idCounter = 0;
  private timeCounter = 0;
  private durableTimeMs = 0;
  private readonly durableInstanceId = randomUUID().replace(/-/g, '').slice(0, 12);

  constructor(
    @Inject(P0_REPOSITORY) private readonly repository: P0Repository,
    @Inject(RUN_WORKER) private readonly runWorker: RunWorker,
    @Inject(RUN_DURABILITY_MODE) private readonly durabilityMode: RunDurabilityMode,
    @Inject(P0_DEMO_ACTOR_ID_FALLBACK) private readonly allowDemoActorIdFallback: boolean,
  ) {}

  async createProject(dto: CreateProjectDto): Promise<Project> {
    const at = this.now();
    const project: Project = {
      id: this.id('project'),
      name: this.required(dto.name, 'name'),
      repo_ids: [],
      ...(dto.owner_actor_id !== undefined ? { owner_actor_id: dto.owner_actor_id } : {}),
      created_at: at,
      updated_at: at,
    };
    await this.repository.saveProject(project);
    await this.event('project', project.id, 'project_created', dto.owner_actor_id, {});
    return project;
  }

  async getProject(projectId: string): Promise<Project> {
    return this.requireFound(await this.repository.getProject(projectId), `Project ${projectId}`);
  }

  async createProjectRepo(projectId: string, dto: CreateProjectRepoDto): Promise<ProjectRepo> {
    const project = await this.getProject(projectId);
    const at = this.now();
    const repo: ProjectRepo = {
      id: this.id('project-repo'),
      repo_id: this.required(dto.repo_id, 'repo_id'),
      project_id: project.id,
      name: this.required(dto.name, 'name'),
      status: 'active',
      local_path: this.required(dto.local_path, 'local_path'),
      default_branch: dto.default_branch ?? 'main',
      ...(dto.remote_url !== undefined ? { remote_url: dto.remote_url } : {}),
      base_commit_sha: this.required(dto.base_commit_sha, 'base_commit_sha'),
      created_at: at,
      updated_at: at,
    };
    await this.repository.saveProjectRepo(repo);
    await this.repository.saveProject({ ...project, repo_ids: [...new Set([...project.repo_ids, repo.repo_id])], updated_at: at });
    await this.event('project_repo', repo.id, 'repo_bound', project.owner_actor_id, { project_id: project.id });
    return repo;
  }

  listProjectRepos(projectId: string): Promise<ProjectRepo[]> {
    return this.repository.listProjectRepos(projectId);
  }

  async getAutomationCapabilities(projectId: string, repoId?: string): Promise<AutomationProjectSettings> {
    await this.getProject(projectId);
    await this.assertRepoScopeCurrent(this.repository, projectId, repoId);
    return this.repository.resolveAutomationProjectSettings({
      project_id: projectId,
      ...(repoId === undefined ? {} : { repo_id: repoId }),
    });
  }

  async setAutomationCapabilities(
    projectId: string,
    dto: SetAutomationCapabilitiesDto,
    actorContext?: ActorContext,
  ): Promise<AutomationProjectSettings> {
    await this.getProject(projectId);
    await this.assertRepoScopeCurrent(this.repository, projectId, dto.repo_id);
    const settings = await this.repository.setAutomationProjectSettings({
      id: this.id('automation-settings'),
      project_id: projectId,
      ...(dto.repo_id === undefined ? {} : { repo_id: dto.repo_id }),
      scope_type: dto.repo_id === undefined ? 'project' : 'repo',
      preset: dto.preset,
      expected_version: dto.expected_version,
      reason: this.required(dto.reason, 'reason'),
      evidence_refs: dto.evidence_refs,
      actor: this.automationActorContext(dto.actor_context, actorContext, { requireTrusted: true }),
      now: this.now(),
    });
    await this.event('automation_project_settings', settings.id, 'automation_capabilities_updated', dto.actor_context.actor_id, {
      project_id: projectId,
      ...(dto.repo_id === undefined ? {} : { repo_id: dto.repo_id }),
      preset: settings.preset,
      version: settings.version,
    });
    return settings;
  }

  async disableAutomation(
    projectId: string,
    dto: DisableAutomationCapabilitiesDto,
    actorContext?: ActorContext,
  ): Promise<AutomationProjectSettings> {
    await this.getProject(projectId);
    await this.assertRepoScopeCurrent(this.repository, projectId, dto.repo_id);
    const settings = await this.repository.disableAutomationProjectSettings({
      project_id: projectId,
      ...(dto.repo_id === undefined ? {} : { repo_id: dto.repo_id }),
      expected_version: dto.expected_version,
      reason: this.required(dto.reason, 'reason'),
      evidence_refs: dto.evidence_refs,
      actor: this.automationActorContext(dto.actor_context, actorContext, { requireTrusted: true }),
      now: this.now(),
    });
    await this.event('automation_project_settings', settings.id, 'automation_capabilities_disabled', dto.actor_context.actor_id, {
      project_id: projectId,
      ...(dto.repo_id === undefined ? {} : { repo_id: dto.repo_id }),
      version: settings.version,
    });
    return settings;
  }

  async requestManualPath(dto: RequestManualPathHoldDto, actorContext?: ActorContext): Promise<ManualPathHold> {
    const requestActor = this.optionalAutomationActorContext(dto.actor_context, actorContext);
    const precondition = dto.automation_precondition as AutomationPrecondition | undefined;
    const isDaemonOrigin = dto.source_automation_action_id !== undefined || requestActor?.actor_class === 'automation_daemon';
    if (isDaemonOrigin && precondition === undefined) {
      throw new BadRequestException('daemon-origin manual path requests require automation_precondition');
    }
    if (
      isDaemonOrigin &&
      (actorContext?.authenticatedActorId === undefined ||
        actorContext.actorClass !== 'automation_daemon' ||
        actorContext.daemonIdentity === undefined)
    ) {
      throw new UnauthorizedException('daemon-origin manual path requests require trusted daemon headers');
    }
    this.assertManualPreconditionActorMatches(precondition, requestActor, dto.requested_by);
    return this.repository.withObjectLock(`manual-path-hold:${dto.object_type}:${dto.object_id}:${dto.scope_key}`, async (repository) => {
      if (precondition !== undefined) {
        await this.assertAutomationPreconditionForHold(repository, precondition);
      }
      return repository.requestManualPathHold({
        id: this.id('manual-path-hold'),
        object_type: dto.object_type,
        object_id: dto.object_id,
        scope_key: dto.scope_key,
        reason_code: dto.reason_code,
        reason: dto.reason,
        evidence_refs: dto.evidence_refs,
        requested_by: dto.requested_by,
        requested_at: this.now(),
        idempotency_key: dto.idempotency_key,
        ...(dto.source_automation_action_id === undefined ? {} : { source_automation_action_id: dto.source_automation_action_id }),
        ...(dto.generation_key === undefined ? {} : { generation_key: dto.generation_key }),
        ...(dto.gate_key === undefined ? {} : { gate_key: dto.gate_key }),
      });
    });
  }

  async resolveManualPath(holdId: string, dto: ResolveManualPathHoldDto, actorContext?: ActorContext): Promise<ManualPathHold> {
    const resolveActor = this.optionalAutomationActorContext(dto.actor_context, actorContext);
    if (resolveActor === undefined || actorContext?.authenticatedActorId === undefined || actorContext.actorClass === undefined) {
      throw new UnauthorizedException('Trusted actor headers are required to resolve manual path holds');
    }
    if (
      resolveActor !== undefined &&
      resolveActor.actor_class !== 'human' &&
      resolveActor.actor_class !== 'human_admin' &&
      resolveActor.actor_class !== 'system_bootstrap' &&
      resolveActor.actor_class !== 'migration'
    ) {
      throw new ForbiddenException('automation actors cannot resolve manual path holds');
    }
    if (resolveActor.actor_id !== dto.resolved_by) {
      throw new ForbiddenException('resolved_by must match the trusted actor');
    }
    return this.repository.withObjectLock(`manual-path-hold:${holdId}`, async (repository) => {
      const existing = await repository.getManualPathHold(holdId);
      if (existing !== undefined) {
        if (existing.status !== 'active') {
          if (existing.status === 'resolved' && existing.resolved_by === dto.resolved_by && existing.resolution === dto.resolution) {
            return existing;
          }
          throw new ConflictException('Manual path hold is not active');
        }
        if (
          actorContext?.actorClass === 'automation_daemon' &&
          (existing.requested_by === actorContext.authenticatedActorId || existing.requested_by === actorContext.daemonIdentity)
        ) {
          throw new ForbiddenException('automation daemon cannot resolve its own manual path hold');
        }
      }
      const hold = await repository.resolveManualPathHold({
        hold_id: holdId,
        resolved_by: dto.resolved_by,
        resolved_at: this.now(),
        resolution: dto.resolution,
      });
      await this.eventWithRepository(repository, 'manual_path_hold', hold.id, 'manual_path_hold_resolved', dto.resolved_by, {
        resolution: dto.resolution,
      });
      return hold;
    });
  }

  async createWorkItem(dto: CreateWorkItemDto): Promise<WorkItem> {
    await this.getProject(dto.project_id);
    const workItem = transitionWorkItem(undefined, {
      type: 'create',
      id: this.id('work-item'),
      project_id: dto.project_id,
      kind: dto.kind,
      title: this.required(dto.title, 'title'),
      goal: this.required(dto.goal, 'goal'),
      success_criteria: dto.success_criteria ?? [],
      priority: this.required(dto.priority, 'priority'),
      risk: this.required(dto.risk, 'risk'),
      owner_actor_id: this.required(dto.owner_actor_id, 'owner_actor_id'),
      at: this.now(),
    });
    await this.repository.saveWorkItem(workItem);
    await this.event('work_item', workItem.id, 'work_item_created', workItem.owner_actor_id, {});
    return workItem;
  }

  listWorkItems(projectId?: string): Promise<WorkItem[]> {
    return this.repository.listWorkItems(projectId);
  }

  async getWorkItem(workItemId: string): Promise<WorkItem> {
    return this.requireFound(await this.repository.getWorkItem(workItemId), `WorkItem ${workItemId}`);
  }

  async createSpec(workItemId: string): Promise<Spec> {
    return this.repository.withObjectLock(`work-item:${workItemId}`, async (repository) => {
      const workItem = this.requireFound(await repository.getWorkItem(workItemId), `WorkItem ${workItemId}`);
      const spec = transitionSpecPlan(undefined, {
        type: 'create',
        entity_type: 'spec',
        id: this.id('spec'),
        work_item_id: workItem.id,
        at: this.now(),
      }) as Spec;
      await repository.saveSpec(spec);
      await repository.saveWorkItem({ ...workItem, current_spec_id: spec.id, updated_at: spec.updated_at });
      await this.eventWithRepository(repository, 'spec', spec.id, 'spec_created', workItem.owner_actor_id, { work_item_id: workItem.id });
      return spec;
    });
  }

  async getSpec(specId: string): Promise<Spec> {
    return this.requireFound(await this.repository.getSpec(specId), `Spec ${specId}`);
  }

  listSpecRevisions(specId: string): Promise<SpecRevision[]> {
    return this.repository.listSpecRevisions(specId);
  }

  async getSpecRevision(specRevisionId: string): Promise<SpecRevision> {
    return this.requireFound(await this.repository.getSpecRevision(specRevisionId), `SpecRevision ${specRevisionId}`);
  }

  async createSpecRevision(specId: string, dto: CreateSpecRevisionDto): Promise<SpecRevision> {
    const spec = await this.getSpec(specId);
    const revision = await this.saveSpecRevision(spec, {
      summary: dto.summary,
      content: dto.content,
      background: dto.background,
      goals: dto.goals,
      scope_in: dto.scope_in,
      scope_out: dto.scope_out,
      acceptance_criteria: dto.acceptance_criteria,
      risk_notes: dto.risk_notes ?? [],
      test_strategy_summary: dto.test_strategy_summary,
      ...(dto.structured_document !== undefined ? { structured_document: dto.structured_document } : {}),
      ...(dto.author_actor_id !== undefined ? { author_actor_id: dto.author_actor_id } : {}),
    });
    await this.event('spec_revision', revision.id, 'spec_revision_created', dto.author_actor_id, { spec_id: spec.id });
    return revision;
  }

  async generateSpecDraft(specId: string): Promise<SpecRevision> {
    const spec = await this.getSpec(specId);
    const workItem = await this.getWorkItem(spec.work_item_id);
    const drafting = transitionSpecPlan(spec, { type: 'generate_draft_start', at: this.now() }) as Spec;
    await this.repository.saveSpec(drafting);
    await this.event('spec', spec.id, 'spec_draft_generation_started', workItem.owner_actor_id, {});

    const revision = await this.saveSpecRevision(drafting, {
      summary: `Draft spec for ${workItem.title}`,
      content: [
        `Goal: ${workItem.goal}`,
        `Success criteria: ${workItem.success_criteria.join('; ')}`,
        'Scope: implement only the P0 behavior needed for this work item.',
        'Test strategy: cover command flow and persisted evidence.',
      ].join('\n\n'),
      background: workItem.goal,
      goals: [workItem.goal],
      scope_in: [`Deliver ${workItem.title}`],
      scope_out: ['Release, deploy, and non-P0 workflows'],
      acceptance_criteria: [...workItem.success_criteria],
      risk_notes: [workItem.risk],
      test_strategy_summary: `Validate ${workItem.title} with API and workflow tests.`,
      structured_document: { generated_by: 'mock_spec_draft_adapter', work_item_id: workItem.id },
      author_actor_id: 'ai-spec-drafter',
    });
    const updated = transitionSpecPlan({ ...drafting, current_revision_id: revision.id }, {
      type: 'generate_draft_success',
      at: this.now(),
    }) as Spec;
    await this.repository.saveSpec(updated);
    await this.event('spec_revision', revision.id, 'spec_draft_generated', 'ai-spec-drafter', { spec_id: spec.id });
    return revision;
  }

  async submitSpecForApproval(specId: string, dto: ActorCommandDto, actorContext?: ActorContext): Promise<Spec> {
    const actorId = this.actorIdForProductGate(dto.actor_id, actorContext);
    const spec = await this.getSpec(specId);
    const updated = transitionSpecPlan(spec, { type: 'submit_for_approval', at: this.now() }) as Spec;
    await this.repository.saveSpec(updated);
    await this.updateWorkItemForSpecPlan(updated.work_item_id, 'submit_spec', actorId);
    await this.history('spec', spec.id, spec.status, updated.status, actorId);
    return updated;
  }

  async approveSpec(specId: string, dto: ActorCommandDto, actorContext?: ActorContext): Promise<Spec> {
    const actorId = this.actorIdForProductGate(dto.actor_id, actorContext);
    const spec = await this.getSpec(specId);
    const updated = transitionSpecPlan(spec, { type: 'approve', at: this.now() }) as Spec;
    await this.repository.saveSpec(updated);
    await this.updateWorkItemForSpecPlan(updated.work_item_id, 'approve_spec', actorId);
    await this.history('spec', spec.id, spec.status, updated.status, actorId);
    await this.decision('spec', spec.id, actorOrSystem(actorId), 'approved', 'Spec approved.');
    return updated;
  }

  async requestSpecChanges(specId: string, dto: ActorCommandDto, actorContext?: ActorContext): Promise<Spec> {
    const actorId = this.actorIdForProductGate(dto.actor_id, actorContext);
    const spec = await this.getSpec(specId);
    const updated = transitionSpecPlan(spec, { type: 'request_changes', at: this.now() }) as Spec;
    await this.repository.saveSpec(updated);
    await this.updateWorkItemForSpecPlan(updated.work_item_id, 'request_spec_changes', actorId);
    await this.history('spec', spec.id, spec.status, updated.status, actorId);
    return updated;
  }

  async ensurePlanDraftForApprovedSpec(
    workItemId: string,
    specRevisionId: string,
    automationPrecondition: AutomationPrecondition,
    idempotencyKey: string,
  ): Promise<EnsurePlanDraftResult> {
    const precondition = normalizeAutomationPrecondition(automationPrecondition);
    if (precondition.required_capability !== 'canGeneratePlanDraft') {
      throw new BadRequestException('ensurePlanDraftForApprovedSpec requires canGeneratePlanDraft precondition');
    }
    const preconditionFingerprint = automationPreconditionFingerprint(precondition);
    const actorScope = `${precondition.actor_class}:${precondition.daemon_identity ?? 'unknown'}`;
    const claimToken = randomUUID();
    const claimedAt = this.now();

    const outcome = await this.repository.withObjectLock(`work-item:${workItemId}`, async (
      repository,
    ): Promise<CommandBoundaryOutcome<EnsurePlanDraftResult>> => {
      const claim = await repository.claimCommandIdempotency({
        id: this.id('command-idempotency'),
        command_name: 'ensure_plan_draft_for_approved_spec',
        idempotency_key: idempotencyKey,
        ...commandIdempotencyTarget({
          objectType: 'work_item',
          objectId: workItemId,
          revisionId: specRevisionId,
        }),
        precondition_json: precondition as unknown as Record<string, unknown>,
        precondition_fingerprint: preconditionFingerprint,
        actor_scope: actorScope,
        claim_token: claimToken,
        locked_until: this.lockedUntil(claimedAt),
        now: claimedAt,
      });
      const replayed = this.replayedPlanDraftResult(claim.result_json);
      const replayable = this.replayableCommandResultOrThrow(claim, replayed);
      if (replayable !== undefined) {
        return { ok: true, value: { ...replayable, status: 'existing' } };
      }

      try {
        const result = await this.writePlanDraftForApprovedSpec(repository, workItemId, specRevisionId, precondition);
        await repository.completeCommandIdempotency({
          idempotency_key: idempotencyKey,
          claim_token: claimToken,
          result_json: result,
          finished_at: this.now(),
        });
        return { ok: true, value: result };
      } catch (error) {
        await this.blockCommandIdempotencyAfterError(repository, {
          idempotency_key: idempotencyKey,
          claim_token: claimToken,
          error,
        });
        return { ok: false, error };
      }
    });
    if (!outcome.ok) {
      throw outcome.error;
    }
    return outcome.value;
  }

  async ensureExecutionPackageDraftsForPlanRevision(input: EnsurePackageDraftsInput): Promise<EnsurePackageDraftsResult> {
    const precondition = normalizeAutomationPrecondition(input.automationPrecondition);
    if (precondition.required_capability !== 'canGeneratePackageDrafts') {
      throw new BadRequestException('ensureExecutionPackageDraftsForPlanRevision requires canGeneratePackageDrafts precondition');
    }
    const defaultGenerationKey = `default:${input.planRevisionId}`;
    const generationKey = input.generationKey ?? defaultGenerationKey;
    if (input.actorContext.actorClass === 'automation_daemon' && generationKey !== defaultGenerationKey) {
      throw new BadRequestException('automation daemon may only use the default package generation key');
    }
    if (generationKey !== defaultGenerationKey) {
      if (
        input.actorContext.actorClass !== 'human' &&
        input.actorContext.actorClass !== 'human_admin'
      ) {
        throw new ForbiddenException('non-default package generation requires human approval');
      }
      if (
        input.regenerationApproval === undefined ||
        generationKey.startsWith(`regenerate:${input.planRevisionId}:`) !== true
      ) {
        throw new BadRequestException('non-default package generation requires a matching supersede approval');
      }
    }
    const preconditionFingerprint = automationPreconditionFingerprint(precondition);
    const actorScope = `${precondition.actor_class}:${precondition.daemon_identity ?? input.actorContext.authenticatedActorId ?? 'unknown'}`;
    const claimToken = randomUUID();
    const claimedAt = this.now();

    const outcome = await this.repository.withObjectLock(
      `automation-command:ensure-package-drafts:${input.planRevisionId}:${generationKey}`,
      async (repository): Promise<CommandBoundaryOutcome<EnsurePackageDraftsResult>> => {
      const claim = await repository.claimCommandIdempotency({
        id: this.id('command-idempotency'),
        command_name: 'ensure_execution_package_drafts_for_plan_revision',
        idempotency_key: input.idempotencyKey,
        ...commandIdempotencyTarget({
          objectType: 'plan_revision',
          objectId: input.planRevisionId,
          revisionId: generationKey,
        }),
        precondition_json: precondition as unknown as Record<string, unknown>,
        precondition_fingerprint: preconditionFingerprint,
        actor_scope: actorScope,
        claim_token: claimToken,
        locked_until: this.lockedUntil(claimedAt),
        now: claimedAt,
      });
      const replayed = this.replayedPackageDraftsResult(claim.result_json);
      const replayable = this.replayableCommandResultOrThrow(claim, replayed);
      if (replayable !== undefined) {
        return { ok: true, value: { ...replayable, status: 'existing' } };
      }

      try {
        const result = await this.writeExecutionPackageDraftsForPlanRevision(repository, {
          planRevisionId: input.planRevisionId,
          generationKey,
          claimToken,
          precondition,
          ...(input.regenerationApproval === undefined ? {} : { regenerationApproval: input.regenerationApproval }),
        });
        await repository.completeCommandIdempotency({
          idempotency_key: input.idempotencyKey,
          claim_token: claimToken,
          result_json: result,
          finished_at: this.now(),
        });
        return { ok: true, value: result };
      } catch (error) {
        await this.blockCommandIdempotencyAfterError(repository, {
          idempotency_key: input.idempotencyKey,
          claim_token: claimToken,
          error,
        });
        return { ok: false, error };
      }
      },
    );
    if (!outcome.ok) {
      throw outcome.error;
    }
    return outcome.value;
  }

  async enqueueRunIfPackageStillReady(input: EnqueueRunInput): Promise<RunAcceptedResponse> {
    const precondition = normalizeAutomationPrecondition(input.automationPrecondition);
    if (precondition.required_capability !== 'canEnqueueRuns') {
      throw new BadRequestException('enqueueRunIfPackageStillReady requires canEnqueueRuns precondition');
    }
    const preconditionFingerprint = automationPreconditionFingerprint(precondition);
    const actorScope = `${precondition.actor_class}:${precondition.daemon_identity ?? input.actorContext.authenticatedActorId ?? 'unknown'}`;
    const claimToken = randomUUID();
    const claimedAt = this.now();

    const outcome = await this.repository.withObjectLock(`execution-package:${input.packageId}`, async (
      repository,
    ): Promise<CommandBoundaryOutcome<RunAcceptedResponse>> => {
      const claim = await repository.claimCommandIdempotency({
        id: this.id('command-idempotency'),
        command_name: 'enqueue_run_if_package_still_ready',
        idempotency_key: input.idempotencyKey,
        ...commandIdempotencyTarget({
          objectType: 'execution_package',
          objectId: input.packageId,
          version: input.expectedPackageVersion,
        }),
        precondition_json: precondition as unknown as Record<string, unknown>,
        precondition_fingerprint: preconditionFingerprint,
        actor_scope: actorScope,
        claim_token: claimToken,
        locked_until: this.lockedUntil(claimedAt),
        now: claimedAt,
      });
      const replayed = this.replayedRunAcceptedResponse(claim.result_json);
      const replayable = this.replayableCommandResultOrThrow(claim, replayed);
      if (replayable !== undefined) {
        return { ok: true, value: replayable };
      }

      try {
        assertRuntimeSafetyAttestation(input.runtimeSafetyAttestation, {
          executorType: input.executorType,
          workflowOnly: input.workflowOnly,
          now: this.now(),
        });
        const settings = await repository.resolveAutomationProjectSettings({
          project_id: precondition.project_id,
          ...(precondition.repo_id === undefined ? {} : { repo_id: precondition.repo_id }),
        });
        assertAutomationPreconditionStillCurrent(settings, precondition);
        assertCommandCapabilityStillEnabled(settings, 'canEnqueueRuns');
        await this.assertRepoScopeCurrent(repository, precondition.project_id, precondition.repo_id);
        const executionPackage = this.requireFound(await repository.getExecutionPackage(input.packageId), `ExecutionPackage ${input.packageId}`);
        if (
          executionPackage.project_id !== precondition.project_id ||
          (precondition.repo_id !== undefined && executionPackage.repo_id !== precondition.repo_id)
        ) {
          throw new ConflictException('Execution package scope no longer matches automation precondition');
        }
        await this.assertExecutionPackageGraphStillCurrent(repository, executionPackage);
        const activeHolds = await repository.listActiveManualPathHolds({
          object_type: 'execution_package',
          object_id: executionPackage.id,
        });
        const packageGenerationHolds =
          executionPackage.generation_key === undefined
            ? []
            : await repository.listActiveManualPathHolds({
                object_type: 'package_generation',
                object_id: executionPackage.plan_revision_id,
                generation_key: executionPackage.generation_key,
              });
        const openReviewPacket = await repository.findOpenReviewPacketForPackage(executionPackage.id);
        const activeRunSession = await repository.findActiveRunSessionForPackage(executionPackage.id);
        const runSessions = await repository.listRunSessionsForPackage(executionPackage.id);
        const reviewPackets = await repository.listReviewPacketsForPackage(executionPackage.id);
        const runSessionHolds = (
          await Promise.all(
            runSessions.map((runSession) =>
              repository.listActiveManualPathHolds({ object_type: 'run_session', object_id: runSession.id }),
            ),
          )
        ).flat();
        const reviewPacketHolds = (
          await Promise.all(
            reviewPackets.map((reviewPacket) =>
              repository.listActiveManualPathHolds({ object_type: 'review_packet', object_id: reviewPacket.id }),
            ),
          )
        ).flat();
        assertPackageRunEligible({
          executionPackage,
          expectedPackageVersion: input.expectedPackageVersion,
          activeHolds: [...activeHolds, ...packageGenerationHolds, ...runSessionHolds, ...reviewPacketHolds],
          ...(openReviewPacket === undefined ? {} : { openReviewPacket }),
          ...(activeRunSession === undefined ? {} : { activeRunSession }),
        });
        const response = await this.enqueueRunWithRepository(repository, executionPackage, input);
        await repository.completeCommandIdempotency({
          idempotency_key: input.idempotencyKey,
          claim_token: claimToken,
          result_json: response,
          finished_at: this.now(),
        });
        return { ok: true, value: response };
      } catch (error) {
        await this.blockCommandIdempotencyAfterError(repository, {
          idempotency_key: input.idempotencyKey,
          claim_token: claimToken,
          error,
        });
        return { ok: false, error };
      }
    });
    if (!outcome.ok) {
      throw outcome.error;
    }
    return outcome.value;
  }

  async supersedeExecutionPackageGenerationRun(
    input: SupersedeExecutionPackageGenerationRunCommandInput,
  ): Promise<SupersedeExecutionPackageGenerationRunResult> {
    if (input.approvedBy.actor_class !== 'human' && input.approvedBy.actor_class !== 'human_admin') {
      throw new ForbiddenException('package generation supersede requires a human approver');
    }
    const claimToken = randomUUID();
    const claimedAt = this.now();
    const supersedeCommandId = this.id('command-idempotency');
    const outcome = await this.repository.withObjectLock(`automation-command:supersede-package-generation:${input.planRevisionId}`, async (
      repository,
    ): Promise<CommandBoundaryOutcome<SupersedeExecutionPackageGenerationRunResult>> => {
      const claim = await repository.claimCommandIdempotency({
        id: supersedeCommandId,
        command_name: 'supersede_execution_package_generation_run',
        idempotency_key: input.idempotencyKey,
        ...commandIdempotencyTarget({
          objectType: 'plan_revision',
          objectId: input.planRevisionId,
          revisionId: input.generationKey,
          version: input.expectedGenerationRunVersion,
        }),
        actor_scope: `${input.approvedBy.actor_class}:${input.approvedBy.actor_id}`,
        claim_token: claimToken,
        locked_until: this.lockedUntil(claimedAt),
        now: claimedAt,
      });
      const replayed = this.replayedSupersedeGenerationResult(claim.result_json);
      const replayable = this.replayableCommandResultOrThrow(claim, replayed);
      if (replayable !== undefined) {
        return { ok: true, value: replayable };
      }
      try {
        const superseded = await repository.supersedeExecutionPackageGenerationRun({
          plan_revision_id: input.planRevisionId,
          execution_package_set_id: `generation:${input.planRevisionId}:${input.generationKey}`,
          expected_version: input.expectedGenerationRunVersion,
          supersede_command_id: supersedeCommandId,
          superseded_by: input.approvedBy.actor_id,
          superseded_at: this.now(),
          reason: input.reason,
          evidence_refs: input.evidenceRefs,
        });
        if (superseded.next_generation_key === undefined) {
          throw new ConflictException('Superseded generation did not produce a next generation key');
        }
        const result: SupersedeExecutionPackageGenerationRunResult = {
          execution_package_set_id: superseded.execution_package_set_id,
          status: 'superseded',
          next_generation_key: superseded.next_generation_key,
          supersede_command_id: supersedeCommandId,
        };
        await repository.completeCommandIdempotency({
          idempotency_key: input.idempotencyKey,
          claim_token: claimToken,
          result_json: result,
          finished_at: this.now(),
        });
        return { ok: true, value: result };
      } catch (error) {
        await this.blockCommandIdempotencyAfterError(repository, {
          idempotency_key: input.idempotencyKey,
          claim_token: claimToken,
          error,
        });
        return { ok: false, error };
      }
    });
    if (!outcome.ok) {
      throw outcome.error;
    }
    return outcome.value;
  }

  async createPlan(workItemId: string): Promise<Plan> {
    return this.repository.withObjectLock(`work-item:${workItemId}`, async (repository) => {
      const workItem = this.requireFound(await repository.getWorkItem(workItemId), `WorkItem ${workItemId}`);
      const plan = transitionSpecPlan(undefined, {
        type: 'create',
        entity_type: 'plan',
        id: this.id('plan'),
        work_item_id: workItem.id,
        at: this.now(),
      }) as Plan;
      await repository.savePlan(plan);
      await repository.saveWorkItem({ ...workItem, current_plan_id: plan.id, updated_at: plan.updated_at });
      await this.eventWithRepository(repository, 'plan', plan.id, 'plan_created', workItem.owner_actor_id, { work_item_id: workItem.id });
      return plan;
    });
  }

  async getPlan(planId: string): Promise<Plan> {
    return this.requireFound(await this.repository.getPlan(planId), `Plan ${planId}`);
  }

  listPlanRevisions(planId: string): Promise<PlanRevision[]> {
    return this.repository.listPlanRevisions(planId);
  }

  async getPlanRevision(planRevisionId: string): Promise<PlanRevision> {
    return this.requireFound(await this.repository.getPlanRevision(planRevisionId), `PlanRevision ${planRevisionId}`);
  }

  async createPlanRevision(planId: string, dto: CreatePlanRevisionDto): Promise<PlanRevision> {
    const plan = await this.getPlan(planId);
    const workItem = await this.getWorkItem(plan.work_item_id);
    const spec = await this.requireApprovedCurrentSpec(workItem);
    const revision = await this.savePlanRevision(plan, {
      summary: dto.summary,
      content: dto.content,
      implementation_summary: dto.implementation_summary,
      split_strategy: dto.split_strategy,
      dependency_order: dto.dependency_order ?? [],
      test_matrix: dto.test_matrix,
      risk_mitigations: dto.risk_mitigations ?? [],
      rollback_notes: dto.rollback_notes,
      based_on_spec_revision_id: spec.current_revision_id!,
      ...(dto.structured_document !== undefined ? { structured_document: dto.structured_document } : {}),
      ...(dto.author_actor_id !== undefined ? { author_actor_id: dto.author_actor_id } : {}),
    });
    await this.event('plan_revision', revision.id, 'plan_revision_created', dto.author_actor_id, { plan_id: plan.id });
    return revision;
  }

  async generatePlanDraft(planId: string): Promise<PlanRevision> {
    const plan = await this.getPlan(planId);
    const workItem = await this.getWorkItem(plan.work_item_id);
    const spec = await this.requireApprovedCurrentSpec(workItem);
    const specRevision = await this.getSpecRevision(spec.current_revision_id!);
    const drafting = transitionSpecPlan(plan, { type: 'generate_draft_start', at: this.now() }) as Plan;
    await this.repository.savePlan(drafting);
    await this.event('plan', plan.id, 'plan_draft_generation_started', workItem.owner_actor_id, {});

    const revision = await this.savePlanRevision(drafting, {
      summary: `Draft plan for ${workItem.title}`,
      content: `Implement the approved spec revision ${specRevision.id} with a bounded package and required checks.`,
      implementation_summary: `Deliver ${workItem.title} through the P0 control plane.`,
      split_strategy: 'Create one repo-bound execution package for the approved plan.',
      dependency_order: ['api-package'],
      test_matrix: ['pnpm test tests/api'],
      risk_mitigations: specRevision.risk_notes.length === 0 ? ['Keep package scope narrow.'] : specRevision.risk_notes,
      rollback_notes: 'Revert the execution package changes.',
      based_on_spec_revision_id: specRevision.id,
      structured_document: { generated_by: 'mock_plan_draft_adapter', spec_revision_id: specRevision.id },
      author_actor_id: 'ai-plan-drafter',
    });
    const updated = transitionSpecPlan({ ...drafting, current_revision_id: revision.id }, {
      type: 'generate_draft_success',
      at: this.now(),
    }) as Plan;
    await this.repository.savePlan(updated);
    await this.event('plan_revision', revision.id, 'plan_draft_generated', 'ai-plan-drafter', { plan_id: plan.id });
    return revision;
  }

  async submitPlanForApproval(planId: string, dto: ActorCommandDto, actorContext?: ActorContext): Promise<Plan> {
    const actorId = this.actorIdForProductGate(dto.actor_id, actorContext);
    const plan = await this.getPlan(planId);
    const updated = transitionSpecPlan(plan, { type: 'submit_for_approval', at: this.now() }) as Plan;
    await this.repository.savePlan(updated);
    await this.updateWorkItemForSpecPlan(updated.work_item_id, 'submit_plan', actorId);
    await this.history('plan', plan.id, plan.status, updated.status, actorId);
    return updated;
  }

  async approvePlan(planId: string, dto: ActorCommandDto, actorContext?: ActorContext): Promise<Plan> {
    const actorId = this.actorIdForProductGate(dto.actor_id, actorContext);
    const plan = await this.getPlan(planId);
    const updated = transitionSpecPlan(plan, { type: 'approve', at: this.now() }) as Plan;
    await this.repository.savePlan(updated);
    await this.updateWorkItemForSpecPlan(updated.work_item_id, 'approve_plan', actorId);
    await this.history('plan', plan.id, plan.status, updated.status, actorId);
    await this.decision('plan', plan.id, actorOrSystem(actorId), 'approved', 'Plan approved.');
    return updated;
  }

  async requestPlanChanges(planId: string, dto: ActorCommandDto, actorContext?: ActorContext): Promise<Plan> {
    const actorId = this.actorIdForProductGate(dto.actor_id, actorContext);
    const plan = await this.getPlan(planId);
    const updated = transitionSpecPlan(plan, { type: 'request_changes', at: this.now() }) as Plan;
    await this.repository.savePlan(updated);
    await this.updateWorkItemForSpecPlan(updated.work_item_id, 'request_plan_changes', actorId);
    await this.history('plan', plan.id, plan.status, updated.status, actorId);
    return updated;
  }

  async generatePackages(planRevisionId: string): Promise<ExecutionPackage[]> {
    return this.repository.withObjectLock(`plan-revision:${planRevisionId}`, async (repository) => {
      const context = await this.packageContextFromRepository(repository, planRevisionId);
      const repo = (await repository.listProjectRepos(context.project.id))[0];
      if (repo === undefined) {
        throw new BadRequestException('Project has no bound repos');
      }
      const generationKey = `legacy:${planRevisionId}`;
      const existingPackage = (await repository.listExecutionPackagesForWorkItem(context.workItem.id)).find(
        (executionPackage) =>
          executionPackage.plan_revision_id === context.planRevision.id &&
          executionPackage.generation_key === generationKey &&
          executionPackage.package_key === 'api-package',
      );
      if (existingPackage !== undefined) {
        return [existingPackage];
      }
      const executionPackage = await this.createExecutionPackageFromContext(
        repository,
        context,
        {
          repo_id: repo.repo_id,
          objective: `Implement ${context.workItem.title}.`,
          owner_actor_id: context.workItem.owner_actor_id,
          reviewer_actor_id: 'actor-reviewer',
          qa_owner_actor_id: 'actor-qa',
          required_checks: [
            {
              check_id: 'unit',
              display_name: 'Unit tests',
              command: 'pnpm test tests/api',
              timeout_seconds: 120,
              blocks_review: true,
            },
          ],
          required_artifact_kinds: ['execution_summary'],
          allowed_paths: ['apps/control-plane-api/**', 'tests/api/**'],
          forbidden_paths: ['packages/db/**'],
        },
        {
          execution_package_set_id: `legacy:${planRevisionId}`,
          generation_key: generationKey,
          package_key: 'api-package',
          sequence: 0,
          manifest_digest: 'api-package-v1',
        },
      );
      await this.eventWithRepository(repository, 'execution_package', executionPackage.id, 'package_draft_generated', 'ai-package-drafter', {
        plan_revision_id: planRevisionId,
      });
      return [executionPackage];
    });
  }

  async createExecutionPackage(planRevisionId: string, dto: CreateExecutionPackageDto): Promise<ExecutionPackage> {
    return this.repository.withObjectLock(`plan-revision:${planRevisionId}`, async (repository) =>
      this.createExecutionPackageFromContext(repository, await this.packageContextFromRepository(repository, planRevisionId), dto),
    );
  }

  async listExecutionPackages(workItemId: string): Promise<ExecutionPackage[]> {
    return this.repository.listExecutionPackagesForWorkItem(workItemId);
  }

  async getExecutionPackage(packageId: string): Promise<ExecutionPackage> {
    return this.requireFound(await this.repository.getExecutionPackage(packageId), `ExecutionPackage ${packageId}`);
  }

  async patchExecutionPackage(packageId: string, dto: PatchExecutionPackageDto): Promise<ExecutionPackage> {
    return this.repository.withObjectLock(`execution-package:${packageId}`, async (repository) => {
      const executionPackage = this.requireFound(await repository.getExecutionPackage(packageId), `ExecutionPackage ${packageId}`);
      const openPacket = await repository.findOpenReviewPacketForPackage(packageId);
      if (openPacket === undefined) {
        validatePackageEditAllowed(executionPackage);
      } else {
        await this.archiveReviewPacket(openPacket, 'package_edited', repository);
      }

      const editablePackage: ExecutionPackage =
        executionPackage.phase === 'review'
          ? {
              ...executionPackage,
              phase: 'draft',
              activity_state: 'idle',
              gate_state: 'not_submitted',
              resolution: 'none',
            }
          : executionPackage;
      const patch = Object.fromEntries(Object.entries(dto).filter(([, value]) => value !== undefined)) as Partial<ExecutionPackage>;
      const updated: ExecutionPackage = {
        ...editablePackage,
        ...patch,
        version: editablePackage.version + 1,
        updated_at: this.now(),
      };
      const project = this.requireFound(await repository.getProject(updated.project_id), `Project ${updated.project_id}`);
      validateExecutionPackage(project, updated);
      await repository.saveExecutionPackage(updated);
      await this.eventWithRepository(repository, 'execution_package', updated.id, 'package_edited', updated.owner_actor_id, {});
      return updated;
    });
  }

  async markPackageReady(packageId: string, dto: MarkPackageReadyDto, actorContext?: ActorContext): Promise<ExecutionPackage> {
    const actorId = this.actorIdForProductGate(dto.actor_id, actorContext);
    return this.repository.withObjectLock(`execution-package:${packageId}`, async (repository) => {
      const executionPackage = this.requireFound(await repository.getExecutionPackage(packageId), `ExecutionPackage ${packageId}`);
      if (executionPackage.version !== dto.expected_package_version) {
        throw new UnprocessableEntityException({
          code: 'stale_execution_package_revision',
          message: 'Execution package version changed before mark ready.',
        });
      }
      await this.assertExecutionPackageGraphStillCurrent(repository, executionPackage);
      const updated = transitionExecutionPackage(executionPackage, { type: 'mark_ready', at: this.now() });
      validateExecutionPackage(this.requireFound(await repository.getProject(updated.project_id), `Project ${updated.project_id}`), updated);
      await repository.saveExecutionPackage(updated);
      await this.historyWithRepository(repository, 'execution_package', packageId, statusForPackage(executionPackage), statusForPackage(updated), actorId);
      return updated;
    });
  }

  async runPackage(
    packageId: string,
    dto: RunPackageDto,
    mode: 'run' | 'rerun' | 'force_rerun',
    actorContext: ActorContext = {},
  ): Promise<RunAcceptedResponse> {
    const result = await this.repository.withObjectLock(`execution-package:${packageId}`, async (repository) =>
      this.runPackageWithRepository(repository, packageId, dto, mode, actorContext),
    );
    this.kickRunWorker();
    return result;
  }

  private async runPackageWithRepository(
    repository: P0Repository,
    packageId: string,
    dto: RunPackageDto,
    mode: 'run' | 'rerun' | 'force_rerun',
    actorContext: ActorContext,
  ): Promise<RunAcceptedResponse> {
    const executionPackage = this.requireFound(await repository.getExecutionPackage(packageId), `ExecutionPackage ${packageId}`);
    await this.assertExecutionPackageGraphStillCurrent(repository, executionPackage);
    const reviewPackets = await repository.listReviewPacketsForPackage(packageId);
    const requestedByActorId = this.resolveRunActor({
      ...(actorContext.authenticatedActorId === undefined ? {} : { authenticatedActorId: actorContext.authenticatedActorId }),
      ...(dto.requested_by_actor_id === undefined ? {} : { demoActorId: dto.requested_by_actor_id }),
    });
    if (mode === 'run') {
      const activeRunSession = await repository.findActiveRunSessionForPackage(packageId);
      if (activeRunSession !== undefined) {
        throw new UnprocessableEntityException({
          code: 'automation_gate_pending',
          message: 'Active run session blocks duplicate run enqueue.',
        });
      }
      const openReviewPacket = await repository.findOpenReviewPacketForPackage(packageId);
      if (openReviewPacket !== undefined) {
        throw new UnprocessableEntityException({
          code: 'automation_gate_pending',
          message: 'Open review packet blocks run enqueue.',
        });
      }
    }
    const validation = this.validateRunRequest(packageId, executionPackage, reviewPackets, dto, mode, requestedByActorId);
    const previousReviewPacket =
      mode === 'run'
        ? undefined
        : reviewPackets.find((reviewPacket) => reviewPacket.run_session_id === validation.previousRunSessionId);
    if (mode === 'force_rerun' && validation.currentOpenReviewPacket !== undefined) {
      try {
        validateForceRerunAllowed(executionPackage, reviewPackets, validation.requestedByActorId);
      } catch (error) {
        if (error instanceof DomainError && error.code === 'FORCE_RERUN_FORBIDDEN') {
          throw new ForbiddenException(error.message);
        }
        throw error;
      }
      await this.archiveReviewPacket(validation.currentOpenReviewPacket, 'force_rerun', repository);
    }
    const workflowOnly = dto.workflow_only ?? false;
    const executorType: ExecutorType = workflowOnly ? 'mock' : (dto.executor_type ?? 'mock');
    const runSessionId = this.id('run-session');
    const queuedAt = this.now();
    const queuedPackage =
      mode === 'force_rerun'
        ? transitionExecutionPackage(executionPackage, {
            type: 'force_rerun',
            run_session_id: runSessionId,
            has_open_review_packet: true,
            at: queuedAt,
          })
        : transitionExecutionPackage(executionPackage, {
            type: mode,
            run_session_id: runSessionId,
            at: queuedAt,
          });
    const runSession = transitionRunSession(undefined, {
      type: 'create',
      id: runSessionId,
      execution_package_id: packageId,
      requested_by_actor_id: validation.requestedByActorId,
      executor_type: executorType,
      at: queuedAt,
    });
    await repository.saveExecutionPackage(queuedPackage);
    await repository.saveRunSession({
      ...runSession,
      runtime_metadata: this.initialRuntimeMetadata(),
    });
    const context = await loadRunContext(repository, runSessionId);
    const runSpec = buildRunSpec(context, { defaultExecutorType: executorType, workflowOnly });
    await repository.saveRunSession({
      ...runSession,
      executor_type: executorType,
      run_spec: runSpec,
      runtime_metadata: this.initialRuntimeMetadata(),
    });
    await repository.appendRunEvent({
      id: this.id('run-event'),
      run_session_id: runSessionId,
      event_type: 'run_queued',
      source: 'api',
      visibility: 'public',
      summary: 'Run queued.',
      payload: { execution_package_id: packageId, mode, workflow_only: workflowOnly, executor_type: executorType },
      created_at: queuedAt,
    });
    await this.eventWithRepository(
      repository,
      'execution_package',
      packageId,
      mode === 'force_rerun' ? 'force_rerun_requested' : `${mode}_requested`,
      validation.requestedByActorId,
      { run_session_id: runSessionId },
    );
    if (mode !== 'run' && validation.previousRunSessionId !== undefined) {
      const triggeringReviewPacket = validation.currentOpenReviewPacket ?? previousReviewPacket;
      await this.recordRunReplacementTrace({
        mode,
        executionPackage: queuedPackage,
        previousRunSessionId: validation.previousRunSessionId,
        newRunSessionId: runSessionId,
        requestedByActorId: validation.requestedByActorId,
        ...(previousReviewPacket === undefined ? {} : { previousReviewPacket }),
        ...(triggeringReviewPacket === undefined ? {} : { triggeringReviewPacket }),
        at: queuedAt,
      });
    }

    return {
      status: 'accepted',
      run_session_id: runSessionId,
      execution_package_id: packageId,
    };
  }

  private validateRunRequest(
    packageId: string,
    executionPackage: ExecutionPackage,
    reviewPackets: ReviewPacket[],
    dto: RunPackageDto,
    mode: 'run' | 'rerun' | 'force_rerun',
    requestedByActorId: string,
  ): { requestedByActorId: string; previousRunSessionId?: string; currentOpenReviewPacket?: ReviewPacket } {
    if (dto.execution_package_id !== undefined && dto.execution_package_id !== packageId) {
      throw new BadRequestException('execution_package_id must match packageId path parameter');
    }

    if (mode === 'run') {
      return { requestedByActorId };
    }

    const previousRunSessionId = this.required(dto.previous_run_session_id, 'previous_run_session_id');
    if (executionPackage.last_run_session_id !== previousRunSessionId) {
      throw new BadRequestException('previous_run_session_id must match the package current last_run_session_id');
    }

    if (mode === 'rerun') {
      return { requestedByActorId, previousRunSessionId };
    }

    if (dto.force !== true) {
      throw new BadRequestException('force must be true for force-rerun');
    }
    this.required(dto.force_reason, 'force_reason');

    const currentOpenReviewPacket = reviewPackets.find(
      (reviewPacket) =>
        reviewPacket.run_session_id === previousRunSessionId &&
        reviewPacket.decision === 'none' &&
        (reviewPacket.status === 'ready' || reviewPacket.status === 'in_review'),
    );

    if (currentOpenReviewPacket === undefined) {
      throw new BadRequestException('force-rerun requires a current open ready or in_review ReviewPacket');
    }

    return { requestedByActorId, previousRunSessionId, currentOpenReviewPacket };
  }

  async getRunSession(runSessionId: string): Promise<RunSession> {
    return serializePublicRunSession(
      await this.withWorkerLeaseMetadata(
        this.requireFound(await this.repository.getRunSession(runSessionId), `RunSession ${runSessionId}`),
      ),
    );
  }

  async listRunEvents(runSessionId: string, options: RunEventAccessOptions = {}): Promise<RunEventListResponse> {
    const runSession = this.requireFound(await this.repository.getRunSession(runSessionId), `RunSession ${runSessionId}`);
    const actorId = this.resolveStreamActor(runSession, {
      ...(options.actorContext === undefined ? {} : { actorContext: options.actorContext }),
      ...(options.actorId === undefined ? {} : { demoActorId: options.actorId }),
      ...(options.streamToken === undefined ? {} : { streamToken: options.streamToken }),
    });
    await this.assertRunViewerAllowed(runSession, actorId);
    const rawEvents = await this.repository.listRunEvents(runSessionId, options.after === undefined ? {} : { after: options.after });
    const events = this.publicRunEvents(rawEvents);
    return {
      events,
      next_cursor: rawEvents.at(-1)?.cursor ?? options.after ?? beginningOfStreamCursor,
      has_more: false,
    };
  }

  async streamRunEvents(runSessionId: string, options: RunEventAccessOptions = {}): Promise<Observable<MessageEvent>> {
    await this.assertRunEventViewer(runSessionId, options);

    return new Observable<MessageEvent>((subscriber) => {
      let stopped = false;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      let cursor: string | undefined;

      const poll = async (): Promise<void> => {
        try {
          if (cursor === undefined) {
            cursor = await this.resolveRunEventStreamCursor(runSessionId, options.after);
          }
          const response = await this.listRunEvents(runSessionId, {
            ...(cursor === undefined ? {} : { after: cursor }),
            ...(options.actorId === undefined ? {} : { actorId: options.actorId }),
            ...(options.streamToken === undefined ? {} : { streamToken: options.streamToken }),
            ...(options.actorContext === undefined ? {} : { actorContext: options.actorContext }),
          });
          for (const event of response.events) {
            cursor = event.cursor;
            subscriber.next({ data: event });
          }
          if (!stopped) {
            timeout = setTimeout(() => {
              void poll();
            }, streamPollMs);
          }
        } catch (error) {
          subscriber.error(error);
        }
      };

      void poll();
      return () => {
        stopped = true;
        if (timeout !== undefined) {
          clearTimeout(timeout);
        }
      };
    });
  }

  private async resolveRunEventStreamCursor(runSessionId: string, after: string | undefined): Promise<string> {
    if (after !== undefined) {
      return after;
    }

    const latest = await this.repository.getLatestRunEvent(runSessionId);
    return latest?.cursor ?? beginningOfStreamCursor;
  }

  private async assertRunEventViewer(runSessionId: string, options: RunEventAccessOptions): Promise<void> {
    const runSession = this.requireFound(await this.repository.getRunSession(runSessionId), `RunSession ${runSessionId}`);
    const actorId = this.resolveStreamActor(runSession, {
      ...(options.actorContext === undefined ? {} : { actorContext: options.actorContext }),
      ...(options.actorId === undefined ? {} : { demoActorId: options.actorId }),
      ...(options.streamToken === undefined ? {} : { streamToken: options.streamToken }),
    });
    await this.assertRunViewerAllowed(runSession, actorId);
  }

  async createRunInputCommand(
    runSessionId: string,
    dto: RunInputDto,
    actorContext: ActorContext = {},
  ): Promise<RunOperatorCommandResponse> {
    return this.createRunOperatorCommand(runSessionId, 'input', {
      actorContext,
      ...(dto.actor_id === undefined ? {} : { demoActorId: dto.actor_id }),
      payload: { message: dto.message },
      ...(dto.target_turn_id === undefined ? {} : { targetTurnId: dto.target_turn_id }),
      eventSummary: 'User input submitted.',
    });
  }

  async createRunCancelCommand(
    runSessionId: string,
    dto: RunControlDto,
    actorContext: ActorContext = {},
  ): Promise<RunOperatorCommandResponse> {
    return this.createRunOperatorCommand(runSessionId, 'cancel', {
      actorContext,
      ...(dto.actor_id === undefined ? {} : { demoActorId: dto.actor_id }),
      payload: dto.reason === undefined ? {} : { reason: dto.reason },
      eventSummary: 'Cancel requested.',
    });
  }

  async createRunResumeCommand(
    runSessionId: string,
    dto: RunControlDto,
    actorContext: ActorContext = {},
  ): Promise<RunOperatorCommandResponse> {
    return this.createRunOperatorCommand(runSessionId, 'resume', {
      actorContext,
      ...(dto.actor_id === undefined ? {} : { demoActorId: dto.actor_id }),
      payload: dto.reason === undefined ? {} : { reason: dto.reason },
      eventSummary: 'Run resume requested.',
    });
  }

  async createRunEventStreamToken(
    runSessionId: string,
    actorContext: ActorContext = {},
    options: { demoActorId?: string } = {},
  ): Promise<{ token: string; expires_at: string }> {
    const runSession = this.requireFound(await this.repository.getRunSession(runSessionId), `RunSession ${runSessionId}`);
    const actorId = this.resolveRunActor({
      ...(actorContext.authenticatedActorId === undefined ? {} : { authenticatedActorId: actorContext.authenticatedActorId }),
      ...(options.demoActorId === undefined ? {} : { demoActorId: options.demoActorId }),
    });
    await this.assertRunViewerAllowed(runSession, actorId);

    const expiresAt = new Date(Date.now() + runEventStreamTokenTtlMs).toISOString();
    const payload: RunEventStreamTokenPayload = {
      run_session_id: runSession.id,
      actor_id: actorId,
      expires_at: expiresAt,
      nonce: randomUUID(),
    };
    return {
      token: signRunEventStreamToken(payload, resolveRunEventStreamTokenSecret(process.env)),
      expires_at: expiresAt,
    };
  }

  async getReviewPacket(reviewPacketId: string): Promise<ReviewPacket> {
    return this.requireFound(await this.repository.getReviewPacket(reviewPacketId), `ReviewPacket ${reviewPacketId}`);
  }

  async approveReviewPacket(reviewPacketId: string, dto: ReviewDecisionDto, actorContext?: ActorContext): Promise<Record<string, unknown>> {
    const actorId = this.actorIdForProductGate(dto.reviewed_by_actor_id, actorContext);
    const reviewPacket = await this.getReviewPacket(reviewPacketId);
    const updated = transitionReviewPacket(reviewPacket, {
      type: 'approve',
      summary: dto.summary,
      reviewed_by_actor_id: actorId,
      reviewed_at: dto.reviewed_at,
      at: this.now(),
    });
    await this.repository.saveReviewPacket(updated);
    await this.decision('review_packet', reviewPacketId, actorId, 'approved', dto.summary);
    await this.applyReviewToPackage(updated, 'review_approved');
    return { review_packet_id: reviewPacketId, status: 'completed', decision: 'approved', recorded_at: updated.updated_at };
  }

  async requestReviewChanges(reviewPacketId: string, dto: ReviewDecisionDto, actorContext?: ActorContext): Promise<Record<string, unknown>> {
    const actorId = this.actorIdForProductGate(dto.reviewed_by_actor_id, actorContext);
    const reviewPacket = await this.getReviewPacket(reviewPacketId);
    const updated = transitionReviewPacket(reviewPacket, {
      type: 'request_changes',
      summary: dto.summary,
      reviewed_by_actor_id: actorId,
      reviewed_at: dto.reviewed_at,
      requested_changes: dto.requested_changes ?? [],
      at: this.now(),
    });
    await this.repository.saveReviewPacket(updated);
    await this.decision('review_packet', reviewPacketId, actorId, 'changes_requested', dto.summary);
    await this.applyReviewToPackage(updated, 'review_changes_requested');
    return { review_packet_id: reviewPacketId, status: 'completed', decision: 'changes_requested', recorded_at: updated.updated_at };
  }

  async evidenceChain(workItemId: string, reviewPacketId?: string): Promise<EvidenceChainResponse> {
    const workItem = await this.getWorkItem(workItemId);
    const response = await buildEvidenceChain(this.repository, workItem, {
      ...(reviewPacketId === undefined ? {} : { reviewPacketId }),
      generatedAt: this.now(),
    });
    return this.requireFound(response, `ReviewPacket ${reviewPacketId}`);
  }

  private async assertAutomationPreconditionForHold(repository: P0Repository, precondition: AutomationPrecondition): Promise<void> {
    const settings = await repository.resolveAutomationProjectSettings({
      project_id: precondition.project_id,
      ...(precondition.repo_id === undefined ? {} : { repo_id: precondition.repo_id }),
    });
    assertAutomationPreconditionStillCurrent(settings, precondition);
    assertCommandCapabilityStillEnabled(settings, precondition.required_capability);
    await this.assertRepoScopeCurrent(repository, precondition.project_id, precondition.repo_id);
  }

  private async assertRepoScopeCurrent(
    repository: P0Repository,
    projectId: string,
    repoId: string | undefined,
  ): Promise<void> {
    if (repoId === undefined) {
      return;
    }
    const repos = await repository.listProjectRepos(projectId);
    if (repos.some((repo) => repo.repo_id === repoId && repo.status === 'active') !== true) {
      throw new ConflictException({
        code: 'automation_precondition_stale',
        message: 'Automation repo scope is no longer active for the project.',
      });
    }
  }

  private assertManualPreconditionActorMatches(
    precondition: AutomationPrecondition | undefined,
    actorContext: AutomationActorContext | undefined,
    requestedBy: string,
  ): void {
    if (precondition === undefined || actorContext === undefined) {
      return;
    }
    if (actorContext.actor_class !== precondition.actor_class) {
      throw new ConflictException('Manual path actor class no longer matches automation precondition');
    }
    if (
      precondition.daemon_identity !== undefined &&
      (actorContext.daemon_identity !== precondition.daemon_identity || requestedBy !== precondition.daemon_identity)
    ) {
      throw new ConflictException('Manual path daemon identity no longer matches automation precondition');
    }
  }

  private async writePlanDraftForApprovedSpec(
    repository: P0Repository,
    workItemId: string,
    specRevisionId: string,
    precondition: AutomationPrecondition,
  ): Promise<EnsurePlanDraftResult> {
    const settings = await repository.resolveAutomationProjectSettings({
      project_id: precondition.project_id,
      ...(precondition.repo_id === undefined ? {} : { repo_id: precondition.repo_id }),
    });
    assertAutomationPreconditionStillCurrent(settings, precondition);
    assertCommandCapabilityStillEnabled(settings, 'canGeneratePlanDraft');
    await this.assertRepoScopeCurrent(repository, precondition.project_id, precondition.repo_id);

    const workItem = this.requireFound(await repository.getWorkItem(workItemId), `WorkItem ${workItemId}`);
    if (workItem.project_id !== precondition.project_id) {
      throw new ConflictException('WorkItem project does not match automation precondition');
    }
    if (isWorkItemAutomationTerminal(workItem)) {
      throw new UnprocessableEntityException({
        code: 'work_item_terminal',
        message: `WorkItem ${workItem.id} is terminal for automation.`,
      });
    }
    if (workItem.current_spec_id === undefined) {
      throw new BadRequestException(`WorkItem ${workItem.id} has no current spec`);
    }

    const spec = this.requireFound(await repository.getSpec(workItem.current_spec_id), `Spec ${workItem.current_spec_id}`);
    if (
      spec.work_item_id !== workItem.id ||
      spec.status !== 'approved' ||
      spec.resolution !== 'approved' ||
      spec.current_revision_id !== specRevisionId
    ) {
      throw new ConflictException('Spec revision is no longer the current approved revision for this WorkItem');
    }
    const specRevision = this.requireFound(await repository.getSpecRevision(specRevisionId), `SpecRevision ${specRevisionId}`);
    if (specRevision.spec_id !== spec.id || specRevision.work_item_id !== workItem.id) {
      throw new ConflictException('SpecRevision does not belong to the WorkItem current spec');
    }

    await assertNoActiveHolds(repository, [
      { object_type: 'work_item', object_id: workItem.id },
      { object_type: 'spec_revision', object_id: specRevision.id },
    ]);

    const existingPlan =
      workItem.current_plan_id === undefined ? undefined : await repository.getPlan(workItem.current_plan_id);
    if (existingPlan !== undefined) {
      const existingRevision = (await repository.listPlanRevisions(existingPlan.id)).find(
        (revision) => revision.based_on_spec_revision_id === specRevision.id,
      );
      if (existingRevision !== undefined) {
        return { plan_id: existingPlan.id, plan_revision_id: existingRevision.id, status: 'existing' };
      }
    }

    const createdAt = this.now();
    const plan =
      existingPlan ??
      (transitionSpecPlan(undefined, {
        type: 'create',
        entity_type: 'plan',
        id: this.id('plan'),
        work_item_id: workItem.id,
        at: createdAt,
      }) as Plan);
    if (existingPlan === undefined) {
      const currentWorkItem = this.requireFound(await repository.getWorkItem(workItem.id), `WorkItem ${workItem.id}`);
      if (currentWorkItem.current_spec_id !== spec.id) {
        throw new ConflictException('WorkItem current spec changed before plan draft could be attached');
      }
      if (currentWorkItem.current_plan_id !== undefined) {
        const currentPlan = await repository.getPlan(currentWorkItem.current_plan_id);
        const currentRevision =
          currentPlan === undefined
            ? undefined
            : (await repository.listPlanRevisions(currentPlan.id)).find((revision) => revision.based_on_spec_revision_id === specRevision.id);
        if (currentPlan !== undefined && currentRevision !== undefined) {
          return { plan_id: currentPlan.id, plan_revision_id: currentRevision.id, status: 'existing' };
        }
        throw new ConflictException('WorkItem current plan changed before plan draft could be attached');
      }
      await repository.savePlan(plan);
      await repository.saveWorkItem({ ...currentWorkItem, current_plan_id: plan.id, updated_at: plan.updated_at });
      await this.eventWithRepository(repository, 'plan', plan.id, 'plan_created', workItem.owner_actor_id, { work_item_id: workItem.id });
    }

    const drafting = transitionSpecPlan(plan, { type: 'generate_draft_start', at: this.now() }) as Plan;
    await repository.savePlan(drafting);
    await this.eventWithRepository(repository, 'plan', plan.id, 'plan_draft_generation_started', workItem.owner_actor_id, {
      work_item_id: workItem.id,
    });

    const revision: PlanRevision = {
      id: this.id('plan-revision'),
      plan_id: drafting.id,
      work_item_id: workItem.id,
      based_on_spec_revision_id: specRevision.id,
      revision_number: (await repository.listPlanRevisions(drafting.id)).length + 1,
      summary: `Draft plan for ${workItem.title}`,
      content: `Implement the approved spec revision ${specRevision.id} with a bounded package and required checks.`,
      implementation_summary: `Deliver ${workItem.title} through the P0 control plane.`,
      split_strategy: 'Create one repo-bound execution package for the approved plan.',
      dependency_order: ['api-package'],
      test_matrix: ['pnpm test tests/api'],
      risk_mitigations: specRevision.risk_notes.length === 0 ? ['Keep package scope narrow.'] : specRevision.risk_notes,
      rollback_notes: 'Revert the execution package changes.',
      structured_document: { generated_by: 'automation_plan_draft_command', spec_revision_id: specRevision.id },
      author_actor_id: precondition.daemon_identity ?? 'automation-plan-drafter',
      artifact_refs: [],
      created_at: this.now(),
    };
    await repository.savePlanRevision(revision);
    const updated = transitionSpecPlan({ ...drafting, current_revision_id: revision.id }, {
      type: 'generate_draft_success',
      at: this.now(),
    }) as Plan;
    await repository.savePlan(updated);
    await this.eventWithRepository(repository, 'plan_revision', revision.id, 'plan_draft_generated', revision.author_actor_id, {
      plan_id: updated.id,
      spec_revision_id: specRevision.id,
    });

    return { plan_id: updated.id, plan_revision_id: revision.id, status: 'created' };
  }

  private replayedPlanDraftResult(result: Record<string, unknown> | undefined): EnsurePlanDraftResult | undefined {
    if (
      result === undefined ||
      typeof result.plan_id !== 'string' ||
      typeof result.plan_revision_id !== 'string' ||
      (result.status !== 'created' && result.status !== 'existing')
    ) {
      return undefined;
    }
    return {
      plan_id: result.plan_id,
      plan_revision_id: result.plan_revision_id,
      status: result.status,
    };
  }

  private replayableCommandResultOrThrow<T>(claim: CommandIdempotencyRecord, replayed: T | undefined): T | undefined {
    if (claim.status === 'succeeded') {
      if (replayed !== undefined) {
        return replayed;
      }
      throw new ConflictException('Command idempotency result is malformed');
    }
    if (claim.status === 'skipped' || claim.status === 'blocked') {
      if (replayed !== undefined) {
        return replayed;
      }
      throw new ConflictException('Command idempotency result is not replayable');
    }
    return undefined;
  }

  private async blockCommandIdempotencyAfterError(
    repository: P0Repository,
    input: { idempotency_key: string; claim_token: string; error: unknown },
  ): Promise<void> {
    await repository.blockCommandIdempotency({
      idempotency_key: input.idempotency_key,
      claim_token: input.claim_token,
      result_json: { error: input.error instanceof Error ? input.error.message : 'unknown_error' },
      finished_at: this.now(),
    });
  }

  private async assertPackageRegenerationApproval(
    repository: P0Repository,
    input: {
      planRevisionId: string;
      generationKey: string;
      regenerationApproval?: EnsurePackageDraftsInput['regenerationApproval'];
    },
  ): Promise<void> {
    const defaultGenerationKey = `default:${input.planRevisionId}`;
    if (input.generationKey === defaultGenerationKey) {
      return;
    }
    const approval = input.regenerationApproval;
    if (approval === undefined) {
      throw new BadRequestException('non-default package generation requires a matching supersede approval');
    }
    const superseded = await repository.getExecutionPackageGenerationRun({
      plan_revision_id: input.planRevisionId,
      generation_key: approval.supersededGenerationKey,
    });
    if (
      superseded === undefined ||
      superseded.status !== 'superseded' ||
      superseded.execution_package_set_id !== approval.supersededExecutionPackageSetId ||
      superseded.next_generation_key !== input.generationKey ||
      superseded.supersede_command_id !== approval.supersedeCommandId
    ) {
      throw new BadRequestException('non-default package generation requires a matching supersede approval');
    }
  }

  private async writeExecutionPackageDraftsForPlanRevision(
    repository: P0Repository,
    input: {
      planRevisionId: string;
      generationKey: string;
      claimToken: string;
      precondition: AutomationPrecondition;
      regenerationApproval?: EnsurePackageDraftsInput['regenerationApproval'];
    },
  ): Promise<EnsurePackageDraftsResult> {
    const settings = await repository.resolveAutomationProjectSettings({
      project_id: input.precondition.project_id,
      ...(input.precondition.repo_id === undefined ? {} : { repo_id: input.precondition.repo_id }),
    });
    assertAutomationPreconditionStillCurrent(settings, input.precondition);
    assertCommandCapabilityStillEnabled(settings, 'canGeneratePackageDrafts');
    await this.assertRepoScopeCurrent(repository, input.precondition.project_id, input.precondition.repo_id);
    const context = await this.packageContextFromRepository(repository, input.planRevisionId);
    if (
      context.project.id !== input.precondition.project_id ||
      (input.precondition.repo_id !== undefined && context.project.repo_ids.includes(input.precondition.repo_id) !== true)
    ) {
      throw new ConflictException('Plan revision scope no longer matches automation precondition');
    }
    if (isWorkItemAutomationTerminal(context.workItem)) {
      throw new UnprocessableEntityException({
        code: 'work_item_terminal',
        message: `WorkItem ${context.workItem.id} is terminal for automation.`,
      });
    }
    await assertNoActiveHolds(repository, [
      { object_type: 'work_item', object_id: context.workItem.id },
      { object_type: 'spec_revision', object_id: context.specRevision.id },
      { object_type: 'plan_revision', object_id: context.planRevision.id },
      { object_type: 'package_generation', object_id: context.planRevision.id, generation_key: input.generationKey },
    ]);
    await this.assertPackageRegenerationApproval(repository, {
      planRevisionId: input.planRevisionId,
      generationKey: input.generationKey,
      regenerationApproval: input.regenerationApproval,
    });
    const packageRepoId = this.packageDraftRepoIdFor(context.project, input.precondition.repo_id);

    const generationRun = await repository.claimExecutionPackageGenerationRun({
      plan_revision_id: input.planRevisionId,
      generation_key: input.generationKey,
      generator_version: 'mock-package-drafter@1',
      policy_digest: 'p0-default-policy',
      manifest_digest: 'api-package-v1',
      expected_package_count: 1,
      expected_package_keys: ['api-package'],
      claim_token: input.claimToken,
      locked_until: this.lockedUntil(this.now()),
      now: this.now(),
    });
    const replayed = this.replayedPackageDraftsResult(generationRun.result_json);
    if (generationRun.status === 'succeeded' && replayed !== undefined) {
      return { ...replayed, status: 'existing' };
    }

    const existingPackages = (await repository.listExecutionPackagesForWorkItem(context.workItem.id)).filter(
      (executionPackage) =>
        executionPackage.plan_revision_id === context.planRevision.id &&
        executionPackage.generation_key === input.generationKey &&
        executionPackage.package_key === 'api-package',
    );
    const executionPackage =
      existingPackages[0] ??
      ({
        ...transitionExecutionPackage(undefined, {
          type: 'generate_package',
          id: this.id('execution-package'),
          work_item_id: context.workItem.id,
          spec_id: context.spec.id,
          spec_revision_id: context.specRevision.id,
          plan_id: context.plan.id,
          plan_revision_id: context.planRevision.id,
          project_id: context.project.id,
          repo_id: packageRepoId,
          objective: `Implement ${context.workItem.title}.`,
          owner_actor_id: context.workItem.owner_actor_id,
          reviewer_actor_id: context.workItem.owner_actor_id,
          qa_owner_actor_id: context.workItem.owner_actor_id,
          required_checks: [
            {
              check_id: 'unit',
              display_name: 'Unit tests',
              command: 'pnpm test tests/api',
              timeout_seconds: 120,
              blocks_review: true,
            },
          ],
          required_artifact_kinds: ['execution_summary'],
          allowed_paths: ['apps/control-plane-api/**', 'tests/api/**'],
          forbidden_paths: ['packages/db/**'],
          at: this.now(),
        }),
        ...this.defaultPackagePolicyFields({
          policyDigest: 'p0-default-policy',
          policySourcePath: 'forgeloop://p0/default-package-policy',
          loadedAt: this.now(),
          requiredChecks: [
            {
              check_id: 'unit',
              display_name: 'Unit tests',
              command: 'pnpm test tests/api',
              timeout_seconds: 120,
              blocks_review: true,
            },
          ],
          allowedPaths: ['apps/control-plane-api/**', 'tests/api/**'],
          forbiddenPaths: ['packages/db/**'],
        }),
        execution_package_set_id: generationRun.execution_package_set_id,
        generation_key: input.generationKey,
        package_key: 'api-package',
        sequence: 0,
        manifest_digest: 'api-package-v1',
        required_test_gates: [],
      } satisfies ExecutionPackage);
    validateExecutionPackage(context.project, executionPackage);
    if (existingPackages[0] === undefined) {
      await repository.saveExecutionPackage(executionPackage);
      await this.eventWithRepository(
        repository,
        'execution_package',
        executionPackage.id,
        'package_draft_generated',
        'automation-package-drafter',
        {
          plan_revision_id: context.planRevision.id,
        },
      );
    }
    await repository.saveExecutionPackageGenerationPackage({
      execution_package_set_id: generationRun.execution_package_set_id,
      execution_package_id: executionPackage.id,
      plan_revision_id: input.planRevisionId,
      generation_key: input.generationKey,
      package_key: 'api-package',
      sequence: 0,
      manifest_digest: 'api-package-v1',
      claim_token: input.claimToken,
    });
    const result: EnsurePackageDraftsResult = {
      execution_package_set_id: generationRun.execution_package_set_id,
      package_ids: [executionPackage.id],
      status: existingPackages[0] === undefined ? 'created' : 'existing',
    };
    await repository.completeExecutionPackageGenerationRun({
      plan_revision_id: input.planRevisionId,
      execution_package_set_id: generationRun.execution_package_set_id,
      claim_token: input.claimToken,
      result_json: result,
      completed_at: this.now(),
    });
    return result;
  }

  private async packageContextFromRepository(
    repository: P0Repository,
    planRevisionId: string,
  ): Promise<{
    project: Project;
    workItem: WorkItem;
    spec: Spec;
    specRevision: SpecRevision;
    plan: Plan;
    planRevision: PlanRevision;
  }> {
    const planRevision = this.requireFound(await repository.getPlanRevision(planRevisionId), `PlanRevision ${planRevisionId}`);
    const plan = this.requireFound(await repository.getPlan(planRevision.plan_id), `Plan ${planRevision.plan_id}`);
    if (plan.status !== 'approved' || plan.current_revision_id !== planRevisionId) {
      throw new BadRequestException(`PlanRevision ${planRevisionId} is not current approved revision`);
    }
    const workItem = this.requireFound(await repository.getWorkItem(plan.work_item_id), `WorkItem ${plan.work_item_id}`);
    if (workItem.current_plan_id !== plan.id) {
      throw new ConflictException('WorkItem current plan no longer matches PlanRevision');
    }
    const spec = await this.requireApprovedCurrentSpecFromRepository(repository, workItem);
    const specRevision = this.requireFound(await repository.getSpecRevision(spec.current_revision_id!), `SpecRevision ${spec.current_revision_id}`);
    if (planRevision.based_on_spec_revision_id === undefined) {
      throw new ConflictException('PlanRevision is not based on the WorkItem current approved SpecRevision');
    }
    if (planRevision.based_on_spec_revision_id !== specRevision.id) {
      throw new ConflictException('PlanRevision is no longer based on the WorkItem current approved SpecRevision');
    }
    return {
      project: this.requireFound(await repository.getProject(workItem.project_id), `Project ${workItem.project_id}`),
      workItem,
      spec,
      specRevision,
      plan,
      planRevision,
    };
  }

  private packageDraftRepoIdFor(project: Project, repoId: string | undefined): string {
    if (repoId !== undefined) {
      return repoId;
    }
    if (project.repo_ids.length === 1) {
      return project.repo_ids[0]!;
    }
    throw new UnprocessableEntityException({
      code: 'automation_gate_blocked',
      message: 'Project-scoped package generation requires an unambiguous repo scope.',
    });
  }

  private async requireApprovedCurrentSpecFromRepository(repository: P0Repository, workItem: WorkItem): Promise<Spec> {
    if (workItem.current_spec_id === undefined) {
      throw new BadRequestException(`WorkItem ${workItem.id} has no current spec`);
    }
    const spec = this.requireFound(await repository.getSpec(workItem.current_spec_id), `Spec ${workItem.current_spec_id}`);
    if (spec.status !== 'approved' || spec.resolution !== 'approved' || spec.current_revision_id === undefined) {
      throw new BadRequestException(`Spec ${spec.id} is not approved`);
    }
    return spec;
  }

  private replayedPackageDraftsResult(result: Record<string, unknown> | undefined): EnsurePackageDraftsResult | undefined {
    if (
      result === undefined ||
      typeof result.execution_package_set_id !== 'string' ||
      !Array.isArray(result.package_ids) ||
      !result.package_ids.every((packageId) => typeof packageId === 'string') ||
      (result.status !== 'created' && result.status !== 'existing')
    ) {
      return undefined;
    }
    return {
      execution_package_set_id: result.execution_package_set_id,
      package_ids: result.package_ids,
      status: result.status,
    };
  }

  private replayedRunAcceptedResponse(result: Record<string, unknown> | undefined): RunAcceptedResponse | undefined {
    if (
      result === undefined ||
      result.status !== 'accepted' ||
      typeof result.run_session_id !== 'string' ||
      typeof result.execution_package_id !== 'string'
    ) {
      return undefined;
    }
    return {
      status: 'accepted',
      run_session_id: result.run_session_id,
      execution_package_id: result.execution_package_id,
    };
  }

  private replayedSupersedeGenerationResult(
    result: Record<string, unknown> | undefined,
  ): SupersedeExecutionPackageGenerationRunResult | undefined {
    if (
      result === undefined ||
      result.status !== 'superseded' ||
      typeof result.execution_package_set_id !== 'string' ||
      typeof result.next_generation_key !== 'string' ||
      typeof result.supersede_command_id !== 'string'
    ) {
      return undefined;
    }
    return {
      execution_package_set_id: result.execution_package_set_id,
      status: 'superseded',
      next_generation_key: result.next_generation_key,
      supersede_command_id: result.supersede_command_id,
    };
  }

  private async assertExecutionPackageGraphStillCurrent(
    repository: P0Repository,
    executionPackage: ExecutionPackage,
  ): Promise<void> {
    const stale = (message: string): never => {
      throw new UnprocessableEntityException({ code: 'stale_execution_package_revision', message });
    };
    const workItem = this.requireFound(await repository.getWorkItem(executionPackage.work_item_id), `WorkItem ${executionPackage.work_item_id}`);
    if (isWorkItemAutomationTerminal(workItem)) {
      throw new UnprocessableEntityException({
        code: 'work_item_terminal',
        message: `WorkItem ${workItem.id} is terminal for automation.`,
      });
    }
    if (workItem.current_spec_id !== executionPackage.spec_id) {
      stale(`ExecutionPackage ${executionPackage.id} spec_id ${executionPackage.spec_id} is not the WorkItem current spec`);
    }
    if (workItem.current_plan_id !== executionPackage.plan_id) {
      stale(`ExecutionPackage ${executionPackage.id} plan_id ${executionPackage.plan_id} is not the WorkItem current plan`);
    }
    const spec = this.requireFound(await repository.getSpec(executionPackage.spec_id), `Spec ${executionPackage.spec_id}`);
    if (spec.status !== 'approved' || spec.resolution !== 'approved' || spec.current_revision_id !== executionPackage.spec_revision_id) {
      stale(
        `ExecutionPackage ${executionPackage.id} spec_revision_id ${executionPackage.spec_revision_id} is not current approved revision ${spec.current_revision_id ?? 'none'}`,
      );
    }
    const plan = this.requireFound(await repository.getPlan(executionPackage.plan_id), `Plan ${executionPackage.plan_id}`);
    if (plan.status !== 'approved' || plan.resolution !== 'approved' || plan.current_revision_id !== executionPackage.plan_revision_id) {
      stale(
        `ExecutionPackage ${executionPackage.id} plan_revision_id ${executionPackage.plan_revision_id} is not current approved revision ${plan.current_revision_id ?? 'none'}`,
      );
    }
    const specRevision = this.requireFound(
      await repository.getSpecRevision(executionPackage.spec_revision_id),
      `SpecRevision ${executionPackage.spec_revision_id}`,
    );
    const planRevision = this.requireFound(
      await repository.getPlanRevision(executionPackage.plan_revision_id),
      `PlanRevision ${executionPackage.plan_revision_id}`,
    );
    if (specRevision.spec_id !== spec.id || specRevision.work_item_id !== workItem.id) {
      stale(`ExecutionPackage ${executionPackage.id} spec revision no longer belongs to the current WorkItem spec`);
    }
    if (planRevision.plan_id !== plan.id || planRevision.work_item_id !== workItem.id) {
      stale(`ExecutionPackage ${executionPackage.id} plan revision no longer belongs to the current WorkItem plan`);
    }
    if (planRevision.based_on_spec_revision_id === undefined) {
      stale(`ExecutionPackage ${executionPackage.id} plan revision is missing a frozen spec revision target`);
    }
    if (planRevision.based_on_spec_revision_id !== specRevision.id) {
      stale(`ExecutionPackage ${executionPackage.id} plan revision is based on a stale spec revision`);
    }
    const dependencies = await repository.listExecutionPackageDependencies(executionPackage.id);
    for (const dependency of dependencies) {
      const upstream = this.requireFound(
        await repository.getExecutionPackage(dependency.depends_on_package_id),
        `ExecutionPackage ${dependency.depends_on_package_id}`,
      );
      if (upstream.resolution !== 'completed') {
        throw new UnprocessableEntityException({
          code: 'automation_gate_pending',
          message: `ExecutionPackage ${executionPackage.id} dependency ${upstream.id} is not completed.`,
        });
      }
    }
    const linkedReleases = (await repository.listReleasesForProject(executionPackage.project_id)).filter((release) =>
      release.execution_package_ids.includes(executionPackage.id),
    );
    for (const release of linkedReleases) {
      const releaseGateHolds = await repository.listActiveManualPathHolds({
        object_type: 'release_gate',
        object_id: release.id,
      });
      if (releaseGateHolds.length > 0) {
        throw new UnprocessableEntityException({
          code: 'manual_path_hold_active',
          message: `Release gate manual hold blocks run enqueue for ${executionPackage.id}.`,
          hold_ids: releaseGateHolds.map((hold) => hold.id),
        });
      }
      if (release.phase !== 'completed' && release.phase !== 'closed') {
        throw new UnprocessableEntityException({
          code: 'automation_gate_pending',
          message: `Release ${release.id} blocks automatic run enqueue for ${executionPackage.id}.`,
        });
      }
    }
  }

  private async enqueueRunWithRepository(
    repository: P0Repository,
    executionPackage: ExecutionPackage,
    input: EnqueueRunInput,
  ): Promise<RunAcceptedResponse> {
    const packageId = executionPackage.id;
    const requestedByActorId = this.resolveRunActor({
      ...(input.actorContext.authenticatedActorId === undefined ? {} : { authenticatedActorId: input.actorContext.authenticatedActorId }),
      demoActorId: input.actorContext.authenticatedActorId ?? input.automationPrecondition.daemon_identity ?? 'automation-daemon',
    });
    const executorType: ExecutorType = input.workflowOnly ? 'mock' : input.executorType;
    const runSessionId = this.id('run-session');
    const queuedAt = this.now();
    const queuedPackage = transitionExecutionPackage(executionPackage, {
      type: 'run',
      run_session_id: runSessionId,
      at: queuedAt,
    });
    const runSession = transitionRunSession(undefined, {
      type: 'create',
      id: runSessionId,
      execution_package_id: packageId,
      requested_by_actor_id: requestedByActorId,
      executor_type: executorType,
      at: queuedAt,
    });
    await repository.saveExecutionPackage(queuedPackage);
    await repository.saveRunSession({
      ...runSession,
      runtime_metadata: this.initialRuntimeMetadata(),
    });
    const context = await loadRunContext(repository, runSessionId);
    const runSpec = buildRunSpec(context, { defaultExecutorType: executorType, workflowOnly: input.workflowOnly });
    await repository.saveRunSession({
      ...runSession,
      executor_type: executorType,
      run_spec: runSpec,
      runtime_metadata: this.initialRuntimeMetadata(),
    });
    await repository.appendRunEvent({
      id: this.id('run-event'),
      run_session_id: runSessionId,
      event_type: 'run_queued',
      source: 'api',
      visibility: 'public',
      summary: 'Run queued.',
      payload: { execution_package_id: packageId, mode: 'run', workflow_only: input.workflowOnly, executor_type: executorType },
      created_at: queuedAt,
    });
    await this.eventWithRepository(repository, 'execution_package', packageId, 'run_requested', requestedByActorId, {
      run_session_id: runSessionId,
    });

    this.kickRunWorker();
    return {
      status: 'accepted',
      run_session_id: runSessionId,
      execution_package_id: packageId,
    };
  }

  private async createExecutionPackageFromContext(
    repository: P0Repository,
    context: Awaited<ReturnType<P0Service['packageContextFromRepository']>>,
    dto: CreateExecutionPackageDto,
    generation?: LegacyGeneratedPackageMetadata,
  ): Promise<ExecutionPackage> {
    const executionPackage = {
      ...transitionExecutionPackage(undefined, {
        type: 'generate_package',
        id: this.id('execution-package'),
        work_item_id: context.workItem.id,
        spec_id: context.spec.id,
        spec_revision_id: context.specRevision.id,
        plan_id: context.plan.id,
        plan_revision_id: context.planRevision.id,
        project_id: context.project.id,
        repo_id: dto.repo_id,
        objective: dto.objective,
        owner_actor_id: dto.owner_actor_id,
        reviewer_actor_id: dto.reviewer_actor_id,
        qa_owner_actor_id: dto.qa_owner_actor_id,
        required_checks: dto.required_checks,
        required_artifact_kinds: dto.required_artifact_kinds,
        allowed_paths: dto.allowed_paths,
        forbidden_paths: dto.forbidden_paths,
        at: this.now(),
      }),
      ...(generation === undefined
        ? {}
        : {
            execution_package_set_id: generation.execution_package_set_id,
            generation_key: generation.generation_key,
            package_key: generation.package_key,
            sequence: generation.sequence,
            manifest_digest: generation.manifest_digest,
          }),
      required_test_gates: [],
      ...this.defaultPackagePolicyFields({
        policyDigest: 'p0-manual-package-policy',
        policySourcePath: 'forgeloop://p0/manual-package-policy',
        loadedAt: this.now(),
        requiredChecks: dto.required_checks,
        allowedPaths: dto.allowed_paths,
        forbiddenPaths: dto.forbidden_paths,
      }),
    };
    validateExecutionPackage(context.project, executionPackage);
    await repository.saveExecutionPackage(executionPackage);
    await this.eventWithRepository(repository, 'execution_package', executionPackage.id, 'package_created', executionPackage.owner_actor_id, {
      plan_revision_id: context.planRevision.id,
    });
    return executionPackage;
  }

  private defaultPackagePolicyFields(input: {
    policyDigest: string;
    policySourcePath: string;
    loadedAt: string;
    requiredChecks: ExecutionPackage['required_checks'];
    allowedPaths: string[];
    forbiddenPaths: string[];
  }): Pick<
    ExecutionPackage,
    | 'validation_strategy'
    | 'validation_strategy_version'
    | 'validation_public_summary'
    | 'policy_snapshot_status'
    | 'policy_snapshot_version'
    | 'package_policy_snapshot'
  > {
    return {
      validation_strategy: 'checks_required',
      validation_strategy_version: 1,
      validation_public_summary: 'Required checks and package path policy are frozen for this package.',
      policy_snapshot_status: 'captured',
      policy_snapshot_version: 1,
      package_policy_snapshot: {
        policy_snapshot_version: 1,
        policy_digest: input.policyDigest,
        policy_source_path: input.policySourcePath,
        policy_loaded_at: input.loadedAt,
        policy_last_known_good: true,
        hooks: [],
        command_policy: { required_checks: input.requiredChecks.map((check) => check.check_id) },
        check_policy: { required_checks: input.requiredChecks.map((check) => check.check_id) },
        env_policy: {},
        path_policy: { allowed_paths: input.allowedPaths, forbidden_paths: input.forbiddenPaths },
        codex_runtime_mode: 'mock',
        fallback_policy: { allow_exec_fallback: false },
        validation_strategy_version: 1,
        validation_strategy: 'checks_required',
        validation_public_summary: 'Required checks and package path policy are frozen for this package.',
      },
    };
  }

  private async packageContext(planRevisionId: string): Promise<{
    project: Project;
    workItem: WorkItem;
    spec: Spec;
    specRevision: SpecRevision;
    plan: Plan;
    planRevision: PlanRevision;
  }> {
    const planRevision = await this.getPlanRevision(planRevisionId);
    const plan = await this.getPlan(planRevision.plan_id);
    if (plan.status !== 'approved' || plan.current_revision_id === undefined) {
      throw new BadRequestException(`PlanRevision ${planRevisionId} is not current approved revision`);
    }
    const currentPlanRevision = await this.getPlanRevision(plan.current_revision_id);
    if (currentPlanRevision.id !== planRevisionId) {
      throw new BadRequestException(`PlanRevision ${planRevisionId} is not current approved revision`);
    }
    const workItem = await this.getWorkItem(plan.work_item_id);
    const spec = await this.requireApprovedCurrentSpec(workItem);
    const specRevision = await this.getSpecRevision(spec.current_revision_id!);
    if (currentPlanRevision.based_on_spec_revision_id === undefined) {
      throw new ConflictException('PlanRevision is not based on the WorkItem current approved SpecRevision');
    }
    if (currentPlanRevision.based_on_spec_revision_id !== specRevision.id) {
      throw new ConflictException('PlanRevision is no longer based on the WorkItem current approved SpecRevision');
    }
    return {
      project: await this.getProject(workItem.project_id),
      workItem,
      spec,
      specRevision,
      plan,
      planRevision: currentPlanRevision,
    };
  }

  private async requireApprovedCurrentSpec(workItem: WorkItem): Promise<Spec> {
    if (workItem.current_spec_id === undefined) {
      throw new BadRequestException(`WorkItem ${workItem.id} has no current spec`);
    }
    const spec = await this.getSpec(workItem.current_spec_id);
    if (spec.status !== 'approved' || spec.resolution !== 'approved' || spec.current_revision_id === undefined) {
      throw new BadRequestException(`Spec ${spec.id} is not approved`);
    }
    return spec;
  }

  private async updateWorkItemForSpecPlan(
    workItemId: string,
    type:
      | 'submit_spec'
      | 'approve_spec'
      | 'request_spec_changes'
      | 'submit_plan'
      | 'approve_plan'
      | 'request_plan_changes',
    actorId: string | undefined,
  ): Promise<void> {
    await this.repository.withObjectLock(`work-item:${workItemId}`, async (repository) => {
      const workItem = this.requireFound(await repository.getWorkItem(workItemId), `WorkItem ${workItemId}`);
      const updated = transitionWorkItem(workItem, { type, at: this.now() });
      await repository.saveWorkItem(updated);
      await this.historyWithRepository(
        repository,
        'work_item',
        workItem.id,
        `${workItem.phase}/${workItem.gate_state}`,
        `${updated.phase}/${updated.gate_state}`,
        actorId,
      );
    });
  }

  private async saveSpecRevision(
    spec: Spec,
    input: Omit<SpecRevision, 'id' | 'spec_id' | 'work_item_id' | 'revision_number' | 'artifact_refs' | 'created_at'>,
  ): Promise<SpecRevision> {
    const revision: SpecRevision = {
      id: this.id('spec-revision'),
      spec_id: spec.id,
      work_item_id: spec.work_item_id,
      revision_number: (await this.repository.listSpecRevisions(spec.id)).length + 1,
      summary: input.summary,
      content: input.content,
      background: input.background,
      goals: input.goals,
      scope_in: input.scope_in,
      scope_out: input.scope_out,
      acceptance_criteria: input.acceptance_criteria,
      risk_notes: input.risk_notes,
      test_strategy_summary: input.test_strategy_summary,
      ...(input.structured_document !== undefined ? { structured_document: input.structured_document } : {}),
      ...(input.author_actor_id !== undefined ? { author_actor_id: input.author_actor_id } : {}),
      artifact_refs: [],
      created_at: this.now(),
    };
    await this.repository.saveSpecRevision(revision);
    await this.repository.saveSpec({ ...spec, current_revision_id: revision.id, updated_at: this.now() });
    return revision;
  }

  private async savePlanRevision(
    plan: Plan,
    input: Omit<PlanRevision, 'id' | 'plan_id' | 'work_item_id' | 'revision_number' | 'artifact_refs' | 'created_at'>,
  ): Promise<PlanRevision> {
    const revision: PlanRevision = {
      id: this.id('plan-revision'),
      plan_id: plan.id,
      work_item_id: plan.work_item_id,
      revision_number: (await this.repository.listPlanRevisions(plan.id)).length + 1,
      summary: input.summary,
      content: input.content,
      implementation_summary: input.implementation_summary,
      split_strategy: input.split_strategy,
      dependency_order: input.dependency_order,
      test_matrix: input.test_matrix,
      risk_mitigations: input.risk_mitigations,
      rollback_notes: input.rollback_notes,
      ...(input.based_on_spec_revision_id !== undefined ? { based_on_spec_revision_id: input.based_on_spec_revision_id } : {}),
      ...(input.structured_document !== undefined ? { structured_document: input.structured_document } : {}),
      ...(input.author_actor_id !== undefined ? { author_actor_id: input.author_actor_id } : {}),
      artifact_refs: [],
      created_at: this.now(),
    };
    await this.repository.savePlanRevision(revision);
    await this.repository.savePlan({ ...plan, current_revision_id: revision.id, updated_at: this.now() });
    return revision;
  }

  private initialRuntimeMetadata(): RunRuntimeMetadata {
    return {
      durability_mode: this.durabilityMode,
      recovery_attempt_count: 0,
      effective_dangerous_mode: 'not_requested',
    };
  }

  private async withWorkerLeaseMetadata(runSession: RunSession): Promise<RunSession> {
    const lease = await this.repository.getRunWorkerLease(runSession.id);
    if (lease === undefined) {
      return runSession;
    }

    return {
      ...runSession,
      runtime_metadata: {
        ...(runSession.runtime_metadata ?? this.initialRuntimeMetadata()),
        worker_id: lease.worker_id,
        worker_lease_status: lease.status,
        worker_lease_heartbeat_at: lease.heartbeat_at,
        worker_lease_expires_at: lease.expires_at,
      },
    };
  }

  private publicRunEvents(events: RunEvent[]): PublicRunEvent[] {
    return events
      .filter((event) => event.visibility === 'public')
      .map((event) => {
        const { raw_ref: _rawRef, ...publicEvent } = event;
        return publicRunEventSchema.parse(publicEvent);
      });
  }

  private resolveRunActor(input: { authenticatedActorId?: string; demoActorId?: string }): string {
    if (input.authenticatedActorId !== undefined && input.authenticatedActorId.trim().length > 0) {
      return input.authenticatedActorId;
    }

    if (this.allowDemoActorIdFallback && this.durabilityMode === 'volatile_demo') {
      return this.required(input.demoActorId, 'actor_id');
    }

    throw new UnauthorizedException('Authenticated actor is required');
  }

  private resolveStreamActor(
    runSession: RunSession,
    input: { actorContext?: ActorContext; demoActorId?: string; streamToken?: string },
  ): string {
    if (input.streamToken !== undefined) {
      let payload: RunEventStreamTokenPayload;
      try {
        payload = verifyRunEventStreamToken(input.streamToken, resolveRunEventStreamTokenSecret(process.env));
      } catch (error) {
        throw new UnauthorizedException(error instanceof Error ? error.message : 'Invalid run event stream token');
      }

      if (payload.run_session_id !== runSession.id) {
        throw new UnauthorizedException('Run event stream token does not match run session');
      }

      return payload.actor_id;
    }

    return this.resolveRunActor({
      ...(input.actorContext?.authenticatedActorId === undefined ? {} : { authenticatedActorId: input.actorContext.authenticatedActorId }),
      ...(input.demoActorId === undefined ? {} : { demoActorId: input.demoActorId }),
    });
  }

  private async assertRunViewerAllowed(runSession: RunSession, actorId: string): Promise<void> {
    const executionPackage = await this.getExecutionPackage(runSession.execution_package_id);
    const workItem = await this.getWorkItem(executionPackage.work_item_id);
    const allowed = new Set([
      workItem.owner_actor_id,
      executionPackage.owner_actor_id,
      executionPackage.reviewer_actor_id,
      executionPackage.qa_owner_actor_id,
    ]);

    if (!allowed.has(actorId)) {
      throw new ForbiddenException(`Actor ${actorId} cannot view run ${runSession.id}`);
    }
  }

  private async assertRunOperatorAllowed(runSession: RunSession, actorId: string): Promise<void> {
    const executionPackage = await this.getExecutionPackage(runSession.execution_package_id);
    if (actorId !== executionPackage.owner_actor_id && actorId !== executionPackage.reviewer_actor_id) {
      throw new ForbiddenException(`Actor ${actorId} cannot operate run ${runSession.id}`);
    }
  }

  private assertRunCommandTargetIsNonTerminal(runSession: RunSession): void {
    if (terminalRunStatuses.has(runSession.status)) {
      throw new BadRequestException(`RunSession ${runSession.id} is terminal`);
    }
  }

  private async createRunOperatorCommand(
    runSessionId: string,
    commandType: RunCommand['command_type'],
    input: {
      actorContext?: ActorContext;
      demoActorId?: string;
      payload: Record<string, unknown>;
      targetTurnId?: string;
      eventSummary: string;
    },
  ): Promise<RunOperatorCommandResponse> {
    const runSession = this.requireFound(await this.repository.getRunSession(runSessionId), `RunSession ${runSessionId}`);
    this.assertRunCommandTargetIsNonTerminal(runSession);
    const actorId = this.resolveRunActor({
      ...(input.actorContext?.authenticatedActorId === undefined ? {} : { authenticatedActorId: input.actorContext.authenticatedActorId }),
      ...(input.demoActorId === undefined ? {} : { demoActorId: input.demoActorId }),
    });
    await this.assertRunOperatorAllowed(runSession, actorId);

    const at = this.now();
    if (commandType === 'cancel') {
      await this.repository.supersedePendingRunCommands(runSessionId, ['input'], at);
    }

    const command: RunCommand = {
      id: this.id('run-command'),
      run_session_id: runSessionId,
      command_type: commandType,
      status: 'pending',
      actor_id: actorId,
      payload: input.payload,
      ...(input.targetTurnId === undefined ? {} : { target_turn_id: input.targetTurnId }),
      created_at: at,
      updated_at: at,
    };

    await this.repository.saveRunCommand(command);

    if (commandType === 'cancel') {
      await this.repository.saveRunSession(transitionRunSession(runSession, { type: 'cancel_requested', at }));
    }
    if (commandType === 'resume') {
      await this.repository.saveRunSession(transitionRunSession(runSession, { type: 'resume_requested', at }));
    }

    await this.repository.appendRunEvent({
      id: this.id('run-event'),
      run_session_id: runSessionId,
      event_type: commandType === 'input' ? 'user_input' : commandType === 'cancel' ? 'cancel_requested' : 'resuming',
      source: commandType === 'input' ? 'user' : 'api',
      visibility: 'public',
      summary: input.eventSummary,
      payload: { command_id: command.id, actor_id: actorId, ...input.payload },
      created_at: at,
    });

    this.kickRunWorker();
    return {
      status: 'accepted',
      command_id: command.id,
      run_session_id: runSessionId,
      command_type: commandType,
    };
  }

  private kickRunWorker(): void {
    try {
      this.runWorker.kick();
    } catch {
      // The durable repository state is authoritative; kick is only an in-process wake-up.
    }
  }

  private mockSelfReview(input: SelfReviewInput): SelfReviewResult {
    return {
      status: 'succeeded',
      summary: `Mock self-review completed for run ${input.run_session_id}.`,
      spec_plan_alignment: 'The mock run uses the approved spec and plan revision ids.',
      test_assessment: `${input.check_results.length} required checks were reported.`,
      risk_notes: [],
      follow_up_questions: [],
    };
  }

  private async applyReviewToPackage(reviewPacket: ReviewPacket, type: 'review_approved' | 'review_changes_requested'): Promise<void> {
    const executionPackage = await this.getExecutionPackage(reviewPacket.execution_package_id);
    const updated = transitionExecutionPackage(executionPackage, { type, at: this.now() });
    await this.repository.saveExecutionPackage(updated);
    await this.history('execution_package', updated.id, statusForPackage(executionPackage), statusForPackage(updated), reviewPacket.reviewed_by_actor_id);
  }

  private async archiveReviewPacket(
    reviewPacket: ReviewPacket,
    reason: string,
    repository: P0Repository = this.repository,
  ): Promise<void> {
    const updated = transitionReviewPacket(reviewPacket, { type: 'archive_for_newer_run', at: this.now() });
    await repository.saveReviewPacket(updated);
    await this.eventWithRepository(repository, 'review_packet', reviewPacket.id, 'review_packet_archived', reviewPacket.reviewer_actor_id, { reason });
  }

  private traceLink(
    traceEventId: string,
    relationship: TraceLinkRecord['relationship'],
    objectType: string,
    objectId: string,
    at: string,
  ): TraceLinkRecord {
    return {
      id: `trace-link:${traceEventId}:${relationship}:${objectType}:${objectId}`,
      trace_event_id: traceEventId,
      relationship,
      object_type: objectType,
      object_id: objectId,
      created_at: at,
    };
  }

  private async bestEffortTraceWrite(write: () => Promise<void>): Promise<void> {
    try {
      await write();
    } catch (error) {
      console.warn('[forgeloop:p0.trace] best-effort trace write failed', {
        source: 'control-plane-api',
        error: error instanceof Error ? error.message : String(error),
      });
      // P0 delivery tables are authoritative; trace rows are projected from them when absent.
    }
  }

  private async recordRunReplacementTrace(input: {
    mode: 'rerun' | 'force_rerun';
    executionPackage: ExecutionPackage;
    previousRunSessionId: string;
    newRunSessionId: string;
    requestedByActorId: string;
    previousReviewPacket?: ReviewPacket;
    triggeringReviewPacket?: ReviewPacket;
    at: string;
  }): Promise<void> {
    await this.bestEffortTraceWrite(async () => {
      const traceEventId = `trace-event:run-replacement:${input.newRunSessionId}`;
      const payload: RunReplacementRecordedPayload = {
        mode: traceReplacementModeFor(input.mode),
        execution_package_id: input.executionPackage.id,
        work_item_id: input.executionPackage.work_item_id,
        new_run_session_id: input.newRunSessionId,
        previous_run_session_id: input.previousRunSessionId,
        ...(input.triggeringReviewPacket === undefined ? {} : { triggering_review_packet_id: input.triggeringReviewPacket.id }),
        ...(input.previousReviewPacket === undefined ? {} : { previous_review_packet_id: input.previousReviewPacket.id }),
      };

      await this.repository.saveTraceEvent({
        id: traceEventId,
        event_type: 'run_replacement_recorded',
        subject_type: 'run_session',
        subject_id: input.newRunSessionId,
        actor_id: input.requestedByActorId,
        summary: `Run ${input.newRunSessionId} replaces ${input.previousRunSessionId}.`,
        payload,
        created_at: input.at,
      });

      const links = [
        this.traceLink(traceEventId, 'belongs_to', 'work_item', input.executionPackage.work_item_id, input.at),
        this.traceLink(traceEventId, 'belongs_to', 'execution_package', input.executionPackage.id, input.at),
        this.traceLink(traceEventId, 'generated_by', 'run_session', input.newRunSessionId, input.at),
        this.traceLink(traceEventId, 'supersedes', 'run_session', input.previousRunSessionId, input.at),
      ];
      if (input.previousReviewPacket !== undefined) {
        links.push(this.traceLink(traceEventId, 'replaces', 'review_packet', input.previousReviewPacket.id, input.at));
      }
      if (input.triggeringReviewPacket !== undefined) {
        links.push(this.traceLink(traceEventId, 'belongs_to', 'review_packet', input.triggeringReviewPacket.id, input.at));
      }

      for (const link of links) {
        await this.repository.saveTraceLink(link);
      }
    });
  }

  private async event(
    objectType: string,
    objectId: string,
    eventType: string,
    actorId: string | undefined,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.eventWithRepository(this.repository, objectType, objectId, eventType, actorId, metadata);
  }

  private async eventWithRepository(
    repository: P0Repository,
    objectType: string,
    objectId: string,
    eventType: string,
    actorId: string | undefined,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    const objectEvent: ObjectEvent = {
      id: this.id('event'),
      object_type: objectType,
      object_id: objectId,
      event_type: eventType,
      ...(actorId !== undefined ? { actor_id: actorId } : {}),
      metadata,
      created_at: this.now(),
    };
    await repository.appendObjectEvent(objectEvent);
  }

  private async history(
    objectType: string,
    objectId: string,
    fromStatus: string | undefined,
    toStatus: string,
    actorId: string | undefined,
  ): Promise<void> {
    await this.historyWithRepository(this.repository, objectType, objectId, fromStatus, toStatus, actorId);
  }

  private async historyWithRepository(
    repository: P0Repository,
    objectType: string,
    objectId: string,
    fromStatus: string | undefined,
    toStatus: string,
    actorId: string | undefined,
  ): Promise<void> {
    const statusHistory: StatusHistory = {
      id: this.id('status-history'),
      object_type: objectType,
      object_id: objectId,
      ...(fromStatus !== undefined ? { from_status: fromStatus } : {}),
      to_status: toStatus,
      ...(actorId !== undefined ? { actor_id: actorId } : {}),
      created_at: this.now(),
    };
    await repository.appendStatusHistory(statusHistory);
  }

  private async decision(
    objectType: string,
    objectId: string,
    actorId: string,
    decisionValue: 'approved' | 'changes_requested',
    summary: string,
  ): Promise<void> {
    await this.repository.saveDecision({
      id: this.id('decision'),
      object_type: objectType,
      object_id: objectId,
      actor_id: actorId,
      decision: decisionValue,
      summary,
      created_at: this.now(),
    });
  }

  private id(prefix: string): string {
    this.idCounter += 1;
    if (this.durabilityMode === 'durable' && uuidBackedP0IdPrefixes.has(prefix)) {
      return randomUUID();
    }
    if (this.durabilityMode === 'durable') {
      return `${prefix}-${this.durableInstanceId}-${this.idCounter}`;
    }
    return `${prefix}-${this.idCounter}`;
  }

  private now(): string {
    if (this.durabilityMode === 'durable') {
      const current = Date.now();
      this.durableTimeMs = current > this.durableTimeMs ? current : this.durableTimeMs + 1;
      return new Date(this.durableTimeMs).toISOString();
    }

    this.timeCounter += 1;
    return new Date(Date.UTC(2026, 4, 5, 0, 0, this.timeCounter)).toISOString();
  }

  private lockedUntil(now: string): string {
    return new Date(Date.parse(now) + commandClaimTtlMs).toISOString();
  }

  private actorIdForProductGate(bodyActorId: string | undefined, actorContext?: ActorContext): string {
    const authenticatedActorId = actorContext?.authenticatedActorId?.trim();
    if (authenticatedActorId === undefined || authenticatedActorId.length === 0 || actorContext?.actorClass === undefined) {
      throw new UnauthorizedException('Trusted actor id and class are required for product gate mutations');
    }
    if (bodyActorId !== undefined && bodyActorId !== authenticatedActorId) {
      throw new ForbiddenException('actor_id must match the trusted actor');
    }
    if (productGateRejectedActorClasses.has(actorContext.actorClass)) {
      throw new ForbiddenException({
        code: 'automation_actor_not_allowed_for_product_gate',
        message: `${actorContext.actorClass} actors cannot pass or mutate product gates.`,
      });
    }
    return authenticatedActorId;
  }

  private optionalAutomationActorContext(
    input: AutomationActorContextDto | undefined,
    trusted: ActorContext | undefined,
  ): AutomationActorContext | undefined {
    if (input === undefined) {
      if (
        trusted?.authenticatedActorId === undefined &&
        trusted?.actorClass === undefined &&
        trusted?.daemonIdentity === undefined
      ) {
        return undefined;
      }
      if (trusted.authenticatedActorId === undefined || trusted.actorClass === undefined) {
        throw new UnauthorizedException('Trusted actor id and class are required');
      }
      return {
        actor_id: trusted.authenticatedActorId,
        actor_class: trusted.actorClass,
        ...(trusted.daemonIdentity === undefined ? {} : { daemon_identity: trusted.daemonIdentity }),
      };
    }
    return this.automationActorContext(input, trusted, { requireTrusted: false });
  }

  private automationActorContext(
    input: AutomationActorContextDto,
    trusted?: ActorContext,
    options: { requireTrusted?: boolean } = {},
  ): AutomationActorContext {
    if (
      trusted?.authenticatedActorId !== undefined ||
      trusted?.actorClass !== undefined ||
      trusted?.daemonIdentity !== undefined ||
      options.requireTrusted === true
    ) {
      if (trusted?.authenticatedActorId === undefined || trusted.actorClass === undefined) {
        throw new UnauthorizedException('Trusted actor id and class are required');
      }
      if (
        input.actor_id !== trusted.authenticatedActorId ||
        input.actor_class !== trusted.actorClass ||
        (input.daemon_identity ?? undefined) !== (trusted.daemonIdentity ?? undefined)
      ) {
        throw new ForbiddenException('Actor context does not match authenticated headers');
      }
    }
    return {
      actor_class: input.actor_class,
      actor_id: input.actor_id,
      ...(input.daemon_identity === undefined ? {} : { daemon_identity: input.daemon_identity }),
      ...(input.source === undefined ? {} : { source: input.source }),
    };
  }

  private required(value: string | undefined, field: string): string {
    if (value === undefined || value.trim().length === 0) {
      throw new BadRequestException(`${field} is required`);
    }
    return value;
  }

  private requireFound<T>(value: T | undefined, description: string): T {
    if (value === undefined) {
      throw new NotFoundException(`${description} not found`);
    }
    return value;
  }
}
