import type {
  ExecutionPackage,
  ExecutionPackageDependency,
  Plan,
  PlanRevision,
  Release,
  ReviewPacket,
  RunSession,
  Spec,
  SpecRevision,
  WorkItem,
} from '@forgeloop/domain';
import { describe, expect, it } from 'vitest';

import {
  deriveWorkItemDeliveryReadiness,
  type WorkItemDeliveryReadinessInput,
} from '../../packages/db/src/queries/work-item-delivery-readiness';

const now = '2026-05-20T00:00:00.000Z';
const requirementIntakeContext: WorkItem['intake_context'] = {
  type: 'requirement',
  stakeholder_problem: 'Teams need delivery readiness for a typed Work Item.',
  desired_outcome: 'Readiness inputs preserve Work Item driver intake data.',
  acceptance_criteria: ['Readiness fixtures include driver and intake context.'],
  in_scope: ['Readiness query tests'],
};

const workItemFixture = (overrides: Partial<WorkItem> = {}): WorkItem => ({
  id: 'wi-1',
  project_id: 'project-1',
  kind: 'requirement',
  title: 'Ship delivery readiness',
  goal: 'Expose readiness in the cockpit.',
  success_criteria: ['Readiness is deterministic.'],
  priority: 'medium',
  risk: 'medium',
  driver_actor_id: 'actor-owner',
  intake_context: requirementIntakeContext,
  phase: 'release',
  activity_state: 'idle',
  gate_state: 'none',
  resolution: 'none',
  current_spec_id: 'spec-1',
  current_spec_revision_id: 'spec-r1',
  current_plan_id: 'plan-1',
  current_plan_revision_id: 'plan-r1',
  created_at: now,
  updated_at: now,
  ...overrides,
});

const specFixture = (overrides: Partial<Spec> = {}): Spec => ({
  id: 'spec-1',
  work_item_id: 'wi-1',
  entity_type: 'spec',
  status: 'approved',
  editing_state: 'idle',
  gate_state: 'approved',
  resolution: 'approved',
  current_revision_id: 'spec-r1',
  approved_revision_id: 'spec-r1',
  approved_at: now,
  approved_by_actor_id: 'actor-approver',
  created_at: now,
  updated_at: now,
  ...overrides,
});

const specRevisionFixture = (overrides: Partial<SpecRevision> = {}): SpecRevision => ({
  id: 'spec-r1',
  spec_id: 'spec-1',
  work_item_id: 'wi-1',
  revision_number: 1,
  summary: 'Approved spec.',
  content: 'Approved spec content.',
  background: 'Background.',
  goals: ['Ship the slice.'],
  scope_in: ['Backend readiness.'],
  scope_out: ['Frontend rendering.'],
  acceptance_criteria: ['All required stages are represented.'],
  risk_notes: ['Medium rollout risk.'],
  test_strategy_summary: 'Focused unit and API coverage.',
  artifact_refs: [],
  created_at: now,
  ...overrides,
});

const planFixture = (overrides: Partial<Plan> = {}): Plan => ({
  id: 'plan-1',
  work_item_id: 'wi-1',
  entity_type: 'plan',
  status: 'approved',
  editing_state: 'idle',
  gate_state: 'approved',
  resolution: 'approved',
  current_revision_id: 'plan-r1',
  approved_revision_id: 'plan-r1',
  approved_at: now,
  approved_by_actor_id: 'actor-approver',
  created_at: now,
  updated_at: now,
  ...overrides,
});

const planRevisionFixture = (overrides: Partial<PlanRevision> = {}): PlanRevision => ({
  id: 'plan-r1',
  plan_id: 'plan-1',
  work_item_id: 'wi-1',
  based_on_spec_revision_id: 'spec-r1',
  revision_number: 1,
  summary: 'Approved plan.',
  content: 'Approved plan content.',
  implementation_summary: 'Implement the read model.',
  split_strategy: 'Single package.',
  dependency_order: ['pkg-1'],
  test_matrix: ['unit', 'api'],
  risk_mitigations: ['Focused regression tests.'],
  rollback_notes: 'Revert the read model.',
  artifact_refs: [],
  created_at: now,
  ...overrides,
});

