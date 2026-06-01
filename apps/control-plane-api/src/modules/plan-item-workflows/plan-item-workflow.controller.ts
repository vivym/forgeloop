import { Body, Controller, Inject, Param, Patch, Post } from '@nestjs/common';
import { markdownDocumentSchema, type MarkdownDocument } from '@forgeloop/contracts';

import {
  regenerateArtifactDraftCommandSchema,
  type RegenerateArtifactDraftCommandDto,
} from '../delivery/dto';
import { ZodValidationPipe } from '../http/zod-validation.pipe';
import {
  approveImplementationPlanAndMarkExecutionReadySchema,
  manualDecisionBodySchema,
  requestWorkflowChangesSchema,
  startBrainstormingWorkflowSchema,
  workflowActorCommandSchema,
  workflowBoundaryAnswerBodySchema,
  workflowBoundaryContinueBodySchema,
  workflowBoundaryDecisionBodySchema,
  workflowBoundaryStartCommandSchema,
  workflowBoundarySummaryChangesBodySchema,
  workflowRevisionBodySchema,
  workflowTransitionCommandSchema,
  type ApproveImplementationPlanAndMarkExecutionReadyDto,
  type ManualDecisionBodyDto,
  type RequestWorkflowChangesDto,
  type StartBrainstormingWorkflowDto,
  type WorkflowActorCommandDto,
  type WorkflowBoundaryAnswerBodyDto,
  type WorkflowBoundaryContinueBodyDto,
  type WorkflowBoundaryDecisionBodyDto,
  type WorkflowBoundaryStartCommandDto,
  type WorkflowBoundarySummaryChangesBodyDto,
  type WorkflowRevisionBodyDto,
  type WorkflowRevisionCommandDto,
  type WorkflowTransitionCommandDto,
} from './plan-item-workflow.dto';
import { PlanItemWorkflowService } from './plan-item-workflow.service';

@Controller()
export class PlanItemWorkflowController {
  constructor(@Inject(PlanItemWorkflowService) private readonly service: PlanItemWorkflowService) {}

  @Post('development-plans/:developmentPlanId/items/:itemId/workflow/start-brainstorming')
  startBrainstorming(
    @Param('developmentPlanId') developmentPlanId: string,
    @Param('itemId') itemId: string,
    @Body(new ZodValidationPipe(startBrainstormingWorkflowSchema)) body: StartBrainstormingWorkflowDto,
  ) {
    return this.service.startBrainstorming(developmentPlanId, itemId, body);
  }

  @Post('plan-item-workflows/:workflowId/transitions')
  transition(
    @Param('workflowId') workflowId: string,
    @Body(new ZodValidationPipe(workflowTransitionCommandSchema)) body: WorkflowTransitionCommandDto,
  ) {
    return this.service.transitionWorkflow(workflowId, body);
  }

  @Post('plan-item-workflows/:workflowId/boundary-brainstorming')
  startBoundaryBrainstorming(
    @Param('workflowId') workflowId: string,
    @Body(new ZodValidationPipe(workflowBoundaryStartCommandSchema)) body: WorkflowBoundaryStartCommandDto,
  ) {
    return this.service.startBoundaryBrainstorming(workflowId, body);
  }

  @Post('plan-item-workflows/:workflowId/boundary-brainstorming-sessions/:sessionId/answers')
  answerBoundaryQuestion(
    @Param('workflowId') workflowId: string,
    @Param('sessionId') sessionId: string,
    @Body(new ZodValidationPipe(workflowBoundaryAnswerBodySchema)) body: WorkflowBoundaryAnswerBodyDto,
  ) {
    return this.service.answerBoundaryQuestion(workflowId, sessionId, body);
  }

  @Post('plan-item-workflows/:workflowId/boundary-brainstorming-sessions/:sessionId/decisions')
  recordBoundaryDecision(
    @Param('workflowId') workflowId: string,
    @Param('sessionId') sessionId: string,
    @Body(new ZodValidationPipe(workflowBoundaryDecisionBodySchema)) body: WorkflowBoundaryDecisionBodyDto,
  ) {
    return this.service.recordBoundaryDecision(workflowId, sessionId, body);
  }

  @Post('plan-item-workflows/:workflowId/boundary-brainstorming-sessions/:sessionId/continue')
  continueBoundaryBrainstorming(
    @Param('workflowId') workflowId: string,
    @Param('sessionId') sessionId: string,
    @Body(new ZodValidationPipe(workflowBoundaryContinueBodySchema)) body: WorkflowBoundaryContinueBodyDto,
  ) {
    return this.service.continueBoundaryBrainstorming(workflowId, sessionId, body);
  }

