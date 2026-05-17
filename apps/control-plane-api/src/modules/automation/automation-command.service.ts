import { randomUUID } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { ExecutorType, RunAcceptedResponse } from '@forgeloop/contracts';
import type { DeliveryRepository } from '@forgeloop/db';
import {
  DomainError,
  isWorkItemAutomationTerminal,
  transitionExecutionPackage,
  transitionRunSession,
  transitionSpecPlan,
  validateExecutionPackage,
  type AutomationActorContext,
  type AutomationPrecondition,
  type AutomationProjectSettings,
  type CommandIdempotencyRecord,
  type ExecutionPackage,
  type ManualPathHold,
  type ObjectEvent,
  type Plan,
  type PlanRevision,
  type Project,
  type RunRuntimeMetadata,
  type RuntimeSafetyAttestation,
  type Spec,
  type SpecRevision,
  type WorkItem,
} from '@forgeloop/domain';
import { buildRunSpec, loadRunContext } from '@forgeloop/workflow';

import {
  DELIVERY_DEMO_ACTOR_ID_FALLBACK,
  DELIVERY_REPOSITORY,
  RUN_DURABILITY_MODE,
  type RunDurabilityMode,
} from '../core/control-plane-tokens';
import { ControlPlaneRuntimeService } from '../core/control-plane-runtime.service';
import type { ActorContext } from '../auth/actor-context';
import type {
  AutomationActorContextDto,
  DisableAutomationCapabilitiesDto,
  RequestManualPathHoldDto,
  ResolveManualPathHoldDto,
  SetAutomationCapabilitiesDto,
} from '../delivery/dto';
import {
  assertAutomationPreconditionStillCurrent,
  assertCommandCapabilityStillEnabled,
  assertNoActiveHolds,
  assertPackageRunEligible,
  assertRuntimeSafetyAttestation,
  automationPreconditionFingerprint,
  commandIdempotencyTarget,
  normalizeAutomationPrecondition,
} from './automation-command-helpers';
import type {
  AutomationActionType,
  EnsurePackageDraftsCommandDto,
  EnsurePlanDraftCommandDto,
  RequestManualPathCommandDto,
} from './automation.dto';
import {
  DEFAULT_PACKAGE_POLICY_DIGEST,
  DEFAULT_PACKAGE_POLICY_SOURCE_PATH,
  defaultPackagePolicyFields,
} from '../execution-packages/package-policy-fields';

const commandClaimTtlMs = 5 * 60 * 1000;
type EnsurePlanDraftResult = { plan_id: string; plan_revision_id: string; status: 'created' | 'existing' };
type CommandBoundaryOutcome<T> = { ok: true; value: T } | { ok: false; error: unknown };
type EnsurePackageDraftsInput = {
  planRevisionId: string;
  automationPrecondition: AutomationPrecondition;
  actorContext: ActorContext;
  idempotencyKey: string;
  generationKey?: string;
  regenerationApproval?: {
    supersededGenerationKey: string;
    supersededExecutionPackageSetId: string;
    supersedeCommandId: string;
  };
};
type EnsurePackageDraftsResult = { execution_package_set_id: string; package_ids: string[]; status: 'created' | 'existing' };
type EnqueueRunInput = {
  packageId: string;
  expectedPackageVersion: number;
  automationPrecondition: AutomationPrecondition;
  idempotencyKey: string;
  actorContext: ActorContext;
  executorType: ExecutorType;
  workflowOnly: boolean;
  runtimeSafetyAttestation?: RuntimeSafetyAttestation;
  onRunQueued?: () => void;
};

const claimConflictBody = {
  code: 'automation_action_claim_conflict',
  message: 'Automation action claim is not bound to this command.',
};

