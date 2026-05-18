import { chmod, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';

import {
  legacyRequiredCheckToStructuredCommand,
  materializeCommandReference,
  materializeTrustedToolchainCommand,
  structuredCommandDigest,
  structuredCommandResultFromGovernor,
  validateStructuredCommandSpec,
} from '../../packages/executor/src/index';

const hardCaps = {
  hardMaxTimeoutMs: 120_000,
  hardMaxOutputLimitBytes: 1_000_000,
};

const baseCommand = {
  executable: 'pnpm',
  args: ['test', 'tests/executor'],
  cwd: 'workspace_root' as const,
};

const trustedToolchain = {
  root_paths: ['/opt/forgeloop/node'],
  executable_paths: { pnpm: '/opt/forgeloop/node/bin/pnpm' },
  path_entries: ['/opt/forgeloop/node/bin'],
  writable: false,
};

const fileDigest = (path: string): string => `sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`;

describe('StructuredCommand foundation', () => {
  it.each([
    ['shell string', 'pnpm test tests/executor'],
    ['shell true', { ...baseCommand, shell: true }],
    ['absolute executable', { ...baseCommand, executable: '/bin/sh' }],
    ['path executable', { ...baseCommand, executable: './node_modules/.bin/pnpm' }],
    ['unsafe repo cwd', { ...baseCommand, cwd: { repo_relative: '../outside' } }],
    ['absolute cwd', { ...baseCommand, cwd: { repo_relative: '/tmp' } }],
    ['cwd with backslash', { ...baseCommand, cwd: { repo_relative: 'src\\tests' } }],
    ['cwd with control character', { ...baseCommand, cwd: { repo_relative: 'src/\nsecrets' } }],
    ['command-local PATH', { ...baseCommand, env: { PATH: '/usr/bin' } }],
    ['unapproved env', { ...baseCommand, env: { CI: 'true' } }],
    ['dangerous env', { ...baseCommand, env: { NODE_OPTIONS: '--require ./hook.js' } }],
    ['secret-looking env', { ...baseCommand, env: { API_TOKEN: 'secret' } }],
    ['timeout above hard cap', { ...baseCommand, timeout_ms: hardCaps.hardMaxTimeoutMs + 1 }],
    ['output above hard cap', { ...baseCommand, output_limit_bytes: hardCaps.hardMaxOutputLimitBytes + 1 }],
  ])('rejects unsafe command spec: %s', (_label, spec) => {
    expect(() => validateStructuredCommandSpec(spec, hardCaps)).toThrowError(
      expect.objectContaining({ code: 'structured_command_invalid' }),
    );
  });

  it('validates logical executable commands without ambient PATH inheritance', () => {
    expect(validateStructuredCommandSpec(baseCommand, hardCaps)).toEqual(baseCommand);
    expect(validateStructuredCommandSpec({ ...baseCommand, env: { CI: 'true' } }, { ...hardCaps, allowedEnv: ['CI'] })).toEqual({
      ...baseCommand,
      env: { CI: 'true' },
    });
  });

  it('materializes command references with only stricter overrides', () => {
    const templates = {
      unit: {
        ...baseCommand,
        timeout_ms: 90_000,
        output_limit_bytes: 800_000,
        visibility: 'public_safe' as const,
        source_write_policy: 'path_policy_scoped' as const,
      },
    };

    expect(
      materializeCommandReference({
        reference: {
          command_template: 'unit',
          timeout_ms: 30_000,
          output_limit_bytes: 100_000,
          visibility: 'internal',
          source_write_policy: 'read_only',
        },
        templates,
        defaultSourceWritePolicy: 'read_only',
        hardCaps,
      }),
    ).toEqual({
      ...baseCommand,
      timeout_ms: 30_000,
      output_limit_bytes: 100_000,
      visibility: 'internal',
      source_write_policy: 'read_only',
    });

    for (const reference of [
      {},
      { command_template: 'unit', command: baseCommand },
      { command_template: 'missing' },
      { command_template: 'unit', timeout_ms: 91_000 },
      { command_template: 'unit', output_limit_bytes: 900_000 },
      { command: { ...baseCommand, source_write_policy: 'read_only' }, source_write_policy: 'path_policy_scoped' },
    ]) {
      expect(() =>
        materializeCommandReference({
          reference,
          templates,
          defaultSourceWritePolicy: 'read_only',
          hardCaps,
        }),
      ).toThrowError(expect.objectContaining({ code: 'structured_command_invalid' }));
    }
  });

  it('renders legacy required checks into logical executable argv', () => {
    expect(legacyRequiredCheckToStructuredCommand('pnpm test tests/executor', hardCaps)).toEqual(baseCommand);
  });

  it.each([
    'pnpm test "tests/executor"',
    "pnpm test 'tests/executor'",
    'pnpm test $TEST_PATH',
    'pnpm test > out.txt',
    'pnpm test < in.txt',
    'pnpm test | cat',
    'pnpm test && pnpm lint',
    'pnpm test; pnpm lint',
    'pnpm test *',
    'pnpm test ?',
    'pnpm test [ab]',
    'pnpm test {a,b}',
    'pnpm test ~',
    'pnpm test\ncat .env',
    'pnpm test $(pwd)',
    'NODE_ENV=test pnpm test',
    '/usr/bin/pnpm test',
  ])('rejects legacy shell command %s', (command) => {
    expect(() => legacyRequiredCheckToStructuredCommand(command, hardCaps)).toThrowError(
      expect.objectContaining({ code: 'required_check_command_invalid' }),
    );
  });

  it('materializes logical executables through trusted toolchain roots only', async () => {
    const shellPath = realpathSync('/bin/sh');
    const shellRoot = dirname(shellPath);
    const command = { ...baseCommand, executable: 'sh', args: ['-c', 'true'] };
    const realTrustedToolchain = {
      root_paths: [shellRoot],
      executable_paths: { sh: shellPath },
      path_entries: [shellRoot],
      writable: false,
    };
    const materialized = materializeTrustedToolchainCommand({
      command,
      toolchain: realTrustedToolchain,
      workspaceRoot: process.cwd(),
      artifactRoot: join(tmpdir(), 'forgeloop-artifacts'),
      tempRoot: tmpdir(),
    });

    expect(materialized).toEqual({
      ...command,
      timeout_ms: hardCaps.hardMaxTimeoutMs,
      output_limit_bytes: hardCaps.hardMaxOutputLimitBytes,
      env: {},
      visibility: 'internal',
      source_write_policy: 'read_only',
      resolved_executable_path: shellPath,
      executable_identity_digest: fileDigest(shellPath),
      path_entries: [shellRoot],
    });

    for (const toolchain of [
      { ...trustedToolchain, writable: true },
      { ...trustedToolchain, root_paths: [join(process.cwd(), 'tools')] },
      { ...trustedToolchain, root_paths: [join(tmpdir(), 'artifacts/tools')] },
      { ...trustedToolchain, root_paths: [join(tmpdir(), 'tools')] },
      { ...trustedToolchain, path_entries: ['/usr/bin'] },
      { ...trustedToolchain, path_entries: ['relative/bin'] },
      { ...trustedToolchain, executable_paths: { pnpm: '/usr/bin/pnpm' } },
    ]) {
      expect(() =>
        materializeTrustedToolchainCommand({
          command: baseCommand,
          toolchain,
          workspaceRoot: process.cwd(),
          artifactRoot: join(tmpdir(), 'artifacts'),
          tempRoot: tmpdir(),
        }),
      ).toThrowError(expect.objectContaining({ code: 'structured_command_invalid' }));
    }

    expect(() =>
      materializeTrustedToolchainCommand({
        command,
        toolchain: { ...realTrustedToolchain, executable_paths: { sh: join(shellRoot, 'missing-forgeloop-sh') } },
        workspaceRoot: process.cwd(),
        artifactRoot: join(tmpdir(), 'artifacts'),
        tempRoot: tmpdir(),
      }),
    ).toThrowError(expect.objectContaining({ code: 'structured_command_invalid' }));

    const tempBase = await mkdtemp(join(tmpdir(), 'forgeloop-toolchain-'));
    const workspaceRoot = join(tempBase, 'workspace');
    const artifactRoot = join(tempBase, 'artifacts');
    const tempRoot = join(tempBase, 'runtime-tmp');
    const workspaceToolchain = join(workspaceRoot, 'repo-tools');
    const symlinkRoot = join(tempBase, 'trusted-root-link');
    const symlinkExecutable = join(symlinkRoot, 'bin', 'tool');
    try {
      await mkdir(join(workspaceToolchain, 'bin'), { recursive: true });
      await mkdir(artifactRoot);
      await mkdir(tempRoot);
      await writeFile(join(workspaceToolchain, 'bin', 'tool'), '#!/bin/sh\nexit 0\n');
      await chmod(join(workspaceToolchain, 'bin', 'tool'), 0o755);
      await symlink(workspaceToolchain, symlinkRoot);

      expect(() =>
        materializeTrustedToolchainCommand({
          command: { ...baseCommand, executable: 'tool', args: [] },
          toolchain: {
            root_paths: [symlinkRoot],
            executable_paths: { tool: symlinkExecutable },
            path_entries: [join(symlinkRoot, 'bin')],
            writable: false,
          },
          workspaceRoot,
          artifactRoot,
          tempRoot,
        }),
      ).toThrowError(expect.objectContaining({ code: 'structured_command_invalid' }));

      expect(() =>
        materializeTrustedToolchainCommand({
          command: { ...baseCommand, executable: 'tool', args: [] },
          toolchain: {
            root_paths: [tempBase],
            executable_paths: { tool: join(workspaceToolchain, 'bin', 'tool') },
            path_entries: [tempBase],
            writable: false,
          },
          workspaceRoot,
          artifactRoot,
          tempRoot,
        }),
      ).toThrowError(expect.objectContaining({ code: 'structured_command_invalid' }));

      expect(() =>
        materializeTrustedToolchainCommand({
          command: { ...baseCommand, executable: 'tool', args: [] },
          toolchain: {
            root_paths: [tempBase],
            executable_paths: { tool: join(workspaceToolchain, 'bin', 'tool') },
            path_entries: [join(workspaceRoot, 'repo-tools', 'bin')],
            writable: false,
          },
          workspaceRoot: join(tempBase, 'different-workspace'),
          artifactRoot,
          tempRoot,
        }),
      ).toThrowError(expect.objectContaining({ code: 'structured_command_invalid' }));
    } finally {
      await rm(tempBase, { recursive: true, force: true });
    }
  });

  it('computes stable command digests from materialized command data', () => {
    const materializedCommand = {
      ...baseCommand,
      timeout_ms: 120_000,
      output_limit_bytes: 1_000_000,
      env: {},
      visibility: 'internal' as const,
      source_write_policy: 'read_only' as const,
      resolved_executable_path: '/opt/forgeloop/node/bin/pnpm',
      executable_identity_digest: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
      path_entries: ['/opt/forgeloop/node/bin'],
    };
    const first = structuredCommandDigest({
      command: materializedCommand,
      resource_limit_digest: 'sha256:limits',
      run_id: 'run-1',
      workspace_root: '/repo/workspace',
      artifact_root: '/repo/artifacts',
      sandbox_output_root_policy: 'ephemeral_sandbox_output_only',
      artifact_quota_policy: 'sha256:artifact-quota',
    });
    const second = structuredCommandDigest({
      command: {
        cwd: 'workspace_root',
        args: ['test', 'tests/executor'],
        executable: 'pnpm',
        timeout_ms: 120_000,
        output_limit_bytes: 1_000_000,
        env: {},
        visibility: 'internal',
        source_write_policy: 'read_only',
        resolved_executable_path: '/opt/forgeloop/node/bin/pnpm',
        executable_identity_digest: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
        path_entries: ['/opt/forgeloop/node/bin'],
      },
      resource_limit_digest: 'sha256:limits',
      run_id: 'run-1',
      workspace_root: '/repo/workspace',
      artifact_root: '/repo/artifacts',
      sandbox_output_root_policy: 'ephemeral_sandbox_output_only',
      artifact_quota_policy: 'sha256:artifact-quota',
    });
    const changed = structuredCommandDigest({
      command: { ...materializedCommand, args: ['test', 'tests/domain'] },
      resource_limit_digest: 'sha256:limits',
      run_id: 'run-1',
      workspace_root: '/repo/workspace',
      artifact_root: '/repo/artifacts',
      sandbox_output_root_policy: 'ephemeral_sandbox_output_only',
      artifact_quota_policy: 'sha256:artifact-quota',
    });

    expect(first).toBe(second);
    expect(first).not.toBe(changed);
    expect(first).toMatch(/^sha256:[a-f0-9]{64}$/);

    expect(
      structuredCommandDigest({
        command: { ...materializedCommand, env: { CI: 'true' } },
        resource_limit_digest: 'sha256:limits',
        run_id: 'run-1',
        workspace_root: '/repo/workspace',
        artifact_root: '/repo/artifacts',
        sandbox_output_root_policy: 'ephemeral_sandbox_output_only',
        artifact_quota_policy: 'sha256:artifact-quota',
      }),
    ).toMatch(/^sha256:[a-f0-9]{64}$/);

    expect(() =>
      structuredCommandDigest({
        command: {
          ...baseCommand,
          resolved_executable_path: '/opt/forgeloop/node/bin/pnpm',
          path_entries: ['/opt/forgeloop/node/bin'],
        },
        resource_limit_digest: 'sha256:limits',
        run_id: 'run-1',
        workspace_root: '/repo/workspace',
        artifact_root: '/repo/artifacts',
        sandbox_output_root_policy: 'ephemeral_sandbox_output_only',
        artifact_quota_policy: 'sha256:artifact-quota',
      }),
    ).toThrowError(expect.objectContaining({ code: 'structured_command_invalid' }));
  });

  it('maps governor output into sanitized structured command results', () => {
    expect(
      structuredCommandResultFromGovernor({
        exit_code: 1,
        timed_out: false,
        stdout_ref: 'artifacts/run/stdout.txt',
        stderr_ref: 'artifacts/run/stderr.txt',
        visibility: 'public_safe',
        public_summary: 'Command failed.',
      }),
    ).toEqual({
      exit_code: 1,
      timed_out: false,
      stdout_ref: 'artifacts/run/stdout.txt',
      stderr_ref: 'artifacts/run/stderr.txt',
      stdout_truncated: false,
      stderr_truncated: false,
      visibility: 'public_safe',
      public_summary: 'Command failed.',
    });
  });

  it('does not import or call subprocess APIs', async () => {
    const source = await readFile(join(process.cwd(), 'packages/executor/src/structured-command.ts'), 'utf8');
    expect(source).not.toMatch(/node:child_process|child_process|\bspawn\s*\(|\bexec\s*\(|\bexecFile\s*\(/);
  });
});