  @Post('plan-item-workflows/:workflowId/boundary-brainstorming-sessions/:sessionId/summary-revisions/:revisionId/request-changes')
  requestBoundarySummaryChanges(
    @Param('workflowId') workflowId: string,
    @Param('sessionId') sessionId: string,
    @Param('revisionId') revisionId: string,
    @Body(new ZodValidationPipe(workflowBoundarySummaryChangesBodySchema)) body: WorkflowBoundarySummaryChangesBodyDto,
  ) {
    return this.service.requestBoundarySummaryChanges(workflowId, sessionId, revisionId, body);
  }

  @Post('plan-item-workflows/:workflowId/boundary-summary-revisions/:revisionId/submit')
  submitBoundarySummary(
    @Param('workflowId') workflowId: string,
    @Param('revisionId') revisionId: string,
    @Body(new ZodValidationPipe(workflowRevisionBodySchema)) body: WorkflowRevisionBodyDto,
  ) {
    return this.service.submitBoundarySummary(workflowId, { ...body, revision_id: revisionId });
  }

  @Post('plan-item-workflows/:workflowId/boundary-summary-revisions/:revisionId/approve')
  approveBoundary(
    @Param('workflowId') workflowId: string,
    @Param('revisionId') revisionId: string,
    @Body(new ZodValidationPipe(workflowRevisionBodySchema)) body: WorkflowRevisionBodyDto,
  ) {
    return this.service.approveBoundary(workflowId, { ...body, revision_id: revisionId });
  }

  @Post('plan-item-workflows/:workflowId/spec/generate-draft')
  generateSpecRevision(
    @Param('workflowId') workflowId: string,
    @Body(new ZodValidationPipe(workflowActorCommandSchema)) body: WorkflowActorCommandDto,
  ) {
    return this.service.generateSpecRevision(workflowId, body);
  }

  @Post('plan-item-workflows/:workflowId/spec-revisions/generate')
  generateSpecRevisionRuntime(
    @Param('workflowId') workflowId: string,
    @Body(new ZodValidationPipe(workflowActorCommandSchema)) body: WorkflowActorCommandDto,
  ) {
    return this.service.generateSpecRevisionRuntime(workflowId, body);
  }

  @Post('plan-item-workflows/:workflowId/spec/regenerate-draft')
  regenerateSpecRevision(
    @Param('workflowId') workflowId: string,
    @Body(new ZodValidationPipe(regenerateArtifactDraftCommandSchema)) body: RegenerateArtifactDraftCommandDto,
  ) {
    return this.service.regenerateSpecRevision(workflowId, body);
  }

  @Patch('plan-item-workflows/:workflowId/spec/draft')
  saveSpecDraft(
    @Param('workflowId') workflowId: string,
    @Body(new ZodValidationPipe(markdownDocumentSchema)) body: MarkdownDocument,
  ) {
    return this.service.saveSpecDraft(workflowId, body);
  }

  @Post('plan-item-workflows/:workflowId/spec-revisions/:revisionId/submit')
  submitSpecRevision(
    @Param('workflowId') workflowId: string,
    @Param('revisionId') revisionId: string,
    @Body(new ZodValidationPipe(workflowRevisionBodySchema)) body: WorkflowRevisionBodyDto,
  ) {
    return this.service.submitSpecRevision(workflowId, { ...body, revision_id: revisionId });
  }

  @Post('plan-item-workflows/:workflowId/spec-revisions/:revisionId/approve')
  approveSpec(
    @Param('workflowId') workflowId: string,
    @Param('revisionId') revisionId: string,
    @Body(new ZodValidationPipe(workflowRevisionBodySchema)) body: WorkflowRevisionBodyDto,
  ) {
    return this.service.approveSpec(workflowId, { ...body, revision_id: revisionId });
  }

  @Post('plan-item-workflows/:workflowId/implementation-plan/generate-draft')
  generateImplementationPlanRevision(
    @Param('workflowId') workflowId: string,
    @Body(new ZodValidationPipe(workflowActorCommandSchema)) body: WorkflowActorCommandDto,
  ) {
    return this.service.generateImplementationPlanRevision(workflowId, body);
  }

  @Post('plan-item-workflows/:workflowId/implementation-plan-revisions/generate')
  generateImplementationPlanRevisionRuntime(
    @Param('workflowId') workflowId: string,
    @Body(new ZodValidationPipe(workflowActorCommandSchema)) body: WorkflowActorCommandDto,
  ) {
    return this.service.generateImplementationPlanRevisionRuntime(workflowId, body);
  }

