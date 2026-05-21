import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { renderableRunEvents } from '@forgeloop/contracts';

import { createForgeloopCommandApi } from '../../shared/api/commands';
import {
  useCancelRunMutation,
  useResumeRunMutation,
  useRunEventsQuery,
  useRunQuery,
  useRunsQuery,
  useSendRunInputMutation,
} from '../../shared/api/hooks';
import type { ArtifactRef, ProductListItem, RunEvent, RunEventStream, RunSession } from '../../shared/api/types';
import { useActorContext } from '../../shared/context/actor-context';
import { useProjectContext } from '../../shared/context/project-context';
import { ActionRail, DetailLayout, PageHeader, Section } from '../../shared/layout';
import { Badge, Button, DataTable, StatusPill, Textarea } from '../../shared/ui';

const emptyRunEvents: RunEvent[] = [];
const supportedRunFilters = ['status', 'execution_package_id', 'run_session_id', 'executor_type', 'cursor', 'limit'] as const;
type RunFilterKey = (typeof supportedRunFilters)[number];
type RunFilters = Partial<Record<Exclude<RunFilterKey, 'limit'>, string>> & { limit?: number };
type RunRuntimeMetadata = NonNullable<RunSession['runtime_metadata']>;

export function RunsRegistry() {
  const { projectId } = useProjectContext();
  const [searchParams] = useSearchParams();
  const filters = runFiltersFromSearch(searchParams);
  const query = useRunsQuery({ project_id: projectId, ...filters, limit: filters.limit ?? 100 });
  const items = query.data?.items ?? [];
  const unsupportedFilters = unsupportedRunFilters(searchParams);

  return (
    <>
      <PageHeader subtitle="Active and recent run sessions from the run inventory." title="Runs" />
      <Section
        description="Rows link to the Run Console. If the inventory is partial, use direct run links from Packages and Reviews."
        title="Run registry"
      >
        <RegistryState isError={query.isError} isPending={query.status === 'pending'} kind="runs" />
        <FilterSummary filters={filters} unsupportedFilters={unsupportedFilters} />
        {query.status !== 'pending' && !query.isError ? (
          <>
            <DegradedNotice degradedSources={query.data?.degraded_sources ?? []} />
            <RunTable items={items} />
          </>
        ) : null}
      </Section>
    </>
  );
}

export function RunDetail() {
  const { runSessionId } = useParams();

  if (!runSessionId) {
    return <InvalidDetail title="Run Console" message="This run route is missing a run session id." />;
  }

  return <RunConsoleRoute runSessionId={runSessionId} />;
}

function RunConsoleRoute({ runSessionId }: { runSessionId: string }) {
  const { actorId } = useActorContext();
  const runQuery = useRunQuery(runSessionId);
  const backfillQuery = useRunEventsQuery({ runSessionId, actorId });
  const eventStream = useRunEventStream({
    actorId,
    enabled: backfillQuery.isSuccess,
    initialCursor: backfillQuery.data?.next_cursor,
    initialEvents: backfillQuery.data?.events ?? emptyRunEvents,
    runSessionId,
  });
  const events = eventStream.events;
  const run = runQuery.data;

  if (runQuery.status === 'pending') {
    return <LoadingDetail title="Run Console" />;
  }

  if (runQuery.isError || run === undefined) {
    return <InvalidDetail title="Run Console" message="Run session data is temporarily unavailable." />;
  }

  return (
    <DetailLayout
      actionRail={
        <ActionRail title="Run metadata">
          <RunMetadata run={run} events={events} streamStatus={eventStream.streamStatus} />
        </ActionRail>
      }
      header={
        <PageHeader
          actions={
            <Link className="fl-button fl-button--secondary" to={`/packages/${encodeURIComponent(run.execution_package_id)}`}>
              Open Package
            </Link>
          }
          eyebrow={
            <span className="fl-inline-actions">
              <span>Run</span>
              <StatusPill tone={runStatusTone(run.status)}>{run.status}</StatusPill>
            </span>
          }
          subtitle={`Package ${run.execution_package_id} / Executor ${run.executor_type ?? 'unknown'}`}
          title="Run Console"
        />
      }
    >
      <RunConsole
        actorId={actorId}
        error={eventStream.error || (backfillQuery.isError ? 'Unable to load run events.' : '')}
        events={events}
        run={run}
        streamStatus={eventStream.streamStatus}
      />
      <RunEvidencePanel run={run} />
    </DetailLayout>
  );
}

