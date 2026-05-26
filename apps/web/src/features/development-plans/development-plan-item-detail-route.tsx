import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import type { AttachmentRef, AttachmentUploadMetadata, EditableObjectRef, MarkdownDocument } from '@forgeloop/contracts';

import { createForgeloopAttachmentApi } from '../../shared/api/attachments';
import { createForgeloopCommandApi, type ExecutionPlanRevision } from '../../shared/api/commands';
import {
  useBoundarySummaryRevisionsQuery,
  useDevelopmentPlanItemQuery,
  useDevelopmentPlanItemRevisionsQuery,
} from '../../shared/api/hooks';
import type { ProductObjectRef, SpecRevision } from '../../shared/api/types';
import { useActorContext } from '../../shared/context/actor-context';
import { CodeReviewLayout, CompactMetadata, DocumentReviewLayout, GateFlowLayout, GateProgress, ProductPage, QaHandoffLayout, Section } from '../../shared/layout';
import { ForgeMarkdownEditor, InlineNotice, StatusPill } from '../../shared/ui';
import { BrainstormingPanel } from '../brainstorming/brainstorming-panel';
import { CodeReviewHandoffPanel, type CodeReviewHandoffProjection } from '../code-review/code-review-handoff-panel';
import { SurfaceStateIndicator } from '../project-management/surface-state';
import { QaHandoffPanel, type QaHandoffProjection } from '../qa/qa-handoff-panel';
import {
  BoundarySummaryRevisionHistory,
  PlanItemGateSummary,
  PlanItemRevisionHistory,
  planItemGateModels,
  type BoundarySummaryRevision,
  type DevelopmentPlanItemProjection,
  type DevelopmentPlanItemRevision,
  type PlanItemGateModel,
} from './plan-item-gates';
import { itemHref } from './development-plan-table';

type BrainstormingSession = {
  id: string;
  approval_state?: string;
  questions?: Array<{ id: string; text: string; status?: string }>;
  decisions?: Array<{ id: string; text: string; rationale?: string }>;
};

export function DevelopmentPlanItemDetailRoute() {
  return <DevelopmentPlanItemSurface focus="overview" />;
}

export function DevelopmentPlanItemBrainstormingRoute() {
  return <DevelopmentPlanItemSurface focus="brainstorming" />;
}

export function DevelopmentPlanItemSpecRoute() {
  return <DevelopmentPlanItemSurface focus="spec" />;
}

export function DevelopmentPlanItemExecutionPlanRoute() {
  return <DevelopmentPlanItemSurface focus="execution-plan" />;
}

export function DevelopmentPlanItemExecutionRoute() {
  return <DevelopmentPlanItemSurface focus="execution" />;
}

export function DevelopmentPlanItemReviewRoute() {
  return <DevelopmentPlanItemSurface focus="review" />;
}

export function DevelopmentPlanItemQaRoute() {
  return <DevelopmentPlanItemSurface focus="qa" />;
}

