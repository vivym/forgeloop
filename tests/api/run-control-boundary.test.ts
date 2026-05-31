import { readFileSync } from 'node:fs';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';

import { AppModule } from '../../apps/control-plane-api/src/app.module';
import { INTERNAL_ARTIFACT_STORE_ROOT } from '../../apps/control-plane-api/src/modules/core/control-plane-tokens';
import { DELIVERY_RUN_WORKER } from '../../apps/control-plane-api/src/modules/run-control/run-worker.token';

describe('RunControl boundary', () => {
  it('provides the run worker through the delivery run-control token', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DELIVERY_RUN_WORKER)
      .useValue({ kick: () => undefined, drainOnce: async () => undefined })
      .compile();

    expect(moduleRef.get(DELIVERY_RUN_WORKER)).toBeDefined();
  });

  it('keeps run, rerun, and force-rerun package routes outside the old namespace', async () => {
    const routes = readFileSync('apps/control-plane-api/src/modules/run-control/execution-package-runs.controller.ts', 'utf8');
    expect(routes).toContain("@Post('execution-packages/:packageId/run')");
    expect(routes).toContain("@Post('execution-packages/:packageId/rerun')");
    expect(routes).toContain("@Post('execution-packages/:packageId/force-rerun')");
    expect(routes).not.toContain("@Controller('" + 'p' + '0');
  });

  it('delegates review packet archiving and trace best-effort handling to review evidence', () => {
    const service = readFileSync('apps/control-plane-api/src/modules/run-control/run-control.service.ts', 'utf8');

    expect(service).toContain('ReviewEvidenceService');
    expect(service).toContain('reviewEvidenceService.archiveReviewPacket');
    expect(service).toContain('reviewEvidenceService.bestEffortTraceWrite');
    expect(service).not.toContain('private async archiveReviewPacket');
    expect(service).not.toContain('private async bestEffortTraceWrite');
    expect(service).not.toContain('transitionReviewPacket');
  });

  it('wires remote outbound Codex run execution without host exec fallback', () => {
    const moduleSource = readFileSync('apps/control-plane-api/src/modules/run-control/run-control.module.ts', 'utf8');
    const remoteClientSource = moduleSource.slice(
      moduleSource.indexOf('const createRemoteRunExecutionClient ='),
      moduleSource.indexOf('const createRunWorker ='),
    );

    expect(moduleSource).toContain("raw === 'remote_outbound'");
    expect(moduleSource).toContain('createRemoteRunExecutionClient');
    expect(moduleSource).toContain('FORGELOOP_CODEX_REMOTE_RUNTIME_JOB_WAIT_TIMEOUT_MS');
    expect(moduleSource).toContain('remoteRunExecutionClient: remoteRunExecution.client');
    expect(moduleSource).toContain('remoteRunExecutionWaitTimeoutMs: remoteRunExecution.waitTimeoutMs');
    expect(moduleSource).toContain("allowExecFallback: runWorkerMode === 'disabled'");
    expect(moduleSource).toContain('internalArtifactStoreRoot: string');
    expect(moduleSource).toContain('internalArtifactStoreRoot,');
    expect(moduleSource).toContain('INTERNAL_ARTIFACT_STORE_ROOT');
    expect(moduleSource).toContain(
      'inject: [DELIVERY_REPOSITORY, CodexRuntimeService, RunExecutionRuntimeConfigService, INTERNAL_ARTIFACT_STORE_ROOT]',
    );
    expect(moduleSource).toContain('globalCodexWorkerMode !== undefined &&');
    expect(moduleSource).toContain("globalCodexWorkerMode === 'local_docker'");
    expect(moduleSource).toContain("globalCodexWorkerMode === 'remote_outbound'");
    expect(moduleSource).toContain('FORGELOOP_CODEX_WORKER_MODE must be disabled, local_docker, or remote_outbound');
    expect(moduleSource).not.toContain('explicitRunWorkerMode === undefined && globalCodexWorkerMode !== undefined');
    expect(moduleSource).not.toContain("?? optionalEnv('FORGELOOP_CODEX_WORKER_MODE') ?? 'disabled'");
    expect(moduleSource).not.toContain('launchSelection()');
    expect(remoteClientSource).toContain('runExecutionRuntimeConfig.selection()');
  });

  it('does not bypass the configured internal artifact store root when wiring the run worker', () => {
    const moduleSource = readFileSync('apps/control-plane-api/src/modules/run-control/run-control.module.ts', 'utf8');

    expect(INTERNAL_ARTIFACT_STORE_ROOT).toBeDefined();
    expect(moduleSource).not.toContain('createRunWorker(repository, codexRuntimeService, runExecutionRuntimeConfig)');
  });
});
