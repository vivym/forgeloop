import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { SourceObjectRef } from '@forgeloop/contracts';
import type { DeliveryRepository } from '@forgeloop/db';
import { DomainError, type ContextManifest, type DevelopmentPlan, type DevelopmentPlanItem, type DevelopmentPlanItemRevision, type DevelopmentPlanSourceLink, type WorkItem } from '@forgeloop/domain';

import { AuditWriterService } from '../audit/audit-writer.service';
import { ControlPlaneRuntimeService } from '../core/control-plane-runtime.service';
import { DELIVERY_REPOSITORY } from '../core/control-plane-tokens';

type SourceObjectType = SourceObjectRef['type'];

type CreateDevelopmentPlanInput = {
  project_id: string;
  source_ref: SourceObjectRef;
  title: string;
  actor_id?: string | undefined;
};

type CreateDevelopmentPlanItemInput = {
  title: string;
  summary: string;
  responsible_role: DevelopmentPlanItem['responsible_role'];
  driver_actor_id?: string | undefined;
  reviewer_actor_id?: string | undefined;
  risk: DevelopmentPlanItem['risk'];
  dependency_hints: string[];
  affected_surfaces: string[];
  release_impact: DevelopmentPlanItem['release_impact'];
};

type GenerateDraftInput = {
  project_id: string;
  source_ref: SourceObjectRef;
  actor_id?: string | undefined;
  guidance?: string | undefined;
};

type RegenerateDraftInput = {
  actor_id?: string | undefined;
  feedback: string;
  preserve_prior_decisions: boolean;
};

type LinkSourceObjectInput = {
  source_type: SourceObjectType;
  source_id: string;
  development_plan_id: string;
  actor_id?: string | undefined;
  rationale?: string | undefined;
};

const allowedSourceObjectTypes = new Set<SourceObjectType>(['initiative', 'requirement', 'bug', 'tech_debt']);

@Injectable()
export class DevelopmentPlansService {
  constructor(
    @Inject(DELIVERY_REPOSITORY) private readonly repository: DeliveryRepository,
    @Inject(ControlPlaneRuntimeService) private readonly runtime: ControlPlaneRuntimeService,
    @Inject(AuditWriterService) private readonly audit: AuditWriterService,
  ) {}

  async createDevelopmentPlan(input: CreateDevelopmentPlanInput): Promise<DevelopmentPlan> {
    await this.requireSourceObject(input.project_id, input.source_ref);
    const at = this.runtime.now();
    const plan: DevelopmentPlan = {
      id: this.runtime.id('development-plan'),
      revision_id: this.runtime.id('development-plan-revision'),
      project_id: input.project_id,
      title: input.title,
      status: 'draft',
      source_refs: [input.source_ref],
      items: [],
      created_at: at,
      updated_at: at,
    };
    await this.repository.saveDevelopmentPlan(plan);
    await this.saveSourceLink(plan.id, input.source_ref, 'primary', input.actor_id);
    await this.appendPlanEvent(plan.id, 'development_plan_created', input.actor_id, {
      source_ref: input.source_ref,
      revision_id: plan.revision_id,
    });
    return this.requireDevelopmentPlan(plan.id);
  }

  async createDevelopmentPlanItem(developmentPlanId: string, input: CreateDevelopmentPlanItemInput): Promise<DevelopmentPlanItem> {
    return this.repository.withObjectLock(`development-plan:${developmentPlanId}`, async (repository) => {
      const plan = await this.requireDevelopmentPlan(developmentPlanId, repository);
      const sourceRef = this.primarySourceRef(plan);
      const item = this.buildDevelopmentPlanItem(plan.id, sourceRef, input);
      await repository.saveDevelopmentPlanItem(item);
      await this.saveItemRevision(item, 'manual_item_created', input.driver_actor_id, repository);
      await repository.saveDevelopmentPlan({
        ...plan,
        revision_id: this.runtime.id('development-plan-revision'),
        updated_at: this.runtime.now(),
      });
      await this.appendItemEvent(item.id, 'development_plan_item_created', input.driver_actor_id, { development_plan_id: plan.id }, repository);
      return item;
    });
  }

