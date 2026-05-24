import { createApiContext, type ForgeloopApiOptions } from './common';
import { createWorkItemRequestSchema } from '@forgeloop/contracts';
import type {
  ActorCommandBody,
  AcknowledgeReleaseTestAcceptanceBody,
  ApproveArtifactBody,
  ApproveReleaseBody,
  BoundarySummary,
  BrainstormingSession,
  CodeReviewHandoff,
  CreateExecutionPackageBody,
  CreateReleaseBody,
  CreateReleaseEvidenceBody,
  CreateWorkItemBody,
  DevelopmentPlan,
  DevelopmentPlanItem,
  EvidenceChainResponse,
  Execution,
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
  ProductObjectRef,
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
  SourceObjectRef,
  TechDebtDetail,
  QaHandoff,
  UnlinkReleaseScopeBody,
  WorkItem,
  WorkItemIntakeContext,
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

type TypedWorkItemCreateBody<K extends CreateWorkItemBody['kind']> = Omit<CreateWorkItemBody, 'kind' | 'intake_context'> & {
  intake_context: Extract<WorkItemIntakeContext, { type: K }>;
};

export type CreateRequirementBody = TypedWorkItemCreateBody<'requirement'>;
export type CreateInitiativeBody = TypedWorkItemCreateBody<'initiative'>;
export type CreateTechDebtBody = TypedWorkItemCreateBody<'tech_debt'>;
export type CreateBugBody = TypedWorkItemCreateBody<'bug'>;

export interface CreateDevelopmentPlanBody extends ActorCommandBody {
  project_id: string;
  source_ref: SourceObjectRef;
  title: string;
}

export interface CreateDevelopmentPlanItemBody {
  title: string;
  summary: string;
  responsible_role: 'product' | 'tech_lead' | 'developer' | 'qa' | 'release_owner' | 'manager';
  driver_actor_id?: string;
  reviewer_actor_id?: string;
  risk: 'low' | 'medium' | 'high' | 'critical';
  dependency_hints?: string[];
  affected_surfaces?: string[];
  release_impact: 'none' | 'release_scoped' | 'release_blocking';
}

export interface GenerateDevelopmentPlanDraftBody extends ActorCommandBody {
  project_id: string;
  source_ref: SourceObjectRef;
  guidance?: string;
}

export interface LinkSourceObjectToDevelopmentPlanBody extends ActorCommandBody {
  rationale?: string;
}

export interface RegenerateArtifactDraftBody extends ActorCommandBody {
  feedback: string;
  preserve_prior_decisions?: boolean;
}

export type RegenerateDevelopmentPlanDraftBody = RegenerateArtifactDraftBody;

export interface StartBrainstormingSessionBody {
  actor_id: string;
}

export interface AnswerBrainstormingQuestionBody {
  question_id: string;
  text: string;
  actor_id: string;
}

export interface RecordBrainstormingDecisionBody {
  text: string;
  rationale?: string;
  actor_id: string;
}

export interface ApproveBoundaryBody {
  confirmed_scope?: string[];
  confirmed_out_of_scope?: string[];
  accepted_assumptions?: string[];
  open_risks?: string[];
  validation_expectations?: string[];
  actor_id: string;
  final_decision?: string;
}

export interface ReadyForCodeReviewBody extends ActorCommandBody {
  summary: string;
  changed_surfaces: string[];
  verification_evidence_refs: ProductObjectRef[];
}

export interface CodeReviewDecisionBody extends ActorCommandBody {
  rationale: string;
}

export interface CodeReviewAuditedExceptionBody extends ActorCommandBody {
  reason: string;
  risk: 'low' | 'medium' | 'high' | 'critical';
  rollback_plan: string;
}

export interface CreateQaHandoffBody extends ActorCommandBody {
  acceptance_criteria: string[];
  test_strategy: string;
  verification_evidence_refs?: ProductObjectRef[];
  known_risks?: string[];
}

export interface QaHandoffDecisionBody extends ActorCommandBody {
  rationale: string;
}

export interface AcceptQaHandoffBody extends QaHandoffDecisionBody {
  verification_evidence_refs: ProductObjectRef[];
}

export interface RevisionCompareQuery {
  base_revision_id: string;
  compare_revision_id: string;
}

export interface StructuredRevisionDiff {
  base_revision_id: string;
  compare_revision_id: string;
  changed_fields: string[];
  base_snapshot?: Record<string, unknown>;
  compare_snapshot?: Record<string, unknown>;
}

export interface ExecutionPlanDocument {
  id: string;
  development_plan_item_id: string;
  status: 'draft' | 'in_review' | 'approved' | 'changes_requested' | 'stale' | 'blocked';
  current_revision_id?: string;
  approved_revision_id?: string;
  approved_by_actor_id?: string;
  approved_at?: string;
  created_at?: string;
  updated_at?: string;
}

export interface ExecutionPlanRevision {
  id: string;
  execution_plan_id: string;
  development_plan_item_id: string;
  based_on_spec_revision_id: string;
  revision_number: number;
  summary: string;
  content: string;
  structured_document?: Record<string, unknown>;
  author_actor_id?: string;
  created_at?: string;
}

const itemSpecPath = (developmentPlanId: string, itemId: string, suffix: string) =>
  `/development-plans/${encodeURIComponent(developmentPlanId)}/items/${encodeURIComponent(itemId)}/spec/${suffix}`;

const itemExecutionPlanPath = (developmentPlanId: string, itemId: string, suffix: string) =>
  `/development-plans/${encodeURIComponent(developmentPlanId)}/items/${encodeURIComponent(itemId)}/execution-plan/${suffix}`;

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
    createRequirement: (body: CreateRequirementBody) =>
      request<WorkItem>('/work-items', {
        method: 'POST',
        body: createWorkItemRequestSchema.parse({ ...body, kind: 'requirement' }),
      }),
    createInitiative: (body: CreateInitiativeBody) =>
      request<WorkItem>('/work-items', {
        method: 'POST',
        body: createWorkItemRequestSchema.parse({ ...body, kind: 'initiative' }),
      }),
    createTechDebt: (body: CreateTechDebtBody) =>
      request<WorkItem>('/work-items', {
        method: 'POST',
        body: createWorkItemRequestSchema.parse({ ...body, kind: 'tech_debt' }),
      }),
    createBug: (body: CreateBugBody) =>
      request<WorkItem>('/work-items', {
        method: 'POST',
        body: createWorkItemRequestSchema.parse({ ...body, kind: 'bug' }),
      }),
    createDevelopmentPlan: (body: CreateDevelopmentPlanBody) =>
      request<DevelopmentPlan>('/development-plans', {
        method: 'POST',
        body,
        ...actorRequest(body.actor_id),
      }),
    createDevelopmentPlanItem: (developmentPlanId: string, body: CreateDevelopmentPlanItemBody) =>
      request<DevelopmentPlanItem>(`/development-plans/${encodeURIComponent(developmentPlanId)}/items`, {
        method: 'POST',
        body,
      }),
    generateDevelopmentPlanDraft: (body: GenerateDevelopmentPlanDraftBody) =>
      request<Record<string, unknown>>('/development-plans/generate-draft', {
        method: 'POST',
        body,
        ...actorRequest(body.actor_id),
      }),
    regenerateDevelopmentPlanDraft: (developmentPlanId: string, body: RegenerateDevelopmentPlanDraftBody) =>
      request<Record<string, unknown>>(`/development-plans/${encodeURIComponent(developmentPlanId)}/regenerate-draft`, {
        method: 'POST',
        body,
        ...actorRequest(body.actor_id),
      }),
    linkSourceObjectToDevelopmentPlan: (
      sourceType: SourceObjectRef['type'],
      sourceId: string,
      developmentPlanId: string,
      body: LinkSourceObjectToDevelopmentPlanBody,
    ) =>
      request<Record<string, unknown>>(
        `/source-objects/${encodeURIComponent(sourceType)}/${encodeURIComponent(sourceId)}/development-plans/${encodeURIComponent(developmentPlanId)}/link`,
        {
          method: 'POST',
          body,
          ...actorRequest(body.actor_id),
        },
      ),
    startBrainstormingSession: (developmentPlanId: string, itemId: string, body: StartBrainstormingSessionBody) =>
      request<BrainstormingSession>(
        `/development-plans/${encodeURIComponent(developmentPlanId)}/items/${encodeURIComponent(itemId)}/brainstorming-sessions`,
        {
          method: 'POST',
          body,
          ...actorRequest(body.actor_id),
        },
      ),
    answerBrainstormingQuestion: (sessionId: string, body: AnswerBrainstormingQuestionBody) =>
      request<Record<string, unknown>>(`/brainstorming-sessions/${encodeURIComponent(sessionId)}/answers`, {
        method: 'POST',
        body,
        ...actorRequest(body.actor_id),
      }),
    recordBrainstormingDecision: (sessionId: string, body: RecordBrainstormingDecisionBody) =>
      request<Record<string, unknown>>(`/brainstorming-sessions/${encodeURIComponent(sessionId)}/decisions`, {
        method: 'POST',
        body,
        ...actorRequest(body.actor_id),
      }),
    approveBoundary: (sessionId: string, body: ApproveBoundaryBody) =>
      request<{ session: BrainstormingSession; boundary_summary: BoundarySummary }>(
        `/brainstorming-sessions/${encodeURIComponent(sessionId)}/approve-boundary`,
        {
          method: 'POST',
          body,
          ...actorRequest(body.actor_id),
        },
      ),
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
    getEvidenceChain: (workItemId: string, reviewPacketId?: string) =>
      request<EvidenceChainResponse>(
        `/work-items/${encodeURIComponent(workItemId)}/evidence-chain${
          reviewPacketId ? `?${new URLSearchParams({ review_packet_id: reviewPacketId }).toString()}` : ''
        }`,
      ),

    generateItemSpecDraft: (developmentPlanId: string, itemId: string, body: ActorCommandBody = {}) =>
      request<SpecRevision>(itemSpecPath(developmentPlanId, itemId, 'generate-draft'), {
        method: 'POST',
        body,
        ...actorRequest(body.actor_id),
      }),
    submitItemSpecForApproval: (developmentPlanId: string, itemId: string, body: SubmitForApprovalBody) =>
      request<SpecPlan>(itemSpecPath(developmentPlanId, itemId, 'submit-for-approval'), {
        method: 'POST',
        body,
        ...actorRequest(actorCommandActorId(body)),
      }),
    approveItemSpec: (developmentPlanId: string, itemId: string, body: ApproveArtifactBody) =>
      request<SpecPlan>(itemSpecPath(developmentPlanId, itemId, 'approve'), {
        method: 'POST',
        body,
        ...actorRequest(actorCommandActorId(body)),
      }),
    requestItemSpecChanges: (developmentPlanId: string, itemId: string, body: RequestArtifactChangesBody) =>
      request<SpecPlan>(itemSpecPath(developmentPlanId, itemId, 'request-changes'), {
        method: 'POST',
        body,
        ...actorRequest(actorCommandActorId(body)),
      }),
    rejectItemSpec: (developmentPlanId: string, itemId: string, body: RequestArtifactChangesBody) =>
      request<SpecPlan>(itemSpecPath(developmentPlanId, itemId, 'reject'), {
        method: 'POST',
        body,
        ...actorRequest(actorCommandActorId(body)),
      }),
    regenerateItemSpecDraft: (developmentPlanId: string, itemId: string, body: RegenerateArtifactDraftBody) =>
      request<SpecRevision>(itemSpecPath(developmentPlanId, itemId, 'regenerate-draft'), {
        method: 'POST',
        body,
        ...actorRequest(actorCommandActorId(body)),
      }),
    compareItemSpecRevisions: (developmentPlanId: string, itemId: string, query: RevisionCompareQuery) =>
      request<StructuredRevisionDiff>(`${itemSpecPath(developmentPlanId, itemId, 'revisions/compare')}${queryString({ ...query })}`),

    generateItemExecutionPlanDraft: (developmentPlanId: string, itemId: string, body: ActorCommandBody = {}) =>
      request<ExecutionPlanRevision>(itemExecutionPlanPath(developmentPlanId, itemId, 'generate-draft'), {
        method: 'POST',
        body,
        ...actorRequest(body.actor_id),
      }),
    submitItemExecutionPlanForApproval: (developmentPlanId: string, itemId: string, body: SubmitForApprovalBody) =>
      request<ExecutionPlanDocument>(itemExecutionPlanPath(developmentPlanId, itemId, 'submit-for-approval'), {
        method: 'POST',
        body,
        ...actorRequest(actorCommandActorId(body)),
      }),
    approveItemExecutionPlan: (developmentPlanId: string, itemId: string, body: ApproveArtifactBody) =>
      request<ExecutionPlanDocument>(itemExecutionPlanPath(developmentPlanId, itemId, 'approve'), {
        method: 'POST',
        body,
        ...actorRequest(actorCommandActorId(body)),
      }),
    requestItemExecutionPlanChanges: (developmentPlanId: string, itemId: string, body: RequestArtifactChangesBody) =>
      request<ExecutionPlanDocument>(itemExecutionPlanPath(developmentPlanId, itemId, 'request-changes'), {
        method: 'POST',
        body,
        ...actorRequest(actorCommandActorId(body)),
      }),
    rejectItemExecutionPlan: (developmentPlanId: string, itemId: string, body: RequestArtifactChangesBody) =>
      request<ExecutionPlanDocument>(itemExecutionPlanPath(developmentPlanId, itemId, 'reject'), {
        method: 'POST',
        body,
        ...actorRequest(actorCommandActorId(body)),
      }),
    regenerateItemExecutionPlanDraft: (developmentPlanId: string, itemId: string, body: RegenerateArtifactDraftBody) =>
      request<ExecutionPlanRevision>(itemExecutionPlanPath(developmentPlanId, itemId, 'regenerate-draft'), {
        method: 'POST',
        body,
        ...actorRequest(actorCommandActorId(body)),
      }),
    compareItemExecutionPlanRevisions: (developmentPlanId: string, itemId: string, query: RevisionCompareQuery) =>
      request<StructuredRevisionDiff>(
        `${itemExecutionPlanPath(developmentPlanId, itemId, 'revisions/compare')}${queryString({ ...query })}`,
      ),

    startItemExecution: (developmentPlanId: string, itemId: string, body: ActorCommandBody) =>
      request<Execution>(
        `/development-plans/${encodeURIComponent(developmentPlanId)}/items/${encodeURIComponent(itemId)}/execution/start`,
        {
          method: 'POST',
          body,
          ...actorRequest(body.actor_id),
        },
      ),
    continueExecution: (executionId: string, body: ActorCommandBody) =>
      request<Execution>(`/executions/${encodeURIComponent(executionId)}/continue`, {
        method: 'POST',
        body,
        ...actorRequest(body.actor_id),
      }),
    interruptExecution: (executionId: string, body: ActorCommandBody) =>
      request<Execution>(`/executions/${encodeURIComponent(executionId)}/interrupt`, {
        method: 'POST',
        body,
        ...actorRequest(body.actor_id),
      }),
    markExecutionReadyForCodeReview: (executionId: string, body: ReadyForCodeReviewBody) =>
      request<CodeReviewHandoff>(`/executions/${encodeURIComponent(executionId)}/ready-for-code-review`, {
        method: 'POST',
        body,
        ...actorRequest(body.actor_id),
      }),
    approveCodeReviewHandoff: (handoffId: string, body: CodeReviewDecisionBody) =>
      request<CodeReviewHandoff>(`/code-review-handoffs/${encodeURIComponent(handoffId)}/approve`, {
        method: 'POST',
        body,
        ...actorRequest(body.actor_id),
      }),
    requestCodeReviewChanges: (handoffId: string, body: CodeReviewDecisionBody) =>
      request<CodeReviewHandoff>(`/code-review-handoffs/${encodeURIComponent(handoffId)}/request-changes`, {
        method: 'POST',
        body,
        ...actorRequest(body.actor_id),
      }),
    recordCodeReviewAuditedException: (handoffId: string, body: CodeReviewAuditedExceptionBody) =>
      request<CodeReviewHandoff>(`/code-review-handoffs/${encodeURIComponent(handoffId)}/audited-exception`, {
        method: 'POST',
        body,
        ...actorRequest(body.actor_id),
      }),
    createQaHandoff: (handoffId: string, body: CreateQaHandoffBody) =>
      request<QaHandoff>(`/code-review-handoffs/${encodeURIComponent(handoffId)}/qa-handoff`, {
        method: 'POST',
        body,
        ...actorRequest(body.actor_id),
      }),
    blockQaHandoff: (qaHandoffId: string, body: QaHandoffDecisionBody) =>
      request<QaHandoff>(`/qa-handoffs/${encodeURIComponent(qaHandoffId)}/block`, {
        method: 'POST',
        body,
        ...actorRequest(body.actor_id),
      }),
    acceptQaHandoff: (qaHandoffId: string, body: AcceptQaHandoffBody) =>
      request<QaHandoff>(`/qa-handoffs/${encodeURIComponent(qaHandoffId)}/accept`, {
        method: 'POST',
        body,
        ...actorRequest(body.actor_id),
      }),

    generatePackages: (planRevisionId: string) =>
      request<ExecutionPackage[]>(`/plan-revisions/${encodeURIComponent(planRevisionId)}/generate-packages`, { method: 'POST' }),
    createExecutionPackage: (planRevisionId: string, body: CreateExecutionPackageBody) =>
      request<ExecutionPackage>(`/plan-revisions/${encodeURIComponent(planRevisionId)}/execution-packages`, { method: 'POST', body }),
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
