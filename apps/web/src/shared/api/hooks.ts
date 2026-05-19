import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';

import { createForgeloopCommandApi } from './commands';
import { createForgeloopQueryApi } from './query';
import { normalizeWorkbenchQuery, queryKeys, workbenchIdForProductRole } from './query-keys';
import type {
  CockpitResponse,
  AcknowledgeReleaseTestAcceptanceBody,
  ApproveArtifactBody,
  ApproveReleaseBody,
  CloseReleaseBody,
  CreateReleaseBody,
  CreateReleaseEvidenceBody,
  CreateExecutionPackageBody,
  ExecutionPackage,
  LinkReleaseScopeBody,
  ListProductQuery,
  OverrideApproveReleaseBody,
  PatchReleaseBody,
  PatchExecutionPackageBody,
  PlanRevision,
  ReleaseCommandBody,
  RequestArtifactChangesBody,
  RequestReleaseChangesBody,
  ReviewDecisionBody,
  RoleWorkbenchId,
  RoleWorkbenchQuery,
  SpecPlan,
  SpecRevision,
  StartReleaseObservingBody,
  SubmitForApprovalBody,
  UnlinkReleaseScopeBody,
} from './types';

const workbenchIdForRole = (role: 'work-item-owner' | RoleWorkbenchId | string): RoleWorkbenchId =>
  workbenchIdForProductRole(role) as RoleWorkbenchId;

const createQueryApi = () => createForgeloopQueryApi();
const createCommandApi = () => createForgeloopCommandApi();

type ReleaseProductQuery = {
  project_id: string;
  release_owner_actor_id?: string;
  phase?: string;
  gate_state?: string;
  resolution?: string;
  cursor?: string;
  limit?: number;
};

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

export function useProductWorkItemsQuery(query: Pick<ListProductQuery, 'project_id' | 'phase' | 'status' | 'risk' | 'owner_actor_id' | 'cursor' | 'limit'>) {
  const normalizedQuery = {
    project_id: query.project_id,
    ...(query.phase === undefined ? {} : { phase: query.phase }),
    ...(query.status === undefined ? {} : { status: query.status }),
    ...(query.risk === undefined ? {} : { risk: query.risk }),
    ...(query.owner_actor_id === undefined ? {} : { owner_actor_id: query.owner_actor_id }),
    ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
    ...(query.limit === undefined ? {} : { limit: query.limit }),
  };

  return useQuery({
    queryKey: queryKeys.productWorkItems(normalizedQuery),
    queryFn: () => createQueryApi().listWorkItems(normalizedQuery),
  });
}

export function useSpecsQuery(query: Pick<ListProductQuery, 'project_id' | 'status' | 'cursor' | 'limit'>) {
  const normalizedQuery = {
    project_id: query.project_id,
    ...(query.status === undefined ? {} : { status: query.status }),
    ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
    ...(query.limit === undefined ? {} : { limit: query.limit }),
  };

  return useQuery({
    queryKey: queryKeys.specs(normalizedQuery),
    queryFn: () => createQueryApi().listSpecs(normalizedQuery),
  });
}

export function useSpecQuery(specId: string) {
  return useQuery({
    queryKey: queryKeys.spec(specId),
    queryFn: () => createCommandApi().getSpec(specId),
  });
}

export function useSpecRevisionsQuery(specId: string) {
  return useQuery({
    queryKey: queryKeys.specRevisions(specId),
    queryFn: () => createCommandApi().listSpecRevisions(specId),
  });
}

export function useSpecReplayQuery(specId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.specReplay(specId),
    queryFn: () => createQueryApi().getSpecReplay(requiredId(specId, 'specId')),
    enabled: specId !== undefined,
  });
}

export function useSpecRevisionQuery(revisionId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.specRevision(revisionId),
    queryFn: () => createCommandApi().getSpecRevision(requiredId(revisionId, 'revisionId')),
    enabled: revisionId !== undefined,
  });
}

export function usePlansQuery(query: Pick<ListProductQuery, 'project_id' | 'status' | 'cursor' | 'limit'>) {
  const normalizedQuery = {
    project_id: query.project_id,
    ...(query.status === undefined ? {} : { status: query.status }),
    ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
    ...(query.limit === undefined ? {} : { limit: query.limit }),
  };

  return useQuery({
    queryKey: queryKeys.plans(normalizedQuery),
    queryFn: () => createQueryApi().listPlans(normalizedQuery),
  });
}

