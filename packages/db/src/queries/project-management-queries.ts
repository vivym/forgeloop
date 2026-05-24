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
} from '@forgeloop/contracts';
import { productObjectRefSchema, releaseReadinessDetailSchema } from '@forgeloop/contracts';
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
  WorkItem,
} from '@forgeloop/domain';

import type { DeliveryRepository } from '../repositories/delivery-repository';

type WorkItemObjectType = Extract<ObjectRef['type'], 'initiative' | 'requirement' | 'bug' | 'tech_debt'>;
type MyWorkQueueObjectRef = MyWorkQueueItem['object_ref'];
type WorkItemPublicRef = Extract<MyWorkQueueObjectRef, { type: WorkItemObjectType }>;
type TypedWorkItem = WorkItem & { kind: WorkItemObjectType };
type ProductListQuery = { project_id: string };
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
  return { items: (await typedWorkItems(repository, query.project_id, 'requirement')).map(workItemToRequirementListItem) };
}

export async function getRequirementDetail(repository: DeliveryRepository, requirementId: string): Promise<RequirementDetail | undefined> {
  const workItem = await typedWorkItemById(repository, requirementId, 'requirement');
  return workItem === undefined
    ? undefined
    : workItemToRequirementDetail(workItem, await sourceRelationshipRefs(repository, workItem));
}

export async function listInitiatives(repository: DeliveryRepository, query: ProductListQuery): Promise<{ items: InitiativeListItem[] }> {
  return { items: (await typedWorkItems(repository, query.project_id, 'initiative')).map(workItemToInitiativeListItem) };
}

export async function getInitiativeDetail(repository: DeliveryRepository, initiativeId: string): Promise<InitiativeDetail | undefined> {
  const workItem = await typedWorkItemById(repository, initiativeId, 'initiative');
  return workItem === undefined
    ? undefined
    : workItemToInitiativeDetail(workItem, await sourceRelationshipRefs(repository, workItem));
}

export async function listTechDebt(repository: DeliveryRepository, query: ProductListQuery): Promise<{ items: TechDebtListItem[] }> {
  return { items: (await typedWorkItems(repository, query.project_id, 'tech_debt')).map(workItemToTechDebtListItem) };
}

export async function getTechDebtDetail(repository: DeliveryRepository, techDebtId: string): Promise<TechDebtDetail | undefined> {
  const workItem = await typedWorkItemById(repository, techDebtId, 'tech_debt');
  return workItem === undefined ? undefined : workItemToTechDebtDetail(workItem, await sourceRelationshipRefs(repository, workItem));
}

export async function listBugs(repository: DeliveryRepository, query: ProductListQuery): Promise<{ items: BugListItem[] }> {
  return { items: (await typedWorkItems(repository, query.project_id, 'bug')).map(workItemToBugListItem) };
}

export async function getBugDetail(repository: DeliveryRepository, bugId: string): Promise<BugDetail | undefined> {
  const workItem = await typedWorkItemById(repository, bugId, 'bug');
  return workItem === undefined ? undefined : workItemToBugDetail(workItem, await sourceRelationshipRefs(repository, workItem));
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
        { label: 'Source objects', value: workItems.length },
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
          label: 'Execution plans waiting review',
          value: developmentPlanItems.filter(({ item }) => item.execution_plan_status === 'in_review').length,
        },
      ]),
      dashboardSection('role-load', 'Role Load', developmentPlanItems.length, roleLoadMetrics(developmentPlanItems)),
      dashboardSection('release-confidence', 'Release Confidence', releases.length, [
        { label: 'Releases', value: releases.length },
        { label: 'QA accepted', value: qaHandoffs.filter(({ handoff }) => handoff.status === 'accepted').length },
      ]),
    ],
    next_actions: [
      { id: 'unblock-items', label: 'Unblock blocked items', href: '/my-work' },
      { id: 'review-aging-artifacts', label: 'Review aging artifacts', href: '/reports/spec-review-aging' },
      { id: 'continue-executions', label: 'Continue interrupted executions', href: '/reports/execution-continuation' },
    ],
    report_links: reportLinks(),
    degraded_sources: [],
  };
}

