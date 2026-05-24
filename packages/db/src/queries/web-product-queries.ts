import type { PipelineResponse, ProductListItem } from '@forgeloop/contracts';
import type {
  CodeReviewHandoff,
  DevelopmentPlan,
  DevelopmentPlanItem,
  Execution,
  ExecutionPackage,
  ExecutionPlanDocument,
  Plan,
  QaHandoff,
  Release,
  ReviewPacket,
  Spec,
  WorkItem,
} from '@forgeloop/domain';

import type { DeliveryRepository } from '../repositories/delivery-repository';

type PipelineStage = PipelineResponse['stages'][number];
type StageId = PipelineStage['id'];
type ProductObjectRef = ProductListItem['object'];
type WorkItemObjectType = Extract<ProductObjectRef['type'], 'initiative' | 'requirement' | 'bug' | 'tech_debt'>;

const pipelineStages: { id: StageId; label: string }[] = [
  { id: 'intake', label: 'Intake' },
  { id: 'spec_plan', label: 'Spec & Plan' },
  { id: 'execution', label: 'Execution' },
  { id: 'review', label: 'Review' },
  { id: 'integration_validation', label: 'Integration Validation' },
  { id: 'test_acceptance', label: 'Test Acceptance' },
  { id: 'release', label: 'Release' },
  { id: 'observation', label: 'Observation' },
];

export async function getProductPipeline(
  repository: DeliveryRepository,
  query: { project_id: string; limit?: number } & Record<string, unknown>,
): Promise<PipelineResponse> {
  const [workItems, developmentPlanItems, specs, legacyPlans, executionPlans, executions, executionPackages, reviewPackets, codeReviews, qaHandoffs, releases] =
    await Promise.all([
      repository.listWorkItems(query.project_id),
      listDevelopmentPlanItemsForProject(repository, query.project_id),
      repository.listSpecs(query.project_id),
      repository.listPlans(query.project_id),
      listExecutionPlansForProject(repository, query.project_id),
      listExecutionsForProject(repository, query.project_id),
      repository.listExecutionPackages(query.project_id),
      repository.listReviewPackets(query.project_id),
      listCodeReviewHandoffsForProject(repository, query.project_id),
      listQaHandoffsForProject(repository, query.project_id),
      repository.listReleases(query.project_id),
    ]);
  const itemsByStage = new Map<StageId, ProductListItem[]>();

  for (const stage of pipelineStages) {
    itemsByStage.set(stage.id, []);
  }

  for (const workItem of workItems.filter(visible)) {
    itemsByStage.get(stageForWorkItem(workItem))?.push(workItemListItem(workItem));
  }
  for (const { plan, item } of developmentPlanItems) {
    itemsByStage.get('spec_plan')?.push(developmentPlanItemListItem(plan, item));
  }
  for (const spec of specs) {
    const item = await specListItem(repository, spec);
    if (item !== undefined) {
      itemsByStage.get('spec_plan')?.push(item);
    }
  }
  for (const plan of legacyPlans) {
    const item = await legacyPlanListItem(repository, plan);
    if (item !== undefined) {
      itemsByStage.get('spec_plan')?.push(item);
    }
  }
  for (const { executionPlan, plan, item } of executionPlans) {
    itemsByStage.get('spec_plan')?.push(executionPlanListItem(executionPlan, plan, item));
  }
  for (const { execution, plan, item } of executions) {
    itemsByStage.get('execution')?.push(executionListItem(execution, plan, item));
  }
  for (const executionPackage of executionPackages.filter(visible)) {
    const item = await executionPackageListItem(repository, executionPackage);
    if (item !== undefined) {
      itemsByStage.get(stageForPackage(executionPackage))?.push(item);
    }
  }
  for (const reviewPacket of reviewPackets) {
    const item = await reviewPacketListItem(repository, reviewPacket);
    if (item !== undefined) {
      itemsByStage.get('review')?.push(item);
    }
  }
  for (const { handoff, execution, plan, item } of codeReviews) {
    itemsByStage.get('review')?.push(codeReviewListItem(handoff, execution, plan, item));
  }
  for (const { handoff, plan, item } of qaHandoffs) {
    itemsByStage.get('test_acceptance')?.push(qaHandoffListItem(handoff, plan, item));
  }
  for (const release of releases) {
    itemsByStage.get(stageForRelease(release))?.push(releaseListItem(release));
  }

  const limit = query.limit ?? 50;
  return {
    stages: pipelineStages.map((stage) => {
      const items = (itemsByStage.get(stage.id) ?? []).sort(byUpdatedAtDesc);
      return {
        id: stage.id,
        label: stage.label,
        item_count: items.length,
        blocked_count: items.filter((item) => item.gate_state === 'blocked' || item.status === 'blocked').length,
        high_risk_count: items.filter((item) => item.risk === 'high').length,
        stale_count: 0,
        stale_hint: 'Stale/SLA calculation is not available yet for this stage.',
        representative_items: items.slice(0, limit),
        degraded: true,
        ...(stage.id === 'integration_validation' ? { integration_readiness: integrationReadinessDetails(executionPackages) } : {}),
        ...(stage.id === 'test_acceptance' ? { test_acceptance: testAcceptanceDetails(qaHandoffs, releases) } : {}),
      };
    }),
    degraded_sources: [...unsupportedPipelineFilters(query), 'pipeline:stale_filter_not_available'],
  };
}

