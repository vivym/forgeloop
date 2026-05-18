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
  const viewModel = createWorkItemDetailViewModel(cockpit.data, undefined);
  const [historyOpen, setHistoryOpen] = useState(false);
  const hasSpec = viewModel.spec !== null;
  const hasPlan = viewModel.plan !== null;
  const workItemTitle = viewModel.workItem?.title ?? 'Work item planning';
  const commandPendingReason = 'Pending command wiring';
  const hasPlanningContext = cockpit.status === 'success' && !cockpit.isError && viewModel.workItem !== null;
  const revisionHistoryPendingReason = 'Revision history is available after work item planning data loads.';
  const handleHistoryOpenChange = (open: boolean) => {
    setHistoryOpen(hasPlanningContext ? open : false);
  };

  return (
    <DetailLayout
      actionRail={
        <ActionRail title="Approval actions">
          <div className="stack-form compact">
            <Button disabled title={commandPendingReason}>
              Submit for approval
            </Button>
            <Button disabled title={commandPendingReason}>
              Approve
            </Button>
            <Button disabled title={commandPendingReason}>
              Request changes
            </Button>
            <p className="status-line">{commandPendingReason}</p>
          </div>
        </ActionRail>
      }
      header={
        <PageHeader
          actions={
            <div className="button-row">
              <Button disabled title={commandPendingReason} variant="primary">
                Create Spec
              </Button>
              <Button disabled title={commandPendingReason} variant="primary">
                Create Plan
              </Button>
              <Drawer
                content={
                  <div className="stack-form compact">
                    <RevisionStatus
                      available={Boolean(viewModel.spec?.current_revision_id)}
                      label="Spec"
                      status={viewModel.spec?.status}
                    />
                    <RevisionStatus
                      available={Boolean(viewModel.plan?.current_revision_id)}
                      label="Plan"
                      status={viewModel.plan?.status}
                    />
                    <DrawerClose label="Close revision history">Close</DrawerClose>
                  </div>
                }
                description="Revision availability and approval state for this work item."
                onOpenChange={handleHistoryOpenChange}
                open={hasPlanningContext && historyOpen}
                title="Revision history"
              >
                <Button
                  disabled={!hasPlanningContext}
                  onClick={() => {
                    if (hasPlanningContext) {
                      setHistoryOpen(true);
                    }
                  }}
                  title={hasPlanningContext ? undefined : revisionHistoryPendingReason}
                >
                  Open revision history
                </Button>
              </Drawer>
              {!hasPlanningContext ? <p className="status-line">{revisionHistoryPendingReason}</p> : null}
            </div>
          }
          eyebrow={workItemTitle}
          subtitle="Create, draft, and approve product planning artifacts from the work item context."
          title="Spec & Plan"
        />
      }
    >
      {cockpit.status === 'pending' ? (
        <Section title="Loading">
          <p className="empty">Loading Spec & Plan context.</p>
        </Section>
      ) : null}
      {cockpit.isError ? (
        <Section title="Unavailable">
          <p className="empty">Spec & Plan data is temporarily unavailable.</p>
        </Section>
      ) : null}
      {cockpit.status !== 'pending' && !cockpit.isError && viewModel.workItem === null ? (
        <Section title="Empty">
          <p className="empty">No work item planning context is available.</p>
        </Section>
      ) : null}
      {cockpit.status !== 'pending' && !cockpit.isError && viewModel.workItem !== null ? (
        <>
          <Section title="Work item context">
            <div className="state-grid">
              <Metric label="Kind" value={formatValue(viewModel.workItem.kind)} />
              <Metric label="Risk" value={formatValue(viewModel.workItem.risk)} />
              <Metric label="Owner" value="Work Item Owner" />
              <Metric label="Phase" value={formatValue(viewModel.workItem.phase)} />
            </div>
          </Section>
          <Section title="Spec">
            <ArtifactState
              action={
                hasSpec ? (
                  <Button disabled title={commandPendingReason}>
                    Generate spec draft
                  </Button>
                ) : null
              }
              created={hasSpec}
              gate={viewModel.spec?.gate_state}
              status={viewModel.spec?.status}
            />
          </Section>
          <Section title="Plan">
            <ArtifactState
              action={
                hasPlan ? (
                  <Button disabled title={commandPendingReason}>
                    Generate plan draft
                  </Button>
                ) : null
              }
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
        </>
      ) : null}
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

function RevisionStatus({ available, label, status }: { available: boolean; label: string; status: string | undefined }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{available ? `${formatValue(status)} revision available` : 'No revision yet'}</strong>
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
