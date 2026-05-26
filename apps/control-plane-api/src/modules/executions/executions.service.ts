import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  canCreateQaHandoff,
  canStartExecutionFromApprovedExecutionPlan,
  codeReviewReadyGate,
  isTrustedHumanReviewActorClass,
  requiredBoundaryQuestionsClosed,
  type BoundarySummary,
  type BoundarySummaryRevision,
  type BrainstormingSession,
  type CodeReviewHandoff,
  type DevelopmentPlan,
  type DevelopmentPlanItem,
  type DevelopmentPlanItemRevision,
  type DevelopmentPlanRevision,
  type Execution,
  type ExecutionPlanDocument,
  type ExecutionPlanRevision,
  type QaHandoff,
  type Spec,
  type SpecRevision,
  type WorkItem,
} from '@forgeloop/domain';
import type { DeliveryRepository } from '@forgeloop/db';
import type { ProductObjectRef } from '@forgeloop/contracts';

import { AuditWriterService } from '../audit/audit-writer.service';
import type { ActorContext } from '../auth/actor-context';
import { ControlPlaneRuntimeService } from '../core/control-plane-runtime.service';
import { DELIVERY_REPOSITORY } from '../core/control-plane-tokens';
import { ExecutionPackageService } from '../execution-packages/execution-package.service';
import { RunControlService } from '../run-control/run-control.service';

type ActorCommand = { actor_id?: string | undefined };
type ReadyForCodeReviewCommand = ActorCommand & {
  summary: string;
  changed_surfaces: string[];
  verification_evidence_refs: ProductObjectRef[];
};
type ReviewDecisionCommand = ActorCommand & { rationale: string };
type AuditedExceptionCommand = ActorCommand & {
  reason: string;
  risk: 'low' | 'medium' | 'high' | 'critical';
  rollback_plan: string;
};
type QaHandoffCommand = ActorCommand & {
  acceptance_criteria: string[];
  test_strategy: string;
  verification_evidence_refs?: ProductObjectRef[] | undefined;
  known_risks?: string[] | undefined;
};
type QaDecisionCommand = ActorCommand & {
  rationale: string;
  verification_evidence_refs?: ProductObjectRef[] | undefined;
};

type ApprovedExecutionPlanContext = {
  plan: DevelopmentPlan;
  item: DevelopmentPlanItem;
  workItem: WorkItem;
  spec: Spec;
  specRevision: SpecRevision;
  executionPlan: ExecutionPlanDocument;
  executionPlanRevision: ExecutionPlanRevision;
};

@Injectable()
export class ExecutionsService {
  constructor(
    @Inject(DELIVERY_REPOSITORY) private readonly repository: DeliveryRepository,
    @Inject(ControlPlaneRuntimeService) private readonly runtime: ControlPlaneRuntimeService,
    @Inject(AuditWriterService) private readonly audit: AuditWriterService,
    @Inject(ExecutionPackageService) private readonly executionPackageService: ExecutionPackageService,
    @Inject(RunControlService) private readonly runControlService: RunControlService,
  ) {}

  async startExecution(developmentPlanId: string, itemId: string, dto: ActorCommand): Promise<Execution> {
    return this.withPlanItemMutation(developmentPlanId, async (repository) => {
      const replayedExecution = await this.findReplayableItemExecution(repository, developmentPlanId, itemId);
      if (replayedExecution !== undefined) {
        return replayedExecution;
      }
      const context = await this.requireApprovedExecutionPlanContext(developmentPlanId, itemId, repository);
      if (context.item.execution_status !== 'not_started' && context.item.execution_status !== 'ready') {
        const existingExecution = await this.findItemExecution(repository, context.item.id, context.executionPlanRevision.id);
        if (existingExecution !== undefined) {
          return existingExecution;
        }
        throw new ConflictException(`DevelopmentPlanItem ${context.item.id} already has an active execution`);
      }
      const execution = this.buildExecution(context, 'running');
      await repository.saveExecution(execution);

      const executionPackage = await this.executionPackageService.createOrReuseItemExecutionPackage(repository, {
        project: this.requireFound(await repository.getProject(context.plan.project_id), `Project ${context.plan.project_id}`),
        workItem: context.workItem,
        item: context.item,
        spec: context.spec,
        specRevision: context.specRevision,
        executionPlan: context.executionPlan,
        executionPlanRevision: context.executionPlanRevision,
        execution,
      });

      const run = await this.runControlService.enqueueRunWithRepository(repository, executionPackage, {
        actorContext: this.actorContextFromExecutionCommand(dto, context),
        automationPrecondition: {},
        executorType: 'local_codex',
        workflowOnly: false,
      });
      const linkedExecution: Execution = {
        ...execution,
        runtime_evidence_refs: [
          { type: 'execution_package', id: executionPackage.id, title: executionPackage.objective },
          { type: 'run_session', id: run.run_session_id, title: `Run session for ${context.item.title}` },
        ],
        updated_at: this.now(),
      };
      await repository.saveExecution(linkedExecution);
      await this.updateDevelopmentPlanItem(repository, context.plan, context.item, {
        execution_status: 'running',
        next_action: 'monitor_execution',
        changeReason: 'execution_started',
        actorId: dto.actor_id,
      });
      await this.eventWithRepository(repository, 'execution', linkedExecution.id, 'execution_started', dto.actor_id, {
        development_plan_item_id: context.item.id,
        execution_plan_revision_id: context.executionPlanRevision.id,
        execution_package_id: executionPackage.id,
        run_session_id: run.run_session_id,
      });
      return linkedExecution;
    });
  }

