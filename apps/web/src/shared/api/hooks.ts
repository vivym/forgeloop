import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';

import { createForgeloopCommandApi } from './commands';
import { createForgeloopQueryApi, type MyWorkQuery, type ProjectManagementListQuery } from './query';
import { normalizeMyWorkQuery, normalizeProductLaneQuery, normalizeProjectManagementListQuery, queryKeys } from './query-keys';
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
  MarkdownDocument,
  OverrideApproveReleaseBody,
  PatchReleaseBody,
  PatchExecutionPackageBody,
  ProductActionTarget,
  ProductCommandAction,
  ProductLaneId,
  ProductLaneQuery,
  PlanRevision,
  ReleaseCommandBody,
  RequestArtifactChangesBody,
  RequestReleaseChangesBody,
  ReviewDecisionBody,
  SpecPlan,
  SpecRevision,
  StartReleaseObservingBody,
  SubmitForApprovalBody,
  TaskPackageEvidence,
  TaskReviewEvidence,
  TaskRunEvidence,
  UnlinkReleaseScopeBody,
} from './types';

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

export function useProductWorkItemsQuery(query: Pick<ListProductQuery, 'project_id' | 'phase' | 'status' | 'risk' | 'driver_actor_id' | 'cursor' | 'limit'>) {
  const normalizedQuery = {
    project_id: query.project_id,
    ...(query.phase === undefined ? {} : { phase: query.phase }),
    ...(query.status === undefined ? {} : { status: query.status }),
    ...(query.risk === undefined ? {} : { risk: query.risk }),
    ...(query.driver_actor_id === undefined ? {} : { driver_actor_id: query.driver_actor_id }),
    ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
    ...(query.limit === undefined ? {} : { limit: query.limit }),
  };

  return useQuery({
    queryKey: queryKeys.productWorkItems(normalizedQuery),
    queryFn: () => createQueryApi().listWorkItems(normalizedQuery),
  });
}

export function useMyWorkQuery(query: MyWorkQuery) {
  const normalizedQuery = normalizeMyWorkQuery(query);

  return useQuery({
    queryKey: queryKeys.myWork(normalizedQuery),
    queryFn: () => createQueryApi().listMyWork(normalizedQuery),
  });
}

export function useRequirementsQuery(query: ProjectManagementListQuery) {
  const normalizedQuery = normalizeProjectManagementListQuery(query);

  return useQuery({
    queryKey: queryKeys.requirements(normalizedQuery),
    queryFn: () => createQueryApi().listRequirements(normalizedQuery),
  });
}

export function useRequirementQuery(requirementId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.requirement(requirementId),
    queryFn: () => createQueryApi().getRequirement(requiredId(requirementId, 'requirementId')),
    enabled: requirementId !== undefined,
  });
}

export function useInitiativesQuery(query: ProjectManagementListQuery) {
  const normalizedQuery = normalizeProjectManagementListQuery(query);

  return useQuery({
    queryKey: queryKeys.initiatives(normalizedQuery),
    queryFn: () => createQueryApi().listInitiatives(normalizedQuery),
  });
}

export function useInitiativeQuery(initiativeId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.initiative(initiativeId),
    queryFn: () => createQueryApi().getInitiative(requiredId(initiativeId, 'initiativeId')),
    enabled: initiativeId !== undefined,
  });
}

export function useTechDebtQuery(query: ProjectManagementListQuery) {
  const normalizedQuery = normalizeProjectManagementListQuery(query);

  return useQuery({
    queryKey: queryKeys.techDebt(normalizedQuery),
    queryFn: () => createQueryApi().listTechDebt(normalizedQuery),
  });
}

export function useTechDebtDetailQuery(techDebtId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.techDebtDetail(techDebtId),
    queryFn: () => createQueryApi().getTechDebt(requiredId(techDebtId, 'techDebtId')),
    enabled: techDebtId !== undefined,
  });
}

export function useTasksQuery(query: ProjectManagementListQuery) {
  const normalizedQuery = normalizeProjectManagementListQuery(query);

  return useQuery({
    queryKey: queryKeys.tasks(normalizedQuery),
    queryFn: () => createQueryApi().listTasks(normalizedQuery),
  });
}

export function useTaskQuery(taskId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.task(taskId),
    queryFn: () => createQueryApi().getTask(requiredId(taskId, 'taskId')),
    enabled: taskId !== undefined,
  });
}

