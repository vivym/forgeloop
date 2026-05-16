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
  type RunSession,
  type RuntimeSafetyAttestation,
  type Spec,
  type SpecRevision,
  type StatusHistory,
  type WorkItem,
  isWorkItemAutomationTerminal,
  transitionExecutionPackage,
  transitionReviewPacket,
  transitionSpecPlan,
} from '@forgeloop/domain';
import type { DeliveryRepository } from '@forgeloop/db';
import type {
  ArtifactRef,
  EvidenceChainResponse,
  ExecutorType,
  RunAcceptedResponse,
  RunEventListResponse,
  RunOperatorCommandResponse,
} from '@forgeloop/contracts';
import { Observable } from 'rxjs';

import { DELIVERY_REPOSITORY } from '../modules/core/control-plane-tokens';
import { ControlPlaneRuntimeService } from '../modules/core/control-plane-runtime.service';
import { AutomationCommandService } from '../modules/automation/automation-command.service';
import { ExecutionPackageService } from '../modules/execution-packages/execution-package.service';
import {
  assertAutomationPreconditionStillCurrent,
  assertCommandCapabilityStillEnabled,
  assertNoActiveHolds,
  commandIdempotencyTarget,
} from '../modules/automation/automation-command-helpers';
import type { ActorContext } from '../modules/auth/actor-context';
import { RunControlService } from '../modules/run-control/run-control.service';
import { ProjectService } from '../modules/projects/project.service';
import { SpecPlanService } from '../modules/spec-plan/spec-plan.service';
import { WorkItemService } from '../modules/work-items/work-item.service';
import type {
  ActorCommandDto,
  CreateProjectDto,
  CreateProjectRepoDto,
  CreateExecutionPackageDto,
  CreatePlanRevisionDto,
  CreateSpecRevisionDto,
  MarkPackageReadyDto,
  PatchExecutionPackageDto,
  CreateWorkItemDto,
} from '../modules/delivery/dto';
import type {
  AutomationActorContextDto,
  DisableAutomationCapabilitiesDto,
  ReviewDecisionDto,
  RunControlDto,
  RunInputDto,
  RunPackageDto,
  RequestManualPathHoldDto,
  ResolveManualPathHoldDto,
  SetAutomationCapabilitiesDto,
} from './dto';
import { buildEvidenceChain } from './evidence-chain';

const statusForPackage = (executionPackage: ExecutionPackage): string =>
  `${executionPackage.phase}/${executionPackage.activity_state}/${executionPackage.gate_state}`;

const commandClaimTtlMs = 5 * 60 * 1000;
const productGateRejectedActorClasses = new Set<AutomationActorClass>([
  'automation_daemon',
  'source_adapter',
  'external_tracker',
  'repo_policy',
]);

type RunEventAccessOptions = {
  after?: string;
  actorId?: string;
  actorContext?: ActorContext;
  streamToken?: string;
};

