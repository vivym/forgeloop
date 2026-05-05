import { fileURLToPath } from 'node:url';

import { executorResultSchema, type ExecutorResult, type RunSpec } from '../../../packages/contracts/src/executor.js';
import { NativeConnection, Worker, type NativeConnectionOptions, type WorkerOptions } from '@temporalio/worker';

export const DEFAULT_TASK_QUEUE = 'forgeloop-p0-package-execution';
export const DEFAULT_TEMPORAL_ADDRESS = 'localhost:7233';
export const DEFAULT_EXECUTOR_GATEWAY_URL = 'http://127.0.0.1:3001';

export interface WorkflowWorkerOptions extends Omit<WorkerOptions, 'activities' | 'connection'> {
  activities: PackageExecutionActivities;
  connection?: unknown;
}

export type PackageRunExecutor = (runSpec: RunSpec) => Promise<ExecutorResult>;
export type PackageRunSelfReview = (input: unknown) => Promise<unknown>;
export type PackageExecutionRepository = object;
export interface PackageExecutionActivities {
  executePackageRunActivity(input: unknown): Promise<unknown>;
}

export interface RuntimeDependencies {
  repository: PackageExecutionRepository;
  executor: PackageRunExecutor;
  selfReview: PackageRunSelfReview;
  close(): Promise<void>;
}

export interface WorkerLike {
  run(): Promise<void>;
}

export interface StartWorkflowWorkerDeps {
  taskQueue?: string;
  temporalAddress?: string;
  executorGatewayUrl?: string;
  connect?: (options: NativeConnectionOptions) => Promise<unknown>;
  createWorker?: (options: WorkflowWorkerOptions) => Promise<WorkerLike>;
  createRuntimeDependencies?: (options: { executorGatewayUrl: string }) => RuntimeDependencies | Promise<RuntimeDependencies>;
  createActivities?: (dependencies: {
    repository: PackageExecutionRepository;
    executor: PackageRunExecutor;
    selfReview: PackageRunSelfReview;
  }) => PackageExecutionActivities | Promise<PackageExecutionActivities>;
}

interface ExecutorGatewayResponse {
  result: unknown;
}

const workflowPath = () =>
  fileURLToPath(new URL('../../../packages/workflow/src/package-execution-workflow.ts', import.meta.url));

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const dynamicImport = new Function('specifier', 'return import(specifier)') as <T>(specifier: string) => Promise<T>;

export const createExecutorGatewayAdapter = (
  options: {
    baseUrl: string;
    fetchImpl?: typeof fetch;
  },
): PackageRunExecutor => {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = options.baseUrl.replace(/\/+$/, '');

  return async (runSpec: RunSpec): Promise<ExecutorResult> => {
    const response = await fetchImpl(`${baseUrl}/internal/executions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(runSpec),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`executor-gateway returned ${response.status}: ${text}`);
    }

    const body = (await response.json()) as ExecutorGatewayResponse;

    return executorResultSchema.parse(body.result);
  };
};

export const createRuntimeDependencies = async (options: { executorGatewayUrl: string }): Promise<RuntimeDependencies> => {
  const dbModule = await dynamicImport<{
    createDbClient(config?: { connectionString?: string }): {
      db: unknown;
      pool: { end(): Promise<void> };
    };
    createDrizzleP0Repository(db: unknown): PackageExecutionRepository;
  }>(new URL('../../../packages/db/src/client.ts', import.meta.url).href);
  const selfReviewModule = await dynamicImport<{
    runMockSelfReview: PackageRunSelfReview;
  }>(new URL('../../../packages/executor/src/self-review.ts', import.meta.url).href);
  const dbClient = dbModule.createDbClient(
    process.env.DATABASE_URL === undefined ? {} : { connectionString: process.env.DATABASE_URL },
  );

  return {
    repository: dbModule.createDrizzleP0Repository(dbClient.db),
    executor: createExecutorGatewayAdapter({ baseUrl: options.executorGatewayUrl }),
    selfReview: selfReviewModule.runMockSelfReview,
    close: () => dbClient.pool.end(),
  };
};

export const createActivities = async (dependencies: {
  repository: PackageExecutionRepository;
  executor: PackageRunExecutor;
  selfReview: PackageRunSelfReview;
}): Promise<PackageExecutionActivities> => {
  const workflowModule = await dynamicImport<{
    createPackageExecutionActivities(input: typeof dependencies): PackageExecutionActivities;
  }>(new URL('../../../packages/workflow/src/activities.ts', import.meta.url).href);

  return workflowModule.createPackageExecutionActivities(dependencies);
};

export const createWorkflowWorkerOptions = async (input: {
  connection: unknown;
  activities: PackageExecutionActivities;
  taskQueue?: string;
}): Promise<WorkflowWorkerOptions> => ({
  connection: input.connection,
  taskQueue: input.taskQueue ?? DEFAULT_TASK_QUEUE,
  workflowsPath: workflowPath(),
  activities: input.activities,
});

export const startWorkflowWorker = async (deps: StartWorkflowWorkerDeps = {}): Promise<void> => {
  const taskQueue = deps.taskQueue ?? process.env.TEMPORAL_TASK_QUEUE ?? DEFAULT_TASK_QUEUE;
  const temporalAddress = deps.temporalAddress ?? process.env.TEMPORAL_ADDRESS ?? DEFAULT_TEMPORAL_ADDRESS;
  const executorGatewayUrl =
    deps.executorGatewayUrl ?? process.env.EXECUTOR_GATEWAY_URL ?? DEFAULT_EXECUTOR_GATEWAY_URL;
  const connect = deps.connect ?? NativeConnection.connect;
  const createWorker =
    deps.createWorker ??
    ((options: WorkflowWorkerOptions) => Worker.create(options as WorkerOptions) as Promise<WorkerLike>);
  const runtimeDependenciesFactory = deps.createRuntimeDependencies ?? createRuntimeDependencies;
  const activitiesFactory = deps.createActivities ?? createActivities;
  let runtimeDependencies: RuntimeDependencies | undefined;
  let connection: unknown;

  try {
    connection = await connect({ address: temporalAddress });
    runtimeDependencies = await runtimeDependenciesFactory({ executorGatewayUrl });
    const activities = await activitiesFactory({
      repository: runtimeDependencies.repository,
      executor: runtimeDependencies.executor,
      selfReview: runtimeDependencies.selfReview,
    });
    const worker = await createWorker(await createWorkflowWorkerOptions({ connection, activities, taskQueue }));

    await worker.run();
  } catch (error) {
    throw new Error(`Failed to start Forgeloop workflow worker for task queue ${taskQueue}: ${errorMessage(error)}`, {
      cause: error,
    });
  } finally {
    await runtimeDependencies?.close();
    if (
      connection !== undefined &&
      connection !== null &&
      typeof connection === 'object' &&
      typeof (connection as { close?: unknown }).close === 'function'
    ) {
      await (connection as { close: () => Promise<void> }).close();
    }
  }
};
