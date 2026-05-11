import { createServer } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { describe, expect, it, vi } from 'vitest';
import { InMemoryP0Repository } from '../../packages/db/src';
import { deriveReleaseBlockers } from '../../packages/domain/src';
import type { Decision, ExecutionPackage, Release, ReleaseEvidence, ReviewPacket, RunSession, WorkItem } from '../../packages/domain/src';

import { AppModule } from '../../apps/control-plane-api/src/app.module';
import {
  P0_DEMO_ACTOR_ID_FALLBACK,
  P0_REPOSITORY,
  RUN_DURABILITY_MODE,
  RUN_WORKER,
} from '../../apps/control-plane-api/src/p0/p0.service';
import {
  assertNoUnsafeReleaseDogfoodStrings,
  buildDurableReleaseDogfoodIdentity,
  buildReleaseLocalCodexPackageInput,
  buildReleaseStrictObservationLinks,
  failedReleaseFlowMarkersFromError,
  planStrictReleaseDogfoodDatabase,
  pollStrictLocalCodexRunToTerminal,
  publicStrictLocalCodexEvidenceSummary,
  renderReleaseFlowVerificationReport,
  requiredReleaseFlowReportMarkers,
  runDurableReleaseLifecycle,
  runStrictReleaseFlowDogfood,
  seedDurableReleaseReadyPackageEvidence,
  shouldAttemptReleaseStrictLocalCodex,
  statusCodeForStrictReleaseMarkers,
  strictReleaseClosureMarkers,
  verifyDurableReleaseAfterReopen,
} from '../../scripts/dogfood/release-flow-core';
import { requiredReleaseFlowReportMarkers as wrapperRequiredReleaseFlowReportMarkers } from '../../scripts/release-flow-dogfood';

