import { describe, expect, it } from 'vitest';
import * as db from '../../packages/db/src/index';

describe('delivery repository public exports', () => {
  it('exports delivery repository names without historical subsystem names', () => {
    const oldSubsystem = 'P' + '0';

    expect(db).toHaveProperty('InMemoryDeliveryRepository');
    expect(db).toHaveProperty('DrizzleDeliveryRepository');
    expect(db).toHaveProperty('createDrizzleDeliveryRepository');
    expect(db).not.toHaveProperty(`InMemory${oldSubsystem}Repository`);
    expect(db).not.toHaveProperty(`Drizzle${oldSubsystem}Repository`);
    expect(db).not.toHaveProperty(`createDrizzle${oldSubsystem}Repository`);
  });
});
