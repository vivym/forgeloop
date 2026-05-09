import { createApiContext, type ForgeloopApiOptions } from './common';
import type {
  ActorCommandBody,
  CreateExecutionPackageBody,
  CreatePlanRevisionBody,
  CreateSpecRevisionBody,
  CreateWorkItemBody,
  EvidenceChainResponse,
  ExecutionPackage,
  PatchExecutionPackageBody,
  PlanRevision,
  ReviewDecisionBody,
  ReviewPacket,
  RunEvent,
  RunEventListResponse,
  RunEventStream,
  RunEventStreamHandlers,
  RunOperatorCommandResponse,
  RunPackageBody,
  RunSession,
  SpecPlan,
  SpecRevision,
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

export function createForgeloopCommandApi(options: ForgeloopApiOptions = {}) {
  const { baseUrl, request } = createApiContext(options);

  return {
    createWorkItem: (body: CreateWorkItemBody) => request<WorkItem>('/work-items', { method: 'POST', body }),
    listWorkItems: (projectId?: string) =>
      request<WorkItem[]>(`/work-items${projectId ? `?${new URLSearchParams({ project_id: projectId }).toString()}` : ''}`),
    getWorkItem: (workItemId: string) => request<WorkItem>(`/work-items/${encodeURIComponent(workItemId)}`),
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
    submitSpecForApproval: (specId: string, body: ActorCommandBody) =>
      request<SpecPlan>(`/specs/${encodeURIComponent(specId)}/submit-for-approval`, { method: 'POST', body }),
    approveSpec: (specId: string, body: ActorCommandBody) =>
      request<SpecPlan>(`/specs/${encodeURIComponent(specId)}/approve`, { method: 'POST', body }),
    requestSpecChanges: (specId: string, body: ActorCommandBody) =>
      request<SpecPlan>(`/specs/${encodeURIComponent(specId)}/request-changes`, { method: 'POST', body }),

    createPlan: (workItemId: string) => request<SpecPlan>(`/work-items/${encodeURIComponent(workItemId)}/plans`, { method: 'POST' }),
    getPlan: (planId: string) => request<SpecPlan>(`/plans/${encodeURIComponent(planId)}`),
    listPlanRevisions: (planId: string) => request<PlanRevision[]>(`/plans/${encodeURIComponent(planId)}/revisions`),
    getPlanRevision: (revisionId: string) => request<PlanRevision>(`/plan-revisions/${encodeURIComponent(revisionId)}`),
    createPlanRevision: (planId: string, body: CreatePlanRevisionBody) =>
      request<PlanRevision>(`/plans/${encodeURIComponent(planId)}/revisions`, { method: 'POST', body }),
    generatePlanDraft: (planId: string) => request<PlanRevision>(`/plans/${encodeURIComponent(planId)}/generate-draft`, { method: 'POST' }),
    submitPlanForApproval: (planId: string, body: ActorCommandBody) =>
      request<SpecPlan>(`/plans/${encodeURIComponent(planId)}/submit-for-approval`, { method: 'POST', body }),
    approvePlan: (planId: string, body: ActorCommandBody) =>
      request<SpecPlan>(`/plans/${encodeURIComponent(planId)}/approve`, { method: 'POST', body }),
    requestPlanChanges: (planId: string, body: ActorCommandBody) =>
      request<SpecPlan>(`/plans/${encodeURIComponent(planId)}/request-changes`, { method: 'POST', body }),

    generatePackages: (planRevisionId: string) =>
      request<ExecutionPackage[]>(`/plan-revisions/${encodeURIComponent(planRevisionId)}/generate-packages`, { method: 'POST' }),
    createExecutionPackage: (planRevisionId: string, body: CreateExecutionPackageBody) =>
      request<ExecutionPackage>(`/plan-revisions/${encodeURIComponent(planRevisionId)}/execution-packages`, { method: 'POST', body }),
    listExecutionPackages: (workItemId: string) =>
      request<ExecutionPackage[]>(`/work-items/${encodeURIComponent(workItemId)}/execution-packages`),
    getExecutionPackage: (packageId: string) => request<ExecutionPackage>(`/execution-packages/${encodeURIComponent(packageId)}`),
    patchExecutionPackage: (packageId: string, body: PatchExecutionPackageBody) =>
      request<ExecutionPackage>(`/execution-packages/${encodeURIComponent(packageId)}`, { method: 'PATCH', body }),
    markPackageReady: (packageId: string, body: ActorCommandBody) =>
      request<ExecutionPackage>(`/execution-packages/${encodeURIComponent(packageId)}/mark-ready`, { method: 'POST', body }),
    runPackage: (packageId: string, body: RunPackageBody) =>
      request<Record<string, unknown>>(`/execution-packages/${encodeURIComponent(packageId)}/run`, {
        method: 'POST',
        body,
        actorId: body.requested_by_actor_id,
      }),
    rerunPackage: (packageId: string, body: RunPackageBody) =>
      request<Record<string, unknown>>(`/execution-packages/${encodeURIComponent(packageId)}/rerun`, {
        method: 'POST',
        body,
        actorId: body.requested_by_actor_id,
      }),
    forceRerunPackage: (packageId: string, body: RunPackageBody) =>
      request<Record<string, unknown>>(`/execution-packages/${encodeURIComponent(packageId)}/force-rerun`, {
        method: 'POST',
        body,
        actorId: body.requested_by_actor_id,
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
      request<Record<string, unknown>>(`/review-packets/${encodeURIComponent(reviewPacketId)}/approve`, { method: 'POST', body }),
    requestReviewChanges: (reviewPacketId: string, body: ReviewDecisionBody) =>
      request<Record<string, unknown>>(`/review-packets/${encodeURIComponent(reviewPacketId)}/request-changes`, { method: 'POST', body }),
  };
}

export type ForgeloopCommandApi = ReturnType<typeof createForgeloopCommandApi>;
