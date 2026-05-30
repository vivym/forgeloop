import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../../apps/control-plane-api/src/app.module';
import { DELIVERY_REPOSITORY } from '../../apps/control-plane-api/src/modules/core/control-plane-tokens';
import { DELIVERY_RUN_WORKER } from '../../apps/control-plane-api/src/modules/run-control/run-worker.token';
import { signAutomationRequest } from '../../packages/automation/src/index';
import { InMemoryDeliveryRepository, type DeliveryRepository } from '../../packages/db/src/index';
import { codexCanonicalDigest, codexCredentialPayloadDigest, codexNetworkPolicyDigestInput } from '../../packages/domain/src/index';
import { runCodexRuntimeImportCli } from '../../scripts/codex-runtime-import';

const secret = 'test-secret';
const actorId = 'setup-admin';
const daemonIdentity = 'codex-runtime-setup';
const projectId = 'project-codex';
const repoId = 'repo-codex';
const now = '2026-05-25T00:00:00.000Z';
const codexConfigToml = 'approval_policy = "never"\nmodel = "gpt-5.5"\n';
const authJson = { OPENAI_API_KEY: 'unsafe-db-api-key' };
const apps: INestApplication[] = [];

const sha = (seed: string): string => `sha256:${seed.padEnd(64, seed).slice(0, 64)}`;

const providerConfig = {
  proxy_image: 'forgeloop/codex-proxy:test',
  proxy_image_digest: sha('1'),
  self_test_image: 'forgeloop/codex-proxy-self-test:test',
  self_test_image_digest: sha('2'),
};
const allowlistRules = [
  {
    id: 'model-provider',
    protocol: 'https' as const,
    host: 'api.openai.test',
    purpose: 'model_provider' as const,
  },
];
const networkPolicy = {
  mode: 'egress_allowlist' as const,
  provider: 'docker_network_proxy' as const,
  allowlist_rules: allowlistRules,
  provider_config: {
    ...providerConfig,
    provider_config_digest: codexCanonicalDigest(providerConfig),
  },
  egress_allowlist_digest: codexCanonicalDigest(codexNetworkPolicyDigestInput('docker_network_proxy', allowlistRules)),
  self_test_digest: providerConfig.self_test_image_digest,
};

const bootApp = async (repository: DeliveryRepository = new InMemoryDeliveryRepository()): Promise<INestApplication> => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DELIVERY_REPOSITORY)
    .useValue(repository)
    .overrideProvider(DELIVERY_RUN_WORKER)
    .useValue({ kick: () => undefined, drainOnce: async () => undefined })
    .compile();
  const app = moduleRef.createNestApplication({ rawBody: true });
  app.useLogger(false);
  await app.init();
  apps.push(app);
  return app;
};

const signedSetupPost = (app: INestApplication, pathAndQuery: string, body: Record<string, unknown>, nonce: string) => {
  const bodyWithNonce = { ...body, setup_nonce: nonce };
  const rawBody = JSON.stringify(bodyWithNonce);
  const headers = signAutomationRequest({
    method: 'POST',
    pathAndQuery,
    rawBody,
    actorId,
    actorClass: 'human_admin',
    daemonIdentity,
    timestamp: new Date().toISOString(),
    secret,
  });
  return request(app.getHttpServer())
    .post(pathAndQuery)
    .set(headers)
    .set('X-Forgeloop-Setup-Nonce', nonce)
    .set('Content-Type', 'application/json')
    .send(rawBody);
};

const importProfileBody = (overrides: Record<string, unknown> = {}) => ({
  profile_name: 'Imported generation profile',
  target_kind: 'generation',
  codex_config_toml: codexConfigToml,
  project_id: projectId,
  repo_id: repoId,
  docker_image: 'forgeloop/codex-worker:test',
  docker_image_digest: sha('3'),
  expected_effective_config_digest: sha('4'),
  allowed_scopes: [{ project_id: projectId, repo_id: repoId }],
  network_policy: networkPolicy,
  created_by: { actor_id: actorId },
  ...overrides,
});

const importCredentialBody = (profileId: string, overrides: Record<string, unknown> = {}) => ({
  profile_id: profileId,
  project_id: projectId,
  repo_id: repoId,
  purpose: 'model_provider',
  auth_json: authJson,
  provider: 'unsafe_db',
  unsafe_db_acknowledgement: true,
  created_by: { actor_id: actorId },
  ...overrides,
});

const importLocalCodexBody = (overrides: Record<string, unknown> = {}) => ({
  ...importProfileBody({ profile_name: 'Imported local Codex profile' }),
  local_source_label: 'developer-local-codex',
  auth_json: authJson,
  provider: 'unsafe_db',
  unsafe_db_acknowledgement: true,
  ...overrides,
});

