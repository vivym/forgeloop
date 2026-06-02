import { z } from 'zod';

import { codexRuntimeRecoveryReasonCodes } from '@forgeloop/domain';

const sha256DigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);

const scopeSchema = z.object({
  project_id: z.string().min(1),
  repo_id: z.string().min(1).optional(),
}).strict();

const actorSchema = z.object({
  actor_id: z.string().min(1),
}).strict();
const localCodexImportSourceLabelSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)
  .refine((value) => {
    const normalized = value.toLowerCase();
    return !normalized.includes('config.toml') && !normalized.includes('auth.json');
  });

const createdByFields = {
  created_by_actor_id: z.string().min(1).optional(),
  created_by: actorSchema.optional(),
  setup_nonce: z.string().min(1).optional(),
};

const runtimeTargetKindSchema = z.enum(['generation', 'run_execution']);
const runSessionFenceStatusSchema = z.enum(['queued', 'running', 'resuming']);
const terminalRuntimeJobStatusSchema = z.enum(['succeeded', 'failed', 'cancelled', 'expired']);

const launchTargetSchema = z.object({
  target_type: z.enum(['automation_action_run', 'run_session']),
  target_id: z.string().min(1),
  target_kind: runtimeTargetKindSchema,
  project_id: z.string().min(1),
  repo_id: z.string().min(1).optional(),
}).strict();

const allowlistRuleSchema = z.object({
  id: z.string().min(1),
  protocol: z.enum(['https', 'http', 'tcp']),
  host: z.string().min(1),
  port: z.number().int().positive().optional(),
  path_prefix: z.string().min(1).optional(),
  purpose: z.enum(['model_provider', 'package_registry', 'git_remote', 'other']),
}).strict();

const dockerNetworkProxyConfigSchema = z.object({
  proxy_image: z.string().min(1),
  proxy_image_digest: sha256DigestSchema,
  self_test_image: z.string().min(1),
  self_test_image_digest: sha256DigestSchema,
  provider_config_digest: sha256DigestSchema,
}).strict();

const networkPolicySchema = z.union([
  z.object({ mode: z.literal('disabled') }).strict(),
  z.object({
    mode: z.literal('egress_allowlist'),
    provider: z.literal('host_firewall'),
    allowlist_rules: z.array(allowlistRuleSchema).min(1),
    egress_allowlist_digest: sha256DigestSchema,
    self_test_digest: sha256DigestSchema,
  }).strict(),
  z.object({
    mode: z.literal('egress_allowlist'),
    provider: z.literal('docker_network_proxy'),
    allowlist_rules: z.array(allowlistRuleSchema).min(1),
    provider_config: dockerNetworkProxyConfigSchema,
    egress_allowlist_digest: sha256DigestSchema,
    self_test_digest: sha256DigestSchema,
  }).strict(),
]);

const resourceLimitsSchema = z.object({
  cpu_ms: z.number().int().positive(),
  memory_mb: z.number().int().positive(),
  pids: z.number().int().positive(),
  fds: z.number().int().positive(),
  workspace_bytes: z.number().int().nonnegative(),
  artifact_bytes: z.number().int().nonnegative(),
  timeout_ms: z.number().int().positive(),
  output_limit_bytes: z.number().int().positive(),
  run_output_limit_bytes: z.number().int().positive(),
}).strict();

const dockerPolicySchema = z.object({
  network_disabled: z.boolean().optional(),
  app_server_only: z.boolean(),
  rootless: z.boolean(),
  read_only_rootfs: z.boolean(),
  no_new_privileges: z.boolean(),
  drop_capabilities: z.array(z.string().min(1)),
}).strict();

