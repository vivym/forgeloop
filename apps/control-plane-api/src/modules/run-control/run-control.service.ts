import { randomUUID } from 'node:crypto';

import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { MessageEvent } from '@nestjs/common';
import type {
  ExecutorType,
  PublicRunEvent,
  RunAcceptedResponse,
  RunEventListResponse,
  RunOperatorCommandResponse,
} from '@forgeloop/contracts';
import { publicRunEventSchema } from '@forgeloop/contracts';
import type { DeliveryRepository } from '@forgeloop/db';
import {
  DomainError,
  type ExecutionPackage,
  type ObjectEvent,
  type RunCommand,
  type RunEvent,
  type RunRuntimeMetadata,
  type RunSession,
  transitionExecutionPackage,
  transitionRunSession,
} from '@forgeloop/domain';
import type { RunWorker } from '@forgeloop/run-worker';
import { buildRunSpec, loadRunContext } from '@forgeloop/workflow';
import { Observable } from 'rxjs';

import { AuditWriterService } from '../audit/audit-writer.service';
import type { ActorContext } from '../auth/actor-context';
import { ControlPlaneRuntimeService } from '../core/control-plane-runtime.service';
import {
  DELIVERY_REPOSITORY,
  RUN_DURABILITY_MODE,
  type RunDurabilityMode,
} from '../core/control-plane-tokens';
import type { RunControlDto, RunInputDto } from '../delivery/dto';
import { serializePublicRunSession } from '../query/public-run-session-projection';
import {
  createRunEventStreamToken as signRunEventStreamToken,
  resolveRunEventStreamTokenSecret,
  type RunEventStreamTokenPayload,
  verifyRunEventStreamToken,
} from './run-event-stream-token';
import { DELIVERY_RUN_WORKER } from './run-worker.token';

type RunEventAccessOptions = {
  after?: string;
  actorContext?: ActorContext;
  streamToken?: string;
};

const terminalRunStatuses = new Set<RunSession['status']>(['succeeded', 'failed', 'timed_out', 'cancelled']);
const streamPollMs = 500;
const runEventStreamTokenTtlMs = 60_000;
const beginningOfStreamCursor = '0000000000';

@Injectable()
export class RunControlService {
  constructor(
    @Inject(DELIVERY_REPOSITORY) private readonly repository: DeliveryRepository,
    @Inject(DELIVERY_RUN_WORKER) private readonly runWorker: RunWorker,
    @Inject(RUN_DURABILITY_MODE) private readonly durabilityMode: RunDurabilityMode,
    @Inject(ControlPlaneRuntimeService) private readonly controlPlaneRuntime: ControlPlaneRuntimeService,
    @Inject(AuditWriterService) private readonly audit: AuditWriterService,
  ) {}

  rejectRetiredExecutionPackageStart(
    packageId: string,
    mode: 'run' | 'rerun' | 'force_rerun',
  ): never {
    throw this.legacyExecutionEntrypointDisabled(packageId, mode);
  }

  async getRunSession(runSessionId: string): Promise<RunSession> {
    return serializePublicRunSession(
      await this.withWorkerLeaseMetadata(
        this.requireFound(await this.repository.getRunSession(runSessionId), `RunSession ${runSessionId}`),
      ),
    );
  }

  async listRunEvents(runSessionId: string, options: RunEventAccessOptions = {}): Promise<RunEventListResponse> {
    const runSession = this.requireFound(await this.repository.getRunSession(runSessionId), `RunSession ${runSessionId}`);
    const actorId = this.resolveStreamActor(runSession, {
      ...(options.actorContext === undefined ? {} : { actorContext: options.actorContext }),
      ...(options.streamToken === undefined ? {} : { streamToken: options.streamToken }),
    });
    await this.assertRunViewerAllowed(runSession, actorId);
    const rawEvents = await this.repository.listRunEvents(runSessionId, options.after === undefined ? {} : { after: options.after });
    const events = this.publicRunEvents(rawEvents);
    return {
      events,
      next_cursor: rawEvents.at(-1)?.cursor ?? options.after ?? beginningOfStreamCursor,
      has_more: false,
    };
  }

