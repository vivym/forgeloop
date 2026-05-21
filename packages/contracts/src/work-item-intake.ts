import { z } from 'zod';

const nonEmptyTrimmedStringSchema = z.string().trim().min(1);
const optionalTrimmedStringSchema = z.preprocess((value) => {
  if (typeof value !== 'string') {
    return value;
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}, nonEmptyTrimmedStringSchema.optional());
const nonEmptyTrimmedArraySchema = z.preprocess((value) => {
  if (!Array.isArray(value)) {
    return value;
  }

  return value
    .map((item) => (typeof item === 'string' ? item.trim() : item))
    .filter((item) => item !== '');
}, z.array(nonEmptyTrimmedStringSchema).min(1));
const optionalTrimmedArraySchema = z.preprocess((value) => {
  if (!Array.isArray(value)) {
    return value;
  }

  const trimmedItems = value
    .map((item) => (typeof item === 'string' ? item.trim() : item))
    .filter((item) => item !== '');

  return trimmedItems.length === 0 ? undefined : trimmedItems;
}, z.array(nonEmptyTrimmedStringSchema).min(1).optional());

export const workItemKindSchema = z.enum(['initiative', 'requirement', 'bug', 'tech_debt']);
export type WorkItemKind = z.infer<typeof workItemKindSchema>;

const requirementIntakeContextSchema = z
  .object({
    type: z.literal('requirement'),
    stakeholder_problem: nonEmptyTrimmedStringSchema,
    desired_outcome: nonEmptyTrimmedStringSchema,
    acceptance_criteria: nonEmptyTrimmedArraySchema,
    in_scope: nonEmptyTrimmedArraySchema,
    out_of_scope: optionalTrimmedArraySchema,
    dependencies: optionalTrimmedArraySchema,
    rollout_notes: optionalTrimmedStringSchema,
  })
  .strict();

const bugIntakeContextSchema = z
  .object({
    type: z.literal('bug'),
    impact_summary: nonEmptyTrimmedStringSchema,
    observed_behavior: nonEmptyTrimmedStringSchema,
    expected_behavior: nonEmptyTrimmedStringSchema,
    reproduction_steps: nonEmptyTrimmedArraySchema,
    affected_environment: nonEmptyTrimmedStringSchema,
    verification_path: nonEmptyTrimmedStringSchema,
    suspected_area: optionalTrimmedStringSchema,
    regression_risk: optionalTrimmedStringSchema,
  })
  .strict();

const techDebtIntakeContextSchema = z
  .object({
    type: z.literal('tech_debt'),
    current_pain: nonEmptyTrimmedStringSchema,
    desired_invariant: nonEmptyTrimmedStringSchema,
    affected_modules: nonEmptyTrimmedArraySchema,
    behavior_preservation: nonEmptyTrimmedStringSchema,
    validation_strategy: nonEmptyTrimmedStringSchema,
    migration_constraints: optionalTrimmedStringSchema,
    rollback_notes: optionalTrimmedStringSchema,
  })
  .strict();

const initiativeIntakeContextSchema = z
  .object({
    type: z.literal('initiative'),
    business_outcome: nonEmptyTrimmedStringSchema,
    scope_narrative: nonEmptyTrimmedStringSchema,
    success_metrics: nonEmptyTrimmedArraySchema,
    milestone_intent: optionalTrimmedStringSchema,
    child_breakdown_assumptions: optionalTrimmedStringSchema,
    major_risks: optionalTrimmedStringSchema,
    cross_item_coordination_notes: optionalTrimmedStringSchema,
  })
  .strict();

export const workItemIntakeContextSchema = z.discriminatedUnion('type', [
  requirementIntakeContextSchema,
  bugIntakeContextSchema,
  techDebtIntakeContextSchema,
  initiativeIntakeContextSchema,
]);
export type WorkItemIntakeContext = z.infer<typeof workItemIntakeContextSchema>;

const refineKindMatchesIntakeContext = (
  payload: { kind?: WorkItemKind | undefined; intake_context?: WorkItemIntakeContext | undefined },
  ctx: z.RefinementCtx,
) => {
  if (payload.kind !== undefined && payload.intake_context !== undefined && payload.kind !== payload.intake_context.type) {
    ctx.addIssue({
      code: 'custom',
      path: ['intake_context', 'type'],
      message: 'intake_context type must match kind',
    });
  }
};

export const createWorkItemRequestSchema = z
  .object({
    project_id: nonEmptyTrimmedStringSchema,
    kind: workItemKindSchema,
    title: nonEmptyTrimmedStringSchema,
    goal: nonEmptyTrimmedStringSchema,
    success_criteria: nonEmptyTrimmedArraySchema,
    priority: nonEmptyTrimmedStringSchema,
    risk: nonEmptyTrimmedStringSchema,
    driver_actor_id: nonEmptyTrimmedStringSchema,
    intake_context: workItemIntakeContextSchema,
  })
  .strict()
  .superRefine(refineKindMatchesIntakeContext);
export type CreateWorkItemRequest = z.infer<typeof createWorkItemRequestSchema>;

export const patchWorkItemRequestSchema = z
  .object({
    goal: optionalTrimmedStringSchema,
    success_criteria: optionalTrimmedArraySchema,
    priority: optionalTrimmedStringSchema,
    risk: optionalTrimmedStringSchema,
    driver_actor_id: optionalTrimmedStringSchema,
    intake_context: workItemIntakeContextSchema.optional(),
    phase: z.enum(['draft', 'triage']).optional(),
  })
  .strict();
export type PatchWorkItemRequest = z.infer<typeof patchWorkItemRequestSchema>;

export const publicWorkItemSchema = z
  .object({
    id: nonEmptyTrimmedStringSchema,
    project_id: nonEmptyTrimmedStringSchema,
    kind: workItemKindSchema,
    title: nonEmptyTrimmedStringSchema,
    goal: nonEmptyTrimmedStringSchema,
    success_criteria: nonEmptyTrimmedArraySchema,
    priority: nonEmptyTrimmedStringSchema,
    risk: nonEmptyTrimmedStringSchema,
    driver_actor_id: nonEmptyTrimmedStringSchema,
    intake_context: workItemIntakeContextSchema,
    phase: nonEmptyTrimmedStringSchema,
    activity_state: nonEmptyTrimmedStringSchema,
    gate_state: nonEmptyTrimmedStringSchema,
    resolution: nonEmptyTrimmedStringSchema,
  })
  .strict()
  .superRefine(refineKindMatchesIntakeContext);
export type PublicWorkItem = z.infer<typeof publicWorkItemSchema>;