function DevelopmentPlanItemSurface({ focus }: { focus: DevelopmentPlanItemFocus }) {
  const { developmentPlanId, itemId } = useParams();
  const query = useDevelopmentPlanItemQuery(developmentPlanId, itemId);
  const itemCandidate = query.data as DevelopmentPlanItemProjection | undefined;
  const item = itemCandidate?.id === undefined ? undefined : itemCandidate;
  const itemWithRoutePlan = normalizeItemPlanRef(item, developmentPlanId);
  const revisionsQuery = useDevelopmentPlanItemRevisionsQuery(developmentPlanId, itemId);
  const boundarySummaryId = firstBoundaryRevision(itemWithRoutePlan)?.boundary_summary_id;
  const boundaryRevisionsQuery = useBoundarySummaryRevisionsQuery(boundarySummaryId);
  const revisions = (revisionsQuery.data ?? []) as DevelopmentPlanItemRevision[];
  const boundaryRevisions = ((boundaryRevisionsQuery.data ?? itemWithRoutePlan?.boundary_summary_revisions ?? []) as BoundarySummaryRevision[]);
  const session = brainstormingSessionFor(itemWithRoutePlan);
  const gates = itemWithRoutePlan === undefined ? [] : planItemGateModels(itemWithRoutePlan);
  const currentGateId = itemWithRoutePlan === undefined ? undefined : currentGateIdFor(itemWithRoutePlan, focus);
  const pageFamily = pageFamilyForFocus(focus);

  return (
    <ProductPage
      family={pageFamily}
      heading={itemWithRoutePlan?.title ?? 'Development Plan Item'}
      toolbar={
        <div className="flex flex-wrap items-start gap-2">
          {itemWithRoutePlan?.development_plan_ref ? (
            <Link className="inline-flex min-h-10 items-center rounded-md border border-border bg-surface px-4 text-sm font-semibold text-primary" to={`/development-plans/${itemWithRoutePlan.development_plan_ref.id}`}>
              Back to Development Plan
            </Link>
          ) : null}
          {itemWithRoutePlan ? <EvidenceSideContext compact item={itemWithRoutePlan} /> : null}
        </div>
      }
    >
      <SurfaceStateIndicator
        label="Development Plan Item Detail"
        state={query.isLoading ? 'loading' : query.isError ? 'error' : itemWithRoutePlan === undefined ? 'empty' : itemSurfaceState(itemWithRoutePlan)}
      />
      {query.isError ? <InlineNotice title="Development Plan Item could not be loaded." tone="danger" /> : null}
      {itemWithRoutePlan === undefined && !query.isLoading ? <InlineNotice title="Development Plan Item not found." tone="warning" /> : null}
      {itemWithRoutePlan ? (
        <DevelopmentPlanItemFocusedLayout
          boundaryRevisions={boundaryRevisions}
          currentGateId={currentGateId}
          developmentPlanId={developmentPlanId}
          focus={focus}
          gates={gates}
          item={itemWithRoutePlan}
          itemId={itemId}
          revisions={revisions}
          session={session}
        />
      ) : null}
    </ProductPage>
  );
}

function DevelopmentPlanItemFocusedLayout({
  boundaryRevisions,
  currentGateId,
  developmentPlanId,
  focus,
  gates,
  item,
  itemId,
  revisions,
  session,
}: {
  boundaryRevisions: BoundarySummaryRevision[];
  currentGateId: PlanItemGateModel['id'] | undefined;
  developmentPlanId: string | undefined;
  focus: DevelopmentPlanItemFocus;
  gates: PlanItemGateModel[];
  item: DevelopmentPlanItemProjection;
  itemId: string | undefined;
  revisions: DevelopmentPlanItemRevision[];
  session: BrainstormingSession | undefined;
}) {
  if (focus === 'spec' || focus === 'execution-plan') {
    return <ItemDocumentReviewSurface developmentPlanId={developmentPlanId} focus={focus} item={item} itemId={itemId} />;
  }

  if (focus === 'review') {
    const execution = executionSummaryFor(item);
    const handoff = codeReviewHandoffFor(item, execution.id);
    return (
      <CodeReviewLayout
        workspace={<CodeReviewHandoffPanel execution={execution} handoff={handoff} />}
        evidence={<EvidenceSideContext item={item} />}
        controls={<ReviewDecisionSummary status={handoff?.status ?? item.review_status} />}
      />
    );
  }

  if (focus === 'qa') {
    const execution = executionSummaryFor(item);
    const codeReview = codeReviewHandoffFor(item, execution.id);
    const handoff = qaHandoffFor(item, execution.id);
    return (
      <QaHandoffLayout
        workspace={<QaHandoffPanel codeReview={codeReview} execution={execution} handoff={handoff} />}
        evidence={<EvidenceSideContext item={item} />}
        controls={<ReviewDecisionSummary status={handoff?.status ?? item.qa_handoff_status} />}
      />
    );
  }

  return (
    <GateFlowLayout
      contextRail={<EvidenceSideContext item={item} />}
      gateStepper={<FirstViewportContext currentGateId={currentGateId} focus={focus} gates={gates} item={item} />}
      workspace={
        <div className="grid gap-4" data-workspace-content="">
          <GateRouteContextSummary currentGateId={currentGateId} gates={gates} item={item} />
          <ActiveGateBody
            developmentPlanId={developmentPlanId}
            focus={focus}
            item={item}
            itemId={itemId}
            session={session}
          />
          <SupportingGateBodies
            developmentPlanId={developmentPlanId}
            focus={focus}
            item={item}
            itemId={itemId}
            session={session}
          />
          <PlanItemRevisionHistory revisions={revisions} />
          <BoundarySummaryRevisionHistory revisions={boundaryRevisions} />
          <Section title="Evidence timeline">
            <p className="text-sm text-text-secondary">Evidence remains linked to the approved Spec, Execution Plan, execution, review, and QA gates.</p>
          </Section>
        </div>
      }
    />
  );
}

