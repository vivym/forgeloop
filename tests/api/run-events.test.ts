import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';

import { seedAppWithRunSession } from '../helpers/p0-runtime-fixtures';

describe('run event API', () => {
  const apps: INestApplication[] = [];
  const track = async <T extends { app: INestApplication }>(value: Promise<T>): Promise<T> => {
    const resolved = await value;
    apps.push(resolved.app);
    return resolved;
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

  it('redacts internal logs from run-session detail responses', async () => {
    const { app, runSessionId, repo } = await track(seedAppWithRunSession());
    const runSession = await repo.getRunSession(runSessionId);
    await repo.saveRunSession({
      ...runSession!,
      artifacts: [
        { kind: 'diff', name: 'Diff', content_type: 'text/x-patch', local_ref: 'artifacts/diff.patch' },
        { kind: 'logs', name: 'Raw Codex log', content_type: 'application/jsonl', local_ref: 'artifacts/raw-codex.jsonl' },
      ],
      log_refs: [{ kind: 'logs', name: 'Raw Codex log', content_type: 'application/jsonl', local_ref: 'artifacts/raw-codex.jsonl' }],
    });

    const response = await request(app.getHttpServer()).get(`/run-sessions/${runSessionId}`).expect(200);

    expect(response.body.artifacts.map((artifact: { kind: string }) => artifact.kind)).toEqual(['diff']);
    expect(response.body.log_refs ?? []).toEqual([]);
    expect(JSON.stringify(response.body)).not.toContain('raw-codex.jsonl');
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
      ref: { kind: 'diff', name: 'Diff', content_type: 'text/x-patch', local_ref: 'artifacts/diff.patch' },
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

    const response = await request(app.getHttpServer()).get(`/work-items/${executionPackage!.work_item_id}/timeline`).expect(200);

    expect(response.body.filter((entry: { source: string }) => entry.source === 'artifact')).toEqual([
      expect.objectContaining({
        payload: {
          kind: 'diff',
          name: 'Diff',
          content_type: 'text/x-patch',
          local_ref: 'artifacts/diff.patch',
        },
      }),
    ]);
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
