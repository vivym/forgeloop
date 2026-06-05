import { z } from 'zod';
import { codexPublicBlockerCodes } from '@forgeloop/domain';

const nonEmpty = z.string().trim().min(1);

export const claimCodexSessionLeaseSchema = z
  .object({
    workflow_id: nonEmpty,
    lease_token: nonEmpty,
    worker_id: nonEmpty,
    worker_session_digest: nonEmpty,
    expected_input_capsule_digest: nonEmpty.nullable(),
    expires_at: z.string().datetime(),
  })
  .strict();

export const renewCodexSessionLeaseSchema = z
  .object({
    lease_token: nonEmpty,
    worker_id: nonEmpty,
    worker_session_digest: nonEmpty,
    lease_epoch: z.number().int().positive(),
    expires_at: z.string().datetime(),
  })
  .strict();

export const terminalizeCodexSessionTurnSchema = z
  .object({
    lease_id: nonEmpty,
    lease_token: nonEmpty,
    lease_epoch: z.number().int().positive(),
    worker_id: nonEmpty,
    worker_session_digest: nonEmpty,
    status: z.enum(['succeeded', 'failed', 'cancelled']),
    expected_input_capsule_digest: nonEmpty.nullable(),
    output_capsule_id: nonEmpty.optional(),
    output_capsule_sequence: z.number().int().positive().optional(),
    output_capsule_artifact_ref: nonEmpty.optional(),
    output_capsule_digest: nonEmpty.optional(),
    output_capsule_size_bytes: nonEmpty.optional(),
    output_capsule_manifest_digest: nonEmpty.optional(),
    output_capsule_thread_state_digest: nonEmpty.optional(),
    output_capsule_memory_state_digest: nonEmpty.optional(),
    output_capsule_environment_manifest_digest: nonEmpty.optional(),
    output_capsule_codex_thread_id_digest: nonEmpty.optional(),
    output_capsule_codex_cli_version: nonEmpty.optional(),
    output_capsule_app_server_protocol_digest: nonEmpty.optional(),
    runtime_profile_revision_id: nonEmpty.optional(),
    output_capsule_trusted_runtime_manifest_digest: nonEmpty.optional(),
    output_capsule_credential_binding_lineage_digest: nonEmpty.optional(),
    output_memory_bundle_ref: nonEmpty.optional(),
    output_memory_bundle_digest: nonEmpty.optional(),
    memory_delta_artifact_ref: nonEmpty.optional(),
    memory_delta_digest: nonEmpty.optional(),
    output_environment_manifest_ref: nonEmpty.optional(),
    output_environment_manifest_digest: nonEmpty.optional(),
    codex_thread_id: nonEmpty.optional(),
    codex_thread_id_digest: nonEmpty.optional(),
    failure_code: nonEmpty.optional(),
  })
  .strict()
  .superRefine((body, ctx) => {
    const hasThreadId = body.codex_thread_id !== undefined;
    const hasThreadDigest = body.codex_thread_id_digest !== undefined;
    if (hasThreadId !== hasThreadDigest) {
      ctx.addIssue({
        code: 'custom',
        path: hasThreadId ? ['codex_thread_id_digest'] : ['codex_thread_id'],
        message: 'codex_thread_id and codex_thread_id_digest must be provided together',
      });
    }
    if (body.failure_code !== undefined && !codexPublicBlockerCodes.includes(body.failure_code as (typeof codexPublicBlockerCodes)[number])) {
      ctx.addIssue({
        code: 'custom',
        path: ['failure_code'],
        message: 'failure_code must be a public Codex blocker code',
      });
    }
    const capsuleFields = [
      'output_capsule_id',
      'output_capsule_sequence',
      'output_capsule_artifact_ref',
      'output_capsule_digest',
      'output_capsule_size_bytes',
      'output_capsule_manifest_digest',
      'output_capsule_thread_state_digest',
      'output_capsule_memory_state_digest',
      'output_capsule_environment_manifest_digest',
      'output_capsule_codex_thread_id_digest',
      'output_capsule_codex_cli_version',
      'output_capsule_app_server_protocol_digest',
      'runtime_profile_revision_id',
      'output_capsule_trusted_runtime_manifest_digest',
      'output_capsule_credential_binding_lineage_digest',
    ] as const;
    const capsuleProvided = capsuleFields.some((field) => body[field] !== undefined);
    const continuationFields = [
      'output_memory_bundle_ref',
      'output_memory_bundle_digest',
      'output_environment_manifest_ref',
      'output_environment_manifest_digest',
    ] as const;
    const memoryDeltaFields = ['memory_delta_artifact_ref', 'memory_delta_digest'] as const;
    if (body.status !== 'succeeded') {
      for (const field of [...capsuleFields, ...continuationFields, ...memoryDeltaFields]) {
        if (body[field] !== undefined) {
          ctx.addIssue({ code: 'custom', path: [field], message: `${field} is only allowed for succeeded terminalization` });
        }
      }
      return;
    }
    if (!capsuleProvided) {
      for (const field of [...continuationFields, ...memoryDeltaFields]) {
        if (body[field] !== undefined) {
          ctx.addIssue({ code: 'custom', path: [field], message: `${field} requires output capsule fields` });
        }
      }
      return;
    }
    for (const field of capsuleFields) {
      if (body[field] === undefined) {
        ctx.addIssue({ code: 'custom', path: [field], message: `${field} is required when output capsule is provided` });
      }
    }
    for (const field of continuationFields) {
      if (body[field] === undefined) {
        ctx.addIssue({ code: 'custom', path: [field], message: `${field} is required when output capsule is provided` });
      }
    }
    const hasMemoryDeltaRef = body.memory_delta_artifact_ref !== undefined;
    const hasMemoryDeltaDigest = body.memory_delta_digest !== undefined;
    if (hasMemoryDeltaRef !== hasMemoryDeltaDigest) {
      ctx.addIssue({
        code: 'custom',
        path: hasMemoryDeltaRef ? ['memory_delta_digest'] : ['memory_delta_artifact_ref'],
        message: 'memory_delta_artifact_ref and memory_delta_digest must be provided together',
      });
    }
  });

export const createCodexRuntimeCapsuleSchema = z
  .object({
    capsule_id: nonEmpty,
    sequence: z.number().int().positive(),
    artifact_ref: nonEmpty,
    digest: nonEmpty,
    size_bytes: nonEmpty,
    manifest_digest: nonEmpty,
    thread_state_digest: nonEmpty,
    memory_state_digest: nonEmpty,
    environment_manifest_digest: nonEmpty,
    codex_thread_id_digest: nonEmpty,
    codex_cli_version: nonEmpty,
    app_server_protocol_digest: nonEmpty,
    runtime_profile_revision_id: nonEmpty,
    trusted_runtime_manifest_digest: nonEmpty,
    credential_binding_lineage_digest: nonEmpty,
    created_from_turn_id: nonEmpty,
    actor_id: nonEmpty,
  })
  .strict();

export type ClaimCodexSessionLeaseDto = z.infer<typeof claimCodexSessionLeaseSchema>;
export type RenewCodexSessionLeaseDto = z.infer<typeof renewCodexSessionLeaseSchema>;
export type TerminalizeCodexSessionTurnDto = z.infer<typeof terminalizeCodexSessionTurnSchema>;
export type CreateCodexRuntimeCapsuleDto = z.infer<typeof createCodexRuntimeCapsuleSchema>;
