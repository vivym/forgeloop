import { Link, useSearchParams } from 'react-router';

import { useBoardQuery } from '../../shared/api/hooks';
import type { BoardCard } from '../../shared/api/types';
import { useProjectContext } from '../../shared/context/project-context';
import { PageHeader, Section } from '../../shared/layout';
import { InlineNotice, StatusPill } from '../../shared/ui';
import { stateFromStatus, SurfaceStateIndicator, type SurfaceState } from '../project-management/surface-state';

type BoardObjectRef = BoardCard['object_ref'];
type BoardProductCard = BoardCard;

const columnLabels: Record<string, string> = {
  planning: 'Planning',
  ready: 'Ready',
  active: 'Active',
  validation: 'Validation',
  release: 'Release',
  done: 'Done',
};

export function BoardRoute() {
  const { projectId } = useProjectContext();
  const [searchParams] = useSearchParams();
  const query = useBoardQuery({ project_id: projectId, limit: 100 });
  const allCards = query.data?.items ?? [];
  const focus = boardFocusFromSearchParams(searchParams);
  const focusedCards = focus === undefined ? allCards : allCards.filter((card) => isFocusedBoardCard(card, focus));
  const cards = focus === undefined || focusedCards.length > 0 ? focusedCards : allCards;
  const columns = groupByColumn(cards);

  return (
    <>
      <PageHeader subtitle="Typed lifecycle objects arranged by delivery state." title="Board" />
      <SurfaceStateIndicator label="Board" state={boardSurfaceState(query.isLoading, query.isError, cards, query.data?.degraded_sources ?? [])} />
      {query.isLoading ? <InlineNotice title="Loading board cards." tone="info" /> : null}
      {query.isError ? <InlineNotice title="Board cards could not be loaded." tone="danger" /> : null}
      {focus !== undefined ? (
        <InlineNotice
          description={
            focusedCards.length > 0
              ? `Showing ${focusedCards.length} matching board card${focusedCards.length === 1 ? '' : 's'}.`
              : 'No exact board card matched this focus, so the full board remains visible.'
          }
          title={boardFocusTitle(focus)}
          tone={focusedCards.length > 0 ? 'info' : 'warning'}
        />
      ) : null}
      <Section title="Delivery board">
        <div className="grid gap-4 lg:grid-cols-3">
          {columns.map(([columnId, columnCards]) => (
            <section
              aria-label={`${columnLabel(columnId)} cards`}
              className="grid content-start gap-3 rounded-card border border-border bg-background p-3"
              key={columnId}
            >
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-base font-semibold text-text-primary">{columnLabel(columnId)}</h2>
                <span className="text-sm text-text-secondary">{columnCards.length}</span>
              </div>
              {columnCards.map((card) => (
                <BoardObjectCard card={card} key={card.id} />
              ))}
            </section>
          ))}
        </div>
      </Section>
    </>
  );
}

type BoardFocus =
  | { type: 'execution'; id: string }
  | { type: 'development_plan_item'; id: string };

function boardFocusFromSearchParams(searchParams: URLSearchParams): BoardFocus | undefined {
  const executionId = searchParams.get('execution_id');
  if (executionId !== null) return { type: 'execution', id: executionId };
  const developmentPlanItemId = searchParams.get('development_plan_item_id');
  if (developmentPlanItemId !== null) return { type: 'development_plan_item', id: developmentPlanItemId };
  return undefined;
}

function isFocusedBoardCard(card: BoardProductCard, focus: BoardFocus): boolean {
  return card.object_ref.type === focus.type && card.object_ref.id === focus.id;
}

function boardFocusTitle(focus: BoardFocus): string {
  return focus.type === 'execution' ? `Focused execution ${focus.id}` : `Focused Development Plan Item ${focus.id}`;
}

