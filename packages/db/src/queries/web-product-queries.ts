import type {
  InternalProductListQuery,
  PipelineResponse,
  ProductListResponse,
  PublicReplayEntry,
} from '@forgeloop/contracts';
import type { ExecutionPackage, Plan, Release, ReviewPacket, RunSession, Spec, WorkItem } from '@forgeloop/domain';

import type { DeliveryRepository } from '../repositories/delivery-repository';
import { serializePublicReplayEntry } from './public-evidence-serialization';
import { getObjectReplayTimeline } from './replay-queries';

type ProductListItem = ProductListResponse['items'][number];
type ProductObjectRef = ProductListItem['object'];
type ProductObjectType = ProductObjectRef['type'];
type StageId = PipelineResponse['stages'][number]['id'];

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

const supportedFiltersByList = {
  pipeline: new Set<keyof InternalProductListQuery>(['project_id', 'limit']),
  workItems: new Set<keyof InternalProductListQuery>([
    'project_id',
    'status',
    'phase',
    'gate_state',
    'resolution',
    'risk',
    'driver_actor_id',
    'work_item_id',
    'cursor',
    'limit',
  ]),
  specs: new Set<keyof InternalProductListQuery>(['project_id', 'status', 'gate_state', 'resolution', 'work_item_id', 'spec_id', 'cursor', 'limit']),
  plans: new Set<keyof InternalProductListQuery>(['project_id', 'status', 'gate_state', 'resolution', 'work_item_id', 'plan_id', 'cursor', 'limit']),
  packages: new Set<keyof InternalProductListQuery>([
    'project_id',
    'status',
    'phase',
    'gate_state',
    'resolution',
    'execution_owner_actor_id',
    'reviewer_actor_id',
    'qa_owner_actor_id',
    'spec_id',
    'plan_id',
    'spec_revision_id',
    'plan_revision_id',
    'execution_package_id',
    'blocked',
    'cursor',
    'limit',
  ]),
  runs: new Set<keyof InternalProductListQuery>([
    'project_id',
    'status',
    'execution_package_id',
    'run_session_id',
    'executor_type',
    'cursor',
    'limit',
  ]),
  reviews: new Set<keyof InternalProductListQuery>([
    'project_id',
    'status',
    'reviewer_actor_id',
    'spec_revision_id',
    'plan_revision_id',
    'execution_package_id',
    'run_session_id',
    'review_packet_id',
    'decision',
    'cursor',
    'limit',
  ]),
  releases: new Set<keyof InternalProductListQuery>([
    'project_id',
    'phase',
    'gate_state',
    'resolution',
    'release_owner_actor_id',
    'release_id',
    'cursor',
    'limit',
  ]),
};

const providedFilterKeys = (query: InternalProductListQuery): (keyof InternalProductListQuery)[] =>
  Object.entries(query)
    .filter(([, value]) => value !== undefined)
    .map(([key]) => key as keyof InternalProductListQuery);

const degradedForUnsupportedFilters = (source: keyof typeof supportedFiltersByList, query: InternalProductListQuery): string[] =>
  providedFilterKeys(query)
    .filter((key) => !supportedFiltersByList[source].has(key))
    .map((key) => `${source}:unsupported_filter:${key}`);

const objectRef = (type: ProductObjectType, id: string, title?: string): ProductObjectRef => ({
  type,
  id,
  ...(title === undefined ? {} : { title }),
}) as ProductObjectRef;

const workItemObjectRef = (workItem: Pick<WorkItem, 'id' | 'kind' | 'title'>): ProductObjectRef =>
  objectRef(workItem.kind, workItem.id, workItem.title);

const visible = (object: { archived_at?: string; deleted_at?: string }): boolean =>
  object.archived_at === undefined && object.deleted_at === undefined;

const byUpdatedAtDesc = <T extends { updated_at: string; id: string }>(left: T, right: T): number =>
  right.updated_at.localeCompare(left.updated_at) || right.id.localeCompare(left.id);

const paginateItems = (items: ProductListItem[], query: InternalProductListQuery): ProductListResponse => {
  const sorted = [...items].sort(byUpdatedAtDesc);
  const start = query.cursor === undefined ? 0 : Math.max(sorted.findIndex((item) => item.id === query.cursor) + 1, 0);
  const page = sorted.slice(start, start + query.limit);
  const next = sorted[start + query.limit];

  return {
    items: page,
    ...(next === undefined ? {} : { next_cursor: next.id }),
    degraded_sources: [],
  };
};

