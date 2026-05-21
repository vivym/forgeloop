import type { DeliveryStage } from '../../../shared/api/types';
import { Section } from '../../../shared/layout';
import { Badge, StatusPill } from '../../../shared/ui';
import { deliveryStageTargetId, deliveryStageTone, formatValue } from '../work-item-view-model';

export interface ExecutionSummaryProps {
  stage?: DeliveryStage;
  runCount?: number;
}

export function ExecutionSummary({ stage, runCount = 0 }: ExecutionSummaryProps) {
  const targetId = deliveryStageTargetId({ id: stage?.id ?? 'execution' });

  return (
    <Section id={targetId} tabIndex={-1} title={stage?.label ?? 'Execution'} description="Run state and execution evidence for selected packages.">
      <div className="pill-list">
        <StatusPill tone={stage === undefined ? 'neutral' : deliveryStageTone(stage.state)}>{formatValue(stage?.state, 'Unavailable')}</StatusPill>
        <Badge tone="info">{`${runCount} runs`}</Badge>
      </div>
      <StageBlockers stage={stage} />
    </Section>
  );
}

function StageBlockers({ stage }: { stage: DeliveryStage | undefined }) {
  if (stage === undefined || stage.blockers.length === 0) return <p className="empty">No execution blockers reported.</p>;

  return (
    <ul>
      {stage.blockers.map((blocker) => (
        <li key={blocker.id}>{blocker.label}</li>
      ))}
    </ul>
  );
}