export function usePlanQuery(planId: string) {
  return useQuery({
    queryKey: queryKeys.plan(planId),
    queryFn: () => createCommandApi().getPlan(planId),
  });
}

export function usePlanRevisionsQuery(planId: string) {
  return useQuery({
    queryKey: queryKeys.planRevisions(planId),
    queryFn: () => createCommandApi().listPlanRevisions(planId),
  });
}

export function usePlanReplayQuery(planId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.planReplay(planId),
    queryFn: () => createQueryApi().getPlanReplay(requiredId(planId, 'planId')),
    enabled: planId !== undefined,
  });
}

export function usePlanRevisionQuery(revisionId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.planRevision(revisionId),
    queryFn: () => createCommandApi().getPlanRevision(requiredId(revisionId, 'revisionId')),
    enabled: revisionId !== undefined,
  });
}

export function usePackagesQuery(query: ListProductQuery) {
  const normalizedQuery = normalizePackageRunQuery(query);

  return useQuery({
    queryKey: queryKeys.packages(normalizedQuery),
    queryFn: () => createQueryApi().listPackages(normalizedQuery),
  });
}

export function usePackageQuery(packageId: string) {
  return useQuery({
    queryKey: queryKeys.package(packageId),
    queryFn: () => createCommandApi().getExecutionPackage(packageId),
  });
}

export function useRunsQuery(query: ListProductQuery) {
  const normalizedQuery = normalizePackageRunQuery(query);

  return useQuery({
    queryKey: queryKeys.runs(normalizedQuery),
    queryFn: () => createQueryApi().listRuns(normalizedQuery),
  });
}

export function useRunQuery(runSessionId: string) {
  return useQuery({
    queryKey: queryKeys.run(runSessionId),
    queryFn: () => createCommandApi().getRunSession(runSessionId),
  });
}

export function useRunEventsQuery(input: { runSessionId: string; actorId: string }) {
  return useQuery({
    queryKey: queryKeys.runEvents(input.runSessionId, input.actorId),
    queryFn: () => createCommandApi().listRunEvents(input.runSessionId, { actorId: input.actorId }),
  });
}

export function useReviewsQuery(projectId: string) {
  return useQuery({
    queryKey: queryKeys.reviews(projectId),
    queryFn: () => createQueryApi().listReviews({ project_id: projectId }),
  });
}

export function useReviewPacketsQuery(query: ListProductQuery) {
  const normalizedQuery = normalizeReviewPacketQuery(query);

  return useQuery({
    queryKey: queryKeys.reviewPackets(normalizedQuery),
    queryFn: () => createQueryApi().listReviewPackets(normalizedQuery),
  });
}

export function useReviewQuery(reviewPacketId: string) {
  return useQuery({
    queryKey: queryKeys.review(reviewPacketId),
    queryFn: () => createQueryApi().getReview(reviewPacketId),
  });
}

export function useApproveReviewPacketMutation(reviewPacketId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: ReviewDecisionBody) => createCommandApi().approveReviewPacket(reviewPacketId, body),
    onSuccess: () => invalidateReviewPacketResources(queryClient, reviewPacketId),
  });
}

export function useRequestReviewChangesMutation(reviewPacketId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: ReviewDecisionBody) => createCommandApi().requestReviewChanges(reviewPacketId, body),
    onSuccess: () => invalidateReviewPacketResources(queryClient, reviewPacketId),
  });
}

export function useMarkPackageReadyMutation(packageId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: { actor_id?: string; expected_package_version: number }) =>
      createCommandApi().markPackageReady(packageId, body),
    onSuccess: (executionPackage) => {
      setPackageDetail(queryClient, packageId, executionPackage);
      return invalidatePackages(queryClient);
    },
  });
}

export function useRunPackageMutation(packageId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { actorId: string }) =>
      createCommandApi().runPackage(packageId, input.actorId, {
        execution_package_id: packageId,
        executor_type: 'local_codex',
      }),
    onSuccess: () => invalidatePackageResources(queryClient, packageId),
  });
}

export function useRerunPackageMutation(packageId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { actorId: string; previousRunSessionId?: string }) =>
      createCommandApi().rerunPackage(packageId, input.actorId, {
        execution_package_id: packageId,
        executor_type: 'local_codex',
        ...(input.previousRunSessionId === undefined ? {} : { previous_run_session_id: input.previousRunSessionId }),
      }),
    onSuccess: () => invalidatePackageResources(queryClient, packageId),
  });
}

