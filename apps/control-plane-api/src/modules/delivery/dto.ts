import {
  artifactKindSchema,
  executorTypeSchema,
  jsonObjectSchema,
  requiredCheckSpecSchema,
  type ArtifactKind,
  type RequiredCheckSpec,
} from '@forgeloop/contracts';
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

export const runPackageSchema = z
  .object({
    execution_package_id: nonEmptyString.optional(),
    requested_by_actor_id: nonEmptyString,
    executor_type: executorTypeSchema.optional(),
    workflow_only: z.boolean().optional(),
    previous_run_session_id: nonEmptyString.optional(),
    force: z.literal(true).optional(),
    force_reason: nonEmptyString.optional(),
  })
  .strict();
export type RunPackageDto = z.infer<typeof runPackageSchema>;

export const runInputSchema = z
  .object({
    actor_id: nonEmptyString.optional(),
    message: nonEmptyString,
    target_turn_id: nonEmptyString.optional(),
  })
  .strict();
export type RunInputDto = z.infer<typeof runInputSchema>;

export const runControlSchema = z
  .object({
    actor_id: nonEmptyString.optional(),
    reason: nonEmptyString.optional(),
  })
  .strict();
export type RunControlDto = z.infer<typeof runControlSchema>;

export const markPackageReadySchema = actorCommandSchema.extend({
  expected_package_version: z.number().int().min(0),
});
export type MarkPackageReadyDto = z.infer<typeof markPackageReadySchema>;

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

export const createExecutionPackageSchema = z
  .object({
    repo_id: nonEmptyString,
    objective: nonEmptyString,
    owner_actor_id: nonEmptyString,
    reviewer_actor_id: nonEmptyString,
    qa_owner_actor_id: nonEmptyString,
    required_checks: z.array(requiredCheckSpecSchema) satisfies z.ZodType<RequiredCheckSpec[]>,
    required_artifact_kinds: z.array(artifactKindSchema) satisfies z.ZodType<ArtifactKind[]>,
    allowed_paths: stringList,
    forbidden_paths: stringList,
  })
  .strict();
export type CreateExecutionPackageDto = z.infer<typeof createExecutionPackageSchema>;

export const patchExecutionPackageSchema = z
  .object({
    objective: nonEmptyString.optional(),
    owner_actor_id: nonEmptyString.optional(),
    reviewer_actor_id: nonEmptyString.optional(),
    qa_owner_actor_id: nonEmptyString.optional(),
    required_checks: z.array(requiredCheckSpecSchema).optional(),
    required_artifact_kinds: z.array(artifactKindSchema).optional(),
    allowed_paths: stringList.optional(),
    forbidden_paths: stringList.optional(),
  })
  .strict();
export type PatchExecutionPackageDto = z.infer<typeof patchExecutionPackageSchema>;
