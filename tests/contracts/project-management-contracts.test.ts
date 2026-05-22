import { describe, expect, it } from 'vitest';

import {
  editableObjectRefSchema,
  legacyWorkItemStorageRefSchema,
  objectRefSchema,
  productListItemSchema,
  taskDetailSchema,
} from '@forgeloop/contracts';

describe('project management typed object contracts', () => {
  it('accepts typed product refs and keeps work_item storage refs internal only', () => {
    expect(objectRefSchema.parse({ type: 'requirement', id: 'wi-req' })).toEqual({
      type: 'requirement',
      id: 'wi-req',
    });
    expect(objectRefSchema.parse({ type: 'task', id: 'task-1' })).toEqual({ type: 'task', id: 'task-1' });
    expect(() => objectRefSchema.parse({ type: 'work_item', id: 'wi-1' })).toThrow();
    expect(
      legacyWorkItemStorageRefSchema.parse({
        type: 'work_item',
        id: 'wi-1',
        work_item_kind: 'initiative',
      }),
    ).toEqual({
      type: 'work_item',
      id: 'wi-1',
      work_item_kind: 'initiative',
    });
  });

  it('uses driver_actor_id on editable Work Item typed surfaces', () => {
    expect(
      editableObjectRefSchema.parse({
        type: 'tech_debt',
        id: 'td-1',
        driver_actor_id: 'actor-tech',
      }),
    ).toMatchObject({
      type: 'tech_debt',
      driver_actor_id: 'actor-tech',
    });
    expect(() =>
      editableObjectRefSchema.parse({
        type: 'requirement',
        id: 'req-1',
        owner_actor_id: 'actor-owner',
      }),
    ).toThrow();
  });

  it('requires approved Spec and Plan authority for runtime package eligible tasks', () => {
    const task = taskDetailSchema.parse({
      id: 'task-1',
      title: 'Implement checkout validation',
      parent_ref: { type: 'requirement', id: 'req-1' },
      controlling_spec_revision_id: 'spec-rev-1',
      controlling_plan_revision_id: 'plan-rev-1',
      stale_state: 'current',
      package_generation_eligible: true,
    });
    expect(task.package_generation_eligible).toBe(true);
  });

  it('does not let manual exceptions authorize runtime packages', () => {
    expect(() =>
      taskDetailSchema.parse({
        id: 'task-manual',
        title: 'Emergency manual follow-up',
        stale_state: 'manual_exception',
        package_generation_eligible: true,
        audited_exception: {
          exception_id: 'ex-1',
          actor_id: 'actor-tech',
          reason: 'Manual work before plan approval',
          risk: 'high',
          rollback_plan: 'Revert manual change',
          verification_ref: { type: 'audited_exception_decision', id: 'decision-1' },
          supporting_attachment_refs: [],
          release_impact: 'release_scoped',
          created_at: '2026-05-23T00:00:00.000Z',
        },
      }),
    ).toThrow(/manual_exception/i);
  });

  it('rejects public product list items that expose work_item refs or owner_actor_id', () => {
    expect(() =>
      productListItemSchema.parse({
        id: 'row-1',
        object: { type: 'work_item', id: 'wi-1', title: 'Legacy row' },
        title: 'Legacy row',
        owner_actor_id: 'actor-owner',
        updated_at: '2026-05-23T00:00:00.000Z',
      }),
    ).toThrow();
  });
});
