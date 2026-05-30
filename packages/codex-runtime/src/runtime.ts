import { AppServerGenerationDriver } from './app-server-generation-driver.js';
import { CodexAppServerEndpointTransport } from './app-server-endpoint-transport.js';
import type { CodexAppServerTransport } from './app-server-protocol.js';
import {
  createFakeBoundaryRoundRuntimeResult,
  createFakeGeneratedExecutionPlanRevision,
  createFakeGeneratedSpecRevision,
  createFakePackageDraftSet,
  createFakePlanDraft,
  createFakeSpecDraft,
} from './fake-driver.js';
import { createCodexGenerationRuntimeSafety } from './generation-safety-factory.js';
import {
  validateBoundaryRoundRuntimeResult,
  validateGeneratedExecutionPlanRevision,
  validateGeneratedPackageDraftSet,
  validateGeneratedPlanDraft,
  validateGeneratedSpecDraft,
  validateGeneratedSpecRevision,
} from './payloads.js';
import type {
  BoundaryRoundRuntimeResultV1,
  CodexGenerationDriverMode,
  CodexGenerationResult,
  CodexGenerationRuntime,
  CodexGenerationRuntimeTaskInput,
  CodexGenerationTaskKind,
  GeneratedExecutionPlanRevisionV1,
  GeneratedPackageDraftSetV1,
  GeneratedSpecRevisionV1,
} from './types.js';

export type CodexGenerationErrorCode =
  | 'codex_generation_disabled'
  | 'codex_generation_safety_unavailable'
  | 'codex_generation_sandbox_invalid'
  | 'codex_app_server_unavailable'
  | 'codex_generation_timeout'
  | 'codex_generation_cancelled'
  | 'codex_generation_concurrency_limit_exceeded'
  | 'codex_generation_raw_log_too_large'
  | 'codex_generation_usage_limited'
  | 'codex_generation_turn_failed'
  | 'generated_output_invalid_json'
  | 'generated_output_ambiguous'
  | 'generated_output_schema_invalid'
  | 'generated_output_too_large';

export class CodexGenerationError extends Error {
  readonly code: CodexGenerationErrorCode;
  readonly retryable: boolean;
  readonly publicResultJson: Record<string, unknown>;

  constructor(code: CodexGenerationErrorCode, options: { retryable: boolean; publicResultJson?: Record<string, unknown> }) {
    super(code);
    this.name = 'CodexGenerationError';
    this.code = code;
    this.retryable = options.retryable;
    this.publicResultJson = options.publicResultJson ?? { status: 422, code };
  }
}

export const createAppServerGenerationDriver = (input: {
  endpoint: string | undefined;
  taskKind: CodexGenerationTaskKind;
  actionRunId: string;
  projectId: string;
  repoIds: string[];
  artifactRoot: string | undefined;
  workspaceRoot?: string;
  policyDigests: Record<string, string>;
  timeoutMs?: number;
  outputLimitBytes?: number;
  rawNotificationLimitBytes?: number;
  transportFactory?: (endpoint: string) => CodexAppServerTransport;
}): AppServerGenerationDriver => {
  const runtimeSafety = createCodexGenerationRuntimeSafety(input);
  const transport = input.transportFactory?.(input.endpoint ?? '') ?? new CodexAppServerEndpointTransport(input.endpoint ?? '');
  return new AppServerGenerationDriver({
    transport,
    runtimeSafety,
    limits: {
      ...(input.outputLimitBytes === undefined ? {} : { outputLimitBytes: input.outputLimitBytes }),
      ...(input.rawNotificationLimitBytes === undefined ? {} : { rawNotificationLimitBytes: input.rawNotificationLimitBytes }),
    },
  });
};

export interface CodexGenerationRuntimeConfig {
  mode: CodexGenerationDriverMode;
  appServerEndpoint?: string;
  artifactRoot?: string;
  workspaceRoot?: string;
  timeoutMs?: number;
  outputLimitBytes?: number;
  rawNotificationLimitBytes?: number;
  maxConcurrency?: number;
  transportFactory?: (endpoint: string) => CodexAppServerTransport;
}