const latestSpecRevisionNumber = async (repository: DeliveryRepository, spec: Spec): Promise<number | undefined> => {
  const revisions = await repository.listSpecRevisions(spec.id);
  const currentRevision = revisions.find((revision) => revision.id === spec.current_revision_id);
  return currentRevision?.revision_number ?? revisions.at(-1)?.revision_number;
};

const latestPlanRevisionNumber = async (repository: DeliveryRepository, plan: Plan): Promise<number | undefined> => {
  const revisions = await repository.listPlanRevisions(plan.id);
  const currentRevision = revisions.find((revision) => revision.id === plan.current_revision_id);
  return currentRevision?.revision_number ?? revisions.at(-1)?.revision_number;
};

const applyResponseDegradation = (response: ProductListResponse, degradedSources: string[]): ProductListResponse => ({
  ...response,
  degraded_sources: degradedSources,
});

export async function listProductSpecs(
  repository: DeliveryRepository,
  query: InternalProductListQuery,
): Promise<ProductListResponse> {
  const degradedSources = degradedForUnsupportedFilters('specs', query);
  const specs = (await repository.listSpecs(query.project_id))
    .filter((spec) => query.status === undefined || spec.status === query.status)
    .filter((spec) => query.gate_state === undefined || spec.gate_state === query.gate_state)
    .filter((spec) => query.resolution === undefined || spec.resolution === query.resolution)
    .filter((spec) => query.work_item_id === undefined || spec.work_item_id === query.work_item_id)
    .filter((spec) => query.spec_id === undefined || spec.id === query.spec_id);

  const items = await Promise.all(
    specs.map(async (spec): Promise<ProductListItem | undefined> => {
      const workItem = await repository.getWorkItem(spec.work_item_id);
      if (workItem === undefined || !visible(workItem)) {
        return undefined;
      }
      const title = `${workItem.title} Spec`;
      return {
        id: spec.id,
        object: objectRef('spec', spec.id, title),
        title,
        status: spec.status,
        gate_state: spec.gate_state,
        resolution: spec.resolution,
        parent: workItemObjectRef(workItem),
        revision_state: {
          current_revision_id: spec.current_revision_id,
          approved_revision_id: spec.approved_revision_id,
          revision_number: await latestSpecRevisionNumber(repository, spec),
        },
        counts: {},
        related: [],
        updated_at: spec.updated_at,
      };
    }),
  );

  return applyResponseDegradation(paginateItems(items.filter((item): item is ProductListItem => item !== undefined), query), degradedSources);
}

export async function listProductWorkItems(
  repository: DeliveryRepository,
  query: InternalProductListQuery,
): Promise<ProductListResponse> {
  const degradedSources = degradedForUnsupportedFilters('workItems', query);
  const workItems = (await repository.listWorkItems(query.project_id))
    .filter(visible)
    .filter((workItem) => query.status === undefined || workItem.activity_state === query.status)
    .filter((workItem) => query.phase === undefined || workItem.phase === query.phase)
    .filter((workItem) => query.gate_state === undefined || workItem.gate_state === query.gate_state)
    .filter((workItem) => query.resolution === undefined || workItem.resolution === query.resolution)
    .filter((workItem) => query.risk === undefined || workItem.risk === query.risk)
    .filter((workItem) => query.driver_actor_id === undefined || workItem.driver_actor_id === query.driver_actor_id)
    .filter((workItem) => query.work_item_id === undefined || workItem.id === query.work_item_id);

  return applyResponseDegradation(paginateItems(workItems.map(workItemListItem), query), degradedSources);
}

