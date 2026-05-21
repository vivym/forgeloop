import type { DeliveryStage } from '../../../shared/api/types';
import { Section } from '../../../shared/layout';
import { StatusPill } from '../../../shared/ui';
import { deliveryStageTargetId, deliveryStageTone, formatValue } from '../work-item-view-model';

export interface IntegrationReadinessPanelProps {
  stage?: DeliveryStage;
}

export function IntegrationReadinessPanel({ stage }: IntegrationReadinessPanelProps) {
  const targetId = deliveryStageTargetId({ id: stage?.id ?? 'integration_readiness' });

  return (
    <Section id={targetId} tabIndex={-1} title={stage?.label ?? 'Integration Readiness'} description="Dependency and cross-package integration status.">
      <StatusPill tone={stage === undefined ? 'neutral' : deliveryStageTone(stage.state)}>{formatValue(stage?.state, 'Unavailable')}</StatusPill>
      <BlockerList emptyLabel="No integration blockers reported." stage={stage} />
    </Section>
  );
}

function BlockerList({ emptyLabel, stage }: { emptyLabel: string; stage: DeliveryStage | undefined }) {
  if (stage === undefined || stage.blockers.length === 0) return <p className="empty">{emptyLabel}</p>;

  return (
    <ul>
      {stage.blockers.map((blocker) => (
        <li key={blocker.id}>{blocker.label}</li>
      ))}
    </ul>
  );
}
