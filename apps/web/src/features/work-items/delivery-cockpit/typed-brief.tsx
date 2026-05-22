import type { WorkItem } from '../../../shared/api/types';
import { PillGroup, Section } from '../../../shared/layout';
import { Badge, Skeleton } from '../../../shared/ui';
import { formatValue } from '../work-item-view-model';

export interface TypedBriefProps {
  workItem: WorkItem | null;
}

export function TypedBrief({ workItem }: TypedBriefProps) {
  if (workItem === null) {
    return (
      <Section description="Intake context, goal, and success criteria for this product work." title="Typed brief">
        <Skeleton lines={3} />
      </Section>
    );
  }

  return (
    <Section description="Intake context, goal, and success criteria for this product work." title="Typed brief">
      <div className="grid gap-3">
        <PillGroup aria-label="Work item attributes">
          <Badge tone="info">{formatValue(workItem.kind)}</Badge>
          <Badge>{workItem.priority}</Badge>
          <Badge tone={workItem.risk === 'high' ? 'warning' : 'neutral'}>{formatValue(workItem.risk)}</Badge>
        </PillGroup>
        <strong className="text-text-primary">{workItem.goal}</strong>
        <ul className="m-0 grid gap-1 pl-5">
          {workItem.success_criteria.map((criterion) => (
            <li key={criterion}>{criterion}</li>
          ))}
        </ul>
      </div>
    </Section>
  );
}
