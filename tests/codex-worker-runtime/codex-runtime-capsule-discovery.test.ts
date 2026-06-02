import { describe, expect, it } from 'vitest';

import { codexCanonicalDigest, codexThreadLocatorRepairThreadsColumns, DomainError } from '../../packages/domain/src/index';
import {
  runCodexRuntimeCapsuleDiscovery,
  type CodexRuntimeCapsuleDiscoveryProbe,
  type ObservedCodexHomeState,
} from '../../packages/codex-worker-runtime/src/index';

const digest = (input: unknown): string => codexCanonicalDigest(input);

const locatorRepairManifest = {
  schema_version: 'codex_thread_locator_repair_manifest.v1',
  codex_thread_id_digest: digest({ thread: 'abc' }),
  rollout_relative_path: 'sessions/2026/06/02/rollout-abc.jsonl',
  rollout_digest: digest({ rollout: 'abc' }),
  repair_strategy: 'minimal_state_index_upsert',
  required_state_tables: [
    {
      table_name: 'threads',
      allowed_columns: [...codexThreadLocatorRepairThreadsColumns],
      row_digest: digest({ row: 'abc' }),
    },
  ],
} as const;

const observedState = (override: Partial<ObservedCodexHomeState> = {}): ObservedCodexHomeState => ({
  observed_path_mutations: [{ relative_path: 'sessions/2026/06/02/rollout-abc.jsonl', mutation_kind: 'created', entry_kind: 'regular_file' }],
  locator_repair_manifest: locatorRepairManifest,
  ...override,
});

const probe = (state: ObservedCodexHomeState): CodexRuntimeCapsuleDiscoveryProbe => ({
  codexVersion: async () => 'codex-cli 1.2.3',
  appServerProtocolDigest: async () => digest({ protocol: 'app-server-v1' }),
  runControlledScenario: async () => state,
});

const expectDiscoveryBlockers = async (state: ObservedCodexHomeState, codes: readonly string[]) => {
  const report = await runCodexRuntimeCapsuleDiscovery({ codexHomeRoot: '/tmp/codex-home', probe: probe(state) });

  expect(report.status).toBe('blocked');
  expect(report.blocker_codes).toEqual(expect.arrayContaining([...codes]));
  expect(JSON.stringify(report)).not.toContain('thread-raw');
  expect(JSON.stringify(report)).not.toContain('artifact://internal/');
};

