import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { existsSync } from 'node:fs';
import {
  type AutomationActorClass,
  canGenerateExecutionPlanFromApprovedSpec,
  canGenerateSpecFromPlanItem,
  type BoundarySummary,
  type BrainstormingSession,
  type ContextManifest,
  type DevelopmentPlan,
  type DevelopmentPlanItem,
  type DevelopmentPlanItemRevision,
  type DevelopmentPlanRevision,
  type ExecutionPlanDocument,
  type ExecutionPlanRevision,
  type Plan,
  type PlanRevision,
  type Spec,
  type SpecRevision,
  type WorkItem,
  transitionSpecPlan,
  transitionWorkItem,
} from '@forgeloop/domain';
import type { DeliveryRepository } from '@forgeloop/db';
import type { ObjectRef } from '@forgeloop/contracts';

import { AuditWriterService } from '../audit/audit-writer.service';
import type { ActorContext } from '../auth/actor-context';
import { ControlPlaneRuntimeService } from '../core/control-plane-runtime.service';
import { DELIVERY_REPOSITORY } from '../core/control-plane-tokens';
import type {
  ApproveArtifactCommandDto,
  CreatePlanRevisionDto,
  CreateSpecRevisionDto,
  RegenerateArtifactDraftCommandDto,
  RejectArtifactCommandDto,
  RequestArtifactChangesCommandDto,
  RevisionCompareQueryDto,
  SubmitForApprovalCommandDto,
} from '../delivery/dto';
import { WorkItemService } from '../work-items/work-item.service';

const productGateRejectedActorClasses = new Set<AutomationActorClass>([
  'automation_daemon',
  'source_adapter',
  'external_tracker',
  'repo_policy',
]);

export type PublicSpecPlan = Omit<Spec | Plan, 'work_item_id'> & { scope_ref: ObjectRef };
export type PublicSpecRevision = Omit<SpecRevision, 'work_item_id' | 'structured_document' | 'artifact_refs'> & { scope_ref: ObjectRef };
export type PublicPlanRevision = Omit<PlanRevision, 'work_item_id' | 'structured_document' | 'artifact_refs'> & { scope_ref: ObjectRef };

@Injectable()
export class SpecPlanService {
  constructor(
    @Inject(DELIVERY_REPOSITORY) private readonly repository: DeliveryRepository,
    @Inject(ControlPlaneRuntimeService)
    private readonly controlPlaneRuntime: ControlPlaneRuntimeService,
    @Inject(AuditWriterService) private readonly audit: AuditWriterService,
    @Inject(WorkItemService) private readonly workItemService: WorkItemService,
  ) {}

  async generateItemSpecDraft(
    developmentPlanId: string,
    itemId: string,
    dto: SubmitForApprovalCommandDto,
  ): Promise<SpecRevision> {
    return this.withPlanItemMutation(developmentPlanId, async (repository) => {
      const { plan, item, workItem, boundary, brainstormingSession } = await this.requireApprovedBoundary(
        developmentPlanId,
        itemId,
        repository,
      );
      if ((await this.findItemSpec(item.id, repository)) !== undefined) {
        throw new ConflictException(`Development Plan Item ${item.id} already has a Spec`);
      }
      const contextManifest = await this.buildItemContextManifest(
        { plan, item, workItem, boundary, brainstormingSession, actorGuidance: dto.actor_id },
        repository,
      );
      await repository.saveContextManifest(contextManifest);

      const spec = {
        ...(transitionSpecPlan(undefined, {
          type: 'create',
          entity_type: 'spec',
          id: this.id('spec'),
          work_item_id: workItem.id,
          at: this.now(),
        }) as Spec),
        development_plan_item_id: item.id,
        boundary_summary_id: boundary.id,
        context_manifest_id: contextManifest.id,
      };
      await repository.saveSpec(spec);
      const revision = await this.saveSpecRevisionWithRepository(
        repository,
        spec,
        this.itemSpecDraftInput(workItem, item, boundary, contextManifest, dto.actor_id),
      );
      await repository.saveSpec({ ...spec, current_revision_id: revision.id, updated_at: this.now() });
      await repository.saveWorkItem({
        ...workItem,
        current_spec_id: spec.id,
        current_spec_revision_id: revision.id,
        updated_at: this.now(),
      });
      await this.updateDevelopmentPlanItemArtifactStatus(
        repository,
        plan,
        item,
        'spec_status',
        'draft',
        'spec_draft_generated',
        dto.actor_id,
      );
      await this.eventWithRepository(repository, 'development_plan_item', item.id, 'item_spec_draft_generated', dto.actor_id, {
        spec_id: spec.id,
        spec_revision_id: revision.id,
        context_manifest_id: contextManifest.id,
      });
      await this.eventWithRepository(repository, 'spec_revision', revision.id, 'spec_draft_generated', dto.actor_id, {
        spec_id: spec.id,
        development_plan_item_id: item.id,
      });
      return revision;
    });
  }

  async regenerateItemSpecDraft(
    developmentPlanId: string,
    itemId: string,
    dto: RegenerateArtifactDraftCommandDto,
  ): Promise<SpecRevision> {
    return this.withPlanItemMutation(developmentPlanId, async (repository) => {
      const { plan, item, workItem, boundary, brainstormingSession } = await this.requireApprovedBoundary(
        developmentPlanId,
        itemId,
        repository,
      );
      const spec = await this.requireItemSpec(item.id, repository);
      if (spec.status === 'approved') {
        throw new ConflictException(`Approved Spec ${spec.id} cannot be regenerated`);
      }
      const contextManifest = await this.buildItemContextManifest(
        {
          plan,
          item,
          workItem,
          boundary,
          brainstormingSession,
          actorGuidance: dto.feedback,
          regeneration: {
            feedback: dto.feedback,
            preserve_prior_decisions: dto.preserve_prior_decisions,
          },
        },
        repository,
      );
      await repository.saveContextManifest(contextManifest);
      const nextSpec = {
        ...spec,
        status: 'draft' as const,
        gate_state: 'changes_requested' as const,
        resolution: 'none' as const,
        context_manifest_id: contextManifest.id,
        updated_at: this.now(),
      };
      await repository.saveSpec(nextSpec);
      const revision = await this.saveSpecRevisionWithRepository(
        repository,
        nextSpec,
        this.itemSpecDraftInput(workItem, item, boundary, contextManifest, dto.actor_id, dto.feedback),
      );
      await repository.saveSpec({ ...nextSpec, current_revision_id: revision.id, updated_at: this.now() });
      await repository.saveWorkItem({
        ...workItem,
        current_spec_id: spec.id,
        current_spec_revision_id: revision.id,
        updated_at: this.now(),
      });
      await this.updateDevelopmentPlanItemArtifactStatus(
        repository,
        plan,
        item,
        'spec_status',
        'draft',
        'spec_draft_regenerated',
        dto.actor_id,
      );
      await this.eventWithRepository(repository, 'development_plan_item', item.id, 'item_spec_draft_regenerated', dto.actor_id, {
        spec_id: spec.id,
        spec_revision_id: revision.id,
        context_manifest_id: contextManifest.id,
        feedback: dto.feedback,
        preserve_prior_decisions: dto.preserve_prior_decisions,
      });
      return revision;
    });
  }

  async submitItemSpecForApproval(
    developmentPlanId: string,
    itemId: string,
    dto: SubmitForApprovalCommandDto,
  ): Promise<Spec> {
    return this.withPlanItemMutation(developmentPlanId, async (repository) => {
      const { plan, item } = await this.requirePlanItem(developmentPlanId, itemId, repository);
      const spec = await this.requireItemSpec(item.id, repository);
      const revisionId = this.requireCurrentRevision(spec);
      await this.requireRevisionNotRejected(revisionId, 'spec_revision', repository);
      const updated = transitionSpecPlan(spec, { type: 'submit_for_approval', at: this.now() }) as Spec;
      await repository.saveSpec(updated);
      await this.updateDevelopmentPlanItemArtifactStatus(
        repository,
        plan,
        item,
        'spec_status',
        'in_review',
        'spec_submitted_for_approval',
        dto.actor_id,
      );
      await this.historyWithRepository(repository, 'spec', spec.id, spec.status, updated.status, dto.actor_id);
      return updated;
    });
  }

