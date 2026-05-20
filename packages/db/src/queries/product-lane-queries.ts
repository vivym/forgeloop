import {
  productLaneResponseSchema,
  type ProductLaneId,
  type ProductLaneResponse,
  type ProductObjectType,
} from '@forgeloop/contracts';
import type {
  ExecutionPackage,
  Release,
  ReviewPacket,
  SpecPlan,
  WorkItem,
  WorkItemKind,
} from '@forgeloop/domain';
import { isOpenReviewPacketStatus } from '@forgeloop/domain';

import type { DeliveryRepository } from '../repositories/delivery-repository';
import {
  generatePackagesAction,
  generatePlanDraftAction,
  generateSpecDraftAction,
  laneTarget,
  markPackageReadyAction,
  navigateAction,
  objectTarget,
  runPackageAction,
} from './product-action-builders';
import {
  buildProductLaneResponse,
  matchesProductLaneFilters,
  paginateProductLaneItems,
} from './product-lane-filters';
import {
  laneForWorkItemKind,
  productLaneMetadata,
  workItemKindByLane,
  type ParsedProductLaneFilters,
  type ProductLaneProjectionItem,
} from './product-lane-types';

const staleAfterMs = 7 * 24 * 60 * 60 * 1000;

const isVisible = (object: { archived_at?: string; deleted_at?: string }): boolean =>
  object.archived_at === undefined && object.deleted_at === undefined;

const byUpdatedAtDesc = <T extends { updated_at?: string; created_at?: string; id: string }>(left: T, right: T): number => {
  const leftTime = Date.parse(left.updated_at ?? left.created_at ?? '');
  const rightTime = Date.parse(right.updated_at ?? right.created_at ?? '');
  return (Number.isNaN(rightTime) ? 0 : rightTime) - (Number.isNaN(leftTime) ? 0 : leftTime) || right.id.localeCompare(left.id);
};

const isStale = (updatedAt: string): boolean => {
  const updatedTime = Date.parse(updatedAt);
  return Number.isFinite(updatedTime) && Date.now() - updatedTime > staleAfterMs;
};

const uniqueStrings = (values: readonly (string | undefined)[]): string[] => [...new Set(values.filter((value): value is string => value !== undefined))];

