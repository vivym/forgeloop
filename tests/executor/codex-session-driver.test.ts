import { chmod, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { describe, expect, it, vi } from 'vitest';

import type { ArtifactRef } from '@forgeloop/contracts';
import type { RunRuntimeMetadata, RuntimeGovernorProvenance } from '@forgeloop/domain';
import {
  buildCodexExecArgs,
  CodexAppServerDriver,
  CodexAppServerProcessTransport,
  CodexExecFallbackDriver,
  LocalCodexRawLogStore,
  confirmAppServerDangerousMode,
  createCodexAppServerDriverForTest,
  resourceLimitDigest,
  resolveEffectiveDangerousMode,
  type ArtifactWriter,
  type HookRunner,
  type LocalCodexRuntimeSafety,
  type PathSafety,
  type ResourceGovernor,
  type ResourceGovernorReadiness,
  type ResourceGovernorRunInput,
  type LeaseCommandInvocationInput,
  type RuntimeSafetyAttestation,
  type SandboxLease,
  type SandboxLeaseInput,
  type StructuredCommandResult,
} from '../../packages/executor/src';

import { createRunSpec } from './test-fixtures';

const runtimeMetadata = (overrides: Partial<RunRuntimeMetadata> = {}): RunRuntimeMetadata => ({
  durability_mode: 'durable',
  recovery_attempt_count: 0,
  effective_dangerous_mode: 'confirmed',
  ...overrides,
});

const sha = 'sha256:0000000000000000000000000000000000000000000000000000000000000000';
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

class RecordingGovernor implements ResourceGovernor {
  readonly governorId = 'fallback-governor';
  readonly provenance: RuntimeGovernorProvenance = 'test_only_mock';
  readonly calls: ResourceGovernorRunInput[] = [];
  readonly leases: SandboxLeaseInput[] = [];
  readonly leaseInvocations: LeaseCommandInvocationInput[] = [];
  readonly #usedNonces = new Set<string>();
  readonly #usedCommandDigests = new Set<string>();

  constructor(private readonly readiness: ResourceGovernorReadiness = { status: 'ready', governor_id: 'fallback-governor', provenance: 'test_only_mock' }) {}

  async checkReadiness(): Promise<ResourceGovernorReadiness> {
    return this.readiness;
  }

  async createRunExecutionAttestation(): Promise<RuntimeSafetyAttestation> {
    throw new Error('not used');
  }

  async createRunLease(input: SandboxLeaseInput): Promise<SandboxLease> {
    this.leases.push(input);
    return {
      lease_id: `lease-${this.leases.length}`,
      run_id: input.runId,
      worker_identity: input.workerIdentity,
      workspace_root: input.workspaceRoot,
      artifact_root: input.artifactRoot,
      sandbox_output_root: input.sandboxOutputRoot,
      policy_digest: input.policyDigest,
      policy_snapshot_version: input.policySnapshotVersion,
      env_policy_digest: input.envPolicyDigest,
      command_policy_digest: input.commandPolicyDigest,
      mount_policy_digest: input.mountPolicyDigest,
      network_policy_digest: input.networkPolicyDigest,
      resource_limit_digest: input.resourceLimitDigest,
      resource_limits: input.resourceLimits,
      sandbox_config_digest: sha,
      sandbox_wrapper_environment_digest: sha,
      prompt_digest: input.promptDigest,
      run_spec_digest: input.runSpecDigest,
      attestation: {
        attestation_scope: 'run_execution',
        hard_limit_mode: 'enforcing',
        environment: input.environment,
        executor_type: input.executorType,
        workflow_only: input.workflowOnly,
        governor_id: this.governorId,
        governor_provenance: this.provenance,
        checked_at: input.now,
        max_command_timeout_ms: input.resourceLimits.timeout_ms,
        max_hook_timeout_ms: input.resourceLimits.timeout_ms,
        max_command_output_bytes: input.resourceLimits.output_limit_bytes,
        max_run_output_bytes: input.resourceLimits.run_output_limit_bytes,
        supports_cpu_limit: true,
        supports_memory_limit: true,
        supports_process_limit: true,
        supports_fd_limit: true,
        supports_workspace_disk_limit: true,
        supports_artifact_size_limit: true,
        network_mode: input.networkMode,
        project_id: input.projectId,
        repo_id: input.repoId,
        execution_package_id: input.executionPackageId,
        expected_package_version: input.expectedPackageVersion,
        run_id: input.runId,
        policy_digest: input.policyDigest,
        policy_snapshot_version: input.policySnapshotVersion,
        env_policy_digest: input.envPolicyDigest,
        command_policy_digest: input.commandPolicyDigest,
        mount_policy_digest: input.mountPolicyDigest,
        network_policy_digest: input.networkPolicyDigest,
        resource_limit_digest: input.resourceLimitDigest,
        resource_limits: input.resourceLimits,
        workspace_root: input.workspaceRoot,
        artifact_root: input.artifactRoot,
        sandbox_output_root: input.sandboxOutputRoot,
        expires_at: input.expiresAt,
      } as RuntimeSafetyAttestation,
      expires_at: input.expiresAt,
      command_invocation_nonce_required: true,
    };
  }

  async consumeLeaseCommandInvocation(input: LeaseCommandInvocationInput): Promise<{ ok: true }> {
    if (this.#usedNonces.has(input.commandInvocationNonce)) {
      throw Object.assign(new Error('resource_governor_nonce_replay'), { code: 'resource_governor_nonce_replay' });
    }
    if (this.#usedCommandDigests.has(input.commandDigest)) {
      throw Object.assign(new Error('resource_governor_nonce_replay'), { code: 'resource_governor_nonce_replay' });
    }
    this.#usedNonces.add(input.commandInvocationNonce);
    this.#usedCommandDigests.add(input.commandDigest);
    this.leaseInvocations.push(input);
    return { ok: true };
  }

  async run(input: ResourceGovernorRunInput): Promise<StructuredCommandResult> {
    this.calls.push(input);
    return {
      exit_code: 0,
      timed_out: false,
      stdout_truncated: false,
      stderr_truncated: false,
      visibility: 'internal',
      public_summary: 'fallback ok',
    };
  }
}

class InterruptRejectingGovernor extends RecordingGovernor {
  override async consumeLeaseCommandInvocation(input: LeaseCommandInvocationInput): Promise<{ ok: true }> {
    if (input.expected.commandId === 'app_server:turn/interrupt') {
      throw Object.assign(new Error('resource_governor_lease_invalid'), { code: 'resource_governor_lease_invalid' });
    }
    return super.consumeLeaseCommandInvocation(input);
  }
}

class RecordingArtifactWriter {
  readonly writes: Array<Parameters<ArtifactWriter['writeText']>[0]> = [];

  async writeText(input: Parameters<ArtifactWriter['writeText']>[0]): Promise<ArtifactRef> {
    this.writes.push(input);
    return {
      kind: input.kind,
      name: input.name,
      content_type: input.contentType,
      digest: sha,
      local_ref: `/artifacts/${input.name}`,
    };
  }
}

const fallbackRuntimeSafety = (
  overrides: Partial<LocalCodexRuntimeSafety> = {},
): LocalCodexRuntimeSafety => {
  const limitsDigest = resourceLimitDigest(resourceLimits);
  return {
    config: {
      sandbox: {
        executable_path: '/bin/sh',
        config_digest: sha,
        default_cpu_ms: 1_000,
        default_memory_mb: 512,
        default_pids: 32,
        default_fds: 64,
        default_workspace_bytes: 1_048_576,
        default_artifact_bytes: 1_048_576,
      },
      trusted_toolchains: {},
      artifact_root: '/artifacts',
    },
    frozenSnapshot: {
      policy_snapshot_version: 1,
      policy_digest: sha,
      policy_source_path: 'WORKFLOW.md',
      policy_loaded_at: '2026-05-05T00:00:00.000Z',
      policy_last_known_good: true,
      hooks: { before_run: [], after_run: [] },
      frozen_hook_specs: { before_run: [], after_run: [] },
      command_policy: { trusted_toolchain: 'default', safe_git_profile: 'forgeloop_default' },
      check_policy: { required: [] },
      env_policy: { allow: [] },
      workspace_policy: { worktree_dir: '.worktrees', cleanup: 'run_workspace_only', source_snapshot: 'required' },
      path_policy: { allowed_paths: ['packages/executor/src/**'], forbidden_paths: [] },
      codex_runtime_mode: { primary_executor: 'mock', network_mode: 'disabled' },
      prompt_policy: { include_workflow_body: true, body_visibility: 'internal' },
      artifact_visibility_policy: { default_visibility: 'internal' },
      fallback_policy: {
        mode: 'codex_exec',
        command: {
          executable: 'codex',
          args: ['exec', '--json', '--dangerously-bypass-approvals-and-sandbox'],
          cwd: 'workspace_root',
          timeout_ms: 30_000,
          output_limit_bytes: 100_000,
          visibility: 'internal',
          source_write_policy: 'read_only',
        },
      },
      env_policy_digest: sha,
      command_policy_digest: sha,
      mount_policy_digest: sha,
      network_policy_digest: 'network-disabled',
      safe_git_profile: 'forgeloop_default',
      source_mutation_policy: 'path_policy_scoped',
      validation_strategy: 'checks_required',
      validation_public_summary: 'frozen',
      frozen_command_check_policy: { required_checks: [] },
    },
    pathSafety: {} as PathSafety,
    artifactWriter: new RecordingArtifactWriter() as unknown as ArtifactWriter,
    bootstrapGovernor: new RecordingGovernor(),
    runGovernor: new RecordingGovernor(),
    hookRunner: {
      runBeforeRun: async () => ({ ok: true, diagnostics: [] }),
      runAfterRun: async (input) => ({
        terminalStatus: input.terminalStatus,
        reviewFinalizationEligible: input.reviewFinalizationEligible,
        diagnostics: [],
      }),
    } satisfies HookRunner,
    hookCommandContext: {
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
      networkMode: 'disabled',
      resourceLimits,
      trustedToolchains: { root_paths: ['/bin'], executable_paths: { codex: '/bin/sh' }, path_entries: ['/bin'], writable: false },
    },
    maxHookTimeoutMs: 5_000,
    ...overrides,
  };
};

const createGovernedAppServerDriverForTest = (
  transport: Parameters<typeof createCodexAppServerDriverForTest>[0],
  options: {
    runtimeSafety?: LocalCodexRuntimeSafety;
    nonceFactory?: () => string;
    now?: () => string;
  } = {},
) =>
  createCodexAppServerDriverForTest(transport, {
    runtimeSafety: options.runtimeSafety ?? fallbackRuntimeSafety(),
    ...(options.nonceFactory === undefined ? {} : { nonceFactory: options.nonceFactory }),
    ...(options.now === undefined ? {} : { now: options.now }),
  });

const withTimeout = async <T>(promise: Promise<T>, message: string, timeoutMs = 250): Promise<T> =>
  Promise.race([
    promise,
    delay(timeoutMs).then(() => {
      throw new Error(message);
    }),
  ]);

const collectUntilTerminal = async (items: AsyncIterable<unknown>): Promise<unknown[]> => {
  const collected: unknown[] = [];
  for await (const item of items) {
    collected.push(item);
    if (typeof item === 'object' && item !== null && (item as { kind?: unknown }).kind === 'terminal') {
      break;
    }
  }

  return collected;
};

const missingCodexBinary = () => join(tmpdir(), `missing-codex-${Date.now()}-${Math.random().toString(16).slice(2)}`);

const waitForProcessExit = async (pid: number): Promise<void> => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    await delay(25);
  }

  throw new Error(`Process ${pid} was still running.`);
};

