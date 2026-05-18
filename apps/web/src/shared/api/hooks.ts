import { useQuery } from '@tanstack/react-query';

import { createForgeloopQueryApi } from './query';
import { queryKeys } from './query-keys';
import type { RoleWorkbenchId, RoleWorkbenchQuery } from './types';

const queryApi = createForgeloopQueryApi();

const workbenchIdForRole = (role: 'work-item-owner' | RoleWorkbenchId | string): RoleWorkbenchId =>
  (role === 'work-item-owner' ? 'intake' : role) as RoleWorkbenchId;

export function useWorkbenchQuery(input: {
  role: 'work-item-owner' | RoleWorkbenchId | string;
  projectId?: string;
  actorId?: string;
  filters?: Omit<RoleWorkbenchQuery, 'project_id' | 'actor_id'>;
}) {
  const query: RoleWorkbenchQuery = {
    ...input.filters,
    ...(input.projectId === undefined ? {} : { project_id: input.projectId }),
    ...(input.actorId === undefined ? {} : { actor_id: input.actorId }),
  };

  return useQuery({
    queryKey: queryKeys.workbench({
      role: input.role,
      ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
    }),
    queryFn: () => queryApi.getRoleWorkbench(workbenchIdForRole(input.role), query),
  });
}

export function usePipelineQuery(projectId: string) {
  return useQuery({
    queryKey: queryKeys.pipeline(projectId),
    queryFn: () => queryApi.getPipeline({ project_id: projectId }),
  });
}

export function useSpecsQuery(projectId: string) {
  return useQuery({
    queryKey: queryKeys.specs(projectId),
    queryFn: () => queryApi.listSpecs({ project_id: projectId }),
  });
}

export function useSpecQuery(specId: string) {
  return useQuery({
    queryKey: queryKeys.spec(specId),
    queryFn: () => queryApi.getSpec(specId),
  });
}

export function useSpecHistoryQuery(specId: string) {
  return useQuery({
    queryKey: queryKeys.specHistory(specId),
    queryFn: () => queryApi.getSpecHistory(specId),
  });
}

export function usePlansQuery(projectId: string) {
  return useQuery({
    queryKey: queryKeys.plans(projectId),
    queryFn: () => queryApi.listPlans({ project_id: projectId }),
  });
}

export function usePlanQuery(planId: string) {
  return useQuery({
    queryKey: queryKeys.plan(planId),
    queryFn: () => queryApi.getPlan(planId),
  });
}

export function usePlanHistoryQuery(planId: string) {
  return useQuery({
    queryKey: queryKeys.planHistory(planId),
    queryFn: () => queryApi.getPlanHistory(planId),
  });
}

export function usePackagesQuery(projectId: string) {
  return useQuery({
    queryKey: queryKeys.packages(projectId),
    queryFn: () => queryApi.listPackages({ project_id: projectId }),
  });
}

export function usePackageQuery(packageId: string) {
  return useQuery({
    queryKey: queryKeys.package(packageId),
    queryFn: () => queryApi.getPackage(packageId),
  });
}

export function useRunsQuery(projectId: string) {
  return useQuery({
    queryKey: queryKeys.runs(projectId),
    queryFn: () => queryApi.listRuns({ project_id: projectId }),
  });
}

export function useRunQuery(runSessionId: string) {
  return useQuery({
    queryKey: queryKeys.run(runSessionId),
    queryFn: () => queryApi.getRun(runSessionId),
  });
}

export function useReviewsQuery(projectId: string) {
  return useQuery({
    queryKey: queryKeys.reviews(projectId),
    queryFn: () => queryApi.listReviews({ project_id: projectId }),
  });
}

export function useReviewQuery(reviewPacketId: string) {
  return useQuery({
    queryKey: queryKeys.review(reviewPacketId),
    queryFn: () => queryApi.getReview(reviewPacketId),
  });
}

export function useReleasesQuery(projectId: string) {
  return useQuery({
    queryKey: queryKeys.releases(projectId),
    queryFn: () => queryApi.listReleases({ project_id: projectId }),
  });
}

export function useWorkItemCockpitQuery(workItemId: string) {
  return useQuery({
    queryKey: queryKeys.workItemCockpit(workItemId),
    queryFn: () => queryApi.getWorkItemCockpit(workItemId),
  });
}

export function useWorkItemReplayQuery(workItemId: string) {
  return useQuery({
    queryKey: ['work-item-replay', workItemId],
    queryFn: () => queryApi.getWorkItemReplay(workItemId),
  });
}

export function useExecutionPackageReplayQuery(executionPackageId: string) {
  return useQuery({
    queryKey: ['execution-package-replay', executionPackageId],
    queryFn: () => queryApi.getExecutionPackageReplay(executionPackageId),
  });
}

export function useReviewPacketReplayQuery(reviewPacketId: string) {
  return useQuery({
    queryKey: ['review-packet-replay', reviewPacketId],
    queryFn: () => queryApi.getReviewPacketReplay(reviewPacketId),
  });
}

export function useReleaseCockpitQuery(releaseId: string) {
  return useQuery({
    queryKey: queryKeys.releaseCockpit(releaseId),
    queryFn: () => queryApi.getReleaseCockpit(releaseId),
  });
}

export function useReleaseReplayQuery(releaseId: string) {
  return useQuery({
    queryKey: ['release-replay', releaseId],
    queryFn: () => queryApi.getReleaseReplay(releaseId),
  });
}
