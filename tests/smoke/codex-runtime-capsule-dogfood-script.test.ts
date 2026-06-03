import { readFileSync } from 'node:fs';
import { chmod, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  createInstalledCodexDiscoveryProbe,
  codexRuntimeCapsuleDiscoveryDogfoodCommand,
  renderCodexRuntimeCapsuleDiscoverySummary,
  runCodexRuntimeCapsuleDiscoveryDogfood,
  writeCodexRuntimeCapsuleDiscoveryReport,
  type CodexRuntimeCapsuleDiscoveryReport,
} from '../../scripts/codex-runtime-capsule-discovery';
import {
  codexRuntimeCapsuleRestoreDogfoodCommand,
  codexRuntimeCapsuleRestoreReportPath,
  renderCodexRuntimeCapsuleRestoreSummary,
  runCodexRuntimeCapsuleRestoreDogfood,
  writeCodexRuntimeCapsuleRestoreReport,
} from '../../scripts/codex-runtime-capsule-restore-dogfood';

const rootUrl = new URL('../..', import.meta.url);
const readJson = (path: string) => JSON.parse(readFileSync(new URL(path, rootUrl), 'utf8'));

const report = (): CodexRuntimeCapsuleDiscoveryReport => ({
  schema_version: 'codex_runtime_capsule_discovery_report.v1',
  status: 'blocked',
  codex_cli_version_digest: `sha256:${'a'.repeat(64)}`,
  app_server_protocol_digest: `sha256:${'b'.repeat(64)}`,
  path_mutation_counts: {
    thread_state_allowed: 1,
    memory_state_allowed: 0,
    environment_component: 1,
    generated_environment: 0,
    forbidden: 0,
    forbidden_whole_db: 0,
    unknown: 0,
  },
  observed_mutation_count: 2,
  blocker_codes: ['codex_runtime_capsule_discovery_controlled_scenario_unavailable'],
});