const waitForProtocolMethods = async (logPath: string, expected: string[]): Promise<void> => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const messages = (await readFile(logPath, 'utf8'))
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as { method: string });

      if (JSON.stringify(messages.map((message) => message.method)) === JSON.stringify(expected)) {
        return;
      }
    } catch {
      // The fake process creates the protocol log lazily after the first message.
    }
    await delay(25);
  }

  throw new Error(`Timed out waiting for protocol methods: ${expected.join(', ')}`);
};

describe('codex exec fallback driver boundary', () => {
  it('builds dangerous JSON exec args with prompt artifact transport', () => {
    const args = buildCodexExecArgs({ promptRef: 'artifacts/prompt.txt' });

    expect(args).toEqual(['exec', '--json', '--dangerously-bypass-approvals-and-sandbox', '--prompt-artifact', 'artifacts/prompt.txt']);
    expect(args).not.toContain('--sandbox');
    expect(args).not.toContain('--yolo');
    expect(args).not.toContain('implement task');
  });

  it('builds dangerous JSON resume args with prompt artifact transport', () => {
    expect(buildCodexExecArgs({ promptRef: 'artifacts/prompt.txt', threadId: 'thread-1' })).toEqual([
      'exec',
      'resume',
      'thread-1',
      '--json',
      '--dangerously-bypass-approvals-and-sandbox',
      '--prompt-artifact',
      'artifacts/prompt.txt',
    ]);
  });

  it('denies fallback unless the frozen policy allows codex_exec', async () => {
    const driver = new CodexExecFallbackDriver();

    await expect(
      withTimeout(
        collectUntilTerminal(driver.startRun({ runSpec: createRunSpec(), workspacePath: tmpdir() })),
        'Codex exec fallback denial did not terminate.',
      ),
    ).resolves.toEqual([
      expect.objectContaining({
        kind: 'terminal',
        status: 'failed',
        failure: expect.objectContaining({
          kind: 'executor_error',
          message: expect.stringContaining('fallback_denied_by_policy'),
          retryable: false,
        }),
      }),
    ]);
  });

  it('runs allowed fallback through the run governor with internal prompt artifact binding', async () => {
    const runGovernor = new RecordingGovernor();
    const artifactWriter = new RecordingArtifactWriter();
    const safety = fallbackRuntimeSafety({
      runGovernor,
      artifactWriter: artifactWriter as unknown as ArtifactWriter,
    });
    const driver = new CodexExecFallbackDriver({ runtimeSafety: safety });

    await expect(
      collectUntilTerminal(driver.startRun({ runSpec: createRunSpec({ objective: 'implement task' }), workspacePath: tmpdir() })),
    ).resolves.toEqual([
      expect.objectContaining({
        kind: 'terminal',
        status: 'succeeded',
        summary: 'fallback ok',
      }),
    ]);

    expect(artifactWriter.writes).toEqual([
      expect.objectContaining({
        kind: 'raw_metadata',
        name: 'codex-exec-fallback-prompt.txt',
        visibility: 'internal',
        content: 'implement task',
      }),
    ]);
    const fallbackCall = runGovernor.calls.find(
      (call) => call.scope === 'run' && call.bindings.commandId === 'fallback:codex_exec',
    );
    expect(fallbackCall?.command.args).toEqual(
      expect.arrayContaining(['exec', '--json', '--dangerously-bypass-approvals-and-sandbox', '--prompt-artifact', '/artifacts/codex-exec-fallback-prompt.txt']),
    );
    expect(fallbackCall?.command.args.join('\n')).not.toContain('implement task');
    expect(fallbackCall?.command.visibility).toBe('internal');
    expect(fallbackCall?.command.source_write_policy).toBe('read_only');
    expect(fallbackCall?.scope === 'run' ? fallbackCall.bindings.workspaceRoot : undefined).toBe(tmpdir());
    expect(fallbackCall?.scope === 'run' ? fallbackCall.sandboxOutputArtifacts?.stderr?.visibility : undefined).toBe('internal');
  });

  it('rejects fallback input continuation without a governed run context', async () => {
    const driver = new CodexExecFallbackDriver({ runtimeSafety: fallbackRuntimeSafety() });

    await expect(
      driver.sendInput({
        message: 'continue',
        runtimeMetadata: runtimeMetadata({ codex_thread_id: 'thread-1' }),
      }),
    ).rejects.toThrow(/fallback_denied_by_policy/i);
  });
});

