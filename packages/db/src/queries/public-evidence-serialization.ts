import {
  isLocalReferenceString,
  isPublicArtifactStorageUri,
  isUnsafePublicEvidenceKey,
  publicArtifactKindSchema,
  publicArtifactRefSchema,
  publicDecisionSchema,
  publicMetricsSchema,
  publicObjectEventPayloadSchema,
  publicObjectEventSchema,
  publicReleaseEvidenceExtraSchema,
  publicReleaseEvidenceSchema,
  publicReplayEntrySchema,
  publicStatusHistoryContextSchema,
  publicStatusHistorySchema,
  releaseEvidenceObjectRefSchema,
  type EvidenceChainRedactionReason,
  type PublicArtifactKind,
  type PublicArtifactRef,
  type PublicDecision,
  type PublicObjectEvent,
  type PublicObjectEventPayload,
  type PublicReleaseEvidence,
  type PublicReleaseEvidenceExtra,
  type PublicReplayEntry,
  type PublicStatusHistory,
  type PublicStatusHistoryContext,
} from '@forgeloop/contracts';
import type { Artifact, Decision, ObjectEvent, ReleaseEvidence, StatusHistory } from '@forgeloop/domain';
import { z } from 'zod';

export type ArtifactRef = Artifact['ref'];

export type SerializePublicReleaseEvidenceInput = {
  evidence: ReleaseEvidence;
  artifact?: Artifact | ArtifactRef;
};

export type ReplaySerializationInput =
  | {
      id: string;
      source: 'object_event';
      object_type: string;
      object_id: string;
      summary: string;
      created_at: string;
      payload: ObjectEvent;
    }
  | {
      id: string;
      source: 'status_history';
      object_type: string;
      object_id: string;
      summary: string;
      created_at: string;
      payload: StatusHistory;
    }
  | {
      id: string;
      source: 'decision';
      object_type: string;
      object_id: string;
      summary: string;
      created_at: string;
      payload: Decision;
    }
  | {
      id: string;
      source: 'artifact';
      object_type: string;
      object_id: string;
      summary: string;
      created_at: string;
      payload: ArtifactRef;
    }
  | {
      id: string;
      source: 'release_evidence';
      object_type: string;
      object_id: string;
      summary: string;
      created_at: string;
      payload: SerializePublicReleaseEvidenceInput;
    };

const isoDateTimeSchema = z.string().datetime();
const actorTypes = new Set(['human', 'ai', 'system']);
const deploymentResults = new Set(['succeeded', 'failed', 'cancelled', 'in_progress']);
const rollbackResults = new Set(['succeeded', 'failed', 'cancelled', 'not_required']);
const checkStatuses = new Set(['succeeded', 'failed', 'skipped']);
const observationSources = new Set(['human', 'script']);
const observationSeverities = new Set(['info', 'warning', 'failure']);

const objectEventStringFields = [
  'release_id',
  'work_item_id',
  'execution_package_id',
  'run_session_id',
  'review_packet_id',
  'spec_id',
  'spec_revision_id',
  'plan_id',
  'plan_revision_id',
  'artifact_id',
  'decision_id',
  'trace_event_id',
  'command_id',
  'status',
  'from_status',
  'to_status',
  'phase',
  'activity_state',
  'gate_state',
  'resolution',
  'outcome',
  'decision',
  'result',
  'mode',
  'executor_type',
  'reason',
  'summary',
] as const;

const statusHistoryStringFields = [
  'release_id',
  'work_item_id',
  'execution_package_id',
  'run_session_id',
  'review_packet_id',
  'actor_id',
  'reason',
  'summary',
] as const;

const publicStringArrayFields = ['blocker_codes', 'required_check_ids', 'failed_check_ids'] as const;

type JsonRecord = Record<string, unknown>;
type PublicObservation = NonNullable<PublicReleaseEvidenceExtra['observation']>;
type PublicObservationLink = NonNullable<PublicObservation['links']>[number];

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const safeString = (value: unknown): string | undefined => {
  if (typeof value !== 'string' || value.length === 0 || isLocalReferenceString(value)) {
    return undefined;
  }

  return value;
};

const safeIsoDateTime = (value: unknown): string | undefined => {
  const text = safeString(value);
  if (text === undefined || !isoDateTimeSchema.safeParse(text).success) {
    return undefined;
  }

  return text;
};

const safeEnum = <T extends string>(value: unknown, allowed: ReadonlySet<string>): T | undefined => {
  if (typeof value !== 'string' || !allowed.has(value)) {
    return undefined;
  }

  return value as T;
};