export async function listProductPlans(
  repository: DeliveryRepository,
  query: InternalProductListQuery,
): Promise<ProductListResponse> {
  const degradedSources = degradedForUnsupportedFilters('plans', query);
  const plans = (await repository.listPlans(query.project_id))
    .filter((plan) => query.status === undefined || plan.status === query.status)
    .filter((plan) => query.gate_state === undefined || plan.gate_state === query.gate_state)
    .filter((plan) => query.resolution === undefined || plan.resolution === query.resolution)
    .filter((plan) => query.work_item_id === undefined || plan.work_item_id === query.work_item_id)
    .filter((plan) => query.plan_id === undefined || plan.id === query.plan_id);

  const items = await Promise.all(
    plans.map(async (plan): Promise<ProductListItem | undefined> => {
      const workItem = await repository.getWorkItem(plan.work_item_id);
      if (workItem === undefined || !visible(workItem)) {
        return undefined;
      }
      const title = `${workItem.title} Plan`;
      return {
        id: plan.id,
        object: objectRef('plan', plan.id, title),
        title,
        status: plan.status,
        gate_state: plan.gate_state,
        resolution: plan.resolution,
        parent: workItemObjectRef(workItem),
        revision_state: {
          current_revision_id: plan.current_revision_id,
          approved_revision_id: plan.approved_revision_id,
          revision_number: await latestPlanRevisionNumber(repository, plan),
        },
        counts: {},
        related: [],
        updated_at: plan.updated_at,
      };
    }),
  );

  return applyResponseDegradation(paginateItems(items.filter((item): item is ProductListItem => item !== undefined), query), degradedSources);
}

export async function listProductExecutionPackages(
  repository: DeliveryRepository,
  query: InternalProductListQuery,
): Promise<ProductListResponse> {
  const degradedSources = degradedForUnsupportedFilters('packages', query);
  const packages = (await repository.listExecutionPackages(query.project_id))
    .filter(visible)
    .filter((executionPackage) => query.status === undefined || executionPackage.activity_state === query.status)
    .filter((executionPackage) => query.phase === undefined || executionPackage.phase === query.phase)
    .filter((executionPackage) => query.gate_state === undefined || executionPackage.gate_state === query.gate_state)
    .filter((executionPackage) => query.resolution === undefined || executionPackage.resolution === query.resolution)
    .filter(
      (executionPackage) =>
        query.execution_owner_actor_id === undefined ||
        executionPackage.owner_actor_id === query.execution_owner_actor_id,
    )
    .filter(
      (executionPackage) =>
        query.reviewer_actor_id === undefined || executionPackage.reviewer_actor_id === query.reviewer_actor_id,
    )
    .filter(
      (executionPackage) => query.qa_owner_actor_id === undefined || executionPackage.qa_owner_actor_id === query.qa_owner_actor_id,
    )
    .filter((executionPackage) => query.spec_id === undefined || executionPackage.spec_id === query.spec_id)
    .filter((executionPackage) => query.plan_id === undefined || executionPackage.plan_id === query.plan_id)
    .filter(
      (executionPackage) =>
        query.spec_revision_id === undefined || executionPackage.spec_revision_id === query.spec_revision_id,
    )
    .filter(
      (executionPackage) =>
        query.plan_revision_id === undefined || executionPackage.plan_revision_id === query.plan_revision_id,
    )
    .filter(
      (executionPackage) =>
        query.execution_package_id === undefined || executionPackage.id === query.execution_package_id,
    )
    .filter(
      (executionPackage) =>
        query.blocked === undefined || (query.blocked ? executionPackage.blocked_reason !== undefined : executionPackage.blocked_reason === undefined),
    );

  const items = await Promise.all(packages.map((executionPackage) => executionPackageListItem(repository, executionPackage)));
  return applyResponseDegradation(paginateItems(items.filter((item): item is ProductListItem => item !== undefined), query), degradedSources);
}

export async function listProductRuns(
  repository: DeliveryRepository,
  query: InternalProductListQuery,
): Promise<ProductListResponse> {
  const degradedSources = degradedForUnsupportedFilters('runs', query);
  const runSessions = (await repository.listRunSessions(query.project_id))
    .filter((runSession) => query.status === undefined || runSession.status === query.status)
    .filter((runSession) => query.execution_package_id === undefined || runSession.execution_package_id === query.execution_package_id)
    .filter((runSession) => query.run_session_id === undefined || runSession.id === query.run_session_id)
    .filter((runSession) => query.executor_type === undefined || runSession.executor_type === query.executor_type);

  const items = await Promise.all(
    runSessions.map(async (runSession): Promise<ProductListItem | undefined> => {
      const executionPackage = await repository.getExecutionPackage(runSession.execution_package_id);
      if (executionPackage === undefined || !visible(executionPackage)) {
        return undefined;
      }
      const title = `Run ${runSession.id}`;
      return {
        id: runSession.id,
        object: objectRef('run_session', runSession.id, title),
        title,
        status: runSession.status,
        parent: objectRef('execution_package', executionPackage.id, executionPackage.objective),
        run_state: {
          execution_package_id: runSession.execution_package_id,
          executor_type: runSession.executor_type,
          started_at: runSession.started_at,
          finished_at: runSession.finished_at,
        },
        related: [objectRef('execution_package', executionPackage.id, executionPackage.objective)],
        counts: {
          changed_files: runSession.changed_files.length,
          checks: runSession.check_results.length,
          artifacts: runSession.artifacts.length,
        },
        updated_at: runSession.updated_at,
      };
    }),
  );

  return applyResponseDegradation(paginateItems(items.filter((item): item is ProductListItem => item !== undefined), query), degradedSources);
}