describe('codex app-server dangerous mode confirmation', () => {
  it('resolves confirmed dangerous mode only for never approval and danger-full-access sandbox', () => {
    expect(
      resolveEffectiveDangerousMode({
        approvalPolicy: 'never',
        sandbox: { type: 'dangerFullAccess' },
      }),
    ).toBe('confirmed');
  });

  it('rejects app-server config that is not fully dangerous mode', async () => {
    await expect(
      confirmAppServerDangerousMode({
        approvalPolicy: 'on-request',
        sandbox: { type: 'dangerFullAccess' },
      }),
    ).rejects.toThrow(/dangerous mode/i);
  });

  it.each([
    {
      approvalPolicy: 'never',
      sandbox: { type: 'danger-full-access' },
    },
    {
      approvalPolicy: 'never',
      sandbox: 'danger-full-access',
    },
    {
      approvalPolicy: 'never',
      sandbox: { type: 'workspaceWrite' },
    },
    {
      approvalPolicy: 'on-request',
      sandbox: { type: 'dangerFullAccess' },
    },
  ])('does not confirm non-response dangerous mode config %#', (config) => {
    expect(resolveEffectiveDangerousMode(config)).toBe('unconfirmed');
  });
});

describe('codex app-server driver input routing', () => {
  it('uses fallback before app-server start when no runtime safety lease is available', async () => {
    const request = vi.fn(async () => ({ thread: { id: 'thread-1' } }));
    const driver = new CodexAppServerDriver({ transport: { request } });

    await expect(
      collectUntilTerminal(driver.startRun({ runSpec: createRunSpec(), workspacePath: tmpdir() })),
    ).resolves.toEqual([
      expect.objectContaining({
        kind: 'event',
        event: expect.objectContaining({
          event_type: 'driver_fallback_used',
          payload: expect.objectContaining({
            reason: expect.stringContaining('primary_executor_governor_unavailable'),
          }),
        }),
      }),
    ]);
    expect(request).not.toHaveBeenCalled();
  });

  it('falls back when an app-server command invocation nonce is reused', async () => {
    const request = vi.fn(async (method: string) =>
      method === 'thread/start'
        ? {
            thread: { id: 'thread-1' },
            approvalPolicy: 'never',
            sandbox: { type: 'dangerFullAccess' },
          }
        : { turn: { id: 'turn-1' } },
    );
    const driver = createGovernedAppServerDriverForTest(
      {
        request,
        notifications: async function* () {
          yield {
            method: 'turn/completed',
            params: {
              threadId: 'thread-1',
              turn: { id: 'turn-1', status: 'completed', error: null },
            },
          };
        },
      },
      { nonceFactory: () => 'reused-nonce' },
    );

    await expect(
      collectUntilTerminal(driver.startRun({ runSpec: createRunSpec(), workspacePath: tmpdir() })),
    ).resolves.toEqual([
      expect.objectContaining({ kind: 'event', event: expect.objectContaining({ event_type: 'thread_started' }) }),
      expect.objectContaining({
        kind: 'event',
        event: expect.objectContaining({
          event_type: 'driver_fallback_used',
          payload: expect.objectContaining({
            reason: 'runtime_attestation_invalid',
          }),
        }),
      }),
    ]);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('binds app-server leases and invocations to runtime safety roots and digests', async () => {
    const governor = new RecordingGovernor();
    const runtimeSafety = fallbackRuntimeSafety({ runGovernor: governor });
    let nonce = 0;
    const workspacePath = join(tmpdir(), 'forgeloop-app-server-workspace');
    const driver = createGovernedAppServerDriverForTest(
      {
        request: async (method: string) =>
          method === 'thread/start'
            ? {
                thread: { id: 'thread-1' },
                approvalPolicy: 'never',
                sandbox: { type: 'dangerFullAccess' },
              }
            : { turn: { id: 'turn-1' } },
        notifications: async function* () {
          yield {
            method: 'turn/completed',
            params: {
              threadId: 'thread-1',
              turn: { id: 'turn-1', status: 'completed', error: null },
            },
          };
        },
      },
      {
        runtimeSafety,
        nonceFactory: () => `nonce-${++nonce}`,
        now: () => '2026-05-05T00:00:00.000Z',
      },
    );

    await collectUntilTerminal(driver.startRun({ runSpec: createRunSpec(), workspacePath }));

    expect(governor.leases).toHaveLength(1);
    expect(governor.leases[0]).toMatchObject({
      runId: 'run-1',
      workspaceRoot: workspacePath,
      artifactRoot: '/artifacts/run-1',
      sandboxOutputRoot: '/sandbox-output/run-1',
      policyDigest: sha,
      policySnapshotVersion: 1,
      envPolicyDigest: sha,
      commandPolicyDigest: sha,
      mountPolicyDigest: sha,
      networkPolicyDigest: 'network-disabled',
      resourceLimitDigest: resourceLimitDigest(resourceLimits),
      executorType: 'local_codex',
      workflowOnly: false,
      environment: 'test',
      projectId: 'project-1',
      repoId: 'repo-1',
      executionPackageId: 'execution-package-1',
      expectedPackageVersion: 1,
      workerIdentity: 'forgeloop-codex-app-server',
      expiresAt: '2026-05-05T00:05:00.000Z',
      promptDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      runSpecDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
    });
    expect(governor.leaseInvocations.map((input) => input.expected.commandId)).toEqual([
      'app_server:thread/start',
      'app_server:turn/start',
    ]);
    expect(governor.leaseInvocations.map((input) => input.commandInvocationNonce)).toEqual(['nonce-1', 'nonce-2']);
    expect(new Set(governor.leaseInvocations.map((input) => input.commandDigest)).size).toBe(2);
    expect(governor.leaseInvocations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          expected: expect.objectContaining({
            workspaceRoot: workspacePath,
            artifactRoot: '/artifacts/run-1',
            sandboxOutputRoot: '/sandbox-output/run-1',
            promptDigest: governor.leases[0].promptDigest,
            runSpecDigest: governor.leases[0].runSpecDigest,
          }),
        }),
      ]),
    );
  });

  it('allows repeated app-server input text when each invocation has a fresh nonce', async () => {
    const governor = new RecordingGovernor();
    const runtimeSafety = fallbackRuntimeSafety({ runGovernor: governor });
    let nonce = 0;
    const request = vi.fn(async (method: string) =>
      method === 'thread/start'
        ? {
            thread: { id: 'thread-1' },
            approvalPolicy: 'never',
            sandbox: { type: 'dangerFullAccess' },
          }
        : { turn: { id: 'turn-1' } },
    );
    const driver = createGovernedAppServerDriverForTest(
      {
        request,
        notifications: async function* () {
          yield {
            method: 'turn/completed',
            params: {
              threadId: 'thread-1',
              turn: { id: 'turn-1', status: 'completed', error: null },
            },
          };
        },
      },
      { runtimeSafety, nonceFactory: () => `nonce-${++nonce}` },
    );
    await collectUntilTerminal(driver.startRun({ runSpec: createRunSpec(), workspacePath: tmpdir() }));
    request.mockClear();

    await driver.sendInput({ message: 'same prompt', runtimeMetadata: runtimeMetadata({ codex_thread_id: 'thread-1' }) });
    await driver.sendInput({ message: 'same prompt', runtimeMetadata: runtimeMetadata({ codex_thread_id: 'thread-1' }) });

    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenNthCalledWith(1, 'turn/start', {
      input: [{ type: 'text', text: 'same prompt', text_elements: [] }],
      threadId: 'thread-1',
    });
    expect(request).toHaveBeenNthCalledWith(2, 'turn/start', {
      input: [{ type: 'text', text: 'same prompt', text_elements: [] }],
      threadId: 'thread-1',
    });
    expect(new Set(governor.leaseInvocations.map((input) => input.commandDigest)).size).toBe(4);
  });

  it('initializes the app-server transport before starting a thread', async () => {
    const calls: string[] = [];
    const driver = createGovernedAppServerDriverForTest({
      initialize: async () => {
        calls.push('initialize');
      },
      request: async (method: string) => {
        calls.push(method);
        return method === 'thread/start'
          ? {
              thread: { id: 'thread-1' },
              approvalPolicy: 'never',
              sandbox: { type: 'dangerFullAccess' },
            }
          : { turn: { id: 'turn-1' } };
      },
      notifications: async function* () {
        yield {
          method: 'turn/completed',
          params: {
            threadId: 'thread-1',
            turn: { id: 'turn-1', status: 'completed', error: null },
          },
        };
      },
    });

    await collectUntilTerminal(driver.startRun({ runSpec: createRunSpec(), workspacePath: tmpdir() }));

    expect(calls.slice(0, 3)).toEqual(['initialize', 'thread/start', 'turn/start']);
  });

  it('steers an active turn or explicit target turn', async () => {
    const request = vi.fn(async (method: string) =>
      method === 'thread/start'
        ? {
            thread: { id: 'thread-1' },
            approvalPolicy: 'never',
            sandbox: { type: 'dangerFullAccess' },
          }
        : { turn: { id: 'turn-1' }, ok: true },
    );
    const driver = createGovernedAppServerDriverForTest({
      request,
      notifications: async function* () {
        yield {
          method: 'turn/completed',
          params: {
            threadId: 'thread-1',
            turn: { id: 'turn-1', status: 'completed', error: null },
          },
        };
      },
    });
    await collectUntilTerminal(driver.startRun({ runSpec: createRunSpec(), workspacePath: tmpdir() }));
    request.mockClear();

    await expect(
      driver.sendInput({
        message: 'adjust course',
        runtimeMetadata: runtimeMetadata({
          codex_thread_id: 'thread-1',
          active_turn_id: 'turn-1',
        }),
      }),
    ).resolves.toMatchObject({ continuity: 'turn_steer' });

    await expect(
      driver.sendInput({
        message: 'target turn',
        targetTurnId: 'turn-2',
        runtimeMetadata: runtimeMetadata({ codex_thread_id: 'thread-1' }),
      }),
    ).resolves.toMatchObject({ continuity: 'turn_steer' });

    expect(request).toHaveBeenNthCalledWith(1, 'turn/steer', {
      input: [{ type: 'text', text: 'adjust course', text_elements: [] }],
      threadId: 'thread-1',
      expectedTurnId: 'turn-1',
    });
    expect(request).toHaveBeenNthCalledWith(2, 'turn/steer', {
      input: [{ type: 'text', text: 'target turn', text_elements: [] }],
      threadId: 'thread-1',
      expectedTurnId: 'turn-2',
    });
  });

  it('starts a new turn when a thread exists without an active turn', async () => {
    const request = vi.fn(async (method: string) =>
      method === 'thread/start'
        ? {
            thread: { id: 'thread-1' },
            approvalPolicy: 'never',
            sandbox: { type: 'dangerFullAccess' },
          }
        : { turn: { id: method === 'turn/start' ? 'turn-3' : 'turn-1' } },
    );
    const driver = createGovernedAppServerDriverForTest({
      request,
      notifications: async function* () {
        yield {
          method: 'turn/completed',
          params: {
            threadId: 'thread-1',
            turn: { id: 'turn-1', status: 'completed', error: null },
          },
        };
      },
    });
    await collectUntilTerminal(driver.startRun({ runSpec: createRunSpec(), workspacePath: tmpdir() }));
    request.mockClear();

    await expect(
      driver.sendInput({
        message: 'next turn',
        runtimeMetadata: runtimeMetadata({ codex_thread_id: 'thread-1' }),
      }),
    ).resolves.toMatchObject({ continuity: 'thread_continuation', turnId: 'turn-3' });

    expect(request).toHaveBeenCalledWith('turn/start', {
      input: [{ type: 'text', text: 'next turn', text_elements: [] }],
      threadId: 'thread-1',
    });
  });

  it('consumes the app-server lease before cancelling an active turn', async () => {
    const governor = new RecordingGovernor();
    const runtimeSafety = fallbackRuntimeSafety({ runGovernor: governor });
    let nonce = 0;
    const request = vi.fn(async (method: string) =>
      method === 'thread/start'
        ? {
            response: {
              thread_id: 'thread-1',
              approvalPolicy: 'never',
              sandbox: { type: 'dangerFullAccess' },
            },
          }
        : { response: { turn_id: 'turn-1' } },
    );
    const driver = createGovernedAppServerDriverForTest(
      {
        request,
        notifications: async function* () {
          yield {
            method: 'turn/completed',
            params: {
              threadId: 'thread-1',
              turn: { id: 'turn-1', status: 'completed', error: null },
            },
          };
        },
      },
      { runtimeSafety, nonceFactory: () => `nonce-${++nonce}` },
    );
    await collectUntilTerminal(driver.startRun({ runSpec: createRunSpec(), workspacePath: tmpdir() }));
    request.mockClear();

    await expect(
      driver.cancelRun({
        runtimeMetadata: runtimeMetadata({ codex_thread_id: 'thread-1', active_turn_id: 'turn-1' }),
      }),
    ).resolves.toMatchObject({ acknowledged: true, threadId: 'thread-1', turnId: 'turn-1' });

    expect(governor.leaseInvocations.map((input) => input.expected.commandId)).toEqual([
      'app_server:thread/start',
      'app_server:turn/start',
      'app_server:turn/interrupt',
    ]);
    expect(request).toHaveBeenCalledWith('turn/interrupt', { threadId: 'thread-1', turnId: 'turn-1' });
  });

  it('does not send app-server cancel when turn interrupt lease consumption fails', async () => {
    const governor = new InterruptRejectingGovernor();
    const runtimeSafety = fallbackRuntimeSafety({ runGovernor: governor });
    let nonce = 0;
    const request = vi.fn(async (method: string) =>
      method === 'thread/start'
        ? {
            thread: { id: 'thread-1' },
            approvalPolicy: 'never',
            sandbox: { type: 'dangerFullAccess' },
          }
        : { turn: { id: 'turn-1' } },
    );
    const driver = createGovernedAppServerDriverForTest(
      {
        request,
        notifications: async function* () {
          yield {
            method: 'turn/completed',
            params: {
              threadId: 'thread-1',
              turn: { id: 'turn-1', status: 'completed', error: null },
            },
          };
        },
      },
      { runtimeSafety, nonceFactory: () => `nonce-${++nonce}` },
    );
    await collectUntilTerminal(driver.startRun({ runSpec: createRunSpec(), workspacePath: tmpdir() }));
    request.mockClear();

    await expect(
      driver.cancelRun({
        runtimeMetadata: runtimeMetadata({ codex_thread_id: 'thread-1', active_turn_id: 'turn-1' }),
      }),
    ).rejects.toThrow(/resource_governor_lease_invalid/);
    expect(request).not.toHaveBeenCalledWith('turn/interrupt', expect.anything());
  });

  it('terminates startRun when a turn/completed notification reports completion', async () => {
    const request = vi.fn(async (method: string) =>
      method === 'thread/start'
        ? {
            thread: { id: 'thread-1' },
            approvalPolicy: 'never',
            sandbox: { type: 'dangerFullAccess' },
          }
        : { turn: { id: 'turn-1' } },
    );
    const driver = createGovernedAppServerDriverForTest({
      request,
      notifications: async function* () {
        yield {
          method: 'item/agentMessage/delta',
          params: { threadId: 'thread-1', turnId: 'turn-1', delta: 'done' },
        };
        yield {
          method: 'turn/completed',
          params: {
            threadId: 'thread-1',
            turn: { id: 'turn-1', status: 'completed', error: null },
          },
        };
        await new Promise(() => undefined);
      },
    });

    await expect(
      withTimeout(
        collectUntilTerminal(driver.startRun({ runSpec: createRunSpec(), workspacePath: tmpdir() })),
        'Codex app-server startRun did not terminate after turn/completed.',
      ),
    ).resolves.toEqual([
      expect.objectContaining({ kind: 'event', event: expect.objectContaining({ event_type: 'thread_started' }) }),
      expect.objectContaining({ kind: 'event', event: expect.objectContaining({ event_type: 'turn_started' }) }),
      expect.objectContaining({ kind: 'event', event: expect.objectContaining({ event_type: 'agent_message_delta' }) }),
      expect.objectContaining({
        kind: 'terminal',
        status: 'succeeded',
        summary: 'Codex app-server turn completed.',
      }),
    ]);
  });

  it('terminates startRun when Codex 0.132 reports thread idle after assistant output', async () => {
    const request = vi.fn(async (method: string) =>
      method === 'thread/start'
        ? {
            thread: { id: 'thread-1' },
            approvalPolicy: 'never',
            sandbox: { type: 'dangerFullAccess' },
          }
        : { turn: { id: 'turn-1' } },
    );
    const driver = createGovernedAppServerDriverForTest({
      request,
      notifications: async function* () {
        yield {
          method: 'item/agentMessage/delta',
          params: { threadId: 'thread-1', turnId: 'turn-1', delta: 'done' },
        };
        yield {
          method: 'thread/status/changed',
          params: {
            threadId: 'thread-1',
            status: { type: 'idle' },
          },
        };
        await new Promise(() => undefined);
      },
    });

    await expect(
      withTimeout(
        collectUntilTerminal(driver.startRun({ runSpec: createRunSpec(), workspacePath: tmpdir() })),
        'Codex app-server startRun did not terminate after idle thread status.',
      ),
    ).resolves.toEqual([
      expect.objectContaining({ kind: 'event', event: expect.objectContaining({ event_type: 'thread_started' }) }),
      expect.objectContaining({ kind: 'event', event: expect.objectContaining({ event_type: 'turn_started' }) }),
      expect.objectContaining({ kind: 'event', event: expect.objectContaining({ event_type: 'agent_message_delta' }) }),
      expect.objectContaining({ kind: 'event', event: expect.objectContaining({ event_type: 'codex_warning' }) }),
      expect.objectContaining({
        kind: 'terminal',
        status: 'succeeded',
        summary: 'Codex app-server thread became idle after assistant output.',
      }),
    ]);
  });

  it('fails startRun when the app-server reports the thread idle without turn/completed', async () => {
    const request = vi.fn(async (method: string) =>
      method === 'thread/start'
        ? {
            thread: { id: 'thread-1' },
            approvalPolicy: 'never',
            sandbox: { type: 'dangerFullAccess' },
          }
        : { turn: { id: 'turn-1' } },
    );
    const driver = createGovernedAppServerDriverForTest({
      request,
      notifications: async function* () {
        yield {
          method: 'item/completed',
          params: {
            item: { type: 'userMessage', id: 'item-1' },
            threadId: 'thread-1',
            turnId: 'turn-1',
          },
        };
        yield {
          method: 'thread/status/changed',
          params: {
            threadId: 'thread-1',
            status: { type: 'idle' },
          },
        };
        await new Promise(() => undefined);
      },
    });

    await expect(
      withTimeout(
        collectUntilTerminal(driver.startRun({ runSpec: createRunSpec(), workspacePath: tmpdir() })),
        'Codex app-server startRun did not terminate after idle thread status.',
      ),
    ).resolves.toEqual([
      expect.objectContaining({ kind: 'event', event: expect.objectContaining({ event_type: 'thread_started' }) }),
      expect.objectContaining({ kind: 'event', event: expect.objectContaining({ event_type: 'turn_started' }) }),
      expect.objectContaining({ kind: 'event', event: expect.objectContaining({ event_type: 'codex_warning' }) }),
      expect.objectContaining({ kind: 'event', event: expect.objectContaining({ event_type: 'codex_warning' }) }),
      expect.objectContaining({
        kind: 'terminal',
        status: 'failed',
        summary: 'Codex app-server thread became idle before turn completion.',
        failure: expect.objectContaining({
          kind: 'executor_error',
          retryable: true,
        }),
      }),
    ]);
  });

  it('fails startRun when notifications end before turn completion', async () => {
    const request = vi.fn(async (method: string) =>
      method === 'thread/start'
        ? {
            thread: { id: 'thread-1' },
            approvalPolicy: 'never',
            sandbox: { type: 'dangerFullAccess' },
          }
        : { turn: { id: 'turn-1' } },
    );
    const driver = createGovernedAppServerDriverForTest({
      request,
      notifications: async function* () {
        yield {
          method: 'item/agentMessage/delta',
          params: { threadId: 'thread-1', turnId: 'turn-1', delta: 'working' },
        };
      },
    });

    await expect(
      collectUntilTerminal(driver.startRun({ runSpec: createRunSpec(), workspacePath: tmpdir() })),
    ).resolves.toEqual([
      expect.objectContaining({ kind: 'event', event: expect.objectContaining({ event_type: 'thread_started' }) }),
      expect.objectContaining({ kind: 'event', event: expect.objectContaining({ event_type: 'turn_started' }) }),
      expect.objectContaining({ kind: 'event', event: expect.objectContaining({ event_type: 'agent_message_delta' }) }),
      expect.objectContaining({
        kind: 'terminal',
        status: 'failed',
        summary: 'Codex app-server notification stream ended before turn completion.',
        failure: expect.objectContaining({
          kind: 'executor_error',
          retryable: true,
        }),
      }),
    ]);
  });

  it('fails startRun when no notification stream is available after turn start', async () => {
    const request = vi.fn(async (method: string) =>
      method === 'thread/start'
        ? {
            thread: { id: 'thread-1' },
            approvalPolicy: 'never',
            sandbox: { type: 'dangerFullAccess' },
          }
        : { turn: { id: 'turn-1' } },
    );
    const driver = createGovernedAppServerDriverForTest({ request });

    await expect(
      collectUntilTerminal(driver.startRun({ runSpec: createRunSpec(), workspacePath: tmpdir() })),
    ).resolves.toEqual([
      expect.objectContaining({ kind: 'event', event: expect.objectContaining({ event_type: 'thread_started' }) }),
      expect.objectContaining({ kind: 'event', event: expect.objectContaining({ event_type: 'turn_started' }) }),
      expect.objectContaining({
        kind: 'terminal',
        status: 'failed',
        summary: 'Codex app-server notification stream ended before turn completion.',
      }),
    ]);
  });

  it('maps failed turn/completed notifications to retryable terminal failures', async () => {
    const request = vi.fn(async () => ({
      thread: { id: 'thread-1' },
      approvalPolicy: 'never',
      sandbox: { type: 'dangerFullAccess' },
    }));
    const driver = createGovernedAppServerDriverForTest({
      request,
      notifications: async function* () {
        yield {
          method: 'turn/completed',
          params: {
            threadId: 'thread-1',
            turn: {
              id: 'turn-1',
              status: 'failed',
              error: { message: 'model request failed', additionalDetails: 'rate limit' },
            },
          },
        };
      },
    });

    await expect(
      collectUntilTerminal(
        driver.resumeRun({
          runSpec: createRunSpec(),
          workspacePath: tmpdir(),
          runtimeMetadata: runtimeMetadata({ codex_thread_id: 'thread-1' }),
        }),
      ),
    ).resolves.toEqual([
      expect.objectContaining({ kind: 'event', event: expect.objectContaining({ event_type: 'thread_resumed' }) }),
      expect.objectContaining({
        kind: 'terminal',
        status: 'failed',
        failure: expect.objectContaining({
          kind: 'executor_error',
          message: expect.stringContaining('model request failed'),
          retryable: true,
        }),
      }),
    ]);
  });
});

