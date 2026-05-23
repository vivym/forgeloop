import { Module } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { ControlPlaneCoreModule } from '../core/control-plane-core.module';
import { BrainstormingController } from './brainstorming.controller';
import { BrainstormingService } from './brainstorming.service';

@Module({
  imports: [ControlPlaneCoreModule, AuditModule],
  controllers: [BrainstormingController],
  providers: [BrainstormingService],
})
export class BrainstormingModule {}
