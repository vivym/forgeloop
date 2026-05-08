import type { RunWorker } from './run-worker.js';

export class RunDispatcher {
  constructor(private readonly worker: RunWorker) {}

  kick(): void {
    this.worker.kick();
  }

  drainOnce(): Promise<void> {
    return this.worker.drainOnce();
  }
}
