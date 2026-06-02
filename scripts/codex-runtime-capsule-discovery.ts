import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { codexCanonicalDigest } from '../packages/domain/src/index';
import {
  runCodexRuntimeCapsuleDiscovery,
  type CodexRuntimeCapsuleDiscoveryProbe,
  type CodexRuntimeCapsuleDiscoveryReport,
  type ObservedCodexHomeState,
} from '../packages/codex-worker-runtime/src/index';

export type { CodexRuntimeCapsuleDiscoveryReport };

const execFile = promisify(execFileCallback);

export const codexRuntimeCapsuleDiscoveryDogfoodCommand =
  'tsx --tsconfig apps/control-plane-api/tsconfig.json scripts/codex-runtime-capsule-discovery.ts';

export const codexRuntimeCapsuleDiscoveryReportPath = 'test-results/codex-runtime-capsule-discovery-report.json';

type EnvLike = Record<string, string | undefined>;

const timeoutMs = 30_000;

const optionalEnv = (env: EnvLike, key: string): string | undefined => {
  const value = env[key]?.trim();
  return value === undefined || value.length === 0 ? undefined : value;
};

const codexBin = (env: EnvLike): string => optionalEnv(env, 'FORGELOOP_CODEX_BIN') ?? 'codex';

const execCodex = async (env: EnvLike, args: readonly string[], options?: { cwd?: string }): Promise<string> => {
  const { stdout } = await execFile(codexBin(env), [...args], {
    cwd: options?.cwd,
    env: { ...process.env, ...env },
    maxBuffer: 1024 * 1024 * 10,
    timeout: timeoutMs,
  });
  return stdout.trim();
};

const collectRegularFiles = async (root: string, relativePrefix = ''): Promise<{ relativePath: string; content: string }[]> => {
  const entries = await readdir(join(root, relativePrefix), { withFileTypes: true });
  const files = await Promise.all(
    entries
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(async (entry) => {
        const relativePath = relativePrefix.length === 0 ? entry.name : `${relativePrefix}/${entry.name}`;
        if (entry.isDirectory()) {
          return collectRegularFiles(root, relativePath);
        }
        if (!entry.isFile()) {
          return [];
        }
        return [{ relativePath, content: await readFile(join(root, relativePath), 'utf8') }];
      }),
  );
  return files.flat();
};

const blockedState = (blockerCode: string): ObservedCodexHomeState => ({
  observed_path_mutations: [],
  blocker_codes: [blockerCode],
});

export const createInstalledCodexDiscoveryProbe = (env: EnvLike = process.env): CodexRuntimeCapsuleDiscoveryProbe => ({
  codexVersion: async () => execCodex(env, ['--version']),
  appServerProtocolDigest: async () => {
    const schemaRoot = await mkdtemp(join(tmpdir(), 'forgeloop-codex-schema-'));
    try {
      await execCodex(env, ['app-server', 'generate-json-schema', '--out', schemaRoot]);
      const files = await collectRegularFiles(schemaRoot);
      return codexCanonicalDigest({
        generated_json_schema_files: files.map((file) => ({
          relative_path: file.relativePath,
          content_digest: codexCanonicalDigest(file.content),
        })),
      });
    } catch {
      return codexCanonicalDigest({ blocker: 'codex_runtime_capsule_discovery_app_server_schema_unavailable' });
    } finally {
      await rm(schemaRoot, { force: true, recursive: true });
    }
  },
  runControlledScenario: async () =>
    blockedState('codex_runtime_capsule_discovery_controlled_scenario_unavailable'),
});

export const writeCodexRuntimeCapsuleDiscoveryReport = async (
  report: CodexRuntimeCapsuleDiscoveryReport,
  path = codexRuntimeCapsuleDiscoveryReportPath,
): Promise<void> => {
  const absolutePath = resolve(path);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
};

export const renderCodexRuntimeCapsuleDiscoverySummary = (
  report: CodexRuntimeCapsuleDiscoveryReport,
  path = codexRuntimeCapsuleDiscoveryReportPath,
): string =>
  [
    `Report: ${path}`,
    `Status: ${report.status}`,
    `Codex CLI version digest: ${report.codex_cli_version_digest}`,
    `App-server protocol digest: ${report.app_server_protocol_digest}`,
    `Observed mutation count: ${report.observed_mutation_count}`,
    `Path mutation counts digest: ${codexCanonicalDigest(report.path_mutation_counts)}`,
    `Blocker codes: ${report.blocker_codes.length === 0 ? 'none' : report.blocker_codes.join(',')}`,
  ].join('\n');

export const runCodexRuntimeCapsuleDiscoveryDogfood = async (
  env: EnvLike = process.env,
): Promise<CodexRuntimeCapsuleDiscoveryReport> => {
  const codexHomeRoot = await mkdtemp(join(tmpdir(), 'forgeloop-codex-home-discovery-'));
  try {
    return await runCodexRuntimeCapsuleDiscovery({
      codexHomeRoot,
      probe: createInstalledCodexDiscoveryProbe(env),
    });
  } catch {
    return runCodexRuntimeCapsuleDiscovery({
      codexHomeRoot,
      probe: {
        codexVersion: async () => 'codex-cli unavailable',
        appServerProtocolDigest: async () => codexCanonicalDigest({ blocker: 'codex_runtime_capsule_discovery_codex_cli_unavailable' }),
        runControlledScenario: async () => blockedState('codex_runtime_capsule_discovery_codex_cli_unavailable'),
      },
    });
  } finally {
    await rm(codexHomeRoot, { force: true, recursive: true });
  }
};

export const codexRuntimeCapsuleDiscoveryMain = async (env: EnvLike = process.env): Promise<number> => {
  const report = await runCodexRuntimeCapsuleDiscoveryDogfood(env);
  await writeCodexRuntimeCapsuleDiscoveryReport(report);
  console.log(renderCodexRuntimeCapsuleDiscoverySummary(report));
  return report.status === 'passed' ? 0 : 1;
};

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exitCode = await codexRuntimeCapsuleDiscoveryMain();
}