const visible = (object: { archived_at?: string; deleted_at?: string }): boolean =>
  object.archived_at === undefined && object.deleted_at === undefined;

const byUpdatedAtDesc = <T extends { updated_at: string; id: string }>(left: T, right: T): number =>
  right.updated_at.localeCompare(left.updated_at) || right.id.localeCompare(left.id);

const unsupportedPipelineFilters = (query: Record<string, unknown>): string[] =>
  Object.entries(query)
    .filter(([key, value]) => value !== undefined && key !== 'project_id' && key !== 'limit')
    .map(([key]) => `pipeline:unsupported_filter:${key}`);

const objectRef = (type: ProductObjectRef['type'], id: string, title?: string): ProductObjectRef =>
  ({ type, id, ...(title === undefined ? {} : { title }) }) as ProductObjectRef;

const workItemRef = (workItem: WorkItem): ProductObjectRef => objectRef(workItemKindToObjectType(workItem.kind), workItem.id, workItem.title);

const developmentPlanItemRef = (item: DevelopmentPlanItem): ProductObjectRef =>
  ({
    type: 'development_plan_item',
    id: item.id,
    development_plan_id: item.development_plan_id,
    title: item.title,
  }) as ProductObjectRef;

const workItemListItem = (workItem: WorkItem): ProductListItem => ({
  id: workItem.id,
  object: workItemRef(workItem),
  title: workItem.title,
  status: workItem.activity_state,
  phase: workItem.phase,
  gate_state: workItem.gate_state,
  resolution: workItem.resolution,
  risk: workItem.risk,
  driver_actor_id: workItem.driver_actor_id,
  related: [],
  counts: {},
  updated_at: workItem.updated_at,
});

const developmentPlanItemListItem = (plan: DevelopmentPlan, item: DevelopmentPlanItem): ProductListItem => ({
  id: item.id,
  object: developmentPlanItemRef(item),
  title: item.title,
  status: item.next_action,
  gate_state: item.boundary_status,
  risk: item.risk,
  driver_actor_id: item.driver_actor_id,
  parent: objectRef('development_plan', plan.id, plan.title),
  related: [item.source_ref],
  counts: {},
  updated_at: item.updated_at,
});