const safeActorType = (value: unknown): 'human' | 'ai' | 'system' | undefined =>
  safeEnum<'human' | 'ai' | 'system'>(value, actorTypes);

const safePublicScalar = (value: unknown): string | number | boolean | null | undefined => {
  if (typeof value === 'string') {
    return isLocalReferenceString(value) ? undefined : value;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }

  if (typeof value === 'boolean' || value === null) {
    return value;
  }

  return undefined;
};

const safeStringArray = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const strings = value.filter((item): item is string => safeString(item) !== undefined);

  return strings.length > 0 ? strings : undefined;
};

const safePublicArtifactKindArray = (value: unknown): PublicArtifactKind[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const kinds = value.flatMap((item) => {
    const parsed = publicArtifactKindSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });

  return kinds.length > 0 ? kinds : undefined;
};

const assignSafeString = (target: JsonRecord, key: string, value: unknown): void => {
  const text = safeString(value);
  if (text !== undefined) {
    target[key] = text;
  }
};

const sanitizeStringArrayFields = (target: JsonRecord, source: JsonRecord): void => {
  for (const field of publicStringArrayFields) {
    const array = safeStringArray(source[field]);
    if (array !== undefined) {
      target[field] = array;
    }
  }
};

const hasKeys = (record: JsonRecord): boolean => Object.keys(record).length > 0;

export class UnsafePublicArtifactReplayPayloadError extends Error {
  constructor() {
    super('Unsafe public artifact replay payload');
    this.name = 'UnsafePublicArtifactReplayPayloadError';
  }
}

export const artifactRedactionReason = (artifact: ArtifactRef): EvidenceChainRedactionReason | undefined => {
  const candidate = artifact as ArtifactRef & { raw_ref?: unknown };

  if (artifact.kind === 'logs') {
    return 'logs_artifact';
  }

  if (artifact.kind === 'raw_metadata') {
    return 'raw_metadata_artifact';
  }

  if (candidate.raw_ref !== undefined) {
    return 'raw_ref';
  }

  if (artifact.local_ref !== undefined && artifact.storage_uri === undefined) {
    return 'local_ref_only';
  }

  if (typeof artifact.storage_uri !== 'string' || !isPublicArtifactStorageUri(artifact.storage_uri)) {
    return 'unsafe_storage_uri';
  }

  return undefined;
};

export const serializePublicArtifactRef = (artifact: ArtifactRef): PublicArtifactRef | undefined => {
  if (artifactRedactionReason(artifact) !== undefined) {
    return undefined;
  }

  const candidate = artifact as ArtifactRef & { raw_ref?: unknown };
  const name = safeString(candidate.name);
  const contentType = safeString(candidate.content_type);
  if (name === undefined || contentType === undefined) {
    return undefined;
  }

  const digest = safeString(candidate.digest);
  const publicArtifact = {
    kind: candidate.kind,
    name,
    content_type: contentType,
    storage_uri: candidate.storage_uri,
    ...(digest !== undefined ? { digest } : {}),
  };
  const parsed = publicArtifactRefSchema.safeParse(publicArtifact);

  return parsed.success ? parsed.data : undefined;
};

export const serializePublicArtifactRefs = (artifacts: readonly ArtifactRef[]): PublicArtifactRef[] =>
  artifacts.flatMap((artifact) => {
    const publicArtifact = serializePublicArtifactRef(artifact);
    return publicArtifact === undefined ? [] : [publicArtifact];
  });

export const serializePublicDecision = (decision: Decision): PublicDecision =>
  publicDecisionSchema.parse({
    id: decision.id,
    object_type: decision.object_type,
    object_id: decision.object_id,
    actor_id: decision.actor_id,
    ...(safeString(decision.decided_by_actor_id) !== undefined ? { decided_by_actor_id: decision.decided_by_actor_id } : {}),
    ...(safeString(decision.decision_type) !== undefined ? { decision_type: decision.decision_type } : {}),
    ...(safeString(decision.outcome) !== undefined ? { outcome: decision.outcome } : {}),
    decision: decision.decision,
    summary: decision.summary,
    ...(safeString(decision.rationale) !== undefined ? { rationale: decision.rationale } : {}),
    created_at: decision.created_at,
  });

const serializePublicObjectEventPayload = (payload: unknown): PublicObjectEventPayload => {
  if (!isRecord(payload)) {
    return publicObjectEventPayloadSchema.parse({});
  }

  const publicPayload: JsonRecord = {};

  for (const field of objectEventStringFields) {
    assignSafeString(publicPayload, field, payload[field]);
  }

  if (typeof payload.workflow_only === 'boolean') {
    publicPayload.workflow_only = payload.workflow_only;
  }

  sanitizeStringArrayFields(publicPayload, payload);

  const artifactKinds = safePublicArtifactKindArray(payload.missing_artifact_kinds);
  if (artifactKinds !== undefined) {
    publicPayload.missing_artifact_kinds = artifactKinds;
  }

  return publicObjectEventPayloadSchema.parse(publicPayload);
};

