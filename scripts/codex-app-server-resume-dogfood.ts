import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createCodexGenerationRuntime,
  type CodexGenerationResult,
  type CodexGenerationRuntimeTaskInput,
} from '../packages/codex-runtime/src/index';
import { codexCanonicalDigest, type CodexSessionRuntimeContextV1 } from '../packages/domain/src/index';

export const codexAppServerResumeDogfoodCommand =
  'tsx --tsconfig apps/control-plane-api/tsconfig.json scripts/codex-app-server-resume-dogfood.ts';

export const codexAppServerResumeDogfoodSkipMessage =
  'SKIP codex app-server resume dogfood: set FORGELOOP_CODEX_APP_SERVER_RESUME_DOGFOOD=1';

export const codexAppServerResumeDogfoodReportPath = 'test-results/codex-app-server-resume-dogfood.json';

type DogfoodStatus = 'passed' | 'failed' | 'skipped';
type DogfoodStage = 'brainstorming_follow_up' | 'spec_generation' | 'implementation_plan_generation';

export interface CodexAppServerResumeDogfoodReport {
  status: DogfoodStatus;
  codex_session_id: string;
  codex_thread_id_digest?: string;
  thread_start_count: number;
  thread_resume_count: number;
  replacement_thread_start_count: number;
  blocker_codes: string[];
  report_generated_at: string;
}

type EnvLike = Record<string, string | undefined>;
type Sha256Digest = `sha256:${string}`;

const unsafeReportFragments = [
  '"codex_thread_id"',
  'thread-raw',
  'prompt transcript',
  'OPENAI_API_KEY',
  'Bearer ',
  'auth.json',
  'config.toml',
  'docker-exec:',
  'localhost',
  '127.0.0.1',
  '/Users/',
];

const nowIso = (): string => new Date().toISOString();

const dogfoodDigest = (value: unknown): Sha256Digest => codexCanonicalDigest(value) as Sha256Digest;

export const assertCodexAppServerResumeDogfoodReportSafe = (report: CodexAppServerResumeDogfoodReport): void => {
  const encoded = JSON.stringify(report);
  const unsafeFragment = unsafeReportFragments.find((fragment) => encoded.includes(fragment));
  if (unsafeFragment !== undefined) {
    throw new Error(`codex_app_server_resume_dogfood_report_unsafe:${unsafeFragment}`);
  }
  if (report.codex_thread_id_digest !== undefined && !/^sha256:[a-f0-9]{64}$/.test(report.codex_thread_id_digest)) {
    throw new Error('codex_app_server_resume_dogfood_report_unsafe:codex_thread_id_digest');
  }
};

export const renderCodexAppServerResumeDogfoodReport = (
  report: CodexAppServerResumeDogfoodReport,
): string => {
  assertCodexAppServerResumeDogfoodReportSafe(report);
  return `${JSON.stringify(report, null, 2)}\n`;
};

export const writeCodexAppServerResumeDogfoodReport = async (
  report: CodexAppServerResumeDogfoodReport,
  path = codexAppServerResumeDogfoodReportPath,
): Promise<void> => {
  const absolutePath = resolve(path);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, renderCodexAppServerResumeDogfoodReport(report), 'utf8');
};

export const skippedCodexAppServerResumeDogfoodReport = (generatedAt = nowIso()): CodexAppServerResumeDogfoodReport => ({
  status: 'skipped',
  codex_session_id: 'codex-session-resume-dogfood-skipped',
  thread_start_count: 0,
  thread_resume_count: 0,
  replacement_thread_start_count: 0,
  blocker_codes: ['codex_app_server_resume_dogfood_disabled'],
  report_generated_at: generatedAt,
});

const failedCodexAppServerResumeDogfoodReport = (
  blockerCode: string,
  generatedAt = nowIso(),
): CodexAppServerResumeDogfoodReport => ({
  status: 'failed',
  codex_session_id: 'codex-session-resume-dogfood',
  thread_start_count: 0,
  thread_resume_count: 0,
  replacement_thread_start_count: 0,
  blocker_codes: [blockerCode],
  report_generated_at: generatedAt,
});

type CountedResult<T> = CodexGenerationResult<T> & {
  codexThread: NonNullable<CodexGenerationResult<T>['codexThread']>;
};

const requireThreadResult = <T>(stage: DogfoodStage, result: CodexGenerationResult<T>): CountedResult<T> => {
  if (result.codexThread === undefined) {
    throw new Error(`codex_app_server_resume_dogfood_missing_thread:${stage}`);
  }
  return result as CountedResult<T>;
};

