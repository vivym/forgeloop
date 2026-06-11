import { ConflictException, Injectable, Inject } from '@nestjs/common';
import {
  sessionOperationsHealthQuerySchema,
  sessionOperationsFilterSchema,
  type OperatorSessionHealthProjection,
  type PlanItemSessionDiagnostics,
  type PlanItemSessionHealthState,
  type RecoverSessionResponse,
  type ScavengeSessionOperationsResponse,
  type SessionOperationsFilter,
  type SessionRecoveryCandidatePredicate,
  type SessionRecoveryRecordDto,
} from '@forgeloop/contracts';
import {
  DomainError,
  assertRecoveryIdempotencyNotConflicting,
  assertRecoveryPredicateStillMatches,
  buildSessionHealthProjection,
  codexCanonicalDigest,
  recoveryRequestMatchesExistingRecord,
  redactOperatorSessionHealthProjection,
  redactPlanItemSessionDiagnostics,
  sessionRecoveryProjectionDigest,
  type BuildSessionHealthProjectionInput,
  type ObjectEvent,
  type PlanItemSessionHealth,
  type SessionRecoveryRecord,
} from '@forgeloop/domain';
import type { CodexRuntimeJob, PlanItemWorkflowQueuedAction, RunSession } from '@forgeloop/domain';
import type { ActorContext } from '../auth/actor-context';
import { DELIVERY_REPOSITORY } from '../core/control-plane-tokens';
import type { DeliveryRepository } from '@forgeloop/db';
import type { RecoverSessionRequestDto, ScavengeSessionOperationsRequestDto } from './session-operations.dto';

type BuildOptions = {
  repository?: DeliveryRepository;
  persist: boolean;
  forceState?: Extract<PlanItemSessionHealthState, 'recovered' | 'unrecoverable'>;
  checkedAt?: string;
};

type ApplyResult = {
  result: SessionRecoveryRecord['result'];
  result_code: string;
  after_state: PlanItemSessionHealthState;
  affected_lease_ids?: string[];
  affected_queued_action_ids?: string[];
  affected_turn_ids?: string[];
  affected_runtime_job_ids?: string[];
  affected_run_session_ids?: string[];
  affected_capsule_ids?: string[];
};

const nowIso = (): string => new Date().toISOString();
const terminalOperationStates = new Set<PlanItemSessionHealthState>(['recovered', 'unrecoverable']);
const optionalObject = <T extends Record<string, unknown>>(value: T): T => {
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) {
      result[key] = entry;
    }
  }
  return result as T;
};

@Injectable()
export class SessionOperationsService {
  constructor(@Inject(DELIVERY_REPOSITORY) private readonly repository: DeliveryRepository) {}

  async listHealth(query: Record<string, string | undefined>, actorContext: ActorContext) {
    this.assertOperator(actorContext);
    const filters = sessionOperationsHealthQuerySchema.parse(query);
    const projections = await this.discoverSessionOperationCandidates(filters, actorContext, { persist: true });
    await Promise.all(projections.map((projection) => this.assertProjectionVisible(projection, actorContext)));
    return {
      items: projections.map((projection) => this.operatorProjectionForActor(projection, actorContext)),
      filters,
    };
  }

  async listAudit(sessionId: string, actorContext: ActorContext) {
    this.assertOperator(actorContext);
    const projection = await this.buildProjectionForSession(sessionId, { persist: false });
    await this.assertProjectionVisible(projection, actorContext);
    const records = await this.repository.listSessionRecoveryRecords({ codex_session_id: sessionId, limit: 100 });
    return { items: records.map((record) => this.redactSessionRecoveryRecordDto(record)) };
  }

  async getPlanItemDiagnostics(planItemId: string, actorContext: ActorContext): Promise<PlanItemSessionDiagnostics> {
    this.requireActor(actorContext);
    await this.assertPlanItemVisible(planItemId, actorContext);
    const workflows = await this.repository.listActivePlanItemWorkflowsByItem(planItemId);
    if (workflows.length === 0) {
      return {
        plan_item_id: planItemId,
        workflow_resolution: 'no_active_workflow',
        summary: 'No active Plan Item workflow owns a Codex session.',
        operator_intervention_required: true,
        normal_workflow_actions_available: false,
        recovery_request_available: false,
      };
    }
    if (workflows.length > 1) {
      throw new DomainError(
        'session_operations_ambiguous_workflow',
        'session_operations_ambiguous_workflow: Plan Item has multiple active workflows',
      );
    }
    const workflow = workflows[0]!;
    if (workflow.active_codex_session_id === undefined) {
      return {
        plan_item_id: planItemId,
        workflow_resolution: 'no_active_workflow',
        summary: 'The active Plan Item workflow does not have an active Codex session.',
        operator_intervention_required: true,
        normal_workflow_actions_available: false,
        recovery_request_available: false,
      };
    }
    const projection = await this.buildProjectionForSession(workflow.active_codex_session_id, { persist: true });
    return redactPlanItemSessionDiagnostics(projection);
  }