export const serializePublicObjectEvent = (objectEvent: ObjectEvent): PublicObjectEvent => {
  const actorType = safeActorType(objectEvent.actor_type);

  return publicObjectEventSchema.parse({
    id: objectEvent.id,
    object_type: objectEvent.object_type,
    object_id: objectEvent.object_id,
    event_type: objectEvent.event_type,
    ...(actorType !== undefined ? { actor_type: actorType } : {}),
    ...(safeString(objectEvent.actor_id) !== undefined ? { actor_id: objectEvent.actor_id } : {}),
    ...(safeString(objectEvent.reason) !== undefined ? { reason: objectEvent.reason } : {}),
    payload: serializePublicObjectEventPayload(objectEvent.payload ?? {}),
    created_at: objectEvent.created_at,
  });
};

const serializePublicStatusHistoryContext = (context: unknown): PublicStatusHistoryContext => {
  if (!isRecord(context)) {
    return publicStatusHistoryContextSchema.parse({});
  }

  const publicContext: JsonRecord = {};

  for (const field of statusHistoryStringFields) {
    assignSafeString(publicContext, field, context[field]);
  }

  sanitizeStringArrayFields(publicContext, context);

  const artifactKinds = safePublicArtifactKindArray(context.missing_artifact_kinds);
  if (artifactKinds !== undefined) {
    publicContext.missing_artifact_kinds = artifactKinds;
  }

  const previousValue = safePublicScalar(context.previous_value);
  if (previousValue !== undefined) {
    publicContext.previous_value = previousValue;
  }

  const nextValue = safePublicScalar(context.next_value);
  if (nextValue !== undefined) {
    publicContext.next_value = nextValue;
  }

  return publicStatusHistoryContextSchema.parse(publicContext);
};

export const serializePublicStatusHistory = (statusHistory: StatusHistory): PublicStatusHistory => {
  const actorType = safeActorType(statusHistory.actor_type);

  return publicStatusHistorySchema.parse({
    id: statusHistory.id,
    object_type: statusHistory.object_type,
    object_id: statusHistory.object_id,
    ...(safeString(statusHistory.field_name) !== undefined ? { field_name: statusHistory.field_name } : {}),
    ...(safeString(statusHistory.from_status) !== undefined ? { from_status: statusHistory.from_status } : {}),
    to_status: statusHistory.to_status,
    ...(safeString(statusHistory.from_value) !== undefined ? { from_value: statusHistory.from_value } : {}),
    ...(safeString(statusHistory.to_value) !== undefined ? { to_value: statusHistory.to_value } : {}),
    ...(actorType !== undefined ? { actor_type: actorType } : {}),
    ...(safeString(statusHistory.actor_id) !== undefined ? { actor_id: statusHistory.actor_id } : {}),
    ...(safeString(statusHistory.reason) !== undefined ? { reason: statusHistory.reason } : {}),
    context: serializePublicStatusHistoryContext(statusHistory.context ?? {}),
    created_at: statusHistory.created_at,
  });
};

const sanitizeMetrics = (metrics: unknown): Record<string, string | number | boolean | null> | undefined => {
  if (!isRecord(metrics)) {
    return undefined;
  }

  const publicMetrics: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(metrics)) {
    if (isUnsafePublicEvidenceKey(key)) {
      continue;
    }

    const scalar = safePublicScalar(value);
    if (scalar !== undefined) {
      publicMetrics[key] = scalar;
    }
  }

  if (!hasKeys(publicMetrics)) {
    return undefined;
  }

  const parsed = publicMetricsSchema.safeParse(publicMetrics);
  return parsed.success ? parsed.data : undefined;
};

const parseExtraCandidate = (candidate: unknown): PublicReleaseEvidenceExtra | undefined => {
  const parsed = publicReleaseEvidenceExtraSchema.safeParse(candidate);
  return parsed.success ? parsed.data : undefined;
};

const sanitizeObservationLink = (link: unknown, observation: PublicObservation): PublicObservationLink | undefined => {
  if (!isRecord(link)) {
    return undefined;
  }

  const objectId = safeString(link.object_id);
  if (objectId === undefined) {
    return undefined;
  }

  const parsed = parseExtraCandidate({
    observation: {
      source: observation.source,
      severity: observation.severity,
      summary: observation.summary,
      observed_at: observation.observed_at,
      links: [
        {
          object_type: link.object_type,
          object_id: objectId,
          relationship: link.relationship,
        },
      ],
    },
  });

  return parsed?.observation?.links?.[0];
};

