import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router';

import { Button, DataTable, StatusPill, type DataTableColumn } from '../../shared/ui';
import {
  currentPlanItemGate,
  developmentPlanColumnPriorityByBreakpoint,
  developmentPlanPlanningColumns,
  gateProgressSummary,
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
        emptyMessage="No Plan Items yet."
        getRowKey={(item) => item.id}
        rows={items}
        stickyHeader
        {...(onSelectItem === undefined ? {} : { onSelectRow: onSelectItem })}
        {...(selectedItemId === undefined ? {} : { selectedRowKey: selectedItemId })}
      />
    </section>
  );
}

export function itemHref(item: DevelopmentPlanItemRow, fallbackDevelopmentPlanId?: string): string {
  if (item.href !== undefined) return item.href;
  const developmentPlanId = item.development_plan_id ?? item.object_ref?.development_plan_id ?? item.development_plan_ref?.id ?? fallbackDevelopmentPlanId;
  return `/development-plans/${encodeURIComponent(developmentPlanId ?? 'unknown-development-plan')}/items/${encodeURIComponent(item.id)}`;
}

export function formatValue(value: string | undefined): string {
  return value === undefined ? 'Not recorded' : value.replaceAll('_', ' ').replace(/\b\w/g, (match) => match.toUpperCase());
}

export function statusTone(status: string | undefined): 'neutral' | 'success' | 'warning' | 'danger' | 'info' {
  if (status === 'approved' || status === 'completed' || status === 'accepted') return 'success';
  if (status === 'blocked' || status === 'failed' || status === 'changes_requested') return 'danger';
  if (status === 'running' || status === 'in_progress' || status === 'in_review') return 'info';
  if (status === 'stale' || status === 'pending' || status === 'interrupted' || status === 'missing') return 'warning';
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
        <Link className="font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" to={itemHref(item)}>
          {item.title}
        </Link>
      );
    case 'typedRefs':
      return summarizeRefs(item.source_refs);
    case 'currentGate': {
      const gate = currentPlanItemGate(item);
      return `${gate.label}: ${formatValue(gate.state)}`;
    }
    case 'gateProgress':
      return gateProgressSummary(item);
    case 'risk':
      return <StatusPill tone={item.risk === 'critical' || item.risk === 'high' ? 'warning' : 'neutral'}>{formatValue(item.risk)}</StatusPill>;
    case 'driver':
      return item.driver_actor_id ?? 'Unassigned';
    case 'role':
      return formatValue(item.responsible_role);
    case 'reviewer':
      return item.reviewer_actor_id ?? 'Unassigned';
    case 'affectedSurfaces':
      return summarizeList(item.affected_surfaces);
    case 'dependencies':
      return summarizeList(item.dependency_hints);
    case 'releaseImpact':
      return formatValue(item.release_impact);
    case 'nextAction':
      return (
        <div className="grid min-w-[12rem] gap-1">
          <span>{item.next_action ?? 'Review gate state'}</span>
          <div className="flex flex-wrap items-center gap-2">
            {onSelectItem === undefined ? null : (
              <Button onClick={() => onSelectItem(item)} size="sm" type="button" variant="ghost">
                Preview Plan Item
              </Button>
            )}
            <Link className="font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" to={itemHref(item)}>
              Open Plan Item
            </Link>
          </div>
        </div>
      );
  }
}

function summarizeRefs(refs: Array<{ type?: string; id?: string; title?: string }> | undefined): string {
  if (refs === undefined || refs.length === 0) return 'Typed refs unavailable';
  return refs.map((ref) => ref.title ?? ref.id).filter((value): value is string => value !== undefined).join(', ');
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
