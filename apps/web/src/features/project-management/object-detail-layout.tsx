import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import type { AttachmentRef, EditableObjectRef, MarkdownBlockKind, MarkdownDocument } from '@forgeloop/contracts';

import { createForgeloopCommandApi } from '../../shared/api/commands';
import { useActorContext } from '../../shared/context/actor-context';
import { useProjectContext } from '../../shared/context/project-context';
import { ActionRail, DetailLayout, MetadataGrid, PageHeader, Section } from '../../shared/layout';
import { Button, Dialog, DialogPanel, EvidenceAttachments, ForgeMarkdownEditor, InlineNotice, SegmentedControl, StatusPill, Tabs, Textarea } from '../../shared/ui';
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
  const [generationGuidance, setGenerationGuidance] = useState('Preserve source decisions and generate a table-first Development Plan.');
  const [actionState, setActionState] = useState<{ status: 'idle' | 'running' | 'success' | 'error'; message?: string }>({ status: 'idle' });
  const { actorId } = useActorContext();
  const { projectId } = useProjectContext();
  const developmentPlanItem = useMemo(
    () => detail?.relationship_refs?.find((ref) => ref.type === 'development_plan_item'),
    [detail?.relationship_refs],
  );
  const developmentPlan = useMemo(
    () => detail?.relationship_refs?.find((ref) => ref.type === 'development_plan'),
    [detail?.relationship_refs],
  );

  useEffect(() => {
    setMarkdown(detail?.narrative_markdown ?? '');
  }, [detail?.id, detail?.narrative_markdown]);

  useEffect(() => {
    setPlanTitle(detail === undefined ? '' : `${detail.title} development plan`);
  }, [detail?.id, detail?.title]);

  if (isLoading) {
    return (
      <DetailLayout header={<PageHeader subtitle={`Loading ${objectLabel.toLowerCase()} context.`} title={objectLabel} />}>
        <SurfaceStateIndicator label={`${objectLabel} Source Object Workspace`} state="loading" />
        <InlineNotice title={`${objectLabel} is loading.`} tone="info" />
      </DetailLayout>
    );
  }

  if (error || detail === undefined) {
    return (
      <DetailLayout header={<PageHeader subtitle={`${objectLabel} detail could not be loaded.`} title={objectLabel} />}>
        <SurfaceStateIndicator label={`${objectLabel} Source Object Workspace`} state={error ? 'error' : 'empty'} />
        <InlineNotice title={`${objectLabel} was not found.`} tone="warning" />
      </DetailLayout>
    );
  }

  const surfaceState = surfaceStateForDetail(detail);
  const sourceRef = sourceObjectRefFor(detail);
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

  return (
    <DetailLayout
      header={
        <PageHeader
          actions={
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
          eyebrow="Source Object Workspace"
          subtitle={`${detail.title} · ${statusLabel(detail.status)} · ${detail.risk ?? 'Unscored'} risk`}
          title={objectLabel}
        />
      }
      actionRail={
        <ActionRail ariaLabel="Next action" title="Next action">
          <InlineNotice
            description={
              developmentPlanItem
                ? 'Select the linked Development Plan Item to continue boundary brainstorming, Spec, Execution Plan, and execution gates.'
                : 'Create or link a Development Plan before downstream technical work can start.'
            }
            title={developmentPlanItem ? 'Open item-scoped gate' : 'Create planning table'}
            tone={developmentPlanItem ? 'info' : 'warning'}
          />
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
                      () =>
                        createForgeloopCommandApi().createDevelopmentPlan({
                          actor_id: actorId,
                          project_id: projectId,
                          source_ref: sourceRef,
                          title: planTitle.trim() || `${detail.title} development plan`,
                        }),
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
            <Button className="w-full justify-start" variant="primary">Create Development Plan</Button>
          </Dialog>
          <Textarea
            aria-label="Regeneration feedback"
            value={generationGuidance}
            onChange={(event) => setGenerationGuidance(event.target.value)}
          />
          <Button
            className="w-full justify-start"
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
          <Button
            className="w-full justify-start"
            disabled={developmentPlan === undefined}
            onClick={() =>
              developmentPlan === undefined
                ? undefined
                : void runAction(
                    () =>
                      createForgeloopCommandApi().linkSourceObjectToDevelopmentPlan(sourceRef.type, sourceRef.id, developmentPlan.id, {
                        actor_id: actorId,
                        rationale: 'Linked from source object workspace.',
                      }),
                    'Existing Development Plan linked.',
                  )
            }
          >
            Link Existing Development Plan
          </Button>
          <Button
            className="w-full justify-start"
            disabled={developmentPlan === undefined}
            onClick={() =>
              developmentPlan === undefined
                ? undefined
                : void runAction(
	                    () =>
	                      createForgeloopCommandApi().createDevelopmentPlanItem(developmentPlan.id, {
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
          {developmentPlanItem ? (
            <Link
              className="inline-flex min-h-10 items-center justify-center rounded-md border border-border bg-surface px-4 text-sm font-semibold text-primary hover:border-primary hover:bg-primary-soft"
              to={relationshipHref(developmentPlanItem)}
            >
              Open Development Plan Item In Governance Queue
            </Link>
          ) : null}
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
        </ActionRail>
      }
    >
      <SurfaceStateIndicator label={`${objectLabel} Source Object Workspace`} state={surfaceState} />
      <Tabs
        ariaLabel="Source object sections"
        items={[
          {
            label: 'Brief',
            value: 'brief',
            content: (
              <Section
                actions={<StatusPill tone="neutral">{roleLensLabel(roleLens)} lens</StatusPill>}
                description="The source narrative remains editable here; delivery work starts from Development Plan rows."
                title={detail.title}
              >
                <div className="grid gap-4">
                  <ForgeMarkdownEditor
                    allowedBlocks={allowedNarrativeBlocks}
                    attachments={detail.attachment_refs ?? []}
                    mode="edit"
                    objectRef={detail.ref}
                    onChange={setMarkdown}
                    onUploadAttachment={() => Promise.reject(new Error('Attachment uploads are not enabled on this route yet.'))}
                    validationPolicy={{ validation_version: '2026-05-23' }}
                    value={markdown}
                    {...(onSaveNarrative === undefined ? {} : { onSave: onSaveNarrative })}
                  />
                </div>
              </Section>
            ),
          },
          {
            label: 'Development Plan',
            value: 'development-plan',
            content: (
              <Section title="Development Plan relationship">
                <div className="grid gap-3 text-sm">
                  {developmentPlan ? (
                    <Link className="font-semibold text-primary hover:underline" to={relationshipHref(developmentPlan)}>
                      {developmentPlan.title ?? 'Open Development Plan'}
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
          { label: 'Specs & Execution Plans', value: 'specs-execution-plans', content: <GatePlaceholder label="Specs and Execution Plans" /> },
          { label: 'Execution', value: 'execution', content: <GatePlaceholder label="Execution" /> },
          { label: 'QA', value: 'qa', content: <GatePlaceholder label="QA" /> },
          { label: 'Release', value: 'release', content: <GatePlaceholder label="Release" /> },
          { label: 'Evidence', value: 'evidence', content: <EvidencePanel detail={detail} /> },
        ]}
      />
      <Section title="Structured fields">
        <MetadataGrid
          items={[
            { label: 'Type', value: objectLabel },
            { label: 'Lifecycle', value: <StatusPill tone="neutral">{detail.status}</StatusPill> },
            { label: 'Risk', value: detail.risk ?? 'Unscored' },
            { label: 'Driver', value: detail.driver_actor_id ?? 'Unassigned' },
            { label: 'Release', value: detail.release_refs?.[0]?.title ?? detail.release_refs?.[0]?.id ?? 'Not release scoped' },
            { label: 'Freshness', value: 'Current source revision' },
          ]}
        />
      </Section>
      {renderSections?.(detail)}
    </DetailLayout>
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
      return `/specs-plans?development_plan_id=${encodeURIComponent(ref.id)}`;
    case 'development_plan_item':
      return `/specs-plans?development_plan_id=${encodeURIComponent(ref.development_plan_id ?? 'unknown')}&development_plan_item_id=${encodeURIComponent(ref.id)}`;
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
