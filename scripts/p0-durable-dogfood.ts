import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { Client } from 'pg';

const execFile = promisify(execFileCallback);

type Env = Record<string, string | undefined>;

type CommandRunner = (
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

type DurableDogfoodPlan = {
  kind: 'provided' | 'docker_temp_db' | 'started_container';
  databaseUrl: string;
  adminUrl: string;
  databaseName: string;
  cleanup: { dropDatabase: boolean; removeContainer?: boolean };
  containerId?: string;
};

export type DurableDogfoodReportMarkers = {
  dbSchemaPushPassed: boolean;
  durablePublicApiAuthPassed: boolean;
  durableSseAuthPassed: boolean;
  durableRepositoryRecoveryPassed: boolean;
};

const repoPath = resolve(process.env.FORGELOOP_REPO_PATH ?? process.cwd());

export const providedDatabaseUrlFromEnv = (env: Env): string | undefined => {
  const value = env.FORGELOOP_DATABASE_URL?.trim();
  return value === undefined || value.length === 0 ? undefined : value;
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

const databaseNameForTimestamp = (timestamp: number): string => `forgeloop_dogfood_${timestamp}`;

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

  const databaseName = databaseNameForTimestamp(input.timestamp);
  return {
    kind: 'docker_temp_db',
    databaseName,
    databaseUrl: databaseUrl(input.dockerCandidate, databaseName),
    adminUrl: databaseUrl(input.dockerCandidate, input.dockerCandidate.defaultDatabase),
    cleanup: { dropDatabase: true },
    containerId: input.dockerCandidate.containerId,
  };
};

export const parseDurableDogfoodReport = (text: string): DurableDogfoodReportMarkers => ({
  dbSchemaPushPassed: /- DB schema push: PASSED/.test(text),
  durablePublicApiAuthPassed: /- Durable public API actor header auth: PASSED/.test(text),
  durableSseAuthPassed: /- Durable SSE stream-token auth: PASSED/.test(text),
  durableRepositoryRecoveryPassed: /- Durable repository restart recovery: PASSED/.test(text),
});

const runCommand: CommandRunner = async (command, args, options = {}) => {
  const { stdout, stderr } = await execFile(command, args, {
    cwd: repoPath,
    env: { ...process.env, ...options.env },
    timeout: options.timeoutMs ?? 30_000,
  });
  return { stdout: stdout.trim(), stderr: stderr.trim() };
};

const parseJsonLines = <T>(text: string): T[] =>
  text
    .split(/\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as T);

const inspectDockerPostgres = async (runner: CommandRunner): Promise<DockerPostgresCandidate | undefined> => {
  let psRows: DockerPsRow[];
  try {
    const ps = await runner('docker', ['ps', '--no-trunc', '--format', '{{json .}}']);
    psRows = parseJsonLines<DockerPsRow>(ps.stdout);
  } catch {
    return undefined;
  }
  const ids = psRows.map((row) => row.ID ?? row.Id).filter((id): id is string => id !== undefined && id.length > 0);
  if (ids.length === 0) {
    return undefined;
  }
  const inspect = await runner('docker', ['inspect', ...ids]);
  return discoverDockerPostgresCandidate(psRows, JSON.parse(inspect.stdout) as DockerInspectRow[]);
};

const quoteIdentifier = (name: string): string => {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new Error(`Unsafe database name: ${name}`);
  }
  return `"${name}"`;
};

const createDatabase = async (plan: DurableDogfoodPlan): Promise<void> => {
  if (!plan.cleanup.dropDatabase) {
    return;
  }
  const client = new Client({ connectionString: plan.adminUrl });
  await client.connect();
  try {
    await client.query(`CREATE DATABASE ${quoteIdentifier(plan.databaseName)}`);
  } finally {
    await client.end();
  }
};

const dropDatabase = async (plan: DurableDogfoodPlan): Promise<void> => {
  if (!plan.cleanup.dropDatabase) {
    return;
  }
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

const assertDurableReportPassed = (markers: DurableDogfoodReportMarkers): void => {
  const missing = [
    markers.dbSchemaPushPassed ? undefined : 'DB schema push: PASSED',
    markers.durablePublicApiAuthPassed ? undefined : 'Durable public API actor header auth: PASSED',
    markers.durableSseAuthPassed ? undefined : 'Durable SSE stream-token auth: PASSED',
    markers.durableRepositoryRecoveryPassed ? undefined : 'Durable repository restart recovery: PASSED',
  ].filter((value): value is string => value !== undefined);
  if (missing.length > 0) {
    throw new Error(`Durable dogfood report is missing required PASS markers: ${missing.join(', ')}`);
  }
};

const main = async (): Promise<number> => {
  const timestamp = Date.now();
  let plan: DurableDogfoodPlan | undefined;
  let startedContainerId: string | undefined;
  let tmpDir: string | undefined;

  try {
    const provided = providedDatabaseUrlFromEnv(process.env);
    if (provided !== undefined) {
      plan = planDurableDogfoodDatabase({ env: process.env, timestamp });
    } else {
      let candidate = await inspectDockerPostgres(runCommand);
      if (candidate === undefined && process.env.FORGELOOP_DOGFOOD_START_POSTGRES === '1') {
        const started = await startDisposablePostgres(runCommand, timestamp);
        candidate = started.candidate;
        startedContainerId = started.containerId;
      }
      plan = planDurableDogfoodDatabase({ env: process.env, dockerCandidate: candidate, timestamp });
      if (startedContainerId !== undefined) {
        plan = { ...plan, kind: 'started_container', cleanup: { ...plan.cleanup, removeContainer: true }, containerId: startedContainerId };
      }
    }

    await createDatabase(plan);
    tmpDir = await mkdtemp(join(tmpdir(), 'forgeloop-durable-dogfood-'));
    const reportPath = join(tmpDir, 'p0-delivery-loop-verification.md');

    await runCommand('pnpm', ['db:push'], { env: { FORGELOOP_DATABASE_URL: plan.databaseUrl }, timeoutMs: 60_000 });
    await runCommand('pnpm', ['dogfood:p0'], {
      env: { FORGELOOP_DATABASE_URL: plan.databaseUrl, FORGELOOP_REPORT_PATH: reportPath },
      timeoutMs: 120_000,
    });

    const report = await readFile(reportPath, 'utf8');
    assertDurableReportPassed(parseDurableDogfoodReport(report));
    console.log(`Durable P0 dogfood passed using ${plan.kind} database ${plan.databaseName}. Report: ${reportPath}`);
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  } finally {
    if (plan !== undefined) {
      try {
        await dropDatabase(plan);
      } catch (error) {
        console.error(`Failed to drop dogfood database ${plan.databaseName}: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (plan.cleanup.removeContainer && plan.containerId !== undefined) {
        try {
          await runCommand('docker', ['rm', '-f', plan.containerId], { timeoutMs: 30_000 });
        } catch (error) {
          console.error(`Failed to remove dogfood container ${plan.containerId}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
    if (tmpDir !== undefined && process.env.FORGELOOP_DOGFOOD_KEEP_REPORT !== '1') {
      await rm(tmpDir, { recursive: true, force: true });
    }
  }
};

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exitCode = await main();
}
