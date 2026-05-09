import { and, asc, desc, eq, getTableColumns, gt, inArray, lt, notInArray, or, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { AnyPgColumn, AnyPgTable } from 'drizzle-orm/pg-core';
import type {
  Artifact,
  Decision,
  DomainError as DomainErrorType,
  ExecutionPackage,
  ExecutionPackageDependency,
  ObjectEvent,
  Plan,
  PlanRevision,
  Project,
  ProjectRepo,
  ReviewPacket,
  RunCommand,
  RunEvent,
  RunSession,
  RunWorkerLease,
  Spec,
  SpecRevision,
  StatusHistory,
  WorkItem,
} from '@forgeloop/domain';
import { DomainError } from '@forgeloop/domain';

import * as schema from '../schema';
import {
  artifacts,
  decisions,
  execution_package_dependencies,
  execution_packages,
  object_events,
  plan_revisions,
  plans,
  project_repos,
  projects,
  review_packets,
  run_commands,
  run_event_counters,
  run_events,
  run_sessions,
  run_worker_leases,
  spec_revisions,
  specs,
  status_histories,
  trace_artifact_refs,
  trace_events,
  trace_links,
  work_items,
} from '../schema';
import type { P0Repository, TraceArtifactRefRecord, TraceEventRecord, TraceLinkRecord } from './p0-repository';

export type ForgeloopDrizzleDatabase = NodePgDatabase<typeof schema>;

const snakeToCamel = (value: string) => value.replace(/_([a-z])/g, (_, char: string) => char.toUpperCase());
const camelToSnake = (value: string) => value.replace(/[A-Z]/g, (char) => `_${char.toLowerCase()}`);
const timestampKeyPattern = /(?:^|_)at$|At$/;
const postgresTimestampPattern = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}(?:\.\d+)?)([+-]\d{2})(?::?(\d{2}))?$/;

const toDbRecord = (record: object, table?: AnyPgTable): Record<string, unknown> => {
  const dbRecord = Object.fromEntries(Object.entries(record).map(([key, value]) => [snakeToCamel(key), value]));

  if (table === undefined) {
    return dbRecord;
  }

  for (const [columnName, column] of Object.entries(getTableColumns(table))) {
    if (!(column as { notNull?: boolean }).notNull && dbRecord[columnName] === undefined) {
      dbRecord[columnName] = null;
    }
  }

  return dbRecord;
};

const normalizeTimestampValue = (key: string, value: unknown): unknown => {
  if (!timestampKeyPattern.test(key) || (typeof value !== 'string' && !(value instanceof Date))) {
    return value;
  }

  const normalizedInput =
    typeof value === 'string'
      ? value.replace(postgresTimestampPattern, (_match, date: string, time: string, offsetHours: string, offsetMinutes?: string) => {
          return `${date}T${time}${offsetHours}:${offsetMinutes ?? '00'}`;
        })
      : value;
  const date = normalizedInput instanceof Date ? normalizedInput : new Date(normalizedInput);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
};

const fromDbRecord = <T>(record: Record<string, unknown>): T =>
  Object.fromEntries(
    Object.entries(record)
      .filter(([, value]) => value !== null)
      .map(([key, value]) => [camelToSnake(key), normalizeTimestampValue(key, value)]),
  ) as T;

const recoverableRunSessionStatuses: RunSession['status'][] = [
  'queued',
  'running',
  'waiting_for_input',
  'stalled',
  'resuming',
  'cancel_requested',
];
const eventCursor = (sequence: number) => String(sequence).padStart(10, '0');
const invalidLease = (runSessionId: string): DomainErrorType =>
  new DomainError('INVALID_TRANSITION', `Run session ${runSessionId} does not have an active worker lease`);

export class DrizzleP0Repository implements P0Repository {
  constructor(private readonly db: ForgeloopDrizzleDatabase) {}

  async saveProject(project: Project): Promise<void> {
    await this.upsert(projects, projects.id, project);
  }

  async getProject(projectId: string): Promise<Project | undefined> {
    return this.getById(projects, projects.id, projectId);
  }

