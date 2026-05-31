import { Buffer } from 'node:buffer';
import { createHash, randomUUID } from 'node:crypto';

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
  CodexLaunchTarget,
  CodexLaunchLease,
  CodexLaunchLeaseWithToken,
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
  ResolvedCodexCredential,
  Spec,
  SpecRevision,
  StatusHistory,
  RevisionCompareQuery,
  StructuredRevisionDiff,
  Task,
  WorkItem,
  WorkflowManualDecision,
} from '@forgeloop/domain';
import type { ObjectRef } from '@forgeloop/contracts';
import {
  DomainError,
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
  validateCodexRuntimeJobArtifactIntake,
  validateCodexLaunchTargetKind,
  validateCodexRuntimeJobTerminalResult,
  validateCodexRuntimeProfileRevision,
  isActiveRunSessionStatus,
  parseInternalArtifactRef,
  isOpenReviewPacketStatus,
  isWorkItemAutomationTerminal,
  normalizeAutomationCapabilities,
} from '@forgeloop/domain';

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
  ConsumeCodexRuntimeSetupNonceInput,
  CreateInternalArtifactObjectInput,
  CreatePendingWorkspaceBundleArtifactInput,
  CreateCodexSessionForkInput,
  CreateCodexCredentialBindingWithVersionInput,
  CreateCodexRuntimeProfileWithRevisionInput,
  CreatePlanItemWorkflowWithInitialSessionInput,
  BindReservedCodexRuntimeJobArtifactInput,
  CreateCodexRuntimeJobArtifactInput,
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
  GetClaimedAutomationActionRunInput,
  GetActiveCodexGenerationActionRunFenceInput,
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
  ResolveCodexCredentialForLaunchInput,
  ResolveCodexRuntimeForLaunchInput,
  RenewCodexSessionLeaseInput,
  RevokeCodexLaunchLeaseInput,
  RuntimeSnapshotRepositoryData,
  RuntimeSnapshotTargetRow,
  CodexCredentialBindingReadinessCandidate,
  CodexRuntimeProfileReadinessDiagnostic,
  CodexWorkerReadinessDiagnostic,
  WorkspaceBundleDownloadForRuntimeJob,
  RenewCommandIdempotencyInput,
  RequestManualPathHoldInput,
  ResolveAutomationProjectSettingsInput,
  ResolveManualPathHoldInput,
  SaveExecutionPackageGenerationPackageInput,
  SetAutomationProjectSettingsInput,
  SupersedeExecutionPackageGenerationRunInput,
  StartCodexRuntimeJobInput,
  TerminalizeCodexRuntimeJobInput,
  TombstoneInternalArtifactObjectInput,
  TerminalizeCodexLaunchLeaseInput,
  TerminalizeCodexSessionTurnInput,
  TraceArtifactRefRecord,
  TraceEventRecord,
  TraceLinkRecord,
  UpsertCodexWorkerRegistrationInput,
  BoundaryAnswerRecord,
  BoundaryDecisionRecord,
  BoundaryQuestionRecord,
  BoundaryRoundRecord,
  ClaimCodexSessionLeaseInput,
  SelectActiveCodexSessionForkInput,
  WorkflowRepositoryEvidenceInput,
} from './delivery-repository';
import {
  assertInternalArtifactObjectInput,
  runtimeSnapshotBlockerFieldsFor,
  runtimeSnapshotBlockersForActionRun,
  runtimeSnapshotBlockersForExecutionPackage,
} from './delivery-repository';
import { ObjectLockManager } from './object-lock';

const clone = <T>(value: T): T => structuredClone(value);

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

const automationActionClaimPriority = (actionRun: AutomationActionRun): number =>
  actionRun.action_type === 'project_runtime_snapshot' ? 1 : 0;

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

const redactAutomationActionClaim = (actionRun: AutomationActionRun): AutomationActionRun => {
  const { claim_token: _claimToken, locked_until: _lockedUntil, ...redacted } = actionRun;
  return redacted;
};

const valuesFor = <T>(records: Map<string, T>): T[] => [...records.values()].map(clone);

const revisionDiff = (
  query: RevisionCompareQuery,
  base: unknown,
  compare: unknown,
): StructuredRevisionDiff => ({
  base_revision_id: query.base_revision_id,
  compare_revision_id: query.compare_revision_id,
  changed_fields: changedFields(base, compare),
  ...(base === undefined ? {} : { base_snapshot: clone(base) as Record<string, unknown> }),
  ...(compare === undefined ? {} : { compare_snapshot: clone(compare) as Record<string, unknown> }),
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

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

const byCreatedAt = <T extends { created_at: string }>(left: T, right: T) => left.created_at.localeCompare(right.created_at);
const byCreatedAtThenId = <T extends { created_at: string; id: string }>(left: T, right: T) =>
  byCreatedAt(left, right) || left.id.localeCompare(right.id);
const bySequenceThenId = <T extends { sequence: number; id: string }>(left: T, right: T) =>
  left.sequence - right.sequence || left.id.localeCompare(right.id);
const byCreatedAtForRequestedAt = <T extends { requested_at: string; id: string }>(left: T, right: T) =>
  left.requested_at.localeCompare(right.requested_at) || left.id.localeCompare(right.id);
const recoverableRunSessionStatuses = new Set<RunSession['status']>([
  'queued',
  'running',
  'waiting_for_input',
  'stalled',
  'resuming',
  'cancel_requested',
]);
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
    return {
      namespace: `${parts[0]}/${parts[1]}`.toLowerCase(),
    };
  } catch {
    return undefined;
  }
};

interface CodexCredentialBindingVersionPrivateRecord {
  version: CodexCredentialBindingVersion;
  secret_payload_json: unknown;
}

interface CodexWorkerBootstrapTokenRecord extends CodexWorkerBootstrapToken {
  worker_identity: string;
  bootstrap_token_version: number;
  status: CreateCodexWorkerBootstrapTokenInput['status'];
  allowed_scopes_json: readonly CodexRuntimeScope[];
  allowed_capabilities_json: Record<string, unknown>;
  created_by_actor_id: string;
  revoked_at?: string;
}

interface CodexWorkerRegistrationPrivateRecord {
  registration: CodexWorkerRegistration;
  session_token_hash: string;
  session_expires_at: string;
  bootstrap_token_version: number;
  allowed_scopes: readonly CodexRuntimeScope[];
  target_kind_capability_ceiling: readonly CodexRuntimeTargetKind[];
  docker_image_digests: readonly string[];
  network_policy_digests: readonly string[];
  network_provider_config_digests: readonly string[];
  labels: Record<string, unknown>;
  session_public_key_id: string;
  session_public_key_algorithm: 'x25519';
  session_public_key_material: string;
  session_public_key_expires_at: string;
  session_epoch: number;
}

type StoredBoundaryRound = BoundaryRoundRecord;
type StoredBoundaryQuestion = BoundaryQuestionRecord;
type StoredBoundaryAnswer = BoundaryAnswerRecord;
type StoredBoundaryDecision = BoundaryDecisionRecord;

interface CodexWorkerSessionProof {
  worker: CodexWorkerRegistrationPrivateRecord;
  session_token_hash: string;
  session_epoch: number;
  session_public_key_id: string;
  session_public_key_expires_at: string;
}

interface CodexLaunchLeasePrivateRecord {
  lease: CodexLaunchLease;
  lease_request_id: string;
  runtime_profile_digest: string;
  credential_binding_id: string;
  credential_binding_version_id: string;
  credential_payload_digest: string;
  docker_image_digest: string;
  network_policy_digest: string;
  network_provider_config_digest?: string;
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
  materialization_request_hash?: string;
  materialized_at?: string;
  terminal_reason_code?: string;
  terminal_evidence_summary?: Record<string, unknown>;
  terminal_runtime_job_id?: string;
  terminal_idempotency_key?: string;
}

interface CodexPendingWorkspaceBundlePrivateRecord extends PendingWorkspaceBundleInput {
  id: string;
  run_session_id: string;
  execution_package_id: string;
  archive_bytes_base64?: string;
  request_digest: string;
  runtime_job_id?: string;
  status: 'pending' | 'bound';
  created_at: string;
}

interface CodexRuntimeJobArtifactPrivateRecord {
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
  request_digest: string;
  created_at: string;
}

const internalArtifactOwnerIdempotencyKey = (input: Pick<InternalArtifactObject, 'owner_type' | 'owner_id' | 'idempotency_key'>) =>
  `${input.owner_type}\0${input.owner_id}\0${input.idempotency_key}`;

const internalArtifactOwnerKindArtifactKey = (input: Pick<InternalArtifactObject, 'owner_type' | 'owner_id' | 'kind' | 'artifact_id'>) =>
  `${input.owner_type}\0${input.owner_id}\0${input.kind}\0${input.artifact_id}`;

interface CodexRuntimeJobPrivateRecord {
  job: CodexRuntimeJob;
  runtime_profile_digest: string;
  credential_binding_id: string;
  credential_binding_version_id: string;
  credential_payload_digest: string;
  docker_image_digest: string;
  network_policy_digest: string;
  network_provider_config_digest?: string;
  envelope_id: string;
  envelope_digest: string;
  workspace_bundle_artifact_id?: string;
  pending_workspace_bundle?: CodexPendingWorkspaceBundlePrivateRecord;
}

interface InMemoryDeliveryRepositoryOptions {
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
      ciphertext: `in-memory:${codexCredentialPayloadDigest(input.plaintext_launch_token)}`,
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

export class InMemoryDeliveryRepository implements DeliveryRepository {
  private readonly codexLaunchTokenEnvelopeSealer: CodexLaunchTokenEnvelopeSealer;
  private readonly objectLocks = new ObjectLockManager();
  private readonly organizations = new Map<string, Organization>();
  private readonly actors = new Map<string, Actor>();
  private readonly projects = new Map<string, Project>();
  private readonly projectRepos = new Map<string, ProjectRepo>();
  private readonly workItems = new Map<string, WorkItem>();
  private readonly tasks = new Map<string, Task>();
  private readonly specs = new Map<string, Spec>();
  private readonly specRevisions = new Map<string, SpecRevision>();
  private readonly contextManifests = new Map<string, ContextManifest>();
  private readonly developmentPlans = new Map<string, DevelopmentPlan>();
  private readonly developmentPlanRevisions = new Map<string, DevelopmentPlanRevision>();
  private readonly developmentPlanSourceLinks = new Map<string, DevelopmentPlanSourceLink>();
  private readonly developmentPlanItems = new Map<string, DevelopmentPlanItem>();
  private readonly developmentPlanItemRevisions = new Map<string, DevelopmentPlanItemRevision>();
  private readonly planItemWorkflows = new Map<string, PlanItemWorkflow>();
  private readonly planItemWorkflowTransitions = new Map<string, PlanItemWorkflowTransition>();
  private readonly workflowManualDecisions = new Map<string, WorkflowManualDecision>();
  private readonly executionReadinessRecords = new Map<string, ExecutionReadinessRecord>();
  private readonly codexSessions = new Map<string, CodexSession>();
  private readonly codexSessionTurns = new Map<string, CodexSessionTurn>();
  private readonly codexSessionSnapshots = new Map<string, CodexSessionSnapshot>();
  private readonly codexSessionLeases = new Map<string, CodexSessionLease>();
  private readonly codexSessionStaleTerminalizationAttempts = new Map<string, CodexSessionStaleTerminalizationAttempt>();
  private readonly brainstormingSessions = new Map<string, BrainstormingSession>();
  private readonly boundaryRounds = new Map<string, StoredBoundaryRound>();
  private readonly boundaryQuestions = new Map<string, StoredBoundaryQuestion>();
  private readonly boundaryAnswers = new Map<string, StoredBoundaryAnswer>();
  private readonly boundaryDecisions = new Map<string, StoredBoundaryDecision>();
  private readonly boundarySummaries = new Map<string, BoundarySummary>();
  private readonly boundarySummaryRevisions = new Map<string, BoundarySummaryRevision>();
  private readonly executionPlans = new Map<string, ExecutionPlanDocument>();
  private readonly executionPlanRevisions = new Map<string, ExecutionPlanRevision>();
  private readonly executions = new Map<string, Execution>();
  private readonly codeReviewHandoffs = new Map<string, CodeReviewHandoff>();
  private readonly qaHandoffs = new Map<string, QaHandoff>();
  private readonly plans = new Map<string, Plan>();
  private readonly planRevisions = new Map<string, PlanRevision>();
  private readonly executionPackages = new Map<string, ExecutionPackage>();
  private readonly executionPackageDependencies = new Map<string, ExecutionPackageDependency>();
  private readonly attachments = new Map<string, Attachment>();
  private readonly runSessions = new Map<string, RunSession>();
  private readonly runEvents = new Map<string, RunEvent>();
  private readonly runCommands = new Map<string, RunCommand>();
  private readonly runWorkerLeases = new Map<string, RunWorkerLease>();
  private readonly reviewPackets = new Map<string, ReviewPacket>();
  private readonly releases = new Map<string, Release>();
  private readonly releaseWorkItems = new Map<string, ReleaseWorkItem>();
  private readonly releaseWorkItemOrders = new Map<string, number>();
  private readonly releaseExecutionPackages = new Map<string, ReleaseExecutionPackage>();
  private readonly releaseExecutionPackageOrders = new Map<string, number>();
  private readonly releaseEvidences = new Map<string, ReleaseEvidence>();
  private readonly objectEvents = new Map<string, ObjectEvent>();
  private readonly statusHistories = new Map<string, StatusHistory>();
  private readonly artifacts = new Map<string, Artifact>();
  private readonly decisions = new Map<string, Decision>();
  private readonly traceEvents = new Map<string, TraceEventRecord>();
  private readonly traceLinks = new Map<string, TraceLinkRecord>();
  private readonly traceArtifactRefs = new Map<string, TraceArtifactRefRecord>();
  private readonly automationProjectSettings = new Map<string, AutomationProjectSettings>();
  private readonly manualPathHolds = new Map<string, ManualPathHold>();
  private readonly manualPathHoldIdempotency = new Map<string, string>();
  private readonly manualPathHoldSourceActions = new Map<string, string>();
  private readonly commandIdempotencyRecords = new Map<string, CommandIdempotencyRecord>();
  private readonly executionPackageGenerationRuns = new Map<string, ExecutionPackageGenerationRun>();
  private readonly executionPackageGenerationPackages = new Map<string, ExecutionPackageGenerationPackageRecord>();
  private readonly automationActionRuns = new Map<string, AutomationActionRun>();
  private readonly automationActionRunIdempotency = new Map<string, string>();
  private readonly codexRuntimeProfiles = new Map<string, CodexRuntimeProfile>();
  private readonly codexRuntimeProfileRevisions = new Map<string, CodexRuntimeProfileRevision>();
  private readonly codexCredentialBindings = new Map<string, CodexCredentialBinding>();
  private readonly codexCredentialBindingVersions = new Map<string, CodexCredentialBindingVersionPrivateRecord>();
  private readonly codexWorkerBootstrapTokens = new Map<string, CodexWorkerBootstrapTokenRecord>();
  private readonly codexWorkerRegistrations = new Map<string, CodexWorkerRegistrationPrivateRecord>();
  private readonly codexWorkerSessionNonces = new Map<
    string,
    {
      worker_id: string;
      session_token_hash: string;
      nonce_hash: string;
      session_epoch: number;
      request_binding_digest: string;
      replay_key_hash: string;
      nonce_timestamp: string;
      created_at: string;
    }
  >();
  private readonly codexRuntimeSetupNonces = new Map<string, ConsumeCodexRuntimeSetupNonceInput>();
  private readonly codexLaunchLeases = new Map<string, CodexLaunchLeasePrivateRecord>();
  private readonly codexLaunchLeaseRequestIds = new Map<string, string>();
  private readonly codexRuntimeJobs = new Map<string, CodexRuntimeJobPrivateRecord>();
  private readonly codexRuntimeJobRequestIds = new Map<string, string>();
  private readonly codexRuntimeJobTargetAttempts = new Map<string, string>();
  private readonly codexLaunchTokenEnvelopes = new Map<string, CodexLaunchTokenEnvelope>();
  private readonly codexRuntimeJobArtifacts = new Map<string, CodexRuntimeJobArtifactPrivateRecord>();
  private readonly codexPendingWorkspaceBundles = new Map<string, CodexPendingWorkspaceBundlePrivateRecord>();
  private readonly internalArtifactObjects = new Map<string, InternalArtifactObject>();
  private readonly internalArtifactObjectRefs = new Map<string, string>();
  private readonly internalArtifactObjectOwnerIdempotency = new Map<string, string>();
  private readonly internalArtifactObjectOwnerKindArtifact = new Map<string, string>();
  private readonly codexRuntimeJobEventIds = new Map<
    string,
    {
      runtime_job_id: string;
      event_id: string;
      idempotency_key: string;
      request_digest: string;
      job: CodexRuntimeJob;
    }
  >();
  private readonly codexRuntimeJobEventIdempotency = new Map<string, string>();

  constructor(options: InMemoryDeliveryRepositoryOptions = {}) {
    this.codexLaunchTokenEnvelopeSealer =
      options.codexLaunchTokenEnvelopeSealer ?? defaultCodexLaunchTokenEnvelopeSealer;
  }

  async withDeliveryTransaction<T>(write: (repository: DeliveryRepository) => Promise<T>): Promise<T> {
    return this.objectLocks.withLock('delivery-transaction', async () => {
      const transaction = new InMemoryDeliveryRepository({
        codexLaunchTokenEnvelopeSealer: this.codexLaunchTokenEnvelopeSealer,
      });
      this.copyTransactionalStateTo(transaction);
      const snapshots = transaction.snapshotTransactionalMaps();
      const result = await write(transaction);
      this.mergeTransactionalChangesFrom(transaction, snapshots);
      return result;
    });
  }

  async withObjectLock<T>(key: string, write: (repository: DeliveryRepository) => Promise<T>): Promise<T> {
    return this.objectLocks.withLock(key, () => write(this));
  }

  async createCodexRuntimeProfileWithRevision(
    input: CreateCodexRuntimeProfileWithRevisionInput,
  ): Promise<CodexRuntimeProfileRevision> {
    validateCodexRuntimeProfileRevision(input.revision);
    if (input.profile.active_revision_id !== input.revision.id || input.revision.profile_id !== input.profile.id) {
      throw codexDenied('codex_launch_lease_denied', 'Runtime profile active revision fence was rejected.');
    }
    const existingRevision = this.codexRuntimeProfileRevisions.get(input.revision.id);
    const existingProfile = this.codexRuntimeProfiles.get(input.profile.id);
    const existingRevisionByNumber = valuesFor(this.codexRuntimeProfileRevisions).find(
      (revision) => revision.profile_id === input.revision.profile_id && revision.revision_number === input.revision.revision_number,
    );
    if (existingProfile !== undefined || existingRevision !== undefined || existingRevisionByNumber !== undefined) {
      if (
        existingProfile !== undefined &&
        existingRevision !== undefined &&
        existingRevisionByNumber?.id === existingRevision.id &&
        valuesEqual(existingProfile, input.profile) &&
        valuesEqual(existingRevision, input.revision)
      ) {
        return clone(existingRevision);
      }
      throw codexDenied('codex_launch_lease_denied', 'Runtime profile revision is immutable.');
    }
    if (input.profile.target_kind !== input.revision.target_kind || input.profile.environment !== input.revision.environment) {
      throw codexDenied('codex_launch_lease_denied', 'Runtime profile revision does not match parent profile.');
    }
    this.codexRuntimeProfiles.set(input.profile.id, clone(input.profile));
    this.codexRuntimeProfileRevisions.set(input.revision.id, clone(input.revision));
    return clone(input.revision);
  }

  private getScopedCodexCredentialBindingPublic(input: ResolveCodexCredentialForLaunchInput): CodexCredentialBindingPublic | undefined {
    const binding = this.codexCredentialBindings.get(input.credential_binding_id);
    if (binding === undefined || binding.project_id !== input.project_id) {
      return undefined;
    }
    if (binding.repo_id !== undefined && binding.repo_id !== input.repo_id) {
      return undefined;
    }
    const profile = this.codexRuntimeProfiles.get(binding.profile_id);
    if (
      (input.runtime_profile_id !== undefined && binding.profile_id !== input.runtime_profile_id) ||
      profile?.target_kind !== input.target_kind ||
      binding.active_version_id === undefined
    ) {
      return undefined;
    }
    const activeVersion = this.codexCredentialBindingVersions.get(binding.active_version_id)?.version;
    if (activeVersion === undefined || activeVersion.status !== 'active') {
      return undefined;
    }
    return {
      id: binding.id,
      profile_id: binding.profile_id,
      project_id: binding.project_id,
      ...(binding.repo_id !== undefined ? { repo_id: binding.repo_id } : {}),
      provider: binding.provider,
      purpose: binding.purpose,
      active_version_id: activeVersion.id,
      active_payload_digest: activeVersion.payload_digest,
    };
  }

  async getActiveCodexRuntimeProfileRevision(
    input: ResolveCodexRuntimeForLaunchInput,
  ): Promise<CodexRuntimeProfileRevision | undefined> {
    const revisions = valuesFor(this.codexRuntimeProfileRevisions)
      .filter(
        (revision) =>
          revision.status === 'active' &&
          revision.target_kind === input.target_kind &&
          (input.runtime_profile_id === undefined || revision.profile_id === input.runtime_profile_id) &&
          codexRuntimeScopeMatches(revision.allowed_scopes, codexScope(input.project_id, input.repo_id)),
      )
      .sort((left, right) => right.created_at.localeCompare(left.created_at) || right.revision_number - left.revision_number);

    return this.cloneMaybe(revisions[0]);
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
    const existingBinding = this.codexCredentialBindings.get(input.binding.id);
    const existingVersion = this.codexCredentialBindingVersions.get(input.version.id);
    const existingVersionByNumber = valuesFor(this.codexCredentialBindingVersions).find(
      (record) =>
        record.version.binding_id === input.version.binding_id && record.version.version_number === input.version.version_number,
    );
    if (existingBinding !== undefined || existingVersion !== undefined || existingVersionByNumber !== undefined) {
      if (
        existingBinding !== undefined &&
        existingVersion !== undefined &&
        existingVersionByNumber?.version.id === existingVersion.version.id &&
        valuesEqual(existingBinding, input.binding) &&
        valuesEqual(existingVersion.version, input.version) &&
        valuesEqual(existingVersion.secret_payload_json, input.secret_payload_json)
      ) {
        return clone(existingVersion.version);
      }
      throw codexDenied('codex_launch_lease_denied', 'Credential binding version is immutable.');
    }
    this.codexCredentialBindings.set(input.binding.id, clone(input.binding));
    this.codexCredentialBindingVersions.set(input.version.id, {
      version: clone(input.version),
      secret_payload_json: clone(input.secret_payload_json),
    });
    return clone(input.version);
  }

  async getCodexCredentialBindingPublic(id: string): Promise<CodexCredentialBindingPublic | undefined> {
    const binding = this.codexCredentialBindings.get(id);
    if (binding === undefined) {
      return undefined;
    }
    const activeVersion =
      binding.active_version_id !== undefined ? this.codexCredentialBindingVersions.get(binding.active_version_id)?.version : undefined;
    return {
      id: binding.id,
      profile_id: binding.profile_id,
      project_id: binding.project_id,
      ...(binding.repo_id !== undefined ? { repo_id: binding.repo_id } : {}),
      provider: binding.provider,
      purpose: binding.purpose,
      ...(binding.active_version_id !== undefined ? { active_version_id: binding.active_version_id } : {}),
      ...(activeVersion?.payload_digest !== undefined ? { active_payload_digest: activeVersion.payload_digest } : {}),
    };
  }

  async resolveCodexCredentialForLaunch(input: ResolveCodexCredentialForLaunchInput): Promise<ResolvedCodexCredential | undefined> {
    const binding = this.codexCredentialBindings.get(input.credential_binding_id);
    if (binding === undefined || binding.project_id !== input.project_id) {
      return undefined;
    }
    if (binding.repo_id !== undefined && binding.repo_id !== input.repo_id) {
      return undefined;
    }
    const profile = this.codexRuntimeProfiles.get(binding.profile_id);
    if (
      (input.runtime_profile_id !== undefined && binding.profile_id !== input.runtime_profile_id) ||
      profile?.target_kind !== input.target_kind
    ) {
      return undefined;
    }
    const version =
      binding.active_version_id !== undefined ? this.codexCredentialBindingVersions.get(binding.active_version_id) : undefined;
    if (version === undefined || version.version.status !== 'active') {
      return undefined;
    }
    if (input.required_payload_digest !== undefined && version.version.payload_digest !== input.required_payload_digest) {
      return undefined;
    }
    return {
      binding_id: binding.id,
      binding_version_id: version.version.id,
      payload: clone(version.secret_payload_json),
      payload_digest: version.version.payload_digest,
    };
  }

