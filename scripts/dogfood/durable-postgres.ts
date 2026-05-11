import { setTimeout as delay } from 'node:timers/promises';

import { Client } from 'pg';

import { assertResettableDatabaseUrl, resetForgeloopDatabase } from '../../packages/db/src/reset.js';

export type Env = Record<string, string | undefined>;

export type CommandRunner = (
  command: string,
  args: string[],
  options?: { env?: Env; timeoutMs?: number },
) => Promise<{ stdout: string; stderr: string }>;

type DockerPsRow = {
  ID?: string;
  Id?: string;
  Image?: string;
  Names?: string;
  Ports?: string;
};

type DockerInspectRow = {
  Id?: string;
  Config?: {
    Env?: string[];
  };
  NetworkSettings?: {
    Ports?: Record<string, Array<{ HostIp?: string; HostPort?: string }> | null>;
  };
};

export type DockerPostgresCandidate = {
  containerId: string;
  host: string;
  port: number;
  user: string;
  password: string;
  defaultDatabase: string;
};

export type DurableDogfoodPlan = {
  kind: 'provided' | 'docker_temp_db' | 'started_container';
  databaseUrl: string;
  adminUrl: string;
  databaseName: string;
  cleanup: { dropDatabase: boolean; removeContainer?: boolean };
  containerId?: string;
};

export type DurableDogfoodErrorCode =
  | 'missing_database'
  | 'database_reset_refused'
  | 'schema_push_failed'
  | 'reset_failed';

export const databaseNameForDogfoodTimestamp = (timestamp: number): string => `forgeloop_tmp_dogfood_${timestamp}`;

export const providedDatabaseUrlFromEnv = (env: Env): string | undefined => {
  const value = env.FORGELOOP_DATABASE_URL?.trim();
  return value === undefined || value.length === 0 ? undefined : value;
};

