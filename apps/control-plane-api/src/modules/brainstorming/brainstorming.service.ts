import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { BrainstormingAnswer, BrainstormingDecision } from '@forgeloop/contracts';
import type {
  BoundaryAnswerRecord,
  BoundaryDecisionRecord,
  BoundaryQuestionRecord,
  BoundaryRoundRecord,
  CreateOrReplayAutomationActionRunInput,
  DeliveryRepository,
} from '@forgeloop/db';
import {
  actorCanActForBoundaryLeader,
  codexCanonicalDigest,
  requiredBoundaryQuestionsClosed,
  type AutomationActionRun,
  type BoundaryAnswer,
  type BoundaryDecision,
  type BoundaryQuestion,
  type BoundarySummary,
  type BoundarySummaryRevision,
  type BrainstormingSession,
  type ContextManifest,
  type DevelopmentPlan,
  type DevelopmentPlanItem,
  type DevelopmentPlanItemRevision,
  type DevelopmentPlanRevision,
  DomainError,
  type RevisionCompareQuery,
  type StructuredRevisionDiff,
  type WorkItem,
} from '@forgeloop/domain';

import { AuditWriterService } from '../audit/audit-writer.service';
import { ProductGenerationRuntimeSchedulerService } from '../codex-runtime/product-generation-runtime-scheduler.service';
import { ControlPlaneRuntimeService } from '../core/control-plane-runtime.service';
import { DELIVERY_REPOSITORY } from '../core/control-plane-tokens';

type StartSessionInput = {
  development_plan_id: string;
  item_id: string;
  actor_id: string;
};

export interface WorkflowChildContext {
  workflow_id: string;
  codex_session_id: string;
  codex_session_turn_id?: string;
  plan_item_workflow_action_id?: string;
}

type StartBoundaryBrainstormingInput = StartSessionInput & {
  leader_actor_id?: string | undefined;
  leader_delegate_actor_ids?: string[] | undefined;
  initial_leader_context_markdown?: string | undefined;
  context?: WorkflowChildContext | undefined;
};

type AnswerQuestionInput = {
  question_id: string;
  text: string;
  actor_id: string;
  context?: WorkflowChildContext | undefined;
};

type RecordDecisionInput = {
  text: string;
  rationale?: string | undefined;
  waived_question_id?: string | undefined;
  actor_id: string;
  context?: WorkflowChildContext | undefined;
};

type ContinueBoundaryBrainstormingInput = {
  actor_id: string;
  leader_input_markdown?: string | undefined;
  context?: WorkflowChildContext | undefined;
};

type ApproveBoundarySummaryRevisionInput = {
  actor_id: string;
  final_decision?: string | undefined;
};

type RequestBoundarySummaryChangesInput = {
  actor_id: string;
  feedback_markdown: string;
  rationale?: string | undefined;
  context?: WorkflowChildContext | undefined;
};

type ApproveBoundaryInput = {
  confirmed_scope: string[];
  confirmed_out_of_scope: string[];
  accepted_assumptions: string[];
  open_risks: string[];
  validation_expectations: string[];
  actor_id: string;
  final_decision?: string | undefined;
};

const defaultBoundaryQuestions = [
  'Which repos, modules, and product surfaces are in scope?',
  'What is explicitly out of scope for this Development Plan Item?',
  'Which acceptance criteria and validation commands must pass?',
  'What risks or dependency constraints should block generation?',
];

const runtimeSensitiveTextPattern =
  /~\/\.codex(?:\/(?:config\.toml|auth\.json))?|\b(?:config\.toml|auth\.json)\b|https?:\/\/(?:localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[?::1\]?)(?::\d{1,5})?(?:\/\S*)?|unix:\/\/\S+|\/(?:Users|home|tmp|var|private|workspace|workspaces|app|mnt|Volumes)\/\S+|[\w.-]+\.sock\b|\b(?:localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0)(?::\d{1,5})?\b|\b[0-9a-f]{64}\b/gi;

type BoundaryRoundTerminalResultInput = {
  schema_version: 'boundary_round_result.v1';
  session_id: string;
  round_id: string;
  questions?: Array<{ text: string; required: boolean; rationale?: string | undefined }> | undefined;
  proposed_decisions?: Array<{ text: string; rationale?: string | undefined }> | undefined;
  summary_proposal?:
    | {
        summary_markdown: string;
        confirmed_scope: string[];
        confirmed_out_of_scope: string[];
        accepted_assumptions: string[];
        open_risks: string[];
        validation_expectations: string[];
      }
    | undefined;
  needs_leader_input?: boolean | undefined;
  public_summary?: string | undefined;
};

@Injectable()
export class BrainstormingService {
  constructor(
    @Inject(DELIVERY_REPOSITORY) private readonly repository: DeliveryRepository,
    @Inject(ControlPlaneRuntimeService) private readonly runtime: ControlPlaneRuntimeService,
    @Inject(AuditWriterService) private readonly audit: AuditWriterService,
    @Inject(ProductGenerationRuntimeSchedulerService)
    private readonly productRuntimeScheduler: ProductGenerationRuntimeSchedulerService,
  ) {}

  async startSession(input: StartSessionInput): Promise<BrainstormingSession> {
    return this.startBoundaryProcess({
      ...input,
      legacyActorLeaderWhenUnassigned: true,
      seedDefaultQuestions: true,
      scheduleInitialRound: false,
    });
  }

  async startBoundaryBrainstorming(input: StartBoundaryBrainstormingInput): Promise<BrainstormingSession> {
    return this.startBoundaryProcess({
      ...input,
      seedDefaultQuestions: false,
      scheduleInitialRound: true,
    });
  }

  async restartBoundaryBrainstorming(input: StartBoundaryBrainstormingInput): Promise<BrainstormingSession> {
    return this.startBoundaryProcess({
      ...input,
      seedDefaultQuestions: false,
      scheduleInitialRound: true,
      allowApprovedBoundaryRestart: true,
    });
  }

  async getBoundaryBrainstormingSession(
    sessionId: string,
  ): Promise<BrainstormingSession & { current_round_runtime_job_id?: string }> {
    const session = await this.requireBrainstormingSession(sessionId);
    if (session.current_round_id === undefined) {
      return session;
    }
    const currentRound = (await this.repository.listBoundaryRounds(session.id)).find((round) => round.id === session.current_round_id);
    return {
      ...session,
      ...(currentRound?.runtime_job_id === undefined ? {} : { current_round_runtime_job_id: currentRound.runtime_job_id }),
    };
  }

  private async startBoundaryProcess(
    input: StartBoundaryBrainstormingInput & {
      seedDefaultQuestions: boolean;
      scheduleInitialRound: boolean;
      legacyActorLeaderWhenUnassigned?: boolean | undefined;
      allowApprovedBoundaryRestart?: boolean | undefined;
    },
  ): Promise<BrainstormingSession> {
    return this.repository.withObjectLock(`development-plan:${input.development_plan_id}`, async (planLockedRepository) =>
      planLockedRepository.withDeliveryTransaction(async (repository) => {
        const plan = await this.requireDevelopmentPlan(input.development_plan_id, repository);
        const item = await this.requireDevelopmentPlanItem(input.development_plan_id, input.item_id, repository);
        await this.assertLegacyItemMutationAllowed(repository, item.id, input.context);
        if (input.allowApprovedBoundaryRestart !== true) {
          this.assertItemBoundaryNotApproved(item);
        }
        const requestedLeaderActorId =
          input.legacyActorLeaderWhenUnassigned === true && item.leader_actor_id === undefined
            ? input.actor_id
            : input.leader_actor_id;
        const leader = this.resolveLeader({
          item,
          actorId: input.actor_id,
          requestedLeaderActorId,
          requestedDelegateActorIds: input.leader_delegate_actor_ids,
        });
        const itemForSession =
          leader.updatedItem === undefined
            ? input.allowApprovedBoundaryRestart === true
              ? {
                  ...item,
                  boundary_status: 'in_progress' as const,
                  next_action: 'continue_boundary_brainstorming',
                  updated_at: this.runtime.now(),
                }
              : item
            : {
                ...leader.updatedItem,
                boundary_status:
                  input.allowApprovedBoundaryRestart === true || leader.updatedItem.boundary_status === 'not_started'
                    ? 'in_progress'
                    : leader.updatedItem.boundary_status,
                next_action: 'continue_boundary_brainstorming',
                updated_at: this.runtime.now(),
              };
        if (leader.updatedItem !== undefined || itemForSession.boundary_status !== item.boundary_status) {
          await repository.saveDevelopmentPlanItem(itemForSession);
        }

        const contextManifest = this.buildContextManifest(plan, itemForSession);
        await repository.saveContextManifest(contextManifest);

        const at = this.runtime.now();
        const sessionRevisionId = this.runtime.id('brainstorming-session-revision');
        const session: BrainstormingSession = {
          id: this.runtime.id('brainstorming-session'),
          revision_id: sessionRevisionId,
          source_ref: itemForSession.source_ref,
          development_plan_id: plan.id,
          development_plan_revision_id: plan.revision_id,
          development_plan_item_id: itemForSession.id,
          development_plan_item_revision_id: itemForSession.revision_id,
          context_manifest_id: contextManifest.id,
          context_manifest_revision_id: contextManifest.revision_id,
          leader_actor_id: leader.leader_actor_id,
          leader_delegate_actor_ids: leader.leader_delegate_actor_ids,
          status: input.scheduleInitialRound ? 'ai_turn_running' : 'waiting_for_leader',
          questions: input.seedDefaultQuestions
            ? defaultBoundaryQuestions.map((text) => ({
                id: this.runtime.id('brainstorming-question'),
                text,
                author_id: 'system',
                created_at: at,
                status: 'open',
                required: false,
              }))
            : [],
          answers: [],
          decisions: [],
          approval_state: input.seedDefaultQuestions ? 'questions_open' : 'draft',
          ...(input.context === undefined ? {} : { workflow_id: input.context.workflow_id, codex_session_id: input.context.codex_session_id }),
          created_at: at,
          updated_at: at,
        };
        if (input.seedDefaultQuestions) {
          await this.saveSessionQuestions(session.id, session.questions, repository);
        }
        await repository.saveBrainstormingSession(session);
        const sessionWithRound =
          input.scheduleInitialRound === true
            ? await this.createBoundaryRound({
                session,
                plan,
                item: itemForSession,
                trigger: 'start',
                operation: 'start',
                requestedByActorId: input.actor_id,
                leaderInputMarkdown: input.initial_leader_context_markdown,
                context: input.context,
                repository,
              })
            : session;
        await this.appendItemEvent(
          itemForSession.id,
          'brainstorming_session_started',
          input.actor_id,
          {
            brainstorming_session_id: sessionWithRound.id,
            current_round_id: sessionWithRound.current_round_id,
          },
          repository,
        );
        return sessionWithRound;
      }),
    );
  }

