import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  codexCanonicalDigest,
  codexThreadLocatorRepairThreadsColumns,
  codexThreadLocatorRepairManifestDigest,
} from '@forgeloop/domain';
import { describe, expect, it } from 'vitest';

import {
  assertCodexThreadStatePublicReportSafe,
  packageCodexThreadStateBundle,
  restoreCodexThreadStateBundle,
  type CodexThreadLocatorRepairManifest,
} from '../../packages/codex-worker-runtime/src/index';

const codexSessionId = 'codex-session-1';
const capsuleId = 'capsule-1';
const rolloutRelativePath = 'sessions/2026/06/03/rollout-thread-a.jsonl';
const otherRolloutRelativePath = 'sessions/2026/06/03/rollout-thread-b.jsonl';
const rolloutContent = '{"type":"turn_context","thread":"redacted"}\n';
const digest = (input: unknown): string => codexCanonicalDigest(input);

const writeCodexHomeFile = async (root: string, relativePath: string, content: string): Promise<void> => {
  const path = join(root, relativePath);
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, content);
};

const locatorRepair = (
  overrides: Partial<CodexThreadLocatorRepairManifest> = {},
): CodexThreadLocatorRepairManifest => ({
  schema_version: 'codex_thread_locator_repair_manifest.v1',
  codex_thread_id_digest: digest({ thread: 'thread-a' }),
  rollout_relative_path: rolloutRelativePath,
  rollout_digest: digest(rolloutContent),
  repair_strategy: 'minimal_state_index_upsert',
  required_state_tables: [
    {
      table_name: 'threads',
      allowed_columns: [...codexThreadLocatorRepairThreadsColumns],
      row_digest: digest({ row: 'thread-a' }),
    },
  ],
  ...overrides,
});