describe('codex raw log store', () => {
  it('finalizes buffered raw notifications through ArtifactWriter', async () => {
    const artifactWriter = new RecordingArtifactWriter();
    const store = new LocalCodexRawLogStore({ artifactWriter: artifactWriter as unknown as ArtifactWriter });

    await expect(
      store.appendRawNotification({
        runSessionId: 'run-session-1',
        source: 'app_server',
        payload: { method: 'turn/completed' },
      }),
    ).resolves.toEqual({
      raw_ref: {
        kind: 'codex_raw_notification',
        source: 'app_server',
        line: 1,
      },
    });
    await store.appendRawNotification({
      runSessionId: 'run-session-1',
      source: 'exec_fallback',
      payload: { type: 'event' },
    });

    await expect(store.finalizeLogsArtifact('run-session-1')).resolves.toMatchObject({
      kind: 'logs',
      name: 'codex-raw.ndjson',
      content_type: 'application/x-ndjson',
      local_ref: '/artifacts/codex-raw.ndjson',
    });
    expect(artifactWriter.writes).toEqual([
      expect.objectContaining({
        kind: 'logs',
        name: 'codex-raw.ndjson',
        contentType: 'application/x-ndjson',
        visibility: 'internal',
        content: expect.stringContaining('"source":"app_server"'),
      }),
    ]);
    expect(artifactWriter.writes[0]?.content).toContain('"source":"exec_fallback"');
    await expect(store.finalizeLogsArtifact('run-session-1')).resolves.toBeUndefined();
  });
});

