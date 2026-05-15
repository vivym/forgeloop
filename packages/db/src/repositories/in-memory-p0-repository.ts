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
  isOpenReviewPacketStatus,
  isWorkItemAutomationTerminal,
} from '@forgeloop/domain';

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
  P0Repository,
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
} from './p0-repository';
import { ObjectLockManager } from './object-lock';

const clone = <T>(value: T): T => structuredClone(value);

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

const redactAutomationActionClaim = (actionRun: AutomationActionRun): AutomationActionRun => {
  const { claim_token: _claimToken, locked_until: _lockedUntil, ...redacted } = actionRun;
  return redacted;
};

const valuesFor = <T>(records: Map<string, T>): T[] => [...records.values()].map(clone);

const byCreatedAt = <T extends { created_at: string }>(left: T, right: T) => left.created_at.localeCompare(right.created_at);
const byCreatedAtThenId = <T extends { created_at: string; id: string }>(left: T, right: T) =>
  byCreatedAt(left, right) || left.id.localeCompare(right.id);
const byCreatedAtForRequestedAt = <T extends { requested_at: string; id: string }>(left: T, right: T) =>
  left.requested_at.localeCompare(right.requested_at) || left.id.localeCompare(right.id);
const recoverableRunSessionStatuses = new Set<RunSession['status']>([
  'queued',
  'running',
  'waiting_for_input',
  'stalled',
  'resuming',
  'cancel_requested',
]);
const terminalCommandStatuses = new Set<CommandIdempotencyRecord['status']>(['succeeded', 'skipped', 'blocked']);
const eventCursor = (sequence: number) => String(sequence).padStart(10, '0');
const invalidLease = (runSessionId: string): DomainErrorType =>
  new DomainError('INVALID_TRANSITION', `Run session ${runSessionId} does not have an active worker lease`);

export class InMemoryP0Repository implements P0Repository {
  private readonly objectLocks = new ObjectLockManager();
  private readonly organizations = new Map<string, Organization>();
  private readonly actors = new Map<string, Actor>();
  private readonly projects = new Map<string, Project>();
  private readonly projectRepos = new Map<string, ProjectRepo>();
  private readonly workItems = new Map<string, WorkItem>();
  private readonly specs = new Map<string, Spec>();
  private readonly specRevisions = new Map<string, SpecRevision>();
  private readonly plans = new Map<string, Plan>();
  private readonly planRevisions = new Map<string, PlanRevision>();
  private readonly executionPackages = new Map<string, ExecutionPackage>();
  private readonly executionPackageDependencies = new Map<string, ExecutionPackageDependency>();
  private readonly runSessions = new Map<string, RunSession>();
  private readonly runEvents = new Map<string, RunEvent>();
  private readonly runCommands = new Map<string, RunCommand>();
  private readonly runWorkerLeases = new Map<string, RunWorkerLease>();
  private readonly reviewPackets = new Map<string, ReviewPacket>();
  private readonly releases = new Map<string, Release>();
  private readonly releaseWorkItems = new Map<string, ReleaseWorkItem>();
  private readonly releaseWorkItemOrders = new Map<string, number>();
  private readonly releaseExecutionPackages = new Map<string, ReleaseExecutionPackage>();
  private readonly releaseExecutionPackageOrders = new Map<string, number>();
  private readonly releaseEvidences = new Map<string, ReleaseEvidence>();
  private readonly objectEvents = new Map<string, ObjectEvent>();
  private readonly statusHistories = new Map<string, StatusHistory>();
  private readonly artifacts = new Map<string, Artifact>();
  private readonly decisions = new Map<string, Decision>();
  private readonly traceEvents = new Map<string, TraceEventRecord>();
  private readonly traceLinks = new Map<string, TraceLinkRecord>();
  private readonly traceArtifactRefs = new Map<string, TraceArtifactRefRecord>();
  private readonly automationProjectSettings = new Map<string, AutomationProjectSettings>();
  private readonly manualPathHolds = new Map<string, ManualPathHold>();
  private readonly manualPathHoldIdempotency = new Map<string, string>();
  private readonly manualPathHoldSourceActions = new Map<string, string>();
  private readonly commandIdempotencyRecords = new Map<string, CommandIdempotencyRecord>();
  private readonly executionPackageGenerationRuns = new Map<string, ExecutionPackageGenerationRun>();
  private readonly executionPackageGenerationPackages = new Map<string, ExecutionPackageGenerationPackageRecord>();
  private readonly automationActionRuns = new Map<string, AutomationActionRun>();
  private readonly automationActionRunIdempotency = new Map<string, string>();

  async withP0Transaction<T>(write: (repository: P0Repository) => Promise<T>): Promise<T> {
    return this.objectLocks.withLock('p0-transaction', async () => {
      const transaction = new InMemoryP0Repository();
      this.copyTransactionalStateTo(transaction);
      const snapshots = transaction.snapshotTransactionalMaps();
      const result = await write(transaction);
      this.mergeTransactionalChangesFrom(transaction, snapshots);
      return result;
    });
  }

  async withObjectLock<T>(key: string, write: (repository: P0Repository) => Promise<T>): Promise<T> {
    return this.objectLocks.withLock(key, () => write(this));
  }

  async saveOrganization(organization: Organization): Promise<void> {
    this.organizations.set(organization.id, clone(organization));
  }

  async getOrganization(organizationId: string): Promise<Organization | undefined> {
    return this.cloneMaybe(this.organizations.get(organizationId));
  }

  async saveActor(actor: Actor): Promise<void> {
    this.actors.set(actor.id, clone(actor));
  }

  async getActor(actorId: string): Promise<Actor | undefined> {
    return this.cloneMaybe(this.actors.get(actorId));
  }

  async listActorsForOrganization(organizationId: string): Promise<Actor[]> {
    return valuesFor(this.actors)
      .filter((actor) => actor.org_id === organizationId)
      .sort(byCreatedAtThenId);
  }

  async saveProject(project: Project): Promise<void> {
    this.projects.set(project.id, clone(project));
  }

  async getProject(projectId: string): Promise<Project | undefined> {
    return this.cloneMaybe(this.projects.get(projectId));
  }

  async saveProjectRepo(projectRepo: ProjectRepo): Promise<void> {
    this.projectRepos.set(projectRepo.id, clone(projectRepo));
  }

  async listProjectRepos(projectId: string): Promise<ProjectRepo[]> {
    return valuesFor(this.projectRepos).filter((projectRepo) => projectRepo.project_id === projectId);
  }

  async saveWorkItem(workItem: WorkItem): Promise<void> {
    this.workItems.set(workItem.id, clone(workItem));
  }

  async getWorkItem(workItemId: string): Promise<WorkItem | undefined> {
    return this.cloneMaybe(this.workItems.get(workItemId));
  }

  async listWorkItems(projectId?: string): Promise<WorkItem[]> {
    const workItems = valuesFor(this.workItems);
    return projectId === undefined ? workItems : workItems.filter((workItem) => workItem.project_id === projectId);
  }

  async saveSpec(spec: Spec): Promise<void> {
    this.specs.set(spec.id, clone(spec));
  }

  async getSpec(specId: string): Promise<Spec | undefined> {
    return this.cloneMaybe(this.specs.get(specId));
  }

  async saveSpecRevision(specRevision: SpecRevision): Promise<void> {
    this.specRevisions.set(specRevision.id, clone(specRevision));
  }

  async getSpecRevision(specRevisionId: string): Promise<SpecRevision | undefined> {
    return this.cloneMaybe(this.specRevisions.get(specRevisionId));
  }

  async listSpecRevisions(specId: string): Promise<SpecRevision[]> {
    return valuesFor(this.specRevisions)
      .filter((specRevision) => specRevision.spec_id === specId)
      .sort((left, right) => left.revision_number - right.revision_number);
  }

  async savePlan(plan: Plan): Promise<void> {
    this.plans.set(plan.id, clone(plan));
  }

  async getPlan(planId: string): Promise<Plan | undefined> {
    return this.cloneMaybe(this.plans.get(planId));
  }

  async savePlanRevision(planRevision: PlanRevision): Promise<void> {
    this.planRevisions.set(planRevision.id, clone(planRevision));
  }

  async getPlanRevision(planRevisionId: string): Promise<PlanRevision | undefined> {
    return this.cloneMaybe(this.planRevisions.get(planRevisionId));
  }

  async listPlanRevisions(planId: string): Promise<PlanRevision[]> {
    return valuesFor(this.planRevisions)
      .filter((planRevision) => planRevision.plan_id === planId)
      .sort((left, right) => left.revision_number - right.revision_number);
  }

  async saveExecutionPackage(executionPackage: ExecutionPackage): Promise<void> {
    this.executionPackages.set(executionPackage.id, clone(executionPackage));
  }

