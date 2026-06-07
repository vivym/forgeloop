import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';

import {
  createForgeloopCommandApi,
  type ApproveWorkflowArtifactRevisionBody,
  type EvaluateWorkflowExecutionReadinessBody,
  type RequestWorkflowArtifactChangesBody,
  type RevisionCompareQuery,
  type RunQueuedWorkflowActionBody,
  type StartPlanItemWorkflowExecutionBody,
  type StartPlanItemWorkflowBrainstormingBody,
  type WorkflowArtifactType,
  type WorkflowMessageCommandBody,
} from './commands';
import { createForgeloopQueryApi, type MyWorkQuery, type ProjectManagementListQuery } from './query';
import {
  normalizeMyWorkQuery,
  normalizeProductLaneQuery,
  normalizeProductRegistryQuery,
  normalizeProjectManagementListQuery,
  queryKeys,
} from './query-keys';
import type {
  AcknowledgeReleaseTestAcceptanceBody,
  ApproveReleaseBody,
  CloseReleaseBody,
  CreateReleaseBody,
  CreateReleaseEvidenceBody,
  CreateExecutionPackageBody,
  ExecutionPackage,
  LinkReleaseScopeBody,
  ListProductQuery,
  ListReleasesQuery,
  MarkdownDocument,
  OverrideApproveReleaseBody,
  PatchReleaseBody,
  PatchExecutionPackageBody,
  ProductActionTarget,
  ProductCommandAction,
  ProductLaneId,
  ProductLaneQuery,
  ReleaseCommandBody,
  RequestReleaseChangesBody,
  ReviewDecisionBody,
  StartReleaseObservingBody,
  UnlinkReleaseScopeBody,
} from './types';

const createQueryApi = () => createForgeloopQueryApi();
const createCommandApi = () => createForgeloopCommandApi();

type ReleaseProductQuery = {
  project_id: string;
  release_owner_actor_id?: string;
  phase?: NonNullable<ListReleasesQuery['phase']>;
  gate_state?: NonNullable<ListReleasesQuery['gate_state']>;
  resolution?: NonNullable<ListReleasesQuery['resolution']>;
  cursor?: string;
  limit?: number;
};

export function usePipelineQuery(projectId: string) {
  return useQuery({
    queryKey: queryKeys.pipeline(projectId),
    queryFn: () => createQueryApi().getPipeline({ project_id: projectId }),
  });
}

export function useDashboardQuery(query: ListProductQuery) {
  const normalizedQuery = normalizeProductRegistryQuery(query);

  return useQuery({
    queryKey: queryKeys.dashboard(normalizedQuery),
    queryFn: () => createQueryApi().getDashboard(normalizedQuery),
  });
}

export function useDevelopmentPlansQuery(query: ListProductQuery) {
  const normalizedQuery = normalizeProductRegistryQuery(query);

  return useQuery({
    queryKey: queryKeys.developmentPlans(normalizedQuery),
    queryFn: () => createQueryApi().listDevelopmentPlans(normalizedQuery),
  });
}

export function useDevelopmentPlanQuery(developmentPlanId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.developmentPlan(developmentPlanId),
    queryFn: () => createQueryApi().getDevelopmentPlan(requiredId(developmentPlanId, 'developmentPlanId')),
    enabled: developmentPlanId !== undefined,
  });
}

export function useDevelopmentPlanItemQuery(developmentPlanId: string | undefined, itemId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.developmentPlanItem(developmentPlanId, itemId),
    queryFn: () =>
      createQueryApi().getDevelopmentPlanItem(
        requiredId(developmentPlanId, 'developmentPlanId'),
        requiredId(itemId, 'itemId'),
      ),
    enabled: developmentPlanId !== undefined && itemId !== undefined,
  });
}

export function useDevelopmentPlanItemRevisionsQuery(developmentPlanId: string | undefined, itemId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.developmentPlanItemRevisions(developmentPlanId, itemId),
    queryFn: () =>
      createQueryApi().listDevelopmentPlanItemRevisions(
        requiredId(developmentPlanId, 'developmentPlanId'),
        requiredId(itemId, 'itemId'),
      ),
    enabled: developmentPlanId !== undefined && itemId !== undefined,
  });
}