function GateRouteContextSummary({
  currentGateId,
  gates,
  item,
}: {
  currentGateId: PlanItemGateModel['id'] | undefined;
  gates: PlanItemGateModel[];
  item: DevelopmentPlanItemProjection;
}) {
  const completeCount = gates.filter((gate) => isCompleteStatus(gate.status)).length;
  return (
    <Section title="Gate progress" variant="subtle">
      <CompactMetadata
        items={[
          { label: 'Current gate', value: gateLabelFor(gates, currentGateId) },
          { label: 'Gate progress', value: `${completeCount} of ${gates.length} gates complete` },
          { label: 'Next action', value: item.next_action ?? 'Review gate state.' },
          { label: 'Evidence side context', value: `${executionEvidenceRefs(item).length} execution evidence refs linked` },
        ]}
      />
    </Section>
  );
}

function ItemDocumentReviewSurface({
  developmentPlanId,
  focus,
  item,
  itemId,
}: {
  developmentPlanId: string | undefined;
  focus: 'spec' | 'execution-plan';
  item: DevelopmentPlanItemProjection;
  itemId: string | undefined;
}) {
  const { actorId } = useActorContext();
  const commandApi = useMemo(() => createForgeloopCommandApi(), []);
  const attachmentApi = useMemo(() => createForgeloopAttachmentApi(), []);
  const fallbackRevision = useMemo(() => documentRevisionFor(item, focus), [focus, item]);
  const revisionQuery = useQuery<SpecRevision | ExecutionPlanRevision>({
    queryKey: ['item-document-revision', focus, fallbackRevision.id],
    queryFn: async () =>
      focus === 'spec'
        ? commandApi.getSpecRevision(fallbackRevision.id)
        : commandApi.getExecutionPlanRevision(fallbackRevision.id),
    enabled: fallbackRevision.id.length > 0,
  });
  const loadedRevision = useMemo(
    () => (revisionQuery.data === undefined ? undefined : documentRevisionFor(item, focus, revisionQuery.data)),
    [focus, item, revisionQuery.data],
  );
  const [documentRevision, setDocumentRevision] = useState<ItemDocumentRevision>();
  const [markdown, setMarkdown] = useState('');
  const [saveMessage, setSaveMessage] = useState<string>();

  useEffect(() => {
    if (loadedRevision === undefined) return;
    setDocumentRevision(loadedRevision);
    setMarkdown(loadedRevision.markdown);
    setSaveMessage(undefined);
  }, [loadedRevision?.id, loadedRevision?.markdown, loadedRevision?.label]);

  async function saveDraftOnly(document: MarkdownDocument) {
    if (developmentPlanId === undefined || itemId === undefined) {
      throw new Error('Development Plan Item route parameters are required to save document drafts.');
    }
    if (documentRevision === undefined) {
      throw new Error('Document revision must be loaded before saving a draft.');
    }

    const saved =
      focus === 'spec'
        ? await commandApi.saveItemSpecDraft(developmentPlanId, itemId, document)
        : await commandApi.saveItemExecutionPlanDraft(developmentPlanId, itemId, document);
    const nextRevision = documentRevisionFor(item, focus, saved);
    setDocumentRevision(nextRevision);
    setMarkdown(nextRevision.markdown);
    setSaveMessage(`${nextRevision.label} draft saved.`);
  }

  const documentLabel = documentRevision?.label ?? fallbackRevision.label;
  const documentStatus = documentRevision?.status ?? fallbackRevision.status;

  return (
    <DocumentReviewLayout
      toolbar={<DocumentReviewToolbar label={documentLabel} status={documentStatus} />}
      document={
        <Section
          actions={
            saveMessage ? (
              <StatusPill tone="success">{saveMessage}</StatusPill>
            ) : revisionQuery.isError ? (
              <StatusPill tone="warning">Revision body unavailable</StatusPill>
            ) : undefined
          }
          description="Save draft keeps review submission and approval as separate Plan Item gate actions."
          title={documentLabel}
          variant="panel"
        >
          {documentRevision === undefined ? (
            <InlineNotice
              title={revisionQuery.isError ? 'Revision body unavailable.' : 'Loading persisted revision body.'}
              tone={revisionQuery.isError ? 'warning' : 'info'}
            />
          ) : (
            <ItemRevisionMarkdownEditor
              actorId={actorId}
              attachmentApi={attachmentApi}
              documentRevision={documentRevision}
              markdown={markdown}
              onChange={setMarkdown}
              onSave={saveDraftOnly}
            />
          )}
        </Section>
      }
      reviewState={<DocumentGateState status={documentStatus} />}
      commentSummary={<DocumentCommentSummary focus={focus} item={item} />}
    />
  );
}