describe('release flow dogfood script helpers', () => {
  const createDurableTestApp = async (repository: InMemoryP0Repository): Promise<INestApplication> => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(P0_REPOSITORY)
      .useValue(repository)
      .overrideProvider(RUN_WORKER)
      .useValue({ kick: () => undefined, drainOnce: async () => undefined })
      .overrideProvider(RUN_DURABILITY_MODE)
      .useValue('durable')
      .overrideProvider(P0_DEMO_ACTOR_ID_FALLBACK)
      .useValue(false)
      .compile();
    const app = moduleRef.createNestApplication({ logger: false });
    app.useLogger(false);
    await app.init();
    return app;
  };

  it('exports the exact required verification report markers', () => {
    expect(requiredReleaseFlowReportMarkers).toEqual([
      'P0 delivery path',
      'Release create/link/submit',
      'Release approval or override approval',
      'Release observing/close',
      'Release cockpit query',
      'Release replay redaction',
      'Release observation backlink projection',
      'Durable local reset',
      'Strict local_codex run',
    ]);
    expect(wrapperRequiredReleaseFlowReportMarkers).toEqual(requiredReleaseFlowReportMarkers);
  });

  it('defines the strict closure markers separately from all required report markers', () => {
    expect(strictReleaseClosureMarkers).toEqual(['Durable local reset', 'Strict local_codex run']);
  });

  it('builds UUID durable identity seed records', () => {
    const seed = buildDurableReleaseDogfoodIdentity('2026-05-11T00:00:00.000Z');

    expect(seed.organization.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(seed.actors.owner.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(seed.actors.reviewer.org_id).toBe(seed.organization.id);
    expect(seed.project.org_id).toBe(seed.organization.id);
    expect(seed.project.owner_actor_id).toBe(seed.actors.owner.id);
  });

  it('uses contract-allowed relationships for strict local Codex observation links', () => {
    expect(
      buildReleaseStrictObservationLinks({
        releaseId: 'release-1',
        executionPackageId: 'package-1',
        runSessionId: 'run-1',
      }),
    ).toEqual([
      { object_type: 'release', object_id: 'release-1', relationship: 'observed' },
      { object_type: 'execution_package', object_id: 'package-1', relationship: 'supports' },
      { object_type: 'run_session', object_id: 'run-1', relationship: 'generated_by' },
    ]);
  });

  it('summarizes strict local Codex evidence without local paths or runtime metadata', () => {
    const summary = publicStrictLocalCodexEvidenceSummary({
      runSessionId: 'run-1',
      changedFileCount: 1,
      checkCount: 1,
      artifactKinds: ['execution_summary', 'review_packet'],
      reviewPacketAvailable: true,
    });

    expect(JSON.stringify(summary)).not.toContain('/Users/');
    expect(JSON.stringify(summary)).not.toContain('runtime_metadata');
    expect(summary).toEqual({
      run_session_id: 'run-1',
      changed_file_count: 1,
      check_count: 1,
      artifact_kinds: ['execution_summary', 'review_packet'],
      review_packet_available: true,
    });
  });

  it('requires explicit real local Codex enablement before strict package execution', () => {
    expect(shouldAttemptReleaseStrictLocalCodex({})).toBe(false);
    expect(shouldAttemptReleaseStrictLocalCodex({ FORGELOOP_ENABLE_REAL_CODEX_DOGFOOD: '1' })).toBe(true);
  });

  it('builds a bounded release local Codex package input', () => {
    expect(
      buildReleaseLocalCodexPackageInput({
        repoPath: '/repo',
        baseCommitSha: 'abc123',
        actorOwner: 'actor-owner',
        actorReviewer: 'actor-reviewer',
        actorQa: 'actor-qa',
      }),
    ).toEqual({
      repo_id: 'forgeloop-source',
      objective: 'Append a short Release strict dogfood marker line to README.md only. Do not edit files outside README.md.',
      owner_actor_id: 'actor-owner',
      reviewer_actor_id: 'actor-reviewer',
      qa_owner_actor_id: 'actor-qa',
      required_checks: [
        {
          check_id: 'release-strict-local-codex',
          display_name: 'Release strict local Codex required check',
          command: 'node -e "process.exit(0)"',
          timeout_seconds: 30,
          blocks_review: true,
        },
      ],
      required_artifact_kinds: ['execution_summary', 'diff', 'changed_files', 'check_output', 'review_packet'],
      allowed_paths: ['README.md'],
      forbidden_paths: ['.git', '.env', 'node_modules'],
    });
  });

  it('times out bounded strict local Codex polling instead of passing queued runs', async () => {
    await expect(
      pollStrictLocalCodexRunToTerminal({
        getRunSession: async () => ({ id: 'run-1', status: 'queued' }),
        getPublicRunEvents: async () => [{ event_type: 'run_queued', visibility: 'public' }],
        timeoutMs: 1,
        intervalMs: 1,
      }),
    ).rejects.toThrow(/local_codex_run_terminal_timeout/);
  });

  it('does not treat queue events as strict local Codex live progress', async () => {
    await expect(
      pollStrictLocalCodexRunToTerminal({
        getRunSession: async () => ({ id: 'run-1', status: 'succeeded' }),
        getPublicRunEvents: async () => [{ event_type: 'run_queued', visibility: 'public' }],
        timeoutMs: 1,
        intervalMs: 1,
      }).then((result) => {
        if (result.observedPublicNonTerminalEvent) {
          throw new Error('run_queued counted as live progress');
        }
      }),
    ).resolves.toBeUndefined();
  });

  it('returns non-zero for blocked strict markers unless blocked report generation is allowed', () => {
    const markers = requiredReleaseFlowReportMarkers.map((marker) => ({
      marker,
      status: marker === 'Strict local_codex run' ? ('BLOCKED with reason' as const) : ('PASSED' as const),
      details: ['safe'],
    }));

    expect(statusCodeForStrictReleaseMarkers(markers, { allowBlocked: false })).toBe(1);
    expect(statusCodeForStrictReleaseMarkers(markers, { allowBlocked: true })).toBe(0);
  });

  it('renders safe failed markers from strict runner errors', () => {
    const markers = failedReleaseFlowMarkersFromError(new Error('postgresql://user:secret@localhost/db failed in /Users/viv/repo'));

    expect(markers).toHaveLength(requiredReleaseFlowReportMarkers.length);
    expect(markers.find((marker) => marker.marker === 'Durable local reset')).toMatchObject({
      status: 'FAILED',
      details: expect.arrayContaining(['strict_flow_failed']),
    });
    expect(() => assertNoUnsafeReleaseDogfoodStrings('strict failure markers', markers)).not.toThrow();
  });

  it('does not preflight or create a strict local Codex package unless explicitly enabled', async () => {
    const preflightStrictLocalCodex = vi.fn();
    const runStrictLocalCodexPackage = vi.fn();

    const markers = await runStrictReleaseFlowDogfood({
      env: { FORGELOOP_DATABASE_URL: 'postgresql://safe.local/forgeloop_tmp_dogfood_test' },
      deps: {
        nowMs: () => 1,
        planDatabase: () => ({
          kind: 'provided',
          databaseUrl: 'postgresql://safe.local/forgeloop_tmp_dogfood_test',
          adminUrl: 'postgresql://safe.local/forgeloop_tmp_dogfood_test',
          databaseName: 'forgeloop_tmp_dogfood_test',
          cleanup: { dropDatabase: false, removeContainer: false },
        }),
        prepareSafeDatabaseTarget: () => undefined,
        createDatabase: async () => undefined,
        pushSchema: async () => undefined,
        resetDatabase: async () => undefined,
        createDbClient: () => ({ db: {}, pool: { end: async () => undefined } }),
        createRepository: () => new InMemoryP0Repository(),
        createDurableApp: async () => ({ app: { close: async () => undefined } }),
        runDurableReleaseLifecycle: async ({ env, deps }) => {
          expect(env.FORGELOOP_ENABLE_REAL_CODEX_DOGFOOD).toBeUndefined();
          expect(deps?.preflightStrictLocalCodex).toBe(preflightStrictLocalCodex);
          expect(deps?.runStrictLocalCodexPackage).toBe(runStrictLocalCodexPackage);
          return {
            releaseId: 'release-1',
            markers: [{ marker: 'Strict local_codex run', status: 'BLOCKED with reason', details: ['disabled'] }],
          };
        },
        reopenDbClient: () => ({ db: {}, pool: { end: async () => undefined } }),
        createFreshRepository: () => new InMemoryP0Repository(),
        createFreshDurableApp: async () => ({ app: { close: async () => undefined } }),
        verifyDurableReleaseAfterReopen: async () => undefined,
        preflightStrictLocalCodex,
        runStrictLocalCodexPackage,
        dropDatabase: async () => undefined,
      },
    });

    expect(preflightStrictLocalCodex).not.toHaveBeenCalled();
    expect(runStrictLocalCodexPackage).not.toHaveBeenCalled();
    expect(markers.find((marker) => marker.marker === 'Strict local_codex run')).toMatchObject({ status: 'BLOCKED with reason' });
  });

  it('does not require git when real strict local Codex is disabled', async () => {
    const repository = new InMemoryP0Repository();
    const app = await createDurableTestApp(repository);
    const runCommand = vi.fn(async () => {
      throw new Error('git should not run when strict local Codex is disabled');
    });

    try {
      const lifecycle = await runDurableReleaseLifecycle({
        app,
        repository,
        identity: buildDurableReleaseDogfoodIdentity('2026-05-11T00:00:00.000Z'),
        env: { FORGELOOP_REPO_PATH: '/not-a-git-worktree' },
        deps: { runCommand },
      });

      expect(runCommand).not.toHaveBeenCalled();
      expect(lifecycle.markers.find((marker) => marker.marker === 'Strict local_codex run')).toMatchObject({
        status: 'BLOCKED with reason',
      });
    } finally {
      await app.close();
    }
  });

  it('kicks the real strict local Codex worker path before polling terminal evidence', async () => {
    const repository = new InMemoryP0Repository();
    const app = await createDurableTestApp(repository);
    const realWorkerDrain = vi.fn<() => Promise<void>>(() => Promise.resolve());
    const marker = {
      marker: 'Strict local_codex run' as const,
      status: 'PASSED' as const,
      details: ['strict local Codex evidence linked'],
    };

    try {
      const lifecycle = await runDurableReleaseLifecycle({
        app,
        repository,
        identity: buildDurableReleaseDogfoodIdentity('2026-05-11T00:00:00.000Z'),
        env: { FORGELOOP_ENABLE_REAL_CODEX_DOGFOOD: '1' },
        deps: {
          preflightStrictLocalCodex: async () => ({
            ok: true,
            blockers: [],
            repoPath: '/repo',
            dirtyFiles: [],
            dirtySource: {
              allowed_dirty_entries: [],
              blocked_dirty_entries: [],
              dirty_allowlist_source: 'RELEASE_STRICT_DIRTY_ALLOWLIST',
            },
            worktreeProbePath: '/repo/.worktrees/probe',
          }),
          runStrictLocalCodexPackage: async (input) => {
            await input.runWorkerDrain?.();
            await repository.saveExecutionPackage({
              id: 'strict-package-1',
              work_item_id: 'strict-work-item-1',
              spec_id: 'strict-spec-1',
              spec_revision_id: 'strict-spec-revision-1',
              plan_id: 'strict-plan-1',
              plan_revision_id: input.planRevisionId,
              project_id: input.projectId,
              repo_id: 'forgeloop-source',
              objective: 'Strict local Codex evidence.',
              owner_actor_id: input.actorOwner,
              reviewer_actor_id: input.actorReviewer,
              qa_owner_actor_id: input.actorQa,
              phase: 'release',
              activity_state: 'idle',
              gate_state: 'release_ready',
              resolution: 'completed',
              required_checks: [],
              required_artifact_kinds: ['execution_summary'],
              allowed_paths: ['README.md'],
              forbidden_paths: ['.git'],
              current_run_session_id: 'run-1',
              last_run_session_id: 'run-1',
              current_review_packet_id: 'review-1',
              created_at: '2026-05-11T00:00:00.000Z',
              updated_at: '2026-05-11T00:01:00.000Z',
            });
            await repository.saveRunSession({
              id: 'run-1',
              execution_package_id: 'strict-package-1',
              requested_by_actor_id: input.actorOwner,
              status: 'succeeded',
              executor_type: 'local_codex',
              changed_files: [{ repo_id: 'forgeloop-source', path: 'README.md', change_kind: 'modified' }],
              check_results: [],
              artifacts: [{ kind: 'execution_summary', name: 'Summary', content_type: 'text/markdown', storage_uri: 'https://example.test/summary.md' }],
              log_refs: [],
              summary: 'Succeeded.',
              created_at: '2026-05-11T00:00:00.000Z',
              updated_at: '2026-05-11T00:01:00.000Z',
              started_at: '2026-05-11T00:00:00.000Z',
              finished_at: '2026-05-11T00:01:00.000Z',
            });
            await repository.saveReviewPacket({
              id: 'review-1',
              run_session_id: 'run-1',
              execution_package_id: 'strict-package-1',
              reviewer_actor_id: input.actorReviewer,
              spec_revision_id: 'strict-spec-revision-1',
              plan_revision_id: input.planRevisionId,
              status: 'completed',
              decision: 'approved',
              summary: 'Approved.',
              changed_files: [],
              check_result_summary: 'Required checks passed.',
              self_review: {
                status: 'succeeded',
                summary: 'Looks good.',
                spec_plan_alignment: 'Aligned.',
                test_assessment: 'Covered.',
                risk_notes: [],
                follow_up_questions: [],
              },
              risk_notes: [],
              reviewed_by_actor_id: input.actorReviewer,
              reviewed_at: '2026-05-11T00:01:00.000Z',
              requested_changes: [],
              created_at: '2026-05-11T00:00:00.000Z',
              updated_at: '2026-05-11T00:01:00.000Z',
              completed_at: '2026-05-11T00:01:00.000Z',
            });
            return {
              marker,
              packageId: 'strict-package-1',
              runSessionId: 'run-1',
              reviewPacketId: 'review-1',
              summary: publicStrictLocalCodexEvidenceSummary({
                runSessionId: 'run-1',
                changedFileCount: 1,
                checkCount: 1,
                artifactKinds: ['execution_summary', 'review_packet'],
                reviewPacketAvailable: true,
              }),
            };
          },
          runWorkerDrain: realWorkerDrain,
        },
      });

      expect(realWorkerDrain).toHaveBeenCalled();
      expect(lifecycle.markers).toEqual(expect.arrayContaining([marker]));
    } finally {
      await app.close();
    }
  });

  it('requires durable reopen verification before Durable local reset can pass', async () => {
    const closeFirstApp = vi.fn<() => Promise<void>>(() => Promise.resolve());
    const closeFreshApp = vi.fn<() => Promise<void>>(() => Promise.resolve());
    const closeFirstPool = vi.fn<() => Promise<void>>(() => Promise.resolve());
    const closeFreshPool = vi.fn<() => Promise<void>>(() => Promise.resolve());
    const verifyDurableReleaseAfterReopen = vi.fn<() => Promise<void>>(() => Promise.resolve());

    const markers = await runStrictReleaseFlowDogfood({
      env: { FORGELOOP_DATABASE_URL: 'postgresql://safe.local/forgeloop_tmp_dogfood_test' },
      deps: {
        nowMs: () => 1,
        planDatabase: () => ({
          kind: 'provided',
          databaseUrl: 'postgresql://safe.local/forgeloop_tmp_dogfood_test',
          adminUrl: 'postgresql://safe.local/forgeloop_tmp_dogfood_test',
          databaseName: 'forgeloop_tmp_dogfood_test',
          cleanup: { dropDatabase: false, removeContainer: false },
        }),
        prepareSafeDatabaseTarget: () => undefined,
        createDatabase: async () => undefined,
        pushSchema: async () => undefined,
        resetDatabase: async () => undefined,
        createDbClient: () => ({ db: {}, pool: { end: closeFirstPool } }),
        createRepository: () => new InMemoryP0Repository(),
        createDurableApp: async () => ({ app: { close: closeFirstApp } }),
        runDurableReleaseLifecycle: async () => ({ releaseId: 'release-1', markers: [] }),
        reopenDbClient: () => ({ db: {}, pool: { end: closeFreshPool } }),
        createFreshRepository: () => new InMemoryP0Repository(),
        createFreshDurableApp: async () => ({ app: { close: closeFreshApp } }),
        verifyDurableReleaseAfterReopen,
        dropDatabase: async () => undefined,
      },
    });

    expect(verifyDurableReleaseAfterReopen).toHaveBeenCalledWith(expect.objectContaining({ releaseId: 'release-1' }));
    expect(closeFirstApp).toHaveBeenCalled();
    expect(closeFirstPool).toHaveBeenCalled();
    expect(closeFreshApp).toHaveBeenCalled();
    expect(closeFreshPool).toHaveBeenCalled();
    expect(markers.find((marker) => marker.marker === 'Durable local reset')).toMatchObject({ status: 'PASSED' });
  });

  it('keeps missing strict durable database prerequisites blocked', async () => {
    const markers = await runStrictReleaseFlowDogfood({
      env: {},
      deps: {
        nowMs: () => 1,
        planDatabase: () => {
          throw new Error('postgresql://unsafe:secret@localhost/db');
        },
      },
    });

    expect(markers.find((marker) => marker.marker === 'Durable local reset')).toMatchObject({
      status: 'BLOCKED with reason',
      details: expect.arrayContaining(['missing_database']),
    });
    expect(markers.find((marker) => marker.marker === 'Strict local_codex run')).toMatchObject({ status: 'BLOCKED with reason' });
    expect(() => assertNoUnsafeReleaseDogfoodStrings('missing database strict markers', markers)).not.toThrow();
  });

  it('cleans up started strict durable containers when safety preparation rejects', async () => {
    const runCommand = vi.fn(async () => ({ stdout: '', stderr: '' }));
    const dropDatabase = vi.fn<() => Promise<void>>(() => Promise.resolve());

    const markers = await runStrictReleaseFlowDogfood({
      env: {},
      deps: {
        nowMs: () => 1,
        runCommand,
        planDatabase: () => ({
          kind: 'started_container',
          databaseUrl: 'postgresql://safe.local/forgeloop_tmp_dogfood_test',
          adminUrl: 'postgresql://safe.local/forgeloop_tmp_dogfood_test',
          databaseName: 'forgeloop_tmp_dogfood_test',
          cleanup: { dropDatabase: true, removeContainer: true },
          containerId: 'started-container-before-prepare',
        }),
        prepareSafeDatabaseTarget: () => {
          throw new Error('prepare rejected unsafe private detail');
        },
        dropDatabase,
      },
    });

    expect(dropDatabase).toHaveBeenCalledWith(expect.objectContaining({ containerId: 'started-container-before-prepare' }));
    expect(runCommand).toHaveBeenCalledWith('docker', ['rm', '-f', 'started-container-before-prepare'], { timeoutMs: 30_000 });
    expect(markers.find((marker) => marker.marker === 'Durable local reset')).toMatchObject({
      status: 'BLOCKED with reason',
      details: expect.arrayContaining(['missing_database']),
    });
    expect(() => assertNoUnsafeReleaseDogfoodStrings('prepare cleanup blocked strict markers', markers)).not.toThrow();
  });

  it('reports safe cleanup failure when safety preparation cleanup fails for a started container', async () => {
    const runCommand = vi.fn(async () => {
      throw new Error('docker cleanup failed with private container details');
    });

    const markers = await runStrictReleaseFlowDogfood({
      env: {},
      deps: {
        nowMs: () => 1,
        runCommand,
        planDatabase: () => ({
          kind: 'started_container',
          databaseUrl: 'postgresql://safe.local/forgeloop_tmp_dogfood_test',
          adminUrl: 'postgresql://safe.local/forgeloop_tmp_dogfood_test',
          databaseName: 'forgeloop_tmp_dogfood_test',
          cleanup: { dropDatabase: false, removeContainer: true },
          containerId: 'started-container-before-prepare-failing-cleanup',
        }),
        prepareSafeDatabaseTarget: () => {
          throw new Error('prepare rejected unsafe private detail');
        },
        dropDatabase: async () => undefined,
      },
    });

    expect(runCommand).toHaveBeenCalledWith('docker', ['rm', '-f', 'started-container-before-prepare-failing-cleanup'], { timeoutMs: 30_000 });
    expect(markers.find((marker) => marker.marker === 'Durable local reset')).toMatchObject({
      status: 'FAILED',
      details: expect.arrayContaining(['cleanup_failed']),
    });
    expect(() => assertNoUnsafeReleaseDogfoodStrings('prepare cleanup failed strict markers', markers)).not.toThrow();
  });

  it('marks Durable local reset failed when strict durable lifecycle fails after database prep', async () => {
    const closeFirstApp = vi.fn<() => Promise<void>>(() => Promise.resolve());
    const closeFirstPool = vi.fn<() => Promise<void>>(() => Promise.resolve());

    const markers = await runStrictReleaseFlowDogfood({
      env: { FORGELOOP_DATABASE_URL: 'postgresql://safe.local/forgeloop_tmp_dogfood_test' },
      deps: {
        nowMs: () => 1,
        planDatabase: () => ({
          kind: 'provided',
          databaseUrl: 'postgresql://safe.local/forgeloop_tmp_dogfood_test',
          adminUrl: 'postgresql://safe.local/forgeloop_tmp_dogfood_test',
          databaseName: 'forgeloop_tmp_dogfood_test',
          cleanup: { dropDatabase: false, removeContainer: false },
        }),
        prepareSafeDatabaseTarget: () => undefined,
        createDatabase: async () => undefined,
        pushSchema: async () => undefined,
        resetDatabase: async () => undefined,
        createDbClient: () => ({ db: {}, pool: { end: closeFirstPool } }),
        createRepository: () => new InMemoryP0Repository(),
        createDurableApp: async () => ({ app: { close: closeFirstApp } }),
        runDurableReleaseLifecycle: async () => {
          throw new Error('lifecycle failed with /Users/viv/private/path');
        },
        dropDatabase: async () => undefined,
      },
    });

    expect(closeFirstApp).toHaveBeenCalled();
    expect(closeFirstPool).toHaveBeenCalled();
    expect(markers.find((marker) => marker.marker === 'Durable local reset')).toMatchObject({
      status: 'FAILED',
      details: expect.arrayContaining(['lifecycle_failed']),
    });
    expect(markers.find((marker) => marker.marker === 'Strict local_codex run')).toMatchObject({ status: 'BLOCKED with reason' });
    expect(() => assertNoUnsafeReleaseDogfoodStrings('lifecycle failure strict markers', markers)).not.toThrow();
  });

  it('removes started strict durable Postgres containers during failure cleanup after a drop attempt', async () => {
    const closeFirstApp = vi.fn<() => Promise<void>>(() => Promise.resolve());
    const closeFirstPool = vi.fn<() => Promise<void>>(() => Promise.resolve());
    const dropDatabase = vi.fn<() => Promise<void>>(() => Promise.reject(new Error('drop failed with private cleanup detail')));
    const runCommand = vi.fn(async () => ({ stdout: '', stderr: '' }));

    await runStrictReleaseFlowDogfood({
      env: {},
      deps: {
        nowMs: () => 1,
        runCommand,
        planDatabase: () => ({
          kind: 'started_container',
          databaseUrl: 'postgresql://safe.local/forgeloop_tmp_dogfood_test',
          adminUrl: 'postgresql://safe.local/forgeloop_tmp_dogfood_test',
          databaseName: 'forgeloop_tmp_dogfood_test',
          cleanup: { dropDatabase: true, removeContainer: true },
          containerId: 'started-container-123',
        }),
        prepareSafeDatabaseTarget: () => undefined,
        createDatabase: async () => undefined,
        pushSchema: async () => undefined,
        resetDatabase: async () => undefined,
        createDbClient: () => ({ db: {}, pool: { end: closeFirstPool } }),
        createRepository: () => new InMemoryP0Repository(),
        createDurableApp: async () => ({ app: { close: closeFirstApp } }),
        runDurableReleaseLifecycle: async () => {
          throw new Error('lifecycle failed before reopen');
        },
        dropDatabase,
      },
    });

    expect(dropDatabase).toHaveBeenCalledWith(expect.objectContaining({ containerId: 'started-container-123' }));
    expect(runCommand).toHaveBeenCalledWith('docker', ['rm', '-f', 'started-container-123'], { timeoutMs: 30_000 });
  });

  it('attempts strict durable DB and container cleanup when app and pool cleanup reject', async () => {
    const closeFirstApp = vi.fn<() => Promise<void>>(() => Promise.reject(new Error('first app close failed with /Users/private')));
    const closeFirstPool = vi.fn<() => Promise<void>>(() => Promise.reject(new Error('first pool end failed with postgresql://private')));
    const dropDatabase = vi.fn<() => Promise<void>>(() => Promise.reject(new Error('drop failed')));
    const runCommand = vi.fn(async () => {
      throw new Error('remove failed');
    });

    const markers = await runStrictReleaseFlowDogfood({
      env: {},
      deps: {
        nowMs: () => 1,
        runCommand,
        planDatabase: () => ({
          kind: 'started_container',
          databaseUrl: 'postgresql://safe.local/forgeloop_tmp_dogfood_test',
          adminUrl: 'postgresql://safe.local/forgeloop_tmp_dogfood_test',
          databaseName: 'forgeloop_tmp_dogfood_test',
          cleanup: { dropDatabase: true, removeContainer: true },
          containerId: 'started-container-456',
        }),
        prepareSafeDatabaseTarget: () => undefined,
        createDatabase: async () => undefined,
        pushSchema: async () => undefined,
        resetDatabase: async () => undefined,
        createDbClient: () => ({ db: {}, pool: { end: closeFirstPool } }),
        createRepository: () => new InMemoryP0Repository(),
        createDurableApp: async () => ({ app: { close: closeFirstApp } }),
        runDurableReleaseLifecycle: async () => {
          throw new Error('lifecycle failed before first app close');
        },
        dropDatabase,
      },
    });

    expect(closeFirstApp).toHaveBeenCalled();
    expect(closeFirstPool).toHaveBeenCalled();
    expect(dropDatabase).toHaveBeenCalled();
    expect(runCommand).toHaveBeenCalledWith('docker', ['rm', '-f', 'started-container-456'], { timeoutMs: 30_000 });
    expect(markers.find((marker) => marker.marker === 'Durable local reset')).toMatchObject({
      status: 'FAILED',
      details: expect.arrayContaining(['cleanup_failed']),
    });
    expect(() => assertNoUnsafeReleaseDogfoodStrings('cleanup failure strict markers', markers)).not.toThrow();
  });

  it('reports strict cleanup failure instead of a passed durable reset after an otherwise successful flow', async () => {
    const closeFirstApp = vi.fn<() => Promise<void>>(() => Promise.resolve());
    const closeFreshApp = vi.fn<() => Promise<void>>(() => Promise.resolve());
    const closeFirstPool = vi.fn<() => Promise<void>>(() => Promise.resolve());
    const closeFreshPool = vi.fn<() => Promise<void>>(() => Promise.resolve());
    const dropDatabase = vi.fn<() => Promise<void>>(() => Promise.reject(new Error('drop failed with /Users/private')));

    const markers = await runStrictReleaseFlowDogfood({
      env: { FORGELOOP_DATABASE_URL: 'postgresql://safe.local/forgeloop_tmp_dogfood_test' },
      deps: {
        nowMs: () => 1,
        planDatabase: () => ({
          kind: 'provided',
          databaseUrl: 'postgresql://safe.local/forgeloop_tmp_dogfood_test',
          adminUrl: 'postgresql://safe.local/forgeloop_tmp_dogfood_test',
          databaseName: 'forgeloop_tmp_dogfood_test',
          cleanup: { dropDatabase: true, removeContainer: false },
        }),
        prepareSafeDatabaseTarget: () => undefined,
        createDatabase: async () => undefined,
        pushSchema: async () => undefined,
        resetDatabase: async () => undefined,
        createDbClient: () => ({ db: {}, pool: { end: closeFirstPool } }),
        createRepository: () => new InMemoryP0Repository(),
        createDurableApp: async () => ({ app: { close: closeFirstApp } }),
        runDurableReleaseLifecycle: async () => ({
          releaseId: 'release-1',
          markers: [{ marker: 'P0 delivery path', status: 'PASSED', details: ['safe lifecycle marker'] }],
        }),
        reopenDbClient: () => ({ db: {}, pool: { end: closeFreshPool } }),
        createFreshRepository: () => new InMemoryP0Repository(),
        createFreshDurableApp: async () => ({ app: { close: closeFreshApp } }),
        verifyDurableReleaseAfterReopen: async () => undefined,
        dropDatabase,
      },
    });

    expect(markers.find((marker) => marker.marker === 'P0 delivery path')).toMatchObject({ status: 'PASSED' });
    expect(markers.find((marker) => marker.marker === 'Durable local reset')).toMatchObject({
      status: 'FAILED',
      details: expect.arrayContaining(['cleanup_failed']),
    });
    expect(() => assertNoUnsafeReleaseDogfoodStrings('cleanup failure after success strict markers', markers)).not.toThrow();
  });

  it('marks Durable local reset failed when strict durable reopen verification fails', async () => {
    const closeFirstApp = vi.fn<() => Promise<void>>(() => Promise.resolve());
    const closeFreshApp = vi.fn<() => Promise<void>>(() => Promise.resolve());
    const closeFirstPool = vi.fn<() => Promise<void>>(() => Promise.resolve());
    const closeFreshPool = vi.fn<() => Promise<void>>(() => Promise.resolve());

    const markers = await runStrictReleaseFlowDogfood({
      env: { FORGELOOP_DATABASE_URL: 'postgresql://safe.local/forgeloop_tmp_dogfood_test' },
      deps: {
        nowMs: () => 1,
        planDatabase: () => ({
          kind: 'provided',
          databaseUrl: 'postgresql://safe.local/forgeloop_tmp_dogfood_test',
          adminUrl: 'postgresql://safe.local/forgeloop_tmp_dogfood_test',
          databaseName: 'forgeloop_tmp_dogfood_test',
          cleanup: { dropDatabase: false, removeContainer: false },
        }),
        prepareSafeDatabaseTarget: () => undefined,
        createDatabase: async () => undefined,
        pushSchema: async () => undefined,
        resetDatabase: async () => undefined,
        createDbClient: () => ({ db: {}, pool: { end: closeFirstPool } }),
        createRepository: () => new InMemoryP0Repository(),
        createDurableApp: async () => ({ app: { close: closeFirstApp } }),
        runDurableReleaseLifecycle: async () => ({
          releaseId: 'release-1',
          markers: [
            { marker: 'P0 delivery path', status: 'PASSED', details: ['safe p0 marker'] },
            { marker: 'Release create/link/submit', status: 'PASSED', details: ['safe release marker'] },
          ],
        }),
        reopenDbClient: () => ({ db: {}, pool: { end: closeFreshPool } }),
        createFreshRepository: () => new InMemoryP0Repository(),
        createFreshDurableApp: async () => ({ app: { close: closeFreshApp } }),
        verifyDurableReleaseAfterReopen: async () => {
          throw new Error('reopen failed with /tmp/private-artifact');
        },
        dropDatabase: async () => undefined,
      },
    });

    expect(closeFirstApp).toHaveBeenCalled();
    expect(closeFirstPool).toHaveBeenCalled();
    expect(closeFreshApp).toHaveBeenCalled();
    expect(closeFreshPool).toHaveBeenCalled();
    expect(markers.find((marker) => marker.marker === 'P0 delivery path')).toMatchObject({ status: 'PASSED' });
    expect(markers.find((marker) => marker.marker === 'Release create/link/submit')).toMatchObject({ status: 'PASSED' });
    expect(markers.find((marker) => marker.marker === 'Durable local reset')).toMatchObject({
      status: 'FAILED',
      details: expect.arrayContaining(['reopen_failed']),
    });
    expect(markers.find((marker) => marker.marker === 'Strict local_codex run')).toMatchObject({ status: 'BLOCKED with reason' });
    expect(() => assertNoUnsafeReleaseDogfoodStrings('reopen failure strict markers', markers)).not.toThrow();
  });

  it('marks completed strict local Codex evidence failed when post-close public projection checks fail', async () => {
    const closeFirstApp = vi.fn<() => Promise<void>>(() => Promise.resolve());
    const closeFreshApp = vi.fn<() => Promise<void>>(() => Promise.resolve());
    const closeFirstPool = vi.fn<() => Promise<void>>(() => Promise.resolve());
    const closeFreshPool = vi.fn<() => Promise<void>>(() => Promise.resolve());

    const markers = await runStrictReleaseFlowDogfood({
      env: { FORGELOOP_DATABASE_URL: 'postgresql://safe.local/forgeloop_tmp_dogfood_test' },
      deps: {
        nowMs: () => 1,
        planDatabase: () => ({
          kind: 'provided',
          databaseUrl: 'postgresql://safe.local/forgeloop_tmp_dogfood_test',
          adminUrl: 'postgresql://safe.local/forgeloop_tmp_dogfood_test',
          databaseName: 'forgeloop_tmp_dogfood_test',
          cleanup: { dropDatabase: false, removeContainer: false },
        }),
        prepareSafeDatabaseTarget: () => undefined,
        createDatabase: async () => undefined,
        pushSchema: async () => undefined,
        resetDatabase: async () => undefined,
        createDbClient: () => ({ db: {}, pool: { end: closeFirstPool } }),
        createRepository: () => new InMemoryP0Repository(),
        createDurableApp: async () => ({ app: { close: closeFirstApp } }),
        runDurableReleaseLifecycle: async () => ({
          releaseId: 'release-1',
          markers: [
            { marker: 'P0 delivery path', status: 'PASSED', details: ['safe p0 marker'] },
            { marker: 'Release create/link/submit', status: 'PASSED', details: ['safe release marker'] },
            { marker: 'Strict local_codex run', status: 'PASSED', details: ['strict evidence completed before projection'] },
          ],
          strictLocalCodex: {
            executionPackageId: 'strict-package-1',
            runSessionId: 'strict-run-1',
            reviewPacketId: 'strict-review-1',
            summary: publicStrictLocalCodexEvidenceSummary({
              runSessionId: 'strict-run-1',
              changedFileCount: 1,
              checkCount: 1,
              artifactKinds: ['execution_summary', 'review_packet'],
              reviewPacketAvailable: true,
            }),
          },
        }),
        reopenDbClient: () => ({ db: {}, pool: { end: closeFreshPool } }),
        createFreshRepository: () => new InMemoryP0Repository(),
        createFreshDurableApp: async () => ({ app: { close: closeFreshApp } }),
        verifyDurableReleaseAfterReopen: async () => {
          throw new Error('strict local Codex public cockpit projection missing supports/generated_by links');
        },
        dropDatabase: async () => undefined,
      },
    });

    expect(closeFirstApp).toHaveBeenCalled();
    expect(closeFirstPool).toHaveBeenCalled();
    expect(closeFreshApp).toHaveBeenCalled();
    expect(closeFreshPool).toHaveBeenCalled();
    expect(markers.find((marker) => marker.marker === 'P0 delivery path')).toMatchObject({ status: 'PASSED' });
    expect(markers.find((marker) => marker.marker === 'Release create/link/submit')).toMatchObject({ status: 'PASSED' });
    expect(markers.find((marker) => marker.marker === 'Durable local reset')).toMatchObject({
      status: 'FAILED',
      details: expect.arrayContaining(['reopen_failed']),
    });
    expect(markers.find((marker) => marker.marker === 'Strict local_codex run')).toMatchObject({
      status: 'FAILED',
      details: expect.arrayContaining(['public_projection_leak']),
    });
    expect(() => assertNoUnsafeReleaseDogfoodStrings('projection failure strict markers', markers)).not.toThrow();
  });

  it('creates observation evidence before closing the strict durable release lifecycle', async () => {
    const repository = new InMemoryP0Repository();
    const app = await createDurableTestApp(repository);
    try {
      const lifecycle = await runDurableReleaseLifecycle({
        app,
        repository,
        identity: buildDurableReleaseDogfoodIdentity('2026-05-11T00:00:00.000Z'),
      });

      const release = await repository.getRelease(lifecycle.releaseId);
      const evidence = await repository.listReleaseEvidences(lifecycle.releaseId);

      expect(release).toMatchObject({ phase: 'completed', resolution: 'completed' });
      expect(evidence).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            evidence_type: 'observation_note',
            extra: expect.objectContaining({
              observation: expect.objectContaining({
                source: 'script',
                severity: 'info',
                summary: expect.any(String),
              }),
            }),
          }),
        ]),
      );
      const observationRelationships = evidence.flatMap((item) => {
        const links = (item.extra as { observation?: { links?: Array<{ relationship?: unknown }> } } | undefined)?.observation?.links;
        return Array.isArray(links) ? links.map((link) => link.relationship) : [];
      });
      expect(observationRelationships).not.toContain('affected');
      expect(observationRelationships).toEqual(
        expect.arrayContaining(['observed', 'generated_by']),
      );
      expect(observationRelationships.every((relationship) => ['observed', 'supports', 'generated_by'].includes(String(relationship)))).toBe(true);
    } finally {
      await app.close();
    }
  });

  it('plans strict dogfood with an existing Docker Postgres candidate when no database URL is provided', async () => {
    const runCommand = vi.fn(async (command: string, args: string[]) => {
      if (command === 'docker' && args[0] === 'ps') {
        return { stdout: '{"ID":"abc123","Image":"postgres:16-alpine","Names":"db","Ports":"0.0.0.0:5432->5432/tcp"}', stderr: '' };
      }
      if (command === 'docker' && args[0] === 'inspect') {
        return {
          stdout: JSON.stringify([
            {
              Id: 'abc123',
              Config: { Env: ['POSTGRES_USER=forgeloop', 'POSTGRES_PASSWORD=dogfood', 'POSTGRES_DB=postgres'] },
              NetworkSettings: { Ports: { '5432/tcp': [{ HostIp: '0.0.0.0', HostPort: '15432' }] } },
            },
          ]),
          stderr: '',
        };
      }
      throw new Error('unexpected command');
    });

    const plan = await planStrictReleaseDogfoodDatabase({ env: {}, timestamp: 42, runCommand });

    expect(plan.kind).toBe('docker_temp_db');
    expect(plan.databaseName).toBe('forgeloop_tmp_dogfood_42');
    expect(runCommand).toHaveBeenCalledWith('docker', ['ps', '--no-trunc', '--format', '{{json .}}']);
    expect(runCommand).toHaveBeenCalledWith('docker', ['inspect', 'abc123']);
  });

  it('starts disposable Postgres for strict dogfood when requested and no existing candidate is found', async () => {
    const runCommand = vi.fn(async () => ({ stdout: '', stderr: '' }));
    const startDisposablePostgres = vi.fn(async () => ({
      containerId: 'started123',
      candidate: {
        containerId: 'started123',
        host: '127.0.0.1',
        port: 15433,
        user: 'forgeloop',
        password: 'dogfood',
        defaultDatabase: 'postgres',
      },
    }));

    const plan = await planStrictReleaseDogfoodDatabase({
      env: { FORGELOOP_DOGFOOD_START_POSTGRES: '1' },
      timestamp: 43,
      runCommand,
      startDisposablePostgres,
    });

    expect(startDisposablePostgres).toHaveBeenCalledWith(runCommand, 43);
    expect(plan).toMatchObject({
      kind: 'started_container',
      containerId: 'started123',
      cleanup: { dropDatabase: true, removeContainer: true },
    });
  });

  const seedFreshReopenRepository = async (
    overrides: {
      release?: Partial<Release>;
      executionPackage?: Partial<ExecutionPackage>;
      releaseEvidence?: ReleaseEvidence | undefined;
      decision?: Decision | undefined;
    } = {},
  ) => {
    const repository = new InMemoryP0Repository();
    const workItem: WorkItem = {
      id: 'work-item-reopen',
      project_id: 'project-reopen',
      kind: 'requirement',
      title: 'Reopen verification',
      goal: 'Verify durable reopen state.',
      success_criteria: ['Fresh app sees release state'],
      priority: 'P1',
      risk: 'low',
      owner_actor_id: 'actor-owner',
      phase: 'done',
      activity_state: 'idle',
      gate_state: 'none',
      resolution: 'completed',
      created_at: '2026-05-11T00:00:00.000Z',
      updated_at: '2026-05-11T00:01:00.000Z',
    };
    const executionPackage: ExecutionPackage = {
      id: 'execution-package-reopen',
      work_item_id: workItem.id,
      spec_id: 'spec-reopen',
      spec_revision_id: 'spec-revision-reopen',
      plan_id: 'plan-reopen',
      plan_revision_id: 'plan-revision-reopen',
      project_id: workItem.project_id,
      repo_id: 'forgeloop-source',
      objective: 'Verify reopen state.',
      owner_actor_id: 'actor-owner',
      reviewer_actor_id: 'actor-reviewer',
      qa_owner_actor_id: 'actor-qa',
      phase: 'release',
      activity_state: 'idle',
      gate_state: 'release_ready',
      resolution: 'completed',
      required_checks: [{ check_id: 'unit', display_name: 'Unit', command: 'pnpm test', timeout_seconds: 60, blocks_review: true }],
      required_artifact_kinds: ['execution_summary'],
      allowed_paths: ['README.md'],
      forbidden_paths: ['.git'],
      last_run_session_id: 'run-session-reopen',
      current_run_session_id: 'run-session-reopen',
      current_review_packet_id: 'review-packet-reopen',
      created_at: '2026-05-11T00:00:00.000Z',
      updated_at: '2026-05-11T00:01:00.000Z',
      ...overrides.executionPackage,
    };
    const runSession: RunSession = {
      id: 'run-session-reopen',
      execution_package_id: executionPackage.id,
      requested_by_actor_id: 'actor-owner',
      status: 'succeeded',
      executor_type: 'mock',
      changed_files: [],
      check_results: [{ check_id: 'unit', command: 'pnpm test', status: 'succeeded', exit_code: 0, duration_seconds: 1, blocks_review: true }],
      artifacts: [{ kind: 'execution_summary', name: 'Summary', content_type: 'text/markdown', storage_uri: 'https://example.test/summary.md' }],
      log_refs: [],
      summary: 'Succeeded.',
      created_at: '2026-05-11T00:00:00.000Z',
      updated_at: '2026-05-11T00:01:00.000Z',
      started_at: '2026-05-11T00:00:00.000Z',
      finished_at: '2026-05-11T00:01:00.000Z',
    };
    const reviewPacket: ReviewPacket = {
      id: 'review-packet-reopen',
      run_session_id: runSession.id,
      execution_package_id: executionPackage.id,
      reviewer_actor_id: 'actor-reviewer',
      spec_revision_id: executionPackage.spec_revision_id,
      plan_revision_id: executionPackage.plan_revision_id,
      status: 'completed',
      decision: 'approved',
      summary: 'Approved.',
      changed_files: [],
      check_result_summary: 'Required checks passed.',
      self_review: {
        status: 'succeeded',
        summary: 'Looks good.',
        spec_plan_alignment: 'Aligned.',
        test_assessment: 'Covered.',
        risk_notes: [],
        follow_up_questions: [],
      },
      risk_notes: [],
      reviewed_by_actor_id: 'actor-reviewer',
      reviewed_at: '2026-05-11T00:01:00.000Z',
      requested_changes: [],
      created_at: '2026-05-11T00:00:00.000Z',
      updated_at: '2026-05-11T00:01:00.000Z',
      completed_at: '2026-05-11T00:01:00.000Z',
    };
    const release: Release = {
      id: 'release-reopen',
      org_id: 'org-1',
      project_id: workItem.project_id,
      title: 'Release reopen',
      release_owner_actor_id: 'actor-owner',
      release_type: 'normal',
      visibility: 'internal',
      labels: [],
      phase: 'completed',
      activity_state: 'idle',
      gate_state: 'rollout_succeeded',
      resolution: 'completed',
      work_item_ids: [workItem.id],
      execution_package_ids: [executionPackage.id],
      current_run_session_ids: [runSession.id],
      current_review_packet_ids: [reviewPacket.id],
      created_by_actor_id: 'actor-owner',
      updated_by_actor_id: 'actor-owner',
      created_at: '2026-05-11T00:00:00.000Z',
      updated_at: '2026-05-11T00:01:00.000Z',
      closed_at: '2026-05-11T00:01:00.000Z',
      ...overrides.release,
    };
    const releaseEvidence =
      'releaseEvidence' in overrides
        ? overrides.releaseEvidence
        : {
            id: 'release-evidence-reopen',
            release_id: release.id,
            evidence_type: 'observation_note' as const,
            summary: 'Observation is healthy.',
            extra: {
              observation: {
                source: 'script',
                severity: 'info',
                observed_at: '2026-05-11T00:01:00.000Z',
                summary: 'Fresh app can read release observations.',
              },
            },
            redacted: false,
            status: 'current' as const,
            created_at: '2026-05-11T00:01:00.000Z',
            created_by_actor_id: 'actor-owner',
            updated_at: '2026-05-11T00:01:00.000Z',
            updated_by_actor_id: 'actor-owner',
          };
    const decisions = [
      {
        id: 'decision-reopen-approval',
        object_type: 'release' as const,
        object_id: release.id,
        actor_id: 'actor-reviewer',
        decision: 'approved' as const,
        decision_type: 'release_approval' as const,
        summary: 'Approved.',
        created_at: '2026-05-11T00:01:00.000Z',
      },
      {
        id: 'decision-reopen-close',
        object_type: 'release' as const,
        object_id: release.id,
        actor_id: 'actor-owner',
        decision: 'approved' as const,
        decision_type: 'release_close' as const,
        summary: 'Closed.',
        created_at: '2026-05-11T00:01:01.000Z',
      },
    ];
    const selectedDecisions =
      'decision' in overrides
        ? overrides.decision === undefined
          ? []
          : [overrides.decision]
        : decisions;

    await repository.saveWorkItem(workItem);
    await repository.saveExecutionPackage(executionPackage);
    await repository.saveRunSession(runSession);
    await repository.saveReviewPacket(reviewPacket);
    await repository.saveRelease(release);
    await repository.saveReleaseWorkItem({ release_id: release.id, work_item_id: workItem.id });
    await repository.saveReleaseExecutionPackage({ release_id: release.id, execution_package_id: executionPackage.id });
    if (releaseEvidence !== undefined) {
      await repository.saveReleaseEvidence(releaseEvidence);
    }
    for (const decision of selectedDecisions) {
      await repository.saveDecision(decision);
    }

    return {
      repository,
      lifecycle: {
        releaseId: release.id,
        projectId: release.project_id,
        workItemId: workItem.id,
        executionPackageId: executionPackage.id,
        runSessionId: runSession.id,
        reviewPacketId: reviewPacket.id,
        markers: [],
      },
    };
  };

  it('rejects strict local Codex reopen verification when public projection drops strict links', async () => {
    const { repository, lifecycle } = await seedFreshReopenRepository({
      releaseEvidence: {
        id: 'release-evidence-reopen',
        release_id: 'release-reopen',
        evidence_type: 'observation_note',
        summary: 'Observation is healthy.',
        extra: {
          observation: {
            source: 'script',
            severity: 'info',
            observed_at: '2026-05-11T00:01:00.000Z',
            summary: 'Fresh app can read release observations.',
            links: [
              { object_type: 'release', object_id: 'release-reopen', relationship: 'observed' },
              { object_type: 'execution_package', object_id: 'strict-package-reopen', relationship: 'supports' },
              { object_type: 'run_session', object_id: 'strict-run-reopen', relationship: 'generated_by' },
            ],
          },
        },
        redacted: false,
        status: 'current',
        created_at: '2026-05-11T00:01:00.000Z',
        created_by_actor_id: 'actor-owner',
        updated_at: '2026-05-11T00:01:00.000Z',
        updated_by_actor_id: 'actor-owner',
      },
    });
    const baseRelease = await repository.getRelease(lifecycle.releaseId);
    if (baseRelease === undefined) {
      throw new Error('missing seeded release');
    }
    await repository.saveExecutionPackage({
      id: 'strict-package-reopen',
      work_item_id: lifecycle.workItemId ?? 'work-item-reopen',
      spec_id: 'spec-reopen',
      spec_revision_id: 'spec-revision-reopen',
      plan_id: 'plan-reopen',
      plan_revision_id: 'plan-revision-reopen',
      project_id: baseRelease.project_id,
      repo_id: 'forgeloop-source',
      objective: 'Strict local Codex public projection.',
      owner_actor_id: 'actor-owner',
      reviewer_actor_id: 'actor-reviewer',
      qa_owner_actor_id: 'actor-qa',
      phase: 'release',
      activity_state: 'idle',
      gate_state: 'release_ready',
      resolution: 'completed',
      required_checks: [],
      required_artifact_kinds: ['execution_summary'],
      allowed_paths: ['README.md'],
      forbidden_paths: ['.git'],
      current_run_session_id: 'strict-run-reopen',
      last_run_session_id: 'strict-run-reopen',
      current_review_packet_id: 'strict-review-reopen',
      created_at: '2026-05-11T00:00:00.000Z',
      updated_at: '2026-05-11T00:01:00.000Z',
    });
    await repository.saveRunSession({
      id: 'strict-run-reopen',
      execution_package_id: 'strict-package-reopen',
      requested_by_actor_id: 'actor-owner',
      status: 'succeeded',
      executor_type: 'local_codex',
      changed_files: [{ repo_id: 'forgeloop-source', path: 'README.md', change_kind: 'modified' }],
      check_results: [],
      artifacts: [{ kind: 'execution_summary', name: 'Summary', content_type: 'text/markdown', storage_uri: 'https://example.test/summary.md' }],
      log_refs: [],
      summary: 'Succeeded.',
      created_at: '2026-05-11T00:00:00.000Z',
      updated_at: '2026-05-11T00:01:00.000Z',
      started_at: '2026-05-11T00:00:00.000Z',
      finished_at: '2026-05-11T00:01:00.000Z',
    });
    await repository.saveReviewPacket({
      id: 'strict-review-reopen',
      run_session_id: 'strict-run-reopen',
      execution_package_id: 'strict-package-reopen',
      reviewer_actor_id: 'actor-reviewer',
      spec_revision_id: 'spec-revision-reopen',
      plan_revision_id: 'plan-revision-reopen',
      status: 'completed',
      decision: 'approved',
      summary: 'Approved.',
      changed_files: [],
      check_result_summary: 'Required checks passed.',
      self_review: {
        status: 'succeeded',
        summary: 'Looks good.',
        spec_plan_alignment: 'Aligned.',
        test_assessment: 'Covered.',
        risk_notes: [],
        follow_up_questions: [],
      },
      risk_notes: [],
      reviewed_by_actor_id: 'actor-reviewer',
      reviewed_at: '2026-05-11T00:01:00.000Z',
      requested_changes: [],
      created_at: '2026-05-11T00:00:00.000Z',
      updated_at: '2026-05-11T00:01:00.000Z',
      completed_at: '2026-05-11T00:01:00.000Z',
    });
    await repository.saveRelease({
      ...baseRelease,
      execution_package_ids: [...baseRelease.execution_package_ids, 'strict-package-reopen'],
      current_run_session_ids: [...(baseRelease.current_run_session_ids ?? []), 'strict-run-reopen'],
      current_review_packet_ids: [...(baseRelease.current_review_packet_ids ?? []), 'strict-review-reopen'],
    });
    await repository.saveReleaseExecutionPackage({ release_id: baseRelease.id, execution_package_id: 'strict-package-reopen' });
    const server = createServer((request, response) => {
      response.setHeader('content-type', 'application/json');
      if (request.url === `/query/release-cockpit/${baseRelease.id}`) {
        response.end(
          JSON.stringify({
            observations: [
              {
                extra: {
                  observation: {
                    links: [{ object_type: 'release', object_id: baseRelease.id, relationship: 'observed' }],
                  },
                },
              },
            ],
          }),
        );
        return;
      }
      response.end(
        JSON.stringify([
          {
            source: 'release_evidence',
            payload: {
              extra: {
                observation: {
                  links: [{ object_type: 'release', object_id: baseRelease.id, relationship: 'observed' }],
                },
              },
            },
          },
        ]),
      );
    });

    await expect(
      verifyDurableReleaseAfterReopen({
        app: { getHttpServer: () => server },
        repository,
        releaseId: lifecycle.releaseId,
        lifecycle: {
          ...lifecycle,
          strictLocalCodex: {
            executionPackageId: 'strict-package-reopen',
            runSessionId: 'strict-run-reopen',
            reviewPacketId: 'strict-review-reopen',
            summary: publicStrictLocalCodexEvidenceSummary({
              runSessionId: 'strict-run-reopen',
              changedFileCount: 1,
              checkCount: 0,
              artifactKinds: ['execution_summary'],
              reviewPacketAvailable: true,
            }),
          },
        },
      }),
    ).rejects.toThrow(/strict local Codex public cockpit projection/i);
  });

  it('verifies lifecycle-created release closure rows through a fresh app boundary', async () => {
    const repository = new InMemoryP0Repository();
    const firstApp = await createDurableTestApp(repository);
    let lifecycle: Awaited<ReturnType<typeof runDurableReleaseLifecycle>>;
    try {
      lifecycle = await runDurableReleaseLifecycle({
        app: firstApp,
        repository,
        identity: buildDurableReleaseDogfoodIdentity('2026-05-11T00:00:00.000Z'),
      });
    } finally {
      await firstApp.close();
    }

    const freshApp = await createDurableTestApp(repository);
    try {
      await expect(verifyDurableReleaseAfterReopen({ app: freshApp, repository, releaseId: lifecycle.releaseId, lifecycle })).resolves.toBeUndefined();
    } finally {
      await freshApp.close();
    }
  });

  it('rejects fresh reopen verification when observation evidence is missing', async () => {
    const { repository, lifecycle } = await seedFreshReopenRepository({ releaseEvidence: undefined });
    const app = await createDurableTestApp(repository);
    try {
      await expect(verifyDurableReleaseAfterReopen({ app, repository, releaseId: lifecycle.releaseId, lifecycle })).rejects.toThrow(
        'strict_reopen_missing_observation_evidence',
      );
    } finally {
      await app.close();
    }
  });

  it('rejects fresh reopen verification when observation backlink is not projected', async () => {
    const { repository, lifecycle } = await seedFreshReopenRepository();
    const app = await createDurableTestApp(repository);
    try {
      await expect(verifyDurableReleaseAfterReopen({ app, repository, releaseId: lifecycle.releaseId, lifecycle })).rejects.toThrow(
        'Release observation backlink was not projected through the cockpit response',
      );
    } finally {
      await app.close();
    }
  });

  it('rejects fresh reopen verification when release is not closed and completed', async () => {
    const { repository, lifecycle } = await seedFreshReopenRepository({
      release: { closed_at: undefined, resolution: 'completed' },
    });
    const app = await createDurableTestApp(repository);
    try {
      await expect(verifyDurableReleaseAfterReopen({ app, repository, releaseId: lifecycle.releaseId, lifecycle })).rejects.toThrow(
        'strict_reopen_missing_release',
      );
    } finally {
      await app.close();
    }
  });

  it('rejects fresh reopen verification when package is no longer release-ready', async () => {
    const { repository, lifecycle } = await seedFreshReopenRepository({
      executionPackage: { phase: 'review', gate_state: 'awaiting_human_review', resolution: 'none' },
    });
    const app = await createDurableTestApp(repository);
    try {
      await expect(verifyDurableReleaseAfterReopen({ app, repository, releaseId: lifecycle.releaseId, lifecycle })).rejects.toThrow(
        'strict_reopen_package_not_release_ready',
      );
    } finally {
      await app.close();
    }
  });

  it('seeds durable release-ready package evidence without release evidence blockers', async () => {
    const repository = new InMemoryP0Repository();
    const workItem: WorkItem = {
      id: 'work-item-1',
      project_id: 'project-1',
      kind: 'requirement',
      title: 'Release ready',
      goal: 'Seed release-ready evidence.',
      success_criteria: ['No release blockers'],
      priority: 'P1',
      risk: 'low',
      owner_actor_id: 'actor-owner',
      phase: 'execution',
      activity_state: 'idle',
      gate_state: 'not_submitted',
      resolution: 'none',
      created_at: '2026-05-11T00:00:00.000Z',
      updated_at: '2026-05-11T00:00:00.000Z',
    };
    const executionPackage: ExecutionPackage = {
      id: 'execution-package-1',
      work_item_id: workItem.id,
      spec_id: 'spec-1',
      spec_revision_id: 'spec-revision-1',
      plan_id: 'plan-1',
      plan_revision_id: 'plan-revision-1',
      project_id: workItem.project_id,
      repo_id: 'forgeloop-source',
      objective: 'Seed release-ready evidence.',
      owner_actor_id: 'actor-owner',
      reviewer_actor_id: 'actor-reviewer',
      qa_owner_actor_id: 'actor-qa',
      phase: 'ready',
      activity_state: 'idle',
      gate_state: 'not_submitted',
      resolution: 'none',
      required_checks: [{ check_id: 'unit', display_name: 'Unit', command: 'pnpm test', timeout_seconds: 60, blocks_review: true }],
      required_artifact_kinds: ['execution_summary'],
      allowed_paths: ['README.md'],
      forbidden_paths: ['.git'],
      created_at: '2026-05-11T00:00:00.000Z',
      updated_at: '2026-05-11T00:00:00.000Z',
    };
    const release: Release = {
      id: 'release-1',
      org_id: 'org-1',
      project_id: workItem.project_id,
      title: 'Release',
      release_owner_actor_id: 'actor-owner',
      release_type: 'normal',
      visibility: 'internal',
      labels: [],
      phase: 'draft',
      activity_state: 'idle',
      gate_state: 'not_submitted',
      resolution: 'none',
      work_item_ids: [workItem.id],
      execution_package_ids: [executionPackage.id],
      created_by_actor_id: 'actor-owner',
      updated_by_actor_id: 'actor-owner',
      created_at: '2026-05-11T00:00:00.000Z',
      updated_at: '2026-05-11T00:00:00.000Z',
    };

    await repository.saveWorkItem(workItem);
    await repository.saveExecutionPackage(executionPackage);
    const seeded = await seedDurableReleaseReadyPackageEvidence(repository, executionPackage, {
      ownerActorId: 'actor-owner',
      reviewerActorId: 'actor-reviewer',
      at: '2026-05-11T00:01:00.000Z',
    });
    const blockers = deriveReleaseBlockers({
      release,
      work_items: [seeded.workItem],
      execution_packages: [seeded.executionPackage],
      run_sessions: [seeded.runSession],
      review_packets: [seeded.reviewPacket],
      evidence: [],
    });

    expect(blockers.map((blocker) => blocker.code)).not.toEqual(
      expect.arrayContaining([
        'package_not_release_ready',
        'missing_approved_review_packet',
        'failed_required_check',
        'missing_required_artifact',
      ]),
    );
  });

  it('renders failed markers and blocked markers without unsafe values', () => {
    const report = renderReleaseFlowVerificationReport([
      ...requiredReleaseFlowReportMarkers.map((marker) => ({
        marker,
        status: marker === 'Durable local reset' ? 'FAILED' : marker === 'Strict local_codex run' ? 'BLOCKED with reason' : 'PASSED',
        details: ['safe detail'],
      })),
    ]);

    expect(report).toContain('Status: FAILED');
    expect(report).toContain('Status: BLOCKED with reason');
    expect(() => assertNoUnsafeReleaseDogfoodStrings('report', report)).not.toThrow();
  });

  it('serializes weird safe values without opaque stringify errors', () => {
    const circular: Record<string, unknown> = { label: 'safe' };
    circular.self = circular;

    expect(() => assertNoUnsafeReleaseDogfoodStrings('undefined report value', undefined)).not.toThrow();
    expect(() => assertNoUnsafeReleaseDogfoodStrings('function report value', () => 'safe')).not.toThrow();
    expect(() => assertNoUnsafeReleaseDogfoodStrings('symbol report value', Symbol('safe'))).not.toThrow();
    expect(() => assertNoUnsafeReleaseDogfoodStrings('bigint report value', 123n)).not.toThrow();
    expect(() => assertNoUnsafeReleaseDogfoodStrings('circular report value', circular)).not.toThrow();
    expect(() =>
      assertNoUnsafeReleaseDogfoodStrings('public artifact URL', {
        storage_uri: 'https://example.test/forgeloop/release-strict-dogfood-summary.md',
      }),
    ).not.toThrow();
  });

  it('rejects unsafe public report strings', () => {
    expect(() => assertNoUnsafeReleaseDogfoodStrings('report', { path: '/Users/viv/projs/forgeloop/.worktrees/run-1' })).toThrow(
      /unsafe serialized string/,
    );
    expect(() => assertNoUnsafeReleaseDogfoodStrings('report', { local_ref: '/tmp/forgeloop-executor-artifacts/review.md' })).toThrow(
      /unsafe serialized string/,
    );
    expect(() => assertNoUnsafeReleaseDogfoodStrings('report', { artifact_path: '/var/folders/tmp/review.md' })).toThrow(
      /unsafe serialized string/,
    );
    expect(() => assertNoUnsafeReleaseDogfoodStrings('report', { storage_uri: '/tmp/custom-artifacts/review.md' })).toThrow(
      /unsafe serialized pattern/,
    );
    expect(() =>
      assertNoUnsafeReleaseDogfoodStrings('report', {
        storage_uri: `${process.env.FORGELOOP_EXECUTOR_ARTIFACT_ROOT ?? '/tmp/codex-run'}/review.md`,
      }),
    ).toThrow(/unsafe serialized pattern/);
    expect(() => assertNoUnsafeReleaseDogfoodStrings('report', { authorization: 'Bearer secret' })).toThrow(
      /unsafe serialized string/,
    );
    expect(() => assertNoUnsafeReleaseDogfoodStrings('report', { access_token: 'value' })).toThrow(/unsafe serialized string/);
    expect(() => assertNoUnsafeReleaseDogfoodStrings('report', { api_key: 'value' })).toThrow(/unsafe serialized string/);
    expect(() => assertNoUnsafeReleaseDogfoodStrings('report', { client_secret: 'value' })).toThrow(/unsafe serialized string/);
    expect(() => assertNoUnsafeReleaseDogfoodStrings('report', { accessToken: 'value' })).toThrow(/unsafe serialized string/);
    expect(() => assertNoUnsafeReleaseDogfoodStrings('report', { clientSecret: 'value' })).toThrow(/unsafe serialized string/);
    expect(() => assertNoUnsafeReleaseDogfoodStrings('report', { apiKey: 'value' })).toThrow(/unsafe serialized pattern/);
    expect(() => assertNoUnsafeReleaseDogfoodStrings('report', { Authorization: 'Bearer value' })).toThrow(/unsafe serialized string/);
    expect(() => assertNoUnsafeReleaseDogfoodStrings('report', { databaseUrl: 'postgresql://user:secret@localhost/db' })).toThrow(
      /unsafe serialized string/,
    );
    expect(() => assertNoUnsafeReleaseDogfoodStrings('report', { localRef: '/home/runner/work/forgeloop/review.md' })).toThrow(
      /unsafe serialized string/,
    );
    expect(() => assertNoUnsafeReleaseDogfoodStrings('report', { artifactPath: '/opt/forgeloop/artifact.md' })).toThrow(
      /unsafe serialized string/,
    );
    expect(() => assertNoUnsafeReleaseDogfoodStrings('report', { rawMetadata: { ok: true } })).toThrow(/unsafe serialized string/);
    expect(() => assertNoUnsafeReleaseDogfoodStrings('report', { runtimeMetadata: { ok: true } })).toThrow(/unsafe serialized string/);
    expect(() => assertNoUnsafeReleaseDogfoodStrings('report', { sessionSecret: 'value' })).toThrow(/unsafe serialized string/);
    expect(() => assertNoUnsafeReleaseDogfoodStrings('report', { path: 'C:\\Users\\viv\\forgeloop\\artifact.md' })).toThrow(
      /unsafe serialized pattern/,
    );
    expect(() => assertNoUnsafeReleaseDogfoodStrings('report', { allowedPaths: ['README.md'] })).toThrow(/unsafe serialized string/);
    expect(() => assertNoUnsafeReleaseDogfoodStrings('report', { forbiddenPaths: ['.env'] })).toThrow(/unsafe serialized string/);
    expect(() => assertNoUnsafeReleaseDogfoodStrings('report', { workspace_path: '[redacted]' })).toThrow(/unsafe serialized string/);
    expect(() => assertNoUnsafeReleaseDogfoodStrings('report', { workspacePath: '[redacted]' })).toThrow(/unsafe serialized string/);
    expect(() => assertNoUnsafeReleaseDogfoodStrings('report', { worktree_path: '[redacted]' })).toThrow(/unsafe serialized string/);
    expect(() => assertNoUnsafeReleaseDogfoodStrings('report', { worktreePath: '[redacted]' })).toThrow(/unsafe serialized string/);
    expect(() => assertNoUnsafeReleaseDogfoodStrings('report', { runtime_metadata: { workspace_path: 'x' } })).toThrow(
      /unsafe serialized string/,
    );
  });
});
