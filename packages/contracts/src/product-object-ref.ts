import { z } from 'zod';

const nonEmpty = z.string().trim().min(1);

const sourceObjectRefOptions = [
  z.object({ type: z.literal('initiative'), id: nonEmpty, revision_id: nonEmpty.optional(), title: nonEmpty.optional() }).strict(),
  z.object({ type: z.literal('requirement'), id: nonEmpty, revision_id: nonEmpty.optional(), title: nonEmpty.optional() }).strict(),
  z.object({ type: z.literal('bug'), id: nonEmpty, revision_id: nonEmpty.optional(), title: nonEmpty.optional() }).strict(),
  z.object({ type: z.literal('tech_debt'), id: nonEmpty, revision_id: nonEmpty.optional(), title: nonEmpty.optional() }).strict(),
] as const;

export const sourceObjectRefSchema = z.discriminatedUnion('type', sourceObjectRefOptions);
export type SourceObjectRef = z.infer<typeof sourceObjectRefSchema>;

export const productObjectRefSchema = z.discriminatedUnion('type', [
  ...sourceObjectRefOptions,
  z.object({ type: z.literal('development_plan'), id: nonEmpty, revision_id: nonEmpty.optional(), title: nonEmpty.optional() }).strict(),
  z
    .object({
      type: z.literal('development_plan_item'),
      id: nonEmpty,
      development_plan_id: nonEmpty,
      revision_id: nonEmpty.optional(),
      title: nonEmpty.optional(),
    })
    .strict(),
  z.object({ type: z.literal('brainstorming_session'), id: nonEmpty, revision_id: nonEmpty.optional(), title: nonEmpty.optional() }).strict(),
  z.object({ type: z.literal('boundary_summary'), id: nonEmpty, revision_id: nonEmpty.optional(), title: nonEmpty.optional() }).strict(),
  z.object({ type: z.literal('spec'), id: nonEmpty, title: nonEmpty.optional() }).strict(),
  z.object({ type: z.literal('spec_revision'), id: nonEmpty, spec_id: nonEmpty, title: nonEmpty.optional() }).strict(),
  z.object({ type: z.literal('execution_plan'), id: nonEmpty, title: nonEmpty.optional() }).strict(),
  z
    .object({
      type: z.literal('execution_plan_revision'),
      id: nonEmpty,
      execution_plan_id: nonEmpty,
      title: nonEmpty.optional(),
    })
    .strict(),
  z.object({ type: z.literal('execution'), id: nonEmpty, title: nonEmpty.optional() }).strict(),
  z.object({ type: z.literal('code_review_handoff'), id: nonEmpty, title: nonEmpty.optional() }).strict(),
  z.object({ type: z.literal('qa_handoff'), id: nonEmpty, title: nonEmpty.optional() }).strict(),
  z.object({ type: z.literal('release'), id: nonEmpty, title: nonEmpty.optional() }).strict(),
  z.object({ type: z.literal('attachment'), id: nonEmpty, title: nonEmpty.optional() }).strict(),
]);
export type ProductObjectRef = z.infer<typeof productObjectRefSchema>;

export const runtimeEvidenceObjectRefSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('execution_package'), id: nonEmpty, title: nonEmpty.optional() }).strict(),
  z.object({ type: z.literal('run_session'), id: nonEmpty, title: nonEmpty.optional() }).strict(),
  z.object({ type: z.literal('review_packet'), id: nonEmpty, title: nonEmpty.optional() }).strict(),
]);
export type RuntimeEvidenceObjectRef = z.infer<typeof runtimeEvidenceObjectRefSchema>;

export const productQueryObjectRefSchema = productObjectRefSchema;
export type ProductQueryObjectRef = z.infer<typeof productQueryObjectRefSchema>;

export const objectRefSchema = productObjectRefSchema;
export type ObjectRef = z.infer<typeof objectRefSchema>;

export const legacyBoardQueryObjectRefSchema = productQueryObjectRefSchema;
export type LegacyBoardQueryObjectRef = z.infer<typeof legacyBoardQueryObjectRefSchema>;

export const editableObjectRefSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('initiative'), id: nonEmpty, driver_actor_id: nonEmpty.optional() }).strict(),
  z.object({ type: z.literal('requirement'), id: nonEmpty, driver_actor_id: nonEmpty.optional() }).strict(),
  z.object({ type: z.literal('bug'), id: nonEmpty, driver_actor_id: nonEmpty.optional() }).strict(),
  z.object({ type: z.literal('tech_debt'), id: nonEmpty, driver_actor_id: nonEmpty.optional() }).strict(),
  z.object({ type: z.literal('spec'), id: nonEmpty }).strict(),
  z.object({ type: z.literal('spec_revision'), id: nonEmpty, spec_id: nonEmpty.optional() }).strict(),
  z.object({ type: z.literal('development_plan'), id: nonEmpty }).strict(),
  z.object({ type: z.literal('development_plan_item'), id: nonEmpty, development_plan_id: nonEmpty }).strict(),
  z.object({ type: z.literal('execution_plan'), id: nonEmpty }).strict(),
  z.object({ type: z.literal('execution_plan_revision'), id: nonEmpty, execution_plan_id: nonEmpty.optional() }).strict(),
  z.object({ type: z.literal('execution'), id: nonEmpty }).strict(),
  z.object({ type: z.literal('release'), id: nonEmpty }).strict(),
]);
export type EditableObjectRef = z.infer<typeof editableObjectRefSchema>;

export const legacyWorkItemStorageRefSchema = z
  .object({
    type: z.literal('work_item'),
    id: nonEmpty,
    work_item_kind: z.enum(['initiative', 'requirement', 'bug', 'tech_debt']),
  })
  .strict();
export type LegacyWorkItemStorageRef = z.infer<typeof legacyWorkItemStorageRefSchema>;
