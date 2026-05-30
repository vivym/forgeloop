import type {
  BoardCard,
  BugDetail,
  BugListItem,
  EvidenceRequirementStatus,
  InitiativeDetail,
  InitiativeListItem,
  MyWorkQueueItem,
  ObjectRef,
  ProductObjectRef,
  ProductSafeDisabledReason,
  ReleaseReadinessDetail,
  RequirementDetail,
  RequirementListItem,
  TechDebtDetail,
  TechDebtListItem,
  TypedDocumentAttachmentRef,
  TypedDocumentEvidenceRef,
  TypedDocumentRelationshipRef,
} from '@forgeloop/contracts';
import { productObjectRefSchema, releaseReadinessDetailSchema, typedDocumentRelationshipRefSchema } from '@forgeloop/contracts';
import type {
  CodeReviewHandoff,
  DevelopmentPlan,
  DevelopmentPlanItem,
  Execution,
  ExecutionPackage,
  ExecutionPlanDocument,
  ExecutionPlanRevision,
  QaHandoff,
  Release,
  ReleaseEvidence,
  ReviewPacket,
  RunSession,
  Spec,
  SpecRevision,
  Attachment,
  WorkItem,
} from '@forgeloop/domain';

import type { DeliveryRepository } from '../repositories/delivery-repository';

type WorkItemObjectType = Extract<ObjectRef['type'], 'initiative' | 'requirement' | 'bug' | 'tech_debt'>;
type MyWorkQueueObjectRef = MyWorkQueueItem['object_ref'];
type WorkItemPublicRef = Extract<MyWorkQueueObjectRef, { type: WorkItemObjectType }>;
type TypedWorkItem = WorkItem & { kind: WorkItemObjectType };
type ProductListQuery = {
  project_id: string;
  actor_id?: string | undefined;
  status?: string | undefined;
  phase?: string | undefined;
  gate_state?: string | undefined;
  resolution?: string | undefined;
  risk?: string | undefined;
  driver_actor_id?: string | undefined;
  execution_owner_actor_id?: string | undefined;
  reviewer_actor_id?: string | undefined;
  qa_owner_actor_id?: string | undefined;
  release_owner_actor_id?: string | undefined;
  blocked?: boolean | undefined;
  stale?: boolean | undefined;
  cursor?: string | undefined;
  limit?: number | undefined;
};
type ReleaseRevisionAuthority = {
  current_spec_revision_id?: string;
  current_plan_revision_id?: string;
};
type AiNativeQuery = { project_id: string; actor_id?: string | undefined; execution_id?: string | undefined };
type DevelopmentPlanItemWithPlan = { plan: DevelopmentPlan; item: DevelopmentPlanItem };
type ExecutionPlanWithContext = { executionPlan: ExecutionPlanDocument; plan: DevelopmentPlan; item: DevelopmentPlanItem };
type ExecutionWithContext = { execution: Execution; plan: DevelopmentPlan; item: DevelopmentPlanItem };
type CodeReviewWithContext = { handoff: CodeReviewHandoff; execution: Execution; plan: DevelopmentPlan; item: DevelopmentPlanItem };
type QaWithContext = { handoff: QaHandoff; plan: DevelopmentPlan; item: DevelopmentPlanItem };
type ExecutionRuntimeEvidenceProjection = {
  workspace_bundle_digest: string;
  workspace_bundle_manifest_digest?: string;
  mounted_task_workspace_digest: string;
  changed_files: string[];
};
type DashboardCommandAction = {
  href: string;
  id: string;
  kind:
    | 'release_blocker'
    | 'code_review_changes'
    | 'qa_blocker'
    | 'missing_implementation_plan_doc_approval'
    | 'missing_spec_approval'
    | 'resumable_execution'
    | 'stale_context';
  label: string;
  next_action: string;
  runtime?: { execution_id: string; resumable: boolean; state: string };
  severity: 'critical' | 'high' | 'medium' | 'low';
  stage_id: 'boundary' | 'spec' | 'implementation_plan_doc' | 'execution' | 'code_review' | 'qa' | 'release';
  typed_ref: ReturnType<typeof developmentPlanItemRef>;
};
type DashboardRuntimeSignal = {
  execution_id: string;
  href: string;
  label: string;
  resumable: boolean;
  state: string;
};
type TypedDocumentProjectionContext = {
  plans: DevelopmentPlan[];
  planItems: DevelopmentPlanItemWithPlan[];
  executionPackages: ExecutionPackage[];
  executions: ExecutionWithContext[];
  codeReviewHandoffs: CodeReviewWithContext[];
  qaHandoffs: QaWithContext[];
  releases: Release[];
  attachments: Attachment[];
  releaseEvidence: ReleaseEvidence[];
};
type TypedDocumentProjection = {
  planning_coverage: {
    development_plan_count: number;
    plan_item_count: number;
    uncovered: boolean;
  };
  downstream_gate_summary: {
    current_gate_counts: {
      boundary: number;
      spec: number;
      implementation_plan_doc: number;
      execution: number;
      code_review: number;
      qa: number;
      release: number;
    };
    blocker_count: number;
  };
  linked_development_plans: Extract<TypedDocumentRelationshipRef, { type: 'development_plan' }>[];
  linked_plan_items: Extract<TypedDocumentRelationshipRef, { type: 'development_plan_item' }>[];
  evidence_refs: TypedDocumentEvidenceRef[];
  attachment_refs: TypedDocumentAttachmentRef[];
  release_refs: Extract<TypedDocumentRelationshipRef, { type: 'release' }>[];
  audit: {
    created_at: string;
    updated_at: string;
    updated_by_actor_id?: string;
  };
  last_meaningful_update_at: string;
  next_action: string;
};

export async function listMyWorkQueue(
  repository: DeliveryRepository,
  query: { project_id: string; actor_id?: string },
): Promise<{ items: MyWorkQueueItem[]; degraded_sources: [] }> {
  const [workItems, developmentPlans, developmentPlanItems, specs, executions, qaHandoffs, releases] = await Promise.all([
    repository.listWorkItems(query.project_id),
    repository.listDevelopmentPlans(query.project_id),
    listDevelopmentPlanItemsForProject(repository, query.project_id),
    repository.listSpecs(query.project_id),
    listExecutionsForProject(repository, query.project_id),
    listQaHandoffsForProject(repository, query.project_id),
    repository.listReleases(query.project_id),
  ]);
  const actorWorkItems =
    query.actor_id === undefined ? workItems : workItems.filter((workItem) => workItem.driver_actor_id === query.actor_id);
  const actorItems =
    query.actor_id === undefined
      ? developmentPlanItems
      : developmentPlanItems.filter(
          ({ item }) => item.driver_actor_id === query.actor_id || item.reviewer_actor_id === query.actor_id,
        );
  const actorPlanIds = new Set(actorItems.map(({ plan }) => plan.id));
  const actorPlans =
    query.actor_id === undefined
      ? developmentPlans
      : developmentPlans.filter(
          (plan) =>
            actorPlanIds.has(plan.id) ||
            plan.source_refs.some((sourceRef) =>
              actorWorkItems.some((workItem) => workItem.id === sourceRef.id && workItem.kind === sourceRef.type),
            ),
        );
  const actorItemIds = new Set(actorItems.map(({ item }) => item.id));
  const actorSpecs =
    query.actor_id === undefined
      ? specs
      : specs.filter(
          (spec) =>
            spec.development_plan_item_id !== undefined && actorItemIds.has(spec.development_plan_item_id),
        );
  const actorExecutionPlans =
    query.actor_id === undefined
      ? await listExecutionPlansForProject(repository, query.project_id)
      : (await listExecutionPlansForProject(repository, query.project_id)).filter(({ item }) => actorItemIds.has(item.id));
  const actorExecutions =
    query.actor_id === undefined
      ? executions
      : executions.filter(({ item }) => item.driver_actor_id === query.actor_id || item.reviewer_actor_id === query.actor_id);
  const actorQaHandoffs =
    query.actor_id === undefined
      ? qaHandoffs
      : qaHandoffs.filter(({ item, handoff }) => item.driver_actor_id === query.actor_id || handoff.accepted_by_actor_id === query.actor_id);
  const actorReleases =
    query.actor_id === undefined
      ? releases
      : releases.filter((release) => release.release_owner_actor_id === query.actor_id);

  return {
    items: [
      ...actorWorkItems.map((workItem) => ({ item: workItemToMyWorkQueueItem(workItem), updated_at: workItem.updated_at })),
      ...actorPlans.map((plan) => ({ item: developmentPlanToMyWorkQueueItem(plan), updated_at: plan.updated_at })),
      ...actorItems.map(({ plan, item }) => ({ item: developmentPlanItemToMyWorkQueueItem(plan, item), updated_at: item.updated_at })),
      ...actorSpecs.flatMap((spec) => {
        const context =
          spec.development_plan_item_id === undefined
            ? undefined
            : developmentPlanItems.find(({ item }) => item.id === spec.development_plan_item_id);
        return context === undefined ? [] : [{ item: specToMyWorkQueueItem(spec, context.plan, context.item), updated_at: spec.updated_at }];
      }),
      ...actorExecutionPlans.map(({ executionPlan, plan, item }) => ({
        item: executionPlanToMyWorkQueueItem(executionPlan, plan, item),
        updated_at: executionPlan.updated_at,
      })),
      ...actorExecutions.map(({ execution, plan, item }) => ({
        item: executionToMyWorkQueueItem(execution, plan, item),
        updated_at: execution.updated_at,
      })),
      ...actorQaHandoffs.map(({ handoff, plan, item }) => ({ item: qaHandoffToMyWorkQueueItem(handoff, plan, item), updated_at: handoff.updated_at })),
      ...actorReleases.map((release) => ({ item: releaseToMyWorkQueueItem(release), updated_at: release.updated_at })),
    ]
      .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
      .map(({ item }) => item),
    degraded_sources: [],
  };
}

export async function listRequirements(repository: DeliveryRepository, query: ProductListQuery): Promise<{ items: RequirementListItem[] }> {
  const [workItems, context] = await Promise.all([
    typedWorkItemsForQuery(repository, query, 'requirement'),
    typedDocumentProjectionContext(repository, query.project_id),
  ]);
  return { items: workItems.map((workItem) => workItemToRequirementListItem(workItem, typedDocumentProjection(workItem, context))) };
}

export async function getRequirementDetail(repository: DeliveryRepository, requirementId: string): Promise<RequirementDetail | undefined> {
  const workItem = await typedWorkItemById(repository, requirementId, 'requirement');
  if (workItem === undefined) {
    return undefined;
  }
  const context = await typedDocumentProjectionContext(repository, workItem.project_id);
  return workItemToRequirementDetail(workItem, typedDocumentProjection(workItem, context), await sourceRelationshipRefs(repository, workItem));
}

export async function listInitiatives(repository: DeliveryRepository, query: ProductListQuery): Promise<{ items: InitiativeListItem[] }> {
  const [workItems, context] = await Promise.all([
    typedWorkItemsForQuery(repository, query, 'initiative'),
    typedDocumentProjectionContext(repository, query.project_id),
  ]);
  return { items: workItems.map((workItem) => workItemToInitiativeListItem(workItem, typedDocumentProjection(workItem, context))) };
}

export async function getInitiativeDetail(repository: DeliveryRepository, initiativeId: string): Promise<InitiativeDetail | undefined> {
  const workItem = await typedWorkItemById(repository, initiativeId, 'initiative');
  if (workItem === undefined) {
    return undefined;
  }
  const context = await typedDocumentProjectionContext(repository, workItem.project_id);
  return workItemToInitiativeDetail(workItem, typedDocumentProjection(workItem, context), await sourceRelationshipRefs(repository, workItem));
}

export async function listTechDebt(repository: DeliveryRepository, query: ProductListQuery): Promise<{ items: TechDebtListItem[] }> {
  const [workItems, context] = await Promise.all([
    typedWorkItemsForQuery(repository, query, 'tech_debt'),
    typedDocumentProjectionContext(repository, query.project_id),
  ]);
  return { items: workItems.map((workItem) => workItemToTechDebtListItem(workItem, typedDocumentProjection(workItem, context))) };
}

export async function getTechDebtDetail(repository: DeliveryRepository, techDebtId: string): Promise<TechDebtDetail | undefined> {
  const workItem = await typedWorkItemById(repository, techDebtId, 'tech_debt');
  if (workItem === undefined) {
    return undefined;
  }
  const context = await typedDocumentProjectionContext(repository, workItem.project_id);
  return workItemToTechDebtDetail(workItem, typedDocumentProjection(workItem, context), await sourceRelationshipRefs(repository, workItem));
}

export async function listBugs(repository: DeliveryRepository, query: ProductListQuery): Promise<{ items: BugListItem[] }> {
  const [workItems, context] = await Promise.all([
    typedWorkItemsForQuery(repository, query, 'bug'),
    typedDocumentProjectionContext(repository, query.project_id),
  ]);
  return { items: workItems.map((workItem) => workItemToBugListItem(workItem, typedDocumentProjection(workItem, context))) };
}

export async function getBugDetail(repository: DeliveryRepository, bugId: string): Promise<BugDetail | undefined> {
  const workItem = await typedWorkItemById(repository, bugId, 'bug');
  if (workItem === undefined) {
    return undefined;
  }
  const context = await typedDocumentProjectionContext(repository, workItem.project_id);
  return workItemToBugDetail(workItem, typedDocumentProjection(workItem, context), await sourceRelationshipRefs(repository, workItem));
}

export async function getReleaseReadinessDetail(
  repository: DeliveryRepository,
  releaseId: string,
  options: { project_id?: string } = {},
): Promise<ReleaseReadinessDetail | undefined> {
  const release = await repository.getRelease(releaseId);
  if (release === undefined || (options.project_id !== undefined && release.project_id !== options.project_id)) {
    return undefined;
  }
  const scopeRefs = releaseScopeRefs(release);
  const evidence = await repository.listReleaseEvidences(releaseId);
  const revisionAuthority = releaseRevisionAuthority(release);
  const disabledReasons: ProductSafeDisabledReason[] = [];
  recordWrongScopeEvidence(evidence, scopeRefs, disabledReasons);
  const reviewGates = scopeRefs.map((scopeRef) => reviewGateFor(scopeRef, evidence, disabledReasons, revisionAuthority));
  const testGates = scopeRefs.map((scopeRef) => testGateFor(scopeRef, evidence, disabledReasons, revisionAuthority));
  const detail: ReleaseReadinessDetail = {
    release_id: release.id,
    scope_refs: scopeRefs,
    required_review_evidence: reviewGates,
    required_test_acceptance_evidence: testGates,
    package_run_evidence: [],
    observation_evidence: [],
    ready: disabledReasons.length === 0 && reviewGates.every((gate) => gate.status === 'passed') && testGates.every((gate) => gate.status === 'passed'),
    disabled_reasons: uniqueDisabledReasons(disabledReasons),
  };

  return releaseReadinessDetailSchema.parse(detail);
}

