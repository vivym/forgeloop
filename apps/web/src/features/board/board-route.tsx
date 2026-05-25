import { Link, useSearchParams } from 'react-router';

import { useBoardQuery } from '../../shared/api/hooks';
import type { BoardCard } from '../../shared/api/types';
import { useProjectContext } from '../../shared/context/project-context';
import { WorkspacePage } from '../../shared/layout';
import { Badge, InlineNotice, StatusPill } from '../../shared/ui';

type BoardObjectRef = BoardCard['object_ref'];
type BoardProductCard = BoardCard;
type BoardGateColumnId = 'intake' | 'boundary' | 'spec' | 'execution-plan' | 'execution' | 'review' | 'qa' | 'release';

const boardGateColumns: readonly { id: BoardGateColumnId; label: string; description: string }[] = [
  { id: 'intake', label: 'Intake / Development Plan needed', description: 'Source objects waiting for planning scope.' },
  { id: 'boundary', label: 'Boundary', description: 'Brainstorming and boundary approval.' },
  { id: 'spec', label: 'Spec', description: 'Spec generation and technical review.' },
  { id: 'execution-plan', label: 'Execution Plan', description: 'Plan generation and implementation review.' },
  { id: 'execution', label: 'Execution', description: 'Codex worker supervision.' },
  { id: 'review', label: 'Review', description: 'Code review and risk handoff.' },
  { id: 'qa', label: 'QA', description: 'Test handoff and acceptance.' },
  { id: 'release', label: 'Release', description: 'Release readiness and launch control.' },
];
const intakeGateColumn = boardGateColumns[0]!;