const packageFixture = (overrides: Partial<ExecutionPackage> = {}): ExecutionPackage => ({
  id: 'pkg-1',
  task_id: 'task-1',
  work_item_id: 'wi-1',
  spec_id: 'spec-1',
  spec_revision_id: 'spec-r1',
  plan_id: 'plan-1',
  plan_revision_id: 'plan-r1',
  project_id: 'project-1',
  repo_id: 'repo-1',
  objective: 'Implement readiness.',
  owner_actor_id: 'actor-owner',
  reviewer_actor_id: 'actor-reviewer',
  qa_owner_actor_id: 'actor-qa',
  phase: 'release',
  activity_state: 'idle',
  gate_state: 'release_ready',
  resolution: 'none',
  required_checks: [],
  required_artifact_kinds: [],
  allowed_paths: [],
  forbidden_paths: [],
  source_mutation_policy: 'path_policy_scoped',
  version: 1,
  current_run_session_id: 'run-1',
  current_review_packet_id: 'review-1',
  created_at: now,
  updated_at: now,
  ...overrides,
});

const runFixture = (overrides: Partial<RunSession> = {}): RunSession => ({
  id: 'run-1',
  execution_package_id: 'pkg-1',
  requested_by_actor_id: 'actor-owner',
  status: 'succeeded',
  executor_type: 'mock',
  changed_files: [],
  check_results: [],
  artifacts: [],
  log_refs: [],
  created_at: now,
  updated_at: now,
  started_at: now,
  finished_at: now,
  ...overrides,
});

const reviewFixture = (overrides: Partial<ReviewPacket> = {}): ReviewPacket => ({
  id: 'review-1',
  run_session_id: 'run-1',
  execution_package_id: 'pkg-1',
  reviewer_actor_id: 'actor-reviewer',
  spec_revision_id: 'spec-r1',
  plan_revision_id: 'plan-r1',
  status: 'completed',
  decision: 'approved',
  summary: 'Approved.',
  changed_files: [],
  check_result_summary: 'Checks passed.',
  self_review: {
    status: 'succeeded',
    summary: 'Self review passed.',
    spec_plan_alignment: 'Aligned.',
    test_assessment: 'Covered.',
    risk_notes: [],
    follow_up_questions: [],
  },
  independent_ai_review: {
    status: 'approved',
    summary: 'Independent review passed.',
    run_session_id: 'run-1',
    execution_package_id: 'pkg-1',
    reviewer: 'ai-reviewer',
  },
  test_mapping: [{ gate_id: 'unit', result: 'passed', notes: 'Covered by unit tests.' }],
  risk_notes: [],
  reviewed_by_actor_id: 'actor-reviewer',
  reviewed_at: now,
  requested_changes: [],
  created_at: now,
  updated_at: now,
  completed_at: now,
  ...overrides,
});

const releaseFixture = (overrides: Partial<Release> = {}): Release => ({
  id: 'rel-1',
  org_id: 'org-1',
  project_id: 'project-1',
  title: 'Readiness release',
  phase: 'candidate',
  activity_state: 'idle',
  gate_state: 'not_submitted',
  resolution: 'none',
  work_item_ids: ['wi-1'],
  execution_package_ids: ['pkg-1'],
  rollout_strategy: 'Roll out safely.',
  rollback_plan: 'Revert the release branch.',
  observation_plan: 'Monitor release health.',
  created_by_actor_id: 'actor-owner',
  created_at: now,
  updated_at: now,
  ...overrides,
});

const dependencyFixture = (
  overrides: Partial<ExecutionPackageDependency> & { execution_package_id?: string } = {},
): ExecutionPackageDependency & { execution_package_id: string } => {
  const packageId = overrides.package_id ?? overrides.execution_package_id ?? 'pkg-1';
  return {
    package_id: packageId,
    execution_package_id: packageId,
    depends_on_package_id: 'pkg-shared',
    dependency_type: 'runtime',
    reason: 'Depends on shared package.',
    created_at: now,
    updated_at: now,
    ...overrides,
  };
};

const releaseTestAcceptanceFixture = (overrides: Record<string, unknown> = {}) => ({
  release_id: 'rel-1',
  gate_id: 'qa-ack',
  state: 'not_required',
  rationale: 'No additional acceptance required.',
  ...overrides,
});