  async continueExecution(executionId: string, dto: ActorCommand): Promise<Execution> {
    return this.withExecutionMutation(executionId, async (repository) => {
      const execution = this.requireFound(await repository.getExecution(executionId), `Execution ${executionId}`);
      if (execution.status !== 'paused' && execution.status !== 'interrupted') {
        throw new BadRequestException(`Execution ${execution.id} cannot continue from ${execution.status}`);
      }
      const updated = {
        ...execution,
        status: 'running' as const,
        continuation_history: [
          ...execution.continuation_history,
          { at: this.now(), summary: dto.actor_id === undefined ? 'Execution continued.' : `Execution continued by ${dto.actor_id}.` },
        ],
        updated_at: this.now(),
      };
      await repository.saveExecution(updated);
      const item = this.requireFound(
        await repository.getDevelopmentPlanItem(execution.development_plan_item_id),
        `DevelopmentPlanItem ${execution.development_plan_item_id}`,
      );
      const plan = this.requireFound(await repository.getDevelopmentPlan(item.development_plan_id), `DevelopmentPlan ${item.development_plan_id}`);
      await this.updateDevelopmentPlanItem(repository, plan, item, {
        execution_status: 'running',
        next_action: 'monitor_execution',
        changeReason: 'execution_continued',
        actorId: dto.actor_id,
      });
      await this.eventWithRepository(repository, 'execution', execution.id, 'execution_continued', dto.actor_id, {});
      return updated;
    });
  }

  async interruptExecution(executionId: string, dto: ActorCommand): Promise<Execution> {
    return this.withExecutionMutation(executionId, async (repository) => {
      const execution = this.requireFound(await repository.getExecution(executionId), `Execution ${executionId}`);
      if (execution.status !== 'running' && execution.status !== 'paused') {
        throw new BadRequestException(`Execution ${execution.id} cannot be interrupted from ${execution.status}`);
      }
      const updated = {
        ...execution,
        status: 'interrupted' as const,
        interrupt_history: [
          ...execution.interrupt_history,
          { at: this.now(), reason: dto.actor_id === undefined ? 'Execution interrupted.' : `Execution interrupted by ${dto.actor_id}.` },
        ],
        updated_at: this.now(),
      };
      await repository.saveExecution(updated);
      const item = this.requireFound(
        await repository.getDevelopmentPlanItem(execution.development_plan_item_id),
        `DevelopmentPlanItem ${execution.development_plan_item_id}`,
      );
      const plan = this.requireFound(await repository.getDevelopmentPlan(item.development_plan_id), `DevelopmentPlan ${item.development_plan_id}`);
      await this.updateDevelopmentPlanItem(repository, plan, item, {
        execution_status: 'interrupted',
        next_action: 'continue_execution',
        changeReason: 'execution_interrupted',
        actorId: dto.actor_id,
      });
      await this.eventWithRepository(repository, 'execution', execution.id, 'execution_interrupted', dto.actor_id, {});
      return updated;
    });
  }

  async markReadyForCodeReview(executionId: string, dto: ReadyForCodeReviewCommand): Promise<CodeReviewHandoff> {
    return this.withExecutionMutation(executionId, async (repository) => {
      const execution = this.requireFound(await repository.getExecution(executionId), `Execution ${executionId}`);
      const gate = codeReviewReadyGate({
        execution,
        changedSurfaces: dto.changed_surfaces,
        verificationEvidenceRefs: dto.verification_evidence_refs,
      });
      if (!gate.ok) {
        throw new BadRequestException(`Execution ${execution.id} cannot move to code review: ${gate.reason}`);
      }
      const item = this.requireFound(
        await repository.getDevelopmentPlanItem(execution.development_plan_item_id),
        `DevelopmentPlanItem ${execution.development_plan_item_id}`,
      );
      const plan = this.requireFound(await repository.getDevelopmentPlan(item.development_plan_id), `DevelopmentPlan ${item.development_plan_id}`);
      const reviewerActorId = item.reviewer_actor_id ?? dto.actor_id ?? item.driver_actor_id;
      if (reviewerActorId === undefined) {
        throw new BadRequestException('reviewer_actor_id is required');
      }
      const at = this.now();
      const handoff: CodeReviewHandoff = {
        id: this.id('code-review-handoff'),
        ref: { type: 'code_review_handoff', id: '', title: `Code review for ${item.title}` },
        execution_id: execution.id,
        development_plan_item_id: item.id,
        execution_plan_revision_id: execution.execution_plan_revision_id,
        reviewer_actor_id: reviewerActorId,
        status: 'in_review',
        summary: dto.summary,
        changed_surfaces: dto.changed_surfaces,
        verification_evidence_refs: dto.verification_evidence_refs,
        created_at: at,
        updated_at: at,
      };
      const saved = { ...handoff, ref: { ...handoff.ref, id: handoff.id } };
      await repository.saveCodeReviewHandoff(saved);
      await repository.saveExecution({ ...execution, status: 'awaiting_code_review', updated_at: at });
      await this.updateDevelopmentPlanItem(repository, plan, item, {
        execution_status: 'awaiting_code_review',
        review_status: 'in_review',
        next_action: 'review_code',
        changeReason: 'code_review_handoff_created',
        actorId: dto.actor_id,
      });
      await this.eventWithRepository(repository, 'code_review_handoff', saved.id, 'code_review_handoff_created', dto.actor_id, {
        execution_id: execution.id,
      });
      return saved;
    });
  }

