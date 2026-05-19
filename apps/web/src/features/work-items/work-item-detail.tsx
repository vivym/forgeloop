import { Link, useParams } from 'react-router';

import { useWorkItemCockpitQuery, useWorkItemReplayQuery } from '../../shared/api/hooks';
import { ActionRail, DetailLayout, PageHeader, Section } from '../../shared/layout';
import { Badge, Button, StatusPill } from '../../shared/ui';
import { createWorkItemDetailViewModel, formatValue } from './work-item-view-model';

export function WorkItemDetail() {
  const params = useParams();
  const workItemId = params.workItemId;
  const cockpit = useWorkItemCockpitQuery(workItemId);
  const replay = useWorkItemReplayQuery(workItemId);
  const viewModel = createWorkItemDetailViewModel(cockpit.data, replay.data);
  const { workItem } = viewModel;

  if (workItemId === undefined) {
    return (
      <DetailLayout header={<PageHeader subtitle="No work item route parameter was provided." title="Work Item" />}>
        <Section title="Invalid route">
          <p className="empty">This Work Item route is missing a work item.</p>
        </Section>
      </DetailLayout>
    );
  }

  if (cockpit.status === 'pending') {
    return (
      <DetailLayout header={<PageHeader subtitle="Loading work item context." title="Work Item" />}>
        <Section title="Loading">
          <p className="empty">Loading work item.</p>
        </Section>
      </DetailLayout>
    );
  }

  if (cockpit.isError) {
    return (
      <DetailLayout header={<PageHeader subtitle="The work item could not be loaded." title="Work Item" />}>
        <Section title="Unavailable">
          <p className="empty">Work item data is temporarily unavailable.</p>
        </Section>
      </DetailLayout>
    );
  }

  if (workItem === null) {
    return (
      <DetailLayout header={<PageHeader subtitle="No work item was found for this route." title="Work Item" />}>
        <Section title="Empty">
          <p className="empty">No work item data is available.</p>
        </Section>
      </DetailLayout>
    );
  }

  return (
    <DetailLayout
      actionRail={
        <ActionRail title="Work item actions">
          <div className="stack-form compact">
            <Link className="fl-button fl-button--primary" to={`/work-items/${encodeURIComponent(workItem.id)}/spec-plan`}>
              Open Spec & Plan
            </Link>
            <Button disabled title="Available after a draft exists." variant="secondary">
              Update brief
            </Button>
            <Button disabled title="Evidence attachment is not available for this work item yet." variant="secondary">
              Attach evidence
            </Button>
            <p className="status-line">Available after a draft exists.</p>
          </div>
        </ActionRail>
      }
      header={
        <PageHeader
          eyebrow={`${formatValue(workItem.kind)} / ${workItem.priority}`}
          subtitle={workItem.goal}
          title={workItem.title}
        />
      }
    >
      <Section title="Overview">
        <div className="state-grid">
          <Metric label="Phase" value={formatValue(workItem.phase)} />
          <Metric label="Risk" value={formatValue(workItem.risk)} />
          <Metric label="Gate" value={formatValue(workItem.gate_state)} />
          <Metric label="Resolution" value={formatValue(workItem.resolution)} />
        </div>
      </Section>
      <Section description="Owner request, goal, and success criteria for this product work." title="Brief / Intake">
        <div className="detail-block">
          <strong>{workItem.goal}</strong>
          <ul>
            {workItem.success_criteria.map((criterion) => (
              <li key={criterion}>{criterion}</li>
            ))}
          </ul>
        </div>
      </Section>
      <Section title="Spec & Plan summary">
        <div className="state-grid">
          <Metric label="Spec" value={viewModel.spec ? formatValue(viewModel.spec.status) : 'Not created'} />
          <Metric label="Plan" value={viewModel.plan ? formatValue(viewModel.plan.status) : 'Not created'} />
        </div>
      </Section>
      <Section title="Packages summary">
        {viewModel.packages.length ? (
          <div className="artifact-list">
            {viewModel.packages.map((executionPackage) => (
              <span key={executionPackage.id}>{executionPackage.objective}</span>
            ))}
          </div>
        ) : (
          <p className="empty">No execution packages have been generated for this work item.</p>
        )}
      </Section>
      <Section title="Validation">
        <div className="pill-list">
          <Badge tone="info">{viewModel.runs.length} runs</Badge>
          <Badge tone="success">{viewModel.reviews.length} reviews</Badge>
          <StatusPill tone={workItem.gate_state === 'open' ? 'warning' : 'success'}>{formatValue(workItem.gate_state)}</StatusPill>
        </div>
      </Section>
      <Section title="Timeline">
        {replay.isError ? (
          <p className="empty">Timeline is temporarily unavailable.</p>
        ) : viewModel.timeline.length ? (
          <div className="timeline-list">
            {viewModel.timeline.map((entry) => (
              <div className="timeline-entry" key={entry.id}>
                <strong>{entry.summary}</strong>
                <time>{entry.created_at}</time>
              </div>
            ))}
          </div>
        ) : (
          <p className="empty">No timeline events have been published for this product view.</p>
        )}
      </Section>
      <Section title="Evidence">
        <p className="status-line">Evidence is summarized from runs, reviews, and release readiness records.</p>
      </Section>
    </DetailLayout>
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