export function useForceRerunPackageMutation(packageId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { actorId: string; reason: string; previousRunSessionId?: string }) =>
      createCommandApi().forceRerunPackage(packageId, input.actorId, {
        execution_package_id: packageId,
        executor_type: 'local_codex',
        force: true,
        force_reason: input.reason,
        ...(input.previousRunSessionId === undefined ? {} : { previous_run_session_id: input.previousRunSessionId }),
      }),
    onSuccess: () => invalidatePackageResources(queryClient, packageId),
  });
}

export function useSendRunInputMutation(runSessionId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { actorId: string; message: string; targetTurnId?: string }) =>
      createCommandApi().sendRunInput(runSessionId, input.actorId, input.message, input.targetTurnId),
    onSuccess: () => invalidateRunDetail(queryClient, runSessionId),
  });
}

export function useCancelRunMutation(runSessionId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { actorId: string; reason?: string }) =>
      createCommandApi().cancelRun(runSessionId, input.actorId, input.reason),
    onSuccess: () => invalidateRunDetail(queryClient, runSessionId),
  });
}

export function useResumeRunMutation(runSessionId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { actorId: string; reason?: string }) =>
      createCommandApi().resumeRun(runSessionId, input.actorId, input.reason),
    onSuccess: () => invalidateRunDetail(queryClient, runSessionId),
  });
}

export function useReleasesQuery(query: ReleaseProductQuery) {
  const normalizedQuery = normalizeReleaseQuery(query);

  return useQuery({
    queryKey: queryKeys.releases(normalizedQuery),
    queryFn: () => createQueryApi().listReleases(normalizedQuery),
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

export function useGeneratePackagesMutation(planRevisionId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => createCommandApi().generatePackages(requiredId(planRevisionId, 'planRevisionId')),
    onSuccess: () => invalidatePackages(queryClient),
  });
}

export function useCreateExecutionPackageMutation(planRevisionId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: CreateExecutionPackageBody) =>
      createCommandApi().createExecutionPackage(requiredId(planRevisionId, 'planRevisionId'), body),
    onSuccess: (executionPackage) => {
      setPackageDetail(queryClient, executionPackage.id, executionPackage);
      return invalidatePackages(queryClient);
    },
  });
}

export function usePatchExecutionPackageMutation(packageId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: PatchExecutionPackageBody) => createCommandApi().patchExecutionPackage(packageId, body),
    onSuccess: (executionPackage) => {
      setPackageDetail(queryClient, packageId, executionPackage);
      return invalidatePackages(queryClient);
    },
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

export function useCreateReleaseMutation(projectId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: CreateReleaseBody) => createCommandApi().createRelease(body),
    onSuccess: () => invalidateReleases(queryClient, projectId),
  });
}

export function usePatchReleaseMutation(releaseId: string) {
  return useReleaseCommandMutation<PatchReleaseBody>(releaseId, (body) => createCommandApi().patchRelease(releaseId, body));
}

export function useLinkReleaseWorkItemMutation(releaseId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { workItemId: string; body: LinkReleaseScopeBody }) =>
      createCommandApi().linkReleaseWorkItem(releaseId, input.workItemId, input.body),
    onSuccess: () => invalidateReleaseCockpit(queryClient, releaseId),
  });
}

export function useUnlinkReleaseWorkItemMutation(releaseId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { workItemId: string; body: UnlinkReleaseScopeBody }) =>
      createCommandApi().unlinkReleaseWorkItem(releaseId, input.workItemId, input.body),
    onSuccess: () => invalidateReleaseCockpit(queryClient, releaseId),
  });
}

export function useLinkReleaseExecutionPackageMutation(releaseId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { packageId: string; body: LinkReleaseScopeBody }) =>
      createCommandApi().linkReleaseExecutionPackage(releaseId, input.packageId, input.body),
    onSuccess: () => invalidateReleaseCockpit(queryClient, releaseId),
  });
}

export function useUnlinkReleaseExecutionPackageMutation(releaseId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { packageId: string; body: UnlinkReleaseScopeBody }) =>
      createCommandApi().unlinkReleaseExecutionPackage(releaseId, input.packageId, input.body),
    onSuccess: () => invalidateReleaseCockpit(queryClient, releaseId),
  });
}