export function useBugsQuery(query: ProjectManagementListQuery) {
  const normalizedQuery = normalizeProjectManagementListQuery(query);

  return useQuery({
    queryKey: queryKeys.bugs(normalizedQuery),
    queryFn: () => createQueryApi().listBugs(normalizedQuery),
  });
}

export function useBugQuery(bugId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.bug(bugId),
    queryFn: () => createQueryApi().getBug(requiredId(bugId, 'bugId')),
    enabled: bugId !== undefined,
  });
}

export function useUpdateRequirementNarrativeMutation(requirementId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: MarkdownDocument) => createCommandApi().updateRequirementNarrative(requiredId(requirementId, 'requirementId'), body),
    onSuccess: () => Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.requirement(requirementId) }),
      queryClient.invalidateQueries({ queryKey: ['requirements'] }),
    ]),
  });
}

export function useUpdateInitiativeNarrativeMutation(initiativeId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: MarkdownDocument) => createCommandApi().updateInitiativeNarrative(requiredId(initiativeId, 'initiativeId'), body),
    onSuccess: () => Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.initiative(initiativeId) }),
      queryClient.invalidateQueries({ queryKey: ['initiatives'] }),
    ]),
  });
}

export function useUpdateTechDebtNarrativeMutation(techDebtId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: MarkdownDocument) => createCommandApi().updateTechDebtNarrative(requiredId(techDebtId, 'techDebtId'), body),
    onSuccess: () => Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.techDebtDetail(techDebtId) }),
      queryClient.invalidateQueries({ queryKey: ['tech-debt'] }),
    ]),
  });
}

export function useUpdateTaskNarrativeMutation(taskId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: MarkdownDocument) => createCommandApi().updateTaskNarrative(requiredId(taskId, 'taskId'), body),
    onSuccess: () => Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.task(taskId) }),
      queryClient.invalidateQueries({ queryKey: ['tasks'] }),
    ]),
  });
}

export function useUpdateBugNarrativeMutation(bugId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: MarkdownDocument) => createCommandApi().updateBugNarrative(requiredId(bugId, 'bugId'), body),
    onSuccess: () => Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.bug(bugId) }),
      queryClient.invalidateQueries({ queryKey: ['bugs'] }),
    ]),
  });
}

export function useProductLaneQuery(laneId: ProductLaneId, query: ProductLaneQuery) {
  const normalizedQuery = normalizeProductLaneQuery(query);

  return useQuery({
    queryKey: queryKeys.productLane(laneId, normalizedQuery),
    queryFn: () => createQueryApi().getProductLane(laneId, normalizedQuery),
  });
}