  async answerQuestion(sessionId: string, input: AnswerQuestionInput): Promise<BrainstormingAnswer> {
    return this.repository.withObjectLock(`brainstorming-session:${sessionId}`, async (repository) =>
      repository.withDeliveryTransaction(async (transaction) => {
        const session = await this.requireBrainstormingSession(sessionId, transaction);
        await this.assertSessionMutationAllowed(transaction, session, input.context);
        this.assertSessionMutable(session);
        const actorRole = this.boundaryActorRole(session, input.actor_id);
        const question = session.questions.find((candidate) => candidate.id === input.question_id);
        if (question === undefined) {
          throw new BadRequestException(`Question ${input.question_id} does not belong to Brainstorming Session ${sessionId}`);
        }
        const now = this.runtime.now();
        const answer: BrainstormingAnswer = {
          id: this.runtime.id('brainstorming-answer'),
          question_id: input.question_id,
          ...(question.round_id === undefined ? {} : { round_id: question.round_id }),
          text: input.text,
          actor_id: input.actor_id,
          actor_role: actorRole,
          created_at: now,
        };
        const questions = session.questions.map((candidate) =>
          candidate.id === input.question_id ? { ...candidate, status: 'answered' as const, answered_by_answer_id: answer.id } : candidate,
        );
        const updated: BrainstormingSession = {
          ...session,
          revision_id: this.runtime.id('brainstorming-session-revision'),
          questions,
          answers: [...session.answers, answer],
          approval_state: this.nextApprovalState(questions, [...session.answers, answer], session.decisions),
          updated_at: now,
        };
        await transaction.saveBoundaryAnswer({
          ...answer,
          session_id: session.id,
          sequence: (await transaction.listBoundaryAnswers(session.id)).length + 1,
        });
        const updatedQuestion = questions.find((candidate) => candidate.id === input.question_id);
        if (updatedQuestion !== undefined) {
          await transaction.saveBoundaryQuestion({
            ...updatedQuestion,
            session_id: session.id,
            sequence: this.questionSequence(session.questions, input.question_id),
          });
        }
        await transaction.saveBrainstormingSession(updated);
        return answer;
      }),
    );
  }

  async recordDecision(sessionId: string, input: RecordDecisionInput): Promise<BrainstormingDecision> {
    return this.repository.withObjectLock(`brainstorming-session:${sessionId}`, async (repository) =>
      repository.withDeliveryTransaction(async (transaction) => {
        const session = await this.requireBrainstormingSession(sessionId, transaction);
        await this.assertSessionMutationAllowed(transaction, session, input.context);
        this.assertSessionMutable(session);
        const actorRole = this.boundaryActorRole(session, input.actor_id);
        const decision = this.buildDecision({
          ...input,
          actorRole,
          source: actorRole,
          state: 'accepted',
        });
        const questions =
          input.waived_question_id === undefined
            ? session.questions
            : session.questions.map((question) =>
                question.id === input.waived_question_id
                  ? { ...question, status: 'resolved' as const, waived_by_decision_id: decision.id }
                  : question,
              );
        if (input.waived_question_id !== undefined && !session.questions.some((question) => question.id === input.waived_question_id)) {
          throw new BadRequestException(`Question ${input.waived_question_id} does not belong to Brainstorming Session ${sessionId}`);
        }
        const updated: BrainstormingSession = {
          ...session,
          revision_id: this.runtime.id('brainstorming-session-revision'),
          questions,
          decisions: [...session.decisions, decision],
          approval_state: this.nextApprovalState(questions, session.answers, [...session.decisions, decision]),
          updated_at: this.runtime.now(),
        };
        await transaction.saveBoundaryDecision({
          ...decision,
          session_id: session.id,
          sequence: (await transaction.listBoundaryDecisions(session.id)).length + 1,
        });
        if (input.waived_question_id !== undefined) {
          const waivedQuestion = questions.find((question) => question.id === input.waived_question_id);
          if (waivedQuestion !== undefined) {
            await transaction.saveBoundaryQuestion({
              ...waivedQuestion,
              session_id: session.id,
              sequence: this.questionSequence(session.questions, waivedQuestion.id),
            });
          }
        }
        await transaction.saveBrainstormingSession(updated);
        return decision;
      }),
    );
  }

  async approveBoundary(_sessionId: string, _input: ApproveBoundaryInput): Promise<Record<string, unknown>> {
    throw new DomainError(
      'workflow_legacy_entrypoint_disabled',
      'workflow_legacy_entrypoint_disabled: Legacy direct Boundary approval is disabled; approve through PlanItemWorkflowService',
    );
  }

  async continueBoundaryBrainstorming(
    sessionId: string,
    input: ContinueBoundaryBrainstormingInput,
  ): Promise<BrainstormingSession> {
    return this.repository.withObjectLock(`brainstorming-session:${sessionId}`, async (repository) =>
      repository.withDeliveryTransaction((transaction) => this.continueBoundaryBrainstormingWithRepository(transaction, sessionId, input)),
    );
  }

  async continueBoundaryBrainstormingWithRepository(
    repository: DeliveryRepository,
    sessionId: string,
    input: ContinueBoundaryBrainstormingInput,
  ): Promise<BrainstormingSession> {
    const session = await this.requireBrainstormingSession(sessionId, repository);
    await this.assertSessionMutationAllowed(repository, session, input.context);
    this.assertSessionMutable(session);
    this.boundaryActorRole(session, input.actor_id);
    if (session.status !== 'waiting_for_leader' && session.status !== 'changes_requested' && session.status !== 'summary_proposed') {
      throw new ConflictException('Boundary Brainstorming can continue only after Leader input is requested');
    }
    const plan = await this.requireDevelopmentPlan(session.development_plan_id, repository);
    const item = await this.requireDevelopmentPlanItem(session.development_plan_id, session.development_plan_item_id, repository);
    return this.createBoundaryRound({
      session,
      plan,
      item,
      trigger: 'leader_answer',
      operation: 'continue',
      requestedByActorId: input.actor_id,
      leaderInputMarkdown: input.leader_input_markdown,
      context: input.context,
      repository,
    });
  }

