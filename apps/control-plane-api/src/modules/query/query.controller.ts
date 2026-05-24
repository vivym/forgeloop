import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import { productListQuerySchema, type ProductListQuery } from '@forgeloop/contracts';

import { ZodValidationPipe } from '../http/zod-validation.pipe';
import { parseWorkItemCockpitQuery } from './product-lane-query-parser';
import { QueryService } from './query.service';

@Controller('query')
export class QueryController {
  constructor(@Inject(QueryService) private readonly service: QueryService) {}

  @Get('work-item-cockpit/:workItemId')
  getWorkItemCockpit(@Param('workItemId') workItemId: string, @Query() query: Record<string, string | string[] | undefined>) {
    return this.service.getWorkItemCockpit(workItemId, parseWorkItemCockpitQuery(query));
  }

  @Get('release-cockpit/:releaseId')
  getReleaseCockpit(@Param('releaseId') releaseId: string) {
    return this.service.getReleaseCockpit(releaseId);
  }

  @Get('pipeline')
  getPipeline(@Query(new ZodValidationPipe(productListQuerySchema)) query: ProductListQuery) {
    return this.service.getPipeline(query);
  }

  @Get('my-work')
  listMyWork(@Query(new ZodValidationPipe(productListQuerySchema)) query: ProductListQuery) {
    return this.service.listMyWork(query);
  }

  @Get('dashboard')
  getDashboard(@Query(new ZodValidationPipe(productListQuerySchema)) query: ProductListQuery) {
    return this.service.getDashboard(query);
  }

  @Get('development-plans')
  listDevelopmentPlans(@Query(new ZodValidationPipe(productListQuerySchema)) query: ProductListQuery) {
    return this.service.listDevelopmentPlans(query);
  }

  @Get('development-plans/:developmentPlanId/items/:itemId')
  getDevelopmentPlanItem(@Param('developmentPlanId') developmentPlanId: string, @Param('itemId') itemId: string) {
    return this.service.getDevelopmentPlanItem(developmentPlanId, itemId);
  }

  @Get('development-plans/:developmentPlanId')
  getDevelopmentPlan(@Param('developmentPlanId') developmentPlanId: string) {
    return this.service.getDevelopmentPlan(developmentPlanId);
  }

  @Get('specs-execution-plans')
  listSpecsExecutionPlans(@Query(new ZodValidationPipe(productListQuerySchema)) query: ProductListQuery) {
    return this.service.listSpecsExecutionPlans(query);
  }

  @Get('executions')
  listExecutions(@Query(new ZodValidationPipe(productListQuerySchema)) query: ProductListQuery) {
    return this.service.listExecutions(query);
  }

  @Get('code-review-handoffs')
  listCodeReviewHandoffs(@Query(new ZodValidationPipe(productListQuerySchema)) query: ProductListQuery) {
    return this.service.listCodeReviewHandoffs(query);
  }

  @Get('qa-handoffs')
  listQaHandoffs(@Query(new ZodValidationPipe(productListQuerySchema)) query: ProductListQuery) {
    return this.service.listQaHandoffs(query);
  }

  @Get('requirements')
  listRequirements(@Query(new ZodValidationPipe(productListQuerySchema)) query: ProductListQuery) {
    return this.service.listRequirements(query);
  }

  @Get('requirements/:requirementId')
  getRequirementDetail(@Param('requirementId') requirementId: string) {
    return this.service.getRequirementDetail(requirementId);
  }

  @Get('initiatives')
  listInitiatives(@Query(new ZodValidationPipe(productListQuerySchema)) query: ProductListQuery) {
    return this.service.listInitiatives(query);
  }

  @Get('initiatives/:initiativeId')
  getInitiativeDetail(@Param('initiativeId') initiativeId: string) {
    return this.service.getInitiativeDetail(initiativeId);
  }

  @Get('tech-debt')
  listTechDebt(@Query(new ZodValidationPipe(productListQuerySchema)) query: ProductListQuery) {
    return this.service.listTechDebt(query);
  }

  @Get('tech-debt/:techDebtId')
  getTechDebtDetail(@Param('techDebtId') techDebtId: string) {
    return this.service.getTechDebtDetail(techDebtId);
  }

  @Get('bugs')
  listBugs(@Query(new ZodValidationPipe(productListQuerySchema)) query: ProductListQuery) {
    return this.service.listBugs(query);
  }

  @Get('bugs/:bugId')
  getBugDetail(@Param('bugId') bugId: string) {
    return this.service.getBugDetail(bugId);
  }

  @Get('board')
  listBoardCards(@Query(new ZodValidationPipe(productListQuerySchema)) query: ProductListQuery) {
    return this.service.listBoardCards(query);
  }

  @Get('reports/:reportId')
  getReport(@Param('reportId') reportId: string, @Query(new ZodValidationPipe(productListQuerySchema)) query: ProductListQuery) {
    return this.service.getReport(reportId, query);
  }

  @Get('releases/:releaseId/readiness')
  getReleaseReadiness(@Param('releaseId') releaseId: string, @Query('project_id') projectId?: string) {
    return this.service.getReleaseReadinessDetail(releaseId, projectId === undefined ? {} : { project_id: projectId });
  }

  @Get('execution-packages/:packageId/runtime-readiness')
  getExecutionPackageRuntimeReadiness(@Param('packageId') packageId: string) {
    return this.service.getExecutionPackageRuntimeReadiness(packageId);
  }

  @Get('reviews/:reviewPacketId')
  getReview(@Param('reviewPacketId') reviewPacketId: string) {
    return this.service.getReview(reviewPacketId);
  }

  @Get('product-lanes/:laneId')
  getProductLane(@Param('laneId') laneId: string, @Query() query: Record<string, string | string[] | undefined>) {
    return this.service.getProductLane(laneId, query);
  }

  @Get('replay/spec/:specId')
  getSpecReplay(@Param('specId') specId: string) {
    return this.service.getSpecReplay(specId);
  }

  @Get('replay/plan/:planId')
  getPlanReplay(@Param('planId') planId: string) {
    return this.service.getPlanReplay(planId);
  }

  @Get('replay/:objectType/:objectId')
  getReplay(@Param('objectType') objectType: string, @Param('objectId') objectId: string) {
    return this.service.getReplay(objectType, objectId);
  }
}