const itemBase = (
  input: {
    id: string;
    laneId: ProductLaneId;
    title: string;
    object: ProductLaneProjectionItem['object'];
    projectId: string;
    updatedAt: string;
    workItem?: WorkItem | undefined;
    parent?: ProductLaneProjectionItem['parent'] | undefined;
    surfaceType?: string | undefined;
    phase?: string | undefined;
    status?: string | undefined;
    gateState?: string | undefined;
    resolution?: string | undefined;
    risk?: string | undefined;
    actorIdValues?: readonly string[] | undefined;
    ownerActorId?: string | undefined;
    ownerActorIdValues?: readonly string[] | undefined;
    reviewerActorId?: string | undefined;
    reviewerActorIdValues?: readonly string[] | undefined;
    qaOwnerActorId?: string | undefined;
    qaOwnerActorIdValues?: readonly string[] | undefined;
    releaseOwnerActorId?: string | undefined;
    releaseOwnerActorIdValues?: readonly string[] | undefined;
    kindValues?: readonly string[] | undefined;
    phaseValues?: readonly string[] | undefined;
    statusValues?: readonly string[] | undefined;
    gateStateValues?: readonly string[] | undefined;
    resolutionValues?: readonly string[] | undefined;
    riskValues?: readonly string[] | undefined;
    blocked?: boolean | undefined;
    stale?: boolean | undefined;
  },
  actions: ProductLaneProjectionItem['actions'],
): ProductLaneProjectionItem => {
  const kind = input.workItem?.kind;
  const risk = input.risk ?? input.workItem?.risk;
  const phase = input.phase ?? input.workItem?.phase;
  const status = input.status ?? input.gateState ?? input.resolution ?? input.workItem?.gate_state;
  const gateState = input.gateState ?? input.workItem?.gate_state;
  const resolution = input.resolution ?? input.workItem?.resolution;

  return {
    id: input.id,
    title: input.title,
    object: input.object,
    ...(input.parent === undefined ? {} : { parent: input.parent }),
    ...(kind === undefined ? {} : { kind }),
    ...(input.surfaceType === undefined ? {} : { surface_type: input.surfaceType }),
    ...(phase === undefined ? {} : { phase }),
    ...(status === undefined ? {} : { status }),
    ...(gateState === undefined ? {} : { gate_state: gateState }),
    ...(resolution === undefined ? {} : { resolution }),
    ...(risk === undefined ? {} : { risk }),
    updated_at: input.updatedAt,
    actions,
    project_id: input.projectId,
    ...(input.actorIdValues === undefined ? {} : { actor_id_values: input.actorIdValues }),
    ...(input.ownerActorId === undefined && input.workItem?.owner_actor_id === undefined
      ? {}
      : { owner_actor_id: input.ownerActorId ?? input.workItem?.owner_actor_id }),
    ...(input.ownerActorIdValues === undefined ? {} : { owner_actor_id_values: input.ownerActorIdValues }),
    ...(input.reviewerActorId === undefined ? {} : { reviewer_actor_id: input.reviewerActorId }),
    ...(input.reviewerActorIdValues === undefined ? {} : { reviewer_actor_id_values: input.reviewerActorIdValues }),
    ...(input.qaOwnerActorId === undefined ? {} : { qa_owner_actor_id: input.qaOwnerActorId }),
    ...(input.qaOwnerActorIdValues === undefined ? {} : { qa_owner_actor_id_values: input.qaOwnerActorIdValues }),
    ...(input.releaseOwnerActorId === undefined ? {} : { release_owner_actor_id: input.releaseOwnerActorId }),
    ...(input.releaseOwnerActorIdValues === undefined ? {} : { release_owner_actor_id_values: input.releaseOwnerActorIdValues }),
    kind_values: input.kindValues ?? (kind === undefined ? undefined : [kind]),
    phase_values: input.phaseValues ?? (phase === undefined ? undefined : [phase]),
    status_values: input.statusValues ?? (status === undefined ? undefined : [status]),
    gate_state_values: input.gateStateValues ?? (gateState === undefined ? undefined : [gateState]),
    resolution_values: input.resolutionValues ?? (resolution === undefined ? undefined : [resolution]),
    risk_values: input.riskValues ?? (risk === undefined ? undefined : [risk]),
    blocked: input.blocked ?? gateState === 'changes_requested',
    stale: input.stale ?? isStale(input.updatedAt),
  };
};

const openObjectAction = (
  laneId: ProductLaneId,
  objectType: ProductObjectType,
  objectId: string,
  label: string,
  href: string,
) =>
  navigateAction({
    id: `open-${objectType}-${objectId}`,
    laneId,
    priority: 'primary',
    label,
    target: objectTarget(objectType, objectId, href),
  });

const workItemAction = (laneId: ProductLaneId, workItem: WorkItem, priority: 'primary' | 'secondary' = 'primary') =>
  navigateAction({
    id: `open-work-item-${workItem.id}`,
    laneId,
    priority,
    label: 'Open Work Item',
    target: objectTarget('work_item', workItem.id, `/work-items/${workItem.id}`),
  });

const workItemLaneItem = (laneId: ProductLaneId, workItem: WorkItem): ProductLaneProjectionItem =>
  itemBase(
    {
      id: workItem.id,
      laneId,
      title: workItem.title,
      object: { type: 'work_item', id: workItem.id },
      projectId: workItem.project_id,
      updatedAt: workItem.updated_at,
      workItem,
      surfaceType: 'work_item',
      blocked: workItem.activity_state === 'awaiting_ai' || workItem.gate_state.includes('changes_requested'),
    },
    [workItemAction(laneId, workItem)],
  );

