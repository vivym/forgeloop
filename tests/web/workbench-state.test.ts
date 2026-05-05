import { describe, expect, it } from 'vitest';

import { isActiveCockpit } from '../../apps/web/src/workbenchState';

describe('workbench state helpers', () => {
  it('only treats cockpit data as active when it matches the selected work item', () => {
    expect(isActiveCockpit({ work_item: { id: 'work-item-1' } }, 'work-item-1')).toBe(true);
    expect(isActiveCockpit({ work_item: { id: 'work-item-1' } }, 'work-item-2')).toBe(false);
    expect(isActiveCockpit({}, 'work-item-1')).toBe(false);
    expect(isActiveCockpit({ work_item: { id: 'work-item-1' } }, '')).toBe(false);
  });
});