const releaseEvidenceFixture = (overrides: Record<string, unknown> = {}) => ({
  release_id: 'rel-1',
  kind: 'pre_release_validation',
  evidence_type: 'pre_release_validation',
  status: 'current',
  ...overrides,
});

const readyInput = (
  overrides: Partial<WorkItemDeliveryReadinessInput> & {
    kind?: WorkItem['kind'];
    risk?: string;
    activeLane?: WorkItemDeliveryReadinessInput['activeLane'];
    linkedRelease?: Release | null;
  } = {},
): WorkItemDeliveryReadinessInput => {
  const {
    kind,
    risk,
    activeLane,
    linkedRelease,
    workItem,
    currentSpec,
    currentSpecRevision,
    approvedSpecRevision,
    currentPlan,
    currentPlanRevision,
    approvedPlanRevision,
    packages,
    packageDependencies,
    runSessions,
    reviewPackets,
    releases,
    releaseBlockers,
    releaseTestAcceptance,
    releaseEvidence,
    decisions,
    degradedSources,
  } = overrides;
  return {
    workItem: workItem ?? workItemFixture({ ...(kind === undefined ? {} : { kind }), ...(risk === undefined ? {} : { risk }) }),
    activeLane,
    currentSpec: currentSpec ?? specFixture(),
    currentSpecRevision: currentSpecRevision ?? specRevisionFixture(),
    approvedSpecRevision: approvedSpecRevision ?? specRevisionFixture(),
    currentPlan: currentPlan ?? planFixture(),
    currentPlanRevision: currentPlanRevision ?? planRevisionFixture(),
    approvedPlanRevision: approvedPlanRevision ?? planRevisionFixture(),
    packages: packages ?? [packageFixture()],
    packageDependencies: packageDependencies ?? [],
    runSessions: runSessions ?? [runFixture()],
    reviewPackets: reviewPackets ?? [reviewFixture()],
    releases: releases ?? (linkedRelease === null ? [] : [linkedRelease ?? releaseFixture()]),
    releaseBlockers: releaseBlockers ?? [],
    releaseTestAcceptance: releaseTestAcceptance ?? [releaseTestAcceptanceFixture()],
    releaseEvidence: releaseEvidence ?? [],
    decisions: decisions ?? [],
    degradedSources,
  };
};

