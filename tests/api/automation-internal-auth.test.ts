import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../../apps/control-plane-api/src/app.module';
import { DELIVERY_RUN_WORKER } from '../../apps/control-plane-api/src/modules/run-control/run-worker.token';
import { signAutomationRequest } from '../../packages/automation/src/index';

const apps: INestApplication[] = [];

const track = async (app: INestApplication): Promise<INestApplication> => {
  apps.push(app);
  return app;
};

const bootAutomationApp = async (): Promise<{ app: INestApplication }> => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DELIVERY_RUN_WORKER)
    .useValue({ kick: () => undefined, drainOnce: async () => undefined })
    .compile();
  const app = await track(moduleRef.createNestApplication({ rawBody: true }));
  await app.init();
  return { app };
};

describe('internal automation actor auth', () => {
  beforeEach(() => {
    vi.stubEnv('FORGELOOP_TRUSTED_ACTOR_HEADER_SECRET', 'test-secret');
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it('rejects unsigned internal automation requests', async () => {
    const { app } = await bootAutomationApp();

    await request(app.getHttpServer()).get('/internal/automation/runtime-snapshot').expect(401);
  });

  it('rejects unsigned Spec draft command requests', async () => {
    const { app } = await bootAutomationApp();

    await request(app.getHttpServer()).post('/internal/automation/work-items/work-item-auth/ensure-spec-draft').send({}).expect(401);
  });

  it('rejects signed non-daemon actors', async () => {
    const { app } = await bootAutomationApp();
    const timestamp = new Date().toISOString();
    const headers = signAutomationRequest({
      method: 'GET',
      pathAndQuery: '/internal/automation/runtime-snapshot',
      rawBody: Buffer.alloc(0),
      actorId: 'admin-actor',
      actorClass: 'human_admin',
      daemonIdentity: 'not-a-daemon',
      timestamp,
      secret: 'test-secret',
    });

    await request(app.getHttpServer()).get('/internal/automation/runtime-snapshot').set(headers).expect(403);
  });

  it('accepts a signed automation daemon request', async () => {
    const { app } = await bootAutomationApp();
    const timestamp = new Date().toISOString();
    const headers = signAutomationRequest({
      method: 'GET',
      pathAndQuery: '/internal/automation/runtime-snapshot',
      rawBody: Buffer.alloc(0),
      actorId: 'daemon-actor',
      actorClass: 'automation_daemon',
      daemonIdentity: 'daemon-1',
      timestamp,
      secret: 'test-secret',
    });

    await request(app.getHttpServer()).get('/internal/automation/runtime-snapshot').set(headers).expect(200);
  });

  it('rejects an expired automation daemon signature', async () => {
    const { app } = await bootAutomationApp();
    const timestamp = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const headers = signAutomationRequest({
      method: 'GET',
      pathAndQuery: '/internal/automation/runtime-snapshot',
      rawBody: Buffer.alloc(0),
      actorId: 'daemon-actor',
      actorClass: 'automation_daemon',
      daemonIdentity: 'daemon-1',
      timestamp,
      secret: 'test-secret',
    });

    await request(app.getHttpServer()).get('/internal/automation/runtime-snapshot').set(headers).expect(401);
  });

  it('rejects a changed body hash', async () => {
    const { app } = await bootAutomationApp();
    const timestamp = new Date().toISOString();
    const headers = signAutomationRequest({
      method: 'POST',
      pathAndQuery: '/internal/automation/actions',
      rawBody: Buffer.from('{"a":1}'),
      actorId: 'daemon-actor',
      actorClass: 'automation_daemon',
      daemonIdentity: 'daemon-1',
      timestamp,
      secret: 'test-secret',
    });

    await request(app.getHttpServer()).post('/internal/automation/actions').set(headers).send({ a: 2 }).expect(401);
  });

  it('accepts a signed automation daemon request with an exact JSON body', async () => {
    const { app } = await bootAutomationApp();
    const timestamp = new Date().toISOString();
    const rawBody =
      '{"id":"auth-exact-body-action","action_type":"ensure_plan_draft","target_object_type":"work_item","target_object_id":"work-item-auth","target_revision_id":"spec-revision-auth","target_status":"approved","idempotency_key":"auth-exact-body-action-key","automation_scope":"repo:project-auth:repo-1","automation_settings_version":1,"capability_fingerprint":"capability-auth","precondition_fingerprint":"precondition-auth","action_input_json":{"work_item_id":"work-item-auth","spec_revision_id":"spec-revision-auth"}}';
    const headers = signAutomationRequest({
      method: 'POST',
      pathAndQuery: '/internal/automation/actions',
      rawBody,
      actorId: 'daemon-actor',
      actorClass: 'automation_daemon',
      daemonIdentity: 'daemon-1',
      timestamp,
      secret: 'test-secret',
    });

    await request(app.getHttpServer())
      .post('/internal/automation/actions')
      .set(headers)
      .set('Content-Type', 'application/json')
      .send(rawBody)
      .expect(201)
      .expect(({ body }) => {
        expect(body.action).toMatchObject({ id: 'auth-exact-body-action', status: 'pending' });
      });
  });

  it('authenticates signed Spec draft command requests with an exact JSON body before claim validation', async () => {
    const { app } = await bootAutomationApp();
    const timestamp = new Date().toISOString();
    const rawBody =
      '{"action_run_id":"auth-spec-draft-action","claim_token":"auth-spec-draft-claim","idempotency_key":"auth-spec-draft-key","automation_precondition":{"automation_scope":"repo:project-auth:repo-1","project_id":"project-auth","repo_id":"repo-1","automation_settings_version":1,"capability_fingerprint":"capability-auth","required_capability":"canGenerateSpecDraft","actor_class":"automation_daemon","daemon_identity":"daemon-1"},"generated_spec_draft":{"schema_version":"spec_draft.v1","summary":"Generated spec summary","content":"Generated spec content","background":"Generated background","goals":["Goal 1"],"scope_in":["Scope in"],"scope_out":["Scope out"],"acceptance_criteria":["Criterion 1"],"risk_notes":[],"test_strategy_summary":"Run API and daemon tests."},"generation_artifacts":[]}';
    const headers = signAutomationRequest({
      method: 'POST',
      pathAndQuery: '/internal/automation/work-items/work-item-auth/ensure-spec-draft',
      rawBody,
      actorId: 'daemon-actor',
      actorClass: 'automation_daemon',
      daemonIdentity: 'daemon-1',
      timestamp,
      secret: 'test-secret',
    });

    await request(app.getHttpServer())
      .post('/internal/automation/work-items/work-item-auth/ensure-spec-draft')
      .set(headers)
      .set('Content-Type', 'application/json')
      .send(rawBody)
      .expect(409);
  });

  it('rejects an altered query string', async () => {
    const { app } = await bootAutomationApp();
    const timestamp = new Date().toISOString();
    const headers = signAutomationRequest({
      method: 'GET',
      pathAndQuery: '/internal/automation/runtime-snapshot?scope=repo-a',
      rawBody: Buffer.alloc(0),
      actorId: 'daemon-actor',
      actorClass: 'automation_daemon',
      daemonIdentity: 'daemon-1',
      timestamp,
      secret: 'test-secret',
    });

    await request(app.getHttpServer())
      .get('/internal/automation/runtime-snapshot?scope=repo-b')
      .set(headers)
      .expect(401);
  });
});
