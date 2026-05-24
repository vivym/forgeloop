import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';

import { createForgeloopCommandApi } from '../../shared/api/commands';
import { useDevelopmentPlanQuery } from '../../shared/api/hooks';
import { queryKeys } from '../../shared/api/query-keys';
import { useActorContext } from '../../shared/context/actor-context';
import { PageHeader, Section } from '../../shared/layout';
import { Badge, Button, Checkbox, Dialog, DialogPanel, Drawer, EmptyState, Field, InlineNotice, Input, StatusPill, Textarea } from '../../shared/ui';
import { SurfaceStateIndicator } from '../project-management/surface-state';
import { DevelopmentPlanTable, type DevelopmentPlanItemRow, formatValue, statusTone } from './development-plan-table';

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

  const rows = (plan?.items ?? []).map((item) => ({ ...item, development_plan_id: developmentPlanId ?? item.development_plan_id }));
  const selectedItem = rows.find((item) => item.id === selectedItemId) ?? rows[0];

  async function addRow() {
    if (developmentPlanId === undefined) return;
    setStatus('Saving Development Plan row.');
    await createForgeloopCommandApi().createDevelopmentPlanItem(developmentPlanId, {
      title: title.trim() || 'New Development Plan row',
      summary: summary.trim() || 'Manual row created from the Development Plan table.',
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
    setStatus('Development Plan row saved.');
  }

  async function generateMissingRows() {
    if (developmentPlanId === undefined) return;
    setStatus('Generating missing Development Plan rows with AI.');
    await createForgeloopCommandApi().regenerateDevelopmentPlanDraft(developmentPlanId, {
      actor_id: actorId,
      feedback: 'Generate missing Development Plan rows from linked source objects. Keep existing rows unchanged unless they are explicitly stale.',
      preserve_prior_decisions: true,
    });
    await queryClient.invalidateQueries({ queryKey: queryKeys.developmentPlan(developmentPlanId) });
    setStatus('Missing Development Plan rows generated with AI.');
  }

  async function regenerate() {
    if (developmentPlanId === undefined) return;
    setStatus('Regenerating Development Plan with AI.');
    await createForgeloopCommandApi().regenerateDevelopmentPlanDraft(developmentPlanId, {
      actor_id: actorId,
      feedback: regenerationFeedback.trim() || 'Regenerate missing or stale rows from the current source-object context.',
      preserve_prior_decisions: preservePriorDecisions,
    });
    await queryClient.invalidateQueries({ queryKey: queryKeys.developmentPlan(developmentPlanId) });
    setIsRegenerateOpen(false);
    setStatus('Development Plan regenerated with AI.');
  }

  return (
    <div className="grid gap-6">
      <PageHeader
        actions={
          <>
            <Button onClick={() => setIsAddOpen(true)} type="button">Add row</Button>
            <Button onClick={() => void generateMissingRows()} type="button" variant="secondary">Generate missing rows with AI</Button>
            <Button onClick={() => setIsRegenerateOpen(true)} type="button" variant="secondary">Regenerate with AI</Button>
            <Button onClick={() => setIsManifestOpen(true)} type="button" variant="secondary">Show context manifest</Button>
          </>
        }
        subtitle={`Status ${formatValue(plan?.status)}. Source objects: ${sourceSummary(plan)}`}
        title={plan?.title ?? 'Development Plan'}
      />
      <SurfaceStateIndicator label="Development Plan Page" state={developmentPlanSurfaceState(query.isLoading, query.isError, rows)} />
      {status ? <InlineNotice title={status} tone="info" /> : null}
      {query.isError ? <InlineNotice title="Development Plan could not be loaded." tone="danger" /> : null}
      <Section
        description="Rows are the governed unit that moves through boundary brainstorming, Spec, Execution Plan, execution, review, and QA."
        title="Development Plan Items"
      >
        {plan === undefined && !query.isLoading ? (
          <EmptyState title="Development Plan not found." />
        ) : (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(18rem,0.85fr)]">
            <DevelopmentPlanTable items={rows} selectedItemId={selectedItem?.id} onSelectItem={(item) => setSelectedItemId(item.id)} />
            <SelectedPlanItemPanel item={selectedItem} />
          </div>
        )}
      </Section>
      <Dialog
        content={
          <DialogPanel>
            <div className="grid gap-4">
              <Field label="Plan item title">
                <Input aria-label="Plan item title" onChange={(event) => setTitle(event.target.value)} value={title} />
              </Field>
              <Field label="Summary">
                <Textarea aria-label="Summary" onChange={(event) => setSummary(event.target.value)} value={summary} />
              </Field>
              <Button onClick={() => void addRow()} type="button">Save row</Button>
            </div>
          </DialogPanel>
        }
        open={isAddOpen}
        title="Add row"
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
                  placeholder="Describe which rows to preserve, split, add, or re-scope."
                  value={regenerationFeedback}
                />
              </Field>
              <Checkbox
                checked={preservePriorDecisions}
                label="Preserve prior decisions"
                onChange={(event) => setPreservePriorDecisions(event.target.checked)}
              />
              <Button onClick={() => void regenerate()} type="button">Regenerate with AI</Button>
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
            <p>Context manifests capture source objects, prior decisions, and repository context used by AI regeneration.</p>
            <p>Current regeneration preference: {preservePriorDecisions ? 'preserve prior decisions' : 'allow AI to propose changed decisions for review'}.</p>
          </div>
        }
        open={isManifestOpen}
        title="Context manifest"
        onOpenChange={setIsManifestOpen}
      />
    </div>
  );
}

