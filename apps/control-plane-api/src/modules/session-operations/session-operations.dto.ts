import {
  recoverSessionRequestSchema,
  scavengeSessionOperationsRequestSchema,
  sessionRecoveryCandidatePredicateSchema,
  type RecoverSessionRequest,
  type ScavengeSessionOperationsRequest,
} from '@forgeloop/contracts';
import { z } from 'zod';

export { recoverSessionRequestSchema, scavengeSessionOperationsRequestSchema };

export const recoverSessionRouteRequestSchema = z
  .object({
    operation: z.enum(['recover', 'mark_unrecoverable']),
    reason: z.string().trim().min(1),
    operation_idempotency_key: z.string().trim().min(1),
    candidate_predicate: sessionRecoveryCandidatePredicateSchema,
  });

export type RecoverSessionRequestDto = RecoverSessionRequest;
export type ScavengeSessionOperationsRequestDto = ScavengeSessionOperationsRequest;