const assertPositiveInt = (name: string, value: number | undefined): void => {
  if (value !== undefined && (!Number.isInteger(value) || value <= 0)) {
    throw new Error(`${name}_invalid`);
  }
};

const promptFor = (
  taskKind: CodexGenerationTaskKind,
  input: CodexGenerationRuntimeTaskInput<Record<string, unknown>>,
): string => {
  const request = {
    task_kind: taskKind,
    prompt_version: input.promptVersion,
    output_schema_version: input.outputSchemaVersion,
    context: input.context,
  };
  return [
    'You are a ForgeLoop product-generation worker running inside a read-only Codex app-server sandbox.',
    'Return exactly one JSON object that satisfies the requested output schema. Do not wrap the object in Markdown fences. Do not include prose before or after the JSON.',
    'All strings must be public-safe product text. Do not include raw file system paths, runtime endpoints, container ids, config/auth material, secrets, logs, or prompt transcripts.',
    '',
    `Task kind: ${taskKind}`,
    `Output schema version: ${input.outputSchemaVersion}`,
    '',
    'Request context JSON:',
    JSON.stringify(request, null, 2),
    '',
    'Output schema contract:',
    outputSchemaContract(taskKind, input.outputSchemaVersion, input.context),
  ].join('\n');
};

const nestedRecord = (value: unknown, key: string): Record<string, unknown> | undefined => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const entry = (value as Record<string, unknown>)[key];
  return entry !== null && typeof entry === 'object' && !Array.isArray(entry) ? (entry as Record<string, unknown>) : undefined;
};

const stringFromPath = (value: Record<string, unknown>, path: readonly string[]): string | undefined => {
  let current: Record<string, unknown> | undefined = value;
  for (const [index, key] of path.entries()) {
    if (current === undefined) {
      return undefined;
    }
    const entry = current[key];
    if (index === path.length - 1) {
      return typeof entry === 'string' && entry.trim().length > 0 ? entry : undefined;
    }
    current = nestedRecord(current, key);
  }
  return undefined;
};

const contextString = (context: Record<string, unknown>, paths: readonly (readonly string[])[], fallback: string): string =>
  paths.map((path) => stringFromPath(context, path)).find((value): value is string => value !== undefined) ?? fallback;

const stringArrayFromPath = (value: Record<string, unknown>, path: readonly string[]): string[] | undefined => {
  let current: Record<string, unknown> | undefined = value;
  for (const [index, key] of path.entries()) {
    if (current === undefined) {
      return undefined;
    }
    const entry = current[key];
    if (index === path.length - 1) {
      if (!Array.isArray(entry) || !entry.every((item): item is string => typeof item === 'string' && item.trim().length > 0)) {
        return undefined;
      }
      return entry;
    }
    current = nestedRecord(current, key);
  }
  return undefined;
};

const contextStringArray = (
  context: Record<string, unknown>,
  paths: readonly (readonly string[])[],
  fallback: string[],
): string[] => paths.map((path) => stringArrayFromPath(context, path)).find((value): value is string[] => value !== undefined) ?? fallback;