const specPlanItem = async (
  repository: DeliveryRepository,
  laneId: ProductLaneId,
  item: SpecPlan,
  workItem: WorkItem,
): Promise<ProductLaneProjectionItem> => {
  const objectType = item.entity_type;
  const [revision, decisions] = await Promise.all([
    item.current_revision_id === undefined
      ? undefined
      : item.entity_type === 'spec'
        ? repository.getSpecRevision(item.current_revision_id)
        : repository.getPlanRevision(item.current_revision_id),
    repository.listDecisionsForObject(objectType, item.id),
  ]);
  const approvalActorIds = uniqueStrings([
    item.approved_by_actor_id,
    ...decisions.flatMap((decision) => [decision.actor_id, decision.decided_by_actor_id]),
  ]);

  return itemBase(
    {
      id: item.id,
      laneId,
      title: revision?.summary ?? workItem.title,
      object: { type: objectType, id: item.id },
      parent: { type: 'work_item', id: workItem.id, title: workItem.title },
      projectId: workItem.project_id,
      updatedAt: item.updated_at,
      workItem,
      surfaceType: objectType,
      phase: item.entity_type,
      status: item.gate_state,
      gateState: item.gate_state,
      resolution: item.resolution,
      actorIdValues: approvalActorIds,
      blocked: item.gate_state === 'changes_requested',
    },
    [openObjectAction(laneId, objectType, item.id, `Open ${objectType === 'spec' ? 'Spec' : 'Plan'}`, `/${objectType}s/${item.id}`)],
  );
};

const packageItem = (
  laneId: ProductLaneId,
  executionPackage: ExecutionPackage,
  workItem: WorkItem,
): ProductLaneProjectionItem => {
  const actions = [
    openObjectAction(laneId, 'execution_package', executionPackage.id, 'Open Package', `/packages/${executionPackage.id}`),
  ];

  if (executionPackage.phase === 'draft' || executionPackage.gate_state === 'changes_requested') {
    actions.unshift(
      markPackageReadyAction({
        id: `mark-package-ready-${executionPackage.id}`,
        laneId,
        priority: 'primary',
        label: 'Mark package ready',
        workItemId: workItem.id,
        packageId: executionPackage.id,
        expectedPackageVersion: executionPackage.version,
        target: objectTarget('execution_package', executionPackage.id, `/packages/${executionPackage.id}`),
      }),
    );
  }

  if (executionPackage.phase === 'ready' && executionPackage.gate_state === 'not_submitted') {
    actions.unshift(
      runPackageAction({
        id: `run-package-${executionPackage.id}`,
        laneId,
        priority: 'primary',
        label: 'Run package',
        workItemId: workItem.id,
        packageId: executionPackage.id,
        target: objectTarget('execution_package', executionPackage.id, `/packages/${executionPackage.id}`),
      }),
    );
  }

  return itemBase(
    {
      id: executionPackage.id,
      laneId,
      title: executionPackage.objective,
      object: { type: 'execution_package', id: executionPackage.id },
      parent: { type: 'work_item', id: workItem.id, title: workItem.title },
      projectId: executionPackage.project_id,
      updatedAt: executionPackage.updated_at,
      workItem,
      surfaceType: 'execution_package',
      phase: executionPackage.phase,
      status: executionPackage.gate_state,
      gateState: executionPackage.gate_state,
      resolution: executionPackage.resolution,
      ownerActorId: executionPackage.owner_actor_id,
      reviewerActorId: executionPackage.reviewer_actor_id,
      qaOwnerActorId: executionPackage.qa_owner_actor_id,
      blocked: executionPackage.activity_state === 'blocked' || executionPackage.blocked_reason !== undefined,
    },
    actions,
  );
};

const packageReadOnlyItem = (
  laneId: ProductLaneId,
  executionPackage: ExecutionPackage,
  workItem: WorkItem,
): ProductLaneProjectionItem =>
  itemBase(
    {
      id: executionPackage.id,
      laneId,
      title: executionPackage.objective,
      object: { type: 'execution_package', id: executionPackage.id },
      parent: { type: 'work_item', id: workItem.id, title: workItem.title },
      projectId: executionPackage.project_id,
      updatedAt: executionPackage.updated_at,
      workItem,
      surfaceType: 'execution_package',
      phase: executionPackage.phase,
      status: executionPackage.gate_state,
      gateState: executionPackage.gate_state,
      resolution: executionPackage.resolution,
      ownerActorId: executionPackage.owner_actor_id,
      reviewerActorId: executionPackage.reviewer_actor_id,
      qaOwnerActorId: executionPackage.qa_owner_actor_id,
      blocked: executionPackage.activity_state === 'blocked' || executionPackage.blocked_reason !== undefined,
    },
    [openObjectAction(laneId, 'execution_package', executionPackage.id, 'Open Package', `/packages/${executionPackage.id}`)],
  );

