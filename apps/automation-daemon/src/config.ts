import path from 'node:path';
import type { AutomationGenerationPlanningConfig } from '@forgeloop/automation';

export const DEFAULT_AUTOMATION_LOOP_INTERVAL_MS = 5_000;
export const DEFAULT_AUTOMATION_NO_CLAIM_BACKOFF_MS = 10_000;
export const DEFAULT_WORKFLOW_POLICY_PARSER_VERSION = 'workflow-md-parser:v1';

export interface AutomationDaemonConfig {
  controlPlaneUrl: string;
  trustedActorHeaderSecret: string;
  daemonIdentity: string;
  actorId: string;
  allowedRepoRoots: string[];
  loopIntervalMs: number;
  noClaimBackoffMs: number;
  policyParserVersion: string;
  codexAutomationGeneration: AutomationGenerationPlanningConfig['mode'];
  generationPlanning: AutomationGenerationPlanningConfig;
}

type EnvLike = Record<string, string | undefined>;

const requiredEnv = (env: EnvLike, key: string): string => {
  const value = env[key];
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`Missing required automation daemon config: ${key}`);
  }
  return value;
};

const optionalPositiveInt = (env: EnvLike, key: string, fallback: number): number => {
  const raw = env[key];
  if (raw === undefined || raw.trim().length === 0) {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Invalid automation daemon config: ${key} must be a positive integer`);
  }
  return value;
};

const pathListEnv = (env: EnvLike, key: string): string[] => {
  const raw = requiredEnv(env, key);
  const values = raw
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (values.length === 0) {
    throw new Error(`Invalid automation daemon config: ${key} must contain at least one path`);
  }
  return values;
};

const booleanEnv = (env: EnvLike, key: string, fallback: boolean): boolean => {
  const raw = env[key];
  if (raw === undefined || raw.trim().length === 0) {
    return fallback;
  }
  const normalized = raw.trim().toLowerCase();
  if (normalized === 'true') {
    return true;
  }
  if (normalized === 'false') {
    return false;
  }
  throw new Error(`Invalid automation daemon config: ${key} must be true or false`);
};

const legacyGenerationModeEnv = (env: EnvLike): AutomationGenerationPlanningConfig['mode'] => {
  const raw = env.FORGELOOP_CODEX_AUTOMATION_GENERATION?.trim() ?? 'disabled';
  if (raw === 'disabled' || raw === 'fake') {
    return raw;
  }
  if (raw === 'codex') {
    return 'app_server';
  }
  throw new Error('Invalid automation daemon config: FORGELOOP_CODEX_AUTOMATION_GENERATION must be disabled, fake, or codex');
};

const generationDriverEnv = (env: EnvLike): AutomationGenerationPlanningConfig['mode'] => {
  const legacyMode = legacyGenerationModeEnv(env);
  const rawDriver = env.FORGELOOP_CODEX_GENERATION_DRIVER?.trim();
  if (rawDriver === undefined || rawDriver.length === 0) {
    return legacyMode;
  }
  if (rawDriver === 'cli' || rawDriver === 'exec' || rawDriver === 'exec_fallback' || rawDriver === 'codex_exec') {
    throw new Error(`Invalid automation daemon config: FORGELOOP_CODEX_GENERATION_DRIVER=${rawDriver} is not allowed`);
  }
  if (rawDriver !== 'fake' && rawDriver !== 'app_server') {
    throw new Error('Invalid automation daemon config: FORGELOOP_CODEX_GENERATION_DRIVER must be fake or app_server');
  }
  if (env.FORGELOOP_CODEX_AUTOMATION_GENERATION !== undefined && legacyMode !== rawDriver) {
    throw new Error('Invalid automation daemon config: FORGELOOP_CODEX_GENERATION_DRIVER conflicts with FORGELOOP_CODEX_AUTOMATION_GENERATION');
  }
  return rawDriver;
};

const generationPlanningEnv = (env: EnvLike): AutomationGenerationPlanningConfig => {
  const mode = generationDriverEnv(env);
  const defaultsEnabled = mode !== 'disabled';
  return {
    mode,
    tasks: {
      spec_draft: {
        enabled: booleanEnv(env, 'FORGELOOP_CODEX_GENERATION_SPEC_DRAFT_ENABLED', defaultsEnabled),
        promptVersion: 'spec-draft.fake.v1',
        outputSchemaVersion: 'spec_draft.v1',
      },
      plan_draft: {
        enabled: booleanEnv(env, 'FORGELOOP_CODEX_GENERATION_PLAN_DRAFT_ENABLED', defaultsEnabled),
        promptVersion: 'plan-draft.fake.v1',
        outputSchemaVersion: 'plan_draft.v1',
      },
      package_drafts: {
        enabled: booleanEnv(env, 'FORGELOOP_CODEX_GENERATION_PACKAGE_DRAFTS_ENABLED', false),
        promptVersion: 'package-drafts.fake.v1',
        outputSchemaVersion: 'package_drafts.v1',
      },
    },
  };
};

export const loadAutomationDaemonConfig = (env: EnvLike = process.env): AutomationDaemonConfig => {
  const generationPlanning = generationPlanningEnv(env);
  return {
    controlPlaneUrl: requiredEnv(env, 'FORGELOOP_CONTROL_PLANE_URL'),
    trustedActorHeaderSecret: requiredEnv(env, 'FORGELOOP_TRUSTED_ACTOR_HEADER_SECRET'),
    daemonIdentity: requiredEnv(env, 'FORGELOOP_AUTOMATION_DAEMON_IDENTITY'),
    actorId: requiredEnv(env, 'FORGELOOP_AUTOMATION_ACTOR_ID'),
    allowedRepoRoots: pathListEnv(env, 'FORGELOOP_AUTOMATION_ALLOWED_REPO_ROOTS'),
    loopIntervalMs: optionalPositiveInt(
      env,
      'FORGELOOP_AUTOMATION_LOOP_INTERVAL_MS',
      DEFAULT_AUTOMATION_LOOP_INTERVAL_MS,
    ),
    noClaimBackoffMs: optionalPositiveInt(
      env,
      'FORGELOOP_AUTOMATION_NO_CLAIM_BACKOFF_MS',
      DEFAULT_AUTOMATION_NO_CLAIM_BACKOFF_MS,
    ),
    policyParserVersion: DEFAULT_WORKFLOW_POLICY_PARSER_VERSION,
    codexAutomationGeneration: generationPlanning.mode,
    generationPlanning,
  };
};
