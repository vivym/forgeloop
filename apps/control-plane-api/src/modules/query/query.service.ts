import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';

import {
  type DeliveryRepository,
  getPlanReplayTimeline,
  getProductPipeline,
  getExecutionOwnerWorkbench,
  getIntakeWorkbench,
  getManagerHealthWorkbench,
  getObjectReplayTimeline,
  getQaTestOwnerWorkbench,
  getReleaseCockpit as getReleaseCockpitQuery,
  getReleaseOwnerWorkbench,
  getReviewerWorkbench,
  getSpecReplayTimeline,
  listProductExecutionPackages,
  listProductPlans,
  listProductReviewPackets,
  listProductRuns,
  listProductSpecs,
  listProductWorkItems,
  getSpecApproverWorkbench,
  getWorkItemCockpit,
  type RoleWorkbenchFilters,
} from '@forgeloop/db';
import type { ProductListQuery } from '@forgeloop/contracts';
import type { RunRuntimeMetadata } from '@forgeloop/domain';

import { DELIVERY_REPOSITORY, RUN_DURABILITY_MODE, type RunDurabilityMode } from '../core/control-plane-tokens';
import { ReviewEvidenceService } from '../review-evidence/review-evidence.service';
import { PublicRunSessionProjection } from './public-run-session-projection';

type RoleWorkbenchId =
  | 'intake'
  | 'spec-approver'
  | 'execution-owner'
  | 'reviewer'
  | 'qa-test-owner'
  | 'release-owner'
  | 'manager-health';

type QueryParams = Record<string, string | string[] | undefined>;

const supportedReplayObjectTypes = new Set(['work_item', 'execution_package', 'review_packet', 'release']);

@Injectable()
export class QueryService {
  constructor(
    @Inject(DELIVERY_REPOSITORY) private readonly repository: DeliveryRepository,
    @Inject(RUN_DURABILITY_MODE) private readonly durabilityMode: RunDurabilityMode,
    @Inject(PublicRunSessionProjection)
    private readonly publicRunSessionProjection: PublicRunSessionProjection,
    @Inject(ReviewEvidenceService)
    private readonly reviewEvidenceService: ReviewEvidenceService,
  ) {}

  async getWorkItemCockpit(workItemId: string) {
    const cockpit = await getWorkItemCockpit(this.repository, workItemId, {
      run_session_metadata_fallback: this.initialRuntimeMetadata(),
    });
    if (cockpit === undefined) {
      throw new NotFoundException(`WorkItem ${workItemId} not found`);
    }

    return {
      ...cockpit,
      run_sessions: cockpit.run_sessions.map((runSession) => this.publicRunSessionProjection.serialize(runSession)),
    };
  }

  async getReleaseCockpit(releaseId: string) {
    const cockpit = await getReleaseCockpitQuery(this.repository, releaseId);
    if (cockpit === undefined) {
      throw new NotFoundException(`Release ${releaseId} not found`);
    }

    return cockpit;
  }

  async getReplay(objectType: string, objectId: string) {
    if (!supportedReplayObjectTypes.has(objectType)) {
      throw new BadRequestException(`Unsupported replay object type: ${objectType}`);
    }

    const timeline = await getObjectReplayTimeline(this.repository, objectType, objectId);
    if (timeline === undefined) {
      throw new NotFoundException(`Replay ${objectType} ${objectId} not found`);
    }

    return timeline;
  }

  async getSpecReplay(specId: string) {
    const timeline = await getSpecReplayTimeline(this.repository, specId);
    if (timeline === undefined) {
      throw new NotFoundException(`Replay spec ${specId} not found`);
    }

    return timeline;
  }

  async getPlanReplay(planId: string) {
    const timeline = await getPlanReplayTimeline(this.repository, planId);
    if (timeline === undefined) {
      throw new NotFoundException(`Replay plan ${planId} not found`);
    }

    return timeline;
  }

  getPipeline(query: ProductListQuery) {
    return getProductPipeline(this.repository, query);
  }

  listWorkItems(query: ProductListQuery) {
    return listProductWorkItems(this.repository, query);
  }

  listSpecs(query: ProductListQuery) {
    return listProductSpecs(this.repository, query);
  }

  listPlans(query: ProductListQuery) {
    return listProductPlans(this.repository, query);
  }

  listExecutionPackages(query: ProductListQuery) {
    return listProductExecutionPackages(this.repository, query);
  }

  listRuns(query: ProductListQuery) {
    return listProductRuns(this.repository, query);
  }

  listReviewPackets(query: ProductListQuery) {
    return listProductReviewPackets(this.repository, query);
  }

  getReview(reviewPacketId: string) {
    return this.reviewEvidenceService.getReviewPacket(reviewPacketId);
  }

  async getRoleWorkbench(workbenchId: RoleWorkbenchId, query: QueryParams) {
    const filters = this.parseWorkbenchFilters(query);

    switch (workbenchId) {
      case 'intake':
        return getIntakeWorkbench(this.repository, filters);
      case 'spec-approver':
        return getSpecApproverWorkbench(this.repository, filters);
      case 'execution-owner':
        return getExecutionOwnerWorkbench(this.repository, filters);
      case 'reviewer':
        return getReviewerWorkbench(this.repository, filters);
      case 'qa-test-owner':
        return getQaTestOwnerWorkbench(this.repository, filters);
      case 'release-owner':
        return getReleaseOwnerWorkbench(this.repository, filters);
      case 'manager-health':
        return getManagerHealthWorkbench(this.repository, filters);
    }
  }

  private parseWorkbenchFilters(query: QueryParams): RoleWorkbenchFilters {
    return {
      project_id: this.first(query.project_id),
      actor_id: this.first(query.actor_id),
      kind: this.first(query.kind),
      cursor: this.first(query.cursor),
      phase: this.first(query.phase),
      status: this.first(query.status),
      risk: this.first(query.risk),
      limit: this.parseLimit(this.first(query.limit)),
    };
  }

  private first(value: string | string[] | undefined): string | undefined {
    if (Array.isArray(value)) {
      return value[0];
    }
    return value;
  }

  private parseLimit(value: string | undefined): number | undefined {
    if (value === undefined) {
      return undefined;
    }
    const parsed = Number(value);
    if (!Number.isInteger(parsed)) {
      throw new BadRequestException('limit must be an integer');
    }
    if (parsed < 1) {
      return 1;
    }
    if (parsed > 100) {
      return 100;
    }
    return parsed;
  }

  private initialRuntimeMetadata(): RunRuntimeMetadata {
    return {
      durability_mode: this.durabilityMode,
      recovery_attempt_count: 0,
      effective_dangerous_mode: 'not_requested',
    };
  }
}
