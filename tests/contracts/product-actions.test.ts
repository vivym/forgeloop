import { describe, expect, it } from 'vitest';

import * as contracts from '@forgeloop/contracts';
import {
  productActionSchema,
  productLaneIdSchema,
  productLaneResponseSchema,
  workItemActionsResponseSchema,
} from '@forgeloop/contracts';

const updatedAt = '2026-05-19T00:00:00.000Z';

const validObjectTarget = {
  kind: 'object',
  object_type: 'work_item',
  object_id: 'wi_1',
  href: '/work-items/wi_1#replay',
} as const;

const validLaneTarget = {
  kind: 'lane',
  lane_id: 'bugs',
  href: '/workbench/bugs?project_id=p1',
} as const;

const validNavigateAction = {
  id: 'open-work-item',
  lane_id: 'bugs',
  priority: 'primary',
  label: 'Open bug',
  enabled: true,
  kind: 'navigate',
  target: validObjectTarget,
} as const;

const validCommand = {
  type: 'generate_spec_draft',
  object_type: 'spec',
  object_id: 'spec_1',
  work_item_id: 'wi_1',
  spec_id: 'spec_1',
} as const;

const validCommandAction = {
  id: 'generate-spec-draft',
  lane_id: 'requirements',
  priority: 'tertiary',
  label: 'Generate spec draft',
  description: 'Create the first draft for review.',
  enabled: true,
  kind: 'command',
  command: validCommand,
} as const;

const validLaneItem = {
  id: 'item_1',
  title: 'Bug item',
  object: {
    type: 'work_item',
    id: 'wi_1',
  },
  parent: {
    type: 'release',
    id: 'rel_1',
    title: 'Release 1',
  },
  kind: 'bug',
  surface_type: 'work_item',
  phase: 'planning',
  status: 'open',
  gate_state: 'none',
  resolution: 'none',
  risk: 'medium',
  updated_at: updatedAt,
  actions: [validNavigateAction],
} as const;

const validLaneResponse = {
  lane_id: 'bugs',
  label: 'Bugs',
  description: 'Bug triage, repair planning, verification, and regression follow-up.',
  items: [validLaneItem],
  unsupported_filters: [],
  summary: {
    total: 1,
    blocked: 0,
    high_risk: 0,
    stale: 0,
  },
} as const;

