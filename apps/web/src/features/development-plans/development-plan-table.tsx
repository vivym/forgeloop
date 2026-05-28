import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router';

import { Badge, Button, DataTable, StatusPill, type DataTableColumn } from '../../shared/ui';
import {
  currentPlanItemGate,
  developmentPlanColumnPriorityByBreakpoint,
  developmentPlanPlanningColumns,
  gateProgressSummary,
  qaReviewSummary,
  type DevelopmentPlanColumnBreakpoint,
  type DevelopmentPlanColumnKey,
} from './development-plan-view-model';

export type DevelopmentPlanItemRow = {
  id: string;
  development_plan_id?: string | undefined;
  object_ref?: { type?: string; id?: string; development_plan_id?: string; title?: string };
  development_plan_ref?: { id?: string; title?: string };
  source_refs?: Array<{ type?: string; id?: string; title?: string }>;
  href?: string;
  title: string;
  summary?: string;
  responsible_role?: string;
  driver_actor_id?: string;
  reviewer_actor_id?: string;
  boundary_status?: string;
  spec_status?: string;
  execution_plan_status?: string;
  execution_status?: string;
  review_status?: string;
  qa_handoff_status?: string;
  risk?: string;
  dependency_hints?: readonly string[];
  affected_surfaces?: readonly string[];
  release_impact?: string;
  next_action?: string;
};

export function DevelopmentPlanTable({
  items,
  selectedItemId,
  onSelectItem,
}: {
  items: DevelopmentPlanItemRow[];
  selectedItemId?: string | undefined;
  onSelectItem?: (item: DevelopmentPlanItemRow) => void;
}) {
  const breakpoint = useDevelopmentPlanColumnBreakpoint();
  const columns = useMemo(() => makeColumns(breakpoint, onSelectItem), [breakpoint, onSelectItem]);

  return (
    <section aria-label="Development Plan Items table region" className="grid min-w-0 max-w-full gap-2">
      <DataTable
        ariaLabel="Development Plan Items"
        columns={columns}
        density="compact"
        emptyMessage="No Development Plan rows yet."
        getRowKey={(item) => item.id}
        rows={items}
        stickyHeader
        {...(onSelectItem === undefined ? {} : { onSelectRow: onSelectItem })}
        {...(selectedItemId === undefined ? {} : { selectedRowKey: selectedItemId })}
      />
    </section>
  );
}

export function formatValue(value: string | undefined): string {
  return value === undefined ? 'Not recorded' : value.replaceAll('_', ' ').replace(/\b\w/g, (match) => match.toUpperCase());
}

export function statusTone(status: string | undefined): 'neutral' | 'success' | 'warning' | 'danger' | 'info' {
  if (status === 'approved' || status === 'completed' || status === 'accepted') return 'success';
  if (status === 'blocked' || status === 'failed' || status === 'changes_requested') return 'danger';
  if (status === 'running' || status === 'in_progress' || status === 'in_review') return 'info';
  if (status === 'stale' || status === 'pending' || status === 'interrupted') return 'warning';
  return 'neutral';
}

function makeColumns(
  breakpoint: DevelopmentPlanColumnBreakpoint,
  onSelectItem: ((item: DevelopmentPlanItemRow) => void) | undefined,
): DataTableColumn<DevelopmentPlanItemRow>[] {
  const visibleKeys = developmentPlanColumnPriorityByBreakpoint[breakpoint];
  return visibleKeys.map((key) => columnFor(key, onSelectItem));
}

function columnFor(
  key: DevelopmentPlanColumnKey,
  onSelectItem: ((item: DevelopmentPlanItemRow) => void) | undefined,
): DataTableColumn<DevelopmentPlanItemRow> {
  const label = developmentPlanPlanningColumns.find((column) => column.key === key)?.label ?? key;

  return {
    key,
    header: label,
    cell: (item) => cellFor(key, item, onSelectItem),
  };
}

