import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  automationDogfoodExitCode,
  automationDogfoodCommand,
  expectedAutomationDogfoodActionTypes,
  expectedAutomationDogfoodPackageDraftCount,
  renderAutomationDogfoodSummary,
  requiredAutomationDogfoodSummaryMarkers,
} from '../../scripts/automation-dogfood-summary';
import { loadDogfoodGenerationRuntimeConfig, requestedGenerationMode } from '../../scripts/automation-dogfood';
import {
  codexRuntimeDogfoodWorkerIdentityForTarget,
  loadCodexRuntimeDogfoodBootstrapConfig,
  runCodexRuntimeDogfoodBootstrap,
  renderCodexRuntimeDogfoodBootstrapCliFailure,
} from '../../scripts/codex-runtime-dogfood-bootstrap';
import {
  codexRemoteWorkerDogfoodCommand,
  loadCodexRemoteWorkerDogfoodConfig,
  renderCodexRemoteWorkerDogfoodFailure,
  renderCodexRemoteWorkerDogfoodStartSummary,
} from '../../scripts/codex-remote-worker-dogfood';

const rootUrl = new URL('../..', import.meta.url);

const readText = (path: string) => readFileSync(new URL(path, rootUrl), 'utf8');
const readJson = (path: string) => JSON.parse(readFileSync(new URL(path, rootUrl), 'utf8'));
const emptyDogfoodResult = {
  planDraftCreated: false,
  packageDraftCount: 0,
  completedActionTypes: [],
  actionRunCount: 0,
  nonSucceededActionRunCount: 0,
  runSessionCount: 0,
  restartRecoveredFromActionRuns: false,
};
const digest = (seed: string): string => `sha256:${seed.repeat(64).slice(0, 64)}`;
const bootstrapEnv = (configTomlPath: string) => ({
  FORGELOOP_CONTROL_PLANE_URL: 'http://127.0.0.1:3000',
  FORGELOOP_TRUSTED_ACTOR_HEADER_SECRET: 'secret',
  FORGELOOP_CODEX_RUNTIME_SETUP_ACTOR_ID: 'setup-admin',
  FORGELOOP_CODEX_RUNTIME_SETUP_ACTOR_CLASS: 'system_bootstrap',
  FORGELOOP_CODEX_RUNTIME_SETUP_DAEMON_IDENTITY: 'setup-daemon',
  FORGELOOP_CODEX_CONFIG_TOML_PATH: configTomlPath,
  FORGELOOP_CODEX_DOCKER_IMAGE: 'ghcr.io/forgeloop/codex-runtime',
  FORGELOOP_CODEX_DOCKER_IMAGE_DIGEST: digest('a'),
  FORGELOOP_CODEX_GENERATION_EXPECTED_EFFECTIVE_CONFIG_DIGEST: digest('b'),
  FORGELOOP_CODEX_RUN_EXECUTION_EXPECTED_EFFECTIVE_CONFIG_DIGEST: digest('c'),
  FORGELOOP_CODEX_ALLOWED_SCOPE_PROJECT_ID: 'project-1',
  FORGELOOP_CODEX_ALLOWED_SCOPE_REPO_ID: 'repo-1',
  FORGELOOP_CODEX_EGRESS_ALLOWLIST_JSON: JSON.stringify([
    { id: 'openai', protocol: 'https', host: 'api.openai.com', purpose: 'model_provider' },
  ]),
  FORGELOOP_CODEX_NETWORK_PROVIDER: 'docker_network_proxy',
  FORGELOOP_CODEX_NETWORK_PROXY_IMAGE: 'ghcr.io/forgeloop/proxy',
  FORGELOOP_CODEX_NETWORK_PROXY_IMAGE_DIGEST: digest('d'),
  FORGELOOP_CODEX_NETWORK_SELF_TEST_IMAGE: 'ghcr.io/forgeloop/self-test',
  FORGELOOP_CODEX_NETWORK_SELF_TEST_IMAGE_DIGEST: digest('e'),
  FORGELOOP_WORKER_IDENTITY: 'worker-1',
  FORGELOOP_WORKER_BOOTSTRAP_TOKEN: 'worker-bootstrap-token',
  FORGELOOP_WORKER_BOOTSTRAP_TOKEN_VERSION: '1',
});
const remoteWorkerEnv = () => ({
  FORGELOOP_CONTROL_PLANE_URL: 'http://127.0.0.1:31337',
  FORGELOOP_TRUSTED_ACTOR_HEADER_SECRET: 'trusted-secret',
  FORGELOOP_AUTOMATION_ACTOR_ID: 'automation-daemon',
  FORGELOOP_AUTOMATION_DAEMON_IDENTITY: 'automation-daemon-identity',
  FORGELOOP_WORKER_IDENTITY: 'remote-worker-1',
  FORGELOOP_WORKER_BOOTSTRAP_TOKEN: 'worker-bootstrap-token',
  FORGELOOP_WORKER_BOOTSTRAP_TOKEN_VERSION: '1',
  FORGELOOP_WORKER_TEMP_ROOT: '/tmp/forgeloop-remote-worker',
  FORGELOOP_CODEX_WORKER_DOCKER_IMAGE_DIGESTS: digest('a'),
  FORGELOOP_CODEX_WORKER_NETWORK_POLICY_DIGESTS: digest('b'),
  FORGELOOP_CODEX_WORKER_NETWORK_PROVIDER_CONFIG_DIGESTS: digest('c'),
  FORGELOOP_CODEX_CLI_VERSION: 'codex-cli 0.133.0',
  FORGELOOP_CODEX_APP_SERVER_PROTOCOL_DIGEST: digest('d'),
  FORGELOOP_CODEX_ALLOWED_SCOPE_PROJECT_ID: 'project-1',
  FORGELOOP_CODEX_ALLOWED_SCOPE_REPO_ID: 'repo-1',
});