  async approveItemSpec(developmentPlanId: string, itemId: string, dto: ApproveArtifactCommandDto): Promise<Spec> {
    return this.withPlanItemMutation(developmentPlanId, async (repository) => {
      const { plan, item, workItem } = await this.requirePlanItem(developmentPlanId, itemId, repository);
      const spec = await this.requireItemSpec(item.id, repository);
      const currentRevisionId = this.requireCurrentRevision(spec);
      this.requireInReview(spec);
      const reviewerActorId = this.requireActorId(dto.actor_id);
      const approvedAt = this.now();
      const updated = {
        ...(transitionSpecPlan(spec, { type: 'approve', at: approvedAt }) as Spec),
        approved_revision_id: currentRevisionId,
        approved_at: approvedAt,
        approved_by_actor_id: reviewerActorId,
      };
      await repository.saveSpec(updated);
      await repository.saveWorkItem({
        ...workItem,
        current_spec_id: spec.id,
        current_spec_revision_id: currentRevisionId,
        updated_at: approvedAt,
      });
      await this.updateDevelopmentPlanItemArtifactStatus(
        repository,
        plan,
        item,
        'spec_status',
        'approved',
        'spec_approved',
        reviewerActorId,
      );
      await this.historyWithRepository(repository, 'spec', spec.id, spec.status, updated.status, reviewerActorId);
      await this.decisionWithRepository(repository, 'spec', spec.id, reviewerActorId, 'approved', dto.rationale ?? 'Spec approved.');
      return updated;
    });
  }

  async requestItemSpecChanges(
    developmentPlanId: string,
    itemId: string,
    dto: RequestArtifactChangesCommandDto,
  ): Promise<Spec> {
    return this.withPlanItemMutation(developmentPlanId, async (repository) => {
      const { plan, item } = await this.requirePlanItem(developmentPlanId, itemId, repository);
      const spec = await this.requireItemSpec(item.id, repository);
      this.requireInReview(spec);
      const updated = transitionSpecPlan(spec, { type: 'request_changes', at: this.now() }) as Spec;
      await repository.saveSpec(updated);
      await this.updateDevelopmentPlanItemArtifactStatus(
        repository,
        plan,
        item,
        'spec_status',
        'changes_requested',
        'spec_changes_requested',
        dto.actor_id,
      );
      await this.historyWithRepository(repository, 'spec', spec.id, spec.status, updated.status, dto.actor_id);
      await this.decisionWithRepository(repository, 'spec', spec.id, dto.actor_id, 'changes_requested', dto.rationale);
      return updated;
    });
  }

  async rejectItemSpec(developmentPlanId: string, itemId: string, dto: RejectArtifactCommandDto): Promise<Spec> {
    return this.withPlanItemMutation(developmentPlanId, async (repository) => {
      const { plan, item } = await this.requirePlanItem(developmentPlanId, itemId, repository);
      const spec = await this.requireItemSpec(item.id, repository);
      const revisionId = this.requireCurrentRevision(spec);
      this.requireInReview(spec);
      const updated = transitionSpecPlan(spec, { type: 'request_changes', at: this.now() }) as Spec;
      await repository.saveSpec(updated);
      await this.updateDevelopmentPlanItemArtifactStatus(
        repository,
        plan,
        item,
        'spec_status',
        'changes_requested',
        'spec_rejected',
        dto.actor_id,
      );
      await this.eventWithRepository(repository, 'spec_revision', revisionId, 'spec_revision_rejected', dto.actor_id, {
        spec_id: spec.id,
        rationale: dto.rationale,
      });
      await this.historyWithRepository(repository, 'spec', spec.id, spec.status, updated.status, dto.actor_id);
      await this.decisionWithRepository(repository, 'spec', spec.id, dto.actor_id, 'changes_requested', dto.rationale);
      return updated;
    });
  }

  async compareItemSpecRevisions(
    developmentPlanId: string,
    itemId: string,
    query: RevisionCompareQueryDto,
  ): Promise<Record<string, unknown>> {
    await this.requirePlanItem(developmentPlanId, itemId);
    const base = await this.requireItemSpecRevision(itemId, query.base_revision_id);
    const compare = await this.requireItemSpecRevision(itemId, query.compare_revision_id);
    return this.revisionDiff(query, base, compare);
  }

  async generateItemExecutionPlanDraft(
    developmentPlanId: string,
    itemId: string,
    dto: SubmitForApprovalCommandDto,
  ): Promise<ExecutionPlanRevision> {
    return this.withPlanItemMutation(developmentPlanId, async (repository) => {
      const { plan, item, workItem, boundary, brainstormingSession } = await this.requireApprovedBoundary(
        developmentPlanId,
        itemId,
        repository,
      );
      if ((await this.findItemExecutionPlan(item.id, repository)) !== undefined) {
        throw new ConflictException(`Development Plan Item ${item.id} already has an Execution Plan`);
      }
      const { spec, specRevision } = await this.requireApprovedItemSpec(item.id, repository);
      const contextManifest = await this.buildItemContextManifest(
        {
          plan,
          item,
          workItem,
          boundary,
          brainstormingSession,
          actorGuidance: dto.actor_id,
          approvedSpecRevisionId: specRevision.id,
        },
        repository,
      );
      await repository.saveContextManifest(contextManifest);

      const at = this.now();
      const executionPlan: ExecutionPlanDocument = {
        id: this.id('execution-plan'),
        development_plan_item_id: item.id,
        status: 'draft',
        created_at: at,
        updated_at: at,
      };
      await repository.saveExecutionPlan(executionPlan);
      const revision = await this.saveExecutionPlanRevisionWithRepository(
        repository,
        executionPlan,
        this.itemExecutionPlanDraftInput(workItem, item, specRevision, contextManifest, dto.actor_id),
      );
      await repository.saveExecutionPlan({ ...executionPlan, current_revision_id: revision.id, updated_at: this.now() });
      await this.updateDevelopmentPlanItemArtifactStatus(
        repository,
        plan,
        item,
        'execution_plan_status',
        'draft',
        'execution_plan_draft_generated',
        dto.actor_id,
      );
      await this.eventWithRepository(
        repository,
        'development_plan_item',
        item.id,
        'item_execution_plan_draft_generated',
        dto.actor_id,
        {
          execution_plan_id: executionPlan.id,
          execution_plan_revision_id: revision.id,
          context_manifest_id: contextManifest.id,
        },
      );
      return revision;
    });
  }

  async regenerateItemExecutionPlanDraft(
    developmentPlanId: string,
    itemId: string,
    dto: RegenerateArtifactDraftCommandDto,
  ): Promise<ExecutionPlanRevision> {
    return this.withPlanItemMutation(developmentPlanId, async (repository) => {
      const { plan, item, workItem, boundary, brainstormingSession } = await this.requireApprovedBoundary(
        developmentPlanId,
        itemId,
        repository,
      );
      const executionPlan = await this.requireItemExecutionPlan(item.id, repository);
      if (executionPlan.status === 'approved') {
        throw new ConflictException(`Approved Execution Plan ${executionPlan.id} cannot be regenerated`);
      }
      const { specRevision } = await this.requireApprovedItemSpec(item.id, repository);
      const contextManifest = await this.buildItemContextManifest(
        {
          plan,
          item,
          workItem,
          boundary,
          brainstormingSession,
          actorGuidance: dto.feedback,
          approvedSpecRevisionId: specRevision.id,
          regeneration: {
            feedback: dto.feedback,
            preserve_prior_decisions: dto.preserve_prior_decisions,
          },
        },
        repository,
      );
      await repository.saveContextManifest(contextManifest);
      const draftPlan: ExecutionPlanDocument = { ...executionPlan, status: 'draft', updated_at: this.now() };
      await repository.saveExecutionPlan(draftPlan);
      const revision = await this.saveExecutionPlanRevisionWithRepository(
        repository,
        draftPlan,
        this.itemExecutionPlanDraftInput(workItem, item, specRevision, contextManifest, dto.actor_id, dto.feedback),
      );
      await repository.saveExecutionPlan({ ...draftPlan, current_revision_id: revision.id, updated_at: this.now() });
      await this.updateDevelopmentPlanItemArtifactStatus(
        repository,
        plan,
        item,
        'execution_plan_status',
        'draft',
        'execution_plan_draft_regenerated',
        dto.actor_id,
      );
      await this.eventWithRepository(
        repository,
        'development_plan_item',
        item.id,
        'item_execution_plan_draft_regenerated',
        dto.actor_id,
        {
          execution_plan_id: executionPlan.id,
          execution_plan_revision_id: revision.id,
          context_manifest_id: contextManifest.id,
          feedback: dto.feedback,
          preserve_prior_decisions: dto.preserve_prior_decisions,
        },
      );
      return revision;
    });
  }

