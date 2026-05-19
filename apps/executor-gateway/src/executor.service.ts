import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  executorResultSchema,
  runSpecSchema,
  type ExecutorResult,
  type ExecutorType,
  type RunSpec,
} from '../../../packages/contracts/src/executor.js';
import type { PackageRuntimePolicySnapshot, RuntimeSafetyAttestation, RuntimeSafetyEnvironment } from '../../../packages/domain/src/index.js';
import {
  createLocalCodexRuntimeSafety,
  parseExecutorRuntimeSafetyConfigFromEnv,
  sandboxWrapperEnvironmentDigest,
  validateRunExecutionAttestation,
} from '../../../packages/executor/src/index.js';
import { runLocalCodexExecutor } from '../../../packages/executor/src/local-codex-executor.js';
import { runMockExecutor } from '../../../packages/executor/src/mock-executor.js';
import { ZodError } from 'zod';

export interface ExecutorExecutionRequest {
  run_spec: RunSpec;
  runtime_safety_attestation?: RuntimeSafetyAttestation;
  runtime_safety_routing?: {
    workspace_root: string;
    artifact_root: string;
    sandbox_output_root: string;
    runtime_environment: RuntimeSafetyEnvironment;
    network_mode: RuntimeSafetyAttestation['network_mode'];
    policy_digest: string;
    env_policy_digest: string;
    command_policy_digest: string;
    mount_policy_digest: string;
    network_policy_digest: string;
    resource_limit_digest: string;
    governor_id: string;
    sandbox_id: string;
    sandbox_version: string;
    sandbox_binary_digest: string;
    sandbox_config_digest: string;
    sandbox_wrapper_environment_digest: string;
    package_policy_snapshot: PackageRuntimePolicySnapshot;
  };
}

export interface ExecutorAdapterInput {
  runSpec: RunSpec;
  runtimeSafetyAttestation?: RuntimeSafetyAttestation;
  runtimeSafetyRouting?: ExecutorExecutionRequest['runtime_safety_routing'];
}

export type ExecutorAdapter = (input: ExecutorAdapterInput) => Promise<ExecutorResult>;
export type ExecutorAdapterRegistry = Record<ExecutorType, ExecutorAdapter>;

export const EXECUTOR_ADAPTERS = Symbol('EXECUTOR_ADAPTERS');

export interface ExecutionRecord {
  execution_id: string;
  idempotency_key: string;
  run_session_id: string;
  status: ExecutorResult['status'];
  result: ExecutorResult;
  idempotent_replay: boolean;
}

interface ExecutionRequestIdentity {
  idempotency_key: string;
  run_session_id: string;
  run_spec_fingerprint: string;
}

interface ParsedExecutionRequest {
  runSpec: RunSpec;
  envelope: boolean;
  fingerprint: string;
  runtimeSafetyAttestation?: RuntimeSafetyAttestation;
  runtimeSafetyRouting?: ExecutorExecutionRequest['runtime_safety_routing'];
}

interface InFlightExecution {
  identity: ExecutionRequestIdentity;
  promise: Promise<ExecutionRecord>;
}

const safePathSegment = (value: string): string => {
  const sanitized = value
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/\.\.+/g, '-')
    .replace(/^\.+/, '')
    .replace(/^-+|-+$/g, '');

  return sanitized.length > 0 ? sanitized : 'artifact';
};

const zodMessages = (error: ZodError): string[] => error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);