describe('automation dogfood script', () => {
  it('is registered as the root automation:dogfood command', () => {
    expect(automationDogfoodCommand).toBe('tsx --tsconfig apps/control-plane-api/tsconfig.json scripts/automation-dogfood.ts');
    expect(readJson('package.json').scripts).toMatchObject({
      'automation:dogfood': automationDogfoodCommand,
    });
  });

  it('uses product automation settings routes instead of old public delivery routes', () => {
    const source = readText('scripts/automation-dogfood.ts');

    expect(source).toContain('/automation/projects/${project.id}/capabilities');
    expect(source).not.toMatch(new RegExp(['/', 'p', '0', String.raw`/projects/[^'"\`]+/automation/capabilities`].join('')));
    expect(source).not.toContain('/' + 'p' + '0' + '/manual-path-holds');
  });

  it('renders required public-safe summary markers', () => {
    const requiredMarkers = [
      'Automation daemon dogfood',
      'Plan draft: PASSED',
      'ExecutionPackage drafts: PASSED',
      'Action runs: PASSED',
      'Action-run restart recovery: PASSED',
      'Run enqueue disabled: PASSED',
      'App-server dogfood:',
    ];
    const summary = renderAutomationDogfoodSummary({
      planDraftCreated: true,
      packageDraftCount: expectedAutomationDogfoodPackageDraftCount,
      completedActionTypes: ['ensure_package_drafts', 'ensure_package_drafts', 'project_runtime_snapshot'],
      actionRunCount: 3,
      nonSucceededActionRunCount: 0,
      runSessionCount: 0,
      restartRecoveredFromActionRuns: true,
      appServerDogfood: { status: 'skipped', reasonCode: 'fake_generation_mode' },
    });

    expect(requiredAutomationDogfoodSummaryMarkers).toEqual(requiredMarkers);
    expect(expectedAutomationDogfoodActionTypes).toEqual([
      'ensure_package_drafts',
      'ensure_package_drafts',
      'project_runtime_snapshot',
    ]);
    expect(expectedAutomationDogfoodPackageDraftCount).toBe(2);
    for (const marker of requiredMarkers) {
      expect(summary).toContain(marker);
    }
    expect(summary).toContain('no run session was enqueued');
    expect(summary).toContain('App-server dogfood: SKIPPED');
    expect(summary).not.toContain(process.cwd());
    expect(summary).not.toContain('automation-dogfood-secret');
    expect(summary).not.toContain('x-forgeloop');
  });

  it('reports skipped app-server dogfood preconditions without failing the local fake gate', () => {
    const summary = renderAutomationDogfoodSummary({
      planDraftCreated: false,
      packageDraftCount: 0,
      completedActionTypes: [],
      actionRunCount: 0,
      nonSucceededActionRunCount: 0,
      runSessionCount: 0,
      restartRecoveredFromActionRuns: false,
      appServerDogfood: { status: 'blocked', reasonCode: 'codex_docker_runtime_required' },
    });

    expect(summary).toContain('App-server dogfood: BLOCKED (codex_docker_runtime_required)');
    expect(automationDogfoodExitCode({ ...emptyDogfoodResult, appServerDogfood: { status: 'blocked', reasonCode: 'codex_docker_runtime_required' } })).toBe(1);
  });

  it('parses dogfood generation env without hiding explicit conflicts', () => {
    expect(requestedGenerationMode({})).toBe('fake');
    expect(requestedGenerationMode({ FORGELOOP_CODEX_GENERATION_DRIVER: 'app_server' })).toBe('app_server');
    expect(requestedGenerationMode({ FORGELOOP_CODEX_GENERATION_DRIVER: 'disabled' })).toBe('disabled');
    expect(() => requestedGenerationMode({ FORGELOOP_CODEX_GENERATION_DRIVER: 'codex' })).toThrow(/must_be_fake_app_server_or_disabled/);
  });

  it('does not create a fake runtime for disabled or app-server preflight skips', () => {
    const disabled = loadDogfoodGenerationRuntimeConfig({ FORGELOOP_CODEX_GENERATION_DRIVER: 'disabled' });
    expect(disabled.planning.mode).toBe('disabled');
    expect(disabled.runtime).toBeUndefined();
    expect(disabled.appServerDogfood).toEqual({ status: 'skipped', reasonCode: 'generation_disabled' });

    const directEndpoint = loadDogfoodGenerationRuntimeConfig({
      FORGELOOP_CODEX_GENERATION_DRIVER: 'app_server',
      FORGELOOP_CODEX_APP_SERVER_ENDPOINT: 'unix:/tmp/forgeloop-codex.sock',
      FORGELOOP_CODEX_GENERATION_ARTIFACT_ROOT: '/tmp/forgeloop-artifacts',
    });
    expect(directEndpoint.planning.mode).toBe('app_server');
    expect(directEndpoint.runtime).toBeUndefined();
    expect(directEndpoint.appServerDogfood).toEqual({ status: 'blocked', reasonCode: 'codex_docker_runtime_required' });

    const localDocker = loadDogfoodGenerationRuntimeConfig({
      FORGELOOP_CODEX_GENERATION_DRIVER: 'app_server',
      FORGELOOP_CODEX_WORKER_MODE: 'local_docker',
    });
    expect(localDocker.runtime).toBeUndefined();
    expect(localDocker.appServerDogfood).toEqual({ status: 'blocked', reasonCode: 'codex_worker_unavailable' });
  });

  it('loads remote outbound generation dogfood as a deferred request bound after dogfood control-plane boot', () => {
    const remote = loadDogfoodGenerationRuntimeConfig({
      FORGELOOP_CODEX_GENERATION_DRIVER: 'app_server',
      FORGELOOP_CODEX_WORKER_MODE: 'remote_outbound',
      FORGELOOP_CODEX_REMOTE_RUNTIME_JOB_WAIT_TIMEOUT_MS: '600000',
      FORGELOOP_CODEX_REMOTE_RUNTIME_JOB_POLL_INTERVAL_MS: '1000',
    });

    expect(remote.planning.mode).toBe('app_server');
    expect(remote.runtime).toBeUndefined();
    expect(remote.remoteOutboundRequested).toEqual({
      waitTimeoutMs: 600000,
      pollIntervalMs: 1000,
    });
    expect(remote.appServerDogfood).toEqual({ status: 'blocked', reasonCode: 'codex_worker_unavailable', runtimeMode: 'remote_outbound' });
  });

  it('binds remote outbound dogfood to a bootstrapped same-host worker and checks runtime evidence digests', () => {
    const source = readText('scripts/automation-dogfood.ts');

    expect(source).toContain('createRemoteCodexWorkerClient');
    expect(source).toContain('createRemoteWorkerCapsuleManager');
    expect(source).toContain('capsuleManager');
    expect(source).toContain('runCodexRuntimeDogfoodBootstrap(bootstrapConfig)');
    expect(source).toContain('generation_runtime_profile_id');
    expect(source).toContain('generation_credential_binding_id');
    expect(source).toContain('shouldContinue: () => remoteWorkerRunning');
    expect(source).toContain('job.runtime_evidence_digest');
    expect(source).toContain('codexCanonicalDigest(terminalResult.runtime_evidence)');
  });

  it('redacts non-allowlisted app-server dogfood reason text from public summaries', () => {
    const summary = renderAutomationDogfoodSummary({
      planDraftCreated: false,
      packageDraftCount: 0,
      completedActionTypes: [],
      actionRunCount: 1,
      nonSucceededActionRunCount: 1,
      runSessionCount: 0,
      restartRecoveredFromActionRuns: false,
      appServerDogfood: { status: 'failed', reasonCode: `${process.cwd()}/automation-dogfood-secret` },
    });

    expect(summary).toContain('App-server dogfood: FAILED (automation_dogfood_failed)');
    expect(summary).not.toContain(process.cwd());
    expect(summary).not.toContain('automation-dogfood-secret');
  });

  it('renders remote runtime dogfood evidence without leaking internal identifiers', () => {
    const summary = renderAutomationDogfoodSummary({
      planDraftCreated: true,
      packageDraftCount: expectedAutomationDogfoodPackageDraftCount,
      completedActionTypes: ['ensure_package_drafts', 'ensure_package_drafts', 'project_runtime_snapshot'],
      actionRunCount: 3,
      nonSucceededActionRunCount: 0,
      runSessionCount: 0,
      restartRecoveredFromActionRuns: true,
      appServerDogfood: {
        status: 'passed',
        runtimeMode: 'remote_outbound',
        blockerCode: 'codex_worker_unavailable',
        dockerizedAppServerEvidence: {
          dockerImageDigest: digest('a'),
          networkPolicyDigest: digest('b'),
          effectiveConfigDigest: digest('c'),
          containerIdDigest: digest('d'),
          workerId: 'remote-worker-1',
          runtimeJobId: 'runtime-job-1',
          appServerEndpoint: 'docker-exec:container-1',
          workspacePath: '/tmp/forgeloop-remote-worker/task-1',
        },
        artifacts: [
          { name: 'run_execution_patch', digest: digest('e'), internalRef: 'artifact://runtime-job-1/patch' },
          { name: 'review_packet', digest: digest('f'), localRef: '/tmp/review-packet.md' },
        ],
        timingBuckets: {
          queue: '<5s',
          execution: '<60s',
          terminalization: '<5s',
          startedAt: '2026-05-23T00:00:00.000Z',
        },
      },
    });

    expect(summary).toContain('- Remote runtime mode: remote_outbound');
    expect(summary).toContain(`docker_image_digest=${digest('a')}`);
    expect(summary).toContain(`network_policy_digest=${digest('b')}`);
    expect(summary).toContain(`effective_config_digest=${digest('c')}`);
    expect(summary).toContain(`container_id_digest=${digest('d')}`);
    expect(summary).toContain(`run_execution_patch=${digest('e')}`);
    expect(summary).toContain(`review_packet=${digest('f')}`);
    expect(summary).toContain('queue=<5s');
    expect(summary).toContain('execution=<60s');
    expect(summary).toContain('terminalization=<5s');
    expect(summary).not.toContain('remote-worker-1');
    expect(summary).not.toContain('runtime-job-1');
    expect(summary).not.toContain('docker-exec:');
    expect(summary).not.toContain('/tmp/');
    expect(summary).not.toContain('artifact://');
    expect(summary).not.toContain('2026-05-23T00:00:00.000Z');
  });

  it('does not hard-code fake runtime when codex app-server mode is requested', () => {
    const source = readText('scripts/automation-dogfood.ts');

    expect(source).toContain('FORGELOOP_CODEX_GENERATION_DRIVER');
    expect(source).not.toContain('FORGELOOP_CODEX_AUTOMATION_GENERATION');
    expect(source).toContain('FORGELOOP_CODEX_WORKER_MODE');
    expect(source).not.toContain('parseCodexAppServerEndpoint');
    expect(source).not.toContain("generationRuntime: createCodexGenerationRuntime({ mode: 'fake' })");
  });

  it('loads strict Codex runtime bootstrap config from file/stdin-safe auth only', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'forgeloop-bootstrap-'));
    try {
      const configPath = join(tempRoot, 'config.toml');
      writeFileSync(configPath, 'model = "gpt-5.5"\napproval_policy = "never"\nsandbox_mode = "danger-full-access"\n');
      chmodSync(configPath, 0o600);
      const config = loadCodexRuntimeDogfoodBootstrapConfig(
        bootstrapEnv(configPath),
        '{"env":{"OPENAI_API_KEY":"sk-test"}}',
      );

      expect(config.codexConfigToml).toContain('model = "gpt-5.5"');
      expect(config.authJson).toEqual({ env: { OPENAI_API_KEY: 'sk-test' } });
      expect(config.allowedScope).toEqual({ project_id: 'project-1', repo_id: 'repo-1' });
      expect(config.networkPolicy).toMatchObject({
        mode: 'egress_allowlist',
        provider: 'docker_network_proxy',
      });
      expect(config.networkPolicy.allowlist_rules).toEqual([
        { id: 'openai', protocol: 'https', host: 'api.openai.com', purpose: 'model_provider' },
      ]);
      expect(() =>
        loadCodexRuntimeDogfoodBootstrapConfig({
          ...bootstrapEnv(configPath),
          FORGELOOP_CODEX_AUTH_JSON_INLINE: '{"env":{"OPENAI_API_KEY":"sk-test"}}',
        }),
      ).toThrow(/INLINE_not_allowed/);
      const authPath = join(tempRoot, 'auth.json');
      writeFileSync(authPath, '{"env":{"OPENAI_API_KEY":"sk-test"}}');
      chmodSync(authPath, 0o644);
      expect(() =>
        loadCodexRuntimeDogfoodBootstrapConfig({
          ...bootstrapEnv(configPath),
          FORGELOOP_CODEX_AUTH_JSON_PATH: authPath,
        }),
      ).toThrow(/protected_regular_file/);
      chmodSync(authPath, 0o600);
      expect(
        loadCodexRuntimeDogfoodBootstrapConfig({
          ...bootstrapEnv(configPath),
          FORGELOOP_CODEX_AUTH_JSON_PATH: authPath,
        }).authJson,
      ).toEqual({ env: { OPENAI_API_KEY: 'sk-test' } });

      chmodSync(configPath, 0o644);
      expect(() =>
        loadCodexRuntimeDogfoodBootstrapConfig(bootstrapEnv(configPath), '{"env":{"OPENAI_API_KEY":"sk-test"}}'),
      ).toThrow(/protected_regular_file/);
      chmodSync(configPath, 0o600);

      expect(() =>
        loadCodexRuntimeDogfoodBootstrapConfig({
          ...bootstrapEnv(configPath),
          FORGELOOP_CODEX_EGRESS_ALLOWLIST_JSON: JSON.stringify([
            { id: 'npm', protocol: 'https', host: 'registry.npmjs.org', purpose: 'package_registry' },
          ]),
        }, '{"env":{"OPENAI_API_KEY":"sk-test"}}'),
      ).toThrow(/model_provider/);
      expect(() =>
        loadCodexRuntimeDogfoodBootstrapConfig({
          ...bootstrapEnv(configPath),
          FORGELOOP_CODEX_EGRESS_ALLOWLIST_JSON: JSON.stringify([
            { protocol: 'https', host: 'api.openai.com', purpose: 'model_provider' },
          ]),
        }, '{"env":{"OPENAI_API_KEY":"sk-test"}}'),
      ).toThrow(/invalid_rule/);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('bootstraps separate generation and run-execution worker trust roots', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'forgeloop-bootstrap-split-'));
    const requests: Array<{ path: string; body: Record<string, unknown> }> = [];
    try {
      const configPath = join(tempRoot, 'config.toml');
      writeFileSync(configPath, 'model = "gpt-5.5"\napproval_policy = "never"\nsandbox_mode = "danger-full-access"\n');
      chmodSync(configPath, 0o600);
      const config = loadCodexRuntimeDogfoodBootstrapConfig(
        bootstrapEnv(configPath),
        '{"env":{"OPENAI_API_KEY":"sk-test"}}',
      );
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string | URL, init?: RequestInit) => {
          const path = new URL(String(url)).pathname;
          const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
          requests.push({ path, body });
          if (path === '/internal/codex-runtime/import-local-codex') {
            return new Response(
              JSON.stringify({
                profile_id: `profile-${body.target_kind}`,
                profile_revision_id: `revision-${body.target_kind}`,
                credential_binding_id: `binding-${body.target_kind}`,
                codex_config_digest: digest('c'),
              }),
              { status: 201 },
            );
          }
          return new Response(JSON.stringify({ ok: true }), { status: 201 });
        }),
      );

      const summary = await runCodexRuntimeDogfoodBootstrap(config);
      const importBodies = requests
        .filter((request) => request.path === '/internal/codex-runtime/import-local-codex')
        .map((request) => request.body);
      const bootstrapBodies = requests
        .filter((request) => request.path === '/internal/codex-runtime/worker-bootstrap-tokens')
        .map((request) => request.body);

      const generationWorkerIdentity = codexRuntimeDogfoodWorkerIdentityForTarget('worker-1', 'generation');
      const runExecutionWorkerIdentity = codexRuntimeDogfoodWorkerIdentityForTarget('worker-1', 'run_execution');
      expect(summary).toMatchObject({
        generation_worker_identity: generationWorkerIdentity,
        run_execution_worker_identity: runExecutionWorkerIdentity,
      });
      expect(bootstrapBodies.map((body) => body.id)).toEqual([
        expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
        expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
      ]);
      expect(importBodies).toEqual([
        expect.objectContaining({
          target_kind: 'generation',
          codex_config_toml: expect.stringContaining('sandbox_mode = "read-only"'),
        }),
        expect.objectContaining({
          target_kind: 'run_execution',
          codex_config_toml: expect.stringContaining('sandbox_mode = "danger-full-access"'),
        }),
      ]);
      expect(bootstrapBodies).toEqual([
        expect.objectContaining({
          worker_identity: generationWorkerIdentity,
          allowed_scopes_json: [{ project_id: 'project-1' }],
          allowed_capabilities_json: expect.objectContaining({ target_kinds: ['generation'] }),
        }),
        expect.objectContaining({
          worker_identity: runExecutionWorkerIdentity,
          allowed_scopes_json: [{ project_id: 'project-1', repo_id: 'repo-1' }],
          allowed_capabilities_json: expect.objectContaining({ target_kinds: ['run_execution'] }),
        }),
      ]);
      expect(bootstrapBodies[0]?.bootstrap_token_hash).not.toBe(bootstrapBodies[1]?.bootstrap_token_hash);
      expect(new Set(bootstrapBodies.map((body) => `${String(body.bootstrap_token_hash)}:${String(body.bootstrap_token_version)}`)).size).toBe(
        bootstrapBodies.length,
      );
    } finally {
      vi.unstubAllGlobals();
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('preserves centrally imported provider credentials while deriving target-specific Codex policy', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'forgeloop-bootstrap-provider-'));
    const requests: Array<{ path: string; body: Record<string, unknown> }> = [];
    const providerToken = 'sk-channel-test-token';
    try {
      const configPath = join(tempRoot, 'config.toml');
      writeFileSync(
        configPath,
        [
          'model_provider = "x2r"',
          'model = "gpt-5.5"',
          'approval_policy = "on-request"',
          'sandbox_mode = "workspace-write"',
          'model_reasoning_effort = "xhigh"',
          '',
          '[model_providers.x2r]',
          'name = "x2r"',
          'base_url = "https://ai.x2r.store/v1"',
          'wire_api = "responses"',
          `experimental_bearer_token = "${providerToken}"`,
          'requires_openai_auth = true',
          '',
        ].join('\n'),
      );
      chmodSync(configPath, 0o600);
      const config = loadCodexRuntimeDogfoodBootstrapConfig(
        {
          ...bootstrapEnv(configPath),
          FORGELOOP_CODEX_EGRESS_ALLOWLIST_JSON: JSON.stringify([
            { id: 'x2r', protocol: 'https', host: 'ai.x2r.store', purpose: 'model_provider' },
          ]),
        },
        '{"auth_mode":"chatgpt","OPENAI_API_KEY":null}',
      );
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string | URL, init?: RequestInit) => {
          const path = new URL(String(url)).pathname;
          const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
          requests.push({ path, body });
          if (path === '/internal/codex-runtime/import-local-codex') {
            return new Response(
              JSON.stringify({
                profile_id: `profile-${body.target_kind}`,
                profile_revision_id: `revision-${body.target_kind}`,
                credential_binding_id: `binding-${body.target_kind}`,
                codex_config_digest: digest(String(body.target_kind === 'generation' ? 'g' : 'r')),
              }),
              { status: 201 },
            );
          }
          return new Response(JSON.stringify({ ok: true }), { status: 201 });
        }),
      );

      const summary = await runCodexRuntimeDogfoodBootstrap(config);
      const importBodies = requests
        .filter((request) => request.path === '/internal/codex-runtime/import-local-codex')
        .map((request) => request.body);
      const generationConfig = String(importBodies.find((body) => body.target_kind === 'generation')?.codex_config_toml ?? '');
      const runExecutionConfig = String(importBodies.find((body) => body.target_kind === 'run_execution')?.codex_config_toml ?? '');
      const publicSummary = JSON.stringify(summary);

      expect(generationConfig).toContain('model_provider = "x2r"');
      expect(generationConfig).toContain('base_url = "https://ai.x2r.store/v1"');
      expect(generationConfig).toContain(`experimental_bearer_token = "${providerToken}"`);
      expect(generationConfig).toContain('requires_openai_auth = true');
      expect(generationConfig).toContain('approval_policy = "never"');
      expect(generationConfig).toContain('sandbox_mode = "read-only"');
      expect(generationConfig).not.toContain('approval_policy = "on-request"');
      expect(generationConfig).not.toContain('sandbox_mode = "workspace-write"');

      expect(runExecutionConfig).toContain('model_provider = "x2r"');
      expect(runExecutionConfig).toContain('base_url = "https://ai.x2r.store/v1"');
      expect(runExecutionConfig).toContain(`experimental_bearer_token = "${providerToken}"`);
      expect(runExecutionConfig).toContain('requires_openai_auth = true');
      expect(runExecutionConfig).toContain('approval_policy = "never"');
      expect(runExecutionConfig).toContain('sandbox_mode = "danger-full-access"');
      expect(runExecutionConfig).not.toContain('approval_policy = "on-request"');
      expect(runExecutionConfig).not.toContain('sandbox_mode = "workspace-write"');

      expect(publicSummary).not.toContain(providerToken);
      expect(publicSummary).not.toContain('experimental_bearer_token');
      expect(publicSummary).not.toContain('config.toml');
      expect(publicSummary).not.toContain('auth.json');
      expect(config.networkPolicy.allowlist_rules).toEqual([
        { id: 'x2r', protocol: 'https', host: 'ai.x2r.store', purpose: 'model_provider' },
      ]);
    } finally {
      vi.unstubAllGlobals();
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('derives worker bootstrap token ids from the scoped trust root', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'forgeloop-bootstrap-scoped-token-'));
    const requests: Array<{ path: string; body: Record<string, unknown> }> = [];
    try {
      const configPath = join(tempRoot, 'config.toml');
      writeFileSync(configPath, 'model = "gpt-5.5"\napproval_policy = "never"\nsandbox_mode = "danger-full-access"\n');
      chmodSync(configPath, 0o600);
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string | URL, init?: RequestInit) => {
          const path = new URL(String(url)).pathname;
          const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
          requests.push({ path, body });
          if (path === '/internal/codex-runtime/import-local-codex') {
            return new Response(
              JSON.stringify({
                profile_id: `${String(body.project_id)}-${String(body.target_kind)}-profile`,
                profile_revision_id: `${String(body.project_id)}-${String(body.target_kind)}-revision`,
                credential_binding_id: `${String(body.project_id)}-${String(body.target_kind)}-binding`,
                codex_config_digest: digest(String(body.target_kind === 'generation' ? 'g' : 'r')),
              }),
              { status: 201 },
            );
          }
          return new Response(JSON.stringify({ ok: true }), { status: 201 });
        }),
      );

      await runCodexRuntimeDogfoodBootstrap(
        loadCodexRuntimeDogfoodBootstrapConfig(bootstrapEnv(configPath), '{"env":{"OPENAI_API_KEY":"sk-test"}}'),
      );
      await runCodexRuntimeDogfoodBootstrap(
        loadCodexRuntimeDogfoodBootstrapConfig(
          {
            ...bootstrapEnv(configPath),
            FORGELOOP_CODEX_ALLOWED_SCOPE_PROJECT_ID: 'project-2',
            FORGELOOP_CODEX_ALLOWED_SCOPE_REPO_ID: 'repo-2',
          },
          '{"env":{"OPENAI_API_KEY":"sk-test"}}',
        ),
      );

      const bootstrapBodies = requests
        .filter((request) => request.path === '/internal/codex-runtime/worker-bootstrap-tokens')
        .map((request) => request.body);
      const generationWorkerIdentity = codexRuntimeDogfoodWorkerIdentityForTarget('worker-1', 'generation');
      const runExecutionWorkerIdentity = codexRuntimeDogfoodWorkerIdentityForTarget('worker-1', 'run_execution');
      const generationIds = bootstrapBodies
        .filter((body) => body.worker_identity === generationWorkerIdentity)
        .map((body) => body.id);
      const runExecutionIds = bootstrapBodies
        .filter((body) => body.worker_identity === runExecutionWorkerIdentity)
        .map((body) => body.id);

      expect(generationIds).toHaveLength(2);
      expect(runExecutionIds).toHaveLength(2);
      expect(new Set(generationIds).size).toBe(2);
      expect(new Set(runExecutionIds).size).toBe(2);
      for (const id of [...generationIds, ...runExecutionIds]) {
        expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      }
      expect(new Set(bootstrapBodies.map((body) => `${String(body.bootstrap_token_hash)}:${String(body.bootstrap_token_version)}`)).size).toBe(
        bootstrapBodies.length,
      );
      expect(generationWorkerIdentity).toMatch(/^codex-runtime-dogfood-worker-[a-f0-9]{12}-generation$/);
      expect(runExecutionWorkerIdentity).toMatch(/^codex-runtime-dogfood-worker-[a-f0-9]{12}-run-execution$/);
    } finally {
      vi.unstubAllGlobals();
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('rejects bootstrap allowlists that omit the configured model provider host', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'forgeloop-bootstrap-provider-allowlist-'));
    try {
      const configPath = join(tempRoot, 'config.toml');
      writeFileSync(
        configPath,
        [
          'model_provider = "x2r"',
          'model = "gpt-5.5"',
          '',
          '[model_providers.x2r]',
          'base_url = "https://ai.x2r.store/v1"',
          'wire_api = "responses"',
          'experimental_bearer_token = "sk-channel-test-token"',
          'requires_openai_auth = true',
          '',
        ].join('\n'),
      );
      chmodSync(configPath, 0o600);

      expect(() =>
        loadCodexRuntimeDogfoodBootstrapConfig(
          {
            ...bootstrapEnv(configPath),
            FORGELOOP_CODEX_EGRESS_ALLOWLIST_JSON: JSON.stringify([
              { id: 'openai', protocol: 'https', host: 'api.openai.com', purpose: 'model_provider' },
            ]),
          },
          '{"auth_mode":"chatgpt","OPENAI_API_KEY":null}',
        ),
      ).toThrow(/FORGELOOP_CODEX_EGRESS_ALLOWLIST_JSON_missing_model_provider_host/);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('renders bootstrap CLI failures without raw config, auth, token, or route markers', () => {
    const message = renderCodexRuntimeDogfoodBootstrapCliFailure(
      new Error('FORGELOOP_CODEX_AUTH_JSON_PATH_missing:/internal/codex-runtime/import-local-codex:sk-channel-test-token'),
    );

    expect(message).toBe('codex_runtime_bootstrap_failed');
    expect(message).not.toContain('FORGELOOP_CODEX_AUTH_JSON_PATH');
    expect(message).not.toContain('/internal/codex-runtime');
    expect(message).not.toContain('sk-channel-test-token');
    expect(message).not.toContain('config.toml');
    expect(message).not.toContain('auth.json');
  });

  it('loads remote worker dogfood config and renders only public-safe startup evidence', () => {
    const config = loadCodexRemoteWorkerDogfoodConfig(remoteWorkerEnv());
    const summary = renderCodexRemoteWorkerDogfoodStartSummary(config);

    expect(codexRemoteWorkerDogfoodCommand).toBe(
      'tsx --tsconfig apps/control-plane-api/tsconfig.json scripts/codex-remote-worker-dogfood.ts',
    );
    expect(config.allowedScopes).toEqual([{ project_id: 'project-1', repo_id: 'repo-1' }]);
    expect(config.dockerImageDigests).toEqual([digest('a')]);
    expect(summary).toContain('Remote Codex worker dogfood');
    expect(summary).toContain(digest('a'));
    expect(summary).toContain(digest('b'));
    expect(summary).toContain(digest('d'));
    expect(summary).not.toContain('remote-worker-1');
    expect(summary).not.toContain('http://127.0.0.1:31337');
    expect(summary).not.toContain('trusted-secret');
    expect(summary).not.toContain('worker-bootstrap-token');
    expect(summary).not.toContain('/tmp/forgeloop-remote-worker');
  });

  it('enforces no-shared-filesystem remote worker mode without repo roots or host config paths', () => {
    const config = loadCodexRemoteWorkerDogfoodConfig({
      ...remoteWorkerEnv(),
      FORGELOOP_CODEX_NO_SHARED_FILESYSTEM: '1',
      FORGELOOP_CODEX_WORKER_CAPABILITIES: 'run_execution',
    });
    const summary = renderCodexRemoteWorkerDogfoodStartSummary(config);

    expect(config.noSharedFilesystem).toBe(true);
    expect(config.allowedRepoRoots).toEqual([]);
    expect(summary).toContain('No shared filesystem: enabled');
    expect(summary).not.toContain('/tmp/forgeloop-remote-worker');
    expect(summary).not.toContain('config.toml');
    expect(summary).not.toContain('auth.json');

    expect(() =>
      loadCodexRemoteWorkerDogfoodConfig({
        ...remoteWorkerEnv(),
        FORGELOOP_CODEX_NO_SHARED_FILESYSTEM: '1',
        FORGELOOP_AUTOMATION_ALLOWED_REPO_ROOTS: '/repo',
      }),
    ).toThrow(/FORGELOOP_AUTOMATION_ALLOWED_REPO_ROOTS_not_allowed/);
    expect(() =>
      loadCodexRemoteWorkerDogfoodConfig({
        ...remoteWorkerEnv(),
        FORGELOOP_CODEX_NO_SHARED_FILESYSTEM: '1',
        FORGELOOP_CODEX_CONFIG_TOML_PATH: '/tmp/config.toml',
      }),
    ).toThrow(/FORGELOOP_CODEX_CONFIG_TOML_PATH_not_allowed/);
    expect(() =>
      loadCodexRemoteWorkerDogfoodConfig({
        ...remoteWorkerEnv(),
        FORGELOOP_CODEX_NO_SHARED_FILESYSTEM: '1',
        FORGELOOP_CODEX_AUTH_JSON_PATH: '/tmp/auth.json',
      }),
    ).toThrow(/FORGELOOP_CODEX_AUTH_JSON_PATH_not_allowed/);
  });

  it('redacts remote worker dogfood failures to public-safe codes', () => {
    const message = renderCodexRemoteWorkerDogfoodFailure(
      new Error('docker failed for /tmp/forgeloop-remote-worker at http://127.0.0.1:31337 with worker-bootstrap-token'),
    );

    expect(message).toBe('Remote Codex worker dogfood failed: codex_remote_worker_dogfood_failed');
    expect(message).not.toContain('/tmp/forgeloop-remote-worker');
    expect(message).not.toContain('http://127.0.0.1:31337');
    expect(message).not.toContain('worker-bootstrap-token');
    expect(renderCodexRemoteWorkerDogfoodFailure(new Error('codex_worker_docker_unavailable: /tmp/private'))).toBe(
      'Remote Codex worker dogfood failed: codex_worker_docker_unavailable',
    );
  });

  it('keeps the remote worker runbook anchored on central config bootstrap and task isolation', () => {
    const runbook = readText('docs/runbooks/codex-remote-worker-runtime.md');

    expect(runbook).toContain('central runtime profile/auth bootstrap');
    expect(runbook).toContain('per-task CODEX_HOME');
    expect(runbook).toContain('same-host remote worker');
    expect(runbook).toContain('generation dogfood');
    expect(runbook).toContain('run execution dogfood');
    expect(runbook).toContain('worker drain');
    expect(runbook).toContain('worker restart');
    expect(runbook).toContain('scavenger');
    expect(runbook).toContain('public-safe blocker codes');
  });

  it('fails the dogfood gate unless every expected daemon artifact is present exactly once', () => {
    const passing = {
      planDraftCreated: true,
      packageDraftCount: expectedAutomationDogfoodPackageDraftCount,
      completedActionTypes: ['ensure_package_drafts', 'ensure_package_drafts', 'project_runtime_snapshot'],
      actionRunCount: 3,
      nonSucceededActionRunCount: 0,
      runSessionCount: 0,
      restartRecoveredFromActionRuns: true,
      appServerDogfood: { status: 'skipped', reasonCode: 'fake_generation_mode' },
    } as const;

    expect(automationDogfoodExitCode(passing)).toBe(0);
    expect(automationDogfoodExitCode({ ...passing, appServerDogfood: { status: 'passed' } })).toBe(1);
    const staticConfigOnly = {
      ...passing,
      appServerDogfood: {
        status: 'passed',
        runtimeMode: 'remote_outbound',
        dockerizedAppServerEvidence: {
          dockerImageDigest: digest('a'),
          networkPolicyDigest: digest('b'),
          effectiveConfigDigest: digest('c'),
        },
      },
    } as const;
    expect(automationDogfoodExitCode(staticConfigOnly)).toBe(1);
    expect(
      automationDogfoodExitCode({
        ...staticConfigOnly,
        appServerDogfood: {
          ...staticConfigOnly.appServerDogfood,
          dockerizedAppServerEvidence: {
            ...staticConfigOnly.appServerDogfood.dockerizedAppServerEvidence,
            containerIdDigest: digest('d'),
          },
        },
      }),
    ).toBe(1);
    expect(
      automationDogfoodExitCode({
        ...staticConfigOnly,
        appServerDogfood: {
          ...staticConfigOnly.appServerDogfood,
          dockerizedAppServerEvidence: {
            ...staticConfigOnly.appServerDogfood.dockerizedAppServerEvidence,
            containerIdDigest: digest('d'),
          },
          artifacts: [{ name: 'generated-payload.json', digest: digest('e') }],
        },
      }),
    ).toBe(1);
    expect(
      automationDogfoodExitCode({
        ...staticConfigOnly,
        appServerDogfood: {
          ...staticConfigOnly.appServerDogfood,
          dockerizedAppServerEvidence: {
            ...staticConfigOnly.appServerDogfood.dockerizedAppServerEvidence,
            containerIdDigest: digest('d'),
          },
          artifacts: [{ name: 'generated-payload.json', digest: digest('e') }],
          timingBuckets: { queue: '<5s', execution: '<60s', terminalization: '<5s' },
        },
      }),
    ).toBe(0);
    expect(automationDogfoodExitCode({ ...passing, planDraftCreated: false })).toBe(1);
    expect(automationDogfoodExitCode({ ...passing, packageDraftCount: 0 })).toBe(1);
    expect(automationDogfoodExitCode({ ...passing, packageDraftCount: 1 })).toBe(1);
    expect(automationDogfoodExitCode({ ...passing, packageDraftCount: 3 })).toBe(1);
    expect(automationDogfoodExitCode({ ...passing, completedActionTypes: ['ensure_package_drafts'] })).toBe(1);
    expect(
      automationDogfoodExitCode({
        ...passing,
        completedActionTypes: ['ensure_package_drafts', 'ensure_package_drafts', 'ensure_package_drafts', 'project_runtime_snapshot'],
        actionRunCount: 4,
      }),
    ).toBe(1);
    expect(
      automationDogfoodExitCode({
        ...passing,
        completedActionTypes: ['ensure_package_drafts', 'ensure_package_drafts', 'project_runtime_snapshot', 'unexpected_action'],
        actionRunCount: 4,
      }),
    ).toBe(1);
    expect(automationDogfoodExitCode({ ...passing, actionRunCount: 4 })).toBe(1);
    expect(automationDogfoodExitCode({ ...passing, actionRunCount: 4, nonSucceededActionRunCount: 1 })).toBe(1);
    expect(automationDogfoodExitCode({ ...passing, runSessionCount: 1 })).toBe(1);
    expect(automationDogfoodExitCode({ ...passing, restartRecoveredFromActionRuns: false })).toBe(1);
  });
});
