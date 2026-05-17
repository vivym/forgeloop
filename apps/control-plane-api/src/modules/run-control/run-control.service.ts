import { randomUUID } from 'node:crypto';

import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
  UnprocessableEntityException,
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
import type { DeliveryRepository, TraceLinkRecord } from '@forgeloop/db';
import {
  DomainError,
  type ExecutionPackage,
  type ObjectEvent,
  type ReviewPacket,
  type RunCommand,
  type RunEvent,
  type RunRuntimeMetadata,
  type RunSession,
  transitionExecutionPackage,
  transitionRunSession,
  validateForceRerunAllowed,
} from '@forgeloop/domain';
import type { RunWorker } from '@forgeloop/run-worker';
import { buildRunSpec, loadRunContext } from '@forgeloop/workflow';
import { Observable } from 'rxjs';

import { AuditWriterService } from '../audit/audit-writer.service';
import type { ActorContext } from '../auth/actor-context';
import { ControlPlaneRuntimeService } from '../core/control-plane-runtime.service';
import {
  DELIVERY_DEMO_ACTOR_ID_FALLBACK,
  DELIVERY_REPOSITORY,
  RUN_DURABILITY_MODE,
  type RunDurabilityMode,
} from '../core/control-plane-tokens';
import type { RunControlDto, RunInputDto, RunPackageDto } from '../delivery/dto';
import { ExecutionPackageService } from '../execution-packages/execution-package.service';
import { serializePublicRunSession } from '../query/public-run-session-projection';
import { ReviewEvidenceService } from '../review-evidence/review-evidence.service';
import {
  createRunEventStreamToken as signRunEventStreamToken,
  resolveRunEventStreamTokenSecret,
  type RunEventStreamTokenPayload,
  verifyRunEventStreamToken,
} from './run-event-stream-token';
import { DELIVERY_RUN_WORKER } from './run-worker.token';

type RunReplacementRecordedPayload = {
  mode: 'rerun_package' | 'force_rerun_package';
  execution_package_id: string;
  work_item_id: string;
  new_run_session_id: string;
  previous_run_session_id: string;
  triggering_review_packet_id?: string;
  previous_review_packet_id?: string;
  new_review_packet_id?: string;
};

type RunEventAccessOptions = {
  after?: string;
  actorId?: string;
  actorContext?: ActorContext;
  streamToken?: string;
};

