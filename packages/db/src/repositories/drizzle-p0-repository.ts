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
  ClaimCommandIdempotencyInput,
  ClaimExecutionPackageGenerationRunInput,
  CompleteAutomationActionRunInput,
  CompleteExecutionPackageGenerationRunInput,
  DisableAutomationProjectSettingsInput,
  ExecutionPackageGenerationPackageRecord,
  FinishCommandIdempotencyInput,
  ListActiveManualPathHoldsInput,
  ListClaimableAutomationActionRunsInput,
  MarkAutomationActionGatePendingInput,
  P0Repository,
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
} from './p0-repository';

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

export class DrizzleP0Repository implements P0Repository {
  constructor(private readonly db: ForgeloopDrizzleDatabase) {}

  async withP0Transaction<T>(write: (repository: P0Repository) => Promise<T>): Promise<T> {
    return this.db.transaction((tx) => write(new DrizzleP0Repository(tx as ForgeloopDrizzleDatabase)));
  }

  async withObjectLock<T>(key: string, write: (repository: P0Repository) => Promise<T>): Promise<T> {
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
      (repository) => (repository as DrizzleP0Repository).setAutomationProjectSettingsUnlocked(input),
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
      (repository as DrizzleP0Repository).requestManualPathHoldUnlocked(input),
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
      (repository as DrizzleP0Repository).claimCommandIdempotencyUnlocked(input),
    );
  }

  async renewCommandIdempotency(input: RenewCommandIdempotencyInput): Promise<CommandIdempotencyRecord> {
    return this.withAdvisoryLocks([`command-idempotency:${input.idempotency_key}`], (repository) =>
      (repository as DrizzleP0Repository).renewCommandIdempotencyUnlocked(input),
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
      (repository as DrizzleP0Repository).finishCommandIdempotency(input, 'succeeded'),
    );
  }

  async failCommandIdempotency(input: FinishCommandIdempotencyInput): Promise<CommandIdempotencyRecord> {
    return this.withAdvisoryLocks([`command-idempotency:${input.idempotency_key}`], (repository) =>
      (repository as DrizzleP0Repository).finishCommandIdempotency(input, 'failed'),
    );
  }

  async blockCommandIdempotency(input: FinishCommandIdempotencyInput): Promise<CommandIdempotencyRecord> {
    return this.withAdvisoryLocks([`command-idempotency:${input.idempotency_key}`], (repository) =>
      (repository as DrizzleP0Repository).finishCommandIdempotency(input, 'blocked'),
    );
  }

  async claimExecutionPackageGenerationRun(
    input: ClaimExecutionPackageGenerationRunInput,
  ): Promise<ExecutionPackageGenerationRun> {
    return this.withAdvisoryLocks([`package-generation:${input.plan_revision_id}`], (repository) =>
      (repository as DrizzleP0Repository).claimExecutionPackageGenerationRunUnlocked(input),
    );
  }

  async saveExecutionPackageGenerationPackage(input: SaveExecutionPackageGenerationPackageInput): Promise<void> {
    return this.withAdvisoryLocks([`package-generation:${input.plan_revision_id}`], (repository) =>
      (repository as DrizzleP0Repository).saveExecutionPackageGenerationPackageUnlocked(input),
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
      (repository as DrizzleP0Repository).completeExecutionPackageGenerationRunUnlocked(input),
    );
  }

  async supersedeExecutionPackageGenerationRun(
    input: SupersedeExecutionPackageGenerationRunInput,
  ): Promise<ExecutionPackageGenerationRun> {
    return this.withAdvisoryLocks([`package-generation:${input.plan_revision_id}`], (repository) =>
      (repository as DrizzleP0Repository).supersedeExecutionPackageGenerationRunUnlocked(input),
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

  async claimAutomationActionRun(input: ClaimAutomationActionRunInput): Promise<AutomationActionRun> {
    return this.withAdvisoryLocks([`automation-action:${input.idempotency_key}`], (repository) =>
      (repository as DrizzleP0Repository).claimAutomationActionRunUnlocked(input),
    );
  }

  async markAutomationActionGatePending(input: MarkAutomationActionGatePendingInput): Promise<AutomationActionRun> {
    return this.withAdvisoryLocks([`automation-action:${input.idempotency_key}`], (repository) =>
      (repository as DrizzleP0Repository).markAutomationActionGatePendingUnlocked(input),
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
    return this.withAdvisoryLocks([`automation-action:${input.idempotency_key}`], (repository) =>
      (repository as DrizzleP0Repository).completeAutomationActionRunUnlocked(input),
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

  async listRuntimeSnapshotRows(): Promise<Record<string, unknown>[]> {
    return [];
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
      const repository = new DrizzleP0Repository(tx as ForgeloopDrizzleDatabase);
      await repository.saveReleaseRecord(normalized);
      await repository.replaceReleaseWorkItems(normalized.id, normalized.work_item_ids);
      await repository.replaceReleaseExecutionPackages(normalized.id, normalized.execution_package_ids);
    });
  }

  async getRelease(releaseId: string): Promise<Release | undefined> {
    const release = await this.getById<Release>(releases, releases.id, releaseId);
    return release === undefined ? undefined : this.hydrateReleaseLinks(release);
  }

  async listReleasesForProject(projectId: string): Promise<Release[]> {
    const releaseRows = await this.listWhere<Release>(releases, eq(releases.projectId, projectId), releases.createdAt);
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
      const existing = await new DrizzleP0Repository(db).getById<RunEvent>(run_events, run_events.id, event.id);
      if (existing === undefined) {
        throw new DomainError('INVALID_TRANSITION', `Run event ${event.id} could not be appended`);
      }

      return existing;
    }

    return fromDbRecord<RunEvent>(row);
  }

  private async withAdvisoryLocks<T>(keys: readonly string[], write: (repository: P0Repository) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => {
      for (const key of [...new Set(keys)].sort()) {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${key}))`);
      }
      return write(new DrizzleP0Repository(tx as ForgeloopDrizzleDatabase));
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

  private async claimAutomationActionRunUnlocked(input: ClaimAutomationActionRunInput): Promise<AutomationActionRun> {
    const existing = await this.automationActionRunByIdempotencyKey(input.idempotency_key);
    if (existing !== undefined) {
      this.assertAutomationActionIdentityMatches(existing, input);
      if (!this.isAutomationActionClaimable(existing, input.now)) {
        if (existing.status === 'running') {
          throw new DomainError('INVALID_TRANSITION', `Automation action ${input.idempotency_key} already has an active claim`);
        }
        return redactAutomationActionClaim(existing);
      }
    }
    const actionRun: AutomationActionRun = {
      id: existing?.id ?? input.id,
      action_type: input.action_type,
      target_object_type: input.target_object_type,
      target_object_id: input.target_object_id,
      ...(input.target_revision_id === undefined ? {} : { target_revision_id: input.target_revision_id }),
      target_status: input.target_status,
      idempotency_key: input.idempotency_key,
      automation_scope: input.automation_scope,
      automation_settings_version: input.automation_settings_version,
      capability_fingerprint: input.capability_fingerprint,
      status: 'running',
      claim_token: input.claim_token,
      attempt: (existing?.attempt ?? 0) + 1,
      locked_until: input.locked_until,
      claimed_at: input.now,
      started_at: existing?.started_at ?? input.now,
      created_at: existing?.created_at ?? input.now,
      updated_at: input.now,
    };
    await this.upsert(automation_action_runs, automation_action_runs.id, actionRun);
    return actionRun;
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
      existing.target_status !== input.target_status ||
      existing.automation_scope !== input.automation_scope ||
      existing.automation_settings_version !== input.automation_settings_version ||
      existing.capability_fingerprint !== input.capability_fingerprint;
    if (mismatched) {
      throw new DomainError('INVALID_TRANSITION', `Automation action ${input.idempotency_key} identity changed`);
    }
  }

  private isAutomationActionClaimable(actionRun: AutomationActionRun, now: string): boolean {
    if (actionRun.status === 'pending') {
      return true;
    }
    if (actionRun.status === 'running') {
      return actionRun.locked_until !== undefined && actionRun.locked_until <= now;
    }
    if (actionRun.status === 'gate_pending') {
      return actionRun.next_attempt_at === undefined || actionRun.next_attempt_at <= now;
    }
    if (actionRun.status === 'blocked' || actionRun.status === 'failed') {
      return actionRun.retryable === true && (actionRun.next_attempt_at === undefined || actionRun.next_attempt_at <= now);
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