const specListItem = async (repository: DeliveryRepository, spec: Spec): Promise<ProductListItem | undefined> => {
  const context = await itemContextFor(repository, spec.development_plan_item_id);
  if (context === undefined) {
    const workItem = await repository.getWorkItem(spec.work_item_id);
    if (workItem === undefined || !visible(workItem)) {
      return undefined;
    }
    return {
      id: spec.id,
      object: objectRef('spec', spec.id, `${workItem.title} Spec`),
      title: `${workItem.title} Spec`,
      status: spec.status,
      gate_state: spec.gate_state,
      resolution: spec.resolution,
      parent: workItemRef(workItem),
      related: [],
      counts: {},
      updated_at: spec.updated_at,
    };
  }

  const title = `${context.item.title} Spec`;
  return {
    id: spec.id,
    object: objectRef('spec', spec.id, title),
    title,
    status: spec.status,
    gate_state: spec.gate_state,
    resolution: spec.resolution,
    risk: context.item.risk,
    parent: developmentPlanItemRef(context.item),
    related: [objectRef('development_plan', context.plan.id, context.plan.title), context.item.source_ref],
    counts: {},
    updated_at: spec.updated_at,
  };
};

const executionPlanListItem = (
  executionPlan: ExecutionPlanDocument,
  plan: DevelopmentPlan,
  item: DevelopmentPlanItem,
): ProductListItem => ({
  id: executionPlan.id,
  object: objectRef('execution_plan', executionPlan.id, `${item.title} Execution Plan`),
  title: `${item.title} Execution Plan`,
  status: executionPlan.status,
  risk: item.risk,
  parent: developmentPlanItemRef(item),
  related: [objectRef('development_plan', plan.id, plan.title), item.source_ref],
  counts: {},
  updated_at: executionPlan.updated_at,
});

const legacyPlanListItem = async (repository: DeliveryRepository, plan: Plan): Promise<ProductListItem | undefined> => {
  const context = await itemContextFor(repository, plan.development_plan_item_id);
  if (context === undefined) {
    const workItem = await repository.getWorkItem(plan.work_item_id);
    if (workItem === undefined || !visible(workItem)) {
      return undefined;
    }
    return {
      id: plan.id,
      object: objectRef('execution_plan', plan.id, `${workItem.title} Execution Plan`),
      title: `${workItem.title} Execution Plan`,
      status: plan.status,
      gate_state: plan.gate_state,
      resolution: plan.resolution,
      parent: workItemRef(workItem),
      related: [],
      counts: {},
      updated_at: plan.updated_at,
    };
  }

  return {
    id: plan.id,
    object: objectRef('execution_plan', plan.id, `${context.item.title} Execution Plan`),
    title: `${context.item.title} Execution Plan`,
    status: plan.status,
    gate_state: plan.gate_state,
    resolution: plan.resolution,
    risk: context.item.risk,
    parent: developmentPlanItemRef(context.item),
    related: [objectRef('development_plan', context.plan.id, context.plan.title), context.item.source_ref],
    counts: {},
    updated_at: plan.updated_at,
  };
};

const executionListItem = (execution: Execution, plan: DevelopmentPlan, item: DevelopmentPlanItem): ProductListItem => ({
  id: execution.id,
  object: execution.ref,
  title: execution.ref.title ?? `${item.title} execution`,
  status: execution.status,
  risk: item.risk,
  parent: developmentPlanItemRef(item),
  related: [objectRef('development_plan', plan.id, plan.title), item.source_ref],
  counts: {},
  updated_at: execution.updated_at,
});

const executionPackageListItem = async (
  repository: DeliveryRepository,
  executionPackage: ExecutionPackage,
): Promise<ProductListItem | undefined> => {
  const workItem = await repository.getWorkItem(executionPackage.work_item_id);
  if (workItem === undefined || !visible(workItem)) {
    return undefined;
  }
  const executionId = executionPackage.execution_id ?? executionPackage.id;
  return {
    id: executionPackage.id,
    object: objectRef('execution', executionId, executionPackage.objective),
    title: executionPackage.objective,
    status: executionPackage.activity_state,
    phase: executionPackage.phase,
    gate_state: executionPackage.gate_state,
    resolution: executionPackage.resolution,
    parent: workItemRef(workItem),
    related: [workItemRef(workItem)],
    counts: {
      required_checks: executionPackage.required_checks.length,
      required_artifact_kinds: executionPackage.required_artifact_kinds.length,
    },
    updated_at: executionPackage.updated_at,
  };
};

