import { Module } from '@nestjs/common';

import { ExecutorController } from './executor.controller.js';
import { EXECUTOR_ADAPTERS, ExecutorService, createDefaultExecutorAdapters } from './executor.service.js';

@Module({
  controllers: [ExecutorController],
  providers: [
    ExecutorService,
    {
      provide: EXECUTOR_ADAPTERS,
      useFactory: createDefaultExecutorAdapters,
    },
  ],
})
export class AppModule {}