  async streamRunEvents(runSessionId: string, options: RunEventAccessOptions = {}): Promise<Observable<MessageEvent>> {
    await this.assertRunEventViewer(runSessionId, options);

    return new Observable<MessageEvent>((subscriber) => {
      let stopped = false;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      let cursor: string | undefined;

      const poll = async (): Promise<void> => {
        try {
          if (cursor === undefined) {
            cursor = await this.resolveRunEventStreamCursor(runSessionId, options.after);
          }
          const response = await this.listRunEvents(runSessionId, {
            ...(cursor === undefined ? {} : { after: cursor }),
            ...(options.streamToken === undefined ? {} : { streamToken: options.streamToken }),
            ...(options.actorContext === undefined ? {} : { actorContext: options.actorContext }),
          });
          for (const event of response.events) {
            cursor = event.cursor;
            subscriber.next({ data: event });
          }
          if (!stopped) {
            timeout = setTimeout(() => {
              void poll();
            }, streamPollMs);
          }
        } catch (error) {
          subscriber.error(error);
        }
      };

      void poll();
      return () => {
        stopped = true;
        if (timeout !== undefined) {
          clearTimeout(timeout);
        }
      };
    });
  }

  async resolveRunEventStreamCursor(runSessionId: string, after: string | undefined): Promise<string> {
    if (after !== undefined) {
      return after;
    }

    const latest = await this.repository.getLatestRunEvent(runSessionId);
    return latest?.cursor ?? beginningOfStreamCursor;
  }

  async assertRunEventViewer(runSessionId: string, options: RunEventAccessOptions): Promise<void> {
    const runSession = this.requireFound(await this.repository.getRunSession(runSessionId), `RunSession ${runSessionId}`);
    const actorId = this.resolveStreamActor(runSession, {
      ...(options.actorContext === undefined ? {} : { actorContext: options.actorContext }),
      ...(options.streamToken === undefined ? {} : { streamToken: options.streamToken }),
    });
    await this.assertRunViewerAllowed(runSession, actorId);
  }

  async createRunInputCommand(
    runSessionId: string,
    dto: RunInputDto,
    actorContext: ActorContext = {},
    workflowId?: string,
  ): Promise<RunOperatorCommandResponse> {
    return this.createRunOperatorCommand(runSessionId, 'input', {
      actorContext,
      payload: { message: dto.message },
      ...(dto.target_turn_id === undefined ? {} : { targetTurnId: dto.target_turn_id }),
      eventSummary: 'User input submitted.',
      ...(workflowId === undefined ? {} : { workflowId }),
    });
  }

  async createRunCancelCommand(
    runSessionId: string,
    dto: RunControlDto,
    actorContext: ActorContext = {},
    workflowId?: string,
  ): Promise<RunOperatorCommandResponse> {
    return this.createRunOperatorCommand(runSessionId, 'cancel', {
      actorContext,
      payload: dto.reason === undefined ? {} : { reason: dto.reason },
      eventSummary: 'Cancel requested.',
      ...(workflowId === undefined ? {} : { workflowId }),
    });
  }

  async createRunResumeCommand(
    runSessionId: string,
    dto: RunControlDto,
    actorContext: ActorContext = {},
    workflowId?: string,
  ): Promise<RunOperatorCommandResponse> {
    return this.createRunOperatorCommand(runSessionId, 'resume', {
      actorContext,
      payload: dto.reason === undefined ? {} : { reason: dto.reason },
      eventSummary: 'Run resume requested.',
      ...(workflowId === undefined ? {} : { workflowId }),
    });
  }

  async createRunEventStreamToken(
    runSessionId: string,
    actorContext: ActorContext = {},
  ): Promise<{ token: string; expires_at: string }> {
    const runSession = this.requireFound(await this.repository.getRunSession(runSessionId), `RunSession ${runSessionId}`);
    const actorId = this.resolveRunActor({
      ...(actorContext.authenticatedActorId === undefined ? {} : { authenticatedActorId: actorContext.authenticatedActorId }),
    });
    await this.assertRunViewerAllowed(runSession, actorId);

    const expiresAt = new Date(Date.now() + runEventStreamTokenTtlMs).toISOString();
    const payload: RunEventStreamTokenPayload = {
      run_session_id: runSession.id,
      actor_id: actorId,
      expires_at: expiresAt,
      nonce: randomUUID(),
    };
    return {
      token: signRunEventStreamToken(payload, resolveRunEventStreamTokenSecret(process.env)),
      expires_at: expiresAt,
    };
  }