export function useSubmitReleaseMutation(releaseId: string) {
  return useReleaseCommandMutation(releaseId, (body: ReleaseCommandBody) => createCommandApi().submitReleaseForApproval(releaseId, body));
}

export function useApproveReleaseMutation(releaseId: string) {
  return useReleaseCommandMutation(releaseId, (body: ApproveReleaseBody) => createCommandApi().approveRelease(releaseId, body));
}

export function useAcknowledgeReleaseTestAcceptanceMutation(releaseId: string) {
  return useReleaseCommandMutation(releaseId, (body: AcknowledgeReleaseTestAcceptanceBody) =>
    createCommandApi().acknowledgeReleaseTestAcceptance(releaseId, body),
  );
}

export function useOverrideApproveReleaseMutation(releaseId: string) {
  return useReleaseCommandMutation(releaseId, (body: OverrideApproveReleaseBody) => createCommandApi().overrideApproveRelease(releaseId, body));
}

export function useRequestReleaseChangesMutation(releaseId: string) {
  return useReleaseCommandMutation(releaseId, (body: RequestReleaseChangesBody) => createCommandApi().requestReleaseChanges(releaseId, body));
}

export function useStartReleaseObservingMutation(releaseId: string) {
  return useReleaseCommandMutation(releaseId, (body: StartReleaseObservingBody) => createCommandApi().startReleaseObserving(releaseId, body));
}

export function useCloseReleaseMutation(releaseId: string) {
  return useReleaseCommandMutation(releaseId, (body: CloseReleaseBody) => createCommandApi().closeRelease(releaseId, body));
}

export function useCreateReleaseEvidenceMutation(releaseId: string) {
  return useReleaseCommandMutation(releaseId, (body: CreateReleaseEvidenceBody) => createCommandApi().createReleaseEvidence(releaseId, body));
}

export function useCreateSpecMutation(workItemId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => createCommandApi().createSpec(requiredId(workItemId, 'workItemId')),
    onSuccess: (spec) => {
      setCockpitSpec(queryClient, workItemId, spec);
      return invalidateWorkItemCockpit(queryClient, workItemId);
    },
  });
}

export function useCreatePlanMutation(workItemId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => createCommandApi().createPlan(requiredId(workItemId, 'workItemId')),
    onSuccess: (plan) => {
      setCockpitPlan(queryClient, workItemId, plan);
      return invalidateWorkItemCockpit(queryClient, workItemId);
    },
  });
}

export function useGenerateSpecDraftMutation(input: { workItemId: string | undefined; specId: string | undefined }) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => createCommandApi().generateSpecDraft(requiredId(input.specId, 'specId')),
    onSuccess: (revision) => {
      setCockpitSpecRevision(queryClient, input.workItemId, revision);
      return invalidateWorkItemCockpit(queryClient, input.workItemId);
    },
  });
}

export function useGeneratePlanDraftMutation(input: { workItemId: string | undefined; planId: string | undefined }) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => createCommandApi().generatePlanDraft(requiredId(input.planId, 'planId')),
    onSuccess: (revision) => {
      setCockpitPlanRevision(queryClient, input.workItemId, revision);
      return invalidateWorkItemCockpit(queryClient, input.workItemId);
    },
  });
}

export function useSubmitSpecForApprovalMutation(input: { specId: string; workItemId?: string }) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: SubmitForApprovalBody) => createCommandApi().submitSpecForApproval(input.specId, body),
    onSuccess: () => invalidateSpecLifecycleResources(queryClient, input.specId, input.workItemId),
  });
}

export function useApproveSpecMutation(input: { specId: string; workItemId?: string }) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: ApproveArtifactBody) => createCommandApi().approveSpec(input.specId, body),
    onSuccess: () => invalidateSpecLifecycleResources(queryClient, input.specId, input.workItemId),
  });
}

export function useRequestSpecChangesMutation(input: { specId: string; workItemId?: string }) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: RequestArtifactChangesBody) => createCommandApi().requestSpecChanges(input.specId, body),
    onSuccess: () => invalidateSpecLifecycleResources(queryClient, input.specId, input.workItemId),
  });
}

export function useSubmitPlanForApprovalMutation(input: { planId: string; workItemId?: string }) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: SubmitForApprovalBody) => createCommandApi().submitPlanForApproval(input.planId, body),
    onSuccess: () => invalidatePlanLifecycleResources(queryClient, input.planId, input.workItemId),
  });
}

