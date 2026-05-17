import { createHmac } from 'node:crypto';
import http from 'node:http';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { vi } from 'vitest';

import { AppModule } from '../../apps/control-plane-api/src/app.module';
import {
  actorClassHeaderName,
  actorSignatureHeaderName,
  actorTimestampHeaderName,
  trustedActorHeaderSignature,
  actorHeaderName as trustedActorHeaderName,
} from '../../apps/control-plane-api/src/modules/auth/actor-context';
import {
  DELIVERY_DEMO_ACTOR_ID_FALLBACK,
  DELIVERY_REPOSITORY,
  RUN_DURABILITY_MODE,
} from '../../apps/control-plane-api/src/modules/core/control-plane-tokens';
import { DELIVERY_RUN_WORKER } from '../../apps/control-plane-api/src/modules/run-control/run-worker.token';
import type { InMemoryDeliveryRepository } from '../../packages/db/src';
import { seedAppWithRunSession, seedReadyExecutionPackageThroughApi } from '../helpers/delivery-runtime-fixtures';

const actorHeaderName = 'X-Forgeloop-Actor-Id';
const actorOwner = 'actor-owner';
const actorReviewer = 'actor-reviewer';
const actorQa = 'actor-qa';
const actorStranger = 'actor-stranger';

const apps: INestApplication[] = [];

const track = async <T extends { app: INestApplication }>(value: Promise<T>): Promise<T> => {
  const resolved = await value;
  apps.push(resolved.app);
  return resolved;
};

const bootDurableApp = async (): Promise<{ app: INestApplication; repo: InMemoryDeliveryRepository }> => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DELIVERY_RUN_WORKER)
    .useValue({ kick: () => undefined, drainOnce: async () => undefined })
    .overrideProvider(RUN_DURABILITY_MODE)
    .useValue('durable')
    .overrideProvider(DELIVERY_DEMO_ACTOR_ID_FALLBACK)
    .useValue(false)
    .compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  return { app, repo: app.get(DELIVERY_REPOSITORY) as InMemoryDeliveryRepository };
};

