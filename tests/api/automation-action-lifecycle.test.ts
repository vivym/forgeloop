import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AppModule } from '../../apps/control-plane-api/src/app.module';
import { DELIVERY_REPOSITORY } from '../../apps/control-plane-api/src/modules/core/control-plane-tokens';
import { DELIVERY_RUN_WORKER } from '../../apps/control-plane-api/src/modules/run-control/run-worker.token';
import { InMemoryDeliveryRepository, type DeliveryRepository } from '../../packages/db/src/index';
import { signAutomationRequest } from '../../packages/automation/src/index';

const secret = 'test-secret';
const actorId = 'daemon-actor';
const daemonIdentity = 'daemon-1';
const now = '2026-05-05T00:00:00.000Z';
const later = '2026-05-05T00:01:00.000Z';
const future = '2026-05-05T00:10:00.000Z';
const expiredLeaseNow = '2026-05-05T00:00:02.000Z';
const tenMinuteLeaseMs = 10 * 60 * 1000;
const rawSecretPath = '/Users/viv/projs/forgeloop/.worktrees/feature/http-automation-daemon-mvp-impl';

const apps: INestApplication[] = [];

const bootAutomationApp = async (): Promise<{ app: INestApplication; repository: DeliveryRepository }> => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DELIVERY_REPOSITORY)
    .useValue(new InMemoryDeliveryRepository())
    .overrideProvider(DELIVERY_RUN_WORKER)
    .useValue({ kick: () => undefined, drainOnce: async () => undefined })
    .compile();
  const app = moduleRef.createNestApplication({ rawBody: true });
  await app.init();
  apps.push(app);
  return { app, repository: app.get(DELIVERY_REPOSITORY) as DeliveryRepository };
};

const signedPost = (app: INestApplication, pathAndQuery: string, body: Record<string, unknown>) => {
  const rawBody = JSON.stringify(body);
  const headers = signAutomationRequest({
    method: 'POST',
    pathAndQuery,
    rawBody,
    actorId,
    actorClass: 'automation_daemon',
    daemonIdentity,
    timestamp: new Date().toISOString(),
    secret,
  });

  return request(app.getHttpServer())
    .post(pathAndQuery)
    .set(headers)
    .set('Content-Type', 'application/json')
    .send(rawBody);
};

const createActionBody = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  action_type: 'ensure_plan_draft',
  target_object_type: 'work_item',
  target_object_id: 'work-item-1',
  target_revision_id: 'spec-revision-1',
  target_status: 'approved',
  idempotency_key: `${id}-idempotency`,
  automation_scope: 'repo:project-1:repo-1',
  automation_settings_version: 1,
  capability_fingerprint: 'capability-fingerprint-1',
  precondition_fingerprint: 'precondition-fingerprint-1',
  action_input_json: {
    work_item_id: 'work-item-1',
    spec_revision_id: 'spec-revision-1',
  },
  ...overrides,
});

const claimNextBody = (claimToken: string, overrides: Record<string, unknown> = {}) => ({
  claim_token: claimToken,
  lease_ms: tenMinuteLeaseMs,
  limit: 10,
  ...overrides,
});

const createAndClaim = async (
  app: INestApplication,
  id: string,
  claimToken: string,
  claimOverrides: Record<string, unknown> = {},
) => {
  await signedPost(app, '/internal/automation/actions', createActionBody(id)).expect(201);
  const response = await signedPost(
    app,
    '/internal/automation/actions:claim-next',
    claimNextBody(claimToken, claimOverrides),
  ).expect(200);
  return response.body.action as { id: string; idempotency_key: string; claim_token: string };
};

const expectPublicAction = (action: Record<string, unknown>) => {
  expect(action).not.toHaveProperty('result_json');
  expect(action).not.toHaveProperty('metadata_json');
  expect(action).not.toHaveProperty('error_message');
  expect(JSON.stringify(action)).not.toContain(rawSecretPath);
  expect(JSON.stringify(action)).not.toContain('stack');
  expect(JSON.stringify(action)).not.toContain('DomainError');
};

