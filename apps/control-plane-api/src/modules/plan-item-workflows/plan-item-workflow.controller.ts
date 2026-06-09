import { Body, Controller, Inject, Param, Post, Res } from '@nestjs/common';

import { ZodValidationPipe } from '../http/zod-validation.pipe';
import {
  approveWorkflowArtifactRevisionBodySchema,
  artifactTypeSchema,
  abandonWorkflowSessionBodySchema,
  continueWorkflowExecutionBodySchema,
  evaluateWorkflowExecutionReadinessBodySchema,
  requestWorkflowArtifactChangesBodySchema,
  requestWorkflowReviewFixBodySchema,
  respondToWorkflowReviewBodySchema,
  runQueuedWorkflowActionBodySchema,
  startBrainstormingWorkflowSchema,
  startWorkflowExecutionBodySchema,
  workflowMessageCommandBodySchema,
  type ApproveWorkflowArtifactRevisionBodyDto,
  type AbandonWorkflowSessionBodyDto,
  type ContinueWorkflowExecutionBodyDto,
  type EvaluateWorkflowExecutionReadinessBodyDto,
  type RequestWorkflowArtifactChangesBodyDto,
  type RequestWorkflowReviewFixBodyDto,
  type RespondToWorkflowReviewBodyDto,
  type RunQueuedWorkflowActionBodyDto,
  type StartBrainstormingWorkflowDto,
  type StartWorkflowExecutionBodyDto,
  type WorkflowArtifactTypeDto,
  type WorkflowMessageCommandBodyDto,
} from './plan-item-workflow.dto';
import { PlanItemWorkflowService } from './plan-item-workflow.service';

type StatusResponse = {
  status(statusCode: number): StatusResponse;
};

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

  @Post('plan-item-workflows/:workflowId/messages')
  recordMessage(
    @Param('workflowId') workflowId: string,
    @Body(new ZodValidationPipe(workflowMessageCommandBodySchema)) body: WorkflowMessageCommandBodyDto,
  ) {
    return this.service.recordWorkflowMessage(workflowId, body);
  }

  @Post('plan-item-workflows/:workflowId/actions/:actionId/run')
  runQueuedAction(
    @Param('workflowId') workflowId: string,
    @Param('actionId') actionId: string,
    @Body(new ZodValidationPipe(runQueuedWorkflowActionBodySchema)) body: RunQueuedWorkflowActionBodyDto,
  ) {
    return this.service.runQueuedWorkflowAction(workflowId, actionId, body);
  }

  @Post('plan-item-workflows/:workflowId/artifacts/:artifactType/revisions/:revisionId/approve')
  approveArtifactRevision(
    @Param('workflowId') workflowId: string,
    @Param('artifactType', new ZodValidationPipe(artifactTypeSchema)) artifactType: WorkflowArtifactTypeDto,
    @Param('revisionId') revisionId: string,
    @Body(new ZodValidationPipe(approveWorkflowArtifactRevisionBodySchema)) body: ApproveWorkflowArtifactRevisionBodyDto,
  ) {
    return this.service.approveWorkflowArtifactRevision(workflowId, artifactType, revisionId, body);
  }

  @Post('plan-item-workflows/:workflowId/artifacts/:artifactType/revisions/:revisionId/request-changes')
  requestArtifactChanges(
    @Param('workflowId') workflowId: string,
    @Param('artifactType', new ZodValidationPipe(artifactTypeSchema)) artifactType: WorkflowArtifactTypeDto,
    @Param('revisionId') revisionId: string,
    @Body(new ZodValidationPipe(requestWorkflowArtifactChangesBodySchema)) body: RequestWorkflowArtifactChangesBodyDto,
  ) {
    return this.service.requestWorkflowArtifactChanges(workflowId, artifactType, revisionId, body);
  }

  @Post('plan-item-workflows/:workflowId/execution-readiness/evaluate')
  evaluateExecutionReadiness(
    @Param('workflowId') workflowId: string,
    @Body(new ZodValidationPipe(evaluateWorkflowExecutionReadinessBodySchema)) body: EvaluateWorkflowExecutionReadinessBodyDto,
  ) {
    return this.service.evaluateExecutionReadiness(workflowId, body);
  }

  @Post('plan-item-workflows/:workflowId/execution/start')
  startExecution(
    @Param('workflowId') workflowId: string,
    @Body(new ZodValidationPipe(startWorkflowExecutionBodySchema)) body: StartWorkflowExecutionBodyDto,
    @Res({ passthrough: true }) response: StatusResponse,
  ) {
    return this.service.startExecution(workflowId, body).then((result) => {
      response.status(result.status_code);
      return result.workflow;
    });
  }

  @Post('plan-item-workflows/:workflowId/execution/continue')
  continueExecution(
    @Param('workflowId') workflowId: string,
    @Body(new ZodValidationPipe(continueWorkflowExecutionBodySchema)) body: ContinueWorkflowExecutionBodyDto,
  ) {
    return this.service.continueExecution(workflowId, body);
  }

  @Post('plan-item-workflows/:workflowId/code-review/respond')
  respondToReview(
    @Param('workflowId') workflowId: string,
    @Body(new ZodValidationPipe(respondToWorkflowReviewBodySchema)) body: RespondToWorkflowReviewBodyDto,
  ) {
    return this.service.respondToReview(workflowId, body);
  }

  @Post('plan-item-workflows/:workflowId/code-review/request-fix')
  requestReviewFix(
    @Param('workflowId') workflowId: string,
    @Body(new ZodValidationPipe(requestWorkflowReviewFixBodySchema)) body: RequestWorkflowReviewFixBodyDto,
    @Res({ passthrough: true }) response: StatusResponse,
  ) {
    return this.service.requestReviewFix(workflowId, body).then((result) => {
      response.status(result.status_code);
      return result.workflow;
    });
  }

  @Post('plan-item-workflows/:workflowId/recovery/abandon-and-new-session')
  abandonAndStartNewSession(
    @Param('workflowId') workflowId: string,
    @Body(new ZodValidationPipe(abandonWorkflowSessionBodySchema)) body: AbandonWorkflowSessionBodyDto,
  ) {
    return this.service.abandonAndStartNewSession(workflowId, body);
  }
}