  async applyBoundaryRoundRuntimeResult(input: {
    actionRun: AutomationActionRun;
    runtime_job_id: string;
    generated: BoundaryRoundTerminalResultInput;
  }): Promise<
    | { applied: true; revision?: BoundarySummaryRevision }
    | { applied: false; reason: 'invalid_precondition' | 'stale_precondition_fingerprint' }
  > {
    const precondition = this.productGenerationPrecondition(input.actionRun);
    if (
      precondition === undefined ||
      input.actionRun.action_type !== 'run_boundary_brainstorming_round' ||
      input.actionRun.target_object_type !== 'boundary_round' ||
      input.actionRun.precondition_fingerprint !== codexCanonicalDigest(precondition)
    ) {
      return { applied: false, reason: 'invalid_precondition' };
    }

    return this.repository.withObjectLock(`brainstorming-session:${input.generated.session_id}`, async (repository) =>
      repository.withDeliveryTransaction(async (transaction) => {
        const session = await this.requireBrainstormingSession(input.generated.session_id, transaction);
        const round = (await transaction.listBoundaryRounds(session.id)).find((candidate) => candidate.id === input.generated.round_id);
        if (round === undefined) {
          return { applied: false, reason: 'stale_precondition_fingerprint' };
        }
        const priorApplied = (await transaction.listObjectEvents(input.actionRun.id, 'automation_action_run')).some(
          (event) =>
            event.event_type === 'product_generation_result_applied' &&
            event.metadata.runtime_job_id === input.runtime_job_id &&
            event.metadata.generated_object_type === 'boundary_round' &&
            event.metadata.boundary_round_id === round.id,
        );
        if (priorApplied) {
          const revision =
            session.latest_summary_revision_id === undefined
              ? undefined
              : await transaction.getBoundarySummaryRevisionById(session.latest_summary_revision_id);
          return revision === undefined ? { applied: true } : { applied: true, revision };
        }
        const plan = await this.requireDevelopmentPlan(session.development_plan_id, transaction);
        const item = await this.requireDevelopmentPlanItem(session.development_plan_id, session.development_plan_item_id, transaction);
        await this.assertRuntimeWorkflowContextMatchesSession(transaction, session, input.actionRun);
        const workItem = await this.requireWorkItem(item.source_ref.id, transaction);
        const contextManifest = await transaction.getContextManifest(session.context_manifest_id);
        const stillCurrent =
          input.actionRun.target_object_id === round.id &&
          input.actionRun.target_revision_id === String(precondition.development_plan_item_revision_id) &&
          input.generated.session_id === session.id &&
          input.generated.round_id === round.id &&
          session.current_round_id === round.id &&
          String(precondition.source_revision_id) === workItem.updated_at &&
          JSON.stringify(precondition.source_ref) === JSON.stringify(item.source_ref) &&
          String(precondition.development_plan_id) === plan.id &&
          String(precondition.development_plan_revision_id) === plan.revision_id &&
          String(precondition.development_plan_item_id) === item.id &&
          String(precondition.development_plan_item_revision_id) === item.revision_id &&
          String(precondition.boundary_session_id) === session.id &&
          String(precondition.boundary_session_revision_id) === round.session_revision_id &&
          String(precondition.boundary_round_id) === round.id &&
          String(precondition.context_manifest_id) === session.context_manifest_id &&
          String(precondition.context_manifest_revision_id) === session.context_manifest_revision_id &&
          contextManifest?.revision_id === session.context_manifest_revision_id;
        if (!stillCurrent) {
          return { applied: false, reason: 'stale_precondition_fingerprint' };
        }
        const updatedSession = await this.applyBoundaryRoundTerminalResultWithRepository(input.generated, transaction);
        const revision =
          updatedSession.latest_summary_revision_id === undefined
            ? undefined
            : await transaction.getBoundarySummaryRevisionById(updatedSession.latest_summary_revision_id);
        await this.audit.objectEvent(
          {
            id: this.runtime.id('object-event'),
            object_type: 'automation_action_run',
            object_id: input.actionRun.id,
            event_type: 'product_generation_result_applied',
            actor_id: String(precondition.requested_by_actor_id),
            metadata: {
              runtime_job_id: input.runtime_job_id,
              generated_object_type: 'boundary_round',
              boundary_round_id: round.id,
            },
            created_at: this.runtime.now(),
          },
          transaction,
        );
        return revision === undefined ? { applied: true } : { applied: true, revision };
      }),
    );
  }

  private async applyBoundaryRoundTerminalResultWithRepository(
    input: BoundaryRoundTerminalResultInput,
    transaction: DeliveryRepository,
  ): Promise<BrainstormingSession> {
    const session = await this.requireBrainstormingSession(input.session_id, transaction);
    this.assertSessionMutable(session);
    const round = (await transaction.listBoundaryRounds(session.id)).find((candidate) => candidate.id === input.round_id);
    if (round === undefined) {
      throw new NotFoundException(`Boundary Round ${input.round_id} not found`);
    }

    const now = this.runtime.now();
    const existingQuestions = await transaction.listBoundaryQuestions(session.id);
    const existingDecisions = await transaction.listBoundaryDecisions(session.id);
    const newQuestions: BoundaryQuestionRecord[] = (input.questions ?? []).map((question, index) => ({
      id: this.runtime.id('brainstorming-question'),
      round_id: round.id,
      text: question.text,
      author_id: 'ai',
      created_at: now,
      status: 'open',
      required: question.required,
      ...(question.rationale === undefined ? {} : { rationale: question.rationale }),
      session_id: session.id,
      sequence: existingQuestions.length + index + 1,
    }));
    const newDecisions: BoundaryDecisionRecord[] = (input.proposed_decisions ?? []).map((decision, index) => ({
      id: this.runtime.id('brainstorming-decision'),
      round_id: round.id,
      text: decision.text,
      actor_id: 'ai',
      actor_role: 'ai',
      source: 'ai_proposed',
      state: 'proposed',
      ...(decision.rationale === undefined ? {} : { rationale: decision.rationale }),
      created_at: now,
      session_id: session.id,
      sequence: existingDecisions.length + index + 1,
    }));
    for (const question of newQuestions) {
      await transaction.saveBoundaryQuestion(question);
    }
    for (const decision of newDecisions) {
      await transaction.saveBoundaryDecision(decision);
    }

    const allQuestions = [...session.questions, ...newQuestions.map(({ session_id: _sessionId, sequence: _sequence, ...question }) => question)];
    const allDecisions = [...session.decisions, ...newDecisions.map(({ session_id: _sessionId, sequence: _sequence, ...decision }) => decision)];
    const summaryRevision =
      input.summary_proposal === undefined
        ? undefined
        : await this.createProposedBoundarySummaryRevision({
            session,
            round,
            proposal: input.summary_proposal,
            questions: allQuestions,
            answers: session.answers,
            decisions: allDecisions,
            repository: transaction,
            now,
          });
    const roundStatus = input.summary_proposal === undefined ? 'waiting_for_leader' : 'summary_proposed';
    const updatedRound: BoundaryRoundRecord = {
      ...round,
      ai_output_markdown: input.public_summary,
      status: roundStatus,
      updated_at: now,
    };
    await transaction.saveBoundaryRound(updatedRound);

    const updated: BrainstormingSession = {
      ...session,
      revision_id: this.runtime.id('brainstorming-session-revision'),
      questions: allQuestions,
      decisions: allDecisions,
      status: input.summary_proposal === undefined ? 'waiting_for_leader' : 'summary_proposed',
      approval_state: input.summary_proposal === undefined ? 'questions_open' : this.nextApprovalState(allQuestions, session.answers, allDecisions),
      ...(summaryRevision === undefined
        ? {}
        : {
            boundary_summary_id: summaryRevision.boundary_summary_id,
            latest_summary_revision_id: summaryRevision.id,
          }),
      updated_at: now,
    };
    await transaction.saveBrainstormingSession(updated);
    return updated;
  }

  private productGenerationPrecondition(actionRun: AutomationActionRun): Record<string, unknown> | undefined {
    const value = actionRun.action_input_json.precondition_fingerprint_json;
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
  }

  async requestBoundarySummaryChanges(
    sessionId: string,
    revisionId: string,
    input: RequestBoundarySummaryChangesInput,
  ): Promise<BrainstormingSession> {
    return this.repository.withObjectLock(`brainstorming-session:${sessionId}`, async (repository) =>
      repository.withDeliveryTransaction((transaction) =>
        this.requestBoundarySummaryChangesWithRepository(transaction, sessionId, revisionId, input),
      ),
    );
  }

  async requestBoundarySummaryChangesWithRepository(
    repository: DeliveryRepository,
    sessionId: string,
    revisionId: string,
    input: RequestBoundarySummaryChangesInput,
  ): Promise<BrainstormingSession> {
    const session = await this.requireBrainstormingSession(sessionId, repository);
    await this.assertSessionMutationAllowed(repository, session, input.context);
    this.assertSessionMutable(session);
    this.boundaryActorRole(session, input.actor_id);
    const revision = await this.requireBoundarySummaryRevisionForSession(session, revisionId, repository);
    if (this.boundarySummaryRevisionStatus(revision) !== 'proposed') {
      throw new ConflictException('Only proposed Boundary Summary revisions can receive change requests');
    }
    const now = this.runtime.now();
    await repository.updateBoundarySummaryRevision({
      ...revision,
      status: 'superseded',
    } as BoundarySummaryRevision);
    const decision = this.buildDecision({
      text: input.feedback_markdown,
      rationale: input.rationale,
      actor_id: input.actor_id,
      actorRole: this.boundaryActorRole(session, input.actor_id),
      source: this.boundaryActorRole(session, input.actor_id),
      state: 'rejected',
    });
    await repository.saveBoundaryDecision({
      ...decision,
      session_id: session.id,
      sequence: (await repository.listBoundaryDecisions(session.id)).length + 1,
    });
    const changedSession: BrainstormingSession = {
      ...session,
      revision_id: this.runtime.id('brainstorming-session-revision'),
      decisions: [...session.decisions, decision],
      status: 'changes_requested',
      approval_state: 'changes_requested',
      updated_at: now,
    };
    await repository.saveBrainstormingSession(changedSession);
    const plan = await this.requireDevelopmentPlan(session.development_plan_id, repository);
    const item = await this.requireDevelopmentPlanItem(session.development_plan_id, session.development_plan_item_id, repository);
    return this.createBoundaryRound({
      session: changedSession,
      plan,
      item,
      trigger: 'leader_revision_request',
      operation: 'revise_summary',
      requestedByActorId: input.actor_id,
      leaderInputMarkdown: input.feedback_markdown,
      context: input.context,
      repository,
    });
  }

