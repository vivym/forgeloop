import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

import {
  buildBoundedLocalCodexRunPackage,
  buildCodexExecFallbackCommand,
  buildSourceGuardInjectionPlan,
  evaluateLocalCodexDogfoodEnablement,
  extractPersistedTerminalEvidence,
  parseDirtySourceFiles,
  preflightLocalCodexDogfood,
  recordLiveEventObservation,
  renderLocalCodexDogfoodReport,
  resolveReviewPacketReference,
  runSourceGuardInjection,
  runSessionRuntimeMetadataReport,
  selectCodexExecutionMode,
  validateLocalCodexRuntimeMetadata,
  validateTerminalEvidence,
} from '../../scripts/p0-local-codex-dogfood';

const execFile = promisify(execFileCallback);

const execGit = async (cwd: string, args: readonly string[]): Promise<string> => {
  const { stdout } = await execFile('git', [...args], { cwd });
  return String(stdout);
};

const createGitRepo = async (): Promise<{ repo: string; head: string }> => {
  const repo = await mkdtemp(join(tmpdir(), 'forgeloop-local-codex-dogfood-'));
  await execGit(repo, ['init', '-b', 'main']);
  await execGit(repo, ['config', 'user.email', 'test@example.com']);
  await execGit(repo, ['config', 'user.name', 'Test User']);
  await writeFile(join(repo, 'README.md'), '# Test Repo\n');
  await execGit(repo, ['add', '.']);
  await execGit(repo, ['commit', '-m', 'initial']);
  return { repo, head: (await execGit(repo, ['rev-parse', 'HEAD'])).trim() };
};

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
          return {
            stdout:
              ' M README.md\n?? scripts/p0-local-codex-dogfood.ts\n M packages/executor/src/local-codex-executor.ts\n M tests/executor/local-codex-preflight.test.ts\n',
            stderr: '',
          };
        }
        return { stdout: '', stderr: '' };
      },
    });

    expect(accepted).toMatchObject({
      ok: true,
      dirtyOverride: {
        allowed: true,
        dirtyFiles: [
          'README.md',
          'scripts/p0-local-codex-dogfood.ts',
          'packages/executor/src/local-codex-executor.ts',
          'tests/executor/local-codex-preflight.test.ts',
        ],
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
    ).toContain(
      '- Dirty override: ENABLED for README.md, scripts/p0-local-codex-dogfood.ts, packages/executor/src/local-codex-executor.ts, tests/executor/local-codex-preflight.test.ts',
    );

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
          return { stdout: ' M packages/workflow/src/activities.ts\n', stderr: '' };
        }
        return { stdout: '', stderr: '' };
      },
    });

    expect(refused).toMatchObject({
      ok: false,
      unexpectedDirtyFiles: ['packages/workflow/src/activities.ts'],
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
    const validateWithRunSession = validateLocalCodexRuntimeMetadata as (
      input: Parameters<typeof validateLocalCodexRuntimeMetadata>[0],
      options?: { expectedRunSessionId: string },
    ) => void;

    expect(() =>
      validateLocalCodexRuntimeMetadata(
        runSessionRuntimeMetadataReport({
          executor_type: 'local_codex',
          runtime_metadata: {
            workspace_path: '/repo/.worktrees/run-1',
            effective_dangerous_mode: 'confirmed',
          },
        }),
      ),
    ).toThrow(/app_server_attempted/);

    expect(() =>
      validateWithRunSession(
        runSessionRuntimeMetadataReport({
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
        { expectedRunSessionId: 'run-1' },
      ),
    ).not.toThrow();

    expect(() =>
      validateWithRunSession(
        runSessionRuntimeMetadataReport({
          executor_type: 'local_codex',
          runtime_metadata: {
            workspace_path: '/repo/.worktrees/local-codex-dogfood-123',
            app_server_attempted: true,
            selected_execution_mode: 'app_server',
            effective_dangerous_mode: 'confirmed',
          },
        }),
        { expectedRunSessionId: 'run-session-1' },
      ),
    ).toThrow(/run-session-id worktree/);

    expect(() =>
      validateWithRunSession(
        runSessionRuntimeMetadataReport({
          executor_type: 'local_codex',
          runtime_metadata: {
            workspace_path: '/repo/.worktrees/run-1',
            app_server_attempted: true,
            selected_execution_mode: 'app_server',
          },
        }),
        { expectedRunSessionId: 'run-1' },
      ),
    ).toThrow(/dangerous mode/);

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

  it('requires public live events observed while the run is non-terminal, not only after polling completion', () => {
    const observed = recordLiveEventObservation([
      { event_type: 'worker_lease_acquired', visibility: 'internal', runStatusAtObservation: 'running' },
      { event_type: 'turn_started', visibility: 'public', runStatusAtObservation: 'running' },
      { event_type: 'executor_succeeded', visibility: 'public', status: 'succeeded' },
    ]);

    expect(observed).toMatchObject({
      sawPublicPreTerminalEvent: true,
      preTerminalPublicEvents: ['turn_started'],
      terminalEventType: 'executor_succeeded',
    });

    expect(() =>
      recordLiveEventObservation([
        { event_type: 'turn_started', visibility: 'public' },
        { event_type: 'executor_succeeded', visibility: 'public', status: 'succeeded' },
      ]),
    ).toThrow(/public non-terminal live event/);

    expect(() =>
      recordLiveEventObservation([
        { event_type: 'run_queued', visibility: 'public', runStatusAtObservation: 'queued' },
        { event_type: 'executor_succeeded', visibility: 'public', status: 'succeeded' },
      ]),
    ).toThrow(/Codex live progress/);
  });

  it('validates persisted terminal evidence includes changed files, checks, artifacts, and Review Packet path', () => {
    expect(() =>
      extractPersistedTerminalEvidence({
        runSession: {
          changed_files: [],
          check_results: [],
          artifacts: [],
        },
        reviewPacket: { id: 'review-packet-1', path: 'http://api.local/review-packets/review-packet-1' },
      }),
    ).toThrow(/changed files/);

    expect(
      extractPersistedTerminalEvidence({
        runSession: {
          changed_files: [{ repo_id: 'repo-1', path: 'README.md', change_kind: 'modified' }],
          check_results: [{ check_id: 'dogfood-required', status: 'succeeded' }],
          artifacts: [{ kind: 'diff', local_ref: 'artifacts/diff.patch' }],
        },
        reviewPacket: { id: 'review-packet-1', path: 'http://api.local/review-packets/review-packet-1' },
      }),
    ).toMatchObject({
      review_packet: { artifact_path: 'http://api.local/review-packets/review-packet-1' },
    });

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

  it('resolves Review Packet references only from persisted artifacts or cockpit state', () => {
    expect(
      resolveReviewPacketReference({
        apiUrl: 'http://api.local',
        runSession: {
          artifacts: [{ kind: 'review_packet', name: 'review-packet.md', local_ref: 'artifacts/review-packet.md' }],
        },
      }),
    ).toEqual({ id: 'review-packet.md', path: 'artifacts/review-packet.md' });

    expect(
      resolveReviewPacketReference({
        apiUrl: 'http://api.local',
        runSession: { artifacts: [] },
        cockpit: { review_packets: [{ id: 'review-packet:run-session-1' }] },
      }),
    ).toEqual({
      id: 'review-packet:run-session-1',
      path: 'http://api.local/review-packets/review-packet%3Arun-session-1',
    });

    expect(resolveReviewPacketReference({ apiUrl: 'http://api.local', runSession: { artifacts: [] } })).toBeUndefined();
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

  it('runs source guard injection through local Codex evidence capture and cleans up the source checkout', async () => {
    const { repo, head } = await createGitRepo();

    try {
      const result = await runSourceGuardInjection({
        repoPath: repo,
        baseCommitSha: head,
        runCommand: async (command, args, options = {}) => {
          const { stdout, stderr } = await execFile(command, args, {
            cwd: options.cwd,
            env: options.env,
            timeout: options.timeoutMs,
            maxBuffer: 1024 * 1024 * 10,
          });
          return { stdout: String(stdout), stderr: String(stderr) };
        },
      });

      expect(result).toMatchObject({
        relativePath: '.forgeloop/dogfood-source-guard-probe.txt',
        cleanedUp: true,
        failureKind: 'path_violation',
      });
      expect(await execGit(repo, ['status', '--porcelain', '--untracked-files=all'])).not.toContain(
        '.forgeloop/dogfood-source-guard-probe.txt',
      );
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });
});
