import { sql } from 'drizzle-orm';
import { boolean, index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import type {
  CodexCredentialBinding,
  CodexLaunchTokenEnvelope,
  CodexDockerPolicy,
  CodexEffectiveConfigAssertions,
  CodexRuntimeJob,
  CodexRuntimeNetworkPolicy,
  CodexRuntimeResourceLimits,
  CodexRuntimeScope,
  CodexRuntimeTargetKind,
} from '@forgeloop/domain';

import { timestampColumn } from './_shared';

export const codex_runtime_profiles = pgTable(
  'codex_runtime_profiles',
  {
    id: uuid('id').primaryKey(),
    name: text('name').notNull(),
    environment: text('environment').notNull(),
    targetKind: text('target_kind').$type<CodexRuntimeTargetKind>().notNull(),
    activeRevisionId: uuid('active_revision_id'),
    createdByActorId: uuid('created_by_actor_id').notNull(),
    createdAt: timestampColumn('created_at').notNull(),
    updatedAt: timestampColumn('updated_at').notNull(),
  },
  (table) => [index('codex_runtime_profiles_target_kind_idx').on(table.targetKind)],
);

export const codex_runtime_profile_revisions = pgTable(
  'codex_runtime_profile_revisions',
  {
    id: uuid('id').primaryKey(),
    profileId: uuid('profile_id')
      .notNull()
      .references(() => codex_runtime_profiles.id, { onDelete: 'cascade' }),
    revisionNumber: integer('revision_number').notNull(),
    status: text('status').notNull(),
    environment: text('environment').notNull(),
    dockerImage: text('docker_image').notNull(),
    dockerImageDigest: text('docker_image_digest').notNull(),
    targetKind: text('target_kind').$type<CodexRuntimeTargetKind>().notNull(),
    sourceAccessMode: text('source_access_mode').notNull(),
    codexConfigToml: text('codex_config_toml').notNull(),
    codexConfigDigest: text('codex_config_digest').notNull(),
    expectedEffectiveConfigDigest: text('expected_effective_config_digest').notNull(),
    effectiveConfigAssertions: jsonb('effective_config_assertions').$type<CodexEffectiveConfigAssertions>().notNull(),
    appServerRequired: boolean('app_server_required').notNull(),
    allowedDriverKind: text('allowed_driver_kind').notNull(),
    networkPolicy: jsonb('network_policy').$type<CodexRuntimeNetworkPolicy>().notNull(),
    resourceLimits: jsonb('resource_limits').$type<CodexRuntimeResourceLimits>().notNull(),
    dockerPolicy: jsonb('docker_policy').$type<CodexDockerPolicy>().notNull(),
    allowedScopes: jsonb('allowed_scopes').$type<readonly CodexRuntimeScope[]>().notNull(),
    profileDigest: text('profile_digest').notNull(),
    createdByActorId: uuid('created_by_actor_id').notNull(),
    createdAt: timestampColumn('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('codex_runtime_profile_revisions_profile_revision_idx').on(table.profileId, table.revisionNumber),
    index('codex_runtime_profile_revisions_active_lookup_idx').on(table.targetKind, table.status),
  ],
);

export const codex_credential_bindings = pgTable(
  'codex_credential_bindings',
  {
    id: uuid('id').primaryKey(),
    profileId: uuid('profile_id')
      .notNull()
      .references(() => codex_runtime_profiles.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').notNull(),
    repoId: text('repo_id'),
    provider: text('provider').notNull(),
    purpose: text('purpose').$type<CodexCredentialBinding['purpose']>().notNull(),
    activeVersionId: uuid('active_version_id'),
    createdByActorId: uuid('created_by_actor_id').notNull(),
    createdAt: timestampColumn('created_at').notNull(),
    updatedAt: timestampColumn('updated_at').notNull(),
  },
  (table) => [index('codex_credential_bindings_scope_idx').on(table.projectId, table.repoId, table.profileId)],
);

export const codex_credential_binding_versions = pgTable(
  'codex_credential_binding_versions',
  {
    id: uuid('id').primaryKey(),
    bindingId: uuid('binding_id')
      .notNull()
      .references(() => codex_credential_bindings.id, { onDelete: 'cascade' }),
    versionNumber: integer('version_number').notNull(),
    status: text('status').notNull(),
    payloadDigest: text('payload_digest').notNull(),
    secretPayloadJson: jsonb('secret_payload_json').notNull(),
    createdByActorId: uuid('created_by_actor_id').notNull(),
    createdAt: timestampColumn('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('codex_credential_binding_versions_binding_version_idx').on(table.bindingId, table.versionNumber),
    index('codex_credential_binding_versions_active_idx').on(table.bindingId, table.status),
  ],
);

export const codex_worker_bootstrap_tokens = pgTable(
  'codex_worker_bootstrap_tokens',
  {
    id: uuid('id').primaryKey(),
    workerIdentity: text('worker_identity').notNull(),
    bootstrapTokenHash: text('bootstrap_token_hash').notNull(),
    bootstrapTokenVersion: integer('bootstrap_token_version').notNull(),
    status: text('status').notNull(),
    allowedScopesJson: jsonb('allowed_scopes_json').$type<readonly CodexRuntimeScope[]>().notNull(),
    allowedCapabilitiesJson: jsonb('allowed_capabilities_json').$type<Record<string, unknown>>().notNull(),
    createdByActorId: uuid('created_by_actor_id').notNull(),
    createdAt: timestampColumn('created_at').notNull(),
    expiresAt: timestampColumn('expires_at').notNull(),
    consumedAt: timestampColumn('consumed_at'),
    revokedAt: timestampColumn('revoked_at'),
  },
  (table) => [
    uniqueIndex('codex_worker_bootstrap_tokens_hash_idx').on(table.bootstrapTokenHash, table.bootstrapTokenVersion),
    index('codex_worker_bootstrap_tokens_identity_idx').on(table.workerIdentity, table.status),
  ],
);

export const codex_worker_registrations = pgTable(
  'codex_worker_registrations',
  {
    id: uuid('id').primaryKey(),
    workerIdentity: text('worker_identity').notNull(),
    status: text('status').notNull(),
    version: text('version').notNull(),
    controlChannelStatus: text('control_channel_status').notNull(),
    sessionTokenHash: text('session_token_hash').notNull(),
    sessionTokenExpiresAt: timestampColumn('session_token_expires_at').notNull(),
    bootstrapTokenHash: text('bootstrap_token_hash').notNull(),
    bootstrapTokenVersion: integer('bootstrap_token_version').notNull(),
    allowedScopesJson: jsonb('allowed_scopes_json').$type<readonly CodexRuntimeScope[]>().notNull(),
    capabilitiesJson: jsonb('capabilities_json').$type<Record<string, unknown>>().notNull(),
    capabilityCeilingJson: jsonb('capability_ceiling_json').$type<Record<string, unknown>>().notNull(),
    hostWorkerUid: integer('host_worker_uid').notNull(),
    hostWorkerGid: integer('host_worker_gid').notNull(),
    leaseCount: integer('lease_count').notNull(),
    maxConcurrency: integer('max_concurrency').notNull(),
    labelsJson: jsonb('labels_json').$type<Record<string, unknown>>().notNull(),
    sessionPublicKeyId: text('session_public_key_id').notNull(),
    sessionPublicKeyAlgorithm: text('session_public_key_algorithm').notNull(),
    sessionPublicKeyMaterial: text('session_public_key_material').notNull(),
    sessionPublicKeyCreatedAt: timestampColumn('session_public_key_created_at').notNull(),
    sessionPublicKeyExpiresAt: timestampColumn('session_public_key_expires_at').notNull(),
    registeredAt: timestampColumn('registered_at').notNull(),
    lastHeartbeatAt: timestampColumn('last_heartbeat_at'),
  },
  (table) => [
    uniqueIndex('codex_worker_registrations_identity_idx').on(table.workerIdentity),
    index('codex_worker_registrations_availability_idx').on(table.status, table.controlChannelStatus),
  ],
);

export const codex_worker_session_nonces = pgTable(
  'codex_worker_session_nonces',
  {
    id: uuid('id').primaryKey(),
    workerId: uuid('worker_id')
      .notNull()
      .references(() => codex_worker_registrations.id, { onDelete: 'cascade' }),
    sessionTokenHash: text('session_token_hash').notNull(),
    nonceHash: text('nonce_hash').notNull(),
    nonceTimestamp: timestampColumn('nonce_timestamp').notNull(),
    createdAt: timestampColumn('created_at').notNull(),
  },
  (table) => [uniqueIndex('codex_worker_session_nonces_worker_session_nonce_idx').on(table.workerId, table.sessionTokenHash, table.nonceHash)],
);

export const codex_runtime_setup_nonces = pgTable(
  'codex_runtime_setup_nonces',
  {
    setupNonceHash: text('setup_nonce_hash').primaryKey(),
    requestSignatureHash: text('request_signature_hash').notNull(),
    actorId: text('actor_id').notNull(),
    actorClass: text('actor_class').notNull(),
    createdAt: timestampColumn('created_at').notNull(),
    expiresAt: timestampColumn('expires_at').notNull(),
  },
  (table) => [index('codex_runtime_setup_nonces_expires_at_idx').on(table.expiresAt)],
);

export const codex_launch_leases = pgTable(
  'codex_launch_leases',
  {
    id: uuid('id').primaryKey(),
    leaseRequestId: text('lease_request_id').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id').notNull(),
    targetKind: text('target_kind').$type<CodexRuntimeTargetKind>().notNull(),
    projectId: uuid('project_id').notNull(),
    repoId: text('repo_id'),
    launchAttempt: integer('launch_attempt').notNull(),
    actionType: text('action_type'),
    actionAttempt: integer('action_attempt'),
    actionClaimTokenHash: text('action_claim_token_hash'),
    preconditionFingerprint: text('precondition_fingerprint'),
    executionPackageId: uuid('execution_package_id'),
    runWorkerLeaseId: text('run_worker_lease_id'),
    runWorkerLeaseTokenHash: text('run_worker_lease_token_hash'),
    runSessionStatus: text('run_session_status'),
    runSessionUpdatedAt: timestampColumn('run_session_updated_at'),
    executionPackageVersion: integer('execution_package_version'),
    workerId: uuid('worker_id').references(() => codex_worker_registrations.id),
    status: text('status').notNull(),
    leaseTokenHash: text('lease_token_hash').notNull(),
    runtimeProfileRevisionId: uuid('runtime_profile_revision_id')
      .notNull()
      .references(() => codex_runtime_profile_revisions.id),
    runtimeProfileDigest: text('runtime_profile_digest').notNull(),
    credentialBindingId: uuid('credential_binding_id')
      .notNull()
      .references(() => codex_credential_bindings.id),
    credentialBindingVersionId: uuid('credential_binding_version_id')
      .notNull()
      .references(() => codex_credential_binding_versions.id),
    credentialPayloadDigest: text('credential_payload_digest').notNull(),
    dockerImageDigest: text('docker_image_digest').notNull(),
    networkPolicyDigest: text('network_policy_digest').notNull(),
    networkProviderConfigDigest: text('network_provider_config_digest'),
    materializationRequestHash: text('materialization_request_hash'),
    createdAt: timestampColumn('created_at').notNull(),
    expiresAt: timestampColumn('expires_at').notNull(),
    materializedAt: timestampColumn('materialized_at'),
    terminalizedAt: timestampColumn('terminalized_at'),
    terminalReasonCode: text('terminal_reason_code'),
    terminalEvidenceSummaryJson: jsonb('terminal_evidence_summary_json').$type<Record<string, unknown>>(),
    terminalRuntimeJobId: text('terminal_runtime_job_id'),
    terminalIdempotencyKey: text('terminal_idempotency_key'),
  },
  (table) => [
    uniqueIndex('codex_launch_leases_request_idx').on(table.leaseRequestId),
    uniqueIndex('codex_launch_leases_target_attempt_idx').on(
      table.projectId,
      sql`coalesce(${table.repoId}, '')`,
      table.targetType,
      table.targetId,
      table.launchAttempt,
    ),
    index('codex_launch_leases_worker_status_idx').on(table.workerId, table.status),
    index('codex_launch_leases_target_fence_idx').on(table.targetType, table.targetId, table.targetKind),
  ],
);

export const codex_runtime_jobs = pgTable(
  'codex_runtime_jobs',
  {
    id: uuid('id').primaryKey(),
    jobRequestId: text('job_request_id').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id').notNull(),
    targetKind: text('target_kind').$type<CodexRuntimeTargetKind>().notNull(),
    projectId: uuid('project_id').notNull(),
    repoId: text('repo_id'),
    workerId: uuid('worker_id')
      .notNull()
      .references(() => codex_worker_registrations.id),
    launchLeaseId: uuid('launch_lease_id')
      .notNull()
      .references(() => codex_launch_leases.id),
    launchAttempt: integer('launch_attempt').notNull(),
    status: text('status').$type<CodexRuntimeJob['status']>().notNull(),
    inputDigest: text('input_digest').notNull(),
    inputJson: jsonb('input_json').$type<Record<string, unknown>>().notNull(),
    workspaceAcquisitionDigest: text('workspace_acquisition_digest'),
    workspaceAcquisitionJson: jsonb('workspace_acquisition_json').$type<Record<string, unknown>>(),
    runtimeProfileRevisionId: uuid('runtime_profile_revision_id')
      .notNull()
      .references(() => codex_runtime_profile_revisions.id),
    runtimeProfileDigest: text('runtime_profile_digest').notNull(),
    credentialBindingId: uuid('credential_binding_id')
      .notNull()
      .references(() => codex_credential_bindings.id),
    credentialBindingVersionId: uuid('credential_binding_version_id')
      .notNull()
      .references(() => codex_credential_binding_versions.id),
    credentialPayloadDigest: text('credential_payload_digest').notNull(),
    dockerImageDigest: text('docker_image_digest').notNull(),
    networkPolicyDigest: text('network_policy_digest').notNull(),
    networkProviderConfigDigest: text('network_provider_config_digest'),
    envelopeDigest: text('envelope_digest').notNull(),
    acceptIdempotencyKey: text('accept_idempotency_key'),
    acceptRequestDigest: text('accept_request_digest'),
    acceptedAt: timestampColumn('accepted_at'),
    acceptedWorkerSessionDigest: text('accepted_worker_session_digest'),
    acceptedSessionPublicKeyId: text('accepted_session_public_key_id'),
    acceptedSessionEpoch: integer('accepted_session_epoch'),
    materializingAt: timestampColumn('materializing_at'),
    materializationRequestId: text('materialization_request_id'),
    materializationRequestDigest: text('materialization_request_digest'),
    startIdempotencyKey: text('start_idempotency_key'),
    startRequestDigest: text('start_request_digest'),
    startedAt: timestampColumn('started_at'),
    lastEventAt: timestampColumn('last_event_at'),
    cancelRequestedAt: timestampColumn('cancel_requested_at'),
    cancelIdempotencyKey: text('cancel_idempotency_key'),
    cancelRequestDigest: text('cancel_request_digest'),
    drainRequestedAt: timestampColumn('drain_requested_at'),
    terminalIdempotencyKey: text('terminal_idempotency_key'),
    terminalRequestDigest: text('terminal_request_digest'),
    terminalAt: timestampColumn('terminal_at'),
    terminalStatus: text('terminal_status'),
    terminalReasonCode: text('terminal_reason_code'),
    terminalResultJson: jsonb('terminal_result_json').$type<Record<string, unknown>>(),
    expiresAt: timestampColumn('expires_at').notNull(),
    createdAt: timestampColumn('created_at').notNull(),
    updatedAt: timestampColumn('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('codex_runtime_jobs_job_request_idx').on(table.jobRequestId),
    uniqueIndex('codex_runtime_jobs_target_attempt_idx').on(
      table.projectId,
      sql`coalesce(${table.repoId}, '')`,
      table.targetType,
      table.targetId,
      table.launchAttempt,
    ),
    index('codex_runtime_jobs_worker_status_idx').on(table.workerId, table.status),
    index('codex_runtime_jobs_recovery_idx').on(table.status, table.expiresAt, table.lastEventAt),
  ],
);

export const codex_launch_token_envelopes = pgTable(
  'codex_launch_token_envelopes',
  {
    id: uuid('id').primaryKey(),
    runtimeJobId: uuid('runtime_job_id')
      .notNull()
      .references(() => codex_runtime_jobs.id, { onDelete: 'cascade' }),
    launchLeaseId: uuid('launch_lease_id')
      .notNull()
      .references(() => codex_launch_leases.id),
    workerId: uuid('worker_id')
      .notNull()
      .references(() => codex_worker_registrations.id),
    keyId: text('key_id').notNull(),
    algorithm: text('algorithm').$type<CodexLaunchTokenEnvelope['algorithm']>().notNull(),
    ciphertext: text('ciphertext').notNull(),
    encryptionNonce: text('encryption_nonce').notNull(),
    aadJson: jsonb('aad_json').$type<Record<string, string>>().notNull(),
    aadDigest: text('aad_digest').notNull(),
    envelopeDigest: text('envelope_digest').notNull(),
    status: text('status').$type<CodexLaunchTokenEnvelope['status']>().notNull(),
    claimRequestId: text('claim_request_id'),
    claimRequestDigest: text('claim_request_digest'),
    claimedWorkerSessionDigest: text('claimed_worker_session_digest'),
    claimedKeyId: text('claimed_key_id'),
    claimedAt: timestampColumn('claimed_at'),
    expiresAt: timestampColumn('expires_at').notNull(),
    createdAt: timestampColumn('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('codex_launch_token_envelopes_runtime_job_idx').on(table.runtimeJobId),
    index('codex_launch_token_envelopes_worker_status_idx').on(table.workerId, table.status),
  ],
);

export const codex_runtime_job_artifacts = pgTable(
  'codex_runtime_job_artifacts',
  {
    id: uuid('id').primaryKey(),
    runtimeJobId: uuid('runtime_job_id')
      .notNull()
      .references(() => codex_runtime_jobs.id, { onDelete: 'cascade' }),
    artifactIdempotencyKey: text('artifact_idempotency_key').notNull(),
    kind: text('kind').notNull(),
    name: text('name').notNull(),
    contentType: text('content_type').notNull(),
    digest: text('digest').notNull(),
    internalRef: text('internal_ref').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    metadataJson: jsonb('metadata_json').$type<Record<string, unknown>>().notNull(),
    createdAt: timestampColumn('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('codex_runtime_job_artifacts_job_digest_idx').on(table.runtimeJobId, table.digest, table.contentType),
    uniqueIndex('codex_runtime_job_artifacts_idempotency_idx').on(table.runtimeJobId, table.artifactIdempotencyKey),
  ],
);

export const codex_pending_workspace_bundles = pgTable(
  'codex_pending_workspace_bundles',
  {
    id: uuid('id').primaryKey(),
    bundleId: text('bundle_id').notNull(),
    runtimeJobId: uuid('runtime_job_id').references(() => codex_runtime_jobs.id, { onDelete: 'set null' }),
    runWorkerLeaseId: text('run_worker_lease_id').notNull(),
    status: text('status').notNull(),
    pendingArtifactRef: text('pending_artifact_ref').notNull(),
    archiveDigest: text('archive_digest').notNull(),
    manifestDigest: text('manifest_digest').notNull(),
    workspaceAcquisitionDigest: text('workspace_acquisition_digest').notNull(),
    workspaceAcquisitionJson: jsonb('workspace_acquisition_json').$type<Record<string, unknown>>().notNull(),
    expiresAt: timestampColumn('expires_at').notNull(),
    createdAt: timestampColumn('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('codex_pending_workspace_bundles_bundle_idx').on(table.bundleId),
    index('codex_pending_workspace_bundles_run_worker_lease_idx').on(table.runWorkerLeaseId, table.status),
  ],
);
