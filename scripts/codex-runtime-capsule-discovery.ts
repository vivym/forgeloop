import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile, lstat, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { codexCanonicalDigest } from '../packages/domain/src/index';
import {
  buildCodexThreadLocatorRepairRowDigest,
  codexStateIndexThreadsColumns,
  CodexAppServerStdioTransport,
  classifyCodexHomePath,
  runCodexRuntimeCapsuleDiscovery,
  type CodexRuntimeCapsuleDiscoveryProbe,
  type CodexRuntimeCapsuleDiscoveryReport,
  type CodexHomePathEntryKind,
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

const codexThreadIdDigest = (threadId: string): string =>
  codexCanonicalDigest({ kind: 'codex_app_server_thread_id', thread_id: threadId });

const entryKind = async (path: string): Promise<CodexHomePathEntryKind> => {
  const stat = await lstat(path);
  if (stat.isFile()) {
    return 'regular_file';
  }
  if (stat.isDirectory()) {
    return 'directory';
  }
  if (stat.isSymbolicLink()) {
    return 'symlink';
  }
  if (stat.isSocket()) {
    return 'socket';
  }
  return 'other';
};

const collectCodexHomeMutations = async (
  root: string,
  requiredRelativePath: string,
  relativePrefix = '',
): Promise<ObservedCodexHomeState['observed_path_mutations']> => {
  const directory = join(root, relativePrefix);
  const entries = await readdir(directory, { withFileTypes: true });
  const mutations = await Promise.all(
    entries
      .sort((left, right) => left.name.localeCompare(right.name))
      .map(async (entry) => {
        const relativePath = relativePrefix.length === 0 ? entry.name : `${relativePrefix}/${entry.name}`;
        const absolutePath = join(root, relativePath);
        if (entry.isDirectory()) {
          return collectCodexHomeMutations(root, requiredRelativePath, relativePath);
        }
        if (!entry.isFile()) {
          const classification = classifyCodexHomePath(relativePath).classification;
          if (classification === 'generated_environment') {
            return [];
          }
          return [];
        }
        return [
          {
            relative_path: relativePath,
            mutation_kind: 'created' as const,
            entry_kind: await entryKind(absolutePath),
            ...(relativePath === requiredRelativePath ? { required_for_restore: true } : {}),
          },
        ];
      }),
  );
  return mutations.flat();
};

const singleQuotedSql = (value: string): string => `'${value.replaceAll("'", "''")}'`;

const sqliteScalar = async (dbPath: string, sql: string): Promise<string> => {
  const { stdout } = await execFile('/usr/bin/sqlite3', [dbPath, sql], { timeout: 10_000, maxBuffer: 1024 * 1024 });
  return stdout.trim();
};

const waitForFile = async (path: string): Promise<void> => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const stat = await lstat(path);
      if (stat.isFile()) {
        return;
      }
    } catch {
      // Retry until Codex finishes flushing the rollout after thread/start.
    }
    await delay(100);
  }
  throw new Error('codex_runtime_capsule_discovery_rollout_unavailable');
};

const relativeCodexHomePath = async (codexHomeRoot: string, absolutePath: string): Promise<string> => {
  const [realRoot, realAbsolutePath] = await Promise.all([realpath(codexHomeRoot), realpath(absolutePath)]);
  const relativePath = relative(realRoot, realAbsolutePath).replaceAll('\\', '/');
  if (relativePath.startsWith('../') || relativePath === '..' || relativePath.startsWith('/')) {
    throw new Error('codex_runtime_capsule_discovery_rollout_path_outside_home');
  }
  return relativePath;
};

