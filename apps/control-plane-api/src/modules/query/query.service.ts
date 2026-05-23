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
  deriveDeliveryRunReadiness,
  getWorkItemCockpit,
} from '@forgeloop/db';
import { productLaneResponseSchema, type ProductLaneId, type ProductListQuery } from '@forgeloop/contracts';
import type { RunRuntimeMetadata } from '@forgeloop/domain';

import { DELIVERY_REPOSITORY, RUN_DURABILITY_MODE, type RunDurabilityMode } from '../core/control-plane-tokens';
import { ControlPlaneRuntimeService } from '../core/control-plane-runtime.service';
import { RunExecutionRuntimeConfigService } from '../core/run-execution-runtime-config.service';
import { ReviewEvidenceService } from '../review-evidence/review-evidence.service';
import {
  parseProductLaneIdOrThrowBadRequest,
  parseProductLaneQuery,
  type RawQuery,
} from './product-lane-query-parser';

const supportedReplayObjectTypes = new Set(['work_item', 'execution_package', 'review_packet', 'release']);

@Injectable()
export class QueryService {
  constructor(
    @Inject(DELIVERY_REPOSITORY) private readonly repository: DeliveryRepository,
    @Inject(RUN_DURABILITY_MODE) private readonly durabilityMode: RunDurabilityMode,
    @Inject(ControlPlaneRuntimeService) private readonly runtime: ControlPlaneRuntimeService,
    @Inject(RunExecutionRuntimeConfigService)
    private readonly runExecutionRuntimeConfig: RunExecutionRuntimeConfigService,
    @Inject(ReviewEvidenceService)
    private readonly reviewEvidenceService: ReviewEvidenceService,
  ) {}

  async getWorkItemCockpit(workItemId: string, options: { lane?: ProductLaneId } = {}) {
    const runtimeSelection = this.runExecutionRuntimeConfig.selection();
    const cockpit = await getWorkItemCockpit(this.repository, workItemId, {
      run_session_metadata_fallback: this.initialRuntimeMetadata(),
      now: this.runtime.now(),
      ...(runtimeSelection === undefined ? {} : { runtime_selection: runtimeSelection }),
      ...(options.lane === undefined ? {} : { lane: options.lane }),
    });
    if (cockpit === undefined) {
      throw new NotFoundException(`WorkItem ${workItemId} not found`);
    }

    return cockpit;
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

  async getExecutionPackageRuntimeReadiness(packageId: string) {
    const executionPackage = await this.repository.getExecutionPackage(packageId);
    if (executionPackage === undefined) {
      throw new NotFoundException(`ExecutionPackage ${packageId} not found`);
    }
    const runtimeSelection = this.runExecutionRuntimeConfig.selection();
    return deriveDeliveryRunReadiness(this.repository, {
      executionPackage,
      now: this.runtime.now(),
      ...(runtimeSelection === undefined ? {} : { runtime_selection: runtimeSelection }),
    });
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
    const runtimeSelection = this.runExecutionRuntimeConfig.selection();
    return productLaneResponseSchema.parse(
      await getProductLaneQuery(this.repository, parsedLaneId, filters, {
        now: this.runtime.now(),
        ...(runtimeSelection === undefined ? {} : { runtime_selection: runtimeSelection }),
      }),
    );
  }

  private initialRuntimeMetadata(): RunRuntimeMetadata {
    return {
      durability_mode: this.durabilityMode,
      recovery_attempt_count: 0,
      effective_dangerous_mode: 'not_requested',
    };
  }
}