  async withWorkerLeaseMetadata(runSession: RunSession): Promise<RunSession> {
    const lease = await this.repository.getRunWorkerLease(runSession.id);
    if (lease === undefined) {
      return runSession;
    }

    return {
      ...runSession,
      runtime_metadata: {
        ...(runSession.runtime_metadata ?? this.initialRuntimeMetadata()),
        worker_id: lease.worker_id,
        worker_lease_status: lease.status,
        worker_lease_heartbeat_at: lease.heartbeat_at,
        worker_lease_expires_at: lease.expires_at,
      },
    };
  }

  async assertRunViewerAllowed(runSession: RunSession, actorId: string): Promise<void> {
    const executionPackage = this.requireFound(
      await this.repository.getExecutionPackage(runSession.execution_package_id),
      `ExecutionPackage ${runSession.execution_package_id}`,
    );
    const workItem = this.requireFound(await this.repository.getWorkItem(executionPackage.work_item_id), `WorkItem ${executionPackage.work_item_id}`);
    const allowed = new Set([
      workItem.driver_actor_id,
      executionPackage.owner_actor_id,
      executionPackage.reviewer_actor_id,
      executionPackage.qa_owner_actor_id,
    ]);

    if (!allowed.has(actorId)) {
      throw new ForbiddenException(`Actor ${actorId} cannot view run ${runSession.id}`);
    }
  }

  async assertRunOperatorAllowed(runSession: RunSession, actorId: string): Promise<void> {
    const executionPackage = this.requireFound(
      await this.repository.getExecutionPackage(runSession.execution_package_id),
      `ExecutionPackage ${runSession.execution_package_id}`,
    );
    if (actorId !== executionPackage.owner_actor_id && actorId !== executionPackage.reviewer_actor_id) {
      throw new ForbiddenException(`Actor ${actorId} cannot operate run ${runSession.id}`);
    }
  }

  async createRunOperatorCommand(
    runSessionId: string,
    commandType: RunCommand['command_type'],
    input: {
      actorContext?: ActorContext;
      payload: Record<string, unknown>;
      targetTurnId?: string;
      eventSummary: string;
      workflowId?: string;
    },
  ): Promise<RunOperatorCommandResponse> {
    const runSession = this.requireFound(await this.repository.getRunSession(runSessionId), `RunSession ${runSessionId}`);
    this.assertRunCommandTargetIsNonTerminal(runSession);
    await this.assertWorkflowRunSessionFence(runSession, input.workflowId);
    const actorId = this.resolveRunActor({
      ...(input.actorContext?.authenticatedActorId === undefined ? {} : { authenticatedActorId: input.actorContext.authenticatedActorId }),
    });
    await this.assertRunOperatorAllowed(runSession, actorId);

    const at = this.now();
    if (commandType === 'cancel') {
      await this.repository.supersedePendingRunCommands(runSessionId, ['input'], at);
    }

    const command: RunCommand = {
      id: this.id('run-command'),
      run_session_id: runSessionId,
      command_type: commandType,
      status: 'pending',
      actor_id: actorId,
      payload: input.payload,
      ...(input.targetTurnId === undefined ? {} : { target_turn_id: input.targetTurnId }),
      created_at: at,
      updated_at: at,
    };

    await this.repository.saveRunCommand(command);

    if (commandType === 'cancel') {
      await this.repository.saveRunSession(transitionRunSession(runSession, { type: 'cancel_requested', at }));
    }
    if (commandType === 'resume') {
      await this.repository.saveRunSession(transitionRunSession(runSession, { type: 'resume_requested', at }));
    }

    await this.repository.appendRunEvent({
      id: this.id('run-event'),
      run_session_id: runSessionId,
      event_type: commandType === 'input' ? 'user_input' : commandType === 'cancel' ? 'cancel_requested' : 'resuming',
      source: commandType === 'input' ? 'user' : 'api',
      visibility: 'public',
      summary: input.eventSummary,
      payload: { command_id: command.id, actor_id: actorId, ...input.payload },
      created_at: at,
    });

    this.kickRunWorker();
    return {
      status: 'accepted',
      command_id: command.id,
      run_session_id: runSessionId,
      command_type: commandType,
    };
  }