  async recover(sessionId: string, body: RecoverSessionRequestDto, actorContext: ActorContext): Promise<RecoverSessionResponse> {
    const actorId = this.requireActor(actorContext);
    this.assertOperator(actorContext);
    const operationKey = body.operation_idempotency_key;
    return this.repository.withObjectLock(`codex-session:${sessionId}`, (sessionLockedRepository) =>
      sessionLockedRepository.withObjectLock(`session-operations:${operationKey}`, async (lockedRepository) => {
      const existing = await lockedRepository.getSessionRecoveryRecordByOperationIdempotencyKey(operationKey);
      if (existing !== undefined) {
        if (existing.codex_session_id !== sessionId) {
          throw new DomainError(
            'session_operations_idempotency_conflict',
            'session_operations_idempotency_conflict: operation idempotency key targets a different Codex session',
            {
              operation_idempotency_key: operationKey,
              existing_record_id: existing.id,
            },
          );
        }
        assertRecoveryIdempotencyNotConflicting(existing, {
          operation: body.operation,
          reason: body.reason,
          operation_idempotency_key: operationKey,
          candidate_predicate: body.candidate_predicate,
          codex_session_id: sessionId,
          target_after_state: existing.after_state,
          target_result: existing.result,
        });
        const current = await this.buildProjectionForSession(existing.codex_session_id, { persist: false, repository: lockedRepository });
        await this.assertProjectionVisible(current, actorContext, lockedRepository);
        return {
          record: this.redactSessionRecoveryRecordDto(existing),
          before: this.mutatingProjectionForActor(current, actorContext),
          after: this.mutatingProjectionForActor(current, actorContext),
          replayed: true,
        };
      }

      const scopedBefore = await this.buildProjectionForSession(sessionId, {
        persist: false,
        repository: lockedRepository,
        checkedAt: body.candidate_predicate.observed_at,
      });
      await this.assertProjectionVisible(scopedBefore, actorContext, lockedRepository);
      this.assertRecoverTargetMatchesRoute(sessionId, body.candidate_predicate);
      this.assertRecoverTargetMatchesProjection(scopedBefore, body.candidate_predicate);
      const before = await this.buildProjectionForSession(sessionId, {
        persist: true,
        repository: lockedRepository,
        checkedAt: body.candidate_predicate.observed_at,
      });
      if (operationKey !== body.candidate_predicate.operation_idempotency_key) {
        const { record, replayed } = await this.recordRecovery(lockedRepository, {
          before,
          after: before,
          body,
          actorId,
          operationKey,
          result: 'blocked',
          result_code: 'idempotency_key_mismatch',
          affected: {},
        });
        throw new ConflictException({
          message: 'Recovery idempotency key must match the candidate predicate.',
          code: 'session_operations_idempotency_conflict',
          response: {
            record: this.redactSessionRecoveryRecordDto(record),
            before: this.mutatingProjectionForActor(before, actorContext),
            after: this.mutatingProjectionForActor(before, actorContext),
            replayed,
          },
        });
      }

      const staleResult = this.predicateMismatchResult(before, body.candidate_predicate);
      if (staleResult !== undefined) {
        const after = await this.buildProjectionForSession(sessionId, { persist: true, repository: lockedRepository });
        const { record, replayed } = await this.recordRecovery(lockedRepository, {
          before,
          after,
          body,
          actorId,
          operationKey,
          result: 'skipped',
          result_code: staleResult,
          affected: {},
        });
        throw new ConflictException({
          message: 'Recovery candidate is stale.',
          code: 'session_operations_stale_candidate',
          response: {
            record: this.redactSessionRecoveryRecordDto(record),
            before: this.mutatingProjectionForActor(before, actorContext),
            after: this.mutatingProjectionForActor(after, actorContext),
            replayed,
          },
        });
      }

      const applied = await this.applyControlOnlyRecovery(before, body.operation, lockedRepository);
      const afterOptions: BuildOptions = {
        persist: true,
        repository: lockedRepository,
        checkedAt: nowIso(),
      };
      if (terminalOperationStates.has(applied.after_state)) {
        afterOptions.forceState = applied.after_state as Extract<PlanItemSessionHealthState, 'recovered' | 'unrecoverable'>;
      }
      const after = await this.buildProjectionForSession(sessionId, afterOptions);
      const eventId = applied.result === 'applied' ? await this.appendRecoveryObjectEvent(lockedRepository, before, after, body, actorId, applied, operationKey) : undefined;
      const recoveryInput = {
        before,
        after,
        body,
        actorId,
        operationKey,
        result: applied.result,
        result_code: applied.result_code,
        affected: applied,
      };
      const { record, replayed } = await this.recordRecovery(
        lockedRepository,
        eventId === undefined ? recoveryInput : { ...recoveryInput, object_event_id: eventId },
      );
      return {
        record: this.redactSessionRecoveryRecordDto(record),
        before: this.mutatingProjectionForActor(before, actorContext),
        after: this.mutatingProjectionForActor(after, actorContext),
        replayed,
      };
      }),
    );
  }

