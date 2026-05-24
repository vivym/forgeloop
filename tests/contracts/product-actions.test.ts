import { describe, expect, it } from 'vitest';

import * as contracts from '@forgeloop/contracts';
import {
  evidenceChainResponseSchema,
  productActionSchema,
  productCommandSchema,
  productLaneIdSchema,
  productLaneResponseSchema,
  productObjectTypeSchema,
} from '@forgeloop/contracts';

const updatedAt = '2026-05-19T00:00:00.000Z';

const validObjectTarget = {
  kind: 'object',
  object_type: 'bug',
  object_id: 'wi_1',
  href: '/bugs/wi_1',
} as const;

const validRouteTarget = {
  kind: 'route',
  href: '/releases',
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
  type: 'generate_packages',
  object_type: 'plan_revision',
  object_id: 'plan_rev_1',
  scope_ref: { type: 'requirement', id: 'wi_1' },
  plan_revision_id: 'plan_rev_1',
} as const;

const validCommandAction = {
  id: 'generate-packages',
  lane_id: 'requirements',
  priority: 'tertiary',
  label: 'Generate packages',
  description: 'Create package drafts for review.',
  enabled: true,
  kind: 'command',
  command: validCommand,
} as const;

const validLaneItem = {
  id: 'item_1',
  title: 'Bug item',
  object: {
    type: 'bug',
    id: 'wi_1',
  },
  parent: {
    type: 'release',
    id: 'rel_1',
    title: 'Release 1',
  },
  kind: 'bug',
  surface_type: 'bug',
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
  it('exports only the product-lane contract surface for Product Lane actions', () => {
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
    expect(productObjectTypeSchema.options).not.toContain('work_item');

    expect(`${'role'}${'Workbench'}ActionSchema` in contracts).toBe(false);
    expect(`${'role'}${'Workbench'}ResponseSchema` in contracts).toBe(false);
    expect('workItemActionsResponseSchema' in contracts).toBe(false);
    expect('WorkItemActionsResponse' in contracts).toBe(false);
  });

  it('parses valid navigate and package command actions', () => {
    expect(productActionSchema.parse(validNavigateAction)).toEqual(validNavigateAction);
    expect(productActionSchema.parse(validCommandAction)).toEqual(validCommandAction);
  });

  it('rejects retired direct document draft product commands', () => {
    const retiredTypes = [
      ['generate', 'spec', 'draft'].join('_'),
      ['generate', 'plan', 'draft'].join('_'),
    ];

    for (const type of retiredTypes) {
      expect(
        productCommandSchema.safeParse({
          type,
          object_type: type.includes('spec') ? 'spec' : 'plan',
          object_id: 'doc_1',
          scope_ref: { type: 'requirement', id: 'wi_1' },
          spec_id: 'doc_1',
          plan_id: 'doc_1',
        }).success,
      ).toBe(false);
    }
  });

  it('does not add typed Work Item intake commands to ProductAction command schemas', () => {
    for (const type of ['create_work_item', 'update_work_item', 'patch_work_item', 'update_work_item_intake']) {
      expect(
        productActionSchema.safeParse({
          ...validCommandAction,
          command: {
            type,
            object_type: 'work_item',
            object_id: 'wi_1',
            scope_ref: { type: 'requirement', id: 'wi_1' },
            driver_actor_id: 'actor-driver',
            intake_context: { type: 'bug' },
          },
        }).success,
      ).toBe(false);
    }
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
      productActionSchema.safeParse({ ...validCommandAction, command: { ...validCommand, scope_ref: { type: 'requirement', id: '' } } }).success,
    ).toBe(false);
    expect(productLaneResponseSchema.safeParse({ ...validLaneResponse, label: '   ' }).success).toBe(false);
  });

  it('requires navigate actions to carry a target and no command', () => {
    expect(productActionSchema.safeParse({ ...validNavigateAction, target: undefined }).success).toBe(false);
    expect(productActionSchema.safeParse({ ...validNavigateAction, command: validCommand }).success).toBe(false);
  });

  it('supports route targets for product collection pages without object identity', () => {
    expect(productActionSchema.safeParse({ ...validNavigateAction, target: validRouteTarget }).success).toBe(true);
    expect(
      productActionSchema.safeParse({ ...validNavigateAction, target: { ...validRouteTarget, object_id: 'project-1' } })
        .success,
    ).toBe(false);
    expect(
      productActionSchema.safeParse({ ...validNavigateAction, target: { ...validRouteTarget, href: '/releases/create' } })
        .success,
    ).toBe(false);
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
      '/workbench/bugs',
      '/workbench-old/bugs',
      '/work-items/wi_1/run',
      '/work-items/wi_1/rerun',
      '/work-items/wi_1/approve',
      '/work-items/wi_1/request-changes',
      '/development-plans/development-plan-1/items/development-plan-item-1/spec/generate-draft',
      '/development-plans/development-plan-1/items/development-plan-item-1/execution-plan/generate-draft',
      '/execution-packages/pkg_1/run',
      '/lanes/bugs',
      '/pipeline',
      '/packages/pkg_1',
      '/runs/run_1',
      '/reviews/review_1',
      '/specs',
      '/plans',
    ]) {
      expect(productActionSchema.safeParse({ ...validNavigateAction, target: { ...validObjectTarget, href } }).success).toBe(
        false,
      );
    }
  });

  it('rejects legacy lane targets and accepts product IA route targets', () => {
    expect(() =>
      productActionSchema.safeParse({
        ...validNavigateAction,
        target: { kind: 'lane', lane_id: 'bugs', href: '/lanes/bugs?project_id=p1' },
      }),
    ).not.toThrow();
    expect(
      productActionSchema.safeParse({
        ...validNavigateAction,
        target: { kind: 'lane', lane_id: 'bugs', href: '/lanes/bugs?project_id=p1' },
      }).success,
    ).toBe(false);
    expect(
      productActionSchema.safeParse({
        ...validNavigateAction,
        target: { kind: 'route', href: '/bugs?project_id=p1&kind=bug&blocked=true' },
      }).success,
    ).toBe(true);
    expect(
      productActionSchema.safeParse({
        ...validNavigateAction,
        target: { kind: 'route', href: '/tasks?project_id=p1&reviewer_actor_id=actor-reviewer' },
      }).success,
    ).toBe(true);
  });

  it('validates concrete command object ids and version types', () => {
    const commands = [
      {
        type: 'generate_packages',
        object_type: 'plan_revision',
        object_id: 'plan_rev_1',
        scope_ref: { type: 'requirement', id: 'wi_1' },
        plan_revision_id: 'plan_rev_1',
      },
      {
        type: 'mark_package_ready',
        object_type: 'execution_package',
        object_id: 'pkg_1',
        scope_ref: { type: 'requirement', id: 'wi_1' },
        package_id: 'pkg_1',
        expected_package_version: 3,
      },
      {
        type: 'run_package',
        object_type: 'execution_package',
        object_id: 'pkg_1',
        scope_ref: { type: 'requirement', id: 'wi_1' },
        package_id: 'pkg_1',
      },
    ] as const;

    for (const command of commands) {
      expect(productActionSchema.safeParse({ ...validCommandAction, command }).success).toBe(true);
    }

    expect(
      productActionSchema.safeParse({
        ...validCommandAction,
        command: { ...validCommand, object_id: 'different_plan_revision' },
      }).success,
    ).toBe(false);
    expect(
      productActionSchema.safeParse({
        ...validCommandAction,
        command: {
          type: 'mark_package_ready',
          object_type: 'execution_package',
          object_id: 'pkg_1',
          scope_ref: { type: 'requirement', id: 'wi_1' },
          package_id: 'pkg_1',
          expected_package_version: '3',
        },
      }).success,
    ).toBe(false);
    expect(productCommandSchema.safeParse({ ...validCommand, work_item_id: 'wi_1' }).success).toBe(false);
    expect(productCommandSchema.safeParse({ ...validCommand, scope_ref: { type: 'work_item', id: 'wi_1' } }).success).toBe(false);
  });

  it('validates ProductLaneResponse required fields, item uniqueness, and lane consistency', () => {
    expect(productLaneResponseSchema.safeParse(validLaneResponse).success).toBe(true);
    expect(productLaneResponseSchema.safeParse({ lane_id: 'bugs', items: [] }).success).toBe(false);
    expect(
      productLaneResponseSchema.safeParse({
        ...validLaneResponse,
        items: [validLaneItem, { ...validLaneItem, object: { type: 'bug', id: 'wi_2' } }],
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
    expect(
      productLaneResponseSchema.safeParse({
        ...validLaneResponse,
        items: [{ ...validLaneItem, object: { type: 'work_item', id: 'wi_1' } }],
      }).success,
    ).toBe(false);
    expect(
      productLaneResponseSchema.safeParse({
        ...validLaneResponse,
        items: [{ ...validLaneItem, owner_actor_id: 'actor-owner' }],
      }).success,
    ).toBe(false);
  });

  it('rejects command actions in the manager lane', () => {
    expect(productActionSchema.safeParse({ ...validCommandAction, lane_id: 'manager' }).success).toBe(false);
  });

  it('requires Evidence Chain responses to use typed scope refs without legacy Work Item ids', () => {
    const validEvidenceChain = {
      scope_ref: { type: 'requirement', id: 'wi_1' },
      generated_at: updatedAt,
      focus: { selection: 'current', review_packet_ids: [] },
      projection: { source: 'read_time', version: 1, partial: false, gaps: [] },
      summary: {
        total_items: 0,
        run_count: 0,
        review_packet_count: 0,
        decision_count: 0,
        artifact_count: 0,
        risk_flags: [],
        redacted_count: 0,
      },
      items: [],
    } as const;

    expect(evidenceChainResponseSchema.safeParse(validEvidenceChain).success).toBe(true);
    expect(evidenceChainResponseSchema.safeParse({ ...validEvidenceChain, work_item_id: 'wi_1' }).success).toBe(false);
    expect(
      evidenceChainResponseSchema.safeParse({
        ...validEvidenceChain,
        scope_ref: { type: 'work_item', id: 'wi_1' },
      }).success,
    ).toBe(false);
    expect(
      evidenceChainResponseSchema.safeParse({
        ...validEvidenceChain,
        items: [
          {
            id: 'item-1',
            source: 'object_event',
            subject: { object_type: 'work_item', object_id: 'wi_1' },
            summary: 'Leaked legacy Work Item ref.',
            created_at: updatedAt,
            visibility: 'public',
            links: [],
            risk_flags: [],
            redacted: false,
          },
        ],
        summary: { ...validEvidenceChain.summary, total_items: 1 },
      }).success,
    ).toBe(false);
  });
});