export function useProductActionCommandMutation(input: { projectId: string; action: ProductCommandAction }) {
  const queryClient = useQueryClient();

  return useMutation<unknown, Error, ProductActionCommandInput>({
    mutationFn: (commandInput) => executeProductCommand(input.action, commandInput),
    onSettled: () =>
      invalidateProductActionTargets(queryClient, {
        projectId: input.projectId,
        workItemId: workItemIdFromCommandScope(input.action.command.scope_ref),
        action: input.action,
      }),
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

export function usePackageRuntimeReadinessQuery(packageId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.packageRuntimeReadiness(packageId),
    queryFn: () => createQueryApi().getExecutionPackageRuntimeReadiness(requiredId(packageId, 'packageId')),
    enabled: packageId !== undefined,
  });
}

export function useTaskPackageEvidenceQuery(taskId: string | undefined, packageId: string | undefined) {
  return useQuery<TaskPackageEvidence>({
    queryKey: queryKeys.taskPackageEvidence(taskId, packageId),
    queryFn: () => createQueryApi().getTaskPackageEvidence(requiredId(taskId, 'taskId'), requiredId(packageId, 'packageId')),
    enabled: taskId !== undefined && packageId !== undefined,
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

export function useTaskRunEvidenceQuery(taskId: string | undefined, runSessionId: string | undefined) {
  return useQuery<TaskRunEvidence>({
    queryKey: queryKeys.taskRunEvidence(taskId, runSessionId),
    queryFn: () => createQueryApi().getTaskRunEvidence(requiredId(taskId, 'taskId'), requiredId(runSessionId, 'runSessionId')),
    enabled: taskId !== undefined && runSessionId !== undefined,
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

export function useReviewQuery(reviewPacketId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.review(reviewPacketId),
    queryFn: () => createQueryApi().getReview(requiredId(reviewPacketId, 'reviewPacketId')),
    enabled: reviewPacketId !== undefined,
  });
}

export function useTaskReviewEvidenceQuery(taskId: string | undefined, reviewPacketId: string | undefined) {
  return useQuery<TaskReviewEvidence>({
    queryKey: queryKeys.taskReviewEvidence(taskId, reviewPacketId),
    queryFn: () => createQueryApi().getTaskReviewEvidence(requiredId(taskId, 'taskId'), requiredId(reviewPacketId, 'reviewPacketId')),
    enabled: taskId !== undefined && reviewPacketId !== undefined,
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
      return invalidatePackageResources(queryClient, packageId);
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

export function useWorkItemCockpitQuery(workItemId: string | undefined, lane?: ProductLaneId) {
  return useQuery({
    queryKey: queryKeys.workItemCockpit(workItemId, lane),
    queryFn: () => createQueryApi().getWorkItemCockpit(requiredId(workItemId, 'workItemId'), lane === undefined ? {} : { lane }),
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
    onSuccess: () => invalidatePackageDeliveryCollections(queryClient),
  });
}

export function useCreateExecutionPackageMutation(planRevisionId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: CreateExecutionPackageBody) =>
      createCommandApi().createExecutionPackage(requiredId(planRevisionId, 'planRevisionId'), body),
    onSuccess: (executionPackage) => {
      setPackageDetail(queryClient, executionPackage.id, executionPackage);
      return invalidatePackageResources(queryClient, executionPackage.id);
    },
  });
}

export function usePatchExecutionPackageMutation(packageId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: PatchExecutionPackageBody) => createCommandApi().patchExecutionPackage(packageId, body),
    onSuccess: (executionPackage) => {
      setPackageDetail(queryClient, packageId, executionPackage);
      return invalidatePackageResources(queryClient, packageId);
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
    onSuccess: () => invalidateReleaseDeliveryResources(queryClient, releaseId),
  });
}

export function useUnlinkReleaseWorkItemMutation(releaseId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { workItemId: string; body: UnlinkReleaseScopeBody }) =>
      createCommandApi().unlinkReleaseWorkItem(releaseId, input.workItemId, input.body),
    onSuccess: () => invalidateReleaseDeliveryResources(queryClient, releaseId),
  });
}

export function useLinkReleaseExecutionPackageMutation(releaseId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { packageId: string; body: LinkReleaseScopeBody }) =>
      createCommandApi().linkReleaseExecutionPackage(releaseId, input.packageId, input.body),
    onSuccess: () => invalidateReleaseDeliveryResources(queryClient, releaseId),
  });
}

export function useUnlinkReleaseExecutionPackageMutation(releaseId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { packageId: string; body: UnlinkReleaseScopeBody }) =>
      createCommandApi().unlinkReleaseExecutionPackage(releaseId, input.packageId, input.body),
    onSuccess: () => invalidateReleaseDeliveryResources(queryClient, releaseId),
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
      return Promise.all([
        invalidateWorkItemCockpit(queryClient, input.workItemId),
        input.specId === undefined
          ? Promise.resolve()
          : queryClient.invalidateQueries({ queryKey: queryKeys.specRevisions(input.specId) }),
      ]);
    },
  });
}

