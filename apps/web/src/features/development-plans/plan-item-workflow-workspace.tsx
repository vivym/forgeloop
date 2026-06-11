import { useMemo, useState, type ReactNode } from 'react';
import { CheckCircle2, CirclePlay, MessageSquareText, RotateCw } from 'lucide-react';

import { usePlanItemWorkflowCommandMutation } from '../../shared/api/hooks';
import type { WorkflowArtifactType } from '../../shared/api/types';
import { useActorContext } from '../../shared/context/actor-context';
import { Button, InlineNotice, StatusPill } from '../../shared/ui';
import type { BoundarySummaryRevision, DevelopmentPlanItemProjection } from './plan-item-gates';
import {
  toPlanItemWorkflowWorkspaceModel,
  type WorkflowArtifactModel,
  type WorkflowRoleLens,
} from './plan-item-workflow-view-model';
import { PlanItemSessionDiagnosticsPanel } from './plan-item-session-diagnostics-panel';

export function PlanItemWorkflowWorkspace({
  boundaryRevisions,
  focus,
  item,
  routeChrome,
}: {
  boundaryRevisions: BoundarySummaryRevision[];
  focus: 'overview' | 'spec' | 'implementation-plan' | 'execution';
  item: DevelopmentPlanItemProjection;
  routeChrome: ReactNode;
}) {
  const { actorId } = useActorContext();
  const [roleLens, setRoleLens] = useState<WorkflowRoleLens>('tech_lead');
  const [selectedArtifactType, setSelectedArtifactType] = useState<WorkflowArtifactType>(focusArtifactType(focus) ?? 'spec_doc');
  const [messageAction, setMessageAction] = useState<'answer_boundary_question' | 'continue_ai'>('continue_ai');
  const [messageBody, setMessageBody] = useState('');
  const [feedback, setFeedback] = useState('');
  const [reviewResponsePrompt, setReviewResponsePrompt] = useState('');
  const [fixInstruction, setFixInstruction] = useState('');
  const [abandonReason, setAbandonReason] = useState('');
  const [abandonPhrase, setAbandonPhrase] = useState('');
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();
  const [runningLabel, setRunningLabel] = useState<string>();
  const model = useMemo(
    () => toPlanItemWorkflowWorkspaceModel({ boundaryRevisions, item, roleLens }),
    [boundaryRevisions, item, roleLens],
  );
  const workflowId = model.workflow.id;
  const commandMutations = usePlanItemWorkflowCommandMutation({
    developmentPlanId: item.development_plan_id ?? model.workflow.development_plan_id,
    itemId: item.id,
    workflowId,
  });
  const selectedArtifact = model.artifacts.find((artifact) => artifact.artifactType === selectedArtifactType) ?? model.defaultArtifact;
  const currentReviewPacket = model.codeReviewLens.currentPacket;
  const abandonOption = model.recoveryPanel.abandonOption;
  const abandonConfirmationPhrase = 'abandon current session and start new session';
  const canAbandon =
    abandonOption?.enabled === true &&
    abandonOption.next_action !== undefined &&
    abandonPhrase.trim() === abandonConfirmationPhrase &&
    abandonReason.trim().length > 0 &&
    runningLabel === undefined;

  async function run(label: string, operation: () => Promise<unknown>) {
    setRunningLabel(label);
    setError(undefined);
    try {
      await operation();
      setNotice(`${label} command accepted.`);
    } catch (commandError) {
      setError(commandError instanceof Error ? commandError.message : `${label} command failed.`);
    } finally {
      setRunningLabel(undefined);
    }
  }

  const canSendMessage = messageBody.trim().length > 0 && model.composerDisabledReason === undefined && runningLabel === undefined;

  return (
    <div
      className="grid min-h-[720px] gap-4 xl:grid-cols-[260px_minmax(0,1fr)_340px]"
      data-plan-item-workflow-workspace=""
      data-primary-work-surface=""
      data-product-shell="plan-item-workflow-workspace"
      data-workspace-content=""
    >
      <nav className="min-w-0 rounded-card border border-border bg-surface p-3" aria-label="Workflow timeline">
        <div className="mb-3">
          <p className="text-xs font-semibold uppercase tracking-normal text-text-muted">Workflow timeline</p>
          <h2 className="text-base font-semibold text-text-primary">Plan Item loop</h2>
        </div>
        <div className="grid gap-2">
          {model.stages.map((stage) => (
            <button
              className={`grid gap-1 rounded-md border px-3 py-2 text-left text-sm ${
                stage.emphasized ? 'border-primary bg-primary/10' : 'border-border bg-background'
              }`}
              key={stage.id}
              type="button"
            >
              <span className="font-semibold text-text-primary">{stage.label}</span>
              <span className="text-xs text-text-secondary">{stage.status}</span>
              <span className="text-xs text-text-muted">{stage.nextAction}</span>
            </button>
          ))}
        </div>
      </nav>

      <main className="min-w-0 rounded-card border border-border bg-background p-4" role="log" aria-label="Codex conversation">
        <div className="grid gap-3">
          {routeChrome}
          <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-normal text-text-muted">Codex conversation</p>
              <h2 className="text-lg font-semibold text-text-primary">Workflow conversation</h2>
              <p className="mt-1 max-w-3xl text-sm text-text-secondary">{item.summary}</p>
            </div>
            <StatusPill tone="info">{model.workflow.status}</StatusPill>
          </div>

          <div className="flex flex-wrap gap-2" aria-label="Role lens">
            {model.roleLens.map((lens) => (
              <Button
                aria-pressed={lens.selected}
                key={lens.id}
                onClick={() => setRoleLens(lens.id)}
                type="button"
                variant={lens.selected ? 'primary' : 'secondary'}
              >
                {lens.label}
              </Button>
            ))}
          </div>

          {notice ? <InlineNotice title={notice} tone="success" /> : null}
          {error ? <InlineNotice title={error} tone="danger" /> : null}
          {model.composerDisabledReason ? <InlineNotice title={model.composerDisabledReason} tone="warning" /> : null}

          <div className="grid gap-3">
            {model.conversationEvents.map((event) => (
              <article className="grid gap-2 rounded-md border border-border bg-surface p-3" key={event.id}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <MessageSquareText className="h-4 w-4 text-primary" aria-hidden="true" />
                    <span className="font-semibold text-text-primary">{event.title}</span>
                  </div>
                  {event.queuedActionStatus ? <StatusPill>{event.queuedActionStatus}</StatusPill> : null}
                </div>
                <p className="text-sm text-text-secondary">{event.body}</p>
                {event.queuedActionId ? (
                  <Button
                    disabled={runningLabel !== undefined || event.queuedActionStatus !== 'queued'}
                    onClick={() =>
                      void run(`Run generation for ${runButtonTarget(event.queuedActionLabel)}`, () =>
                        commandMutations.runQueuedAction.mutateAsync({
                          action_id: event.queuedActionId!,
                          actor_id: actorId,
                        }),
                      )
                    }
                    type="button"
                    variant="secondary"
                  >
                    <CirclePlay className="h-4 w-4" aria-hidden="true" />
                    {`Run generation for ${runButtonTarget(event.queuedActionLabel)}`}
                  </Button>
                ) : null}
              </article>
            ))}
          </div>

          <form
            aria-label="Workflow message"
            className="grid gap-3 rounded-md border border-border bg-surface p-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (!canSendMessage) return;
              void run('Send message', () =>
                commandMutations.recordMessage.mutateAsync({
                  actor_id: actorId,
                  action: messageAction,
                  body_markdown: messageBody.trim(),
                }),
              );
              setMessageBody('');
            }}
          >
            <div className="grid gap-2 md:grid-cols-[220px_minmax(0,1fr)]">
              <label className="grid gap-1 text-sm font-semibold text-text-primary">
                Action
                <select
                  className="min-h-10 rounded-md border border-border bg-background px-3 text-sm"
                  value={messageAction}
                  onChange={(event) => setMessageAction(event.currentTarget.value as typeof messageAction)}
                >
                  <option value="continue_ai">Continue AI</option>
                  <option value="answer_boundary_question">Answer Boundary Question</option>
                </select>
              </label>
              <label className="grid gap-1 text-sm font-semibold text-text-primary">
                Message
                <textarea
                  className="min-h-24 rounded-md border border-border bg-background px-3 py-2 text-sm text-text-primary"
                  onChange={(event) => setMessageBody(event.currentTarget.value)}
                  value={messageBody}
                />
              </label>
            </div>
            <div>
              <Button disabled={!canSendMessage} type="submit">
                Send message
              </Button>
            </div>
          </form>
        </div>
      </main>

      <aside className="min-w-0 overflow-auto rounded-card border border-border bg-surface p-3" aria-label="Artifact and context">
        <div className="grid gap-4">
          <section>
            <p className="text-xs font-semibold uppercase tracking-normal text-text-muted">Artifacts</p>
            <div className="mt-2 grid gap-2">
              {model.artifacts.map((artifact) => (
                <Button
                  key={artifact.artifactType}
                  onClick={() => setSelectedArtifactType(artifact.artifactType)}
                  type="button"
                  variant={artifact.artifactType === selectedArtifact?.artifactType ? 'primary' : 'secondary'}
                >
                  {`Open ${artifact.label}`}
                </Button>
              ))}
            </div>
          </section>

          {selectedArtifact ? (
            <ArtifactDrawer
              actorId={actorId}
              artifact={selectedArtifact}
              feedback={feedback}
              onFeedbackChange={setFeedback}
              onRun={run}
              commandMutations={commandMutations}
              running={runningLabel !== undefined}
            />
          ) : null}

          <PlanItemSessionDiagnosticsPanel planItemId={item.id} />

          <section aria-label="Context Preview" className="grid gap-2 rounded-md border border-border bg-background p-3">
            <p className="text-sm font-semibold text-text-primary">Context Preview</p>
            {model.contextPreview.map((row) => (
              <div className="grid gap-1 text-sm" key={row.label}>
                <span className="text-xs font-semibold uppercase tracking-normal text-text-muted">{row.label}</span>
                <span className="break-words text-text-secondary">{row.value}</span>
              </div>
            ))}
          </section>

          <section className="grid gap-2 rounded-md border border-border bg-background p-3">
            <p className="text-sm font-semibold text-text-primary">Execution Ready</p>
            <StatusPill tone={model.readinessState === 'ready' ? 'success' : 'warning'}>{model.readinessState}</StatusPill>
            {model.blockers.length > 0 ? (
              <ul className="grid gap-1 text-sm text-text-secondary">
                {model.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}
              </ul>
            ) : null}
            {model.readinessDisabledReason ? <InlineNotice title={model.readinessDisabledReason} tone="warning" /> : null}
            <Button
              disabled={runningLabel !== undefined || !model.canEvaluateReadiness}
              onClick={() => void run('Evaluate readiness', () => commandMutations.evaluateReadiness.mutateAsync({ actor_id: actorId }))}
              type="button"
              variant="secondary"
            >
              Evaluate readiness
            </Button>
            {model.canStartExecution ? (
              <Button
                disabled={runningLabel !== undefined}
                onClick={() => void run('Start execution', () => commandMutations.startExecution.mutateAsync({ actor_id: actorId }))}
                type="button"
              >
                <CirclePlay className="h-4 w-4" aria-hidden="true" />
                Start execution
              </Button>
            ) : null}
          </section>

          <section aria-label="Execution supervision" className="grid gap-3 rounded-md border border-border bg-background p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-text-primary">Execution supervision</p>
              <StatusPill tone={model.executionRunSummary?.status === 'running' ? 'info' : 'neutral'}>
                {model.executionRunSummary?.status ?? model.workflow.status}
              </StatusPill>
            </div>
            {model.executionRunSummary ? (
              <div className="grid gap-2 text-sm">
                <div className="grid gap-1">
                  <span className="text-xs font-semibold uppercase tracking-normal text-text-muted">Run session</span>
                  <span className="break-words text-text-secondary">{model.executionRunSummary.runSessionId}</span>
                </div>
                {model.executionRunSummary.executionPackageVersion !== undefined ? (
                  <div className="grid gap-1">
                    <span className="text-xs font-semibold uppercase tracking-normal text-text-muted">Package version</span>
                    <span className="text-text-secondary">{model.executionRunSummary.executionPackageVersion}</span>
                  </div>
                ) : null}
                {model.executionRunSummary.digestRows.map((row) => (
                  <div className="grid gap-1" key={row.label}>
                    <span className="text-xs font-semibold uppercase tracking-normal text-text-muted">{row.label}</span>
                    <span className="break-all font-mono text-xs text-text-secondary">{row.value}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-text-secondary">Execution has not started from this Plan Item workflow.</p>
            )}
            <div className="grid gap-2 text-sm">
              <div className="grid gap-1">
                <span className="text-xs font-semibold uppercase tracking-normal text-text-muted">Same-session digest</span>
                <span className="break-all font-mono text-xs text-text-secondary">{model.executionLens.sameSessionDigest}</span>
              </div>
              {model.executionLens.currentAttempt ? (
                <div className="grid gap-1">
                  <span className="text-xs font-semibold uppercase tracking-normal text-text-muted">Current run attempt</span>
                  <span className="text-text-secondary">
                    {model.executionLens.currentAttempt.attemptKind} · {model.executionLens.currentAttempt.status}
                  </span>
                </div>
              ) : null}
              {model.executionLens.attemptRows.length > 0 ? (
                <div className="grid gap-1" aria-label="Attempt timeline">
                  {model.executionLens.attemptRows.map((attempt) => (
                    <div className="rounded-md border border-border bg-surface px-3 py-2" key={attempt.id}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-semibold text-text-primary">{attempt.attemptKind}</span>
                        <StatusPill>{attempt.status}</StatusPill>
                      </div>
                      <p className="break-words text-text-secondary">{attempt.runSessionId}</p>
                      <p className="text-text-muted">{attempt.continuationCount} continuation event(s)</p>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
            {model.executionLens.canContinue ? (
              <Button
                disabled={runningLabel !== undefined}
                onClick={() => void run('Continue execution', () => commandMutations.continueExecution.mutateAsync({ actor_id: actorId }))}
                type="button"
              >
                Continue execution
              </Button>
            ) : model.executionLens.continueDisabledReason ? (
              <InlineNotice title={model.executionLens.continueDisabledReason} tone="warning" />
            ) : null}
          </section>

          <section aria-label="Code Review lens" className="grid gap-3 rounded-md border border-border bg-background p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-text-primary">Code Review</p>
              <StatusPill tone={currentReviewPacket?.decision === 'changes_requested' ? 'warning' : 'neutral'}>
                {currentReviewPacket?.status ?? model.workflow.status}
              </StatusPill>
            </div>
            {currentReviewPacket ? (
              <div className="grid gap-2 text-sm">
                <div className="grid gap-1">
                  <span className="text-xs font-semibold uppercase tracking-normal text-text-muted">Current Review Packet</span>
                  <span className="break-words text-text-secondary">{currentReviewPacket.id}</span>
                  <span className="break-all font-mono text-xs text-text-secondary">{currentReviewPacket.digest}</span>
                </div>
                {currentReviewPacket.summary ? <p className="text-text-secondary">{currentReviewPacket.summary}</p> : null}
                {currentReviewPacket.evidenceRefs.length > 0 ? (
                  <div className="grid gap-1" aria-label="Review Packet evidence">
                    {currentReviewPacket.evidenceRefs.map((ref) => (
                      <div className="rounded-md border border-border bg-surface px-3 py-2" key={ref.id}>
                        <p className="font-semibold text-text-primary">{ref.label}</p>
                        <p className="break-all font-mono text-xs text-text-secondary">{ref.digest}</p>
                        <p className="text-xs text-text-muted">{ref.visibility}</p>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-text-secondary">No current Review Packet is projected for this workflow.</p>
            )}
            {model.codeReviewLens.latestResponse ? (
              <div className="grid gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm">
                <p className="font-semibold text-text-primary">Latest ReviewResponse</p>
                <p className="text-text-secondary">
                  {model.codeReviewLens.latestResponse.id} · {model.codeReviewLens.latestResponse.status}
                </p>
                {model.codeReviewLens.latestResponse.summary ? (
                  <p className="text-text-secondary">{model.codeReviewLens.latestResponse.summary}</p>
                ) : null}
                {model.codeReviewLens.latestResponse.responseMarkdown ? (
                  <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-surface-subtle px-3 py-2 font-sans text-xs text-text-secondary">
                    {model.codeReviewLens.latestResponse.responseMarkdown}
                  </pre>
                ) : null}
              </div>
            ) : null}
            <label className="grid gap-1 text-sm font-semibold text-text-primary">
              Review response prompt
              <textarea
                className="min-h-20 rounded-md border border-border bg-surface px-3 py-2 text-sm"
                onChange={(event) => setReviewResponsePrompt(event.currentTarget.value)}
                value={reviewResponsePrompt}
              />
            </label>
            <Button
              disabled={runningLabel !== undefined || !model.codeReviewLens.canRespond || currentReviewPacket === undefined}
              onClick={() =>
                currentReviewPacket === undefined
                  ? undefined
                  : void run('Respond to review', () =>
                      commandMutations.respondToReview.mutateAsync({
                        actor_id: actorId,
                        expected_review_packet_id: currentReviewPacket.id,
                        expected_review_packet_digest: currentReviewPacket.digest,
                        ...(reviewResponsePrompt.trim().length === 0 ? {} : { response_prompt_markdown: reviewResponsePrompt.trim() }),
                      }),
                    )
              }
              type="button"
              variant="secondary"
            >
              Respond to review
            </Button>
            {model.codeReviewLens.respondDisabledReason ? <InlineNotice title={model.codeReviewLens.respondDisabledReason} tone="warning" /> : null}
            <label className="grid gap-1 text-sm font-semibold text-text-primary">
              Fix instruction
              <textarea
                className="min-h-20 rounded-md border border-border bg-surface px-3 py-2 text-sm"
                onChange={(event) => setFixInstruction(event.currentTarget.value)}
                value={fixInstruction}
              />
            </label>
            <Button
              disabled={runningLabel !== undefined || !model.codeReviewLens.canRequestFix || currentReviewPacket === undefined}
              onClick={() =>
                currentReviewPacket === undefined
                  ? undefined
                  : void run('Request fix', () =>
                      commandMutations.requestFix.mutateAsync({
                        actor_id: actorId,
                        expected_review_packet_id: currentReviewPacket.id,
                        expected_review_packet_digest: currentReviewPacket.digest,
                        ...(fixInstruction.trim().length === 0 ? {} : { fix_instruction_markdown: fixInstruction.trim() }),
                      }),
                    )
              }
              type="button"
            >
              Request fix
            </Button>
            {model.codeReviewLens.requestFixDisabledReason ? (
              <InlineNotice title={model.codeReviewLens.requestFixDisabledReason} tone="warning" />
            ) : null}
          </section>

          <section aria-label="Recovery panel" className="grid gap-3 rounded-md border border-border bg-background p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-text-primary">Recovery</p>
              <StatusPill tone="neutral">Manual</StatusPill>
            </div>
            <div className="grid gap-2 text-sm">
              {model.recoveryPanel.options.map((option) => (
                <div className="rounded-md border border-border bg-surface px-3 py-2" key={option.action_id}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold text-text-primary">{option.action_id.replace(/_/g, ' ')}</span>
                    <StatusPill tone={option.enabled ? 'success' : 'neutral'}>{option.enabled ? 'available' : 'unavailable'}</StatusPill>
                  </div>
                  {option.next_action ? <p className="text-text-secondary">Next action: {option.next_action}</p> : null}
                  {option.warning_copy ? <p className="text-text-muted">{option.warning_copy}</p> : null}
                </div>
              ))}
            </div>
            <label className="grid gap-1 text-sm font-semibold text-text-primary">
              Abandon reason
              <textarea
                className="min-h-20 rounded-md border border-border bg-surface px-3 py-2 text-sm"
                onChange={(event) => setAbandonReason(event.currentTarget.value)}
                value={abandonReason}
              />
            </label>
            <label className="grid gap-1 text-sm font-semibold text-text-primary">
              Type confirmation phrase
              <input
                className="min-h-10 rounded-md border border-border bg-surface px-3 text-sm"
                onChange={(event) => setAbandonPhrase(event.currentTarget.value)}
                value={abandonPhrase}
              />
            </label>
            <p className="break-words text-xs text-text-muted">{abandonConfirmationPhrase}</p>
            <Button
              disabled={!canAbandon}
              onClick={() =>
                abandonOption?.next_action === undefined
                  ? undefined
                  : void run('Abandon current session', () =>
                      commandMutations.abandonNewSession.mutateAsync({
                        actor_id: actorId,
                        next_action: abandonOption.next_action!,
                        confirmation_phrase: abandonConfirmationPhrase,
                        reason: abandonReason.trim(),
                      }),
                    )
              }
              type="button"
              variant="secondary"
            >
              Abandon current session
            </Button>
          </section>
        </div>
      </aside>
    </div>
  );
}

function ArtifactDrawer({
  actorId,
  artifact,
  feedback,
  onFeedbackChange,
  onRun,
  commandMutations,
  running,
}: {
  actorId: string;
  artifact: WorkflowArtifactModel;
  feedback: string;
  onFeedbackChange: (value: string) => void;
  onRun: (label: string, operation: () => Promise<unknown>) => Promise<void>;
  commandMutations: ReturnType<typeof usePlanItemWorkflowCommandMutation>;
  running: boolean;
}) {
  const revisionLabel = artifact.revisionId ?? 'No revision';
  return (
    <section aria-label={`${artifact.label} revision`} className="grid gap-3 rounded-md border border-border bg-background p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-text-primary">{artifact.label}</p>
        <StatusPill>{revisionLabel}</StatusPill>
      </div>
      <p className="whitespace-pre-wrap text-sm text-text-secondary">{artifact.body}</p>
      {artifact.reviewDisabledReason ? <InlineNotice title={artifact.reviewDisabledReason} tone="warning" /> : null}
      <div className="grid gap-2">
        <Button
          disabled={running || !artifact.canReview || artifact.revisionId === undefined}
          onClick={() =>
            void onRun('Approve revision', () =>
              commandMutations.approveArtifactRevision.mutateAsync({
                artifact_type: artifact.artifactType,
                revision_id: artifact.revisionId!,
                actor_id: actorId,
                decision_markdown: `Approved ${artifact.label} from workflow drawer.`,
              }),
            )
          }
          type="button"
        >
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
          Approve revision
        </Button>
        <label className="grid gap-1 text-sm font-semibold text-text-primary">
          Request changes feedback
          <textarea
            className="min-h-20 rounded-md border border-border bg-surface px-3 py-2 text-sm"
            onChange={(event) => onFeedbackChange(event.currentTarget.value)}
            value={feedback}
          />
        </label>
        <Button
          disabled={running || !artifact.canReview || artifact.revisionId === undefined || feedback.trim().length === 0}
          onClick={() =>
            void onRun('Request changes', () =>
              commandMutations.requestArtifactChanges.mutateAsync({
                artifact_type: artifact.artifactType,
                revision_id: artifact.revisionId!,
                actor_id: actorId,
                reason_markdown: feedback.trim(),
              }),
            )
          }
          type="button"
          variant="secondary"
        >
          <RotateCw className="h-4 w-4" aria-hidden="true" />
          Request changes
        </Button>
      </div>
    </section>
  );
}

function focusArtifactType(focus: 'overview' | 'spec' | 'implementation-plan' | 'execution'): WorkflowArtifactType | undefined {
  if (focus === 'spec') return 'spec_doc';
  if (focus === 'implementation-plan' || focus === 'execution') return 'implementation_plan_doc';
  return undefined;
}

function runButtonTarget(label: string | undefined) {
  if (label?.includes('Spec Doc')) return 'spec doc';
  if (label?.includes('Implementation Plan')) return 'implementation plan doc';
  if (label?.includes('Boundary')) return 'boundary summary';
  return 'brainstorming';
}