const baseGenerationInput = (
  runtimeContext: CodexSessionRuntimeContextV1,
  outputSchemaVersion: string,
): CodexGenerationRuntimeTaskInput<Record<string, unknown>> => ({
  actionRunId: `dogfood-${runtimeContext.codex_session_turn_id}`,
  projectId: 'dogfood-project',
  repoIds: ['dogfood-repo'],
  context: {
    dogfood_stage: runtimeContext.codex_session_turn_id,
    development_plan_item_id: 'dogfood-plan-item',
    boundary_summary_revision_id: 'dogfood-boundary-summary',
    approved_spec_revision_id: 'dogfood-spec-revision',
    session_id: 'dogfood-boundary-session',
    round_id: 'dogfood-round',
  },
  promptVersion: `dogfood-${outputSchemaVersion}`,
  outputSchemaVersion,
  policyDigests: {},
  codexSessionRuntimeContext: runtimeContext,
});

export const runCodexAppServerResumeDogfood = async (env: EnvLike = process.env): Promise<CodexAppServerResumeDogfoodReport> => {
  if (env.FORGELOOP_CODEX_APP_SERVER_RESUME_DOGFOOD !== '1') {
    return skippedCodexAppServerResumeDogfoodReport();
  }
  const endpoint = env.FORGELOOP_CODEX_APP_SERVER_ENDPOINT?.trim();
  if (endpoint === undefined || endpoint.length === 0) {
    return failedCodexAppServerResumeDogfoodReport('codex_app_server_resume_dogfood_endpoint_missing');
  }

  const codexSessionId = 'codex-session-resume-dogfood';
  const runtime = createCodexGenerationRuntime({
    mode: 'app_server',
    appServerEndpoint: endpoint,
    timeoutMs: Number(env.FORGELOOP_CODEX_APP_SERVER_RESUME_DOGFOOD_TIMEOUT_MS ?? 120_000),
    outputLimitBytes: 250_000,
    rawNotificationLimitBytes: 250_000,
    maxConcurrency: 1,
  });

  const startContext: CodexSessionRuntimeContextV1 = {
    schema_version: 'codex_session_runtime_context.v1',
    codex_session_id: codexSessionId,
    codex_session_turn_id: 'brainstorming-follow-up',
    lease_id: 'dogfood-lease-1',
    lease_epoch: 1,
    worker_id: 'dogfood-worker',
    worker_session_digest: dogfoodDigest({ worker: 'dogfood-worker' }),
    turn_group_status: 'intermediate',
    continuation: { kind: 'start_thread' },
  };
  const first = requireThreadResult(
    'brainstorming_follow_up',
    await runtime.generateBoundaryBrainstormingRound(baseGenerationInput(startContext, 'boundary_round_result.v1')),
  );
  const thread = first.codexThread;

  const specContext: CodexSessionRuntimeContextV1 = {
    ...startContext,
    codex_session_turn_id: 'spec-generation',
    lease_id: 'dogfood-lease-2',
    lease_epoch: 2,
    runner_runtime_job_id: 'dogfood-runner-runtime-job',
    runner_launch_lease_id: 'dogfood-runner-launch-lease',
    continuation: {
      kind: 'resume_thread',
      codex_thread_id: thread.codex_thread_id,
      codex_thread_id_digest: thread.codex_thread_id_digest,
    },
  };
  const spec = requireThreadResult(
    'spec_generation',
    await runtime.generateDevelopmentPlanItemSpecRevision(baseGenerationInput(specContext, 'spec_revision.v1')),
  );

  const planContext: CodexSessionRuntimeContextV1 = {
    ...specContext,
    codex_session_turn_id: 'implementation-plan-generation',
    lease_id: 'dogfood-lease-3',
    lease_epoch: 3,
    turn_group_status: 'complete',
  };
  const plan = requireThreadResult(
    'implementation_plan_generation',
    await runtime.generateDevelopmentPlanItemExecutionPlanRevision(baseGenerationInput(planContext, 'execution_plan_revision.v1')),
  );

  const stableDigest =
    thread.codex_thread_id_digest === spec.codexThread.codex_thread_id_digest &&
    thread.codex_thread_id_digest === plan.codexThread.codex_thread_id_digest;
  const blockerCodes = stableDigest ? [] : ['codex_app_server_resume_dogfood_thread_digest_changed'];
  const report: CodexAppServerResumeDogfoodReport = {
    status: blockerCodes.length === 0 ? 'passed' : 'failed',
    codex_session_id: codexSessionId,
    codex_thread_id_digest: thread.codex_thread_id_digest,
    thread_start_count: 1,
    thread_resume_count: 2,
    replacement_thread_start_count: 0,
    blocker_codes: blockerCodes,
    report_generated_at: nowIso(),
  };
  assertCodexAppServerResumeDogfoodReportSafe(report);
  return report;
};

export const codexAppServerResumeDogfoodMain = async (env: EnvLike = process.env): Promise<number> => {
  const report = await runCodexAppServerResumeDogfood(env);
  await writeCodexAppServerResumeDogfoodReport(report);
  if (report.status === 'skipped') {
    console.log(codexAppServerResumeDogfoodSkipMessage);
    return 0;
  }
  console.log(renderCodexAppServerResumeDogfoodReport(report).trim());
  return report.status === 'passed' ? 0 : 1;
};

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exitCode = await codexAppServerResumeDogfoodMain();
}
