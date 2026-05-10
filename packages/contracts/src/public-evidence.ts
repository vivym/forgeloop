import { z } from 'zod';

import {
  releaseEvidenceObjectRefSchema,
  releaseEvidenceStatusSchema,
  releaseEvidenceTypeSchema,
} from './release.js';

const isoDateTimeSchema = z.string().datetime();

const actorTypeSchema = z.enum(['human', 'ai', 'system']);
const publicScalarSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

const unsafePublicEvidenceKeys = new Set([
  'raw_ref',
  'local_ref',
  'raw_metadata',
  'raw_payload',
  'raw_logs',
  'logs',
  'stdout',
  'stderr',
  'env',
  'environment_variables',
  'headers',
  'authorization',
  'auth_header',
  'cookie',
  'set_cookie',
  'api_key',
  'password',
  'credential',
  'credentials',
  'secret',
  'token',
  'access_token',
  'refresh_token',
  'client_secret',
  'private_key',
]);

const unsafePublicEvidenceKeySuffixes = [
  '_token',
  '_secret',
  '_password',
  '_credential',
  '_credentials',
  '_api_key',
  '_private_key',
];

const unsafePublicEvidenceKeyPrefixes = ['secret_', 'password_', 'credential_', 'credentials_'];

const localReferencePrefixes = [
  '/Users/',
  '/home/',
  '/tmp/',
  '/private/tmp/',
  '/var/',
  '/workspace/',
  '/workspaces/',
  '/opt/',
  '/mnt/',
  '/Volumes/',
];

const decodePercentEncoded = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const currentWorkingDirectory = (): string | undefined => {
  const globalProcess = (globalThis as { process?: { cwd?: () => string } }).process;

  if (!globalProcess?.cwd) {
    return undefined;
  }

  const cwd = globalProcess.cwd();

  return cwd.endsWith('/') ? cwd : `${cwd}/`;
};

export const normalizePublicEvidenceKey = (key: string): string =>
  key
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

export const isUnsafePublicEvidenceKey = (key: string): boolean => {
  const normalizedKey = normalizePublicEvidenceKey(key);

  return (
    unsafePublicEvidenceKeys.has(normalizedKey) ||
    unsafePublicEvidenceKeySuffixes.some((suffix) => normalizedKey.endsWith(suffix)) ||
    unsafePublicEvidenceKeyPrefixes.some((prefix) => normalizedKey.startsWith(prefix))
  );
};

export const isLocalReferenceString = (value: string): boolean => {
  const reference = decodePercentEncoded(value.trim());
  const normalizedAbsoluteReference = reference.replace(/^\/+/, '/');
  const repoRoot = currentWorkingDirectory();

  if (repoRoot && reference.includes(repoRoot)) {
    return true;
  }

  if (
    localReferencePrefixes.some(
      (prefix) => normalizedAbsoluteReference.startsWith(prefix) || reference.includes(prefix),
    )
  ) {
    return true;
  }

  if (/^[A-Za-z]:[\\/]/.test(reference) || reference.startsWith('\\\\')) {
    return true;
  }

  if (reference.startsWith('file://') || reference.startsWith('local://')) {
    return true;
  }

  return reference === 'artifacts' || reference.startsWith('artifacts/') || reference.startsWith('./artifacts/') || reference.startsWith('../artifacts/');
};

export const isPublicArtifactStorageUri = (storageUri: string): boolean => {
  const uri = storageUri.trim();

  if (!uri || /^https:\/\/\//.test(uri) || /^(?:s3|gs):\/\/(?:$|[/?#])/.test(uri) || isLocalReferenceString(uri)) {
    return false;
  }

  if (uri.includes('?') || uri.includes('#')) {
    return false;
  }

  const schemeMatch = /^(s3|gs|https):\/\/(.+)$/i.exec(uri);

  if (!schemeMatch) {
    return false;
  }

  const scheme = schemeMatch[1]!;
  const rest = schemeMatch[2]!;
  const slashIndex = rest.indexOf('/');
  const authority = slashIndex === -1 ? rest : rest.slice(0, slashIndex);
  const path = slashIndex === -1 ? '' : rest.slice(slashIndex);

  if (!authority || authority.includes('@')) {
    return false;
  }

  if (!['s3', 'gs', 'https'].includes(scheme.toLowerCase())) {
    return false;
  }

  const decodedPath = decodePercentEncoded(path);

  return !isLocalReferenceString(decodedPath);
};

