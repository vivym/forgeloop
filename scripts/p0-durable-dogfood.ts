import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  createDatabase,
  discoverDockerPostgresCandidate,
  dropDatabase,
  planDurableDogfoodDatabase,
  prepareSafeDatabaseTarget,
  providedDatabaseUrlFromEnv,
  pushSchema,
  resetDatabase,
  startDisposablePostgres,
} from './dogfood/durable-postgres.js';
import type { CommandRunner, DockerPostgresCandidate, DurableDogfoodPlan } from './dogfood/durable-postgres.js';

const execFile = promisify(execFileCallback);

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

export type DurableDogfoodReportMarkers = {
  dbSchemaPushPassed: boolean;
  durablePublicApiAuthPassed: boolean;
  durableSseAuthPassed: boolean;
  durableRepositoryRecoveryPassed: boolean;
};

const repoPath = resolve(process.env.FORGELOOP_REPO_PATH ?? process.cwd());

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

    prepareSafeDatabaseTarget(plan);
    await createDatabase(plan);
    tmpDir = await mkdtemp(join(tmpdir(), 'forgeloop-durable-dogfood-'));
    const reportPath = join(tmpDir, 'p0-delivery-loop-verification.md');

    await pushSchema({ databaseUrl: plan.databaseUrl, runCommand });
    await resetDatabase(plan.databaseUrl);
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
