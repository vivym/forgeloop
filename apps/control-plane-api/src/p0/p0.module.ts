import { Module } from '@nestjs/common';

import { P0Controller } from './p0.controller';
import { createDefaultP0ExecutorAdapters, P0_EXECUTOR_ADAPTERS, P0Service } from './p0.service';

@Module({
  controllers: [P0Controller],
  providers: [P0Service, { provide: P0_EXECUTOR_ADAPTERS, useFactory: createDefaultP0ExecutorAdapters }],
})
export class P0Module {}
