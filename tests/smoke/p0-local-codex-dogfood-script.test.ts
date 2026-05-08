import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  buildBoundedLocalCodexRunPackage,
  buildCodexExecFallbackCommand,
  buildSourceGuardInjectionPlan,
  evaluateLocalCodexDogfoodEnablement,
  parseDirtySourceFiles,
  preflightLocalCodexDogfood,
  recordLiveEventObservation,
  renderLocalCodexDogfoodReport,
  selectCodexExecutionMode,
  validateLocalCodexRuntimeMetadata,
  validateTerminalEvidence,
} from '../../scripts/p0-local-codex-dogfood';

describe('p0 local Codex dogfood script helpers', () => {
  it('documents disabled-by-default behavior with a clear skipped status and neutral exit code', () => {
    expect(evaluateLocalCodexDogfoodEnablement({})).toEqual({
      enabled: false,
      exitCode: 0,
      status: 'skipped',
      message: 'Real local Codex dogfood disabled; set FORGELOOP_ENABLE_REAL_CODEX_DOGFOOD=1 to run.',
    });
  });

  it('preflight requires the Codex command and authenticated runtime', async () => {
    const missingCodex = await preflightLocalCodexDogfood({
      env: { FORGELOOP_ENABLE_REAL_CODEX_DOGFOOD: '1' },
      repoPath: '/repo',
      runCommand: async (command) => {
        if (command === 'git') {
          return { stdout: '', stderr: '' };
        }
        throw new Error('missing command');
      },
    });

    expect(missingCodex).toMatchObject({
      ok: false,
      message: 'Missing required command: codex',
    });

    const unavailableRuntime = await preflightLocalCodexDogfood({
      env: { FORGELOOP_ENABLE_REAL_CODEX_DOGFOOD: '1' },
      repoPath: '/repo',
      runCommand: async (command, args) => {
        if (command === 'git') {
          return { stdout: '', stderr: '' };
        }
        if (command === 'codex' && args[0] === '--version') {
          return { stdout: 'codex 1.0.0', stderr: '' };
        }
        throw new Error('not logged in');
      },
    });

    expect(unavailableRuntime).toMatchObject({
      ok: false,
      message: 'Codex runtime is not authenticated or ready for local execution',
    });
  });

  it('preflight refuses dirty source checkouts unless the dirty override is set', async () => {
    const result = await preflightLocalCodexDogfood({
      env: { FORGELOOP_ENABLE_REAL_CODEX_DOGFOOD: '1' },
      repoPath: '/repo',
      runCommand: async (command, args) => {
        if (command === 'codex') {
          return { stdout: 'ok', stderr: '' };
        }
        if (command === 'git' && args[0] === 'status') {
          return { stdout: ' M README.md\n', stderr: '' };
        }
        return { stdout: '', stderr: '' };
      },
    });

    expect(result).toMatchObject({
      ok: false,
      message: 'Source checkout is dirty; set FORGELOOP_LOCAL_CODEX_DOGFOOD_ALLOW_DIRTY=1 only for Task 5 files.',
      dirtyFiles: ['README.md'],
    });
  });

  it('accepts dirty override only for the Task 5 file set and records the exact file list', async () => {
    const accepted = await preflightLocalCodexDogfood({
      env: {
        FORGELOOP_ENABLE_REAL_CODEX_DOGFOOD: '1',
        FORGELOOP_LOCAL_CODEX_DOGFOOD_ALLOW_DIRTY: '1',
      },
      repoPath: '/repo',
      runCommand: async (command, args) => {
        if (command === 'codex') {
          return { stdout: 'ok', stderr: '' };
        }
        if (command === 'git' && args[0] === 'status') {
          return { stdout: ' M README.md\n?? scripts/p0-local-codex-dogfood.ts\n', stderr: '' };
        }
        return { stdout: '', stderr: '' };
      },
    });

    expect(accepted).toMatchObject({
      ok: true,
      dirtyOverride: {
        allowed: true,
        dirtyFiles: ['README.md', 'scripts/p0-local-codex-dogfood.ts'],
      },
    });
    expect(
      renderLocalCodexDogfoodReport({
        status: 'SKIPPED',
        preflight: accepted,
        runtimeMetadata: {},
        terminalEvidence: undefined,
        liveEvents: [],
        sourceGuardInjection: undefined,
      }),
    ).toContain('- Dirty override: ENABLED for README.md, scripts/p0-local-codex-dogfood.ts');

    const refused = await preflightLocalCodexDogfood({
      env: {
        FORGELOOP_ENABLE_REAL_CODEX_DOGFOOD: '1',
        FORGELOOP_LOCAL_CODEX_DOGFOOD_ALLOW_DIRTY: '1',
      },
      repoPath: '/repo',
      runCommand: async (command, args) => {
        if (command === 'codex') {
          return { stdout: 'ok', stderr: '' };
        }
        if (command === 'git' && args[0] === 'status') {
          return { stdout: ' M packages/domain/src/types.ts\n', stderr: '' };
        }
        return { stdout: '', stderr: '' };
      },
    });

    expect(refused).toMatchObject({
      ok: false,
      unexpectedDirtyFiles: ['packages/domain/src/types.ts'],
    });
  });

  it('parses porcelain dirty paths including renames', () => {
    expect(parseDirtySourceFiles(' M README.md\n?? scripts/p0-local-codex-dogfood.ts\nR  old.ts -> package.json\n')).toEqual([
      'README.md',
      'scripts/p0-local-codex-dogfood.ts',
      'old.ts',
      'package.json',
    ]);
  });

  it('builds the Codex exec fallback command with JSON and dangerous bypass flags', () => {
    expect(buildCodexExecFallbackCommand('Do the task')).toEqual({
      command: 'codex',
      args: ['exec', '--json', '--dangerously-bypass-approvals-and-sandbox', 'Do the task'],
    });
  });

  it('builds a bounded local_codex package', () => {
    expect(buildBoundedLocalCodexRunPackage({ repoPath: '/repo', baseCommitSha: 'abc123' })).toMatchObject({
      executor_type: 'local_codex',
      workflow_only: false,
      repo: {
        local_path: '/repo',
        base_commit_sha: 'abc123',
      },
      allowed_paths: ['README.md'],
      forbidden_paths: ['.git', '.env', 'node_modules'],
    });
  });

  it('validates runtime metadata assertions for local_codex, worktree path, app-server attempt, and dangerous mode', () => {
    expect(() =>
      validateLocalCodexRuntimeMetadata({
        executor_type: 'local_codex',
        runtime_metadata: {
          workspace_path: '/repo/.worktrees/run-1',
          app_server_attempted: true,
          selected_execution_mode: 'exec_fallback',
          effective_dangerous_mode: 'confirmed',
          exec_fallback_dangerous_bypass: true,
          app_server_fallback_reason: 'connection refused',
        },
      }),
    ).not.toThrow();

    expect(() =>
      validateLocalCodexRuntimeMetadata({
        executor_type: 'mock',
        runtime_metadata: {
          workspace_path: '/repo',
          app_server_attempted: false,
          selected_execution_mode: 'exec_fallback',
          effective_dangerous_mode: 'not_requested',
        },
      }),
    ).toThrow(/executor_type local_codex/);
  });

  it('attempts app-server before exec fallback and records the fallback reason', async () => {
    const calls: string[] = [];
    const selected = await selectCodexExecutionMode({
      attemptAppServer: async () => {
        calls.push('app-server');
        return { ok: false, reason: 'connection refused' };
      },
      buildExecFallback: () => {
        calls.push('exec-fallback');
        return buildCodexExecFallbackCommand('Do the task');
      },
    });

    expect(calls).toEqual(['app-server', 'exec-fallback']);
    expect(selected).toMatchObject({
      mode: 'exec_fallback',
      appServerAttempted: true,
      fallbackReason: 'connection refused',
      execFallbackCommand: {
        args: ['exec', '--json', '--dangerously-bypass-approvals-and-sandbox', 'Do the task'],
      },
    });
  });

  it('requires public live events before terminal state, not only after polling completion', () => {
    const observed = recordLiveEventObservation([
      { event_type: 'worker_lease_acquired', visibility: 'internal', status: 'running' },
      { event_type: 'turn_started', visibility: 'public', status: 'running' },
      { event_type: 'executor_succeeded', visibility: 'public', status: 'succeeded' },
    ]);

    expect(observed).toMatchObject({
      sawPublicPreTerminalEvent: true,
      preTerminalPublicEvents: ['turn_started'],
      terminalEventType: 'executor_succeeded',
    });

    expect(() =>
      recordLiveEventObservation([{ event_type: 'executor_succeeded', visibility: 'public', status: 'succeeded' }]),
    ).toThrow(/public non-terminal live event/);
  });

  it('validates terminal evidence includes changed files, checks, artifacts, and Review Packet path', () => {
    expect(() =>
      validateTerminalEvidence({
        changed_files: [{ repo_id: 'repo-1', path: 'README.md', change_kind: 'modified' }],
        check_results: [{ check_id: 'dogfood-required', status: 'succeeded' }],
        artifacts: [{ kind: 'diff', local_ref: 'artifacts/diff.patch' }],
        review_packet: { id: 'review-packet-1', artifact_path: 'artifacts/review-packet.md' },
      }),
    ).not.toThrow();

    expect(() =>
      validateTerminalEvidence({
        changed_files: [],
        check_results: [],
        artifacts: [],
      }),
    ).toThrow(/changed files/);
  });

  it('plans a harmless source-checkout mutation and cleanup path', async () => {
    const repoPath = await mkdtemp(join(tmpdir(), 'forgeloop-source-guard-plan-'));

    try {
      const plan = buildSourceGuardInjectionPlan(repoPath);
      await plan.inject();
      expect(await readFile(plan.mutationPath, 'utf8')).toContain('forgeloop dogfood source guard probe');
      await plan.cleanup();
      await expect(readFile(plan.mutationPath, 'utf8')).rejects.toThrow();
      expect(plan.relativePath).toBe('.forgeloop/dogfood-source-guard-probe.txt');
    } finally {
      await rm(repoPath, { recursive: true, force: true });
    }
  });
});
