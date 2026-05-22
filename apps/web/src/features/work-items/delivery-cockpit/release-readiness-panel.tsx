import type { DeliveryStage } from '../../../shared/api/types';
import { Section } from '../../../shared/layout';
import { InlineNotice, StatusPill } from '../../../shared/ui';
import { deliveryStageTargetId, deliveryStageTone, formatValue } from '../work-item-view-model';

export interface ReleaseReadinessPanelProps {
  stage?: DeliveryStage;
}

export function ReleaseReadinessPanel({ stage }: ReleaseReadinessPanelProps) {
  const targetId = deliveryStageTargetId({ id: stage?.id ?? 'release_readiness' });

  return (
    <Section id={targetId} tabIndex={-1} title={stage?.label ?? 'Release Readiness'} description="Pre-release scope, blocker, and release evidence state.">
      <StatusPill tone={stage === undefined ? 'neutral' : deliveryStageTone(stage.state)}>{formatValue(stage?.state, 'Unavailable')}</StatusPill>
      {stage === undefined || stage.blockers.length === 0 ? (
        <InlineNotice title="No release readiness blockers reported." />
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