function cellFor(
  key: DevelopmentPlanColumnKey,
  item: DevelopmentPlanItemRow,
  onSelectItem: ((item: DevelopmentPlanItemRow) => void) | undefined,
): ReactNode {
  switch (key) {
    case 'planItem':
      return (
        <Link className="font-semibold text-primary hover:underline" to={itemHref(item)}>
          {item.title}
        </Link>
      );
    case 'role':
      return formatValue(item.responsible_role);
    case 'driver':
      return item.driver_actor_id ?? 'Unassigned';
    case 'reviewer':
      return item.reviewer_actor_id ?? 'Unassigned';
    case 'risk':
      return <RiskBadge risk={item.risk} />;
    case 'dependencyHints':
      return summarizeList(item.dependency_hints);
    case 'affectedSurface':
      return summarizeList(item.affected_surfaces);
    case 'boundary':
      return <GateStatus status={item.boundary_status} />;
    case 'spec':
      return <GateStatus status={item.spec_status} />;
    case 'executionPlan':
      return <GateStatus status={item.execution_plan_status} />;
    case 'execution':
      return <GateStatus status={item.execution_status} />;
    case 'review':
      return <GateStatus status={item.review_status} />;
    case 'qa':
      return <GateStatus status={item.qa_handoff_status} />;
    case 'releaseImpact':
      return formatValue(item.release_impact);
    case 'currentGate': {
      const gate = currentPlanItemGate(item);
      return (
        <span>
          <span className="sr-only">Current gate </span>
          {gate.label}: {formatValue(gate.state)}
        </span>
      );
    }
    case 'gateProgress':
      return gateProgressSummary(item);
    case 'qaReviewSummary':
      return qaReviewSummary(item);
    case 'nextAction':
      return (
        <div className="grid min-w-[12rem] gap-1">
          <span>{item.next_action ?? 'Review gate state'}</span>
          <div className="flex flex-wrap items-center gap-2">
            {onSelectItem === undefined ? null : (
              <Button onClick={() => onSelectItem(item)} size="sm" type="button" variant="ghost">
                Preview row
              </Button>
            )}
            <Link className="font-semibold text-primary hover:underline" to={itemHref(item)}>
              Open item
            </Link>
          </div>
        </div>
      );
  }
}

function GateStatus({ status }: { status: string | undefined }) {
  return <StatusPill tone={statusTone(status)}>{formatValue(status)}</StatusPill>;
}

function RiskBadge({ risk }: { risk: string | undefined }) {
  return (
    <Badge tone={risk === 'high' || risk === 'critical' ? 'warning' : 'neutral'}>
      {formatValue(risk)}
    </Badge>
  );
}

function summarizeList(values: readonly string[] | undefined): string {
  if (values === undefined || values.length === 0) return 'Unavailable';
  return values.join(', ');
}

function useDevelopmentPlanColumnBreakpoint(): DevelopmentPlanColumnBreakpoint {
  const [breakpoint, setBreakpoint] = useState<DevelopmentPlanColumnBreakpoint>(() => columnBreakpointForWidth(currentViewportWidth()));

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const update = () => setBreakpoint(columnBreakpointForWidth(currentViewportWidth()));
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  return breakpoint;
}

function currentViewportWidth(): number {
  if (typeof window === 'undefined') return 1440;
  return window.innerWidth || 1440;
}

function columnBreakpointForWidth(width: number): DevelopmentPlanColumnBreakpoint {
  if (width >= 1440) return 'desktop';
  if (width >= 1024) return 'tablet';
  return 'mobile';
}

export function itemHref(item: DevelopmentPlanItemRow, fallbackDevelopmentPlanId?: string): string {
  if (item.href !== undefined) return item.href;
  const developmentPlanId = item.development_plan_id ?? item.object_ref?.development_plan_id ?? item.development_plan_ref?.id ?? fallbackDevelopmentPlanId;
  return `/development-plans/${encodeURIComponent(developmentPlanId ?? 'unknown-development-plan')}/items/${encodeURIComponent(item.id)}`;
}