  async getExecutionPackage(executionPackageId: string): Promise<ExecutionPackage | undefined> {
    return this.cloneMaybe(this.executionPackages.get(executionPackageId));
  }

  async listExecutionPackagesForWorkItem(workItemId: string): Promise<ExecutionPackage[]> {
    return valuesFor(this.executionPackages).filter((executionPackage) => executionPackage.work_item_id === workItemId);
  }

  async saveExecutionPackageDependency(dependency: ExecutionPackageDependency): Promise<void> {
    this.executionPackageDependencies.set(this.dependencyKey(dependency), clone(dependency));
  }

  async listExecutionPackageDependencies(executionPackageId: string): Promise<ExecutionPackageDependency[]> {
    return valuesFor(this.executionPackageDependencies).filter(
      (dependency) => dependency.package_id === executionPackageId,
    );
  }

  async saveRunSession(runSession: RunSession): Promise<void> {
    if (isActiveRunSessionStatus(runSession.status)) {
      const existingActive = await this.findActiveRunSessionForPackage(runSession.execution_package_id);
      if (existingActive !== undefined && existingActive.id !== runSession.id) {
        throw new DomainError(
          'INVALID_TRANSITION',
          `Package ${runSession.execution_package_id} already has active run ${existingActive.id}`,
        );
      }
    }
    this.runSessions.set(runSession.id, clone(runSession));
  }

  async getRunSession(runSessionId: string): Promise<RunSession | undefined> {
    return this.cloneMaybe(this.runSessions.get(runSessionId));
  }

  async listRunSessionsForPackage(executionPackageId: string): Promise<RunSession[]> {
    return valuesFor(this.runSessions)
      .filter((runSession) => runSession.execution_package_id === executionPackageId)
      .sort(byCreatedAt);
  }

  async findActiveRunSessionForPackage(executionPackageId: string): Promise<RunSession | undefined> {
    const activeRunSession = valuesFor(this.runSessions)
      .filter(
        (runSession) =>
          runSession.execution_package_id === executionPackageId && isActiveRunSessionStatus(runSession.status),
      )
      .sort(byCreatedAt)[0];

    return this.cloneMaybe(activeRunSession);
  }

  async listRecoverableRunSessions(): Promise<RunSession[]> {
    return valuesFor(this.runSessions)
      .filter((runSession) => recoverableRunSessionStatuses.has(runSession.status))
      .sort(byCreatedAt);
  }

  async appendRunEvent(event: Omit<RunEvent, 'sequence' | 'cursor'>): Promise<RunEvent> {
    const existing = this.runEvents.get(event.id);
    if (existing !== undefined) {
      return clone(existing);
    }

    const sequence =
      Math.max(
        0,
        ...valuesFor(this.runEvents)
          .filter((runEvent) => runEvent.run_session_id === event.run_session_id)
          .map((runEvent) => runEvent.sequence),
      ) + 1;
    const runEvent: RunEvent = {
      ...clone(event),
      sequence,
      cursor: eventCursor(sequence),
    };

    this.runEvents.set(runEvent.id, clone(runEvent));
    return clone(runEvent);
  }

  async listRunEvents(runSessionId: string, options: { after?: string; limit?: number } = {}): Promise<RunEvent[]> {
    const events = valuesFor(this.runEvents)
      .filter((runEvent) => runEvent.run_session_id === runSessionId)
      .filter((runEvent) => options.after === undefined || runEvent.cursor > options.after)
      .sort((left, right) => left.sequence - right.sequence);

    return options.limit === undefined ? events : events.slice(0, options.limit);
  }

  async getLatestRunEvent(runSessionId: string): Promise<RunEvent | undefined> {
    return this.cloneMaybe(
      valuesFor(this.runEvents)
        .filter((runEvent) => runEvent.run_session_id === runSessionId)
        .sort((left, right) => right.sequence - left.sequence)[0],
    );
  }

  async appendWorkerRunEvent(
    event: Omit<RunEvent, 'sequence' | 'cursor'>,
    lease: { workerId: string; leaseToken: string },
  ): Promise<RunEvent> {
    await this.assertActiveRunWorkerLease(event.run_session_id, lease.workerId, lease.leaseToken, event.created_at);
    return this.appendRunEvent(event);
  }

  async saveRunCommand(command: RunCommand): Promise<void> {
    this.runCommands.set(command.id, clone(command));
  }

  async claimNextRunCommand(
    runSessionId: string,
    workerId: string,
    leaseToken: string,
    now: string,
    options: { reclaim_claimed_before?: string } = {},
  ): Promise<{ command: RunCommand; reclaimed: boolean } | undefined> {
    await this.assertActiveRunWorkerLease(runSessionId, workerId, leaseToken, now);

    const pending = valuesFor(this.runCommands)
      .filter((command) => command.run_session_id === runSessionId && command.status === 'pending')
      .sort((left, right) => {
        const priorityDelta = commandPriority(left) - commandPriority(right);
        return priorityDelta === 0 ? left.created_at.localeCompare(right.created_at) : priorityDelta;
      })[0];

    if (pending !== undefined) {
      const command = this.claimCommand(pending, workerId, now);
      return { command, reclaimed: false };
    }

    if (options.reclaim_claimed_before === undefined) {
      return undefined;
    }

    const staleClaim = valuesFor(this.runCommands)
      .filter(
        (command) =>
          command.run_session_id === runSessionId &&
          command.status === 'claimed' &&
          command.claimed_at !== undefined &&
          command.claimed_at <= options.reclaim_claimed_before!,
      )
      .sort((left, right) => (left.claimed_at ?? '').localeCompare(right.claimed_at ?? ''))[0];

    if (staleClaim === undefined) {
      return undefined;
    }

    const command = this.claimCommand(staleClaim, workerId, now);
    return { command, reclaimed: true };
  }

  async recordRunCommandDriverAck(
    commandId: string,
    lease: { workerId: string; leaseToken: string },
    driverAck: Record<string, unknown>,
    acknowledgedAt: string,
  ): Promise<void> {
    const command = await this.getFencedCommand(commandId, lease, acknowledgedAt);
    this.runCommands.set(command.id, {
      ...command,
      driver_ack: clone(driverAck),
      updated_at: acknowledgedAt,
    });
  }

  async markRunCommandApplied(
    commandId: string,
    lease: { workerId: string; leaseToken: string },
    appliedAt: string,
    driverAck: Record<string, unknown>,
  ): Promise<void> {
    const command = await this.getFencedCommand(commandId, lease, appliedAt);
    this.runCommands.set(command.id, {
      ...command,
      status: 'applied',
      applied_at: appliedAt,
      driver_ack: clone(driverAck),
      updated_at: appliedAt,
    });
  }

  async markRunCommandFailed(
    commandId: string,
    lease: { workerId: string; leaseToken: string },
    failureReason: string,
    failedAt: string,
  ): Promise<void> {
    const command = await this.getFencedCommand(commandId, lease, failedAt);
    this.runCommands.set(command.id, {
      ...command,
      status: 'failed',
      failure_reason: failureReason,
      updated_at: failedAt,
    });
  }

  async supersedePendingRunCommands(
    runSessionId: string,
    commandTypes: RunCommand['command_type'][],
    now: string,
  ): Promise<void> {
    this.supersedePendingRunCommandsUnfenced(runSessionId, commandTypes, now);
  }

  async supersedePendingRunCommandsForWorker(
    runSessionId: string,
    commandTypes: RunCommand['command_type'][],
    lease: { workerId: string; leaseToken: string },
    now: string,
  ): Promise<void> {
    await this.assertActiveRunWorkerLease(runSessionId, lease.workerId, lease.leaseToken, now);
    this.supersedePendingRunCommandsUnfenced(runSessionId, commandTypes, now);
  }

  private supersedePendingRunCommandsUnfenced(
    runSessionId: string,
    commandTypes: RunCommand['command_type'][],
    now: string,
  ): void {
    for (const command of valuesFor(this.runCommands)) {
      if (
        command.run_session_id === runSessionId &&
        command.status === 'pending' &&
        commandTypes.includes(command.command_type)
      ) {
        this.runCommands.set(command.id, { ...command, status: 'superseded', updated_at: now });
      }
    }
  }

  async claimRunWorkerLease(input: {
    run_session_id: string;
    worker_id: string;
    lease_token: string;
    now: string;
    expires_at: string;
  }): Promise<RunWorkerLease> {
    const existing = this.runWorkerLeases.get(input.run_session_id);
    if (
      existing !== undefined &&
      existing.status === 'active' &&
      existing.expires_at > input.now &&
      existing.worker_id !== input.worker_id
    ) {
      throw invalidLease(input.run_session_id);
    }

    const lease: RunWorkerLease = {
      id: existing?.id ?? `${input.run_session_id}:${input.worker_id}:${input.lease_token}`,
      run_session_id: input.run_session_id,
      worker_id: input.worker_id,
      lease_token: input.lease_token,
      heartbeat_at: input.now,
      expires_at: input.expires_at,
      status: 'active',
    };

    this.runWorkerLeases.set(input.run_session_id, clone(lease));
    return clone(lease);
  }