const startDurableRun = async (
  app: INestApplication,
): Promise<{ executionPackageId: string; runSessionId: string }> => {
  const executionPackage = await seedReadyExecutionPackageThroughApi(app);
  const response = await request(app.getHttpServer())
    .post(`/execution-packages/${executionPackage.id}/run`)
    .set(actorHeaderName, actorOwner)
    .send({ requested_by_actor_id: actorStranger, workflow_only: true })
    .expect(201);

  return { executionPackageId: executionPackage.id, runSessionId: response.body.run_session_id as string };
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

const base64url = (value: string | Buffer): string => Buffer.from(value).toString('base64url');

const decodeTokenPayload = (token: string): Record<string, unknown> => {
  const [encodedPayload] = token.split('.');
  return JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as Record<string, unknown>;
};

const signedToken = (payload: Record<string, unknown>, secret: string): string => {
  const encodedPayload = base64url(JSON.stringify(payload));
  const signature = createHmac('sha256', secret).update(encodedPayload).digest('base64url');
  return `${encodedPayload}.${signature}`;
};

describe('durable run actor auth', () => {
  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it('requires authenticated actor context to start durable runs', async () => {
    const { app } = await track(bootDurableApp());
    const executionPackage = await seedReadyExecutionPackageThroughApi(app);

    await request(app.getHttpServer())
      .post(`/execution-packages/${executionPackage.id}/run`)
      .send({ requested_by_actor_id: actorOwner, workflow_only: true })
      .expect(401);

    await request(app.getHttpServer())
      .post(`/execution-packages/${executionPackage.id}/run`)
      .set(actorHeaderName, actorOwner)
      .send({ requested_by_actor_id: actorStranger, workflow_only: true })
      .expect(201);
  });

  it('uses authenticated viewer context for durable event backfill', async () => {
    const { app } = await track(bootDurableApp());
    const { runSessionId } = await startDurableRun(app);

    await request(app.getHttpServer())
      .get(`/run-sessions/${runSessionId}/events`)
      .set(actorHeaderName, actorStranger)
      .expect(403);

    await request(app.getHttpServer()).get(`/run-sessions/${runSessionId}/events`).query({ actor_id: actorOwner }).expect(401);

    await request(app.getHttpServer())
      .get(`/run-sessions/${runSessionId}/events`)
      .set(actorHeaderName, actorOwner)
      .expect(200);
  });

  it('uses authenticated operator context for durable input, cancel, and resume commands', async () => {
    const { app, repo } = await track(bootDurableApp());
    const { runSessionId } = await startDurableRun(app);

    await request(app.getHttpServer())
      .post(`/run-sessions/${runSessionId}/input`)
      .send({ actor_id: actorOwner, message: 'continue' })
      .expect(401);
    await request(app.getHttpServer())
      .post(`/run-sessions/${runSessionId}/cancel`)
      .send({ actor_id: actorOwner, reason: 'stop' })
      .expect(401);
    await request(app.getHttpServer())
      .post(`/run-sessions/${runSessionId}/resume`)
      .send({ actor_id: actorOwner, reason: 'resume' })
      .expect(401);

    await request(app.getHttpServer())
      .post(`/run-sessions/${runSessionId}/input`)
      .set(actorHeaderName, actorOwner)
      .send({ message: 'continue' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/run-sessions/${runSessionId}/cancel`)
      .set(actorHeaderName, actorOwner)
      .send({ reason: 'stop' })
      .expect(201);

    const { runSessionId: resumableRunSessionId } = await startDurableRun(app);
    const resumableRunSession = await repo.getRunSession(resumableRunSessionId);
    expect(resumableRunSession).toBeDefined();
    await repo.saveRunSession({ ...resumableRunSession!, status: 'waiting_for_input' });
    await request(app.getHttpServer())
      .post(`/run-sessions/${resumableRunSessionId}/resume`)
      .set(actorHeaderName, actorOwner)
      .send({ reason: 'resume' })
      .expect(201);
  });

  it('allows authenticated durable viewers but restricts operator-only commands', async () => {
    const { app } = await track(bootDurableApp());
    const { runSessionId } = await startDurableRun(app);

    await request(app.getHttpServer())
      .get(`/run-sessions/${runSessionId}/events`)
      .set(actorHeaderName, actorQa)
      .expect(200);
    await request(app.getHttpServer())
      .post(`/run-sessions/${runSessionId}/input`)
      .set(actorHeaderName, actorQa)
      .send({ message: 'continue' })
      .expect(403);
    await request(app.getHttpServer())
      .post(`/run-sessions/${runSessionId}/cancel`)
      .set(actorHeaderName, actorQa)
      .send({ reason: 'stop' })
      .expect(403);
    await request(app.getHttpServer())
      .post(`/run-sessions/${runSessionId}/resume`)
      .set(actorHeaderName, actorQa)
      .send({ reason: 'resume' })
      .expect(403);
  });

  it('creates short-lived stream tokens for authenticated durable viewers and accepts them for SSE', async () => {
    const { app, repo } = await track(bootDurableApp());
    const { runSessionId } = await startDurableRun(app);
    await new Promise<void>((resolve) => app.getHttpServer().listen(0, '127.0.0.1', resolve));

    const response = await request(app.getHttpServer())
      .post(`/run-sessions/${runSessionId}/events/stream-token`)
      .set(actorHeaderName, actorOwner)
      .send({})
      .expect(201);

    expect(response.body).toMatchObject({
      token: expect.any(String),
      expires_at: expect.any(String),
    });
    const tokenPayload = decodeTokenPayload(response.body.token as string);
    expect(tokenPayload).toMatchObject({
      run_session_id: runSessionId,
      actor_id: actorOwner,
      expires_at: response.body.expires_at,
      nonce: expect.any(String),
    });
    expect(tokenPayload.nonce).not.toBe('');

    const sseBody = await expectSseFirstEvent(
      app,
      `/run-sessions/${runSessionId}/events/stream?stream_token=${encodeURIComponent(response.body.token)}`,
      {},
      async () => {
        await repo.appendRunEvent({
          id: 'run-event-durable-stream-token',
          run_session_id: runSessionId,
          event_type: 'agent_message_delta',
          source: 'codex',
          visibility: 'public',
          summary: 'Durable stream token event.',
          payload: { text: 'durable' },
          created_at: '2026-05-07T00:00:03.000Z',
        });
      },
    );
    expect(sseBody).toContain('Durable stream token event.');
    expect(sseBody).toContain('agent_message_delta');
  });

  it('uses authenticated viewer context for durable SSE streams', async () => {
    const { app, repo } = await track(bootDurableApp());
    const { runSessionId } = await startDurableRun(app);
    await new Promise<void>((resolve) => app.getHttpServer().listen(0, '127.0.0.1', resolve));

    const sseBody = await expectSseFirstEvent(
      app,
      `/run-sessions/${runSessionId}/events/stream`,
      { [actorHeaderName]: actorOwner },
      async () => {
        await repo.appendRunEvent({
          id: 'run-event-durable-header-stream',
          run_session_id: runSessionId,
          event_type: 'agent_message_delta',
          source: 'codex',
          visibility: 'public',
          summary: 'Durable header stream event.',
          payload: { text: 'durable header' },
          created_at: '2026-05-07T00:00:04.000Z',
        });
      },
    );
    expect(sseBody).toContain('Durable header stream event.');
    expect(sseBody).toContain('agent_message_delta');
  });

  it('rejects body or query actor identity for durable stream-token creation', async () => {
    const { app } = await track(bootDurableApp());
    const { runSessionId } = await startDurableRun(app);

    await request(app.getHttpServer())
      .post(`/run-sessions/${runSessionId}/events/stream-token`)
      .query({ actor_id: actorOwner })
      .send({})
      .expect(401);
    await request(app.getHttpServer())
      .post(`/run-sessions/${runSessionId}/events/stream-token`)
      .send({ actor_id: actorOwner })
      .expect(401);
  });

  it('rejects durable SSE query actor identity without a token or authenticated actor header', async () => {
    const { app } = await track(bootDurableApp());
    const { runSessionId } = await startDurableRun(app);

    await request(app.getHttpServer())
      .get(`/run-sessions/${runSessionId}/events/stream`)
      .set('Accept', 'text/event-stream')
      .query({ actor_id: actorOwner })
      .expect(401);
  });

  it('rejects expired and wrong-run stream tokens', async () => {
    const { app } = await track(bootDurableApp());
    const { runSessionId } = await startDurableRun(app);
    const wrongRunToken = signedToken(
      {
        run_session_id: 'run-session-other',
        actor_id: actorOwner,
        expires_at: '2999-01-01T00:00:00.000Z',
        nonce: 'wrong-run-nonce',
      },
      'forgeloop-dev-auth-fallback',
    );
    const expiredToken = signedToken(
      {
        run_session_id: runSessionId,
        actor_id: actorOwner,
        expires_at: '2000-01-01T00:00:00.000Z',
        nonce: 'expired-nonce',
      },
      'forgeloop-dev-auth-fallback',
    );
    const emptyNonceToken = signedToken(
      {
        run_session_id: runSessionId,
        actor_id: actorOwner,
        expires_at: '2999-01-01T00:00:00.000Z',
        nonce: '',
      },
      'forgeloop-dev-auth-fallback',
    );

    await request(app.getHttpServer())
      .get(`/run-sessions/${runSessionId}/events/stream`)
      .set('Accept', 'text/event-stream')
      .query({ stream_token: wrongRunToken })
      .expect(401);
    await request(app.getHttpServer())
      .get(`/run-sessions/${runSessionId}/events/stream`)
      .set('Accept', 'text/event-stream')
      .query({ stream_token: expiredToken })
      .expect(401);
    await request(app.getHttpServer())
      .get(`/run-sessions/${runSessionId}/events/stream`)
      .set('Accept', 'text/event-stream')
      .query({ stream_token: emptyNonceToken })
      .expect(401);
  });

  it('rejects a stream token after sixty seconds of wall-clock time', async () => {
    const { app } = await track(bootDurableApp());
    const { runSessionId } = await startDurableRun(app);
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-05T00:00:00.000Z'));
    try {
      const response = await request(app.getHttpServer())
        .post(`/run-sessions/${runSessionId}/events/stream-token`)
        .set(actorHeaderName, actorOwner)
        .send({})
        .expect(201);

      await vi.advanceTimersByTimeAsync(61_000);

      await request(app.getHttpServer())
        .get(`/run-sessions/${runSessionId}/events`)
        .query({ stream_token: response.body.token })
        .expect(401);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports production configuration errors when stream-token secret is missing', async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalSecret = process.env.FORGELOOP_DEV_AUTH_SECRET;
    const originalTrustedActorSecret = process.env.FORGELOOP_TRUSTED_ACTOR_HEADER_SECRET;
    try {
      const { app } = await track(bootDurableApp());
      const { runSessionId } = await startDurableRun(app);
      process.env.NODE_ENV = 'production';
      delete process.env.FORGELOOP_DEV_AUTH_SECRET;
      const trustedActorSecret = 'trusted-actor-secret';
      process.env.FORGELOOP_TRUSTED_ACTOR_HEADER_SECRET = trustedActorSecret;
      const timestamp = new Date().toISOString();

      await request(app.getHttpServer())
        .post(`/run-sessions/${runSessionId}/events/stream-token`)
        .set(trustedActorHeaderName, actorOwner)
        .set(actorClassHeaderName, 'human_admin')
        .set(actorTimestampHeaderName, timestamp)
        .set(
          actorSignatureHeaderName,
          trustedActorHeaderSignature({ actorId: actorOwner, actorClass: 'human_admin', timestamp }, trustedActorSecret),
        )
        .send({})
        .expect(500);
    } finally {
      if (originalNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = originalNodeEnv;
      }
      if (originalSecret === undefined) {
        delete process.env.FORGELOOP_DEV_AUTH_SECRET;
      } else {
        process.env.FORGELOOP_DEV_AUTH_SECRET = originalSecret;
      }
      if (originalTrustedActorSecret === undefined) {
        delete process.env.FORGELOOP_TRUSTED_ACTOR_HEADER_SECRET;
      } else {
        process.env.FORGELOOP_TRUSTED_ACTOR_HEADER_SECRET = originalTrustedActorSecret;
      }
    }
  });

  it('uses deterministic fallback stream-token signing outside production', async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalSecret = process.env.FORGELOOP_DEV_AUTH_SECRET;
    process.env.NODE_ENV = 'test';
    delete process.env.FORGELOOP_DEV_AUTH_SECRET;
    try {
      const { app } = await track(bootDurableApp());
      const { runSessionId } = await startDurableRun(app);
      const response = await request(app.getHttpServer())
        .post(`/run-sessions/${runSessionId}/events/stream-token`)
        .set(actorHeaderName, actorOwner)
        .send({})
        .expect(201);

      await request(app.getHttpServer())
        .get(`/run-sessions/${runSessionId}/events`)
        .query({ stream_token: response.body.token })
        .expect(200);
    } finally {
      if (originalNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = originalNodeEnv;
      }
      if (originalSecret === undefined) {
        delete process.env.FORGELOOP_DEV_AUTH_SECRET;
      } else {
        process.env.FORGELOOP_DEV_AUTH_SECRET = originalSecret;
      }
    }
  });
});

describe('volatile demo actor fallback', () => {
  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it('still accepts body and query actor identity', async () => {
    const { app, runSessionId } = await track(seedAppWithRunSession());

    await request(app.getHttpServer()).get(`/run-sessions/${runSessionId}/events`).query({ actor_id: actorOwner }).expect(200);
    await request(app.getHttpServer())
      .post(`/run-sessions/${runSessionId}/input`)
      .send({ actor_id: actorOwner, message: 'continue' })
      .expect(201);
  });
});