function ItemRevisionMarkdownEditor({
  actorId,
  attachmentApi,
  documentRevision,
  markdown,
  onChange,
  onSave,
}: {
  actorId: string | undefined;
  attachmentApi: ReturnType<typeof createForgeloopAttachmentApi>;
  documentRevision: ItemDocumentRevision;
  markdown: string;
  onChange: (markdown: string) => void;
  onSave: (document: MarkdownDocument) => Promise<void>;
}) {
  const objectRef = documentRevisionObjectRef(documentRevision);

  return (
    <ForgeMarkdownEditor
      allowedBlocks={['paragraph', 'heading', 'bold', 'italic', 'list', 'link', 'image', 'table', 'code_block', 'inline_code']}
      attachments={documentRevision.attachment_refs}
      guardRouteTransitions
      mode="edit"
      objectRef={objectRef}
      onChange={onChange}
      onSave={onSave}
      onUploadAttachment={(file) =>
        attachmentApi.uploadAttachment({
          file,
          metadata: documentRevisionAttachmentMetadata(objectRef, file),
          ...(actorId === undefined ? {} : { actorId }),
        })
      }
      validationPolicy={{ validation_version: '2026-05-23' }}
      value={markdown}
    />
  );
}

function FirstViewportContext({
  currentGateId,
  focus,
  gates,
  item,
}: {
  currentGateId: PlanItemGateModel['id'] | undefined;
  focus: DevelopmentPlanItemFocus;
  gates: PlanItemGateModel[];
  item: DevelopmentPlanItemProjection;
}) {
  return (
    <div className="grid gap-3">
      <p>{focusLabel(focus)}. {item.summary ?? 'Governed row detail.'}</p>
      <CompactMetadata
        items={[
          { label: 'Source', value: sourceLabel(item) },
          { label: 'Development Plan', value: planLabel(item) },
          { label: 'Current gate', value: gateLabelFor(gates, currentGateId) },
          { label: 'Priority summary', value: `${item.priority ?? 'unscored'} priority / ${item.risk ?? 'unscored'} risk` },
          { label: 'Driver', value: item.driver_actor_id ?? 'Unassigned' },
          { label: 'Responsible role', value: item.responsible_role ?? 'Unassigned' },
        ]}
      />
      <div className="grid gap-2">
        <h2 className="text-sm font-semibold text-text-primary">Gate progress</h2>
        <GateProgress
          {...(currentGateId === undefined ? {} : { currentGateId })}
          gates={gates.map((gate) => ({
            id: gate.id,
            label: gate.label,
            status: statusLabel(gate.status),
          }))}
        />
      </div>
    </div>
  );
}

function ActiveGateBody({
  developmentPlanId,
  focus,
  item,
  itemId,
  session,
}: {
  developmentPlanId: string | undefined;
  focus: DevelopmentPlanItemFocus;
  item: DevelopmentPlanItemProjection;
  itemId: string | undefined;
  session: BrainstormingSession | undefined;
}) {
  return (
    <div data-active-gate-body="">
      {renderGateBody(focus === 'overview' ? 'overview' : focus, { developmentPlanId, item, itemId, session })}
    </div>
  );
}

function SupportingGateBodies({
  developmentPlanId,
  focus,
  item,
  itemId,
  session,
}: {
  developmentPlanId: string | undefined;
  focus: DevelopmentPlanItemFocus;
  item: DevelopmentPlanItemProjection;
  itemId: string | undefined;
  session: BrainstormingSession | undefined;
}) {
  if (focus !== 'overview') {
    return <PlanItemGateSummary item={item} />;
  }

  return (
    <>
      {renderGateBody('brainstorming', { developmentPlanId, item, itemId, session })}
      {renderGateBody('spec', { developmentPlanId, item, itemId, session })}
      {renderGateBody('execution-plan', { developmentPlanId, item, itemId, session })}
      {renderGateBody('execution', { developmentPlanId, item, itemId, session })}
      {renderGateBody('review', { developmentPlanId, item, itemId, session })}
    </>
  );
}

