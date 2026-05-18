import { describe, expect, it } from 'vitest';

import { productRoleToWorkbenchId } from '../../apps/web/src/features/role-workbench/role-labels';
import { queryKeys } from '../../apps/web/src/shared/api/query-keys';

describe('Web product API hooks', () => {
  it('uses stable query keys for route-backed product data', () => {
    expect(queryKeys.workbench({ role: 'work-item-owner', projectId: 'proj' })).toEqual([
      'workbench',
      'intake',
      { projectId: 'proj' },
    ]);
  });

  it('maps product role labels to backend workbench ids without leaking Intake', () => {
    expect(productRoleToWorkbenchId('Work Item Owner')).toBe('intake');
  });
});