  async saveProjectRepo(projectRepo: ProjectRepo): Promise<void> {
    await this.upsert(project_repos, project_repos.id, projectRepo);
  }

  async listProjectRepos(projectId: string): Promise<ProjectRepo[]> {
    return this.listWhere<ProjectRepo>(project_repos, eq(project_repos.projectId, projectId));
  }

  async saveWorkItem(workItem: WorkItem): Promise<void> {
    await this.upsert(work_items, work_items.id, workItem);
  }

  async getWorkItem(workItemId: string): Promise<WorkItem | undefined> {
    return this.getById(work_items, work_items.id, workItemId);
  }

  async listWorkItems(projectId?: string): Promise<WorkItem[]> {
    return projectId === undefined
      ? this.listWhere<WorkItem>(work_items)
      : this.listWhere<WorkItem>(work_items, eq(work_items.projectId, projectId));
  }

  async saveSpec(spec: Spec): Promise<void> {
    await this.upsert(specs, specs.id, spec);
  }

  async getSpec(specId: string): Promise<Spec | undefined> {
    return this.getById(specs, specs.id, specId);
  }

  async saveSpecRevision(specRevision: SpecRevision): Promise<void> {
    await this.upsert(spec_revisions, spec_revisions.id, specRevision);
  }

  async getSpecRevision(specRevisionId: string): Promise<SpecRevision | undefined> {
    return this.getById(spec_revisions, spec_revisions.id, specRevisionId);
  }

  async listSpecRevisions(specId: string): Promise<SpecRevision[]> {
    return this.listWhere<SpecRevision>(spec_revisions, eq(spec_revisions.specId, specId), spec_revisions.revisionNumber);
  }

  async savePlan(plan: Plan): Promise<void> {
    await this.upsert(plans, plans.id, plan);
  }

  async getPlan(planId: string): Promise<Plan | undefined> {
    return this.getById(plans, plans.id, planId);
  }

  async savePlanRevision(planRevision: PlanRevision): Promise<void> {
    await this.upsert(plan_revisions, plan_revisions.id, planRevision);
  }

  async getPlanRevision(planRevisionId: string): Promise<PlanRevision | undefined> {
    return this.getById(plan_revisions, plan_revisions.id, planRevisionId);
  }

  async listPlanRevisions(planId: string): Promise<PlanRevision[]> {
    return this.listWhere<PlanRevision>(plan_revisions, eq(plan_revisions.planId, planId), plan_revisions.revisionNumber);
  }

  async saveExecutionPackage(executionPackage: ExecutionPackage): Promise<void> {
    await this.upsert(execution_packages, execution_packages.id, executionPackage);
  }

  async getExecutionPackage(executionPackageId: string): Promise<ExecutionPackage | undefined> {
    return this.getById(execution_packages, execution_packages.id, executionPackageId);
  }

  async listExecutionPackagesForWorkItem(workItemId: string): Promise<ExecutionPackage[]> {
    return this.listWhere<ExecutionPackage>(execution_packages, eq(execution_packages.workItemId, workItemId));
  }

  async saveExecutionPackageDependency(dependency: ExecutionPackageDependency): Promise<void> {
    const record = toDbRecord(dependency, execution_package_dependencies);
    await this.db
      .insert(execution_package_dependencies)
      .values(record as never)
      .onConflictDoUpdate({
        target: [execution_package_dependencies.packageId, execution_package_dependencies.dependsOnPackageId],
        set: record as never,
      });
  }

  async listExecutionPackageDependencies(executionPackageId: string): Promise<ExecutionPackageDependency[]> {
    return this.listWhere<ExecutionPackageDependency>(
      execution_package_dependencies,
      eq(execution_package_dependencies.packageId, executionPackageId),
    );
  }

  async saveRunSession(runSession: RunSession): Promise<void> {
    await this.upsert(run_sessions, run_sessions.id, runSession);
  }

  async getRunSession(runSessionId: string): Promise<RunSession | undefined> {
    return this.getById(run_sessions, run_sessions.id, runSessionId);
  }

  async listRunSessionsForPackage(executionPackageId: string): Promise<RunSession[]> {
    return this.listWhere<RunSession>(
      run_sessions,
      eq(run_sessions.executionPackageId, executionPackageId),
      run_sessions.createdAt,
    );
  }

