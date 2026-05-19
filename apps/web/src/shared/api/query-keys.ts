import type { ListProductQuery, RoleWorkbenchQuery } from './types';

export interface WorkbenchQueryKeyInput {
  role: 'work-item-owner' | string;
  projectId?: string | undefined;
  actorId?: string | undefined;
  query?: RoleWorkbenchQuery | undefined;
  filters?: Omit<RoleWorkbenchQuery, 'project_id' | 'actor_id'> | undefined;
}

export const workbenchIdForProductRole = (role: 'work-item-owner' | string) => (role === 'work-item-owner' ? 'intake' : role);

export const normalizeWorkbenchQuery = (input: Omit<WorkbenchQueryKeyInput, 'role'> = {}): RoleWorkbenchQuery => {
  const query: RoleWorkbenchQuery = {
    ...input.query,
    ...input.filters,
    ...(input.projectId === undefined ? {} : { project_id: input.projectId }),
    ...(input.actorId === undefined ? {} : { actor_id: input.actorId }),
  };

  return {
    ...(query.project_id === undefined ? {} : { project_id: query.project_id }),
    ...(query.actor_id === undefined ? {} : { actor_id: query.actor_id }),
    ...(query.kind === undefined ? {} : { kind: query.kind }),
    ...(query.limit === undefined ? {} : { limit: query.limit }),
    ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
    ...(query.phase === undefined ? {} : { phase: query.phase }),
    ...(query.status === undefined ? {} : { status: query.status }),
    ...(query.risk === undefined ? {} : { risk: query.risk }),
  };
};

export const normalizeProductRegistryQuery = (query: ListProductQuery): ListProductQuery => ({
  project_id: query.project_id,
  ...(query.actor_id === undefined ? {} : { actor_id: query.actor_id }),
  ...(query.status === undefined ? {} : { status: query.status }),
  ...(query.phase === undefined ? {} : { phase: query.phase }),
  ...(query.gate_state === undefined ? {} : { gate_state: query.gate_state }),
  ...(query.resolution === undefined ? {} : { resolution: query.resolution }),
  ...(query.risk === undefined ? {} : { risk: query.risk }),
  ...(query.owner_actor_id === undefined ? {} : { owner_actor_id: query.owner_actor_id }),
  ...(query.reviewer_actor_id === undefined ? {} : { reviewer_actor_id: query.reviewer_actor_id }),
  ...(query.qa_owner_actor_id === undefined ? {} : { qa_owner_actor_id: query.qa_owner_actor_id }),
  ...(query.release_owner_actor_id === undefined ? {} : { release_owner_actor_id: query.release_owner_actor_id }),
  ...(query.work_item_id === undefined ? {} : { work_item_id: query.work_item_id }),
  ...(query.spec_id === undefined ? {} : { spec_id: query.spec_id }),
  ...(query.plan_id === undefined ? {} : { plan_id: query.plan_id }),
  ...(query.spec_revision_id === undefined ? {} : { spec_revision_id: query.spec_revision_id }),
  ...(query.plan_revision_id === undefined ? {} : { plan_revision_id: query.plan_revision_id }),
  ...(query.execution_package_id === undefined ? {} : { execution_package_id: query.execution_package_id }),
  ...(query.run_session_id === undefined ? {} : { run_session_id: query.run_session_id }),
  ...(query.review_packet_id === undefined ? {} : { review_packet_id: query.review_packet_id }),
  ...(query.release_id === undefined ? {} : { release_id: query.release_id }),
  ...(query.surface_type === undefined ? {} : { surface_type: query.surface_type }),
  ...(query.executor_type === undefined ? {} : { executor_type: query.executor_type }),
  ...(query.decision === undefined ? {} : { decision: query.decision }),
  ...(query.blocked === undefined ? {} : { blocked: query.blocked }),
  ...(query.stale === undefined ? {} : { stale: query.stale }),
  ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
  ...(query.limit === undefined ? {} : { limit: query.limit }),
});

export const queryKeys = {
  workbench: (input: WorkbenchQueryKeyInput) => [
    'workbench',
    workbenchIdForProductRole(input.role),
    normalizeWorkbenchQuery(input),
  ],
  pipeline: (projectId: string) => ['pipeline', { projectId }],
  workItems: (projectId: string) => ['work-items', { projectId }],
  productWorkItems: (query: ListProductQuery) => ['product-work-items', normalizeProductRegistryQuery(query)],
  workItem: (workItemId: string) => ['work-item', workItemId],
  workItemCockpit: (workItemId: string | undefined) => ['work-item-cockpit', workItemId],
  workItemReplay: (workItemId: string | undefined) => ['work-item-replay', workItemId],
  specs: (query: ListProductQuery) => ['specs', normalizeProductRegistryQuery(query)],
  spec: (specId: string) => ['spec', specId],
  specRevisions: (specId: string) => ['spec-revisions', specId],
  specReplay: (specId: string | undefined) => ['spec-replay', specId],
  specRevision: (revisionId: string | undefined) => ['spec-revision', revisionId],
  plans: (query: ListProductQuery) => ['plans', normalizeProductRegistryQuery(query)],
  plan: (planId: string) => ['plan', planId],
  planRevisions: (planId: string) => ['plan-revisions', planId],
  planReplay: (planId: string | undefined) => ['plan-replay', planId],
  planRevision: (revisionId: string | undefined) => ['plan-revision', revisionId],
  packages: (query: ListProductQuery) => ['packages', normalizeProductRegistryQuery(query)],
  package: (packageId: string) => ['package', packageId],
  runs: (query: ListProductQuery) => ['runs', normalizeProductRegistryQuery(query)],
  runEvents: (runSessionId: string, actorId: string) => ['run-events', runSessionId, { actorId }],
  run: (runSessionId: string) => ['run', runSessionId],
  reviews: (projectId: string) => ['reviews', { projectId }],
  reviewPackets: (query: ListProductQuery) => ['review-packets', normalizeProductRegistryQuery(query)],
  review: (reviewPacketId: string) => ['review', reviewPacketId],
  reviewPacketReplay: (reviewPacketId: string) => ['review-packet-replay', reviewPacketId],
  releases: (query: { project_id: string; release_owner_actor_id?: string; phase?: string; gate_state?: string; resolution?: string; cursor?: string; limit?: number }) => [
    'releases',
    {
      project_id: query.project_id,
      ...(query.release_owner_actor_id === undefined ? {} : { release_owner_actor_id: query.release_owner_actor_id }),
      ...(query.phase === undefined ? {} : { phase: query.phase }),
      ...(query.gate_state === undefined ? {} : { gate_state: query.gate_state }),
      ...(query.resolution === undefined ? {} : { resolution: query.resolution }),
      ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
      ...(query.limit === undefined ? {} : { limit: query.limit }),
    },
  ],
  releaseCockpit: (releaseId: string) => ['release-cockpit', releaseId],
  releaseReplay: (releaseId: string) => ['release-replay', releaseId],
  executionPackageReplay: (executionPackageId: string) => ['execution-package-replay', executionPackageId],
} as const;
