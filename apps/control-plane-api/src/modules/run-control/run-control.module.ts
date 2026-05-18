import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Module } from '@nestjs/common';
import type { ExecutorResult, SelfReviewInput, SelfReviewResult } from '@forgeloop/contracts';
import type { DeliveryRepository } from '@forgeloop/db';
import type { RunRuntimeMetadata, RunSession } from '@forgeloop/domain';
import {
  captureLocalCodexEvidence,
  CodexExecFallbackDriver,
  createLocalCodexRuntimeSafety,
  LocalCodexRawLogStore,
  parseExecutorRuntimeSafetyConfigFromEnv,
  type CodexDriverStartInput,
  type CodexDriverStreamItem,
  type CodexSessionDriver,
  type LocalCodexEvidenceInput,
  type LocalCodexRuntimeSafety,
} from '@forgeloop/executor';
import { FakeCodexSessionDriver, RunWorker } from '@forgeloop/run-worker';

import { AuditModule } from '../audit/audit.module';
import { ControlPlaneCoreModule } from '../core/control-plane-core.module';
import { DELIVERY_REPOSITORY } from '../core/control-plane-tokens';
import { ExecutionPackagesModule } from '../execution-packages/execution-packages.module';
import { ReviewEvidenceModule } from '../review-evidence/review-evidence.module';
import { ExecutionPackageRunsController } from './execution-package-runs.controller';
import { RunControlService } from './run-control.service';
import { RunSessionsController } from './run-sessions.controller';
import { RunWorkerLifecycleService } from './run-worker-lifecycle.service';
import { DELIVERY_RUN_WORKER } from './run-worker.token';

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

class AppServerGovernorUnavailableDriver implements CodexSessionDriver {
  readonly kind = 'app_server' as const;

  async *startRun(): AsyncIterable<CodexDriverStreamItem> {
    yield this.fallbackEvent('Codex app-server direct process transport is disabled until it can run under the runtime governor.');
  }

  async *resumeRun(): AsyncIterable<CodexDriverStreamItem> {
    yield this.fallbackEvent('Codex app-server resume is disabled until it can run under the runtime governor.');
  }

  async sendInput(): Promise<Record<string, unknown>> {
    return { acknowledged: false, reason: 'app_server_governor_unavailable' };
  }

  async cancelRun(): Promise<Record<string, unknown>> {
    return { acknowledged: false, reason: 'app_server_governor_unavailable' };
  }

  private fallbackEvent(summary: string): CodexDriverStreamItem {
    return {
      kind: 'event',
      event: {
        event_type: 'driver_fallback_used',
        source: 'executor',
        visibility: 'public',
        summary,
        payload: { reason: 'primary_executor_governor_unavailable' },
      },
      runtimeMetadata: {
        driver_kind: 'exec_fallback',
        driver_status: 'starting',
      },
    };
  }
}

const runtimeSafetyForRun = async (
  repository: DeliveryRepository,
  input: {
    runSpec: CodexDriverStartInput['runSpec'];
    workspacePath: string;
    artifactRoot: string;
  },
): Promise<LocalCodexRuntimeSafety> => {
  const runSpec = input.runSpec;
  const executionPackage = await repository.getExecutionPackage(runSpec.execution_package_id);
  if (executionPackage?.package_policy_snapshot === undefined) {
    throw new Error('policy_snapshot_missing: local_codex requires a captured package policy snapshot.');
  }
  const parseResult = parseExecutorRuntimeSafetyConfigFromEnv(process.env, {
    workspaceRoot: input.workspacePath,
    tempRoot: tmpdir(),
    packageControlledPaths: [runSpec.repo.local_path],
  });
  if (parseResult.status !== 'available') {
    const details =
      parseResult.status === 'unavailable'
        ? parseResult.missing_keys.join(',')
        : parseResult.diagnostics.map((diagnostic) => diagnostic.message).join('; ');
    throw new Error(`${parseResult.reason_code}: ${details}`);
  }
  return createLocalCodexRuntimeSafety({
    runSpec,
    runtimeConfig: parseResult.config,
    frozenSnapshot: executionPackage.package_policy_snapshot,
    workspaceRoot: input.workspacePath,
    artifactRoot: join(input.artifactRoot, safePathSegment(runSpec.run_session_id)),
  });
};

class GovernedCodexDriver implements CodexSessionDriver {
  readonly kind: 'app_server' | 'exec_fallback';
  #inner: CodexSessionDriver | undefined;