  async submitItemExecutionPlanForApproval(
    developmentPlanId: string,
    itemId: string,
    dto: SubmitForApprovalCommandDto,
  ): Promise<ExecutionPlanDocument> {
    return this.withPlanItemMutation(developmentPlanId, async (repository) => {
      const { plan, item } = await this.requirePlanItem(developmentPlanId, itemId, repository);
      const executionPlan = await this.requireItemExecutionPlan(item.id, repository);
      const revisionId = this.requireExecutionPlanCurrentRevision(executionPlan);
      await this.requireRevisionNotRejected(revisionId, 'execution_plan_revision', repository);
      if (executionPlan.status !== 'draft' && executionPlan.status !== 'changes_requested') {
        throw new BadRequestException(`Execution Plan ${executionPlan.id} cannot be submitted from ${executionPlan.status}`);
      }
      const updated: ExecutionPlanDocument = { ...executionPlan, status: 'in_review', updated_at: this.now() };
      await repository.saveExecutionPlan(updated);
      await this.updateDevelopmentPlanItemArtifactStatus(
        repository,
        plan,
        item,
        'execution_plan_status',
        'in_review',
        'execution_plan_submitted_for_approval',
        dto.actor_id,
      );
      await this.historyWithRepository(repository, 'execution_plan', executionPlan.id, executionPlan.status, updated.status, dto.actor_id);
      return updated;
    });
  }

  async approveItemExecutionPlan(
    developmentPlanId: string,
    itemId: string,
    dto: ApproveArtifactCommandDto,
  ): Promise<ExecutionPlanDocument> {
    return this.withPlanItemMutation(developmentPlanId, async (repository) => {
      const { plan, item } = await this.requirePlanItem(developmentPlanId, itemId, repository);
      const executionPlan = await this.requireItemExecutionPlan(item.id, repository);
      if (executionPlan.status !== 'in_review') {
        throw new BadRequestException(`Execution Plan ${executionPlan.id} is not awaiting approval`);
      }
      const currentRevisionId = this.requireExecutionPlanCurrentRevision(executionPlan);
      const reviewerActorId = this.requireActorId(dto.actor_id);
      const approvedAt = this.now();
      const updated: ExecutionPlanDocument = {
        ...executionPlan,
        status: 'approved',
        approved_revision_id: currentRevisionId,
        approved_by_actor_id: reviewerActorId,
        approved_at: approvedAt,
        updated_at: approvedAt,
      };
      await repository.saveExecutionPlan(updated);
      await this.updateDevelopmentPlanItemArtifactStatus(
        repository,
        plan,
        item,
        'execution_plan_status',
        'approved',
        'execution_plan_approved',
        reviewerActorId,
      );
      await this.historyWithRepository(repository, 'execution_plan', executionPlan.id, executionPlan.status, updated.status, reviewerActorId);
      await this.decisionWithRepository(
        repository,
        'execution_plan',
        executionPlan.id,
        reviewerActorId,
        'approved',
        dto.rationale ?? 'Execution Plan approved.',
      );
      return updated;
    });
  }

  async requestItemExecutionPlanChanges(
    developmentPlanId: string,
    itemId: string,
    dto: RequestArtifactChangesCommandDto,
  ): Promise<ExecutionPlanDocument> {
    return this.withPlanItemMutation(developmentPlanId, async (repository) => {
      const { plan, item } = await this.requirePlanItem(developmentPlanId, itemId, repository);
      const executionPlan = await this.requireItemExecutionPlan(item.id, repository);
      if (executionPlan.status !== 'in_review') {
        throw new BadRequestException(`Execution Plan ${executionPlan.id} is not awaiting approval`);
      }
      const updated: ExecutionPlanDocument = { ...executionPlan, status: 'changes_requested', updated_at: this.now() };
      await repository.saveExecutionPlan(updated);
      await this.updateDevelopmentPlanItemArtifactStatus(
        repository,
        plan,
        item,
        'execution_plan_status',
        'changes_requested',
        'execution_plan_changes_requested',
        dto.actor_id,
      );
      await this.historyWithRepository(repository, 'execution_plan', executionPlan.id, executionPlan.status, updated.status, dto.actor_id);
      await this.decisionWithRepository(repository, 'execution_plan', executionPlan.id, dto.actor_id, 'changes_requested', dto.rationale);
      return updated;
    });
  }

  async rejectItemExecutionPlan(
    developmentPlanId: string,
    itemId: string,
    dto: RejectArtifactCommandDto,
  ): Promise<ExecutionPlanDocument> {
    return this.withPlanItemMutation(developmentPlanId, async (repository) => {
      const { plan, item } = await this.requirePlanItem(developmentPlanId, itemId, repository);
      const executionPlan = await this.requireItemExecutionPlan(item.id, repository);
      if (executionPlan.status !== 'in_review') {
        throw new BadRequestException(`Execution Plan ${executionPlan.id} is not awaiting approval`);
      }
      const revisionId = this.requireExecutionPlanCurrentRevision(executionPlan);
      const updated: ExecutionPlanDocument = { ...executionPlan, status: 'changes_requested', updated_at: this.now() };
      await repository.saveExecutionPlan(updated);
      await this.updateDevelopmentPlanItemArtifactStatus(
        repository,
        plan,
        item,
        'execution_plan_status',
        'changes_requested',
        'execution_plan_rejected',
        dto.actor_id,
      );
      await this.eventWithRepository(
        repository,
        'execution_plan_revision',
        revisionId,
        'execution_plan_revision_rejected',
        dto.actor_id,
        {
          execution_plan_id: executionPlan.id,
          rationale: dto.rationale,
        },
      );
      await this.historyWithRepository(repository, 'execution_plan', executionPlan.id, executionPlan.status, updated.status, dto.actor_id);
      await this.decisionWithRepository(repository, 'execution_plan', executionPlan.id, dto.actor_id, 'changes_requested', dto.rationale);
      return updated;
    });
  }