const runControlledScenario = async (env: EnvLike, input: { codexHomeRoot: string }): Promise<ObservedCodexHomeState> => {
  const transport = new CodexAppServerStdioTransport({
    codexBin: codexBin(env),
    codexHomeRoot: input.codexHomeRoot,
    cwd: process.cwd(),
    env,
  });
  try {
    await transport.initialize();
    const startResponse = await transport.request('thread/start', {
      cwd: process.cwd(),
      initialUserMessage: 'ForgeLoop controlled Codex runtime capsule discovery.',
      approvalPolicy: 'never',
      sandboxPolicy: { type: 'readOnly' },
    });
    const thread = typeof startResponse === 'object' && startResponse !== null && 'thread' in startResponse ? startResponse.thread : undefined;
    if (typeof thread !== 'object' || thread === null || !('id' in thread) || !('path' in thread)) {
      return blockedState('codex_runtime_capsule_discovery_thread_start_unavailable');
    }
    const threadId = typeof thread.id === 'string' ? thread.id : undefined;
    const rolloutPath = typeof thread.path === 'string' ? thread.path : undefined;
    if (threadId === undefined || rolloutPath === undefined) {
      return blockedState('codex_runtime_capsule_discovery_thread_start_unavailable');
    }
    const turnResponse = await transport.request('turn/start', {
      threadId,
      input: [{ type: 'text', text: 'Reply OK for ForgeLoop runtime capsule discovery.', text_elements: [] }],
      approvalPolicy: 'never',
      sandboxPolicy: { type: 'readOnly', networkAccess: false },
    });
    await waitForFile(rolloutPath);
    const turn = typeof turnResponse === 'object' && turnResponse !== null && 'turn' in turnResponse ? turnResponse.turn : undefined;
    const turnId = typeof turn === 'object' && turn !== null && 'id' in turn && typeof turn.id === 'string' ? turn.id : undefined;
    if (turnId !== undefined) {
      await transport.request('turn/interrupt', { threadId, turnId }).catch(() => undefined);
    }
    const rolloutRelativePath = await relativeCodexHomePath(input.codexHomeRoot, rolloutPath);
    const rolloutContent = await readFile(rolloutPath, 'utf8');
    const rolloutDigest = codexCanonicalDigest(rolloutContent);
    const dbPath = join(input.codexHomeRoot, 'state_5.sqlite');
    const tableSql = await sqliteScalar(
      dbPath,
      "select sql from sqlite_master where type='table' and name='threads'",
    );
    if (!/\brollout_path\b/.test(tableSql) || !/\bid\b/.test(tableSql)) {
      return blockedState('codex_runtime_capsule_discovery_threads_schema_unavailable');
    }
    const source = 'vscode';
    const modelProvider = 'openai';
    const sandboxPolicy = 'read-only';
    const approvalMode = 'never';
    const memoryMode = 'enabled';
    const existingRowCount = await sqliteScalar(dbPath, `select count(*) from threads where id=${singleQuotedSql(threadId)}`);
    if (existingRowCount !== '1') {
      return blockedState('codex_runtime_capsule_discovery_threads_row_missing');
    }
    const observedMutations = await collectCodexHomeMutations(input.codexHomeRoot, rolloutRelativePath);

    return {
      observed_path_mutations: observedMutations,
      locator_repair_manifest: {
        schema_version: 'codex_thread_locator_repair_manifest.v1',
        codex_thread_id_digest: codexThreadIdDigest(threadId),
        rollout_relative_path: rolloutRelativePath,
        rollout_digest: rolloutDigest,
        repair_strategy: 'minimal_state_index_upsert',
        required_state_tables: [
          {
            table_name: 'threads',
            allowed_columns: [...codexStateIndexThreadsColumns],
            row_digest: buildCodexThreadLocatorRepairRowDigest({
              codexThreadIdDigest: codexThreadIdDigest(threadId),
              rolloutDigest,
              source,
              modelProvider,
              sandboxPolicy,
              approvalMode,
              memoryMode,
            }),
          },
        ],
      },
      public_observations: {
        controlled_scenario: 'real_app_server_thread_start',
        locator_repair_strategy: 'minimal_state_index_upsert',
        observed_mutation_count: observedMutations.length,
        required_thread_state_file_count: 1,
      },
    };
  } catch {
    return blockedState('codex_runtime_capsule_discovery_controlled_scenario_unavailable');
  } finally {
    await transport.close().catch(() => undefined);
  }
};

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
  runControlledScenario: (input) => runControlledScenario(env, input),
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