  async approveCodeReview(
    handoffId: string,
    dto: ReviewDecisionCommand,
    actorContext: ActorContext,
  ): Promise<CodeReviewHandoff> {
    const actorId = this.trustedHumanActorId(dto.actor_id, actorContext);
    return this.withCodeReviewMutation(handoffId, async (repository) => {
      const handoff = this.requireFound(await repository.getCodeReviewHandoff(handoffId), `CodeReviewHandoff ${handoffId}`);
      this.assertAssignedReviewer(handoff, actorId);
      if (handoff.status !== 'in_review') {
        throw new BadRequestException(`CodeReviewHandoff ${handoff.id} cannot be approved from ${handoff.status}`);
      }
      const updated: CodeReviewHandoff = {
        ...handoff,
        status: 'approved',
        approved_by_actor_id: actorId,
        approved_at: this.now(),
        decision_rationale: dto.rationale,
        updated_at: this.now(),
      };
      await repository.saveCodeReviewHandoff(updated);
      const item = this.requireFound(
        await repository.getDevelopmentPlanItem(handoff.development_plan_item_id),
        `DevelopmentPlanItem ${handoff.development_plan_item_id}`,
      );
      const plan = this.requireFound(await repository.getDevelopmentPlan(item.development_plan_id), `DevelopmentPlan ${item.development_plan_id}`);
      await this.updateDevelopmentPlanItem(repository, plan, item, {
        review_status: 'approved',
        next_action: 'create_qa_handoff',
        changeReason: 'code_review_approved',
        actorId,
      });
      await this.decisionWithRepository(repository, 'code_review_handoff', handoff.id, actorId, 'approved', dto.rationale);
      return updated;
    });
  }

  async requestCodeReviewChanges(
    handoffId: string,
    dto: ReviewDecisionCommand,
    actorContext: ActorContext,
  ): Promise<CodeReviewHandoff> {
    const actorId = this.trustedHumanActorId(dto.actor_id, actorContext);
    return this.withCodeReviewMutation(handoffId, async (repository) => {
      const handoff = this.requireFound(await repository.getCodeReviewHandoff(handoffId), `CodeReviewHandoff ${handoffId}`);
      this.assertAssignedReviewer(handoff, actorId);
      if (handoff.status !== 'in_review') {
        throw new BadRequestException(`CodeReviewHandoff ${handoff.id} cannot request changes from ${handoff.status}`);
      }
      const updated: CodeReviewHandoff = {
        ...handoff,
        status: 'changes_requested',
        decision_rationale: dto.rationale,
        updated_at: this.now(),
      };
      await repository.saveCodeReviewHandoff(updated);
      const item = this.requireFound(
        await repository.getDevelopmentPlanItem(handoff.development_plan_item_id),
        `DevelopmentPlanItem ${handoff.development_plan_item_id}`,
      );
      const plan = this.requireFound(await repository.getDevelopmentPlan(item.development_plan_id), `DevelopmentPlan ${item.development_plan_id}`);
      const execution = this.requireFound(await repository.getExecution(handoff.execution_id), `Execution ${handoff.execution_id}`);
      const at = this.now();
      await repository.saveExecution({
        ...execution,
        status: 'interrupted',
        interrupt_history: [
          ...execution.interrupt_history,
          { at, reason: `Code review changes requested: ${dto.rationale}` },
        ],
        updated_at: at,
      });
      await this.updateDevelopmentPlanItem(repository, plan, item, {
        execution_status: 'interrupted',
        review_status: 'changes_requested',
        next_action: 'continue_execution',
        changeReason: 'code_review_changes_requested',
        actorId,
      });
      await this.decisionWithRepository(repository, 'code_review_handoff', handoff.id, actorId, 'changes_requested', dto.rationale);
      return updated;
    });
  }

