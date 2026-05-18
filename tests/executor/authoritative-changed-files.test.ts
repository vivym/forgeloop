import { realpathSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  PathSafety,
  deriveAuthoritativeChangedFiles,
  resourceLimitDigest,
  structuredCommandDigest,
  type MaterializedStructuredCommand,
  type ResourceGovernor,
  type ResourceGovernorReadiness,
  type ResourceGovernorRunInput,
  type RuntimeSafetyAttestation,
  type SandboxLeaseInput,
  type StructuredCommandResult,
  type TrustedToolchainConfig,
} from '../../packages/executor/src/index';
import type { RunSpec } from '../../packages/contracts/src/executor';

const sha = 'sha256:0000000000000000000000000000000000000000000000000000000000000000';
const shellPath = realpathSync('/bin/sh');
const shellRoot = dirname(shellPath);
const tempRoots: string[] = [];

const resourceLimits = {
  cpu_ms: 1_000,
  memory_mb: 512,
  pids: 32,
  fds: 64,
  workspace_bytes: 1_048_576,
  artifact_bytes: 1_048_576,
  timeout_ms: 30_000,
  output_limit_bytes: 100_000,
  run_output_limit_bytes: 500_000,
};

class RecordingRunGovernor implements ResourceGovernor {
  readonly governorId = 'recording-run-governor';
  readonly provenance = 'test_only_mock' as const;
  readonly calls: ResourceGovernorRunInput[] = [];

  constructor(private readonly outputs: Array<{ stdout?: string; result?: Partial<StructuredCommandResult> }>) {}

  async checkReadiness(): Promise<ResourceGovernorReadiness> {
    return { status: 'ready', governor_id: this.governorId, provenance: this.provenance };
  }

  async createRunExecutionAttestation(): Promise<RuntimeSafetyAttestation> {
    throw new Error('not used');
  }

  async createRunLease(_input: SandboxLeaseInput) {
    throw new Error('not used');
  }

  async consumeLeaseCommandInvocation(): Promise<{ ok: true }> {
    return { ok: true };
  }

  async run(input: ResourceGovernorRunInput): Promise<StructuredCommandResult> {
    this.calls.push(input);
    const output = this.outputs.shift() ?? {};
    return {
      exit_code: 0,
      timed_out: false,
      stdout_ref: `stdout-${this.calls.length}`,
      stdout_truncated: false,
      stderr_truncated: false,
      visibility: 'internal',
      public_summary: 'recorded',
      ...(output.result ?? {}),
    };
  }
}

const makeTempDir = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'forgeloop-changed-files-'));
  tempRoots.push(dir);
  return dir;
};

const runSpec = (overrides: Partial<RunSpec> = {}): RunSpec => ({
  run_session_id: 'run-1',
  execution_package_id: 'package-1',
  work_item_id: 'work-item-1',
  spec_revision_id: 'spec-1',
  plan_revision_id: 'plan-1',
  executor_type: 'local_codex',
  repo: {
    repo_id: 'repo-1',
    local_path: '/repo/source',
    base_branch: 'main',
    base_commit_sha: 'base-commit',
  },
  objective: 'Implement task',
  context: {
    spec_revision_summary: 'Spec',
    plan_revision_summary: 'Plan',
    package_instructions: 'Do work',
    required_checks: [],
  },
  review_context: { latest_decision: 'none', requested_changes: [] },
  workflow_only: false,
  source_mutation_policy: 'path_policy_scoped',
  allowed_paths: ['src/**'],
  forbidden_paths: [],
  required_checks: [],
  artifact_policy: { requested_artifacts: ['changed_files'] },
  timeout_seconds: 3600,
  idempotency_key: 'run-1',
  ...overrides,
});

const trustedToolchains = (): TrustedToolchainConfig => ({
  root_paths: [shellRoot],
  executable_paths: { git: shellPath },
  path_entries: [shellRoot],
  writable: false,
});

const commandContext = () => {
  const limitsDigest = resourceLimitDigest(resourceLimits);
  return {
    runId: 'run-1',
    workspaceRoot: '/workspace/repo',
    artifactRoot: '/artifacts/run-1',
    sandboxOutputRoot: '/sandbox-output/run-1',
    policyDigest: sha,
    policySnapshotVersion: 1,
    envPolicyDigest: sha,
    commandPolicyDigest: sha,
    mountPolicyDigest: sha,
    networkPolicyDigest: 'network-disabled',
    resourceLimitDigest: limitsDigest,
    sandboxOutputRootPolicy: 'ephemeral_sandbox_output_only',
    artifactQuotaPolicy: 'sha256:artifact-quota',
    networkMode: 'disabled' as const,
    resourceLimits,
    trustedToolchains: trustedToolchains(),
    safeGitProfile: 'forgeloop_default' as const,
  };
};