export const publicArtifactKindSchema = z.enum([
  'diff',
  'changed_files',
  'check_output',
  'execution_summary',
  'self_review',
  'review_packet',
]);
export type PublicArtifactKind = z.infer<typeof publicArtifactKindSchema>;

export const publicArtifactRefSchema = z
  .object({
    kind: publicArtifactKindSchema,
    name: z.string().min(1),
    content_type: z.string().min(1),
    storage_uri: z.string().min(1),
    digest: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((artifact, ctx) => {
    if (!isPublicArtifactStorageUri(artifact.storage_uri)) {
      ctx.addIssue({
        code: 'custom',
        path: ['storage_uri'],
        message: 'PublicArtifactRef.storage_uri must be a public s3://, gs://, or https:// object URI',
      });
    }
  });
export type PublicArtifactRef = z.infer<typeof publicArtifactRefSchema>;

export const publicDecisionSchema = z
  .object({
    id: z.string().min(1),
    object_type: z.string().min(1),
    object_id: z.string().min(1),
    actor_id: z.string().min(1),
    decided_by_actor_id: z.string().min(1).optional(),
    decision_type: z.string().min(1).optional(),
    outcome: z.string().min(1).optional(),
    decision: z.enum(['approved', 'changes_requested', 'need_more_context', 'escalate', 'override_approved']),
    summary: z.string().min(1),
    rationale: z.string().min(1).optional(),
    created_at: isoDateTimeSchema,
  })
  .strict();
export type PublicDecision = z.infer<typeof publicDecisionSchema>;

const publicStringArraySchema = z.array(z.string().min(1));

export const publicObjectEventPayloadSchema = z
  .object({
    release_id: z.string().min(1).optional(),
    work_item_id: z.string().min(1).optional(),
    execution_package_id: z.string().min(1).optional(),
    run_session_id: z.string().min(1).optional(),
    review_packet_id: z.string().min(1).optional(),
    spec_id: z.string().min(1).optional(),
    spec_revision_id: z.string().min(1).optional(),
    plan_id: z.string().min(1).optional(),
    plan_revision_id: z.string().min(1).optional(),
    artifact_id: z.string().min(1).optional(),
    decision_id: z.string().min(1).optional(),
    trace_event_id: z.string().min(1).optional(),
    command_id: z.string().min(1).optional(),
    status: z.string().min(1).optional(),
    from_status: z.string().min(1).optional(),
    to_status: z.string().min(1).optional(),
    phase: z.string().min(1).optional(),
    activity_state: z.string().min(1).optional(),
    gate_state: z.string().min(1).optional(),
    resolution: z.string().min(1).optional(),
    outcome: z.string().min(1).optional(),
    decision: z.string().min(1).optional(),
    result: z.string().min(1).optional(),
    mode: z.string().min(1).optional(),
    workflow_only: z.boolean().optional(),
    executor_type: z.string().min(1).optional(),
    reason: z.string().min(1).optional(),
    summary: z.string().min(1).optional(),
    blocker_codes: publicStringArraySchema.optional(),
    required_check_ids: publicStringArraySchema.optional(),
    failed_check_ids: publicStringArraySchema.optional(),
    missing_artifact_kinds: z.array(publicArtifactKindSchema).optional(),
  })
  .strict();
export type PublicObjectEventPayload = z.infer<typeof publicObjectEventPayloadSchema>;

export const publicObjectEventSchema = z
  .object({
    id: z.string().min(1),
    object_type: z.string().min(1),
    object_id: z.string().min(1),
    event_type: z.string().min(1),
    actor_type: actorTypeSchema.optional(),
    actor_id: z.string().min(1).optional(),
    reason: z.string().min(1).optional(),
    payload: publicObjectEventPayloadSchema,
    created_at: isoDateTimeSchema,
  })
  .strict();
export type PublicObjectEvent = z.infer<typeof publicObjectEventSchema>;

export const publicStatusHistoryContextSchema = z
  .object({
    release_id: z.string().min(1).optional(),
    work_item_id: z.string().min(1).optional(),
    execution_package_id: z.string().min(1).optional(),
    run_session_id: z.string().min(1).optional(),
    review_packet_id: z.string().min(1).optional(),
    actor_id: z.string().min(1).optional(),
    reason: z.string().min(1).optional(),
    summary: z.string().min(1).optional(),
    blocker_codes: publicStringArraySchema.optional(),
    required_check_ids: publicStringArraySchema.optional(),
    failed_check_ids: publicStringArraySchema.optional(),
    missing_artifact_kinds: z.array(publicArtifactKindSchema).optional(),
    previous_value: publicScalarSchema.optional(),
    next_value: publicScalarSchema.optional(),
  })
  .strict();
export type PublicStatusHistoryContext = z.infer<typeof publicStatusHistoryContextSchema>;

export const publicStatusHistorySchema = z
  .object({
    id: z.string().min(1),
    object_type: z.string().min(1),
    object_id: z.string().min(1),
    field_name: z.string().min(1).optional(),
    from_status: z.string().min(1).optional(),
    to_status: z.string().min(1),
    from_value: z.string().min(1).optional(),
    to_value: z.string().min(1).optional(),
    actor_type: actorTypeSchema.optional(),
    actor_id: z.string().min(1).optional(),
    reason: z.string().min(1).optional(),
    context: publicStatusHistoryContextSchema,
    created_at: isoDateTimeSchema,
  })
  .strict();
export type PublicStatusHistory = z.infer<typeof publicStatusHistorySchema>;

export const publicMetricsSchema = z.record(z.string(), publicScalarSchema).superRefine((metrics, ctx) => {
  Object.entries(metrics).forEach(([key, value]) => {
    if (isUnsafePublicEvidenceKey(key)) {
      ctx.addIssue({
        code: 'custom',
        path: [key],
        message: `Public metric key is unsafe: ${key}`,
      });
    }

    if (typeof value === 'string' && isLocalReferenceString(value)) {
      ctx.addIssue({
        code: 'custom',
        path: [key],
        message: `Public metric value is a local reference: ${key}`,
      });
    }
  });
});
export type PublicMetrics = z.infer<typeof publicMetricsSchema>;

const publicReleaseEvidenceObservationLinkSchema = z
  .object({
    object_type: z.enum(['release', 'work_item', 'execution_package', 'run_session', 'review_packet']),
    object_id: z.string().min(1),
    relationship: z.enum(['observed', 'affected', 'supports', 'blocks']),
  })
  .strict();

const publicReleaseEvidenceObservationSchema = z
  .object({
    source: z.enum(['human', 'script']),
    severity: z.enum(['info', 'warning', 'failure']),
    summary: z.string().min(1),
    observed_at: isoDateTimeSchema,
    actor_id: z.string().min(1).optional(),
    links: z.array(publicReleaseEvidenceObservationLinkSchema).optional(),
    metrics: publicMetricsSchema.optional(),
    notes: z.string().min(1).optional(),
  })
  .strict();

const publicReleaseEvidenceDeploymentSchema = z
  .object({
    environment: z.string().min(1),
    result: z.enum(['succeeded', 'failed', 'cancelled', 'in_progress']),
    deployment_id: z.string().min(1).optional(),
    target: z.string().min(1).optional(),
    version: z.string().min(1).optional(),
    started_at: isoDateTimeSchema.optional(),
    completed_at: isoDateTimeSchema.optional(),
    actor_id: z.string().min(1).optional(),
    notes: z.string().min(1).optional(),
  })
  .strict();

const publicReleaseEvidenceRollbackSchema = z
  .object({
    result: z.enum(['succeeded', 'failed', 'cancelled', 'not_required']),
    reason: z.string().min(1).optional(),
    rollback_id: z.string().min(1).optional(),
    target: z.string().min(1).optional(),
    started_at: isoDateTimeSchema.optional(),
    completed_at: isoDateTimeSchema.optional(),
    actor_id: z.string().min(1).optional(),
    notes: z.string().min(1).optional(),
  })
  .strict();

const publicReleaseEvidenceBuildSchema = z
  .object({
    build_id: z.string().min(1).optional(),
    version: z.string().min(1).optional(),
    commit_sha: z.string().min(1).optional(),
    source_branch: z.string().min(1).optional(),
    result: z.enum(['succeeded', 'failed', 'cancelled', 'in_progress']).optional(),
    started_at: isoDateTimeSchema.optional(),
    completed_at: isoDateTimeSchema.optional(),
    artifact_id: z.string().min(1).optional(),
    artifact: publicArtifactRefSchema.optional(),
  })
  .strict();

const publicReleaseEvidenceCheckRefSchema = z
  .object({
    check_id: z.string().min(1),
    status: z.enum(['succeeded', 'failed', 'skipped']),
    summary: z.string().min(1).optional(),
    artifact_id: z.string().min(1).optional(),
    artifact: publicArtifactRefSchema.optional(),
  })
  .strict();

export const publicReleaseEvidenceExtraSchema = z
  .object({
    observation: publicReleaseEvidenceObservationSchema.optional(),
    deployment: publicReleaseEvidenceDeploymentSchema.optional(),
    rollback: publicReleaseEvidenceRollbackSchema.optional(),
    build: publicReleaseEvidenceBuildSchema.optional(),
    check_refs: z.array(publicReleaseEvidenceCheckRefSchema).optional(),
  })
  .strict();
export type PublicReleaseEvidenceExtra = z.infer<typeof publicReleaseEvidenceExtraSchema>;

export const publicReleaseEvidenceSchema = z
  .object({
    id: z.string().min(1),
    release_id: z.string().min(1),
    evidence_type: releaseEvidenceTypeSchema,
    summary: z.string().min(1),
    object_ref: releaseEvidenceObjectRefSchema.optional(),
    artifact_id: z.string().min(1).optional(),
    artifact: publicArtifactRefSchema.optional(),
    extra: publicReleaseEvidenceExtraSchema,
    redacted: z.boolean(),
    status: releaseEvidenceStatusSchema,
    created_at: isoDateTimeSchema,
    created_by_actor_id: z.string().min(1).optional(),
  })
  .strict();
export type PublicReleaseEvidence = z.infer<typeof publicReleaseEvidenceSchema>;

const publicReplayEntryBaseSchema = z.object({
  id: z.string().min(1),
  object_type: z.string().min(1),
  object_id: z.string().min(1),
  summary: z.string().min(1),
  created_at: isoDateTimeSchema,
});

export const publicReplayEntrySchema = z.discriminatedUnion('source', [
  publicReplayEntryBaseSchema
    .extend({
      source: z.literal('object_event'),
      payload: publicObjectEventSchema,
    })
    .strict(),
  publicReplayEntryBaseSchema
    .extend({
      source: z.literal('status_history'),
      payload: publicStatusHistorySchema,
    })
    .strict(),
  publicReplayEntryBaseSchema
    .extend({
      source: z.literal('decision'),
      payload: publicDecisionSchema,
    })
    .strict(),
  publicReplayEntryBaseSchema
    .extend({
      source: z.literal('artifact'),
      payload: publicArtifactRefSchema,
    })
    .strict(),
  publicReplayEntryBaseSchema
    .extend({
      source: z.literal('release_evidence'),
      payload: publicReleaseEvidenceSchema,
    })
    .strict(),
]);
export type PublicReplayEntry = z.infer<typeof publicReplayEntrySchema>;