const outputSchemaContract = (
  taskKind: CodexGenerationTaskKind,
  outputSchemaVersion: string,
  context: Record<string, unknown>,
): string => {
  if (taskKind === 'boundary_brainstorming_round' || outputSchemaVersion === 'boundary_round_result.v1') {
    const sessionId = contextString(context, [['boundary_session', 'id'], ['session_id']], 'boundary-session-id');
    const roundId = contextString(context, [['boundary_round', 'id'], ['round_id']], 'boundary-round-id');
    const operation = contextString(context, [['operation']], 'start');
    const shouldProposeSummary = operation !== 'start';
    const expected = shouldProposeSummary
      ? {
          schema_version: 'boundary_round_result.v1',
          session_id: sessionId,
          round_id: roundId,
          questions: [],
          proposed_decisions: [
            {
              text: 'Proceed with a docs-only strict dogfood execution boundary.',
              rationale: 'Leader input confirms centralized runtime distribution and no CLI fallback.',
            },
          ],
          summary_proposal: {
            summary_markdown:
              'Validate the Superpowers product loop through centralized Codex runtime distribution, using Dockerized app-server workers and no host-local worker configuration.',
            confirmed_scope: ['Boundary Brainstorming, Spec revision, Implementation Plan Doc revision, and Execution are in scope'],
            confirmed_out_of_scope: ['Direct CLI fallback and host-local worker Codex configuration are out of scope'],
            accepted_assumptions: ['The approved Development Plan Item revision remains current'],
            open_risks: ['Generated product text must remain public-safe'],
            validation_expectations: ['Strict dogfood produces a public-safe report and no-shared-filesystem execution evidence'],
          },
          needs_leader_input: false,
          public_summary: 'Boundary Summary proposal generated for Leader approval.',
          artifacts: [],
        }
      : {
          schema_version: 'boundary_round_result.v1',
          session_id: sessionId,
          round_id: roundId,
          questions: [
            {
              text: 'Should the strict dogfood execution stay limited to a docs-only report while preserving centralized Codex runtime distribution?',
              required: true,
              rationale: 'This answer is needed before approving the boundary.',
            },
          ],
          proposed_decisions: [],
          needs_leader_input: true,
          public_summary: 'Boundary round generated a required Leader question.',
          artifacts: [],
        };
    return [
      'Return exactly the JSON object below. Use the concrete id values shown here. Never return placeholder text, null optional objects, Markdown, or extra keys.',
      JSON.stringify(expected, null, 2),
    ].join('\n');
  }
  if (taskKind === 'development_plan_item_spec_revision' || outputSchemaVersion === 'spec_revision.v1') {
    const developmentPlanItemId = contextString(
      context,
      [['development_plan_item', 'id'], ['development_plan_item_id']],
      'development-plan-item-id',
    );
    const boundarySummaryRevisionId = contextString(
      context,
      [
        ['approved_boundary_summary_revision_id'],
        ['boundary_summary_revision_id'],
        ['boundary_brainstorming', 'approved_summary_revision_id'],
        ['context_manifest', 'boundary_summary_revision_id'],
      ],
      'boundary-summary-revision-id',
    );
    return [
      'Return exactly the JSON object below. Use the concrete id values shown here. Do not rewrite field values. Never return placeholder text, null arrays, Markdown fences, or extra keys.',
      JSON.stringify(
        {
          schema_version: 'spec_revision.v1',
          development_plan_item_id: developmentPlanItemId,
          boundary_summary_revision_id: boundarySummaryRevisionId,
          summary: 'Spec for the approved Development Plan Item boundary.',
          content_markdown: '## Spec\n\nDefine the public behavior and acceptance criteria for the approved boundary.',
          problem_context: 'The Development Plan Item needs a product-safe Spec revision derived from the approved boundary.',
          scope_in: ['Generate a Spec revision from the approved Boundary Summary'],
          scope_out: ['Execution work remains outside this Spec revision'],
          acceptance_criteria: ['The Spec revision references the approved Boundary Summary revision'],
          test_strategy: ['Run focused product generation tests'],
          risks: ['Generated content may need reviewer changes'],
          assumptions: ['The approved Boundary Summary is current'],
          unresolved_questions: [],
          public_summary: 'Spec revision generated for reviewer approval.',
        },
        null,
        2,
      ),
    ].join('\n');
  }
  if (taskKind === 'development_plan_item_execution_plan_revision' || outputSchemaVersion === 'execution_plan_revision.v1') {
    const developmentPlanItemId = contextString(
      context,
      [['development_plan_item', 'id'], ['development_plan_item_id']],
      'development-plan-item-id',
    );
    const approvedSpecRevisionId = contextString(
      context,
      [['approved_spec_revision_id'], ['approved_spec_revision', 'id'], ['context_manifest', 'approved_spec_revision_id']],
      'approved-spec-revision-id',
    );
    const allowedPaths = contextStringArray(
      context,
      [['path_policy', 'allowed_paths'], ['execution_plan_path_policy', 'allowed_paths'], ['allowed_paths']],
      ['**'],
    );
    const forbiddenPaths = contextStringArray(
      context,
      [['path_policy', 'forbidden_paths'], ['execution_plan_path_policy', 'forbidden_paths'], ['forbidden_paths']],
      [],
    );
    return [
      'Return exactly the JSON object below. Use the concrete id values shown here. Do not rewrite field values. Never return placeholder text, null arrays, Markdown fences, or extra keys.',
      JSON.stringify(
        {
          schema_version: 'execution_plan_revision.v1',
          development_plan_item_id: developmentPlanItemId,
          based_on_spec_revision_id: approvedSpecRevisionId,
          summary: 'Implementation Plan Doc for the approved Spec revision.',
          content_markdown: '## Implementation Plan Doc\n\nImplement the approved Spec with focused verification.',
          implementation_sequence: ['Update the scoped runtime code path', 'Run focused verification'],
          validation_strategy: ['Run targeted tests and strict dogfood'],
          allowed_paths: allowedPaths,
          forbidden_paths: forbiddenPaths,
          required_checks: [
            {
              check_id: 'focused-tests',
              command: 'pnpm test',
              timeout_seconds: 120,
              blocks_review: true,
            },
          ],
          rollback_notes: 'Revert the scoped changes if validation fails.',
          handoff_criteria: ['All required checks pass'],
          public_summary: 'Implementation Plan Doc revision generated for reviewer signoff.',
        },
        null,
        2,
      ),
    ].join('\n');
  }
  if (taskKind === 'package_drafts' || outputSchemaVersion === 'package_drafts.v1') {
    return 'Return package_drafts.v1 with manifest, packages, dependencies, and optional structured_document fields only.';
  }
  if (taskKind === 'spec_draft' || outputSchemaVersion === 'spec_draft.v1') {
    return 'Return spec_draft.v1 with summary, content, background, goals, scope_in, scope_out, acceptance_criteria, risk_notes, test_strategy_summary, and optional structured_document fields only.';
  }
  if (taskKind === 'plan_draft' || outputSchemaVersion === 'plan_draft.v1') {
    return 'Return plan_draft.v1 with summary, content, implementation_summary, split_strategy, dependency_order, test_matrix, risk_mitigations, rollback_notes, and optional structured_document fields only.';
  }
  return `Return exactly one JSON object for ${outputSchemaVersion}.`;
};