function RunTable({ items }: { items: ProductListItem[] }) {
  return (
    <DataTable
      ariaLabel="Runs"
      columns={[
        {
          key: 'title',
          header: 'Run',
          cell: (item) => (
            <div className="stack-form compact">
              <strong>{item.title}</strong>
              <Link to={`/runs/${encodeURIComponent(item.object.id)}`} aria-label={`Open run ${item.object.id}`}>
                Open run
              </Link>
            </div>
          ),
        },
        { key: 'package', header: 'Package', cell: (item) => item.parent?.title ?? item.run_state?.execution_package_id ?? 'unknown' },
        { key: 'status', header: 'Status', cell: (item) => <StatusPill>{item.status ?? 'unknown'}</StatusPill> },
        { key: 'executor', header: 'Executor', cell: (item) => item.run_state?.executor_type ?? 'unknown' },
        { key: 'updated', header: 'Updated', cell: (item) => formatAge(item.updated_at) },
      ]}
      emptyMessage="No runs are available in the inventory. Open a run from a package detail page when needed."
      getRowKey={(item) => item.id}
      rows={items}
    />
  );
}

function RunConsole({
  actorId,
  error,
  events,
  run,
  streamStatus,
}: {
  actorId: string;
  error: string;
  events: RunEvent[];
  run: RunSession;
  streamStatus: string;
}) {
  const sendInput = useSendRunInputMutation(run.id);
  const cancelRun = useCancelRunMutation(run.id);
  const resumeRun = useResumeRunMutation(run.id);
  const [input, setInput] = useState('');
  const latestTurnId = latestActiveTurnId(events);
  const visibleEvents = productRunEvents(events);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const message = input.trim();
    if (!message) return;
    sendInput.mutate({
      actorId,
      message,
      ...(latestTurnId === undefined ? {} : { targetTurnId: latestTurnId }),
    });
    setInput('');
  }

  return (
    <Section
      actions={<Badge tone={streamTone(streamStatus)}>{streamStatus}</Badge>}
      description="Run history, operator input, cancel, and resume controls."
      title="Run Console"
    >
      <div className="fl-run-console" data-testid="run-console">
        {error ? <p className="empty">{error}</p> : null}
        <form className="fl-run-console__controls" data-testid="run-console-controls" onSubmit={onSubmit}>
          <label className="field">
            Input as {actorId}
            <Textarea
              data-testid="run-console-input"
              onChange={(event) => setInput(event.currentTarget.value)}
              placeholder="Send input to the active run"
              rows={4}
              value={input}
            />
          </label>
          <div className="fl-run-console__actions">
            <Button data-testid="run-console-send" disabled={!input.trim()} loading={sendInput.isPending} type="submit" variant="primary">
              Send
            </Button>
            <Button
              data-testid="run-console-cancel"
              loading={cancelRun.isPending}
              onClick={() => cancelRun.mutate({ actorId, reason: 'Operator requested cancellation from Run Console.' })}
              variant="danger"
            >
              Cancel
            </Button>
            <Button
              data-testid="run-console-resume"
              loading={resumeRun.isPending}
              onClick={() => resumeRun.mutate({ actorId, reason: 'Operator resumed the run from Run Console.' })}
              variant="secondary"
            >
              Resume
            </Button>
          </div>
        </form>
        <div className="fl-run-console__events" data-testid="run-console-events">
          {visibleEvents.length ? (
            visibleEvents.map((event) => <RunEventRow event={event} key={event.id} />)
          ) : (
            <p className="empty">{events.length ? 'No visible run events yet.' : 'No run events loaded.'}</p>
          )}
        </div>
      </div>
    </Section>
  );
}

function RunMetadata({
  events,
  run,
  streamStatus,
}: {
  events: RunEvent[];
  run: RunSession;
  streamStatus: string;
}) {
  const metadata = run.runtime_metadata;
  const lastEventAt = events.at(-1)?.created_at ?? metadataText(metadata, 'last_event_at') ?? run.updated_at;
  const currentPlanStep = latestPlanStep(events) ?? latestPayloadString(events, ['current_plan_step']);
  const executor = run.executor_type ?? metadataText(metadata, 'driver_kind') ?? 'unknown';

  return (
    <dl className="fl-metadata-grid">
      <Metadata label="Package" value={run.execution_package_id} />
      <Metadata label="Executor" value={executor} />
      <Metadata label="Status" value={run.status} />
      <Metadata label="Stream" value={streamStatus} />
      <Metadata label="Last event" value={formatAge(lastEventAt)} />
      <Metadata label="Current plan step" value={currentPlanStep ?? 'none'} />
      <Metadata label="Summary" value={run.failure_reason ?? run.summary ?? 'none'} />
    </dl>
  );
}