export function useApprovePlanMutation(input: { planId: string; workItemId?: string }) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: ApproveArtifactBody) => createCommandApi().approvePlan(input.planId, body),
    onSuccess: (plan) =>
      Promise.all([
        invalidatePlanLifecycleResources(queryClient, input.planId, input.workItemId),
        plan.approved_revision_id === undefined ? Promise.resolve() : invalidatePackages(queryClient),
      ]),
  });
}

export function useRequestPlanChangesMutation(input: { planId: string; workItemId?: string }) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: RequestArtifactChangesBody) => createCommandApi().requestPlanChanges(input.planId, body),
    onSuccess: () => invalidatePlanLifecycleResources(queryClient, input.planId, input.workItemId),
  });
}

function invalidateWorkItemCockpit(queryClient: QueryClient, workItemId: string | undefined) {
  if (workItemId === undefined) {
    return Promise.resolve();
  }

  return queryClient.invalidateQueries({ queryKey: queryKeys.workItemCockpit(workItemId) });
}

function invalidateSpecLifecycleResources(queryClient: QueryClient, specId: string, workItemId: string | undefined) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.spec(specId) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.specRevisions(specId) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.specReplay(specId) }),
    queryClient.invalidateQueries({ queryKey: ['specs'] }),
    invalidateWorkItemCockpit(queryClient, workItemId),
  ]);
}

function invalidatePlanLifecycleResources(queryClient: QueryClient, planId: string, workItemId: string | undefined) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.plan(planId) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.planRevisions(planId) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.planReplay(planId) }),
    queryClient.invalidateQueries({ queryKey: ['plans'] }),
    invalidateWorkItemCockpit(queryClient, workItemId),
  ]);
}

function invalidatePackageDetail(queryClient: QueryClient, packageId: string) {
  return queryClient.invalidateQueries({ queryKey: queryKeys.package(packageId) });
}

function invalidatePackageResources(queryClient: QueryClient, packageId: string) {
  return Promise.all([invalidatePackageDetail(queryClient, packageId), invalidatePackages(queryClient)]);
}

function invalidatePackages(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: ['packages'] });
}

function invalidateReviewPacketResources(queryClient: QueryClient, reviewPacketId: string) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.review(reviewPacketId) }),
    queryClient.invalidateQueries({ queryKey: ['review-packets'] }),
  ]);
}

function invalidateReleases(queryClient: QueryClient, projectId: string) {
  return queryClient.invalidateQueries({ queryKey: ['releases', { project_id: projectId }] });
}

function invalidateReleaseCockpit(queryClient: QueryClient, releaseId: string) {
  return queryClient.invalidateQueries({ queryKey: queryKeys.releaseCockpit(releaseId) });
}

function useReleaseCommandMutation<TBody>(releaseId: string, mutationFn: (body: TBody) => Promise<unknown>) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn,
    onSuccess: () =>
      Promise.all([
        invalidateReleaseCockpit(queryClient, releaseId),
        queryClient.invalidateQueries({ queryKey: queryKeys.releaseReplay(releaseId) }),
        queryClient.invalidateQueries({ queryKey: ['releases'] }),
      ]),
  });
}

function setPackageDetail(queryClient: QueryClient, packageId: string, executionPackage: ExecutionPackage) {
  queryClient.setQueryData<ExecutionPackage>(queryKeys.package(packageId), executionPackage);
}

function invalidateRunDetail(queryClient: QueryClient, runSessionId: string) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.run(runSessionId) }),
    queryClient.invalidateQueries({ queryKey: ['run-events', runSessionId] }),
  ]);
}

function normalizePackageRunQuery(query: ListProductQuery): ListProductQuery {
  return {
    project_id: query.project_id,
    ...(query.work_item_id === undefined ? {} : { work_item_id: query.work_item_id }),
    ...(query.plan_revision_id === undefined ? {} : { plan_revision_id: query.plan_revision_id }),
    ...(query.owner_actor_id === undefined ? {} : { owner_actor_id: query.owner_actor_id }),
    ...(query.reviewer_actor_id === undefined ? {} : { reviewer_actor_id: query.reviewer_actor_id }),
    ...(query.qa_owner_actor_id === undefined ? {} : { qa_owner_actor_id: query.qa_owner_actor_id }),
    ...(query.surface_type === undefined ? {} : { surface_type: query.surface_type }),
    ...(query.phase === undefined ? {} : { phase: query.phase }),
    ...(query.status === undefined ? {} : { status: query.status }),
    ...(query.gate_state === undefined ? {} : { gate_state: query.gate_state }),
    ...(query.resolution === undefined ? {} : { resolution: query.resolution }),
    ...(query.risk === undefined ? {} : { risk: query.risk }),
    ...(query.blocked === undefined ? {} : { blocked: query.blocked }),
    ...(query.executor_type === undefined ? {} : { executor_type: query.executor_type }),
    ...(query.execution_package_id === undefined ? {} : { execution_package_id: query.execution_package_id }),
    ...(query.run_session_id === undefined ? {} : { run_session_id: query.run_session_id }),
    ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
    ...(query.limit === undefined ? {} : { limit: query.limit }),
  };
}