  async heartbeatRunWorkerLease(
    runSessionId: string,
    workerId: string,
    leaseToken: string,
    heartbeatAt: string,
    expiresAt: string,
  ): Promise<void> {
    await this.assertActiveRunWorkerLease(runSessionId, workerId, leaseToken, heartbeatAt);
    const lease = this.runWorkerLeases.get(runSessionId)!;
    this.runWorkerLeases.set(runSessionId, { ...lease, heartbeat_at: heartbeatAt, expires_at: expiresAt });
  }

  async getRunWorkerLease(runSessionId: string): Promise<RunWorkerLease | undefined> {
    return this.cloneMaybe(this.runWorkerLeases.get(runSessionId));
  }

  async releaseRunWorkerLease(runSessionId: string, workerId: string, leaseToken: string, releasedAt: string): Promise<void> {
    await this.assertActiveRunWorkerLease(runSessionId, workerId, leaseToken, releasedAt);
    const lease = this.runWorkerLeases.get(runSessionId)!;
    this.runWorkerLeases.set(runSessionId, { ...lease, heartbeat_at: releasedAt, status: 'released' });
  }

  async assertActiveRunWorkerLease(
    runSessionId: string,
    workerId: string,
    leaseToken: string,
    now: string,
  ): Promise<void> {
    const lease = this.runWorkerLeases.get(runSessionId);
    if (
      lease === undefined ||
      lease.status !== 'active' ||
      lease.worker_id !== workerId ||
      lease.lease_token !== leaseToken ||
      lease.expires_at <= now
    ) {
      throw invalidLease(runSessionId);
    }
  }

  async withActiveRunWorkerLease<T>(
    runSessionId: string,
    lease: { workerId: string; leaseToken: string; now: string },
    write: (repository: P0Repository) => Promise<T>,
  ): Promise<T> {
    await this.assertActiveRunWorkerLease(runSessionId, lease.workerId, lease.leaseToken, lease.now);
    const result = await write(this);
    await this.assertActiveRunWorkerLease(runSessionId, lease.workerId, lease.leaseToken, lease.now);
    return result;
  }

  async saveReviewPacket(reviewPacket: ReviewPacket): Promise<void> {
    if (isOpenReviewPacketStatus(reviewPacket.status)) {
      const existingOpen = await this.findOpenReviewPacketForPackage(reviewPacket.execution_package_id);
      if (existingOpen !== undefined && existingOpen.id !== reviewPacket.id) {
        throw new DomainError(
          'INVALID_TRANSITION',
          `Package ${reviewPacket.execution_package_id} already has open review packet ${existingOpen.id}`,
        );
      }
    }
    this.reviewPackets.set(reviewPacket.id, clone(reviewPacket));
  }

  async getReviewPacket(reviewPacketId: string): Promise<ReviewPacket | undefined> {
    return this.cloneMaybe(this.reviewPackets.get(reviewPacketId));
  }

  async listReviewPacketsForPackage(executionPackageId: string): Promise<ReviewPacket[]> {
    return valuesFor(this.reviewPackets)
      .filter((reviewPacket) => reviewPacket.execution_package_id === executionPackageId)
      .sort(byCreatedAt);
  }

  async findOpenReviewPacketForPackage(executionPackageId: string): Promise<ReviewPacket | undefined> {
    const openReviewPacket = valuesFor(this.reviewPackets)
      .filter(
        (reviewPacket) =>
          reviewPacket.execution_package_id === executionPackageId && isOpenReviewPacketStatus(reviewPacket.status),
      )
      .sort(byCreatedAt)[0];

    return this.cloneMaybe(openReviewPacket);
  }

  async resolveAutomationProjectSettings(
    input: ResolveAutomationProjectSettingsInput,
  ): Promise<AutomationProjectSettings> {
    const key = this.automationSettingsKey(input.project_id, input.repo_id);
    const existing = this.automationProjectSettings.get(key);
    if (existing !== undefined) {
      return clone(existing);
    }

    const preset = 'off';
    const capabilities = automationCapabilitiesForPreset(preset);
    return {
      id: `default:${key}`,
      project_id: input.project_id,
      ...(input.repo_id === undefined ? {} : { repo_id: input.repo_id }),
      preset,
      capabilities_json: capabilities,
      capability_fingerprint: capabilityFingerprint(capabilities),
      scope_type: input.repo_id === undefined ? 'project' : 'repo',
      version: 0,
      evidence_refs: [],
    };
  }

  async setAutomationProjectSettings(input: SetAutomationProjectSettingsInput): Promise<AutomationProjectSettings> {
    return this.objectLocks.withLock(`automation-settings:${this.automationSettingsKey(input.project_id, input.repo_id)}`, () =>
      this.setAutomationProjectSettingsUnlocked(input),
    );
  }

  async disableAutomationProjectSettings(
    input: DisableAutomationProjectSettingsInput,
  ): Promise<AutomationProjectSettings> {
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
    const scopeKeys = new Set(await this.manualHoldScopeKeysFor(input));
    return valuesFor(this.manualPathHolds)
      .filter((hold) => hold.status === 'active' && scopeKeys.has(hold.scope_key))
      .sort(byCreatedAtForRequestedAt);
  }

  async getManualPathHold(holdId: string): Promise<ManualPathHold | undefined> {
    return this.cloneMaybe(this.manualPathHolds.get(holdId));
  }

  async requestManualPathHold(input: RequestManualPathHoldInput): Promise<ManualPathHold> {
    return this.objectLocks.withLocks(this.manualPathHoldLockKeys(input), () => this.requestManualPathHoldUnlocked(input));
  }

