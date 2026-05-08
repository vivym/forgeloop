import type {
  EvidenceChainItem,
  EvidenceChainObjectRef,
  EvidenceChainRedactionReason,
  EvidenceChainResponse,
  EvidenceChainRiskFlag,
} from '@forgeloop/contracts';

export type {
  EvidenceChainItem,
  EvidenceChainObjectRef,
  EvidenceChainRedactionReason,
  EvidenceChainResponse,
  EvidenceChainRiskFlag,
} from '@forgeloop/contracts';

export type WorkItemKind = 'feature' | 'bugfix' | 'tech_debt' | 'test_refactor';
export type ArtifactKind =
  | 'diff'
  | 'changed_files'
  | 'check_output'
  | 'logs'
  | 'execution_summary'
  | 'self_review'
  | 'review_packet'
  | 'raw_metadata';
export type ExecutorType = 'mock' | 'local_codex';
export type ReviewSeverity = 'minor' | 'major' | 'critical';

export interface WorkItem {
  id: string;
  project_id: string;
  kind: WorkItemKind;
  title: string;
  goal: string;
  success_criteria: string[];
  priority: string;
  risk: string;
  owner_actor_id: string;
  phase: string;
  activity_state: string;
  gate_state: string;
  resolution: string;
  current_spec_id?: string;
  current_plan_id?: string;
  created_at?: string;
  updated_at?: string;
}

export interface SpecPlan {
  id: string;
  work_item_id: string;
  entity_type: 'spec' | 'plan';
  status: string;
  editing_state: string;
  gate_state: string;
  resolution: string;
  current_revision_id?: string;
  created_at?: string;
  updated_at?: string;
}

export interface SpecRevision {
  id: string;
  spec_id: string;
  work_item_id: string;
  revision_number: number;
  summary: string;
  content: string;
  background: string;
  goals: string[];
  scope_in: string[];
  scope_out: string[];
  acceptance_criteria: string[];
  risk_notes?: string[];
  test_strategy_summary: string;
  created_at?: string;
}

export interface PlanRevision {
  id: string;
  plan_id: string;
  work_item_id: string;
  revision_number: number;
  summary: string;
  content: string;
  implementation_summary: string;
  split_strategy: string;
  dependency_order?: string[];
  test_matrix: string[];
  risk_mitigations?: string[];
  rollback_notes: string;
  created_at?: string;
}

export interface RequiredCheck {
  check_id: string;
  display_name: string;
  command: string;
  timeout_seconds: number;
  blocks_review: boolean;
}

export interface ExecutionPackage {
  id: string;
  work_item_id: string;
  spec_id?: string;
  spec_revision_id?: string;
  plan_id?: string;
  plan_revision_id?: string;
  project_id?: string;
  repo_id: string;
  objective: string;
  owner_actor_id: string;
  reviewer_actor_id: string;
  qa_owner_actor_id: string;
  phase: string;
  activity_state: string;
  gate_state: string;
  resolution: string;
  required_checks: RequiredCheck[];
  required_artifact_kinds: ArtifactKind[];
  allowed_paths: string[];
  forbidden_paths: string[];
  last_run_session_id?: string;
  last_failure_summary?: string;
  blocked_reason?: string;
  created_at?: string;
  updated_at?: string;
}

export interface ArtifactRef {
  kind?: string;
  name?: string;
  content_type?: string;
  storage_uri?: string;
  local_ref?: string;
  digest?: string;
}

export interface ChangedFile {
  repo_id?: string;
  path: string;
  change_kind: string;
  previous_path?: string;
}

export interface CheckResult {
  check_id: string;
  command?: string;
  status: string;
  exit_code?: number | null;
  duration_seconds?: number;
  blocks_review?: boolean;
  stdout?: ArtifactRef;
  stderr?: ArtifactRef;
}

