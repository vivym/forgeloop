import { describe, expect, it } from 'vitest';

import { loadAutomationDaemonConfig } from '../../apps/automation-daemon/src/config';

const baseEnv = {
  FORGELOOP_CONTROL_PLANE_URL: 'http://127.0.0.1:3000',
  FORGELOOP_TRUSTED_ACTOR_HEADER_SECRET: 'secret',
  FORGELOOP_AUTOMATION_DAEMON_IDENTITY: 'daemon',
  FORGELOOP_AUTOMATION_ACTOR_ID: 'actor',
  FORGELOOP_AUTOMATION_ALLOWED_REPO_ROOTS: '/tmp/repos',
};

describe('automation daemon generation config', () => {
  it('defaults package_drafts to disabled for 2A', () => {
    const config = loadAutomationDaemonConfig({
      ...baseEnv,
      FORGELOOP_CODEX_AUTOMATION_GENERATION: 'fake',
    });

    expect(config.generationPlanning.tasks.spec_draft.enabled).toBe(true);
    expect(config.generationPlanning.tasks.plan_draft.enabled).toBe(true);
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

  it('allows task flags to override driver defaults', () => {
    const config = loadAutomationDaemonConfig({
      ...baseEnv,
      FORGELOOP_CODEX_GENERATION_DRIVER: 'fake',
      FORGELOOP_CODEX_GENERATION_SPEC_DRAFT_ENABLED: 'false',
      FORGELOOP_CODEX_GENERATION_PLAN_DRAFT_ENABLED: 'false',
      FORGELOOP_CODEX_GENERATION_PACKAGE_DRAFTS_ENABLED: 'true',
    });

    expect(config.generationPlanning.tasks.spec_draft.enabled).toBe(false);
    expect(config.generationPlanning.tasks.plan_draft.enabled).toBe(false);
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
