import { workItemActionsResponseSchema, type ProductAction, type ProductLaneId, type WorkItemActionsResponse } from '@forgeloop/contracts';
import type { Release } from '@forgeloop/domain';

import type { DeliveryRepository } from '../repositories/delivery-repository';
import {
  generatePackagesAction,
  generatePlanDraftAction,
  generateSpecDraftAction,
  markPackageReadyAction,
  navigateAction,
  objectTarget,
  runPackageAction,
} from './product-action-builders';
import { getWorkItemCockpit, type WorkItemCockpitOptions, type WorkItemCockpitResponse } from './work-item-cockpit-queries';
import { laneForWorkItemKind } from './product-lane-types';

export interface WorkItemActionQueryOptions {
  cockpit: WorkItemCockpitOptions;
}

const openWorkItemAction = (laneId: ProductLaneId, cockpit: WorkItemCockpitResponse): ProductAction =>
  navigateAction({
    id: `open-work-item-${cockpit.work_item.id}`,
    laneId,
    priority: 'primary',
    label: 'Open Work Item',
    target: objectTarget('work_item', cockpit.work_item.id, `/work-items/${cockpit.work_item.id}`),
  });

const specPlanFlowAction = (laneId: ProductLaneId, cockpit: WorkItemCockpitResponse, label: string): ProductAction =>
  navigateAction({
    id: `open-spec-plan-flow-${cockpit.work_item.id}`,
    laneId,
    priority: 'primary',
    label,
    target: objectTarget('work_item', cockpit.work_item.id, `/work-items/${cockpit.work_item.id}`),
  });

const packageActions = (laneId: ProductLaneId, cockpit: WorkItemCockpitResponse): ProductAction[] =>
  cockpit.packages.flatMap((executionPackage) => {
    if (executionPackage.phase === 'ready' && executionPackage.gate_state === 'not_submitted') {
      return [
        runPackageAction({
          id: `run-package-${executionPackage.id}`,
          laneId,
          priority: 'primary',
          label: 'Run package',
          workItemId: cockpit.work_item.id,
          packageId: executionPackage.id,
          target: objectTarget('execution_package', executionPackage.id, `/packages/${executionPackage.id}`),
        }),
      ];
    }

    if (executionPackage.phase === 'draft' || executionPackage.gate_state === 'changes_requested') {
      return [
        markPackageReadyAction({
          id: `mark-package-ready-${executionPackage.id}`,
          laneId,
          priority: 'primary',
          label: 'Mark package ready',
          workItemId: cockpit.work_item.id,
          packageId: executionPackage.id,
          expectedPackageVersion: executionPackage.version,
          target: objectTarget('execution_package', executionPackage.id, `/packages/${executionPackage.id}`),
        }),
      ];
    }

    return [
      navigateAction({
        id: `open-package-${executionPackage.id}`,
        laneId,
        priority: 'secondary',
        label: 'Open Package',
        target: objectTarget('execution_package', executionPackage.id, `/packages/${executionPackage.id}`),
      }),
    ];
  });

const reviewActions = (laneId: ProductLaneId, cockpit: WorkItemCockpitResponse): ProductAction[] =>
  cockpit.review_packets.map((reviewPacket) =>
    navigateAction({
      id: `open-review-${reviewPacket.id}`,
      laneId,
      priority: 'primary',
      label: 'Open Review',
      target: objectTarget('review_packet', reviewPacket.id, `/reviews/${reviewPacket.id}`),
    }),
  );

const releaseActions = (laneId: ProductLaneId, releases: readonly Release[]): ProductAction[] =>
  releases.map((release) =>
    navigateAction({
      id: `open-release-${release.id}`,
      laneId,
      priority: 'primary',
      label: 'Open Release',
      target: objectTarget('release', release.id, `/releases/${release.id}`),
    }),
  );

