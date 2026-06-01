import type {
  BoundarySummary as ContractBoundarySummary,
  BoundarySummaryRevision as ContractBoundarySummaryRevision,
  BoundaryRound as ContractBoundaryRound,
  BrainstormingAnswer as ContractBoundaryAnswer,
  BrainstormingDecision as ContractBoundaryDecision,
  BrainstormingQuestion as ContractBoundaryQuestion,
  BrainstormingSession as ContractBrainstormingSession,
} from '@forgeloop/contracts';
import type { IsoDateTime, WorkflowPersistenceRefs } from './types.js';

export interface BoundaryQuestion extends ContractBoundaryQuestion {}

export interface BoundaryAnswer extends ContractBoundaryAnswer {}

export interface BoundaryDecision extends ContractBoundaryDecision {}

export interface BoundaryRound extends ContractBoundaryRound {}

export interface BrainstormingSession extends ContractBrainstormingSession, WorkflowPersistenceRefs {
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

export interface BoundarySummary extends ContractBoundarySummary {
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

interface LegacyBoundarySummaryRevision {
  id: string;
  boundary_summary_id: string;
  brainstorming_session_id: string;
  brainstorming_session_revision_id: string;
  development_plan_item_id: string;
  development_plan_item_revision_id: string;
  revision_number: number;
  summary_markdown: string;
  decision_snapshot: BoundaryDecision[];
  decision_count: number;
  approved_by_actor_id?: string;
  approved_at?: IsoDateTime;
  created_at: IsoDateTime;
}

export type BoundarySummaryRevision =
  | (ContractBoundarySummaryRevision & WorkflowPersistenceRefs)
  | (LegacyBoundarySummaryRevision & WorkflowPersistenceRefs);

export const actorCanActForBoundaryLeader = (
  session: Pick<BrainstormingSession, 'leader_actor_id'> & { leader_delegate_actor_ids?: string[] | undefined },
  actorId: string,
): boolean => session.leader_actor_id === actorId || (session.leader_delegate_actor_ids ?? []).includes(actorId);

export const requiredBoundaryQuestionsClosed = (input: {
  questions: BoundaryQuestion[];
  answers: BoundaryAnswer[];
  decisions: BoundaryDecision[];
}): boolean => {
  const answersById = new Map(input.answers.map((answer) => [answer.id, answer]));
  const decisionsById = new Map(input.decisions.map((decision) => [decision.id, decision]));
  return input.questions
    .filter((question) => question.required && question.status !== 'superseded')
    .every((question) => {
      if (question.answered_by_answer_id !== undefined) {
        const answer = answersById.get(question.answered_by_answer_id);
        const roundMatches =
          question.round_id === undefined || answer?.round_id === undefined || question.round_id === answer.round_id;
        if (answer?.question_id === question.id && roundMatches) {
          return true;
        }
      }

      if (question.waived_by_decision_id !== undefined) {
        const decision = decisionsById.get(question.waived_by_decision_id);
        const roundMatches =
          question.round_id === undefined || decision?.round_id === undefined || question.round_id === decision.round_id;
        return (
          decision?.state === 'accepted' &&
          (decision.source === 'leader' || decision.source === 'delegate') &&
          roundMatches
        );
      }

      return false;
    });
};