const packageContextOrDefault = (
  context: Record<string, unknown>,
): {
  generation_key: string;
  plan_revision: { id: string; dependency_order: string[] };
  repos: { repo_id: string }[];
} => {
  const generationKey = typeof context.generation_key === 'string' ? context.generation_key : 'default';
  const planRevision =
    context.plan_revision !== null && typeof context.plan_revision === 'object'
      ? (context.plan_revision as Record<string, unknown>)
      : {};
  const dependencyOrder = Array.isArray(planRevision.dependency_order)
    ? planRevision.dependency_order.filter((entry): entry is string => typeof entry === 'string')
    : [];
  const repos = Array.isArray(context.repos)
    ? context.repos
        .filter((entry): entry is Record<string, unknown> => entry !== null && typeof entry === 'object' && !Array.isArray(entry))
        .map((entry) => ({ repo_id: typeof entry.repo_id === 'string' ? entry.repo_id : 'repo-main' }))
    : [{ repo_id: 'repo-main' }];
  return {
    generation_key: generationKey,
    plan_revision: {
      id: typeof planRevision.id === 'string' ? planRevision.id : 'plan-rev-1',
      dependency_order: dependencyOrder,
    },
    repos,
  };
};

const validateAppServerOutput = <TGenerated>(
  validate: (value: unknown) => TGenerated,
  value: unknown,
): TGenerated => {
  try {
    return validate(value);
  } catch {
    throw new Error('generated_output_schema_invalid');
  }
};

