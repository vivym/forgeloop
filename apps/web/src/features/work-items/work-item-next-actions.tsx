import { Link } from 'react-router';

import type { ProductAction, ProductLaneId } from '../../shared/api/types';
import { ActionRail } from '../../shared/layout';
import { InlineNotice } from '../../shared/ui';
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
        <InlineNotice title="This lane is not available for this Work Item." tone="warning" />
        <Link className={linkButtonClass('primary')} to={`/work-items/${encodeURIComponent(workItemId)}?lane=${activeLane}`}>
          Open default lane
        </Link>
      </ActionRail>
    );
  }

  const lane = productLaneDefinition(activeLane);

  return (
    <ActionRail title="Next actions">
      {requestedLane !== undefined && requestedLane !== activeLane ? (
        <InlineNotice title={`${productLaneDefinition(requestedLane).label} actions are loaded through the Work Item cockpit.`} />
      ) : actions.length === 0 ? (
        <InlineNotice title={`No actions for ${lane.label} lane.`} />
      ) : (
        <ProductActionList actions={actions} activeLane={activeLane} projectId={projectId} />
      )}
    </ActionRail>
  );
}

function linkButtonClass(variant: 'primary' | 'secondary') {
  const variantClass =
    variant === 'primary'
      ? 'border-primary bg-primary text-white hover:bg-primary-hover'
      : 'border-border bg-surface text-text-primary hover:border-border-strong hover:bg-surface-muted';

  return [
    'inline-flex min-h-10 min-w-0 items-center justify-center gap-2 rounded-md border px-4 text-sm font-semibold transition-colors duration-base ease-standard motion-reduce:transition-none',
    variantClass,
  ].join(' ');
}
