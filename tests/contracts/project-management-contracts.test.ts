import { describe, expect, it } from 'vitest';

import {
  boardCardSchema,
  bugDetailSchema,
  bugListItemSchema,
  boundaryRoundSchema,
  boundarySummaryRevisionSchema,
  brainstormingSessionSchema,
  contextManifestSchema,
  developmentPlanItemSchema,
  editableObjectRefSchema,
  executionSchema,
  initiativeDetailSchema,
  initiativeListItemSchema,
  legacyWorkItemStorageRefSchema,
  objectRefSchema,
  planDetailSchema,
  pipelineResponseSchema,
  productObjectRefSchema,
  productQueryObjectRefSchema,
  productListQuerySchema,
  productListItemSchema,
  requirementDetailSchema,
  requirementListItemSchema,
  specDetailSchema,
  specPlanQueueItemSchema,
  techDebtDetailSchema,
  techDebtListItemSchema,
  myWorkQueueItemSchema,
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

  it('keeps runtime evidence refs out of public product and query refs', () => {
    for (const runtimeRef of [
      { type: 'execution_package', id: 'pkg-1' },
      { type: 'run_session', id: 'run-1' },
      { type: 'review_packet', id: 'review-1' },
    ] as const) {
      expect(() => productObjectRefSchema.parse(runtimeRef)).toThrow();
      expect(() => productQueryObjectRefSchema.parse(runtimeRef)).toThrow();
    }

    for (const legacyRef of [
      { type: 'work_item', id: 'wi-1' },
      { type: 'task', id: 'task-1' },
      { type: 'plan', id: 'plan-1' },
    ] as const) {
      expect(() => productQueryObjectRefSchema.parse(legacyRef)).toThrow();
    }
  });

  it('requires persisted brainstorming evidence before a boundary can approve Spec generation', () => {
    const session = brainstormingSessionSchema.parse({
      id: 'bs-1',
      revision_id: 'bs-rev-1',
      source_ref: { type: 'requirement', id: 'req-1', revision_id: 'req-rev-1' },
      development_plan_id: 'dp-1',
      development_plan_revision_id: 'dp-rev-1',
      development_plan_item_id: 'dpi-1',
      development_plan_item_revision_id: 'dpi-rev-1',
      leader_actor_id: 'actor-tech',
      leader_delegate_actor_ids: [],
      context_manifest_id: 'cm-1',
      context_manifest_revision_id: 'cm-rev-1',
      status: 'approved',
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

  it('models item-scoped Spec and Execution Plan context manifests without Work Item refs', () => {
    const manifest = contextManifestSchema.parse({
      id: 'cm-1',
      revision_id: 'cm-rev-1',
      source_ref: { type: 'requirement', id: 'req-1', revision_id: 'req-rev-1' },
      development_plan_id: 'dp-1',
      development_plan_revision_id: 'dp-rev-1',
      development_plan_item_id: 'dpi-1',
      development_plan_item_revision_id: 'dpi-rev-1',
      brainstorming_session_id: 'bs-1',
      brainstorming_session_revision_id: 'bs-rev-1',
      boundary_summary_id: 'boundary-1',
      boundary_summary_revision_id: 'boundary-rev-1',
      boundary_approver_actor_id: 'actor-tech',
      boundary_approved_at: '2026-05-24T00:03:00.000Z',
      approved_spec_revision_id: 'spec-rev-1',
      sources: [
        { type: 'source_object_revision', ref: 'requirement:req-1', digest: 'req-rev-1' },
        { type: 'development_plan_item', ref: 'dpi-1', digest: 'dpi-rev-1' },
        { type: 'boundary_summary', ref: 'boundary-1', digest: 'boundary-rev-1' },
        { type: 'repository_path', ref: '/workspace/forgeloop', digest: 'abc123' },
      ],
      generated_at: '2026-05-24T00:04:00.000Z',
      runtime_identity: 'control-plane-api:spec-plan',
    });

    expect(manifest).toMatchObject({
      development_plan_item_id: 'dpi-1',
      boundary_summary_id: 'boundary-1',
      approved_spec_revision_id: 'spec-rev-1',
    });
    expect(JSON.stringify(manifest)).not.toContain('"type":"work_item"');
  });

  it('models product Executions with item and Execution Plan revision identity', () => {
    const execution = executionSchema.parse({
      id: 'exec-1',
      development_plan_item_id: 'dpi-1',
      approved_spec_revision_id: 'spec-rev-1',
      approved_spec_revision_ref: {
        type: 'spec_revision',
        id: 'spec-rev-1',
        spec_id: 'spec-1',
        title: 'Approved Spec',
      },
      execution_plan_revision_id: 'epr-1',
      ref: { type: 'execution', id: 'exec-1', title: 'Execution for item' },
      development_plan_item_ref: {
        type: 'development_plan_item',
        id: 'dpi-1',
        development_plan_id: 'dp-1',
        revision_id: 'dpi-rev-1',
        title: 'Plan item',
      },
      execution_plan_revision_ref: {
        type: 'execution_plan_revision',
        id: 'epr-1',
        execution_plan_id: 'ep-1',
        title: 'Approved Execution Plan',
      },
      status: 'running',
      evidence_refs: [{ type: 'execution_plan_revision', id: 'epr-1', execution_plan_id: 'ep-1' }],
      runtime_evidence_refs: [{ type: 'execution_package', id: 'pkg-1' }],
      created_at: '2026-05-24T00:04:00.000Z',
      updated_at: '2026-05-24T00:05:00.000Z',
    });

    expect(execution).toMatchObject({
      development_plan_item_id: 'dpi-1',
      execution_plan_revision_id: 'epr-1',
    });
    expect(() =>
      executionSchema.parse({
        ...execution,
        execution_plan_revision_id: undefined,
      }),
    ).toThrow();
  });

  it.each([
    {
      label: 'questions',
      patch: { questions: [] },
      message: /questions/i,
    },
    {
      label: 'answers',
      patch: { answers: [] },
      message: /answers/i,
    },
    {
      label: 'decisions',
      patch: { decisions: [] },
      message: /decisions/i,
    },
    {
      label: 'boundary summary',
      patch: { boundary_summary_id: undefined },
      message: /boundary summary/i,
    },
    {
      label: 'approver',
      patch: { approver_actor_id: undefined },
      message: /approver/i,
    },
    {
      label: 'approval timestamp',
      patch: { approved_at: undefined },
      message: /approval timestamp/i,
    },
  ])('rejects boundary approval without persisted $label', ({ patch, message }) => {
    const approvedSession = {
      id: 'bs-1',
      revision_id: 'bs-rev-1',
      source_ref: { type: 'requirement', id: 'req-1' },
      development_plan_id: 'dp-1',
      development_plan_revision_id: 'dp-rev-1',
      development_plan_item_id: 'dpi-1',
      development_plan_item_revision_id: 'dpi-rev-1',
      leader_actor_id: 'actor-tech',
      leader_delegate_actor_ids: [],
      context_manifest_id: 'cm-1',
      context_manifest_revision_id: 'cm-rev-1',
      status: 'approved',
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
    };

    expect(() => brainstormingSessionSchema.parse({ ...approvedSession, ...patch })).toThrow(message);
  });

  it('accepts typed product refs and keeps work_item storage refs internal only', () => {
    expect(objectRefSchema.parse({ type: 'requirement', id: 'wi-req' })).toEqual({
      type: 'requirement',
      id: 'wi-req',
    });
    expect(() => objectRefSchema.parse({ type: 'task', id: 'task-1' })).toThrow();
    expect(() => objectRefSchema.parse({ type: 'plan', id: 'plan-1' })).toThrow();
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

  it('rejects runtime evidence refs from public product query rows', () => {
    for (const legacyRef of [
      { type: 'execution_package', id: 'pkg-1' },
      { type: 'run_session', id: 'run-1' },
      { type: 'review_packet', id: 'review-1' },
      { type: 'work_item', id: 'wi-1' },
      { type: 'task', id: 'task-1' },
      { type: 'plan', id: 'plan-1' },
    ] as const) {
      expect(() =>
        productListItemSchema.parse({
          id: 'row-legacy',
          object: legacyRef,
          title: 'Legacy row',
          updated_at: '2026-05-24T00:00:00.000Z',
        }),
      ).toThrow();
      expect(() =>
        myWorkQueueItemSchema.parse({
          id: 'work-legacy',
          object_ref: legacyRef,
          title: 'Legacy work',
          attention_reason: 'Legacy',
        }),
      ).toThrow();
    }

    expect(() =>
      boardCardSchema.parse({
        id: 'card-work-item',
        object_ref: { type: 'work_item', id: 'wi-1' },
        title: 'Work item card',
        column_id: 'todo',
        status: 'todo',
      }),
    ).toThrow();
    expect(() =>
      boardCardSchema.parse({
        id: 'card-task',
        object_ref: { type: 'task', id: 'task-1', title: 'Task' },
        title: 'Task card',
        column_id: 'ready',
        status: 'ready',
      }),
    ).toThrow();
    expect(() =>
      boardCardSchema.parse({
        id: 'card-plan',
        object_ref: { type: 'plan', id: 'plan-1', title: 'Plan' },
        title: 'Plan card',
        column_id: 'ready',
        status: 'approved',
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

  it('rejects nested raw package state on public product list items', () => {
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
        href: '/specs-plans',
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
        ref: { type: 'execution_plan', id: 'plan-1' },
        source_ref: { type: 'requirement', id: 'req-1' },
        title: 'Checkout Plan',
        status: 'approved',
        gate_state: 'ready',
        current_revision_id: 'plan-rev-2',
        approved_revision_id: 'plan-rev-2',
        based_on_spec_revision_id: 'spec-rev-2',
      }),
    ).toMatchObject({
      ref: { type: 'execution_plan', id: 'plan-1' },
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
        ref: { type: 'execution_plan', id: 'plan-legacy' },
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

  it('accepts Leader and delegate fields on Development Plan Item', () => {
    expect(
      developmentPlanItemSchema.parse({
        id: 'item-1',
        development_plan_id: 'plan-1',
        revision_id: 'item-rev-1',
        title: 'Runtime closure',
        summary: 'Close runtime dogfood',
        driver_actor_id: 'actor-driver',
        reviewer_actor_id: 'actor-reviewer',
        leader_actor_id: 'actor-leader',
        leader_delegate_actor_ids: ['actor-delegate'],
        responsible_role: 'tech_lead',
        risk: 'high',
        dependency_hints: [],
        affected_surfaces: [],
        boundary_status: 'in_progress',
        spec_status: 'missing',
        execution_plan_status: 'missing',
        execution_status: 'not_started',
        review_status: 'missing',
        qa_handoff_status: 'missing',
        release_impact: 'release_scoped',
        next_action: 'boundary_brainstorming',
        updated_at: '2026-05-25T00:00:00.000Z',
      }),
    ).toMatchObject({
      leader_actor_id: 'actor-leader',
      leader_delegate_actor_ids: ['actor-delegate'],
    });
  });

  it('accepts Boundary Brainstorming session process fields and Leader snapshot', () => {
    expect(
      brainstormingSessionSchema.parse({
        id: 'session-1',
        revision_id: 'session-rev-1',
        source_ref: { type: 'requirement', id: 'req-1', revision_id: 'req-rev-1' },
        development_plan_id: 'plan-1',
        development_plan_revision_id: 'plan-rev-1',
        development_plan_item_id: 'item-1',
        development_plan_item_revision_id: 'item-rev-1',
        leader_actor_id: 'actor-leader',
        leader_delegate_actor_ids: ['actor-delegate'],
        context_manifest_id: 'context-1',
        context_manifest_revision_id: 'context-rev-1',
        status: 'waiting_for_leader',
        current_round_id: 'round-1',
        latest_summary_revision_id: undefined,
        approved_summary_revision_id: undefined,
        questions: [],
        answers: [],
        decisions: [],
        approval_state: 'questions_open',
        created_at: '2026-05-25T00:00:00.000Z',
        updated_at: '2026-05-25T00:00:00.000Z',
      }),
    ).toMatchObject({
      leader_actor_id: 'actor-leader',
      current_round_id: 'round-1',
      status: 'waiting_for_leader',
    });
  });

  it('rejects approved Boundary Brainstorming process status without legacy approval and evidence', () => {
    expect(() =>
      brainstormingSessionSchema.parse({
        id: 'session-1',
        revision_id: 'session-rev-1',
        source_ref: { type: 'requirement', id: 'req-1', revision_id: 'req-rev-1' },
        development_plan_id: 'plan-1',
        development_plan_revision_id: 'plan-rev-1',
        development_plan_item_id: 'item-1',
        development_plan_item_revision_id: 'item-rev-1',
        leader_actor_id: 'actor-leader',
        leader_delegate_actor_ids: [],
        context_manifest_id: 'context-1',
        context_manifest_revision_id: 'context-rev-1',
        status: 'approved',
        questions: [],
        answers: [],
        decisions: [],
        approval_state: 'questions_open',
        created_at: '2026-05-25T00:00:00.000Z',
        updated_at: '2026-05-25T00:00:00.000Z',
      }),
    ).toThrow(/approval_state/i);
  });

  it('accepts Boundary Brainstorming round artifacts', () => {
    expect(
      boundaryRoundSchema.parse({
        id: 'round-1',
        session_id: 'session-1',
        session_revision_id: 'session-rev-1',
        round_number: 1,
        trigger: 'start',
        leader_input_markdown: 'Clarify runtime boundary.',
        ai_output_markdown: 'Open questions for the Leader.',
        runtime_job_id: 'job-1',
        runtime_profile_revision_id: 'profile-rev-1',
        credential_binding_version_id: 'credential-version-1',
        app_server_thread_digest: 'thread-digest-1',
        app_server_turn_digest: 'turn-digest-1',
        status: 'waiting_for_leader',
        created_at: '2026-05-25T00:00:00.000Z',
        updated_at: '2026-05-25T00:00:00.000Z',
      }),
    ).toMatchObject({ id: 'round-1', session_id: 'session-1' });
  });

  it('requires product Execution to publicly link approved Spec revision', () => {
    expect(() =>
      executionSchema.parse({
        id: 'execution-1',
        development_plan_item_id: 'item-1',
        execution_plan_revision_id: 'execution-plan-rev-1',
        ref: { type: 'execution', id: 'execution-1' },
        development_plan_item_ref: {
          type: 'development_plan_item',
          id: 'item-1',
          development_plan_id: 'plan-1',
          revision_id: 'item-rev-1',
        },
        execution_plan_revision_ref: {
          type: 'execution_plan_revision',
          id: 'execution-plan-rev-1',
          execution_plan_id: 'execution-plan-1',
        },
        status: 'running',
        evidence_refs: [],
        runtime_evidence_refs: [],
        interrupt_history: [],
        continuation_history: [],
        pr_refs: [],
        diff_refs: [],
        test_evidence_refs: [],
        created_at: '2026-05-25T00:00:00.000Z',
        updated_at: '2026-05-25T00:00:00.000Z',
      }),
    ).toThrow(/approved_spec_revision_id/i);
  });

  it('accepts product Execution with approved Spec revision linkage and internal runtime evidence refs', () => {
    expect(
      executionSchema.parse({
        id: 'execution-1',
        development_plan_item_id: 'item-1',
        approved_spec_revision_id: 'spec-rev-1',
        approved_spec_revision_ref: {
          type: 'spec_revision',
          id: 'spec-rev-1',
          spec_id: 'spec-1',
        },
        execution_plan_revision_id: 'execution-plan-rev-1',
        ref: { type: 'execution', id: 'execution-1' },
        development_plan_item_ref: {
          type: 'development_plan_item',
          id: 'item-1',
          development_plan_id: 'plan-1',
          revision_id: 'item-rev-1',
        },
        execution_plan_revision_ref: {
          type: 'execution_plan_revision',
          id: 'execution-plan-rev-1',
          execution_plan_id: 'execution-plan-1',
        },
        status: 'running',
        evidence_refs: [{ type: 'spec_revision', id: 'spec-rev-1', spec_id: 'spec-1' }],
        runtime_evidence_refs: [{ type: 'execution_package', id: 'package-1' }],
        interrupt_history: [],
        continuation_history: [],
        pr_refs: [],
        diff_refs: [],
        test_evidence_refs: [],
        created_at: '2026-05-25T00:00:00.000Z',
        updated_at: '2026-05-25T00:00:00.000Z',
      }),
    ).toMatchObject({ approved_spec_revision_id: 'spec-rev-1' });
  });

  it('rejects product Execution with mismatched approved Spec revision IDs', () => {
    expect(() =>
      executionSchema.parse({
        id: 'execution-1',
        development_plan_item_id: 'item-1',
        approved_spec_revision_id: 'spec-rev-1',
        approved_spec_revision_ref: {
          type: 'spec_revision',
          id: 'spec-rev-2',
          spec_id: 'spec-1',
        },
        execution_plan_revision_id: 'execution-plan-rev-1',
        ref: { type: 'execution', id: 'execution-1' },
        development_plan_item_ref: {
          type: 'development_plan_item',
          id: 'item-1',
          development_plan_id: 'plan-1',
          revision_id: 'item-rev-1',
        },
        execution_plan_revision_ref: {
          type: 'execution_plan_revision',
          id: 'execution-plan-rev-1',
          execution_plan_id: 'execution-plan-1',
        },
        status: 'running',
        evidence_refs: [{ type: 'spec_revision', id: 'spec-rev-1', spec_id: 'spec-1' }],
        runtime_evidence_refs: [{ type: 'execution_package', id: 'package-1' }],
        interrupt_history: [],
        continuation_history: [],
        pr_refs: [],
        diff_refs: [],
        test_evidence_refs: [],
        created_at: '2026-05-25T00:00:00.000Z',
        updated_at: '2026-05-25T00:00:00.000Z',
      }),
    ).toThrow(/approved_spec_revision_ref/i);
  });

  it('rejects approved Boundary Summary revisions without question and decision evidence snapshots', () => {
    expect(() =>
      boundarySummaryRevisionSchema.parse({
        id: 'boundary-rev-1',
        boundary_summary_id: 'boundary-1',
        session_id: 'session-1',
        session_revision_id: 'session-rev-1',
        source_round_id: 'round-1',
        development_plan_id: 'plan-1',
        development_plan_item_id: 'item-1',
        development_plan_item_revision_id: 'item-rev-1',
        revision_number: 1,
        status: 'approved',
        summary_markdown: 'Summary',
        confirmed_scope: ['runtime closure'],
        confirmed_out_of_scope: [],
        accepted_assumptions: [],
        open_risks: [],
        validation_expectations: ['pnpm test'],
        question_answer_snapshot: [],
        decision_snapshot: [],
        context_manifest_id: 'context-1',
        context_manifest_revision_id: 'context-rev-1',
        approved_by_actor_id: 'actor-leader',
        approved_at: '2026-05-25T00:00:00.000Z',
        created_at: '2026-05-25T00:00:00.000Z',
      }),
    ).toThrow(/approved Boundary Summary must include question and decision evidence/i);
  });

  it('accepts approved Boundary Summary revisions with persisted evidence snapshots', () => {
    expect(
      boundarySummaryRevisionSchema.parse({
        id: 'boundary-rev-2',
        boundary_summary_id: 'boundary-1',
        session_id: 'session-1',
        session_revision_id: 'session-rev-1',
        source_round_id: 'round-2',
        development_plan_id: 'plan-1',
        development_plan_item_id: 'item-1',
        development_plan_item_revision_id: 'item-rev-1',
        revision_number: 2,
        status: 'approved',
        summary_markdown: 'Summary',
        confirmed_scope: ['runtime closure'],
        confirmed_out_of_scope: ['CLI fallback'],
        accepted_assumptions: ['centralized Codex config import is available'],
        open_risks: ['worker registry bootstrap may be flaky'],
        validation_expectations: ['pnpm dogfood:codex-runtime:superpowers'],
        question_answer_snapshot: [
          {
            question_id: 'question-1',
            answer_id: 'answer-1',
            text: 'Which runtime boundary owns Codex config?',
          },
        ],
        decision_snapshot: [
          {
            decision_id: 'decision-1',
            text: 'Use centralized config distribution only.',
          },
        ],
        context_manifest_id: 'context-1',
        context_manifest_revision_id: 'context-rev-1',
        approved_by_actor_id: 'actor-leader',
        approved_at: '2026-05-25T00:00:00.000Z',
        created_at: '2026-05-25T00:00:00.000Z',
      }),
    ).toMatchObject({ status: 'approved' });
  });
});
