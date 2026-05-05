import { describe, expect, it } from 'vitest';
import type { ArtifactKind, ArtifactRef, ChangedFile, RequiredCheckSpec, RunSpec, SelfReviewResult } from '@forgeloop/contracts';

import {
  DomainError,
  deriveWorkItemCompletion,
  transitionExecutionPackage,
  transitionReviewPacket,
  transitionRunSession,
  transitionSpecPlan,
  transitionWorkItem,
  type ExecutionPackage,
  type ReviewPacket,
  type RunSession,
  type WorkItem,
} from '../../packages/domain/src/index';

const expectDomainError = (fn: () => unknown, code: string) => {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe(code);
    return;
  }

  throw new Error(`Expected DomainError ${code}`);
};

describe('domain state transitions', () => {
  describe('WorkItem', () => {
    const requiredCheck = {
      check_id: 'domain-tests',
      display_name: 'Domain tests',
      command: 'pnpm test tests/domain',
      timeout_seconds: 120,
      blocks_review: true,
    };

    const executionPackage = (overrides: Partial<ExecutionPackage> = {}): ExecutionPackage => ({
      id: 'package-1',
      work_item_id: 'work-item-1',
      spec_id: 'spec-1',
      spec_revision_id: 'spec-revision-1',
      plan_id: 'plan-1',
      plan_revision_id: 'plan-revision-1',
      project_id: 'project-1',
      repo_id: 'repo-1',
      objective: 'Implement the domain package.',
      owner_actor_id: 'actor-owner',
      reviewer_actor_id: 'actor-reviewer',
      qa_owner_actor_id: 'actor-qa',
      phase: 'review',
      activity_state: 'idle',
      gate_state: 'review_approved',
      resolution: 'completed',
      required_checks: [requiredCheck],
      required_artifact_kinds: ['execution_summary', 'diff'],
      allowed_paths: ['packages/domain/**', 'tests/domain/**'],
      forbidden_paths: ['apps/**'],
      created_at: '2026-05-05T00:00:00.000Z',
      updated_at: '2026-05-05T00:00:00.000Z',
      ...overrides,
    });

    const successfulRun = (overrides: Partial<RunSession> = {}): RunSession => ({
      id: 'run-session-1',
      execution_package_id: 'package-1',
      requested_by_actor_id: 'actor-owner',
      status: 'succeeded',
      changed_files: [
        {
          repo_id: 'repo-1',
          path: 'packages/domain/src/types.ts',
          change_kind: 'modified',
        },
      ],
      check_results: [
        {
          check_id: 'domain-tests',
          command: 'pnpm test tests/domain',
          status: 'succeeded',
          exit_code: 0,
          duration_seconds: 7,
          blocks_review: true,
        },
      ],
      artifacts: [
        {
          kind: 'execution_summary',
          name: 'summary',
          content_type: 'text/markdown',
          local_ref: 'artifacts/run-session/summary.md',
        },
        {
          kind: 'diff',
          name: 'diff',
          content_type: 'text/x-diff',
          local_ref: 'artifacts/run-session/diff.patch',
        },
      ],
      log_refs: [
        {
          kind: 'logs',
          name: 'executor log',
          content_type: 'text/plain',
          local_ref: 'artifacts/run-session/executor.log',
        },
      ],
      created_at: '2026-05-05T00:00:00.000Z',
      updated_at: '2026-05-05T00:00:00.000Z',
      finished_at: '2026-05-05T00:00:00.000Z',
      ...overrides,
    });

    const approvedReviewPacket = (overrides: Partial<ReviewPacket> = {}): ReviewPacket => ({
      id: 'review-packet-1',
      run_session_id: 'run-session-1',
      execution_package_id: 'package-1',
      reviewer_actor_id: 'actor-reviewer',
      spec_revision_id: 'spec-revision-1',
      plan_revision_id: 'plan-revision-1',
      status: 'completed',
      decision: 'approved',
      changed_files: [
        {
          repo_id: 'repo-1',
          path: 'packages/domain/src/types.ts',
          change_kind: 'modified',
        },
      ],
      check_result_summary: 'pnpm test tests/domain passed.',
      self_review: {
        status: 'succeeded',
        summary: 'Changes match the P0 domain spec.',
        spec_plan_alignment: 'Fields are frozen from approved spec and plan revisions.',
        test_assessment: 'Domain transition tests cover the new review packet context.',
        risk_notes: [],
        follow_up_questions: [],
      },
      risk_notes: [],
      requested_changes: [],
      created_at: '2026-05-05T00:00:00.000Z',
      updated_at: '2026-05-05T00:00:00.000Z',
      completed_at: '2026-05-05T00:00:00.000Z',
      ...overrides,
    });

    it('creates and advances through approved spec, approved plan, execution, and done', () => {
      const created = transitionWorkItem(undefined, {
        type: 'create',
        id: 'work-item-1',
        project_id: 'project-1',
        kind: 'feature',
        title: 'Ship domain rules',
        goal: 'Ship the P0 domain state machine.',
        success_criteria: ['Spec, plan, execution, and review gates are enforced.'],
        priority: 'P0',
        risk: 'medium',
        owner_actor_id: 'actor-owner',
      });

      expect(created).toMatchObject({
        phase: 'draft',
        activity_state: 'idle',
        gate_state: 'none',
        resolution: 'none',
      });

      const specSubmitted = transitionWorkItem(created, { type: 'submit_spec' });
      expect(specSubmitted).toMatchObject({
        phase: 'spec',
        gate_state: 'awaiting_spec_approval',
      });

      const specApproved = transitionWorkItem(specSubmitted, { type: 'approve_spec' });
      expect(specApproved).toMatchObject({
        phase: 'plan',
        gate_state: 'none',
      });

      const planSubmitted = transitionWorkItem(specApproved, { type: 'submit_plan' });
      expect(planSubmitted).toMatchObject({
        phase: 'plan',
        gate_state: 'awaiting_plan_approval',
      });

      const planApproved = transitionWorkItem(planSubmitted, { type: 'approve_plan' });
      expect(planApproved).toMatchObject({
        phase: 'execution',
        gate_state: 'none',
      });

      const completion = deriveWorkItemCompletion(
        planApproved,
        [executionPackage()],
        [successfulRun()],
        [approvedReviewPacket()],
      );
      const completed = transitionWorkItem(planApproved, { type: 'complete_execution', completion });
      expect(completed).toMatchObject({
        phase: 'done',
        resolution: 'completed',
      });
    });

    it('supports changes-requested and resubmission gates for spec and plan', () => {
      const base = transitionWorkItem(undefined, {
        type: 'create',
        id: 'work-item-2',
        project_id: 'project-1',
        kind: 'feature',
        title: 'Handle review loops',
        goal: 'Support changes-requested review loops.',
        success_criteria: ['Spec and plan gates can be resubmitted after requested changes.'],
        priority: 'P0',
        risk: 'medium',
        owner_actor_id: 'actor-owner',
      });

      const specReview = transitionWorkItem(base, { type: 'submit_spec' });
      const specChanges = transitionWorkItem(specReview, { type: 'request_spec_changes' });
      expect(specChanges).toMatchObject({
        phase: 'spec',
        gate_state: 'spec_changes_requested',
      });

      const specResubmitted = transitionWorkItem(specChanges, { type: 'resubmit_spec' });
      expect(specResubmitted).toMatchObject({
        phase: 'spec',
        gate_state: 'awaiting_spec_approval',
      });

      const plan = transitionWorkItem(specResubmitted, { type: 'approve_spec' });
      const planReview = transitionWorkItem(plan, { type: 'submit_plan' });
      const planChanges = transitionWorkItem(planReview, { type: 'request_plan_changes' });
      expect(planChanges).toMatchObject({
        phase: 'plan',
        gate_state: 'plan_changes_requested',
      });

      const planResubmitted = transitionWorkItem(planChanges, { type: 'resubmit_plan' });
      expect(planResubmitted).toMatchObject({
        phase: 'plan',
        gate_state: 'awaiting_plan_approval',
      });
    });

    it('allows triage work items to submit a spec', () => {
      const triage: WorkItem = {
        id: 'work-item-3',
        project_id: 'project-1',
        kind: 'bugfix',
        title: 'Triaged item',
        goal: 'Move a triaged item into spec review.',
        success_criteria: ['Triage items can submit a spec.'],
        priority: 'P1',
        risk: 'low',
        owner_actor_id: 'actor-owner',
        phase: 'triage',
        activity_state: 'idle',
        gate_state: 'none',
        resolution: 'none',
        created_at: '2026-05-05T00:00:00.000Z',
        updated_at: '2026-05-05T00:00:00.000Z',
      };

      expect(transitionWorkItem(triage, { type: 'submit_spec' })).toMatchObject({
        phase: 'spec',
        gate_state: 'awaiting_spec_approval',
      });
    });

    it('rejects invalid WorkItem transitions', () => {
      const item = transitionWorkItem(undefined, {
        type: 'create',
        id: 'work-item-4',
        project_id: 'project-1',
        kind: 'feature',
        title: 'Invalid plan approval',
        goal: 'Reject invalid plan approval.',
        success_criteria: ['Draft work items cannot approve a plan.'],
        priority: 'P1',
        risk: 'low',
        owner_actor_id: 'actor-owner',
      });

      expectDomainError(() => transitionWorkItem(item, { type: 'approve_plan' }), 'INVALID_TRANSITION');
    });

    it('blocks execution completion when derived completion evidence is incomplete', () => {
      const item: WorkItem = {
        id: 'work-item-1',
        project_id: 'project-1',
        kind: 'feature',
        title: 'Incomplete execution',
        goal: 'Block incomplete execution.',
        success_criteria: ['Completion requires derived evidence.'],
        priority: 'P0',
        risk: 'medium',
        owner_actor_id: 'actor-owner',
        phase: 'execution',
        activity_state: 'idle',
        gate_state: 'none',
        resolution: 'none',
        created_at: '2026-05-05T00:00:00.000Z',
        updated_at: '2026-05-05T00:00:00.000Z',
      };
      const completion = deriveWorkItemCompletion(item, [executionPackage()], [], [approvedReviewPacket()]);

      expectDomainError(() => transitionWorkItem(item, { type: 'complete_execution', completion }), 'COMPLETION_BLOCKED');
    });

    it('blocks blind execution completion without derived completion evidence', () => {
      const item: WorkItem = {
        id: 'work-item-1',
        project_id: 'project-1',
        kind: 'feature',
        title: 'Blind completion',
        goal: 'Block blind completion.',
        success_criteria: ['Completion cannot proceed without derived evidence.'],
        priority: 'P0',
        risk: 'medium',
        owner_actor_id: 'actor-owner',
        phase: 'execution',
        activity_state: 'idle',
        gate_state: 'none',
        resolution: 'none',
        created_at: '2026-05-05T00:00:00.000Z',
        updated_at: '2026-05-05T00:00:00.000Z',
      };

      expectDomainError(
        () => transitionWorkItem(item, { type: 'complete_execution' } as Parameters<typeof transitionWorkItem>[1]),
        'COMPLETION_BLOCKED',
      );
    });
  });

  describe.each(['spec', 'plan'] as const)('SpecPlan %s', (entity_type) => {
    it('creates, drafts with AI, submits, and approves', () => {
      const created = transitionSpecPlan(undefined, {
        type: 'create',
        entity_type,
        id: `${entity_type}-1`,
        work_item_id: 'work-item-1',
      });

      expect(created).toMatchObject({
        entity_type,
        status: 'draft',
        editing_state: 'idle',
        gate_state: 'not_submitted',
        resolution: 'none',
      });

      const drafting = transitionSpecPlan(created, { type: 'generate_draft_start' });
      expect(drafting.editing_state).toBe('ai_drafting');

      const draftSucceeded = transitionSpecPlan(drafting, { type: 'generate_draft_success' });
      expect(draftSucceeded.editing_state).toBe('idle');

      const review = transitionSpecPlan(draftSucceeded, { type: 'submit_for_approval' });
      expect(review).toMatchObject({
        status: 'in_review',
        gate_state: 'awaiting_approval',
      });

      const approved = transitionSpecPlan(review, { type: 'approve' });
      expect(approved).toMatchObject({
        status: 'approved',
        gate_state: 'approved',
        resolution: 'approved',
      });
    });

    it('returns to draft when changes are requested', () => {
      const created = transitionSpecPlan(undefined, {
        type: 'create',
        entity_type,
        id: `${entity_type}-changes`,
        work_item_id: 'work-item-1',
      });
      const review = transitionSpecPlan(created, { type: 'submit_for_approval' });

      expect(transitionSpecPlan(review, { type: 'request_changes' })).toMatchObject({
        status: 'draft',
        gate_state: 'changes_requested',
        resolution: 'none',
      });
    });

    it('settles failed draft generation back to idle editing', () => {
      const created = transitionSpecPlan(undefined, {
        type: 'create',
        entity_type,
        id: `${entity_type}-draft-failure`,
        work_item_id: 'work-item-1',
      });
      const drafting = transitionSpecPlan(created, { type: 'generate_draft_start' });

      expect(transitionSpecPlan(drafting, { type: 'generate_draft_failure' }).editing_state).toBe('idle');
    });

    it('rejects invalid SpecPlan transitions', () => {
      const created = transitionSpecPlan(undefined, {
        type: 'create',
        entity_type,
        id: `${entity_type}-invalid`,
        work_item_id: 'work-item-1',
      });

      expectDomainError(() => transitionSpecPlan(created, { type: 'approve' }), 'INVALID_TRANSITION');
    });
  });

  describe('ExecutionPackage', () => {
    const requiredChecks: RequiredCheckSpec[] = [
      {
        check_id: 'domain-tests',
        display_name: 'Domain tests',
        command: 'pnpm test tests/domain',
        timeout_seconds: 120,
        blocks_review: true,
      },
    ];
    const requiredArtifactKinds: ArtifactKind[] = ['execution_summary', 'diff'];
    const allowedPaths = ['packages/domain/**', 'tests/domain/**'];
    const forbiddenPaths = ['apps/**'];

    const createPackage = (): ExecutionPackage =>
      transitionExecutionPackage(undefined, {
        type: 'generate_package',
        id: 'package-1',
        work_item_id: 'work-item-1',
        spec_id: 'spec-1',
        spec_revision_id: 'spec-revision-1',
        plan_id: 'plan-1',
        plan_revision_id: 'plan-revision-1',
        project_id: 'project-1',
        repo_id: 'repo-1',
        objective: 'Implement one package.',
        owner_actor_id: 'actor-owner',
        reviewer_actor_id: 'actor-reviewer',
        qa_owner_actor_id: 'actor-qa',
        required_checks: requiredChecks,
        required_artifact_kinds: requiredArtifactKinds,
        allowed_paths: allowedPaths,
        forbidden_paths: forbiddenPaths,
      });

    const createReviewPackage = (): ExecutionPackage =>
      transitionExecutionPackage(
        transitionExecutionPackage(transitionExecutionPackage(transitionExecutionPackage(createPackage(), { type: 'mark_ready' }), { type: 'run' }), {
          type: 'workflow_start',
        }),
        { type: 'execution_succeeded' },
      );

    it('generates, marks ready, runs, and reaches review on success', () => {
      const created = createPackage();
      expect(created).toMatchObject({
        spec_id: 'spec-1',
        spec_revision_id: 'spec-revision-1',
        plan_id: 'plan-1',
        plan_revision_id: 'plan-revision-1',
        qa_owner_actor_id: 'actor-qa',
        phase: 'draft',
        activity_state: 'idle',
        gate_state: 'not_submitted',
        resolution: 'none',
      });

      const ready = transitionExecutionPackage(created, { type: 'mark_ready' });
      expect(ready).toMatchObject({
        phase: 'ready',
        gate_state: 'not_submitted',
      });

      const queued = transitionExecutionPackage(ready, { type: 'run' });
      expect(queued).toMatchObject({
        phase: 'queued',
        activity_state: 'awaiting_ai',
      });

      const execution = transitionExecutionPackage(queued, { type: 'workflow_start' });
      expect(execution).toMatchObject({
        phase: 'execution',
        activity_state: 'ai_running',
      });

      const review = transitionExecutionPackage(execution, { type: 'execution_succeeded' });
      expect(review).toMatchObject({
        phase: 'review',
        activity_state: 'awaiting_human',
        gate_state: 'awaiting_human_review',
      });
    });

    it('freezes required checks, artifact kinds, allowed paths, and forbidden paths when generated', () => {
      const created = createPackage();

      expect(created.required_checks).toEqual(requiredChecks);
      expect(created.required_artifact_kinds).toEqual(requiredArtifactKinds);
      expect(created.allowed_paths).toEqual(allowedPaths);
      expect(created.forbidden_paths).toEqual(forbiddenPaths);
      expect(created.required_checks).not.toBe(requiredChecks);
      expect(created.required_artifact_kinds).not.toBe(requiredArtifactKinds);
      expect(created.allowed_paths).not.toBe(allowedPaths);
      expect(created.forbidden_paths).not.toBe(forbiddenPaths);
    });

    it('handles retryable, blocking, and blocking-check execution failures', () => {
      const ready = transitionExecutionPackage(createPackage(), { type: 'mark_ready' });
      const execution = transitionExecutionPackage(transitionExecutionPackage(ready, { type: 'run' }), {
        type: 'workflow_start',
      });

      expect(
        transitionExecutionPackage(execution, {
          type: 'execution_failed_retryable',
          failure_summary: 'Temporary executor error.',
        }),
      ).toMatchObject({
        phase: 'ready',
        activity_state: 'idle',
        last_failure_summary: 'Temporary executor error.',
      });

      expect(
        transitionExecutionPackage(execution, {
          type: 'execution_failed_blocked',
          blocked_reason: 'Needs human input.',
        }),
      ).toMatchObject({
        phase: 'execution',
        activity_state: 'blocked',
        blocked_reason: 'Needs human input.',
      });

      expect(
        transitionExecutionPackage(execution, {
          type: 'execution_failed_blocking_check',
          failure_summary: 'Required check failed.',
        }),
      ).toMatchObject({
        phase: 'ready',
        activity_state: 'idle',
        last_failure_summary: 'Required check failed.',
      });
    });

    it.each(['execution_succeeded', 'execution_failed_retryable', 'execution_failed_blocking_check'] as const)(
      'rejects %s when execution is blocked',
      (type) => {
        const ready = transitionExecutionPackage(createPackage(), { type: 'mark_ready' });
        const execution = transitionExecutionPackage(transitionExecutionPackage(ready, { type: 'run' }), {
          type: 'workflow_start',
        });
        const blocked = transitionExecutionPackage(execution, {
          type: 'execution_failed_blocked',
          blocked_reason: 'Needs human input.',
        });

        expectDomainError(
          () =>
            transitionExecutionPackage(
              blocked,
              type === 'execution_succeeded'
                ? { type }
                : {
                    type,
                    failure_summary: 'Terminal event after blocked state.',
                  },
            ),
          'INVALID_TRANSITION',
        );
      },
    );

    it('records review approval and changes-requested outcomes', () => {
      const review = createReviewPackage();

      expect(transitionExecutionPackage(review, { type: 'review_approved' })).toMatchObject({
        phase: 'review',
        activity_state: 'idle',
        gate_state: 'review_approved',
        resolution: 'completed',
      });

      expect(transitionExecutionPackage(review, { type: 'review_changes_requested' })).toMatchObject({
        phase: 'ready',
        activity_state: 'idle',
        gate_state: 'changes_requested',
        resolution: 'none',
      });
    });

    it('allows force-rerun from review only with an open review packet', () => {
      const review = createReviewPackage();

      expect(
        transitionExecutionPackage(review, {
          type: 'force_rerun',
          has_open_review_packet: true,
        }),
      ).toMatchObject({
        phase: 'queued',
        activity_state: 'awaiting_ai',
      });

      expectDomainError(
        () =>
          transitionExecutionPackage(review, {
            type: 'force_rerun',
            has_open_review_packet: false,
          }),
        'INVALID_TRANSITION',
      );
    });

    it('rejects force-rerun after review approval even with an open review packet', () => {
      const approved = transitionExecutionPackage(createReviewPackage(), { type: 'review_approved' });

      expectDomainError(
        () =>
          transitionExecutionPackage(approved, {
            type: 'force_rerun',
            has_open_review_packet: true,
          }),
        'INVALID_TRANSITION',
      );
    });

    it('rejects changes-requested and second review decisions after review approval', () => {
      const approved = transitionExecutionPackage(createReviewPackage(), { type: 'review_approved' });

      expectDomainError(
        () => transitionExecutionPackage(approved, { type: 'review_changes_requested' }),
        'INVALID_TRANSITION',
      );
      expectDomainError(() => transitionExecutionPackage(approved, { type: 'review_approved' }), 'INVALID_TRANSITION');
    });
  });

  describe('RunSession', () => {
    const changedFiles: ChangedFile[] = [
      {
        repo_id: 'repo-1',
        path: 'packages/domain/src/types.ts',
        change_kind: 'modified',
      },
    ];
    const logRefs: ArtifactRef[] = [
      {
        kind: 'logs',
        name: 'executor log',
        content_type: 'text/plain',
        local_ref: 'artifacts/run-session/executor.log',
      },
    ];
    const runSpec: RunSpec = {
      run_session_id: 'run-session-1',
      execution_package_id: 'package-1',
      work_item_id: 'work-item-1',
      spec_revision_id: 'spec-revision-1',
      plan_revision_id: 'plan-revision-1',
      executor_type: 'local_codex',
      repo: {
        repo_id: 'repo-1',
        local_path: '/Users/viv/projs/forgeloop/.worktrees/p0-delivery-loop-mvp',
        base_branch: 'codex/p0-delivery-loop-mvp',
        base_commit_sha: '3d1b01c8aa45c67764c462ad0defe9c6822da141',
      },
      objective: 'Implement missing P0 fields.',
      context: {
        spec_revision_summary: 'P0 delivery loop spec.',
        plan_revision_summary: 'P0 delivery loop plan.',
        package_instructions: 'Keep domain changes scoped.',
        required_checks: [
          {
            check_id: 'domain-tests',
            display_name: 'Domain tests',
            command: 'pnpm test tests/domain',
            timeout_seconds: 120,
            blocks_review: true,
          },
        ],
      },
      review_context: {
        latest_decision: 'none',
        requested_changes: [],
      },
      workflow_only: false,
      allowed_paths: ['packages/domain/**', 'tests/domain/**'],
      forbidden_paths: ['apps/**'],
      required_checks: [
        {
          check_id: 'domain-tests',
          display_name: 'Domain tests',
          command: 'pnpm test tests/domain',
          timeout_seconds: 120,
          blocks_review: true,
        },
      ],
      artifact_policy: {
        requested_artifacts: ['execution_summary', 'diff'],
      },
      timeout_seconds: 900,
      idempotency_key: 'run-session-1:package-1',
    };

    const createSession = (): RunSession =>
      transitionRunSession(undefined, {
        type: 'create',
        id: 'run-session-1',
        execution_package_id: 'package-1',
        requested_by_actor_id: 'actor-owner',
        executor_type: 'local_codex',
        run_spec: runSpec,
        changed_files: changedFiles,
        log_refs: logRefs,
        summary: 'Queued with frozen run spec.',
        failure_kind: 'required_check_failed',
        failure_reason: 'Required checks not run yet.',
      });

    it('creates, starts, and records terminal executor outcomes', () => {
      const queued = createSession();
      expect(queued).toMatchObject({
        status: 'queued',
        executor_type: 'local_codex',
        run_spec: runSpec,
        changed_files: changedFiles,
        check_results: [],
        artifacts: [],
        log_refs: logRefs,
        summary: 'Queued with frozen run spec.',
        failure_kind: 'required_check_failed',
        failure_reason: 'Required checks not run yet.',
      });

      const running = transitionRunSession(queued, { type: 'workflow_start' });
      expect(running.status).toBe('running');

      expect(transitionRunSession(running, { type: 'executor_success' }).status).toBe('succeeded');
      expect(transitionRunSession(running, { type: 'executor_failure' }).status).toBe('failed');
      expect(transitionRunSession(running, { type: 'executor_timeout' }).status).toBe('timed_out');
    });

    it('allows queued or running sessions to be cancelled', () => {
      const queued = createSession();
      const running = transitionRunSession(queued, { type: 'workflow_start' });

      expect(transitionRunSession(queued, { type: 'cancel' }).status).toBe('cancelled');
      expect(transitionRunSession(running, { type: 'cancel' }).status).toBe('cancelled');
    });

    it('rejects invalid RunSession transitions', () => {
      expectDomainError(() => transitionRunSession(createSession(), { type: 'executor_success' }), 'INVALID_TRANSITION');
    });
  });

  describe('ReviewPacket', () => {
    const changedFiles: ChangedFile[] = [
      {
        repo_id: 'repo-1',
        path: 'tests/domain/states.test.ts',
        change_kind: 'modified',
      },
    ];
    const selfReview: SelfReviewResult = {
      status: 'succeeded',
      summary: 'Changes match the P0 domain spec.',
      spec_plan_alignment: 'Fields are frozen from approved spec and plan revisions.',
      test_assessment: 'Domain transition tests cover the new review packet context.',
      risk_notes: ['Domain persistence adapters must map the new fields.'],
      follow_up_questions: [],
    };

    const createPacket = (): ReviewPacket =>
      transitionReviewPacket(undefined, {
        type: 'create',
        id: 'review-packet-1',
        run_session_id: 'run-session-1',
        execution_package_id: 'package-1',
        reviewer_actor_id: 'actor-reviewer',
        spec_revision_id: 'spec-revision-1',
        plan_revision_id: 'plan-revision-1',
        changed_files: changedFiles,
        check_result_summary: 'pnpm test tests/domain passed.',
        self_review: selfReview,
        risk_notes: ['Domain persistence adapters must map the new fields.'],
      });

    it('creates, starts review, and records approval', () => {
      const ready = createPacket();
      expect(ready).toMatchObject({
        spec_revision_id: 'spec-revision-1',
        plan_revision_id: 'plan-revision-1',
        changed_files: changedFiles,
        check_result_summary: 'pnpm test tests/domain passed.',
        self_review: selfReview,
        risk_notes: ['Domain persistence adapters must map the new fields.'],
        status: 'ready',
        decision: 'none',
      });

      const inReview = transitionReviewPacket(ready, { type: 'start_review' });
      expect(inReview).toMatchObject({
        status: 'in_review',
        decision: 'none',
      });

      expect(
        transitionReviewPacket(inReview, {
          type: 'approve',
          summary: 'Approved after review.',
          reviewed_by_actor_id: 'actor-reviewer',
          reviewed_at: '2026-05-05T01:00:00.000Z',
        }),
      ).toMatchObject({
        status: 'completed',
        decision: 'approved',
        summary: 'Approved after review.',
        reviewed_by_actor_id: 'actor-reviewer',
        reviewed_at: '2026-05-05T01:00:00.000Z',
        requested_changes: [],
      });
    });

    it('allows approval, changes requested, and archive from open packets', () => {
      const ready = createPacket();

      expect(
        transitionReviewPacket(ready, {
          type: 'approve',
          summary: 'Approved.',
          reviewed_by_actor_id: 'actor-reviewer',
          reviewed_at: '2026-05-05T01:00:00.000Z',
        }),
      ).toMatchObject({
        status: 'completed',
        decision: 'approved',
        requested_changes: [],
      });
      expect(
        transitionReviewPacket(ready, {
          type: 'request_changes',
          summary: 'Needs more context.',
          reviewed_by_actor_id: 'actor-reviewer',
          reviewed_at: '2026-05-05T01:00:00.000Z',
          requested_changes: [
            {
              title: 'Add QA owner',
              description: 'Freeze the QA owner on the execution package.',
              severity: 'major',
            },
          ],
        }),
      ).toMatchObject({
        status: 'completed',
        decision: 'changes_requested',
        summary: 'Needs more context.',
        reviewed_by_actor_id: 'actor-reviewer',
        reviewed_at: '2026-05-05T01:00:00.000Z',
        requested_changes: [
          {
            title: 'Add QA owner',
            description: 'Freeze the QA owner on the execution package.',
            severity: 'major',
          },
        ],
      });
      expect(transitionReviewPacket(ready, { type: 'archive_for_newer_run' })).toMatchObject({
        status: 'archived',
        decision: 'none',
      });
    });

    it.each([
      ['missing summary', { summary: undefined }],
      ['blank summary', { summary: '   ' }],
      ['missing reviewer', { reviewed_by_actor_id: undefined }],
      ['blank reviewer', { reviewed_by_actor_id: '   ' }],
      ['missing reviewed timestamp', { reviewed_at: undefined }],
      ['blank reviewed timestamp', { reviewed_at: '   ' }],
      ['missing requested changes', { requested_changes: undefined }],
      ['empty requested changes', { requested_changes: [] }],
    ] as const)('rejects request_changes with %s', (_caseName, override) => {
      const event = {
        type: 'request_changes',
        summary: 'Needs more context.',
        reviewed_by_actor_id: 'actor-reviewer',
        reviewed_at: '2026-05-05T01:00:00.000Z',
        requested_changes: [
          {
            title: 'Add QA owner',
            description: 'Freeze the QA owner on the execution package.',
            severity: 'major',
          },
        ],
        ...override,
      } as Parameters<typeof transitionReviewPacket>[1];

      expectDomainError(() => transitionReviewPacket(createPacket(), event), 'INVALID_TRANSITION');
    });

    it('rejects invalid ReviewPacket transitions', () => {
      const completed = transitionReviewPacket(createPacket(), {
        type: 'approve',
        summary: 'Approved.',
        reviewed_by_actor_id: 'actor-reviewer',
        reviewed_at: '2026-05-05T01:00:00.000Z',
      });

      expectDomainError(() => transitionReviewPacket(completed, { type: 'archive_for_newer_run' }), 'INVALID_TRANSITION');
    });

    it.each(['approved', 'changes_requested'] as const)(
      'rejects open ReviewPacket transitions when decision is %s',
      (decision) => {
        const invalidReadyPacket: ReviewPacket = {
          ...createPacket(),
          decision,
        };
        const invalidInReviewPacket: ReviewPacket = {
          ...invalidReadyPacket,
          status: 'in_review',
        };

        expectDomainError(() => transitionReviewPacket(invalidReadyPacket, { type: 'start_review' }), 'INVALID_TRANSITION');
        expectDomainError(() => transitionReviewPacket(invalidReadyPacket, { type: 'approve' }), 'INVALID_TRANSITION');
        expectDomainError(() => transitionReviewPacket(invalidInReviewPacket, { type: 'approve' }), 'INVALID_TRANSITION');
        expectDomainError(() => transitionReviewPacket(invalidReadyPacket, { type: 'request_changes' }), 'INVALID_TRANSITION');
        expectDomainError(
          () => transitionReviewPacket(invalidInReviewPacket, { type: 'request_changes' }),
          'INVALID_TRANSITION',
        );
        expectDomainError(
          () => transitionReviewPacket(invalidReadyPacket, { type: 'archive_for_newer_run' }),
          'INVALID_TRANSITION',
        );
        expectDomainError(
          () => transitionReviewPacket(invalidInReviewPacket, { type: 'archive_for_newer_run' }),
          'INVALID_TRANSITION',
        );
      },
    );
  });
});