describe('ProductAction contracts', () => {
  it('exports only the product-lane contract surface for workbench actions', () => {
    expect(productLaneIdSchema.options).toEqual([
      'requirements',
      'bugs',
      'tech-debt',
      'initiatives',
      'spec-approver',
      'execution-owner',
      'reviewer',
      'qa-test-owner',
      'release-owner',
      'manager',
    ]);

    expect(`${'role'}${'Workbench'}ActionSchema` in contracts).toBe(false);
    expect(`${'role'}${'Workbench'}ResponseSchema` in contracts).toBe(false);
  });

  it('parses valid navigate and command actions', () => {
    expect(productActionSchema.parse(validNavigateAction)).toEqual(validNavigateAction);
    expect(productActionSchema.parse(validCommandAction)).toEqual(validCommandAction);
  });

  it('rejects unknown object fields on all product action contract objects', () => {
    expect(productActionSchema.safeParse({ ...validNavigateAction, extra: true }).success).toBe(false);
    expect(
      productActionSchema.safeParse({ ...validNavigateAction, target: { ...validObjectTarget, extra: true } }).success,
    ).toBe(false);
    expect(
      productActionSchema.safeParse({ ...validCommandAction, command: { ...validCommand, extra: true } }).success,
    ).toBe(false);
    expect(productLaneResponseSchema.safeParse({ ...validLaneResponse, extra: true }).success).toBe(false);
    expect(
      workItemActionsResponseSchema.safeParse({
        work_item_id: 'wi_1',
        lane_id: 'bugs',
        default_lane_id: 'bugs',
        actions: [],
        extra: true,
      }).success,
    ).toBe(false);
  });

  it('rejects empty or trimmed-empty strings across required string fields', () => {
    expect(productActionSchema.safeParse({ ...validNavigateAction, id: '   ' }).success).toBe(false);
    expect(productActionSchema.safeParse({ ...validNavigateAction, label: '' }).success).toBe(false);
    expect(
      productActionSchema.safeParse({ ...validNavigateAction, target: { ...validObjectTarget, object_id: '  ' } })
        .success,
    ).toBe(false);
    expect(
      productActionSchema.safeParse({ ...validNavigateAction, target: { ...validObjectTarget, href: '   ' } }).success,
    ).toBe(false);
    expect(
      productActionSchema.safeParse({ ...validCommandAction, command: { ...validCommand, work_item_id: '' } }).success,
    ).toBe(false);
    expect(productLaneResponseSchema.safeParse({ ...validLaneResponse, label: '   ' }).success).toBe(false);
  });

  it('requires navigate actions to carry a target and no command', () => {
    expect(productActionSchema.safeParse({ ...validNavigateAction, target: undefined }).success).toBe(false);
    expect(productActionSchema.safeParse({ ...validNavigateAction, command: validCommand }).success).toBe(false);
  });

  it('requires command actions to carry a command', () => {
    expect(productActionSchema.safeParse({ ...validCommandAction, command: undefined }).success).toBe(false);
  });

  it('enforces priority and disabled or blocked reason rules', () => {
    expect(productActionSchema.safeParse({ ...validNavigateAction, priority: 'secondary' }).success).toBe(true);
    expect(productActionSchema.safeParse({ ...validNavigateAction, priority: 'tertiary' }).success).toBe(true);
    expect(productActionSchema.safeParse({ ...validNavigateAction, priority: 'danger' }).success).toBe(false);
    expect(productActionSchema.safeParse({ ...validNavigateAction, disabled_reason: 'Not allowed' }).success).toBe(
      false,
    );
    expect(productActionSchema.safeParse({ ...validNavigateAction, blocked_reason: 'Blocked' }).success).toBe(false);
    expect(productActionSchema.safeParse({ ...validNavigateAction, enabled: false }).success).toBe(false);
    expect(
      productActionSchema.safeParse({ ...validNavigateAction, enabled: false, disabled_reason: 'Need approval' })
        .success,
    ).toBe(true);
    expect(
      productActionSchema.safeParse({
        ...validNavigateAction,
        enabled: false,
        disabled_reason: 'Need approval',
        blocked_reason: 'Waiting for package',
      }).success,
    ).toBe(true);
    expect(
      productActionSchema.safeParse({
        ...validNavigateAction,
        enabled: false,
        blocked_reason: 'Waiting for package',
      }).success,
    ).toBe(false);
    expect(
      productActionSchema.safeParse({
        ...validNavigateAction,
        enabled: false,
        disabled_reason: 'Need approval',
        blocked_reason: '',
      }).success,
    ).toBe(false);
  });

  it('only allows same-origin relative UI hrefs on approved route prefixes', () => {
    for (const href of [
      'https://example.com/work-items/wi_1',
      '//example.com/work-items/wi_1',
      '/query/replay/work_item/wi_1',
      '/%71uery/replay/work_item/wi_1',
      '/work-items/%2e%2e/%2e%2e/query/replay',
      '/work-items/%2F..%2Fquery/replay',
      '/work-items/%252e%252e/%252e%252e/query/replay',
      '/work-items/%2Fwi_1',
      '/api/work-items/wi_1',
      '/workbench-old/bugs',
      '/work-items/wi_1/run',
      '/work-items/wi_1/rerun',
      '/work-items/wi_1/approve',
      '/work-items/wi_1/request-changes',
      '/specs/spec_1/generate-draft',
      '/plans/plan_1/generate-draft',
      '/execution-packages/pkg_1/run',
    ]) {
      expect(productActionSchema.safeParse({ ...validNavigateAction, target: { ...validObjectTarget, href } }).success).toBe(
        false,
      );
    }
  });

  it('validates lane targets against the target lane id', () => {
    expect(productActionSchema.safeParse({ ...validNavigateAction, target: validLaneTarget }).success).toBe(true);
    expect(
      productActionSchema.safeParse({
        ...validNavigateAction,
        target: { ...validLaneTarget, href: '/workbench/requirements?project_id=p1' },
      }).success,
    ).toBe(false);
    expect(
      productActionSchema.safeParse({
        ...validNavigateAction,
        target: { ...validLaneTarget, href: `/workbench/bugs?${'role'}=${'work'}-${'item'}-${'owner'}` },
      }).success,
    ).toBe(false);
    expect(
      productActionSchema.safeParse({
        ...validNavigateAction,
        target: { ...validLaneTarget, href: '/workbench/bugs?project_id=p1&project_id=p2' },
      }).success,
    ).toBe(false);
    expect(
      productActionSchema.safeParse({
        ...validNavigateAction,
        target: { ...validLaneTarget, href: '/workbench/bugs?project_id=p1&kind=bug&blocked=true' },
      }).success,
    ).toBe(true);
    expect(() =>
      productActionSchema.safeParse({
        ...validNavigateAction,
        target: { ...validLaneTarget, href: '/workbench/%E0%A4%A' },
      }),
    ).not.toThrow();
    expect(
      productActionSchema.safeParse({
        ...validNavigateAction,
        target: { ...validLaneTarget, href: '/workbench/%E0%A4%A' },
      }).success,
    ).toBe(false);
  });

  it('validates concrete command object ids and version types', () => {
    const commands = [
      {
        type: 'generate_spec_draft',
        object_type: 'spec',
        object_id: 'spec_1',
        work_item_id: 'wi_1',
        spec_id: 'spec_1',
      },
      {
        type: 'generate_plan_draft',
        object_type: 'plan',
        object_id: 'plan_1',
        work_item_id: 'wi_1',
        plan_id: 'plan_1',
      },
      {
        type: 'generate_packages',
        object_type: 'plan_revision',
        object_id: 'plan_rev_1',
        work_item_id: 'wi_1',
        plan_revision_id: 'plan_rev_1',
      },
      {
        type: 'mark_package_ready',
        object_type: 'execution_package',
        object_id: 'pkg_1',
        work_item_id: 'wi_1',
        package_id: 'pkg_1',
        expected_package_version: 3,
      },
      {
        type: 'run_package',
        object_type: 'execution_package',
        object_id: 'pkg_1',
        work_item_id: 'wi_1',
        package_id: 'pkg_1',
      },
    ] as const;

    for (const command of commands) {
      expect(productActionSchema.safeParse({ ...validCommandAction, command }).success).toBe(true);
    }

    expect(
      productActionSchema.safeParse({
        ...validCommandAction,
        command: { ...validCommand, object_id: 'different_spec' },
      }).success,
    ).toBe(false);
    expect(
      productActionSchema.safeParse({
        ...validCommandAction,
        command: {
          type: 'mark_package_ready',
          object_type: 'execution_package',
          object_id: 'pkg_1',
          work_item_id: 'wi_1',
          package_id: 'pkg_1',
          expected_package_version: '3',
        },
      }).success,
    ).toBe(false);
  });

  it('validates ProductLaneResponse required fields, item uniqueness, and lane consistency', () => {
    expect(productLaneResponseSchema.safeParse(validLaneResponse).success).toBe(true);
    expect(productLaneResponseSchema.safeParse({ lane_id: 'bugs', items: [] }).success).toBe(false);
    expect(
      productLaneResponseSchema.safeParse({
        ...validLaneResponse,
        items: [validLaneItem, { ...validLaneItem, object: { type: 'work_item', id: 'wi_2' } }],
      }).success,
    ).toBe(false);
    expect(
      productLaneResponseSchema.safeParse({
        ...validLaneResponse,
        items: [{ ...validLaneItem, actions: [validNavigateAction, { ...validNavigateAction, label: 'Duplicate' }] }],
      }).success,
    ).toBe(false);
    expect(
      productLaneResponseSchema.safeParse({
        ...validLaneResponse,
        items: [{ ...validLaneItem, actions: [{ ...validNavigateAction, lane_id: 'requirements' }] }],
      }).success,
    ).toBe(false);
    expect(
      productLaneResponseSchema.safeParse({
        ...validLaneResponse,
        items: [
          {
            ...validLaneItem,
            object: { type: 'lane_summary', id: 'summary_1', lane_id: 'requirements' },
          },
        ],
      }).success,
    ).toBe(false);
  });

  it('validates WorkItemActionsResponse work item, lane, default lane, and action id consistency', () => {
    expect(
      workItemActionsResponseSchema.safeParse({
        work_item_id: 'wi_1',
        lane_id: 'bugs',
        default_lane_id: 'bugs',
        actions: [validNavigateAction],
      }).success,
    ).toBe(true);

    expect(
      workItemActionsResponseSchema.safeParse({
        work_item_id: 'wi_1',
        lane_id: 'bugs',
        actions: [validNavigateAction],
      }).success,
    ).toBe(false);

    expect(
      workItemActionsResponseSchema.safeParse({
        work_item_id: 'wi_2',
        lane_id: 'requirements',
        default_lane_id: 'requirements',
        actions: [validCommandAction],
      }).success,
    ).toBe(false);

    expect(
      workItemActionsResponseSchema.safeParse({
        work_item_id: 'wi_1',
        lane_id: 'requirements',
        default_lane_id: 'requirements',
        actions: [validNavigateAction],
      }).success,
    ).toBe(false);

    expect(
      workItemActionsResponseSchema.safeParse({
        work_item_id: 'wi_1',
        lane_id: 'bugs',
        default_lane_id: 'bugs',
        actions: [validNavigateAction, { ...validNavigateAction, label: 'Duplicate action' }],
      }).success,
    ).toBe(false);
  });

  it('rejects command actions in the manager lane', () => {
    expect(productActionSchema.safeParse({ ...validCommandAction, lane_id: 'manager' }).success).toBe(false);
  });
});
