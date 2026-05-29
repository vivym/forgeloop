import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import type { AttachmentRef, AttachmentUploadMetadata, EditableObjectRef, MarkdownBlockKind, MarkdownDocument } from '@forgeloop/contracts';

import { createForgeloopAttachmentApi } from '../../shared/api/attachments';
import { createForgeloopCommandApi } from '../../shared/api/commands';
import { useDevelopmentPlansQuery } from '../../shared/api/hooks';
import { useActorContext } from '../../shared/context/actor-context';
import { useProjectContext } from '../../shared/context/project-context';
import {
  BugWorkspace,
  CompactMetadata,
  DocumentWorkspaceLayout,
  InitiativeWorkspace,
  ProductPage,
  RequirementWorkspace,
  Section,
  TechDebtWorkspace,
} from '../../shared/layout';
import { Button, Dialog, DialogPanel, EvidenceAttachments, ForgeMarkdownEditor, InlineNotice, Select, SegmentedControl, StatusPill, Tabs, Textarea } from '../../shared/ui';
import { SurfaceStateIndicator } from './surface-state';

export interface ProjectObjectDetail {
  id: string;
  ref: EditableObjectRef;
  title: string;
  status: string;
  priority?: string | undefined;
  risk?: string | undefined;
  driver_actor_id?: string | undefined;
  narrative_markdown: string;
  audit?: { created_at: string; updated_at: string; updated_by_actor_id?: string | undefined } | undefined;
  attachment_refs?: AttachmentRef[] | undefined;
  evidence_refs?: ProductRelationshipRef[] | undefined;
  relationship_refs?: ProductRelationshipRef[] | undefined;
  release_refs?: Array<{ id: string; title?: string | undefined }> | undefined;
}

type ProductRelationshipRef = {
  type: string;
  id: string;
  title?: string | undefined;
  development_plan_id?: string | undefined;
};

export interface ObjectDetailLayoutProps<T extends ProjectObjectDetail> {
  detail: T | undefined;
  error?: Error | null;
  isLoading: boolean;
  objectLabel: string;
  onSaveNarrative?: ((document: MarkdownDocument) => Promise<void> | void) | undefined;
  renderSections?: (detail: T) => ReactNode;
}

const allowedNarrativeBlocks: MarkdownBlockKind[] = ['paragraph', 'heading', 'list', 'blockquote', 'horizontal_rule', 'table', 'link', 'image'];