export function useGeneratePlanDraftMutation(input: { workItemId: string | undefined; planId: string | undefined }) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => createCommandApi().generatePlanDraft(requiredId(input.planId, 'planId')),
    onSuccess: (revision) => {
      setCockpitPlanRevision(queryClient, input.workItemId, revision);
      return Promise.all([
        invalidateWorkItemCockpit(queryClient, input.workItemId),
        input.planId === undefined
          ? Promise.resolve()
          : queryClient.invalidateQueries({ queryKey: queryKeys.planRevisions(input.planId) }),
      ]);
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
        plan.approved_revision_id === undefined ? Promise.resolve() : invalidatePackageDeliveryCollections(queryClient),
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

type ProductActionCommandInput = {
  actorId: string;
};

type ProductActionInvalidationInput = {
  projectId: string;
  workItemId: string | undefined;
  action: ProductCommandAction;
};

type ProductObjectTarget = Extract<ProductActionTarget, { kind: 'object' }>;

function executeProductCommand(action: ProductCommandAction, input: ProductActionCommandInput) {
  const commandApi = createCommandApi();
  const command = action.command;

  switch (command.type) {
    case 'generate_spec_draft':
      return commandApi.generateSpecDraft(command.spec_id);
    case 'generate_plan_draft':
      return commandApi.generatePlanDraft(command.plan_id);
    case 'generate_packages':
      return commandApi.generatePackages(command.plan_revision_id);
    case 'mark_package_ready':
      return commandApi.markPackageReady(command.package_id, {
        actor_id: requiredActorId(input.actorId, 'actorId'),
        expected_package_version: command.expected_package_version,
      });
    case 'run_package':
      return commandApi.runPackage(command.package_id, requiredActorId(input.actorId, 'actorId'), {
        execution_package_id: command.package_id,
        executor_type: 'local_codex',
      });
    default: {
      const exhaustive: never = command;
      throw new Error(`Unsupported ProductAction command: ${JSON.stringify(exhaustive)}`);
    }
  }
}

export function invalidateProductActionTargets(queryClient: QueryClient, input: ProductActionInvalidationInput) {
  return Promise.all([
    invalidateProductLaneProjectQueries(queryClient, input.projectId),
    input.workItemId === undefined ? Promise.resolve() : invalidateWorkItemCockpit(queryClient, input.workItemId),
    invalidateObjectQuery(queryClient, input.action.command.object_type, input.action.command.object_id),
    invalidateCommandDerivedResources(queryClient, input.action.command),
    input.action.target === undefined ? Promise.resolve() : invalidateTargetQuery(queryClient, input.action.target),
  ]);
}

function workItemIdFromCommandScope(scopeRef: ProductCommandAction['command']['scope_ref']): string | undefined {
  switch (scopeRef.type) {
    case 'initiative':
    case 'requirement':
    case 'bug':
    case 'tech_debt':
    case 'task':
      return scopeRef.id;
    default:
      return undefined;
  }
}

function invalidateCommandDerivedResources(queryClient: QueryClient, command: ProductCommandAction['command']) {
  switch (command.type) {
    case 'generate_spec_draft':
      return queryClient.invalidateQueries({ queryKey: queryKeys.specRevisions(command.spec_id) });
    case 'generate_plan_draft':
      return queryClient.invalidateQueries({ queryKey: queryKeys.planRevisions(command.plan_id) });
    case 'generate_packages':
      return invalidatePackageDeliveryCollections(queryClient);
    case 'mark_package_ready':
    case 'run_package':
      return Promise.resolve();
    default: {
      const exhaustive: never = command;
      throw new Error(`Unsupported ProductAction command for invalidation: ${JSON.stringify(exhaustive)}`);
    }
  }
}

function invalidateProductLaneProjectQueries(queryClient: QueryClient, projectId: string) {
  return queryClient.invalidateQueries({
    predicate: ({ queryKey }) => {
      if (queryKey[0] !== 'product-lanes') {
        return false;
      }

      const filters = queryKey[2];
      return (
        typeof filters === 'object' &&
        filters !== null &&
        !Array.isArray(filters) &&
        (filters as { project_id?: unknown }).project_id === projectId
      );
    },
  });
}

function invalidateTargetQuery(queryClient: QueryClient, target: ProductActionTarget) {
  if (target.kind === 'route') {
    return Promise.resolve();
  }

  return invalidateObjectQuery(queryClient, target.object_type, target.object_id);
}

function invalidateObjectQuery(queryClient: QueryClient, objectType: ProductObjectTarget['object_type'], objectId: string) {
  switch (objectType) {
    case 'initiative':
    case 'requirement':
    case 'bug':
    case 'tech_debt':
    case 'task':
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.workItem(objectId) }),
        invalidateWorkItemCockpit(queryClient, objectId),
      ]);
    case 'spec':
      return queryClient.invalidateQueries({ queryKey: queryKeys.spec(objectId) });
    case 'spec_revision':
      return queryClient.invalidateQueries({ queryKey: queryKeys.specRevision(objectId) });
    case 'plan':
      return queryClient.invalidateQueries({ queryKey: queryKeys.plan(objectId) });
    case 'plan_revision':
      return queryClient.invalidateQueries({ queryKey: queryKeys.planRevision(objectId) });
    case 'execution_package':
      return invalidatePackageResources(queryClient, objectId);
    case 'run_session':
      return invalidateRunDetail(queryClient, objectId);
    case 'review_packet':
      return invalidateReviewPacketResources(queryClient, objectId);
    case 'release':
      return invalidateReleaseCockpit(queryClient, objectId);
    default: {
      const exhaustive: never = objectType;
      throw new Error(`Unsupported ProductAction target object type: ${exhaustive}`);
    }
  }
}