  async listRecoverableRunSessions(): Promise<RunSession[]> {
    return this.listWhere<RunSession>(
      run_sessions,
      inArray(run_sessions.status, recoverableRunSessionStatuses),
      run_sessions.createdAt,
    );
  }

  async appendRunEvent(event: Omit<RunEvent, 'sequence' | 'cursor'>): Promise<RunEvent> {
    return this.db.transaction((tx) => this.appendRunEventInTransaction(tx as ForgeloopDrizzleDatabase, event));
  }

  async listRunEvents(runSessionId: string, options: { after?: string; limit?: number } = {}): Promise<RunEvent[]> {
    const conditions = [
      eq(run_events.runSessionId, runSessionId),
      options.after === undefined ? undefined : gt(run_events.cursor, options.after),
    ].filter((condition) => condition !== undefined);
    const query = this.db
      .select()
      .from(run_events)
      .where(and(...conditions))
      .orderBy(asc(run_events.sequence));
    const rows = options.limit === undefined ? await query : await query.limit(options.limit);

    return rows.map((row) => fromDbRecord<RunEvent>(row));
  }

  async getLatestRunEvent(runSessionId: string): Promise<RunEvent | undefined> {
    const [row] = await this.db
      .select()
      .from(run_events)
      .where(eq(run_events.runSessionId, runSessionId))
      .orderBy(desc(run_events.sequence))
      .limit(1);

    return row === undefined ? undefined : fromDbRecord<RunEvent>(row);
  }

  async appendWorkerRunEvent(
    event: Omit<RunEvent, 'sequence' | 'cursor'>,
    lease: { workerId: string; leaseToken: string },
  ): Promise<RunEvent> {
    return this.db.transaction(async (tx) => {
      const db = tx as ForgeloopDrizzleDatabase;
      await this.lockActiveRunWorkerLease(db, event.run_session_id, lease.workerId, lease.leaseToken, event.created_at);
      return this.appendRunEventInTransaction(db, event);
    });
  }

  async saveRunCommand(command: RunCommand): Promise<void> {
    await this.upsert(run_commands, run_commands.id, command);
  }

  async claimNextRunCommand(
    runSessionId: string,
    workerId: string,
    leaseToken: string,
    now: string,
    options: { reclaim_claimed_before?: string } = {},
  ): Promise<{ command: RunCommand; reclaimed: boolean } | undefined> {
    return this.db.transaction(async (tx) => {
      await this.lockActiveRunWorkerLease(tx as ForgeloopDrizzleDatabase, runSessionId, workerId, leaseToken, now);

      const pendingResult = await tx.execute(sql<Record<string, unknown>>`
        with candidate as (
          select id
          from run_commands
          where run_session_id = ${runSessionId}
            and status = 'pending'
          order by case when command_type = 'cancel' then 0 else 1 end, created_at asc
          for update skip locked
          limit 1
        )
        update run_commands
        set status = 'claimed',
            claimed_by_worker_id = ${workerId},
            claimed_at = ${now},
            updated_at = ${now}
        from candidate
        where run_commands.id = candidate.id
        returning run_commands.*, false as reclaimed
      `);
      const pending = this.commandClaimFromRows(pendingResult.rows);
      if (pending !== undefined) {
        return pending;
      }

      if (options.reclaim_claimed_before === undefined) {
        return undefined;
      }

      const staleResult = await tx.execute(sql<Record<string, unknown>>`
        with candidate as (
          select id
          from run_commands
          where run_session_id = ${runSessionId}
            and status = 'claimed'
            and claimed_at <= ${options.reclaim_claimed_before}
          order by claimed_at asc
          for update skip locked
          limit 1
        )
        update run_commands
        set claimed_by_worker_id = ${workerId},
            claimed_at = ${now},
            updated_at = ${now}
        from candidate
        where run_commands.id = candidate.id
        returning run_commands.*, true as reclaimed
      `);

      return this.commandClaimFromRows(staleResult.rows);
    });
  }