  async scavenge(body: ScavengeSessionOperationsRequestDto, actorContext: ActorContext): Promise<ScavengeSessionOperationsResponse> {
    const actorId = this.requireActor(actorContext);
    this.assertOperator(actorContext);
    if (body.mode !== 'execute') {
      const filters = sessionOperationsFilterSchema.parse(body.filters ?? {});
      const candidates = await this.discoverSessionOperationCandidates(filters, actorContext, { persist: false });
      return {
        mode: 'dry_run',
        candidates: candidates.map((projection) => this.operatorProjectionForActor(projection, actorContext)),
        results: [],
      };
    }

    const results: SessionRecoveryRecordDto[] = [];
    for (const candidate of body.candidates ?? []) {
      this.assertRecoverTargetMatchesRoute(candidate.codex_session_id, candidate.candidate_predicate);
      const operationKey = `${body.operation_idempotency_key_prefix}:${candidate.codex_session_id}:${candidate.candidate_predicate.projection_digest}`;
      const scavengeRecoverBody: RecoverSessionRequestDto = {
        operation: 'recover',
        reason: body.reason!,
        operation_idempotency_key: operationKey,
        candidate_predicate: candidate.candidate_predicate,
      };
      const record = await this.repository.withObjectLock(`codex-session:${candidate.codex_session_id}`, (sessionLockedRepository) =>
        sessionLockedRepository.withObjectLock(`session-operations:${operationKey}`, async (lockedRepository) => {
        const existing = await lockedRepository.getSessionRecoveryRecordByOperationIdempotencyKey(operationKey);
        if (existing !== undefined) {
          const existingProjection = await this.buildProjectionForSession(existing.codex_session_id, {
            persist: false,
            repository: lockedRepository,
          });
          await this.assertProjectionVisible(existingProjection, actorContext, lockedRepository);
          if (!recoveryRequestMatchesExistingRecord(existing, {
            operation: 'scavenge',
            reason: scavengeRecoverBody.reason,
            operation_idempotency_key: operationKey,
            candidate_predicate: scavengeRecoverBody.candidate_predicate,
            codex_session_id: this.requireProjectionCodexSessionId(existingProjection),
            target_after_state: existing.after_state,
            target_result: existing.result,
          })) {
            return this.blockedScavengeConflictDto(
              lockedRepository,
              scavengeRecoverBody,
              actorId,
              operationKey,
            );
          }
          return this.redactSessionRecoveryRecordDto(existing);
        }
        const scopedBefore = await this.buildProjectionForSession(candidate.codex_session_id, {
          persist: false,
          repository: lockedRepository,
          checkedAt: candidate.candidate_predicate.observed_at,
        });
        await this.assertProjectionVisible(scopedBefore, actorContext, lockedRepository);
        this.assertRecoverTargetMatchesProjection(scopedBefore, candidate.candidate_predicate);
        const before = await this.buildProjectionForSession(candidate.codex_session_id, {
          persist: true,
          repository: lockedRepository,
          checkedAt: candidate.candidate_predicate.observed_at,
        });
        const mismatch = this.predicateMismatchResult(before, candidate.candidate_predicate);
        if (mismatch !== undefined) {
          const { record } = await this.recordRecovery(lockedRepository, {
            before,
            after: before,
            body: scavengeRecoverBody,
            actorId,
            operationKey,
            auditOperation: 'scavenge',
            result: 'skipped',
            result_code: mismatch,
            affected: {},
          });
          return this.redactSessionRecoveryRecordDto(record);
        }
        const applied = await this.applyControlOnlyRecovery(before, 'recover', lockedRepository);
        const afterOptions: BuildOptions = {
          persist: true,
          repository: lockedRepository,
          checkedAt: nowIso(),
        };
        if (applied.after_state === 'recovered') {
          afterOptions.forceState = 'recovered';
        }
        const after = await this.buildProjectionForSession(candidate.codex_session_id, afterOptions);
        const eventId = applied.result === 'applied'
          ? await this.appendRecoveryObjectEvent(
              lockedRepository,
              before,
              after,
              scavengeRecoverBody,
              actorId,
              applied,
              operationKey,
            )
          : undefined;
        const recoveryInput = {
          before,
          after,
          body: scavengeRecoverBody,
          actorId,
          operationKey,
          auditOperation: 'scavenge' as const,
          result: applied.result,
          result_code: applied.result_code,
          affected: applied,
        };
        const { record } = await this.recordRecovery(
          lockedRepository,
          eventId === undefined ? recoveryInput : { ...recoveryInput, object_event_id: eventId },
        );
        return this.redactSessionRecoveryRecordDto(record);
        }),
      );
      results.push(record);
    }
    return { mode: 'execute', candidates: [], results };
  }

  private async discoverSessionOperationCandidates(
    filters: SessionOperationsFilter,
    actorContext: ActorContext,
    options: { persist: boolean },
  ): Promise<PlanItemSessionHealth[]> {
    this.assertOperator(actorContext);
    const query = { ...filters, now: nowIso() };
    const discovered = await this.repository.listActivePlanItemWorkflowSessionsForSessionOperations(query);
    const projections: PlanItemSessionHealth[] = [];
    const seen = new Set<string>();
    for (const row of discovered) {
      const projection = await this.buildProjectionForSession(row.codex_session_id, { persist: false });
      if (this.projectionMatchesFilters(projection, filters) && (await this.projectionVisible(projection, actorContext))) {
        const visibleProjection = options.persist
          ? await this.buildProjectionForSession(row.codex_session_id, { persist: true })
          : projection;
        projections.push(visibleProjection);
        seen.add(`${projection.workflow_id}:${projection.codex_session_id}`);
      }
    }
    const persisted = await this.repository.listPlanItemSessionHealth({
      ...filters,
      include_recovered: true,
      include_unrecoverable: true,
    });
    for (const projection of persisted) {
      const key = `${projection.workflow_id}:${projection.codex_session_id}`;
      if (
        !seen.has(key) &&
        terminalOperationStates.has(projection.state) &&
        this.projectionMatchesFilters(projection, filters) &&
        (await this.projectionVisible(projection, actorContext))
      ) {
        projections.push(projection);
      }
    }
    return projections.slice(0, filters.limit ?? 100);
  }