const sanitizeObservation = (value: unknown): PublicReleaseEvidenceExtra['observation'] | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }

  const source = safeEnum(value.source, observationSources);
  const severity = safeEnum(value.severity, observationSeverities);
  const summary = safeString(value.summary);
  const observedAt = safeIsoDateTime(value.observed_at);
  if (source === undefined || severity === undefined || summary === undefined || observedAt === undefined) {
    return undefined;
  }

  const observation: PublicObservation = { source, severity, summary, observed_at: observedAt };
  const actorId = safeString(value.actor_id);
  if (actorId !== undefined) {
    observation.actor_id = actorId;
  }

  const notes = safeString(value.notes);
  if (notes !== undefined) {
    observation.notes = notes;
  }

  if (Array.isArray(value.links)) {
    const links = value.links.flatMap((link) => {
      const publicLink = sanitizeObservationLink(link, observation);
      return publicLink === undefined ? [] : [publicLink];
    });
    if (links.length > 0) {
      observation.links = links;
    }
  }

  const metrics = sanitizeMetrics(value.metrics);
  if (metrics !== undefined) {
    observation.metrics = metrics;
  }

  return parseExtraCandidate({ observation })?.observation;
};

const assignOptionalDate = (target: JsonRecord, key: string, value: unknown): void => {
  const dateTime = safeIsoDateTime(value);
  if (dateTime !== undefined) {
    target[key] = dateTime;
  }
};

const sanitizeDeployment = (value: unknown): PublicReleaseEvidenceExtra['deployment'] | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }

  const environment = safeString(value.environment);
  const result = safeEnum(value.result, deploymentResults);
  if (environment === undefined || result === undefined) {
    return undefined;
  }

  const deployment: JsonRecord = { environment, result };
  for (const field of ['deployment_id', 'target', 'version', 'actor_id', 'notes']) {
    assignSafeString(deployment, field, value[field]);
  }
  assignOptionalDate(deployment, 'started_at', value.started_at);
  assignOptionalDate(deployment, 'completed_at', value.completed_at);

  return parseExtraCandidate({ deployment })?.deployment;
};

const sanitizeRollback = (value: unknown): PublicReleaseEvidenceExtra['rollback'] | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }

  const result = safeEnum(value.result, rollbackResults);
  if (result === undefined) {
    return undefined;
  }

  const rollback: JsonRecord = { result };
  for (const field of ['reason', 'rollback_id', 'target', 'actor_id', 'notes']) {
    assignSafeString(rollback, field, value[field]);
  }
  assignOptionalDate(rollback, 'started_at', value.started_at);
  assignOptionalDate(rollback, 'completed_at', value.completed_at);

  return parseExtraCandidate({ rollback })?.rollback;
};

const sanitizeBuild = (value: unknown): PublicReleaseEvidenceExtra['build'] | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }

  const build: JsonRecord = {};
  for (const field of ['build_id', 'version', 'commit_sha', 'source_branch', 'artifact_id']) {
    assignSafeString(build, field, value[field]);
  }

  const result = safeEnum(value.result, deploymentResults);
  if (result !== undefined) {
    build.result = result;
  }

  assignOptionalDate(build, 'started_at', value.started_at);
  assignOptionalDate(build, 'completed_at', value.completed_at);

  if (isRecord(value.artifact)) {
    const artifact = serializePublicArtifactRef(value.artifact as ArtifactRef);
    if (artifact !== undefined) {
      build.artifact = artifact;
    }
  }

  if (!hasKeys(build)) {
    return undefined;
  }

  return parseExtraCandidate({ build })?.build;
};

const sanitizeCheckRefs = (value: unknown): PublicReleaseEvidenceExtra['check_refs'] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const checkRefs = value.flatMap((item) => {
    if (!isRecord(item)) {
      return [];
    }

    const checkId = safeString(item.check_id);
    const status = safeEnum(item.status, checkStatuses);
    if (checkId === undefined || status === undefined) {
      return [];
    }

    const checkRef: JsonRecord = { check_id: checkId, status };
    assignSafeString(checkRef, 'summary', item.summary);
    assignSafeString(checkRef, 'artifact_id', item.artifact_id);

    if (isRecord(item.artifact)) {
      const artifact = serializePublicArtifactRef(item.artifact as ArtifactRef);
      if (artifact !== undefined) {
        checkRef.artifact = artifact;
      }
    }

    const parsed = parseExtraCandidate({ check_refs: [checkRef] });
    return parsed?.check_refs?.[0] === undefined ? [] : [parsed.check_refs[0]];
  });

  return checkRefs.length > 0 ? checkRefs : undefined;
};

