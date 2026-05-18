import { Module } from '@nestjs/common';

import { AutomationModule } from './modules/automation/automation.module';
import { DeliveryModule } from './modules/delivery/delivery.module';
import { HttpSupportModule } from './modules/http/http-support.module';
import { QueryModule } from './modules/query/query.module';
import { ReleaseModule } from './modules/release/release.module';

@Module({
  imports: [HttpSupportModule, DeliveryModule, QueryModule, ReleaseModule, AutomationModule],
})
export class AppModule {}