const reviewPacketItem = (
  laneId: ProductLaneId,
  reviewPacket: ReviewPacket,
  executionPackage: ExecutionPackage,
  workItem: WorkItem,
): ProductLaneProjectionItem =>
  itemBase(
    {
      id: reviewPacket.id,
      laneId,
      title: reviewPacket.summary ?? executionPackage.objective,
      object: { type: 'review_packet', id: reviewPacket.id },
      parent: { type: 'execution_package', id: executionPackage.id, title: executionPackage.objective },
      projectId: executionPackage.project_id,
      updatedAt: reviewPacket.updated_at,
      workItem,
      surfaceType: 'review_packet',
      phase: executionPackage.phase,
      status: reviewPacket.status,
      resolution: reviewPacket.decision,
      reviewerActorId: reviewPacket.reviewer_actor_id,
      blocked: reviewPacket.requested_changes.length > 0,
    },
    [openObjectAction(laneId, 'review_packet', reviewPacket.id, 'Open Review', `/reviews/${reviewPacket.id}`)],
  );

const releaseItem = async (
  repository: DeliveryRepository,
  laneId: ProductLaneId,
  release: Release,
): Promise<ProductLaneProjectionItem> => {
  const workItems = (await Promise.all(release.work_item_ids.map((workItemId) => repository.getWorkItem(workItemId)))).filter(
    (workItem): workItem is WorkItem => workItem !== undefined,
  );
  const executionPackages = (
    await Promise.all(release.execution_package_ids.map((executionPackageId) => repository.getExecutionPackage(executionPackageId)))
  ).filter((executionPackage): executionPackage is ExecutionPackage => executionPackage !== undefined);
  const riskValues = workItems.map((workItem) => workItem.risk);
  const kindValues = workItems.map((workItem) => workItem.kind);

  return itemBase(
    {
      id: release.id,
      laneId,
      title: release.title,
      object: { type: 'release', id: release.id },
      projectId: release.project_id,
      updatedAt: release.updated_at,
      workItem: workItems[0],
      surfaceType: 'release',
      phase: release.phase,
      status: release.gate_state,
      gateState: release.gate_state,
      resolution: release.resolution,
      releaseOwnerActorId: release.release_owner_actor_id,
      qaOwnerActorId: executionPackages[0]?.qa_owner_actor_id,
      qaOwnerActorIdValues: [...new Set(executionPackages.map((executionPackage) => executionPackage.qa_owner_actor_id))],
      kindValues,
      riskValues,
      blocked: release.activity_state === 'blocked' || release.gate_state === 'changes_requested',
    },
    [openObjectAction(laneId, 'release', release.id, 'Open Release', `/releases/${release.id}`)],
  );
};

const managerItem = (
  laneId: ProductLaneId,
  id: string,
  title: string,
  projectId: string,
  updatedAt: string,
  values: {
    kindValues: readonly string[];
    phaseValues: readonly string[];
    statusValues: readonly string[];
    gateStateValues: readonly string[];
    resolutionValues: readonly string[];
    riskValues: readonly string[];
    blocked: boolean;
    stale: boolean;
  },
): ProductLaneProjectionItem =>
  itemBase(
    {
      id,
      laneId,
      title,
      object: { type: 'lane_summary', id, lane_id: laneId },
      projectId,
      updatedAt,
      surfaceType: 'lane_summary',
      kindValues: values.kindValues,
      phaseValues: values.phaseValues,
      statusValues: values.statusValues,
      gateStateValues: values.gateStateValues,
      resolutionValues: values.resolutionValues,
      riskValues: values.riskValues,
      blocked: values.blocked,
      stale: values.stale,
    },
    [
      navigateAction({
        id: `open-${id}`,
        laneId,
        priority: 'primary',
        label: 'Open drill-down',
        target: laneTarget(laneId),
      }),
    ],
  );

const visibleWorkItems = async (repository: DeliveryRepository, projectId: string): Promise<WorkItem[]> =>
  (await repository.listWorkItems(projectId)).filter(isVisible).sort(byUpdatedAtDesc);

