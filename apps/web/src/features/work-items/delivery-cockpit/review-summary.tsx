import type { DeliveryStage } from '../../../shared/api/types';
import { PillGroup, Section } from '../../../shared/layout';
import { Badge, InlineNotice, StatusPill } from '../../../shared/ui';
import { deliveryStageTargetId, deliveryStageTone, formatValue } from '../work-item-view-model';

export interface ReviewSummaryProps {
  stage?: DeliveryStage;
  reviewCount?: number;
}

export function ReviewSummary({ stage, reviewCount = 0 }: ReviewSummaryProps) {
  const targetId = deliveryStageTargetId({ id: stage?.id ?? 'review' });

  return (
    <Section id={targetId} tabIndex={-1} title={stage?.label ?? 'Review'} description="Review packet decision state and required reviewer evidence.">
      <PillGroup aria-label="Review state">
        <StatusPill tone={stage === undefined ? 'neutral' : deliveryStageTone(stage.state)}>{formatValue(stage?.state, 'Unavailable')}</StatusPill>
        <Badge tone="info">{`${reviewCount} reviews`}</Badge>
      </PillGroup>
      {stage === undefined || stage.blockers.length === 0 ? (
        <InlineNotice title="No review blockers reported." />
      ) : (
        <ul>
          {stage.blockers.map((blocker) => (
            <li key={blocker.id}>{blocker.label}</li>
          ))}
        </ul>
      )}
    </Section>
  );
}