function SelectedPlanItemPanel({ item }: { item: DevelopmentPlanItemRow | undefined }) {
  if (item === undefined) {
    return (
      <aside className="rounded-card border border-border bg-background p-4">
        <EmptyState title="Select a Development Plan row." />
      </aside>
    );
  }

  return (
    <aside className="grid content-start gap-4 rounded-card border border-border bg-background p-4" aria-label="Selected Development Plan Item">
      <div className="grid gap-1">
        <Badge tone={item.risk === 'high' || item.risk === 'critical' ? 'warning' : 'neutral'}>{formatValue(item.risk)}</Badge>
        <h3 className="text-base font-semibold text-text-primary">{item.title}</h3>
        <p className="text-sm text-text-secondary">{item.next_action ?? 'Review gate state'}</p>
      </div>
      <dl className="grid gap-2 text-sm">
        {[
          ['Responsible role', formatValue(item.responsible_role)],
          ['Driver', item.driver_actor_id ?? 'Unassigned'],
        ].map(([label, value]) => (
          <div className="flex items-center justify-between gap-3" key={label}>
            <dt className="text-text-secondary">{label}</dt>
            <dd className="font-semibold text-text-primary">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="grid gap-2">
        <GateSnapshot label="Boundary" status={item.boundary_status} />
        <GateSnapshot label="Spec" status={item.spec_status} />
        <GateSnapshot label="Execution Plan" status={item.execution_plan_status} />
        <GateSnapshot label="Execution" status={item.execution_status} />
      </div>
      <Link className="inline-flex min-h-10 items-center justify-center rounded-md border border-primary bg-primary px-4 text-sm font-semibold text-white" to={`/development-plans/${item.development_plan_id}/items/${item.id}`}>
        Open selected item
      </Link>
    </aside>
  );
}

function GateSnapshot({ label, status }: { label: string; status: string | undefined }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface p-2">
      <span className="text-sm font-semibold text-text-secondary">{label}</span>
      <StatusPill tone={statusTone(status)}>{formatValue(status)}</StatusPill>
    </div>
  );
}

function sourceSummary(plan: DevelopmentPlanProjection | undefined): string {
  if (plan?.source_refs?.length) return plan.source_refs.map((ref) => ref.title ?? ref.id).join(', ');
  return 'not linked';
}

function developmentPlanSurfaceState(
  isLoading: boolean,
  isError: boolean,
  rows: DevelopmentPlanItemRow[],
): 'loading' | 'error' | 'empty' | 'blocked' | 'approved' | 'running' | 'resumable' | 'stale' | undefined {
  if (isLoading) return 'loading';
  if (isError) return 'error';
  if (rows.length === 0) return 'empty';
  const text = rows.map((row) => `${row.boundary_status ?? ''} ${row.spec_status ?? ''} ${row.execution_plan_status ?? ''} ${row.execution_status ?? ''}`).join(' ');
  if (text.includes('blocked')) return 'blocked';
  if (text.includes('stale')) return 'stale';
  if (text.includes('interrupted')) return 'resumable';
  if (text.includes('running')) return 'running';
  if (text.includes('approved')) return 'approved';
  return undefined;
}
