import { startWorkflowWorker } from './worker.js';

void startWorkflowWorker().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
