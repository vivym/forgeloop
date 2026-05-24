import { Link, useNavigate } from 'react-router';
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from '@tanstack/react-table';

import { Badge, Button, StatusPill, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../shared/ui';

export type DevelopmentPlanItemRow = {
  id: string;
  development_plan_id?: string | undefined;
  object_ref?: { type?: string; id?: string; development_plan_id?: string; title?: string };
  development_plan_ref?: { id?: string; title?: string };
  href?: string;
  title: string;
  responsible_role?: string;
  driver_actor_id?: string;
  boundary_status?: string;
  spec_status?: string;
  execution_plan_status?: string;
  execution_status?: string;
  risk?: string;
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
  const navigate = useNavigate();
  const table = useReactTable({
    data: items,
    columns: makeColumns(onSelectItem),
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <div className="grid min-w-0 max-w-full gap-4">
      <div className="hidden min-w-0 max-w-full overflow-x-auto md:block">
        <Table aria-label="Development Plan Items">
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <TableHead key={header.id}>
                  {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.length ? (
            table.getRowModel().rows.map((row) => {
              const item = row.original;
              return (
                <TableRow
                  aria-selected={selectedItemId === item.id}
                  className="h-14 cursor-default focus-within:bg-primary-soft aria-selected:bg-primary-soft"
                  key={row.id}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
                  ))}
                </TableRow>
              );
            })
          ) : (
            <TableRow>
              <TableCell colSpan={9}>No Development Plan rows yet.</TableCell>
            </TableRow>
          )}
        </TableBody>
        </Table>
      </div>
      <div className="grid gap-3 md:hidden">
        {items.map((item) => (
          <article className="grid gap-3 rounded-card border border-border bg-background p-4" key={item.id}>
            <div className="grid gap-1">
              <h3 className="text-base font-semibold text-text-primary">{item.title}</h3>
              <p className="text-sm text-text-secondary">{item.next_action ?? 'Review gate state'}</p>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface p-2 text-sm">
              <span className="font-semibold text-text-secondary">Risk</span>
              <Badge tone={item.risk === 'high' || item.risk === 'critical' ? 'warning' : 'neutral'}>{formatValue(item.risk)}</Badge>
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <MobileStatus label="Boundary" status={item.boundary_status} />
              <MobileStatus label="Spec" status={item.spec_status} />
              <MobileStatus label="Execution Plan" status={item.execution_plan_status} />
              <MobileStatus label="Execution" status={item.execution_status} />
            </div>
            <button
              className="justify-self-start rounded-md border border-border bg-surface px-3 py-2 text-sm font-semibold text-primary"
              onClick={() => navigate(itemHref(item))}
              type="button"
            >
              Open row
            </button>
          </article>
        ))}
      </div>
    </div>
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

function makeColumns(onSelectItem: ((item: DevelopmentPlanItemRow) => void) | undefined): ColumnDef<DevelopmentPlanItemRow>[] {
  return [
  {
    accessorKey: 'title',
    header: 'Plan item',
    cell: ({ row }) => (
      <Link className="font-semibold text-primary hover:underline" to={itemHref(row.original)}>
        {row.original.title}
      </Link>
    ),
  },
  { accessorKey: 'responsible_role', header: 'Role', cell: ({ row }) => formatValue(row.original.responsible_role) },
  { accessorKey: 'driver_actor_id', header: 'Driver', cell: ({ row }) => row.original.driver_actor_id ?? 'Unassigned' },
  {
    accessorKey: 'boundary_status',
    header: 'Boundary',
    cell: ({ row }) => <StatusPill tone={statusTone(row.original.boundary_status)}>{formatValue(row.original.boundary_status)}</StatusPill>,
  },
  {
    accessorKey: 'spec_status',
    header: 'Spec',
    cell: ({ row }) => <StatusPill tone={statusTone(row.original.spec_status)}>{formatValue(row.original.spec_status)}</StatusPill>,
  },
  {
    accessorKey: 'execution_plan_status',
    header: 'Execution Plan',
    cell: ({ row }) => <StatusPill tone={statusTone(row.original.execution_plan_status)}>{formatValue(row.original.execution_plan_status)}</StatusPill>,
  },
  {
    accessorKey: 'execution_status',
    header: 'Execution',
    cell: ({ row }) => <StatusPill tone={statusTone(row.original.execution_status)}>{formatValue(row.original.execution_status)}</StatusPill>,
  },
  {
    accessorKey: 'risk',
    header: 'Risk',
    cell: ({ row }) => (
      <Badge tone={row.original.risk === 'high' || row.original.risk === 'critical' ? 'warning' : 'neutral'}>
        {formatValue(row.original.risk)}
      </Badge>
    ),
  },
  {
    accessorKey: 'next_action',
    header: 'Next action',
    cell: ({ row }) => (
      <div className="grid gap-1">
        <span>{row.original.next_action ?? 'Review gate state'}</span>
        <div className="flex flex-wrap items-center gap-2">
          {onSelectItem === undefined ? null : (
            <Button onClick={() => onSelectItem(row.original)} size="sm" type="button" variant="ghost">
              Preview row
            </Button>
          )}
          <Link className="font-semibold text-primary hover:underline" to={itemHref(row.original)}>
            Open item
          </Link>
        </div>
      </div>
    ),
  },
  ];
}

function MobileStatus({ label, status }: { label: string; status: string | undefined }) {
  return (
    <div className="grid gap-1 rounded-md border border-border bg-surface p-2">
      <span className="text-text-secondary">{label}</span>
      <StatusPill tone={statusTone(status)}>{formatValue(status)}</StatusPill>
    </div>
  );
}

export function itemHref(item: DevelopmentPlanItemRow, fallbackDevelopmentPlanId?: string): string {
  if (item.href !== undefined) return item.href;
  const developmentPlanId = item.development_plan_id ?? item.object_ref?.development_plan_id ?? item.development_plan_ref?.id ?? fallbackDevelopmentPlanId;
  return `/development-plans/${encodeURIComponent(developmentPlanId ?? 'unknown-development-plan')}/items/${encodeURIComponent(item.id)}`;
}
