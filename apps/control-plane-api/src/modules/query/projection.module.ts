import { Module } from '@nestjs/common';

import { PublicRunSessionProjection } from './public-run-session-projection';

@Module({
  providers: [PublicRunSessionProjection],
  exports: [PublicRunSessionProjection],
})
export class ProjectionModule {}