  async recordRunCommandDriverAck(
    commandId: string,
    lease: { workerId: string; leaseToken: string },
    driverAck: Record<string, unknown>,
    acknowledgedAt: string,
  ): Promise<void> {
    await this.updateFencedRunCommand(commandId, lease, acknowledgedAt, sql`
      driver_ack = ${JSON.stringify(driverAck)}::jsonb,
      updated_at = ${acknowledgedAt}
    `);
  }

  async markRunCommandApplied(
    commandId: string,
    lease: { workerId: string; leaseToken: string },
    appliedAt: string,
    driverAck: Record<string, unknown>,
  ): Promise<void> {
    await this.updateFencedRunCommand(commandId, lease, appliedAt, sql`
      status = 'applied',
      applied_at = ${appliedAt},
      driver_ack = ${JSON.stringify(driverAck)}::jsonb,
      updated_at = ${appliedAt}
    `);
  }

  async markRunCommandFailed(
    commandId: string,
    lease: { workerId: string; leaseToken: string },
    failureReason: string,
    failedAt: string,
  ): Promise<void> {
    await this.updateFencedRunCommand(commandId, lease, failedAt, sql`
      status = 'failed',
      failure_reason = ${failureReason},
      updated_at = ${failedAt}
    `);
  }

  async supersedePendingRunCommands(
    runSessionId: string,
    commandTypes: RunCommand['command_type'][],
    now: string,
  ): Promise<void> {
    if (commandTypes.length === 0) {
      return;
    }

    await this.db
      .update(run_commands)
      .set({ status: 'superseded', updatedAt: now })
      .where(
        and(
          eq(run_commands.runSessionId, runSessionId),
          eq(run_commands.status, 'pending'),
          inArray(run_commands.commandType, commandTypes),
        ),
      );
  }

  async supersedePendingRunCommandsForWorker(
    runSessionId: string,
    commandTypes: RunCommand['command_type'][],
    lease: { workerId: string; leaseToken: string },
    now: string,
  ): Promise<void> {
    if (commandTypes.length === 0) {
      return;
    }

    await this.db.transaction(async (tx) => {
      await this.lockActiveRunWorkerLease(tx as ForgeloopDrizzleDatabase, runSessionId, lease.workerId, lease.leaseToken, now);
      await tx
        .update(run_commands)
        .set({ status: 'superseded', updatedAt: now })
        .where(
          and(
            eq(run_commands.runSessionId, runSessionId),
            eq(run_commands.status, 'pending'),
            inArray(run_commands.commandType, commandTypes),
          ),
        );
    });
  }

  async claimRunWorkerLease(input: {
    run_session_id: string;
    worker_id: string;
    lease_token: string;
    now: string;
    expires_at: string;
  }): Promise<RunWorkerLease> {
    return this.db.transaction(async (tx) => {
      const leaseId = `${input.run_session_id}:${input.worker_id}:${input.lease_token}`;
      const result = await tx.execute(sql<Record<string, unknown>>`
        insert into run_worker_leases (
          id,
          run_session_id,
          worker_id,
          lease_token,
          heartbeat_at,
          expires_at,
          status
        )
        values (
          ${leaseId},
          ${input.run_session_id},
          ${input.worker_id},
          ${input.lease_token},
          ${input.now},
          ${input.expires_at},
          'active'
        )
        on conflict (run_session_id)
        do update set
          id = excluded.id,
          worker_id = excluded.worker_id,
          lease_token = excluded.lease_token,
          heartbeat_at = excluded.heartbeat_at,
          expires_at = excluded.expires_at,
          status = 'active'
        where run_worker_leases.status <> 'active'
          or run_worker_leases.expires_at <= excluded.heartbeat_at
          or run_worker_leases.worker_id = excluded.worker_id
        returning *
      `);

      const row = result.rows[0];
      if (row === undefined) {
        throw invalidLease(input.run_session_id);
      }

      return fromDbRecord<RunWorkerLease>(row);
    });
  }

  async heartbeatRunWorkerLease(
    runSessionId: string,
    workerId: string,
    leaseToken: string,
    heartbeatAt: string,
    expiresAt: string,
  ): Promise<void> {
    const rows = await this.fencedLeaseUpdate(runSessionId, workerId, leaseToken, heartbeatAt, sql`
      heartbeat_at = ${heartbeatAt},
      expires_at = ${expiresAt}
    `);
    if (rows.length === 0) {
      throw invalidLease(runSessionId);
    }
  }

