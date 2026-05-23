import { AppServerGenerationDriver } from './app-server-generation-driver.js';
import { CodexAppServerEndpointTransport } from './app-server-endpoint-transport.js';
import type { CodexAppServerTransport } from './app-server-protocol.js';
import {
  createFakePackageDraftSet,
  createFakePlanDraft,
  createFakeSpecDraft,
} from './fake-driver.js';
import { createCodexGenerationRuntimeSafety } from './generation-safety-factory.js';
import {
  validateGeneratedPackageDraftSet,
  validateGeneratedPlanDraft,
  validateGeneratedSpecDraft,
} from './payloads.js';
import type {
  CodexGenerationDriverMode,
  CodexGenerationResult,
  CodexGenerationRuntime,
  CodexGenerationRuntimeTaskInput,
  CodexGenerationTaskKind,
  GeneratedPackageDraftSetV1,
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
): string =>
  JSON.stringify({
    task_kind: taskKind,
    prompt_version: input.promptVersion,
    output_schema_version: input.outputSchemaVersion,
    context: input.context,
  });

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

const toCodexGenerationError = (error: unknown): CodexGenerationError => {
  if (error instanceof CodexGenerationError) {
    return error;
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
    };
  }

  if (config.mode === 'app_server') {
    return {
      generateSpecDraft: (input) => generateWithAppServer('spec_draft', input, validateGeneratedSpecDraft),
      generatePlanDraft: (input) => generateWithAppServer('plan_draft', input, validateGeneratedPlanDraft),
      generatePackageDrafts: (input) => generateWithAppServer('package_drafts', input, validateGeneratedPackageDraftSet),
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
  };
};
