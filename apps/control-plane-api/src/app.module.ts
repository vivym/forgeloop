import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';

import { DomainErrorFilter } from './p0/domain-error.filter';
import { P0Module } from './p0/p0.module';
import { QueryModule } from './modules/query/query.module';

@Module({
  imports: [P0Module, QueryModule],
  providers: [{ provide: APP_FILTER, useClass: DomainErrorFilter }],
})
export class AppModule {}