describe('codex app-server process transport', () => {
  it('sends an idempotent initialize handshake to the process transport', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'forgeloop-codex-app-server-'));
    const logPath = join(directory, 'protocol.ndjson');
    const binaryPath = join(directory, 'app-server-fake.js');
    await writeFile(
      binaryPath,
      `#!/usr/bin/env node
const fs = require('node:fs');
const readline = require('node:readline');
const logPath = ${JSON.stringify(logPath)};
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  fs.appendFileSync(logPath, line + '\\n');
  const message = JSON.parse(line);
  if (message.method === 'initialize' && message.id !== undefined) {
    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        userAgent: 'fake',
        codexHome: ${JSON.stringify(directory)},
        platformFamily: 'unix',
        platformOs: 'macos'
      }
    }) + '\\n');
  }
});
`,
    );
    await chmod(binaryPath, 0o755);

    const transport = new CodexAppServerProcessTransport({ codexBinary: binaryPath, args: [], allowUnsafeDirectSpawn: true });
    await transport.initialize();
    await transport.initialize();
    await waitForProtocolMethods(logPath, ['initialize', 'initialized']);
    await transport.close();

    const messages = (await readFile(logPath, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { method: string; params?: { clientInfo?: { name?: string } } });

    expect(messages.map((message) => message.method)).toEqual(['initialize', 'initialized']);
    expect(messages[0]?.params?.clientInfo?.name).toBe('forgeloop');
  });

  it('rejects pending requests when the app-server process cannot be spawned', async () => {
    const transport = new CodexAppServerProcessTransport({ codexBinary: missingCodexBinary(), allowUnsafeDirectSpawn: true });

    await expect(transport.request('thread/start', {})).rejects.toThrow(/spawn/i);
    await transport.close();
  });
});
