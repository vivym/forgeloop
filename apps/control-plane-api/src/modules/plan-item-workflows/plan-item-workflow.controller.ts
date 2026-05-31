import { Body, Controller, Inject, Param, Post } from '@nestjs/common';

import { ZodValidationPipe } from '../http/zod-validation.pipe';
import {
  approveImplementationPlanAndMarkExecutionReadySchema,
  manualDecisionBodySchema,
  requestWorkflowChangesSchema,
  startBrainstormingWorkflowSchema,
  workflowTransitionCommandSchema,
  type ApproveImplementationPlanAndMarkExecutionReadyDto,
  type ManualDecisionBodyDto,
  type RequestWorkflowChangesDto,
  type StartBrainstormingWorkflowDto,
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
}
