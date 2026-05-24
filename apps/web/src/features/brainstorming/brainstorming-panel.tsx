import { useState } from 'react';

import {
  useAnswerBrainstormingQuestionMutation,
  useApproveBoundaryMutation,
  useRecordBrainstormingDecisionMutation,
  useStartBrainstormingSessionMutation,
} from '../../shared/api/hooks';
import { useActorContext } from '../../shared/context/actor-context';
import { InlineActions, Section } from '../../shared/layout';
import { Button, InlineNotice, StatusPill } from '../../shared/ui';

type BrainstormingSession = {
  id: string;
  approval_state?: string;
  questions?: Array<{ id: string; text: string; status?: string }>;
  answers?: Array<{ id: string; text: string }>;
  decisions?: Array<{ id: string; text: string; rationale?: string }>;
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
  const [activeSessionId, setActiveSessionId] = useState(session?.id);
  const [message, setMessage] = useState<string>();
  const startMutation = useStartBrainstormingSessionMutation({ developmentPlanId, itemId });
  const answerMutation = useAnswerBrainstormingQuestionMutation({ developmentPlanId, itemId, sessionId: activeSessionId });
  const decisionMutation = useRecordBrainstormingDecisionMutation({ developmentPlanId, itemId, sessionId: activeSessionId });
  const approveMutation = useApproveBoundaryMutation({ developmentPlanId, itemId, sessionId: activeSessionId });
  const firstQuestion = session?.questions?.[0];

  async function startSession() {
    const started = await startMutation.mutateAsync({ actor_id: actorId });
    setActiveSessionId(started.id);
    setMessage('Brainstorming session started.');
  }

  async function answerQuestion() {
    await answerMutation.mutateAsync({
      actor_id: actorId,
      question_id: firstQuestion?.id ?? 'boundary-question',
      text: 'Keep the implementation boundary scoped to the Development Plan Item.',
    });
    setMessage('Boundary answer recorded.');
  }

  async function recordDecision() {
    await decisionMutation.mutateAsync({
      actor_id: actorId,
      text: 'The approved boundary is limited to the selected Development Plan Item.',
      rationale: 'This keeps Spec and Execution Plan generation item-scoped.',
    });
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
  }

  return (
    <Section
      actions={<StatusPill tone={session?.approval_state === 'approved' ? 'success' : 'info'}>{session?.approval_state ?? 'not started'}</StatusPill>}
      title="Boundary brainstorming"
    >
      <div className="grid gap-4">
        {message ? <InlineNotice title={message} tone="success" /> : null}
        <div className="grid gap-2 text-sm text-text-secondary">
          {(session?.questions ?? [{ id: 'boundary-question', text: 'What is the implementation boundary?' }]).map((question) => (
            <p key={question.id}>{question.text}</p>
          ))}
          {(session?.decisions ?? []).map((decision) => (
            <p key={decision.id}>
              <span className="font-semibold text-text-primary">Decision: </span>
              {decision.text}
            </p>
          ))}
        </div>
        <InlineActions>
          <Button onClick={() => void startSession()} type="button">Start boundary brainstorming</Button>
          <Button disabled={activeSessionId === undefined} onClick={() => void answerQuestion()} type="button" variant="secondary">
            Answer first boundary question
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