describe('codex runtime import APIs', () => {
  beforeEach(() => {
    vi.stubEnv('FORGELOOP_TRUSTED_ACTOR_HEADER_SECRET', secret);
    vi.stubEnv('FORGELOOP_AUTOMATION_TEST_NOW', now);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it('imports raw Codex profile TOML and returns only ids and digests', async () => {
    const app = await bootApp();

    const response = await signedSetupPost(app, '/internal/codex-runtime/import-profile', importProfileBody(), 'import-profile').expect(201);
    const replay = await signedSetupPost(app, '/internal/codex-runtime/import-profile', importProfileBody(), 'import-profile-replay').expect(201);

    expect(response.body).toMatchObject({
      profile_id: expect.any(String),
      profile_revision_id: expect.any(String),
      codex_config_digest: codexCanonicalDigest(codexConfigToml),
      profile_digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
    });
    expect(replay.body).toEqual(response.body);
    const publicJson = JSON.stringify(response.body);
    expect(publicJson).not.toContain(codexConfigToml);
    expect(publicJson).not.toContain('gpt-5.5');
  });

  it('requires the unsafe DB gate and explicit acknowledgement before importing auth JSON', async () => {
    const app = await bootApp();
    const profile = await signedSetupPost(app, '/internal/codex-runtime/import-profile', importProfileBody(), 'credential-profile').expect(201);

    await signedSetupPost(
      app,
      '/internal/codex-runtime/import-credential',
      importCredentialBody(profile.body.profile_id),
      'credential-no-flag',
    ).expect(403);

    vi.stubEnv('FORGELOOP_UNSAFE_DB_CODEX_CREDENTIAL_STORE', '1');
    await signedSetupPost(
      app,
      '/internal/codex-runtime/import-credential',
      importCredentialBody(profile.body.profile_id, { unsafe_db_acknowledgement: false }),
      'credential-no-ack',
    ).expect(400);
  });

  it('imports local Codex config and auth through centralized service storage without returning raw material or host paths', async () => {
    const app = await bootApp();
    vi.stubEnv('FORGELOOP_UNSAFE_DB_CODEX_CREDENTIAL_STORE', '1');

    const response = await signedSetupPost(app, '/internal/codex-runtime/import-local-codex', importLocalCodexBody(), 'local-import').expect(201);
    const replay = await signedSetupPost(app, '/internal/codex-runtime/import-local-codex', importLocalCodexBody(), 'local-import-replay').expect(201);

    expect(response.body).toMatchObject({
      profile_id: expect.any(String),
      profile_revision_id: expect.any(String),
      credential_binding_id: expect.any(String),
      credential_binding_version_id: expect.any(String),
      codex_config_digest: codexCanonicalDigest(codexConfigToml),
      credential_payload_digest: codexCredentialPayloadDigest(authJson),
      import_source_digest: codexCanonicalDigest({
        kind: 'local_codex_import',
        label: 'developer-local-codex',
        imported_by_actor_id: actorId,
      }),
    });
    expect(replay.body).toEqual(response.body);
    const publicJson = JSON.stringify(response.body);
    expect(publicJson).not.toContain(codexConfigToml);
    expect(publicJson).not.toContain('developer-local-codex');
    expect(publicJson).not.toContain('unsafe-db-api-key');
    expect(publicJson).not.toContain('~/.codex');
    expect(publicJson).not.toContain('config.toml');
    expect(publicJson).not.toContain('auth.json');
  });

  it('imports local Codex provider bearer-token config without returning raw provider material', async () => {
    const app = await bootApp();
    vi.stubEnv('FORGELOOP_UNSAFE_DB_CODEX_CREDENTIAL_STORE', '1');
    const providerToken = 'sk-channel-test-token';
    const providerConfigToml = [
      'model_provider = "x2r"',
      'model = "gpt-5.5"',
      'approval_policy = "never"',
      'sandbox_mode = "read-only"',
      '',
      '[model_providers.x2r]',
      'name = "x2r"',
      'base_url = "https://ai.x2r.store/v1"',
      'wire_api = "responses"',
      `experimental_bearer_token = "${providerToken}"`,
      'requires_openai_auth = true',
      '',
    ].join('\n');
    const providerAllowlistRules = [{ id: 'x2r', protocol: 'https', host: 'ai.x2r.store', purpose: 'model_provider' }] as const;
    const providerNetworkPolicy = {
      ...networkPolicy,
      allowlist_rules: providerAllowlistRules,
      egress_allowlist_digest: codexCanonicalDigest(codexNetworkPolicyDigestInput('docker_network_proxy', providerAllowlistRules)),
    };

    const response = await signedSetupPost(
      app,
      '/internal/codex-runtime/import-local-codex',
      importLocalCodexBody({
        codex_config_toml: providerConfigToml,
        network_policy: providerNetworkPolicy,
      }),
      'local-provider-import',
    ).expect(201);

    expect(response.body).toMatchObject({
      codex_config_digest: codexCanonicalDigest(providerConfigToml),
      credential_payload_digest: codexCredentialPayloadDigest(authJson),
    });
    const publicJson = JSON.stringify(response.body);
    expect(publicJson).not.toContain(providerToken);
    expect(publicJson).not.toContain('experimental_bearer_token');
    expect(publicJson).not.toContain('ai.x2r.store');
    expect(publicJson).not.toContain(providerConfigToml);
    expect(publicJson).not.toContain('config.toml');
    expect(publicJson).not.toContain('auth.json');
  });

  it('rejects local Codex imports when provider base_url is not covered by the model-provider allowlist', async () => {
    const app = await bootApp();
    vi.stubEnv('FORGELOOP_UNSAFE_DB_CODEX_CREDENTIAL_STORE', '1');
    const providerConfigToml = [
      'model_provider = "x2r"',
      'model = "gpt-5.5"',
      'approval_policy = "never"',
      'sandbox_mode = "read-only"',
      '',
      '[model_providers.x2r]',
      'base_url = "https://ai.x2r.store/v1"',
      'wire_api = "responses"',
      'experimental_bearer_token = "sk-channel-test-token"',
      '',
    ].join('\n');

    await signedSetupPost(
      app,
      '/internal/codex-runtime/import-local-codex',
      importLocalCodexBody({
        codex_config_toml: providerConfigToml,
        network_policy: networkPolicy,
      }),
      'local-provider-import-missing-allowlist',
    ).expect(400);
  });

  it('rejects path-like local Codex source labels before they can appear in public output', async () => {
    const app = await bootApp();
    vi.stubEnv('FORGELOOP_UNSAFE_DB_CODEX_CREDENTIAL_STORE', '1');

    await signedSetupPost(
      app,
      '/internal/codex-runtime/import-local-codex',
      importLocalCodexBody({ local_source_label: '~/.codex/config.toml' }),
      'local-import-source-path',
    ).expect(400);
  });

  it('rejects local Codex unsafe DB import in production', async () => {
    const app = await bootApp();
    vi.stubEnv('FORGELOOP_UNSAFE_DB_CODEX_CREDENTIAL_STORE', '1');
    vi.stubEnv('NODE_ENV', 'production');

    await signedSetupPost(app, '/internal/codex-runtime/import-local-codex', importLocalCodexBody(), 'local-import-production').expect(403);
  });

  it('posts local Codex file contents through the import CLI without sending host paths', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'forgeloop-local-codex-'));
    try {
      writeFileSync(join(tempRoot, 'config.toml'), codexConfigToml);
      writeFileSync(join(tempRoot, 'auth.json'), JSON.stringify(authJson));
      chmodSync(join(tempRoot, 'config.toml'), 0o600);
      chmodSync(join(tempRoot, 'auth.json'), 0o600);
      const fetchMock = vi.fn(async () => ({
        ok: true,
        json: async () => ({ profile_id: 'profile-from-cli', credential_binding_id: 'credential-from-cli' }),
      }));
      vi.stubGlobal('fetch', fetchMock);

      const result = await runCodexRuntimeImportCli(
        [
          '--from-local-codex-home',
          '--unsafe-db-acknowledgement',
          '--control-plane-url',
          'http://control-plane.test/',
          '--trusted-secret',
          secret,
          '--actor-id',
          actorId,
          '--actor-class',
          'human_admin',
          '--daemon-identity',
          daemonIdentity,
          '--profile-name',
          'Imported CLI profile',
          '--target-kind',
          'generation',
          '--project-id',
          projectId,
          '--repo-id',
          repoId,
          '--docker-image',
          'forgeloop/codex-worker:test',
          '--docker-image-digest',
          sha('3'),
          '--expected-effective-config-digest',
          sha('4'),
          '--network-policy-json',
          JSON.stringify(networkPolicy),
        ],
        { CODEX_HOME: tempRoot },
      );

      expect(result).toEqual({ profile_id: 'profile-from-cli', credential_binding_id: 'credential-from-cli' });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, { body: string; headers: Record<string, string> }];
      expect(url).toBe('http://control-plane.test/internal/codex-runtime/import-local-codex');
      expect(init.headers['X-Forgeloop-Setup-Nonce']).toEqual(expect.any(String));
      const body = JSON.parse(init.body) as Record<string, unknown>;
      expect(body.codex_config_toml).toBe(codexConfigToml);
      expect(body.auth_json).toEqual(authJson);
      expect(body.local_source_label).toBe('local-codex-home');
      expect(JSON.stringify(body)).not.toContain(tempRoot);
      expect(JSON.stringify(body)).not.toContain('config.toml');
      expect(JSON.stringify(body)).not.toContain('auth.json');
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