export function ObjectDetailLayout<T extends ProjectObjectDetail>({
  detail,
  error,
  isLoading,
  objectLabel,
  onSaveNarrative,
  renderSections,
}: ObjectDetailLayoutProps<T>) {
  const [markdown, setMarkdown] = useState(detail?.narrative_markdown ?? '');
  const [roleLens, setRoleLens] = useState('product');
  const [planTitle, setPlanTitle] = useState('');
  const [selectedDevelopmentPlanId, setSelectedDevelopmentPlanId] = useState('');
  const [linkedDevelopmentPlan, setLinkedDevelopmentPlan] = useState<ProductRelationshipRef>();
  const [isLinkPlanOpen, setIsLinkPlanOpen] = useState(false);
  const [generationGuidance, setGenerationGuidance] = useState('Preserve source decisions and generate a table-first Development Plan.');
  const [actionState, setActionState] = useState<{ status: 'idle' | 'running' | 'success' | 'error'; message?: string }>({ status: 'idle' });
  const { actorId } = useActorContext();
  const { projectId } = useProjectContext();
  const navigate = useNavigate();
  const plansQuery = useDevelopmentPlansQuery({ project_id: projectId });
  const attachmentApi = useMemo(() => createForgeloopAttachmentApi(), []);
  const developmentPlanItem = useMemo(
    () => detail?.relationship_refs?.find((ref) => ref.type === 'development_plan_item'),
    [detail?.relationship_refs],
  );
  const developmentPlan = useMemo(
    () => detail?.relationship_refs?.find((ref) => ref.type === 'development_plan'),
    [detail?.relationship_refs],
  );
  const availableDevelopmentPlans = useMemo(
    () => (plansQuery.data?.items ?? []) as Array<{ id: string; title?: string }>,
    [plansQuery.data?.items],
  );
  const activeDevelopmentPlan = linkedDevelopmentPlan ?? developmentPlan;

  useEffect(() => {
    setMarkdown(detail?.narrative_markdown ?? '');
  }, [detail?.id, detail?.narrative_markdown]);

  useEffect(() => {
    setPlanTitle(detail === undefined ? '' : `${detail.title} development plan`);
    setLinkedDevelopmentPlan(undefined);
    setSelectedDevelopmentPlanId('');
    setIsLinkPlanOpen(false);
  }, [detail?.id, detail?.title]);

  useEffect(() => {
    if (selectedDevelopmentPlanId.length > 0) return;
    const defaultPlanId = activeDevelopmentPlan?.id ?? availableDevelopmentPlans[0]?.id;
    if (defaultPlanId !== undefined) setSelectedDevelopmentPlanId(defaultPlanId);
  }, [activeDevelopmentPlan?.id, availableDevelopmentPlans, selectedDevelopmentPlanId]);

  if (isLoading) {
    return (
      <ProductPage family="document-workspace" ariaLabel={objectLabel}>
        <h1 className="mb-3 text-xl font-semibold text-text-primary">{objectLabel}</h1>
        <TypedDetailShell
          objectType={objectTypeForLabel(objectLabel)}
          table={
            <DocumentWorkspaceLayout
              document={
                <Section aria-label={`${objectLabel} narrative document`} title={`${objectLabel} document`} variant="panel">
                  <SurfaceStateIndicator label={`${objectLabel} Workspace`} state="loading" />
                  <InlineNotice title={`${objectLabel} is loading.`} tone="info" />
                </Section>
              }
            />
          }
        />
      </ProductPage>
    );
  }

  if (error || detail === undefined) {
    return (
      <ProductPage family="document-workspace" ariaLabel={objectLabel}>
        <h1 className="mb-3 text-xl font-semibold text-text-primary">{objectLabel}</h1>
        <TypedDetailShell
          objectType={objectTypeForLabel(objectLabel)}
          table={
            <DocumentWorkspaceLayout
              document={
                <Section aria-label={`${objectLabel} narrative document`} title={`${objectLabel} document`} variant="panel">
                  <SurfaceStateIndicator label={`${objectLabel} Workspace`} state={error ? 'error' : 'empty'} />
                  <InlineNotice title={`${objectLabel} was not found.`} tone="warning" />
                </Section>
              }
            />
          }
        />
      </ProductPage>
    );
  }

  const sourceRef = planningInputRefFor(detail);
  const driverLabel = driverLabelFor(detail.ref.type);
  const evidenceRefs = detail.evidence_refs ?? [];
  const attachmentRefs = detail.attachment_refs ?? [];
  const releaseRefs = detail.release_refs ?? [];
  const evidenceCount = evidenceRefs.length;
  const releaseLabel = formatReferenceSummary(releaseRefs, 'Not release scoped');
  const stateText = `${objectLabel} ${statusLabel(detail.status)}`;
  const nextActionTitle = developmentPlanItem ? 'Open item-scoped gate' : 'Create planning table';
  const nextActionDescription = developmentPlanItem
    ? 'Select the linked Development Plan Item to continue boundary brainstorming, Spec, Implementation Plan Doc, and execution gates.'
    : 'Create or link a Development Plan before downstream technical work can start.';
  const runAction = async (operation: () => Promise<unknown>, successMessage: string) => {
    setActionState({ status: 'running', message: 'Command is running.' });
    try {
      await operation();
      setActionState({ status: 'success', message: successMessage });
    } catch (commandError) {
      setActionState({
        status: 'error',
        message: commandError instanceof Error ? commandError.message : 'Command failed.',
      });
    }
  };
  const actionPanel = (
    <div className="grid gap-3">
      <div>
        <div className="font-semibold text-text-primary">{nextActionTitle}</div>
        <p className="mt-1 text-sm text-text-secondary">{nextActionDescription}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Dialog
          content={
            <DialogPanel>
              <label className="grid gap-1 text-sm font-semibold text-text-primary">
                Development Plan title
                <input
                  className="min-h-10 rounded-md border border-border bg-surface px-3 text-sm font-normal text-text-primary"
                  value={planTitle}
                  onChange={(event) => setPlanTitle(event.target.value)}
                />
              </label>
              <Button
                loading={actionState.status === 'running'}
                variant="primary"
                onClick={() =>
                  void runAction(
                    async () => {
                      const created = await createForgeloopCommandApi().createDevelopmentPlan({
                        actor_id: actorId,
                        project_id: projectId,
                        source_ref: sourceRef,
                        title: planTitle.trim() || `${detail.title} development plan`,
                      });
                      if (typeof created.id === 'string') navigate(`/development-plans/${created.id}`);
                    },
                    'Development Plan created and context manifest captured.',
                  )
                }
              >
                Create
              </Button>
            </DialogPanel>
          }
          description={`Create a table-first Development Plan linked to this ${objectLabel}.`}
          title="Create Development Plan"
        >
          <Button variant="primary">Create Development Plan</Button>
        </Dialog>
        <Button
          loading={actionState.status === 'running'}
          onClick={() =>
            void runAction(
              () =>
                createForgeloopCommandApi().generateDevelopmentPlanDraft({
                  actor_id: actorId,
                  project_id: projectId,
                  source_ref: sourceRef,
                  guidance: generationGuidance,
                }),
              'Development Plan draft generated with a context manifest.',
            )
          }
        >
          Generate Development Plan Draft with AI
        </Button>
        <Dialog
          content={
            <DialogPanel>
              <label className="grid gap-1 text-sm font-semibold text-text-primary">
                Development Plan
                <Select
                  aria-label="Development Plan"
                  options={availableDevelopmentPlans.map((plan) => ({ label: plan.title ?? plan.id, value: plan.id }))}
                  value={selectedDevelopmentPlanId}
                  onChange={(event) => setSelectedDevelopmentPlanId(event.target.value)}
                />
              </label>
              <Button
                disabled={selectedDevelopmentPlanId.length === 0}
                loading={actionState.status === 'running'}
                variant="primary"
                onClick={() =>
                  selectedDevelopmentPlanId.length === 0
                    ? undefined
                    : void runAction(
                        async () => {
                          await createForgeloopCommandApi().linkPlanningInputToDevelopmentPlan(sourceRef.type, sourceRef.id, selectedDevelopmentPlanId, {
                            actor_id: actorId,
                            rationale: `Linked from ${objectLabel} workspace.`,
                          });
                          const selectedPlan = availableDevelopmentPlans.find((plan) => plan.id === selectedDevelopmentPlanId);
                          setLinkedDevelopmentPlan({
                            type: 'development_plan',
                            id: selectedDevelopmentPlanId,
                            title: selectedPlan?.title ?? selectedDevelopmentPlanId,
                          });
                          setIsLinkPlanOpen(false);
                        },
                        'Existing Development Plan linked.',
                      )
                }
              >
                Link
              </Button>
            </DialogPanel>
          }
          description={`Link this ${objectLabel} to an existing Development Plan.`}
          open={isLinkPlanOpen}
          title="Link Existing Development Plan"
          onOpenChange={setIsLinkPlanOpen}
        >
          <Button disabled={availableDevelopmentPlans.length === 0} variant="secondary">
            Link Existing Development Plan
          </Button>
        </Dialog>
      </div>
      <label className="grid gap-1 text-sm font-semibold text-text-secondary">
        Regeneration feedback
        <Textarea
          aria-label="Regeneration feedback"
          className="min-h-16"
          value={generationGuidance}
          onChange={(event) => setGenerationGuidance(event.target.value)}
        />
      </label>
      {actionState.status !== 'idle' ? (
        <InlineNotice
          description={actionState.message}
          title={actionState.status === 'success' ? 'Command completed' : actionState.status === 'error' ? 'Command failed' : 'Command running'}
          tone={actionState.status === 'success' ? 'success' : actionState.status === 'error' ? 'danger' : 'info'}
        />
      ) : null}
      <InlineNotice
        description="Spec and Implementation Plan Doc generation are disabled here because they require an approved boundary on a selected Development Plan Item."
        title="Downstream artifact gates"
        tone="neutral"
      />
    </div>
  );

  return (
    <ProductPage
      family="document-workspace"
      ariaLabel={objectLabel}
    >
      <h1 className="mb-3 text-xl font-semibold text-text-primary">{objectLabel}</h1>
      <TypedDetailShell
        objectType={detail.ref.type}
        table={
          <DocumentWorkspaceLayout
            document={
              <Section
                actions={
                  <div className="flex flex-wrap items-center gap-2">
                    <SegmentedControl
                      ariaLabel="Role lens"
                      options={[
                        { label: 'Product', value: 'product' },
                        { label: 'Tech Lead', value: 'tech-lead' },
                        { label: 'Developer', value: 'developer' },
                        { label: 'QA', value: 'qa' },
                      ]}
                      value={roleLens}
                      onValueChange={setRoleLens}
                    />
                    <StatusPill tone="neutral">{roleLensLabel(roleLens)} lens</StatusPill>
                  </div>
                }
                aria-label={`${objectLabel} narrative document`}
                description="Edit the durable narrative here; downstream Spec and Implementation Plan Doc work starts from a Development Plan Item."
                title={detail.title}
                variant="panel"
              >
                <ForgeMarkdownEditor
                  allowedBlocks={allowedNarrativeBlocks}
                  attachments={detail.attachment_refs ?? []}
                  mode="edit"
                  objectRef={detail.ref}
                  onChange={setMarkdown}
                  onUploadAttachment={(file) =>
                    attachmentApi.uploadAttachment({
                      actorId,
                      file,
                      metadata: sourceNarrativeAttachmentMetadata(detail.ref, file),
                    })
                  }
                  validationPolicy={{ validation_version: '2026-05-23' }}
                  value={markdown}
                  {...(onSaveNarrative === undefined ? {} : { onSave: onSaveNarrative })}
                />
              </Section>
            }
            properties={
              <div className="grid gap-4">
                <Section aria-label={`${objectLabel} planning actions`} title={`${objectLabel} planning actions`} variant="subtle">
                  {actionPanel}
                </Section>
                <Section aria-label={`${objectLabel} properties`} title={`${objectLabel} properties`} variant="subtle">
                  <CompactMetadata
                    items={[
                      { label: 'Lifecycle', value: detail.status },
                      { label: 'Priority', value: detail.priority ?? 'Unscored' },
                      { label: 'Risk', value: detail.risk ?? 'Unscored' },
                      { label: driverLabel, value: detail.driver_actor_id ?? 'Unavailable' },
                      { label: 'Development Plan coverage', value: planningCoverage(detail, 'development_plan') },
                      { label: 'Plan Item coverage', value: planningCoverage(detail, 'plan_item') },
                      { label: 'Evidence refs', value: formatReferenceSummary(evidenceRefs, 'No evidence refs') },
                      { label: 'Attachment refs', value: formatAttachmentSummary(attachmentRefs) },
                      { label: 'Release refs', value: releaseLabel },
                      { label: 'Created', value: detail.audit?.created_at ?? 'Unavailable' },
                      { label: 'Updated', value: detail.audit?.updated_at ?? 'Unavailable' },
                      { label: 'Updated by', value: detail.audit?.updated_by_actor_id ?? 'Unavailable' },
                    ]}
                  />
                </Section>
                <Section aria-label="Linked planning" title="Linked planning" variant="subtle">
                  <div className="grid gap-2 text-sm">
                    {activeDevelopmentPlan ? (
                      <Link className="font-semibold text-primary hover:underline" to={relationshipHref(activeDevelopmentPlan)}>
                        {activeDevelopmentPlan.title ?? 'Open linked Development Plan'}
                      </Link>
                    ) : (
                      <p className="text-text-secondary">No Development Plan linked yet.</p>
                    )}
                    {developmentPlanItem ? (
                      <Link className="font-semibold text-primary hover:underline" to={relationshipHref(developmentPlanItem)}>
                        Open Development Plan Item In Governance Queue
                      </Link>
                    ) : null}
                  </div>
                </Section>
              </div>
            }
            attachments={<EvidencePanel detail={detail} objectLabel={objectLabel} />}
          />
        }
      />
      <Section title={`${detail.title} · ${statusLabel(detail.status)}`} variant="subtle">
        <div className="grid gap-2 text-sm text-text-secondary md:grid-cols-3">
          <p className="m-0">{stateText}</p>
          <p className="m-0">{`${roleLensLabel(roleLens)} lens · ${driverLabel} ${detail.driver_actor_id ?? 'Unavailable'}`}</p>
          <p className="m-0">{`Risk ${detail.risk ?? 'unscored'} · Evidence ${evidenceCount} · Release ${releaseLabel}`}</p>
        </div>
      </Section>
      <Tabs
        ariaLabel={`${objectLabel} sections`}
        items={[
          {
            label: 'Brief',
            value: 'brief',
            content: (
              <Section description="Summary context stays below the action-first workspace." title="Brief">
                <p className="m-0 text-sm text-text-secondary">
                  {`${objectLabel} narrative and planning context are visible in the workspace above.`}
                </p>
              </Section>
            ),
          },
          {
            label: 'Development Plan',
            value: 'development-plan',
            content: (
              <Section title="Development Plan relationship">
                <div className="grid gap-3 text-sm">
                  {activeDevelopmentPlan ? (
                    <Link className="font-semibold text-primary hover:underline" to={relationshipHref(activeDevelopmentPlan)}>
                      {activeDevelopmentPlan.title ?? 'Open Development Plan'}
                    </Link>
                  ) : (
                    <p className="text-text-secondary">No Development Plan linked yet.</p>
                  )}
                  {developmentPlanItem ? (
                    <Link className="font-semibold text-primary hover:underline" to={relationshipHref(developmentPlanItem)}>
                      Open Development Plan Item
                    </Link>
                  ) : null}
                </div>
              </Section>
            ),
          },
          { label: 'Documents', value: 'documents', content: <GatePlaceholder label="Spec and Implementation Plan Doc documents" /> },
          { label: 'Execution', value: 'execution', content: <GatePlaceholder label="Execution" /> },
          { label: 'QA', value: 'qa', content: <GatePlaceholder label="QA" /> },
          { label: 'Release', value: 'release', content: <GatePlaceholder label="Release" /> },
          { label: 'Evidence', value: 'evidence', content: <EvidencePanel detail={detail} objectLabel={objectLabel} /> },
        ]}
      />
      {renderSections?.(detail)}
    </ProductPage>
  );
}

