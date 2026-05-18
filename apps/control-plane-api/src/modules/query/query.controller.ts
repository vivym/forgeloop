import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import { productListQuerySchema, type ProductListQuery } from '@forgeloop/contracts';

import { ZodValidationPipe } from '../http/zod-validation.pipe';
import { QueryService } from './query.service';

@Controller('query')
export class QueryController {
  constructor(@Inject(QueryService) private readonly service: QueryService) {}

  @Get('work-item-cockpit/:workItemId')
  getWorkItemCockpit(@Param('workItemId') workItemId: string) {
    return this.service.getWorkItemCockpit(workItemId);
  }

  @Get('release-cockpit/:releaseId')
  getReleaseCockpit(@Param('releaseId') releaseId: string) {
    return this.service.getReleaseCockpit(releaseId);
  }

  @Get('pipeline')
  getPipeline(@Query(new ZodValidationPipe(productListQuerySchema)) query: ProductListQuery) {
    return this.service.getPipeline(query);
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

  @Get('workbenches/intake')
  getIntakeWorkbench(@Query() query: Record<string, string | string[] | undefined>) {
    return this.service.getRoleWorkbench('intake', query);
  }

  @Get('workbenches/spec-approver')
  getSpecApproverWorkbench(@Query() query: Record<string, string | string[] | undefined>) {
    return this.service.getRoleWorkbench('spec-approver', query);
  }

  @Get('workbenches/execution-owner')
  getExecutionOwnerWorkbench(@Query() query: Record<string, string | string[] | undefined>) {
    return this.service.getRoleWorkbench('execution-owner', query);
  }

  @Get('workbenches/reviewer')
  getReviewerWorkbench(@Query() query: Record<string, string | string[] | undefined>) {
    return this.service.getRoleWorkbench('reviewer', query);
  }

  @Get('workbenches/qa-test-owner')
  getQaTestOwnerWorkbench(@Query() query: Record<string, string | string[] | undefined>) {
    return this.service.getRoleWorkbench('qa-test-owner', query);
  }

  @Get('workbenches/release-owner')
  getReleaseOwnerWorkbench(@Query() query: Record<string, string | string[] | undefined>) {
    return this.service.getRoleWorkbench('release-owner', query);
  }

  @Get('workbenches/manager-health')
  getManagerHealthWorkbench(@Query() query: Record<string, string | string[] | undefined>) {
    return this.service.getRoleWorkbench('manager-health', query);
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
