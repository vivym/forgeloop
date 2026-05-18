import { z } from 'zod';

const isoDateTimeSchema = z.string().datetime();
const queryBooleanSchema = z.preprocess((value) => {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value !== 'string') {
    return value;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1') {
    return true;
  }
  if (normalized === 'false' || normalized === '0') {
    return false;
  }
  return value;
}, z.boolean());

export const productObjectRefSchema = z
  .object({
    type: z.enum(['work_item', 'spec', 'plan', 'execution_package', 'run_session', 'review_packet', 'release']),
    id: z.string().min(1),
    title: z.string().min(1).optional(),
  })
  .strict();
export type ProductObjectRef = z.infer<typeof productObjectRefSchema>;

export const productListQuerySchema = z
  .object({
    project_id: z.string().min(1),
    actor_id: z.string().min(1).optional(),
    status: z.string().min(1).optional(),
    phase: z.string().min(1).optional(),
    gate_state: z.string().min(1).optional(),
    resolution: z.string().min(1).optional(),
    risk: z.string().min(1).optional(),
    owner_actor_id: z.string().min(1).optional(),
    reviewer_actor_id: z.string().min(1).optional(),
    qa_owner_actor_id: z.string().min(1).optional(),
    release_owner_actor_id: z.string().min(1).optional(),
    work_item_id: z.string().min(1).optional(),
    spec_id: z.string().min(1).optional(),
    plan_id: z.string().min(1).optional(),
    spec_revision_id: z.string().min(1).optional(),
    plan_revision_id: z.string().min(1).optional(),
    execution_package_id: z.string().min(1).optional(),
    run_session_id: z.string().min(1).optional(),
    review_packet_id: z.string().min(1).optional(),
    release_id: z.string().min(1).optional(),
    surface_type: z.string().min(1).optional(),
    executor_type: z.string().min(1).optional(),
    decision: z.string().min(1).optional(),
    blocked: queryBooleanSchema.optional(),
    stale: queryBooleanSchema.optional(),
    cursor: z.string().min(1).optional(),
    limit: z.coerce.number().int().positive().max(100).default(50),
  })
  .strict();
export type ProductListQuery = z.infer<typeof productListQuerySchema>;

export const productListItemSchema = z
  .object({
    id: z.string().min(1),
    object: productObjectRefSchema,
    title: z.string().min(1),
    status: z.string().min(1).optional(),
    phase: z.string().min(1).optional(),
    gate_state: z.string().min(1).optional(),
    resolution: z.string().min(1).optional(),
    risk: z.string().min(1).optional(),
    owner_actor_id: z.string().min(1).optional(),
    reviewer_actor_id: z.string().min(1).optional(),
    qa_owner_actor_id: z.string().min(1).optional(),
    release_owner_actor_id: z.string().min(1).optional(),
    parent: productObjectRefSchema.optional(),
    related: z.array(productObjectRefSchema).default([]),
    revision_state: z
      .object({
        current_revision_id: z.string().min(1).optional(),
        approved_revision_id: z.string().min(1).optional(),
        revision_number: z.number().int().positive().optional(),
      })
      .strict()
      .optional(),
    package_state: z
      .object({
        work_item_id: z.string().min(1),
        spec_revision_id: z.string().min(1).optional(),
        plan_revision_id: z.string().min(1).optional(),
        surface_type: z.string().min(1).optional(),
        blocked_reason: z.string().min(1).optional(),
        last_run_session_id: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
    run_state: z
      .object({
        execution_package_id: z.string().min(1),
        executor_type: z.string().min(1).optional(),
        started_at: isoDateTimeSchema.optional(),
        finished_at: isoDateTimeSchema.optional(),
      })
      .strict()
      .optional(),
    review_state: z
      .object({
        execution_package_id: z.string().min(1),
        run_session_id: z.string().min(1),
        decision: z.string().min(1).optional(),
        changed_file_count: z.number().int().nonnegative().default(0),
      })
      .strict()
      .optional(),
    release_state: z
      .object({
        work_item_count: z.number().int().nonnegative().default(0),
        execution_package_count: z.number().int().nonnegative().default(0),
        rollout_complete: z.boolean().default(false),
        rollback_complete: z.boolean().default(false),
        observation_complete: z.boolean().default(false),
      })
      .strict()
      .optional(),
    counts: z.record(z.string(), z.number()).default({}),
    updated_at: isoDateTimeSchema,
  })
  .strict();
export type ProductListItem = z.infer<typeof productListItemSchema>;

export const productListResponseSchema = z
  .object({
    items: z.array(productListItemSchema),
    next_cursor: z.string().min(1).optional(),
    degraded_sources: z.array(z.string()).default([]),
  })
  .strict();
export type ProductListResponse = z.infer<typeof productListResponseSchema>;

export const pipelineStageIdSchema = z.enum([
  'intake',
  'spec_plan',
  'execution',
  'review',
  'integration_validation',
  'test_acceptance',
  'release',
  'observation',
]);
export type PipelineStageId = z.infer<typeof pipelineStageIdSchema>;

export const pipelineStageSchema = z
  .object({
    id: pipelineStageIdSchema,
    label: z.string().min(1),
    item_count: z.number().int().nonnegative(),
    blocked_count: z.number().int().nonnegative(),
    high_risk_count: z.number().int().nonnegative(),
    stale_count: z.number().int().nonnegative(),
    representative_items: z.array(productListItemSchema).default([]),
    degraded: z.boolean().default(false),
  })
  .strict();
export type PipelineStage = z.infer<typeof pipelineStageSchema>;

export const pipelineResponseSchema = z
  .object({
    stages: z.array(pipelineStageSchema),
    degraded_sources: z.array(z.string()).default([]),
  })
  .strict();
export type PipelineResponse = z.infer<typeof pipelineResponseSchema>;
