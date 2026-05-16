import { Module } from '@nestjs/common';

import { ControlPlaneCoreModule } from '../core/control-plane-core.module';
import { QueryController } from './query.controller';
import { QueryService } from './query.service';

@Module({
  imports: [ControlPlaneCoreModule],
  controllers: [QueryController],
  providers: [QueryService],
  exports: [QueryService],
})
export class QueryModule {}
