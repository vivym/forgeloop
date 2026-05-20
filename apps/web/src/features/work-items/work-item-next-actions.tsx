import { Link, useSearchParams } from 'react-router';

import { useWorkItemActionsQuery } from '../../shared/api/hooks';
import type { ProductLaneId, WorkItem } from '../../shared/api/types';
import { ActionRail } from '../../shared/layout';
import { ProductActionList } from '../product-actions/product-action-list';
import { laneForWorkItemKind, parseProductLaneId, productLaneDefinition } from '../product-lanes/product-lanes';

export function WorkItemNextActions({ workItem }: { workItem: WorkItem }) {
  const [searchParams] = useSearchParams();
  const defaultLaneId = laneForWorkItemKind(workItem.kind);
  const requestedLane = searchParams.get('lane');
  const parsedLane = requestedLane === null ? defaultLaneId : parseProductLaneId(requestedLane);

  if (parsedLane === undefined) {
    return (
      <ActionRail title="Next actions">
        <p className="empty">This lane is not available for this Work Item.</p>
        <Link className="fl-button fl-button--primary" to={`/work-items/${encodeURIComponent(workItem.id)}?lane=${defaultLaneId}`}>
          Open default lane
        </Link>
      </ActionRail>
    );
  }

  return (
    <ActionRail title="Next actions">
      <WorkItemNextActionsContent laneId={parsedLane} projectId={workItem.project_id} workItemId={workItem.id} />
    </ActionRail>
  );
}

function WorkItemNextActionsContent({
  laneId,
  projectId,
  workItemId,
}: {
  laneId: ProductLaneId;
  projectId: string;
  workItemId: string;
}) {
  const query = useWorkItemActionsQuery(workItemId, laneId);
  const lane = productLaneDefinition(laneId);

  if (query.status === 'pending') {
    return <p className="empty">Loading {lane.label} next actions.</p>;
  }

  if (query.isError) {
    return <p className="empty">{lane.label} next actions are temporarily unavailable.</p>;
  }

  if ((query.data?.actions.length ?? 0) === 0) {
    return <p className="empty">No actions for {lane.label} lane.</p>;
  }

  return <ProductActionList actions={query.data?.actions ?? []} projectId={projectId} />;
}
