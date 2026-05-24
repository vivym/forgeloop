import { describe, expect, it } from 'vitest';

import { loadAutomationDaemonConfig } from '../../apps/automation-daemon/src/config';

const baseEnv = {
  FORGELOOP_CONTROL_PLANE_URL: 'http://127.0.0.1:3000',
  FORGELOOP_TRUSTED_ACTOR_HEADER_SECRET: 'secret',
  FORGELOOP_AUTOMATION_DAEMON_IDENTITY: 'daemon',
  FORGELOOP_AUTOMATION_ACTOR_ID: 'actor',
  FORGELOOP_AUTOMATION_ALLOWED_REPO_ROOTS: '/tmp/repos',
};
const digest = (seed: string): string => `sha256:${seed.repeat(64).slice(0, 64)}`;
const completeRemoteWorkerEnv = () => ({
  FORGELOOP_WORKER_ID: 'remote-worker-1',
  FORGELOOP_WORKER_IDENTITY: 'remote-worker-bootstrap-identity',
  FORGELOOP_WORKER_BOOTSTRAP_TOKEN: 'bootstrap-token',
  FORGELOOP_WORKER_BOOTSTRAP_TOKEN_VERSION: '1',
  FORGELOOP_WORKER_TEMP_ROOT: '/tmp/forgeloop-remote-worker',
  FORGELOOP_DOCKER_BIN: 'docker',
  FORGELOOP_CODEX_DOCKER_IMAGE_DIGEST: digest('a'),
  FORGELOOP_CODEX_NETWORK_POLICY_DIGEST: digest('b'),
  FORGELOOP_CODEX_WORKER_SCOPES_JSON: JSON.stringify([{ project_id: 'project-1', repo_id: 'repo-1' }]),
  FORGELOOP_CODEX_WORKER_CAPABILITIES: 'generation,run_execution',
  FORGELOOP_WORKER_MAX_CONCURRENCY: '2',
});
const requiredRemoteWorkerEnvKeys = [
  'FORGELOOP_WORKER_ID',
  'FORGELOOP_WORKER_IDENTITY',
  'FORGELOOP_WORKER_BOOTSTRAP_TOKEN',
  'FORGELOOP_WORKER_BOOTSTRAP_TOKEN_VERSION',
  'FORGELOOP_WORKER_TEMP_ROOT',
  'FORGELOOP_DOCKER_BIN',
  'FORGELOOP_CODEX_DOCKER_IMAGE_DIGEST',
  'FORGELOOP_CODEX_NETWORK_POLICY_DIGEST',
  'FORGELOOP_CODEX_WORKER_SCOPES_JSON',
  'FORGELOOP_CODEX_WORKER_CAPABILITIES',
  'FORGELOOP_WORKER_MAX_CONCURRENCY',
] as const;