function RunEvidencePanel({ run }: { run: RunSession }) {
  const failedChecks = (run.check_results ?? []).filter((check) => check.status !== 'succeeded');
  const visibleArtifacts = visibleRunArtifacts(run.artifacts ?? []);

  return (
    <Section title="Evidence and checks" description="Product evidence and check summaries for review handoff.">
      <h3>Summary</h3>
      <p>{run.summary ?? run.failure_reason ?? 'No run summary has been recorded.'}</p>
      <h3>Changed files</h3>
      <PillList
        empty="No changed files recorded."
        values={(run.changed_files ?? []).map((file) => `${file.change_kind}: ${file.path}`)}
      />
      <h3>Failed checks</h3>
      <PillList empty="No failed checks." values={failedChecks.map((check) => `${check.check_id}: ${check.status}`)} />
      <h3>Artifacts</h3>
      <PillList empty="No public artifacts." values={visibleArtifacts.map(runArtifactDisplayLabel)} />
    </Section>
  );
}

function RunEventRow({ event }: { event: RunEvent }) {
  const type = event.event_type;
  const label = runEventLabel(type);
  const payload = event.payload ?? {};
  const message =
    payloadText(payload, ['message', 'text', 'content', 'status', 'reason']) ??
    event.summary ??
    event.source ??
    'Run event';

  return (
    <article className="fl-run-console__event" data-event-cursor={event.cursor} data-event-label={label}>
      <strong>{label}</strong>
      <p>{message}</p>
      <span>{formatDate(event.created_at)}</span>
    </article>
  );
}

function useRunEventStream({
  actorId,
  enabled,
  initialCursor,
  initialEvents,
  runSessionId,
}: {
  actorId: string;
  enabled: boolean;
  initialCursor: string | undefined;
  initialEvents: RunEvent[];
  runSessionId: string;
}) {
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [streamStatus, setStreamStatus] = useState('idle');
  const [error, setError] = useState('');
  const streamRef = useRef<RunEventStream | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cursorRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    streamRef.current?.close();
    streamRef.current = null;
    if (retryRef.current !== undefined) {
      clearTimeout(retryRef.current);
      retryRef.current = undefined;
    }
    setEvents([]);
    cursorRef.current = undefined;
    setError('');
    setStreamStatus('idle');
  }, [actorId, runSessionId]);

  useEffect(() => {
    if (!enabled) return;
    setEvents((current) => appendRunEvents(current, initialEvents));
    cursorRef.current = nextCursor(cursorRef.current, initialCursor ?? latestEventCursor(initialEvents));
  }, [enabled, initialCursor, initialEvents]);

  useEffect(() => {
    if (!enabled) return;
    if (typeof EventSource === 'undefined') {
      setStreamStatus('blocked');
      setError('Live run event stream is unavailable; showing backfilled events.');
      return;
    }
    let stopped = false;
    const api = createForgeloopCommandApi();

    const openStream = async (after?: string) => {
      if (stopped) return;
      setStreamStatus('connecting');
      try {
        const stream = await api.openRunEventStream(
          runSessionId,
          { actorId, ...(after === undefined ? {} : { after }) },
          {
            onEvent: (event) => {
              if (stopped) return;
              setEvents((current) => appendRunEvents(current, [event]));
              cursorRef.current = nextCursor(cursorRef.current, event.cursor);
              setError('');
              setStreamStatus('live');
            },
            onError: () => {
              if (stopped) return;
              setError('Run event stream disconnected; reconnecting.');
              setStreamStatus('retrying');
              streamRef.current?.close();
              retryRef.current = setTimeout(() => {
                retryRef.current = undefined;
                void openStream(cursorRef.current);
              }, 1500);
            },
          },
        );
        if (stopped) {
          stream.close();
          return;
        }
        streamRef.current = stream;
        setStreamStatus('live');
      } catch (cause) {
        if (stopped) return;
        setStreamStatus('blocked');
        setError(cause instanceof Error ? cause.message : 'Unable to open run event stream.');
      }
    };

    void openStream(cursorRef.current);

    return () => {
      stopped = true;
      streamRef.current?.close();
      streamRef.current = null;
      if (retryRef.current !== undefined) {
        clearTimeout(retryRef.current);
        retryRef.current = undefined;
      }
    };
  }, [actorId, enabled, runSessionId]);

  return { error, events, streamStatus };
}