  async approveBoundarySummaryRevision(
    sessionId: string,
    revisionId: string,
    input: ApproveBoundarySummaryRevisionInput,
  ): Promise<Record<string, unknown>> {
    const sessionHint = await this.requireBrainstormingSession(sessionId);
    await this.assertLegacySessionMutationAllowed(this.repository, sessionHint);
    return this.repository.withObjectLock(`development-plan:${sessionHint.development_plan_id}`, async (planLockedRepository) =>
      planLockedRepository.withObjectLock(`brainstorming-session:${sessionId}`, async (sessionLockedRepository) =>
        sessionLockedRepository.withDeliveryTransaction((repository) =>
          this.approveBoundarySummaryRevisionWithRepository(repository, sessionId, revisionId, input),
        ),
      ),
    );
  }

  async approveBoundarySummaryRevisionWithRepository(
    repository: DeliveryRepository,
    sessionId: string,
    revisionId: string,
    input: ApproveBoundarySummaryRevisionInput,
  ): Promise<Record<string, unknown>> {
    const session = await this.requireBrainstormingSession(sessionId, repository);
    this.assertSessionMutable(session);
    const actorRole = this.boundaryActorRole(session, input.actor_id);
    const revision = await this.requireBoundarySummaryRevisionForSession(session, revisionId, repository);
    if (this.boundarySummaryRevisionStatus(revision) !== 'proposed') {
      throw new ConflictException('Only proposed Boundary Summary revisions can be approved');
    }
    const [questions, answers, decisions, rounds] = await Promise.all([
      repository.listBoundaryQuestions(session.id),
      repository.listBoundaryAnswers(session.id),
      repository.listBoundaryDecisions(session.id),
      repository.listBoundaryRounds(session.id),
    ]);
    if (!requiredBoundaryQuestionsClosed({ questions, answers, decisions })) {
      throw new ConflictException('Boundary approval requires every required question to be answered or waived');
    }

    const plan = await this.requireDevelopmentPlan(session.development_plan_id, repository);
    const item = await this.requireDevelopmentPlanItem(session.development_plan_id, session.development_plan_item_id, repository);
    this.assertItemBoundaryNotApproved(item);
    const approvedAt = this.runtime.now();
    const approvalDecision =
      input.final_decision === undefined
        ? undefined
        : this.buildDecision({
            text: input.final_decision,
            actor_id: input.actor_id,
            actorRole,
            source: actorRole,
            state: 'accepted',
          });
    if (approvalDecision !== undefined) {
      await repository.saveBoundaryDecision({
        ...approvalDecision,
        session_id: session.id,
        sequence: decisions.length + 1,
      });
    }
    const decisionRows =
      approvalDecision === undefined
        ? decisions
        : [...decisions, { ...approvalDecision, session_id: session.id, sequence: decisions.length + 1 }];
    const questionAnswerSnapshot = this.questionAnswerSnapshot(questions, answers);
    const decisionSnapshot = this.decisionSnapshot(decisionRows);
    this.assertBoundarySummaryApprovalEvidence({
      session,
      revision,
      rounds,
      questions,
      questionAnswerSnapshot,
      decisionSnapshot,
    });
    const summary = await this.requireBoundarySummary(revision.boundary_summary_id, repository);
    const updatedItem: DevelopmentPlanItem = {
      ...item,
      revision_id: this.runtime.id('development-plan-item-revision'),
      boundary_status: 'approved',
      next_action: 'generate_spec',
      updated_at: approvedAt,
    };
    await repository.saveDevelopmentPlanItem(updatedItem);
    const itemRevision = await this.saveItemRevision(updatedItem, 'boundary_approved', input.actor_id, repository);
    const approvedRevision = {
      ...revision,
      status: 'approved',
      development_plan_item_revision_id: updatedItem.revision_id,
      question_answer_snapshot: questionAnswerSnapshot,
      decision_snapshot: decisionSnapshot,
      approved_by_actor_id: input.actor_id,
      approved_at: approvedAt,
    } as BoundarySummaryRevision;
    await repository.updateBoundarySummaryRevision(approvedRevision);
    const approvedSessionRevisionId = this.runtime.id('brainstorming-session-revision');
    await repository.saveBoundarySummary({
      ...summary,
      revision_id: revision.id,
      brainstorming_session_revision_id: approvedSessionRevisionId,
      development_plan_item_revision_id: updatedItem.revision_id,
      summary: this.boundarySummaryRevisionMarkdown(revision),
      approved_by_actor_id: input.actor_id,
      approved_at: approvedAt,
      updated_at: approvedAt,
    });

    const approvedSession: BrainstormingSession = {
      ...session,
      revision_id: approvedSessionRevisionId,
      decisions: approvalDecision === undefined ? session.decisions : [...session.decisions, approvalDecision],
      status: 'approved',
      approval_state: 'approved',
      boundary_summary_id: summary.id,
      latest_summary_revision_id: revision.id,
      approved_summary_revision_id: revision.id,
      approver_actor_id: input.actor_id,
      approved_at: approvedAt,
      closed_at: approvedAt,
      updated_at: approvedAt,
    };
    await repository.saveBrainstormingSession(approvedSession);
    const updatedPlan: DevelopmentPlan = {
      ...plan,
      revision_id: this.runtime.id('development-plan-revision'),
      updated_at: approvedAt,
    };
    await repository.saveDevelopmentPlan(updatedPlan);
    await this.saveDevelopmentPlanRevision(
      updatedPlan,
      { changeReason: 'development_plan_item_boundary_approved', actorId: input.actor_id },
      repository,
    );
    await this.appendItemEvent(
      item.id,
      'boundary_summary_approved',
      input.actor_id,
      {
        boundary_summary_id: summary.id,
        boundary_summary_revision_id: revision.id,
        development_plan_item_revision_id: itemRevision.id,
      },
      repository,
    );

    return {
      ...approvedSession,
      boundary_summary_id: summary.id,
      boundary_summary_revision_id: revision.id,
      development_plan_item_revision_id: updatedItem.revision_id,
    };
  }

  async listDevelopmentPlanItemRevisions(developmentPlanId: string, itemId: string): Promise<DevelopmentPlanItemRevision[]> {
    await this.requireDevelopmentPlanItem(developmentPlanId, itemId);
    return this.repository.listDevelopmentPlanItemRevisions(itemId);
  }

  async compareDevelopmentPlanItemRevisions(
    developmentPlanId: string,
    itemId: string,
    query: RevisionCompareQuery,
  ): Promise<StructuredRevisionDiff> {
    await this.requireDevelopmentPlanItem(developmentPlanId, itemId);
    await this.requireItemRevision(itemId, query.base_revision_id);
    await this.requireItemRevision(itemId, query.compare_revision_id);
    return this.repository.compareDevelopmentPlanItemRevisions(query);
  }

  async listBoundarySummaryRevisions(boundarySummaryId: string): Promise<BoundarySummaryRevision[]> {
    await this.requireBoundarySummary(boundarySummaryId);
    return this.repository.listBoundarySummaryRevisions(boundarySummaryId);
  }

  async compareBoundarySummaryRevisions(
    boundarySummaryId: string,
    query: RevisionCompareQuery,
  ): Promise<StructuredRevisionDiff> {
    await this.requireBoundarySummary(boundarySummaryId);
    await this.requireBoundarySummaryRevision(boundarySummaryId, query.base_revision_id);
    await this.requireBoundarySummaryRevision(boundarySummaryId, query.compare_revision_id);
    return this.repository.compareBoundarySummaryRevisions(query);
  }

  private async requireDevelopmentPlan(
    developmentPlanId: string,
    repository: DeliveryRepository = this.repository,
  ): Promise<DevelopmentPlan> {
    const plan = await repository.getDevelopmentPlan(developmentPlanId);
    if (plan === undefined) {
      throw new NotFoundException(`Development Plan ${developmentPlanId} not found`);
    }
    return plan;
  }

