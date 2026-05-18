import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { RequiredCheckSpec } from '@forgeloop/contracts';
import {
  buildPackageRuntimePolicySnapshot,
  loadRuntimePolicy,
  RuntimePolicyError,
  RUNTIME_POLICY_PARSER_VERSION,
  RUNTIME_POLICY_SOURCE_PATH,
  runtimePolicyFromDocument,
} from '../../packages/executor/src/index';

const loadedAt = '2026-05-17T00:00:00.000Z';

const packageCheck: RequiredCheckSpec = {
  check_id: 'unit',
  display_name: 'Unit tests',
  command: 'pnpm test tests/api',
  timeout_seconds: 120,
  blocks_review: true,
};

const emptyPackagePathPolicy = { allowed_paths: [], forbidden_paths: [] };
const apiPackagePathPolicy = { allowed_paths: ['apps/**'], forbidden_paths: ['packages/db/**'] };

const policyMarkdown = (frontMatter: string, body = 'Runtime instructions.\n') => `---\n${frontMatter}---\n\n${body}`;

describe('runtime policy loading', () => {
  let repoRoot: string;

  beforeEach(async () => {
    repoRoot = await mkdtemp(join(tmpdir(), 'forgeloop-runtime-policy-'));
  });

  afterEach(async () => {
    await rm(repoRoot, { recursive: true, force: true });
  });

  it('reads only repo-root WORKFLOW.md', async () => {
    await mkdir(join(repoRoot, 'nested'), { recursive: true });
    await writeFile(
      join(repoRoot, RUNTIME_POLICY_SOURCE_PATH),
      policyMarkdown('observability:\n  public_summary: "root policy"\n'),
    );
    await writeFile(
      join(repoRoot, 'nested', RUNTIME_POLICY_SOURCE_PATH),
      policyMarkdown('observability:\n  public_summary: "nested policy"\n'),
    );

    const loaded = await loadRuntimePolicy({ repoRoot, loadedAt });

    expect(loaded.status).toBe('loaded');
    expect(loaded.policy_source_path).toBe(RUNTIME_POLICY_SOURCE_PATH);
    expect(loaded.policy.observability?.public_summary).toBe('root policy');
  });

  it('rejects unsafe policy source paths', async () => {
    await expect(loadRuntimePolicy({ repoRoot, loadedAt, policySourcePath: '../WORKFLOW.md' })).resolves.toMatchObject({
      status: 'invalid',
      blocker_code: 'runtime_policy_invalid',
    });

    await expect(loadRuntimePolicy({ repoRoot, loadedAt, policySourcePath: 'nested/WORKFLOW.md' })).resolves.toMatchObject({
      status: 'invalid',
      blocker_code: 'runtime_policy_invalid',
    });
  });

  it('strictly parses YAML front matter and rejects unknown execution fields', async () => {
    await writeFile(
      join(repoRoot, RUNTIME_POLICY_SOURCE_PATH),
      policyMarkdown(`
codex:
  primary_executor: "mock"
unknown_section:
  enabled: true
`),
    );

    await expect(loadRuntimePolicy({ repoRoot, loadedAt })).resolves.toMatchObject({
      status: 'invalid',
      blocker_code: 'runtime_policy_invalid',
      diagnostics: [expect.objectContaining({ code: 'runtime_policy_invalid' })],
    });

    await writeFile(
      join(repoRoot, RUNTIME_POLICY_SOURCE_PATH),
      policyMarkdown(`
codex:
  primary_executor: "mock"
  runtime_mode: "legacy"
`),
    );

    await expect(loadRuntimePolicy({ repoRoot, loadedAt })).resolves.toMatchObject({
      status: 'invalid',
      blocker_code: 'runtime_policy_invalid',
    });
  });

  it('parses CRLF front matter and rejects malformed delimiter lines', async () => {
    await writeFile(
      join(repoRoot, RUNTIME_POLICY_SOURCE_PATH),
      '---\r\nobservability:\r\n  public_summary: "crlf policy"\r\n---\r\nRuntime instructions.\r\n',
    );

    const loaded = await loadRuntimePolicy({ repoRoot, loadedAt });
    expect(loaded.status).toBe('loaded');
    expect(loaded.policy.observability?.public_summary).toBe('crlf policy');

    await writeFile(
      join(repoRoot, RUNTIME_POLICY_SOURCE_PATH),
      '---\r\ncodex:\r\n  runtime_mode: "legacy"\r\n---\r\nRuntime instructions.\r\n',
    );
    await expect(loadRuntimePolicy({ repoRoot, loadedAt })).resolves.toMatchObject({
      status: 'invalid',
      blocker_code: 'runtime_policy_invalid',
    });

    await writeFile(
      join(repoRoot, RUNTIME_POLICY_SOURCE_PATH),
      '---\nobservability:\n  public_summary: "bad close"\n---not-a-delimiter\n',
    );
    await expect(loadRuntimePolicy({ repoRoot, loadedAt })).resolves.toMatchObject({
      status: 'invalid',
      blocker_code: 'runtime_policy_invalid',
    });
  });

  it('rejects wildcard, secret-looking, and dangerous environment allowlist entries', async () => {
    for (const envName of ['*', 'API_TOKEN', 'PRIVATE_KEY', 'APP_SECRET', 'PATH', 'NODE_OPTIONS', 'LD_PRELOAD', 'DYLD_INSERT_LIBRARIES', 'GIT_CONFIG_GLOBAL', 'GIT_ASKPASS', 'SSH_AUTH_SOCK', 'BASH_ENV', 'ENV']) {
      await writeFile(
        join(repoRoot, RUNTIME_POLICY_SOURCE_PATH),
        policyMarkdown(`
environment:
  allow: ["${envName}"]
`),
      );

      await expect(loadRuntimePolicy({ repoRoot, loadedAt })).resolves.toMatchObject({
        status: 'invalid',
        blocker_code: 'runtime_policy_invalid',
      });
    }
  });

  it('requires a frozen egress allowlist digest and uses network-disabled for disabled network mode', async () => {
    await writeFile(
      join(repoRoot, RUNTIME_POLICY_SOURCE_PATH),
      policyMarkdown(`
codex:
  network_mode: "egress_allowlist"
`),
    );

    await expect(loadRuntimePolicy({ repoRoot, loadedAt })).resolves.toMatchObject({
      status: 'invalid',
      blocker_code: 'runtime_policy_invalid',
    });

    await writeFile(
      join(repoRoot, RUNTIME_POLICY_SOURCE_PATH),
      policyMarkdown(`
codex:
  network_mode: "disabled"
`),
    );

    const loaded = await loadRuntimePolicy({ repoRoot, loadedAt });
    expect(loaded.status).toBe('loaded');
    expect(loaded.network_policy_digest).toBe('network-disabled');

    await writeFile(
      join(repoRoot, RUNTIME_POLICY_SOURCE_PATH),
      policyMarkdown(`
codex:
  network_mode: "egress_allowlist"
  egress_allowlist_digest: "allowlist-digest-v1"
`),
    );

    const egressPolicy = await loadRuntimePolicy({ repoRoot, loadedAt });
    expect(egressPolicy.status).toBe('loaded');
    expect(egressPolicy.network_policy_digest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(egressPolicy.network_policy_digest).not.toBe('allowlist-digest-v1');
  });

  it('applies defaults and computes stable policy digests', async () => {
    await writeFile(join(repoRoot, RUNTIME_POLICY_SOURCE_PATH), 'Runtime body without front matter.\n');

    const first = await loadRuntimePolicy({ repoRoot, loadedAt });
    const second = await loadRuntimePolicy({ repoRoot, loadedAt });

    expect(first).toMatchObject({
      status: 'loaded',
      policy: {
        codex: { primary_executor: 'mock', network_mode: 'disabled' },
        workspace: { worktree_dir: '.worktrees', cleanup: 'run_workspace_only', source_snapshot: 'required' },
        path_policy: { allowed_paths: [], forbidden_paths: [] },
        environment: { allow: [] },
        artifacts: { default_visibility: 'internal' },
        prompt_policy: { include_workflow_body: true, body_visibility: 'internal' },
      },
      env_policy_digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      command_policy_digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      mount_policy_digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      network_policy_digest: 'network-disabled',
    });
    expect(first.normalized_policy_payload.parser_version).toBe(RUNTIME_POLICY_PARSER_VERSION);
    expect(first.normalized_policy_payload.normalized_payload_digest).toBe(second.normalized_policy_payload.normalized_payload_digest);
    expect(first.policy_digest).toBe(first.normalized_policy_payload.normalized_payload_digest);
  });

  it('uses deterministic code-unit key ordering for policy digests', () => {
    const command = { executable: 'pnpm', args: ['test'], cwd: 'workspace_root' } as const;
    const first = runtimePolicyFromDocument({
      document: {
        commands: {
          trusted_toolchain: 'node',
          templates: { Zebra: command, alpha: command, Alpha: command },
        },
      },
      markdownBody: '',
      loadedAt,
    });
    const second = runtimePolicyFromDocument({
      document: {
        commands: {
          trusted_toolchain: 'node',
          templates: { Alpha: command, Zebra: command, alpha: command },
        },
      },
      markdownBody: '',
      loadedAt,
    });

    expect(first.policy_digest).toBe(second.policy_digest);
    expect(first.command_policy_digest).toBe(second.command_policy_digest);
  });

  it('preserves last-known-good on invalid reload and blocks invalid initial execution load', async () => {
    await writeFile(join(repoRoot, RUNTIME_POLICY_SOURCE_PATH), policyMarkdown('observability:\n  public_summary: "ok"\n'));
    const lastKnownGood = await loadRuntimePolicy({ repoRoot, loadedAt });
    expect(lastKnownGood.status).toBe('loaded');

    await writeFile(join(repoRoot, RUNTIME_POLICY_SOURCE_PATH), policyMarkdown('codex:\n  runtime_mode: "bad"\n'));
    const reload = await loadRuntimePolicy({ repoRoot, loadedAt, lastKnownGood });
    expect(reload).toMatchObject({
      status: 'loaded',
      policy_last_known_good: true,
      reload_status: 'invalid_preserved_last_known_good',
      diagnostics: [expect.objectContaining({ code: 'runtime_policy_invalid' })],
    });
    expect(reload.policy_digest).toBe(lastKnownGood.policy_digest);

    const invalidInitial = await loadRuntimePolicy({ repoRoot, loadedAt });
    expect(invalidInitial).toMatchObject({
      status: 'invalid',
      blocker_code: 'runtime_policy_invalid',
      policy_last_known_good: false,
    });
  });
});

describe('package runtime policy snapshots', () => {
  const loadedPolicyForChecks = () =>
    runtimePolicyFromDocument({
      document: {
        codex: { primary_executor: 'mock' },
        path_policy: { allowed_paths: ['apps/**'], forbidden_paths: ['packages/db/**'] },
        commands: {
          trusted_toolchain: 'node',
          templates: {
            unit_template: {
              executable: 'pnpm',
              args: ['test', 'tests/api'],
              cwd: 'workspace_root',
              timeout_ms: 60_000,
              output_limit_bytes: 512_000,
            },
            safety_template: {
              executable: 'pnpm',
              args: ['lint'],
              cwd: 'workspace_root',
            },
          },
        },
        checks: {
          required: [
            {
              check_id: 'unit',
              display_name: 'Unit tests',
              command_template: 'unit_template',
              timeout_ms: 60_000,
              blocks_review: true,
              visibility: 'internal',
            },
            {
              check_id: 'lint',
              display_name: 'Lint',
              command_template: 'safety_template',
            },
          ],
        },
      },
      markdownBody: 'Runtime instructions.',
      loadedAt,
    });

  it('freezes package checks, repo-policy templates, and repo-only safety checks deterministically', () => {
    const snapshot = buildPackageRuntimePolicySnapshot({
      loadedPolicy: loadedPolicyForChecks(),
      executionPackageChecks: [packageCheck],
      executionPackagePathPolicy: apiPackagePathPolicy,
      validationStrategy: 'checks_required',
      sourceMutationPolicy: 'path_policy_scoped',
    });

    expect(snapshot.policy_snapshot_version).toBe(1);
    expect(snapshot.policy_digest).toBe(snapshot.normalized_policy_payload?.normalized_payload_digest);
    expect(snapshot.path_policy).toEqual({ allowed_paths: ['apps/**'], forbidden_paths: ['packages/db/**'] });
    expect(snapshot.frozen_command_check_policy).toEqual({
      required_checks: [
        expect.objectContaining({
          check_id: 'unit',
          display_name: packageCheck.display_name,
          source: 'execution_package',
          blocks_review: true,
          timeout_ms: 60_000,
          visibility: 'internal',
          command: expect.objectContaining({
            executable: 'pnpm',
            args: ['test', 'tests/api'],
            source_write_policy: 'read_only',
          }),
        }),
        expect.objectContaining({
          check_id: 'lint',
          source: 'repo_policy',
          blocks_review: true,
          visibility: 'internal',
          command: expect.objectContaining({ source_write_policy: 'read_only' }),
        }),
      ],
    });
  });

  it('does not retain mutable references from the loaded runtime policy', () => {
    const loadedPolicy = loadedPolicyForChecks();
    const snapshot = buildPackageRuntimePolicySnapshot({
      loadedPolicy,
      executionPackageChecks: [packageCheck],
      executionPackagePathPolicy: apiPackagePathPolicy,
      validationStrategy: 'checks_required',
      sourceMutationPolicy: 'path_policy_scoped',
    });

    expect(snapshot.path_policy).not.toBe(loadedPolicy.policy.path_policy);
    expect(snapshot.normalized_policy_payload).not.toBe(loadedPolicy.normalized_policy_payload);

    loadedPolicy.policy.path_policy!.allowed_paths.push('packages/domain/**');
    loadedPolicy.normalized_policy_payload.normalized_front_matter.path_policy!.allowed_paths.push('packages/domain/**');

    expect(snapshot.path_policy).toEqual({ allowed_paths: ['apps/**'], forbidden_paths: ['packages/db/**'] });
    expect(snapshot.normalized_policy_payload.normalized_front_matter.path_policy).toEqual({
      allowed_paths: ['apps/**'],
      forbidden_paths: ['packages/db/**'],
    });
  });

  it('rejects required-check overrides that broaden template visibility or source-write policy', () => {
    const loadedPolicy = runtimePolicyFromDocument({
      document: {
        commands: {
          trusted_toolchain: 'node',
          templates: {
            unit_template: {
              executable: 'pnpm',
              args: ['test'],
              cwd: 'workspace_root',
              visibility: 'internal',
              source_write_policy: 'read_only',
            },
          },
        },
        checks: {
          required: [
            {
              check_id: 'unit',
              command_template: 'unit_template',
              visibility: 'public_safe',
              source_write_policy: 'path_policy_scoped',
            },
          ],
        },
      },
      markdownBody: '',
      loadedAt,
    });

    expect(() =>
      buildPackageRuntimePolicySnapshot({
        loadedPolicy,
        executionPackageChecks: [packageCheck],
        executionPackagePathPolicy: emptyPackagePathPolicy,
        validationStrategy: 'checks_required',
        sourceMutationPolicy: 'path_policy_scoped',
      }),
    ).toThrowError(expect.objectContaining({ public_code: 'policy_snapshot_invalid' }));
  });

  it('narrows package check repo templates to internal read-only defaults when overrides are omitted', () => {
    const loadedPolicy = runtimePolicyFromDocument({
      document: {
        commands: {
          trusted_toolchain: 'node',
          templates: {
            unit_template: {
              executable: 'pnpm',
              args: ['test'],
              cwd: 'workspace_root',
              visibility: 'public_safe',
              source_write_policy: 'path_policy_scoped',
            },
          },
        },
        checks: {
          required: [{ check_id: 'unit', command_template: 'unit_template' }],
        },
      },
      markdownBody: '',
      loadedAt,
    });

    const snapshot = buildPackageRuntimePolicySnapshot({
      loadedPolicy,
      executionPackageChecks: [packageCheck],
      executionPackagePathPolicy: emptyPackagePathPolicy,
      validationStrategy: 'checks_required',
      sourceMutationPolicy: 'path_policy_scoped',
    });

    expect(snapshot.frozen_command_check_policy).toEqual({
      required_checks: [
        expect.objectContaining({
          check_id: 'unit',
          command: expect.objectContaining({
            visibility: 'internal',
            source_write_policy: 'read_only',
          }),
        }),
      ],
    });
  });

  it('uses environment allowlist when validating and materializing runtime policy command env', () => {
    const loadedPolicy = runtimePolicyFromDocument({
      document: {
        environment: { allow: ['CI'] },
        commands: {
          trusted_toolchain: 'node',
          templates: {
            unit_template: {
              executable: 'pnpm',
              args: ['test'],
              cwd: 'workspace_root',
              env: { CI: 'true' },
            },
          },
        },
        checks: {
          required: [{ check_id: 'unit', command_template: 'unit_template' }],
        },
      },
      markdownBody: '',
      loadedAt,
    });

    const snapshot = buildPackageRuntimePolicySnapshot({
      loadedPolicy,
      executionPackageChecks: [packageCheck],
      executionPackagePathPolicy: emptyPackagePathPolicy,
      validationStrategy: 'checks_required',
      sourceMutationPolicy: 'path_policy_scoped',
    });

    expect(snapshot.frozen_command_check_policy).toEqual({
      required_checks: [
        expect.objectContaining({
          check_id: 'unit',
          command: expect.objectContaining({
            env: { CI: 'true' },
          }),
        }),
      ],
    });
  });

  it('freezes repo-only safety checks as blocking and internal by default', () => {
    const loadedPolicy = runtimePolicyFromDocument({
      document: {
        commands: {
          trusted_toolchain: 'node',
          templates: {
            safety_template: {
              executable: 'pnpm',
              args: ['lint'],
              cwd: 'workspace_root',
              visibility: 'public_safe',
            },
          },
        },
        checks: {
          required: [
            {
              check_id: 'repo-safety',
              command_template: 'safety_template',
              blocks_review: false,
            },
          ],
        },
      },
      markdownBody: '',
      loadedAt,
    });

    const snapshot = buildPackageRuntimePolicySnapshot({
      loadedPolicy,
      executionPackageChecks: [],
      executionPackagePathPolicy: emptyPackagePathPolicy,
      validationStrategy: 'checks_required',
      sourceMutationPolicy: 'path_policy_scoped',
    });

    expect(snapshot.frozen_command_check_policy).toEqual({
      required_checks: [
        expect.objectContaining({
          check_id: 'repo-safety',
          source: 'repo_policy',
          blocks_review: true,
          visibility: 'internal',
          command: expect.objectContaining({ visibility: 'internal', source_write_policy: 'read_only' }),
        }),
      ],
    });
  });

  it('requires reviewed evidence before capturing allow_all_repo snapshots', () => {
    const loadedPolicy = runtimePolicyFromDocument({
      document: {
        path_policy: { allow_all_repo: true },
      },
      markdownBody: '',
      loadedAt,
    });

    expect(() =>
      buildPackageRuntimePolicySnapshot({
        loadedPolicy,
        executionPackageChecks: [packageCheck],
        executionPackagePathPolicy: emptyPackagePathPolicy,
        validationStrategy: 'checks_required',
        sourceMutationPolicy: 'path_policy_scoped',
      }),
    ).toThrowError(expect.objectContaining({ public_code: 'policy_snapshot_invalid' }));

    expect(() =>
      buildPackageRuntimePolicySnapshot({
        loadedPolicy,
        executionPackageChecks: [packageCheck],
        executionPackagePathPolicy: { allowed_paths: ['apps/**'], forbidden_paths: [] },
        validationStrategy: 'allow_all_repo',
        sourceMutationPolicy: 'path_policy_scoped',
        validationEvidenceRefs: [
          {
            kind: 'validation',
            name: 'allow all repo approval',
            content_type: 'text/markdown',
            local_ref: 'artifacts/policy/allow-all-repo.md',
          },
        ],
      }),
    ).not.toThrow();
  });

  it.each([
    ['traversal path', { allowed_paths: ['../secrets'] }],
    ['absolute path', { allowed_paths: ['/tmp'] }],
    ['root-wide path without approval', { allowed_paths: ['*'] }],
  ])('rejects invalid runtime path policy capture for %s', (_label, pathPolicy) => {
    const loadedPolicy = runtimePolicyFromDocument({
      document: { path_policy: pathPolicy },
      markdownBody: '',
      loadedAt,
    });

    expect(() =>
      buildPackageRuntimePolicySnapshot({
        loadedPolicy,
        executionPackageChecks: [packageCheck],
        executionPackagePathPolicy: emptyPackagePathPolicy,
        validationStrategy: 'checks_required',
        sourceMutationPolicy: 'path_policy_scoped',
      }),
    ).toThrowError(expect.objectContaining({ public_code: 'policy_snapshot_invalid' }));
  });

  it('rejects package declared source scope outside the frozen runtime path policy', () => {
    const loadedPolicy = runtimePolicyFromDocument({
      document: { path_policy: { allowed_paths: ['apps/**'], forbidden_paths: ['packages/db/**'] } },
      markdownBody: '',
      loadedAt,
    });

    expect(() =>
      buildPackageRuntimePolicySnapshot({
        loadedPolicy,
        executionPackageChecks: [packageCheck],
        executionPackagePathPolicy: { allowed_paths: ['packages/domain/**'], forbidden_paths: [] },
        validationStrategy: 'checks_required',
        sourceMutationPolicy: 'path_policy_scoped',
      }),
    ).toThrowError(expect.objectContaining({ public_code: 'policy_snapshot_invalid' }));
  });

  it('rejects no_source_changes snapshots with source paths', () => {
    const loadedPolicy = runtimePolicyFromDocument({
      document: { path_policy: { allowed_paths: ['apps/**'] } },
      markdownBody: '',
      loadedAt,
    });

    expect(() =>
      buildPackageRuntimePolicySnapshot({
        loadedPolicy,
        executionPackageChecks: [],
        executionPackagePathPolicy: emptyPackagePathPolicy,
        validationStrategy: 'checks_required',
        sourceMutationPolicy: 'no_source_changes',
      }),
    ).toThrowError(expect.objectContaining({ public_code: 'policy_snapshot_invalid' }));
  });

  it('renders unmatched package checks through the constrained legacy command renderer', () => {
    const snapshot = buildPackageRuntimePolicySnapshot({
      loadedPolicy: runtimePolicyFromDocument({
        document: { codex: { primary_executor: 'mock' }, path_policy: { allowed_paths: ['apps/**'] } },
        markdownBody: '',
        loadedAt,
      }),
      executionPackageChecks: [packageCheck],
      executionPackagePathPolicy: { allowed_paths: ['apps/**'], forbidden_paths: [] },
      validationStrategy: 'checks_required',
      sourceMutationPolicy: 'path_policy_scoped',
    });

    expect(snapshot.frozen_command_check_policy).toEqual({
      required_checks: [
        expect.objectContaining({
          check_id: 'unit',
          command: expect.objectContaining({
            executable: 'pnpm',
            args: ['test', 'tests/api'],
            cwd: 'workspace_root',
            source_write_policy: 'read_only',
          }),
        }),
      ],
    });
  });

  it.each([
    ['raises template timeout', { timeout_ms: 90_000 }],
    ['raises template output limit', { output_limit_bytes: 900_000 }],
  ])('rejects required-check override that %s', (_label, overrides) => {
    const loadedPolicy = runtimePolicyFromDocument({
      document: {
        commands: {
          trusted_toolchain: 'node',
          templates: {
            unit_template: {
              executable: 'pnpm',
              args: ['test'],
              cwd: 'workspace_root',
              timeout_ms: 60_000,
              output_limit_bytes: 512_000,
            },
          },
        },
        checks: {
          required: [{ check_id: 'unit', command_template: 'unit_template', ...overrides }],
        },
      },
      markdownBody: '',
      loadedAt,
    });

    expect(() =>
      buildPackageRuntimePolicySnapshot({
        loadedPolicy,
        executionPackageChecks: [packageCheck],
        executionPackagePathPolicy: emptyPackagePathPolicy,
        validationStrategy: 'checks_required',
        sourceMutationPolicy: 'path_policy_scoped',
      }),
    ).toThrowError(expect.objectContaining({ public_code: 'policy_snapshot_invalid' }));
  });

  it.each([
    ['weakens blocks_review', { blocks_review: false }],
    ['raises timeout', { timeout_ms: 121_000 }],
    ['changes display_name', { display_name: 'Different' }],
  ])('rejects repo policy check metadata that %s', (_label, overrides) => {
    const loadedPolicy = runtimePolicyFromDocument({
      document: {
        commands: {
          trusted_toolchain: 'node',
          templates: {
            unit_template: { executable: 'pnpm', args: ['test'], cwd: 'workspace_root' },
          },
        },
        checks: {
          required: [{ check_id: 'unit', command_template: 'unit_template', ...overrides }],
        },
      },
      markdownBody: '',
      loadedAt,
    });

    expect(() =>
      buildPackageRuntimePolicySnapshot({
        loadedPolicy,
        executionPackageChecks: [packageCheck],
        executionPackagePathPolicy: emptyPackagePathPolicy,
        validationStrategy: 'checks_required',
        sourceMutationPolicy: 'path_policy_scoped',
      }),
    ).toThrowError(expect.objectContaining({ public_code: 'policy_snapshot_invalid' }));
  });

  it('rejects legacy command rendering failures with required_check_command_invalid', () => {
    expect(() =>
      buildPackageRuntimePolicySnapshot({
        loadedPolicy: runtimePolicyFromDocument({ document: {}, markdownBody: '', loadedAt }),
        executionPackageChecks: [{ ...packageCheck, command: 'pnpm test tests/api && cat .env' }],
        executionPackagePathPolicy: emptyPackagePathPolicy,
        validationStrategy: 'checks_required',
        sourceMutationPolicy: 'path_policy_scoped',
      }),
    ).toThrowError(expect.objectContaining({ public_code: 'required_check_command_invalid' }));

    expect(() =>
      buildPackageRuntimePolicySnapshot({
        loadedPolicy: runtimePolicyFromDocument({ document: {}, markdownBody: '', loadedAt }),
        executionPackageChecks: [{ ...packageCheck, command: 'pnpm test ?' }],
        executionPackagePathPolicy: emptyPackagePathPolicy,
        validationStrategy: 'checks_required',
        sourceMutationPolicy: 'path_policy_scoped',
      }),
    ).toThrowError(expect.objectContaining({ public_code: 'required_check_command_invalid' }));

    expect(() =>
      buildPackageRuntimePolicySnapshot({
        loadedPolicy: runtimePolicyFromDocument({ document: {}, markdownBody: '', loadedAt }),
        executionPackageChecks: [{ ...packageCheck, command: 'pnpm test\ncat .env' }],
        executionPackagePathPolicy: emptyPackagePathPolicy,
        validationStrategy: 'checks_required',
        sourceMutationPolicy: 'path_policy_scoped',
      }),
    ).toThrowError(expect.objectContaining({ public_code: 'required_check_command_invalid' }));
  });

  it('uses shared structured command validation for runtime policy commands', () => {
    expect(() =>
      runtimePolicyFromDocument({
        document: {
          commands: {
            trusted_toolchain: 'node',
            templates: {
              bad_cwd: {
                executable: 'pnpm',
                args: ['test'],
                cwd: { repo_relative: 'src/\nsecrets' },
              },
            },
          },
        },
        markdownBody: '',
        loadedAt,
      }),
    ).toThrowError(expect.objectContaining({ public_code: 'policy_snapshot_invalid' }));
  });

  it('freezes hook and fallback command references through structured materialization', () => {
    const loadedPolicy = runtimePolicyFromDocument({
      document: {
        commands: {
          trusted_toolchain: 'node',
          templates: {
            hook_template: {
              executable: 'pnpm',
              args: ['lint'],
              cwd: 'workspace_root',
              timeout_ms: 90_000,
              output_limit_bytes: 512_000,
              visibility: 'public_safe',
              source_write_policy: 'path_policy_scoped',
            },
            fallback_template: {
              executable: 'codex',
              args: ['exec', '--json'],
              cwd: 'workspace_root',
              source_write_policy: 'artifact_only',
            },
          },
        },
        hooks: {
          before_run: [{ hook_id: 'before', command_template: 'hook_template', timeout_ms: 30_000, visibility: 'internal' }],
          after_run: [{ hook_id: 'after', command: { executable: 'pnpm', args: ['report'], cwd: 'workspace_root' } }],
        },
        fallback: {
          mode: 'codex_exec',
          command_template: 'fallback_template',
          source_write_policy: 'read_only',
        },
      },
      markdownBody: '',
      loadedAt,
    });

    const snapshot = buildPackageRuntimePolicySnapshot({
      loadedPolicy,
      executionPackageChecks: [],
      executionPackagePathPolicy: emptyPackagePathPolicy,
      validationStrategy: 'checks_required',
      sourceMutationPolicy: 'path_policy_scoped',
    });

    expect(snapshot.frozen_hook_specs).toEqual({
      before_run: [
        expect.objectContaining({
          hook_id: 'before',
          command: expect.objectContaining({
            executable: 'pnpm',
            args: ['lint'],
            timeout_ms: 30_000,
            output_limit_bytes: 512_000,
            visibility: 'internal',
            source_write_policy: 'path_policy_scoped',
          }),
        }),
      ],
      after_run: [
        expect.objectContaining({
          hook_id: 'after',
          command: expect.objectContaining({
            executable: 'pnpm',
            args: ['report'],
            source_write_policy: 'artifact_only',
          }),
        }),
      ],
    });
    expect(snapshot.fallback_policy).toEqual(
      expect.objectContaining({
        mode: 'codex_exec',
        command: expect.objectContaining({
          executable: 'codex',
          args: ['exec', '--json'],
          source_write_policy: 'read_only',
        }),
      }),
    );
  });

  it.each([
    ['hook missing command source', { hooks: { before_run: [{ hook_id: 'bad' }], after_run: [] } }],
    [
      'hook with both command sources',
      {
        commands: { trusted_toolchain: 'node', templates: { unit: { executable: 'pnpm', args: ['test'], cwd: 'workspace_root' } } },
        hooks: {
          before_run: [
            { hook_id: 'bad', command_template: 'unit', command: { executable: 'pnpm', args: ['lint'], cwd: 'workspace_root' } },
          ],
          after_run: [],
        },
      },
    ],
    ['hook missing template', { hooks: { before_run: [{ hook_id: 'bad', command_template: 'missing' }], after_run: [] } }],
    ['fallback missing command source', { fallback: { mode: 'codex_exec' } }],
    [
      'fallback with weakening override',
      {
        fallback: {
          mode: 'codex_exec',
          command: { executable: 'codex', args: ['exec'], cwd: 'workspace_root', source_write_policy: 'read_only' },
          source_write_policy: 'path_policy_scoped',
        },
      },
    ],
  ])('rejects invalid hook/fallback materialization: %s', (_label, document) => {
    expect(() =>
      buildPackageRuntimePolicySnapshot({
        loadedPolicy: runtimePolicyFromDocument({ document, markdownBody: '', loadedAt }),
        executionPackageChecks: [],
        executionPackagePathPolicy: emptyPackagePathPolicy,
        validationStrategy: 'checks_required',
        sourceMutationPolicy: 'path_policy_scoped',
      }),
    ).toThrowError(expect.objectContaining({ public_code: 'policy_snapshot_invalid' }));
  });

  it('rejects duplicate repo policy check ids and missing command templates', () => {
    const duplicatePolicy = runtimePolicyFromDocument({
      document: {
        checks: {
          required: [
            { check_id: 'lint', command: { executable: 'pnpm', args: ['lint'], cwd: 'workspace_root' } },
            { check_id: 'lint', command: { executable: 'pnpm', args: ['test'], cwd: 'workspace_root' } },
          ],
        },
      },
      markdownBody: '',
      loadedAt,
    });

    expect(() =>
      buildPackageRuntimePolicySnapshot({
        loadedPolicy: duplicatePolicy,
        executionPackageChecks: [packageCheck],
        executionPackagePathPolicy: emptyPackagePathPolicy,
        validationStrategy: 'checks_required',
        sourceMutationPolicy: 'path_policy_scoped',
      }),
    ).toThrowError(expect.objectContaining({ public_code: 'policy_snapshot_invalid' }));

    const missingTemplatePolicy = runtimePolicyFromDocument({
      document: { checks: { required: [{ check_id: 'lint', command_template: 'missing' }] } },
      markdownBody: '',
      loadedAt,
    });

    expect(() =>
      buildPackageRuntimePolicySnapshot({
        loadedPolicy: missingTemplatePolicy,
        executionPackageChecks: [packageCheck],
        executionPackagePathPolicy: emptyPackagePathPolicy,
        validationStrategy: 'checks_required',
        sourceMutationPolicy: 'path_policy_scoped',
      }),
    ).toThrowError(expect.objectContaining({ public_code: 'policy_snapshot_invalid' }));
  });

  it('creates reviewed safe-default snapshots only for missing WORKFLOW.md with approval evidence and no source changes', () => {
    const missingPolicy = {
      status: 'missing',
      policy_source_path: RUNTIME_POLICY_SOURCE_PATH,
      policy_loaded_at: loadedAt,
      policy_last_known_good: false,
      blocker_code: 'runtime_policy_missing',
      diagnostics: [{ code: 'runtime_policy_missing', message: 'WORKFLOW.md is missing.', retryable: false }],
    } as const;
    const safeDefaultApprovalEvidence = {
      evidence_type: 'decision' as const,
      ref_id: 'decision-1',
      approved_by_actor_id: 'actor-reviewer',
      approved_by_actor_class: 'human' as const,
      approved_at: loadedAt,
      summary: 'Reviewed missing WORKFLOW.md safe default.',
    };

    const snapshot = buildPackageRuntimePolicySnapshot({
      loadedPolicy: missingPolicy,
      executionPackageChecks: [],
      executionPackagePathPolicy: emptyPackagePathPolicy,
      validationStrategy: 'checks_required',
      sourceMutationPolicy: 'no_source_changes',
      safeDefaultApprovalEvidence,
    });

    expect(snapshot).toMatchObject({
      snapshot_origin: 'reviewed_safe_default',
      policy_source_path: RUNTIME_POLICY_SOURCE_PATH,
      path_policy: { allowed_paths: [], forbidden_paths: [] },
      source_mutation_policy: 'no_source_changes',
      safe_default_approval_evidence: safeDefaultApprovalEvidence,
      network_policy_digest: 'network-disabled',
    });

    expect(() =>
      buildPackageRuntimePolicySnapshot({
        loadedPolicy: missingPolicy,
        executionPackageChecks: [],
        executionPackagePathPolicy: emptyPackagePathPolicy,
        validationStrategy: 'checks_required',
        sourceMutationPolicy: 'path_policy_scoped',
        safeDefaultApprovalEvidence,
      }),
    ).toThrowError(expect.objectContaining({ public_code: 'policy_snapshot_invalid' }));

    expect(() =>
      buildPackageRuntimePolicySnapshot({
        loadedPolicy: missingPolicy,
        executionPackageChecks: [],
        executionPackagePathPolicy: emptyPackagePathPolicy,
        validationStrategy: 'checks_required',
        sourceMutationPolicy: 'no_source_changes',
      }),
    ).toThrowError(expect.objectContaining({ public_code: 'policy_snapshot_invalid' }));

    expect(() =>
      buildPackageRuntimePolicySnapshot({
        loadedPolicy: missingPolicy,
        executionPackageChecks: [],
        executionPackagePathPolicy: emptyPackagePathPolicy,
        validationStrategy: 'checks_required',
        sourceMutationPolicy: 'no_source_changes',
        safeDefaultApprovalEvidence,
        validationEvidenceRefs: [
          {
            kind: 'validation',
            name: 'extra evidence',
            content_type: 'text/markdown',
            local_ref: 'artifacts/policy/extra.md',
          },
        ],
      }),
    ).toThrowError(expect.objectContaining({ public_code: 'policy_snapshot_invalid' }));

    expect(() =>
      buildPackageRuntimePolicySnapshot({
        loadedPolicy: missingPolicy,
        executionPackageChecks: [],
        executionPackagePathPolicy: emptyPackagePathPolicy,
        validationStrategy: 'checks_required',
        sourceMutationPolicy: 'no_source_changes',
        safeDefaultApprovalEvidence: { ...safeDefaultApprovalEvidence, approved_by_actor_class: 'automation_daemon' },
      }),
    ).toThrowError(expect.objectContaining({ public_code: 'policy_snapshot_invalid' }));
  });

  it('uses a typed error with public blocker codes for snapshot failures', () => {
    try {
      buildPackageRuntimePolicySnapshot({
        loadedPolicy: runtimePolicyFromDocument({ document: {}, markdownBody: '', loadedAt }),
        executionPackageChecks: [{ ...packageCheck, command: 'pnpm test && pnpm lint' }],
        executionPackagePathPolicy: emptyPackagePathPolicy,
        validationStrategy: 'checks_required',
        sourceMutationPolicy: 'path_policy_scoped',
      });
      expect.unreachable('snapshot capture should reject shell command text');
    } catch (error) {
      expect(error).toBeInstanceOf(RuntimePolicyError);
      expect(error).toMatchObject({ public_code: 'required_check_command_invalid' });
    }
  });
});
