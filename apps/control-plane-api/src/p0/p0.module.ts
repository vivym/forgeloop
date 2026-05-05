import { Module } from '@nestjs/common';

import { P0Controller } from './p0.controller';
import { P0Service } from './p0.service';

@Module({
  controllers: [P0Controller],
  providers: [P0Service],
})
export class P0Module {}