  async getRunWorkerLease(runSessionId: string): Promise<RunWorkerLease | undefined> {
    const [row] = await this.db
      .select()
      .from(run_worker_leases)
      .where(eq(run_worker_leases.runSessionId, runSessionId))
      .limit(1);

    return row === undefined ? undefined : fromDbRecord<RunWorkerLease>(row);
  }

  async releaseRunWorkerLease(runSessionId: string, workerId: string, leaseToken: string, releasedAt: string): Promise<void> {
    const rows = await this.fencedLeaseUpdate(runSessionId, workerId, leaseToken, releasedAt, sql`
      heartbeat_at = ${releasedAt},
      status = 'released'
    `);
    if (rows.length === 0) {
      throw invalidLease(runSessionId);
    }
  }

  async assertActiveRunWorkerLease(
    runSessionId: string,
    workerId: string,
    leaseToken: string,
    now: string,
  ): Promise<void> {
    const [row] = await this.db
      .select()
      .from(run_worker_leases)
      .where(
        and(
          eq(run_worker_leases.runSessionId, runSessionId),
          eq(run_worker_leases.workerId, workerId),
          eq(run_worker_leases.leaseToken, leaseToken),
          eq(run_worker_leases.status, 'active'),
          gt(run_worker_leases.expiresAt, now),
        ),
      )
      .limit(1);

    if (row === undefined) {
      throw invalidLease(runSessionId);
    }
  }

  async withActiveRunWorkerLease<T>(
    runSessionId: string,
    lease: { workerId: string; leaseToken: string; now: string },
    write: (repository: P0Repository) => Promise<T>,
  ): Promise<T> {
    return this.db.transaction(async (tx) => {
      await this.lockActiveRunWorkerLease(tx as ForgeloopDrizzleDatabase, runSessionId, lease.workerId, lease.leaseToken, lease.now);
      const repository = new DrizzleP0Repository(tx as ForgeloopDrizzleDatabase);
      const result = await write(repository);
      await repository.assertActiveRunWorkerLease(runSessionId, lease.workerId, lease.leaseToken, lease.now);
      return result;
    });
  }

  async saveReviewPacket(reviewPacket: ReviewPacket): Promise<void> {
    await this.upsert(review_packets, review_packets.id, reviewPacket);
  }

  async getReviewPacket(reviewPacketId: string): Promise<ReviewPacket | undefined> {
    return this.getById(review_packets, review_packets.id, reviewPacketId);
  }

  async listReviewPacketsForPackage(executionPackageId: string): Promise<ReviewPacket[]> {
    return this.listWhere<ReviewPacket>(
      review_packets,
      eq(review_packets.executionPackageId, executionPackageId),
      review_packets.createdAt,
    );
  }

  async findOpenReviewPacketForPackage(executionPackageId: string): Promise<ReviewPacket | undefined> {
    const [row] = await this.db
      .select()
      .from(review_packets)
      .where(
        and(
          eq(review_packets.executionPackageId, executionPackageId),
          notInArray(review_packets.status, ['completed', 'archived']),
        ),
      )
      .orderBy(asc(review_packets.createdAt))
      .limit(1);

    return row === undefined ? undefined : fromDbRecord<ReviewPacket>(row);
  }

  async appendObjectEvent(objectEvent: ObjectEvent): Promise<void> {
    await this.db.insert(object_events).values(toDbRecord(objectEvent, object_events) as never).onConflictDoNothing();
  }

  async listObjectEvents(objectId: string, objectType?: string): Promise<ObjectEvent[]> {
    return this.listWhere<ObjectEvent>(
      object_events,
      objectType === undefined
        ? eq(object_events.objectId, objectId)
        : and(eq(object_events.objectId, objectId), eq(object_events.objectType, objectType)),
      object_events.createdAt,
    );
  }

  async appendStatusHistory(statusHistory: StatusHistory): Promise<void> {
    await this.db
      .insert(status_histories)
      .values(toDbRecord(statusHistory, status_histories) as never)
      .onConflictDoNothing();
  }