const appServerRetryableCodes = new Set<CodexGenerationErrorCode>([
  'codex_app_server_unavailable',
  'codex_generation_timeout',
  'codex_generation_cancelled',
  'codex_generation_concurrency_limit_exceeded',
  'codex_generation_usage_limited',
  'codex_generation_turn_failed',
  'generated_output_invalid_json',
  'generated_output_ambiguous',
  'generated_output_schema_invalid',
]);

const appServerNonRetryableCodes = new Set<CodexGenerationErrorCode>([
  'codex_generation_safety_unavailable',
  'codex_generation_sandbox_invalid',
  'codex_generation_raw_log_too_large',
  'generated_output_too_large',
]);

const isJsonRpcErrorObject = (value: unknown): value is Record<string, unknown> =>
  value !== null &&
  typeof value === 'object' &&
  !(value instanceof Error) &&
  !Array.isArray(value) &&
  (typeof (value as Record<string, unknown>).code === 'number' || typeof (value as Record<string, unknown>).message === 'string');

const toCodexGenerationError = (error: unknown): CodexGenerationError => {
  if (error instanceof CodexGenerationError) {
    return error;
  }
  if (isJsonRpcErrorObject(error)) {
    return new CodexGenerationError('codex_generation_turn_failed', { retryable: true });
  }
  const code = error instanceof Error ? error.message : undefined;
  if (code !== undefined && appServerRetryableCodes.has(code as CodexGenerationErrorCode)) {
    return new CodexGenerationError(code as CodexGenerationErrorCode, { retryable: true });
  }
  if (code !== undefined && appServerNonRetryableCodes.has(code as CodexGenerationErrorCode)) {
    return new CodexGenerationError(code as CodexGenerationErrorCode, { retryable: false });
  }
  return new CodexGenerationError('codex_app_server_unavailable', { retryable: true });
};

