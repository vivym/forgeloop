import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  type AutomationActorClass,
  type Plan,
  type PlanRevision,
  type Spec,
  type SpecRevision,
  type WorkItem,
  transitionSpecPlan,
  transitionWorkItem,
} from '@forgeloop/domain';
import type { DeliveryRepository } from '@forgeloop/db';

import { AuditWriterService } from '../audit/audit-writer.service';
import type { ActorContext } from '../auth/actor-context';
import { ControlPlaneRuntimeService } from '../core/control-plane-runtime.service';
import { DELIVERY_REPOSITORY } from '../core/control-plane-tokens';
import type { ActorCommandDto, CreatePlanRevisionDto, CreateSpecRevisionDto } from '../delivery/dto';
import { WorkItemService } from '../work-items/work-item.service';

const actorOrSystem = (actorId: string | undefined): string => actorId ?? 'system';

const productGateRejectedActorClasses = new Set<AutomationActorClass>([
  'automation_daemon',
  'source_adapter',
  'external_tracker',
  'repo_policy',
]);

@Injectable()
export class SpecPlanService {
  constructor(
    @Inject(DELIVERY_REPOSITORY) private readonly repository: DeliveryRepository,
    @Inject(ControlPlaneRuntimeService)
    private readonly controlPlaneRuntime: ControlPlaneRuntimeService,
    @Inject(AuditWriterService) private readonly audit: AuditWriterService,
    @Inject(WorkItemService) private readonly workItemService: WorkItemService,
  ) {}

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
    const workItem = await this.workItemService.getWorkItem(spec.work_item_id);
    const drafting = transitionSpecPlan(spec, { type: 'generate_draft_start', at: this.now() }) as Spec;
    await this.repository.saveSpec(drafting);
    await this.event('spec', spec.id, 'spec_draft_generation_started', workItem.owner_actor_id, {});

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
      author_actor_id: workItem.owner_actor_id,
    });
    const updated = transitionSpecPlan({ ...drafting, current_revision_id: revision.id }, {
      type: 'generate_draft_success',
      at: this.now(),
    }) as Spec;
    await this.repository.saveSpec(updated);
    await this.event('spec_revision', revision.id, 'spec_draft_generated', workItem.owner_actor_id, { spec_id: spec.id });
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
    if (spec.current_revision_id === undefined) {
      throw new BadRequestException(`Spec ${spec.id} has no current revision to approve`);
    }
    const updated = {
      ...(transitionSpecPlan(spec, { type: 'approve', at: this.now() }) as Spec),
      approved_revision_id: spec.current_revision_id,
    };
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

  async generatePlanDraft(planId: string): Promise<PlanRevision> {
    const plan = await this.getPlan(planId);
    const workItem = await this.workItemService.getWorkItem(plan.work_item_id);
    const spec = await this.requireApprovedCurrentSpec(workItem);
    const specRevision = await this.getSpecRevision(spec.current_revision_id!);
    const drafting = transitionSpecPlan(plan, { type: 'generate_draft_start', at: this.now() }) as Plan;
    await this.repository.savePlan(drafting);
    await this.event('plan', plan.id, 'plan_draft_generation_started', workItem.owner_actor_id, {});

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
      author_actor_id: workItem.owner_actor_id,
    });
    const updated = transitionSpecPlan({ ...drafting, current_revision_id: revision.id }, {
      type: 'generate_draft_success',
      at: this.now(),
    }) as Plan;
    await this.repository.savePlan(updated);
    await this.event('plan_revision', revision.id, 'plan_draft_generated', workItem.owner_actor_id, { plan_id: plan.id });
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
    if (plan.current_revision_id === undefined) {
      throw new BadRequestException(`Plan ${plan.id} has no current revision to approve`);
    }
    const updated = {
      ...(transitionSpecPlan(plan, { type: 'approve', at: this.now() }) as Plan),
      approved_revision_id: plan.current_revision_id,
    };
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