export function useStartPlanItemWorkflowBrainstormingMutation(input: { developmentPlanId: string | undefined; itemId: string | undefined }) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: StartPlanItemWorkflowBrainstormingBody) =>
      createCommandApi().startPlanItemWorkflowBrainstorming(
        requiredId(input.developmentPlanId, 'developmentPlanId'),
        requiredId(input.itemId, 'itemId'),
        body,
      ),
    onSuccess: () => invalidateItemScopedArtifactResources(queryClient, input.developmentPlanId, input.itemId),
  });
}

export function useBoundarySummaryRevisionsQuery(boundarySummaryId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.boundarySummaryRevisions(boundarySummaryId),
    queryFn: () => createQueryApi().listBoundarySummaryRevisions(requiredId(boundarySummaryId, 'boundarySummaryId')),
    enabled: boundarySummaryId !== undefined,
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

export function useBoardQuery(query: ListProductQuery) {
  const normalizedQuery = normalizeProductRegistryQuery(query);

  return useQuery({
    queryKey: queryKeys.board(normalizedQuery),
    queryFn: () => createQueryApi().listBoardCards(normalizedQuery),
  });
}

export function useReportQuery(reportId: string, query: ListProductQuery) {
  const normalizedQuery = normalizeProductRegistryQuery(query);

  return useQuery({
    queryKey: queryKeys.report(reportId, normalizedQuery),
    queryFn: () => createQueryApi().getReport(reportId, normalizedQuery),
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
        action: input.action,
      }),
  });
}

export function useDocumentReviewQueueQuery(query: Pick<ListProductQuery, 'project_id' | 'cursor' | 'limit'>) {
  const normalizedQuery = {
    project_id: query.project_id,
    ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
    ...(query.limit === undefined ? {} : { limit: query.limit }),
  };

  return useQuery({
    queryKey: queryKeys.documentReviewQueue(normalizedQuery),
    queryFn: () => createQueryApi().listDocumentReviewQueue(normalizedQuery),
  });
}

export function useExecutionsQuery(query: ListProductQuery) {
  const normalizedQuery = normalizeProductRegistryQuery(query);

  return useQuery({
    queryKey: queryKeys.executions(normalizedQuery),
    queryFn: () => createQueryApi().listExecutions(normalizedQuery),
  });
}

export function useExecutionQuery(executionId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.execution(executionId),
    queryFn: () => createQueryApi().getExecution(requiredId(executionId, 'executionId')),
    enabled: executionId !== undefined,
  });
}

export function useCodeReviewHandoffsQuery(query: ListProductQuery) {
  const normalizedQuery = normalizeProductRegistryQuery(query);

  return useQuery({
    queryKey: queryKeys.codeReviewHandoffs(normalizedQuery),
    queryFn: () => createQueryApi().listCodeReviewHandoffs(normalizedQuery),
  });
}

export function useQaHandoffsQuery(query: ListProductQuery) {
  const normalizedQuery = normalizeProductRegistryQuery(query);

  return useQuery({
    queryKey: queryKeys.qaHandoffs(normalizedQuery),
    queryFn: () => createQueryApi().listQaHandoffs(normalizedQuery),
  });
}

export function usePackageQuery(packageId: string) {
  return useQuery({
    queryKey: queryKeys.package(packageId),
    queryFn: () => createCommandApi().getExecutionPackage(packageId),
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
    queryFn: () => createCommandApi().listReleases(normalizedQuery),
  });
}