function GatePlaceholder({ label }: { label: string }) {
  return (
    <Section title={label}>
      <InlineNotice
        description="Choose a Development Plan Item to operate this gate. Typed document workspaces do not generate downstream artifacts directly."
        title="Item-scoped gate"
        tone="neutral"
      />
    </Section>
  );
}

function sourceNarrativeAttachmentMetadata(objectRef: EditableObjectRef, file: File): AttachmentUploadMetadata {
  const label = readableAttachmentLabel(file.name);
  return {
    object_type: objectRef.type,
    object_id: objectRef.id,
    evidence_category: evidenceCategoryForFile(file),
    caption: label,
    ...(file.type.startsWith('image/') ? { alt_text: label } : {}),
    visibility: 'object',
  };
}

function evidenceCategoryForFile(file: File): AttachmentUploadMetadata['evidence_category'] {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.includes('log') || /\.log$/i.test(file.name)) return 'log';
  return 'document';
}

function readableAttachmentLabel(filename: string): string {
  const trimmed = filename.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim();
  return trimmed.length > 0 ? trimmed : 'Narrative attachment';
}

function TypedDetailShell({
  objectType,
  table,
}: {
  objectType: EditableObjectRef['type'];
  table: ReactNode;
}) {
  switch (objectType) {
    case 'bug':
      return <BugWorkspace table={table} />;
    case 'initiative':
      return <InitiativeWorkspace table={table} />;
    case 'tech_debt':
      return <TechDebtWorkspace table={table} />;
    case 'requirement':
      return <RequirementWorkspace table={table} />;
    default:
      return <RequirementWorkspace table={table} />;
  }
}

