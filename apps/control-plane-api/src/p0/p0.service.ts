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
  validateForceRerunAllowed,
} from '@forgeloop/domain';
import type { DeliveryRepository, TraceLinkRecord } from '@forgeloop/db';
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
  DELIVERY_DEMO_ACTOR_ID_FALLBACK,
  DELIVERY_REPOSITORY,
  RUN_DURABILITY_MODE,
  type RunDurabilityMode,
} from '../modules/core/control-plane-tokens';
import { ControlPlaneRuntimeService } from '../modules/core/control-plane-runtime.service';
import { AutomationCommandService } from '../modules/automation/automation-command.service';
import { ExecutionPackageService } from '../modules/execution-packages/execution-package.service';
import {
  assertAutomationPreconditionStillCurrent,
  assertCommandCapabilityStillEnabled,
  assertNoActiveHolds,
  assertPackageRunEligible,
  assertRuntimeSafetyAttestation,
  automationPreconditionFingerprint,
  commandIdempotencyTarget,
  normalizeAutomationPrecondition,
} from '../modules/automation/automation-command-helpers';
import type { ActorContext } from '../modules/auth/actor-context';
import {
  createRunEventStreamToken as signRunEventStreamToken,
  resolveRunEventStreamTokenSecret,
  type RunEventStreamTokenPayload,
  verifyRunEventStreamToken,
} from '../modules/run-control/run-event-stream-token';
import { DELIVERY_RUN_WORKER } from '../modules/run-control/run-worker.token';
import { serializePublicRunSession } from '../modules/query/public-run-session-projection';
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

const statusForPackage = (executionPackage: ExecutionPackage): string =>
  `${executionPackage.phase}/${executionPackage.activity_state}/${executionPackage.gate_state}`;

const traceReplacementModeFor = (mode: 'rerun' | 'force_rerun'): RunReplacementRecordedPayload['mode'] =>
  mode === 'rerun' ? 'rerun_package' : 'force_rerun_package';

const terminalRunStatuses = new Set<RunSession['status']>(['succeeded', 'failed', 'timed_out', 'cancelled']);
const commandClaimTtlMs = 5 * 60 * 1000;
const productGateRejectedActorClasses = new Set<AutomationActorClass>([
  'automation_daemon',
  'source_adapter',
  'external_tracker',
  'repo_policy',
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
    @Inject(DELIVERY_RUN_WORKER) private readonly runWorker: RunWorker,
    @Inject(RUN_DURABILITY_MODE) private readonly durabilityMode: RunDurabilityMode,
    @Inject(DELIVERY_DEMO_ACTOR_ID_FALLBACK) private readonly allowDemoActorIdFallback: boolean,
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
        this.kickRunWorker();
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
    const result = await this.repository.withObjectLock(`execution-package:${packageId}`, async (repository) =>
      this.runPackageWithRepository(repository, packageId, dto, mode, actorContext),
    );
    this.kickRunWorker();
    return result;
  }

  private async runPackageWithRepository(
    repository: DeliveryRepository,
    packageId: string,
    dto: RunPackageDto,
    mode: 'run' | 'rerun' | 'force_rerun',
    actorContext: ActorContext,
  ): Promise<RunAcceptedResponse> {
    const executionPackage = this.requireFound(await repository.getExecutionPackage(packageId), `ExecutionPackage ${packageId}`);
    await this.executionPackageService.assertExecutionPackageGraphStillCurrent(repository, executionPackage);
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

  private async enqueueRunWithRepository(
    repository: DeliveryRepository,
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
    repository: DeliveryRepository = this.repository,
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
