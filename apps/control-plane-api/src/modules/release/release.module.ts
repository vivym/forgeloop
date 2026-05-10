import { Module } from '@nestjs/common';

import { P0Module } from '../../p0/p0.module';
import { ReleaseController } from './release.controller';
import { ReleaseService } from './release.service';

@Module({
  imports: [P0Module],
  controllers: [ReleaseController],
  providers: [ReleaseService],
})
export class ReleaseModule {}
