import type { AutomationActorClass, AutomationScope } from '@forgeloop/domain';

import { signAutomationRequest } from './signing.js';
import type {
  AutomationActionResponse,
  AutomationActionRunRecord,
  BlockActionInput,
  ClaimNextActionInput,
  CompleteActionInput,
  FailActionInput,
  GatePendingActionInput,
  AutomationGenerationPackageContextV1,
  AutomationGenerationPlanContextV1,
  AutomationGenerationWorkItemContextV1,
  EnsurePlanDraftCommandInput,
  EnsurePackageDraftsCommandInput,
  EnsureSpecDraftCommandInput,
  NextAction,
  RequestManualPathCommandInput,
  RuntimeSnapshot,
  RuntimeSnapshotTarget,
} from './types.js';

type FetchResponseLike = {
  ok: boolean;
  status: number;
  statusText: string;
  json(): Promise<unknown>;
  text(): Promise<string>;
};

export type AutomationFetch = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
  },
) => Promise<FetchResponseLike>;

export interface AutomationHttpClientOptions {
  baseUrl: string;
  actorId: string;
  actorClass?: AutomationActorClass;
  daemonIdentity: string;
  secret: string | Buffer;
  fetch?: AutomationFetch;
  now?: () => string;
}

export class AutomationHttpError extends Error {
  readonly status: number;
  readonly body: unknown;
  readonly code: string | undefined;

  constructor(status: number, body: unknown, statusText = 'Automation HTTP request failed') {
    super(statusText);
    this.name = 'AutomationHttpError';
    this.status = status;
    this.body = body;
    this.code =
      typeof body === 'object' && body !== null && 'code' in body && typeof (body as { code?: unknown }).code === 'string'
        ? (body as { code: string }).code
        : undefined;
  }
}

const jsonBody = (body: unknown): string => JSON.stringify(body);

const parseJson = async (response: FetchResponseLike): Promise<unknown> => {
  try {
    return await response.json();
  } catch {
    const text = await response.text();
    return text.length === 0 ? null : text;
  }
};

const actionFromWire = (wire: Record<string, unknown>): AutomationActionRunRecord => ({
  id: String(wire.id),
  actionType: wire.action_type as AutomationActionRunRecord['actionType'],
  targetObjectType: String(wire.target_object_type),
  targetObjectId: String(wire.target_object_id),
  ...(typeof wire.target_revision_id === 'string' ? { targetRevisionId: wire.target_revision_id } : {}),
  ...(typeof wire.target_version === 'number' ? { targetVersion: wire.target_version } : {}),
  targetStatus: String(wire.target_status),
  idempotencyKey: String(wire.idempotency_key),
  automationScope: wire.automation_scope as AutomationScope,
  automationSettingsVersion: Number(wire.automation_settings_version),
  capabilityFingerprint: String(wire.capability_fingerprint),
  preconditionFingerprint: String(wire.precondition_fingerprint),
  actionInputJson:
    typeof wire.action_input_json === 'object' && wire.action_input_json !== null && !Array.isArray(wire.action_input_json)
      ? (wire.action_input_json as Record<string, unknown>)
      : {},
  status: wire.status as AutomationActionRunRecord['status'],
  attempt: Number(wire.attempt),
  ...(typeof wire.retryable === 'boolean' ? { retryable: wire.retryable } : {}),
  ...(typeof wire.next_attempt_at === 'string' ? { nextAttemptAt: wire.next_attempt_at } : {}),
  ...(typeof wire.reason === 'string' ? { reason: wire.reason } : {}),
  ...(typeof wire.error_code === 'string' ? { errorCode: wire.error_code } : {}),
  ...(typeof wire.claim_token === 'string' ? { claimToken: wire.claim_token } : {}),
  ...(typeof wire.locked_until === 'string' ? { lockedUntil: wire.locked_until } : {}),
});

const actionResponseFromWire = (wire: unknown): AutomationActionResponse => {
  const response = wire as { action?: unknown };
  if (typeof response !== 'object' || response === null || response.action === undefined || response.action === null) {
    return { action: null };
  }
  return { action: actionFromWire(response.action as Record<string, unknown>) };
};

