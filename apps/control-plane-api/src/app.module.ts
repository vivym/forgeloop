import { Module } from '@nestjs/common';

import { P0Module } from './p0/p0.module';

@Module({
  imports: [P0Module],
})
export class AppModule {}