  private async buildProjectionForSession(sessionId: string, options: BuildOptions): Promise<PlanItemSessionHealth> {
    const repository = options.repository ?? this.repository;
    const session = await repository.getCodexSession(sessionId);
    if (session === undefined) {
      throw new DomainError('session_operations_no_active_workflow', 'session_operations_no_active_workflow: Codex session was not found');
    }
    const workflow = await repository.getPlanItemWorkflow(session.owner_id);
    if (workflow === undefined) {
      throw new DomainError('session_operations_no_active_workflow', 'session_operations_no_active_workflow: workflow was not found');
    }
    const existing = await repository.getPlanItemSessionHealth({ workflow_id: workflow.id, codex_session_id: session.id });
    if (options.forceState === undefined && existing !== undefined && terminalOperationStates.has(existing.state)) {
      return existing;
    }
    const plan = await repository.getDevelopmentPlan(workflow.development_plan_id);
    if (plan === undefined) {
      throw new DomainError('session_operations_no_active_workflow', 'session_operations_no_active_workflow: development plan was not found');
    }
    const activeLease = session.active_lease_id === undefined ? undefined : await repository.getCodexSessionLease(session.active_lease_id);
    const actions = await repository.listActivePlanItemWorkflowQueuedActions(workflow.id);
    const pendingAction = actions.find((action) => action.codex_session_id === session.id) ?? actions[0];
    const turns = await repository.listCodexSessionTurns(session.id);
    const latestTurn = session.latest_turn_id === undefined
      ? turns.sort((left, right) => right.updated_at.localeCompare(left.updated_at))[0]
      : await repository.getCodexSessionTurn(session.latest_turn_id);
    const latestCapsule = session.latest_capsule_id === undefined ? undefined : await repository.getCodexRuntimeCapsule(session.latest_capsule_id);
    const runtimeJob = session.runner_runtime_job_id === undefined
      ? undefined
      : await repository.getCodexRuntimeJob({ runtime_job_id: session.runner_runtime_job_id });
    const runSession = latestTurn?.runtime_job_id === undefined ? undefined : await this.findRunSession(repository, latestTurn.runtime_job_id);
    const checkedAt = options.checkedAt ?? nowIso();
    const project = await repository.getProject(plan.project_id);
    const projectionInput: BuildSessionHealthProjectionInput = {
      project_id: plan.project_id,
      checked_at: checkedAt,
      workflow,
      session,
      ...(project?.org_id === undefined ? {} : { organization_id: project.org_id }),
      ...(activeLease === undefined ? {} : { active_lease: activeLease }),
      ...(pendingAction === undefined ? {} : { pending_queued_action: pendingAction }),
      ...(latestTurn === undefined ? {} : { latest_turn: latestTurn }),
      ...(runtimeJob === undefined
        ? {}
        : {
            runtime_job: optionalObject({
              id: runtimeJob.id,
              session_id: runtimeJob.codex_session_id ?? session.id,
              status: this.runtimeJobStatus(runtimeJob.status),
              ...(runtimeJob.terminal_status === undefined ? {} : { terminal_status: runtimeJob.terminal_status }),
              worker_id: runtimeJob.worker_id,
              launch_lease_id: runtimeJob.launch_lease_id,
              ...(runtimeJob.accepted_worker_session_digest === undefined
                ? {}
                : { worker_session_digest: runtimeJob.accepted_worker_session_digest }),
              expires_at: runtimeJob.expires_at,
              updated_at: runtimeJob.updated_at,
            }),
          }),
      ...(runSession === undefined ? {} : { run_session: runSession }),
      ...(latestCapsule === undefined ? {} : { latest_capsule: latestCapsule }),
      workflow_resolution: 'active_workflow',
      plan_item_id: workflow.development_plan_item_id,
    };
    const fresh = buildSessionHealthProjection(projectionInput);
    const projection = options.forceState === undefined ? fresh : this.withForcedState(fresh, options.forceState, checkedAt);
    if (options.persist) {
      await repository.upsertPlanItemSessionHealth(projection);
      await repository.upsertCapsuleRetentionPins(projection.retention_pins);
    }
    return projection;
  }

  private async findRunSession(repository: DeliveryRepository, runtimeJobId: string) {
    const runSessions = await repository.listRunSessions();
    return runSessions.find((runSession) => {
      const metadata = runSession.runtime_metadata as Record<string, unknown> | undefined;
      return metadata?.['runtime_job_id'] === runtimeJobId || runSession.runtime_metadata?.remote_runtime_job_id === runtimeJobId;
    });
  }

  private runtimeJobStatus(status: string): 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'stale' | 'unknown' {
    if (status === 'queued') return 'queued';
    if (status === 'terminal') return 'succeeded';
    if (status === 'accepted' || status === 'materializing' || status === 'running') return 'running';
    return 'unknown';
  }

