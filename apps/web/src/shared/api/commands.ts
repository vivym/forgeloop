import { createApiContext, type ForgeloopApiOptions } from './common';
import { createWorkItemRequestSchema } from '@forgeloop/contracts';
import type {
  ActorCommandBody,
  AcknowledgeReleaseTestAcceptanceBody,
  ApproveArtifactBody,
  ApproveReleaseBody,
  CreateExecutionPackageBody,
  CreateReleaseBody,
  CreateReleaseEvidenceBody,
  CreatePlanRevisionBody,
  CreateSpecRevisionBody,
  CreateWorkItemBody,
  EvidenceChainResponse,
  ExecutionPackage,
  CloseReleaseBody,
  LinkReleaseObjectResponse,
  LinkReleaseScopeBody,
  ListReleasesQuery,
  MarkPackageReadyBody,
  MarkdownDocument,
  OverrideApproveReleaseBody,
  PatchExecutionPackageBody,
  PatchReleaseBody,
  PlanRevision,
  ReleaseCommandBody,
  ReleaseControlResponse,
  ReleaseListResponse,
  ReleaseResourceResponse,
  RequestArtifactChangesBody,
  RequestReleaseChangesBody,
  ReviewDecisionBody,
  ReviewPacket,
  RunEvent,
  RunEventListResponse,
  RunEventStream,
  RunEventStreamHandlers,
  RunOperatorCommandResponse,
  RunPackageBody,
  RunSession,
  BugDetail,
  InitiativeDetail,
  SpecPlan,
  SpecRevision,
  StartReleaseObservingBody,
  SubmitForApprovalBody,
  RequirementDetail,
  TaskDetail,
  TechDebtDetail,
  UnlinkReleaseScopeBody,
  WorkItem,
} from './types';

const runEventsQuery = (options: { after?: string; streamToken?: string }) => {
  const params = new URLSearchParams();
  if (options.streamToken !== undefined) params.set('stream_token', options.streamToken);
  if (options.after !== undefined) params.set('after', options.after);
  return params.toString();
};

const requireRunEventStreamToken = (payload: unknown) => {
  if (
    typeof payload !== 'object' ||
    payload === null ||
    !('token' in payload) ||
    typeof payload.token !== 'string' ||
    payload.token.trim().length === 0
  ) {
    throw new Error('Malformed run event stream token response');
  }

  return payload.token;
};

const queryString = (params: Record<string, unknown>) => {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      searchParams.set(key, String(value));
    }
  }
  const encoded = searchParams.toString();
  return encoded ? `?${encoded}` : '';
};

const releaseListQueryString = (query: ListReleasesQuery) =>
  queryString({
    project_id: query.project_id,
    release_owner_actor_id: query.release_owner_actor_id,
    phase: query.phase,
    gate_state: query.gate_state,
    resolution: query.resolution,
    limit: query.limit,
    cursor: query.cursor,
  });

const releaseActorId = (body: { actor_id: string }) => body.actor_id;
const actorCommandActorId = (body: ActorCommandBody) => body.actor_id;
const reviewDecisionActorId = (body: ReviewDecisionBody) => body.reviewed_by_actor_id;
const actorRequest = (actorId: string | undefined) => (actorId === undefined ? {} : { actorId });

