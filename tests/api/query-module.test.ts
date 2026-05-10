import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import type { RunSession } from '@forgeloop/domain';

import { AppModule } from '../../apps/control-plane-api/src/app.module';
import { QueryController } from '../../apps/control-plane-api/src/modules/query/query.controller';
import { RUN_DURABILITY_MODE, RUN_WORKER } from '../../apps/control-plane-api/src/p0/p0.service';
import { P0_REPOSITORY } from '../../apps/control-plane-api/src/p0/p0.service';
import { InMemoryP0Repository } from '../../packages/db/src/index';
import { seedReadyExecutionPackageThroughApi } from '../helpers/p0-runtime-fixtures';

describe('query module', () => {
  const apps: INestApplication[] = [];

  const track = async <T extends { app: INestApplication }>(value: Promise<T>): Promise<T> => {
    const resolved = await value;
    apps.push(resolved.app);
    return resolved;
  };

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  const createTestApp = async (options: { durabilityMode?: 'durable' | 'volatile_demo' } = {}) => {
    const repo = new InMemoryP0Repository();
    let moduleBuilder = Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(P0_REPOSITORY)
      .useValue(repo)
      .overrideProvider(RUN_WORKER)
      .useValue({ kick: () => undefined, drainOnce: async () => undefined });
    if (options.durabilityMode !== undefined) {
      moduleBuilder = moduleBuilder.overrideProvider(RUN_DURABILITY_MODE).useValue(options.durabilityMode);
    }
    const moduleRef = await moduleBuilder.compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    return { app, repo };
  };

  it('returns the work item cockpit from the query surface', async () => {
    const { app } = await track(createTestApp());
    const executionPackage = await seedReadyExecutionPackageThroughApi(app);

    const response = await request(app.getHttpServer())
      .get(`/query/work-item-cockpit/${executionPackage.work_item_id}`)
      .expect(200);

    expect(response.body.work_item).toMatchObject({ id: executionPackage.work_item_id });
    expect(response.body.packages).toEqual([expect.objectContaining({ id: executionPackage.id })]);
    expect(response.body.run_sessions).toEqual(expect.any(Array));
    expect(response.body.review_packets).toEqual(expect.any(Array));
    expect(response.body.next_actions).toEqual(expect.any(Array));
    expect(response.body.completion_state).toEqual(expect.any(Object));
  });

  it('returns 404 for a missing work item cockpit', async () => {
    const { app } = await track(createTestApp());

    await request(app.getHttpServer()).get('/query/work-item-cockpit/missing-work-item').expect(404);
  });

  it('does not depend on emitted constructor metadata to inject query routes', async () => {
    const metadataReflect = Reflect as typeof Reflect & {
      deleteMetadata?: (metadataKey: string, target: object) => boolean;
      defineMetadata?: (metadataKey: string, metadataValue: unknown, target: object) => void;
      getMetadata?: (metadataKey: string, target: object) => unknown;
    };
    const existingParamTypes = metadataReflect.getMetadata?.('design:paramtypes', QueryController);
    metadataReflect.deleteMetadata?.('design:paramtypes', QueryController);

    try {
      const { app } = await track(createTestApp());

      await request(app.getHttpServer()).get('/query/work-item-cockpit/missing-work-item').expect(404);
    } finally {
      if (existingParamTypes !== undefined) {
        metadataReflect.defineMetadata?.('design:paramtypes', existingParamTypes, QueryController);
      }
    }
  });

  it('returns the work item replay from the query surface', async () => {
    const { app } = await track(createTestApp());
    const executionPackage = await seedReadyExecutionPackageThroughApi(app);

    const response = await request(app.getHttpServer())
      .get(`/query/replay/work_item/${executionPackage.work_item_id}`)
      .expect(200);

    expect(response.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'object_event',
          object_type: 'work_item',
          object_id: executionPackage.work_item_id,
        }),
        expect.objectContaining({
          object_type: 'execution_package',
          object_id: executionPackage.id,
        }),
      ]),
    );
  });

  it('serializes replay payloads through the public evidence boundary', async () => {
    const { app, repo } = await track(createTestApp());
    const executionPackage = await seedReadyExecutionPackageThroughApi(app);
    const workItemId = executionPackage.work_item_id;
    const createdAt = '2026-05-10T00:00:00.000Z';

    await repo.appendObjectEvent({
      id: 'object-event-public-boundary',
      object_type: 'work_item',
      object_id: workItemId,
      event_type: 'work_item_public_boundary',
      actor_type: 'system',
      actor_id: 'actor-system',
      reason: 'test',
      metadata: { internal_payload: 'not public' },
      payload: {
        work_item_id: workItemId,
        required_check_ids: ['contracts', 123],
        accessToken: 'secret',
        output_path: '/Users/viv/out.log',
        unknown: 'drop me',
      },
      created_at: createdAt,
    });
    await repo.appendStatusHistory({
      id: 'status-history-public-boundary',
      object_type: 'work_item',
      object_id: workItemId,
      to_status: 'ready',
      context: {
        work_item_id: workItemId,
        failed_check_ids: ['api', false],
        client_secret: 'secret',
        path: 'artifacts/run/out.log',
      },
      created_at: createdAt,
    });
    await repo.saveDecision({
      id: 'decision-public-boundary',
      object_type: 'work_item',
      object_id: workItemId,
      actor_id: 'actor-reviewer',
      decision: 'approved',
      summary: 'Approved',
      evidence_refs: { raw_ref: 'local://decision/raw.json' },
      created_at: createdAt,
    });
    await repo.saveArtifact({
      id: 'artifact-unsafe-uri',
      object_type: 'work_item',
      object_id: workItemId,
      ref: {
        kind: 'diff',
        name: 'Unsafe patch',
        content_type: 'text/x-patch',
        storage_uri: 'https://example.test/out.patch?token=secret',
      },
      created_at: createdAt,
    });
    await repo.saveArtifact({
      id: 'artifact-safe-uri',
      object_type: 'work_item',
      object_id: workItemId,
      ref: {
        kind: 'diff',
        name: 'Safe patch',
        content_type: 'text/x-patch',
        storage_uri: 'https://example.test/out.patch',
        local_ref: '/Users/viv/private/out.patch',
        digest: 'sha256:1234',
      },
      created_at: createdAt,
    });

    const response = await request(app.getHttpServer()).get(`/query/replay/work_item/${workItemId}`).expect(200);
    const serialized = JSON.stringify(response.body);

    expect(serialized).not.toContain('accessToken');
    expect(serialized).not.toContain('client_secret');
    expect(serialized).not.toContain('/Users/');
    expect(serialized).not.toContain('artifacts/run/out.log');
    expect(serialized).not.toContain('raw_ref');
    expect(serialized).not.toContain('token=secret');

    expect(response.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'object-event-public-boundary',
          source: 'object_event',
          payload: expect.objectContaining({
            payload: { work_item_id: workItemId, required_check_ids: ['contracts'] },
          }),
        }),
        expect.objectContaining({
          id: 'status-history-public-boundary',
          source: 'status_history',
          payload: expect.objectContaining({
            context: { work_item_id: workItemId, failed_check_ids: ['api'] },
          }),
        }),
        expect.objectContaining({
          id: 'decision-public-boundary',
          source: 'decision',
          payload: expect.not.objectContaining({ evidence_refs: expect.anything() }),
        }),
        expect.objectContaining({
          id: 'artifact-safe-uri',
          source: 'artifact',
          payload: {
            kind: 'diff',
            name: 'Safe patch',
            content_type: 'text/x-patch',
            storage_uri: 'https://example.test/out.patch',
            digest: 'sha256:1234',
          },
        }),
      ]),
    );

    expect(response.body).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: 'artifact-unsafe-uri' })]));
  });

  it('returns 404 for a missing supported replay object', async () => {
    const { app } = await track(createTestApp());

    await request(app.getHttpServer()).get('/query/replay/work_item/missing-work-item').expect(404);
  });

  it('rejects unsupported replay object types before lookup', async () => {
    const { app } = await track(createTestApp());

    const response = await request(app.getHttpServer()).get('/query/replay/release/missing-release').expect(400);

    expect(response.body.message).toContain('Unsupported replay object type');
  });

  it('does not expose legacy work item read routes', async () => {
    const { app } = await track(createTestApp());
    const executionPackage = await seedReadyExecutionPackageThroughApi(app);

    await request(app.getHttpServer()).get(`/work-items/${executionPackage.work_item_id}/cockpit`).expect(404);
    await request(app.getHttpServer()).get(`/work-items/${executionPackage.work_item_id}/timeline`).expect(404);
  });

  it('preserves durable runtime metadata fallback when a leased run has no persisted runtime metadata', async () => {
    const { app, repo } = await track(createTestApp({ durabilityMode: 'durable' }));
    const executionPackage = await seedReadyExecutionPackageThroughApi(app);
    const runSession: RunSession = {
      id: 'run-session-with-legacy-metadata',
      execution_package_id: executionPackage.id,
      requested_by_actor_id: 'actor-owner',
      status: 'running',
      executor_type: 'mock',
      changed_files: [],
      check_results: [],
      artifacts: [],
      log_refs: [],
      created_at: '2026-05-05T00:10:00.000Z',
      updated_at: '2026-05-05T00:10:00.000Z',
    };

    await repo.saveRunSession(runSession);
    await repo.claimRunWorkerLease({
      run_session_id: runSession.id,
      worker_id: 'worker-1',
      lease_token: 'lease-token-1',
      now: '2026-05-05T00:10:01.000Z',
      expires_at: '2026-05-05T00:11:01.000Z',
    });

    const response = await request(app.getHttpServer())
      .get(`/query/work-item-cockpit/${executionPackage.work_item_id}`)
      .expect(200);

    expect(response.body.run_sessions[0].runtime_metadata).toMatchObject({
      durability_mode: 'durable',
      worker_id: 'worker-1',
      worker_lease_status: 'active',
    });
  });
});
