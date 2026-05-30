import { Body, Controller, Get, Inject, Param, Patch, Post, Query } from '@nestjs/common';
import { markdownDocumentSchema, type MarkdownDocument } from '@forgeloop/contracts';

import {
  createTypedDocumentSchema,
  createWorkItemSchema,
  updateWorkItemSchema,
  type CreateTypedDocumentDto,
  type CreateWorkItemDto,
  type UpdateWorkItemDto,
} from '../delivery/dto';
import { ZodValidationPipe } from '../http/zod-validation.pipe';
import { MarkdownDocumentService } from '../markdown/markdown-document.service';
import { WorkItemService } from './work-item.service';
import { workItemTypeMetadata } from './work-item-types';

@Controller()
export class WorkItemsController {
  constructor(
    @Inject(WorkItemService) private readonly workItemService: WorkItemService,
    @Inject(MarkdownDocumentService) private readonly markdownDocumentService: MarkdownDocumentService,
  ) {}

  @Get('work-item-types')
  listWorkItemTypes() {
    return workItemTypeMetadata;
  }

  @Post('work-items')
  createWorkItem(@Body(new ZodValidationPipe(createWorkItemSchema)) body: CreateWorkItemDto) {
    return this.workItemService.createWorkItem(body);
  }

  @Post('requirements')
  createRequirement(@Body(new ZodValidationPipe(createTypedDocumentSchema)) body: CreateTypedDocumentDto) {
    return this.workItemService.createWorkItem({ ...body, kind: 'requirement' });
  }

  @Post('initiatives')
  createInitiative(@Body(new ZodValidationPipe(createTypedDocumentSchema)) body: CreateTypedDocumentDto) {
    return this.workItemService.createWorkItem({ ...body, kind: 'initiative' });
  }

  @Post('tech-debt')
  createTechDebt(@Body(new ZodValidationPipe(createTypedDocumentSchema)) body: CreateTypedDocumentDto) {
    return this.workItemService.createWorkItem({ ...body, kind: 'tech_debt' });
  }

  @Post('bugs')
  createBug(@Body(new ZodValidationPipe(createTypedDocumentSchema)) body: CreateTypedDocumentDto) {
    return this.workItemService.createWorkItem({ ...body, kind: 'bug' });
  }

  @Get('work-items')
  listWorkItems(@Query('project_id') projectId?: string) {
    return this.workItemService.listWorkItems(projectId);
  }

  @Get('work-items/:workItemId')
  getWorkItem(@Param('workItemId') workItemId: string) {
    return this.workItemService.getWorkItem(workItemId);
  }

  @Patch('work-items/:workItemId')
  updateWorkItem(
    @Param('workItemId') workItemId: string,
    @Body(new ZodValidationPipe(updateWorkItemSchema)) body: UpdateWorkItemDto,
  ) {
    return this.workItemService.updateWorkItem(workItemId, body);
  }

  @Patch('markdown-documents')
  validateMarkdownDocument(@Body(new ZodValidationPipe(markdownDocumentSchema)) body: MarkdownDocument) {
    return this.markdownDocumentService.validateForWrite(body);
  }

  @Patch('requirements/:requirementId/narrative')
  updateRequirementNarrative(
    @Param('requirementId') requirementId: string,
    @Body(new ZodValidationPipe(markdownDocumentSchema)) body: MarkdownDocument,
  ) {
    return this.workItemService.updateTypedNarrative('requirement', requirementId, body);
  }

  @Patch('initiatives/:initiativeId/narrative')
  updateInitiativeNarrative(
    @Param('initiativeId') initiativeId: string,
    @Body(new ZodValidationPipe(markdownDocumentSchema)) body: MarkdownDocument,
  ) {
    return this.workItemService.updateTypedNarrative('initiative', initiativeId, body);
  }

  @Patch('tech-debt/:techDebtId/narrative')
  updateTechDebtNarrative(
    @Param('techDebtId') techDebtId: string,
    @Body(new ZodValidationPipe(markdownDocumentSchema)) body: MarkdownDocument,
  ) {
    return this.workItemService.updateTypedNarrative('tech_debt', techDebtId, body);
  }

  @Patch('bugs/:bugId/narrative')
  updateBugNarrative(
    @Param('bugId') bugId: string,
    @Body(new ZodValidationPipe(markdownDocumentSchema)) body: MarkdownDocument,
  ) {
    return this.workItemService.updateTypedNarrative('bug', bugId, body);
  }
}