describe('Codex runtime capsule discovery dogfood script', () => {
  it('is registered as the root dogfood command', () => {
    expect(codexRuntimeCapsuleDiscoveryDogfoodCommand).toBe(
      'tsx --tsconfig apps/control-plane-api/tsconfig.json scripts/codex-runtime-capsule-discovery.ts',
    );
    expect(readJson('package.json').scripts).toMatchObject({
      'dogfood:codex-runtime-capsule-discovery': codexRuntimeCapsuleDiscoveryDogfoodCommand,
    });
  });

  it('renders product-safe summary fields only', () => {
    const summary = renderCodexRuntimeCapsuleDiscoverySummary(report());

    expect(summary).toContain('Report: test-results/codex-runtime-capsule-discovery-report.json');
    expect(summary).toContain('Codex CLI version digest: sha256:');
    expect(summary).toContain('Path mutation counts digest: sha256:');
    expect(summary).toContain('Blocker codes: codex_runtime_capsule_discovery_controlled_scenario_unavailable');
    expect(summary).not.toContain('thread-raw');
    expect(summary).not.toContain('artifact://internal/');
    expect(summary).not.toContain('auth.json');
    expect(summary).not.toContain('config.toml');
  });

  it('writes the discovery report as JSON', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'forgeloop-capsule-discovery-test-'));
    const reportPath = join(tempDir, 'report.json');
    try {
      await writeCodexRuntimeCapsuleDiscoveryReport(report(), reportPath);

      await expect(readFile(reportPath, 'utf8')).resolves.toContain('"schema_version": "codex_runtime_capsule_discovery_report.v1"');
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it('blocks product-safely when the installed Codex CLI is unavailable', async () => {
    const result = await runCodexRuntimeCapsuleDiscoveryDogfood({ FORGELOOP_CODEX_BIN: 'codex-definitely-missing-for-test' });

    expect(result.status).toBe('blocked');
    expect(result.blocker_codes).toContain('codex_runtime_capsule_discovery_codex_cli_unavailable');
    expect(JSON.stringify(result)).not.toContain('codex-definitely-missing-for-test');
  });

  it('passes explicit environment to installed Codex schema discovery and cleans the schema root', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'forgeloop-fake-codex-'));
    const fakeCodexBin = join(tempDir, 'codex');
    try {
      await writeFile(
        fakeCodexBin,
        [
          '#!/usr/bin/env node',
          'const fs = require("node:fs");',
          'const path = require("node:path");',
          'if (process.argv.includes("--version")) { console.log("fake-codex 1.0.0"); process.exit(0); }',
          'const outIndex = process.argv.indexOf("--out");',
          'if (process.argv[2] === "app-server" && outIndex !== -1) {',
          '  const out = process.argv[outIndex + 1];',
          '  fs.mkdirSync(out, { recursive: true });',
          '  fs.writeFileSync(path.join(out, "schema.json"), JSON.stringify({ marker: process.env.FORGELOOP_FAKE_CODEX_MARKER }));',
          '  console.log("ok");',
          '  process.exit(0);',
          '}',
          'process.exit(2);',
        ].join('\n'),
        'utf8',
      );
      await chmod(fakeCodexBin, 0o755);

      const probe = createInstalledCodexDiscoveryProbe({
        FORGELOOP_CODEX_BIN: fakeCodexBin,
        FORGELOOP_FAKE_CODEX_MARKER: 'env-visible',
      });

      await expect(probe.codexVersion()).resolves.toBe('fake-codex 1.0.0');
      const digest = await probe.appServerProtocolDigest();

      expect(digest).toMatch(/^sha256:/);
      await expect(readdir(tempDir)).resolves.toEqual(['codex']);
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it('runs the installed Codex controlled discovery scenario without raw runtime state', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'forgeloop-fake-codex-'));
    const fakeCodexBin = join(tempDir, 'codex');
    try {
      await writeFile(
        fakeCodexBin,
        [
          '#!/usr/bin/env node',
          'const fs = require("node:fs");',
          'const path = require("node:path");',
          'const cp = require("node:child_process");',
          'if (process.argv.includes("--version")) { console.log("fake-codex 1.0.0"); process.exit(0); }',
          'const outIndex = process.argv.indexOf("--out");',
          'if (process.argv[2] === "app-server" && outIndex !== -1) {',
          '  const out = process.argv[outIndex + 1];',
          '  fs.mkdirSync(out, { recursive: true });',
          '  fs.writeFileSync(path.join(out, "schema.json"), JSON.stringify({ marker: "schema-visible" }));',
          '  console.log("ok");',
          '  process.exit(0);',
          '}',
          'if (process.argv[2] === "app-server" && process.argv.includes("--listen")) {',
          '  const home = process.env.CODEX_HOME;',
          '  const threadId = "019e0000-0000-7000-8000-000000000001";',
          '  const rollout = path.join(home, "sessions/2026/06/02/rollout-019e0000-0000-7000-8000-000000000001.jsonl");',
          '  fs.mkdirSync(path.dirname(rollout), { recursive: true });',
          '  fs.writeFileSync(rollout, JSON.stringify({ type: "turn_context" }) + "\\n");',
          '  const db = path.join(home, "state_5.sqlite");',
          '  cp.execFileSync("/usr/bin/sqlite3", [db, "CREATE TABLE threads (id TEXT PRIMARY KEY, rollout_path TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, source TEXT NOT NULL, model_provider TEXT NOT NULL, cwd TEXT NOT NULL, title TEXT NOT NULL, sandbox_policy TEXT NOT NULL, approval_mode TEXT NOT NULL, tokens_used INTEGER NOT NULL DEFAULT 0, has_user_event INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0, cli_version TEXT NOT NULL DEFAULT \'\', first_user_message TEXT NOT NULL DEFAULT \'\', memory_mode TEXT NOT NULL DEFAULT \'enabled\', preview TEXT NOT NULL DEFAULT \'\'); INSERT INTO threads (id, rollout_path, created_at, updated_at, source, model_provider, cwd, title, sandbox_policy, approval_mode, tokens_used, has_user_event, archived, cli_version, first_user_message, memory_mode, preview) VALUES (\'" + threadId + "\', \'" + rollout.replaceAll("\'", "\'\'") + "\', 1, 1, \'vscode\', \'openai\', \'\', \'\', \'read-only\', \'never\', 0, 1, 0, \'fake\', \'\', \'enabled\', \'\');"]);',
          '  const rl = require("node:readline").createInterface({ input: process.stdin });',
          '  rl.on("line", line => {',
          '    const msg = JSON.parse(line);',
          '    if (msg.id && msg.method === "initialize") console.log(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { ok: true } }));',
          '    if (msg.id && msg.method === "thread/start") console.log(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { thread: { id: threadId, path: rollout } } }));',
          '    if (msg.id && msg.method === "turn/start") console.log(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { turn: { id: "turn-1" } } }));',
          '    if (msg.id && msg.method === "turn/interrupt") console.log(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { ok: true } }));',
          '  });',
          '  return;',
          '}',
          'process.exit(2);',
        ].join('\n'),
        'utf8',
      );
      await chmod(fakeCodexBin, 0o755);

      const result = await runCodexRuntimeCapsuleDiscoveryDogfood({ FORGELOOP_CODEX_BIN: fakeCodexBin });
      const summary = renderCodexRuntimeCapsuleDiscoverySummary(result);
      const serialized = JSON.stringify(result);

      expect(result.status).toBe('passed');
      expect(result.observed_mutation_count).toBeGreaterThanOrEqual(2);
      expect(result.path_mutation_counts.thread_state_allowed).toBe(1);
      expect(result.path_mutation_counts.forbidden_whole_db).toBeGreaterThanOrEqual(1);
      expect(result.locator_repair_manifest_digest).toMatch(/^sha256:/);
      expect(result.public_observations_digest).toMatch(/^sha256:/);
      expect(result.blocker_codes).toEqual([]);
      expect(summary).toContain('Status: passed');
      expect(serialized).not.toContain('controlled-discovery-thread');
      expect(serialized).not.toContain('sessions/2026/06/02/rollout-controlled-discovery.jsonl');
      expect(serialized).not.toContain('auth.json');
      expect(serialized).not.toContain('config.toml');
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });
});

