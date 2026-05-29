import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';

import { createForgeloopCommandApi } from '../../shared/api/commands';
import { useDevelopmentPlanQuery } from '../../shared/api/hooks';
import { queryKeys } from '../../shared/api/query-keys';
import { useActorContext } from '../../shared/context/actor-context';
import { CompactMetadata, DevelopmentPlanWorkspace, GateProgress, PreviewPane, ProductPage, Section } from '../../shared/layout';
import { Badge, Button, Checkbox, Dialog, DialogPanel, Drawer, EmptyState, Field, InlineNotice, Input, Textarea } from '../../shared/ui';
import {
  currentPlanItemGate,
  developmentPlanItemViewModel,
  developmentPlanWorkspaceViewModel,
  itemGateProgress,
} from './development-plan-view-model';
import { DevelopmentPlanTable, type DevelopmentPlanItemRow, formatValue } from './development-plan-table';

type DevelopmentPlanProjection = {
  id: string;
  title: string;
  status?: string;
  source_refs?: Array<{ type: string; id: string; title?: string }>;
  items?: DevelopmentPlanItemRow[];
  updated_at?: string;
};

export function DevelopmentPlanDetailRoute() {
  const { developmentPlanId } = useParams();
  const { actorId } = useActorContext();
  const queryClient = useQueryClient();
  const query = useDevelopmentPlanQuery(developmentPlanId);
  const plan = query.data as DevelopmentPlanProjection | undefined;
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isRegenerateOpen, setIsRegenerateOpen] = useState(false);
  const [isManifestOpen, setIsManifestOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [regenerationFeedback, setRegenerationFeedback] = useState('');
  const [preservePriorDecisions, setPreservePriorDecisions] = useState(true);
  const [selectedItemId, setSelectedItemId] = useState<string>();
  const [status, setStatus] = useState<string>();

  const rows: DevelopmentPlanItemRow[] = (plan?.items ?? []).map((item) => ({
    ...item,
    development_plan_id: developmentPlanId ?? item.development_plan_id,
    ...(plan?.source_refs === undefined ? {} : { source_refs: plan.source_refs }),
  }));
  const selectedItem = rows.find((item) => item.id === selectedItemId) ?? rows[0];
  const viewModel = useMemo(
    () => developmentPlanWorkspaceViewModel(plan === undefined ? [] : [{ ...plan, items: rows }], plan?.id, selectedItem?.id),
    [plan, rows, selectedItem?.id],
  );

  async function addPlanItem() {
    if (developmentPlanId === undefined) return;
    setStatus('Saving Plan Item.');
    await createForgeloopCommandApi().createDevelopmentPlanItem(developmentPlanId, {
      title: title.trim() || 'New Plan Item',
      summary: summary.trim() || 'Manual Plan Item created from the Development Plan workspace.',
      responsible_role: 'developer',
      driver_actor_id: actorId,
      risk: 'medium',
      affected_surfaces: [],
      dependency_hints: [],
      release_impact: 'release_scoped',
    });
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.developmentPlan(developmentPlanId) }),
      queryClient.invalidateQueries({ queryKey: ['development-plans'] }),
    ]);
    setIsAddOpen(false);
    setStatus('Plan Item saved.');
  }

  async function generateMissingPlanItems() {
    if (developmentPlanId === undefined) return;
    setStatus('Generating missing Plan Items with AI.');
    await createForgeloopCommandApi().regenerateDevelopmentPlanDraft(developmentPlanId, {
      actor_id: actorId,
      feedback: 'Generate missing Plan Items from linked typed refs. Keep existing Plan Items unchanged unless they are explicitly stale.',
      preserve_prior_decisions: true,
    });
    await queryClient.invalidateQueries({ queryKey: queryKeys.developmentPlan(developmentPlanId) });
    setStatus('Missing Plan Items generated with AI.');
  }

  async function regenerate() {
    if (developmentPlanId === undefined) return;
    setStatus('Regenerating Development Plan with guidance.');
    await createForgeloopCommandApi().regenerateDevelopmentPlanDraft(developmentPlanId, {
      actor_id: actorId,
      feedback: regenerationFeedback.trim() || 'Regenerate missing or stale Plan Items from the current typed refs.',
      preserve_prior_decisions: preservePriorDecisions,
    });
    await queryClient.invalidateQueries({ queryKey: queryKeys.developmentPlan(developmentPlanId) });
    setIsRegenerateOpen(false);
    setStatus('Development Plan regenerated with guidance.');
  }

  return (
    <ProductPage family="planning-table" ariaLabel={plan?.title ?? 'Development Plan'}>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-normal text-text-secondary">Development Plan workspace</p>
          <h1 className="mt-1 text-2xl font-semibold text-text-primary">{plan?.title ?? 'Development Plan'}</h1>
        </div>
        {query.isLoading ? <InlineNotice title="Loading Development Plan." tone="info" /> : null}
        {query.isError ? <InlineNotice title="Development Plan could not be loaded." tone="danger" /> : null}
      </div>

      <DevelopmentPlanWorkspace
        toolbar={
          <div className="sticky top-0 z-sticky flex min-w-0 flex-wrap items-center gap-2 border-b border-border bg-background/95 pb-2 backdrop-blur lg:flex-nowrap lg:overflow-x-auto">
            <PlanTableContext plan={plan} viewModel={viewModel} />
            <div className="flex flex-wrap items-center gap-2 lg:shrink-0 lg:flex-nowrap">
              <Button onClick={() => setIsAddOpen(true)} type="button">Add Plan Item</Button>
              <Button onClick={() => void generateMissingPlanItems()} type="button" variant="secondary">AI generate missing Plan Items</Button>
              <Button onClick={() => setIsRegenerateOpen(true)} type="button" variant="secondary">Regenerate with guidance</Button>
              <Button onClick={() => setIsManifestOpen(true)} type="button" variant="secondary">Show context manifest</Button>
            </div>
          </div>
        }
        table={
          <section className="grid min-w-0 content-start gap-3 lg:min-h-[70vh]" data-plan-items-table="" data-primary-work-surface="">
            {status ? <InlineNotice title={status} tone="info" /> : null}
            <Section title="Development Plan Items">
              {plan === undefined ? (
                <EmptyState title={query.isLoading ? 'Loading Development Plan.' : 'Development Plan not found.'} />
              ) : (
                <DevelopmentPlanTable items={rows} selectedItemId={selectedItem?.id} onSelectItem={(item) => setSelectedItemId(item.id)} />
              )}
            </Section>
          </section>
        }
        inspector={plan === undefined ? undefined : <SelectedPlanItemPanel item={selectedItem} />}
      />

      <Dialog
        content={
          <DialogPanel>
            <div className="grid gap-4">
              <Field label="Plan Item title">
                <Input aria-label="Plan Item title" onChange={(event) => setTitle(event.target.value)} value={title} />
              </Field>
              <Field label="Summary">
                <Textarea aria-label="Summary" onChange={(event) => setSummary(event.target.value)} value={summary} />
              </Field>
              <Button onClick={() => void addPlanItem()} type="button">Save Plan Item</Button>
            </div>
          </DialogPanel>
        }
        open={isAddOpen}
        title="Add Plan Item"
        onOpenChange={setIsAddOpen}
      />
      <Dialog
        content={
          <DialogPanel>
            <div className="grid gap-4">
              <Field label="Regeneration feedback">
                <Textarea
                  aria-label="Regeneration feedback"
                  onChange={(event) => setRegenerationFeedback(event.target.value)}
                  placeholder="Describe which Plan Items to preserve, split, add, or re-scope."
                  value={regenerationFeedback}
                />
              </Field>
              <Checkbox
                checked={preservePriorDecisions}
                label="Preserve prior decisions"
                onChange={(event) => setPreservePriorDecisions(event.target.checked)}
              />
              <Button onClick={() => void regenerate()} type="button">Regenerate with guidance</Button>
            </div>
          </DialogPanel>
        }
        open={isRegenerateOpen}
        title="Regenerate Development Plan"
        onOpenChange={setIsRegenerateOpen}
      />
      <Drawer
        content={
          <div className="grid gap-3 text-sm">
            <p>Context manifests capture typed refs, prior decisions, and repository context used by AI regeneration.</p>
            <p>Current regeneration preference: {preservePriorDecisions ? 'preserve prior decisions' : 'allow AI to propose changed decisions for review'}.</p>
          </div>
        }
        open={isManifestOpen}
        title="Context manifest"
        onOpenChange={setIsManifestOpen}
      />
    </ProductPage>
  );
}