function appendRunEvents(current: RunEvent[], incoming: RunEvent[]): RunEvent[] {
  const byCursorOrId = new Map<string, RunEvent>();
  for (const event of [...current, ...incoming]) {
    byCursorOrId.set(event.cursor ?? event.id, event);
  }
  return [...byCursorOrId.values()].sort((left, right) => numericSequence(left) - numericSequence(right));
}

function numericSequence(event: RunEvent) {
  if (typeof event.sequence === 'number') return event.sequence;
  if (typeof event.cursor === 'string') {
    const parsed = Number.parseInt(event.cursor, 10);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return 0;
}

function latestEventCursor(events: RunEvent[]) {
  return events.reduce<string | undefined>((cursor, event) => nextCursor(cursor, event.cursor), undefined);
}

function nextCursor(current: string | undefined, incoming: string | undefined) {
  if (incoming === undefined) return current;
  if (current === undefined) return incoming;
  return compareCursor(incoming, current) >= 0 ? incoming : current;
}

function compareCursor(left: string, right: string) {
  const leftNumber = Number.parseInt(left, 10);
  const rightNumber = Number.parseInt(right, 10);
  if (!Number.isNaN(leftNumber) && !Number.isNaN(rightNumber)) {
    return leftNumber - rightNumber;
  }
  return left.localeCompare(right);
}

function RegistryState({ isError, isPending, kind }: { isError: boolean; isPending: boolean; kind: string }) {
  if (isPending) return <p className="empty">Loading {kind}...</p>;
  if (isError) return <p className="empty">{kind} are temporarily unavailable.</p>;
  return null;
}

function DegradedNotice({ degradedSources }: { degradedSources: string[] }) {
  if (degradedSources.length === 0) return null;
  return <p className="empty">The run list is degraded: {degradedSources.join(', ')}.</p>;
}

function FilterSummary({
  filters,
  unsupportedFilters,
}: {
  filters: RunFilters;
  unsupportedFilters: string[];
}) {
  const entries = Object.entries(filters);
  if (entries.length === 0 && unsupportedFilters.length === 0) return null;

  return (
    <div className="stack-form compact">
      {entries.length ? (
        <div className="fl-inline-actions">
          {entries.map(([key, value]) => (
            <Badge key={key}>{key}: {String(value)}</Badge>
          ))}
        </div>
      ) : null}
      {unsupportedFilters.length ? (
        <p className="empty">
          {formatUnsupportedFilters(unsupportedFilters)} {unsupportedFilters.length === 1 ? 'is' : 'are'} not applied to the run inventory yet.
        </p>
      ) : null}
    </div>
  );
}

function InvalidDetail({ title, message }: { title: string; message: string }) {
  return (
    <DetailLayout header={<PageHeader subtitle={message} title={title} />}>
      <Section title="Unavailable">
        <p className="empty">{message}</p>
      </Section>
    </DetailLayout>
  );
}

function LoadingDetail({ title }: { title: string }) {
  return (
    <DetailLayout header={<PageHeader subtitle="Loading data." title={title} />}>
      <Section title="Loading">
        <p className="empty">Loading {title.toLowerCase()}...</p>
      </Section>
    </DetailLayout>
  );
}

function Metadata({ label, value }: { label: string; value: string | number | boolean }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{String(value)}</dd>
    </div>
  );
}

function PillList({ empty, values }: { empty: string; values: string[] }) {
  return values.length ? (
    <div className="fl-inline-actions">
      {values.map((value) => <Badge key={value}>{value}</Badge>)}
    </div>
  ) : (
    <p className="empty">{empty}</p>
  );
}

const productRunEventLabels = new Map<string, string>([
  ['agent_message', 'Run update'],
  ['agent_message_delta', 'Run update'],
  ['agent_message_completed', 'Run update'],
  ['user_input', 'Operator input'],
  ['run_queued', 'Run queued'],
  ['worker_started', 'Run started'],
  ['waiting_for_input', 'Waiting for input'],
  ['plan_updated', 'Plan updated'],
  ['command_started', 'Check started'],
  ['command_completed', 'Check completed'],
  ['command_failed', 'Check failed'],
  ['resuming', 'Resume requested'],
  ['cancel_requested', 'Cancellation requested'],
  ['run_completed', 'Run completed'],
  ['run_failed', 'Run failed'],
]);