export const sanitizeDatabaseTargetForReport = (databaseUrl: string): { host: string; database: string; redacted: true } => {
  const url = new URL(databaseUrl);
  return { host: url.hostname, database: url.pathname.replace(/^\//, ''), redacted: true };
};

export const classifyDurableDogfoodError = (error: { code: DurableDogfoodErrorCode }): { status: 'BLOCKED with reason' | 'FAILED' } => {
  if (error.code === 'schema_push_failed' || error.code === 'reset_failed') {
    return { status: 'FAILED' };
  }
  return { status: 'BLOCKED with reason' };
};

const envMap = (values: string[] | undefined): Map<string, string> => {
  const entries = new Map<string, string>();
  for (const value of values ?? []) {
    const separator = value.indexOf('=');
    if (separator > 0) {
      entries.set(value.slice(0, separator), value.slice(separator + 1));
    }
  }
  return entries;
};

const sameDockerContainerId = (psId: string, inspectId: string): boolean => {
  if (psId === inspectId) {
    return true;
  }
  return psId.length >= 12 && inspectId.startsWith(psId);
};

export const discoverDockerPostgresCandidate = (
  psRows: DockerPsRow[],
  inspectRows: DockerInspectRow[],
): DockerPostgresCandidate | undefined => {
  const postgresContainerIds = psRows
    .filter((row) => `${row.Image ?? ''} ${row.Names ?? ''}`.toLowerCase().includes('postgres'))
    .map((row) => row.ID ?? row.Id)
    .filter((id): id is string => id !== undefined && id.length > 0);

  for (const row of inspectRows) {
    const containerId = row.Id;
    if (containerId === undefined || !postgresContainerIds.some((psId) => sameDockerContainerId(psId, containerId))) {
      continue;
    }
    const binding = row.NetworkSettings?.Ports?.['5432/tcp']?.[0];
    const hostPort = binding?.HostPort === undefined ? Number.NaN : Number.parseInt(binding.HostPort, 10);
    if (!Number.isInteger(hostPort) || hostPort <= 0) {
      continue;
    }
    const env = envMap(row.Config?.Env);
    const user = env.get('POSTGRES_USER') ?? 'postgres';
    const password = env.get('POSTGRES_PASSWORD');
    if (password === undefined || password.length === 0) {
      continue;
    }
    return {
      containerId,
      host: binding.HostIp === undefined || binding.HostIp === '' || binding.HostIp === '0.0.0.0' ? '127.0.0.1' : binding.HostIp,
      port: hostPort,
      user,
      password,
      defaultDatabase: env.get('POSTGRES_DB') ?? user,
    };
  }

  return undefined;
};

const databaseUrl = (candidate: DockerPostgresCandidate, databaseName: string): string => {
  const url = new URL('postgresql://localhost/postgres');
  url.hostname = candidate.host;
  url.port = String(candidate.port);
  url.username = candidate.user;
  url.password = candidate.password;
  url.pathname = `/${databaseName}`;
  return url.toString();
};

export const planDurableDogfoodDatabase = (input: {
  env: Env;
  dockerCandidate?: DockerPostgresCandidate;
  timestamp: number;
}): DurableDogfoodPlan => {
  const provided = providedDatabaseUrlFromEnv(input.env);
  if (provided !== undefined) {
    const url = new URL(provided);
    return {
      kind: 'provided',
      databaseUrl: provided,
      adminUrl: provided,
      databaseName: url.pathname.replace(/^\//, ''),
      cleanup: { dropDatabase: false, removeContainer: false },
    };
  }

  if (input.dockerCandidate === undefined) {
    throw new Error(
      [
        'No durable Postgres database is available.',
        'Set FORGELOOP_DATABASE_URL, run `docker compose up -d postgres`, or set FORGELOOP_DOGFOOD_START_POSTGRES=1 to start a disposable container.',
      ].join(' '),
    );
  }

  const databaseName = databaseNameForDogfoodTimestamp(input.timestamp);
  return {
    kind: 'docker_temp_db',
    databaseName,
    databaseUrl: databaseUrl(input.dockerCandidate, databaseName),
    adminUrl: databaseUrl(input.dockerCandidate, input.dockerCandidate.defaultDatabase),
    cleanup: { dropDatabase: true },
    containerId: input.dockerCandidate.containerId,
  };
};

const quoteIdentifier = (name: string): string => {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new Error(`Unsafe database name: ${name}`);
  }
  return `"${name}"`;
};

export const createDatabase = async (plan: DurableDogfoodPlan): Promise<void> => {
  if (!plan.cleanup.dropDatabase) {
    return;
  }
  assertResettableDatabaseUrl(plan.databaseUrl);
  const client = new Client({ connectionString: plan.adminUrl });
  await client.connect();
  try {
    await client.query(`CREATE DATABASE ${quoteIdentifier(plan.databaseName)}`);
  } finally {
    await client.end();
  }
};

export const dropDatabase = async (plan: DurableDogfoodPlan): Promise<void> => {
  if (!plan.cleanup.dropDatabase) {
    return;
  }
  assertResettableDatabaseUrl(plan.databaseUrl);
  const client = new Client({ connectionString: plan.adminUrl });
  await client.connect();
  try {
    await client.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [plan.databaseName],
    );
    await client.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(plan.databaseName)}`);
  } finally {
    await client.end();
  }
};

export const startDisposablePostgres = async (
  runner: CommandRunner,
  timestamp: number,
  options: { maxAttempts?: number; retryDelayMs?: number } = {},
): Promise<{ containerId: string; candidate: DockerPostgresCandidate }> => {
  const name = `forgeloop-dogfood-postgres-${timestamp}`;
  const password = `forgeloop-dogfood-${timestamp}`;
  const started = await runner(
    'docker',
    [
      'run',
      '-d',
      '--name',
      name,
      '-e',
      'POSTGRES_USER=forgeloop',
      '-e',
      `POSTGRES_PASSWORD=${password}`,
      '-e',
      'POSTGRES_DB=postgres',
      '-P',
      'postgres:16-alpine',
    ],
    { timeoutMs: 60_000 },
  );
  const containerId = started.stdout.trim();
  try {
    for (let attempt = 0; attempt < (options.maxAttempts ?? 60); attempt += 1) {
      try {
        await runner('docker', ['exec', containerId, 'pg_isready', '-U', 'forgeloop', '-d', 'postgres'], { timeoutMs: 5_000 });
        const inspect = await runner('docker', ['inspect', containerId]);
        const candidate = discoverDockerPostgresCandidate(
          [{ ID: containerId, Image: 'postgres:16-alpine', Names: name }],
          JSON.parse(inspect.stdout) as DockerInspectRow[],
        );
        if (candidate !== undefined) {
          return { containerId, candidate };
        }
      } catch {
        await delay(options.retryDelayMs ?? 1_000);
      }
    }
    throw new Error(`Timed out waiting for disposable Postgres container ${name}`);
  } catch (error) {
    try {
      await runner('docker', ['rm', '-f', containerId], { timeoutMs: 30_000 });
    } catch (cleanupError) {
      throw new Error(
        `${error instanceof Error ? error.message : String(error)} Cleanup failed for ${containerId}: ${
          cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
        }`,
      );
    }
    throw error;
  }
};

export const prepareSafeDatabaseTarget = (plan: DurableDogfoodPlan): void => {
  assertResettableDatabaseUrl(plan.databaseUrl);
};

export const pushSchema = async (input: { databaseUrl: string; runCommand: CommandRunner }): Promise<void> => {
  await input.runCommand('pnpm', ['db:push'], {
    env: { FORGELOOP_DATABASE_URL: input.databaseUrl },
    timeoutMs: 60_000,
  });
};

export const resetDatabase = async (databaseUrl: string): Promise<void> => {
  await resetForgeloopDatabase(databaseUrl);
};
