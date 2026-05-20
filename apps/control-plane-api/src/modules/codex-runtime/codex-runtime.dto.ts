import { z } from 'zod';

const scopeSchema = z.object({
  project_id: z.string().min(1),
  repo_id: z.string().min(1).optional(),
});

const actorSchema = z.object({
  actor_id: z.string().min(1),
}).passthrough();

const createdByFields = {
  created_by_actor_id: z.string().min(1).optional(),
  created_by: actorSchema.optional(),
};

const runtimeTargetKindSchema = z.enum(['generation', 'run_execution']);

const launchTargetSchema = z.object({
  target_type: z.enum(['generation_request', 'execution_package']),
  target_id: z.string().min(1),
  target_kind: runtimeTargetKindSchema,
  project_id: z.string().min(1),
  repo_id: z.string().min(1).optional(),
});

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
  }),
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
    codex_config_digest: z.string().min(1),
    expected_effective_config_digest: z.string().min(1),
    effective_config_assertions: z.record(z.string(), z.unknown()),
    app_server_required: z.boolean(),
    allowed_driver_kind: z.literal('app_server'),
    network_policy: z.record(z.string(), z.unknown()),
    resource_limits: z.record(z.string(), z.unknown()),
    docker_policy: z.record(z.string(), z.unknown()),
    allowed_scopes: z.array(scopeSchema),
    profile_digest: z.string().min(1),
    created_by_actor_id: z.string().min(1),
    created_at: z.string().min(1),
  }),
  ...createdByFields,
});

export const createCodexCredentialSchema = z.object({
  binding: z.object({
    id: z.string().min(1),
    profile_id: z.string().min(1),
    project_id: z.string().min(1),
    repo_id: z.string().min(1).optional(),
    provider: z.string().min(1),
    purpose: z.enum(['model_provider', 'package_registry', 'git_remote', 'other']),
    active_version_id: z.string().min(1),
    created_by_actor_id: z.string().min(1),
    created_at: z.string().min(1),
    updated_at: z.string().min(1),
  }),
  version: z.object({
    id: z.string().min(1),
    binding_id: z.string().min(1),
    version_number: z.number().int().positive(),
    status: z.enum(['active', 'superseded', 'revoked']),
    payload_digest: z.string().min(1),
    created_by_actor_id: z.string().min(1),
    created_at: z.string().min(1),
  }),
  secret_payload_json: z.unknown(),
  ...createdByFields,
});

export const createCodexWorkerBootstrapTokenSchema = z.object({
  id: z.string().min(1),
  worker_identity: z.string().min(1),
  bootstrap_token_hash: z.string().min(1),
  bootstrap_token_version: z.number().int().positive(),
  status: z.enum(['active', 'revoked', 'consumed']).optional(),
  allowed_scopes_json: z.array(scopeSchema),
  allowed_capabilities_json: z.record(z.string(), z.unknown()),
  created_by_actor_id: z.string().min(1),
  created_at: z.string().min(1).optional(),
  expires_at: z.string().min(1),
  revoked_at: z.string().min(1).optional(),
  created_by: actorSchema.optional(),
});

export const codexRuntimeStatusQuerySchema = z.object({
  project_id: z.string().min(1),
  repo_id: z.string().min(1).optional(),
  target_kind: runtimeTargetKindSchema,
  runtime_profile_id: z.string().min(1).optional(),
  credential_binding_id: z.string().min(1).optional(),
});

export const recoverStaleCodexWorkersSchema = z.object({
  stale_before: z.string().min(1),
  now: z.string().min(1).optional(),
  worker_id: z.string().min(1).optional(),
  reason_code: z.string().min(1),
});

export const registerCodexWorkerSchema = z.object({
  worker_id: z.string().min(1),
  worker_identity: z.string().min(1),
  version: z.string().min(1),
  bootstrap_token: z.string().min(1),
  bootstrap_token_version: z.number().int().positive(),
  session_token: z.string().min(1),
  status: z.enum(['registered', 'active', 'draining', 'offline', 'online', 'disabled']),
  control_channel_status: z.enum(['not_connected', 'connected', 'stale', 'local', 'disconnected', 'draining']),
  allowed_scopes: z.array(scopeSchema),
  capabilities: z.array(runtimeTargetKindSchema),
  docker_image_digests: z.array(z.string().min(1)),
  network_policy_digests: z.array(z.string().min(1)),
  network_provider_config_digests: z.array(z.string().min(1)).optional(),
  host_worker_uid: z.number().int().nonnegative(),
  host_worker_gid: z.number().int().nonnegative(),
  lease_count: z.number().int().nonnegative(),
  max_concurrency: z.number().int().positive(),
  labels: z.record(z.string(), z.unknown()).optional(),
  session_public_key_id: z.string().min(1),
  session_public_key_algorithm: z.literal('x25519'),
  session_public_key_material: z.string().min(1),
  session_public_key_expires_at: z.string().min(1),
});

