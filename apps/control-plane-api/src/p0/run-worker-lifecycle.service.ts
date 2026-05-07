import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { RunWorker } from '@forgeloop/run-worker';

import { RUN_WORKER } from './p0.service';

@Injectable()
export class RunWorkerLifecycleService implements OnModuleInit, OnModuleDestroy {
  private interval: ReturnType<typeof setInterval> | undefined;

  constructor(@Inject(RUN_WORKER) private readonly runWorker: RunWorker) {}

  onModuleInit(): void {
    void this.runWorker.drainOnce();
    this.interval = setInterval(() => {
      void this.runWorker.drainOnce();
    }, 3_000);
  }

  onModuleDestroy(): void {
    if (this.interval !== undefined) {
      clearInterval(this.interval);
      this.interval = undefined;
    }
  }
}
