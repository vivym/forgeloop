import { Module } from '@nestjs/common';

import { AutomationModule } from './modules/automation/automation.module';
import { CodexRuntimeModule } from './modules/codex-runtime/codex-runtime.module';
import { DeliveryModule } from './modules/delivery/delivery.module';
import { HttpSupportModule } from './modules/http/http-support.module';
import { InternalArtifactsModule } from './modules/internal-artifacts/internal-artifacts.module';
import { PlanItemWorkflowsModule } from './modules/plan-item-workflows/plan-item-workflows.module';
import { QueryModule } from './modules/query/query.module';
import { ReleaseModule } from './modules/release/release.module';

@Module({
  imports: [
    HttpSupportModule,
    DeliveryModule,
    QueryModule,
    ReleaseModule,
    AutomationModule,
    CodexRuntimeModule,
    InternalArtifactsModule,
    PlanItemWorkflowsModule,
  ],
})
export class AppModule {}
