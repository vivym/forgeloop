import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import {
  useAnswerBrainstormingQuestionMutation,
  useApproveBoundaryMutation,
  useRecordBrainstormingDecisionMutation,
  useStartBrainstormingSessionMutation,
} from '../../shared/api/hooks';
import { queryKeys } from '../../shared/api/query-keys';
import { useActorContext } from '../../shared/context/actor-context';
import { InlineActions, Section } from '../../shared/layout';
import { Button, InlineNotice, StatusPill, Textarea } from '../../shared/ui';

type BrainstormingSession = {
  id: string;
  approval_state?: string;
  questions?: Array<{ id: string; text: string; status?: string }>;
  answers?: Array<{ id: string; text: string }>;
  decisions?: Array<{ id: string; text: string; rationale?: string | undefined }>;
};

export function BrainstormingPanel({
  developmentPlanId,
  itemId,
  session,
}: {
  developmentPlanId: string | undefined;
  itemId: string | undefined;
  session: BrainstormingSession | undefined;
}) {
  const { actorId } = useActorContext();
  const queryClient = useQueryClient();
  const [activeSessionId, setActiveSessionId] = useState(session?.id);
  const [localSession, setLocalSession] = useState<BrainstormingSession>();
  const [message, setMessage] = useState<string>();
  const [answerText, setAnswerText] = useState('Keep the change scoped to the selected Development Plan Item.');
  const [decisionRationale, setDecisionRationale] = useState('The approved boundary is limited to the selected Development Plan Item.');
  const startMutation = useStartBrainstormingSessionMutation({ developmentPlanId, itemId });
  const answerMutation = useAnswerBrainstormingQuestionMutation({ developmentPlanId, itemId, sessionId: activeSessionId });
  const decisionMutation = useRecordBrainstormingDecisionMutation({ developmentPlanId, itemId, sessionId: activeSessionId });
  const approveMutation = useApproveBoundaryMutation({ developmentPlanId, itemId, sessionId: activeSessionId });
  const currentSession = localSession ?? session;
  const currentQuestions = currentSession?.questions ?? [{ id: 'boundary-question', text: 'What is the implementation boundary?' }];

  async function startSession() {
    const started = await startMutation.mutateAsync({ actor_id: actorId });
    setActiveSessionId(started.id);
    setLocalSession(started);
    setMessage('Brainstorming session started.');
  }

  async function answerQuestion() {
    const answeredQuestions = currentQuestions.filter((question) => question.status !== 'answered' && question.status !== 'resolved');
    for (const question of answeredQuestions) {
      await answerMutation.mutateAsync({
        actor_id: actorId,
        question_id: question.id,
        text: answerText.trim() || 'Keep the implementation boundary scoped to the Development Plan Item.',
      });
    }
    setLocalSession((existing) =>
      existing === undefined
        ? existing
        : {
            ...existing,
            questions: existing.questions?.map((question) => ({ ...question, status: 'answered' })) ?? [],
          },
    );
    setMessage('Boundary answer recorded.');
  }

  async function recordDecision() {
    await decisionMutation.mutateAsync({
      actor_id: actorId,
      text: 'The approved boundary is limited to the selected Development Plan Item.',
      rationale: decisionRationale.trim() || 'This keeps Spec and Execution Plan generation item-scoped.',
    });
    setLocalSession((existing) =>
      existing === undefined
        ? existing
        : {
            ...existing,
            decisions: [
              ...(existing.decisions ?? []),
              {
                id: `local-decision-${existing.decisions?.length ?? 0}`,
                text: 'The approved boundary is limited to the selected Development Plan Item.',
                rationale: decisionRationale.trim() || 'This keeps Spec and Execution Plan generation item-scoped.',
              },
            ],
          },
    );
    setMessage('Boundary decision recorded.');
  }

  async function approveBoundary() {
    await approveMutation.mutateAsync({
      actor_id: actorId,
      confirmed_scope: ['Selected Development Plan Item'],
      confirmed_out_of_scope: ['Unlinked source-object direct artifact generation'],
      accepted_assumptions: ['Source context is current'],
      open_risks: [],
      validation_expectations: ['Reviewer can audit boundary decisions'],
      final_decision: 'Approved for Spec generation',
    });
    setMessage('Boundary approved.');
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.developmentPlanItem(developmentPlanId, itemId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.developmentPlanItemRevisions(developmentPlanId, itemId) }),
    ]);
  }

  return (
    <Section
      actions={<StatusPill tone={currentSession?.approval_state === 'approved' ? 'success' : 'info'}>{currentSession?.approval_state ?? 'not started'}</StatusPill>}
      title="Boundary brainstorming"
    >
      <div className="grid gap-4">
        {message ? <InlineNotice title={message} tone="success" /> : null}
        <div className="grid gap-2 text-sm text-text-secondary">
          {currentQuestions.map((question) => (
            <p key={question.id}>{question.text}</p>
          ))}
          {(currentSession?.decisions ?? []).map((decision) => (
            <p key={decision.id}>
              <span className="font-semibold text-text-primary">Decision: </span>
              {decision.text}
            </p>
          ))}
        </div>
        <label className="grid gap-1 text-sm font-semibold text-text-primary">
          Answer boundary question
          <Textarea
            aria-label="Answer boundary question"
            disabled={activeSessionId === undefined}
            value={answerText}
            onChange={(event) => setAnswerText(event.target.value)}
          />
        </label>
        <label className="grid gap-1 text-sm font-semibold text-text-primary">
          Decision rationale
          <Textarea
            aria-label="Decision rationale"
            disabled={activeSessionId === undefined}
            value={decisionRationale}
            onChange={(event) => setDecisionRationale(event.target.value)}
          />
        </label>
        <InlineActions>
          <Button onClick={() => void startSession()} type="button">Start boundary brainstorming</Button>
          <Button disabled={activeSessionId === undefined} onClick={() => void answerQuestion()} type="button" variant="secondary">
            Answer boundary questions
          </Button>
          <Button disabled={activeSessionId === undefined} onClick={() => void recordDecision()} type="button" variant="secondary">
            Record boundary decision
          </Button>
          <Button disabled={activeSessionId === undefined} onClick={() => void approveBoundary()} type="button" variant="secondary">
            Approve boundary
          </Button>
        </InlineActions>
      </div>
    </Section>
  );
}
