import { describe, expect, it, vi } from 'vitest';

import { createWorkflowWorkerOptions, startWorkflowWorker } from '../../apps/workflow-worker/src/worker';

describe('workflow worker app wiring', () => {
  it('builds Temporal worker options with the P0 workflow path, task queue, and activities', async () => {
    const activities = { executePackageRunActivity: vi.fn() };
    const options = await createWorkflowWorkerOptions({
      connection: { kind: 'fake-connection' },
      activities,
      taskQueue: 'p0-test-queue',
    });

    expect(options.taskQueue).toBe('p0-test-queue');
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
      taskQueue: 'p0-worker-test',
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
        taskQueue: 'p0-worker-test',
        connection: { kind: 'connection' },
        activities: expect.objectContaining({
          executePackageRunActivity: expect.any(Function),
        }),
      }),
    );
    expect(run).toHaveBeenCalledOnce();
    expect(closeDb).toHaveBeenCalledOnce();
  });

  it('rejects with a clear error when Temporal startup fails', async () => {
    await expect(
      startWorkflowWorker({
        taskQueue: 'p0-worker-test',
        temporalAddress: 'temporal.test:7233',
        connect: vi.fn().mockRejectedValue(new Error('connection refused')),
        createWorker: vi.fn(),
        createActivities: () => ({ executePackageRunActivity: vi.fn() }),
        createRuntimeDependencies: () => ({
          repository: {} as never,
          executor: vi.fn(),
          selfReview: vi.fn(),
          close: vi.fn(),
        }),
      }),
    ).rejects.toThrow('Failed to start Forgeloop workflow worker for task queue p0-worker-test: connection refused');
  });
});
