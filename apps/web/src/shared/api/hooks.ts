import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { createForgeloopCommandApi } from './commands';
import { createForgeloopQueryApi } from './query';
import { normalizeWorkbenchQuery, queryKeys, workbenchIdForProductRole } from './query-keys';
import type { RoleWorkbenchId, RoleWorkbenchQuery } from './types';

const workbenchIdForRole = (role: 'work-item-owner' | RoleWorkbenchId | string): RoleWorkbenchId =>
  workbenchIdForProductRole(role) as RoleWorkbenchId;

const createQueryApi = () => createForgeloopQueryApi();
const createCommandApi = () => createForgeloopCommandApi();

export function useWorkbenchQuery(input: {
  role: 'work-item-owner' | RoleWorkbenchId | string;
  projectId?: string;
  actorId?: string;
  filters?: Omit<RoleWorkbenchQuery, 'project_id' | 'actor_id'>;
}) {
  const query = normalizeWorkbenchQuery({
    ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
    ...(input.actorId === undefined ? {} : { actorId: input.actorId }),
    ...(input.filters === undefined ? {} : { filters: input.filters }),
  });

  return useQuery({
    queryKey: queryKeys.workbench({
      role: input.role,
      query,
    }),
    queryFn: () => createQueryApi().getRoleWorkbench(workbenchIdForRole(input.role), query),
  });
}

export function usePipelineQuery(projectId: string) {
  return useQuery({
    queryKey: queryKeys.pipeline(projectId),
    queryFn: () => createQueryApi().getPipeline({ project_id: projectId }),
  });
}

export function useWorkItemsQuery(projectId: string) {
  return useQuery({
    queryKey: queryKeys.workItems(projectId),
    queryFn: () => createCommandApi().listWorkItems(projectId),
  });
}

export function useSpecsQuery(projectId: string) {
  return useQuery({
    queryKey: queryKeys.specs(projectId),
    queryFn: () => createQueryApi().listSpecs({ project_id: projectId }),
  });
}

export function useSpecQuery(specId: string) {
  return useQuery({
    queryKey: queryKeys.spec(specId),
    queryFn: () => createQueryApi().getSpec(specId),
  });
}

export function useSpecHistoryQuery(specId: string) {
  return useQuery({
    queryKey: queryKeys.specHistory(specId),
    queryFn: () => createQueryApi().getSpecHistory(specId),
  });
}

export function usePlansQuery(projectId: string) {
  return useQuery({
    queryKey: queryKeys.plans(projectId),
    queryFn: () => createQueryApi().listPlans({ project_id: projectId }),
  });
}

export function usePlanQuery(planId: string) {
  return useQuery({
    queryKey: queryKeys.plan(planId),
    queryFn: () => createQueryApi().getPlan(planId),
  });
}

export function usePlanHistoryQuery(planId: string) {
  return useQuery({
    queryKey: queryKeys.planHistory(planId),
    queryFn: () => createQueryApi().getPlanHistory(planId),
  });
}

export function usePackagesQuery(projectId: string) {
  return useQuery({
    queryKey: queryKeys.packages(projectId),
    queryFn: () => createQueryApi().listPackages({ project_id: projectId }),
  });
}

export function usePackageQuery(packageId: string) {
  return useQuery({
    queryKey: queryKeys.package(packageId),
    queryFn: () => createQueryApi().getPackage(packageId),
  });
}

export function useRunsQuery(projectId: string) {
  return useQuery({
    queryKey: queryKeys.runs(projectId),
    queryFn: () => createQueryApi().listRuns({ project_id: projectId }),
  });
}

export function useRunQuery(runSessionId: string) {
  return useQuery({
    queryKey: queryKeys.run(runSessionId),
    queryFn: () => createQueryApi().getRun(runSessionId),
  });
}

export function useReviewsQuery(projectId: string) {
  return useQuery({
    queryKey: queryKeys.reviews(projectId),
    queryFn: () => createQueryApi().listReviews({ project_id: projectId }),
  });
}

export function useReviewQuery(reviewPacketId: string) {
  return useQuery({
    queryKey: queryKeys.review(reviewPacketId),
    queryFn: () => createQueryApi().getReview(reviewPacketId),
  });
}

export function useReleasesQuery(projectId: string) {
  return useQuery({
    queryKey: queryKeys.releases(projectId),
    queryFn: () => createQueryApi().listReleases({ project_id: projectId }),
  });
}

export function useWorkItemCockpitQuery(workItemId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.workItemCockpit(workItemId),
    queryFn: () => createQueryApi().getWorkItemCockpit(requiredId(workItemId, 'workItemId')),
    enabled: workItemId !== undefined,
  });
}

export function useWorkItemReplayQuery(workItemId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.workItemReplay(workItemId),
    queryFn: () => createQueryApi().getWorkItemReplay(requiredId(workItemId, 'workItemId')),
    enabled: workItemId !== undefined,
  });
}

export function useExecutionPackageReplayQuery(executionPackageId: string) {
  return useQuery({
    queryKey: queryKeys.executionPackageReplay(executionPackageId),
    queryFn: () => createQueryApi().getExecutionPackageReplay(executionPackageId),
  });
}

export function useReviewPacketReplayQuery(reviewPacketId: string) {
  return useQuery({
    queryKey: queryKeys.reviewPacketReplay(reviewPacketId),
    queryFn: () => createQueryApi().getReviewPacketReplay(reviewPacketId),
  });
}

export function useReleaseCockpitQuery(releaseId: string) {
  return useQuery({
    queryKey: queryKeys.releaseCockpit(releaseId),
    queryFn: () => createQueryApi().getReleaseCockpit(releaseId),
  });
}

export function useReleaseReplayQuery(releaseId: string) {
  return useQuery({
    queryKey: queryKeys.releaseReplay(releaseId),
    queryFn: () => createQueryApi().getReleaseReplay(releaseId),
  });
}

export function useCreateSpecMutation(workItemId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => createCommandApi().createSpec(requiredId(workItemId, 'workItemId')),
    onSuccess: () => {
      if (workItemId !== undefined) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.workItemCockpit(workItemId) });
      }
    },
  });
}

export function useCreatePlanMutation(workItemId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => createCommandApi().createPlan(requiredId(workItemId, 'workItemId')),
    onSuccess: () => {
      if (workItemId !== undefined) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.workItemCockpit(workItemId) });
      }
    },
  });
}

export function useGenerateSpecDraftMutation(input: { workItemId: string | undefined; specId: string | undefined }) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => createCommandApi().generateSpecDraft(requiredId(input.specId, 'specId')),
    onSuccess: () => {
      if (input.workItemId !== undefined) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.workItemCockpit(input.workItemId) });
      }
    },
  });
}

export function useGeneratePlanDraftMutation(input: { workItemId: string | undefined; planId: string | undefined }) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => createCommandApi().generatePlanDraft(requiredId(input.planId, 'planId')),
    onSuccess: () => {
      if (input.workItemId !== undefined) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.workItemCockpit(input.workItemId) });
      }
    },
  });
}

function requiredId(id: string | undefined, label: string) {
  if (id === undefined) {
    throw new Error(`${label} is required`);
  }
  return id;
}
