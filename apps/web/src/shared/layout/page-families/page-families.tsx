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
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(18rem,0.7fr)_18rem]">
        <PrimarySurface className="content-start" data-attention-queue="">
          {attentionQueue}
        </PrimarySurface>
        <section data-risk-column="">{riskColumn}</section>
        <div data-health-rail="">{healthRail}</div>
      </div>
      <div>{commandStrip}</div>
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
    <div className={cn('grid gap-4', hasInspector ? 'xl:grid-cols-[minmax(0,1fr)_22rem]' : undefined)}>
      <PrimarySurface className="grid content-start gap-3 lg:min-h-[70vh] xl:min-h-[90vh]" data-data-table="">
        <div className="min-w-0 overflow-hidden" data-database-toolbar="">{toolbar}</div>
        {table}
      </PrimarySurface>
      {hasInspector ? <div data-row-preview="">{inspector}</div> : null}
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
    <div className={cn('grid gap-4', hasInspector ? 'xl:grid-cols-[minmax(0,1fr)_22rem]' : undefined)}>
      <PrimarySurface className="grid content-start gap-3 lg:min-h-[60vh]" data-inbox-list="">
        {groups ? <div className="min-w-0" data-inbox-groups="">{groups}</div> : null}
        {toolbar ? <div className="min-w-0 overflow-hidden" data-inbox-toolbar="">{toolbar}</div> : null}
        {list}
      </PrimarySurface>
      {hasInspector ? <div data-inspector-panel="">{inspector}</div> : null}
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
      <PrimarySurface className="lg:min-h-[80vh] xl:min-h-[90vh]" data-document-surface="">{document}</PrimarySurface>
      {hasPropertyRail ? (
        <div className="grid min-w-0 content-start gap-3">
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
        <section className="grid min-w-0 content-start gap-3">
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
    <div className={cn('grid gap-4', hasInspector ? 'xl:grid-cols-[minmax(0,1fr)_22rem]' : undefined)}>
      <PrimarySurface className="grid content-start gap-3 lg:min-h-[70vh]" data-plan-items-table="">
        {toolbar ? <div className="min-w-0 overflow-hidden" data-planning-toolbar="">{toolbar}</div> : null}
        {table}
      </PrimarySurface>
      {hasInspector ? <div data-inspector-panel="">{inspector}</div> : null}
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
        <section className="grid min-w-0 content-start gap-3">
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
    <div className={cn('grid gap-4', hasReviewRail ? 'xl:grid-cols-[minmax(0,1fr)_16rem]' : undefined)}>
      <PrimarySurface className="grid content-start gap-3 lg:min-h-[80vh] xl:min-h-[90vh]" data-document-surface="">
        {toolbar ? <div className="min-w-0 overflow-x-auto" data-review-toolbar="">{toolbar}</div> : null}
        {document}
      </PrimarySurface>
      {hasReviewRail ? (
        <div className="grid content-start gap-3">
          {hasReviewState ? <div data-review-state="">{reviewState}</div> : null}
          {hasCommentSummary ? <div data-comment-summary="">{commentSummary}</div> : null}
        </div>
      ) : null}
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
    <div className={cn('grid gap-4', hasInspector ? 'xl:grid-cols-[minmax(0,1fr)_18rem]' : undefined)}>
      <PrimarySurface className="grid content-start gap-3 lg:min-h-[70vh] xl:min-h-[90vh]" data-document-queue="">
        {groups ? <div data-document-review-groups="">{groups}</div> : null}
        {queue}
      </PrimarySurface>
      {hasInspector ? <div data-inspector-panel="">{inspector}</div> : null}
    </div>
  );
}

export function DeliveryBoardLayout({ columns, state, toolbar }: { columns: ReactNode; state?: ReactNode; toolbar?: ReactNode }) {
  return (
    <PrimarySurface className="grid content-start gap-3 lg:min-h-[70vh] xl:min-h-[90vh]" data-board-columns="">
      {state}
      {toolbar ? <div className="min-w-0 overflow-x-auto" data-board-toolbar="">{toolbar}</div> : null}
      <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-4">
        {columns}
      </div>
    </PrimarySurface>
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
  const lanesNode =
    effectivePrimarySurface === 'lanes' ? (
      <PrimarySurface className="lg:min-h-[70vh] xl:min-h-[90vh]" data-execution-lanes="">{lanes}</PrimarySurface>
    ) : (
      <section className="min-w-0" data-execution-lanes="">{lanes}</section>
    );
  const evidenceNode =
    !hasEvidence ? null : effectivePrimarySurface === 'evidence' ? (
      <PrimarySurface className="lg:min-h-[70vh] xl:min-h-[90vh]" data-run-evidence="">{evidence}</PrimarySurface>
    ) : (
      <div className="min-w-0" data-run-evidence="">{evidence}</div>
    );
  const primaryNode = effectivePrimarySurface === 'lanes' ? lanesNode : evidenceNode;
  const secondaryRail =
    effectivePrimarySurface === 'lanes' ? (
      hasEvidence || hasControls ? (
        <div className="grid min-w-0 content-start gap-3">
          {evidenceNode}
          {hasControls ? <div data-worker-controls="">{controls}</div> : null}
        </div>
      ) : null
    ) : (
      <div className="grid min-w-0 content-start gap-3">
        {lanesNode}
        {hasControls ? <div data-worker-controls="">{controls}</div> : null}
      </div>
    );

  return (
    <div className={cn('grid gap-4', secondaryRail ? 'xl:grid-cols-[minmax(0,1fr)_20rem]' : undefined)}>
      {primaryNode}
      {secondaryRail}
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
    <div className={cn('grid min-w-0 gap-4', hasReadinessRail ? 'xl:grid-cols-[minmax(0,1fr)_20rem]' : undefined)}>
      <PrimarySurface className="lg:min-h-[70vh] xl:min-h-[90vh]" data-readiness-blockers="">{blockers}</PrimarySurface>
      {hasReadinessRail ? (
        <div className="grid min-w-0 content-start gap-3">
          {hasScope ? <div className="min-w-0" data-release-scope="">{scope}</div> : null}
          {hasEvidence ? <div className="min-w-0" data-qa-evidence="">{evidence}</div> : null}
          {hasRolloutPlan ? <div className="min-w-0" data-rollout-plan="">{rolloutPlan}</div> : null}
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
    <div className={cn('grid min-w-0 gap-4', hasReleaseEvidenceRail ? 'xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)]' : undefined)}>
      <PrimarySurface data-release-evidence-summary="">{summary}</PrimarySurface>
      {hasReleaseEvidenceRail ? (
        <section className="grid min-w-0 content-start gap-3">
          {hasEvidence ? <div className="min-w-0" data-release-evidence-list="">{evidence}</div> : null}
          {hasRawEvidence ? <div className="min-w-0" data-release-raw-evidence="">{rawEvidence}</div> : null}
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
    <div className={cn('grid gap-4', hasInsightRail ? 'xl:grid-cols-[minmax(0,1fr)_20rem]' : undefined)}>
      <PrimarySurface className="lg:min-h-[70vh] xl:min-h-[90vh]" data-report-conclusion="">{conclusion}</PrimarySurface>
      {hasInsightRail ? (
        <section className="grid content-start gap-3">
          {hasSignals ? <div data-report-signals="">{signals}</div> : null}
          {hasActions ? <div data-recommended-actions="">{actions}</div> : null}
        </section>
      ) : null}
    </div>
  );
}