  async listStatusHistory(objectId: string, objectType?: string): Promise<StatusHistory[]> {
    return this.listWhere<StatusHistory>(
      status_histories,
      objectType === undefined
        ? eq(status_histories.objectId, objectId)
        : and(eq(status_histories.objectId, objectId), eq(status_histories.objectType, objectType)),
      status_histories.createdAt,
    );
  }

  async saveArtifact(artifact: Artifact): Promise<void> {
    await this.upsert(artifacts, artifacts.id, artifact);
  }

  async listArtifactsForObject(objectType: string, objectId: string): Promise<Artifact[]> {
    return this.listWhere<Artifact>(
      artifacts,
      and(eq(artifacts.objectType, objectType), eq(artifacts.objectId, objectId)),
      artifacts.createdAt,
    );
  }

  async saveDecision(decision: Decision): Promise<void> {
    await this.upsert(decisions, decisions.id, decision);
  }

  async listDecisionsForObject(objectType: string, objectId: string): Promise<Decision[]> {
    return this.listWhere<Decision>(
      decisions,
      and(eq(decisions.objectType, objectType), eq(decisions.objectId, objectId)),
      decisions.createdAt,
    );
  }

  async saveTraceEvent(traceEvent: TraceEventRecord): Promise<void> {
    const record = toDbRecord(traceEvent, trace_events);
    const { createdAt: _createdAt, ...set } = record;
    await this.db
      .insert(trace_events)
      .values(record as never)
      .onConflictDoUpdate({ target: trace_events.id, set: set as never });
  }

  async listTraceEventsForSubject(subjectType: string, subjectId: string): Promise<TraceEventRecord[]> {
    return this.listWhere<TraceEventRecord>(
      trace_events,
      and(eq(trace_events.subjectType, subjectType), eq(trace_events.subjectId, subjectId)),
      [trace_events.createdAt, trace_events.id],
    );
  }

  async saveTraceLink(traceLink: TraceLinkRecord): Promise<void> {
    await this.db.insert(trace_links).values(toDbRecord(traceLink, trace_links) as never).onConflictDoNothing();
  }

  async listTraceLinks(traceEventId: string): Promise<TraceLinkRecord[]> {
    return this.listWhere<TraceLinkRecord>(trace_links, eq(trace_links.traceEventId, traceEventId), [
      trace_links.createdAt,
      trace_links.id,
    ]);
  }

  async saveTraceArtifactRef(traceArtifactRef: TraceArtifactRefRecord): Promise<void> {
    await this.db
      .insert(trace_artifact_refs)
      .values(toDbRecord(traceArtifactRef, trace_artifact_refs) as never)
      .onConflictDoNothing();
  }

  async listTraceArtifactRefs(traceEventId: string): Promise<TraceArtifactRefRecord[]> {
    return this.listWhere<TraceArtifactRefRecord>(
      trace_artifact_refs,
      eq(trace_artifact_refs.traceEventId, traceEventId),
      [trace_artifact_refs.createdAt, trace_artifact_refs.id],
    );
  }

  private async appendRunEventInTransaction(
    db: ForgeloopDrizzleDatabase,
    event: Omit<RunEvent, 'sequence' | 'cursor'>,
  ): Promise<RunEvent> {
    const counterResult = await db.execute(sql<{ allocated_sequence: number }>`
      insert into run_event_counters (run_session_id, next_sequence)
      values (${event.run_session_id}, 2)
      on conflict (run_session_id)
      do update set next_sequence = run_event_counters.next_sequence + 1
      returning next_sequence - 1 as allocated_sequence
    `);
    const allocated = counterResult.rows[0]?.allocated_sequence;
    if (allocated === undefined) {
      throw new DomainError('INVALID_TRANSITION', `Could not allocate event sequence for run ${event.run_session_id}`);
    }

    const runEvent: RunEvent = {
      ...event,
      sequence: Number(allocated),
      cursor: eventCursor(Number(allocated)),
    };
    const [row] = await db
      .insert(run_events)
      .values(toDbRecord(runEvent, run_events) as never)
      .onConflictDoNothing()
      .returning();

    if (row === undefined) {
      const existing = await new DrizzleP0Repository(db).getById<RunEvent>(run_events, run_events.id, event.id);
      if (existing === undefined) {
        throw new DomainError('INVALID_TRANSITION', `Run event ${event.id} could not be appended`);
      }

      return existing;
    }

    return fromDbRecord<RunEvent>(row);
  }

