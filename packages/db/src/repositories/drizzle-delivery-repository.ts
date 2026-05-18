import { and, asc, desc, eq, getTableColumns, gt, inArray, notInArray, or, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { AnyPgColumn, AnyPgTable } from 'drizzle-orm/pg-core';
import type {
  AutomationActionRun,
  AutomationProjectSettings,
  Artifact,
  Actor,
  CommandIdempotencyRecord,
  Decision,
  DomainError as DomainErrorType,
  ExecutionPackageGenerationRun,
  ExecutionPackage,
  ExecutionPackageDependency,
  ManualPathHold,
  ObjectEvent,
  Organization,
  Plan,
  PlanRevision,
  Project,
  ProjectRepo,
  Release,
  ReleaseEvidence,
  ReleaseExecutionPackage,
  ReleaseWorkItem,
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
import {
  DomainError,
  assertAutomationCapabilityActor,
  assertCanonicalManualScopeKey,
  automationCapabilitiesForPreset,
  capabilityFingerprint,
  isActiveRunSessionStatus,
  isWorkItemAutomationTerminal,
} from '@forgeloop/domain';

import * as schema from '../schema';
import {
  artifacts,
  automation_action_runs,
  automation_project_settings,
  command_idempotency_records,
  actors,
  decisions,
  execution_package_generation_packages,
  execution_package_generation_runs,
  execution_package_dependencies,
  execution_packages,
  manual_path_hold_idempotency_records,
  manual_path_holds,
  object_events,
  organizations,
  plan_revisions,
  plans,
  project_repos,
  projects,
  release_evidences,
  release_execution_packages,
  release_work_items,
  releases,
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
import type {
  ClaimAutomationActionRunInput,
  ClaimNextAutomationActionRunInput,
  ClaimCommandIdempotencyInput,
  ClaimExecutionPackageGenerationRunInput,
  CompleteAutomationActionRunInput,
  CompleteExecutionPackageGenerationRunInput,
  CreateOrReplayAutomationActionRunInput,
  DisableAutomationProjectSettingsInput,
  ExecutionPackageGenerationPackageRecord,
  FinishCommandIdempotencyInput,
  GetClaimedAutomationActionRunInput,
  LatestCompletedProjectionActionRunInput,
  ListActiveManualPathHoldsInput,
  ListClaimableAutomationActionRunsInput,
  MarkAutomationActionGatePendingInput,
  DeliveryRepository,
  RuntimeSnapshotRepositoryData,
  RuntimeSnapshotTargetRow,
  RenewCommandIdempotencyInput,
  RequestManualPathHoldInput,
  ResolveAutomationProjectSettingsInput,
  ResolveManualPathHoldInput,
  SaveExecutionPackageGenerationPackageInput,
  SetAutomationProjectSettingsInput,
  SupersedeExecutionPackageGenerationRunInput,
  TraceArtifactRefRecord,
  TraceEventRecord,
  TraceLinkRecord,
} from './delivery-repository';

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

const redactAutomationActionClaim = (actionRun: AutomationActionRun): AutomationActionRun => {
  const { claim_token: _claimToken, locked_until: _lockedUntil, ...redacted } = actionRun;
  return redacted;
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

type CanonicalJsonValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly CanonicalJsonValue[]
  | { readonly [key: string]: CanonicalJsonValue };

const canonicalizeJson = (value: CanonicalJsonValue): CanonicalJsonValue => {
  if (value === null || value === undefined || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => (item === undefined ? null : canonicalizeJson(item)));
  }

  const record = value as { readonly [key: string]: CanonicalJsonValue };
  return Object.keys(record)
    .sort()
    .reduce<Record<string, CanonicalJsonValue>>((accumulator, key) => {
      const item = record[key];
      if (item !== undefined) {
        accumulator[key] = canonicalizeJson(item);
      }
      return accumulator;
    }, {});
};

const canonicalJson = (value: unknown): string => JSON.stringify(canonicalizeJson(value as CanonicalJsonValue));

const valuesEqual = (left: unknown, right: unknown): boolean => canonicalJson(left) === canonicalJson(right);

const timestampMillis = (value: string | undefined): number | undefined => {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
};

const timestampAtOrBefore = (left: string | undefined, right: string): boolean => {
  const leftMillis = timestampMillis(left);
  const rightMillis = timestampMillis(right);
  return leftMillis !== undefined && rightMillis !== undefined ? leftMillis <= rightMillis : left !== undefined && left <= right;
};

const compareTimestamp = (left: string | undefined, right: string | undefined): number => {
  const leftMillis = timestampMillis(left);
  const rightMillis = timestampMillis(right);
  if (leftMillis !== undefined && rightMillis !== undefined) {
    return leftMillis - rightMillis;
  }
  return (left ?? '').localeCompare(right ?? '');
};

const stablePolicyObservationIdentity = (actionInputJson: Record<string, unknown>): Record<string, unknown> => ({
  repo_id: actionInputJson.repo_id,
  policy_status: actionInputJson.policy_status,
  policy_digest: actionInputJson.policy_digest,
  parser_version: actionInputJson.parser_version,
  reason_code: actionInputJson.reason_code,
});

const automationScopeParts = (automationScope: string): { projectId: string; repoId?: string } => {
  const [scopeType, projectId, repoId] = automationScope.split(':');
  return scopeType === 'repo' && repoId !== undefined ? { projectId: projectId ?? '', repoId } : { projectId: projectId ?? '' };
};

const repoAutomationScopeRepoId = (automationScope: string): string | undefined => automationScopeParts(automationScope).repoId;

const recoverableRunSessionStatuses: RunSession['status'][] = [
  'queued',
  'running',
  'waiting_for_input',
  'stalled',
  'resuming',
  'cancel_requested',
];
const terminalCommandStatuses = new Set<CommandIdempotencyRecord['status']>(['succeeded', 'skipped', 'blocked']);
const eventCursor = (sequence: number) => String(sequence).padStart(10, '0');
const invalidLease = (runSessionId: string): DomainErrorType =>
  new DomainError('INVALID_TRANSITION', `Run session ${runSessionId} does not have an active worker lease`);
const RUNTIME_SNAPSHOT_RECENT_ACTION_RUN_LIMIT = 50;
const RUNTIME_SNAPSHOT_MIN_ACTION_RUN_LOOKBACK = 100;
const RUNTIME_SNAPSHOT_MAX_ACTION_RUN_LOOKBACK = 500;

const runtimeSnapshotActionRunLookback = (targetCount: number): number =>
  Math.min(RUNTIME_SNAPSHOT_MAX_ACTION_RUN_LOOKBACK, Math.max(RUNTIME_SNAPSHOT_MIN_ACTION_RUN_LOOKBACK, targetCount * 20));

export class DrizzleDeliveryRepository implements DeliveryRepository {
  constructor(private readonly db: ForgeloopDrizzleDatabase) {}

  async withDeliveryTransaction<T>(write: (repository: DeliveryRepository) => Promise<T>): Promise<T> {
    return this.db.transaction((tx) => write(new DrizzleDeliveryRepository(tx as ForgeloopDrizzleDatabase)));
  }

  async withObjectLock<T>(key: string, write: (repository: DeliveryRepository) => Promise<T>): Promise<T> {
    return this.withAdvisoryLocks([key], write);
  }

  async saveOrganization(organization: Organization): Promise<void> {
    await this.upsert(organizations, organizations.id, organization);
  }

  async getOrganization(organizationId: string): Promise<Organization | undefined> {
    return this.getById(organizations, organizations.id, organizationId);
  }

  async saveActor(actor: Actor): Promise<void> {
    await this.upsert(actors, actors.id, actor);
  }

  async getActor(actorId: string): Promise<Actor | undefined> {
    return this.getById(actors, actors.id, actorId);
  }

  async listActorsForOrganization(organizationId: string): Promise<Actor[]> {
    return this.listWhere<Actor>(actors, eq(actors.orgId, organizationId), [actors.createdAt, actors.id]);
  }

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

  async listSpecs(projectId?: string): Promise<Spec[]> {
    const rows = await this.listWhere<Spec>(specs, undefined, specs.createdAt);
    if (projectId === undefined) {
      return rows;
    }

    const workItems = await this.listWorkItems(projectId);
    const workItemIds = new Set(workItems.map((workItem) => workItem.id));
    return rows.filter((spec) => workItemIds.has(spec.work_item_id));
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

  async listPlans(projectId?: string): Promise<Plan[]> {
    const rows = await this.listWhere<Plan>(plans, undefined, plans.createdAt);
    if (projectId === undefined) {
      return rows;
    }

    const workItems = await this.listWorkItems(projectId);
    const workItemIds = new Set(workItems.map((workItem) => workItem.id));
    return rows.filter((plan) => workItemIds.has(plan.work_item_id));
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

  async listExecutionPackages(projectId?: string): Promise<ExecutionPackage[]> {
    return projectId === undefined
      ? this.listWhere<ExecutionPackage>(execution_packages, undefined, execution_packages.createdAt)
      : this.listWhere<ExecutionPackage>(
          execution_packages,
          eq(execution_packages.projectId, projectId),
          execution_packages.createdAt,
        );
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
    if (isActiveRunSessionStatus(runSession.status) && this.supportsSelect()) {
      const existingActive = await this.findActiveRunSessionForPackage(runSession.execution_package_id);
      if (existingActive !== undefined && existingActive.id !== runSession.id) {
        throw new DomainError(
          'INVALID_TRANSITION',
          `Package ${runSession.execution_package_id} already has active run ${existingActive.id}`,
        );
      }
    }
    await this.upsert(run_sessions, run_sessions.id, runSession);
  }

  async getRunSession(runSessionId: string): Promise<RunSession | undefined> {
    return this.getById(run_sessions, run_sessions.id, runSessionId);
  }

  async listRunSessions(projectId?: string): Promise<RunSession[]> {
    const rows = await this.listWhere<RunSession>(run_sessions, undefined, run_sessions.createdAt);
    if (projectId === undefined) {
      return rows;
    }

    const executionPackages = await this.listExecutionPackages(projectId);
    const executionPackageIds = new Set(executionPackages.map((executionPackage) => executionPackage.id));
    return rows.filter((runSession) => executionPackageIds.has(runSession.execution_package_id));
  }

  async listRunSessionsForPackage(executionPackageId: string): Promise<RunSession[]> {
    return this.listWhere<RunSession>(
      run_sessions,
      eq(run_sessions.executionPackageId, executionPackageId),
      run_sessions.createdAt,
    );
  }

  async findActiveRunSessionForPackage(executionPackageId: string): Promise<RunSession | undefined> {
    const [row] = await this.db
      .select()
      .from(run_sessions)
      .where(
        and(
          eq(run_sessions.executionPackageId, executionPackageId),
          inArray(run_sessions.status, recoverableRunSessionStatuses),
        ),
      )
      .orderBy(asc(run_sessions.createdAt))
      .limit(1);

    return row === undefined ? undefined : fromDbRecord<RunSession>(row);
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
    write: (repository: DeliveryRepository) => Promise<T>,
  ): Promise<T> {
    return this.db.transaction(async (tx) => {
      await this.lockActiveRunWorkerLease(tx as ForgeloopDrizzleDatabase, runSessionId, lease.workerId, lease.leaseToken, lease.now);
      const repository = new DrizzleDeliveryRepository(tx as ForgeloopDrizzleDatabase);
      const result = await write(repository);
      await repository.assertActiveRunWorkerLease(runSessionId, lease.workerId, lease.leaseToken, lease.now);
      return result;
    });
  }

  async saveReviewPacket(reviewPacket: ReviewPacket): Promise<void> {
    if (reviewPacket.status !== 'completed' && reviewPacket.status !== 'archived' && this.supportsSelect()) {
      const existingOpen = await this.findOpenReviewPacketForPackage(reviewPacket.execution_package_id);
      if (existingOpen !== undefined && existingOpen.id !== reviewPacket.id) {
        throw new DomainError(
          'INVALID_TRANSITION',
          `Package ${reviewPacket.execution_package_id} already has open review packet ${existingOpen.id}`,
        );
      }
    }
    await this.upsert(review_packets, review_packets.id, reviewPacket);
  }

  async getReviewPacket(reviewPacketId: string): Promise<ReviewPacket | undefined> {
    return this.getById(review_packets, review_packets.id, reviewPacketId);
  }

  async listReviewPackets(projectId?: string): Promise<ReviewPacket[]> {
    const rows = await this.listWhere<ReviewPacket>(review_packets, undefined, review_packets.createdAt);
    if (projectId === undefined) {
      return rows;
    }

    const executionPackages = await this.listExecutionPackages(projectId);
    const executionPackageIds = new Set(executionPackages.map((executionPackage) => executionPackage.id));
    return rows.filter((reviewPacket) => executionPackageIds.has(reviewPacket.execution_package_id));
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

  async resolveAutomationProjectSettings(
    input: ResolveAutomationProjectSettingsInput,
  ): Promise<AutomationProjectSettings> {
    const conditions = [
      eq(automation_project_settings.projectId, input.project_id),
      input.repo_id === undefined
        ? sql`${automation_project_settings.repoId} is null`
        : eq(automation_project_settings.repoId, input.repo_id),
    ];
    const [row] = await this.db.select().from(automation_project_settings).where(and(...conditions)).limit(1);
    if (row !== undefined) {
      return fromDbRecord<AutomationProjectSettings>(row);
    }

    const capabilities = automationCapabilitiesForPreset('off');
    return {
      id: `default:${this.automationSettingsKey(input.project_id, input.repo_id)}`,
      project_id: input.project_id,
      ...(input.repo_id === undefined ? {} : { repo_id: input.repo_id }),
      preset: 'off',
      capabilities_json: capabilities,
      capability_fingerprint: capabilityFingerprint(capabilities),
      scope_type: input.repo_id === undefined ? 'project' : 'repo',
      version: 0,
      evidence_refs: [],
    };
  }

  async setAutomationProjectSettings(input: SetAutomationProjectSettingsInput): Promise<AutomationProjectSettings> {
    return this.withAdvisoryLocks(
      [`automation-settings:${this.automationSettingsKey(input.project_id, input.repo_id)}`],
      (repository) => (repository as DrizzleDeliveryRepository).setAutomationProjectSettingsUnlocked(input),
    );
  }

  async disableAutomationProjectSettings(input: DisableAutomationProjectSettingsInput): Promise<AutomationProjectSettings> {
    return this.setAutomationProjectSettings({
      id: input.id ?? `automation-settings-disabled:${this.automationSettingsKey(input.project_id, input.repo_id)}`,
      project_id: input.project_id,
      ...(input.repo_id === undefined ? {} : { repo_id: input.repo_id }),
      scope_type: input.repo_id === undefined ? 'project' : 'repo',
      preset: 'off',
      expected_version: input.expected_version,
      reason: input.reason,
      evidence_refs: input.evidence_refs,
      actor: input.actor,
      now: input.now,
    });
  }

  async listActiveManualPathHolds(input: ListActiveManualPathHoldsInput): Promise<ManualPathHold[]> {
    const keys = await this.manualHoldScopeKeysFor(input);
    if (keys.length === 0) {
      return [];
    }
    return this.listWhere<ManualPathHold>(
      manual_path_holds,
      and(eq(manual_path_holds.status, 'active'), inArray(manual_path_holds.scopeKey, keys)),
      [manual_path_holds.requestedAt, manual_path_holds.id],
    );
  }

  async getManualPathHold(holdId: string): Promise<ManualPathHold | undefined> {
    return this.getById<ManualPathHold>(manual_path_holds, manual_path_holds.id, holdId);
  }

  async requestManualPathHold(input: RequestManualPathHoldInput): Promise<ManualPathHold> {
    return this.withAdvisoryLocks(this.manualPathHoldLockKeys(input), (repository) =>
      (repository as DrizzleDeliveryRepository).requestManualPathHoldUnlocked(input),
    );
  }

  async resolveManualPathHold(input: ResolveManualPathHoldInput): Promise<ManualPathHold> {
    const hold = await this.getById<ManualPathHold>(manual_path_holds, manual_path_holds.id, input.hold_id);
    if (hold === undefined) {
      throw new DomainError('INVALID_TRANSITION', `Manual hold ${input.hold_id} does not exist`);
    }
    if (hold.status !== 'active') {
      if (hold.status === 'resolved' && hold.resolved_by === input.resolved_by && hold.resolution === input.resolution) {
        return hold;
      }
      throw new DomainError('INVALID_TRANSITION', `Manual hold ${input.hold_id} is not active`);
    }
    const resolved: ManualPathHold = {
      ...hold,
      status: 'resolved',
      resolved_by: input.resolved_by,
      resolved_at: input.resolved_at,
      resolution: input.resolution,
    };
    await this.upsert(manual_path_holds, manual_path_holds.id, resolved);
    return resolved;
  }

  async claimCommandIdempotency(input: ClaimCommandIdempotencyInput): Promise<CommandIdempotencyRecord> {
    return this.withAdvisoryLocks([`command-idempotency:${input.idempotency_key}`], (repository) =>
      (repository as DrizzleDeliveryRepository).claimCommandIdempotencyUnlocked(input),
    );
  }

  async renewCommandIdempotency(input: RenewCommandIdempotencyInput): Promise<CommandIdempotencyRecord> {
    return this.withAdvisoryLocks([`command-idempotency:${input.idempotency_key}`], (repository) =>
      (repository as DrizzleDeliveryRepository).renewCommandIdempotencyUnlocked(input),
    );
  }

  private async renewCommandIdempotencyUnlocked(input: RenewCommandIdempotencyInput): Promise<CommandIdempotencyRecord> {
    const record = await this.claimedCommandIdempotency(input.idempotency_key, input.claim_token);
    const renewed = {
      ...record,
      locked_until: input.locked_until,
      last_heartbeat_at: input.last_heartbeat_at,
      updated_at: input.last_heartbeat_at,
    };
    await this.upsert(command_idempotency_records, command_idempotency_records.id, renewed);
    return renewed;
  }

  async completeCommandIdempotency(input: FinishCommandIdempotencyInput): Promise<CommandIdempotencyRecord> {
    return this.withAdvisoryLocks([`command-idempotency:${input.idempotency_key}`], (repository) =>
      (repository as DrizzleDeliveryRepository).finishCommandIdempotency(input, 'succeeded'),
    );
  }

  async failCommandIdempotency(input: FinishCommandIdempotencyInput): Promise<CommandIdempotencyRecord> {
    return this.withAdvisoryLocks([`command-idempotency:${input.idempotency_key}`], (repository) =>
      (repository as DrizzleDeliveryRepository).finishCommandIdempotency(input, 'failed'),
    );
  }

  async blockCommandIdempotency(input: FinishCommandIdempotencyInput): Promise<CommandIdempotencyRecord> {
    return this.withAdvisoryLocks([`command-idempotency:${input.idempotency_key}`], (repository) =>
      (repository as DrizzleDeliveryRepository).finishCommandIdempotency(input, 'blocked'),
    );
  }

  async claimExecutionPackageGenerationRun(
    input: ClaimExecutionPackageGenerationRunInput,
  ): Promise<ExecutionPackageGenerationRun> {
    return this.withAdvisoryLocks([`package-generation:${input.plan_revision_id}`], (repository) =>
      (repository as DrizzleDeliveryRepository).claimExecutionPackageGenerationRunUnlocked(input),
    );
  }

  async saveExecutionPackageGenerationPackage(input: SaveExecutionPackageGenerationPackageInput): Promise<void> {
    return this.withAdvisoryLocks([`package-generation:${input.plan_revision_id}`], (repository) =>
      (repository as DrizzleDeliveryRepository).saveExecutionPackageGenerationPackageUnlocked(input),
    );
  }

  private async saveExecutionPackageGenerationPackageUnlocked(
    input: SaveExecutionPackageGenerationPackageInput,
  ): Promise<void> {
    const run = await this.claimedGenerationRun(input.execution_package_set_id, input.claim_token);
    if (run.plan_revision_id !== input.plan_revision_id || run.generation_key !== input.generation_key) {
      throw new DomainError('INVALID_TRANSITION', `Package generation ${input.execution_package_set_id} identity mismatch`);
    }
    const [duplicate] = await this.db
      .select()
      .from(execution_package_generation_packages)
      .where(
        and(
          eq(execution_package_generation_packages.planRevisionId, input.plan_revision_id),
          eq(execution_package_generation_packages.generationKey, input.generation_key),
          eq(execution_package_generation_packages.packageKey, input.package_key),
        ),
      )
      .limit(1);
    if (duplicate !== undefined && duplicate.executionPackageId !== input.execution_package_id) {
      throw new DomainError('INVALID_TRANSITION', `Duplicate package_key ${input.package_key} for generation`);
    }
    const [existing] = await this.db
      .select()
      .from(execution_package_generation_packages)
      .where(
        and(
          eq(execution_package_generation_packages.executionPackageSetId, input.execution_package_set_id),
          eq(execution_package_generation_packages.executionPackageId, input.execution_package_id),
        ),
      )
      .limit(1);
    const existingRecord =
      existing === undefined ? undefined : fromDbRecord<ExecutionPackageGenerationPackageRecord>(existing);
    if (
      existingRecord !== undefined &&
      (existingRecord.plan_revision_id !== input.plan_revision_id ||
        existingRecord.generation_key !== input.generation_key ||
        existingRecord.package_key !== input.package_key ||
        existingRecord.sequence !== input.sequence ||
        existingRecord.manifest_digest !== input.manifest_digest)
    ) {
      throw new DomainError('INVALID_TRANSITION', `Package generation package ${input.execution_package_id} drift`);
    }
    const { claim_token: _claimToken, ...record } = input;
    await this.db
      .insert(execution_package_generation_packages)
      .values(toDbRecord(record, execution_package_generation_packages) as never)
      .onConflictDoNothing();
  }

  async completeExecutionPackageGenerationRun(
    input: CompleteExecutionPackageGenerationRunInput,
  ): Promise<ExecutionPackageGenerationRun> {
    return this.withAdvisoryLocks([`package-generation:${input.plan_revision_id}`], (repository) =>
      (repository as DrizzleDeliveryRepository).completeExecutionPackageGenerationRunUnlocked(input),
    );
  }

  async supersedeExecutionPackageGenerationRun(
    input: SupersedeExecutionPackageGenerationRunInput,
  ): Promise<ExecutionPackageGenerationRun> {
    return this.withAdvisoryLocks([`package-generation:${input.plan_revision_id}`], (repository) =>
      (repository as DrizzleDeliveryRepository).supersedeExecutionPackageGenerationRunUnlocked(input),
    );
  }

  async getExecutionPackageGenerationRun(input: {
    plan_revision_id: string;
    generation_key: string;
  }): Promise<ExecutionPackageGenerationRun | undefined> {
    return this.generationRunFor(input.plan_revision_id, input.generation_key);
  }

  private async supersedeExecutionPackageGenerationRunUnlocked(
    input: SupersedeExecutionPackageGenerationRunInput,
  ): Promise<ExecutionPackageGenerationRun> {
    const run = await this.getById<ExecutionPackageGenerationRun>(
      execution_package_generation_runs,
      execution_package_generation_runs.executionPackageSetId,
      input.execution_package_set_id,
    );
    if (run === undefined || run.plan_revision_id !== input.plan_revision_id) {
      throw new DomainError('INVALID_TRANSITION', `Package generation ${input.execution_package_set_id} does not exist`);
    }
    if (run.version !== input.expected_version) {
      throw new DomainError('INVALID_TRANSITION', `Package generation ${input.execution_package_set_id} version mismatch`);
    }
    if (run.status !== 'succeeded') {
      throw new DomainError('INVALID_TRANSITION', `Package generation ${input.execution_package_set_id} is not current succeeded`);
    }
    const existingRuns = await this.listWhere<ExecutionPackageGenerationRun>(
      execution_package_generation_runs,
      eq(execution_package_generation_runs.planRevisionId, input.plan_revision_id),
    );
    const superseded: ExecutionPackageGenerationRun = {
      ...run,
      status: 'superseded',
      version: run.version + 1,
      superseded_by: input.superseded_by,
      superseded_at: input.superseded_at,
      superseded_reason: input.reason,
      supersede_command_id: input.supersede_command_id,
      evidence_refs: input.evidence_refs,
      next_generation_key: `regenerate:${input.plan_revision_id}:${existingRuns.length + 1}`,
      updated_at: input.superseded_at,
    };
    await this.upsert(execution_package_generation_runs, execution_package_generation_runs.executionPackageSetId, superseded);
    return superseded;
  }

  async createOrReplayAutomationActionRun(input: CreateOrReplayAutomationActionRunInput): Promise<AutomationActionRun> {
    return this.withAdvisoryLocks([`automation-action:${input.idempotency_key}`, `automation-action-id:${input.id}`], (repository) =>
      (repository as DrizzleDeliveryRepository).createOrReplayAutomationActionRunUnlocked(input),
    );
  }

  async claimNextAutomationActionRun(
    input: ClaimNextAutomationActionRunInput,
  ): Promise<AutomationActionRun | undefined> {
    return this.withAdvisoryLocks(['automation-action:claim-next'], (repository) =>
      (repository as DrizzleDeliveryRepository).claimNextAutomationActionRunUnlocked(input),
    );
  }

  async getClaimedAutomationActionRun(input: GetClaimedAutomationActionRunInput): Promise<AutomationActionRun> {
    return this.claimedAutomationActionRun(input.id, input.claim_token);
  }

  async latestCompletedProjectionActionRun(
    input: LatestCompletedProjectionActionRunInput,
  ): Promise<AutomationActionRun | undefined> {
    this.assertProjectionAutomationScope(input.automation_scope, input.repo_id);
    const jsonTextEquals = (key: string, value: string) => sql`${automation_action_runs.actionInputJson}->>${key} = ${value}`;
    const optionalJsonTextEquals = (key: string, value: string | undefined) =>
      value === undefined
        ? sql`coalesce(${automation_action_runs.actionInputJson}->>${key}, '') = ''`
        : jsonTextEquals(key, value);
    const [row] = await this.db
      .select()
      .from(automation_action_runs)
      .where(
        and(
          eq(automation_action_runs.actionType, 'project_runtime_snapshot'),
          eq(automation_action_runs.status, 'succeeded'),
          eq(automation_action_runs.automationScope, input.automation_scope),
          jsonTextEquals('repo_id', input.repo_id),
          jsonTextEquals('policy_status', input.policy_status),
          optionalJsonTextEquals('policy_digest', input.policy_digest),
          jsonTextEquals('parser_version', input.parser_version),
          optionalJsonTextEquals('reason_code', input.reason_code),
        ),
      )
      .orderBy(desc(automation_action_runs.finishedAt), desc(automation_action_runs.updatedAt), desc(automation_action_runs.id))
      .limit(1);
    return row === undefined ? undefined : fromDbRecord<AutomationActionRun>(row);
  }

  async claimAutomationActionRun(input: ClaimAutomationActionRunInput): Promise<AutomationActionRun> {
    return this.withAdvisoryLocks(
      ['automation-action:claim-next', `automation-action:${input.idempotency_key}`, `automation-action-id:${input.id}`],
      (repository) => (repository as DrizzleDeliveryRepository).claimAutomationActionRunUnlocked(input),
    );
  }

  async markAutomationActionGatePending(input: MarkAutomationActionGatePendingInput): Promise<AutomationActionRun> {
    return this.withAdvisoryLocks(['automation-action:claim-next', `automation-action:${input.idempotency_key}`], (repository) =>
      (repository as DrizzleDeliveryRepository).markAutomationActionGatePendingUnlocked(input),
    );
  }

  private async markAutomationActionGatePendingUnlocked(
    input: MarkAutomationActionGatePendingInput,
  ): Promise<AutomationActionRun> {
    const actionRun = await this.claimedAutomationActionRun(input.id, input.claim_token);
    if (actionRun.idempotency_key !== input.idempotency_key) {
      throw new DomainError('INVALID_TRANSITION', `Automation action ${input.id} idempotency key mismatch`);
    }
    const pending: AutomationActionRun = {
      ...actionRun,
      status: 'gate_pending',
      reason: input.reason,
      ...(input.result_json === undefined ? {} : { result_json: input.result_json }),
      ...(input.next_attempt_at === undefined ? {} : { next_attempt_at: input.next_attempt_at }),
      updated_at: input.now,
    };
    await this.upsert(automation_action_runs, automation_action_runs.id, pending);
    return pending;
  }

  async completeAutomationActionRun(input: CompleteAutomationActionRunInput): Promise<AutomationActionRun> {
    return this.withAdvisoryLocks(['automation-action:claim-next', `automation-action:${input.idempotency_key}`], (repository) =>
      (repository as DrizzleDeliveryRepository).completeAutomationActionRunUnlocked(input),
    );
  }

  private async completeAutomationActionRunUnlocked(input: CompleteAutomationActionRunInput): Promise<AutomationActionRun> {
    const actionRun = await this.claimedAutomationActionRun(input.id, input.claim_token);
    if (actionRun.idempotency_key !== input.idempotency_key) {
      throw new DomainError('INVALID_TRANSITION', `Automation action ${input.id} idempotency key mismatch`);
    }
    const completed: AutomationActionRun = {
      ...actionRun,
      status: input.status,
      ...(input.result_json === undefined ? {} : { result_json: input.result_json }),
      ...(input.retryable === undefined ? {} : { retryable: input.retryable }),
      ...(input.next_attempt_at === undefined ? {} : { next_attempt_at: input.next_attempt_at }),
      finished_at: input.finished_at,
      updated_at: input.finished_at,
    };
    await this.upsert(automation_action_runs, automation_action_runs.id, completed);
    return completed;
  }

  async listClaimableAutomationActionRuns(input: ListClaimableAutomationActionRunsInput): Promise<AutomationActionRun[]> {
    const rows = await this.db
      .select()
      .from(automation_action_runs)
      .where(
        or(
          eq(automation_action_runs.status, 'pending'),
          and(
            eq(automation_action_runs.status, 'gate_pending'),
            or(sql`${automation_action_runs.nextAttemptAt} is null`, sql`${automation_action_runs.nextAttemptAt} <= ${input.now}`),
          ),
          and(
            or(eq(automation_action_runs.status, 'blocked'), eq(automation_action_runs.status, 'failed')),
            eq(automation_action_runs.retryable, true),
            or(sql`${automation_action_runs.nextAttemptAt} is null`, sql`${automation_action_runs.nextAttemptAt} <= ${input.now}`),
          ),
          and(eq(automation_action_runs.status, 'running'), sql`${automation_action_runs.lockedUntil} <= ${input.now}`),
        ),
      )
      .orderBy(
        sql`coalesce(${automation_action_runs.nextAttemptAt}, ${automation_action_runs.createdAt})`,
        asc(automation_action_runs.createdAt),
        asc(automation_action_runs.id),
      )
      .limit(input.limit);
    return rows.map((row) => redactAutomationActionClaim(fromDbRecord<AutomationActionRun>(row)));
  }

  async getRuntimeSnapshotData(): Promise<RuntimeSnapshotRepositoryData> {
    const [
      projectRecords,
      repoRecords,
      workItemRecords,
      specRecords,
      planRecords,
      planRevisionRecords,
      generationRunRecords,
      executionPackageRecords,
      holdRecords,
      settingsRecords,
      recentActionRunRecords,
    ] = await Promise.all([
        this.db.select().from(projects).orderBy(asc(projects.createdAt), asc(projects.id)),
        this.db
          .select()
          .from(project_repos)
          .where(eq(project_repos.status, 'active'))
          .orderBy(asc(project_repos.createdAt), asc(project_repos.id)),
        this.db.select().from(work_items).orderBy(asc(work_items.createdAt), asc(work_items.id)),
        this.db.select().from(specs),
        this.db.select().from(plans).orderBy(asc(plans.createdAt), asc(plans.id)),
        this.db.select().from(plan_revisions),
        this.db.select().from(execution_package_generation_runs),
        this.db.select().from(execution_packages).orderBy(asc(execution_packages.createdAt), asc(execution_packages.id)),
        this.db
          .select()
          .from(manual_path_holds)
          .where(eq(manual_path_holds.status, 'active'))
          .orderBy(asc(manual_path_holds.requestedAt), asc(manual_path_holds.id)),
        this.db.select().from(automation_project_settings),
        this.db
          .select()
          .from(automation_action_runs)
          .orderBy(
            desc(automation_action_runs.finishedAt),
            desc(automation_action_runs.updatedAt),
            desc(automation_action_runs.createdAt),
            desc(automation_action_runs.id),
          )
          .limit(RUNTIME_SNAPSHOT_RECENT_ACTION_RUN_LIMIT),
      ]);
    const projectRows = projectRecords.map((row) => fromDbRecord<Project>(row));
    const repoRows = repoRecords.map((row) => fromDbRecord<ProjectRepo>(row));
    const workItemRows = workItemRecords.map((row) => fromDbRecord<WorkItem>(row));
    const settingsByScope = new Map(
      settingsRecords.map((row) => {
        const settings = fromDbRecord<AutomationProjectSettings>(row);
        return [this.automationSettingsKey(settings.project_id, settings.repo_id), settings] as const;
      }),
    );
    const projectSnapshotRows = projectRows.map((project) => {
      const settings = this.resolvePreloadedAutomationProjectSettings(settingsByScope, { project_id: project.id });
      return {
        project_id: project.id,
        automation_scope: `project:${project.id}` as const,
        automation_settings_version: settings.version,
        capability_fingerprint: settings.capability_fingerprint,
      };
    });
    const repoSnapshotRows = repoRows.map((repo) => {
      const settings = this.resolvePreloadedAutomationProjectSettings(settingsByScope, {
        project_id: repo.project_id,
        repo_id: repo.repo_id,
      });
      return {
        project_id: repo.project_id,
        repo_id: repo.repo_id,
        automation_scope: `repo:${repo.project_id}:${repo.repo_id}` as const,
        automation_settings_version: settings.version,
        capability_fingerprint: settings.capability_fingerprint,
        daemon_internal_local_path: repo.local_path,
      };
    });
    const holds = holdRecords.map((row) => fromDbRecord<ManualPathHold>(row));
    const specsById = new Map(
      specRecords.map((row) => {
        const record = fromDbRecord<Spec>(row);
        return [record.id, record] as const;
      }),
    );
    const planRevisionsById = new Map(
      planRevisionRecords.map((row) => {
        const record = fromDbRecord<PlanRevision>(row);
        return [record.id, record] as const;
      }),
    );
    const workItemsById = new Map(workItemRows.map((record) => [record.id, record] as const));
    const generationRuns = generationRunRecords.map((row) => fromDbRecord<ExecutionPackageGenerationRun>(row));
    const workItemsRequiringPlan = await this.runtimeSnapshotWorkItemsRequiringPlan(
      workItemRows,
      repoRows,
      specsById,
      holds,
      settingsByScope,
    );
    const planRevisionsRequiringPackages = await this.runtimeSnapshotPlanRevisionsRequiringPackages(
      planRecords.map((row) => fromDbRecord<Plan>(row)),
      repoRows,
      planRevisionsById,
      workItemsById,
      generationRuns,
      holds,
      settingsByScope,
    );
    const latestMatchingTargets = [...workItemsRequiringPlan, ...planRevisionsRequiringPackages];
    const latestMatchingActionRuns =
      latestMatchingTargets.length === 0
        ? []
        : (
            await this.db
              .select()
              .from(automation_action_runs)
              .where(
                and(
                  inArray(automation_action_runs.actionType, ['ensure_plan_draft', 'ensure_package_drafts']),
                  inArray(
                    automation_action_runs.targetObjectId,
                    [...new Set(latestMatchingTargets.map((target) => target.target_object_id))],
                  ),
                  inArray(
                    automation_action_runs.targetRevisionId,
                    [...new Set(latestMatchingTargets.flatMap((target) => (target.target_revision_id === undefined ? [] : [target.target_revision_id])))],
                  ),
                ),
              )
              .orderBy(
                desc(automation_action_runs.finishedAt),
                desc(automation_action_runs.updatedAt),
                desc(automation_action_runs.createdAt),
                desc(automation_action_runs.id),
              )
              .limit(runtimeSnapshotActionRunLookback(latestMatchingTargets.length))
          ).map((row) => redactAutomationActionClaim(fromDbRecord<AutomationActionRun>(row)));
    const latestMatchingActionFields = this.latestMatchingActionFieldsByTarget(latestMatchingActionRuns);
    const policyProjectionActionRuns = (
      await this.db
        .select()
        .from(automation_action_runs)
        .where(and(eq(automation_action_runs.actionType, 'project_runtime_snapshot'), eq(automation_action_runs.status, 'succeeded')))
        .orderBy(desc(automation_action_runs.finishedAt), desc(automation_action_runs.updatedAt), desc(automation_action_runs.id))
        .limit(runtimeSnapshotActionRunLookback(repoRows.length))
    ).map((row) => redactAutomationActionClaim(fromDbRecord<AutomationActionRun>(row)));

    return {
      projects: projectSnapshotRows,
      repos: repoSnapshotRows,
      work_items_requiring_plan: this.applyLatestMatchingActionFields(workItemsRequiringPlan, latestMatchingActionFields),
      plan_revisions_requiring_packages: this.applyLatestMatchingActionFields(
        planRevisionsRequiringPackages,
        latestMatchingActionFields,
      ),
      run_enqueue_disabled_packages: this.runtimeSnapshotRunEnqueueDisabledPackages(
        executionPackageRecords.map((row) => fromDbRecord<ExecutionPackage>(row)),
        repoRows,
      ),
      active_holds: this.runtimeSnapshotActiveHolds(holds),
      recent_action_runs: recentActionRunRecords.map((row) => redactAutomationActionClaim(fromDbRecord<AutomationActionRun>(row))),
      policy_projection_action_runs: policyProjectionActionRuns,
    };
  }

  async saveRelease(release: Release): Promise<void> {
    const normalized: Release = {
      ...release,
      key: release.key ?? release.id,
      release_owner_actor_id: release.release_owner_actor_id ?? release.created_by_actor_id,
      release_type: release.release_type ?? 'normal',
      visibility: release.visibility ?? 'internal',
      labels: release.labels ?? [],
      updated_by_actor_id: release.updated_by_actor_id ?? release.created_by_actor_id,
    };
    await this.db.transaction(async (tx) => {
      // Reuse the repository methods inside one transaction so the release row and link tables stay aligned.
      const repository = new DrizzleDeliveryRepository(tx as ForgeloopDrizzleDatabase);
      await repository.saveReleaseRecord(normalized);
      await repository.replaceReleaseWorkItems(normalized.id, normalized.work_item_ids);
      await repository.replaceReleaseExecutionPackages(normalized.id, normalized.execution_package_ids);
    });
  }

  async getRelease(releaseId: string): Promise<Release | undefined> {
    const release = await this.getById<Release>(releases, releases.id, releaseId);
    return release === undefined ? undefined : this.hydrateReleaseLinks(release);
  }

  async listReleases(projectId?: string): Promise<Release[]> {
    const releaseRows = await this.listWhere<Release>(
      releases,
      projectId === undefined ? undefined : eq(releases.projectId, projectId),
      releases.createdAt,
    );
    return Promise.all(releaseRows.map((release) => this.hydrateReleaseLinks(release)));
  }

  async saveReleaseWorkItem(releaseWorkItem: ReleaseWorkItem): Promise<void> {
    const linkOrder =
      (await this.getReleaseWorkItemLinkOrder(releaseWorkItem.release_id, releaseWorkItem.work_item_id)) ??
      (await this.nextReleaseWorkItemOrder(releaseWorkItem.release_id));
    await this.saveReleaseWorkItemLink(releaseWorkItem.release_id, releaseWorkItem.work_item_id, linkOrder);
  }

  async listReleaseWorkItems(releaseId: string): Promise<ReleaseWorkItem[]> {
    const rows = await this.db
      .select()
      .from(release_work_items)
      .where(eq(release_work_items.releaseId, releaseId))
      .orderBy(asc(release_work_items.linkOrder), asc(release_work_items.workItemId));

    return rows.map((row) => ({
      release_id: row.releaseId,
      work_item_id: row.workItemId,
    }));
  }

  async saveReleaseExecutionPackage(releaseExecutionPackage: ReleaseExecutionPackage): Promise<void> {
    const linkOrder =
      (await this.getReleaseExecutionPackageLinkOrder(
        releaseExecutionPackage.release_id,
        releaseExecutionPackage.execution_package_id,
      )) ?? (await this.nextReleaseExecutionPackageOrder(releaseExecutionPackage.release_id));
    await this.saveReleaseExecutionPackageLink(
      releaseExecutionPackage.release_id,
      releaseExecutionPackage.execution_package_id,
      linkOrder,
    );
  }

  async listReleaseExecutionPackages(releaseId: string): Promise<ReleaseExecutionPackage[]> {
    const rows = await this.db
      .select()
      .from(release_execution_packages)
      .where(eq(release_execution_packages.releaseId, releaseId))
      .orderBy(asc(release_execution_packages.linkOrder), asc(release_execution_packages.packageId));

    return rows.map((row) => ({
      release_id: row.releaseId,
      execution_package_id: row.packageId,
    }));
  }

  async saveReleaseEvidence(releaseEvidence: ReleaseEvidence): Promise<void> {
    const release = await this.getRelease(releaseEvidence.release_id);
    const orgId = releaseEvidence.org_id ?? release?.org_id;
    const projectId = releaseEvidence.project_id ?? release?.project_id;
    const createdByActorId = releaseEvidence.created_by_actor_id ?? release?.created_by_actor_id;
    const updatedByActorId = releaseEvidence.updated_by_actor_id ?? release?.updated_by_actor_id ?? createdByActorId;
    if (orgId === undefined || projectId === undefined || createdByActorId === undefined || updatedByActorId === undefined) {
      throw new DomainError(
        'INVALID_TRANSITION',
        `Release evidence ${releaseEvidence.id} requires release, organization, project, and actor audit anchors`,
      );
    }

    const normalized: ReleaseEvidence = {
      ...releaseEvidence,
      org_id: orgId,
      project_id: projectId,
      key: releaseEvidence.key ?? releaseEvidence.id,
      visibility: releaseEvidence.visibility ?? 'internal',
      labels: releaseEvidence.labels ?? [],
      created_by_actor_id: createdByActorId,
      updated_at: releaseEvidence.updated_at ?? releaseEvidence.created_at,
      updated_by_actor_id: updatedByActorId,
    };
    await this.upsert(release_evidences, release_evidences.id, normalized);
  }

  async getReleaseEvidence(releaseEvidenceId: string): Promise<ReleaseEvidence | undefined> {
    return this.getById(release_evidences, release_evidences.id, releaseEvidenceId);
  }

  async listReleaseEvidences(releaseId: string): Promise<ReleaseEvidence[]> {
    return this.listWhere<ReleaseEvidence>(release_evidences, eq(release_evidences.releaseId, releaseId), [
      release_evidences.createdAt,
      release_evidences.id,
    ]);
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
      const existing = await new DrizzleDeliveryRepository(db).getById<RunEvent>(run_events, run_events.id, event.id);
      if (existing === undefined) {
        throw new DomainError('INVALID_TRANSITION', `Run event ${event.id} could not be appended`);
      }

      return existing;
    }

    return fromDbRecord<RunEvent>(row);
  }

  private async withAdvisoryLocks<T>(keys: readonly string[], write: (repository: DeliveryRepository) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => {
      for (const key of [...new Set(keys)].sort()) {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${key}))`);
      }
      return write(new DrizzleDeliveryRepository(tx as ForgeloopDrizzleDatabase));
    });
  }

  private async setAutomationProjectSettingsUnlocked(
    input: SetAutomationProjectSettingsInput,
  ): Promise<AutomationProjectSettings> {
    assertAutomationCapabilityActor(input.actor);
    const current = await this.resolveAutomationProjectSettings(input);
    if (current.version !== input.expected_version) {
      throw new DomainError('INVALID_TRANSITION', `Automation settings version mismatch for ${input.project_id}`);
    }
    const capabilities = automationCapabilitiesForPreset(input.preset);
    const settings: AutomationProjectSettings = {
      id: current.id.startsWith('default:') ? input.id : current.id,
      project_id: input.project_id,
      ...(input.repo_id === undefined ? {} : { repo_id: input.repo_id }),
      preset: input.preset,
      capabilities_json: capabilities,
      capability_fingerprint: capabilityFingerprint(capabilities),
      scope_type: input.scope_type,
      version: current.version + 1,
      enabled_by: input.actor.actor_id,
      enabled_at: input.now,
      updated_by: input.actor.actor_id,
      updated_at: input.now,
      reason: input.reason,
      evidence_refs: input.evidence_refs,
    };
    await this.upsert(automation_project_settings, automation_project_settings.id, settings);
    return settings;
  }

  private async requestManualPathHoldUnlocked(input: RequestManualPathHoldInput): Promise<ManualPathHold> {
    const [existingReplay] = await this.db
      .select()
      .from(manual_path_hold_idempotency_records)
      .where(eq(manual_path_hold_idempotency_records.idempotencyKey, input.idempotency_key))
      .limit(1);
    if (existingReplay !== undefined) {
      const replayed = await this.getById<ManualPathHold>(manual_path_holds, manual_path_holds.id, existingReplay.holdId);
      if (replayed !== undefined) {
        return replayed;
      }
    }
    if (input.source_automation_action_id !== undefined) {
      const replayed = await this.manualPathHoldBySourceAction(input.source_automation_action_id);
      if (replayed !== undefined) {
        await this.db
          .insert(manual_path_hold_idempotency_records)
          .values({ idempotencyKey: input.idempotency_key, holdId: replayed.id })
          .onConflictDoUpdate({
            target: manual_path_hold_idempotency_records.idempotencyKey,
            set: { holdId: replayed.id },
          });
        return replayed;
      }
    }

    this.assertManualScopeKey(input);
    const [existingActive] = await this.db
      .select()
      .from(manual_path_holds)
      .where(
        and(
          eq(manual_path_holds.objectType, input.object_type),
          eq(manual_path_holds.objectId, input.object_id),
          eq(manual_path_holds.scopeKey, input.scope_key),
          eq(manual_path_holds.status, 'active'),
        ),
      )
      .limit(1);
    if (existingActive !== undefined) {
      throw new DomainError('INVALID_TRANSITION', `Active manual hold already exists for ${input.scope_key}`);
    }

    const hold: ManualPathHold = {
      id: input.id,
      object_type: input.object_type,
      object_id: input.object_id,
      scope_key: input.scope_key,
      status: 'active',
      reason_code: input.reason_code,
      reason: input.reason,
      ...(input.source_automation_action_id === undefined
        ? {}
        : { source_automation_action_id: input.source_automation_action_id }),
      evidence_refs: input.evidence_refs,
      requested_by: input.requested_by,
      requested_at: input.requested_at,
      ...(input.metadata_json === undefined ? {} : { metadata_json: input.metadata_json }),
    };
    await this.upsert(manual_path_holds, manual_path_holds.id, hold);
    await this.db
      .insert(manual_path_hold_idempotency_records)
      .values({ idempotencyKey: input.idempotency_key, holdId: hold.id })
      .onConflictDoUpdate({
        target: manual_path_hold_idempotency_records.idempotencyKey,
        set: { holdId: hold.id },
      });
    return hold;
  }

  private async claimCommandIdempotencyUnlocked(
    input: ClaimCommandIdempotencyInput,
  ): Promise<CommandIdempotencyRecord> {
    const existing = await this.commandIdempotencyByKey(input.idempotency_key);
    if (existing !== undefined) {
      this.assertCommandIdempotencyMatches(existing, input);
      if (terminalCommandStatuses.has(existing.status)) {
        return existing;
      }
      if (existing.status === 'running' && existing.locked_until !== undefined && existing.locked_until > input.now) {
        throw new DomainError('INVALID_TRANSITION', `Command ${input.idempotency_key} already has an active claim`);
      }
    }
    const record: CommandIdempotencyRecord = {
      id: existing?.id ?? input.id,
      command_name: input.command_name,
      idempotency_key: input.idempotency_key,
      target_object_type: input.target_object_type,
      target_object_id: input.target_object_id,
      ...(input.target_revision_id === undefined ? {} : { target_revision_id: input.target_revision_id }),
      ...(input.target_version === undefined ? {} : { target_version: input.target_version }),
      ...(input.precondition_json === undefined ? {} : { precondition_json: input.precondition_json }),
      ...(input.precondition_fingerprint === undefined
        ? {}
        : { precondition_fingerprint: input.precondition_fingerprint }),
      ...(input.actor_scope === undefined ? {} : { actor_scope: input.actor_scope, created_by: input.actor_scope }),
      status: 'running',
      locked_until: input.locked_until,
      last_heartbeat_at: input.now,
      claim_token: input.claim_token,
      started_at: input.now,
      created_at: existing?.created_at ?? input.now,
      updated_at: input.now,
    };
    const dbRecord = toDbRecord(record, command_idempotency_records);
    await this.db
      .insert(command_idempotency_records)
      .values(dbRecord as never)
      .onConflictDoUpdate({
        target: command_idempotency_records.idempotencyKey,
        set: dbRecord as never,
      });
    return record;
  }

  private async claimExecutionPackageGenerationRunUnlocked(
    input: ClaimExecutionPackageGenerationRunInput,
  ): Promise<ExecutionPackageGenerationRun> {
    const existing = await this.generationRunFor(input.plan_revision_id, input.generation_key);
    if (existing !== undefined) {
      if (
        existing.manifest_digest !== input.manifest_digest ||
        existing.policy_digest !== input.policy_digest ||
        existing.generator_version !== input.generator_version ||
        existing.expected_package_count !== input.expected_package_count ||
        JSON.stringify(existing.expected_package_keys ?? []) !== JSON.stringify(input.expected_package_keys ?? [])
      ) {
        throw new DomainError('INVALID_TRANSITION', `Package generation manifest drift for ${input.generation_key}`);
      }
      if (existing.status === 'running' && existing.locked_until !== undefined && existing.locked_until <= input.now) {
        const reclaimed: ExecutionPackageGenerationRun = {
          ...existing,
          claim_token: input.claim_token,
          locked_until: input.locked_until,
          last_heartbeat_at: input.now,
          updated_at: input.now,
        };
        await this.upsert(execution_package_generation_runs, execution_package_generation_runs.executionPackageSetId, reclaimed);
        return reclaimed;
      }
      if (existing.status === 'running') {
        throw new DomainError('INVALID_TRANSITION', `Package generation ${input.generation_key} already has an active claim`);
      }
      return existing;
    }
    const [currentSucceeded] = await this.db
      .select()
      .from(execution_package_generation_runs)
      .where(
        and(
          eq(execution_package_generation_runs.planRevisionId, input.plan_revision_id),
          eq(execution_package_generation_runs.status, 'succeeded'),
        ),
      )
      .limit(1);
    if (currentSucceeded !== undefined) {
      throw new DomainError('INVALID_TRANSITION', `Plan revision ${input.plan_revision_id} already has current generation`);
    }
    const run: ExecutionPackageGenerationRun = {
      execution_package_set_id: `generation:${input.plan_revision_id}:${input.generation_key}`,
      plan_revision_id: input.plan_revision_id,
      generation_key: input.generation_key,
      version: 0,
      ...(input.generator_version === undefined ? {} : { generator_version: input.generator_version }),
      ...(input.policy_digest === undefined ? {} : { policy_digest: input.policy_digest }),
      ...(input.manifest_digest === undefined ? {} : { manifest_digest: input.manifest_digest }),
      ...(input.expected_package_count === undefined ? {} : { expected_package_count: input.expected_package_count }),
      ...(input.expected_package_keys === undefined ? {} : { expected_package_keys: [...input.expected_package_keys] }),
      status: 'running',
      locked_until: input.locked_until,
      last_heartbeat_at: input.now,
      claim_token: input.claim_token,
      created_at: input.now,
      updated_at: input.now,
    };
    await this.upsert(execution_package_generation_runs, execution_package_generation_runs.executionPackageSetId, run);
    return run;
  }

  private async completeExecutionPackageGenerationRunUnlocked(
    input: CompleteExecutionPackageGenerationRunInput,
  ): Promise<ExecutionPackageGenerationRun> {
    const run = await this.claimedGenerationRun(input.execution_package_set_id, input.claim_token);
    if (run.plan_revision_id !== input.plan_revision_id) {
      throw new DomainError('INVALID_TRANSITION', `Package generation ${input.execution_package_set_id} plan mismatch`);
    }
    await this.assertGenerationPackageManifestComplete(run);
    const completed: ExecutionPackageGenerationRun = {
      ...run,
      status: 'succeeded',
      version: run.version + 1,
      ...(input.result_json === undefined ? {} : { result_json: input.result_json }),
      completed_at: input.completed_at,
      updated_at: input.completed_at,
    };
    await this.upsert(execution_package_generation_runs, execution_package_generation_runs.executionPackageSetId, completed);
    return completed;
  }

  private async createOrReplayAutomationActionRunUnlocked(
    input: CreateOrReplayAutomationActionRunInput,
  ): Promise<AutomationActionRun> {
    if (input.action_type === 'project_runtime_snapshot') {
      this.assertProjectionAutomationScope(input.automation_scope, input.action_input_json.repo_id);
    }
    const existing = await this.automationActionRunByIdempotencyKey(input.idempotency_key);
    if (existing !== undefined) {
      this.assertAutomationActionReplayMatches(existing, input);
      return redactAutomationActionClaim(existing);
    }
    await this.assertAutomationActionIdIsUnused(input.id, input.idempotency_key);

    const actionRun: AutomationActionRun = {
      id: input.id,
      action_type: input.action_type,
      target_object_type: input.target_object_type,
      target_object_id: input.target_object_id,
      ...(input.target_revision_id === undefined ? {} : { target_revision_id: input.target_revision_id }),
      ...(input.target_version === undefined ? {} : { target_version: input.target_version }),
      target_status: input.target_status,
      idempotency_key: input.idempotency_key,
      automation_scope: input.automation_scope,
      automation_settings_version: input.automation_settings_version,
      capability_fingerprint: input.capability_fingerprint,
      precondition_fingerprint: input.precondition_fingerprint,
      action_input_json: input.action_input_json,
      status: 'pending',
      attempt: 0,
      ...(input.created_by === undefined ? {} : { created_by: input.created_by }),
      created_at: input.now,
      updated_at: input.now,
    };
    await this.upsert(automation_action_runs, automation_action_runs.id, actionRun);
    return actionRun;
  }

  private async claimNextAutomationActionRunUnlocked(
    input: ClaimNextAutomationActionRunInput,
  ): Promise<AutomationActionRun | undefined> {
    const filterPredicate = this.automationActionClaimFilterPredicate(input);
    const claimablePredicate = this.claimableAutomationActionPredicate(input.now);
    const wherePredicate = filterPredicate === undefined ? claimablePredicate : and(claimablePredicate, filterPredicate);
    const rows = await this.db
      .select()
      .from(automation_action_runs)
      .where(wherePredicate)
      .orderBy(
        sql`coalesce(${automation_action_runs.nextAttemptAt}, ${automation_action_runs.createdAt})`,
        asc(automation_action_runs.createdAt),
        asc(automation_action_runs.id),
      )
      .limit(input.limit);

    for (const row of rows) {
      const actionRun = fromDbRecord<AutomationActionRun>(row);
      if (!this.matchesAutomationActionClaimFilter(actionRun, input)) {
        continue;
      }
      const claimed = this.toRunningAutomationActionRun(actionRun, {
        claim_token: input.claim_token,
        locked_until: input.locked_until,
        now: input.now,
      });
      const [updated] = await this.db
        .update(automation_action_runs)
        .set(toDbRecord(claimed, automation_action_runs) as never)
        .where(and(eq(automation_action_runs.id, actionRun.id), this.claimableAutomationActionPredicate(input.now)))
        .returning();
      if (updated !== undefined) {
        return fromDbRecord<AutomationActionRun>(updated);
      }
    }

    return undefined;
  }

  private async claimAutomationActionRunUnlocked(input: ClaimAutomationActionRunInput): Promise<AutomationActionRun> {
    if (input.precondition_fingerprint === undefined || input.action_input_json === undefined) {
      throw new DomainError(
        'INVALID_TRANSITION',
        `Automation action ${input.idempotency_key} requires precondition fingerprint and action input`,
      );
    }
    const existing = await this.automationActionRunByIdempotencyKey(input.idempotency_key);
    if (existing !== undefined) {
      this.assertAutomationActionIdentityMatches(existing, input);
      if (!this.isAutomationActionClaimable(existing, input.now)) {
        if (existing.status === 'running') {
          throw new DomainError('INVALID_TRANSITION', `Automation action ${input.idempotency_key} already has an active claim`);
        }
        return redactAutomationActionClaim(existing);
      }
    } else {
      await this.assertAutomationActionIdIsUnused(input.id, input.idempotency_key);
    }
    const actionRun: AutomationActionRun = {
      id: existing?.id ?? input.id,
      action_type: input.action_type,
      target_object_type: input.target_object_type,
      target_object_id: input.target_object_id,
      ...(input.target_revision_id === undefined ? {} : { target_revision_id: input.target_revision_id }),
      ...(input.target_version === undefined ? {} : { target_version: input.target_version }),
      target_status: input.target_status,
      idempotency_key: input.idempotency_key,
      automation_scope: input.automation_scope,
      automation_settings_version: input.automation_settings_version,
      capability_fingerprint: input.capability_fingerprint,
      precondition_fingerprint: input.precondition_fingerprint,
      action_input_json: input.action_input_json,
      status: 'running',
      claim_token: input.claim_token,
      attempt: (existing?.attempt ?? 0) + 1,
      locked_until: input.locked_until,
      ...(existing?.created_by === undefined ? {} : { created_by: existing.created_by }),
      claimed_at: input.now,
      started_at: existing?.started_at ?? input.now,
      created_at: existing?.created_at ?? input.now,
      updated_at: input.now,
    };
    await this.upsert(automation_action_runs, automation_action_runs.id, actionRun);
    return actionRun;
  }

  private async assertAutomationActionIdIsUnused(id: string, idempotencyKey: string): Promise<void> {
    const existing = await this.getById<AutomationActionRun>(automation_action_runs, automation_action_runs.id, id);
    if (existing !== undefined && existing.idempotency_key !== idempotencyKey) {
      throw new DomainError(
        'INVALID_TRANSITION',
        `Automation action ${id} already exists with a different idempotency key`,
      );
    }
  }

  private toRunningAutomationActionRun(
    actionRun: AutomationActionRun,
    input: { claim_token: string; locked_until: string; now: string },
  ): AutomationActionRun {
    return {
      id: actionRun.id,
      action_type: actionRun.action_type,
      target_object_type: actionRun.target_object_type,
      target_object_id: actionRun.target_object_id,
      ...(actionRun.target_revision_id === undefined ? {} : { target_revision_id: actionRun.target_revision_id }),
      ...(actionRun.target_version === undefined ? {} : { target_version: actionRun.target_version }),
      target_status: actionRun.target_status,
      idempotency_key: actionRun.idempotency_key,
      automation_scope: actionRun.automation_scope,
      automation_settings_version: actionRun.automation_settings_version,
      capability_fingerprint: actionRun.capability_fingerprint,
      precondition_fingerprint: actionRun.precondition_fingerprint,
      action_input_json: actionRun.action_input_json,
      status: 'running',
      claim_token: input.claim_token,
      attempt: actionRun.attempt + 1,
      locked_until: input.locked_until,
      ...(actionRun.created_by === undefined ? {} : { created_by: actionRun.created_by }),
      claimed_at: input.now,
      started_at: actionRun.started_at ?? input.now,
      ...(actionRun.created_at === undefined ? {} : { created_at: actionRun.created_at }),
      updated_at: input.now,
    };
  }

  private assertCommandIdempotencyMatches(
    existing: CommandIdempotencyRecord,
    input: ClaimCommandIdempotencyInput,
  ): void {
    const mismatched =
      existing.command_name !== input.command_name ||
      existing.target_object_type !== input.target_object_type ||
      existing.target_object_id !== input.target_object_id ||
      existing.target_revision_id !== input.target_revision_id ||
      existing.target_version !== input.target_version ||
      existing.precondition_fingerprint !== input.precondition_fingerprint ||
      existing.actor_scope !== input.actor_scope;
    if (mismatched) {
      throw new DomainError(
        'INVALID_TRANSITION',
        `Command ${input.idempotency_key} idempotency identity or precondition fingerprint changed`,
      );
    }
  }

  private assertAutomationActionIdentityMatches(existing: AutomationActionRun, input: ClaimAutomationActionRunInput): void {
    const mismatched =
      existing.action_type !== input.action_type ||
      existing.target_object_type !== input.target_object_type ||
      existing.target_object_id !== input.target_object_id ||
      existing.target_revision_id !== input.target_revision_id ||
      existing.target_version !== input.target_version ||
      existing.target_status !== input.target_status ||
      existing.automation_scope !== input.automation_scope ||
      existing.automation_settings_version !== input.automation_settings_version ||
      existing.capability_fingerprint !== input.capability_fingerprint ||
      existing.precondition_fingerprint !== input.precondition_fingerprint ||
      !valuesEqual(existing.action_input_json, input.action_input_json);
    if (mismatched) {
      throw new DomainError('INVALID_TRANSITION', `Automation action ${input.idempotency_key} identity changed`);
    }
  }

  private assertAutomationActionReplayMatches(
    existing: AutomationActionRun,
    input: CreateOrReplayAutomationActionRunInput,
  ): void {
    if (existing.action_type === 'project_runtime_snapshot' || input.action_type === 'project_runtime_snapshot') {
      if (existing.action_type === 'project_runtime_snapshot') {
        this.assertProjectionAutomationScope(existing.automation_scope, existing.action_input_json.repo_id);
      }
      if (input.action_type === 'project_runtime_snapshot') {
        this.assertProjectionAutomationScope(input.automation_scope, input.action_input_json.repo_id);
      }
      const mismatched =
        existing.action_type !== input.action_type ||
        existing.automation_scope !== input.automation_scope ||
        !valuesEqual(
          stablePolicyObservationIdentity(existing.action_input_json),
          stablePolicyObservationIdentity(input.action_input_json),
        );
      if (mismatched) {
        throw new DomainError(
          'INVALID_TRANSITION',
          `Automation action ${input.idempotency_key} project_runtime_snapshot identity changed`,
        );
      }
      return;
    }

    const mismatched =
      existing.action_type !== input.action_type ||
      existing.target_object_type !== input.target_object_type ||
      existing.target_object_id !== input.target_object_id ||
      existing.target_revision_id !== input.target_revision_id ||
      existing.target_version !== input.target_version ||
      existing.target_status !== input.target_status ||
      existing.automation_scope !== input.automation_scope ||
      existing.automation_settings_version !== input.automation_settings_version ||
      existing.capability_fingerprint !== input.capability_fingerprint ||
      existing.precondition_fingerprint !== input.precondition_fingerprint ||
      !valuesEqual(existing.action_input_json, input.action_input_json);
    if (mismatched) {
      throw new DomainError(
        'INVALID_TRANSITION',
        `Automation action ${input.idempotency_key} idempotency identity, precondition, or action input changed`,
      );
    }
  }

  private stablePolicyObservationIdentityMatches(
    actionInputJson: Record<string, unknown>,
    input: LatestCompletedProjectionActionRunInput,
  ): boolean {
    this.assertProjectionAutomationScope(input.automation_scope, input.repo_id);
    const stableIdentity = stablePolicyObservationIdentity(actionInputJson);
    return (
      stableIdentity.repo_id === input.repo_id &&
      stableIdentity.policy_status === input.policy_status &&
      stableIdentity.policy_digest === input.policy_digest &&
      stableIdentity.parser_version === input.parser_version &&
      stableIdentity.reason_code === input.reason_code
    );
  }

  private assertProjectionAutomationScope(automationScope: string, repoId: unknown): void {
    const scopeRepoId = repoAutomationScopeRepoId(automationScope);
    if (scopeRepoId === undefined || repoId !== scopeRepoId) {
      throw new DomainError('INVALID_TRANSITION', `Projection action requires matching repo automation scope`);
    }
  }

  private matchesAutomationActionClaimFilter(
    actionRun: AutomationActionRun,
    input: ClaimNextAutomationActionRunInput,
  ): boolean {
    if (input.automation_scope !== undefined && actionRun.automation_scope !== input.automation_scope) {
      return false;
    }
    const scope = automationScopeParts(actionRun.automation_scope);
    if (input.project_id !== undefined && scope.projectId !== input.project_id) {
      return false;
    }
    if (input.repo_id !== undefined && scope.repoId !== input.repo_id) {
      return false;
    }
    return true;
  }

  private claimableAutomationActionPredicate(now: string) {
    return or(
      eq(automation_action_runs.status, 'pending'),
      and(
        eq(automation_action_runs.status, 'gate_pending'),
        or(sql`${automation_action_runs.nextAttemptAt} is null`, sql`${automation_action_runs.nextAttemptAt} <= ${now}`),
      ),
      and(
        or(eq(automation_action_runs.status, 'blocked'), eq(automation_action_runs.status, 'failed')),
        eq(automation_action_runs.retryable, true),
        or(sql`${automation_action_runs.nextAttemptAt} is null`, sql`${automation_action_runs.nextAttemptAt} <= ${now}`),
      ),
      and(eq(automation_action_runs.status, 'running'), sql`${automation_action_runs.lockedUntil} <= ${now}`),
    );
  }

  private automationActionClaimFilterPredicate(input: ClaimNextAutomationActionRunInput) {
    const predicates = [];
    if (input.automation_scope !== undefined) {
      predicates.push(eq(automation_action_runs.automationScope, input.automation_scope));
    }
    if (input.project_id !== undefined && input.repo_id !== undefined) {
      predicates.push(eq(automation_action_runs.automationScope, `repo:${input.project_id}:${input.repo_id}`));
    } else if (input.project_id !== undefined) {
      predicates.push(
        or(
          eq(automation_action_runs.automationScope, `project:${input.project_id}`),
          sql`${automation_action_runs.automationScope} like ${`repo:${input.project_id}:%`}`,
        ),
      );
    } else if (input.repo_id !== undefined) {
      predicates.push(sql`${automation_action_runs.automationScope} like ${`repo:%:${input.repo_id}`}`);
    }
    return predicates.length === 0 ? undefined : and(...predicates);
  }

  private compareAutomationActionRecency(left: AutomationActionRun, right: AutomationActionRun): number {
    return (
      compareTimestamp(right.finished_at ?? right.updated_at ?? right.created_at, left.finished_at ?? left.updated_at ?? left.created_at) ||
      right.id.localeCompare(left.id)
    );
  }

  private async runtimeSnapshotWorkItemsRequiringPlan(
    workItems: WorkItem[],
    repos: ProjectRepo[],
    specsById: Map<string, Spec>,
    holds: ManualPathHold[],
    settingsByScope: Map<string, AutomationProjectSettings>,
  ): Promise<RuntimeSnapshotTargetRow[]> {
    const targets: RuntimeSnapshotTargetRow[] = [];
    for (const workItem of workItems) {
      if (isWorkItemAutomationTerminal(workItem) || workItem.current_plan_id !== undefined || workItem.current_spec_id === undefined) {
        continue;
      }
      const spec = specsById.get(workItem.current_spec_id);
      const specRevisionId = spec?.approved_revision_id ?? spec?.current_revision_id ?? workItem.current_spec_revision_id;
      if (spec === undefined || spec.status !== 'approved' || specRevisionId === undefined) {
        continue;
      }
      const targetScope = this.runtimeSnapshotDraftTargetScope(
        repos,
        workItem.project_id,
        'canGeneratePlanDraft',
        settingsByScope,
      );
      if (targetScope === undefined) {
        continue;
      }
      if (this.hasActiveManualHold(holds, [`work_item:${workItem.id}`, `spec_revision:${specRevisionId}`])) {
        continue;
      }
      targets.push({
        target_object_type: 'work_item',
        target_object_id: workItem.id,
        target_revision_id: specRevisionId,
        target_status: 'approved',
        project_id: workItem.project_id,
        ...targetScope,
      });
    }
    return targets;
  }

  private async runtimeSnapshotPlanRevisionsRequiringPackages(
    plansToEvaluate: Plan[],
    repos: ProjectRepo[],
    planRevisionsById: Map<string, PlanRevision>,
    workItemsById: Map<string, WorkItem>,
    generationRuns: ExecutionPackageGenerationRun[],
    holds: ManualPathHold[],
    settingsByScope: Map<string, AutomationProjectSettings>,
  ): Promise<RuntimeSnapshotTargetRow[]> {
    const targets: RuntimeSnapshotTargetRow[] = [];
    for (const plan of plansToEvaluate) {
      if (plan.status !== 'approved') {
        continue;
      }
      const planRevisionId = plan.approved_revision_id ?? plan.current_revision_id;
      if (planRevisionId === undefined || this.hasCurrentPackageGeneration(generationRuns, planRevisionId)) {
        continue;
      }
      const planRevision = planRevisionsById.get(planRevisionId);
      const workItem = planRevision === undefined ? undefined : workItemsById.get(planRevision.work_item_id);
      if (planRevision === undefined || workItem === undefined || isWorkItemAutomationTerminal(workItem)) {
        continue;
      }
      const targetScope = this.runtimeSnapshotDraftTargetScope(
        repos,
        workItem.project_id,
        'canGeneratePackageDrafts',
        settingsByScope,
      );
      if (targetScope === undefined) {
        continue;
      }
      const generationKey = `default:${planRevisionId}`;
      if (
        this.hasActiveManualHold(holds, [
          `work_item:${workItem.id}`,
          `spec_revision:${planRevision.based_on_spec_revision_id}`,
          `plan_revision:${planRevisionId}`,
          `package_generation:${planRevisionId}:${generationKey}`,
        ])
      ) {
        continue;
      }
      targets.push({
        target_object_type: 'plan_revision',
        target_object_id: planRevisionId,
        target_revision_id: generationKey,
        target_status: 'approved',
        project_id: workItem.project_id,
        ...targetScope,
        generation_key: generationKey,
      });
    }
    return targets;
  }

  private runtimeSnapshotDraftTargetScope(
    repos: ProjectRepo[],
    projectId: string,
    capability: 'canGeneratePlanDraft' | 'canGeneratePackageDrafts',
    settingsByScope: Map<string, AutomationProjectSettings>,
  ): Pick<RuntimeSnapshotTargetRow, 'repo_id' | 'eligible_repo_ids' | 'automation_scope'> | undefined {
    const eligibleReposById = new Map<string, ProjectRepo>();
    for (const repo of repos) {
      if (repo.project_id !== projectId) {
        continue;
      }
      const settings = this.resolvePreloadedAutomationProjectSettings(settingsByScope, {
        project_id: projectId,
        repo_id: repo.repo_id,
      });
      if (settings.capabilities_json[capability]) {
        eligibleReposById.set(repo.repo_id, eligibleReposById.get(repo.repo_id) ?? repo);
      }
    }
    const eligibleRepos = [...eligibleReposById.values()];
    if (eligibleRepos.length === 0) {
      return undefined;
    }
    if (eligibleRepos.length === 1) {
      const repo = eligibleRepos[0]!;
      return { repo_id: repo.repo_id, automation_scope: `repo:${projectId}:${repo.repo_id}` as const };
    }
    return {
      eligible_repo_ids: eligibleRepos.map((repo) => repo.repo_id),
      automation_scope: `project:${projectId}` as const,
    };
  }

  private runtimeSnapshotRunEnqueueDisabledPackages(
    executionPackages: ExecutionPackage[],
    repos: ProjectRepo[],
  ): RuntimeSnapshotTargetRow[] {
    return executionPackages
      .filter(
        (executionPackage) =>
          executionPackage.phase === 'ready' &&
          repos.some((repo) => repo.project_id === executionPackage.project_id && repo.repo_id === executionPackage.repo_id),
      )
      .map((executionPackage) => ({
        target_object_type: 'execution_package',
        target_object_id: executionPackage.id,
        target_revision_id: executionPackage.plan_revision_id,
        target_status: executionPackage.phase,
        project_id: executionPackage.project_id,
        repo_id: executionPackage.repo_id,
        automation_scope: `repo:${executionPackage.project_id}:${executionPackage.repo_id}` as const,
        disabled_reason: 'run_enqueue_disabled_by_scope',
      }));
  }

  private runtimeSnapshotActiveHolds(holds: ManualPathHold[]) {
    return holds.map((hold) => ({
      object_type: hold.object_type,
      object_id: hold.object_id,
      scope_key: hold.scope_key,
      reason_code: hold.reason_code,
      status: hold.status,
      requested_at: hold.requested_at,
      ...(hold.resolved_at === undefined ? {} : { resolved_at: hold.resolved_at }),
      fingerprint: `${hold.scope_key}:${hold.reason_code}`,
    }));
  }

  private hasCurrentPackageGeneration(generationRuns: ExecutionPackageGenerationRun[], planRevisionId: string): boolean {
    return generationRuns.some(
      (run) => run.plan_revision_id === planRevisionId && (run.status === 'pending' || run.status === 'running' || run.status === 'succeeded'),
    );
  }

  private hasActiveManualHold(holds: ManualPathHold[], scopeKeys: string[]): boolean {
    const scopeKeySet = new Set(scopeKeys);
    return holds.some((hold) => hold.status === 'active' && scopeKeySet.has(hold.scope_key));
  }

  private applyLatestMatchingActionFields(
    targets: RuntimeSnapshotTargetRow[],
    latestMatchingActionFields: Map<
      string,
      Pick<RuntimeSnapshotTargetRow, 'latest_matching_action_status' | 'blocked_reason_code' | 'blocked_summary'>
    >,
  ): RuntimeSnapshotTargetRow[] {
    return targets.map((target) => ({
      ...target,
      ...latestMatchingActionFields.get(
        this.latestMatchingActionKey(
          this.runtimeSnapshotActionTypeForTarget(target),
          target.target_object_id,
          target.target_revision_id ?? '',
        ),
      ),
    }));
  }

  private latestMatchingActionFieldsByTarget(
    actions: AutomationActionRun[],
  ): Map<string, Pick<RuntimeSnapshotTargetRow, 'latest_matching_action_status' | 'blocked_reason_code' | 'blocked_summary'>> {
    const fieldsByTarget = new Map<
      string,
      Pick<RuntimeSnapshotTargetRow, 'latest_matching_action_status' | 'blocked_reason_code' | 'blocked_summary'>
    >();
    for (const actionRun of actions) {
      const targetRevisionId = actionRun.target_revision_id;
      if (targetRevisionId === undefined) {
        continue;
      }
      const key = this.latestMatchingActionKey(actionRun.action_type, actionRun.target_object_id, targetRevisionId);
      if (!fieldsByTarget.has(key)) {
        fieldsByTarget.set(key, this.latestMatchingActionFields(actionRun));
      }
    }
    return fieldsByTarget;
  }

  private latestMatchingActionFields(
    actionRun: AutomationActionRun | undefined,
  ): Pick<RuntimeSnapshotTargetRow, 'latest_matching_action_status' | 'blocked_reason_code' | 'blocked_summary'> {
    if (actionRun === undefined) {
      return {};
    }
    return {
      latest_matching_action_status: actionRun.status,
      ...(actionRun.status !== 'blocked'
        ? {}
        : {
            ...(actionRun.reason === undefined ? {} : { blocked_reason_code: actionRun.reason }),
            ...(actionRun.error_code === undefined ? {} : { blocked_summary: actionRun.error_code }),
          }),
    };
  }

  private runtimeSnapshotActionTypeForTarget(target: RuntimeSnapshotTargetRow): 'ensure_plan_draft' | 'ensure_package_drafts' {
    return target.target_object_type === 'plan_revision' ? 'ensure_package_drafts' : 'ensure_plan_draft';
  }

  private latestMatchingActionKey(actionType: string, targetObjectId: string, targetRevisionId: string): string {
    return `${actionType}:${targetObjectId}:${targetRevisionId}`;
  }

  private isAutomationActionClaimable(actionRun: AutomationActionRun, now: string): boolean {
    if (actionRun.status === 'pending') {
      return true;
    }
    if (actionRun.status === 'running') {
      return timestampAtOrBefore(actionRun.locked_until, now);
    }
    if (actionRun.status === 'gate_pending') {
      return actionRun.next_attempt_at === undefined || timestampAtOrBefore(actionRun.next_attempt_at, now);
    }
    if (actionRun.status === 'blocked' || actionRun.status === 'failed') {
      return actionRun.retryable === true && (actionRun.next_attempt_at === undefined || timestampAtOrBefore(actionRun.next_attempt_at, now));
    }
    return false;
  }

  private assertGenerationPackageManifestComplete(run: ExecutionPackageGenerationRun): Promise<void> {
    return (async () => {
      const packages = await this.listWhere<ExecutionPackageGenerationPackageRecord>(
        execution_package_generation_packages,
        eq(execution_package_generation_packages.executionPackageSetId, run.execution_package_set_id),
        [execution_package_generation_packages.sequence, execution_package_generation_packages.packageKey],
      );
      if (run.expected_package_count !== undefined && packages.length !== run.expected_package_count) {
        throw new DomainError('INVALID_TRANSITION', `Package generation ${run.execution_package_set_id} package count mismatch`);
      }
      if (run.expected_package_keys !== undefined) {
        const packageKeys = packages.map((record) => record.package_key);
        if (JSON.stringify(packageKeys) !== JSON.stringify(run.expected_package_keys)) {
          throw new DomainError('INVALID_TRANSITION', `Package generation ${run.execution_package_set_id} package key mismatch`);
        }
      }
      if (run.manifest_digest !== undefined && packages.some((record) => record.manifest_digest !== run.manifest_digest)) {
        throw new DomainError('INVALID_TRANSITION', `Package generation ${run.execution_package_set_id} manifest mismatch`);
      }
    })();
  }

  private async manualPathHoldBySourceAction(sourceAutomationActionId: string): Promise<ManualPathHold | undefined> {
    const [row] = await this.db
      .select()
      .from(manual_path_holds)
      .where(eq(manual_path_holds.sourceAutomationActionId, sourceAutomationActionId))
      .limit(1);
    return row === undefined ? undefined : fromDbRecord<ManualPathHold>(row);
  }

  private manualPathHoldLockKeys(input: RequestManualPathHoldInput): string[] {
    return [
      `manual-hold-idem:${input.idempotency_key}`,
      ...(input.source_automation_action_id === undefined ? [] : [`manual-hold-source:${input.source_automation_action_id}`]),
    ];
  }

  private automationSettingsKey(projectId: string, repoId: string | undefined): string {
    return repoId === undefined ? `project:${projectId}` : `repo:${projectId}:${repoId}`;
  }

  private resolvePreloadedAutomationProjectSettings(
    settingsByScope: Map<string, AutomationProjectSettings>,
    input: ResolveAutomationProjectSettingsInput,
  ): AutomationProjectSettings {
    const existing = settingsByScope.get(this.automationSettingsKey(input.project_id, input.repo_id));
    if (existing !== undefined) {
      return existing;
    }

    const capabilities = automationCapabilitiesForPreset('off');
    return {
      id: `default:${this.automationSettingsKey(input.project_id, input.repo_id)}`,
      project_id: input.project_id,
      ...(input.repo_id === undefined ? {} : { repo_id: input.repo_id }),
      preset: 'off',
      capabilities_json: capabilities,
      capability_fingerprint: capabilityFingerprint(capabilities),
      scope_type: input.repo_id === undefined ? 'project' : 'repo',
      version: 0,
      evidence_refs: [],
    };
  }

  private supportsSelect(): boolean {
    return typeof (this.db as { select?: unknown }).select === 'function';
  }

  private assertManualScopeKey(input: RequestManualPathHoldInput): void {
    switch (input.object_type) {
      case 'work_item':
      case 'spec_revision':
      case 'plan_revision':
      case 'execution_package':
      case 'run_session':
      case 'review_packet':
        assertCanonicalManualScopeKey(input.scope_key, {
          object_type: input.object_type,
          object_id: input.object_id,
        });
        return;
      case 'package_generation':
        if (input.generation_key === undefined) {
          throw new DomainError('MANUAL_PATH_SCOPE_INVALID', 'Package generation manual hold requires generation_key');
        }
        assertCanonicalManualScopeKey(input.scope_key, {
          object_type: 'package_generation',
          object_id: input.object_id,
          generation_key: input.generation_key,
        });
        return;
      case 'release_gate':
        if (input.gate_key === undefined) {
          throw new DomainError('MANUAL_PATH_SCOPE_INVALID', 'Release gate manual hold requires gate_key');
        }
        assertCanonicalManualScopeKey(input.scope_key, {
          object_type: 'release_gate',
          object_id: input.object_id,
          gate_key: input.gate_key,
        });
        return;
      default:
        throw new DomainError('MANUAL_PATH_SCOPE_INVALID', `Unsupported manual path hold object type ${input.object_type}`);
    }
  }

  private async manualHoldScopeKeysFor(input: ListActiveManualPathHoldsInput): Promise<string[]> {
    const keys = [`${input.object_type}:${input.object_id}`];
    if (input.object_type === 'execution_package') {
      const executionPackage = await this.getExecutionPackage(input.object_id);
      if (executionPackage !== undefined) {
        keys.push(
          `work_item:${executionPackage.work_item_id}`,
          `spec_revision:${executionPackage.spec_revision_id}`,
          `plan_revision:${executionPackage.plan_revision_id}`,
        );
      }
    }
    if (input.object_type === 'package_generation' && input.generation_key !== undefined) {
      keys.push(`package_generation:${input.object_id}:${input.generation_key}`);
    }
    if (input.object_type === 'release_gate') {
      if (input.gate_key !== undefined) {
        keys.push(`release_gate:${input.object_id}:${input.gate_key}`);
      } else {
        const releaseGateHolds = await this.listWhere<ManualPathHold>(
          manual_path_holds,
          and(eq(manual_path_holds.status, 'active'), eq(manual_path_holds.objectType, 'release_gate')),
        );
        keys.push(...releaseGateHolds.filter((hold) => hold.object_id === input.object_id).map((hold) => hold.scope_key));
      }
    }
    if (input.object_type === 'run_session') {
      const runSession = await this.getRunSession(input.object_id);
      if (runSession !== undefined) {
        keys.push(...(await this.manualHoldScopeKeysFor({ object_type: 'execution_package', object_id: runSession.execution_package_id })));
      }
    }
    if (input.object_type === 'review_packet') {
      const reviewPacket = await this.getReviewPacket(input.object_id);
      if (reviewPacket !== undefined) {
        keys.push(
          ...(await this.manualHoldScopeKeysFor({
            object_type: 'execution_package',
            object_id: reviewPacket.execution_package_id,
          })),
        );
      }
    }
    return [...new Set(keys)];
  }

  private async commandIdempotencyByKey(idempotencyKey: string): Promise<CommandIdempotencyRecord | undefined> {
    const [row] = await this.db
      .select()
      .from(command_idempotency_records)
      .where(eq(command_idempotency_records.idempotencyKey, idempotencyKey))
      .limit(1);
    return row === undefined ? undefined : fromDbRecord<CommandIdempotencyRecord>(row);
  }

  private async claimedCommandIdempotency(
    idempotencyKey: string,
    claimToken: string,
  ): Promise<CommandIdempotencyRecord> {
    const record = await this.commandIdempotencyByKey(idempotencyKey);
    if (record === undefined || record.status !== 'running' || record.claim_token !== claimToken) {
      throw new DomainError('INVALID_TRANSITION', `Command idempotency record ${idempotencyKey} is not claimed`);
    }
    return record;
  }

  private async finishCommandIdempotency(
    input: FinishCommandIdempotencyInput,
    status: CommandIdempotencyRecord['status'],
  ): Promise<CommandIdempotencyRecord> {
    const record = await this.claimedCommandIdempotency(input.idempotency_key, input.claim_token);
    const finished: CommandIdempotencyRecord = {
      ...record,
      status,
      ...(input.result_json === undefined ? {} : { result_json: input.result_json }),
      finished_at: input.finished_at,
      updated_at: input.finished_at,
    };
    await this.upsert(command_idempotency_records, command_idempotency_records.id, finished);
    return finished;
  }

  private async generationRunFor(
    planRevisionId: string,
    generationKey: string,
  ): Promise<ExecutionPackageGenerationRun | undefined> {
    const [row] = await this.db
      .select()
      .from(execution_package_generation_runs)
      .where(
        and(
          eq(execution_package_generation_runs.planRevisionId, planRevisionId),
          eq(execution_package_generation_runs.generationKey, generationKey),
        ),
      )
      .limit(1);
    return row === undefined ? undefined : fromDbRecord<ExecutionPackageGenerationRun>(row);
  }

  private async claimedGenerationRun(
    executionPackageSetId: string,
    claimToken: string,
  ): Promise<ExecutionPackageGenerationRun> {
    const run = await this.getById<ExecutionPackageGenerationRun>(
      execution_package_generation_runs,
      execution_package_generation_runs.executionPackageSetId,
      executionPackageSetId,
    );
    if (run === undefined || run.status !== 'running' || run.claim_token !== claimToken) {
      throw new DomainError('INVALID_TRANSITION', `Package generation ${executionPackageSetId} is not claimed`);
    }
    return run;
  }

  private async automationActionRunByIdempotencyKey(idempotencyKey: string): Promise<AutomationActionRun | undefined> {
    const [row] = await this.db
      .select()
      .from(automation_action_runs)
      .where(eq(automation_action_runs.idempotencyKey, idempotencyKey))
      .limit(1);
    return row === undefined ? undefined : fromDbRecord<AutomationActionRun>(row);
  }

  private async claimedAutomationActionRun(id: string, claimToken: string): Promise<AutomationActionRun> {
    const actionRun = await this.getById<AutomationActionRun>(automation_action_runs, automation_action_runs.id, id);
    if (actionRun === undefined || actionRun.status !== 'running' || actionRun.claim_token !== claimToken) {
      throw new DomainError('INVALID_TRANSITION', `Automation action ${id} is not claimed`);
    }
    return actionRun;
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

  private releaseTableRecord(release: Release): Omit<Release, 'work_item_ids' | 'execution_package_ids'> {
    const { work_item_ids: _workItemIds, execution_package_ids: _executionPackageIds, ...record } = release;
    return record;
  }

  private async saveReleaseRecord(release: Release): Promise<void> {
    await this.upsert(releases, releases.id, this.releaseTableRecord(release));
  }

  private async replaceReleaseWorkItems(releaseId: string, workItemIds: string[]): Promise<void> {
    const uniqueWorkItemIds = [...new Set(workItemIds)];
    await this.db.delete(release_work_items).where(eq(release_work_items.releaseId, releaseId));

    for (const [index, workItemId] of uniqueWorkItemIds.entries()) {
      await this.saveReleaseWorkItemLink(releaseId, workItemId, index);
    }
  }

  private async replaceReleaseExecutionPackages(releaseId: string, executionPackageIds: string[]): Promise<void> {
    const uniqueExecutionPackageIds = [...new Set(executionPackageIds)];
    await this.db.delete(release_execution_packages).where(eq(release_execution_packages.releaseId, releaseId));

    for (const [index, executionPackageId] of uniqueExecutionPackageIds.entries()) {
      await this.saveReleaseExecutionPackageLink(releaseId, executionPackageId, index);
    }
  }

  private async hydrateReleaseLinks(release: Release): Promise<Release> {
    const [workItems, executionPackages] = await Promise.all([
      this.listReleaseWorkItems(release.id),
      this.listReleaseExecutionPackages(release.id),
    ]);

    return {
      ...release,
      work_item_ids: workItems.map((workItem) => workItem.work_item_id),
      execution_package_ids: executionPackages.map((executionPackage) => executionPackage.execution_package_id),
    };
  }

  private async getReleaseWorkItemLinkOrder(releaseId: string, workItemId: string): Promise<number | undefined> {
    const [row] = await this.db
      .select({ linkOrder: release_work_items.linkOrder })
      .from(release_work_items)
      .where(and(eq(release_work_items.releaseId, releaseId), eq(release_work_items.workItemId, workItemId)))
      .limit(1);

    return row?.linkOrder;
  }

  private async nextReleaseWorkItemOrder(releaseId: string): Promise<number> {
    const [row] = await this.db
      .select({ linkOrder: release_work_items.linkOrder })
      .from(release_work_items)
      .where(eq(release_work_items.releaseId, releaseId))
      .orderBy(desc(release_work_items.linkOrder))
      .limit(1);

    return (row?.linkOrder ?? -1) + 1;
  }

  private async saveReleaseWorkItemLink(releaseId: string, workItemId: string, linkOrder: number): Promise<void> {
    const record = toDbRecord({ release_id: releaseId, work_item_id: workItemId, linkOrder }, release_work_items);
    await this.db
      .insert(release_work_items)
      .values(record as never)
      .onConflictDoUpdate({
        target: [release_work_items.releaseId, release_work_items.workItemId],
        set: record as never,
      });
  }

  private async getReleaseExecutionPackageLinkOrder(
    releaseId: string,
    executionPackageId: string,
  ): Promise<number | undefined> {
    const [row] = await this.db
      .select({ linkOrder: release_execution_packages.linkOrder })
      .from(release_execution_packages)
      .where(
        and(
          eq(release_execution_packages.releaseId, releaseId),
          eq(release_execution_packages.packageId, executionPackageId),
        ),
      )
      .limit(1);

    return row?.linkOrder;
  }

  private async nextReleaseExecutionPackageOrder(releaseId: string): Promise<number> {
    const [row] = await this.db
      .select({ linkOrder: release_execution_packages.linkOrder })
      .from(release_execution_packages)
      .where(eq(release_execution_packages.releaseId, releaseId))
      .orderBy(desc(release_execution_packages.linkOrder))
      .limit(1);

    return (row?.linkOrder ?? -1) + 1;
  }

  private async saveReleaseExecutionPackageLink(
    releaseId: string,
    executionPackageId: string,
    linkOrder: number,
  ): Promise<void> {
    const record = toDbRecord(
      { release_id: releaseId, package_id: executionPackageId, linkOrder },
      release_execution_packages,
    );
    await this.db
      .insert(release_execution_packages)
      .values(record as never)
      .onConflictDoUpdate({
        target: [release_execution_packages.releaseId, release_execution_packages.packageId],
        set: record as never,
      });
  }
}