export function useReleaseReadinessQuery(releaseId: string | undefined, projectId: string) {
  return useQuery({
    queryKey: queryKeys.releaseReadiness(releaseId, projectId),
    queryFn: () => createQueryApi().getReleaseReadiness(requiredId(releaseId, 'releaseId'), { project_id: projectId }),
    enabled: releaseId !== undefined,
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

export function useReleaseCockpitQuery(releaseId: string) {
  return useQuery({
    queryKey: queryKeys.releaseCockpit(releaseId),
    queryFn: () => createQueryApi().getReleaseCockpit(releaseId),
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

export function usePlanItemWorkflowCommandMutation(input: { developmentPlanId: string | undefined; itemId: string | undefined; workflowId: string | undefined }) {
  const queryClient = useQueryClient();
  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.planItemWorkflow(input.workflowId) }),
      invalidateItemScopedArtifactResources(queryClient, input.developmentPlanId, input.itemId),
    ]);

  return {
    recordMessage: useMutation({
      mutationFn: (body: WorkflowMessageCommandBody) => createCommandApi().recordWorkflowMessage(requiredId(input.workflowId, 'workflowId'), body),
      onSuccess: invalidate,
    }),
	    runQueuedAction: useMutation({
	      mutationFn: (body: RunQueuedWorkflowActionBody & { action_id: string }) =>
	        createCommandApi().runWorkflowQueuedAction(requiredId(input.workflowId, 'workflowId'), body.action_id, {
	          actor_id: body.actor_id,
	        }),
	      onSuccess: invalidate,
	    }),
    approveArtifactRevision: useMutation({
      mutationFn: (body: ApproveWorkflowArtifactRevisionBody & { artifact_type: WorkflowArtifactType; revision_id: string }) =>
        createCommandApi().approveWorkflowArtifactRevision(
          requiredId(input.workflowId, 'workflowId'),
          body.artifact_type,
          body.revision_id,
          {
            actor_id: body.actor_id,
            ...(body.decision_markdown === undefined ? {} : { decision_markdown: body.decision_markdown }),
          },
        ),
      onSuccess: invalidate,
    }),
    requestArtifactChanges: useMutation({
      mutationFn: (body: RequestWorkflowArtifactChangesBody & { artifact_type: WorkflowArtifactType; revision_id: string }) =>
        createCommandApi().requestWorkflowArtifactChanges(
          requiredId(input.workflowId, 'workflowId'),
          body.artifact_type,
          body.revision_id,
          {
            actor_id: body.actor_id,
            reason_markdown: body.reason_markdown,
          },
        ),
      onSuccess: invalidate,
    }),
    evaluateReadiness: useMutation({
      mutationFn: (body: EvaluateWorkflowExecutionReadinessBody) =>
        createCommandApi().evaluateWorkflowExecutionReadiness(requiredId(input.workflowId, 'workflowId'), body),
      onSuccess: invalidate,
    }),
    startExecution: useMutation({
      mutationFn: (body: StartPlanItemWorkflowExecutionBody) =>
        createCommandApi().startPlanItemWorkflowExecution(requiredId(input.workflowId, 'workflowId'), body),
      onSuccess: (workflow) =>
        Promise.all([
          invalidate(),
          workflow.execution_run_summary?.run_session_id === undefined
            ? Promise.resolve()
            : invalidateRunDetail(queryClient, workflow.execution_run_summary.run_session_id),
        ]),
    }),
  };
}

export function useCompareItemSpecRevisionsQuery(
  input: { developmentPlanId: string | undefined; itemId: string | undefined; query: RevisionCompareQuery | undefined },
) {
  return useQuery({
    queryKey: ['item-spec-revision-compare', input.developmentPlanId, input.itemId, input.query],
    queryFn: () =>
      createCommandApi().compareItemSpecRevisions(
        requiredId(input.developmentPlanId, 'developmentPlanId'),
        requiredId(input.itemId, 'itemId'),
        requiredValue(input.query, 'query'),
      ),
    enabled: input.developmentPlanId !== undefined && input.itemId !== undefined && input.query !== undefined,
  });
}

export function useCompareItemImplementationPlanRevisionsQuery(
  input: { developmentPlanId: string | undefined; itemId: string | undefined; query: RevisionCompareQuery | undefined },
) {
  return useQuery({
    queryKey: ['item-implementation-plan-revision-compare', input.developmentPlanId, input.itemId, input.query],
    queryFn: () =>
      createCommandApi().compareItemImplementationPlanRevisions(
        requiredId(input.developmentPlanId, 'developmentPlanId'),
        requiredId(input.itemId, 'itemId'),
        requiredValue(input.query, 'query'),
      ),
    enabled: input.developmentPlanId !== undefined && input.itemId !== undefined && input.query !== undefined,
  });
}

type ProductActionCommandInput = {
  actorId: string;
};

type ProductActionInvalidationInput = {
  projectId: string;
  action: ProductCommandAction;
};

type ProductObjectTarget = Extract<ProductActionTarget, { kind: 'object' }>;

function executeProductCommand(action: ProductCommandAction, input: ProductActionCommandInput) {
  const commandApi = createCommandApi();
  const command = action.command;

  switch (command.type) {
    case 'generate_packages':
      return commandApi.generatePackages(command.plan_revision_id);
    case 'mark_package_ready':
      return commandApi.markPackageReady(command.package_id, {
        actor_id: requiredActorId(input.actorId, 'actorId'),
        expected_package_version: command.expected_package_version,
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
    invalidateCommandDerivedResources(queryClient, input.action.command),
    input.action.target === undefined ? Promise.resolve() : invalidateTargetQuery(queryClient, input.action.target),
  ]);
}

function invalidateCommandDerivedResources(queryClient: QueryClient, command: ProductCommandAction['command']) {
  switch (command.type) {
    case 'generate_packages':
      return invalidatePackageDeliveryCollections(queryClient);
    case 'mark_package_ready':
      return invalidatePackageResources(queryClient, command.package_id);
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
      return queryClient.invalidateQueries({ queryKey: queryKeys.workItem(objectId) });
    case 'development_plan':
      return queryClient.invalidateQueries({ queryKey: queryKeys.developmentPlan(objectId) });
    case 'development_plan_item':
      return queryClient.invalidateQueries({ queryKey: ['development-plan-item'] });
    case 'brainstorming_session':
    case 'boundary_summary':
      return queryClient.invalidateQueries({ queryKey: ['development-plans'] });
    case 'spec':
      return queryClient.invalidateQueries({ queryKey: queryKeys.spec(objectId) });
    case 'spec_revision':
      return queryClient.invalidateQueries({ queryKey: queryKeys.specRevision(objectId) });
    case 'implementation_plan_doc':
      return queryClient.invalidateQueries({ queryKey: queryKeys.plan(objectId) });
    case 'implementation_plan_revision':
      return queryClient.invalidateQueries({ queryKey: queryKeys.planRevision(objectId) });
    case 'execution':
      return queryClient.invalidateQueries({ queryKey: queryKeys.execution(objectId) });
    case 'code_review_handoff':
      return queryClient.invalidateQueries({ queryKey: ['code-review-handoffs'] });
    case 'qa_handoff':
      return queryClient.invalidateQueries({ queryKey: ['qa-handoffs'] });
    case 'release':
      return invalidateReleaseCockpit(queryClient, objectId);
    case 'attachment':
      return Promise.resolve();
    default: {
      const exhaustive: never = objectType;
      throw new Error(`Unsupported ProductAction target object type: ${exhaustive}`);
    }
  }
}

function invalidateItemScopedArtifactResources(
  queryClient: QueryClient,
  developmentPlanId: string | undefined,
  itemId: string | undefined,
) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: ['development-plans'] }),
    queryClient.invalidateQueries({ queryKey: ['development-plan', developmentPlanId] }),
    queryClient.invalidateQueries({ queryKey: ['development-plan-item', developmentPlanId, itemId] }),
    queryClient.invalidateQueries({ queryKey: queryKeys.developmentPlanItemRevisions(developmentPlanId, itemId) }),
    queryClient.invalidateQueries({ queryKey: ['item-spec-revision-compare', developmentPlanId, itemId] }),
    queryClient.invalidateQueries({ queryKey: ['item-implementation-plan-revision-compare', developmentPlanId, itemId] }),
    queryClient.invalidateQueries({ queryKey: ['document-review-queue'] }),
  ]);
}