describe('Codex runtime capsule restore dogfood script', () => {
  it('is registered as the root restore dogfood command', () => {
    expect(codexRuntimeCapsuleRestoreDogfoodCommand).toBe(
      'tsx --tsconfig apps/control-plane-api/tsconfig.json scripts/codex-runtime-capsule-restore-dogfood.ts',
    );
    expect(readJson('package.json').scripts).toMatchObject({
      'dogfood:codex-runtime-capsule-restore': codexRuntimeCapsuleRestoreDogfoodCommand,
    });
  });

  it('skips product-safely when credentials are unavailable', async () => {
    const restoreReport = await runCodexRuntimeCapsuleRestoreDogfood({
      mode: 'fake',
      credentialsAvailable: async () => false,
      discoveryReport: async () => ({
        ...reportFixture(),
        status: 'passed',
        blocker_codes: [],
      }),
    });
    const summary = renderCodexRuntimeCapsuleRestoreSummary(restoreReport);

    expect(restoreReport.status).toBe('skip');
    expect(restoreReport.reason_code).toBe('codex_runtime_capsule_restore_credentials_unavailable');
    expect(summary.split('\n')[0]).toBe('SKIP codex_runtime_capsule_restore_credentials_unavailable');
    expect(JSON.stringify(restoreReport)).not.toContain('thread-raw');
    expect(JSON.stringify(restoreReport)).not.toContain('auth.json');
    expect(JSON.stringify(restoreReport)).not.toContain('config.toml');
  });

  it('blocks product-safely with discovery blocker codes only', async () => {
    const restoreReport = await runCodexRuntimeCapsuleRestoreDogfood({
      mode: 'fake',
      credentialsAvailable: async () => true,
      discoveryReport: async () => ({
        ...reportFixture(),
        status: 'blocked',
        blocker_codes: ['codex_runtime_capsule_discovery_locator_repair_manifest_missing'],
      }),
    });
    const serialized = JSON.stringify(restoreReport);
    const summary = renderCodexRuntimeCapsuleRestoreSummary(restoreReport);

    expect(restoreReport).toEqual({
      schema_version: 'codex_runtime_capsule_restore_report.v1',
      status: 'blocked',
      blocker_codes: ['codex_runtime_capsule_discovery_locator_repair_manifest_missing'],
    });
    expect(summary).toContain('BLOCKED codex_runtime_capsule_discovery_locator_repair_manifest_missing');
    expect(serialized).not.toContain('thread-raw');
    expect(serialized).not.toContain('artifact://internal/');
    expect(serialized).not.toContain('auth.json');
    expect(serialized).not.toContain('config.toml');
  });

  it('passes fake cross-worker restore and writes the product-safe report', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'forgeloop-capsule-restore-test-'));
    const reportPath = join(tempDir, 'codex-runtime-capsule-restore-report.json');
    try {
      const restoreReport = await runCodexRuntimeCapsuleRestoreDogfood({
        mode: 'fake',
        credentialsAvailable: async () => true,
        discoveryReport: async () => ({
          ...reportFixture(),
          status: 'passed',
          blocker_codes: [],
        }),
      });
      await writeCodexRuntimeCapsuleRestoreReport(restoreReport, reportPath);

      expect(restoreReport.status).toBe('passed');
      expect(restoreReport.report_path).toBe(codexRuntimeCapsuleRestoreReportPath);
      expect(restoreReport.restore_checks).toMatchObject({
        thread_locator_digest_continuity: 'passed',
        memory_delta_replay: 'passed',
        environment_manifest_digest_continuity: 'passed',
        second_capsule_packaged: 'passed',
      });
      expect(restoreReport.orchestration_path).toBe('remote_worker_client');
      expect(restoreReport.orchestration_checks).toMatchObject({
        restore_before_app_server_start: 'passed',
        locator_repaired_before_resume: 'passed',
        resumed_without_thread_start: 'passed',
        packaged_before_terminalize: 'passed',
        terminal_result_capsule_fields: 'passed',
      });
      expect(restoreReport.terminal_result_digest).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(restoreReport.terminal_result_capsule_digest).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(restoreReport.memory_delta_replay_operation_counts).toMatchObject({ add: 0, delete: 1, rename: 1 });
      expect(restoreReport.memory_delta_operation_counts).toMatchObject({ add: 1, delete: 0, rename: 0 });
      const serialized = await readFile(reportPath, 'utf8');
      expect(serialized).toContain('"schema_version": "codex_runtime_capsule_restore_report.v1"');
      expect(serialized).not.toContain('thread-raw');
      expect(serialized).not.toContain('raw memory text');
      expect(serialized).not.toContain('artifact://internal/');
      expect(serialized).not.toContain('auth.json');
      expect(serialized).not.toContain('config.toml');
      expect(serialized).not.toContain('/Users/');
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it('uses a real restore scenario hook in real mode instead of returning an unavailable blocker', async () => {
    const restoreReport = await runCodexRuntimeCapsuleRestoreDogfood({
      mode: 'real',
      credentialsAvailable: async () => true,
      discoveryReport: async () => ({
        ...reportFixture(),
        status: 'passed',
        blocker_codes: [],
      }),
      executeRestoreScenario: async ({ discoveryReport }) => ({
        scenario_kind: 'real_cross_worker_restore',
        discovery_report_digest: `sha256:${'1'.repeat(64)}`,
        codex_cli_version_digest: discoveryReport.codex_cli_version_digest,
        app_server_protocol_digest: discoveryReport.app_server_protocol_digest,
        worker_root_count: 2,
        restore_checks: {
          thread_locator_digest_continuity: 'passed',
          memory_output_input_digest_continuity: 'passed',
          memory_delta_replay: 'passed',
          environment_manifest_digest_continuity: 'passed',
          second_capsule_packaged: 'passed',
        },
        orchestration_path: 'remote_worker_client',
        orchestration_checks: {
          restore_before_app_server_start: 'passed',
          locator_repaired_before_resume: 'passed',
          resumed_without_thread_start: 'passed',
          packaged_before_terminalize: 'passed',
          terminal_result_capsule_fields: 'passed',
        },
        terminal_result_digest: `sha256:${'7'.repeat(64)}`,
        terminal_result_capsule_digest: `sha256:${'8'.repeat(64)}`,
        memory_delta_replay_operation_counts: { add: 0, modify: 0, delete: 1, rename: 1 },
        memory_delta_operation_counts: { add: 1, modify: 0, delete: 0, rename: 0 },
        memory_input_digest: `sha256:${'2'.repeat(64)}`,
        memory_output_digest: `sha256:${'3'.repeat(64)}`,
        resumed_memory_input_digest: `sha256:${'3'.repeat(64)}`,
        environment_manifest_digest: `sha256:${'4'.repeat(64)}`,
        first_capsule_digest: `sha256:${'5'.repeat(64)}`,
        second_capsule_digest: `sha256:${'6'.repeat(64)}`,
        package_sequence_count: 2,
        public_safety: {
          raw_runtime_material: 'excluded',
          report_value_policy: 'digests_status_codes_only',
        },
      }),
    });

    expect(restoreReport.status).toBe('passed');
    expect(restoreReport.scenario_kind).toBe('real_cross_worker_restore');
    expect(JSON.stringify(restoreReport)).not.toContain('codex_runtime_capsule_restore_real_probe_unavailable');
  });
});

const reportFixture = (): CodexRuntimeCapsuleDiscoveryReport => ({
  schema_version: 'codex_runtime_capsule_discovery_report.v1',
  status: 'passed',
  codex_cli_version_digest: `sha256:${'c'.repeat(64)}`,
  app_server_protocol_digest: `sha256:${'d'.repeat(64)}`,
  path_mutation_counts: {
    thread_state_allowed: 1,
    memory_state_allowed: 1,
    environment_component: 1,
    generated_environment: 0,
    forbidden: 0,
    forbidden_whole_db: 0,
    unknown: 0,
  },
  observed_mutation_count: 3,
  blocker_codes: [],
});