const buildActionsForWorkItemLane = (
  cockpit: WorkItemCockpitResponse,
  releases: readonly Release[],
  laneId: ProductLaneId,
): ProductAction[] => {
  if (laneId === 'manager') {
    return [openWorkItemAction(laneId, cockpit), ...releaseActions(laneId, releases)];
  }

  if (laneId === 'reviewer') {
    return reviewActions(laneId, cockpit).concat(openWorkItemAction(laneId, cockpit));
  }

  if (laneId === 'execution-owner') {
    return packageActions(laneId, cockpit).concat(openWorkItemAction(laneId, cockpit));
  }

  if (laneId === 'qa-test-owner' || laneId === 'release-owner') {
    return [...packageActions(laneId, cockpit), ...releaseActions(laneId, releases), openWorkItemAction(laneId, cockpit)];
  }

  const actions: ProductAction[] = [];
  if (cockpit.current_spec === null) {
    actions.push(specPlanFlowAction(laneId, cockpit, 'Open Spec / Plan flow'));
  } else if (cockpit.current_spec.current_revision_id === undefined) {
    actions.push(
      generateSpecDraftAction({
        id: `generate-spec-draft-${cockpit.current_spec.id}`,
        laneId,
        priority: 'primary',
        label: 'Generate Spec draft',
        workItemId: cockpit.work_item.id,
        specId: cockpit.current_spec.id,
        target: objectTarget('spec', cockpit.current_spec.id, `/specs/${cockpit.current_spec.id}`),
      }),
    );
  }

  const specApproved =
    cockpit.current_spec !== null &&
    (cockpit.current_spec.gate_state === 'approved' || cockpit.current_spec.approved_revision_id !== undefined);
  if (cockpit.current_spec !== null && !specApproved) {
    actions.push(
      navigateAction({
        id: `open-spec-approval-${cockpit.current_spec.id}`,
        laneId,
        priority: actions.length === 0 ? 'primary' : 'secondary',
        label: 'Open Spec approval',
        target: objectTarget('spec', cockpit.current_spec.id, `/specs/${cockpit.current_spec.id}`),
      }),
    );
  } else if (specApproved && cockpit.current_plan === null) {
    actions.push(specPlanFlowAction(laneId, cockpit, 'Open Plan flow'));
  } else if (specApproved && cockpit.current_plan !== null && cockpit.current_plan.current_revision_id === undefined) {
    actions.push(
      generatePlanDraftAction({
        id: `generate-plan-draft-${cockpit.current_plan.id}`,
        laneId,
        priority: actions.length === 0 ? 'primary' : 'secondary',
        label: 'Generate Plan draft',
        workItemId: cockpit.work_item.id,
        planId: cockpit.current_plan.id,
        target: objectTarget('plan', cockpit.current_plan.id, `/plans/${cockpit.current_plan.id}`),
      }),
    );
  }

  const currentPlan = cockpit.current_plan;
  const approvedPlanRevisionId =
    currentPlan?.approved_revision_id ?? (currentPlan?.gate_state === 'approved' ? currentPlan.current_revision_id : undefined);
  if (currentPlan !== null && approvedPlanRevisionId !== undefined && cockpit.packages.length === 0) {
    actions.push(
      generatePackagesAction({
        id: `generate-packages-${approvedPlanRevisionId}`,
        laneId,
        priority: actions.length === 0 ? 'primary' : 'secondary',
        label: 'Generate packages',
        workItemId: cockpit.work_item.id,
        planRevisionId: approvedPlanRevisionId,
        target: objectTarget('plan_revision', approvedPlanRevisionId, `/plans/${currentPlan.id}`),
      }),
    );
  }

  actions.push(...packageActions(laneId, cockpit), ...reviewActions(laneId, cockpit), ...releaseActions(laneId, releases));
  if (actions.length === 0) {
    actions.push(openWorkItemAction(laneId, cockpit));
  }
  return actions;
};

export async function getWorkItemActions(
  repository: DeliveryRepository,
  workItemId: string,
  laneId: ProductLaneId | undefined,
  options: WorkItemActionQueryOptions,
): Promise<WorkItemActionsResponse | undefined> {
  const cockpit = await getWorkItemCockpit(repository, workItemId, options.cockpit);
  if (cockpit === undefined) {
    return undefined;
  }

  const packageIds = new Set(cockpit.packages.map((executionPackage) => executionPackage.id));
  const releases = (await repository.listReleases(cockpit.work_item.project_id)).filter(
    (release) =>
      release.work_item_ids.includes(cockpit.work_item.id) ||
      release.execution_package_ids.some((executionPackageId) => packageIds.has(executionPackageId)),
  );

  const defaultLaneId = laneForWorkItemKind(cockpit.work_item.kind);
  const effectiveLaneId = laneId ?? defaultLaneId;
  return workItemActionsResponseSchema.parse({
    work_item_id: workItemId,
    lane_id: effectiveLaneId,
    default_lane_id: defaultLaneId,
    actions: buildActionsForWorkItemLane(cockpit, releases, effectiveLaneId),
  });
}