const effectiveConfigAssertionsSchema = z.union([
  z.object({
    target_kind: z.literal('generation'),
    approval_policy: z.literal('never'),
    source_write_policy: z.literal('artifact_only'),
    forbidden_writable_roots: z.tuple([z.literal('workspace')]),
  }).strict(),
  z.object({
    target_kind: z.literal('run_execution'),
    approval_policy: z.literal('never'),
    sandbox_type: z.enum(['danger-full-access', 'dangerFullAccess']),
    writable_roots_policy: z.literal('task_workspace_only'),
  }).strict(),
]);

const allowedCapabilitiesSchema = z.object({
  target_kinds: z.array(runtimeTargetKindSchema),
  docker_image_digests: z.array(sha256DigestSchema),
  network_policy_digests: z.array(sha256DigestSchema),
  network_provider_config_digests: z.array(sha256DigestSchema).optional(),
}).strict();

export const createCodexRuntimeProfileSchema = z.object({
  profile: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    environment: z.enum(['local_dogfood', 'test']),
    target_kind: runtimeTargetKindSchema,
    active_revision_id: z.string().min(1),
    created_by_actor_id: z.string().min(1),
    created_at: z.string().min(1),
    updated_at: z.string().min(1),
  }).strict(),
  revision: z.object({
    id: z.string().min(1),
    profile_id: z.string().min(1),
    revision_number: z.number().int().positive(),
    status: z.enum(['active', 'superseded']),
    environment: z.enum(['local_dogfood', 'test']),
    docker_image: z.string().min(1),
    docker_image_digest: z.string().min(1),
    target_kind: runtimeTargetKindSchema,
    source_access_mode: z.enum(['artifact_only', 'path_policy_scoped']),
    codex_config_toml: z.string(),
    codex_config_digest: sha256DigestSchema,
    expected_effective_config_digest: sha256DigestSchema,
    effective_config_assertions: effectiveConfigAssertionsSchema,
    app_server_required: z.boolean(),
    allowed_driver_kind: z.literal('app_server'),
    network_policy: networkPolicySchema,
    resource_limits: resourceLimitsSchema,
    docker_policy: dockerPolicySchema,
    allowed_scopes: z.array(scopeSchema),
    profile_digest: sha256DigestSchema,
    created_by_actor_id: z.string().min(1),
    created_at: z.string().min(1),
  }).strict(),
  ...createdByFields,
}).strict();

export const createCodexCredentialSchema = z.object({
  binding: z.object({
    id: z.string().min(1),
    profile_id: z.string().min(1),
    project_id: z.string().min(1),
    repo_id: z.string().min(1).optional(),
    provider: z.literal('unsafe_db'),
    purpose: z.enum(['model_provider', 'package_registry', 'git_remote', 'other']),
    active_version_id: z.string().min(1),
    created_by_actor_id: z.string().min(1),
    created_at: z.string().min(1),
    updated_at: z.string().min(1),
  }).strict(),
  version: z.object({
    id: z.string().min(1),
    binding_id: z.string().min(1),
    version_number: z.number().int().positive(),
    status: z.enum(['active', 'superseded', 'revoked']),
    payload_digest: sha256DigestSchema,
    created_by_actor_id: z.string().min(1),
    created_at: z.string().min(1),
  }).strict(),
  secret_payload_json: z.unknown(),
  unsafe_db_acknowledgement: z.literal(true),
  ...createdByFields,
}).strict();

export const importCodexRuntimeProfileSchema = z
  .object({
    profile_name: z.string().min(1),
    target_kind: runtimeTargetKindSchema,
    codex_config_toml: z.string().min(1),
    project_id: z.string().min(1),
    repo_id: z.string().min(1).optional(),
    docker_image: z.string().min(1),
    docker_image_digest: sha256DigestSchema,
    expected_effective_config_digest: sha256DigestSchema,
    allowed_scopes: z.array(scopeSchema).min(1),
    network_policy: networkPolicySchema,
    created_by: actorSchema,
    setup_nonce: z.string().min(1).optional(),
  })
  .strict();