export async function getDashboard(
  repository: DeliveryRepository,
  query: AiNativeQuery,
): Promise<Record<string, unknown>> {
  const [workItems, developmentPlanItems, executions, codeReviews, qaHandoffs, releases] = await Promise.all([
    repository.listWorkItems(query.project_id),
    listDevelopmentPlanItemsForProject(repository, query.project_id),
    listExecutionsForProject(repository, query.project_id),
    listCodeReviewHandoffsForProject(repository, query.project_id),
    listQaHandoffsForProject(repository, query.project_id),
    repository.listReleases(query.project_id),
  ]);
  const blockedItemCount = developmentPlanItems.filter(({ item }) => isDevelopmentPlanItemBlocked(item)).length;
  const interruptedCount = executions.filter(({ execution }) => execution.status === 'interrupted' || execution.status === 'paused').length;
  const qaBlockedCount = qaHandoffs.filter(({ handoff }) => handoff.status === 'blocked').length;

  return {
    project_id: query.project_id,
    sections: [
      dashboardSection('flow-health', 'Flow Health', developmentPlanItems.length, [
        { label: 'Typed documents', value: workItems.length },
        { label: 'Development Plan Items', value: developmentPlanItems.length },
        { label: 'Executions', value: executions.length },
      ]),
      dashboardSection('blocked-work', 'Blocked Work', blockedItemCount + interruptedCount + qaBlockedCount, [
        { label: 'Blocked items', value: blockedItemCount },
        { label: 'Interrupted executions', value: interruptedCount },
        { label: 'Blocked QA handoffs', value: qaBlockedCount },
      ]),
      dashboardSection('aging', 'Aging', agingScore(developmentPlanItems), [
        { label: 'Specs waiting review', value: developmentPlanItems.filter(({ item }) => item.spec_status === 'in_review').length },
        {
          label: 'Implementation Plan Docs waiting review',
          value: developmentPlanItems.filter(({ item }) => item.implementation_plan_status === 'in_review').length,
        },
      ]),
      dashboardSection('role-load', 'Role Load', developmentPlanItems.length, roleLoadMetrics(developmentPlanItems)),
      dashboardSection('release-confidence', 'Release Confidence', releases.length, [
        { label: 'Releases', value: releases.length },
        { label: 'QA accepted', value: qaHandoffs.filter(({ handoff }) => handoff.status === 'accepted').length },
      ]),
    ],
    next_actions: dashboardCommandActions({
      developmentPlanItems,
      executions,
      codeReviews,
      qaHandoffs,
    }),
    runtime_signals: dashboardRuntimeSignals(executions),
    report_links: reportLinks(),
    degraded_sources: [],
  };
}

export async function listDevelopmentPlanProjections(
  repository: DeliveryRepository,
  query: ProductListQuery,
): Promise<Record<string, unknown>> {
  const [plans, roleContext] = await Promise.all([
    repository.listDevelopmentPlans(query.project_id),
    typedDocumentProjectionContext(repository, query.project_id),
  ]);
  const visiblePlans = plans.filter((plan) => developmentPlanMatchesQuery(plan, query, roleContext));
  const rows = await Promise.all(
    visiblePlans.map(async (plan) => {
      const items = await repository.listDevelopmentPlanItems(plan.id);
      const responsibleRoles = uniqueStrings(items.map((item) => item.responsible_role));
      const driverActorIds = uniqueStrings(compactStrings(items.map((item) => item.driver_actor_id)));
      const reviewerActorIds = uniqueStrings(compactStrings(items.map((item) => item.reviewer_actor_id)));
      const gateStates = uniqueStrings(items.map(currentDevelopmentPlanItemGate));
      const risks = uniqueStrings(items.map((item) => item.risk));
      const releaseImpacts = uniqueStrings(items.map((item) => item.release_impact));
      return {
        id: plan.id,
        object_ref: developmentPlanRef(plan),
        title: plan.title,
        status: plan.status,
        source_refs: plan.source_refs,
        item_count: items.length,
        blocked_count: items.filter(isDevelopmentPlanItemBlocked).length,
        responsible_role: responsibleRoles.length === 1 ? responsibleRoles[0] : 'mixed',
        responsible_roles: responsibleRoles,
        driver_actor_id: driverActorIds.length === 1 ? driverActorIds[0] : undefined,
        driver_actor_ids: driverActorIds,
        reviewer_actor_id: reviewerActorIds.length === 1 ? reviewerActorIds[0] : undefined,
        reviewer_actor_ids: reviewerActorIds,
        gate_state: gateStates.length === 1 ? gateStates[0] : 'mixed',
        gate_states: gateStates,
        risk: highestRisk(risks),
        risks,
        release_impact: releaseImpacts.length === 1 ? releaseImpacts[0] : undefined,
        release_impacts: releaseImpacts,
        href: `/development-plans/${plan.id}`,
        updated_at: plan.updated_at,
      };
    }),
  );

  return {
    items: rows.sort((left, right) => String(right.updated_at).localeCompare(String(left.updated_at))),
    degraded_sources: [],
  };
}

export async function getDevelopmentPlanProjection(
  repository: DeliveryRepository,
  developmentPlanId: string,
): Promise<Record<string, unknown> | undefined> {
  const plan = await repository.getDevelopmentPlan(developmentPlanId);
  if (plan === undefined) {
    return undefined;
  }
  const [items, revisions, sourceLinks] = await Promise.all([
    repository.listDevelopmentPlanItems(plan.id),
    repository.listDevelopmentPlanRevisions(plan.id),
    repository.listDevelopmentPlanSourceLinks(plan.id),
  ]);
  return {
    id: plan.id,
    object_ref: developmentPlanRef(plan),
    title: plan.title,
    status: plan.status,
    source_refs: plan.source_refs,
    source_links: sourceLinks,
    revisions,
    items: items.map((item) => developmentPlanItemQueueRow(plan, item)),
    href: `/development-plans/${plan.id}`,
    updated_at: plan.updated_at,
  };
}

export async function getDevelopmentPlanItemProjection(
  repository: DeliveryRepository,
  developmentPlanId: string,
  itemId: string,
): Promise<Record<string, unknown> | undefined> {
  const [plan, item] = await Promise.all([repository.getDevelopmentPlan(developmentPlanId), repository.getDevelopmentPlanItem(itemId)]);
  if (plan === undefined || item === undefined || item.development_plan_id !== plan.id) {
    return undefined;
  }
  const [
    itemRevisions,
    boundaryRevisionCandidates,
    specs,
    executionPlans,
    executions,
    codeReviewHandoffs,
    qaHandoffs,
    executionPackages,
    releases,
  ] = await Promise.all([
    repository.listDevelopmentPlanItemRevisions(item.id),
    listBoundarySummaryRevisionsForItem(repository, item.id),
    repository.listSpecs(plan.project_id),
    repository.listExecutionPlansForDevelopmentPlanItem(item.id),
    listExecutionsForProject(repository, plan.project_id),
    listCodeReviewHandoffsForProject(repository, plan.project_id),
    listQaHandoffsForProject(repository, plan.project_id),
    repository.listExecutionPackages(plan.project_id),
    repository.listReleases(plan.project_id),
  ]);
  const releaseEvidence = (await Promise.all(releases.map((release) => repository.listReleaseEvidences(release.id)))).flat();
  const runtimeBoundary = planItemRuntimeBoundary(item, executionPlans, executionPackages);
  return {
    id: item.id,
    object_ref: developmentPlanItemRef(item),
    development_plan_ref: developmentPlanRef(plan),
    source_ref: item.source_ref,
    title: item.title,
    summary: item.summary,
    responsible_role: item.responsible_role,
    driver_actor_id: item.driver_actor_id,
    reviewer_actor_id: item.reviewer_actor_id,
    risk: item.risk,
    dependency_hints: item.dependency_hints,
    affected_surfaces: item.affected_surfaces,
    boundary_status: item.boundary_status,
    spec_status: item.spec_status,
    implementation_plan_status: item.implementation_plan_status,
    execution_status: item.execution_status,
    review_status: item.review_status,
    qa_handoff_status: item.qa_handoff_status,
    release_impact: item.release_impact,
    next_action: item.next_action,
    revisions: itemRevisions,
    boundary_summary_revisions: boundaryRevisionCandidates,
    specs: await Promise.all(specs.filter((spec) => spec.development_plan_item_id === item.id).map((spec) => specQueueRow(repository, plan, item, spec))),
    implementation_plan_docs: await Promise.all(executionPlans.map((executionPlan) => executionPlanQueueRow(repository, plan, item, executionPlan))),
    executions: await Promise.all(
      executions
        .filter(({ execution }) => execution.development_plan_item_id === item.id)
        .map(({ execution }) => executionQueueRow(repository, plan, item, execution)),
    ),
    code_review_handoffs: codeReviewHandoffs
      .filter(({ handoff }) => handoff.development_plan_item_id === item.id)
      .map(({ handoff, execution }) => codeReviewHandoffItemRow(execution, handoff)),
    qa_handoffs: qaHandoffs
      .filter(({ handoff }) => handoff.development_plan_item_id === item.id)
      .map(({ handoff }) => qaHandoffQueueRow(plan, item, handoff)),
    runtime_boundary: runtimeBoundary,
    release_context: planItemReleaseContext(item, runtimeBoundary, executionPackages, releases, releaseEvidence),
    compare_links: {
      item_revisions_href: `/development-plans/${plan.id}/items/${item.id}/revisions/compare`,
      boundary_summary_revisions_href: boundaryRevisionCandidates[0]
        ? `/boundary-summaries/${boundaryRevisionCandidates[0].boundary_summary_id}/revisions/compare`
        : undefined,
    },
    href: `/development-plans/${plan.id}/items/${item.id}`,
    updated_at: item.updated_at,
  };
}

export async function listSpecsExecutionPlans(
  repository: DeliveryRepository,
  query: AiNativeQuery,
): Promise<Record<string, unknown>> {
  const planItems = await listDevelopmentPlanItemsForProject(repository, query.project_id);
  const specs = await repository.listSpecs(query.project_id);
  const rows: Record<string, unknown>[] = [];
  for (const { plan, item } of planItems) {
    rows.push(...await Promise.all(specs.filter((spec) => spec.development_plan_item_id === item.id).map((spec) => specQueueRow(repository, plan, item, spec))));
    for (const executionPlan of await repository.listExecutionPlansForDevelopmentPlanItem(item.id)) {
      rows.push(await executionPlanQueueRow(repository, plan, item, executionPlan));
    }
  }
  return { items: rows.sort(byUpdatedAtDesc), degraded_sources: [] };
}

export async function listExecutionQueue(
  repository: DeliveryRepository,
  query: AiNativeQuery,
): Promise<Record<string, unknown>> {
  const executions = await listExecutionsForProject(repository, query.project_id);
  const rows = await Promise.all(
    executions.map(({ execution, plan, item }) => executionQueueRow(repository, plan, item, execution)),
  );
  return {
    items: rows.sort(byUpdatedAtDesc),
    degraded_sources: [],
  };
}

export async function listCodeReviewHandoffQueue(
  repository: DeliveryRepository,
  query: AiNativeQuery,
): Promise<Record<string, unknown>> {
  const reviews = (await listCodeReviewHandoffsForProject(repository, query.project_id)).filter(
    ({ handoff }) => query.execution_id === undefined || handoff.execution_id === query.execution_id,
  );
  const rows = await Promise.all(
    reviews.map(async ({ handoff, execution, plan, item }) => ({
      ...codeReviewHandoffQueueRow(plan, item, execution, handoff),
      qa_handoff_available: (await repository.listQaHandoffsForCodeReview(handoff.id)).length === 0,
    })),
  );
  return { items: rows.sort(byUpdatedAtDesc), degraded_sources: [] };
}

export async function listQaHandoffQueue(
  repository: DeliveryRepository,
  query: AiNativeQuery,
): Promise<Record<string, unknown>> {
  const handoffs = (await listQaHandoffsForProject(repository, query.project_id)).filter(
    ({ handoff }) => query.execution_id === undefined || handoff.execution_id === query.execution_id,
  );
  return {
    items: handoffs.map(({ handoff, plan, item }) => qaHandoffQueueRow(plan, item, handoff)).sort(byUpdatedAtDesc),
    degraded_sources: [],
  };
}

export async function listBoardCards(repository: DeliveryRepository, query: ProductListQuery): Promise<{ items: BoardCard[] }> {
  const [workItems, developmentPlanItems, executions, codeReviews, qaHandoffs, releases] = await Promise.all([
    repository.listWorkItems(query.project_id),
    listDevelopmentPlanItemsForProject(repository, query.project_id),
    listExecutionsForProject(repository, query.project_id),
    listCodeReviewHandoffsForProject(repository, query.project_id),
    listQaHandoffsForProject(repository, query.project_id),
    repository.listReleases(query.project_id),
  ]);
  return {
    items: [
      ...workItems.map(workItemToBoardCard),
      ...developmentPlanItems.map(({ plan, item }) => developmentPlanItemToBoardCard(plan, item)),
      ...executions.map(({ execution, item }) => executionToBoardCard(item, execution)),
      ...codeReviews.map(({ handoff, execution, item }) => codeReviewHandoffToBoardCard(item, execution, handoff)),
      ...qaHandoffs.map(({ handoff, item }) => qaHandoffToBoardCard(item, handoff)),
      ...releases.map(releaseToBoardCard),
    ],
  };
}

export async function getReport(
  repository: DeliveryRepository,
  reportId: string,
  query: ProductListQuery,
): Promise<Record<string, unknown>> {
  const [developmentPlanItems, executions, codeReviews, qaHandoffs, releases, workItems] = await Promise.all([
    listDevelopmentPlanItemsForProject(repository, query.project_id),
    listExecutionsForProject(repository, query.project_id),
    listCodeReviewHandoffsForProject(repository, query.project_id),
    listQaHandoffsForProject(repository, query.project_id),
    repository.listReleases(query.project_id),
    repository.listWorkItems(query.project_id),
  ]);
  const groups = reportGroupsFor(reportId, {
    developmentPlanItems,
    executions,
    codeReviews,
    qaHandoffs,
    releases,
    workItems,
  });
  return {
    id: reportId,
    project_id: query.project_id,
    groups,
    links: reportLinks(),
    degraded_sources: [],
    generated_at: latestUpdatedAt([
      ...developmentPlanItems.map(({ item }) => item.updated_at),
      ...executions.map(({ execution }) => execution.updated_at),
      ...codeReviews.map(({ handoff }) => handoff.updated_at),
      ...qaHandoffs.map(({ handoff }) => handoff.updated_at),
      ...releases.map((release) => release.updated_at),
      ...workItems.map((workItem) => workItem.updated_at),
    ]),
  };
}

