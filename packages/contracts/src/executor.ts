import { z } from 'zod';

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(jsonValueSchema), z.record(z.string(), jsonValueSchema)]),
);

export const jsonObjectSchema = z.record(z.string(), jsonValueSchema);

const isoDateTimeSchema = z.string().datetime();

export const executorTypeSchema = z.enum(['mock', 'local_codex']);
export type ExecutorType = z.infer<typeof executorTypeSchema>;

export const failureKindSchema = z.enum([
  'required_check_failed',
  'executor_error',
  'workspace_prepare_failed',
  'preflight_failed',
  'path_violation',
  'cancelled',
  'timed_out',
  'unknown',
]);
export type FailureKind = z.infer<typeof failureKindSchema>;

export const artifactKindSchema = z.enum([
  'diff',
  'changed_files',
  'check_output',
  'logs',
  'execution_summary',
  'self_review',
  'review_packet',
  'raw_metadata',
]);
export type ArtifactKind = z.infer<typeof artifactKindSchema>;

export const artifactRefSchema = z
  .object({
    kind: artifactKindSchema,
    name: z.string().min(1),
    content_type: z.string().min(1),
    storage_uri: z.string().min(1).optional(),
    local_ref: z.string().min(1).optional(),
    digest: z.string().min(1).optional(),
  })
  .superRefine((artifact, ctx) => {
    if (!artifact.storage_uri && !artifact.local_ref) {
      ctx.addIssue({
        code: 'custom',
        path: ['storage_uri'],
        message: 'ArtifactRef requires either storage_uri or local_ref',
      });
    }
  });
export type ArtifactRef = z.infer<typeof artifactRefSchema>;

export const changedFileSchema = z
  .object({
    repo_id: z.string().min(1),
    path: z.string().min(1),
    change_kind: z.enum(['added', 'modified', 'deleted', 'renamed']),
    previous_path: z.string().min(1).optional(),
  })
  .superRefine((changedFile, ctx) => {
    if (changedFile.change_kind === 'renamed' && !changedFile.previous_path) {
      ctx.addIssue({
        code: 'custom',
        path: ['previous_path'],
        message: 'previous_path is required for renamed files',
      });
    }

    if (changedFile.change_kind !== 'renamed' && changedFile.previous_path !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['previous_path'],
        message: 'previous_path is only allowed for renamed files',
      });
    }
  });
export type ChangedFile = z.infer<typeof changedFileSchema>;

export const requiredCheckSpecSchema = z.object({
  check_id: z.string().min(1),
  display_name: z.string().min(1),
  command: z.string().min(1),
  timeout_seconds: z.number().int().positive(),
  blocks_review: z.boolean(),
});
export type RequiredCheckSpec = z.infer<typeof requiredCheckSpecSchema>;

export const checkResultSchema = z
  .object({
    check_id: z.string().min(1),
    command: z.string().min(1),
    status: z.enum(['succeeded', 'failed', 'cancelled', 'timed_out', 'skipped']),
    exit_code: z.number().int().nullable(),
    duration_seconds: z.number().nonnegative(),
    blocks_review: z.boolean(),
    stdout: artifactRefSchema.optional(),
    stderr: artifactRefSchema.optional(),
  })
  .superRefine((checkResult, ctx) => {
    if (checkResult.status === 'succeeded' && checkResult.exit_code !== 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['exit_code'],
        message: 'succeeded checks require exit_code 0',
      });
    }

    if (checkResult.status === 'failed' && (checkResult.exit_code === null || checkResult.exit_code === 0)) {
      ctx.addIssue({
        code: 'custom',
        path: ['exit_code'],
        message: 'failed checks require a non-zero exit_code',
      });
    }
  });
export type CheckResult = z.infer<typeof checkResultSchema>;

const requestedChangeContextSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  file_path: z.string().min(1).optional(),
  severity: z.enum(['minor', 'major', 'critical']).optional(),
  suggested_validation: z.string().min(1).optional(),
});

export const runSpecSchema = z.object({
  run_session_id: z.string().min(1),
  execution_package_id: z.string().min(1),
  work_item_id: z.string().min(1),
  spec_revision_id: z.string().min(1),
  plan_revision_id: z.string().min(1),
  executor_type: executorTypeSchema,
  repo: z.object({
    repo_id: z.string().min(1),
    local_path: z.string().min(1),
    base_branch: z.string().min(1),
    base_commit_sha: z.string().min(1),
  }),
  objective: z.string().min(1),
  context: z.object({
    spec_revision_summary: z.string().min(1),
    plan_revision_summary: z.string().min(1),
    package_instructions: z.string().min(1),
    required_checks: z.array(requiredCheckSpecSchema),
  }),
  review_context: z.object({
    latest_decision: z.enum(['none', 'approved', 'changes_requested']).optional(),
    requested_changes: z.array(requestedChangeContextSchema).default([]),
  }),
  workflow_only: z.boolean().default(false),
  allowed_paths: z.array(z.string().min(1)),
  forbidden_paths: z.array(z.string().min(1)),
  required_checks: z.array(requiredCheckSpecSchema),
  artifact_policy: z.object({
    requested_artifacts: z.array(artifactKindSchema),
  }),
  timeout_seconds: z.number().int().positive(),
  idempotency_key: z.string().min(1),
});
export type RunSpec = z.infer<typeof runSpecSchema>;

export const executorResultStatusSchema = z.enum(['succeeded', 'failed', 'cancelled', 'timed_out']);
export type ExecutorResultStatus = z.infer<typeof executorResultStatusSchema>;

export const executorFailureSchema = z.object({
  kind: failureKindSchema,
  message: z.string().min(1),
  retryable: z.boolean(),
});
export type ExecutorFailure = z.infer<typeof executorFailureSchema>;

export const executorResultSchema = z
  .object({
    run_session_id: z.string().min(1),
    executor_type: executorTypeSchema,
    executor_version: z.string().min(1),
    status: executorResultStatusSchema,
    started_at: isoDateTimeSchema,
    finished_at: isoDateTimeSchema,
    summary: z.string().min(1),
    changed_files: z.array(changedFileSchema),
    checks: z.array(checkResultSchema),
    artifacts: z.array(artifactRefSchema),
    failure: executorFailureSchema.optional(),
    raw_metadata: jsonObjectSchema.default({}),
  })
  .superRefine((result, ctx) => {
    const hasUnsuccessfulBlockingCheck = result.checks.some((check) => check.blocks_review && check.status !== 'succeeded');

    if (result.status === 'succeeded' && result.failure) {
      ctx.addIssue({
        code: 'custom',
        path: ['failure'],
        message: 'failure is not allowed when ExecutorResult status is succeeded',
      });
    }

    if (result.status === 'succeeded' && hasUnsuccessfulBlockingCheck) {
      ctx.addIssue({
        code: 'custom',
        path: ['checks'],
        message: 'succeeded ExecutorResult cannot include unsuccessful blocking checks',
      });
    }

    if (result.status !== 'succeeded' && !result.failure) {
      ctx.addIssue({
        code: 'custom',
        path: ['failure'],
        message: 'failure is required when ExecutorResult status is not succeeded',
      });
    }

    if (result.failure?.kind === 'required_check_failed' && !hasUnsuccessfulBlockingCheck) {
      ctx.addIssue({
        code: 'custom',
        path: ['checks'],
        message: 'required_check_failed requires at least one unsuccessful blocking check',
      });
    }
  });
export type ExecutorResult = z.infer<typeof executorResultSchema>;