export const importCodexCredentialSchema = z
  .object({
    profile_id: z.string().min(1),
    project_id: z.string().min(1),
    repo_id: z.string().min(1).optional(),
    purpose: z.enum(['model_provider', 'package_registry', 'git_remote', 'other']),
    auth_json: z.unknown(),
    provider: z.literal('unsafe_db'),
    unsafe_db_acknowledgement: z.literal(true),
    created_by: actorSchema,
    setup_nonce: z.string().min(1).optional(),
  })
  .strict();

export const importLocalCodexSchema = z
  .object({
    profile_name: z.string().min(1),
    target_kind: runtimeTargetKindSchema,
    local_source_label: localCodexImportSourceLabelSchema,
    codex_config_toml: z.string().min(1),
    auth_json: z.unknown(),
    project_id: z.string().min(1),
    repo_id: z.string().min(1).optional(),
    docker_image: z.string().min(1),
    docker_image_digest: sha256DigestSchema,
    expected_effective_config_digest: sha256DigestSchema,
    allowed_scopes: z.array(scopeSchema).min(1),
    network_policy: networkPolicySchema,
    provider: z.literal('unsafe_db'),
    unsafe_db_acknowledgement: z.literal(true),
    created_by: actorSchema,
    setup_nonce: z.string().min(1).optional(),
  })
  .strict();

export const createCodexWorkerBootstrapTokenSchema = z.object({
  id: z.string().min(1),
  worker_identity: z.string().min(1),
  bootstrap_token_hash: sha256DigestSchema,
  bootstrap_token_version: z.number().int().positive(),
  status: z.enum(['active', 'revoked', 'consumed']).optional(),
  allowed_scopes_json: z.array(scopeSchema),
  allowed_capabilities_json: allowedCapabilitiesSchema,
  created_by_actor_id: z.string().min(1),
  created_at: z.string().min(1).optional(),
  expires_at: z.string().min(1),
  revoked_at: z.string().min(1).optional(),
  created_by: actorSchema.optional(),
  setup_nonce: z.string().min(1).optional(),
}).strict();

export const codexRuntimeStatusQuerySchema = z.object({
  project_id: z.string().min(1),
  repo_id: z.string().min(1).optional(),
  target_kind: runtimeTargetKindSchema,
  runtime_profile_id: z.string().min(1).optional(),
  credential_binding_id: z.string().min(1).optional(),
}).strict();

export const recoverStaleCodexWorkersSchema = z.object({
  stale_before: z.string().min(1),
  now: z.string().min(1).optional(),
  worker_id: z.string().min(1).optional(),
  reason_code: z.string().min(1),
}).strict();

export const registerCodexWorkerSchema = z.object({
  worker_id: z.string().min(1),
  worker_identity: z.string().min(1),
  version: z.string().min(1),
  bootstrap_token: z.string().min(1),
  bootstrap_token_version: z.number().int().positive(),
  status: z.enum(['online', 'offline', 'draining', 'disabled']),
  control_channel_status: z.enum(['connected', 'disconnected']),
  allowed_scopes: z.array(scopeSchema),
  capabilities: z.array(runtimeTargetKindSchema),
  docker_image_digests: z.array(sha256DigestSchema),
  network_policy_digests: z.array(sha256DigestSchema),
  network_provider_config_digests: z.array(sha256DigestSchema).optional(),
  host_worker_uid: z.number().int().nonnegative(),
  host_worker_gid: z.number().int().nonnegative(),
  lease_count: z.number().int().nonnegative(),
  max_concurrency: z.number().int().positive(),
  labels: z.record(z.string(), z.unknown()).optional(),
  session_public_key_id: z.string().min(1),
  session_public_key_algorithm: z.literal('x25519'),
  session_public_key_material: z.string().min(1),
  session_public_key_expires_at: z.string().min(1),
}).strict();