async function listDevelopmentPlanItemsForProject(
  repository: DeliveryRepository,
  projectId: string,
): Promise<DevelopmentPlanItemWithPlan[]> {
  const plans = await repository.listDevelopmentPlans(projectId);
  const rows = await Promise.all(
    plans.map(async (plan) => (await repository.listDevelopmentPlanItems(plan.id)).map((item) => ({ plan, item }))),
  );
  return rows.flat().sort((left, right) => right.item.updated_at.localeCompare(left.item.updated_at) || left.item.id.localeCompare(right.item.id));
}

async function listExecutionPlansForProject(repository: DeliveryRepository, projectId: string): Promise<ExecutionPlanWithContext[]> {
  const itemContexts = await listDevelopmentPlanItemsForProject(repository, projectId);
  const rows = await Promise.all(
    itemContexts.map(async ({ plan, item }) =>
      (await repository.listExecutionPlansForDevelopmentPlanItem(item.id)).map((executionPlan) => ({ executionPlan, plan, item })),
    ),
  );
  return rows.flat().sort((left, right) => right.executionPlan.updated_at.localeCompare(left.executionPlan.updated_at));
}

async function listExecutionsForProject(repository: DeliveryRepository, projectId: string): Promise<ExecutionWithContext[]> {
  const executions = await repository.listExecutions();
  const rows: ExecutionWithContext[] = [];
  for (const execution of executions) {
    const context = await itemContextFor(repository, execution.development_plan_item_id);
    if (context !== undefined && context.plan.project_id === projectId) {
      rows.push({ execution, ...context });
    }
  }
  return rows.sort((left, right) => right.execution.updated_at.localeCompare(left.execution.updated_at));
}

async function listCodeReviewHandoffsForProject(repository: DeliveryRepository, projectId: string): Promise<CodeReviewWithContext[]> {
  const handoffs = await repository.listCodeReviewHandoffs();
  const rows: CodeReviewWithContext[] = [];
  for (const handoff of handoffs) {
    const execution = await repository.getExecution(handoff.execution_id);
    const context = await itemContextFor(repository, handoff.development_plan_item_id);
    if (execution !== undefined && context !== undefined && context.plan.project_id === projectId) {
      rows.push({ handoff, execution, ...context });
    }
  }
  return rows.sort((left, right) => right.handoff.updated_at.localeCompare(left.handoff.updated_at));
}

async function listQaHandoffsForProject(repository: DeliveryRepository, projectId: string): Promise<QaWithContext[]> {
  const handoffs = await repository.listQaHandoffs();
  const rows: QaWithContext[] = [];
  for (const handoff of handoffs) {
    const context = await itemContextFor(repository, handoff.development_plan_item_id);
    if (context !== undefined && context.plan.project_id === projectId) {
      rows.push({ handoff, ...context });
    }
  }
  return rows.sort((left, right) => right.handoff.updated_at.localeCompare(left.handoff.updated_at));
}

function dashboardCommandActions({
  codeReviews,
  developmentPlanItems,
  executions,
  qaHandoffs,
}: {
  codeReviews: readonly CodeReviewWithContext[];
  developmentPlanItems: readonly DevelopmentPlanItemWithPlan[];
  executions: readonly ExecutionWithContext[];
  qaHandoffs: readonly QaWithContext[];
}): DashboardCommandAction[] {
  const releaseBlockers = developmentPlanItems
    .filter(({ item }) => item.release_impact === 'release_blocking' && isDevelopmentPlanItemBlocked(item))
    .map(({ item, plan }) =>
      dashboardDevelopmentPlanItemAction({
        id: `release-blocker:${item.id}`,
        item,
        kind: 'release_blocker',
        label: item.title,
        next_action: item.next_action,
        plan,
        severity: 'critical',
        stage_id: 'release',
      }),
    );
  const reviewChanges = codeReviews
    .filter(({ handoff }) => handoff.status === 'changes_requested')
    .map(({ handoff, item, plan }) =>
      dashboardDevelopmentPlanItemAction({
        id: `code-review:${handoff.id}`,
        item,
        kind: 'code_review_changes',
        label: handoff.ref.title ?? `${item.title} code review`,
        next_action: handoff.decision_rationale ?? handoff.summary,
        plan,
        severity: 'high',
        stage_id: 'code_review',
      }),
    );
  const qaBlockers = qaHandoffs
    .filter(({ handoff }) => handoff.status === 'blocked' || handoff.status === 'pending')
    .map(({ handoff, item, plan }) =>
      dashboardDevelopmentPlanItemAction({
        id: `qa:${handoff.id}`,
        item,
        kind: 'qa_blocker',
        label: handoff.ref.title ?? `${item.title} QA handoff`,
        next_action: handoff.rationale ?? handoff.known_risks[0] ?? handoff.test_strategy,
        plan,
        severity: handoff.status === 'blocked' ? 'high' : 'medium',
        stage_id: 'qa',
      }),
    );
  const missingSpecApprovals = developmentPlanItems
    .filter(({ item }) => item.spec_status === 'blocked' || item.spec_status === 'changes_requested' || item.spec_status === 'in_review')
    .map(({ item, plan }) =>
      dashboardDevelopmentPlanItemAction({
        id: `spec:${item.id}`,
        item,
        kind: 'missing_spec_approval',
        label: item.title,
        next_action: item.next_action,
        plan,
        severity: item.spec_status === 'in_review' ? 'medium' : 'high',
        stage_id: 'spec',
      }),
    );
  const missingImplementationPlanDocApprovals = developmentPlanItems
    .filter(({ item }) =>
      item.implementation_plan_status === 'blocked' ||
      item.implementation_plan_status === 'changes_requested' ||
      item.implementation_plan_status === 'in_review',
    )
    .map(({ item, plan }) =>
      dashboardDevelopmentPlanItemAction({
        id: `implementation-plan-doc:${item.id}`,
        item,
        kind: 'missing_implementation_plan_doc_approval',
        label: item.title,
        next_action: item.next_action,
        plan,
        severity: item.implementation_plan_status === 'in_review' ? 'medium' : 'high',
        stage_id: 'implementation_plan_doc',
      }),
    );
  const resumableExecutions = executions
    .filter(({ execution }) => execution.status === 'interrupted' || execution.status === 'paused')
    .map(({ execution, item, plan }) =>
      dashboardDevelopmentPlanItemAction({
        href: `/executions/${execution.id}`,
        id: `execution:${execution.id}`,
        item,
        kind: 'resumable_execution',
        label: execution.ref.title ?? `${item.title} execution`,
        next_action: execution.current_step ?? executionLastEventSummary(execution),
        plan,
        runtime: { execution_id: execution.id, resumable: true, state: execution.status },
        severity: 'medium',
        stage_id: 'execution',
      }),
    );

  return uniqueDashboardActions([
    ...releaseBlockers,
    ...reviewChanges,
    ...qaBlockers,
    ...missingSpecApprovals,
      ...missingImplementationPlanDocApprovals,
    ...resumableExecutions,
  ]).slice(0, 7);
}

function dashboardRuntimeSignals(executions: readonly ExecutionWithContext[]): DashboardRuntimeSignal[] {
  return executions
    .filter(({ execution }) => execution.status === 'interrupted' || execution.status === 'paused' || execution.status === 'running')
    .map(({ execution, item }) => ({
      execution_id: execution.id,
      href: `/executions/${execution.id}`,
      label: execution.ref.title ?? `${item.title} execution`,
      resumable: execution.status === 'interrupted' || execution.status === 'paused',
      state: execution.status,
    }))
    .slice(0, 4);
}

function dashboardDevelopmentPlanItemAction({
  href,
  id,
  item,
  kind,
  label,
  next_action,
  plan,
  runtime,
  severity,
  stage_id,
}: {
  href?: string;
  id: string;
  item: DevelopmentPlanItem;
  kind: DashboardCommandAction['kind'];
  label: string;
  next_action: string;
  plan: DevelopmentPlan;
  runtime?: DashboardCommandAction['runtime'];
  severity: DashboardCommandAction['severity'];
  stage_id: DashboardCommandAction['stage_id'];
}): DashboardCommandAction {
  return {
    href: href ?? `/development-plans/${plan.id}/items/${item.id}`,
    id,
    kind,
    label,
    next_action,
    severity,
    stage_id,
    typed_ref: developmentPlanItemRef(item),
    ...(runtime === undefined ? {} : { runtime }),
  };
}

