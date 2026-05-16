import { Module } from '@nestjs/common';

import { P0Module } from './p0/p0.module';
import { AutomationModule } from './modules/automation/automation.module';
import { DeliveryModule } from './modules/delivery/delivery.module';
import { HttpSupportModule } from './modules/http/http-support.module';
import { QueryModule } from './modules/query/query.module';
import { ReleaseModule } from './modules/release/release.module';

@Module({
  imports: [DeliveryModule, P0Module, QueryModule, ReleaseModule, AutomationModule, HttpSupportModule],
})
export class AppModule {}