export async function listProductReviewPackets(
  repository: DeliveryRepository,
  query: InternalProductListQuery,
): Promise<ProductListResponse> {
  const degradedSources = degradedForUnsupportedFilters('reviews', query);
  const reviewPackets = (await repository.listReviewPackets(query.project_id))
    .filter((reviewPacket) => query.status === undefined || reviewPacket.status === query.status)
    .filter((reviewPacket) => query.reviewer_actor_id === undefined || reviewPacket.reviewer_actor_id === query.reviewer_actor_id)
    .filter((reviewPacket) => query.spec_revision_id === undefined || reviewPacket.spec_revision_id === query.spec_revision_id)
    .filter((reviewPacket) => query.plan_revision_id === undefined || reviewPacket.plan_revision_id === query.plan_revision_id)
    .filter(
      (reviewPacket) => query.execution_package_id === undefined || reviewPacket.execution_package_id === query.execution_package_id,
    )
    .filter((reviewPacket) => query.run_session_id === undefined || reviewPacket.run_session_id === query.run_session_id)
    .filter((reviewPacket) => query.review_packet_id === undefined || reviewPacket.id === query.review_packet_id)
    .filter((reviewPacket) => query.decision === undefined || reviewPacket.decision === query.decision);

  const items = await Promise.all(reviewPackets.map((reviewPacket) => reviewPacketListItem(repository, reviewPacket)));
  return applyResponseDegradation(paginateItems(items.filter((item): item is ProductListItem => item !== undefined), query), degradedSources);
}

export async function listProductReleases(
  repository: DeliveryRepository,
  query: InternalProductListQuery,
): Promise<ProductListResponse> {
  const degradedSources = degradedForUnsupportedFilters('releases', query);
  const releases = (await repository.listReleases(query.project_id))
    .filter((release) => query.phase === undefined || release.phase === query.phase)
    .filter((release) => query.gate_state === undefined || release.gate_state === query.gate_state)
    .filter((release) => query.resolution === undefined || release.resolution === query.resolution)
    .filter((release) => query.release_owner_actor_id === undefined || release.release_owner_actor_id === query.release_owner_actor_id)
    .filter((release) => query.release_id === undefined || release.id === query.release_id);

  const items = await Promise.all(releases.map((release) => releaseListItem(repository, release)));
  return applyResponseDegradation(paginateItems(items, query), degradedSources);
}