function PlanTableContext({
  plan,
  viewModel,
}: {
  plan: DevelopmentPlanProjection | undefined;
  viewModel: ReturnType<typeof developmentPlanWorkspaceViewModel>;
}) {
  const selectedPlan = viewModel.selectedPlan;
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm text-text-secondary lg:shrink-0 lg:flex-nowrap">
      <p className="m-0">Status: {formatValue(plan?.status)}</p>
      <p className="m-0">Typed refs: {selectedPlan?.typedRefs.join(', ') ?? 'not linked'}</p>
      <p className="m-0">{selectedPlan?.itemCount ?? 0} Plan Items · {selectedPlan?.blockedCount ?? 0} blocked</p>
      <p className="m-0">Gate distribution: {selectedPlan?.gateDistribution ?? 'Unavailable'}</p>
    </div>
  );
}

function SelectedPlanItemPanel({ item }: { item: DevelopmentPlanItemRow | undefined }) {
  if (item === undefined) {
    return (
      <PreviewPane aria-label="Selected Plan Item inspector" meta="No Plan Item selected" title="Selected Plan Item inspector">
        <EmptyState title="Select a Plan Item." />
      </PreviewPane>
    );
  }

  const viewModel = developmentPlanItemViewModel(item);
  const currentGate = currentPlanItemGate(item);
  const planningInputContext = item.source_refs?.map((ref) => ref.title ?? ref.id).filter((value): value is string => value !== undefined).join(', ') || 'Typed refs unavailable';

  return (
    <PreviewPane
      actions={
        <Link className="inline-flex min-h-10 items-center justify-center rounded-md border border-primary bg-primary px-4 text-sm font-semibold text-white" to={`/development-plans/${item.development_plan_id}/items/${item.id}`}>
          Open Plan Item
        </Link>
      }
      aria-label="Selected Plan Item inspector"
      meta={`Current gate: ${currentGate.label} · ${formatValue(currentGate.state)}`}
      title="Selected Plan Item inspector"
    >
      <div className="grid content-start gap-4">
        <div className="grid gap-1">
          <Badge tone={item.risk === 'high' || item.risk === 'critical' ? 'warning' : 'neutral'}>{formatValue(item.risk)}</Badge>
          <h3 className="text-base font-semibold text-text-primary">{item.title}</h3>
          <p className="text-sm text-text-secondary">{viewModel.previewSummary}</p>
          <p className="text-sm font-semibold text-text-primary">Next action: {viewModel.nextAction}</p>
        </div>
        <GateProgress
          currentGateId={currentGate.label}
          gates={itemGateProgress(item).map((gate) => ({ id: gate.label, label: gate.label, status: formatValue(gate.state) }))}
        />
        <CompactMetadata
          items={[
            { label: 'Current gate', value: `${currentGate.label}: ${formatValue(currentGate.state)}` },
            { label: 'Blocker / risk', value: viewModel.riskSignal },
            { label: 'Driver', value: item.driver_actor_id ?? 'Unassigned' },
            { label: 'Responsible role', value: formatValue(item.responsible_role) },
            { label: 'Reviewer', value: item.reviewer_actor_id ?? 'Unassigned' },
            { label: 'Typed document context', value: planningInputContext },
            { label: 'Gate evidence', value: viewModel.criticalEvidence[0]?.compactText ?? 'Gate evidence unavailable' },
            ...viewModel.secondaryMetadata.map((metadata) => ({ label: metadata.label, value: metadata.value })),
          ]}
        />
      </div>
    </PreviewPane>
  );
}