  enqueueRunWithRepository(
    repository: DeliveryRepository,
    executionPackage: ExecutionPackage,
    input: {
      actorContext: ActorContext;
      automationPrecondition: { daemon_identity?: string };
      executorType: ExecutorType;
      workflowOnly: boolean;
    },
  ): Promise<RunAcceptedResponse> {
    return this.enqueueRunWithRepositoryInternal(repository, executionPackage, input);
  }

  kickRunWorker(): void {
    try {
      this.runWorker.kick();
    } catch {
      // The durable repository state is authoritative; kick is only an in-process wake-up.
    }
  }

  private async enqueueRunWithRepositoryInternal(
    repository: DeliveryRepository,
    executionPackage: ExecutionPackage,
    input: {
      actorContext: ActorContext;
      automationPrecondition: { daemon_identity?: string };
      executorType: ExecutorType;
      workflowOnly: boolean;
    },
  ): Promise<RunAcceptedResponse> {
    const packageId = executionPackage.id;
    const requestedByActorId = this.resolveRunActor({
      ...(input.actorContext.authenticatedActorId === undefined ? {} : { authenticatedActorId: input.actorContext.authenticatedActorId }),
      ...(input.actorContext.daemonIdentity === undefined && input.automationPrecondition.daemon_identity === undefined
        ? {}
        : { systemActorId: input.actorContext.daemonIdentity ?? input.automationPrecondition.daemon_identity }),
    });
    const executorType: ExecutorType = input.workflowOnly ? 'mock' : input.executorType;
    const runSessionId = this.id('run-session');
    const queuedAt = this.now();
    const queuedPackage = transitionExecutionPackage(executionPackage, {
      type: 'run',
      run_session_id: runSessionId,
      at: queuedAt,
    });
    const runSession = transitionRunSession(undefined, {
      type: 'create',
      id: runSessionId,
      execution_package_id: packageId,
      requested_by_actor_id: requestedByActorId,
      executor_type: executorType,
      at: queuedAt,
    });
    await repository.saveExecutionPackage(queuedPackage);
    await repository.saveRunSession({
      ...runSession,
      ...(executionPackage.workflow_id === undefined ? {} : { workflow_id: executionPackage.workflow_id }),
      ...(executionPackage.codex_session_id === undefined ? {} : { codex_session_id: executionPackage.codex_session_id }),
      ...(executionPackage.codex_session_turn_id === undefined ? {} : { codex_session_turn_id: executionPackage.codex_session_turn_id }),
      runtime_metadata: this.initialRuntimeMetadata(),
    });
    const context = await loadRunContext(repository, runSessionId);
    const runSpec = buildRunSpec(context, { defaultExecutorType: executorType, workflowOnly: input.workflowOnly });
    await repository.saveRunSession({
      ...runSession,
      ...(executionPackage.workflow_id === undefined ? {} : { workflow_id: executionPackage.workflow_id }),
      ...(executionPackage.codex_session_id === undefined ? {} : { codex_session_id: executionPackage.codex_session_id }),
      ...(executionPackage.codex_session_turn_id === undefined ? {} : { codex_session_turn_id: executionPackage.codex_session_turn_id }),
      executor_type: executorType,
      run_spec: runSpec,
      runtime_metadata: this.initialRuntimeMetadata(),
    });
    await repository.appendRunEvent({
      id: this.id('run-event'),
      run_session_id: runSessionId,
      event_type: 'run_queued',
      source: 'api',
      visibility: 'public',
      summary: 'Run queued.',
      payload: { execution_package_id: packageId, mode: 'run', workflow_only: input.workflowOnly, executor_type: executorType },
      created_at: queuedAt,
    });
    await this.eventWithRepository(repository, 'execution_package', packageId, 'run_requested', requestedByActorId, {
      run_session_id: runSessionId,
    });

    this.kickRunWorker();
    return {
      status: 'accepted',
      run_session_id: runSessionId,
      execution_package_id: packageId,
    };
  }