  async recordCodeReviewAuditedException(
    handoffId: string,
    dto: AuditedExceptionCommand,
    actorContext: ActorContext,
  ): Promise<CodeReviewHandoff> {
    const actorId = this.trustedHumanActorId(dto.actor_id, actorContext);
    return this.withCodeReviewMutation(handoffId, async (repository) => {
      const handoff = this.requireFound(await repository.getCodeReviewHandoff(handoffId), `CodeReviewHandoff ${handoffId}`);
      const updated: CodeReviewHandoff = {
        ...handoff,
        audited_exception: {
          actor_id: actorId,
          reason: dto.reason,
          risk: dto.risk,
          rollback_plan: dto.rollback_plan,
          created_at: this.now(),
        },
        updated_at: this.now(),
      };
      await repository.saveCodeReviewHandoff(updated);
      await this.eventWithRepository(repository, 'code_review_handoff', handoff.id, 'code_review_audited_exception_recorded', actorId, {
        risk: dto.risk,
      });
      return updated;
    });
  }

  async createQaHandoff(handoffId: string, dto: QaHandoffCommand): Promise<QaHandoff> {
    return this.withCodeReviewMutation(handoffId, async (repository) => {
      const handoff = this.requireFound(await repository.getCodeReviewHandoff(handoffId), `CodeReviewHandoff ${handoffId}`);
      const gate = canCreateQaHandoff({ codeReviewHandoff: handoff });
      if (!gate.ok) {
        throw new BadRequestException(`CodeReviewHandoff ${handoff.id} cannot create QA handoff: ${gate.reason}`);
      }
      const existingHandoff = (await repository.listQaHandoffsForCodeReview(handoff.id))[0];
      if (existingHandoff !== undefined) {
        throw new ConflictException(`CodeReviewHandoff ${handoff.id} already has a QA handoff`);
      }
      const execution = this.requireFound(await repository.getExecution(handoff.execution_id), `Execution ${handoff.execution_id}`);
      const item = this.requireFound(
        await repository.getDevelopmentPlanItem(handoff.development_plan_item_id),
        `DevelopmentPlanItem ${handoff.development_plan_item_id}`,
      );
      const plan = this.requireFound(await repository.getDevelopmentPlan(item.development_plan_id), `DevelopmentPlan ${item.development_plan_id}`);
      const executionPlanRevision = this.requireFound(
        await repository.getExecutionPlanRevision(handoff.execution_plan_revision_id),
        `ExecutionPlanRevision ${handoff.execution_plan_revision_id}`,
      );
      const specRevision = this.requireFound(
        await repository.getSpecRevision(executionPlanRevision.based_on_spec_revision_id),
        `SpecRevision ${executionPlanRevision.based_on_spec_revision_id}`,
      );
      const at = this.now();
      const qa: QaHandoff = {
        id: this.id('qa-handoff'),
        ref: { type: 'qa_handoff', id: '', title: `QA handoff for ${item.title}` },
        code_review_handoff_id: handoff.id,
        execution_id: execution.id,
        source_ref: item.source_ref,
        development_plan_item_id: item.id,
        development_plan_item_ref: {
          type: 'development_plan_item',
          id: item.id,
          development_plan_id: plan.id,
          revision_id: item.revision_id,
          title: item.title,
        },
        approved_spec_revision_ref: { type: 'spec_revision', id: specRevision.id, spec_id: specRevision.spec_id, title: specRevision.summary },
        approved_execution_plan_revision_ref: {
          type: 'execution_plan_revision',
          id: executionPlanRevision.id,
          execution_plan_id: executionPlanRevision.execution_plan_id,
          title: executionPlanRevision.summary,
        },
        status: 'pending',
        acceptance_criteria: dto.acceptance_criteria,
        test_strategy: dto.test_strategy,
        verification_evidence_refs: dto.verification_evidence_refs ?? handoff.verification_evidence_refs,
        known_risks: dto.known_risks ?? [],
        changed_surfaces: handoff.changed_surfaces,
        release_impact: item.release_impact,
        created_at: at,
        updated_at: at,
      };
      const saved = { ...qa, ref: { ...qa.ref, id: qa.id } };
      await repository.saveQaHandoff(saved);
      await repository.saveExecution({ ...execution, status: 'qa_handoff_pending', updated_at: at });
      await this.updateDevelopmentPlanItem(repository, plan, item, {
        execution_status: 'qa_handoff_pending',
        qa_handoff_status: 'in_review',
        next_action: 'qa_handoff',
        changeReason: 'qa_handoff_created',
        actorId: dto.actor_id,
      });
      await this.eventWithRepository(repository, 'qa_handoff', saved.id, 'qa_handoff_created', dto.actor_id, {
        code_review_handoff_id: handoff.id,
      });
      return saved;
    });
  }

  async blockQaHandoff(qaHandoffId: string, dto: QaDecisionCommand): Promise<QaHandoff> {
    return this.withQaMutation(qaHandoffId, async (repository) => {
      const qa = this.requireFound(await repository.getQaHandoff(qaHandoffId), `QaHandoff ${qaHandoffId}`);
      if (qa.status !== 'pending') {
        throw new BadRequestException(`QaHandoff ${qa.id} cannot be blocked from ${qa.status}`);
      }
      const actorId = this.requireActorId(dto.actor_id);
      const updated: QaHandoff = {
        ...qa,
        status: 'blocked',
        blocked_by_actor_id: actorId,
        rationale: dto.rationale,
        updated_at: this.now(),
      };
      await repository.saveQaHandoff(updated);
      const item = this.requireFound(
        await repository.getDevelopmentPlanItem(qa.development_plan_item_id),
        `DevelopmentPlanItem ${qa.development_plan_item_id}`,
      );
      const plan = this.requireFound(await repository.getDevelopmentPlan(item.development_plan_id), `DevelopmentPlan ${item.development_plan_id}`);
      await this.updateDevelopmentPlanItem(repository, plan, item, {
        qa_handoff_status: 'blocked',
        next_action: 'resolve_qa_block',
        changeReason: 'qa_handoff_blocked',
        actorId,
      });
      return updated;
    });
  }

