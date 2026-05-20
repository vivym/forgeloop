import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';

import {
  type DeliveryRepository,
  getPlanReplayTimeline,
  getProductPipeline,
  getObjectReplayTimeline,
  getProductLane as getProductLaneQuery,
  getReleaseCockpit as getReleaseCockpitQuery,
  getSpecReplayTimeline,
  listProductExecutionPackages,
  listProductPlans,
  listProductReviewPackets,
  listProductRuns,
  listProductSpecs,
  listProductWorkItems,
  getWorkItemCockpit,
  getWorkItemActions as getWorkItemActionsQuery,
} from '@forgeloop/db';
import { productLaneResponseSchema, workItemActionsResponseSchema, type ProductListQuery } from '@forgeloop/contracts';
import type { RunRuntimeMetadata } from '@forgeloop/domain';

import { DELIVERY_REPOSITORY, RUN_DURABILITY_MODE, type RunDurabilityMode } from '../core/control-plane-tokens';
import { ReviewEvidenceService } from '../review-evidence/review-evidence.service';
import {
  parseProductLaneIdOrThrowBadRequest,
  parseProductLaneQuery,
  parseWorkItemActionsQuery,
  type RawQuery,
} from './product-lane-query-parser';
import { PublicRunSessionProjection } from './public-run-session-projection';

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

  async getProductLane(laneId: string, rawQuery: RawQuery) {
    const parsedLaneId = parseProductLaneIdOrThrowBadRequest(laneId);
    const filters = parseProductLaneQuery(parsedLaneId, rawQuery);
    return productLaneResponseSchema.parse(await getProductLaneQuery(this.repository, parsedLaneId, filters));
  }

  async getWorkItemActions(workItemId: string, rawQuery: RawQuery) {
    const query = parseWorkItemActionsQuery(rawQuery);
    const response = await getWorkItemActionsQuery(this.repository, workItemId, query.lane, {
      cockpit: { run_session_metadata_fallback: this.initialRuntimeMetadata() },
    });
    if (response === undefined) {
      throw new NotFoundException(`WorkItem ${workItemId} not found`);
    }
    return workItemActionsResponseSchema.parse(response);
  }

  private initialRuntimeMetadata(): RunRuntimeMetadata {
    return {
      durability_mode: this.durabilityMode,
      recovery_attempt_count: 0,
      effective_dangerous_mode: 'not_requested',
    };
  }
}
