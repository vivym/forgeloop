import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { BrainstormingAnswer, BrainstormingDecision } from '@forgeloop/contracts';
import type { DeliveryRepository } from '@forgeloop/db';
import type {
  BoundarySummary,
  BoundarySummaryRevision,
  BrainstormingSession,
  ContextManifest,
  DevelopmentPlan,
  DevelopmentPlanItem,
  DevelopmentPlanItemRevision,
  DevelopmentPlanRevision,
  RevisionCompareQuery,
  StructuredRevisionDiff,
} from '@forgeloop/domain';

import { AuditWriterService } from '../audit/audit-writer.service';
import { ControlPlaneRuntimeService } from '../core/control-plane-runtime.service';
import { DELIVERY_REPOSITORY } from '../core/control-plane-tokens';

type StartSessionInput = {
  development_plan_id: string;
  item_id: string;
  actor_id: string;
};

type AnswerQuestionInput = {
  question_id: string;
  text: string;
  actor_id: string;
};

type RecordDecisionInput = {
  text: string;
  rationale?: string | undefined;
  actor_id: string;
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

@Injectable()
export class BrainstormingService {
  constructor(
    @Inject(DELIVERY_REPOSITORY) private readonly repository: DeliveryRepository,
    @Inject(ControlPlaneRuntimeService) private readonly runtime: ControlPlaneRuntimeService,
    @Inject(AuditWriterService) private readonly audit: AuditWriterService,
  ) {}

  async startSession(input: StartSessionInput): Promise<BrainstormingSession> {
    return this.repository.withObjectLock(`development-plan:${input.development_plan_id}`, async (planLockedRepository) =>
      planLockedRepository.withDeliveryTransaction(async (repository) => {
        const plan = await this.requireDevelopmentPlan(input.development_plan_id, repository);
        const item = await this.requireDevelopmentPlanItem(input.development_plan_id, input.item_id, repository);
        const contextManifest = this.buildContextManifest(plan, item);
        await repository.saveContextManifest(contextManifest);

        const at = this.runtime.now();
        const session: BrainstormingSession = {
          id: this.runtime.id('brainstorming-session'),
          revision_id: this.runtime.id('brainstorming-session-revision'),
          source_ref: item.source_ref,
          development_plan_id: plan.id,
          development_plan_item_id: item.id,
          development_plan_item_revision_id: item.revision_id,
          context_manifest_id: contextManifest.id,
          context_manifest_revision_id: contextManifest.revision_id,
          questions: defaultBoundaryQuestions.map((text) => ({
            id: this.runtime.id('brainstorming-question'),
            text,
            author_id: 'system',
            created_at: at,
            status: 'open',
          })),
          answers: [],
          decisions: [],
          approval_state: 'questions_open',
          created_at: at,
          updated_at: at,
        };
        await repository.saveBrainstormingSession(session);
        await this.appendItemEvent(
          item.id,
          'brainstorming_session_started',
          input.actor_id,
          {
            brainstorming_session_id: session.id,
          },
          repository,
        );
        return session;
      }),
    );
  }

  async answerQuestion(sessionId: string, input: AnswerQuestionInput): Promise<BrainstormingAnswer> {
    return this.repository.withObjectLock(`brainstorming-session:${sessionId}`, async (repository) => {
      const session = await this.requireBrainstormingSession(sessionId, repository);
      this.assertSessionMutable(session);
      if (!session.questions.some((question) => question.id === input.question_id)) {
        throw new BadRequestException(`Question ${input.question_id} does not belong to Brainstorming Session ${sessionId}`);
      }
      const answer: BrainstormingAnswer = {
        id: this.runtime.id('brainstorming-answer'),
        question_id: input.question_id,
        text: input.text,
        actor_id: input.actor_id,
        created_at: this.runtime.now(),
      };
      const updated: BrainstormingSession = {
        ...session,
        revision_id: this.runtime.id('brainstorming-session-revision'),
        questions: session.questions.map((question) =>
          question.id === input.question_id ? { ...question, status: 'answered' } : question,
        ),
        answers: [...session.answers, answer],
        approval_state: this.nextApprovalState(session.questions, [...session.answers, answer], session.decisions),
        updated_at: this.runtime.now(),
      };
      await repository.saveBrainstormingSession(updated);
      return answer;
    });
  }

  async recordDecision(sessionId: string, input: RecordDecisionInput): Promise<BrainstormingDecision> {
    return this.repository.withObjectLock(`brainstorming-session:${sessionId}`, async (repository) => {
      const session = await this.requireBrainstormingSession(sessionId, repository);
      this.assertSessionMutable(session);
      const decision = this.buildDecision(input);
      const updated: BrainstormingSession = {
        ...session,
        revision_id: this.runtime.id('brainstorming-session-revision'),
        decisions: [...session.decisions, decision],
        approval_state: this.nextApprovalState(session.questions, session.answers, [...session.decisions, decision]),
        updated_at: this.runtime.now(),
      };
      await repository.saveBrainstormingSession(updated);
      return decision;
    });
  }

  async approveBoundary(sessionId: string, input: ApproveBoundaryInput): Promise<Record<string, unknown>> {
    const sessionHint = await this.requireBrainstormingSession(sessionId);
    return this.repository.withObjectLock(`development-plan:${sessionHint.development_plan_id}`, async (planLockedRepository) =>
      planLockedRepository.withObjectLock(`brainstorming-session:${sessionId}`, async (sessionLockedRepository) =>
        sessionLockedRepository.withDeliveryTransaction(async (repository) => {
          const session = await this.requireBrainstormingSession(sessionId, repository);
          this.assertSessionMutable(session);
          if (!this.allQuestionsAnswered(session)) {
            throw new ConflictException('Boundary approval requires an answer for every brainstorming question');
          }
          if (session.decisions.length === 0) {
            throw new ConflictException('Boundary approval requires at least one recorded prior decision');
          }

          const plan = await this.requireDevelopmentPlan(session.development_plan_id, repository);
          const item = await this.requireDevelopmentPlanItem(session.development_plan_id, session.development_plan_item_id, repository);
          const approvedAt = this.runtime.now();
          const boundarySummaryId = this.runtime.id('boundary-summary');
          const boundarySummaryRevisionId = this.runtime.id('boundary-summary-revision');
          const approvedSessionRevisionId = this.runtime.id('brainstorming-session-revision');
          const decisions =
            input.final_decision === undefined
              ? session.decisions
              : [...session.decisions, this.buildDecision({ text: input.final_decision, actor_id: input.actor_id })];

          const updatedItem: DevelopmentPlanItem = {
            ...item,
            revision_id: this.runtime.id('development-plan-item-revision'),
            boundary_status: 'approved',
            next_action: 'generate_spec',
            updated_at: approvedAt,
          };
          await repository.saveDevelopmentPlanItem(updatedItem);
          const itemRevision = await this.saveItemRevision(updatedItem, 'boundary_approved', input.actor_id, repository);

          const summary: BoundarySummary = {
            id: boundarySummaryId,
            revision_id: boundarySummaryRevisionId,
            brainstorming_session_id: session.id,
            brainstorming_session_revision_id: approvedSessionRevisionId,
            development_plan_id: plan.id,
            development_plan_item_id: item.id,
            development_plan_item_revision_id: updatedItem.revision_id,
            source_ref: item.source_ref,
            summary: this.boundarySummaryMarkdown(input),
            approved_by_actor_id: input.actor_id,
            approved_at: approvedAt,
            created_at: approvedAt,
            updated_at: approvedAt,
          };
          await repository.saveBoundarySummary(summary);

          const boundaryRevision: BoundarySummaryRevision = {
            id: summary.revision_id,
            boundary_summary_id: summary.id,
            brainstorming_session_id: session.id,
            brainstorming_session_revision_id: approvedSessionRevisionId,
            development_plan_item_id: item.id,
            development_plan_item_revision_id: updatedItem.revision_id,
            revision_number: 1,
            summary_markdown: summary.summary,
            decision_snapshot: decisions,
            decision_count: decisions.length,
            approved_by_actor_id: input.actor_id,
            approved_at: approvedAt,
            created_at: approvedAt,
          };
          await repository.saveBoundarySummaryRevision(boundaryRevision);

          const approvedSession: BrainstormingSession = {
            ...session,
            revision_id: approvedSessionRevisionId,
            decisions,
            approval_state: 'approved',
            boundary_summary_id: summary.id,
            approver_actor_id: input.actor_id,
            approved_at: approvedAt,
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
          await this.appendItemEvent(item.id, 'boundary_summary_approved', input.actor_id, {
            boundary_summary_id: summary.id,
            development_plan_item_revision_id: itemRevision.id,
          }, repository);

          return {
            ...approvedSession,
            boundary_summary_id: summary.id,
            development_plan_item_revision_id: updatedItem.revision_id,
          };
        }),
      ),
    );
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

  private async requireBoundarySummary(boundarySummaryId: string): Promise<BoundarySummary> {
    const summary = await this.repository.getBoundarySummary(boundarySummaryId);
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

  private buildDecision(input: RecordDecisionInput): BrainstormingDecision {
    return {
      id: this.runtime.id('brainstorming-decision'),
      text: input.text,
      actor_id: input.actor_id,
      ...(input.rationale === undefined ? {} : { rationale: input.rationale }),
      created_at: this.runtime.now(),
    };
  }

  private assertSessionMutable(session: BrainstormingSession): void {
    if (session.approval_state === 'approved') {
      throw new BadRequestException(`Brainstorming Session ${session.id} is already approved`);
    }
  }

  private nextApprovalState(
    questions: BrainstormingSession['questions'],
    answers: BrainstormingSession['answers'],
    decisions: BrainstormingSession['decisions'],
  ): BrainstormingSession['approval_state'] {
    const answeredQuestionIds = new Set(answers.map((answer) => answer.question_id));
    return questions.every((question) => answeredQuestionIds.has(question.id)) && decisions.length > 0
      ? 'ready_for_approval'
      : 'questions_open';
  }

  private allQuestionsAnswered(session: BrainstormingSession): boolean {
    const answeredQuestionIds = new Set(session.answers.map((answer) => answer.question_id));
    return session.questions.every((question) => answeredQuestionIds.has(question.id));
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
        execution_plan_status: item.execution_plan_status,
        execution_status: item.execution_status,
      })),
      change_reason: input.changeReason,
      ...(input.actorId === undefined ? {} : { actor_id: input.actorId }),
      created_at: this.runtime.now(),
    };
    await repository.saveDevelopmentPlanRevision(revision);
    return revision;
  }

  private boundarySummaryMarkdown(input: ApproveBoundaryInput): string {
    return [
      '# Boundary Summary',
      '',
      '## Confirmed Scope',
      ...input.confirmed_scope.map((entry) => `- ${entry}`),
      '',
      '## Confirmed Out Of Scope',
      ...input.confirmed_out_of_scope.map((entry) => `- ${entry}`),
      '',
      '## Accepted Assumptions',
      ...input.accepted_assumptions.map((entry) => `- ${entry}`),
      '',
      '## Open Risks',
      ...input.open_risks.map((entry) => `- ${entry}`),
      '',
      '## Validation Expectations',
      ...input.validation_expectations.map((entry) => `- ${entry}`),
    ].join('\n');
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
