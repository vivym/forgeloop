import path from 'node:path';
import type { AutomationGenerationMode } from '@forgeloop/automation';

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
  codexAutomationGeneration: AutomationGenerationMode;
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

const generationModeEnv = (env: EnvLike): AutomationGenerationMode => {
  const raw = env.FORGELOOP_CODEX_AUTOMATION_GENERATION?.trim() ?? 'disabled';
  if (raw === 'disabled' || raw === 'fake') {
    return raw;
  }
  if (raw === 'codex') {
    throw new Error('FORGELOOP_CODEX_AUTOMATION_GENERATION=codex is introduced in Plan 2');
  }
  throw new Error('Invalid automation daemon config: FORGELOOP_CODEX_AUTOMATION_GENERATION must be disabled or fake');
};

export const loadAutomationDaemonConfig = (env: EnvLike = process.env): AutomationDaemonConfig => ({
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
  codexAutomationGeneration: generationModeEnv(env),
});
