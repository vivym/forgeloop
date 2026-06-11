import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

type EnvLike = Record<string, string | undefined>;
type ScavengeMode = 'dry_run' | 'execute';

type ParsedArgs = {
  mode: ScavengeMode;
  confirmExecute: boolean;
  reason?: string;
  operationIdempotencyKeyPrefix?: string;
  candidatesFile?: string;
  filtersFile?: string;
};

const reasonOption = '--reason';
const operationIdempotencyKeyPrefixOption = '--operation-idempotency-key-prefix';
const supportedOptions = new Set([
  '--mode',
  '--confirm-execute',
  reasonOption,
  operationIdempotencyKeyPrefixOption,
  '--candidates-file',
  '--filters-file',
]);

const optionalEnv = (env: EnvLike, key: string): string | undefined => {
  const value = env[key]?.trim();
  return value === undefined || value.length === 0 ? undefined : value;
};

const requiredEnv = (env: EnvLike, key: string): string => {
  const value = optionalEnv(env, key);
  if (value === undefined) {
    throw new Error(`${key} is required`);
  }
  return value;
};

const parseScavengeMode = (value: string | undefined): ScavengeMode => {
  const mode = value ?? 'dry_run';
  if (mode !== 'dry_run' && mode !== 'execute') {
    throw new Error('--mode must be dry_run or execute');
  }
  return mode;
};

const parseArgs = (argv: readonly string[]): ParsedArgs => {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (const raw of argv) {
    if (!raw.startsWith('--')) {
      throw new Error(`Unsupported positional argument: ${raw}`);
    }
    const [key, ...rest] = raw.slice(2).split('=');
    if (key === undefined || key.length === 0) {
      throw new Error(`Invalid argument: ${raw}`);
    }
    const value = rest.join('=');
    if (value.length === 0) {
      flags.add(key);
    } else {
      values.set(key, value);
    }
  }

  const unsupported = [...values.keys(), ...flags].filter((key) => !supportedOptions.has(`--${key}`));
  if (unsupported.length > 0) {
    throw new Error(`Unsupported option: --${unsupported[0]}`);
  }

  return {
    mode: parseScavengeMode(values.get('mode')),
    confirmExecute: flags.has('confirm-execute') || values.get('confirm-execute') === 'true',
    reason: values.get('reason'),
    operationIdempotencyKeyPrefix: values.get('operation-idempotency-key-prefix'),
    candidatesFile: values.get('candidates-file'),
    filtersFile: values.get('filters-file'),
  };
};

const readJsonFile = (path: string, label: string): unknown => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} is not valid JSON: ${message}`);
  }
};

const readJsonObjectFile = (path: string, label: string): Record<string, unknown> => {
  const parsed = readJsonFile(path, label);
  if (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error(`${label} must contain a JSON object`);
  }
  return parsed as Record<string, unknown>;
};

const readCandidateArrayFile = (path: string): Array<Record<string, unknown>> => {
  const candidates = readJsonFile(path, '--candidates-file');
  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw new Error('candidates-file must contain a non-empty candidate array');
  }
  for (const [index, candidate] of candidates.entries()) {
    if (candidate === null || Array.isArray(candidate) || typeof candidate !== 'object') {
      throw new Error(`candidates-file entry ${index} must be an object`);
    }
    const candidateObject = candidate as Record<string, unknown>;
    if (typeof candidateObject.codex_session_id !== 'string' || candidateObject.codex_session_id.trim().length === 0) {
      throw new Error(`candidates-file entry ${index} requires codex_session_id`);
    }
    const predicate = candidateObject.candidate_predicate;
    if (predicate === null || Array.isArray(predicate) || typeof predicate !== 'object') {
      throw new Error(`candidates-file entry ${index} requires candidate_predicate`);
    }
  }
  return candidates as Array<Record<string, unknown>>;
};

const signedActorHeaders = (input: {
  actorId: string;
  actorClass: string;
  daemonIdentity?: string;
  secret: string;
  timestamp?: string;
}): Record<string, string> => {
  const timestamp = input.timestamp ?? new Date().toISOString();
  const signature = createHmac('sha256', input.secret)
    .update([input.actorId, input.actorClass, input.daemonIdentity ?? '', timestamp].join('\n'))
    .digest('base64url');
  return {
    'x-forgeloop-actor-id': input.actorId,
    'x-forgeloop-actor-class': input.actorClass,
    ...(input.daemonIdentity === undefined ? {} : { 'x-forgeloop-daemon-identity': input.daemonIdentity }),
    'x-forgeloop-actor-timestamp': timestamp,
    'x-forgeloop-actor-signature': signature,
  };
};

const buildRequestBody = (args: ParsedArgs): Record<string, unknown> => {
  const filters = args.filtersFile === undefined ? undefined : readJsonObjectFile(args.filtersFile, '--filters-file');
  if (args.mode === 'dry_run') {
    return {
      mode: 'dry_run',
      ...(filters === undefined ? {} : { filters }),
    };
  }

  if (!args.confirmExecute) {
    throw new Error('confirm-execute is required when mode is execute');
  }
  if (args.reason === undefined || args.reason.trim().length === 0) {
    throw new Error('reason is required when mode is execute');
  }
  if (args.operationIdempotencyKeyPrefix === undefined || args.operationIdempotencyKeyPrefix.trim().length === 0) {
    throw new Error('operation-idempotency-key-prefix is required when mode is execute');
  }
  if (args.candidatesFile === undefined) {
    throw new Error('candidates-file is required when mode is execute');
  }

  const candidates = readCandidateArrayFile(args.candidatesFile);

  return {
    mode: 'execute',
    confirm_execute: true,
    reason: args.reason,
    operation_idempotency_key_prefix: args.operationIdempotencyKeyPrefix,
    candidates,
  };
};

export const runSessionOperationsScavenge = async (
  argv: readonly string[] = process.argv.slice(2),
  env: EnvLike = process.env,
): Promise<unknown> => {
  const args = parseArgs(argv);
  const apiBaseUrl = requiredEnv(env, 'FORGELOOP_API_BASE_URL').replace(/\/+$/, '');
  const actorId = requiredEnv(env, 'FORGELOOP_ACTOR_ID');
  const actorClass = requiredEnv(env, 'FORGELOOP_ACTOR_CLASS');
  const trustedActorHeaderSecret = requiredEnv(env, 'FORGELOOP_TRUSTED_ACTOR_HEADER_SECRET');
  const daemonIdentity = optionalEnv(env, 'FORGELOOP_DAEMON_IDENTITY');
  const body = buildRequestBody(args);
  const response = await fetch(`${apiBaseUrl}/session-operations/scavenge`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...signedActorHeaders({
        actorId,
        actorClass,
        ...(daemonIdentity === undefined ? {} : { daemonIdentity }),
        secret: trustedActorHeaderSecret,
      }),
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  const payload = text.trim().length === 0 ? {} : JSON.parse(text);
  if (!response.ok) {
    throw new Error(`Session Operations scavenge failed with ${response.status}: ${JSON.stringify(payload)}`);
  }
  return payload;
};

const main = async (): Promise<number> => {
  try {
    const result = await runSessionOperationsScavenge();
    console.log(JSON.stringify(result, undefined, 2));
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
};

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exitCode = await main();
}