  async generateDevelopmentPlanDraft(input: GenerateDraftInput): Promise<Record<string, unknown>> {
    await this.requireSourceObject(input.project_id, input.source_ref);
    const at = this.runtime.now();
    const plan: DevelopmentPlan = {
      id: this.runtime.id('development-plan'),
      revision_id: this.runtime.id('development-plan-revision'),
      project_id: input.project_id,
      title: 'Draft Development Plan',
      status: 'draft',
      source_refs: [input.source_ref],
      items: [],
      created_at: at,
      updated_at: at,
    };
    const contextManifest = await this.buildContextManifest({
      sourceRef: input.source_ref,
      projectId: input.project_id,
      developmentPlanId: plan.id,
      developmentPlanRevisionId: plan.revision_id,
      actorGuidance: input.guidance,
    });

    await this.repository.saveContextManifest(contextManifest);
    await this.repository.saveDevelopmentPlan(plan);
    await this.saveSourceLink(plan.id, input.source_ref, 'primary', input.actor_id);

    for (const itemInput of this.generatedItemInputs(input.guidance)) {
      const item = this.buildDevelopmentPlanItem(plan.id, input.source_ref, itemInput);
      await this.repository.saveDevelopmentPlanItem(item);
      await this.saveItemRevision(item, 'ai_draft_generated', input.actor_id);
      await this.appendItemEvent(item.id, 'development_plan_item_created', input.actor_id, { development_plan_id: plan.id });
    }

    await this.appendPlanEvent(plan.id, 'development_plan_draft_generated', input.actor_id, {
      context_manifest_id: contextManifest.id,
      guidance: input.guidance,
    });

    return this.developmentPlanResponse(plan.id, {
      generation_state: 'draft_generated',
      actor_guidance: input.guidance,
      context_manifest_id: contextManifest.id,
    });
  }

  async regenerateDevelopmentPlanDraft(developmentPlanId: string, input: RegenerateDraftInput): Promise<Record<string, unknown>> {
    return this.repository.withObjectLock(`development-plan:${developmentPlanId}`, async (repository) => {
      const plan = await this.requireDevelopmentPlan(developmentPlanId, repository);
      if (plan.status === 'approved') {
        throw new ConflictException('Approved Development Plans cannot be regenerated');
      }
      const revisionId = this.runtime.id('development-plan-revision');
      const sourceRef = this.primarySourceRef(plan);
      const contextManifest = await this.buildContextManifest({
        sourceRef,
        projectId: plan.project_id,
        developmentPlanId: plan.id,
        developmentPlanRevisionId: revisionId,
        actorGuidance: input.feedback,
      });
      await repository.saveContextManifest(contextManifest);

      const regeneratedItem = this.buildDevelopmentPlanItem(plan.id, sourceRef, {
        title: 'QA handoff planning',
        summary: `Regenerated from feedback: ${input.feedback}`,
        responsible_role: 'qa',
        driver_actor_id: input.actor_id,
        risk: 'medium',
        dependency_hints: input.preserve_prior_decisions ? ['preserve_prior_decisions'] : [],
        affected_surfaces: ['tests/api'],
        release_impact: 'release_scoped',
      });
      await repository.saveDevelopmentPlanItem(regeneratedItem);
      await this.saveItemRevision(regeneratedItem, 'ai_draft_regenerated', input.actor_id, repository);
      await this.appendItemEvent(
        regeneratedItem.id,
        'development_plan_item_created',
        input.actor_id,
        { development_plan_id: plan.id, generated_by: 'regenerate_draft' },
        repository,
      );

      await repository.saveDevelopmentPlan({
        ...plan,
        revision_id: revisionId,
        updated_at: this.runtime.now(),
      });
      await this.appendPlanEvent(
        plan.id,
        'development_plan_draft_regenerated',
        input.actor_id,
        {
          context_manifest_id: contextManifest.id,
          feedback: input.feedback,
          preserve_prior_decisions: input.preserve_prior_decisions,
        },
        repository,
      );

      return this.developmentPlanResponse(plan.id, {
        generation_state: 'draft_regenerated',
        context_manifest_id: contextManifest.id,
        regeneration: {
          feedback: input.feedback,
          preserve_prior_decisions: input.preserve_prior_decisions,
        },
      });
    });
  }

  async linkSourceObjectToDevelopmentPlan(input: LinkSourceObjectInput): Promise<DevelopmentPlanSourceLink> {
    const plan = await this.requireDevelopmentPlan(input.development_plan_id);
    const sourceRef: SourceObjectRef = { type: input.source_type, id: input.source_id };
    await this.requireSourceObject(plan.project_id, sourceRef);
    const existing = (await this.repository.listDevelopmentPlanSourceLinksForSource(sourceRef)).find(
      (link) => link.development_plan_id === plan.id,
    );
    if (existing !== undefined) {
      return existing;
    }

    const link = await this.saveSourceLink(plan.id, sourceRef, 'related', input.actor_id, input.rationale);
    const sourceRefs = this.hasSourceRef(plan, sourceRef) ? plan.source_refs : [...plan.source_refs, sourceRef];
    await this.repository.saveDevelopmentPlan({
      ...plan,
      revision_id: this.runtime.id('development-plan-revision'),
      source_refs: sourceRefs,
      updated_at: this.runtime.now(),
    });
    await this.appendPlanEvent(plan.id, 'development_plan_source_linked', input.actor_id, {
      source_ref: sourceRef,
      rationale: input.rationale,
    });
    return link;
  }

