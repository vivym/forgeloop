import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';

import { DomainErrorFilter } from './domain-error.filter';

@Module({
  providers: [DomainErrorFilter, { provide: APP_FILTER, useExisting: DomainErrorFilter }],
  exports: [DomainErrorFilter],
})
export class HttpSupportModule {}
