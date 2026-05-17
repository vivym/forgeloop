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
  startApi,
  validateLocalCodexRuntimeMetadata,
  validateTerminalEvidence,
} from '../../scripts/delivery-local-codex-dogfood';

const execFile = promisify(execFileCallback);

const execGit = async (cwd: string, args: readonly string[]): Promise<string> => {
  const { stdout } = await execFile('git', [...args], { cwd });
  return String(stdout);
};

const strictReadyEnv = {
  FORGELOOP_ENABLE_REAL_CODEX_DOGFOOD: '1',
  FORGELOOP_LOCAL_CODEX_DOGFOOD_CONFIRM_DANGEROUS_MODE: '1',
};

type DogfoodRunCommand = NonNullable<Parameters<typeof preflightLocalCodexDogfood>[0]['runCommand']>;

const successfulStrictPreflightCommand: DogfoodRunCommand = async (
  command,
  args,
) => {
  if (command === 'codex') {
    return { stdout: 'ok', stderr: '' };
  }
  if (command === 'git' && args[0] === 'status') {
    return { stdout: '', stderr: '' };
  }
  if (command === 'git' && args[0] === 'rev-parse') {
    return { stdout: 'abc123\n', stderr: '' };
  }
  if (command === 'git' && args[0] === 'worktree') {
    return { stdout: '', stderr: '' };
  }
  if (command === 'pnpm' && args[0] === 'db:push') {
    return { stdout: 'schema pushed\n', stderr: '' };
  }

  return { stdout: '', stderr: '' };
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

describe('delivery local Codex dogfood script helpers', () => {
  it('documents disabled-by-default behavior with a clear skipped status and neutral exit code', () => {
    expect(evaluateLocalCodexDogfoodEnablement({})).toEqual({
      enabled: false,
      exitCode: 0,
      status: 'skipped',
      message: 'Real local Codex dogfood disabled; set FORGELOOP_ENABLE_REAL_CODEX_DOGFOOD=1 to run.',
    });
  });

  it('preflight reports strict blocker codes for missing Codex and unauthenticated runtime', async () => {
    const missingCodex = await preflightLocalCodexDogfood({
      env: strictReadyEnv,
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
      blockers: [{ code: 'missing_codex_command' }],
    });

    const unavailableRuntime = await preflightLocalCodexDogfood({
      env: strictReadyEnv,
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
      blockers: [{ code: 'codex_not_authenticated' }],
    });
  });

  it('preflight reports strict blockers for unconfirmed dangerous mode, dirty source, durable repo, and worktree creation', async () => {
    const dangerousModeCalls: Array<{ command: string; args: string[] }> = [];
    await expect(
      preflightLocalCodexDogfood({
        env: {
          FORGELOOP_ENABLE_REAL_CODEX_DOGFOOD: '1',
          FORGELOOP_DATABASE_URL: 'postgresql://localhost:5432/forgeloop',
        },
        repoPath: '/repo',
        runCommand: async (command, args) => {
          dangerousModeCalls.push({ command, args });

          return successfulStrictPreflightCommand(command, args);
        },
      }),
    ).resolves.toMatchObject({
      ok: false,
      blockers: [{ code: 'dangerous_mode_unconfirmed' }],
    });
    expect(dangerousModeCalls).not.toContainEqual({ command: 'pnpm', args: ['db:push'] });
    expect(dangerousModeCalls.some((call) => call.command === 'git' && call.args[0] === 'worktree')).toBe(false);

    const sourceDirtyCalls: Array<{ command: string; args: string[] }> = [];
    await expect(
      preflightLocalCodexDogfood({
        env: { ...strictReadyEnv, FORGELOOP_DATABASE_URL: 'postgresql://localhost:5432/forgeloop' },
        repoPath: '/repo',
        runCommand: async (command, args) => {
          sourceDirtyCalls.push({ command, args });
          if (command === 'git' && args[0] === 'status') {
            return { stdout: ' M README.md\n?? .worktrees/run-session/README.md\n', stderr: '' };
          }

          return successfulStrictPreflightCommand(command, args);
        },
      }),
    ).resolves.toMatchObject({
      ok: false,
      blockers: [
        {
          code: 'source_dirty_blocked',
          details: {
            allowed_dirty_entries: [],
            blocked_dirty_entries: ['README.md'],
            dirty_allowlist_source: 'STRICT_LOCAL_CODEX_DOGFOOD_DIRTY_ALLOWLIST',
          },
        },
      ],
    });
    expect(sourceDirtyCalls).not.toContainEqual({ command: 'pnpm', args: ['db:push'] });
    expect(sourceDirtyCalls.some((call) => call.command === 'git' && call.args[0] === 'worktree')).toBe(false);

    await expect(
      preflightLocalCodexDogfood({
        env: { ...strictReadyEnv, FORGELOOP_DATABASE_URL: 'postgresql://localhost:5432/forgeloop' },
        repoPath: '/repo',
        runCommand: async (command, args) => {
          if (command === 'pnpm' && args[0] === 'db:push') {
            throw new Error('database unavailable');
          }

          return successfulStrictPreflightCommand(command, args);
        },
      }),
    ).resolves.toMatchObject({
      ok: false,
      blockers: [{ code: 'durable_repo_unavailable' }],
    });

    await expect(
      preflightLocalCodexDogfood({
        env: strictReadyEnv,
        repoPath: '/repo',
        runCommand: async (command, args) => {
          if (command === 'git' && args[0] === 'worktree' && args[1] === 'add') {
            throw new Error('worktree add failed');
          }

          return successfulStrictPreflightCommand(command, args);
        },
      }),
    ).resolves.toMatchObject({
      ok: false,
      blockers: [{ code: 'worktree_create_failed' }],
    });
  });

  it('preflight refuses dirty source checkouts unless the strict dogfood dirty allowlist matches', async () => {
    const result = await preflightLocalCodexDogfood({
      env: strictReadyEnv,
      repoPath: '/repo',
      runCommand: async (command, args) => {
        if (command === 'git' && args[0] === 'status') {
          return { stdout: ' M README.md\n', stderr: '' };
        }

        return successfulStrictPreflightCommand(command, args);
      },
    });

    expect(result).toMatchObject({
      ok: false,
      blockers: [
        {
          code: 'source_dirty_blocked',
          details: {
            allowed_dirty_entries: [],
            blocked_dirty_entries: ['README.md'],
          },
        },
      ],
    });

    const accepted = await preflightLocalCodexDogfood({
      env: strictReadyEnv,
      repoPath: '/repo',
      runCommand: async (command, args) => {
        if (command === 'git' && args[0] === 'status') {
          return {
            stdout:
              ' M docs/superpowers/reports/delivery-dogfood-work-items-completion.md\n?? .superpowers/state.json\n?? .worktrees/run-session/README.md\n',
            stderr: '',
          };
        }

        return successfulStrictPreflightCommand(command, args);
      },
    });

    expect(accepted).toMatchObject({
      ok: true,
      dirtySource: {
        allowed_dirty_entries: [
          'docs/superpowers/reports/delivery-dogfood-work-items-completion.md',
          '.superpowers/state.json',
        ],
        blocked_dirty_entries: [],
        dirty_allowlist_source: 'STRICT_LOCAL_CODEX_DOGFOOD_DIRTY_ALLOWLIST',
      },
    });
    expect(accepted).not.toHaveProperty('dirtyOverride');
    expect(
      renderLocalCodexDogfoodReport({
        status: 'SKIPPED',
        preflight: accepted,
        runtimeMetadata: {},
        terminalEvidence: undefined,
        liveEvents: [],
        sourceGuardInjection: undefined,
      }),
    ).toContain('- Dirty override: not used');

    const quotedAccepted = await preflightLocalCodexDogfood({
      env: strictReadyEnv,
      repoPath: '/repo',
      runCommand: async (command, args) => {
        if (command === 'git' && args[0] === 'status') {
          return {
            stdout:
              '?? ".superpowers/state file.json"\n?? ".worktrees/run session/README.md"\n',
            stderr: '',
          };
        }

        return successfulStrictPreflightCommand(command, args);
      },
    });

    expect(quotedAccepted).toMatchObject({
      ok: true,
      dirtySource: {
        allowed_dirty_entries: ['.superpowers/state file.json'],
        blocked_dirty_entries: [],
      },
    });

    const nearMisses = await preflightLocalCodexDogfood({
      env: strictReadyEnv,
      repoPath: '/repo',
      runCommand: async (command, args) => {
        if (command === 'git' && args[0] === 'status') {
          return {
            stdout: '?? " .superpowers/file"\n?? ".superpowers/file "\n',
            stderr: '',
          };
        }

        return successfulStrictPreflightCommand(command, args);
      },
    });

    expect(nearMisses).toMatchObject({
      ok: false,
      blockers: [
        {
          code: 'source_dirty_blocked',
          details: {
            allowed_dirty_entries: [],
            blocked_dirty_entries: [' .superpowers/file', '.superpowers/file '],
          },
        },
      ],
    });

    const refused = await preflightLocalCodexDogfood({
      env: {
        ...strictReadyEnv,
        FORGELOOP_LOCAL_CODEX_DOGFOOD_ALLOW_DIRTY: '1',
      },
      repoPath: '/repo',
      runCommand: async (command, args) => {
        if (command === 'git' && args[0] === 'status') {
          return { stdout: ' M packages/workflow/src/activities.ts\n', stderr: '' };
        }

        return successfulStrictPreflightCommand(command, args);
      },
    });

    expect(refused).toMatchObject({
      ok: false,
      blockers: [
        {
          code: 'source_dirty_blocked',
          details: {
            blocked_dirty_entries: ['packages/workflow/src/activities.ts'],
          },
        },
      ],
    });
    expect(
      renderLocalCodexDogfoodReport({
        status: 'FAIL',
        preflight: refused,
        error: 'strict preflight failed',
      }),
    ).toContain('- Strict preflight blocker: source_dirty_blocked');
  });

  it('parses porcelain dirty paths including renames while ignoring .worktrees', () => {
    expect(
      parseDirtySourceFiles(
        ' M README.md\n?? scripts/delivery-local-codex-dogfood.ts\nR  old.ts -> package.json\n?? .worktrees/run-session/README.md\n?? ".worktrees/run session/README.md"\n?? ".superpowers/state file.json"\n',
      ),
    ).toEqual([
      'README.md',
      'scripts/delivery-local-codex-dogfood.ts',
      'old.ts',
      'package.json',
      '.superpowers/state file.json',
    ]);
    expect(parseDirtySourceFiles('?? "a -> b.txt"\n?? ".worktrees/run -> session/README.md"\n')).toEqual([
      'a -> b.txt',
    ]);
    expect(parseDirtySourceFiles('?? ".worktrees "\n?? " .worktrees"\n?? " "\n')).toEqual([
      '.worktrees ',
      ' .worktrees',
      ' ',
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

  it('renders delivery local Codex reports without raw workspace paths or runtime metadata keys', () => {
    const report = renderLocalCodexDogfoodReport({
      status: 'PASS',
      runtimeMetadata: {
        workspace_path: '/Users/viv/projs/forgeloop/.worktrees/run-1',
        app_server_attempted: true,
        selected_execution_mode: 'exec_fallback',
        effective_dangerous_mode: 'confirmed',
      },
      terminalEvidence: {
        changed_files: [{ path: 'README.md' }],
        check_results: [{ check_id: 'dogfood-required' }],
        artifacts: [
          { kind: 'diff', local_ref: '/tmp/forgeloop-executor-artifacts/diff.patch' },
          { kind: 'review_packet', local_ref: '/tmp/forgeloop-executor-artifacts/review.md' },
        ],
        review_packet: {
          id: 'review-packet-1',
          artifact_path: '/tmp/forgeloop-executor-artifacts/review.md',
        },
      },
    });

    expect(report).toContain('- Runtime metadata: app_server_attempted=true selected_execution_mode=exec_fallback effective_dangerous_mode=confirmed');
    expect(report).toContain('- Artifacts: diff, review_packet');
    expect(report).toContain('- Review Packet: available');
    expect(report).not.toContain('workspace_path');
    expect(report).not.toContain('/Users/');
    expect(report).not.toContain('/tmp/');
    expect(report).not.toContain('local_ref');
    expect(report).not.toContain('artifact_path');
  });

  it('sanitizes delivery local Codex failure errors and blocker details in reports', () => {
    const report = renderLocalCodexDogfoodReport({
      status: 'FAIL',
      preflight: {
        ok: false,
        blockers: [
          {
            code: 'worktree_create_failed',
            message: 'Unable to create isolated local Codex worktree',
            details: {
              workspace_path: '/Users/viv/projs/forgeloop/.worktrees/run-1',
              artifact_path: '/tmp/forgeloop-executor-artifacts/review.md',
              runtime_metadata: { workspace_path: '/Users/viv/projs/forgeloop/.worktrees/run-1' },
              safe_hint: 'retry after cleaning dogfood state',
            },
          },
        ],
        message: 'blocked',
        repoPath: '/Users/viv/projs/forgeloop',
      },
      error: 'runtime_metadata artifact_path workspace_path leaked without absolute path',
    });

    expect(report).toContain('safe_hint');
    expect(report).toContain('redacted_detail_count');
    expect(report).not.toContain('/Users/');
    expect(report).not.toContain('/tmp/');
    expect(report).not.toContain('workspace_path');
    expect(report).not.toContain('runtime_metadata');
    expect(report).not.toContain('artifact_path');
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

  it('starts the dogfood API with query routes registered', async () => {
    const api = await startApi();
    try {
      const missingRelease = await fetch(`${api.apiUrl}/query/replay/release/missing-release`);

      expect(missingRelease.status).toBe(404);

      const unsupported = await fetch(`${api.apiUrl}/query/replay/unsupported/missing`);
      expect(unsupported.status).toBe(400);
      await expect(unsupported.json()).resolves.toMatchObject({
        message: expect.stringContaining('Unsupported replay object type'),
      });
    } finally {
      await api.close();
    }
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
  }, 15_000);
});
