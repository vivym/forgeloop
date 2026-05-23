import type { ProductAction, WorkItemDeliveryReadiness } from '../../../shared/api/types';
import { Metric, MetricGrid } from '../../../shared/layout';
import { Badge, StatusPill } from '../../../shared/ui';
import { productLaneDefinition } from '../../product-lanes/product-lanes';
import { deliveryOverallLabel, formatValue, groupDeliveryActionsByPriority, sanitizeDeliveryActionsForDisplay } from '../work-item-view-model';

export interface DeliveryActionSummaryProps {
  readiness: WorkItemDeliveryReadiness;
}

export function DeliveryActionSummary({ readiness }: DeliveryActionSummaryProps) {
  const lane = productLaneDefinition(readiness.active_lane);
  const blockerCount = readiness.blockers.length;
  const actionGroups = groupDeliveryActionsByPriority(sanitizeDeliveryActionsForDisplay(readiness.next_actions, readiness.active_lane));
  const primaryAction = actionGroups.primary[0] ?? actionGroups.secondary[0];

  return (
    <section aria-label="Delivery action summary" data-testid="delivery-action-summary">
      <MetricGrid className="xl:grid-cols-5">
        <Metric description={lane.description} label="Active lane" value={lane.label} />
        <Metric
          label="Readiness"
          value={<StatusPill tone={readiness.overall_state === 'blocked' ? 'danger' : 'info'}>{deliveryOverallLabel(readiness)}</StatusPill>}
        />
        <Metric label="Blockers" value={`${blockerCount} ${blockerCount === 1 ? 'blocker' : 'blockers'}`} />
        <Metric label="Primary action" value={primaryAction?.label ?? 'No primary action'} description={<PrimaryActionState action={primaryAction} />} />
        <Metric label="Work type" value={<Badge tone="info">{formatValue(readiness.scope_ref.type)}</Badge>} />
      </MetricGrid>
    </section>
  );
}

function PrimaryActionState({ action }: { action: ProductAction | undefined }) {
  if (action === undefined) {
    return <>No lane action is available.</>;
  }

  if (!action.enabled) {
    return <>{action.disabled_reason ?? action.blocked_reason ?? 'Disabled'}</>;
  }

  return <>Available</>;
}
