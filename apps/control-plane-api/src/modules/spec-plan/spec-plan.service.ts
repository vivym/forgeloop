import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { existsSync } from 'node:fs';
import {
  canGenerateExecutionPlanFromApprovedSpec,
  canGenerateSpecFromPlanItem,
  codexCanonicalDigest,
  requiredBoundaryQuestionsClosed,
  type AutomationActionRun,
  type AutomationScope,
  type BoundarySummary,
  type BoundarySummaryRevision,
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
} from '@forgeloop/domain';
import type { GeneratedExecutionPlanRevisionV1, GeneratedSpecRevisionV1 } from '@forgeloop/codex-runtime';
import type { DeliveryRepository } from '@forgeloop/db';
import type { AttachmentRef, MarkdownDocument, ObjectRef } from '@forgeloop/contracts';

import { AttachmentsService } from '../attachments/attachments.service';
import { AuditWriterService } from '../audit/audit-writer.service';
import {
  ProductGenerationRuntimeSchedulerService,
  type ProductGenerationRuntimeScheduleResult,
} from '../codex-runtime/product-generation-runtime-scheduler.service';
import { ControlPlaneRuntimeService } from '../core/control-plane-runtime.service';
import { DELIVERY_REPOSITORY } from '../core/control-plane-tokens';
import type {
  ApproveArtifactCommandDto,
  RegenerateArtifactDraftCommandDto,
  RejectArtifactCommandDto,
  RequestArtifactChangesCommandDto,
  RevisionCompareQueryDto,
  SubmitForApprovalCommandDto,
} from '../delivery/dto';
import { ExecutionPackageService } from '../execution-packages/execution-package.service';
import { MarkdownDocumentService } from '../markdown/markdown-document.service';

export type PublicSpecPlan = Omit<Spec | Plan, 'work_item_id'> & { scope_ref: ObjectRef };
export type PublicSpecRevision = Omit<SpecRevision, 'work_item_id' | 'structured_document' | 'artifact_refs'> & {
  attachment_refs: AttachmentRef[];
  scope_ref: ObjectRef;
};
export type PublicPlanRevision = Omit<PlanRevision, 'work_item_id' | 'structured_document' | 'artifact_refs'> & { scope_ref: ObjectRef };
export type PublicImplementationPlanRevision = Omit<ExecutionPlanRevision, 'structured_document' | 'execution_plan_id'> & {
  attachment_refs: AttachmentRef[];
  implementation_plan_id: string;
};
export type ProductGenerationScheduleResult = ProductGenerationRuntimeScheduleResult;
export type ProductGenerationApplyResult<T> =
  | { applied: true; revision: T }
  | { applied: false; reason: 'invalid_precondition' | 'stale_precondition_fingerprint' | 'public_unsafe_payload' };

type LoadedProductGenerationPrecondition = {
  plan: DevelopmentPlan;
  item: DevelopmentPlanItem;
  workItem: WorkItem;
  boundary: BoundarySummary;
  boundaryRevision: BoundarySummaryRevision;
  brainstormingSession: BrainstormingSession;
  contextManifest: ContextManifest;
};

const runtimeSensitiveTextPattern =
  /~\/\.codex(?:\/(?:config\.toml|auth\.json))?|\b(?:config\.toml|auth\.json)\b|https?:\/\/(?:localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[?::1\]?)(?::\d{1,5})?(?:\/\S*)?|unix:\/\/\S+|\/(?:Users|home|tmp|var|private|workspace|workspaces|app|mnt|Volumes)\/\S+|[\w.-]+\.sock\b|\b(?:localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0)(?::\d{1,5})?\b|\b[0-9a-f]{64}\b/gi;

@Injectable()
export class SpecPlanService {
  constructor(
    @Inject(DELIVERY_REPOSITORY) private readonly repository: DeliveryRepository,
    @Inject(ControlPlaneRuntimeService)
    private readonly controlPlaneRuntime: ControlPlaneRuntimeService,
    @Inject(AuditWriterService) private readonly audit: AuditWriterService,
    @Inject(ProductGenerationRuntimeSchedulerService)
    private readonly productRuntimeScheduler: ProductGenerationRuntimeSchedulerService,
    @Inject(AttachmentsService) private readonly attachments: AttachmentsService,
    @Inject(MarkdownDocumentService) private readonly markdownDocuments: MarkdownDocumentService,
    @Inject(ExecutionPackageService) private readonly executionPackages: ExecutionPackageService,
  ) {}

  async generateItemSpecRevisionRuntime(
    developmentPlanId: string,
    itemId: string,
    dto: SubmitForApprovalCommandDto,
  ): Promise<ProductGenerationScheduleResult> {
    return this.withPlanItemMutation(developmentPlanId, async (repository) => {
      const actorId = this.requireActorId(dto.actor_id);
      const replayed = await this.replayAppliedProductGenerationSchedule(
        repository,
        itemId,
        'item_spec_runtime_draft_generated',
        'generate_development_plan_item_spec_revision',
        actorId,
      );
      if (replayed !== undefined) {
        return replayed;
      }
      const { plan, item, workItem, boundary, boundaryRevision, brainstormingSession } =
        await this.requireApprovedBoundaryRevision(developmentPlanId, itemId, repository, { requireCurrentItemRevision: true });
      if ((await this.findItemSpec(item.id, repository)) !== undefined) {
        throw new ConflictException(`Development Plan Item ${item.id} already has a Spec`);
      }
      const contextManifest = this.stableProductGenerationContextManifest(
        await this.buildItemContextManifest(
          { plan, item, workItem, boundary, brainstormingSession, actorGuidance: actorId },
          repository,
        ),
        {
          task_kind: 'development_plan_item_spec_revision',
          development_plan_item_id: item.id,
          development_plan_item_revision_id: item.revision_id,
          boundary_summary_revision_id: boundaryRevision.id,
          requested_by_actor_id: actorId,
        },
      );
      await repository.saveContextManifest(contextManifest);
      const actionInput = this.specGenerationActionInput({
        plan,
        item,
        workItem,
        boundaryRevision,
        brainstormingSession,
        contextManifest,
        actorId,
      });
      const precondition = actionInput.precondition_fingerprint_json;
      const repoIds = await this.productGenerationRepoIds(repository, plan.project_id);
      const automationScope = this.productGenerationAutomationScope(plan.project_id, repoIds);
      return this.productRuntimeScheduler.schedule({
        repository,
        action_run: {
          id: this.id('automation-action-run'),
          action_type: 'generate_development_plan_item_spec_revision',
          target_object_type: 'development_plan_item',
          target_object_id: item.id,
          target_revision_id: item.revision_id,
          target_status: item.spec_status,
          idempotency_key: `development-plan-item-spec-generation:${item.id}:${item.revision_id}:${boundaryRevision.id}:${actorId}`,
          automation_scope: automationScope,
          automation_settings_version: 1,
          capability_fingerprint: 'development-plan-item-spec-runtime:v1',
          precondition_fingerprint: codexCanonicalDigest(precondition),
          action_input_json: actionInput,
          created_by: actorId,
          now: this.now(),
        },
        task_kind: 'development_plan_item_spec_revision',
        prompt_version: 'development-plan-item-spec-revision:v1',
        output_schema_version: 'spec_revision.v1',
        context_manifest: contextManifest,
        signed_context_json: this.productGenerationSignedContext({
          task_kind: 'development_plan_item_spec_revision',
          plan,
          item,
          workItem,
          boundary,
          boundaryRevision,
          brainstormingSession,
          contextManifest,
          actorId,
        }),
        project_id: plan.project_id,
        repo_ids: repoIds,
      });
    });
  }