const reviewPacketListItem = async (
  repository: DeliveryRepository,
  reviewPacket: ReviewPacket,
): Promise<ProductListItem | undefined> => {
  const executionPackage = await repository.getExecutionPackage(reviewPacket.execution_package_id);
  if (executionPackage === undefined || !visible(executionPackage)) {
    return undefined;
  }
  const title = reviewPacket.summary ?? `${executionPackage.objective} code review`;
  return {
    id: reviewPacket.id,
    object: objectRef('code_review_handoff', reviewPacket.id, title),
    title,
    status: reviewPacket.status,
    gate_state: executionPackage.gate_state,
    resolution: reviewPacket.decision,
    reviewer_actor_id: reviewPacket.reviewer_actor_id,
    parent: objectRef('execution', executionPackage.execution_id ?? executionPackage.id, executionPackage.objective),
    related: [],
    counts: {
      requested_changes: reviewPacket.requested_changes.length,
      risk_notes: reviewPacket.risk_notes.length,
    },
    updated_at: reviewPacket.updated_at,
  };
};

const codeReviewListItem = (
  handoff: CodeReviewHandoff,
  execution: Execution,
  plan: DevelopmentPlan,
  item: DevelopmentPlanItem,
): ProductListItem => ({
  id: handoff.id,
  object: handoff.ref,
  title: handoff.ref.title ?? `${item.title} code review`,
  status: handoff.status,
  reviewer_actor_id: handoff.reviewer_actor_id,
  parent: execution.ref,
  related: [developmentPlanItemRef(item), objectRef('development_plan', plan.id, plan.title)],
  counts: {
    blocking_comments: handoff.status === 'changes_requested' ? 1 : 0,
  },
  updated_at: handoff.updated_at,
});

const qaHandoffListItem = (handoff: QaHandoff, plan: DevelopmentPlan, item: DevelopmentPlanItem): ProductListItem => ({
  id: handoff.id,
  object: handoff.ref,
  title: handoff.ref.title ?? `${item.title} QA handoff`,
  status: handoff.status,
  risk: item.risk,
  parent: objectRef('execution', handoff.execution_id),
  related: [developmentPlanItemRef(item), objectRef('development_plan', plan.id, plan.title)],
  counts: {
    acceptance_criteria: handoff.acceptance_criteria.length,
    known_risks: handoff.known_risks.length,
  },
  updated_at: handoff.updated_at,
});

const releaseListItem = (release: Release): ProductListItem => ({
  id: release.id,
  object: objectRef('release', release.id, release.title),
  title: release.title,
  status: release.activity_state,
  phase: release.phase,
  gate_state: release.gate_state,
  resolution: release.resolution,
  release_owner_actor_id: release.release_owner_actor_id,
  related: release.work_item_ids.map((id) => objectRef('requirement', id)),
  release_state: {
    source_object_count: release.work_item_ids.length,
    delivery_evidence_count: release.execution_package_ids.length,
    rollout_complete: release.phase === 'observing' || release.phase === 'completed' || release.phase === 'closed',
    rollback_complete: release.resolution === 'rolled_back',
    observation_complete: release.phase === 'completed' || release.phase === 'closed',
  },
  counts: {
    scope_refs: release.work_item_ids.length,
  },
  updated_at: release.updated_at,
});

