import { Module } from '@nestjs/common';

import { ControlPlaneCoreModule } from '../core/control-plane-core.module';
import { InternalArtifactsController } from './internal-artifacts.controller';
import { InternalArtifactsService } from './internal-artifacts.service';

@Module({
  imports: [ControlPlaneCoreModule],
  controllers: [InternalArtifactsController],
  providers: [InternalArtifactsService],
})
export class InternalArtifactsModule {}