  async acceptQaHandoff(qaHandoffId: string, dto: QaDecisionCommand): Promise<QaHandoff> {
    if (dto.verification_evidence_refs === undefined || dto.verification_evidence_refs.length === 0) {
      throw new BadRequestException('QA acceptance requires verification_evidence_refs');
    }
    return this.withQaMutation(qaHandoffId, async (repository) => {
      const qa = this.requireFound(await repository.getQaHandoff(qaHandoffId), `QaHandoff ${qaHandoffId}`);
      const codeReview = this.requireFound(
        await repository.getCodeReviewHandoff(qa.code_review_handoff_id),
        `CodeReviewHandoff ${qa.code_review_handoff_id}`,
      );
      if (codeReview.status !== 'approved') {
        throw new BadRequestException('QA acceptance requires approved code review');
      }
      if (qa.status !== 'pending' && qa.status !== 'blocked') {
        throw new BadRequestException(`QaHandoff ${qa.id} cannot be accepted from ${qa.status}`);
      }
      const actorId = this.requireActorId(dto.actor_id);
      const at = this.now();
      const updated: QaHandoff = {
        ...qa,
        status: 'accepted',
        accepted_by_actor_id: actorId,
        rationale: dto.rationale,
        verification_evidence_refs: dto.verification_evidence_refs!,
        updated_at: at,
      };
      await repository.saveQaHandoff(updated);
      const execution = this.requireFound(await repository.getExecution(qa.execution_id), `Execution ${qa.execution_id}`);
      await repository.saveExecution({ ...execution, status: 'completed', updated_at: at });
      const item = this.requireFound(
        await repository.getDevelopmentPlanItem(qa.development_plan_item_id),
        `DevelopmentPlanItem ${qa.development_plan_item_id}`,
      );
      const plan = this.requireFound(await repository.getDevelopmentPlan(item.development_plan_id), `DevelopmentPlan ${item.development_plan_id}`);
      await this.updateDevelopmentPlanItem(repository, plan, item, {
        execution_status: 'completed',
        qa_handoff_status: 'approved',
        next_action: 'prepare_release',
        changeReason: 'qa_handoff_accepted',
        actorId,
      });
      return updated;
    });
  }

  private async requireApprovedExecutionPlanContext(
    developmentPlanId: string,
    itemId: string,
    repository: DeliveryRepository,
  ): Promise<ApprovedExecutionPlanContext> {
    const plan = this.requireFound(await repository.getDevelopmentPlan(developmentPlanId), `DevelopmentPlan ${developmentPlanId}`);
    const item = await repository.getDevelopmentPlanItem(itemId);
    if (item === undefined || item.development_plan_id !== developmentPlanId) {
      throw new NotFoundException(`DevelopmentPlanItem ${itemId} not found`);
    }
    const executionPlan = (await repository.listExecutionPlansForDevelopmentPlanItem(item.id))
      .slice()
      .sort((left, right) => right.updated_at.localeCompare(left.updated_at))[0];
    if (executionPlan === undefined) {
      throw new BadRequestException(`DevelopmentPlanItem ${item.id} cannot start execution: execution_plan_missing`);
    }
    const revision =
      executionPlan.approved_revision_id === undefined
        ? undefined
        : await repository.getExecutionPlanRevision(executionPlan.approved_revision_id);
    const gate = canStartExecutionFromApprovedExecutionPlan({
      executionPlan,
      ...(revision === undefined ? {} : { executionPlanRevision: revision }),
    });
    if (!gate.ok || executionPlan.current_revision_id !== executionPlan.approved_revision_id) {
      throw new BadRequestException(
        `DevelopmentPlanItem ${item.id} cannot start execution: ${gate.ok ? 'approved_execution_plan_revision_not_current' : gate.reason}`,
      );
    }
    if (revision === undefined) {
      throw new BadRequestException(`DevelopmentPlanItem ${item.id} cannot start execution: approved_execution_plan_revision_missing`);
    }
    if (revision.development_plan_item_id !== item.id || revision.execution_plan_id !== executionPlan.id) {
      throw new BadRequestException(`DevelopmentPlanItem ${item.id} cannot start execution: execution_plan_revision_mismatch`);
    }
    const specRevision = this.requireFound(
      await repository.getSpecRevision(revision.based_on_spec_revision_id),
      `SpecRevision ${revision.based_on_spec_revision_id}`,
    );
    const spec = this.requireFound(await repository.getSpec(specRevision.spec_id), `Spec ${specRevision.spec_id}`);
    if (
      spec.status !== 'approved' ||
      spec.resolution !== 'approved' ||
      spec.current_revision_id !== specRevision.id ||
      spec.approved_revision_id !== specRevision.id
    ) {
      throw new BadRequestException(`DevelopmentPlanItem ${item.id} cannot start execution: approved_spec_not_current`);
    }
    await this.requireApprovedSpecBoundaryChain(item, spec, specRevision, repository);
    const workItem = this.requireFound(await repository.getWorkItem(item.source_ref.id), `${item.source_ref.type} ${item.source_ref.id}`);
    return { plan, item, workItem, spec, specRevision, executionPlan, executionPlanRevision: revision };
  }