const targetFromAction = (action: NextAction) => ({
  action_type: action.actionType,
  target_object_type: action.targetObjectType,
  target_object_id: action.targetObjectId,
  ...(action.targetRevisionId === undefined ? {} : { target_revision_id: action.targetRevisionId }),
  ...(action.targetVersion === undefined ? {} : { target_version: action.targetVersion }),
  target_status: action.targetStatus,
  idempotency_key: action.idempotencyKey,
  automation_scope: action.automationScope,
  automation_settings_version: action.automationSettingsVersion,
  capability_fingerprint: action.capabilityFingerprint,
  precondition_fingerprint: action.preconditionFingerprint,
  action_input_json: action.actionInputJson,
});

const blockersFromWire = (value: unknown): RuntimeSnapshotTarget['blockers'] => {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const blockers = value.map((entry) => {
    const row = entry as Record<string, unknown>;
    return {
      targetObjectType: String(row.target_object_type),
      targetObjectId: String(row.target_object_id),
      ...(typeof row.target_revision_id === 'string' ? { targetRevisionId: row.target_revision_id } : {}),
      ...(typeof row.repo_id === 'string' ? { repoId: row.repo_id } : {}),
      blockedReasonCode: String(row.blocked_reason_code),
      blockedSummary: String(row.blocked_summary),
      retryable: row.retryable === true,
      ...(typeof row.policy_digest === 'string' ? { policyDigest: row.policy_digest } : {}),
      ...(typeof row.policy_snapshot_version === 'number' ? { policySnapshotVersion: row.policy_snapshot_version } : {}),
      ...(typeof row.diagnostic_ref === 'string' ? { diagnosticRef: row.diagnostic_ref } : {}),
    };
  });
  return blockers.length === 0 ? undefined : blockers;
};

const runtimeSnapshotFromWire = (wire: unknown): RuntimeSnapshot => {
  const snapshot = wire as Record<string, unknown>;
  const repos = Array.isArray(snapshot.repos) ? snapshot.repos : [];
  const projects = Array.isArray(snapshot.projects) ? snapshot.projects : [];
  const targets = (value: unknown): RuntimeSnapshotTarget[] =>
    (Array.isArray(value) ? value : []).map((entry) => {
      const row = entry as Record<string, unknown>;
      const blockers = blockersFromWire(row.blockers);
      return {
        targetObjectType: String(row.target_object_type),
        targetObjectId: String(row.target_object_id),
        ...(typeof row.target_revision_id === 'string' ? { targetRevisionId: row.target_revision_id } : {}),
        ...(typeof row.target_version === 'number' ? { targetVersion: row.target_version } : {}),
        targetStatus: String(row.target_status),
        ...(typeof row.project_id === 'string' ? { projectId: row.project_id } : {}),
        ...(typeof row.repo_id === 'string' ? { repoId: row.repo_id } : {}),
        ...(Array.isArray(row.eligible_repo_ids)
          ? { eligibleRepoIds: row.eligible_repo_ids.filter((repoId): repoId is string => typeof repoId === 'string') }
          : {}),
        automationScope: row.automation_scope as AutomationScope,
        ...(typeof row.active_hold_fingerprint === 'string' ? { activeHoldFingerprint: row.active_hold_fingerprint } : {}),
        ...(typeof row.latest_matching_action_status === 'string' ? { latestMatchingActionStatus: row.latest_matching_action_status } : {}),
        ...(typeof row.blocked_reason_code === 'string' ? { blockedReasonCode: row.blocked_reason_code } : {}),
        ...(typeof row.blocked_summary === 'string' ? { blockedSummary: row.blocked_summary } : {}),
        ...(blockers === undefined ? {} : { blockers }),
        ...(typeof row.generation_key === 'string' ? { generationKey: row.generation_key } : {}),
        ...(row.disabled_reason === 'run_enqueue_disabled_by_scope'
          ? { disabledReason: 'run_enqueue_disabled_by_scope' as const }
          : {}),
      };
    });
  return {
    generatedAt: String(snapshot.generated_at),
    projects: projects.map((entry) => {
      const row = entry as Record<string, unknown>;
      return {
        projectId: String(row.project_id),
        automationScope: row.automation_scope as AutomationScope,
        automationSettingsVersion: Number(row.automation_settings_version),
        capabilityFingerprint: String(row.capability_fingerprint),
      };
    }),
    repos: repos.map((entry) => {
      const row = entry as Record<string, unknown>;
      const projection =
        typeof row.policy_projection === 'object' && row.policy_projection !== null
          ? (row.policy_projection as Record<string, unknown>)
          : undefined;
      return {
        projectId: String(row.project_id),
        repoId: String(row.repo_id),
        automationScope: row.automation_scope as AutomationScope,
        automationSettingsVersion: Number(row.automation_settings_version),
        capabilityFingerprint: String(row.capability_fingerprint),
        daemonInternalLocalPath: String(row.daemon_internal_local_path),
        ...(projection === undefined
          ? {}
          : {
              policyProjection: {
                automationScope: row.automation_scope as AutomationScope,
                repoId: String(projection.repo_id),
                policyStatus: projection.policy_status as NonNullable<RuntimeSnapshot['repos'][number]['policyProjection']>['policyStatus'],
                ...(typeof projection.policy_digest === 'string' ? { policyDigest: projection.policy_digest } : {}),
                parserVersion: String(projection.parser_version),
                ...(typeof projection.reason_code === 'string' ? { reasonCode: projection.reason_code } : {}),
                ...(typeof projection.observed_at === 'string' ? { observedAt: projection.observed_at } : {}),
              },
            }),
      };
    }),
    workItemsRequiringSpec: targets(snapshot.work_items_requiring_spec),
    workItemsRequiringPlan: targets(snapshot.work_items_requiring_plan),
    planRevisionsRequiringPackages: targets(snapshot.plan_revisions_requiring_packages),
    runEnqueueDisabledPackages: targets(snapshot.run_enqueue_disabled_packages),
    activeHolds: [],
    recentActionRuns: (Array.isArray(snapshot.recent_action_runs) ? snapshot.recent_action_runs : []).map((entry) => {
      const action = actionFromWire({ ...(entry as Record<string, unknown>), action_input_json: {}, target_status: '' });
      return {
        id: action.id,
        actionType: action.actionType,
        targetObjectType: action.targetObjectType,
        targetObjectId: action.targetObjectId,
        ...(action.targetRevisionId === undefined ? {} : { targetRevisionId: action.targetRevisionId }),
        ...(action.targetVersion === undefined ? {} : { targetVersion: action.targetVersion }),
        status: action.status,
        idempotencyKey: action.idempotencyKey,
        automationScope: action.automationScope,
        automationSettingsVersion: action.automationSettingsVersion,
        capabilityFingerprint: action.capabilityFingerprint,
        preconditionFingerprint: action.preconditionFingerprint,
      };
    }),
    runEnqueueDisabledReason: String(snapshot.run_enqueue_disabled_reason),
  };
};

