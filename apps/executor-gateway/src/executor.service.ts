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
import { runLocalCodexExecutor } from '../../../packages/executor/src/local-codex-executor.js';
import { runMockExecutor } from '../../../packages/executor/src/mock-executor.js';
import { ZodError } from 'zod';

export type ExecutorAdapter = (runSpec: RunSpec) => Promise<ExecutorResult>;
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

const requestIdentityFor = (runSpec: RunSpec): ExecutionRequestIdentity => ({
  idempotency_key: runSpec.idempotency_key,
  run_session_id: runSpec.run_session_id,
  run_spec_fingerprint: JSON.stringify(runSpec),
});

export const createDefaultExecutorAdapters = (): ExecutorAdapterRegistry => {
  const artifactRoot = process.env.FORGELOOP_EXECUTOR_ARTIFACT_ROOT ?? join(tmpdir(), 'forgeloop-executor-artifacts');
  const codexHome = process.env.FORGELOOP_CODEX_HOME ?? process.env.CODEX_HOME;

  return {
    mock: runMockExecutor,
    local_codex: (runSpec) =>
      runLocalCodexExecutor(runSpec, {
        artifactRoot: join(artifactRoot, safePathSegment(runSpec.run_session_id)),
        ...(codexHome === undefined ? {} : { codexHome }),
      }),
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
    const runSpec = parseRunSpec(body);
    const requestIdentity = requestIdentityFor(runSpec);
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

    const executionPromise = this.runExecution(runSpec, adapter, requestIdentity);
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
    runSpec: RunSpec,
    adapter: ExecutorAdapter,
    requestIdentity: ExecutionRequestIdentity,
  ): Promise<ExecutionRecord> {
    const result = parseExecutorResult(await adapter(runSpec));

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