export async function listDevelopmentPlanProjections(
  repository: DeliveryRepository,
  query: AiNativeQuery,
): Promise<Record<string, unknown>> {
  const plans = await repository.listDevelopmentPlans(query.project_id);
  const rows = await Promise.all(
    plans.map(async (plan) => {
      const items = await repository.listDevelopmentPlanItems(plan.id);
      return {
        id: plan.id,
        object_ref: developmentPlanRef(plan),
        title: plan.title,
        status: plan.status,
        source_refs: plan.source_refs,
        item_count: items.length,
        blocked_count: items.filter(isDevelopmentPlanItemBlocked).length,
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
  const [itemRevisions, boundaryRevisionCandidates, specs, executionPlans, executions, codeReviewHandoffs, qaHandoffs] = await Promise.all([
    repository.listDevelopmentPlanItemRevisions(item.id),
    listBoundarySummaryRevisionsForItem(repository, item.id),
    repository.listSpecs(plan.project_id),
    repository.listExecutionPlansForDevelopmentPlanItem(item.id),
    listExecutionsForProject(repository, plan.project_id),
    listCodeReviewHandoffsForProject(repository, plan.project_id),
    listQaHandoffsForProject(repository, plan.project_id),
  ]);
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
    boundary_status: item.boundary_status,
    spec_status: item.spec_status,
    execution_plan_status: item.execution_plan_status,
    execution_status: item.execution_status,
    review_status: item.review_status,
    qa_handoff_status: item.qa_handoff_status,
    release_impact: item.release_impact,
    next_action: item.next_action,
    revisions: itemRevisions,
    boundary_summary_revisions: boundaryRevisionCandidates,
    specs: specs.filter((spec) => spec.development_plan_item_id === item.id).map(specQueueRow(repository, plan, item)),
    execution_plans: await Promise.all(executionPlans.map((executionPlan) => executionPlanQueueRow(repository, plan, item, executionPlan))),
    executions: executions
      .filter(({ execution }) => execution.development_plan_item_id === item.id)
      .map(({ execution }) => executionQueueRow(plan, item, execution)),
    code_review_handoffs: codeReviewHandoffs
      .filter(({ handoff }) => handoff.development_plan_item_id === item.id)
      .map(({ handoff, execution }) => codeReviewHandoffItemRow(execution, handoff)),
    qa_handoffs: qaHandoffs
      .filter(({ handoff }) => handoff.development_plan_item_id === item.id)
      .map(({ handoff }) => qaHandoffQueueRow(plan, item, handoff)),
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
    rows.push(...specs.filter((spec) => spec.development_plan_item_id === item.id).map(specQueueRow(repository, plan, item)));
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
  return {
    items: executions.map(({ execution, plan, item }) => executionQueueRow(plan, item, execution)).sort(byUpdatedAtDesc),
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
  const [workItems, developmentPlanItems, releases] = await Promise.all([
    repository.listWorkItems(query.project_id),
    listDevelopmentPlanItemsForProject(repository, query.project_id),
    repository.listReleases(query.project_id),
  ]);
  return {
    items: [
      ...workItems.map(workItemToBoardCard),
      ...developmentPlanItems.map(({ plan, item }) => developmentPlanItemToBoardCard(plan, item)),
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
    type: 'execution_plan_revision' as const,
    id: revision?.id ?? executionPlan.approved_revision_id ?? executionPlan.current_revision_id ?? executionPlan.id,
    execution_plan_id: executionPlan.id,
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
    execution_plan_status: item.execution_plan_status,
    execution_status: item.execution_status,
    review_status: item.review_status,
    qa_handoff_status: item.qa_handoff_status,
    stale: item.spec_status === 'stale' || item.execution_plan_status === 'stale' || item.boundary_status === 'stale',
    blocked: isDevelopmentPlanItemBlocked(item),
    next_action: item.next_action,
    href: `/development-plans/${plan.id}/items/${item.id}`,
    updated_at: item.updated_at,
  };
}

function specQueueRow(_repository: DeliveryRepository, plan: DevelopmentPlan, item: DevelopmentPlanItem) {
  return (spec: Spec) => ({
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
    stale: item.spec_status === 'stale',
    blocked: item.spec_status === 'blocked',
    next_action: item.spec_status === 'approved' ? 'generate_execution_plan' : 'review_spec',
    href: `/development-plans/${plan.id}/items/${item.id}`,
    updated_at: spec.updated_at,
  });
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
    object_ref: { type: 'execution_plan' as const, id: executionPlan.id, title: revision?.summary ?? `${item.title} Execution Plan` },
    artifact_type: 'execution_plan',
    source_ref: item.source_ref,
    development_plan_item_ref: developmentPlanItemRef(item),
    reviewer_actor_id: executionPlan.approved_by_actor_id ?? item.reviewer_actor_id,
    age_seconds: ageSeconds(executionPlan.created_at, executionPlan.updated_at),
    risk: item.risk,
    status: executionPlan.status,
    current_revision_id: executionPlan.current_revision_id,
    approved_revision_id: executionPlan.approved_revision_id,
    approved_revision_ref: revision === undefined ? undefined : executionPlanRevisionRef(executionPlan, revision),
    stale: item.execution_plan_status === 'stale',
    blocked: item.execution_plan_status === 'blocked',
    next_action: executionPlan.status === 'approved' ? 'start_execution' : 'review_execution_plan',
    href: `/development-plans/${plan.id}/items/${item.id}`,
    updated_at: executionPlan.updated_at,
  };
}

function executionQueueRow(plan: DevelopmentPlan, item: DevelopmentPlanItem, execution: Execution): Record<string, unknown> {
  const interrupted = execution.status === 'interrupted' || execution.status === 'paused';
  return {
    id: execution.id,
    object_ref: execution.ref,
    source_ref: item.source_ref,
    development_plan_item_ref: developmentPlanItemRef(item),
    execution_plan_revision_ref: execution.execution_plan_revision_ref,
    status: execution.status,
    worker_state: execution.status,
    current_step: execution.status === 'completed' ? 'code_review_handoff' : 'implementation',
    last_event_at: execution.updated_at,
    evidence_refs: execution.evidence_refs,
    pr_refs: execution.pr_refs,
    diff_refs: execution.diff_refs,
    test_evidence_refs: execution.test_evidence_refs,
    runtime_evidence_refs: execution.runtime_evidence_refs,
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
    approved_execution_plan_revision_ref: handoff.approved_execution_plan_revision_ref,
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
    id: `execution_plan:${executionPlan.id}`,
    object_ref: { type: 'execution_plan', id: executionPlan.id, title: `${item.title} Execution Plan` },
    title: `${item.title} Execution Plan`,
    attention_reason: `execution_plan_${executionPlan.status}`,
    actor_id: executionPlan.approved_by_actor_id ?? item.reviewer_actor_id,
    expected_action: executionPlan.status === 'approved' ? 'Start execution' : 'Review Execution Plan',
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
    status: `${item.boundary_status}/${item.spec_status}/${item.execution_plan_status}/${item.execution_status}`,
    risk: item.risk,
    driver_actor_id: item.driver_actor_id,
    blocked: isDevelopmentPlanItemBlocked(item),
    href: `/development-plans/${plan.id}/items/${item.id}`,
  };
}

function isDevelopmentPlanItemBlocked(item: DevelopmentPlanItem): boolean {
  return (
    item.boundary_status === 'changes_requested' ||
    item.spec_status === 'blocked' ||
    item.spec_status === 'changes_requested' ||
    item.execution_plan_status === 'blocked' ||
    item.execution_plan_status === 'changes_requested' ||
    item.execution_status === 'failed' ||
    item.execution_status === 'interrupted' ||
    item.review_status === 'blocked' ||
    item.review_status === 'changes_requested' ||
    item.qa_handoff_status === 'blocked' ||
    item.qa_handoff_status === 'changes_requested'
  );
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
  return items.filter(({ item }) => item.spec_status === 'in_review' || item.execution_plan_status === 'in_review').length;
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
    'execution-plan-review-aging',
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
        group('draft_or_active', context.developmentPlanItems.length),
        group('approved_items', context.developmentPlanItems.filter(({ item }) => item.execution_plan_status === 'approved').length),
      ];
    case 'brainstorming-bottlenecks':
      return [
        group('not_started', context.developmentPlanItems.filter(({ item }) => item.boundary_status === 'not_started').length),
        group('changes_requested', context.developmentPlanItems.filter(({ item }) => item.boundary_status === 'changes_requested').length),
      ];
    case 'spec-review-aging':
      return [
        group('in_review', context.developmentPlanItems.filter(({ item }) => item.spec_status === 'in_review').length),
        group('changes_requested', context.developmentPlanItems.filter(({ item }) => item.spec_status === 'changes_requested').length),
      ];
    case 'execution-plan-review-aging':
      return [
        group('in_review', context.developmentPlanItems.filter(({ item }) => item.execution_plan_status === 'in_review').length),
        group('changes_requested', context.developmentPlanItems.filter(({ item }) => item.execution_plan_status === 'changes_requested').length),
      ];
    case 'execution-continuation':
      return [
        group('interrupted_or_resumable', context.executions.filter(({ execution }) => execution.status === 'interrupted' || execution.status === 'paused').length),
        group('running', context.executions.filter(({ execution }) => execution.status === 'running').length),
      ];
    case 'execution-outcomes':
      return [
        group('succeeded', context.executions.filter(({ execution }) => execution.status === 'completed').length),
        group('failed', context.executions.filter(({ execution }) => execution.status === 'failed').length),
      ];
    case 'code-review':
      return [
        group('in_review', context.codeReviews.filter(({ handoff }) => handoff.status === 'in_review').length),
        group('approved', context.codeReviews.filter(({ handoff }) => handoff.status === 'approved').length),
        group('changes_requested', context.codeReviews.filter(({ handoff }) => handoff.status === 'changes_requested').length),
      ];
    case 'qa-handoff-readiness':
      return [
        group('pending', context.qaHandoffs.filter(({ handoff }) => handoff.status === 'pending').length),
        group('blocked', context.qaHandoffs.filter(({ handoff }) => handoff.status === 'blocked').length),
        group('accepted', context.qaHandoffs.filter(({ handoff }) => handoff.status === 'accepted').length),
      ];
    case 'release-readiness':
      return [
        group('planned_releases', context.releases.length),
        group('release_blocking_items', context.developmentPlanItems.filter(({ item }) => item.release_impact === 'release_blocking').length),
      ];
    case 'quality-bug-escape':
      return [
        group('escaped_bugs', context.workItems.filter((workItem) => workItem.kind === 'bug' && workItem.phase !== 'done').length),
        group('qa_blockers', context.qaHandoffs.filter(({ handoff }) => handoff.status === 'blocked').length),
      ];
    default:
      return [group('items', context.developmentPlanItems.length)];
  }
}

function group(id: string, count: number): Record<string, unknown> {
  return { id, count, items: [] };
}

function latestUpdatedAt(values: string[]): string | undefined {
  return values.sort((left, right) => right.localeCompare(left))[0];
}

function byUpdatedAtDesc(left: Record<string, unknown>, right: Record<string, unknown>): number {
  const leftUpdated = typeof left.updated_at === 'string' ? left.updated_at : '';
  const rightUpdated = typeof right.updated_at === 'string' ? right.updated_at : '';
  return rightUpdated.localeCompare(leftUpdated);
}

function workItemKindToObjectType(kind: WorkItem['kind']): WorkItemObjectType {
  return kind;
}

async function typedWorkItems(repository: DeliveryRepository, projectId: string, kind: WorkItemObjectType): Promise<TypedWorkItem[]> {
  return (await repository.listWorkItems(projectId)).filter((workItem): workItem is TypedWorkItem => workItem.kind === kind);
}

async function typedWorkItemById(
  repository: DeliveryRepository,
  workItemId: string,
  kind: WorkItemObjectType,
): Promise<TypedWorkItem | undefined> {
  const workItem = await repository.getWorkItem(workItemId);
  return workItem?.kind === kind ? (workItem as TypedWorkItem) : undefined;
}

async function sourceRelationshipRefs(repository: DeliveryRepository, workItem: TypedWorkItem): Promise<ProductObjectRef[]> {
  const sourceRef = { type: workItem.kind, id: workItem.id } as const;
  const sourceLinks = await repository.listDevelopmentPlanSourceLinksForSource(sourceRef);
  const refs: ProductObjectRef[] = [];
  const seen = new Set<string>();

  const push = (ref: ProductObjectRef) => {
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
      push(developmentPlanItemRef(item));
      for (const spec of (await repository.listSpecs(workItem.project_id)).filter((candidate) => candidate.development_plan_item_id === item.id)) {
        push({ type: 'spec', id: spec.id });
      }
      for (const executionPlan of await repository.listExecutionPlansForDevelopmentPlanItem(item.id)) {
        push({ type: 'execution_plan', id: executionPlan.id });
      }
    }
  }

  return refs;
}

function workItemRef(workItem: WorkItem): WorkItemPublicRef {
  return { type: workItemKindToObjectType(workItem.kind), id: workItem.id };
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

function baseWorkItemListItem(workItem: WorkItem) {
  return {
    id: workItem.id,
    ref: workItemRef(workItem),
    title: workItem.title,
    status: `${workItem.phase}/${workItem.activity_state}/${workItem.gate_state}`,
    priority: workItem.priority,
    risk: workItem.risk,
    driver_actor_id: workItem.driver_actor_id,
    updated_at: workItem.updated_at,
  };
}

function baseWorkItemDetail(workItem: TypedWorkItem) {
  return {
    ...baseWorkItemListItem(workItem),
    narrative_markdown: workItem.narrative_markdown,
    evidence_refs: [],
    attachment_refs: [],
  };
}

function workItemToRequirementListItem(workItem: TypedWorkItem): RequirementListItem {
  return { ...baseWorkItemListItem(workItem), ref: { type: 'requirement', id: workItem.id }, phase: workItem.phase };
}

function workItemToRequirementDetail(workItem: TypedWorkItem, relationshipRefs: ProductObjectRef[]): RequirementDetail {
  return {
    ...baseWorkItemDetail(workItem),
    ref: { type: 'requirement', id: workItem.id },
    relationship_refs: relationshipRefs,
    bug_refs: [],
    release_refs: workItem.current_release_id === undefined ? [] : [{ type: 'release', id: workItem.current_release_id }],
  };
}

function workItemToInitiativeListItem(workItem: TypedWorkItem): InitiativeListItem {
  const context = workItem.intake_context.type === 'initiative' ? workItem.intake_context : undefined;
  return { ...baseWorkItemListItem(workItem), ref: { type: 'initiative', id: workItem.id }, business_outcome: context?.business_outcome };
}

function workItemToInitiativeDetail(workItem: TypedWorkItem, relationshipRefs: ProductObjectRef[]): InitiativeDetail {
  return {
    ...baseWorkItemDetail(workItem),
    ref: { type: 'initiative', id: workItem.id },
    relationship_refs: relationshipRefs,
    child_refs: [],
    release_refs: workItem.current_release_id === undefined ? [] : [{ type: 'release', id: workItem.current_release_id }],
  };
}

function workItemToTechDebtListItem(workItem: TypedWorkItem): TechDebtListItem {
  const context = workItem.intake_context.type === 'tech_debt' ? workItem.intake_context : undefined;
  return { ...baseWorkItemListItem(workItem), ref: { type: 'tech_debt', id: workItem.id }, affected_modules: context?.affected_modules ?? [] };
}

function workItemToTechDebtDetail(workItem: TypedWorkItem, relationshipRefs: ProductObjectRef[]): TechDebtDetail {
  const context = workItem.intake_context.type === 'tech_debt' ? workItem.intake_context : undefined;
  return {
    ...baseWorkItemDetail(workItem),
    ref: { type: 'tech_debt', id: workItem.id },
    relationship_refs: relationshipRefs,
    affected_modules: context?.affected_modules ?? [],
    validation_strategy: context?.validation_strategy,
  };
}

function workItemToBugListItem(workItem: TypedWorkItem): BugListItem {
  return { ...baseWorkItemListItem(workItem), ref: { type: 'bug', id: workItem.id }, severity: workItem.risk };
}

function workItemToBugDetail(workItem: TypedWorkItem, relationshipRefs: ProductObjectRef[]): BugDetail {
  const context = workItem.intake_context.type === 'bug' ? workItem.intake_context : undefined;
  return {
    ...baseWorkItemDetail(workItem),
    ref: { type: 'bug', id: workItem.id },
    relationship_refs: relationshipRefs,
    observed_behavior: context?.observed_behavior,
    expected_behavior: context?.expected_behavior,
    reproduction_steps: context?.reproduction_steps ?? [],
  };
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
    case 'plan':
      return { type: 'execution_plan', id: valueToCheck.id };
    case 'plan_revision': {
      const executionPlanId = stringValue(valueToCheck, 'execution_plan_id') ?? stringValue(valueToCheck, 'plan_id');
      return executionPlanId === undefined
        ? undefined
        : { type: 'execution_plan_revision', id: valueToCheck.id, execution_plan_id: executionPlanId };
    }
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

function objectRefKey(ref: ObjectRef): string {
  return `${ref.type}:${ref.id}`;
}
