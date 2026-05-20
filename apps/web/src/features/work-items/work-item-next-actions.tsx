import { Link, useSearchParams } from 'react-router';

import type { WorkItem, WorkItemDeliveryReadiness } from '../../shared/api/types';
import { ActionRail } from '../../shared/layout';
import { ProductActionList } from '../product-actions/product-action-list';
import { parseProductLaneId, productLaneDefinition } from '../product-lanes/product-lanes';

export function WorkItemNextActions({
  readiness,
  workItem,
}: {
  readiness: WorkItemDeliveryReadiness;
  workItem: WorkItem;
}) {
  const [searchParams] = useSearchParams();
  const requestedLane = searchParams.get('lane');
  const parsedLane = requestedLane === null ? readiness.active_lane : parseProductLaneId(requestedLane);

  if (parsedLane === undefined) {
    return (
      <ActionRail title="Next actions">
        <p className="empty">This lane is not available for this Work Item.</p>
        <Link className="fl-button fl-button--primary" to={`/work-items/${encodeURIComponent(workItem.id)}?lane=${readiness.active_lane}`}>
          Open default lane
        </Link>
      </ActionRail>
    );
  }

  const lane = productLaneDefinition(readiness.active_lane);

  return (
    <ActionRail title="Next actions">
      {parsedLane !== readiness.active_lane ? (
        <p className="empty">{productLaneDefinition(parsedLane).label} actions are loaded through the Work Item cockpit.</p>
      ) : readiness.next_actions.length === 0 ? (
        <p className="empty">No actions for {lane.label} lane.</p>
      ) : (
        <ProductActionList actions={readiness.next_actions} projectId={workItem.project_id} />
      )}
    </ActionRail>
  );
}