export interface RunSession {
  id: string;
  execution_package_id: string;
  requested_by_actor_id: string;
  status: string;
  executor_type?: ExecutorType;
  changed_files?: ChangedFile[];
  check_results?: CheckResult[];
  artifacts?: ArtifactRef[];
  log_refs?: ArtifactRef[];
  runtime_metadata?: {
    durability_mode?: 'durable' | 'volatile_demo';
    driver_kind?: 'app_server' | 'exec_fallback' | 'fake';
    driver_status?: 'not_started' | 'starting' | 'active' | 'waiting_for_input' | 'stalled' | 'terminal';
    codex_thread_id?: string;
    active_turn_id?: string;
    workspace_path?: string;
    app_server_endpoint?: string;
    worker_id?: string;
    worker_lease_status?: 'active' | 'released' | 'expired';
    worker_lease_heartbeat_at?: string;
    worker_lease_expires_at?: string;
    last_event_cursor?: string;
    last_event_at?: string;
    recovery_attempt_count?: number;
    effective_dangerous_mode?: 'confirmed' | 'unconfirmed' | 'not_requested';
  };
  summary?: string;
  failure_kind?: string;
  failure_reason?: string;
  created_at?: string;
  updated_at?: string;
  started_at?: string;
  finished_at?: string;
}

export interface RunEvent {
  id: string;
  run_session_id?: string;
  sequence: number;
  cursor?: string;
  event_type?: string;
  source?: string;
  visibility?: 'public';
  summary?: string;
  payload?: Record<string, unknown>;
  created_at?: string;
}

export interface RunEventListResponse {
  events: RunEvent[];
  next_cursor?: string;
  has_more?: boolean;
}

export interface RunOperatorCommandResponse {
  status?: string;
  command_id?: string;
  run_session_id?: string;
  command_type?: 'input' | 'cancel' | 'resume';
}

export interface RequestedChange {
  title: string;
  description: string;
  file_path?: string;
  severity?: ReviewSeverity;
  suggested_validation?: string;
}

export interface ReviewPacket {
  id: string;
  run_session_id: string;
  execution_package_id: string;
  reviewer_actor_id: string;
  status: string;
  decision: string;
  summary?: string;
  changed_files?: ChangedFile[];
  check_result_summary?: string;
  self_review?: {
    status?: string;
    summary?: string;
    spec_plan_alignment?: string;
    test_assessment?: string;
    risk_notes?: string[];
    follow_up_questions?: string[];
    failure_message?: string;
  };
  risk_notes?: string[];
  requested_changes?: RequestedChange[];
  reviewed_by_actor_id?: string;
  reviewed_at?: string;
  created_at?: string;
  updated_at?: string;
}

export interface TimelineEntry {
  id: string;
  source: string;
  object_type: string;
  object_id: string;
  summary: string;
  created_at: string;
  payload?: Record<string, unknown>;
}

export interface CockpitResponse {
  work_item?: WorkItem;
  current_spec?: SpecPlan | null;
  current_plan?: SpecPlan | null;
  packages?: ExecutionPackage[];
  run_sessions?: RunSession[];
  review_packets?: ReviewPacket[];
  next_actions?: string[];
  completion_state?: Record<string, unknown>;
}

export interface CreateWorkItemBody {
  project_id: string;
  kind: WorkItemKind;
  title: string;
  goal: string;
  success_criteria: string[];
  priority: string;
  risk: string;
  owner_actor_id: string;
}

export interface CreateSpecRevisionBody {
  summary: string;
  content: string;
  background: string;
  goals: string[];
  scope_in: string[];
  scope_out: string[];
  acceptance_criteria: string[];
  risk_notes?: string[];
  test_strategy_summary: string;
  structured_document?: Record<string, unknown>;
  author_actor_id?: string;
}

export interface CreatePlanRevisionBody {
  summary: string;
  content: string;
  implementation_summary: string;
  split_strategy: string;
  dependency_order?: string[];
  test_matrix: string[];
  risk_mitigations?: string[];
  rollback_notes: string;
  structured_document?: Record<string, unknown>;
  author_actor_id?: string;
}

