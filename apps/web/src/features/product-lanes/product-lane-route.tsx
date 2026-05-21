import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';

import { useProductLaneQuery } from '../../shared/api/hooks';
import {
  isProductLaneSearchParamSupported,
  productLaneQueryFromSearchParams,
  supportedProductLaneSearchParams,
} from '../../shared/api/types';
import type { ProductLaneId } from '../../shared/api/types';
import { useProjectContext } from '../../shared/context/project-context';
import { ActionRail, DetailLayout, PageHeader, Section } from '../../shared/layout';
import { Badge, Button } from '../../shared/ui';
import { ProductActionList } from '../product-actions/product-action-list';
import {
  defaultProductLaneId,
  parseProductLaneId,
  productLaneDefinition,
  productLanes,
} from './product-lanes';
import { ProductLaneTable } from './product-lane-table';
import { createProductLaneViewModel } from './product-lane-view-model';

export function ProductLaneRoute() {
  const params = useParams();
  const laneId = parseProductLaneId(params.laneId);

  if (laneId === undefined) {
    return <UnknownProductLane />;
  }

  return <ProductLaneRouteContent laneId={laneId} />;
}

function ProductLaneRouteContent({ laneId }: { laneId: NonNullable<ReturnType<typeof parseProductLaneId>> }) {
  const { projectId: contextProjectId } = useProjectContext();
  const [searchParams] = useSearchParams();
  const projectId = searchParams.get('project_id')?.trim() || contextProjectId;
  const queryInput = useMemo(
    () => productLaneQueryFromSearchParams(laneId, searchParams, projectId),
    [laneId, projectId, searchParams],
  );
  const query = useProductLaneQuery(laneId, queryInput);
  const requestedSelectedId = searchParams.get('selected') ?? undefined;
  const [selectedItemId, setSelectedItemId] = useState<string | undefined>(() => requestedSelectedId);
  const lane = productLaneDefinition(laneId);
  const viewModel = createProductLaneViewModel(query.data, {
    currentSelectedId: selectedItemId,
  });
  const selectedItem = viewModel.selectedItem;

  useEffect(() => {
    setSelectedItemId(requestedSelectedId);
  }, [requestedSelectedId]);

  useEffect(() => {
    setSelectedItemId(selectedItem?.id);
  }, [selectedItem?.id]);

  return (
    <DetailLayout
      actionRail={
        <ActionRail title="Selected item actions">
          <div aria-label="Selected item product actions">
            <ProductActionList actions={selectedItem?.actions ?? []} activeLane={laneId} projectId={projectId} />
          </div>
        </ActionRail>
      }
      header={
        <PageHeader
          actions={
            <Button disabled={query.isFetching} loading={query.isFetching} onClick={() => void query.refetch()} variant="secondary">
              Refresh lane
            </Button>
          }
          eyebrow="Product Lane"
          subtitle={query.data?.description ?? lane.description}
          title={query.data?.label ?? lane.label}
        />
      }
    >
      <Section title="Lanes">
        <nav aria-label="Product lanes" className="pill-list">
          {productLanes.map((candidate) => (
            <Link
              aria-current={candidate.id === laneId ? 'page' : undefined}
              className={candidate.id === laneId ? 'fl-button fl-button--primary' : 'fl-button fl-button--secondary'}
              key={candidate.id}
              to={laneHref(candidate.id, searchParams, projectId)}
            >
              {candidate.label}
            </Link>
          ))}
        </nav>
      </Section>
      <Section title="Lane summary">
        {query.status === 'pending' ? <p className="empty">Loading product lane.</p> : null}
        {query.isError ? <p className="empty">Product lane data is temporarily unavailable.</p> : null}
        {query.data !== undefined ? (
          <>
            <div className="state-grid">
              <Metric label="Total" value={String(query.data.summary.total)} />
              <Metric label="Blocked" value={String(query.data.summary.blocked)} />
              <Metric label="High risk" value={String(query.data.summary.high_risk)} />
              <Metric label="Stale" value={String(query.data.summary.stale)} />
            </div>
            {query.data.unsupported_filters.length ? (
              <p className="empty">Unsupported filters: {query.data.unsupported_filters.join(', ')}</p>
            ) : null}
          </>
        ) : null}
      </Section>
      <Section title="Queue">
        {selectedItem !== undefined ? (
          <div className="pill-list" aria-label="Selected item state">
            <Badge tone="primary">{selectedItem.title}</Badge>
            {selectedItem.risk !== undefined ? <Badge tone="warning">{selectedItem.risk} risk</Badge> : null}
          </div>
        ) : null}
        <ProductLaneTable onSelect={setSelectedItemId} rows={viewModel.rows} selectedItemId={selectedItem?.id} />
      </Section>
    </DetailLayout>
  );
}

function UnknownProductLane() {
  return (
    <DetailLayout header={<PageHeader subtitle="This Product Lane is not available." title="Lane unavailable" />}>
      <Section title="Open a canonical lane">
        <Link className="fl-button fl-button--primary" to={`/lanes/${defaultProductLaneId}`}>
          Open Requirements
        </Link>
      </Section>
    </DetailLayout>
  );
}

function laneHref(laneId: ProductLaneId, searchParams: URLSearchParams, projectId: string) {
  const next = new URLSearchParams();
  next.set('project_id', projectId);
  for (const key of supportedProductLaneSearchParams) {
    if (key === 'project_id' || !isProductLaneSearchParamSupported(laneId, key)) {
      continue;
    }
    const value = searchParams.get(key);
    if (value !== null && value.trim().length > 0) {
      next.set(key, value);
    }
  }
  const encoded = next.toString();
  return `/lanes/${laneId}${encoded ? `?${encoded}` : ''}`;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
