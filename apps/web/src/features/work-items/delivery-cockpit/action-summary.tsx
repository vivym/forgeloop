import type { WorkItemDeliveryReadiness } from '../../../shared/api/types';
import { Badge, StatusPill } from '../../../shared/ui';
import { productLaneDefinition } from '../../product-lanes/product-lanes';
import { deliveryOverallLabel, formatValue } from '../work-item-view-model';

export interface DeliveryActionSummaryProps {
  readiness: WorkItemDeliveryReadiness;
}

export function DeliveryActionSummary({ readiness }: DeliveryActionSummaryProps) {
  const lane = productLaneDefinition(readiness.active_lane);
  const blockerCount = readiness.blockers.length;

  return (
    <section aria-label="Delivery action summary" className="delivery-action-summary">
      <div className="state-grid">
        <div className="metric">
          <span>Active lane</span>
          <strong>{lane.label}</strong>
          <p className="empty">{lane.description}</p>
        </div>
        <div className="metric">
          <span>Readiness</span>
          <StatusPill tone={readiness.overall_state === 'blocked' ? 'danger' : 'info'}>{deliveryOverallLabel(readiness)}</StatusPill>
        </div>
        <div className="metric">
          <span>Blockers</span>
          <strong>{`${blockerCount} ${blockerCount === 1 ? 'blocker' : 'blockers'}`}</strong>
        </div>
        <div className="metric">
          <span>Work type</span>
          <Badge tone="info">{formatValue(readiness.work_item_kind)}</Badge>
        </div>
      </div>
    </section>
  );
}