export const heartbeatCodexWorkerSchema = z.object({
  session_token: z.string().min(1),
  nonce: z.string().min(1),
  nonce_timestamp: z.string().min(1),
  status: z.enum(['online', 'offline', 'draining', 'disabled']),
  control_channel_status: z.enum(['connected', 'disconnected']),
  active_lease_count: z.number().int().nonnegative(),
  capabilities: z.array(runtimeTargetKindSchema),
  codex_session_runners: z.array(z.object({
    session_id: z.string().min(1),
    runner_launch_lease_id: z.string().min(1),
    runner_runtime_job_id: z.string().min(1),
    runner_expires_at: z.string().min(1),
  }).strict()).optional(),
}).strict();

const workerSessionRequestSchema = z.object({
  worker_session_token: z.string().min(1),
  nonce: z.string().min(1),
  nonce_timestamp: z.string().min(1),
  body_digest: sha256DigestSchema,
}).strict();

const runtimeJobInputSchema = z.record(z.string(), z.unknown());
const workspaceBundleAcquisitionSchema = z.object({
  schema_version: z.literal('workspace_bundle_acquisition.v1'),
  bundle_id: z.string().min(1),
  archive_ref: z.string().min(1),
  archive_digest: sha256DigestSchema,
  manifest_digest: sha256DigestSchema,
  size_bytes: z.number().int().positive(),
  expires_at: z.string().min(1),
}).strict();
const pendingWorkspaceBundleSchema = z.object({
  id: z.string().min(1),
  bundle_id: z.string().min(1),
  run_session_id: z.string().min(1),
  execution_package_id: z.string().min(1),
  pending_artifact_ref: z.string().min(1),
  internal_artifact_object_id: z.string().min(1).optional(),
  archive_digest: sha256DigestSchema,
  manifest_digest: sha256DigestSchema,
  run_worker_lease_id: z.string().min(1),
  size_bytes: z.number().int().positive(),
  workspace_acquisition_digest: sha256DigestSchema,
  workspace_acquisition_json: workspaceBundleAcquisitionSchema,
  expires_at: z.string().min(1),
  request_digest: sha256DigestSchema,
  created_at: z.string().min(1),
}).strict();

export const createCodexRuntimeJobSchema = z.object({
  runtime_job_id: z.string().min(1),
  launch_lease_id: z.string().min(1),
  envelope_id: z.string().min(1),
  job_request_id: z.string().min(1),
  target: launchTargetSchema,
  runtime_profile_revision_id: z.string().min(1),
  credential_binding_id: z.string().min(1),
  credential_binding_version_id: z.string().min(1),
  credential_payload_digest: sha256DigestSchema,
  input_json: runtimeJobInputSchema,
  workspace_acquisition_json: runtimeJobInputSchema.optional(),
  pending_workspace_bundle: pendingWorkspaceBundleSchema.optional(),
  launch_attempt: z.number().int().nonnegative(),
  action_type: z.string().min(1).optional(),
  action_attempt: z.number().int().nonnegative().optional(),
  action_claim_token: z.string().min(1).optional(),
  precondition_fingerprint: z.string().min(1).optional(),
  execution_package_id: z.string().min(1).optional(),
  run_session_id: z.string().min(1).optional(),
  run_worker_lease_id: z.string().min(1).optional(),
  run_worker_lease_token: z.string().min(1).optional(),
  run_session_status: runSessionFenceStatusSchema.optional(),
  run_session_updated_at: z.string().min(1).optional(),
  execution_package_version: z.number().int().nonnegative().optional(),
  expires_at: z.string().min(1),
}).strict().superRefine((value, context) => {
  if (value.target.target_kind !== 'run_execution') {
    return;
  }
  const requiredFields = [
    'execution_package_id',
    'run_session_id',
    'run_worker_lease_id',
    'run_worker_lease_token',
    'run_session_status',
    'run_session_updated_at',
    'execution_package_version',
  ] as const;
  for (const field of requiredFields) {
    if (value[field] === undefined) {
      context.addIssue({
        code: 'custom',
        path: [field],
        message: `${field} is required for run_execution runtime jobs`,
      });
    }
  }
  if (value.workspace_acquisition_json === undefined) {
    context.addIssue({
      code: 'custom',
      path: ['workspace_acquisition_json'],
      message: 'workspace_acquisition_json is required for run_execution runtime jobs',
    });
    return;
  }
  const workspaceBundleAcquisition = workspaceBundleAcquisitionSchema.safeParse(value.workspace_acquisition_json);
  if (!workspaceBundleAcquisition.success) {
    context.addIssue({
      code: 'custom',
      path: ['workspace_acquisition_json'],
      message: 'workspace_acquisition_json must be a strict workspace_bundle_acquisition.v1 object',
    });
  }
});

