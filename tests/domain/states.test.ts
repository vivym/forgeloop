import { describe, expect, it } from 'vitest';

import {
  DomainError,
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
    it('creates and advances through approved spec, approved plan, execution, and done', () => {
      const created = transitionWorkItem(undefined, {
        type: 'create',
        id: 'work-item-1',
        project_id: 'project-1',
        title: 'Ship domain rules',
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

      const completed = transitionWorkItem(planApproved, { type: 'complete_execution' });
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
        title: 'Handle review loops',
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
        title: 'Triaged item',
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
        title: 'Invalid plan approval',
        owner_actor_id: 'actor-owner',
      });

      expectDomainError(() => transitionWorkItem(item, { type: 'approve_plan' }), 'INVALID_TRANSITION');
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
    const createPackage = (): ExecutionPackage =>
      transitionExecutionPackage(undefined, {
        type: 'generate_package',
        id: 'package-1',
        work_item_id: 'work-item-1',
        project_id: 'project-1',
        repo_id: 'repo-1',
        objective: 'Implement one package.',
        owner_actor_id: 'actor-owner',
        reviewer_actor_id: 'actor-reviewer',
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
  });

  describe('RunSession', () => {
    const createSession = (): RunSession =>
      transitionRunSession(undefined, {
        type: 'create',
        id: 'run-session-1',
        execution_package_id: 'package-1',
        requested_by_actor_id: 'actor-owner',
      });

    it('creates, starts, and records terminal executor outcomes', () => {
      const queued = createSession();
      expect(queued.status).toBe('queued');

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
    const createPacket = (): ReviewPacket =>
      transitionReviewPacket(undefined, {
        type: 'create',
        id: 'review-packet-1',
        run_session_id: 'run-session-1',
        execution_package_id: 'package-1',
        reviewer_actor_id: 'actor-reviewer',
      });

    it('creates, starts review, and records approval', () => {
      const ready = createPacket();
      expect(ready).toMatchObject({
        status: 'ready',
        decision: 'none',
      });

      const inReview = transitionReviewPacket(ready, { type: 'start_review' });
      expect(inReview).toMatchObject({
        status: 'in_review',
        decision: 'none',
      });

      expect(transitionReviewPacket(inReview, { type: 'approve' })).toMatchObject({
        status: 'completed',
        decision: 'approved',
      });
    });

    it('allows approval, changes requested, and archive from open packets', () => {
      const ready = createPacket();

      expect(transitionReviewPacket(ready, { type: 'approve' })).toMatchObject({
        status: 'completed',
        decision: 'approved',
      });
      expect(transitionReviewPacket(ready, { type: 'request_changes' })).toMatchObject({
        status: 'completed',
        decision: 'changes_requested',
      });
      expect(transitionReviewPacket(ready, { type: 'archive_for_newer_run' })).toMatchObject({
        status: 'archived',
        decision: 'none',
      });
    });

    it('rejects invalid ReviewPacket transitions', () => {
      const completed = transitionReviewPacket(createPacket(), { type: 'approve' });

      expectDomainError(() => transitionReviewPacket(completed, { type: 'archive_for_newer_run' }), 'INVALID_TRANSITION');
    });
  });
});