  @Post('plan-item-workflows/:workflowId/implementation-plan/regenerate-draft')
  regenerateImplementationPlanRevision(
    @Param('workflowId') workflowId: string,
    @Body(new ZodValidationPipe(regenerateArtifactDraftCommandSchema)) body: RegenerateArtifactDraftCommandDto,
  ) {
    return this.service.regenerateImplementationPlanRevision(workflowId, body);
  }

  @Patch('plan-item-workflows/:workflowId/implementation-plan/draft')
  saveImplementationPlanDraft(
    @Param('workflowId') workflowId: string,
    @Body(new ZodValidationPipe(markdownDocumentSchema)) body: MarkdownDocument,
  ) {
    return this.service.saveImplementationPlanDraft(workflowId, body);
  }

  @Post('plan-item-workflows/:workflowId/implementation-plan-revisions/:revisionId/submit')
  submitImplementationPlanRevision(
    @Param('workflowId') workflowId: string,
    @Param('revisionId') revisionId: string,
    @Body(new ZodValidationPipe(workflowRevisionBodySchema)) body: WorkflowRevisionBodyDto,
  ) {
    return this.service.submitImplementationPlanRevision(workflowId, { ...body, revision_id: revisionId });
  }

  @Post('plan-item-workflows/:workflowId/implementation-plan-revisions/:revisionId/approve')
  approveImplementationPlan(
    @Param('workflowId') workflowId: string,
    @Param('revisionId') revisionId: string,
    @Body(new ZodValidationPipe(workflowRevisionBodySchema)) body: WorkflowRevisionBodyDto,
  ) {
    return this.service.approveImplementationPlan(workflowId, { ...body, revision_id: revisionId });
  }

  @Post('plan-item-workflows/:workflowId/request-boundary-changes')
  requestBoundaryChanges(
    @Param('workflowId') workflowId: string,
    @Body(new ZodValidationPipe(requestWorkflowChangesSchema)) body: RequestWorkflowChangesDto,
  ) {
    return this.service.requestBoundaryChanges(workflowId, body);
  }

  @Post('plan-item-workflows/:workflowId/request-spec-changes')
  requestSpecChanges(
    @Param('workflowId') workflowId: string,
    @Body(new ZodValidationPipe(requestWorkflowChangesSchema)) body: RequestWorkflowChangesDto,
  ) {
    return this.service.requestSpecChanges(workflowId, body);
  }

  @Post('plan-item-workflows/:workflowId/request-implementation-plan-changes')
  requestImplementationPlanChanges(
    @Param('workflowId') workflowId: string,
    @Body(new ZodValidationPipe(requestWorkflowChangesSchema)) body: RequestWorkflowChangesDto,
  ) {
    return this.service.requestImplementationPlanChanges(workflowId, body);
  }

  @Post('plan-item-workflows/:workflowId/block')
  block(
    @Param('workflowId') workflowId: string,
    @Body(new ZodValidationPipe(manualDecisionBodySchema)) body: ManualDecisionBodyDto,
  ) {
    return this.service.blockWorkflow(workflowId, body);
  }

  @Post('plan-item-workflows/:workflowId/recover')
  recover(
    @Param('workflowId') workflowId: string,
    @Body(new ZodValidationPipe(manualDecisionBodySchema)) body: ManualDecisionBodyDto,
  ) {
    return this.service.recoverWorkflow(workflowId, body);
  }

  @Post('plan-item-workflows/:workflowId/archive')
  archive(
    @Param('workflowId') workflowId: string,
    @Body(new ZodValidationPipe(manualDecisionBodySchema)) body: ManualDecisionBodyDto,
  ) {
    return this.service.archiveWorkflow(workflowId, body);
  }

  @Post('plan-item-workflows/:workflowId/approve-implementation-plan-and-mark-execution-ready')
  approveImplementationPlanAndMarkExecutionReady(
    @Param('workflowId') workflowId: string,
    @Body(new ZodValidationPipe(approveImplementationPlanAndMarkExecutionReadySchema))
    body: ApproveImplementationPlanAndMarkExecutionReadyDto,
  ) {
    return this.service.approveImplementationPlanAndMarkExecutionReady(workflowId, body);
  }

  @Post('plan-item-workflows/:workflowId/execution/start')
  startExecution(
    @Param('workflowId') workflowId: string,
    @Body(new ZodValidationPipe(workflowActorCommandSchema)) body: WorkflowActorCommandDto,
  ) {
    return this.service.startExecution(workflowId, body);
  }
}