const outputReader = (outputs: Record<string, string>) => async (ref: string) => outputs[ref] ?? '';

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('authoritative changed-file derivation', () => {
  it('derives tracked, renamed, untracked, ignored, mode-only, and submodule paths through run-governed NUL git commands', async () => {
    const repo = await makeTempDir();
    await mkdir(join(repo, 'worktree'), { recursive: true });
    const pathSafety = await PathSafety.create({ repoRoot: repo, worktreeRoot: join(repo, 'worktree') });
    const governor = new RecordingRunGovernor([{}, {}]);
    const diffOutput = ['M', 'src/modified.ts', 'R100', 'src/old.ts', 'src/new.ts', 'T', 'scripts/tool.sh', 'M', 'vendor/submodule', ''].join('\0');
    const statusOutput = ['? src/untracked.ts', '! build/ignored.log', ''].join('\0');

    const result = await deriveAuthoritativeChangedFiles({
      runSpec: runSpec(),
      workspaceRoot: '/workspace/repo',
      baseCommit: 'base-commit',
      runGovernor: governor,
      commandContext: commandContext(),
      pathSafety,
      readCommandOutputRef: outputReader({ 'stdout-1': diffOutput, 'stdout-2': statusOutput }),
    });

    expect(result).toMatchObject({
      ok: true,
      changedFiles: [
        { repo_id: 'repo-1', path: 'src/modified.ts', change_kind: 'modified' },
        { repo_id: 'repo-1', path: 'src/new.ts', change_kind: 'renamed', previous_path: 'src/old.ts' },
        { repo_id: 'repo-1', path: 'scripts/tool.sh', change_kind: 'modified' },
        { repo_id: 'repo-1', path: 'vendor/submodule', change_kind: 'modified' },
        { repo_id: 'repo-1', path: 'src/untracked.ts', change_kind: 'added' },
        { repo_id: 'repo-1', path: 'build/ignored.log', change_kind: 'added' },
      ],
    });
    expect(governor.calls).toHaveLength(2);
    expect(governor.calls.every((call) => call.scope === 'run')).toBe(true);
    expect(governor.calls.every((call) => call.scope === 'run' && call.bindings.safeGitProfile === 'forgeloop_default')).toBe(true);
    expect(governor.calls[0]?.command.args).toEqual(
      expect.arrayContaining(['diff', '--name-status', '-z', '--find-renames', '--diff-filter=ACDMRTUXB', 'base-commit', '--']),
    );
    expect(governor.calls[1]?.command.args).toEqual(
      expect.arrayContaining(['status', '--porcelain=v2', '-z', '--untracked-files=all', '--ignored=matching']),
    );
  });

  it('fails closed when base commit is missing, commands fail, output is malformed, or ignored directories are ambiguous', async () => {
    const repo = await makeTempDir();
    await mkdir(join(repo, 'worktree'), { recursive: true });
    const pathSafety = await PathSafety.create({ repoRoot: repo, worktreeRoot: join(repo, 'worktree') });

    for (const scenario of [
      {
        baseCommit: '',
        governor: new RecordingRunGovernor([]),
        outputs: {},
      },
      {
        baseCommit: 'base-commit',
        governor: new RecordingRunGovernor([{ result: { exit_code: 1, public_summary: 'git failed' } }]),
        outputs: { 'stdout-1': '' },
      },
      {
        baseCommit: 'base-commit',
        governor: new RecordingRunGovernor([{}, {}]),
        outputs: { 'stdout-1': 'M\0src/file.ts', 'stdout-2': '' },
      },
      {
        baseCommit: 'base-commit',
        governor: new RecordingRunGovernor([{}, {}]),
        outputs: { 'stdout-1': '', 'stdout-2': '! build/cache/\0' },
      },
    ]) {
      await expect(
        deriveAuthoritativeChangedFiles({
          runSpec: runSpec(),
          workspaceRoot: '/workspace/repo',
          baseCommit: scenario.baseCommit,
          runGovernor: scenario.governor,
          commandContext: commandContext(),
          pathSafety,
          readCommandOutputRef: outputReader(scenario.outputs),
        }),
      ).resolves.toMatchObject({ ok: false, code: 'changed_files_unavailable' });
    }
  });
});