  private withForcedState(
    projection: PlanItemSessionHealth,
    state: Extract<PlanItemSessionHealthState, 'recovered' | 'unrecoverable'>,
    checkedAt: string,
  ): PlanItemSessionHealth {
    const forced: PlanItemSessionHealth = {
      ...projection,
      state,
      severity: state === 'recovered' ? 'info' : 'critical',
      reason_code: state,
      summary: state === 'recovered' ? 'The session was recovered.' : 'The session was marked unrecoverable.',
      checked_at: checkedAt,
      recovery_available: false,
      recovery_operation_labels: [],
      operator_intervention_required: state !== 'recovered',
      normal_workflow_actions_available: false,
      candidate_predicate: undefined,
    };
    forced.projection_digest = sessionRecoveryProjectionDigest({
      schema_version: 'session_health_projection.terminal.v1',
      codex_session_id: forced.codex_session_id,
      workflow_id: forced.workflow_id,
      state: forced.state,
      previous_projection_digest: projection.projection_digest,
      checked_at: checkedAt,
    });
    forced.diagnostics = redactPlanItemSessionDiagnostics(forced);
    return forced;
  }

  private async applyControlOnlyRecovery(
    before: PlanItemSessionHealth,
    operation: RecoverSessionRequestDto['operation'],
    repository: DeliveryRepository,
  ): Promise<ApplyResult> {
    const now = nowIso();
    if (before.state === 'blocked_stale_lease') {
      if (operation !== 'recover') {
        return { result: 'blocked', result_code: 'unsupported_mark_unrecoverable_for_stale_lease', after_state: before.state };
      }
      const lease = before.candidate_predicate?.active_lease.state === 'present' ? before.candidate_predicate.active_lease.value : undefined;
      if (lease === undefined || before.workflow_id === undefined || before.codex_session_id === undefined) {
        return { result: 'blocked', result_code: 'missing_stale_lease_identity', after_state: before.state };
      }
      await repository.releaseStaleCodexSessionLeaseForSessionOperations({
        session_id: before.codex_session_id,
        workflow_id: before.workflow_id,
        lease_id: lease.id,
        now,
      });
      return { result: 'applied', result_code: 'stale_lease_released', after_state: 'recovered', affected_lease_ids: [lease.id] };
    }
    if (before.state === 'blocked_orphaned_action') {
      if (operation !== 'recover') {
        return { result: 'blocked', result_code: 'unsupported_mark_unrecoverable_for_orphaned_action', after_state: before.state };
      }
      const queuedAction = before.candidate_predicate?.pending_queued_action.state === 'present'
        ? before.candidate_predicate.pending_queued_action.value
        : undefined;
      if (queuedAction !== undefined && queuedAction.workflow_id !== null) {
        await repository.stalePlanItemWorkflowQueuedActionForSessionOperations({
          workflow_id: queuedAction.workflow_id,
          action_id: queuedAction.id,
          reason: 'session_operations_orphaned_action',
          now,
        });
        if (queuedAction.codex_session_turn_id !== null && before.codex_session_id !== undefined) {
          await repository.markCodexSessionTurnStale({
            session_id: before.codex_session_id,
            turn_id: queuedAction.codex_session_turn_id,
            now,
          });
          return {
            result: 'applied',
            result_code: 'orphaned_action_marked_stale',
            after_state: 'recovered',
            affected_queued_action_ids: [queuedAction.id],
            affected_turn_ids: [queuedAction.codex_session_turn_id],
          };
        }
        return {
          result: 'applied',
          result_code: 'orphaned_action_marked_stale',
          after_state: 'recovered',
          affected_queued_action_ids: [queuedAction.id],
        };
      }
      const runtimeJob = before.candidate_predicate?.runtime_job.state === 'present'
        ? before.candidate_predicate.runtime_job.value
        : undefined;
      const runSession = before.candidate_predicate?.run_session.state === 'present'
        ? before.candidate_predicate.run_session.value
        : undefined;
      if (runtimeJob !== undefined) {
        await repository.terminalizeCodexRuntimeJobForSessionOperations({
          runtime_job_id: runtimeJob.id,
          terminal_status: 'expired',
          reason_code: 'session_operations_orphaned_runtime_job',
          now,
        });
        const affectedRunSessionIds = await this.failRunSessionForSessionOperations(repository, runSession, now);
        return {
          result: 'applied',
          result_code: 'orphaned_runtime_job_terminalized',
          after_state: 'recovered',
          affected_runtime_job_ids: [runtimeJob.id],
          affected_run_session_ids: affectedRunSessionIds,
        };
      }
      if (runSession !== undefined) {
        const affectedRunSessionIds = await this.failRunSessionForSessionOperations(repository, runSession, now);
        return {
          result: 'applied',
          result_code: 'orphaned_run_session_terminalized',
          after_state: 'recovered',
          affected_run_session_ids: affectedRunSessionIds,
        };
      }
      return { result: 'blocked', result_code: 'missing_orphaned_action_identity', after_state: before.state };
    }
    if (before.state === 'blocked_missing_capsule') {
      const affectedCapsuleId = before.candidate_predicate?.latest_capsule.state === 'present'
        ? before.candidate_predicate.latest_capsule.value.id
        : before.candidate_predicate?.session.state === 'present'
          ? before.candidate_predicate.session.value.id
          : undefined;
      if (operation === 'mark_unrecoverable') {
        return {
          result: 'applied',
          result_code: 'marked_unrecoverable_missing_capsule',
          after_state: 'unrecoverable',
          affected_capsule_ids: affectedCapsuleId === undefined ? [] : [affectedCapsuleId],
        };
      }
      return {
        result: 'blocked',
        result_code: 'unsupported_missing_capsule_recovery',
        after_state: before.state,
        affected_capsule_ids: affectedCapsuleId === undefined ? [] : [affectedCapsuleId],
      };
    }
    if (before.state === 'blocked_lineage_conflict') {
      if (operation === 'mark_unrecoverable') {
        return {
          result: 'applied',
          result_code: 'marked_unrecoverable_lineage_conflict',
          after_state: 'unrecoverable',
        };
      }
      return { result: 'blocked', result_code: 'unsupported_lineage_conflict_recovery', after_state: before.state };
    }
    if (before.state === 'recovered' || before.state === 'healthy') {
      return { result: 'skipped', result_code: `already_${before.state}`, after_state: before.state };
    }
    return { result: 'blocked', result_code: `unsupported_${before.state}_recovery`, after_state: before.state };
  }

