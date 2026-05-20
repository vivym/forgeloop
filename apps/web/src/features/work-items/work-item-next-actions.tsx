import { Link } from 'react-router';

import type { ProductAction, ProductLaneId } from '../../shared/api/types';
import { ActionRail } from '../../shared/layout';
import { ProductActionList } from '../product-actions/product-action-list';
import { productLaneDefinition } from '../product-lanes/product-lanes';

export function WorkItemNextActions({
  actions,
  activeLane,
  projectId,
  requestedLane,
  unsupportedLane = false,
  workItemId,
}: {
  actions: ProductAction[];
  activeLane: ProductLaneId;
  projectId: string;
  requestedLane?: ProductLaneId;
  unsupportedLane?: boolean;
  workItemId: string;
}) {
  if (unsupportedLane) {
    return (
      <ActionRail title="Next actions">
        <p className="empty">This lane is not available for this Work Item.</p>
        <Link className="fl-button fl-button--primary" to={`/work-items/${encodeURIComponent(workItemId)}?lane=${activeLane}`}>
          Open default lane
        </Link>
      </ActionRail>
    );
  }

  const lane = productLaneDefinition(activeLane);

  return (
    <ActionRail title="Next actions">
      {requestedLane !== undefined && requestedLane !== activeLane ? (
        <p className="empty">{productLaneDefinition(requestedLane).label} actions are loaded through the Work Item cockpit.</p>
      ) : actions.length === 0 ? (
        <p className="empty">No actions for {lane.label} lane.</p>
      ) : (
        <ProductActionList actions={actions} activeLane={activeLane} projectId={projectId} />
      )}
    </ActionRail>
  );
}
