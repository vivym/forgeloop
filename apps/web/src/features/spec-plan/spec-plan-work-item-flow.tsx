import { useState } from 'react';
import type { ReactNode } from 'react';
import { useParams } from 'react-router';

import { useWorkItemCockpitQuery } from '../../shared/api/hooks';
import { ActionRail, DetailLayout, PageHeader, Section } from '../../shared/layout';
import { Badge, Button, Drawer, DrawerClose, StatusPill } from '../../shared/ui';
import { createWorkItemDetailViewModel, formatValue } from '../work-items/work-item-view-model';

export function SpecPlanWorkItemFlow() {
  const params = useParams();
  const workItemId = params.workItemId ?? 'wi-1';
  const cockpit = useWorkItemCockpitQuery(workItemId);
  const viewModel = createWorkItemDetailViewModel(workItemId, cockpit.data, undefined);
  const [historyOpen, setHistoryOpen] = useState(false);
  const hasSpec = viewModel.spec !== null;
  const hasPlan = viewModel.plan !== null;

  return (
    <DetailLayout
      actionRail={
        <ActionRail title="Approval actions">
          <div className="stack-form compact">
            <Button disabled={!hasSpec && !hasPlan}>Submit for approval</Button>
            <Button disabled={!hasSpec && !hasPlan}>Approve</Button>
            <Button disabled={!hasSpec && !hasPlan}>Request changes</Button>
          </div>
        </ActionRail>
      }
      header={
        <PageHeader
          actions={
            <div className="button-row">
              <Button disabled={hasSpec} variant="primary">
                Create Spec
              </Button>
              <Button disabled={!hasSpec || hasPlan} variant="primary">
                Create Plan
              </Button>
              <Drawer
                content={
                  <div className="stack-form compact">
                    <p className="status-line">Revision history is scoped to this work item and its current artifacts.</p>
                    <RevisionStatus label="Spec" value={viewModel.spec?.current_revision_id} />
                    <RevisionStatus label="Plan" value={viewModel.plan?.current_revision_id} />
                    <DrawerClose label="Close revision history">Close</DrawerClose>
                  </div>
                }
                onOpenChange={setHistoryOpen}
                open={historyOpen}
                title="Revision history"
              >
                <Button onClick={() => setHistoryOpen(true)}>Open revision history</Button>
              </Drawer>
            </div>
          }
          eyebrow={viewModel.workItem.title}
          subtitle="Create, draft, and approve product planning artifacts from the work item context."
          title="Spec & Plan"
        />
      }
    >
      <Section title="Work item context">
        <div className="state-grid">
          <Metric label="Kind" value={formatValue(viewModel.workItem.kind)} />
          <Metric label="Risk" value={formatValue(viewModel.workItem.risk)} />
          <Metric label="Owner" value={viewModel.workItem.owner_actor_id} />
          <Metric label="Phase" value={formatValue(viewModel.workItem.phase)} />
        </div>
      </Section>
      <Section title="Spec">
        <ArtifactState
          action={hasSpec ? <Button>Generate spec draft</Button> : null}
          created={hasSpec}
          gate={viewModel.spec?.gate_state}
          status={viewModel.spec?.status}
        />
      </Section>
      <Section title="Plan">
        <ArtifactState
          action={hasPlan ? <Button>Generate plan draft</Button> : null}
          created={hasPlan}
          gate={viewModel.plan?.gate_state}
          status={viewModel.plan?.status}
        />
      </Section>
      <Section title="Planning readiness">
        <div className="pill-list">
          <Badge tone={hasSpec ? 'success' : 'warning'}>{hasSpec ? 'Spec exists' : 'Spec needed'}</Badge>
          <Badge tone={hasPlan ? 'success' : 'warning'}>{hasPlan ? 'Plan exists' : 'Plan needed'}</Badge>
          <StatusPill tone={hasSpec && hasPlan ? 'success' : 'warning'}>
            {hasSpec && hasPlan ? 'Ready for packages' : 'Planning in progress'}
          </StatusPill>
        </div>
      </Section>
    </DetailLayout>
  );
}

function ArtifactState({
  action,
  created,
  gate,
  status,
}: {
  action: ReactNode | null;
  created: boolean;
  gate: string | undefined;
  status: string | undefined;
}) {
  return (
    <div className="detail-block">
      <div className="state-grid">
        <Metric label="Status" value={created ? formatValue(status) : 'Not created'} />
        <Metric label="Gate" value={created ? formatValue(gate) : 'Waiting'} />
      </div>
      {action === null ? null : <div className="button-row">{action}</div>}
    </div>
  );
}

function RevisionStatus({ label, value }: { label: string; value: string | undefined }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value ?? 'No revision yet'}</strong>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