export const cancelCodexRuntimeJobSchema = z.object({
  reason_code: z.string().min(1),
  idempotency_key: z.string().min(1),
}).strict();

export const recoverStaleCodexRuntimeJobsSchema = z.object({
  stale_before: z.string().min(1),
  now: z.string().min(1).optional(),
  worker_id: z.string().min(1).optional(),
  reason_code: z.enum(codexRuntimeRecoveryReasonCodes),
}).strict();

export const renewAutomationActionRunClaimSchema = z.object({
  claim_token: z.string().min(1),
  locked_until: z.string().min(1),
  now: z.string().min(1).optional(),
}).strict();

export const refreshCodexWorkerSessionSchema = workerSessionRequestSchema.extend({
  next_session_public_key_id: z.string().min(1),
  next_session_public_key_algorithm: z.literal('x25519'),
  next_session_public_key_material: z.string().min(1),
  next_session_public_key_expires_at: z.string().min(1),
  refresh_idempotency_key: z.string().min(1),
});

export const pollCodexRuntimeJobsSchema = workerSessionRequestSchema.extend({
  target_kinds: z.array(runtimeTargetKindSchema).optional(),
  limit: z.number().int().positive().max(50),
  current_runtime_job_ids: z.array(z.string().min(1)).optional(),
});

export const acceptCodexRuntimeJobSchema = workerSessionRequestSchema.extend({
  accept_idempotency_key: z.string().min(1),
  accepted_worker_session_digest: sha256DigestSchema,
  accepted_session_public_key_id: z.string().min(1),
  accepted_session_epoch: z.number().int().positive(),
});

export const claimCodexRuntimeJobEnvelopeSchema = workerSessionRequestSchema.extend({
  envelope_id: z.string().min(1),
  claim_request_id: z.string().min(1),
  accepted_worker_session_digest: sha256DigestSchema,
  accepted_session_public_key_id: z.string().min(1),
  accepted_session_epoch: z.number().int().positive(),
});

export const codexRuntimeWorkerQuerySchema = workerSessionRequestSchema;

export const materializeCodexRuntimeJobSchema = workerSessionRequestSchema.extend({
  launch_lease_id: z.string().min(1),
  launch_token: z.string().min(1),
  materialization_request_id: z.string().min(1),
  accepted_worker_session_digest: sha256DigestSchema,
  accepted_session_public_key_id: z.string().min(1),
  accepted_session_epoch: z.number().int().positive(),
});

export const startCodexRuntimeJobSchema = workerSessionRequestSchema.extend({
  start_idempotency_key: z.string().min(1),
  runtime_evidence_digest: sha256DigestSchema,
  launch_materialization_digest: sha256DigestSchema,
});

export const markCodexSessionRunnerOwnerSchema = workerSessionRequestSchema.extend({
  session_id: z.string().min(1),
  runner_launch_lease_id: z.string().min(1),
  runner_runtime_job_id: z.string().min(1),
  runner_expires_at: z.string().min(1),
});

