import type { DeliveryEvidence } from '../../../shared/api/types';
import { Section } from '../../../shared/layout';
import { InlineNotice, Timeline, type TimelineItem } from '../../../shared/ui';
import { formatValue } from '../work-item-view-model';

export interface EvidenceTimelineProps {
  evidence: readonly DeliveryEvidence[];
}

export function EvidenceTimeline({ evidence }: EvidenceTimelineProps) {
  const items: TimelineItem[] = evidence.map((item) => ({
    id: item.id,
    title: item.label,
    description: item.summary,
    meta: [formatValue(item.stage_id, 'General evidence'), item.created_at].filter(Boolean).join(' / '),
  }));

  return (
    <Section description="Evidence supplied by backend delivery readiness." title="Evidence timeline">
      {items.length === 0 ? <InlineNotice title="No delivery evidence has been reported." /> : <Timeline items={items} />}
    </Section>
  );
}