  private async requireDevelopmentPlanItem(
    developmentPlanId: string,
    itemId: string,
    repository: DeliveryRepository = this.repository,
  ): Promise<DevelopmentPlanItem> {
    const item = await repository.getDevelopmentPlanItem(itemId);
    if (item === undefined || item.development_plan_id !== developmentPlanId) {
      throw new NotFoundException(`Development Plan Item ${itemId} not found`);
    }
    return item;
  }

  private async requireWorkItem(workItemId: string, repository: DeliveryRepository = this.repository): Promise<WorkItem> {
    const workItem = await repository.getWorkItem(workItemId);
    if (workItem === undefined) {
      throw new NotFoundException(`Work Item ${workItemId} not found`);
    }
    return workItem;
  }

  private async requireBrainstormingSession(
    sessionId: string,
    repository: DeliveryRepository = this.repository,
  ): Promise<BrainstormingSession> {
    const session = await repository.getBrainstormingSession(sessionId);
    if (session === undefined) {
      throw new NotFoundException(`Brainstorming Session ${sessionId} not found`);
    }
    return session;
  }

  private async requireBoundarySummary(
    boundarySummaryId: string,
    repository: DeliveryRepository = this.repository,
  ): Promise<BoundarySummary> {
    const summary = await repository.getBoundarySummary(boundarySummaryId);
    if (summary === undefined) {
      throw new NotFoundException(`Boundary Summary ${boundarySummaryId} not found`);
    }
    return summary;
  }

  private async requireItemRevision(itemId: string, revisionId: string): Promise<DevelopmentPlanItemRevision> {
    const revision = (await this.repository.listDevelopmentPlanItemRevisions(itemId)).find(
      (candidate) => candidate.id === revisionId,
    );
    if (revision === undefined) {
      throw new NotFoundException(`Development Plan Item Revision ${revisionId} not found`);
    }
    return revision;
  }

  private async requireBoundarySummaryRevisionForSession(
    session: BrainstormingSession,
    revisionId: string,
    repository: DeliveryRepository,
  ): Promise<BoundarySummaryRevision> {
    if (session.boundary_summary_id === undefined) {
      throw new NotFoundException(`Boundary Summary Revision ${revisionId} not found`);
    }
    const revision = (await repository.listBoundarySummaryRevisions(session.boundary_summary_id)).find(
      (candidate) => candidate.id === revisionId,
    );
    if (revision === undefined) {
      throw new NotFoundException(`Boundary Summary Revision ${revisionId} not found`);
    }
    if (this.boundarySummaryRevisionSessionId(revision) !== session.id) {
      throw new NotFoundException(`Boundary Summary Revision ${revisionId} not found`);
    }
    return revision;
  }

  private async requireBoundarySummaryRevision(
    boundarySummaryId: string,
    revisionId: string,
  ): Promise<BoundarySummaryRevision> {
    const revision = (await this.repository.listBoundarySummaryRevisions(boundarySummaryId)).find(
      (candidate) => candidate.id === revisionId,
    );
    if (revision === undefined) {
      throw new NotFoundException(`Boundary Summary Revision ${revisionId} not found`);
    }
    return revision;
  }

  private buildContextManifest(plan: DevelopmentPlan, item: DevelopmentPlanItem): ContextManifest {
    const at = this.runtime.now();
    return {
      id: this.runtime.id('context-manifest'),
      revision_id: this.runtime.id('context-manifest-revision'),
      source_ref: item.source_ref,
      development_plan_id: plan.id,
      development_plan_revision_id: plan.revision_id,
      development_plan_item_id: item.id,
      development_plan_item_revision_id: item.revision_id,
      sources: [
        { type: 'development_plan', ref: plan.id, digest: plan.revision_id },
        { type: 'development_plan_item', ref: item.id, digest: item.revision_id },
        { type: 'prd_product_doc', ref: 'docs/PRD_v1.md' },
      ],
      generated_at: at,
      runtime_identity: 'control-plane-api:brainstorming',
      created_at: at,
      updated_at: at,
    };
  }

  private resolveLeader(input: {
    item: DevelopmentPlanItem;
    actorId: string;
    canAdministerItem?: boolean | undefined;
    requestedLeaderActorId?: string | undefined;
    requestedDelegateActorIds?: string[] | undefined;
  }): { leader_actor_id: string; leader_delegate_actor_ids: string[]; updatedItem?: DevelopmentPlanItem | undefined } {
    const existingLeader = input.item.leader_actor_id;
    const existingDelegates = input.item.leader_delegate_actor_ids ?? [];
    const requestedDelegates =
      input.requestedDelegateActorIds === undefined ? existingDelegates : this.uniqueActorIds(input.requestedDelegateActorIds);
    const canAdministerItem = input.canAdministerItem === true;
    if (
      existingLeader !== undefined &&
      input.requestedLeaderActorId !== undefined &&
      input.requestedLeaderActorId !== existingLeader &&
      !canAdministerItem
    ) {
      throw new ForbiddenException('Boundary Leader cannot be changed by this request');
    }

    const requestedLeader =
      input.requestedLeaderActorId ?? existingLeader ?? input.item.reviewer_actor_id ?? input.item.driver_actor_id;
    const actorIsRequestedLeader = requestedLeader === input.actorId;
    const canChangeDelegates = canAdministerItem || input.actorId === existingLeader || actorIsRequestedLeader;
    if (
      input.requestedDelegateActorIds !== undefined &&
      !this.sameStringSet(existingDelegates, requestedDelegates) &&
      !canChangeDelegates
    ) {
      throw new ForbiddenException('Boundary delegates cannot be changed by this request');
    }
    if (
      input.requestedDelegateActorIds?.includes(input.actorId) === true &&
      !actorIsRequestedLeader &&
      input.actorId !== existingLeader &&
      !canAdministerItem
    ) {
      throw new ForbiddenException('Boundary delegate self-escalation is not allowed');
    }
    if (requestedLeader === undefined) {
      throw new BadRequestException('Boundary Leader is required');
    }

    const leaderDelegates = requestedDelegates.filter((delegateActorId) => delegateActorId !== requestedLeader);
    const updatedItem =
      input.item.leader_actor_id === requestedLeader && this.sameStringSet(input.item.leader_delegate_actor_ids ?? [], leaderDelegates)
        ? undefined
        : {
            ...input.item,
            leader_actor_id: requestedLeader,
            leader_delegate_actor_ids: leaderDelegates,
          };
    return { leader_actor_id: requestedLeader, leader_delegate_actor_ids: leaderDelegates, updatedItem };
  }

  private boundaryActorRole(session: BrainstormingSession, actorId: string): 'leader' | 'delegate' {
    if (session.leader_actor_id === actorId) {
      return 'leader';
    }
    if (actorCanActForBoundaryLeader(session, actorId)) {
      return 'delegate';
    }
    throw new ForbiddenException('Only the Boundary Leader or delegates can change this Boundary Brainstorming session');
  }

  private async createBoundaryRound(input: {
    session: BrainstormingSession;
    plan: DevelopmentPlan;
    item: DevelopmentPlanItem;
    trigger: BoundaryRoundRecord['trigger'];
    operation: 'start' | 'continue' | 'revise_summary';
    requestedByActorId: string;
    leaderInputMarkdown?: string | undefined;
    context?: WorkflowChildContext | undefined;
    repository: DeliveryRepository;
  }): Promise<BrainstormingSession> {
    const now = this.runtime.now();
    const round: BoundaryRoundRecord = {
      id: this.runtime.id('boundary-round'),
      session_id: input.session.id,
      session_revision_id: input.session.revision_id,
      round_number: (await input.repository.listBoundaryRounds(input.session.id)).length + 1,
      trigger: input.trigger,
      ...(input.leaderInputMarkdown === undefined ? {} : { leader_input_markdown: input.leaderInputMarkdown }),
      ...(input.context?.codex_session_turn_id === undefined ? {} : { codex_session_turn_id: input.context.codex_session_turn_id }),
      status: 'queued',
      created_at: now,
      updated_at: now,
    };
    await input.repository.saveBoundaryRound(round);
    const workItem = await this.requireWorkItem(input.item.source_ref.id, input.repository);
    const actionRunInput = this.boundaryActionRunInput({
      session: input.session,
      plan: input.plan,
      item: input.item,
      workItem,
      round,
      operation: input.operation,
      requestedByActorId: input.requestedByActorId,
      now,
      context: input.context,
    });
    const contextManifest = await input.repository.getContextManifest(input.session.context_manifest_id);
    if (contextManifest === undefined) {
      throw new NotFoundException(`Context Manifest ${input.session.context_manifest_id} not found`);
    }
    const [rounds, questions, answers, decisions, summaryRevisions] = await Promise.all([
      input.repository.listBoundaryRounds(input.session.id),
      input.repository.listBoundaryQuestions(input.session.id),
      input.repository.listBoundaryAnswers(input.session.id),
      input.repository.listBoundaryDecisions(input.session.id),
      input.session.boundary_summary_id === undefined
        ? Promise.resolve([])
        : input.repository.listBoundarySummaryRevisions(input.session.boundary_summary_id),
    ]);
    const scheduled = await this.productRuntimeScheduler.schedule({
      repository: input.repository,
      action_run: actionRunInput,
      task_kind: 'boundary_brainstorming_round',
      prompt_version: 'boundary-brainstorming-round:v1',
      output_schema_version: 'boundary_round_result.v1',
      context_manifest: contextManifest,
      signed_context_json: this.boundaryRoundSignedContext({
        session: input.session,
        plan: input.plan,
        item: input.item,
        workItem,
        round,
        operation: input.operation,
        requestedByActorId: input.requestedByActorId,
        leaderInputMarkdown: input.leaderInputMarkdown,
        contextManifest,
        rounds,
        questions,
        answers,
        decisions,
        summaryRevisions,
      }),
      project_id: input.plan.project_id,
      repo_ids: [],
      context: input.context,
    });
    await input.repository.saveBoundaryRound({
      ...round,
      runtime_job_id: scheduled.runtime_job.id,
      status: 'queued',
      updated_at: this.runtime.now(),
    });
    const updatedSession: BrainstormingSession = {
      ...input.session,
      revision_id: this.runtime.id('brainstorming-session-revision'),
      status: 'ai_turn_running',
      current_round_id: round.id,
      approval_state: input.session.approval_state === 'draft' ? 'draft' : input.session.approval_state,
      updated_at: this.runtime.now(),
    };
    await input.repository.saveBrainstormingSession(updatedSession);
    return updatedSession;
  }