  private async requireApprovedSpecBoundaryChain(
    item: DevelopmentPlanItem,
    spec: Spec,
    specRevision: SpecRevision,
    repository: DeliveryRepository,
  ): Promise<void> {
    if (
      spec.development_plan_item_id !== item.id ||
      specRevision.development_plan_item_id !== item.id ||
      specRevision.spec_id !== spec.id
    ) {
      throw new BadRequestException(`DevelopmentPlanItem ${item.id} cannot start execution: approved_spec_item_mismatch`);
    }

    const boundarySummaryId = specRevision.boundary_summary_id;
    if (boundarySummaryId === undefined || spec.boundary_summary_id !== boundarySummaryId) {
      throw new BadRequestException(`DevelopmentPlanItem ${item.id} cannot start execution: approved_spec_boundary_missing`);
    }
    const boundary = this.requireFound(await repository.getBoundarySummary(boundarySummaryId), `BoundarySummary ${boundarySummaryId}`);
    const boundaryRevisionId = this.revisionStructuredBoundarySummaryRevisionId(specRevision);
    if (boundaryRevisionId === undefined) {
      throw new BadRequestException(`DevelopmentPlanItem ${item.id} cannot start execution: approved_spec_boundary_revision_missing`);
    }
    const boundaryRevision = (await repository.listBoundarySummaryRevisions(boundary.id)).find(
      (candidate) => candidate.id === boundaryRevisionId,
    );
    if (boundaryRevision === undefined) {
      throw new BadRequestException(`DevelopmentPlanItem ${item.id} cannot start execution: approved_spec_boundary_revision_missing`);
    }
    const session = this.requireFound(
      await repository.getBrainstormingSession(boundary.brainstorming_session_id),
      `BrainstormingSession ${boundary.brainstorming_session_id}`,
    );
    if (!this.approvedBoundaryChainMatchesItem(item, boundary, boundaryRevision, session)) {
      throw new BadRequestException(`DevelopmentPlanItem ${item.id} cannot start execution: approved_spec_boundary_not_current`);
    }
    if (!this.boundarySummaryRevisionApproved(boundaryRevision)) {
      throw new BadRequestException(`DevelopmentPlanItem ${item.id} cannot start execution: boundary_summary_missing_approval`);
    }
    const [questions, answers, decisions] = await Promise.all([
      repository.listBoundaryQuestions(session.id),
      repository.listBoundaryAnswers(session.id),
      repository.listBoundaryDecisions(session.id),
    ]);
    if (!requiredBoundaryQuestionsClosed({ questions, answers, decisions })) {
      throw new BadRequestException(`DevelopmentPlanItem ${item.id} cannot start execution: boundary_questions_open`);
    }
  }

  private approvedBoundaryChainMatchesItem(
    item: DevelopmentPlanItem,
    boundary: BoundarySummary,
    revision: BoundarySummaryRevision,
    session: BrainstormingSession,
  ): boolean {
    return (
      boundary.development_plan_item_id === item.id &&
      boundary.development_plan_item_revision_id === item.revision_id &&
      boundary.revision_id === revision.id &&
      revision.boundary_summary_id === boundary.id &&
      revision.development_plan_item_id === item.id &&
      revision.development_plan_item_revision_id === item.revision_id &&
      this.boundarySummaryRevisionSessionId(revision) === session.id &&
      session.development_plan_item_id === item.id &&
      session.development_plan_item_revision_id === item.revision_id &&
      session.status === 'approved' &&
      session.boundary_summary_id === boundary.id &&
      session.approved_summary_revision_id === revision.id
    );
  }

  private boundarySummaryRevisionApproved(revision: BoundarySummaryRevision): boolean {
    const record = revision as Record<string, unknown>;
    return (
      record.status === 'approved' &&
      typeof record.source_round_id === 'string' &&
      typeof record.context_manifest_id === 'string' &&
      typeof record.context_manifest_revision_id === 'string' &&
      Array.isArray(record.question_answer_snapshot) &&
      record.question_answer_snapshot.length > 0 &&
      Array.isArray(record.decision_snapshot) &&
      record.decision_snapshot.length > 0 &&
      record.approved_by_actor_id !== undefined &&
      record.approved_at !== undefined
    );
  }

  private boundarySummaryRevisionSessionId(revision: BoundarySummaryRevision): string | undefined {
    const record = revision as Record<string, unknown>;
    const sessionId = record.session_id ?? record.brainstorming_session_id;
    return typeof sessionId === 'string' ? sessionId : undefined;
  }

