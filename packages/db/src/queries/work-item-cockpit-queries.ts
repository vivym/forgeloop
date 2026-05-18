import {
  deriveWorkItemCompletion,
  type ExecutionPackage,
  type Plan,
  type ReviewPacket,
  type RunRuntimeMetadata,
  type RunSession,
  type Spec,
  type WorkItem,
} from '@forgeloop/domain';

import type { DeliveryRepository } from '../repositories/delivery-repository';

export interface WorkItemCockpitResponse {
  work_item: WorkItem;
  current_spec: Spec | null;
  current_plan: Plan | null;
  packages: ExecutionPackage[];
  run_sessions: RunSession[];
  review_packets: ReviewPacket[];
  next_actions: string[];
  completion_state: ReturnType<typeof deriveWorkItemCompletion>;
}

export interface WorkItemCockpitOptions {
  run_session_metadata_fallback: RunRuntimeMetadata;
}

const nextActions = (packages: ExecutionPackage[], reviewPackets: ReviewPacket[]): string[] => {
  const actions = new Set<string>();
  if (packages.some((item) => item.phase === 'draft')) {
    actions.add('mark_packages_ready');
  }
  if (packages.some((item) => item.phase === 'ready')) {
    actions.add('run_ready_packages');
  }
  if (reviewPackets.some((item) => item.status === 'ready' || item.status === 'in_review')) {
    actions.add('approve_open_review_packets');
  }
  return [...actions];
};

const withWorkerLeaseMetadata = async (
  repository: DeliveryRepository,
  runSession: RunSession,
  fallbackRuntimeMetadata: RunRuntimeMetadata,
): Promise<RunSession> => {
  const lease = await repository.getRunWorkerLease(runSession.id);
  if (lease === undefined) {
    return runSession;
  }

  return {
    ...runSession,
    runtime_metadata: {
      ...(runSession.runtime_metadata ?? fallbackRuntimeMetadata),
      worker_id: lease.worker_id,
      worker_lease_status: lease.status,
      worker_lease_heartbeat_at: lease.heartbeat_at,
      worker_lease_expires_at: lease.expires_at,
    },
  };
};

export async function getWorkItemCockpit(
  repository: DeliveryRepository,
  workItemId: string,
  options: WorkItemCockpitOptions,
): Promise<WorkItemCockpitResponse | undefined> {
  const workItem = await repository.getWorkItem(workItemId);
  if (workItem === undefined) {
    return undefined;
  }

  const packages = await repository.listExecutionPackagesForWorkItem(workItem.id);
  const runSessions = (await Promise.all(packages.map((item) => repository.listRunSessionsForPackage(item.id)))).flat();
  const reviewPackets = (await Promise.all(packages.map((item) => repository.listReviewPacketsForPackage(item.id)))).flat();
  const completionState = deriveWorkItemCompletion(workItem, packages, runSessions, reviewPackets);

  return {
    work_item: workItem,
    current_spec: workItem.current_spec_id === undefined ? null : (await repository.getSpec(workItem.current_spec_id)) ?? null,
    current_plan: workItem.current_plan_id === undefined ? null : (await repository.getPlan(workItem.current_plan_id)) ?? null,
    packages,
    run_sessions: await Promise.all(
      runSessions.map((runSession) => withWorkerLeaseMetadata(repository, runSession, options.run_session_metadata_fallback)),
    ),
    review_packets: reviewPackets,
    next_actions: nextActions(packages, reviewPackets),
    completion_state: completionState,
  };
}
