import 'reflect-metadata';

import { execFile as execFileCallback } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmod, cp, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';

import { signAutomationRequest } from '../../packages/automation/src/index';
import {
  AppServerGenerationDriver,
  CodexAppServerEndpointTransport,
  effectiveConfigFromResponse,
  type CodexAppServerTransport,
  type CodexGenerationRuntimeSafety,
} from '../../packages/codex-runtime/src/index';
import {
  CliDockerRunner,
  CodexAppServerDockerExecTransport,
  CodexRuntimeControlPlaneClient,
  DockerizedCodexAppServerLauncher,
  createRemoteCodexWorkerClient,
  sealCodexLaunchTokenEnvelope,
} from '../../packages/codex-worker-runtime/src/index';
import {
  codexCanonicalDigest,
  codexCredentialPayloadDigest,
  codexRuntimeNetworkPolicyDigest,
  codexRuntimeProfileRevisionDigest,
  type CodexDockerRuntimeEvidence,
  type CodexRuntimeProfileRevision,
} from '../../packages/domain/src/index';
import { InMemoryDeliveryRepository, type DeliveryRepository } from '../../packages/db/src/index';
import { createRemoteCodexGenerationRuntime } from '../../apps/automation-daemon/src/generation-runtime';
import {
  codexConfigTomlForTarget,
  codexRuntimeDogfoodWorkerIdentityForTarget,
  loadCodexRuntimeDogfoodBootstrapConfig,
} from '../../scripts/codex-runtime-dogfood-bootstrap';

const execFile = promisify(execFileCallback);
const runDockerSmoke = process.env.FORGELOOP_RUN_REAL_DOCKER_SMOKE === '1';
const runCodexSmoke = process.env.FORGELOOP_RUN_REAL_CODEX_APP_SERVER_SMOKE === '1';
const runCodexGenerationSmoke = process.env.FORGELOOP_RUN_REAL_CODEX_APP_SERVER_GENERATION_SMOKE === '1';
const runRemoteDogfoodSmoke = process.env.FORGELOOP_CODEX_REMOTE_DOGFOOD_SMOKE === '1';
const dockerBin = process.env.FORGELOOP_DOCKER_BIN ?? 'docker';
const digestPattern = /^sha256:[a-f0-9]{64}$/;

const requiredEnv = (key: string): string => {
  const value = process.env[key]?.trim();
  if (value === undefined || value.length === 0) {
    throw new Error(`${key}_required_for_real_codex_smoke`);
  }
  return value;
};

const remoteDogfoodSecret = 'remote-codex-dogfood-secret';
const remoteDogfoodActorId = 'remote-codex-dogfood-actor';
const remoteDogfoodDaemonIdentity = 'remote-codex-dogfood-daemon';

const readProtectedCodexFile = async (path: string): Promise<string> => {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) {
    throw new Error('remote_codex_dogfood_requires_protected_codex_file');
  }
  return readFile(path, 'utf8');
};

const signedSetupPost = async (
  app: INestApplication,
  pathAndQuery: string,
  body: Record<string, unknown>,
  nonce: string,
) => {
  const bodyWithNonce = { ...body, setup_nonce: nonce };
  const rawBody = JSON.stringify(bodyWithNonce);
  const headers = {
    'content-type': 'application/json',
    'X-Forgeloop-Setup-Nonce': nonce,
    ...signAutomationRequest({
      method: 'POST',
      pathAndQuery,
      rawBody,
      actorId: remoteDogfoodActorId,
      actorClass: 'system_bootstrap',
      daemonIdentity: remoteDogfoodDaemonIdentity,
      timestamp: new Date().toISOString(),
      secret: remoteDogfoodSecret,
    }),
  };
  const response = await fetch(`http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}${pathAndQuery}`, {
    method: 'POST',
    headers,
    body: rawBody,
  });
  if (!response.ok) {
    throw new Error(`remote_codex_dogfood_setup_failed:${pathAndQuery}:${response.status}`);
  }
  return response.json() as Promise<Record<string, unknown>>;
};

