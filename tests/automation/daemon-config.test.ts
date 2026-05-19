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

  it('maps legacy codex generation mode to the app_server generation driver', () => {
    const config = loadAutomationDaemonConfig({
      ...baseEnv,
      FORGELOOP_CODEX_AUTOMATION_GENERATION: 'codex',
    });

    expect(config.generationPlanning.mode).toBe('app_server');
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
});
