import { z } from 'zod';

import { productHrefSchema } from './api.js';

const isoDateTimeSchema = z.string().datetime();
const nonEmpty = z.string().trim().min(1);

export const deliveryRunReadinessBlockerCodeSchema = z.enum([
  'runtime_profile_missing',
  'runtime_profile_invalid',
  'runtime_target_incompatible',
  'credential_binding_unconfigured',
  'credential_binding_ambiguous',
  'worker_unavailable',
  'worker_target_unsupported',
  'worker_docker_capability_mismatch',
  'worker_network_policy_mismatch',
  'package_policy_snapshot_missing',
  'package_runtime_target_incompatible',
  'runtime_status_unknown',
]);

export const deliveryRunReadinessBlockerSchema = z
  .object({
    code: deliveryRunReadinessBlockerCodeSchema,
    message: nonEmpty,
    severity: z.enum(['info', 'warning', 'blocking']),
    next_step_href: productHrefSchema.optional(),
  })
  .strict();

export const deliveryRunReadinessResponseSchema = z
  .object({
    executor_type: z.literal('local_codex'),
    target_kind: z.literal('run_execution'),
    state: z.enum(['ready', 'blocked', 'unknown']),
    blockers: z.array(deliveryRunReadinessBlockerSchema),
    generated_at: isoDateTimeSchema.optional(),
  })
  .strict()
  .superRefine((readiness, ctx) => {
    if (readiness.state === 'ready' && readiness.blockers.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['blockers'],
        message: 'ready runtime readiness must not include blockers',
      });
    }

    if ((readiness.state === 'blocked' || readiness.state === 'unknown') && readiness.blockers.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['blockers'],
        message: `${readiness.state} runtime readiness requires at least one blocker`,
      });
    }
  });

export type DeliveryRunReadinessBlockerCode = z.infer<typeof deliveryRunReadinessBlockerCodeSchema>;
export type DeliveryRunReadinessBlocker = z.infer<typeof deliveryRunReadinessBlockerSchema>;
export type DeliveryRunReadinessResponse = z.infer<typeof deliveryRunReadinessResponseSchema>;