const bootRemoteDogfoodControlPlane = async (): Promise<{
  app: INestApplication;
  repository: DeliveryRepository;
  baseUrl: string;
}> => {
  const [{ AppModule }, { DELIVERY_REPOSITORY }, { DELIVERY_RUN_WORKER }] = await Promise.all([
    import('../../apps/control-plane-api/src/app.module'),
    import('../../apps/control-plane-api/src/modules/core/control-plane-tokens'),
    import('../../apps/control-plane-api/src/modules/run-control/run-worker.token'),
  ]);
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DELIVERY_REPOSITORY)
    .useValue(new InMemoryDeliveryRepository({ codexLaunchTokenEnvelopeSealer: { sealLaunchTokenEnvelope: sealCodexLaunchTokenEnvelope } }))
    .overrideProvider(DELIVERY_RUN_WORKER)
    .useValue({ kick: () => undefined, drainOnce: async () => undefined })
    .compile();
  const app = moduleRef.createNestApplication({ logger: false, rawBody: true });
  app.useLogger(false);
  await app.listen(0, '127.0.0.1');
  const port = (app.getHttpServer().address() as { port: number }).port;
  return { app, repository: app.get(DELIVERY_REPOSITORY) as DeliveryRepository, baseUrl: `http://127.0.0.1:${port}` };
};

const buildRemoteDogfoodGenerationRevision = (input: {
  profileId: string;
  revisionId: string;
  codexConfigToml: string;
  dockerImage: string;
  dockerImageDigest: string;
  expectedEffectiveConfigDigest: string;
  networkPolicy: CodexRuntimeProfileRevision['network_policy'];
  allowedScope: { project_id: string; repo_id?: string };
}): CodexRuntimeProfileRevision => {
  const revisionWithoutDigest: CodexRuntimeProfileRevision = {
    id: input.revisionId,
    profile_id: input.profileId,
    revision_number: 1,
    status: 'active',
    environment: 'local_dogfood',
    docker_image: input.dockerImage,
    docker_image_digest: input.dockerImageDigest,
    target_kind: 'generation',
    source_access_mode: 'artifact_only',
    codex_config_toml: input.codexConfigToml,
    codex_config_digest: codexCanonicalDigest(input.codexConfigToml),
    expected_effective_config_digest: input.expectedEffectiveConfigDigest,
    effective_config_assertions: {
      target_kind: 'generation',
      approval_policy: 'never',
      source_write_policy: 'artifact_only',
      forbidden_writable_roots: ['workspace'],
    },
    app_server_required: true,
    allowed_driver_kind: 'app_server',
    network_policy: input.networkPolicy,
    resource_limits: {
      cpu_ms: 2_000,
      memory_mb: 4096,
      pids: 512,
      fds: 1024,
      workspace_bytes: 2_000_000_000,
      artifact_bytes: 500_000_000,
      timeout_ms: 180_000,
      output_limit_bytes: 2_000_000,
      run_output_limit_bytes: 2_000_000,
    },
    docker_policy: {
      app_server_only: true,
      rootless: true,
      read_only_rootfs: true,
      no_new_privileges: true,
      drop_capabilities: ['ALL'],
    },
    allowed_scopes: [input.allowedScope],
    profile_digest: 'sha256:placeholder',
    created_by_actor_id: remoteDogfoodActorId,
    created_at: new Date().toISOString(),
  };
  return {
    ...revisionWithoutDigest,
    profile_digest: codexRuntimeProfileRevisionDigest(revisionWithoutDigest),
  };
};

const dockerNetworkProviderConfigDigest = (networkPolicy: CodexRuntimeProfileRevision['network_policy']): string => {
  if (networkPolicy.mode !== 'egress_allowlist' || networkPolicy.provider !== 'docker_network_proxy') {
    throw new Error('remote_codex_dogfood_requires_docker_network_proxy_policy');
  }
  return networkPolicy.provider_config.provider_config_digest;
};