  constructor(
    private readonly input: {
      kind: 'app_server' | 'exec_fallback';
      repository: DeliveryRepository;
      runSession: RunSession;
      rawLogStore: LocalCodexRawLogStore;
      artifactRoot: string;
      workerId: string;
    },
  ) {
    this.kind = input.kind;
  }

  async *startRun(input: CodexDriverStartInput): AsyncIterable<CodexDriverStreamItem> {
    const driver = await this.innerDriver(input);
    yield* driver.startRun(input);
  }

  async *resumeRun(input: CodexDriverStartInput): AsyncIterable<CodexDriverStreamItem> {
    const driver = await this.innerDriver(input);
    yield* driver.resumeRun(input);
  }

  async sendInput(input: {
    message: string;
    runtimeMetadata: RunRuntimeMetadata;
    targetTurnId?: string;
  }): Promise<Record<string, unknown>> {
    if (this.#inner === undefined) {
      throw new Error('Cannot send input before the governed Codex driver has started.');
    }
    return this.#inner.sendInput(input);
  }

  async cancelRun(input: { runtimeMetadata: RunRuntimeMetadata }): Promise<Record<string, unknown>> {
    if (this.#inner === undefined) {
      return { acknowledged: false, reason: 'driver_not_started' };
    }
    return this.#inner.cancelRun(input);
  }

  async close(): Promise<void> {
    await this.#inner?.close?.();
  }

  private async innerDriver(input: CodexDriverStartInput): Promise<CodexSessionDriver> {
    if (this.#inner !== undefined) {
      return this.#inner;
    }
    const runtimeSafety = await runtimeSafetyForRun(this.input.repository, {
      runSpec: input.runSpec,
      workspacePath: input.workspacePath,
      artifactRoot: this.input.artifactRoot,
    });
    this.#inner =
      this.kind === 'app_server'
        ? new AppServerGovernorUnavailableDriver()
        : new CodexExecFallbackDriver({ runtimeSafety });
    return this.#inner;
  }
}

const createRunWorker = (repository: DeliveryRepository): RunWorker => {
  const artifactRoot = process.env.FORGELOOP_EXECUTOR_ARTIFACT_ROOT ?? join(tmpdir(), 'forgeloop-executor-artifacts');
  mkdirSync(artifactRoot, { recursive: true });
  const rawLogStore = new LocalCodexRawLogStore({ artifactRoot: join(artifactRoot, 'raw-logs') });

  return new RunWorker({
    repository,
    workerId: process.env.FORGELOOP_RUN_WORKER_ID ?? 'control-plane-api-worker',
    driverFactory: ({ runSession }) => {
      const runSpec = runSession.run_spec;
      if (runSpec?.executor_type === 'local_codex' && runSpec.workflow_only !== true) {
        return new GovernedCodexDriver({
          kind: 'app_server',
          repository,
          rawLogStore,
          artifactRoot,
          runSession,
          workerId: process.env.FORGELOOP_RUN_WORKER_ID ?? 'control-plane-api-worker',
        });
      }

      return new FakeCodexSessionDriver({
        kind: 'fake',
        script: [{ kind: 'terminal', status: 'succeeded', summary: 'Fake run completed.' }],
      });
    },
    execFallbackDriverFactory: ({ runSession }) =>
      new GovernedCodexDriver({
        kind: 'exec_fallback',
        repository,
        rawLogStore,
        artifactRoot,
        runSession,
        workerId: process.env.FORGELOOP_RUN_WORKER_ID ?? 'control-plane-api-worker',
      }),
    evidenceCollector: (input) =>
      input.runSpec.executor_type === 'local_codex' && input.runSpec.workflow_only !== true
        ? runtimeSafetyForRun(repository, {
            runSpec: input.runSpec,
            workspacePath: input.workspacePath,
            artifactRoot,
          }).then((runtimeSafety) => captureLocalCodexEvidence({ ...input, runtimeSafety }))
        : Promise.resolve(mockEvidence(input)),
    selfReview: (input) => Promise.resolve(mockSelfReview(input)),
    artifactRoot,
  });
};

@Module({
  imports: [ControlPlaneCoreModule, AuditModule, ExecutionPackagesModule, ReviewEvidenceModule],
  controllers: [ExecutionPackageRunsController, RunSessionsController],
  providers: [
    {
      provide: DELIVERY_RUN_WORKER,
      useFactory: createRunWorker,
      inject: [DELIVERY_REPOSITORY],
    },
    RunControlService,
    RunWorkerLifecycleService,
  ],
  exports: [DELIVERY_RUN_WORKER, RunControlService, RunWorkerLifecycleService],
})
export class RunControlModule {}