  private boundaryActionRunInput(input: {
    session: BrainstormingSession;
    plan: DevelopmentPlan;
    item: DevelopmentPlanItem;
    workItem: WorkItem;
    round: BoundaryRoundRecord;
    operation: 'start' | 'continue' | 'revise_summary';
    requestedByActorId: string;
    now: string;
    context?: WorkflowChildContext | undefined;
  }): CreateOrReplayAutomationActionRunInput {
    const context = input.context ?? this.contextFromSession(input.session);
    const preconditionFingerprintJson = {
      source_ref: input.item.source_ref,
      source_revision_id: input.workItem.updated_at,
      development_plan_id: input.plan.id,
      development_plan_revision_id: input.plan.revision_id,
      development_plan_item_id: input.item.id,
      development_plan_item_revision_id: input.item.revision_id,
      boundary_session_id: input.session.id,
      boundary_session_revision_id: input.session.revision_id,
      boundary_round_id: input.round.id,
      context_manifest_id: input.session.context_manifest_id,
      context_manifest_revision_id: input.session.context_manifest_revision_id,
      requested_by_actor_id: input.requestedByActorId,
    };
    const actionInputJson = {
      development_plan_id: input.plan.id,
      development_plan_revision_id: input.plan.revision_id,
      development_plan_item_id: input.item.id,
      development_plan_item_revision_id: input.item.revision_id,
      session_id: input.session.id,
      session_revision_id: input.session.revision_id,
      round_id: input.round.id,
      operation: input.operation,
      context_manifest_id: input.session.context_manifest_id,
      context_manifest_revision_id: input.session.context_manifest_revision_id,
      requested_by_actor_id: input.requestedByActorId,
      precondition_fingerprint_json: preconditionFingerprintJson,
      ...(context?.plan_item_workflow_action_id === undefined
        ? {}
        : { plan_item_workflow_action_id: context.plan_item_workflow_action_id }),
    };
    const projectId = input.plan.project_id;
    return {
      id: this.runtime.id('automation-action-run'),
      action_type: 'run_boundary_brainstorming_round',
      target_object_type: 'boundary_round',
      target_object_id: input.round.id,
      target_revision_id: input.item.revision_id,
      target_status: 'queued',
      idempotency_key:
        context?.plan_item_workflow_action_id === undefined
          ? `boundary-round:${input.round.id}:${input.session.revision_id}`
          : `boundary-round:${input.round.id}:${input.session.revision_id}:${context.plan_item_workflow_action_id}`,
      automation_scope: `project:${projectId}` as const,
      automation_settings_version: 1,
      capability_fingerprint: 'boundary-brainstorming-runtime:v1',
      precondition_fingerprint: codexCanonicalDigest(preconditionFingerprintJson),
      action_input_json: actionInputJson,
      ...(context === undefined ? {} : { workflow_id: context.workflow_id, codex_session_id: context.codex_session_id }),
      ...(context?.codex_session_turn_id === undefined ? {} : { codex_session_turn_id: context.codex_session_turn_id }),
      now: input.now,
    };
  }

  private contextFromSession(session: BrainstormingSession): WorkflowChildContext | undefined {
    if (session.workflow_id === undefined || session.codex_session_id === undefined) return undefined;
    return { workflow_id: session.workflow_id, codex_session_id: session.codex_session_id };
  }

  private async assertLegacyItemMutationAllowed(
    repository: DeliveryRepository,
    itemId: string,
    context?: WorkflowChildContext | undefined,
  ): Promise<void> {
    const activeWorkflow = await repository.getActivePlanItemWorkflowByItem(itemId);
    if (activeWorkflow !== undefined && context !== undefined) {
      await this.assertWorkflowContextAllowed(repository, itemId, context, activeWorkflow.id);
      return;
    }
    throw new DomainError(
      'workflow_legacy_entrypoint_disabled',
      `workflow_legacy_entrypoint_disabled: Development Plan Item ${itemId} must mutate Superpowers state through PlanItemWorkflowService`,
    );
  }

  private async assertLegacySessionMutationAllowed(
    _repository: DeliveryRepository,
    session: BrainstormingSession,
  ): Promise<void> {
    throw new DomainError(
      'workflow_legacy_entrypoint_disabled',
      `workflow_legacy_entrypoint_disabled: Brainstorming Session ${session.id} must mutate through PlanItemWorkflowService`,
    );
  }

  private async assertSessionMutationAllowed(
    repository: DeliveryRepository,
    session: BrainstormingSession,
    context?: WorkflowChildContext | undefined,
  ): Promise<void> {
    if (context === undefined) {
      await this.assertLegacySessionMutationAllowed(repository, session);
      return;
    }
    await this.assertWorkflowSessionContextAllowed(repository, session, context);
  }

  private async assertRuntimeWorkflowContextMatchesSession(
    repository: DeliveryRepository,
    session: BrainstormingSession,
    actionRun: AutomationActionRun,
  ): Promise<void> {
    if (session.workflow_id === undefined) {
      return;
    }
    if (
      actionRun.workflow_id === session.workflow_id &&
      actionRun.codex_session_id === session.codex_session_id &&
      actionRun.codex_session_turn_id !== undefined
    ) {
      const turn = await repository.getCodexSessionTurn(actionRun.codex_session_turn_id);
      if (turn?.workflow_id === session.workflow_id && turn.codex_session_id === session.codex_session_id) {
        return;
      }
    }
    throw new DomainError(
      'workflow_legacy_entrypoint_disabled',
      `workflow_legacy_entrypoint_disabled: Runtime result for Brainstorming Session ${session.id} must carry matching PlanItemWorkflow turn context`,
    );
  }

  private async assertWorkflowContextAllowed(
    repository: DeliveryRepository,
    itemId: string,
    context: WorkflowChildContext,
    expectedWorkflowId: string,
  ): Promise<void> {
    const activeWorkflow = await repository.getActivePlanItemWorkflowByItem(itemId);
    if (
      activeWorkflow !== undefined &&
      activeWorkflow.id === expectedWorkflowId &&
      activeWorkflow.id === context.workflow_id &&
      activeWorkflow.active_codex_session_id === context.codex_session_id &&
      context.codex_session_turn_id !== undefined
    ) {
      const turn = await repository.getCodexSessionTurn(context.codex_session_turn_id);
      if (turn?.workflow_id === context.workflow_id && turn.codex_session_id === context.codex_session_id) {
        return;
      }
    }
    throw new DomainError(
      'workflow_legacy_entrypoint_disabled',
      `workflow_legacy_entrypoint_disabled: Development Plan Item ${itemId} must carry matching PlanItemWorkflow turn context`,
    );
  }

  private async assertWorkflowSessionContextAllowed(
    repository: DeliveryRepository,
    session: BrainstormingSession,
    context: WorkflowChildContext,
  ): Promise<void> {
    if (
      session.workflow_id === context.workflow_id &&
      session.codex_session_id === context.codex_session_id &&
      context.codex_session_turn_id !== undefined
    ) {
      await this.assertWorkflowContextAllowed(repository, session.development_plan_item_id, context, session.workflow_id);
      return;
    }
    throw new DomainError(
      'workflow_legacy_entrypoint_disabled',
      `workflow_legacy_entrypoint_disabled: Brainstorming Session ${session.id} must carry matching PlanItemWorkflow turn context`,
    );
  }

