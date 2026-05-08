import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Module } from '@nestjs/common';
import type { ExecutorResult, SelfReviewInput, SelfReviewResult } from '@forgeloop/contracts';
import { createDbClient, createDrizzleP0Repository, InMemoryP0Repository, type P0Repository } from '@forgeloop/db';
import {
  captureLocalCodexEvidence,
  CodexAppServerDriver,
  CodexAppServerProcessTransport,
  CodexExecFallbackDriver,
  LocalCodexRawLogStore,
  type LocalCodexEvidenceInput,
} from '@forgeloop/executor';
import { FakeCodexSessionDriver, RunWorker } from '@forgeloop/run-worker';

import { P0Controller } from './p0.controller';
import {
  P0_DEMO_ACTOR_ID_FALLBACK,
  P0_REPOSITORY,
  P0Service,
  RUN_DURABILITY_MODE,
  RUN_WORKER,
  type RunDurabilityMode,
} from './p0.service';
import { RunWorkerLifecycleService } from './run-worker-lifecycle.service';

const safePathSegment = (value: string): string => {
  const sanitized = value
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/\.\.+/g, '-')
    .replace(/^\.+/, '')
    .replace(/^-+|-+$/g, '');

  return sanitized.length > 0 ? sanitized : 'artifact';
};

const evidenceChangedFilePath = (allowedPaths: string[]): string => {
  const firstAllowedPath = allowedPaths[0] ?? 'forgeloop-generated.txt';
  return firstAllowedPath.replace(/\/\*\*$/, '/forgeloop-generated.txt').replace(/\*+$/, 'forgeloop-generated.txt');
};

const mockSelfReview = (input: SelfReviewInput): SelfReviewResult => ({
  status: 'succeeded',
  summary: `Mock self-review completed for run ${input.run_session_id}.`,
  spec_plan_alignment: 'The mock run uses the approved spec and plan revision ids.',
  test_assessment: `${input.check_results.length} required checks were reported.`,
  risk_notes: [],
  follow_up_questions: [],
});

const mockEvidence = (input: LocalCodexEvidenceInput): ExecutorResult => ({
  run_session_id: input.runSpec.run_session_id,
  executor_type: input.runSpec.executor_type,
  executor_version: 'control-plane-fake-driver',
  status: 'succeeded',
  started_at: input.startedAt,
  finished_at: new Date().toISOString(),
  summary: input.summary,
  changed_files: [
    {
      repo_id: input.runSpec.repo.repo_id,
      path: evidenceChangedFilePath(input.runSpec.allowed_paths),
      change_kind: 'modified',
    },
  ],
  checks: input.runSpec.required_checks.map((check) => ({
    check_id: check.check_id,
    command: check.command,
    status: 'succeeded',
    exit_code: 0,
    duration_seconds: 0,
    blocks_review: check.blocks_review,
  })),
  artifacts: [...new Set(input.runSpec.artifact_policy.requested_artifacts)].map((kind) => ({
    kind,
    name: `${kind}.txt`,
    content_type: 'text/plain',
    local_ref: join(input.artifactRoot, safePathSegment(input.runSpec.run_session_id), `${kind}.txt`),
  })),
  raw_metadata: { workflow_only: input.runSpec.workflow_only },
});

const createRepository = (): P0Repository => {
  const databaseUrl = process.env.FORGELOOP_DATABASE_URL;
  if (databaseUrl !== undefined && databaseUrl.trim().length > 0) {
    return createDrizzleP0Repository(createDbClient({ connectionString: databaseUrl }).db);
  }

  return new InMemoryP0Repository();
};

const createRunWorker = (repository: P0Repository): RunWorker => {
  const artifactRoot = process.env.FORGELOOP_EXECUTOR_ARTIFACT_ROOT ?? join(tmpdir(), 'forgeloop-executor-artifacts');
  const rawLogStore = new LocalCodexRawLogStore({ artifactRoot: join(artifactRoot, 'raw-logs') });

  return new RunWorker({
    repository,
    workerId: process.env.FORGELOOP_RUN_WORKER_ID ?? 'control-plane-api-worker',
    driverFactory: ({ runSession }) => {
      const runSpec = runSession.run_spec;
      if (runSpec?.executor_type === 'local_codex' && runSpec.workflow_only !== true) {
        return new CodexAppServerDriver({
          transport: new CodexAppServerProcessTransport(),
          rawLogStore,
        });
      }

      return new FakeCodexSessionDriver({
        kind: 'fake',
        script: [{ kind: 'terminal', status: 'succeeded', summary: 'Fake run completed.' }],
      });
    },
    execFallbackDriverFactory: () => new CodexExecFallbackDriver({ rawLogStore }),
    evidenceCollector: (input) =>
      input.runSpec.executor_type === 'local_codex' && input.runSpec.workflow_only !== true
        ? captureLocalCodexEvidence(input)
        : Promise.resolve(mockEvidence(input)),
    selfReview: (input) => Promise.resolve(mockSelfReview(input)),
    artifactRoot,
  });
};

const durabilityMode = (): RunDurabilityMode =>
  process.env.FORGELOOP_DATABASE_URL === undefined || process.env.FORGELOOP_DATABASE_URL.trim().length === 0
    ? 'volatile_demo'
    : 'durable';

@Module({
  controllers: [P0Controller],
  providers: [
    { provide: P0_REPOSITORY, useFactory: createRepository },
    { provide: RUN_DURABILITY_MODE, useFactory: durabilityMode },
    {
      provide: P0_DEMO_ACTOR_ID_FALLBACK,
      useFactory: (mode: RunDurabilityMode) => mode === 'volatile_demo',
      inject: [RUN_DURABILITY_MODE],
    },
    {
      provide: RUN_WORKER,
      useFactory: createRunWorker,
      inject: [P0_REPOSITORY],
    },
    P0Service,
    RunWorkerLifecycleService,
  ],
})
export class P0Module {}