export const attachCodexSessionRunnerRuntimeJobSchema = workerSessionRequestSchema.extend({
  session_id: z.string().min(1),
  runner_launch_lease_id: z.string().min(1),
  runner_runtime_job_id: z.string().min(1),
  runner_expires_at: z.string().min(1),
  runtime_evidence_digest: sha256DigestSchema,
  launch_materialization_digest: sha256DigestSchema,
  attach_idempotency_key: z.string().min(1),
});

export const appendCodexRuntimeJobEventSchema = workerSessionRequestSchema.extend({
  event_id: z.string().min(1),
  event_idempotency_key: z.string().min(1),
  event_type: z.string().min(1),
  event_payload_json: runtimeJobInputSchema,
  event_payload_digest: sha256DigestSchema,
});

export const createCodexRuntimeJobArtifactUploadMetadataSchema = workerSessionRequestSchema.extend({
  schema_version: z.literal('codex_runtime_job_artifact_upload.v2'),
  artifact_idempotency_key: z.string().min(1),
  kind: z.string().min(1),
  name: z.string().min(1),
  content_type: z.string().min(1),
  digest: sha256DigestSchema,
  size_bytes: z.string().regex(/^\d+$/),
  metadata_json: z.record(z.string(), z.unknown()).default({}),
}).strict();

export const terminalizeCodexRuntimeJobSchema = workerSessionRequestSchema.extend({
  launch_lease_id: z.string().min(1),
  terminal_status: terminalRuntimeJobStatusSchema,
  reason_code: z.string().min(1),
  terminal_result_json: runtimeJobInputSchema.optional(),
  terminal_idempotency_key: z.string().min(1),
});

export const createCodexLaunchLeaseSchema = z.object({
  id: z.string().min(1),
  lease_request_id: z.string().min(1),
  target: launchTargetSchema,
  worker_id: z.string().min(1),
  runtime_profile_revision_id: z.string().min(1),
  credential_binding_id: z.string().min(1),
  credential_binding_version_id: z.string().min(1),
  credential_payload_digest: sha256DigestSchema,
  launch_token: z.string().min(1),
  launch_attempt: z.number().int().nonnegative(),
  action_type: z.string().min(1).optional(),
  action_attempt: z.number().int().nonnegative().optional(),
  action_claim_token: z.string().min(1).optional(),
  precondition_fingerprint: z.string().min(1).optional(),
  execution_package_id: z.string().min(1).optional(),
  run_session_id: z.string().min(1).optional(),
  run_worker_lease_id: z.string().min(1).optional(),
  run_worker_lease_token: z.string().min(1).optional(),
  run_session_status: runSessionFenceStatusSchema.optional(),
  run_session_updated_at: z.string().min(1).optional(),
  execution_package_version: z.number().int().nonnegative().optional(),
  expires_at: z.string().min(1),
}).strict().superRefine((value, context) => {
  if (value.target.target_kind !== 'run_execution') {
    return;
  }
  const requiredFields = [
    'execution_package_id',
    'run_session_id',
    'run_worker_lease_id',
    'run_worker_lease_token',
    'run_session_status',
    'run_session_updated_at',
    'execution_package_version',
  ] as const;
  for (const field of requiredFields) {
    if (value[field] === undefined) {
      context.addIssue({
        code: 'custom',
        path: [field],
        message: `${field} is required for run_execution launch leases`,
      });
    }
  }
});

export const revokeCodexLaunchLeaseSchema = z.object({
  reason_code: z.string().min(1),
  idempotency_key: z.string().min(1),
}).strict();

export const materializeCodexLaunchLeaseSchema = workerSessionRequestSchema.extend({
  launch_token: z.string().min(1),
  materialization_request_hash: sha256DigestSchema,
});

export const terminalizeCodexLaunchLeaseSchema = workerSessionRequestSchema.extend({
  terminal_status: z.literal('terminal'),
  reason_code: z.string().min(1),
  evidence_summary: z.record(z.string(), z.unknown()).optional(),
  runtime_job_id: z.string().min(1).optional(),
  idempotency_key: z.string().min(1),
});