  private boundaryRoundSignedContext(input: {
    session: BrainstormingSession;
    plan: DevelopmentPlan;
    item: DevelopmentPlanItem;
    workItem: WorkItem;
    round: BoundaryRoundRecord;
    operation: 'start' | 'continue' | 'revise_summary';
    requestedByActorId: string;
    leaderInputMarkdown?: string | undefined;
    contextManifest: ContextManifest;
    rounds: readonly BoundaryRoundRecord[];
    questions: readonly BoundaryQuestionRecord[];
    answers: readonly BoundaryAnswerRecord[];
    decisions: readonly BoundaryDecisionRecord[];
    summaryRevisions: readonly BoundarySummaryRevision[];
  }): Record<string, unknown> {
    return {
      schema_version: 'boundary_brainstorming_round.context.v1',
      task_kind: 'boundary_brainstorming_round',
      operation: input.operation,
      development_plan: {
        id: input.plan.id,
        revision_id: input.plan.revision_id,
        title: this.runtimeSafeText(input.plan.title),
      },
      development_plan_item: {
        id: input.item.id,
        revision_id: input.item.revision_id,
        title: this.runtimeSafeText(input.item.title),
        summary: this.runtimeSafeText(input.item.summary),
      },
      planning_input: {
        ref: input.item.source_ref,
        revision_id: input.workItem.updated_at,
        title: this.runtimeSafeText(input.workItem.title),
        goal: this.runtimeSafeText(input.workItem.goal),
      },
      boundary_session: {
        id: input.session.id,
        revision_id: input.session.revision_id,
        leader_actor_id: input.session.leader_actor_id,
        delegate_count: input.session.leader_delegate_actor_ids.length,
      },
      boundary_round: {
        id: input.round.id,
        session_revision_id: input.round.session_revision_id,
        round_number: input.round.round_number,
        trigger: input.round.trigger,
      },
      boundary_history: {
        rounds: input.rounds.map((round) => ({
          id: round.id,
          round_number: round.round_number,
          trigger: round.trigger,
          status: round.status,
          session_revision_id: round.session_revision_id,
          ...(round.leader_input_markdown === undefined ? {} : { leader_input: { summary: this.runtimeSafeText(round.leader_input_markdown) } }),
        })),
        questions: input.questions.map((question) => ({
          id: question.id,
          ...(question.round_id === undefined ? {} : { round_id: question.round_id }),
          summary: this.runtimeSafeText(question.text),
          status: question.status,
          required: question.required,
          ...(question.answered_by_answer_id === undefined ? {} : { answered_by_answer_id: question.answered_by_answer_id }),
          ...(question.waived_by_decision_id === undefined ? {} : { waived_by_decision_id: question.waived_by_decision_id }),
          ...(question.rationale === undefined ? {} : { rationale: { summary: this.runtimeSafeText(question.rationale) } }),
        })),
        answers: input.answers.map((answer) => ({
          id: answer.id,
          question_id: answer.question_id,
          ...(answer.round_id === undefined ? {} : { round_id: answer.round_id }),
          summary: this.runtimeSafeText(answer.text),
          actor_role: answer.actor_role,
        })),
        decisions: input.decisions.map((decision) => ({
          id: decision.id,
          ...(decision.round_id === undefined ? {} : { round_id: decision.round_id }),
          summary: this.runtimeSafeText(decision.text),
          ...(decision.actor_role === undefined ? {} : { actor_role: decision.actor_role }),
          ...(decision.source === undefined ? {} : { source: decision.source }),
          ...(decision.state === undefined ? {} : { state: decision.state }),
          ...(decision.rationale === undefined ? {} : { rationale: { summary: this.runtimeSafeText(decision.rationale) } }),
        })),
        summary_revisions: input.summaryRevisions.map((revision) => ({
          id: revision.id,
          status: this.boundarySummaryRevisionStatus(revision),
          summary: this.runtimeSafeText(this.boundarySummaryRevisionMarkdown(revision)),
          question_answer_snapshot: this.boundarySummaryRevisionQuestionAnswerSnapshot(revision).map((entry) => ({
            question_id: entry.question_id,
            answer_id: entry.answer_id,
            summary: this.runtimeSafeText(entry.text),
          })),
          decision_snapshot: this.boundarySummaryRevisionDecisionSnapshot(revision).map((entry) => ({
            decision_id: entry.decision_id,
            summary: this.runtimeSafeText(entry.text),
            ...(entry.rationale === undefined ? {} : { rationale: { summary: this.runtimeSafeText(entry.rationale) } }),
          })),
        })),
      },
      ...(input.leaderInputMarkdown === undefined
        ? {}
        : { leader_input: { summary: this.runtimeSafeText(input.leaderInputMarkdown) } }),
      context_manifest: {
        id: input.contextManifest.id,
        revision_id: input.contextManifest.revision_id,
        sources: input.contextManifest.sources.map((source, index) => ({
          type: 'context-source',
          ref: `context-source-${index + 1}`,
          digest: codexCanonicalDigest(source),
        })),
      },
      requested_by_actor_id: input.requestedByActorId,
    };
  }

  private async createProposedBoundarySummaryRevision(input: {
    session: BrainstormingSession;
    round: BoundaryRoundRecord;
    proposal: NonNullable<BoundaryRoundTerminalResultInput['summary_proposal']>;
    questions: BoundaryQuestion[];
    answers: BoundaryAnswer[];
    decisions: BoundaryDecision[];
    repository: DeliveryRepository;
    now: string;
  }): Promise<BoundarySummaryRevision> {
    const boundarySummaryId = input.session.boundary_summary_id ?? this.runtime.id('boundary-summary');
    const revisions = await input.repository.listBoundarySummaryRevisions(boundarySummaryId);
    const revisionId = this.runtime.id('boundary-summary-revision');
    const summary = await input.repository.getBoundarySummary(boundarySummaryId);
    if (summary === undefined) {
      await input.repository.saveBoundarySummary({
        id: boundarySummaryId,
        revision_id: revisionId,
        brainstorming_session_id: input.session.id,
        brainstorming_session_revision_id: input.session.revision_id,
        development_plan_id: input.session.development_plan_id,
        development_plan_item_id: input.session.development_plan_item_id,
        development_plan_item_revision_id: input.session.development_plan_item_revision_id,
        source_ref: input.session.source_ref,
        summary: input.proposal.summary_markdown,
        created_at: input.now,
        updated_at: input.now,
      });
    }
    const revision: BoundarySummaryRevision = {
      id: revisionId,
      boundary_summary_id: boundarySummaryId,
      session_id: input.session.id,
      session_revision_id: input.session.revision_id,
      source_round_id: input.round.id,
      development_plan_id: input.session.development_plan_id,
      development_plan_item_id: input.session.development_plan_item_id,
      development_plan_item_revision_id: input.session.development_plan_item_revision_id,
      revision_number: revisions.length + 1,
      status: 'proposed',
      summary_markdown: input.proposal.summary_markdown,
      confirmed_scope: input.proposal.confirmed_scope,
      confirmed_out_of_scope: input.proposal.confirmed_out_of_scope,
      accepted_assumptions: input.proposal.accepted_assumptions,
      open_risks: input.proposal.open_risks,
      validation_expectations: input.proposal.validation_expectations,
      question_answer_snapshot: this.questionAnswerSnapshot(input.questions, input.answers),
      decision_snapshot: this.decisionSnapshot(input.decisions),
      context_manifest_id: input.session.context_manifest_id,
      context_manifest_revision_id: input.session.context_manifest_revision_id,
      ...(input.session.workflow_id === undefined ? {} : { workflow_id: input.session.workflow_id }),
      ...(input.session.codex_session_id === undefined ? {} : { codex_session_id: input.session.codex_session_id }),
      ...(input.round.codex_session_turn_id === undefined ? {} : { codex_session_turn_id: input.round.codex_session_turn_id }),
      created_at: input.now,
    };
    await input.repository.saveBoundarySummaryRevision(revision);
    return revision;
  }

  private buildDecision(
    input: RecordDecisionInput & {
      actorRole?: BrainstormingDecision['actor_role'] | undefined;
      source?: BrainstormingDecision['source'] | undefined;
      state?: BrainstormingDecision['state'] | undefined;
      roundId?: string | undefined;
    },
  ): BrainstormingDecision {
    return {
      id: this.runtime.id('brainstorming-decision'),
      ...(input.roundId === undefined ? {} : { round_id: input.roundId }),
      text: input.text,
      actor_id: input.actor_id,
      ...(input.actorRole === undefined ? {} : { actor_role: input.actorRole }),
      source: input.source ?? 'leader',
      state: input.state ?? 'accepted',
      ...(input.rationale === undefined ? {} : { rationale: input.rationale }),
      created_at: this.runtime.now(),
    };
  }