  private async requestManualPathHoldUnlocked(input: RequestManualPathHoldInput): Promise<ManualPathHold> {
    const replayedHoldId = this.manualPathHoldIdempotency.get(input.idempotency_key);
    if (replayedHoldId !== undefined) {
      const replayed = this.manualPathHolds.get(replayedHoldId);
      if (replayed !== undefined) {
        return clone(replayed);
      }
    }
    if (input.source_automation_action_id !== undefined) {
      const sourceHoldId = this.manualPathHoldSourceActions.get(input.source_automation_action_id);
      if (sourceHoldId !== undefined) {
        const replayed = this.manualPathHolds.get(sourceHoldId);
        if (replayed !== undefined) {
          this.manualPathHoldIdempotency.set(input.idempotency_key, sourceHoldId);
          return clone(replayed);
        }
      }
    }

    this.assertManualScopeKey(input);
    const existingActive = valuesFor(this.manualPathHolds).find(
      (hold) =>
        hold.status === 'active' &&
        hold.object_type === input.object_type &&
        hold.object_id === input.object_id &&
        hold.scope_key === input.scope_key,
    );
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
      evidence_refs: clone(input.evidence_refs),
      requested_by: input.requested_by,
      requested_at: input.requested_at,
      ...(input.metadata_json === undefined ? {} : { metadata_json: clone(input.metadata_json) }),
    };
    this.manualPathHolds.set(hold.id, clone(hold));
    this.manualPathHoldIdempotency.set(input.idempotency_key, hold.id);
    if (hold.source_automation_action_id !== undefined) {
      this.manualPathHoldSourceActions.set(hold.source_automation_action_id, hold.id);
    }
    return hold;
  }

  async resolveManualPathHold(input: ResolveManualPathHoldInput): Promise<ManualPathHold> {
    const hold = this.manualPathHolds.get(input.hold_id);
    if (hold === undefined) {
      throw new DomainError('INVALID_TRANSITION', `Manual hold ${input.hold_id} does not exist`);
    }
    if (hold.status !== 'active') {
      if (hold.status === 'resolved' && hold.resolved_by === input.resolved_by && hold.resolution === input.resolution) {
        return clone(hold);
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
    this.manualPathHolds.set(resolved.id, clone(resolved));
    return clone(resolved);
  }

  async claimCommandIdempotency(input: ClaimCommandIdempotencyInput): Promise<CommandIdempotencyRecord> {
    return this.objectLocks.withLock(`command-idempotency:${input.idempotency_key}`, () =>
      this.claimCommandIdempotencyUnlocked(input),
    );
  }

  async renewCommandIdempotency(input: RenewCommandIdempotencyInput): Promise<CommandIdempotencyRecord> {
    return this.objectLocks.withLock(`command-idempotency:${input.idempotency_key}`, () =>
      this.renewCommandIdempotencyUnlocked(input),
    );
  }

  private async renewCommandIdempotencyUnlocked(input: RenewCommandIdempotencyInput): Promise<CommandIdempotencyRecord> {
    const record = this.getClaimedCommandIdempotency(input.idempotency_key, input.claim_token);
    const renewed = {
      ...record,
      locked_until: input.locked_until,
      last_heartbeat_at: input.last_heartbeat_at,
      updated_at: input.last_heartbeat_at,
    };
    this.commandIdempotencyRecords.set(record.idempotency_key, clone(renewed));
    return clone(renewed);
  }

  async completeCommandIdempotency(input: FinishCommandIdempotencyInput): Promise<CommandIdempotencyRecord> {
    return this.objectLocks.withLock(`command-idempotency:${input.idempotency_key}`, async () =>
      this.finishCommandIdempotency(input, 'succeeded'),
    );
  }

  async failCommandIdempotency(input: FinishCommandIdempotencyInput): Promise<CommandIdempotencyRecord> {
    return this.objectLocks.withLock(`command-idempotency:${input.idempotency_key}`, async () =>
      this.finishCommandIdempotency(input, 'failed'),
    );
  }

  async blockCommandIdempotency(input: FinishCommandIdempotencyInput): Promise<CommandIdempotencyRecord> {
    return this.objectLocks.withLock(`command-idempotency:${input.idempotency_key}`, async () =>
      this.finishCommandIdempotency(input, 'blocked'),
    );
  }

  async claimExecutionPackageGenerationRun(
    input: ClaimExecutionPackageGenerationRunInput,
  ): Promise<ExecutionPackageGenerationRun> {
    return this.objectLocks.withLock(`package-generation:${input.plan_revision_id}`, () =>
      this.claimExecutionPackageGenerationRunUnlocked(input),
    );
  }

  private async claimExecutionPackageGenerationRunUnlocked(
    input: ClaimExecutionPackageGenerationRunInput,
  ): Promise<ExecutionPackageGenerationRun> {
    const existing = this.generationRunFor(input.plan_revision_id, input.generation_key);
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
        this.executionPackageGenerationRuns.set(reclaimed.execution_package_set_id, clone(reclaimed));
        return clone(reclaimed);
      }
      if (existing.status === 'running') {
        throw new DomainError('INVALID_TRANSITION', `Package generation ${input.generation_key} already has an active claim`);
      }
      return clone(existing);
    }

    const currentSucceeded = valuesFor(this.executionPackageGenerationRuns).find(
      (run) => run.plan_revision_id === input.plan_revision_id && run.status === 'succeeded',
    );
    if (currentSucceeded !== undefined) {
      throw new DomainError(
        'INVALID_TRANSITION',
        `Plan revision ${input.plan_revision_id} already has current succeeded package generation`,
      );
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
    this.executionPackageGenerationRuns.set(run.execution_package_set_id, clone(run));
    return run;
  }

  async saveExecutionPackageGenerationPackage(input: SaveExecutionPackageGenerationPackageInput): Promise<void> {
    return this.objectLocks.withLock(`package-generation:${input.plan_revision_id}`, () =>
      this.saveExecutionPackageGenerationPackageUnlocked(input),
    );
  }

  private async saveExecutionPackageGenerationPackageUnlocked(
    input: SaveExecutionPackageGenerationPackageInput,
  ): Promise<void> {
    const run = this.getGenerationRun(input.execution_package_set_id, input.claim_token);
    if (run.plan_revision_id !== input.plan_revision_id || run.generation_key !== input.generation_key) {
      throw new DomainError('INVALID_TRANSITION', `Package generation ${input.execution_package_set_id} identity mismatch`);
    }
    const duplicate = [...this.executionPackageGenerationPackages.values()].find(
      (record) =>
        record.plan_revision_id === input.plan_revision_id &&
        record.generation_key === input.generation_key &&
        record.package_key === input.package_key &&
        record.execution_package_id !== input.execution_package_id,
    );
    if (duplicate !== undefined) {
      throw new DomainError('INVALID_TRANSITION', `Duplicate package_key ${input.package_key} for generation`);
    }
    const existing = this.executionPackageGenerationPackages.get(
      `${input.execution_package_set_id}:${input.execution_package_id}`,
    );
    if (
      existing !== undefined &&
      (existing.plan_revision_id !== input.plan_revision_id ||
        existing.generation_key !== input.generation_key ||
        existing.package_key !== input.package_key ||
        existing.sequence !== input.sequence ||
        existing.manifest_digest !== input.manifest_digest)
    ) {
      throw new DomainError('INVALID_TRANSITION', `Package generation package ${input.execution_package_id} drift`);
    }
    const { claim_token: _claimToken, ...record } = input;
    this.executionPackageGenerationPackages.set(
      `${record.execution_package_set_id}:${record.execution_package_id}`,
      clone(record),
    );
  }

  async completeExecutionPackageGenerationRun(
    input: CompleteExecutionPackageGenerationRunInput,
  ): Promise<ExecutionPackageGenerationRun> {
    return this.objectLocks.withLock(`package-generation:${input.plan_revision_id}`, () =>
      this.completeExecutionPackageGenerationRunUnlocked(input),
    );
  }

  private async completeExecutionPackageGenerationRunUnlocked(
    input: CompleteExecutionPackageGenerationRunInput,
  ): Promise<ExecutionPackageGenerationRun> {
    const run = this.getGenerationRun(input.execution_package_set_id, input.claim_token);
    if (run.plan_revision_id !== input.plan_revision_id) {
      throw new DomainError('INVALID_TRANSITION', `Package generation ${input.execution_package_set_id} plan mismatch`);
    }
    this.assertGenerationPackageManifestComplete(run);
    const completed: ExecutionPackageGenerationRun = {
      ...run,
      status: 'succeeded',
      version: run.version + 1,
      ...(input.result_json === undefined ? {} : { result_json: clone(input.result_json) }),
      completed_at: input.completed_at,
      updated_at: input.completed_at,
    };
    this.executionPackageGenerationRuns.set(completed.execution_package_set_id, clone(completed));
    return clone(completed);
  }

  async getExecutionPackageGenerationRun(input: {
    plan_revision_id: string;
    generation_key: string;
  }): Promise<ExecutionPackageGenerationRun | undefined> {
    return this.cloneMaybe(this.generationRunFor(input.plan_revision_id, input.generation_key));
  }

  async supersedeExecutionPackageGenerationRun(
    input: SupersedeExecutionPackageGenerationRunInput,
  ): Promise<ExecutionPackageGenerationRun> {
    return this.objectLocks.withLock(`package-generation:${input.plan_revision_id}`, () =>
      this.supersedeExecutionPackageGenerationRunUnlocked(input),
    );
  }

  private async supersedeExecutionPackageGenerationRunUnlocked(
    input: SupersedeExecutionPackageGenerationRunInput,
  ): Promise<ExecutionPackageGenerationRun> {
    const run = this.executionPackageGenerationRuns.get(input.execution_package_set_id);
    if (run === undefined || run.plan_revision_id !== input.plan_revision_id) {
      throw new DomainError('INVALID_TRANSITION', `Package generation ${input.execution_package_set_id} does not exist`);
    }
    if (run.version !== input.expected_version) {
      throw new DomainError('INVALID_TRANSITION', `Package generation ${input.execution_package_set_id} version mismatch`);
    }
    if (run.status !== 'succeeded') {
      throw new DomainError('INVALID_TRANSITION', `Package generation ${input.execution_package_set_id} is not current succeeded`);
    }
    const nextIndex =
      valuesFor(this.executionPackageGenerationRuns).filter((candidate) => candidate.plan_revision_id === input.plan_revision_id)
        .length + 1;
    const superseded: ExecutionPackageGenerationRun = {
      ...run,
      status: 'superseded',
      version: run.version + 1,
      superseded_by: input.superseded_by,
      superseded_at: input.superseded_at,
      superseded_reason: input.reason,
      supersede_command_id: input.supersede_command_id,
      evidence_refs: clone(input.evidence_refs),
      next_generation_key: `regenerate:${input.plan_revision_id}:${nextIndex}`,
      updated_at: input.superseded_at,
    };
    this.executionPackageGenerationRuns.set(superseded.execution_package_set_id, clone(superseded));
    return clone(superseded);
  }

  async createOrReplayAutomationActionRun(input: CreateOrReplayAutomationActionRunInput): Promise<AutomationActionRun> {
    return this.objectLocks.withLocks([`automation-action:${input.idempotency_key}`, `automation-action-id:${input.id}`], async () =>
      this.createOrReplayAutomationActionRunUnlocked(input),
    );
  }

  async claimNextAutomationActionRun(
    input: ClaimNextAutomationActionRunInput,
  ): Promise<AutomationActionRun | undefined> {
    return this.objectLocks.withLock('automation-action:claim-next', async () => {
      const candidates = valuesFor(this.automationActionRuns)
        .filter((actionRun) => this.isAutomationActionClaimable(actionRun, input.now))
        .filter((actionRun) => this.matchesAutomationActionClaimFilter(actionRun, input))
        .sort(this.compareAutomationActionClaimOrder);
      const selected = candidates.slice(0, input.limit)[0];
      if (selected === undefined) {
        return undefined;
      }
      const claimed = this.toRunningAutomationActionRun(selected, {
        claim_token: input.claim_token,
        locked_until: input.locked_until,
        now: input.now,
      });
      this.automationActionRuns.set(claimed.id, clone(claimed));
      return clone(claimed);
    });
  }

  async getClaimedAutomationActionRun(input: GetClaimedAutomationActionRunInput): Promise<AutomationActionRun> {
    return clone(this.getClaimedAutomationActionRunRecord(input.id, input.claim_token));
  }

  async latestCompletedProjectionActionRun(
    input: LatestCompletedProjectionActionRunInput,
  ): Promise<AutomationActionRun | undefined> {
    const matched = valuesFor(this.automationActionRuns)
      .filter(
        (actionRun) =>
          actionRun.action_type === 'project_runtime_snapshot' &&
          actionRun.status === 'succeeded' &&
          this.stablePolicyObservationIdentityMatches(actionRun.action_input_json, input),
      )
      .sort(
        (left, right) =>
          (right.finished_at ?? '').localeCompare(left.finished_at ?? '') ||
          (right.updated_at ?? '').localeCompare(left.updated_at ?? '') ||
          right.id.localeCompare(left.id),
      )[0];
    return matched === undefined ? undefined : clone(matched);
  }

  async claimAutomationActionRun(input: ClaimAutomationActionRunInput): Promise<AutomationActionRun> {
    return this.objectLocks.withLocks(
      ['automation-action:claim-next', `automation-action:${input.idempotency_key}`, `automation-action-id:${input.id}`],
      () => this.claimAutomationActionRunUnlocked(input),
    );
  }

  async markAutomationActionGatePending(input: MarkAutomationActionGatePendingInput): Promise<AutomationActionRun> {
    return this.objectLocks.withLocks(['automation-action:claim-next', `automation-action:${input.idempotency_key}`], () =>
      this.markAutomationActionGatePendingUnlocked(input),
    );
  }

  private async markAutomationActionGatePendingUnlocked(
    input: MarkAutomationActionGatePendingInput,
  ): Promise<AutomationActionRun> {
    const actionRun = this.getClaimedAutomationActionRunRecord(input.id, input.claim_token);
    if (actionRun.idempotency_key !== input.idempotency_key) {
      throw new DomainError('INVALID_TRANSITION', `Automation action ${input.id} idempotency key mismatch`);
    }
    const pending: AutomationActionRun = {
      ...actionRun,
      status: 'gate_pending',
      reason: input.reason,
      ...(input.result_json === undefined ? {} : { result_json: clone(input.result_json) }),
      ...(input.next_attempt_at === undefined ? {} : { next_attempt_at: input.next_attempt_at }),
      updated_at: input.now,
    };
    this.automationActionRuns.set(pending.id, clone(pending));
    return clone(pending);
  }

  async completeAutomationActionRun(input: CompleteAutomationActionRunInput): Promise<AutomationActionRun> {
    return this.objectLocks.withLocks(['automation-action:claim-next', `automation-action:${input.idempotency_key}`], () =>
      this.completeAutomationActionRunUnlocked(input),
    );
  }

  private async completeAutomationActionRunUnlocked(input: CompleteAutomationActionRunInput): Promise<AutomationActionRun> {
    const actionRun = this.getClaimedAutomationActionRunRecord(input.id, input.claim_token);
    if (actionRun.idempotency_key !== input.idempotency_key) {
      throw new DomainError('INVALID_TRANSITION', `Automation action ${input.id} idempotency key mismatch`);
    }
    const completed: AutomationActionRun = {
      ...actionRun,
      status: input.status,
      ...(input.result_json === undefined ? {} : { result_json: clone(input.result_json) }),
      ...(input.retryable === undefined ? {} : { retryable: input.retryable }),
      ...(input.next_attempt_at === undefined ? {} : { next_attempt_at: input.next_attempt_at }),
      finished_at: input.finished_at,
      updated_at: input.finished_at,
    };
    this.automationActionRuns.set(completed.id, clone(completed));
    return clone(completed);
  }

  async listClaimableAutomationActionRuns(input: ListClaimableAutomationActionRunsInput): Promise<AutomationActionRun[]> {
    return valuesFor(this.automationActionRuns)
      .filter((actionRun) => this.isAutomationActionClaimable(actionRun, input.now))
      .sort(this.compareAutomationActionClaimOrder)
      .map(redactAutomationActionClaim)
      .slice(0, input.limit);
  }

  async getRuntimeSnapshotData(): Promise<RuntimeSnapshotRepositoryData> {
    const projects = valuesFor(this.projects).sort(byCreatedAtThenId);
    const repos = valuesFor(this.projectRepos)
      .filter((repo) => repo.status === 'active')
      .sort(byCreatedAtThenId);
    const projectRows = await Promise.all(
      projects.map(async (project) => {
        const settings = await this.resolveAutomationProjectSettings({ project_id: project.id });
        return {
          project_id: project.id,
          automation_scope: `project:${project.id}` as const,
          automation_settings_version: settings.version,
          capability_fingerprint: settings.capability_fingerprint,
        };
      }),
    );
    const repoRows = await Promise.all(
      repos.map(async (repo) => {
        const settings = await this.resolveAutomationProjectSettings({ project_id: repo.project_id, repo_id: repo.repo_id });
        return {
          project_id: repo.project_id,
          repo_id: repo.repo_id,
          automation_scope: `repo:${repo.project_id}:${repo.repo_id}` as const,
          automation_settings_version: settings.version,
          capability_fingerprint: settings.capability_fingerprint,
          daemon_internal_local_path: repo.local_path,
        };
      }),
    );

    return {
      projects: projectRows,
      repos: repoRows,
      work_items_requiring_plan: await this.runtimeSnapshotWorkItemsRequiringPlan(repos),
      plan_revisions_requiring_packages: await this.runtimeSnapshotPlanRevisionsRequiringPackages(repos),
      run_enqueue_disabled_packages: this.runtimeSnapshotRunEnqueueDisabledPackages(repos),
      active_holds: this.runtimeSnapshotActiveHolds(),
      recent_action_runs: valuesFor(this.automationActionRuns)
        .sort(this.compareAutomationActionRecency)
        .slice(0, 50)
        .map(redactAutomationActionClaim),
      policy_projection_action_runs: valuesFor(this.automationActionRuns)
        .filter((actionRun) => actionRun.action_type === 'project_runtime_snapshot' && actionRun.status === 'succeeded')
        .sort(this.compareAutomationActionRecency)
        .map(redactAutomationActionClaim),
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

    this.releases.set(normalized.id, clone(normalized));
    this.replaceReleaseWorkItems(normalized.id, normalized.work_item_ids);
    this.replaceReleaseExecutionPackages(normalized.id, normalized.execution_package_ids);
  }

  async getRelease(releaseId: string): Promise<Release | undefined> {
    const release = this.releases.get(releaseId);
    return release === undefined ? undefined : this.hydrateReleaseLinks(release);
  }

  async listReleasesForProject(projectId: string): Promise<Release[]> {
    const releases = valuesFor(this.releases).filter((release) => release.project_id === projectId).sort(byCreatedAt);
    return Promise.all(releases.map((release) => this.hydrateReleaseLinks(release)));
  }

  async saveReleaseWorkItem(releaseWorkItem: ReleaseWorkItem): Promise<void> {
    const key = `${releaseWorkItem.release_id}:${releaseWorkItem.work_item_id}`;
    const existingOrder = this.releaseWorkItemOrders.get(key);
    const order =
      existingOrder ??
      Math.max(
        -1,
        ...[...this.releaseWorkItemOrders.entries()]
          .filter(([entryKey]) => entryKey.startsWith(`${releaseWorkItem.release_id}:`))
          .map(([, value]) => value),
      ) + 1;
    this.releaseWorkItems.set(key, clone(releaseWorkItem));
    this.releaseWorkItemOrders.set(key, order);
  }

  async listReleaseWorkItems(releaseId: string): Promise<ReleaseWorkItem[]> {
    return valuesFor(this.releaseWorkItems)
      .filter((releaseWorkItem) => releaseWorkItem.release_id === releaseId)
      .sort(
        (left, right) =>
          (this.releaseWorkItemOrders.get(`${left.release_id}:${left.work_item_id}`) ?? 0) -
            (this.releaseWorkItemOrders.get(`${right.release_id}:${right.work_item_id}`) ?? 0) ||
          left.work_item_id.localeCompare(right.work_item_id),
      );
  }

  async saveReleaseExecutionPackage(releaseExecutionPackage: ReleaseExecutionPackage): Promise<void> {
    const key = `${releaseExecutionPackage.release_id}:${releaseExecutionPackage.execution_package_id}`;
    const existingOrder = this.releaseExecutionPackageOrders.get(key);
    const order =
      existingOrder ??
      Math.max(
        -1,
        ...[...this.releaseExecutionPackageOrders.entries()]
          .filter(([entryKey]) => entryKey.startsWith(`${releaseExecutionPackage.release_id}:`))
          .map(([, value]) => value),
      ) + 1;
    this.releaseExecutionPackages.set(key, clone(releaseExecutionPackage));
    this.releaseExecutionPackageOrders.set(key, order);
  }

  async listReleaseExecutionPackages(releaseId: string): Promise<ReleaseExecutionPackage[]> {
    return valuesFor(this.releaseExecutionPackages).filter(
      (releaseExecutionPackage) => releaseExecutionPackage.release_id === releaseId,
    ).sort(
      (left, right) =>
        (this.releaseExecutionPackageOrders.get(`${left.release_id}:${left.execution_package_id}`) ?? 0) -
          (this.releaseExecutionPackageOrders.get(`${right.release_id}:${right.execution_package_id}`) ?? 0) ||
        left.execution_package_id.localeCompare(right.execution_package_id),
    );
  }

  async saveReleaseEvidence(releaseEvidence: ReleaseEvidence): Promise<void> {
    this.releaseEvidences.set(releaseEvidence.id, clone(releaseEvidence));
  }

  async getReleaseEvidence(releaseEvidenceId: string): Promise<ReleaseEvidence | undefined> {
    return this.cloneMaybe(this.releaseEvidences.get(releaseEvidenceId));
  }

  async listReleaseEvidences(releaseId: string): Promise<ReleaseEvidence[]> {
    return valuesFor(this.releaseEvidences)
      .filter((releaseEvidence) => releaseEvidence.release_id === releaseId)
      .sort(byCreatedAtThenId);
  }

  async appendObjectEvent(objectEvent: ObjectEvent): Promise<void> {
    if (!this.objectEvents.has(objectEvent.id)) {
      this.objectEvents.set(objectEvent.id, clone(objectEvent));
    }
  }

  async listObjectEvents(objectId: string, objectType?: string): Promise<ObjectEvent[]> {
    return valuesFor(this.objectEvents)
      .filter(
        (objectEvent) =>
          objectEvent.object_id === objectId && (objectType === undefined || objectEvent.object_type === objectType),
      )
      .sort(byCreatedAt);
  }

  async appendStatusHistory(statusHistory: StatusHistory): Promise<void> {
    if (!this.statusHistories.has(statusHistory.id)) {
      this.statusHistories.set(statusHistory.id, clone(statusHistory));
    }
  }

  async listStatusHistory(objectId: string, objectType?: string): Promise<StatusHistory[]> {
    return valuesFor(this.statusHistories)
      .filter(
        (statusHistory) =>
          statusHistory.object_id === objectId && (objectType === undefined || statusHistory.object_type === objectType),
      )
      .sort(byCreatedAt);
  }

  async saveArtifact(artifact: Artifact): Promise<void> {
    this.artifacts.set(artifact.id, clone(artifact));
  }

  async listArtifactsForObject(objectType: string, objectId: string): Promise<Artifact[]> {
    return valuesFor(this.artifacts)
      .filter((artifact) => artifact.object_type === objectType && artifact.object_id === objectId)
      .sort(byCreatedAt);
  }

  async saveDecision(decision: Decision): Promise<void> {
    this.decisions.set(decision.id, clone(decision));
  }

  async listDecisionsForObject(objectType: string, objectId: string): Promise<Decision[]> {
    return valuesFor(this.decisions)
      .filter((decision) => decision.object_type === objectType && decision.object_id === objectId)
      .sort(byCreatedAt);
  }

  async saveTraceEvent(traceEvent: TraceEventRecord): Promise<void> {
    const existing = this.traceEvents.get(traceEvent.id);
    this.traceEvents.set(traceEvent.id, clone({ ...traceEvent, created_at: existing?.created_at ?? traceEvent.created_at }));
  }

  async listTraceEventsForSubject(subjectType: string, subjectId: string): Promise<TraceEventRecord[]> {
    return valuesFor(this.traceEvents)
      .filter((traceEvent) => traceEvent.subject_type === subjectType && traceEvent.subject_id === subjectId)
      .sort(byCreatedAtThenId);
  }

  async saveTraceLink(traceLink: TraceLinkRecord): Promise<void> {
    if (!this.traceLinks.has(traceLink.id)) {
      this.traceLinks.set(traceLink.id, clone(traceLink));
    }
  }

  async listTraceLinks(traceEventId: string): Promise<TraceLinkRecord[]> {
    return valuesFor(this.traceLinks)
      .filter((traceLink) => traceLink.trace_event_id === traceEventId)
      .sort(byCreatedAtThenId);
  }

  async saveTraceArtifactRef(traceArtifactRef: TraceArtifactRefRecord): Promise<void> {
    if (!this.traceArtifactRefs.has(traceArtifactRef.id)) {
      this.traceArtifactRefs.set(traceArtifactRef.id, clone(traceArtifactRef));
    }
  }

  async listTraceArtifactRefs(traceEventId: string): Promise<TraceArtifactRefRecord[]> {
    return valuesFor(this.traceArtifactRefs)
      .filter((traceArtifactRef) => traceArtifactRef.trace_event_id === traceEventId)
      .sort(byCreatedAtThenId);
  }

  private cloneMaybe<T>(value: T | undefined): T | undefined {
    return value === undefined ? undefined : clone(value);
  }

  private async setAutomationProjectSettingsUnlocked(
    input: SetAutomationProjectSettingsInput,
  ): Promise<AutomationProjectSettings> {
    assertAutomationCapabilityActor(input.actor);
    const current = await this.resolveAutomationProjectSettings(input);
    if (current.version !== input.expected_version) {
      throw new DomainError('INVALID_TRANSITION', `Automation settings version mismatch for ${current.project_id}`);
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
      evidence_refs: clone(input.evidence_refs),
    };
    this.automationProjectSettings.set(this.automationSettingsKey(input.project_id, input.repo_id), clone(settings));
    return settings;
  }

  private async claimCommandIdempotencyUnlocked(
    input: ClaimCommandIdempotencyInput,
  ): Promise<CommandIdempotencyRecord> {
    const existing = this.commandIdempotencyRecords.get(input.idempotency_key);
    if (existing !== undefined) {
      this.assertCommandIdempotencyMatches(existing, input);
      if (terminalCommandStatuses.has(existing.status)) {
        return clone(existing);
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
      ...(input.precondition_json === undefined ? {} : { precondition_json: clone(input.precondition_json) }),
      ...(input.precondition_fingerprint === undefined
        ? {}
        : { precondition_fingerprint: input.precondition_fingerprint }),
      ...(input.actor_scope === undefined ? {} : { actor_scope: input.actor_scope }),
      status: 'running',
      locked_until: input.locked_until,
      last_heartbeat_at: input.now,
      claim_token: input.claim_token,
      ...(input.actor_scope === undefined ? {} : { created_by: input.actor_scope }),
      started_at: input.now,
      created_at: existing?.created_at ?? input.now,
      updated_at: input.now,
    };
    this.commandIdempotencyRecords.set(input.idempotency_key, clone(record));
    return record;
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

  private assertGenerationPackageManifestComplete(run: ExecutionPackageGenerationRun): void {
    const packages = [...this.executionPackageGenerationPackages.values()]
      .filter((record) => record.execution_package_set_id === run.execution_package_set_id)
      .sort((left, right) => left.sequence - right.sequence || left.package_key.localeCompare(right.package_key));
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
  }

  private createOrReplayAutomationActionRunUnlocked(input: CreateOrReplayAutomationActionRunInput): AutomationActionRun {
    const existingId = this.automationActionRunIdempotency.get(input.idempotency_key);
    const existing = existingId === undefined ? undefined : this.automationActionRuns.get(existingId);
    if (existing !== undefined) {
      this.assertAutomationActionReplayMatches(existing, input);
      return clone(redactAutomationActionClaim(existing));
    }
    this.assertAutomationActionIdIsUnused(input.id, input.idempotency_key);

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
      action_input_json: clone(input.action_input_json),
      status: 'pending',
      attempt: 0,
      ...(input.created_by === undefined ? {} : { created_by: input.created_by }),
      created_at: input.now,
      updated_at: input.now,
    };
    this.automationActionRuns.set(actionRun.id, clone(actionRun));
    this.automationActionRunIdempotency.set(actionRun.idempotency_key, actionRun.id);
    return clone(actionRun);
  }

  private async claimAutomationActionRunUnlocked(input: ClaimAutomationActionRunInput): Promise<AutomationActionRun> {
    if (input.precondition_fingerprint === undefined || input.action_input_json === undefined) {
      throw new DomainError(
        'INVALID_TRANSITION',
        `Automation action ${input.idempotency_key} requires precondition fingerprint and action input`,
      );
    }
    const existingId = this.automationActionRunIdempotency.get(input.idempotency_key);
    const existing = existingId === undefined ? undefined : this.automationActionRuns.get(existingId);
    if (existing !== undefined) {
      this.assertAutomationActionIdentityMatches(existing, input);
      if (!this.isAutomationActionClaimable(existing, input.now)) {
        if (existing.status === 'running') {
          throw new DomainError('INVALID_TRANSITION', `Automation action ${input.idempotency_key} already has an active claim`);
        }
        return clone(redactAutomationActionClaim(existing));
      }
    } else {
      this.assertAutomationActionIdIsUnused(input.id, input.idempotency_key);
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
      action_input_json: clone(input.action_input_json),
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
    this.automationActionRuns.set(actionRun.id, clone(actionRun));
    this.automationActionRunIdempotency.set(actionRun.idempotency_key, actionRun.id);
    return actionRun;
  }

  private assertAutomationActionIdIsUnused(id: string, idempotencyKey: string): void {
    const existing = this.automationActionRuns.get(id);
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
      action_input_json: clone(actionRun.action_input_json),
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
      const mismatched =
        existing.action_type !== input.action_type ||
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
    const stableIdentity = stablePolicyObservationIdentity(actionInputJson);
    return (
      stableIdentity.repo_id === input.repo_id &&
      stableIdentity.policy_status === input.policy_status &&
      stableIdentity.policy_digest === input.policy_digest &&
      stableIdentity.parser_version === input.parser_version &&
      stableIdentity.reason_code === input.reason_code
    );
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

  private compareAutomationActionClaimOrder(left: AutomationActionRun, right: AutomationActionRun): number {
    return (
      compareTimestamp(left.next_attempt_at ?? left.created_at, right.next_attempt_at ?? right.created_at) ||
      compareTimestamp(left.created_at, right.created_at) ||
      left.id.localeCompare(right.id)
    );
  }

  private compareAutomationActionRecency(left: AutomationActionRun, right: AutomationActionRun): number {
    return (
      compareTimestamp(right.finished_at ?? right.updated_at ?? right.created_at, left.finished_at ?? left.updated_at ?? left.created_at) ||
      right.id.localeCompare(left.id)
    );
  }

  private async runtimeSnapshotWorkItemsRequiringPlan(repos: ProjectRepo[]): Promise<RuntimeSnapshotTargetRow[]> {
    const targets: RuntimeSnapshotTargetRow[] = [];
    for (const workItem of valuesFor(this.workItems).sort(byCreatedAtThenId)) {
      if (isWorkItemAutomationTerminal(workItem) || workItem.current_plan_id !== undefined || workItem.current_spec_id === undefined) {
        continue;
      }
      const spec = this.specs.get(workItem.current_spec_id);
      const specRevisionId = spec?.approved_revision_id ?? spec?.current_revision_id ?? workItem.current_spec_revision_id;
      if (spec === undefined || spec.status !== 'approved' || specRevisionId === undefined) {
        continue;
      }
      const repo = repos.find((candidate) => candidate.project_id === workItem.project_id);
      if (repo === undefined) {
        continue;
      }
      const settings = await this.resolveAutomationProjectSettings({ project_id: workItem.project_id, repo_id: repo.repo_id });
      if (!settings.capabilities_json.canGeneratePlanDraft) {
        continue;
      }
      if (this.hasActiveManualHold([`work_item:${workItem.id}`, `spec_revision:${specRevisionId}`])) {
        continue;
      }
      targets.push({
        target_object_type: 'work_item',
        target_object_id: workItem.id,
        target_revision_id: specRevisionId,
        target_status: 'approved',
        project_id: workItem.project_id,
        repo_id: repo.repo_id,
        automation_scope: `repo:${workItem.project_id}:${repo.repo_id}`,
        ...this.latestMatchingActionFields('ensure_plan_draft', workItem.id, specRevisionId),
      });
    }
    return targets;
  }

  private async runtimeSnapshotPlanRevisionsRequiringPackages(repos: ProjectRepo[]): Promise<RuntimeSnapshotTargetRow[]> {
    const targets: RuntimeSnapshotTargetRow[] = [];
    for (const plan of valuesFor(this.plans).sort(byCreatedAtThenId)) {
      if (plan.status !== 'approved') {
        continue;
      }
      const planRevisionId = plan.approved_revision_id ?? plan.current_revision_id;
      if (planRevisionId === undefined || this.hasCurrentPackageGeneration(planRevisionId)) {
        continue;
      }
      const planRevision = this.planRevisions.get(planRevisionId);
      const workItem = planRevision === undefined ? undefined : this.workItems.get(planRevision.work_item_id);
      if (planRevision === undefined || workItem === undefined || isWorkItemAutomationTerminal(workItem)) {
        continue;
      }
      const repo = repos.find((candidate) => candidate.project_id === workItem.project_id);
      if (repo === undefined) {
        continue;
      }
      const settings = await this.resolveAutomationProjectSettings({ project_id: workItem.project_id, repo_id: repo.repo_id });
      if (!settings.capabilities_json.canGeneratePackageDrafts) {
        continue;
      }
      const generationKey = `default:${planRevisionId}`;
      if (
        this.hasActiveManualHold([
          `work_item:${workItem.id}`,
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
        repo_id: repo.repo_id,
        automation_scope: `repo:${workItem.project_id}:${repo.repo_id}`,
        generation_key: generationKey,
        ...this.latestMatchingActionFields('ensure_package_drafts', planRevisionId, generationKey),
      });
    }
    return targets;
  }

  private runtimeSnapshotRunEnqueueDisabledPackages(repos: ProjectRepo[]): RuntimeSnapshotTargetRow[] {
    return valuesFor(this.executionPackages)
      .filter(
        (executionPackage) =>
          executionPackage.phase === 'ready' &&
          repos.some((repo) => repo.project_id === executionPackage.project_id && repo.repo_id === executionPackage.repo_id),
      )
      .sort(byCreatedAtThenId)
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

  private runtimeSnapshotActiveHolds() {
    return valuesFor(this.manualPathHolds)
      .filter((hold) => hold.status === 'active')
      .sort((left, right) => compareTimestamp(left.requested_at, right.requested_at) || left.id.localeCompare(right.id))
      .map((hold) => ({
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

  private hasCurrentPackageGeneration(planRevisionId: string): boolean {
    return valuesFor(this.executionPackageGenerationRuns).some(
      (run) => run.plan_revision_id === planRevisionId && (run.status === 'pending' || run.status === 'running' || run.status === 'succeeded'),
    );
  }

  private hasActiveManualHold(scopeKeys: string[]): boolean {
    const scopeKeySet = new Set(scopeKeys);
    return valuesFor(this.manualPathHolds).some((hold) => hold.status === 'active' && scopeKeySet.has(hold.scope_key));
  }

  private latestMatchingActionFields(
    actionType: string,
    targetObjectId: string,
    targetRevisionId: string,
  ): Pick<RuntimeSnapshotTargetRow, 'latest_matching_action_status' | 'blocked_reason_code' | 'blocked_summary'> {
    const actionRun = valuesFor(this.automationActionRuns)
      .filter(
        (candidate) =>
          candidate.action_type === actionType &&
          candidate.target_object_id === targetObjectId &&
          candidate.target_revision_id === targetRevisionId,
      )
      .sort(this.compareAutomationActionRecency)[0];
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

  private automationSettingsKey(projectId: string, repoId: string | undefined): string {
    return repoId === undefined ? `project:${projectId}` : `repo:${projectId}:${repoId}`;
  }

  private manualPathHoldLockKeys(input: RequestManualPathHoldInput): string[] {
    return [
      `manual-hold-idem:${input.idempotency_key}`,
      ...(input.source_automation_action_id === undefined ? [] : [`manual-hold-source:${input.source_automation_action_id}`]),
    ];
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
      const executionPackage = this.executionPackages.get(input.object_id);
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
        for (const hold of this.manualPathHolds.values()) {
          if (hold.status === 'active' && hold.object_type === 'release_gate' && hold.object_id === input.object_id) {
            keys.push(hold.scope_key);
          }
        }
      }
    }
    if (input.object_type === 'run_session') {
      const runSession = this.runSessions.get(input.object_id);
      if (runSession !== undefined) {
        keys.push(...(await this.manualHoldScopeKeysFor({ object_type: 'execution_package', object_id: runSession.execution_package_id })));
      }
    }
    if (input.object_type === 'review_packet') {
      const reviewPacket = this.reviewPackets.get(input.object_id);
      if (reviewPacket !== undefined) {
        keys.push(...(await this.manualHoldScopeKeysFor({ object_type: 'execution_package', object_id: reviewPacket.execution_package_id })));
      }
    }
    return [...new Set(keys)];
  }

  private getClaimedCommandIdempotency(idempotencyKey: string, claimToken: string): CommandIdempotencyRecord {
    const record = this.commandIdempotencyRecords.get(idempotencyKey);
    if (record === undefined || record.status !== 'running' || record.claim_token !== claimToken) {
      throw new DomainError('INVALID_TRANSITION', `Command idempotency record ${idempotencyKey} is not claimed`);
    }
    return clone(record);
  }

  private finishCommandIdempotency(
    input: FinishCommandIdempotencyInput,
    status: CommandIdempotencyRecord['status'],
  ): CommandIdempotencyRecord {
    const record = this.getClaimedCommandIdempotency(input.idempotency_key, input.claim_token);
    const finished: CommandIdempotencyRecord = {
      ...record,
      status,
      ...(input.result_json === undefined ? {} : { result_json: clone(input.result_json) }),
      finished_at: input.finished_at,
      updated_at: input.finished_at,
    };
    this.commandIdempotencyRecords.set(finished.idempotency_key, clone(finished));
    return clone(finished);
  }

  private generationRunFor(planRevisionId: string, generationKey: string): ExecutionPackageGenerationRun | undefined {
    return valuesFor(this.executionPackageGenerationRuns).find(
      (run) => run.plan_revision_id === planRevisionId && run.generation_key === generationKey,
    );
  }

  private getGenerationRun(executionPackageSetId: string, claimToken: string): ExecutionPackageGenerationRun {
    const run = this.executionPackageGenerationRuns.get(executionPackageSetId);
    if (run === undefined || run.status !== 'running' || run.claim_token !== claimToken) {
      throw new DomainError('INVALID_TRANSITION', `Package generation ${executionPackageSetId} is not claimed`);
    }
    return clone(run);
  }

  private getClaimedAutomationActionRunRecord(id: string, claimToken: string): AutomationActionRun {
    const actionRun = this.automationActionRuns.get(id);
    if (actionRun === undefined || actionRun.status !== 'running' || actionRun.claim_token !== claimToken) {
      throw new DomainError('INVALID_TRANSITION', `Automation action ${id} is not claimed`);
    }
    return clone(actionRun);
  }

  private snapshotTransactionalMaps(): Array<readonly [Map<string, unknown>, Map<string, unknown>]> {
    return this.transactionalMaps().map((records) => [
      records,
      new Map([...records.entries()].map(([key, value]) => [key, clone(value)])),
    ]);
  }

  private copyTransactionalStateTo(target: InMemoryP0Repository): void {
    const sourceMaps = this.transactionalMaps();
    const targetMaps = target.transactionalMaps();
    sourceMaps.forEach((source, index) => {
      const targetMap = targetMaps[index]!;
      targetMap.clear();
      for (const [key, value] of source.entries()) {
        targetMap.set(key, clone(value));
      }
    });
  }

  private mergeTransactionalChangesFrom(
    transaction: InMemoryP0Repository,
    snapshots: Array<readonly [Map<string, unknown>, Map<string, unknown>]>,
  ): void {
    const targetMaps = this.transactionalMaps();
    const pendingMutations: Array<{
      targetMap: Map<string, unknown>;
      key: string;
      value?: unknown;
      deleted?: boolean;
    }> = [];
    transaction.transactionalMaps().forEach((transactionMap, index) => {
      const targetMap = targetMaps[index]!;
      const snapshot = snapshots[index]![1];
      for (const [key, value] of transactionMap.entries()) {
        const snapshotValue = snapshot.get(key);
        const currentValue = targetMap.get(key);
        if (!valuesEqual(currentValue, snapshotValue) && !valuesEqual(value, snapshotValue)) {
          throw new DomainError('INVALID_TRANSITION', `Concurrent modification detected for transactional key ${key}`);
        }
        if (!valuesEqual(value, snapshotValue)) {
          pendingMutations.push({ targetMap, key, value: clone(value) });
        }
      }
      for (const key of snapshot.keys()) {
        if (!transactionMap.has(key)) {
          const snapshotValue = snapshot.get(key);
          const currentValue = targetMap.get(key);
          if (!valuesEqual(currentValue, snapshotValue)) {
            throw new DomainError('INVALID_TRANSITION', `Concurrent deletion conflict detected for transactional key ${key}`);
          }
          pendingMutations.push({ targetMap, key, deleted: true });
        }
      }
    });
    for (const mutation of pendingMutations) {
      if (mutation.deleted === true) {
        mutation.targetMap.delete(mutation.key);
      } else {
        mutation.targetMap.set(mutation.key, clone(mutation.value));
      }
    }
  }

  private transactionalMaps(): Array<Map<string, unknown>> {
    return [
      this.organizations,
      this.actors,
      this.projects,
      this.projectRepos,
      this.workItems,
      this.specs,
      this.specRevisions,
      this.plans,
      this.planRevisions,
      this.executionPackages,
      this.executionPackageDependencies,
      this.runSessions,
      this.runEvents,
      this.runCommands,
      this.runWorkerLeases,
      this.reviewPackets,
      this.releases,
      this.releaseWorkItems,
      this.releaseWorkItemOrders,
      this.releaseExecutionPackages,
      this.releaseExecutionPackageOrders,
      this.releaseEvidences,
      this.objectEvents,
      this.statusHistories,
      this.artifacts,
      this.decisions,
      this.traceEvents,
      this.traceLinks,
      this.traceArtifactRefs,
      this.automationProjectSettings,
      this.manualPathHolds,
      this.manualPathHoldIdempotency,
      this.manualPathHoldSourceActions,
      this.commandIdempotencyRecords,
      this.executionPackageGenerationRuns,
      this.executionPackageGenerationPackages,
      this.automationActionRuns,
      this.automationActionRunIdempotency,
    ] as Array<Map<string, unknown>>;
  }

  private dependencyKey(dependency: ExecutionPackageDependency): string {
    return `${dependency.package_id}:${dependency.depends_on_package_id}`;
  }

  private async hydrateReleaseLinks(release: Release): Promise<Release> {
    const [workItems, executionPackages] = await Promise.all([
      this.listReleaseWorkItems(release.id),
      this.listReleaseExecutionPackages(release.id),
    ]);

    return {
      ...clone(release),
      work_item_ids: workItems.map((workItem) => workItem.work_item_id),
      execution_package_ids: executionPackages.map((executionPackage) => executionPackage.execution_package_id),
    };
  }

  private replaceReleaseWorkItems(releaseId: string, workItemIds: string[]): void {
    const uniqueWorkItemIds = [...new Set(workItemIds)];
    for (const key of [...this.releaseWorkItems.keys()]) {
      if (key.startsWith(`${releaseId}:`)) {
        this.releaseWorkItems.delete(key);
        this.releaseWorkItemOrders.delete(key);
      }
    }

    uniqueWorkItemIds.forEach((workItemId, index) => {
      const key = `${releaseId}:${workItemId}`;
      this.releaseWorkItems.set(key, clone({ release_id: releaseId, work_item_id: workItemId }));
      this.releaseWorkItemOrders.set(key, index);
    });
  }

  private replaceReleaseExecutionPackages(releaseId: string, executionPackageIds: string[]): void {
    const uniqueExecutionPackageIds = [...new Set(executionPackageIds)];
    for (const key of [...this.releaseExecutionPackages.keys()]) {
      if (key.startsWith(`${releaseId}:`)) {
        this.releaseExecutionPackages.delete(key);
        this.releaseExecutionPackageOrders.delete(key);
      }
    }

    uniqueExecutionPackageIds.forEach((executionPackageId, index) => {
      const key = `${releaseId}:${executionPackageId}`;
      this.releaseExecutionPackages.set(key, clone({ release_id: releaseId, execution_package_id: executionPackageId }));
      this.releaseExecutionPackageOrders.set(key, index);
    });
  }

  private claimCommand(command: RunCommand, workerId: string, claimedAt: string): RunCommand {
    const claimed: RunCommand = {
      ...command,
      status: 'claimed',
      claimed_by_worker_id: workerId,
      claimed_at: claimedAt,
      updated_at: claimedAt,
    };
    this.runCommands.set(claimed.id, clone(claimed));
    return clone(claimed);
  }

  private async getFencedCommand(
    commandId: string,
    lease: { workerId: string; leaseToken: string },
    now: string,
  ): Promise<RunCommand> {
    const command = this.runCommands.get(commandId);
    if (command === undefined || command.status !== 'claimed' || command.claimed_by_worker_id !== lease.workerId) {
      throw new DomainError('INVALID_TRANSITION', `Run command ${commandId} is not claimed by worker ${lease.workerId}`);
    }

    await this.assertActiveRunWorkerLease(command.run_session_id, lease.workerId, lease.leaseToken, now);
    return clone(command);
  }
}

const commandPriority = (command: RunCommand): number => (command.command_type === 'cancel' ? 0 : 1);
