import { Link } from 'react-router';

import { Section } from '../../../shared/layout';
import { InlineNotice, StatusPill } from '../../../shared/ui';
import type { DeliveryStatusTone } from '../work-item-view-model';

export type InitiativeAggregation =
  | {
      mode: 'unavailable';
      label: string;
    }
  | {
      mode: 'available';
      label?: string;
      children: readonly InitiativeChildSummary[];
    };

export interface InitiativeChildSummary {
  id: string;
  label: string;
  href?: string;
  stateLabel: string;
  stateTone: DeliveryStatusTone;
  blockerCount?: number;
}

export interface InitiativeBreakdownProps {
  aggregation: InitiativeAggregation;
}

export function InitiativeBreakdown({ aggregation }: InitiativeBreakdownProps) {
  return (
    <Section title="Initiative breakdown">
      {aggregation.mode === 'unavailable' ? (
        <InlineNotice title={aggregation.label} tone="warning" />
      ) : aggregation.children.length === 0 ? (
        <InlineNotice title={aggregation.label ?? 'No child readiness summaries are available.'} />
      ) : (
        <div className="artifact-list">
          {aggregation.children.map((child) => (
            <div className="stack-form compact" key={child.id}>
              {child.href === undefined ? <strong>{child.label}</strong> : <Link to={child.href}>{child.label}</Link>}
              <StatusPill tone={child.stateTone}>{child.stateLabel}</StatusPill>
              {child.blockerCount === undefined ? null : <p className="m-0 text-sm text-text-secondary">{`${child.blockerCount} blockers`}</p>}
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}
