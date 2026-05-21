import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  automationDogfoodExitCode,
  automationDogfoodCommand,
  expectedAutomationDogfoodActionTypes,
  expectedAutomationDogfoodPackageDraftCount,
  renderAutomationDogfoodSummary,
  requiredAutomationDogfoodSummaryMarkers,
} from '../../scripts/automation-dogfood-summary';
import { loadDogfoodGenerationRuntimeConfig, requestedGenerationMode } from '../../scripts/automation-dogfood';
import { loadCodexRuntimeDogfoodBootstrapConfig } from '../../scripts/codex-runtime-dogfood-bootstrap';

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
const bootstrapEnv = () => ({
  FORGELOOP_CONTROL_PLANE_URL: 'http://127.0.0.1:3000',
  FORGELOOP_TRUSTED_ACTOR_HEADER_SECRET: 'secret',
  FORGELOOP_CODEX_RUNTIME_SETUP_ACTOR_ID: 'setup-admin',
  FORGELOOP_CODEX_RUNTIME_SETUP_ACTOR_CLASS: 'system_bootstrap',
  FORGELOOP_CODEX_RUNTIME_SETUP_DAEMON_IDENTITY: 'setup-daemon',
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
      completedActionTypes: ['ensure_plan_draft', 'ensure_package_drafts', 'project_runtime_snapshot'],
      actionRunCount: 3,
      nonSucceededActionRunCount: 0,
      runSessionCount: 0,
      restartRecoveredFromActionRuns: true,
      appServerDogfood: { status: 'skipped', reasonCode: 'fake_generation_mode' },
    });

    expect(requiredAutomationDogfoodSummaryMarkers).toEqual(requiredMarkers);
    expect(expectedAutomationDogfoodActionTypes).toEqual([
      'ensure_package_drafts',
      'ensure_plan_draft',
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
    expect(requestedGenerationMode({ FORGELOOP_CODEX_AUTOMATION_GENERATION: 'codex' })).toBe('app_server');
    expect(requestedGenerationMode({ FORGELOOP_CODEX_GENERATION_DRIVER: 'app_server' })).toBe('app_server');
    expect(() =>
      requestedGenerationMode({
        FORGELOOP_CODEX_AUTOMATION_GENERATION: 'fake',
        FORGELOOP_CODEX_GENERATION_DRIVER: 'app_server',
      }),
    ).toThrow(/conflicts/);
    expect(() => requestedGenerationMode({ FORGELOOP_CODEX_GENERATION_DRIVER: 'disabled' })).toThrow(
      /must_be_fake_or_app_server/,
    );
  });

  it('does not create a fake runtime for disabled or app-server preflight skips', () => {
    const disabled = loadDogfoodGenerationRuntimeConfig({ FORGELOOP_CODEX_AUTOMATION_GENERATION: 'disabled' });
    expect(disabled.planning.mode).toBe('disabled');
    expect(disabled.runtime).toBeUndefined();
    expect(disabled.appServerDogfood).toEqual({ status: 'skipped', reasonCode: 'generation_disabled' });

    const directEndpoint = loadDogfoodGenerationRuntimeConfig({
      FORGELOOP_CODEX_AUTOMATION_GENERATION: 'codex',
      FORGELOOP_CODEX_APP_SERVER_ENDPOINT: 'unix:/tmp/forgeloop-codex.sock',
      FORGELOOP_CODEX_GENERATION_ARTIFACT_ROOT: '/tmp/forgeloop-artifacts',
    });
    expect(directEndpoint.planning.mode).toBe('app_server');
    expect(directEndpoint.runtime).toBeUndefined();
    expect(directEndpoint.appServerDogfood).toEqual({ status: 'blocked', reasonCode: 'codex_docker_runtime_required' });

    const localDocker = loadDogfoodGenerationRuntimeConfig({
      FORGELOOP_CODEX_AUTOMATION_GENERATION: 'codex',
      FORGELOOP_CODEX_WORKER_MODE: 'local_docker',
    });
    expect(localDocker.runtime).toBeUndefined();
    expect(localDocker.appServerDogfood).toEqual({ status: 'blocked', reasonCode: 'codex_worker_unavailable' });
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

  it('does not hard-code fake runtime when codex app-server mode is requested', () => {
    const source = readText('scripts/automation-dogfood.ts');

    expect(source).toContain('FORGELOOP_CODEX_AUTOMATION_GENERATION');
    expect(source).toContain('FORGELOOP_CODEX_WORKER_MODE');
    expect(source).not.toContain('parseCodexAppServerEndpoint');
    expect(source).not.toContain("generationRuntime: createCodexGenerationRuntime({ mode: 'fake' })");
  });

  it('loads strict Codex runtime bootstrap config from file/stdin-safe auth only', () => {
    const config = loadCodexRuntimeDogfoodBootstrapConfig(bootstrapEnv(), '{"env":{"OPENAI_API_KEY":"sk-test"}}');

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
        ...bootstrapEnv(),
        FORGELOOP_CODEX_AUTH_JSON_INLINE: '{"env":{"OPENAI_API_KEY":"sk-test"}}',
      }),
    ).toThrow(/INLINE_not_allowed/);
    const tempRoot = mkdtempSync(join(tmpdir(), 'forgeloop-auth-'));
    try {
      const authPath = join(tempRoot, 'auth.json');
      writeFileSync(authPath, '{"env":{"OPENAI_API_KEY":"sk-test"}}');
      chmodSync(authPath, 0o644);
      expect(() =>
        loadCodexRuntimeDogfoodBootstrapConfig({
          ...bootstrapEnv(),
          FORGELOOP_CODEX_AUTH_JSON_PATH: authPath,
        }),
      ).toThrow(/protected_regular_file/);
      chmodSync(authPath, 0o600);
      expect(
        loadCodexRuntimeDogfoodBootstrapConfig({
          ...bootstrapEnv(),
          FORGELOOP_CODEX_AUTH_JSON_PATH: authPath,
        }).authJson,
      ).toEqual({ env: { OPENAI_API_KEY: 'sk-test' } });
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
    expect(() =>
      loadCodexRuntimeDogfoodBootstrapConfig({
        ...bootstrapEnv(),
        FORGELOOP_CODEX_EGRESS_ALLOWLIST_JSON: JSON.stringify([
          { id: 'npm', protocol: 'https', host: 'registry.npmjs.org', purpose: 'package_registry' },
        ]),
      }, '{"env":{"OPENAI_API_KEY":"sk-test"}}'),
    ).toThrow(/model_provider/);
  });

  it('fails the dogfood gate unless every expected daemon artifact is present exactly once', () => {
    const passing = {
      planDraftCreated: true,
      packageDraftCount: expectedAutomationDogfoodPackageDraftCount,
      completedActionTypes: ['ensure_plan_draft', 'ensure_package_drafts', 'project_runtime_snapshot'],
      actionRunCount: 3,
      nonSucceededActionRunCount: 0,
      runSessionCount: 0,
      restartRecoveredFromActionRuns: true,
      appServerDogfood: { status: 'skipped', reasonCode: 'fake_generation_mode' },
    } as const;

    expect(automationDogfoodExitCode(passing)).toBe(0);
    expect(automationDogfoodExitCode({ ...passing, planDraftCreated: false })).toBe(1);
    expect(automationDogfoodExitCode({ ...passing, packageDraftCount: 0 })).toBe(1);
    expect(automationDogfoodExitCode({ ...passing, packageDraftCount: 1 })).toBe(1);
    expect(automationDogfoodExitCode({ ...passing, packageDraftCount: 3 })).toBe(1);
    expect(automationDogfoodExitCode({ ...passing, completedActionTypes: ['ensure_plan_draft'] })).toBe(1);
    expect(
      automationDogfoodExitCode({
        ...passing,
        completedActionTypes: ['ensure_plan_draft', 'ensure_plan_draft', 'ensure_package_drafts', 'project_runtime_snapshot'],
        actionRunCount: 4,
      }),
    ).toBe(1);
    expect(
      automationDogfoodExitCode({
        ...passing,
        completedActionTypes: ['ensure_plan_draft', 'ensure_package_drafts', 'project_runtime_snapshot', 'unexpected_action'],
        actionRunCount: 4,
      }),
    ).toBe(1);
    expect(automationDogfoodExitCode({ ...passing, actionRunCount: 4 })).toBe(1);
    expect(automationDogfoodExitCode({ ...passing, actionRunCount: 4, nonSucceededActionRunCount: 1 })).toBe(1);
    expect(automationDogfoodExitCode({ ...passing, runSessionCount: 1 })).toBe(1);
    expect(automationDogfoodExitCode({ ...passing, restartRecoveredFromActionRuns: false })).toBe(1);
  });
});