  private initialRuntimeMetadata(): RunRuntimeMetadata {
    return {
      durability_mode: this.durabilityMode,
      recovery_attempt_count: 0,
      effective_dangerous_mode: 'not_requested',
    };
  }

  private publicRunEvents(events: RunEvent[]): PublicRunEvent[] {
    return events
      .filter((event) => event.visibility === 'public')
      .map((event) => {
        const { raw_ref: _rawRef, ...publicEvent } = event;
        return publicRunEventSchema.parse(publicEvent);
      });
  }

  private resolveRunActor(input: { authenticatedActorId?: string; systemActorId?: string }): string {
    if (input.authenticatedActorId !== undefined && input.authenticatedActorId.trim().length > 0) {
      return input.authenticatedActorId;
    }

    if (input.systemActorId !== undefined && input.systemActorId.trim().length > 0) {
      return input.systemActorId;
    }

    throw new UnauthorizedException('Authenticated actor is required');
  }

  private resolveStreamActor(
    runSession: RunSession,
    input: { actorContext?: ActorContext; streamToken?: string },
  ): string {
    if (input.streamToken !== undefined) {
      let payload: RunEventStreamTokenPayload;
      try {
        payload = verifyRunEventStreamToken(input.streamToken, resolveRunEventStreamTokenSecret(process.env));
      } catch (error) {
        throw new UnauthorizedException(error instanceof Error ? error.message : 'Invalid run event stream token');
      }

      if (payload.run_session_id !== runSession.id) {
        throw new UnauthorizedException('Run event stream token does not match run session');
      }

      return payload.actor_id;
    }

    return this.resolveRunActor({
      ...(input.actorContext?.authenticatedActorId === undefined ? {} : { authenticatedActorId: input.actorContext.authenticatedActorId }),
    });
  }

  private assertRunCommandTargetIsNonTerminal(runSession: RunSession): void {
    if (terminalRunStatuses.has(runSession.status)) {
      throw new BadRequestException(`RunSession ${runSession.id} is terminal`);
    }
  }

  private async eventWithRepository(
    repository: DeliveryRepository,
    objectType: string,
    objectId: string,
    eventType: string,
    actorId: string | undefined,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    const objectEvent: ObjectEvent = {
      id: this.id('event'),
      object_type: objectType,
      object_id: objectId,
      event_type: eventType,
      ...(actorId !== undefined ? { actor_id: actorId } : {}),
      metadata,
      created_at: this.now(),
    };
    await this.audit.objectEvent(objectEvent, repository);
  }

  private id(prefix: string): string {
    return this.controlPlaneRuntime.id(prefix);
  }

  private now(): string {
    return this.controlPlaneRuntime.now();
  }

  private required(value: string | undefined, field: string): string {
    if (value === undefined || value.trim().length === 0) {
      throw new BadRequestException(`${field} is required`);
    }
    return value;
  }

  private requireFound<T>(value: T | undefined, description: string): T {
    if (value === undefined) {
      throw new NotFoundException(`${description} not found`);
    }
    return value;
  }

  private legacyExecutionEntrypointDisabled(packageId: string, mode: 'run' | 'rerun' | 'force_rerun'): DomainError {
    return new DomainError(
      'legacy_execution_entrypoint_disabled',
      `legacy_execution_entrypoint_disabled: Execution Package ${packageId} ${mode} must use PlanItemWorkflowService`,
    );
  }

  private async assertWorkflowRunSessionFence(runSession: RunSession, workflowId?: string): Promise<void> {
    if (runSession.workflow_id === undefined) {
      return;
    }
    if (runSession.workflow_id === workflowId) {
      return;
    }
    throw new DomainError(
      'workflow_legacy_entrypoint_disabled',
      `workflow_legacy_entrypoint_disabled: Run Session ${runSession.id} commands must use PlanItemWorkflowService`,
    );
  }
}