const parseRunSpec = (body: unknown): RunSpec => {
  const parsed = runSpecSchema.safeParse(body);

  if (!parsed.success) {
    throw new BadRequestException({
      message: 'Invalid RunSpec',
      issues: zodMessages(parsed.error),
    });
  }

  return parsed.data;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const parseExecutionRequest = (body: unknown): ParsedExecutionRequest => {
  if (isRecord(body) && 'run_spec' in body) {
    const runSpec = parseRunSpec(body.run_spec);
    const runtimeSafetyAttestation = isRecord(body.runtime_safety_attestation)
      ? (body.runtime_safety_attestation as unknown as RuntimeSafetyAttestation)
      : undefined;
    const runtimeSafetyRouting = isRecord(body.runtime_safety_routing)
      ? (body.runtime_safety_routing as ExecutorExecutionRequest['runtime_safety_routing'])
      : undefined;

    return {
      runSpec,
      envelope: true,
      fingerprint: JSON.stringify({
        run_spec: runSpec,
        runtime_safety_attestation: runtimeSafetyAttestation,
        runtime_safety_routing: runtimeSafetyRouting,
      }),
      ...(runtimeSafetyAttestation === undefined ? {} : { runtimeSafetyAttestation }),
      ...(runtimeSafetyRouting === undefined ? {} : { runtimeSafetyRouting }),
    };
  }

  const runSpec = parseRunSpec(body);
  return {
    runSpec,
    envelope: false,
    fingerprint: JSON.stringify({ run_spec: runSpec }),
  };
};

const parseExecutorResult = (result: ExecutorResult): ExecutorResult => {
  const parsed = executorResultSchema.safeParse(result);

  if (!parsed.success) {
    throw new BadRequestException({
      message: 'Executor adapter returned an invalid ExecutorResult',
      issues: zodMessages(parsed.error),
    });
  }

  return parsed.data;
};

const requestIdentityFor = (request: ParsedExecutionRequest): ExecutionRequestIdentity => ({
  idempotency_key: request.runSpec.idempotency_key,
  run_session_id: request.runSpec.run_session_id,
  run_spec_fingerprint: request.fingerprint,
});

const requiredRoutingStringFields = [
  'workspace_root',
  'artifact_root',
  'sandbox_output_root',
  'runtime_environment',
  'network_mode',
  'policy_digest',
  'env_policy_digest',
  'command_policy_digest',
  'mount_policy_digest',
  'network_policy_digest',
  'resource_limit_digest',
  'governor_id',
  'sandbox_id',
  'sandbox_version',
  'sandbox_binary_digest',
  'sandbox_config_digest',
  'sandbox_wrapper_environment_digest',
] as const;

const badRuntimeSafetyRequest = (code: string, message: string, details: Record<string, unknown> = {}): BadRequestException =>
  new BadRequestException({ code, message, ...details });

const assertLocalCodexRuntimeSafety = (request: ParsedExecutionRequest): void => {
  const runSpec = request.runSpec;
  if (runSpec.executor_type !== 'local_codex') {
    return;
  }
  if (!request.envelope || request.runtimeSafetyAttestation === undefined || request.runtimeSafetyRouting === undefined) {
    throw badRuntimeSafetyRequest(
      'primary_executor_governor_unavailable',
      'local_codex execution requires run_execution runtime safety routing',
    );
  }

  const attestation = request.runtimeSafetyAttestation;
  const routing = request.runtimeSafetyRouting;

  for (const field of requiredRoutingStringFields) {
    if (typeof routing[field] !== 'string' || routing[field].trim().length === 0) {
      throw badRuntimeSafetyRequest('primary_executor_governor_unavailable', 'local_codex runtime safety routing is incomplete.', {
        missing_field: field,
      });
    }
  }
  if (!isRecord(routing.package_policy_snapshot)) {
    throw badRuntimeSafetyRequest('primary_executor_governor_unavailable', 'local_codex runtime safety routing is missing a package policy snapshot.', {
      missing_field: 'package_policy_snapshot',
    });
  }

  const validation = validateRunExecutionAttestation({
    attestation,
    expected: {
      executorType: runSpec.executor_type,
      workflowOnly: runSpec.workflow_only,
      environment: routing.runtime_environment,
      projectId: runSpec.project_id,
      repoId: runSpec.repo.repo_id,
      executionPackageId: runSpec.execution_package_id,
      expectedPackageVersion: runSpec.expected_package_version,
      runId: runSpec.run_session_id,
      policyDigest: routing.policy_digest,
      policySnapshotVersion: routing.package_policy_snapshot.policy_snapshot_version,
      envPolicyDigest: routing.env_policy_digest,
      commandPolicyDigest: routing.command_policy_digest,
      mountPolicyDigest: routing.mount_policy_digest,
      networkPolicyDigest: routing.network_policy_digest,
      networkMode: routing.network_mode,
      resourceLimitDigest: routing.resource_limit_digest,
      governorId: routing.governor_id,
      sandboxId: routing.sandbox_id,
      sandboxVersion: routing.sandbox_version,
      sandboxBinaryDigest: routing.sandbox_binary_digest,
      sandboxConfigDigest: routing.sandbox_config_digest,
      sandboxWrapperEnvironmentDigest: routing.sandbox_wrapper_environment_digest,
      workspaceRoot: routing.workspace_root,
      artifactRoot: routing.artifact_root,
      sandboxOutputRoot: routing.sandbox_output_root,
      now: new Date().toISOString(),
    },
  });
  if (!validation.ok) {
    throw badRuntimeSafetyRequest(
      validation.code,
      validation.message,
      validation.details,
    );
  }
};

export const createDefaultExecutorAdapters = (): ExecutorAdapterRegistry => {
  const artifactRoot = process.env.FORGELOOP_EXECUTOR_ARTIFACT_ROOT ?? join(tmpdir(), 'forgeloop-executor-artifacts');
  const codexHome = process.env.FORGELOOP_CODEX_HOME ?? process.env.CODEX_HOME;
  mkdirSync(artifactRoot, { recursive: true });

  return {
    mock: ({ runSpec }) => runMockExecutor(runSpec),
    local_codex: async ({ runSpec, runtimeSafetyRouting }) => {
      const runArtifactRoot = runtimeSafetyRouting?.artifact_root ?? join(artifactRoot, safePathSegment(runSpec.run_session_id));
      if (runtimeSafetyRouting === undefined) {
        throw badRuntimeSafetyRequest('primary_executor_governor_unavailable', 'local_codex execution requires runtime safety routing.');
      }
      const parseResult = parseExecutorRuntimeSafetyConfigFromEnv(process.env, {
        tempRoot: tmpdir(),
        packageControlledPaths: [runSpec.repo.local_path],
        workspaceRoot: runtimeSafetyRouting.workspace_root,
      });
      if (parseResult.status !== 'available') {
        const details =
          parseResult.status === 'unavailable'
            ? { missing_keys: parseResult.missing_keys }
            : { diagnostics: parseResult.diagnostics };
        throw badRuntimeSafetyRequest(parseResult.reason_code, 'local_codex runtime safety config is unavailable.', details);
      }
      const runtimeConfigMismatch = (
        [
          ['sandbox_binary_digest', parseResult.config.sandbox.binary_digest, runtimeSafetyRouting.sandbox_binary_digest],
          ['sandbox_config_digest', parseResult.config.sandbox.config_digest, runtimeSafetyRouting.sandbox_config_digest],
          ['sandbox_wrapper_environment_digest', sandboxWrapperEnvironmentDigest(), runtimeSafetyRouting.sandbox_wrapper_environment_digest],
        ] as const
      ).find(([, actual, expected]) => actual !== expected);
      if (runtimeConfigMismatch !== undefined) {
        throw badRuntimeSafetyRequest('runtime_safety_routing_mismatch', 'Executor runtime safety config does not match accepted routing.', {
          mismatched_field: runtimeConfigMismatch[0],
        });
      }
      const runtimeSafety = await createLocalCodexRuntimeSafety({
        runSpec,
        runtimeConfig: parseResult.config,
        frozenSnapshot: runtimeSafetyRouting.package_policy_snapshot,
        workspaceRoot: runtimeSafetyRouting.workspace_root,
        artifactRoot: runArtifactRoot,
        sandboxOutputRoot: runtimeSafetyRouting.sandbox_output_root,
        runtimeEnvironment: runtimeSafetyRouting.runtime_environment,
      });
      const commandContext = runtimeSafety.hookCommandContext;
      const bindingMismatch = (
        [
          ['workspace_root', commandContext.workspaceRoot, runtimeSafetyRouting.workspace_root],
          ['artifact_root', commandContext.artifactRoot, runtimeSafetyRouting.artifact_root],
          ['sandbox_output_root', commandContext.sandboxOutputRoot, runtimeSafetyRouting.sandbox_output_root],
          ['policy_digest', commandContext.policyDigest, runtimeSafetyRouting.policy_digest],
          ['env_policy_digest', commandContext.envPolicyDigest, runtimeSafetyRouting.env_policy_digest],
          ['command_policy_digest', commandContext.commandPolicyDigest, runtimeSafetyRouting.command_policy_digest],
          ['mount_policy_digest', commandContext.mountPolicyDigest, runtimeSafetyRouting.mount_policy_digest],
          ['network_policy_digest', commandContext.networkPolicyDigest, runtimeSafetyRouting.network_policy_digest],
          ['resource_limit_digest', commandContext.resourceLimitDigest, runtimeSafetyRouting.resource_limit_digest],
          ['network_mode', commandContext.networkMode, runtimeSafetyRouting.network_mode],
        ] as const
      ).find(([, actual, expected]) => actual !== expected);
      if (bindingMismatch !== undefined) {
        throw badRuntimeSafetyRequest('runtime_safety_routing_mismatch', 'Executor runtime safety routing does not match derived run binding.', {
          mismatched_field: bindingMismatch[0],
        });
      }

      return runLocalCodexExecutor(runSpec, {
        artifactRoot: runArtifactRoot,
        ...(codexHome === undefined ? {} : { codexHome }),
        runtimeSafety,
      });
    },
  };
};

@Injectable()
export class ExecutorService {
  private readonly recordsByExecutionId = new Map<string, ExecutionRecord>();
  private readonly executionIdByRunSessionId = new Map<string, string>();
  private readonly requestIdentityByExecutionId = new Map<string, ExecutionRequestIdentity>();
  private readonly inFlightByExecutionId = new Map<string, InFlightExecution>();
  private readonly inFlightExecutionIdByRunSessionId = new Map<string, string>();

  constructor(@Inject(EXECUTOR_ADAPTERS) private readonly adapters: ExecutorAdapterRegistry) {}

  async createExecution(body: unknown): Promise<ExecutionRecord> {
    const request = parseExecutionRequest(body);
    assertLocalCodexRuntimeSafety(request);
    const runSpec = request.runSpec;
    const requestIdentity = requestIdentityFor(request);
    const existingExecutionId =
      this.recordsByExecutionId.get(runSpec.idempotency_key)?.execution_id ??
      this.executionIdByRunSessionId.get(runSpec.run_session_id);

    if (existingExecutionId !== undefined) {
      const existing = this.recordsByExecutionId.get(existingExecutionId);

      if (existing !== undefined) {
        this.assertCompatibleRequest(requestIdentity, this.requestIdentityByExecutionId.get(existing.execution_id));
        return { ...existing, idempotent_replay: true };
      }
    }

    const inFlightExecutionId =
      this.inFlightByExecutionId.get(runSpec.idempotency_key) === undefined
        ? this.inFlightExecutionIdByRunSessionId.get(runSpec.run_session_id)
        : runSpec.idempotency_key;
    if (inFlightExecutionId !== undefined) {
      const inFlight = this.inFlightByExecutionId.get(inFlightExecutionId);

      if (inFlight !== undefined) {
        this.assertCompatibleRequest(requestIdentity, inFlight.identity);
        const record = await inFlight.promise;

        return { ...record, idempotent_replay: true };
      }
    }

    const adapter: ExecutorAdapter | undefined = this.adapters[runSpec.executor_type];
    if (adapter === undefined) {
      throw new BadRequestException({ message: `No executor adapter registered for ${runSpec.executor_type}` });
    }

    const executionPromise = this.runExecution(request, adapter, requestIdentity);
    this.inFlightByExecutionId.set(runSpec.idempotency_key, {
      identity: requestIdentity,
      promise: executionPromise,
    });
    this.inFlightExecutionIdByRunSessionId.set(runSpec.run_session_id, runSpec.idempotency_key);

    try {
      return await executionPromise;
    } finally {
      this.inFlightByExecutionId.delete(runSpec.idempotency_key);
      this.inFlightExecutionIdByRunSessionId.delete(runSpec.run_session_id);
    }
  }

  private async runExecution(
    request: ParsedExecutionRequest,
    adapter: ExecutorAdapter,
    requestIdentity: ExecutionRequestIdentity,
  ): Promise<ExecutionRecord> {
    const runSpec = request.runSpec;
    const result = parseExecutorResult(
      await adapter({
        runSpec,
        ...(request.runtimeSafetyAttestation === undefined ? {} : { runtimeSafetyAttestation: request.runtimeSafetyAttestation }),
        ...(request.runtimeSafetyRouting === undefined ? {} : { runtimeSafetyRouting: request.runtimeSafetyRouting }),
      }),
    );

    if (result.run_session_id !== runSpec.run_session_id) {
      throw new BadRequestException({
        message: `ExecutorResult run_session_id ${result.run_session_id} does not match RunSpec ${runSpec.run_session_id}`,
      });
    }

    const record: ExecutionRecord = {
      execution_id: runSpec.idempotency_key,
      idempotency_key: runSpec.idempotency_key,
      run_session_id: runSpec.run_session_id,
      status: result.status,
      result,
      idempotent_replay: false,
    };

    this.recordsByExecutionId.set(record.execution_id, record);
    this.executionIdByRunSessionId.set(record.run_session_id, record.execution_id);
    this.requestIdentityByExecutionId.set(record.execution_id, requestIdentity);

    return record;
  }

  private assertCompatibleRequest(request: ExecutionRequestIdentity, existing: ExecutionRequestIdentity | undefined): void {
    if (existing === undefined) {
      throw new ConflictException({
        message: 'Execution exists without request identity metadata',
      });
    }

    if (request.idempotency_key === existing.idempotency_key && request.run_session_id !== existing.run_session_id) {
      throw new ConflictException({
        message: `idempotency_key ${request.idempotency_key} is already reserved for run_session_id ${existing.run_session_id}`,
      });
    }

    if (request.run_session_id === existing.run_session_id && request.idempotency_key !== existing.idempotency_key) {
      throw new ConflictException({
        message: `run_session_id ${request.run_session_id} is already reserved for idempotency_key ${existing.idempotency_key}`,
      });
    }

    if (request.run_spec_fingerprint !== existing.run_spec_fingerprint) {
      throw new ConflictException({
        message: 'RunSpec does not match the original request identity for this execution',
      });
    }
  }

  getExecution(executionId: string): ExecutionRecord {
    const record = this.recordsByExecutionId.get(executionId);

    if (record === undefined) {
      throw new NotFoundException({ message: `Execution ${executionId} not found` });
    }

    return record;
  }
}