export type CreateCodexRuntimeProfileDto = z.infer<typeof createCodexRuntimeProfileSchema>;
export type CreateCodexCredentialDto = z.infer<typeof createCodexCredentialSchema>;
export type ImportCodexRuntimeProfileDto = z.infer<typeof importCodexRuntimeProfileSchema>;
export type ImportCodexCredentialDto = z.infer<typeof importCodexCredentialSchema>;
export type ImportLocalCodexDto = z.infer<typeof importLocalCodexSchema>;
export type CreateCodexWorkerBootstrapTokenDto = z.infer<typeof createCodexWorkerBootstrapTokenSchema>;
export type CodexRuntimeStatusQuery = z.infer<typeof codexRuntimeStatusQuerySchema>;
export type RecoverStaleCodexWorkersDto = z.infer<typeof recoverStaleCodexWorkersSchema>;
export type RegisterCodexWorkerDto = z.infer<typeof registerCodexWorkerSchema>;
export type HeartbeatCodexWorkerDto = z.infer<typeof heartbeatCodexWorkerSchema>;
export type CreateCodexRuntimeJobDto = z.infer<typeof createCodexRuntimeJobSchema>;
export type CancelCodexRuntimeJobDto = z.infer<typeof cancelCodexRuntimeJobSchema>;
export type RecoverStaleCodexRuntimeJobsDto = z.infer<typeof recoverStaleCodexRuntimeJobsSchema>;
export type RenewAutomationActionRunClaimDto = z.infer<typeof renewAutomationActionRunClaimSchema>;
export type RefreshCodexWorkerSessionDto = z.infer<typeof refreshCodexWorkerSessionSchema>;
export type PollCodexRuntimeJobsDto = z.infer<typeof pollCodexRuntimeJobsSchema>;
export type AcceptCodexRuntimeJobDto = z.infer<typeof acceptCodexRuntimeJobSchema>;
export type ClaimCodexRuntimeJobEnvelopeDto = z.infer<typeof claimCodexRuntimeJobEnvelopeSchema>;
export type CodexRuntimeWorkerQueryDto = z.infer<typeof codexRuntimeWorkerQuerySchema>;
export type MaterializeCodexRuntimeJobDto = z.infer<typeof materializeCodexRuntimeJobSchema>;
export type StartCodexRuntimeJobDto = z.infer<typeof startCodexRuntimeJobSchema>;
export type MarkCodexSessionRunnerOwnerDto = z.infer<typeof markCodexSessionRunnerOwnerSchema>;
export type AttachCodexSessionRunnerRuntimeJobDto = z.infer<typeof attachCodexSessionRunnerRuntimeJobSchema>;
export type AppendCodexRuntimeJobEventDto = z.infer<typeof appendCodexRuntimeJobEventSchema>;
export type CreateCodexRuntimeJobArtifactUploadMetadataDto = z.infer<
  typeof createCodexRuntimeJobArtifactUploadMetadataSchema
>;
export type CreateCodexRuntimeJobArtifactDto = {
  proof_path: string;
  metadata: CreateCodexRuntimeJobArtifactUploadMetadataDto & { body_digest: string };
  bytes: Buffer;
};
export type TerminalizeCodexRuntimeJobDto = z.infer<typeof terminalizeCodexRuntimeJobSchema>;
export type CreateCodexLaunchLeaseDto = z.infer<typeof createCodexLaunchLeaseSchema>;
export type RevokeCodexLaunchLeaseDto = z.infer<typeof revokeCodexLaunchLeaseSchema>;
export type MaterializeCodexLaunchLeaseDto = z.infer<typeof materializeCodexLaunchLeaseSchema>;
export type TerminalizeCodexLaunchLeaseDto = z.infer<typeof terminalizeCodexLaunchLeaseSchema>;