describe('Work Item delivery readiness', () => {
  it('returns all eight stages for a requirement', () => {
    const readiness = deriveWorkItemDeliveryReadiness(readyInput({ kind: 'requirement' }));
    expect(readiness.stages.map((stage) => stage.id)).toEqual([
      'spec',
      'plan',
      'packages',
      'execution',
      'review',
      'integration_readiness',
      'quality_gate',
      'release_readiness',
    ]);
  });

  it('marks complete approved Spec and Plan evidence as passed', () => {
    const readiness = deriveWorkItemDeliveryReadiness(readyInput());

    expect(readiness.stages.find((stage) => stage.id === 'spec')).toMatchObject({ state: 'passed' });
    expect(readiness.stages.find((stage) => stage.id === 'plan')).toMatchObject({ state: 'passed' });
  });

  it('marks initiative package stages not applicable without current packages', () => {
    const readiness = deriveWorkItemDeliveryReadiness(readyInput({ kind: 'initiative', packages: [] }));
    expect(readiness.stages.find((stage) => stage.id === 'packages')).toMatchObject({ state: 'not_applicable' });
  });

  it('marks Requirement integration readiness not applicable for simple single-package scope', () => {
    const readiness = deriveWorkItemDeliveryReadiness(
      readyInput({
        kind: 'requirement',
        risk: 'medium',
        packages: [packageFixture({ integration_readiness: undefined })],
        packageDependencies: [],
      }),
    );
    expect(readiness.stages.find((stage) => stage.id === 'integration_readiness')).toMatchObject({
      state: 'not_applicable',
    });
    expect(readiness.stages.find((stage) => stage.id === 'quality_gate')).not.toMatchObject({
      blockers: [expect.objectContaining({ code: 'missing_integration_readiness' })],
    });
  });

  it('requires Requirement integration readiness for high-risk or multi-package scope', () => {
    const highRisk = deriveWorkItemDeliveryReadiness(
      readyInput({
        kind: 'requirement',
        risk: 'high',
        packages: [packageFixture({ integration_readiness: undefined })],
        packageDependencies: [],
      }),
    );
    expect(highRisk.stages.find((stage) => stage.id === 'integration_readiness')).toMatchObject({
      state: 'missing',
      blockers: [expect.objectContaining({ code: 'missing_integration_readiness' })],
    });

    const multiPackage = deriveWorkItemDeliveryReadiness(
      readyInput({
        kind: 'requirement',
        risk: 'medium',
        packages: [packageFixture({ id: 'pkg-1' }), packageFixture({ id: 'pkg-2' })],
        packageDependencies: [],
      }),
    );
    expect(multiPackage.stages.find((stage) => stage.id === 'integration_readiness')).toMatchObject({
      state: 'missing',
      blockers: [expect.objectContaining({ code: 'missing_integration_readiness' })],
    });
  });

  it('marks Bug integration readiness not applicable unless regression or cross-end evidence requires it', () => {
    const simpleBug = deriveWorkItemDeliveryReadiness(
      readyInput({
        kind: 'bug',
        risk: 'medium',
        packages: [packageFixture({ integration_readiness: undefined })],
        packageDependencies: [],
      }),
    );
    expect(simpleBug.stages.find((stage) => stage.id === 'integration_readiness')).toMatchObject({
      state: 'not_applicable',
    });

    const crossEndBug = deriveWorkItemDeliveryReadiness(
      readyInput({
        kind: 'bug',
        packages: [packageFixture({ integration_readiness: { status: 'required', surface: 'regression_cross_end' } })],
      }),
    );
    expect(crossEndBug.stages.find((stage) => stage.id === 'integration_readiness')).toMatchObject({
      state: 'blocked',
      blockers: [expect.objectContaining({ code: 'missing_contract_readiness' })],
    });
  });

  it('keeps Bug delivery validation stages required', () => {
    const readiness = deriveWorkItemDeliveryReadiness(readyInput({ kind: 'bug', packages: [] }));
    expect(readiness.stages.find((stage) => stage.id === 'packages')).toMatchObject({ state: 'missing' });
    expect(readiness.stages.find((stage) => stage.id === 'execution')).toMatchObject({ state: 'blocked' });
    expect(readiness.stages.find((stage) => stage.id === 'review')).toMatchObject({ state: 'blocked' });
    expect(readiness.stages.find((stage) => stage.id === 'quality_gate')).toMatchObject({ state: 'blocked' });
  });

  it('reaches ready for release only when all required stages and linked release readiness pass', () => {
    const readiness = deriveWorkItemDeliveryReadiness(
      readyInput({
        kind: 'requirement',
        risk: 'medium',
        packages: [packageFixture({ integration_readiness: undefined })],
        packageDependencies: [],
        linkedRelease: releaseFixture({ id: 'rel-ready', execution_package_ids: ['pkg-1'] }),
        releaseBlockers: [],
        releaseTestAcceptance: [releaseTestAcceptanceFixture({ release_id: 'rel-ready', package_id: 'pkg-1', state: 'passed' })],
        releaseEvidence: [releaseEvidenceFixture({ release_id: 'rel-ready', package_id: 'pkg-1', kind: 'pre_release_validation' })],
      }),
    );
    expect(readiness.stages.find((stage) => stage.id === 'integration_readiness')).toMatchObject({ state: 'not_applicable' });
    expect(readiness.stages.find((stage) => stage.id === 'release_readiness')).toMatchObject({ state: 'ready' });
    expect(readiness.overall_state).toBe('ready_for_release');
  });

  it('requires Tech Debt integration readiness for shared or migration-sensitive packages', () => {
    const readiness = deriveWorkItemDeliveryReadiness(
      readyInput({
        kind: 'tech_debt',
        packages: [packageFixture({ integration_readiness: { status: 'ready', surface: 'shared_contract_migration' } })],
      }),
    );
    expect(readiness.stages.find((stage) => stage.id === 'integration_readiness')).toMatchObject({
      state: 'blocked',
      blockers: [expect.objectContaining({ code: 'missing_contract_readiness' })],
    });
    expect(readiness.stages.find((stage) => stage.id === 'quality_gate')).toMatchObject({ state: 'blocked' });
  });

  it('blocks quality gate when required test gates are unknown', () => {
    const readiness = deriveWorkItemDeliveryReadiness(
      readyInput({ packages: [packageFixture({ required_test_gates: [{ status: 'passed' }] })] }),
    );
    expect(readiness.stages.find((stage) => stage.id === 'quality_gate')).toMatchObject({ state: 'blocked' });
  });

  it('blocks execution and downstream readiness when selected-run required checks are missing or failed', () => {
    const readiness = deriveWorkItemDeliveryReadiness(
      readyInput({
        packages: [
          packageFixture({
            required_checks: [{ check_id: 'unit', display_name: 'Unit', command: 'pnpm test', timeout_seconds: 60, blocks_review: true }],
          }),
        ],
        runSessions: [runFixture({ id: 'run-1', status: 'succeeded', check_results: [{ check_id: 'unit', status: 'failed', blocks_review: true }] })],
      }),
    );
    expect(readiness.stages.find((stage) => stage.id === 'execution')).toMatchObject({
      state: 'blocked',
      blockers: [expect.objectContaining({ code: 'failed_required_check' })],
    });
    expect(readiness.stages.find((stage) => stage.id === 'quality_gate')).toMatchObject({
      state: 'blocked',
      blockers: [expect.objectContaining({ code: 'failed_required_check' })],
    });
    expect(readiness.stages.find((stage) => stage.id === 'release_readiness')).toMatchObject({ state: 'blocked' });
    expect(readiness.stages.find((stage) => stage.id === 'release_readiness')).toMatchObject({
      blockers: expect.arrayContaining([expect.objectContaining({ code: 'failed_required_check' })]),
    });

    const missing = deriveWorkItemDeliveryReadiness(
      readyInput({
        packages: [
          packageFixture({
            required_checks: [{ check_id: 'unit', display_name: 'Unit', command: 'pnpm test', timeout_seconds: 60, blocks_review: true }],
          }),
        ],
        runSessions: [runFixture({ id: 'run-1', status: 'succeeded', check_results: [] })],
      }),
    );
    expect(missing.stages.find((stage) => stage.id === 'execution')).toMatchObject({
      state: 'blocked',
      blockers: [expect.objectContaining({ code: 'missing_required_check' })],
    });
    expect(missing.stages.find((stage) => stage.id === 'release_readiness')).toMatchObject({
      blockers: expect.arrayContaining([expect.objectContaining({ code: 'missing_required_check' })]),
    });
  });

  it('does not require release linkage before Quality Gate passes', () => {
    const readiness = deriveWorkItemDeliveryReadiness(
      readyInput({
        releases: [],
        packages: [
          packageFixture({
            required_checks: [{ check_id: 'unit', display_name: 'Unit', command: 'pnpm test', timeout_seconds: 60, blocks_review: true }],
          }),
        ],
        runSessions: [runFixture({ id: 'run-1', status: 'succeeded', check_results: [] })],
      }),
    );
    const releaseStage = readiness.stages.find((stage) => stage.id === 'release_readiness');

    expect(releaseStage).toMatchObject({ state: 'blocked' });
    expect(releaseStage?.blockers).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'missing_required_check' })]));
    expect(releaseStage?.blockers).not.toEqual(expect.arrayContaining([expect.objectContaining({ code: 'missing_linked_release' })]));
  });

  it('uses typed source object routes for pre-release blocker object links', () => {
    const readiness = deriveWorkItemDeliveryReadiness(readyInput({ linkedRelease: null }));

    expect(readiness.stages.find((stage) => stage.id === 'release_readiness')).toMatchObject({
      blockers: expect.arrayContaining([
        expect.objectContaining({
          code: 'missing_linked_release',
          object_ref: expect.objectContaining({
            object_type: 'requirement',
            object_id: 'wi-1',
            href: '/requirements/wi-1',
          }),
        }),
      ]),
    });
  });

  it('keeps draft packages actionable and blocks explicitly blocked packages', () => {
    const draft = deriveWorkItemDeliveryReadiness(
      readyInput({ packages: [packageFixture({ phase: 'draft', blocked_reason: undefined })] }),
    );
    expect(draft.stages.find((stage) => stage.id === 'packages')).toMatchObject({
      state: 'ready',
      blockers: [],
    });

    const blocked = deriveWorkItemDeliveryReadiness(
      readyInput({ packages: [packageFixture({ blocked_reason: 'Path policy failed.' })] }),
    );
    expect(blocked.stages.find((stage) => stage.id === 'packages')).toMatchObject({
      state: 'blocked',
      blockers: [expect.objectContaining({ code: 'package_blocked' })],
    });
    expect(blocked.stages.find((stage) => stage.id === 'release_readiness')).toMatchObject({
      blockers: expect.arrayContaining([expect.objectContaining({ code: 'package_blocked' })]),
    });
  });

  it('blocks review when selected code review handoff is stale or incomplete', () => {
    const readiness = deriveWorkItemDeliveryReadiness(
      readyInput({
        packages: [packageFixture({ current_review_packet_id: 'review-1' })],
        runSessions: [runFixture({ id: 'run-1', status: 'succeeded' })],
        reviewPackets: [reviewFixture({ id: 'review-1', run_session_id: 'stale-run', status: 'completed', decision: 'approved', independent_ai_review: undefined })],
      }),
    );
    expect(readiness.stages.find((stage) => stage.id === 'review')).toMatchObject({
      state: 'blocked',
      blockers: expect.arrayContaining([
        expect.objectContaining({ code: 'stale_review_run' }),
        expect.objectContaining({ code: 'missing_independent_ai_review' }),
      ]),
    });
  });

  it('blocks quality gate when required artifacts are absent from selected-run evidence', () => {
    const readiness = deriveWorkItemDeliveryReadiness(
      readyInput({
        packages: [packageFixture({ required_artifact_kinds: ['logs', 'review_packet'] })],
        runSessions: [runFixture({ id: 'run-1', status: 'succeeded', artifacts: [], log_refs: [] })],
        reviewPackets: [reviewFixture({ run_session_id: 'run-1', status: 'completed', decision: 'approved' })],
      }),
    );
    expect(readiness.stages.find((stage) => stage.id === 'quality_gate')).toMatchObject({
      state: 'blocked',
      blockers: [expect.objectContaining({ code: 'missing_required_artifact' })],
    });
  });

  it('blocks downstream stages when strict Spec or Plan content checks fail', () => {
    const readiness = deriveWorkItemDeliveryReadiness(
      readyInput({
        approvedSpecRevision: specRevisionFixture({ id: 'spec-r1', acceptance_criteria: [], test_strategy_summary: '' }),
        approvedPlanRevision: planRevisionFixture({ id: 'plan-r1', based_on_spec_revision_id: 'stale-spec-r0', test_matrix: [], rollback_notes: '' }),
      }),
    );
    expect(readiness.stages.find((stage) => stage.id === 'spec')).toMatchObject({ state: 'blocked' });
    expect(readiness.stages.find((stage) => stage.id === 'plan')).toMatchObject({ state: 'blocked' });
    expect(readiness.stages.find((stage) => stage.id === 'quality_gate')).toMatchObject({ state: 'blocked' });
    expect(readiness.stages.find((stage) => stage.id === 'release_readiness')).toMatchObject({ state: 'blocked' });
  });

  it('requires package dependencies to trigger Integration Readiness even when packages have no inline integration record', () => {
    const readiness = deriveWorkItemDeliveryReadiness(
      readyInput({
        kind: 'requirement',
        risk: 'medium',
        packages: [packageFixture({ id: 'pkg-1', integration_readiness: undefined })],
        packageDependencies: [
          dependencyFixture({
            execution_package_id: 'pkg-1',
            depends_on_package_id: 'pkg-shared-api',
          }),
        ],
      }),
    );
    expect(readiness.stages.find((stage) => stage.id === 'integration_readiness')).toMatchObject({
      state: 'missing',
      blockers: [expect.objectContaining({ code: 'missing_integration_readiness' })],
    });
    expect(readiness.stages.find((stage) => stage.id === 'quality_gate')).toMatchObject({ state: 'blocked' });
  });

  it('turns consumed degraded sources into stage blockers instead of ready states', () => {
    const readiness = deriveWorkItemDeliveryReadiness(
      readyInput({ degradedSources: ['package_dependencies', 'integration_readiness', 'release_scope', 'release_blockers', 'release_test_acceptance'] }),
    );
    expect(readiness.stages.find((stage) => stage.id === 'integration_readiness')).toMatchObject({ state: 'blocked' });
    expect(readiness.stages.find((stage) => stage.id === 'quality_gate')).toMatchObject({ state: 'blocked' });
    expect(readiness.stages.find((stage) => stage.id === 'release_readiness')).toMatchObject({ state: 'blocked' });
    expect(readiness.stages.find((stage) => stage.id === 'release_readiness')).toMatchObject({
      blockers: expect.arrayContaining([
        expect.objectContaining({ code: 'degraded_package_dependencies' }),
        expect.objectContaining({ code: 'degraded_integration_readiness' }),
      ]),
    });
    expect(readiness.overall_state).not.toBe('ready_for_release');
  });

  it('makes manager lane read-only', () => {
    const readiness = deriveWorkItemDeliveryReadiness(readyInput({ activeLane: 'manager' }));
    expect(readiness.next_actions.every((action) => action.kind === 'navigate')).toBe(true);
  });

  it('returns responsibility-aware next actions for delivery lanes', () => {
    const cases = [
      { lane: 'spec-approver', label: /spec|plan|test strategy/i, objectType: 'spec' },
      { lane: 'execution-owner', label: /execution/i, objectType: 'execution' },
      { lane: 'reviewer', label: /review/i, objectType: 'code_review_handoff' },
      { lane: 'qa-test-owner', label: /quality|gate|acceptance/i, objectType: 'release' },
      { lane: 'release-owner', label: /release/i, objectType: 'release' },
    ] as const;

    for (const item of cases) {
      const readiness = deriveWorkItemDeliveryReadiness(readyInput({ activeLane: item.lane, linkedRelease: releaseFixture({ id: 'rel-1' }) }));
      expect(readiness.next_actions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            lane_id: item.lane,
            kind: 'navigate',
            label: expect.stringMatching(item.label),
            target: expect.objectContaining({ kind: 'object', object_type: item.objectType }),
          }),
        ]),
      );
    }
  });

  it('returns package generation as delivery_readiness next action only after approved Plan revision exists', () => {
    const readiness = deriveWorkItemDeliveryReadiness(
      readyInput({
        packages: [],
        currentPlan: planFixture({ approved_revision_id: 'plan-r1', current_revision_id: 'plan-r1' }),
        approvedPlanRevision: planRevisionFixture({ id: 'plan-r1' }),
        activeLane: 'requirements',
      }),
    );
    expect(readiness.next_actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'command',
          command: expect.objectContaining({
            type: 'generate_packages',
            plan_revision_id: 'plan-r1',
          }),
        }),
      ]),
    );
    expect(readiness.next_actions).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ command: expect.objectContaining({ type: expect.stringContaining('create') }) }),
      ]),
    );

    const missingApprovedRevision = deriveWorkItemDeliveryReadiness(
      readyInput({
        packages: [],
        currentPlan: planFixture({ approved_revision_id: undefined, current_revision_id: 'plan-r1' }),
        approvedPlanRevision: planRevisionFixture({ id: 'plan-r1' }),
        activeLane: 'requirements',
      }),
    );
    expect(missingApprovedRevision.next_actions).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ command: expect.objectContaining({ type: 'generate_packages' }) }),
      ]),
    );
  });

  it('does not emit direct document draft commands from Work Item readiness', () => {
    const retiredCommandTypes = [
      ['generate', 'spec', 'draft'].join('_'),
      ['generate', 'plan', 'draft'].join('_'),
    ];
    const missingSpecDraft = deriveWorkItemDeliveryReadiness(
      readyInput({
        currentSpec: specFixture({ current_revision_id: undefined, approved_revision_id: undefined }),
        currentSpecRevision: undefined,
        activeLane: 'requirements',
      }),
    );
    const missingPlanDraft = deriveWorkItemDeliveryReadiness(
      readyInput({
        currentPlan: planFixture({ current_revision_id: undefined, approved_revision_id: undefined }),
        currentPlanRevision: undefined,
        activeLane: 'requirements',
      }),
    );

    for (const readiness of [missingSpecDraft, missingPlanDraft]) {
      expect(
        readiness.next_actions.some(
          (action) => action.kind === 'command' && retiredCommandTypes.includes(action.command.type),
        ),
      ).toBe(false);
    }
  });
});