export const createCodexGenerationRuntime = (config: CodexGenerationRuntimeConfig): CodexGenerationRuntime => {
  assertPositiveInt('codex_generation_timeout_ms', config.timeoutMs);
  assertPositiveInt('codex_generation_output_limit_bytes', config.outputLimitBytes);
  assertPositiveInt('codex_generation_raw_notification_limit_bytes', config.rawNotificationLimitBytes);
  assertPositiveInt('codex_generation_max_concurrency', config.maxConcurrency);

  let activeGenerations = 0;
  const maxConcurrency = config.maxConcurrency ?? 1;

  const withConcurrency = async <T>(operation: () => Promise<T>): Promise<T> => {
    if (activeGenerations >= maxConcurrency) {
      throw new Error('codex_generation_concurrency_limit_exceeded');
    }
    activeGenerations += 1;
    try {
      return await operation();
    } finally {
      activeGenerations -= 1;
    }
  };

  const generateWithAppServer = async <TGenerated>(
    taskKind: CodexGenerationTaskKind,
    input: CodexGenerationRuntimeTaskInput<Record<string, unknown>>,
    validate: (value: unknown) => TGenerated,
  ): Promise<CodexGenerationResult<TGenerated>> =>
    withConcurrency(async () => {
      const driver = createAppServerGenerationDriver({
        endpoint: config.appServerEndpoint,
        taskKind,
        actionRunId: input.actionRunId,
        projectId: input.projectId,
        repoIds: input.repoIds,
        artifactRoot: config.artifactRoot,
        ...(config.workspaceRoot === undefined ? {} : { workspaceRoot: config.workspaceRoot }),
        policyDigests: input.policyDigests,
        ...(config.timeoutMs === undefined ? {} : { timeoutMs: config.timeoutMs }),
        ...(config.outputLimitBytes === undefined ? {} : { outputLimitBytes: config.outputLimitBytes }),
        ...(config.rawNotificationLimitBytes === undefined ? {} : { rawNotificationLimitBytes: config.rawNotificationLimitBytes }),
        ...(config.transportFactory === undefined ? {} : { transportFactory: config.transportFactory }),
      });
      const output = await driver.generate({
        taskKind,
        prompt: promptFor(taskKind, input),
        outputSchemaVersion: input.outputSchemaVersion,
        contextDigest: input.actionRunId,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
        ...(config.timeoutMs === undefined ? {} : { timeoutMs: config.timeoutMs }),
        ...(config.outputLimitBytes === undefined ? {} : { outputLimitBytes: config.outputLimitBytes }),
        ...(config.rawNotificationLimitBytes === undefined ? {} : { rawNotificationLimitBytes: config.rawNotificationLimitBytes }),
      });
      return {
        taskKind,
        promptVersion: input.promptVersion,
        outputSchemaVersion: input.outputSchemaVersion,
        generated: validateAppServerOutput(validate, output.extractedJson),
        generationArtifacts: output.rawArtifactRefs as CodexGenerationResult<TGenerated>['generationArtifacts'],
        publicSummary: 'Codex app-server draft generated.',
      };
    }).catch((error: unknown) => {
      throw toCodexGenerationError(error);
    });

  if (config.mode === 'fake') {
    return {
      async generateSpecDraft(input) {
        return createFakeSpecDraft(input.context as Parameters<typeof createFakeSpecDraft>[0]);
      },
      async generatePlanDraft(input) {
        return createFakePlanDraft(input.context as Parameters<typeof createFakePlanDraft>[0]);
      },
      async generatePackageDrafts(input) {
        return createFakePackageDraftSet(packageContextOrDefault(input.context)) as CodexGenerationResult<GeneratedPackageDraftSetV1>;
      },
      async generateBoundaryBrainstormingRound(input) {
        return createFakeBoundaryRoundRuntimeResult(input.context);
      },
      async generateDevelopmentPlanItemSpecRevision(input) {
        return createFakeGeneratedSpecRevision(input.context);
      },
      async generateDevelopmentPlanItemExecutionPlanRevision(input) {
        return createFakeGeneratedExecutionPlanRevision(input.context);
      },
    };
  }

  if (config.mode === 'app_server') {
    return {
      generateSpecDraft: (input) => generateWithAppServer('spec_draft', input, validateGeneratedSpecDraft),
      generatePlanDraft: (input) => generateWithAppServer('plan_draft', input, validateGeneratedPlanDraft),
      generatePackageDrafts: (input) => generateWithAppServer('package_drafts', input, validateGeneratedPackageDraftSet),
      generateBoundaryBrainstormingRound: (input) =>
        generateWithAppServer<BoundaryRoundRuntimeResultV1>(
          'boundary_brainstorming_round',
          input,
          validateBoundaryRoundRuntimeResult,
        ),
      generateDevelopmentPlanItemSpecRevision: (input) =>
        generateWithAppServer<GeneratedSpecRevisionV1>(
          'development_plan_item_spec_revision',
          input,
          validateGeneratedSpecRevision,
        ),
      generateDevelopmentPlanItemExecutionPlanRevision: (input) =>
        generateWithAppServer<GeneratedExecutionPlanRevisionV1>(
          'development_plan_item_execution_plan_revision',
          input,
          validateGeneratedExecutionPlanRevision,
        ),
    };
  }

  return {
    async generateSpecDraft() {
      throw new CodexGenerationError('codex_generation_disabled', { retryable: false });
    },
    async generatePlanDraft() {
      throw new CodexGenerationError('codex_generation_disabled', { retryable: false });
    },
    async generatePackageDrafts() {
      throw new CodexGenerationError('codex_generation_disabled', { retryable: false });
    },
    async generateBoundaryBrainstormingRound() {
      throw new CodexGenerationError('codex_generation_disabled', { retryable: false });
    },
    async generateDevelopmentPlanItemSpecRevision() {
      throw new CodexGenerationError('codex_generation_disabled', { retryable: false });
    },
    async generateDevelopmentPlanItemExecutionPlanRevision() {
      throw new CodexGenerationError('codex_generation_disabled', { retryable: false });
    },
  };
};
