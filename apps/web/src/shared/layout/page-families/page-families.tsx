import type { HTMLAttributes, ReactNode } from 'react';

import { cn } from '../../utils/cn';

function PrimarySurface({
  children,
  className,
  ...landmarkProps
}: HTMLAttributes<HTMLElement> & { children: ReactNode }) {
  return (
    <section {...landmarkProps} className={cn('min-w-0', className)} data-primary-work-surface="">
      {children}
    </section>
  );
}

function hasRenderableSlot(slot: ReactNode): boolean {
  if (slot === null || slot === undefined || typeof slot === 'boolean') return false;
  if (typeof slot === 'string') return slot.length > 0;
  if (Array.isArray(slot)) return slot.some(hasRenderableSlot);
  return true;
}

export function CockpitLayout({
  attentionQueue,
  commandStrip,
  healthRail,
  riskColumn,
}: {
  attentionQueue: ReactNode;
  commandStrip: ReactNode;
  healthRail: ReactNode;
  riskColumn: ReactNode;
}) {
  return (
    <div className="grid gap-4" data-command-strip="">
      <div>{commandStrip}</div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(18rem,0.7fr)_18rem]">
        <PrimarySurface className="content-start" data-attention-queue="">
          {attentionQueue}
        </PrimarySurface>
        <section data-risk-column="">{riskColumn}</section>
        <div data-health-rail="">{healthRail}</div>
      </div>
    </div>
  );
}

export function DatabaseViewLayout({
  inspector,
  table,
  toolbar,
}: {
  inspector?: ReactNode;
  table: ReactNode;
  toolbar: ReactNode;
}) {
  const hasInspector = hasRenderableSlot(inspector);

  return (
    <div className="grid gap-3">
      <div data-database-toolbar="">{toolbar}</div>
      <div className={cn('grid gap-4', hasInspector ? 'xl:grid-cols-[minmax(0,1fr)_22rem]' : undefined)}>
        <PrimarySurface data-data-table="">{table}</PrimarySurface>
        {hasInspector ? <div data-row-preview="">{inspector}</div> : null}
      </div>
    </div>
  );
}

export function InboxLayout({
  groups,
  inspector,
  list,
  toolbar,
}: {
  groups?: ReactNode;
  inspector?: ReactNode;
  list: ReactNode;
  toolbar?: ReactNode;
}) {
  const hasInspector = hasRenderableSlot(inspector);

  return (
    <div className="grid gap-3">
      {toolbar ? <div data-inbox-toolbar="">{toolbar}</div> : null}
      {groups ? <div data-inbox-groups="">{groups}</div> : null}
      <div className={cn('grid gap-4', hasInspector ? 'xl:grid-cols-[minmax(0,1fr)_22rem]' : undefined)}>
        <PrimarySurface data-inbox-list="">{list}</PrimarySurface>
        {hasInspector ? <div data-inspector-panel="">{inspector}</div> : null}
      </div>
    </div>
  );
}