describe('Codex runtime capsule thread state', () => {
  it('packages only the rollout JSONL for the bound thread', async () => {
    const codexHomeRoot = await mkdtemp(join(tmpdir(), 'forgeloop-codex-thread-'));
    await writeCodexHomeFile(codexHomeRoot, rolloutRelativePath, rolloutContent);
    await writeCodexHomeFile(codexHomeRoot, otherRolloutRelativePath, '{"thread":"other"}\n');

    const result = await packageCodexThreadStateBundle({
      codexHomeRoot,
      locatorRepair: locatorRepair(),
      codexSessionId,
      capsuleId,
    });

    expect(result.bundle.entries).toEqual([
      {
        relative_path: rolloutRelativePath,
        content: rolloutContent,
        digest: digest(rolloutContent),
        size_bytes: String(Buffer.byteLength(rolloutContent)),
      },
    ]);
    expect(result.bundle.locator_repair_manifest_digest).toBe(
      codexThreadLocatorRepairManifestDigest(result.bundle.locator_repair_manifest),
    );
  });

  it('rejects rollout paths outside isolated CODEX_HOME', async () => {
    const codexHomeRoot = await mkdtemp(join(tmpdir(), 'forgeloop-codex-thread-'));

    await expect(
      packageCodexThreadStateBundle({
        codexHomeRoot,
        locatorRepair: locatorRepair({ rollout_relative_path: '../sessions/rollout-thread-a.jsonl' }),
        codexSessionId,
        capsuleId,
      }),
    ).rejects.toThrow(/rollout_relative_path|unsafe/i);
  });

  it('rejects raw codex_thread_id in report output', () => {
    expect(() =>
      assertCodexThreadStatePublicReportSafe({
        codex_thread_id: 'thread-a',
        rollout_count: 1,
      }),
    ).toThrow(/private runtime material|public report/i);
  });

  it('rejects locator repair strategy app_server_scan', async () => {
    const sourceRoot = await mkdtemp(join(tmpdir(), 'forgeloop-codex-thread-source-'));
    await writeCodexHomeFile(sourceRoot, rolloutRelativePath, rolloutContent);

    await expect(
      packageCodexThreadStateBundle({
        codexHomeRoot: sourceRoot,
        locatorRepair: { ...locatorRepair(), repair_strategy: 'app_server_scan' } as unknown as CodexThreadLocatorRepairManifest,
        codexSessionId,
        capsuleId,
      }),
    ).rejects.toThrow(/repair_strategy|unsupported|invalid/i);
  });

  it('rejects locator repair requiring whole state_5.sqlite', async () => {
    const codexHomeRoot = await mkdtemp(join(tmpdir(), 'forgeloop-codex-thread-'));
    await writeCodexHomeFile(codexHomeRoot, rolloutRelativePath, rolloutContent);

    await expect(
      packageCodexThreadStateBundle({
        codexHomeRoot,
        locatorRepair: {
          ...locatorRepair(),
          repair_strategy: 'copy_whole_sqlite_db',
          state_relative_path: 'state_5.sqlite',
        } as unknown as CodexThreadLocatorRepairManifest,
        codexSessionId,
        capsuleId,
      }),
    ).rejects.toThrow(/whole|state_5\.sqlite|repair_strategy/i);
  });

  it('allows minimal_state_index_upsert only with exact threads table columns and row digest', async () => {
    const codexHomeRoot = await mkdtemp(join(tmpdir(), 'forgeloop-codex-thread-'));
    await writeCodexHomeFile(codexHomeRoot, rolloutRelativePath, rolloutContent);

    await expect(
      packageCodexThreadStateBundle({
        codexHomeRoot,
        locatorRepair: locatorRepair({ repair_strategy: 'minimal_state_index_upsert', required_state_tables: [] }),
        codexSessionId,
        capsuleId,
      }),
    ).rejects.toThrow(/required_state_tables/i);

    await expect(
      packageCodexThreadStateBundle({
        codexHomeRoot,
        locatorRepair: locatorRepair({
          repair_strategy: 'minimal_state_index_upsert',
          required_state_tables: [
            {
              table_name: 'thread_locator_index',
              allowed_columns: [...codexThreadLocatorRepairThreadsColumns],
              row_digest: digest({ row: 'thread-a' }),
            },
          ],
        }),
        codexSessionId,
        capsuleId,
      }),
    ).rejects.toThrow(/threads table|table_name|required_state_tables/i);

    await expect(
      packageCodexThreadStateBundle({
        codexHomeRoot,
        locatorRepair: locatorRepair({
          repair_strategy: 'minimal_state_index_upsert',
          required_state_tables: [
            {
              table_name: 'threads',
              allowed_columns: ['id', 'rollout_path'],
              row_digest: digest({ row: 'thread-a' }),
            },
          ],
        }),
        codexSessionId,
        capsuleId,
      }),
    ).rejects.toThrow(/allowed.*columns|allowed_columns/i);

    const result = await packageCodexThreadStateBundle({
      codexHomeRoot,
      locatorRepair: locatorRepair(),
      codexSessionId,
      capsuleId,
    });

    expect(result.bundle.locator_repair_manifest.repair_strategy).toBe('minimal_state_index_upsert');
    expect(result.bundle.entries.map((entry) => entry.relative_path)).not.toContain('state_5.sqlite');
  });

  it('fails closed for minimal_state_index_upsert restore without an executor', async () => {
    const sourceRoot = await mkdtemp(join(tmpdir(), 'forgeloop-codex-thread-source-'));
    const restoreRoot = await mkdtemp(join(tmpdir(), 'forgeloop-codex-thread-restore-'));
    await writeCodexHomeFile(sourceRoot, rolloutRelativePath, rolloutContent);
    const repair = locatorRepair({
      repair_strategy: 'minimal_state_index_upsert',
      required_state_tables: [
        {
          table_name: 'threads',
          allowed_columns: [...codexThreadLocatorRepairThreadsColumns],
          row_digest: digest({ row: 'thread-a' }),
        },
      ],
    });
    const result = await packageCodexThreadStateBundle({
      codexHomeRoot: sourceRoot,
      locatorRepair: repair,
      codexSessionId,
      capsuleId,
    });

    await expect(
      restoreCodexThreadStateBundle({
        codexHomeRoot: restoreRoot,
        bundle: result.bundle,
        locatorRepair: repair,
      }),
    ).rejects.toThrow(/locator repair executor missing/i);
  });

  it('can defer minimal_state_index_upsert repair until app-server initializes its state index', async () => {
    const sourceRoot = await mkdtemp(join(tmpdir(), 'forgeloop-codex-thread-source-'));
    const restoreRoot = await mkdtemp(join(tmpdir(), 'forgeloop-codex-thread-restore-'));
    await writeCodexHomeFile(sourceRoot, rolloutRelativePath, rolloutContent);
    const repair = locatorRepair({
      repair_strategy: 'minimal_state_index_upsert',
      required_state_tables: [
        {
          table_name: 'threads',
          allowed_columns: [...codexThreadLocatorRepairThreadsColumns],
          row_digest: digest({ row: 'thread-a' }),
        },
      ],
    });
    const result = await packageCodexThreadStateBundle({
      codexHomeRoot: sourceRoot,
      locatorRepair: repair,
      codexSessionId,
      capsuleId,
    });

    await restoreCodexThreadStateBundle({
      codexHomeRoot: restoreRoot,
      bundle: result.bundle,
      locatorRepair: repair,
      deferLocatorRepair: true,
    });

    await expect(readFile(join(restoreRoot, rolloutRelativePath), 'utf8')).resolves.toBe(rolloutContent);
  });

  it('runs minimal_state_index_upsert repair after restoring the rollout file', async () => {
    const sourceRoot = await mkdtemp(join(tmpdir(), 'forgeloop-codex-thread-source-'));
    const restoreRoot = await mkdtemp(join(tmpdir(), 'forgeloop-codex-thread-restore-'));
    await writeCodexHomeFile(sourceRoot, rolloutRelativePath, rolloutContent);
    const repair = locatorRepair({
      repair_strategy: 'minimal_state_index_upsert',
      required_state_tables: [
        {
          table_name: 'threads',
          allowed_columns: [...codexThreadLocatorRepairThreadsColumns],
          row_digest: digest({ row: 'thread-a' }),
        },
      ],
    });
    const result = await packageCodexThreadStateBundle({
      codexHomeRoot: sourceRoot,
      locatorRepair: repair,
      codexSessionId,
      capsuleId,
    });
    const repairs: unknown[] = [];

    await restoreCodexThreadStateBundle({
      codexHomeRoot: restoreRoot,
      bundle: result.bundle,
      locatorRepair: repair,
      codexThreadId: 'thread-a',
      repairExecutor: async (input) => {
        repairs.push({
          codexHomeRoot: input.codexHomeRoot,
          codexThreadId: input.codexThreadId,
          repairStrategy: input.locatorRepair.repair_strategy,
          rolloutDigest: input.locatorRepair.rollout_digest,
        });
        await expect(readFile(join(input.codexHomeRoot, rolloutRelativePath), 'utf8')).resolves.toBe(rolloutContent);
      },
    });

    expect(repairs).toEqual([
      {
        codexHomeRoot: restoreRoot,
        codexThreadId: 'thread-a',
        repairStrategy: 'minimal_state_index_upsert',
        rolloutDigest: digest(rolloutContent),
      },
    ]);
  });
});
