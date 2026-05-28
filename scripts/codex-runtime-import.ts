import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';

import { signAutomationRequest } from '../packages/automation/src/index';

type Args = Record<string, string | boolean>;
type EnvLike = Record<string, string | undefined>;

const sha256DigestPattern = /^sha256:[a-f0-9]{64}$/;

const parseArgs = (argv: string[]): Args => {
  const parsed: Args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token?.startsWith('--')) {
      continue;
    }
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith('--')) {
      parsed[key] = true;
      continue;
    }
    parsed[key] = next;
    index += 1;
  }
  return parsed;
};

const stringArg = (args: Args, env: EnvLike, key: string, envKey: string): string | undefined => {
  const arg = args[key];
  if (typeof arg === 'string' && arg.trim().length > 0) {
    return arg.trim();
  }
  const envValue = env[envKey]?.trim();
  return envValue === undefined || envValue.length === 0 ? undefined : envValue;
};

const requiredString = (args: Args, env: EnvLike, key: string, envKey: string): string => {
  const value = stringArg(args, env, key, envKey);
  if (value === undefined) {
    throw new Error(`${envKey}_missing`);
  }
  return value;
};

const requiredDigest = (args: Args, env: EnvLike, key: string, envKey: string): string => {
  const value = requiredString(args, env, key, envKey);
  if (!sha256DigestPattern.test(value)) {
    throw new Error(`${envKey}_must_be_pinned_sha256_digest`);
  }
  return value;
};

const readProtectedRegularFile = (path: string, label: string): string => {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) {
    throw new Error(`${label}_must_be_protected_regular_file`);
  }
  return readFileSync(path, 'utf8');
};

const readJsonFile = (path: string, label: string): unknown => {
  try {
    return JSON.parse(readProtectedRegularFile(path, label));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`${label}_invalid_json`);
    }
    throw error;
  }
};

const signedSetupPost = async (input: {
  controlPlaneUrl: string;
  secret: string;
  actorId: string;
  actorClass: 'system_bootstrap' | 'human_admin';
  daemonIdentity: string;
  path: string;
  body: Record<string, unknown>;
}) => {
  const setupNonce = randomUUID();
  const body = { ...input.body, setup_nonce: setupNonce };
  const rawBody = JSON.stringify(body);
  const headers = {
    'content-type': 'application/json',
    'X-Forgeloop-Setup-Nonce': setupNonce,
    ...signAutomationRequest({
      method: 'POST',
      pathAndQuery: input.path,
      rawBody,
      actorId: input.actorId,
      actorClass: input.actorClass,
      daemonIdentity: input.daemonIdentity,
      timestamp: new Date().toISOString(),
      secret: input.secret,
    }),
  };
  const response = await fetch(`${input.controlPlaneUrl}${input.path}`, {
    method: 'POST',
    headers,
    body: rawBody,
  });
  if (!response.ok) {
    throw new Error(`codex_runtime_import_failed:${input.path}:${response.status}`);
  }
  return response.json();
};

export const runCodexRuntimeImportCli = async (argv = process.argv.slice(2), env: EnvLike = process.env) => {
  const args = parseArgs(argv);
  const fromLocalCodexHome = args['from-local-codex-home'] === true;
  const codexHome = stringArg(args, env, 'codex-home', 'CODEX_HOME') ?? join(homedir(), '.codex');
  const configPath = fromLocalCodexHome
    ? join(codexHome, 'config.toml')
    : requiredString(args, env, 'config-path', 'FORGELOOP_CODEX_CONFIG_TOML_PATH');
  const authPath =
    args['auth-path'] === undefined && !fromLocalCodexHome
      ? undefined
      : fromLocalCodexHome
        ? join(codexHome, 'auth.json')
        : requiredString(args, env, 'auth-path', 'FORGELOOP_CODEX_AUTH_JSON_PATH');
  const unsafeDbAcknowledgement = args['unsafe-db-acknowledgement'] === true || env.FORGELOOP_UNSAFE_DB_ACKNOWLEDGEMENT === '1';
  const controlPlaneUrl = requiredString(args, env, 'control-plane-url', 'FORGELOOP_CONTROL_PLANE_URL').replace(/\/$/, '');
  const actorClass = requiredString(args, env, 'actor-class', 'FORGELOOP_CODEX_RUNTIME_SETUP_ACTOR_CLASS');
  if (actorClass !== 'system_bootstrap' && actorClass !== 'human_admin') {
    throw new Error('FORGELOOP_CODEX_RUNTIME_SETUP_ACTOR_CLASS_must_be_system_bootstrap_or_human_admin');
  }

  const basePost = {
    controlPlaneUrl,
    secret: requiredString(args, env, 'trusted-secret', 'FORGELOOP_TRUSTED_ACTOR_HEADER_SECRET'),
    actorId: requiredString(args, env, 'actor-id', 'FORGELOOP_CODEX_RUNTIME_SETUP_ACTOR_ID'),
    actorClass,
    daemonIdentity: requiredString(args, env, 'daemon-identity', 'FORGELOOP_CODEX_RUNTIME_SETUP_DAEMON_IDENTITY'),
  };
  const projectId = requiredString(args, env, 'project-id', 'FORGELOOP_CODEX_ALLOWED_SCOPE_PROJECT_ID');
  const repoId = stringArg(args, env, 'repo-id', 'FORGELOOP_CODEX_ALLOWED_SCOPE_REPO_ID');
  const sharedProfileInput = {
    profile_name: requiredString(args, env, 'profile-name', 'FORGELOOP_CODEX_PROFILE_NAME'),
    target_kind: requiredString(args, env, 'target-kind', 'FORGELOOP_CODEX_TARGET_KIND'),
    codex_config_toml: readProtectedRegularFile(configPath, 'codex_config_toml'),
    project_id: projectId,
    ...(repoId === undefined ? {} : { repo_id: repoId }),
    docker_image: requiredString(args, env, 'docker-image', 'FORGELOOP_CODEX_DOCKER_IMAGE'),
    docker_image_digest: requiredDigest(args, env, 'docker-image-digest', 'FORGELOOP_CODEX_DOCKER_IMAGE_DIGEST'),
    expected_effective_config_digest: requiredDigest(
      args,
      env,
      'expected-effective-config-digest',
      'FORGELOOP_CODEX_EXPECTED_EFFECTIVE_CONFIG_DIGEST',
    ),
    allowed_scopes: [{ project_id: projectId, ...(repoId === undefined ? {} : { repo_id: repoId }) }],
    network_policy: JSON.parse(requiredString(args, env, 'network-policy-json', 'FORGELOOP_CODEX_NETWORK_POLICY_JSON')),
    created_by: { actor_id: basePost.actorId },
  };

  if (authPath !== undefined) {
    if (!unsafeDbAcknowledgement) {
      throw new Error('unsafe_db_acknowledgement_required');
    }
    return signedSetupPost({
      ...basePost,
      path: '/internal/codex-runtime/import-local-codex',
      body: {
        ...sharedProfileInput,
        local_source_label: fromLocalCodexHome ? 'local-codex-home' : 'explicit-codex-files',
        auth_json: readJsonFile(authPath, 'codex_auth_json'),
        provider: 'unsafe_db',
        unsafe_db_acknowledgement: true,
      },
    });
  }

  return signedSetupPost({
    ...basePost,
    path: '/internal/codex-runtime/import-profile',
    body: sharedProfileInput,
  });
};

if (import.meta.url === `file://${process.argv[1]}`) {
  runCodexRuntimeImportCli()
    .then((summary) => {
      console.log(JSON.stringify(summary, null, 2));
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
