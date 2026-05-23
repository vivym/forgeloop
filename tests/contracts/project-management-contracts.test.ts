import { describe, expect, it } from 'vitest';

import {
  bugDetailSchema,
  bugListItemSchema,
  brainstormingSessionSchema,
  editableObjectRefSchema,
  initiativeDetailSchema,
  initiativeListItemSchema,
  legacyWorkItemStorageRefSchema,
  objectRefSchema,
  planDetailSchema,
  pipelineResponseSchema,
  productObjectRefSchema,
  productListQuerySchema,
  productListItemSchema,
  requirementDetailSchema,
  requirementListItemSchema,
  specDetailSchema,
  specPlanQueueItemSchema,
  taskListItemSchema,
  techDebtDetailSchema,
  techDebtListItemSchema,
  taskDetailSchema,
} from '@forgeloop/contracts';

describe('project management typed object contracts', () => {
  it('uses AI-native typed product refs and rejects legacy task/plan/work_item refs', () => {
    expect(productObjectRefSchema.parse({ type: 'development_plan', id: 'dp-1' })).toMatchObject({
      type: 'development_plan',
    });
    expect(
      productObjectRefSchema.parse({
        type: 'development_plan_item',
        id: 'dpi-1',
        development_plan_id: 'dp-1',
      }),
    ).toMatchObject({
      type: 'development_plan_item',
    });
    expect(
      productObjectRefSchema.parse({
        type: 'execution_plan_revision',
        id: 'epr-1',
        execution_plan_id: 'ep-1',
      }),
    ).toMatchObject({
      type: 'execution_plan_revision',
    });
    expect(() => productObjectRefSchema.parse({ type: 'work_item', id: 'wi-1' })).toThrow();
    expect(() => productObjectRefSchema.parse({ type: 'task', id: 'task-1' })).toThrow();
    expect(() => productObjectRefSchema.parse({ type: 'plan', id: 'plan-1' })).toThrow();
  });

  it('requires persisted brainstorming evidence before a boundary can approve Spec generation', () => {
    const session = brainstormingSessionSchema.parse({
      id: 'bs-1',
      revision_id: 'bs-rev-1',
      source_ref: { type: 'requirement', id: 'req-1', revision_id: 'req-rev-1' },
      development_plan_id: 'dp-1',
      development_plan_item_id: 'dpi-1',
      development_plan_item_revision_id: 'dpi-rev-1',
      context_manifest_id: 'cm-1',
      context_manifest_revision_id: 'cm-rev-1',
      questions: [
        {
          id: 'q-1',
          text: 'Which repo is in scope?',
          author_id: 'codex-runtime',
          created_at: '2026-05-24T00:00:00.000Z',
          status: 'answered',
        },
      ],
      answers: [
        {
          id: 'a-1',
          question_id: 'q-1',
          text: 'Only apps/web.',
          actor_id: 'actor-tech',
          created_at: '2026-05-24T00:01:00.000Z',
        },
      ],
      decisions: [
        {
          id: 'd-1',
          text: 'Keep backend out of scope.',
          actor_id: 'actor-tech',
          rationale: 'UI-only item.',
          created_at: '2026-05-24T00:02:00.000Z',
        },
      ],
      approval_state: 'approved',
      boundary_summary_id: 'boundary-1',
      approver_actor_id: 'actor-tech',
      approved_at: '2026-05-24T00:03:00.000Z',
    });
    expect(session.approval_state).toBe('approved');
  });

  it('rejects boundary approval without recorded questions, answers, and decisions', () => {
    expect(() =>
      brainstormingSessionSchema.parse({
        id: 'bs-1',
        revision_id: 'bs-rev-1',
        source_ref: { type: 'requirement', id: 'req-1' },
        development_plan_id: 'dp-1',
        development_plan_item_id: 'dpi-1',
        development_plan_item_revision_id: 'dpi-rev-1',
        context_manifest_id: 'cm-1',
        context_manifest_revision_id: 'cm-rev-1',
        questions: [],
        answers: [],
        decisions: [],
        approval_state: 'approved',
        boundary_summary_id: 'boundary-1',
        approver_actor_id: 'actor-tech',
        approved_at: '2026-05-24T00:03:00.000Z',
      }),
    ).toThrow(/questions/i);
  });

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
      ref: { type: 'task', id: 'task-1' },
      title: 'Implement checkout validation',
      status: 'ready',
      parent_ref: { type: 'requirement', id: 'req-1' },
      controlling_spec_revision_id: 'spec-rev-1',
      controlling_plan_revision_id: 'plan-rev-1',
      controlling_spec_revision_authority: 'current_approved',
      controlling_plan_revision_authority: 'current_approved',
      stale_state: 'current',
      package_generation_eligible: true,
    });
    expect(task.package_generation_eligible).toBe(true);
  });

  it('requires current approved revision authority for package generation eligible tasks', () => {
    expect(() =>
      taskDetailSchema.parse({
        id: 'task-1',
        ref: { type: 'task', id: 'task-1' },
        title: 'Implement checkout validation',
        status: 'ready',
        controlling_spec_revision_id: 'spec-rev-1',
        controlling_plan_revision_id: 'plan-rev-1',
        stale_state: 'current',
        package_generation_eligible: true,
      }),
    ).toThrow(/current approved/i);

    expect(() =>
      taskDetailSchema.parse({
        id: 'task-1',
        ref: { type: 'task', id: 'task-1' },
        title: 'Implement checkout validation',
        status: 'ready',
        controlling_spec_revision_id: 'spec-rev-1',
        controlling_plan_revision_id: 'plan-rev-1',
        controlling_spec_revision_authority: 'current_approved',
        controlling_plan_revision_authority: 'stale',
        stale_state: 'current',
        package_generation_eligible: true,
      }),
    ).toThrow(/current approved/i);

    expect(() =>
      taskDetailSchema.parse({
        id: 'task-1',
        ref: { type: 'task', id: 'task-1' },
        title: 'Implement checkout validation',
        status: 'ready',
        controlling_spec_revision_id: 'spec-rev-1',
        controlling_plan_revision_id: 'plan-rev-1',
        controlling_spec_revision_authority: 'unapproved',
        controlling_plan_revision_authority: 'current_approved',
        stale_state: 'current',
        package_generation_eligible: true,
      }),
    ).toThrow(/current approved/i);

    expect(
      taskDetailSchema.parse({
        id: 'task-1',
        ref: { type: 'task', id: 'task-1' },
        title: 'Implement checkout validation',
        status: 'ready',
        controlling_spec_revision_id: 'spec-rev-1',
        controlling_plan_revision_id: 'plan-rev-1',
        controlling_spec_revision_authority: 'current_approved',
        controlling_plan_revision_authority: 'current_approved',
        stale_state: 'current',
        package_generation_eligible: true,
      }),
    ).toMatchObject({
      package_generation_eligible: true,
      controlling_spec_revision_authority: 'current_approved',
      controlling_plan_revision_authority: 'current_approved',
    });
  });

  it('does not let manual exceptions authorize runtime packages', () => {
    expect(() =>
      taskDetailSchema.parse({
        id: 'task-manual',
        ref: { type: 'task', id: 'task-manual' },
        title: 'Emergency manual follow-up',
        status: 'blocked',
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

  it('requires audited exception details for manual exception tasks', () => {
    expect(() =>
      taskDetailSchema.parse({
        id: 'task-manual',
        ref: { type: 'task', id: 'task-manual' },
        title: 'Emergency manual follow-up',
        status: 'blocked',
        stale_state: 'manual_exception',
        package_generation_eligible: false,
      }),
    ).toThrow(/audited_exception/i);

    expect(
      taskDetailSchema.parse({
        id: 'task-manual',
        ref: { type: 'task', id: 'task-manual' },
        title: 'Emergency manual follow-up',
        status: 'blocked',
        stale_state: 'manual_exception',
        package_generation_eligible: false,
        audited_exception: {
          exception_id: 'ex-1',
          actor_id: 'actor-tech',
          reason: 'Manual work before plan approval',
          risk: 'high',
          rollback_plan: 'Revert manual change',
          verification_ref: {
            id: 'qa-evidence-1',
            scope_ref: { type: 'task', id: 'task-manual' },
            evidence_type: 'qa_acceptance',
            status: 'passed',
            required: true,
            attachment_refs: [],
          },
          supporting_attachment_refs: [],
          release_impact: 'release_scoped',
          created_at: '2026-05-23T00:00:00.000Z',
        },
      }),
    ).toMatchObject({
      stale_state: 'manual_exception',
      package_generation_eligible: false,
    });
  });

  it('exposes a type-specific ref on task detail read models', () => {
    expect(
      taskDetailSchema.parse({
        id: 'task-1',
        ref: { type: 'task', id: 'task-1' },
        title: 'Implement checkout validation',
        status: 'todo',
        stale_state: 'current',
      }),
    ).toMatchObject({
      ref: { type: 'task', id: 'task-1' },
    });

    expect(() =>
      taskDetailSchema.parse({
        id: 'task-1',
        ref: { type: 'requirement', id: 'req-1' },
        title: 'Implement checkout validation',
        status: 'todo',
        stale_state: 'current',
      }),
    ).toThrow();

    expect(() =>
      taskDetailSchema.parse({
        id: 'task-1',
        ref: { type: 'release', id: 'rel-1' },
        title: 'Implement checkout validation',
        status: 'todo',
        stale_state: 'current',
      }),
    ).toThrow();
  });

  it('keeps task detail-page state on task detail read models', () => {
    expect(
      taskDetailSchema.parse({
        id: 'task-1',
        ref: { type: 'task', id: 'task-1' },
        title: 'Implement checkout validation',
        status: 'in_progress',
        stale_state: 'current',
        driver_actor_id: 'actor-driver',
        updated_at: '2026-05-23T00:00:00.000Z',
      }),
    ).toMatchObject({
      status: 'in_progress',
      driver_actor_id: 'actor-driver',
      updated_at: '2026-05-23T00:00:00.000Z',
    });

    expect(() =>
      taskDetailSchema.parse({
        id: 'task-1',
        ref: { type: 'release', id: 'rel-1' },
        title: 'Implement checkout validation',
        status: 'in_progress',
        stale_state: 'current',
      }),
    ).toThrow();
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

  it('rejects public product query filters with legacy owner or work item fields', () => {
    expect(() =>
      productListQuerySchema.parse({
        project_id: 'project-1',
        owner_actor_id: 'actor-owner',
      }),
    ).toThrow();

    expect(() =>
      productListQuerySchema.parse({
        project_id: 'project-1',
        work_item_id: 'wi-1',
      }),
    ).toThrow();

    expect(
      productListQuerySchema.parse({
        project_id: 'project-1',
        driver_actor_id: 'actor-driver',
      }),
    ).toMatchObject({ driver_actor_id: 'actor-driver' });
  });

  it('rejects nested package state that exposes legacy work_item_id', () => {
    expect(() =>
      productListItemSchema.parse({
        id: 'row-2',
        object: { type: 'execution', id: 'exec-1', title: 'Execution' },
        title: 'Execution',
        package_state: {
          work_item_id: 'wi-1',
          spec_revision_id: 'spec-rev-1',
          plan_revision_id: 'plan-rev-1',
        },
        updated_at: '2026-05-23T00:00:00.000Z',
      }),
    ).toThrow();
  });

  it('accepts nested package state with typed scope refs', () => {
    expect(
      productListItemSchema.parse({
        id: 'row-3',
        object: { type: 'execution', id: 'exec-1', title: 'Execution' },
        title: 'Execution',
        package_state: {
          scope_ref: { type: 'development_plan_item', id: 'dpi-1', development_plan_id: 'dp-1' },
          spec_revision_id: 'spec-rev-1',
          plan_revision_id: 'plan-rev-1',
        },
        updated_at: '2026-05-23T00:00:00.000Z',
      }),
    ).toMatchObject({
      package_state: {
        scope_ref: { type: 'development_plan_item', id: 'dpi-1' },
      },
    });
  });

  it('uses qualified QA owner queue fields in pipeline readiness details', () => {
    const pipeline = {
      stages: [
        {
          id: 'test_acceptance',
          label: 'Test Acceptance',
          item_count: 1,
          blocked_count: 0,
          high_risk_count: 0,
          stale_count: 0,
          representative_items: [],
          degraded: false,
          test_acceptance: {
            qa_owner_queues: [{ qa_owner_actor_id: 'actor-qa', item_count: 1 }],
            test_strategy_gaps: [],
            acceptance_criteria_state: 'Ready.',
            quality_gates: [],
            regression_coverage_gaps: [],
            release_blocking_issues: [],
          },
        },
      ],
      degraded_sources: [],
    };

    expect(pipelineResponseSchema.parse(pipeline)).toEqual(pipeline);
    expect(() =>
      pipelineResponseSchema.parse({
        ...pipeline,
        stages: [
          {
            ...pipeline.stages[0],
            test_acceptance: {
              ...pipeline.stages[0].test_acceptance,
              qa_owner_queues: [{ owner_actor_id: 'actor-qa', item_count: 1 }],
            },
          },
        ],
      }),
    ).toThrow();
  });

  it('exposes product-safe Spec and Plan read models with typed refs', () => {
    expect(
      specPlanQueueItemSchema.parse({
        id: 'spec-queue-1',
        entity_type: 'spec',
        title: 'Checkout Spec',
        source_ref: { type: 'requirement', id: 'req-1' },
        status: 'approved',
        gate_state: 'ready',
        current_revision_id: 'spec-rev-2',
        approved_revision_id: 'spec-rev-2',
        updated_at: '2026-05-23T00:00:00.000Z',
        href: '/specs/spec-1',
      }),
    ).toMatchObject({
      entity_type: 'spec',
      source_ref: { type: 'requirement', id: 'req-1' },
    });

    expect(
      specDetailSchema.parse({
        id: 'spec-1',
        ref: { type: 'spec', id: 'spec-1' },
        source_ref: { type: 'requirement', id: 'req-1' },
        title: 'Checkout Spec',
        status: 'approved',
        gate_state: 'ready',
        current_revision_id: 'spec-rev-2',
        approved_revision_id: 'spec-rev-2',
        current_revision: {
          id: 'spec-rev-2',
          revision_number: 2,
          summary: 'Approved checkout behavior',
          approved_at: '2026-05-23T00:00:00.000Z',
          approved_by_actor_id: 'actor-product',
          attachment_refs: [],
        },
      }),
    ).toMatchObject({
      ref: { type: 'spec', id: 'spec-1' },
      source_ref: { type: 'requirement', id: 'req-1' },
    });

    expect(
      planDetailSchema.parse({
        id: 'plan-1',
        ref: { type: 'plan', id: 'plan-1' },
        source_ref: { type: 'requirement', id: 'req-1' },
        title: 'Checkout Plan',
        status: 'approved',
        gate_state: 'ready',
        current_revision_id: 'plan-rev-2',
        approved_revision_id: 'plan-rev-2',
        based_on_spec_revision_id: 'spec-rev-2',
        task_refs: [{ type: 'task', id: 'task-1' }],
      }),
    ).toMatchObject({
      ref: { type: 'plan', id: 'plan-1' },
      task_refs: [{ type: 'task', id: 'task-1' }],
    });
  });

  it('rejects Spec and Plan read models with legacy work_item refs or owner fields', () => {
    expect(() =>
      specPlanQueueItemSchema.parse({
        id: 'spec-queue-legacy',
        entity_type: 'spec',
        title: 'Legacy Spec',
        source_ref: { type: 'work_item', id: 'wi-1' },
        status: 'approved',
        gate_state: 'ready',
      }),
    ).toThrow();

    expect(() =>
      specDetailSchema.parse({
        id: 'spec-legacy',
        ref: { type: 'spec', id: 'spec-legacy' },
        source_ref: { type: 'requirement', id: 'req-1' },
        title: 'Legacy Spec',
        status: 'approved',
        gate_state: 'ready',
        owner_actor_id: 'actor-owner',
      }),
    ).toThrow();

    expect(() =>
      planDetailSchema.parse({
        id: 'plan-legacy',
        ref: { type: 'plan', id: 'plan-legacy' },
        source_ref: { type: 'work_item', id: 'wi-1' },
        title: 'Legacy Plan',
        status: 'approved',
        gate_state: 'ready',
      }),
    ).toThrow();
  });

  it('enforces typed refs on object-specific list read models', () => {
    const listCases = [
      {
        schema: initiativeListItemSchema,
        valid: { id: 'init-1', ref: { type: 'initiative', id: 'init-1' }, title: 'Initiative', status: 'active' },
        invalid: { id: 'init-1', ref: { type: 'task', id: 'task-1' }, title: 'Initiative', status: 'active' },
      },
      {
        schema: requirementListItemSchema,
        valid: { id: 'req-1', ref: { type: 'requirement', id: 'req-1' }, title: 'Requirement', status: 'ready' },
        invalid: { id: 'req-1', ref: { type: 'bug', id: 'bug-1' }, title: 'Requirement', status: 'ready' },
      },
      {
        schema: techDebtListItemSchema,
        valid: { id: 'td-1', ref: { type: 'tech_debt', id: 'td-1' }, title: 'Tech debt', status: 'ready' },
        invalid: { id: 'td-1', ref: { type: 'requirement', id: 'req-1' }, title: 'Tech debt', status: 'ready' },
      },
      {
        schema: bugListItemSchema,
        valid: { id: 'bug-1', ref: { type: 'bug', id: 'bug-1' }, title: 'Bug', status: 'open' },
        invalid: { id: 'bug-1', ref: { type: 'release', id: 'release-1' }, title: 'Bug', status: 'open' },
      },
      {
        schema: taskListItemSchema,
        valid: { id: 'task-1', ref: { type: 'task', id: 'task-1' }, title: 'Task', status: 'todo' },
        invalid: { id: 'task-1', ref: { type: 'requirement', id: 'req-1' }, title: 'Task', status: 'todo' },
      },
    ] as const;

    for (const { schema, valid, invalid } of listCases) {
      expect(schema.parse(valid)).toMatchObject({ ref: valid.ref });
      expect(() => schema.parse(invalid)).toThrow();
    }
  });

  it('enforces typed refs on object-specific detail read models', () => {
    const detailCases = [
      {
        schema: initiativeDetailSchema,
        valid: { id: 'init-1', ref: { type: 'initiative', id: 'init-1' }, title: 'Initiative', status: 'active' },
        invalid: { id: 'init-1', ref: { type: 'task', id: 'task-1' }, title: 'Initiative', status: 'active' },
      },
      {
        schema: requirementDetailSchema,
        valid: { id: 'req-1', ref: { type: 'requirement', id: 'req-1' }, title: 'Requirement', status: 'ready' },
        invalid: { id: 'req-1', ref: { type: 'release', id: 'release-1' }, title: 'Requirement', status: 'ready' },
      },
      {
        schema: techDebtDetailSchema,
        valid: { id: 'td-1', ref: { type: 'tech_debt', id: 'td-1' }, title: 'Tech debt', status: 'ready' },
        invalid: { id: 'td-1', ref: { type: 'bug', id: 'bug-1' }, title: 'Tech debt', status: 'ready' },
      },
      {
        schema: bugDetailSchema,
        valid: { id: 'bug-1', ref: { type: 'bug', id: 'bug-1' }, title: 'Bug', status: 'open' },
        invalid: { id: 'bug-1', ref: { type: 'initiative', id: 'init-1' }, title: 'Bug', status: 'open' },
      },
    ] as const;

    for (const { schema, valid, invalid } of detailCases) {
      expect(schema.parse(valid)).toMatchObject({ ref: valid.ref });
      expect(() => schema.parse(invalid)).toThrow();
    }
  });
});
