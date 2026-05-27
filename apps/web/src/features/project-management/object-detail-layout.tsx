import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import type { AttachmentRef, AttachmentUploadMetadata, EditableObjectRef, MarkdownBlockKind, MarkdownDocument } from '@forgeloop/contracts';

import { createForgeloopAttachmentApi } from '../../shared/api/attachments';
import { createForgeloopCommandApi } from '../../shared/api/commands';
import { useDevelopmentPlansQuery } from '../../shared/api/hooks';
import { useActorContext } from '../../shared/context/actor-context';
import { useProjectContext } from '../../shared/context/project-context';
import { CompactMetadata, DocumentWorkspaceLayout, ProductPage, Section } from '../../shared/layout';
import { Button, Dialog, DialogPanel, EvidenceAttachments, ForgeMarkdownEditor, InlineNotice, Select, SegmentedControl, StatusPill, Tabs, Textarea } from '../../shared/ui';
import { stateFromStatus, SurfaceStateIndicator, type SurfaceState } from './surface-state';

export interface ProjectObjectDetail {
  id: string;
  ref: EditableObjectRef;
  title: string;
  status: string;
  priority?: string | undefined;
  risk?: string | undefined;
  driver_actor_id?: string | undefined;
  narrative_markdown: string;
  attachment_refs?: AttachmentRef[] | undefined;
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
      <ProductPage family="source-document" heading={objectLabel}>
        <DocumentWorkspaceLayout
          document={
            <Section aria-label="Source narrative document" title={`${objectLabel} source document`} variant="panel">
              <SurfaceStateIndicator label={`${objectLabel} Source Object Workspace`} state="loading" />
              <InlineNotice title={`${objectLabel} is loading.`} tone="info" />
            </Section>
          }
        />
      </ProductPage>
    );
  }

  if (error || detail === undefined) {
    return (
      <ProductPage family="source-document" heading={objectLabel}>
        <DocumentWorkspaceLayout
          document={
            <Section aria-label="Source narrative document" title={`${objectLabel} source document`} variant="panel">
              <SurfaceStateIndicator label={`${objectLabel} Source Object Workspace`} state={error ? 'error' : 'empty'} />
              <InlineNotice title={`${objectLabel} was not found.`} tone="warning" />
            </Section>
          }
        />
      </ProductPage>
    );
  }

  const surfaceState = surfaceStateForDetail(detail);
  const sourceRef = sourceObjectRefFor(detail);
  const evidenceCount = detail.attachment_refs?.length ?? 0;
  const releaseLabel = detail.release_refs?.[0]?.title ?? detail.release_refs?.[0]?.id ?? 'Not release scoped';
  const stateText = `${objectLabel} ${statusLabel(detail.status)}`;
  const nextActionTitle = developmentPlanItem ? 'Open item-scoped gate' : 'Create planning table';
  const nextActionDescription = developmentPlanItem
    ? 'Select the linked Development Plan Item to continue boundary brainstorming, Spec, Execution Plan, and execution gates.'
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
          description="Create a table-first Development Plan linked to this source object."
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
          Generate Development Plan
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
                          await createForgeloopCommandApi().linkSourceObjectToDevelopmentPlan(sourceRef.type, sourceRef.id, selectedDevelopmentPlanId, {
                            actor_id: actorId,
                            rationale: 'Linked from source object workspace.',
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
          description="Link this source object to an existing Development Plan."
          open={isLinkPlanOpen}
          title="Link Existing Development Plan"
          onOpenChange={setIsLinkPlanOpen}
        >
          <Button disabled={availableDevelopmentPlans.length === 0} variant="secondary">
            Link Existing Development Plan
          </Button>
        </Dialog>
        <Button
          disabled={activeDevelopmentPlan === undefined}
          onClick={() =>
            activeDevelopmentPlan === undefined
              ? undefined
              : void runAction(
                  () =>
                    createForgeloopCommandApi().createDevelopmentPlanItem(activeDevelopmentPlan.id, {
                      title: `${detail.title} implementation boundary`,
                      summary: 'Generated from source object workspace.',
                      responsible_role: 'tech_lead',
                      ...(detail.driver_actor_id === undefined ? {} : { driver_actor_id: detail.driver_actor_id }),
                      risk: riskForCommand(detail.risk),
                      affected_surfaces: [],
                      dependency_hints: [],
                      release_impact: 'release_scoped',
                    }),
                  'Development Plan row added for boundary brainstorming.',
                )
          }
        >
          Add Row To Existing Development Plan
        </Button>
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
        description="Spec and Execution Plan generation are disabled here because they require an approved boundary on a selected Development Plan Item."
        title="Downstream artifact gates"
        tone="neutral"
      />
    </div>
  );

  return (
    <ProductPage
      family="source-document"
      heading={objectLabel}
      toolbar={
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
      }
    >
      <DocumentWorkspaceLayout
        document={
        <Section
          actions={<StatusPill tone="neutral">{roleLensLabel(roleLens)} lens</StatusPill>}
          aria-label="Source narrative document"
          description="Edit the durable source narrative here; downstream Spec and Execution Plan work starts from a Development Plan Item."
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
          <Section aria-label="Source object actions" title="Source object actions" variant="subtle">
            {actionPanel}
          </Section>
          <Section aria-label="Source metadata" title="Source metadata" variant="subtle">
            <CompactMetadata
              items={[
                { label: 'Type', value: objectLabel },
                { label: 'Lifecycle', value: detail.status },
                { label: 'Risk', value: detail.risk ?? 'Unscored' },
                { label: 'Driver', value: detail.driver_actor_id ?? 'Unassigned' },
                { label: 'Release', value: releaseLabel },
                { label: 'Evidence', value: `${evidenceCount} ${evidenceCount === 1 ? 'attachment' : 'attachments'}` },
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
        attachments={<EvidencePanel detail={detail} />}
      />
      <Section title={`${detail.title} · ${statusLabel(detail.status)}`} variant="subtle">
        <div className="grid gap-2 text-sm text-text-secondary md:grid-cols-3">
          <p className="m-0">{stateText}</p>
          <p className="m-0">{`${roleLensLabel(roleLens)} lens · ${detail.driver_actor_id ?? 'Unassigned driver'}`}</p>
          <p className="m-0">{`Risk ${detail.risk ?? 'unscored'} · Evidence ${evidenceCount} · Release ${releaseLabel}`}</p>
        </div>
      </Section>
      <Tabs
        ariaLabel="Source object sections"
        items={[
          {
            label: 'Brief',
            value: 'brief',
            content: (
              <Section description="Summary context stays below the action-first workspace." title="Brief">
                <SurfaceStateIndicator label={`${objectLabel} Source Object Workspace`} state={surfaceState} />
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
          { label: 'Documents', value: 'documents', content: <GatePlaceholder label="Spec and Execution Plan documents" /> },
          { label: 'Execution', value: 'execution', content: <GatePlaceholder label="Execution" /> },
          { label: 'QA', value: 'qa', content: <GatePlaceholder label="QA" /> },
          { label: 'Release', value: 'release', content: <GatePlaceholder label="Release" /> },
          { label: 'Evidence', value: 'evidence', content: <EvidencePanel detail={detail} /> },
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
        description="Choose a Development Plan Item to operate this gate. Source objects do not generate downstream artifacts directly."
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
  return trimmed.length > 0 ? trimmed : 'Source narrative attachment';
}

function EvidencePanel({ detail }: { detail: ProjectObjectDetail }) {
  return (
    <Section title="Evidence attachments">
      {detail.attachment_refs?.length ? (
        <EvidenceAttachments attachments={detail.attachment_refs} />
      ) : (
        <p className="text-sm text-text-secondary">No evidence attachments linked.</p>
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

function surfaceStateForDetail(detail: ProjectObjectDetail): SurfaceState | undefined {
  if ((detail.relationship_refs ?? []).length === 0) return 'empty';
  return stateFromStatus(detail.status);
}

function sourceObjectRefFor(detail: ProjectObjectDetail) {
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

function riskForCommand(risk: string | undefined): 'low' | 'medium' | 'high' | 'critical' {
  if (risk === 'low' || risk === 'medium' || risk === 'high' || risk === 'critical') return risk;
  return 'medium';
}
