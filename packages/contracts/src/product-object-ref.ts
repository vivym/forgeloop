import { z } from 'zod';

const nonEmpty = z.string().trim().min(1);

export const objectRefSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('initiative'), id: nonEmpty, title: nonEmpty.optional() }).strict(),
  z.object({ type: z.literal('requirement'), id: nonEmpty, title: nonEmpty.optional() }).strict(),
  z.object({ type: z.literal('bug'), id: nonEmpty, title: nonEmpty.optional() }).strict(),
  z.object({ type: z.literal('tech_debt'), id: nonEmpty, title: nonEmpty.optional() }).strict(),
  z.object({ type: z.literal('task'), id: nonEmpty, title: nonEmpty.optional() }).strict(),
  z.object({ type: z.literal('spec'), id: nonEmpty, title: nonEmpty.optional() }).strict(),
  z.object({ type: z.literal('spec_revision'), id: nonEmpty, spec_id: nonEmpty, title: nonEmpty.optional() }).strict(),
  z.object({ type: z.literal('plan'), id: nonEmpty, title: nonEmpty.optional() }).strict(),
  z.object({ type: z.literal('plan_revision'), id: nonEmpty, plan_id: nonEmpty, title: nonEmpty.optional() }).strict(),
  z.object({ type: z.literal('execution_package'), id: nonEmpty, title: nonEmpty.optional() }).strict(),
  z.object({ type: z.literal('run_session'), id: nonEmpty, title: nonEmpty.optional() }).strict(),
  z.object({ type: z.literal('review_packet'), id: nonEmpty, title: nonEmpty.optional() }).strict(),
  z.object({ type: z.literal('release'), id: nonEmpty, title: nonEmpty.optional() }).strict(),
  z.object({ type: z.literal('attachment'), id: nonEmpty, title: nonEmpty.optional() }).strict(),
]);
export type ObjectRef = z.infer<typeof objectRefSchema>;

export const editableObjectRefSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('initiative'), id: nonEmpty, driver_actor_id: nonEmpty.optional() }).strict(),
  z.object({ type: z.literal('requirement'), id: nonEmpty, driver_actor_id: nonEmpty.optional() }).strict(),
  z.object({ type: z.literal('bug'), id: nonEmpty, driver_actor_id: nonEmpty.optional() }).strict(),
  z.object({ type: z.literal('tech_debt'), id: nonEmpty, driver_actor_id: nonEmpty.optional() }).strict(),
  z.object({ type: z.literal('task'), id: nonEmpty }).strict(),
  z.object({ type: z.literal('spec'), id: nonEmpty }).strict(),
  z.object({ type: z.literal('plan'), id: nonEmpty }).strict(),
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
