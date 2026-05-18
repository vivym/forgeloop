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

export const normalizeProductRegistryQuery = (query: ListProductQuery): Pick<ListProductQuery, 'project_id' | 'status' | 'cursor' | 'limit'> => ({
  project_id: query.project_id,
  ...(query.status === undefined ? {} : { status: query.status }),
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
  packages: (projectId: string) => ['packages', { projectId }],
  package: (packageId: string) => ['package', packageId],
  runs: (projectId: string) => ['runs', { projectId }],
  run: (runSessionId: string) => ['run', runSessionId],
  reviews: (projectId: string) => ['reviews', { projectId }],
  review: (reviewPacketId: string) => ['review', reviewPacketId],
  reviewPacketReplay: (reviewPacketId: string) => ['review-packet-replay', reviewPacketId],
  releases: (projectId: string) => ['releases', { projectId }],
  releaseCockpit: (releaseId: string) => ['release-cockpit', releaseId],
  releaseReplay: (releaseId: string) => ['release-replay', releaseId],
  executionPackageReplay: (executionPackageId: string) => ['execution-package-replay', executionPackageId],
} as const;