const probeCodexEffectiveConfig = async (
  endpoint: `unix:${string}` | `ws://${string}` | `docker-exec:${string}`,
  auth?: { bearerToken: string },
  createTransport?: () => CodexAppServerTransport,
): Promise<Record<string, unknown>> => {
  const transport = createTransport?.() ?? new CodexAppServerEndpointTransport(endpoint, auth);
  try {
    await transport.initialize?.();
    for (const [method, params] of [
      ['config/read', { includeLayers: false }],
      ['getEffectiveConfig', {}],
      ['codex/getEffectiveConfig', {}],
      ['effective_config', {}],
    ] as const) {
      try {
        const response = await transport.request(method, params);
        const config = effectiveConfigFromResponse(response);
        if (config !== undefined) {
          return config as Record<string, unknown>;
        }
      } catch {
        // App-server builds have used several effective-config method names.
      }
    }
  } finally {
    await transport.close?.().catch(() => undefined);
  }
  throw new Error('codex_app_server_effective_config_mismatch');
};

describe.skipIf(!runDockerSmoke)('real Docker mechanics smoke', () => {
  it('talks to the configured Docker daemon', async () => {
    const { stdout } = await execFile(dockerBin, ['version', '--format', '{{.Server.Version}}'], { timeout: 20_000 });

    expect(stdout.trim().length).toBeGreaterThan(0);
  });
});