function invalidatePackageDetail(queryClient: QueryClient, packageId: string) {
  return queryClient.invalidateQueries({ queryKey: queryKeys.package(packageId) });
}

function invalidatePackageResources(queryClient: QueryClient, packageId: string) {
  return Promise.all([
    invalidatePackageDetail(queryClient, packageId),
    invalidatePackageDeliveryCollections(queryClient),
  ]);
}

function invalidatePackages(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: ['packages'] });
}

function invalidateDeliverySurfaces(queryClient: QueryClient) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: ['product-lanes'] }),
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
    queryClient.invalidateQueries({ queryKey: ['review-packets'] }),
    queryClient.invalidateQueries({ queryKey: ['packages'] }),
    queryClient.invalidateQueries({ queryKey: ['product-lanes'] }),
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

function requiredId(id: string | undefined, label: string) {
  if (id === undefined) {
    throw new Error(`${label} is required`);
  }
  return id;
}

function requiredValue<T>(value: T | undefined, label: string): T {
  if (value === undefined) {
    throw new Error(`${label} is required`);
  }
  return value;
}

function requiredActorId(actorId: string | undefined, label: string) {
  if (actorId === undefined || actorId.trim().length === 0) {
    throw new Error(`${label} is required`);
  }
  return actorId;
}