function EvidencePanel({ detail, objectLabel }: { detail: ProjectObjectDetail; objectLabel: string }) {
  return (
    <Section title={`${objectLabel} evidence`}>
      {detail.attachment_refs?.length ? (
        <EvidenceAttachments attachments={detail.attachment_refs} />
      ) : (
        <p className="text-sm text-text-secondary">No evidence linked.</p>
      )}
    </Section>
  );
}

function relationshipHref(ref: ProductRelationshipRef): string {
  switch (ref.type) {
    case 'development_plan':
      return `/development-plans/${encodeURIComponent(ref.id)}`;
    case 'development_plan_item':
      return `/development-plans/${encodeURIComponent(ref.development_plan_id ?? 'unknown')}/items/${encodeURIComponent(ref.id)}`;
    case 'bug':
      return `/bugs/${encodeURIComponent(ref.id)}`;
    case 'requirement':
      return `/requirements/${encodeURIComponent(ref.id)}`;
    case 'initiative':
      return `/initiatives/${encodeURIComponent(ref.id)}`;
    case 'tech_debt':
      return `/tech-debt/${encodeURIComponent(ref.id)}`;
    case 'release':
      return `/releases/${encodeURIComponent(ref.id)}`;
    default:
      return '/my-work';
  }
}

function roleLensLabel(value: string): string {
  switch (value) {
    case 'tech-lead':
      return 'Tech Lead';
    case 'developer':
      return 'Developer';
    case 'qa':
      return 'QA';
    default:
      return 'Product';
  }
}