function productRunEvents(events: RunEvent[]) {
  return renderableRunEvents(events).filter((event) => {
    const type = event.event_type;
    return type === undefined || !isInternalRunEventType(type);
  });
}

function runEventLabel(eventType: string | undefined): string {
  if (eventType === undefined) return 'Run event';
  return productRunEventLabels.get(eventType) ?? 'Run event';
}

function isInternalRunEventType(eventType: string) {
  return eventType.startsWith('thread_') || eventType.startsWith('turn_');
}

function visibleRunArtifacts<T extends { kind?: string | undefined; raw_ref?: unknown }>(artifacts: T[]): T[] {
  return artifacts.filter((artifact) => artifact.kind !== 'logs' && artifact.raw_ref === undefined);
}

function runArtifactDisplayLabel(artifact: Pick<ArtifactRef, 'kind' | 'name'>): string {
  return [artifact.kind ?? 'artifact', artifact.name].filter(Boolean).join(': ');
}

function latestPlanStep(events: Array<{ event_type?: string; payload?: Record<string, unknown> }>) {
  const planEvent = [...events].reverse().find((event) => event.event_type === 'plan_updated');
  return payloadText(planEvent?.payload ?? {}, ['current_step', 'plan_step', 'step', 'status']);
}

function metadataText(metadata: RunRuntimeMetadata | undefined, key: keyof RunRuntimeMetadata) {
  const value = metadata?.[key];
  if (typeof value === 'string' && value.trim()) return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
}

function latestActiveTurnId(events: RunEvent[]): string | undefined {
  return latestPayloadString(events, ['active_turn_id', 'turn_id', 'turnId']);
}

function latestPayloadString(events: RunEvent[], keys: string[]) {
  for (const event of [...events].reverse()) {
    const value = payloadText(event.payload ?? {}, keys);
    if (value) return value;
  }
  return undefined;
}

function payloadText(payload: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === 'string' && value.trim()) return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  }
  return undefined;
}

function streamTone(streamStatus: string) {
  if (streamStatus === 'live') return 'success';
  if (streamStatus === 'blocked') return 'danger';
  if (streamStatus === 'retrying') return 'warning';
  return 'neutral';
}

function runStatusTone(value: string | undefined) {
  const normalized = value?.toLowerCase() ?? '';
  if (['completed', 'passed', 'succeeded'].includes(normalized)) return 'success';
  if (['cancelled', 'failed', 'timed_out'].includes(normalized)) return 'danger';
  if (['pending', 'queued', 'running'].includes(normalized)) return 'warning';
  return 'info';
}

function formatAge(value?: string) {
  if (!value) return 'unknown';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function formatDate(value?: string) {
  if (!value) return 'unknown';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function runFiltersFromSearch(searchParams: URLSearchParams) {
  const filters: RunFilters = {};
  for (const key of supportedRunFilters) {
    const value = searchParams.get(key)?.trim();
    if (!value) continue;
    if (key === 'limit') {
      if (isSupportedLimitFilter(value)) {
        filters[key] = Number.parseInt(value, 10);
      }
      continue;
    }
    filters[key] = value;
  }
  return filters;
}

function unsupportedRunFilters(searchParams: URLSearchParams) {
  const allowed = new Set<string>([...supportedRunFilters, 'project_id']);
  const unsupported = new Set([...searchParams.keys()].filter((key) => !allowed.has(key)));
  const limit = searchParams.get('limit')?.trim();
  if (limit && !isSupportedLimitFilter(limit)) {
    unsupported.add('limit');
  }
  return [...unsupported];
}

function isSupportedLimitFilter(value: string) {
  if (!/^\d+$/.test(value)) return false;
  const parsed = Number.parseInt(value, 10);
  return parsed > 0 && parsed <= 100;
}

function formatUnsupportedFilters(filters: string[]) {
  if (filters.length <= 1) return filters[0] ?? 'Unsupported filters';
  if (filters.length === 2) return `${filters[0]} and ${filters[1]}`;
  return `${filters.slice(0, -1).join(', ')}, and ${filters[filters.length - 1]}`;
}