export async function getProductPipeline(
  repository: DeliveryRepository,
  query: InternalProductListQuery,
): Promise<PipelineResponse> {
  const degradedSources = [
    ...degradedForUnsupportedFilters('pipeline', query),
    'pipeline:stale_filter_not_available',
  ];
  const workItems = (await repository.listWorkItems(query.project_id)).filter(visible);
  const specs = await repository.listSpecs(query.project_id);
  const plans = await repository.listPlans(query.project_id);
  const packages = (await repository.listExecutionPackages(query.project_id)).filter(visible);
  const runSessions = await repository.listRunSessions(query.project_id);
  const reviewPackets = await repository.listReviewPackets(query.project_id);
  const releases = await repository.listReleases(query.project_id);
  const itemsByStage = new Map<StageId, ProductListItem[]>();

  for (const stage of pipelineStages) {
    itemsByStage.set(stage.id, []);
  }

  for (const workItem of workItems) {
    itemsByStage.get(stageForWorkItem(workItem))?.push(workItemListItem(workItem));
  }
  for (const spec of specs) {
    const item = await specListItem(repository, spec);
    if (item !== undefined) {
      itemsByStage.get('spec_plan')?.push(item);
    }
  }
  for (const plan of plans) {
    const item = await planListItem(repository, plan);
    if (item !== undefined) {
      itemsByStage.get('spec_plan')?.push(item);
    }
  }
  for (const executionPackage of packages) {
    const item = await executionPackageListItem(repository, executionPackage);
    if (item !== undefined) {
      itemsByStage.get(stageForPackage(executionPackage))?.push(item);
    }
  }
  for (const runSession of runSessions) {
    const item = await runSessionListItem(repository, runSession);
    if (item !== undefined) {
      itemsByStage.get(stageForRunSession(runSession))?.push(item);
    }
  }
  for (const reviewPacket of reviewPackets) {
    const item = await reviewPacketListItem(repository, reviewPacket);
    if (item !== undefined) {
      itemsByStage.get('review')?.push(item);
    }
  }
  for (const release of releases) {
    itemsByStage.get(stageForRelease(release))?.push(await releaseListItem(repository, release));
  }

  return {
    stages: pipelineStages.map((stage) => {
      const items = itemsByStage.get(stage.id) ?? [];
      return {
        id: stage.id,
        label: stage.label,
        item_count: items.length,
        blocked_count: items.filter((item) => item.package_state?.blocked_reason !== undefined).length,
        high_risk_count: items.filter((item) => item.risk === 'high').length,
        stale_count: 0,
        stale_hint: 'Stale/SLA calculation is not available yet for this stage.',
        representative_items: items.sort(byUpdatedAtDesc).slice(0, query.limit),
        degraded: true,
        ...(stage.id === 'integration_validation' ? { integration_readiness: integrationReadinessDetails(packages) } : {}),
        ...(stage.id === 'test_acceptance' ? { test_acceptance: testAcceptanceDetails(packages, releases) } : {}),
      };
    }),
    degraded_sources: degradedSources,
  };
}

export async function getSpecReplayTimeline(
  repository: DeliveryRepository,
  specId: string,
): Promise<PublicReplayEntry[] | undefined> {
  const spec = await repository.getSpec(specId);
  if (spec === undefined) {
    return undefined;
  }
  return getSpecPlanReplayTimeline(repository, 'spec', spec.id, spec.work_item_id);
}

export async function getPlanReplayTimeline(
  repository: DeliveryRepository,
  planId: string,
): Promise<PublicReplayEntry[] | undefined> {
  const plan = await repository.getPlan(planId);
  if (plan === undefined) {
    return undefined;
  }
  return getSpecPlanReplayTimeline(repository, 'plan', plan.id, plan.work_item_id);
}

const getSpecPlanReplayTimeline = async (
  repository: DeliveryRepository,
  objectType: 'spec' | 'plan',
  objectId: string,
  workItemId: string,
): Promise<PublicReplayEntry[] | undefined> => {
  const entries: PublicReplayEntry[] = [];
  for (const item of await repository.listObjectEvents(objectId, objectType)) {
    entries.push(
      serializePublicReplayEntry({
        id: item.id,
        source: 'object_event',
        object_type: item.object_type,
        object_id: item.object_id,
        summary: item.event_type,
        created_at: item.created_at,
        payload: item,
      }),
    );
  }
  for (const item of await repository.listStatusHistory(objectId, objectType)) {
    entries.push(
      serializePublicReplayEntry({
        id: item.id,
        source: 'status_history',
        object_type: item.object_type,
        object_id: item.object_id,
        summary: `${item.from_status ?? 'none'} -> ${item.to_status}`,
        created_at: item.created_at,
        payload: item,
      }),
    );
  }
  for (const item of await repository.listDecisionsForObject(objectType, objectId)) {
    entries.push(
      serializePublicReplayEntry({
        id: item.id,
        source: 'decision',
        object_type: item.object_type,
        object_id: item.object_id,
        summary: item.summary,
        created_at: item.created_at,
        payload: item,
      }),
    );
  }

  const parentReplay = await getObjectReplayTimeline(repository, 'work_item', workItemId);
  if (parentReplay === undefined) {
    return undefined;
  }

  const byId = new Map<string, PublicReplayEntry>();
  for (const entry of [...entries, ...parentReplay]) {
    byId.set(entry.id, entry);
  }

  return [...byId.values()].sort((left, right) => left.created_at.localeCompare(right.created_at));
};