export interface CreateExecutionPackageBody {
  repo_id: string;
  objective: string;
  owner_actor_id: string;
  reviewer_actor_id: string;
  qa_owner_actor_id: string;
  required_checks: RequiredCheck[];
  required_artifact_kinds: ArtifactKind[];
  allowed_paths: string[];
  forbidden_paths: string[];
}

export type PatchExecutionPackageBody = Partial<Omit<CreateExecutionPackageBody, 'repo_id'>>;

export interface ActorCommandBody {
  actor_id?: string;
}

export interface RunPackageBody {
  execution_package_id?: string;
  requested_by_actor_id: string;
  executor_type?: ExecutorType;
  workflow_only?: boolean;
  previous_run_session_id?: string;
  force?: true;
  force_reason?: string;
}

export interface ReviewDecisionBody {
  summary: string;
  reviewed_by_actor_id: string;
  reviewed_at: string;
  requested_changes?: RequestedChange[];
}

export interface RunEventStreamHandlers {
  onEvent: (event: RunEvent) => void;
  onError: (error: Event | Error) => void;
}

export interface RunEventStream {
  close: () => void;
}

type FetchLike = typeof fetch;

export class ForgeloopApiError extends Error {
  readonly status: number;
  readonly details?: unknown;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = 'ForgeloopApiError';
    this.status = status;
    this.details = details;
  }
}

export interface ForgeloopApiOptions {
  baseUrl?: string;
  fetch?: FetchLike;
}

const defaultBaseUrl = () => import.meta.env.VITE_FORGELOOP_API_URL || 'http://localhost:3000';

const normalizeBaseUrl = (baseUrl: string) => baseUrl.replace(/\/+$/, '');

const requiredActorId = (actorId: string) => {
  const trimmed = actorId.trim();
  if (!trimmed) throw new Error('actorId is required');
  return trimmed;
};

const actorHeader = (actorId?: string) =>
  actorId === undefined ? {} : { 'X-Forgeloop-Actor-Id': requiredActorId(actorId) };

const runEventsQuery = (options: { after?: string; streamToken?: string }) => {
  const params = new URLSearchParams();
  if (options.streamToken) params.set('stream_token', options.streamToken);
  if (options.after) params.set('after', options.after);
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

export function createForgeloopApi(options: ForgeloopApiOptions = {}) {
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? defaultBaseUrl());
  const fetchImpl = options.fetch ?? fetch;

  async function request<T>(path: string, init: { method?: string; body?: unknown; actorId?: string } = {}): Promise<T> {
    const headers = { 'content-type': 'application/json', ...actorHeader(init.actorId) };
    const response = await fetchImpl(`${baseUrl}${path}`, {
      method: init.method ?? 'GET',
      headers,
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
    const text = await response.text();
    const payload = text ? parseJson(text) : undefined;

    if (!response.ok) {
      const message =
        typeof payload === 'object' && payload !== null && 'message' in payload && typeof payload.message === 'string'
          ? payload.message
          : `Forgeloop API request failed with ${response.status}`;
      throw new ForgeloopApiError(message, response.status, payload);
    }

    return payload as T;
  }

  return {
    createWorkItem: (body: CreateWorkItemBody) => request<WorkItem>('/work-items', { method: 'POST', body }),
    listWorkItems: (projectId?: string) =>
      request<WorkItem[]>(`/work-items${projectId ? `?${new URLSearchParams({ project_id: projectId }).toString()}` : ''}`),
    getWorkItem: (workItemId: string) => request<WorkItem>(`/work-items/${encodeURIComponent(workItemId)}`),
    getCockpit: (workItemId: string) => request<CockpitResponse>(`/work-items/${encodeURIComponent(workItemId)}/cockpit`),
    getTimeline: (workItemId: string) => request<TimelineEntry[]>(`/work-items/${encodeURIComponent(workItemId)}/timeline`),
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
        `/run-sessions/${encodeURIComponent(runSessionId)}/events${options.after ? `?${runEventsQuery({ after: options.after })}` : ''}`,
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

export type ForgeloopApi = ReturnType<typeof createForgeloopApi>;

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export const api = createForgeloopApi();