describe('internal automation action lifecycle', () => {
  beforeEach(() => {
    process.env.TZ = 'UTC';
    process.env.FORGELOOP_TRUSTED_ACTOR_HEADER_SECRET = secret;
    process.env.FORGELOOP_AUTOMATION_TEST_NOW = now;
  });

  afterEach(async () => {
    delete process.env.FORGELOOP_TRUSTED_ACTOR_HEADER_SECRET;
    delete process.env.FORGELOOP_AUTOMATION_TEST_NOW;
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it('creates a pending action row from a signed create request', async () => {
    const { app, repository } = await bootAutomationApp();

    const response = await signedPost(app, '/internal/automation/actions', createActionBody('action-create')).expect(201);

    expect(response.body.action).toMatchObject({
      id: 'action-create',
      action_type: 'ensure_plan_draft',
      target_object_type: 'work_item',
      target_object_id: 'work-item-1',
      status: 'pending',
      attempt: 0,
      action_input_json: {
        work_item_id: 'work-item-1',
        spec_revision_id: 'spec-revision-1',
      },
    });
    expect(response.body.action).not.toHaveProperty('claim_token');
    expectPublicAction(response.body.action);

    await expect(repository.listClaimableAutomationActionRuns({ now: later, limit: 5 })).resolves.toMatchObject([
      { id: 'action-create', status: 'pending' },
    ]);
  });

  it('accepts a project runtime snapshot action with loaded policy and no reason code', async () => {
    const { app } = await bootAutomationApp();

    const response = await signedPost(
      app,
      '/internal/automation/actions',
      createActionBody('snapshot-loaded-policy', {
        action_type: 'project_runtime_snapshot',
        target_object_type: 'repo',
        target_object_id: 'repo-1',
        target_revision_id: undefined,
        target_status: 'observed',
        idempotency_key: 'snapshot-loaded-policy-idempotency',
        action_input_json: {
          repo_id: 'repo-1',
          policy_status: 'loaded',
          policy_digest: 'policy-digest-1',
          parser_version: 'workflow-md-parser:v1',
        },
      }),
    ).expect(201);

    expect(response.body.action).toMatchObject({
      id: 'snapshot-loaded-policy',
      action_type: 'project_runtime_snapshot',
      action_input_json: {
        repo_id: 'repo-1',
        policy_status: 'loaded',
        policy_digest: 'policy-digest-1',
        parser_version: 'workflow-md-parser:v1',
      },
    });
  });

  it('replays a matching idempotency key with the same public DTO', async () => {
    const { app } = await bootAutomationApp();
    const body = createActionBody('action-replay');

    const first = await signedPost(app, '/internal/automation/actions', body).expect(201);
    const second = await signedPost(app, '/internal/automation/actions', body).expect(201);

    expect(second.body).toEqual(first.body);
    expectPublicAction(second.body.action);
  });

  it('returns a stable conflict DTO for idempotency identity mismatches', async () => {
    const { app } = await bootAutomationApp();
    const body = createActionBody('action-conflict');

    await signedPost(app, '/internal/automation/actions', body).expect(201);
    const response = await signedPost(app, '/internal/automation/actions', {
      ...body,
      target_revision_id: 'spec-revision-2',
      action_input_json: {
        work_item_id: 'work-item-1',
        spec_revision_id: 'spec-revision-2',
      },
    }).expect(409);

    expect(response.body).toEqual({
      code: 'command_idempotency_conflict',
      message: 'Automation action idempotency identity changed.',
    });
    expect(JSON.stringify(response.body)).not.toContain('DomainError');
    expect(JSON.stringify(response.body)).not.toContain('stack');
  });

  it('rejects create requests that omit action_input_json', async () => {
    const { app } = await bootAutomationApp();
    const { action_input_json: _actionInputJson, ...body } = createActionBody('action-missing-input');

    const response = await signedPost(app, '/internal/automation/actions', body).expect((res) => {
      expect([400, 422]).toContain(res.status);
    });

    expect(JSON.stringify(response.body)).not.toContain('DomainError');
    expect(JSON.stringify(response.body)).not.toContain('stack');
  });

  it('claims the next action with a claim token and returns null when nothing is claimable', async () => {
    const { app } = await bootAutomationApp();
    await signedPost(app, '/internal/automation/actions', createActionBody('action-claim')).expect(201);

    const claimed = await signedPost(
      app,
      '/internal/automation/actions:claim-next',
      claimNextBody('claim-token-1'),
    ).expect(200);
    expect(claimed.body.action).toMatchObject({
      id: 'action-claim',
      status: 'running',
      claim_token: 'claim-token-1',
      locked_until: future,
      attempt: 1,
    });
    expectPublicAction(claimed.body.action);

    const none = await signedPost(app, '/internal/automation/actions:claim-next', claimNextBody('claim-token-2')).expect(200);
    expect(none.body).toEqual({ action: null });
  });

  it('treats actions:claim-next as a literal route', async () => {
    const { app } = await bootAutomationApp();
    await signedPost(app, '/internal/automation/actions', createActionBody('action-route-literal')).expect(201);

    await signedPost(app, '/internal/automation/actionsXYZ-next', claimNextBody('literal-route-claim')).expect(404);
  });

  it('does not accept client-controlled claim timestamps or explicit lock deadlines', async () => {
    const { app } = await bootAutomationApp();
    await signedPost(app, '/internal/automation/actions', createActionBody('action-client-clock')).expect(201);

    await signedPost(
      app,
      '/internal/automation/actions:claim-next',
      claimNextBody('client-clock-claim', {
        now: '2026-05-06T00:00:00.000Z',
        locked_until: '2026-05-06T00:10:00.000Z',
      }),
    ).expect(400);
  });

  it('honors project, repo, and scope claim filters', async () => {
    const { app } = await bootAutomationApp();
    await signedPost(
      app,
      '/internal/automation/actions',
      createActionBody('action-repo-1', { automation_scope: 'repo:project-a:repo-1', idempotency_key: 'action-repo-1-key' }),
    ).expect(201);
    await signedPost(
      app,
      '/internal/automation/actions',
      createActionBody('action-repo-2', {
        automation_scope: 'repo:project-a:repo-2',
        target_object_id: 'work-item-2',
        idempotency_key: 'action-repo-2-key',
        action_input_json: { work_item_id: 'work-item-2', spec_revision_id: 'spec-revision-1' },
      }),
    ).expect(201);

    const claimed = await signedPost(
      app,
      '/internal/automation/actions:claim-next',
      claimNextBody('filter-claim', {
        project_id: 'project-a',
        repo_id: 'repo-1',
        automation_scope: 'repo:project-a:repo-1',
      }),
    ).expect(200);
    expect(claimed.body.action.id).toBe('action-repo-1');

    const isolated = await signedPost(
      app,
      '/internal/automation/actions:claim-next',
      claimNextBody('filter-empty', {
        project_id: 'project-b',
        repo_id: 'repo-9',
        automation_scope: 'repo:project-b:repo-9',
      }),
    ).expect(200);
    expect(isolated.body).toEqual({ action: null });
  });

  it('requires the correct claim token for complete, gate-pending, block, and fail', async () => {
    const { app } = await bootAutomationApp();
    const cases = [
      {
        id: 'action-complete-token',
        path: '/internal/automation/actions/action-complete-token/complete',
        body: { result_json: { summary: 'Plan draft created', local_path: rawSecretPath } },
        expectedStatus: 'succeeded',
      },
      {
        id: 'action-gate-token',
        path: '/internal/automation/actions/action-gate-token/gate-pending',
        body: { reason: 'manual_path_hold_active', next_attempt_at: future },
        expectedStatus: 'gate_pending',
      },
      {
        id: 'action-block-token',
        path: '/internal/automation/actions/action-block-token/block',
        body: { result_json: { command_output: 'raw output', local_path: rawSecretPath } },
        expectedStatus: 'blocked',
      },
      {
        id: 'action-fail-token',
        path: '/internal/automation/actions/action-fail-token/fail',
        body: { retryable: true, next_attempt_at: future, result_json: { raw_error: 'stack trace', local_path: rawSecretPath } },
        expectedStatus: 'failed',
      },
    ];

    for (const testCase of cases) {
      const claimed = await createAndClaim(app, testCase.id, `${testCase.id}-claim`);
      await signedPost(app, testCase.path, {
        claim_token: 'wrong-claim-token',
        idempotency_key: claimed.idempotency_key,
        ...testCase.body,
      }).expect(409);

      const completed = await signedPost(app, testCase.path, {
        claim_token: claimed.claim_token,
        idempotency_key: claimed.idempotency_key,
        ...testCase.body,
      }).expect(200);
      expect(completed.body.action.status).toBe(testCase.expectedStatus);
      expectPublicAction(completed.body.action);
    }
  });

  it('rejects complete, gate-pending, block, and fail when the matching claim lease is expired', async () => {
    const { app } = await bootAutomationApp();
    const cases = [
      { id: 'action-complete-expired', path: '/internal/automation/actions/action-complete-expired/complete', body: {} },
      {
        id: 'action-gate-expired',
        path: '/internal/automation/actions/action-gate-expired/gate-pending',
        body: { reason: 'manual_path_hold_active' },
      },
      { id: 'action-block-expired', path: '/internal/automation/actions/action-block-expired/block', body: {} },
      { id: 'action-fail-expired', path: '/internal/automation/actions/action-fail-expired/fail', body: { retryable: false } },
    ];

    for (const testCase of cases) {
      process.env.FORGELOOP_AUTOMATION_TEST_NOW = now;
      const claimed = await createAndClaim(app, testCase.id, `${testCase.id}-claim`, {
        lease_ms: 1000,
      });
      process.env.FORGELOOP_AUTOMATION_TEST_NOW = expiredLeaseNow;

      const response = await signedPost(app, testCase.path, {
        claim_token: claimed.claim_token,
        idempotency_key: claimed.idempotency_key,
        ...testCase.body,
      }).expect(409);
      expect(JSON.stringify(response.body)).not.toContain('DomainError');
      expect(JSON.stringify(response.body)).not.toContain('stack');
    }
  });

  it('does not let a daemon backdate terminal action time to bypass an expired lease', async () => {
    const { app } = await bootAutomationApp();
    const claimed = await createAndClaim(app, 'action-backdate-expired', 'action-backdate-expired-claim', {
      lease_ms: 1000,
    });
    process.env.FORGELOOP_AUTOMATION_TEST_NOW = expiredLeaseNow;

    await signedPost(app, '/internal/automation/actions/action-backdate-expired/complete', {
      claim_token: claimed.claim_token,
      idempotency_key: claimed.idempotency_key,
      now,
    }).expect(400);
  });
});