const workItemListItem = (workItem: WorkItem): ProductListItem => ({
  id: workItem.id,
  object: workItemObjectRef(workItem),
  title: workItem.title,
  status: workItem.activity_state,
  phase: workItem.phase,
  gate_state: workItem.gate_state,
  resolution: workItem.resolution,
  risk: workItem.risk,
  driver_actor_id: workItem.driver_actor_id,
  related: [
    ...(workItem.current_spec_id === undefined ? [] : [objectRef('spec', workItem.current_spec_id)]),
    ...(workItem.current_plan_id === undefined ? [] : [objectRef('plan', workItem.current_plan_id)]),
    ...(workItem.current_release_id === undefined ? [] : [objectRef('release', workItem.current_release_id)]),
  ],
  counts: {},
  updated_at: workItem.updated_at,
});

const specListItem = async (
  repository: DeliveryRepository,
  spec: Spec,
): Promise<ProductListItem | undefined> => {
  const workItem = await repository.getWorkItem(spec.work_item_id);
  if (workItem === undefined || !visible(workItem)) {
    return undefined;
  }
  const title = `${workItem.title} Spec`;
  return {
    id: spec.id,
    object: objectRef('spec', spec.id, title),
    title,
    status: spec.status,
    gate_state: spec.gate_state,
    resolution: spec.resolution,
    parent: workItemObjectRef(workItem),
    revision_state: {
      current_revision_id: spec.current_revision_id,
      approved_revision_id: spec.approved_revision_id,
      revision_number: await latestSpecRevisionNumber(repository, spec),
    },
    counts: {},
    related: [],
    updated_at: spec.updated_at,
  };
};

const planListItem = async (
  repository: DeliveryRepository,
  plan: Plan,
): Promise<ProductListItem | undefined> => {
  const workItem = await repository.getWorkItem(plan.work_item_id);
  if (workItem === undefined || !visible(workItem)) {
    return undefined;
  }
  const title = `${workItem.title} Plan`;
  return {
    id: plan.id,
    object: objectRef('plan', plan.id, title),
    title,
    status: plan.status,
    gate_state: plan.gate_state,
    resolution: plan.resolution,
    parent: workItemObjectRef(workItem),
    revision_state: {
      current_revision_id: plan.current_revision_id,
      approved_revision_id: plan.approved_revision_id,
      revision_number: await latestPlanRevisionNumber(repository, plan),
    },
    counts: {},
    related: [],
    updated_at: plan.updated_at,
  };
};

const executionPackageListItem = async (
  repository: DeliveryRepository,
  executionPackage: ExecutionPackage,
): Promise<ProductListItem | undefined> => {
  const workItem = await repository.getWorkItem(executionPackage.work_item_id);
  if (workItem === undefined || !visible(workItem)) {
    return undefined;
  }
  return {
    id: executionPackage.id,
    object: objectRef('execution_package', executionPackage.id, executionPackage.objective),
    title: executionPackage.objective,
    status: executionPackage.activity_state,
    phase: executionPackage.phase,
    gate_state: executionPackage.gate_state,
    resolution: executionPackage.resolution,
    execution_owner_actor_id: executionPackage.owner_actor_id,
    reviewer_actor_id: executionPackage.reviewer_actor_id,
    qa_owner_actor_id: executionPackage.qa_owner_actor_id,
    parent: workItemObjectRef(workItem),
    related: [
      objectRef('spec', executionPackage.spec_id),
      objectRef('plan', executionPackage.plan_id),
      ...(executionPackage.last_run_session_id === undefined
        ? []
        : [objectRef('run_session', executionPackage.last_run_session_id)]),
      ...(executionPackage.current_review_packet_id === undefined
        ? []
        : [objectRef('review_packet', executionPackage.current_review_packet_id)]),
      ...(executionPackage.current_release_id === undefined ? [] : [objectRef('release', executionPackage.current_release_id)]),
    ],
    package_state: {
      scope_ref: workItemObjectRef(workItem),
      spec_revision_id: executionPackage.spec_revision_id,
      plan_revision_id: executionPackage.plan_revision_id,
      blocked_reason: executionPackage.blocked_reason,
      last_run_session_id: executionPackage.last_run_session_id,
      current_run_session_id: executionPackage.current_run_session_id,
      current_review_packet_id: executionPackage.current_review_packet_id,
      integration_readiness: executionPackage.integration_readiness,
      required_test_gates: executionPackage.required_test_gates ?? [],
    },
    counts: {
      required_checks: executionPackage.required_checks.length,
      required_artifact_kinds: executionPackage.required_artifact_kinds.length,
    },
    updated_at: executionPackage.updated_at,
  };
};