  private async requireDevelopmentPlan(
    developmentPlanId: string,
    repository: DeliveryRepository = this.repository,
  ): Promise<DevelopmentPlan> {
    const plan = await repository.getDevelopmentPlan(developmentPlanId);
    if (plan === undefined) {
      throw new NotFoundException(`Development Plan ${developmentPlanId} not found`);
    }
    return plan;
  }

  private async requireSourceObject(projectId: string, sourceRef: SourceObjectRef): Promise<WorkItem> {
    if (!allowedSourceObjectTypes.has(sourceRef.type)) {
      throw new DomainError('INVALID_TRANSITION', `Unsupported source object type ${sourceRef.type}`);
    }
    const sourceObject = await this.repository.getWorkItem(sourceRef.id);
    if (sourceObject === undefined) {
      throw new NotFoundException(`${sourceRef.type} ${sourceRef.id} not found`);
    }
    if (sourceObject.kind !== sourceRef.type) {
      throw new BadRequestException(`Source object ${sourceRef.id} is a ${sourceObject.kind}, not a ${sourceRef.type}`);
    }
    if (sourceObject.project_id !== projectId) {
      throw new BadRequestException('Source object must belong to the Development Plan project');
    }
    return sourceObject;
  }

  private buildDevelopmentPlanItem(
    developmentPlanId: string,
    sourceRef: SourceObjectRef,
    input: CreateDevelopmentPlanItemInput,
  ): DevelopmentPlanItem {
    const at = this.runtime.now();
    return {
      id: this.runtime.id('development-plan-item'),
      development_plan_id: developmentPlanId,
      revision_id: this.runtime.id('development-plan-item-revision'),
      source_ref: sourceRef,
      title: input.title,
      summary: input.summary,
      responsible_role: input.responsible_role,
      ...(input.driver_actor_id === undefined ? {} : { driver_actor_id: input.driver_actor_id }),
      ...(input.reviewer_actor_id === undefined ? {} : { reviewer_actor_id: input.reviewer_actor_id }),
      risk: input.risk,
      dependency_hints: input.dependency_hints,
      affected_surfaces: input.affected_surfaces,
      boundary_status: 'not_started',
      spec_status: 'missing',
      execution_plan_status: 'missing',
      execution_status: 'not_started',
      review_status: 'missing',
      qa_handoff_status: 'missing',
      release_impact: input.release_impact,
      next_action: 'start_boundary_brainstorming',
      created_at: at,
      updated_at: at,
    };
  }

  private async saveItemRevision(
    item: DevelopmentPlanItem,
    changeReason: string,
    actorId: string | undefined,
    repository: DeliveryRepository = this.repository,
  ): Promise<DevelopmentPlanItemRevision> {
    const revisions = await repository.listDevelopmentPlanItemRevisions(item.id);
    const revision: DevelopmentPlanItemRevision = {
      id: item.revision_id,
      development_plan_item_id: item.id,
      development_plan_id: item.development_plan_id,
      revision_number: revisions.length + 1,
      snapshot: item,
      change_reason: changeReason,
      ...(actorId === undefined ? {} : { edited_by_actor_id: actorId }),
      created_at: this.runtime.now(),
    };
    await repository.saveDevelopmentPlanItemRevision(revision);
    return revision;
  }

  private async saveSourceLink(
    developmentPlanId: string,
    sourceRef: SourceObjectRef,
    linkType: DevelopmentPlanSourceLink['link_type'],
    actorId?: string,
    rationale?: string,
  ): Promise<DevelopmentPlanSourceLink> {
    const link: DevelopmentPlanSourceLink = {
      id: this.runtime.id('development-plan-source-link'),
      development_plan_id: developmentPlanId,
      source_ref: sourceRef,
      link_type: linkType,
      ...(rationale === undefined ? {} : { rationale }),
      ...(actorId === undefined ? {} : { created_by_actor_id: actorId }),
      created_at: this.runtime.now(),
    };
    await this.repository.saveDevelopmentPlanSourceLink(link);
    return link;
  }