const serializePublicReleaseEvidenceExtra = (extra: unknown): PublicReleaseEvidenceExtra => {
  if (!isRecord(extra)) {
    return publicReleaseEvidenceExtraSchema.parse({});
  }

  const publicExtra: PublicReleaseEvidenceExtra = {};
  const observation = sanitizeObservation(extra.observation);
  if (observation !== undefined) {
    publicExtra.observation = observation;
  }

  const deployment = sanitizeDeployment(extra.deployment);
  if (deployment !== undefined) {
    publicExtra.deployment = deployment;
  }

  const rollback = sanitizeRollback(extra.rollback);
  if (rollback !== undefined) {
    publicExtra.rollback = rollback;
  }

  const build = sanitizeBuild(extra.build);
  if (build !== undefined) {
    publicExtra.build = build;
  }

  const checkRefs = sanitizeCheckRefs(extra.check_refs);
  if (checkRefs !== undefined) {
    publicExtra.check_refs = checkRefs;
  }

  return publicReleaseEvidenceExtraSchema.parse(publicExtra);
};

const artifactRefFromInput = (artifact: Artifact | ArtifactRef | undefined): ArtifactRef | undefined => {
  if (artifact === undefined) {
    return undefined;
  }

  if (isRecord(artifact) && 'ref' in artifact && isRecord((artifact as { ref?: unknown }).ref)) {
    return (artifact as { ref: ArtifactRef }).ref;
  }

  return artifact as ArtifactRef;
};

const safeReleaseObjectRef = (objectRef: unknown): ReleaseEvidence['object_ref'] | undefined => {
  if (!isRecord(objectRef)) {
    return undefined;
  }

  const objectId = safeString(objectRef.object_id);
  if (objectId === undefined) {
    return undefined;
  }

  const parsed = releaseEvidenceObjectRefSchema.safeParse({
    object_type: objectRef.object_type,
    object_id: objectId,
    relationship: objectRef.relationship,
  });

  return parsed.success ? parsed.data : undefined;
};

export const serializePublicReleaseEvidence = (input: SerializePublicReleaseEvidenceInput): PublicReleaseEvidence => {
  const { evidence } = input;
  const artifactRef = artifactRefFromInput(input.artifact);
  const artifact = artifactRef === undefined ? undefined : serializePublicArtifactRef(artifactRef);
  const objectRef = safeReleaseObjectRef(evidence.object_ref);

  return publicReleaseEvidenceSchema.parse({
    id: evidence.id,
    release_id: evidence.release_id,
    evidence_type: evidence.evidence_type,
    summary: evidence.summary,
    ...(objectRef !== undefined ? { object_ref: objectRef } : {}),
    ...(safeString(evidence.artifact_id) !== undefined ? { artifact_id: evidence.artifact_id } : {}),
    ...(artifact !== undefined ? { artifact } : {}),
    extra: serializePublicReleaseEvidenceExtra(evidence.extra ?? {}),
    redacted: evidence.redacted,
    status: evidence.status,
    created_at: evidence.created_at,
    ...(safeString(evidence.created_by_actor_id) !== undefined ? { created_by_actor_id: evidence.created_by_actor_id } : {}),
  });
};

export const serializePublicReplayPayload = (
  source: PublicReplayEntry['source'],
  payload: unknown,
): PublicReplayEntry['payload'] => {
  switch (source) {
    case 'object_event':
      return serializePublicObjectEvent(payload as ObjectEvent);
    case 'status_history':
      return serializePublicStatusHistory(payload as StatusHistory);
    case 'decision':
      return serializePublicDecision(payload as Decision);
    case 'artifact': {
      const artifact = serializePublicArtifactRef(payload as ArtifactRef);
      if (artifact === undefined) {
        throw new UnsafePublicArtifactReplayPayloadError();
      }
      return artifact;
    }
    case 'release_evidence':
      return serializePublicReleaseEvidence(payload as SerializePublicReleaseEvidenceInput);
    default: {
      const exhaustive: never = source;
      return exhaustive;
    }
  }
};

export const serializePublicReplayEntry = (entry: ReplaySerializationInput): PublicReplayEntry =>
  publicReplayEntrySchema.parse({
    id: entry.id,
    source: entry.source,
    object_type: entry.object_type,
    object_id: entry.object_id,
    summary: entry.summary,
    created_at: entry.created_at,
    payload: serializePublicReplayPayload(entry.source, entry.payload),
  });