  private async failRunSessionForSessionOperations(
    repository: DeliveryRepository,
    runSession: Pick<RunSession, 'id'> | undefined,
    now: string,
  ): Promise<string[]> {
    if (runSession === undefined) {
      return [];
    }
    const current = await repository.getRunSession(runSession.id);
    if (current === undefined || current.status === 'succeeded' || current.status === 'failed' || current.status === 'timed_out' || current.status === 'cancelled') {
      return [];
    }
    await repository.saveRunSession({
      ...current,
      status: 'failed',
      failure_kind: 'executor_error',
      failure_reason: 'session_operations_orphaned_runtime_job',
      finished_at: now,
      updated_at: now,
    });
    return [runSession.id];
  }

  private predicateMismatchResult(before: PlanItemSessionHealth, predicate: SessionRecoveryCandidatePredicate): string | undefined {
    try {
      assertRecoveryPredicateStillMatches(before, predicate);
      return undefined;
    } catch (error) {
      if (error instanceof DomainError && error.code === 'session_operations_stale_candidate') {
        return before.state === 'healthy' ? 'candidate_superseded' : 'stale_candidate';
      }
      throw error;
    }
  }

  private assertRecoverTargetMatchesRoute(sessionId: string, predicate: SessionRecoveryCandidatePredicate): void {
    if (sessionId !== predicate.codex_session_id) {
      throw new DomainError(
        'session_operations_idempotency_conflict',
        'session_operations_idempotency_conflict: recovery target session does not match route session',
        {
          route_codex_session_id: sessionId,
          predicate_codex_session_id: predicate.codex_session_id,
        },
      );
    }
  }

  private assertRecoverTargetMatchesProjection(
    projection: PlanItemSessionHealth,
    predicate: SessionRecoveryCandidatePredicate,
  ): void {
    const expectedSessionId = projection.codex_session_id;
    const expectedWorkflowId = projection.workflow_id;
    const expectedPlanItemId = projection.development_plan_item_id;
    const predicateWorkflowPlanItemId = predicate.workflow.state === 'present'
      ? predicate.workflow.value.development_plan_item_id
      : undefined;
    if (
      expectedSessionId === undefined ||
      expectedWorkflowId === undefined ||
      expectedPlanItemId === undefined ||
      predicate.codex_session_id !== expectedSessionId ||
      predicate.workflow_id !== expectedWorkflowId ||
      predicateWorkflowPlanItemId !== expectedPlanItemId
    ) {
      throw new DomainError(
        'session_operations_stale_candidate',
        'session_operations_stale_candidate: recovery predicate target identity no longer matches server projection',
        {
          codex_session_id: expectedSessionId,
          workflow_id: expectedWorkflowId,
          development_plan_item_id: expectedPlanItemId,
        },
      );
    }
  }

  private async recordRecovery(
    repository: DeliveryRepository,
    input: {
      before: PlanItemSessionHealth;
      after: PlanItemSessionHealth;
      body: RecoverSessionRequestDto;
      actorId: string;
      operationKey: string;
      result: SessionRecoveryRecord['result'];
      result_code: string;
      affected: Partial<ApplyResult>;
      auditOperation?: SessionRecoveryRecord['operation'];
      object_event_id?: string;
    },
  ) {
    const record: SessionRecoveryRecord = {
      id: codexCanonicalDigest({
        kind: 'session_recovery_record',
        operation_idempotency_key: input.operationKey,
      }),
      operation_idempotency_key: input.operationKey,
      operation: input.auditOperation ?? input.body.operation,
      actor_id: input.actorId,
      codex_session_id: this.requireProjectionCodexSessionId(input.before),
      workflow_id: this.requireProjectionWorkflowId(input.before),
      development_plan_item_id: this.requireProjectionPlanItemId(input.before),
      reason: input.body.reason,
      before_state: input.before.state,
      after_state: input.after.state,
      before_projection_digest: input.before.projection_digest,
      after_projection_digest: input.after.projection_digest,
      predicate_summary: input.body.candidate_predicate,
      affected_lease_ids: input.affected.affected_lease_ids ?? [],
      affected_queued_action_ids: input.affected.affected_queued_action_ids ?? [],
      affected_turn_ids: input.affected.affected_turn_ids ?? [],
      affected_runtime_job_ids: input.affected.affected_runtime_job_ids ?? [],
      affected_run_session_ids: input.affected.affected_run_session_ids ?? [],
      affected_capsule_ids: input.affected.affected_capsule_ids ?? [],
      result: input.result,
      result_code: input.result_code,
      ...(input.object_event_id === undefined ? {} : { object_event_id: input.object_event_id }),
      created_at: nowIso(),
    };
    return repository.createOrReplaySessionRecoveryRecord(record);
  }