  private async buildContextManifest(input: {
    sourceRef: SourceObjectRef;
    projectId: string;
    developmentPlanId: string;
    developmentPlanRevisionId: string;
    actorGuidance?: string | undefined;
  }): Promise<ContextManifest> {
    const sourceObject = await this.requireSourceObject(input.projectId, input.sourceRef);
    const projectRepos = await this.repository.listProjectRepos(input.projectId);
    const relatedSources = (await this.repository.listWorkItems(input.projectId))
      .filter((candidate) => candidate.id !== sourceObject.id && (candidate.kind === 'requirement' || candidate.kind === 'bug'))
      .slice(0, 5)
      .map((candidate) => ({
        type: 'historical_related_source_object',
        ref: `${candidate.kind}:${candidate.id}`,
        digest: candidate.updated_at,
      }));
    const at = this.runtime.now();
    const id = this.runtime.id('context-manifest');
    return {
      id,
      revision_id: this.runtime.id('context-manifest-revision'),
      source_ref: { ...input.sourceRef, revision_id: sourceObject.updated_at },
      development_plan_id: input.developmentPlanId,
      development_plan_revision_id: input.developmentPlanRevisionId,
      sources: [
        { type: 'source_object_revision', ref: `${sourceObject.kind}:${sourceObject.id}`, digest: sourceObject.updated_at },
        { type: 'prd_product_doc', ref: 'docs/PRD_v1.md' },
        { type: 'contract_doc', ref: 'packages/contracts/src/ai-project-management.ts' },
        ...projectRepos.map((repo) => ({ type: 'repository_path', ref: repo.local_path, digest: repo.base_commit_sha })),
        ...relatedSources,
        ...(input.actorGuidance === undefined
          ? []
          : [{ type: 'actor_guidance', ref: input.actorGuidance, digest: `${input.actorGuidance.length}` }]),
      ],
      generated_at: at,
      runtime_identity: 'control-plane-api:development-plans',
      created_at: at,
      updated_at: at,
    };
  }

  private generatedItemInputs(guidance: string | undefined): CreateDevelopmentPlanItemInput[] {
    return [
      {
        title: 'Plan product surface changes',
        summary: guidance ?? 'Draft the product surface boundary and implementation shape.',
        responsible_role: 'tech_lead',
        risk: 'medium',
        dependency_hints: [],
        affected_surfaces: ['apps/web'],
        release_impact: 'release_scoped',
      },
      {
        title: 'Validate acceptance path',
        summary: 'Define API and route validation needed before execution.',
        responsible_role: 'developer',
        risk: 'medium',
        dependency_hints: [],
        affected_surfaces: ['tests/api'],
        release_impact: 'release_scoped',
      },
    ];
  }

  private async developmentPlanResponse(planId: string, extra: Record<string, unknown>): Promise<Record<string, unknown>> {
    return {
      ...(await this.requireDevelopmentPlan(planId)),
      ...extra,
    };
  }

  private primarySourceRef(plan: DevelopmentPlan): SourceObjectRef {
    const sourceRef = plan.source_refs[0];
    if (sourceRef === undefined) {
      throw new ConflictException(`Development Plan ${plan.id} has no source object`);
    }
    return sourceRef;
  }

  private hasSourceRef(plan: DevelopmentPlan, sourceRef: SourceObjectRef): boolean {
    return plan.source_refs.some((candidate) => candidate.type === sourceRef.type && candidate.id === sourceRef.id);
  }

  private appendPlanEvent(
    developmentPlanId: string,
    eventType: string,
    actorId: string | undefined,
    metadata: Record<string, unknown>,
    repository: DeliveryRepository = this.repository,
  ): Promise<void> {
    return this.audit.objectEvent(
      {
        id: this.runtime.id('object-event'),
        object_type: 'development_plan',
        object_id: developmentPlanId,
        event_type: eventType,
        ...(actorId === undefined ? {} : { actor_id: actorId }),
        metadata,
        created_at: this.runtime.now(),
      },
      repository,
    );
  }

  private appendItemEvent(
    itemId: string,
    eventType: string,
    actorId: string | undefined,
    metadata: Record<string, unknown>,
    repository: DeliveryRepository = this.repository,
  ): Promise<void> {
    return this.audit.objectEvent(
      {
        id: this.runtime.id('object-event'),
        object_type: 'development_plan_item',
        object_id: itemId,
        event_type: eventType,
        ...(actorId === undefined ? {} : { actor_id: actorId }),
        metadata,
        created_at: this.runtime.now(),
      },
      repository,
    );
  }
}