function renderGateBody(
  body: DevelopmentPlanItemFocus | 'review',
  context: {
    developmentPlanId: string | undefined;
    item: DevelopmentPlanItemProjection;
    itemId: string | undefined;
    session: BrainstormingSession | undefined;
  },
): ReactNode {
  switch (body) {
    case 'overview':
      return <PlanItemGateSummary item={context.item} />;
    case 'brainstorming':
      return <BrainstormingPanel developmentPlanId={context.developmentPlanId} itemId={context.itemId} session={context.session} />;
    case 'spec':
      return (
        <Section title="Spec document">
          <ArtifactList items={context.item.specs ?? []} empty="No Spec document generated yet." />
        </Section>
      );
    case 'execution-plan':
      return (
        <Section title="Execution Plan document">
          <ArtifactList items={context.item.execution_plans ?? []} empty="No Execution Plan document generated yet." />
        </Section>
      );
    case 'execution':
      return (
        <Section title="Execution supervision">
          <ArtifactList items={context.item.executions ?? []} empty="No execution started yet." />
        </Section>
      );
    case 'review':
      return (
        <Section title="Code review and QA handoff">
          <div className="grid gap-2 text-sm text-text-secondary">
            <p>Review status: <StatusPill tone="info">{statusLabel(context.item.review_status)}</StatusPill></p>
            <ArtifactList items={context.item.qa_handoffs ?? []} empty="No QA handoff created yet." />
          </div>
        </Section>
      );
    case 'qa':
      return (
        <Section title="QA handoff">
          <ArtifactList items={context.item.qa_handoffs ?? []} empty="No QA handoff created yet." />
        </Section>
      );
  }
}

function ArtifactList({ items, empty }: { items: Array<{ id: string; title?: string; status?: string }>; empty: string }) {
  if (items.length === 0) return <p className="text-sm text-text-secondary">{empty}</p>;
  return (
    <div className="grid gap-2">
      {items.map((item) => (
        <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-background p-3 text-sm" key={item.id}>
          <span className="font-semibold text-text-primary">{item.title ?? item.id}</span>
          {item.status ? <StatusPill tone="info">{item.status}</StatusPill> : null}
        </div>
      ))}
    </div>
  );
}

function EvidenceSideContext({ compact = false, item }: { compact?: boolean; item: DevelopmentPlanItemProjection }) {
  const evidence = executionEvidenceRefs(item);
  const firstTitle = evidence[0]?.title ?? evidence[0]?.id;
  const summary = evidence.length === 0
    ? 'No execution evidence linked yet.'
    : `${evidence.length} execution evidence ${evidence.length === 1 ? 'ref' : 'refs'}${firstTitle === undefined ? '' : `, latest ${firstTitle}`}.`;

  return (
    <section
      aria-label="Evidence side context"
      className={compact
        ? 'grid max-w-xs gap-1 rounded-md border border-border bg-surface-muted px-3 py-2 text-sm'
        : 'grid gap-3 rounded-card border border-border bg-surface p-4 text-sm'}
    >
      <h2 className="text-sm font-semibold text-text-primary">Evidence side context</h2>
      <p className="text-text-secondary">{summary}</p>
      {!compact ? (
        <dl className="grid gap-2">
          <div>
            <dt className="text-xs font-medium uppercase tracking-normal text-text-muted">Source</dt>
            <dd className="text-text-primary">{sourceLabel(item)}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-normal text-text-muted">Plan context</dt>
            <dd className="text-text-primary">{planLabel(item)}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-normal text-text-muted">Release impact</dt>
            <dd className="text-text-primary">{item.release_impact ?? 'not recorded'}</dd>
          </div>
        </dl>
      ) : null}
    </section>
  );
}

function DocumentReviewToolbar({ label, status }: { label: string; status: string | undefined }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm text-text-secondary">
      <StatusPill tone="info">{statusLabel(status)}</StatusPill>
      <span>{label} draft save is separate from submit and approve.</span>
    </div>
  );
}

function DocumentGateState({ status }: { status: string | undefined }) {
  return (
    <Section title="Document gate state" variant="subtle">
      <p className="text-sm text-text-secondary">Current review status: {statusLabel(status)}.</p>
    </Section>
  );
}

function DocumentCommentSummary({ focus, item }: { focus: 'spec' | 'execution-plan'; item: DevelopmentPlanItemProjection }) {
  return (
    <Section title="Comment summary" variant="subtle">
      <p className="text-sm text-text-secondary">
        {focus === 'spec'
          ? item.next_action ?? 'Review Spec comments before approval.'
          : item.next_action ?? 'Review Execution Plan comments before approval.'}
      </p>
    </Section>
  );
}