export class AutomationHttpClient {
  private readonly baseUrl: URL;
  private readonly fetchImpl: AutomationFetch;
  private readonly actorId: string;
  private readonly actorClass: AutomationActorClass;
  private readonly daemonIdentity: string;
  private readonly secret: string | Buffer;
  private readonly now: () => string;

  constructor(options: AutomationHttpClientOptions) {
    this.baseUrl = new URL(options.baseUrl.endsWith('/') ? options.baseUrl : `${options.baseUrl}/`);
    this.fetchImpl = options.fetch ?? (globalThis.fetch as unknown as AutomationFetch);
    this.actorId = options.actorId;
    this.actorClass = options.actorClass ?? 'automation_daemon';
    this.daemonIdentity = options.daemonIdentity;
    this.secret = options.secret;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  async runtimeSnapshot(): Promise<RuntimeSnapshot> {
    return runtimeSnapshotFromWire(await this.request('GET', '/internal/automation/runtime-snapshot'));
  }

  async createOrReplayAction(action: NextAction): Promise<AutomationActionResponse> {
    return actionResponseFromWire(await this.request('POST', '/internal/automation/actions', targetFromAction(action)));
  }

  async claimNextAction(input: ClaimNextActionInput): Promise<AutomationActionResponse> {
    return actionResponseFromWire(
      await this.request('POST', '/internal/automation/actions:claim-next', {
        claim_token: input.claimToken,
        ...(input.leaseMs === undefined ? {} : { lease_ms: input.leaseMs }),
        limit: input.limit ?? 1,
        ...(input.actionType === undefined ? {} : { action_type: input.actionType }),
        ...(input.projectId === undefined ? {} : { project_id: input.projectId }),
        ...(input.repoId === undefined ? {} : { repo_id: input.repoId }),
        ...(input.automationScope === undefined ? {} : { automation_scope: input.automationScope }),
      }),
    );
  }

  async completeAction(actionRunId: string, input: CompleteActionInput): Promise<AutomationActionResponse> {
    return actionResponseFromWire(await this.request('POST', `/internal/automation/actions/${actionRunId}/complete`, input));
  }

  async gatePendingAction(actionRunId: string, input: GatePendingActionInput): Promise<AutomationActionResponse> {
    return actionResponseFromWire(await this.request('POST', `/internal/automation/actions/${actionRunId}/gate-pending`, input));
  }

  async blockAction(actionRunId: string, input: BlockActionInput): Promise<AutomationActionResponse> {
    return actionResponseFromWire(await this.request('POST', `/internal/automation/actions/${actionRunId}/block`, input));
  }

  async failAction(actionRunId: string, input: FailActionInput): Promise<AutomationActionResponse> {
    return actionResponseFromWire(await this.request('POST', `/internal/automation/actions/${actionRunId}/fail`, input));
  }

  async specDraftGenerationContext(workItemId: string, input: { actionRunId: string; claimToken: string }) {
    const query = new URLSearchParams({
      action_run_id: input.actionRunId,
      claim_token: input.claimToken,
    });
    return this.request(
      'GET',
      `/internal/automation/generation-context/work-items/${workItemId}/spec-draft?${query.toString()}`,
    ) as Promise<AutomationGenerationWorkItemContextV1>;
  }

  async planDraftGenerationContext(
    workItemId: string,
    input: { specRevisionId: string; actionRunId: string; claimToken: string },
  ): Promise<AutomationGenerationPlanContextV1> {
    const query = new URLSearchParams({
      spec_revision_id: input.specRevisionId,
      action_run_id: input.actionRunId,
      claim_token: input.claimToken,
    });
    return this.request(
      'GET',
      `/internal/automation/generation-context/work-items/${workItemId}/plan-draft?${query.toString()}`,
    ) as Promise<AutomationGenerationPlanContextV1>;
  }

  async packageDraftsGenerationContext(
    planRevisionId: string,
    input: { generationKey: string; actionRunId: string; claimToken: string },
  ): Promise<AutomationGenerationPackageContextV1> {
    const query = new URLSearchParams({
      generation_key: input.generationKey,
      action_run_id: input.actionRunId,
      claim_token: input.claimToken,
    });
    return this.request(
      'GET',
      `/internal/automation/generation-context/plan-revisions/${planRevisionId}/package-drafts?${query.toString()}`,
    ) as Promise<AutomationGenerationPackageContextV1>;
  }

  async ensureSpecDraft(workItemId: string, input: EnsureSpecDraftCommandInput) {
    return this.request('POST', `/internal/automation/work-items/${workItemId}/ensure-spec-draft`, input);
  }

  async ensurePlanDraft(workItemId: string, input: EnsurePlanDraftCommandInput) {
    return this.request('POST', `/internal/automation/work-items/${workItemId}/ensure-plan-draft`, input);
  }

  async ensurePackageDrafts(planRevisionId: string, input: EnsurePackageDraftsCommandInput) {
    return this.request('POST', `/internal/automation/plan-revisions/${planRevisionId}/ensure-package-drafts`, input);
  }

  async requestManualPathHold(input: RequestManualPathCommandInput) {
    return this.request('POST', '/internal/automation/manual-path-holds', input);
  }

  private async request(method: string, pathAndQuery: string, body?: unknown): Promise<unknown> {
    const rawBody = body === undefined ? '' : jsonBody(body);
    const url = new URL(pathAndQuery.replace(/^\//, ''), this.baseUrl);
    const headers = {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      Accept: 'application/json',
      ...signAutomationRequest({
        method,
        pathAndQuery,
        rawBody,
        actorId: this.actorId,
        actorClass: this.actorClass,
        daemonIdentity: this.daemonIdentity,
        timestamp: this.now(),
        secret: this.secret,
      }),
    };
    const response = await this.fetchImpl(url.toString(), {
      method,
      headers,
      ...(body === undefined ? {} : { body: rawBody }),
    });
    const parsed = await parseJson(response);
    if (!response.ok) {
      throw new AutomationHttpError(response.status, parsed, response.statusText);
    }
    return parsed;
  }
}