describe.skipIf(!runCodexSmoke)('real Dockerized Codex app-server smoke', () => {
  it('starts a pinned Codex app-server container and reads effective config through docker exec proxy', async () => {
    const image = requiredEnv('FORGELOOP_REAL_CODEX_DOCKER_IMAGE');
    const imageDigest = requiredEnv('FORGELOOP_REAL_CODEX_DOCKER_IMAGE_DIGEST');
    if (!digestPattern.test(imageDigest)) {
      throw new Error('FORGELOOP_REAL_CODEX_DOCKER_IMAGE_DIGEST_must_be_pinned_sha256_digest');
    }
    const root = await mkdtemp(join(tmpdir(), 'forgeloop-real-codex-'));
    const codexHome = join(root, 'codex-home');
    const containerName = `forgeloop-real-codex-${randomUUID()}`;
    await mkdir(codexHome, { recursive: true, mode: 0o700 });
    await writeFile(join(codexHome, 'config.toml'), 'approval_policy = "never"\n', { mode: 0o600 });
    await writeFile(join(codexHome, 'auth.json'), '{}\n', { mode: 0o600 });
    const hostUid = process.getuid?.();
    const hostGid = process.getgid?.();

    try {
      await execFile(
        dockerBin,
        [
          'run',
          '--rm',
          '--detach',
          '--name',
          containerName,
          '--network',
          'none',
          ...(hostUid === undefined || hostGid === undefined ? [] : ['--user', `${hostUid}:${hostGid}`]),
          '--security-opt',
          'no-new-privileges',
          '--cap-drop',
          'ALL',
          '--read-only',
          '--env',
          'CODEX_HOME=/codex-home',
          '--env',
          'HOME=/codex-home',
          '--volume',
          `${codexHome}:/codex-home:rw`,
          '--tmpfs',
          `/run/forgeloop:rw,noexec,nosuid,nodev,uid=${hostUid ?? 0},gid=${hostGid ?? 0},mode=700`,
          '--tmpfs',
          `/tmp:rw,nosuid,nodev,uid=${hostUid ?? 0},gid=${hostGid ?? 0},mode=1777`,
          `${image}@${imageDigest}`,
          'forgeloop-codex-entrypoint',
          'codex',
          'app-server',
          '--listen',
          'unix:///run/forgeloop/codex.sock',
        ],
        { timeout: 30_000 },
      );
      const deadline = Date.now() + 15_000;
      let effectiveConfig: Record<string, unknown> | undefined;
      while (Date.now() <= deadline) {
        const transport = new CodexAppServerDockerExecTransport({
          dockerBin,
          containerId: containerName,
          socketContainerPath: '/run/forgeloop/codex.sock',
        });
        try {
          await transport.initialize();
          const response = await transport.request('config/read', { includeLayers: false });
          const parsed = effectiveConfigFromResponse(response);
          if (parsed !== undefined) {
            effectiveConfig = parsed as Record<string, unknown>;
            await transport.close().catch(() => undefined);
            break;
          }
        } catch {
          // App-server may not have created its container-local socket yet.
        } finally {
          await transport.close().catch(() => undefined);
        }
        await delay(100);
      }
      expect(effectiveConfig).toBeDefined();
    } finally {
      await execFile(dockerBin, ['rm', '-f', containerName], { timeout: 20_000 }).catch(() => undefined);
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe.skipIf(!runCodexGenerationSmoke)('real Dockerized Codex app-server generation smoke', () => {
  it('runs a generation turn through docker exec with isolated local Codex auth/config', async () => {
    const image = requiredEnv('FORGELOOP_REAL_CODEX_DOCKER_IMAGE');
    const imageDigest = requiredEnv('FORGELOOP_REAL_CODEX_DOCKER_IMAGE_DIGEST');
    if (!digestPattern.test(imageDigest)) {
      throw new Error('FORGELOOP_REAL_CODEX_DOCKER_IMAGE_DIGEST_must_be_pinned_sha256_digest');
    }
    const root = await mkdtemp(join(tmpdir(), 'forgeloop-real-codex-generation-'));
    const codexHome = join(root, 'codex-home');
    const hostCodexHome = process.env.FORGELOOP_REAL_CODEX_HOME ?? join(homedir(), '.codex');
    const containerName = `forgeloop-real-codex-generation-${randomUUID()}`;
    await mkdir(codexHome, { recursive: true, mode: 0o700 });
    await cp(join(hostCodexHome, 'config.toml'), join(codexHome, 'config.toml'));
    await cp(join(hostCodexHome, 'auth.json'), join(codexHome, 'auth.json'));
    await chmod(join(codexHome, 'config.toml'), 0o600);
    await chmod(join(codexHome, 'auth.json'), 0o600);
    const hostUid = process.getuid?.();
    const hostGid = process.getgid?.();

    try {
      await execFile(
        dockerBin,
        [
          'run',
          '--rm',
          '--detach',
          '--name',
          containerName,
          '--network',
          'bridge',
          ...(hostUid === undefined || hostGid === undefined ? [] : ['--user', `${hostUid}:${hostGid}`]),
          '--security-opt',
          'no-new-privileges',
          '--cap-drop',
          'ALL',
          '--read-only',
          '--env',
          'CODEX_HOME=/codex-home',
          '--env',
          'HOME=/codex-home',
          '--volume',
          `${codexHome}:/codex-home:rw`,
          '--tmpfs',
          `/run/forgeloop:rw,noexec,nosuid,nodev,uid=${hostUid ?? 0},gid=${hostGid ?? 0},mode=700`,
          '--tmpfs',
          `/tmp:rw,nosuid,nodev,uid=${hostUid ?? 0},gid=${hostGid ?? 0},mode=1777`,
          `${image}@${imageDigest}`,
          'forgeloop-codex-entrypoint',
          'codex',
          'app-server',
          '--listen',
          'unix:///run/forgeloop/codex.sock',
        ],
        { timeout: 30_000 },
      );

      let transport: CodexAppServerDockerExecTransport | undefined;
      const deadline = Date.now() + 15_000;
      while (Date.now() <= deadline) {
        const candidate = new CodexAppServerDockerExecTransport({
          dockerBin,
          containerId: containerName,
          socketContainerPath: '/run/forgeloop/codex.sock',
        });
        try {
          await candidate.initialize();
          transport = candidate;
          break;
        } catch {
          await candidate.close().catch(() => undefined);
        }
        await delay(100);
      }
      if (transport === undefined) {
        throw new Error('codex_app_server_unavailable');
      }
      const safety: CodexGenerationRuntimeSafety = {
        taskKind: 'plan_draft',
        actionRunId: 'real-codex-generation-smoke',
        projectId: 'project-1',
        repoIds: ['repo-1'],
        artifactRoot: '/artifacts',
        policyDigests: { 'repo-1': 'sha256:policy' },
        async createGenerationLease(input) {
          return { lease_id: 'lease-1', expires_at: input.expiresAt };
        },
        async consumeGenerationCommand() {},
      };
      const driver = new AppServerGenerationDriver({ transport, runtimeSafety: safety });
      const output = await driver.generate({
        taskKind: 'plan_draft',
        prompt: 'Return exactly this JSON and nothing else: {"forgeloop_generation_driver_probe":true}',
        outputSchemaVersion: 'plan_draft.v1',
        timeoutMs: 90_000,
        outputLimitBytes: 16_384,
        rawNotificationLimitBytes: 262_144,
      });
      await transport.close().catch(() => undefined);

      expect(output.extractedJson).toEqual({ forgeloop_generation_driver_probe: true });
    } finally {
      await execFile(dockerBin, ['rm', '-f', containerName], { timeout: 20_000 }).catch(() => undefined);
      await rm(root, { recursive: true, force: true });
    }
  }, 120_000);
});

describe.skipIf(!runRemoteDogfoodSmoke)('same-host remote Codex generation dogfood smoke', () => {
  it('runs one Spec draft through the outbound remote worker channel', async () => {
    const hostCodexHome = process.env.FORGELOOP_REAL_CODEX_HOME ?? join(homedir(), '.codex');
    const hostConfigPath = join(hostCodexHome, 'config.toml');
    const hostAuthPath = join(hostCodexHome, 'auth.json');
    const codexConfigToml = await readProtectedCodexFile(hostConfigPath);
    const authRaw = await readProtectedCodexFile(hostAuthPath);
    const authJson = JSON.parse(authRaw) as Record<string, unknown>;
    const workerTempRoot = await mkdtemp(join(tmpdir(), 'forgeloop-remote-codex-worker-'));
    const workerIdentity = codexRuntimeDogfoodWorkerIdentityForTarget(`remote-dogfood-worker-${randomUUID()}`, 'generation');
    const workerBootstrapToken = `remote-dogfood-bootstrap-${randomUUID()}`;
    const projectId = 'remote-dogfood-project';
    const repoId = 'remote-dogfood-repo';
    const profileId = 'remote-dogfood-generation-profile';
    const revisionId = `${profileId}-rev-1`;
    const credentialBindingId = `${profileId}-credential`;
    const credentialVersionId = `${credentialBindingId}-v1`;
    const now = new Date().toISOString();
    const bootstrapConfig = loadCodexRuntimeDogfoodBootstrapConfig(
      {
        ...process.env,
        FORGELOOP_CONTROL_PLANE_URL: 'http://127.0.0.1:0',
        FORGELOOP_TRUSTED_ACTOR_HEADER_SECRET: remoteDogfoodSecret,
        FORGELOOP_CODEX_RUNTIME_SETUP_ACTOR_ID: remoteDogfoodActorId,
        FORGELOOP_CODEX_RUNTIME_SETUP_ACTOR_CLASS: 'system_bootstrap',
        FORGELOOP_CODEX_RUNTIME_SETUP_DAEMON_IDENTITY: remoteDogfoodDaemonIdentity,
        FORGELOOP_CODEX_CONFIG_TOML_PATH: hostConfigPath,
        FORGELOOP_CODEX_DOCKER_IMAGE: requiredEnv('FORGELOOP_REAL_CODEX_DOCKER_IMAGE'),
        FORGELOOP_CODEX_DOCKER_IMAGE_DIGEST: requiredEnv('FORGELOOP_REAL_CODEX_DOCKER_IMAGE_DIGEST'),
        FORGELOOP_CODEX_ALLOWED_SCOPE_PROJECT_ID: projectId,
        FORGELOOP_CODEX_ALLOWED_SCOPE_REPO_ID: repoId,
        FORGELOOP_WORKER_IDENTITY: workerIdentity,
        FORGELOOP_WORKER_BOOTSTRAP_TOKEN: workerBootstrapToken,
        FORGELOOP_WORKER_BOOTSTRAP_TOKEN_VERSION: '1',
      },
      authRaw,
    );
    const revision = buildRemoteDogfoodGenerationRevision({
      profileId,
      revisionId,
      codexConfigToml: codexConfigTomlForTarget(codexConfigToml, 'generation'),
      dockerImage: bootstrapConfig.dockerImage,
      dockerImageDigest: bootstrapConfig.dockerImageDigest,
      expectedEffectiveConfigDigest: bootstrapConfig.generationExpectedEffectiveConfigDigest,
      networkPolicy: bootstrapConfig.networkPolicy,
      allowedScope: bootstrapConfig.allowedScope,
    });
    const previousTrustedSecret = process.env.FORGELOOP_TRUSTED_ACTOR_HEADER_SECRET;
    const previousUnsafeCredentialStore = process.env.FORGELOOP_UNSAFE_DB_CODEX_CREDENTIAL_STORE;
    process.env.FORGELOOP_TRUSTED_ACTOR_HEADER_SECRET = remoteDogfoodSecret;
    process.env.FORGELOOP_UNSAFE_DB_CODEX_CREDENTIAL_STORE = '1';
    let app: INestApplication | undefined;
    try {
      const booted = await bootRemoteDogfoodControlPlane();
      app = booted.app;
      const { repository, baseUrl } = booted;
      await signedSetupPost(
        app,
        '/internal/codex-runtime/profiles',
        {
          profile: {
            id: profileId,
            name: profileId,
            environment: 'local_dogfood',
            target_kind: 'generation',
            active_revision_id: revisionId,
            created_by_actor_id: remoteDogfoodActorId,
            created_at: now,
            updated_at: now,
          },
          revision,
          created_by: { actor_id: remoteDogfoodActorId },
        },
        'remote-dogfood-profile',
      );
      await signedSetupPost(
        app,
        '/internal/codex-runtime/credentials',
        {
          binding: {
            id: credentialBindingId,
            profile_id: profileId,
            project_id: projectId,
            repo_id: repoId,
            provider: 'unsafe_db',
            purpose: 'model_provider',
            active_version_id: credentialVersionId,
            created_by_actor_id: remoteDogfoodActorId,
            created_at: now,
            updated_at: now,
          },
          version: {
            id: credentialVersionId,
            binding_id: credentialBindingId,
            version_number: 1,
            status: 'active',
            payload_digest: codexCredentialPayloadDigest(authJson),
            created_by_actor_id: remoteDogfoodActorId,
            created_at: now,
          },
          secret_payload_json: authJson,
          unsafe_db_acknowledgement: true,
          created_by: { actor_id: remoteDogfoodActorId },
        },
        'remote-dogfood-credential',
      );
      await signedSetupPost(
        app,
        '/internal/codex-runtime/worker-bootstrap-tokens',
        {
          id: 'remote-dogfood-bootstrap',
          worker_identity: workerIdentity,
          bootstrap_token_hash: codexCredentialPayloadDigest(workerBootstrapToken),
          bootstrap_token_version: 1,
          status: 'active',
          allowed_scopes_json: [bootstrapConfig.allowedScope],
          allowed_capabilities_json: {
            target_kinds: ['generation'],
            docker_image_digests: [bootstrapConfig.dockerImageDigest],
            network_policy_digests: [codexRuntimeNetworkPolicyDigest(bootstrapConfig.networkPolicy)],
            network_provider_config_digests: [dockerNetworkProviderConfigDigest(bootstrapConfig.networkPolicy)],
          },
          created_by_actor_id: remoteDogfoodActorId,
          created_at: now,
          expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
          created_by: { actor_id: remoteDogfoodActorId },
        },
        'remote-dogfood-bootstrap',
      );
      const actionRun = await repository.createOrReplayAutomationActionRun({
        id: 'remote-dogfood-action-run',
        action_type: 'ensure_package_drafts',
        target_object_type: 'work_item',
        target_object_id: 'remote-dogfood-work-item',
        target_status: 'triage',
        idempotency_key: 'remote-dogfood-action-run-key',
        automation_scope: `repo:${projectId}:${repoId}`,
        automation_settings_version: 1,
        capability_fingerprint: 'remote-dogfood-capability',
        precondition_fingerprint: 'remote-dogfood-precondition',
        action_input_json: { project_id: projectId, repo_id: repoId },
        now,
      });
      const claimed = await repository.claimNextAutomationActionRun({
        now,
        claim_token: 'remote-dogfood-claim-token',
        locked_until: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        limit: 1,
      });
      expect(claimed?.id).toBe(actionRun.id);
      if (claimed === undefined) {
        throw new Error('remote_codex_dogfood_action_claim_missing');
      }
      expect(claimed?.attempt).toBeGreaterThan(actionRun.attempt);
      const controlPlaneClient = new CodexRuntimeControlPlaneClient({
        baseUrl,
        trustedActorSigner: ({ method, pathAndQuery, rawBody }) =>
          ({
            ...signAutomationRequest({
              method,
              pathAndQuery,
              rawBody,
              actorId: remoteDogfoodActorId,
              actorClass: 'automation_daemon',
              daemonIdentity: remoteDogfoodDaemonIdentity,
              timestamp: new Date().toISOString(),
              secret: remoteDogfoodSecret,
            }),
          }),
      });
      let capturedEvidence: CodexDockerRuntimeEvidence | undefined;
      const realLauncher = new DockerizedCodexAppServerLauncher({
        dockerBin,
        workerId: workerIdentity,
        workerTempRoot,
        dockerRunner: new CliDockerRunner(dockerBin),
        controlPlaneClient,
        hostUid: process.getuid?.() ?? 0,
        hostGid: process.getgid?.() ?? 0,
        appServerTransport: 'docker_exec',
        effectiveConfigProbe: probeCodexEffectiveConfig,
      });
      const worker = createRemoteCodexWorkerClient({
        workerId: workerIdentity,
        workerIdentity,
        version: 'remote-dogfood-smoke',
        bootstrapToken: workerBootstrapToken,
        bootstrapTokenVersion: 1,
        workerTempRoot,
        allowedScopes: [bootstrapConfig.allowedScope],
        capabilities: ['generation'],
        dockerImageDigests: [bootstrapConfig.dockerImageDigest],
        networkPolicyDigests: [codexRuntimeNetworkPolicyDigest(bootstrapConfig.networkPolicy)],
        networkProviderConfigDigests: [dockerNetworkProviderConfigDigest(bootstrapConfig.networkPolicy)],
        hostUid: process.getuid?.() ?? 0,
        hostGid: process.getgid?.() ?? 0,
        maxConcurrency: 1,
        controlPlaneClient,
        launcher: {
          async startFromMaterialization(materialization, input) {
            const session = await realLauncher.startFromMaterialization(materialization, input);
            capturedEvidence = session.publicEvidence;
            return session;
          },
        },
        scavenger: async () => undefined,
        pollIntervalMs: 100,
        controlPollIntervalMs: 250,
      });
      await worker.runOnce();
      const workerReadyStatus = await controlPlaneClient.getStatus({
        projectId,
        repoId,
        targetKind: 'generation',
        runtimeProfileId: profileId,
        credentialBindingId,
      });
      expect(workerReadyStatus.worker_status).toBe('online');
      expect(workerReadyStatus.blocker_codes ?? []).not.toContain('codex_worker_unavailable');
      expect(workerIdentity).toMatch(/^codex-runtime-dogfood-worker-[a-f0-9]{12}-generation$/);
      let keepWorkerRunning = true;
      const workerPump = (async () => {
        while (keepWorkerRunning) {
          await worker.runOnce();
          await delay(100);
        }
      })();
      const abortController = new AbortController();
      const runtime = createRemoteCodexGenerationRuntime({
        controlPlaneClient,
        runtimeProfileId: profileId,
        credentialBindingId,
        waitTimeoutMs: 180_000,
        pollIntervalMs: 250,
        actionClaimRenewalMs: 5_000,
      });
      let result: Awaited<ReturnType<typeof runtime.generateSpecDraft>>;
      try {
        const runtimeJobId = `codex-generation-job-${codexCanonicalDigest({
          actionRunId: claimed.id,
          actionAttempt: claimed.attempt,
          taskKind: 'spec_draft',
          promptVersion: 'SPEC-draft.remote-dogfood.v1',
          outputSchemaVersion: 'spec_draft.v1',
          idempotencyKey: claimed.idempotency_key,
        }).replace(/^sha256:/, '')}`;
        const generationPromise = runtime.generateSpecDraft({
          actionRunId: actionRun.id,
          projectId,
          repoIds: [repoId],
          context: {
            context_version: 'generation_context.work_item.v1',
            work_item: {
              id: 'remote-dogfood-work-item',
              title: 'Remote Codex worker dogfood',
              goal: 'Generate one public-safe Spec draft through the remote worker runtime channel.',
              success_criteria: ['Spec draft JSON validates.'],
            },
          },
          promptVersion: 'SPEC-draft.remote-dogfood.v1',
          outputSchemaVersion: 'spec_draft.v1',
          policyDigests: { [repoId]: codexRuntimeNetworkPolicyDigest(bootstrapConfig.networkPolicy) },
          orchestration: {
            targetType: 'automation_action_run',
            actionRunId: claimed.id,
            actionType: 'ensure_package_drafts',
            actionAttempt: claimed.attempt,
            claimToken: 'remote-dogfood-claim-token',
            preconditionFingerprint: claimed.precondition_fingerprint,
            automationScope: `repo:${projectId}:${repoId}`,
            idempotencyKey: claimed.idempotency_key,
          },
          signal: abortController.signal,
        });
        const pumpFailure = workerPump.then(
          () => new Promise<never>(() => undefined),
          (error: unknown) => {
            throw error;
          },
        );
        try {
          result = await Promise.race([generationPromise, pumpFailure]);
        } catch (error) {
          const job = await repository.getCodexRuntimeJob({ runtime_job_id: runtimeJobId });
          const artifacts = await repository.listCodexRuntimeJobArtifacts({ runtime_job_id: runtimeJobId });
          const failureEvidence = artifacts.find((artifact) => artifact.kind === 'startup_failure_evidence')?.metadata_json;
          throw new Error(
            `remote_codex_dogfood_generation_failed:${JSON.stringify({
              terminal_status: job?.terminal_status,
              terminal_reason_code: job?.terminal_reason_code,
              failure_stage: failureEvidence?.failure_stage,
              failure_subcode: failureEvidence?.failure_subcode,
              app_server_started: failureEvidence?.app_server_started,
              generation_output_schema_sent: failureEvidence?.generation_output_schema_sent,
            })}`,
            { cause: error },
          );
        }
      } finally {
        abortController.abort();
        keepWorkerRunning = false;
        await workerPump.catch(() => undefined);
      }

      expect(result.generated.schema_version).toBe('spec_draft.v1');
      expect(capturedEvidence).toMatchObject({
        docker_image_digest: bootstrapConfig.dockerImageDigest,
        app_server_attempted: true,
        selected_execution_mode: 'app_server',
      });
      expect(capturedEvidence?.container_id_digest).toMatch(digestPattern);
      expect(capturedEvidence?.app_server_effective_config_digest).toBe(bootstrapConfig.generationExpectedEffectiveConfigDigest);
      const artifactRef = result.generationArtifacts.find((artifact) => artifact.storage_uri?.startsWith('artifact://codex-runtime-jobs/'));
      const runtimeJobId = /^artifact:\/\/codex-runtime-jobs\/([^/]+)\//.exec(artifactRef?.storage_uri ?? '')?.[1];
      expect(runtimeJobId).toBeDefined();
      const runtimeJob = await repository.getCodexRuntimeJob({ runtime_job_id: runtimeJobId! });
      expect(runtimeJob?.runtime_evidence_digest).toMatch(digestPattern);
      const publicOutput = JSON.stringify({ result, capturedEvidence, runtimeJob });
      expect(publicOutput).not.toContain(hostCodexHome);
      expect(publicOutput).not.toContain(codexConfigToml);
      expect(publicOutput).not.toContain(authRaw);
    } finally {
      await app?.close();
      await rm(workerTempRoot, { recursive: true, force: true });
      if (previousTrustedSecret === undefined) {
        delete process.env.FORGELOOP_TRUSTED_ACTOR_HEADER_SECRET;
      } else {
        process.env.FORGELOOP_TRUSTED_ACTOR_HEADER_SECRET = previousTrustedSecret;
      }
      if (previousUnsafeCredentialStore === undefined) {
        delete process.env.FORGELOOP_UNSAFE_DB_CODEX_CREDENTIAL_STORE;
      } else {
        process.env.FORGELOOP_UNSAFE_DB_CODEX_CREDENTIAL_STORE = previousUnsafeCredentialStore;
      }
    }
  }, 240_000);
});