function normalizeReviewPacketQuery(query: ListProductQuery): ListProductQuery {
  return {
    project_id: query.project_id,
    ...(query.status === undefined ? {} : { status: query.status }),
    ...(query.reviewer_actor_id === undefined ? {} : { reviewer_actor_id: query.reviewer_actor_id }),
    ...(query.execution_package_id === undefined ? {} : { execution_package_id: query.execution_package_id }),
    ...(query.run_session_id === undefined ? {} : { run_session_id: query.run_session_id }),
    ...(query.review_packet_id === undefined ? {} : { review_packet_id: query.review_packet_id }),
    ...(query.decision === undefined ? {} : { decision: query.decision }),
    ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
    ...(query.limit === undefined ? {} : { limit: query.limit }),
  };
}

function normalizeReleaseQuery(query: ReleaseProductQuery): ReleaseProductQuery {
  return {
    project_id: query.project_id,
    ...(query.release_owner_actor_id === undefined ? {} : { release_owner_actor_id: query.release_owner_actor_id }),
    ...(query.phase === undefined ? {} : { phase: query.phase }),
    ...(query.gate_state === undefined ? {} : { gate_state: query.gate_state }),
    ...(query.resolution === undefined ? {} : { resolution: query.resolution }),
    ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
    ...(query.limit === undefined ? {} : { limit: query.limit }),
  };
}

function updateWorkItemCockpit(
  queryClient: QueryClient,
  workItemId: string | undefined,
  updater: (current: CockpitResponse) => CockpitResponse,
) {
  if (workItemId === undefined) {
    return;
  }

  queryClient.setQueryData<CockpitResponse>(queryKeys.workItemCockpit(workItemId), (current) =>
    current === undefined ? current : updater(current),
  );
}

function setCockpitSpec(queryClient: QueryClient, workItemId: string | undefined, spec: SpecPlan) {
  updateWorkItemCockpit(queryClient, workItemId, (current) =>
    current.work_item === undefined
      ? {
          ...current,
          current_spec: spec,
        }
      : {
          ...current,
          current_spec: spec,
          work_item: {
            ...current.work_item,
            current_spec_id: spec.id,
          },
        },
  );
}

function setCockpitPlan(queryClient: QueryClient, workItemId: string | undefined, plan: SpecPlan) {
  updateWorkItemCockpit(queryClient, workItemId, (current) =>
    current.work_item === undefined
      ? {
          ...current,
          current_plan: plan,
        }
      : {
          ...current,
          current_plan: plan,
          work_item: {
            ...current.work_item,
            current_plan_id: plan.id,
          },
        },
  );
}

function setCockpitSpecRevision(queryClient: QueryClient, workItemId: string | undefined, revision: SpecRevision) {
  updateWorkItemCockpit(queryClient, workItemId, (current) => {
    if (current.current_spec === undefined || current.current_spec === null || current.current_spec.id !== revision.spec_id) {
      return current;
    }

    return {
      ...current,
      current_spec: {
        ...current.current_spec,
        current_revision_id: revision.id,
      },
    };
  });
}

function setCockpitPlanRevision(queryClient: QueryClient, workItemId: string | undefined, revision: PlanRevision) {
  updateWorkItemCockpit(queryClient, workItemId, (current) => {
    if (current.current_plan === undefined || current.current_plan === null || current.current_plan.id !== revision.plan_id) {
      return current;
    }

    return {
      ...current,
      current_plan: {
        ...current.current_plan,
        current_revision_id: revision.id,
      },
    };
  });
}

function requiredId(id: string | undefined, label: string) {
  if (id === undefined) {
    throw new Error(`${label} is required`);
  }
  return id;
}
