import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import { productListQuerySchema, type ProductListQuery } from '@forgeloop/contracts';

import { ZodValidationPipe } from '../http/zod-validation.pipe';
import { QueryService } from './query.service';

@Controller('query')
export class QueryController {
  constructor(@Inject(QueryService) private readonly service: QueryService) {}

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

  @Get('reviews')
  listDocumentReviews(@Query(new ZodValidationPipe(productListQuerySchema)) query: ProductListQuery) {
    return this.service.listDocumentReviews(query);
  }

  @Get('executions')
  listExecutions(@Query(new ZodValidationPipe(productListQuerySchema)) query: ProductListQuery) {
    return this.service.listExecutions(query);
  }

  @Get('executions/:executionId')
  getExecution(@Param('executionId') executionId: string) {
    return this.service.getExecution(executionId);
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

  @Get('product-lanes/:laneId')
  getProductLane(@Param('laneId') laneId: string, @Query() query: Record<string, string | string[] | undefined>) {
    return this.service.getProductLane(laneId, query);
  }

}