const packagesWithWorkItems = async (
  repository: DeliveryRepository,
  projectId: string,
): Promise<Array<{ executionPackage: ExecutionPackage; workItem: WorkItem }>> => {
  const packages = (await repository.listExecutionPackages(projectId)).filter(isVisible).sort(byUpdatedAtDesc);
  const rows = await Promise.all(
    packages.map(async (executionPackage) => ({
      executionPackage,
      workItem: await repository.getWorkItem(executionPackage.work_item_id),
    })),
  );
  return rows.filter((row): row is { executionPackage: ExecutionPackage; workItem: WorkItem } => row.workItem !== undefined);
};

const loadProductLaneCandidates = async (
  repository: DeliveryRepository,
  laneId: ProductLaneId,
  filters: ParsedProductLaneFilters,
): Promise<ProductLaneProjectionItem[]> => {
  if (laneId in workItemKindByLane) {
    const canonicalKind = workItemKindByLane[laneId as keyof typeof workItemKindByLane] as WorkItemKind;
    return (await visibleWorkItems(repository, filters.project_id))
      .filter((workItem) => workItem.kind === canonicalKind)
      .map((workItem) => workItemLaneItem(laneId, workItem));
  }

  if (laneId === 'spec-approver') {
    const rows = await Promise.all(
      (await visibleWorkItems(repository, filters.project_id)).map(async (workItem) => {
        const [spec, plan] = await Promise.all([
          workItem.current_spec_id === undefined ? undefined : repository.getSpec(workItem.current_spec_id),
          workItem.current_plan_id === undefined ? undefined : repository.getPlan(workItem.current_plan_id),
        ]);
        return Promise.all(
          [spec, plan]
            .filter(
              (item): item is SpecPlan =>
                item !== undefined && (item.gate_state === 'awaiting_approval' || item.gate_state === 'changes_requested'),
            )
            .map((item) => specPlanItem(repository, laneId, item, workItem)),
        );
      }),
    );
    return rows.flat().sort(byUpdatedAtDesc);
  }

  if (laneId === 'execution-owner') {
    return (await packagesWithWorkItems(repository, filters.project_id))
      .filter(({ executionPackage }) => executionPackage.phase !== 'release' && executionPackage.phase !== 'archived')
      .map(({ executionPackage, workItem }) => packageItem(laneId, executionPackage, workItem));
  }

  if (laneId === 'reviewer') {
    const rows = await Promise.all(
      (await packagesWithWorkItems(repository, filters.project_id)).map(async ({ executionPackage, workItem }) =>
        (await repository.listReviewPacketsForPackage(executionPackage.id))
          .filter((reviewPacket) => isOpenReviewPacketStatus(reviewPacket.status))
          .map((reviewPacket) => reviewPacketItem(laneId, reviewPacket, executionPackage, workItem)),
      ),
    );
    return rows.flat().sort(byUpdatedAtDesc);
  }

  if (laneId === 'qa-test-owner') {
    const packageRows = await packagesWithWorkItems(repository, filters.project_id);
    const workItemGroups = new Map<string, { workItem: WorkItem; qaOwnerActorIds: string[] }>();
    for (const { executionPackage, workItem } of packageRows) {
      const group = workItemGroups.get(workItem.id) ?? { workItem, qaOwnerActorIds: [] };
      group.qaOwnerActorIds = uniqueStrings([...group.qaOwnerActorIds, executionPackage.qa_owner_actor_id]);
      workItemGroups.set(workItem.id, group);
    }
    const workItemRows = [...workItemGroups.values()].map(({ workItem, qaOwnerActorIds }) =>
      itemBase(
        {
          id: `work_item:${workItem.id}`,
          laneId,
          title: workItem.title,
          object: { type: 'work_item', id: workItem.id },
          projectId: workItem.project_id,
          updatedAt: workItem.updated_at,
          workItem,
          surfaceType: 'work_item',
          qaOwnerActorId: qaOwnerActorIds[0],
          qaOwnerActorIdValues: qaOwnerActorIds,
        },
        [workItemAction(laneId, workItem)],
      ),
    );
    const packageItems = packageRows.map(({ executionPackage, workItem }) => packageItem(laneId, executionPackage, workItem));
    const releaseItems = await Promise.all(
      (await repository.listReleases(filters.project_id)).map(async (release) => releaseItem(repository, laneId, release)),
    );
    return [...workItemRows, ...packageItems, ...releaseItems].sort(byUpdatedAtDesc);
  }

  if (laneId === 'release-owner') {
    const rows = await Promise.all((await repository.listReleases(filters.project_id)).map((release) => releaseItem(repository, laneId, release)));
    return rows.sort(byUpdatedAtDesc);
  }
  throw new Error(`Unsupported product lane candidate loader: ${laneId}`);
};