export const heartbeatCodexWorkerSchema = z.object({
  session_token: z.string().min(1),
  nonce: z.string().min(1),
  nonce_timestamp: z.string().min(1),
  status: z.enum(['registered', 'active', 'draining', 'offline', 'online', 'disabled']),
  control_channel_status: z.enum(['not_connected', 'connected', 'stale', 'local', 'disconnected', 'draining']),
  active_lease_count: z.number().int().nonnegative(),
  capabilities: z.array(runtimeTargetKindSchema),
});

export const createCodexLaunchLeaseSchema = z.object({
  id: z.string().min(1),
  lease_request_id: z.string().min(1),
  target: launchTargetSchema,
  worker_id: z.string().min(1),
  runtime_profile_revision_id: z.string().min(1),
  credential_binding_id: z.string().min(1),
  credential_binding_version_id: z.string().min(1),
  credential_payload_digest: z.string().min(1),
  launch_token: z.string().min(1),
  action_type: z.string().min(1).optional(),
  action_attempt: z.number().int().nonnegative().optional(),
  action_claim_token: z.string().min(1).optional(),
  precondition_fingerprint: z.string().min(1).optional(),
  execution_package_id: z.string().min(1).optional(),
  run_session_id: z.string().min(1).optional(),
  run_worker_lease_id: z.string().min(1).optional(),
  run_worker_lease_token: z.string().min(1).optional(),
  run_session_status: z.string().min(1).optional(),
  run_session_updated_at: z.string().min(1).optional(),
  execution_package_version: z.number().int().nonnegative().optional(),
  expires_at: z.string().min(1),
});

export const revokeCodexLaunchLeaseSchema = z.object({
  reason_code: z.string().min(1),
  idempotency_key: z.string().min(1),
});

export const materializeCodexLaunchLeaseSchema = z.object({
  launch_token: z.string().min(1),
  worker_session_token: z.string().min(1),
  nonce: z.string().min(1),
  nonce_timestamp: z.string().min(1),
  materialization_request_hash: z.string().min(1),
});

export const terminalizeCodexLaunchLeaseSchema = z.object({
  worker_session_token: z.string().min(1),
  nonce: z.string().min(1),
  nonce_timestamp: z.string().min(1),
  terminal_status: z.enum(['released', 'expired']),
  reason_code: z.string().min(1),
  evidence_summary: z.record(z.string(), z.unknown()).optional(),
  runtime_job_id: z.string().min(1).optional(),
  idempotency_key: z.string().min(1),
});

export type CreateCodexRuntimeProfileDto = z.infer<typeof createCodexRuntimeProfileSchema>;
export type CreateCodexCredentialDto = z.infer<typeof createCodexCredentialSchema>;
export type CreateCodexWorkerBootstrapTokenDto = z.infer<typeof createCodexWorkerBootstrapTokenSchema>;
export type CodexRuntimeStatusQuery = z.infer<typeof codexRuntimeStatusQuerySchema>;
export type RecoverStaleCodexWorkersDto = z.infer<typeof recoverStaleCodexWorkersSchema>;
export type RegisterCodexWorkerDto = z.infer<typeof registerCodexWorkerSchema>;
export type HeartbeatCodexWorkerDto = z.infer<typeof heartbeatCodexWorkerSchema>;
export type CreateCodexLaunchLeaseDto = z.infer<typeof createCodexLaunchLeaseSchema>;
export type RevokeCodexLaunchLeaseDto = z.infer<typeof revokeCodexLaunchLeaseSchema>;
export type MaterializeCodexLaunchLeaseDto = z.infer<typeof materializeCodexLaunchLeaseSchema>;
export type TerminalizeCodexLaunchLeaseDto = z.infer<typeof terminalizeCodexLaunchLeaseSchema>;