export function createForgeloopCommandApi(options: ForgeloopApiOptions = {}) {
  const { baseUrl, request } = createApiContext(options);

  return {
    createRelease: (body: CreateReleaseBody) =>
      request<ReleaseControlResponse>('/releases', { method: 'POST', body, actorId: releaseActorId(body) }),
    listReleases: (query: ListReleasesQuery) => request<ReleaseListResponse>(`/releases${releaseListQueryString(query)}`),
    getRelease: (releaseId: string, projectId: string) =>
      request<ReleaseResourceResponse>(`/releases/${encodeURIComponent(releaseId)}${queryString({ project_id: projectId })}`),
    patchRelease: (releaseId: string, body: PatchReleaseBody) =>
      request<ReleaseControlResponse>(`/releases/${encodeURIComponent(releaseId)}`, {
        method: 'PATCH',
        body,
        actorId: releaseActorId(body),
      }),
    linkReleaseWorkItem: (releaseId: string, workItemId: string, body: LinkReleaseScopeBody) =>
      request<LinkReleaseObjectResponse>(`/releases/${encodeURIComponent(releaseId)}/work-items/${encodeURIComponent(workItemId)}`, {
        method: 'POST',
        body,
        actorId: releaseActorId(body),
      }),
    unlinkReleaseWorkItem: (releaseId: string, workItemId: string, body: UnlinkReleaseScopeBody) =>
      request<LinkReleaseObjectResponse>(`/releases/${encodeURIComponent(releaseId)}/work-items/${encodeURIComponent(workItemId)}`, {
        method: 'DELETE',
        body,
        actorId: releaseActorId(body),
      }),
    linkReleaseExecutionPackage: (releaseId: string, packageId: string, body: LinkReleaseScopeBody) =>
      request<LinkReleaseObjectResponse>(
        `/releases/${encodeURIComponent(releaseId)}/execution-packages/${encodeURIComponent(packageId)}`,
        {
          method: 'POST',
          body,
          actorId: releaseActorId(body),
        },
      ),
    unlinkReleaseExecutionPackage: (releaseId: string, packageId: string, body: UnlinkReleaseScopeBody) =>
      request<LinkReleaseObjectResponse>(
        `/releases/${encodeURIComponent(releaseId)}/execution-packages/${encodeURIComponent(packageId)}`,
        {
          method: 'DELETE',
          body,
          actorId: releaseActorId(body),
        },
      ),
    submitReleaseForApproval: (releaseId: string, body: ReleaseCommandBody) =>
      request<ReleaseControlResponse>(`/releases/${encodeURIComponent(releaseId)}/submit-for-approval`, {
        method: 'POST',
        body,
        actorId: releaseActorId(body),
      }),
    approveRelease: (releaseId: string, body: ApproveReleaseBody) =>
      request<ReleaseControlResponse>(`/releases/${encodeURIComponent(releaseId)}/approve`, {
        method: 'POST',
        body,
        actorId: releaseActorId(body),
      }),
    acknowledgeReleaseTestAcceptance: (releaseId: string, body: AcknowledgeReleaseTestAcceptanceBody) =>
      request<ReleaseControlResponse>(`/releases/${encodeURIComponent(releaseId)}/test-acceptance/acknowledge`, {
        method: 'POST',
        body,
        actorId: releaseActorId(body),
      }),
    overrideApproveRelease: (releaseId: string, body: OverrideApproveReleaseBody) =>
      request<ReleaseControlResponse>(`/releases/${encodeURIComponent(releaseId)}/override-approve`, {
        method: 'POST',
        body,
        actorId: releaseActorId(body),
      }),
    requestReleaseChanges: (releaseId: string, body: RequestReleaseChangesBody) =>
      request<ReleaseControlResponse>(`/releases/${encodeURIComponent(releaseId)}/request-changes`, {
        method: 'POST',
        body,
        actorId: releaseActorId(body),
      }),
    createReleaseEvidence: (releaseId: string, body: CreateReleaseEvidenceBody) =>
      request<ReleaseControlResponse>(`/releases/${encodeURIComponent(releaseId)}/evidences`, {
        method: 'POST',
        body,
        actorId: releaseActorId(body),
      }),
    startReleaseObserving: (releaseId: string, body: StartReleaseObservingBody) =>
      request<ReleaseControlResponse>(`/releases/${encodeURIComponent(releaseId)}/start-observing`, {
        method: 'POST',
        body,
        actorId: releaseActorId(body),
      }),
    closeRelease: (releaseId: string, body: CloseReleaseBody) =>
      request<ReleaseControlResponse>(`/releases/${encodeURIComponent(releaseId)}/close`, {
        method: 'POST',
        body,
        actorId: releaseActorId(body),
      }),
    createWorkItem: async (body: CreateWorkItemBody) =>
      request<WorkItem>('/work-items', { method: 'POST', body: createWorkItemRequestSchema.parse(body) }),
    listWorkItems: (projectId?: string) =>
      request<WorkItem[]>(`/work-items${projectId ? `?${new URLSearchParams({ project_id: projectId }).toString()}` : ''}`),
    getWorkItem: (workItemId: string) => request<WorkItem>(`/work-items/${encodeURIComponent(workItemId)}`),
    updateRequirementNarrative: (requirementId: string, body: MarkdownDocument) =>
      request<RequirementDetail>(`/requirements/${encodeURIComponent(requirementId)}/narrative`, {
        method: 'PATCH',
        body,
      }),
    updateInitiativeNarrative: (initiativeId: string, body: MarkdownDocument) =>
      request<InitiativeDetail>(`/initiatives/${encodeURIComponent(initiativeId)}/narrative`, {
        method: 'PATCH',
        body,
      }),
    updateTechDebtNarrative: (techDebtId: string, body: MarkdownDocument) =>
      request<TechDebtDetail>(`/tech-debt/${encodeURIComponent(techDebtId)}/narrative`, {
        method: 'PATCH',
        body,
      }),
    updateBugNarrative: (bugId: string, body: MarkdownDocument) =>
      request<BugDetail>(`/bugs/${encodeURIComponent(bugId)}/narrative`, {
        method: 'PATCH',
        body,
      }),
    updateTaskNarrative: (taskId: string, body: MarkdownDocument) =>
      request<TaskDetail>(`/tasks/${encodeURIComponent(taskId)}/narrative`, {
        method: 'PATCH',
        body,
      }),
    getEvidenceChain: (workItemId: string, reviewPacketId?: string) =>
      request<EvidenceChainResponse>(
        `/work-items/${encodeURIComponent(workItemId)}/evidence-chain${
          reviewPacketId ? `?${new URLSearchParams({ review_packet_id: reviewPacketId }).toString()}` : ''
        }`,
      ),

    createSpec: (workItemId: string) => request<SpecPlan>(`/work-items/${encodeURIComponent(workItemId)}/specs`, { method: 'POST' }),
    getSpec: (specId: string) => request<SpecPlan>(`/specs/${encodeURIComponent(specId)}`),
    listSpecRevisions: (specId: string) => request<SpecRevision[]>(`/specs/${encodeURIComponent(specId)}/revisions`),
    getSpecRevision: (revisionId: string) => request<SpecRevision>(`/spec-revisions/${encodeURIComponent(revisionId)}`),
    createSpecRevision: (specId: string, body: CreateSpecRevisionBody) =>
      request<SpecRevision>(`/specs/${encodeURIComponent(specId)}/revisions`, { method: 'POST', body }),
    generateSpecDraft: (specId: string) => request<SpecRevision>(`/specs/${encodeURIComponent(specId)}/generate-draft`, { method: 'POST' }),
    submitSpecForApproval: (specId: string, body: SubmitForApprovalBody) =>
      request<SpecPlan>(`/specs/${encodeURIComponent(specId)}/submit-for-approval`, {
        method: 'POST',
        body,
        ...actorRequest(actorCommandActorId(body)),
      }),
    approveSpec: (specId: string, body: ApproveArtifactBody) =>
      request<SpecPlan>(`/specs/${encodeURIComponent(specId)}/approve`, {
        method: 'POST',
        body,
        ...actorRequest(actorCommandActorId(body)),
      }),
    requestSpecChanges: (specId: string, body: RequestArtifactChangesBody) =>
      request<SpecPlan>(`/specs/${encodeURIComponent(specId)}/request-changes`, {
        method: 'POST',
        body,
        ...actorRequest(actorCommandActorId(body)),
      }),

    createPlan: (workItemId: string) => request<SpecPlan>(`/work-items/${encodeURIComponent(workItemId)}/plans`, { method: 'POST' }),
    getPlan: (planId: string) => request<SpecPlan>(`/plans/${encodeURIComponent(planId)}`),
    listPlanRevisions: (planId: string) => request<PlanRevision[]>(`/plans/${encodeURIComponent(planId)}/revisions`),
    getPlanRevision: (revisionId: string) => request<PlanRevision>(`/plan-revisions/${encodeURIComponent(revisionId)}`),
    createPlanRevision: (planId: string, body: CreatePlanRevisionBody) =>
      request<PlanRevision>(`/plans/${encodeURIComponent(planId)}/revisions`, { method: 'POST', body }),
    generatePlanDraft: (planId: string) => request<PlanRevision>(`/plans/${encodeURIComponent(planId)}/generate-draft`, { method: 'POST' }),
    submitPlanForApproval: (planId: string, body: SubmitForApprovalBody) =>
      request<SpecPlan>(`/plans/${encodeURIComponent(planId)}/submit-for-approval`, {
        method: 'POST',
        body,
        ...actorRequest(actorCommandActorId(body)),
      }),
    approvePlan: (planId: string, body: ApproveArtifactBody) =>
      request<SpecPlan>(`/plans/${encodeURIComponent(planId)}/approve`, {
        method: 'POST',
        body,
        ...actorRequest(actorCommandActorId(body)),
      }),
    requestPlanChanges: (planId: string, body: RequestArtifactChangesBody) =>
      request<SpecPlan>(`/plans/${encodeURIComponent(planId)}/request-changes`, {
        method: 'POST',
        body,
        ...actorRequest(actorCommandActorId(body)),
      }),

    generatePackages: (planRevisionId: string) =>
      request<ExecutionPackage[]>(`/plan-revisions/${encodeURIComponent(planRevisionId)}/generate-packages`, { method: 'POST' }),
    createExecutionPackage: (planRevisionId: string, body: CreateExecutionPackageBody) =>
      request<ExecutionPackage>(`/plan-revisions/${encodeURIComponent(planRevisionId)}/execution-packages`, { method: 'POST', body }),
    listExecutionPackages: (workItemId: string) =>
      request<ExecutionPackage[]>(`/work-items/${encodeURIComponent(workItemId)}/execution-packages`),
    getExecutionPackage: (packageId: string) => request<ExecutionPackage>(`/execution-packages/${encodeURIComponent(packageId)}`),
    patchExecutionPackage: (packageId: string, body: PatchExecutionPackageBody) =>
      request<ExecutionPackage>(`/execution-packages/${encodeURIComponent(packageId)}`, { method: 'PATCH', body }),
    markPackageReady: (packageId: string, body: MarkPackageReadyBody) =>
      request<ExecutionPackage>(`/execution-packages/${encodeURIComponent(packageId)}/mark-ready`, {
        method: 'POST',
        body,
        ...actorRequest(actorCommandActorId(body)),
      }),
    runPackage: (packageId: string, actorId: string, body: RunPackageBody) =>
      request<Record<string, unknown>>(`/execution-packages/${encodeURIComponent(packageId)}/run`, {
        method: 'POST',
        body,
        actorId,
      }),
    rerunPackage: (packageId: string, actorId: string, body: RunPackageBody) =>
      request<Record<string, unknown>>(`/execution-packages/${encodeURIComponent(packageId)}/rerun`, {
        method: 'POST',
        body,
        actorId,
      }),
    forceRerunPackage: (packageId: string, actorId: string, body: RunPackageBody) =>
      request<Record<string, unknown>>(`/execution-packages/${encodeURIComponent(packageId)}/force-rerun`, {
        method: 'POST',
        body,
        actorId,
      }),

    getRunSession: (runSessionId: string) => request<RunSession>(`/run-sessions/${encodeURIComponent(runSessionId)}`),
    listRunEvents: async (runSessionId: string, options: { after?: string; actorId: string }) =>
      request<RunEventListResponse>(
        `/run-sessions/${encodeURIComponent(runSessionId)}/events${
          options.after === undefined ? '' : `?${runEventsQuery({ after: options.after })}`
        }`,
        { actorId: options.actorId },
      ),
    sendRunInput: async (runSessionId: string, actorId: string, message: string, targetTurnId?: string) =>
      request<RunOperatorCommandResponse>(`/run-sessions/${encodeURIComponent(runSessionId)}/input`, {
        method: 'POST',
        body: {
          message,
          ...(targetTurnId ? { target_turn_id: targetTurnId } : {}),
        },
        actorId,
      }),
    cancelRun: async (runSessionId: string, actorId: string, reason?: string) =>
      request<RunOperatorCommandResponse>(`/run-sessions/${encodeURIComponent(runSessionId)}/cancel`, {
        method: 'POST',
        body: {
          ...(reason ? { reason } : {}),
        },
        actorId,
      }),
    resumeRun: async (runSessionId: string, actorId: string, reason?: string) =>
      request<RunOperatorCommandResponse>(`/run-sessions/${encodeURIComponent(runSessionId)}/resume`, {
        method: 'POST',
        body: {
          ...(reason ? { reason } : {}),
        },
        actorId,
      }),
    createRunEventStreamToken: async (runSessionId: string, actorId: string) =>
      request<{ token: string; expires_at: string }>(`/run-sessions/${encodeURIComponent(runSessionId)}/events/stream-token`, {
        method: 'POST',
        actorId,
      }),
    openRunEventStream: async (
      runSessionId: string,
      options: { after?: string; actorId: string },
      handlers: RunEventStreamHandlers,
    ): Promise<RunEventStream> => {
      let token: string;
      try {
        token = requireRunEventStreamToken(
          await request<unknown>(`/run-sessions/${encodeURIComponent(runSessionId)}/events/stream-token`, {
            method: 'POST',
            actorId: options.actorId,
          }),
        );
      } catch (error) {
        const normalized = error instanceof Error ? error : new Error(String(error));
        handlers.onError(normalized);
        throw normalized;
      }
      const eventSource = new EventSource(
        `${baseUrl}/run-sessions/${encodeURIComponent(runSessionId)}/events/stream?${runEventsQuery({
          streamToken: token,
          ...(options.after === undefined ? {} : { after: options.after }),
        })}`,
      );
      eventSource.onmessage = (message) => {
        try {
          handlers.onEvent(JSON.parse(message.data) as RunEvent);
        } catch (error) {
          handlers.onError(error instanceof Event ? error : error instanceof Error ? error : new Error(String(error)));
        }
      };
      eventSource.onerror = (error) => {
        handlers.onError(error);
      };
      return eventSource;
    },
    getReviewPacket: (reviewPacketId: string) => request<ReviewPacket>(`/review-packets/${encodeURIComponent(reviewPacketId)}`),
    approveReviewPacket: (reviewPacketId: string, body: ReviewDecisionBody) =>
      request<Record<string, unknown>>(`/review-packets/${encodeURIComponent(reviewPacketId)}/approve`, {
        method: 'POST',
        body,
        actorId: reviewDecisionActorId(body),
      }),
    requestReviewChanges: (reviewPacketId: string, body: ReviewDecisionBody) =>
      request<Record<string, unknown>>(`/review-packets/${encodeURIComponent(reviewPacketId)}/request-changes`, {
        method: 'POST',
        body,
        actorId: reviewDecisionActorId(body),
      }),
  };
}

export type ForgeloopCommandApi = ReturnType<typeof createForgeloopCommandApi>;
