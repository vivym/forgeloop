import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useParams } from 'react-router';
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

export function RunsRegistry() {
  const { projectId } = useProjectContext();
  const query = useRunsQuery({ project_id: projectId, limit: 100 });
  const items = query.data?.items ?? [];

  return (
    <>
      <PageHeader
        subtitle="Active and recent run sessions from the product run read model."
        title="Runs"
      />
      <Section
        description="Rows link to the route-backed Run Console. If the read model is partial, use direct run links from Packages and Reviews."
        title="Run registry"
      >
        <RegistryState isError={query.isError} isPending={query.status === 'pending'} kind="runs" />
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
      header={<PageHeader subtitle={`${run.execution_package_id} / ${run.status}`} title="Run Console" />}
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
      emptyMessage="No Run Sessions are available from the global run read model. Open a run from a package detail page when needed."
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
  const latestTurnId = latestActiveTurnId(run, events);
  const visibleEvents = renderableRunEvents(events);

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
      description="Visible run events, operator input, cancel, and resume controls."
      title="Run Console"
    >
      <div className="fl-run-console" data-testid="run-console">
        {error ? <p className="empty">{error}</p> : null}
        <div className="fl-run-console__events" data-testid="run-console-events">
          {visibleEvents.length ? (
            visibleEvents.map((event) => <RunEventRow event={event} key={event.id} />)
          ) : (
            <p className="empty">{events.length ? 'No visible run events yet.' : 'No run events loaded.'}</p>
          )}
        </div>
        <form className="fl-run-console__controls" onSubmit={onSubmit}>
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
  const threadId = metadata?.codex_thread_id ?? latestPayloadString(events, ['thread_id', 'threadId']);
  const turnId = metadata?.active_turn_id ?? latestPayloadString(events, ['active_turn_id', 'turn_id', 'turnId']);
  const lastEventAt = events.at(-1)?.created_at ?? metadata?.last_event_at ?? run.updated_at;
  const currentPlanStep = latestPlanStep(events) ?? latestPayloadString(events, ['current_plan_step']);

  return (
    <dl className="fl-metadata-grid">
      <Metadata label="Package" value={run.execution_package_id} />
      <Metadata label="Executor" value={run.executor_type ?? metadata?.driver_kind ?? 'unknown'} />
      <Metadata label="Status" value={run.status} />
      <Metadata label="Stream" value={streamStatus} />
      <Metadata label="Worker lease" value={workerLeaseLabel(metadata, events)} />
      <Metadata label="Danger mode" value={metadata?.effective_dangerous_mode ?? 'not requested'} />
      <Metadata label="Thread" value={threadId ?? 'none'} />
      <Metadata label="Turn" value={turnId ?? 'none'} />
      <Metadata label="Last event" value={formatAge(lastEventAt)} />
      <Metadata label="Current plan step" value={currentPlanStep ?? 'none'} />
    </dl>
  );
}

function RunEvidencePanel({ run }: { run: RunSession }) {
  const failedChecks = (run.check_results ?? []).filter((check) => check.status !== 'passed');
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
  const type = event.event_type ?? 'event';
  const payload = event.payload ?? {};
  const message =
    payloadText(payload, ['message', 'text', 'content', 'status', 'reason']) ??
    event.summary ??
    event.source ??
    'Run event';

  return (
    <article className="fl-run-console__event" data-event-cursor={event.cursor} data-event-type={type}>
      <strong>{type}</strong>
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
    setEvents(appendRunEvents([], initialEvents));
    cursorRef.current = initialCursor;
  }, [initialCursor, initialEvents, runSessionId]);

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
              cursorRef.current = event.cursor ?? cursorRef.current;
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

function RegistryState({ isError, isPending, kind }: { isError: boolean; isPending: boolean; kind: string }) {
  if (isPending) return <p className="empty">Loading {kind}...</p>;
  if (isError) return <p className="empty">{kind} are temporarily unavailable.</p>;
  return null;
}

function DegradedNotice({ degradedSources }: { degradedSources: string[] }) {
  if (degradedSources.length === 0) return null;
  return <p className="empty">The global run list is degraded: {degradedSources.join(', ')}.</p>;
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
    <DetailLayout header={<PageHeader subtitle="Loading route-backed data." title={title} />}>
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

function visibleRunArtifacts<T extends { kind?: string; raw_ref?: unknown }>(artifacts: T[]): T[] {
  return artifacts.filter((artifact) => artifact.kind !== 'logs' && artifact.raw_ref === undefined);
}

function runArtifactDisplayLabel(artifact: Pick<ArtifactRef, 'kind' | 'name'>): string {
  return [artifact.kind ?? 'artifact', artifact.name].filter(Boolean).join(': ');
}

function workerLeaseLabel(
  metadata: { worker_id?: string; worker_lease_status?: string } | undefined,
  events: Array<{ event_type?: string; payload?: Record<string, unknown> }>,
) {
  if (metadata?.worker_id) {
    return `${metadata.worker_id} / ${metadata.worker_lease_status ?? 'status unavailable'}`;
  }
  const leaseEvent = [...events].reverse().find((event) => event.event_type === 'worker_lease_acquired' || event.event_type === 'watchdog_heartbeat');
  const workerId = payloadText(leaseEvent?.payload ?? {}, ['worker_id', 'workerId']);
  if (!workerId) return 'none';
  return `${workerId} / ${payloadText(leaseEvent?.payload ?? {}, ['lease_status', 'leaseStatus', 'status']) ?? 'status unavailable'}`;
}

function latestPlanStep(events: Array<{ event_type?: string; payload?: Record<string, unknown> }>) {
  const planEvent = [...events].reverse().find((event) => event.event_type === 'plan_updated');
  return payloadText(planEvent?.payload ?? {}, ['current_step', 'plan_step', 'step', 'status']);
}

function latestActiveTurnId(run: RunSession, events: RunEvent[]) {
  return run.runtime_metadata?.active_turn_id ?? latestPayloadString(events, ['active_turn_id', 'turn_id', 'turnId']);
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
