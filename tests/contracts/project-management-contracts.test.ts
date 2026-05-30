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
  documentReviewQueueItemSchema,
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
        type: 'implementation_plan_revision',
        id: 'epr-1',
        implementation_plan_id: 'ep-1',
      }),
    ).toMatchObject({
      type: 'implementation_plan_revision',
    });
    expect(() => productObjectRefSchema.parse({ type: 'execution_plan', id: 'ep-1' })).toThrow();
    expect(() =>
      productObjectRefSchema.parse({ type: 'execution_plan_revision', id: 'epr-1', execution_plan_id: 'ep-1' }),
    ).toThrow();
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

  it('models item-scoped Spec and Implementation Plan Doc context manifests without Work Item refs', () => {
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
        { type: 'planning_input_revision', ref: 'requirement:req-1', digest: 'req-rev-1' },
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

  it('models product Executions with item and Implementation Plan Doc revision identity', () => {
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
      implementation_plan_revision_id: 'epr-1',
      ref: { type: 'execution', id: 'exec-1', title: 'Execution for item' },
      development_plan_item_ref: {
        type: 'development_plan_item',
        id: 'dpi-1',
        development_plan_id: 'dp-1',
        revision_id: 'dpi-rev-1',
        title: 'Plan item',
      },
      implementation_plan_revision_ref: {
        type: 'implementation_plan_revision',
        id: 'epr-1',
        implementation_plan_id: 'ep-1',
        title: 'Approved Implementation Plan Doc',
      },
      status: 'running',
      evidence_refs: [{ type: 'implementation_plan_revision', id: 'epr-1', implementation_plan_id: 'ep-1' }],
      runtime_evidence_refs: [{ type: 'execution_package', id: 'pkg-1' }],
      created_at: '2026-05-24T00:04:00.000Z',
      updated_at: '2026-05-24T00:05:00.000Z',
    });

    expect(execution).toMatchObject({
      development_plan_item_id: 'dpi-1',
      implementation_plan_revision_id: 'epr-1',
    });
    expect(() =>
      executionSchema.parse({
        ...execution,
        implementation_plan_revision_id: undefined,
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

  it('exposes product-safe Spec and Implementation Plan Doc read models with typed refs', () => {
    expect(
      documentReviewQueueItemSchema.parse({
        id: 'spec-queue-1',
        entity_type: 'spec',
        title: 'Checkout Spec',
        source_ref: { type: 'requirement', id: 'req-1' },
        status: 'approved',
        gate_state: 'ready',
        current_revision_id: 'spec-rev-2',
        approved_revision_id: 'spec-rev-2',
        updated_at: '2026-05-23T00:00:00.000Z',
        href: '/reviews',
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
        ref: { type: 'implementation_plan_doc', id: 'plan-1' },
        source_ref: { type: 'requirement', id: 'req-1' },
        title: 'Checkout Plan',
        status: 'approved',
        gate_state: 'ready',
        current_revision_id: 'plan-rev-2',
        approved_revision_id: 'plan-rev-2',
        based_on_spec_revision_id: 'spec-rev-2',
      }),
    ).toMatchObject({
      ref: { type: 'implementation_plan_doc', id: 'plan-1' },
    });
  });

  it('rejects Spec and Implementation Plan Doc read models with legacy work_item refs or owner fields', () => {
    expect(() =>
      documentReviewQueueItemSchema.parse({
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
        ref: { type: 'implementation_plan_doc', id: 'plan-legacy' },
        source_ref: { type: 'work_item', id: 'wi-1' },
        title: 'Legacy Plan',
        status: 'approved',
        gate_state: 'ready',
      }),
    ).toThrow();
  });

  it('enforces typed refs on object-specific list read models', () => {
    const now = '2026-05-27T08:00:00.000Z';
    const planningCoverage = { development_plan_count: 1, plan_item_count: 3, uncovered: false };
    const downstreamGateSummary = {
      current_gate_counts: { boundary: 1, spec: 1, implementation_plan_doc: 1, execution: 0, code_review: 0, qa: 0, release: 0 },
      blocker_count: 1,
    };

    const listCases = [
      {
        schema: initiativeListItemSchema,
        valid: {
          id: 'init-1',
          ref: { type: 'initiative', id: 'init-1', title: 'Initiative' },
          title: 'Initiative',
          status: 'active',
          priority: 'medium',
          risk: 'medium',
          driver_actor_id: 'actor-product',
          planning_coverage: planningCoverage,
          downstream_gate_summary: downstreamGateSummary,
          last_meaningful_update_at: now,
          next_action: 'Review milestone split',
          release_refs: [{ type: 'release', id: 'rel-preview', title: 'Preview release' }],
          business_outcome: 'Coordinate the launch outcome.',
          updated_at: now,
        },
        invalid: { id: 'init-1', ref: { type: 'task', id: 'task-1' }, title: 'Initiative', status: 'active' },
      },
      {
        schema: requirementListItemSchema,
        valid: {
          id: 'req-checkout-risk',
          ref: { type: 'requirement', id: 'req-checkout-risk', title: 'Checkout risk controls' },
          title: 'Checkout risk controls',
          status: 'ready_for_planning',
          priority: 'high',
          risk: 'high',
          driver_actor_id: 'actor-product',
          planning_coverage: planningCoverage,
          downstream_gate_summary: downstreamGateSummary,
          last_meaningful_update_at: now,
          next_action: 'Review Spec test strategy',
          release_refs: [{ type: 'release', id: 'rel-preview', title: 'Preview release' }],
          updated_at: now,
        },
        invalid: { id: 'req-1', ref: { type: 'bug', id: 'bug-1' }, title: 'Requirement', status: 'ready' },
      },
      {
        schema: techDebtListItemSchema,
        valid: {
          id: 'td-1',
          ref: { type: 'tech_debt', id: 'td-1', title: 'Tech debt' },
          title: 'Tech debt',
          status: 'ready',
          priority: 'medium',
          risk: 'medium',
          driver_actor_id: 'actor-tech',
          planning_coverage: planningCoverage,
          downstream_gate_summary: downstreamGateSummary,
          last_meaningful_update_at: now,
          next_action: 'Approve remediation plan',
          release_refs: [{ type: 'release', id: 'rel-preview', title: 'Preview release' }],
          affected_modules: ['apps/web'],
          risk_rationale: 'Shared route shell blocks product-specific rendering.',
          updated_at: now,
        },
        invalid: { id: 'td-1', ref: { type: 'requirement', id: 'req-1' }, title: 'Tech debt', status: 'ready' },
      },
      {
        schema: bugListItemSchema,
        valid: {
          id: 'bug-1',
          ref: { type: 'bug', id: 'bug-1', title: 'Bug' },
          title: 'Bug',
          status: 'open',
          priority: 'high',
          risk: 'high',
          driver_actor_id: 'actor-product',
          planning_coverage: planningCoverage,
          downstream_gate_summary: downstreamGateSummary,
          last_meaningful_update_at: now,
          next_action: 'Reproduce checkout failure',
          release_refs: [{ type: 'release', id: 'rel-preview', title: 'Preview release' }],
          severity: 'high',
          affected_surfaces: ['checkout'],
          updated_at: now,
        },
        invalid: { id: 'bug-1', ref: { type: 'release', id: 'release-1' }, title: 'Bug', status: 'open' },
      },
    ] as const;

    for (const { schema, valid, invalid } of listCases) {
      expect(schema.parse(valid)).toMatchObject({ ref: valid.ref });
      expect(() => schema.parse({ ...valid, planning_coverage: undefined })).toThrow();
      expect(() => schema.parse({ ...valid, downstream_gate_summary: undefined })).toThrow();
      expect(() => schema.parse({ ...valid, next_action: undefined })).toThrow();
      expect(() => schema.parse(invalid)).toThrow();
    }
  });

  it('enforces typed refs on object-specific detail read models', () => {
    const now = '2026-05-27T08:00:00.000Z';
    const later = '2026-05-27T08:30:00.000Z';
    const planning_coverage = { development_plan_count: 1, plan_item_count: 3, uncovered: false };
    const downstream_gate_summary = {
      current_gate_counts: { boundary: 1, spec: 1, implementation_plan_doc: 1, execution: 0, code_review: 0, qa: 0, release: 0 },
      blocker_count: 1,
    };
    const sharedDetailFields = {
      priority: 'high',
      risk: 'high',
      driver_actor_id: 'actor-product',
      narrative_markdown: 'Typed document narrative.',
      planning_coverage,
      downstream_gate_summary,
      linked_development_plans: [{ type: 'development_plan', id: 'dp-core', title: 'Core redesign plan' }],
      linked_plan_items: [{ type: 'development_plan_item', id: 'dpi-core', development_plan_id: 'dp-core', title: 'Requirement workspace' }],
      evidence_refs: [{ type: 'attachment', id: 'att-1', title: 'Research screenshot' }],
      attachment_refs: [
        {
          id: 'att-1',
          owner_object_type: 'requirement',
          owner_object_id: 'req-checkout-risk',
          linked_object_refs: [{ type: 'requirement', id: 'req-checkout-risk', title: 'Checkout risk controls' }],
          filename: 'scope.png',
          content_type: 'image/png',
          size_bytes: 128,
          checksum_sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          uploaded_by_actor_id: 'actor-product',
          created_at: now,
          evidence_category: 'image',
          visibility: 'object',
          safety_status: 'passed',
          reference_status: 'active',
        },
      ],
      release_refs: [{ type: 'release', id: 'rel-preview', title: 'Preview release' }],
      audit: { created_at: now, updated_at: later, updated_by_actor_id: 'actor-product' },
      last_meaningful_update_at: later,
      next_action: 'Open linked Plan Item',
      updated_at: later,
      relationship_refs: [],
    };

    const detailCases = [
      {
        schema: initiativeDetailSchema,
        valid: {
          ...sharedDetailFields,
          id: 'init-1',
          ref: { type: 'initiative', id: 'init-1', title: 'Initiative' },
          title: 'Initiative',
          status: 'active',
          business_outcome: 'Coordinate the product architecture rollout.',
          milestone_intent: 'Preview launch milestone.',
          child_refs: [{ type: 'requirement', id: 'req-checkout-risk', title: 'Checkout risk controls' }],
          release_coverage: 'Preview release contains the critical child source refs.',
        },
        invalid: { id: 'init-1', ref: { type: 'task', id: 'task-1' }, title: 'Initiative', status: 'active' },
      },
      {
        schema: requirementDetailSchema,
        valid: {
          ...sharedDetailFields,
          id: 'req-checkout-risk',
          ref: { type: 'requirement', id: 'req-checkout-risk', title: 'Checkout risk controls' },
          title: 'Checkout risk controls',
          status: 'ready_for_planning',
          stakeholder_problem: 'Product needs confidence that risky checkout changes are reviewed before release.',
          desired_outcome: 'Every release-impacting checkout change carries approved Spec, plan, QA, and release evidence.',
          acceptance_criteria_summary: 'Risky paths have approved test strategy and QA handoff before release readiness clears.',
          scope_summary: {
            in_scope: 'Checkout requirements, delivery plan links, QA evidence, and release blockers.',
            out_of_scope: 'External Jira sync and retro learning loop.',
          },
        },
        invalid: { id: 'req-1', ref: { type: 'release', id: 'release-1' }, title: 'Requirement', status: 'ready' },
      },
      {
        schema: techDebtDetailSchema,
        valid: {
          ...sharedDetailFields,
          id: 'td-1',
          ref: { type: 'tech_debt', id: 'td-1', title: 'Tech debt' },
          title: 'Tech debt',
          status: 'ready',
          affected_modules: ['apps/web'],
          risk_rationale: 'Generic shell usage blocks dense typed workspaces.',
          validation_strategy: 'Run route contract and visual checks.',
          remediation_intent: 'Replace generic shell usage with typed workspace shells.',
        },
        invalid: { id: 'td-1', ref: { type: 'bug', id: 'bug-1' }, title: 'Tech debt', status: 'ready' },
      },
      {
        schema: bugDetailSchema,
        valid: {
          ...sharedDetailFields,
          id: 'bug-1',
          ref: { type: 'bug', id: 'bug-1', title: 'Bug' },
          title: 'Bug',
          status: 'open',
          observed_behavior: 'Checkout review context disappears.',
          expected_behavior: 'Checkout review context persists.',
          reproduction_steps: ['Open checkout execution', 'Continue after review feedback'],
          severity: 'high',
          affected_surfaces: ['checkout'],
        },
        invalid: { id: 'bug-1', ref: { type: 'initiative', id: 'init-1' }, title: 'Bug', status: 'open' },
      },
    ] as const;

    for (const { schema, valid, invalid } of detailCases) {
      expect(schema.parse(valid)).toMatchObject({ ref: valid.ref });
      expect(() => schema.parse({ ...valid, audit: undefined })).toThrow();
      expect(() => schema.parse({ ...valid, linked_development_plans: undefined })).toThrow();
      expect(() => schema.parse({ ...valid, next_action: undefined })).toThrow();
      expect(() =>
        schema.parse({
          ...valid,
          relationship_refs: [{ type: 'spec', id: 'spec-direct' }],
        }),
      ).toThrow();
      expect(() =>
        schema.parse({
          ...valid,
          relationship_refs: [{ type: 'execution_plan', id: 'plan-direct' }],
        }),
      ).toThrow();
      expect(() =>
        schema.parse({
          ...valid,
          evidence_refs: [{ type: 'spec', id: 'spec-direct-evidence' }],
        }),
      ).toThrow();
      expect(() =>
        schema.parse({
          ...valid,
          evidence_refs: [{ type: 'execution_plan', id: 'plan-direct-evidence' }],
        }),
      ).toThrow();
      expect(() =>
        schema.parse({
          ...valid,
          evidence_refs: [{ type: 'execution', id: 'exec-direct-evidence' }],
        }),
      ).toThrow();
      expect(() =>
        schema.parse({
          ...valid,
          evidence_refs: [{ type: 'release_evidence', id: 'evidence-scope-only', release_id: 'rel-preview' }],
        }),
      ).not.toThrow();
      expect(() =>
        schema.parse({
          ...valid,
          attachment_refs: [
            {
              ...sharedDetailFields.attachment_refs[0],
              linked_object_refs: [{ type: 'spec', id: 'spec-direct-attachment' }],
            },
          ],
        }),
      ).toThrow();
      expect(() =>
        schema.parse({
          ...valid,
          attachment_refs: [
            {
              ...sharedDetailFields.attachment_refs[0],
              linked_object_refs: [{ type: 'execution_plan', id: 'plan-direct-attachment' }],
            },
          ],
        }),
      ).toThrow();
      expect(() =>
        schema.parse({
          ...valid,
          attachment_refs: [
            {
              ...sharedDetailFields.attachment_refs[0],
              linked_object_refs: [{ type: 'execution', id: 'exec-direct-attachment' }],
            },
          ],
        }),
      ).toThrow();
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
        implementation_plan_status: 'missing',
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
    expect(() =>
      developmentPlanItemSchema.parse({
        id: 'item-1',
        development_plan_id: 'plan-1',
        revision_id: 'item-rev-1',
        title: 'Runtime closure',
        summary: 'Close runtime dogfood',
        responsible_role: 'tech_lead',
        risk: 'high',
        dependency_hints: [],
        affected_surfaces: [],
        boundary_status: 'in_progress',
        spec_status: 'missing',
        legacy_plan_status: 'missing',
        execution_status: 'not_started',
        review_status: 'missing',
        qa_handoff_status: 'missing',
        release_impact: 'release_scoped',
        next_action: 'boundary_brainstorming',
        updated_at: '2026-05-25T00:00:00.000Z',
      }),
    ).toThrow();
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
        implementation_plan_revision_id: 'implementation-plan-rev-1',
        ref: { type: 'execution', id: 'execution-1' },
        development_plan_item_ref: {
          type: 'development_plan_item',
          id: 'item-1',
          development_plan_id: 'plan-1',
          revision_id: 'item-rev-1',
        },
        implementation_plan_revision_ref: {
          type: 'implementation_plan_revision',
          id: 'implementation-plan-rev-1',
          implementation_plan_id: 'implementation-plan-1',
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
        implementation_plan_revision_id: 'implementation-plan-rev-1',
        ref: { type: 'execution', id: 'execution-1' },
        development_plan_item_ref: {
          type: 'development_plan_item',
          id: 'item-1',
          development_plan_id: 'plan-1',
          revision_id: 'item-rev-1',
        },
        implementation_plan_revision_ref: {
          type: 'implementation_plan_revision',
          id: 'implementation-plan-rev-1',
          implementation_plan_id: 'implementation-plan-1',
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
        implementation_plan_revision_id: 'implementation-plan-rev-1',
        ref: { type: 'execution', id: 'execution-1' },
        development_plan_item_ref: {
          type: 'development_plan_item',
          id: 'item-1',
          development_plan_id: 'plan-1',
          revision_id: 'item-rev-1',
        },
        implementation_plan_revision_ref: {
          type: 'implementation_plan_revision',
          id: 'implementation-plan-rev-1',
          implementation_plan_id: 'implementation-plan-1',
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