function ReviewDecisionSummary({ status }: { status: string | undefined }) {
  return (
    <Section title="Decision state" variant="subtle">
      <p className="text-sm text-text-secondary">Current handoff status: {statusLabel(status)}.</p>
    </Section>
  );
}

type ItemDocumentRevision = {
  attachment_refs: AttachmentRef[];
  document_id: string;
  id: string;
  label: string;
  markdown: string;
  status: string | undefined;
  type: 'spec_revision' | 'execution_plan_revision';
};

function documentRevisionFor(
  item: DevelopmentPlanItemProjection,
  focus: 'spec' | 'execution-plan',
  loadedRevision?: SpecRevision | ExecutionPlanRevision,
): ItemDocumentRevision {
  if (focus === 'spec') {
    const spec = item.specs?.[0];
    const revisionId = spec?.current_revision_id ?? spec?.approved_revision_id ?? `specrev-${item.id}`;
    return {
      attachment_refs: loadedRevision?.attachment_refs ?? [],
      document_id: loadedRevision !== undefined && 'spec_id' in loadedRevision ? loadedRevision.spec_id : spec?.id ?? `spec-${item.id}`,
      id: loadedRevision?.id ?? revisionId,
      label: 'Spec document',
      markdown: loadedRevision?.content ?? [`# ${spec?.title ?? 'Spec document'}`, item.summary ?? '', item.next_action ?? 'Review Spec gate state.'].filter(Boolean).join('\n\n'),
      status: item.spec_status,
      type: 'spec_revision',
    };
  }

  const executionPlan = item.execution_plans?.[0];
  const revisionId = executionPlan?.current_revision_id ?? executionPlan?.approved_revision_id ?? `planrev-${item.id}`;
  return {
    attachment_refs: loadedRevision?.attachment_refs ?? [],
    document_id: loadedRevision !== undefined && 'execution_plan_id' in loadedRevision
      ? loadedRevision.execution_plan_id
      : executionPlan?.id ?? `execution-plan-${item.id}`,
    id: loadedRevision?.id ?? revisionId,
    label: 'Execution Plan document',
    markdown: loadedRevision?.content ?? [`# ${executionPlan?.title ?? 'Execution Plan document'}`, item.summary ?? '', item.next_action ?? 'Review Execution Plan gate state.'].filter(Boolean).join('\n\n'),
    status: item.execution_plan_status,
    type: 'execution_plan_revision',
  };
}

function documentRevisionObjectRef(revision: ItemDocumentRevision): EditableObjectRef {
  if (revision.type === 'spec_revision') {
    return { type: 'spec_revision', id: revision.id, spec_id: revision.document_id };
  }
  return { type: 'execution_plan_revision', id: revision.id, execution_plan_id: revision.document_id };
}

function documentRevisionAttachmentMetadata(objectRef: EditableObjectRef, file: File): AttachmentUploadMetadata {
  const label = readableAttachmentLabel(file.name);
  return {
    object_type: objectRef.type,
    object_id: objectRef.id,
    evidence_category: file.type.startsWith('image/') ? 'image' : 'document',
    caption: label,
    ...(file.type.startsWith('image/') ? { alt_text: label } : {}),
    visibility: 'object',
  };
}

function readableAttachmentLabel(filename: string): string {
  const withoutExtension = filename.replace(/\.[^.]+$/, '');
  return withoutExtension.length === 0 ? filename : withoutExtension.replace(/[-_]+/g, ' ');
}

function executionSummaryFor(item: DevelopmentPlanItemProjection) {
  const execution = item.executions?.[0];
  const evidenceRefs = executionEvidenceRefs(item);
  const fallbackEvidenceRefs: ProductObjectRef[] = [
    { type: 'execution', id: execution?.id ?? `execution-${item.id}`, title: 'Linked execution evidence' },
  ];
  const developmentPlanId = item.development_plan_ref?.id ?? item.development_plan_id ?? 'unknown-development-plan';
  const executionPlanRevisionId = item.execution_plans?.[0]?.approved_revision_id ?? item.execution_plans?.[0]?.current_revision_id;
  const executionPlanRevisionRef = executionPlanRevisionRefFor(item);
  return {
    id: execution?.id ?? `execution-${item.id}`,
    development_plan_item_id: item.id,
    development_plan_item_ref: {
      type: 'development_plan_item' as const,
      id: item.id,
      title: item.title,
      development_plan_id: developmentPlanId,
    },
    evidence_refs: evidenceRefs.length > 0 ? evidenceRefs : fallbackEvidenceRefs,
    ...(executionPlanRevisionId === undefined ? {} : { execution_plan_revision_id: executionPlanRevisionId }),
    ...(executionPlanRevisionRef === undefined ? {} : { execution_plan_revision_ref: executionPlanRevisionRef }),
    ...((execution?.status ?? item.execution_status) === undefined ? {} : { status: execution?.status ?? item.execution_status }),
  };
}