function invalidateWorkItemCockpit(queryClient: QueryClient, workItemId: string | undefined) {
  if (workItemId === undefined) {
    return Promise.resolve();
  }

  return queryClient.invalidateQueries({
    predicate: ({ queryKey }) => queryKey[0] === 'work-item-cockpit' && queryKey[1] === workItemId,
  });
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
  return Promise.all([
    invalidatePackageDetail(queryClient, packageId),
    queryClient.invalidateQueries({ queryKey: queryKeys.packageRuntimeReadiness(packageId) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.executionPackageReplay(packageId) }),
    invalidatePackageDeliveryCollections(queryClient),
  ]);
}

function invalidatePackages(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: ['packages'] });
}

function invalidateDeliverySurfaces(queryClient: QueryClient) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: ['product-lanes'] }),
    queryClient.invalidateQueries({ queryKey: ['work-item-cockpit'] }),
    queryClient.invalidateQueries({ queryKey: ['runs'] }),
    queryClient.invalidateQueries({ queryKey: ['review-packets'] }),
  ]);
}

function invalidatePackageDeliveryCollections(queryClient: QueryClient) {
  return Promise.all([invalidatePackages(queryClient), invalidateDeliverySurfaces(queryClient)]);
}

function invalidateReviewPacketResources(queryClient: QueryClient, reviewPacketId: string) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: ['review'] }),
    queryClient.invalidateQueries({ queryKey: queryKeys.review(reviewPacketId) }),
    queryClient.invalidateQueries({ queryKey: ['review-packet-replay'] }),
    queryClient.invalidateQueries({ queryKey: ['replay'] }),
    queryClient.invalidateQueries({ queryKey: ['review-packets'] }),
    queryClient.invalidateQueries({ queryKey: ['packages'] }),
    queryClient.invalidateQueries({ queryKey: ['product-lanes'] }),
    queryClient.invalidateQueries({ queryKey: ['work-item-cockpit'] }),
  ]);
}

function invalidateReleases(queryClient: QueryClient, projectId: string) {
  return queryClient.invalidateQueries({ queryKey: ['releases', { project_id: projectId }] });
}

function invalidateReleaseCockpit(queryClient: QueryClient, releaseId: string) {
  return queryClient.invalidateQueries({ queryKey: queryKeys.releaseCockpit(releaseId) });
}

function invalidateReleaseDeliveryResources(queryClient: QueryClient, releaseId: string) {
  return Promise.all([
    invalidateReleaseCockpit(queryClient, releaseId),
    queryClient.invalidateQueries({ queryKey: queryKeys.releaseReplay(releaseId) }),
    queryClient.invalidateQueries({ queryKey: ['releases'] }),
    invalidatePackageDeliveryCollections(queryClient),
  ]);
}

function useReleaseCommandMutation<TBody>(releaseId: string, mutationFn: (body: TBody) => Promise<unknown>) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn,
    onSuccess: () => invalidateReleaseDeliveryResources(queryClient, releaseId),
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
    ...(query.plan_revision_id === undefined ? {} : { plan_revision_id: query.plan_revision_id }),
    ...(query.execution_owner_actor_id === undefined ? {} : { execution_owner_actor_id: query.execution_owner_actor_id }),
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

  queryClient.setQueriesData<CockpitResponse>({ queryKey: queryKeys.workItemCockpit(workItemId) }, (current) =>
    current === undefined ? current : updater(current),
  );
}

function setCockpitSpec(queryClient: QueryClient, workItemId: string | undefined, spec: SpecPlan) {
  updateWorkItemCockpit(queryClient, workItemId, (current) =>
    current.item === undefined
      ? {
          ...current,
          current_spec: spec,
        }
      : {
          ...current,
          current_spec: spec,
          item: {
            ...current.item,
            current_spec_id: spec.id,
          },
        },
  );
}

function setCockpitPlan(queryClient: QueryClient, workItemId: string | undefined, plan: SpecPlan) {
  updateWorkItemCockpit(queryClient, workItemId, (current) =>
    current.item === undefined
      ? {
          ...current,
          current_plan: plan,
        }
      : {
          ...current,
          current_plan: plan,
          item: {
            ...current.item,
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

function requiredActorId(actorId: string | undefined, label: string) {
  if (actorId === undefined || actorId.trim().length === 0) {
    throw new Error(`${label} is required`);
  }
  return actorId;
}