describe('Codex runtime capsule discovery gate', () => {
  it('passes only with classified mutations and a locator repair manifest', async () => {
    const report = await runCodexRuntimeCapsuleDiscovery({
      codexHomeRoot: '/tmp/codex-home',
      probe: probe(observedState()),
    });

    expect(report.status).toBe('passed');
    expect(report.codex_cli_version_digest).toMatch(/^sha256:/);
    expect(report.app_server_protocol_digest).toMatch(/^sha256:/);
    expect(report.locator_repair_manifest_digest).toMatch(/^sha256:/);
    expect(report.path_mutation_counts).toMatchObject({
      thread_state_allowed: 1,
      environment_component: 0,
      unknown: 0,
      forbidden: 0,
      forbidden_whole_db: 0,
    });
    expect(report.blocker_codes).toEqual([]);
  });

  it('blocks when an unknown path exists', async () => {
    await expectDiscoveryBlockers(
      observedState({ observed_path_mutations: [{ relative_path: 'unknown.bin', mutation_kind: 'created', entry_kind: 'regular_file' }] }),
      [
      'codex_runtime_capsule_discovery_unknown_path',
      ],
    );
  });

  it('blocks when a forbidden path is required', async () => {
    await expectDiscoveryBlockers(
      observedState({
        observed_path_mutations: [{ relative_path: 'auth.json', mutation_kind: 'modified', entry_kind: 'regular_file', required_for_restore: true }],
      }),
      ['codex_runtime_capsule_discovery_forbidden_required_path'],
    );
  });

  it('counts forbidden app-server files without accepting them as required restore inputs', async () => {
    const report = await runCodexRuntimeCapsuleDiscovery({
      codexHomeRoot: '/tmp/codex-home',
      probe: probe(
        observedState({
          observed_path_mutations: [
            { relative_path: 'sessions/2026/06/02/rollout-abc.jsonl', mutation_kind: 'created', entry_kind: 'regular_file', required_for_restore: true },
            { relative_path: 'state_5.sqlite', mutation_kind: 'created', entry_kind: 'regular_file' },
            { relative_path: 'logs_1.sqlite', mutation_kind: 'created', entry_kind: 'regular_file' },
            { relative_path: 'plugins/plugin-a/plugin.json', mutation_kind: 'created', entry_kind: 'regular_file' },
          ],
        }),
      ),
    });

    expect(report.status).toBe('passed');
    expect(report.path_mutation_counts.thread_state_allowed).toBe(1);
    expect(report.path_mutation_counts.forbidden).toBe(2);
    expect(report.path_mutation_counts.forbidden_whole_db).toBe(1);
    expect(report.blocker_codes).toEqual([]);
  });

  it('blocks when locator repair asks to copy a whole SQLite DB', async () => {
    await expectDiscoveryBlockers(
      observedState({
        locator_repair_strategy: { kind: 'copy_whole_sqlite_db', relative_path: 'state_5.sqlite' },
      }),
      ['codex_runtime_capsule_discovery_whole_db_repair_forbidden'],
    );
  });

  it('blocks without a locator repair manifest', async () => {
    await expectDiscoveryBlockers(observedState({ locator_repair_manifest: undefined }), [
      'codex_runtime_capsule_discovery_locator_repair_manifest_missing',
    ]);
  });

  it('blocks when locator repair manifest has an unsafe rollout path or legacy shape', async () => {
    await expectDiscoveryBlockers(
      observedState({
        locator_repair_manifest: {
          ...locatorRepairManifest,
          rollout_relative_path: '../sessions/2026/06/02/rollout-abc.jsonl',
        },
      }),
      ['codex_runtime_capsule_discovery_locator_repair_manifest_invalid'],
    );
    await expectDiscoveryBlockers(
      observedState({
        locator_repair_manifest: {
          schema_version: 'codex_thread_locator_repair_manifest.v1',
          codex_session_id: 'codex-session-1',
          repair_id: 'repair-1',
          locator_digest: digest({ locator: 'before' }),
          repaired_locator_digest: digest({ locator: 'after' }),
          evidence_digest: digest({ evidence: 'locator-repaired' }),
        },
      }),
      ['codex_runtime_capsule_discovery_locator_repair_manifest_invalid'],
    );
  });

  it('blocks when observed entries are symlinks, sockets, or non-regular entries', async () => {
    await expectDiscoveryBlockers(
      observedState({
        observed_path_mutations: [
          { relative_path: 'sessions/2026/06/02/rollout-abc.jsonl', mutation_kind: 'created', entry_kind: 'symlink' },
        ],
      }),
      ['codex_runtime_capsule_discovery_unsafe_path_entry'],
    );
    await expectDiscoveryBlockers(
      observedState({
        observed_path_mutations: [
          { relative_path: 'sessions/2026/06/02/rollout-abc.jsonl', mutation_kind: 'created', entry_kind: 'socket' },
        ],
      }),
      ['codex_runtime_capsule_discovery_unsafe_path_entry'],
    );
    await expectDiscoveryBlockers(
      observedState({
        observed_path_mutations: [
          { relative_path: 'sessions/2026/06/02/rollout-abc.jsonl', mutation_kind: 'created', entry_kind: 'directory' },
        ],
      }),
      ['codex_runtime_capsule_discovery_unsafe_path_entry'],
    );
  });

  it('rejects raw thread ids or internal refs in public output', async () => {
    await expect(
      runCodexRuntimeCapsuleDiscovery({
        codexHomeRoot: '/tmp/codex-home',
        probe: probe(
          observedState({
            public_observations: { codex_thread_id: 'thread-raw', internal_ref: 'artifact://internal/codex_memory_bundle/x' },
          }),
        ),
      }),
    ).rejects.toBeInstanceOf(DomainError);
  });
});
