import { Link } from 'react-router';

import { useBoardQuery } from '../../shared/api/hooks';
import type { BoardCard, ObjectRef } from '../../shared/api/types';
import { useProjectContext } from '../../shared/context/project-context';
import { PageHeader, Section } from '../../shared/layout';
import { InlineNotice, StatusPill } from '../../shared/ui';

type BoardObjectRef = Extract<
  ObjectRef,
  { type: 'initiative' | 'requirement' | 'tech_debt' | 'task' | 'bug' | 'spec' | 'plan' | 'release' }
>;
type BoardProductCard = BoardCard & { object_ref: BoardObjectRef };

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
  const query = useBoardQuery({ project_id: projectId, limit: 100 });
  const cards = (query.data?.items ?? []).filter(isBoardProductCard);
  const columns = groupByColumn(cards);

  return (
    <>
      <PageHeader subtitle="Typed lifecycle objects arranged by delivery state." title="Board" />
      {query.isLoading ? <InlineNotice title="Loading board cards." tone="info" /> : null}
      {query.isError ? <InlineNotice title="Board cards could not be loaded." tone="danger" /> : null}
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

function isBoardProductCard(card: BoardCard): card is BoardProductCard {
  return (
    card.object_ref.type === 'initiative' ||
    card.object_ref.type === 'requirement' ||
    card.object_ref.type === 'tech_debt' ||
    card.object_ref.type === 'task' ||
    card.object_ref.type === 'bug' ||
    card.object_ref.type === 'spec' ||
    card.object_ref.type === 'plan' ||
    card.object_ref.type === 'release'
  );
}

function objectLabel(type: BoardObjectRef['type']): string {
  switch (type) {
    case 'tech_debt':
      return 'Tech Debt';
    default:
      return titleCase(type);
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
    case 'task':
      return `/tasks/${encodeURIComponent(ref.id)}`;
    case 'bug':
      return `/bugs/${encodeURIComponent(ref.id)}`;
    case 'spec':
      return `/specs/${encodeURIComponent(ref.id)}`;
    case 'plan':
      return `/plans/${encodeURIComponent(ref.id)}`;
    case 'release':
      return `/releases/${encodeURIComponent(ref.id)}`;
  }
}

function titleCase(value: string): string {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (match) => match.toUpperCase());
}