export function BoardRoute() {
  const { projectId } = useProjectContext();
  const [searchParams] = useSearchParams();
  const query = useBoardQuery({ project_id: projectId, limit: 100 });
  const allCards = query.data?.items ?? [];
  const focus = boardFocusFromSearchParams(searchParams);
  const focusedCards = focus === undefined ? allCards : allCards.filter((card) => isFocusedBoardCard(card, focus));
  const activeFocus = focus !== undefined && focusedCards.length > 0 ? focus : undefined;
  const cards = activeFocus === undefined ? allCards : focusedCards;
  const columns = groupByGate(cards);
  const blockedCount = cards.filter((card) => card.blocked).length;
  const highRiskCount = cards.filter((card) => /high|critical/i.test(card.risk ?? '')).length;

  return (
    <WorkspacePage
      blockerRisk={boardBlockerRisk(query.isError, blockedCount, highRiskCount, activeFocus)}
      family="board"
      heading="Board"
      layout="board-flow"
      nextAction={boardNextAction(query.isError, cards, activeFocus)}
      roleResponsibility="Product drivers, technical leads, developers, reviewers, QA, and release owners share this gate flow."
      state={boardCurrentState(query.isLoading, query.isError, cards, blockedCount)}
      subtitle="Development Plan Item gate flow from intake through release readiness."
    >
      {query.isLoading ? <InlineNotice title="Loading board cards." tone="info" /> : null}
      {query.isError ? <InlineNotice title="Board cards could not be loaded." tone="danger" /> : null}
      {focus !== undefined ? (
        <InlineNotice
          description={
            focusedCards.length > 0
              ? `Showing ${focusedCards.length} matching board card${focusedCards.length === 1 ? '' : 's'}.`
              : 'No exact board card matched this focus, so the full gate flow remains visible.'
          }
          title={activeFocus === undefined ? 'Focus not found' : boardFocusTitle(activeFocus)}
          tone={focusedCards.length > 0 ? 'info' : 'warning'}
        />
      ) : null}
      <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-4">
        {columns.map(({ cards: columnCards, column }) => (
            <section
              aria-label={`${column.label} cards`}
              className="grid min-w-0 content-start gap-3 border-t border-border pt-3"
              key={column.id}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="m-0 text-sm font-semibold text-text-primary">{column.label}</h2>
                  <p className="m-0 mt-1 text-xs text-text-secondary">{column.description}</p>
                </div>
                <Badge tone={columnCards.length > 0 ? 'primary' : 'neutral'}>{columnCards.length}</Badge>
              </div>
              {columnCards.map((card) => (
                <BoardObjectCard card={card} key={card.id} />
              ))}
              {columnCards.length === 0 ? <div className="py-2 text-xs text-text-secondary">No cards in this gate.</div> : null}
            </section>
        ))}
      </div>
    </WorkspacePage>
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
  return focus.type === 'execution' ? 'Focused Execution card' : 'Focused Development Plan Item card';
}

function boardCurrentState(
  isLoading: boolean,
  isError: boolean,
  cards: BoardProductCard[],
  blockedCount: number,
): string {
  if (isLoading) return 'Loading gate flow';
  if (isError) return 'Gate flow unavailable';
  if (cards.length === 0) return 'No cards in gate flow';
  if (blockedCount > 0) return `${blockedCount} blocked gate card${blockedCount === 1 ? '' : 's'}`;
  return `${cards.length} cards across gate flow`;
}

function boardNextAction(isError: boolean, cards: BoardProductCard[], focus: BoardFocus | undefined): string {
  if (isError) return 'Reload the board query before changing gate priority.';
  if (focus !== undefined) return 'Inspect the focused gate card and continue from its canonical route.';
  const blocked = cards.find((card) => card.blocked);
  if (blocked !== undefined) return `${nextActionFor(blocked)} for the blocked ${objectLabel(blocked.object_ref.type)}.`;
  return 'Open the highest-risk gate card or continue the active Development Plan Item.';
}

function boardBlockerRisk(isError: boolean, blockedCount: number, highRiskCount: number, focus: BoardFocus | undefined): string {
  if (isError) return 'Board query failed; gate blockers and risk cannot be trusted.';
  const focusText = focus === undefined ? 'full gate flow visible' : 'focused gate flow visible';
  return `${blockedCount} blocked / ${highRiskCount} high risk / ${focusText}`;
}

function BoardObjectCard({ card }: { card: BoardProductCard }) {
  const gate = gateColumnFor(card);
  const href = boardObjectHref(card);
  const content = (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill tone={card.blocked ? 'danger' : 'neutral'}>{objectLabel(card.object_ref.type)}</StatusPill>
        <Badge tone={gate.id === 'intake' ? 'info' : 'primary'}>{gate.label}</Badge>
      </div>
      <div className="min-w-0 font-semibold text-text-primary [overflow-wrap:anywhere]">{card.title}</div>
      <div className="grid gap-1 text-xs text-text-secondary">
        <span>Type: {objectLabel(card.object_ref.type)}</span>
        <span>Role: {roleFor(card)}</span>
        <span>Blocker: {card.blocked ? 'Blocked' : 'No blocker'}</span>
        <span>Risk: {riskLabel(card.risk)}</span>
        {card.priority !== undefined ? <span>Priority: {card.priority}</span> : null}
      </div>
      <div className="text-xs font-semibold text-text-primary">Next action: {nextActionFor(card)}</div>
    </>
  );
  const className =
    'grid min-w-0 gap-2 rounded-card border border-border bg-surface p-3 text-sm shadow-sm transition-colors duration-base ease-standard hover:border-primary hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary motion-reduce:transition-none';

  return href === undefined ? (
    <article aria-label={`${card.title} board card`} className={className}>
      {content}
      <div className="text-xs text-text-secondary">Open from the parent workspace.</div>
    </article>
  ) : (
    <Link className={className} to={href}>
      {content}
    </Link>
  );
}

function groupByGate(cards: BoardProductCard[]): { column: (typeof boardGateColumns)[number]; cards: BoardProductCard[] }[] {
  const grouped = new Map<BoardGateColumnId, BoardProductCard[]>();
  for (const card of cards) {
    const column = gateColumnFor(card).id;
    const existing = grouped.get(column) ?? [];
    existing.push(card);
    grouped.set(column, existing);
  }
  return boardGateColumns.map((column) => ({ column, cards: grouped.get(column.id) ?? [] }));
}

function gateColumnFor(card: BoardProductCard): (typeof boardGateColumns)[number] {
  const columnId = gateColumnIdFor(card);
  return boardGateColumns.find((column) => column.id === columnId) ?? intakeGateColumn;
}

function gateColumnIdFor(card: BoardProductCard): BoardGateColumnId {
  switch (card.object_ref.type) {
    case 'requirement':
    case 'initiative':
    case 'bug':
    case 'tech_debt':
    case 'development_plan':
    case 'attachment':
      return 'intake';
    case 'brainstorming_session':
    case 'boundary_summary':
      return 'boundary';
    case 'execution_plan':
      return 'execution-plan';
    case 'spec':
    case 'spec_revision':
      return 'spec';
    case 'execution_plan_revision':
      return 'execution-plan';
    case 'execution':
      return 'execution';
    case 'code_review_handoff':
      return 'review';
    case 'qa_handoff':
      return 'qa';
    case 'release':
      return 'release';
    case 'development_plan_item':
      return developmentPlanItemGateColumn(card);
  }
}

function developmentPlanItemGateColumn(card: BoardProductCard): BoardGateColumnId {
  const text = normalized(`${card.column_id} ${card.status} ${card.title}`);
  if (text.includes('release')) return 'release';
  if (text.includes('qa')) return 'qa';
  if (text.includes('review')) return 'review';
  if (text.includes('execution_plan') || text.includes('execution plan')) return 'execution-plan';
  if (text.includes('spec')) return 'spec';
  if (text.includes('boundary') || text.includes('brainstorm')) return 'boundary';
  if (text.includes('running') || text.includes('execute') || text.includes('execution') || text.includes('monitor') || text.includes('continue')) return 'execution';

  const statusParts = card.status.split('/').map(normalized);
  const [boundary, spec, executionPlan, execution] = statusParts;
  if (boundary !== undefined && boundary !== 'approved') return 'boundary';
  if (spec !== undefined && spec !== 'approved') return 'spec';
  if (executionPlan !== undefined && executionPlan !== 'approved') return 'execution-plan';
  if (execution !== undefined && execution !== 'completed') return 'execution';
  return 'release';
}

function objectLabel(type: BoardObjectRef['type']): string {
  switch (type) {
    case 'tech_debt':
      return 'Tech Debt';
    case 'development_plan_item':
      return 'Development Plan Item';
    case 'development_plan':
      return 'Development Plan';
    case 'brainstorming_session':
      return 'Brainstorming';
    case 'boundary_summary':
      return 'Boundary Summary';
    case 'spec':
      return 'Spec';
    case 'execution_plan':
      return 'Execution Plan';
    case 'execution_plan_revision':
      return 'Execution Plan Revision';
    case 'spec_revision':
      return 'Spec Revision';
    case 'qa_handoff':
      return 'QA Handoff';
    case 'code_review_handoff':
      return 'Code Review Handoff';
    case 'attachment':
      return 'Attachment';
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
      return 'Add to Development Plan';
    case 'development_plan_item':
      return 'Open item gates';
    case 'development_plan':
      return 'Review Development Plan';
    case 'brainstorming_session':
    case 'boundary_summary':
      return 'Review boundary';
    case 'spec':
    case 'spec_revision':
      return 'Review Spec';
    case 'execution_plan':
    case 'execution_plan_revision':
      return 'Review Execution Plan';
    case 'execution':
      return 'Inspect execution';
    case 'code_review_handoff':
      return 'Review code handoff';
    case 'qa_handoff':
      return 'Accept or block QA handoff';
    case 'release':
      return 'Review readiness';
    case 'attachment':
      return 'Open parent workspace';
    default:
      return 'Review';
  }
}

function roleFor(card: BoardProductCard): string {
  switch (card.object_ref.type) {
    case 'requirement':
    case 'initiative':
    case 'bug':
    case 'tech_debt':
      return 'Product driver';
    case 'development_plan_item':
      return roleForGate(gateColumnFor(card).id);
    case 'development_plan':
      return 'Product driver';
    case 'brainstorming_session':
    case 'boundary_summary':
    case 'spec':
    case 'spec_revision':
    case 'execution_plan':
    case 'execution_plan_revision':
      return 'Technical lead';
    case 'execution':
      return 'Developer';
    case 'code_review_handoff':
      return 'Reviewer';
    case 'qa_handoff':
      return 'QA';
    case 'release':
      return 'Release owner';
    case 'attachment':
      return 'Assigned role';
    default:
      return 'Assigned role';
  }
}

function roleForGate(gate: BoardGateColumnId): string {
  switch (gate) {
    case 'intake':
      return 'Product driver';
    case 'boundary':
    case 'spec':
    case 'execution-plan':
      return 'Technical lead';
    case 'execution':
      return 'Developer';
    case 'review':
      return 'Reviewer';
    case 'qa':
      return 'QA';
    case 'release':
      return 'Release owner';
  }
}

function riskLabel(risk: string | undefined): string {
  return risk === undefined ? 'Unscored' : titleCase(risk);
}

function boardObjectHref(card: BoardProductCard): string | undefined {
  return isSafeBoardHref(card.href) ? card.href : typedObjectHref(card.object_ref);
}

function typedObjectHref(ref: BoardObjectRef): string | undefined {
  switch (ref.type) {
    case 'initiative':
      return `/initiatives/${encodeURIComponent(ref.id)}`;
    case 'requirement':
      return `/requirements/${encodeURIComponent(ref.id)}`;
    case 'tech_debt':
      return `/tech-debt/${encodeURIComponent(ref.id)}`;
    case 'bug':
      return `/bugs/${encodeURIComponent(ref.id)}`;
    case 'development_plan':
      return `/development-plans/${encodeURIComponent(ref.id)}`;
    case 'development_plan_item':
      return `/development-plans/${encodeURIComponent(ref.development_plan_id)}/items/${encodeURIComponent(ref.id)}`;
    case 'spec':
      return `/specs-plans?spec_id=${encodeURIComponent(ref.id)}`;
    case 'spec_revision':
      return `/specs-plans?spec_revision_id=${encodeURIComponent(ref.id)}`;
    case 'execution_plan':
      return `/specs-plans?execution_plan_id=${encodeURIComponent(ref.id)}`;
    case 'execution_plan_revision':
      return `/specs-plans?execution_plan_revision_id=${encodeURIComponent(ref.id)}`;
    case 'release':
      return `/releases/${encodeURIComponent(ref.id)}`;
    case 'execution':
      return `/board?execution_id=${encodeURIComponent(ref.id)}`;
    case 'code_review_handoff':
      return `/reports?code_review_handoff_id=${encodeURIComponent(ref.id)}`;
    case 'qa_handoff':
      return `/reports?qa_handoff_id=${encodeURIComponent(ref.id)}`;
    case 'brainstorming_session':
    case 'boundary_summary':
    case 'attachment':
      return undefined;
  }
}

function isSafeBoardHref(href: string | undefined): href is string {
  return href !== undefined && href.startsWith('/') && !/^\/(?:tasks|plans|specs|packages)(?:\/|$)/.test(href);
}

function titleCase(value: string): string {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (match) => match.toUpperCase());
}

function normalized(value: string): string {
  return value.toLowerCase().replaceAll('-', '_');
}