export function DocumentWorkspaceLayout({
  attachments,
  document,
  properties,
}: {
  attachments?: ReactNode;
  document: ReactNode;
  properties?: ReactNode;
}) {
  const hasAttachments = hasRenderableSlot(attachments);
  const hasProperties = hasRenderableSlot(properties);
  const hasPropertyRail = hasProperties || hasAttachments;

  return (
    <div className={cn('grid gap-4', hasPropertyRail ? 'xl:grid-cols-[minmax(0,1fr)_20rem]' : undefined)}>
      <PrimarySurface data-document-surface="">{document}</PrimarySurface>
      {hasPropertyRail ? (
        <div className="grid content-start gap-3">
          {hasProperties ? <div data-property-rail="">{properties}</div> : null}
          {hasAttachments ? <div data-attachment-strip="">{attachments}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

export function SourceEvidenceLayout({
  attachments,
  rawDetails,
  summary,
}: {
  attachments?: ReactNode;
  rawDetails?: ReactNode;
  summary: ReactNode;
}) {
  const hasAttachments = hasRenderableSlot(attachments);
  const hasRawDetails = hasRenderableSlot(rawDetails);
  const hasEvidenceRail = hasAttachments || hasRawDetails;

  return (
    <div className={cn('grid gap-4', hasEvidenceRail ? 'xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)]' : undefined)}>
      <PrimarySurface data-evidence-summary="">{summary}</PrimarySurface>
      {hasEvidenceRail ? (
        <section className="grid content-start gap-3">
          {hasAttachments ? <div data-attachment-list="">{attachments}</div> : null}
          {hasRawDetails ? <div data-raw-evidence-details="">{rawDetails}</div> : null}
        </section>
      ) : null}
    </div>
  );
}

export function PlanningTableLayout({ inspector, table, toolbar }: { inspector?: ReactNode; table: ReactNode; toolbar?: ReactNode }) {
  const hasInspector = hasRenderableSlot(inspector);

  return (
    <div className="grid gap-3">
      {toolbar ? <div data-planning-toolbar="">{toolbar}</div> : null}
      <div className={cn('grid gap-4', hasInspector ? 'xl:grid-cols-[minmax(0,1fr)_22rem]' : undefined)}>
        <PrimarySurface data-plan-items-table="">{table}</PrimarySurface>
        {hasInspector ? <div data-inspector-panel="">{inspector}</div> : null}
      </div>
    </div>
  );
}

export function PlanAuthoringLayout({
  aiAssist,
  preview,
  primarySurface = 'source-context',
  sourceContext,
}: {
  aiAssist?: ReactNode;
  preview?: ReactNode;
  primarySurface?: 'source-context' | 'preview';
  sourceContext: ReactNode;
}) {
  const hasAiAssist = hasRenderableSlot(aiAssist);
  const hasPreview = hasRenderableSlot(preview);
  const effectivePrimarySurface = primarySurface === 'preview' && !hasPreview ? 'source-context' : primarySurface;
  const hasAuthoringRail = hasAiAssist || hasPreview;
  const sourceContextNode =
    effectivePrimarySurface === 'source-context' ? (
      <PrimarySurface data-source-context-picker="">{sourceContext}</PrimarySurface>
    ) : (
      <section data-source-context-picker="">{sourceContext}</section>
    );
  const previewNode =
    !hasPreview ? null : effectivePrimarySurface === 'preview' ? (
      <PrimarySurface data-plan-preview="">{preview}</PrimarySurface>
    ) : (
      <div data-plan-preview="">{preview}</div>
    );

  return (
    <div className={cn('grid gap-4', hasAuthoringRail ? 'xl:grid-cols-[minmax(20rem,0.8fr)_minmax(0,1fr)]' : undefined)}>
      {sourceContextNode}
      {hasAuthoringRail ? (
        <section className="grid content-start gap-3">
          {hasAiAssist ? <div data-ai-assist-panel="">{aiAssist}</div> : null}
          {previewNode}
        </section>
      ) : null}
    </div>
  );
}

export function GateFlowLayout({
  contextRail,
  gateStepper,
  workspace,
}: {
  contextRail?: ReactNode;
  gateStepper?: ReactNode;
  workspace: ReactNode;
}) {
  const hasContextRail = hasRenderableSlot(contextRail);

  return (
    <div className={cn('grid gap-4', hasContextRail ? 'xl:grid-cols-[minmax(0,1fr)_20rem]' : undefined)}>
      <div className="grid gap-3">
        {gateStepper ? <div data-gate-stepper="">{gateStepper}</div> : null}
        <PrimarySurface data-gate-workspace="">{workspace}</PrimarySurface>
      </div>
      {hasContextRail ? <div data-context-rail="">{contextRail}</div> : null}
    </div>
  );
}

export function DocumentReviewLayout({
  commentSummary,
  document,
  reviewState,
  toolbar,
}: {
  commentSummary?: ReactNode;
  document: ReactNode;
  reviewState?: ReactNode;
  toolbar?: ReactNode;
}) {
  const hasCommentSummary = hasRenderableSlot(commentSummary);
  const hasReviewState = hasRenderableSlot(reviewState);
  const hasReviewRail = hasReviewState || hasCommentSummary;

  return (
    <div className="grid gap-3">
      {toolbar ? <div data-review-toolbar="">{toolbar}</div> : null}
      <div className={cn('grid gap-4', hasReviewRail ? 'xl:grid-cols-[minmax(0,1fr)_20rem]' : undefined)}>
        <PrimarySurface data-document-surface="">{document}</PrimarySurface>
        {hasReviewRail ? (
          <div className="grid content-start gap-3">
            {hasReviewState ? <div data-review-state="">{reviewState}</div> : null}
            {hasCommentSummary ? <div data-comment-summary="">{commentSummary}</div> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function CodeReviewLayout({ controls, evidence, workspace }: { controls?: ReactNode; evidence?: ReactNode; workspace: ReactNode }) {
  const hasControls = hasRenderableSlot(controls);
  const hasEvidence = hasRenderableSlot(evidence);
  const hasReviewRail = hasEvidence || hasControls;

  return (
    <div className={cn('grid gap-4', hasReviewRail ? 'xl:grid-cols-[minmax(0,1fr)_22rem]' : undefined)}>
      <PrimarySurface data-code-review-workspace="">{workspace}</PrimarySurface>
      {hasReviewRail ? (
        <div className="grid content-start gap-3">
          {hasEvidence ? <div data-review-evidence="">{evidence}</div> : null}
          {hasControls ? <div data-review-decision-controls="">{controls}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

export function QaHandoffLayout({ controls, evidence, workspace }: { controls?: ReactNode; evidence?: ReactNode; workspace: ReactNode }) {
  const hasControls = hasRenderableSlot(controls);
  const hasEvidence = hasRenderableSlot(evidence);
  const hasQaRail = hasEvidence || hasControls;

  return (
    <div className={cn('grid gap-4', hasQaRail ? 'xl:grid-cols-[minmax(0,1fr)_22rem]' : undefined)}>
      <PrimarySurface data-qa-handoff-workspace="">{workspace}</PrimarySurface>
      {hasQaRail ? (
        <div className="grid content-start gap-3">
          {hasEvidence ? <div data-qa-acceptance-evidence="">{evidence}</div> : null}
          {hasControls ? <div data-qa-decision-controls="">{controls}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

export function DocumentGovernanceLayout({ groups, inspector, queue }: { groups?: ReactNode; inspector?: ReactNode; queue: ReactNode }) {
  const hasInspector = hasRenderableSlot(inspector);

  return (
    <div className={cn('grid gap-4', hasInspector ? 'xl:grid-cols-[minmax(0,1fr)_22rem]' : undefined)}>
      <div className="grid gap-3">
        {groups ? <div data-document-review-groups="">{groups}</div> : null}
        <PrimarySurface data-document-queue="">{queue}</PrimarySurface>
      </div>
      {hasInspector ? <div data-inspector-panel="">{inspector}</div> : null}
    </div>
  );
}

export function DeliveryBoardLayout({ columns, toolbar }: { columns: ReactNode; toolbar?: ReactNode }) {
  return (
    <div className="grid gap-3">
      {toolbar ? <div data-board-toolbar="">{toolbar}</div> : null}
      <PrimarySurface className="grid gap-3 lg:grid-cols-2 xl:grid-cols-4" data-board-columns="">
        {columns}
      </PrimarySurface>
    </div>
  );
}

export function ExecutionSupervisionLayout({
  controls,
  evidence,
  lanes,
  primarySurface = 'lanes',
}: {
  controls?: ReactNode;
  evidence?: ReactNode;
  lanes: ReactNode;
  primarySurface?: 'lanes' | 'evidence';
}) {
  const hasControls = hasRenderableSlot(controls);
  const hasEvidence = hasRenderableSlot(evidence);
  const effectivePrimarySurface = primarySurface === 'evidence' && !hasEvidence ? 'lanes' : primarySurface;
  const hasExecutionRail = hasEvidence || hasControls;
  const lanesNode =
    effectivePrimarySurface === 'lanes' ? (
      <PrimarySurface data-execution-lanes="">{lanes}</PrimarySurface>
    ) : (
      <section data-execution-lanes="">{lanes}</section>
    );
  const evidenceNode =
    !hasEvidence ? null : effectivePrimarySurface === 'evidence' ? (
      <PrimarySurface data-run-evidence="">{evidence}</PrimarySurface>
    ) : (
      <div data-run-evidence="">{evidence}</div>
    );

  return (
    <div className={cn('grid gap-4', hasExecutionRail ? 'xl:grid-cols-[minmax(0,1fr)_22rem]' : undefined)}>
      {lanesNode}
      {hasExecutionRail ? (
        <div className="grid content-start gap-3">
          {evidenceNode}
          {hasControls ? <div data-worker-controls="">{controls}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

export function ReleaseReadinessLayout({
  blockers,
  evidence,
  rolloutPlan,
  scope,
}: {
  blockers: ReactNode;
  evidence?: ReactNode;
  rolloutPlan?: ReactNode;
  scope?: ReactNode;
}) {
  const hasEvidence = hasRenderableSlot(evidence);
  const hasRolloutPlan = hasRenderableSlot(rolloutPlan);
  const hasScope = hasRenderableSlot(scope);
  const hasReadinessRail = hasScope || hasEvidence || hasRolloutPlan;

  return (
    <div className={cn('grid gap-4', hasReadinessRail ? 'xl:grid-cols-[minmax(0,1fr)_22rem]' : undefined)}>
      <PrimarySurface data-readiness-blockers="">{blockers}</PrimarySurface>
      {hasReadinessRail ? (
        <div className="grid content-start gap-3">
          {hasScope ? <div data-release-scope="">{scope}</div> : null}
          {hasEvidence ? <div data-qa-evidence="">{evidence}</div> : null}
          {hasRolloutPlan ? <div data-rollout-plan="">{rolloutPlan}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

export function ReleaseEvidenceLayout({ evidence, rawEvidence, summary }: { evidence?: ReactNode; rawEvidence?: ReactNode; summary: ReactNode }) {
  const hasEvidence = hasRenderableSlot(evidence);
  const hasRawEvidence = hasRenderableSlot(rawEvidence);
  const hasReleaseEvidenceRail = hasEvidence || hasRawEvidence;

  return (
    <div className={cn('grid gap-4', hasReleaseEvidenceRail ? 'xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)]' : undefined)}>
      <PrimarySurface data-release-evidence-summary="">{summary}</PrimarySurface>
      {hasReleaseEvidenceRail ? (
        <section className="grid content-start gap-3">
          {hasEvidence ? <div data-release-evidence-list="">{evidence}</div> : null}
          {hasRawEvidence ? <div data-release-raw-evidence="">{rawEvidence}</div> : null}
        </section>
      ) : null}
    </div>
  );
}

export function ReportInsightLayout({ actions, conclusion, signals }: { actions?: ReactNode; conclusion: ReactNode; signals?: ReactNode }) {
  const hasActions = hasRenderableSlot(actions);
  const hasSignals = hasRenderableSlot(signals);
  const hasInsightRail = hasSignals || hasActions;

  return (
    <div className={cn('grid gap-4', hasInsightRail ? 'xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1fr)]' : undefined)}>
      <PrimarySurface data-report-conclusion="">{conclusion}</PrimarySurface>
      {hasInsightRail ? (
        <section className="grid content-start gap-3">
          {hasSignals ? <div data-report-signals="">{signals}</div> : null}
          {hasActions ? <div data-recommended-actions="">{actions}</div> : null}
        </section>
      ) : null}
    </div>
  );
}