const runSessionListItem = async (
  repository: DeliveryRepository,
  runSession: RunSession,
): Promise<ProductListItem | undefined> => {
  const executionPackage = await repository.getExecutionPackage(runSession.execution_package_id);
  if (executionPackage === undefined || !visible(executionPackage)) {
    return undefined;
  }
  const title = `Run ${runSession.id}`;
  return {
    id: runSession.id,
    object: objectRef('run_session', runSession.id, title),
    title,
    status: runSession.status,
    parent: objectRef('execution_package', executionPackage.id, executionPackage.objective),
    run_state: {
      execution_package_id: runSession.execution_package_id,
      executor_type: runSession.executor_type,
      started_at: runSession.started_at,
      finished_at: runSession.finished_at,
    },
    related: [objectRef('execution_package', executionPackage.id, executionPackage.objective)],
    counts: {
      changed_files: runSession.changed_files.length,
      checks: runSession.check_results.length,
      artifacts: runSession.artifacts.length,
    },
    updated_at: runSession.updated_at,
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
  const title = reviewPacket.summary ?? `Review ${reviewPacket.id}`;
  return {
    id: reviewPacket.id,
    object: objectRef('review_packet', reviewPacket.id, title),
    title,
    status: reviewPacket.status,
    reviewer_actor_id: reviewPacket.reviewer_actor_id,
    parent: objectRef('execution_package', executionPackage.id, executionPackage.objective),
    related: [objectRef('run_session', reviewPacket.run_session_id), objectRef('execution_package', executionPackage.id)],
    review_state: {
      execution_package_id: reviewPacket.execution_package_id,
      run_session_id: reviewPacket.run_session_id,
      decision: reviewPacket.decision,
      changed_file_count: reviewPacket.changed_files.length,
    },
    counts: {
      requested_changes: reviewPacket.requested_changes.length,
      risk_notes: reviewPacket.risk_notes.length,
    },
    updated_at: reviewPacket.updated_at,
  };
};

const releaseListItem = async (repository: DeliveryRepository, release: Release): Promise<ProductListItem> => {
  const workItemRefs = (await Promise.all(release.work_item_ids.map((id) => repository.getWorkItem(id))))
    .filter((workItem): workItem is WorkItem => workItem !== undefined && visible(workItem))
    .map(workItemObjectRef);

  return {
    id: release.id,
    object: objectRef('release', release.id, release.title),
    title: release.title,
    status: release.activity_state,
    phase: release.phase,
    gate_state: release.gate_state,
    resolution: release.resolution,
    release_owner_actor_id: release.release_owner_actor_id,
    related: [...workItemRefs, ...release.execution_package_ids.map((id) => objectRef('execution_package', id))],
    release_state: {
      work_item_count: release.work_item_ids.length,
      execution_package_count: release.execution_package_ids.length,
      rollout_complete: release.phase === 'observing' || release.phase === 'completed' || release.phase === 'closed',
      rollback_complete: release.resolution === 'rolled_back',
      observation_complete: release.phase === 'completed' || release.phase === 'closed',
    },
    counts: {
      work_items: release.work_item_ids.length,
      execution_packages: release.execution_package_ids.length,
    },
    updated_at: release.updated_at,
  };
};

const stageForWorkItem = (workItem: WorkItem): StageId => {
  if (workItem.phase === 'draft' || workItem.phase === 'triage') {
    return 'intake';
  }
  if (workItem.phase === 'spec' || workItem.phase === 'plan') {
    return 'spec_plan';
  }
  if (workItem.phase === 'release') {
    return 'release';
  }
  if (workItem.phase === 'observing' || workItem.phase === 'done' || workItem.phase === 'closed') {
    return 'observation';
  }
  return 'execution';
};

const stageForPackage = (executionPackage: ExecutionPackage): StageId => {
  if (executionPackage.phase === 'draft') {
    return 'spec_plan';
  }
  if (executionPackage.phase === 'review') {
    return 'review';
  }
  if (executionPackage.phase === 'integration') {
    return 'integration_validation';
  }
  if (executionPackage.phase === 'test_gate') {
    return 'test_acceptance';
  }
  if (executionPackage.phase === 'release' || executionPackage.phase === 'archived') {
    return 'release';
  }
  return 'execution';
};

const stageForRunSession = (runSession: RunSession): StageId => {
  if (runSession.status === 'failed' || runSession.status === 'timed_out' || runSession.status === 'cancelled') {
    return 'test_acceptance';
  }
  return 'execution';
};

const stageForRelease = (release: Release): StageId => {
  if (release.phase === 'observing' || release.phase === 'completed' || release.phase === 'closed') {
    return 'observation';
  }
  return 'release';
};

const integrationReadinessDetails = (packages: readonly ExecutionPackage[]): PipelineResponse['stages'][number]['integration_readiness'] => {
  const integrationPackages = packages.filter((executionPackage) => stageForPackage(executionPackage) === 'integration_validation');
  const dependencyBlockers = integrationPackages
    .filter((executionPackage) => executionPackage.blocked_reason !== undefined)
    .map((executionPackage) => `${executionPackage.objective}: ${executionPackage.blocked_reason}`);
  const readinessStatus =
    integrationPackages.length === 0
      ? 'No packages are currently in cross-end validation.'
      : dependencyBlockers.length > 0
        ? 'Blocked by package dependencies.'
        : 'Ready for cross-end validation.';
  const waitingPackageRefs = integrationPackages
    .filter((executionPackage) => executionPackage.blocked_reason !== undefined)
    .map((executionPackage) => objectRef('execution_package', executionPackage.id, executionPackage.objective));

  return {
    readiness_status: readinessStatus,
    dependency_blockers: dependencyBlockers,
    contract_mock_readiness: integrationPackages.length
      ? integrationPackages.map((executionPackage) => contractMockReadinessLabel(executionPackage))
      : ['No active integration packages with contract/mock readiness recorded.'],
    environment_requirements: integrationPackages.length
      ? integrationPackages.map((executionPackage) => environmentRequirementLabel(executionPackage))
      : ['No active integration package environment requirements recorded.'],
    waiting_package_refs: waitingPackageRefs,
  };
};

const testAcceptanceDetails = (
  packages: readonly ExecutionPackage[],
  releases: readonly Release[],
): PipelineResponse['stages'][number]['test_acceptance'] => {
  const testPackages = packages.filter((executionPackage) => stageForPackage(executionPackage) === 'test_acceptance');
  const qaOwnerQueues = [...testPackages.reduce((owners, executionPackage) => {
    owners.set(executionPackage.qa_owner_actor_id, (owners.get(executionPackage.qa_owner_actor_id) ?? 0) + 1);
    return owners;
  }, new Map<string, number>())].map(([qa_owner_actor_id, item_count]) => ({ qa_owner_actor_id, item_count }));
  const qualityGates = testPackages.flatMap((executionPackage) =>
    executionPackage.required_checks.map((check) => `${executionPackage.objective}: ${check.display_name}`),
  );
  const missingTestGates = testPackages
    .filter((executionPackage) => (executionPackage.required_test_gates ?? []).length === 0)
    .map((executionPackage) => `${executionPackage.objective}: no required test gates recorded.`);
  const releaseBlockingIssues = releases
    .filter((release) => release.phase === 'approval' || release.gate_state === 'changes_requested' || release.gate_state === 'rollout_failed')
    .map((release) => `${release.title}: release gate ${release.gate_state} / phase ${release.phase}.`);

  return {
    qa_owner_queues: qaOwnerQueues,
    test_strategy_gaps: missingTestGates,
    acceptance_criteria_state: testPackages.length
      ? `${testPackages.length} package${testPackages.length === 1 ? '' : 's'} in test acceptance.`
      : 'No packages are currently in test acceptance.',
    quality_gates: qualityGates.length ? qualityGates : ['No quality gates pending in test acceptance.'],
    regression_coverage_gaps: missingTestGates,
    release_blocking_issues: releaseBlockingIssues,
  };
};

const contractMockReadinessLabel = (executionPackage: ExecutionPackage): string => {
  const readiness = executionPackage.integration_readiness;
  if (readiness !== undefined && Object.keys(readiness).length > 0) {
    return `${executionPackage.objective}: integration readiness recorded.`;
  }
  return `${executionPackage.objective}: no contract/mock readiness recorded.`;
};

const environmentRequirementLabel = (executionPackage: ExecutionPackage): string => {
  if (executionPackage.required_checks.length > 0) {
    return `${executionPackage.objective}: ${executionPackage.required_checks.length} required check${executionPackage.required_checks.length === 1 ? '' : 's'}.`;
  }
  return `${executionPackage.objective}: no explicit environment requirements recorded.`;
};
