import { Inject, Injectable } from '@nestjs/common';
import type { DeliveryRepository } from '@forgeloop/db';

import { DELIVERY_REPOSITORY } from '../core/control-plane-tokens';
import type { AutomationRuntimeSnapshotDto } from './automation.dto';
import { toRuntimeSnapshotDto } from './automation.dto';
import { policyProjectionsByRepoScopeFor } from './policy-projection';

const normalizeIsoDateTime = (value: string): string => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid ISO timestamp: ${value}`);
  }
  return parsed.toISOString();
};

const currentIsoTime = (): string => {
  const testNow = process.env.NODE_ENV === 'test' ? process.env.FORGELOOP_AUTOMATION_TEST_NOW?.trim() : undefined;
  return testNow === undefined || testNow.length === 0 ? new Date().toISOString() : normalizeIsoDateTime(testNow);
};

@Injectable()
export class RuntimeSnapshotService {
  constructor(@Inject(DELIVERY_REPOSITORY) private readonly repository: DeliveryRepository) {}

  async getRuntimeSnapshot(): Promise<AutomationRuntimeSnapshotDto> {
    const data = await this.repository.getRuntimeSnapshotData();
    const policyProjectionsByRepoScope = policyProjectionsByRepoScopeFor(data.policy_projection_action_runs);

    return toRuntimeSnapshotDto({
      generatedAt: currentIsoTime(),
      data,
      policyProjectionsByRepoScope,
    });
  }
}
