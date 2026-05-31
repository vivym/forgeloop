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

export type ManualDecisionBodyDto = z.infer<typeof manualDecisionBodySchema>;
export type RequestWorkflowChangesDto = z.infer<typeof requestWorkflowChangesSchema>;
export type ApproveImplementationPlanAndMarkExecutionReadyDto = z.infer<
  typeof approveImplementationPlanAndMarkExecutionReadySchema
>;

export { codexSessionPublicDtoSchema, planItemWorkflowPublicDtoSchema };