async function listDevelopmentPlanItemsForProject(
  repository: DeliveryRepository,
  projectId: string,
): Promise<Array<{ plan: DevelopmentPlan; item: DevelopmentPlanItem }>> {
  const plans = await repository.listDevelopmentPlans(projectId);
  const rows = await Promise.all(
    plans.map(async (plan) => (await repository.listDevelopmentPlanItems(plan.id)).map((item) => ({ plan, item }))),
  );
  return rows.flat();
}

async function listExecutionPlansForProject(
  repository: DeliveryRepository,
  projectId: string,
): Promise<Array<{ executionPlan: ExecutionPlanDocument; plan: DevelopmentPlan; item: DevelopmentPlanItem }>> {
  const itemContexts = await listDevelopmentPlanItemsForProject(repository, projectId);
  const rows = await Promise.all(
    itemContexts.map(async ({ plan, item }) =>
      (await repository.listExecutionPlansForDevelopmentPlanItem(item.id)).map((executionPlan) => ({ executionPlan, plan, item })),
    ),
  );
  return rows.flat();
}

async function listExecutionsForProject(
  repository: DeliveryRepository,
  projectId: string,
): Promise<Array<{ execution: Execution; plan: DevelopmentPlan; item: DevelopmentPlanItem }>> {
  const rows: Array<{ execution: Execution; plan: DevelopmentPlan; item: DevelopmentPlanItem }> = [];
  for (const execution of await repository.listExecutions()) {
    const context = await itemContextFor(repository, execution.development_plan_item_id);
    if (context !== undefined && context.plan.project_id === projectId) {
      rows.push({ execution, ...context });
    }
  }
  return rows;
}

async function listCodeReviewHandoffsForProject(
  repository: DeliveryRepository,
  projectId: string,
): Promise<Array<{ handoff: CodeReviewHandoff; execution: Execution; plan: DevelopmentPlan; item: DevelopmentPlanItem }>> {
  const rows: Array<{ handoff: CodeReviewHandoff; execution: Execution; plan: DevelopmentPlan; item: DevelopmentPlanItem }> = [];
  for (const handoff of await repository.listCodeReviewHandoffs()) {
    const execution = await repository.getExecution(handoff.execution_id);
    if (execution === undefined) {
      continue;
    }
    const context = await itemContextFor(repository, handoff.development_plan_item_id);
    if (context !== undefined && context.plan.project_id === projectId) {
      rows.push({ handoff, execution, ...context });
    }
  }
  return rows;
}

async function listQaHandoffsForProject(
  repository: DeliveryRepository,
  projectId: string,
): Promise<Array<{ handoff: QaHandoff; plan: DevelopmentPlan; item: DevelopmentPlanItem }>> {
  const rows: Array<{ handoff: QaHandoff; plan: DevelopmentPlan; item: DevelopmentPlanItem }> = [];
  for (const handoff of await repository.listQaHandoffs()) {
    const context = await itemContextFor(repository, handoff.development_plan_item_id);
    if (context !== undefined && context.plan.project_id === projectId) {
      rows.push({ handoff, ...context });
    }
  }
  return rows;
}

async function itemContextFor(
  repository: DeliveryRepository,
  developmentPlanItemId: string | undefined,
): Promise<{ plan: DevelopmentPlan; item: DevelopmentPlanItem } | undefined> {
  if (developmentPlanItemId === undefined) {
    return undefined;
  }
  const item = await repository.getDevelopmentPlanItem(developmentPlanItemId);
  if (item === undefined) {
    return undefined;
  }
  const plan = await repository.getDevelopmentPlan(item.development_plan_id);
  return plan === undefined ? undefined : { plan, item };
}

const stageForWorkItem = (workItem: WorkItem): StageId => {
  if (workItem.phase === 'draft' || workItem.phase === 'triage') return 'intake';
  if (workItem.phase === 'spec' || workItem.phase === 'plan') return 'spec_plan';
  if (workItem.phase === 'release') return 'release';
  if (workItem.phase === 'observing' || workItem.phase === 'done' || workItem.phase === 'closed') return 'observation';
  return 'execution';
};