  private revisionStructuredBoundarySummaryRevisionId(revision: SpecRevision): string | undefined {
    const structured = revision.structured_document;
    if (structured === undefined || structured === null || typeof structured !== 'object' || Array.isArray(structured)) {
      return undefined;
    }
    const value = (structured as Record<string, unknown>).boundary_summary_revision_id;
    return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
  }

  private buildExecution(context: ApprovedExecutionPlanContext, status: Execution['status']): Execution {
    const at = this.now();
    const executionId = this.id('execution');
    return {
      id: executionId,
      ref: { type: 'execution', id: executionId, title: `Execution for ${context.item.title}` },
      development_plan_item_id: context.item.id,
      development_plan_item_ref: {
        type: 'development_plan_item',
        id: context.item.id,
        development_plan_id: context.plan.id,
        revision_id: context.item.revision_id,
        title: context.item.title,
      },
      execution_plan_revision_id: context.executionPlanRevision.id,
      execution_plan_revision_ref: {
        type: 'execution_plan_revision',
        id: context.executionPlanRevision.id,
        execution_plan_id: context.executionPlan.id,
        title: context.executionPlanRevision.summary,
      },
      approved_spec_revision_id: context.specRevision.id,
      approved_spec_revision_ref: {
        type: 'spec_revision',
        id: context.specRevision.id,
        spec_id: context.spec.id,
        title: context.specRevision.summary,
      },
      status,
      evidence_refs: [
        {
          type: 'development_plan_item',
          id: context.item.id,
          development_plan_id: context.plan.id,
          revision_id: context.item.revision_id,
          title: context.item.title,
        },
        {
          type: 'spec_revision',
          id: context.specRevision.id,
          spec_id: context.spec.id,
          title: context.specRevision.summary,
        },
        {
          type: 'execution_plan_revision',
          id: context.executionPlanRevision.id,
          execution_plan_id: context.executionPlan.id,
          title: context.executionPlanRevision.summary,
        },
      ],
      runtime_evidence_refs: [],
      interrupt_history: [],
      continuation_history: [],
      pr_refs: [],
      diff_refs: [],
      test_evidence_refs: [],
      created_at: at,
      updated_at: at,
    };
  }

  private async findItemExecution(
    repository: DeliveryRepository,
    itemId: string,
    executionPlanRevisionId: string,
  ): Promise<Execution | undefined> {
    return (await repository.listExecutions()).find(
      (execution) =>
        execution.development_plan_item_id === itemId &&
        execution.execution_plan_revision_id === executionPlanRevisionId &&
        execution.status !== 'completed' &&
        execution.status !== 'failed',
    );
  }

  private async findReplayableItemExecution(
    repository: DeliveryRepository,
    developmentPlanId: string,
    itemId: string,
  ): Promise<Execution | undefined> {
    const item = await repository.getDevelopmentPlanItem(itemId);
    if (
      item === undefined ||
      item.development_plan_id !== developmentPlanId ||
      item.execution_status === 'not_started' ||
      item.execution_status === 'ready'
    ) {
      return undefined;
    }
    return (await repository.listExecutions()).find(
      (execution) =>
        execution.development_plan_item_id === item.id &&
        execution.status !== 'completed' &&
        execution.status !== 'failed',
    );
  }

  private actorContextFromExecutionCommand(dto: ActorCommand, context: ApprovedExecutionPlanContext): ActorContext {
    return {
      authenticatedActorId: dto.actor_id ?? context.item.driver_actor_id ?? context.workItem.driver_actor_id,
      actorClass: 'human',
    };
  }

  private withPlanItemMutation<T>(
    developmentPlanId: string,
    write: (repository: DeliveryRepository) => Promise<T>,
  ): Promise<T> {
    return this.repository.withObjectLock(`development-plan:${developmentPlanId}`, async (lockedRepository) =>
      lockedRepository.withDeliveryTransaction(write),
    );
  }

  private withExecutionMutation<T>(executionId: string, write: (repository: DeliveryRepository) => Promise<T>): Promise<T> {
    return this.repository.withObjectLock(`execution:${executionId}`, async (lockedRepository) =>
      lockedRepository.withDeliveryTransaction(write),
    );
  }

  private withCodeReviewMutation<T>(handoffId: string, write: (repository: DeliveryRepository) => Promise<T>): Promise<T> {
    return this.repository.withObjectLock(`code-review-handoff:${handoffId}`, async (lockedRepository) =>
      lockedRepository.withDeliveryTransaction(write),
    );
  }

  private withQaMutation<T>(qaHandoffId: string, write: (repository: DeliveryRepository) => Promise<T>): Promise<T> {
    return this.repository.withObjectLock(`qa-handoff:${qaHandoffId}`, async (lockedRepository) =>
      lockedRepository.withDeliveryTransaction(write),
    );
  }

