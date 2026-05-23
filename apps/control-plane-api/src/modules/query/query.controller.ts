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

  @Get('tasks')
  listTasks(@Query(new ZodValidationPipe(productListQuerySchema)) query: ProductListQuery) {
    return this.service.listTasks(query);
  }

  @Get('tasks/:taskId/packages/:packageId')
  getTaskPackageEvidence(@Param('taskId') taskId: string, @Param('packageId') packageId: string) {
    return this.service.getTaskPackageEvidence(taskId, packageId);
  }

  @Get('tasks/:taskId/runs/:runSessionId')
  getTaskRunEvidence(@Param('taskId') taskId: string, @Param('runSessionId') runSessionId: string) {
    return this.service.getTaskRunEvidence(taskId, runSessionId);
  }

  @Get('tasks/:taskId/reviews/:reviewPacketId')
  getTaskReviewEvidence(@Param('taskId') taskId: string, @Param('reviewPacketId') reviewPacketId: string) {
    return this.service.getTaskReviewEvidence(taskId, reviewPacketId);
  }

  @Get('tasks/:taskId')
  getTaskDetail(@Param('taskId') taskId: string) {
    return this.service.getTaskDetail(taskId);
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

  @Get('work-items')
  listWorkItems(@Query(new ZodValidationPipe(productListQuerySchema)) query: ProductListQuery) {
    return this.service.listWorkItems(query);
  }

  @Get('specs')
  listSpecs(@Query(new ZodValidationPipe(productListQuerySchema)) query: ProductListQuery) {
    return this.service.listSpecs(query);
  }

  @Get('plans')
  listPlans(@Query(new ZodValidationPipe(productListQuerySchema)) query: ProductListQuery) {
    return this.service.listPlans(query);
  }

  @Get('execution-packages')
  listExecutionPackages(@Query(new ZodValidationPipe(productListQuerySchema)) query: ProductListQuery) {
    return this.service.listExecutionPackages(query);
  }

  @Get('execution-packages/:packageId/runtime-readiness')
  getExecutionPackageRuntimeReadiness(@Param('packageId') packageId: string) {
    return this.service.getExecutionPackageRuntimeReadiness(packageId);
  }

  @Get('runs')
  listRuns(@Query(new ZodValidationPipe(productListQuerySchema)) query: ProductListQuery) {
    return this.service.listRuns(query);
  }

  @Get('review-packets')
  listReviewPackets(@Query(new ZodValidationPipe(productListQuerySchema)) query: ProductListQuery) {
    return this.service.listReviewPackets(query);
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
