import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { EvidenceChainResponse } from '@forgeloop/contracts';
import {
  type AutomationActorClass,
  type Decision,
  type ExecutionPackage,
  type ObjectEvent,
  type ReviewPacket,
  type StatusHistory,
  transitionExecutionPackage,
  transitionReviewPacket,
} from '@forgeloop/domain';
import type { DeliveryRepository } from '@forgeloop/db';

import { AuditWriterService } from '../audit/audit-writer.service';
import type { ActorContext } from '../auth/actor-context';
import { ControlPlaneRuntimeService } from '../core/control-plane-runtime.service';
import { DELIVERY_REPOSITORY } from '../core/control-plane-tokens';
import type { ReviewDecisionDto } from '../delivery/dto';
import { buildEvidenceChain } from './evidence-chain';

const statusForPackage = (executionPackage: ExecutionPackage): string =>
  `${executionPackage.phase}/${executionPackage.activity_state}/${executionPackage.gate_state}`;

const productGateRejectedActorClasses = new Set<AutomationActorClass>([
  'automation_daemon',
  'source_adapter',
  'external_tracker',
  'repo_policy',
]);

@Injectable()
export class ReviewEvidenceService {
  constructor(
    @Inject(DELIVERY_REPOSITORY) private readonly repository: DeliveryRepository,
    @Inject(ControlPlaneRuntimeService) private readonly runtime: ControlPlaneRuntimeService,
    @Inject(AuditWriterService) private readonly audit: AuditWriterService,
  ) {}

  async getReviewPacket(reviewPacketId: string): Promise<ReviewPacket> {
    return this.requireFound(await this.repository.getReviewPacket(reviewPacketId), `ReviewPacket ${reviewPacketId}`);
  }

  async approveReviewPacket(reviewPacketId: string, dto: ReviewDecisionDto, actorContext?: ActorContext): Promise<Record<string, unknown>> {
    const actorId = this.actorIdForProductGate(dto.reviewed_by_actor_id, actorContext);
    const reviewPacket = await this.getReviewPacket(reviewPacketId);
    const updated = transitionReviewPacket(reviewPacket, {
      type: 'approve',
      summary: dto.summary,
      reviewed_by_actor_id: actorId,
      reviewed_at: dto.reviewed_at,
      at: this.now(),
    });
    await this.repository.saveReviewPacket(updated);
    await this.decision('review_packet', reviewPacketId, actorId, 'approved', dto.summary);
    await this.applyReviewToPackage(updated, 'review_approved');
    return { review_packet_id: reviewPacketId, status: 'completed', decision: 'approved', recorded_at: updated.updated_at };
  }

  async requestReviewChanges(
    reviewPacketId: string,
    dto: ReviewDecisionDto,
    actorContext?: ActorContext,
  ): Promise<Record<string, unknown>> {
    const actorId = this.actorIdForProductGate(dto.reviewed_by_actor_id, actorContext);
    const reviewPacket = await this.getReviewPacket(reviewPacketId);
    const updated = transitionReviewPacket(reviewPacket, {
      type: 'request_changes',
      summary: dto.summary,
      reviewed_by_actor_id: actorId,
      reviewed_at: dto.reviewed_at,
      requested_changes: dto.requested_changes ?? [],
      at: this.now(),
    });
    await this.repository.saveReviewPacket(updated);
    await this.decision('review_packet', reviewPacketId, actorId, 'changes_requested', dto.summary);
    await this.applyReviewToPackage(updated, 'review_changes_requested');
    return { review_packet_id: reviewPacketId, status: 'completed', decision: 'changes_requested', recorded_at: updated.updated_at };
  }

  async evidenceChain(workItemId: string, reviewPacketId?: string): Promise<EvidenceChainResponse> {
    const workItem = this.requireFound(await this.repository.getWorkItem(workItemId), `WorkItem ${workItemId}`);
    const response = await buildEvidenceChain(this.repository, workItem, {
      ...(reviewPacketId === undefined ? {} : { reviewPacketId }),
      generatedAt: this.now(),
    });
    return this.requireFound(response, `ReviewPacket ${reviewPacketId}`);
  }

  async archiveReviewPacket(
    reviewPacket: ReviewPacket,
    reason: string,
    repository: DeliveryRepository = this.repository,
  ): Promise<void> {
    const updated = transitionReviewPacket(reviewPacket, { type: 'archive_for_newer_run', at: this.now() });
    await repository.saveReviewPacket(updated);
    await this.eventWithRepository(repository, 'review_packet', reviewPacket.id, 'review_packet_archived', reviewPacket.reviewer_actor_id, { reason });
  }

  async bestEffortTraceWrite(write: () => Promise<void>): Promise<void> {
    try {
      await write();
    } catch (error) {
      console.warn('[forgeloop:review-evidence.trace] best-effort trace write failed', {
        source: 'control-plane-api',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async applyReviewToPackage(reviewPacket: ReviewPacket, type: 'review_approved' | 'review_changes_requested'): Promise<void> {
    const executionPackage = this.requireFound(
      await this.repository.getExecutionPackage(reviewPacket.execution_package_id),
      `ExecutionPackage ${reviewPacket.execution_package_id}`,
    );
    const updated = transitionExecutionPackage(executionPackage, { type, at: this.now() });
    await this.repository.saveExecutionPackage(updated);
    await this.history(
      'execution_package',
      updated.id,
      statusForPackage(executionPackage),
      statusForPackage(updated),
      reviewPacket.reviewed_by_actor_id,
    );
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

  private async history(
    objectType: string,
    objectId: string,
    fromStatus: string | undefined,
    toStatus: string,
    actorId: string | undefined,
  ): Promise<void> {
    const statusHistory: StatusHistory = {
      id: this.id('status-history'),
      object_type: objectType,
      object_id: objectId,
      ...(fromStatus !== undefined ? { from_status: fromStatus } : {}),
      to_status: toStatus,
      ...(actorId !== undefined ? { actor_id: actorId } : {}),
      created_at: this.now(),
    };
    await this.audit.statusHistory(statusHistory, this.repository);
  }

  private async decision(
    objectType: string,
    objectId: string,
    actorId: string,
    decisionValue: 'approved' | 'changes_requested',
    summary: string,
  ): Promise<void> {
    const decision: Decision = {
      id: this.id('decision'),
      object_type: objectType,
      object_id: objectId,
      actor_id: actorId,
      decision: decisionValue,
      summary,
      created_at: this.now(),
    };
    await this.audit.decision(decision, this.repository);
  }

  private actorIdForProductGate(bodyActorId: string | undefined, actorContext?: ActorContext): string {
    const authenticatedActorId = actorContext?.authenticatedActorId?.trim();
    if (authenticatedActorId === undefined || authenticatedActorId.length === 0 || actorContext?.actorClass === undefined) {
      throw new UnauthorizedException('Trusted actor id and class are required for product gate mutations');
    }
    if (bodyActorId !== undefined && bodyActorId !== authenticatedActorId) {
      throw new ForbiddenException('actor_id must match the trusted actor');
    }
    if (productGateRejectedActorClasses.has(actorContext.actorClass)) {
      throw new ForbiddenException({
        code: 'automation_actor_not_allowed_for_product_gate',
        message: `${actorContext.actorClass} actors cannot pass or mutate product gates.`,
      });
    }
    return authenticatedActorId;
  }

  private requireFound<T>(value: T | undefined, description: string): T {
    if (value === undefined) {
      throw new NotFoundException(`${description} not found`);
    }
    return value;
  }

  private id(prefix: string): string {
    return this.runtime.id(prefix);
  }

  private now(): string {
    return this.runtime.now();
  }
}
