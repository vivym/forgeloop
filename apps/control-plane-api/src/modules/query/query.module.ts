import { Module } from '@nestjs/common';

import { P0Module } from '../../p0/p0.module';
import { QueryController } from './query.controller';
import { QueryService } from './query.service';

@Module({
  imports: [P0Module],
  controllers: [QueryController],
  providers: [QueryService],
  exports: [QueryService],
})
export class QueryModule {}
