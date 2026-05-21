import type { WorkItem } from '../../../shared/api/types';
import { Section } from '../../../shared/layout';
import { Badge, Skeleton } from '../../../shared/ui';
import { formatValue } from '../work-item-view-model';

export interface TypedBriefProps {
  workItem: WorkItem | null;
}

export function TypedBrief({ workItem }: TypedBriefProps) {
  if (workItem === null) {
    return (
      <Section description="Owner request, goal, and success criteria for this product work." title="Typed brief">
        <Skeleton lines={3} />
      </Section>
    );
  }

  return (
    <Section description="Owner request, goal, and success criteria for this product work." title="Typed brief">
      <div className="detail-block">
        <div className="pill-list">
          <Badge tone="info">{formatValue(workItem.kind)}</Badge>
          <Badge>{workItem.priority}</Badge>
          <Badge tone={workItem.risk === 'high' ? 'warning' : 'neutral'}>{formatValue(workItem.risk)}</Badge>
        </div>
        <strong>{workItem.goal}</strong>
        <ul>
          {workItem.success_criteria.map((criterion) => (
            <li key={criterion}>{criterion}</li>
          ))}
        </ul>
      </div>
    </Section>
  );
}
