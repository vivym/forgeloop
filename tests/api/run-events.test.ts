import http from 'node:http';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';

import { AppModule } from '../../apps/control-plane-api/src/app.module';
import { DELIVERY_REPOSITORY } from '../../apps/control-plane-api/src/modules/core/control-plane-tokens';
import { DELIVERY_RUN_WORKER } from '../../apps/control-plane-api/src/modules/run-control/run-worker.token';
import { InMemoryDeliveryRepository } from '../../packages/db/src';

import { seedAppWithRunSession, seedQueuedPackageRun } from '../helpers/delivery-runtime-fixtures';

describe('run event API', () => {
  const apps: INestApplication[] = [];
  const track = async <T extends { app: INestApplication }>(value: Promise<T>): Promise<T> => {
    const resolved = await value;
    apps.push(resolved.app);
    return resolved;
  };

  const expectSseFirstEvent = async (
    app: INestApplication,
    path: string,
    headers: Record<string, string> = {},
    onOpen?: () => Promise<void> | void,
  ): Promise<string> =>
    await new Promise((resolve, reject) => {
      const server = app.getHttpServer();
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : undefined;
      if (typeof port !== 'number') {
        reject(new Error('Expected test HTTP server to be listening on a port'));
        return;
      }

      const req = http.get(
        {
          host: '127.0.0.1',
          port,
          path,
          headers: { Accept: 'text/event-stream', ...headers },
        },
        (res) => {
          if (res.statusCode !== 200) {
            reject(new Error(`Expected SSE 200, received ${res.statusCode}`));
            res.resume();
            return;
          }

          let body = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => {
            body += chunk;
            if (body.includes('\n\n')) {
              req.destroy();
              resolve(body);
            }
          });

          if (onOpen !== undefined) {
            setTimeout(() => {
              void Promise.resolve(onOpen()).catch(reject);
            }, 25);
          }
        },
      );
      req.setTimeout(2_000, () => {
        req.destroy(new Error('Timed out waiting for SSE event'));
      });
      req.on('error', reject);
    });

  const seedAppWithEmptyRunSession = async (): Promise<{ app: INestApplication; repo: InMemoryDeliveryRepository; runSessionId: string }> => {
    const repo = new InMemoryDeliveryRepository();
    const { runSession } = await seedQueuedPackageRun(repo);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DELIVERY_REPOSITORY)
      .useValue(repo)
      .overrideProvider(DELIVERY_RUN_WORKER)
      .useValue({ kick: () => undefined, drainOnce: async () => undefined })
      .compile();
    const app = moduleRef.createNestApplication();
    await app.init();

    return { app, repo, runSessionId: runSession.id };
  };

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it('backfills normalized events without raw_ref', async () => {
    const { app, runSessionId, repo } = await track(seedAppWithRunSession());
    await repo.appendRunEvent({
      id: 'run-event-1',
      run_session_id: runSessionId,
      event_type: 'agent_message_delta',
      source: 'codex',
      visibility: 'public',
      summary: 'Codex output.',
      payload: { text: 'hello' },
      raw_ref: 'local://tmp/raw.jsonl',
      created_at: '2026-05-07T00:00:00.000Z',
    });

    const response = await request(app.getHttpServer())
      .get(`/run-sessions/${runSessionId}/events`)
      .query({ actor_id: 'actor-owner' })
      .expect(200);

    const event = response.body.events.find((item: { event_type: string }) => item.event_type === 'agent_message_delta');
    expect(event).toMatchObject({ event_type: 'agent_message_delta' });
    expect(event).not.toHaveProperty('raw_ref');
  });

  it('returns the beginning-of-stream cursor for an empty backfill', async () => {
    const { app, runSessionId } = await track(seedAppWithEmptyRunSession());

    const response = await request(app.getHttpServer())
      .get(`/run-sessions/${runSessionId}/events`)
      .query({ actor_id: 'actor-owner' })
      .expect(200);

    expect(response.body).toEqual({
      events: [],
      next_cursor: '0000000000',
      has_more: false,
    });
  });

  it('bridges an empty backfill to live SSE with the returned next cursor', async () => {
    const { app, repo, runSessionId } = await track(seedAppWithEmptyRunSession());
    await new Promise<void>((resolve) => app.getHttpServer().listen(0, '127.0.0.1', resolve));

    const backfill = await request(app.getHttpServer())
      .get(`/run-sessions/${runSessionId}/events`)
      .query({ actor_id: 'actor-owner' })
      .expect(200);

    expect(backfill.body).toMatchObject({
      events: [],
      next_cursor: '0000000000',
      has_more: false,
    });

    const sseBody = await expectSseFirstEvent(
      app,
      `/run-sessions/${runSessionId}/events/stream?actor_id=actor-owner&after=${encodeURIComponent(backfill.body.next_cursor as string)}`,
      {},
      async () => {
        await repo.appendRunEvent({
          id: 'run-event-empty-backfill-live',
          run_session_id: runSessionId,
          event_type: 'agent_message_delta',
          source: 'codex',
          visibility: 'public',
          summary: 'First live event.',
          payload: { text: 'first' },
          created_at: '2026-05-07T00:00:04.000Z',
        });
      },
    );

    expect(sseBody).toContain('First live event.');
    expect(sseBody).toContain('agent_message_delta');
  });

  it('omits internal events from public backfill', async () => {
    const { app, runSessionId, repo } = await track(seedAppWithRunSession());
    await repo.appendRunEvent({
      id: 'run-event-internal',
      run_session_id: runSessionId,
      event_type: 'codex_warning',
      source: 'codex',
      visibility: 'internal',
      summary: 'Internal raw notification.',
      payload: { detail: 'hidden' },
      raw_ref: 'local://tmp/raw.jsonl',
      created_at: '2026-05-07T00:00:00.000Z',
    });

    const response = await request(app.getHttpServer())
      .get(`/run-sessions/${runSessionId}/events`)
      .query({ actor_id: 'actor-owner' })
      .expect(200);

    expect(response.body.events.map((event: { event_type: string }) => event.event_type)).toEqual(['run_queued']);
  });

  it('advances the backfill cursor past filtered internal trailing events', async () => {
    const { app, runSessionId, repo } = await track(seedAppWithRunSession());
    await repo.appendRunEvent({
      id: 'run-event-public',
      run_session_id: runSessionId,
      event_type: 'agent_message_delta',
      source: 'codex',
      visibility: 'public',
      summary: 'Codex output.',
      payload: { text: 'hello' },
      raw_ref: 'local://tmp/raw.jsonl',
      created_at: '2026-05-07T00:00:00.000Z',
    });
    const trailingInternalEvent = await repo.appendRunEvent({
      id: 'run-event-internal',
      run_session_id: runSessionId,
      event_type: 'codex_warning',
      source: 'codex',
      visibility: 'internal',
      summary: 'Internal raw notification.',
      payload: { detail: 'hidden' },
      raw_ref: 'local://tmp/raw.jsonl',
      created_at: '2026-05-07T00:00:01.000Z',
    });

    const response = await request(app.getHttpServer())
      .get(`/run-sessions/${runSessionId}/events`)
      .query({ actor_id: 'actor-owner' })
      .expect(200);

    expect(response.body.events.map((event: { event_type: string }) => event.event_type)).toEqual([
      'run_queued',
      'agent_message_delta',
    ]);
    expect(response.body.next_cursor).toBe(trailingInternalEvent.cursor);
    expect(response.body.has_more).toBe(false);
  });

  it('starts SSE without after at the live tail instead of replaying history', async () => {
    const { app, runSessionId, repo } = await track(seedAppWithRunSession());
    await new Promise<void>((resolve) => app.getHttpServer().listen(0, '127.0.0.1', resolve));

    const sseBody = await expectSseFirstEvent(
      app,
      `/run-sessions/${runSessionId}/events/stream?actor_id=actor-owner`,
      {},
      async () => {
        await repo.appendRunEvent({
          id: 'run-event-live-tail',
          run_session_id: runSessionId,
          event_type: 'agent_message_delta',
          source: 'codex',
          visibility: 'public',
          summary: 'Fresh live-tail event.',
          payload: { text: 'fresh' },
          raw_ref: 'local://tmp/raw.jsonl',
          created_at: '2026-05-07T00:00:01.000Z',
        });
      },
    );

    expect(sseBody).toContain('Fresh live-tail event.');
    expect(sseBody).toContain('agent_message_delta');
    expect(sseBody).not.toContain('Run queued.');
  });

  it('resumes SSE strictly after the provided cursor', async () => {
    const { app, runSessionId, repo } = await track(seedAppWithRunSession());
    const historicalEvent = await repo.appendRunEvent({
      id: 'run-event-after-cursor',
      run_session_id: runSessionId,
      event_type: 'agent_message_delta',
      source: 'codex',
      visibility: 'public',
      summary: 'Cursor checkpoint event.',
      payload: { text: 'checkpoint' },
      raw_ref: 'local://tmp/raw.jsonl',
      created_at: '2026-05-07T00:00:01.000Z',
    });
    const followupEvent = await repo.appendRunEvent({
      id: 'run-event-after-cursor-followup',
      run_session_id: runSessionId,
      event_type: 'agent_message_delta',
      source: 'codex',
      visibility: 'public',
      summary: 'Follow-up cursor event.',
      payload: { text: 'followup' },
      raw_ref: 'local://tmp/raw.jsonl',
      created_at: '2026-05-07T00:00:02.000Z',
    });
    await new Promise<void>((resolve) => app.getHttpServer().listen(0, '127.0.0.1', resolve));

    const sseBody = await expectSseFirstEvent(
      app,
      `/run-sessions/${runSessionId}/events/stream?actor_id=actor-owner&after=${encodeURIComponent(historicalEvent.cursor)}`,
    );

    expect(sseBody).toContain('Follow-up cursor event.');
    expect(sseBody).toContain(followupEvent.id);
    expect(sseBody).not.toContain('Cursor checkpoint event.');
  });

  it('redacts internal logs from run-session detail responses', async () => {
    const { app, runSessionId, repo } = await track(seedAppWithRunSession());
    const runSession = await repo.getRunSession(runSessionId);
    await repo.saveRunSession({
      ...runSession!,
      artifacts: [
        {
          kind: 'diff',
          name: 'Diff',
          content_type: 'text/x-patch',
          storage_uri: 's3://forgeloop-test/diff.patch',
          local_ref: 'artifacts/diff.patch',
        },
        { kind: 'logs', name: 'Raw Codex log', content_type: 'application/jsonl', local_ref: 'artifacts/raw-codex.jsonl' },
      ],
      log_refs: [{ kind: 'logs', name: 'Raw Codex log', content_type: 'application/jsonl', local_ref: 'artifacts/raw-codex.jsonl' }],
    });

    const response = await request(app.getHttpServer()).get(`/run-sessions/${runSessionId}`).expect(200);

    expect(response.body.artifacts.map((artifact: { kind: string }) => artifact.kind)).toEqual(['diff']);
    expect(response.body.artifacts[0]).toMatchObject({ storage_uri: 's3://forgeloop-test/diff.patch' });
    expect(response.body.log_refs ?? []).toEqual([]);
    expect(JSON.stringify(response.body)).not.toContain('local_ref');
    expect(JSON.stringify(response.body)).not.toContain('raw-codex.jsonl');
  });

  it('redacts executor raw metadata from run-session detail responses', async () => {
    const { app, runSessionId, repo } = await track(seedAppWithRunSession());
    const runSession = await repo.getRunSession(runSessionId);
    const stdoutRef = {
      kind: 'logs' as const,
      name: 'stdout',
      content_type: 'text/plain',
      local_ref: '/Users/viv/projs/forgeloop/.worktrees/run-session-1/stdout.log',
    };
    await repo.saveRunSession({
      ...runSession!,
      run_spec: {
        ...runSession!.run_spec!,
        repo: {
          ...runSession!.run_spec!.repo,
          local_path: '/Users/viv/projs/forgeloop',
        },
      },
      runtime_metadata: {
        ...runSession!.runtime_metadata!,
        workspace_path: '/Users/viv/projs/forgeloop/.worktrees/run-session-1',
        source_repo_path: '/Users/viv/projs/forgeloop',
        source_repo_before_status: ' M packages/secret.ts',
        effective_dangerous_mode: 'confirmed',
        app_server_endpoint: 'http://127.0.0.1:62000',
      },
      check_results: [
        {
          check_id: 'unit',
          command: 'pnpm test',
          status: 'succeeded',
          exit_code: 0,
          duration_seconds: 1,
          blocks_review: true,
          stdout: stdoutRef,
          stderr: {
            kind: 'raw_metadata',
            name: 'stderr',
            content_type: 'text/plain',
            local_ref: '/Users/viv/projs/forgeloop/.worktrees/run-session-1/stderr.log',
          },
        },
      ],
      executor_result: {
        run_session_id: runSessionId,
        executor_type: 'local_codex',
        executor_version: 'test-executor',
        status: 'succeeded',
        started_at: '2026-05-07T00:00:00.000Z',
        finished_at: '2026-05-07T00:01:00.000Z',
        summary: 'Completed.',
        changed_files: [],
        checks: [
          {
            check_id: 'unit',
            command: 'pnpm test',
            status: 'succeeded',
            exit_code: 0,
            duration_seconds: 1,
            blocks_review: true,
            stdout: stdoutRef,
          },
        ],
        artifacts: [],
        raw_metadata: {
          workspace_path: '/Users/viv/projs/forgeloop/.worktrees/run-session-1',
          source_repo_before_status: ' M packages/secret.ts',
          effective_dangerous_mode: 'dangerously-bypass-approvals-and-sandbox',
        },
      },
    });

    const response = await request(app.getHttpServer()).get(`/run-sessions/${runSessionId}`).expect(200);
    const serialized = JSON.stringify(response.body);

    expect(response.body).not.toHaveProperty('run_spec');
    expect(response.body.check_results[0]).not.toHaveProperty('stdout');
    expect(response.body.check_results[0]).not.toHaveProperty('stderr');
    expect(response.body.executor_result.checks[0]).not.toHaveProperty('stdout');
    expect(response.body.executor_result.raw_metadata).toEqual({});
    expect(response.body.runtime_metadata).not.toHaveProperty('workspace_path');
    expect(response.body.runtime_metadata).not.toHaveProperty('source_repo_path');
    expect(response.body.runtime_metadata).not.toHaveProperty('source_repo_before_status');
    expect(response.body.runtime_metadata).not.toHaveProperty('effective_dangerous_mode');
    expect(response.body.runtime_metadata).not.toHaveProperty('app_server_endpoint');
    expect(serialized).not.toContain('/Users/viv/projs');
    expect(serialized).not.toContain('run_spec');
    expect(serialized).not.toContain('source_repo_before_status');
    expect(serialized).not.toContain('dangerously-bypass-approvals-and-sandbox');
  });

  it('exposes non-secret worker lease metadata on run-session detail responses', async () => {
    const { app, runSessionId, repo } = await track(seedAppWithRunSession());
    await repo.claimRunWorkerLease({
      run_session_id: runSessionId,
      worker_id: 'worker-1',
      lease_token: 'lease-token-secret',
      now: '2026-05-07T00:01:00.000Z',
      expires_at: '2026-05-07T00:06:00.000Z',
    });

    const response = await request(app.getHttpServer()).get(`/run-sessions/${runSessionId}`).expect(200);

    expect(response.body.runtime_metadata).toMatchObject({
      worker_id: 'worker-1',
      worker_lease_status: 'active',
      worker_lease_heartbeat_at: '2026-05-07T00:01:00.000Z',
      worker_lease_expires_at: '2026-05-07T00:06:00.000Z',
    });
    expect(JSON.stringify(response.body)).not.toContain('lease-token-secret');
    expect(JSON.stringify(response.body)).not.toContain('lease_token');
  });

  it('rejects event backfill for actors who cannot view the work item', async () => {
    const { app, runSessionId } = await track(seedAppWithRunSession());

    await request(app.getHttpServer())
      .get(`/run-sessions/${runSessionId}/events`)
      .query({ actor_id: 'actor-stranger' })
      .expect(403);
  });

  it('rejects demo actor_id fallback when durable mode has no authenticated actor', async () => {
    const { app, runSessionId } = await track(
      seedAppWithRunSession({ durabilityMode: 'durable', allowDemoActorIdFallback: false }),
    );

    await request(app.getHttpServer()).get(`/run-sessions/${runSessionId}/events`).query({ actor_id: 'actor-owner' }).expect(401);
  });

  it('rejects unauthorized SSE viewers before opening the event stream', async () => {
    const { app, runSessionId } = await track(seedAppWithRunSession());

    await request(app.getHttpServer())
      .get(`/run-sessions/${runSessionId}/events/stream`)
      .set('Accept', 'text/event-stream')
      .query({ actor_id: 'actor-stranger' })
      .expect(403);
  });

  it('redacts raw log artifact refs from work item timeline responses', async () => {
    const { app, runSessionId, repo } = await track(seedAppWithRunSession());
    const runSession = await repo.getRunSession(runSessionId);
    const executionPackage = await repo.getExecutionPackage(runSession!.execution_package_id);
    await repo.saveArtifact({
      id: 'artifact-public-diff',
      object_type: 'run_session',
      object_id: runSessionId,
      ref: {
        kind: 'diff',
        name: 'Diff',
        content_type: 'text/x-patch',
        storage_uri: 's3://forgeloop-test/diff.patch',
        local_ref: 'artifacts/diff.patch',
      },
      created_at: '2026-05-07T00:00:00.000Z',
    });
    await repo.saveArtifact({
      id: 'artifact-raw-log',
      object_type: 'run_session',
      object_id: runSessionId,
      ref: { kind: 'logs', name: 'Raw Codex log', content_type: 'application/jsonl', local_ref: 'artifacts/raw-codex.jsonl' },
      created_at: '2026-05-07T00:00:01.000Z',
    });
    await repo.saveArtifact({
      id: 'artifact-raw-ref',
      object_type: 'run_session',
      object_id: runSessionId,
      ref: {
        kind: 'raw_metadata',
        name: 'Raw metadata',
        content_type: 'application/json',
        local_ref: 'artifacts/metadata.json',
        raw_ref: { local_ref: 'artifacts/internal-raw.jsonl' },
      } as never,
      created_at: '2026-05-07T00:00:02.000Z',
    });

    const response = await request(app.getHttpServer()).get(`/query/replay/work_item/${executionPackage!.work_item_id}`).expect(200);

    expect(response.body.filter((entry: { source: string }) => entry.source === 'artifact')).toEqual([
      expect.objectContaining({
        payload: {
          kind: 'diff',
          name: 'Diff',
          content_type: 'text/x-patch',
          storage_uri: 's3://forgeloop-test/diff.patch',
        },
      }),
    ]);
    expect(JSON.stringify(response.body)).not.toContain('local_ref');
    expect(JSON.stringify(response.body)).not.toContain('raw-codex.jsonl');
    expect(JSON.stringify(response.body)).not.toContain('raw_ref');
  });

  it('persists user input as a pending command before delivery', async () => {
    const { app, runSessionId, repo } = await track(seedAppWithRunSession());

    const response = await request(app.getHttpServer())
      .post(`/run-sessions/${runSessionId}/input`)
      .send({ actor_id: 'actor-owner', message: 'Continue with option B.' })
      .expect(201);

    expect(response.body).toMatchObject({ status: 'accepted', command_type: 'input' });
    await repo.claimRunWorkerLease({
      run_session_id: runSessionId,
      worker_id: 'worker-1',
      lease_token: 'lease-token-1',
      now: '2026-05-07T00:00:00.000Z',
      expires_at: '2026-05-07T00:05:00.000Z',
    });
    expect(await repo.claimNextRunCommand(runSessionId, 'worker-1', 'lease-token-1', '2026-05-07T00:00:00.000Z')).toMatchObject({
      command: { command_type: 'input' },
    });
  });

  it('rejects run operator commands from actors who are not owner or reviewer', async () => {
    const { app, runSessionId } = await track(seedAppWithRunSession());

    await request(app.getHttpServer())
      .post(`/run-sessions/${runSessionId}/input`)
      .send({ actor_id: 'actor-stranger', message: 'Cancel the current approach.' })
      .expect(403);
  });
});