  private async updateDevelopmentPlanItem(
    repository: DeliveryRepository,
    plan: DevelopmentPlan,
    item: DevelopmentPlanItem,
    input: {
      execution_status?: DevelopmentPlanItem['execution_status'];
      review_status?: DevelopmentPlanItem['review_status'];
      qa_handoff_status?: DevelopmentPlanItem['qa_handoff_status'];
      next_action: string;
      changeReason: string;
      actorId?: string | undefined;
    },
  ): Promise<DevelopmentPlanItem> {
    const updatedItem: DevelopmentPlanItem = {
      ...item,
      revision_id: this.id('development-plan-item-revision'),
      ...(input.execution_status === undefined ? {} : { execution_status: input.execution_status }),
      ...(input.review_status === undefined ? {} : { review_status: input.review_status }),
      ...(input.qa_handoff_status === undefined ? {} : { qa_handoff_status: input.qa_handoff_status }),
      next_action: input.next_action,
      updated_at: this.now(),
    };
    await repository.saveDevelopmentPlanItem(updatedItem);
    const itemRevision: DevelopmentPlanItemRevision = {
      id: updatedItem.revision_id,
      development_plan_item_id: updatedItem.id,
      development_plan_id: updatedItem.development_plan_id,
      revision_number: (await repository.listDevelopmentPlanItemRevisions(updatedItem.id)).length + 1,
      snapshot: updatedItem,
      change_reason: input.changeReason,
      ...(input.actorId === undefined ? {} : { edited_by_actor_id: input.actorId }),
      created_at: this.now(),
    };
    await repository.saveDevelopmentPlanItemRevision(itemRevision);
    const updatedPlan: DevelopmentPlan = {
      ...plan,
      revision_id: this.id('development-plan-revision'),
      updated_at: this.now(),
    };
    await repository.saveDevelopmentPlan(updatedPlan);
    const [revisions, items] = await Promise.all([
      repository.listDevelopmentPlanRevisions(updatedPlan.id),
      repository.listDevelopmentPlanItems(updatedPlan.id),
    ]);
    const planRevision: DevelopmentPlanRevision = {
      id: updatedPlan.revision_id,
      development_plan_id: updatedPlan.id,
      revision_number: revisions.length + 1,
      title: updatedPlan.title,
      status: updatedPlan.status,
      source_refs: updatedPlan.source_refs,
      item_refs: items.map((planItem) => ({
        id: planItem.id,
        revision_id: planItem.revision_id,
        title: planItem.title,
        boundary_status: planItem.boundary_status,
        spec_status: planItem.spec_status,
        execution_plan_status: planItem.execution_plan_status,
        execution_status: planItem.execution_status,
      })),
      change_reason: input.changeReason,
      ...(input.actorId === undefined ? {} : { actor_id: input.actorId }),
      created_at: this.now(),
    };
    await repository.saveDevelopmentPlanRevision(planRevision);
    return updatedItem;
  }

  private trustedHumanActorId(bodyActorId: string | undefined, actorContext: ActorContext): string {
    const actorId = actorContext.authenticatedActorId?.trim();
    if (actorId === undefined || actorId.length === 0 || actorContext.actorClass === undefined) {
      throw new UnauthorizedException('Trusted human actor headers are required');
    }
    if (bodyActorId !== undefined && bodyActorId !== actorId) {
      throw new ForbiddenException('actor_id must match the trusted actor');
    }
    if (!isTrustedHumanReviewActorClass(actorContext.actorClass)) {
      throw new ForbiddenException({
        code: 'automation_actor_not_allowed_for_review_gate',
        message: `${actorContext.actorClass} actors cannot pass review gates.`,
      });
    }
    return actorId;
  }

  private assertAssignedReviewer(handoff: CodeReviewHandoff, actorId: string): void {
    if (handoff.reviewer_actor_id !== actorId) {
      throw new ForbiddenException('actor_id must match the assigned reviewer');
    }
  }

  private requireActorId(actorId: string | undefined): string {
    if (actorId === undefined || actorId.trim().length === 0) {
      throw new BadRequestException('actor_id is required');
    }
    return actorId;
  }

  private async eventWithRepository(
    repository: DeliveryRepository,
    objectType: string,
    objectId: string,
    eventType: string,
    actorId: string | undefined,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.audit.objectEvent(
      {
        id: this.id('event'),
        object_type: objectType,
        object_id: objectId,
        event_type: eventType,
        ...(actorId === undefined ? {} : { actor_id: actorId }),
        metadata,
        created_at: this.now(),
      },
      repository,
    );
  }

  private async decisionWithRepository(
    repository: DeliveryRepository,
    objectType: string,
    objectId: string,
    actorId: string,
    decisionValue: 'approved' | 'changes_requested',
    summary: string,
  ): Promise<void> {
    await this.audit.decision(
      {
        id: this.id('decision'),
        object_type: objectType,
        object_id: objectId,
        actor_id: actorId,
        decision: decisionValue,
        summary,
        created_at: this.now(),
      },
      repository,
    );
  }

  private requireFound<T>(value: T | undefined, label: string): T {
    if (value === undefined) {
      throw new NotFoundException(`${label} not found`);
    }
    return value;
  }

  private id(prefix: string): string {
    return this.runtime.id(prefix);
  }

  private now(): string {
    return this.runtime.now();
  }
}