describe('automation daemon generation config', () => {
  it('does not expose retired WorkItem Spec or Plan draft task knobs', () => {
    const config = loadAutomationDaemonConfig({
      ...baseEnv,
      FORGELOOP_CODEX_AUTOMATION_GENERATION: 'fake',
    });

    expect(config.generationPlanning.tasks).toEqual({
      package_drafts: {
        enabled: false,
        promptVersion: 'package-drafts.fake.v1',
        outputSchemaVersion: 'package_drafts.v1',
      },
    });
  });

  it('defaults package_drafts to disabled for 2A', () => {
    const config = loadAutomationDaemonConfig({
      ...baseEnv,
      FORGELOOP_CODEX_AUTOMATION_GENERATION: 'fake',
    });

    expect(config.generationPlanning.tasks.package_drafts.enabled).toBe(false);
  });

  it('keeps generation planning implicit when no generation env is set', () => {
    const config = loadAutomationDaemonConfig(baseEnv);

    expect(config.generationPlanningExplicit).toBe(false);
  });

  it('rejects app-server generation without a governed endpoint and artifact root', () => {
    expect(() =>
      loadAutomationDaemonConfig({
        ...baseEnv,
        FORGELOOP_CODEX_AUTOMATION_GENERATION: 'codex',
      }),
    ).toThrow(/app-server/i);
  });

  it('allows strict app-server generation without endpoint when local Docker worker mode is configured', () => {
    const config = loadAutomationDaemonConfig({
      ...baseEnv,
      FORGELOOP_CODEX_GENERATION_DRIVER: 'app_server',
      FORGELOOP_CODEX_WORKER_MODE: 'local_docker',
      FORGELOOP_CODEX_GENERATION_ARTIFACT_ROOT: '/tmp/forgeloop-artifacts',
      FORGELOOP_WORKER_IDENTITY: 'local-worker',
      FORGELOOP_WORKER_BOOTSTRAP_TOKEN: 'bootstrap-token',
      FORGELOOP_WORKER_BOOTSTRAP_TOKEN_VERSION: '1',
      FORGELOOP_WORKER_TEMP_ROOT: '/tmp/forgeloop-worker',
      FORGELOOP_WORKER_LABELS: '{"host":"local"}',
      FORGELOOP_WORKER_MAX_CONCURRENCY: '2',
      FORGELOOP_DOCKER_BIN: 'docker',
      FORGELOOP_CODEX_APP_SERVER_TRANSPORT: 'docker_exec',
      FORGELOOP_CODEX_DOCKER_IMAGE_DIGEST: `sha256:${'a'.repeat(64)}`,
      FORGELOOP_CODEX_NETWORK_POLICY_DIGEST: `sha256:${'b'.repeat(64)}`,
      FORGELOOP_CODEX_ALLOWED_SCOPE_PROJECT_ID: 'project-1',
      FORGELOOP_CODEX_ALLOWED_SCOPE_REPO_ID: 'repo-1',
      FORGELOOP_CODEX_GENERATION_CREDENTIAL_BINDING_ID: 'credential-binding-1',
    });

    expect(config.generationPlanning.mode).toBe('app_server');
    expect(config.codexWorkerMode).toBe('local_docker');
    expect(config.appServerEndpoint).toBeUndefined();
    expect(config.workerIdentity).toBe('local-worker');
    expect(config.workerLabels).toEqual({ host: 'local' });
    expect(config.workerMaxConcurrency).toBe(2);
    expect(config.appServerTransport).toBe('docker_exec');
    expect(config.workerDockerImageDigests).toEqual([`sha256:${'a'.repeat(64)}`]);
    expect(config.workerNetworkPolicyDigests).toEqual([`sha256:${'b'.repeat(64)}`]);
    expect(config.workerAuthorizedScopes).toEqual([{ project_id: 'project-1', repo_id: 'repo-1' }]);
    expect(config.generationCredentialBindingId).toBe('credential-binding-1');
  });

  it('allows strict app-server generation without endpoint when remote outbound worker mode is configured', () => {
    const config = loadAutomationDaemonConfig({
      ...baseEnv,
      FORGELOOP_CODEX_GENERATION_DRIVER: 'app_server',
      FORGELOOP_CODEX_WORKER_MODE: 'remote_outbound',
      ...completeRemoteWorkerEnv(),
      FORGELOOP_CODEX_GENERATION_RUNTIME_PROFILE_ID: 'profile-1',
      FORGELOOP_CODEX_GENERATION_CREDENTIAL_BINDING_ID: 'credential-binding-1',
      FORGELOOP_CODEX_REMOTE_RUNTIME_JOB_WAIT_TIMEOUT_MS: '60000',
      FORGELOOP_CODEX_REMOTE_RUNTIME_JOB_POLL_INTERVAL_MS: '1000',
    });

    expect(config.generationPlanning.mode).toBe('app_server');
    expect(config.codexWorkerMode).toBe('remote_outbound');
    expect(config.codexRunWorkerMode).toBe('disabled');
    expect(config.appServerEndpoint).toBeUndefined();
    expect(config.workerId).toBe('remote-worker-1');
    expect(config.workerIdentity).toBe('remote-worker-bootstrap-identity');
    expect(config.workerMaxConcurrency).toBe(2);
    expect(config.dockerBin).toBe('docker');
    expect(config.workerTempRoot).toBe('/tmp/forgeloop-remote-worker');
    expect(config.workerDockerImageDigests).toEqual([digest('a')]);
    expect(config.workerNetworkPolicyDigests).toEqual([digest('b')]);
    expect(config.workerAuthorizedScopes).toEqual([{ project_id: 'project-1', repo_id: 'repo-1' }]);
    expect(config.workerCapabilities).toEqual(['generation', 'run_execution']);
    expect(config.generationRuntimeProfileId).toBe('profile-1');
    expect(config.generationCredentialBindingId).toBe('credential-binding-1');
    expect(config.remoteRuntimeJobWaitTimeoutMs).toBe(60_000);
    expect(config.remoteRuntimeJobPollIntervalMs).toBe(1_000);
  });

  it.each(requiredRemoteWorkerEnvKeys)('rejects remote outbound generation without complete remote worker config key %s', (key) => {
    const env = {
      ...baseEnv,
      FORGELOOP_CODEX_GENERATION_DRIVER: 'app_server',
      FORGELOOP_CODEX_WORKER_MODE: 'remote_outbound',
      ...completeRemoteWorkerEnv(),
      FORGELOOP_CODEX_GENERATION_RUNTIME_PROFILE_ID: 'profile-1',
      FORGELOOP_CODEX_GENERATION_CREDENTIAL_BINDING_ID: 'credential-binding-1',
      FORGELOOP_CODEX_REMOTE_RUNTIME_JOB_WAIT_TIMEOUT_MS: '60000',
      FORGELOOP_CODEX_REMOTE_RUNTIME_JOB_POLL_INTERVAL_MS: '1000',
    };
    delete env[key];

    expect(() => loadAutomationDaemonConfig(env)).toThrow(new RegExp(key));
  });

  it('rejects remote outbound generation without remote runtime job config', () => {
    expect(() =>
      loadAutomationDaemonConfig({
        ...baseEnv,
        FORGELOOP_CODEX_GENERATION_DRIVER: 'app_server',
        FORGELOOP_CODEX_WORKER_MODE: 'remote_outbound',
        ...completeRemoteWorkerEnv(),
        FORGELOOP_CODEX_GENERATION_RUNTIME_PROFILE_ID: 'profile-1',
      }),
    ).toThrow(/FORGELOOP_CODEX_GENERATION_CREDENTIAL_BINDING_ID/);
  });

  it.each(requiredRemoteWorkerEnvKeys)('rejects remote outbound run worker without complete remote worker config key %s', (key) => {
    const env = {
      ...baseEnv,
      FORGELOOP_CODEX_RUN_WORKER_MODE: 'remote_outbound',
      ...completeRemoteWorkerEnv(),
    };
    delete env[key];

    expect(() => loadAutomationDaemonConfig(env)).toThrow(new RegExp(key));
  });

  it('parses remote outbound run worker config independently from generation mode', () => {
    const config = loadAutomationDaemonConfig({
      ...baseEnv,
      FORGELOOP_CODEX_RUN_WORKER_MODE: 'remote_outbound',
      ...completeRemoteWorkerEnv(),
    });

    expect(config.codexWorkerMode).toBe('disabled');
    expect(config.codexRunWorkerMode).toBe('remote_outbound');
    expect(config.workerId).toBe('remote-worker-1');
    expect(config.workerIdentity).toBe('remote-worker-bootstrap-identity');
    expect(config.workerCapabilities).toEqual(['generation', 'run_execution']);
  });

  it('rejects invalid local Docker app-server transport config', () => {
    expect(() =>
      loadAutomationDaemonConfig({
        ...baseEnv,
        FORGELOOP_CODEX_GENERATION_DRIVER: 'app_server',
        FORGELOOP_CODEX_WORKER_MODE: 'local_docker',
        FORGELOOP_CODEX_APP_SERVER_TRANSPORT: 'stdio',
        FORGELOOP_CODEX_GENERATION_ARTIFACT_ROOT: '/tmp/forgeloop-artifacts',
        FORGELOOP_WORKER_IDENTITY: 'local-worker',
        FORGELOOP_WORKER_BOOTSTRAP_TOKEN: 'bootstrap-token',
        FORGELOOP_WORKER_BOOTSTRAP_TOKEN_VERSION: '1',
        FORGELOOP_WORKER_TEMP_ROOT: '/tmp/forgeloop-worker',
        FORGELOOP_CODEX_DOCKER_IMAGE_DIGEST: `sha256:${'a'.repeat(64)}`,
        FORGELOOP_CODEX_NETWORK_POLICY_DIGEST: `sha256:${'b'.repeat(64)}`,
        FORGELOOP_CODEX_ALLOWED_SCOPE_PROJECT_ID: 'project-1',
        FORGELOOP_CODEX_GENERATION_CREDENTIAL_BINDING_ID: 'credential-binding-1',
      }),
    ).toThrow(/FORGELOOP_CODEX_APP_SERVER_TRANSPORT/);
  });

  it('rejects local Docker worker app-server generation without worker bootstrap config', () => {
    expect(() =>
      loadAutomationDaemonConfig({
        ...baseEnv,
        FORGELOOP_CODEX_GENERATION_DRIVER: 'app_server',
        FORGELOOP_CODEX_WORKER_MODE: 'local_docker',
        FORGELOOP_CODEX_GENERATION_ARTIFACT_ROOT: '/tmp/forgeloop-artifacts',
      }),
    ).toThrow(/FORGELOOP_WORKER_IDENTITY/);
  });

  it('rejects app-server generation when only the artifact root is missing', () => {
    expect(() =>
      loadAutomationDaemonConfig({
        ...baseEnv,
        FORGELOOP_CODEX_GENERATION_DRIVER: 'app_server',
        FORGELOOP_CODEX_APP_SERVER_ENDPOINT: 'unix:/tmp/forgeloop-codex.sock',
      }),
    ).toThrow(/FORGELOOP_CODEX_GENERATION_ARTIFACT_ROOT/);
  });

  it('rejects unsafe direct-spawn app-server endpoints at startup', () => {
    expect(() =>
      loadAutomationDaemonConfig({
        ...baseEnv,
        FORGELOOP_CODEX_GENERATION_DRIVER: 'app_server',
        FORGELOOP_CODEX_APP_SERVER_ENDPOINT: 'exec:codex app-server',
        FORGELOOP_CODEX_GENERATION_ARTIFACT_ROOT: '/tmp/forgeloop-artifacts',
      }),
    ).toThrow(/FORGELOOP_CODEX_APP_SERVER_ENDPOINT/);
  });

  it('maps legacy codex generation mode to the app_server generation driver when governed runtime config is present', () => {
    const config = loadAutomationDaemonConfig({
      ...baseEnv,
      FORGELOOP_CODEX_AUTOMATION_GENERATION: 'codex',
      FORGELOOP_CODEX_APP_SERVER_ENDPOINT: 'unix:/tmp/forgeloop-codex.sock',
      FORGELOOP_CODEX_GENERATION_ARTIFACT_ROOT: '/tmp/forgeloop-artifacts',
    });

    expect(config.generationPlanning.mode).toBe('app_server');
    expect(config.generationPlanningExplicit).toBe(true);
    expect(config.appServerEndpoint).toBe('unix:/tmp/forgeloop-codex.sock');
    expect(config.generationArtifactRoot).toBe('/tmp/forgeloop-artifacts');
  });

  it('rejects conflicting legacy and new generation drivers', () => {
    expect(() =>
      loadAutomationDaemonConfig({
        ...baseEnv,
        FORGELOOP_CODEX_AUTOMATION_GENERATION: 'fake',
        FORGELOOP_CODEX_GENERATION_DRIVER: 'app_server',
      }),
    ).toThrow(/FORGELOOP_CODEX_GENERATION_DRIVER/);
  });

  it.each(['cli', 'exec', 'exec_fallback', 'codex_exec'])('rejects forbidden generation driver %s', (driver) => {
    expect(() =>
      loadAutomationDaemonConfig({
        ...baseEnv,
        FORGELOOP_CODEX_GENERATION_DRIVER: driver,
      }),
    ).toThrow(/FORGELOOP_CODEX_GENERATION_DRIVER/);
  });

  it('allows the package draft task flag to override driver defaults', () => {
    const config = loadAutomationDaemonConfig({
      ...baseEnv,
      FORGELOOP_CODEX_GENERATION_DRIVER: 'fake',
      FORGELOOP_CODEX_GENERATION_PACKAGE_DRAFTS_ENABLED: 'true',
    });

    expect(config.generationPlanning.tasks.package_drafts.enabled).toBe(true);
  });

  it('parses positive generation runtime numeric limits', () => {
    const config = loadAutomationDaemonConfig({
      ...baseEnv,
      FORGELOOP_CODEX_GENERATION_DRIVER: 'fake',
      FORGELOOP_CODEX_GENERATION_TURN_TIMEOUT_MS: '300000',
      FORGELOOP_CODEX_GENERATION_OUTPUT_LIMIT_BYTES: '1048576',
      FORGELOOP_CODEX_GENERATION_RAW_NOTIFICATION_LIMIT_BYTES: '4194304',
      FORGELOOP_CODEX_GENERATION_MAX_CONCURRENCY: '2',
    });

    expect(config.generationTurnTimeoutMs).toBe(300_000);
    expect(config.generationOutputLimitBytes).toBe(1_048_576);
    expect(config.generationRawNotificationLimitBytes).toBe(4_194_304);
    expect(config.generationMaxConcurrency).toBe(2);
  });

  it.each([
    ['FORGELOOP_CODEX_GENERATION_TURN_TIMEOUT_MS', '0'],
    ['FORGELOOP_CODEX_GENERATION_OUTPUT_LIMIT_BYTES', '-1'],
    ['FORGELOOP_CODEX_GENERATION_RAW_NOTIFICATION_LIMIT_BYTES', '1.5'],
    ['FORGELOOP_CODEX_GENERATION_MAX_CONCURRENCY', 'not-a-number'],
  ])('rejects invalid generation runtime numeric limit %s=%s', (key, value) => {
    expect(() =>
      loadAutomationDaemonConfig({
        ...baseEnv,
        FORGELOOP_CODEX_GENERATION_DRIVER: 'fake',
        [key]: value,
      }),
    ).toThrow(new RegExp(key));
  });
});
