import { Buffer } from 'node:buffer';
import { createHash, randomUUID } from 'node:crypto';

import { and, asc, desc, eq, getTableColumns, gt, inArray, isNotNull, isNull, notInArray, or, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { AnyPgColumn, AnyPgTable } from 'drizzle-orm/pg-core';
import type {
  AutomationActionRun,
  AutomationProjectSettings,
  Attachment,
  Artifact,
  Actor,
  BoundarySummary,
  BoundarySummaryRevision,
  BrainstormingSession,
  CodexCredentialBinding,
  CodexCredentialBindingPublic,
  CodexCredentialBindingVersion,
  CodexLaunchTokenEnvelope,
  CodexLaunchLease,
  CodexLaunchMaterialization,
  CodexSession,
  CodexSessionLease,
  CodexSessionSnapshot,
  CodexSessionStaleTerminalizationAttempt,
  CodexSessionTurn,
  CodexRuntimeJob,
  CodexRuntimeJobArtifact,
  CodexRuntimeProfile,
  CodexRuntimeProfileRevision,
  CodexRuntimeScope,
  CodexRuntimeStatusProjection,
  CodexRuntimeTargetKind,
  CodexPublicBlockerCode,
  CodexWorkerBootstrapToken,
  CodexWorkerRegistration,
  InternalArtifactObject,
  CommandIdempotencyRecord,
  ContextManifest,
  CodeReviewHandoff,
  Decision,
  DomainError as DomainErrorType,
  DevelopmentPlan,
  DevelopmentPlanItem,
  DevelopmentPlanItemRevision,
  DevelopmentPlanRevision,
  DevelopmentPlanSourceLink,
  Execution,
  ExecutionPlanDocument,
  ExecutionPlanRevision,
  ExecutionPackageGenerationRun,
  ExecutionPackage,
  ExecutionPackageDependency,
  ExecutionReadinessRecord,
  ManualPathHold,
  ObjectEvent,
  Organization,
  Plan,
  PlanRevision,
  PlanItemWorkflow,
  PlanItemWorkflowTransition,
  Project,
  ProjectRepo,
  Release,
  ReleaseEvidence,
  ReleaseExecutionPackage,
  ReleaseWorkItem,
  QaHandoff,
  ReviewPacket,
  RunCommand,
  RunEvent,
  RunSession,
  RunWorkerLease,
  Spec,
  SpecRevision,
  StatusHistory,
  RevisionCompareQuery,
  StructuredRevisionDiff,
  Task,
  WorkItem,
  WorkflowManualDecision,
  ResolvedCodexCredential,
} from '@forgeloop/domain';
import type { ObjectRef } from '@forgeloop/contracts';
import {
  planItemWorkflowTransitionSchema,
  workflowManualDecisionSchema,
  workflowTransitionEvidenceObjectTypeSchema,
} from '@forgeloop/contracts';
import {
  DomainError,
  assertPlanItemWorkflowTransitionAllowed,
  assertWorkflowManualDecisionAllowedForTransition,
  assertCodexRuntimeRecoveryReasonCode,
  assertAutomationCapabilityActor,
  assertCanonicalManualScopeKey,
  automationCapabilitiesForPreset,
  capabilityFingerprint,
  codexCanonicalDigest,
  codexCredentialPayloadDigest,
  codexLaunchTokenEnvelopeDigest,
  codexRuntimeNetworkPolicyDigest,
  codexRuntimeScopeMatches,
  codexWorkerScopeMatchesTarget,
  codexWorkspaceAcquisitionDigest,
  collectCodexRuntimeJobTerminalArtifactRefs,
  normalizeCodexRuntimeNetworkPolicy,
  validateCodexLaunchTargetKind,
  validateCodexRuntimeJobArtifactIntake,
  validateCodexRuntimeJobTerminalResult,
  validateCodexRuntimeProfileRevision,
  validateCodexSessionRuntimeContext,
  isActiveRunSessionStatus,
  isWorkItemAutomationTerminal,
  normalizeAutomationCapabilities,
  parseInternalArtifactRef,
} from '@forgeloop/domain';

import * as schema from '../schema';
import {
  artifacts,
  attachments,
  automation_action_runs,
  automation_project_settings,
  codex_credential_bindings,
  codex_credential_binding_versions,
  codex_launch_leases,
  codex_launch_token_envelopes,
  internal_artifact_objects,
  codex_pending_workspace_bundles,
  codex_runtime_job_artifacts,
  codex_runtime_jobs,
  codex_runtime_setup_nonces,
  codex_runtime_profiles,
  codex_runtime_profile_revisions,
  codex_session_leases,
  codex_session_snapshots,
  codex_session_stale_terminalization_attempts,
  codex_session_turns,
  codex_sessions,
  codex_worker_bootstrap_tokens,
  codex_worker_registrations,
  codex_worker_session_nonces,
  code_review_handoffs,
  command_idempotency_records,
  actors,
  boundary_answers,
  boundary_decisions,
  boundary_questions,
  boundary_rounds,
  boundary_summaries,
  boundary_summary_revisions,
  brainstorming_sessions,
  context_manifests,
  decisions,
  development_plan_revisions,
  development_plan_item_revisions,
  development_plan_items,
  development_plan_source_links,
  development_plans,
  executions,
  execution_plan_revisions,
  execution_plans,
  execution_package_generation_packages,
  execution_package_generation_runs,
  execution_package_dependencies,
  execution_packages,
  execution_readiness_records,
  manual_path_hold_idempotency_records,
  manual_path_holds,
  object_events,
  organizations,
  plan_revisions,
  plan_item_workflow_transitions,
  plan_item_workflows,
  plans,
  project_repos,
  projects,
  qa_handoffs,
  release_evidences,
  release_execution_packages,
  release_work_items,
  releases,
  review_packets,
  run_commands,
  run_event_counters,
  run_events,
  run_sessions,
  run_worker_leases,
  spec_revisions,
  specs,
  status_histories,
  trace_artifact_refs,
  trace_events,
  trace_links,
  tasks,
  work_items,
  workflow_manual_decisions,
} from '../schema';
import type {
  ClaimAutomationActionRunInput,
  AcceptCodexRuntimeJobInput,
  AppendCodexRuntimeJobEventInput,
  CancelCodexRuntimeJobInput,
  ClaimNextAutomationActionRunInput,
  ClaimCodexLaunchTokenEnvelopeInput,
  ClaimCommandIdempotencyInput,
  ClaimExecutionPackageGenerationRunInput,
  CompleteAutomationActionRunInput,
  CompleteExecutionPackageGenerationRunInput,
  CodexLaunchFenceSnapshot,
  CodexLaunchTokenEnvelopeSealer,
  CodexRuntimeRecoveryResult,
  CodexWorkerReplayProtectionInput,
  BindReservedCodexRuntimeJobArtifactInput,
  ConsumeCodexRuntimeSetupNonceInput,
  CreateInternalArtifactObjectInput,
  CreatePendingWorkspaceBundleArtifactInput,
  CreateCodexCredentialBindingWithVersionInput,
  CreateCodexRuntimeJobArtifactInput,
  CreateCodexRuntimeProfileWithRevisionInput,
  PreflightCreateCodexRuntimeJobArtifactInput,
  ReserveCodexRuntimeJobArtifactUploadInput,
  CreateCodexWorkerBootstrapTokenInput,
  CreateOrReplayCodexRuntimeJobWithLeaseAndEnvelopeInput,
  CreateOrReplayCodexRuntimeJobWithLeaseAndEnvelopeResult,
  CreateOrReplayCodexLaunchLeaseInput,
  CreateOrReplayAutomationActionRunInput,
  DisableAutomationProjectSettingsInput,
  ExecutionPackageGenerationPackageRecord,
  FinishCommandIdempotencyInput,
  FindAvailableCodexWorkerInput,
  FindCodexWorkerForSessionRunnerInput,
  GetActiveCodexGenerationActionRunFenceInput,
  GetAutomationActionRunByIdempotencyKeyInput,
  GetClaimedAutomationActionRunInput,
  GetCodexLaunchLeasePublicStatusInput,
  GetCodexLaunchLeaseStatusInput,
  GetCodexRuntimeJobEnvelopeInput,
  GetCodexRuntimeJobInput,
  GetCodexRuntimeJobWorkloadInput,
  GetCodexRuntimeStatusInput,
  GetCodexWorkerReadinessDiagnosticInput,
  GetWorkspaceBundleDownloadForRuntimeJobInput,
  GetInternalArtifactObjectByRefInput,
  HeartbeatCodexWorkerInput,
  LatestCompletedProjectionActionRunInput,
  ListActiveCodexRuntimeProfileReadinessDiagnosticsInput,
  ListCodexCredentialBindingReadinessCandidatesInput,
  ListCodexRuntimeJobArtifactsInput,
  GetCodexRuntimeJobArtifactByInternalRefInput,
  ListActiveManualPathHoldsInput,
  ListClaimableAutomationActionRunsInput,
  MarkCodexSessionRunnerOwnerInput,
  MarkAutomationActionGatePendingInput,
  MaterializeCodexRuntimeJobInput,
  MaterializeCodexLaunchLeaseInput,
  PendingWorkspaceBundleInput,
  PendingWorkspaceBundleReplayInput,
  PollCodexRuntimeJobsInput,
  DeliveryRepository,
  RecoverStaleCodexRuntimeJobsInput,
  RecoverStaleCodexRuntimeJobsResult,
  RecoverStaleCodexWorkerLeasesInput,
  RefreshCodexWorkerSessionInput,
  RuntimeSnapshotRepositoryData,
  RuntimeSnapshotTargetRow,
  CodexCredentialBindingReadinessCandidate,
  CodexRuntimeProfileReadinessDiagnostic,
  CodexWorkerReadinessDiagnostic,
  WorkspaceBundleDownloadForRuntimeJob,
  RenewCommandIdempotencyInput,
  RequestManualPathHoldInput,
  ResolveCodexCredentialForLaunchInput,
  ResolveCodexRuntimeForLaunchInput,
  ResolveAutomationProjectSettingsInput,
  ResolveManualPathHoldInput,
  RevokeCodexLaunchLeaseInput,
  SaveExecutionPackageGenerationPackageInput,
  SetAutomationProjectSettingsInput,
  SupersedeExecutionPackageGenerationRunInput,
  StartCodexRuntimeJobInput,
  TerminalizeCodexRuntimeJobInput,
  TombstoneInternalArtifactObjectInput,
  TerminalizeCodexLaunchLeaseInput,
  TraceArtifactRefRecord,
  TraceEventRecord,
  TraceLinkRecord,
  UpsertCodexWorkerRegistrationInput,
  BoundaryAnswerRecord,
  BoundaryDecisionRecord,
  BoundaryQuestionRecord,
  ClaimCodexSessionLeaseInput,
  ApplyPlanItemWorkflowTransitionInput,
  CreateCodexSessionForkInput,
  CreatePlanItemWorkflowWithInitialSessionInput,
  RecoverCodexSessionLeaseForClaimInput,
  RenewCodexSessionLeaseInput,
  RenewCodexSessionRunnerOwnerInput,
  SelectActiveCodexSessionForkInput,
  TerminalizeCodexSessionTurnInput,
  WorkflowRepositoryEvidenceInput,
  BoundaryRoundRecord,
  AttachCodexSessionRunnerRuntimeJobInput,
  ClearCodexSessionRunnerOwnerInput,
} from './delivery-repository';
import {
  assertInternalArtifactObjectInput,
  runtimeSnapshotBlockerFieldsFor,
  runtimeSnapshotBlockersForActionRun,
  runtimeSnapshotBlockersForExecutionPackage,
} from './delivery-repository';

export type ForgeloopDrizzleDatabase = NodePgDatabase<typeof schema>;

const snakeToCamel = (value: string) => value.replace(/_([a-z])/g, (_, char: string) => char.toUpperCase());
const camelToSnake = (value: string) => value.replace(/[A-Z]/g, (char) => `_${char.toLowerCase()}`);
const timestampKeyPattern = /(?:^|_)(?:at|until|timestamp)$|(?:At|Until|Timestamp)$/;
const postgresTimestampPattern = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}(?:\.\d+)?)([+-]\d{2})(?::?(\d{2}))?$/;

const toDbRecord = (record: object, table?: AnyPgTable): Record<string, unknown> => {
  const dbRecord = Object.fromEntries(Object.entries(record).map(([key, value]) => [snakeToCamel(key), value]));

  if (table === undefined) {
    return dbRecord;
  }

  for (const [columnName, column] of Object.entries(getTableColumns(table))) {
    if (!(column as { notNull?: boolean }).notNull && dbRecord[columnName] === undefined) {
      dbRecord[columnName] = null;
    }
  }

  return dbRecord;
};

const redactAutomationActionClaim = (actionRun: AutomationActionRun): AutomationActionRun => {
  const { claim_token: _claimToken, locked_until: _lockedUntil, ...redacted } = actionRun;
  return redacted;
};

const normalizeTimestampValue = (key: string, value: unknown): unknown => {
  if (!timestampKeyPattern.test(key) || (typeof value !== 'string' && !(value instanceof Date))) {
    return value;
  }

  const normalizedInput =
    typeof value === 'string'
      ? value.replace(postgresTimestampPattern, (_match, date: string, time: string, offsetHours: string, offsetMinutes?: string) => {
          return `${date}T${time}${offsetHours}:${offsetMinutes ?? '00'}`;
        })
      : value;
  const date = normalizedInput instanceof Date ? normalizedInput : new Date(normalizedInput);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
};

const fromDbRecord = <T>(record: Record<string, unknown>): T =>
  Object.fromEntries(
    Object.entries(record)
      .filter(([, value]) => value !== null)
      .map(([key, value]) => [camelToSnake(key), normalizeTimestampValue(key, value)]),
  ) as T;

const executionDbRecord = (execution: Execution): Record<string, unknown> => {
  const record = toDbRecord(execution, executions);
  record.implementationPlanRevisionId = execution.implementation_plan_revision_id;
  record.implementationPlanRevisionRef = execution.implementation_plan_revision_ref;
  return record;
};

const executionFromDbRecord = (record: Record<string, unknown>): Execution => fromDbRecord<Execution>(record);

const statusHistoryDbRecord = (statusHistory: StatusHistory): Record<string, unknown> => {
  const record = toDbRecord(statusHistory, status_histories);
  record.toStatus ??= statusHistory.to_value;
  record.fromStatus ??= statusHistory.from_value;
  return record;
};

const statusHistoryFromDbRecord = (record: Record<string, unknown>): StatusHistory => {
  const statusHistory = fromDbRecord<StatusHistory>(record);
  const shouldOmitToStatus = statusHistory.to_value !== undefined && statusHistory.to_status === statusHistory.to_value;
  const shouldOmitFromStatus = statusHistory.from_value !== undefined && statusHistory.from_status === statusHistory.from_value;
  if (!shouldOmitToStatus && !shouldOmitFromStatus) {
    return statusHistory;
  }
  const {
    to_status: omittedToStatus,
    from_status: omittedFromStatus,
    ...legacyStatusHistory
  } = statusHistory;
  void omittedToStatus;
  void omittedFromStatus;
  return {
    ...legacyStatusHistory,
    ...(shouldOmitFromStatus ? {} : { from_status: statusHistory.from_status }),
    ...(shouldOmitToStatus ? {} : { to_status: statusHistory.to_status }),
  } as StatusHistory;
};

const normalizedTimestampString = (value: string): string => {
  const normalized = normalizeTimestampValue('timestamp', value);
  return typeof normalized === 'string' ? normalized : value;
};

const timestampIsAfter = (left: string, right: string): boolean => {
  const leftMs = Date.parse(normalizedTimestampString(left));
  const rightMs = Date.parse(normalizedTimestampString(right));
  return Number.isFinite(leftMs) && Number.isFinite(rightMs) && leftMs > rightMs;
};

type CanonicalJsonValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly CanonicalJsonValue[]
  | { readonly [key: string]: CanonicalJsonValue };

const canonicalizeJson = (value: CanonicalJsonValue): CanonicalJsonValue => {
  if (value === null || value === undefined || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => (item === undefined ? null : canonicalizeJson(item)));
  }

  const record = value as { readonly [key: string]: CanonicalJsonValue };
  return Object.keys(record)
    .sort()
    .reduce<Record<string, CanonicalJsonValue>>((accumulator, key) => {
      const item = record[key];
      if (item !== undefined) {
        accumulator[key] = canonicalizeJson(item);
      }
      return accumulator;
    }, {});
};

const canonicalJson = (value: unknown): string => JSON.stringify(canonicalizeJson(value as CanonicalJsonValue));

const valuesEqual = (left: unknown, right: unknown): boolean => canonicalJson(left) === canonicalJson(right);
const revisionDiff = (
  query: RevisionCompareQuery,
  base: unknown,
  compare: unknown,
): StructuredRevisionDiff => ({
  base_revision_id: query.base_revision_id,
  compare_revision_id: query.compare_revision_id,
  changed_fields: changedFields(base, compare),
  ...(base === undefined ? {} : { base_snapshot: structuredClone(base) as Record<string, unknown> }),
  ...(compare === undefined ? {} : { compare_snapshot: structuredClone(compare) as Record<string, unknown> }),
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const isCodexSessionResumeRuntimeJobInput = (inputJson: Record<string, unknown>): boolean => {
  const context = inputJson.codex_session_runtime_context;
  if (!isRecord(context)) {
    return false;
  }
  const continuation = context.continuation;
  return isRecord(continuation) && continuation.kind === 'resume_thread';
};

const shouldKeepCodexSessionRunnerLeaseOpen = (job: CodexRuntimeJob, terminalStatus: string): boolean => {
  if (terminalStatus !== 'succeeded' || job.codex_session_id === undefined || job.codex_session_turn_id === undefined) {
    return false;
  }
  try {
    const context = validateCodexSessionRuntimeContext(job.input_json.codex_session_runtime_context);
    return (
      context.codex_session_id === job.codex_session_id &&
      context.codex_session_turn_id === job.codex_session_turn_id &&
      context.continuation.kind === 'start_thread' &&
      context.turn_group_status === 'intermediate'
    );
  } catch {
    return false;
  }
};

const codexSessionRunnerJobHasLiveEvidence = (
  job: CodexRuntimeJob,
  input: AttachCodexSessionRunnerRuntimeJobInput,
): boolean =>
  job.id === input.runner_runtime_job_id &&
  job.launch_lease_id === input.runner_launch_lease_id &&
  job.codex_session_id === input.session_id &&
  job.worker_id === input.worker_id &&
  job.runtime_evidence_digest !== undefined &&
  job.launch_materialization_digest !== undefined &&
  job.started_at !== undefined &&
  job.expires_at > input.now &&
  (job.status === 'running' ||
    (job.status === 'terminal' &&
      job.terminal_status === 'succeeded' &&
      shouldKeepCodexSessionRunnerLeaseOpen(job, job.terminal_status)));

const codexSessionResumeRuntimeJobMatchesAttach = (
  job: CodexRuntimeJob,
  session: CodexSession,
  input: AttachCodexSessionRunnerRuntimeJobInput,
): boolean => {
  try {
    const context = validateCodexSessionRuntimeContext(job.input_json.codex_session_runtime_context);
    return (
      context.continuation.kind === 'resume_thread' &&
      session.codex_thread_id !== undefined &&
      session.codex_thread_id_digest !== undefined &&
      context.continuation.codex_thread_id === session.codex_thread_id &&
      context.continuation.codex_thread_id_digest === session.codex_thread_id_digest &&
      context.codex_session_id === input.session_id &&
      context.codex_session_turn_id === job.codex_session_turn_id &&
      context.worker_id === input.worker_id &&
      context.worker_session_digest === job.accepted_worker_session_digest &&
      context.runner_runtime_job_id === input.runner_runtime_job_id &&
      context.runner_launch_lease_id === input.runner_launch_lease_id
    );
  } catch {
    return false;
  }
};

const changedFields = (base: unknown, compare: unknown): string[] => {
  if (valuesEqual(base, compare)) {
    return [];
  }
  if (!isRecord(base) || !isRecord(compare)) {
    return ['value'];
  }
  return [...new Set([...Object.keys(base), ...Object.keys(compare)])]
    .filter((key) => !valuesEqual(base[key], compare[key]))
    .sort();
};
const rawSha256 = (bytes: Uint8Array | string): string => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const workspaceBundleAcquisitionKeys = new Set([
  'schema_version',
  'bundle_id',
  'archive_ref',
  'archive_digest',
  'manifest_digest',
  'size_bytes',
  'expires_at',
]);

const workspaceBundleAcquisitionMatches = (
  value: Record<string, unknown>,
  expected: Pick<PendingWorkspaceBundleInput, 'bundle_id' | 'pending_artifact_ref' | 'archive_digest' | 'manifest_digest' | 'size_bytes' | 'expires_at'>,
): boolean =>
  Object.keys(value).every((key) => workspaceBundleAcquisitionKeys.has(key)) &&
  value.schema_version === 'workspace_bundle_acquisition.v1' &&
  value.bundle_id === expected.bundle_id &&
  value.archive_ref === expected.pending_artifact_ref &&
  value.archive_digest === expected.archive_digest &&
  value.manifest_digest === expected.manifest_digest &&
  value.size_bytes === expected.size_bytes &&
  value.expires_at === expected.expires_at;
const workspaceBundleArchiveManifestDigest = (archiveBytes: Uint8Array): string | undefined => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(archiveBytes).toString('utf8'));
  } catch {
    return undefined;
  }
  if (!isRecord(parsed) || parsed.schema_version !== 'workspace_bundle_archive.v1' || !isRecord(parsed.manifest)) {
    return undefined;
  }
  return rawSha256(JSON.stringify(parsed.manifest));
};
const objectRefIdentityMatches = (left: ObjectRef | undefined, right: ObjectRef): boolean =>
  left?.type === right.type && left.id === right.id;

const timestampMillis = (value: string | undefined): number | undefined => {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
};

const timestampAtOrBefore = (left: string | undefined, right: string): boolean => {
  const leftMillis = timestampMillis(left);
  const rightMillis = timestampMillis(right);
  return leftMillis !== undefined && rightMillis !== undefined ? leftMillis <= rightMillis : left !== undefined && left <= right;
};

const compareTimestamp = (left: string | undefined, right: string | undefined): number => {
  const leftMillis = timestampMillis(left);
  const rightMillis = timestampMillis(right);
  if (leftMillis !== undefined && rightMillis !== undefined) {
    return leftMillis - rightMillis;
  }
  return (left ?? '').localeCompare(right ?? '');
};

const codexWorkerHeartbeatFreshMs = 5 * 60 * 1000;

const codexWorkerHeartbeatIsFresh = (lastHeartbeatAt: string | undefined, now: string): boolean => {
  const heartbeatMillis = timestampMillis(lastHeartbeatAt);
  const nowMillis = timestampMillis(now);
  if (heartbeatMillis === undefined || nowMillis === undefined || heartbeatMillis > nowMillis) {
    return false;
  }
  return nowMillis - heartbeatMillis <= codexWorkerHeartbeatFreshMs;
};

const automationScopeMatchesCodexTarget = (automationScope: string, projectId: string, repoId?: string): boolean => {
  if (repoId !== undefined) {
    return automationScope === `repo:${projectId}:${repoId}`;
  }
  return automationScope === `project:${projectId}` || automationScope.startsWith(`repo:${projectId}:`);
};

const stablePolicyObservationIdentity = (actionInputJson: Record<string, unknown>): Record<string, unknown> => ({
  repo_id: actionInputJson.repo_id,
  policy_status: actionInputJson.policy_status,
  policy_digest: actionInputJson.policy_digest,
  parser_version: actionInputJson.parser_version,
  reason_code: actionInputJson.reason_code,
});

const automationScopeParts = (automationScope: string): { projectId: string; repoId?: string } => {
  const [scopeType, projectId, repoId] = automationScope.split(':');
  return scopeType === 'repo' && repoId !== undefined ? { projectId: projectId ?? '', repoId } : { projectId: projectId ?? '' };
};

const repoAutomationScopeRepoId = (automationScope: string): string | undefined => automationScopeParts(automationScope).repoId;

const recoverableRunSessionStatuses: RunSession['status'][] = [
  'queued',
  'running',
  'waiting_for_input',
  'stalled',
  'resuming',
  'cancel_requested',
];
const activeBoundarySessionStatuses = new Set<BrainstormingSession['status']>([
  'draft',
  'ai_turn_running',
  'waiting_for_leader',
  'summary_proposed',
  'changes_requested',
]);
const terminalCommandStatuses = new Set<CommandIdempotencyRecord['status']>(['succeeded', 'skipped', 'blocked']);
const claimableCodexSessionStatuses = new Set<CodexSession['status']>(['starting', 'idle', 'recovering']);
const eventCursor = (sequence: number) => String(sequence).padStart(10, '0');
const invalidLease = (runSessionId: string): DomainErrorType =>
  new DomainError('INVALID_TRANSITION', `Run session ${runSessionId} does not have an active worker lease`);
const normalizeRepositoryNamespace = (value: string): string | undefined => {
  const trimmed = value.trim().replace(/\.git$/i, '');
  const path = trimmed.match(/^([^/\s]+)\/([^/\s]+)$/);
  if (path !== null) {
    return `${path[1]}/${path[2]}`.toLowerCase();
  }
  const ssh = trimmed.match(/^[^@\s]+@[^:\s]+:([^/\s]+)\/([^/\s]+)$/);
  if (ssh !== null) {
    return `${ssh[1]}/${ssh[2]}`.toLowerCase();
  }
  try {
    const url = new URL(trimmed);
    const parts = url.pathname.replace(/^\/+|\/+$/g, '').split('/');
    if ((url.protocol === 'http:' || url.protocol === 'https:') && parts.length >= 2) {
      return `${parts[0]}/${parts[1]!.replace(/\.git$/i, '')}`.toLowerCase();
    }
  } catch {
    return undefined;
  }
  return undefined;
};
const parseGitHubStylePullRequestUrl = (value: string): { namespace: string } | undefined => {
  try {
    const url = new URL(value);
    const parts = url.pathname.replace(/^\/+|\/+$/g, '').split('/');
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:') ||
      parts.length !== 4 ||
      parts[2] !== 'pull' ||
      !/^\d+$/.test(parts[3]!)
    ) {
      return undefined;
    }
    return { namespace: `${parts[0]}/${parts[1]}`.toLowerCase() };
  } catch {
    return undefined;
  }
};
const RUNTIME_SNAPSHOT_RECENT_ACTION_RUN_LIMIT = 50;
const RUNTIME_SNAPSHOT_MIN_ACTION_RUN_LOOKBACK = 100;
const RUNTIME_SNAPSHOT_MAX_ACTION_RUN_LOOKBACK = 500;

type CodexWorkerRegistrationDbRecord = {
  id: string;
  worker_identity: string;
  status: CodexWorkerRegistration['status'];
  version: string;
  control_channel_status: CodexWorkerRegistration['control_channel_status'];
  session_token_hash: string;
  session_token_expires_at: string;
  session_epoch: number;
  bootstrap_token_hash?: string;
  bootstrap_token_version: number;
  allowed_scopes_json: readonly CodexRuntimeScope[];
  capabilities?: readonly CodexRuntimeTargetKind[];
  capabilities_json: Record<string, unknown>;
  capability_ceiling_json?: Record<string, unknown>;
  host_worker_uid: number;
  host_worker_gid: number;
  lease_count: number;
  max_concurrency: number;
  labels_json: Record<string, unknown>;
  session_public_key_id: string;
  session_public_key_algorithm: string;
  session_public_key_material: string;
  session_public_key_created_at: string;
  session_public_key_expires_at: string;
  registered_at: string;
  last_heartbeat_at?: string;
};

type CodexWorkerSessionProof = {
  worker: CodexWorkerRegistrationDbRecord;
  session_token_hash: string;
  session_epoch: number;
  session_public_key_id: string;
  session_public_key_expires_at: string;
};

type CodexLaunchLeaseDbRecord = {
  id: string;
  lease_request_id: string;
  target_type: CodexLaunchLease['target']['target_type'];
  target_id: string;
  target_kind: CodexRuntimeTargetKind;
  project_id: string;
  repo_id?: string;
  launch_attempt: number;
  action_type?: string;
  action_attempt?: number;
  action_claim_token_hash?: string;
  precondition_fingerprint?: string;
  execution_package_id?: string;
  run_worker_lease_id?: string;
  run_worker_lease_token_hash?: string;
  run_session_status?: string;
  run_session_updated_at?: string;
  execution_package_version?: number;
  worker_id?: string;
  status: CodexLaunchLease['status'];
  lease_token_hash: string;
  runtime_profile_revision_id: string;
  runtime_profile_digest: string;
  credential_binding_id: string;
  credential_binding_version_id: string;
  credential_payload_digest: string;
  docker_image_digest: string;
  network_policy_digest: string;
  network_provider_config_digest?: string;
  materialization_request_hash?: string;
  created_at: string;
  expires_at: string;
  materialized_at?: string;
  terminalized_at?: string;
  terminal_reason_code?: string;
  terminal_evidence_summary_json?: Record<string, unknown>;
  terminal_runtime_job_id?: string;
  terminal_idempotency_key?: string;
};

type CodexRuntimeJobDbRecord = CodexRuntimeJob & {
  runtime_profile_revision_id: string;
  runtime_profile_digest: string;
  credential_binding_id: string;
  credential_binding_version_id: string;
  credential_payload_digest: string;
  docker_image_digest: string;
  network_policy_digest: string;
  network_provider_config_digest?: string;
  envelope_digest: string;
};

type CodexPendingWorkspaceBundleDbRecord = PendingWorkspaceBundleInput & {
  id: string;
  run_session_id: string;
  execution_package_id: string;
  archive_bytes_base64?: string;
  request_digest: string;
  runtime_job_id?: string;
  status: string;
  created_at: string;
};

type CodexRuntimeJobArtifactDbRecord = {
  id: string;
  runtime_job_id: string;
  artifact_idempotency_key: string;
  kind: string;
  name: string;
  content_type: string;
  digest: string;
  internal_ref: string;
  internal_artifact_object_id?: string;
  size_bytes: number;
  metadata_json: Record<string, unknown>;
  request_digest?: string;
  created_at: string;
};

type InternalArtifactObjectDbRecord = Omit<InternalArtifactObject, 'size_bytes'> & {
  size_bytes: bigint | string | number;
};

const internalArtifactOwnerIdempotencyKey = (input: Pick<InternalArtifactObject, 'owner_type' | 'owner_id' | 'idempotency_key'>) =>
  `${input.owner_type}:${input.owner_id}:${input.idempotency_key}`;

const internalArtifactOwnerKindArtifactKey = (input: Pick<InternalArtifactObject, 'owner_type' | 'owner_id' | 'kind' | 'artifact_id'>) =>
  `${input.owner_type}:${input.owner_id}:${input.kind}:${input.artifact_id}`;

interface DrizzleDeliveryRepositoryOptions {
  codexLaunchTokenEnvelopeSealer?: CodexLaunchTokenEnvelopeSealer;
}

const codexDenied = (code: DomainErrorType['code'], message: string, details?: Record<string, unknown>): DomainErrorType =>
  new DomainError(code, message, details);

const codexSessionSnapshotDurableIdentityMatches = (
  existing: CodexSessionSnapshot,
  candidate: CodexSessionSnapshot,
): boolean =>
  existing.codex_session_id === candidate.codex_session_id &&
  existing.digest === candidate.digest &&
  existing.artifact_ref === candidate.artifact_ref &&
  existing.manifest_digest === candidate.manifest_digest &&
  existing.sequence === candidate.sequence &&
  existing.created_from_turn_id === candidate.created_from_turn_id;

const capabilityList = (capabilities: Record<string, unknown>, key: string): readonly string[] => {
  const value = capabilities[key];
  return Array.isArray(value) && value.every((entry): entry is string => typeof entry === 'string') ? value : [];
};

const includesAll = (allowed: readonly string[], requested: readonly string[]): boolean =>
  requested.every((entry) => allowed.includes(entry));

const codexScope = (projectId: string, repoId?: string): CodexRuntimeScope => ({
  project_id: projectId,
  ...(repoId === undefined ? {} : { repo_id: repoId }),
});

const defaultCodexLaunchTokenEnvelopeSealer: CodexLaunchTokenEnvelopeSealer = {
  async sealLaunchTokenEnvelope(input) {
    const aad_json = {
      runtime_job_id: input.runtime_job_id,
      launch_lease_id: input.launch_lease_id,
      envelope_id: input.envelope_id,
      worker_id: input.worker_id,
      key_id: input.key_id,
      expires_at: input.expires_at,
    };
    const envelopeWithoutDigest = {
      id: input.envelope_id,
      runtime_job_id: input.runtime_job_id,
      launch_lease_id: input.launch_lease_id,
      worker_id: input.worker_id,
      key_id: input.key_id,
      algorithm: 'x25519-hkdf-sha256-aes-256-gcm' as const,
      ciphertext: `drizzle-in-memory:${codexCredentialPayloadDigest(input.plaintext_launch_token)}`,
      encryption_nonce: codexCanonicalDigest(`nonce:${input.envelope_id}:${input.runtime_job_id}`),
      aad_json,
      aad_digest: codexCanonicalDigest(aad_json),
      expires_at: input.expires_at,
    };
    return {
      ...envelopeWithoutDigest,
      envelope_digest: codexLaunchTokenEnvelopeDigest(envelopeWithoutDigest),
    };
  },
};

const codexCredentialBindingVersionPublicColumns = {
  id: codex_credential_binding_versions.id,
  bindingId: codex_credential_binding_versions.bindingId,
  versionNumber: codex_credential_binding_versions.versionNumber,
  status: codex_credential_binding_versions.status,
  payloadDigest: codex_credential_binding_versions.payloadDigest,
  createdByActorId: codex_credential_binding_versions.createdByActorId,
  createdAt: codex_credential_binding_versions.createdAt,
};

const registrationFromDbRecord = (record: CodexWorkerRegistrationDbRecord): CodexWorkerRegistration => ({
  id: record.id,
  worker_version: record.version,
  worker_identity: record.worker_identity,
  status: record.status,
  control_channel_status: record.control_channel_status,
  session_expires_at: record.session_token_expires_at,
  session_epoch: record.session_epoch,
  ...(record.bootstrap_token_hash === undefined ? {} : { bootstrap_token_hash: record.bootstrap_token_hash }),
  capabilities: record.capabilities ?? (capabilityList(record.capabilities_json, 'target_kinds') as readonly CodexRuntimeTargetKind[]),
  uid: record.host_worker_uid,
  gid: record.host_worker_gid,
  active_lease_count: record.lease_count,
  max_concurrency: record.max_concurrency,
  session_public_key: record.session_public_key_material,
  registered_at: record.registered_at,
  ...(record.last_heartbeat_at === undefined ? {} : { last_heartbeat_at: record.last_heartbeat_at }),
});

const launchLeaseFromDbRecord = (record: CodexLaunchLeaseDbRecord): CodexLaunchLease => ({
  id: record.id,
  target: {
    target_type: record.target_type,
    target_id: record.target_id,
    target_kind: record.target_kind,
    project_id: record.project_id,
    ...(record.repo_id === undefined ? {} : { repo_id: record.repo_id }),
  },
  launch_attempt: record.launch_attempt,
  profile_revision_id: record.runtime_profile_revision_id,
  ...(record.worker_id === undefined ? {} : { worker_id: record.worker_id }),
  status: record.status,
  lease_token_hash: record.lease_token_hash,
  created_at: record.created_at,
  expires_at: record.expires_at,
  ...(record.materialized_at === undefined ? {} : { materialized_at: record.materialized_at }),
  ...(record.terminalized_at === undefined ? {} : { terminal_at: record.terminalized_at }),
  ...(record.status === 'revoked' && record.terminalized_at !== undefined ? { revoked_at: record.terminalized_at } : {}),
  ...(record.terminal_reason_code === undefined ? {} : { terminal_reason_code: record.terminal_reason_code }),
  ...(record.terminal_evidence_summary_json === undefined ? {} : { terminal_evidence_summary: record.terminal_evidence_summary_json }),
  ...(record.terminal_runtime_job_id === undefined ? {} : { terminal_runtime_job_id: record.terminal_runtime_job_id }),
  ...(record.terminal_idempotency_key === undefined ? {} : { terminal_idempotency_key: record.terminal_idempotency_key }),
});

const runtimeJobFromDbRecord = (record: CodexRuntimeJobDbRecord): CodexRuntimeJob => ({
  id: record.id,
  job_request_id: record.job_request_id,
  target_type: record.target_type,
  target_id: record.target_id,
  target_kind: record.target_kind,
  project_id: record.project_id,
  ...(record.repo_id === undefined ? {} : { repo_id: record.repo_id }),
  worker_id: record.worker_id,
  launch_lease_id: record.launch_lease_id,
  launch_attempt: record.launch_attempt,
  status: record.status,
  input_digest: record.input_digest,
  input_json: record.input_json,
  ...(record.workflow_id === undefined ? {} : { workflow_id: record.workflow_id }),
  ...(record.codex_session_id === undefined ? {} : { codex_session_id: record.codex_session_id }),
  ...(record.codex_session_turn_id === undefined ? {} : { codex_session_turn_id: record.codex_session_turn_id }),
  ...(record.workspace_acquisition_digest === undefined
    ? {}
    : { workspace_acquisition_digest: record.workspace_acquisition_digest }),
  ...(record.workspace_acquisition_json === undefined ? {} : { workspace_acquisition_json: record.workspace_acquisition_json }),
  ...(record.accept_idempotency_key === undefined ? {} : { accept_idempotency_key: record.accept_idempotency_key }),
  ...(record.accept_request_digest === undefined ? {} : { accept_request_digest: record.accept_request_digest }),
  ...(record.accepted_at === undefined ? {} : { accepted_at: record.accepted_at }),
  ...(record.accepted_worker_session_digest === undefined
    ? {}
    : { accepted_worker_session_digest: record.accepted_worker_session_digest }),
  ...(record.accepted_session_public_key_id === undefined
    ? {}
    : { accepted_session_public_key_id: record.accepted_session_public_key_id }),
  ...(record.accepted_session_public_key_expires_at === undefined
    ? {}
    : { accepted_session_public_key_expires_at: record.accepted_session_public_key_expires_at }),
  ...(record.accepted_session_epoch === undefined ? {} : { accepted_session_epoch: record.accepted_session_epoch }),
  ...(record.materializing_at === undefined ? {} : { materializing_at: record.materializing_at }),
  ...(record.materialization_request_id === undefined ? {} : { materialization_request_id: record.materialization_request_id }),
  ...(record.materialization_request_digest === undefined
    ? {}
    : { materialization_request_digest: record.materialization_request_digest }),
  ...(record.start_idempotency_key === undefined ? {} : { start_idempotency_key: record.start_idempotency_key }),
  ...(record.start_request_digest === undefined ? {} : { start_request_digest: record.start_request_digest }),
  ...(record.runtime_evidence_digest === undefined ? {} : { runtime_evidence_digest: record.runtime_evidence_digest }),
  ...(record.launch_materialization_digest === undefined
    ? {}
    : { launch_materialization_digest: record.launch_materialization_digest }),
  ...(record.started_at === undefined ? {} : { started_at: record.started_at }),
  ...(record.last_event_at === undefined ? {} : { last_event_at: record.last_event_at }),
  ...(record.cancel_requested_at === undefined ? {} : { cancel_requested_at: record.cancel_requested_at }),
  ...(record.cancel_idempotency_key === undefined ? {} : { cancel_idempotency_key: record.cancel_idempotency_key }),
  ...(record.cancel_request_digest === undefined ? {} : { cancel_request_digest: record.cancel_request_digest }),
  ...(record.drain_requested_at === undefined ? {} : { drain_requested_at: record.drain_requested_at }),
  ...(record.terminal_idempotency_key === undefined ? {} : { terminal_idempotency_key: record.terminal_idempotency_key }),
  ...(record.terminal_request_digest === undefined ? {} : { terminal_request_digest: record.terminal_request_digest }),
  ...(record.terminal_at === undefined ? {} : { terminal_at: record.terminal_at }),
  ...(record.terminal_status === undefined ? {} : { terminal_status: record.terminal_status }),
  ...(record.terminal_reason_code === undefined ? {} : { terminal_reason_code: record.terminal_reason_code }),
  ...(record.terminal_result_json === undefined ? {} : { terminal_result_json: record.terminal_result_json }),
  expires_at: record.expires_at,
  created_at: record.created_at,
  updated_at: record.updated_at,
});

const runtimeJobArtifactFromDbRecord = (
  artifact: CodexRuntimeJobArtifactDbRecord,
  job: Pick<CodexRuntimeJobDbRecord, 'project_id' | 'repo_id' | 'target_kind'>,
): CodexRuntimeJobArtifact => ({
  id: artifact.id,
  runtime_job_id: artifact.runtime_job_id,
  project_id: job.project_id,
  ...(job.repo_id === undefined ? {} : { repo_id: job.repo_id }),
  target_kind: job.target_kind,
  artifact_idempotency_key: artifact.artifact_idempotency_key,
  kind: artifact.kind,
  name: artifact.name,
  content_type: artifact.content_type,
  digest: artifact.digest,
  internal_ref: artifact.internal_ref,
  ...(artifact.internal_artifact_object_id === undefined
    ? {}
    : { internal_artifact_object_id: artifact.internal_artifact_object_id }),
  size_bytes: artifact.size_bytes,
  metadata_json: artifact.metadata_json,
  created_at: artifact.created_at,
});

const internalArtifactObjectFromDbRecord = (record: InternalArtifactObjectDbRecord): InternalArtifactObject => ({
  ...record,
  size_bytes: record.size_bytes.toString(),
});

const runtimeJobTargetFromDbRecord = (record: CodexRuntimeJobDbRecord): CodexLaunchLease['target'] => ({
  target_type: record.target_type,
  target_id: record.target_id,
  target_kind: record.target_kind,
  project_id: record.project_id,
  ...(record.repo_id === undefined ? {} : { repo_id: record.repo_id }),
});

const launchReplayMatches = (record: CodexLaunchLeaseDbRecord, input: CreateOrReplayCodexLaunchLeaseInput): boolean =>
  valuesEqual(launchLeaseFromDbRecord(record).target, input.target) &&
  record.launch_attempt === input.launch_attempt &&
  record.worker_id === input.worker_id &&
  record.runtime_profile_revision_id === input.runtime_profile_revision_id &&
  record.runtime_profile_digest === input.runtime_profile_digest &&
  record.credential_binding_id === input.credential_binding_id &&
  record.credential_binding_version_id === input.credential_binding_version_id &&
  record.credential_payload_digest === input.credential_payload_digest &&
  record.docker_image_digest === input.docker_image_digest &&
  record.network_policy_digest === input.network_policy_digest &&
  record.network_provider_config_digest === input.network_provider_config_digest &&
  record.action_type === input.action_type &&
  record.action_attempt === input.action_attempt &&
  record.action_claim_token_hash === input.action_claim_token_hash &&
  record.precondition_fingerprint === input.precondition_fingerprint &&
  record.execution_package_id === input.execution_package_id &&
  record.run_worker_lease_id === input.run_worker_lease_id &&
  record.run_worker_lease_token_hash === input.run_worker_lease_token_hash &&
  record.run_session_status === input.run_session_status &&
  record.run_session_updated_at === input.run_session_updated_at &&
  record.execution_package_version === input.execution_package_version;

const runtimeSnapshotActionRunLookback = (targetCount: number): number =>
  Math.min(RUNTIME_SNAPSHOT_MAX_ACTION_RUN_LOOKBACK, Math.max(RUNTIME_SNAPSHOT_MIN_ACTION_RUN_LOOKBACK, targetCount * 20));

export class DrizzleDeliveryRepository implements DeliveryRepository {
  private readonly codexLaunchTokenEnvelopeSealer: CodexLaunchTokenEnvelopeSealer;

  constructor(
    private readonly db: ForgeloopDrizzleDatabase,
    options: DrizzleDeliveryRepositoryOptions = {},
  ) {
    this.codexLaunchTokenEnvelopeSealer =
      options.codexLaunchTokenEnvelopeSealer ?? defaultCodexLaunchTokenEnvelopeSealer;
  }

  async withDeliveryTransaction<T>(write: (repository: DeliveryRepository) => Promise<T>): Promise<T> {
    return this.db.transaction((tx) => write(this.childRepository(tx as ForgeloopDrizzleDatabase)));
  }

  async withObjectLock<T>(key: string, write: (repository: DeliveryRepository) => Promise<T>): Promise<T> {
    return this.withAdvisoryLocks([key], write);
  }

  async createPlanItemWorkflowWithInitialSession(
    input: CreatePlanItemWorkflowWithInitialSessionInput,
  ): Promise<{ workflow: PlanItemWorkflow; session: CodexSession }> {
    return this.withObjectLock(`plan-item-workflow:item:${input.development_plan_item_id}`, async (repository) =>
      (repository as DrizzleDeliveryRepository).createPlanItemWorkflowWithInitialSessionUnlocked(input),
    );
  }

  private async createPlanItemWorkflowWithInitialSessionUnlocked(
    input: CreatePlanItemWorkflowWithInitialSessionInput,
  ): Promise<{ workflow: PlanItemWorkflow; session: CodexSession }> {
    if ((await this.getPlanItemWorkflow(input.id)) !== undefined || (await this.getCodexSession(input.codex_session_id)) !== undefined) {
      throw new DomainError('workflow_invalid_transition', 'workflow_invalid_transition: Workflow or Codex session already exists');
    }
    if ((await this.getActivePlanItemWorkflowByItem(input.development_plan_item_id)) !== undefined) {
      throw new DomainError(
        'workflow_active_session_conflict',
        `workflow_active_session_conflict: Plan item ${input.development_plan_item_id} already has an active workflow`,
      );
    }
    const item = await this.getDevelopmentPlanItem(input.development_plan_item_id);
    if (item !== undefined && item.development_plan_id !== input.development_plan_id) {
      throw new DomainError(
        'workflow_invalid_transition',
        `workflow_invalid_transition: Plan item ${input.development_plan_item_id} does not belong to development plan ${input.development_plan_id}`,
      );
    }

    const workflow: PlanItemWorkflow = {
      id: input.id,
      development_plan_id: input.development_plan_id,
      development_plan_item_id: input.development_plan_item_id,
      status: 'not_started',
      active_codex_session_id: input.codex_session_id,
      created_by_actor_id: input.actor_id,
      created_at: input.now,
      updated_at: input.now,
    };
    const session: CodexSession = {
      id: input.codex_session_id,
      owner_type: 'plan_item_workflow',
      owner_id: input.id,
      status: 'idle',
      role: 'active',
      runtime_profile_id: input.runtime_profile_id,
      runtime_profile_revision_id: input.runtime_profile_revision_id,
      credential_binding_id: input.credential_binding_id,
      credential_binding_version_id: input.credential_binding_version_id,
      lease_epoch: 0,
      created_by_actor_id: input.actor_id,
      created_at: input.now,
      updated_at: input.now,
    };
    await this.assertCanSavePlanItemWorkflow(workflow);
    await this.assertCanSaveCodexSession(session);
    await this.db.insert(plan_item_workflows).values(toDbRecord(workflow, plan_item_workflows) as never);
    await this.db.insert(codex_sessions).values(toDbRecord(session, codex_sessions) as never);
    return { workflow, session };
  }

  async getPlanItemWorkflow(id: string): Promise<PlanItemWorkflow | undefined> {
    return this.getById(plan_item_workflows, plan_item_workflows.id, id);
  }

  async getActivePlanItemWorkflowByItem(itemId: string): Promise<PlanItemWorkflow | undefined> {
    const [row] = await this.db
      .select()
      .from(plan_item_workflows)
      .where(and(eq(plan_item_workflows.developmentPlanItemId, itemId), sql`${plan_item_workflows.status} <> 'archived'`))
      .orderBy(asc(plan_item_workflows.createdAt), asc(plan_item_workflows.id))
      .limit(1);
    return row === undefined ? undefined : fromDbRecord<PlanItemWorkflow>(row);
  }

  async savePlanItemWorkflow(workflow: PlanItemWorkflow): Promise<void> {
    const existingWorkflow = await this.getPlanItemWorkflow(workflow.id);
    if (existingWorkflow === undefined) {
      throw new DomainError('workflow_invalid_transition', `workflow_invalid_transition: Plan Item Workflow ${workflow.id} does not exist`);
    }
    if (
      existingWorkflow.development_plan_id !== workflow.development_plan_id ||
      existingWorkflow.development_plan_item_id !== workflow.development_plan_item_id ||
      existingWorkflow.created_by_actor_id !== workflow.created_by_actor_id ||
      existingWorkflow.created_at !== workflow.created_at
    ) {
      throw new DomainError('workflow_invalid_transition', `workflow_invalid_transition: Plan Item Workflow ${workflow.id} identity fields cannot change`);
    }
    if (
      existingWorkflow.active_codex_session_id !== workflow.active_codex_session_id ||
      existingWorkflow.active_boundary_summary_revision_id !== workflow.active_boundary_summary_revision_id ||
      existingWorkflow.active_spec_doc_revision_id !== workflow.active_spec_doc_revision_id ||
      existingWorkflow.active_implementation_plan_doc_revision_id !== workflow.active_implementation_plan_doc_revision_id ||
      existingWorkflow.execution_package_id !== workflow.execution_package_id ||
      existingWorkflow.previous_status !== workflow.previous_status
    ) {
      throw new DomainError('workflow_invalid_transition', `workflow_invalid_transition: Plan Item Workflow ${workflow.id} service-owned projection fields cannot change`);
    }
    if (existingWorkflow.status !== workflow.status) {
      throw new DomainError('workflow_invalid_transition', `workflow_invalid_transition: Plan Item Workflow ${workflow.id} status cannot change through save`);
    }
    await this.assertCanSavePlanItemWorkflow(workflow);
    await this.db.update(plan_item_workflows).set(toDbRecord(workflow, plan_item_workflows) as never).where(eq(plan_item_workflows.id, workflow.id));
  }

  async applyPlanItemWorkflowTransition(input: ApplyPlanItemWorkflowTransitionInput): Promise<PlanItemWorkflow> {
    return this.withObjectLock(`plan-item-workflow:${input.transition.workflow_id}`, async (repository) =>
      (repository as DrizzleDeliveryRepository).applyPlanItemWorkflowTransitionUnlocked(input),
    );
  }

  private async applyPlanItemWorkflowTransitionUnlocked(input: ApplyPlanItemWorkflowTransitionInput): Promise<PlanItemWorkflow> {
    const workflow = await this.getPlanItemWorkflow(input.transition.workflow_id);
    if (workflow === undefined) {
      throw new DomainError('workflow_invalid_transition', `workflow_invalid_transition: Workflow ${input.transition.workflow_id} does not exist`);
    }
    if (input.transition.from_status !== workflow.status) {
      throw new DomainError('workflow_invalid_transition', `workflow_invalid_transition: Transition ${input.transition.id} from_status does not match workflow status`);
    }
    await this.assertPlanItemWorkflowProjectionPatchAllowed(input);
    await this.assertCanAppendPlanItemWorkflowTransition(input.transition, input.projection_patch);

    const updatedWorkflow: PlanItemWorkflow = {
      ...workflow,
      status: input.transition.to_status,
      ...this.nextWorkflowPreviousStatus(workflow, input.transition),
      ...(input.projection_patch ?? {}),
      updated_at: input.transition.created_at,
    };
    if (input.transition.from_status === 'blocked' && input.transition.to_status !== 'blocked') {
      delete updatedWorkflow.previous_status;
    }
    await this.assertCanSavePlanItemWorkflow(updatedWorkflow);
    await this.db.insert(plan_item_workflow_transitions).values(toDbRecord(input.transition, plan_item_workflow_transitions) as never);
    await this.db
      .update(plan_item_workflows)
      .set(toDbRecord(updatedWorkflow, plan_item_workflows) as never)
      .where(eq(plan_item_workflows.id, updatedWorkflow.id));
    return updatedWorkflow;
  }

  async listPlanItemWorkflowTransitions(workflowId: string): Promise<PlanItemWorkflowTransition[]> {
    return this.listWhere<PlanItemWorkflowTransition>(
      plan_item_workflow_transitions,
      eq(plan_item_workflow_transitions.workflowId, workflowId),
      [plan_item_workflow_transitions.createdAt, plan_item_workflow_transitions.id],
    );
  }

  async saveWorkflowManualDecision(decision: WorkflowManualDecision): Promise<void> {
    if ((await this.getWorkflowManualDecision(decision.id)) !== undefined) {
      throw new DomainError('workflow_invalid_transition', `workflow_invalid_transition: Workflow manual decision ${decision.id} already exists`);
    }
    if (!workflowManualDecisionSchema.safeParse(decision).success) {
      throw new DomainError('workflow_invalid_transition', `workflow_invalid_transition: Workflow manual decision ${decision.id} payload is invalid`);
    }
    await this.assertWorkflowCodexSessionProvenance(decision.workflow_id, decision.codex_session_id, `Workflow manual decision ${decision.id}`);
    if (decision.selected_codex_session_id !== undefined) {
      await this.assertWorkflowCodexSessionProvenance(
        decision.workflow_id,
        decision.selected_codex_session_id,
        `Workflow manual decision ${decision.id} selected Codex session`,
      );
    }
    await this.db.insert(workflow_manual_decisions).values(toDbRecord(decision, workflow_manual_decisions) as never);
  }

  async getWorkflowManualDecision(id: string): Promise<WorkflowManualDecision | undefined> {
    return this.getById(workflow_manual_decisions, workflow_manual_decisions.id, id);
  }

  async saveExecutionReadinessRecord(record: ExecutionReadinessRecord): Promise<void> {
    if ((await this.getExecutionReadinessRecord(record.id)) !== undefined) {
      throw new DomainError('workflow_invalid_transition', `workflow_invalid_transition: Execution readiness record ${record.id} already exists`);
    }
    const workflow = await this.getPlanItemWorkflow(record.workflow_id);
    if (
      workflow === undefined ||
      workflow.development_plan_id !== record.development_plan_id ||
      workflow.development_plan_item_id !== record.development_plan_item_id
    ) {
      throw new DomainError('workflow_invalid_transition', `workflow_invalid_transition: Execution readiness record ${record.id} workflow provenance is invalid`);
    }
    await this.assertWorkflowCodexSessionProvenance(record.workflow_id, record.codex_session_id, `Execution readiness record ${record.id}`);
    await this.db.insert(execution_readiness_records).values(toDbRecord(record, execution_readiness_records) as never);
  }

  async getExecutionReadinessRecord(id: string): Promise<ExecutionReadinessRecord | undefined> {
    return this.getById(execution_readiness_records, execution_readiness_records.id, id);
  }

  async getBoundarySummaryRevisionById(revisionId: string): Promise<BoundarySummaryRevision | undefined> {
    return this.getById(boundary_summary_revisions, boundary_summary_revisions.id, revisionId);
  }

  async resolveWorkflowRepositoryEvidence(
    input: WorkflowRepositoryEvidenceInput,
  ): Promise<{ repository_id: string; resolved_ref: string } | undefined> {
    const workflow = await this.getPlanItemWorkflow(input.workflow_id);
    if (
      workflow === undefined ||
      workflow.development_plan_id !== input.development_plan_id ||
      workflow.development_plan_item_id !== input.development_plan_item_id
    ) {
      return undefined;
    }
    const developmentPlan = await this.getDevelopmentPlan(input.development_plan_id);
    if (developmentPlan === undefined) {
      return undefined;
    }
    const repos = (await this.listProjectRepos(developmentPlan.project_id)).filter((repo) => repo.status !== 'archived');
    if (input.evidence_object_type === 'commit') {
      return /^[0-9a-f]{40}$/i.test(input.evidence_object_id) && repos.length === 1
        ? { repository_id: repos[0]!.id, resolved_ref: input.evidence_object_id.toLowerCase() }
        : undefined;
    }
    const evidence = input.evidence_object_id.trim();
    if (/^\d+$/.test(evidence)) {
      return repos.length === 1 ? { repository_id: repos[0]!.id, resolved_ref: evidence } : undefined;
    }
    const pullRequestUrl = parseGitHubStylePullRequestUrl(evidence);
    if (pullRequestUrl === undefined) {
      return undefined;
    }
    const matchedRepo = repos.find((repo) =>
      [repo.name, repo.remote_url]
        .filter((value): value is string => value !== undefined)
        .map((candidate) => normalizeRepositoryNamespace(candidate))
        .some((namespace) => namespace === pullRequestUrl.namespace),
    );
    return matchedRepo === undefined ? undefined : { repository_id: matchedRepo.id, resolved_ref: evidence };
  }

  async getCodexSession(id: string): Promise<CodexSession | undefined> {
    return this.getById(codex_sessions, codex_sessions.id, id);
  }

  async saveCodexSession(session: CodexSession): Promise<void> {
    const existingSession = await this.getCodexSession(session.id);
    if (existingSession === undefined) {
      throw new DomainError('workflow_invalid_transition', `workflow_invalid_transition: Codex session ${session.id} does not exist`);
    }
    if (
      existingSession.owner_type !== session.owner_type ||
      existingSession.owner_id !== session.owner_id ||
      existingSession.runtime_profile_id !== session.runtime_profile_id ||
      existingSession.runtime_profile_revision_id !== session.runtime_profile_revision_id ||
      existingSession.credential_binding_id !== session.credential_binding_id ||
      existingSession.credential_binding_version_id !== session.credential_binding_version_id ||
      existingSession.created_by_actor_id !== session.created_by_actor_id ||
      existingSession.created_at !== session.created_at
    ) {
      throw new DomainError('workflow_invalid_transition', `workflow_invalid_transition: Codex session ${session.id} identity fields cannot change`);
    }
    if (
      existingSession.forked_from_session_id !== session.forked_from_session_id ||
      existingSession.forked_from_turn_id !== session.forked_from_turn_id ||
      existingSession.forked_from_snapshot_id !== session.forked_from_snapshot_id ||
      existingSession.fork_reason !== session.fork_reason
    ) {
      throw new DomainError('workflow_invalid_transition', `workflow_invalid_transition: Codex session ${session.id} fork provenance fields cannot change`);
    }
    if (
      existingSession.latest_turn_id !== session.latest_turn_id ||
      existingSession.latest_turn_digest !== session.latest_turn_digest ||
      existingSession.latest_snapshot_id !== session.latest_snapshot_id ||
      existingSession.latest_snapshot_digest !== session.latest_snapshot_digest ||
      existingSession.codex_thread_id !== session.codex_thread_id ||
      existingSession.codex_thread_id_digest !== session.codex_thread_id_digest ||
      existingSession.active_lease_id !== session.active_lease_id ||
      existingSession.lease_epoch !== session.lease_epoch ||
      existingSession.runner_worker_id !== session.runner_worker_id ||
      existingSession.runner_launch_lease_id !== session.runner_launch_lease_id ||
      existingSession.runner_runtime_job_id !== session.runner_runtime_job_id ||
      existingSession.runner_expires_at !== session.runner_expires_at ||
      existingSession.archived_at !== session.archived_at
    ) {
      throw new DomainError('workflow_invalid_transition', `workflow_invalid_transition: Codex session ${session.id} service-owned state fields cannot change`);
    }
    if (existingSession.status !== session.status) {
      throw new DomainError('workflow_invalid_transition', `workflow_invalid_transition: Codex session ${session.id} status cannot change through save`);
    }
    if (existingSession.role !== session.role) {
      throw new DomainError('workflow_invalid_transition', `workflow_invalid_transition: Codex session ${session.id} role cannot change through save`);
    }
    await this.assertCanSaveCodexSession(session);
    await this.db.update(codex_sessions).set(toDbRecord(session, codex_sessions) as never).where(eq(codex_sessions.id, session.id));
  }

  async createCodexSessionTurn(turn: CodexSessionTurn): Promise<void> {
    return this.withObjectLock(`codex-session:${turn.codex_session_id}`, async (repository) =>
      (repository as DrizzleDeliveryRepository).createCodexSessionTurnUnlocked(turn),
    );
  }

  private async createCodexSessionTurnUnlocked(turn: CodexSessionTurn): Promise<void> {
    if ((await this.getCodexSessionTurn(turn.id)) !== undefined) {
      throw new DomainError('workflow_invalid_transition', `workflow_invalid_transition: Codex session turn ${turn.id} already exists`);
    }
    if (
      turn.status !== 'running' ||
      turn.output_snapshot_id !== undefined ||
      turn.output_snapshot_digest !== undefined ||
      turn.output_object_type !== undefined ||
      turn.output_object_id !== undefined ||
      turn.codex_thread_id_digest !== undefined ||
      turn.lease_id !== undefined ||
      turn.lease_epoch !== undefined ||
      turn.automation_action_run_id !== undefined ||
      turn.runtime_job_id !== undefined
    ) {
      throw new DomainError('workflow_invalid_transition', `workflow_invalid_transition: Codex session turn ${turn.id} service-owned fields cannot be set at creation`);
    }
    let session = await this.getCodexSession(turn.codex_session_id);
    const workflow = session === undefined ? undefined : await this.getPlanItemWorkflow(session.owner_id);
    if (session !== undefined && workflow !== undefined) {
      const activeLease = session.active_lease_id === undefined ? undefined : await this.getCodexSessionLease(session.active_lease_id);
      const recovered = await this.recoverExpiredActiveCodexSessionLeaseForClaimUnlocked(session, activeLease, turn.created_at);
      if (!recovered.conflict) {
        session = recovered.session;
      }
    }
    if (
      session === undefined ||
      workflow === undefined ||
      session.owner_type !== 'plan_item_workflow' ||
      session.owner_id !== turn.workflow_id ||
      workflow.id !== turn.workflow_id ||
      workflow.active_codex_session_id !== session.id ||
      session.role !== 'active' ||
      !claimableCodexSessionStatuses.has(session.status)
    ) {
      throw new DomainError('workflow_active_session_missing', `workflow_active_session_missing: Codex session ${turn.codex_session_id} is not active for workflow ${turn.workflow_id}`);
    }
    const activeSession = session;
    if (activeSession.latest_snapshot_digest !== turn.expected_previous_snapshot_digest) {
      throw new DomainError('codex_session_snapshot_stale', `codex_session_snapshot_stale: Codex session ${turn.codex_session_id} snapshot is stale`);
    }
    const updatedSession: CodexSession = { ...activeSession, latest_turn_id: turn.id, latest_turn_digest: turn.input_digest, updated_at: turn.updated_at };
    await this.db.insert(codex_session_turns).values(toDbRecord(turn, codex_session_turns) as never);
    await this.db.update(codex_sessions).set(toDbRecord(updatedSession, codex_sessions) as never).where(eq(codex_sessions.id, activeSession.id));
  }

  async getCodexSessionTurn(id: string): Promise<CodexSessionTurn | undefined> {
    return this.getById(codex_session_turns, codex_session_turns.id, id);
  }

  async markCodexSessionRunnerOwner(input: MarkCodexSessionRunnerOwnerInput): Promise<CodexSession> {
    const [row] = await this.db
      .update(codex_sessions)
      .set({
        runnerWorkerId: input.runner_worker_id,
        runnerLaunchLeaseId: input.runner_launch_lease_id,
        runnerRuntimeJobId: input.runner_runtime_job_id,
        runnerExpiresAt: input.runner_expires_at,
        updatedAt: input.now,
      } as never)
      .where(
        and(
          eq(codex_sessions.id, input.session_id),
          or(
            and(
              isNull(codex_sessions.runnerWorkerId),
              isNull(codex_sessions.runnerLaunchLeaseId),
              isNull(codex_sessions.runnerRuntimeJobId),
              isNull(codex_sessions.runnerExpiresAt),
            ),
            and(
              eq(codex_sessions.runnerWorkerId, input.runner_worker_id),
              eq(codex_sessions.runnerLaunchLeaseId, input.runner_launch_lease_id),
              eq(codex_sessions.runnerRuntimeJobId, input.runner_runtime_job_id),
              gt(codex_sessions.runnerExpiresAt, input.now),
            ),
            sql`${codex_sessions.runnerExpiresAt} <= ${input.now}`,
          ),
        ),
      )
      .returning();
    if (row === undefined) {
      throw new DomainError(
        'codex_session_runner_unavailable',
        `codex_session_runner_unavailable: Codex session ${input.session_id} runner owner is unavailable`,
      );
    }
    return fromDbRecord<CodexSession>(row as Record<string, unknown>);
  }

  async clearCodexSessionRunnerOwner(input: ClearCodexSessionRunnerOwnerInput): Promise<CodexSession> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(codex_sessions)
        .set({
          runnerWorkerId: null,
          runnerLaunchLeaseId: null,
          runnerRuntimeJobId: null,
          runnerExpiresAt: null,
          updatedAt: input.now,
        } as never)
        .where(and(eq(codex_sessions.id, input.session_id), eq(codex_sessions.runnerLaunchLeaseId, input.runner_launch_lease_id)))
        .returning();
      if (row === undefined) {
        throw new DomainError(
          'codex_session_runner_unavailable',
          `codex_session_runner_unavailable: Codex session ${input.session_id} runner owner is unavailable`,
        );
      }
      const terminalIdempotencyKey = codexCanonicalDigest({
        kind: 'clear_codex_session_runner_owner',
        session_id: input.session_id,
        runner_launch_lease_id: input.runner_launch_lease_id,
        terminal_reason_code: input.terminal_reason_code,
      });
      const [leaseRow] = await tx
        .update(codex_launch_leases)
        .set({
          status: 'terminal',
          terminalizedAt: input.now,
          terminalReasonCode: input.terminal_reason_code,
          terminalIdempotencyKey: terminalIdempotencyKey,
        } as never)
        .where(
          and(
            eq(codex_launch_leases.id, input.runner_launch_lease_id),
            or(eq(codex_launch_leases.status, 'active'), eq(codex_launch_leases.status, 'materialized')),
            isNull(codex_launch_leases.terminalizedAt),
          ),
        )
        .returning();
      if (leaseRow !== undefined) {
        const lease = fromDbRecord<CodexLaunchLeaseDbRecord>(leaseRow as Record<string, unknown>);
        if (lease.worker_id !== undefined) {
          await this.decrementCodexWorkerLeaseCounts(tx as ForgeloopDrizzleDatabase, [lease.worker_id]);
        }
      }
      return fromDbRecord<CodexSession>(row as Record<string, unknown>);
    });
  }

  async renewCodexSessionRunnerOwner(input: RenewCodexSessionRunnerOwnerInput): Promise<CodexSession> {
    const [row] = await this.db
      .update(codex_sessions)
      .set({
        runnerExpiresAt: input.runner_expires_at,
        updatedAt: input.now,
      } as never)
      .where(
        and(
          eq(codex_sessions.id, input.session_id),
          eq(codex_sessions.runnerWorkerId, input.runner_worker_id),
          eq(codex_sessions.runnerLaunchLeaseId, input.runner_launch_lease_id),
          eq(codex_sessions.runnerRuntimeJobId, input.runner_runtime_job_id),
          gt(codex_sessions.runnerExpiresAt, input.now),
        ),
      )
      .returning();
    if (row === undefined) {
      throw new DomainError(
        'codex_session_runner_unavailable',
        `codex_session_runner_unavailable: Codex session ${input.session_id} runner owner is unavailable`,
      );
    }
    return fromDbRecord<CodexSession>(row as Record<string, unknown>);
  }

  async attachCodexSessionRunnerRuntimeJob(input: AttachCodexSessionRunnerRuntimeJobInput): Promise<CodexRuntimeJob> {
    return this.withAdvisoryLocks(
      [
        `codex-session:${input.session_id}`,
        ...this.codexRuntimeJobStateLockKeys(input.runner_runtime_job_id, input.worker_id),
        ...this.codexRuntimeJobStateLockKeys(input.attached_runtime_job_id, input.worker_id),
        `codex-runtime-lease:${input.runner_launch_lease_id}`,
      ],
      async (repository) => (repository as DrizzleDeliveryRepository).attachCodexSessionRunnerRuntimeJobUnlocked(input),
    );
  }

  private async attachCodexSessionRunnerRuntimeJobUnlocked(input: AttachCodexSessionRunnerRuntimeJobInput): Promise<CodexRuntimeJob> {
    const [sessionRow] = await this.db
      .update(codex_sessions)
      .set({
        runnerExpiresAt: input.runner_expires_at,
        updatedAt: input.now,
      } as never)
      .where(
        and(
          eq(codex_sessions.id, input.session_id),
          eq(codex_sessions.runnerWorkerId, input.worker_id),
          eq(codex_sessions.runnerLaunchLeaseId, input.runner_launch_lease_id),
          eq(codex_sessions.runnerRuntimeJobId, input.runner_runtime_job_id),
          gt(codex_sessions.runnerExpiresAt, input.now),
        ),
      )
      .returning();
    const session = sessionRow === undefined ? undefined : fromDbRecord<CodexSession>(sessionRow as Record<string, unknown>);
    if (session === undefined || session.runner_expires_at === undefined) {
      throw new DomainError(
        'codex_session_runner_unavailable',
        `codex_session_runner_unavailable: Codex session ${input.session_id} runner owner is unavailable`,
      );
    }

    const [existingRow] = await this.db
      .select()
      .from(codex_runtime_jobs)
      .where(eq(codex_runtime_jobs.id, input.attached_runtime_job_id))
      .limit(1);
    if (existingRow === undefined) {
      throw new DomainError(
        'codex_runtime_job_unavailable',
        `codex_runtime_job_unavailable: Codex runtime job ${input.attached_runtime_job_id} is unavailable`,
      );
    }
    const existing = runtimeJobFromDbRecord(fromDbRecord<CodexRuntimeJobDbRecord>(existingRow as Record<string, unknown>));
    const [runnerRow] = await this.db
      .select()
      .from(codex_runtime_jobs)
      .where(eq(codex_runtime_jobs.id, input.runner_runtime_job_id))
      .limit(1);
    const runner = runnerRow === undefined ? undefined : fromDbRecord<CodexRuntimeJobDbRecord>(runnerRow as Record<string, unknown>);
    const [runnerLeaseRow] = await this.db
      .select()
      .from(codex_launch_leases)
      .where(eq(codex_launch_leases.id, input.runner_launch_lease_id))
      .limit(1);
    const runnerLease =
      runnerLeaseRow === undefined ? undefined : fromDbRecord<CodexLaunchLeaseDbRecord>(runnerLeaseRow as Record<string, unknown>);
    if (
      runner === undefined ||
      runnerLease === undefined ||
      !codexSessionRunnerJobHasLiveEvidence(runtimeJobFromDbRecord(runner), input) ||
      runnerLease.id !== input.runner_launch_lease_id ||
      runnerLease.worker_id !== input.worker_id ||
      runnerLease.status !== 'materialized' ||
      runnerLease.expires_at <= input.now ||
      existing.launch_lease_id === input.runner_launch_lease_id ||
      existing.worker_id !== input.worker_id ||
      existing.codex_session_id !== input.session_id ||
      !codexSessionResumeRuntimeJobMatchesAttach(existing, session, input) ||
      existing.status === 'terminal' ||
      existing.cancel_requested_at !== undefined ||
      existing.expires_at <= input.now
    ) {
      throw new DomainError(
        'codex_runtime_job_unavailable',
        `codex_runtime_job_unavailable: Codex runtime job ${input.attached_runtime_job_id} is unavailable`,
      );
    }
    try {
      await this.assertCodexRuntimeJobMaterializationDependencies(runner, runnerLease);
    } catch {
      throw new DomainError(
        'codex_runtime_job_unavailable',
        `codex_runtime_job_unavailable: Codex runtime job ${input.attached_runtime_job_id} runner launch dependencies are unavailable`,
      );
    }
    const [leaseRow] = await this.db
      .select()
      .from(codex_launch_leases)
      .where(eq(codex_launch_leases.id, existing.launch_lease_id))
      .limit(1);
    const lease = leaseRow === undefined ? undefined : fromDbRecord<CodexLaunchLeaseDbRecord>(leaseRow as Record<string, unknown>);
    if (lease === undefined) {
      throw new DomainError(
        'codex_runtime_job_unavailable',
        `codex_runtime_job_unavailable: Codex runtime job ${input.attached_runtime_job_id} is unavailable`,
      );
    }
    if (existing.status === 'running') {
      if (
        existing.status === 'running' &&
        existing.codex_session_id === input.session_id &&
        existing.worker_id === input.worker_id &&
        existing.start_idempotency_key === input.idempotency_key &&
        existing.start_request_digest === input.request_digest &&
        existing.runtime_evidence_digest === input.runtime_evidence_digest &&
        existing.launch_materialization_digest === input.launch_materialization_digest
      ) {
        return existing;
      }
      throw new DomainError(
        'codex_runtime_job_unavailable',
        `codex_runtime_job_unavailable: Codex runtime job ${input.attached_runtime_job_id} is unavailable`,
      );
    }
    if (existing.status !== 'accepted' || lease.status !== 'active' || lease.expires_at <= input.now) {
      throw new DomainError(
        'codex_runtime_job_unavailable',
        `codex_runtime_job_unavailable: Codex runtime job ${input.attached_runtime_job_id} is unavailable`,
      );
    }
    if (!(await this.codexLaunchFenceIsActive(lease, input.now))) {
      throw new DomainError(
        'codex_runtime_job_unavailable',
        `codex_runtime_job_unavailable: Codex runtime job ${input.attached_runtime_job_id} launch fence is unavailable`,
      );
    }
    try {
      await this.assertCodexRuntimeJobMaterializationDependencies(
        fromDbRecord<CodexRuntimeJobDbRecord>(existingRow as Record<string, unknown>),
        lease,
      );
    } catch {
      throw new DomainError(
        'codex_runtime_job_unavailable',
        `codex_runtime_job_unavailable: Codex runtime job ${input.attached_runtime_job_id} launch dependencies are unavailable`,
      );
    }
    const [jobRow] = await this.db
      .update(codex_runtime_jobs)
      .set({
        status: 'running',
        startIdempotencyKey: input.idempotency_key,
        startRequestDigest: input.request_digest,
        runtimeEvidenceDigest: input.runtime_evidence_digest,
        launchMaterializationDigest: input.launch_materialization_digest,
        startedAt: input.now,
        updatedAt: input.now,
      } as never)
      .where(
        and(
          eq(codex_runtime_jobs.id, input.attached_runtime_job_id),
          eq(codex_runtime_jobs.status, 'accepted'),
          eq(codex_runtime_jobs.workerId, input.worker_id),
          eq(codex_runtime_jobs.launchLeaseId, existing.launch_lease_id),
          eq(codex_runtime_jobs.codexSessionId, input.session_id),
          eq(codex_runtime_jobs.inputDigest, existing.input_digest),
          existing.accepted_worker_session_digest === undefined
            ? isNull(codex_runtime_jobs.acceptedWorkerSessionDigest)
            : eq(codex_runtime_jobs.acceptedWorkerSessionDigest, existing.accepted_worker_session_digest),
          existing.codex_session_turn_id === undefined
            ? isNull(codex_runtime_jobs.codexSessionTurnId)
            : eq(codex_runtime_jobs.codexSessionTurnId, existing.codex_session_turn_id),
          gt(codex_runtime_jobs.expiresAt, input.now),
          isNull(codex_runtime_jobs.cancelRequestedAt),
        ),
      )
      .returning();
    const [leaseUpdateRow] = await this.db
      .update(codex_launch_leases)
      .set({ status: 'materialized', materializationRequestHash: input.request_digest, materializedAt: input.now } as never)
      .where(
        and(
          eq(codex_launch_leases.id, existing.launch_lease_id),
          eq(codex_launch_leases.status, 'active'),
          eq(codex_launch_leases.workerId, input.worker_id),
          eq(codex_launch_leases.targetType, lease.target_type),
          eq(codex_launch_leases.targetId, lease.target_id),
          eq(codex_launch_leases.targetKind, lease.target_kind),
          eq(codex_launch_leases.projectId, lease.project_id),
          lease.repo_id === undefined ? isNull(codex_launch_leases.repoId) : eq(codex_launch_leases.repoId, lease.repo_id),
          eq(codex_launch_leases.launchAttempt, lease.launch_attempt),
          eq(codex_launch_leases.runtimeProfileRevisionId, lease.runtime_profile_revision_id),
          eq(codex_launch_leases.runtimeProfileDigest, lease.runtime_profile_digest),
          eq(codex_launch_leases.credentialBindingId, lease.credential_binding_id),
          eq(codex_launch_leases.credentialBindingVersionId, lease.credential_binding_version_id),
          eq(codex_launch_leases.credentialPayloadDigest, lease.credential_payload_digest),
          eq(codex_launch_leases.dockerImageDigest, lease.docker_image_digest),
          eq(codex_launch_leases.networkPolicyDigest, lease.network_policy_digest),
          lease.network_provider_config_digest === undefined
            ? isNull(codex_launch_leases.networkProviderConfigDigest)
            : eq(codex_launch_leases.networkProviderConfigDigest, lease.network_provider_config_digest),
          lease.run_worker_lease_id === undefined
            ? isNull(codex_launch_leases.runWorkerLeaseId)
            : eq(codex_launch_leases.runWorkerLeaseId, lease.run_worker_lease_id),
          lease.run_worker_lease_token_hash === undefined
            ? isNull(codex_launch_leases.runWorkerLeaseTokenHash)
            : eq(codex_launch_leases.runWorkerLeaseTokenHash, lease.run_worker_lease_token_hash),
          lease.run_session_status === undefined
            ? isNull(codex_launch_leases.runSessionStatus)
            : eq(codex_launch_leases.runSessionStatus, lease.run_session_status),
          lease.run_session_updated_at === undefined
            ? isNull(codex_launch_leases.runSessionUpdatedAt)
            : eq(codex_launch_leases.runSessionUpdatedAt, lease.run_session_updated_at),
          lease.execution_package_version === undefined
            ? isNull(codex_launch_leases.executionPackageVersion)
            : eq(codex_launch_leases.executionPackageVersion, lease.execution_package_version),
          gt(codex_launch_leases.expiresAt, input.now),
        ),
      )
      .returning();
    if (jobRow === undefined || leaseUpdateRow === undefined) {
      throw new DomainError(
        'codex_runtime_job_unavailable',
        `codex_runtime_job_unavailable: Codex runtime job ${input.attached_runtime_job_id} is unavailable`,
      );
    }
    return runtimeJobFromDbRecord(fromDbRecord<CodexRuntimeJobDbRecord>(jobRow as Record<string, unknown>));
  }

  async saveCodexSessionTurn(turn: CodexSessionTurn): Promise<void> {
    const existingTurn = await this.getCodexSessionTurn(turn.id);
    if (existingTurn === undefined) {
      throw new DomainError('workflow_invalid_transition', `workflow_invalid_transition: Codex session turn ${turn.id} does not exist`);
    }
    if (
      existingTurn.codex_session_id !== turn.codex_session_id ||
      existingTurn.workflow_id !== turn.workflow_id ||
      existingTurn.intent !== turn.intent ||
      existingTurn.input_digest !== turn.input_digest ||
      existingTurn.expected_previous_snapshot_digest !== turn.expected_previous_snapshot_digest ||
      existingTurn.output_snapshot_id !== turn.output_snapshot_id ||
      existingTurn.output_snapshot_digest !== turn.output_snapshot_digest ||
      existingTurn.lease_id !== turn.lease_id ||
      existingTurn.lease_epoch !== turn.lease_epoch ||
      existingTurn.created_at !== turn.created_at ||
      existingTurn.created_by_actor_id !== turn.created_by_actor_id ||
      existingTurn.output_object_type !== turn.output_object_type ||
      existingTurn.output_object_id !== turn.output_object_id ||
      existingTurn.codex_thread_id_digest !== turn.codex_thread_id_digest ||
      existingTurn.automation_action_run_id !== turn.automation_action_run_id ||
      existingTurn.runtime_job_id !== turn.runtime_job_id
    ) {
      throw new DomainError('workflow_invalid_transition', `workflow_invalid_transition: Codex session turn ${turn.id} identity fields cannot change`);
    }
    if (existingTurn.status !== turn.status) {
      throw new DomainError('workflow_invalid_transition', `workflow_invalid_transition: Codex session turn ${turn.id} status cannot change through save`);
    }
    await this.db.update(codex_session_turns).set(toDbRecord(turn, codex_session_turns) as never).where(eq(codex_session_turns.id, turn.id));
  }

  async markCodexSessionTurnStale(input: { session_id: string; turn_id: string; now: string }): Promise<void> {
    const turn = await this.getCodexSessionTurn(input.turn_id);
    if (turn === undefined || turn.codex_session_id !== input.session_id) {
      throw new DomainError(
        'codex_session_stale_terminalization',
        `codex_session_stale_terminalization: Codex session turn ${input.turn_id} does not belong to session ${input.session_id}`,
      );
    }
    if (turn.status !== 'running') return;
    await this.db
      .update(codex_session_turns)
      .set({
        status: 'stale',
        outputSnapshotId: null,
        outputSnapshotDigest: null,
        codexThreadIdDigest: null,
        updatedAt: input.now,
      } as never)
      .where(
        and(
          eq(codex_session_turns.id, input.turn_id),
          eq(codex_session_turns.codexSessionId, input.session_id),
          eq(codex_session_turns.status, 'running'),
        ),
      );
  }

  async createCodexSessionSnapshot(snapshot: CodexSessionSnapshot): Promise<void> {
    if ((await this.getCodexSession(snapshot.codex_session_id)) === undefined) {
      throw new DomainError('workflow_invalid_transition', `workflow_invalid_transition: Codex session snapshot ${snapshot.id} session ${snapshot.codex_session_id} does not exist`);
    }
    const sourceTurn = snapshot.created_from_turn_id === undefined ? undefined : await this.getCodexSessionTurn(snapshot.created_from_turn_id);
    if (sourceTurn === undefined || sourceTurn.codex_session_id !== snapshot.codex_session_id) {
      throw new DomainError('codex_session_snapshot_stale', `codex_session_snapshot_stale: Codex session snapshot ${snapshot.id} source turn is stale`);
    }
    let parsedArtifactRef: ReturnType<typeof parseInternalArtifactRef>;
    try {
      parsedArtifactRef = parseInternalArtifactRef(snapshot.artifact_ref);
    } catch {
      throw new DomainError('workflow_invalid_transition', `workflow_invalid_transition: Codex session snapshot ${snapshot.id} artifact_ref is not an internal artifact ref`);
    }
    if (
      parsedArtifactRef.kind !== 'codex_session_snapshot' ||
      parsedArtifactRef.owner_type !== 'codex_session' ||
      parsedArtifactRef.owner_id !== snapshot.codex_session_id ||
      parsedArtifactRef.artifact_id !== snapshot.id
    ) {
      throw new DomainError('workflow_invalid_transition', `workflow_invalid_transition: Codex session snapshot ${snapshot.id} artifact_ref does not match the snapshot identity`);
    }
    const [existingForSequence] = await this.db
      .select()
      .from(codex_session_snapshots)
      .where(and(eq(codex_session_snapshots.codexSessionId, snapshot.codex_session_id), eq(codex_session_snapshots.sequence, snapshot.sequence)))
      .limit(1);
    const [existingForArtifact] = await this.db
      .select()
      .from(codex_session_snapshots)
      .where(eq(codex_session_snapshots.artifactRef, snapshot.artifact_ref))
      .limit(1);
    const maxSequenceResult = await this.db.execute(sql<{ max_sequence: number | null }>`
      select max(sequence) as max_sequence from codex_session_snapshots where codex_session_id = ${snapshot.codex_session_id}
    `);
    const maxExistingSequence = Number(maxSequenceResult.rows[0]?.max_sequence ?? 0);
    if ((await this.getCodexSessionSnapshot(snapshot.id)) !== undefined || existingForSequence !== undefined || existingForArtifact !== undefined) {
      throw new DomainError('workflow_invalid_transition', `workflow_invalid_transition: Codex session snapshot ${snapshot.id} is not unique`);
    }
    if (snapshot.sequence <= maxExistingSequence) {
      throw new DomainError('workflow_invalid_transition', `workflow_invalid_transition: Codex session snapshot ${snapshot.id} sequence is stale`);
    }
    await this.db.insert(codex_session_snapshots).values(toDbRecord(snapshot, codex_session_snapshots) as never);
  }

  async getCodexSessionSnapshot(id: string): Promise<CodexSessionSnapshot | undefined> {
    return this.getById(codex_session_snapshots, codex_session_snapshots.id, id);
  }

  async saveStaleCodexSessionTerminalizationAttempt(attempt: CodexSessionStaleTerminalizationAttempt): Promise<void> {
    if ((await this.getById(codex_session_stale_terminalization_attempts, codex_session_stale_terminalization_attempts.id, attempt.id)) !== undefined) {
      throw new DomainError('workflow_invalid_transition', `workflow_invalid_transition: Codex session stale terminalization attempt ${attempt.id} already exists`);
    }
    const session = await this.getCodexSession(attempt.codex_session_id);
    if (session === undefined) {
      throw new DomainError('workflow_invalid_transition', `workflow_invalid_transition: Codex session stale terminalization attempt ${attempt.id} session provenance is invalid`);
    }
    if (attempt.codex_session_turn_id !== undefined) {
      const turn = await this.getCodexSessionTurn(attempt.codex_session_turn_id);
      if (turn === undefined || turn.codex_session_id !== attempt.codex_session_id) {
        throw new DomainError('workflow_invalid_transition', `workflow_invalid_transition: Codex session stale terminalization attempt ${attempt.id} turn provenance is invalid`);
      }
    }
    if (attempt.lease_id !== undefined) {
      const lease = await this.getCodexSessionLease(attempt.lease_id);
      if (lease === undefined || lease.codex_session_id !== attempt.codex_session_id) {
        throw new DomainError('workflow_invalid_transition', `workflow_invalid_transition: Codex session stale terminalization attempt ${attempt.id} lease provenance is invalid`);
      }
    }
    await this.db
      .insert(codex_session_stale_terminalization_attempts)
      .values(toDbRecord(attempt, codex_session_stale_terminalization_attempts) as never);
  }

  async listStaleCodexSessionTerminalizationAttempts(sessionId: string): Promise<CodexSessionStaleTerminalizationAttempt[]> {
    return this.listWhere<CodexSessionStaleTerminalizationAttempt>(
      codex_session_stale_terminalization_attempts,
      eq(codex_session_stale_terminalization_attempts.codexSessionId, sessionId),
      [codex_session_stale_terminalization_attempts.createdAt, codex_session_stale_terminalization_attempts.id],
    );
  }

  async claimCodexSessionLease(input: ClaimCodexSessionLeaseInput): Promise<{ session: CodexSession; lease: CodexSessionLease }> {
    return this.withObjectLock(`codex-session:${input.session_id}`, async (repository) =>
      (repository as DrizzleDeliveryRepository).claimCodexSessionLeaseUnlocked(input),
    );
  }

  private async claimCodexSessionLeaseUnlocked(input: ClaimCodexSessionLeaseInput): Promise<{ session: CodexSession; lease: CodexSessionLease }> {
    if ((await this.getCodexSessionLease(input.lease_id)) !== undefined) {
      throw new DomainError('codex_session_lease_conflict', `codex_session_lease_conflict: Codex session lease ${input.lease_id} is not unique`);
    }
    let session = await this.getCodexSession(input.session_id);
    const workflow = session === undefined ? undefined : await this.getPlanItemWorkflow(session.owner_id);
    const cannotClaim =
      session === undefined ||
      workflow === undefined ||
      session.owner_type !== 'plan_item_workflow' ||
      session.owner_id !== input.workflow_id ||
      workflow.id !== input.workflow_id ||
      session.role !== 'active' ||
      workflow.active_codex_session_id !== session.id;
    if (cannotClaim) {
      throw new DomainError('codex_session_lease_conflict', `codex_session_lease_conflict: Codex session ${input.session_id} cannot be claimed`);
    }
    if (session === undefined) {
      throw new DomainError('codex_session_lease_conflict', `codex_session_lease_conflict: Codex session ${input.session_id} cannot be claimed`);
    }
    const activeLease = await this.findActiveCodexSessionLease(session.id);
    if (session.latest_snapshot_digest !== input.expected_previous_snapshot_digest) {
      if (activeLease !== undefined || session.active_lease_id !== undefined) {
        throw new DomainError('codex_session_lease_conflict', `codex_session_lease_conflict: Codex session ${input.session_id} cannot be claimed`);
      }
      throw new DomainError('codex_session_snapshot_stale', `codex_session_snapshot_stale: Codex session ${input.session_id} snapshot is stale`);
    }
    const recovered = await this.recoverExpiredActiveCodexSessionLeaseForClaimUnlocked(session, activeLease, input.now);
    session = recovered.session;
    if (recovered.conflict) {
      throw new DomainError('codex_session_lease_conflict', `codex_session_lease_conflict: Codex session ${input.session_id} cannot be claimed`);
    }
    if (!claimableCodexSessionStatuses.has(session.status)) {
      throw new DomainError('codex_session_lease_conflict', `codex_session_lease_conflict: Codex session ${input.session_id} cannot be claimed`);
    }
    const leaseEpoch = session.lease_epoch + 1;
    const lease: CodexSessionLease = {
      id: input.lease_id,
      codex_session_id: session.id,
      lease_token_hash: input.lease_token_hash,
      lease_epoch: leaseEpoch,
      worker_id: input.worker_id,
      worker_session_digest: input.worker_session_digest,
      status: 'active',
      acquired_at: input.now,
      expires_at: input.expires_at,
      created_at: input.now,
      updated_at: input.now,
    };
    const updatedSession: CodexSession = {
      ...session,
      status: 'running',
      active_lease_id: lease.id,
      lease_epoch: leaseEpoch,
      updated_at: input.now,
    };
    await this.db.insert(codex_session_leases).values(toDbRecord(lease, codex_session_leases) as never);
    await this.db.update(codex_sessions).set(toDbRecord(updatedSession, codex_sessions) as never).where(eq(codex_sessions.id, session.id));
    return { session: updatedSession, lease };
  }

  async recoverCodexSessionLeaseForClaim(
    input: RecoverCodexSessionLeaseForClaimInput,
  ): Promise<{ session: CodexSession; lease: CodexSessionLease }> {
    return this.withObjectLock(`codex-session:${input.session_id}`, async (repository) =>
      (repository as DrizzleDeliveryRepository).recoverCodexSessionLeaseForClaimUnlocked(input),
    );
  }

  private async recoverCodexSessionLeaseForClaimUnlocked(
    input: RecoverCodexSessionLeaseForClaimInput,
  ): Promise<{ session: CodexSession; lease: CodexSessionLease }> {
    const session = await this.getCodexSession(input.session_id);
    const workflow = session === undefined ? undefined : await this.getPlanItemWorkflow(session.owner_id);
    const lease = await this.getCodexSessionLease(input.lease_id);
    if (
      session === undefined ||
      workflow === undefined ||
      lease === undefined ||
      session.owner_type !== 'plan_item_workflow' ||
      session.owner_id !== input.workflow_id ||
      workflow.id !== input.workflow_id ||
      session.role !== 'active' ||
      workflow.active_codex_session_id !== session.id ||
      session.status !== 'running' ||
      session.active_lease_id !== lease.id ||
      session.lease_epoch !== input.lease_epoch ||
      lease.codex_session_id !== session.id ||
      lease.status !== 'active' ||
      lease.lease_token_hash !== input.lease_token_hash ||
      lease.worker_id !== input.worker_id ||
      lease.worker_session_digest !== input.worker_session_digest ||
      lease.lease_epoch !== input.lease_epoch
    ) {
      throw new DomainError('codex_session_lease_conflict', `codex_session_lease_conflict: Codex session lease ${input.lease_id} cannot be recovered`);
    }
    if (session.latest_snapshot_digest !== input.expected_previous_snapshot_digest) {
      throw new DomainError('codex_session_snapshot_stale', `codex_session_snapshot_stale: Codex session ${input.session_id} snapshot is stale`);
    }
    if (lease.expires_at > input.now) {
      throw new DomainError('codex_session_lease_conflict', `codex_session_lease_conflict: Codex session lease ${input.lease_id} is not stale`);
    }
    const fencedLease: CodexSessionLease = { ...lease, status: 'fenced', fenced_at: input.now, updated_at: input.now };
    const { active_lease_id: _activeLeaseId, ...sessionWithoutActiveLease } = session;
    const recoveredSession: CodexSession = { ...sessionWithoutActiveLease, status: 'recovering', updated_at: input.now };
    await this.db.update(codex_session_leases).set(toDbRecord(fencedLease, codex_session_leases) as never).where(eq(codex_session_leases.id, lease.id));
    await this.db.update(codex_sessions).set(toDbRecord(recoveredSession, codex_sessions) as never).where(eq(codex_sessions.id, session.id));
    return { session: recoveredSession, lease: fencedLease };
  }

  private async recoverExpiredActiveCodexSessionLeaseForClaimUnlocked(
    session: CodexSession,
    activeLease: CodexSessionLease | undefined,
    now: string,
  ): Promise<{ session: CodexSession; conflict: boolean }> {
    const leaseId = activeLease?.id ?? session.active_lease_id;
    if (leaseId === undefined) {
      return { session, conflict: false };
    }
    const lease = activeLease ?? await this.getCodexSessionLease(leaseId);
    if (
      lease === undefined ||
      lease.codex_session_id !== session.id ||
      lease.status !== 'active' ||
      session.active_lease_id !== lease.id ||
      session.status !== 'running' ||
      lease.expires_at > now
    ) {
      return { session, conflict: true };
    }
    const fencedLease: CodexSessionLease = { ...lease, status: 'fenced', fenced_at: now, updated_at: now };
    const { active_lease_id: _activeLeaseId, ...sessionWithoutActiveLease } = session;
    const recoveredSession: CodexSession = { ...sessionWithoutActiveLease, status: 'recovering', updated_at: now };
    await this.db.update(codex_session_leases).set(toDbRecord(fencedLease, codex_session_leases) as never).where(eq(codex_session_leases.id, lease.id));
    await this.db.update(codex_sessions).set(toDbRecord(recoveredSession, codex_sessions) as never).where(eq(codex_sessions.id, session.id));
    return { session: recoveredSession, conflict: false };
  }

  async renewCodexSessionLease(input: RenewCodexSessionLeaseInput): Promise<CodexSessionLease> {
    return this.withObjectLock(`codex-session:${input.session_id}`, async (repository) =>
      (repository as DrizzleDeliveryRepository).renewCodexSessionLeaseUnlocked(input),
    );
  }

  private async renewCodexSessionLeaseUnlocked(input: RenewCodexSessionLeaseInput): Promise<CodexSessionLease> {
    const lease = await this.getCodexSessionLease(input.lease_id);
    const session = await this.getCodexSession(input.session_id);
    if (
      lease === undefined ||
      session === undefined ||
      lease.codex_session_id !== input.session_id ||
      session.active_lease_id !== lease.id ||
      lease.status !== 'active' ||
      lease.lease_token_hash !== input.lease_token_hash ||
      lease.worker_id !== input.worker_id ||
      lease.worker_session_digest !== input.worker_session_digest ||
      lease.lease_epoch !== input.lease_epoch
    ) {
      throw new DomainError('codex_session_lease_conflict', `codex_session_lease_conflict: Codex session lease ${input.lease_id} cannot be renewed`);
    }
    if (lease.expires_at <= input.now) {
      throw new DomainError('codex_session_lease_expired', `codex_session_lease_expired: Codex session lease ${input.lease_id} has expired`);
    }
    const renewed: CodexSessionLease = { ...lease, heartbeat_at: input.now, expires_at: input.expires_at, updated_at: input.now };
    const [updated] = await this.db
      .update(codex_session_leases)
      .set(toDbRecord(renewed, codex_session_leases) as never)
      .where(
        and(
          eq(codex_session_leases.id, renewed.id),
          eq(codex_session_leases.codexSessionId, input.session_id),
          eq(codex_session_leases.status, 'active'),
          eq(codex_session_leases.leaseTokenHash, input.lease_token_hash),
          eq(codex_session_leases.workerId, input.worker_id),
          eq(codex_session_leases.workerSessionDigest, input.worker_session_digest),
          eq(codex_session_leases.leaseEpoch, input.lease_epoch),
          gt(codex_session_leases.expiresAt, input.now),
        ),
      )
      .returning();
    if (updated === undefined) {
      throw new DomainError('codex_session_lease_conflict', `codex_session_lease_conflict: Codex session lease ${input.lease_id} cannot be renewed`);
    }
    return fromDbRecord<CodexSessionLease>(updated);
  }

  async terminalizeCodexSessionTurn(input: TerminalizeCodexSessionTurnInput): Promise<{ session: CodexSession; turn: CodexSessionTurn }> {
    return this.withObjectLock(`codex-session:${input.session_id}`, async (repository) =>
      (repository as DrizzleDeliveryRepository).terminalizeCodexSessionTurnUnlocked(input),
    );
  }

  private async terminalizeCodexSessionTurnUnlocked(input: TerminalizeCodexSessionTurnInput): Promise<{ session: CodexSession; turn: CodexSessionTurn }> {
    const session = await this.getCodexSession(input.session_id);
    const turn = await this.getCodexSessionTurn(input.turn_id);
    const lease = await this.getCodexSessionLease(input.lease_id);
    if (
      session === undefined ||
      turn === undefined ||
      lease === undefined ||
      turn.codex_session_id !== session.id ||
      session.latest_turn_id !== turn.id ||
      session.latest_turn_digest !== turn.input_digest ||
      turn.status !== 'running' ||
      lease.codex_session_id !== session.id ||
      session.active_lease_id !== lease.id ||
      lease.status !== 'active' ||
      lease.lease_token_hash !== input.lease_token_hash ||
      lease.worker_id !== input.worker_id ||
      lease.worker_session_digest !== input.worker_session_digest ||
      lease.lease_epoch !== input.lease_epoch ||
      session.lease_epoch !== input.lease_epoch ||
      session.latest_snapshot_digest !== input.expected_previous_snapshot_digest ||
      turn.expected_previous_snapshot_digest !== input.expected_previous_snapshot_digest
    ) {
      throw new DomainError('codex_session_stale_terminalization', `codex_session_stale_terminalization: Codex session ${input.session_id} terminalization is stale`);
    }
    if (lease.expires_at <= input.now) {
      throw new DomainError('codex_session_lease_expired', `codex_session_lease_expired: Codex session lease ${input.lease_id} has expired`);
    }
    if (input.output_snapshot !== undefined && input.output_snapshot.codex_session_id !== session.id) {
      throw new DomainError('codex_session_snapshot_stale', `codex_session_snapshot_stale: Output snapshot does not belong to session ${session.id}`);
    }
    if (input.output_snapshot !== undefined && input.output_snapshot.created_from_turn_id !== input.turn_id) {
      throw new DomainError('codex_session_snapshot_stale', `codex_session_snapshot_stale: Output snapshot ${input.output_snapshot.id} does not belong to turn ${input.turn_id}`);
    }
    const existingOutputSnapshot = input.output_snapshot === undefined ? undefined : await this.getCodexSessionSnapshot(input.output_snapshot.id);
    if (existingOutputSnapshot !== undefined && existingOutputSnapshot.created_from_turn_id !== input.turn_id) {
      throw new DomainError('codex_session_snapshot_stale', `codex_session_snapshot_stale: Output snapshot ${existingOutputSnapshot.id} does not belong to turn ${input.turn_id}`);
    }
    if (
      input.output_snapshot !== undefined &&
      existingOutputSnapshot !== undefined &&
      !codexSessionSnapshotDurableIdentityMatches(existingOutputSnapshot, input.output_snapshot)
    ) {
      throw new DomainError('codex_session_snapshot_stale', `codex_session_snapshot_stale: Output snapshot ${input.output_snapshot.id} durable identity is stale`);
    }
    const hasThreadIdInput = input.codex_thread_id !== undefined;
    const hasThreadDigestInput = input.codex_thread_id_digest !== undefined;
    if (input.app_server_thread_binding_required === true && (!hasThreadIdInput || !hasThreadDigestInput)) {
      throw new DomainError(
        'codex_app_server_thread_id_missing',
        `codex_app_server_thread_id_missing: Codex session ${input.session_id} app-server terminalization requires thread id and digest`,
      );
    }
    if (hasThreadIdInput !== hasThreadDigestInput) {
      throw new DomainError('codex_session_thread_binding_stale', `codex_session_thread_binding_stale: Codex session ${input.session_id} thread binding is incomplete`);
    }
    const hasSessionThreadId = session.codex_thread_id !== undefined;
    const hasSessionThreadDigest = session.codex_thread_id_digest !== undefined;
    const terminalizationAttemptsThreadBinding = hasThreadIdInput || hasThreadDigestInput || input.status === 'succeeded';
    if (hasSessionThreadId !== hasSessionThreadDigest && terminalizationAttemptsThreadBinding) {
      throw new DomainError('codex_session_thread_binding_stale', `codex_session_thread_binding_stale: Codex session ${input.session_id} has a partial thread binding`);
    }
    if (hasThreadIdInput && hasThreadDigestInput) {
      if (hasSessionThreadId !== hasSessionThreadDigest) {
        throw new DomainError('codex_session_thread_binding_stale', `codex_session_thread_binding_stale: Codex session ${input.session_id} has a partial thread binding`);
      }
      if (
        hasSessionThreadId &&
        hasSessionThreadDigest &&
        (session.codex_thread_id !== input.codex_thread_id || session.codex_thread_id_digest !== input.codex_thread_id_digest)
      ) {
        throw new DomainError('codex_session_thread_binding_stale', `codex_session_thread_binding_stale: Codex session ${input.session_id} thread binding is stale`);
      }
    }
    const outputSnapshot = existingOutputSnapshot ?? input.output_snapshot;
    const releasedLease: CodexSessionLease = { ...lease, status: 'released', released_at: input.now, updated_at: input.now };
    const updatedTurn: CodexSessionTurn = {
      ...turn,
      status: input.status,
      ...(outputSnapshot === undefined ? {} : { output_snapshot_id: outputSnapshot.id, output_snapshot_digest: outputSnapshot.digest }),
      ...(input.output_object_type === undefined ? {} : { output_object_type: input.output_object_type }),
      ...(input.output_object_id === undefined ? {} : { output_object_id: input.output_object_id }),
      ...(input.codex_thread_id_digest === undefined ? {} : { codex_thread_id_digest: input.codex_thread_id_digest }),
      lease_id: lease.id,
      lease_epoch: lease.lease_epoch,
      updated_at: input.now,
    };
    const { active_lease_id: _activeLeaseId, ...sessionWithoutActiveLease } = session;
    const updatedSession: CodexSession = {
      ...sessionWithoutActiveLease,
      status: input.status === 'succeeded' ? 'idle' : 'blocked',
      latest_turn_id: updatedTurn.id,
      latest_turn_digest: updatedTurn.output_snapshot_digest ?? updatedTurn.input_digest,
      ...(outputSnapshot === undefined ? {} : { latest_snapshot_id: outputSnapshot.id, latest_snapshot_digest: outputSnapshot.digest }),
      ...(input.codex_thread_id === undefined ? {} : { codex_thread_id: input.codex_thread_id }),
      ...(input.codex_thread_id_digest === undefined ? {} : { codex_thread_id_digest: input.codex_thread_id_digest }),
      updated_at: input.now,
    };
    if (input.output_snapshot !== undefined && existingOutputSnapshot === undefined) {
      await this.createCodexSessionSnapshot(input.output_snapshot);
    }
    await this.db.update(codex_session_leases).set(toDbRecord(releasedLease, codex_session_leases) as never).where(eq(codex_session_leases.id, releasedLease.id));
    await this.db.update(codex_session_turns).set(toDbRecord(updatedTurn, codex_session_turns) as never).where(eq(codex_session_turns.id, updatedTurn.id));
    await this.db.update(codex_sessions).set(toDbRecord(updatedSession, codex_sessions) as never).where(eq(codex_sessions.id, updatedSession.id));
    return { session: updatedSession, turn: updatedTurn };
  }

  async createCodexSessionFork(input: CreateCodexSessionForkInput): Promise<CodexSession> {
    return this.withObjectLock(`plan-item-workflow:${input.workflow_id}`, async (repository) =>
      (repository as DrizzleDeliveryRepository).createCodexSessionForkUnlocked(input),
    );
  }

  private async createCodexSessionForkUnlocked(input: CreateCodexSessionForkInput): Promise<CodexSession> {
    const workflow = await this.getPlanItemWorkflow(input.workflow_id);
    const parent = await this.getCodexSession(input.parent_session_id);
    const forkTurn = input.forked_from_turn_id === undefined ? undefined : await this.getCodexSessionTurn(input.forked_from_turn_id);
    const forkSnapshot = input.forked_from_snapshot_id === undefined ? undefined : await this.getCodexSessionSnapshot(input.forked_from_snapshot_id);
    if (
      workflow === undefined ||
      parent === undefined ||
      parent.owner_id !== workflow.id ||
      parent.status === 'archived' ||
      (await this.getCodexSession(input.id)) !== undefined ||
      (input.forked_from_turn_id === undefined && input.forked_from_snapshot_id === undefined) ||
      (input.forked_from_turn_id !== undefined && (forkTurn === undefined || forkTurn.codex_session_id !== parent.id)) ||
      (input.forked_from_snapshot_id !== undefined && (forkSnapshot === undefined || forkSnapshot.codex_session_id !== parent.id)) ||
      (forkTurn !== undefined &&
        forkSnapshot !== undefined &&
        (forkTurn.output_snapshot_id !== forkSnapshot.id || forkTurn.output_snapshot_digest !== forkSnapshot.digest))
    ) {
      throw new DomainError('codex_session_fork_invalid', `codex_session_fork_invalid: Cannot fork Codex session ${input.parent_session_id}`);
    }
    const forkTurnOutputSnapshot =
      forkTurn?.output_snapshot_id === undefined ? undefined : await this.getCodexSessionSnapshot(forkTurn.output_snapshot_id);
    if (
      forkTurn !== undefined &&
      (forkTurn.output_snapshot_id !== undefined || forkTurn.output_snapshot_digest !== undefined) &&
      (forkTurn.output_snapshot_id === undefined ||
        forkTurn.output_snapshot_digest === undefined ||
        forkTurnOutputSnapshot === undefined ||
        forkTurnOutputSnapshot.codex_session_id !== parent.id ||
        forkTurnOutputSnapshot.digest !== forkTurn.output_snapshot_digest ||
        forkTurnOutputSnapshot.created_from_turn_id !== forkTurn.id)
    ) {
      throw new DomainError('codex_session_fork_invalid', `codex_session_fork_invalid: Cannot fork Codex session ${input.parent_session_id}`);
    }
    const forkOutputSnapshot =
      forkSnapshot ??
      (forkTurn?.output_snapshot_id === undefined || forkTurn.output_snapshot_digest === undefined ? undefined : forkTurnOutputSnapshot);
    const forkLatestSnapshot =
      forkOutputSnapshot !== undefined &&
      forkOutputSnapshot.codex_session_id === parent.id &&
      forkOutputSnapshot.digest === (forkSnapshot?.digest ?? forkTurn?.output_snapshot_digest)
        ? forkOutputSnapshot
        : undefined;
    const {
      active_lease_id: _forkActiveLeaseId,
      latest_turn_id: _forkLatestTurnId,
      latest_turn_digest: _forkLatestTurnDigest,
      latest_snapshot_id: _forkLatestSnapshotId,
      latest_snapshot_digest: _forkLatestSnapshotDigest,
      forked_from_turn_id: _parentForkedFromTurnId,
      forked_from_snapshot_id: _parentForkedFromSnapshotId,
      codex_thread_id: _parentCodexThreadId,
      codex_thread_id_digest: _parentCodexThreadIdDigest,
      archived_at: _forkArchivedAt,
      ...forkBase
    } = parent;
    const fork: CodexSession = {
      ...forkBase,
      id: input.id,
      status: 'idle',
      role: 'candidate_fork',
      lease_epoch: 0,
      forked_from_session_id: parent.id,
      ...(input.forked_from_turn_id === undefined ? {} : { forked_from_turn_id: input.forked_from_turn_id }),
      ...(input.forked_from_snapshot_id === undefined ? {} : { forked_from_snapshot_id: input.forked_from_snapshot_id }),
      ...(forkLatestSnapshot === undefined ? {} : { latest_snapshot_id: forkLatestSnapshot.id, latest_snapshot_digest: forkLatestSnapshot.digest }),
      fork_reason: input.fork_reason,
      created_by_actor_id: input.created_by_actor_id,
      created_at: input.now,
      updated_at: input.now,
    };
    await this.assertCanSaveCodexSession(fork);
    await this.db.insert(codex_sessions).values(toDbRecord(fork, codex_sessions) as never);
    return fork;
  }

  async selectActiveCodexSessionFork(
    input: SelectActiveCodexSessionForkInput,
  ): Promise<{ workflow: PlanItemWorkflow; selectedSession: CodexSession }> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const workflow = await this.getPlanItemWorkflow(input.workflow_id);
      const previousActiveSessionId = workflow?.active_codex_session_id;
      const result = await this.withAdvisoryLocks(
        [
          `plan-item-workflow:${input.workflow_id}`,
          `codex-session:${input.selected_codex_session_id}`,
          ...(previousActiveSessionId === undefined ? [] : [`codex-session:${previousActiveSessionId}`]),
        ],
        async (repository) => {
          const lockedRepository = repository as DrizzleDeliveryRepository;
          const lockedWorkflow = await lockedRepository.getPlanItemWorkflow(input.workflow_id);
          if (lockedWorkflow?.active_codex_session_id !== previousActiveSessionId) {
            return { type: 'retry' } as const;
          }
          return {
            type: 'selected',
            result: await lockedRepository.selectActiveCodexSessionForkUnlocked(input),
          } as const;
        },
      );
      if (result.type === 'selected') {
        return result.result;
      }
    }
    throw new DomainError(
      'codex_session_fork_invalid',
      `codex_session_fork_invalid: Workflow ${input.workflow_id} active Codex session changed while selecting a fork`,
    );
  }

  private async selectActiveCodexSessionForkUnlocked(
    input: SelectActiveCodexSessionForkInput,
  ): Promise<{ workflow: PlanItemWorkflow; selectedSession: CodexSession }> {
    const workflow = await this.getPlanItemWorkflow(input.workflow_id);
    const selected = await this.getCodexSession(input.selected_codex_session_id);
    const previousActive = workflow?.active_codex_session_id === undefined ? undefined : await this.getCodexSession(workflow.active_codex_session_id);
    if (
      workflow === undefined ||
      selected === undefined ||
      previousActive === undefined ||
      selected.owner_id !== workflow.id ||
      previousActive.owner_id !== workflow.id ||
      selected.id === previousActive.id ||
      (selected.role !== 'candidate_fork' && selected.role !== 'inactive_fork') ||
      selected.status === 'archived' ||
      previousActive.status === 'archived' ||
      selected.status === 'running' ||
      previousActive.status === 'running' ||
      (await this.findActiveCodexSessionLease(selected.id)) !== undefined ||
      (await this.findActiveCodexSessionLease(previousActive.id)) !== undefined ||
      selected.active_lease_id !== undefined ||
      previousActive.active_lease_id !== undefined
    ) {
      throw new DomainError('codex_session_fork_invalid', `codex_session_fork_invalid: Cannot select Codex session fork ${input.selected_codex_session_id}`);
    }
    if ((await this.getWorkflowManualDecision(input.manual_decision_id)) !== undefined || (await this.getPlanItemWorkflowTransition(input.transition_id)) !== undefined) {
      throw new DomainError('workflow_invalid_transition', `workflow_invalid_transition: Fork selection ${input.transition_id} already exists`);
    }
    const inactivePrevious: CodexSession = { ...previousActive, role: 'inactive_fork', updated_at: input.now };
    const activeSelected: CodexSession = { ...selected, role: 'active', updated_at: input.now };
    const updatedWorkflow: PlanItemWorkflow = { ...workflow, active_codex_session_id: activeSelected.id, updated_at: input.now };
    const manualDecision: WorkflowManualDecision = {
      id: input.manual_decision_id,
      workflow_id: workflow.id,
      codex_session_id: previousActive.id,
      kind: 'fork_select',
      reason: input.reason,
      selected_codex_session_id: selected.id,
      created_by_actor_id: input.actor_id,
      created_at: input.now,
    };
    const transition: PlanItemWorkflowTransition = {
      id: input.transition_id,
      workflow_id: workflow.id,
      from_status: workflow.status,
      to_status: workflow.status,
      actor_id: input.actor_id,
      reason: input.reason,
      evidence_object_type: 'manual_decision',
      evidence_object_id: manualDecision.id,
      codex_session_id: previousActive.id,
      created_at: input.now,
    };
    if (!workflowManualDecisionSchema.safeParse(manualDecision).success || !planItemWorkflowTransitionSchema.safeParse(transition).success) {
      throw new DomainError('workflow_invalid_transition', `workflow_invalid_transition: Fork selection transition ${input.transition_id} payload is invalid`);
    }
    assertWorkflowManualDecisionAllowedForTransition(manualDecision, {
      from_status: transition.from_status,
      to_status: transition.to_status,
      ...(workflow.previous_status === undefined ? {} : { previous_status: workflow.previous_status }),
    });
    await this.db.insert(workflow_manual_decisions).values(toDbRecord(manualDecision, workflow_manual_decisions) as never);
    await this.db.insert(plan_item_workflow_transitions).values(toDbRecord(transition, plan_item_workflow_transitions) as never);
    await this.db.update(codex_sessions).set(toDbRecord(inactivePrevious, codex_sessions) as never).where(eq(codex_sessions.id, inactivePrevious.id));
    await this.db.update(codex_sessions).set(toDbRecord(activeSelected, codex_sessions) as never).where(eq(codex_sessions.id, activeSelected.id));
    await this.db.update(plan_item_workflows).set(toDbRecord(updatedWorkflow, plan_item_workflows) as never).where(eq(plan_item_workflows.id, updatedWorkflow.id));
    return { workflow: updatedWorkflow, selectedSession: activeSelected };
  }

  private async getCodexSessionLease(id: string): Promise<CodexSessionLease | undefined> {
    return this.getById(codex_session_leases, codex_session_leases.id, id);
  }

  private async getPlanItemWorkflowTransition(id: string): Promise<PlanItemWorkflowTransition | undefined> {
    return this.getById(plan_item_workflow_transitions, plan_item_workflow_transitions.id, id);
  }

  private async findActiveCodexSessionForWorkflow(workflowId: string, exceptSessionId?: string): Promise<CodexSession | undefined> {
    const conditions = [
      eq(codex_sessions.ownerType, 'plan_item_workflow'),
      eq(codex_sessions.ownerId, workflowId),
      eq(codex_sessions.role, 'active'),
      sql`${codex_sessions.status} <> 'archived'`,
    ];
    if (exceptSessionId !== undefined) {
      conditions.push(sql`${codex_sessions.id} <> ${exceptSessionId}`);
    }
    const [row] = await this.db
      .select()
      .from(codex_sessions)
      .where(and(...conditions))
      .limit(1);
    return row === undefined ? undefined : fromDbRecord<CodexSession>(row);
  }

  private async findActiveCodexSessionLease(sessionId: string): Promise<CodexSessionLease | undefined> {
    const [row] = await this.db
      .select()
      .from(codex_session_leases)
      .where(and(eq(codex_session_leases.codexSessionId, sessionId), eq(codex_session_leases.status, 'active')))
      .limit(1);
    return row === undefined ? undefined : fromDbRecord<CodexSessionLease>(row);
  }

  private async assertCanSavePlanItemWorkflow(workflow: PlanItemWorkflow): Promise<void> {
    if (workflow.status === 'archived') {
      return;
    }
    const [existing] = await this.db
      .select()
      .from(plan_item_workflows)
      .where(
        and(
          eq(plan_item_workflows.developmentPlanItemId, workflow.development_plan_item_id),
          sql`${plan_item_workflows.status} <> 'archived'`,
          sql`${plan_item_workflows.id} <> ${workflow.id}`,
        ),
      )
      .limit(1);
    if (existing !== undefined) {
      throw new DomainError(
        'workflow_active_session_conflict',
        `workflow_active_session_conflict: Plan item ${workflow.development_plan_item_id} already has an active workflow`,
      );
    }
  }

  private async assertCanSaveCodexSession(session: CodexSession): Promise<void> {
    if (session.role !== 'active' || session.status === 'archived') {
      return;
    }
    const existing = await this.findActiveCodexSessionForWorkflow(session.owner_id, session.id);
    if (existing !== undefined) {
      throw new DomainError(
        'workflow_active_session_conflict',
        `workflow_active_session_conflict: Workflow ${session.owner_id} already has an active Codex session`,
      );
    }
  }

  private async assertWorkflowCodexSessionProvenance(workflowId: string, sessionId: string, context: string): Promise<void> {
    const workflow = await this.getPlanItemWorkflow(workflowId);
    const session = await this.getCodexSession(sessionId);
    if (
      workflow === undefined ||
      session === undefined ||
      session.owner_type !== 'plan_item_workflow' ||
      session.owner_id !== workflow.id
    ) {
      throw new DomainError('workflow_invalid_transition', `workflow_invalid_transition: ${context} Codex session provenance is invalid`);
    }
  }

  private async assertWorkflowActiveCodexSessionProvenance(workflowId: string, sessionId: string, context: string): Promise<void> {
    const workflow = await this.getPlanItemWorkflow(workflowId);
    if (workflow === undefined || workflow.active_codex_session_id !== sessionId) {
      throw new DomainError('workflow_invalid_transition', `workflow_invalid_transition: ${context} Codex session is not the active workflow session`);
    }
  }

  private async assertWorkflowCodexSessionTurnProvenance(
    workflowId: string,
    sessionId: string,
    turnId: string,
    context: string,
  ): Promise<void> {
    const turn = await this.getCodexSessionTurn(turnId);
    if (turn === undefined || turn.workflow_id !== workflowId || turn.codex_session_id !== sessionId) {
      throw new DomainError('workflow_invalid_transition', `workflow_invalid_transition: ${context} Codex session turn provenance is invalid`);
    }
  }

  private async assertCanAppendPlanItemWorkflowTransition(
    transition: PlanItemWorkflowTransition,
    projectionPatch?: ApplyPlanItemWorkflowTransitionInput['projection_patch'],
  ): Promise<void> {
    if ((await this.getPlanItemWorkflowTransition(transition.id)) !== undefined) {
      throw new DomainError('workflow_invalid_transition', `workflow_invalid_transition: Transition ${transition.id} already exists`);
    }
    if (!planItemWorkflowTransitionSchema.safeParse(transition).success) {
      throw new DomainError('workflow_invalid_transition', `workflow_invalid_transition: Transition ${transition.id} payload is invalid`);
    }
    await this.assertWorkflowCodexSessionProvenance(transition.workflow_id, transition.codex_session_id, `Transition ${transition.id}`);
    await this.assertWorkflowActiveCodexSessionProvenance(transition.workflow_id, transition.codex_session_id, `Transition ${transition.id}`);
    if (transition.codex_session_turn_id !== undefined) {
      await this.assertWorkflowCodexSessionTurnProvenance(
        transition.workflow_id,
        transition.codex_session_id,
        transition.codex_session_turn_id,
        `Transition ${transition.id}`,
      );
    }
    await this.assertPlanItemWorkflowTransitionEvidence(transition, projectionPatch);
  }

  private nextWorkflowPreviousStatus(workflow: PlanItemWorkflow, transition: PlanItemWorkflowTransition): Pick<PlanItemWorkflow, 'previous_status'> {
    if (transition.to_status === 'blocked' && transition.from_status !== 'blocked') {
      return { previous_status: workflow.status };
    }
    if (transition.from_status === 'blocked' && transition.to_status !== 'blocked') {
      return {};
    }
    return workflow.previous_status === undefined ? {} : { previous_status: workflow.previous_status };
  }

  private async assertPlanItemWorkflowProjectionPatchAllowed(input: ApplyPlanItemWorkflowTransitionInput): Promise<void> {
    const patch = input.projection_patch;
    if (patch === undefined) {
      return;
    }
    const transition = input.transition;
    const invalid =
      (patch.active_boundary_summary_revision_id !== undefined &&
        (transition.from_status !== 'boundary_review' ||
          transition.to_status !== 'spec_generation_queued' ||
          transition.evidence_object_type !== 'boundary_summary_revision' ||
          transition.evidence_object_id !== patch.active_boundary_summary_revision_id)) ||
      (patch.active_spec_doc_revision_id !== undefined &&
        (transition.from_status !== 'spec_review' ||
          transition.to_status !== 'implementation_plan_generation_queued' ||
          transition.evidence_object_type !== 'spec_revision' ||
          transition.evidence_object_id !== patch.active_spec_doc_revision_id)) ||
      (patch.active_implementation_plan_doc_revision_id !== undefined &&
        !(await this.isExecutionReadinessImplementationPlanProjectionPatchAllowed(
          transition,
          patch.active_implementation_plan_doc_revision_id,
        ))) ||
      (patch.execution_package_id !== undefined &&
        (transition.from_status !== 'execution_ready' ||
          transition.to_status !== 'execution_running' ||
          transition.evidence_object_type !== 'execution_package' ||
          transition.evidence_object_id !== patch.execution_package_id));
    if (invalid) {
      throw new DomainError('workflow_invalid_transition', `workflow_invalid_transition: Transition ${transition.id} projection patch is invalid`);
    }
  }

  private async isExecutionReadinessImplementationPlanProjectionPatchAllowed(
    transition: PlanItemWorkflowTransition,
    activeImplementationPlanRevisionId: string,
  ): Promise<boolean> {
    if (
      transition.from_status !== 'implementation_plan_review' ||
      transition.to_status !== 'execution_ready' ||
      transition.evidence_object_type !== 'execution_readiness_record'
    ) {
      return false;
    }
    const record = await this.getExecutionReadinessRecord(transition.evidence_object_id);
    return (
      record?.approved_implementation_plan_revision_id === activeImplementationPlanRevisionId &&
      record.supporting_evidence.some((evidence) => evidence.object_type === 'implementation_plan_revision' && evidence.object_id === activeImplementationPlanRevisionId) &&
      transition.supporting_evidence?.some((evidence) => evidence.object_type === 'implementation_plan_revision' && evidence.object_id === activeImplementationPlanRevisionId) === true
    );
  }

  private async assertPlanItemWorkflowTransitionEvidence(
    transition: PlanItemWorkflowTransition,
    projectionPatch?: ApplyPlanItemWorkflowTransitionInput['projection_patch'],
  ): Promise<void> {
    const workflow = await this.getPlanItemWorkflow(transition.workflow_id);
    let primaryManualDecisionKind;
    if (transition.evidence_object_type === 'manual_decision') {
      primaryManualDecisionKind = (await this.getWorkflowManualDecision(transition.evidence_object_id))?.kind;
    }
    assertPlanItemWorkflowTransitionAllowed({
      from_status: transition.from_status,
      to_status: transition.to_status,
      evidence_object_type: transition.evidence_object_type,
      ...(workflow?.previous_status === undefined ? {} : { previous_status: workflow.previous_status }),
      ...(primaryManualDecisionKind === undefined ? {} : { manual_decision_kind: primaryManualDecisionKind }),
    });
    await this.assertPlanItemWorkflowTransitionEvidenceObject(
      transition,
      transition.evidence_object_type,
      transition.evidence_object_id,
      true,
      projectionPatch,
    );
    for (const evidence of transition.supporting_evidence ?? []) {
      await this.assertPlanItemWorkflowTransitionEvidenceObject(transition, evidence.object_type, evidence.object_id);
    }
  }

  private async assertPlanItemWorkflowTransitionEvidenceObject(
    transition: PlanItemWorkflowTransition,
    evidenceObjectType: PlanItemWorkflowTransition['evidence_object_type'],
    evidenceObjectId: string,
    isPrimaryEvidence = false,
    projectionPatch?: ApplyPlanItemWorkflowTransitionInput['projection_patch'],
  ): Promise<void> {
    if (!workflowTransitionEvidenceObjectTypeSchema.safeParse(evidenceObjectType).success) {
      throw new DomainError('workflow_invalid_transition', `workflow_invalid_transition: Transition ${transition.id} evidence object type is invalid`);
    }
    if (evidenceObjectType === 'manual_decision') {
      const decision = await this.getWorkflowManualDecision(evidenceObjectId);
      if (
        decision === undefined ||
        decision.workflow_id !== transition.workflow_id ||
        decision.codex_session_id !== transition.codex_session_id ||
        decision.created_by_actor_id !== transition.actor_id
      ) {
        throw new DomainError('workflow_invalid_transition', `workflow_invalid_transition: Transition ${transition.id} manual decision evidence is invalid`);
      }
      if (isPrimaryEvidence) {
        const workflow = await this.getPlanItemWorkflow(transition.workflow_id);
        assertWorkflowManualDecisionAllowedForTransition(decision, {
          from_status: transition.from_status,
          to_status: transition.to_status,
          ...(workflow?.previous_status === undefined ? {} : { previous_status: workflow.previous_status }),
        });
      }
      return;
    }
    if (evidenceObjectType === 'execution_readiness_record') {
      await this.assertPlanItemWorkflowExecutionReadinessEvidence(transition, evidenceObjectId, isPrimaryEvidence, projectionPatch);
      return;
    }
    if (evidenceObjectType === 'boundary_summary_revision') {
      await this.assertWorkflowDocumentGateEvidenceRecord(
        transition,
        await this.getBoundarySummaryRevisionById(evidenceObjectId),
        `Transition ${transition.id} boundary summary revision evidence is invalid`,
      );
      return;
    }
    if (evidenceObjectType === 'spec_revision') {
      await this.assertWorkflowDocumentGateEvidenceRecord(
        transition,
        await this.getSpecRevision(evidenceObjectId),
        `Transition ${transition.id} spec revision evidence is invalid`,
      );
      return;
    }
    if (evidenceObjectType === 'implementation_plan_revision') {
      await this.assertWorkflowDocumentGateEvidenceRecord(
        transition,
        await this.getExecutionPlanRevision(evidenceObjectId),
        `Transition ${transition.id} implementation plan revision evidence is invalid`,
      );
      return;
    }
    if (evidenceObjectType === 'execution_package') {
      await this.assertWorkflowScopedEvidenceRecord(
        transition,
        await this.getExecutionPackage(evidenceObjectId),
        `Transition ${transition.id} execution package evidence is invalid`,
      );
      return;
    }
    if (evidenceObjectType === 'run_session') {
      await this.assertWorkflowScopedEvidenceRecord(
        transition,
        await this.getRunSession(evidenceObjectId),
        `Transition ${transition.id} run session evidence is invalid`,
      );
      return;
    }
    if (evidenceObjectType === 'review_packet') {
      await this.assertWorkflowScopedEvidenceRecord(
        transition,
        await this.getReviewPacket(evidenceObjectId),
        `Transition ${transition.id} review packet evidence is invalid`,
      );
      return;
    }
    if (evidenceObjectType === 'commit' || evidenceObjectType === 'pull_request') {
      await this.assertPlanItemWorkflowRepositoryEvidence(transition, evidenceObjectType, evidenceObjectId);
      return;
    }
    if (evidenceObjectType === 'internal_artifact') {
      await this.assertPlanItemWorkflowInternalArtifactEvidence(transition, evidenceObjectId);
    }
  }

  private async assertPlanItemWorkflowExecutionReadinessEvidence(
    transition: PlanItemWorkflowTransition,
    evidenceObjectId: string,
    isPrimaryEvidence: boolean,
    projectionPatch?: ApplyPlanItemWorkflowTransitionInput['projection_patch'],
  ): Promise<void> {
    const workflow = await this.getPlanItemWorkflow(transition.workflow_id);
    const record = await this.getExecutionReadinessRecord(evidenceObjectId);
    const transitionPatchPlanRevisionId =
      transition.to_status === 'execution_ready' && isPrimaryEvidence
        ? projectionPatch?.active_implementation_plan_doc_revision_id
        : undefined;
    const activeImplementationPlanRevisionId = workflow?.active_implementation_plan_doc_revision_id ?? transitionPatchPlanRevisionId;
    const hasReadinessPlanSupport =
      activeImplementationPlanRevisionId !== undefined &&
      record?.supporting_evidence.some((evidence) => evidence.object_type === 'implementation_plan_revision' && evidence.object_id === activeImplementationPlanRevisionId) === true;
    const hasTransitionPlanSupport =
      activeImplementationPlanRevisionId !== undefined &&
      transition.supporting_evidence?.some((evidence) => evidence.object_type === 'implementation_plan_revision' && evidence.object_id === activeImplementationPlanRevisionId) === true;
    if (
      workflow === undefined ||
      record === undefined ||
      record.workflow_id !== transition.workflow_id ||
      record.development_plan_id !== workflow.development_plan_id ||
      record.development_plan_item_id !== workflow.development_plan_item_id ||
      record.codex_session_id !== transition.codex_session_id ||
      (isPrimaryEvidence &&
        (record.readiness_state !== 'ready' ||
          record.approved_boundary_summary_revision_id !== workflow.active_boundary_summary_revision_id ||
          record.approved_spec_revision_id !== workflow.active_spec_doc_revision_id ||
          record.approved_implementation_plan_revision_id !== activeImplementationPlanRevisionId ||
          !hasReadinessPlanSupport ||
          !hasTransitionPlanSupport))
    ) {
      throw new DomainError('workflow_invalid_transition', `workflow_invalid_transition: Transition ${transition.id} execution readiness evidence is invalid`);
    }
  }

  private async assertPlanItemWorkflowRepositoryEvidence(
    transition: PlanItemWorkflowTransition,
    evidenceObjectType: 'commit' | 'pull_request',
    evidenceObjectId: string,
  ): Promise<void> {
    const workflow = await this.getPlanItemWorkflow(transition.workflow_id);
    if (
      workflow === undefined ||
      (await this.resolveWorkflowRepositoryEvidence({
        evidence_object_type: evidenceObjectType,
        evidence_object_id: evidenceObjectId,
        workflow_id: transition.workflow_id,
        development_plan_id: workflow.development_plan_id,
        development_plan_item_id: workflow.development_plan_item_id,
      })) === undefined
    ) {
      throw new DomainError('workflow_invalid_transition', `workflow_invalid_transition: Transition ${transition.id} repository evidence is invalid`);
    }
  }

  private async assertPlanItemWorkflowInternalArtifactEvidence(
    transition: PlanItemWorkflowTransition,
    evidenceObjectId: string,
  ): Promise<void> {
    const workflow = await this.getPlanItemWorkflow(transition.workflow_id);
    const artifact = await this.getInternalArtifactObjectById(evidenceObjectId);
    const isValidArtifact =
      workflow !== undefined &&
      artifact !== undefined &&
      artifact.deleted_at === undefined &&
      ((artifact.owner_type === 'codex_session' && artifact.owner_id === transition.codex_session_id) ||
        (artifact.owner_type === 'execution_package' && artifact.owner_id === workflow.execution_package_id));
    if (!isValidArtifact) {
      throw new DomainError('workflow_invalid_transition', `workflow_invalid_transition: Transition ${transition.id} internal artifact evidence is invalid`);
    }
  }

  private async assertWorkflowScopedEvidenceRecord(
    transition: PlanItemWorkflowTransition,
    record: { workflow_id?: string; codex_session_id?: string } | undefined,
    message: string,
  ): Promise<void> {
    if (
      record === undefined ||
      record.workflow_id !== transition.workflow_id ||
      (record.codex_session_id !== undefined && record.codex_session_id !== transition.codex_session_id)
    ) {
      throw new DomainError('workflow_invalid_transition', `workflow_invalid_transition: ${message}`);
    }
  }

  private async assertWorkflowDocumentGateEvidenceRecord(
    transition: PlanItemWorkflowTransition,
    record: { workflow_id?: string; codex_session_id?: string; development_plan_item_id?: string } | undefined,
    message: string,
  ): Promise<void> {
    const workflow = await this.getPlanItemWorkflow(transition.workflow_id);
    if (
      workflow === undefined ||
      record === undefined ||
      record.workflow_id !== transition.workflow_id ||
      record.codex_session_id !== transition.codex_session_id ||
      record.development_plan_item_id !== workflow.development_plan_item_id
    ) {
      throw new DomainError('workflow_invalid_transition', `workflow_invalid_transition: ${message}`);
    }
  }

  async createCodexRuntimeProfileWithRevision(
    input: CreateCodexRuntimeProfileWithRevisionInput,
  ): Promise<CodexRuntimeProfileRevision> {
    validateCodexRuntimeProfileRevision(input.revision);
    if (input.profile.active_revision_id !== input.revision.id || input.revision.profile_id !== input.profile.id) {
      throw codexDenied('codex_launch_lease_denied', 'Runtime profile active revision fence was rejected.');
    }
    if (input.profile.target_kind !== input.revision.target_kind || input.profile.environment !== input.revision.environment) {
      throw codexDenied('codex_launch_lease_denied', 'Runtime profile revision does not match parent profile.');
    }
    return this.db.transaction(async (tx) => {
      const repository = new DrizzleDeliveryRepository(tx as ForgeloopDrizzleDatabase);
      const existingProfile = await repository.getById<CodexRuntimeProfile>(
        codex_runtime_profiles,
        codex_runtime_profiles.id,
        input.profile.id,
      );
      const existingRevision = await repository.getById<CodexRuntimeProfileRevision>(
        codex_runtime_profile_revisions,
        codex_runtime_profile_revisions.id,
        input.revision.id,
      );
      const [existingRevisionByNumberRow] = await tx
        .select()
        .from(codex_runtime_profile_revisions)
        .where(
          and(
            eq(codex_runtime_profile_revisions.profileId, input.revision.profile_id),
            eq(codex_runtime_profile_revisions.revisionNumber, input.revision.revision_number),
          ),
        )
        .limit(1);
      const existingRevisionByNumber =
        existingRevisionByNumberRow === undefined
          ? undefined
          : fromDbRecord<CodexRuntimeProfileRevision>(existingRevisionByNumberRow);
      if (existingProfile !== undefined || existingRevision !== undefined || existingRevisionByNumber !== undefined) {
        if (
          existingProfile !== undefined &&
          existingRevision !== undefined &&
          existingRevisionByNumber?.id === existingRevision.id &&
          valuesEqual(existingProfile, input.profile) &&
          valuesEqual(existingRevision, input.revision)
        ) {
          return existingRevision;
        }
        throw codexDenied('codex_launch_lease_denied', 'Runtime profile revision is immutable.');
      }
      const [insertedProfile] = await tx
        .insert(codex_runtime_profiles)
        .values(toDbRecord(input.profile, codex_runtime_profiles) as never)
        .onConflictDoNothing()
        .returning({ id: codex_runtime_profiles.id });
      if (insertedProfile === undefined) {
        const racedProfile = await repository.getById<CodexRuntimeProfile>(
          codex_runtime_profiles,
          codex_runtime_profiles.id,
          input.profile.id,
        );
        if (!valuesEqual(racedProfile, input.profile)) {
          throw codexDenied('codex_launch_lease_denied', 'Runtime profile revision is immutable.');
        }
      }
      const [insertedRevision] = await tx
        .insert(codex_runtime_profile_revisions)
        .values(toDbRecord(input.revision, codex_runtime_profile_revisions) as never)
        .onConflictDoNothing()
        .returning({ id: codex_runtime_profile_revisions.id });
      if (insertedRevision === undefined) {
        const racedRevision = await repository.getById<CodexRuntimeProfileRevision>(
          codex_runtime_profile_revisions,
          codex_runtime_profile_revisions.id,
          input.revision.id,
        );
        const [racedRevisionByNumberRow] = await tx
          .select()
          .from(codex_runtime_profile_revisions)
          .where(
            and(
              eq(codex_runtime_profile_revisions.profileId, input.revision.profile_id),
              eq(codex_runtime_profile_revisions.revisionNumber, input.revision.revision_number),
            ),
          )
          .limit(1);
        const racedRevisionByNumber =
          racedRevisionByNumberRow === undefined
            ? undefined
            : fromDbRecord<CodexRuntimeProfileRevision>(racedRevisionByNumberRow);
        if (racedRevision !== undefined && racedRevisionByNumber?.id === racedRevision.id && valuesEqual(racedRevision, input.revision)) {
          return racedRevision;
        }
        throw codexDenied('codex_launch_lease_denied', 'Runtime profile revision is immutable.');
      }
      return input.revision;
    });
  }

  async getActiveCodexRuntimeProfileRevision(
    input: ResolveCodexRuntimeForLaunchInput,
  ): Promise<CodexRuntimeProfileRevision | undefined> {
    const conditions = [
      eq(codex_runtime_profile_revisions.status, 'active'),
      eq(codex_runtime_profile_revisions.targetKind, input.target_kind),
    ];
    if (input.runtime_profile_id !== undefined) {
      conditions.push(eq(codex_runtime_profile_revisions.profileId, input.runtime_profile_id));
    }
    const rows = await this.db
      .select()
      .from(codex_runtime_profile_revisions)
      .where(and(...conditions))
      .orderBy(desc(codex_runtime_profile_revisions.createdAt), desc(codex_runtime_profile_revisions.revisionNumber));
    return rows
      .map((row) => fromDbRecord<CodexRuntimeProfileRevision>(row))
      .find((revision) => codexRuntimeScopeMatches(revision.allowed_scopes, codexScope(input.project_id, input.repo_id)));
  }

  async createCodexCredentialBindingWithVersion(
    input: CreateCodexCredentialBindingWithVersionInput,
  ): Promise<CodexCredentialBindingVersion> {
    if (input.binding.provider !== 'unsafe_db') {
      throw codexDenied('codex_launch_lease_denied', 'Only unsafe_db Codex credential bindings are supported.');
    }
    if (input.binding.active_version_id !== input.version.id || input.version.binding_id !== input.binding.id) {
      throw codexDenied('codex_launch_lease_denied', 'Credential binding active version fence was rejected.');
    }
    const payloadDigest = codexCredentialPayloadDigest(input.secret_payload_json);
    if (payloadDigest !== input.version.payload_digest) {
      throw codexDenied('codex_launch_lease_denied', 'Credential payload digest does not match secret payload.');
    }
    return this.db.transaction(async (tx) => {
      const repository = new DrizzleDeliveryRepository(tx as ForgeloopDrizzleDatabase);
      const existingBinding = await repository.getById<CodexCredentialBinding>(
        codex_credential_bindings,
        codex_credential_bindings.id,
        input.binding.id,
      );
      const [existingVersionRow] = await tx
        .select()
        .from(codex_credential_binding_versions)
        .where(eq(codex_credential_binding_versions.id, input.version.id))
        .limit(1);
      const existingVersion =
        existingVersionRow === undefined
          ? undefined
          : fromDbRecord<CodexCredentialBindingVersion & { secret_payload_json: unknown }>(existingVersionRow);
      const [existingVersionByNumberRow] = await tx
        .select()
        .from(codex_credential_binding_versions)
        .where(
          and(
            eq(codex_credential_binding_versions.bindingId, input.version.binding_id),
            eq(codex_credential_binding_versions.versionNumber, input.version.version_number),
          ),
        )
        .limit(1);
      const existingVersionByNumber =
        existingVersionByNumberRow === undefined
          ? undefined
          : fromDbRecord<CodexCredentialBindingVersion & { secret_payload_json: unknown }>(existingVersionByNumberRow);

      if (existingBinding !== undefined || existingVersion !== undefined || existingVersionByNumber !== undefined) {
        const { secret_payload_json: existingSecretPayload, ...existingPublicVersion } = existingVersion ?? {};
        if (
          existingBinding !== undefined &&
          existingVersion !== undefined &&
          existingVersionByNumber?.id === existingVersion.id &&
          valuesEqual(existingBinding, input.binding) &&
          valuesEqual(existingPublicVersion, input.version) &&
          valuesEqual(existingSecretPayload, input.secret_payload_json)
        ) {
          return existingPublicVersion as CodexCredentialBindingVersion;
        }
        throw codexDenied('codex_launch_lease_denied', 'Credential binding version is immutable.');
      }
      const [insertedBinding] = await tx
        .insert(codex_credential_bindings)
        .values(toDbRecord(input.binding, codex_credential_bindings) as never)
        .onConflictDoNothing()
        .returning({ id: codex_credential_bindings.id });
      if (insertedBinding === undefined) {
        const racedBinding = await repository.getById<CodexCredentialBinding>(
          codex_credential_bindings,
          codex_credential_bindings.id,
          input.binding.id,
        );
        if (!valuesEqual(racedBinding, input.binding)) {
          throw codexDenied('codex_launch_lease_denied', 'Credential binding version is immutable.');
        }
      }
      const [insertedVersion] = await tx
        .insert(codex_credential_binding_versions)
        .values({
          ...toDbRecord(input.version, codex_credential_binding_versions),
          secretPayloadJson: input.secret_payload_json,
        } as never)
        .onConflictDoNothing()
        .returning({ id: codex_credential_binding_versions.id });
      if (insertedVersion === undefined) {
        const [racedVersionRow] = await tx
          .select()
          .from(codex_credential_binding_versions)
          .where(eq(codex_credential_binding_versions.id, input.version.id))
          .limit(1);
        const racedVersion =
          racedVersionRow === undefined
            ? undefined
            : fromDbRecord<CodexCredentialBindingVersion & { secret_payload_json: unknown }>(racedVersionRow);
        const [racedVersionByNumberRow] = await tx
          .select()
          .from(codex_credential_binding_versions)
          .where(
            and(
              eq(codex_credential_binding_versions.bindingId, input.version.binding_id),
              eq(codex_credential_binding_versions.versionNumber, input.version.version_number),
            ),
          )
          .limit(1);
        const racedVersionByNumber =
          racedVersionByNumberRow === undefined
            ? undefined
            : fromDbRecord<CodexCredentialBindingVersion & { secret_payload_json: unknown }>(racedVersionByNumberRow);
        const { secret_payload_json: racedSecretPayload, ...racedPublicVersion } = racedVersion ?? {};
        if (
          racedVersion !== undefined &&
          racedVersionByNumber?.id === racedVersion.id &&
          valuesEqual(racedPublicVersion, input.version) &&
          valuesEqual(racedSecretPayload, input.secret_payload_json)
        ) {
          return racedPublicVersion as CodexCredentialBindingVersion;
        }
        throw codexDenied('codex_launch_lease_denied', 'Credential binding version is immutable.');
      }
      return input.version;
    });
  }

  async getCodexCredentialBindingPublic(id: string): Promise<CodexCredentialBindingPublic | undefined> {
    const binding = await this.getById<CodexCredentialBinding>(codex_credential_bindings, codex_credential_bindings.id, id);
    if (binding === undefined) {
      return undefined;
    }
    const [activeVersionRow] =
      binding.active_version_id === undefined
        ? []
        : await this.db
            .select(codexCredentialBindingVersionPublicColumns)
            .from(codex_credential_binding_versions)
            .where(eq(codex_credential_binding_versions.id, binding.active_version_id))
            .limit(1);
    const activeVersion =
      activeVersionRow === undefined ? undefined : fromDbRecord<CodexCredentialBindingVersion>(activeVersionRow);
    return {
      id: binding.id,
      profile_id: binding.profile_id,
      project_id: binding.project_id,
      ...(binding.repo_id === undefined ? {} : { repo_id: binding.repo_id }),
      provider: binding.provider,
      purpose: binding.purpose,
      ...(binding.active_version_id === undefined ? {} : { active_version_id: binding.active_version_id }),
      ...(activeVersion?.payload_digest === undefined ? {} : { active_payload_digest: activeVersion.payload_digest }),
    };
  }

  private async getScopedCodexCredentialBindingPublic(
    input: ResolveCodexCredentialForLaunchInput,
  ): Promise<CodexCredentialBindingPublic | undefined> {
    const binding = await this.getById<CodexCredentialBinding>(
      codex_credential_bindings,
      codex_credential_bindings.id,
      input.credential_binding_id,
    );
    if (binding === undefined || binding.project_id !== input.project_id) {
      return undefined;
    }
    if (binding.repo_id !== undefined && binding.repo_id !== input.repo_id) {
      return undefined;
    }
    const profile = await this.getById<CodexRuntimeProfile>(codex_runtime_profiles, codex_runtime_profiles.id, binding.profile_id);
    if (
      (input.runtime_profile_id !== undefined && binding.profile_id !== input.runtime_profile_id) ||
      profile?.target_kind !== input.target_kind ||
      binding.active_version_id === undefined
    ) {
      return undefined;
    }
    const [activeVersionRow] = await this.db
      .select(codexCredentialBindingVersionPublicColumns)
      .from(codex_credential_binding_versions)
      .where(eq(codex_credential_binding_versions.id, binding.active_version_id))
      .limit(1);
    const activeVersion =
      activeVersionRow === undefined ? undefined : fromDbRecord<CodexCredentialBindingVersion>(activeVersionRow);
    if (activeVersion === undefined || activeVersion.status !== 'active') {
      return undefined;
    }
    return {
      id: binding.id,
      profile_id: binding.profile_id,
      project_id: binding.project_id,
      ...(binding.repo_id === undefined ? {} : { repo_id: binding.repo_id }),
      provider: binding.provider,
      purpose: binding.purpose,
      active_version_id: activeVersion.id,
      active_payload_digest: activeVersion.payload_digest,
    };
  }

  async resolveCodexCredentialForLaunch(input: ResolveCodexCredentialForLaunchInput): Promise<ResolvedCodexCredential | undefined> {
    const binding = await this.getById<CodexCredentialBinding>(
      codex_credential_bindings,
      codex_credential_bindings.id,
      input.credential_binding_id,
    );
    if (binding === undefined || binding.project_id !== input.project_id) {
      return undefined;
    }
    if (binding.repo_id !== undefined && binding.repo_id !== input.repo_id) {
      return undefined;
    }
    const profile = await this.getById<CodexRuntimeProfile>(codex_runtime_profiles, codex_runtime_profiles.id, binding.profile_id);
    if (
      (input.runtime_profile_id !== undefined && binding.profile_id !== input.runtime_profile_id) ||
      profile?.target_kind !== input.target_kind ||
      binding.active_version_id === undefined
    ) {
      return undefined;
    }
    const [row] = await this.db
      .select()
      .from(codex_credential_binding_versions)
      .where(eq(codex_credential_binding_versions.id, binding.active_version_id))
      .limit(1);
    if (row === undefined) {
      return undefined;
    }
    const record = fromDbRecord<CodexCredentialBindingVersion & { secret_payload_json: unknown }>(row);
    if (record.status !== 'active') {
      return undefined;
    }
    if (input.required_payload_digest !== undefined && record.payload_digest !== input.required_payload_digest) {
      return undefined;
    }
    return {
      binding_id: binding.id,
      binding_version_id: record.id,
      payload: record.secret_payload_json,
      payload_digest: record.payload_digest,
    };
  }

	async getCodexRuntimeStatus(input: GetCodexRuntimeStatusInput): Promise<CodexRuntimeStatusProjection> {
		const profileRevision = await this.getActiveCodexRuntimeProfileRevision(input);
		let credential =
			input.credential_binding_id === undefined
				? undefined
				: await this.getScopedCodexCredentialBindingPublic({
					credential_binding_id: input.credential_binding_id,
					target_kind: input.target_kind,
					...(input.runtime_profile_id === undefined ? {} : { runtime_profile_id: input.runtime_profile_id }),
					project_id: input.project_id,
					...(input.repo_id === undefined ? {} : { repo_id: input.repo_id }),
					now: input.now,
				});
		if (credential === undefined && input.credential_binding_id === undefined && profileRevision !== undefined) {
			const candidates = await this.listCodexCredentialBindingReadinessCandidates({
				project_id: input.project_id,
				...(input.repo_id === undefined ? {} : { repo_id: input.repo_id }),
				runtime_profile_id: profileRevision.profile_id,
				target_kind: input.target_kind,
				now: input.now,
			});
			const modelProviderCandidate = candidates.filter((candidate) => candidate.purpose === 'model_provider');
			if (modelProviderCandidate.length === 1) {
				credential = await this.getScopedCodexCredentialBindingPublic({
					credential_binding_id: modelProviderCandidate[0]!.id,
					target_kind: input.target_kind,
					runtime_profile_id: profileRevision.profile_id,
					project_id: input.project_id,
					...(input.repo_id === undefined ? {} : { repo_id: input.repo_id }),
					now: input.now,
				});
			}
		}
    const profileNetworkPolicy = profileRevision === undefined ? undefined : normalizeCodexRuntimeNetworkPolicy(profileRevision.network_policy);
    const worker =
      profileRevision === undefined || profileNetworkPolicy === undefined
        ? undefined
        : await this.findAvailableCodexWorker({
            project_id: input.project_id,
            ...(input.repo_id === undefined ? {} : { repo_id: input.repo_id }),
            target_kind: input.target_kind,
            docker_image_digest: profileRevision.docker_image_digest,
            network_policy_digest: codexRuntimeNetworkPolicyDigest(profileNetworkPolicy),
            ...(profileNetworkPolicy.mode === 'egress_allowlist' && profileNetworkPolicy.provider === 'docker_network_proxy'
              ? { network_provider_config_digest: profileNetworkPolicy.provider_config.provider_config_digest }
              : {}),
            now: input.now,
          });
    const blockerCodes: CodexPublicBlockerCode[] = [];
    if (profileRevision === undefined) {
      blockerCodes.push('codex_runtime_profile_invalid');
    }
    if (input.credential_binding_id !== undefined && credential === undefined) {
      blockerCodes.push('codex_credential_unavailable');
    }
    if (profileRevision !== undefined && worker === undefined) {
      blockerCodes.push('codex_worker_unavailable');
    }

    return {
      ...(profileRevision === undefined
        ? {}
        : {
            runtime_profile_id: profileRevision.profile_id,
            runtime_profile_revision_id: profileRevision.id,
            runtime_profile_digest: profileRevision.profile_digest,
            runtime_target_kind: profileRevision.target_kind,
            source_access_mode: profileRevision.source_access_mode,
            environment: profileRevision.environment,
            docker_image_digest: profileRevision.docker_image_digest,
            network_policy_digest: codexRuntimeNetworkPolicyDigest(profileRevision.network_policy),
            profile_status: profileRevision.status,
          }),
      ...(credential === undefined
        ? {}
        : {
            credential_binding_id: credential.id,
            credential_binding_version_id: credential.active_version_id,
            credential_payload_digest: credential.active_payload_digest,
          }),
      ...(worker === undefined ? {} : { worker_status: worker.status }),
      blocker_codes: blockerCodes,
    };
  }

  async listActiveCodexRuntimeProfileReadinessDiagnostics(
    input: ListActiveCodexRuntimeProfileReadinessDiagnosticsInput,
  ): Promise<CodexRuntimeProfileReadinessDiagnostic[]> {
    const rows = await this.db
      .select()
      .from(codex_runtime_profile_revisions)
      .where(
        and(
          eq(codex_runtime_profile_revisions.status, 'active'),
          ...(input.runtime_profile_id === undefined
            ? []
            : [eq(codex_runtime_profile_revisions.profileId, input.runtime_profile_id)]),
        ),
      )
      .orderBy(desc(codex_runtime_profile_revisions.createdAt), desc(codex_runtime_profile_revisions.revisionNumber));
    return rows
      .map((row) => fromDbRecord<CodexRuntimeProfileRevision>(row))
      .filter((revision) => codexRuntimeScopeMatches(revision.allowed_scopes, codexScope(input.project_id, input.repo_id)))
      .map((revision) => {
        const networkPolicy = normalizeCodexRuntimeNetworkPolicy(revision.network_policy);
        return {
          profile_id: revision.profile_id,
          target_kind: revision.target_kind,
          source_access_mode: revision.source_access_mode,
          docker_image_digest: revision.docker_image_digest,
          network_policy_digest: codexRuntimeNetworkPolicyDigest(networkPolicy),
          ...(networkPolicy.mode === 'egress_allowlist' && networkPolicy.provider === 'docker_network_proxy'
            ? { network_provider_config_digest: networkPolicy.provider_config.provider_config_digest }
            : {}),
        };
      });
  }

  async listCodexCredentialBindingReadinessCandidates(
    input: ListCodexCredentialBindingReadinessCandidatesInput,
  ): Promise<CodexCredentialBindingReadinessCandidate[]> {
    const rows = await this.db
      .select({
        binding: codex_credential_bindings,
        versionStatus: codex_credential_binding_versions.status,
        profileTargetKind: codex_runtime_profiles.targetKind,
      })
      .from(codex_credential_bindings)
      .innerJoin(codex_runtime_profiles, eq(codex_runtime_profiles.id, codex_credential_bindings.profileId))
      .innerJoin(
        codex_credential_binding_versions,
        eq(codex_credential_binding_versions.id, codex_credential_bindings.activeVersionId),
      )
      .where(
        and(
          eq(codex_credential_bindings.projectId, input.project_id),
          eq(codex_credential_bindings.profileId, input.runtime_profile_id),
          ...(input.credential_binding_id === undefined ? [] : [eq(codex_credential_bindings.id, input.credential_binding_id)]),
        ),
      );

    return rows
      .map((row) => ({
        binding: fromDbRecord<CodexCredentialBinding>(row.binding),
        versionStatus: row.versionStatus,
        profileTargetKind: row.profileTargetKind,
      }))
      .filter(
        ({ binding, versionStatus, profileTargetKind }) =>
          (binding.repo_id === undefined || binding.repo_id === input.repo_id) &&
          profileTargetKind === input.target_kind &&
          versionStatus === 'active',
      )
      .map(({ binding }) => ({ id: binding.id, purpose: binding.purpose }));
  }

  async getCodexWorkerReadinessDiagnostic(
    input: GetCodexWorkerReadinessDiagnosticInput,
  ): Promise<CodexWorkerReadinessDiagnostic> {
    const rows = await this.db
      .select()
      .from(codex_worker_registrations)
      .where(
        and(
          eq(codex_worker_registrations.status, 'online'),
          eq(codex_worker_registrations.controlChannelStatus, 'connected'),
          gt(codex_worker_registrations.sessionTokenExpiresAt, input.now),
          isNotNull(codex_worker_registrations.lastHeartbeatAt),
        ),
      )
      .orderBy(
        asc(codex_worker_registrations.leaseCount),
        desc(codex_worker_registrations.lastHeartbeatAt),
        desc(codex_worker_registrations.registeredAt),
        desc(codex_worker_registrations.id),
      );
    const available = rows
      .map((row) => fromDbRecord<CodexWorkerRegistrationDbRecord>(row))
      .filter(
        (record) =>
          codexWorkerHeartbeatIsFresh(record.last_heartbeat_at, input.now) &&
          codexWorkerScopeMatchesTarget(record.allowed_scopes_json, input.target_kind, codexScope(input.project_id, input.repo_id)),
      );

    if (available.length === 0) {
      return 'worker_unavailable';
    }
    const targetCompatible = available.filter((record) =>
      capabilityList(record.capabilities_json, 'target_kinds').includes(input.target_kind),
    );
    if (targetCompatible.length === 0) {
      return 'worker_target_unsupported';
    }
    const dockerCompatible = targetCompatible.filter((record) =>
      capabilityList(record.capabilities_json, 'docker_image_digests').includes(input.docker_image_digest),
    );
    if (dockerCompatible.length === 0) {
      return 'worker_docker_capability_mismatch';
    }
    const networkCompatible = dockerCompatible.filter(
      (record) =>
        capabilityList(record.capabilities_json, 'network_policy_digests').includes(input.network_policy_digest) &&
        (input.network_provider_config_digest === undefined ||
          capabilityList(record.capabilities_json, 'network_provider_config_digests').includes(input.network_provider_config_digest)),
    );
    return networkCompatible.length === 0 ? 'worker_network_policy_mismatch' : 'ready';
  }

  async createCodexWorkerBootstrapToken(input: CreateCodexWorkerBootstrapTokenInput): Promise<CodexWorkerBootstrapToken> {
    const expected = {
      id: input.id,
      worker_identity: input.worker_identity,
      bootstrap_token_hash: input.bootstrap_token_hash,
      bootstrap_token_version: input.bootstrap_token_version,
      status: input.status,
      allowed_scopes_json: input.allowed_scopes_json,
      allowed_capabilities_json: input.allowed_capabilities_json,
      created_by_actor_id: input.created_by_actor_id,
      created_at: input.created_at,
      expires_at: input.expires_at,
      ...(input.revoked_at === undefined ? {} : { revoked_at: input.revoked_at }),
    };
    const readExisting = async (): Promise<CodexWorkerBootstrapToken | undefined> => {
      const [existingRow] = await this.db
        .select()
        .from(codex_worker_bootstrap_tokens)
        .where(eq(codex_worker_bootstrap_tokens.id, input.id))
        .limit(1);
      if (existingRow === undefined) {
        return undefined;
      }
      const existing = fromDbRecord<{
        id: string;
        worker_identity: string;
        bootstrap_token_hash: string;
        bootstrap_token_version: number;
        status: CreateCodexWorkerBootstrapTokenInput['status'];
        allowed_scopes_json: readonly CodexRuntimeScope[];
        allowed_capabilities_json: Record<string, unknown>;
        created_by_actor_id: string;
        created_at: string;
        expires_at: string;
        consumed_at?: string;
        revoked_at?: string;
      }>(existingRow as Record<string, unknown>);
      const { consumed_at: _consumedAt, ...existingCreationFields } = existing;
      const { created_at: _expectedCreatedAt, expires_at: _expectedExpiresAt, ...expectedReplayFields } = expected;
      const {
        created_at: _existingCreatedAt,
        expires_at: _existingExpiresAt,
        ...existingReplayFields
      } = existingCreationFields;
      if (!valuesEqual(existingReplayFields, expectedReplayFields)) {
        throw codexDenied('codex_worker_registration_denied', 'Worker bootstrap token already exists with different immutable fields.');
      }
      return {
        id: existing.id,
        token_hash: existing.bootstrap_token_hash,
        expires_at: existing.expires_at,
        ...(existing.consumed_at === undefined ? {} : { consumed_at: existing.consumed_at }),
        created_at: existing.created_at,
      };
    };
    const [row] = await this.db
      .insert(codex_worker_bootstrap_tokens)
      .values({
        id: input.id,
        workerIdentity: input.worker_identity,
        bootstrapTokenHash: input.bootstrap_token_hash,
        bootstrapTokenVersion: input.bootstrap_token_version,
        status: input.status,
        allowedScopesJson: input.allowed_scopes_json,
        allowedCapabilitiesJson: input.allowed_capabilities_json,
        createdByActorId: input.created_by_actor_id,
        createdAt: input.created_at,
        expiresAt: input.expires_at,
        revokedAt: input.revoked_at ?? null,
      } as never)
      .onConflictDoNothing()
      .returning();
    if (row === undefined) {
      const existing = await readExisting();
      if (existing !== undefined) {
        return existing;
      }
      throw codexDenied('codex_worker_registration_denied', 'Worker bootstrap token already exists with different immutable fields.');
    }
    const token = fromDbRecord<{
      id: string;
      bootstrap_token_hash: string;
      expires_at: string;
      consumed_at?: string;
      created_at: string;
    }>(row as Record<string, unknown>);
    return {
      id: token.id,
      token_hash: token.bootstrap_token_hash,
      expires_at: token.expires_at,
      ...(token.consumed_at === undefined ? {} : { consumed_at: token.consumed_at }),
      created_at: token.created_at,
    };
  }

  async upsertCodexWorkerRegistration(input: UpsertCodexWorkerRegistrationInput): Promise<CodexWorkerRegistration> {
    return this.db.transaction(async (tx) => {
      const repository = new DrizzleDeliveryRepository(tx as ForgeloopDrizzleDatabase);
      const bootstrap = await repository.findActiveCodexWorkerBootstrap(input);
      if (bootstrap === undefined) {
        throw codexDenied('codex_worker_registration_denied', 'Worker bootstrap token proof was rejected.');
      }
      const bootstrapScopes = bootstrap.allowed_scopes_json;
      const bootstrapCapabilities = bootstrap.allowed_capabilities_json;
      if (
        !input.allowed_scopes.every((scope) => codexRuntimeScopeMatches(bootstrapScopes, scope)) ||
        !includesAll(capabilityList(bootstrapCapabilities, 'target_kinds'), input.capabilities) ||
        !includesAll(capabilityList(bootstrapCapabilities, 'docker_image_digests'), input.docker_image_digests) ||
        !includesAll(capabilityList(bootstrapCapabilities, 'network_policy_digests'), input.network_policy_digests) ||
        !includesAll(capabilityList(bootstrapCapabilities, 'network_provider_config_digests'), input.network_provider_config_digests ?? [])
      ) {
        throw codexDenied('codex_worker_registration_denied', 'Worker registration exceeds bootstrap token trust root.');
      }

      const [consumedToken] = await tx
        .update(codex_worker_bootstrap_tokens)
        .set({ status: 'consumed', consumedAt: input.now } as never)
        .where(
          and(
            eq(codex_worker_bootstrap_tokens.workerIdentity, input.worker_identity),
            eq(codex_worker_bootstrap_tokens.bootstrapTokenHash, input.bootstrap_token_hash),
            eq(codex_worker_bootstrap_tokens.bootstrapTokenVersion, input.bootstrap_token_version),
            eq(codex_worker_bootstrap_tokens.status, 'active'),
            isNull(codex_worker_bootstrap_tokens.revokedAt),
            gt(codex_worker_bootstrap_tokens.expiresAt, input.now),
          ),
        )
        .returning({ id: codex_worker_bootstrap_tokens.id });
      if (consumedToken === undefined) {
        throw codexDenied('codex_worker_registration_denied', 'Worker bootstrap token proof was rejected.');
      }

      const capabilitiesJson = {
        target_kinds: input.capabilities,
        docker_image_digests: input.docker_image_digests,
        network_policy_digests: input.network_policy_digests,
        network_provider_config_digests: input.network_provider_config_digests ?? [],
      };
      const [row] = await tx
        .insert(codex_worker_registrations)
        .values({
          id: input.worker_id,
          workerIdentity: input.worker_identity,
          status: input.status,
          version: input.version,
          controlChannelStatus: input.control_channel_status,
          sessionTokenHash: codexCredentialPayloadDigest(input.session_token),
          sessionTokenExpiresAt: input.session_expires_at,
          sessionEpoch: 1,
          bootstrapTokenHash: input.bootstrap_token_hash,
          bootstrapTokenVersion: input.bootstrap_token_version,
          allowedScopesJson: input.allowed_scopes,
          capabilitiesJson,
          capabilityCeilingJson: capabilitiesJson,
          hostWorkerUid: input.host_worker_uid,
          hostWorkerGid: input.host_worker_gid,
          leaseCount: input.lease_count,
          maxConcurrency: input.max_concurrency,
          labelsJson: input.labels ?? {},
          sessionPublicKeyId: input.session_public_key_id,
          sessionPublicKeyAlgorithm: input.session_public_key_algorithm,
          sessionPublicKeyMaterial: input.session_public_key_material,
          sessionPublicKeyCreatedAt: input.now,
          sessionPublicKeyExpiresAt: input.session_public_key_expires_at,
          registeredAt: input.now,
        } as never)
        .onConflictDoNothing()
        .returning();
      if (row === undefined) {
        throw codexDenied('codex_worker_registration_denied', 'Worker bootstrap token was already consumed.');
      }
      return registrationFromDbRecord(fromDbRecord<CodexWorkerRegistrationDbRecord>(row as Record<string, unknown>));
    });
  }

  async heartbeatCodexWorker(input: HeartbeatCodexWorkerInput): Promise<CodexWorkerRegistration> {
    await this.assertCodexWorkerSession(input.worker_id, input.session_token, 'codex_worker_registration_denied', input.now, {
      requireConnected: false,
    });
    const [workerRow] = await this.db
      .select({
        capabilitiesJson: codex_worker_registrations.capabilitiesJson,
        capabilityCeilingJson: codex_worker_registrations.capabilityCeilingJson,
      })
      .from(codex_worker_registrations)
      .where(eq(codex_worker_registrations.id, input.worker_id))
      .limit(1);
    const capabilityCeilingJson = (workerRow?.capabilityCeilingJson ?? workerRow?.capabilitiesJson) as Record<string, unknown> | undefined;
    if (
      workerRow === undefined ||
      capabilityCeilingJson === undefined ||
      !includesAll(capabilityList(capabilityCeilingJson, 'target_kinds'), input.capabilities)
    ) {
      throw codexDenied('codex_worker_registration_denied', 'Worker heartbeat exceeds registered capability ceiling.');
    }
    await this.recordCodexWorkerNonce(input.worker_id, input.session_token, input.nonce, input.nonce_timestamp, input.now);
    const activeCapabilitiesJson = {
      ...capabilityCeilingJson,
      target_kinds: input.capabilities,
    };
    const [row] = await this.db
      .update(codex_worker_registrations)
      .set({
        status: input.status,
        controlChannelStatus: input.control_channel_status,
        capabilitiesJson: activeCapabilitiesJson,
        lastHeartbeatAt: input.now,
      } as never)
      .where(eq(codex_worker_registrations.id, input.worker_id))
      .returning();
    if (row === undefined) {
      throw codexDenied('codex_worker_registration_denied', 'Codex worker heartbeat was rejected.');
    }
    return registrationFromDbRecord(fromDbRecord<CodexWorkerRegistrationDbRecord>(row as Record<string, unknown>));
  }

  async findAvailableCodexWorker(input: FindAvailableCodexWorkerInput): Promise<CodexWorkerRegistration | undefined> {
    const rows = await this.selectCandidateCodexWorkerRows(input)
      .orderBy(
        asc(codex_worker_registrations.leaseCount),
        desc(codex_worker_registrations.lastHeartbeatAt),
        desc(codex_worker_registrations.registeredAt),
        desc(codex_worker_registrations.id),
      );
    const matched = rows
      .map((row) => fromDbRecord<CodexWorkerRegistrationDbRecord>(row))
      .find((record) => this.codexWorkerRecordMatchesRuntimeTarget(record, input) && record.lease_count < record.max_concurrency);
    return matched === undefined ? undefined : registrationFromDbRecord(matched);
  }

  async findCodexWorkerForSessionRunner(input: FindCodexWorkerForSessionRunnerInput): Promise<CodexWorkerRegistration | undefined> {
    const rows = await this.selectCandidateCodexWorkerRows(input);
    const matched = rows.map((row) => fromDbRecord<CodexWorkerRegistrationDbRecord>(row)).find((record) => this.codexWorkerRecordMatchesRuntimeTarget(record, input));
    return matched === undefined ? undefined : registrationFromDbRecord(matched);
  }

  private selectCandidateCodexWorkerRows(input: FindAvailableCodexWorkerInput) {
    const predicates = [
      eq(codex_worker_registrations.status, 'online'),
      eq(codex_worker_registrations.controlChannelStatus, 'connected'),
      gt(codex_worker_registrations.sessionTokenExpiresAt, input.now),
      isNotNull(codex_worker_registrations.lastHeartbeatAt),
      ...(input.worker_id === undefined ? [] : [eq(codex_worker_registrations.id, input.worker_id)]),
    ];
    return this.db.select().from(codex_worker_registrations).where(and(...predicates));
  }

  private codexWorkerRecordMatchesRuntimeTarget(
    record: CodexWorkerRegistrationDbRecord,
    input: FindAvailableCodexWorkerInput,
  ): boolean {
    return (
      (input.worker_id === undefined || record.id === input.worker_id) &&
      codexWorkerHeartbeatIsFresh(record.last_heartbeat_at, input.now) &&
      capabilityList(record.capabilities_json, 'target_kinds').includes(input.target_kind) &&
      codexWorkerScopeMatchesTarget(record.allowed_scopes_json, input.target_kind, codexScope(input.project_id, input.repo_id)) &&
      capabilityList(record.capabilities_json, 'docker_image_digests').includes(input.docker_image_digest) &&
      capabilityList(record.capabilities_json, 'network_policy_digests').includes(input.network_policy_digest) &&
      (input.network_provider_config_digest === undefined ||
        capabilityList(record.capabilities_json, 'network_provider_config_digests').includes(input.network_provider_config_digest))
    );
  }

  async getCodexWorkerSessionDigest(workerId: string): Promise<string | undefined> {
    const [row] = await this.db
      .select({ sessionTokenHash: codex_worker_registrations.sessionTokenHash })
      .from(codex_worker_registrations)
      .where(eq(codex_worker_registrations.id, workerId))
      .limit(1);
    return row?.sessionTokenHash;
  }

  async refreshCodexWorkerSession(input: RefreshCodexWorkerSessionInput): Promise<CodexWorkerRegistration> {
    return this.db.transaction(async (tx) => {
      const repository = new DrizzleDeliveryRepository(tx as ForgeloopDrizzleDatabase);
      await repository.assertCodexWorkerSession(
        input.worker_id,
        input.current_session_token,
        'codex_worker_registration_denied',
        input.now,
      );
      await repository.recordCodexWorkerNonce(
        input.worker_id,
        input.current_session_token,
        input.nonce,
        input.nonce_timestamp,
        input.now,
        input.replay_protection,
      );
      const [queuedJob] = await tx
        .select({ id: codex_runtime_jobs.id })
        .from(codex_runtime_jobs)
        .where(and(eq(codex_runtime_jobs.workerId, input.worker_id), eq(codex_runtime_jobs.status, 'queued')))
        .limit(1);
      if (queuedJob !== undefined) {
        throw codexDenied('codex_worker_registration_denied', 'Worker session refresh was rejected while runtime jobs are assigned.');
      }
      const activeJobsResult = await tx.execute(sql<Record<string, unknown>>`
        select
          j.accepted_session_public_key_expires_at,
          j.expires_at as job_expires_at,
          l.expires_at as lease_expires_at,
          e.expires_at as envelope_expires_at
        from codex_runtime_jobs j
        left join codex_launch_leases l on l.id = j.launch_lease_id
        left join codex_launch_token_envelopes e on e.runtime_job_id = j.id
        where j.worker_id = ${input.worker_id}
          and j.status in ('accepted', 'materializing', 'running')
        for update of j
      `);
      const activeJobCanKeepOldSession = (row: Record<string, unknown>): boolean => {
        const acceptedKeyExpiresAt = normalizeTimestampValue(
          'accepted_session_public_key_expires_at',
          row.accepted_session_public_key_expires_at,
        );
        const jobExpiresAt = normalizeTimestampValue('job_expires_at', row.job_expires_at);
        const leaseExpiresAt = normalizeTimestampValue('lease_expires_at', row.lease_expires_at);
        const envelopeExpiresAt = normalizeTimestampValue('envelope_expires_at', row.envelope_expires_at);
        if (
          typeof acceptedKeyExpiresAt !== 'string' ||
          typeof jobExpiresAt !== 'string' ||
          typeof leaseExpiresAt !== 'string' ||
          typeof envelopeExpiresAt !== 'string'
        ) {
          return false;
        }
        return Date.parse(acceptedKeyExpiresAt) >= Math.max(Date.parse(jobExpiresAt), Date.parse(leaseExpiresAt), Date.parse(envelopeExpiresAt));
      };
      if (activeJobsResult.rows.some((row) => !activeJobCanKeepOldSession(row))) {
        throw codexDenied('codex_worker_registration_denied', 'Worker session refresh was rejected while runtime jobs are assigned.');
      }
      const [row] = await tx
        .update(codex_worker_registrations)
        .set({
          sessionTokenHash: codexCredentialPayloadDigest(input.next_session_token),
          sessionTokenExpiresAt: input.next_session_expires_at,
          sessionEpoch: sql`${codex_worker_registrations.sessionEpoch} + 1`,
          sessionPublicKeyId: input.next_session_public_key_id,
          sessionPublicKeyMaterial: input.next_session_public_key_material,
          sessionPublicKeyExpiresAt: input.next_session_public_key_expires_at,
        } as never)
        .where(eq(codex_worker_registrations.id, input.worker_id))
        .returning();
      if (row === undefined) {
        throw codexDenied('codex_worker_registration_denied', 'Worker session refresh was rejected.');
      }
      return registrationFromDbRecord(fromDbRecord<CodexWorkerRegistrationDbRecord>(row as Record<string, unknown>));
    });
  }

  async createOrReplayCodexRuntimeJobWithLeaseAndEnvelope(
    input: CreateOrReplayCodexRuntimeJobWithLeaseAndEnvelopeInput,
  ): Promise<CreateOrReplayCodexRuntimeJobWithLeaseAndEnvelopeResult> {
    validateCodexLaunchTargetKind(input.target.target_type, input.target.target_kind);
    return this.withAdvisoryLocks(this.codexRuntimeJobCreateLockKeys(input), async (repository) =>
      (repository as DrizzleDeliveryRepository).createOrReplayCodexRuntimeJobWithLeaseAndEnvelopeUnlocked(input),
    );
  }

  async getCodexRuntimeJob(input: GetCodexRuntimeJobInput): Promise<CodexRuntimeJob | undefined> {
    const [row] = await this.db
      .select()
      .from(codex_runtime_jobs)
      .where(eq(codex_runtime_jobs.id, input.runtime_job_id))
      .limit(1);
    return row === undefined ? undefined : runtimeJobFromDbRecord(fromDbRecord<CodexRuntimeJobDbRecord>(row as Record<string, unknown>));
  }

  async getActiveCodexGenerationActionRunFence(input: GetActiveCodexGenerationActionRunFenceInput) {
    const [jobRow] = await this.db
      .select()
      .from(codex_runtime_jobs)
      .where(eq(codex_runtime_jobs.id, input.runtime_job_id))
      .limit(1);
    const job = jobRow === undefined ? undefined : fromDbRecord<CodexRuntimeJobDbRecord>(jobRow as Record<string, unknown>);
    if (
      job === undefined ||
      job.target_type !== 'automation_action_run' ||
      job.target_kind !== 'generation' ||
      job.target_id !== input.action_run_id
    ) {
      return undefined;
    }
    const [leaseRow] = await this.db
      .select()
      .from(codex_launch_leases)
      .where(eq(codex_launch_leases.id, job.launch_lease_id))
      .limit(1);
    const lease = leaseRow === undefined ? undefined : fromDbRecord<CodexLaunchLeaseDbRecord>(leaseRow as Record<string, unknown>);
    if (lease === undefined || !(await this.codexGenerationFenceIsActive(lease, input.now))) {
      return undefined;
    }
    const actionRun = await this.getById<AutomationActionRun>(automation_action_runs, automation_action_runs.id, input.action_run_id);
    return actionRun === undefined
      ? undefined
      : {
          runtime_job: runtimeJobFromDbRecord(job),
          action_run: actionRun,
        };
  }

  async getCodexRuntimeJobEnvelope(input: GetCodexRuntimeJobEnvelopeInput): Promise<CodexLaunchTokenEnvelope | undefined> {
    const [row] = await this.db
      .select()
      .from(codex_launch_token_envelopes)
      .where(eq(codex_launch_token_envelopes.runtimeJobId, input.runtime_job_id))
      .limit(1);
    return row === undefined ? undefined : fromDbRecord<CodexLaunchTokenEnvelope>(row as Record<string, unknown>);
  }

  async getCodexRuntimeJobWorkload(input: GetCodexRuntimeJobWorkloadInput): Promise<CodexRuntimeJob> {
    return this.db.transaction(async (tx) => {
      const repository = new DrizzleDeliveryRepository(tx as ForgeloopDrizzleDatabase);
      const session = await repository.assertCodexRuntimeJobWorkerSession(
        input.runtime_job_id,
        input.worker_id,
        input.worker_session_token,
        'codex_runtime_job_unavailable',
        input.now,
      );
      await repository.recordCodexWorkerNonce(
        input.worker_id,
        input.worker_session_token,
        input.nonce,
        input.nonce_timestamp,
        input.now,
        input.replay_protection,
        session.session_epoch,
      );
      const bundle = await repository.lockCodexRuntimeJobBundle(input.runtime_job_id);
      if (
        bundle.job === undefined ||
        bundle.lease === undefined ||
        bundle.job.worker_id !== input.worker_id ||
        (bundle.job.status !== 'accepted' && bundle.job.status !== 'materializing') ||
        bundle.job.cancel_requested_at !== undefined ||
        bundle.job.expires_at <= input.now ||
        bundle.lease.expires_at <= input.now ||
        (bundle.lease.status !== 'active' && bundle.lease.status !== 'materialized') ||
        !(await repository.codexLaunchFenceIsActive(bundle.lease, input.now))
      ) {
        throw codexDenied('codex_runtime_job_unavailable', 'Codex runtime job workload was denied.');
      }
      return runtimeJobFromDbRecord(bundle.job);
    });
  }

  async pollCodexRuntimeJobs(input: PollCodexRuntimeJobsInput): Promise<CodexRuntimeJob[]> {
    return this.db.transaction(async (tx) => {
      const repository = new DrizzleDeliveryRepository(tx as ForgeloopDrizzleDatabase);
      const session = await repository.assertCodexWorkerSession(
        input.worker_id,
        input.worker_session_token,
        'codex_runtime_job_unavailable',
        input.now,
      );
      await repository.recordCodexWorkerNonce(
        input.worker_id,
        input.worker_session_token,
        input.nonce,
        input.nonce_timestamp,
        input.now,
        input.replay_protection,
      );
      if (session.worker.status === 'draining') {
        return [];
      }
      const conditions = [
        eq(codex_runtime_jobs.workerId, input.worker_id),
        eq(codex_runtime_jobs.status, 'queued' as const),
        gt(codex_runtime_jobs.expiresAt, input.now),
      ];
      if (input.target_kinds !== undefined && input.target_kinds.length === 0) {
        return [];
      }
      if (input.target_kinds !== undefined) {
        conditions.push(inArray(codex_runtime_jobs.targetKind, [...input.target_kinds]));
      }
      const rows = await tx
        .select()
        .from(codex_runtime_jobs)
        .where(and(...conditions))
        .orderBy(asc(codex_runtime_jobs.createdAt), asc(codex_runtime_jobs.id))
        .limit(input.limit);
      return rows.map((row) => runtimeJobFromDbRecord(fromDbRecord<CodexRuntimeJobDbRecord>(row as Record<string, unknown>)));
    });
  }

  async acceptCodexRuntimeJob(input: AcceptCodexRuntimeJobInput): Promise<CodexRuntimeJob> {
    return this.withAdvisoryLocks(this.codexRuntimeJobStateLockKeys(input.runtime_job_id, input.worker_id), async (repository) =>
      (repository as DrizzleDeliveryRepository).acceptCodexRuntimeJobUnlocked(input),
    );
  }

  async claimCodexLaunchTokenEnvelope(input: ClaimCodexLaunchTokenEnvelopeInput): Promise<CodexLaunchTokenEnvelope> {
    return this.withAdvisoryLocks(
      [
        ...this.codexRuntimeJobStateLockKeys(input.runtime_job_id, input.worker_id),
        `codex-runtime-envelope:${input.envelope_id}`,
        `codex-runtime-envelope-claim:${input.claim_request_id}`,
      ],
      async (repository) => (repository as DrizzleDeliveryRepository).claimCodexLaunchTokenEnvelopeUnlocked(input),
    );
  }

  async materializeCodexRuntimeJob(input: MaterializeCodexRuntimeJobInput): Promise<CodexLaunchMaterialization> {
    return this.withAdvisoryLocks(
      [...this.codexRuntimeJobStateLockKeys(input.runtime_job_id, input.worker_id), `codex-runtime-lease:${input.launch_lease_id}`],
      async (repository) => (repository as DrizzleDeliveryRepository).materializeCodexRuntimeJobUnlocked(input),
    );
  }

  async startCodexRuntimeJob(input: StartCodexRuntimeJobInput): Promise<CodexRuntimeJob> {
    return this.withAdvisoryLocks(this.codexRuntimeJobStateLockKeys(input.runtime_job_id, input.worker_id), async (repository) =>
      (repository as DrizzleDeliveryRepository).startCodexRuntimeJobUnlocked(input),
    );
  }

  async appendCodexRuntimeJobEvent(input: AppendCodexRuntimeJobEventInput): Promise<CodexRuntimeJob> {
    return this.withAdvisoryLocks(
      [
        ...this.codexRuntimeJobStateLockKeys(input.runtime_job_id, input.worker_id),
        `codex-runtime-event:${input.runtime_job_id}:${input.event_id}`,
        `codex-runtime-event-idempotency:${input.runtime_job_id}:${input.idempotency_key}`,
      ],
      async (repository) => (repository as DrizzleDeliveryRepository).appendCodexRuntimeJobEventUnlocked(input),
    );
  }

  async createOrReplayInternalArtifactObject(input: CreateInternalArtifactObjectInput): Promise<InternalArtifactObject> {
    return this.withAdvisoryLocks(
      [
        `internal-artifact-ref:${input.ref}`,
        `internal-artifact-owner-idempotency:${internalArtifactOwnerIdempotencyKey(input)}`,
        `internal-artifact-owner-kind-artifact:${internalArtifactOwnerKindArtifactKey(input)}`,
      ],
      async (repository) => (repository as DrizzleDeliveryRepository).createOrReplayInternalArtifactObjectUnlocked(input),
    );
  }

  async getInternalArtifactObjectByRef(input: GetInternalArtifactObjectByRefInput): Promise<InternalArtifactObject | undefined> {
    const conditions = [eq(internal_artifact_objects.ref, input.ref)];
    if (input.include_deleted !== true) {
      conditions.push(isNull(internal_artifact_objects.deletedAt));
    }
    const [row] = await this.db
      .select()
      .from(internal_artifact_objects)
      .where(and(...conditions))
      .limit(1);
    return row === undefined
      ? undefined
      : internalArtifactObjectFromDbRecord(fromDbRecord<InternalArtifactObjectDbRecord>(row as Record<string, unknown>));
  }

  async getInternalArtifactObjectById(id: string): Promise<InternalArtifactObject | undefined> {
    const [row] = await this.db
      .select()
      .from(internal_artifact_objects)
      .where(and(eq(internal_artifact_objects.id, id), isNull(internal_artifact_objects.deletedAt)))
      .limit(1);
    return row === undefined
      ? undefined
      : internalArtifactObjectFromDbRecord(fromDbRecord<InternalArtifactObjectDbRecord>(row as Record<string, unknown>));
  }

  async tombstoneInternalArtifactObject(input: TombstoneInternalArtifactObjectInput): Promise<InternalArtifactObject> {
    return this.withAdvisoryLocks([`internal-artifact-ref:${input.ref}`], async (repository) =>
      (repository as DrizzleDeliveryRepository).tombstoneInternalArtifactObjectUnlocked(input),
    );
  }

  async createCodexRuntimeJobArtifact(input: CreateCodexRuntimeJobArtifactInput): Promise<CodexRuntimeJobArtifact> {
    return this.withAdvisoryLocks(
      [
        ...this.codexRuntimeJobStateLockKeys(input.runtime_job_id, input.worker_id),
        `codex-runtime-artifact:${input.runtime_job_id}:${input.artifact_id}`,
        `codex-runtime-artifact-idempotency:${input.runtime_job_id}:${input.artifact_idempotency_key}`,
      ],
      async (repository) => (repository as DrizzleDeliveryRepository).createCodexRuntimeJobArtifactUnlocked(input),
    );
  }

  async reserveCodexRuntimeJobArtifactUpload(input: ReserveCodexRuntimeJobArtifactUploadInput): Promise<void> {
    return this.withAdvisoryLocks(
      [
        ...this.codexRuntimeJobStateLockKeys(input.runtime_job_id, input.worker_id),
        `codex-runtime-artifact:${input.runtime_job_id}:${input.artifact_id}`,
        `codex-runtime-artifact-idempotency:${input.runtime_job_id}:${input.artifact_idempotency_key}`,
      ],
      async (repository) => {
        await (repository as DrizzleDeliveryRepository).reserveCodexRuntimeJobArtifactUploadUnlocked(input);
      },
    );
  }

  async bindReservedCodexRuntimeJobArtifact(input: BindReservedCodexRuntimeJobArtifactInput): Promise<CodexRuntimeJobArtifact> {
    return this.withAdvisoryLocks(
      [
        ...this.codexRuntimeJobStateLockKeys(input.runtime_job_id, input.worker_id),
        `codex-runtime-artifact:${input.runtime_job_id}:${input.artifact_id}`,
        `codex-runtime-artifact-idempotency:${input.runtime_job_id}:${input.artifact_idempotency_key}`,
      ],
      async (repository) => (repository as DrizzleDeliveryRepository).bindReservedCodexRuntimeJobArtifactUnlocked(input),
    );
  }

  async listCodexRuntimeJobArtifacts(input: ListCodexRuntimeJobArtifactsInput): Promise<CodexRuntimeJobArtifact[]> {
    const [jobRow] = await this.db
      .select()
      .from(codex_runtime_jobs)
      .where(eq(codex_runtime_jobs.id, input.runtime_job_id))
      .limit(1);
    if (jobRow === undefined) {
      return [];
    }
    const job = fromDbRecord<CodexRuntimeJobDbRecord>(jobRow as Record<string, unknown>);
    const rows = await this.db
      .select()
      .from(codex_runtime_job_artifacts)
      .where(eq(codex_runtime_job_artifacts.runtimeJobId, input.runtime_job_id))
      .orderBy(asc(codex_runtime_job_artifacts.createdAt), asc(codex_runtime_job_artifacts.id));
    return rows.map((row) => runtimeJobArtifactFromDbRecord(fromDbRecord<CodexRuntimeJobArtifactDbRecord>(row as Record<string, unknown>), job));
  }

  async getCodexRuntimeJobArtifactByInternalRef(
    input: GetCodexRuntimeJobArtifactByInternalRefInput,
  ): Promise<CodexRuntimeJobArtifact | undefined> {
    const [jobRow] = await this.db
      .select()
      .from(codex_runtime_jobs)
      .where(eq(codex_runtime_jobs.id, input.runtime_job_id))
      .limit(1);
    if (jobRow === undefined) {
      return undefined;
    }
    const job = fromDbRecord<CodexRuntimeJobDbRecord>(jobRow as Record<string, unknown>);
    const [artifactRow] = await this.db
      .select()
      .from(codex_runtime_job_artifacts)
      .where(
        and(
          eq(codex_runtime_job_artifacts.runtimeJobId, input.runtime_job_id),
          eq(codex_runtime_job_artifacts.internalRef, input.internal_ref),
        ),
      )
      .limit(1);
    if (artifactRow === undefined) {
      return undefined;
    }
    const artifact = fromDbRecord<CodexRuntimeJobArtifactDbRecord>(artifactRow as Record<string, unknown>);
    const object =
      artifact.internal_artifact_object_id === undefined ? undefined : await this.getInternalArtifactObjectById(artifact.internal_artifact_object_id);
    if (
      object === undefined ||
      object.ref !== artifact.internal_ref ||
      object.owner_type !== 'codex_runtime_job' ||
      object.owner_id !== input.runtime_job_id ||
      object.kind !== 'codex_runtime_job_artifact' ||
      object.artifact_id !== artifact.id ||
      object.digest !== artifact.digest ||
      object.content_type !== artifact.content_type ||
      object.size_bytes !== String(artifact.size_bytes)
    ) {
      return undefined;
    }
    return runtimeJobArtifactFromDbRecord(artifact, job);
  }

  async createPendingWorkspaceBundleArtifact(input: CreatePendingWorkspaceBundleArtifactInput): Promise<void> {
    return this.withAdvisoryLocks([`codex-pending-workspace-bundle:${input.bundle_id}`], async (repository) =>
      (repository as DrizzleDeliveryRepository).createPendingWorkspaceBundleArtifactUnlocked(input),
    );
  }

  private async createPendingWorkspaceBundleArtifactUnlocked(input: CreatePendingWorkspaceBundleArtifactInput): Promise<void> {
    const [leaseRow] = await this.db
      .select()
      .from(run_worker_leases)
      .where(eq(run_worker_leases.runSessionId, input.run_session_id))
      .limit(1);
    const [runSessionRow] = await this.db
      .select()
      .from(run_sessions)
      .where(eq(run_sessions.id, input.run_session_id))
      .limit(1);
    const lease = leaseRow === undefined ? undefined : fromDbRecord<RunWorkerLease>(leaseRow as Record<string, unknown>);
    const runSession = runSessionRow === undefined ? undefined : fromDbRecord<RunSession>(runSessionRow as Record<string, unknown>);
    const archiveBytes =
      input.archive_bytes_base64 === undefined ? undefined : Buffer.from(input.archive_bytes_base64, 'base64');
    const object =
      input.internal_artifact_object_id === undefined ? undefined : await this.getInternalArtifactObjectById(input.internal_artifact_object_id);
    if (
      lease === undefined ||
      runSession === undefined ||
      runSession.execution_package_id !== input.execution_package_id ||
      lease.id !== input.run_worker_lease_id ||
      lease.status !== 'active' ||
      lease.expires_at <= input.created_at ||
      input.internal_artifact_object_id === undefined ||
      (archiveBytes !== undefined &&
        (archiveBytes.toString('base64') !== input.archive_bytes_base64 ||
          archiveBytes.byteLength !== input.size_bytes ||
          rawSha256(archiveBytes) !== input.archive_digest)) ||
      input.expires_at <= input.created_at ||
      input.pending_artifact_ref !==
        `artifact://internal/workspace_bundle/run_session/${input.run_session_id}/${input.bundle_id}` ||
      input.workspace_acquisition_json.bundle_id !== input.bundle_id ||
      input.workspace_acquisition_json.archive_ref !== input.pending_artifact_ref ||
      input.workspace_acquisition_json.archive_digest !== input.archive_digest ||
      input.workspace_acquisition_json.manifest_digest !== input.manifest_digest ||
      input.workspace_acquisition_json.size_bytes !== input.size_bytes ||
      !workspaceBundleAcquisitionMatches(input.workspace_acquisition_json, input) ||
      input.workspace_acquisition_digest !== codexWorkspaceAcquisitionDigest(input.workspace_acquisition_json) ||
      (input.internal_artifact_object_id !== undefined &&
        (object === undefined ||
          object.ref !== input.pending_artifact_ref ||
          object.kind !== 'workspace_bundle' ||
          object.owner_type !== 'run_session' ||
          object.owner_id !== input.run_session_id ||
          object.artifact_id !== input.bundle_id ||
          object.digest !== input.archive_digest ||
          object.size_bytes !== String(input.size_bytes) ||
          object.content_type !== 'application/vnd.forgeloop.workspace-bundle' ||
          object.metadata_json.manifest_digest !== input.manifest_digest ||
          object.metadata_json.execution_package_id !== input.execution_package_id ||
          object.metadata_json.run_worker_lease_id !== input.run_worker_lease_id))
    ) {
      throw codexDenied('codex_runtime_job_unavailable', 'Runtime job pending workspace bundle artifact was rejected.');
    }
    const pending: CodexPendingWorkspaceBundleDbRecord = {
      id: input.id,
      bundle_id: input.bundle_id,
      run_session_id: input.run_session_id,
      execution_package_id: input.execution_package_id,
      pending_artifact_ref: input.pending_artifact_ref,
      ...(input.internal_artifact_object_id === undefined
        ? {}
        : { internal_artifact_object_id: input.internal_artifact_object_id }),
      archive_digest: input.archive_digest,
      manifest_digest: input.manifest_digest,
      ...(input.archive_bytes_base64 === undefined ? {} : { archive_bytes_base64: input.archive_bytes_base64 }),
      size_bytes: input.size_bytes,
      run_worker_lease_id: input.run_worker_lease_id,
      workspace_acquisition_digest: input.workspace_acquisition_digest,
      workspace_acquisition_json: input.workspace_acquisition_json,
      request_digest: input.request_digest,
      expires_at: input.expires_at,
      status: 'pending',
      created_at: input.created_at,
    };
    const [existingRow] = await this.db
      .select()
      .from(codex_pending_workspace_bundles)
      .where(eq(codex_pending_workspace_bundles.bundleId, input.bundle_id))
      .limit(1);
    if (existingRow !== undefined) {
      const existing = fromDbRecord<CodexPendingWorkspaceBundleDbRecord>(existingRow as Record<string, unknown>);
      if (existing.status === 'pending' && valuesEqual(existing, pending)) {
        return;
      }
      if (
        existing.status === 'pending' &&
        existing.runtime_job_id === undefined &&
        existing.run_session_id === input.run_session_id &&
        existing.execution_package_id === input.execution_package_id &&
        existing.id === input.id &&
        existing.request_digest === input.request_digest &&
        existing.pending_artifact_ref === input.pending_artifact_ref &&
        existing.internal_artifact_object_id === input.internal_artifact_object_id &&
        existing.archive_digest === input.archive_digest &&
        existing.manifest_digest === input.manifest_digest &&
        existing.run_worker_lease_id === input.run_worker_lease_id &&
        existing.size_bytes === input.size_bytes &&
        existing.expires_at === input.expires_at &&
        existing.workspace_acquisition_digest === input.workspace_acquisition_digest &&
        valuesEqual(existing.workspace_acquisition_json, input.workspace_acquisition_json) &&
        existing.archive_bytes_base64 === input.archive_bytes_base64
      ) {
        return;
      }
      throw codexDenied('codex_runtime_job_unavailable', 'workspace_bundle_idempotency_drift');
    }
    await this.db.insert(codex_pending_workspace_bundles).values(toDbRecord(pending, codex_pending_workspace_bundles) as never);
  }

  private async createOrReplayInternalArtifactObjectUnlocked(input: CreateInternalArtifactObjectInput): Promise<InternalArtifactObject> {
    assertInternalArtifactObjectInput(input);
    const [existingRefRow] = await this.db
      .select()
      .from(internal_artifact_objects)
      .where(eq(internal_artifact_objects.ref, input.ref))
      .limit(1);
    const [existingIdempotencyRow] = await this.db
      .select()
      .from(internal_artifact_objects)
      .where(
        and(
          eq(internal_artifact_objects.ownerType, input.owner_type),
          eq(internal_artifact_objects.ownerId, input.owner_id),
          eq(internal_artifact_objects.idempotencyKey, input.idempotency_key),
        ),
      )
      .limit(1);
    const [existingOwnerKindArtifactRow] = await this.db
      .select()
      .from(internal_artifact_objects)
      .where(
        and(
          eq(internal_artifact_objects.ownerType, input.owner_type),
          eq(internal_artifact_objects.ownerId, input.owner_id),
          eq(internal_artifact_objects.kind, input.kind),
          eq(internal_artifact_objects.artifactId, input.artifact_id),
        ),
      )
      .limit(1);
    const existingByRef =
      existingRefRow === undefined
        ? undefined
        : internalArtifactObjectFromDbRecord(fromDbRecord<InternalArtifactObjectDbRecord>(existingRefRow as Record<string, unknown>));
    const existingByIdempotency =
      existingIdempotencyRow === undefined
        ? undefined
        : internalArtifactObjectFromDbRecord(
            fromDbRecord<InternalArtifactObjectDbRecord>(existingIdempotencyRow as Record<string, unknown>),
          );
    const existingByOwnerKindArtifact =
      existingOwnerKindArtifactRow === undefined
        ? undefined
        : internalArtifactObjectFromDbRecord(
            fromDbRecord<InternalArtifactObjectDbRecord>(existingOwnerKindArtifactRow as Record<string, unknown>),
          );
    if (
      existingByRef !== undefined &&
      existingByIdempotency !== undefined &&
      existingByRef.id !== existingByIdempotency.id
    ) {
      throw codexDenied('codex_runtime_job_unavailable', 'internal_artifact_ref_conflict');
    }
    const existing = existingByIdempotency ?? existingByRef ?? existingByOwnerKindArtifact;
    if (existing !== undefined) {
      if (existingByRef !== undefined && existing.idempotency_key !== input.idempotency_key) {
        throw codexDenied('codex_runtime_job_unavailable', 'internal_artifact_ref_conflict');
      }
      if (
        existingByOwnerKindArtifact !== undefined &&
        (existing.idempotency_key !== input.idempotency_key || existing.ref !== input.ref)
      ) {
        throw codexDenied('codex_runtime_job_unavailable', 'internal_artifact_owner_kind_artifact_conflict');
      }
      if (this.internalArtifactObjectReplayMatches(existing, input)) {
        return existing;
      }
      throw codexDenied('codex_runtime_job_unavailable', 'internal_artifact_idempotency_drift');
    }
    const [row] = await this.db
      .insert(internal_artifact_objects)
      .values(toDbRecord({ ...input, size_bytes: BigInt(input.size_bytes) }, internal_artifact_objects) as never)
      .returning();
    if (row === undefined) {
      throw codexDenied('codex_runtime_job_unavailable', 'internal_artifact_create_failed');
    }
    return internalArtifactObjectFromDbRecord(fromDbRecord<InternalArtifactObjectDbRecord>(row as Record<string, unknown>));
  }

  async getWorkspaceBundleDownloadForRuntimeJob(
    input: GetWorkspaceBundleDownloadForRuntimeJobInput,
  ): Promise<WorkspaceBundleDownloadForRuntimeJob> {
    const session = await this.assertCodexRuntimeJobWorkerSession(
      input.runtime_job_id,
      input.worker_id,
      input.worker_session_token,
      'codex_runtime_job_unavailable',
      input.now,
    );
    await this.recordCodexWorkerNonce(
      input.worker_id,
      input.worker_session_token,
      input.nonce,
      input.nonce_timestamp,
      input.now,
      input.replay_protection,
      session.session_epoch,
    );
    const [jobRow] = await this.db.select().from(codex_runtime_jobs).where(eq(codex_runtime_jobs.id, input.runtime_job_id)).limit(1);
    const [pendingRow] = await this.db
      .select()
      .from(codex_pending_workspace_bundles)
      .where(and(eq(codex_pending_workspace_bundles.runtimeJobId, input.runtime_job_id), eq(codex_pending_workspace_bundles.bundleId, input.bundle_id)))
      .limit(1);
    const [artifactRow] = await this.db
      .select()
      .from(codex_runtime_job_artifacts)
      .where(and(eq(codex_runtime_job_artifacts.runtimeJobId, input.runtime_job_id), eq(codex_runtime_job_artifacts.kind, 'workspace_bundle')))
      .limit(1);
    const job = jobRow === undefined ? undefined : fromDbRecord<CodexRuntimeJobDbRecord>(jobRow as Record<string, unknown>);
    const pending =
      pendingRow === undefined ? undefined : fromDbRecord<CodexPendingWorkspaceBundleDbRecord>(pendingRow as Record<string, unknown>);
    const artifact =
      artifactRow === undefined ? undefined : fromDbRecord<CodexRuntimeJobArtifactDbRecord>(artifactRow as Record<string, unknown>);
    const lease = job === undefined ? undefined : await this.lockCodexLaunchLease(job.launch_lease_id);
    if (
      job === undefined ||
      lease === undefined ||
      pending === undefined ||
      artifact === undefined ||
      job.worker_id !== input.worker_id ||
      job.target_kind !== 'run_execution' ||
      (job.status !== 'accepted' && job.status !== 'materializing') ||
      job.cancel_requested_at !== undefined ||
      job.expires_at <= input.now ||
      lease.expires_at <= input.now ||
      (lease.status !== 'active' && lease.status !== 'materialized') ||
      pending.status !== 'bound' ||
      pending.runtime_job_id !== job.id ||
      pending.expires_at <= input.now ||
      artifact.runtime_job_id !== job.id ||
      artifact.kind !== 'workspace_bundle' ||
      artifact.name !== pending.bundle_id ||
      artifact.digest !== pending.archive_digest ||
      artifact.size_bytes !== pending.size_bytes ||
      artifact.internal_ref !== pending.pending_artifact_ref ||
      artifact.internal_artifact_object_id !== pending.internal_artifact_object_id ||
      job.workspace_acquisition_json?.bundle_id !== pending.bundle_id ||
      job.workspace_acquisition_json?.archive_ref !== pending.pending_artifact_ref ||
      job.workspace_acquisition_json?.archive_digest !== pending.archive_digest ||
      job.workspace_acquisition_json?.manifest_digest !== pending.manifest_digest ||
      job.workspace_acquisition_json?.size_bytes !== pending.size_bytes
    ) {
      throw codexDenied('codex_runtime_job_unavailable', 'Runtime job workspace bundle download was denied.');
    }
    if (pending.archive_bytes_base64 !== undefined) {
      const archiveBytes = Buffer.from(pending.archive_bytes_base64, 'base64');
      if (
        archiveBytes.byteLength !== pending.size_bytes ||
        rawSha256(archiveBytes) !== pending.archive_digest ||
        workspaceBundleArchiveManifestDigest(archiveBytes) !== pending.manifest_digest
      ) {
        throw codexDenied('codex_runtime_job_unavailable', 'Runtime job workspace bundle bytes were rejected.');
      }
    }
    return {
      bundle_id: pending.bundle_id,
      ...(pending.archive_bytes_base64 === undefined ? {} : { archive_bytes_base64: pending.archive_bytes_base64 }),
      archive_ref: pending.pending_artifact_ref,
      ...(pending.internal_artifact_object_id === undefined
        ? {}
        : { internal_artifact_object_id: pending.internal_artifact_object_id }),
      archive_digest: pending.archive_digest,
      manifest_digest: pending.manifest_digest,
      content_type: 'application/vnd.forgeloop.workspace-bundle',
      size_bytes: pending.size_bytes,
      expires_at: pending.expires_at,
    };
  }

  async cancelCodexRuntimeJob(input: CancelCodexRuntimeJobInput): Promise<CodexRuntimeJob> {
    return this.withAdvisoryLocks([`codex-runtime-job:${input.runtime_job_id}`], async (repository) =>
      (repository as DrizzleDeliveryRepository).cancelCodexRuntimeJobUnlocked(input),
    );
  }

  async terminalizeCodexRuntimeJob(input: TerminalizeCodexRuntimeJobInput): Promise<CodexRuntimeJob> {
    return this.withAdvisoryLocks(
      [...this.codexRuntimeJobStateLockKeys(input.runtime_job_id, input.worker_id), `codex-runtime-lease:${input.launch_lease_id}`],
      async (repository) => (repository as DrizzleDeliveryRepository).terminalizeCodexRuntimeJobUnlocked(input),
    );
  }

  async recoverStaleCodexRuntimeJobs(input: RecoverStaleCodexRuntimeJobsInput): Promise<RecoverStaleCodexRuntimeJobsResult> {
    return this.withAdvisoryLocks(
      [`codex-runtime-recovery:${input.worker_id ?? 'all'}`],
      async (repository) => (repository as DrizzleDeliveryRepository).recoverStaleCodexRuntimeJobsUnlocked(input),
    );
  }

  async getCodexLaunchLeaseStatus(input: GetCodexLaunchLeaseStatusInput): Promise<CodexLaunchLease> {
    return this.db.transaction(async (tx) => {
      const repository = new DrizzleDeliveryRepository(tx as ForgeloopDrizzleDatabase);
      await repository.assertCodexWorkerSession(input.worker_id, input.worker_session_token, 'codex_runtime_job_unavailable', input.now, {
        requireConnected: false,
      });
      await repository.recordCodexWorkerNonce(
        input.worker_id,
        input.worker_session_token,
        input.nonce,
        input.nonce_timestamp,
        input.now,
        input.replay_protection,
      );
      const [row] = await tx
        .select()
        .from(codex_launch_leases)
        .where(and(eq(codex_launch_leases.id, input.launch_lease_id), eq(codex_launch_leases.workerId, input.worker_id)))
        .limit(1);
      if (row === undefined) {
        throw codexDenied('codex_runtime_job_unavailable', 'Codex launch lease status was denied.');
      }
      return launchLeaseFromDbRecord(fromDbRecord<CodexLaunchLeaseDbRecord>(row as Record<string, unknown>));
    });
  }

  async getCodexLaunchLeasePublicStatus(input: GetCodexLaunchLeasePublicStatusInput): Promise<CodexLaunchLease | undefined> {
    const [row] = await this.db
      .select()
      .from(codex_launch_leases)
      .where(eq(codex_launch_leases.id, input.launch_lease_id))
      .limit(1);
    return row === undefined ? undefined : launchLeaseFromDbRecord(fromDbRecord<CodexLaunchLeaseDbRecord>(row as Record<string, unknown>));
  }

  private async acceptCodexRuntimeJobUnlocked(input: AcceptCodexRuntimeJobInput): Promise<CodexRuntimeJob> {
    await this.assertCodexWorkerSession(input.worker_id, input.worker_session_token, 'codex_runtime_job_unavailable', input.now);
    await this.recordCodexWorkerNonce(
      input.worker_id,
      input.worker_session_token,
      input.nonce,
      input.nonce_timestamp,
      input.now,
      input.replay_protection,
    );
    const worker = await this.lockCodexWorkerRegistration(input.worker_id);
    const bundle = await this.lockCodexRuntimeJobBundle(input.runtime_job_id);
    if (
      worker === undefined ||
      bundle.job === undefined ||
      bundle.lease === undefined ||
      bundle.envelope === undefined ||
      bundle.job.worker_id !== input.worker_id ||
      bundle.job.expires_at <= input.now ||
      bundle.lease.status !== 'active' ||
      bundle.envelope.status !== 'available'
    ) {
      throw codexDenied('codex_runtime_job_unavailable', 'Codex runtime job accept was denied.');
    }
    if (bundle.job.status === 'accepted') {
      if (
        bundle.job.accept_idempotency_key === input.idempotency_key &&
        bundle.job.accept_request_digest === input.request_digest &&
        bundle.job.accepted_worker_session_digest === input.accepted_worker_session_digest &&
        bundle.job.accepted_session_public_key_id === input.accepted_session_public_key_id &&
        bundle.job.accepted_session_epoch === input.accepted_session_epoch
      ) {
        return runtimeJobFromDbRecord(bundle.job);
      }
      throw codexDenied('codex_runtime_job_unavailable', 'Codex runtime job accept replay was denied.');
    }
    if (
      bundle.job.status !== 'queued' ||
      input.accepted_worker_session_digest !== worker.session_token_hash ||
      input.accepted_session_public_key_id !== worker.session_public_key_id ||
      input.accepted_session_epoch !== worker.session_epoch ||
      worker.session_public_key_expires_at <= input.now
    ) {
      throw codexDenied('codex_runtime_job_unavailable', 'Codex runtime job accept was denied.');
    }
    const [row] = await this.db
      .update(codex_runtime_jobs)
      .set({
        status: 'accepted',
        acceptIdempotencyKey: input.idempotency_key,
        acceptRequestDigest: input.request_digest,
        acceptedAt: input.now,
        acceptedWorkerSessionDigest: input.accepted_worker_session_digest,
        acceptedSessionPublicKeyId: input.accepted_session_public_key_id,
        acceptedSessionPublicKeyExpiresAt: worker.session_public_key_expires_at,
        acceptedSessionEpoch: input.accepted_session_epoch,
        updatedAt: input.now,
      } as never)
      .where(and(eq(codex_runtime_jobs.id, input.runtime_job_id), eq(codex_runtime_jobs.status, 'queued')))
      .returning();
    if (row === undefined) {
      throw codexDenied('codex_runtime_job_unavailable', 'Codex runtime job accept was denied.');
    }
    return runtimeJobFromDbRecord(fromDbRecord<CodexRuntimeJobDbRecord>(row as Record<string, unknown>));
  }

  private async claimCodexLaunchTokenEnvelopeUnlocked(input: ClaimCodexLaunchTokenEnvelopeInput): Promise<CodexLaunchTokenEnvelope> {
    const session = await this.assertCodexRuntimeJobWorkerSession(
      input.runtime_job_id,
      input.worker_id,
      input.worker_session_token,
      'codex_launch_materialization_denied',
      input.now,
    );
    await this.recordCodexWorkerNonce(
      input.worker_id,
      input.worker_session_token,
      input.nonce,
      input.nonce_timestamp,
      input.now,
      input.replay_protection,
      session.session_epoch,
    );
    const worker = await this.lockCodexWorkerRegistration(input.worker_id);
    const bundle = await this.lockCodexRuntimeJobBundle(input.runtime_job_id);
    if (
      worker === undefined ||
      bundle.job === undefined ||
      bundle.lease === undefined ||
      bundle.envelope === undefined ||
      bundle.envelope.id !== input.envelope_id ||
      bundle.job.worker_id !== input.worker_id ||
      bundle.job.expires_at <= input.now ||
      bundle.envelope.expires_at <= input.now ||
      bundle.job.accepted_worker_session_digest !== input.accepted_worker_session_digest ||
      bundle.job.accepted_session_public_key_id !== input.key_id ||
      bundle.job.accepted_session_epoch !== input.accepted_session_epoch ||
      session.session_public_key_id !== input.key_id ||
      session.session_epoch !== input.accepted_session_epoch ||
      session.session_public_key_expires_at <= input.now
    ) {
      throw codexDenied('codex_launch_materialization_denied', 'Codex launch token envelope claim was denied.');
    }
    if (bundle.envelope.status === 'claimed') {
      if (
        bundle.job.status !== 'terminal' &&
        bundle.lease.expires_at > input.now &&
        (bundle.lease.status === 'active' || bundle.lease.status === 'materialized') &&
        bundle.envelope.claim_request_id === input.claim_request_id &&
        bundle.envelope.claim_request_digest === input.request_digest &&
        bundle.envelope.claimed_worker_session_digest === input.accepted_worker_session_digest &&
        bundle.envelope.claimed_key_id === input.key_id
      ) {
        return bundle.envelope;
      }
      throw codexDenied('codex_launch_materialization_denied', 'Codex launch token envelope claim was denied.');
    }
    if (bundle.envelope.status !== 'available') {
      throw codexDenied('codex_launch_materialization_denied', 'Codex launch token envelope claim was denied.');
    }
    if (bundle.job.status !== 'accepted' || bundle.job.cancel_requested_at !== undefined || bundle.lease.status !== 'active') {
      throw codexDenied('codex_launch_materialization_denied', 'Codex launch token envelope claim was denied.');
    }
    const [row] = await this.db
      .update(codex_launch_token_envelopes)
      .set({
        status: 'claimed',
        claimRequestId: input.claim_request_id,
        claimRequestDigest: input.request_digest,
        claimedWorkerSessionDigest: input.accepted_worker_session_digest,
        claimedKeyId: input.key_id,
        claimedAt: input.now,
      } as never)
      .where(and(eq(codex_launch_token_envelopes.id, input.envelope_id), eq(codex_launch_token_envelopes.status, 'available')))
      .returning();
    if (row === undefined) {
      throw codexDenied('codex_launch_materialization_denied', 'Codex launch token envelope claim was denied.');
    }
    return fromDbRecord<CodexLaunchTokenEnvelope>(row as Record<string, unknown>);
  }

  private async materializeCodexRuntimeJobUnlocked(input: MaterializeCodexRuntimeJobInput): Promise<CodexLaunchMaterialization> {
    const session = await this.assertCodexRuntimeJobWorkerSession(
      input.runtime_job_id,
      input.worker_id,
      input.worker_session_token,
      'codex_launch_materialization_denied',
      input.now,
    );
    await this.recordCodexWorkerNonce(
      input.worker_id,
      input.worker_session_token,
      input.nonce,
      input.nonce_timestamp,
      input.now,
      input.replay_protection,
      session.session_epoch,
    );
    const worker = await this.lockCodexWorkerRegistration(input.worker_id);
    const bundle = await this.lockCodexRuntimeJobBundle(input.runtime_job_id);
    if (
      worker === undefined ||
      bundle.job === undefined ||
      bundle.lease === undefined ||
      bundle.envelope === undefined ||
      bundle.job.launch_lease_id !== input.launch_lease_id ||
      bundle.job.worker_id !== input.worker_id ||
      bundle.job.accepted_worker_session_digest !== input.accepted_worker_session_digest ||
      bundle.job.accepted_session_public_key_id !== input.accepted_session_public_key_id ||
      bundle.job.accepted_session_epoch !== input.accepted_session_epoch ||
      bundle.job.expires_at <= input.now ||
      bundle.lease.expires_at <= input.now ||
      bundle.lease.worker_id !== input.worker_id ||
      bundle.lease.lease_token_hash !== input.launch_token_hash ||
      bundle.envelope.status !== 'claimed' ||
      bundle.envelope.claimed_worker_session_digest !== input.accepted_worker_session_digest ||
      bundle.envelope.claimed_key_id !== input.accepted_session_public_key_id ||
      session.session_epoch !== input.accepted_session_epoch ||
      session.session_public_key_expires_at <= input.now
    ) {
      throw codexDenied('codex_launch_materialization_denied', 'Codex runtime job materialization was denied.');
    }
    if (isCodexSessionResumeRuntimeJobInput(bundle.job.input_json)) {
      throw codexDenied(
        'codex_session_runner_unavailable',
        'codex_session_runner_unavailable: Codex session resume jobs must attach to the session runner.',
      );
    }
    if (bundle.job.status === 'materializing' || bundle.job.status === 'running') {
      if (
        bundle.job.materialization_request_id === input.materialization_request_id &&
        bundle.job.materialization_request_digest === input.request_digest &&
        bundle.lease.status === 'materialized'
      ) {
        return this.codexRuntimeJobMaterialization(bundle.job, bundle.lease, input.now);
      }
      throw codexDenied('codex_launch_materialization_denied', 'Codex runtime job materialization was denied.');
    }
    if (bundle.job.cancel_requested_at !== undefined) {
      throw codexDenied('codex_launch_materialization_denied', 'Codex runtime job materialization was denied.');
    }
    if (bundle.job.status !== 'accepted' || bundle.lease.status !== 'active') {
      throw codexDenied('codex_launch_materialization_denied', 'Codex runtime job materialization was denied.');
    }
    if (!this.codexLaunchFenceSnapshotMatches(bundle.lease, input.active_fence) || !(await this.codexLaunchFenceIsActive(bundle.lease, input.now))) {
      throw codexDenied('codex_launch_materialization_denied', 'Codex runtime job materialization fence was denied.');
    }
    await this.assertCodexRuntimeJobMaterializationDependencies(bundle.job, bundle.lease);
    const [jobRow] = await this.db
      .update(codex_runtime_jobs)
      .set({
        status: 'materializing',
        materializingAt: input.now,
        materializationRequestId: input.materialization_request_id,
        materializationRequestDigest: input.request_digest,
        updatedAt: input.now,
      } as never)
      .where(and(eq(codex_runtime_jobs.id, input.runtime_job_id), eq(codex_runtime_jobs.status, 'accepted')))
      .returning();
    const [leaseRow] = await this.db
      .update(codex_launch_leases)
      .set({ status: 'materialized', materializationRequestHash: input.request_digest, materializedAt: input.now } as never)
      .where(and(eq(codex_launch_leases.id, input.launch_lease_id), eq(codex_launch_leases.status, 'active')))
      .returning();
    if (jobRow === undefined || leaseRow === undefined) {
      throw codexDenied('codex_launch_materialization_denied', 'Codex runtime job materialization was denied.');
    }
    return this.codexRuntimeJobMaterialization(
      fromDbRecord<CodexRuntimeJobDbRecord>(jobRow as Record<string, unknown>),
      fromDbRecord<CodexLaunchLeaseDbRecord>(leaseRow as Record<string, unknown>),
      input.now,
    );
  }

  private async startCodexRuntimeJobUnlocked(input: StartCodexRuntimeJobInput): Promise<CodexRuntimeJob> {
    const session = await this.assertCodexRuntimeJobWorkerSession(
      input.runtime_job_id,
      input.worker_id,
      input.worker_session_token,
      'codex_runtime_job_unavailable',
      input.now,
    );
    await this.recordCodexWorkerNonce(
      input.worker_id,
      input.worker_session_token,
      input.nonce,
      input.nonce_timestamp,
      input.now,
      input.replay_protection,
      session.session_epoch,
    );
    const bundle = await this.lockCodexRuntimeJobBundle(input.runtime_job_id);
    if (
      bundle.job === undefined ||
      bundle.lease === undefined ||
      bundle.job.worker_id !== input.worker_id ||
      bundle.lease.worker_id !== input.worker_id ||
      bundle.job.cancel_requested_at !== undefined ||
      bundle.job.expires_at <= input.now
    ) {
      throw codexDenied('codex_runtime_job_unavailable', 'Codex runtime job start was denied.');
    }
    if (isCodexSessionResumeRuntimeJobInput(bundle.job.input_json)) {
      throw codexDenied(
        'codex_session_runner_unavailable',
        'codex_session_runner_unavailable: Codex session resume jobs must attach to the session runner.',
      );
    }
    if (bundle.job.status === 'running') {
      if (
        bundle.job.start_idempotency_key === input.idempotency_key &&
        bundle.job.start_request_digest === input.request_digest &&
        bundle.job.runtime_evidence_digest === input.runtime_evidence_digest &&
        bundle.job.launch_materialization_digest === input.launch_materialization_digest
      ) {
        return runtimeJobFromDbRecord(bundle.job);
      }
      throw codexDenied('codex_runtime_job_unavailable', 'Codex runtime job start was denied.');
    }
    if (bundle.job.status !== 'materializing' || bundle.lease.status !== 'materialized') {
      throw codexDenied('codex_runtime_job_unavailable', 'Codex runtime job start was denied.');
    }
    const [row] = await this.db
      .update(codex_runtime_jobs)
      .set({
        status: 'running',
        startIdempotencyKey: input.idempotency_key,
        startRequestDigest: input.request_digest,
        runtimeEvidenceDigest: input.runtime_evidence_digest,
        launchMaterializationDigest: input.launch_materialization_digest,
        startedAt: input.now,
        updatedAt: input.now,
      } as never)
      .where(and(eq(codex_runtime_jobs.id, input.runtime_job_id), eq(codex_runtime_jobs.status, 'materializing')))
      .returning();
    if (row === undefined) {
      throw codexDenied('codex_runtime_job_unavailable', 'Codex runtime job start was denied.');
    }
    return runtimeJobFromDbRecord(fromDbRecord<CodexRuntimeJobDbRecord>(row as Record<string, unknown>));
  }

  private async appendCodexRuntimeJobEventUnlocked(input: AppendCodexRuntimeJobEventInput): Promise<CodexRuntimeJob> {
    const session = await this.assertCodexRuntimeJobWorkerSession(
      input.runtime_job_id,
      input.worker_id,
      input.worker_session_token,
      'codex_runtime_job_unavailable',
      input.now,
    );
    await this.recordCodexWorkerNonce(
      input.worker_id,
      input.worker_session_token,
      input.nonce,
      input.nonce_timestamp,
      input.now,
      input.replay_protection,
      session.session_epoch,
    );
    const eventObjectId = this.codexRuntimeJobEventObjectId(input.runtime_job_id, input.event_id);
    const idempotencyObjectId = this.codexRuntimeJobEventIdempotencyObjectId(input.runtime_job_id, input.idempotency_key);
    const [existingByEventId, existingByIdempotency] = await Promise.all([
      this.getCodexRuntimeJobEventRecord(eventObjectId),
      this.getCodexRuntimeJobEventRecord(idempotencyObjectId),
    ]);
    const existing = existingByEventId ?? existingByIdempotency;
    if (existing !== undefined || existingByEventId !== existingByIdempotency) {
      if (
        existing !== undefined &&
        existing.event_id === input.event_id &&
        existing.idempotency_key === input.idempotency_key &&
        existing.request_digest === input.request_digest
      ) {
        return existing.job;
      }
      throw codexDenied('codex_runtime_job_unavailable', 'Codex runtime job event replay was denied.');
    }
    const bundle = await this.lockCodexRuntimeJobBundle(input.runtime_job_id);
    if (
      bundle.job === undefined ||
      bundle.job.worker_id !== input.worker_id ||
      bundle.job.status !== 'running' ||
      bundle.job.expires_at <= input.now
    ) {
      throw codexDenied('codex_runtime_job_unavailable', 'Codex runtime job event append was denied.');
    }
    const [row] = await this.db
      .update(codex_runtime_jobs)
      .set({ lastEventAt: input.now, updatedAt: input.now } as never)
      .where(and(eq(codex_runtime_jobs.id, input.runtime_job_id), eq(codex_runtime_jobs.status, 'running')))
      .returning();
    if (row === undefined) {
      throw codexDenied('codex_runtime_job_unavailable', 'Codex runtime job event append was denied.');
    }
    const job = runtimeJobFromDbRecord(fromDbRecord<CodexRuntimeJobDbRecord>(row as Record<string, unknown>));
    const eventRecord = {
      runtime_job_id: input.runtime_job_id,
      event_id: input.event_id,
      idempotency_key: input.idempotency_key,
      request_digest: input.request_digest,
      job,
    };
    await this.db.insert(object_events).values([
      {
        id: eventObjectId,
        objectType: 'codex_runtime_job_event',
        objectId: eventObjectId,
        eventType: input.event_type,
        actorType: 'codex_worker',
        actorId: input.worker_id,
        payload: input.event_payload_json,
        metadata: eventRecord,
        createdAt: input.now,
      },
      {
        id: idempotencyObjectId,
        objectType: 'codex_runtime_job_event_idempotency',
        objectId: idempotencyObjectId,
        eventType: input.event_type,
        actorType: 'codex_worker',
        actorId: input.worker_id,
        payload: input.event_payload_json,
        metadata: eventRecord,
        createdAt: input.now,
      },
    ] as never);
    return job;
  }

  private async createCodexRuntimeJobArtifactUnlocked(input: CreateCodexRuntimeJobArtifactInput): Promise<CodexRuntimeJobArtifact> {
    await this.reserveCodexRuntimeJobArtifactUploadUnlocked(input);
    return this.bindReservedCodexRuntimeJobArtifactUnlocked(input);
  }

  private async reserveCodexRuntimeJobArtifactUploadUnlocked(input: ReserveCodexRuntimeJobArtifactUploadInput): Promise<void> {
    const session = await this.preflightCreateCodexRuntimeJobArtifactUnlocked(input);
    await this.recordCodexWorkerNonce(
      input.worker_id,
      input.worker_session_token,
      input.nonce,
      input.nonce_timestamp,
      input.now,
      input.replay_protection,
      session.session_epoch,
    );
  }

  private async bindReservedCodexRuntimeJobArtifactUnlocked(
    input: BindReservedCodexRuntimeJobArtifactInput,
  ): Promise<CodexRuntimeJobArtifact> {
    const bundle = await this.lockCodexRuntimeJobBundle(input.runtime_job_id);
    if (bundle.job === undefined || bundle.job.accepted_session_epoch === undefined) {
      throw codexDenied('codex_runtime_job_unavailable', 'Codex runtime job artifact upload was denied.');
    }
    this.assertCodexRuntimeJobArtifactEligibility(bundle, input);
    await this.assertCodexWorkerNonceRecorded(
      input.worker_id,
      input.worker_session_token,
      input.nonce,
      input.replay_protection,
      bundle.job.accepted_session_epoch,
    );
    await this.assertCodexRuntimeJobArtifactObjectBinding(input);
    const existing = await this.findCodexRuntimeJobArtifactReplay(input);
    if (existing !== undefined) {
      if (this.codexRuntimeJobArtifactReplayMatches(existing, input)) {
        return runtimeJobArtifactFromDbRecord(existing, bundle.job);
      }
      throw codexDenied('codex_runtime_job_unavailable', 'Codex runtime job artifact replay was denied.');
    }
    const [row] = await this.db
      .insert(codex_runtime_job_artifacts)
      .values({
        id: input.artifact_id,
        runtimeJobId: input.runtime_job_id,
        artifactIdempotencyKey: input.artifact_idempotency_key,
        kind: input.kind,
        name: input.name,
        contentType: input.content_type,
        digest: input.digest,
        internalRef: input.internal_ref,
        internalArtifactObjectId: input.internal_artifact_object_id,
        sizeBytes: input.size_bytes,
        metadataJson: input.metadata_json,
        requestDigest: input.request_digest,
        createdAt: input.now,
      } as never)
      .returning();
    if (row === undefined) {
      throw codexDenied('codex_runtime_job_unavailable', 'Codex runtime job artifact upload was denied.');
    }
    return runtimeJobArtifactFromDbRecord(fromDbRecord<CodexRuntimeJobArtifactDbRecord>(row as Record<string, unknown>), bundle.job);
  }

  private async cancelCodexRuntimeJobUnlocked(input: CancelCodexRuntimeJobInput): Promise<CodexRuntimeJob> {
    const bundle = await this.lockCodexRuntimeJobBundle(input.runtime_job_id);
    if (bundle.job === undefined) {
      throw codexDenied('codex_runtime_job_unavailable', 'Codex runtime job cancel was denied.');
    }
    if (bundle.job.cancel_requested_at !== undefined) {
      if (bundle.job.cancel_idempotency_key !== input.idempotency_key || bundle.job.cancel_request_digest !== input.request_digest) {
        throw codexDenied('codex_runtime_job_unavailable', 'Codex runtime job cancel was denied.');
      }
      return runtimeJobFromDbRecord(bundle.job);
    }
    const terminalizeImmediately =
      bundle.job.status === 'queued' ||
      (bundle.job.status === 'accepted' && bundle.envelope !== undefined && bundle.envelope.status === 'available');
    if (terminalizeImmediately) {
      const [jobRow] = await this.db
        .update(codex_runtime_jobs)
        .set({
          status: 'terminal',
          cancelRequestedAt: input.now,
          cancelIdempotencyKey: input.idempotency_key,
          cancelRequestDigest: input.request_digest,
          terminalIdempotencyKey: input.idempotency_key,
          terminalRequestDigest: input.request_digest,
          terminalAt: input.now,
          terminalStatus: 'cancelled',
          terminalReasonCode: input.reason_code,
          updatedAt: input.now,
        } as never)
        .where(and(eq(codex_runtime_jobs.id, input.runtime_job_id), eq(codex_runtime_jobs.status, bundle.job.status)))
        .returning();
      if (jobRow === undefined) {
        throw codexDenied('codex_runtime_job_unavailable', 'Codex runtime job cancel was denied.');
      }
      if (bundle.lease !== undefined && (bundle.lease.status === 'active' || bundle.lease.status === 'materialized')) {
        const [leaseRow] = await this.db
          .update(codex_launch_leases)
          .set({ status: 'revoked', terminalizedAt: input.now, terminalReasonCode: input.reason_code } as never)
          .where(
            and(
              eq(codex_launch_leases.id, bundle.lease.id),
              or(eq(codex_launch_leases.status, 'active'), eq(codex_launch_leases.status, 'materialized')),
            ),
          )
          .returning();
        if (
          leaseRow !== undefined &&
          bundle.lease.worker_id !== undefined &&
          (await this.codexLaunchLeaseOccupiesWorkerSlot(bundle.lease.id))
        ) {
          await this.decrementCodexWorkerLeaseCounts(this.db, [bundle.lease.worker_id]);
        }
      }
      if (bundle.envelope !== undefined && bundle.envelope.status === 'available') {
        await this.db
          .update(codex_launch_token_envelopes)
          .set({ status: 'revoked' } as never)
          .where(and(eq(codex_launch_token_envelopes.id, bundle.envelope.id), eq(codex_launch_token_envelopes.status, 'available')));
      }
      return runtimeJobFromDbRecord(fromDbRecord<CodexRuntimeJobDbRecord>(jobRow as Record<string, unknown>));
    }
    if (bundle.job.status !== 'accepted' && bundle.job.status !== 'materializing' && bundle.job.status !== 'running') {
      throw codexDenied('codex_runtime_job_unavailable', 'Codex runtime job cancel was denied.');
    }
    const [row] = await this.db
      .update(codex_runtime_jobs)
      .set({
        cancelRequestedAt: input.now,
        cancelIdempotencyKey: input.idempotency_key,
        cancelRequestDigest: input.request_digest,
        drainRequestedAt: bundle.job.status === 'running' ? input.now : null,
        updatedAt: input.now,
      } as never)
      .where(eq(codex_runtime_jobs.id, input.runtime_job_id))
      .returning();
    if (row === undefined) {
      throw codexDenied('codex_runtime_job_unavailable', 'Codex runtime job cancel was denied.');
    }
    return runtimeJobFromDbRecord(fromDbRecord<CodexRuntimeJobDbRecord>(row as Record<string, unknown>));
  }

  private async terminalizeCodexRuntimeJobUnlocked(input: TerminalizeCodexRuntimeJobInput): Promise<CodexRuntimeJob> {
    const session = await this.assertCodexRuntimeJobWorkerSession(
      input.runtime_job_id,
      input.worker_id,
      input.worker_session_token,
      'codex_runtime_job_unavailable',
      input.now,
      {
        requireConnected: false,
      },
    );
    await this.recordCodexWorkerNonce(
      input.worker_id,
      input.worker_session_token,
      input.nonce,
      input.nonce_timestamp,
      input.now,
      input.replay_protection,
      session.session_epoch,
    );
    const bundle = await this.lockCodexRuntimeJobBundle(input.runtime_job_id);
    if (
      bundle.job === undefined ||
      bundle.lease === undefined ||
      bundle.job.launch_lease_id !== input.launch_lease_id ||
      bundle.job.worker_id !== input.worker_id ||
      bundle.lease.worker_id !== input.worker_id
    ) {
      throw codexDenied('codex_runtime_job_unavailable', 'Codex runtime job terminalization was denied.');
    }
    if (bundle.job.status === 'terminal') {
      if (bundle.job.terminal_idempotency_key === input.idempotency_key && bundle.job.terminal_request_digest === input.request_digest) {
        return runtimeJobFromDbRecord(bundle.job);
      }
      throw codexDenied('codex_runtime_job_unavailable', 'Codex runtime job terminalization was denied.');
    }
    if (bundle.job.status !== 'accepted' && bundle.job.status !== 'materializing' && bundle.job.status !== 'running') {
      throw codexDenied('codex_runtime_job_unavailable', 'Codex runtime job terminalization was denied.');
    }
    if (bundle.lease.status !== 'active' && bundle.lease.status !== 'materialized') {
      throw codexDenied('codex_runtime_job_unavailable', 'Codex runtime job terminalization was denied.');
    }
    if (bundle.job.expires_at <= input.now || bundle.lease.expires_at <= input.now) {
      throw codexDenied('codex_runtime_job_unavailable', 'Codex runtime job terminalization was denied.');
    }
    if (bundle.job.cancel_requested_at !== undefined && input.terminal_status !== 'cancelled') {
      throw codexDenied('codex_runtime_job_unavailable', 'Codex runtime job terminalization was denied.');
    }
    if (
      input.terminal_status === 'succeeded' &&
      (bundle.job.status !== 'running' ||
        bundle.lease.status !== 'materialized' ||
        bundle.job.started_at === undefined ||
        bundle.job.runtime_evidence_digest === undefined ||
        bundle.job.launch_materialization_digest === undefined)
    ) {
      throw codexDenied('codex_runtime_job_unavailable', 'Codex runtime job terminalization was denied.');
    }
    const terminalResultJson =
      input.terminal_result_json === undefined ? undefined : validateCodexRuntimeJobTerminalResult(input.terminal_result_json);
    if (terminalResultJson !== undefined) {
      await this.assertCodexRuntimeTerminalArtifactRefs(input.runtime_job_id, terminalResultJson as unknown as Record<string, unknown>);
    }
    const [jobRow] = await this.db
      .update(codex_runtime_jobs)
      .set({
        status: 'terminal',
        terminalIdempotencyKey: input.idempotency_key,
        terminalRequestDigest: input.request_digest,
        terminalAt: input.now,
        terminalStatus: input.terminal_status,
        terminalReasonCode: input.reason_code,
        terminalResultJson: terminalResultJson ?? null,
        updatedAt: input.now,
      } as never)
      .where(and(eq(codex_runtime_jobs.id, input.runtime_job_id), notInArray(codex_runtime_jobs.status, ['queued', 'terminal'])))
      .returning();
    const keepRunnerLeaseOpen = shouldKeepCodexSessionRunnerLeaseOpen(runtimeJobFromDbRecord(bundle.job), input.terminal_status);
    const [leaseRow] = keepRunnerLeaseOpen
      ? [bundle.lease]
      : await this.db
          .update(codex_launch_leases)
          .set({
            status: 'terminal',
            terminalizedAt: input.now,
            terminalReasonCode: input.reason_code,
            terminalEvidenceSummaryJson: terminalResultJson ?? null,
            terminalRuntimeJobId: input.runtime_job_id,
            terminalIdempotencyKey: input.idempotency_key,
          } as never)
          .where(
            and(
              eq(codex_launch_leases.id, input.launch_lease_id),
              or(eq(codex_launch_leases.status, 'active'), eq(codex_launch_leases.status, 'materialized')),
            ),
          )
          .returning();
    if (jobRow === undefined || leaseRow === undefined) {
      throw codexDenied('codex_runtime_job_unavailable', 'Codex runtime job terminalization was denied.');
    }
    if (!keepRunnerLeaseOpen && (await this.codexLaunchLeaseOccupiesWorkerSlot(bundle.lease.id))) {
      await this.decrementCodexWorkerLeaseCounts(this.db, [input.worker_id]);
    }
    return runtimeJobFromDbRecord(fromDbRecord<CodexRuntimeJobDbRecord>(jobRow as Record<string, unknown>));
  }

  private async recoverStaleCodexRuntimeJobsUnlocked(input: RecoverStaleCodexRuntimeJobsInput): Promise<RecoverStaleCodexRuntimeJobsResult> {
    assertCodexRuntimeRecoveryReasonCode(input.reason_code);
    const workerPredicate = input.worker_id === undefined ? sql`true` : sql`j.worker_id = ${input.worker_id}`;
    const result = await this.db.execute(sql<Record<string, unknown>>`
      select j.*
      from codex_runtime_jobs j
      left join codex_launch_leases l on l.id = j.launch_lease_id
      where j.status <> 'terminal'
        and ${workerPredicate}
        and (
          j.expires_at <= ${input.stale_before}
          or coalesce(j.last_event_at, j.updated_at) < ${input.stale_before}
          or l.status in ('terminal', 'expired', 'revoked')
        )
      order by j.updated_at asc, j.id asc
      for update of j
    `);
    const recoveredRuntimeJobs: RecoverStaleCodexRuntimeJobsResult['recovered_runtime_jobs'] = [];
    const recoveredLaunchLeases: RecoverStaleCodexRuntimeJobsResult['recovered_launch_leases'] = [];
    const workerIdsToDecrement: string[] = [];
    for (const job of result.rows.map((row) => fromDbRecord<CodexRuntimeJobDbRecord>(row))) {
      const lease = await this.lockCodexLaunchLease(job.launch_lease_id);
      const [jobRow] = await this.db
        .update(codex_runtime_jobs)
        .set({
          status: 'terminal',
          terminalAt: input.now,
          terminalStatus: 'expired',
          terminalReasonCode: input.reason_code,
          updatedAt: input.now,
        } as never)
        .where(and(eq(codex_runtime_jobs.id, job.id), notInArray(codex_runtime_jobs.status, ['terminal'])))
        .returning();
      if (jobRow === undefined) {
        continue;
      }
      recoveredRuntimeJobs.push(
        this.codexRuntimeJobRecoveryEvidence(runtimeJobFromDbRecord(fromDbRecord<CodexRuntimeJobDbRecord>(jobRow as Record<string, unknown>))),
      );
      if (lease !== undefined && (lease.status === 'active' || lease.status === 'materialized')) {
        const [leaseRow] = await this.db
          .update(codex_launch_leases)
          .set({ status: 'expired', terminalizedAt: input.now, terminalReasonCode: input.reason_code } as never)
          .where(
            and(
              eq(codex_launch_leases.id, lease.id),
              or(eq(codex_launch_leases.status, 'active'), eq(codex_launch_leases.status, 'materialized')),
            ),
          )
          .returning();
        if (leaseRow !== undefined) {
          const leaseRecord = fromDbRecord<CodexLaunchLeaseDbRecord>(leaseRow as Record<string, unknown>);
          recoveredLaunchLeases.push(this.codexLaunchLeaseRecoveryEvidence(launchLeaseFromDbRecord(leaseRecord)));
          if (leaseRecord.worker_id !== undefined && (await this.codexLaunchLeaseOccupiesWorkerSlot(leaseRecord.id))) {
            workerIdsToDecrement.push(leaseRecord.worker_id);
          }
        }
      }
    }
    await this.decrementCodexWorkerLeaseCounts(this.db, workerIdsToDecrement);
    return { recovered_runtime_jobs: recoveredRuntimeJobs, recovered_launch_leases: recoveredLaunchLeases };
  }

  private async createOrReplayCodexRuntimeJobWithLeaseAndEnvelopeUnlocked(
    input: CreateOrReplayCodexRuntimeJobWithLeaseAndEnvelopeInput,
  ): Promise<CreateOrReplayCodexRuntimeJobWithLeaseAndEnvelopeResult> {
    const [requestReplayRow] = await this.db
      .select()
      .from(codex_runtime_jobs)
      .where(eq(codex_runtime_jobs.jobRequestId, input.job_request_id))
      .limit(1);
    if (requestReplayRow !== undefined) {
      return this.replayCodexRuntimeJob(fromDbRecord<CodexRuntimeJobDbRecord>(requestReplayRow as Record<string, unknown>), input);
    }

    const [targetReplayRow] = await this.db
      .select()
      .from(codex_runtime_jobs)
      .where(this.codexRuntimeTargetAttemptPredicate(input))
      .limit(1);
    if (targetReplayRow !== undefined) {
      return this.replayCodexRuntimeJob(fromDbRecord<CodexRuntimeJobDbRecord>(targetReplayRow as Record<string, unknown>), input);
    }

    const [existingLeaseForTargetAttempt] = await this.db
      .select({ id: codex_launch_leases.id })
      .from(codex_launch_leases)
      .where(
        and(
          eq(codex_launch_leases.projectId, input.target.project_id),
          input.target.repo_id === undefined ? isNull(codex_launch_leases.repoId) : eq(codex_launch_leases.repoId, input.target.repo_id),
          eq(codex_launch_leases.targetType, input.target.target_type),
          eq(codex_launch_leases.targetId, input.target.target_id),
          eq(codex_launch_leases.targetKind, input.target.target_kind),
          eq(codex_launch_leases.launchAttempt, input.launch_attempt),
        ),
      )
      .limit(1);
    if (existingLeaseForTargetAttempt !== undefined) {
      throw codexDenied('codex_runtime_job_unavailable', 'Runtime job target attempt already has a launch lease.');
    }

    if (!(await this.codexRuntimeJobCreateIdsAreUnused(input))) {
      throw codexDenied('codex_runtime_job_unavailable', 'Codex runtime job immutable id was already used.');
    }
    if (!(await this.codexRuntimePendingBundleCreateMatches(input))) {
      throw codexDenied('codex_runtime_job_unavailable', 'Runtime job pending workspace bundle fence was rejected.');
    }
    if (!this.codexRuntimeJobHasRequiredLaunchFence(input)) {
      throw codexDenied('codex_runtime_job_unavailable', 'Runtime job launch fence was incomplete.');
    }

    const profileRevision = await this.getById<CodexRuntimeProfileRevision>(
      codex_runtime_profile_revisions,
      codex_runtime_profile_revisions.id,
      input.runtime_profile_revision_id,
    );
    const profileNetworkPolicy =
      profileRevision === undefined ? undefined : normalizeCodexRuntimeNetworkPolicy(profileRevision.network_policy);
    if (
      profileRevision === undefined ||
      profileNetworkPolicy === undefined ||
      profileRevision.status !== 'active' ||
      profileRevision.target_kind !== input.target.target_kind ||
      profileRevision.profile_digest !== input.runtime_profile_digest ||
      !codexRuntimeScopeMatches(profileRevision.allowed_scopes, codexScope(input.target.project_id, input.target.repo_id)) ||
      profileRevision.docker_image_digest !== input.docker_image_digest ||
      codexCanonicalDigest(profileNetworkPolicy) !== input.network_policy_digest ||
      (profileNetworkPolicy.mode === 'egress_allowlist' &&
        profileNetworkPolicy.provider === 'docker_network_proxy' &&
        profileNetworkPolicy.provider_config.provider_config_digest !== input.network_provider_config_digest)
    ) {
      throw codexDenied('codex_runtime_job_unavailable', 'Runtime job profile fence was rejected.');
    }

    const [workerRow] = await this.db
      .select()
      .from(codex_worker_registrations)
      .where(eq(codex_worker_registrations.id, input.worker_id))
      .limit(1);
    const worker = workerRow === undefined ? undefined : fromDbRecord<CodexWorkerRegistrationDbRecord>(workerRow as Record<string, unknown>);
    if (worker === undefined || !this.codexWorkerCanRunRuntimeJob(worker, input)) {
      throw codexDenied('codex_runtime_job_unavailable', 'Runtime job worker fence was rejected.');
    }
    const occupiesWorkerSlot = !isCodexSessionResumeRuntimeJobInput(input.input_json);

    const credential = await this.resolveCodexCredentialForLaunch({
      credential_binding_id: input.credential_binding_id,
      target_kind: input.target.target_kind,
      runtime_profile_id: profileRevision.profile_id,
      project_id: input.target.project_id,
      ...(input.target.repo_id === undefined ? {} : { repo_id: input.target.repo_id }),
      required_payload_digest: input.credential_payload_digest,
      now: input.now,
    });
    if (credential?.binding_version_id !== input.credential_binding_version_id) {
      throw codexDenied('codex_runtime_job_unavailable', 'Runtime job credential fence was rejected.');
    }

    const launchToken = `codex-runtime-launch:${randomUUID()}`;
    const leaseRecord = this.codexRuntimeJobLaunchLeaseRecord(input, codexCredentialPayloadDigest(launchToken));
    if (!(await this.codexLaunchFenceIsActive(leaseRecord, input.now))) {
      throw codexDenied('codex_runtime_job_unavailable', 'Runtime job active fence was rejected.');
    }

    const sealedEnvelope = await this.codexLaunchTokenEnvelopeSealer.sealLaunchTokenEnvelope({
      plaintext_launch_token: launchToken,
      runtime_job_id: input.runtime_job_id,
      launch_lease_id: input.launch_lease_id,
      envelope_id: input.envelope_id,
      worker_id: input.worker_id,
      worker_public_key_material: worker.session_public_key_material,
      key_id: worker.session_public_key_id,
      expires_at: input.expires_at,
    });
    if (
      sealedEnvelope.id !== input.envelope_id ||
      sealedEnvelope.runtime_job_id !== input.runtime_job_id ||
      sealedEnvelope.launch_lease_id !== input.launch_lease_id ||
      sealedEnvelope.worker_id !== input.worker_id ||
      sealedEnvelope.key_id !== worker.session_public_key_id ||
      sealedEnvelope.expires_at !== input.expires_at
    ) {
      throw codexDenied('codex_runtime_job_unavailable', 'Runtime job launch token envelope metadata was rejected.');
    }

    const [leaseRow] = await this.db
      .insert(codex_launch_leases)
      .values(this.codexRuntimeJobLaunchLeaseValues(leaseRecord) as never)
      .onConflictDoNothing()
      .returning();
    if (leaseRow === undefined) {
      throw codexDenied('codex_runtime_job_unavailable', 'Runtime job launch lease insert was rejected.');
    }

    const [jobRow] = await this.db
      .insert(codex_runtime_jobs)
      .values(this.codexRuntimeJobValues(input, sealedEnvelope.envelope_digest) as never)
      .onConflictDoNothing()
      .returning();
    if (jobRow === undefined) {
      throw codexDenied('codex_runtime_job_unavailable', 'Runtime job insert was rejected.');
    }

    const envelopeValues = {
      id: sealedEnvelope.id,
      runtimeJobId: sealedEnvelope.runtime_job_id,
      launchLeaseId: sealedEnvelope.launch_lease_id,
      workerId: sealedEnvelope.worker_id,
      keyId: sealedEnvelope.key_id,
      algorithm: sealedEnvelope.algorithm,
      ciphertext: sealedEnvelope.ciphertext,
      encryptionNonce: sealedEnvelope.encryption_nonce,
      aadJson: sealedEnvelope.aad_json,
      aadDigest: sealedEnvelope.aad_digest,
      envelopeDigest: sealedEnvelope.envelope_digest,
      status: 'available',
      expiresAt: sealedEnvelope.expires_at,
      createdAt: input.now,
    };
    const [envelopeRow] = await this.db
      .insert(codex_launch_token_envelopes)
      .values(envelopeValues as never)
      .onConflictDoNothing()
      .returning();
    if (envelopeRow === undefined) {
      throw codexDenied('codex_runtime_job_unavailable', 'Runtime job launch token envelope insert was rejected.');
    }

    if (input.pending_workspace_bundle !== undefined) {
      await this.bindCodexRuntimePendingWorkspaceBundle(input);
    }

    if (occupiesWorkerSlot) {
      const [workerUpdate] = await this.db
        .update(codex_worker_registrations)
        .set({ leaseCount: sql`${codex_worker_registrations.leaseCount} + 1` } as never)
        .where(
          and(
            eq(codex_worker_registrations.id, input.worker_id),
            eq(codex_worker_registrations.status, 'online'),
            eq(codex_worker_registrations.controlChannelStatus, 'connected'),
            gt(codex_worker_registrations.sessionTokenExpiresAt, input.now),
            gt(codex_worker_registrations.sessionPublicKeyExpiresAt, input.now),
            isNotNull(codex_worker_registrations.lastHeartbeatAt),
            sql`${codex_worker_registrations.leaseCount} < ${codex_worker_registrations.maxConcurrency}`,
          ),
        )
        .returning({ id: codex_worker_registrations.id });
      if (workerUpdate === undefined) {
        throw codexDenied('codex_runtime_job_unavailable', 'Runtime job worker fence was rejected.');
      }
    }

    return {
      runtime_job: runtimeJobFromDbRecord(fromDbRecord<CodexRuntimeJobDbRecord>(jobRow as Record<string, unknown>)),
      launch_lease: launchLeaseFromDbRecord(fromDbRecord<CodexLaunchLeaseDbRecord>(leaseRow as Record<string, unknown>)),
      envelope: fromDbRecord<CodexLaunchTokenEnvelope>(envelopeRow as Record<string, unknown>),
      replayed: false,
    };
  }

  private codexRuntimeJobCreateLockKeys(input: CreateOrReplayCodexRuntimeJobWithLeaseAndEnvelopeInput): readonly string[] {
    return [
      `codex-runtime-job-request:${input.job_request_id}`,
      `codex-runtime-job-target:${input.target.project_id}:${input.target.repo_id ?? ''}:${input.target.target_type}:${input.target.target_id}:${input.launch_attempt}`,
      `codex-runtime-worker:${input.worker_id}`,
    ];
  }

  private codexRuntimeTargetAttemptPredicate(input: CreateOrReplayCodexRuntimeJobWithLeaseAndEnvelopeInput) {
    return and(
      eq(codex_runtime_jobs.projectId, input.target.project_id),
      input.target.repo_id === undefined ? isNull(codex_runtime_jobs.repoId) : eq(codex_runtime_jobs.repoId, input.target.repo_id),
      eq(codex_runtime_jobs.targetType, input.target.target_type),
      eq(codex_runtime_jobs.targetId, input.target.target_id),
      eq(codex_runtime_jobs.targetKind, input.target.target_kind),
      eq(codex_runtime_jobs.launchAttempt, input.launch_attempt),
    );
  }

  private async codexRuntimeJobCreateIdsAreUnused(input: CreateOrReplayCodexRuntimeJobWithLeaseAndEnvelopeInput): Promise<boolean> {
    const [jobRows, leaseRows, envelopeRows] = await Promise.all([
      this.db.select({ id: codex_runtime_jobs.id }).from(codex_runtime_jobs).where(eq(codex_runtime_jobs.id, input.runtime_job_id)).limit(1),
      this.db.select({ id: codex_launch_leases.id }).from(codex_launch_leases).where(eq(codex_launch_leases.id, input.launch_lease_id)).limit(1),
      this.db
        .select({ id: codex_launch_token_envelopes.id })
        .from(codex_launch_token_envelopes)
        .where(eq(codex_launch_token_envelopes.id, input.envelope_id))
        .limit(1),
    ]);
    return jobRows[0] === undefined && leaseRows[0] === undefined && envelopeRows[0] === undefined;
  }

  private async replayCodexRuntimeJob(
    record: CodexRuntimeJobDbRecord,
    input: CreateOrReplayCodexRuntimeJobWithLeaseAndEnvelopeInput,
  ): Promise<CreateOrReplayCodexRuntimeJobWithLeaseAndEnvelopeResult> {
    const [leaseRow] = await this.db.select().from(codex_launch_leases).where(eq(codex_launch_leases.id, record.launch_lease_id)).limit(1);
    const [envelopeRow] = await this.db
      .select()
      .from(codex_launch_token_envelopes)
      .where(eq(codex_launch_token_envelopes.id, input.envelope_id))
      .limit(1);
    const [pendingRow] = await this.db
      .select()
      .from(codex_pending_workspace_bundles)
      .where(eq(codex_pending_workspace_bundles.runtimeJobId, record.id))
      .limit(1);
    const [artifactRow] = await this.db
      .select()
      .from(codex_runtime_job_artifacts)
      .where(and(eq(codex_runtime_job_artifacts.runtimeJobId, record.id), eq(codex_runtime_job_artifacts.kind, 'workspace_bundle')))
      .limit(1);
    if (leaseRow === undefined || envelopeRow === undefined) {
      throw codexDenied('codex_runtime_job_unavailable', 'Runtime job replay record is inconsistent.');
    }
    const lease = fromDbRecord<CodexLaunchLeaseDbRecord>(leaseRow as Record<string, unknown>);
    const envelope = fromDbRecord<CodexLaunchTokenEnvelope>(envelopeRow as Record<string, unknown>);
    const pending =
      pendingRow === undefined ? undefined : fromDbRecord<CodexPendingWorkspaceBundleDbRecord>(pendingRow as Record<string, unknown>);
    const artifact = artifactRow === undefined ? undefined : fromDbRecord<CodexRuntimeJobArtifactDbRecord>(artifactRow as Record<string, unknown>);
    if (
      lease.expires_at <= input.now ||
      !(await this.codexLaunchFenceIsActive(lease, input.now)) ||
      !this.codexRuntimeJobReplayMatches(record, lease, envelope, pending, artifact, input)
    ) {
      throw codexDenied('codex_runtime_job_unavailable', 'Runtime job replay did not match original request.');
    }
    return {
      runtime_job: runtimeJobFromDbRecord(record),
      launch_lease: launchLeaseFromDbRecord(lease),
      envelope,
      replayed: true,
    };
  }

  private codexRuntimeJobReplayMatches(
    record: CodexRuntimeJobDbRecord,
    lease: CodexLaunchLeaseDbRecord,
    envelope: CodexLaunchTokenEnvelope,
    pending: CodexPendingWorkspaceBundleDbRecord | undefined,
    artifact: CodexRuntimeJobArtifactDbRecord | undefined,
    input: CreateOrReplayCodexRuntimeJobWithLeaseAndEnvelopeInput,
  ): boolean {
    return (
      valuesEqual(runtimeJobTargetFromDbRecord(record), input.target) &&
      record.launch_attempt === input.launch_attempt &&
      record.input_digest === input.input_digest &&
      valuesEqual(record.input_json, input.input_json) &&
      record.workflow_id === input.workflow_id &&
      record.codex_session_id === input.codex_session_id &&
      record.codex_session_turn_id === input.codex_session_turn_id &&
      record.workspace_acquisition_digest === input.workspace_acquisition_digest &&
      valuesEqual(record.workspace_acquisition_json, input.workspace_acquisition_json) &&
      record.worker_id === input.worker_id &&
      record.launch_lease_id === input.launch_lease_id &&
      record.launch_lease_id === lease.id &&
      record.launch_attempt === lease.launch_attempt &&
      lease.status === 'active' &&
      lease.runtime_profile_revision_id === input.runtime_profile_revision_id &&
      record.runtime_profile_digest === input.runtime_profile_digest &&
      record.credential_binding_id === input.credential_binding_id &&
      record.credential_binding_version_id === input.credential_binding_version_id &&
      record.credential_payload_digest === input.credential_payload_digest &&
      record.docker_image_digest === input.docker_image_digest &&
      record.network_policy_digest === input.network_policy_digest &&
      record.network_provider_config_digest === input.network_provider_config_digest &&
      envelope.id === input.envelope_id &&
      envelope.runtime_job_id === record.id &&
      envelope.launch_lease_id === record.launch_lease_id &&
      envelope.worker_id === record.worker_id &&
      record.envelope_digest === envelope.envelope_digest &&
      lease.action_type === input.action_type &&
      lease.action_attempt === input.action_attempt &&
      lease.action_claim_token_hash === input.action_claim_token_hash &&
      lease.precondition_fingerprint === input.precondition_fingerprint &&
      lease.execution_package_id === input.execution_package_id &&
      lease.run_worker_lease_id === input.run_worker_lease_id &&
      lease.run_worker_lease_token_hash === input.run_worker_lease_token_hash &&
      lease.run_session_status === input.run_session_status &&
      lease.run_session_updated_at === input.run_session_updated_at &&
      lease.execution_package_version === input.execution_package_version &&
      this.codexRuntimePendingBundleReplayMatches(record, pending, artifact, input.pending_workspace_bundle)
    );
  }

  private codexRuntimePendingBundleReplayMatches(
    record: CodexRuntimeJobDbRecord,
    stored: CodexPendingWorkspaceBundleDbRecord | undefined,
    artifact: CodexRuntimeJobArtifactDbRecord | undefined,
    input: PendingWorkspaceBundleReplayInput | undefined,
  ): boolean {
    if (stored === undefined || input === undefined) {
      return stored === undefined && input === undefined && artifact === undefined;
    }
    return (
      artifact !== undefined &&
      stored.runtime_job_id === record.id &&
      stored.status === 'bound' &&
      artifact.runtime_job_id === record.id &&
      artifact.kind === 'workspace_bundle' &&
      artifact.name === stored.bundle_id &&
      artifact.digest === stored.archive_digest &&
      artifact.internal_ref === stored.pending_artifact_ref &&
      artifact.internal_artifact_object_id === stored.internal_artifact_object_id &&
      artifact.metadata_json.bundle_id === stored.bundle_id &&
      artifact.metadata_json.manifest_digest === stored.manifest_digest &&
      artifact.metadata_json.run_worker_lease_id === stored.run_worker_lease_id &&
      artifact.metadata_json.workspace_acquisition_digest === stored.workspace_acquisition_digest &&
      artifact.size_bytes === stored.size_bytes &&
      stored.id === input.id &&
      stored.bundle_id === input.bundle_id &&
      stored.run_session_id === input.run_session_id &&
      stored.execution_package_id === input.execution_package_id &&
      stored.pending_artifact_ref === input.pending_artifact_ref &&
      stored.internal_artifact_object_id === input.internal_artifact_object_id &&
      stored.archive_digest === input.archive_digest &&
      stored.manifest_digest === input.manifest_digest &&
      stored.archive_bytes_base64 === input.archive_bytes_base64 &&
      stored.run_worker_lease_id === input.run_worker_lease_id &&
      stored.size_bytes === input.size_bytes &&
      stored.workspace_acquisition_digest === input.workspace_acquisition_digest &&
      valuesEqual(stored.workspace_acquisition_json, input.workspace_acquisition_json) &&
      stored.expires_at === input.expires_at &&
      stored.request_digest === input.request_digest &&
      stored.created_at === input.created_at
    );
  }

  private async codexRuntimePendingBundleCreateMatches(input: CreateOrReplayCodexRuntimeJobWithLeaseAndEnvelopeInput): Promise<boolean> {
    if (input.target.target_kind === 'generation') {
      return input.pending_workspace_bundle === undefined;
    }
    const pending = input.pending_workspace_bundle;
    if (
      pending === undefined ||
      input.workspace_acquisition_digest === undefined ||
      input.workspace_acquisition_json === undefined ||
      pending.expires_at <= input.now ||
      pending.run_worker_lease_id !== input.run_worker_lease_id ||
      pending.size_bytes <= 0 ||
      pending.workspace_acquisition_digest !== input.workspace_acquisition_digest ||
      !valuesEqual(pending.workspace_acquisition_json, input.workspace_acquisition_json)
    ) {
      return false;
    }
    const [existing] = await this.db
      .select()
      .from(codex_pending_workspace_bundles)
      .where(eq(codex_pending_workspace_bundles.bundleId, pending.bundle_id))
      .limit(1);
    const stored =
      existing === undefined ? undefined : fromDbRecord<CodexPendingWorkspaceBundleDbRecord>(existing as Record<string, unknown>);
    return (
      stored !== undefined &&
      stored.status === 'pending' &&
      stored.runtime_job_id === undefined &&
      stored.id === pending.id &&
      stored.bundle_id === pending.bundle_id &&
      stored.run_session_id === pending.run_session_id &&
      stored.execution_package_id === pending.execution_package_id &&
      stored.pending_artifact_ref === pending.pending_artifact_ref &&
      stored.internal_artifact_object_id === pending.internal_artifact_object_id &&
      stored.archive_digest === pending.archive_digest &&
      stored.manifest_digest === pending.manifest_digest &&
      stored.archive_bytes_base64 === pending.archive_bytes_base64 &&
      stored.run_worker_lease_id === pending.run_worker_lease_id &&
      stored.size_bytes === pending.size_bytes &&
      stored.expires_at === pending.expires_at &&
      stored.workspace_acquisition_digest === pending.workspace_acquisition_digest &&
      valuesEqual(stored.workspace_acquisition_json, pending.workspace_acquisition_json) &&
      stored.run_session_id === input.target.target_id &&
      stored.execution_package_id === input.execution_package_id &&
      stored.request_digest === pending.request_digest &&
      stored.created_at === pending.created_at
    );
  }

  private codexRuntimeJobHasRequiredLaunchFence(input: CreateOrReplayCodexRuntimeJobWithLeaseAndEnvelopeInput): boolean {
    if (input.target.target_kind === 'generation') {
      return (
        input.action_type !== undefined &&
        input.action_attempt !== undefined &&
        input.action_claim_token_hash !== undefined &&
        input.precondition_fingerprint !== undefined
      );
    }
    return (
      input.execution_package_id !== undefined &&
      input.run_worker_lease_id !== undefined &&
      input.run_worker_lease_token_hash !== undefined &&
      input.run_session_status !== undefined &&
      input.run_session_updated_at !== undefined &&
      input.execution_package_version !== undefined
    );
  }

  private codexRuntimeJobLaunchLeaseRecord(
    input: CreateOrReplayCodexRuntimeJobWithLeaseAndEnvelopeInput,
    leaseTokenHash: string,
  ): CodexLaunchLeaseDbRecord {
    return {
      id: input.launch_lease_id,
      lease_request_id: `runtime-job:${input.job_request_id}`,
      target_type: input.target.target_type,
      target_id: input.target.target_id,
      target_kind: input.target.target_kind,
      project_id: input.target.project_id,
      ...(input.target.repo_id === undefined ? {} : { repo_id: input.target.repo_id }),
      launch_attempt: input.launch_attempt,
      ...(input.action_type !== undefined ? { action_type: input.action_type } : {}),
      ...(input.action_attempt !== undefined ? { action_attempt: input.action_attempt } : {}),
      ...(input.action_claim_token_hash !== undefined ? { action_claim_token_hash: input.action_claim_token_hash } : {}),
      ...(input.precondition_fingerprint !== undefined ? { precondition_fingerprint: input.precondition_fingerprint } : {}),
      ...(input.execution_package_id !== undefined ? { execution_package_id: input.execution_package_id } : {}),
      ...(input.run_worker_lease_id !== undefined ? { run_worker_lease_id: input.run_worker_lease_id } : {}),
      ...(input.run_worker_lease_token_hash !== undefined ? { run_worker_lease_token_hash: input.run_worker_lease_token_hash } : {}),
      ...(input.run_session_status !== undefined ? { run_session_status: input.run_session_status } : {}),
      ...(input.run_session_updated_at !== undefined ? { run_session_updated_at: input.run_session_updated_at } : {}),
      ...(input.execution_package_version !== undefined ? { execution_package_version: input.execution_package_version } : {}),
      worker_id: input.worker_id,
      status: 'active',
      lease_token_hash: leaseTokenHash,
      runtime_profile_revision_id: input.runtime_profile_revision_id,
      runtime_profile_digest: input.runtime_profile_digest,
      credential_binding_id: input.credential_binding_id,
      credential_binding_version_id: input.credential_binding_version_id,
      credential_payload_digest: input.credential_payload_digest,
      docker_image_digest: input.docker_image_digest,
      network_policy_digest: input.network_policy_digest,
      ...(input.network_provider_config_digest === undefined
        ? {}
        : { network_provider_config_digest: input.network_provider_config_digest }),
      created_at: input.now,
      expires_at: input.expires_at,
    };
  }

  private codexRuntimeJobLaunchLeaseValues(record: CodexLaunchLeaseDbRecord): Record<string, unknown> {
    return {
      id: record.id,
      leaseRequestId: record.lease_request_id,
      targetType: record.target_type,
      targetId: record.target_id,
      targetKind: record.target_kind,
      projectId: record.project_id,
      repoId: record.repo_id ?? null,
      launchAttempt: record.launch_attempt,
      actionType: record.action_type ?? null,
      actionAttempt: record.action_attempt ?? null,
      actionClaimTokenHash: record.action_claim_token_hash ?? null,
      preconditionFingerprint: record.precondition_fingerprint ?? null,
      executionPackageId: record.execution_package_id ?? null,
      runWorkerLeaseId: record.run_worker_lease_id ?? null,
      runWorkerLeaseTokenHash: record.run_worker_lease_token_hash ?? null,
      runSessionStatus: record.run_session_status ?? null,
      runSessionUpdatedAt: record.run_session_updated_at ?? null,
      executionPackageVersion: record.execution_package_version ?? null,
      workerId: record.worker_id ?? null,
      status: record.status,
      leaseTokenHash: record.lease_token_hash,
      runtimeProfileRevisionId: record.runtime_profile_revision_id,
      runtimeProfileDigest: record.runtime_profile_digest,
      credentialBindingId: record.credential_binding_id,
      credentialBindingVersionId: record.credential_binding_version_id,
      credentialPayloadDigest: record.credential_payload_digest,
      dockerImageDigest: record.docker_image_digest,
      networkPolicyDigest: record.network_policy_digest,
      networkProviderConfigDigest: record.network_provider_config_digest ?? null,
      createdAt: record.created_at,
      expiresAt: record.expires_at,
    };
  }

  private codexRuntimeJobValues(
    input: CreateOrReplayCodexRuntimeJobWithLeaseAndEnvelopeInput,
    envelopeDigest: string,
  ): Record<string, unknown> {
    return {
      id: input.runtime_job_id,
      jobRequestId: input.job_request_id,
      targetType: input.target.target_type,
      targetId: input.target.target_id,
      targetKind: input.target.target_kind,
      projectId: input.target.project_id,
      repoId: input.target.repo_id ?? null,
      workerId: input.worker_id,
      launchLeaseId: input.launch_lease_id,
      launchAttempt: input.launch_attempt,
      status: 'queued',
      inputDigest: input.input_digest,
      inputJson: input.input_json,
      workflowId: input.workflow_id ?? null,
      codexSessionId: input.codex_session_id ?? null,
      codexSessionTurnId: input.codex_session_turn_id ?? null,
      workspaceAcquisitionDigest: input.workspace_acquisition_digest ?? null,
      workspaceAcquisitionJson: input.workspace_acquisition_json ?? null,
      runtimeProfileRevisionId: input.runtime_profile_revision_id,
      runtimeProfileDigest: input.runtime_profile_digest,
      credentialBindingId: input.credential_binding_id,
      credentialBindingVersionId: input.credential_binding_version_id,
      credentialPayloadDigest: input.credential_payload_digest,
      dockerImageDigest: input.docker_image_digest,
      networkPolicyDigest: input.network_policy_digest,
      networkProviderConfigDigest: input.network_provider_config_digest ?? null,
      envelopeDigest,
      expiresAt: input.expires_at,
      createdAt: input.now,
      updatedAt: input.now,
    };
  }

  private async bindCodexRuntimePendingWorkspaceBundle(input: CreateOrReplayCodexRuntimeJobWithLeaseAndEnvelopeInput): Promise<void> {
    const pending = input.pending_workspace_bundle;
    if (pending === undefined) {
      return;
    }
    const [pendingRow] = await this.db
      .update(codex_pending_workspace_bundles)
      .set({
        runtimeJobId: input.runtime_job_id,
        status: 'bound',
      })
      .where(
        and(
          eq(codex_pending_workspace_bundles.bundleId, pending.bundle_id),
          eq(codex_pending_workspace_bundles.status, 'pending'),
          isNull(codex_pending_workspace_bundles.runtimeJobId),
        ),
      )
      .returning({ id: codex_pending_workspace_bundles.id });
    if (pendingRow === undefined) {
      throw codexDenied('codex_runtime_job_unavailable', 'Runtime job pending workspace bundle fence was rejected.');
    }
    const artifactIdempotencyKey = `runtime-job:${input.runtime_job_id}:workspace-bundle:${pending.bundle_id}`;
    const [artifactRow] = await this.db
      .insert(codex_runtime_job_artifacts)
      .values({
        id: randomUUID(),
        runtimeJobId: input.runtime_job_id,
        artifactIdempotencyKey,
        kind: 'workspace_bundle',
        name: pending.bundle_id,
        contentType: 'application/vnd.forgeloop.workspace-bundle',
        digest: pending.archive_digest,
        internalRef: pending.pending_artifact_ref,
        internalArtifactObjectId: pending.internal_artifact_object_id ?? null,
        sizeBytes: pending.size_bytes,
        metadataJson: {
          bundle_id: pending.bundle_id,
          manifest_digest: pending.manifest_digest,
          run_worker_lease_id: pending.run_worker_lease_id,
          workspace_acquisition_digest: pending.workspace_acquisition_digest,
          workspace_acquisition_json: pending.workspace_acquisition_json,
          expires_at: pending.expires_at,
        },
        requestDigest: codexCanonicalDigest({
          runtime_job_id: input.runtime_job_id,
          bundle_id: pending.bundle_id,
          archive_digest: pending.archive_digest,
          manifest_digest: pending.manifest_digest,
          workspace_acquisition_digest: pending.workspace_acquisition_digest,
        }),
        createdAt: input.now,
      } as never)
      .onConflictDoNothing()
      .returning({ id: codex_runtime_job_artifacts.id });
    if (artifactRow === undefined) {
      throw codexDenied('codex_runtime_job_unavailable', 'Runtime job workspace bundle artifact binding was rejected.');
    }
  }

  private codexWorkerCanRunRuntimeJob(
    worker: CodexWorkerRegistrationDbRecord,
    input: CreateOrReplayCodexRuntimeJobWithLeaseAndEnvelopeInput,
  ): boolean {
    return (
      worker.status === 'online' &&
      worker.control_channel_status === 'connected' &&
      worker.session_token_expires_at > input.now &&
      worker.session_public_key_expires_at > input.now &&
      codexWorkerHeartbeatIsFresh(worker.last_heartbeat_at, input.now) &&
      (isCodexSessionResumeRuntimeJobInput(input.input_json) || worker.lease_count < worker.max_concurrency) &&
      capabilityList(worker.capabilities_json, 'target_kinds').includes(input.target.target_kind) &&
      codexWorkerScopeMatchesTarget(worker.allowed_scopes_json, input.target.target_kind, codexScope(input.target.project_id, input.target.repo_id)) &&
      capabilityList(worker.capabilities_json, 'docker_image_digests').includes(input.docker_image_digest) &&
      capabilityList(worker.capabilities_json, 'network_policy_digests').includes(input.network_policy_digest) &&
      (input.network_provider_config_digest === undefined ||
        capabilityList(worker.capabilities_json, 'network_provider_config_digests').includes(input.network_provider_config_digest))
    );
  }

  async createOrReplayCodexLaunchLease(input: CreateOrReplayCodexLaunchLeaseInput): Promise<CodexLaunchLease & { lease_token: string }> {
    validateCodexLaunchTargetKind(input.target.target_type, input.target.target_kind);
    return this.db.transaction(async (tx) => {
      const repository = new DrizzleDeliveryRepository(tx as ForgeloopDrizzleDatabase);
      const replayExisting = async (): Promise<(CodexLaunchLease & { lease_token: string }) | undefined> => {
        const [existingRow] = await tx
          .select()
          .from(codex_launch_leases)
          .where(eq(codex_launch_leases.leaseRequestId, input.lease_request_id))
          .limit(1);
        if (existingRow === undefined) {
          return undefined;
        }
        const existing = fromDbRecord<CodexLaunchLeaseDbRecord>(existingRow);
        if (
          existing.status !== 'active' ||
          !launchReplayMatches(existing, input) ||
          existing.lease_token_hash !== codexCredentialPayloadDigest(input.launch_token)
        ) {
          throw codexDenied('codex_launch_lease_denied', 'Launch lease request id replay did not match original request.');
        }
        return { ...launchLeaseFromDbRecord(existing), lease_token: input.launch_token };
      };

      const existing = await replayExisting();
      if (existing !== undefined) {
        return existing;
      }
      const [targetAttemptRow] = await tx
        .select({ id: codex_launch_leases.id })
        .from(codex_launch_leases)
        .where(
          and(
            eq(codex_launch_leases.projectId, input.target.project_id),
            input.target.repo_id === undefined ? isNull(codex_launch_leases.repoId) : eq(codex_launch_leases.repoId, input.target.repo_id),
            eq(codex_launch_leases.targetType, input.target.target_type),
            eq(codex_launch_leases.targetId, input.target.target_id),
            eq(codex_launch_leases.targetKind, input.target.target_kind),
            eq(codex_launch_leases.launchAttempt, input.launch_attempt),
          ),
        )
        .limit(1);
      if (targetAttemptRow !== undefined) {
        throw codexDenied('codex_launch_lease_denied', 'Launch lease target attempt already has a lease.');
      }

      const profileRevision = await repository.getById<CodexRuntimeProfileRevision>(
        codex_runtime_profile_revisions,
        codex_runtime_profile_revisions.id,
        input.runtime_profile_revision_id,
      );
      const profileNetworkPolicy =
        profileRevision === undefined ? undefined : normalizeCodexRuntimeNetworkPolicy(profileRevision.network_policy);
      if (
        profileRevision === undefined ||
        profileNetworkPolicy === undefined ||
        profileRevision.status !== 'active' ||
        profileRevision.target_kind !== input.target.target_kind ||
        profileRevision.profile_digest !== input.runtime_profile_digest ||
        !codexRuntimeScopeMatches(profileRevision.allowed_scopes, codexScope(input.target.project_id, input.target.repo_id)) ||
        profileRevision.docker_image_digest !== input.docker_image_digest ||
        codexCanonicalDigest(profileNetworkPolicy) !== input.network_policy_digest ||
        (profileNetworkPolicy.mode === 'egress_allowlist' &&
          profileNetworkPolicy.provider === 'docker_network_proxy' &&
          profileNetworkPolicy.provider_config.provider_config_digest !== input.network_provider_config_digest)
      ) {
        throw codexDenied('codex_launch_lease_denied', 'Launch lease runtime profile fence was rejected.');
      }
      if (
        (await repository.findAvailableCodexWorker({
          project_id: input.target.project_id,
          ...(input.target.repo_id === undefined ? {} : { repo_id: input.target.repo_id }),
          target_kind: input.target.target_kind,
          docker_image_digest: input.docker_image_digest,
          network_policy_digest: input.network_policy_digest,
          ...(input.network_provider_config_digest === undefined
            ? {}
            : { network_provider_config_digest: input.network_provider_config_digest }),
          now: input.now,
        }))?.id !== input.worker_id
      ) {
        throw codexDenied('codex_launch_lease_denied', 'Launch lease worker fence was rejected.');
      }
      const credential = await repository.resolveCodexCredentialForLaunch({
        credential_binding_id: input.credential_binding_id,
        target_kind: input.target.target_kind,
        runtime_profile_id: profileRevision.profile_id,
        project_id: input.target.project_id,
        ...(input.target.repo_id === undefined ? {} : { repo_id: input.target.repo_id }),
        required_payload_digest: input.credential_payload_digest,
        now: input.now,
      });
      if (credential?.binding_version_id !== input.credential_binding_version_id) {
        throw codexDenied('codex_launch_lease_denied', 'Launch lease credential fence was rejected.');
      }

      const [row] = await tx
        .insert(codex_launch_leases)
        .values({
          id: input.id,
          leaseRequestId: input.lease_request_id,
          targetType: input.target.target_type,
          targetId: input.target.target_id,
          targetKind: input.target.target_kind,
          projectId: input.target.project_id,
          repoId: input.target.repo_id ?? null,
          launchAttempt: input.launch_attempt,
          actionType: input.action_type ?? null,
          actionAttempt: input.action_attempt ?? null,
          actionClaimTokenHash: input.action_claim_token_hash ?? null,
          preconditionFingerprint: input.precondition_fingerprint ?? null,
          executionPackageId: input.execution_package_id ?? null,
          runWorkerLeaseId: input.run_worker_lease_id ?? null,
          runWorkerLeaseTokenHash: input.run_worker_lease_token_hash ?? null,
          runSessionStatus: input.run_session_status ?? null,
          runSessionUpdatedAt: input.run_session_updated_at ?? null,
          executionPackageVersion: input.execution_package_version ?? null,
          workerId: input.worker_id,
          status: 'active',
          leaseTokenHash: codexCredentialPayloadDigest(input.launch_token),
          runtimeProfileRevisionId: input.runtime_profile_revision_id,
          runtimeProfileDigest: input.runtime_profile_digest,
          credentialBindingId: input.credential_binding_id,
          credentialBindingVersionId: input.credential_binding_version_id,
          credentialPayloadDigest: input.credential_payload_digest,
          dockerImageDigest: input.docker_image_digest,
          networkPolicyDigest: input.network_policy_digest,
          networkProviderConfigDigest: input.network_provider_config_digest ?? null,
          createdAt: input.now,
          expiresAt: input.expires_at,
        } as never)
        .onConflictDoNothing()
        .returning();
      if (row === undefined) {
        const replayed = await replayExisting();
        if (replayed === undefined) {
          throw codexDenied('codex_launch_lease_denied', 'Launch lease idempotency record is inconsistent.');
        }
        return replayed;
      }

      const [workerUpdate] = await tx
        .update(codex_worker_registrations)
        .set({ leaseCount: sql`${codex_worker_registrations.leaseCount} + 1` } as never)
        .where(
          and(
            eq(codex_worker_registrations.id, input.worker_id),
            eq(codex_worker_registrations.status, 'online'),
            eq(codex_worker_registrations.controlChannelStatus, 'connected'),
            sql`${codex_worker_registrations.leaseCount} < ${codex_worker_registrations.maxConcurrency}`,
          ),
        )
        .returning({ id: codex_worker_registrations.id });
      if (workerUpdate === undefined) {
        throw codexDenied('codex_launch_lease_denied', 'Launch lease worker fence was rejected.');
      }

      return { ...launchLeaseFromDbRecord(fromDbRecord<CodexLaunchLeaseDbRecord>(row as Record<string, unknown>)), lease_token: input.launch_token };
    });
  }

  async materializeCodexLaunchLease(input: MaterializeCodexLaunchLeaseInput): Promise<CodexLaunchMaterialization> {
    return this.db.transaction(async (tx) => {
      const repository = new DrizzleDeliveryRepository(tx as ForgeloopDrizzleDatabase);
      await repository.assertCodexWorkerSession(
        input.worker_id,
        input.worker_session_token,
        'codex_launch_materialization_denied',
        input.now,
      );
      await repository.recordCodexWorkerNonce(
        input.worker_id,
        input.worker_session_token,
        input.nonce,
        input.nonce_timestamp,
        input.now,
        input.replay_protection,
      );

      const materializationPredicate = and(
        eq(codex_launch_leases.id, input.lease_id),
        eq(codex_launch_leases.workerId, input.worker_id),
        eq(codex_launch_leases.status, 'active'),
        gt(codex_launch_leases.expiresAt, input.now),
        eq(codex_launch_leases.leaseTokenHash, codexCredentialPayloadDigest(input.launch_token)),
        ...(input.active_fence === undefined
          ? []
          : [
              repository.codexFenceCondition(codex_launch_leases.actionClaimTokenHash, input.active_fence.action_claim_token_hash),
              repository.codexFenceCondition(codex_launch_leases.preconditionFingerprint, input.active_fence.precondition_fingerprint),
              repository.codexFenceCondition(codex_launch_leases.runWorkerLeaseId, input.active_fence.run_worker_lease_id),
              repository.codexFenceCondition(codex_launch_leases.runWorkerLeaseTokenHash, input.active_fence.run_worker_lease_token_hash),
              repository.codexFenceCondition(codex_launch_leases.runSessionStatus, input.active_fence.run_session_status),
              repository.codexFenceCondition(codex_launch_leases.runSessionUpdatedAt, input.active_fence.run_session_updated_at),
              repository.codexFenceCondition(codex_launch_leases.executionPackageVersion, input.active_fence.execution_package_version),
            ]),
      );

      const [candidateRow] = await tx.select().from(codex_launch_leases).where(materializationPredicate).limit(1);
      if (candidateRow === undefined) {
        throw codexDenied('codex_launch_materialization_denied', 'Codex launch lease materialization was denied.');
      }
      const candidate = fromDbRecord<CodexLaunchLeaseDbRecord>(candidateRow);
      if (!(await repository.codexLaunchFenceIsActive(candidate, input.now))) {
        throw codexDenied('codex_launch_materialization_denied', 'Codex launch lease materialization was denied.');
      }
      const profileRevision = await repository.getById<CodexRuntimeProfileRevision>(
        codex_runtime_profile_revisions,
        codex_runtime_profile_revisions.id,
        candidate.runtime_profile_revision_id,
      );
      const [credentialRow] = await tx
        .select()
        .from(codex_credential_binding_versions)
        .where(eq(codex_credential_binding_versions.id, candidate.credential_binding_version_id))
        .limit(1);
      const credentialBinding = await repository.getById<CodexCredentialBinding>(
        codex_credential_bindings,
        codex_credential_bindings.id,
        candidate.credential_binding_id,
      );
      const [workerRow] = await tx
        .select()
        .from(codex_worker_registrations)
        .where(eq(codex_worker_registrations.id, input.worker_id))
        .limit(1);
      if (profileRevision === undefined || credentialRow === undefined || credentialBinding === undefined || workerRow === undefined) {
        throw codexDenied('codex_launch_materialization_denied', 'Codex launch lease materialization dependencies were unavailable.');
      }
      const credentialRecord = fromDbRecord<CodexCredentialBindingVersion & { secret_payload_json: unknown }>(credentialRow);
      const workerRecord = fromDbRecord<CodexWorkerRegistrationDbRecord>(workerRow as Record<string, unknown>);
      if (
        profileRevision.status !== 'active' ||
        profileRevision.profile_digest !== candidate.runtime_profile_digest ||
        credentialRecord.status !== 'active' ||
        credentialRecord.payload_digest !== candidate.credential_payload_digest ||
        credentialBinding.profile_id !== profileRevision.profile_id ||
        !repository.workerRecordMatchesLaunch(workerRecord, candidate, profileRevision)
      ) {
        throw codexDenied('codex_launch_materialization_denied', 'Codex launch lease materialization dependencies were unavailable.');
      }

      const [row] = await tx
        .update(codex_launch_leases)
        .set({
          status: 'materialized',
          materializationRequestHash: input.materialization_request_hash,
          materializedAt: input.now,
        } as never)
        .where(materializationPredicate)
        .returning();
      if (row === undefined) {
        throw codexDenied('codex_launch_materialization_denied', 'Codex launch lease materialization was denied.');
      }
      const record = fromDbRecord<CodexLaunchLeaseDbRecord>(row as Record<string, unknown>);
      return {
        launch_target: launchLeaseFromDbRecord(record).target,
        profile_revision: profileRevision,
        resolved_credentials: [
          {
            binding_id: record.credential_binding_id,
            binding_version_id: credentialRecord.id,
            payload: credentialRecord.secret_payload_json,
            payload_digest: credentialRecord.payload_digest,
          },
        ],
        lease_id: record.id,
        expires_at: record.expires_at,
        materialized_at: input.now,
      };
    });
  }

  async terminalizeCodexLaunchLease(input: TerminalizeCodexLaunchLeaseInput): Promise<CodexLaunchLease> {
    return this.db.transaction(async (tx) => {
      const repository = new DrizzleDeliveryRepository(tx as ForgeloopDrizzleDatabase);
      await repository.assertCodexWorkerSession(input.worker_id, input.worker_session_token, 'codex_launch_lease_denied', input.now, {
        requireConnected: false,
      });
      await repository.recordCodexWorkerNonce(
        input.worker_id,
        input.worker_session_token,
        input.nonce,
        input.nonce_timestamp,
        input.now,
        input.replay_protection,
      );
      const [row] = await tx
        .update(codex_launch_leases)
        .set({
          status: 'terminal',
          terminalizedAt: input.now,
          terminalReasonCode: input.reason_code,
          terminalEvidenceSummaryJson: input.evidence_summary ?? null,
          terminalRuntimeJobId: input.runtime_job_id ?? null,
          terminalIdempotencyKey: input.idempotency_key,
        } as never)
        .where(
          and(
            eq(codex_launch_leases.id, input.lease_id),
            eq(codex_launch_leases.workerId, input.worker_id),
            or(eq(codex_launch_leases.status, 'active'), eq(codex_launch_leases.status, 'materialized')),
            isNull(codex_launch_leases.terminalizedAt),
          ),
        )
        .returning();
      if (row !== undefined) {
        const record = fromDbRecord<CodexLaunchLeaseDbRecord>(row as Record<string, unknown>);
        if (await repository.codexLaunchLeaseOccupiesWorkerSlot(record.id)) {
          await repository.decrementCodexWorkerLeaseCounts(tx as ForgeloopDrizzleDatabase, [input.worker_id]);
        }
        return launchLeaseFromDbRecord(record);
      }
      const [currentRow] = await tx
        .select()
        .from(codex_launch_leases)
        .where(and(eq(codex_launch_leases.id, input.lease_id), eq(codex_launch_leases.workerId, input.worker_id)))
        .limit(1);
      if (currentRow === undefined) {
        throw codexDenied('codex_launch_lease_denied', 'Codex launch lease terminalization was denied.');
      }
      const current = fromDbRecord<CodexLaunchLeaseDbRecord>(currentRow as Record<string, unknown>);
      if (
        current.status === 'terminal' &&
        current.terminal_idempotency_key !== undefined &&
        current.terminal_idempotency_key !== input.idempotency_key
      ) {
        throw codexDenied('codex_launch_lease_denied', 'Codex launch lease terminalization idempotency key was rejected.');
      }
      if (current.status === 'terminal' || current.status === 'expired' || current.status === 'revoked') {
        return launchLeaseFromDbRecord(current);
      }
      throw codexDenied('codex_launch_lease_denied', 'Codex launch lease terminalization was denied.');
    });
  }

  async revokeCodexLaunchLease(input: RevokeCodexLaunchLeaseInput): Promise<CodexLaunchLease> {
    return this.db.transaction(async (tx) => {
      const repository = new DrizzleDeliveryRepository(tx as ForgeloopDrizzleDatabase);
      const [leasedRow] = await tx
        .update(codex_launch_leases)
        .set({ status: 'revoked', terminalizedAt: input.now, terminalReasonCode: input.reason_code } as never)
        .where(
          and(
            eq(codex_launch_leases.id, input.lease_id),
            or(
              eq(codex_launch_leases.status, 'active'),
              and(
                eq(codex_launch_leases.status, 'materialized'),
                isNotNull(codex_launch_leases.materializedAt),
                isNull(codex_launch_leases.terminalizedAt),
              ),
            ),
          ),
        )
        .returning();
      if (leasedRow !== undefined) {
        const record = fromDbRecord<CodexLaunchLeaseDbRecord>(leasedRow as Record<string, unknown>);
        await repository.decrementCodexWorkerLeaseCounts(
          tx as ForgeloopDrizzleDatabase,
          record.worker_id !== undefined && (await repository.codexLaunchLeaseOccupiesWorkerSlot(record.id)) ? [record.worker_id] : [],
        );
        return launchLeaseFromDbRecord(record);
      }
      const [currentRow] = await tx.select().from(codex_launch_leases).where(eq(codex_launch_leases.id, input.lease_id)).limit(1);
      if (currentRow === undefined) {
        throw codexDenied('codex_launch_lease_denied', 'Codex launch lease was not found.');
      }
      const current = fromDbRecord<CodexLaunchLeaseDbRecord>(currentRow as Record<string, unknown>);
      if (current.status === 'terminal' || current.status === 'expired' || current.status === 'revoked') {
        return launchLeaseFromDbRecord(current);
      }
      throw codexDenied('codex_launch_lease_denied', 'Codex launch lease was not found.');
    });
  }

  async expireCodexLaunchLeases(now: string): Promise<number> {
    return this.db.transaction(async (tx) => {
      const repository = new DrizzleDeliveryRepository(tx as ForgeloopDrizzleDatabase);
      const leaseRows = await tx
        .update(codex_launch_leases)
        .set({ status: 'expired', terminalizedAt: now, terminalReasonCode: 'codex_launch_lease_expired' } as never)
        .where(
          and(
            or(eq(codex_launch_leases.status, 'active'), eq(codex_launch_leases.status, 'materialized')),
            sql`${codex_launch_leases.expiresAt} <= ${now}`,
          ),
        )
        .returning();
      await repository.decrementCodexWorkerLeaseCounts(
        tx as ForgeloopDrizzleDatabase,
        (
          await Promise.all(
            leaseRows.map(async (row) =>
              row.workerId === null || !(await repository.codexLaunchLeaseOccupiesWorkerSlot(row.id)) ? [] : [row.workerId],
            ),
          )
        ).flat(),
      );
      return leaseRows.length;
    });
  }

  async recoverStaleCodexWorkerLeases(input: RecoverStaleCodexWorkerLeasesInput): Promise<CodexRuntimeRecoveryResult> {
    const workerConditions = [
      or(isNull(codex_worker_registrations.lastHeartbeatAt), sql`${codex_worker_registrations.lastHeartbeatAt} < ${input.stale_before}`),
    ];
    if (input.worker_id !== undefined) {
      workerConditions.push(eq(codex_worker_registrations.id, input.worker_id));
    }
    const staleWorkers = await this.db
      .select({ id: codex_worker_registrations.id })
      .from(codex_worker_registrations)
      .where(and(...workerConditions));
    const staleWorkerIds = staleWorkers.map((worker) => worker.id);
    if (staleWorkerIds.length === 0) {
      return { recovered_launch_leases: [], automation_action_transitions: [], run_session_transitions: [] };
    }
    const rows = await this.db.transaction(async (tx) => {
      await tx
        .update(codex_worker_registrations)
        .set({ status: 'offline', controlChannelStatus: 'disconnected' } as never)
        .where(inArray(codex_worker_registrations.id, staleWorkerIds));
      const recoveredRows = await tx
        .update(codex_launch_leases)
        .set({ status: 'expired', terminalizedAt: input.now, terminalReasonCode: input.reason_code } as never)
        .where(
          and(
            inArray(codex_launch_leases.workerId, staleWorkerIds),
            sql`${codex_launch_leases.leaseRequestId} not like 'runtime-job:%'`,
            or(
              eq(codex_launch_leases.status, 'active'),
              and(
                eq(codex_launch_leases.status, 'materialized'),
                isNotNull(codex_launch_leases.materializedAt),
                isNull(codex_launch_leases.terminalizedAt),
              ),
            ),
          ),
        )
        .returning();
      const repository = new DrizzleDeliveryRepository(tx as ForgeloopDrizzleDatabase);
      const recoveredRecords = recoveredRows.map((row) => fromDbRecord<CodexLaunchLeaseDbRecord>(row as Record<string, unknown>));
      for (const record of recoveredRecords) {
        if (record.action_type !== undefined || record.target_type === 'automation_action_run') {
          await repository.markCodexRecoveredAutomationAction(record.target_id, input.reason_code, input.now);
        }
        if (record.run_worker_lease_id !== undefined) {
          await repository.markCodexRecoveredRunSession(record.run_worker_lease_id, input.reason_code, input.now);
        }
      }
      await repository.decrementCodexWorkerLeaseCounts(
        tx as ForgeloopDrizzleDatabase,
        (
          await Promise.all(
            recoveredRows.map(async (row) =>
              row.workerId === null || !(await repository.codexLaunchLeaseOccupiesWorkerSlot(row.id)) ? [] : [row.workerId],
            ),
          )
        ).flat(),
      );
      return recoveredRows;
    });
    const records = rows.map((row) => fromDbRecord<CodexLaunchLeaseDbRecord>(row as Record<string, unknown>));
    return {
      recovered_launch_leases: records.map(launchLeaseFromDbRecord),
      automation_action_transitions: records
        .filter((record) => record.action_type !== undefined || record.target_type === 'automation_action_run')
        .map((record) => ({
          ...(record.action_type === undefined ? {} : { action_type: record.action_type }),
          target_id: record.target_id,
          reason_code: input.reason_code,
        })),
      run_session_transitions: records
        .filter((record) => record.execution_package_id !== undefined || record.run_worker_lease_id !== undefined)
        .map((record) => ({
          ...(record.run_worker_lease_id === undefined ? {} : { run_session_id: record.run_worker_lease_id.split(':')[0] }),
          ...(record.execution_package_id === undefined ? {} : { execution_package_id: record.execution_package_id }),
          reason_code: input.reason_code,
        })),
    };
  }

  private async markCodexRecoveredAutomationAction(actionRunId: string, reasonCode: string, now: string): Promise<void> {
    const actionRun = await this.getById<AutomationActionRun>(automation_action_runs, automation_action_runs.id, actionRunId);
    if (actionRun === undefined || actionRun.status !== 'running') {
      return;
    }
    await this.upsert(automation_action_runs, automation_action_runs.id, {
      ...actionRun,
      status: 'gate_pending',
      reason: reasonCode,
      result_json: {
        ...(actionRun.result_json ?? {}),
        codex_runtime_blocker_code: reasonCode,
      },
      updated_at: now,
    });
  }

  private async markCodexRecoveredRunSession(runWorkerLeaseId: string, reasonCode: string, now: string): Promise<void> {
    const runWorkerLease = await this.getById<RunWorkerLease>(run_worker_leases, run_worker_leases.id, runWorkerLeaseId);
    const runSessionId = runWorkerLease?.run_session_id ?? runWorkerLeaseId.split(':')[0];
    if (runSessionId === undefined || runSessionId.length === 0) {
      return;
    }
    const runSession = await this.getById<RunSession>(run_sessions, run_sessions.id, runSessionId);
    if (runSession === undefined || !isActiveRunSessionStatus(runSession.status)) {
      return;
    }
    await this.upsert(run_sessions, run_sessions.id, {
      ...runSession,
      status: 'stalled',
      ...(runSession.runtime_metadata === undefined
        ? {}
        : {
            runtime_metadata: {
              ...runSession.runtime_metadata,
              driver_status: 'stalled',
              worker_lease_status: 'expired',
            },
          }),
      failure_kind: 'executor_error',
      failure_reason: reasonCode,
      updated_at: now,
    });
  }

  async consumeCodexRuntimeSetupNonce(input: ConsumeCodexRuntimeSetupNonceInput): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(codex_runtime_setup_nonces).where(sql`${codex_runtime_setup_nonces.expiresAt} <= ${input.created_at}`);
      const [row] = await tx
        .insert(codex_runtime_setup_nonces)
        .values({
          setupNonceHash: input.setup_nonce_hash,
          requestSignatureHash: input.request_signature_hash,
          actorId: input.actor_id,
          actorClass: input.actor_class,
          createdAt: input.created_at,
          expiresAt: input.expires_at,
        })
        .onConflictDoNothing({ target: codex_runtime_setup_nonces.setupNonceHash })
        .returning({ setupNonceHash: codex_runtime_setup_nonces.setupNonceHash });
      if (row === undefined) {
        throw codexDenied('codex_worker_nonce_replay', 'Codex runtime setup nonce was already used.');
      }
    });
  }

  async saveOrganization(organization: Organization): Promise<void> {
    await this.upsert(organizations, organizations.id, organization);
  }

  async getOrganization(organizationId: string): Promise<Organization | undefined> {
    return this.getById(organizations, organizations.id, organizationId);
  }

  async saveActor(actor: Actor): Promise<void> {
    await this.upsert(actors, actors.id, actor);
  }

  async getActor(actorId: string): Promise<Actor | undefined> {
    return this.getById(actors, actors.id, actorId);
  }

  async listActorsForOrganization(organizationId: string): Promise<Actor[]> {
    return this.listWhere<Actor>(actors, eq(actors.orgId, organizationId), [actors.createdAt, actors.id]);
  }

  async saveProject(project: Project): Promise<void> {
    await this.upsert(projects, projects.id, project);
  }

  async getProject(projectId: string): Promise<Project | undefined> {
    return this.getById(projects, projects.id, projectId);
  }

  async saveProjectRepo(projectRepo: ProjectRepo): Promise<void> {
    await this.upsert(project_repos, project_repos.id, projectRepo);
  }

  async listProjectRepos(projectId: string): Promise<ProjectRepo[]> {
    return this.listWhere<ProjectRepo>(project_repos, eq(project_repos.projectId, projectId));
  }

  async saveWorkItem(workItem: WorkItem): Promise<void> {
    await this.upsert(work_items, work_items.id, {
      ...workItem,
      narrative_markdown: workItem.narrative_markdown ?? '',
    });
  }

  async getWorkItem(workItemId: string): Promise<WorkItem | undefined> {
    return this.getById(work_items, work_items.id, workItemId);
  }

  async listWorkItems(projectId?: string): Promise<WorkItem[]> {
    return projectId === undefined
      ? this.listWhere<WorkItem>(work_items)
      : this.listWhere<WorkItem>(work_items, eq(work_items.projectId, projectId));
  }

  async updateWorkItemNarrative(input: { work_item_id: string; markdown: string; updated_at: string }): Promise<WorkItem> {
    const [row] = await this.db
      .update(work_items)
      .set({ narrativeMarkdown: input.markdown, updatedAt: input.updated_at })
      .where(eq(work_items.id, input.work_item_id))
      .returning();
    if (row === undefined) {
      throw new DomainError('INVALID_TRANSITION', `Work Item ${input.work_item_id} was not found`);
    }
    return fromDbRecord<WorkItem>(row);
  }

  async saveTask(task: Task): Promise<void> {
    await this.upsert(tasks, tasks.id, task);
  }

  async getTask(taskId: string): Promise<Task | undefined> {
    return this.getById(tasks, tasks.id, taskId);
  }

  async listTasks(projectId?: string): Promise<Task[]> {
    return projectId === undefined
      ? this.listWhere<Task>(tasks, undefined, tasks.createdAt)
      : this.listWhere<Task>(tasks, eq(tasks.projectId, projectId), tasks.createdAt);
  }

  async listTasksForParent(parentRef: ObjectRef): Promise<Task[]> {
    const rows = await this.db
      .select()
      .from(tasks)
      .where(and(sql`${tasks.parentRef}->>'type' = ${parentRef.type}`, sql`${tasks.parentRef}->>'id' = ${parentRef.id}`))
      .orderBy(asc(tasks.createdAt));
    return rows.map((row) => fromDbRecord<Task>(row));
  }

  async updateTaskNarrative(input: { task_id: string; markdown: string; updated_at: string }): Promise<Task> {
    const [row] = await this.db
      .update(tasks)
      .set({ narrativeMarkdown: input.markdown, updatedAt: input.updated_at })
      .where(eq(tasks.id, input.task_id))
      .returning();
    if (row === undefined) {
      throw new DomainError('INVALID_TRANSITION', `Task ${input.task_id} was not found`);
    }
    return fromDbRecord<Task>(row);
  }

  async saveSpec(spec: Spec): Promise<void> {
    await this.upsert(specs, specs.id, spec);
  }

  async getSpec(specId: string): Promise<Spec | undefined> {
    return this.getById(specs, specs.id, specId);
  }

  async listSpecs(projectId?: string): Promise<Spec[]> {
    if (projectId === undefined) {
      return this.listWhere<Spec>(specs, undefined, specs.createdAt);
    }

    const rows = await this.db
      .select(getTableColumns(specs))
      .from(specs)
      .innerJoin(work_items, eq(specs.workItemId, work_items.id))
      .where(eq(work_items.projectId, projectId))
      .orderBy(asc(specs.createdAt));
    return rows.map((row) => fromDbRecord<Spec>(row));
  }

  async saveSpecRevision(specRevision: SpecRevision): Promise<void> {
    await this.upsert(spec_revisions, spec_revisions.id, specRevision);
  }

  async getSpecRevision(specRevisionId: string): Promise<SpecRevision | undefined> {
    return this.getById(spec_revisions, spec_revisions.id, specRevisionId);
  }

  async listSpecRevisions(specId: string): Promise<SpecRevision[]> {
    return this.listWhere<SpecRevision>(spec_revisions, eq(spec_revisions.specId, specId), spec_revisions.revisionNumber);
  }

  async saveContextManifest(contextManifest: ContextManifest): Promise<void> {
    await this.upsert(context_manifests, context_manifests.id, contextManifest);
  }

  async getContextManifest(contextManifestId: string): Promise<ContextManifest | undefined> {
    return this.getById(context_manifests, context_manifests.id, contextManifestId);
  }

  async saveDevelopmentPlan(plan: DevelopmentPlan): Promise<void> {
    await this.upsert(development_plans, development_plans.id, { ...plan, items: [] });
  }

  async getDevelopmentPlan(id: string): Promise<DevelopmentPlan | undefined> {
    const plan = await this.getById<DevelopmentPlan>(development_plans, development_plans.id, id);
    return plan === undefined ? undefined : this.hydrateDevelopmentPlan(plan);
  }

  async listDevelopmentPlans(projectId: string): Promise<DevelopmentPlan[]> {
    const plans = await this.listWhere<DevelopmentPlan>(development_plans, eq(development_plans.projectId, projectId), [
      development_plans.createdAt,
      development_plans.id,
    ]);
    return Promise.all(plans.map((plan) => this.hydrateDevelopmentPlan(plan)));
  }

  async saveDevelopmentPlanRevision(revision: DevelopmentPlanRevision): Promise<void> {
    await this.insertImmutable(development_plan_revisions, revision);
  }

  async listDevelopmentPlanRevisions(developmentPlanId: string): Promise<DevelopmentPlanRevision[]> {
    return this.listWhere<DevelopmentPlanRevision>(
      development_plan_revisions,
      eq(development_plan_revisions.developmentPlanId, developmentPlanId),
      development_plan_revisions.revisionNumber,
    );
  }

  async saveDevelopmentPlanSourceLink(link: DevelopmentPlanSourceLink): Promise<void> {
    await this.upsert(development_plan_source_links, development_plan_source_links.id, link);
  }

  async listDevelopmentPlanSourceLinks(developmentPlanId: string): Promise<DevelopmentPlanSourceLink[]> {
    return this.listWhere<DevelopmentPlanSourceLink>(
      development_plan_source_links,
      eq(development_plan_source_links.developmentPlanId, developmentPlanId),
      [development_plan_source_links.createdAt, development_plan_source_links.id],
    );
  }

  async listDevelopmentPlanSourceLinksForSource(
    sourceRef: DevelopmentPlanSourceLink['source_ref'],
  ): Promise<DevelopmentPlanSourceLink[]> {
    const links = await this.listWhere<DevelopmentPlanSourceLink>(
      development_plan_source_links,
      undefined,
      [development_plan_source_links.createdAt, development_plan_source_links.id],
    );
    return links.filter(
      (link) =>
        link.source_ref.type === sourceRef.type &&
        link.source_ref.id === sourceRef.id &&
        (sourceRef.revision_id === undefined || link.source_ref.revision_id === sourceRef.revision_id),
    );
  }

  async saveDevelopmentPlanItem(item: DevelopmentPlanItem): Promise<void> {
    await this.upsert(development_plan_items, development_plan_items.id, this.developmentPlanItemDbRecord(item));
  }

  async getDevelopmentPlanItem(id: string): Promise<DevelopmentPlanItem | undefined> {
    return this.getById(development_plan_items, development_plan_items.id, id);
  }

  async listDevelopmentPlanItems(developmentPlanId: string): Promise<DevelopmentPlanItem[]> {
    return this.listWhere<DevelopmentPlanItem>(
      development_plan_items,
      eq(development_plan_items.developmentPlanId, developmentPlanId),
      [development_plan_items.createdAt, development_plan_items.id],
    );
  }

  private async hydrateDevelopmentPlan(plan: DevelopmentPlan): Promise<DevelopmentPlan> {
    return {
      ...plan,
      items: await this.listDevelopmentPlanItems(plan.id),
    };
  }

  async saveDevelopmentPlanItemRevision(revision: DevelopmentPlanItemRevision): Promise<void> {
    await this.insertImmutable(development_plan_item_revisions, revision);
  }

  async listDevelopmentPlanItemRevisions(itemId: string): Promise<DevelopmentPlanItemRevision[]> {
    return this.listWhere<DevelopmentPlanItemRevision>(
      development_plan_item_revisions,
      eq(development_plan_item_revisions.developmentPlanItemId, itemId),
      development_plan_item_revisions.revisionNumber,
    );
  }

  async compareDevelopmentPlanItemRevisions(query: RevisionCompareQuery): Promise<StructuredRevisionDiff> {
    const [base, compare] = await Promise.all([
      this.getById<DevelopmentPlanItemRevision>(
        development_plan_item_revisions,
        development_plan_item_revisions.id,
        query.base_revision_id,
      ),
      this.getById<DevelopmentPlanItemRevision>(
        development_plan_item_revisions,
        development_plan_item_revisions.id,
        query.compare_revision_id,
      ),
    ]);
    return revisionDiff(query, base?.snapshot, compare?.snapshot);
  }

  async saveBrainstormingSession(session: BrainstormingSession): Promise<void> {
    await this.upsert(brainstorming_sessions, brainstorming_sessions.id, await this.brainstormingSessionDbRecord(session));
  }

  async getBrainstormingSession(id: string): Promise<BrainstormingSession | undefined> {
    return this.getById(brainstorming_sessions, brainstorming_sessions.id, id);
  }

  async saveBoundaryRound(round: BoundaryRoundRecord): Promise<void> {
    await this.upsert(boundary_rounds, boundary_rounds.id, round);
  }

  async listBoundaryRounds(sessionId: string): Promise<BoundaryRoundRecord[]> {
    return this.listWhere<BoundaryRoundRecord>(boundary_rounds, eq(boundary_rounds.sessionId, sessionId), [
      boundary_rounds.roundNumber,
      boundary_rounds.id,
    ]);
  }

  async saveBoundaryQuestion(question: BoundaryQuestionRecord): Promise<void> {
    await this.upsert(boundary_questions, boundary_questions.id, question);
  }

  async listBoundaryQuestions(sessionId: string): Promise<BoundaryQuestionRecord[]> {
    return this.listWhere<BoundaryQuestionRecord>(boundary_questions, eq(boundary_questions.sessionId, sessionId), [
      boundary_questions.sequence,
      boundary_questions.id,
    ]);
  }

  async saveBoundaryAnswer(answer: BoundaryAnswerRecord): Promise<void> {
    await this.upsert(boundary_answers, boundary_answers.id, answer);
  }

  async listBoundaryAnswers(sessionId: string): Promise<BoundaryAnswerRecord[]> {
    return this.listWhere<BoundaryAnswerRecord>(boundary_answers, eq(boundary_answers.sessionId, sessionId), [
      boundary_answers.sequence,
      boundary_answers.id,
    ]);
  }

  async saveBoundaryDecision(decision: BoundaryDecisionRecord): Promise<void> {
    await this.upsert(boundary_decisions, boundary_decisions.id, decision);
  }

  async listBoundaryDecisions(sessionId: string): Promise<BoundaryDecisionRecord[]> {
    return this.listWhere<BoundaryDecisionRecord>(boundary_decisions, eq(boundary_decisions.sessionId, sessionId), [
      boundary_decisions.sequence,
      boundary_decisions.id,
    ]);
  }

  async saveBoundarySummary(summary: BoundarySummary): Promise<void> {
    await this.upsert(boundary_summaries, boundary_summaries.id, summary);
  }

  async getBoundarySummary(id: string): Promise<BoundarySummary | undefined> {
    return this.getById(boundary_summaries, boundary_summaries.id, id);
  }

  async listBoundarySummaries(): Promise<BoundarySummary[]> {
    return this.listWhere<BoundarySummary>(boundary_summaries, undefined, [
      boundary_summaries.createdAt,
      boundary_summaries.id,
    ]);
  }

  async saveBoundarySummaryRevision(revision: BoundarySummaryRevision): Promise<void> {
    const hydrated = await this.hydrateBoundarySummaryRevisionForSave(revision);
    await this.insertImmutable(boundary_summary_revisions, this.boundarySummaryRevisionDbRecord(hydrated));
  }

  async updateBoundarySummaryRevision(revision: BoundarySummaryRevision): Promise<void> {
    const hydrated = await this.hydrateBoundarySummaryRevisionForSave(revision);
    await this.db
      .update(boundary_summary_revisions)
      .set(this.boundarySummaryRevisionDbRecord(hydrated) as never)
      .where(eq(boundary_summary_revisions.id, revision.id));
  }

  async listBoundarySummaryRevisions(boundarySummaryId: string): Promise<BoundarySummaryRevision[]> {
    return this.listWhere<BoundarySummaryRevision>(
      boundary_summary_revisions,
      eq(boundary_summary_revisions.boundarySummaryId, boundarySummaryId),
      boundary_summary_revisions.revisionNumber,
    );
  }

  async compareBoundarySummaryRevisions(query: RevisionCompareQuery): Promise<StructuredRevisionDiff> {
    const [base, compare] = await Promise.all([
      this.getById<BoundarySummaryRevision>(boundary_summary_revisions, boundary_summary_revisions.id, query.base_revision_id),
      this.getById<BoundarySummaryRevision>(
        boundary_summary_revisions,
        boundary_summary_revisions.id,
        query.compare_revision_id,
      ),
    ]);
    return revisionDiff(query, base, compare);
  }

  async backfillBoundaryLeaderDefaults(input: {
    now: string;
  }): Promise<{ updated_item_ids: string[]; updated_session_ids: string[]; blocked_item_ids: string[] }> {
    const updatedItemIds: string[] = [];
    const blockedItemIds: string[] = [];
    const updatedSessionIds: string[] = [];
    const items = await this.listWhere<DevelopmentPlanItem>(development_plan_items, undefined, development_plan_items.id);
    const leaderDefaults = new Map<string, { leader_actor_id: string | undefined; leader_delegate_actor_ids: string[] }>();

    for (const item of items) {
      const legacyItem = item as Partial<DevelopmentPlanItem>;
      const leaderActorId = legacyItem.leader_actor_id ?? item.reviewer_actor_id ?? item.driver_actor_id;
      const leaderDelegateActorIds = legacyItem.leader_delegate_actor_ids ?? [];
      leaderDefaults.set(item.id, { leader_actor_id: leaderActorId, leader_delegate_actor_ids: leaderDelegateActorIds });

      if (leaderActorId === undefined) {
        blockedItemIds.push(item.id);
        if (legacyItem.leader_delegate_actor_ids === undefined) {
          await this.upsert(development_plan_items, development_plan_items.id, {
            ...item,
            leader_delegate_actor_ids: [],
            updated_at: input.now,
          });
        }
        continue;
      }

      if (legacyItem.leader_actor_id !== leaderActorId || legacyItem.leader_delegate_actor_ids === undefined) {
        await this.upsert(development_plan_items, development_plan_items.id, {
          ...item,
          leader_actor_id: leaderActorId,
          leader_delegate_actor_ids: leaderDelegateActorIds,
          updated_at: input.now,
        });
        updatedItemIds.push(item.id);
      }
    }

    const sessions = await this.listWhere<BrainstormingSession>(brainstorming_sessions, undefined, brainstorming_sessions.id);
    for (const session of sessions) {
      const effectiveStatus = session.status ?? this.boundarySessionStatusForApprovalState(session.approval_state);
      if (!activeBoundarySessionStatuses.has(effectiveStatus)) {
        continue;
      }

      const defaults = leaderDefaults.get(session.development_plan_item_id);
      if (defaults?.leader_actor_id === undefined) {
        continue;
      }
      const leaderActorId = defaults.leader_actor_id;

      const changed = await this.db.transaction(async (tx) => {
        const repository = this.childRepository(tx as ForgeloopDrizzleDatabase);
        const existingRounds = await repository.listBoundaryRounds(session.id);
        const roundId = session.current_round_id ?? existingRounds.at(-1)?.id ?? `${session.id}-round-1`;
        let nextSession = { ...session };
        let sessionChanged = false;

        if (nextSession.development_plan_revision_id === undefined) {
          const plan = await repository.getDevelopmentPlan(session.development_plan_id);
          if (plan?.revision_id !== undefined) {
            nextSession = { ...nextSession, development_plan_revision_id: plan.revision_id };
            sessionChanged = true;
          }
        }
        if (nextSession.leader_actor_id === undefined) {
          nextSession = { ...nextSession, leader_actor_id: leaderActorId };
          sessionChanged = true;
        }
        if (nextSession.leader_delegate_actor_ids === undefined) {
          nextSession = { ...nextSession, leader_delegate_actor_ids: defaults.leader_delegate_actor_ids };
          sessionChanged = true;
        }
        if (nextSession.status === undefined) {
          nextSession = { ...nextSession, status: effectiveStatus };
          sessionChanged = true;
        }
        if (existingRounds.length === 0) {
          await repository.saveBoundaryRound({
            id: roundId,
            session_id: session.id,
            session_revision_id: session.revision_id,
            round_number: 1,
            trigger: 'start',
            status: this.syntheticBoundaryRoundStatusFor(effectiveStatus),
            created_at: session.created_at,
            updated_at: input.now,
          });
          sessionChanged = true;
        }
        await repository.attachLegacyBoundaryEvidenceToRound(session, roundId);
        if (nextSession.current_round_id === undefined) {
          nextSession = { ...nextSession, current_round_id: roundId };
          sessionChanged = true;
        }

        if (sessionChanged) {
          await repository.upsert(brainstorming_sessions, brainstorming_sessions.id, { ...nextSession, updated_at: input.now });
        }
        return sessionChanged;
      });
      if (changed) {
        updatedSessionIds.push(session.id);
      }
    }

    return {
      updated_item_ids: updatedItemIds,
      updated_session_ids: updatedSessionIds,
      blocked_item_ids: blockedItemIds,
    };
  }

  async backfillBoundarySummaryRevisionEligibility(input: {
    session_id: string;
    boundary_summary_id: string;
    now: string;
  }): Promise<{ downgraded_revision_ids: string[]; approved_revision_ids: string[] }> {
    const session = await this.getBrainstormingSession(input.session_id);
    const summary = await this.getBoundarySummary(input.boundary_summary_id);
    const revisions = (
      await this.listWhere<BoundarySummaryRevision>(
        boundary_summary_revisions,
        eq(boundary_summary_revisions.boundarySummaryId, input.boundary_summary_id),
        boundary_summary_revisions.revisionNumber,
      )
    ).filter((revision) => this.boundarySummaryRevisionSessionId(revision) === input.session_id);
    const approvedCandidates = revisions.filter((revision) => this.boundarySummaryRevisionStatus(revision) === 'approved');
    const latestApprovedCandidateId = approvedCandidates.at(-1)?.id;
    const downgradedRevisionIds: string[] = [];
    const approvedRevisionIds: string[] = [];
    const eligibleApprovedRevisionIds: string[] = [];

    for (const revision of revisions) {
      const status = this.boundarySummaryRevisionStatus(revision);
      const hydrated = await this.hydrateBoundarySummaryRevisionForBackfill(revision, session, summary);
      let nextRevision: BoundarySummaryRevision;

      if (status !== 'approved') {
        nextRevision = hydrated;
      } else if (this.boundarySummaryRevisionHasApprovedEvidence(hydrated)) {
        nextRevision = { ...hydrated, status: 'approved' };
        eligibleApprovedRevisionIds.push(revision.id);
      } else {
        nextRevision = {
          ...hydrated,
          status: revision.id === latestApprovedCandidateId ? 'draft' : 'superseded',
        };
      }

      if (
        valuesEqual(
          this.boundarySummaryRevisionBackfillComparisonRecord(revision),
          this.boundarySummaryRevisionBackfillComparisonRecord(nextRevision),
        )
      ) {
        continue;
      }

      await this.upsert(boundary_summary_revisions, boundary_summary_revisions.id, this.boundarySummaryRevisionDbRecord(nextRevision));
      if (status === 'approved' && this.boundarySummaryRevisionStatus(nextRevision) === 'approved') {
        approvedRevisionIds.push(revision.id);
      } else if (status === 'approved') {
        downgradedRevisionIds.push(revision.id);
      }
    }

    const latestRevision = revisions.at(-1);
    const approvedRevisionId = eligibleApprovedRevisionIds.at(-1);
    if (session !== undefined && latestRevision !== undefined) {
      const nextSession = {
        ...session,
        latest_summary_revision_id: latestRevision.id,
      };
      if (approvedRevisionId === undefined) {
        delete (nextSession as Partial<BrainstormingSession>).approved_summary_revision_id;
      } else {
        nextSession.approved_summary_revision_id = approvedRevisionId;
      }
      if (!valuesEqual(session, nextSession)) {
        await this.upsert(brainstorming_sessions, brainstorming_sessions.id, { ...nextSession, updated_at: input.now });
      }
    }

    return {
      downgraded_revision_ids: downgradedRevisionIds,
      approved_revision_ids: approvedRevisionIds,
    };
  }

  private syntheticBoundaryRoundStatusFor(status: BrainstormingSession['status']): BoundaryRoundRecord['status'] {
    if (status === 'ai_turn_running') {
      return 'running';
    }
    if (status === 'summary_proposed') {
      return 'summary_proposed';
    }
    return 'waiting_for_leader';
  }

  private developmentPlanItemDbRecord(item: DevelopmentPlanItem): Record<string, unknown> {
    const record = { ...(item as unknown as Record<string, unknown>) };
    record.leader_delegate_actor_ids ??= [];
    return record;
  }

  private async brainstormingSessionDbRecord(session: BrainstormingSession): Promise<Record<string, unknown>> {
    const record = { ...(session as unknown as Record<string, unknown>) };
    const needsPlan = record.development_plan_revision_id === undefined;
    const needsItem = record.leader_delegate_actor_ids === undefined;
    const [plan, item] = await Promise.all([
      needsPlan ? this.getDevelopmentPlan(session.development_plan_id) : Promise.resolve(undefined),
      needsItem ? this.getDevelopmentPlanItem(session.development_plan_item_id) : Promise.resolve(undefined),
    ]);

    if (record.development_plan_revision_id === undefined && plan?.revision_id !== undefined) {
      record.development_plan_revision_id = plan.revision_id;
    }
    if (record.leader_delegate_actor_ids === undefined) {
      record.leader_delegate_actor_ids = item?.leader_delegate_actor_ids ?? [];
    }
    if (record.status === undefined) {
      record.status = this.boundarySessionStatusForApprovalState(session.approval_state);
    }

    return record;
  }

  private boundarySessionStatusForApprovalState(
    approvalState: BrainstormingSession['approval_state'],
  ): BrainstormingSession['status'] {
    if (approvalState === 'approved') {
      return 'approved';
    }
    if (approvalState === 'changes_requested') {
      return 'changes_requested';
    }
    if (approvalState === 'draft') {
      return 'draft';
    }
    return 'waiting_for_leader';
  }

  private async attachLegacyBoundaryEvidenceToRound(session: BrainstormingSession, roundId: string): Promise<void> {
    const [existingQuestions, existingAnswers, existingDecisions] = await Promise.all([
      this.listBoundaryQuestions(session.id),
      this.listBoundaryAnswers(session.id),
      this.listBoundaryDecisions(session.id),
    ]);
    const existingQuestionIds = new Set(existingQuestions.map((question) => question.id));
    const existingAnswerIds = new Set(existingAnswers.map((answer) => answer.id));
    const existingDecisionIds = new Set(existingDecisions.map((decision) => decision.id));

    await Promise.all(
      session.questions
        .filter((question) => !existingQuestionIds.has(question.id))
        .map((question, index) =>
          this.saveBoundaryQuestion({
            ...question,
            session_id: session.id,
            round_id: question.round_id ?? roundId,
            sequence: index + 1,
            required:
              question.required ??
              (question.status === 'open' &&
                question.answered_by_answer_id === undefined &&
                question.waived_by_decision_id === undefined),
          }),
        ),
    );
    await Promise.all(
      session.answers
        .filter((answer) => !existingAnswerIds.has(answer.id))
        .map((answer, index) =>
          this.saveBoundaryAnswer({
            ...answer,
            session_id: session.id,
            round_id: answer.round_id ?? roundId,
            sequence: index + 1,
          }),
        ),
    );
    await Promise.all(
      session.decisions
        .filter((decision) => !existingDecisionIds.has(decision.id))
        .map((decision, index) =>
          this.saveBoundaryDecision({
            ...decision,
            session_id: session.id,
            round_id: decision.round_id ?? roundId,
            sequence: index + 1,
          }),
        ),
    );
  }

  private boundarySummaryRevisionDbRecord(revision: BoundarySummaryRevision): Record<string, unknown> {
    const record = { ...(revision as unknown as Record<string, unknown>) };
    const decisionSnapshot = this.normalizedBoundaryDecisionSnapshot(record.decision_snapshot);
    record.status ??= this.boundarySummaryRevisionStatus(revision);
    record.confirmed_scope ??= [];
    record.confirmed_out_of_scope ??= [];
    record.accepted_assumptions ??= [];
    record.open_risks ??= [];
    record.validation_expectations ??= [];
    record.question_answer_snapshot ??= [];
    record.decision_snapshot = decisionSnapshot;
    record.decision_count ??= decisionSnapshot.length;
    if (record.session_id !== undefined && record.brainstorming_session_id === undefined) {
      record.brainstorming_session_id = record.session_id;
    }
    if (record.session_revision_id !== undefined && record.brainstorming_session_revision_id === undefined) {
      record.brainstorming_session_revision_id = record.session_revision_id;
    }
    delete record.session_id;
    delete record.session_revision_id;
    return record;
  }

  private boundarySummaryRevisionBackfillComparisonRecord(revision: BoundarySummaryRevision): Record<string, unknown> {
    const record = { ...(revision as unknown as Record<string, unknown>) };
    if (record.session_id !== undefined && record.brainstorming_session_id === undefined) {
      record.brainstorming_session_id = record.session_id;
    }
    if (record.session_revision_id !== undefined && record.brainstorming_session_revision_id === undefined) {
      record.brainstorming_session_revision_id = record.session_revision_id;
    }
    delete record.session_id;
    delete record.session_revision_id;
    return record;
  }

  private async hydrateBoundarySummaryRevisionForSave(
    revision: BoundarySummaryRevision,
  ): Promise<BoundarySummaryRevision> {
    const record = revision as unknown as Record<string, unknown>;
    const revisionSessionId = this.boundarySummaryRevisionSessionId(revision);
    const needsSummary = revisionSessionId === undefined || typeof record.development_plan_id !== 'string';
    const summary = needsSummary ? await this.getBoundarySummary(revision.boundary_summary_id) : undefined;
    const sessionId = revisionSessionId ?? summary?.brainstorming_session_id;
    const needsSession =
      typeof record.source_round_id !== 'string' ||
      typeof record.context_manifest_id !== 'string' ||
      typeof record.context_manifest_revision_id !== 'string' ||
      !Array.isArray(record.question_answer_snapshot);
    const session = needsSession && sessionId !== undefined ? await this.getBrainstormingSession(sessionId) : undefined;
    return this.hydrateBoundarySummaryRevisionForBackfill(revision, session, summary);
  }

  private boundarySummaryRevisionSessionId(revision: BoundarySummaryRevision): string | undefined {
    const record = revision as unknown as Record<string, unknown>;
    return typeof record.session_id === 'string'
      ? record.session_id
      : typeof record.brainstorming_session_id === 'string'
        ? record.brainstorming_session_id
        : undefined;
  }

  private boundarySummaryRevisionStatus(revision: BoundarySummaryRevision): string {
    if ('status' in revision && revision.status !== undefined) {
      return revision.status;
    }
    return revision.approved_by_actor_id !== undefined && revision.approved_at !== undefined ? 'approved' : 'draft';
  }

  private async hydrateBoundarySummaryRevisionForBackfill(
    revision: BoundarySummaryRevision,
    session: BrainstormingSession | undefined,
    summary: BoundarySummary | undefined,
  ): Promise<BoundarySummaryRevision> {
    const record = revision as unknown as Record<string, unknown>;
    const sessionId = this.boundarySummaryRevisionSessionId(revision) ?? session?.id;
    const sessionRevisionId =
      typeof record.session_revision_id === 'string'
        ? record.session_revision_id
        : typeof record.brainstorming_session_revision_id === 'string'
          ? record.brainstorming_session_revision_id
          : session?.revision_id;
    const sourceRoundId =
      typeof record.source_round_id === 'string'
        ? record.source_round_id
        : session?.current_round_id ?? (sessionId === undefined ? undefined : (await this.listBoundaryRounds(sessionId)).at(-1)?.id);
    const developmentPlanId =
      typeof record.development_plan_id === 'string' ? record.development_plan_id : summary?.development_plan_id ?? session?.development_plan_id;
    const questionAnswerSnapshot = Array.isArray(record.question_answer_snapshot)
      ? record.question_answer_snapshot
      : await this.boundaryQuestionAnswerSnapshotFor(sessionId);
    const existingDecisionSnapshot = this.normalizedBoundaryDecisionSnapshot(record.decision_snapshot);
    const decisionSnapshot =
      existingDecisionSnapshot.length > 0 ? existingDecisionSnapshot : await this.boundaryDecisionSnapshotFor(sessionId);

    return {
      ...revision,
      ...(sessionId === undefined ? {} : { session_id: sessionId }),
      ...(sessionRevisionId === undefined ? {} : { session_revision_id: sessionRevisionId }),
      ...(sourceRoundId === undefined ? {} : { source_round_id: sourceRoundId }),
      ...(developmentPlanId === undefined ? {} : { development_plan_id: developmentPlanId }),
      status: this.boundarySummaryRevisionStatus(revision),
      confirmed_scope: Array.isArray(record.confirmed_scope) ? record.confirmed_scope : [],
      confirmed_out_of_scope: Array.isArray(record.confirmed_out_of_scope) ? record.confirmed_out_of_scope : [],
      accepted_assumptions: Array.isArray(record.accepted_assumptions) ? record.accepted_assumptions : [],
      open_risks: Array.isArray(record.open_risks) ? record.open_risks : [],
      validation_expectations: Array.isArray(record.validation_expectations) ? record.validation_expectations : [],
      question_answer_snapshot: questionAnswerSnapshot,
      decision_snapshot: decisionSnapshot,
      ...(record.context_manifest_id === undefined && session?.context_manifest_id !== undefined
        ? { context_manifest_id: session.context_manifest_id }
        : {}),
      ...(record.context_manifest_revision_id === undefined && session?.context_manifest_revision_id !== undefined
        ? { context_manifest_revision_id: session.context_manifest_revision_id }
        : {}),
    } as BoundarySummaryRevision;
  }

  private async boundaryQuestionAnswerSnapshotFor(
    sessionId: string | undefined,
  ): Promise<{ question_id: string; answer_id: string; text: string }[]> {
    if (sessionId === undefined) {
      return [];
    }
    const [questions, answers] = await Promise.all([this.listBoundaryQuestions(sessionId), this.listBoundaryAnswers(sessionId)]);
    const answersById = new Map(answers.map((answer) => [answer.id, answer]));
    return questions.flatMap((question) => {
      const answer = answersById.get(question.answered_by_answer_id ?? '');
      return answer === undefined ? [] : [{ question_id: question.id, answer_id: answer.id, text: answer.text }];
    });
  }

  private async boundaryDecisionSnapshotFor(sessionId: string | undefined): Promise<{ decision_id: string; text: string; rationale?: string }[]> {
    if (sessionId === undefined) {
      return [];
    }
    const decisions = await this.listBoundaryDecisions(sessionId);
    return decisions.map((decision) => ({
      decision_id: decision.id,
      text: decision.text,
      ...(decision.rationale === undefined ? {} : { rationale: decision.rationale }),
    }));
  }

  private normalizedBoundaryDecisionSnapshot(snapshot: unknown): { decision_id: string; text: string; rationale?: string }[] {
    if (!Array.isArray(snapshot)) {
      return [];
    }
    return snapshot.flatMap((entry) => {
      if (entry === null || typeof entry !== 'object') {
        return [];
      }
      const record = entry as Record<string, unknown>;
      const decisionId =
        typeof record.decision_id === 'string' ? record.decision_id : typeof record.id === 'string' ? record.id : undefined;
      if (decisionId === undefined || typeof record.text !== 'string') {
        return [];
      }
      return [
        {
          decision_id: decisionId,
          text: record.text,
          ...(typeof record.rationale === 'string' ? { rationale: record.rationale } : {}),
        },
      ];
    });
  }

  private boundarySummaryRevisionHasApprovedEvidence(revision: BoundarySummaryRevision): boolean {
    const record = revision as unknown as Record<string, unknown>;
    return (
      typeof record.session_id === 'string' &&
      typeof record.session_revision_id === 'string' &&
      typeof record.source_round_id === 'string' &&
      typeof record.development_plan_id === 'string' &&
      typeof record.context_manifest_id === 'string' &&
      typeof record.context_manifest_revision_id === 'string' &&
      Array.isArray(record.question_answer_snapshot) &&
      record.question_answer_snapshot.length > 0 &&
      Array.isArray(record.decision_snapshot) &&
      record.decision_snapshot.length > 0 &&
      revision.approved_by_actor_id !== undefined &&
      revision.approved_at !== undefined
    );
  }

  async saveExecutionPlan(plan: ExecutionPlanDocument): Promise<void> {
    await this.upsert(execution_plans, execution_plans.id, plan);
  }

  async getExecutionPlan(id: string): Promise<ExecutionPlanDocument | undefined> {
    return this.getById(execution_plans, execution_plans.id, id);
  }

  async saveExecutionPlanRevision(revision: ExecutionPlanRevision): Promise<void> {
    await this.insertImmutable(execution_plan_revisions, revision);
  }

  async getExecutionPlanRevision(id: string): Promise<ExecutionPlanRevision | undefined> {
    return this.getById(execution_plan_revisions, execution_plan_revisions.id, id);
  }

  async listExecutionPlanRevisions(executionPlanId: string): Promise<ExecutionPlanRevision[]> {
    return this.listWhere<ExecutionPlanRevision>(
      execution_plan_revisions,
      eq(execution_plan_revisions.executionPlanId, executionPlanId),
      execution_plan_revisions.revisionNumber,
    );
  }

  async listExecutionPlansForDevelopmentPlanItem(itemId: string): Promise<ExecutionPlanDocument[]> {
    return this.listWhere<ExecutionPlanDocument>(
      execution_plans,
      eq(execution_plans.developmentPlanItemId, itemId),
      [execution_plans.createdAt, execution_plans.id],
    );
  }

  async saveExecution(execution: Execution): Promise<void> {
    const record = executionDbRecord(execution);
    await this.db.insert(executions).values(record as never).onConflictDoUpdate({
      target: executions.id,
      set: record as never,
    });
  }

  async getExecution(id: string): Promise<Execution | undefined> {
    const [record] = await this.db.select().from(executions).where(eq(executions.id, id)).limit(1);
    return record === undefined ? undefined : executionFromDbRecord(record);
  }

  async listExecutions(): Promise<Execution[]> {
    const records = await this.db.select().from(executions).orderBy(executions.createdAt, executions.id);
    return records.map((record) => executionFromDbRecord(record));
  }

  async backfillExecutionApprovedSpecLinkage(input: { now: string }): Promise<{ updated_execution_ids: string[] }> {
    const updatedExecutionIds: string[] = [];
    const executionRecords = await this.listExecutions();
    for (const execution of executionRecords) {
      const executionPlanRevision = await this.getExecutionPlanRevision(execution.implementation_plan_revision_id);
      if (executionPlanRevision === undefined) {
        throw new Error(`execution_approved_spec_linkage_backfill_failed: execution_plan_revision_missing:${execution.id}`);
      }
      const specRevision = await this.getSpecRevision(executionPlanRevision.based_on_spec_revision_id);
      if (specRevision === undefined) {
        throw new Error(`execution_approved_spec_linkage_backfill_failed: spec_revision_missing:${execution.id}`);
      }
      const spec = await this.getSpec(specRevision.spec_id);
      if (spec === undefined) {
        throw new Error(`execution_approved_spec_linkage_backfill_failed: spec_missing:${execution.id}`);
      }
      if (execution.approved_spec_revision_id !== undefined && execution.approved_spec_revision_id !== specRevision.id) {
        throw new Error(`execution_approved_spec_linkage_backfill_failed: spec_revision_mismatch:${execution.id}`);
      }
      const approvedSpecRevisionRef = {
        type: 'spec_revision' as const,
        id: specRevision.id,
        spec_id: spec.id,
        title: specRevision.summary,
      };
      if (
        execution.approved_spec_revision_id === specRevision.id &&
        JSON.stringify(execution.approved_spec_revision_ref) === JSON.stringify(approvedSpecRevisionRef)
      ) {
        continue;
      }
      await this.saveExecution({
        ...execution,
        approved_spec_revision_id: specRevision.id,
        approved_spec_revision_ref: approvedSpecRevisionRef,
        updated_at: input.now,
      });
      updatedExecutionIds.push(execution.id);
    }
    return { updated_execution_ids: updatedExecutionIds };
  }

  async saveCodeReviewHandoff(handoff: CodeReviewHandoff): Promise<void> {
    await this.upsert(code_review_handoffs, code_review_handoffs.id, handoff);
  }

  async getCodeReviewHandoff(id: string): Promise<CodeReviewHandoff | undefined> {
    return this.getById(code_review_handoffs, code_review_handoffs.id, id);
  }

  async listCodeReviewHandoffs(): Promise<CodeReviewHandoff[]> {
    return this.listWhere<CodeReviewHandoff>(code_review_handoffs, undefined, [
      code_review_handoffs.createdAt,
      code_review_handoffs.id,
    ]);
  }

  async saveQaHandoff(handoff: QaHandoff): Promise<void> {
    await this.upsert(qa_handoffs, qa_handoffs.id, handoff);
  }

  async getQaHandoff(id: string): Promise<QaHandoff | undefined> {
    return this.getById(qa_handoffs, qa_handoffs.id, id);
  }

  async listQaHandoffs(): Promise<QaHandoff[]> {
    return this.listWhere<QaHandoff>(qa_handoffs, undefined, [qa_handoffs.createdAt, qa_handoffs.id]);
  }

  async listQaHandoffsForCodeReview(handoffId: string): Promise<QaHandoff[]> {
    return this.listWhere<QaHandoff>(qa_handoffs, eq(qa_handoffs.codeReviewHandoffId, handoffId), qa_handoffs.createdAt);
  }

  async savePlan(plan: Plan): Promise<void> {
    await this.upsert(plans, plans.id, plan);
  }

  async getPlan(planId: string): Promise<Plan | undefined> {
    return this.getById(plans, plans.id, planId);
  }

  async listPlans(projectId?: string): Promise<Plan[]> {
    if (projectId === undefined) {
      return this.listWhere<Plan>(plans, undefined, plans.createdAt);
    }

    const rows = await this.db
      .select(getTableColumns(plans))
      .from(plans)
      .innerJoin(work_items, eq(plans.workItemId, work_items.id))
      .where(eq(work_items.projectId, projectId))
      .orderBy(asc(plans.createdAt));
    return rows.map((row) => fromDbRecord<Plan>(row));
  }

  async savePlanRevision(planRevision: PlanRevision): Promise<void> {
    await this.upsert(plan_revisions, plan_revisions.id, planRevision);
  }

  async getPlanRevision(planRevisionId: string): Promise<PlanRevision | undefined> {
    return this.getById(plan_revisions, plan_revisions.id, planRevisionId);
  }

  async listPlanRevisions(planId: string): Promise<PlanRevision[]> {
    return this.listWhere<PlanRevision>(plan_revisions, eq(plan_revisions.planId, planId), plan_revisions.revisionNumber);
  }

  async saveExecutionPackage(executionPackage: ExecutionPackage): Promise<void> {
    await this.upsert(execution_packages, execution_packages.id, {
      ...executionPackage,
      required_test_gates: executionPackage.required_test_gates ?? [],
      source_mutation_policy: executionPackage.source_mutation_policy ?? 'path_policy_scoped',
    });
  }

  async getExecutionPackage(executionPackageId: string): Promise<ExecutionPackage | undefined> {
    return this.getById(execution_packages, execution_packages.id, executionPackageId);
  }

  async listExecutionPackages(projectId?: string): Promise<ExecutionPackage[]> {
    return projectId === undefined
      ? this.listWhere<ExecutionPackage>(execution_packages, undefined, execution_packages.createdAt)
      : this.listWhere<ExecutionPackage>(
          execution_packages,
          eq(execution_packages.projectId, projectId),
          execution_packages.createdAt,
        );
  }

  async listExecutionPackagesForWorkItem(workItemId: string): Promise<ExecutionPackage[]> {
    return this.listWhere<ExecutionPackage>(execution_packages, eq(execution_packages.workItemId, workItemId));
  }

  async linkExecutionPackageToTask(input: { task_id: string; execution_package_id: string }): Promise<void> {
    const task = await this.getTask(input.task_id);
    if (task === undefined) {
      throw new DomainError('INVALID_TRANSITION', `Task ${input.task_id} was not found`);
    }
    const [row] = await this.db
      .update(execution_packages)
      .set({ taskId: input.task_id })
      .where(
        and(
          eq(execution_packages.id, input.execution_package_id),
          or(isNull(execution_packages.taskId), eq(execution_packages.taskId, input.task_id)),
        ),
      )
      .returning({ id: execution_packages.id });
    if (row === undefined) {
      const executionPackage = await this.getExecutionPackage(input.execution_package_id);
      if (executionPackage === undefined) {
        throw new DomainError('INVALID_TRANSITION', `Execution Package ${input.execution_package_id} was not found`);
      }
      throw new DomainError('INVALID_TRANSITION', `Execution Package ${input.execution_package_id} is already linked to another Task`);
    }
  }

  async getTaskForExecutionPackage(executionPackageId: string): Promise<Task | undefined> {
    const executionPackage = await this.getExecutionPackage(executionPackageId);
    return executionPackage?.task_id === undefined ? undefined : this.getTask(executionPackage.task_id);
  }

  async saveExecutionPackageDependency(dependency: ExecutionPackageDependency): Promise<void> {
    const record = toDbRecord(dependency, execution_package_dependencies);
    await this.db
      .insert(execution_package_dependencies)
      .values(record as never)
      .onConflictDoUpdate({
        target: [execution_package_dependencies.packageId, execution_package_dependencies.dependsOnPackageId],
        set: record as never,
      });
  }

  async listExecutionPackageDependencies(executionPackageId: string): Promise<ExecutionPackageDependency[]> {
    return this.listWhere<ExecutionPackageDependency>(
      execution_package_dependencies,
      eq(execution_package_dependencies.packageId, executionPackageId),
    );
  }

  async saveAttachment(attachment: Attachment): Promise<void> {
    await this.upsert(attachments, attachments.id, attachment);
  }

  async getAttachment(attachmentId: string): Promise<Attachment | undefined> {
    return this.getById(attachments, attachments.id, attachmentId);
  }

  async listAttachmentsForObject(objectType: string, objectId: string): Promise<Attachment[]> {
    const linkedRef = JSON.stringify([{ type: objectType, id: objectId }]);
    const rows = await this.db
      .select()
      .from(attachments)
      .where(
        or(
          and(eq(attachments.ownerObjectType, objectType), eq(attachments.ownerObjectId, objectId)),
          sql`${attachments.linkedObjectRefs} @> ${linkedRef}::jsonb`,
        ),
      )
      .orderBy(asc(attachments.createdAt));
    return rows.map((row) => fromDbRecord<Attachment>(row));
  }

  async linkAttachmentToObject(attachmentId: string, objectRef: ObjectRef): Promise<Attachment> {
    const attachment = await this.getAttachment(attachmentId);
    if (attachment === undefined) {
      throw new DomainError('INVALID_TRANSITION', `Attachment ${attachmentId} was not found`);
    }
    const linked_object_refs = attachment.linked_object_refs.some((ref) => objectRefIdentityMatches(ref, objectRef))
      ? attachment.linked_object_refs
      : [...attachment.linked_object_refs, objectRef];
    const updated = { ...attachment, linked_object_refs };
    await this.saveAttachment(updated);
    return updated;
  }

  async archiveAttachment(attachmentId: string, _archivedAt: string): Promise<Attachment> {
    const [row] = await this.db
      .update(attachments)
      .set({ referenceStatus: 'archived' })
      .where(eq(attachments.id, attachmentId))
      .returning();
    if (row === undefined) {
      throw new DomainError('INVALID_TRANSITION', `Attachment ${attachmentId} was not found`);
    }
    return fromDbRecord<Attachment>(row);
  }

  async saveRunSession(runSession: RunSession): Promise<void> {
    if (isActiveRunSessionStatus(runSession.status) && this.supportsSelect()) {
      const existingActive = await this.findActiveRunSessionForPackage(runSession.execution_package_id);
      if (existingActive !== undefined && existingActive.id !== runSession.id) {
        throw new DomainError(
          'INVALID_TRANSITION',
          `Package ${runSession.execution_package_id} already has active run ${existingActive.id}`,
        );
      }
    }
    await this.upsert(run_sessions, run_sessions.id, runSession);
  }

  async getRunSession(runSessionId: string): Promise<RunSession | undefined> {
    return this.getById(run_sessions, run_sessions.id, runSessionId);
  }

  async listRunSessions(projectId?: string): Promise<RunSession[]> {
    if (projectId === undefined) {
      return this.listWhere<RunSession>(run_sessions, undefined, run_sessions.createdAt);
    }

    const rows = await this.db
      .select(getTableColumns(run_sessions))
      .from(run_sessions)
      .innerJoin(execution_packages, eq(run_sessions.executionPackageId, execution_packages.id))
      .where(eq(execution_packages.projectId, projectId))
      .orderBy(asc(run_sessions.createdAt));
    return rows.map((row) => fromDbRecord<RunSession>(row));
  }

  async listRunSessionsForPackage(executionPackageId: string): Promise<RunSession[]> {
    return this.listWhere<RunSession>(
      run_sessions,
      eq(run_sessions.executionPackageId, executionPackageId),
      run_sessions.createdAt,
    );
  }

  async findActiveRunSessionForPackage(executionPackageId: string): Promise<RunSession | undefined> {
    const [row] = await this.db
      .select()
      .from(run_sessions)
      .where(
        and(
          eq(run_sessions.executionPackageId, executionPackageId),
          inArray(run_sessions.status, recoverableRunSessionStatuses),
        ),
      )
      .orderBy(asc(run_sessions.createdAt))
      .limit(1);

    return row === undefined ? undefined : fromDbRecord<RunSession>(row);
  }

  async listRecoverableRunSessions(): Promise<RunSession[]> {
    return this.listWhere<RunSession>(
      run_sessions,
      inArray(run_sessions.status, recoverableRunSessionStatuses),
      run_sessions.createdAt,
    );
  }

  async appendRunEvent(event: Omit<RunEvent, 'sequence' | 'cursor'>): Promise<RunEvent> {
    return this.db.transaction((tx) => this.appendRunEventInTransaction(tx as ForgeloopDrizzleDatabase, event));
  }

  async listRunEvents(runSessionId: string, options: { after?: string; limit?: number } = {}): Promise<RunEvent[]> {
    const conditions = [
      eq(run_events.runSessionId, runSessionId),
      options.after === undefined ? undefined : gt(run_events.cursor, options.after),
    ].filter((condition) => condition !== undefined);
    const query = this.db
      .select()
      .from(run_events)
      .where(and(...conditions))
      .orderBy(asc(run_events.sequence));
    const rows = options.limit === undefined ? await query : await query.limit(options.limit);

    return rows.map((row) => fromDbRecord<RunEvent>(row));
  }

  async getLatestRunEvent(runSessionId: string): Promise<RunEvent | undefined> {
    const [row] = await this.db
      .select()
      .from(run_events)
      .where(eq(run_events.runSessionId, runSessionId))
      .orderBy(desc(run_events.sequence))
      .limit(1);

    return row === undefined ? undefined : fromDbRecord<RunEvent>(row);
  }

  async appendWorkerRunEvent(
    event: Omit<RunEvent, 'sequence' | 'cursor'>,
    lease: { workerId: string; leaseToken: string },
  ): Promise<RunEvent> {
    return this.db.transaction(async (tx) => {
      const db = tx as ForgeloopDrizzleDatabase;
      await this.lockActiveRunWorkerLease(db, event.run_session_id, lease.workerId, lease.leaseToken, event.created_at);
      return this.appendRunEventInTransaction(db, event);
    });
  }

  async saveRunCommand(command: RunCommand): Promise<void> {
    await this.upsert(run_commands, run_commands.id, command);
  }

  async claimNextRunCommand(
    runSessionId: string,
    workerId: string,
    leaseToken: string,
    now: string,
    options: { reclaim_claimed_before?: string } = {},
  ): Promise<{ command: RunCommand; reclaimed: boolean } | undefined> {
    return this.db.transaction(async (tx) => {
      await this.lockActiveRunWorkerLease(tx as ForgeloopDrizzleDatabase, runSessionId, workerId, leaseToken, now);

      const pendingResult = await tx.execute(sql<Record<string, unknown>>`
        with candidate as (
          select id
          from run_commands
          where run_session_id = ${runSessionId}
            and status = 'pending'
          order by case when command_type = 'cancel' then 0 else 1 end, created_at asc
          for update skip locked
          limit 1
        )
        update run_commands
        set status = 'claimed',
            claimed_by_worker_id = ${workerId},
            claimed_at = ${now},
            updated_at = ${now}
        from candidate
        where run_commands.id = candidate.id
        returning run_commands.*, false as reclaimed
      `);
      const pending = this.commandClaimFromRows(pendingResult.rows);
      if (pending !== undefined) {
        return pending;
      }

      if (options.reclaim_claimed_before === undefined) {
        return undefined;
      }

      const staleResult = await tx.execute(sql<Record<string, unknown>>`
        with candidate as (
          select id
          from run_commands
          where run_session_id = ${runSessionId}
            and status = 'claimed'
            and claimed_at <= ${options.reclaim_claimed_before}
          order by claimed_at asc
          for update skip locked
          limit 1
        )
        update run_commands
        set claimed_by_worker_id = ${workerId},
            claimed_at = ${now},
            updated_at = ${now}
        from candidate
        where run_commands.id = candidate.id
        returning run_commands.*, true as reclaimed
      `);

      return this.commandClaimFromRows(staleResult.rows);
    });
  }

  async recordRunCommandDriverAck(
    commandId: string,
    lease: { workerId: string; leaseToken: string },
    driverAck: Record<string, unknown>,
    acknowledgedAt: string,
  ): Promise<void> {
    await this.updateFencedRunCommand(commandId, lease, acknowledgedAt, sql`
      driver_ack = ${JSON.stringify(driverAck)}::jsonb,
      updated_at = ${acknowledgedAt}
    `);
  }

  async markRunCommandApplied(
    commandId: string,
    lease: { workerId: string; leaseToken: string },
    appliedAt: string,
    driverAck: Record<string, unknown>,
  ): Promise<void> {
    await this.updateFencedRunCommand(commandId, lease, appliedAt, sql`
      status = 'applied',
      applied_at = ${appliedAt},
      driver_ack = ${JSON.stringify(driverAck)}::jsonb,
      updated_at = ${appliedAt}
    `);
  }

  async markRunCommandFailed(
    commandId: string,
    lease: { workerId: string; leaseToken: string },
    failureReason: string,
    failedAt: string,
  ): Promise<void> {
    await this.updateFencedRunCommand(commandId, lease, failedAt, sql`
      status = 'failed',
      failure_reason = ${failureReason},
      updated_at = ${failedAt}
    `);
  }

  async supersedePendingRunCommands(
    runSessionId: string,
    commandTypes: RunCommand['command_type'][],
    now: string,
  ): Promise<void> {
    if (commandTypes.length === 0) {
      return;
    }

    await this.db
      .update(run_commands)
      .set({ status: 'superseded', updatedAt: now })
      .where(
        and(
          eq(run_commands.runSessionId, runSessionId),
          eq(run_commands.status, 'pending'),
          inArray(run_commands.commandType, commandTypes),
        ),
      );
  }

  async supersedePendingRunCommandsForWorker(
    runSessionId: string,
    commandTypes: RunCommand['command_type'][],
    lease: { workerId: string; leaseToken: string },
    now: string,
  ): Promise<void> {
    if (commandTypes.length === 0) {
      return;
    }

    await this.db.transaction(async (tx) => {
      await this.lockActiveRunWorkerLease(tx as ForgeloopDrizzleDatabase, runSessionId, lease.workerId, lease.leaseToken, now);
      await tx
        .update(run_commands)
        .set({ status: 'superseded', updatedAt: now })
        .where(
          and(
            eq(run_commands.runSessionId, runSessionId),
            eq(run_commands.status, 'pending'),
            inArray(run_commands.commandType, commandTypes),
          ),
        );
    });
  }

  async claimRunWorkerLease(input: {
    run_session_id: string;
    worker_id: string;
    lease_token: string;
    now: string;
    expires_at: string;
  }): Promise<RunWorkerLease> {
    return this.db.transaction(async (tx) => {
      const leaseId = `${input.run_session_id}:${input.worker_id}:${input.lease_token}`;
      const result = await tx.execute(sql<Record<string, unknown>>`
        insert into run_worker_leases (
          id,
          run_session_id,
          worker_id,
          lease_token,
          heartbeat_at,
          expires_at,
          status
        )
        values (
          ${leaseId},
          ${input.run_session_id},
          ${input.worker_id},
          ${input.lease_token},
          ${input.now},
          ${input.expires_at},
          'active'
        )
        on conflict (run_session_id)
        do update set
          id = excluded.id,
          worker_id = excluded.worker_id,
          lease_token = excluded.lease_token,
          heartbeat_at = excluded.heartbeat_at,
          expires_at = excluded.expires_at,
          status = 'active'
        where run_worker_leases.status <> 'active'
          or run_worker_leases.expires_at <= excluded.heartbeat_at
          or run_worker_leases.worker_id = excluded.worker_id
        returning *
      `);

      const row = result.rows[0];
      if (row === undefined) {
        throw invalidLease(input.run_session_id);
      }

      return fromDbRecord<RunWorkerLease>(row);
    });
  }

  async heartbeatRunWorkerLease(
    runSessionId: string,
    workerId: string,
    leaseToken: string,
    heartbeatAt: string,
    expiresAt: string,
  ): Promise<void> {
    const rows = await this.fencedLeaseUpdate(runSessionId, workerId, leaseToken, heartbeatAt, sql`
      heartbeat_at = ${heartbeatAt},
      expires_at = ${expiresAt}
    `);
    if (rows.length === 0) {
      throw invalidLease(runSessionId);
    }
  }

  async getRunWorkerLease(runSessionId: string): Promise<RunWorkerLease | undefined> {
    const [row] = await this.db
      .select()
      .from(run_worker_leases)
      .where(eq(run_worker_leases.runSessionId, runSessionId))
      .limit(1);

    return row === undefined ? undefined : fromDbRecord<RunWorkerLease>(row);
  }

  async releaseRunWorkerLease(runSessionId: string, workerId: string, leaseToken: string, releasedAt: string): Promise<void> {
    const rows = await this.fencedLeaseUpdate(runSessionId, workerId, leaseToken, releasedAt, sql`
      heartbeat_at = ${releasedAt},
      status = 'released'
    `);
    if (rows.length === 0) {
      throw invalidLease(runSessionId);
    }
  }

  async assertActiveRunWorkerLease(
    runSessionId: string,
    workerId: string,
    leaseToken: string,
    now: string,
  ): Promise<void> {
    const [row] = await this.db
      .select()
      .from(run_worker_leases)
      .where(
        and(
          eq(run_worker_leases.runSessionId, runSessionId),
          eq(run_worker_leases.workerId, workerId),
          eq(run_worker_leases.leaseToken, leaseToken),
          eq(run_worker_leases.status, 'active'),
          gt(run_worker_leases.expiresAt, now),
        ),
      )
      .limit(1);

    if (row === undefined) {
      throw invalidLease(runSessionId);
    }
  }

  async withActiveRunWorkerLease<T>(
    runSessionId: string,
    lease: { workerId: string; leaseToken: string; now: string },
    write: (repository: DeliveryRepository) => Promise<T>,
  ): Promise<T> {
    return this.db.transaction(async (tx) => {
      await this.lockActiveRunWorkerLease(tx as ForgeloopDrizzleDatabase, runSessionId, lease.workerId, lease.leaseToken, lease.now);
      const repository = new DrizzleDeliveryRepository(tx as ForgeloopDrizzleDatabase);
      const result = await write(repository);
      await repository.assertActiveRunWorkerLease(runSessionId, lease.workerId, lease.leaseToken, lease.now);
      return result;
    });
  }

  async saveReviewPacket(reviewPacket: ReviewPacket): Promise<void> {
    if (reviewPacket.status !== 'completed' && reviewPacket.status !== 'archived' && this.supportsSelect()) {
      const existingOpen = await this.findOpenReviewPacketForPackage(reviewPacket.execution_package_id);
      if (existingOpen !== undefined && existingOpen.id !== reviewPacket.id) {
        throw new DomainError(
          'INVALID_TRANSITION',
          `Package ${reviewPacket.execution_package_id} already has open review packet ${existingOpen.id}`,
        );
      }
    }
    await this.upsert(review_packets, review_packets.id, reviewPacket);
  }

  async getReviewPacket(reviewPacketId: string): Promise<ReviewPacket | undefined> {
    return this.getById(review_packets, review_packets.id, reviewPacketId);
  }

  async listReviewPackets(projectId?: string): Promise<ReviewPacket[]> {
    if (projectId === undefined) {
      return this.listWhere<ReviewPacket>(review_packets, undefined, review_packets.createdAt);
    }

    const rows = await this.db
      .select(getTableColumns(review_packets))
      .from(review_packets)
      .innerJoin(execution_packages, eq(review_packets.executionPackageId, execution_packages.id))
      .where(eq(execution_packages.projectId, projectId))
      .orderBy(asc(review_packets.createdAt));
    return rows.map((row) => fromDbRecord<ReviewPacket>(row));
  }

  async listReviewPacketsForPackage(executionPackageId: string): Promise<ReviewPacket[]> {
    return this.listWhere<ReviewPacket>(
      review_packets,
      eq(review_packets.executionPackageId, executionPackageId),
      review_packets.createdAt,
    );
  }

  async findOpenReviewPacketForPackage(executionPackageId: string): Promise<ReviewPacket | undefined> {
    const [row] = await this.db
      .select()
      .from(review_packets)
      .where(
        and(
          eq(review_packets.executionPackageId, executionPackageId),
          notInArray(review_packets.status, ['completed', 'archived']),
        ),
      )
      .orderBy(asc(review_packets.createdAt))
      .limit(1);

    return row === undefined ? undefined : fromDbRecord<ReviewPacket>(row);
  }

  async resolveAutomationProjectSettings(
    input: ResolveAutomationProjectSettingsInput,
  ): Promise<AutomationProjectSettings> {
    const conditions = [
      eq(automation_project_settings.projectId, input.project_id),
      input.repo_id === undefined
        ? sql`${automation_project_settings.repoId} is null`
        : eq(automation_project_settings.repoId, input.repo_id),
    ];
    const [row] = await this.db.select().from(automation_project_settings).where(and(...conditions)).limit(1);
    if (row !== undefined) {
      const settings = fromDbRecord<AutomationProjectSettings>(row);
      return {
        ...settings,
        capabilities_json: normalizeAutomationCapabilities(settings.capabilities_json),
      };
    }

    const capabilities = automationCapabilitiesForPreset('off');
    return {
      id: `default:${this.automationSettingsKey(input.project_id, input.repo_id)}`,
      project_id: input.project_id,
      ...(input.repo_id === undefined ? {} : { repo_id: input.repo_id }),
      preset: 'off',
      capabilities_json: capabilities,
      capability_fingerprint: capabilityFingerprint(capabilities),
      scope_type: input.repo_id === undefined ? 'project' : 'repo',
      version: 0,
      evidence_refs: [],
    };
  }

  async setAutomationProjectSettings(input: SetAutomationProjectSettingsInput): Promise<AutomationProjectSettings> {
    return this.withAdvisoryLocks(
      [`automation-settings:${this.automationSettingsKey(input.project_id, input.repo_id)}`],
      (repository) => (repository as DrizzleDeliveryRepository).setAutomationProjectSettingsUnlocked(input),
    );
  }

  async disableAutomationProjectSettings(input: DisableAutomationProjectSettingsInput): Promise<AutomationProjectSettings> {
    return this.setAutomationProjectSettings({
      id: input.id ?? `automation-settings-disabled:${this.automationSettingsKey(input.project_id, input.repo_id)}`,
      project_id: input.project_id,
      ...(input.repo_id === undefined ? {} : { repo_id: input.repo_id }),
      scope_type: input.repo_id === undefined ? 'project' : 'repo',
      preset: 'off',
      expected_version: input.expected_version,
      reason: input.reason,
      evidence_refs: input.evidence_refs,
      actor: input.actor,
      now: input.now,
    });
  }

  async listActiveManualPathHolds(input: ListActiveManualPathHoldsInput): Promise<ManualPathHold[]> {
    const keys = await this.manualHoldScopeKeysFor(input);
    if (keys.length === 0) {
      return [];
    }
    return this.listWhere<ManualPathHold>(
      manual_path_holds,
      and(eq(manual_path_holds.status, 'active'), inArray(manual_path_holds.scopeKey, keys)),
      [manual_path_holds.requestedAt, manual_path_holds.id],
    );
  }

  async getManualPathHold(holdId: string): Promise<ManualPathHold | undefined> {
    return this.getById<ManualPathHold>(manual_path_holds, manual_path_holds.id, holdId);
  }

  async requestManualPathHold(input: RequestManualPathHoldInput): Promise<ManualPathHold> {
    return this.withAdvisoryLocks(this.manualPathHoldLockKeys(input), (repository) =>
      (repository as DrizzleDeliveryRepository).requestManualPathHoldUnlocked(input),
    );
  }

  async resolveManualPathHold(input: ResolveManualPathHoldInput): Promise<ManualPathHold> {
    const hold = await this.getById<ManualPathHold>(manual_path_holds, manual_path_holds.id, input.hold_id);
    if (hold === undefined) {
      throw new DomainError('INVALID_TRANSITION', `Manual hold ${input.hold_id} does not exist`);
    }
    if (hold.status !== 'active') {
      if (hold.status === 'resolved' && hold.resolved_by === input.resolved_by && hold.resolution === input.resolution) {
        return hold;
      }
      throw new DomainError('INVALID_TRANSITION', `Manual hold ${input.hold_id} is not active`);
    }
    const resolved: ManualPathHold = {
      ...hold,
      status: 'resolved',
      resolved_by: input.resolved_by,
      resolved_at: input.resolved_at,
      resolution: input.resolution,
    };
    await this.upsert(manual_path_holds, manual_path_holds.id, resolved);
    return resolved;
  }

  async claimCommandIdempotency(input: ClaimCommandIdempotencyInput): Promise<CommandIdempotencyRecord> {
    return this.withAdvisoryLocks([`command-idempotency:${input.idempotency_key}`], (repository) =>
      (repository as DrizzleDeliveryRepository).claimCommandIdempotencyUnlocked(input),
    );
  }

  async renewCommandIdempotency(input: RenewCommandIdempotencyInput): Promise<CommandIdempotencyRecord> {
    return this.withAdvisoryLocks([`command-idempotency:${input.idempotency_key}`], (repository) =>
      (repository as DrizzleDeliveryRepository).renewCommandIdempotencyUnlocked(input),
    );
  }

  private async renewCommandIdempotencyUnlocked(input: RenewCommandIdempotencyInput): Promise<CommandIdempotencyRecord> {
    const record = await this.claimedCommandIdempotency(input.idempotency_key, input.claim_token);
    const renewed = {
      ...record,
      locked_until: input.locked_until,
      last_heartbeat_at: input.last_heartbeat_at,
      updated_at: input.last_heartbeat_at,
    };
    await this.upsert(command_idempotency_records, command_idempotency_records.id, renewed);
    return renewed;
  }

  async completeCommandIdempotency(input: FinishCommandIdempotencyInput): Promise<CommandIdempotencyRecord> {
    return this.withAdvisoryLocks([`command-idempotency:${input.idempotency_key}`], (repository) =>
      (repository as DrizzleDeliveryRepository).finishCommandIdempotency(input, 'succeeded'),
    );
  }

  async failCommandIdempotency(input: FinishCommandIdempotencyInput): Promise<CommandIdempotencyRecord> {
    return this.withAdvisoryLocks([`command-idempotency:${input.idempotency_key}`], (repository) =>
      (repository as DrizzleDeliveryRepository).finishCommandIdempotency(input, 'failed'),
    );
  }

  async blockCommandIdempotency(input: FinishCommandIdempotencyInput): Promise<CommandIdempotencyRecord> {
    return this.withAdvisoryLocks([`command-idempotency:${input.idempotency_key}`], (repository) =>
      (repository as DrizzleDeliveryRepository).finishCommandIdempotency(input, 'blocked'),
    );
  }

  async claimExecutionPackageGenerationRun(
    input: ClaimExecutionPackageGenerationRunInput,
  ): Promise<ExecutionPackageGenerationRun> {
    return this.withAdvisoryLocks([`package-generation:${input.plan_revision_id}`], (repository) =>
      (repository as DrizzleDeliveryRepository).claimExecutionPackageGenerationRunUnlocked(input),
    );
  }

  async saveExecutionPackageGenerationPackage(input: SaveExecutionPackageGenerationPackageInput): Promise<void> {
    return this.withAdvisoryLocks([`package-generation:${input.plan_revision_id}`], (repository) =>
      (repository as DrizzleDeliveryRepository).saveExecutionPackageGenerationPackageUnlocked(input),
    );
  }

  private async saveExecutionPackageGenerationPackageUnlocked(
    input: SaveExecutionPackageGenerationPackageInput,
  ): Promise<void> {
    const run = await this.claimedGenerationRun(input.execution_package_set_id, input.claim_token);
    if (run.plan_revision_id !== input.plan_revision_id || run.generation_key !== input.generation_key) {
      throw new DomainError('INVALID_TRANSITION', `Package generation ${input.execution_package_set_id} identity mismatch`);
    }
    const [duplicate] = await this.db
      .select()
      .from(execution_package_generation_packages)
      .where(
        and(
          eq(execution_package_generation_packages.planRevisionId, input.plan_revision_id),
          eq(execution_package_generation_packages.generationKey, input.generation_key),
          eq(execution_package_generation_packages.packageKey, input.package_key),
        ),
      )
      .limit(1);
    if (duplicate !== undefined && duplicate.executionPackageId !== input.execution_package_id) {
      throw new DomainError('INVALID_TRANSITION', `Duplicate package_key ${input.package_key} for generation`);
    }
    const [existing] = await this.db
      .select()
      .from(execution_package_generation_packages)
      .where(
        and(
          eq(execution_package_generation_packages.executionPackageSetId, input.execution_package_set_id),
          eq(execution_package_generation_packages.executionPackageId, input.execution_package_id),
        ),
      )
      .limit(1);
    const existingRecord =
      existing === undefined ? undefined : fromDbRecord<ExecutionPackageGenerationPackageRecord>(existing);
    if (
      existingRecord !== undefined &&
      (existingRecord.plan_revision_id !== input.plan_revision_id ||
        existingRecord.generation_key !== input.generation_key ||
        existingRecord.package_key !== input.package_key ||
        existingRecord.sequence !== input.sequence ||
        existingRecord.manifest_digest !== input.manifest_digest)
    ) {
      throw new DomainError('INVALID_TRANSITION', `Package generation package ${input.execution_package_id} drift`);
    }
    const { claim_token: _claimToken, ...record } = input;
    await this.db
      .insert(execution_package_generation_packages)
      .values(toDbRecord(record, execution_package_generation_packages) as never)
      .onConflictDoNothing();
  }

  async completeExecutionPackageGenerationRun(
    input: CompleteExecutionPackageGenerationRunInput,
  ): Promise<ExecutionPackageGenerationRun> {
    return this.withAdvisoryLocks([`package-generation:${input.plan_revision_id}`], (repository) =>
      (repository as DrizzleDeliveryRepository).completeExecutionPackageGenerationRunUnlocked(input),
    );
  }

  async supersedeExecutionPackageGenerationRun(
    input: SupersedeExecutionPackageGenerationRunInput,
  ): Promise<ExecutionPackageGenerationRun> {
    return this.withAdvisoryLocks([`package-generation:${input.plan_revision_id}`], (repository) =>
      (repository as DrizzleDeliveryRepository).supersedeExecutionPackageGenerationRunUnlocked(input),
    );
  }

  async getExecutionPackageGenerationRun(input: {
    plan_revision_id: string;
    generation_key: string;
  }): Promise<ExecutionPackageGenerationRun | undefined> {
    return this.generationRunFor(input.plan_revision_id, input.generation_key);
  }

  private async supersedeExecutionPackageGenerationRunUnlocked(
    input: SupersedeExecutionPackageGenerationRunInput,
  ): Promise<ExecutionPackageGenerationRun> {
    const run = await this.getById<ExecutionPackageGenerationRun>(
      execution_package_generation_runs,
      execution_package_generation_runs.executionPackageSetId,
      input.execution_package_set_id,
    );
    if (run === undefined || run.plan_revision_id !== input.plan_revision_id) {
      throw new DomainError('INVALID_TRANSITION', `Package generation ${input.execution_package_set_id} does not exist`);
    }
    if (run.version !== input.expected_version) {
      throw new DomainError('INVALID_TRANSITION', `Package generation ${input.execution_package_set_id} version mismatch`);
    }
    if (run.status !== 'succeeded') {
      throw new DomainError('INVALID_TRANSITION', `Package generation ${input.execution_package_set_id} is not current succeeded`);
    }
    const existingRuns = await this.listWhere<ExecutionPackageGenerationRun>(
      execution_package_generation_runs,
      eq(execution_package_generation_runs.planRevisionId, input.plan_revision_id),
    );
    const superseded: ExecutionPackageGenerationRun = {
      ...run,
      status: 'superseded',
      version: run.version + 1,
      superseded_by: input.superseded_by,
      superseded_at: input.superseded_at,
      superseded_reason: input.reason,
      supersede_command_id: input.supersede_command_id,
      evidence_refs: input.evidence_refs,
      next_generation_key: `regenerate:${input.plan_revision_id}:${existingRuns.length + 1}`,
      updated_at: input.superseded_at,
    };
    await this.upsert(execution_package_generation_runs, execution_package_generation_runs.executionPackageSetId, superseded);
    return superseded;
  }

  async createOrReplayAutomationActionRun(input: CreateOrReplayAutomationActionRunInput): Promise<AutomationActionRun> {
    return this.withAdvisoryLocks([`automation-action:${input.idempotency_key}`, `automation-action-id:${input.id}`], (repository) =>
      (repository as DrizzleDeliveryRepository).createOrReplayAutomationActionRunUnlocked(input),
    );
  }

  async claimNextAutomationActionRun(
    input: ClaimNextAutomationActionRunInput,
  ): Promise<AutomationActionRun | undefined> {
    return this.withAdvisoryLocks(['automation-action:claim-next'], (repository) =>
      (repository as DrizzleDeliveryRepository).claimNextAutomationActionRunUnlocked(input),
    );
  }

  async getClaimedAutomationActionRun(input: GetClaimedAutomationActionRunInput): Promise<AutomationActionRun> {
    return this.claimedAutomationActionRun(input.id, input.claim_token);
  }

  async getAutomationActionRun(id: string): Promise<AutomationActionRun | undefined> {
    return this.getById<AutomationActionRun>(automation_action_runs, automation_action_runs.id, id);
  }

  async getAutomationActionRunByIdempotencyKey(input: GetAutomationActionRunByIdempotencyKeyInput): Promise<AutomationActionRun | undefined> {
    const [row] = await this.db
      .select()
      .from(automation_action_runs)
      .where(
        and(
          eq(automation_action_runs.idempotencyKey, input.idempotency_key),
          eq(automation_action_runs.actionType, input.action_type),
          eq(automation_action_runs.targetObjectType, input.target_object_type),
          eq(automation_action_runs.targetObjectId, input.target_object_id),
          input.target_revision_id === undefined
            ? isNull(automation_action_runs.targetRevisionId)
            : eq(automation_action_runs.targetRevisionId, input.target_revision_id),
        ),
      )
      .limit(1);
    return row === undefined ? undefined : fromDbRecord<AutomationActionRun>(row);
  }

  async latestCompletedProjectionActionRun(
    input: LatestCompletedProjectionActionRunInput,
  ): Promise<AutomationActionRun | undefined> {
    this.assertProjectionAutomationScope(input.automation_scope, input.repo_id);
    const jsonTextEquals = (key: string, value: string) => sql`${automation_action_runs.actionInputJson}->>${key} = ${value}`;
    const optionalJsonTextEquals = (key: string, value: string | undefined) =>
      value === undefined
        ? sql`coalesce(${automation_action_runs.actionInputJson}->>${key}, '') = ''`
        : jsonTextEquals(key, value);
    const [row] = await this.db
      .select()
      .from(automation_action_runs)
      .where(
        and(
          eq(automation_action_runs.actionType, 'project_runtime_snapshot'),
          eq(automation_action_runs.status, 'succeeded'),
          eq(automation_action_runs.automationScope, input.automation_scope),
          jsonTextEquals('repo_id', input.repo_id),
          jsonTextEquals('policy_status', input.policy_status),
          optionalJsonTextEquals('policy_digest', input.policy_digest),
          jsonTextEquals('parser_version', input.parser_version),
          optionalJsonTextEquals('reason_code', input.reason_code),
        ),
      )
      .orderBy(desc(automation_action_runs.finishedAt), desc(automation_action_runs.updatedAt), desc(automation_action_runs.id))
      .limit(1);
    return row === undefined ? undefined : fromDbRecord<AutomationActionRun>(row);
  }

  async claimAutomationActionRun(input: ClaimAutomationActionRunInput): Promise<AutomationActionRun> {
    return this.withAdvisoryLocks(
      ['automation-action:claim-next', `automation-action:${input.idempotency_key}`, `automation-action-id:${input.id}`],
      (repository) => (repository as DrizzleDeliveryRepository).claimAutomationActionRunUnlocked(input),
    );
  }

  async markAutomationActionGatePending(input: MarkAutomationActionGatePendingInput): Promise<AutomationActionRun> {
    return this.withAdvisoryLocks(['automation-action:claim-next', `automation-action:${input.idempotency_key}`], (repository) =>
      (repository as DrizzleDeliveryRepository).markAutomationActionGatePendingUnlocked(input),
    );
  }

  private async markAutomationActionGatePendingUnlocked(
    input: MarkAutomationActionGatePendingInput,
  ): Promise<AutomationActionRun> {
    const actionRun = await this.claimedAutomationActionRun(input.id, input.claim_token);
    if (actionRun.idempotency_key !== input.idempotency_key) {
      throw new DomainError('INVALID_TRANSITION', `Automation action ${input.id} idempotency key mismatch`);
    }
    const pending: AutomationActionRun = {
      ...actionRun,
      status: 'gate_pending',
      reason: input.reason,
      ...(input.result_json === undefined ? {} : { result_json: input.result_json }),
      ...(input.next_attempt_at === undefined ? {} : { next_attempt_at: input.next_attempt_at }),
      updated_at: input.now,
    };
    await this.upsert(automation_action_runs, automation_action_runs.id, pending);
    return pending;
  }

  async completeAutomationActionRun(input: CompleteAutomationActionRunInput): Promise<AutomationActionRun> {
    return this.withAdvisoryLocks(['automation-action:claim-next', `automation-action:${input.idempotency_key}`], (repository) =>
      (repository as DrizzleDeliveryRepository).completeAutomationActionRunUnlocked(input),
    );
  }

  private async completeAutomationActionRunUnlocked(input: CompleteAutomationActionRunInput): Promise<AutomationActionRun> {
    const actionRun = await this.claimedAutomationActionRun(input.id, input.claim_token);
    if (actionRun.idempotency_key !== input.idempotency_key) {
      throw new DomainError('INVALID_TRANSITION', `Automation action ${input.id} idempotency key mismatch`);
    }
    const completed: AutomationActionRun = {
      ...actionRun,
      status: input.status,
      ...(input.result_json === undefined ? {} : { result_json: input.result_json }),
      ...(input.retryable === undefined ? {} : { retryable: input.retryable }),
      ...(input.next_attempt_at === undefined ? {} : { next_attempt_at: input.next_attempt_at }),
      finished_at: input.finished_at,
      updated_at: input.finished_at,
    };
    await this.upsert(automation_action_runs, automation_action_runs.id, completed);
    return completed;
  }

  async listClaimableAutomationActionRuns(input: ListClaimableAutomationActionRunsInput): Promise<AutomationActionRun[]> {
    const rows = await this.db
      .select()
      .from(automation_action_runs)
      .where(
        or(
          eq(automation_action_runs.status, 'pending'),
          and(
            eq(automation_action_runs.status, 'gate_pending'),
            or(sql`${automation_action_runs.nextAttemptAt} is null`, sql`${automation_action_runs.nextAttemptAt} <= ${input.now}`),
          ),
          and(
            or(eq(automation_action_runs.status, 'blocked'), eq(automation_action_runs.status, 'failed')),
            eq(automation_action_runs.retryable, true),
            or(sql`${automation_action_runs.nextAttemptAt} is null`, sql`${automation_action_runs.nextAttemptAt} <= ${input.now}`),
          ),
          and(eq(automation_action_runs.status, 'running'), sql`${automation_action_runs.lockedUntil} <= ${input.now}`),
        ),
      )
      .orderBy(
        sql`coalesce(${automation_action_runs.nextAttemptAt}, ${automation_action_runs.createdAt})`,
        sql`case when ${automation_action_runs.actionType} = 'project_runtime_snapshot' then 1 else 0 end`,
        asc(automation_action_runs.createdAt),
        asc(automation_action_runs.id),
      )
      .limit(input.limit);
    return rows.map((row) => redactAutomationActionClaim(fromDbRecord<AutomationActionRun>(row)));
  }

  async getRuntimeSnapshotData(): Promise<RuntimeSnapshotRepositoryData> {
    const [
      projectRecords,
      repoRecords,
      workItemRecords,
      specRecords,
      specRevisionRecords,
      planRecords,
      planRevisionRecords,
      generationRunRecords,
      executionPackageRecords,
      runSessionRecords,
      holdRecords,
      settingsRecords,
      recentActionRunRecords,
    ] = await Promise.all([
        this.db.select().from(projects).orderBy(asc(projects.createdAt), asc(projects.id)),
        this.db
          .select()
          .from(project_repos)
          .where(eq(project_repos.status, 'active'))
          .orderBy(asc(project_repos.createdAt), asc(project_repos.id)),
        this.db.select().from(work_items).orderBy(asc(work_items.createdAt), asc(work_items.id)),
        this.db.select().from(specs),
        this.db.select().from(spec_revisions),
        this.db.select().from(plans).orderBy(asc(plans.createdAt), asc(plans.id)),
        this.db.select().from(plan_revisions),
        this.db.select().from(execution_package_generation_runs),
        this.db.select().from(execution_packages).orderBy(asc(execution_packages.createdAt), asc(execution_packages.id)),
        this.db.select().from(run_sessions).orderBy(asc(run_sessions.createdAt), asc(run_sessions.id)),
        this.db
          .select()
          .from(manual_path_holds)
          .where(eq(manual_path_holds.status, 'active'))
          .orderBy(asc(manual_path_holds.requestedAt), asc(manual_path_holds.id)),
        this.db.select().from(automation_project_settings),
        this.db
          .select()
          .from(automation_action_runs)
          .orderBy(
            desc(automation_action_runs.finishedAt),
            desc(automation_action_runs.updatedAt),
            desc(automation_action_runs.createdAt),
            desc(automation_action_runs.id),
          )
          .limit(RUNTIME_SNAPSHOT_RECENT_ACTION_RUN_LIMIT),
      ]);
    const projectRows = projectRecords.map((row) => fromDbRecord<Project>(row));
    const repoRows = repoRecords.map((row) => fromDbRecord<ProjectRepo>(row));
    const workItemRows = workItemRecords.map((row) => fromDbRecord<WorkItem>(row));
    const settingsByScope = new Map(
      settingsRecords.map((row) => {
        const settings = fromDbRecord<AutomationProjectSettings>(row);
        return [
          this.automationSettingsKey(settings.project_id, settings.repo_id),
          {
            ...settings,
            capabilities_json: normalizeAutomationCapabilities(settings.capabilities_json),
          },
        ] as const;
      }),
    );
    const projectSnapshotRows = projectRows.map((project) => {
      const settings = this.resolvePreloadedAutomationProjectSettings(settingsByScope, { project_id: project.id });
      return {
        project_id: project.id,
        automation_scope: `project:${project.id}` as const,
        automation_settings_version: settings.version,
        capability_fingerprint: settings.capability_fingerprint,
      };
    });
    const repoSnapshotRows = repoRows.map((repo) => {
      const settings = this.resolvePreloadedAutomationProjectSettings(settingsByScope, {
        project_id: repo.project_id,
        repo_id: repo.repo_id,
      });
      return {
        project_id: repo.project_id,
        repo_id: repo.repo_id,
        automation_scope: `repo:${repo.project_id}:${repo.repo_id}` as const,
        automation_settings_version: settings.version,
        capability_fingerprint: settings.capability_fingerprint,
        daemon_internal_local_path: repo.local_path,
      };
    });
    const holds = holdRecords.map((row) => fromDbRecord<ManualPathHold>(row));
    const specsById = new Map(
      specRecords.map((row) => {
        const record = fromDbRecord<Spec>(row);
        return [record.id, record] as const;
      }),
    );
    const specRevisionsById = new Map(
      specRevisionRecords.map((row) => {
        const record = fromDbRecord<SpecRevision>(row);
        return [record.id, record] as const;
      }),
    );
    const planRevisionsById = new Map(
      planRevisionRecords.map((row) => {
        const record = fromDbRecord<PlanRevision>(row);
        return [record.id, record] as const;
      }),
    );
    const workItemsById = new Map(workItemRows.map((record) => [record.id, record] as const));
    const generationRuns = generationRunRecords.map((row) => fromDbRecord<ExecutionPackageGenerationRun>(row));
    const runSessionsByPackage = new Map<string, RunSession[]>();
    for (const runSession of runSessionRecords.map((row) => fromDbRecord<RunSession>(row))) {
      runSessionsByPackage.set(runSession.execution_package_id, [
        ...(runSessionsByPackage.get(runSession.execution_package_id) ?? []),
        runSession,
      ]);
    }
    const planRevisionsRequiringPackages = await this.runtimeSnapshotPlanRevisionsRequiringPackages(
      planRecords.map((row) => fromDbRecord<Plan>(row)),
      repoRows,
      planRevisionsById,
      workItemsById,
      specsById,
      specRevisionsById,
      generationRuns,
      holds,
      settingsByScope,
    );
    const latestMatchingTargets = planRevisionsRequiringPackages;
    const targetRevisionIds = [
      ...new Set(
        latestMatchingTargets.flatMap((target) =>
          target.target_revision_id === undefined ? [] : [target.target_revision_id],
        ),
      ),
    ];
    const includesRevisionlessTargets = latestMatchingTargets.some((target) => target.target_revision_id === undefined);
    const revisionCondition =
      targetRevisionIds.length === 0
        ? isNull(automation_action_runs.targetRevisionId)
        : includesRevisionlessTargets
          ? or(inArray(automation_action_runs.targetRevisionId, targetRevisionIds), isNull(automation_action_runs.targetRevisionId))
          : inArray(automation_action_runs.targetRevisionId, targetRevisionIds);
    const latestMatchingActionRuns =
      latestMatchingTargets.length === 0
        ? []
        : (
            await this.db
              .select()
              .from(automation_action_runs)
              .where(
                and(
                  inArray(automation_action_runs.actionType, [
                    'ensure_package_drafts',
                  ]),
                  inArray(
                    automation_action_runs.targetObjectId,
                    [...new Set(latestMatchingTargets.map((target) => target.target_object_id))],
                  ),
                  revisionCondition,
                ),
              )
              .orderBy(
                desc(automation_action_runs.finishedAt),
                desc(automation_action_runs.updatedAt),
                desc(automation_action_runs.createdAt),
                desc(automation_action_runs.id),
              )
              .limit(runtimeSnapshotActionRunLookback(latestMatchingTargets.length))
    ).map((row) => redactAutomationActionClaim(fromDbRecord<AutomationActionRun>(row)));
    const latestMatchingActionFields = this.latestMatchingActionFieldsByTarget(latestMatchingActionRuns);
    const policyProjectionActionRuns = (
      await this.db
        .select()
        .from(automation_action_runs)
        .where(and(eq(automation_action_runs.actionType, 'project_runtime_snapshot'), eq(automation_action_runs.status, 'succeeded')))
        .orderBy(desc(automation_action_runs.finishedAt), desc(automation_action_runs.updatedAt), desc(automation_action_runs.id))
        .limit(runtimeSnapshotActionRunLookback(repoRows.length))
    ).map((row) => redactAutomationActionClaim(fromDbRecord<AutomationActionRun>(row)));

    return {
      projects: projectSnapshotRows,
      repos: repoSnapshotRows,
      plan_revisions_requiring_packages: this.applyLatestMatchingActionFields(
        planRevisionsRequiringPackages,
        latestMatchingActionFields,
      ),
      run_enqueue_disabled_packages: this.runtimeSnapshotRunEnqueueDisabledPackages(
        executionPackageRecords.map((row) => fromDbRecord<ExecutionPackage>(row)),
        repoRows,
        runSessionsByPackage,
      ),
      active_holds: this.runtimeSnapshotActiveHolds(holds),
      recent_action_runs: recentActionRunRecords.map((row) => redactAutomationActionClaim(fromDbRecord<AutomationActionRun>(row))),
      policy_projection_action_runs: policyProjectionActionRuns,
    };
  }

  async saveRelease(release: Release): Promise<void> {
    const normalized: Release = {
      ...release,
      key: release.key ?? release.id,
      release_owner_actor_id: release.release_owner_actor_id ?? release.created_by_actor_id,
      release_type: release.release_type ?? 'normal',
      visibility: release.visibility ?? 'internal',
      labels: release.labels ?? [],
      updated_by_actor_id: release.updated_by_actor_id ?? release.created_by_actor_id,
    };
    await this.db.transaction(async (tx) => {
      // Reuse the repository methods inside one transaction so the release row and link tables stay aligned.
      const repository = new DrizzleDeliveryRepository(tx as ForgeloopDrizzleDatabase);
      await repository.saveReleaseRecord(normalized);
      await repository.replaceReleaseWorkItems(normalized.id, normalized.work_item_ids);
      await repository.replaceReleaseExecutionPackages(normalized.id, normalized.execution_package_ids);
    });
  }

  async getRelease(releaseId: string): Promise<Release | undefined> {
    const release = await this.getById<Release>(releases, releases.id, releaseId);
    return release === undefined ? undefined : this.hydrateReleaseLinks(release);
  }

  async listReleases(projectId?: string): Promise<Release[]> {
    const releaseRows = await this.listWhere<Release>(
      releases,
      projectId === undefined ? undefined : eq(releases.projectId, projectId),
      releases.createdAt,
    );
    return Promise.all(releaseRows.map((release) => this.hydrateReleaseLinks(release)));
  }

  async saveReleaseWorkItem(releaseWorkItem: ReleaseWorkItem): Promise<void> {
    const linkOrder =
      (await this.getReleaseWorkItemLinkOrder(releaseWorkItem.release_id, releaseWorkItem.work_item_id)) ??
      (await this.nextReleaseWorkItemOrder(releaseWorkItem.release_id));
    await this.saveReleaseWorkItemLink(releaseWorkItem.release_id, releaseWorkItem.work_item_id, linkOrder);
  }

  async listReleaseWorkItems(releaseId: string): Promise<ReleaseWorkItem[]> {
    const rows = await this.db
      .select()
      .from(release_work_items)
      .where(eq(release_work_items.releaseId, releaseId))
      .orderBy(asc(release_work_items.linkOrder), asc(release_work_items.workItemId));

    return rows.map((row) => ({
      release_id: row.releaseId,
      work_item_id: row.workItemId,
    }));
  }

  async saveReleaseExecutionPackage(releaseExecutionPackage: ReleaseExecutionPackage): Promise<void> {
    const linkOrder =
      (await this.getReleaseExecutionPackageLinkOrder(
        releaseExecutionPackage.release_id,
        releaseExecutionPackage.execution_package_id,
      )) ?? (await this.nextReleaseExecutionPackageOrder(releaseExecutionPackage.release_id));
    await this.saveReleaseExecutionPackageLink(
      releaseExecutionPackage.release_id,
      releaseExecutionPackage.execution_package_id,
      linkOrder,
    );
  }

  async listReleaseExecutionPackages(releaseId: string): Promise<ReleaseExecutionPackage[]> {
    const rows = await this.db
      .select()
      .from(release_execution_packages)
      .where(eq(release_execution_packages.releaseId, releaseId))
      .orderBy(asc(release_execution_packages.linkOrder), asc(release_execution_packages.packageId));

    return rows.map((row) => ({
      release_id: row.releaseId,
      execution_package_id: row.packageId,
    }));
  }

  async saveReleaseEvidence(releaseEvidence: ReleaseEvidence): Promise<void> {
    const release = await this.getRelease(releaseEvidence.release_id);
    const orgId = releaseEvidence.org_id ?? release?.org_id;
    const projectId = releaseEvidence.project_id ?? release?.project_id;
    const createdByActorId = releaseEvidence.created_by_actor_id ?? release?.created_by_actor_id;
    const updatedByActorId = releaseEvidence.updated_by_actor_id ?? release?.updated_by_actor_id ?? createdByActorId;
    if (orgId === undefined || projectId === undefined || createdByActorId === undefined || updatedByActorId === undefined) {
      throw new DomainError(
        'INVALID_TRANSITION',
        `Release evidence ${releaseEvidence.id} requires release, organization, project, and actor audit anchors`,
      );
    }

    const normalized: ReleaseEvidence = {
      ...releaseEvidence,
      org_id: orgId,
      project_id: projectId,
      key: releaseEvidence.key ?? releaseEvidence.id,
      visibility: releaseEvidence.visibility ?? 'internal',
      labels: releaseEvidence.labels ?? [],
      created_by_actor_id: createdByActorId,
      updated_at: releaseEvidence.updated_at ?? releaseEvidence.created_at,
      updated_by_actor_id: updatedByActorId,
    };
    await this.upsert(release_evidences, release_evidences.id, normalized);
  }

  async getReleaseEvidence(releaseEvidenceId: string): Promise<ReleaseEvidence | undefined> {
    return this.getById(release_evidences, release_evidences.id, releaseEvidenceId);
  }

  async listReleaseEvidences(releaseId: string): Promise<ReleaseEvidence[]> {
    return this.listWhere<ReleaseEvidence>(release_evidences, eq(release_evidences.releaseId, releaseId), [
      release_evidences.createdAt,
      release_evidences.id,
    ]);
  }

  async appendObjectEvent(objectEvent: ObjectEvent): Promise<void> {
    await this.db.insert(object_events).values(toDbRecord(objectEvent, object_events) as never).onConflictDoNothing();
  }

  async listObjectEvents(objectId: string, objectType?: string): Promise<ObjectEvent[]> {
    return this.listWhere<ObjectEvent>(
      object_events,
      objectType === undefined
        ? eq(object_events.objectId, objectId)
        : and(eq(object_events.objectId, objectId), eq(object_events.objectType, objectType)),
      object_events.createdAt,
    );
  }

  async appendStatusHistory(statusHistory: StatusHistory): Promise<void> {
    await this.db
      .insert(status_histories)
      .values(statusHistoryDbRecord(statusHistory) as never)
      .onConflictDoNothing();
  }

  async listStatusHistory(objectId: string, objectType?: string): Promise<StatusHistory[]> {
    const records = await this.db
      .select()
      .from(status_histories)
      .where(
        objectType === undefined
          ? eq(status_histories.objectId, objectId)
          : and(eq(status_histories.objectId, objectId), eq(status_histories.objectType, objectType)),
      )
      .orderBy(status_histories.createdAt);
    return records.map((record) => statusHistoryFromDbRecord(record));
  }

  async saveArtifact(artifact: Artifact): Promise<void> {
    await this.upsert(artifacts, artifacts.id, artifact);
  }

  async listArtifactsForObject(objectType: string, objectId: string): Promise<Artifact[]> {
    return this.listWhere<Artifact>(
      artifacts,
      and(eq(artifacts.objectType, objectType), eq(artifacts.objectId, objectId)),
      artifacts.createdAt,
    );
  }

  async saveDecision(decision: Decision): Promise<void> {
    await this.upsert(decisions, decisions.id, decision);
  }

  async listDecisionsForObject(objectType: string, objectId: string): Promise<Decision[]> {
    return this.listWhere<Decision>(
      decisions,
      and(eq(decisions.objectType, objectType), eq(decisions.objectId, objectId)),
      decisions.createdAt,
    );
  }

  async saveTraceEvent(traceEvent: TraceEventRecord): Promise<void> {
    const record = toDbRecord(traceEvent, trace_events);
    await this.db.insert(trace_events).values(record as never);
  }

  async updateTraceEvent(traceEvent: TraceEventRecord): Promise<void> {
    const record = toDbRecord(traceEvent, trace_events);
    const { id: _id, createdAt: _createdAt, ...set } = record;
    await this.db.update(trace_events).set(set as never).where(eq(trace_events.id, traceEvent.id));
  }

  async listTraceEventsForSubject(subjectType: string, subjectId: string): Promise<TraceEventRecord[]> {
    return this.listWhere<TraceEventRecord>(
      trace_events,
      and(eq(trace_events.subjectType, subjectType), eq(trace_events.subjectId, subjectId)),
      [trace_events.createdAt, trace_events.id],
    );
  }

  async saveTraceLink(traceLink: TraceLinkRecord): Promise<void> {
    await this.db.insert(trace_links).values(toDbRecord(traceLink, trace_links) as never).onConflictDoNothing();
  }

  async listTraceLinks(traceEventId: string): Promise<TraceLinkRecord[]> {
    return this.listWhere<TraceLinkRecord>(trace_links, eq(trace_links.traceEventId, traceEventId), [
      trace_links.createdAt,
      trace_links.id,
    ]);
  }

  async saveTraceArtifactRef(traceArtifactRef: TraceArtifactRefRecord): Promise<void> {
    await this.db
      .insert(trace_artifact_refs)
      .values(toDbRecord(traceArtifactRef, trace_artifact_refs) as never)
      .onConflictDoNothing();
  }

  async listTraceArtifactRefs(traceEventId: string): Promise<TraceArtifactRefRecord[]> {
    return this.listWhere<TraceArtifactRefRecord>(
      trace_artifact_refs,
      eq(trace_artifact_refs.traceEventId, traceEventId),
      [trace_artifact_refs.createdAt, trace_artifact_refs.id],
    );
  }

  private async appendRunEventInTransaction(
    db: ForgeloopDrizzleDatabase,
    event: Omit<RunEvent, 'sequence' | 'cursor'>,
  ): Promise<RunEvent> {
    const counterResult = await db.execute(sql<{ allocated_sequence: number }>`
      insert into run_event_counters (run_session_id, next_sequence)
      values (${event.run_session_id}, 2)
      on conflict (run_session_id)
      do update set next_sequence = run_event_counters.next_sequence + 1
      returning next_sequence - 1 as allocated_sequence
    `);
    const allocated = counterResult.rows[0]?.allocated_sequence;
    if (allocated === undefined) {
      throw new DomainError('INVALID_TRANSITION', `Could not allocate event sequence for run ${event.run_session_id}`);
    }

    const runEvent: RunEvent = {
      ...event,
      sequence: Number(allocated),
      cursor: eventCursor(Number(allocated)),
    };
    const [row] = await db
      .insert(run_events)
      .values(toDbRecord(runEvent, run_events) as never)
      .onConflictDoNothing()
      .returning();

    if (row === undefined) {
      const existing = await new DrizzleDeliveryRepository(db).getById<RunEvent>(run_events, run_events.id, event.id);
      if (existing === undefined) {
        throw new DomainError('INVALID_TRANSITION', `Run event ${event.id} could not be appended`);
      }

      return existing;
    }

    return fromDbRecord<RunEvent>(row);
  }

  private async withAdvisoryLocks<T>(keys: readonly string[], write: (repository: DeliveryRepository) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => {
      for (const key of [...new Set(keys)].sort()) {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${key}))`);
      }
      return write(this.childRepository(tx as ForgeloopDrizzleDatabase));
    });
  }

  private childRepository(db: ForgeloopDrizzleDatabase): DrizzleDeliveryRepository {
    return new DrizzleDeliveryRepository(db, {
      codexLaunchTokenEnvelopeSealer: this.codexLaunchTokenEnvelopeSealer,
    });
  }

  private assertCodexRuntimeJobArtifactIntake(input: PreflightCreateCodexRuntimeJobArtifactInput): void {
    try {
      validateCodexRuntimeJobArtifactIntake(input);
    } catch {
      throw codexDenied('codex_runtime_job_unavailable', 'Codex runtime job artifact upload was denied.');
    }
  }

  private async assertCodexRuntimeJobArtifactObjectBinding(input: CreateCodexRuntimeJobArtifactInput): Promise<void> {
    const object = await this.getInternalArtifactObjectById(input.internal_artifact_object_id);
    if (
      object === undefined ||
      object.ref !== input.internal_ref ||
      object.owner_type !== 'codex_runtime_job' ||
      object.owner_id !== input.runtime_job_id ||
      object.kind !== 'codex_runtime_job_artifact' ||
      object.artifact_id !== input.artifact_id ||
      object.digest !== input.digest ||
      object.content_type !== input.content_type ||
      object.size_bytes !== String(input.size_bytes)
    ) {
      throw codexDenied('codex_runtime_job_unavailable', 'Codex runtime job artifact object binding was denied.');
    }
  }

  private async preflightCreateCodexRuntimeJobArtifactUnlocked(
    input: PreflightCreateCodexRuntimeJobArtifactInput,
  ): Promise<CodexWorkerSessionProof> {
    const session = await this.assertCodexRuntimeJobWorkerSession(
      input.runtime_job_id,
      input.worker_id,
      input.worker_session_token,
      'codex_runtime_job_unavailable',
      input.now,
      {
        requireConnected: false,
      },
    );
    this.assertCodexRuntimeJobArtifactIntake(input);
    const bundle = await this.lockCodexRuntimeJobBundle(input.runtime_job_id);
    if (bundle.job === undefined) {
      throw codexDenied('codex_runtime_job_unavailable', 'Codex runtime job artifact upload was denied.');
    }
    this.assertCodexRuntimeJobArtifactEligibility(bundle, input);
    const expectedInternalRef = `artifact://internal/codex_runtime_job_artifact/codex_runtime_job/${input.runtime_job_id}/${input.artifact_id}`;
    if (input.internal_ref !== expectedInternalRef) {
      throw codexDenied('codex_runtime_job_unavailable', 'Codex runtime job artifact ref was denied.');
    }
    await this.assertCodexWorkerNonceAvailable(
      input.worker_id,
      input.worker_session_token,
      input.nonce,
      input.replay_protection,
      session.session_epoch,
    );
    const existing = await this.findCodexRuntimeJobArtifactReplay(input);
    if (existing !== undefined && !this.codexRuntimeJobArtifactPreflightReplayMatches(existing, input)) {
      throw codexDenied('codex_runtime_job_unavailable', 'Codex runtime job artifact replay was denied.');
    }
    return session;
  }

  private async assertCodexWorkerNonceAvailable(
    workerId: string,
    sessionToken: string,
    nonce: string,
    replayProtection?: CodexWorkerReplayProtectionInput,
    sessionEpochOverride?: number,
  ): Promise<void> {
    const sessionTokenHash = codexCredentialPayloadDigest(sessionToken);
    const nonceHash = codexCredentialPayloadDigest(nonce);
    const [worker] = await this.db
      .select({ sessionEpoch: codex_worker_registrations.sessionEpoch })
      .from(codex_worker_registrations)
      .where(eq(codex_worker_registrations.id, workerId))
      .limit(1);
    const sessionEpoch = sessionEpochOverride ?? worker?.sessionEpoch ?? 1;
    const replayKeyHash = codexCanonicalDigest({
      method: replayProtection?.method ?? 'LEGACY',
      path: replayProtection?.path ?? 'legacy-worker-session',
      body_digest: replayProtection?.body_digest ?? sessionTokenHash,
      worker_id: workerId,
      session_epoch: sessionEpoch,
      nonce,
    });
    const [existing] = await this.db
      .select({ id: codex_worker_session_nonces.id })
      .from(codex_worker_session_nonces)
      .where(
        or(
          and(
            eq(codex_worker_session_nonces.workerId, workerId),
            eq(codex_worker_session_nonces.sessionTokenHash, sessionTokenHash),
            eq(codex_worker_session_nonces.nonceHash, nonceHash),
          ),
          and(
            eq(codex_worker_session_nonces.workerId, workerId),
            eq(codex_worker_session_nonces.sessionEpoch, sessionEpoch),
            eq(codex_worker_session_nonces.nonceHash, nonceHash),
          ),
          eq(codex_worker_session_nonces.replayKeyHash, replayKeyHash),
        ),
      )
      .limit(1);
    if (existing !== undefined) {
      throw codexDenied('codex_worker_nonce_replay', 'Codex worker session nonce was already used.');
    }
  }

  private assertCodexRuntimeJobArtifactEligibility(
    bundle: {
      job?: CodexRuntimeJobDbRecord;
      lease?: CodexLaunchLeaseDbRecord;
    },
    input: PreflightCreateCodexRuntimeJobArtifactInput,
  ): void {
    const preStartFailureEvidenceAllowed =
      input.kind === 'startup_failure_evidence' &&
      ((bundle.lease?.status === 'active' && (bundle.job?.status === 'accepted' || bundle.job?.status === 'materializing')) ||
        (bundle.job?.status === 'materializing' && bundle.lease?.status === 'materialized'));
    if (
      bundle.job === undefined ||
      bundle.lease === undefined ||
      bundle.job.worker_id !== input.worker_id ||
      (bundle.job.status !== 'running' && !preStartFailureEvidenceAllowed) ||
      !timestampIsAfter(bundle.job.expires_at, input.now) ||
      (bundle.lease.status !== 'materialized' && !preStartFailureEvidenceAllowed) ||
      !timestampIsAfter(bundle.lease.expires_at, input.now)
    ) {
      throw codexDenied('codex_runtime_job_unavailable', 'Codex runtime job artifact upload was denied.');
    }
  }

  private async assertCodexWorkerNonceRecorded(
    workerId: string,
    sessionToken: string,
    nonce: string,
    replayProtection: CodexWorkerReplayProtectionInput | undefined,
    sessionEpoch: number,
  ): Promise<void> {
    const sessionTokenHash = codexCredentialPayloadDigest(sessionToken);
    const nonceHash = codexCredentialPayloadDigest(nonce);
    const requestBindingDigest =
      replayProtection === undefined
        ? codexCanonicalDigest({ method: 'LEGACY', path: 'legacy-worker-session', body_digest: sessionTokenHash })
        : codexCanonicalDigest(replayProtection);
    const replayKeyHash = codexCanonicalDigest({
      method: replayProtection?.method ?? 'LEGACY',
      path: replayProtection?.path ?? 'legacy-worker-session',
      body_digest: replayProtection?.body_digest ?? sessionTokenHash,
      worker_id: workerId,
      session_epoch: sessionEpoch,
      nonce,
    });
    const [existing] = await this.db
      .select({ id: codex_worker_session_nonces.id })
      .from(codex_worker_session_nonces)
      .where(
        and(
          eq(codex_worker_session_nonces.workerId, workerId),
          eq(codex_worker_session_nonces.sessionTokenHash, sessionTokenHash),
          eq(codex_worker_session_nonces.nonceHash, nonceHash),
          eq(codex_worker_session_nonces.sessionEpoch, sessionEpoch),
          eq(codex_worker_session_nonces.requestBindingDigest, requestBindingDigest),
          eq(codex_worker_session_nonces.replayKeyHash, replayKeyHash),
        ),
      )
      .limit(1);
    if (existing === undefined) {
      throw codexDenied('codex_worker_nonce_replay', 'Codex worker session nonce reservation was not found.');
    }
  }

  private async findCodexRuntimeJobArtifactReplay(
    input: PreflightCreateCodexRuntimeJobArtifactInput,
  ): Promise<CodexRuntimeJobArtifactDbRecord | undefined> {
    const rows = await this.db
      .select()
      .from(codex_runtime_job_artifacts)
      .where(
        or(
          eq(codex_runtime_job_artifacts.id, input.artifact_id),
          and(
            eq(codex_runtime_job_artifacts.runtimeJobId, input.runtime_job_id),
            eq(codex_runtime_job_artifacts.artifactIdempotencyKey, input.artifact_idempotency_key),
          ),
          and(
            eq(codex_runtime_job_artifacts.runtimeJobId, input.runtime_job_id),
            eq(codex_runtime_job_artifacts.digest, input.digest),
            eq(codex_runtime_job_artifacts.contentType, input.content_type),
          ),
        ),
      );
    const records = rows.map((row) => fromDbRecord<CodexRuntimeJobArtifactDbRecord>(row as Record<string, unknown>));
    const first = records[0];
    if (first === undefined) {
      return undefined;
    }
    if (records.some((record) => record.id !== first.id)) {
      throw codexDenied('codex_runtime_job_unavailable', 'Codex runtime job artifact replay was denied.');
    }
    return first;
  }

  private codexRuntimeJobArtifactReplayMatches(
    artifact: CodexRuntimeJobArtifactDbRecord,
    input: CreateCodexRuntimeJobArtifactInput,
  ): boolean {
    return (
      artifact.runtime_job_id === input.runtime_job_id &&
      artifact.artifact_idempotency_key === input.artifact_idempotency_key &&
      artifact.kind === input.kind &&
      artifact.name === input.name &&
      artifact.content_type === input.content_type &&
      artifact.digest === input.digest &&
      artifact.internal_ref === input.internal_ref &&
      artifact.internal_artifact_object_id === input.internal_artifact_object_id &&
      artifact.size_bytes === input.size_bytes &&
      valuesEqual(artifact.metadata_json, input.metadata_json)
    );
  }

  private codexRuntimeJobArtifactPreflightReplayMatches(
    artifact: CodexRuntimeJobArtifactDbRecord,
    input: PreflightCreateCodexRuntimeJobArtifactInput,
  ): boolean {
    return (
      artifact.runtime_job_id === input.runtime_job_id &&
      artifact.artifact_idempotency_key === input.artifact_idempotency_key &&
      artifact.kind === input.kind &&
      artifact.name === input.name &&
      artifact.content_type === input.content_type &&
      artifact.digest === input.digest &&
      artifact.internal_ref === input.internal_ref &&
      artifact.size_bytes === input.size_bytes &&
      valuesEqual(artifact.metadata_json, input.metadata_json)
    );
  }

  private internalArtifactObjectReplayMatches(
    object: InternalArtifactObject,
    input: CreateInternalArtifactObjectInput,
  ): boolean {
    return (
      object.id === input.id &&
      object.artifact_id === input.artifact_id &&
      object.ref === input.ref &&
      object.storage_key === input.storage_key &&
      object.kind === input.kind &&
      object.content_type === input.content_type &&
      object.size_bytes === input.size_bytes &&
      object.digest === input.digest &&
      object.visibility === input.visibility &&
      object.owner_type === input.owner_type &&
      object.owner_id === input.owner_id &&
      object.idempotency_key === input.idempotency_key &&
      object.request_digest === input.request_digest &&
      object.created_by_actor_type === input.created_by_actor_type &&
      object.created_by_actor_id === input.created_by_actor_id &&
      object.deleted_at === input.deleted_at &&
      valuesEqual(object.metadata_json, input.metadata_json)
    );
  }

  private async tombstoneInternalArtifactObjectUnlocked(
    input: TombstoneInternalArtifactObjectInput,
  ): Promise<InternalArtifactObject> {
    const [row] = await this.db
      .update(internal_artifact_objects)
      .set({ deletedAt: input.deleted_at })
      .where(eq(internal_artifact_objects.ref, input.ref))
      .returning();
    if (row === undefined) {
      throw codexDenied('codex_runtime_job_unavailable', 'internal_artifact_not_found');
    }
    return internalArtifactObjectFromDbRecord(fromDbRecord<InternalArtifactObjectDbRecord>(row as Record<string, unknown>));
  }

  private async assertCodexRuntimeTerminalArtifactRefs(runtimeJobId: string, terminalResultJson: Record<string, unknown>): Promise<void> {
    const rows = await this.db
      .select()
      .from(codex_runtime_job_artifacts)
      .where(eq(codex_runtime_job_artifacts.runtimeJobId, runtimeJobId));
    const artifactsByRef = new Map(
      rows
        .map((row) => fromDbRecord<CodexRuntimeJobArtifactDbRecord>(row as Record<string, unknown>))
        .map((artifact) => [artifact.internal_ref, artifact] as const),
    );
    for (const ref of collectCodexRuntimeJobTerminalArtifactRefs(terminalResultJson)) {
      const artifact = artifactsByRef.get(ref.internal_ref);
      if (
        artifact === undefined ||
        artifact.digest !== ref.digest ||
        (ref.content_type !== undefined && artifact.content_type !== ref.content_type)
      ) {
        throw codexDenied('codex_runtime_job_unavailable', 'Codex runtime job terminal artifact ref was denied.');
      }
    }
  }

  private codexRuntimeJobStateLockKeys(runtimeJobId: string, workerId: string): readonly string[] {
    return [`codex-runtime-job:${runtimeJobId}`, `codex-runtime-worker:${workerId}`];
  }

  private async lockCodexRuntimeJobBundle(runtimeJobId: string): Promise<{
    job?: CodexRuntimeJobDbRecord;
    lease?: CodexLaunchLeaseDbRecord;
    envelope?: CodexLaunchTokenEnvelope;
  }> {
    const jobResult = await this.db.execute(sql<Record<string, unknown>>`
      select *
      from codex_runtime_jobs
      where id = ${runtimeJobId}
      for update
    `);
    const jobRow = jobResult.rows[0];
    if (jobRow === undefined) {
      return {};
    }
    const job = fromDbRecord<CodexRuntimeJobDbRecord>(jobRow);
    const lease = await this.lockCodexLaunchLease(job.launch_lease_id);
    const envelope = await this.lockCodexLaunchTokenEnvelope(runtimeJobId);
    return { job, ...(lease === undefined ? {} : { lease }), ...(envelope === undefined ? {} : { envelope }) };
  }

  private async lockCodexLaunchLease(launchLeaseId: string): Promise<CodexLaunchLeaseDbRecord | undefined> {
    const result = await this.db.execute(sql<Record<string, unknown>>`
      select *
      from codex_launch_leases
      where id = ${launchLeaseId}
      for update
    `);
    const row = result.rows[0];
    return row === undefined ? undefined : fromDbRecord<CodexLaunchLeaseDbRecord>(row);
  }

  private async lockCodexLaunchTokenEnvelope(runtimeJobId: string): Promise<CodexLaunchTokenEnvelope | undefined> {
    const result = await this.db.execute(sql<Record<string, unknown>>`
      select *
      from codex_launch_token_envelopes
      where runtime_job_id = ${runtimeJobId}
      for update
    `);
    const row = result.rows[0];
    return row === undefined ? undefined : fromDbRecord<CodexLaunchTokenEnvelope>(row);
  }

  private async lockCodexWorkerRegistration(workerId: string): Promise<CodexWorkerRegistrationDbRecord | undefined> {
    const result = await this.db.execute(sql<Record<string, unknown>>`
      select *
      from codex_worker_registrations
      where id = ${workerId}
      for update
    `);
    const row = result.rows[0];
    return row === undefined ? undefined : fromDbRecord<CodexWorkerRegistrationDbRecord>(row);
  }

  private codexRuntimeJobRecoveryEvidence(
    job: CodexRuntimeJob,
  ): RecoverStaleCodexRuntimeJobsResult['recovered_runtime_jobs'][number] {
    return {
      id: job.id,
      worker_id: job.worker_id,
      launch_lease_id: job.launch_lease_id,
      target_type: job.target_type,
      target_id: job.target_id,
      target_kind: job.target_kind,
      project_id: job.project_id,
      ...(job.repo_id === undefined ? {} : { repo_id: job.repo_id }),
      status: job.status,
      ...(job.terminal_status === undefined ? {} : { terminal_status: job.terminal_status }),
      ...(job.terminal_reason_code === undefined ? {} : { terminal_reason_code: job.terminal_reason_code }),
      ...(job.terminal_at === undefined ? {} : { terminal_at: job.terminal_at }),
      updated_at: job.updated_at,
    };
  }

  private codexLaunchLeaseRecoveryEvidence(
    lease: CodexLaunchLease,
  ): RecoverStaleCodexRuntimeJobsResult['recovered_launch_leases'][number] {
    return {
      id: lease.id,
      ...(lease.worker_id === undefined ? {} : { worker_id: lease.worker_id }),
      target_type: lease.target.target_type,
      target_id: lease.target.target_id,
      target_kind: lease.target.target_kind,
      project_id: lease.target.project_id,
      ...(lease.target.repo_id === undefined ? {} : { repo_id: lease.target.repo_id }),
      status: lease.status,
      ...(lease.terminal_reason_code === undefined ? {} : { terminal_reason_code: lease.terminal_reason_code }),
    };
  }

  private codexLaunchFenceSnapshotMatches(
    record: CodexLaunchLeaseDbRecord,
    activeFence: CodexLaunchFenceSnapshot | undefined,
  ): boolean {
    if (activeFence === undefined) {
      return true;
    }
    return (
      (activeFence.action_claim_token_hash === undefined ||
        record.action_claim_token_hash === undefined ||
        record.action_claim_token_hash === activeFence.action_claim_token_hash) &&
      (activeFence.precondition_fingerprint === undefined ||
        record.precondition_fingerprint === undefined ||
        record.precondition_fingerprint === activeFence.precondition_fingerprint) &&
      (activeFence.run_worker_lease_id === undefined ||
        record.run_worker_lease_id === undefined ||
        record.run_worker_lease_id === activeFence.run_worker_lease_id) &&
      (activeFence.run_worker_lease_token_hash === undefined ||
        record.run_worker_lease_token_hash === undefined ||
        record.run_worker_lease_token_hash === activeFence.run_worker_lease_token_hash) &&
      (activeFence.run_session_status === undefined ||
        record.run_session_status === undefined ||
        record.run_session_status === activeFence.run_session_status) &&
      (activeFence.run_session_updated_at === undefined ||
        record.run_session_updated_at === undefined ||
        record.run_session_updated_at === activeFence.run_session_updated_at) &&
      (activeFence.execution_package_version === undefined ||
        record.execution_package_version === undefined ||
        record.execution_package_version === activeFence.execution_package_version)
    );
  }

  private async assertCodexRuntimeJobMaterializationDependencies(
    job: CodexRuntimeJobDbRecord,
    lease: CodexLaunchLeaseDbRecord,
  ): Promise<void> {
    await this.codexRuntimeJobMaterialization(job, lease, lease.materialized_at ?? lease.created_at);
  }

  private async codexRuntimeJobMaterialization(
    job: CodexRuntimeJobDbRecord,
    lease: CodexLaunchLeaseDbRecord,
    now: string,
  ): Promise<CodexLaunchMaterialization> {
    const profileRevision = await this.getById<CodexRuntimeProfileRevision>(
      codex_runtime_profile_revisions,
      codex_runtime_profile_revisions.id,
      lease.runtime_profile_revision_id,
    );
    const [credentialRow] = await this.db
      .select()
      .from(codex_credential_binding_versions)
      .where(eq(codex_credential_binding_versions.id, lease.credential_binding_version_id))
      .limit(1);
    const credentialBinding = await this.getById<CodexCredentialBinding>(
      codex_credential_bindings,
      codex_credential_bindings.id,
      lease.credential_binding_id,
    );
    const worker =
      lease.worker_id === undefined ? undefined : await this.lockCodexWorkerRegistration(lease.worker_id);
    if (profileRevision === undefined || credentialRow === undefined || credentialBinding === undefined || worker === undefined) {
      throw codexDenied('codex_launch_materialization_denied', 'Codex runtime job materialization dependencies were denied.');
    }
    const credentialRecord = fromDbRecord<CodexCredentialBindingVersion & { secret_payload_json: unknown }>(
      credentialRow as Record<string, unknown>,
    );
    if (
      profileRevision.status !== 'active' ||
      profileRevision.profile_digest !== lease.runtime_profile_digest ||
      credentialRecord.status !== 'active' ||
      credentialRecord.payload_digest !== lease.credential_payload_digest ||
      credentialBinding.profile_id !== profileRevision.profile_id ||
      !this.workerRecordMatchesLaunch(worker, lease, profileRevision) ||
      job.credential_binding_version_id !== credentialRecord.id ||
      job.credential_payload_digest !== credentialRecord.payload_digest
    ) {
      throw codexDenied('codex_launch_materialization_denied', 'Codex runtime job materialization dependencies were denied.');
    }
    return {
      launch_target: launchLeaseFromDbRecord(lease).target,
      profile_revision: profileRevision,
      resolved_credentials: [
        {
          binding_id: lease.credential_binding_id,
          binding_version_id: credentialRecord.id,
          payload: credentialRecord.secret_payload_json,
          payload_digest: credentialRecord.payload_digest,
        },
      ],
      lease_id: lease.id,
      expires_at: lease.expires_at,
      materialized_at: lease.materialized_at ?? now,
    };
  }

  private codexRuntimeJobEventObjectId(runtimeJobId: string, eventId: string): string {
    return `codex-runtime-job-event:${runtimeJobId}:${eventId}`;
  }

  private codexRuntimeJobEventIdempotencyObjectId(runtimeJobId: string, idempotencyKey: string): string {
    return `codex-runtime-job-event-idempotency:${runtimeJobId}:${idempotencyKey}`;
  }

  private async getCodexRuntimeJobEventRecord(objectEventId: string): Promise<
    | {
        runtime_job_id: string;
        event_id: string;
        idempotency_key: string;
        request_digest: string;
        job: CodexRuntimeJob;
      }
    | undefined
  > {
    const [row] = await this.db.select().from(object_events).where(eq(object_events.id, objectEventId)).limit(1);
    const metadata = row?.metadata as Record<string, unknown> | undefined;
    if (
      metadata === undefined ||
      typeof metadata.runtime_job_id !== 'string' ||
      typeof metadata.event_id !== 'string' ||
      typeof metadata.idempotency_key !== 'string' ||
      typeof metadata.request_digest !== 'string' ||
      typeof metadata.job !== 'object' ||
      metadata.job === null
    ) {
      return undefined;
    }
    return {
      runtime_job_id: metadata.runtime_job_id,
      event_id: metadata.event_id,
      idempotency_key: metadata.idempotency_key,
      request_digest: metadata.request_digest,
      job: metadata.job as CodexRuntimeJob,
    };
  }

  private async decrementCodexWorkerLeaseCounts(db: ForgeloopDrizzleDatabase, workerIds: readonly string[]): Promise<void> {
    const counts = new Map<string, number>();
    for (const workerId of workerIds) {
      counts.set(workerId, (counts.get(workerId) ?? 0) + 1);
    }
    for (const [workerId, count] of counts.entries()) {
      await db
        .update(codex_worker_registrations)
        .set({ leaseCount: sql`greatest(${codex_worker_registrations.leaseCount} - ${count}, 0)` } as never)
        .where(eq(codex_worker_registrations.id, workerId));
    }
  }

  private async codexLaunchLeaseOccupiesWorkerSlot(leaseId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ inputJson: codex_runtime_jobs.inputJson })
      .from(codex_runtime_jobs)
      .where(eq(codex_runtime_jobs.launchLeaseId, leaseId))
      .limit(1);
    return row === undefined || !isCodexSessionResumeRuntimeJobInput(row.inputJson as Record<string, unknown>);
  }

  private async findActiveCodexWorkerBootstrap(input: {
    worker_identity: string;
    bootstrap_token_hash: string;
    bootstrap_token_version: number;
    now: string;
  }): Promise<
    | {
        allowed_scopes_json: readonly CodexRuntimeScope[];
        allowed_capabilities_json: Record<string, unknown>;
      }
    | undefined
  > {
    const [row] = await this.db
      .select()
      .from(codex_worker_bootstrap_tokens)
      .where(
        and(
          eq(codex_worker_bootstrap_tokens.workerIdentity, input.worker_identity),
          eq(codex_worker_bootstrap_tokens.bootstrapTokenHash, input.bootstrap_token_hash),
          eq(codex_worker_bootstrap_tokens.bootstrapTokenVersion, input.bootstrap_token_version),
          eq(codex_worker_bootstrap_tokens.status, 'active'),
          isNull(codex_worker_bootstrap_tokens.revokedAt),
          gt(codex_worker_bootstrap_tokens.expiresAt, input.now),
        ),
      )
      .limit(1);
    return row === undefined
      ? undefined
      : fromDbRecord<{
          allowed_scopes_json: readonly CodexRuntimeScope[];
          allowed_capabilities_json: Record<string, unknown>;
        }>(row);
  }

  private async assertCodexWorkerSession(
    workerId: string,
    sessionToken: string,
    deniedCode: Extract<
      DomainErrorType['code'],
      | 'codex_worker_registration_denied'
      | 'codex_launch_lease_denied'
      | 'codex_launch_materialization_denied'
      | 'codex_runtime_job_unavailable'
    >,
    now: string,
    options: { requireConnected?: boolean } = {},
  ): Promise<CodexWorkerSessionProof> {
    const requireConnected = options.requireConnected ?? true;
    const [row] = await this.db
      .select()
      .from(codex_worker_registrations)
      .where(eq(codex_worker_registrations.id, workerId))
      .limit(1);
    const worker = row === undefined ? undefined : fromDbRecord<CodexWorkerRegistrationDbRecord>(row as Record<string, unknown>);
    if (
      worker === undefined ||
      worker.session_token_hash !== codexCredentialPayloadDigest(sessionToken) ||
      !timestampIsAfter(worker.session_token_expires_at, now) ||
      (requireConnected &&
        ((worker.status !== 'online' && worker.status !== 'draining') || worker.control_channel_status !== 'connected'))
    ) {
      throw codexDenied(deniedCode, 'Codex worker session proof was rejected.');
    }
    return {
      worker,
      session_token_hash: worker.session_token_hash,
      session_epoch: worker.session_epoch,
      session_public_key_id: worker.session_public_key_id,
      session_public_key_expires_at: worker.session_public_key_expires_at,
    };
  }

  private async assertCodexRuntimeJobWorkerSession(
    runtimeJobId: string,
    workerId: string,
    sessionToken: string,
    deniedCode: Extract<
      DomainErrorType['code'],
      | 'codex_worker_registration_denied'
      | 'codex_launch_lease_denied'
      | 'codex_launch_materialization_denied'
      | 'codex_runtime_job_unavailable'
    >,
    now: string,
    options: { requireConnected?: boolean } = {},
  ): Promise<CodexWorkerSessionProof> {
    const sessionTokenHash = codexCredentialPayloadDigest(sessionToken);
    try {
      return await this.assertCodexWorkerSession(workerId, sessionToken, deniedCode, now, options);
    } catch (error) {
      if (!(error instanceof DomainError)) {
        throw error;
      }
    }

    const [workerRow] = await this.db
      .select()
      .from(codex_worker_registrations)
      .where(eq(codex_worker_registrations.id, workerId))
      .limit(1);
    const [jobRow] = await this.db
      .select()
      .from(codex_runtime_jobs)
      .where(eq(codex_runtime_jobs.id, runtimeJobId))
      .limit(1);
    const worker =
      workerRow === undefined ? undefined : fromDbRecord<CodexWorkerRegistrationDbRecord>(workerRow as Record<string, unknown>);
    const job = jobRow === undefined ? undefined : fromDbRecord<CodexRuntimeJobDbRecord>(jobRow as Record<string, unknown>);
    const lease = job === undefined ? undefined : await this.lockCodexLaunchLease(job.launch_lease_id);
    const requireConnected = options.requireConnected ?? true;
    if (
      worker === undefined ||
      job === undefined ||
      lease === undefined ||
      job.worker_id !== workerId ||
      lease.worker_id !== workerId ||
      job.accepted_worker_session_digest !== sessionTokenHash ||
      job.accepted_session_epoch === undefined ||
      job.accepted_session_public_key_id === undefined ||
      job.accepted_session_public_key_expires_at === undefined ||
      (job.status !== 'accepted' && job.status !== 'materializing' && job.status !== 'running') ||
      !timestampIsAfter(job.expires_at, now) ||
      !timestampIsAfter(lease.expires_at, now) ||
      !timestampIsAfter(job.accepted_session_public_key_expires_at, now) ||
      (lease.status !== 'active' && lease.status !== 'materialized') ||
      (requireConnected && ((worker.status !== 'online' && worker.status !== 'draining') || worker.control_channel_status !== 'connected'))
    ) {
      throw codexDenied(deniedCode, 'Codex worker session proof was rejected.');
    }
    return {
      worker,
      session_token_hash: sessionTokenHash,
      session_epoch: job.accepted_session_epoch,
      session_public_key_id: job.accepted_session_public_key_id,
      session_public_key_expires_at: job.accepted_session_public_key_expires_at,
    };
  }

  private workerRecordMatchesLaunch(
    worker: CodexWorkerRegistrationDbRecord,
    record: CodexLaunchLeaseDbRecord,
    profileRevision: CodexRuntimeProfileRevision,
  ): boolean {
    return (
      (worker.status === 'online' || worker.status === 'draining') &&
      worker.control_channel_status === 'connected' &&
      capabilityList(worker.capabilities_json, 'target_kinds').includes(record.target_kind) &&
      codexWorkerScopeMatchesTarget(worker.allowed_scopes_json, record.target_kind, codexScope(record.project_id, record.repo_id)) &&
      capabilityList(worker.capabilities_json, 'docker_image_digests').includes(record.docker_image_digest) &&
      capabilityList(worker.capabilities_json, 'network_policy_digests').includes(record.network_policy_digest) &&
      (record.network_provider_config_digest === undefined ||
        capabilityList(worker.capabilities_json, 'network_provider_config_digests').includes(record.network_provider_config_digest)) &&
      profileRevision.docker_image_digest === record.docker_image_digest &&
      codexRuntimeNetworkPolicyDigest(profileRevision.network_policy) === record.network_policy_digest
    );
  }

  private async recordCodexWorkerNonce(
    workerId: string,
    sessionToken: string,
    nonce: string,
    nonceTimestamp: string,
    now: string,
    replayProtection?: CodexWorkerReplayProtectionInput,
    sessionEpochOverride?: number,
  ): Promise<void> {
    const sessionTokenHash = codexCredentialPayloadDigest(sessionToken);
    const nonceHash = codexCredentialPayloadDigest(nonce);
    const [worker] = await this.db
      .select({ sessionEpoch: codex_worker_registrations.sessionEpoch })
      .from(codex_worker_registrations)
      .where(eq(codex_worker_registrations.id, workerId))
      .limit(1);
    const sessionEpoch = sessionEpochOverride ?? worker?.sessionEpoch ?? 1;
    const requestBindingDigest =
      replayProtection === undefined
        ? codexCanonicalDigest({ method: 'LEGACY', path: 'legacy-worker-session', body_digest: sessionTokenHash })
        : codexCanonicalDigest(replayProtection);
    const replayKeyHash = codexCanonicalDigest({
      method: replayProtection?.method ?? 'LEGACY',
      path: replayProtection?.path ?? 'legacy-worker-session',
      body_digest: replayProtection?.body_digest ?? sessionTokenHash,
      worker_id: workerId,
      session_epoch: sessionEpoch,
      nonce,
    });
    const [row] = await this.db
      .insert(codex_worker_session_nonces)
      .values({
        id: randomUUID(),
        workerId,
        sessionTokenHash,
        nonceHash,
        sessionEpoch,
        requestBindingDigest,
        replayKeyHash,
        nonceTimestamp,
        createdAt: now,
      } as never)
      .onConflictDoNothing()
      .returning({ id: codex_worker_session_nonces.id });
    if (row === undefined) {
      throw codexDenied('codex_worker_nonce_replay', 'Codex worker session nonce was already used.');
    }
  }

  private async codexLaunchFenceIsActive(record: CodexLaunchLeaseDbRecord, now: string): Promise<boolean> {
    if (record.target_kind === 'generation') {
      return this.codexGenerationFenceIsActive(record, now);
    }
    return this.codexRunExecutionFenceIsActive(record, now);
  }

  private async codexGenerationFenceIsActive(record: CodexLaunchLeaseDbRecord, now: string): Promise<boolean> {
    const actionRun = await this.getById<AutomationActionRun>(automation_action_runs, automation_action_runs.id, record.target_id);
    if (
      actionRun === undefined ||
      actionRun.status !== 'running' ||
      actionRun.claim_token === undefined ||
      actionRun.locked_until === undefined ||
      actionRun.locked_until <= now ||
      (record.action_claim_token_hash !== undefined &&
        codexCredentialPayloadDigest(actionRun.claim_token) !== record.action_claim_token_hash) ||
      (record.precondition_fingerprint !== undefined && actionRun.precondition_fingerprint !== record.precondition_fingerprint) ||
      (record.action_type !== undefined && actionRun.action_type !== record.action_type) ||
      (record.action_attempt !== undefined && actionRun.attempt !== record.action_attempt) ||
      !automationScopeMatchesCodexTarget(actionRun.automation_scope, record.project_id, record.repo_id)
    ) {
      return false;
    }
    return true;
  }

  private async codexRunExecutionFenceIsActive(record: CodexLaunchLeaseDbRecord, now: string): Promise<boolean> {
    const runWorkerLease =
      record.run_worker_lease_id === undefined
        ? undefined
        : await this.getById<RunWorkerLease>(run_worker_leases, run_worker_leases.id, record.run_worker_lease_id);
    const runSession =
      runWorkerLease === undefined ? undefined : await this.getById<RunSession>(run_sessions, run_sessions.id, runWorkerLease.run_session_id);
    const executionPackage =
      record.execution_package_id === undefined
        ? undefined
        : await this.getById<ExecutionPackage>(execution_packages, execution_packages.id, record.execution_package_id);
    if (
      runWorkerLease === undefined ||
      runWorkerLease.status !== 'active' ||
      runWorkerLease.expires_at <= now ||
      (record.run_worker_lease_token_hash !== undefined &&
        codexCredentialPayloadDigest(runWorkerLease.lease_token) !== record.run_worker_lease_token_hash) ||
      runSession === undefined ||
      record.target_id !== runSession.id ||
      runSession.execution_package_id !== record.execution_package_id ||
      (record.run_session_status !== undefined && runSession.status !== record.run_session_status) ||
      (record.run_session_updated_at !== undefined && runSession.updated_at !== record.run_session_updated_at) ||
      executionPackage === undefined ||
      executionPackage.project_id !== record.project_id ||
      executionPackage.repo_id !== record.repo_id ||
      (record.execution_package_version !== undefined && executionPackage.version !== record.execution_package_version)
    ) {
      return false;
    }
    return true;
  }

  private codexFenceCondition(column: AnyPgColumn, value: string | number | undefined) {
    return value === undefined ? isNull(column) : or(isNull(column), eq(column, value as never));
  }

  private async setAutomationProjectSettingsUnlocked(
    input: SetAutomationProjectSettingsInput,
  ): Promise<AutomationProjectSettings> {
    assertAutomationCapabilityActor(input.actor);
    const current = await this.resolveAutomationProjectSettings(input);
    if (current.version !== input.expected_version) {
      throw new DomainError('INVALID_TRANSITION', `Automation settings version mismatch for ${input.project_id}`);
    }
    const capabilities = automationCapabilitiesForPreset(input.preset);
    const settings: AutomationProjectSettings = {
      id: current.id.startsWith('default:') ? input.id : current.id,
      project_id: input.project_id,
      ...(input.repo_id === undefined ? {} : { repo_id: input.repo_id }),
      preset: input.preset,
      capabilities_json: capabilities,
      capability_fingerprint: capabilityFingerprint(capabilities),
      scope_type: input.scope_type,
      version: current.version + 1,
      enabled_by: input.actor.actor_id,
      enabled_at: input.now,
      updated_by: input.actor.actor_id,
      updated_at: input.now,
      reason: input.reason,
      evidence_refs: input.evidence_refs,
    };
    await this.upsert(automation_project_settings, automation_project_settings.id, settings);
    return settings;
  }

  private async requestManualPathHoldUnlocked(input: RequestManualPathHoldInput): Promise<ManualPathHold> {
    const [existingReplay] = await this.db
      .select()
      .from(manual_path_hold_idempotency_records)
      .where(eq(manual_path_hold_idempotency_records.idempotencyKey, input.idempotency_key))
      .limit(1);
    if (existingReplay !== undefined) {
      const replayed = await this.getById<ManualPathHold>(manual_path_holds, manual_path_holds.id, existingReplay.holdId);
      if (replayed !== undefined) {
        return replayed;
      }
    }
    if (input.source_automation_action_id !== undefined) {
      const replayed = await this.manualPathHoldBySourceAction(input.source_automation_action_id);
      if (replayed !== undefined) {
        await this.db
          .insert(manual_path_hold_idempotency_records)
          .values({ idempotencyKey: input.idempotency_key, holdId: replayed.id })
          .onConflictDoUpdate({
            target: manual_path_hold_idempotency_records.idempotencyKey,
            set: { holdId: replayed.id },
          });
        return replayed;
      }
    }

    this.assertManualScopeKey(input);
    const [existingActive] = await this.db
      .select()
      .from(manual_path_holds)
      .where(
        and(
          eq(manual_path_holds.objectType, input.object_type),
          eq(manual_path_holds.objectId, input.object_id),
          eq(manual_path_holds.scopeKey, input.scope_key),
          eq(manual_path_holds.status, 'active'),
        ),
      )
      .limit(1);
    if (existingActive !== undefined) {
      throw new DomainError('INVALID_TRANSITION', `Active manual hold already exists for ${input.scope_key}`);
    }

    const hold: ManualPathHold = {
      id: input.id,
      object_type: input.object_type,
      object_id: input.object_id,
      scope_key: input.scope_key,
      status: 'active',
      reason_code: input.reason_code,
      reason: input.reason,
      ...(input.source_automation_action_id === undefined
        ? {}
        : { source_automation_action_id: input.source_automation_action_id }),
      evidence_refs: input.evidence_refs,
      requested_by: input.requested_by,
      requested_at: input.requested_at,
      ...(input.metadata_json === undefined ? {} : { metadata_json: input.metadata_json }),
    };
    await this.upsert(manual_path_holds, manual_path_holds.id, hold);
    await this.db
      .insert(manual_path_hold_idempotency_records)
      .values({ idempotencyKey: input.idempotency_key, holdId: hold.id })
      .onConflictDoUpdate({
        target: manual_path_hold_idempotency_records.idempotencyKey,
        set: { holdId: hold.id },
      });
    return hold;
  }

  private async claimCommandIdempotencyUnlocked(
    input: ClaimCommandIdempotencyInput,
  ): Promise<CommandIdempotencyRecord> {
    const existing = await this.commandIdempotencyByKey(input.idempotency_key);
    if (existing !== undefined) {
      this.assertCommandIdempotencyMatches(existing, input);
      if (terminalCommandStatuses.has(existing.status)) {
        return existing;
      }
      if (existing.status === 'running' && existing.locked_until !== undefined && existing.locked_until > input.now) {
        throw new DomainError('INVALID_TRANSITION', `Command ${input.idempotency_key} already has an active claim`);
      }
    }
    const record: CommandIdempotencyRecord = {
      id: existing?.id ?? input.id,
      command_name: input.command_name,
      idempotency_key: input.idempotency_key,
      target_object_type: input.target_object_type,
      target_object_id: input.target_object_id,
      ...(input.target_revision_id === undefined ? {} : { target_revision_id: input.target_revision_id }),
      ...(input.target_version === undefined ? {} : { target_version: input.target_version }),
      ...(input.precondition_json === undefined ? {} : { precondition_json: input.precondition_json }),
      ...(input.precondition_fingerprint === undefined
        ? {}
        : { precondition_fingerprint: input.precondition_fingerprint }),
      ...(input.actor_scope === undefined ? {} : { actor_scope: input.actor_scope, created_by: input.actor_scope }),
      status: 'running',
      locked_until: input.locked_until,
      last_heartbeat_at: input.now,
      claim_token: input.claim_token,
      started_at: input.now,
      created_at: existing?.created_at ?? input.now,
      updated_at: input.now,
    };
    const dbRecord = toDbRecord(record, command_idempotency_records);
    await this.db
      .insert(command_idempotency_records)
      .values(dbRecord as never)
      .onConflictDoUpdate({
        target: command_idempotency_records.idempotencyKey,
        set: dbRecord as never,
      });
    return record;
  }

  private async claimExecutionPackageGenerationRunUnlocked(
    input: ClaimExecutionPackageGenerationRunInput,
  ): Promise<ExecutionPackageGenerationRun> {
    const existing = await this.generationRunFor(input.plan_revision_id, input.generation_key);
    if (existing !== undefined) {
      if (
        existing.manifest_digest !== input.manifest_digest ||
        existing.policy_digest !== input.policy_digest ||
        existing.generator_version !== input.generator_version ||
        existing.expected_package_count !== input.expected_package_count ||
        JSON.stringify(existing.expected_package_keys ?? []) !== JSON.stringify(input.expected_package_keys ?? [])
      ) {
        throw new DomainError('INVALID_TRANSITION', `Package generation manifest drift for ${input.generation_key}`);
      }
      if (existing.status === 'running' && existing.locked_until !== undefined && existing.locked_until <= input.now) {
        const reclaimed: ExecutionPackageGenerationRun = {
          ...existing,
          claim_token: input.claim_token,
          locked_until: input.locked_until,
          last_heartbeat_at: input.now,
          ...(input.evidence_refs === undefined ? {} : { evidence_refs: input.evidence_refs.map((ref) => ({ ...ref })) }),
          updated_at: input.now,
        };
        await this.upsert(execution_package_generation_runs, execution_package_generation_runs.executionPackageSetId, reclaimed);
        return reclaimed;
      }
      if (existing.status === 'running') {
        throw new DomainError('INVALID_TRANSITION', `Package generation ${input.generation_key} already has an active claim`);
      }
      return existing;
    }
    const [currentSucceeded] = await this.db
      .select()
      .from(execution_package_generation_runs)
      .where(
        and(
          eq(execution_package_generation_runs.planRevisionId, input.plan_revision_id),
          eq(execution_package_generation_runs.status, 'succeeded'),
        ),
      )
      .limit(1);
    if (currentSucceeded !== undefined) {
      throw new DomainError('INVALID_TRANSITION', `Plan revision ${input.plan_revision_id} already has current generation`);
    }
    const run: ExecutionPackageGenerationRun = {
      execution_package_set_id: `generation:${input.plan_revision_id}:${input.generation_key}`,
      plan_revision_id: input.plan_revision_id,
      generation_key: input.generation_key,
      version: 0,
      ...(input.generator_version === undefined ? {} : { generator_version: input.generator_version }),
      ...(input.policy_digest === undefined ? {} : { policy_digest: input.policy_digest }),
      ...(input.manifest_digest === undefined ? {} : { manifest_digest: input.manifest_digest }),
      ...(input.expected_package_count === undefined ? {} : { expected_package_count: input.expected_package_count }),
      ...(input.expected_package_keys === undefined ? {} : { expected_package_keys: [...input.expected_package_keys] }),
      ...(input.evidence_refs === undefined ? {} : { evidence_refs: input.evidence_refs.map((ref) => ({ ...ref })) }),
      status: 'running',
      locked_until: input.locked_until,
      last_heartbeat_at: input.now,
      claim_token: input.claim_token,
      created_at: input.now,
      updated_at: input.now,
    };
    await this.upsert(execution_package_generation_runs, execution_package_generation_runs.executionPackageSetId, run);
    return run;
  }

  private async completeExecutionPackageGenerationRunUnlocked(
    input: CompleteExecutionPackageGenerationRunInput,
  ): Promise<ExecutionPackageGenerationRun> {
    const run = await this.claimedGenerationRun(input.execution_package_set_id, input.claim_token);
    if (run.plan_revision_id !== input.plan_revision_id) {
      throw new DomainError('INVALID_TRANSITION', `Package generation ${input.execution_package_set_id} plan mismatch`);
    }
    await this.assertGenerationPackageManifestComplete(run);
    const completed: ExecutionPackageGenerationRun = {
      ...run,
      status: 'succeeded',
      version: run.version + 1,
      ...(input.result_json === undefined ? {} : { result_json: input.result_json }),
      completed_at: input.completed_at,
      updated_at: input.completed_at,
    };
    await this.upsert(execution_package_generation_runs, execution_package_generation_runs.executionPackageSetId, completed);
    return completed;
  }

  private async createOrReplayAutomationActionRunUnlocked(
    input: CreateOrReplayAutomationActionRunInput,
  ): Promise<AutomationActionRun> {
    if (input.action_type === 'project_runtime_snapshot') {
      this.assertProjectionAutomationScope(input.automation_scope, input.action_input_json.repo_id);
    }
    const existing = await this.automationActionRunByIdempotencyKey(input.idempotency_key);
    if (existing !== undefined) {
      this.assertAutomationActionReplayMatches(existing, input);
      return redactAutomationActionClaim(existing);
    }
    await this.assertAutomationActionIdIsUnused(input.id, input.idempotency_key);

    const actionRun: AutomationActionRun = {
      id: input.id,
      action_type: input.action_type,
      target_object_type: input.target_object_type,
      target_object_id: input.target_object_id,
      ...(input.target_revision_id === undefined ? {} : { target_revision_id: input.target_revision_id }),
      ...(input.target_version === undefined ? {} : { target_version: input.target_version }),
      target_status: input.target_status,
      idempotency_key: input.idempotency_key,
      automation_scope: input.automation_scope,
      automation_settings_version: input.automation_settings_version,
      capability_fingerprint: input.capability_fingerprint,
      precondition_fingerprint: input.precondition_fingerprint,
      action_input_json: input.action_input_json,
      ...(input.workflow_id === undefined ? {} : { workflow_id: input.workflow_id }),
      ...(input.codex_session_id === undefined ? {} : { codex_session_id: input.codex_session_id }),
      ...(input.codex_session_turn_id === undefined ? {} : { codex_session_turn_id: input.codex_session_turn_id }),
      status: 'pending',
      attempt: 0,
      ...(input.created_by === undefined ? {} : { created_by: input.created_by }),
      created_at: input.now,
      updated_at: input.now,
    };
    await this.upsert(automation_action_runs, automation_action_runs.id, actionRun);
    return actionRun;
  }

  private async claimNextAutomationActionRunUnlocked(
    input: ClaimNextAutomationActionRunInput,
  ): Promise<AutomationActionRun | undefined> {
    const filterPredicate = this.automationActionClaimFilterPredicate(input);
    const claimablePredicate = this.claimableAutomationActionPredicate(input.now);
    const wherePredicate = filterPredicate === undefined ? claimablePredicate : and(claimablePredicate, filterPredicate);
    const rows = await this.db
      .select()
      .from(automation_action_runs)
      .where(wherePredicate)
      .orderBy(
        sql`coalesce(${automation_action_runs.nextAttemptAt}, ${automation_action_runs.createdAt})`,
        sql`case when ${automation_action_runs.actionType} = 'project_runtime_snapshot' then 1 else 0 end`,
        asc(automation_action_runs.createdAt),
        asc(automation_action_runs.id),
      )
      .limit(input.limit);

    for (const row of rows) {
      const actionRun = fromDbRecord<AutomationActionRun>(row);
      if (!this.matchesAutomationActionClaimFilter(actionRun, input)) {
        continue;
      }
      const claimed = this.toRunningAutomationActionRun(actionRun, {
        claim_token: input.claim_token,
        locked_until: input.locked_until,
        now: input.now,
      });
      const [updated] = await this.db
        .update(automation_action_runs)
        .set(toDbRecord(claimed, automation_action_runs) as never)
        .where(and(eq(automation_action_runs.id, actionRun.id), this.claimableAutomationActionPredicate(input.now)))
        .returning();
      if (updated !== undefined) {
        return fromDbRecord<AutomationActionRun>(updated);
      }
    }

    return undefined;
  }

  private async claimAutomationActionRunUnlocked(input: ClaimAutomationActionRunInput): Promise<AutomationActionRun> {
    if (input.precondition_fingerprint === undefined || input.action_input_json === undefined) {
      throw new DomainError(
        'INVALID_TRANSITION',
        `Automation action ${input.idempotency_key} requires precondition fingerprint and action input`,
      );
    }
    const existing = await this.automationActionRunByIdempotencyKey(input.idempotency_key);
    if (existing !== undefined) {
      this.assertAutomationActionIdentityMatches(existing, input);
      if (existing.status === 'running' && existing.claim_token === input.claim_token) {
        const renewed: AutomationActionRun = {
          ...existing,
          locked_until: input.locked_until,
          last_heartbeat_at: input.now,
          updated_at: input.now,
        };
        await this.upsert(automation_action_runs, automation_action_runs.id, renewed);
        return renewed;
      }
      if (!this.isAutomationActionClaimable(existing, input.now)) {
        if (existing.status === 'running') {
          throw new DomainError('INVALID_TRANSITION', `Automation action ${input.idempotency_key} already has an active claim`);
        }
        return redactAutomationActionClaim(existing);
      }
    } else {
      await this.assertAutomationActionIdIsUnused(input.id, input.idempotency_key);
    }
    const codexSessionTurnId = input.codex_session_turn_id ?? existing?.codex_session_turn_id;
    const actionRun: AutomationActionRun = {
      id: existing?.id ?? input.id,
      action_type: input.action_type,
      target_object_type: input.target_object_type,
      target_object_id: input.target_object_id,
      ...(input.target_revision_id === undefined ? {} : { target_revision_id: input.target_revision_id }),
      ...(input.target_version === undefined ? {} : { target_version: input.target_version }),
      target_status: input.target_status,
      idempotency_key: input.idempotency_key,
      automation_scope: input.automation_scope,
      automation_settings_version: input.automation_settings_version,
      capability_fingerprint: input.capability_fingerprint,
      precondition_fingerprint: input.precondition_fingerprint,
      action_input_json: input.action_input_json,
      ...(existing?.workflow_id === undefined && input.workflow_id === undefined
        ? {}
        : { workflow_id: existing?.workflow_id ?? input.workflow_id }),
      ...(existing?.codex_session_id === undefined && input.codex_session_id === undefined
        ? {}
        : { codex_session_id: existing?.codex_session_id ?? input.codex_session_id }),
      ...(codexSessionTurnId === undefined ? {} : { codex_session_turn_id: codexSessionTurnId }),
      status: 'running',
      claim_token: input.claim_token,
      attempt: (existing?.attempt ?? 0) + 1,
      locked_until: input.locked_until,
      ...(existing?.created_by === undefined ? {} : { created_by: existing.created_by }),
      claimed_at: input.now,
      started_at: existing?.started_at ?? input.now,
      created_at: existing?.created_at ?? input.now,
      updated_at: input.now,
    };
    await this.upsert(automation_action_runs, automation_action_runs.id, actionRun);
    return actionRun;
  }

  private async assertAutomationActionIdIsUnused(id: string, idempotencyKey: string): Promise<void> {
    const existing = await this.getById<AutomationActionRun>(automation_action_runs, automation_action_runs.id, id);
    if (existing !== undefined && existing.idempotency_key !== idempotencyKey) {
      throw new DomainError(
        'INVALID_TRANSITION',
        `Automation action ${id} already exists with a different idempotency key`,
      );
    }
  }

  private toRunningAutomationActionRun(
    actionRun: AutomationActionRun,
    input: { claim_token: string; locked_until: string; now: string },
  ): AutomationActionRun {
    return {
      id: actionRun.id,
      action_type: actionRun.action_type,
      target_object_type: actionRun.target_object_type,
      target_object_id: actionRun.target_object_id,
      ...(actionRun.target_revision_id === undefined ? {} : { target_revision_id: actionRun.target_revision_id }),
      ...(actionRun.target_version === undefined ? {} : { target_version: actionRun.target_version }),
      target_status: actionRun.target_status,
      idempotency_key: actionRun.idempotency_key,
      automation_scope: actionRun.automation_scope,
      automation_settings_version: actionRun.automation_settings_version,
      capability_fingerprint: actionRun.capability_fingerprint,
      precondition_fingerprint: actionRun.precondition_fingerprint,
      action_input_json: actionRun.action_input_json,
      ...(actionRun.workflow_id === undefined ? {} : { workflow_id: actionRun.workflow_id }),
      ...(actionRun.codex_session_id === undefined ? {} : { codex_session_id: actionRun.codex_session_id }),
      ...(actionRun.codex_session_turn_id === undefined ? {} : { codex_session_turn_id: actionRun.codex_session_turn_id }),
      status: 'running',
      claim_token: input.claim_token,
      attempt: actionRun.attempt + 1,
      locked_until: input.locked_until,
      ...(actionRun.created_by === undefined ? {} : { created_by: actionRun.created_by }),
      claimed_at: input.now,
      started_at: actionRun.started_at ?? input.now,
      ...(actionRun.created_at === undefined ? {} : { created_at: actionRun.created_at }),
      updated_at: input.now,
    };
  }

  private assertCommandIdempotencyMatches(
    existing: CommandIdempotencyRecord,
    input: ClaimCommandIdempotencyInput,
  ): void {
    const mismatched =
      existing.command_name !== input.command_name ||
      existing.target_object_type !== input.target_object_type ||
      existing.target_object_id !== input.target_object_id ||
      existing.target_revision_id !== input.target_revision_id ||
      existing.target_version !== input.target_version ||
      existing.precondition_fingerprint !== input.precondition_fingerprint ||
      existing.actor_scope !== input.actor_scope;
    if (mismatched) {
      throw new DomainError(
        'INVALID_TRANSITION',
        `Command ${input.idempotency_key} idempotency identity or precondition fingerprint changed`,
      );
    }
  }

  private assertAutomationActionIdentityMatches(existing: AutomationActionRun, input: ClaimAutomationActionRunInput): void {
    const existingWorkflowOwned = existing.workflow_id !== undefined || existing.codex_session_id !== undefined;
    const inputWorkflowOwned = input.workflow_id !== undefined || input.codex_session_id !== undefined;
    const workflowContextMismatched =
      existingWorkflowOwned || inputWorkflowOwned
        ? existing.workflow_id !== input.workflow_id || existing.codex_session_id !== input.codex_session_id
        : existing.codex_session_turn_id !== input.codex_session_turn_id;
    const mismatched =
      existing.action_type !== input.action_type ||
      existing.target_object_type !== input.target_object_type ||
      existing.target_object_id !== input.target_object_id ||
      existing.target_revision_id !== input.target_revision_id ||
      existing.target_version !== input.target_version ||
      existing.target_status !== input.target_status ||
      existing.automation_scope !== input.automation_scope ||
      existing.automation_settings_version !== input.automation_settings_version ||
      existing.capability_fingerprint !== input.capability_fingerprint ||
      existing.precondition_fingerprint !== input.precondition_fingerprint ||
      workflowContextMismatched ||
      !valuesEqual(existing.action_input_json, input.action_input_json);
    if (mismatched) {
      throw new DomainError('INVALID_TRANSITION', `Automation action ${input.idempotency_key} identity changed`);
    }
  }

  private assertAutomationActionReplayMatches(
    existing: AutomationActionRun,
    input: CreateOrReplayAutomationActionRunInput,
  ): void {
    if (existing.action_type === 'project_runtime_snapshot' || input.action_type === 'project_runtime_snapshot') {
      if (existing.action_type === 'project_runtime_snapshot') {
        this.assertProjectionAutomationScope(existing.automation_scope, existing.action_input_json.repo_id);
      }
      if (input.action_type === 'project_runtime_snapshot') {
        this.assertProjectionAutomationScope(input.automation_scope, input.action_input_json.repo_id);
      }
      const mismatched =
        existing.action_type !== input.action_type ||
        existing.automation_scope !== input.automation_scope ||
        !valuesEqual(
          stablePolicyObservationIdentity(existing.action_input_json),
          stablePolicyObservationIdentity(input.action_input_json),
        );
      if (mismatched) {
        throw new DomainError(
          'INVALID_TRANSITION',
          `Automation action ${input.idempotency_key} project_runtime_snapshot identity changed`,
        );
      }
      return;
    }

    const existingWorkflowOwned = existing.workflow_id !== undefined || existing.codex_session_id !== undefined;
    const inputWorkflowOwned = input.workflow_id !== undefined || input.codex_session_id !== undefined;
    const workflowContextMismatched =
      existingWorkflowOwned || inputWorkflowOwned
        ? existing.workflow_id !== input.workflow_id || existing.codex_session_id !== input.codex_session_id
        : existing.codex_session_turn_id !== input.codex_session_turn_id;
    const mismatched =
      existing.action_type !== input.action_type ||
      existing.target_object_type !== input.target_object_type ||
      existing.target_object_id !== input.target_object_id ||
      existing.target_revision_id !== input.target_revision_id ||
      existing.target_version !== input.target_version ||
      existing.target_status !== input.target_status ||
      existing.automation_scope !== input.automation_scope ||
      existing.automation_settings_version !== input.automation_settings_version ||
      existing.capability_fingerprint !== input.capability_fingerprint ||
      existing.precondition_fingerprint !== input.precondition_fingerprint ||
      workflowContextMismatched ||
      !valuesEqual(existing.action_input_json, input.action_input_json);
    if (mismatched) {
      throw new DomainError(
        'INVALID_TRANSITION',
        `Automation action ${input.idempotency_key} idempotency identity, precondition, or action input changed`,
      );
    }
  }

  private stablePolicyObservationIdentityMatches(
    actionInputJson: Record<string, unknown>,
    input: LatestCompletedProjectionActionRunInput,
  ): boolean {
    this.assertProjectionAutomationScope(input.automation_scope, input.repo_id);
    const stableIdentity = stablePolicyObservationIdentity(actionInputJson);
    return (
      stableIdentity.repo_id === input.repo_id &&
      stableIdentity.policy_status === input.policy_status &&
      stableIdentity.policy_digest === input.policy_digest &&
      stableIdentity.parser_version === input.parser_version &&
      stableIdentity.reason_code === input.reason_code
    );
  }

  private assertProjectionAutomationScope(automationScope: string, repoId: unknown): void {
    const scopeRepoId = repoAutomationScopeRepoId(automationScope);
    if (scopeRepoId === undefined || repoId !== scopeRepoId) {
      throw new DomainError('INVALID_TRANSITION', `Projection action requires matching repo automation scope`);
    }
  }

  private matchesAutomationActionClaimFilter(
    actionRun: AutomationActionRun,
    input: ClaimNextAutomationActionRunInput,
  ): boolean {
    if (input.action_type !== undefined && actionRun.action_type !== input.action_type) {
      return false;
    }
    if (input.automation_scope !== undefined && actionRun.automation_scope !== input.automation_scope) {
      return false;
    }
    const scope = automationScopeParts(actionRun.automation_scope);
    if (input.project_id !== undefined && scope.projectId !== input.project_id) {
      return false;
    }
    if (input.repo_id !== undefined && scope.repoId !== input.repo_id) {
      return false;
    }
    return true;
  }

  private claimableAutomationActionPredicate(now: string) {
    return or(
      eq(automation_action_runs.status, 'pending'),
      and(
        eq(automation_action_runs.status, 'gate_pending'),
        or(sql`${automation_action_runs.nextAttemptAt} is null`, sql`${automation_action_runs.nextAttemptAt} <= ${now}`),
      ),
      and(
        or(eq(automation_action_runs.status, 'blocked'), eq(automation_action_runs.status, 'failed')),
        eq(automation_action_runs.retryable, true),
        or(sql`${automation_action_runs.nextAttemptAt} is null`, sql`${automation_action_runs.nextAttemptAt} <= ${now}`),
      ),
      and(eq(automation_action_runs.status, 'running'), sql`${automation_action_runs.lockedUntil} <= ${now}`),
    );
  }

  private automationActionClaimFilterPredicate(input: ClaimNextAutomationActionRunInput) {
    const predicates = [];
    if (input.action_type !== undefined) {
      predicates.push(eq(automation_action_runs.actionType, input.action_type));
    }
    if (input.automation_scope !== undefined) {
      predicates.push(eq(automation_action_runs.automationScope, input.automation_scope));
    }
    if (input.project_id !== undefined && input.repo_id !== undefined) {
      predicates.push(eq(automation_action_runs.automationScope, `repo:${input.project_id}:${input.repo_id}`));
    } else if (input.project_id !== undefined) {
      predicates.push(
        or(
          eq(automation_action_runs.automationScope, `project:${input.project_id}`),
          sql`${automation_action_runs.automationScope} like ${`repo:${input.project_id}:%`}`,
        ),
      );
    } else if (input.repo_id !== undefined) {
      predicates.push(sql`${automation_action_runs.automationScope} like ${`repo:%:${input.repo_id}`}`);
    }
    return predicates.length === 0 ? undefined : and(...predicates);
  }

  private compareAutomationActionRecency(left: AutomationActionRun, right: AutomationActionRun): number {
    return (
      compareTimestamp(right.finished_at ?? right.updated_at ?? right.created_at, left.finished_at ?? left.updated_at ?? left.created_at) ||
      right.id.localeCompare(left.id)
    );
  }

  private async runtimeSnapshotPlanRevisionsRequiringPackages(
    plansToEvaluate: Plan[],
    repos: ProjectRepo[],
    planRevisionsById: Map<string, PlanRevision>,
    workItemsById: Map<string, WorkItem>,
    specsById: Map<string, Spec>,
    specRevisionsById: Map<string, SpecRevision>,
    generationRuns: ExecutionPackageGenerationRun[],
    holds: ManualPathHold[],
    settingsByScope: Map<string, AutomationProjectSettings>,
  ): Promise<RuntimeSnapshotTargetRow[]> {
    const targets: RuntimeSnapshotTargetRow[] = [];
    for (const plan of plansToEvaluate) {
      if (
        plan.status !== 'approved' ||
        plan.resolution !== 'approved' ||
        plan.approved_revision_id === undefined ||
        plan.current_revision_id !== plan.approved_revision_id
      ) {
        continue;
      }
      const planRevisionId = plan.approved_revision_id;
      if (this.hasCurrentPackageGeneration(generationRuns, planRevisionId)) {
        continue;
      }
      const planRevision = planRevisionsById.get(planRevisionId);
      const workItem = planRevision === undefined ? undefined : workItemsById.get(planRevision.work_item_id);
      if (planRevision === undefined || workItem === undefined || isWorkItemAutomationTerminal(workItem)) {
        continue;
      }
      if (plan.work_item_id !== workItem.id || planRevision.plan_id !== plan.id) {
        continue;
      }
      if (
        workItem.current_plan_id !== plan.id ||
        (workItem.current_plan_revision_id !== undefined && workItem.current_plan_revision_id !== planRevisionId)
      ) {
        continue;
      }
      if (workItem.current_spec_id === undefined) {
        continue;
      }
      const spec = specsById.get(workItem.current_spec_id);
      if (
        spec === undefined ||
        spec.work_item_id !== workItem.id ||
        spec.status !== 'approved' ||
        spec.resolution !== 'approved' ||
        spec.approved_revision_id === undefined ||
        spec.current_revision_id !== spec.approved_revision_id ||
        (workItem.current_spec_revision_id !== undefined && workItem.current_spec_revision_id !== spec.approved_revision_id) ||
        planRevision.based_on_spec_revision_id !== spec.approved_revision_id
      ) {
        continue;
      }
      const specRevision = specRevisionsById.get(spec.approved_revision_id);
      if (specRevision === undefined || specRevision.spec_id !== spec.id || specRevision.work_item_id !== workItem.id) {
        continue;
      }
      const targetScope = this.runtimeSnapshotDraftTargetScope(
        repos,
        workItem.project_id,
        'canGeneratePackageDrafts',
        settingsByScope,
      );
      if (targetScope === undefined) {
        continue;
      }
      const generationKey = `default:${planRevisionId}`;
      if (
        this.hasActiveManualHold(holds, [
          `work_item:${workItem.id}`,
          `spec_revision:${planRevision.based_on_spec_revision_id}`,
          `plan_revision:${planRevisionId}`,
          `package_generation:${planRevisionId}:${generationKey}`,
        ])
      ) {
        continue;
      }
      targets.push({
        target_object_type: 'plan_revision',
        target_object_id: planRevisionId,
        target_revision_id: generationKey,
        target_status: 'approved',
        project_id: workItem.project_id,
        ...targetScope,
        generation_key: generationKey,
      });
    }
    return targets;
  }

  private runtimeSnapshotDraftTargetScope(
    repos: ProjectRepo[],
    projectId: string,
    capability: 'canGeneratePackageDrafts',
    settingsByScope: Map<string, AutomationProjectSettings>,
  ): Pick<RuntimeSnapshotTargetRow, 'repo_id' | 'eligible_repo_ids' | 'automation_scope'> | undefined {
    const eligibleReposById = new Map<string, ProjectRepo>();
    for (const repo of repos) {
      if (repo.project_id !== projectId) {
        continue;
      }
      const settings = this.resolvePreloadedAutomationProjectSettings(settingsByScope, {
        project_id: projectId,
        repo_id: repo.repo_id,
      });
      if (settings.capabilities_json[capability]) {
        eligibleReposById.set(repo.repo_id, eligibleReposById.get(repo.repo_id) ?? repo);
      }
    }
    const eligibleRepos = [...eligibleReposById.values()];
    if (eligibleRepos.length === 0) {
      return undefined;
    }
    if (eligibleRepos.length === 1) {
      const repo = eligibleRepos[0]!;
      return { repo_id: repo.repo_id, automation_scope: `repo:${projectId}:${repo.repo_id}` as const };
    }
    return {
      eligible_repo_ids: eligibleRepos.map((repo) => repo.repo_id),
      automation_scope: `project:${projectId}` as const,
    };
  }

  private runtimeSnapshotRunEnqueueDisabledPackages(
    executionPackages: ExecutionPackage[],
    repos: ProjectRepo[],
    runSessionsByPackage: Map<string, RunSession[]> = new Map(),
  ): RuntimeSnapshotTargetRow[] {
    return executionPackages
      .filter(
        (executionPackage) =>
          executionPackage.phase === 'ready' &&
          repos.some((repo) => repo.project_id === executionPackage.project_id && repo.repo_id === executionPackage.repo_id),
      )
      .map((executionPackage) => ({
        target_object_type: 'execution_package',
        target_object_id: executionPackage.id,
        target_revision_id: executionPackage.plan_revision_id,
        target_status: executionPackage.phase,
        project_id: executionPackage.project_id,
        repo_id: executionPackage.repo_id,
        automation_scope: `repo:${executionPackage.project_id}:${executionPackage.repo_id}` as const,
        disabled_reason: 'run_enqueue_disabled_by_scope',
        ...runtimeSnapshotBlockerFieldsFor(
          runtimeSnapshotBlockersForExecutionPackage(executionPackage, runSessionsByPackage.get(executionPackage.id) ?? []),
        ),
      }));
  }

  private runtimeSnapshotActiveHolds(holds: ManualPathHold[]) {
    return holds.map((hold) => ({
      object_type: hold.object_type,
      object_id: hold.object_id,
      scope_key: hold.scope_key,
      reason_code: hold.reason_code,
      status: hold.status,
      requested_at: hold.requested_at,
      ...(hold.resolved_at === undefined ? {} : { resolved_at: hold.resolved_at }),
      fingerprint: `${hold.scope_key}:${hold.reason_code}`,
    }));
  }

  private hasCurrentPackageGeneration(generationRuns: ExecutionPackageGenerationRun[], planRevisionId: string): boolean {
    return generationRuns.some(
      (run) => run.plan_revision_id === planRevisionId && (run.status === 'pending' || run.status === 'running' || run.status === 'succeeded'),
    );
  }

  private hasActiveManualHold(holds: ManualPathHold[], scopeKeys: string[]): boolean {
    const scopeKeySet = new Set(scopeKeys);
    return holds.some((hold) => hold.status === 'active' && scopeKeySet.has(hold.scope_key));
  }

  private applyLatestMatchingActionFields(
    targets: RuntimeSnapshotTargetRow[],
    latestMatchingActionFields: Map<
      string,
      Pick<RuntimeSnapshotTargetRow, 'latest_matching_action_status' | 'blocked_reason_code' | 'blocked_summary' | 'blockers'>
    >,
  ): RuntimeSnapshotTargetRow[] {
    return targets.map((target) => ({
      ...target,
      ...latestMatchingActionFields.get(
        this.latestMatchingActionKey(
          this.runtimeSnapshotActionTypeForTarget(target),
          target.target_object_id,
          target.target_revision_id,
        ),
      ),
    }));
  }

  private latestMatchingActionFieldsByTarget(
    actions: AutomationActionRun[],
  ): Map<
    string,
    Pick<RuntimeSnapshotTargetRow, 'latest_matching_action_status' | 'blocked_reason_code' | 'blocked_summary' | 'blockers'>
  > {
    const fieldsByTarget = new Map<
      string,
      Pick<RuntimeSnapshotTargetRow, 'latest_matching_action_status' | 'blocked_reason_code' | 'blocked_summary' | 'blockers'>
    >();
    for (const actionRun of actions) {
      const key = this.latestMatchingActionKey(actionRun.action_type, actionRun.target_object_id, actionRun.target_revision_id);
      if (!fieldsByTarget.has(key)) {
        fieldsByTarget.set(key, this.latestMatchingActionFields(actionRun));
      }
    }
    return fieldsByTarget;
  }

  private latestMatchingActionFields(
    actionRun: AutomationActionRun | undefined,
  ): Pick<RuntimeSnapshotTargetRow, 'latest_matching_action_status' | 'blocked_reason_code' | 'blocked_summary' | 'blockers'> {
    if (actionRun === undefined) {
      return {};
    }
    return {
      latest_matching_action_status: actionRun.status,
      ...runtimeSnapshotBlockerFieldsFor(runtimeSnapshotBlockersForActionRun(actionRun)),
    };
  }

  private runtimeSnapshotActionTypeForTarget(_target: RuntimeSnapshotTargetRow): 'ensure_package_drafts' {
    return 'ensure_package_drafts';
  }

  private latestMatchingActionKey(actionType: string, targetObjectId: string, targetRevisionId?: string): string {
    return `${actionType}:${targetObjectId}:${targetRevisionId ?? '<none>'}`;
  }

  private isAutomationActionClaimable(actionRun: AutomationActionRun, now: string): boolean {
    if (actionRun.status === 'pending') {
      return true;
    }
    if (actionRun.status === 'running') {
      return timestampAtOrBefore(actionRun.locked_until, now);
    }
    if (actionRun.status === 'gate_pending') {
      return actionRun.next_attempt_at === undefined || timestampAtOrBefore(actionRun.next_attempt_at, now);
    }
    if (actionRun.status === 'blocked' || actionRun.status === 'failed') {
      return actionRun.retryable === true && (actionRun.next_attempt_at === undefined || timestampAtOrBefore(actionRun.next_attempt_at, now));
    }
    return false;
  }

  private assertGenerationPackageManifestComplete(run: ExecutionPackageGenerationRun): Promise<void> {
    return (async () => {
      const packages = await this.listWhere<ExecutionPackageGenerationPackageRecord>(
        execution_package_generation_packages,
        eq(execution_package_generation_packages.executionPackageSetId, run.execution_package_set_id),
        [execution_package_generation_packages.sequence, execution_package_generation_packages.packageKey],
      );
      if (run.expected_package_count !== undefined && packages.length !== run.expected_package_count) {
        throw new DomainError('INVALID_TRANSITION', `Package generation ${run.execution_package_set_id} package count mismatch`);
      }
      if (run.expected_package_keys !== undefined) {
        const packageKeys = packages.map((record) => record.package_key);
        if (JSON.stringify(packageKeys) !== JSON.stringify(run.expected_package_keys)) {
          throw new DomainError('INVALID_TRANSITION', `Package generation ${run.execution_package_set_id} package key mismatch`);
        }
      }
      if (run.manifest_digest !== undefined && packages.some((record) => record.manifest_digest !== run.manifest_digest)) {
        throw new DomainError('INVALID_TRANSITION', `Package generation ${run.execution_package_set_id} manifest mismatch`);
      }
    })();
  }

  private async manualPathHoldBySourceAction(sourceAutomationActionId: string): Promise<ManualPathHold | undefined> {
    const [row] = await this.db
      .select()
      .from(manual_path_holds)
      .where(eq(manual_path_holds.sourceAutomationActionId, sourceAutomationActionId))
      .limit(1);
    return row === undefined ? undefined : fromDbRecord<ManualPathHold>(row);
  }

  private manualPathHoldLockKeys(input: RequestManualPathHoldInput): string[] {
    return [
      `manual-hold-idem:${input.idempotency_key}`,
      ...(input.source_automation_action_id === undefined ? [] : [`manual-hold-source:${input.source_automation_action_id}`]),
    ];
  }

  private automationSettingsKey(projectId: string, repoId: string | undefined): string {
    return repoId === undefined ? `project:${projectId}` : `repo:${projectId}:${repoId}`;
  }

  private resolvePreloadedAutomationProjectSettings(
    settingsByScope: Map<string, AutomationProjectSettings>,
    input: ResolveAutomationProjectSettingsInput,
  ): AutomationProjectSettings {
    const existing = settingsByScope.get(this.automationSettingsKey(input.project_id, input.repo_id));
    if (existing !== undefined) {
      return {
        ...existing,
        capabilities_json: normalizeAutomationCapabilities(existing.capabilities_json),
      };
    }

    const capabilities = automationCapabilitiesForPreset('off');
    return {
      id: `default:${this.automationSettingsKey(input.project_id, input.repo_id)}`,
      project_id: input.project_id,
      ...(input.repo_id === undefined ? {} : { repo_id: input.repo_id }),
      preset: 'off',
      capabilities_json: capabilities,
      capability_fingerprint: capabilityFingerprint(capabilities),
      scope_type: input.repo_id === undefined ? 'project' : 'repo',
      version: 0,
      evidence_refs: [],
    };
  }

  private supportsSelect(): boolean {
    return typeof (this.db as { select?: unknown }).select === 'function';
  }

  private assertManualScopeKey(input: RequestManualPathHoldInput): void {
    switch (input.object_type) {
      case 'work_item':
      case 'spec_revision':
      case 'plan_revision':
      case 'execution_package':
      case 'run_session':
      case 'review_packet':
        assertCanonicalManualScopeKey(input.scope_key, {
          object_type: input.object_type,
          object_id: input.object_id,
        });
        return;
      case 'package_generation':
        if (input.generation_key === undefined) {
          throw new DomainError('MANUAL_PATH_SCOPE_INVALID', 'Package generation manual hold requires generation_key');
        }
        assertCanonicalManualScopeKey(input.scope_key, {
          object_type: 'package_generation',
          object_id: input.object_id,
          generation_key: input.generation_key,
        });
        return;
      case 'release_gate':
        if (input.gate_key === undefined) {
          throw new DomainError('MANUAL_PATH_SCOPE_INVALID', 'Release gate manual hold requires gate_key');
        }
        assertCanonicalManualScopeKey(input.scope_key, {
          object_type: 'release_gate',
          object_id: input.object_id,
          gate_key: input.gate_key,
        });
        return;
      default:
        throw new DomainError('MANUAL_PATH_SCOPE_INVALID', `Unsupported manual path hold object type ${input.object_type}`);
    }
  }

  private async manualHoldScopeKeysFor(input: ListActiveManualPathHoldsInput): Promise<string[]> {
    const keys = [`${input.object_type}:${input.object_id}`];
    if (input.object_type === 'execution_package') {
      const executionPackage = await this.getExecutionPackage(input.object_id);
      if (executionPackage !== undefined) {
        keys.push(
          `work_item:${executionPackage.work_item_id}`,
          `spec_revision:${executionPackage.spec_revision_id}`,
          `plan_revision:${executionPackage.plan_revision_id}`,
        );
      }
    }
    if (input.object_type === 'package_generation' && input.generation_key !== undefined) {
      keys.push(`package_generation:${input.object_id}:${input.generation_key}`);
    }
    if (input.object_type === 'release_gate') {
      if (input.gate_key !== undefined) {
        keys.push(`release_gate:${input.object_id}:${input.gate_key}`);
      } else {
        const releaseGateHolds = await this.listWhere<ManualPathHold>(
          manual_path_holds,
          and(eq(manual_path_holds.status, 'active'), eq(manual_path_holds.objectType, 'release_gate')),
        );
        keys.push(...releaseGateHolds.filter((hold) => hold.object_id === input.object_id).map((hold) => hold.scope_key));
      }
    }
    if (input.object_type === 'run_session') {
      const runSession = await this.getRunSession(input.object_id);
      if (runSession !== undefined) {
        keys.push(...(await this.manualHoldScopeKeysFor({ object_type: 'execution_package', object_id: runSession.execution_package_id })));
      }
    }
    if (input.object_type === 'review_packet') {
      const reviewPacket = await this.getReviewPacket(input.object_id);
      if (reviewPacket !== undefined) {
        keys.push(
          ...(await this.manualHoldScopeKeysFor({
            object_type: 'execution_package',
            object_id: reviewPacket.execution_package_id,
          })),
        );
      }
    }
    return [...new Set(keys)];
  }

  private async commandIdempotencyByKey(idempotencyKey: string): Promise<CommandIdempotencyRecord | undefined> {
    const [row] = await this.db
      .select()
      .from(command_idempotency_records)
      .where(eq(command_idempotency_records.idempotencyKey, idempotencyKey))
      .limit(1);
    return row === undefined ? undefined : fromDbRecord<CommandIdempotencyRecord>(row);
  }

  private async claimedCommandIdempotency(
    idempotencyKey: string,
    claimToken: string,
  ): Promise<CommandIdempotencyRecord> {
    const record = await this.commandIdempotencyByKey(idempotencyKey);
    if (record === undefined || record.status !== 'running' || record.claim_token !== claimToken) {
      throw new DomainError('INVALID_TRANSITION', `Command idempotency record ${idempotencyKey} is not claimed`);
    }
    return record;
  }

  private async finishCommandIdempotency(
    input: FinishCommandIdempotencyInput,
    status: CommandIdempotencyRecord['status'],
  ): Promise<CommandIdempotencyRecord> {
    const record = await this.claimedCommandIdempotency(input.idempotency_key, input.claim_token);
    const finished: CommandIdempotencyRecord = {
      ...record,
      status,
      ...(input.result_json === undefined ? {} : { result_json: input.result_json }),
      finished_at: input.finished_at,
      updated_at: input.finished_at,
    };
    await this.upsert(command_idempotency_records, command_idempotency_records.id, finished);
    return finished;
  }

  private async generationRunFor(
    planRevisionId: string,
    generationKey: string,
  ): Promise<ExecutionPackageGenerationRun | undefined> {
    const [row] = await this.db
      .select()
      .from(execution_package_generation_runs)
      .where(
        and(
          eq(execution_package_generation_runs.planRevisionId, planRevisionId),
          eq(execution_package_generation_runs.generationKey, generationKey),
        ),
      )
      .limit(1);
    return row === undefined ? undefined : fromDbRecord<ExecutionPackageGenerationRun>(row);
  }

  private async claimedGenerationRun(
    executionPackageSetId: string,
    claimToken: string,
  ): Promise<ExecutionPackageGenerationRun> {
    const run = await this.getById<ExecutionPackageGenerationRun>(
      execution_package_generation_runs,
      execution_package_generation_runs.executionPackageSetId,
      executionPackageSetId,
    );
    if (run === undefined || run.status !== 'running' || run.claim_token !== claimToken) {
      throw new DomainError('INVALID_TRANSITION', `Package generation ${executionPackageSetId} is not claimed`);
    }
    return run;
  }

  private async automationActionRunByIdempotencyKey(idempotencyKey: string): Promise<AutomationActionRun | undefined> {
    const [row] = await this.db
      .select()
      .from(automation_action_runs)
      .where(eq(automation_action_runs.idempotencyKey, idempotencyKey))
      .limit(1);
    return row === undefined ? undefined : fromDbRecord<AutomationActionRun>(row);
  }

  private async claimedAutomationActionRun(id: string, claimToken: string): Promise<AutomationActionRun> {
    const actionRun = await this.getById<AutomationActionRun>(automation_action_runs, automation_action_runs.id, id);
    if (actionRun === undefined || actionRun.status !== 'running' || actionRun.claim_token !== claimToken) {
      throw new DomainError('INVALID_TRANSITION', `Automation action ${id} is not claimed`);
    }
    return actionRun;
  }

  private async lockActiveRunWorkerLease(
    db: ForgeloopDrizzleDatabase,
    runSessionId: string,
    workerId: string,
    leaseToken: string,
    now: string,
  ): Promise<void> {
    const lockResult = await db.execute(sql<Record<string, unknown>>`
      select *
      from run_worker_leases
      where run_session_id = ${runSessionId}
        and worker_id = ${workerId}
        and lease_token = ${leaseToken}
        and status = 'active'
        and expires_at > ${now}
      for update
    `);

    if (lockResult.rows[0] === undefined) {
      throw invalidLease(runSessionId);
    }
  }

  private commandClaimFromRows(
    rows: Record<string, unknown>[],
  ): { command: RunCommand; reclaimed: boolean } | undefined {
    const row = rows[0];
    if (row === undefined) {
      return undefined;
    }

    const { reclaimed, ...commandRow } = row;
    return { command: fromDbRecord<RunCommand>(commandRow), reclaimed: reclaimed === true };
  }

  private async updateFencedRunCommand(
    commandId: string,
    lease: { workerId: string; leaseToken: string },
    now: string,
    setClause: ReturnType<typeof sql>,
  ): Promise<void> {
    const result = await this.db.transaction((tx) =>
      tx.execute(sql<Record<string, unknown>>`
        update run_commands
        set ${setClause}
        where id = ${commandId}
          and status = 'claimed'
          and claimed_by_worker_id = ${lease.workerId}
          and exists (
            select 1
            from run_worker_leases
            where run_worker_leases.run_session_id = run_commands.run_session_id
              and run_worker_leases.worker_id = ${lease.workerId}
              and run_worker_leases.lease_token = ${lease.leaseToken}
              and run_worker_leases.status = 'active'
              and run_worker_leases.expires_at > ${now}
          )
        returning *
      `),
    );

    if (result.rows.length === 0) {
      throw new DomainError('INVALID_TRANSITION', `Run command ${commandId} is not owned by worker ${lease.workerId}`);
    }
  }

  private async fencedLeaseUpdate(
    runSessionId: string,
    workerId: string,
    leaseToken: string,
    now: string,
    setClause: ReturnType<typeof sql>,
  ): Promise<Record<string, unknown>[]> {
    const result = await this.db.transaction((tx) =>
      tx.execute(sql<Record<string, unknown>>`
        update run_worker_leases
        set ${setClause}
        where run_session_id = ${runSessionId}
          and worker_id = ${workerId}
          and lease_token = ${leaseToken}
          and status = 'active'
          and expires_at > ${now}
        returning *
      `),
    );

    return result.rows;
  }

  private async upsert(table: AnyPgTable, target: AnyPgColumn, entity: object): Promise<void> {
    const record = toDbRecord(entity, table);
    await this.db.insert(table).values(record as never).onConflictDoUpdate({
      target,
      set: record as never,
    });
  }

  private async insertImmutable(table: AnyPgTable, entity: object): Promise<void> {
    await this.db.insert(table).values(toDbRecord(entity, table) as never).onConflictDoNothing();
  }

  private async getById<T>(table: AnyPgTable, idColumn: AnyPgColumn, id: string): Promise<T | undefined> {
    const [row] = await this.db
      .select()
      .from(table)
      .where(eq(idColumn, id))
      .limit(1);

    return row === undefined ? undefined : fromDbRecord<T>(row);
  }

  private async listWhere<T>(table: AnyPgTable, where?: unknown, orderBy?: AnyPgColumn | AnyPgColumn[]): Promise<T[]> {
    const query = this.db.select().from(table);
    const filtered = where === undefined ? query : query.where(where as never);
    const rows =
      orderBy === undefined
        ? await filtered
        : await filtered.orderBy(...(Array.isArray(orderBy) ? orderBy : [orderBy]).map((column) => asc(column)));

    return rows.map((row) => fromDbRecord<T>(row));
  }

  private releaseTableRecord(release: Release): Omit<Release, 'work_item_ids' | 'execution_package_ids'> {
    const { work_item_ids: _workItemIds, execution_package_ids: _executionPackageIds, ...record } = release;
    return record;
  }

  private async saveReleaseRecord(release: Release): Promise<void> {
    await this.upsert(releases, releases.id, this.releaseTableRecord(release));
  }

  private async replaceReleaseWorkItems(releaseId: string, workItemIds: string[]): Promise<void> {
    const uniqueWorkItemIds = [...new Set(workItemIds)];
    await this.db.delete(release_work_items).where(eq(release_work_items.releaseId, releaseId));

    for (const [index, workItemId] of uniqueWorkItemIds.entries()) {
      await this.saveReleaseWorkItemLink(releaseId, workItemId, index);
    }
  }

  private async replaceReleaseExecutionPackages(releaseId: string, executionPackageIds: string[]): Promise<void> {
    const uniqueExecutionPackageIds = [...new Set(executionPackageIds)];
    await this.db.delete(release_execution_packages).where(eq(release_execution_packages.releaseId, releaseId));

    for (const [index, executionPackageId] of uniqueExecutionPackageIds.entries()) {
      await this.saveReleaseExecutionPackageLink(releaseId, executionPackageId, index);
    }
  }

  private async hydrateReleaseLinks(release: Release): Promise<Release> {
    const [workItems, executionPackages] = await Promise.all([
      this.listReleaseWorkItems(release.id),
      this.listReleaseExecutionPackages(release.id),
    ]);

    return {
      ...release,
      work_item_ids: workItems.map((workItem) => workItem.work_item_id),
      execution_package_ids: executionPackages.map((executionPackage) => executionPackage.execution_package_id),
    };
  }

  private async getReleaseWorkItemLinkOrder(releaseId: string, workItemId: string): Promise<number | undefined> {
    const [row] = await this.db
      .select({ linkOrder: release_work_items.linkOrder })
      .from(release_work_items)
      .where(and(eq(release_work_items.releaseId, releaseId), eq(release_work_items.workItemId, workItemId)))
      .limit(1);

    return row?.linkOrder;
  }

  private async nextReleaseWorkItemOrder(releaseId: string): Promise<number> {
    const [row] = await this.db
      .select({ linkOrder: release_work_items.linkOrder })
      .from(release_work_items)
      .where(eq(release_work_items.releaseId, releaseId))
      .orderBy(desc(release_work_items.linkOrder))
      .limit(1);

    return (row?.linkOrder ?? -1) + 1;
  }

  private async saveReleaseWorkItemLink(releaseId: string, workItemId: string, linkOrder: number): Promise<void> {
    const record = toDbRecord({ release_id: releaseId, work_item_id: workItemId, linkOrder }, release_work_items);
    await this.db
      .insert(release_work_items)
      .values(record as never)
      .onConflictDoUpdate({
        target: [release_work_items.releaseId, release_work_items.workItemId],
        set: record as never,
      });
  }

  private async getReleaseExecutionPackageLinkOrder(
    releaseId: string,
    executionPackageId: string,
  ): Promise<number | undefined> {
    const [row] = await this.db
      .select({ linkOrder: release_execution_packages.linkOrder })
      .from(release_execution_packages)
      .where(
        and(
          eq(release_execution_packages.releaseId, releaseId),
          eq(release_execution_packages.packageId, executionPackageId),
        ),
      )
      .limit(1);

    return row?.linkOrder;
  }

  private async nextReleaseExecutionPackageOrder(releaseId: string): Promise<number> {
    const [row] = await this.db
      .select({ linkOrder: release_execution_packages.linkOrder })
      .from(release_execution_packages)
      .where(eq(release_execution_packages.releaseId, releaseId))
      .orderBy(desc(release_execution_packages.linkOrder))
      .limit(1);

    return (row?.linkOrder ?? -1) + 1;
  }

  private async saveReleaseExecutionPackageLink(
    releaseId: string,
    executionPackageId: string,
    linkOrder: number,
  ): Promise<void> {
    const record = toDbRecord(
      { release_id: releaseId, package_id: executionPackageId, linkOrder },
      release_execution_packages,
    );
    await this.db
      .insert(release_execution_packages)
      .values(record as never)
      .onConflictDoUpdate({
        target: [release_execution_packages.releaseId, release_execution_packages.packageId],
        set: record as never,
      });
  }
}
