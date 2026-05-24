import { Inject, Injectable, NotFoundException } from '@nestjs/common';

import {
  type DeliveryRepository,
  getProductPipeline,
  getProductLane as getProductLaneQuery,
  getReleaseCockpit as getReleaseCockpitQuery,
  getBugDetail as getProjectBugDetail,
  getDashboard as getProjectDashboard,
  getDevelopmentPlanItemProjection as getProjectDevelopmentPlanItem,
  getDevelopmentPlanProjection as getProjectDevelopmentPlan,
  getInitiativeDetail as getProjectInitiativeDetail,
  getReleaseReadinessDetail as getProjectReleaseReadinessDetail,
  getReport as getProjectReport,
  getRequirementDetail as getProjectRequirementDetail,
  getTechDebtDetail as getProjectTechDebtDetail,
  listBoardCards as listProjectBoardCards,
  listBugs as listProjectBugs,
  listCodeReviewHandoffQueue as listProjectCodeReviewHandoffs,
  listDevelopmentPlanProjections as listProjectDevelopmentPlans,
  listExecutionQueue as listProjectExecutions,
  listInitiatives as listProjectInitiatives,
  listMyWorkQueue,
  listQaHandoffQueue as listProjectQaHandoffs,
  listRequirements as listProjectRequirements,
  listSpecsExecutionPlans as listProjectSpecsExecutionPlans,
  listTechDebt as listProjectTechDebt,
} from '@forgeloop/db';
import { productLaneResponseSchema, type ProductListQuery } from '@forgeloop/contracts';

import { DELIVERY_REPOSITORY } from '../core/control-plane-tokens';
import { ControlPlaneRuntimeService } from '../core/control-plane-runtime.service';
import { RunExecutionRuntimeConfigService } from '../core/run-execution-runtime-config.service';
import {
  parseProductLaneIdOrThrowBadRequest,
  parseProductLaneQuery,
  type RawQuery,
} from './product-lane-query-parser';

@Injectable()
export class QueryService {
  constructor(
    @Inject(DELIVERY_REPOSITORY) private readonly repository: DeliveryRepository,
    @Inject(ControlPlaneRuntimeService) private readonly runtime: ControlPlaneRuntimeService,
    @Inject(RunExecutionRuntimeConfigService)
    private readonly runExecutionRuntimeConfig: RunExecutionRuntimeConfigService,
  ) {}

  async getReleaseCockpit(releaseId: string) {
    const cockpit = await getReleaseCockpitQuery(this.repository, releaseId);
    if (cockpit === undefined) {
      throw new NotFoundException(`Release ${releaseId} not found`);
    }

    return cockpit;
  }

  getPipeline(query: ProductListQuery) {
    return getProductPipeline(this.repository, query);
  }

  listMyWork(query: ProductListQuery) {
    return listMyWorkQueue(this.repository, query.actor_id === undefined ? { project_id: query.project_id } : { project_id: query.project_id, actor_id: query.actor_id });
  }

  getDashboard(query: ProductListQuery) {
    return getProjectDashboard(this.repository, query);
  }

  listDevelopmentPlans(query: ProductListQuery) {
    return listProjectDevelopmentPlans(this.repository, query);
  }

  async getDevelopmentPlan(developmentPlanId: string) {
    return this.requireFound(await getProjectDevelopmentPlan(this.repository, developmentPlanId), `Development Plan ${developmentPlanId}`);
  }

  async getDevelopmentPlanItem(developmentPlanId: string, itemId: string) {
    return this.requireFound(
      await getProjectDevelopmentPlanItem(this.repository, developmentPlanId, itemId),
      `Development Plan Item ${developmentPlanId}/${itemId}`,
    );
  }

  listSpecsExecutionPlans(query: ProductListQuery) {
    return listProjectSpecsExecutionPlans(this.repository, query);
  }

  listExecutions(query: ProductListQuery) {
    return listProjectExecutions(this.repository, query);
  }

  async getExecution(executionId: string) {
    return this.requireFound(await this.repository.getExecution(executionId), `Execution ${executionId}`);
  }

  listCodeReviewHandoffs(query: ProductListQuery) {
    return listProjectCodeReviewHandoffs(this.repository, query);
  }

  listQaHandoffs(query: ProductListQuery) {
    return listProjectQaHandoffs(this.repository, query);
  }

  listRequirements(query: ProductListQuery) {
    return listProjectRequirements(this.repository, query);
  }

  async getRequirementDetail(requirementId: string) {
    return this.requireFound(await getProjectRequirementDetail(this.repository, requirementId), `Requirement ${requirementId}`);
  }

  listInitiatives(query: ProductListQuery) {
    return listProjectInitiatives(this.repository, query);
  }

  async getInitiativeDetail(initiativeId: string) {
    return this.requireFound(await getProjectInitiativeDetail(this.repository, initiativeId), `Initiative ${initiativeId}`);
  }

  listTechDebt(query: ProductListQuery) {
    return listProjectTechDebt(this.repository, query);
  }

  async getTechDebtDetail(techDebtId: string) {
    return this.requireFound(await getProjectTechDebtDetail(this.repository, techDebtId), `Tech Debt ${techDebtId}`);
  }

  listBugs(query: ProductListQuery) {
    return listProjectBugs(this.repository, query);
  }

  async getBugDetail(bugId: string) {
    return this.requireFound(await getProjectBugDetail(this.repository, bugId), `Bug ${bugId}`);
  }

  listBoardCards(query: ProductListQuery) {
    return listProjectBoardCards(this.repository, query);
  }

  getReport(reportId: string, query: ProductListQuery) {
    return getProjectReport(this.repository, reportId, query);
  }

  async getReleaseReadinessDetail(releaseId: string, options: { project_id?: string } = {}) {
    return this.requireFound(
      await getProjectReleaseReadinessDetail(this.repository, releaseId, options),
      `Release readiness ${releaseId}`,
    );
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

  private requireFound<T>(value: T | undefined, label: string): T {
    if (value === undefined) {
      throw new NotFoundException(`${label} not found`);
    }
    return value;
  }
}