function executionPlanRevisionRefFor(item: DevelopmentPlanItemProjection): ProductObjectRef & { execution_plan_id?: string } | undefined {
  const executionPlan = item.execution_plans?.[0];
  const revisionId = executionPlan?.approved_revision_id ?? executionPlan?.current_revision_id;
  if (revisionId === undefined) return undefined;
  return {
    type: 'execution_plan_revision',
    id: revisionId,
    execution_plan_id: executionPlan?.id ?? `execution-plan-${item.id}`,
    ...(executionPlan?.title === undefined ? {} : { title: executionPlan.title }),
  };
}

function codeReviewHandoffFor(item: DevelopmentPlanItemProjection, executionId: string): CodeReviewHandoffProjection | undefined {
  const handoff = item.code_review_handoffs?.[0];
  if (handoff === undefined) return undefined;
  return {
    id: handoff.id,
    execution_id: executionId,
    verification_evidence_refs: executionEvidenceRefs(item),
    comments: handoff.title === undefined ? [] : [handoff.title],
    ...(handoff.status === undefined ? {} : { status: handoff.status }),
    ...(handoff.title === undefined ? {} : { summary: handoff.title }),
    ...(item.affected_surfaces === undefined ? {} : { changed_surfaces: item.affected_surfaces }),
    ...(handoff.audited_exception === undefined ? {} : { audited_exception: handoff.audited_exception }),
  };
}

function qaHandoffFor(item: DevelopmentPlanItemProjection, executionId: string): QaHandoffProjection | undefined {
  const handoff = item.qa_handoffs?.[0];
  if (handoff === undefined) return undefined;
  const developmentPlanId = item.development_plan_ref?.id ?? item.development_plan_id ?? 'unknown-development-plan';
  const sourceRef = sourceRefForHandoff(item);
  const executionPlanRevisionRef = executionPlanRevisionRefFor(item);
  return {
    id: handoff.id,
    execution_id: executionId,
    development_plan_item_id: item.id,
    development_plan_item_ref: {
      type: 'development_plan_item' as const,
      id: item.id,
      title: item.title,
      development_plan_id: developmentPlanId,
    },
    acceptance_criteria: [item.summary ?? 'Plan Item acceptance remains satisfied.'],
    test_strategy: 'Focused route, editor, review, and QA handoff checks.',
    verification_evidence_refs: executionEvidenceRefs(item),
    known_risks: item.risk === undefined ? [] : [item.risk],
    ...(sourceRef === undefined ? {} : { source_ref: sourceRef }),
    ...(executionPlanRevisionRef === undefined ? {} : { approved_execution_plan_revision_ref: executionPlanRevisionRef }),
    ...(handoff.status === undefined ? {} : { status: handoff.status }),
    ...(item.affected_surfaces === undefined ? {} : { changed_surfaces: item.affected_surfaces }),
    ...(item.release_impact === undefined ? {} : { release_impact: item.release_impact }),
  };
}

function sourceRefForHandoff(item: DevelopmentPlanItemProjection): ProductObjectRef | undefined {
  const sourceRef = item.source_ref;
  if (
    sourceRef === undefined ||
    (sourceRef.type !== 'initiative' && sourceRef.type !== 'requirement' && sourceRef.type !== 'bug' && sourceRef.type !== 'tech_debt')
  ) {
    return undefined;
  }
  return {
    type: sourceRef.type,
    id: sourceRef.id,
    ...(sourceRef.title === undefined ? {} : { title: sourceRef.title }),
  };
}

type DevelopmentPlanItemFocus = 'overview' | 'brainstorming' | 'spec' | 'execution-plan' | 'execution' | 'review' | 'qa';

function pageFamilyForFocus(focus: DevelopmentPlanItemFocus) {
  if (focus === 'spec' || focus === 'execution-plan') return 'document-review';
  if (focus === 'review') return 'code-review';
  if (focus === 'qa') return 'qa-handoff';
  return 'gate-flow';
}