  private async blockedScavengeConflictDto(
    repository: DeliveryRepository,
    body: RecoverSessionRequestDto,
    actorId: string,
    operationKey: string,
  ): Promise<SessionRecoveryRecordDto> {
    const before = await this.buildProjectionForSession(body.candidate_predicate.codex_session_id, {
      persist: false,
      repository,
      checkedAt: body.candidate_predicate.observed_at,
    });
    return {
      id: codexCanonicalDigest({
        kind: 'session_recovery_idempotency_conflict_response',
        operation_idempotency_key: operationKey,
        reason: body.reason,
        predicate_summary: this.predicateSummary(body.candidate_predicate),
      }),
      codex_session_id: this.requireProjectionCodexSessionId(before),
      operation: 'scavenge',
      result: 'blocked',
      result_code: 'idempotency_conflict',
      reason: body.reason,
      actor_id: actorId,
      operation_idempotency_key: operationKey,
      before_state: before.state,
      after_state: before.state,
      before_projection_digest: before.projection_digest,
      after_projection_digest: before.projection_digest,
      affected_lease_ids: [],
      affected_queued_action_ids: [],
      affected_turn_ids: [],
      affected_runtime_job_ids: [],
      affected_run_session_ids: [],
      affected_capsule_ids: [],
      predicate_summary: this.predicateSummary(body.candidate_predicate),
      created_at: nowIso(),
    };
  }

  private async appendRecoveryObjectEvent(
    repository: DeliveryRepository,
    before: PlanItemSessionHealth,
    after: PlanItemSessionHealth,
    body: RecoverSessionRequestDto,
    actorId: string,
    applied: ApplyResult,
    operationKey: string,
  ): Promise<string> {
    const event: ObjectEvent = {
      id: codexCanonicalDigest({ kind: 'session_operations_object_event', operationKey }),
      object_type: 'codex_session',
      object_id: this.requireProjectionCodexSessionId(before),
      event_type: 'session_operations_recovery_applied',
      actor_type: 'human',
      actor_id: actorId,
      reason: body.reason,
      payload: {
        operation_idempotency_key: operationKey,
        operation: body.operation,
        before_state: before.state,
        after_state: after.state,
        before_projection_digest: before.projection_digest,
        after_projection_digest: after.projection_digest,
        affected_lease_ids: applied.affected_lease_ids ?? [],
        affected_queued_action_ids: applied.affected_queued_action_ids ?? [],
        affected_turn_ids: applied.affected_turn_ids ?? [],
        affected_runtime_job_ids: applied.affected_runtime_job_ids ?? [],
        affected_run_session_ids: applied.affected_run_session_ids ?? [],
        affected_capsule_ids: applied.affected_capsule_ids ?? [],
        predicate_summary: this.predicateSummary(body.candidate_predicate),
      },
      metadata: { source: 'session_operations' },
      created_at: nowIso(),
    };
    await repository.appendObjectEvent(event);
    return event.id;
  }

  private requireProjectionCodexSessionId(projection: PlanItemSessionHealth): string {
    if (projection.codex_session_id === undefined) {
      throw new DomainError(
        'session_operations_no_active_workflow',
        'session_operations_no_active_workflow: session operation requires a concrete Codex session identity',
      );
    }
    return projection.codex_session_id;
  }

  private requireProjectionWorkflowId(projection: PlanItemSessionHealth): string {
    if (projection.workflow_id === undefined) {
      throw new DomainError(
        'session_operations_no_active_workflow',
        'session_operations_no_active_workflow: session operation requires a concrete workflow identity',
      );
    }
    return projection.workflow_id;
  }

  private requireProjectionPlanItemId(projection: PlanItemSessionHealth): string {
    if (projection.development_plan_item_id === undefined) {
      throw new DomainError(
        'session_operations_no_active_workflow',
        'session_operations_no_active_workflow: session operation requires a concrete Plan Item identity',
      );
    }
    return projection.development_plan_item_id;
  }

  private operatorProjectionForActor(
    projection: PlanItemSessionHealth,
    actorContext: ActorContext,
  ): OperatorSessionHealthProjection {
    const redacted = redactOperatorSessionHealthProjection(projection);
    if (actorContext.actorClass !== 'human_admin') {
      const { candidate_predicate: _candidatePredicate, ...withoutPredicate } = redacted;
      return withoutPredicate;
    }
    return redacted;
  }

  private mutatingProjectionForActor(
    projection: PlanItemSessionHealth,
    actorContext: ActorContext,
  ): OperatorSessionHealthProjection {
    const { candidate_predicate: _candidatePredicate, ...withoutPredicate } = this.operatorProjectionForActor(projection, actorContext);
    return withoutPredicate;
  }

