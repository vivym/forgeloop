import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import { RUN_DURABILITY_MODE, type RunDurabilityMode } from './control-plane-tokens';

const uuidBackedDeliveryIdPrefixes = new Set([
  'project',
  'work-item',
  'spec',
  'spec-revision',
  'plan',
  'plan-revision',
  'execution-package',
  'run-session',
  'decision',
]);

@Injectable()
export class ControlPlaneRuntimeService {
  private idCounter = 0;
  private timeCounter = 0;
  private durableTimeMs = 0;
  private readonly durableInstanceId = randomUUID().replace(/-/g, '').slice(0, 12);

  constructor(@Inject(RUN_DURABILITY_MODE) private readonly durabilityMode: RunDurabilityMode) {}

  id(prefix: string): string {
    this.idCounter += 1;
    if (this.durabilityMode === 'durable' && uuidBackedDeliveryIdPrefixes.has(prefix)) {
      return randomUUID();
    }
    if (this.durabilityMode === 'durable') {
      return `${prefix}-${this.durableInstanceId}-${this.idCounter}`;
    }
    return `${prefix}-${this.idCounter}`;
  }

  now(): string {
    if (this.durabilityMode === 'durable') {
      const current = Date.now();
      this.durableTimeMs = current > this.durableTimeMs ? current : this.durableTimeMs + 1;
      return new Date(this.durableTimeMs).toISOString();
    }

    this.timeCounter += 1;
    return new Date(Date.UTC(2026, 4, 5, 0, 0, this.timeCounter)).toISOString();
  }
}