function currentGateIdFor(item: DevelopmentPlanItemProjection, focus: DevelopmentPlanItemFocus): PlanItemGateModel['id'] {
  if (focus !== 'overview') {
    if (focus === 'brainstorming') return 'boundary';
    if (focus === 'review') return 'code-review';
    if (focus === 'qa') return 'qa-handoff';
    return focus;
  }
  if (!isCompleteStatus(item.boundary_status)) return 'boundary';
  if (!isCompleteStatus(item.spec_status)) return 'spec';
  if (!isCompleteStatus(item.execution_plan_status)) return 'execution-plan';
  if (!isCompleteStatus(item.execution_status)) return 'execution';
  if (!isCompleteStatus(item.review_status)) return 'code-review';
  return 'qa-handoff';
}

function gateLabelFor(gates: PlanItemGateModel[], gateId: PlanItemGateModel['id'] | undefined): string {
  return gates.find((gate) => gate.id === gateId)?.label ?? 'not selected';
}

function sourceLabel(item: DevelopmentPlanItemProjection): string {
  return item.source_ref?.title ?? item.source_ref?.id ?? 'Not linked';
}

function planLabel(item: DevelopmentPlanItemProjection): string {
  return item.development_plan_ref?.title ?? item.object_ref?.development_plan_id ?? item.development_plan_id ?? 'Not linked';
}

function statusLabel(status: string | undefined): string {
  return (status ?? 'not started').replaceAll('_', ' ');
}

function isCompleteStatus(status: string | undefined): boolean {
  return status === 'approved' || status === 'completed' || status === 'accepted';
}

function executionEvidenceRefs(item: DevelopmentPlanItemProjection) {
  const execution = item.executions?.[0];
  return [...(execution?.evidence_refs ?? []), ...(execution?.test_evidence_refs ?? [])];
}

function firstBoundaryRevision(item: DevelopmentPlanItemProjection | undefined): BoundarySummaryRevision | undefined {
  return item?.boundary_summary_revisions?.[0];
}

function brainstormingSessionFor(item: DevelopmentPlanItemProjection | undefined): BrainstormingSession | undefined {
  const revision = firstBoundaryRevision(item);
  if (revision?.brainstorming_session_id === undefined) return undefined;
  return {
    id: revision.brainstorming_session_id,
    ...(item?.boundary_status === undefined ? {} : { approval_state: item.boundary_status }),
    questions: [{ id: 'boundary-question', text: 'Which source and code boundaries are in scope?' }],
    decisions: (revision.summary_markdown ?? revision.summary) === undefined ? [] : [{ id: revision.id, text: revision.summary_markdown ?? revision.summary ?? '' }],
  };
}

function itemSurfaceState(item: DevelopmentPlanItemProjection): 'blocked' | 'approved' | 'running' | 'resumable' | 'stale' | undefined {
  const statusText = `${item.boundary_status ?? ''} ${item.spec_status ?? ''} ${item.execution_plan_status ?? ''} ${item.execution_status ?? ''}`;
  if (statusText.includes('blocked')) return 'blocked';
  if (statusText.includes('stale')) return 'stale';
  if (statusText.includes('interrupted')) return 'resumable';
  if (statusText.includes('running')) return 'running';
  if (item.boundary_status === 'approved') return 'approved';
  return undefined;
}

function normalizeItemPlanRef(
  item: DevelopmentPlanItemProjection | undefined,
  routeDevelopmentPlanId: string | undefined,
): DevelopmentPlanItemProjection | undefined {
  if (item === undefined) return undefined;
  const developmentPlanId = item.development_plan_ref?.id ?? item.object_ref?.development_plan_id ?? item.development_plan_id ?? routeDevelopmentPlanId;
  if (developmentPlanId === undefined) return item;
  return {
    ...item,
    development_plan_id: developmentPlanId,
    object_ref: {
      ...item.object_ref,
      type: 'development_plan_item',
      id: item.id,
      development_plan_id: developmentPlanId,
      title: item.object_ref?.title ?? item.title,
    },
    development_plan_ref: {
      ...item.development_plan_ref,
      id: developmentPlanId,
    },
    href: itemHref({ ...item, development_plan_id: developmentPlanId }),
  };
}

function focusLabel(focus: DevelopmentPlanItemFocus): string {
  switch (focus) {
    case 'brainstorming':
      return 'Boundary brainstorming';
    case 'spec':
      return 'Spec document';
    case 'execution-plan':
      return 'Execution Plan document';
    case 'execution':
      return 'Execution supervision';
    case 'review':
      return 'Code review handoff';
    case 'qa':
      return 'QA handoff';
    default:
      return 'Gate overview';
  }
}