const buildManagerLane = async (
  repository: DeliveryRepository,
  filters: ParsedProductLaneFilters,
): Promise<ProductLaneResponse> => {
  const laneId: ProductLaneId = 'manager';
  const [workItems, packageRows, releases] = await Promise.all([
    visibleWorkItems(repository, filters.project_id),
    packagesWithWorkItems(repository, filters.project_id),
    repository.listReleases(filters.project_id),
  ]);
  const releaseItems = await Promise.all(releases.map((release) => releaseItem(repository, laneId, release)));
  const contributions = [
    ...workItems.map((workItem) => workItemLaneItem(laneId, workItem)),
    ...packageRows.map(({ executionPackage, workItem }) => packageReadOnlyItem(laneId, executionPackage, workItem)),
    ...releaseItems,
  ].filter((item) => matchesProductLaneFilters(item, filters));
  if (contributions.length === 0) {
    return productLaneResponseSchema.parse({
      lane_id: laneId,
      label: productLaneMetadata[laneId].label,
      description: productLaneMetadata[laneId].description,
      items: [],
      unsupported_filters: filters.unsupported_filters,
      summary: { total: 0, blocked: 0, high_risk: 0, stale: 0 },
    });
  }
  const updatedAt = contributions[0]?.updated_at ?? new Date(0).toISOString();
  const values = {
    kindValues: uniqueStrings(contributions.flatMap((item) => item.kind_values ?? (item.kind === undefined ? [] : [item.kind]))),
    phaseValues: uniqueStrings(contributions.flatMap((item) => item.phase_values ?? (item.phase === undefined ? [] : [item.phase]))),
    statusValues: uniqueStrings(contributions.flatMap((item) => item.status_values ?? (item.status === undefined ? [] : [item.status]))),
    gateStateValues: uniqueStrings(
      contributions.flatMap((item) => item.gate_state_values ?? (item.gate_state === undefined ? [] : [item.gate_state])),
    ),
    resolutionValues: uniqueStrings(
      contributions.flatMap((item) => item.resolution_values ?? (item.resolution === undefined ? [] : [item.resolution])),
    ),
    riskValues: uniqueStrings(contributions.flatMap((item) => item.risk_values ?? (item.risk === undefined ? [] : [item.risk]))),
    blocked: contributions.some((item) => item.blocked),
    stale: contributions.some((item) => item.stale),
  };
  const items = [
    managerItem(laneId, 'stage-counts', 'Stage counts', filters.project_id, updatedAt, values),
    managerItem(laneId, 'blocker-groups', 'Blocker groups', filters.project_id, updatedAt, values),
    managerItem(laneId, 'review-backlog', 'Review backlog', filters.project_id, updatedAt, values),
  ];
  const page = paginateProductLaneItems(items, filters);

  return productLaneResponseSchema.parse({
    lane_id: laneId,
    label: productLaneMetadata[laneId].label,
    description: productLaneMetadata[laneId].description,
    items: page.items,
    unsupported_filters: filters.unsupported_filters,
    summary: {
      total: contributions.length,
      blocked: contributions.filter((item) => item.blocked).length,
      high_risk: contributions.filter((item) => item.risk === 'high' || item.risk_values?.includes('high')).length,
      stale: contributions.filter((item) => item.stale).length,
    },
    ...(page.next_cursor === undefined ? {} : { next_cursor: page.next_cursor }),
  });
};

export async function getProductLane(
  repository: DeliveryRepository,
  laneId: ProductLaneId,
  filters: ParsedProductLaneFilters,
): Promise<ProductLaneResponse> {
  if (laneId === 'manager') {
    return buildManagerLane(repository, filters);
  }
  const items = await loadProductLaneCandidates(repository, laneId, filters);
  return productLaneResponseSchema.parse(buildProductLaneResponse(laneId, items, filters));
}