function statusLabel(status: string): string {
  return status.replaceAll('/', ' / ');
}

function planningInputRefFor(detail: ProjectObjectDetail) {
  if (
    detail.ref.type === 'initiative' ||
    detail.ref.type === 'requirement' ||
    detail.ref.type === 'bug' ||
    detail.ref.type === 'tech_debt'
  ) {
    return { type: detail.ref.type, id: detail.ref.id, title: detail.title } as const;
  }
  return { type: 'requirement', id: detail.ref.id, title: detail.title } as const;
}

function driverLabelFor(type: EditableObjectRef['type']): string {
  switch (type) {
    case 'bug':
      return 'Bug Driver';
    case 'initiative':
      return 'Initiative Driver';
    case 'tech_debt':
      return 'Tech Debt Driver';
    case 'requirement':
      return 'Requirement Driver';
    default:
      return 'Driver';
  }
}

function objectTypeForLabel(label: string): EditableObjectRef['type'] {
  switch (label) {
    case 'Bug':
      return 'bug';
    case 'Initiative':
      return 'initiative';
    case 'Tech Debt':
      return 'tech_debt';
    default:
      return 'requirement';
  }
}

function planningCoverage(detail: ProjectObjectDetail, kind: 'development_plan' | 'plan_item'): string {
  const coverage = (
    detail as ProjectObjectDetail & {
      planning_coverage?: { development_plan_count: number; plan_item_count: number; uncovered: boolean };
    }
  ).planning_coverage;
  if (coverage === undefined) return 'Unavailable';
  return kind === 'development_plan' ? `${coverage.development_plan_count} linked` : `${coverage.plan_item_count} governed`;
}

function formatReferenceSummary(refs: readonly { id: string; title?: string | undefined }[], emptyLabel: string): string {
  if (refs.length === 0) return emptyLabel;
  const labels = refs.map((ref) => ref.title ?? ref.id);
  return labels.length === 1 ? labels[0] ?? emptyLabel : `${labels.length} refs: ${labels.join(', ')}`;
}

function formatAttachmentSummary(attachments: readonly AttachmentRef[]): string {
  if (attachments.length === 0) return 'No attachment refs';
  const labels = attachments.map((attachment) => attachment.caption ?? attachment.filename ?? attachment.id);
  return labels.length === 1 ? labels[0] ?? '1 attachment ref' : `${labels.length} refs: ${labels.join(', ')}`;
}
