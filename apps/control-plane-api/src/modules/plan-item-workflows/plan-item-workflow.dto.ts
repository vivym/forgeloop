import { z } from 'zod';
import {
  codexSessionPublicDtoSchema,
  planItemWorkflowPublicDtoSchema,
  planItemWorkflowStatusSchema,
  workflowManualDecisionKindSchema,
  workflowTransitionEvidenceObjectTypeSchema,
} from '@forgeloop/contracts';

const nonEmpty = z.string().trim().min(1);

export const startBrainstormingWorkflowSchema = z
  .object({
    actor_id: nonEmpty,
    runtime_profile_id: nonEmpty,
    runtime_profile_revision_id: nonEmpty,
    credential_binding_id: nonEmpty,
    credential_binding_version_id: nonEmpty,
    reason: nonEmpty,
  })
  .strict();
export type StartBrainstormingWorkflowDto = z.infer<typeof startBrainstormingWorkflowSchema>;

export const workflowTransitionCommandSchema = z
  .object({
    actor_id: nonEmpty,
    to_status: planItemWorkflowStatusSchema,
    evidence_object_type: workflowTransitionEvidenceObjectTypeSchema,
    evidence_object_id: nonEmpty,
    reason: nonEmpty.optional(),
    manual_decision_kind: workflowManualDecisionKindSchema.optional(),
    selected_codex_session_id: nonEmpty.optional(),
    codex_session_turn_id: nonEmpty.optional(),
    evidence_digest: nonEmpty.optional(),
    supporting_evidence: z
      .array(
        z
          .object({
            object_type: workflowTransitionEvidenceObjectTypeSchema,
            object_id: nonEmpty,
            digest: nonEmpty.optional(),
          })
          .strict(),
      )
      .optional(),
  })
  .strict();
export type WorkflowTransitionCommandDto = z.infer<typeof workflowTransitionCommandSchema>;

export const manualDecisionBodySchema = z
  .object({
    actor_id: nonEmpty,
    reason: nonEmpty,
  })
  .strict();

export const requestWorkflowChangesSchema = manualDecisionBodySchema
  .extend({
    rejected_revision_id: nonEmpty.optional(),
  })
  .strict();

export const approveImplementationPlanAndMarkExecutionReadySchema = z
  .object({
    actor_id: nonEmpty,
    approved_implementation_plan_revision_id: nonEmpty,
    reason: nonEmpty.optional(),
  })
  .strict();

export const claimCodexSessionLeaseSchema = z
  .object({
    workflow_id: nonEmpty,
    lease_token: nonEmpty,
    worker_id: nonEmpty,
    worker_session_digest: nonEmpty,
    expected_previous_snapshot_digest: nonEmpty.nullable(),
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
    expected_previous_snapshot_digest: nonEmpty.nullable(),
    output_snapshot_id: nonEmpty.optional(),
    output_snapshot_sequence: z.number().int().positive().optional(),
    output_snapshot_artifact_ref: nonEmpty.optional(),
    output_snapshot_digest: nonEmpty.optional(),
    output_snapshot_size_bytes: nonEmpty.optional(),
    output_snapshot_manifest_digest: nonEmpty.optional(),
    runtime_profile_revision_id: nonEmpty.optional(),
    codex_thread_id: nonEmpty.optional(),
    codex_thread_id_digest: nonEmpty.optional(),
    failure_code: nonEmpty.optional(),
  })
  .strict()
  .superRefine((body, ctx) => {
    const snapshotFields = [
      'output_snapshot_id',
      'output_snapshot_sequence',
      'output_snapshot_artifact_ref',
      'output_snapshot_digest',
      'output_snapshot_size_bytes',
      'output_snapshot_manifest_digest',
      'runtime_profile_revision_id',
    ] as const;
    const snapshotProvided = snapshotFields.some((field) => body[field] !== undefined);
    if (!snapshotProvided) return;
    for (const field of snapshotFields) {
      if (body[field] === undefined) {
        ctx.addIssue({ code: 'custom', path: [field], message: `${field} is required when output snapshot is provided` });
      }
    }
  });

export type ManualDecisionBodyDto = z.infer<typeof manualDecisionBodySchema>;
export type RequestWorkflowChangesDto = z.infer<typeof requestWorkflowChangesSchema>;
export type ApproveImplementationPlanAndMarkExecutionReadyDto = z.infer<
  typeof approveImplementationPlanAndMarkExecutionReadySchema
>;
export type ClaimCodexSessionLeaseDto = z.infer<typeof claimCodexSessionLeaseSchema>;
export type RenewCodexSessionLeaseDto = z.infer<typeof renewCodexSessionLeaseSchema>;
export type TerminalizeCodexSessionTurnDto = z.infer<typeof terminalizeCodexSessionTurnSchema>;

export { codexSessionPublicDtoSchema, planItemWorkflowPublicDtoSchema };