const normalizeIsoDateTime = (value: string): string => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid ISO timestamp: ${value}`);
  }
  return parsed.toISOString();
};

const currentIsoTime = (): string => {
  const testNow = process.env.NODE_ENV === 'test' ? process.env.FORGELOOP_AUTOMATION_TEST_NOW?.trim() : undefined;
  return testNow === undefined || testNow.length === 0 ? new Date().toISOString() : normalizeIsoDateTime(testNow);
};

const isAtOrBefore = (left: string, right: string): boolean => Date.parse(left) <= Date.parse(right);

const stableJson = (value: unknown): string => {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableJson(entry)).join(',')}]`;
  }
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
    .join(',')}}`;
};

@Injectable()
export class AutomationCommandService {
  constructor(
    @Inject(DELIVERY_REPOSITORY) private readonly repository: DeliveryRepository,
    @Inject(RUN_DURABILITY_MODE) private readonly durabilityMode: RunDurabilityMode,
    @Inject(ControlPlaneRuntimeService)
    private readonly controlPlaneRuntime: ControlPlaneRuntimeService,
    @Optional() @Inject(DELIVERY_DEMO_ACTOR_ID_FALLBACK) private readonly allowDemoActorIdFallback = false,
  ) {}

  async getAutomationCapabilities(projectId: string, repoId?: string): Promise<AutomationProjectSettings> {
    await this.getProject(projectId);
    await this.assertRepoScopeCurrent(this.repository, projectId, repoId);
    return this.repository.resolveAutomationProjectSettings({
      project_id: projectId,
      ...(repoId === undefined ? {} : { repo_id: repoId }),
    });
  }

  async setAutomationCapabilities(
    projectId: string,
    dto: SetAutomationCapabilitiesDto,
    actorContext?: ActorContext,
  ): Promise<AutomationProjectSettings> {
    await this.getProject(projectId);
    await this.assertRepoScopeCurrent(this.repository, projectId, dto.repo_id);
    const settings = await this.repository.setAutomationProjectSettings({
      id: this.id('automation-settings'),
      project_id: projectId,
      ...(dto.repo_id === undefined ? {} : { repo_id: dto.repo_id }),
      scope_type: dto.repo_id === undefined ? 'project' : 'repo',
      preset: dto.preset,
      expected_version: dto.expected_version,
      reason: this.required(dto.reason, 'reason'),
      evidence_refs: dto.evidence_refs,
      actor: this.automationActorContext(dto.actor_context, actorContext, { requireTrusted: true }),
      now: this.now(),
    });
    await this.eventWithRepository(this.repository, 'automation_project_settings', settings.id, 'automation_capabilities_updated', dto.actor_context.actor_id, {
      project_id: projectId,
      ...(dto.repo_id === undefined ? {} : { repo_id: dto.repo_id }),
      preset: settings.preset,
      version: settings.version,
    });
    return settings;
  }

  async disableAutomation(
    projectId: string,
    dto: DisableAutomationCapabilitiesDto,
    actorContext?: ActorContext,
  ): Promise<AutomationProjectSettings> {
    await this.getProject(projectId);
    await this.assertRepoScopeCurrent(this.repository, projectId, dto.repo_id);
    const settings = await this.repository.disableAutomationProjectSettings({
      project_id: projectId,
      ...(dto.repo_id === undefined ? {} : { repo_id: dto.repo_id }),
      expected_version: dto.expected_version,
      reason: this.required(dto.reason, 'reason'),
      evidence_refs: dto.evidence_refs,
      actor: this.automationActorContext(dto.actor_context, actorContext, { requireTrusted: true }),
      now: this.now(),
    });
    await this.eventWithRepository(this.repository, 'automation_project_settings', settings.id, 'automation_capabilities_disabled', dto.actor_context.actor_id, {
      project_id: projectId,
      ...(dto.repo_id === undefined ? {} : { repo_id: dto.repo_id }),
      version: settings.version,
    });
    return settings;
  }

  async requestManualPath(dto: RequestManualPathHoldDto, actorContext?: ActorContext): Promise<ManualPathHold> {
    const requestActor = this.optionalAutomationActorContext(dto.actor_context, actorContext);
    const precondition = dto.automation_precondition as AutomationPrecondition | undefined;
    const isDaemonOrigin = dto.source_automation_action_id !== undefined || requestActor?.actor_class === 'automation_daemon';
    if (isDaemonOrigin && precondition === undefined) {
      throw new BadRequestException('daemon-origin manual path requests require automation_precondition');
    }
    if (
      isDaemonOrigin &&
      (actorContext?.authenticatedActorId === undefined ||
        actorContext.actorClass !== 'automation_daemon' ||
        actorContext.daemonIdentity === undefined)
    ) {
      throw new UnauthorizedException('daemon-origin manual path requests require trusted daemon headers');
    }
    this.assertManualPreconditionActorMatches(precondition, requestActor, dto.requested_by);
    return this.repository.withObjectLock(`manual-path-hold:${dto.object_type}:${dto.object_id}:${dto.scope_key}`, async (repository) => {
      if (precondition !== undefined) {
        await this.assertAutomationPreconditionForHold(repository, precondition);
      }
      return repository.requestManualPathHold({
        id: this.id('manual-path-hold'),
        object_type: dto.object_type,
        object_id: dto.object_id,
        scope_key: dto.scope_key,
        reason_code: dto.reason_code,
        reason: dto.reason,
        evidence_refs: dto.evidence_refs,
        requested_by: dto.requested_by,
        requested_at: this.now(),
        idempotency_key: dto.idempotency_key,
        ...(dto.source_automation_action_id === undefined ? {} : { source_automation_action_id: dto.source_automation_action_id }),
        ...(dto.generation_key === undefined ? {} : { generation_key: dto.generation_key }),
        ...(dto.gate_key === undefined ? {} : { gate_key: dto.gate_key }),
      });
    });
  }

  async resolveManualPath(holdId: string, dto: ResolveManualPathHoldDto, actorContext?: ActorContext): Promise<ManualPathHold> {
    const resolveActor = this.optionalAutomationActorContext(dto.actor_context, actorContext);
    if (resolveActor === undefined || actorContext?.authenticatedActorId === undefined || actorContext.actorClass === undefined) {
      throw new UnauthorizedException('Trusted actor headers are required to resolve manual path holds');
    }
    if (
      resolveActor.actor_class !== 'human' &&
      resolveActor.actor_class !== 'human_admin' &&
      resolveActor.actor_class !== 'system_bootstrap' &&
      resolveActor.actor_class !== 'migration'
    ) {
      throw new ForbiddenException('automation actors cannot resolve manual path holds');
    }
    if (resolveActor.actor_id !== dto.resolved_by) {
      throw new ForbiddenException('resolved_by must match the trusted actor');
    }
    return this.repository.withObjectLock(`manual-path-hold:${holdId}`, async (repository) => {
      const existing = await repository.getManualPathHold(holdId);
      if (existing !== undefined) {
        if (existing.status !== 'active') {
          if (existing.status === 'resolved' && existing.resolved_by === dto.resolved_by && existing.resolution === dto.resolution) {
            return existing;
          }
          throw new ConflictException('Manual path hold is not active');
        }
        if (
          actorContext?.actorClass === 'automation_daemon' &&
          (existing.requested_by === actorContext.authenticatedActorId || existing.requested_by === actorContext.daemonIdentity)
        ) {
          throw new ForbiddenException('automation daemon cannot resolve its own manual path hold');
        }
      }
      const hold = await repository.resolveManualPathHold({
        hold_id: holdId,
        resolved_by: dto.resolved_by,
        resolved_at: this.now(),
        resolution: dto.resolution,
      });
      await this.eventWithRepository(repository, 'manual_path_hold', hold.id, 'manual_path_hold_resolved', dto.resolved_by, {
        resolution: dto.resolution,
      });
      return hold;
    });
  }

  async ensurePlanDraftForClaimedAction(workItemId: string, input: EnsurePlanDraftCommandDto): Promise<EnsurePlanDraftResult> {
    const precondition = normalizeAutomationPrecondition(input.automation_precondition as AutomationPrecondition);
    const actionInputJson = { work_item_id: workItemId, spec_revision_id: input.spec_revision_id };
    await this.assertActiveActionClaim({
      actionRunId: input.action_run_id,
      claimToken: input.claim_token ?? '',
      actionType: 'ensure_plan_draft',
      targetObjectType: 'work_item',
      targetObjectId: workItemId,
      targetRevisionId: input.spec_revision_id,
      idempotencyKey: input.idempotency_key,
      automationSettingsVersion: precondition.automation_settings_version,
      capabilityFingerprint: precondition.capability_fingerprint,
      preconditionFingerprint: automationPreconditionFingerprint(precondition),
      actionInputJson,
      now: currentIsoTime(),
    });
    return this.ensurePlanDraftForApprovedSpec(workItemId, input.spec_revision_id, precondition, input.idempotency_key);
  }

  async ensurePackageDraftsForClaimedAction(
    planRevisionId: string,
    input: EnsurePackageDraftsCommandDto,
    actorContext: ActorContext,
  ): Promise<EnsurePackageDraftsResult> {
    const precondition = normalizeAutomationPrecondition(input.automation_precondition as AutomationPrecondition);
    const generationKey = input.generation_key ?? `default:${planRevisionId}`;
    await this.assertActiveActionClaim({
      actionRunId: input.action_run_id,
      claimToken: input.claim_token ?? '',
      actionType: 'ensure_package_drafts',
      targetObjectType: 'plan_revision',
      targetObjectId: planRevisionId,
      targetRevisionId: generationKey,
      idempotencyKey: input.idempotency_key,
      automationSettingsVersion: precondition.automation_settings_version,
      capabilityFingerprint: precondition.capability_fingerprint,
      preconditionFingerprint: automationPreconditionFingerprint(precondition),
      actionInputJson: { plan_revision_id: planRevisionId, generation_key: generationKey },
      now: currentIsoTime(),
    });
    return this.ensureExecutionPackageDraftsForPlanRevision({
      planRevisionId,
      automationPrecondition: precondition,
      actorContext,
      idempotencyKey: input.idempotency_key,
      generationKey,
      ...(input.regeneration_approval === undefined
        ? {}
        : {
            regenerationApproval: {
              supersededGenerationKey: input.regeneration_approval.superseded_generation_key,
              supersededExecutionPackageSetId: input.regeneration_approval.superseded_execution_package_set_id,
              supersedeCommandId: input.regeneration_approval.supersede_command_id,
            },
          }),
    });
  }

  async requestManualPathForClaimedAction(input: RequestManualPathCommandDto, actorContext: ActorContext): Promise<ManualPathHold> {
    const precondition = normalizeAutomationPrecondition(input.automation_precondition as AutomationPrecondition);
    await this.assertActiveActionClaim({
      actionRunId: input.action_run_id,
      claimToken: input.claim_token ?? '',
      actionType: 'request_manual_path',
      targetObjectType: input.object_type,
      targetObjectId: input.object_id,
      ...(precondition.target_revision_id === undefined ? {} : { targetRevisionId: precondition.target_revision_id }),
      ...(precondition.target_version === undefined ? {} : { targetVersion: precondition.target_version }),
      idempotencyKey: input.idempotency_key,
      automationSettingsVersion: precondition.automation_settings_version,
      capabilityFingerprint: precondition.capability_fingerprint,
      preconditionFingerprint: automationPreconditionFingerprint(precondition),
      actionInputJson: {
        object_type: input.object_type,
        object_id: input.object_id,
        scope_key: input.scope_key,
        reason_code: input.reason_code,
        reason: input.reason,
      },
      now: currentIsoTime(),
    });
    return this.requestManualPath(
      {
        object_type: input.object_type as RequestManualPathHoldDto['object_type'],
        object_id: input.object_id,
        scope_key: input.scope_key,
        reason_code: input.reason_code,
        reason: input.reason,
        evidence_refs: input.evidence_refs,
        requested_by: input.requested_by,
        idempotency_key: input.idempotency_key,
        source_automation_action_id: input.action_run_id,
        actor_context: {
          actor_id: actorContext.authenticatedActorId ?? input.requested_by,
          actor_class: actorContext.actorClass ?? 'automation_daemon',
          ...(actorContext.daemonIdentity === undefined ? {} : { daemon_identity: actorContext.daemonIdentity }),
        },
        automation_precondition: precondition,
        ...(input.generation_key === undefined ? {} : { generation_key: input.generation_key }),
        ...(input.gate_key === undefined ? {} : { gate_key: input.gate_key }),
      },
      actorContext,
    );
  }

  async ensurePlanDraftForApprovedSpec(
    workItemId: string,
    specRevisionId: string,
    automationPrecondition: AutomationPrecondition,
    idempotencyKey: string,
  ): Promise<EnsurePlanDraftResult> {
    const precondition = normalizeAutomationPrecondition(automationPrecondition);
    if (precondition.required_capability !== 'canGeneratePlanDraft') {
      throw new BadRequestException('ensurePlanDraftForApprovedSpec requires canGeneratePlanDraft precondition');
    }
    const preconditionFingerprint = automationPreconditionFingerprint(precondition);
    const actorScope = `${precondition.actor_class}:${precondition.daemon_identity ?? 'unknown'}`;
    const claimToken = randomUUID();
    const claimedAt = this.now();

    const outcome = await this.repository.withObjectLock(`work-item:${workItemId}`, async (
      repository,
    ): Promise<CommandBoundaryOutcome<EnsurePlanDraftResult>> => {
      const claim = await repository.claimCommandIdempotency({
        id: this.id('command-idempotency'),
        command_name: 'ensure_plan_draft_for_approved_spec',
        idempotency_key: idempotencyKey,
        ...commandIdempotencyTarget({
          objectType: 'work_item',
          objectId: workItemId,
          revisionId: specRevisionId,
        }),
        precondition_json: precondition as unknown as Record<string, unknown>,
        precondition_fingerprint: preconditionFingerprint,
        actor_scope: actorScope,
        claim_token: claimToken,
        locked_until: this.lockedUntil(claimedAt),
        now: claimedAt,
      });
      const replayed = this.replayedPlanDraftResult(claim.result_json);
      const replayable = this.replayableCommandResultOrThrow(claim, replayed);
      if (replayable !== undefined) {
        return { ok: true, value: { ...replayable, status: 'existing' } };
      }

      try {
        const result = await this.writePlanDraftForApprovedSpec(repository, workItemId, specRevisionId, precondition);
        await repository.completeCommandIdempotency({
          idempotency_key: idempotencyKey,
          claim_token: claimToken,
          result_json: result,
          finished_at: this.now(),
        });
        return { ok: true, value: result };
      } catch (error) {
        await this.blockCommandIdempotencyAfterError(repository, {
          idempotency_key: idempotencyKey,
          claim_token: claimToken,
          error,
        });
        return { ok: false, error };
      }
    });
    if (!outcome.ok) {
      throw outcome.error;
    }
    return outcome.value;
  }

  async ensureExecutionPackageDraftsForPlanRevision(input: EnsurePackageDraftsInput): Promise<EnsurePackageDraftsResult> {
    const precondition = normalizeAutomationPrecondition(input.automationPrecondition);
    if (precondition.required_capability !== 'canGeneratePackageDrafts') {
      throw new BadRequestException('ensureExecutionPackageDraftsForPlanRevision requires canGeneratePackageDrafts precondition');
    }
    const defaultGenerationKey = `default:${input.planRevisionId}`;
    const generationKey = input.generationKey ?? defaultGenerationKey;
    if (input.actorContext.actorClass === 'automation_daemon' && generationKey !== defaultGenerationKey) {
      throw new BadRequestException('automation daemon may only use the default package generation key');
    }
    if (generationKey !== defaultGenerationKey) {
      if (input.actorContext.actorClass !== 'human' && input.actorContext.actorClass !== 'human_admin') {
        throw new ForbiddenException('non-default package generation requires human approval');
      }
      if (input.regenerationApproval === undefined || generationKey.startsWith(`regenerate:${input.planRevisionId}:`) !== true) {
        throw new BadRequestException('non-default package generation requires a matching supersede approval');
      }
    }
    const preconditionFingerprint = automationPreconditionFingerprint(precondition);
    const actorScope = `${precondition.actor_class}:${precondition.daemon_identity ?? input.actorContext.authenticatedActorId ?? 'unknown'}`;
    const claimToken = randomUUID();
    const claimedAt = this.now();

    const outcome = await this.repository.withObjectLock(
      `automation-command:ensure-package-drafts:${input.planRevisionId}:${generationKey}`,
      async (repository): Promise<CommandBoundaryOutcome<EnsurePackageDraftsResult>> => {
        const claim = await repository.claimCommandIdempotency({
          id: this.id('command-idempotency'),
          command_name: 'ensure_execution_package_drafts_for_plan_revision',
          idempotency_key: input.idempotencyKey,
          ...commandIdempotencyTarget({
            objectType: 'plan_revision',
            objectId: input.planRevisionId,
            revisionId: generationKey,
          }),
          precondition_json: precondition as unknown as Record<string, unknown>,
          precondition_fingerprint: preconditionFingerprint,
          actor_scope: actorScope,
          claim_token: claimToken,
          locked_until: this.lockedUntil(claimedAt),
          now: claimedAt,
        });
        const replayed = this.replayedPackageDraftsResult(claim.result_json);
        const replayable = this.replayableCommandResultOrThrow(claim, replayed);
        if (replayable !== undefined) {
          return { ok: true, value: { ...replayable, status: 'existing' } };
        }

        try {
          const result = await this.writeExecutionPackageDraftsForPlanRevision(repository, {
            planRevisionId: input.planRevisionId,
            generationKey,
            claimToken,
            precondition,
            ...(input.regenerationApproval === undefined ? {} : { regenerationApproval: input.regenerationApproval }),
          });
          await repository.completeCommandIdempotency({
            idempotency_key: input.idempotencyKey,
            claim_token: claimToken,
            result_json: result,
            finished_at: this.now(),
          });
          return { ok: true, value: result };
        } catch (error) {
          await this.blockCommandIdempotencyAfterError(repository, {
            idempotency_key: input.idempotencyKey,
            claim_token: claimToken,
            error,
          });
          return { ok: false, error };
        }
      },
    );
    if (!outcome.ok) {
      throw outcome.error;
    }
    return outcome.value;
  }

  async enqueueRunIfPackageStillReady(input: EnqueueRunInput): Promise<RunAcceptedResponse> {
    const precondition = normalizeAutomationPrecondition(input.automationPrecondition);
    if (precondition.required_capability !== 'canEnqueueRuns') {
      throw new BadRequestException('enqueueRunIfPackageStillReady requires canEnqueueRuns precondition');
    }
    const preconditionFingerprint = automationPreconditionFingerprint(precondition);
    const actorScope = `${precondition.actor_class}:${precondition.daemon_identity ?? input.actorContext.authenticatedActorId ?? 'unknown'}`;
    const claimToken = randomUUID();
    const claimedAt = this.now();

    const outcome = await this.repository.withObjectLock(`execution-package:${input.packageId}`, async (
      repository,
    ): Promise<CommandBoundaryOutcome<RunAcceptedResponse>> => {
      const claim = await repository.claimCommandIdempotency({
        id: this.id('command-idempotency'),
        command_name: 'enqueue_run_if_package_still_ready',
        idempotency_key: input.idempotencyKey,
        ...commandIdempotencyTarget({
          objectType: 'execution_package',
          objectId: input.packageId,
          version: input.expectedPackageVersion,
        }),
        precondition_json: precondition as unknown as Record<string, unknown>,
        precondition_fingerprint: preconditionFingerprint,
        actor_scope: actorScope,
        claim_token: claimToken,
        locked_until: this.lockedUntil(claimedAt),
        now: claimedAt,
      });
      const replayed = this.replayedRunAcceptedResponse(claim.result_json);
      const replayable = this.replayableCommandResultOrThrow(claim, replayed);
      if (replayable !== undefined) {
        return { ok: true, value: replayable };
      }

      try {
        assertRuntimeSafetyAttestation(input.runtimeSafetyAttestation, {
          executorType: input.executorType,
          workflowOnly: input.workflowOnly,
          now: this.now(),
        });
        const settings = await repository.resolveAutomationProjectSettings({
          project_id: precondition.project_id,
          ...(precondition.repo_id === undefined ? {} : { repo_id: precondition.repo_id }),
        });
        assertAutomationPreconditionStillCurrent(settings, precondition);
        assertCommandCapabilityStillEnabled(settings, 'canEnqueueRuns');
        await this.assertRepoScopeCurrent(repository, precondition.project_id, precondition.repo_id);
        const executionPackage = this.requireFound(await repository.getExecutionPackage(input.packageId), `ExecutionPackage ${input.packageId}`);
        if (
          executionPackage.project_id !== precondition.project_id ||
          (precondition.repo_id !== undefined && executionPackage.repo_id !== precondition.repo_id)
        ) {
          throw new ConflictException('Execution package scope no longer matches automation precondition');
        }
        await this.assertExecutionPackageGraphStillCurrent(repository, executionPackage);
        const activeHolds = await repository.listActiveManualPathHolds({
          object_type: 'execution_package',
          object_id: executionPackage.id,
        });
        const packageGenerationHolds =
          executionPackage.generation_key === undefined
            ? []
            : await repository.listActiveManualPathHolds({
                object_type: 'package_generation',
                object_id: executionPackage.plan_revision_id,
                generation_key: executionPackage.generation_key,
              });
        const openReviewPacket = await repository.findOpenReviewPacketForPackage(executionPackage.id);
        const activeRunSession = await repository.findActiveRunSessionForPackage(executionPackage.id);
        const runSessions = await repository.listRunSessionsForPackage(executionPackage.id);
        const reviewPackets = await repository.listReviewPacketsForPackage(executionPackage.id);
        const runSessionHolds = (
          await Promise.all(
            runSessions.map((runSession) =>
              repository.listActiveManualPathHolds({ object_type: 'run_session', object_id: runSession.id }),
            ),
          )
        ).flat();
        const reviewPacketHolds = (
          await Promise.all(
            reviewPackets.map((reviewPacket) =>
              repository.listActiveManualPathHolds({ object_type: 'review_packet', object_id: reviewPacket.id }),
            ),
          )
        ).flat();
        assertPackageRunEligible({
          executionPackage,
          expectedPackageVersion: input.expectedPackageVersion,
          activeHolds: [...activeHolds, ...packageGenerationHolds, ...runSessionHolds, ...reviewPacketHolds],
          ...(openReviewPacket === undefined ? {} : { openReviewPacket }),
          ...(activeRunSession === undefined ? {} : { activeRunSession }),
        });
        const response = await this.enqueueRunWithRepository(repository, executionPackage, input);
        await repository.completeCommandIdempotency({
          idempotency_key: input.idempotencyKey,
          claim_token: claimToken,
          result_json: response,
          finished_at: this.now(),
        });
        return { ok: true, value: response };
      } catch (error) {
        await this.blockCommandIdempotencyAfterError(repository, {
          idempotency_key: input.idempotencyKey,
          claim_token: claimToken,
          error,
        });
        return { ok: false, error };
      }
    });
    if (!outcome.ok) {
      throw outcome.error;
    }
    return outcome.value;
  }

  private async assertActiveActionClaim(input: {
    actionRunId: string;
    claimToken: string;
    actionType: AutomationActionType;
    targetObjectType: string;
    targetObjectId: string;
    targetRevisionId?: string;
    targetVersion?: number;
    idempotencyKey: string;
    automationSettingsVersion: number;
    capabilityFingerprint: string;
    preconditionFingerprint: string;
    actionInputJson: Record<string, unknown>;
    now: string;
  }): Promise<void> {
    if (input.claimToken.trim().length === 0) {
      throw new UnprocessableEntityException(claimConflictBody);
    }
    try {
      const action = await this.repository.getClaimedAutomationActionRun({ id: input.actionRunId, claim_token: input.claimToken });
      const mismatched =
        action.action_type !== input.actionType ||
        action.target_object_type !== input.targetObjectType ||
        action.target_object_id !== input.targetObjectId ||
        action.target_revision_id !== input.targetRevisionId ||
        action.target_version !== input.targetVersion ||
        action.idempotency_key !== input.idempotencyKey ||
        action.automation_settings_version !== input.automationSettingsVersion ||
        action.capability_fingerprint !== input.capabilityFingerprint ||
        action.precondition_fingerprint !== input.preconditionFingerprint ||
        stableJson(action.action_input_json) !== stableJson(input.actionInputJson);
      if (mismatched || action.locked_until === undefined || isAtOrBefore(action.locked_until, input.now)) {
        throw new ConflictException(claimConflictBody);
      }
    } catch (error) {
      if (error instanceof DomainError && error.code === 'INVALID_TRANSITION') {
        throw new ConflictException(claimConflictBody);
      }
      throw error;
    }
  }

  private async assertAutomationPreconditionForHold(repository: DeliveryRepository, precondition: AutomationPrecondition): Promise<void> {
    const settings = await repository.resolveAutomationProjectSettings({
      project_id: precondition.project_id,
      ...(precondition.repo_id === undefined ? {} : { repo_id: precondition.repo_id }),
    });
    assertAutomationPreconditionStillCurrent(settings, precondition);
    assertCommandCapabilityStillEnabled(settings, precondition.required_capability);
    await this.assertRepoScopeCurrent(repository, precondition.project_id, precondition.repo_id);
  }

  private async assertRepoScopeCurrent(
    repository: DeliveryRepository,
    projectId: string,
    repoId: string | undefined,
  ): Promise<void> {
    if (repoId === undefined) {
      return;
    }
    const repos = await repository.listProjectRepos(projectId);
    if (repos.some((repo) => repo.repo_id === repoId && repo.status === 'active') !== true) {
      throw new ConflictException({
        code: 'automation_precondition_stale',
        message: 'Automation repo scope is no longer active for the project.',
      });
    }
  }

  private assertManualPreconditionActorMatches(
    precondition: AutomationPrecondition | undefined,
    actorContext: AutomationActorContext | undefined,
    requestedBy: string,
  ): void {
    if (precondition === undefined || actorContext === undefined) {
      return;
    }
    if (actorContext.actor_class !== precondition.actor_class) {
      throw new ConflictException('Manual path actor class no longer matches automation precondition');
    }
    if (
      precondition.daemon_identity !== undefined &&
      (actorContext.daemon_identity !== precondition.daemon_identity || requestedBy !== precondition.daemon_identity)
    ) {
      throw new ConflictException('Manual path daemon identity no longer matches automation precondition');
    }
  }

  private async writePlanDraftForApprovedSpec(
    repository: DeliveryRepository,
    workItemId: string,
    specRevisionId: string,
    precondition: AutomationPrecondition,
  ): Promise<EnsurePlanDraftResult> {
    const settings = await repository.resolveAutomationProjectSettings({
      project_id: precondition.project_id,
      ...(precondition.repo_id === undefined ? {} : { repo_id: precondition.repo_id }),
    });
    assertAutomationPreconditionStillCurrent(settings, precondition);
    assertCommandCapabilityStillEnabled(settings, 'canGeneratePlanDraft');
    await this.assertRepoScopeCurrent(repository, precondition.project_id, precondition.repo_id);

    const workItem = this.requireFound(await repository.getWorkItem(workItemId), `WorkItem ${workItemId}`);
    if (workItem.project_id !== precondition.project_id) {
      throw new ConflictException('WorkItem project does not match automation precondition');
    }
    if (isWorkItemAutomationTerminal(workItem)) {
      throw new UnprocessableEntityException({
        code: 'work_item_terminal',
        message: `WorkItem ${workItem.id} is terminal for automation.`,
      });
    }
    if (workItem.current_spec_id === undefined) {
      throw new BadRequestException(`WorkItem ${workItem.id} has no current spec`);
    }

    const spec = this.requireFound(await repository.getSpec(workItem.current_spec_id), `Spec ${workItem.current_spec_id}`);
    if (
      spec.work_item_id !== workItem.id ||
      spec.status !== 'approved' ||
      spec.resolution !== 'approved' ||
      spec.current_revision_id !== specRevisionId
    ) {
      throw new ConflictException('Spec revision is no longer the current approved revision for this WorkItem');
    }
    const specRevision = this.requireFound(await repository.getSpecRevision(specRevisionId), `SpecRevision ${specRevisionId}`);
    if (specRevision.spec_id !== spec.id || specRevision.work_item_id !== workItem.id) {
      throw new ConflictException('SpecRevision does not belong to the WorkItem current spec');
    }

    await assertNoActiveHolds(repository, [
      { object_type: 'work_item', object_id: workItem.id },
      { object_type: 'spec_revision', object_id: specRevision.id },
    ]);

    const existingPlan =
      workItem.current_plan_id === undefined ? undefined : await repository.getPlan(workItem.current_plan_id);
    if (existingPlan !== undefined) {
      const existingRevision = (await repository.listPlanRevisions(existingPlan.id)).find(
        (revision) => revision.based_on_spec_revision_id === specRevision.id,
      );
      if (existingRevision !== undefined) {
        return { plan_id: existingPlan.id, plan_revision_id: existingRevision.id, status: 'existing' };
      }
    }

    const createdAt = this.now();
    const plan =
      existingPlan ??
      (transitionSpecPlan(undefined, {
        type: 'create',
        entity_type: 'plan',
        id: this.id('plan'),
        work_item_id: workItem.id,
        at: createdAt,
      }) as Plan);
    if (existingPlan === undefined) {
      const currentWorkItem = this.requireFound(await repository.getWorkItem(workItem.id), `WorkItem ${workItem.id}`);
      if (currentWorkItem.current_spec_id !== spec.id) {
        throw new ConflictException('WorkItem current spec changed before plan draft could be attached');
      }
      if (currentWorkItem.current_plan_id !== undefined) {
        const currentPlan = await repository.getPlan(currentWorkItem.current_plan_id);
        const currentRevision =
          currentPlan === undefined
            ? undefined
            : (await repository.listPlanRevisions(currentPlan.id)).find((revision) => revision.based_on_spec_revision_id === specRevision.id);
        if (currentPlan !== undefined && currentRevision !== undefined) {
          return { plan_id: currentPlan.id, plan_revision_id: currentRevision.id, status: 'existing' };
        }
        throw new ConflictException('WorkItem current plan changed before plan draft could be attached');
      }
      await repository.savePlan(plan);
      await repository.saveWorkItem({ ...currentWorkItem, current_plan_id: plan.id, updated_at: plan.updated_at });
      await this.eventWithRepository(repository, 'plan', plan.id, 'plan_created', workItem.owner_actor_id, { work_item_id: workItem.id });
    }

    const drafting = transitionSpecPlan(plan, { type: 'generate_draft_start', at: this.now() }) as Plan;
    await repository.savePlan(drafting);
    await this.eventWithRepository(repository, 'plan', plan.id, 'plan_draft_generation_started', workItem.owner_actor_id, {
      work_item_id: workItem.id,
    });

    const revision: PlanRevision = {
      id: this.id('plan-revision'),
      plan_id: drafting.id,
      work_item_id: workItem.id,
      based_on_spec_revision_id: specRevision.id,
      revision_number: (await repository.listPlanRevisions(drafting.id)).length + 1,
      summary: `Draft plan for ${workItem.title}`,
      content: `Implement the approved spec revision ${specRevision.id} with a bounded package and required checks.`,
      implementation_summary: `Deliver ${workItem.title} through the P0 control plane.`,
      split_strategy: 'Create one repo-bound execution package for the approved plan.',
      dependency_order: ['api-package'],
      test_matrix: ['pnpm test tests/api'],
      risk_mitigations: specRevision.risk_notes.length === 0 ? ['Keep package scope narrow.'] : specRevision.risk_notes,
      rollback_notes: 'Revert the execution package changes.',
      structured_document: { generated_by: 'automation_plan_draft_command', spec_revision_id: specRevision.id },
      author_actor_id: precondition.daemon_identity ?? 'automation-plan-drafter',
      artifact_refs: [],
      created_at: this.now(),
    };
    await repository.savePlanRevision(revision);
    const updated = transitionSpecPlan({ ...drafting, current_revision_id: revision.id }, {
      type: 'generate_draft_success',
      at: this.now(),
    }) as Plan;
    await repository.savePlan(updated);
    await this.eventWithRepository(repository, 'plan_revision', revision.id, 'plan_draft_generated', revision.author_actor_id, {
      plan_id: updated.id,
      spec_revision_id: specRevision.id,
    });

    return { plan_id: updated.id, plan_revision_id: revision.id, status: 'created' };
  }

  private replayedPlanDraftResult(result: Record<string, unknown> | undefined): EnsurePlanDraftResult | undefined {
    if (
      result === undefined ||
      typeof result.plan_id !== 'string' ||
      typeof result.plan_revision_id !== 'string' ||
      (result.status !== 'created' && result.status !== 'existing')
    ) {
      return undefined;
    }
    return {
      plan_id: result.plan_id,
      plan_revision_id: result.plan_revision_id,
      status: result.status,
    };
  }

  private replayableCommandResultOrThrow<T>(claim: CommandIdempotencyRecord, replayed: T | undefined): T | undefined {
    if (claim.status === 'succeeded') {
      if (replayed !== undefined) {
        return replayed;
      }
      throw new ConflictException('Command idempotency result is malformed');
    }
    if (claim.status === 'skipped' || claim.status === 'blocked') {
      if (replayed !== undefined) {
        return replayed;
      }
      throw new ConflictException('Command idempotency result is not replayable');
    }
    return undefined;
  }

  private async blockCommandIdempotencyAfterError(
    repository: DeliveryRepository,
    input: { idempotency_key: string; claim_token: string; error: unknown },
  ): Promise<void> {
    await repository.blockCommandIdempotency({
      idempotency_key: input.idempotency_key,
      claim_token: input.claim_token,
      result_json: { error: input.error instanceof Error ? input.error.message : 'unknown_error' },
      finished_at: this.now(),
    });
  }

  private async assertPackageRegenerationApproval(
    repository: DeliveryRepository,
    input: {
      planRevisionId: string;
      generationKey: string;
      regenerationApproval?: EnsurePackageDraftsInput['regenerationApproval'];
    },
  ): Promise<void> {
    const defaultGenerationKey = `default:${input.planRevisionId}`;
    if (input.generationKey === defaultGenerationKey) {
      return;
    }
    const approval = input.regenerationApproval;
    if (approval === undefined) {
      throw new BadRequestException('non-default package generation requires a matching supersede approval');
    }
    const superseded = await repository.getExecutionPackageGenerationRun({
      plan_revision_id: input.planRevisionId,
      generation_key: approval.supersededGenerationKey,
    });
    if (
      superseded === undefined ||
      superseded.status !== 'superseded' ||
      superseded.execution_package_set_id !== approval.supersededExecutionPackageSetId ||
      superseded.next_generation_key !== input.generationKey ||
      superseded.supersede_command_id !== approval.supersedeCommandId
    ) {
      throw new BadRequestException('non-default package generation requires a matching supersede approval');
    }
  }

  private async writeExecutionPackageDraftsForPlanRevision(
    repository: DeliveryRepository,
    input: {
      planRevisionId: string;
      generationKey: string;
      claimToken: string;
      precondition: AutomationPrecondition;
      regenerationApproval?: EnsurePackageDraftsInput['regenerationApproval'];
    },
  ): Promise<EnsurePackageDraftsResult> {
    const settings = await repository.resolveAutomationProjectSettings({
      project_id: input.precondition.project_id,
      ...(input.precondition.repo_id === undefined ? {} : { repo_id: input.precondition.repo_id }),
    });
    assertAutomationPreconditionStillCurrent(settings, input.precondition);
    assertCommandCapabilityStillEnabled(settings, 'canGeneratePackageDrafts');
    await this.assertRepoScopeCurrent(repository, input.precondition.project_id, input.precondition.repo_id);
    const context = await this.packageContextFromRepository(repository, input.planRevisionId);
    if (
      context.project.id !== input.precondition.project_id ||
      (input.precondition.repo_id !== undefined && context.project.repo_ids.includes(input.precondition.repo_id) !== true)
    ) {
      throw new ConflictException('Plan revision scope no longer matches automation precondition');
    }
    if (isWorkItemAutomationTerminal(context.workItem)) {
      throw new UnprocessableEntityException({
        code: 'work_item_terminal',
        message: `WorkItem ${context.workItem.id} is terminal for automation.`,
      });
    }
    await assertNoActiveHolds(repository, [
      { object_type: 'work_item', object_id: context.workItem.id },
      { object_type: 'spec_revision', object_id: context.specRevision.id },
      { object_type: 'plan_revision', object_id: context.planRevision.id },
      { object_type: 'package_generation', object_id: context.planRevision.id, generation_key: input.generationKey },
    ]);
    await this.assertPackageRegenerationApproval(repository, {
      planRevisionId: input.planRevisionId,
      generationKey: input.generationKey,
      regenerationApproval: input.regenerationApproval,
    });
    const packageRepoId = this.packageDraftRepoIdFor(context.project, input.precondition.repo_id);

    const generationRun = await repository.claimExecutionPackageGenerationRun({
      plan_revision_id: input.planRevisionId,
      generation_key: input.generationKey,
      generator_version: 'mock-package-drafter@1',
      policy_digest: DEFAULT_PACKAGE_POLICY_DIGEST,
      manifest_digest: 'api-package-v1',
      expected_package_count: 1,
      expected_package_keys: ['api-package'],
      claim_token: input.claimToken,
      locked_until: this.lockedUntil(this.now()),
      now: this.now(),
    });
    const replayed = this.replayedPackageDraftsResult(generationRun.result_json);
    if (generationRun.status === 'succeeded' && replayed !== undefined) {
      return { ...replayed, status: 'existing' };
    }

    const existingPackages = (await repository.listExecutionPackagesForWorkItem(context.workItem.id)).filter(
      (executionPackage) =>
        executionPackage.plan_revision_id === context.planRevision.id &&
        executionPackage.generation_key === input.generationKey &&
        executionPackage.package_key === 'api-package',
    );
    const executionPackage =
      existingPackages[0] ??
      ({
        ...transitionExecutionPackage(undefined, {
          type: 'generate_package',
          id: this.id('execution-package'),
          work_item_id: context.workItem.id,
          spec_id: context.spec.id,
          spec_revision_id: context.specRevision.id,
          plan_id: context.plan.id,
          plan_revision_id: context.planRevision.id,
          project_id: context.project.id,
          repo_id: packageRepoId,
          objective: `Implement ${context.workItem.title}.`,
          owner_actor_id: context.workItem.owner_actor_id,
          reviewer_actor_id: context.workItem.owner_actor_id,
          qa_owner_actor_id: context.workItem.owner_actor_id,
          required_checks: [
            {
              check_id: 'unit',
              display_name: 'Unit tests',
              command: 'pnpm test tests/api',
              timeout_seconds: 120,
              blocks_review: true,
            },
          ],
          required_artifact_kinds: ['execution_summary'],
          allowed_paths: ['apps/control-plane-api/**', 'tests/api/**'],
          forbidden_paths: ['packages/db/**'],
          at: this.now(),
        }),
        ...defaultPackagePolicyFields({
          policyDigest: DEFAULT_PACKAGE_POLICY_DIGEST,
          policySourcePath: DEFAULT_PACKAGE_POLICY_SOURCE_PATH,
          loadedAt: this.now(),
          requiredChecks: [
            {
              check_id: 'unit',
              display_name: 'Unit tests',
              command: 'pnpm test tests/api',
              timeout_seconds: 120,
              blocks_review: true,
            },
          ],
          allowedPaths: ['apps/control-plane-api/**', 'tests/api/**'],
          forbiddenPaths: ['packages/db/**'],
        }),
        execution_package_set_id: generationRun.execution_package_set_id,
        generation_key: input.generationKey,
        package_key: 'api-package',
        sequence: 0,
        manifest_digest: 'api-package-v1',
        required_test_gates: [],
      } satisfies ExecutionPackage);
    validateExecutionPackage(context.project, executionPackage);
    if (existingPackages[0] === undefined) {
      await repository.saveExecutionPackage(executionPackage);
      await this.eventWithRepository(
        repository,
        'execution_package',
        executionPackage.id,
        'package_draft_generated',
        'automation-package-drafter',
        {
          plan_revision_id: context.planRevision.id,
        },
      );
    }
    await repository.saveExecutionPackageGenerationPackage({
      execution_package_set_id: generationRun.execution_package_set_id,
      execution_package_id: executionPackage.id,
      plan_revision_id: input.planRevisionId,
      generation_key: input.generationKey,
      package_key: 'api-package',
      sequence: 0,
      manifest_digest: 'api-package-v1',
      claim_token: input.claimToken,
    });
    const result: EnsurePackageDraftsResult = {
      execution_package_set_id: generationRun.execution_package_set_id,
      package_ids: [executionPackage.id],
      status: existingPackages[0] === undefined ? 'created' : 'existing',
    };
    await repository.completeExecutionPackageGenerationRun({
      plan_revision_id: input.planRevisionId,
      execution_package_set_id: generationRun.execution_package_set_id,
      claim_token: input.claimToken,
      result_json: result,
      completed_at: this.now(),
    });
    return result;
  }

  private async packageContextFromRepository(
    repository: DeliveryRepository,
    planRevisionId: string,
  ): Promise<{
    project: Project;
    workItem: WorkItem;
    spec: Spec;
    specRevision: SpecRevision;
    plan: Plan;
    planRevision: PlanRevision;
  }> {
    const planRevision = this.requireFound(await repository.getPlanRevision(planRevisionId), `PlanRevision ${planRevisionId}`);
    const plan = this.requireFound(await repository.getPlan(planRevision.plan_id), `Plan ${planRevision.plan_id}`);
    if (plan.status !== 'approved' || plan.current_revision_id !== planRevisionId) {
      throw new BadRequestException(`PlanRevision ${planRevisionId} is not current approved revision`);
    }
    const workItem = this.requireFound(await repository.getWorkItem(plan.work_item_id), `WorkItem ${plan.work_item_id}`);
    if (workItem.current_plan_id !== plan.id) {
      throw new ConflictException('WorkItem current plan no longer matches PlanRevision');
    }
    const spec = await this.requireApprovedCurrentSpecFromRepository(repository, workItem);
    const specRevision = this.requireFound(await repository.getSpecRevision(spec.current_revision_id!), `SpecRevision ${spec.current_revision_id}`);
    if (planRevision.based_on_spec_revision_id === undefined) {
      throw new ConflictException('PlanRevision is not based on the WorkItem current approved SpecRevision');
    }
    if (planRevision.based_on_spec_revision_id !== specRevision.id) {
      throw new ConflictException('PlanRevision is no longer based on the WorkItem current approved SpecRevision');
    }
    return {
      project: this.requireFound(await repository.getProject(workItem.project_id), `Project ${workItem.project_id}`),
      workItem,
      spec,
      specRevision,
      plan,
      planRevision,
    };
  }

  private packageDraftRepoIdFor(project: Project, repoId: string | undefined): string {
    if (repoId !== undefined) {
      return repoId;
    }
    if (project.repo_ids.length === 1) {
      return project.repo_ids[0]!;
    }
    throw new UnprocessableEntityException({
      code: 'automation_gate_blocked',
      message: 'Project-scoped package generation requires an unambiguous repo scope.',
    });
  }

  private async requireApprovedCurrentSpecFromRepository(repository: DeliveryRepository, workItem: WorkItem): Promise<Spec> {
    if (workItem.current_spec_id === undefined) {
      throw new BadRequestException(`WorkItem ${workItem.id} has no current spec`);
    }
    const spec = this.requireFound(await repository.getSpec(workItem.current_spec_id), `Spec ${workItem.current_spec_id}`);
    if (spec.status !== 'approved' || spec.resolution !== 'approved' || spec.current_revision_id === undefined) {
      throw new BadRequestException(`Spec ${spec.id} is not approved`);
    }
    return spec;
  }

  private replayedPackageDraftsResult(result: Record<string, unknown> | undefined): EnsurePackageDraftsResult | undefined {
    if (
      result === undefined ||
      typeof result.execution_package_set_id !== 'string' ||
      !Array.isArray(result.package_ids) ||
      !result.package_ids.every((packageId) => typeof packageId === 'string') ||
      (result.status !== 'created' && result.status !== 'existing')
    ) {
      return undefined;
    }
    return {
      execution_package_set_id: result.execution_package_set_id,
      package_ids: result.package_ids,
      status: result.status,
    };
  }

  private replayedRunAcceptedResponse(result: Record<string, unknown> | undefined): RunAcceptedResponse | undefined {
    if (
      result === undefined ||
      result.status !== 'accepted' ||
      typeof result.run_session_id !== 'string' ||
      typeof result.execution_package_id !== 'string'
    ) {
      return undefined;
    }
    return {
      status: 'accepted',
      run_session_id: result.run_session_id,
      execution_package_id: result.execution_package_id,
    };
  }

  private async assertExecutionPackageGraphStillCurrent(
    repository: DeliveryRepository,
    executionPackage: ExecutionPackage,
  ): Promise<void> {
    const stale = (message: string): never => {
      throw new UnprocessableEntityException({ code: 'stale_execution_package_revision', message });
    };
    const workItem = this.requireFound(await repository.getWorkItem(executionPackage.work_item_id), `WorkItem ${executionPackage.work_item_id}`);
    if (isWorkItemAutomationTerminal(workItem)) {
      throw new UnprocessableEntityException({
        code: 'work_item_terminal',
        message: `WorkItem ${workItem.id} is terminal for automation.`,
      });
    }
    if (workItem.current_spec_id !== executionPackage.spec_id) {
      stale(`ExecutionPackage ${executionPackage.id} spec_id ${executionPackage.spec_id} is not the WorkItem current spec`);
    }
    if (workItem.current_plan_id !== executionPackage.plan_id) {
      stale(`ExecutionPackage ${executionPackage.id} plan_id ${executionPackage.plan_id} is not the WorkItem current plan`);
    }
    const spec = this.requireFound(await repository.getSpec(executionPackage.spec_id), `Spec ${executionPackage.spec_id}`);
    if (spec.status !== 'approved' || spec.resolution !== 'approved' || spec.current_revision_id !== executionPackage.spec_revision_id) {
      stale(
        `ExecutionPackage ${executionPackage.id} spec_revision_id ${executionPackage.spec_revision_id} is not current approved revision ${spec.current_revision_id ?? 'none'}`,
      );
    }
    const plan = this.requireFound(await repository.getPlan(executionPackage.plan_id), `Plan ${executionPackage.plan_id}`);
    if (plan.status !== 'approved' || plan.resolution !== 'approved' || plan.current_revision_id !== executionPackage.plan_revision_id) {
      stale(
        `ExecutionPackage ${executionPackage.id} plan_revision_id ${executionPackage.plan_revision_id} is not current approved revision ${plan.current_revision_id ?? 'none'}`,
      );
    }
    const specRevision = this.requireFound(
      await repository.getSpecRevision(executionPackage.spec_revision_id),
      `SpecRevision ${executionPackage.spec_revision_id}`,
    );
    const planRevision = this.requireFound(
      await repository.getPlanRevision(executionPackage.plan_revision_id),
      `PlanRevision ${executionPackage.plan_revision_id}`,
    );
    if (specRevision.spec_id !== spec.id || specRevision.work_item_id !== workItem.id) {
      stale(`ExecutionPackage ${executionPackage.id} spec revision no longer belongs to the current WorkItem spec`);
    }
    if (planRevision.plan_id !== plan.id || planRevision.work_item_id !== workItem.id) {
      stale(`ExecutionPackage ${executionPackage.id} plan revision no longer belongs to the current WorkItem plan`);
    }
    if (planRevision.based_on_spec_revision_id === undefined) {
      stale(`ExecutionPackage ${executionPackage.id} plan revision is missing a frozen spec revision target`);
    }
    if (planRevision.based_on_spec_revision_id !== specRevision.id) {
      stale(`ExecutionPackage ${executionPackage.id} plan revision is based on a stale spec revision`);
    }
    const dependencies = await repository.listExecutionPackageDependencies(executionPackage.id);
    for (const dependency of dependencies) {
      const upstream = this.requireFound(
        await repository.getExecutionPackage(dependency.depends_on_package_id),
        `ExecutionPackage ${dependency.depends_on_package_id}`,
      );
      if (upstream.resolution !== 'completed') {
        throw new UnprocessableEntityException({
          code: 'automation_gate_pending',
          message: `ExecutionPackage ${executionPackage.id} dependency ${upstream.id} is not completed.`,
        });
      }
    }
    const linkedReleases = (await repository.listReleasesForProject(executionPackage.project_id)).filter((release) =>
      release.execution_package_ids.includes(executionPackage.id),
    );
    for (const release of linkedReleases) {
      const releaseGateHolds = await repository.listActiveManualPathHolds({
        object_type: 'release_gate',
        object_id: release.id,
      });
      if (releaseGateHolds.length > 0) {
        throw new UnprocessableEntityException({
          code: 'manual_path_hold_active',
          message: `Release gate manual hold blocks run enqueue for ${executionPackage.id}.`,
          hold_ids: releaseGateHolds.map((hold) => hold.id),
        });
      }
      if (release.phase !== 'completed' && release.phase !== 'closed') {
        throw new UnprocessableEntityException({
          code: 'automation_gate_pending',
          message: `Release ${release.id} blocks automatic run enqueue for ${executionPackage.id}.`,
        });
      }
    }
  }

  private async enqueueRunWithRepository(
    repository: DeliveryRepository,
    executionPackage: ExecutionPackage,
    input: EnqueueRunInput,
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

    input.onRunQueued?.();
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

  private resolveRunActor(input: { authenticatedActorId?: string; demoActorId?: string }): string {
    if (input.authenticatedActorId !== undefined && input.authenticatedActorId.trim().length > 0) {
      return input.authenticatedActorId;
    }

    if (this.allowDemoActorIdFallback && this.durabilityMode === 'volatile_demo') {
      return this.required(input.demoActorId, 'actor_id');
    }

    throw new UnauthorizedException('Authenticated actor is required');
  }

  private async getProject(projectId: string): Promise<Project> {
    return this.requireFound(await this.repository.getProject(projectId), `Project ${projectId}`);
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
    await repository.appendObjectEvent(objectEvent);
  }

  private optionalAutomationActorContext(
    input: AutomationActorContextDto | undefined,
    trusted: ActorContext | undefined,
  ): AutomationActorContext | undefined {
    if (input === undefined) {
      if (
        trusted?.authenticatedActorId === undefined &&
        trusted?.actorClass === undefined &&
        trusted?.daemonIdentity === undefined
      ) {
        return undefined;
      }
      if (trusted.authenticatedActorId === undefined || trusted.actorClass === undefined) {
        throw new UnauthorizedException('Trusted actor id and class are required');
      }
      return {
        actor_id: trusted.authenticatedActorId,
        actor_class: trusted.actorClass,
        ...(trusted.daemonIdentity === undefined ? {} : { daemon_identity: trusted.daemonIdentity }),
      };
    }
    return this.automationActorContext(input, trusted, { requireTrusted: false });
  }

  private automationActorContext(
    input: AutomationActorContextDto,
    trusted?: ActorContext,
    options: { requireTrusted?: boolean } = {},
  ): AutomationActorContext {
    if (
      trusted?.authenticatedActorId !== undefined ||
      trusted?.actorClass !== undefined ||
      trusted?.daemonIdentity !== undefined ||
      options.requireTrusted === true
    ) {
      if (trusted?.authenticatedActorId === undefined || trusted.actorClass === undefined) {
        throw new UnauthorizedException('Trusted actor id and class are required');
      }
      if (
        input.actor_id !== trusted.authenticatedActorId ||
        input.actor_class !== trusted.actorClass ||
        (input.daemon_identity ?? undefined) !== (trusted.daemonIdentity ?? undefined)
      ) {
        throw new ForbiddenException('Actor context does not match authenticated headers');
      }
    }
    return {
      actor_class: input.actor_class,
      actor_id: input.actor_id,
      ...(input.daemon_identity === undefined ? {} : { daemon_identity: input.daemon_identity }),
      ...(input.source === undefined ? {} : { source: input.source }),
    };
  }

  private id(prefix: string): string {
    return this.controlPlaneRuntime.id(prefix);
  }

  private now(): string {
    return this.controlPlaneRuntime.now();
  }

  private lockedUntil(now: string): string {
    return new Date(Date.parse(now) + commandClaimTtlMs).toISOString();
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