type EnsurePlanDraftResult = { plan_id: string; plan_revision_id: string; status: 'created' | 'existing' };
type CommandBoundaryOutcome<T> = { ok: true; value: T } | { ok: false; error: unknown };
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
  constructor(
    @Inject(DELIVERY_REPOSITORY) private readonly repository: DeliveryRepository,
    @Inject(ControlPlaneRuntimeService)
    private readonly controlPlaneRuntime: ControlPlaneRuntimeService,
    @Inject(AutomationCommandService)
    private readonly automationCommandService: AutomationCommandService,
    @Inject(ProjectService)
    private readonly projectService: ProjectService,
    @Inject(WorkItemService)
    private readonly workItemService: WorkItemService,
    @Inject(SpecPlanService)
    private readonly specPlanService: SpecPlanService,
    @Inject(ExecutionPackageService)
    private readonly executionPackageService: ExecutionPackageService,
    @Inject(RunControlService)
    private readonly runControlService: RunControlService,
  ) {}

  async createProject(dto: CreateProjectDto): Promise<Project> {
    return this.projectService.createProject(dto);
  }

  async getProject(projectId: string): Promise<Project> {
    return this.projectService.getProject(projectId);
  }

  async createProjectRepo(projectId: string, dto: CreateProjectRepoDto): Promise<ProjectRepo> {
    return this.projectService.createProjectRepo(projectId, dto);
  }

  listProjectRepos(projectId: string): Promise<ProjectRepo[]> {
    return this.projectService.listProjectRepos(projectId);
  }

  async getAutomationCapabilities(projectId: string, repoId?: string): Promise<AutomationProjectSettings> {
    return this.automationCommandService.getAutomationCapabilities(projectId, repoId);
  }

  async setAutomationCapabilities(
    projectId: string,
    dto: SetAutomationCapabilitiesDto,
    actorContext?: ActorContext,
  ): Promise<AutomationProjectSettings> {
    return this.automationCommandService.setAutomationCapabilities(projectId, dto, actorContext);
  }

  async disableAutomation(
    projectId: string,
    dto: DisableAutomationCapabilitiesDto,
    actorContext?: ActorContext,
  ): Promise<AutomationProjectSettings> {
    return this.automationCommandService.disableAutomation(projectId, dto, actorContext);
  }

  async requestManualPath(dto: RequestManualPathHoldDto, actorContext?: ActorContext): Promise<ManualPathHold> {
    return this.automationCommandService.requestManualPath(dto, actorContext);
  }

  async resolveManualPath(holdId: string, dto: ResolveManualPathHoldDto, actorContext?: ActorContext): Promise<ManualPathHold> {
    return this.automationCommandService.resolveManualPath(holdId, dto, actorContext);
  }

  async createWorkItem(dto: CreateWorkItemDto): Promise<WorkItem> {
    return this.workItemService.createWorkItem(dto);
  }

  listWorkItems(projectId?: string): Promise<WorkItem[]> {
    return this.workItemService.listWorkItems(projectId);
  }

  async getWorkItem(workItemId: string): Promise<WorkItem> {
    return this.workItemService.getWorkItem(workItemId);
  }

  async createSpec(workItemId: string): Promise<Spec> {
    return this.specPlanService.createSpec(workItemId);
  }

  async getSpec(specId: string): Promise<Spec> {
    return this.specPlanService.getSpec(specId);
  }

  listSpecRevisions(specId: string): Promise<SpecRevision[]> {
    return this.specPlanService.listSpecRevisions(specId);
  }

  async getSpecRevision(specRevisionId: string): Promise<SpecRevision> {
    return this.specPlanService.getSpecRevision(specRevisionId);
  }

  async createSpecRevision(specId: string, dto: CreateSpecRevisionDto): Promise<SpecRevision> {
    return this.specPlanService.createSpecRevision(specId, dto);
  }

  async generateSpecDraft(specId: string): Promise<SpecRevision> {
    return this.specPlanService.generateSpecDraft(specId);
  }

  async submitSpecForApproval(specId: string, dto: ActorCommandDto, actorContext?: ActorContext): Promise<Spec> {
    return this.specPlanService.submitSpecForApproval(specId, dto, actorContext);
  }

  async approveSpec(specId: string, dto: ActorCommandDto, actorContext?: ActorContext): Promise<Spec> {
    return this.specPlanService.approveSpec(specId, dto, actorContext);
  }

  async requestSpecChanges(specId: string, dto: ActorCommandDto, actorContext?: ActorContext): Promise<Spec> {
    return this.specPlanService.requestSpecChanges(specId, dto, actorContext);
  }

  async ensurePlanDraftForApprovedSpec(
    workItemId: string,
    specRevisionId: string,
    automationPrecondition: AutomationPrecondition,
    idempotencyKey: string,
  ): Promise<EnsurePlanDraftResult> {
    return this.automationCommandService.ensurePlanDraftForApprovedSpec(
      workItemId,
      specRevisionId,
      automationPrecondition,
      idempotencyKey,
    );
  }

  async ensureExecutionPackageDraftsForPlanRevision(input: EnsurePackageDraftsInput): Promise<EnsurePackageDraftsResult> {
    return this.automationCommandService.ensureExecutionPackageDraftsForPlanRevision(input);
  }

  async enqueueRunIfPackageStillReady(input: EnqueueRunInput): Promise<RunAcceptedResponse> {
    return this.automationCommandService.enqueueRunIfPackageStillReady({
      ...input,
      onRunQueued: () => {
        this.runControlService.kickRunWorker();
      },
    });
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
    return this.specPlanService.createPlan(workItemId);
  }

  async getPlan(planId: string): Promise<Plan> {
    return this.specPlanService.getPlan(planId);
  }

  listPlanRevisions(planId: string): Promise<PlanRevision[]> {
    return this.specPlanService.listPlanRevisions(planId);
  }

  async getPlanRevision(planRevisionId: string): Promise<PlanRevision> {
    return this.specPlanService.getPlanRevision(planRevisionId);
  }

  async createPlanRevision(planId: string, dto: CreatePlanRevisionDto): Promise<PlanRevision> {
    return this.specPlanService.createPlanRevision(planId, dto);
  }

  async generatePlanDraft(planId: string): Promise<PlanRevision> {
    return this.specPlanService.generatePlanDraft(planId);
  }

  async submitPlanForApproval(planId: string, dto: ActorCommandDto, actorContext?: ActorContext): Promise<Plan> {
    return this.specPlanService.submitPlanForApproval(planId, dto, actorContext);
  }

  async approvePlan(planId: string, dto: ActorCommandDto, actorContext?: ActorContext): Promise<Plan> {
    return this.specPlanService.approvePlan(planId, dto, actorContext);
  }

  async requestPlanChanges(planId: string, dto: ActorCommandDto, actorContext?: ActorContext): Promise<Plan> {
    return this.specPlanService.requestPlanChanges(planId, dto, actorContext);
  }

  async generatePackages(planRevisionId: string): Promise<ExecutionPackage[]> {
    return this.executionPackageService.generatePackages(planRevisionId);
  }

  async createExecutionPackage(planRevisionId: string, dto: CreateExecutionPackageDto): Promise<ExecutionPackage> {
    return this.executionPackageService.createExecutionPackage(planRevisionId, dto);
  }

  async listExecutionPackages(workItemId: string): Promise<ExecutionPackage[]> {
    return this.executionPackageService.listExecutionPackages(workItemId);
  }

  async getExecutionPackage(packageId: string): Promise<ExecutionPackage> {
    return this.executionPackageService.getExecutionPackage(packageId);
  }

  async patchExecutionPackage(packageId: string, dto: PatchExecutionPackageDto): Promise<ExecutionPackage> {
    return this.executionPackageService.patchExecutionPackage(packageId, dto);
  }

  async markPackageReady(packageId: string, dto: MarkPackageReadyDto, actorContext?: ActorContext): Promise<ExecutionPackage> {
    return this.executionPackageService.markPackageReady(packageId, dto, actorContext);
  }

  async runPackage(
    packageId: string,
    dto: RunPackageDto,
    mode: 'run' | 'rerun' | 'force_rerun',
    actorContext: ActorContext = {},
  ): Promise<RunAcceptedResponse> {
    return this.runControlService.runPackage(packageId, dto, mode, actorContext);
  }

  async getRunSession(runSessionId: string): Promise<RunSession> {
    return this.runControlService.getRunSession(runSessionId);
  }

  async listRunEvents(runSessionId: string, options: RunEventAccessOptions = {}): Promise<RunEventListResponse> {
    return this.runControlService.listRunEvents(runSessionId, options);
  }

  async streamRunEvents(runSessionId: string, options: RunEventAccessOptions = {}): Promise<Observable<MessageEvent>> {
    return this.runControlService.streamRunEvents(runSessionId, options);
  }

  async createRunInputCommand(
    runSessionId: string,
    dto: RunInputDto,
    actorContext: ActorContext = {},
  ): Promise<RunOperatorCommandResponse> {
    return this.runControlService.createRunInputCommand(runSessionId, dto, actorContext);
  }

  async createRunCancelCommand(
    runSessionId: string,
    dto: RunControlDto,
    actorContext: ActorContext = {},
  ): Promise<RunOperatorCommandResponse> {
    return this.runControlService.createRunCancelCommand(runSessionId, dto, actorContext);
  }

  async createRunResumeCommand(
    runSessionId: string,
    dto: RunControlDto,
    actorContext: ActorContext = {},
  ): Promise<RunOperatorCommandResponse> {
    return this.runControlService.createRunResumeCommand(runSessionId, dto, actorContext);
  }

  async createRunEventStreamToken(
    runSessionId: string,
    actorContext: ActorContext = {},
    options: { demoActorId?: string } = {},
  ): Promise<{ token: string; expires_at: string }> {
    return this.runControlService.createRunEventStreamToken(runSessionId, actorContext, options);
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

  private async assertAutomationPreconditionForHold(repository: DeliveryRepository, precondition: AutomationPrecondition): Promise<void> {
    const settings = await repository.resolveAutomationProjectSettings({
      project_id: precondition.project_id,
      ...(precondition.repo_id === undefined ? {} : { repo_id: precondition.repo_id }),
    });
    assertAutomationPreconditionStillCurrent(settings, precondition);
    assertCommandCapabilityStillEnabled(settings, precondition.required_capability);
    await this.assertRepoScopeCurrent(repository, precondition.project_id, precondition.repo_id);
  }

  private async assertRepoScopeCurrent(
    repository: DeliveryRepository,
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
    repository: DeliveryRepository,
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
    repository: DeliveryRepository,
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
    repository: DeliveryRepository,
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

  private async applyReviewToPackage(reviewPacket: ReviewPacket, type: 'review_approved' | 'review_changes_requested'): Promise<void> {
    const executionPackage = await this.getExecutionPackage(reviewPacket.execution_package_id);
    const updated = transitionExecutionPackage(executionPackage, { type, at: this.now() });
    await this.repository.saveExecutionPackage(updated);
    await this.history('execution_package', updated.id, statusForPackage(executionPackage), statusForPackage(updated), reviewPacket.reviewed_by_actor_id);
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
    repository: DeliveryRepository,
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
    repository: DeliveryRepository,
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
    return this.controlPlaneRuntime.id(prefix);
  }

  private now(): string {
    return this.controlPlaneRuntime.now();
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
