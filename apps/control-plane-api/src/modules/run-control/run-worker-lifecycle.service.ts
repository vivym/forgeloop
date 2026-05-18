import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

import { DELIVERY_RUN_WORKER, type DeliveryRunWorker } from './run-worker.token';

@Injectable()
export class RunWorkerLifecycleService implements OnModuleInit, OnModuleDestroy {
  private interval: ReturnType<typeof setInterval> | undefined;
  private draining = false;

  constructor(@Inject(DELIVERY_RUN_WORKER) private readonly runWorker: DeliveryRunWorker) {}

  onModuleInit(): void {
    void this.drain();
    this.interval = setInterval(() => {
      void this.drain();
    }, 3_000);
  }

  onModuleDestroy(): void {
    if (this.interval !== undefined) {
      clearInterval(this.interval);
      this.interval = undefined;
    }
  }

  private async drain(): Promise<void> {
    if (this.draining) {
      return;
    }

    this.draining = true;
    try {
      await this.runWorker.drainOnce();
    } catch {
      // Repository state is authoritative; the next lifecycle tick can retry recoverable runs.
    } finally {
      this.draining = false;
    }
  }
}
