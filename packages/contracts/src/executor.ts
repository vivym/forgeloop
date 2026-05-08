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
  'executor_process_failed',
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

    if (changedFile.change_kind === 'renamed' && changedFile.previous_path === changedFile.path) {
      ctx.addIssue({
        code: 'custom',
        path: ['previous_path'],
        message: 'previous_path must differ from path for renamed files',
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

const requiredCheckSpecsMatch = (left: RequiredCheckSpec[], right: RequiredCheckSpec[]) =>
  left.length === right.length &&
  left.every((leftCheck, index) => {
    const rightCheck = right[index];

    return (
      rightCheck !== undefined &&
      leftCheck.check_id === rightCheck.check_id &&
      leftCheck.display_name === rightCheck.display_name &&
      leftCheck.command === rightCheck.command &&
      leftCheck.timeout_seconds === rightCheck.timeout_seconds &&
      leftCheck.blocks_review === rightCheck.blocks_review
    );
  });

const addDuplicateCheckIdIssues = (
  checks: Array<{ check_id: string }>,
  path: (string | number)[],
  description: string,
  ctx: z.RefinementCtx,
) => {
  const seenCheckIds = new Set<string>();
  const duplicateCheckIds = new Set<string>();

  checks.forEach((check) => {
    if (seenCheckIds.has(check.check_id)) {
      duplicateCheckIds.add(check.check_id);
    }

    seenCheckIds.add(check.check_id);
  });

  duplicateCheckIds.forEach((checkId) => {
    ctx.addIssue({
      code: 'custom',
      path,
      message: `${description} check ids must be unique: ${checkId}`,
    });
  });
};

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

    if (
      (checkResult.status === 'skipped' || checkResult.status === 'cancelled') &&
      checkResult.exit_code !== null
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['exit_code'],
        message: `${checkResult.status} checks require exit_code null`,
      });
    }

    if (checkResult.status === 'timed_out' && checkResult.exit_code === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['exit_code'],
        message: 'timed_out checks require exit_code null or non-zero',
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

const reviewContextSchema = z
  .object({
    latest_decision: z.enum(['none', 'approved', 'changes_requested']).optional(),
    requested_changes: z.array(requestedChangeContextSchema).default([]),
  })
  .superRefine((reviewContext, ctx) => {
    if (reviewContext.latest_decision === 'changes_requested' && reviewContext.requested_changes.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['requested_changes'],
        message: 'changes_requested review context requires at least one requested change',
      });
    }

    if (reviewContext.latest_decision !== 'changes_requested' && reviewContext.requested_changes.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['requested_changes'],
        message: 'requested_changes are only allowed when latest_decision is changes_requested',
      });
    }
  });

export const runSpecSchema = z
  .object({
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
    review_context: reviewContextSchema,
    workflow_only: z.boolean().default(false),
    allowed_paths: z.array(z.string().min(1)).min(1),
    forbidden_paths: z.array(z.string().min(1)),
    required_checks: z.array(requiredCheckSpecSchema),
    artifact_policy: z.object({
      requested_artifacts: z.array(artifactKindSchema).min(1),
    }),
    timeout_seconds: z.number().int().positive(),
    idempotency_key: z.string().min(1),
  })
  .superRefine((runSpec, ctx) => {
    if (!requiredCheckSpecsMatch(runSpec.context.required_checks, runSpec.required_checks)) {
      ctx.addIssue({
        code: 'custom',
        path: ['required_checks'],
        message: 'required_checks must match context.required_checks in order',
      });
    }

    addDuplicateCheckIdIssues(runSpec.context.required_checks, ['context', 'required_checks'], 'required', ctx);
    addDuplicateCheckIdIssues(runSpec.required_checks, ['required_checks'], 'required', ctx);
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
    const hasFailedBlockingCheck = result.checks.some((check) => check.blocks_review && check.status === 'failed');

    if (Date.parse(result.finished_at) < Date.parse(result.started_at)) {
      ctx.addIssue({
        code: 'custom',
        path: ['finished_at'],
        message: 'finished_at must be greater than or equal to started_at',
      });
    }

    addDuplicateCheckIdIssues(result.checks, ['checks'], 'ExecutorResult', ctx);

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

    if (hasFailedBlockingCheck && result.status !== 'failed') {
      ctx.addIssue({
        code: 'custom',
        path: ['status'],
        message: 'failed blocking checks require failed ExecutorResult status',
      });
    }

    if (
      hasUnsuccessfulBlockingCheck &&
      result.status === 'failed' &&
      result.failure?.kind !== 'required_check_failed' &&
      result.failure?.kind !== 'path_violation'
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['failure', 'kind'],
        message: 'unsuccessful blocking checks require required_check_failed failure kind unless a path_violation takes precedence',
      });
    }

    if (result.status !== 'succeeded' && !result.failure) {
      ctx.addIssue({
        code: 'custom',
        path: ['failure'],
        message: 'failure is required when ExecutorResult status is not succeeded',
      });
    }

    if (result.status === 'timed_out' && result.failure && result.failure.kind !== 'timed_out') {
      ctx.addIssue({
        code: 'custom',
        path: ['failure', 'kind'],
        message: 'timed_out ExecutorResult requires timed_out failure kind',
      });
    }

    if (result.status === 'cancelled' && result.failure && result.failure.kind !== 'cancelled') {
      ctx.addIssue({
        code: 'custom',
        path: ['failure', 'kind'],
        message: 'cancelled ExecutorResult requires cancelled failure kind',
      });
    }

    if (
      result.status === 'failed' &&
      (result.failure?.kind === 'timed_out' || result.failure?.kind === 'cancelled')
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['failure', 'kind'],
        message: 'failed ExecutorResult cannot use timed_out or cancelled failure kind',
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