  private async saveSessionQuestions(
    sessionId: string,
    questions: BrainstormingSession['questions'],
    repository: DeliveryRepository,
  ): Promise<void> {
    let sequence = 0;
    for (const question of questions) {
      sequence += 1;
      await repository.saveBoundaryQuestion({ ...question, session_id: sessionId, sequence });
    }
  }

  private questionSequence(questions: BrainstormingSession['questions'], questionId: string): number {
    const index = questions.findIndex((question) => question.id === questionId);
    return index < 0 ? questions.length + 1 : index + 1;
  }

  private questionAnswerSnapshot(
    questions: Array<Pick<BoundaryQuestion, 'id' | 'text'>>,
    answers: Array<Pick<BoundaryAnswer, 'id' | 'question_id'>>,
  ): Array<{ question_id: string; answer_id: string; text: string }> {
    const questionTextById = new Map(questions.map((question) => [question.id, question.text]));
    return answers.flatMap((answer) => {
      const questionText = questionTextById.get(answer.question_id);
      return questionText === undefined ? [] : [{ question_id: answer.question_id, answer_id: answer.id, text: questionText }];
    });
  }

  private decisionSnapshot(
    decisions: Array<Pick<BoundaryDecision, 'id' | 'text' | 'rationale'>>,
  ): Array<{ decision_id: string; text: string; rationale?: string }> {
    return decisions.map((decision) => ({
      decision_id: decision.id,
      text: decision.text,
      ...(decision.rationale === undefined ? {} : { rationale: decision.rationale }),
    }));
  }

  private assertBoundarySummaryApprovalEvidence(input: {
    session: BrainstormingSession;
    revision: BoundarySummaryRevision;
    rounds: BoundaryRoundRecord[];
    questions: BoundaryQuestionRecord[];
    questionAnswerSnapshot: Array<{ question_id: string; answer_id: string; text: string }>;
    decisionSnapshot: Array<{ decision_id: string; text: string; rationale?: string }>;
  }): void {
    const revisionRecord = input.revision as BoundarySummaryRevision & {
      source_round_id?: unknown;
      context_manifest_id?: unknown;
      context_manifest_revision_id?: unknown;
    };
    const sourceRoundId = revisionRecord.source_round_id;
    if (
      typeof sourceRoundId !== 'string' ||
      !input.rounds.some((round) => round.id === sourceRoundId) ||
      revisionRecord.context_manifest_id !== input.session.context_manifest_id ||
      revisionRecord.context_manifest_revision_id !== input.session.context_manifest_revision_id
    ) {
      throw new ConflictException('Boundary Summary approval requires round-backed context evidence');
    }
    const hasWaivedRequiredQuestionEvidence = input.questions.some(
      (question) => question.required && question.status !== 'superseded' && question.waived_by_decision_id !== undefined,
    );
    if ((!hasWaivedRequiredQuestionEvidence && input.questionAnswerSnapshot.length === 0) || input.decisionSnapshot.length === 0) {
      throw new ConflictException('Boundary Summary approval requires question and decision evidence');
    }
  }

  private boundarySummaryRevisionStatus(revision: BoundarySummaryRevision): string {
    return 'status' in revision && typeof revision.status === 'string'
      ? revision.status
      : revision.approved_at === undefined
        ? 'proposed'
        : 'approved';
  }

  private boundarySummaryRevisionSessionId(revision: BoundarySummaryRevision): string | undefined {
    const record = revision as BoundarySummaryRevision & { session_id?: string; brainstorming_session_id?: string };
    return record.session_id ?? record.brainstorming_session_id;
  }

  private boundarySummaryRevisionMarkdown(revision: BoundarySummaryRevision): string {
    return 'summary_markdown' in revision ? revision.summary_markdown : '';
  }

  private boundarySummaryRevisionQuestionAnswerSnapshot(
    revision: BoundarySummaryRevision,
  ): Array<{ question_id: string; answer_id: string; text: string }> {
    const value = (revision as BoundarySummaryRevision & { question_answer_snapshot?: unknown }).question_answer_snapshot;
    if (!Array.isArray(value)) {
      return [];
    }
    return value.flatMap((entry) => {
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
        return [];
      }
      const record = entry as Record<string, unknown>;
      return typeof record.question_id === 'string' &&
        typeof record.answer_id === 'string' &&
        typeof record.text === 'string'
        ? [{ question_id: record.question_id, answer_id: record.answer_id, text: record.text }]
        : [];
    });
  }

  private boundarySummaryRevisionDecisionSnapshot(
    revision: BoundarySummaryRevision,
  ): Array<{ decision_id: string; text: string; rationale?: string }> {
    const value = (revision as BoundarySummaryRevision & { decision_snapshot?: unknown }).decision_snapshot;
    if (!Array.isArray(value)) {
      return [];
    }
    return value.flatMap((entry) => {
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
        return [];
      }
      const record = entry as Record<string, unknown>;
      const decisionId = typeof record.decision_id === 'string' ? record.decision_id : record.id;
      return typeof decisionId === 'string' && typeof record.text === 'string'
        ? [
            {
              decision_id: decisionId,
              text: record.text,
              ...(typeof record.rationale === 'string' ? { rationale: record.rationale } : {}),
            },
          ]
        : [];
    });
  }

  private runtimeSafeText(value: string): string {
    return value.replace(runtimeSensitiveTextPattern, '[runtime-redacted]');
  }

  private uniqueActorIds(actorIds: string[]): string[] {
    return [...new Set(actorIds)];
  }

  private sameStringSet(left: string[], right: string[]): boolean {
    if (left.length !== right.length) {
      return false;
    }
    const rightSet = new Set(right);
    return left.every((value) => rightSet.has(value));
  }

  private assertSessionMutable(session: BrainstormingSession): void {
    if (session.approval_state === 'approved' || session.status === 'approved') {
      throw new BadRequestException(`Brainstorming Session ${session.id} is already approved`);
    }
  }

  private assertItemBoundaryNotApproved(item: DevelopmentPlanItem): void {
    if (item.boundary_status === 'approved') {
      throw new ConflictException(`Development Plan Item ${item.id} boundary is already approved`);
    }
  }

  private nextApprovalState(
    questions: BrainstormingSession['questions'],
    answers: BrainstormingSession['answers'],
    decisions: BrainstormingSession['decisions'],
  ): BrainstormingSession['approval_state'] {
    const answeredQuestionIds = new Set(answers.map((answer) => answer.question_id));
    return questions.every((question) => answeredQuestionIds.has(question.id) || question.waived_by_decision_id !== undefined) &&
      decisions.length > 0
      ? 'ready_for_approval'
      : 'questions_open';
  }

  private async saveItemRevision(
    item: DevelopmentPlanItem,
    changeReason: string,
    actorId: string,
    repository: DeliveryRepository,
  ): Promise<DevelopmentPlanItemRevision> {
    const revisions = await repository.listDevelopmentPlanItemRevisions(item.id);
    const revision: DevelopmentPlanItemRevision = {
      id: item.revision_id,
      development_plan_item_id: item.id,
      development_plan_id: item.development_plan_id,
      revision_number: revisions.length + 1,
      snapshot: item,
      change_reason: changeReason,
      edited_by_actor_id: actorId,
      created_at: this.runtime.now(),
    };
    await repository.saveDevelopmentPlanItemRevision(revision);
    return revision;
  }

  private async saveDevelopmentPlanRevision(
    plan: DevelopmentPlan,
    input: { changeReason: string; actorId?: string | undefined },
    repository: DeliveryRepository,
  ): Promise<DevelopmentPlanRevision> {
    const [revisions, items] = await Promise.all([
      repository.listDevelopmentPlanRevisions(plan.id),
      repository.listDevelopmentPlanItems(plan.id),
    ]);
    const revision: DevelopmentPlanRevision = {
      id: plan.revision_id,
      development_plan_id: plan.id,
      revision_number: revisions.length + 1,
      title: plan.title,
      status: plan.status,
      source_refs: plan.source_refs,
      item_refs: items.map((item) => ({
        id: item.id,
        revision_id: item.revision_id,
        title: item.title,
        boundary_status: item.boundary_status,
        spec_status: item.spec_status,
        implementation_plan_status: item.implementation_plan_status,
        execution_status: item.execution_status,
      })),
      change_reason: input.changeReason,
      ...(input.actorId === undefined ? {} : { actor_id: input.actorId }),
      created_at: this.runtime.now(),
    };
    await repository.saveDevelopmentPlanRevision(revision);
    return revision;
  }

  private appendItemEvent(
    itemId: string,
    eventType: string,
    actorId: string,
    metadata: Record<string, unknown>,
    repository: DeliveryRepository = this.repository,
  ): Promise<void> {
    return this.audit.objectEvent(
      {
        id: this.runtime.id('object-event'),
        object_type: 'development_plan_item',
        object_id: itemId,
        event_type: eventType,
        actor_id: actorId,
        metadata,
        created_at: this.runtime.now(),
      },
      repository,
    );
  }
}