	async getCodexRuntimeStatus(input: GetCodexRuntimeStatusInput): Promise<CodexRuntimeStatusProjection> {
		const profileRevision = await this.getActiveCodexRuntimeProfileRevision(input);
		let credential =
			input.credential_binding_id === undefined
				? undefined
				: this.getScopedCodexCredentialBindingPublic({
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
				credential = this.getScopedCodexCredentialBindingPublic({
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
      profileRevision !== undefined && profileNetworkPolicy !== undefined
        ? await this.findAvailableCodexWorker({
            project_id: input.project_id,
            ...(input.repo_id === undefined ? {} : { repo_id: input.repo_id }),
            target_kind: input.target_kind,
            docker_image_digest: profileRevision.docker_image_digest,
            network_policy_digest: codexRuntimeNetworkPolicyDigest(profileNetworkPolicy),
            ...(profileNetworkPolicy.mode === 'egress_allowlist' && profileNetworkPolicy.provider === 'docker_network_proxy'
              ? { network_provider_config_digest: profileNetworkPolicy.provider_config.provider_config_digest }
              : {}),
            now: input.now,
          })
        : undefined;
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
      ...(profileRevision !== undefined
        ? {
            runtime_profile_id: profileRevision.profile_id,
            runtime_profile_revision_id: profileRevision.id,
            runtime_profile_digest: profileRevision.profile_digest,
            runtime_target_kind: profileRevision.target_kind,
            source_access_mode: profileRevision.source_access_mode,
            environment: profileRevision.environment,
            docker_image_digest: profileRevision.docker_image_digest,
            network_policy_digest: codexRuntimeNetworkPolicyDigest(profileRevision.network_policy),
            profile_status: profileRevision.status,
          }
        : {}),
      ...(credential !== undefined
        ? {
            credential_binding_id: credential.id,
            credential_binding_version_id: credential.active_version_id,
            credential_payload_digest: credential.active_payload_digest,
          }
        : {}),
      ...(worker !== undefined ? { worker_status: worker.status } : {}),
      blocker_codes: blockerCodes,
    };
  }

  async listActiveCodexRuntimeProfileReadinessDiagnostics(
    input: ListActiveCodexRuntimeProfileReadinessDiagnosticsInput,
  ): Promise<CodexRuntimeProfileReadinessDiagnostic[]> {
    return valuesFor(this.codexRuntimeProfileRevisions)
      .filter(
        (revision) =>
          revision.status === 'active' &&
          (input.runtime_profile_id === undefined || revision.profile_id === input.runtime_profile_id) &&
          codexRuntimeScopeMatches(revision.allowed_scopes, codexScope(input.project_id, input.repo_id)),
      )
      .sort((left, right) => right.created_at.localeCompare(left.created_at) || right.revision_number - left.revision_number)
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
    return valuesFor(this.codexCredentialBindings)
      .filter((binding) => {
        if (
          binding.project_id !== input.project_id ||
          binding.profile_id !== input.runtime_profile_id ||
          (input.credential_binding_id !== undefined && binding.id !== input.credential_binding_id)
        ) {
          return false;
        }
        if (binding.repo_id !== undefined && binding.repo_id !== input.repo_id) {
          return false;
        }
        const profile = this.codexRuntimeProfiles.get(binding.profile_id);
        if (profile?.target_kind !== input.target_kind || binding.active_version_id === undefined) {
          return false;
        }
        const activeVersion = this.codexCredentialBindingVersions.get(binding.active_version_id)?.version;
        return activeVersion?.status === 'active';
      })
      .map((binding) => ({ id: binding.id, purpose: binding.purpose }));
  }

  async getCodexWorkerReadinessDiagnostic(
    input: GetCodexWorkerReadinessDiagnosticInput,
  ): Promise<CodexWorkerReadinessDiagnostic> {
    const available = valuesFor(this.codexWorkerRegistrations).filter(
      (record) =>
        record.registration.status === 'online' &&
        record.registration.control_channel_status === 'connected' &&
        record.session_expires_at > input.now &&
        codexWorkerHeartbeatIsFresh(record.registration.last_heartbeat_at, input.now) &&
        codexWorkerScopeMatchesTarget(record.allowed_scopes, input.target_kind, codexScope(input.project_id, input.repo_id)),
    );

    if (available.length === 0) {
      return 'worker_unavailable';
    }
    const targetCompatible = available.filter((record) => record.registration.capabilities.includes(input.target_kind));
    if (targetCompatible.length === 0) {
      return 'worker_target_unsupported';
    }
    const dockerCompatible = targetCompatible.filter((record) => record.docker_image_digests.includes(input.docker_image_digest));
    if (dockerCompatible.length === 0) {
      return 'worker_docker_capability_mismatch';
    }
    const networkCompatible = dockerCompatible.filter(
      (record) =>
        record.network_policy_digests.includes(input.network_policy_digest) &&
        (input.network_provider_config_digest === undefined ||
          record.network_provider_config_digests.includes(input.network_provider_config_digest)),
    );
    return networkCompatible.length === 0 ? 'worker_network_policy_mismatch' : 'ready';
  }

  async createCodexWorkerBootstrapToken(input: CreateCodexWorkerBootstrapTokenInput): Promise<CodexWorkerBootstrapToken> {
    const existing = this.codexWorkerBootstrapTokens.get(input.id);
    if (existing !== undefined) {
      const expected: CodexWorkerBootstrapTokenRecord = {
        id: input.id,
        token_hash: input.bootstrap_token_hash,
        worker_identity: input.worker_identity,
        bootstrap_token_version: input.bootstrap_token_version,
        status: input.status,
        allowed_scopes_json: clone(input.allowed_scopes_json),
        allowed_capabilities_json: clone(input.allowed_capabilities_json),
        created_by_actor_id: input.created_by_actor_id,
        expires_at: input.expires_at,
        created_at: input.created_at,
        ...(input.revoked_at !== undefined ? { revoked_at: input.revoked_at } : {}),
      };
      const { created_at: _expectedCreatedAt, expires_at: _expectedExpiresAt, ...expectedReplayFields } = expected;
      const {
        created_at: _existingCreatedAt,
        expires_at: _existingExpiresAt,
        consumed_at: _existingConsumedAt,
        ...existingReplayFields
      } = existing;
      if (!valuesEqual(existingReplayFields, expectedReplayFields)) {
        throw codexDenied('codex_worker_registration_denied', 'Worker bootstrap token already exists with different immutable fields.');
      }
      return {
        id: existing.id,
        token_hash: existing.token_hash,
        expires_at: existing.expires_at,
        ...(existing.consumed_at === undefined ? {} : { consumed_at: existing.consumed_at }),
        created_at: existing.created_at,
      };
    }
    const existingByHashVersion = [...this.codexWorkerBootstrapTokens.values()].find(
      (token) =>
        token.token_hash === input.bootstrap_token_hash &&
        token.bootstrap_token_version === input.bootstrap_token_version,
    );
    if (existingByHashVersion !== undefined) {
      throw codexDenied('codex_worker_registration_denied', 'Worker bootstrap token already exists with different immutable fields.');
    }
    const token: CodexWorkerBootstrapTokenRecord = {
      id: input.id,
      token_hash: input.bootstrap_token_hash,
      worker_identity: input.worker_identity,
      bootstrap_token_version: input.bootstrap_token_version,
      status: input.status,
      allowed_scopes_json: clone(input.allowed_scopes_json),
      allowed_capabilities_json: clone(input.allowed_capabilities_json),
      created_by_actor_id: input.created_by_actor_id,
      expires_at: input.expires_at,
      created_at: input.created_at,
      ...(input.revoked_at !== undefined ? { revoked_at: input.revoked_at } : {}),
    };
    this.codexWorkerBootstrapTokens.set(input.id, clone(token));
    return {
      id: token.id,
      token_hash: token.token_hash,
      expires_at: token.expires_at,
      created_at: token.created_at,
    };
  }

  async upsertCodexWorkerRegistration(input: UpsertCodexWorkerRegistrationInput): Promise<CodexWorkerRegistration> {
    const bootstrap = [...this.codexWorkerBootstrapTokens.values()].find(
      (token) =>
        token.worker_identity === input.worker_identity &&
        token.token_hash === input.bootstrap_token_hash &&
        token.bootstrap_token_version === input.bootstrap_token_version &&
        token.status === 'active' &&
        token.revoked_at === undefined &&
        token.expires_at > input.now,
    );
    if (bootstrap === undefined) {
      throw codexDenied('codex_worker_registration_denied', 'Worker bootstrap token proof was rejected.');
    }
    if (
      this.codexWorkerRegistrations.has(input.worker_id) ||
      [...this.codexWorkerRegistrations.values()].some((worker) => worker.registration.worker_identity === input.worker_identity)
    ) {
      throw codexDenied('codex_worker_registration_denied', 'Worker bootstrap token was already consumed.');
    }
    if (
      !input.allowed_scopes.every((scope) => codexRuntimeScopeMatches(bootstrap.allowed_scopes_json, scope)) ||
      !includesAll(capabilityList(bootstrap.allowed_capabilities_json, 'target_kinds'), input.capabilities) ||
      !includesAll(capabilityList(bootstrap.allowed_capabilities_json, 'docker_image_digests'), input.docker_image_digests) ||
      !includesAll(capabilityList(bootstrap.allowed_capabilities_json, 'network_policy_digests'), input.network_policy_digests) ||
      !includesAll(
        capabilityList(bootstrap.allowed_capabilities_json, 'network_provider_config_digests'),
        input.network_provider_config_digests ?? [],
      )
    ) {
      throw codexDenied('codex_worker_registration_denied', 'Worker registration exceeds bootstrap token trust root.');
    }
    this.codexWorkerBootstrapTokens.set(bootstrap.id, {
      ...clone(bootstrap),
      status: 'consumed',
      consumed_at: input.now,
    });
    const registration: CodexWorkerRegistration = {
      id: input.worker_id,
      worker_version: input.version,
      worker_identity: input.worker_identity,
      status: input.status,
      control_channel_status: input.control_channel_status,
      session_expires_at: input.session_expires_at,
      session_epoch: 1,
      bootstrap_token_hash: input.bootstrap_token_hash,
      capabilities: clone(input.capabilities),
      uid: input.host_worker_uid,
      gid: input.host_worker_gid,
      active_lease_count: input.lease_count,
      max_concurrency: input.max_concurrency,
      session_public_key: input.session_public_key_material,
      registered_at: input.now,
    };
    this.codexWorkerRegistrations.set(input.worker_id, {
      registration: clone(registration),
      session_token_hash: codexCredentialPayloadDigest(input.session_token),
      session_expires_at: input.session_expires_at,
      bootstrap_token_version: input.bootstrap_token_version,
      allowed_scopes: clone(input.allowed_scopes),
      target_kind_capability_ceiling: clone(input.capabilities),
      docker_image_digests: clone(input.docker_image_digests),
      network_policy_digests: clone(input.network_policy_digests),
      network_provider_config_digests: clone(input.network_provider_config_digests ?? []),
      labels: clone(input.labels ?? {}),
      session_public_key_id: input.session_public_key_id,
      session_public_key_algorithm: input.session_public_key_algorithm,
      session_public_key_material: input.session_public_key_material,
      session_public_key_expires_at: input.session_public_key_expires_at,
      session_epoch: 1,
    });
    return clone(registration);
  }

  async heartbeatCodexWorker(input: HeartbeatCodexWorkerInput): Promise<CodexWorkerRegistration> {
    const worker = this.assertWorkerSession(input.worker_id, input.session_token, input.now, 'codex_worker_registration_denied', {
      requireConnected: false,
    });
    if (!includesAll(worker.target_kind_capability_ceiling, input.capabilities)) {
      throw codexDenied('codex_worker_registration_denied', 'Worker heartbeat exceeds registered capability ceiling.');
    }
    this.recordCodexWorkerNonce(input.worker_id, input.session_token, input.nonce, input.nonce_timestamp, input.now);
    worker.registration = {
      ...worker.registration,
      status: input.status,
      control_channel_status: input.control_channel_status,
      capabilities: clone(input.capabilities),
      last_heartbeat_at: input.now,
    };
    this.codexWorkerRegistrations.set(input.worker_id, clone(worker));
    return clone(worker.registration);
  }

  async findAvailableCodexWorker(input: FindAvailableCodexWorkerInput): Promise<CodexWorkerRegistration | undefined> {
    const worker = valuesFor(this.codexWorkerRegistrations)
      .filter(
        (record) =>
          record.registration.status === 'online' &&
          record.registration.control_channel_status === 'connected' &&
          record.session_expires_at > input.now &&
          codexWorkerHeartbeatIsFresh(record.registration.last_heartbeat_at, input.now) &&
          record.registration.active_lease_count < record.registration.max_concurrency &&
          record.registration.capabilities.includes(input.target_kind) &&
          codexWorkerScopeMatchesTarget(record.allowed_scopes, input.target_kind, codexScope(input.project_id, input.repo_id)) &&
          record.docker_image_digests.includes(input.docker_image_digest) &&
          record.network_policy_digests.includes(input.network_policy_digest) &&
          (input.network_provider_config_digest === undefined ||
            record.network_provider_config_digests.includes(input.network_provider_config_digest)),
      )
      .sort(
        (left, right) =>
          left.registration.active_lease_count - right.registration.active_lease_count ||
          (right.registration.last_heartbeat_at ?? '').localeCompare(left.registration.last_heartbeat_at ?? '') ||
          right.registration.registered_at.localeCompare(left.registration.registered_at) ||
          right.registration.id.localeCompare(left.registration.id),
      )[0];
    return this.cloneMaybe(worker?.registration);
  }

  async refreshCodexWorkerSession(input: RefreshCodexWorkerSessionInput): Promise<CodexWorkerRegistration> {
    const worker = this.assertWorkerSession(input.worker_id, input.current_session_token, input.now, 'codex_worker_registration_denied');
    this.recordCodexWorkerNonce(
      input.worker_id,
      input.current_session_token,
      input.nonce,
      input.nonce_timestamp,
      input.now,
      input.replay_protection,
    );
    if (valuesFor(this.codexRuntimeJobs).some((record) => record.job.worker_id === input.worker_id && record.job.status === 'queued')) {
      throw codexDenied('codex_worker_registration_denied', 'Worker session refresh was rejected while runtime jobs are assigned.');
    }
    if (
      valuesFor(this.codexRuntimeJobs).some(
        (record) =>
          record.job.worker_id === input.worker_id &&
          (record.job.status === 'accepted' || record.job.status === 'materializing' || record.job.status === 'running') &&
          !this.codexRuntimeJobAcceptedSessionCoversRefresh(record),
      )
    ) {
      throw codexDenied('codex_worker_registration_denied', 'Worker session refresh was rejected while runtime jobs are assigned.');
    }
    const refreshed: CodexWorkerRegistrationPrivateRecord = {
      ...worker,
      registration: {
        ...worker.registration,
        session_id: input.next_session_public_key_id,
        session_expires_at: input.next_session_expires_at,
        session_epoch: worker.session_epoch + 1,
        session_public_key: input.next_session_public_key_material,
        registered_at: worker.registration.registered_at,
      },
      session_token_hash: codexCredentialPayloadDigest(input.next_session_token),
      session_expires_at: input.next_session_expires_at,
      session_public_key_id: input.next_session_public_key_id,
      session_public_key_material: input.next_session_public_key_material,
      session_public_key_expires_at: input.next_session_public_key_expires_at,
      session_epoch: worker.session_epoch + 1,
    };
    this.codexWorkerRegistrations.set(input.worker_id, clone(refreshed));
    return clone(refreshed.registration);
  }

  async createOrReplayCodexRuntimeJobWithLeaseAndEnvelope(
    input: CreateOrReplayCodexRuntimeJobWithLeaseAndEnvelopeInput,
  ): Promise<CreateOrReplayCodexRuntimeJobWithLeaseAndEnvelopeResult> {
    return this.objectLocks.withLock('codex-runtime-job-create-replay', () =>
      this.createOrReplayCodexRuntimeJobWithLeaseAndEnvelopeUnlocked(input),
    );
  }

  private async createOrReplayCodexRuntimeJobWithLeaseAndEnvelopeUnlocked(
    input: CreateOrReplayCodexRuntimeJobWithLeaseAndEnvelopeInput,
  ): Promise<CreateOrReplayCodexRuntimeJobWithLeaseAndEnvelopeResult> {
    validateCodexLaunchTargetKind(input.target.target_type, input.target.target_kind);

    const replayByRequestId = this.codexRuntimeJobRequestIds.get(input.job_request_id);
    if (replayByRequestId !== undefined) {
      return this.replayCodexRuntimeJob(replayByRequestId, input);
    }

    const targetAttemptKey = this.codexRuntimeJobTargetAttemptKey(input.target, input.launch_attempt);
    const replayByTargetAttempt = this.codexRuntimeJobTargetAttempts.get(targetAttemptKey);
    if (replayByTargetAttempt !== undefined) {
      return this.replayCodexRuntimeJob(replayByTargetAttempt, input);
    }
    if (this.findCodexLaunchLeaseForTargetAttempt(input.target, input.launch_attempt) !== undefined) {
      throw codexDenied('codex_runtime_job_unavailable', 'Runtime job target attempt already has a launch lease.');
    }

    if (
      this.codexRuntimeJobs.has(input.runtime_job_id) ||
      this.codexLaunchLeases.has(input.launch_lease_id) ||
      this.codexLaunchTokenEnvelopes.has(input.envelope_id)
    ) {
      throw codexDenied('codex_runtime_job_unavailable', 'Codex runtime job immutable id was already used.');
    }
    if (!this.codexRuntimePendingBundleCreateMatches(input)) {
      throw codexDenied('codex_runtime_job_unavailable', 'Runtime job pending workspace bundle fence was rejected.');
    }
    if (!this.codexRuntimeJobHasRequiredLaunchFence(input)) {
      throw codexDenied('codex_runtime_job_unavailable', 'Runtime job launch fence was incomplete.');
    }

    const profileRevision = this.codexRuntimeProfileRevisions.get(input.runtime_profile_revision_id);
    const profileNetworkPolicy = profileRevision === undefined ? undefined : normalizeCodexRuntimeNetworkPolicy(profileRevision.network_policy);
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

    const worker = this.codexWorkerRegistrations.get(input.worker_id);
    if (worker === undefined || !this.codexWorkerCanRunRuntimeJob(worker, input)) {
      throw codexDenied('codex_runtime_job_unavailable', 'Runtime job worker fence was rejected.');
    }

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
    const lease: CodexLaunchLease = {
      id: input.launch_lease_id,
      target: clone(input.target),
      launch_attempt: input.launch_attempt,
      profile_revision_id: input.runtime_profile_revision_id,
      worker_id: input.worker_id,
      status: 'active',
      lease_token_hash: codexCredentialPayloadDigest(launchToken),
      created_at: input.now,
      expires_at: input.expires_at,
    };
    const leaseRecord: CodexLaunchLeasePrivateRecord = this.codexRuntimeJobLaunchLeaseRecord(input, lease);
    if (!this.codexLaunchFenceIsActive(leaseRecord, undefined, input.now)) {
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

    const envelope: CodexLaunchTokenEnvelope = {
      ...clone(sealedEnvelope),
      status: 'available',
      created_at: input.now,
    };
    const runtimeJob: CodexRuntimeJob = {
      id: input.runtime_job_id,
      job_request_id: input.job_request_id,
      target_type: input.target.target_type,
      target_id: input.target.target_id,
      target_kind: input.target.target_kind,
      project_id: input.target.project_id,
      ...(input.target.repo_id === undefined ? {} : { repo_id: input.target.repo_id }),
      worker_id: input.worker_id,
      launch_lease_id: input.launch_lease_id,
      launch_attempt: input.launch_attempt,
      status: 'queued',
      input_digest: input.input_digest,
      input_json: clone(input.input_json),
      ...(input.workspace_acquisition_digest === undefined
        ? {}
        : { workspace_acquisition_digest: input.workspace_acquisition_digest }),
      ...(input.workspace_acquisition_json === undefined ? {} : { workspace_acquisition_json: clone(input.workspace_acquisition_json) }),
      expires_at: input.expires_at,
      created_at: input.now,
      updated_at: input.now,
    };
    const pendingWorkspaceBundle =
      input.pending_workspace_bundle === undefined
        ? undefined
        : ({
            ...clone(this.codexPendingWorkspaceBundles.get(input.pending_workspace_bundle.bundle_id)!),
            runtime_job_id: input.runtime_job_id,
            status: 'bound' as const,
          } satisfies CodexPendingWorkspaceBundlePrivateRecord);
    const workspaceBundleArtifact =
      pendingWorkspaceBundle === undefined
        ? undefined
        : this.codexRuntimeWorkspaceBundleArtifactFromPending(input.runtime_job_id, pendingWorkspaceBundle, input.now);
    const runtimeJobRecord: CodexRuntimeJobPrivateRecord = {
      job: runtimeJob,
      runtime_profile_digest: input.runtime_profile_digest,
      credential_binding_id: input.credential_binding_id,
      credential_binding_version_id: input.credential_binding_version_id,
      credential_payload_digest: input.credential_payload_digest,
      docker_image_digest: input.docker_image_digest,
      network_policy_digest: input.network_policy_digest,
      ...(input.network_provider_config_digest === undefined
        ? {}
        : { network_provider_config_digest: input.network_provider_config_digest }),
      envelope_id: input.envelope_id,
      envelope_digest: envelope.envelope_digest,
      ...(workspaceBundleArtifact === undefined ? {} : { workspace_bundle_artifact_id: workspaceBundleArtifact.id }),
      ...(pendingWorkspaceBundle === undefined ? {} : { pending_workspace_bundle: pendingWorkspaceBundle }),
    };

    this.codexLaunchLeases.set(input.launch_lease_id, clone(leaseRecord));
    this.codexLaunchLeaseRequestIds.set(leaseRecord.lease_request_id, input.launch_lease_id);
    this.codexRuntimeJobs.set(input.runtime_job_id, clone(runtimeJobRecord));
    this.codexRuntimeJobRequestIds.set(input.job_request_id, input.runtime_job_id);
    this.codexRuntimeJobTargetAttempts.set(targetAttemptKey, input.runtime_job_id);
    this.codexLaunchTokenEnvelopes.set(input.envelope_id, clone(envelope));
    if (pendingWorkspaceBundle !== undefined) {
      this.codexPendingWorkspaceBundles.set(pendingWorkspaceBundle.bundle_id, clone(pendingWorkspaceBundle));
    }
    if (workspaceBundleArtifact !== undefined) {
      this.codexRuntimeJobArtifacts.set(workspaceBundleArtifact.id, clone(workspaceBundleArtifact));
    }
    worker.registration.active_lease_count += 1;
    this.codexWorkerRegistrations.set(input.worker_id, clone(worker));

    return {
      runtime_job: clone(runtimeJob),
      launch_lease: clone(lease),
      envelope: clone(envelope),
      replayed: false,
    };
  }

  async getCodexRuntimeJob(input: GetCodexRuntimeJobInput): Promise<CodexRuntimeJob | undefined> {
    return this.cloneMaybe(this.codexRuntimeJobs.get(input.runtime_job_id)?.job);
  }

  async getActiveCodexGenerationActionRunFence(input: GetActiveCodexGenerationActionRunFenceInput) {
    const record = this.codexRuntimeJobs.get(input.runtime_job_id);
    const leaseRecord = record === undefined ? undefined : this.codexLaunchLeases.get(record.job.launch_lease_id);
    if (
      record === undefined ||
      leaseRecord === undefined ||
      record.job.target_type !== 'automation_action_run' ||
      record.job.target_kind !== 'generation' ||
      record.job.target_id !== input.action_run_id ||
      !this.codexGenerationFenceIsActive(leaseRecord, input.now)
    ) {
      return undefined;
    }
    const actionRun = this.automationActionRuns.get(input.action_run_id);
    return actionRun === undefined
      ? undefined
      : {
          runtime_job: clone(record.job),
          action_run: clone(actionRun),
        };
  }

  async getCodexRuntimeJobEnvelope(input: GetCodexRuntimeJobEnvelopeInput): Promise<CodexLaunchTokenEnvelope | undefined> {
    const record = this.codexRuntimeJobs.get(input.runtime_job_id);
    return record === undefined ? undefined : this.cloneMaybe(this.codexLaunchTokenEnvelopes.get(record.envelope_id));
  }

  async getCodexRuntimeJobWorkload(input: GetCodexRuntimeJobWorkloadInput): Promise<CodexRuntimeJob> {
    const session = this.assertCodexRuntimeJobWorkerSession(
      input.runtime_job_id,
      input.worker_id,
      input.worker_session_token,
      input.now,
      'codex_runtime_job_unavailable',
    );
    this.recordCodexWorkerNonce(
      input.worker_id,
      input.worker_session_token,
      input.nonce,
      input.nonce_timestamp,
      input.now,
      input.replay_protection,
      session.session_epoch,
    );
    const record = this.codexRuntimeJobs.get(input.runtime_job_id);
    const leaseRecord = record === undefined ? undefined : this.codexLaunchLeases.get(record.job.launch_lease_id);
    if (
      record === undefined ||
      leaseRecord === undefined ||
      record.job.worker_id !== input.worker_id ||
      (record.job.status !== 'accepted' && record.job.status !== 'materializing') ||
      record.job.cancel_requested_at !== undefined ||
      record.job.expires_at <= input.now ||
      leaseRecord.lease.expires_at <= input.now ||
      (leaseRecord.lease.status !== 'active' && leaseRecord.lease.status !== 'materialized') ||
      !this.codexLaunchFenceIsActive(leaseRecord, undefined, input.now)
    ) {
      throw codexDenied('codex_runtime_job_unavailable', 'Codex runtime job workload was denied.');
    }
    return clone(record.job);
  }

  async pollCodexRuntimeJobs(input: PollCodexRuntimeJobsInput): Promise<CodexRuntimeJob[]> {
    const worker = this.assertWorkerSession(input.worker_id, input.worker_session_token, input.now, 'codex_runtime_job_unavailable');
    this.recordCodexWorkerNonce(
      input.worker_id,
      input.worker_session_token,
      input.nonce,
      input.nonce_timestamp,
      input.now,
      input.replay_protection,
    );
    if (worker.registration.status === 'draining') {
      return [];
    }
    return valuesFor(this.codexRuntimeJobs)
      .map((record) => record.job)
      .filter(
        (job) =>
          job.worker_id === input.worker_id &&
          job.status === 'queued' &&
          job.expires_at > input.now &&
          (input.target_kinds === undefined || input.target_kinds.includes(job.target_kind)),
      )
      .sort((left, right) => left.created_at.localeCompare(right.created_at))
      .slice(0, input.limit)
      .map((job) => clone(job));
  }

  async acceptCodexRuntimeJob(input: AcceptCodexRuntimeJobInput): Promise<CodexRuntimeJob> {
    const worker = this.assertWorkerSession(input.worker_id, input.worker_session_token, input.now, 'codex_runtime_job_unavailable');
    this.recordCodexWorkerNonce(
      input.worker_id,
      input.worker_session_token,
      input.nonce,
      input.nonce_timestamp,
      input.now,
      input.replay_protection,
    );
    const record = this.codexRuntimeJobs.get(input.runtime_job_id);
    const lease = record === undefined ? undefined : this.codexLaunchLeases.get(record.job.launch_lease_id);
    const envelope = record === undefined ? undefined : this.codexLaunchTokenEnvelopes.get(record.envelope_id);
    if (
      record === undefined ||
      lease === undefined ||
      envelope === undefined ||
      record.job.worker_id !== input.worker_id ||
      record.job.expires_at <= input.now ||
      lease.lease.status !== 'active' ||
      envelope.status !== 'available'
    ) {
      throw codexDenied('codex_runtime_job_unavailable', 'Codex runtime job accept was denied.');
    }
    if (record.job.status === 'accepted') {
      if (
        record.job.accept_idempotency_key === input.idempotency_key &&
        record.job.accept_request_digest === input.request_digest &&
        record.job.accepted_worker_session_digest === input.accepted_worker_session_digest &&
        record.job.accepted_session_public_key_id === input.accepted_session_public_key_id &&
        record.job.accepted_session_epoch === input.accepted_session_epoch
      ) {
        return clone(record.job);
      }
      throw codexDenied('codex_runtime_job_unavailable', 'Codex runtime job accept replay was denied.');
    }
    if (
      record.job.status !== 'queued' ||
      input.accepted_worker_session_digest !== worker.session_token_hash ||
      input.accepted_session_public_key_id !== worker.session_public_key_id ||
      input.accepted_session_epoch !== worker.session_epoch ||
      worker.session_public_key_expires_at <= input.now
    ) {
      throw codexDenied('codex_runtime_job_unavailable', 'Codex runtime job accept was denied.');
    }

    const accepted: CodexRuntimeJobPrivateRecord = {
      ...record,
      job: {
        ...record.job,
        status: 'accepted',
        accept_idempotency_key: input.idempotency_key,
        accept_request_digest: input.request_digest,
        accepted_at: input.now,
        accepted_worker_session_digest: input.accepted_worker_session_digest,
        accepted_session_public_key_id: input.accepted_session_public_key_id,
        accepted_session_public_key_expires_at: worker.session_public_key_expires_at,
        accepted_session_epoch: input.accepted_session_epoch,
        updated_at: input.now,
      },
    };
    this.codexRuntimeJobs.set(input.runtime_job_id, clone(accepted));
    return clone(accepted.job);
  }

  async claimCodexLaunchTokenEnvelope(input: ClaimCodexLaunchTokenEnvelopeInput): Promise<CodexLaunchTokenEnvelope> {
    const session = this.assertCodexRuntimeJobWorkerSession(
      input.runtime_job_id,
      input.worker_id,
      input.worker_session_token,
      input.now,
      'codex_launch_materialization_denied',
    );
    this.recordCodexWorkerNonce(
      input.worker_id,
      input.worker_session_token,
      input.nonce,
      input.nonce_timestamp,
      input.now,
      input.replay_protection,
      session.session_epoch,
    );
    const record = this.codexRuntimeJobs.get(input.runtime_job_id);
    const envelope = this.codexLaunchTokenEnvelopes.get(input.envelope_id);
    const lease = record === undefined ? undefined : this.codexLaunchLeases.get(record.job.launch_lease_id);
    if (
      record === undefined ||
      envelope === undefined ||
      lease === undefined ||
      record.envelope_id !== input.envelope_id ||
      record.job.worker_id !== input.worker_id ||
      record.job.expires_at <= input.now ||
      envelope.expires_at <= input.now ||
      record.job.accepted_worker_session_digest !== input.accepted_worker_session_digest ||
      record.job.accepted_session_public_key_id !== input.key_id ||
      record.job.accepted_session_epoch !== input.accepted_session_epoch ||
      session.session_public_key_id !== input.key_id ||
      session.session_epoch !== input.accepted_session_epoch ||
      session.session_public_key_expires_at <= input.now
    ) {
      throw codexDenied('codex_launch_materialization_denied', 'Codex launch token envelope claim was denied.');
    }
    if (envelope.status === 'claimed') {
      if (
        record.job.status !== 'terminal' &&
        lease.lease.expires_at > input.now &&
        (lease.lease.status === 'active' || lease.lease.status === 'materialized') &&
        envelope.claim_request_id === input.claim_request_id &&
        envelope.claim_request_digest === input.request_digest &&
        envelope.claimed_worker_session_digest === input.accepted_worker_session_digest &&
        envelope.claimed_key_id === input.key_id
      ) {
        return clone(envelope);
      }
      throw codexDenied('codex_launch_materialization_denied', 'Codex launch token envelope claim was denied.');
    }
    if (envelope.status !== 'available') {
      throw codexDenied('codex_launch_materialization_denied', 'Codex launch token envelope claim was denied.');
    }
    if (record.job.status !== 'accepted' || record.job.cancel_requested_at !== undefined || lease.lease.status !== 'active') {
      throw codexDenied('codex_launch_materialization_denied', 'Codex launch token envelope claim was denied.');
    }
    const claimed: CodexLaunchTokenEnvelope = {
      ...envelope,
      status: 'claimed',
      claim_request_id: input.claim_request_id,
      claim_request_digest: input.request_digest,
      claimed_worker_session_digest: input.accepted_worker_session_digest,
      claimed_key_id: input.key_id,
      claimed_at: input.now,
    };
    this.codexLaunchTokenEnvelopes.set(input.envelope_id, clone(claimed));
    return clone(claimed);
  }

  async materializeCodexRuntimeJob(input: MaterializeCodexRuntimeJobInput): Promise<CodexLaunchMaterialization> {
    const session = this.assertCodexRuntimeJobWorkerSession(
      input.runtime_job_id,
      input.worker_id,
      input.worker_session_token,
      input.now,
      'codex_launch_materialization_denied',
    );
    this.recordCodexWorkerNonce(
      input.worker_id,
      input.worker_session_token,
      input.nonce,
      input.nonce_timestamp,
      input.now,
      input.replay_protection,
      session.session_epoch,
    );
    const record = this.codexRuntimeJobs.get(input.runtime_job_id);
    const leaseRecord = this.codexLaunchLeases.get(input.launch_lease_id);
    const envelope = record === undefined ? undefined : this.codexLaunchTokenEnvelopes.get(record.envelope_id);
    if (
      record === undefined ||
      leaseRecord === undefined ||
      envelope === undefined ||
      record.job.launch_lease_id !== input.launch_lease_id ||
      record.job.worker_id !== input.worker_id ||
      record.job.accepted_worker_session_digest !== input.accepted_worker_session_digest ||
      record.job.accepted_session_public_key_id !== input.accepted_session_public_key_id ||
      record.job.accepted_session_epoch !== input.accepted_session_epoch ||
      record.job.expires_at <= input.now ||
      leaseRecord.lease.expires_at <= input.now ||
      leaseRecord.lease.worker_id !== input.worker_id ||
      leaseRecord.lease.lease_token_hash !== input.launch_token_hash ||
      envelope.status !== 'claimed' ||
      envelope.claimed_worker_session_digest !== input.accepted_worker_session_digest ||
      envelope.claimed_key_id !== input.accepted_session_public_key_id ||
      session.session_epoch !== input.accepted_session_epoch ||
      session.session_public_key_expires_at <= input.now
    ) {
      throw codexDenied('codex_launch_materialization_denied', 'Codex runtime job materialization was denied.');
    }
    if (record.job.status === 'materializing' || record.job.status === 'running') {
      if (
        record.job.materialization_request_id === input.materialization_request_id &&
        record.job.materialization_request_digest === input.request_digest &&
        leaseRecord.lease.status === 'materialized'
      ) {
        return this.codexRuntimeJobMaterialization(record, leaseRecord, input.now);
      }
      throw codexDenied('codex_launch_materialization_denied', 'Codex runtime job materialization was denied.');
    }
    if (record.job.cancel_requested_at !== undefined) {
      throw codexDenied('codex_launch_materialization_denied', 'Codex runtime job materialization was denied.');
    }
    if (record.job.status !== 'accepted' || leaseRecord.lease.status !== 'active') {
      throw codexDenied('codex_launch_materialization_denied', 'Codex runtime job materialization was denied.');
    }
    if (!this.codexLaunchFenceIsActive(leaseRecord, input.active_fence, input.now)) {
      throw codexDenied('codex_launch_materialization_denied', 'Codex runtime job materialization fence was denied.');
    }

    const materializedJob: CodexRuntimeJobPrivateRecord = {
      ...record,
      job: {
        ...record.job,
        status: 'materializing',
        materializing_at: input.now,
        materialization_request_id: input.materialization_request_id,
        materialization_request_digest: input.request_digest,
        updated_at: input.now,
      },
    };
    const materializedLease: CodexLaunchLeasePrivateRecord = {
      ...leaseRecord,
      lease: { ...leaseRecord.lease, status: 'materialized', materialized_at: input.now },
      materialization_request_hash: input.request_digest,
      materialized_at: input.now,
    };
    this.codexRuntimeJobs.set(input.runtime_job_id, clone(materializedJob));
    this.codexLaunchLeases.set(input.launch_lease_id, clone(materializedLease));
    return this.codexRuntimeJobMaterialization(materializedJob, materializedLease, input.now);
  }

  async startCodexRuntimeJob(input: StartCodexRuntimeJobInput): Promise<CodexRuntimeJob> {
    const session = this.assertCodexRuntimeJobWorkerSession(
      input.runtime_job_id,
      input.worker_id,
      input.worker_session_token,
      input.now,
      'codex_runtime_job_unavailable',
    );
    this.recordCodexWorkerNonce(
      input.worker_id,
      input.worker_session_token,
      input.nonce,
      input.nonce_timestamp,
      input.now,
      input.replay_protection,
      session.session_epoch,
    );
    const record = this.codexRuntimeJobs.get(input.runtime_job_id);
    const leaseRecord = record === undefined ? undefined : this.codexLaunchLeases.get(record.job.launch_lease_id);
    if (
      record === undefined ||
      leaseRecord === undefined ||
      record.job.worker_id !== input.worker_id ||
      leaseRecord.lease.worker_id !== input.worker_id ||
      leaseRecord.lease.status !== 'materialized' ||
      record.job.cancel_requested_at !== undefined ||
      record.job.expires_at <= input.now
    ) {
      throw codexDenied('codex_runtime_job_unavailable', 'Codex runtime job start was denied.');
    }
    if (record.job.status === 'running') {
      if (
        record.job.start_idempotency_key === input.idempotency_key &&
        record.job.start_request_digest === input.request_digest &&
        record.job.runtime_evidence_digest === input.runtime_evidence_digest &&
        record.job.launch_materialization_digest === input.launch_materialization_digest
      ) {
        return clone(record.job);
      }
      throw codexDenied('codex_runtime_job_unavailable', 'Codex runtime job start was denied.');
    }
    if (record.job.status !== 'materializing') {
      throw codexDenied('codex_runtime_job_unavailable', 'Codex runtime job start was denied.');
    }
    const started: CodexRuntimeJobPrivateRecord = {
      ...record,
      job: {
        ...record.job,
        status: 'running',
        start_idempotency_key: input.idempotency_key,
        start_request_digest: input.request_digest,
        runtime_evidence_digest: input.runtime_evidence_digest,
        launch_materialization_digest: input.launch_materialization_digest,
        started_at: input.now,
        updated_at: input.now,
      },
    };
    this.codexRuntimeJobs.set(input.runtime_job_id, clone(started));
    return clone(started.job);
  }

  async appendCodexRuntimeJobEvent(input: AppendCodexRuntimeJobEventInput): Promise<CodexRuntimeJob> {
    const session = this.assertCodexRuntimeJobWorkerSession(
      input.runtime_job_id,
      input.worker_id,
      input.worker_session_token,
      input.now,
      'codex_runtime_job_unavailable',
    );
    this.recordCodexWorkerNonce(
      input.worker_id,
      input.worker_session_token,
      input.nonce,
      input.nonce_timestamp,
      input.now,
      input.replay_protection,
      session.session_epoch,
    );
    const eventKey = `${input.runtime_job_id}:${input.event_id}`;
    const idempotencyKey = `${input.runtime_job_id}:${input.idempotency_key}`;
    const existingByEventId = this.codexRuntimeJobEventIds.get(eventKey);
    const existingEventIdByIdempotency = this.codexRuntimeJobEventIdempotency.get(idempotencyKey);
    if (existingByEventId !== undefined || existingEventIdByIdempotency !== undefined) {
      const existing =
        existingByEventId ??
        (existingEventIdByIdempotency === undefined
          ? undefined
          : this.codexRuntimeJobEventIds.get(`${input.runtime_job_id}:${existingEventIdByIdempotency}`));
      if (
        existing !== undefined &&
        existing.event_id === input.event_id &&
        existing.idempotency_key === input.idempotency_key &&
        existing.request_digest === input.request_digest
      ) {
        return clone(existing.job);
      }
      throw codexDenied('codex_runtime_job_unavailable', 'Codex runtime job event replay was denied.');
    }
    const record = this.codexRuntimeJobs.get(input.runtime_job_id);
    if (
      record === undefined ||
      record.job.worker_id !== input.worker_id ||
      record.job.status !== 'running' ||
      record.job.expires_at <= input.now
    ) {
      throw codexDenied('codex_runtime_job_unavailable', 'Codex runtime job event append was denied.');
    }
    const updated: CodexRuntimeJobPrivateRecord = {
      ...record,
      job: {
        ...record.job,
        last_event_at: input.now,
        updated_at: input.now,
      },
    };
    this.codexRuntimeJobs.set(input.runtime_job_id, clone(updated));
    this.codexRuntimeJobEventIds.set(eventKey, {
      runtime_job_id: input.runtime_job_id,
      event_id: input.event_id,
      idempotency_key: input.idempotency_key,
      request_digest: input.request_digest,
      job: clone(updated.job),
    });
    this.codexRuntimeJobEventIdempotency.set(idempotencyKey, input.event_id);
    return clone(updated.job);
  }

  async createOrReplayInternalArtifactObject(input: CreateInternalArtifactObjectInput): Promise<InternalArtifactObject> {
    assertInternalArtifactObjectInput(input);
    const existingByRefId = this.internalArtifactObjectRefs.get(input.ref);
    const existingByIdempotencyId = this.internalArtifactObjectOwnerIdempotency.get(internalArtifactOwnerIdempotencyKey(input));
    const existingByOwnerKindArtifactId = this.internalArtifactObjectOwnerKindArtifact.get(
      internalArtifactOwnerKindArtifactKey(input),
    );
    const existingByRef =
      existingByRefId === undefined ? undefined : this.internalArtifactObjects.get(existingByRefId);
    const existingByIdempotency =
      existingByIdempotencyId === undefined ? undefined : this.internalArtifactObjects.get(existingByIdempotencyId);
    const existingByOwnerKindArtifact =
      existingByOwnerKindArtifactId === undefined ? undefined : this.internalArtifactObjects.get(existingByOwnerKindArtifactId);

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
        return clone(existing);
      }
      throw codexDenied('codex_runtime_job_unavailable', 'internal_artifact_idempotency_drift');
    }

    const object = clone(input);
    this.internalArtifactObjects.set(object.id, object);
    this.internalArtifactObjectRefs.set(object.ref, object.id);
    this.internalArtifactObjectOwnerIdempotency.set(internalArtifactOwnerIdempotencyKey(object), object.id);
    this.internalArtifactObjectOwnerKindArtifact.set(internalArtifactOwnerKindArtifactKey(object), object.id);
    return clone(object);
  }

  async getInternalArtifactObjectByRef(input: GetInternalArtifactObjectByRefInput): Promise<InternalArtifactObject | undefined> {
    const id = this.internalArtifactObjectRefs.get(input.ref);
    const object = id === undefined ? undefined : this.internalArtifactObjects.get(id);
    if (object === undefined || (object.deleted_at !== undefined && input.include_deleted !== true)) {
      return undefined;
    }
    return clone(object);
  }

  async getInternalArtifactObjectById(id: string): Promise<InternalArtifactObject | undefined> {
    const object = this.internalArtifactObjects.get(id);
    if (object === undefined || object.deleted_at !== undefined) {
      return undefined;
    }
    return clone(object);
  }

  async tombstoneInternalArtifactObject(input: TombstoneInternalArtifactObjectInput): Promise<InternalArtifactObject> {
    const id = this.internalArtifactObjectRefs.get(input.ref);
    const object = id === undefined ? undefined : this.internalArtifactObjects.get(id);
    if (object === undefined) {
      throw codexDenied('codex_runtime_job_unavailable', 'internal_artifact_not_found');
    }
    const tombstoned = {
      ...object,
      deleted_at: input.deleted_at,
    };
    this.internalArtifactObjects.set(object.id, clone(tombstoned));
    return clone(tombstoned);
  }

  async createCodexRuntimeJobArtifact(input: CreateCodexRuntimeJobArtifactInput): Promise<CodexRuntimeJobArtifact> {
    await this.reserveCodexRuntimeJobArtifactUpload(input);
    return this.bindReservedCodexRuntimeJobArtifact(input);
  }

  async reserveCodexRuntimeJobArtifactUpload(input: ReserveCodexRuntimeJobArtifactUploadInput): Promise<void> {
    const session = this.preflightCreateCodexRuntimeJobArtifactUnlocked(input);
    this.recordCodexWorkerNonce(
      input.worker_id,
      input.worker_session_token,
      input.nonce,
      input.nonce_timestamp,
      input.now,
      input.replay_protection,
      session.session_epoch,
    );
  }

  async bindReservedCodexRuntimeJobArtifact(input: BindReservedCodexRuntimeJobArtifactInput): Promise<CodexRuntimeJobArtifact> {
    const record = this.codexRuntimeJobs.get(input.runtime_job_id);
    if (record === undefined) {
      throw codexDenied('codex_runtime_job_unavailable', 'Codex runtime job artifact upload was denied.');
    }
    if (record.job.accepted_session_epoch === undefined) {
      throw codexDenied('codex_runtime_job_unavailable', 'Codex runtime job artifact upload was denied.');
    }
    this.assertCodexRuntimeJobArtifactEligibility(record, input);
    this.assertCodexWorkerNonceRecorded(
      input.worker_id,
      input.worker_session_token,
      input.nonce,
      input.replay_protection,
      record.job.accepted_session_epoch,
    );
    this.assertCodexRuntimeJobArtifactObjectBinding(input);
    const existing = this.findCodexRuntimeJobArtifactReplay(input);
    if (existing !== undefined) {
      if (this.codexRuntimeJobArtifactReplayMatches(existing, input)) {
        return this.codexRuntimeJobArtifactPublic(existing, record);
      }
      throw codexDenied('codex_runtime_job_unavailable', 'Codex runtime job artifact replay was denied.');
    }
    const artifact: CodexRuntimeJobArtifactPrivateRecord = {
      id: input.artifact_id,
      runtime_job_id: input.runtime_job_id,
      artifact_idempotency_key: input.artifact_idempotency_key,
      kind: input.kind,
      name: input.name,
      content_type: input.content_type,
      digest: input.digest,
      internal_ref: input.internal_ref,
      internal_artifact_object_id: input.internal_artifact_object_id,
      size_bytes: input.size_bytes,
      metadata_json: clone(input.metadata_json),
      request_digest: input.request_digest,
      created_at: input.now,
    };
    this.codexRuntimeJobArtifacts.set(artifact.id, clone(artifact));
    return this.codexRuntimeJobArtifactPublic(artifact, record);
  }

  async listCodexRuntimeJobArtifacts(input: ListCodexRuntimeJobArtifactsInput): Promise<CodexRuntimeJobArtifact[]> {
    const record = this.codexRuntimeJobs.get(input.runtime_job_id);
    if (record === undefined) {
      return [];
    }
    return valuesFor(this.codexRuntimeJobArtifacts)
      .filter((artifact) => artifact.runtime_job_id === input.runtime_job_id)
      .sort(byCreatedAtThenId)
      .map((artifact) => this.codexRuntimeJobArtifactPublic(artifact, record));
  }

  async getCodexRuntimeJobArtifactByInternalRef(
    input: GetCodexRuntimeJobArtifactByInternalRefInput,
  ): Promise<CodexRuntimeJobArtifact | undefined> {
    const record = this.codexRuntimeJobs.get(input.runtime_job_id);
    if (record === undefined) {
      return undefined;
    }
    const artifact = valuesFor(this.codexRuntimeJobArtifacts).find(
      (candidate) => candidate.runtime_job_id === input.runtime_job_id && candidate.internal_ref === input.internal_ref,
    );
    if (artifact === undefined) {
      return undefined;
    }
    const object =
      artifact.internal_artifact_object_id === undefined ? undefined : this.internalArtifactObjects.get(artifact.internal_artifact_object_id);
    if (
      object === undefined ||
      object.deleted_at !== undefined ||
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
    return this.codexRuntimeJobArtifactPublic(artifact, record);
  }

  async createPendingWorkspaceBundleArtifact(input: CreatePendingWorkspaceBundleArtifactInput): Promise<void> {
    const activeLease = this.runWorkerLeases.get(input.run_session_id);
    const runSession = this.runSessions.get(input.run_session_id);
    const archiveBytes =
      input.archive_bytes_base64 === undefined ? undefined : Buffer.from(input.archive_bytes_base64, 'base64');
    const object =
      input.internal_artifact_object_id === undefined ? undefined : this.internalArtifactObjects.get(input.internal_artifact_object_id);
    if (
      activeLease === undefined ||
      runSession === undefined ||
      runSession.execution_package_id !== input.execution_package_id ||
      activeLease.id !== input.run_worker_lease_id ||
      activeLease.status !== 'active' ||
      activeLease.expires_at <= input.created_at ||
      input.internal_artifact_object_id === undefined
    ) {
      throw codexDenied('codex_runtime_job_unavailable', 'Runtime job pending workspace bundle fence was rejected.');
    }
    const archiveBytesBase64 = archiveBytes?.toString('base64');
    if (
      (archiveBytes !== undefined &&
        (archiveBytesBase64 !== input.archive_bytes_base64 ||
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
    const existing = this.codexPendingWorkspaceBundles.get(input.bundle_id);
    const pending: CodexPendingWorkspaceBundlePrivateRecord = {
      id: input.id,
      bundle_id: input.bundle_id,
      pending_artifact_ref: input.pending_artifact_ref,
      ...(input.internal_artifact_object_id === undefined
        ? {}
        : { internal_artifact_object_id: input.internal_artifact_object_id }),
      archive_digest: input.archive_digest,
      manifest_digest: input.manifest_digest,
      run_worker_lease_id: input.run_worker_lease_id,
      run_session_id: input.run_session_id,
      execution_package_id: input.execution_package_id,
      ...(input.archive_bytes_base64 === undefined ? {} : { archive_bytes_base64: input.archive_bytes_base64 }),
      size_bytes: input.size_bytes,
      workspace_acquisition_digest: input.workspace_acquisition_digest,
      workspace_acquisition_json: clone(input.workspace_acquisition_json),
      expires_at: input.expires_at,
      request_digest: input.request_digest,
      status: 'pending',
      created_at: input.created_at,
    };
    if (existing !== undefined) {
      if (
        existing.status === 'pending' &&
        existing.id === input.id &&
        existing.request_digest === input.request_digest &&
        valuesEqual(existing, pending)
      ) {
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
    this.codexPendingWorkspaceBundles.set(input.bundle_id, clone(pending));
  }

  async getWorkspaceBundleDownloadForRuntimeJob(
    input: GetWorkspaceBundleDownloadForRuntimeJobInput,
  ): Promise<WorkspaceBundleDownloadForRuntimeJob> {
    const session = this.assertCodexRuntimeJobWorkerSession(
      input.runtime_job_id,
      input.worker_id,
      input.worker_session_token,
      input.now,
      'codex_runtime_job_unavailable',
    );
    this.recordCodexWorkerNonce(
      input.worker_id,
      input.worker_session_token,
      input.nonce,
      input.nonce_timestamp,
      input.now,
      input.replay_protection,
      session.session_epoch,
    );
    const record = this.codexRuntimeJobs.get(input.runtime_job_id);
    const leaseRecord = record === undefined ? undefined : this.codexLaunchLeases.get(record.job.launch_lease_id);
    const pending = record?.pending_workspace_bundle;
    const artifact =
      record?.workspace_bundle_artifact_id === undefined
        ? undefined
        : this.codexRuntimeJobArtifacts.get(record.workspace_bundle_artifact_id);
    if (
      record === undefined ||
      leaseRecord === undefined ||
      pending === undefined ||
      artifact === undefined ||
      record.job.worker_id !== input.worker_id ||
      record.job.target_kind !== 'run_execution' ||
      (record.job.status !== 'accepted' && record.job.status !== 'materializing') ||
      record.job.cancel_requested_at !== undefined ||
      record.job.expires_at <= input.now ||
      leaseRecord.lease.expires_at <= input.now ||
      (leaseRecord.lease.status !== 'active' && leaseRecord.lease.status !== 'materialized') ||
      input.bundle_id !== pending.bundle_id ||
      pending.status !== 'bound' ||
      pending.runtime_job_id !== record.job.id ||
      pending.expires_at <= input.now ||
      artifact.runtime_job_id !== record.job.id ||
      artifact.kind !== 'workspace_bundle' ||
      artifact.name !== pending.bundle_id ||
      artifact.digest !== pending.archive_digest ||
      artifact.size_bytes !== pending.size_bytes ||
      artifact.internal_ref !== pending.pending_artifact_ref ||
      artifact.internal_artifact_object_id !== pending.internal_artifact_object_id ||
      record.job.workspace_acquisition_json?.bundle_id !== pending.bundle_id ||
      record.job.workspace_acquisition_json?.archive_ref !== pending.pending_artifact_ref ||
      record.job.workspace_acquisition_json?.archive_digest !== pending.archive_digest ||
      record.job.workspace_acquisition_json?.manifest_digest !== pending.manifest_digest ||
      record.job.workspace_acquisition_json?.size_bytes !== pending.size_bytes
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
    const record = this.codexRuntimeJobs.get(input.runtime_job_id);
    if (record === undefined) {
      throw codexDenied('codex_runtime_job_unavailable', 'Codex runtime job cancel was denied.');
    }
    if (record.job.cancel_requested_at !== undefined) {
      if (record.job.cancel_idempotency_key !== input.idempotency_key || record.job.cancel_request_digest !== input.request_digest) {
        throw codexDenied('codex_runtime_job_unavailable', 'Codex runtime job cancel was denied.');
      }
      return clone(record.job);
    }
    const leaseRecord = this.codexLaunchLeases.get(record.job.launch_lease_id);
    const envelope = this.codexLaunchTokenEnvelopes.get(record.envelope_id);
    const terminalizeImmediately =
      record.job.status === 'queued' ||
      (record.job.status === 'accepted' && envelope !== undefined && envelope.status === 'available');
    if (terminalizeImmediately) {
      const cancelled: CodexRuntimeJobPrivateRecord = {
        ...record,
        job: {
          ...record.job,
          status: 'terminal',
          cancel_requested_at: input.now,
          cancel_idempotency_key: input.idempotency_key,
          cancel_request_digest: input.request_digest,
          terminal_idempotency_key: input.idempotency_key,
          terminal_request_digest: input.request_digest,
          terminal_at: input.now,
          terminal_status: 'cancelled',
          terminal_reason_code: input.reason_code,
          updated_at: input.now,
        },
      };
      this.codexRuntimeJobs.set(input.runtime_job_id, clone(cancelled));
      if (leaseRecord !== undefined && (leaseRecord.lease.status === 'active' || leaseRecord.lease.status === 'materialized')) {
        const revoked: CodexLaunchLeasePrivateRecord = {
          ...leaseRecord,
          lease: { ...leaseRecord.lease, status: 'revoked', revoked_at: input.now, terminal_reason_code: input.reason_code },
          terminal_reason_code: input.reason_code,
        };
        this.codexLaunchLeases.set(leaseRecord.lease.id, clone(revoked));
        this.releaseCodexRuntimeWorkerSlot(leaseRecord);
      }
      if (envelope !== undefined && envelope.status === 'available') {
        this.codexLaunchTokenEnvelopes.set(envelope.id, { ...clone(envelope), status: 'revoked' });
      }
      return clone(cancelled.job);
    }
    if (record.job.status !== 'accepted' && record.job.status !== 'materializing' && record.job.status !== 'running') {
      throw codexDenied('codex_runtime_job_unavailable', 'Codex runtime job cancel was denied.');
    }
    const cancelRequested: CodexRuntimeJobPrivateRecord = {
      ...record,
      job: {
        ...record.job,
        cancel_requested_at: input.now,
        cancel_idempotency_key: input.idempotency_key,
        cancel_request_digest: input.request_digest,
        ...(record.job.status === 'running' ? { drain_requested_at: input.now } : {}),
        updated_at: input.now,
      },
    };
    this.codexRuntimeJobs.set(input.runtime_job_id, clone(cancelRequested));
    return clone(cancelRequested.job);
  }

  async terminalizeCodexRuntimeJob(input: TerminalizeCodexRuntimeJobInput): Promise<CodexRuntimeJob> {
    const session = this.assertCodexRuntimeJobWorkerSession(
      input.runtime_job_id,
      input.worker_id,
      input.worker_session_token,
      input.now,
      'codex_runtime_job_unavailable',
      {
        requireConnected: false,
      },
    );
    this.recordCodexWorkerNonce(
      input.worker_id,
      input.worker_session_token,
      input.nonce,
      input.nonce_timestamp,
      input.now,
      input.replay_protection,
      session.session_epoch,
    );
    const record = this.codexRuntimeJobs.get(input.runtime_job_id);
    const leaseRecord = this.codexLaunchLeases.get(input.launch_lease_id);
    if (
      record === undefined ||
      leaseRecord === undefined ||
      record.job.launch_lease_id !== input.launch_lease_id ||
      record.job.worker_id !== input.worker_id ||
      leaseRecord.lease.worker_id !== input.worker_id
    ) {
      throw codexDenied('codex_runtime_job_unavailable', 'Codex runtime job terminalization was denied.');
    }
    if (record.job.status === 'terminal') {
      if (record.job.terminal_idempotency_key === input.idempotency_key && record.job.terminal_request_digest === input.request_digest) {
        return clone(record.job);
      }
      throw codexDenied('codex_runtime_job_unavailable', 'Codex runtime job terminalization was denied.');
    }
    if (
      record.job.status !== 'accepted' &&
      record.job.status !== 'materializing' &&
      record.job.status !== 'running'
    ) {
      throw codexDenied('codex_runtime_job_unavailable', 'Codex runtime job terminalization was denied.');
    }
    if (leaseRecord.lease.status !== 'active' && leaseRecord.lease.status !== 'materialized') {
      throw codexDenied('codex_runtime_job_unavailable', 'Codex runtime job terminalization was denied.');
    }
    if (record.job.expires_at <= input.now || leaseRecord.lease.expires_at <= input.now) {
      throw codexDenied('codex_runtime_job_unavailable', 'Codex runtime job terminalization was denied.');
    }
    if (record.job.cancel_requested_at !== undefined && input.terminal_status !== 'cancelled') {
      throw codexDenied('codex_runtime_job_unavailable', 'Codex runtime job terminalization was denied.');
    }
    if (
      input.terminal_status === 'succeeded' &&
      (record.job.status !== 'running' ||
        leaseRecord.lease.status !== 'materialized' ||
        record.job.started_at === undefined ||
        record.job.runtime_evidence_digest === undefined ||
        record.job.launch_materialization_digest === undefined)
    ) {
      throw codexDenied('codex_runtime_job_unavailable', 'Codex runtime job terminalization was denied.');
    }
    const terminalResultJson =
      input.terminal_result_json === undefined
        ? undefined
        : clone(validateCodexRuntimeJobTerminalResult(input.terminal_result_json) as unknown as Record<string, unknown>);
    if (terminalResultJson !== undefined) {
      this.assertCodexRuntimeTerminalArtifactRefs(input.runtime_job_id, terminalResultJson);
    }
    const terminalJob: CodexRuntimeJobPrivateRecord = {
      ...record,
      job: {
        ...record.job,
        status: 'terminal',
        terminal_idempotency_key: input.idempotency_key,
        terminal_request_digest: input.request_digest,
        terminal_at: input.now,
        terminal_status: input.terminal_status,
        terminal_reason_code: input.reason_code,
        ...(terminalResultJson === undefined ? {} : { terminal_result_json: terminalResultJson }),
        updated_at: input.now,
      },
    };
    const terminalLease: CodexLaunchLeasePrivateRecord = {
      ...leaseRecord,
      lease: {
        ...leaseRecord.lease,
        status: 'terminal',
        terminal_at: input.now,
        terminal_reason_code: input.reason_code,
        terminal_runtime_job_id: input.runtime_job_id,
        terminal_idempotency_key: input.idempotency_key,
        ...(terminalResultJson === undefined ? {} : { terminal_evidence_summary: clone(terminalResultJson) }),
      },
      terminal_reason_code: input.reason_code,
      terminal_runtime_job_id: input.runtime_job_id,
      terminal_idempotency_key: input.idempotency_key,
      ...(terminalResultJson === undefined ? {} : { terminal_evidence_summary: clone(terminalResultJson) }),
    };
    this.codexRuntimeJobs.set(input.runtime_job_id, clone(terminalJob));
    this.codexLaunchLeases.set(input.launch_lease_id, clone(terminalLease));
    this.releaseCodexRuntimeWorkerSlot(leaseRecord);
    return clone(terminalJob.job);
  }

  async recoverStaleCodexRuntimeJobs(input: RecoverStaleCodexRuntimeJobsInput): Promise<RecoverStaleCodexRuntimeJobsResult> {
    assertCodexRuntimeRecoveryReasonCode(input.reason_code);
    const recoveredRuntimeJobs: RecoverStaleCodexRuntimeJobsResult['recovered_runtime_jobs'] = [];
    const recoveredLaunchLeases: RecoverStaleCodexRuntimeJobsResult['recovered_launch_leases'] = [];
    for (const [id, record] of this.codexRuntimeJobs.entries()) {
      if (record.job.status === 'terminal' || (input.worker_id !== undefined && record.job.worker_id !== input.worker_id)) {
        continue;
      }
      const leaseRecord = this.codexLaunchLeases.get(record.job.launch_lease_id);
      const leaseAlreadyTerminal =
        leaseRecord !== undefined &&
        (leaseRecord.lease.status === 'terminal' || leaseRecord.lease.status === 'expired' || leaseRecord.lease.status === 'revoked');
      const staleAt = record.job.last_event_at ?? record.job.updated_at;
      if (!leaseAlreadyTerminal && record.job.expires_at > input.stale_before && staleAt >= input.stale_before) {
        continue;
      }
      const terminalJob: CodexRuntimeJobPrivateRecord = {
        ...record,
        job: {
          ...record.job,
          status: 'terminal',
          terminal_at: input.now,
          terminal_status: 'expired',
          terminal_reason_code: input.reason_code,
          updated_at: input.now,
        },
      };
      this.codexRuntimeJobs.set(id, clone(terminalJob));
      recoveredRuntimeJobs.push(this.codexRuntimeJobRecoveryEvidence(terminalJob.job));
      if (leaseRecord !== undefined && (leaseRecord.lease.status === 'active' || leaseRecord.lease.status === 'materialized')) {
        const expired: CodexLaunchLeasePrivateRecord = {
          ...leaseRecord,
          lease: { ...leaseRecord.lease, status: 'expired', terminal_reason_code: input.reason_code },
          terminal_reason_code: input.reason_code,
        };
        this.codexLaunchLeases.set(leaseRecord.lease.id, clone(expired));
        this.releaseCodexRuntimeWorkerSlot(leaseRecord);
        recoveredLaunchLeases.push(this.codexLaunchLeaseRecoveryEvidence(expired.lease));
      }
    }
    return { recovered_runtime_jobs: recoveredRuntimeJobs, recovered_launch_leases: recoveredLaunchLeases };
  }

  async getCodexLaunchLeaseStatus(input: GetCodexLaunchLeaseStatusInput): Promise<CodexLaunchLease> {
    this.assertWorkerSession(input.worker_id, input.worker_session_token, input.now, 'codex_runtime_job_unavailable', {
      requireConnected: false,
    });
    this.recordCodexWorkerNonce(
      input.worker_id,
      input.worker_session_token,
      input.nonce,
      input.nonce_timestamp,
      input.now,
      input.replay_protection,
    );
    const record = this.codexLaunchLeases.get(input.launch_lease_id);
    if (record === undefined || record.lease.worker_id !== input.worker_id) {
      throw codexDenied('codex_runtime_job_unavailable', 'Codex launch lease status was denied.');
    }
    return clone(record.lease);
  }

  async getCodexLaunchLeasePublicStatus(input: GetCodexLaunchLeasePublicStatusInput): Promise<CodexLaunchLease | undefined> {
    return this.cloneMaybe(this.codexLaunchLeases.get(input.launch_lease_id)?.lease);
  }

  async createOrReplayCodexLaunchLease(input: CreateOrReplayCodexLaunchLeaseInput): Promise<CodexLaunchLeaseWithToken> {
    validateCodexLaunchTargetKind(input.target.target_type, input.target.target_kind);
    const existingId = this.codexLaunchLeaseRequestIds.get(input.lease_request_id);
    if (existingId !== undefined) {
      const existing = this.codexLaunchLeases.get(existingId);
      if (existing === undefined) {
        throw codexDenied('codex_launch_lease_denied', 'Launch lease idempotency record is inconsistent.');
      }
      const expectedHash = codexCredentialPayloadDigest(input.launch_token);
      if (existing.lease.status !== 'active' || !this.launchReplayMatches(existing, input) || existing.lease.lease_token_hash !== expectedHash) {
        throw codexDenied('codex_launch_lease_denied', 'Launch lease request id replay did not match original request.');
      }
      return { ...clone(existing.lease), lease_token: input.launch_token };
    }
    if (this.findCodexLaunchLeaseForTargetAttempt(input.target, input.launch_attempt) !== undefined) {
      throw codexDenied('codex_launch_lease_denied', 'Launch lease target attempt already has a lease.');
    }

    const profileRevision = this.codexRuntimeProfileRevisions.get(input.runtime_profile_revision_id);
    const profileNetworkPolicy = profileRevision === undefined ? undefined : normalizeCodexRuntimeNetworkPolicy(profileRevision.network_policy);
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
    const worker = this.codexWorkerRegistrations.get(input.worker_id);
    if (
      worker === undefined ||
      (await this.findAvailableCodexWorker({
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
      throw codexDenied('codex_launch_lease_denied', 'Launch lease credential fence was rejected.');
    }

    const lease: CodexLaunchLease = {
      id: input.id,
      target: clone(input.target),
      launch_attempt: input.launch_attempt,
      profile_revision_id: input.runtime_profile_revision_id,
      worker_id: input.worker_id,
      status: 'active',
      lease_token_hash: codexCredentialPayloadDigest(input.launch_token),
      created_at: input.now,
      expires_at: input.expires_at,
    };
    const privateRecord: CodexLaunchLeasePrivateRecord = {
      lease,
      lease_request_id: input.lease_request_id,
      runtime_profile_digest: input.runtime_profile_digest,
      credential_binding_id: input.credential_binding_id,
      credential_binding_version_id: input.credential_binding_version_id,
      credential_payload_digest: input.credential_payload_digest,
      docker_image_digest: input.docker_image_digest,
      network_policy_digest: input.network_policy_digest,
      ...(input.network_provider_config_digest !== undefined
        ? { network_provider_config_digest: input.network_provider_config_digest }
        : {}),
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
    };
    this.codexLaunchLeases.set(input.id, clone(privateRecord));
    this.codexLaunchLeaseRequestIds.set(input.lease_request_id, input.id);
    worker.registration.active_lease_count += 1;
    this.codexWorkerRegistrations.set(input.worker_id, clone(worker));
    return { ...clone(lease), lease_token: input.launch_token };
  }

  async materializeCodexLaunchLease(input: MaterializeCodexLaunchLeaseInput): Promise<CodexLaunchMaterialization> {
    const worker = this.assertWorkerSession(input.worker_id, input.worker_session_token, input.now);
    this.recordCodexWorkerNonce(
      input.worker_id,
      input.worker_session_token,
      input.nonce,
      input.nonce_timestamp,
      input.now,
      input.replay_protection,
    );
    const record = this.codexLaunchLeases.get(input.lease_id);
    if (
      record === undefined ||
      record.lease.worker_id !== input.worker_id ||
      record.lease.status !== 'active' ||
      record.lease.expires_at <= input.now ||
      record.lease.lease_token_hash !== codexCredentialPayloadDigest(input.launch_token) ||
      !this.codexLaunchFenceIsActive(record, input.active_fence, input.now)
    ) {
      throw codexDenied('codex_launch_materialization_denied', 'Codex launch lease materialization was denied.');
    }
    const profileRevision = this.codexRuntimeProfileRevisions.get(record.lease.profile_revision_id);
    const credentialRecord = this.codexCredentialBindingVersions.get(record.credential_binding_version_id);
    if (
      profileRevision === undefined ||
      profileRevision.status !== 'active' ||
      profileRevision.profile_digest !== record.runtime_profile_digest ||
      credentialRecord === undefined ||
      credentialRecord.version.status !== 'active' ||
      credentialRecord.version.payload_digest !== record.credential_payload_digest ||
      this.codexCredentialBindings.get(record.credential_binding_id)?.profile_id !== profileRevision.profile_id ||
      !this.workerStillMatchesLaunch(worker, record, profileRevision)
    ) {
      throw codexDenied('codex_launch_materialization_denied', 'Codex launch lease materialization dependencies were unavailable.');
    }
    const materializedRecord: CodexLaunchLeasePrivateRecord = {
      ...record,
      lease: { ...record.lease, status: 'materialized', materialized_at: input.now },
      materialization_request_hash: input.materialization_request_hash,
      materialized_at: input.now,
    };
    this.codexLaunchLeases.set(input.lease_id, clone(materializedRecord));
    return {
      launch_target: clone(record.lease.target),
      profile_revision: clone(profileRevision),
      resolved_credentials: [
        {
          binding_id: record.credential_binding_id,
          binding_version_id: credentialRecord.version.id,
          payload: clone(credentialRecord.secret_payload_json),
          payload_digest: credentialRecord.version.payload_digest,
        },
      ],
      lease_id: record.lease.id,
      expires_at: record.lease.expires_at,
      materialized_at: input.now,
    };
  }

  async terminalizeCodexLaunchLease(input: TerminalizeCodexLaunchLeaseInput): Promise<CodexLaunchLease> {
    this.assertWorkerSession(input.worker_id, input.worker_session_token, input.now, 'codex_launch_lease_denied', {
      requireConnected: false,
    });
    this.recordCodexWorkerNonce(
      input.worker_id,
      input.worker_session_token,
      input.nonce,
      input.nonce_timestamp,
      input.now,
      input.replay_protection,
    );
    const record = this.codexLaunchLeases.get(input.lease_id);
    if (record === undefined || record.lease.worker_id !== input.worker_id) {
      throw codexDenied('codex_launch_lease_denied', 'Codex launch lease terminalization was denied.');
    }
    if (record.terminal_reason_code !== undefined || record.lease.status === 'expired' || record.lease.status === 'revoked') {
      if (
        record.lease.status === 'terminal' &&
        record.terminal_idempotency_key !== undefined &&
        record.terminal_idempotency_key !== input.idempotency_key
      ) {
        throw codexDenied('codex_launch_lease_denied', 'Codex launch lease terminalization idempotency key was rejected.');
      }
      if (record.lease.status === 'terminal' || record.lease.status === 'expired' || record.lease.status === 'revoked') {
        return clone(record.lease);
      }
      throw codexDenied('codex_launch_lease_denied', 'Codex launch lease terminalization was denied.');
    }
    if (record.lease.status !== 'active' && record.lease.status !== 'materialized') {
      throw codexDenied('codex_launch_lease_denied', 'Codex launch lease terminalization was denied.');
    }
    const worker = this.codexWorkerRegistrations.get(input.worker_id);
    const terminal = {
      ...record,
      lease: {
        ...record.lease,
        status: 'terminal' as const,
        terminal_at: input.now,
        terminal_reason_code: input.reason_code,
        ...(input.evidence_summary === undefined ? {} : { terminal_evidence_summary: clone(input.evidence_summary) }),
        ...(input.runtime_job_id === undefined ? {} : { terminal_runtime_job_id: input.runtime_job_id }),
        terminal_idempotency_key: input.idempotency_key,
      },
      terminal_reason_code: input.reason_code,
      ...(input.evidence_summary === undefined ? {} : { terminal_evidence_summary: clone(input.evidence_summary) }),
      ...(input.runtime_job_id === undefined ? {} : { terminal_runtime_job_id: input.runtime_job_id }),
      terminal_idempotency_key: input.idempotency_key,
    };
    this.codexLaunchLeases.set(input.lease_id, clone(terminal));
    if (this.codexLaunchLeaseOccupiesWorkerSlot(record) && worker !== undefined) {
      worker.registration.active_lease_count = Math.max(0, worker.registration.active_lease_count - 1);
      this.codexWorkerRegistrations.set(input.worker_id, clone(worker));
    }
    return clone(terminal.lease);
  }

  async revokeCodexLaunchLease(input: RevokeCodexLaunchLeaseInput): Promise<CodexLaunchLease> {
    const record = this.codexLaunchLeases.get(input.lease_id);
    if (record === undefined) {
      throw codexDenied('codex_launch_lease_denied', 'Codex launch lease was not found.');
    }
    if (record.lease.status === 'terminal' || record.lease.status === 'expired' || record.lease.status === 'revoked') {
      return clone(record.lease);
    }
    if (record.lease.status !== 'active' && record.lease.status !== 'materialized') {
      throw codexDenied('codex_launch_lease_denied', 'Codex launch lease was not found.');
    }
    const worker = record.lease.worker_id === undefined ? undefined : this.codexWorkerRegistrations.get(record.lease.worker_id);
    const revoked = {
      ...record,
      lease: { ...record.lease, status: 'revoked' as const, revoked_at: input.now, terminal_reason_code: input.reason_code },
      terminal_reason_code: input.reason_code,
    };
    this.codexLaunchLeases.set(input.lease_id, clone(revoked));
    if (this.codexLaunchLeaseOccupiesWorkerSlot(record) && record.lease.worker_id !== undefined && worker !== undefined) {
      worker.registration.active_lease_count = Math.max(0, worker.registration.active_lease_count - 1);
      this.codexWorkerRegistrations.set(record.lease.worker_id, clone(worker));
    }
    return clone(revoked.lease);
  }

  async expireCodexLaunchLeases(now: string): Promise<number> {
    let count = 0;
    for (const [id, record] of this.codexLaunchLeases.entries()) {
      if ((record.lease.status === 'active' || record.lease.status === 'materialized') && record.lease.expires_at <= now) {
        this.codexLaunchLeases.set(
          id,
          clone({ ...record, lease: { ...record.lease, status: 'expired' as const, terminal_reason_code: 'codex_launch_lease_expired' } }),
        );
        if (this.codexLaunchLeaseOccupiesWorkerSlot(record) && record.lease.worker_id !== undefined) {
          const worker = this.codexWorkerRegistrations.get(record.lease.worker_id);
          if (worker !== undefined) {
            worker.registration.active_lease_count = Math.max(0, worker.registration.active_lease_count - 1);
            this.codexWorkerRegistrations.set(record.lease.worker_id, clone(worker));
          }
        }
        count += 1;
      }
    }
    return count;
  }

  async recoverStaleCodexWorkerLeases(input: RecoverStaleCodexWorkerLeasesInput): Promise<CodexRuntimeRecoveryResult> {
    const staleWorkerIds = new Set(
      valuesFor(this.codexWorkerRegistrations)
        .filter(
          (worker) =>
            (input.worker_id === undefined || worker.registration.id === input.worker_id) &&
            (worker.registration.last_heartbeat_at === undefined || worker.registration.last_heartbeat_at < input.stale_before),
        )
        .map((worker) => worker.registration.id),
    );
    const recovered: CodexLaunchLease[] = [];
    const automation_action_transitions: CodexRuntimeRecoveryResult['automation_action_transitions'] = [];
    const run_session_transitions: CodexRuntimeRecoveryResult['run_session_transitions'] = [];
    for (const workerId of staleWorkerIds) {
      const worker = this.codexWorkerRegistrations.get(workerId);
      if (worker !== undefined) {
        this.codexWorkerRegistrations.set(workerId, {
          ...clone(worker),
          registration: {
            ...clone(worker.registration),
            status: 'offline',
            control_channel_status: 'disconnected',
          },
        });
      }
    }
    for (const [id, record] of this.codexLaunchLeases.entries()) {
      if (this.codexLaunchLeaseBelongsToRuntimeJob(record)) {
        continue;
      }
      const recoverableLease =
        record.lease.status === 'active' ||
        (record.lease.status === 'materialized' && record.materialized_at !== undefined && record.terminal_reason_code === undefined);
      if (record.lease.worker_id !== undefined && staleWorkerIds.has(record.lease.worker_id) && recoverableLease) {
        const expired = {
          ...record,
          lease: { ...record.lease, status: 'expired' as const, terminal_reason_code: input.reason_code },
          terminal_reason_code: input.reason_code,
        };
        this.codexLaunchLeases.set(id, clone(expired));
        const worker = this.codexWorkerRegistrations.get(record.lease.worker_id);
        if (worker !== undefined) {
          worker.registration.active_lease_count = Math.max(0, worker.registration.active_lease_count - 1);
          this.codexWorkerRegistrations.set(record.lease.worker_id, clone(worker));
        }
        recovered.push(clone(expired.lease));
        if (this.codexLaunchLeaseHasOwningAutomationAction(record)) {
          this.markCodexRecoveredAutomationAction(record.lease.target.target_id, input.reason_code, input.now);
          automation_action_transitions.push({
            ...(record.action_type === undefined ? {} : { action_type: record.action_type }),
            target_id: record.lease.target.target_id,
            reason_code: input.reason_code,
          });
        }
        if (record.execution_package_id !== undefined || record.run_worker_lease_id !== undefined) {
          const runSessionId = this.markCodexRecoveredRunSession(record.run_worker_lease_id, input.reason_code, input.now);
          run_session_transitions.push({
            ...(runSessionId === undefined ? {} : { run_session_id: runSessionId }),
            ...(record.execution_package_id === undefined ? {} : { execution_package_id: record.execution_package_id }),
            reason_code: input.reason_code,
          });
        }
      }
    }
    return { recovered_launch_leases: recovered, automation_action_transitions, run_session_transitions };
  }

  async consumeCodexRuntimeSetupNonce(input: ConsumeCodexRuntimeSetupNonceInput): Promise<void> {
    for (const [key, record] of this.codexRuntimeSetupNonces.entries()) {
      if (record.expires_at <= input.created_at) {
        this.codexRuntimeSetupNonces.delete(key);
      }
    }
    const existing = this.codexRuntimeSetupNonces.get(input.setup_nonce_hash);
    if (existing !== undefined && existing.expires_at > input.created_at) {
      throw codexDenied('codex_worker_nonce_replay', 'Codex runtime setup nonce was already used.');
    }
    this.codexRuntimeSetupNonces.set(input.setup_nonce_hash, clone(input));
  }

  async createPlanItemWorkflowWithInitialSession(
    input: CreatePlanItemWorkflowWithInitialSessionInput,
  ): Promise<{ workflow: PlanItemWorkflow; session: CodexSession }> {
    if (this.planItemWorkflows.has(input.id)) {
      throw new DomainError('workflow_invalid_transition', `workflow_invalid_transition: Workflow ${input.id} already exists`);
    }
    if (this.codexSessions.has(input.codex_session_id)) {
      throw new DomainError('workflow_invalid_transition', `workflow_invalid_transition: Codex session ${input.codex_session_id} already exists`);
    }
    if (this.getActivePlanItemWorkflowByItemSync(input.development_plan_item_id) !== undefined) {
      throw new DomainError(
        'workflow_active_session_conflict',
        `workflow_active_session_conflict: Plan item ${input.development_plan_item_id} already has an active workflow`,
      );
    }
    const existingActiveSession = this.findActiveCodexSessionForWorkflow(input.id);
    if (existingActiveSession !== undefined) {
      throw new DomainError(
        'workflow_active_session_conflict',
        `workflow_active_session_conflict: Workflow ${input.id} already has an active Codex session`,
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
    this.assertCanSavePlanItemWorkflow(workflow);
    this.assertCanSaveCodexSession(session);
    this.planItemWorkflows.set(workflow.id, clone(workflow));
    this.codexSessions.set(session.id, clone(session));
    return { workflow: clone(workflow), session: clone(session) };
  }

  async getPlanItemWorkflow(id: string): Promise<PlanItemWorkflow | undefined> {
    return this.cloneMaybe(this.planItemWorkflows.get(id));
  }

  async getActivePlanItemWorkflowByItem(itemId: string): Promise<PlanItemWorkflow | undefined> {
    return this.cloneMaybe(this.getActivePlanItemWorkflowByItemSync(itemId));
  }

  async savePlanItemWorkflow(workflow: PlanItemWorkflow): Promise<void> {
    const existingWorkflow = this.planItemWorkflows.get(workflow.id);
    if (existingWorkflow === undefined) {
      throw new DomainError(
        'workflow_invalid_transition',
        `workflow_invalid_transition: Plan Item Workflow ${workflow.id} does not exist`,
      );
    }
    if (
      existingWorkflow.development_plan_id !== workflow.development_plan_id ||
      existingWorkflow.development_plan_item_id !== workflow.development_plan_item_id ||
      existingWorkflow.created_by_actor_id !== workflow.created_by_actor_id ||
      existingWorkflow.created_at !== workflow.created_at
    ) {
      throw new DomainError(
        'workflow_invalid_transition',
        `workflow_invalid_transition: Plan Item Workflow ${workflow.id} identity fields cannot change`,
      );
    }
    this.assertCanSavePlanItemWorkflow(workflow);
    this.planItemWorkflows.set(workflow.id, clone(workflow));
  }

  async appendPlanItemWorkflowTransition(transition: PlanItemWorkflowTransition): Promise<void> {
    if (this.planItemWorkflowTransitions.has(transition.id)) {
      throw new DomainError('workflow_invalid_transition', `workflow_invalid_transition: Transition ${transition.id} already exists`);
    }
    this.planItemWorkflowTransitions.set(transition.id, clone(transition));
  }

  async listPlanItemWorkflowTransitions(workflowId: string): Promise<PlanItemWorkflowTransition[]> {
    return valuesFor(this.planItemWorkflowTransitions)
      .filter((transition) => transition.workflow_id === workflowId)
      .sort(byCreatedAtThenId);
  }

  async saveWorkflowManualDecision(decision: WorkflowManualDecision): Promise<void> {
    if (this.workflowManualDecisions.has(decision.id)) {
      throw new DomainError('workflow_invalid_transition', `workflow_invalid_transition: Workflow manual decision ${decision.id} already exists`);
    }
    this.workflowManualDecisions.set(decision.id, clone(decision));
  }

  async getWorkflowManualDecision(id: string): Promise<WorkflowManualDecision | undefined> {
    return this.cloneMaybe(this.workflowManualDecisions.get(id));
  }

  async saveExecutionReadinessRecord(record: ExecutionReadinessRecord): Promise<void> {
    if (this.executionReadinessRecords.has(record.id)) {
      throw new DomainError('workflow_invalid_transition', `workflow_invalid_transition: Execution readiness record ${record.id} already exists`);
    }
    this.executionReadinessRecords.set(record.id, clone(record));
  }

  async getExecutionReadinessRecord(id: string): Promise<ExecutionReadinessRecord | undefined> {
    return this.cloneMaybe(this.executionReadinessRecords.get(id));
  }

  async getBoundarySummaryRevisionById(revisionId: string): Promise<BoundarySummaryRevision | undefined> {
    return this.cloneMaybe(this.boundarySummaryRevisions.get(revisionId));
  }

  async resolveWorkflowRepositoryEvidence(
    input: WorkflowRepositoryEvidenceInput,
  ): Promise<{ repository_id: string; resolved_ref: string } | undefined> {
    const workflow = this.planItemWorkflows.get(input.workflow_id);
    if (
      workflow === undefined ||
      workflow.development_plan_id !== input.development_plan_id ||
      workflow.development_plan_item_id !== input.development_plan_item_id
    ) {
      return undefined;
    }
    const developmentPlan = this.developmentPlans.get(input.development_plan_id);
    if (developmentPlan === undefined) {
      return undefined;
    }
    const repos = valuesFor(this.projectRepos).filter(
      (repo) => repo.project_id === developmentPlan.project_id && repo.status !== 'archived',
    );
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
    const matchedRepo = repos.find((repo) => {
      const candidates = [repo.name, repo.remote_url].filter((value): value is string => value !== undefined);
      return candidates
        .map((candidate) => normalizeRepositoryNamespace(candidate))
        .some((namespace) => namespace === pullRequestUrl.namespace);
    });
    return matchedRepo === undefined
      ? undefined
      : { repository_id: matchedRepo.id, resolved_ref: evidence };
  }

  async getCodexSession(id: string): Promise<CodexSession | undefined> {
    return this.cloneMaybe(this.codexSessions.get(id));
  }

  async saveCodexSession(session: CodexSession): Promise<void> {
    const existingSession = this.codexSessions.get(session.id);
    if (existingSession === undefined) {
      throw new DomainError(
        'workflow_invalid_transition',
        `workflow_invalid_transition: Codex session ${session.id} does not exist`,
      );
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
      throw new DomainError(
        'workflow_invalid_transition',
        `workflow_invalid_transition: Codex session ${session.id} identity fields cannot change`,
      );
    }
    if (
      existingSession.forked_from_session_id !== session.forked_from_session_id ||
      existingSession.forked_from_turn_id !== session.forked_from_turn_id ||
      existingSession.forked_from_snapshot_id !== session.forked_from_snapshot_id ||
      existingSession.fork_reason !== session.fork_reason
    ) {
      throw new DomainError(
        'workflow_invalid_transition',
        `workflow_invalid_transition: Codex session ${session.id} fork provenance fields cannot change`,
      );
    }
    this.assertCanSaveCodexSession(session);
    this.codexSessions.set(session.id, clone(session));
  }

  async createCodexSessionTurn(turn: CodexSessionTurn): Promise<void> {
    if (this.codexSessionTurns.has(turn.id)) {
      throw new DomainError('workflow_invalid_transition', `workflow_invalid_transition: Codex session turn ${turn.id} already exists`);
    }
    const session = this.codexSessions.get(turn.codex_session_id);
    const workflow = session === undefined ? undefined : this.planItemWorkflows.get(session.owner_id);
    const cannotCreateTurn =
      session === undefined ||
      workflow === undefined ||
      session.owner_type !== 'plan_item_workflow' ||
      session.owner_id !== turn.workflow_id ||
      workflow.id !== turn.workflow_id ||
      workflow.active_codex_session_id !== session.id ||
      session.role !== 'active' ||
      !claimableCodexSessionStatuses.has(session.status);
    if (cannotCreateTurn) {
      throw new DomainError(
        'workflow_active_session_missing',
        `workflow_active_session_missing: Codex session ${turn.codex_session_id} is not active for workflow ${turn.workflow_id}`,
      );
    }
    if (session.latest_snapshot_digest !== turn.expected_previous_snapshot_digest) {
      throw new DomainError(
        'codex_session_snapshot_stale',
        `codex_session_snapshot_stale: Codex session ${turn.codex_session_id} snapshot is stale`,
      );
    }
    this.codexSessionTurns.set(turn.id, clone(turn));
    this.codexSessions.set(session.id, clone({ ...session, latest_turn_id: turn.id, latest_turn_digest: turn.input_digest, updated_at: turn.updated_at }));
  }

  async getCodexSessionTurn(id: string): Promise<CodexSessionTurn | undefined> {
    return this.cloneMaybe(this.codexSessionTurns.get(id));
  }

  async saveCodexSessionTurn(turn: CodexSessionTurn): Promise<void> {
    const existingTurn = this.codexSessionTurns.get(turn.id);
    if (existingTurn === undefined) {
      throw new DomainError(
        'workflow_invalid_transition',
        `workflow_invalid_transition: Codex session turn ${turn.id} does not exist`,
      );
    }
    if (
      existingTurn.codex_session_id !== turn.codex_session_id ||
      existingTurn.workflow_id !== turn.workflow_id ||
      existingTurn.created_at !== turn.created_at ||
      existingTurn.created_by_actor_id !== turn.created_by_actor_id
    ) {
      throw new DomainError(
        'workflow_invalid_transition',
        `workflow_invalid_transition: Codex session turn ${turn.id} identity fields cannot change`,
      );
    }
    this.codexSessionTurns.set(turn.id, clone(turn));
  }

  async createCodexSessionSnapshot(snapshot: CodexSessionSnapshot): Promise<void> {
    let parsedArtifactRef: ReturnType<typeof parseInternalArtifactRef>;
    try {
      parsedArtifactRef = parseInternalArtifactRef(snapshot.artifact_ref);
    } catch {
      throw new DomainError(
        'workflow_invalid_transition',
        `workflow_invalid_transition: Codex session snapshot ${snapshot.id} artifact_ref is not an internal artifact ref`,
      );
    }
    if (
      parsedArtifactRef.kind !== 'codex_session_snapshot' ||
      parsedArtifactRef.owner_type !== 'codex_session' ||
      parsedArtifactRef.owner_id !== snapshot.codex_session_id ||
      parsedArtifactRef.artifact_id !== snapshot.id
    ) {
      throw new DomainError(
        'workflow_invalid_transition',
        `workflow_invalid_transition: Codex session snapshot ${snapshot.id} artifact_ref does not match the snapshot identity`,
      );
    }
    const existingForSequence = valuesFor(this.codexSessionSnapshots).find(
      (candidate) => candidate.codex_session_id === snapshot.codex_session_id && candidate.sequence === snapshot.sequence,
    );
    const existingForArtifact = valuesFor(this.codexSessionSnapshots).find(
      (candidate) => candidate.artifact_ref === snapshot.artifact_ref,
    );
    if (this.codexSessionSnapshots.has(snapshot.id) || existingForSequence !== undefined || existingForArtifact !== undefined) {
      throw new DomainError('workflow_invalid_transition', `workflow_invalid_transition: Codex session snapshot ${snapshot.id} is not unique`);
    }
    this.codexSessionSnapshots.set(snapshot.id, clone(snapshot));
  }

  async getCodexSessionSnapshot(id: string): Promise<CodexSessionSnapshot | undefined> {
    return this.cloneMaybe(this.codexSessionSnapshots.get(id));
  }

  async saveStaleCodexSessionTerminalizationAttempt(attempt: CodexSessionStaleTerminalizationAttempt): Promise<void> {
    if (this.codexSessionStaleTerminalizationAttempts.has(attempt.id)) {
      throw new DomainError(
        'workflow_invalid_transition',
        `workflow_invalid_transition: Codex session stale terminalization attempt ${attempt.id} already exists`,
      );
    }
    this.codexSessionStaleTerminalizationAttempts.set(attempt.id, clone(attempt));
  }

  async listStaleCodexSessionTerminalizationAttempts(sessionId: string): Promise<CodexSessionStaleTerminalizationAttempt[]> {
    return valuesFor(this.codexSessionStaleTerminalizationAttempts)
      .filter((attempt) => attempt.codex_session_id === sessionId)
      .sort(byCreatedAtThenId);
  }

  async claimCodexSessionLease(input: ClaimCodexSessionLeaseInput): Promise<{ session: CodexSession; lease: CodexSessionLease }> {
    if (this.codexSessionLeases.has(input.lease_id)) {
      throw new DomainError('codex_session_lease_conflict', `codex_session_lease_conflict: Codex session lease ${input.lease_id} is not unique`);
    }
    const session = this.codexSessions.get(input.session_id);
    const workflow = session === undefined ? undefined : this.planItemWorkflows.get(session.owner_id);
    const claimableStatusBeforeRecovery =
      session !== undefined &&
      (claimableCodexSessionStatuses.has(session.status) ||
        (session.status === 'running' && session.active_lease_id !== undefined));
    const cannotClaim =
      session === undefined ||
      workflow === undefined ||
      session.owner_type !== 'plan_item_workflow' ||
      session.owner_id !== input.workflow_id ||
      workflow.id !== input.workflow_id ||
      session.role !== 'active' ||
      workflow.active_codex_session_id !== session.id ||
      !claimableStatusBeforeRecovery;
    if (cannotClaim) {
      throw new DomainError('codex_session_lease_conflict', `codex_session_lease_conflict: Codex session ${input.session_id} cannot be claimed`);
    }
    if (session.latest_snapshot_digest !== input.expected_previous_snapshot_digest) {
      throw new DomainError('codex_session_snapshot_stale', `codex_session_snapshot_stale: Codex session ${input.session_id} snapshot is stale`);
    }
    const recoveredSession = this.recoverExpiredCodexSessionLeaseForClaim(input);
    if (
      recoveredSession === undefined ||
      this.findActiveCodexSessionLease(recoveredSession.id) !== undefined ||
      recoveredSession.active_lease_id !== undefined
    ) {
      throw new DomainError('codex_session_lease_conflict', `codex_session_lease_conflict: Codex session ${input.session_id} cannot be claimed`);
    }
    const leaseEpoch = recoveredSession.lease_epoch + 1;
    const lease: CodexSessionLease = {
      id: input.lease_id,
      codex_session_id: recoveredSession.id,
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
      ...clone(recoveredSession),
      status: 'running',
      active_lease_id: lease.id,
      lease_epoch: leaseEpoch,
      updated_at: input.now,
    };
    this.codexSessionLeases.set(lease.id, clone(lease));
    this.codexSessions.set(updatedSession.id, clone(updatedSession));
    return { session: clone(updatedSession), lease: clone(lease) };
  }

  async renewCodexSessionLease(input: RenewCodexSessionLeaseInput): Promise<CodexSessionLease> {
    const lease = this.codexSessionLeases.get(input.lease_id);
    const session = this.codexSessions.get(input.session_id);
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
    const renewed = { ...clone(lease), heartbeat_at: input.now, expires_at: input.expires_at, updated_at: input.now };
    this.codexSessionLeases.set(renewed.id, clone(renewed));
    return clone(renewed);
  }

  async terminalizeCodexSessionTurn(input: TerminalizeCodexSessionTurnInput): Promise<{ session: CodexSession; turn: CodexSessionTurn }> {
    const session = this.codexSessions.get(input.session_id);
    const turn = this.codexSessionTurns.get(input.turn_id);
    const lease = this.codexSessionLeases.get(input.lease_id);
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
    if (
      input.output_snapshot !== undefined &&
      input.output_snapshot.codex_session_id !== session.id
    ) {
      throw new DomainError('codex_session_snapshot_stale', `codex_session_snapshot_stale: Output snapshot does not belong to session ${session.id}`);
    }
    if (
      input.output_snapshot !== undefined &&
      input.output_snapshot.created_from_turn_id !== input.turn_id
    ) {
      throw new DomainError('codex_session_snapshot_stale', `codex_session_snapshot_stale: Output snapshot ${input.output_snapshot.id} does not belong to turn ${input.turn_id}`);
    }
    const existingOutputSnapshot =
      input.output_snapshot === undefined ? undefined : this.codexSessionSnapshots.get(input.output_snapshot.id);
    if (
      existingOutputSnapshot !== undefined &&
      existingOutputSnapshot.created_from_turn_id !== input.turn_id
    ) {
      throw new DomainError('codex_session_snapshot_stale', `codex_session_snapshot_stale: Output snapshot ${existingOutputSnapshot.id} does not belong to turn ${input.turn_id}`);
    }
    if (input.output_snapshot !== undefined && existingOutputSnapshot !== undefined) {
      if (!codexSessionSnapshotDurableIdentityMatches(existingOutputSnapshot, input.output_snapshot)) {
        throw new DomainError(
          'codex_session_snapshot_stale',
          `codex_session_snapshot_stale: Output snapshot ${input.output_snapshot.id} durable identity is stale`,
        );
      }
    }
    const hasThreadIdInput = input.codex_thread_id !== undefined;
    const hasThreadDigestInput = input.codex_thread_id_digest !== undefined;
    if (hasThreadIdInput !== hasThreadDigestInput) {
      throw new DomainError(
        'codex_session_stale_terminalization',
        `codex_session_stale_terminalization: Codex session ${input.session_id} thread binding is incomplete`,
      );
    }
    if (hasThreadIdInput && hasThreadDigestInput) {
      const hasSessionThreadId = session.codex_thread_id !== undefined;
      const hasSessionThreadDigest = session.codex_thread_id_digest !== undefined;
      if (hasSessionThreadId !== hasSessionThreadDigest) {
        throw new DomainError(
          'codex_session_stale_terminalization',
          `codex_session_stale_terminalization: Codex session ${input.session_id} has a partial thread binding`,
        );
      }
      if (
        hasSessionThreadId &&
        hasSessionThreadDigest &&
        (session.codex_thread_id !== input.codex_thread_id ||
          session.codex_thread_id_digest !== input.codex_thread_id_digest)
      ) {
        throw new DomainError(
          'codex_session_stale_terminalization',
          `codex_session_stale_terminalization: Codex session ${input.session_id} thread binding is stale`,
        );
      }
    }
    const outputSnapshot = existingOutputSnapshot ?? input.output_snapshot;
    const releasedLease: CodexSessionLease = { ...clone(lease), status: 'released', released_at: input.now, updated_at: input.now };
    const updatedTurn: CodexSessionTurn = {
      ...clone(turn),
      status: input.status,
      ...(outputSnapshot === undefined
        ? {}
        : { output_snapshot_id: outputSnapshot.id, output_snapshot_digest: outputSnapshot.digest }),
      ...(input.output_object_type === undefined ? {} : { output_object_type: input.output_object_type }),
      ...(input.output_object_id === undefined ? {} : { output_object_id: input.output_object_id }),
      ...(input.codex_thread_id_digest === undefined ? {} : { codex_thread_id_digest: input.codex_thread_id_digest }),
      lease_id: lease.id,
      lease_epoch: lease.lease_epoch,
      updated_at: input.now,
    };
    const {
      active_lease_id: _activeLeaseId,
      ...sessionWithoutActiveLease
    } = clone(session);
    const updatedSession: CodexSession = {
      ...sessionWithoutActiveLease,
      status: input.status === 'succeeded' ? 'idle' : 'blocked',
      latest_turn_id: updatedTurn.id,
      latest_turn_digest: updatedTurn.output_snapshot_digest ?? updatedTurn.input_digest,
      ...(outputSnapshot === undefined
        ? {}
        : { latest_snapshot_id: outputSnapshot.id, latest_snapshot_digest: outputSnapshot.digest }),
      ...(input.codex_thread_id === undefined ? {} : { codex_thread_id: input.codex_thread_id }),
      ...(input.codex_thread_id_digest === undefined ? {} : { codex_thread_id_digest: input.codex_thread_id_digest }),
      updated_at: input.now,
    };
    if (input.output_snapshot !== undefined && !this.codexSessionSnapshots.has(input.output_snapshot.id)) {
      await this.createCodexSessionSnapshot(input.output_snapshot);
    }
    this.codexSessionLeases.set(releasedLease.id, clone(releasedLease));
    this.codexSessionTurns.set(updatedTurn.id, clone(updatedTurn));
    this.codexSessions.set(updatedSession.id, clone(updatedSession));
    return { session: clone(updatedSession), turn: clone(updatedTurn) };
  }

  async createCodexSessionFork(input: CreateCodexSessionForkInput): Promise<CodexSession> {
    const workflow = this.planItemWorkflows.get(input.workflow_id);
    const parent = this.codexSessions.get(input.parent_session_id);
    const forkTurn =
      input.forked_from_turn_id === undefined ? undefined : this.codexSessionTurns.get(input.forked_from_turn_id);
    const forkSnapshot =
      input.forked_from_snapshot_id === undefined ? undefined : this.codexSessionSnapshots.get(input.forked_from_snapshot_id);
    if (
      workflow === undefined ||
      parent === undefined ||
      parent.owner_id !== workflow.id ||
      parent.status === 'archived' ||
      this.codexSessions.has(input.id) ||
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
      forkTurn?.output_snapshot_id === undefined ? undefined : this.codexSessionSnapshots.get(forkTurn.output_snapshot_id);
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
      (forkTurn?.output_snapshot_id === undefined || forkTurn.output_snapshot_digest === undefined
        ? undefined
        : forkTurnOutputSnapshot);
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
    } = clone(parent);
    const fork: CodexSession = {
      ...forkBase,
      id: input.id,
      status: 'idle',
      role: 'candidate_fork',
      lease_epoch: 0,
      forked_from_session_id: parent.id,
      ...(input.forked_from_turn_id === undefined ? {} : { forked_from_turn_id: input.forked_from_turn_id }),
      ...(input.forked_from_snapshot_id === undefined ? {} : { forked_from_snapshot_id: input.forked_from_snapshot_id }),
      ...(forkLatestSnapshot === undefined
        ? {}
        : { latest_snapshot_id: forkLatestSnapshot.id, latest_snapshot_digest: forkLatestSnapshot.digest }),
      fork_reason: input.fork_reason,
      created_by_actor_id: input.created_by_actor_id,
      created_at: input.now,
      updated_at: input.now,
    };
    this.assertCanSaveCodexSession(fork);
    this.codexSessions.set(fork.id, clone(fork));
    return clone(fork);
  }

  async selectActiveCodexSessionFork(
    input: SelectActiveCodexSessionForkInput,
  ): Promise<{ workflow: PlanItemWorkflow; selectedSession: CodexSession }> {
    const workflow = this.planItemWorkflows.get(input.workflow_id);
    const selected = this.codexSessions.get(input.selected_codex_session_id);
    const previousActive =
      workflow?.active_codex_session_id === undefined ? undefined : this.codexSessions.get(workflow.active_codex_session_id);
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
      this.findActiveCodexSessionLease(selected.id) !== undefined ||
      this.findActiveCodexSessionLease(previousActive.id) !== undefined ||
      selected.active_lease_id !== undefined ||
      previousActive.active_lease_id !== undefined
    ) {
      throw new DomainError('codex_session_fork_invalid', `codex_session_fork_invalid: Cannot select Codex session fork ${input.selected_codex_session_id}`);
    }
    if (this.workflowManualDecisions.has(input.manual_decision_id)) {
      throw new DomainError(
        'workflow_invalid_transition',
        `workflow_invalid_transition: Workflow manual decision ${input.manual_decision_id} already exists`,
      );
    }
    const inactivePrevious: CodexSession = { ...clone(previousActive), role: 'inactive_fork', updated_at: input.now };
    const activeSelected: CodexSession = { ...clone(selected), role: 'active', updated_at: input.now };
    const updatedWorkflow: PlanItemWorkflow = { ...clone(workflow), active_codex_session_id: activeSelected.id, updated_at: input.now };
    this.workflowManualDecisions.set(input.manual_decision_id, {
      id: input.manual_decision_id,
      workflow_id: workflow.id,
      codex_session_id: previousActive.id,
      kind: 'fork_select',
      reason: input.reason,
      selected_codex_session_id: selected.id,
      created_by_actor_id: input.actor_id,
      created_at: input.now,
    });
    this.codexSessions.set(inactivePrevious.id, clone(inactivePrevious));
    this.codexSessions.set(activeSelected.id, clone(activeSelected));
    this.planItemWorkflows.set(updatedWorkflow.id, clone(updatedWorkflow));
    return { workflow: clone(updatedWorkflow), selectedSession: clone(activeSelected) };
  }

  private markCodexRecoveredAutomationAction(actionRunId: string, reasonCode: string, now: string): void {
    const actionRun = this.automationActionRuns.get(actionRunId);
    if (actionRun === undefined || actionRun.status !== 'running') {
      return;
    }
    this.automationActionRuns.set(actionRunId, {
      ...clone(actionRun),
      status: 'gate_pending',
      reason: reasonCode,
      result_json: {
        ...(actionRun.result_json ?? {}),
        codex_runtime_blocker_code: reasonCode,
      },
      updated_at: now,
    });
  }

  private codexLaunchLeaseOccupiesWorkerSlot(record: CodexLaunchLeasePrivateRecord): boolean {
    return (
      record.lease.status === 'active' ||
      (record.lease.status === 'materialized' && record.materialized_at !== undefined && record.terminal_reason_code === undefined)
    );
  }

  private findCodexLaunchLeaseForTargetAttempt(
    target: CodexLaunchTarget,
    launchAttempt: number,
  ): CodexLaunchLeasePrivateRecord | undefined {
    return valuesFor(this.codexLaunchLeases).find(
      (record) => record.lease.launch_attempt === launchAttempt && valuesEqual(record.lease.target, target),
    );
  }

  private codexLaunchLeaseHasOwningAutomationAction(record: CodexLaunchLeasePrivateRecord): boolean {
    return record.action_type !== undefined || record.lease.target.target_type === 'automation_action_run';
  }

  private codexLaunchLeaseBelongsToRuntimeJob(record: CodexLaunchLeasePrivateRecord): boolean {
    return (
      record.lease_request_id.startsWith('runtime-job:') ||
      [...this.codexRuntimeJobs.values()].some((runtimeJobRecord) => runtimeJobRecord.job.launch_lease_id === record.lease.id)
    );
  }

  private markCodexRecoveredRunSession(runWorkerLeaseId: string | undefined, reasonCode: string, now: string): string | undefined {
    if (runWorkerLeaseId === undefined) {
      return undefined;
    }
    const lease = valuesFor(this.runWorkerLeases).find(
      (candidate) => candidate.id === runWorkerLeaseId || candidate.run_session_id === runWorkerLeaseId,
    );
    if (lease === undefined) {
      return undefined;
    }
    const runSession = this.runSessions.get(lease.run_session_id);
    if (runSession === undefined || !isActiveRunSessionStatus(runSession.status)) {
      return lease.run_session_id;
    }
    this.runSessions.set(lease.run_session_id, {
      ...clone(runSession),
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
    return lease.run_session_id;
  }

  private getActivePlanItemWorkflowByItemSync(itemId: string): PlanItemWorkflow | undefined {
    return valuesFor(this.planItemWorkflows)
      .filter((workflow) => workflow.development_plan_item_id === itemId && workflow.status !== 'archived')
      .sort(byCreatedAtThenId)[0];
  }

  private findActiveCodexSessionForWorkflow(workflowId: string, exceptSessionId?: string): CodexSession | undefined {
    return valuesFor(this.codexSessions).find(
      (session) =>
        session.owner_type === 'plan_item_workflow' &&
        session.owner_id === workflowId &&
        session.role === 'active' &&
        session.status !== 'archived' &&
        session.id !== exceptSessionId,
    );
  }

  private findActiveCodexSessionLease(sessionId: string): CodexSessionLease | undefined {
    return valuesFor(this.codexSessionLeases).find((lease) => lease.codex_session_id === sessionId && lease.status === 'active');
  }

  private recoverExpiredCodexSessionLeaseForClaim(input: ClaimCodexSessionLeaseInput): CodexSession | undefined {
    const session = this.codexSessions.get(input.session_id);
    if (session?.active_lease_id === undefined) {
      return session;
    }
    const lease = this.codexSessionLeases.get(session.active_lease_id);
    if (lease === undefined || lease.status !== 'active' || lease.expires_at > input.now) {
      return session;
    }
    const expiredLease: CodexSessionLease = {
      ...clone(lease),
      status: 'expired',
      fenced_at: input.now,
      updated_at: input.now,
    };
    const {
      active_lease_id: _activeLeaseId,
      ...sessionWithoutActiveLease
    } = clone(session);
    const recoveredSession: CodexSession = {
      ...sessionWithoutActiveLease,
      status: 'recovering',
      updated_at: input.now,
    };
    this.codexSessionLeases.set(expiredLease.id, clone(expiredLease));
    this.codexSessions.set(recoveredSession.id, clone(recoveredSession));
    return recoveredSession;
  }

  private assertCanSavePlanItemWorkflow(workflow: PlanItemWorkflow): void {
    if (workflow.status === 'archived') {
      return;
    }
    const existing = valuesFor(this.planItemWorkflows).find(
      (candidate) =>
        candidate.id !== workflow.id &&
        candidate.development_plan_item_id === workflow.development_plan_item_id &&
        candidate.status !== 'archived',
    );
    if (existing !== undefined) {
      throw new DomainError(
        'workflow_active_session_conflict',
        `workflow_active_session_conflict: Plan item ${workflow.development_plan_item_id} already has an active workflow`,
      );
    }
  }

  private assertCanSaveCodexSession(session: CodexSession): void {
    if (session.role !== 'active' || session.status === 'archived') {
      return;
    }
    const existing = this.findActiveCodexSessionForWorkflow(session.owner_id, session.id);
    if (existing !== undefined) {
      throw new DomainError(
        'workflow_active_session_conflict',
        `workflow_active_session_conflict: Workflow ${session.owner_id} already has an active Codex session`,
      );
    }
  }

  async saveOrganization(organization: Organization): Promise<void> {
    this.organizations.set(organization.id, clone(organization));
  }

  async getOrganization(organizationId: string): Promise<Organization | undefined> {
    return this.cloneMaybe(this.organizations.get(organizationId));
  }

  async saveActor(actor: Actor): Promise<void> {
    this.actors.set(actor.id, clone(actor));
  }

  async getActor(actorId: string): Promise<Actor | undefined> {
    return this.cloneMaybe(this.actors.get(actorId));
  }

  async listActorsForOrganization(organizationId: string): Promise<Actor[]> {
    return valuesFor(this.actors)
      .filter((actor) => actor.org_id === organizationId)
      .sort(byCreatedAtThenId);
  }

  async saveProject(project: Project): Promise<void> {
    this.projects.set(project.id, clone(project));
  }

  async getProject(projectId: string): Promise<Project | undefined> {
    return this.cloneMaybe(this.projects.get(projectId));
  }

  async saveProjectRepo(projectRepo: ProjectRepo): Promise<void> {
    this.projectRepos.set(projectRepo.id, clone(projectRepo));
  }

  async listProjectRepos(projectId: string): Promise<ProjectRepo[]> {
    return valuesFor(this.projectRepos).filter((projectRepo) => projectRepo.project_id === projectId);
  }

  async saveWorkItem(workItem: WorkItem): Promise<void> {
    this.workItems.set(workItem.id, clone({ ...workItem, narrative_markdown: workItem.narrative_markdown ?? '' }));
  }

  async getWorkItem(workItemId: string): Promise<WorkItem | undefined> {
    return this.cloneMaybe(this.workItems.get(workItemId));
  }

  async listWorkItems(projectId?: string): Promise<WorkItem[]> {
    const workItems = valuesFor(this.workItems);
    return projectId === undefined ? workItems : workItems.filter((workItem) => workItem.project_id === projectId);
  }

  async updateWorkItemNarrative(input: { work_item_id: string; markdown: string; updated_at: string }): Promise<WorkItem> {
    const workItem = this.workItems.get(input.work_item_id);
    if (workItem === undefined) {
      throw new DomainError('INVALID_TRANSITION', `Work Item ${input.work_item_id} was not found`);
    }
    const updated = { ...workItem, narrative_markdown: input.markdown, updated_at: input.updated_at };
    this.workItems.set(input.work_item_id, clone(updated));
    return clone(updated);
  }

  async saveTask(task: Task): Promise<void> {
    this.tasks.set(task.id, clone(task));
  }

  async getTask(taskId: string): Promise<Task | undefined> {
    return this.cloneMaybe(this.tasks.get(taskId));
  }

  async listTasks(projectId?: string): Promise<Task[]> {
    const tasks = valuesFor(this.tasks);
    return projectId === undefined ? tasks : tasks.filter((task) => task.project_id === projectId);
  }

  async listTasksForParent(parentRef: ObjectRef): Promise<Task[]> {
    return valuesFor(this.tasks).filter((task) => objectRefIdentityMatches(task.parent_ref, parentRef));
  }

  async updateTaskNarrative(input: { task_id: string; markdown: string; updated_at: string }): Promise<Task> {
    const task = this.tasks.get(input.task_id);
    if (task === undefined) {
      throw new DomainError('INVALID_TRANSITION', `Task ${input.task_id} was not found`);
    }
    const updated = { ...task, narrative_markdown: input.markdown, updated_at: input.updated_at };
    this.tasks.set(input.task_id, clone(updated));
    return clone(updated);
  }

  async saveSpec(spec: Spec): Promise<void> {
    this.specs.set(spec.id, clone(spec));
  }

  async getSpec(specId: string): Promise<Spec | undefined> {
    return this.cloneMaybe(this.specs.get(specId));
  }

  async listSpecs(projectId?: string): Promise<Spec[]> {
    const specs = valuesFor(this.specs);
    if (projectId === undefined) {
      return specs;
    }

    return specs.filter((spec) => this.workItems.get(spec.work_item_id)?.project_id === projectId);
  }

  async saveSpecRevision(specRevision: SpecRevision): Promise<void> {
    this.specRevisions.set(specRevision.id, clone(specRevision));
  }

  async getSpecRevision(specRevisionId: string): Promise<SpecRevision | undefined> {
    return this.cloneMaybe(this.specRevisions.get(specRevisionId));
  }

  async listSpecRevisions(specId: string): Promise<SpecRevision[]> {
    return valuesFor(this.specRevisions)
      .filter((specRevision) => specRevision.spec_id === specId)
      .sort((left, right) => left.revision_number - right.revision_number);
  }

  async saveContextManifest(contextManifest: ContextManifest): Promise<void> {
    this.contextManifests.set(contextManifest.id, clone(contextManifest));
  }

  async getContextManifest(contextManifestId: string): Promise<ContextManifest | undefined> {
    return this.cloneMaybe(this.contextManifests.get(contextManifestId));
  }

  async saveDevelopmentPlan(plan: DevelopmentPlan): Promise<void> {
    this.developmentPlans.set(plan.id, clone({ ...plan, items: [] }));
  }

  async getDevelopmentPlan(id: string): Promise<DevelopmentPlan | undefined> {
    const plan = this.developmentPlans.get(id);
    return plan === undefined ? undefined : this.hydrateDevelopmentPlan(plan);
  }

  async listDevelopmentPlans(projectId: string): Promise<DevelopmentPlan[]> {
    const plans = valuesFor(this.developmentPlans)
      .filter((plan) => plan.project_id === projectId)
      .sort(byCreatedAtThenId);
    return Promise.all(plans.map((plan) => this.hydrateDevelopmentPlan(plan)));
  }

  async saveDevelopmentPlanRevision(revision: DevelopmentPlanRevision): Promise<void> {
    const existing = valuesFor(this.developmentPlanRevisions).find(
      (candidate) =>
        candidate.id === revision.id ||
        (candidate.development_plan_id === revision.development_plan_id &&
          candidate.revision_number === revision.revision_number),
    );
    if (existing !== undefined) {
      return;
    }
    this.developmentPlanRevisions.set(revision.id, clone(revision));
  }

  async listDevelopmentPlanRevisions(developmentPlanId: string): Promise<DevelopmentPlanRevision[]> {
    return valuesFor(this.developmentPlanRevisions)
      .filter((revision) => revision.development_plan_id === developmentPlanId)
      .sort((left, right) => left.revision_number - right.revision_number);
  }

  async saveDevelopmentPlanSourceLink(link: DevelopmentPlanSourceLink): Promise<void> {
    this.developmentPlanSourceLinks.set(link.id, clone(link));
  }

  async listDevelopmentPlanSourceLinks(developmentPlanId: string): Promise<DevelopmentPlanSourceLink[]> {
    return valuesFor(this.developmentPlanSourceLinks)
      .filter((link) => link.development_plan_id === developmentPlanId)
      .sort(byCreatedAtThenId);
  }

  async listDevelopmentPlanSourceLinksForSource(
    sourceRef: DevelopmentPlanSourceLink['source_ref'],
  ): Promise<DevelopmentPlanSourceLink[]> {
    return valuesFor(this.developmentPlanSourceLinks)
      .filter(
        (link) =>
          link.source_ref.type === sourceRef.type &&
          link.source_ref.id === sourceRef.id &&
          (sourceRef.revision_id === undefined || link.source_ref.revision_id === sourceRef.revision_id),
      )
      .sort(byCreatedAtThenId);
  }

  async saveDevelopmentPlanItem(item: DevelopmentPlanItem): Promise<void> {
    this.developmentPlanItems.set(item.id, clone(item));
  }

  async getDevelopmentPlanItem(id: string): Promise<DevelopmentPlanItem | undefined> {
    return this.cloneMaybe(this.developmentPlanItems.get(id));
  }

  async listDevelopmentPlanItems(developmentPlanId: string): Promise<DevelopmentPlanItem[]> {
    return valuesFor(this.developmentPlanItems)
      .filter((item) => item.development_plan_id === developmentPlanId)
      .sort(byCreatedAtThenId);
  }

  private async hydrateDevelopmentPlan(plan: DevelopmentPlan): Promise<DevelopmentPlan> {
    return {
      ...clone(plan),
      items: await this.listDevelopmentPlanItems(plan.id),
    };
  }

  async saveDevelopmentPlanItemRevision(revision: DevelopmentPlanItemRevision): Promise<void> {
    const existing = valuesFor(this.developmentPlanItemRevisions).find(
      (candidate) =>
        candidate.id === revision.id ||
        (candidate.development_plan_item_id === revision.development_plan_item_id &&
          candidate.revision_number === revision.revision_number),
    );
    if (existing !== undefined) {
      return;
    }
    this.developmentPlanItemRevisions.set(revision.id, clone(revision));
  }

  async listDevelopmentPlanItemRevisions(itemId: string): Promise<DevelopmentPlanItemRevision[]> {
    return valuesFor(this.developmentPlanItemRevisions)
      .filter((revision) => revision.development_plan_item_id === itemId)
      .sort((left, right) => left.revision_number - right.revision_number);
  }

  async compareDevelopmentPlanItemRevisions(query: RevisionCompareQuery): Promise<StructuredRevisionDiff> {
    return revisionDiff(
      query,
      this.developmentPlanItemRevisions.get(query.base_revision_id)?.snapshot,
      this.developmentPlanItemRevisions.get(query.compare_revision_id)?.snapshot,
    );
  }

  async saveBrainstormingSession(session: BrainstormingSession): Promise<void> {
    this.brainstormingSessions.set(session.id, clone(session));
  }

  async getBrainstormingSession(id: string): Promise<BrainstormingSession | undefined> {
    return this.cloneMaybe(this.brainstormingSessions.get(id));
  }

  async saveBoundaryRound(round: BoundaryRoundRecord): Promise<void> {
    this.boundaryRounds.set(round.id, clone(round));
  }

  async listBoundaryRounds(sessionId: string): Promise<BoundaryRoundRecord[]> {
    return valuesFor(this.boundaryRounds)
      .filter((round) => round.session_id === sessionId)
      .sort((left, right) => left.round_number - right.round_number || left.id.localeCompare(right.id));
  }

  async saveBoundaryQuestion(question: BoundaryQuestionRecord): Promise<void> {
    this.boundaryQuestions.set(question.id, clone(question));
  }

  async listBoundaryQuestions(sessionId: string): Promise<BoundaryQuestionRecord[]> {
    return valuesFor(this.boundaryQuestions).filter((question) => question.session_id === sessionId).sort(bySequenceThenId);
  }

  async saveBoundaryAnswer(answer: BoundaryAnswerRecord): Promise<void> {
    this.boundaryAnswers.set(answer.id, clone(answer));
  }

  async listBoundaryAnswers(sessionId: string): Promise<BoundaryAnswerRecord[]> {
    return valuesFor(this.boundaryAnswers).filter((answer) => answer.session_id === sessionId).sort(bySequenceThenId);
  }

  async saveBoundaryDecision(decision: BoundaryDecisionRecord): Promise<void> {
    this.boundaryDecisions.set(decision.id, clone(decision));
  }

  async listBoundaryDecisions(sessionId: string): Promise<BoundaryDecisionRecord[]> {
    return valuesFor(this.boundaryDecisions).filter((decision) => decision.session_id === sessionId).sort(bySequenceThenId);
  }

  async saveBoundarySummary(summary: BoundarySummary): Promise<void> {
    this.boundarySummaries.set(summary.id, clone(summary));
  }

  async getBoundarySummary(id: string): Promise<BoundarySummary | undefined> {
    return this.cloneMaybe(this.boundarySummaries.get(id));
  }

  async listBoundarySummaries(): Promise<BoundarySummary[]> {
    return valuesFor(this.boundarySummaries).sort(byCreatedAtThenId);
  }

  async saveBoundarySummaryRevision(revision: BoundarySummaryRevision): Promise<void> {
    const existing = valuesFor(this.boundarySummaryRevisions).find(
      (candidate) =>
        candidate.id === revision.id ||
        (candidate.boundary_summary_id === revision.boundary_summary_id &&
          candidate.revision_number === revision.revision_number),
    );
    if (existing !== undefined) {
      return;
    }
    this.boundarySummaryRevisions.set(revision.id, clone(revision));
  }

  async updateBoundarySummaryRevision(revision: BoundarySummaryRevision): Promise<void> {
    if (!this.boundarySummaryRevisions.has(revision.id)) {
      return;
    }
    this.boundarySummaryRevisions.set(revision.id, clone(revision));
  }

  async listBoundarySummaryRevisions(boundarySummaryId: string): Promise<BoundarySummaryRevision[]> {
    return valuesFor(this.boundarySummaryRevisions)
      .filter((revision) => revision.boundary_summary_id === boundarySummaryId)
      .sort((left, right) => left.revision_number - right.revision_number);
  }

  async compareBoundarySummaryRevisions(query: RevisionCompareQuery): Promise<StructuredRevisionDiff> {
    return revisionDiff(
      query,
      this.boundarySummaryRevisions.get(query.base_revision_id),
      this.boundarySummaryRevisions.get(query.compare_revision_id),
    );
  }

  async backfillBoundaryLeaderDefaults(input: {
    now: string;
  }): Promise<{ updated_item_ids: string[]; updated_session_ids: string[]; blocked_item_ids: string[] }> {
    const updatedItemIds: string[] = [];
    const blockedItemIds: string[] = [];
    const updatedSessionIds: string[] = [];

    const items = valuesFor(this.developmentPlanItems).sort((left, right) => left.id.localeCompare(right.id));
    const leaderDefaults = new Map<string, { leader_actor_id: string | undefined; leader_delegate_actor_ids: string[] }>();

    for (const item of items) {
      const legacyItem = item as Partial<DevelopmentPlanItem>;
      const leaderActorId = legacyItem.leader_actor_id ?? item.reviewer_actor_id ?? item.driver_actor_id;
      const leaderDelegateActorIds = legacyItem.leader_delegate_actor_ids ?? [];
      leaderDefaults.set(item.id, { leader_actor_id: leaderActorId, leader_delegate_actor_ids: leaderDelegateActorIds });

      if (leaderActorId === undefined) {
        blockedItemIds.push(item.id);
        if (legacyItem.leader_delegate_actor_ids === undefined) {
          this.developmentPlanItems.set(item.id, { ...item, leader_delegate_actor_ids: [], updated_at: input.now });
        }
        continue;
      }

      if (legacyItem.leader_actor_id !== leaderActorId || legacyItem.leader_delegate_actor_ids === undefined) {
        this.developmentPlanItems.set(item.id, {
          ...item,
          leader_actor_id: leaderActorId,
          leader_delegate_actor_ids: leaderDelegateActorIds,
          updated_at: input.now,
        });
        updatedItemIds.push(item.id);
      }
    }

    const sessions = valuesFor(this.brainstormingSessions).sort((left, right) => left.id.localeCompare(right.id));
    for (const session of sessions) {
      const effectiveStatus = session.status ?? this.boundarySessionStatusForApprovalState(session.approval_state);
      if (!activeBoundarySessionStatuses.has(effectiveStatus)) {
        continue;
      }

      const defaults = leaderDefaults.get(session.development_plan_item_id);
      if (defaults?.leader_actor_id === undefined) {
        continue;
      }

      const existingRounds = await this.listBoundaryRounds(session.id);
      const roundId = session.current_round_id ?? existingRounds.at(-1)?.id ?? `${session.id}-round-1`;
      let nextSession = clone(session);
      let changed = false;

      if (nextSession.development_plan_revision_id === undefined) {
        const plan = this.developmentPlans.get(session.development_plan_id);
        if (plan?.revision_id !== undefined) {
          nextSession = { ...nextSession, development_plan_revision_id: plan.revision_id };
          changed = true;
        }
      }
      if (nextSession.leader_actor_id === undefined) {
        nextSession = { ...nextSession, leader_actor_id: defaults.leader_actor_id };
        changed = true;
      }
      if (nextSession.leader_delegate_actor_ids === undefined) {
        nextSession = { ...nextSession, leader_delegate_actor_ids: defaults.leader_delegate_actor_ids };
        changed = true;
      }
      if (nextSession.status === undefined) {
        nextSession = { ...nextSession, status: effectiveStatus };
        changed = true;
      }
      if (existingRounds.length === 0) {
        this.boundaryRounds.set(roundId, {
          id: roundId,
          session_id: session.id,
          session_revision_id: session.revision_id,
          round_number: 1,
          trigger: 'start',
          status: this.syntheticBoundaryRoundStatusFor(effectiveStatus),
          created_at: session.created_at,
          updated_at: input.now,
        });
        changed = true;
      }
      this.attachLegacyBoundaryEvidenceToRound(session, roundId);
      if (nextSession.current_round_id === undefined) {
        nextSession = { ...nextSession, current_round_id: roundId };
        changed = true;
      }

      if (changed) {
        this.brainstormingSessions.set(session.id, { ...nextSession, updated_at: input.now });
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
    const session = this.brainstormingSessions.get(input.session_id);
    const summary = this.boundarySummaries.get(input.boundary_summary_id);
    const revisions = valuesFor(this.boundarySummaryRevisions)
      .filter(
        (revision) =>
          revision.boundary_summary_id === input.boundary_summary_id &&
          (('session_id' in revision ? revision.session_id : revision.brainstorming_session_id) === input.session_id),
      )
      .sort((left, right) => left.revision_number - right.revision_number || left.id.localeCompare(right.id));
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

      this.boundarySummaryRevisions.set(revision.id, clone(nextRevision));
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
        this.brainstormingSessions.set(session.id, { ...nextSession, updated_at: input.now });
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

  private attachLegacyBoundaryEvidenceToRound(session: BrainstormingSession, roundId: string): void {
    session.questions.forEach((question, index) => {
      if (this.boundaryQuestions.has(question.id)) {
        return;
      }
      this.boundaryQuestions.set(question.id, {
        ...question,
        session_id: session.id,
        round_id: question.round_id ?? roundId,
        sequence: index + 1,
        required:
          question.required ??
          (question.status === 'open' &&
            question.answered_by_answer_id === undefined &&
            question.waived_by_decision_id === undefined),
      });
    });
    session.answers.forEach((answer, index) => {
      if (this.boundaryAnswers.has(answer.id)) {
        return;
      }
      this.boundaryAnswers.set(answer.id, {
        ...answer,
        session_id: session.id,
        round_id: answer.round_id ?? roundId,
        sequence: index + 1,
      });
    });
    session.decisions.forEach((decision, index) => {
      if (this.boundaryDecisions.has(decision.id)) {
        return;
      }
      this.boundaryDecisions.set(decision.id, {
        ...decision,
        session_id: session.id,
        round_id: decision.round_id ?? roundId,
        sequence: index + 1,
      });
    });
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
    const sessionId =
      typeof record.session_id === 'string'
        ? record.session_id
        : typeof record.brainstorming_session_id === 'string'
          ? record.brainstorming_session_id
          : session?.id;
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
      : this.boundaryQuestionAnswerSnapshotFor(sessionId);
    const existingDecisionSnapshot = this.normalizedBoundaryDecisionSnapshot(record.decision_snapshot);
    const decisionSnapshot =
      existingDecisionSnapshot.length > 0 ? existingDecisionSnapshot : this.boundaryDecisionSnapshotFor(sessionId);

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

  private boundaryQuestionAnswerSnapshotFor(sessionId: string | undefined): { question_id: string; answer_id: string; text: string }[] {
    if (sessionId === undefined) {
      return [];
    }
    const answersById = new Map(
      valuesFor(this.boundaryAnswers)
        .filter((answer) => answer.session_id === sessionId)
        .map((answer) => [answer.id, answer]),
    );
    return valuesFor(this.boundaryQuestions)
      .filter((question) => question.session_id === sessionId && question.answered_by_answer_id !== undefined)
      .sort(bySequenceThenId)
      .flatMap((question) => {
        const answer = answersById.get(question.answered_by_answer_id ?? '');
        return answer === undefined ? [] : [{ question_id: question.id, answer_id: answer.id, text: answer.text }];
      });
  }

  private boundaryDecisionSnapshotFor(sessionId: string | undefined): { decision_id: string; text: string; rationale?: string }[] {
    if (sessionId === undefined) {
      return [];
    }
    return valuesFor(this.boundaryDecisions)
      .filter((decision) => decision.session_id === sessionId)
      .sort(bySequenceThenId)
      .map((decision) => ({
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
    this.executionPlans.set(plan.id, clone(plan));
  }

  async getExecutionPlan(id: string): Promise<ExecutionPlanDocument | undefined> {
    return this.cloneMaybe(this.executionPlans.get(id));
  }

  async saveExecutionPlanRevision(revision: ExecutionPlanRevision): Promise<void> {
    const existing = valuesFor(this.executionPlanRevisions).find(
      (candidate) =>
        candidate.id === revision.id ||
        (candidate.execution_plan_id === revision.execution_plan_id && candidate.revision_number === revision.revision_number),
    );
    if (existing !== undefined) {
      return;
    }
    this.executionPlanRevisions.set(revision.id, clone(revision));
  }

  async getExecutionPlanRevision(id: string): Promise<ExecutionPlanRevision | undefined> {
    return this.cloneMaybe(this.executionPlanRevisions.get(id));
  }

  async listExecutionPlanRevisions(executionPlanId: string): Promise<ExecutionPlanRevision[]> {
    return valuesFor(this.executionPlanRevisions)
      .filter((revision) => revision.execution_plan_id === executionPlanId)
      .sort((left, right) => left.revision_number - right.revision_number);
  }

  async listExecutionPlansForDevelopmentPlanItem(itemId: string): Promise<ExecutionPlanDocument[]> {
    return valuesFor(this.executionPlans)
      .filter((plan) => plan.development_plan_item_id === itemId)
      .sort(byCreatedAtThenId);
  }

  async saveExecution(execution: Execution): Promise<void> {
    this.executions.set(execution.id, clone(execution));
  }

  async getExecution(id: string): Promise<Execution | undefined> {
    return this.cloneMaybe(this.executions.get(id));
  }

  async listExecutions(): Promise<Execution[]> {
    return valuesFor(this.executions).sort(byCreatedAtThenId);
  }

  async backfillExecutionApprovedSpecLinkage(input: { now: string }): Promise<{ updated_execution_ids: string[] }> {
    const updatedExecutionIds: string[] = [];
    const executions = valuesFor(this.executions).sort(byCreatedAtThenId);
    for (const execution of executions) {
      const executionPlanRevision = this.executionPlanRevisions.get(execution.implementation_plan_revision_id);
      if (executionPlanRevision === undefined) {
        throw new Error(`execution_approved_spec_linkage_backfill_failed: execution_plan_revision_missing:${execution.id}`);
      }
      const specRevision = this.specRevisions.get(executionPlanRevision.based_on_spec_revision_id);
      if (specRevision === undefined) {
        throw new Error(`execution_approved_spec_linkage_backfill_failed: spec_revision_missing:${execution.id}`);
      }
      const spec = this.specs.get(specRevision.spec_id);
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
      this.executions.set(
        execution.id,
        clone({
          ...execution,
          approved_spec_revision_id: specRevision.id,
          approved_spec_revision_ref: approvedSpecRevisionRef,
          updated_at: input.now,
        }),
      );
      updatedExecutionIds.push(execution.id);
    }
    return { updated_execution_ids: updatedExecutionIds };
  }

  async saveCodeReviewHandoff(handoff: CodeReviewHandoff): Promise<void> {
    this.codeReviewHandoffs.set(handoff.id, clone(handoff));
  }

  async getCodeReviewHandoff(id: string): Promise<CodeReviewHandoff | undefined> {
    return this.cloneMaybe(this.codeReviewHandoffs.get(id));
  }

  async listCodeReviewHandoffs(): Promise<CodeReviewHandoff[]> {
    return valuesFor(this.codeReviewHandoffs).sort(byCreatedAtThenId);
  }

  async saveQaHandoff(handoff: QaHandoff): Promise<void> {
    this.qaHandoffs.set(handoff.id, clone(handoff));
  }

  async getQaHandoff(id: string): Promise<QaHandoff | undefined> {
    return this.cloneMaybe(this.qaHandoffs.get(id));
  }

  async listQaHandoffs(): Promise<QaHandoff[]> {
    return valuesFor(this.qaHandoffs).sort(byCreatedAtThenId);
  }

  async listQaHandoffsForCodeReview(handoffId: string): Promise<QaHandoff[]> {
    return valuesFor(this.qaHandoffs)
      .filter((handoff) => handoff.code_review_handoff_id === handoffId)
      .sort((left, right) => left.created_at.localeCompare(right.created_at) || left.id.localeCompare(right.id));
  }

  async savePlan(plan: Plan): Promise<void> {
    this.plans.set(plan.id, clone(plan));
  }

  async getPlan(planId: string): Promise<Plan | undefined> {
    return this.cloneMaybe(this.plans.get(planId));
  }

  async listPlans(projectId?: string): Promise<Plan[]> {
    const plans = valuesFor(this.plans);
    if (projectId === undefined) {
      return plans;
    }

    return plans.filter((plan) => this.workItems.get(plan.work_item_id)?.project_id === projectId);
  }

  async savePlanRevision(planRevision: PlanRevision): Promise<void> {
    this.planRevisions.set(planRevision.id, clone(planRevision));
  }

  async getPlanRevision(planRevisionId: string): Promise<PlanRevision | undefined> {
    return this.cloneMaybe(this.planRevisions.get(planRevisionId));
  }

  async listPlanRevisions(planId: string): Promise<PlanRevision[]> {
    return valuesFor(this.planRevisions)
      .filter((planRevision) => planRevision.plan_id === planId)
      .sort((left, right) => left.revision_number - right.revision_number);
  }

  async saveExecutionPackage(executionPackage: ExecutionPackage): Promise<void> {
    this.executionPackages.set(
      executionPackage.id,
      clone({
        ...executionPackage,
        required_test_gates: executionPackage.required_test_gates ?? [],
        source_mutation_policy: executionPackage.source_mutation_policy ?? 'path_policy_scoped',
      }),
    );
  }

  async getExecutionPackage(executionPackageId: string): Promise<ExecutionPackage | undefined> {
    return this.cloneMaybe(this.executionPackages.get(executionPackageId));
  }

  async listExecutionPackages(projectId?: string): Promise<ExecutionPackage[]> {
    const executionPackages = valuesFor(this.executionPackages);
    return projectId === undefined
      ? executionPackages
      : executionPackages.filter((executionPackage) => executionPackage.project_id === projectId);
  }

  async listExecutionPackagesForWorkItem(workItemId: string): Promise<ExecutionPackage[]> {
    return valuesFor(this.executionPackages).filter((executionPackage) => executionPackage.work_item_id === workItemId);
  }

  async linkExecutionPackageToTask(input: { task_id: string; execution_package_id: string }): Promise<void> {
    const executionPackage = this.executionPackages.get(input.execution_package_id);
    if (executionPackage === undefined) {
      throw new DomainError('INVALID_TRANSITION', `Execution Package ${input.execution_package_id} was not found`);
    }
    if (!this.tasks.has(input.task_id)) {
      throw new DomainError('INVALID_TRANSITION', `Task ${input.task_id} was not found`);
    }
    if (executionPackage.task_id !== undefined && executionPackage.task_id !== input.task_id) {
      throw new DomainError('INVALID_TRANSITION', `Execution Package ${input.execution_package_id} is already linked to another Task`);
    }
    this.executionPackages.set(input.execution_package_id, clone({ ...executionPackage, task_id: input.task_id }));
  }

  async getTaskForExecutionPackage(executionPackageId: string): Promise<Task | undefined> {
    const executionPackage = this.executionPackages.get(executionPackageId);
    return executionPackage?.task_id === undefined ? undefined : this.getTask(executionPackage.task_id);
  }

  async saveExecutionPackageDependency(dependency: ExecutionPackageDependency): Promise<void> {
    this.executionPackageDependencies.set(this.dependencyKey(dependency), clone(dependency));
  }

  async listExecutionPackageDependencies(executionPackageId: string): Promise<ExecutionPackageDependency[]> {
    return valuesFor(this.executionPackageDependencies).filter(
      (dependency) => dependency.package_id === executionPackageId,
    );
  }

  async saveAttachment(attachment: Attachment): Promise<void> {
    this.attachments.set(attachment.id, clone(attachment));
  }

  async getAttachment(attachmentId: string): Promise<Attachment | undefined> {
    return this.cloneMaybe(this.attachments.get(attachmentId));
  }

  async listAttachmentsForObject(objectType: string, objectId: string): Promise<Attachment[]> {
    return valuesFor(this.attachments).filter(
      (attachment) =>
        (attachment.owner_object_type === objectType && attachment.owner_object_id === objectId) ||
        attachment.linked_object_refs.some((ref) => ref.type === objectType && ref.id === objectId),
    );
  }

  async linkAttachmentToObject(attachmentId: string, objectRef: ObjectRef): Promise<Attachment> {
    const attachment = this.attachments.get(attachmentId);
    if (attachment === undefined) {
      throw new DomainError('INVALID_TRANSITION', `Attachment ${attachmentId} was not found`);
    }
    const linked_object_refs = attachment.linked_object_refs.some((ref) => objectRefIdentityMatches(ref, objectRef))
      ? attachment.linked_object_refs
      : [...attachment.linked_object_refs, objectRef];
    const updated = { ...attachment, linked_object_refs };
    this.attachments.set(attachmentId, clone(updated));
    return clone(updated);
  }

  async archiveAttachment(attachmentId: string, _archivedAt: string): Promise<Attachment> {
    const attachment = this.attachments.get(attachmentId);
    if (attachment === undefined) {
      throw new DomainError('INVALID_TRANSITION', `Attachment ${attachmentId} was not found`);
    }
    const updated: Attachment = { ...attachment, reference_status: 'archived' };
    this.attachments.set(attachmentId, clone(updated));
    return clone(updated);
  }

  async saveRunSession(runSession: RunSession): Promise<void> {
    if (isActiveRunSessionStatus(runSession.status)) {
      const existingActive = await this.findActiveRunSessionForPackage(runSession.execution_package_id);
      if (existingActive !== undefined && existingActive.id !== runSession.id) {
        throw new DomainError(
          'INVALID_TRANSITION',
          `Package ${runSession.execution_package_id} already has active run ${existingActive.id}`,
        );
      }
    }
    this.runSessions.set(runSession.id, clone(runSession));
  }

  async getRunSession(runSessionId: string): Promise<RunSession | undefined> {
    return this.cloneMaybe(this.runSessions.get(runSessionId));
  }

  async listRunSessions(projectId?: string): Promise<RunSession[]> {
    const runSessions = valuesFor(this.runSessions).sort(byCreatedAt);
    if (projectId === undefined) {
      return runSessions;
    }

    return runSessions.filter(
      (runSession) => this.executionPackages.get(runSession.execution_package_id)?.project_id === projectId,
    );
  }

  async listRunSessionsForPackage(executionPackageId: string): Promise<RunSession[]> {
    return valuesFor(this.runSessions)
      .filter((runSession) => runSession.execution_package_id === executionPackageId)
      .sort(byCreatedAt);
  }

  async findActiveRunSessionForPackage(executionPackageId: string): Promise<RunSession | undefined> {
    const activeRunSession = valuesFor(this.runSessions)
      .filter(
        (runSession) =>
          runSession.execution_package_id === executionPackageId && isActiveRunSessionStatus(runSession.status),
      )
      .sort(byCreatedAt)[0];

    return this.cloneMaybe(activeRunSession);
  }

  async listRecoverableRunSessions(): Promise<RunSession[]> {
    return valuesFor(this.runSessions)
      .filter((runSession) => recoverableRunSessionStatuses.has(runSession.status))
      .sort(byCreatedAt);
  }

  async appendRunEvent(event: Omit<RunEvent, 'sequence' | 'cursor'>): Promise<RunEvent> {
    const existing = this.runEvents.get(event.id);
    if (existing !== undefined) {
      return clone(existing);
    }

    const sequence =
      Math.max(
        0,
        ...valuesFor(this.runEvents)
          .filter((runEvent) => runEvent.run_session_id === event.run_session_id)
          .map((runEvent) => runEvent.sequence),
      ) + 1;
    const runEvent: RunEvent = {
      ...clone(event),
      sequence,
      cursor: eventCursor(sequence),
    };

    this.runEvents.set(runEvent.id, clone(runEvent));
    return clone(runEvent);
  }

  async listRunEvents(runSessionId: string, options: { after?: string; limit?: number } = {}): Promise<RunEvent[]> {
    const events = valuesFor(this.runEvents)
      .filter((runEvent) => runEvent.run_session_id === runSessionId)
      .filter((runEvent) => options.after === undefined || runEvent.cursor > options.after)
      .sort((left, right) => left.sequence - right.sequence);

    return options.limit === undefined ? events : events.slice(0, options.limit);
  }

  async getLatestRunEvent(runSessionId: string): Promise<RunEvent | undefined> {
    return this.cloneMaybe(
      valuesFor(this.runEvents)
        .filter((runEvent) => runEvent.run_session_id === runSessionId)
        .sort((left, right) => right.sequence - left.sequence)[0],
    );
  }

  async appendWorkerRunEvent(
    event: Omit<RunEvent, 'sequence' | 'cursor'>,
    lease: { workerId: string; leaseToken: string },
  ): Promise<RunEvent> {
    await this.assertActiveRunWorkerLease(event.run_session_id, lease.workerId, lease.leaseToken, event.created_at);
    return this.appendRunEvent(event);
  }

  async saveRunCommand(command: RunCommand): Promise<void> {
    this.runCommands.set(command.id, clone(command));
  }

  async claimNextRunCommand(
    runSessionId: string,
    workerId: string,
    leaseToken: string,
    now: string,
    options: { reclaim_claimed_before?: string } = {},
  ): Promise<{ command: RunCommand; reclaimed: boolean } | undefined> {
    await this.assertActiveRunWorkerLease(runSessionId, workerId, leaseToken, now);

    const pending = valuesFor(this.runCommands)
      .filter((command) => command.run_session_id === runSessionId && command.status === 'pending')
      .sort((left, right) => {
        const priorityDelta = commandPriority(left) - commandPriority(right);
        return priorityDelta === 0 ? left.created_at.localeCompare(right.created_at) : priorityDelta;
      })[0];

    if (pending !== undefined) {
      const command = this.claimCommand(pending, workerId, now);
      return { command, reclaimed: false };
    }

    if (options.reclaim_claimed_before === undefined) {
      return undefined;
    }

    const staleClaim = valuesFor(this.runCommands)
      .filter(
        (command) =>
          command.run_session_id === runSessionId &&
          command.status === 'claimed' &&
          command.claimed_at !== undefined &&
          command.claimed_at <= options.reclaim_claimed_before!,
      )
      .sort((left, right) => (left.claimed_at ?? '').localeCompare(right.claimed_at ?? ''))[0];

    if (staleClaim === undefined) {
      return undefined;
    }

    const command = this.claimCommand(staleClaim, workerId, now);
    return { command, reclaimed: true };
  }

  async recordRunCommandDriverAck(
    commandId: string,
    lease: { workerId: string; leaseToken: string },
    driverAck: Record<string, unknown>,
    acknowledgedAt: string,
  ): Promise<void> {
    const command = await this.getFencedCommand(commandId, lease, acknowledgedAt);
    this.runCommands.set(command.id, {
      ...command,
      driver_ack: clone(driverAck),
      updated_at: acknowledgedAt,
    });
  }

  async markRunCommandApplied(
    commandId: string,
    lease: { workerId: string; leaseToken: string },
    appliedAt: string,
    driverAck: Record<string, unknown>,
  ): Promise<void> {
    const command = await this.getFencedCommand(commandId, lease, appliedAt);
    this.runCommands.set(command.id, {
      ...command,
      status: 'applied',
      applied_at: appliedAt,
      driver_ack: clone(driverAck),
      updated_at: appliedAt,
    });
  }

  async markRunCommandFailed(
    commandId: string,
    lease: { workerId: string; leaseToken: string },
    failureReason: string,
    failedAt: string,
  ): Promise<void> {
    const command = await this.getFencedCommand(commandId, lease, failedAt);
    this.runCommands.set(command.id, {
      ...command,
      status: 'failed',
      failure_reason: failureReason,
      updated_at: failedAt,
    });
  }

  async supersedePendingRunCommands(
    runSessionId: string,
    commandTypes: RunCommand['command_type'][],
    now: string,
  ): Promise<void> {
    this.supersedePendingRunCommandsUnfenced(runSessionId, commandTypes, now);
  }

  async supersedePendingRunCommandsForWorker(
    runSessionId: string,
    commandTypes: RunCommand['command_type'][],
    lease: { workerId: string; leaseToken: string },
    now: string,
  ): Promise<void> {
    await this.assertActiveRunWorkerLease(runSessionId, lease.workerId, lease.leaseToken, now);
    this.supersedePendingRunCommandsUnfenced(runSessionId, commandTypes, now);
  }

  private supersedePendingRunCommandsUnfenced(
    runSessionId: string,
    commandTypes: RunCommand['command_type'][],
    now: string,
  ): void {
    for (const command of valuesFor(this.runCommands)) {
      if (
        command.run_session_id === runSessionId &&
        command.status === 'pending' &&
        commandTypes.includes(command.command_type)
      ) {
        this.runCommands.set(command.id, { ...command, status: 'superseded', updated_at: now });
      }
    }
  }

  async claimRunWorkerLease(input: {
    run_session_id: string;
    worker_id: string;
    lease_token: string;
    now: string;
    expires_at: string;
  }): Promise<RunWorkerLease> {
    const existing = this.runWorkerLeases.get(input.run_session_id);
    if (
      existing !== undefined &&
      existing.status === 'active' &&
      existing.expires_at > input.now &&
      existing.worker_id !== input.worker_id
    ) {
      throw invalidLease(input.run_session_id);
    }

    const lease: RunWorkerLease = {
      id: existing?.id ?? `${input.run_session_id}:${input.worker_id}:${input.lease_token}`,
      run_session_id: input.run_session_id,
      worker_id: input.worker_id,
      lease_token: input.lease_token,
      heartbeat_at: input.now,
      expires_at: input.expires_at,
      status: 'active',
    };

    this.runWorkerLeases.set(input.run_session_id, clone(lease));
    return clone(lease);
  }

  async heartbeatRunWorkerLease(
    runSessionId: string,
    workerId: string,
    leaseToken: string,
    heartbeatAt: string,
    expiresAt: string,
  ): Promise<void> {
    await this.assertActiveRunWorkerLease(runSessionId, workerId, leaseToken, heartbeatAt);
    const lease = this.runWorkerLeases.get(runSessionId)!;
    this.runWorkerLeases.set(runSessionId, { ...lease, heartbeat_at: heartbeatAt, expires_at: expiresAt });
  }

  async getRunWorkerLease(runSessionId: string): Promise<RunWorkerLease | undefined> {
    return this.cloneMaybe(this.runWorkerLeases.get(runSessionId));
  }

  async releaseRunWorkerLease(runSessionId: string, workerId: string, leaseToken: string, releasedAt: string): Promise<void> {
    await this.assertActiveRunWorkerLease(runSessionId, workerId, leaseToken, releasedAt);
    const lease = this.runWorkerLeases.get(runSessionId)!;
    this.runWorkerLeases.set(runSessionId, { ...lease, heartbeat_at: releasedAt, status: 'released' });
  }

  async assertActiveRunWorkerLease(
    runSessionId: string,
    workerId: string,
    leaseToken: string,
    now: string,
  ): Promise<void> {
    const lease = this.runWorkerLeases.get(runSessionId);
    if (
      lease === undefined ||
      lease.status !== 'active' ||
      lease.worker_id !== workerId ||
      lease.lease_token !== leaseToken ||
      lease.expires_at <= now
    ) {
      throw invalidLease(runSessionId);
    }
  }

  async withActiveRunWorkerLease<T>(
    runSessionId: string,
    lease: { workerId: string; leaseToken: string; now: string },
    write: (repository: DeliveryRepository) => Promise<T>,
  ): Promise<T> {
    await this.assertActiveRunWorkerLease(runSessionId, lease.workerId, lease.leaseToken, lease.now);
    const result = await write(this);
    await this.assertActiveRunWorkerLease(runSessionId, lease.workerId, lease.leaseToken, lease.now);
    return result;
  }

  async saveReviewPacket(reviewPacket: ReviewPacket): Promise<void> {
    if (isOpenReviewPacketStatus(reviewPacket.status)) {
      const existingOpen = await this.findOpenReviewPacketForPackage(reviewPacket.execution_package_id);
      if (existingOpen !== undefined && existingOpen.id !== reviewPacket.id) {
        throw new DomainError(
          'INVALID_TRANSITION',
          `Package ${reviewPacket.execution_package_id} already has open review packet ${existingOpen.id}`,
        );
      }
    }
    this.reviewPackets.set(reviewPacket.id, clone(reviewPacket));
  }

  async getReviewPacket(reviewPacketId: string): Promise<ReviewPacket | undefined> {
    return this.cloneMaybe(this.reviewPackets.get(reviewPacketId));
  }

  async listReviewPackets(projectId?: string): Promise<ReviewPacket[]> {
    const reviewPackets = valuesFor(this.reviewPackets).sort(byCreatedAt);
    if (projectId === undefined) {
      return reviewPackets;
    }

    return reviewPackets.filter(
      (reviewPacket) => this.executionPackages.get(reviewPacket.execution_package_id)?.project_id === projectId,
    );
  }

  async listReviewPacketsForPackage(executionPackageId: string): Promise<ReviewPacket[]> {
    return valuesFor(this.reviewPackets)
      .filter((reviewPacket) => reviewPacket.execution_package_id === executionPackageId)
      .sort(byCreatedAt);
  }

  async findOpenReviewPacketForPackage(executionPackageId: string): Promise<ReviewPacket | undefined> {
    const openReviewPacket = valuesFor(this.reviewPackets)
      .filter(
        (reviewPacket) =>
          reviewPacket.execution_package_id === executionPackageId && isOpenReviewPacketStatus(reviewPacket.status),
      )
      .sort(byCreatedAt)[0];

    return this.cloneMaybe(openReviewPacket);
  }

  async resolveAutomationProjectSettings(
    input: ResolveAutomationProjectSettingsInput,
  ): Promise<AutomationProjectSettings> {
    const key = this.automationSettingsKey(input.project_id, input.repo_id);
    const existing = this.automationProjectSettings.get(key);
    if (existing !== undefined) {
      return {
        ...clone(existing),
        capabilities_json: normalizeAutomationCapabilities(existing.capabilities_json),
      };
    }

    const preset = 'off';
    const capabilities = automationCapabilitiesForPreset(preset);
    return {
      id: `default:${key}`,
      project_id: input.project_id,
      ...(input.repo_id === undefined ? {} : { repo_id: input.repo_id }),
      preset,
      capabilities_json: capabilities,
      capability_fingerprint: capabilityFingerprint(capabilities),
      scope_type: input.repo_id === undefined ? 'project' : 'repo',
      version: 0,
      evidence_refs: [],
    };
  }

  async setAutomationProjectSettings(input: SetAutomationProjectSettingsInput): Promise<AutomationProjectSettings> {
    return this.objectLocks.withLock(`automation-settings:${this.automationSettingsKey(input.project_id, input.repo_id)}`, () =>
      this.setAutomationProjectSettingsUnlocked(input),
    );
  }

  async disableAutomationProjectSettings(
    input: DisableAutomationProjectSettingsInput,
  ): Promise<AutomationProjectSettings> {
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
    const scopeKeys = new Set(await this.manualHoldScopeKeysFor(input));
    return valuesFor(this.manualPathHolds)
      .filter((hold) => hold.status === 'active' && scopeKeys.has(hold.scope_key))
      .sort(byCreatedAtForRequestedAt);
  }

  async getManualPathHold(holdId: string): Promise<ManualPathHold | undefined> {
    return this.cloneMaybe(this.manualPathHolds.get(holdId));
  }

  async requestManualPathHold(input: RequestManualPathHoldInput): Promise<ManualPathHold> {
    return this.objectLocks.withLocks(this.manualPathHoldLockKeys(input), () => this.requestManualPathHoldUnlocked(input));
  }

  private async requestManualPathHoldUnlocked(input: RequestManualPathHoldInput): Promise<ManualPathHold> {
    const replayedHoldId = this.manualPathHoldIdempotency.get(input.idempotency_key);
    if (replayedHoldId !== undefined) {
      const replayed = this.manualPathHolds.get(replayedHoldId);
      if (replayed !== undefined) {
        return clone(replayed);
      }
    }
    if (input.source_automation_action_id !== undefined) {
      const sourceHoldId = this.manualPathHoldSourceActions.get(input.source_automation_action_id);
      if (sourceHoldId !== undefined) {
        const replayed = this.manualPathHolds.get(sourceHoldId);
        if (replayed !== undefined) {
          this.manualPathHoldIdempotency.set(input.idempotency_key, sourceHoldId);
          return clone(replayed);
        }
      }
    }

    this.assertManualScopeKey(input);
    const existingActive = valuesFor(this.manualPathHolds).find(
      (hold) =>
        hold.status === 'active' &&
        hold.object_type === input.object_type &&
        hold.object_id === input.object_id &&
        hold.scope_key === input.scope_key,
    );
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
      evidence_refs: clone(input.evidence_refs),
      requested_by: input.requested_by,
      requested_at: input.requested_at,
      ...(input.metadata_json === undefined ? {} : { metadata_json: clone(input.metadata_json) }),
    };
    this.manualPathHolds.set(hold.id, clone(hold));
    this.manualPathHoldIdempotency.set(input.idempotency_key, hold.id);
    if (hold.source_automation_action_id !== undefined) {
      this.manualPathHoldSourceActions.set(hold.source_automation_action_id, hold.id);
    }
    return hold;
  }

  async resolveManualPathHold(input: ResolveManualPathHoldInput): Promise<ManualPathHold> {
    const hold = this.manualPathHolds.get(input.hold_id);
    if (hold === undefined) {
      throw new DomainError('INVALID_TRANSITION', `Manual hold ${input.hold_id} does not exist`);
    }
    if (hold.status !== 'active') {
      if (hold.status === 'resolved' && hold.resolved_by === input.resolved_by && hold.resolution === input.resolution) {
        return clone(hold);
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
    this.manualPathHolds.set(resolved.id, clone(resolved));
    return clone(resolved);
  }

  async claimCommandIdempotency(input: ClaimCommandIdempotencyInput): Promise<CommandIdempotencyRecord> {
    return this.objectLocks.withLock(`command-idempotency:${input.idempotency_key}`, () =>
      this.claimCommandIdempotencyUnlocked(input),
    );
  }

  async renewCommandIdempotency(input: RenewCommandIdempotencyInput): Promise<CommandIdempotencyRecord> {
    return this.objectLocks.withLock(`command-idempotency:${input.idempotency_key}`, () =>
      this.renewCommandIdempotencyUnlocked(input),
    );
  }

  private async renewCommandIdempotencyUnlocked(input: RenewCommandIdempotencyInput): Promise<CommandIdempotencyRecord> {
    const record = this.getClaimedCommandIdempotency(input.idempotency_key, input.claim_token);
    const renewed = {
      ...record,
      locked_until: input.locked_until,
      last_heartbeat_at: input.last_heartbeat_at,
      updated_at: input.last_heartbeat_at,
    };
    this.commandIdempotencyRecords.set(record.idempotency_key, clone(renewed));
    return clone(renewed);
  }

  async completeCommandIdempotency(input: FinishCommandIdempotencyInput): Promise<CommandIdempotencyRecord> {
    return this.objectLocks.withLock(`command-idempotency:${input.idempotency_key}`, async () =>
      this.finishCommandIdempotency(input, 'succeeded'),
    );
  }

  async failCommandIdempotency(input: FinishCommandIdempotencyInput): Promise<CommandIdempotencyRecord> {
    return this.objectLocks.withLock(`command-idempotency:${input.idempotency_key}`, async () =>
      this.finishCommandIdempotency(input, 'failed'),
    );
  }

  async blockCommandIdempotency(input: FinishCommandIdempotencyInput): Promise<CommandIdempotencyRecord> {
    return this.objectLocks.withLock(`command-idempotency:${input.idempotency_key}`, async () =>
      this.finishCommandIdempotency(input, 'blocked'),
    );
  }

  async claimExecutionPackageGenerationRun(
    input: ClaimExecutionPackageGenerationRunInput,
  ): Promise<ExecutionPackageGenerationRun> {
    return this.objectLocks.withLock(`package-generation:${input.plan_revision_id}`, () =>
      this.claimExecutionPackageGenerationRunUnlocked(input),
    );
  }

  private async claimExecutionPackageGenerationRunUnlocked(
    input: ClaimExecutionPackageGenerationRunInput,
  ): Promise<ExecutionPackageGenerationRun> {
    const existing = this.generationRunFor(input.plan_revision_id, input.generation_key);
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
          ...(input.evidence_refs === undefined ? {} : { evidence_refs: clone(input.evidence_refs) }),
          updated_at: input.now,
        };
        this.executionPackageGenerationRuns.set(reclaimed.execution_package_set_id, clone(reclaimed));
        return clone(reclaimed);
      }
      if (existing.status === 'running') {
        throw new DomainError('INVALID_TRANSITION', `Package generation ${input.generation_key} already has an active claim`);
      }
      return clone(existing);
    }

    const currentSucceeded = valuesFor(this.executionPackageGenerationRuns).find(
      (run) => run.plan_revision_id === input.plan_revision_id && run.status === 'succeeded',
    );
    if (currentSucceeded !== undefined) {
      throw new DomainError(
        'INVALID_TRANSITION',
        `Plan revision ${input.plan_revision_id} already has current succeeded package generation`,
      );
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
      ...(input.evidence_refs === undefined ? {} : { evidence_refs: clone(input.evidence_refs) }),
      status: 'running',
      locked_until: input.locked_until,
      last_heartbeat_at: input.now,
      claim_token: input.claim_token,
      created_at: input.now,
      updated_at: input.now,
    };
    this.executionPackageGenerationRuns.set(run.execution_package_set_id, clone(run));
    return run;
  }

  async saveExecutionPackageGenerationPackage(input: SaveExecutionPackageGenerationPackageInput): Promise<void> {
    return this.objectLocks.withLock(`package-generation:${input.plan_revision_id}`, () =>
      this.saveExecutionPackageGenerationPackageUnlocked(input),
    );
  }

  private async saveExecutionPackageGenerationPackageUnlocked(
    input: SaveExecutionPackageGenerationPackageInput,
  ): Promise<void> {
    const run = this.getGenerationRun(input.execution_package_set_id, input.claim_token);
    if (run.plan_revision_id !== input.plan_revision_id || run.generation_key !== input.generation_key) {
      throw new DomainError('INVALID_TRANSITION', `Package generation ${input.execution_package_set_id} identity mismatch`);
    }
    const duplicate = [...this.executionPackageGenerationPackages.values()].find(
      (record) =>
        record.plan_revision_id === input.plan_revision_id &&
        record.generation_key === input.generation_key &&
        record.package_key === input.package_key &&
        record.execution_package_id !== input.execution_package_id,
    );
    if (duplicate !== undefined) {
      throw new DomainError('INVALID_TRANSITION', `Duplicate package_key ${input.package_key} for generation`);
    }
    const existing = this.executionPackageGenerationPackages.get(
      `${input.execution_package_set_id}:${input.execution_package_id}`,
    );
    if (
      existing !== undefined &&
      (existing.plan_revision_id !== input.plan_revision_id ||
        existing.generation_key !== input.generation_key ||
        existing.package_key !== input.package_key ||
        existing.sequence !== input.sequence ||
        existing.manifest_digest !== input.manifest_digest)
    ) {
      throw new DomainError('INVALID_TRANSITION', `Package generation package ${input.execution_package_id} drift`);
    }
    const { claim_token: _claimToken, ...record } = input;
    this.executionPackageGenerationPackages.set(
      `${record.execution_package_set_id}:${record.execution_package_id}`,
      clone(record),
    );
  }

  async completeExecutionPackageGenerationRun(
    input: CompleteExecutionPackageGenerationRunInput,
  ): Promise<ExecutionPackageGenerationRun> {
    return this.objectLocks.withLock(`package-generation:${input.plan_revision_id}`, () =>
      this.completeExecutionPackageGenerationRunUnlocked(input),
    );
  }

  private async completeExecutionPackageGenerationRunUnlocked(
    input: CompleteExecutionPackageGenerationRunInput,
  ): Promise<ExecutionPackageGenerationRun> {
    const run = this.getGenerationRun(input.execution_package_set_id, input.claim_token);
    if (run.plan_revision_id !== input.plan_revision_id) {
      throw new DomainError('INVALID_TRANSITION', `Package generation ${input.execution_package_set_id} plan mismatch`);
    }
    this.assertGenerationPackageManifestComplete(run);
    const completed: ExecutionPackageGenerationRun = {
      ...run,
      status: 'succeeded',
      version: run.version + 1,
      ...(input.result_json === undefined ? {} : { result_json: clone(input.result_json) }),
      completed_at: input.completed_at,
      updated_at: input.completed_at,
    };
    this.executionPackageGenerationRuns.set(completed.execution_package_set_id, clone(completed));
    return clone(completed);
  }

  async getExecutionPackageGenerationRun(input: {
    plan_revision_id: string;
    generation_key: string;
  }): Promise<ExecutionPackageGenerationRun | undefined> {
    return this.cloneMaybe(this.generationRunFor(input.plan_revision_id, input.generation_key));
  }

  async supersedeExecutionPackageGenerationRun(
    input: SupersedeExecutionPackageGenerationRunInput,
  ): Promise<ExecutionPackageGenerationRun> {
    return this.objectLocks.withLock(`package-generation:${input.plan_revision_id}`, () =>
      this.supersedeExecutionPackageGenerationRunUnlocked(input),
    );
  }

  private async supersedeExecutionPackageGenerationRunUnlocked(
    input: SupersedeExecutionPackageGenerationRunInput,
  ): Promise<ExecutionPackageGenerationRun> {
    const run = this.executionPackageGenerationRuns.get(input.execution_package_set_id);
    if (run === undefined || run.plan_revision_id !== input.plan_revision_id) {
      throw new DomainError('INVALID_TRANSITION', `Package generation ${input.execution_package_set_id} does not exist`);
    }
    if (run.version !== input.expected_version) {
      throw new DomainError('INVALID_TRANSITION', `Package generation ${input.execution_package_set_id} version mismatch`);
    }
    if (run.status !== 'succeeded') {
      throw new DomainError('INVALID_TRANSITION', `Package generation ${input.execution_package_set_id} is not current succeeded`);
    }
    const nextIndex =
      valuesFor(this.executionPackageGenerationRuns).filter((candidate) => candidate.plan_revision_id === input.plan_revision_id)
        .length + 1;
    const superseded: ExecutionPackageGenerationRun = {
      ...run,
      status: 'superseded',
      version: run.version + 1,
      superseded_by: input.superseded_by,
      superseded_at: input.superseded_at,
      superseded_reason: input.reason,
      supersede_command_id: input.supersede_command_id,
      evidence_refs: clone(input.evidence_refs),
      next_generation_key: `regenerate:${input.plan_revision_id}:${nextIndex}`,
      updated_at: input.superseded_at,
    };
    this.executionPackageGenerationRuns.set(superseded.execution_package_set_id, clone(superseded));
    return clone(superseded);
  }

  async createOrReplayAutomationActionRun(input: CreateOrReplayAutomationActionRunInput): Promise<AutomationActionRun> {
    return this.objectLocks.withLocks([`automation-action:${input.idempotency_key}`, `automation-action-id:${input.id}`], async () =>
      this.createOrReplayAutomationActionRunUnlocked(input),
    );
  }

  async claimNextAutomationActionRun(
    input: ClaimNextAutomationActionRunInput,
  ): Promise<AutomationActionRun | undefined> {
    return this.objectLocks.withLock('automation-action:claim-next', async () => {
      const candidates = valuesFor(this.automationActionRuns)
        .filter((actionRun) => this.isAutomationActionClaimable(actionRun, input.now))
        .filter((actionRun) => this.matchesAutomationActionClaimFilter(actionRun, input))
        .sort(this.compareAutomationActionClaimOrder);
      const selected = candidates.slice(0, input.limit)[0];
      if (selected === undefined) {
        return undefined;
      }
      const claimed = this.toRunningAutomationActionRun(selected, {
        claim_token: input.claim_token,
        locked_until: input.locked_until,
        now: input.now,
      });
      this.automationActionRuns.set(claimed.id, clone(claimed));
      return clone(claimed);
    });
  }

  async getClaimedAutomationActionRun(input: GetClaimedAutomationActionRunInput): Promise<AutomationActionRun> {
    return clone(this.getClaimedAutomationActionRunRecord(input.id, input.claim_token));
  }

  async getAutomationActionRun(id: string): Promise<AutomationActionRun | undefined> {
    const actionRun = this.automationActionRuns.get(id);
    return actionRun === undefined ? undefined : clone(actionRun);
  }

  async latestCompletedProjectionActionRun(
    input: LatestCompletedProjectionActionRunInput,
  ): Promise<AutomationActionRun | undefined> {
    this.assertProjectionAutomationScope(input.automation_scope, input.repo_id);
    const matched = valuesFor(this.automationActionRuns)
      .filter(
        (actionRun) =>
          actionRun.action_type === 'project_runtime_snapshot' &&
          actionRun.status === 'succeeded' &&
          actionRun.automation_scope === input.automation_scope &&
          this.stablePolicyObservationIdentityMatches(actionRun.action_input_json, input),
      )
      .sort(
        (left, right) =>
          (right.finished_at ?? '').localeCompare(left.finished_at ?? '') ||
          (right.updated_at ?? '').localeCompare(left.updated_at ?? '') ||
          right.id.localeCompare(left.id),
      )[0];
    return matched === undefined ? undefined : clone(matched);
  }

  async claimAutomationActionRun(input: ClaimAutomationActionRunInput): Promise<AutomationActionRun> {
    return this.objectLocks.withLocks(
      ['automation-action:claim-next', `automation-action:${input.idempotency_key}`, `automation-action-id:${input.id}`],
      () => this.claimAutomationActionRunUnlocked(input),
    );
  }

  async markAutomationActionGatePending(input: MarkAutomationActionGatePendingInput): Promise<AutomationActionRun> {
    return this.objectLocks.withLocks(['automation-action:claim-next', `automation-action:${input.idempotency_key}`], () =>
      this.markAutomationActionGatePendingUnlocked(input),
    );
  }

  private async markAutomationActionGatePendingUnlocked(
    input: MarkAutomationActionGatePendingInput,
  ): Promise<AutomationActionRun> {
    const actionRun = this.getClaimedAutomationActionRunRecord(input.id, input.claim_token);
    if (actionRun.idempotency_key !== input.idempotency_key) {
      throw new DomainError('INVALID_TRANSITION', `Automation action ${input.id} idempotency key mismatch`);
    }
    const pending: AutomationActionRun = {
      ...actionRun,
      status: 'gate_pending',
      reason: input.reason,
      ...(input.result_json === undefined ? {} : { result_json: clone(input.result_json) }),
      ...(input.next_attempt_at === undefined ? {} : { next_attempt_at: input.next_attempt_at }),
      updated_at: input.now,
    };
    this.automationActionRuns.set(pending.id, clone(pending));
    return clone(pending);
  }

  async completeAutomationActionRun(input: CompleteAutomationActionRunInput): Promise<AutomationActionRun> {
    return this.objectLocks.withLocks(['automation-action:claim-next', `automation-action:${input.idempotency_key}`], () =>
      this.completeAutomationActionRunUnlocked(input),
    );
  }

  private async completeAutomationActionRunUnlocked(input: CompleteAutomationActionRunInput): Promise<AutomationActionRun> {
    const actionRun = this.getClaimedAutomationActionRunRecord(input.id, input.claim_token);
    if (actionRun.idempotency_key !== input.idempotency_key) {
      throw new DomainError('INVALID_TRANSITION', `Automation action ${input.id} idempotency key mismatch`);
    }
    const completed: AutomationActionRun = {
      ...actionRun,
      status: input.status,
      ...(input.result_json === undefined ? {} : { result_json: clone(input.result_json) }),
      ...(input.retryable === undefined ? {} : { retryable: input.retryable }),
      ...(input.next_attempt_at === undefined ? {} : { next_attempt_at: input.next_attempt_at }),
      finished_at: input.finished_at,
      updated_at: input.finished_at,
    };
    this.automationActionRuns.set(completed.id, clone(completed));
    return clone(completed);
  }

  async listClaimableAutomationActionRuns(input: ListClaimableAutomationActionRunsInput): Promise<AutomationActionRun[]> {
    return valuesFor(this.automationActionRuns)
      .filter((actionRun) => this.isAutomationActionClaimable(actionRun, input.now))
      .sort(this.compareAutomationActionClaimOrder)
      .map(redactAutomationActionClaim)
      .slice(0, input.limit);
  }

  async getRuntimeSnapshotData(): Promise<RuntimeSnapshotRepositoryData> {
    const projects = valuesFor(this.projects).sort(byCreatedAtThenId);
    const repos = valuesFor(this.projectRepos)
      .filter((repo) => repo.status === 'active')
      .sort(byCreatedAtThenId);
    const projectRows = await Promise.all(
      projects.map(async (project) => {
        const settings = await this.resolveAutomationProjectSettings({ project_id: project.id });
        return {
          project_id: project.id,
          automation_scope: `project:${project.id}` as const,
          automation_settings_version: settings.version,
          capability_fingerprint: settings.capability_fingerprint,
        };
      }),
    );
    const repoRows = await Promise.all(
      repos.map(async (repo) => {
        const settings = await this.resolveAutomationProjectSettings({ project_id: repo.project_id, repo_id: repo.repo_id });
        return {
          project_id: repo.project_id,
          repo_id: repo.repo_id,
          automation_scope: `repo:${repo.project_id}:${repo.repo_id}` as const,
          automation_settings_version: settings.version,
          capability_fingerprint: settings.capability_fingerprint,
          daemon_internal_local_path: repo.local_path,
        };
      }),
    );

    return {
      projects: projectRows,
      repos: repoRows,
      plan_revisions_requiring_packages: await this.runtimeSnapshotPlanRevisionsRequiringPackages(repos),
      run_enqueue_disabled_packages: this.runtimeSnapshotRunEnqueueDisabledPackages(repos),
      active_holds: this.runtimeSnapshotActiveHolds(),
      recent_action_runs: valuesFor(this.automationActionRuns)
        .sort(this.compareAutomationActionRecency)
        .slice(0, 50)
        .map(redactAutomationActionClaim),
      policy_projection_action_runs: valuesFor(this.automationActionRuns)
        .filter((actionRun) => actionRun.action_type === 'project_runtime_snapshot' && actionRun.status === 'succeeded')
        .sort(this.compareAutomationActionRecency)
        .map(redactAutomationActionClaim),
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

    this.releases.set(normalized.id, clone(normalized));
    this.replaceReleaseWorkItems(normalized.id, normalized.work_item_ids);
    this.replaceReleaseExecutionPackages(normalized.id, normalized.execution_package_ids);
  }

  async getRelease(releaseId: string): Promise<Release | undefined> {
    const release = this.releases.get(releaseId);
    return release === undefined ? undefined : this.hydrateReleaseLinks(release);
  }

  async listReleases(projectId?: string): Promise<Release[]> {
    const releases = valuesFor(this.releases)
      .filter((release) => projectId === undefined || release.project_id === projectId)
      .sort(byCreatedAt);
    return Promise.all(releases.map((release) => this.hydrateReleaseLinks(release)));
  }

  async saveReleaseWorkItem(releaseWorkItem: ReleaseWorkItem): Promise<void> {
    const key = `${releaseWorkItem.release_id}:${releaseWorkItem.work_item_id}`;
    const existingOrder = this.releaseWorkItemOrders.get(key);
    const order =
      existingOrder ??
      Math.max(
        -1,
        ...[...this.releaseWorkItemOrders.entries()]
          .filter(([entryKey]) => entryKey.startsWith(`${releaseWorkItem.release_id}:`))
          .map(([, value]) => value),
      ) + 1;
    this.releaseWorkItems.set(key, clone(releaseWorkItem));
    this.releaseWorkItemOrders.set(key, order);
  }

  async listReleaseWorkItems(releaseId: string): Promise<ReleaseWorkItem[]> {
    return valuesFor(this.releaseWorkItems)
      .filter((releaseWorkItem) => releaseWorkItem.release_id === releaseId)
      .sort(
        (left, right) =>
          (this.releaseWorkItemOrders.get(`${left.release_id}:${left.work_item_id}`) ?? 0) -
            (this.releaseWorkItemOrders.get(`${right.release_id}:${right.work_item_id}`) ?? 0) ||
          left.work_item_id.localeCompare(right.work_item_id),
      );
  }

  async saveReleaseExecutionPackage(releaseExecutionPackage: ReleaseExecutionPackage): Promise<void> {
    const key = `${releaseExecutionPackage.release_id}:${releaseExecutionPackage.execution_package_id}`;
    const existingOrder = this.releaseExecutionPackageOrders.get(key);
    const order =
      existingOrder ??
      Math.max(
        -1,
        ...[...this.releaseExecutionPackageOrders.entries()]
          .filter(([entryKey]) => entryKey.startsWith(`${releaseExecutionPackage.release_id}:`))
          .map(([, value]) => value),
      ) + 1;
    this.releaseExecutionPackages.set(key, clone(releaseExecutionPackage));
    this.releaseExecutionPackageOrders.set(key, order);
  }

  async listReleaseExecutionPackages(releaseId: string): Promise<ReleaseExecutionPackage[]> {
    return valuesFor(this.releaseExecutionPackages).filter(
      (releaseExecutionPackage) => releaseExecutionPackage.release_id === releaseId,
    ).sort(
      (left, right) =>
        (this.releaseExecutionPackageOrders.get(`${left.release_id}:${left.execution_package_id}`) ?? 0) -
          (this.releaseExecutionPackageOrders.get(`${right.release_id}:${right.execution_package_id}`) ?? 0) ||
        left.execution_package_id.localeCompare(right.execution_package_id),
    );
  }

  async saveReleaseEvidence(releaseEvidence: ReleaseEvidence): Promise<void> {
    if (this.releaseEvidences.has(releaseEvidence.id)) {
      throw new DomainError('workflow_invalid_transition', `workflow_invalid_transition: Release evidence ${releaseEvidence.id} already exists`);
    }
    this.releaseEvidences.set(releaseEvidence.id, clone(releaseEvidence));
  }

  async getReleaseEvidence(releaseEvidenceId: string): Promise<ReleaseEvidence | undefined> {
    return this.cloneMaybe(this.releaseEvidences.get(releaseEvidenceId));
  }

  async listReleaseEvidences(releaseId: string): Promise<ReleaseEvidence[]> {
    return valuesFor(this.releaseEvidences)
      .filter((releaseEvidence) => releaseEvidence.release_id === releaseId)
      .sort(byCreatedAtThenId);
  }

  async appendObjectEvent(objectEvent: ObjectEvent): Promise<void> {
    if (this.objectEvents.has(objectEvent.id)) {
      throw new DomainError('workflow_invalid_transition', `workflow_invalid_transition: Object event ${objectEvent.id} already exists`);
    }
    this.objectEvents.set(objectEvent.id, clone(objectEvent));
  }

  async listObjectEvents(objectId: string, objectType?: string): Promise<ObjectEvent[]> {
    return valuesFor(this.objectEvents)
      .filter(
        (objectEvent) =>
          objectEvent.object_id === objectId && (objectType === undefined || objectEvent.object_type === objectType),
      )
      .sort(byCreatedAt);
  }

  async appendStatusHistory(statusHistory: StatusHistory): Promise<void> {
    if (this.statusHistories.has(statusHistory.id)) {
      throw new DomainError(
        'workflow_invalid_transition',
        `workflow_invalid_transition: Status history ${statusHistory.id} already exists`,
      );
    }
    this.statusHistories.set(statusHistory.id, clone(statusHistory));
  }

  async listStatusHistory(objectId: string, objectType?: string): Promise<StatusHistory[]> {
    return valuesFor(this.statusHistories)
      .filter(
        (statusHistory) =>
          statusHistory.object_id === objectId && (objectType === undefined || statusHistory.object_type === objectType),
      )
      .sort(byCreatedAt);
  }

  async saveArtifact(artifact: Artifact): Promise<void> {
    if (this.artifacts.has(artifact.id)) {
      throw new DomainError('workflow_invalid_transition', `workflow_invalid_transition: Artifact ${artifact.id} already exists`);
    }
    this.artifacts.set(artifact.id, clone(artifact));
  }

  async listArtifactsForObject(objectType: string, objectId: string): Promise<Artifact[]> {
    return valuesFor(this.artifacts)
      .filter((artifact) => artifact.object_type === objectType && artifact.object_id === objectId)
      .sort(byCreatedAt);
  }

  async saveDecision(decision: Decision): Promise<void> {
    if (this.decisions.has(decision.id)) {
      throw new DomainError('workflow_invalid_transition', `workflow_invalid_transition: Decision ${decision.id} already exists`);
    }
    this.decisions.set(decision.id, clone(decision));
  }

  async listDecisionsForObject(objectType: string, objectId: string): Promise<Decision[]> {
    return valuesFor(this.decisions)
      .filter((decision) => decision.object_type === objectType && decision.object_id === objectId)
      .sort(byCreatedAt);
  }

  async saveTraceEvent(traceEvent: TraceEventRecord): Promise<void> {
    if (this.traceEvents.has(traceEvent.id)) {
      throw new DomainError('workflow_invalid_transition', `workflow_invalid_transition: Trace event ${traceEvent.id} already exists`);
    }
    this.traceEvents.set(traceEvent.id, clone(traceEvent));
  }

  async listTraceEventsForSubject(subjectType: string, subjectId: string): Promise<TraceEventRecord[]> {
    return valuesFor(this.traceEvents)
      .filter((traceEvent) => traceEvent.subject_type === subjectType && traceEvent.subject_id === subjectId)
      .sort(byCreatedAtThenId);
  }

  async saveTraceLink(traceLink: TraceLinkRecord): Promise<void> {
    if (this.traceLinks.has(traceLink.id)) {
      throw new DomainError('workflow_invalid_transition', `workflow_invalid_transition: Trace link ${traceLink.id} already exists`);
    }
    this.traceLinks.set(traceLink.id, clone(traceLink));
  }

  async listTraceLinks(traceEventId: string): Promise<TraceLinkRecord[]> {
    return valuesFor(this.traceLinks)
      .filter((traceLink) => traceLink.trace_event_id === traceEventId)
      .sort(byCreatedAtThenId);
  }

  async saveTraceArtifactRef(traceArtifactRef: TraceArtifactRefRecord): Promise<void> {
    if (this.traceArtifactRefs.has(traceArtifactRef.id)) {
      throw new DomainError(
        'workflow_invalid_transition',
        `workflow_invalid_transition: Trace artifact ref ${traceArtifactRef.id} already exists`,
      );
    }
    this.traceArtifactRefs.set(traceArtifactRef.id, clone(traceArtifactRef));
  }

  async listTraceArtifactRefs(traceEventId: string): Promise<TraceArtifactRefRecord[]> {
    return valuesFor(this.traceArtifactRefs)
      .filter((traceArtifactRef) => traceArtifactRef.trace_event_id === traceEventId)
      .sort(byCreatedAtThenId);
  }

  private cloneMaybe<T>(value: T | undefined): T | undefined {
    return value === undefined ? undefined : clone(value);
  }

  private async setAutomationProjectSettingsUnlocked(
    input: SetAutomationProjectSettingsInput,
  ): Promise<AutomationProjectSettings> {
    assertAutomationCapabilityActor(input.actor);
    const current = await this.resolveAutomationProjectSettings(input);
    if (current.version !== input.expected_version) {
      throw new DomainError('INVALID_TRANSITION', `Automation settings version mismatch for ${current.project_id}`);
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
      evidence_refs: clone(input.evidence_refs),
    };
    this.automationProjectSettings.set(this.automationSettingsKey(input.project_id, input.repo_id), clone(settings));
    return settings;
  }

  private async claimCommandIdempotencyUnlocked(
    input: ClaimCommandIdempotencyInput,
  ): Promise<CommandIdempotencyRecord> {
    const existing = this.commandIdempotencyRecords.get(input.idempotency_key);
    if (existing !== undefined) {
      this.assertCommandIdempotencyMatches(existing, input);
      if (terminalCommandStatuses.has(existing.status)) {
        return clone(existing);
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
      ...(input.precondition_json === undefined ? {} : { precondition_json: clone(input.precondition_json) }),
      ...(input.precondition_fingerprint === undefined
        ? {}
        : { precondition_fingerprint: input.precondition_fingerprint }),
      ...(input.actor_scope === undefined ? {} : { actor_scope: input.actor_scope }),
      status: 'running',
      locked_until: input.locked_until,
      last_heartbeat_at: input.now,
      claim_token: input.claim_token,
      ...(input.actor_scope === undefined ? {} : { created_by: input.actor_scope }),
      started_at: input.now,
      created_at: existing?.created_at ?? input.now,
      updated_at: input.now,
    };
    this.commandIdempotencyRecords.set(input.idempotency_key, clone(record));
    return record;
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

  private assertGenerationPackageManifestComplete(run: ExecutionPackageGenerationRun): void {
    const packages = [...this.executionPackageGenerationPackages.values()]
      .filter((record) => record.execution_package_set_id === run.execution_package_set_id)
      .sort((left, right) => left.sequence - right.sequence || left.package_key.localeCompare(right.package_key));
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
  }

  private createOrReplayAutomationActionRunUnlocked(input: CreateOrReplayAutomationActionRunInput): AutomationActionRun {
    if (input.action_type === 'project_runtime_snapshot') {
      this.assertProjectionAutomationScope(input.automation_scope, input.action_input_json.repo_id);
    }
    const existingId = this.automationActionRunIdempotency.get(input.idempotency_key);
    const existing = existingId === undefined ? undefined : this.automationActionRuns.get(existingId);
    if (existing !== undefined) {
      this.assertAutomationActionReplayMatches(existing, input);
      return clone(redactAutomationActionClaim(existing));
    }
    this.assertAutomationActionIdIsUnused(input.id, input.idempotency_key);

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
      action_input_json: clone(input.action_input_json),
      status: 'pending',
      attempt: 0,
      ...(input.created_by === undefined ? {} : { created_by: input.created_by }),
      created_at: input.now,
      updated_at: input.now,
    };
    this.automationActionRuns.set(actionRun.id, clone(actionRun));
    this.automationActionRunIdempotency.set(actionRun.idempotency_key, actionRun.id);
    return clone(actionRun);
  }

  private async claimAutomationActionRunUnlocked(input: ClaimAutomationActionRunInput): Promise<AutomationActionRun> {
    if (input.precondition_fingerprint === undefined || input.action_input_json === undefined) {
      throw new DomainError(
        'INVALID_TRANSITION',
        `Automation action ${input.idempotency_key} requires precondition fingerprint and action input`,
      );
    }
    const existingId = this.automationActionRunIdempotency.get(input.idempotency_key);
    const existing = existingId === undefined ? undefined : this.automationActionRuns.get(existingId);
    if (existing !== undefined) {
      this.assertAutomationActionIdentityMatches(existing, input);
      if (!this.isAutomationActionClaimable(existing, input.now)) {
        if (existing.status === 'running') {
          if (existing.claim_token === input.claim_token) {
            const renewed: AutomationActionRun = {
              ...existing,
              locked_until: input.locked_until,
              last_heartbeat_at: input.now,
              updated_at: input.now,
            };
            this.automationActionRuns.set(renewed.id, clone(renewed));
            return clone(renewed);
          }
          throw new DomainError('INVALID_TRANSITION', `Automation action ${input.idempotency_key} already has an active claim`);
        }
        return clone(redactAutomationActionClaim(existing));
      }
    } else {
      this.assertAutomationActionIdIsUnused(input.id, input.idempotency_key);
    }

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
      action_input_json: clone(input.action_input_json),
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
    this.automationActionRuns.set(actionRun.id, clone(actionRun));
    this.automationActionRunIdempotency.set(actionRun.idempotency_key, actionRun.id);
    return actionRun;
  }

  private assertAutomationActionIdIsUnused(id: string, idempotencyKey: string): void {
    const existing = this.automationActionRuns.get(id);
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
      action_input_json: clone(actionRun.action_input_json),
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

  private assertAutomationActionIdentityMatches(existing: AutomationActionRun, input: ClaimAutomationActionRunInput): void {
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

  private compareAutomationActionClaimOrder(left: AutomationActionRun, right: AutomationActionRun): number {
    return (
      compareTimestamp(left.next_attempt_at ?? left.created_at, right.next_attempt_at ?? right.created_at) ||
      automationActionClaimPriority(left) - automationActionClaimPriority(right) ||
      compareTimestamp(left.created_at, right.created_at) ||
      left.id.localeCompare(right.id)
    );
  }

  private compareAutomationActionRecency(left: AutomationActionRun, right: AutomationActionRun): number {
    return (
      compareTimestamp(right.finished_at ?? right.updated_at ?? right.created_at, left.finished_at ?? left.updated_at ?? left.created_at) ||
      right.id.localeCompare(left.id)
    );
  }

  private async runtimeSnapshotPlanRevisionsRequiringPackages(repos: ProjectRepo[]): Promise<RuntimeSnapshotTargetRow[]> {
    const targets: RuntimeSnapshotTargetRow[] = [];
    for (const plan of valuesFor(this.plans).sort(byCreatedAtThenId)) {
      if (
        plan.status !== 'approved' ||
        plan.resolution !== 'approved' ||
        plan.approved_revision_id === undefined ||
        plan.current_revision_id !== plan.approved_revision_id
      ) {
        continue;
      }
      const planRevisionId = plan.approved_revision_id;
      if (this.hasCurrentPackageGeneration(planRevisionId)) {
        continue;
      }
      const planRevision = this.planRevisions.get(planRevisionId);
      const workItem = planRevision === undefined ? undefined : this.workItems.get(planRevision.work_item_id);
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
      const spec = this.specs.get(workItem.current_spec_id);
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
      const specRevision = this.specRevisions.get(spec.approved_revision_id);
      if (specRevision === undefined || specRevision.spec_id !== spec.id || specRevision.work_item_id !== workItem.id) {
        continue;
      }
      const targetScope = await this.runtimeSnapshotDraftTargetScope(repos, workItem.project_id, 'canGeneratePackageDrafts');
      if (targetScope === undefined) {
        continue;
      }
      const generationKey = `default:${planRevisionId}`;
      if (
        this.hasActiveManualHold([
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
        ...this.latestMatchingActionFields('ensure_package_drafts', planRevisionId, generationKey),
      });
    }
    return targets;
  }

  private async runtimeSnapshotDraftTargetScope(
    repos: ProjectRepo[],
    projectId: string,
    capability: 'canGeneratePackageDrafts',
  ): Promise<Pick<RuntimeSnapshotTargetRow, 'repo_id' | 'eligible_repo_ids' | 'automation_scope'> | undefined> {
    const eligibleReposById = new Map<string, ProjectRepo>();
    for (const repo of repos) {
      if (repo.project_id !== projectId) {
        continue;
      }
      const settings = await this.resolveAutomationProjectSettings({ project_id: projectId, repo_id: repo.repo_id });
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

  private runtimeSnapshotRunEnqueueDisabledPackages(repos: ProjectRepo[]): RuntimeSnapshotTargetRow[] {
    return valuesFor(this.executionPackages)
      .filter(
        (executionPackage) =>
          executionPackage.phase === 'ready' &&
          repos.some((repo) => repo.project_id === executionPackage.project_id && repo.repo_id === executionPackage.repo_id),
      )
      .sort(byCreatedAtThenId)
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
          runtimeSnapshotBlockersForExecutionPackage(
            executionPackage,
            valuesFor(this.runSessions).filter((runSession) => runSession.execution_package_id === executionPackage.id),
          ),
        ),
      }));
  }

  private runtimeSnapshotActiveHolds() {
    return valuesFor(this.manualPathHolds)
      .filter((hold) => hold.status === 'active')
      .sort((left, right) => compareTimestamp(left.requested_at, right.requested_at) || left.id.localeCompare(right.id))
      .map((hold) => ({
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

  private hasCurrentPackageGeneration(planRevisionId: string): boolean {
    return valuesFor(this.executionPackageGenerationRuns).some(
      (run) => run.plan_revision_id === planRevisionId && (run.status === 'pending' || run.status === 'running' || run.status === 'succeeded'),
    );
  }

  private hasActiveManualHold(scopeKeys: string[]): boolean {
    const scopeKeySet = new Set(scopeKeys);
    return valuesFor(this.manualPathHolds).some((hold) => hold.status === 'active' && scopeKeySet.has(hold.scope_key));
  }

  private latestMatchingActionFields(
    actionType: string,
    targetObjectId: string,
    targetRevisionId?: string,
  ): Pick<RuntimeSnapshotTargetRow, 'latest_matching_action_status' | 'blocked_reason_code' | 'blocked_summary' | 'blockers'> {
    const actionRun = valuesFor(this.automationActionRuns)
      .filter(
        (candidate) =>
          candidate.action_type === actionType &&
          candidate.target_object_id === targetObjectId &&
          candidate.target_revision_id === targetRevisionId,
      )
      .sort(this.compareAutomationActionRecency)[0];
    if (actionRun === undefined) {
      return {};
    }
    return {
      latest_matching_action_status: actionRun.status,
      ...runtimeSnapshotBlockerFieldsFor(runtimeSnapshotBlockersForActionRun(actionRun)),
    };
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

  private automationSettingsKey(projectId: string, repoId: string | undefined): string {
    return repoId === undefined ? `project:${projectId}` : `repo:${projectId}:${repoId}`;
  }

  private manualPathHoldLockKeys(input: RequestManualPathHoldInput): string[] {
    return [
      `manual-hold-idem:${input.idempotency_key}`,
      ...(input.source_automation_action_id === undefined ? [] : [`manual-hold-source:${input.source_automation_action_id}`]),
    ];
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
      const executionPackage = this.executionPackages.get(input.object_id);
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
        for (const hold of this.manualPathHolds.values()) {
          if (hold.status === 'active' && hold.object_type === 'release_gate' && hold.object_id === input.object_id) {
            keys.push(hold.scope_key);
          }
        }
      }
    }
    if (input.object_type === 'run_session') {
      const runSession = this.runSessions.get(input.object_id);
      if (runSession !== undefined) {
        keys.push(...(await this.manualHoldScopeKeysFor({ object_type: 'execution_package', object_id: runSession.execution_package_id })));
      }
    }
    if (input.object_type === 'review_packet') {
      const reviewPacket = this.reviewPackets.get(input.object_id);
      if (reviewPacket !== undefined) {
        keys.push(...(await this.manualHoldScopeKeysFor({ object_type: 'execution_package', object_id: reviewPacket.execution_package_id })));
      }
    }
    return [...new Set(keys)];
  }

  private getClaimedCommandIdempotency(idempotencyKey: string, claimToken: string): CommandIdempotencyRecord {
    const record = this.commandIdempotencyRecords.get(idempotencyKey);
    if (record === undefined || record.status !== 'running' || record.claim_token !== claimToken) {
      throw new DomainError('INVALID_TRANSITION', `Command idempotency record ${idempotencyKey} is not claimed`);
    }
    return clone(record);
  }

  private finishCommandIdempotency(
    input: FinishCommandIdempotencyInput,
    status: CommandIdempotencyRecord['status'],
  ): CommandIdempotencyRecord {
    const record = this.getClaimedCommandIdempotency(input.idempotency_key, input.claim_token);
    const finished: CommandIdempotencyRecord = {
      ...record,
      status,
      ...(input.result_json === undefined ? {} : { result_json: clone(input.result_json) }),
      finished_at: input.finished_at,
      updated_at: input.finished_at,
    };
    this.commandIdempotencyRecords.set(finished.idempotency_key, clone(finished));
    return clone(finished);
  }

  private generationRunFor(planRevisionId: string, generationKey: string): ExecutionPackageGenerationRun | undefined {
    return valuesFor(this.executionPackageGenerationRuns).find(
      (run) => run.plan_revision_id === planRevisionId && run.generation_key === generationKey,
    );
  }

  private getGenerationRun(executionPackageSetId: string, claimToken: string): ExecutionPackageGenerationRun {
    const run = this.executionPackageGenerationRuns.get(executionPackageSetId);
    if (run === undefined || run.status !== 'running' || run.claim_token !== claimToken) {
      throw new DomainError('INVALID_TRANSITION', `Package generation ${executionPackageSetId} is not claimed`);
    }
    return clone(run);
  }

  private getClaimedAutomationActionRunRecord(id: string, claimToken: string): AutomationActionRun {
    const actionRun = this.automationActionRuns.get(id);
    if (actionRun === undefined || actionRun.status !== 'running' || actionRun.claim_token !== claimToken) {
      throw new DomainError('INVALID_TRANSITION', `Automation action ${id} is not claimed`);
    }
    return clone(actionRun);
  }

  private workerStillMatchesLaunch(
    worker: CodexWorkerRegistrationPrivateRecord,
    record: CodexLaunchLeasePrivateRecord,
    profileRevision: CodexRuntimeProfileRevision,
  ): boolean {
    return (
      (worker.registration.status === 'online' || worker.registration.status === 'draining') &&
      worker.registration.control_channel_status === 'connected' &&
      worker.registration.capabilities.includes(record.lease.target.target_kind) &&
      codexWorkerScopeMatchesTarget(
        worker.allowed_scopes,
        record.lease.target.target_kind,
        codexScope(record.lease.target.project_id, record.lease.target.repo_id),
      ) &&
      worker.docker_image_digests.includes(record.docker_image_digest) &&
      worker.network_policy_digests.includes(record.network_policy_digest) &&
      (record.network_provider_config_digest === undefined ||
        worker.network_provider_config_digests.includes(record.network_provider_config_digest)) &&
      profileRevision.docker_image_digest === record.docker_image_digest &&
      codexRuntimeNetworkPolicyDigest(profileRevision.network_policy) === record.network_policy_digest
    );
  }

  private codexRuntimeJobMaterialization(
    record: CodexRuntimeJobPrivateRecord,
    leaseRecord: CodexLaunchLeasePrivateRecord,
    now: string,
  ): CodexLaunchMaterialization {
    const profileRevision = this.codexRuntimeProfileRevisions.get(leaseRecord.lease.profile_revision_id);
    const worker =
      leaseRecord.lease.worker_id === undefined ? undefined : this.codexWorkerRegistrations.get(leaseRecord.lease.worker_id);
    const credential = this.codexCredentialBindingVersions.get(leaseRecord.credential_binding_version_id);
    if (
      profileRevision === undefined ||
      worker === undefined ||
      credential === undefined ||
      credential.version.status !== 'active' ||
      credential.version.payload_digest !== leaseRecord.credential_payload_digest ||
      !this.workerStillMatchesLaunch(worker, leaseRecord, profileRevision) ||
      record.credential_binding_version_id !== credential.version.id ||
      record.credential_payload_digest !== credential.version.payload_digest
    ) {
      throw codexDenied('codex_launch_materialization_denied', 'Codex runtime job materialization dependencies were denied.');
    }
    return {
      launch_target: clone(leaseRecord.lease.target),
      profile_revision: clone(profileRevision),
      resolved_credentials: [
        {
          binding_id: leaseRecord.credential_binding_id,
          binding_version_id: credential.version.id,
          payload: clone(credential.secret_payload_json),
          payload_digest: credential.version.payload_digest,
        },
      ],
      lease_id: leaseRecord.lease.id,
      expires_at: leaseRecord.lease.expires_at,
      materialized_at: leaseRecord.lease.materialized_at ?? now,
    };
  }

  private releaseCodexRuntimeWorkerSlot(record: CodexLaunchLeasePrivateRecord): void {
    if (!this.codexLaunchLeaseOccupiesWorkerSlot(record) || record.lease.worker_id === undefined) {
      return;
    }
    const worker = this.codexWorkerRegistrations.get(record.lease.worker_id);
    if (worker === undefined) {
      return;
    }
    worker.registration.active_lease_count = Math.max(0, worker.registration.active_lease_count - 1);
    this.codexWorkerRegistrations.set(record.lease.worker_id, clone(worker));
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

  private codexRuntimeJobAcceptedSessionCoversRefresh(record: CodexRuntimeJobPrivateRecord): boolean {
    const lease = this.codexLaunchLeases.get(record.job.launch_lease_id)?.lease;
    const envelope = this.codexLaunchTokenEnvelopes.get(record.envelope_id);
    if (record.job.accepted_session_public_key_expires_at === undefined || lease === undefined || envelope === undefined) {
      return false;
    }
    const requiredUntil = Math.max(Date.parse(record.job.expires_at), Date.parse(lease.expires_at), Date.parse(envelope.expires_at));
    return Date.parse(record.job.accepted_session_public_key_expires_at) >= requiredUntil;
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

  private assertWorkerSession(
    workerId: string,
    sessionToken: string,
    now: string,
    deniedCode: DomainErrorType['code'] = 'codex_launch_materialization_denied',
    options: { requireConnected?: boolean } = {},
  ): CodexWorkerRegistrationPrivateRecord {
    const worker = this.codexWorkerRegistrations.get(workerId);
    const requireConnected = options.requireConnected ?? true;
    if (
      worker === undefined ||
      worker.session_token_hash !== codexCredentialPayloadDigest(sessionToken) ||
      worker.session_expires_at <= now ||
      (requireConnected &&
        ((worker.registration.status !== 'online' && worker.registration.status !== 'draining') ||
          worker.registration.control_channel_status !== 'connected'))
    ) {
      throw codexDenied(deniedCode, 'Codex worker session proof was rejected.');
    }
    return clone(worker);
  }

  private assertCodexRuntimeJobWorkerSession(
    runtimeJobId: string,
    workerId: string,
    sessionToken: string,
    now: string,
    deniedCode: DomainErrorType['code'] = 'codex_runtime_job_unavailable',
    options: { requireConnected?: boolean } = {},
  ): CodexWorkerSessionProof {
    const sessionTokenHash = codexCredentialPayloadDigest(sessionToken);
    try {
      const worker = this.assertWorkerSession(workerId, sessionToken, now, deniedCode, options);
      return {
        worker,
        session_token_hash: sessionTokenHash,
        session_epoch: worker.session_epoch,
        session_public_key_id: worker.session_public_key_id,
        session_public_key_expires_at: worker.session_public_key_expires_at,
      };
    } catch (error) {
      if (!(error instanceof DomainError)) {
        throw error;
      }
    }

    const worker = this.codexWorkerRegistrations.get(workerId);
    const record = this.codexRuntimeJobs.get(runtimeJobId);
    const leaseRecord = record === undefined ? undefined : this.codexLaunchLeases.get(record.job.launch_lease_id);
    const requireConnected = options.requireConnected ?? true;
    if (
      worker === undefined ||
      record === undefined ||
      leaseRecord === undefined ||
      record.job.worker_id !== workerId ||
      leaseRecord.lease.worker_id !== workerId ||
      record.job.accepted_worker_session_digest !== sessionTokenHash ||
      record.job.accepted_session_epoch === undefined ||
      record.job.accepted_session_public_key_id === undefined ||
      record.job.accepted_session_public_key_expires_at === undefined ||
      (record.job.status !== 'accepted' && record.job.status !== 'materializing' && record.job.status !== 'running') ||
      record.job.expires_at <= now ||
      leaseRecord.lease.expires_at <= now ||
      record.job.accepted_session_public_key_expires_at <= now ||
      (leaseRecord.lease.status !== 'active' && leaseRecord.lease.status !== 'materialized') ||
      (requireConnected &&
        ((worker.registration.status !== 'online' && worker.registration.status !== 'draining') ||
          worker.registration.control_channel_status !== 'connected'))
    ) {
      throw codexDenied(deniedCode, 'Codex worker session proof was rejected.');
    }
    return {
      worker: clone(worker),
      session_token_hash: sessionTokenHash,
      session_epoch: record.job.accepted_session_epoch,
      session_public_key_id: record.job.accepted_session_public_key_id,
      session_public_key_expires_at: record.job.accepted_session_public_key_expires_at,
    };
  }

  private recordCodexWorkerNonce(
    workerId: string,
    sessionToken: string,
    nonce: string,
    nonceTimestamp: string,
    now: string,
    replayProtection?: CodexWorkerReplayProtectionInput,
    sessionEpochOverride?: number,
  ): void {
    const sessionTokenHash = codexCredentialPayloadDigest(sessionToken);
    const nonceHash = codexCredentialPayloadDigest(nonce);
    const sessionEpoch = sessionEpochOverride ?? this.codexWorkerRegistrations.get(workerId)?.session_epoch ?? 1;
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
    const key = `${workerId}:${sessionEpoch}:${nonceHash}`;
    const existing = this.codexWorkerSessionNonces.get(key);
    if (existing !== undefined) {
      throw codexDenied('codex_worker_nonce_replay', 'Codex worker session nonce was already used.');
    }
    this.codexWorkerSessionNonces.set(key, {
      worker_id: workerId,
      session_token_hash: sessionTokenHash,
      nonce_hash: nonceHash,
      session_epoch: sessionEpoch,
      request_binding_digest: requestBindingDigest,
      replay_key_hash: replayKeyHash,
      nonce_timestamp: nonceTimestamp,
      created_at: now,
    });
  }

  private codexRuntimeJobTargetAttemptKey(target: CodexLaunchTarget, launchAttempt: number): string {
    return canonicalJson({
      project_id: target.project_id,
      repo_id: target.repo_id ?? '',
      target_type: target.target_type,
      target_id: target.target_id,
      launch_attempt: launchAttempt,
    });
  }

  private codexRuntimeJobTarget(record: CodexRuntimeJobPrivateRecord): CodexLaunchTarget {
    return {
      target_type: record.job.target_type,
      target_id: record.job.target_id,
      target_kind: record.job.target_kind,
      project_id: record.job.project_id,
      ...(record.job.repo_id === undefined ? {} : { repo_id: record.job.repo_id }),
    };
  }

  private codexWorkerCanRunRuntimeJob(
    worker: CodexWorkerRegistrationPrivateRecord,
    input: CreateOrReplayCodexRuntimeJobWithLeaseAndEnvelopeInput,
  ): boolean {
    return (
      worker.registration.status === 'online' &&
      worker.registration.control_channel_status === 'connected' &&
      worker.session_expires_at > input.now &&
      worker.session_public_key_expires_at > input.now &&
      codexWorkerHeartbeatIsFresh(worker.registration.last_heartbeat_at, input.now) &&
      worker.registration.active_lease_count < worker.registration.max_concurrency &&
      worker.registration.capabilities.includes(input.target.target_kind) &&
      codexWorkerScopeMatchesTarget(worker.allowed_scopes, input.target.target_kind, codexScope(input.target.project_id, input.target.repo_id)) &&
      worker.docker_image_digests.includes(input.docker_image_digest) &&
      worker.network_policy_digests.includes(input.network_policy_digest) &&
      (input.network_provider_config_digest === undefined ||
        worker.network_provider_config_digests.includes(input.network_provider_config_digest))
    );
  }

  private codexRuntimeJobLaunchLeaseRecord(
    input: CreateOrReplayCodexRuntimeJobWithLeaseAndEnvelopeInput,
    lease: CodexLaunchLease,
  ): CodexLaunchLeasePrivateRecord {
    return {
      lease,
      lease_request_id: `runtime-job:${input.job_request_id}`,
      runtime_profile_digest: input.runtime_profile_digest,
      credential_binding_id: input.credential_binding_id,
      credential_binding_version_id: input.credential_binding_version_id,
      credential_payload_digest: input.credential_payload_digest,
      docker_image_digest: input.docker_image_digest,
      network_policy_digest: input.network_policy_digest,
      ...(input.network_provider_config_digest === undefined
        ? {}
        : { network_provider_config_digest: input.network_provider_config_digest }),
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
    };
  }

  private replayCodexRuntimeJob(
    runtimeJobId: string,
    input: CreateOrReplayCodexRuntimeJobWithLeaseAndEnvelopeInput,
  ): CreateOrReplayCodexRuntimeJobWithLeaseAndEnvelopeResult {
    const record = this.codexRuntimeJobs.get(runtimeJobId);
    const leaseRecord = record === undefined ? undefined : this.codexLaunchLeases.get(record.job.launch_lease_id);
    const envelope = record === undefined ? undefined : this.codexLaunchTokenEnvelopes.get(record.envelope_id);
    if (record === undefined || leaseRecord === undefined || envelope === undefined) {
      throw codexDenied('codex_runtime_job_unavailable', 'Runtime job replay record is inconsistent.');
    }
    if (
      leaseRecord.lease.expires_at <= input.now ||
      !this.codexLaunchFenceIsActive(leaseRecord, undefined, input.now) ||
      !this.codexRuntimeJobReplayMatches(record, leaseRecord, envelope, input)
    ) {
      throw codexDenied('codex_runtime_job_unavailable', 'Runtime job replay did not match original request.');
    }
    return {
      runtime_job: clone(record.job),
      launch_lease: clone(leaseRecord.lease),
      envelope: clone(envelope),
      replayed: true,
    };
  }

  private codexRuntimeJobReplayMatches(
    record: CodexRuntimeJobPrivateRecord,
    leaseRecord: CodexLaunchLeasePrivateRecord,
    envelope: CodexLaunchTokenEnvelope,
    input: CreateOrReplayCodexRuntimeJobWithLeaseAndEnvelopeInput,
  ): boolean {
    return (
      valuesEqual(this.codexRuntimeJobTarget(record), input.target) &&
      record.job.launch_attempt === input.launch_attempt &&
      record.job.input_digest === input.input_digest &&
      valuesEqual(record.job.input_json, input.input_json) &&
      record.job.workspace_acquisition_digest === input.workspace_acquisition_digest &&
      valuesEqual(record.job.workspace_acquisition_json, input.workspace_acquisition_json) &&
      record.job.worker_id === input.worker_id &&
      record.job.launch_lease_id === input.launch_lease_id &&
      record.job.launch_lease_id === leaseRecord.lease.id &&
      record.job.launch_attempt === leaseRecord.lease.launch_attempt &&
      leaseRecord.lease.status === 'active' &&
      leaseRecord.lease.profile_revision_id === input.runtime_profile_revision_id &&
      record.runtime_profile_digest === input.runtime_profile_digest &&
      record.credential_binding_id === input.credential_binding_id &&
      record.credential_binding_version_id === input.credential_binding_version_id &&
      record.credential_payload_digest === input.credential_payload_digest &&
      record.docker_image_digest === input.docker_image_digest &&
      record.network_policy_digest === input.network_policy_digest &&
      record.network_provider_config_digest === input.network_provider_config_digest &&
      record.envelope_id === input.envelope_id &&
      envelope.id === input.envelope_id &&
      envelope.runtime_job_id === record.job.id &&
      envelope.launch_lease_id === record.job.launch_lease_id &&
      envelope.worker_id === record.job.worker_id &&
      record.envelope_digest === envelope.envelope_digest &&
      leaseRecord.action_type === input.action_type &&
      leaseRecord.action_attempt === input.action_attempt &&
      leaseRecord.action_claim_token_hash === input.action_claim_token_hash &&
      leaseRecord.precondition_fingerprint === input.precondition_fingerprint &&
      leaseRecord.execution_package_id === input.execution_package_id &&
      leaseRecord.run_worker_lease_id === input.run_worker_lease_id &&
      leaseRecord.run_worker_lease_token_hash === input.run_worker_lease_token_hash &&
      leaseRecord.run_session_status === input.run_session_status &&
      leaseRecord.run_session_updated_at === input.run_session_updated_at &&
      leaseRecord.execution_package_version === input.execution_package_version &&
      this.codexRuntimePendingBundleReplayMatches(record, input.pending_workspace_bundle)
    );
  }

  private codexRuntimePendingBundleReplayMatches(
    record: CodexRuntimeJobPrivateRecord,
    input: PendingWorkspaceBundleReplayInput | undefined,
  ): boolean {
    const stored = record.pending_workspace_bundle;
    if (stored === undefined || input === undefined) {
      return stored === undefined && input === undefined;
    }
    const artifact =
      record.workspace_bundle_artifact_id === undefined
        ? undefined
        : this.codexRuntimeJobArtifacts.get(record.workspace_bundle_artifact_id);
    return (
      artifact !== undefined &&
      stored.runtime_job_id === record.job.id &&
      stored.status === 'bound' &&
      artifact.runtime_job_id === stored.runtime_job_id &&
      artifact.runtime_job_id === record.job.id &&
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

  private codexRuntimeWorkspaceBundleArtifactFromPending(
    runtimeJobId: string,
    pending: CodexPendingWorkspaceBundlePrivateRecord,
    now: string,
  ): CodexRuntimeJobArtifactPrivateRecord {
    const id = `runtime-job:${runtimeJobId}:workspace-bundle:${pending.bundle_id}`;
    const metadata_json = {
      bundle_id: pending.bundle_id,
      manifest_digest: pending.manifest_digest,
      run_worker_lease_id: pending.run_worker_lease_id,
      workspace_acquisition_digest: pending.workspace_acquisition_digest,
      workspace_acquisition_json: clone(pending.workspace_acquisition_json),
      expires_at: pending.expires_at,
    };
    return {
      id,
      runtime_job_id: runtimeJobId,
      artifact_idempotency_key: id,
      kind: 'workspace_bundle',
      name: pending.bundle_id,
      content_type: 'application/vnd.forgeloop.workspace-bundle',
      digest: pending.archive_digest,
      internal_ref: pending.pending_artifact_ref,
      ...(pending.internal_artifact_object_id === undefined
        ? {}
        : { internal_artifact_object_id: pending.internal_artifact_object_id }),
      size_bytes: pending.size_bytes,
      metadata_json,
      request_digest: codexCanonicalDigest({
        runtime_job_id: runtimeJobId,
        bundle_id: pending.bundle_id,
        archive_digest: pending.archive_digest,
        manifest_digest: pending.manifest_digest,
        workspace_acquisition_digest: pending.workspace_acquisition_digest,
      }),
      created_at: now,
    };
  }

  private codexRuntimeJobArtifactPublic(
    artifact: CodexRuntimeJobArtifactPrivateRecord,
    record: CodexRuntimeJobPrivateRecord,
  ): CodexRuntimeJobArtifact {
    return {
      id: artifact.id,
      runtime_job_id: artifact.runtime_job_id,
      project_id: record.job.project_id,
      ...(record.job.repo_id === undefined ? {} : { repo_id: record.job.repo_id }),
      target_kind: record.job.target_kind,
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
      metadata_json: clone(artifact.metadata_json),
      created_at: artifact.created_at,
    };
  }

  private assertCodexRuntimeJobArtifactObjectBinding(input: CreateCodexRuntimeJobArtifactInput): void {
    const object = this.internalArtifactObjects.get(input.internal_artifact_object_id);
    if (
      object === undefined ||
      object.deleted_at !== undefined ||
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

  private preflightCreateCodexRuntimeJobArtifactUnlocked(
    input: PreflightCreateCodexRuntimeJobArtifactInput,
  ): CodexWorkerSessionProof {
    const session = this.assertCodexRuntimeJobWorkerSession(
      input.runtime_job_id,
      input.worker_id,
      input.worker_session_token,
      input.now,
      'codex_runtime_job_unavailable',
      {
        requireConnected: false,
      },
    );
    this.assertCodexRuntimeJobArtifactIntake(input);
    const record = this.codexRuntimeJobs.get(input.runtime_job_id);
    if (record === undefined) {
      throw codexDenied('codex_runtime_job_unavailable', 'Codex runtime job artifact upload was denied.');
    }
    this.assertCodexRuntimeJobArtifactEligibility(record, input);
    const expectedInternalRef =
      `artifact://internal/codex_runtime_job_artifact/codex_runtime_job/${input.runtime_job_id}/${input.artifact_id}`;
    if (input.internal_ref !== expectedInternalRef) {
      throw codexDenied('codex_runtime_job_unavailable', 'Codex runtime job artifact ref was denied.');
    }
    this.assertCodexWorkerNonceAvailable(
      input.worker_id,
      input.worker_session_token,
      input.nonce,
      input.replay_protection,
      session.session_epoch,
    );
    const existing = this.findCodexRuntimeJobArtifactReplay(input);
    if (existing !== undefined && !this.codexRuntimeJobArtifactPreflightReplayMatches(existing, input)) {
      throw codexDenied('codex_runtime_job_unavailable', 'Codex runtime job artifact replay was denied.');
    }
    return session;
  }

  private assertCodexWorkerNonceAvailable(
    workerId: string,
    sessionToken: string,
    nonce: string,
    replayProtection?: CodexWorkerReplayProtectionInput,
    sessionEpochOverride?: number,
  ): void {
    const sessionTokenHash = codexCredentialPayloadDigest(sessionToken);
    const nonceHash = codexCredentialPayloadDigest(nonce);
    const sessionEpoch = sessionEpochOverride ?? this.codexWorkerRegistrations.get(workerId)?.session_epoch ?? 1;
    const replayKeyHash = codexCanonicalDigest({
      method: replayProtection?.method ?? 'LEGACY',
      path: replayProtection?.path ?? 'legacy-worker-session',
      body_digest: replayProtection?.body_digest ?? sessionTokenHash,
      worker_id: workerId,
      session_epoch: sessionEpoch,
      nonce,
    });
    const used = valuesFor(this.codexWorkerSessionNonces).some(
      (record) =>
        (record.worker_id === workerId && record.session_token_hash === sessionTokenHash && record.nonce_hash === nonceHash) ||
        (record.worker_id === workerId && record.session_epoch === sessionEpoch && record.nonce_hash === nonceHash) ||
        record.replay_key_hash === replayKeyHash,
    );
    if (used) {
      throw codexDenied('codex_worker_nonce_replay', 'Codex worker session nonce was already used.');
    }
  }

  private assertCodexWorkerNonceRecorded(
    workerId: string,
    sessionToken: string,
    nonce: string,
    replayProtection: CodexWorkerReplayProtectionInput | undefined,
    sessionEpoch: number,
  ): void {
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
    const record = this.codexWorkerSessionNonces.get(`${workerId}:${sessionEpoch}:${nonceHash}`);
    if (
      record === undefined ||
      record.session_token_hash !== sessionTokenHash ||
      record.request_binding_digest !== requestBindingDigest ||
      record.replay_key_hash !== replayKeyHash
    ) {
      throw codexDenied('codex_worker_nonce_replay', 'Codex worker session nonce reservation was not found.');
    }
  }

  private assertCodexRuntimeJobArtifactIntake(input: PreflightCreateCodexRuntimeJobArtifactInput): void {
    try {
      validateCodexRuntimeJobArtifactIntake(input);
    } catch {
      throw codexDenied('codex_runtime_job_unavailable', 'Codex runtime job artifact upload was denied.');
    }
  }

  private assertCodexRuntimeJobArtifactEligibility(
    record: CodexRuntimeJobPrivateRecord,
    input: PreflightCreateCodexRuntimeJobArtifactInput,
  ): void {
    const leaseRecord = this.codexLaunchLeases.get(record.job.launch_lease_id);
    const preStartFailureEvidenceAllowed =
      input.kind === 'startup_failure_evidence' &&
      ((leaseRecord?.lease.status === 'active' && (record.job.status === 'accepted' || record.job.status === 'materializing')) ||
        (record.job.status === 'materializing' && leaseRecord?.lease.status === 'materialized'));
    if (
      leaseRecord === undefined ||
      record.job.worker_id !== input.worker_id ||
      (record.job.status !== 'running' && !preStartFailureEvidenceAllowed) ||
      record.job.expires_at <= input.now ||
      (leaseRecord.lease.status !== 'materialized' && !preStartFailureEvidenceAllowed) ||
      leaseRecord.lease.expires_at <= input.now
    ) {
      throw codexDenied('codex_runtime_job_unavailable', 'Codex runtime job artifact upload was denied.');
    }
  }

  private findCodexRuntimeJobArtifactReplay(
    input: PreflightCreateCodexRuntimeJobArtifactInput,
  ): CodexRuntimeJobArtifactPrivateRecord | undefined {
    const candidates = valuesFor(this.codexRuntimeJobArtifacts).filter(
      (artifact) =>
        artifact.id === input.artifact_id ||
        (artifact.runtime_job_id === input.runtime_job_id && artifact.artifact_idempotency_key === input.artifact_idempotency_key) ||
        (artifact.runtime_job_id === input.runtime_job_id &&
          artifact.digest === input.digest &&
          artifact.content_type === input.content_type),
    );
    const first = candidates[0];
    if (first === undefined) {
      return undefined;
    }
    if (candidates.some((candidate) => candidate.id !== first.id)) {
      throw codexDenied('codex_runtime_job_unavailable', 'Codex runtime job artifact replay was denied.');
    }
    return first;
  }

  private codexRuntimeJobArtifactReplayMatches(
    artifact: CodexRuntimeJobArtifactPrivateRecord,
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
    artifact: CodexRuntimeJobArtifactPrivateRecord,
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

  private assertCodexRuntimeTerminalArtifactRefs(runtimeJobId: string, terminalResultJson: Record<string, unknown>): void {
    const artifactsByRef = new Map(
      valuesFor(this.codexRuntimeJobArtifacts)
        .filter((artifact) => artifact.runtime_job_id === runtimeJobId)
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

  private codexRuntimePendingBundleCreateMatches(input: CreateOrReplayCodexRuntimeJobWithLeaseAndEnvelopeInput): boolean {
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
    const existing = this.codexPendingWorkspaceBundles.get(pending.bundle_id);
    return (
      existing !== undefined &&
      existing.status === 'pending' &&
      existing.runtime_job_id === undefined &&
      existing.id === pending.id &&
      existing.bundle_id === pending.bundle_id &&
      existing.run_session_id === pending.run_session_id &&
      existing.execution_package_id === pending.execution_package_id &&
      existing.pending_artifact_ref === pending.pending_artifact_ref &&
      existing.internal_artifact_object_id === pending.internal_artifact_object_id &&
      existing.archive_digest === pending.archive_digest &&
      existing.manifest_digest === pending.manifest_digest &&
      existing.archive_bytes_base64 === pending.archive_bytes_base64 &&
      existing.run_worker_lease_id === pending.run_worker_lease_id &&
      existing.size_bytes === pending.size_bytes &&
      existing.expires_at === pending.expires_at &&
      existing.workspace_acquisition_digest === pending.workspace_acquisition_digest &&
      valuesEqual(existing.workspace_acquisition_json, pending.workspace_acquisition_json) &&
      existing.run_session_id === input.target.target_id &&
      existing.execution_package_id === input.execution_package_id &&
      existing.request_digest === pending.request_digest &&
      existing.created_at === pending.created_at
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

  private launchReplayMatches(record: CodexLaunchLeasePrivateRecord, input: CreateOrReplayCodexLaunchLeaseInput): boolean {
    return (
      valuesEqual(record.lease.target, input.target) &&
      record.lease.launch_attempt === input.launch_attempt &&
      record.lease.worker_id === input.worker_id &&
      record.lease.profile_revision_id === input.runtime_profile_revision_id &&
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
      record.execution_package_version === input.execution_package_version
    );
  }

  private codexLaunchFenceMatches(record: CodexLaunchLeasePrivateRecord, activeFence: CodexLaunchFenceSnapshot | undefined): boolean {
    const check = <T>(stored: T | undefined, current: T | undefined): boolean =>
      stored === undefined || (current !== undefined && current === stored);

    return (
      check(record.action_claim_token_hash, activeFence?.action_claim_token_hash) &&
      check(record.precondition_fingerprint, activeFence?.precondition_fingerprint) &&
      check(record.run_worker_lease_id, activeFence?.run_worker_lease_id) &&
      check(record.run_worker_lease_token_hash, activeFence?.run_worker_lease_token_hash) &&
      check(record.run_session_status, activeFence?.run_session_status) &&
      check(record.run_session_updated_at, activeFence?.run_session_updated_at) &&
      check(record.execution_package_version, activeFence?.execution_package_version)
    );
  }

  private codexLaunchFenceIsActive(
    record: CodexLaunchLeasePrivateRecord,
    activeFence: CodexLaunchFenceSnapshot | undefined,
    now: string,
  ): boolean {
    if (activeFence !== undefined && !this.codexLaunchFenceMatches(record, activeFence)) {
      return false;
    }
    if (record.lease.target.target_kind === 'generation') {
      return this.codexGenerationFenceIsActive(record, now);
    }
    return this.codexRunExecutionFenceIsActive(record, now);
  }

  private codexGenerationFenceIsActive(record: CodexLaunchLeasePrivateRecord, now: string): boolean {
    const actionRun = this.automationActionRuns.get(record.lease.target.target_id);
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
      !automationScopeMatchesCodexTarget(
        actionRun.automation_scope,
        record.lease.target.project_id,
        record.lease.target.repo_id,
      )
    ) {
      return false;
    }
    return true;
  }

  private codexRunExecutionFenceIsActive(record: CodexLaunchLeasePrivateRecord, now: string): boolean {
    const runWorkerLease =
      record.run_worker_lease_id === undefined
        ? undefined
        : valuesFor(this.runWorkerLeases).find((candidate) => candidate.id === record.run_worker_lease_id);
    const runSession = runWorkerLease === undefined ? undefined : this.runSessions.get(runWorkerLease.run_session_id);
    const executionPackage =
      record.execution_package_id === undefined ? undefined : this.executionPackages.get(record.execution_package_id);
    if (
      runWorkerLease === undefined ||
      runWorkerLease.status !== 'active' ||
      runWorkerLease.expires_at <= now ||
      (record.run_worker_lease_token_hash !== undefined &&
        codexCredentialPayloadDigest(runWorkerLease.lease_token) !== record.run_worker_lease_token_hash) ||
      runSession === undefined ||
      record.lease.target.target_id !== runSession.id ||
      runSession.execution_package_id !== record.execution_package_id ||
      (record.run_session_status !== undefined && runSession.status !== record.run_session_status) ||
      (record.run_session_updated_at !== undefined && runSession.updated_at !== record.run_session_updated_at) ||
      executionPackage === undefined ||
      executionPackage.project_id !== record.lease.target.project_id ||
      executionPackage.repo_id !== record.lease.target.repo_id ||
      (record.execution_package_version !== undefined && executionPackage.version !== record.execution_package_version)
    ) {
      return false;
    }
    return true;
  }

  private snapshotTransactionalMaps(): Array<readonly [Map<string, unknown>, Map<string, unknown>]> {
    return this.transactionalMaps().map((records) => [
      records,
      new Map([...records.entries()].map(([key, value]) => [key, clone(value)])),
    ]);
  }

  private copyTransactionalStateTo(target: InMemoryDeliveryRepository): void {
    const sourceMaps = this.transactionalMaps();
    const targetMaps = target.transactionalMaps();
    sourceMaps.forEach((source, index) => {
      const targetMap = targetMaps[index]!;
      targetMap.clear();
      for (const [key, value] of source.entries()) {
        targetMap.set(key, clone(value));
      }
    });
  }

  private mergeTransactionalChangesFrom(
    transaction: InMemoryDeliveryRepository,
    snapshots: Array<readonly [Map<string, unknown>, Map<string, unknown>]>,
  ): void {
    const targetMaps = this.transactionalMaps();
    const pendingMutations: Array<{
      targetMap: Map<string, unknown>;
      key: string;
      value?: unknown;
      deleted?: boolean;
    }> = [];
    transaction.transactionalMaps().forEach((transactionMap, index) => {
      const targetMap = targetMaps[index]!;
      const snapshot = snapshots[index]![1];
      for (const [key, value] of transactionMap.entries()) {
        const snapshotValue = snapshot.get(key);
        const currentValue = targetMap.get(key);
        if (!valuesEqual(currentValue, snapshotValue) && !valuesEqual(value, snapshotValue)) {
          throw new DomainError('INVALID_TRANSITION', `Concurrent modification detected for transactional key ${key}`);
        }
        if (!valuesEqual(value, snapshotValue)) {
          pendingMutations.push({ targetMap, key, value: clone(value) });
        }
      }
      for (const key of snapshot.keys()) {
        if (!transactionMap.has(key)) {
          const snapshotValue = snapshot.get(key);
          const currentValue = targetMap.get(key);
          if (!valuesEqual(currentValue, snapshotValue)) {
            throw new DomainError('INVALID_TRANSITION', `Concurrent deletion conflict detected for transactional key ${key}`);
          }
          pendingMutations.push({ targetMap, key, deleted: true });
        }
      }
    });
    for (const mutation of pendingMutations) {
      if (mutation.deleted === true) {
        mutation.targetMap.delete(mutation.key);
      } else {
        mutation.targetMap.set(mutation.key, clone(mutation.value));
      }
    }
  }

  private transactionalMaps(): Array<Map<string, unknown>> {
    return [
      this.organizations,
      this.actors,
      this.projects,
      this.projectRepos,
      this.workItems,
      this.tasks,
      this.specs,
      this.specRevisions,
      this.contextManifests,
      this.developmentPlans,
      this.developmentPlanRevisions,
      this.developmentPlanSourceLinks,
      this.developmentPlanItems,
      this.developmentPlanItemRevisions,
      this.planItemWorkflows,
      this.planItemWorkflowTransitions,
      this.workflowManualDecisions,
      this.executionReadinessRecords,
      this.codexSessions,
      this.codexSessionTurns,
      this.codexSessionSnapshots,
      this.codexSessionLeases,
      this.codexSessionStaleTerminalizationAttempts,
      this.brainstormingSessions,
      this.boundaryRounds,
      this.boundaryQuestions,
      this.boundaryAnswers,
      this.boundaryDecisions,
      this.boundarySummaries,
      this.boundarySummaryRevisions,
      this.executionPlans,
      this.executionPlanRevisions,
      this.executions,
      this.codeReviewHandoffs,
      this.qaHandoffs,
      this.plans,
      this.planRevisions,
      this.executionPackages,
      this.executionPackageDependencies,
      this.attachments,
      this.runSessions,
      this.runEvents,
      this.runCommands,
      this.runWorkerLeases,
      this.reviewPackets,
      this.releases,
      this.releaseWorkItems,
      this.releaseWorkItemOrders,
      this.releaseExecutionPackages,
      this.releaseExecutionPackageOrders,
      this.releaseEvidences,
      this.objectEvents,
      this.statusHistories,
      this.artifacts,
      this.decisions,
      this.traceEvents,
      this.traceLinks,
      this.traceArtifactRefs,
      this.automationProjectSettings,
      this.manualPathHolds,
      this.manualPathHoldIdempotency,
      this.manualPathHoldSourceActions,
      this.commandIdempotencyRecords,
      this.executionPackageGenerationRuns,
      this.executionPackageGenerationPackages,
      this.automationActionRuns,
      this.automationActionRunIdempotency,
      this.codexRuntimeProfiles,
      this.codexRuntimeProfileRevisions,
      this.codexCredentialBindings,
      this.codexCredentialBindingVersions,
      this.codexWorkerBootstrapTokens,
      this.codexWorkerRegistrations,
      this.codexWorkerSessionNonces,
      this.codexRuntimeSetupNonces,
      this.codexLaunchLeases,
      this.codexLaunchLeaseRequestIds,
      this.codexRuntimeJobs,
      this.codexRuntimeJobRequestIds,
      this.codexRuntimeJobTargetAttempts,
      this.codexLaunchTokenEnvelopes,
      this.codexRuntimeJobArtifacts,
      this.codexPendingWorkspaceBundles,
      this.internalArtifactObjects,
      this.internalArtifactObjectRefs,
      this.internalArtifactObjectOwnerIdempotency,
      this.internalArtifactObjectOwnerKindArtifact,
      this.codexRuntimeJobEventIds,
      this.codexRuntimeJobEventIdempotency,
    ] as Array<Map<string, unknown>>;
  }

  private dependencyKey(dependency: ExecutionPackageDependency): string {
    return `${dependency.package_id}:${dependency.depends_on_package_id}`;
  }

  private async hydrateReleaseLinks(release: Release): Promise<Release> {
    const [workItems, executionPackages] = await Promise.all([
      this.listReleaseWorkItems(release.id),
      this.listReleaseExecutionPackages(release.id),
    ]);

    return {
      ...clone(release),
      work_item_ids: workItems.map((workItem) => workItem.work_item_id),
      execution_package_ids: executionPackages.map((executionPackage) => executionPackage.execution_package_id),
    };
  }

  private replaceReleaseWorkItems(releaseId: string, workItemIds: string[]): void {
    const uniqueWorkItemIds = [...new Set(workItemIds)];
    for (const key of [...this.releaseWorkItems.keys()]) {
      if (key.startsWith(`${releaseId}:`)) {
        this.releaseWorkItems.delete(key);
        this.releaseWorkItemOrders.delete(key);
      }
    }

    uniqueWorkItemIds.forEach((workItemId, index) => {
      const key = `${releaseId}:${workItemId}`;
      this.releaseWorkItems.set(key, clone({ release_id: releaseId, work_item_id: workItemId }));
      this.releaseWorkItemOrders.set(key, index);
    });
  }

  private replaceReleaseExecutionPackages(releaseId: string, executionPackageIds: string[]): void {
    const uniqueExecutionPackageIds = [...new Set(executionPackageIds)];
    for (const key of [...this.releaseExecutionPackages.keys()]) {
      if (key.startsWith(`${releaseId}:`)) {
        this.releaseExecutionPackages.delete(key);
        this.releaseExecutionPackageOrders.delete(key);
      }
    }

    uniqueExecutionPackageIds.forEach((executionPackageId, index) => {
      const key = `${releaseId}:${executionPackageId}`;
      this.releaseExecutionPackages.set(key, clone({ release_id: releaseId, execution_package_id: executionPackageId }));
      this.releaseExecutionPackageOrders.set(key, index);
    });
  }

  private claimCommand(command: RunCommand, workerId: string, claimedAt: string): RunCommand {
    const claimed: RunCommand = {
      ...command,
      status: 'claimed',
      claimed_by_worker_id: workerId,
      claimed_at: claimedAt,
      updated_at: claimedAt,
    };
    this.runCommands.set(claimed.id, clone(claimed));
    return clone(claimed);
  }

  private async getFencedCommand(
    commandId: string,
    lease: { workerId: string; leaseToken: string },
    now: string,
  ): Promise<RunCommand> {
    const command = this.runCommands.get(commandId);
    if (command === undefined || command.status !== 'claimed' || command.claimed_by_worker_id !== lease.workerId) {
      throw new DomainError('INVALID_TRANSITION', `Run command ${commandId} is not claimed by worker ${lease.workerId}`);
    }

    await this.assertActiveRunWorkerLease(command.run_session_id, lease.workerId, lease.leaseToken, now);
    return clone(command);
  }
}

const commandPriority = (command: RunCommand): number => (command.command_type === 'cancel' ? 0 : 1);
