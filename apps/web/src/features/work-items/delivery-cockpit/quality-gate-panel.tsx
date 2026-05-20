import type { DeliveryStage } from '../../../shared/api/types';
import { Section } from '../../../shared/layout';
import { StatusPill } from '../../../shared/ui';
import { deliveryStageTargetId, deliveryStageTone, formatValue } from '../work-item-view-model';

export interface QualityGatePanelProps {
  stage?: DeliveryStage;
}

export function QualityGatePanel({ stage }: QualityGatePanelProps) {
  const targetId = deliveryStageTargetId({ id: stage?.id ?? 'quality_gate' });

  return (
    <Section id={targetId} tabIndex={-1} title={stage?.label ?? 'Quality Gate'} description="Required test mapping and quality evidence state.">
      <StatusPill tone={stage === undefined ? 'neutral' : deliveryStageTone(stage.state)}>{formatValue(stage?.state, 'Unavailable')}</StatusPill>
      {stage === undefined || stage.blockers.length === 0 ? (
        <p className="empty">No quality gate blockers reported.</p>
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