const traceReplacementModeFor = (mode: 'rerun' | 'force_rerun'): RunReplacementRecordedPayload['mode'] =>
  mode === 'rerun' ? 'rerun_package' : 'force_rerun_package';

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
    @Inject(DELIVERY_DEMO_ACTOR_ID_FALLBACK) private readonly allowDemoActorIdFallback: boolean,
    @Inject(ControlPlaneRuntimeService) private readonly controlPlaneRuntime: ControlPlaneRuntimeService,
    @Inject(ExecutionPackageService) private readonly executionPackageService: ExecutionPackageService,
    @Inject(AuditWriterService) private readonly audit: AuditWriterService,
    @Inject(ReviewEvidenceService) private readonly reviewEvidenceService: ReviewEvidenceService,
  ) {}

  async runPackage(
    packageId: string,
    dto: RunPackageDto,
    mode: 'run' | 'rerun' | 'force_rerun',
    actorContext: ActorContext = {},
  ): Promise<RunAcceptedResponse> {
    const result = await this.repository.withObjectLock(`execution-package:${packageId}`, async (repository) =>
      this.runPackageWithRepository(repository, packageId, dto, mode, actorContext),
    );
    this.kickRunWorker();
    return result;
  }

  async runPackageWithRepository(
    repository: DeliveryRepository,
    packageId: string,
    dto: RunPackageDto,
    mode: 'run' | 'rerun' | 'force_rerun',
    actorContext: ActorContext,
  ): Promise<RunAcceptedResponse> {
    const executionPackage = this.requireFound(await repository.getExecutionPackage(packageId), `ExecutionPackage ${packageId}`);
    await this.executionPackageService.assertExecutionPackageGraphStillCurrent(repository, executionPackage);
    const reviewPackets = await repository.listReviewPacketsForPackage(packageId);
    const requestedByActorId = this.resolveRunActor({
      ...(actorContext.authenticatedActorId === undefined ? {} : { authenticatedActorId: actorContext.authenticatedActorId }),
      ...(dto.requested_by_actor_id === undefined ? {} : { demoActorId: dto.requested_by_actor_id }),
    });
    if (mode === 'run') {
      const activeRunSession = await repository.findActiveRunSessionForPackage(packageId);
      if (activeRunSession !== undefined) {
        throw new UnprocessableEntityException({
          code: 'automation_gate_pending',
          message: 'Active run session blocks duplicate run enqueue.',
        });
      }
      const openReviewPacket = await repository.findOpenReviewPacketForPackage(packageId);
      if (openReviewPacket !== undefined) {
        throw new UnprocessableEntityException({
          code: 'automation_gate_pending',
          message: 'Open review packet blocks run enqueue.',
        });
      }
    }
    const validation = this.validateRunRequest(packageId, executionPackage, reviewPackets, dto, mode, requestedByActorId);
    const previousReviewPacket =
      mode === 'run'
        ? undefined
        : reviewPackets.find((reviewPacket) => reviewPacket.run_session_id === validation.previousRunSessionId);
    if (mode === 'force_rerun' && validation.currentOpenReviewPacket !== undefined) {
      try {
        validateForceRerunAllowed(executionPackage, reviewPackets, validation.requestedByActorId);
      } catch (error) {
        if (error instanceof DomainError && error.code === 'FORCE_RERUN_FORBIDDEN') {
          throw new ForbiddenException(error.message);
        }
        throw error;
      }
      await this.reviewEvidenceService.archiveReviewPacket(validation.currentOpenReviewPacket, 'force_rerun', repository);
    }
    const workflowOnly = dto.workflow_only ?? false;
    const executorType: ExecutorType = workflowOnly ? 'mock' : (dto.executor_type ?? 'mock');
    const runSessionId = this.id('run-session');
    const queuedAt = this.now();
    const queuedPackage =
      mode === 'force_rerun'
        ? transitionExecutionPackage(executionPackage, {
            type: 'force_rerun',
            run_session_id: runSessionId,
            has_open_review_packet: true,
            at: queuedAt,
          })
        : transitionExecutionPackage(executionPackage, {
            type: mode,
            run_session_id: runSessionId,
            at: queuedAt,
          });
    const runSession = transitionRunSession(undefined, {
      type: 'create',
      id: runSessionId,
      execution_package_id: packageId,
      requested_by_actor_id: validation.requestedByActorId,
      executor_type: executorType,
      at: queuedAt,
    });
    await repository.saveExecutionPackage(queuedPackage);
    await repository.saveRunSession({
      ...runSession,
      runtime_metadata: this.initialRuntimeMetadata(),
    });
    const context = await loadRunContext(repository, runSessionId);
    const runSpec = buildRunSpec(context, { defaultExecutorType: executorType, workflowOnly });
    await repository.saveRunSession({
      ...runSession,
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
      payload: { execution_package_id: packageId, mode, workflow_only: workflowOnly, executor_type: executorType },
      created_at: queuedAt,
    });
    await this.eventWithRepository(
      repository,
      'execution_package',
      packageId,
      mode === 'force_rerun' ? 'force_rerun_requested' : `${mode}_requested`,
      validation.requestedByActorId,
      { run_session_id: runSessionId },
    );
    if (mode !== 'run' && validation.previousRunSessionId !== undefined) {
      const triggeringReviewPacket = validation.currentOpenReviewPacket ?? previousReviewPacket;
      await this.recordRunReplacementTrace({
        repository,
        mode,
        executionPackage: queuedPackage,
        previousRunSessionId: validation.previousRunSessionId,
        newRunSessionId: runSessionId,
        requestedByActorId: validation.requestedByActorId,
        ...(previousReviewPacket === undefined ? {} : { previousReviewPacket }),
        ...(triggeringReviewPacket === undefined ? {} : { triggeringReviewPacket }),
        at: queuedAt,
      });
    }

    return {
      status: 'accepted',
      run_session_id: runSessionId,
      execution_package_id: packageId,
    };
  }

  runPackageReplacementContext(
    packageId: string,
    executionPackage: ExecutionPackage,
    reviewPackets: ReviewPacket[],
    dto: RunPackageDto,
    mode: 'run' | 'rerun' | 'force_rerun',
    requestedByActorId: string,
  ): { requestedByActorId: string; previousRunSessionId?: string; currentOpenReviewPacket?: ReviewPacket } {
    return this.validateRunRequest(packageId, executionPackage, reviewPackets, dto, mode, requestedByActorId);
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
      ...(options.actorId === undefined ? {} : { demoActorId: options.actorId }),
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
            ...(options.actorId === undefined ? {} : { actorId: options.actorId }),
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
      ...(options.actorId === undefined ? {} : { demoActorId: options.actorId }),
      ...(options.streamToken === undefined ? {} : { streamToken: options.streamToken }),
    });
    await this.assertRunViewerAllowed(runSession, actorId);
  }

  async createRunInputCommand(
    runSessionId: string,
    dto: RunInputDto,
    actorContext: ActorContext = {},
  ): Promise<RunOperatorCommandResponse> {
    return this.createRunOperatorCommand(runSessionId, 'input', {
      actorContext,
      ...(dto.actor_id === undefined ? {} : { demoActorId: dto.actor_id }),
      payload: { message: dto.message },
      ...(dto.target_turn_id === undefined ? {} : { targetTurnId: dto.target_turn_id }),
      eventSummary: 'User input submitted.',
    });
  }

  async createRunCancelCommand(
    runSessionId: string,
    dto: RunControlDto,
    actorContext: ActorContext = {},
  ): Promise<RunOperatorCommandResponse> {
    return this.createRunOperatorCommand(runSessionId, 'cancel', {
      actorContext,
      ...(dto.actor_id === undefined ? {} : { demoActorId: dto.actor_id }),
      payload: dto.reason === undefined ? {} : { reason: dto.reason },
      eventSummary: 'Cancel requested.',
    });
  }

  async createRunResumeCommand(
    runSessionId: string,
    dto: RunControlDto,
    actorContext: ActorContext = {},
  ): Promise<RunOperatorCommandResponse> {
    return this.createRunOperatorCommand(runSessionId, 'resume', {
      actorContext,
      ...(dto.actor_id === undefined ? {} : { demoActorId: dto.actor_id }),
      payload: dto.reason === undefined ? {} : { reason: dto.reason },
      eventSummary: 'Run resume requested.',
    });
  }

  async createRunEventStreamToken(
    runSessionId: string,
    actorContext: ActorContext = {},
    options: { demoActorId?: string } = {},
  ): Promise<{ token: string; expires_at: string }> {
    const runSession = this.requireFound(await this.repository.getRunSession(runSessionId), `RunSession ${runSessionId}`);
    const actorId = this.resolveRunActor({
      ...(actorContext.authenticatedActorId === undefined ? {} : { authenticatedActorId: actorContext.authenticatedActorId }),
      ...(options.demoActorId === undefined ? {} : { demoActorId: options.demoActorId }),
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
      workItem.owner_actor_id,
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
      demoActorId?: string;
      payload: Record<string, unknown>;
      targetTurnId?: string;
      eventSummary: string;
    },
  ): Promise<RunOperatorCommandResponse> {
    const runSession = this.requireFound(await this.repository.getRunSession(runSessionId), `RunSession ${runSessionId}`);
    this.assertRunCommandTargetIsNonTerminal(runSession);
    const actorId = this.resolveRunActor({
      ...(input.actorContext?.authenticatedActorId === undefined ? {} : { authenticatedActorId: input.actorContext.authenticatedActorId }),
      ...(input.demoActorId === undefined ? {} : { demoActorId: input.demoActorId }),
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

  async recordRunReplacementTrace(input: {
    repository?: DeliveryRepository;
    mode: 'rerun' | 'force_rerun';
    executionPackage: ExecutionPackage;
    previousRunSessionId: string;
    newRunSessionId: string;
    requestedByActorId: string;
    previousReviewPacket?: ReviewPacket;
    triggeringReviewPacket?: ReviewPacket;
    at: string;
  }): Promise<void> {
    await this.reviewEvidenceService.bestEffortTraceWrite(async () => {
      const repository = input.repository ?? this.repository;
      const traceEventId = `trace-event:run-replacement:${input.newRunSessionId}`;
      const payload: RunReplacementRecordedPayload = {
        mode: traceReplacementModeFor(input.mode),
        execution_package_id: input.executionPackage.id,
        work_item_id: input.executionPackage.work_item_id,
        new_run_session_id: input.newRunSessionId,
        previous_run_session_id: input.previousRunSessionId,
        ...(input.triggeringReviewPacket === undefined ? {} : { triggering_review_packet_id: input.triggeringReviewPacket.id }),
        ...(input.previousReviewPacket === undefined ? {} : { previous_review_packet_id: input.previousReviewPacket.id }),
      };

      await this.audit.traceEvent(
        {
          id: traceEventId,
          event_type: 'run_replacement_recorded',
          subject_type: 'run_session',
          subject_id: input.newRunSessionId,
          actor_id: input.requestedByActorId,
          summary: `Run ${input.newRunSessionId} replaces ${input.previousRunSessionId}.`,
          payload,
          created_at: input.at,
        },
        repository,
      );

      const links = [
        this.traceLink(traceEventId, 'belongs_to', 'work_item', input.executionPackage.work_item_id, input.at),
        this.traceLink(traceEventId, 'belongs_to', 'execution_package', input.executionPackage.id, input.at),
        this.traceLink(traceEventId, 'generated_by', 'run_session', input.newRunSessionId, input.at),
        this.traceLink(traceEventId, 'supersedes', 'run_session', input.previousRunSessionId, input.at),
      ];
      if (input.previousReviewPacket !== undefined) {
        links.push(this.traceLink(traceEventId, 'replaces', 'review_packet', input.previousReviewPacket.id, input.at));
      }
      if (input.triggeringReviewPacket !== undefined) {
        links.push(this.traceLink(traceEventId, 'belongs_to', 'review_packet', input.triggeringReviewPacket.id, input.at));
      }

      for (const link of links) {
        await this.audit.traceLink(link, repository);
      }
    });
  }

  kickRunWorker(): void {
    try {
      this.runWorker.kick();
    } catch {
      // The durable repository state is authoritative; kick is only an in-process wake-up.
    }
  }

  private validateRunRequest(
    packageId: string,
    executionPackage: ExecutionPackage,
    reviewPackets: ReviewPacket[],
    dto: RunPackageDto,
    mode: 'run' | 'rerun' | 'force_rerun',
    requestedByActorId: string,
  ): { requestedByActorId: string; previousRunSessionId?: string; currentOpenReviewPacket?: ReviewPacket } {
    if (dto.execution_package_id !== undefined && dto.execution_package_id !== packageId) {
      throw new BadRequestException('execution_package_id must match packageId path parameter');
    }

    if (mode === 'run') {
      return { requestedByActorId };
    }

    const previousRunSessionId = this.required(dto.previous_run_session_id, 'previous_run_session_id');
    if (executionPackage.last_run_session_id !== previousRunSessionId) {
      throw new BadRequestException('previous_run_session_id must match the package current last_run_session_id');
    }

    if (mode === 'rerun') {
      return { requestedByActorId, previousRunSessionId };
    }

    if (dto.force !== true) {
      throw new BadRequestException('force must be true for force-rerun');
    }
    this.required(dto.force_reason, 'force_reason');

    const currentOpenReviewPacket = reviewPackets.find(
      (reviewPacket) =>
        reviewPacket.run_session_id === previousRunSessionId &&
        reviewPacket.decision === 'none' &&
        (reviewPacket.status === 'ready' || reviewPacket.status === 'in_review'),
    );

    if (currentOpenReviewPacket === undefined) {
      throw new BadRequestException('force-rerun requires a current open ready or in_review ReviewPacket');
    }

    return { requestedByActorId, previousRunSessionId, currentOpenReviewPacket };
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
      demoActorId: input.actorContext.authenticatedActorId ?? input.automationPrecondition.daemon_identity ?? 'automation-daemon',
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
      runtime_metadata: this.initialRuntimeMetadata(),
    });
    const context = await loadRunContext(repository, runSessionId);
    const runSpec = buildRunSpec(context, { defaultExecutorType: executorType, workflowOnly: input.workflowOnly });
    await repository.saveRunSession({
      ...runSession,
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

  private resolveRunActor(input: { authenticatedActorId?: string; demoActorId?: string }): string {
    if (input.authenticatedActorId !== undefined && input.authenticatedActorId.trim().length > 0) {
      return input.authenticatedActorId;
    }

    if (this.allowDemoActorIdFallback && this.durabilityMode === 'volatile_demo') {
      return this.required(input.demoActorId, 'actor_id');
    }

    throw new UnauthorizedException('Authenticated actor is required');
  }

  private resolveStreamActor(
    runSession: RunSession,
    input: { actorContext?: ActorContext; demoActorId?: string; streamToken?: string },
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
      ...(input.demoActorId === undefined ? {} : { demoActorId: input.demoActorId }),
    });
  }

  private assertRunCommandTargetIsNonTerminal(runSession: RunSession): void {
    if (terminalRunStatuses.has(runSession.status)) {
      throw new BadRequestException(`RunSession ${runSession.id} is terminal`);
    }
  }

  private traceLink(
    traceEventId: string,
    relationship: TraceLinkRecord['relationship'],
    objectType: string,
    objectId: string,
    at: string,
  ): TraceLinkRecord {
    return {
      id: `trace-link:${traceEventId}:${relationship}:${objectType}:${objectId}`,
      trace_event_id: traceEventId,
      relationship,
      object_type: objectType,
      object_id: objectId,
      created_at: at,
    };
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
}