  private async lockActiveRunWorkerLease(
    db: ForgeloopDrizzleDatabase,
    runSessionId: string,
    workerId: string,
    leaseToken: string,
    now: string,
  ): Promise<void> {
    const lockResult = await db.execute(sql<Record<string, unknown>>`
      select *
      from run_worker_leases
      where run_session_id = ${runSessionId}
        and worker_id = ${workerId}
        and lease_token = ${leaseToken}
        and status = 'active'
        and expires_at > ${now}
      for update
    `);

    if (lockResult.rows[0] === undefined) {
      throw invalidLease(runSessionId);
    }
  }

  private commandClaimFromRows(
    rows: Record<string, unknown>[],
  ): { command: RunCommand; reclaimed: boolean } | undefined {
    const row = rows[0];
    if (row === undefined) {
      return undefined;
    }

    const { reclaimed, ...commandRow } = row;
    return { command: fromDbRecord<RunCommand>(commandRow), reclaimed: reclaimed === true };
  }

  private async updateFencedRunCommand(
    commandId: string,
    lease: { workerId: string; leaseToken: string },
    now: string,
    setClause: ReturnType<typeof sql>,
  ): Promise<void> {
    const result = await this.db.transaction((tx) =>
      tx.execute(sql<Record<string, unknown>>`
        update run_commands
        set ${setClause}
        where id = ${commandId}
          and status = 'claimed'
          and claimed_by_worker_id = ${lease.workerId}
          and exists (
            select 1
            from run_worker_leases
            where run_worker_leases.run_session_id = run_commands.run_session_id
              and run_worker_leases.worker_id = ${lease.workerId}
              and run_worker_leases.lease_token = ${lease.leaseToken}
              and run_worker_leases.status = 'active'
              and run_worker_leases.expires_at > ${now}
          )
        returning *
      `),
    );

    if (result.rows.length === 0) {
      throw new DomainError('INVALID_TRANSITION', `Run command ${commandId} is not owned by worker ${lease.workerId}`);
    }
  }

  private async fencedLeaseUpdate(
    runSessionId: string,
    workerId: string,
    leaseToken: string,
    now: string,
    setClause: ReturnType<typeof sql>,
  ): Promise<Record<string, unknown>[]> {
    const result = await this.db.transaction((tx) =>
      tx.execute(sql<Record<string, unknown>>`
        update run_worker_leases
        set ${setClause}
        where run_session_id = ${runSessionId}
          and worker_id = ${workerId}
          and lease_token = ${leaseToken}
          and status = 'active'
          and expires_at > ${now}
        returning *
      `),
    );

    return result.rows;
  }

  private async upsert(table: AnyPgTable, target: AnyPgColumn, entity: object): Promise<void> {
    const record = toDbRecord(entity, table);
    await this.db.insert(table).values(record as never).onConflictDoUpdate({
      target,
      set: record as never,
    });
  }

  private async getById<T>(table: AnyPgTable, idColumn: AnyPgColumn, id: string): Promise<T | undefined> {
    const [row] = await this.db
      .select()
      .from(table)
      .where(eq(idColumn, id))
      .limit(1);

    return row === undefined ? undefined : fromDbRecord<T>(row);
  }

  private async listWhere<T>(table: AnyPgTable, where?: unknown, orderBy?: AnyPgColumn | AnyPgColumn[]): Promise<T[]> {
    const query = this.db.select().from(table);
    const filtered = where === undefined ? query : query.where(where as never);
    const rows =
      orderBy === undefined
        ? await filtered
        : await filtered.orderBy(...(Array.isArray(orderBy) ? orderBy : [orderBy]).map((column) => asc(column)));

    return rows.map((row) => fromDbRecord<T>(row));
  }
}
