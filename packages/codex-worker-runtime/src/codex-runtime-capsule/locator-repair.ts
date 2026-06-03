import { execFile as execFileCallback } from 'node:child_process';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { codexCanonicalDigest, codexThreadLocatorRepairThreadsColumns } from '@forgeloop/domain';

import type { CodexThreadLocatorRepairExecutor, CodexThreadLocatorRepairExecutorInput } from './thread-state.js';

const execFile = promisify(execFileCallback);

export const codexStateIndexThreadsColumns = codexThreadLocatorRepairThreadsColumns;

const expectedColumns = [...codexStateIndexThreadsColumns].sort((left, right) => left.localeCompare(right));

const shellQuote = (value: string): string => `'${value.replaceAll("'", "''")}'`;

const assertMinimalThreadIndexManifest = (input: CodexThreadLocatorRepairExecutorInput): void => {
  if (input.locatorRepair.repair_strategy !== 'minimal_state_index_upsert') {
    throw new Error('codex thread locator repair strategy unsupported');
  }
  if (
    input.locatorRepair.codex_thread_id_digest !==
    codexCanonicalDigest({ kind: 'codex_app_server_thread_id', thread_id: input.codexThreadId })
  ) {
    throw new Error('codex thread locator repair thread digest mismatch');
  }
  const tables = input.locatorRepair.required_state_tables ?? [];
  if (tables.length !== 1) {
    throw new Error('codex thread locator repair requires exactly one state table');
  }
  const [table] = tables;
  if (table === undefined || table.table_name !== 'threads') {
    throw new Error('codex thread locator repair only supports threads table');
  }
  const actualColumns = [...table.allowed_columns].sort((left, right) => left.localeCompare(right));
  if (actualColumns.length !== expectedColumns.length || actualColumns.some((column, index) => column !== expectedColumns[index])) {
    throw new Error('codex thread locator repair columns mismatch');
  }
}

export const buildCodexThreadLocatorRepairRowDigest = (input: {
  codexThreadIdDigest: string;
  rolloutDigest: string;
  source: string;
  modelProvider: string;
  sandboxPolicy: string;
  approvalMode: string;
  memoryMode: string;
}): string =>
  codexCanonicalDigest({
    id_digest: input.codexThreadIdDigest,
    rollout_digest: input.rolloutDigest,
    source: input.source,
    model_provider: input.modelProvider,
    sandbox_policy: input.sandboxPolicy,
    approval_mode: input.approvalMode,
    memory_mode: input.memoryMode,
  });

export const createSqliteCodexThreadLocatorRepairExecutor = (options: {
  sqliteBin?: string;
  nowSeconds?: () => number;
  codexHomePathForSqlite?: string;
  cwd?: string;
  title?: string;
  cliVersion?: string;
  source?: string;
  modelProvider?: string;
  sandboxPolicy?: string;
  approvalMode?: string;
  memoryMode?: string;
} = {}): CodexThreadLocatorRepairExecutor => async (input) => {
  assertMinimalThreadIndexManifest(input);
  const stateDbPath = join(input.codexHomeRoot, 'state_5.sqlite');
  await access(stateDbPath);
  const nowSeconds = options.nowSeconds?.() ?? Math.floor(Date.now() / 1000);
  const source = options.source ?? 'vscode';
  const modelProvider = options.modelProvider ?? 'openai';
  const sandboxPolicy = options.sandboxPolicy ?? 'read-only';
  const approvalMode = options.approvalMode ?? 'never';
  const memoryMode = options.memoryMode ?? 'enabled';
  const rowDigest = buildCodexThreadLocatorRepairRowDigest({
    codexThreadIdDigest: input.locatorRepair.codex_thread_id_digest,
    rolloutDigest: input.locatorRepair.rollout_digest,
    source,
    modelProvider,
    sandboxPolicy,
    approvalMode,
    memoryMode,
  });
  const expectedRowDigest = input.locatorRepair.required_state_tables?.[0]?.row_digest;
  if (expectedRowDigest !== rowDigest) {
    throw new Error('codex thread locator repair row digest mismatch');
  }

  const rolloutPath = join(options.codexHomePathForSqlite ?? input.codexHomeRoot, input.locatorRepair.rollout_relative_path);
  const values = [
    input.codexThreadId,
    rolloutPath,
    String(nowSeconds),
    String(nowSeconds),
    source,
    modelProvider,
    options.cwd ?? '',
    options.title ?? '',
    sandboxPolicy,
    approvalMode,
    '0',
    '1',
    '0',
    options.cliVersion ?? '',
    '',
    memoryMode,
    '',
  ];
  const sql = [
    `INSERT INTO threads (${codexStateIndexThreadsColumns.join(', ')})`,
    `VALUES (${values.map(shellQuote).join(', ')})`,
    'ON CONFLICT(id) DO UPDATE SET',
    [
      'rollout_path = excluded.rollout_path',
      'updated_at = excluded.updated_at',
      'source = excluded.source',
      'model_provider = excluded.model_provider',
      'cwd = excluded.cwd',
      'title = excluded.title',
      'sandbox_policy = excluded.sandbox_policy',
      'approval_mode = excluded.approval_mode',
      'cli_version = excluded.cli_version',
      'memory_mode = excluded.memory_mode',
      'preview = excluded.preview',
    ].join(', '),
    ';',
  ].join(' ');
  await execFile(options.sqliteBin ?? '/usr/bin/sqlite3', [stateDbPath, sql], { timeout: 10_000, maxBuffer: 1024 * 1024 });
};