  private redactSessionRecoveryRecordDto(record: SessionRecoveryRecord): SessionRecoveryRecordDto {
    return {
      id: record.id,
      codex_session_id: record.codex_session_id,
      operation: record.operation,
      result: record.result,
      result_code: record.result_code,
      reason: record.reason,
      actor_id: record.actor_id,
      operation_idempotency_key: record.operation_idempotency_key,
      before_state: record.before_state,
      after_state: record.after_state,
      before_projection_digest: record.before_projection_digest,
      after_projection_digest: record.after_projection_digest,
      affected_lease_ids: record.affected_lease_ids,
      affected_queued_action_ids: record.affected_queued_action_ids,
      affected_turn_ids: record.affected_turn_ids,
      affected_runtime_job_ids: record.affected_runtime_job_ids,
      affected_run_session_ids: record.affected_run_session_ids,
      affected_capsule_ids: record.affected_capsule_ids,
      predicate_summary: this.predicateSummary(record.predicate_summary),
      ...(record.object_event_id === undefined ? {} : { object_event_id: record.object_event_id }),
      ...(record.created_at === undefined ? {} : { created_at: record.created_at }),
    };
  }

  private predicateSummary(
    predicate: SessionRecoveryRecord['predicate_summary'],
  ): SessionRecoveryRecordDto['predicate_summary'] {
    if ('workflow' in predicate) {
      return {
        operation_idempotency_key: predicate.operation_idempotency_key,
        projection_digest: predicate.projection_digest,
        expected_health_state: predicate.expected_health_state,
        observed_at: predicate.observed_at,
        workflow_state: predicate.workflow.state,
        session_state: predicate.session.state,
        active_lease_state: predicate.active_lease.state,
        pending_queued_action_state: predicate.pending_queued_action.state,
        latest_turn_state: predicate.latest_turn.state,
        runtime_job_state: predicate.runtime_job.state,
        run_session_state: predicate.run_session.state,
        latest_capsule_state: predicate.latest_capsule.state,
      };
    }
    return predicate;
  }

  private projectionMatchesFilters(projection: PlanItemSessionHealth, filters: SessionOperationsFilter): boolean {
    if (filters.state !== undefined && projection.state !== filters.state) return false;
    if (filters.severity !== undefined && projection.severity !== filters.severity) return false;
    if (filters.recovered_state !== undefined && projection.state !== filters.recovered_state) return false;
    if (filters.health_states !== undefined && !filters.health_states.includes(projection.state)) return false;
    if (filters.severities !== undefined && !filters.severities.includes(projection.severity)) return false;
    if (filters.candidate_only === true && projection.candidate_predicate === undefined) return false;
    return true;
  }

  private async assertPlanItemVisible(
    planItemId: string,
    actorContext: ActorContext,
    repository: DeliveryRepository = this.repository,
  ): Promise<void> {
    const item = await repository.getDevelopmentPlanItem(planItemId);
    const plan = item === undefined ? undefined : await repository.getDevelopmentPlan(item.development_plan_id);
    if (item === undefined || plan === undefined) {
      throw new DomainError(
        'session_operations_no_active_workflow',
        `session_operations_no_active_workflow: Plan Item ${planItemId} was not found`,
      );
    }
    await this.assertProjectVisible(plan.project_id, actorContext, repository);
  }

  private async assertProjectionVisible(
    projection: Pick<PlanItemSessionHealth, 'project_id'>,
    actorContext: ActorContext,
    repository: DeliveryRepository = this.repository,
  ): Promise<void> {
    await this.assertProjectVisible(projection.project_id, actorContext, repository);
  }

  private async projectionVisible(
    projection: Pick<PlanItemSessionHealth, 'project_id'>,
    actorContext: ActorContext,
  ): Promise<boolean> {
    try {
      await this.assertProjectVisible(projection.project_id, actorContext, this.repository);
      return true;
    } catch (error) {
      if (error instanceof DomainError && error.code === 'session_operations_unauthorized') {
        return false;
      }
      throw error;
    }
  }

  private async assertProjectVisible(
    projectId: string,
    actorContext: ActorContext,
    repository: DeliveryRepository,
  ): Promise<void> {
    const actorId = this.requireActor(actorContext);
    const actor = await repository.getActor(actorId);
    const project = await repository.getProject(projectId);
    if (
      actor === undefined ||
      project === undefined ||
      project.org_id === undefined ||
      actor.org_id !== project.org_id
    ) {
      throw new DomainError(
        'session_operations_unauthorized',
        'session_operations_unauthorized: actor is outside the Session Operations project scope',
      );
    }
  }

  private requireActor(actorContext: ActorContext): string {
    if (actorContext.authenticatedActorId === undefined) {
      throw new DomainError('session_operations_unauthorized', 'session_operations_unauthorized: signed actor context is required');
    }
    return actorContext.authenticatedActorId;
  }

  private assertOperator(actorContext: ActorContext): void {
    this.requireActor(actorContext);
    if (actorContext.actorClass !== 'human_admin') {
      throw new DomainError('session_operations_unauthorized', 'session_operations_unauthorized: human admin operator scope is required');
    }
  }
}