const stageForPackage = (executionPackage: ExecutionPackage): StageId => {
  if (executionPackage.phase === 'draft') return 'spec_plan';
  if (executionPackage.phase === 'review') return 'review';
  if (executionPackage.phase === 'integration') return 'integration_validation';
  if (executionPackage.phase === 'test_gate') return 'test_acceptance';
  if (executionPackage.phase === 'release' || executionPackage.phase === 'archived') return 'release';
  return 'execution';
};

const stageForRelease = (release: Release): StageId =>
  release.phase === 'observing' || release.phase === 'completed' || release.phase === 'closed' ? 'observation' : 'release';

const integrationReadinessDetails = (executionPackages: readonly ExecutionPackage[]): PipelineStage['integration_readiness'] => {
  const integrationExecutions = executionPackages.filter((executionPackage) => stageForPackage(executionPackage) === 'integration_validation');
  const dependencyBlockers = integrationExecutions
    .filter((executionPackage) => executionPackage.blocked_reason !== undefined)
    .map((executionPackage) => `${executionPackage.objective}: ${executionPackage.blocked_reason}`);

  return {
    readiness_status:
      integrationExecutions.length === 0
        ? 'No executions are currently in cross-end validation.'
        : dependencyBlockers.length > 0
          ? 'Blocked by execution dependencies.'
          : 'Ready for cross-end validation.',
    dependency_blockers: dependencyBlockers,
    contract_mock_readiness: integrationExecutions.length
      ? integrationExecutions.map((executionPackage) => `${executionPackage.objective}: contract/mock readiness tracked on execution.`)
      : ['No active integration executions with contract/mock readiness recorded.'],
    environment_requirements: integrationExecutions.length
      ? integrationExecutions.map((executionPackage) => `${executionPackage.objective}: environment requirements tracked on execution.`)
      : ['No active integration execution environment requirements recorded.'],
    waiting_package_refs: integrationExecutions
      .filter((executionPackage) => executionPackage.blocked_reason !== undefined)
      .map((executionPackage) => objectRef('execution', executionPackage.execution_id ?? executionPackage.id, executionPackage.objective)),
  };
};

const testAcceptanceDetails = (
  qaHandoffs: ReadonlyArray<{ handoff: QaHandoff; plan: DevelopmentPlan; item: DevelopmentPlanItem }>,
  releases: readonly Release[],
): PipelineStage['test_acceptance'] => {
  const pendingHandoffs = qaHandoffs.filter(({ handoff }) => handoff.status === 'pending' || handoff.status === 'blocked');
  const releaseBlockingIssues = releases
    .filter((release) => release.phase === 'approval' || release.gate_state === 'changes_requested' || release.gate_state === 'rollout_failed')
    .map((release) => `${release.title}: release gate ${release.gate_state} / phase ${release.phase}.`);

  return {
    qa_owner_queues: [],
    test_strategy_gaps: pendingHandoffs
      .filter(({ handoff }) => handoff.test_strategy.length === 0)
      .map(({ item }) => `${item.title}: no QA test strategy recorded.`),
    acceptance_criteria_state: pendingHandoffs.length
      ? `${pendingHandoffs.length} QA handoff${pendingHandoffs.length === 1 ? '' : 's'} pending.`
      : 'No QA handoffs are currently pending.',
    quality_gates: pendingHandoffs.length
      ? pendingHandoffs.map(({ item, handoff }) => `${item.title}: QA ${handoff.status}.`)
      : ['No quality gates pending in QA handoff.'],
    regression_coverage_gaps: pendingHandoffs
      .filter(({ handoff }) => handoff.acceptance_criteria.length === 0)
      .map(({ item }) => `${item.title}: no acceptance criteria recorded.`),
    release_blocking_issues: releaseBlockingIssues,
  };
};

const workItemKindToObjectType = (kind: WorkItem['kind']): WorkItemObjectType =>
  kind === 'tech_debt' ? 'tech_debt' : kind;