  async compareItemExecutionPlanRevisions(
    developmentPlanId: string,
    itemId: string,
    query: RevisionCompareQueryDto,
  ): Promise<Record<string, unknown>> {
    await this.requirePlanItem(developmentPlanId, itemId);
    const base = await this.requireItemExecutionPlanRevision(itemId, query.base_revision_id);
    const compare = await this.requireItemExecutionPlanRevision(itemId, query.compare_revision_id);
    return this.revisionDiff(query, base, compare);
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
      await this.eventWithRepository(repository, 'spec', spec.id, 'spec_created', workItem.driver_actor_id, { work_item_id: workItem.id });
      return spec;
    });
  }

  async createPublicSpec(workItemId: string): Promise<PublicSpecPlan> {
    return this.toPublicSpecPlan(await this.createSpec(workItemId));
  }

  async getSpec(specId: string): Promise<Spec> {
    return this.requireFound(await this.repository.getSpec(specId), `Spec ${specId}`);
  }

  async getPublicSpec(specId: string): Promise<PublicSpecPlan> {
    return this.toPublicSpecPlan(await this.getSpec(specId));
  }

  listSpecRevisions(specId: string): Promise<SpecRevision[]> {
    return this.repository.listSpecRevisions(specId);
  }

  async listPublicSpecRevisions(specId: string): Promise<PublicSpecRevision[]> {
    return Promise.all((await this.listSpecRevisions(specId)).map((revision) => this.toPublicSpecRevision(revision)));
  }

  async getSpecRevision(specRevisionId: string): Promise<SpecRevision> {
    return this.requireFound(await this.repository.getSpecRevision(specRevisionId), `SpecRevision ${specRevisionId}`);
  }

  async getPublicSpecRevision(specRevisionId: string): Promise<PublicSpecRevision> {
    return this.toPublicSpecRevision(await this.getSpecRevision(specRevisionId));
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

  async createPublicSpecRevision(specId: string, dto: CreateSpecRevisionDto): Promise<PublicSpecRevision> {
    return this.toPublicSpecRevision(await this.createSpecRevision(specId, dto));
  }

  async generateSpecDraft(specId: string): Promise<SpecRevision> {
    const spec = await this.getSpec(specId);
    const workItem = await this.workItemService.getWorkItem(spec.work_item_id);
    const drafting = transitionSpecPlan(spec, { type: 'generate_draft_start', at: this.now() }) as Spec;
    await this.repository.saveSpec(drafting);
    await this.event('spec', spec.id, 'spec_draft_generation_started', workItem.driver_actor_id, {});

    const revision = await this.saveSpecRevision(drafting, {
      summary: `Draft spec for ${workItem.title}`,
      content: [
        `Goal: ${workItem.goal}`,
        `Success criteria: ${workItem.success_criteria.join('; ')}`,
        'Scope: implement only the delivery behavior needed for this work item.',
        'Test strategy: cover command flow and persisted evidence.',
      ].join('\n\n'),
      background: workItem.goal,
      goals: [workItem.goal],
      scope_in: [`Deliver ${workItem.title}`],
      scope_out: ['Release, deploy, and non-delivery workflows'],
      acceptance_criteria: [...workItem.success_criteria],
      risk_notes: [workItem.risk],
      test_strategy_summary: `Validate ${workItem.title} with API and workflow tests.`,
      structured_document: { generated_by: 'mock_spec_draft_adapter', work_item_id: workItem.id },
      author_actor_id: workItem.driver_actor_id,
    });
    const updated = transitionSpecPlan({ ...drafting, current_revision_id: revision.id }, {
      type: 'generate_draft_success',
      at: this.now(),
    }) as Spec;
    await this.repository.saveSpec(updated);
    await this.event('spec_revision', revision.id, 'spec_draft_generated', workItem.driver_actor_id, { spec_id: spec.id });
    return revision;
  }

  async generatePublicSpecDraft(specId: string): Promise<PublicSpecRevision> {
    return this.toPublicSpecRevision(await this.generateSpecDraft(specId));
  }

  async submitSpecForApproval(specId: string, dto: SubmitForApprovalCommandDto, actorContext?: ActorContext): Promise<Spec> {
    const actorId = this.actorIdForProductGate(dto.actor_id, actorContext);
    const spec = await this.getSpec(specId);
    this.requireCurrentRevision(spec);
    const updated = transitionSpecPlan(spec, { type: 'submit_for_approval', at: this.now() }) as Spec;
    await this.repository.saveSpec(updated);
    await this.updateWorkItemForSpecPlan(updated.work_item_id, this.workItemSubmitTransitionFor(spec), actorId);
    await this.history('spec', spec.id, spec.status, updated.status, actorId);
    return updated;
  }

  async submitPublicSpecForApproval(
    specId: string,
    dto: SubmitForApprovalCommandDto,
    actorContext?: ActorContext,
  ): Promise<PublicSpecPlan> {
    return this.toPublicSpecPlan(await this.submitSpecForApproval(specId, dto, actorContext));
  }

  async approveSpec(specId: string, dto: ApproveArtifactCommandDto, actorContext?: ActorContext): Promise<Spec> {
    const actorId = this.actorIdForProductGate(dto.actor_id, actorContext);
    const spec = await this.getSpec(specId);
    const currentRevisionId = this.requireCurrentRevision(spec);
    this.requireInReview(spec);
    const approvedAt = this.now();
    const updated = {
      ...(transitionSpecPlan(spec, { type: 'approve', at: approvedAt }) as Spec),
      approved_revision_id: currentRevisionId,
      approved_at: approvedAt,
      approved_by_actor_id: actorId,
    };
    await this.repository.saveSpec(updated);
    await this.updateWorkItemForSpecPlan(updated.work_item_id, 'approve_spec', actorId, {
      current_spec_revision_id: updated.approved_revision_id!,
    });
    await this.history('spec', spec.id, spec.status, updated.status, actorId);
    await this.decision('spec', spec.id, actorId, 'approved', dto.rationale ?? 'Spec approved.');
    return updated;
  }

  async approvePublicSpec(specId: string, dto: ApproveArtifactCommandDto, actorContext?: ActorContext): Promise<PublicSpecPlan> {
    return this.toPublicSpecPlan(await this.approveSpec(specId, dto, actorContext));
  }

  async requestSpecChanges(specId: string, dto: RequestArtifactChangesCommandDto, actorContext?: ActorContext): Promise<Spec> {
    const actorId = this.actorIdForProductGate(dto.actor_id, actorContext);
    const spec = await this.getSpec(specId);
    this.requireInReview(spec);
    const updated = transitionSpecPlan(spec, { type: 'request_changes', at: this.now() }) as Spec;
    await this.repository.saveSpec(updated);
    await this.updateWorkItemForSpecPlan(updated.work_item_id, 'request_spec_changes', actorId);
    await this.history('spec', spec.id, spec.status, updated.status, actorId);
    await this.decision('spec', spec.id, actorId, 'changes_requested', dto.rationale);
    return updated;
  }

  async requestPublicSpecChanges(
    specId: string,
    dto: RequestArtifactChangesCommandDto,
    actorContext?: ActorContext,
  ): Promise<PublicSpecPlan> {
    return this.toPublicSpecPlan(await this.requestSpecChanges(specId, dto, actorContext));
  }

  async createPlan(workItemId: string): Promise<Plan> {
    return this.repository.withObjectLock(`work-item:${workItemId}`, async (repository) => {
      const workItem = this.requireFound(await repository.getWorkItem(workItemId), `WorkItem ${workItemId}`);
      await this.requireApprovedCurrentSpec(workItem, repository);
      const plan = transitionSpecPlan(undefined, {
        type: 'create',
        entity_type: 'plan',
        id: this.id('plan'),
        work_item_id: workItem.id,
        at: this.now(),
      }) as Plan;
      await repository.savePlan(plan);
      await repository.saveWorkItem({ ...workItem, current_plan_id: plan.id, updated_at: plan.updated_at });
      await this.eventWithRepository(repository, 'plan', plan.id, 'plan_created', workItem.driver_actor_id, { work_item_id: workItem.id });
      return plan;
    });
  }

  async createPublicPlan(workItemId: string): Promise<PublicSpecPlan> {
    return this.toPublicSpecPlan(await this.createPlan(workItemId));
  }

  async getPlan(planId: string): Promise<Plan> {
    return this.requireFound(await this.repository.getPlan(planId), `Plan ${planId}`);
  }

  async getPublicPlan(planId: string): Promise<PublicSpecPlan> {
    return this.toPublicSpecPlan(await this.getPlan(planId));
  }

  listPlanRevisions(planId: string): Promise<PlanRevision[]> {
    return this.repository.listPlanRevisions(planId);
  }

  async listPublicPlanRevisions(planId: string): Promise<PublicPlanRevision[]> {
    return Promise.all((await this.listPlanRevisions(planId)).map((revision) => this.toPublicPlanRevision(revision)));
  }

  async getPlanRevision(planRevisionId: string): Promise<PlanRevision> {
    return this.requireFound(await this.repository.getPlanRevision(planRevisionId), `PlanRevision ${planRevisionId}`);
  }

  async getPublicPlanRevision(planRevisionId: string): Promise<PublicPlanRevision> {
    return this.toPublicPlanRevision(await this.getPlanRevision(planRevisionId));
  }

  async createPlanRevision(planId: string, dto: CreatePlanRevisionDto): Promise<PlanRevision> {
    const plan = await this.getPlan(planId);
    const workItem = await this.workItemService.getWorkItem(plan.work_item_id);
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

  async createPublicPlanRevision(planId: string, dto: CreatePlanRevisionDto): Promise<PublicPlanRevision> {
    return this.toPublicPlanRevision(await this.createPlanRevision(planId, dto));
  }

  async generatePlanDraft(planId: string): Promise<PlanRevision> {
    const plan = await this.getPlan(planId);
    const workItem = await this.workItemService.getWorkItem(plan.work_item_id);
    const spec = await this.requireApprovedCurrentSpec(workItem);
    const specRevision = await this.getSpecRevision(spec.current_revision_id!);
    const drafting = transitionSpecPlan(plan, { type: 'generate_draft_start', at: this.now() }) as Plan;
    await this.repository.savePlan(drafting);
    await this.event('plan', plan.id, 'plan_draft_generation_started', workItem.driver_actor_id, {});

    const revision = await this.savePlanRevision(drafting, {
      summary: `Draft plan for ${workItem.title}`,
      content: `Implement the approved spec revision ${specRevision.id} with a bounded package and required checks.`,
      implementation_summary: `Deliver ${workItem.title} through the delivery control plane.`,
      split_strategy: 'Create one repo-bound execution package for the approved plan.',
      dependency_order: ['api-package'],
      test_matrix: ['pnpm test tests/api'],
      risk_mitigations: specRevision.risk_notes.length === 0 ? ['Keep package scope narrow.'] : specRevision.risk_notes,
      rollback_notes: 'Revert the execution package changes.',
      based_on_spec_revision_id: specRevision.id,
      structured_document: { generated_by: 'mock_plan_draft_adapter', spec_revision_id: specRevision.id },
      author_actor_id: workItem.driver_actor_id,
    });
    const updated = transitionSpecPlan({ ...drafting, current_revision_id: revision.id }, {
      type: 'generate_draft_success',
      at: this.now(),
    }) as Plan;
    await this.repository.savePlan(updated);
    await this.event('plan_revision', revision.id, 'plan_draft_generated', workItem.driver_actor_id, { plan_id: plan.id });
    return revision;
  }

  async generatePublicPlanDraft(planId: string): Promise<PublicPlanRevision> {
    return this.toPublicPlanRevision(await this.generatePlanDraft(planId));
  }

  async submitPlanForApproval(planId: string, dto: SubmitForApprovalCommandDto, actorContext?: ActorContext): Promise<Plan> {
    const actorId = this.actorIdForProductGate(dto.actor_id, actorContext);
    const plan = await this.getPlan(planId);
    this.requireCurrentRevision(plan);
    const updated = transitionSpecPlan(plan, { type: 'submit_for_approval', at: this.now() }) as Plan;
    await this.repository.savePlan(updated);
    await this.updateWorkItemForSpecPlan(updated.work_item_id, this.workItemSubmitTransitionFor(plan), actorId);
    await this.history('plan', plan.id, plan.status, updated.status, actorId);
    return updated;
  }

  async submitPublicPlanForApproval(
    planId: string,
    dto: SubmitForApprovalCommandDto,
    actorContext?: ActorContext,
  ): Promise<PublicSpecPlan> {
    return this.toPublicSpecPlan(await this.submitPlanForApproval(planId, dto, actorContext));
  }

  async approvePlan(planId: string, dto: ApproveArtifactCommandDto, actorContext?: ActorContext): Promise<Plan> {
    const actorId = this.actorIdForProductGate(dto.actor_id, actorContext);
    const plan = await this.getPlan(planId);
    const currentRevisionId = this.requireCurrentRevision(plan);
    this.requireInReview(plan);
    const approvedAt = this.now();
    const updated = {
      ...(transitionSpecPlan(plan, { type: 'approve', at: approvedAt }) as Plan),
      approved_revision_id: currentRevisionId,
      approved_at: approvedAt,
      approved_by_actor_id: actorId,
    };
    await this.repository.savePlan(updated);
    await this.updateWorkItemForSpecPlan(updated.work_item_id, 'approve_plan', actorId, {
      current_plan_revision_id: updated.approved_revision_id!,
    });
    await this.history('plan', plan.id, plan.status, updated.status, actorId);
    await this.decision('plan', plan.id, actorId, 'approved', dto.rationale ?? 'Plan approved.');
    return updated;
  }

  async approvePublicPlan(planId: string, dto: ApproveArtifactCommandDto, actorContext?: ActorContext): Promise<PublicSpecPlan> {
    return this.toPublicSpecPlan(await this.approvePlan(planId, dto, actorContext));
  }

  async requestPlanChanges(planId: string, dto: RequestArtifactChangesCommandDto, actorContext?: ActorContext): Promise<Plan> {
    const actorId = this.actorIdForProductGate(dto.actor_id, actorContext);
    const plan = await this.getPlan(planId);
    this.requireInReview(plan);
    const updated = transitionSpecPlan(plan, { type: 'request_changes', at: this.now() }) as Plan;
    await this.repository.savePlan(updated);
    await this.updateWorkItemForSpecPlan(updated.work_item_id, 'request_plan_changes', actorId);
    await this.history('plan', plan.id, plan.status, updated.status, actorId);
    await this.decision('plan', plan.id, actorId, 'changes_requested', dto.rationale);
    return updated;
  }

  async requestPublicPlanChanges(
    planId: string,
    dto: RequestArtifactChangesCommandDto,
    actorContext?: ActorContext,
  ): Promise<PublicSpecPlan> {
    return this.toPublicSpecPlan(await this.requestPlanChanges(planId, dto, actorContext));
  }

  private withPlanItemMutation<T>(
    developmentPlanId: string,
    write: (repository: DeliveryRepository) => Promise<T>,
  ): Promise<T> {
    return this.repository.withObjectLock(`development-plan:${developmentPlanId}`, async (lockedRepository) =>
      lockedRepository.withDeliveryTransaction(write),
    );
  }

  private async requirePlanItem(
    developmentPlanId: string,
    itemId: string,
    repository: DeliveryRepository = this.repository,
  ): Promise<{ plan: DevelopmentPlan; item: DevelopmentPlanItem; workItem: WorkItem }> {
    const plan = this.requireFound(await repository.getDevelopmentPlan(developmentPlanId), `Development Plan ${developmentPlanId}`);
    const item = await repository.getDevelopmentPlanItem(itemId);
    if (item === undefined || item.development_plan_id !== developmentPlanId) {
      throw new NotFoundException(`Development Plan Item ${itemId} not found`);
    }
    const workItem = this.requireFound(await repository.getWorkItem(item.source_ref.id), `${item.source_ref.type} ${item.source_ref.id}`);
    return { plan, item, workItem };
  }

  private async requireApprovedBoundary(
    developmentPlanId: string,
    itemId: string,
    repository: DeliveryRepository,
  ): Promise<{
    plan: DevelopmentPlan;
    item: DevelopmentPlanItem;
    workItem: WorkItem;
    boundary: BoundarySummary;
    brainstormingSession: BrainstormingSession;
  }> {
    const { plan, item, workItem } = await this.requirePlanItem(developmentPlanId, itemId, repository);
    const boundarySummaryId = await this.boundarySummaryIdForItem(item.id, repository);
    const boundary = boundarySummaryId === undefined ? undefined : await repository.getBoundarySummary(boundarySummaryId);
    const brainstormingSession =
      boundary === undefined ? undefined : await repository.getBrainstormingSession(boundary.brainstorming_session_id);
    const boundarySummaryForGate =
      boundary === undefined
        ? undefined
        : {
            ...(boundary.approved_by_actor_id === undefined ? {} : { approved_by_actor_id: boundary.approved_by_actor_id }),
            ...(boundary.approved_at === undefined ? {} : { approved_at: boundary.approved_at }),
          };
    const gate = canGenerateSpecFromPlanItem({
      item,
      ...(brainstormingSession === undefined ? {} : { brainstormingSession }),
      ...(boundarySummaryForGate === undefined ? {} : { boundarySummary: boundarySummaryForGate }),
    });
    if (!gate.ok) {
      throw new BadRequestException(`Development Plan Item ${item.id} cannot generate Spec: ${gate.reason}`);
    }
    return { plan, item, workItem, boundary: boundary!, brainstormingSession: brainstormingSession! };
  }

  private async boundarySummaryIdForItem(itemId: string, repository: DeliveryRepository): Promise<string | undefined> {
    const events = await repository.listObjectEvents(itemId, 'development_plan_item');
    return events
      .slice()
      .reverse()
      .map((event) => event.metadata.boundary_summary_id)
      .find((value): value is string => typeof value === 'string' && value.trim().length > 0);
  }

  private async findItemSpec(itemId: string, repository: DeliveryRepository): Promise<Spec | undefined> {
    return (await repository.listSpecs())
      .filter((spec) => spec.development_plan_item_id === itemId)
      .sort((left, right) => right.updated_at.localeCompare(left.updated_at))[0];
  }

  private async requireItemSpec(itemId: string, repository: DeliveryRepository): Promise<Spec> {
    const spec = await this.findItemSpec(itemId, repository);
    if (spec === undefined) {
      throw new NotFoundException(`Development Plan Item ${itemId} has no Spec`);
    }
    return spec;
  }

  private async requireApprovedItemSpec(
    itemId: string,
    repository: DeliveryRepository,
  ): Promise<{ spec: Spec; specRevision: SpecRevision }> {
    const spec = await this.findItemSpec(itemId, repository);
    if (spec === undefined) {
      throw new BadRequestException(`Development Plan Item ${itemId} cannot generate Execution Plan: spec_not_approved`);
    }
    const approvedRevisionId = spec.approved_revision_id;
    const specRevision = approvedRevisionId === undefined ? undefined : await repository.getSpecRevision(approvedRevisionId);
    const gate = canGenerateExecutionPlanFromApprovedSpec({
      spec,
      ...(specRevision === undefined ? {} : { specRevision }),
    });
    if (!gate.ok || spec.current_revision_id !== approvedRevisionId) {
      throw new BadRequestException(`Development Plan Item ${itemId} cannot generate Execution Plan: ${gate.ok ? 'approved_spec_not_current' : gate.reason}`);
    }
    return { spec, specRevision: specRevision! };
  }

  private async findItemExecutionPlan(
    itemId: string,
    repository: DeliveryRepository,
  ): Promise<ExecutionPlanDocument | undefined> {
    const events = await repository.listObjectEvents(itemId, 'development_plan_item');
    const executionPlanId = events
      .slice()
      .reverse()
      .map((event) => event.metadata.execution_plan_id)
      .find((value): value is string => typeof value === 'string' && value.trim().length > 0);
    return executionPlanId === undefined ? undefined : repository.getExecutionPlan(executionPlanId);
  }

  private async requireItemExecutionPlan(itemId: string, repository: DeliveryRepository): Promise<ExecutionPlanDocument> {
    const executionPlan = await this.findItemExecutionPlan(itemId, repository);
    if (executionPlan === undefined) {
      throw new NotFoundException(`Development Plan Item ${itemId} has no Execution Plan`);
    }
    return executionPlan;
  }

  private async buildItemContextManifest(
    input: {
      plan: DevelopmentPlan;
      item: DevelopmentPlanItem;
      workItem: WorkItem;
      boundary: BoundarySummary;
      brainstormingSession: BrainstormingSession;
      actorGuidance?: string | undefined;
      approvedSpecRevisionId?: string | undefined;
      regeneration?: { feedback: string; preserve_prior_decisions: boolean } | undefined;
    },
    repository: DeliveryRepository,
  ): Promise<ContextManifest> {
    const projectRepos = await repository.listProjectRepos(input.plan.project_id);
    const at = this.now();
    return {
      id: this.id('context-manifest'),
      revision_id: this.id('context-manifest-revision'),
      source_ref: { ...input.item.source_ref, revision_id: input.workItem.updated_at },
      development_plan_id: input.plan.id,
      development_plan_revision_id: input.plan.revision_id,
      development_plan_item_id: input.item.id,
      development_plan_item_revision_id: input.item.revision_id,
      brainstorming_session_id: input.brainstormingSession.id,
      brainstorming_session_revision_id: input.brainstormingSession.revision_id,
      boundary_summary_id: input.boundary.id,
      boundary_summary_revision_id: input.boundary.revision_id,
      boundary_approver_actor_id: input.boundary.approved_by_actor_id,
      boundary_approved_at: input.boundary.approved_at,
      ...(input.approvedSpecRevisionId === undefined ? {} : { approved_spec_revision_id: input.approvedSpecRevisionId }),
      sources: [
        { type: 'source_object_revision', ref: `${input.workItem.kind}:${input.workItem.id}`, digest: input.workItem.updated_at },
        { type: 'development_plan', ref: input.plan.id, digest: input.plan.revision_id },
        { type: 'development_plan_item', ref: input.item.id, digest: input.item.revision_id },
        { type: 'brainstorming_session', ref: input.brainstormingSession.id, digest: input.brainstormingSession.revision_id },
        { type: 'boundary_summary', ref: input.boundary.id, digest: input.boundary.revision_id },
        ...(existsSync('docs/PRD_v1.md') ? [{ type: 'prd_product_doc', ref: 'docs/PRD_v1.md' }] : []),
        ...(existsSync('packages/contracts/src/ai-project-management.ts')
          ? [{ type: 'contract_doc', ref: 'packages/contracts/src/ai-project-management.ts' }]
          : []),
        ...projectRepos.map((repo) => ({ type: 'repository_path', ref: repo.local_path, digest: repo.base_commit_sha })),
        ...(input.actorGuidance === undefined
          ? []
          : [{ type: 'actor_guidance', ref: input.actorGuidance, digest: `${input.actorGuidance.length}` }]),
        ...(input.regeneration === undefined
          ? []
          : [
              { type: 'regeneration_feedback', ref: input.regeneration.feedback, digest: `${input.regeneration.feedback.length}` },
              {
                type: 'preserve_prior_decisions',
                ref: String(input.regeneration.preserve_prior_decisions),
              },
            ]),
      ],
      generated_at: at,
      runtime_identity: 'control-plane-api:spec-plan',
      created_at: at,
      updated_at: at,
    };
  }

  private itemSpecDraftInput(
    workItem: WorkItem,
    item: DevelopmentPlanItem,
    boundary: BoundarySummary,
    contextManifest: ContextManifest,
    actorId: string | undefined,
    feedback?: string,
  ): Omit<SpecRevision, 'id' | 'spec_id' | 'work_item_id' | 'revision_number' | 'artifact_refs' | 'created_at'> {
    const feedbackLine = feedback === undefined ? '' : `\n\nRegeneration feedback: ${feedback}`;
    return {
      development_plan_item_id: item.id,
      boundary_summary_id: boundary.id,
      context_manifest_id: contextManifest.id,
      summary: `Draft spec for ${item.title}`,
      content: [
        `Goal: ${workItem.goal}`,
        `Development Plan Item: ${item.summary}`,
        `Boundary Summary:\n${boundary.summary}`,
        `Success criteria: ${workItem.success_criteria.join('; ')}`,
        'Scope: implement only the approved Development Plan Item boundary.',
        'Test strategy: cover item-scoped API gates, review loops, and persisted context manifests.',
      ].join('\n\n') + feedbackLine,
      background: workItem.goal,
      goals: [workItem.goal],
      scope_in: [item.summary, ...item.affected_surfaces],
      scope_out: ['Direct Work Item Spec or Execution Plan creation compatibility'],
      acceptance_criteria: [...workItem.success_criteria],
      risk_notes: [workItem.risk, ...item.dependency_hints],
      test_strategy_summary: 'Validate item-scoped Spec gate behavior with API and contract tests.',
      structured_document: {
        generated_by: 'mock_item_spec_draft_adapter',
        development_plan_item_id: item.id,
        boundary_summary_id: boundary.id,
        context_manifest_id: contextManifest.id,
      },
      ...(actorId === undefined ? {} : { author_actor_id: actorId }),
    };
  }

  private itemExecutionPlanDraftInput(
    workItem: WorkItem,
    item: DevelopmentPlanItem,
    specRevision: SpecRevision,
    contextManifest: ContextManifest,
    actorId: string | undefined,
    feedback?: string,
  ): Omit<ExecutionPlanRevision, 'id' | 'execution_plan_id' | 'development_plan_item_id' | 'revision_number' | 'created_at'> {
    const feedbackLine = feedback === undefined ? '' : `\n\nRegeneration feedback: ${feedback}`;
    return {
      based_on_spec_revision_id: specRevision.id,
      summary: `Draft execution plan for ${item.title}`,
      content:
        [
          `Implement approved Spec revision ${specRevision.id}.`,
          `Development Plan Item: ${item.summary}`,
          `Required checks: ${item.affected_surfaces.join(', ') || 'focused API and product tests'}.`,
          `Rollback: revert the scoped changes for ${workItem.title}.`,
        ].join('\n\n') + feedbackLine,
      structured_document: {
        generated_by: 'mock_item_execution_plan_draft_adapter',
        development_plan_item_id: item.id,
        spec_revision_id: specRevision.id,
        context_manifest_id: contextManifest.id,
      },
      ...(actorId === undefined ? {} : { author_actor_id: actorId }),
    };
  }

  private async updateDevelopmentPlanItemArtifactStatus(
    repository: DeliveryRepository,
    plan: DevelopmentPlan,
    item: DevelopmentPlanItem,
    field: 'spec_status' | 'execution_plan_status',
    status: DevelopmentPlanItem['spec_status'],
    changeReason: string,
    actorId: string | undefined,
  ): Promise<DevelopmentPlanItem> {
    const updatedItem: DevelopmentPlanItem = {
      ...item,
      revision_id: this.id('development-plan-item-revision'),
      [field]: status,
      next_action: this.nextActionForItemStatus(field, status),
      updated_at: this.now(),
    };
    await repository.saveDevelopmentPlanItem(updatedItem);
    await this.saveDevelopmentPlanItemRevision(repository, updatedItem, changeReason, actorId);
    const updatedPlan: DevelopmentPlan = {
      ...plan,
      revision_id: this.id('development-plan-revision'),
      updated_at: this.now(),
    };
    await repository.saveDevelopmentPlan(updatedPlan);
    await this.saveDevelopmentPlanRevision(repository, updatedPlan, changeReason, actorId);
    return updatedItem;
  }

  private nextActionForItemStatus(
    field: 'spec_status' | 'execution_plan_status',
    status: DevelopmentPlanItem['spec_status'],
  ): string {
    if (field === 'spec_status') {
      if (status === 'draft') return 'submit_spec_for_approval';
      if (status === 'in_review') return 'review_spec';
      if (status === 'approved') return 'generate_execution_plan';
      if (status === 'changes_requested') return 'regenerate_spec';
      return 'generate_spec';
    }
    if (status === 'draft') return 'submit_execution_plan_for_approval';
    if (status === 'in_review') return 'review_execution_plan';
    if (status === 'approved') return 'start_execution';
    if (status === 'changes_requested') return 'regenerate_execution_plan';
    return 'generate_execution_plan';
  }

  private async saveDevelopmentPlanItemRevision(
    repository: DeliveryRepository,
    item: DevelopmentPlanItem,
    changeReason: string,
    actorId: string | undefined,
  ): Promise<DevelopmentPlanItemRevision> {
    const revision: DevelopmentPlanItemRevision = {
      id: item.revision_id,
      development_plan_item_id: item.id,
      development_plan_id: item.development_plan_id,
      revision_number: (await repository.listDevelopmentPlanItemRevisions(item.id)).length + 1,
      snapshot: item,
      change_reason: changeReason,
      ...(actorId === undefined ? {} : { edited_by_actor_id: actorId }),
      created_at: this.now(),
    };
    await repository.saveDevelopmentPlanItemRevision(revision);
    return revision;
  }

  private async saveDevelopmentPlanRevision(
    repository: DeliveryRepository,
    plan: DevelopmentPlan,
    changeReason: string,
    actorId: string | undefined,
  ): Promise<DevelopmentPlanRevision> {
    const [revisions, items] = await Promise.all([
      repository.listDevelopmentPlanRevisions(plan.id),
      repository.listDevelopmentPlanItems(plan.id),
    ]);
    const revision: DevelopmentPlanRevision = {
      id: plan.revision_id,
      development_plan_id: plan.id,
      revision_number: revisions.length + 1,
      title: plan.title,
      status: plan.status,
      source_refs: plan.source_refs,
      item_refs: items.map((item) => ({
        id: item.id,
        revision_id: item.revision_id,
        title: item.title,
        boundary_status: item.boundary_status,
        spec_status: item.spec_status,
        execution_plan_status: item.execution_plan_status,
        execution_status: item.execution_status,
      })),
      change_reason: changeReason,
      ...(actorId === undefined ? {} : { actor_id: actorId }),
      created_at: this.now(),
    };
    await repository.saveDevelopmentPlanRevision(revision);
    return revision;
  }

  private async saveSpecRevisionWithRepository(
    repository: DeliveryRepository,
    spec: Spec,
    input: Omit<SpecRevision, 'id' | 'spec_id' | 'work_item_id' | 'revision_number' | 'artifact_refs' | 'created_at'>,
  ): Promise<SpecRevision> {
    const revision: SpecRevision = {
      id: this.id('spec-revision'),
      spec_id: spec.id,
      work_item_id: spec.work_item_id,
      ...(input.development_plan_item_id !== undefined ? { development_plan_item_id: input.development_plan_item_id } : {}),
      ...(input.boundary_summary_id !== undefined ? { boundary_summary_id: input.boundary_summary_id } : {}),
      ...(input.context_manifest_id !== undefined ? { context_manifest_id: input.context_manifest_id } : {}),
      revision_number: (await repository.listSpecRevisions(spec.id)).length + 1,
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
    await repository.saveSpecRevision(revision);
    return revision;
  }

  private async saveExecutionPlanRevisionWithRepository(
    repository: DeliveryRepository,
    executionPlan: ExecutionPlanDocument,
    input: Omit<ExecutionPlanRevision, 'id' | 'execution_plan_id' | 'development_plan_item_id' | 'revision_number' | 'created_at'>,
  ): Promise<ExecutionPlanRevision> {
    const revision: ExecutionPlanRevision = {
      id: this.id('execution-plan-revision'),
      execution_plan_id: executionPlan.id,
      development_plan_item_id: executionPlan.development_plan_item_id,
      based_on_spec_revision_id: input.based_on_spec_revision_id,
      revision_number: (await repository.listExecutionPlanRevisions(executionPlan.id)).length + 1,
      summary: input.summary,
      content: input.content,
      ...(input.structured_document !== undefined ? { structured_document: input.structured_document } : {}),
      ...(input.author_actor_id !== undefined ? { author_actor_id: input.author_actor_id } : {}),
      created_at: this.now(),
    };
    await repository.saveExecutionPlanRevision(revision);
    return revision;
  }

  private async requireItemSpecRevision(itemId: string, revisionId: string): Promise<SpecRevision> {
    const revision = this.requireFound(await this.repository.getSpecRevision(revisionId), `Spec Revision ${revisionId}`);
    if (revision.development_plan_item_id !== itemId) {
      throw new NotFoundException(`Spec Revision ${revisionId} not found`);
    }
    return revision;
  }

  private async requireItemExecutionPlanRevision(itemId: string, revisionId: string): Promise<ExecutionPlanRevision> {
    const revision = this.requireFound(await this.repository.getExecutionPlanRevision(revisionId), `Execution Plan Revision ${revisionId}`);
    if (revision.development_plan_item_id !== itemId) {
      throw new NotFoundException(`Execution Plan Revision ${revisionId} not found`);
    }
    return revision;
  }

  private revisionDiff(
    query: RevisionCompareQueryDto,
    base: object,
    compare: object,
  ): Record<string, unknown> {
    const baseRecord = base as Record<string, unknown>;
    const compareRecord = compare as Record<string, unknown>;
    const keys = new Set([...Object.keys(baseRecord), ...Object.keys(compareRecord)]);
    const changedFields = [...keys]
      .filter((key) => JSON.stringify(baseRecord[key]) !== JSON.stringify(compareRecord[key]))
      .sort();
    return {
      base_revision_id: query.base_revision_id,
      compare_revision_id: query.compare_revision_id,
      changed_fields: changedFields,
      base_snapshot: baseRecord,
      compare_snapshot: compareRecord,
    };
  }

  private requireExecutionPlanCurrentRevision(executionPlan: ExecutionPlanDocument): string {
    if (executionPlan.current_revision_id === undefined) {
      throw new BadRequestException(`Execution Plan ${executionPlan.id} has no current revision`);
    }
    return executionPlan.current_revision_id;
  }

  private async requireRevisionNotRejected(
    revisionId: string,
    objectType: 'spec_revision' | 'execution_plan_revision',
    repository: DeliveryRepository,
  ): Promise<void> {
    const rejected = (await repository.listObjectEvents(revisionId, objectType)).some((event) =>
      event.event_type.endsWith('_revision_rejected'),
    );
    if (rejected) {
      throw new BadRequestException(`Revision ${revisionId} was rejected and must be regenerated before resubmission`);
    }
  }

  private async decisionWithRepository(
    repository: DeliveryRepository,
    objectType: string,
    objectId: string,
    actorId: string | undefined,
    decisionValue: 'approved' | 'changes_requested',
    summary: string,
  ): Promise<void> {
    await this.audit.decision(
      {
        id: this.id('decision'),
        object_type: objectType,
        object_id: objectId,
        actor_id: this.requireActorId(actorId),
        decision: decisionValue,
        summary,
        created_at: this.now(),
      },
      repository,
    );
  }

  private requireActorId(actorId: string | undefined): string {
    if (actorId === undefined || actorId.trim().length === 0) {
      throw new BadRequestException('actor_id is required');
    }
    return actorId;
  }

  private async toPublicSpecPlan(entity: Spec | Plan): Promise<PublicSpecPlan> {
    const { work_item_id: workItemId, ...publicEntity } = entity;
    return { ...publicEntity, scope_ref: await this.scopeRefForWorkItemId(workItemId) };
  }

  private async toPublicSpecRevision(revision: SpecRevision): Promise<PublicSpecRevision> {
    const {
      work_item_id: workItemId,
      structured_document: _structuredDocument,
      artifact_refs: _artifactRefs,
      ...publicRevision
    } = revision;
    return { ...publicRevision, scope_ref: await this.scopeRefForWorkItemId(workItemId) };
  }

  private async toPublicPlanRevision(revision: PlanRevision): Promise<PublicPlanRevision> {
    const {
      work_item_id: workItemId,
      structured_document: _structuredDocument,
      artifact_refs: _artifactRefs,
      ...publicRevision
    } = revision;
    return { ...publicRevision, scope_ref: await this.scopeRefForWorkItemId(workItemId) };
  }

  private async scopeRefForWorkItemId(workItemId: string): Promise<ObjectRef> {
    const workItem = this.requireFound(await this.repository.getWorkItem(workItemId), `WorkItem ${workItemId}`);
    return { type: workItem.kind, id: workItem.id, title: workItem.title } as ObjectRef;
  }

  private async requireApprovedCurrentSpec(workItem: WorkItem, repository: DeliveryRepository = this.repository): Promise<Spec> {
    if (workItem.current_spec_id === undefined) {
      throw new BadRequestException(`WorkItem ${workItem.id} has no current spec`);
    }
    const spec = this.requireFound(await repository.getSpec(workItem.current_spec_id), `Spec ${workItem.current_spec_id}`);
    const approvedRevisionId = spec.approved_revision_id;
    if (
      spec.status !== 'approved' ||
      spec.resolution !== 'approved' ||
      approvedRevisionId === undefined ||
      spec.current_revision_id !== approvedRevisionId
    ) {
      throw new BadRequestException(`Spec ${spec.id} does not have an approved current revision`);
    }
    return spec;
  }

  private async updateWorkItemForSpecPlan(
    workItemId: string,
    type:
      | 'submit_spec'
      | 'approve_spec'
      | 'request_spec_changes'
      | 'resubmit_spec'
      | 'submit_plan'
      | 'approve_plan'
      | 'request_plan_changes'
      | 'resubmit_plan',
    actorId: string | undefined,
    revisionPointerUpdates: Partial<Pick<WorkItem, 'current_spec_revision_id' | 'current_plan_revision_id'>> = {},
  ): Promise<void> {
    await this.repository.withObjectLock(`work-item:${workItemId}`, async (repository) => {
      const workItem = this.requireFound(await repository.getWorkItem(workItemId), `WorkItem ${workItemId}`);
      const updated = {
        ...transitionWorkItem(workItem, { type, at: this.now() }),
        ...revisionPointerUpdates,
      };
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

  private requireCurrentRevision(entity: Spec | Plan): string {
    if (entity.current_revision_id === undefined) {
      throw new BadRequestException(`${this.artifactLabel(entity)} ${entity.id} has no current revision`);
    }
    return entity.current_revision_id;
  }

  private requireInReview(entity: Spec | Plan): void {
    if (entity.status !== 'in_review' || entity.gate_state !== 'awaiting_approval') {
      throw new BadRequestException(`${this.artifactLabel(entity)} ${entity.id} is not awaiting approval`);
    }
  }

  private workItemSubmitTransitionFor(entity: Spec | Plan): 'submit_spec' | 'resubmit_spec' | 'submit_plan' | 'resubmit_plan' {
    if (entity.entity_type === 'spec') {
      return entity.gate_state === 'changes_requested' ? 'resubmit_spec' : 'submit_spec';
    }
    return entity.gate_state === 'changes_requested' ? 'resubmit_plan' : 'submit_plan';
  }

  private artifactLabel(entity: Spec | Plan): 'Spec' | 'Plan' {
    return entity.entity_type === 'spec' ? 'Spec' : 'Plan';
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
    await this.audit.objectEvent(
      {
        id: this.id('event'),
        object_type: objectType,
        object_id: objectId,
        event_type: eventType,
        ...(actorId !== undefined ? { actor_id: actorId } : {}),
        metadata,
        created_at: this.now(),
      },
      repository,
    );
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
    await this.audit.statusHistory(
      {
        id: this.id('status-history'),
        object_type: objectType,
        object_id: objectId,
        ...(fromStatus !== undefined ? { from_status: fromStatus } : {}),
        to_status: toStatus,
        ...(actorId !== undefined ? { actor_id: actorId } : {}),
        created_at: this.now(),
      },
      repository,
    );
  }

  private async decision(
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
      this.repository,
    );
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

  private requireFound<T>(value: T | undefined, label: string): T {
    if (value === undefined) {
      throw new NotFoundException(`${label} not found`);
    }
    return value;
  }

  private id(prefix: string): string {
    return this.controlPlaneRuntime.id(prefix);
  }

  private now(): string {
    return this.controlPlaneRuntime.now();
  }
}
