import { Module } from '@nestjs/common';

import { ControlPlaneCoreModule } from '../core/control-plane-core.module';
import { ReleaseController } from './release.controller';
import { ReleaseService } from './release.service';

@Module({
  imports: [ControlPlaneCoreModule],
  controllers: [ReleaseController],
  providers: [ReleaseService],
})
export class ReleaseModule {}
