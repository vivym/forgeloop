import { describe, expect, it, vi } from 'vitest';

import { createExecutorGatewayAdapter, createWorkflowWorkerOptions, startWorkflowWorker } from '../../apps/workflow-worker/src/worker';
import { createRunSpec } from '../executor/test-fixtures';
import { succeededExecutorResult } from '../helpers/delivery-runtime-fixtures';

describe('workflow worker app wiring', () => {
  it('builds Temporal worker options with the delivery workflow path, task queue, and activities', async () => {
    const activities = { executePackageRunActivity: vi.fn() };
    const options = await createWorkflowWorkerOptions({
      connection: { kind: 'fake-connection' },
      activities,
      taskQueue: 'delivery-test-queue',
    });

    expect(options.taskQueue).toBe('delivery-test-queue');
    expect(options.connection).toEqual({ kind: 'fake-connection' });
    expect(options.activities).toBe(activities);
    expect(options.workflowsPath).toContain('packages/workflow/src/package-execution-workflow');
  });

  it('starts a worker with injected Temporal factories and runs it', async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const create = vi.fn().mockResolvedValue({ run });
    const connect = vi.fn().mockResolvedValue({ kind: 'connection' });
    const closeDb = vi.fn().mockResolvedValue(undefined);

    await startWorkflowWorker({
      taskQueue: 'delivery-worker-test',
      temporalAddress: 'temporal.test:7233',
      connect,
      createWorker: create,
      createActivities: () => ({ executePackageRunActivity: vi.fn() }),
      createRuntimeDependencies: () => ({
        repository: {} as never,
        executor: vi.fn(),
        selfReview: vi.fn(),
        close: closeDb,
      }),
    });

    expect(connect).toHaveBeenCalledWith({ address: 'temporal.test:7233' });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        taskQueue: 'delivery-worker-test',
        connection: { kind: 'connection' },
        activities: expect.objectContaining({
          executePackageRunActivity: expect.any(Function),
        }),
      }),
    );
    expect(run).toHaveBeenCalledOnce();
    expect(closeDb).toHaveBeenCalledOnce();
  });

  it('preserves the worker run error and attempts all cleanup when cleanup fails', async () => {
    const run = vi.fn().mockRejectedValue(new Error('worker run failed'));
    const create = vi.fn().mockResolvedValue({ run });
    const closeConnection = vi.fn().mockRejectedValue(new Error('connection close failed'));
    const connect = vi.fn().mockResolvedValue({ close: closeConnection });
    const closeDb = vi.fn().mockRejectedValue(new Error('db close failed'));

    let thrown: unknown;
    try {
      await startWorkflowWorker({
        taskQueue: 'delivery-worker-test',
        temporalAddress: 'temporal.test:7233',
        connect,
        createWorker: create,
        createActivities: () => ({ executePackageRunActivity: vi.fn() }),
        createRuntimeDependencies: () => ({
          repository: {} as never,
          executor: vi.fn(),
          selfReview: vi.fn(),
          close: closeDb,
        }),
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toContain(
      'Failed to start Forgeloop workflow worker for task queue delivery-worker-test: worker run failed',
    );
    expect((thrown as { cleanupErrors?: unknown[] }).cleanupErrors).toHaveLength(2);
    expect(closeDb).toHaveBeenCalledOnce();
    expect(closeConnection).toHaveBeenCalledOnce();
  });

  it('rejects with a clear error when Temporal startup fails', async () => {
    const createRuntimeDependencies = vi.fn();

    await expect(
      startWorkflowWorker({
        taskQueue: 'delivery-worker-test',
        temporalAddress: 'temporal.test:7233',
        connect: vi.fn().mockRejectedValue(new Error('connection refused')),
        createWorker: vi.fn(),
        createActivities: () => ({ executePackageRunActivity: vi.fn() }),
        createRuntimeDependencies,
      }),
    ).rejects.toThrow('Failed to start Forgeloop workflow worker for task queue delivery-worker-test: connection refused');
    expect(createRuntimeDependencies).not.toHaveBeenCalled();
  });

  it('fails closed locally instead of calling executor-gateway for production local Codex runs', async () => {
    const fetchImpl = vi.fn();
    const adapter = createExecutorGatewayAdapter({ baseUrl: 'http://executor.test', fetchImpl: fetchImpl as never });
    const runSpec = createRunSpec({
      executor_type: 'local_codex',
      workflow_only: false,
      run_session_id: 'run-local-codex-worker',
      idempotency_key: 'idem-local-codex-worker',
    });

    await expect(adapter(runSpec)).rejects.toThrow('primary_executor_governor_unavailable');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('keeps mock workflow dogfood on executor-gateway adapter', async () => {
    const runSpec = createRunSpec({
      executor_type: 'mock',
      workflow_only: true,
      run_session_id: 'run-mock-worker',
      idempotency_key: 'idem-mock-worker',
    });
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: { ...succeededExecutorResult(runSpec.run_session_id), executor_type: 'mock' } }),
    });
    const adapter = createExecutorGatewayAdapter({ baseUrl: 'http://executor.test/', fetchImpl: fetchImpl as never });

    await expect(adapter(runSpec)).resolves.toMatchObject({ run_session_id: 'run-mock-worker', executor_type: 'mock' });
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://executor.test/internal/executions',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(runSpec),
      }),
    );
  });
});
