import { jsonObjectSchema } from '@forgeloop/contracts';
import { workItemKinds, type WorkItemKind } from '@forgeloop/domain';
import { z } from 'zod';

const nonEmptyString = z.string().trim().min(1);
const stringList = z.array(nonEmptyString);
const workItemReadinessPhases = ['draft', 'triage'] as const;

export const createProjectSchema = z
  .object({
    name: nonEmptyString,
    owner_actor_id: nonEmptyString.optional(),
  })
  .strict();
export type CreateProjectDto = z.infer<typeof createProjectSchema>;

export const createProjectRepoSchema = z
  .object({
    repo_id: nonEmptyString,
    name: nonEmptyString,
    local_path: nonEmptyString,
    default_branch: nonEmptyString.optional(),
    remote_url: nonEmptyString.optional(),
    base_commit_sha: nonEmptyString,
  })
  .strict();
export type CreateProjectRepoDto = z.infer<typeof createProjectRepoSchema>;

export const createWorkItemSchema = z
  .object({
    project_id: nonEmptyString,
    kind: z.enum(workItemKinds) satisfies z.ZodType<WorkItemKind>,
    title: nonEmptyString,
    goal: nonEmptyString,
    success_criteria: stringList.default([]),
    priority: nonEmptyString,
    risk: nonEmptyString,
    owner_actor_id: nonEmptyString,
  })
  .strict();
export type CreateWorkItemDto = z.infer<typeof createWorkItemSchema>;

export const updateWorkItemSchema = z
  .object({
    goal: nonEmptyString.optional(),
    success_criteria: stringList.optional(),
    priority: nonEmptyString.optional(),
    risk: nonEmptyString.optional(),
    owner_actor_id: nonEmptyString.optional(),
    phase: z.enum(workItemReadinessPhases).optional(),
  })
  .strict();
export type UpdateWorkItemDto = z.infer<typeof updateWorkItemSchema>;

export const actorCommandSchema = z
  .object({
    actor_id: nonEmptyString.optional(),
  })
  .strict();
export type ActorCommandDto = z.infer<typeof actorCommandSchema>;

export const createSpecRevisionSchema = z
  .object({
    summary: nonEmptyString,
    content: nonEmptyString,
    background: nonEmptyString,
    goals: stringList,
    scope_in: stringList,
    scope_out: stringList,
    acceptance_criteria: stringList,
    risk_notes: stringList.default([]),
    test_strategy_summary: nonEmptyString,
    structured_document: jsonObjectSchema.optional(),
    author_actor_id: nonEmptyString.optional(),
  })
  .strict();
export type CreateSpecRevisionDto = z.infer<typeof createSpecRevisionSchema>;

export const createPlanRevisionSchema = z
  .object({
    summary: nonEmptyString,
    content: nonEmptyString,
    implementation_summary: nonEmptyString,
    split_strategy: nonEmptyString,
    dependency_order: stringList.default([]),
    test_matrix: stringList,
    risk_mitigations: stringList.default([]),
    rollback_notes: nonEmptyString,
    structured_document: jsonObjectSchema.optional(),
    author_actor_id: nonEmptyString.optional(),
  })
  .strict();
export type CreatePlanRevisionDto = z.infer<typeof createPlanRevisionSchema>;