function boardSurfaceState(
  isLoading: boolean,
  isError: boolean,
  cards: BoardProductCard[],
  degradedSources: string[],
): SurfaceState | undefined {
  if (isLoading) return 'loading';
  if (isError) return 'error';
  if (cards.length === 0) return 'empty';
  if (degradedSources.some((source) => source.includes('stale'))) return 'stale';
  if (cards.some((card) => card.blocked)) return 'blocked';
  return cards.map((card) => stateFromStatus(card.status)).find(Boolean);
}

function BoardObjectCard({ card }: { card: BoardProductCard }) {
  return (
    <Link
      className="grid gap-2 rounded-card border border-border bg-surface p-3 text-sm shadow-sm transition-colors duration-base ease-standard hover:border-primary hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary motion-reduce:transition-none"
      to={typedObjectHref(card.object_ref)}
    >
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill tone={card.blocked ? 'danger' : 'neutral'}>{objectLabel(card.object_ref.type)}</StatusPill>
        <span className="text-text-secondary">{card.status}</span>
      </div>
      <div className="font-semibold text-text-primary">{card.title}</div>
      <div className="flex flex-wrap gap-3 text-xs text-text-secondary">
        <span>Risk {card.risk ?? 'unscored'}</span>
        <span>Priority {card.priority ?? 'unscored'}</span>
        <span>Driver {card.driver_actor_id ?? 'unassigned'}</span>
      </div>
      <div className="text-xs font-semibold text-text-primary">Next action: {nextActionFor(card)}</div>
    </Link>
  );
}

function groupByColumn(cards: BoardProductCard[]): [string, BoardProductCard[]][] {
  const grouped = new Map<string, BoardProductCard[]>();
  for (const card of cards) {
    const existing = grouped.get(card.column_id) ?? [];
    existing.push(card);
    grouped.set(card.column_id, existing);
  }
  return [...grouped.entries()];
}

function columnLabel(columnId: string): string {
  return columnLabels[columnId] ?? titleCase(columnId);
}

function objectLabel(type: BoardObjectRef['type']): string {
  switch (type) {
    case 'tech_debt':
      return 'Tech Debt';
    case 'development_plan_item':
      return 'Development Plan Item';
    case 'execution_plan':
      return 'Execution Plan';
    case 'qa_handoff':
      return 'QA Handoff';
    case 'code_review_handoff':
      return 'Code Review Handoff';
    default:
      return titleCase(type);
  }
}

function nextActionFor(card: BoardProductCard): string {
  if (card.blocked) return 'Resolve blocker';
  switch (card.object_ref.type) {
    case 'requirement':
    case 'initiative':
    case 'bug':
    case 'tech_debt':
      return 'Review source object';
    case 'development_plan_item':
      return 'Open item gates';
    case 'execution':
      return 'Inspect execution';
    case 'release':
      return 'Review readiness';
    default:
      return 'Review';
  }
}

function typedObjectHref(ref: BoardObjectRef): string {
  switch (ref.type) {
    case 'initiative':
      return `/initiatives/${encodeURIComponent(ref.id)}`;
    case 'requirement':
      return `/requirements/${encodeURIComponent(ref.id)}`;
    case 'tech_debt':
      return `/tech-debt/${encodeURIComponent(ref.id)}`;
    case 'bug':
      return `/bugs/${encodeURIComponent(ref.id)}`;
    case 'development_plan_item':
      return `/development-plans/${encodeURIComponent(ref.development_plan_id)}/items/${encodeURIComponent(ref.id)}`;
    case 'release':
      return `/releases/${encodeURIComponent(ref.id)}`;
    case 'execution':
      return `/board?execution_id=${encodeURIComponent(ref.id)}`;
    case 'code_review_handoff':
      return `/reports?code_review_handoff_id=${encodeURIComponent(ref.id)}`;
    case 'qa_handoff':
      return `/reports?qa_handoff_id=${encodeURIComponent(ref.id)}`;
    default:
      return '/my-work';
  }
}

function titleCase(value: string): string {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (match) => match.toUpperCase());
}