function uniqueDashboardActions(actions: readonly DashboardCommandAction[]): DashboardCommandAction[] {
  const seen = new Set<string>();
  const uniqueActions: DashboardCommandAction[] = [];
  for (const action of actions) {
    const key = `${action.kind}:${action.typed_ref.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueActions.push(action);
  }
  return uniqueActions;
}

async function itemContextFor(
  repository: DeliveryRepository,
  developmentPlanItemId: string,
): Promise<{ plan: DevelopmentPlan; item: DevelopmentPlanItem } | undefined> {
  const item = await repository.getDevelopmentPlanItem(developmentPlanItemId);
  if (item === undefined) {
    return undefined;
  }
  const plan = await repository.getDevelopmentPlan(item.development_plan_id);
  return plan === undefined ? undefined : { plan, item };
}

async function listBoundarySummaryRevisionsForItem(repository: DeliveryRepository, itemId: string) {
  const summaries = (await repository.listBoundarySummaries()).filter((summary) => summary.development_plan_item_id === itemId);
  const revisions = await Promise.all(summaries.map((summary) => repository.listBoundarySummaryRevisions(summary.id)));
  return revisions.flat();
}

function developmentPlanRef(plan: DevelopmentPlan) {
  return { type: 'development_plan' as const, id: plan.id, revision_id: plan.revision_id, title: plan.title };
}

function developmentPlanItemRef(item: DevelopmentPlanItem) {
  return {
    type: 'development_plan_item' as const,
    id: item.id,
    development_plan_id: item.development_plan_id,
    revision_id: item.revision_id,
    title: item.title,
  };
}

function executionPlanRevisionRef(executionPlan: ExecutionPlanDocument, revision?: ExecutionPlanRevision) {
  return {
    type: 'implementation_plan_revision' as const,
    id: revision?.id ?? executionPlan.approved_revision_id ?? executionPlan.current_revision_id ?? executionPlan.id,
    implementation_plan_id: executionPlan.id,
    title: revision?.summary,
  };
}

function developmentPlanItemQueueRow(plan: DevelopmentPlan, item: DevelopmentPlanItem) {
  return {
    id: item.id,
    object_ref: developmentPlanItemRef(item),
    development_plan_ref: developmentPlanRef(plan),
    source_ref: item.source_ref,
    title: item.title,
    responsible_role: item.responsible_role,
    driver_actor_id: item.driver_actor_id,
    reviewer_actor_id: item.reviewer_actor_id,
    risk: item.risk,
    status: item.next_action,
    boundary_status: item.boundary_status,
    spec_status: item.spec_status,
    implementation_plan_status: item.implementation_plan_status,
    execution_status: item.execution_status,
    review_status: item.review_status,
    qa_handoff_status: item.qa_handoff_status,
    stale: item.spec_status === 'stale' || item.implementation_plan_status === 'stale' || item.boundary_status === 'stale',
    blocked: isDevelopmentPlanItemBlocked(item),
    next_action: item.next_action,
    href: `/development-plans/${plan.id}/items/${item.id}`,
    updated_at: item.updated_at,
  };
}

async function specQueueRow(repository: DeliveryRepository, plan: DevelopmentPlan, item: DevelopmentPlanItem, spec: Spec): Promise<Record<string, unknown>> {
  const revisionId = spec.approved_revision_id ?? spec.current_revision_id;
  const revision = revisionId === undefined ? undefined : await repository.getSpecRevision(revisionId);
  return {
    id: spec.id,
    object_ref: { type: 'spec' as const, id: spec.id, title: `${item.title} Spec` },
    artifact_type: 'spec',
    source_ref: item.source_ref,
    development_plan_item_ref: developmentPlanItemRef(item),
    reviewer_actor_id: spec.approved_by_actor_id ?? item.reviewer_actor_id,
    age_seconds: ageSeconds(spec.created_at, spec.updated_at),
    risk: item.risk,
    status: spec.status,
    gate_state: spec.gate_state,
    current_revision_id: spec.current_revision_id,
    approved_revision_id: spec.approved_revision_id,
    acceptance_criteria: revision?.acceptance_criteria,
    qa_owner_actor_id: revision?.qa_owner_actor_id,
    test_owner_actor_id: revision?.test_owner_actor_id,
    testability_note: revision?.testability_note,
    test_strategy_summary: revision?.test_strategy_summary,
    risk_scenarios: revision?.risk_scenarios,
    stale: item.spec_status === 'stale',
    blocked: item.spec_status === 'blocked',
    next_action: item.spec_status === 'approved' ? 'generate_implementation_plan_doc' : 'review_spec',
    href: `/development-plans/${plan.id}/items/${item.id}`,
    updated_at: spec.updated_at,
  };
}

async function executionPlanQueueRow(
  repository: DeliveryRepository,
  plan: DevelopmentPlan,
  item: DevelopmentPlanItem,
  executionPlan: ExecutionPlanDocument,
): Promise<Record<string, unknown>> {
  const revision =
    executionPlan.approved_revision_id === undefined
      ? undefined
      : await repository.getExecutionPlanRevision(executionPlan.approved_revision_id);
  return {
    id: executionPlan.id,
    object_ref: { type: 'implementation_plan_doc' as const, id: executionPlan.id, title: revision?.summary ?? `${item.title} Implementation Plan Doc` },
    artifact_type: 'implementation_plan_doc',
    source_ref: item.source_ref,
    development_plan_item_ref: developmentPlanItemRef(item),
    reviewer_actor_id: executionPlan.approved_by_actor_id ?? item.reviewer_actor_id,
    age_seconds: ageSeconds(executionPlan.created_at, executionPlan.updated_at),
    risk: item.risk,
    status: executionPlan.status,
    current_revision_id: executionPlan.current_revision_id,
    approved_revision_id: executionPlan.approved_revision_id,
    approved_revision_ref: revision === undefined ? undefined : executionPlanRevisionRef(executionPlan, revision),
    stale: item.implementation_plan_status === 'stale',
    blocked: item.implementation_plan_status === 'blocked',
    next_action: executionPlan.status === 'approved' ? 'start_execution' : 'review_implementation_plan_doc',
    href: `/development-plans/${plan.id}/items/${item.id}`,
    updated_at: executionPlan.updated_at,
  };
}

async function executionRuntimeEvidence(
  repository: DeliveryRepository,
  execution: Execution,
): Promise<ExecutionRuntimeEvidenceProjection | undefined> {
  const runSessionRef = execution.runtime_evidence_refs.find((ref) => ref.type === 'run_session');
  if (runSessionRef === undefined) {
    return undefined;
  }
  const runSession = await repository.getRunSession(runSessionRef.id);
  if (runSession === undefined) {
    return undefined;
  }

  const rawMetadata = isRecord(runSession.executor_result?.raw_metadata) ? runSession.executor_result.raw_metadata : undefined;
  const runtimeMetadata = isRecord(runSession.runtime_metadata) ? runSession.runtime_metadata : undefined;
  const workspaceBundleDigest =
    stringValue(rawMetadata, 'workspace_bundle_digest') ?? stringValue(runtimeMetadata, 'remote_workspace_bundle_digest');
  const workspaceBundleManifestDigest =
    stringValue(rawMetadata, 'workspace_bundle_manifest_digest') ?? stringValue(runtimeMetadata, 'remote_workspace_manifest_digest');
  const mountedTaskWorkspaceDigest = stringValue(rawMetadata, 'mounted_task_workspace_digest');
  const changedFiles = runSession.changed_files.map((file) => file.path).filter((path) => path.trim().length > 0);

  if (workspaceBundleDigest === undefined || mountedTaskWorkspaceDigest === undefined) {
    return undefined;
  }

  return {
    workspace_bundle_digest: workspaceBundleDigest,
    ...(workspaceBundleManifestDigest === undefined ? {} : { workspace_bundle_manifest_digest: workspaceBundleManifestDigest }),
    mounted_task_workspace_digest: mountedTaskWorkspaceDigest,
    changed_files: changedFiles,
  };
}

async function executionQueueRow(
  repository: DeliveryRepository,
  plan: DevelopmentPlan,
  item: DevelopmentPlanItem,
  execution: Execution,
): Promise<Record<string, unknown>> {
  const blocked = execution.blocked === true || execution.status === 'failed';
  const interrupted = !blocked && (execution.status === 'interrupted' || execution.status === 'paused');
  const runtimeEvidence = await executionRuntimeEvidence(repository, execution);
  return {
    id: execution.id,
    object_ref: execution.ref,
    source_ref: item.source_ref,
    development_plan_item_ref: developmentPlanItemRef(item),
    implementation_plan_revision_id: execution.implementation_plan_revision_id,
    implementation_plan_revision_ref: execution.implementation_plan_revision_ref,
    status: execution.status,
    worker_state: execution.worker_state ?? execution.status,
    current_step: execution.current_step ?? executionCurrentStep(execution),
    stale: execution.stale ?? false,
    blocked,
    last_event_at: execution.last_event_at ?? execution.updated_at,
    last_event_summary: roleSafeActorText(execution.last_event_summary ?? executionLastEventSummary(execution)),
    evidence_refs: execution.evidence_refs,
    pr_refs: execution.pr_refs,
    diff_refs: execution.diff_refs,
    test_evidence_refs: execution.test_evidence_refs,
    runtime_evidence_refs: execution.runtime_evidence_refs,
    ...(runtimeEvidence === undefined ? {} : { runtime_evidence: runtimeEvidence }),
    actions: [
      ...(interrupted
        ? [
            {
              id: 'continue',
              href: `/executions/${execution.id}`,
              label: 'Continue',
              command: { type: 'continue_execution', execution_id: execution.id },
            },
          ]
        : []),
      { id: 'inspect', href: `/executions/${execution.id}`, label: 'Inspect' },
    ],
    href: `/executions/${execution.id}`,
    plan_item_href: `/development-plans/${plan.id}/items/${item.id}`,
    updated_at: execution.updated_at,
  };
}

function executionCurrentStep(execution: Execution): string {
  if (execution.status === 'completed') return 'code_review_handoff';
  if (execution.status === 'awaiting_code_review') return 'code_review_handoff';
  if (execution.status === 'qa_handoff_pending') return 'qa_handoff';
  if (execution.status === 'interrupted' || execution.status === 'paused') return 'continuation';
  if (execution.status === 'failed' || execution.blocked === true) return 'blocked_execution';
  return 'implementation';
}

function executionLastEventSummary(execution: Execution): string {
  const events = [
    ...execution.interrupt_history.map((entry) => ({ at: entry.at, text: entry.reason ?? 'Execution interrupted.' })),
    ...execution.continuation_history.map((entry) => ({ at: entry.at, text: entry.summary ?? 'Execution continued.' })),
  ].sort((left, right) => timestamp(right.at) - timestamp(left.at));
  return roleSafeActorText(events[0]?.text ?? `Execution ${execution.status}.`);
}

function timestamp(value: string | undefined): number {
  if (value === undefined) return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function roleSafeActorText(value: string): string {
  return value.replace(/\bactor-[a-z0-9-]+\b/gi, 'assigned operator');
}

function codeReviewHandoffQueueRow(
  plan: DevelopmentPlan,
  item: DevelopmentPlanItem,
  execution: Execution,
  handoff: CodeReviewHandoff,
): Record<string, unknown> {
  return {
    id: handoff.id,
    object_ref: handoff.ref,
    execution_id: handoff.execution_id,
    execution_ref: execution.ref,
    development_plan_item_ref: developmentPlanItemRef(item),
    reviewer_actor_id: handoff.reviewer_actor_id,
    status: handoff.status,
    decision: handoff.status,
    summary: handoff.summary,
    changed_surfaces: handoff.changed_surfaces,
    blocking_comments: handoff.status === 'changes_requested' ? [handoff.decision_rationale ?? handoff.summary] : [],
    verification_evidence_refs: handoff.verification_evidence_refs,
    href: `/executions/${execution.id}`,
    plan_item_href: `/development-plans/${plan.id}/items/${item.id}`,
    updated_at: handoff.updated_at,
  };
}

function codeReviewHandoffItemRow(execution: Execution, handoff: CodeReviewHandoff): Record<string, unknown> {
  return {
    id: handoff.id,
    title: handoff.ref.title ?? `${execution.ref.title ?? execution.id} code review`,
    status: handoff.status,
    execution_id: execution.id,
    reviewer_actor_id: handoff.reviewer_actor_id,
    audited_exception: handoff.audited_exception,
    href: `/executions/${execution.id}`,
    updated_at: handoff.updated_at,
  };
}

function qaHandoffQueueRow(plan: DevelopmentPlan, item: DevelopmentPlanItem, handoff: QaHandoff): Record<string, unknown> {
  return {
    id: handoff.id,
    object_ref: handoff.ref,
    code_review_handoff_id: handoff.code_review_handoff_id,
    execution_id: handoff.execution_id,
    source_ref: handoff.source_ref,
    development_plan_item_ref: developmentPlanItemRef(item),
    approved_spec_revision_ref: handoff.approved_spec_revision_ref,
    approved_implementation_plan_revision_ref: handoff.approved_implementation_plan_revision_ref,
    acceptance_criteria: handoff.acceptance_criteria,
    test_strategy: handoff.test_strategy,
    verification_evidence_refs: handoff.verification_evidence_refs,
    risk: item.risk,
    known_risks: handoff.known_risks,
    changed_surfaces: handoff.changed_surfaces,
    release_impact: handoff.release_impact,
    status: handoff.status,
    actions: qaHandoffActions(handoff),
    href: `/executions/${handoff.execution_id}`,
    plan_item_href: `/development-plans/${plan.id}/items/${item.id}`,
    updated_at: handoff.updated_at,
  };
}

function qaHandoffActions(handoff: QaHandoff): Array<Record<string, unknown>> {
  const inspect = { id: 'inspect', href: `/executions/${handoff.execution_id}`, label: 'Inspect' };
  if (handoff.status !== 'pending' && handoff.status !== 'blocked') {
    return [inspect];
  }
  return [
    {
      id: 'accept',
      href: `/executions/${handoff.execution_id}`,
      label: 'Accept',
      command: { type: 'accept_qa_handoff', qa_handoff_id: handoff.id },
    },
    ...(handoff.status === 'pending'
      ? [
          {
            id: 'block',
            href: `/executions/${handoff.execution_id}`,
            label: 'Block',
            command: { type: 'block_qa_handoff', qa_handoff_id: handoff.id },
          },
        ]
      : []),
    inspect,
  ];
}

function planItemRuntimeBoundary(
  item: DevelopmentPlanItem,
  executionPlans: ExecutionPlanDocument[],
  executionPackages: ExecutionPackage[],
): Record<string, unknown> | undefined {
  const approvedRevisionIds = new Set(
    executionPlans
      .flatMap((executionPlan) => [executionPlan.approved_revision_id, executionPlan.current_revision_id])
      .filter((revisionId): revisionId is string => revisionId !== undefined),
  );
  const candidates = executionPackages
    .filter((executionPackage) => executionPackage.development_plan_item_id === item.id)
    .filter((executionPackage) =>
      executionPackage.execution_plan_revision_id === undefined || approvedRevisionIds.has(executionPackage.execution_plan_revision_id),
    )
    .sort(byUpdatedAtDesc);
  const runnable = candidates.find(
    (executionPackage) =>
      executionPackage.generation_key === 'item-execution' &&
      executionPackage.phase === 'ready' &&
      executionPackage.activity_state === 'idle' &&
      executionPackage.gate_state === 'not_submitted',
  );
  const selected = runnable ?? candidates[0];
  if (selected === undefined) {
    return undefined;
  }
  return {
    type: 'execution_package' as const,
    id: selected.id,
    phase: selected.phase,
    activity_state: selected.activity_state,
    gate_state: selected.gate_state,
    implementation_plan_revision_id: selected.execution_plan_revision_id,
  };
}

function planItemReleaseContext(
  item: DevelopmentPlanItem,
  runtimeBoundary: Record<string, unknown> | undefined,
  executionPackages: ExecutionPackage[],
  releases: Release[],
  releaseEvidence: ReleaseEvidence[],
): Record<string, unknown> {
  const packageIds = new Set(
    executionPackages
      .filter((executionPackage) => executionPackage.development_plan_item_id === item.id)
      .map((executionPackage) => executionPackage.id),
  );
  const runtimeBoundaryId = stringValue(runtimeBoundary, 'id');
  if (runtimeBoundaryId !== undefined) {
    packageIds.add(runtimeBoundaryId);
  }
  const linkedReleases = releases
    .filter((release) => releaseLinksPlanItem(release, item, packageIds))
    .sort(byUpdatedAtDesc);
  const linkedReleaseIds = new Set(linkedReleases.map((release) => release.id));
  const itemEvidence = releaseEvidence
    .filter((evidence) => linkedReleaseIds.has(evidence.release_id) && releaseEvidenceLinksPlanItem(evidence, item))
    .sort(byUpdatedAtDesc);
  return {
    release_refs: linkedReleases.map((release) => ({
      type: 'release' as const,
      id: release.id,
      title: release.title,
      href: `/releases/${release.id}`,
    })),
    readiness_blockers: linkedReleases.flatMap((release) => releaseBlockerRefs(release, item)),
    evidence_refs: itemEvidence.map(planItemReleaseEvidenceRef),
    qa_test_evidence_required: item.release_impact === 'release_scoped' || item.release_impact === 'release_blocking',
  };
}

function releaseLinksPlanItem(release: Release, item: DevelopmentPlanItem, packageIds: Set<string>): boolean {
  if (release.work_item_ids.includes(item.source_ref.id) || release.execution_package_ids.some((packageId) => packageIds.has(packageId))) {
    return true;
  }
  return releaseScopeRefs(release).some((ref) => ref.type === 'development_plan_item' && ref.id === item.id);
}

function releaseEvidenceLinksPlanItem(evidence: ReleaseEvidence, item: DevelopmentPlanItem): boolean {
  const scopeRef = evidenceScopeRef(evidence);
  return scopeRef !== undefined && scopeRef.type === 'development_plan_item' && scopeRef.id === item.id;
}

function planItemReleaseEvidenceRef(evidence: ReleaseEvidence): Record<string, unknown> {
  return {
    ...typedDocumentEvidenceRef(evidence),
    evidence_type: evidence.evidence_type,
    status: evidence.status,
    summary: evidence.summary,
  };
}

function releaseBlockerRefs(release: Release, item: DevelopmentPlanItem): Array<Record<string, unknown>> {
  const values = [
    ...stringArrayValue(release.extra, 'active_blockers'),
    ...stringArrayValue(release.extra, 'release_blockers'),
    ...stringArrayValue(release.extra, 'blockers'),
  ];
  return values.map((summary, index) => ({
    code: `release_blocker_${index + 1}`,
    summary,
    release_id: release.id,
    scope_ref: developmentPlanItemRef(item),
  }));
}

function developmentPlanItemToMyWorkQueueItem(plan: DevelopmentPlan, item: DevelopmentPlanItem): MyWorkQueueItem {
  return {
    id: `development_plan_item:${item.id}`,
    object_ref: developmentPlanItemRef(item),
    title: item.title,
    attention_reason: item.next_action,
    actor_id: item.driver_actor_id,
    expected_action: item.next_action,
    href: `/development-plans/${plan.id}/items/${item.id}`,
  };
}

function developmentPlanToMyWorkQueueItem(plan: DevelopmentPlan): MyWorkQueueItem {
  return {
    id: `development_plan:${plan.id}`,
    object_ref: developmentPlanRef(plan),
    title: plan.title,
    attention_reason: `development_plan_${plan.status}`,
    expected_action: plan.status === 'draft' ? 'Review Development Plan items' : 'Inspect Development Plan',
    href: `/development-plans/${plan.id}`,
  };
}

function specToMyWorkQueueItem(spec: Spec, plan: DevelopmentPlan, item: DevelopmentPlanItem): MyWorkQueueItem {
  return {
    id: `spec:${spec.id}`,
    object_ref: { type: 'spec', id: spec.id, title: `${item.title} Spec` },
    title: `${item.title} Spec`,
    attention_reason: `spec_${spec.gate_state}`,
    actor_id: spec.approved_by_actor_id ?? item.reviewer_actor_id,
    expected_action: spec.status === 'approved' ? 'Inspect approved Spec' : 'Review Spec',
    href: `/development-plans/${plan.id}/items/${item.id}`,
  };
}

function executionPlanToMyWorkQueueItem(
  executionPlan: ExecutionPlanDocument,
  plan: DevelopmentPlan,
  item: DevelopmentPlanItem,
): MyWorkQueueItem {
  return {
    id: `implementation_plan_doc:${executionPlan.id}`,
    object_ref: { type: 'implementation_plan_doc', id: executionPlan.id, title: `${item.title} Implementation Plan Doc` },
    title: `${item.title} Implementation Plan Doc`,
    attention_reason: `implementation_plan_doc_${executionPlan.status}`,
    actor_id: executionPlan.approved_by_actor_id ?? item.reviewer_actor_id,
    expected_action: executionPlan.status === 'approved' ? 'Start execution' : 'Review Implementation Plan Doc',
    href: `/development-plans/${plan.id}/items/${item.id}`,
  };
}

function executionToMyWorkQueueItem(execution: Execution, plan: DevelopmentPlan, item: DevelopmentPlanItem): MyWorkQueueItem {
  return {
    id: `execution:${execution.id}`,
    object_ref: execution.ref,
    title: `${item.title} execution`,
    attention_reason: execution.status,
    expected_action: execution.status === 'interrupted' ? 'Continue execution' : 'Inspect execution',
    href: `/executions/${execution.id}`,
    actor_id: item.driver_actor_id,
  };
}

function qaHandoffToMyWorkQueueItem(handoff: QaHandoff, plan: DevelopmentPlan, item: DevelopmentPlanItem): MyWorkQueueItem {
  return {
    id: `qa_handoff:${handoff.id}`,
    object_ref: handoff.ref,
    title: `${item.title} QA handoff`,
    attention_reason: `qa_${handoff.status}`,
    expected_action: handoff.status === 'pending' ? 'Accept or block QA handoff' : 'Resolve QA blocker',
    href: `/executions/${handoff.execution_id}`,
    actor_id: item.driver_actor_id,
  };
}

function developmentPlanItemToBoardCard(plan: DevelopmentPlan, item: DevelopmentPlanItem): BoardCard {
  return {
    id: `development_plan_item:${item.id}`,
    object_ref: developmentPlanItemRef(item),
    title: item.title,
    column_id: item.next_action,
    status: `${item.boundary_status}/${item.spec_status}/${item.implementation_plan_status}/${item.execution_status}`,
    risk: item.risk,
    driver_actor_id: item.driver_actor_id,
    blocked: isDevelopmentPlanItemBlocked(item),
    href: `/development-plans/${plan.id}/items/${item.id}`,
  };
}

function executionToBoardCard(item: DevelopmentPlanItem, execution: Execution): BoardCard {
  return {
    id: `execution:${execution.id}`,
    object_ref: execution.ref,
    title: execution.ref.title ?? `${item.title} execution`,
    column_id: 'execution',
    status: execution.status,
    risk: item.risk,
    driver_actor_id: item.driver_actor_id,
    blocked: execution.blocked === true || execution.status === 'failed',
    href: `/executions/${execution.id}`,
  };
}

function codeReviewHandoffToBoardCard(item: DevelopmentPlanItem, execution: Execution, handoff: CodeReviewHandoff): BoardCard {
  return {
    id: `code_review_handoff:${handoff.id}`,
    object_ref: handoff.ref,
    title: handoff.ref.title ?? `${item.title} code review`,
    column_id: 'review',
    status: handoff.status,
    risk: item.risk,
    driver_actor_id: handoff.reviewer_actor_id,
    blocked: handoff.status === 'changes_requested',
    href: `/executions/${execution.id}`,
  };
}

function qaHandoffToBoardCard(item: DevelopmentPlanItem, handoff: QaHandoff): BoardCard {
  return {
    id: `qa_handoff:${handoff.id}`,
    object_ref: handoff.ref,
    title: handoff.ref.title ?? `${item.title} QA handoff`,
    column_id: 'qa',
    status: handoff.status,
    risk: item.risk,
    driver_actor_id: item.driver_actor_id,
    blocked: handoff.status === 'blocked',
    href: `/executions/${handoff.execution_id}`,
  };
}

function isDevelopmentPlanItemBlocked(item: DevelopmentPlanItem): boolean {
  return (
    item.boundary_status === 'changes_requested' ||
    item.spec_status === 'blocked' ||
    item.spec_status === 'changes_requested' ||
    item.implementation_plan_status === 'blocked' ||
    item.implementation_plan_status === 'changes_requested' ||
    item.execution_status === 'failed' ||
    item.execution_status === 'interrupted' ||
    item.review_status === 'blocked' ||
    item.review_status === 'changes_requested' ||
    item.qa_handoff_status === 'blocked' ||
    item.qa_handoff_status === 'changes_requested'
  );
}

function currentDevelopmentPlanItemGate(item: DevelopmentPlanItem): string {
  if (item.boundary_status !== 'approved') return 'boundary';
  if (item.spec_status !== 'approved') return 'spec';
  if (item.implementation_plan_status !== 'approved') return 'implementation_plan_doc';
  if (item.execution_status !== 'completed') return 'execution';
  if (item.review_status !== 'approved') return 'review';
  if (item.qa_handoff_status !== 'approved') return 'qa';
  return 'release';
}

function highestRisk(risks: string[]): string | undefined {
  const order = ['low', 'medium', 'high', 'critical'];
  return risks.reduce<string | undefined>((highest, risk) => {
    if (highest === undefined) return risk;
    return order.indexOf(risk) > order.indexOf(highest) ? risk : highest;
  }, undefined);
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

function dashboardSection(id: string, label: string, value: number, metrics: Array<{ label: string; value: number }>) {
  return {
    id,
    label,
    value,
    metrics,
    next_action: id === 'blocked-work' && value > 0 ? 'unblock' : 'inspect',
  };
}

function roleLoadMetrics(items: DevelopmentPlanItemWithPlan[]): Array<{ label: string; value: number }> {
  const counts = new Map<string, number>();
  for (const { item } of items) {
    counts.set(item.responsible_role, (counts.get(item.responsible_role) ?? 0) + 1);
  }
  return [...counts.entries()].map(([label, value]) => ({ label, value }));
}

function agingScore(items: DevelopmentPlanItemWithPlan[]): number {
  return items.filter(({ item }) => item.spec_status === 'in_review' || item.implementation_plan_status === 'in_review').length;
}

function ageSeconds(createdAt: string, updatedAt: string): number {
  const created = Date.parse(createdAt);
  const updated = Date.parse(updatedAt);
  if (Number.isNaN(created) || Number.isNaN(updated) || updated < created) {
    return 0;
  }
  return Math.floor((updated - created) / 1000);
}

function reportLinks(): Array<{ id: string; href: string }> {
  return [
    'development-plan-throughput',
    'brainstorming-bottlenecks',
    'spec-review-aging',
    'implementation-plan-doc-review-aging',
    'execution-continuation',
    'execution-outcomes',
    'code-review',
    'qa-handoff-readiness',
    'release-readiness',
    'quality-bug-escape',
  ].map((id) => ({ id, href: `/reports/${id}` }));
}

function reportGroupsFor(
  reportId: string,
  context: {
    developmentPlanItems: DevelopmentPlanItemWithPlan[];
    executions: ExecutionWithContext[];
    codeReviews: CodeReviewWithContext[];
    qaHandoffs: QaWithContext[];
    releases: Release[];
    workItems: WorkItem[];
  },
): Array<Record<string, unknown>> {
  switch (reportId) {
    case 'development-plan-throughput':
      return [
        group('draft_or_active', context.developmentPlanItems.map(developmentPlanItemReportRef)),
        group(
          'approved_items',
          context.developmentPlanItems
            .filter(({ item }) => item.implementation_plan_status === 'approved')
            .map(developmentPlanItemReportRef),
        ),
      ];
    case 'brainstorming-bottlenecks':
      return [
        group(
          'not_started',
          context.developmentPlanItems
            .filter(({ item }) => item.boundary_status === 'not_started')
            .map(developmentPlanItemReportRef),
        ),
        group(
          'changes_requested',
          context.developmentPlanItems
            .filter(({ item }) => item.boundary_status === 'changes_requested')
            .map(developmentPlanItemReportRef),
        ),
      ];
    case 'spec-review-aging':
      return [
        group(
          'in_review',
          context.developmentPlanItems
            .filter(({ item }) => item.spec_status === 'in_review')
            .map(developmentPlanItemReportRef),
        ),
        group(
          'changes_requested',
          context.developmentPlanItems
            .filter(({ item }) => item.spec_status === 'changes_requested')
            .map(developmentPlanItemReportRef),
        ),
      ];
    case 'implementation-plan-doc-review-aging':
      return [
        group(
          'in_review',
          context.developmentPlanItems
            .filter(({ item }) => item.implementation_plan_status === 'in_review')
            .map(developmentPlanItemReportRef),
        ),
        group(
          'changes_requested',
          context.developmentPlanItems
            .filter(({ item }) => item.implementation_plan_status === 'changes_requested')
            .map(developmentPlanItemReportRef),
        ),
      ];
    case 'execution-continuation':
      return [
        group(
          'interrupted_or_resumable',
          context.executions
            .filter(({ execution }) => execution.status === 'interrupted' || execution.status === 'paused')
            .map(executionReportRef),
        ),
        group('running', context.executions.filter(({ execution }) => execution.status === 'running').map(executionReportRef)),
      ];
    case 'execution-outcomes':
      return [
        group('succeeded', context.executions.filter(({ execution }) => execution.status === 'completed').map(executionReportRef)),
        group('failed', context.executions.filter(({ execution }) => execution.status === 'failed').map(executionReportRef)),
      ];
    case 'code-review':
      return [
        group('in_review', context.codeReviews.filter(({ handoff }) => handoff.status === 'in_review').map(codeReviewReportRef)),
        group('approved', context.codeReviews.filter(({ handoff }) => handoff.status === 'approved').map(codeReviewReportRef)),
        group(
          'changes_requested',
          context.codeReviews.filter(({ handoff }) => handoff.status === 'changes_requested').map(codeReviewReportRef),
        ),
      ];
    case 'qa-handoff-readiness':
      return [
        group('pending', context.qaHandoffs.filter(({ handoff }) => handoff.status === 'pending').map(qaHandoffReportRef)),
        group('blocked', context.qaHandoffs.filter(({ handoff }) => handoff.status === 'blocked').map(qaHandoffReportRef)),
        group('accepted', context.qaHandoffs.filter(({ handoff }) => handoff.status === 'accepted').map(qaHandoffReportRef)),
      ];
    case 'release-readiness':
      return [
        group('planned_releases', context.releases.map(releaseReportRef)),
        group(
          'release_blocking_items',
          context.developmentPlanItems
            .filter(({ item }) => item.release_impact === 'release_blocking')
            .map(developmentPlanItemReportRef),
        ),
      ];
    case 'quality-bug-escape':
      return [
        group('escaped_bugs', context.workItems.filter((workItem) => workItem.kind === 'bug' && workItem.phase !== 'done').map(workItemReportRef)),
        group('qa_blockers', context.qaHandoffs.filter(({ handoff }) => handoff.status === 'blocked').map(qaHandoffReportRef)),
      ];
    default:
      return [group('items', context.developmentPlanItems.map(developmentPlanItemReportRef))];
  }
}

function group(id: string, items: ProductObjectRef[]): Record<string, unknown> {
  return { id, count: items.length, items };
}

function developmentPlanItemReportRef({ item }: DevelopmentPlanItemWithPlan): ProductObjectRef {
  return {
    type: 'development_plan_item',
    id: item.id,
    development_plan_id: item.development_plan_id,
    title: item.title,
  };
}

function executionReportRef({ execution }: ExecutionWithContext): ProductObjectRef {
  return { type: 'execution', id: execution.id, title: execution.current_step ?? execution.status };
}

function codeReviewReportRef({ handoff }: CodeReviewWithContext): ProductObjectRef {
  return { type: 'code_review_handoff', id: handoff.id, title: handoff.summary };
}

function qaHandoffReportRef({ handoff }: QaWithContext): ProductObjectRef {
  return { type: 'qa_handoff', id: handoff.id, title: handoff.ref.title ?? handoff.development_plan_item_ref.title ?? handoff.status };
}

function releaseReportRef(release: Release): ProductObjectRef {
  return { type: 'release', id: release.id, title: release.title };
}

function workItemReportRef(workItem: WorkItem): ProductObjectRef {
  return { type: workItemKindToObjectType(workItem.kind), id: workItem.id, title: workItem.title } as ProductObjectRef;
}

function latestUpdatedAt(values: string[]): string | undefined {
  return values.sort((left, right) => right.localeCompare(left))[0];
}

function byUpdatedAtDesc(left: unknown, right: unknown): number {
  const leftUpdated = stringValue(left, 'updated_at') ?? '';
  const rightUpdated = stringValue(right, 'updated_at') ?? '';
  return rightUpdated.localeCompare(leftUpdated);
}

function workItemKindToObjectType(kind: WorkItem['kind']): WorkItemObjectType {
  return kind;
}

async function typedWorkItems(repository: DeliveryRepository, projectId: string, kind: WorkItemObjectType): Promise<TypedWorkItem[]> {
  return (await repository.listWorkItems(projectId)).filter((workItem): workItem is TypedWorkItem => workItem.kind === kind);
}

async function typedWorkItemsForQuery(repository: DeliveryRepository, query: ProductListQuery, kind: WorkItemObjectType): Promise<TypedWorkItem[]> {
  const [workItems, context] = await Promise.all([
    typedWorkItems(repository, query.project_id, kind),
    typedDocumentProjectionContext(repository, query.project_id),
  ]);
  return workItems.filter((workItem) => typedWorkItemMatchesQuery(workItem, query, context));
}

async function typedWorkItemById(
  repository: DeliveryRepository,
  workItemId: string,
  kind: WorkItemObjectType,
): Promise<TypedWorkItem | undefined> {
  const workItem = await repository.getWorkItem(workItemId);
  return workItem?.kind === kind ? (workItem as TypedWorkItem) : undefined;
}

async function sourceRelationshipRefs(repository: DeliveryRepository, workItem: TypedWorkItem): Promise<TypedDocumentRelationshipRef[]> {
  const sourceRef = sourceRefFor(workItem);
  const sourceLinks = await repository.listDevelopmentPlanSourceLinksForSource(sourceRef);
  const refs: TypedDocumentRelationshipRef[] = [];
  const seen = new Set<string>();

  const push = (ref: TypedDocumentRelationshipRef) => {
    const key = JSON.stringify(ref);
    if (!seen.has(key)) {
      seen.add(key);
      refs.push(ref);
    }
  };

  for (const link of sourceLinks) {
    const plan = await repository.getDevelopmentPlan(link.development_plan_id);
    if (plan === undefined) {
      continue;
    }
    push(developmentPlanRef(plan));
    const items = await repository.listDevelopmentPlanItems(plan.id);
    for (const item of items) {
      if (sourceRefsMatch(item.source_ref, sourceRef)) {
        push(developmentPlanItemRef(item));
      }
    }
  }

  return refs;
}

async function typedDocumentProjectionContext(repository: DeliveryRepository, projectId: string): Promise<TypedDocumentProjectionContext> {
  const [plans, planItems, executionPackages, executions, codeReviewHandoffs, qaHandoffs, releases, workItems] = await Promise.all([
    repository.listDevelopmentPlans(projectId),
    listDevelopmentPlanItemsForProject(repository, projectId),
    repository.listExecutionPackages(projectId),
    listExecutionsForProject(repository, projectId),
    listCodeReviewHandoffsForProject(repository, projectId),
    listQaHandoffsForProject(repository, projectId),
    repository.listReleases(projectId),
    repository.listWorkItems(projectId),
  ]);
  const releaseEvidence = (await Promise.all(releases.map((release) => repository.listReleaseEvidences(release.id)))).flat();
  const typedWorkItemRefs = workItems.map((workItem) => sourceRefFor(workItem));
  const planItemRefs = planItems.map(({ item }) => developmentPlanItemRef(item));
  const attachmentScopes = [...typedWorkItemRefs, ...planItemRefs];
  const attachmentRows = await Promise.all(
    attachmentScopes.map((ref) => repository.listAttachmentsForObject(ref.type, ref.id)),
  );
  return {
    plans,
    planItems,
    executionPackages,
    executions,
    codeReviewHandoffs,
    qaHandoffs,
    releases,
    releaseEvidence,
    attachments: uniqueById(attachmentRows.flat()),
  };
}

function typedDocumentProjection(workItem: TypedWorkItem, context: TypedDocumentProjectionContext): TypedDocumentProjection {
  const sourceRef = sourceRefFor(workItem);
  const linkedDevelopmentPlans = context.plans.filter((plan) => plan.source_refs.some((ref) => sourceRefsMatch(ref, sourceRef)));
  const linkedDevelopmentPlanIds = new Set(linkedDevelopmentPlans.map((plan) => plan.id));
  const linkedPlanItems = context.planItems.filter(({ plan, item }) => linkedDevelopmentPlanIds.has(plan.id) && sourceRefsMatch(item.source_ref, sourceRef));
  const releaseRefs = context.releases.filter((release) => releaseLinksSource(release, workItem, linkedPlanItems, context.executionPackages));
  const attachmentRefs = context.attachments.filter((attachment) => attachmentLinksSource(attachment, sourceRef, linkedPlanItems));
  const evidenceRefs = context.releaseEvidence.filter((evidence) => evidenceLinksSource(evidence, sourceRef, attachmentRefs, linkedPlanItems));
  const updatedValues = [
    workItem.updated_at,
    ...linkedDevelopmentPlans.map((plan) => plan.updated_at),
    ...linkedPlanItems.map(({ item }) => item.updated_at),
    ...releaseRefs.map((release) => release.updated_at),
    ...attachmentRefs.map((attachment) => attachment.created_at),
    ...evidenceRefs.map((evidence) => evidence.updated_at ?? evidence.created_at),
  ];

  return {
    planning_coverage: {
      development_plan_count: linkedDevelopmentPlans.length,
      plan_item_count: linkedPlanItems.length,
      uncovered: linkedDevelopmentPlans.length === 0 || linkedPlanItems.length === 0,
    },
    downstream_gate_summary: downstreamGateSummary(linkedPlanItems.map(({ item }) => item)),
    linked_development_plans: linkedDevelopmentPlans.map(developmentPlanRef),
    linked_plan_items: linkedPlanItems.map(({ item }) => developmentPlanItemRef(item)),
    evidence_refs: evidenceRefs.map(typedDocumentEvidenceRef),
    attachment_refs: attachmentRefs.map(attachmentPublicRef),
    release_refs: releaseRefs.map((release) => ({ type: 'release' as const, id: release.id, title: release.title })),
    audit: {
      created_at: workItem.created_at,
      updated_at: workItem.updated_at,
      ...(workItem.driver_actor_id === undefined ? {} : { updated_by_actor_id: workItem.driver_actor_id }),
    },
    last_meaningful_update_at: latestUpdatedAt(updatedValues) ?? workItem.updated_at,
    next_action: nextSourceAction(linkedPlanItems.map(({ item }) => item), workItem),
  };
}

function typedWorkItemMatchesQuery(
  workItem: TypedWorkItem,
  query: ProductListQuery,
  context: TypedDocumentProjectionContext,
): boolean {
  if (query.status !== undefined && workItem.phase !== query.status) {
    return false;
  }
  if (query.phase !== undefined && workItem.phase !== query.phase) {
    return false;
  }
  if (query.gate_state !== undefined && workItem.gate_state !== query.gate_state) {
    return false;
  }
  if (query.resolution !== undefined && workItem.resolution !== query.resolution) {
    return false;
  }
  if (query.risk !== undefined && workItem.risk !== query.risk) {
    return false;
  }
  if (query.driver_actor_id !== undefined && workItem.driver_actor_id !== query.driver_actor_id) {
    return false;
  }
  if (query.actor_id !== undefined && workItem.driver_actor_id !== query.actor_id) {
    return false;
  }
  return sourceRoleFilterState(workItem, context).matches(query);
}

function developmentPlanMatchesQuery(
  plan: DevelopmentPlan,
  query: ProductListQuery,
  context: TypedDocumentProjectionContext,
): boolean {
  if (query.status !== undefined && plan.status !== query.status) {
    return false;
  }
  const planItems = context.planItems.filter(({ plan: candidatePlan }) => candidatePlan.id === plan.id);
  if (query.phase !== undefined && !planItems.some(({ item }) => currentDevelopmentPlanItemGate(item) === query.phase)) {
    return false;
  }
  if (query.gate_state !== undefined && !planItems.some(({ item }) => currentDevelopmentPlanItemGate(item) === query.gate_state)) {
    return false;
  }
  if (query.risk !== undefined && !planItems.some(({ item }) => item.risk === query.risk)) {
    return false;
  }
  if (query.blocked !== undefined && planItems.some(({ item }) => isDevelopmentPlanItemBlocked(item)) !== query.blocked) {
    return false;
  }
  if (
    query.stale !== undefined &&
    planItems.some(({ item }) => item.spec_status === 'stale' || item.implementation_plan_status === 'stale' || item.boundary_status === 'stale') !== query.stale
  ) {
    return false;
  }
  return planRoleFilterState(plan, context).matches(query);
}

function sourceRoleFilterState(workItem: TypedWorkItem, context: TypedDocumentProjectionContext) {
  const sourceRef = sourceRefFor(workItem);
  const linkedDevelopmentPlanIds = new Set(
    context.plans.filter((plan) => plan.source_refs.some((ref) => sourceRefsMatch(ref, sourceRef))).map((plan) => plan.id),
  );
  const linkedPlanItems = context.planItems.filter(
    ({ plan, item }) => linkedDevelopmentPlanIds.has(plan.id) && sourceRefsMatch(item.source_ref, sourceRef),
  );
  const linkedPlanItemIds = new Set(linkedPlanItems.map(({ item }) => item.id));
  const linkedExecutionIds = new Set(
    context.executions.filter(({ item }) => linkedPlanItemIds.has(item.id)).map(({ execution }) => execution.id),
  );
  const linkedReleaseRefs = context.releases.filter((release) => releaseLinksSource(release, workItem, linkedPlanItems, context.executionPackages));

  return roleFilterState({
    driverActorIds: [workItem.driver_actor_id, ...linkedPlanItems.map(({ item }) => item.driver_actor_id)],
    executionOwnerActorIds: [
      ...context.executionPackages
        .filter(
          (executionPackage) =>
            executionPackage.work_item_id === workItem.id ||
            (executionPackage.development_plan_item_id !== undefined && linkedPlanItemIds.has(executionPackage.development_plan_item_id)),
        )
        .map((executionPackage) => executionPackage.owner_actor_id),
    ],
    reviewerActorIds: [
      ...linkedPlanItems.map(({ item }) => item.reviewer_actor_id),
      ...context.executionPackages
        .filter(
          (executionPackage) =>
            executionPackage.work_item_id === workItem.id ||
            (executionPackage.development_plan_item_id !== undefined && linkedPlanItemIds.has(executionPackage.development_plan_item_id)),
        )
        .map((executionPackage) => executionPackage.reviewer_actor_id),
      ...context.codeReviewHandoffs
        .filter(({ handoff, item }) => linkedPlanItemIds.has(item.id) || linkedExecutionIds.has(handoff.execution_id))
        .map(({ handoff }) => handoff.reviewer_actor_id),
    ],
    qaOwnerActorIds: [
      ...context.executionPackages
        .filter(
          (executionPackage) =>
            executionPackage.work_item_id === workItem.id ||
            (executionPackage.development_plan_item_id !== undefined && linkedPlanItemIds.has(executionPackage.development_plan_item_id)),
        )
        .map((executionPackage) => executionPackage.qa_owner_actor_id),
      ...context.qaHandoffs
        .filter(({ item }) => linkedPlanItemIds.has(item.id))
        .flatMap(({ handoff }) => [handoff.blocked_by_actor_id, handoff.accepted_by_actor_id]),
    ],
    releaseOwnerActorIds: linkedReleaseRefs.map((release) => release.release_owner_actor_id ?? release.created_by_actor_id),
  });
}

function planRoleFilterState(plan: DevelopmentPlan, context: TypedDocumentProjectionContext) {
  const planItems = context.planItems.filter(({ plan: candidatePlan }) => candidatePlan.id === plan.id);
  const planItemIds = new Set(planItems.map(({ item }) => item.id));
  const planPackageIds = new Set(
    context.executionPackages
      .filter((executionPackage) => executionPackage.development_plan_item_id !== undefined && planItemIds.has(executionPackage.development_plan_item_id))
      .map((executionPackage) => executionPackage.id),
  );
  const sourceIds = new Set(plan.source_refs.map((sourceRef) => `${sourceRef.type}:${sourceRef.id}`));
  const sourceLinkedReleaseRefs = context.releases.filter((release) =>
    release.work_item_ids.some((workItemId) =>
      plan.source_refs.some((sourceRef) => sourceRef.id === workItemId),
    ),
  );
  const planScopedReleaseRefs = context.releases.filter((release) =>
    release.execution_package_ids.some((packageId) => planPackageIds.has(packageId)) ||
    releaseScopeRefs(release).some(
      (ref) =>
        (ref.type === 'development_plan_item' && planItemIds.has(ref.id)) ||
        sourceIds.has(`${ref.type}:${ref.id}`),
    ),
  );

  return roleFilterState({
    driverActorIds: planItems.map(({ item }) => item.driver_actor_id),
    executionOwnerActorIds: [
      ...context.executionPackages
        .filter((executionPackage) => executionPackage.development_plan_item_id !== undefined && planItemIds.has(executionPackage.development_plan_item_id))
        .map((executionPackage) => executionPackage.owner_actor_id),
    ],
    reviewerActorIds: [
      ...planItems.map(({ item }) => item.reviewer_actor_id),
      ...context.executionPackages
        .filter((executionPackage) => executionPackage.development_plan_item_id !== undefined && planItemIds.has(executionPackage.development_plan_item_id))
        .map((executionPackage) => executionPackage.reviewer_actor_id),
      ...context.codeReviewHandoffs
        .filter(({ item }) => planItemIds.has(item.id))
        .map(({ handoff }) => handoff.reviewer_actor_id),
    ],
    qaOwnerActorIds: [
      ...context.executionPackages
        .filter((executionPackage) => executionPackage.development_plan_item_id !== undefined && planItemIds.has(executionPackage.development_plan_item_id))
        .map((executionPackage) => executionPackage.qa_owner_actor_id),
      ...context.qaHandoffs
        .filter(({ item }) => planItemIds.has(item.id))
        .flatMap(({ handoff }) => [handoff.blocked_by_actor_id, handoff.accepted_by_actor_id]),
    ],
    releaseOwnerActorIds: [...sourceLinkedReleaseRefs, ...planScopedReleaseRefs].map(
      (release) => release.release_owner_actor_id ?? release.created_by_actor_id,
    ),
  });
}

function roleFilterState(input: {
  driverActorIds: Array<string | undefined>;
  executionOwnerActorIds: Array<string | undefined>;
  reviewerActorIds: Array<string | undefined>;
  qaOwnerActorIds: Array<string | undefined>;
  releaseOwnerActorIds: Array<string | undefined>;
}) {
  const driverActorIds = new Set(compactStrings(input.driverActorIds));
  const executionOwnerActorIds = new Set(compactStrings(input.executionOwnerActorIds));
  const reviewerActorIds = new Set(compactStrings(input.reviewerActorIds));
  const qaOwnerActorIds = new Set(compactStrings(input.qaOwnerActorIds));
  const releaseOwnerActorIds = new Set(compactStrings(input.releaseOwnerActorIds));

  return {
    matches(query: ProductListQuery): boolean {
      return (
        matchesOptionalActor(driverActorIds, query.driver_actor_id) &&
        matchesOptionalActor(executionOwnerActorIds, query.execution_owner_actor_id) &&
        matchesOptionalActor(reviewerActorIds, query.reviewer_actor_id) &&
        matchesOptionalActor(qaOwnerActorIds, query.qa_owner_actor_id) &&
        matchesOptionalActor(releaseOwnerActorIds, query.release_owner_actor_id)
      );
    },
  };
}

function compactStrings(values: Array<string | undefined>): string[] {
  return values.filter((value): value is string => value !== undefined && value.length > 0);
}

function matchesOptionalActor(actorIds: ReadonlySet<string>, expected: string | undefined): boolean {
  return expected === undefined || actorIds.has(expected);
}

function sourceRefFor(workItem: WorkItem): WorkItemPublicRef {
  return { type: workItemKindToObjectType(workItem.kind), id: workItem.id, title: workItem.title } as WorkItemPublicRef;
}

function sourceRefsMatch(left: { type: string; id: string }, right: { type: string; id: string }): boolean {
  return left.type === right.type && left.id === right.id;
}

function downstreamGateSummary(items: DevelopmentPlanItem[]): TypedDocumentProjection['downstream_gate_summary'] {
  const current_gate_counts = {
    boundary: 0,
    spec: 0,
    implementation_plan_doc: 0,
    execution: 0,
    code_review: 0,
    qa: 0,
    release: 0,
  };
  for (const item of items) {
    current_gate_counts[downstreamGateFor(item)] += 1;
  }
  return {
    current_gate_counts,
    blocker_count: items.filter(isDevelopmentPlanItemBlocked).length,
  };
}

function downstreamGateFor(item: DevelopmentPlanItem): keyof TypedDocumentProjection['downstream_gate_summary']['current_gate_counts'] {
  if (item.boundary_status !== 'approved') return 'boundary';
  if (item.spec_status !== 'approved') return 'spec';
  if (item.implementation_plan_status !== 'approved') return 'implementation_plan_doc';
  if (item.execution_status !== 'completed') return 'execution';
  if (item.review_status !== 'approved') return 'code_review';
  if (item.qa_handoff_status !== 'approved') return 'qa';
  return 'release';
}

function nextSourceAction(items: DevelopmentPlanItem[], workItem: WorkItem): string {
  const priority = [
    (item: DevelopmentPlanItem) => item.release_impact === 'release_blocking' && isDevelopmentPlanItemBlocked(item),
    (item: DevelopmentPlanItem) => item.review_status === 'changes_requested' || item.review_status === 'blocked',
    (item: DevelopmentPlanItem) => item.qa_handoff_status === 'blocked' || item.qa_handoff_status === 'changes_requested',
    (item: DevelopmentPlanItem) => item.spec_status === 'blocked' || item.spec_status === 'changes_requested',
    (item: DevelopmentPlanItem) => item.implementation_plan_status === 'blocked' || item.implementation_plan_status === 'changes_requested',
    (item: DevelopmentPlanItem) => item.boundary_status === 'changes_requested',
    (item: DevelopmentPlanItem) => item.spec_status !== 'approved',
    (item: DevelopmentPlanItem) => item.implementation_plan_status !== 'approved',
    (item: DevelopmentPlanItem) => item.execution_status !== 'completed',
  ];
  for (const matcher of priority) {
    const item = items.find(matcher);
    if (item !== undefined) {
      return item.next_action;
    }
  }
  return items[0]?.next_action ?? `Create Development Plan for ${typedDocumentLabel(workItem.kind)}`;
}

function typedDocumentLabel(kind: WorkItem['kind']): string {
  if (kind === 'tech_debt') return 'Tech Debt';
  return `${kind.charAt(0).toUpperCase()}${kind.slice(1)}`;
}

function releaseLinksSource(
  release: Release,
  workItem: WorkItem,
  items: DevelopmentPlanItemWithPlan[],
  executionPackages: ExecutionPackage[],
): boolean {
  const itemIds = new Set(items.map(({ item }) => item.id));
  const packageIds = new Set(
    executionPackages
      .filter(
        (executionPackage) =>
          executionPackage.work_item_id === workItem.id ||
          (executionPackage.development_plan_item_id !== undefined && itemIds.has(executionPackage.development_plan_item_id)),
      )
      .map((executionPackage) => executionPackage.id),
  );
  if (release.work_item_ids.includes(workItem.id) || release.id === workItem.current_release_id) {
    return true;
  }
  if (release.execution_package_ids.some((packageId) => packageIds.has(packageId))) {
    return true;
  }
  const scopeRefs = releaseScopeRefs(release);
  return scopeRefs.some(
    (ref) =>
      sourceRefsMatch(ref, sourceRefFor(workItem)) ||
      items.some(({ item }) => ref.type === 'development_plan_item' && ref.id === item.id),
  );
}

function attachmentLinksSource(attachment: Attachment, sourceRef: WorkItemPublicRef, items: DevelopmentPlanItemWithPlan[]): boolean {
  if (attachment.owner_object_type === sourceRef.type && attachment.owner_object_id === sourceRef.id) {
    return true;
  }
  return attachment.linked_object_refs.some(
    (ref) =>
      sourceRefsMatch(ref, sourceRef) ||
      items.some(({ item }) => ref.type === 'development_plan_item' && ref.id === item.id),
  );
}

function evidenceLinksSource(
  evidence: ReleaseEvidence,
  sourceRef: WorkItemPublicRef,
  attachments: Attachment[],
  items: DevelopmentPlanItemWithPlan[],
): boolean {
  const scopeRef = evidenceScopeRef(evidence);
  if (scopeRef !== undefined && typedDocumentRefMatches(scopeRef, sourceRef, items)) {
    return true;
  }
  if (evidence.object_ref !== undefined) {
    if (evidence.object_ref.object_type === 'work_item' && evidence.object_ref.object_id === sourceRef.id) {
      return true;
    }
  }
  const attachmentIds = new Set(attachments.map((attachment) => attachment.id));
  return observationLinks(evidence).some((link) => link.object_type === 'attachment' && attachmentIds.has(link.object_id));
}

function evidenceScopeRef(evidence: ReleaseEvidence): ObjectRef | undefined {
  return isRecord(evidence.extra) ? productSafeObjectRef(evidence.extra.scope_ref) : undefined;
}

function typedDocumentRefMatches(ref: ObjectRef, sourceRef: WorkItemPublicRef, items: DevelopmentPlanItemWithPlan[]): boolean {
  return (
    sourceRefsMatch(ref, sourceRef) ||
    items.some(({ item }) => ref.type === 'development_plan_item' && ref.id === item.id)
  );
}

function observationLinks(evidence: ReleaseEvidence): Array<{ object_type: string; object_id: string }> {
  const observation = value(evidence.extra, 'observation');
  const links = value(observation, 'links');
  if (!Array.isArray(links)) {
    return [];
  }
  return links.flatMap((link) => {
    if (!isRecord(link) || typeof link.object_type !== 'string' || typeof link.object_id !== 'string') {
      return [];
    }
    return [{ object_type: link.object_type, object_id: link.object_id }];
  });
}

function evidenceAttachmentId(evidence: ReleaseEvidence): string | undefined {
  return observationLinks(evidence).find((link) => link.object_type === 'attachment')?.object_id;
}

function typedDocumentEvidenceRef(evidence: ReleaseEvidence): TypedDocumentEvidenceRef {
  const attachmentId = evidenceAttachmentId(evidence);
  if (attachmentId !== undefined) {
    return { type: 'attachment', id: attachmentId, title: evidence.title ?? evidence.summary };
  }
  return { type: 'release_evidence', id: evidence.id, release_id: evidence.release_id, title: evidence.title ?? evidence.summary };
}

function uniqueById<T extends { id: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    if (seen.has(row.id)) {
      return false;
    }
    seen.add(row.id);
    return true;
  });
}

function attachmentPublicRef(attachment: Attachment): TypedDocumentAttachmentRef {
  return {
    id: attachment.id,
    owner_object_type: attachment.owner_object_type,
    owner_object_id: attachment.owner_object_id,
    linked_object_refs: attachment.linked_object_refs.filter(isTypedDocumentRelationshipRef),
    filename: attachment.filename,
    content_type: attachment.content_type,
    size_bytes: attachment.size_bytes,
    checksum_sha256: attachment.checksum_sha256,
    uploaded_by_actor_id: attachment.uploaded_by_actor_id,
    created_at: attachment.created_at,
    evidence_category: attachment.evidence_category,
    ...(attachment.caption === undefined ? {} : { caption: attachment.caption }),
    ...(attachment.alt_text === undefined ? {} : { alt_text: attachment.alt_text }),
    visibility: attachment.visibility,
    safety_status: attachment.safety_status,
    reference_status: attachment.reference_status,
  };
}

function isTypedDocumentRelationshipRef(ref: ObjectRef): ref is TypedDocumentRelationshipRef {
  return typedDocumentRelationshipRefSchema.safeParse(ref).success;
}

function workItemRef(workItem: WorkItem): WorkItemPublicRef {
  return sourceRefFor(workItem);
}

function workItemHref(workItem: WorkItem): string {
  const routes = {
    initiative: 'initiatives',
    requirement: 'requirements',
    tech_debt: 'tech-debt',
    bug: 'bugs',
  } satisfies Record<WorkItemObjectType, string>;
  return `/${routes[workItemKindToObjectType(workItem.kind)]}/${workItem.id}`;
}

function workItemToMyWorkQueueItem(workItem: WorkItem): MyWorkQueueItem {
  return {
    id: `${workItem.kind}:${workItem.id}`,
    object_ref: workItemRef(workItem),
    title: workItem.title,
    attention_reason: `${workItem.kind}_needs_attention`,
    actor_id: workItem.driver_actor_id,
    href: workItemHref(workItem),
  };
}

function releaseToMyWorkQueueItem(release: Release): MyWorkQueueItem {
  return {
    id: `release:${release.id}`,
    object_ref: { type: 'release', id: release.id },
    title: release.title,
    attention_reason: 'release_readiness',
    actor_id: release.release_owner_actor_id,
    href: `/releases/${release.id}`,
  };
}

function baseWorkItemListItem(workItem: WorkItem, projection: TypedDocumentProjection) {
  return {
    id: workItem.id,
    ref: workItemRef(workItem),
    title: workItem.title,
    status: workItem.phase,
    priority: workItem.priority,
    risk: workItem.risk,
    driver_actor_id: workItem.driver_actor_id,
    planning_coverage: projection.planning_coverage,
    downstream_gate_summary: projection.downstream_gate_summary,
    last_meaningful_update_at: projection.last_meaningful_update_at,
    next_action: projection.next_action,
    release_refs: projection.release_refs,
    updated_at: workItem.updated_at,
  };
}

function baseWorkItemDetail(workItem: TypedWorkItem, projection: TypedDocumentProjection) {
  return {
    ...baseWorkItemListItem(workItem, projection),
    narrative_markdown: workItem.narrative_markdown,
    linked_development_plans: projection.linked_development_plans,
    linked_plan_items: projection.linked_plan_items,
    evidence_refs: projection.evidence_refs,
    attachment_refs: projection.attachment_refs,
    audit: projection.audit,
  };
}

function workItemToRequirementListItem(workItem: TypedWorkItem, projection: TypedDocumentProjection): RequirementListItem {
  return { ...baseWorkItemListItem(workItem, projection), ref: { type: 'requirement', id: workItem.id, title: workItem.title } };
}

function workItemToRequirementDetail(
  workItem: TypedWorkItem,
  projection: TypedDocumentProjection,
  relationshipRefs: TypedDocumentRelationshipRef[],
): RequirementDetail {
  const context = workItem.intake_context.type === 'requirement' ? workItem.intake_context : undefined;
  return {
    ...baseWorkItemDetail(workItem, projection),
    ref: { type: 'requirement', id: workItem.id, title: workItem.title },
    relationship_refs: relationshipRefs,
    stakeholder_problem: requiredContextValue(context?.stakeholder_problem, workItem, 'stakeholder problem'),
    desired_outcome: requiredContextValue(context?.desired_outcome, workItem, 'desired outcome'),
    acceptance_criteria_summary: requiredContextValue(context?.acceptance_criteria.join(' '), workItem, 'acceptance criteria'),
    scope_summary: {
      in_scope: requiredContextValue(context?.in_scope.join(', '), workItem, 'in scope'),
      out_of_scope: optionalContextSummary(context?.out_of_scope?.join(', '), 'No explicit out-of-scope constraints captured.'),
    },
  };
}

function workItemToInitiativeListItem(workItem: TypedWorkItem, projection: TypedDocumentProjection): InitiativeListItem {
  const context = workItem.intake_context.type === 'initiative' ? workItem.intake_context : undefined;
  return {
    ...baseWorkItemListItem(workItem, projection),
    ref: { type: 'initiative', id: workItem.id, title: workItem.title },
    business_outcome: requiredContextValue(context?.business_outcome, workItem, 'business outcome'),
  };
}

function workItemToInitiativeDetail(
  workItem: TypedWorkItem,
  projection: TypedDocumentProjection,
  relationshipRefs: TypedDocumentRelationshipRef[],
): InitiativeDetail {
  const context = workItem.intake_context.type === 'initiative' ? workItem.intake_context : undefined;
  return {
    ...baseWorkItemDetail(workItem, projection),
    ref: { type: 'initiative', id: workItem.id, title: workItem.title },
    relationship_refs: relationshipRefs,
    business_outcome: requiredContextValue(context?.business_outcome, workItem, 'business outcome'),
    milestone_intent: optionalContextSummary(context?.milestone_intent, 'No milestone intent captured yet.'),
    child_refs: relationshipRefs.filter((ref) => ref.type === 'requirement' || ref.type === 'bug' || ref.type === 'tech_debt'),
    release_coverage: releaseCoverageText(projection),
  };
}

function workItemToTechDebtListItem(workItem: TypedWorkItem, projection: TypedDocumentProjection): TechDebtListItem {
  const context = workItem.intake_context.type === 'tech_debt' ? workItem.intake_context : undefined;
  return {
    ...baseWorkItemListItem(workItem, projection),
    ref: { type: 'tech_debt', id: workItem.id, title: workItem.title },
    affected_modules: context?.affected_modules ?? [],
    risk_rationale: requiredContextValue(context?.current_pain, workItem, 'risk rationale'),
  };
}

function workItemToTechDebtDetail(
  workItem: TypedWorkItem,
  projection: TypedDocumentProjection,
  relationshipRefs: TypedDocumentRelationshipRef[],
): TechDebtDetail {
  const context = workItem.intake_context.type === 'tech_debt' ? workItem.intake_context : undefined;
  return {
    ...baseWorkItemDetail(workItem, projection),
    ref: { type: 'tech_debt', id: workItem.id, title: workItem.title },
    relationship_refs: relationshipRefs,
    affected_modules: context?.affected_modules ?? [],
    risk_rationale: requiredContextValue(context?.current_pain, workItem, 'risk rationale'),
    validation_strategy: requiredContextValue(context?.validation_strategy, workItem, 'validation strategy'),
    remediation_intent: requiredContextValue(context?.desired_invariant, workItem, 'remediation intent'),
  };
}

function workItemToBugListItem(workItem: TypedWorkItem, projection: TypedDocumentProjection): BugListItem {
  const context = workItem.intake_context.type === 'bug' ? workItem.intake_context : undefined;
  return {
    ...baseWorkItemListItem(workItem, projection),
    ref: { type: 'bug', id: workItem.id, title: workItem.title },
    severity: workItem.risk,
    affected_surfaces: bugAffectedSurfaces(context),
  };
}

function workItemToBugDetail(workItem: TypedWorkItem, projection: TypedDocumentProjection, relationshipRefs: TypedDocumentRelationshipRef[]): BugDetail {
  const context = workItem.intake_context.type === 'bug' ? workItem.intake_context : undefined;
  return {
    ...baseWorkItemDetail(workItem, projection),
    ref: { type: 'bug', id: workItem.id, title: workItem.title },
    relationship_refs: relationshipRefs,
    observed_behavior: requiredContextValue(context?.observed_behavior, workItem, 'observed behavior'),
    expected_behavior: requiredContextValue(context?.expected_behavior, workItem, 'expected behavior'),
    reproduction_steps: context?.reproduction_steps ?? [],
    severity: workItem.risk,
    affected_surfaces: bugAffectedSurfaces(context),
  };
}

function requiredContextValue(valueToCheck: string | undefined, workItem: WorkItem, field: string): string {
  if (valueToCheck !== undefined && valueToCheck.trim().length > 0) {
    return valueToCheck;
  }
  throw new Error(`${workItem.kind} ${workItem.id} is missing required ${field} projection data`);
}

function optionalContextSummary(valueToCheck: string | undefined, fallback: string): string {
  return valueToCheck !== undefined && valueToCheck.trim().length > 0 ? valueToCheck : fallback;
}

function releaseCoverageText(projection: TypedDocumentProjection): string {
  if (projection.release_refs.length === 0) {
    return 'No release coverage yet.';
  }
  return projection.release_refs.map((ref) => ref.title ?? ref.id).join(', ');
}

function bugAffectedSurfaces(context: Extract<WorkItem['intake_context'], { type: 'bug' }> | undefined): string[] {
  if (context === undefined) {
    return [];
  }
  return [context.affected_environment, context.suspected_area].filter((valueToCheck): valueToCheck is string => valueToCheck !== undefined);
}

function releaseScopeRefs(release: Release): ObjectRef[] {
  const refs = isRecord(release.extra) && Array.isArray(release.extra.project_management_scope_refs) ? release.extra.project_management_scope_refs : [];
  return refs.flatMap((ref) => {
    const productRef = productSafeObjectRef(ref);
    return productRef === undefined ? [] : [productRef];
  });
}

function releaseRevisionAuthority(release: Release): ReleaseRevisionAuthority {
  const currentSpecRevisionId = stringValue(release.extra, 'current_spec_revision_id');
  const currentPlanRevisionId = stringValue(release.extra, 'current_plan_revision_id');
  return {
    ...(currentSpecRevisionId === undefined ? {} : { current_spec_revision_id: currentSpecRevisionId }),
    ...(currentPlanRevisionId === undefined ? {} : { current_plan_revision_id: currentPlanRevisionId }),
  };
}

function reviewGateFor(
  scopeRef: ObjectRef,
  evidence: ReleaseEvidence[],
  disabledReasons: ProductSafeDisabledReason[],
  revisionAuthority: ReleaseRevisionAuthority,
): EvidenceRequirementStatus {
  const candidates = evidenceForScope(evidence, scopeRef, 'review');
  const invalidStatus = recordInvalidStatus(candidates, scopeRef, 'review', disabledReasons);
  if (invalidStatus !== undefined) {
    return invalidStatus;
  }
  const authoritativeCandidates = candidates.filter((item) => isAuthoritativeReview(item) && value(item.extra, 'status') === 'approved');
  const authoritative = authoritativeCandidates.find((item) => evidenceRevisionsMatch(item, revisionAuthority));
  if (authoritative === undefined) {
    if (authoritativeCandidates.length > 0) {
      disabledReasons.push(disabled('evidence_revision_mismatch', scopeRef));
      return revisionMismatchGate('review', scopeRef, 'review');
    }
    disabledReasons.push(disabled('missing_required_review', scopeRef));
    return gate('review', scopeRef, 'review', 'missing', disabled('missing_required_review', scopeRef));
  }
  const evidenceSpecRevisionId = stringValue(authoritative.extra, 'spec_revision_id');
  const evidencePlanRevisionId = stringValue(authoritative.extra, 'plan_revision_id');
  return {
    requirement_id: `review:${scopeRef.type}:${scopeRef.id}`,
    scope_ref: scopeRef,
    kind: 'review',
    status: 'passed',
    ...revisionFields(revisionAuthority, evidenceSpecRevisionId, evidencePlanRevisionId),
    evidence_ref: {
      id: authoritative.id,
      authority_type:
        value(authoritative.extra, 'authority_type') === 'code_review_handoff_approval' ||
        value(authoritative.extra, 'authority_type') === 'review_packet_approval'
          ? 'code_review_handoff_approval'
          : 'human_review_decision',
      authority_ref:
        value(authoritative.extra, 'authority_type') === 'code_review_handoff_approval' ||
        value(authoritative.extra, 'authority_type') === 'review_packet_approval'
          ? {
              type: 'code_review_handoff',
              id: stringValue(authoritative.extra, 'code_review_handoff_id') ?? stringValue(authoritative.extra, 'review_packet_id') ?? authoritative.id,
            }
          : { type: 'human_review_decision', id: stringValue(authoritative.extra, 'decision_id') ?? authoritative.id },
      scope_ref: scopeRef,
      status: 'approved',
      required: true,
      ...(evidenceSpecRevisionId === undefined ? {} : { spec_revision_id: evidenceSpecRevisionId }),
      ...(evidencePlanRevisionId === undefined ? {} : { plan_revision_id: evidencePlanRevisionId }),
      attachment_refs: [],
    },
  };
}

function testGateFor(
  scopeRef: ObjectRef,
  evidence: ReleaseEvidence[],
  disabledReasons: ProductSafeDisabledReason[],
  revisionAuthority: ReleaseRevisionAuthority,
): EvidenceRequirementStatus {
  const candidates = evidenceForScope(evidence, scopeRef, 'test');
  const invalidStatus = recordInvalidStatus(candidates, scopeRef, 'qa_acceptance', disabledReasons);
  if (invalidStatus !== undefined) {
    return invalidStatus;
  }
  const passingCandidates = candidates.filter((item) => value(item.extra, 'status') === 'passed' && isAuthorizedEvidence(item));
  const passing = passingCandidates.find((item) => evidenceRevisionsMatch(item, revisionAuthority));
  if (passing === undefined) {
    if (passingCandidates.length > 0) {
      disabledReasons.push(disabled('evidence_revision_mismatch', scopeRef));
      return revisionMismatchGate('test_acceptance', scopeRef, 'qa_acceptance');
    }
    disabledReasons.push(disabled('missing_required_test_acceptance', scopeRef));
    return gate('test_acceptance', scopeRef, 'qa_acceptance', 'missing', disabled('missing_required_test_acceptance', scopeRef));
  }
  return {
    requirement_id: `test_acceptance:${scopeRef.type}:${scopeRef.id}`,
    scope_ref: scopeRef,
    kind: 'qa_acceptance',
    status: 'passed',
    ...revisionFields(revisionAuthority, stringValue(passing.extra, 'spec_revision_id'), stringValue(passing.extra, 'plan_revision_id')),
    evidence_ref: {
      id: passing.id,
      scope_ref: scopeRef,
      evidence_type: 'qa_acceptance',
      status: 'passed',
      required: true,
      attachment_refs: [],
    },
  };
}

function evidenceForScope(evidence: ReleaseEvidence[], scopeRef: ObjectRef, kind: 'review' | 'test'): ReleaseEvidence[] {
  return evidence.filter((item) => {
    const itemScopeRef = isRecord(item.extra) ? productSafeObjectRef(item.extra.scope_ref) : undefined;
    const kindMatches =
      kind === 'review'
        ? evidenceType(item) === 'review_packet' || evidenceType(item) === 'review_authority' || value(item.extra, 'authority_type') !== undefined
        : evidenceType(item) === 'test_report' || evidenceType(item) === 'test_acceptance' || value(item.extra, 'evidence_type') !== undefined;
    return kindMatches && itemScopeRef !== undefined && itemScopeRef.type === scopeRef.type && itemScopeRef.id === scopeRef.id;
  });
}

function evidenceRevisionsMatch(evidence: ReleaseEvidence, revisionAuthority: ReleaseRevisionAuthority): boolean {
  const evidenceSpecRevisionId = stringValue(evidence.extra, 'spec_revision_id');
  const evidencePlanRevisionId = stringValue(evidence.extra, 'plan_revision_id');
  return (
    revisionAuthority.current_spec_revision_id !== undefined &&
    evidenceSpecRevisionId === revisionAuthority.current_spec_revision_id &&
    revisionAuthority.current_plan_revision_id !== undefined &&
    evidencePlanRevisionId === revisionAuthority.current_plan_revision_id
  );
}

function revisionFields(
  revisionAuthority: ReleaseRevisionAuthority,
  evidenceSpecRevisionId: string | undefined,
  evidencePlanRevisionId: string | undefined,
): Pick<
  EvidenceRequirementStatus,
  'current_spec_revision_id' | 'evidence_spec_revision_id' | 'current_plan_revision_id' | 'evidence_plan_revision_id'
> {
  return {
    ...(revisionAuthority.current_spec_revision_id === undefined ? {} : { current_spec_revision_id: revisionAuthority.current_spec_revision_id }),
    ...(evidenceSpecRevisionId === undefined ? {} : { evidence_spec_revision_id: evidenceSpecRevisionId }),
    ...(revisionAuthority.current_plan_revision_id === undefined ? {} : { current_plan_revision_id: revisionAuthority.current_plan_revision_id }),
    ...(evidencePlanRevisionId === undefined ? {} : { evidence_plan_revision_id: evidencePlanRevisionId }),
  };
}

function revisionMismatchGate(
  requirementId: string,
  scopeRef: ObjectRef,
  kind: EvidenceRequirementStatus['kind'],
): EvidenceRequirementStatus {
  return gate(requirementId, scopeRef, kind, 'blocked', disabled('evidence_revision_mismatch', scopeRef));
}

function recordWrongScopeEvidence(
  evidence: ReleaseEvidence[],
  scopeRefs: ObjectRef[],
  disabledReasons: ProductSafeDisabledReason[],
): void {
  for (const item of evidence) {
    const scopeRef = isRecord(item.extra) ? productSafeObjectRef(item.extra.scope_ref) : undefined;
    if (scopeRef === undefined) {
      continue;
    }
    if (!scopeRefs.some((releaseScopeRef) => releaseScopeRef.type === scopeRef.type && releaseScopeRef.id === scopeRef.id)) {
      disabledReasons.push(disabled('evidence_scope_mismatch', scopeRef));
    }
  }
}

function recordInvalidStatus(
  candidates: ReleaseEvidence[],
  scopeRef: ObjectRef,
  kind: EvidenceRequirementStatus['kind'],
  disabledReasons: ProductSafeDisabledReason[],
): EvidenceRequirementStatus | undefined {
  const stale = candidates.find((item) => item.status === 'stale' || value(item.extra, 'freshness') === 'stale');
  if (stale !== undefined) {
    disabledReasons.push(disabled('evidence_stale', scopeRef));
    return gate(stale.id, scopeRef, kind, 'stale', disabled('evidence_stale', scopeRef));
  }
  const unauthorized = candidates.find((item) => value(item.extra, 'authorization') === 'unauthorized' || !isAuthorizedEvidence(item));
  if (unauthorized !== undefined) {
    disabledReasons.push(disabled('evidence_unauthorized', scopeRef));
    return gate(unauthorized.id, scopeRef, kind, 'unauthorized', disabled('evidence_unauthorized', scopeRef));
  }
  const tombstoned = candidates.find((item) => value(item.extra, 'reference_status') === 'tombstoned' || value(item.extra, 'reference_status') === 'deleted');
  if (tombstoned !== undefined) {
    disabledReasons.push(disabled('evidence_tombstoned', scopeRef));
    return gate(tombstoned.id, scopeRef, kind, 'tombstoned', disabled('evidence_tombstoned', scopeRef));
  }
  return undefined;
}

function isAuthoritativeReview(evidence: ReleaseEvidence): boolean {
  const authorityType = value(evidence.extra, 'authority_type');
  return (
    (authorityType === 'human_review_decision' ||
      authorityType === 'code_review_handoff_approval' ||
      authorityType === 'review_packet_approval') &&
    isAuthorizedEvidence(evidence) &&
    value(evidence.extra, 'freshness') !== 'stale' &&
    value(evidence.extra, 'reference_status') !== 'tombstoned'
  );
}

function isAuthorizedEvidence(evidence: ReleaseEvidence): boolean {
  const authorityType = value(evidence.extra, 'authority_type');
  return authorityType !== 'ai_self_review_approval' && authorityType !== 'attachment_only' && value(evidence.extra, 'authorization') !== 'unauthorized';
}

function gate(
  requirementId: string,
  scopeRef: ObjectRef,
  kind: EvidenceRequirementStatus['kind'],
  status: EvidenceRequirementStatus['status'],
  disabledReason: ProductSafeDisabledReason,
): EvidenceRequirementStatus {
  return {
    requirement_id: `${requirementId}:${scopeRef.type}:${scopeRef.id}`,
    scope_ref: scopeRef,
    kind,
    status,
    disabled_reason: disabledReason,
  };
}

function disabled(code: ProductSafeDisabledReason['code'], scopeRef: ObjectRef): ProductSafeDisabledReason {
  return {
    code,
    message: `Release is blocked by ${code.replaceAll('_', ' ')}.`,
    target_ref: scopeRef,
    remediation_route: remediationRouteFor(scopeRef),
  };
}

function remediationRouteFor(ref: ObjectRef): string {
  if (ref.type === 'development_plan_item') {
    return `/development-plans/${ref.development_plan_id}/items/${ref.id}`;
  }
  return `/${routeSegmentFor(ref)}/${ref.id}/evidence`;
}

function routeSegmentFor(ref: ObjectRef): string {
  if (ref.type === 'tech_debt') {
    return 'tech-debt';
  }
  if (ref.type === 'bug') {
    return 'bugs';
  }
  if (ref.type === 'initiative') {
    return 'initiatives';
  }
  if (ref.type === 'development_plan') {
    return 'development-plans';
  }
  if (ref.type === 'execution') {
    return 'executions';
  }
  if (ref.type === 'release') {
    return 'releases';
  }
  return 'requirements';
}

function productSafeObjectRef(valueToCheck: unknown): ObjectRef | undefined {
  if (!isRecord(valueToCheck) || typeof valueToCheck.type !== 'string' || typeof valueToCheck.id !== 'string') {
    return undefined;
  }

  const parsed = productObjectRefSchema.safeParse(valueToCheck);
  if (parsed.success) {
    return parsed.data;
  }

  switch (valueToCheck.type) {
    case 'execution_package':
    case 'run_session':
      return { type: 'execution', id: stringValue(valueToCheck, 'execution_id') ?? valueToCheck.id };
    case 'review_packet':
      return { type: 'code_review_handoff', id: valueToCheck.id };
    default:
      return undefined;
  }
}

function uniqueDisabledReasons(reasons: ProductSafeDisabledReason[]): ProductSafeDisabledReason[] {
  const seen = new Set<string>();
  return reasons.filter((reason) => {
    const key = `${reason.code}:${reason.target_ref?.type ?? ''}:${reason.target_ref?.id ?? ''}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function workItemToBoardCard(workItem: WorkItem): BoardCard {
  return {
    id: `${workItem.kind}:${workItem.id}`,
    object_ref: workItemRef(workItem),
    title: workItem.title,
    column_id: workItem.phase,
    status: `${workItem.phase}/${workItem.activity_state}/${workItem.gate_state}`,
    priority: workItem.priority,
    risk: workItem.risk,
    driver_actor_id: workItem.driver_actor_id,
    blocked: false,
    href: workItemHref(workItem),
  };
}

function releaseToBoardCard(release: Release): BoardCard {
  return {
    id: `release:${release.id}`,
    object_ref: { type: 'release', id: release.id },
    title: release.title,
    column_id: release.phase,
    status: `${release.phase}/${release.activity_state}/${release.gate_state}`,
    driver_actor_id: release.release_owner_actor_id,
    blocked: false,
    href: `/releases/${release.id}`,
  };
}

function evidenceType(evidence: ReleaseEvidence): string {
  return evidence.evidence_type;
}

function isObjectRef(valueToCheck: unknown): valueToCheck is ObjectRef {
  return productSafeObjectRef(valueToCheck) !== undefined;
}

function isRecord(valueToCheck: unknown): valueToCheck is Record<string, unknown> {
  return typeof valueToCheck === 'object' && valueToCheck !== null && !Array.isArray(valueToCheck);
}

function value(record: unknown, key: string): unknown {
  return isRecord(record) ? record[key] : undefined;
}

function stringValue(record: unknown, key: string): string | undefined {
  const maybeValue = value(record, key);
  return typeof maybeValue === 'string' && maybeValue.trim().length > 0 ? maybeValue : undefined;
}

function stringArrayValue(record: unknown, key: string): string[] {
  const maybeValues = value(record, key);
  if (!Array.isArray(maybeValues)) {
    return [];
  }
  return maybeValues.filter((maybeValue): maybeValue is string => typeof maybeValue === 'string' && maybeValue.trim().length > 0);
}

function objectRefKey(ref: ObjectRef): string {
  return `${ref.type}:${ref.id}`;
}