  async generateItemImplementationPlanRevisionRuntime(
    developmentPlanId: string,
    itemId: string,
    dto: SubmitForApprovalCommandDto,
  ): Promise<ProductGenerationScheduleResult> {
    return this.withPlanItemMutation(developmentPlanId, async (repository) => {
      const actorId = this.requireActorId(dto.actor_id);
      const replayed = await this.replayAppliedProductGenerationSchedule(
        repository,
        itemId,
        'item_implementation_plan_runtime_draft_generated',
        'generate_development_plan_item_implementation_plan_revision',
        actorId,
      );
      if (replayed !== undefined) {
        return replayed;
      }
      const { plan, item, workItem, boundary, boundaryRevision, brainstormingSession } =
        await this.requireApprovedBoundaryRevision(developmentPlanId, itemId, repository, { requireCurrentItemRevision: false });
      if ((await this.findItemExecutionPlan(item.id, repository)) !== undefined) {
        throw new ConflictException(`Development Plan Item ${item.id} already has an Implementation Plan Doc`);
      }
      const { spec, specRevision } = await this.requireApprovedItemSpec(item, repository);
      this.assertApprovedSpecMatchesBoundary(item.id, spec, specRevision, boundary);
      await this.requireCurrentItemRevisionAtApprovedSpecGate(item, repository);
      const contextManifest = this.stableProductGenerationContextManifest(
        await this.buildItemContextManifest(
          {
            plan,
            item,
            workItem,
            boundary,
            brainstormingSession,
            actorGuidance: actorId,
            approvedSpecRevisionId: specRevision.id,
          },
          repository,
        ),
        {
          task_kind: 'development_plan_item_execution_plan_revision',
          development_plan_item_id: item.id,
          development_plan_item_revision_id: item.revision_id,
          boundary_summary_revision_id: boundaryRevision.id,
          approved_spec_revision_id: specRevision.id,
          requested_by_actor_id: actorId,
        },
      );
      await repository.saveContextManifest(contextManifest);
      const actionInput = this.implementationPlanGenerationActionInput({
        plan,
        item,
        workItem,
        boundaryRevision,
        brainstormingSession,
        specRevision,
        contextManifest,
        actorId,
      });
      const precondition = actionInput.precondition_fingerprint_json;
      const repoIds = await this.productGenerationRepoIds(repository, plan.project_id);
      const automationScope = this.productGenerationAutomationScope(plan.project_id, repoIds);
      return this.productRuntimeScheduler.schedule({
        repository,
        action_run: {
          id: this.id('automation-action-run'),
          action_type: 'generate_development_plan_item_implementation_plan_revision',
          target_object_type: 'development_plan_item',
          target_object_id: item.id,
          target_revision_id: item.revision_id,
          target_status: item.implementation_plan_status,
          idempotency_key: `development-plan-item-execution-plan-generation:${item.id}:${item.revision_id}:${boundaryRevision.id}:${specRevision.id}:${actorId}`,
          automation_scope: automationScope,
          automation_settings_version: 1,
          capability_fingerprint: 'development-plan-item-execution-plan-runtime:v1',
          precondition_fingerprint: codexCanonicalDigest(precondition),
          action_input_json: actionInput,
          now: this.now(),
          created_by: actorId,
        },
        task_kind: 'development_plan_item_execution_plan_revision',
        prompt_version: 'development-plan-item-execution-plan-revision:v1',
        output_schema_version: 'execution_plan_revision.v1',
        context_manifest: contextManifest,
        signed_context_json: this.productGenerationSignedContext({
          task_kind: 'development_plan_item_execution_plan_revision',
          plan,
          item,
          workItem,
          boundary,
          boundaryRevision,
          brainstormingSession,
          specRevision,
          contextManifest,
          actorId,
        }),
        project_id: plan.project_id,
        repo_ids: repoIds,
      });
    });
  }

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
        { requireCurrentItemRevision: false },
      );
      const spec = await this.requireItemSpec(item.id, repository);
      if (spec.status === 'approved') {
        throw new ConflictException(`Approved Spec ${spec.id} cannot be regenerated`);
      }
      await this.requireSpecCurrentRevisionMatchesBoundary(item.id, spec, boundary, repository);
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

  async saveItemSpecDraft(
    developmentPlanId: string,
    itemId: string,
    document: MarkdownDocument,
  ): Promise<PublicSpecRevision> {
    return this.withPlanItemMutation(developmentPlanId, async (repository) => {
      const { plan, item, workItem } = await this.requirePlanItem(developmentPlanId, itemId, repository);
      const actorId = item.driver_actor_id ?? workItem.driver_actor_id;
      const spec = await this.requireItemSpec(item.id, repository);
      const currentRevision = await this.requireItemSpecRevision(item.id, this.requireCurrentRevision(spec), repository);
      this.requireDocumentObjectRef(document, 'spec_revision', currentRevision.id);
      const validatedDocument = await this.markdownDocuments.validateForWrite(document);
      const draftDocument = {
        ...validatedDocument,
        attachment_refs: await this.attachmentRefsForDraftSave(document, validatedDocument),
      };
      const nextSpec = {
        ...spec,
        status: 'draft' as const,
        editing_state: 'idle' as const,
        gate_state: 'not_submitted' as const,
        resolution: 'none' as const,
        updated_at: this.now(),
      };
      await repository.saveSpec(nextSpec);
      const draftSpecFields = specStructuredFieldsFromMarkdown(draftDocument.markdown);
      const revision = await this.saveSpecRevisionWithRepository(repository, nextSpec, {
        ...currentRevision,
        ...draftSpecFields,
        content: draftDocument.markdown,
        structured_document: {
          ...(currentRevision.structured_document ?? {}),
          markdown_document: draftDocument,
        },
      });
      const updatedSpec = { ...nextSpec, current_revision_id: revision.id, updated_at: this.now() };
      await repository.saveSpec(updatedSpec);
      await repository.saveWorkItem({
        ...workItem,
        current_spec_id: spec.id,
        current_spec_revision_id: revision.id,
        updated_at: updatedSpec.updated_at,
      });
      await this.linkMarkdownAttachmentsToRevision(repository, draftDocument.attachment_refs, {
        type: 'spec_revision',
        id: revision.id,
        spec_id: spec.id,
      });
      await this.updateDevelopmentPlanItemArtifactStatus(
        repository,
        plan,
        item,
        'spec_status',
        'draft',
        'spec_draft_saved',
        actorId,
      );
      await this.eventWithRepository(repository, 'spec_revision', revision.id, 'spec_draft_saved', actorId, {
        spec_id: spec.id,
        previous_revision_id: currentRevision.id,
      });
      return this.toPublicSpecRevision(revision, repository);
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
    return this.revisionDiff(query, this.publicSpecRevisionSnapshot(base), this.publicSpecRevisionSnapshot(compare));
  }

  async writeGeneratedItemSpecRevision(input: {
    actionRun: AutomationActionRun;
    generated: GeneratedSpecRevisionV1;
    runtime_job_id: string;
  }): Promise<ProductGenerationApplyResult<SpecRevision>> {
    const precondition = this.productGenerationPrecondition(input.actionRun);
    if (
      precondition === undefined ||
      input.actionRun.action_type !== 'generate_development_plan_item_spec_revision' ||
      input.actionRun.target_object_type !== 'development_plan_item' ||
      input.actionRun.precondition_fingerprint !== codexCanonicalDigest(precondition)
    ) {
      return { applied: false, reason: 'invalid_precondition' };
    }
    return this.withPlanItemMutation(String(precondition.development_plan_id), async (repository) => {
      const prior = await this.appliedGeneratedRevisionForAction<SpecRevision>(
        repository,
        input.actionRun.id,
        input.runtime_job_id,
        'spec_revision',
      );
      if (prior !== undefined) {
        return { applied: true, revision: prior };
      }
      const loaded = await this.loadGenerationPrecondition(precondition, repository);
      if (
        loaded === undefined ||
        !(await this.specGenerationPreconditionStillCurrent(input.actionRun, precondition, loaded, repository)) ||
        input.generated.development_plan_item_id !== loaded.item.id ||
        input.generated.boundary_summary_revision_id !== loaded.boundaryRevision.id
      ) {
        return { applied: false, reason: 'stale_precondition_fingerprint' };
      }

      const qaOwnerActorId = loaded.item.reviewer_actor_id ?? loaded.item.driver_actor_id ?? loaded.workItem.driver_actor_id;
      const spec = {
        ...(transitionSpecPlan(undefined, {
          type: 'create',
          entity_type: 'spec',
          id: this.id('spec'),
          work_item_id: loaded.workItem.id,
          at: this.now(),
        }) as Spec),
        development_plan_item_id: loaded.item.id,
        boundary_summary_id: loaded.boundary.id,
        context_manifest_id: loaded.contextManifest.id,
      };
      await repository.saveSpec(spec);
      const revision = await this.saveSpecRevisionWithRepository(repository, spec, {
        development_plan_item_id: loaded.item.id,
        boundary_summary_id: loaded.boundary.id,
        context_manifest_id: loaded.contextManifest.id,
        summary: input.generated.summary,
        content: input.generated.content_markdown,
        background: input.generated.problem_context,
        goals: [input.generated.summary],
        scope_in: input.generated.scope_in,
        scope_out: input.generated.scope_out,
        acceptance_criteria: input.generated.acceptance_criteria,
        risk_notes: input.generated.risks,
        test_strategy_summary: input.generated.test_strategy.join('\n'),
        ...(qaOwnerActorId === undefined ? {} : { qa_owner_actor_id: qaOwnerActorId }),
        testability_note: `QA/Test Owner must validate ${loaded.item.title} against acceptance criteria before execution planning.`,
        structured_document: {
          generated_by: 'codex_runtime_development_plan_item_spec_revision',
          runtime_job_id: input.runtime_job_id,
          action_run_id: input.actionRun.id,
          public_summary: input.generated.public_summary,
          assumptions: input.generated.assumptions,
          unresolved_questions: input.generated.unresolved_questions,
          boundary_summary_revision_id: loaded.boundaryRevision.id,
          context_manifest_revision_id: loaded.contextManifest.revision_id,
        },
        author_actor_id: String(precondition.requested_by_actor_id),
      });
      await repository.saveSpec({ ...spec, current_revision_id: revision.id, updated_at: this.now() });
      await repository.saveWorkItem({
        ...loaded.workItem,
        current_spec_id: spec.id,
        current_spec_revision_id: revision.id,
        updated_at: this.now(),
      });
      await this.updateDevelopmentPlanItemArtifactStatus(
        repository,
        loaded.plan,
        loaded.item,
        'spec_status',
        'draft',
        'spec_runtime_generation_applied',
        String(precondition.requested_by_actor_id),
      );
      await this.eventWithRepository(repository, 'development_plan_item', loaded.item.id, 'item_spec_runtime_draft_generated', String(precondition.requested_by_actor_id), {
        spec_id: spec.id,
        spec_revision_id: revision.id,
        context_manifest_id: loaded.contextManifest.id,
        runtime_job_id: input.runtime_job_id,
        action_run_id: input.actionRun.id,
      });
      await this.eventWithRepository(repository, 'automation_action_run', input.actionRun.id, 'product_generation_result_applied', String(precondition.requested_by_actor_id), {
        runtime_job_id: input.runtime_job_id,
        generated_object_type: 'spec_revision',
        generated_revision_id: revision.id,
      });
      return { applied: true, revision };
    });
  }

  async generateItemImplementationPlanDraft(
    developmentPlanId: string,
    itemId: string,
    dto: SubmitForApprovalCommandDto,
  ): Promise<PublicImplementationPlanRevision> {
    return this.withPlanItemMutation(developmentPlanId, async (repository) => {
      const { plan, item, workItem, boundary, brainstormingSession } = await this.requireApprovedBoundary(
        developmentPlanId,
        itemId,
        repository,
        { requireCurrentItemRevision: false },
      );
      if ((await this.findItemExecutionPlan(item.id, repository)) !== undefined) {
        throw new ConflictException(`Development Plan Item ${item.id} already has an Implementation Plan Doc`);
      }
      const { spec, specRevision } = await this.requireApprovedItemSpec(item, repository);
      this.assertApprovedSpecMatchesBoundary(item.id, spec, specRevision, boundary);
      await this.requireCurrentItemRevisionAtApprovedSpecGate(item, repository);
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
        this.itemImplementationPlanDraftInput(workItem, item, specRevision, contextManifest, dto.actor_id),
      );
      await repository.saveExecutionPlan({ ...executionPlan, current_revision_id: revision.id, updated_at: this.now() });
      await this.updateDevelopmentPlanItemArtifactStatus(
        repository,
        plan,
        item,
        'implementation_plan_status',
        'draft',
        'implementation_plan_draft_generated',
        dto.actor_id,
      );
      await this.eventWithRepository(
        repository,
        'development_plan_item',
        item.id,
        'item_implementation_plan_draft_generated',
        dto.actor_id,
        {
          implementation_plan_id: executionPlan.id,
          implementation_plan_revision_id: revision.id,
          context_manifest_id: contextManifest.id,
        },
      );
      return this.toPublicImplementationPlanRevision(revision, repository);
    });
  }

  async regenerateItemImplementationPlanDraft(
    developmentPlanId: string,
    itemId: string,
    dto: RegenerateArtifactDraftCommandDto,
  ): Promise<PublicImplementationPlanRevision> {
    return this.withPlanItemMutation(developmentPlanId, async (repository) => {
      const { plan, item, workItem, boundary, brainstormingSession } = await this.requireApprovedBoundary(
        developmentPlanId,
        itemId,
        repository,
        { requireCurrentItemRevision: false },
      );
      const executionPlan = await this.requireItemExecutionPlan(item.id, repository);
      if (executionPlan.status === 'approved') {
        throw new ConflictException(`Approved Implementation Plan Doc ${executionPlan.id} cannot be regenerated`);
      }
      const { spec, specRevision } = await this.requireApprovedItemSpec(item, repository);
      this.assertApprovedSpecMatchesBoundary(item.id, spec, specRevision, boundary);
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
        this.itemImplementationPlanDraftInput(workItem, item, specRevision, contextManifest, dto.actor_id, dto.feedback),
      );
      await repository.saveExecutionPlan({ ...draftPlan, current_revision_id: revision.id, updated_at: this.now() });
      await this.updateDevelopmentPlanItemArtifactStatus(
        repository,
        plan,
        item,
        'implementation_plan_status',
        'draft',
        'implementation_plan_draft_regenerated',
        dto.actor_id,
      );
      await this.eventWithRepository(
        repository,
        'development_plan_item',
        item.id,
        'item_implementation_plan_draft_regenerated',
        dto.actor_id,
        {
          implementation_plan_id: executionPlan.id,
          implementation_plan_revision_id: revision.id,
          context_manifest_id: contextManifest.id,
          feedback: dto.feedback,
          preserve_prior_decisions: dto.preserve_prior_decisions,
        },
      );
      return this.toPublicImplementationPlanRevision(revision, repository);
    });
  }

  async saveItemImplementationPlanDraft(
    developmentPlanId: string,
    itemId: string,
    document: MarkdownDocument,
  ): Promise<PublicImplementationPlanRevision> {
    return this.withPlanItemMutation(developmentPlanId, async (repository) => {
      const { plan, item, workItem } = await this.requirePlanItem(developmentPlanId, itemId, repository);
      const actorId = item.driver_actor_id ?? workItem.driver_actor_id;
      const executionPlan = await this.requireItemExecutionPlan(item.id, repository);
      const currentRevision = await this.requireItemExecutionPlanRevision(
        item.id,
        this.requireExecutionPlanCurrentRevision(executionPlan),
        repository,
      );
      this.requireDocumentObjectRef(document, 'implementation_plan_revision', currentRevision.id);
      const validatedDocument = await this.markdownDocuments.validateForWrite(document);
      const draftDocument = {
        ...validatedDocument,
        attachment_refs: await this.attachmentRefsForDraftSave(document, validatedDocument),
      };
      const draftPlan: ExecutionPlanDocument = {
        ...executionPlan,
        status: 'draft',
        updated_at: this.now(),
      };
      await repository.saveExecutionPlan(draftPlan);
      const revision = await this.saveExecutionPlanRevisionWithRepository(repository, draftPlan, {
        ...currentRevision,
        summary: summaryFromMarkdown(draftDocument.markdown, currentRevision.summary),
        content: draftDocument.markdown,
        structured_document: {
          ...(currentRevision.structured_document ?? {}),
          markdown_document: draftDocument,
        },
      });
      const updatedPlan = { ...draftPlan, current_revision_id: revision.id, updated_at: this.now() };
      await repository.saveExecutionPlan(updatedPlan);
      await this.linkMarkdownAttachmentsToRevision(repository, draftDocument.attachment_refs, {
        type: 'implementation_plan_revision',
        id: revision.id,
        implementation_plan_id: executionPlan.id,
      });
      await this.updateDevelopmentPlanItemArtifactStatus(
        repository,
        plan,
        item,
        'implementation_plan_status',
        'draft',
        'implementation_plan_draft_saved',
        actorId,
      );
      await this.eventWithRepository(
        repository,
        'implementation_plan_revision',
        revision.id,
        'implementation_plan_draft_saved',
        actorId,
        {
          implementation_plan_id: executionPlan.id,
          previous_revision_id: currentRevision.id,
        },
      );
      return this.toPublicImplementationPlanRevision(revision, repository);
    });
  }

  async submitItemImplementationPlanForApproval(
    developmentPlanId: string,
    itemId: string,
    dto: SubmitForApprovalCommandDto,
  ): Promise<ExecutionPlanDocument> {
    return this.withPlanItemMutation(developmentPlanId, async (repository) => {
      const { plan, item } = await this.requirePlanItem(developmentPlanId, itemId, repository);
      await this.requireApprovedItemSpec(item, repository);
      const executionPlan = await this.requireItemExecutionPlan(item.id, repository);
      const revisionId = this.requireExecutionPlanCurrentRevision(executionPlan);
      await this.requireRevisionNotRejected(revisionId, 'implementation_plan_revision', repository);
      if (executionPlan.status !== 'draft' && executionPlan.status !== 'changes_requested') {
        throw new BadRequestException(`Implementation Plan Doc ${executionPlan.id} cannot be submitted from ${executionPlan.status}`);
      }
      const updated: ExecutionPlanDocument = { ...executionPlan, status: 'in_review', updated_at: this.now() };
      await repository.saveExecutionPlan(updated);
      await this.updateDevelopmentPlanItemArtifactStatus(
        repository,
        plan,
        item,
        'implementation_plan_status',
        'in_review',
        'implementation_plan_submitted_for_approval',
        dto.actor_id,
      );
      await this.historyWithRepository(repository, 'implementation_plan_doc', executionPlan.id, executionPlan.status, updated.status, dto.actor_id);
      return updated;
    });
  }

  async approveItemImplementationPlan(
    developmentPlanId: string,
    itemId: string,
    dto: ApproveArtifactCommandDto,
  ): Promise<ExecutionPlanDocument> {
    return this.withPlanItemMutation(developmentPlanId, async (repository) => {
      const { plan, item, workItem } = await this.requirePlanItem(developmentPlanId, itemId, repository);
      const { spec, specRevision } = await this.requireApprovedItemSpec(item, repository);
      const executionPlan = await this.requireItemExecutionPlan(item.id, repository);
      if (executionPlan.status !== 'in_review') {
        throw new BadRequestException(`Implementation Plan Doc ${executionPlan.id} is not awaiting approval`);
      }
      const currentRevisionId = this.requireExecutionPlanCurrentRevision(executionPlan);
      const currentRevision = await this.requireItemExecutionPlanRevision(item.id, currentRevisionId, repository);
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
        'implementation_plan_status',
        'approved',
        'implementation_plan_approved',
        reviewerActorId,
      );
      await this.historyWithRepository(repository, 'implementation_plan_doc', executionPlan.id, executionPlan.status, updated.status, reviewerActorId);
      await this.decisionWithRepository(
        repository,
        'implementation_plan_doc',
        executionPlan.id,
        reviewerActorId,
        'approved',
        dto.rationale ?? 'Implementation Plan Doc approved.',
      );
      const project = this.requireFound(await repository.getProject(plan.project_id), `Project ${plan.project_id}`);
      await this.executionPackages.createOrReuseItemExecutionPackage(repository, {
        project,
        workItem,
        item,
        spec,
        specRevision,
        executionPlan: updated,
        executionPlanRevision: currentRevision,
        ownerActorId: item.driver_actor_id ?? workItem.driver_actor_id,
      });
      return updated;
    });
  }

  async requestItemImplementationPlanChanges(
    developmentPlanId: string,
    itemId: string,
    dto: RequestArtifactChangesCommandDto,
  ): Promise<ExecutionPlanDocument> {
    return this.withPlanItemMutation(developmentPlanId, async (repository) => {
      const { plan, item } = await this.requirePlanItem(developmentPlanId, itemId, repository);
      const executionPlan = await this.requireItemExecutionPlan(item.id, repository);
      if (executionPlan.status !== 'in_review') {
        throw new BadRequestException(`Implementation Plan Doc ${executionPlan.id} is not awaiting approval`);
      }
      const updated: ExecutionPlanDocument = { ...executionPlan, status: 'changes_requested', updated_at: this.now() };
      await repository.saveExecutionPlan(updated);
      await this.updateDevelopmentPlanItemArtifactStatus(
        repository,
        plan,
        item,
        'implementation_plan_status',
        'changes_requested',
        'implementation_plan_changes_requested',
        dto.actor_id,
      );
      await this.historyWithRepository(repository, 'implementation_plan_doc', executionPlan.id, executionPlan.status, updated.status, dto.actor_id);
      await this.decisionWithRepository(repository, 'implementation_plan_doc', executionPlan.id, dto.actor_id, 'changes_requested', dto.rationale);
      return updated;
    });
  }

  async rejectItemImplementationPlan(
    developmentPlanId: string,
    itemId: string,
    dto: RejectArtifactCommandDto,
  ): Promise<ExecutionPlanDocument> {
    return this.withPlanItemMutation(developmentPlanId, async (repository) => {
      const { plan, item } = await this.requirePlanItem(developmentPlanId, itemId, repository);
      const executionPlan = await this.requireItemExecutionPlan(item.id, repository);
      if (executionPlan.status !== 'in_review') {
        throw new BadRequestException(`Implementation Plan Doc ${executionPlan.id} is not awaiting approval`);
      }
      const revisionId = this.requireExecutionPlanCurrentRevision(executionPlan);
      const updated: ExecutionPlanDocument = { ...executionPlan, status: 'changes_requested', updated_at: this.now() };
      await repository.saveExecutionPlan(updated);
      await this.updateDevelopmentPlanItemArtifactStatus(
        repository,
        plan,
        item,
        'implementation_plan_status',
        'changes_requested',
        'implementation_plan_rejected',
        dto.actor_id,
      );
      await this.eventWithRepository(
        repository,
        'implementation_plan_revision',
        revisionId,
        'implementation_plan_revision_rejected',
        dto.actor_id,
        {
          implementation_plan_id: executionPlan.id,
          rationale: dto.rationale,
        },
      );
      await this.historyWithRepository(repository, 'implementation_plan_doc', executionPlan.id, executionPlan.status, updated.status, dto.actor_id);
      await this.decisionWithRepository(repository, 'implementation_plan_doc', executionPlan.id, dto.actor_id, 'changes_requested', dto.rationale);
      return updated;
    });
  }

  async compareItemImplementationPlanRevisions(
    developmentPlanId: string,
    itemId: string,
    query: RevisionCompareQueryDto,
  ): Promise<Record<string, unknown>> {
    await this.requirePlanItem(developmentPlanId, itemId);
    const base = await this.requireItemExecutionPlanRevision(itemId, query.base_revision_id);
    const compare = await this.requireItemExecutionPlanRevision(itemId, query.compare_revision_id);
    return this.revisionDiff(query, this.publicImplementationPlanRevisionSnapshot(base), this.publicImplementationPlanRevisionSnapshot(compare));
  }

  async writeGeneratedItemImplementationPlanRevision(input: {
    actionRun: AutomationActionRun;
    generated: GeneratedExecutionPlanRevisionV1;
    runtime_job_id: string;
  }): Promise<ProductGenerationApplyResult<ExecutionPlanRevision>> {
    const precondition = this.productGenerationPrecondition(input.actionRun);
    if (
      precondition === undefined ||
      input.actionRun.action_type !== 'generate_development_plan_item_implementation_plan_revision' ||
      input.actionRun.target_object_type !== 'development_plan_item' ||
      input.actionRun.precondition_fingerprint !== codexCanonicalDigest(precondition)
    ) {
      return { applied: false, reason: 'invalid_precondition' };
    }
    return this.withPlanItemMutation(String(precondition.development_plan_id), async (repository) => {
      const prior = await this.appliedGeneratedRevisionForAction<ExecutionPlanRevision>(
        repository,
        input.actionRun.id,
        input.runtime_job_id,
        'implementation_plan_revision',
      );
      if (prior !== undefined) {
        return { applied: true, revision: prior };
      }
      const loaded = await this.loadGenerationPrecondition(precondition, repository);
      const spec = await this.findItemSpec(String(precondition.development_plan_item_id), repository);
      const approvedSpecRevision =
        precondition.approved_spec_revision_id === undefined
          ? undefined
          : await repository.getSpecRevision(String(precondition.approved_spec_revision_id));
      if (
        loaded === undefined ||
        spec === undefined ||
        approvedSpecRevision === undefined ||
        !(await this.executionPlanGenerationPreconditionStillCurrent(input.actionRun, precondition, loaded, spec, approvedSpecRevision, repository)) ||
        input.generated.development_plan_item_id !== loaded.item.id ||
        input.generated.based_on_spec_revision_id !== approvedSpecRevision.id
      ) {
        return { applied: false, reason: 'stale_precondition_fingerprint' };
      }

      const at = this.now();
      const executionPlan: ExecutionPlanDocument = {
        id: this.id('execution-plan'),
        development_plan_item_id: loaded.item.id,
        status: 'draft',
        created_at: at,
        updated_at: at,
      };
      await repository.saveExecutionPlan(executionPlan);
      const revision = await this.saveExecutionPlanRevisionWithRepository(repository, executionPlan, {
        based_on_spec_revision_id: approvedSpecRevision.id,
        summary: input.generated.summary,
        content: input.generated.content_markdown,
        structured_document: {
          generated_by: 'codex_runtime_development_plan_item_execution_plan_revision',
          runtime_job_id: input.runtime_job_id,
          action_run_id: input.actionRun.id,
          public_summary: input.generated.public_summary,
          context_manifest_id: loaded.contextManifest.id,
          context_manifest_revision_id: loaded.contextManifest.revision_id,
          approved_boundary_summary_revision_id: loaded.boundaryRevision.id,
          implementation_sequence: input.generated.implementation_sequence,
          validation_strategy: input.generated.validation_strategy,
          allowed_paths: input.generated.allowed_paths,
          forbidden_paths: input.generated.forbidden_paths,
          required_checks: input.generated.required_checks,
          rollback_notes: input.generated.rollback_notes,
          handoff_criteria: input.generated.handoff_criteria,
        },
        author_actor_id: String(precondition.requested_by_actor_id),
      });
      await repository.saveExecutionPlan({ ...executionPlan, current_revision_id: revision.id, updated_at: this.now() });
      await this.updateDevelopmentPlanItemArtifactStatus(
        repository,
        loaded.plan,
        loaded.item,
        'implementation_plan_status',
        'draft',
        'implementation_plan_runtime_generation_applied',
        String(precondition.requested_by_actor_id),
      );
      await this.eventWithRepository(
        repository,
        'development_plan_item',
        loaded.item.id,
        'item_implementation_plan_runtime_draft_generated',
        String(precondition.requested_by_actor_id),
        {
          implementation_plan_id: executionPlan.id,
          implementation_plan_revision_id: revision.id,
          based_on_spec_revision_id: approvedSpecRevision.id,
          context_manifest_id: loaded.contextManifest.id,
          runtime_job_id: input.runtime_job_id,
          action_run_id: input.actionRun.id,
        },
      );
      await this.eventWithRepository(repository, 'automation_action_run', input.actionRun.id, 'product_generation_result_applied', String(precondition.requested_by_actor_id), {
        runtime_job_id: input.runtime_job_id,
        generated_object_type: 'implementation_plan_revision',
        generated_revision_id: revision.id,
      });
      return { applied: true, revision };
    });
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

  async getExecutionPlanRevision(executionPlanRevisionId: string): Promise<ExecutionPlanRevision> {
    return this.requireFound(
      await this.repository.getExecutionPlanRevision(executionPlanRevisionId),
      `ExecutionPlanRevision ${executionPlanRevisionId}`,
    );
  }

  async getPublicImplementationPlanRevision(executionPlanRevisionId: string): Promise<PublicImplementationPlanRevision> {
    return this.toPublicImplementationPlanRevision(await this.getExecutionPlanRevision(executionPlanRevisionId));
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
    options: { requireCurrentItemRevision: boolean } = { requireCurrentItemRevision: true },
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
    const boundaryRevision =
      boundary === undefined ? undefined : await this.findBoundarySummaryRevision(boundary.revision_id, repository);
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
      ...(boundaryRevision === undefined ? {} : { boundarySummaryRevision: { status: this.boundarySummaryRevisionApproved(boundaryRevision) ? 'approved' : 'stale' } }),
    });
    if (!gate.ok) {
      throw new BadRequestException(`Development Plan Item ${item.id} cannot generate Spec: ${gate.reason}`);
    }
    if (options.requireCurrentItemRevision && !this.boundarySummaryRevisionMatchesItem(boundary!, boundaryRevision!, item)) {
      throw new BadRequestException(`Development Plan Item ${item.id} cannot generate Spec: stale_boundary_summary_revision`);
    }
    return { plan, item, workItem, boundary: boundary!, brainstormingSession: brainstormingSession! };
  }

  private async requireApprovedBoundaryRevision(
    developmentPlanId: string,
    itemId: string,
    repository: DeliveryRepository,
    options: { requireCurrentItemRevision: boolean } = { requireCurrentItemRevision: true },
  ): Promise<{
    plan: DevelopmentPlan;
    item: DevelopmentPlanItem;
    workItem: WorkItem;
    boundary: BoundarySummary;
    boundaryRevision: BoundarySummaryRevision;
    brainstormingSession: BrainstormingSession;
  }> {
    const approved = await this.requireApprovedBoundary(developmentPlanId, itemId, repository, {
      requireCurrentItemRevision: options.requireCurrentItemRevision,
    });
    const boundaryRevision = await this.findBoundarySummaryRevision(approved.boundary.revision_id, repository);
    if (boundaryRevision === undefined || !this.boundarySummaryRevisionApproved(boundaryRevision)) {
      throw new BadRequestException(`Development Plan Item ${itemId} cannot generate Spec: boundary_summary_missing_approval`);
    }
    if (options.requireCurrentItemRevision && !this.boundarySummaryRevisionMatchesItem(approved.boundary, boundaryRevision, approved.item)) {
      throw new BadRequestException(`Development Plan Item ${itemId} cannot generate Spec: stale_boundary_summary_revision`);
    }
    const [questions, answers, decisions] = await Promise.all([
      repository.listBoundaryQuestions(approved.brainstormingSession.id),
      repository.listBoundaryAnswers(approved.brainstormingSession.id),
      repository.listBoundaryDecisions(approved.brainstormingSession.id),
    ]);
    if (!requiredBoundaryQuestionsClosed({ questions, answers, decisions })) {
      throw new BadRequestException(`Development Plan Item ${itemId} cannot generate Spec: boundary_questions_open`);
    }
    return { ...approved, boundaryRevision };
  }

  private async findBoundarySummaryRevision(
    boundarySummaryRevisionId: string,
    repository: DeliveryRepository,
  ): Promise<BoundarySummaryRevision | undefined> {
    for (const summary of await repository.listBoundarySummaries()) {
      const revision = (await repository.listBoundarySummaryRevisions(summary.id)).find((candidate) => candidate.id === boundarySummaryRevisionId);
      if (revision !== undefined) {
        return revision;
      }
    }
    return undefined;
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

  private boundarySummaryRevisionMatchesItem(
    boundary: BoundarySummary,
    revision: BoundarySummaryRevision,
    item: DevelopmentPlanItem,
  ): boolean {
    return (
      boundary.development_plan_item_id === item.id &&
      boundary.development_plan_item_revision_id === item.revision_id &&
      revision.development_plan_item_id === item.id &&
      revision.development_plan_item_revision_id === item.revision_id
    );
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
    item: DevelopmentPlanItem,
    repository: DeliveryRepository,
  ): Promise<{ spec: Spec; specRevision: SpecRevision }> {
    const itemId = item.id;
    const spec = await this.findItemSpec(itemId, repository);
    if (spec === undefined) {
      throw new BadRequestException(`Development Plan Item ${itemId} cannot generate Implementation Plan Doc: spec_not_approved`);
    }
    const approvedRevisionId = spec.approved_revision_id;
    const specRevision = approvedRevisionId === undefined ? undefined : await repository.getSpecRevision(approvedRevisionId);
    const gate = canGenerateExecutionPlanFromApprovedSpec({
      item,
      spec,
      ...(specRevision === undefined ? {} : { specRevision }),
    });
    if (!gate.ok || spec.current_revision_id !== approvedRevisionId) {
      throw new BadRequestException(`Development Plan Item ${itemId} cannot generate Implementation Plan Doc: ${gate.ok ? 'approved_spec_not_current' : gate.reason}`);
    }
    return { spec, specRevision: specRevision! };
  }

  private assertApprovedSpecMatchesBoundary(
    itemId: string,
    spec: Spec,
    specRevision: SpecRevision,
    boundary: BoundarySummary,
  ): void {
    if (
      spec.development_plan_item_id !== itemId ||
      spec.status !== 'approved' ||
      spec.current_revision_id !== specRevision.id ||
      spec.approved_revision_id !== specRevision.id ||
      specRevision.development_plan_item_id !== itemId ||
      specRevision.boundary_summary_id !== boundary.id ||
      this.revisionStructuredBoundarySummaryRevisionId(specRevision) !== boundary.revision_id
    ) {
      throw new BadRequestException(`Development Plan Item ${itemId} cannot generate Implementation Plan Doc: stale_boundary_summary_revision`);
    }
  }

  private async requireCurrentItemRevisionAtApprovedSpecGate(
    item: DevelopmentPlanItem,
    repository: DeliveryRepository,
  ): Promise<void> {
    if (!(await this.currentItemRevisionAtApprovedSpecGate(item, repository))) {
      throw new BadRequestException(
        `Development Plan Item ${item.id} cannot generate Implementation Plan Doc: approved_spec_not_current_item_revision`,
      );
    }
  }

  private async currentItemRevisionAtApprovedSpecGate(
    item: DevelopmentPlanItem,
    repository: DeliveryRepository,
  ): Promise<boolean> {
    const currentRevision = (await repository.listDevelopmentPlanItemRevisions(item.id)).find(
      (revision) => revision.id === item.revision_id,
    );
    return (
      currentRevision?.change_reason === 'spec_approved' &&
      currentRevision.snapshot.spec_status === 'approved' &&
      currentRevision.snapshot.implementation_plan_status === 'missing' &&
      currentRevision.snapshot.next_action === 'generate_implementation_plan'
    );
  }

  private async requireSpecCurrentRevisionMatchesBoundary(
    itemId: string,
    spec: Spec,
    boundary: BoundarySummary,
    repository: DeliveryRepository,
  ): Promise<SpecRevision> {
    const currentRevisionId = this.requireCurrentRevision(spec);
    const currentRevision = await repository.getSpecRevision(currentRevisionId);
    if (
      currentRevision === undefined ||
      spec.development_plan_item_id !== itemId ||
      currentRevision.development_plan_item_id !== itemId ||
      currentRevision.boundary_summary_id !== boundary.id ||
      this.revisionStructuredBoundarySummaryRevisionId(currentRevision) !== boundary.revision_id
    ) {
      throw new BadRequestException(`Development Plan Item ${itemId} cannot regenerate Spec: stale_boundary_summary_revision`);
    }
    return currentRevision;
  }

  private async findItemExecutionPlan(
    itemId: string,
    repository: DeliveryRepository,
  ): Promise<ExecutionPlanDocument | undefined> {
    const events = await repository.listObjectEvents(itemId, 'development_plan_item');
    const executionPlanId = events
      .slice()
      .reverse()
      .map((event) => event.metadata.implementation_plan_id)
      .find((value): value is string => typeof value === 'string' && value.trim().length > 0);
    return executionPlanId === undefined ? undefined : repository.getExecutionPlan(executionPlanId);
  }

  private async requireItemExecutionPlan(itemId: string, repository: DeliveryRepository): Promise<ExecutionPlanDocument> {
    const executionPlan = await this.findItemExecutionPlan(itemId, repository);
    if (executionPlan === undefined) {
      throw new NotFoundException(`Development Plan Item ${itemId} has no Implementation Plan Doc`);
    }
    return executionPlan;
  }

  private specGenerationActionInput(input: {
    plan: DevelopmentPlan;
    item: DevelopmentPlanItem;
    workItem: WorkItem;
    boundaryRevision: BoundarySummaryRevision;
    brainstormingSession: BrainstormingSession;
    contextManifest: ContextManifest;
    actorId: string;
  }) {
    const precondition = {
      source_ref: input.item.source_ref,
      source_revision_id: input.workItem.updated_at,
      development_plan_id: input.plan.id,
      development_plan_revision_id: input.plan.revision_id,
      development_plan_item_id: input.item.id,
      development_plan_item_revision_id: input.item.revision_id,
      boundary_session_id: input.brainstormingSession.id,
      boundary_session_revision_id: input.brainstormingSession.revision_id,
      approved_boundary_summary_revision_id: input.boundaryRevision.id,
      context_manifest_id: input.contextManifest.id,
      context_manifest_revision_id: input.contextManifest.revision_id,
      requested_by_actor_id: input.actorId,
    };
    return {
      development_plan_id: input.plan.id,
      development_plan_revision_id: input.plan.revision_id,
      development_plan_item_id: input.item.id,
      development_plan_item_revision_id: input.item.revision_id,
      boundary_session_id: input.brainstormingSession.id,
      boundary_session_revision_id: input.brainstormingSession.revision_id,
      approved_boundary_summary_revision_id: input.boundaryRevision.id,
      context_manifest_id: input.contextManifest.id,
      context_manifest_revision_id: input.contextManifest.revision_id,
      requested_by_actor_id: input.actorId,
      precondition_fingerprint_json: precondition,
    };
  }

  private implementationPlanGenerationActionInput(input: {
    plan: DevelopmentPlan;
    item: DevelopmentPlanItem;
    workItem: WorkItem;
    boundaryRevision: BoundarySummaryRevision;
    brainstormingSession: BrainstormingSession;
    specRevision: SpecRevision;
    contextManifest: ContextManifest;
    actorId: string;
  }) {
    const precondition = {
      source_ref: input.item.source_ref,
      source_revision_id: input.workItem.updated_at,
      development_plan_id: input.plan.id,
      development_plan_revision_id: input.plan.revision_id,
      development_plan_item_id: input.item.id,
      development_plan_item_revision_id: input.item.revision_id,
      boundary_session_id: input.brainstormingSession.id,
      boundary_session_revision_id: input.brainstormingSession.revision_id,
      approved_boundary_summary_revision_id: input.boundaryRevision.id,
      approved_spec_revision_id: input.specRevision.id,
      context_manifest_id: input.contextManifest.id,
      context_manifest_revision_id: input.contextManifest.revision_id,
      requested_by_actor_id: input.actorId,
    };
    return {
      development_plan_id: input.plan.id,
      development_plan_revision_id: input.plan.revision_id,
      development_plan_item_id: input.item.id,
      development_plan_item_revision_id: input.item.revision_id,
      boundary_session_id: input.brainstormingSession.id,
      boundary_session_revision_id: input.brainstormingSession.revision_id,
      approved_boundary_summary_revision_id: input.boundaryRevision.id,
      approved_spec_revision_id: input.specRevision.id,
      context_manifest_id: input.contextManifest.id,
      context_manifest_revision_id: input.contextManifest.revision_id,
      requested_by_actor_id: input.actorId,
      precondition_fingerprint_json: precondition,
    };
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
    const projectRepos = (await repository.listProjectRepos(input.plan.project_id)).sort((left, right) =>
      left.repo_id < right.repo_id ? -1 : left.repo_id > right.repo_id ? 1 : 0,
    );
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
        { type: 'planning_input_revision', ref: `${input.workItem.kind}:${input.workItem.id}`, digest: input.workItem.updated_at },
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

  private stableProductGenerationContextManifest(
    contextManifest: ContextManifest,
    identity: Record<string, unknown>,
  ): ContextManifest {
    const generatedAt = contextManifest.boundary_approved_at ?? contextManifest.generated_at;
    return {
      ...contextManifest,
      id: this.stableUuid({ kind: 'product_generation_context_manifest', ...identity }),
      revision_id: this.stableUuid({ kind: 'product_generation_context_manifest_revision', ...identity }),
      generated_at: generatedAt,
      created_at: generatedAt,
      updated_at: generatedAt,
    };
  }

  private productGenerationSignedContext(input: {
    task_kind: 'development_plan_item_spec_revision' | 'development_plan_item_execution_plan_revision';
    plan: DevelopmentPlan;
    item: DevelopmentPlanItem;
    workItem: WorkItem;
    boundary: BoundarySummary;
    boundaryRevision: BoundarySummaryRevision;
    brainstormingSession: BrainstormingSession;
    specRevision?: SpecRevision | undefined;
    contextManifest: ContextManifest;
    actorId: string;
  }): Record<string, unknown> {
    return {
      schema_version: `${input.task_kind}.context.v1`,
      task_kind: input.task_kind,
      development_plan: {
        id: input.plan.id,
        revision_id: input.plan.revision_id,
        title: this.runtimeSafeText(input.plan.title),
      },
      development_plan_item: {
        id: input.item.id,
        revision_id: input.item.revision_id,
        title: this.runtimeSafeText(input.item.title),
        summary: this.runtimeSafeText(input.item.summary),
        affected_surface_refs: this.publicSafeRefs('affected-surface', input.item.affected_surfaces),
        affected_surfaces_digest: codexCanonicalDigest(input.item.affected_surfaces),
      },
      planning_input: {
        ref: input.item.source_ref,
        revision_id: input.workItem.updated_at,
        title: this.runtimeSafeText(input.workItem.title),
        goal: this.runtimeSafeText(input.workItem.goal),
        success_criteria: input.workItem.success_criteria.map((entry) => this.runtimeSafeText(entry)),
      },
      boundary_brainstorming: {
        session_id: input.brainstormingSession.id,
        session_revision_id: input.brainstormingSession.revision_id,
        approved_summary_id: input.boundary.id,
        approved_summary_revision_id: input.boundaryRevision.id,
        summary: this.runtimeSafeText(input.boundary.summary),
        question_answer_snapshot: this.boundarySummaryRevisionQuestionAnswerSnapshot(input.boundaryRevision).map((entry) => ({
          question_id: entry.question_id,
          answer_id: entry.answer_id,
          summary: this.runtimeSafeText(entry.text),
        })),
        decision_snapshot: this.boundarySummaryRevisionDecisionSnapshot(input.boundaryRevision).map((entry) => ({
          decision_id: entry.decision_id,
          summary: this.runtimeSafeText(entry.text),
          ...(entry.rationale === undefined ? {} : { rationale: { summary: this.runtimeSafeText(entry.rationale) } }),
        })),
      },
      ...(input.specRevision === undefined
        ? {}
        : {
            approved_spec_revision: {
              id: input.specRevision.id,
              spec_id: input.specRevision.spec_id,
              summary: this.runtimeSafeText(input.specRevision.summary),
              content: this.runtimeSafeText(input.specRevision.content),
              boundary_summary_id: input.specRevision.boundary_summary_id,
              structured_document_digest: codexCanonicalDigest(input.specRevision.structured_document ?? {}),
            },
          }),
      context_manifest: {
        id: input.contextManifest.id,
        revision_id: input.contextManifest.revision_id,
        sources: this.publicSafeContextSources(input.contextManifest.sources),
      },
      requested_by_actor_id: input.actorId,
    };
  }

  private publicSafeContextSources(sources: ContextManifest['sources']): ContextManifest['sources'] {
    return sources.map((source, index) => ({
      type: 'context-source',
      ref: this.publicSafeRef('context-source', index),
      digest: codexCanonicalDigest(source),
    }));
  }

  private runtimeSafeText(value: string): string {
    return value.replace(runtimeSensitiveTextPattern, '[runtime-redacted]');
  }

  private publicSafeRefs(prefix: string, values: readonly unknown[]): string[] {
    return values.map((_value, index) => this.publicSafeRef(prefix, index));
  }

  private publicSafeRef(prefix: string, index: number): string {
    const normalizedPrefix = prefix.replace(/[^A-Za-z0-9._~-]+/g, '-').replace(/^-+|-+$/g, '') || 'ref';
    return `${normalizedPrefix}-${index + 1}`;
  }

  private productGenerationAutomationScope(projectId: string, repoIds: readonly string[]): AutomationScope {
    const repoId = this.canonicalRepoIds(repoIds)[0];
    return repoId === undefined ? `project:${projectId}` : `repo:${projectId}:${repoId}`;
  }

  private async productGenerationRepoIds(repository: DeliveryRepository, projectId: string): Promise<string[]> {
    return this.canonicalRepoIds((await repository.listProjectRepos(projectId)).map((repo) => repo.repo_id));
  }

  private canonicalRepoIds(repoIds: readonly string[]): string[] {
    return [...new Set(repoIds)].sort();
  }

  private async replayAppliedProductGenerationSchedule(
    repository: DeliveryRepository,
    itemId: string,
    eventType: string,
    actionType: AutomationActionRun['action_type'],
    actorId: string,
  ): Promise<ProductGenerationScheduleResult | undefined> {
    const events = (await repository.listObjectEvents(itemId, 'development_plan_item')).slice().reverse();
    for (const event of events) {
      if (event.event_type !== eventType) {
        continue;
      }
      const actionRunId = event.metadata.action_run_id;
      const runtimeJobId = event.metadata.runtime_job_id;
      if (typeof actionRunId !== 'string' || typeof runtimeJobId !== 'string') {
        continue;
      }
      const actionRun = await repository.getAutomationActionRun(actionRunId);
      if (
        actionRun === undefined ||
        actionRun.action_type !== actionType ||
        actionRun.status !== 'succeeded' ||
        actionRun.action_input_json.requested_by_actor_id !== actorId
      ) {
        continue;
      }
      const replayed = await this.productRuntimeScheduler.replay({
        repository,
        action_run_id: actionRunId,
        runtime_job_id: runtimeJobId,
      });
      if (replayed !== undefined) {
        return replayed;
      }
    }
    return undefined;
  }

  private stableUuid(input: Record<string, unknown>): string {
    const hex = codexCanonicalDigest(input).slice('sha256:'.length);
    const variant = ((Number.parseInt(hex[16] ?? '0', 16) & 0x3) | 0x8).toString(16);
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
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
    const qaOwnerActorId = item.reviewer_actor_id ?? item.driver_actor_id ?? workItem.driver_actor_id;
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
      scope_out: ['Direct Work Item Spec or Implementation Plan Doc creation compatibility'],
      acceptance_criteria: [...workItem.success_criteria],
      risk_notes: [workItem.risk, ...item.dependency_hints],
      test_strategy_summary: 'Validate item-scoped Spec gate behavior with API and contract tests.',
      ...(qaOwnerActorId === undefined ? {} : { qa_owner_actor_id: qaOwnerActorId }),
      testability_note: `QA/Test Owner must validate ${item.title} against acceptance criteria before Implementation Plan Doc generation.`,
      risk_scenarios: item.dependency_hints.length > 0 ? item.dependency_hints : [`${item.risk} risk Plan Item requires focused validation.`],
      structured_document: {
        generated_by: 'mock_item_spec_draft_adapter',
        development_plan_item_id: item.id,
        boundary_summary_id: boundary.id,
        boundary_summary_revision_id: contextManifest.boundary_summary_revision_id,
        context_manifest_id: contextManifest.id,
      },
      ...(actorId === undefined ? {} : { author_actor_id: actorId }),
    };
  }

  private itemImplementationPlanDraftInput(
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
      summary: `Draft Implementation Plan Doc for ${item.title}`,
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
    field: 'spec_status' | 'implementation_plan_status',
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
    field: 'spec_status' | 'implementation_plan_status',
    status: DevelopmentPlanItem['spec_status'],
  ): string {
    if (field === 'spec_status') {
      if (status === 'draft') return 'submit_spec_for_approval';
      if (status === 'in_review') return 'review_spec';
      if (status === 'approved') return 'generate_implementation_plan';
      if (status === 'changes_requested') return 'regenerate_spec';
      return 'generate_spec';
    }
    if (status === 'draft') return 'submit_implementation_plan_for_approval';
    if (status === 'in_review') return 'review_implementation_plan';
    if (status === 'approved') return 'start_execution';
    if (status === 'changes_requested') return 'regenerate_implementation_plan';
    return 'generate_implementation_plan';
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
        implementation_plan_status: item.implementation_plan_status,
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
      ...(input.qa_owner_actor_id !== undefined ? { qa_owner_actor_id: input.qa_owner_actor_id } : {}),
      ...(input.test_owner_actor_id !== undefined ? { test_owner_actor_id: input.test_owner_actor_id } : {}),
      ...(input.testability_note !== undefined ? { testability_note: input.testability_note } : {}),
      ...(input.risk_scenarios !== undefined ? { risk_scenarios: input.risk_scenarios } : {}),
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

  private productGenerationPrecondition(actionRun: AutomationActionRun): Record<string, unknown> | undefined {
    const value = actionRun.action_input_json.precondition_fingerprint_json;
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
  }

  private async loadGenerationPrecondition(
    precondition: Record<string, unknown>,
    repository: DeliveryRepository,
  ): Promise<LoadedProductGenerationPrecondition | undefined> {
    const plan = await repository.getDevelopmentPlan(String(precondition.development_plan_id));
    const item = await repository.getDevelopmentPlanItem(String(precondition.development_plan_item_id));
    const workItem = item === undefined ? undefined : await repository.getWorkItem(item.source_ref.id);
    const contextManifest = await repository.getContextManifest(String(precondition.context_manifest_id));
    const boundaryRevision =
      precondition.approved_boundary_summary_revision_id === undefined
        ? undefined
        : await this.findBoundarySummaryRevision(String(precondition.approved_boundary_summary_revision_id), repository);
    const boundary =
      boundaryRevision === undefined ? undefined : await repository.getBoundarySummary(boundaryRevision.boundary_summary_id);
    const brainstormingSession =
      precondition.boundary_session_id === undefined
        ? undefined
        : await repository.getBrainstormingSession(String(precondition.boundary_session_id));
    if (
      plan === undefined ||
      item === undefined ||
      workItem === undefined ||
      contextManifest === undefined ||
      boundaryRevision === undefined ||
      boundary === undefined ||
      brainstormingSession === undefined
    ) {
      return undefined;
    }
    return { plan, item, workItem, boundary, boundaryRevision, brainstormingSession, contextManifest };
  }

  private async specGenerationPreconditionStillCurrent(
    actionRun: AutomationActionRun,
    precondition: Record<string, unknown>,
    loaded: LoadedProductGenerationPrecondition,
    repository: DeliveryRepository,
    options: { requireCurrentBoundaryRevision: boolean } = { requireCurrentBoundaryRevision: true },
  ): Promise<boolean> {
    return (
      actionRun.target_object_id === loaded.item.id &&
      actionRun.target_revision_id === loaded.item.revision_id &&
      JSON.stringify(precondition.source_ref) === JSON.stringify(loaded.item.source_ref) &&
      String(precondition.source_revision_id) === loaded.workItem.updated_at &&
      String(precondition.development_plan_id) === loaded.plan.id &&
      String(precondition.development_plan_revision_id) === loaded.plan.revision_id &&
      String(precondition.development_plan_item_id) === loaded.item.id &&
      String(precondition.development_plan_item_revision_id) === loaded.item.revision_id &&
      String(precondition.boundary_session_id) === loaded.brainstormingSession.id &&
      String(precondition.boundary_session_revision_id) === loaded.brainstormingSession.revision_id &&
      String(precondition.approved_boundary_summary_revision_id) === loaded.boundaryRevision.id &&
      String(precondition.context_manifest_id) === loaded.contextManifest.id &&
      String(precondition.context_manifest_revision_id) === loaded.contextManifest.revision_id &&
      (!options.requireCurrentBoundaryRevision || this.boundarySummaryRevisionMatchesItem(loaded.boundary, loaded.boundaryRevision, loaded.item)) &&
      loaded.contextManifest.boundary_summary_revision_id === loaded.boundaryRevision.id &&
      loaded.boundary.revision_id === loaded.boundaryRevision.id &&
      this.boundarySummaryRevisionApproved(loaded.boundaryRevision) &&
      this.requiredBoundaryQuestionsStillClosed(loaded, repository)
    );
  }

  private async executionPlanGenerationPreconditionStillCurrent(
    actionRun: AutomationActionRun,
    precondition: Record<string, unknown>,
    loaded: LoadedProductGenerationPrecondition,
    spec: Spec,
    approvedSpecRevision: SpecRevision,
    repository: DeliveryRepository,
  ): Promise<boolean> {
    return (
      (await this.specGenerationPreconditionStillCurrent(actionRun, precondition, loaded, repository, { requireCurrentBoundaryRevision: false })) &&
      String(precondition.approved_spec_revision_id) === approvedSpecRevision.id &&
      spec.development_plan_item_id === loaded.item.id &&
      spec.status === 'approved' &&
      spec.current_revision_id === approvedSpecRevision.id &&
      spec.approved_revision_id === approvedSpecRevision.id &&
      approvedSpecRevision.development_plan_item_id === loaded.item.id &&
      approvedSpecRevision.boundary_summary_id === loaded.boundary.id &&
      this.revisionStructuredBoundarySummaryRevisionId(approvedSpecRevision) === loaded.boundaryRevision.id &&
      (await this.currentItemRevisionAtApprovedSpecGate(loaded.item, repository)) &&
      loaded.contextManifest.approved_spec_revision_id === approvedSpecRevision.id
    );
  }

  private async requiredBoundaryQuestionsStillClosed(
    loaded: LoadedProductGenerationPrecondition,
    repository: DeliveryRepository,
  ): Promise<boolean> {
    const [questions, answers, decisions] = await Promise.all([
      repository.listBoundaryQuestions(loaded.brainstormingSession.id),
      repository.listBoundaryAnswers(loaded.brainstormingSession.id),
      repository.listBoundaryDecisions(loaded.brainstormingSession.id),
    ]);
    return requiredBoundaryQuestionsClosed({ questions, answers, decisions });
  }

  private revisionStructuredBoundarySummaryRevisionId(revision: SpecRevision): string | undefined {
    const structured = revision.structured_document;
    if (structured === undefined || structured === null || typeof structured !== 'object' || Array.isArray(structured)) {
      return undefined;
    }
    const value = (structured as Record<string, unknown>).boundary_summary_revision_id;
    return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
  }

  private boundarySummaryRevisionQuestionAnswerSnapshot(
    revision: BoundarySummaryRevision,
  ): Array<{ question_id: string; answer_id: string; text: string }> {
    const value = (revision as BoundarySummaryRevision & { question_answer_snapshot?: unknown }).question_answer_snapshot;
    if (!Array.isArray(value)) {
      return [];
    }
    return value.flatMap((entry) => {
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
        return [];
      }
      const record = entry as Record<string, unknown>;
      return typeof record.question_id === 'string' &&
        typeof record.answer_id === 'string' &&
        typeof record.text === 'string'
        ? [{ question_id: record.question_id, answer_id: record.answer_id, text: record.text }]
        : [];
    });
  }

  private boundarySummaryRevisionDecisionSnapshot(
    revision: BoundarySummaryRevision,
  ): Array<{ decision_id: string; text: string; rationale?: string }> {
    const value = (revision as BoundarySummaryRevision & { decision_snapshot?: unknown }).decision_snapshot;
    if (!Array.isArray(value)) {
      return [];
    }
    return value.flatMap((entry) => {
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
        return [];
      }
      const record = entry as Record<string, unknown>;
      const decisionId = typeof record.decision_id === 'string' ? record.decision_id : record.id;
      return typeof decisionId === 'string' && typeof record.text === 'string'
        ? [
            {
              decision_id: decisionId,
              text: record.text,
              ...(typeof record.rationale === 'string' ? { rationale: record.rationale } : {}),
            },
          ]
        : [];
    });
  }

  private async appliedGeneratedRevisionForAction<T extends SpecRevision | ExecutionPlanRevision>(
    repository: DeliveryRepository,
    actionRunId: string,
    runtimeJobId: string,
    objectType: 'spec_revision' | 'implementation_plan_revision',
  ): Promise<T | undefined> {
    const applied = (await repository.listObjectEvents(actionRunId, 'automation_action_run')).find(
      (event) =>
        event.event_type === 'product_generation_result_applied' &&
        event.metadata.runtime_job_id === runtimeJobId &&
        event.metadata.generated_object_type === objectType &&
        typeof event.metadata.generated_revision_id === 'string',
    );
    if (typeof applied?.metadata.generated_revision_id !== 'string') {
      return undefined;
    }
    return (objectType === 'spec_revision'
      ? await repository.getSpecRevision(applied.metadata.generated_revision_id)
      : await repository.getExecutionPlanRevision(applied.metadata.generated_revision_id)) as T | undefined;
  }

  private async requireItemSpecRevision(
    itemId: string,
    revisionId: string,
    repository: DeliveryRepository = this.repository,
  ): Promise<SpecRevision> {
    const revision = this.requireFound(await repository.getSpecRevision(revisionId), `Spec Revision ${revisionId}`);
    if (revision.development_plan_item_id !== itemId) {
      throw new NotFoundException(`Spec Revision ${revisionId} not found`);
    }
    return revision;
  }

  private async requireItemExecutionPlanRevision(
    itemId: string,
    revisionId: string,
    repository: DeliveryRepository = this.repository,
  ): Promise<ExecutionPlanRevision> {
    const revision = this.requireFound(await repository.getExecutionPlanRevision(revisionId), `Implementation Plan Revision ${revisionId}`);
    if (revision.development_plan_item_id !== itemId) {
      throw new NotFoundException(`Implementation Plan Revision ${revisionId} not found`);
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
      throw new BadRequestException(`Implementation Plan Doc ${executionPlan.id} has no current revision`);
    }
    return executionPlan.current_revision_id;
  }

  private async requireRevisionNotRejected(
    revisionId: string,
    objectType: 'spec_revision' | 'implementation_plan_revision',
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

  private async toPublicSpecRevision(
    revision: SpecRevision,
    repository: DeliveryRepository = this.repository,
  ): Promise<PublicSpecRevision> {
    const {
      work_item_id: workItemId,
      structured_document: _structuredDocument,
      artifact_refs: _artifactRefs,
      ...publicRevision
    } = revision;
    return {
      ...publicRevision,
      attachment_refs: await this.publicAttachmentsForObject(repository, 'spec_revision', revision.id),
      scope_ref: await this.scopeRefForWorkItemId(workItemId),
    };
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

  private publicSpecRevisionSnapshot(revision: SpecRevision): Record<string, unknown> {
    const {
      work_item_id: _workItemId,
      structured_document: _structuredDocument,
      artifact_refs: _artifactRefs,
      ...snapshot
    } = revision;
    return snapshot;
  }

  private async toPublicImplementationPlanRevision(
    revision: ExecutionPlanRevision,
    repository: DeliveryRepository = this.repository,
  ): Promise<PublicImplementationPlanRevision> {
    const { execution_plan_id: executionPlanId, structured_document: _structuredDocument, ...publicRevision } = revision;
    return {
      ...publicRevision,
      implementation_plan_id: executionPlanId,
      attachment_refs: await this.publicAttachmentsForObject(repository, 'implementation_plan_revision', revision.id),
    };
  }

  private publicImplementationPlanRevisionSnapshot(revision: ExecutionPlanRevision): Record<string, unknown> {
    const { execution_plan_id: executionPlanId, structured_document: _structuredDocument, ...snapshot } = revision;
    return { ...snapshot, implementation_plan_id: executionPlanId };
  }

  private async publicAttachmentsForObject(
    repository: DeliveryRepository,
    objectType: 'spec_revision' | 'implementation_plan_revision',
    objectId: string,
  ): Promise<AttachmentRef[]> {
    return (await repository.listAttachmentsForObject(objectType, objectId)).map((attachment) => this.attachments.toPublicRef(attachment));
  }

  private requireDocumentObjectRef(
    document: MarkdownDocument,
    expectedType: 'spec_revision' | 'implementation_plan_revision',
    expectedRevisionId: string,
  ): void {
    if (document.object_ref.type !== expectedType || document.object_ref.id !== expectedRevisionId) {
      throw new BadRequestException(`${expectedType} draft save must target the current document revision`);
    }
  }

  private async linkMarkdownAttachmentsToRevision(
    repository: DeliveryRepository,
    attachments: AttachmentRef[],
    objectRef: Extract<ObjectRef, { type: 'spec_revision' | 'implementation_plan_revision' }>,
  ): Promise<void> {
    await Promise.all(attachments.map((attachment) => repository.linkAttachmentToObject(attachment.id, objectRef)));
  }

  private async attachmentRefsForDraftSave(
    document: MarkdownDocument,
    validatedDocument: MarkdownDocument,
  ): Promise<AttachmentRef[]> {
    const attachmentsById = new Map(validatedDocument.attachment_refs.map((attachment) => [attachment.id, attachment]));

    for (const attachment of document.attachment_refs) {
      const referenceable = await this.attachments.getReferenceableAttachment(attachment.id, document.object_ref);
      if (referenceable !== undefined) {
        attachmentsById.set(referenceable.id, referenceable);
      }
    }

    return [...attachmentsById.values()];
  }

  private async scopeRefForWorkItemId(workItemId: string): Promise<ObjectRef> {
    const workItem = this.requireFound(await this.repository.getWorkItem(workItemId), `WorkItem ${workItemId}`);
    return { type: workItem.kind, id: workItem.id, title: workItem.title } as ObjectRef;
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

  private artifactLabel(entity: Spec | Plan): 'Spec' | 'Plan' {
    return entity.entity_type === 'spec' ? 'Spec' : 'Plan';
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

function summaryFromMarkdown(markdown: string, fallback: string): string {
  const heading = markdown
    .split('\n')
    .map((line) => line.replace(/^#{1,6}\s+/, '').trim())
    .find((line) => line.length > 0);
  return heading ?? fallback;
}

type SpecStructuredFields = Pick<
  SpecRevision,
  'summary' | 'background' | 'goals' | 'scope_in' | 'scope_out' | 'acceptance_criteria' | 'risk_notes' | 'test_strategy_summary'
>;

function specStructuredFieldsFromMarkdown(markdown: string): SpecStructuredFields {
  const sections = markdownSections(markdown);
  const summary = summaryFromMarkdown(markdown, 'Untitled Spec draft');
  const fallbackBody = firstMarkdownParagraph(markdown) ?? summary;

  return {
    summary,
    background: sectionText(sections, ['background', 'context', 'problem', '背景']) ?? fallbackBody,
    goals: sectionItems(sections, ['goals', 'goal', 'objectives', '目标']) ?? [summary],
    scope_in: sectionItems(sections, ['scope in', 'in scope', 'scope', 'included scope', '范围内']) ?? [fallbackBody],
    scope_out: sectionItems(sections, ['scope out', 'out of scope', 'non goals', 'non-goals', 'exclusions', '范围外']) ?? [],
    acceptance_criteria: sectionItems(sections, ['acceptance criteria', 'acceptance', 'success criteria', '验收标准']) ?? [fallbackBody],
    risk_notes: sectionItems(sections, ['risk notes', 'risks', 'risk', 'risks and mitigations', '风险']) ?? [],
    test_strategy_summary: sectionText(sections, ['test strategy', 'testing', 'validation', 'verification plan', '测试策略']) ?? fallbackBody,
  };
}

function markdownSections(markdown: string): Map<string, string[]> {
  const sections = new Map<string, string[]>();
  let currentHeading = 'intro';
  let inCodeFence = false;

  for (const line of markdown.split('\n')) {
    if (line.trim().startsWith('```')) {
      inCodeFence = !inCodeFence;
      sections.set(currentHeading, [...(sections.get(currentHeading) ?? []), line]);
      continue;
    }

    const heading = inCodeFence ? undefined : line.match(/^#{1,6}\s+(.+?)\s*#*\s*$/)?.[1];
    if (heading !== undefined) {
      currentHeading = normalizeMarkdownHeading(heading);
      if (!sections.has(currentHeading)) sections.set(currentHeading, []);
      continue;
    }

    sections.set(currentHeading, [...(sections.get(currentHeading) ?? []), line]);
  }

  return sections;
}

function sectionText(sections: Map<string, string[]>, headings: string[]): string | undefined {
  const lines = findSectionLines(sections, headings);
  if (lines === undefined) return undefined;
  return markdownParagraphs(lines).join('\n\n') || undefined;
}

function sectionItems(sections: Map<string, string[]>, headings: string[]): string[] | undefined {
  const lines = findSectionLines(sections, headings);
  if (lines === undefined) return undefined;
  const listItems = lines
    .map((line) => line.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '').replace(/^\[[ xX]\]\s+/, '').trim())
    .filter((line) => line.length > 0);
  if (listItems.length > 0) return listItems;
  const paragraphs = markdownParagraphs(lines);
  return paragraphs.length > 0 ? paragraphs : undefined;
}

function findSectionLines(sections: Map<string, string[]>, headings: string[]): string[] | undefined {
  for (const heading of headings) {
    const section = sections.get(normalizeMarkdownHeading(heading));
    if (section !== undefined) return section;
  }
  return undefined;
}

function firstMarkdownParagraph(markdown: string): string | undefined {
  return markdownParagraphs(markdown.split('\n').filter((line) => !/^#{1,6}\s+/.test(line))).at(0);
}

function markdownParagraphs(lines: string[]): string[] {
  const paragraphs: string[] = [];
  let current: string[] = [];

  for (const line of lines) {
    const normalized = line.trim();
    if (normalized.length === 0) {
      if (current.length > 0) {
        paragraphs.push(cleanMarkdownText(current.join(' ')));
        current = [];
      }
      continue;
    }
    current.push(normalized);
  }

  if (current.length > 0) paragraphs.push(cleanMarkdownText(current.join(' ')));
  return paragraphs.filter((paragraph) => paragraph.length > 0);
}

function cleanMarkdownText(value: string): string {
  return value
    .replace(/^>\s*/, '')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_`~]/g, '')
    .trim();
}

function normalizeMarkdownHeading(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[:：]/g, ' ')
    .replace(/[^\p{Letter}\p{Number}\s-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}
