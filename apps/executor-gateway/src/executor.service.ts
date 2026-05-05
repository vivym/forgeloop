import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
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

  constructor(@Inject(EXECUTOR_ADAPTERS) private readonly adapters: ExecutorAdapterRegistry) {}

  async createExecution(body: unknown): Promise<ExecutionRecord> {
    const runSpec = parseRunSpec(body);
    const existingExecutionId =
      this.recordsByExecutionId.get(runSpec.idempotency_key)?.execution_id ??
      this.executionIdByRunSessionId.get(runSpec.run_session_id);

    if (existingExecutionId !== undefined) {
      const existing = this.recordsByExecutionId.get(existingExecutionId);

      if (existing !== undefined) {
        return { ...existing, idempotent_replay: true };
      }
    }

    const adapter: ExecutorAdapter | undefined = this.adapters[runSpec.executor_type];
    if (adapter === undefined) {
      throw new BadRequestException({ message: `No executor adapter registered for ${runSpec.executor_type}` });
    }

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

    return record;
  }

  getExecution(executionId: string): ExecutionRecord {
    const record = this.recordsByExecutionId.get(executionId);

    if (record === undefined) {
      throw new NotFoundException({ message: `Execution ${executionId} not found` });
    }

    return record;
  }
}
