import { describe, expect, it } from 'vitest';
import * as db from '../../packages/db/src/index';

describe('delivery repository public exports', () => {
  it('exports delivery repository names without historical subsystem names', () => {
    expect(db).toHaveProperty('InMemoryDeliveryRepository');
    expect(db).toHaveProperty('DrizzleDeliveryRepository');
    expect(db).toHaveProperty('createDrizzleDeliveryRepository');
    expect(db).not.toHaveProperty('InMemoryP0Repository');
    expect(db).not.toHaveProperty('DrizzleP0Repository');
    expect(db).not.toHaveProperty('createDrizzleP0Repository');
  });
});
