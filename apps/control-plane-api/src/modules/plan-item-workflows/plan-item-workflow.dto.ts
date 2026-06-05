import { z } from 'zod';
import {
  codexSessionPublicDtoSchema,
  planItemWorkflowPublicDtoSchema,
  workflowMessageActionSchema,
} from '@forgeloop/contracts';

const nonEmpty = z.string().trim().min(1);

export const startBrainstormingWorkflowSchema = z
  .object({
    actor_id: nonEmpty,
    reason: nonEmpty.optional(),
  })
  .strict();
export type StartBrainstormingWorkflowDto = z.infer<typeof startBrainstormingWorkflowSchema>;

export const workflowMessageCommandBodySchema = z
  .object({
    actor_id: nonEmpty,
    action: workflowMessageActionSchema,
    body_markdown: nonEmpty,
    client_message_id: nonEmpty.optional(),
  })
  .strict();
export type WorkflowMessageCommandBodyDto = z.infer<typeof workflowMessageCommandBodySchema>;

export const runQueuedWorkflowActionBodySchema = z
  .object({
    actor_id: nonEmpty,
    idempotency_key: nonEmpty.optional(),
  })
  .strict();
export type RunQueuedWorkflowActionBodyDto = z.infer<typeof runQueuedWorkflowActionBodySchema>;

export const artifactTypeSchema = z.enum(['boundary-summary', 'spec-doc', 'implementation-plan-doc']);
export type WorkflowArtifactTypeDto = z.infer<typeof artifactTypeSchema>;

export const approveWorkflowArtifactRevisionBodySchema = z
  .object({
    actor_id: nonEmpty,
    decision_markdown: nonEmpty.optional(),
  })
  .strict();
export type ApproveWorkflowArtifactRevisionBodyDto = z.infer<typeof approveWorkflowArtifactRevisionBodySchema>;

export const requestWorkflowArtifactChangesBodySchema = z
  .object({
    actor_id: nonEmpty,
    reason_markdown: nonEmpty,
  })
  .strict();
export type RequestWorkflowArtifactChangesBodyDto = z.infer<typeof requestWorkflowArtifactChangesBodySchema>;

export const evaluateWorkflowExecutionReadinessBodySchema = z
  .object({
    actor_id: nonEmpty,
    rationale_markdown: nonEmpty.optional(),
  })
  .strict();
export type EvaluateWorkflowExecutionReadinessBodyDto = z.infer<typeof evaluateWorkflowExecutionReadinessBodySchema>;

export { codexSessionPublicDtoSchema, planItemWorkflowPublicDtoSchema };
