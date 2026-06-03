import { Body, Controller, Inject, Param, Patch, Post } from '@nestjs/common';
import {
  regenerateArtifactDraftCommandSchema,
  runControlSchema,
  runInputSchema,
  type RegenerateArtifactDraftCommandDto,
  type RunControlDto,
  type RunInputDto,
} from '../delivery/dto';
import { DomainError } from '@forgeloop/domain';
import { ZodValidationPipe } from '../http/zod-validation.pipe';
import {
  approveWorkflowArtifactRevisionBodySchema,
  approveImplementationPlanAndMarkExecutionReadySchema,
  artifactTypeSchema,
  evaluateWorkflowExecutionReadinessBodySchema,
  forkCodexSessionBodySchema,
  manualDecisionBodySchema,
  requestWorkflowChangesSchema,
  requestWorkflowArtifactChangesBodySchema,
  runQueuedWorkflowActionBodySchema,
  selectCodexSessionForkBodySchema,
  startBrainstormingWorkflowSchema,
  workflowMessageCommandBodySchema,
  workflowActorCommandSchema,
  workflowBoundaryAnswerBodySchema,
  workflowBoundaryContinueBodySchema,
  workflowBoundaryDecisionBodySchema,
  workflowBoundaryStartCommandSchema,
  workflowBoundarySummaryChangesBodySchema,
  workflowDraftDocumentBodySchema,
  workflowRevisionBodySchema,
  workflowTransitionCommandSchema,
  type ApproveWorkflowArtifactRevisionBodyDto,
  type ApproveImplementationPlanAndMarkExecutionReadyDto,
  type EvaluateWorkflowExecutionReadinessBodyDto,
  type ForkCodexSessionBodyDto,
  type ManualDecisionBodyDto,
  type RequestWorkflowArtifactChangesBodyDto,
  type RequestWorkflowChangesDto,
  type RunQueuedWorkflowActionBodyDto,
  type SelectCodexSessionForkBodyDto,
  type StartBrainstormingWorkflowDto,
  type WorkflowArtifactTypeDto,
  type WorkflowMessageCommandBodyDto,
  type WorkflowActorCommandDto,
  type WorkflowBoundaryAnswerBodyDto,
  type WorkflowBoundaryContinueBodyDto,
  type WorkflowBoundaryDecisionBodyDto,
  type WorkflowBoundaryStartCommandDto,
  type WorkflowBoundarySummaryChangesBodyDto,
  type WorkflowDraftDocumentBodyDto,
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

  @Post('plan-item-workflows/:workflowId/transitions')
  transition(
    @Param('workflowId') _workflowId: string,
    @Body(new ZodValidationPipe(workflowTransitionCommandSchema)) _body: WorkflowTransitionCommandDto,
  ) {
    return this.legacyEntrypointDisabled('transitions');
  }

  @Post('plan-item-workflows/:workflowId/boundary-brainstorming')
  startBoundaryBrainstorming(
    @Param('workflowId') workflowId: string,
    @Body(new ZodValidationPipe(workflowBoundaryStartCommandSchema)) body: WorkflowBoundaryStartCommandDto,
  ) {
    return this.legacyEntrypointDisabled('boundary-brainstorming');
  }

  @Post('plan-item-workflows/:workflowId/boundary-brainstorming-sessions/:sessionId/answers')
  answerBoundaryQuestion(
    @Param('workflowId') workflowId: string,
    @Param('sessionId') sessionId: string,
    @Body(new ZodValidationPipe(workflowBoundaryAnswerBodySchema)) body: WorkflowBoundaryAnswerBodyDto,
  ) {
    return this.legacyEntrypointDisabled('boundary-answer');
  }

  @Post('plan-item-workflows/:workflowId/boundary-brainstorming-sessions/:sessionId/decisions')
  recordBoundaryDecision(
    @Param('workflowId') workflowId: string,
    @Param('sessionId') sessionId: string,
    @Body(new ZodValidationPipe(workflowBoundaryDecisionBodySchema)) body: WorkflowBoundaryDecisionBodyDto,
  ) {
    return this.legacyEntrypointDisabled('boundary-decision');
  }

  @Post('plan-item-workflows/:workflowId/boundary-brainstorming-sessions/:sessionId/continue')
  continueBoundaryBrainstorming(
    @Param('workflowId') workflowId: string,
    @Param('sessionId') sessionId: string,
    @Body(new ZodValidationPipe(workflowBoundaryContinueBodySchema)) body: WorkflowBoundaryContinueBodyDto,
  ) {
    return this.legacyEntrypointDisabled('boundary-continue');
  }

  @Post('plan-item-workflows/:workflowId/boundary-brainstorming-sessions/:sessionId/summary-revisions/:revisionId/request-changes')
  requestBoundarySummaryChanges(
    @Param('workflowId') workflowId: string,
    @Param('sessionId') sessionId: string,
    @Param('revisionId') revisionId: string,
    @Body(new ZodValidationPipe(workflowBoundarySummaryChangesBodySchema)) body: WorkflowBoundarySummaryChangesBodyDto,
  ) {
    return this.legacyEntrypointDisabled('boundary-summary-request-changes');
  }

  @Post('plan-item-workflows/:workflowId/boundary-summary-revisions/:revisionId/submit')
  submitBoundarySummary(
    @Param('workflowId') workflowId: string,
    @Param('revisionId') revisionId: string,
    @Body(new ZodValidationPipe(workflowRevisionBodySchema)) body: WorkflowRevisionBodyDto,
  ) {
    return this.legacyEntrypointDisabled('boundary-summary-submit');
  }

  @Post('plan-item-workflows/:workflowId/boundary-summary-revisions/:revisionId/approve')
  approveBoundary(
    @Param('workflowId') workflowId: string,
    @Param('revisionId') revisionId: string,
    @Body(new ZodValidationPipe(workflowRevisionBodySchema)) body: WorkflowRevisionBodyDto,
  ) {
    return this.legacyEntrypointDisabled('boundary-summary-approve');
  }

  @Post('plan-item-workflows/:workflowId/spec/generate-draft')
  generateSpecRevision(
    @Param('workflowId') workflowId: string,
    @Body(new ZodValidationPipe(workflowActorCommandSchema)) body: WorkflowActorCommandDto,
  ) {
    return this.legacyEntrypointDisabled('spec-generate-draft');
  }

  @Post('plan-item-workflows/:workflowId/spec-revisions/generate')
  generateSpecRevisionRuntime(
    @Param('workflowId') workflowId: string,
    @Body(new ZodValidationPipe(workflowActorCommandSchema)) body: WorkflowActorCommandDto,
  ) {
    return this.legacyEntrypointDisabled('spec-revisions-generate');
  }

  @Post('plan-item-workflows/:workflowId/spec/regenerate-draft')
  regenerateSpecRevision(
    @Param('workflowId') workflowId: string,
    @Body(new ZodValidationPipe(regenerateArtifactDraftCommandSchema)) body: RegenerateArtifactDraftCommandDto,
  ) {
    return this.legacyEntrypointDisabled('spec-regenerate-draft');
  }

  @Patch('plan-item-workflows/:workflowId/spec/draft')
  saveSpecDraft(
    @Param('workflowId') workflowId: string,
    @Body(new ZodValidationPipe(workflowDraftDocumentBodySchema)) body: WorkflowDraftDocumentBodyDto,
  ) {
    return this.legacyEntrypointDisabled('spec-save-draft');
  }

  @Post('plan-item-workflows/:workflowId/spec-revisions/:revisionId/submit')
  submitSpecRevision(
    @Param('workflowId') workflowId: string,
    @Param('revisionId') revisionId: string,
    @Body(new ZodValidationPipe(workflowRevisionBodySchema)) body: WorkflowRevisionBodyDto,
  ) {
    return this.legacyEntrypointDisabled('spec-submit');
  }

  @Post('plan-item-workflows/:workflowId/spec-revisions/:revisionId/approve')
  approveSpec(
    @Param('workflowId') workflowId: string,
    @Param('revisionId') revisionId: string,
    @Body(new ZodValidationPipe(workflowRevisionBodySchema)) body: WorkflowRevisionBodyDto,
  ) {
    return this.legacyEntrypointDisabled('spec-approve');
  }

  @Post('plan-item-workflows/:workflowId/implementation-plan/generate-draft')
  generateImplementationPlanRevision(
    @Param('workflowId') workflowId: string,
    @Body(new ZodValidationPipe(workflowActorCommandSchema)) body: WorkflowActorCommandDto,
  ) {
    return this.legacyEntrypointDisabled('implementation-plan-generate-draft');
  }

  @Post('plan-item-workflows/:workflowId/implementation-plan-revisions/generate')
  generateImplementationPlanRevisionRuntime(
    @Param('workflowId') workflowId: string,
    @Body(new ZodValidationPipe(workflowActorCommandSchema)) body: WorkflowActorCommandDto,
  ) {
    return this.legacyEntrypointDisabled('implementation-plan-revisions-generate');
  }

  @Post('plan-item-workflows/:workflowId/implementation-plan/regenerate-draft')
  regenerateImplementationPlanRevision(
    @Param('workflowId') workflowId: string,
    @Body(new ZodValidationPipe(regenerateArtifactDraftCommandSchema)) body: RegenerateArtifactDraftCommandDto,
  ) {
    return this.legacyEntrypointDisabled('implementation-plan-regenerate-draft');
  }

  @Patch('plan-item-workflows/:workflowId/implementation-plan/draft')
  saveImplementationPlanDraft(
    @Param('workflowId') workflowId: string,
    @Body(new ZodValidationPipe(workflowDraftDocumentBodySchema)) body: WorkflowDraftDocumentBodyDto,
  ) {
    return this.legacyEntrypointDisabled('implementation-plan-save-draft');
  }

  @Post('plan-item-workflows/:workflowId/implementation-plan-revisions/:revisionId/submit')
  submitImplementationPlanRevision(
    @Param('workflowId') workflowId: string,
    @Param('revisionId') revisionId: string,
    @Body(new ZodValidationPipe(workflowRevisionBodySchema)) body: WorkflowRevisionBodyDto,
  ) {
    return this.legacyEntrypointDisabled('implementation-plan-submit');
  }

  @Post('plan-item-workflows/:workflowId/implementation-plan-revisions/:revisionId/approve')
  approveImplementationPlan(
    @Param('workflowId') workflowId: string,
    @Param('revisionId') revisionId: string,
    @Body(new ZodValidationPipe(workflowRevisionBodySchema)) body: WorkflowRevisionBodyDto,
  ) {
    return this.legacyEntrypointDisabled('implementation-plan-approve');
  }

  @Post('plan-item-workflows/:workflowId/request-boundary-changes')
  requestBoundaryChanges(
    @Param('workflowId') workflowId: string,
    @Body(new ZodValidationPipe(requestWorkflowChangesSchema)) body: RequestWorkflowChangesDto,
  ) {
    return this.legacyEntrypointDisabled('request-boundary-changes');
  }

  @Post('plan-item-workflows/:workflowId/request-spec-changes')
  requestSpecChanges(
    @Param('workflowId') workflowId: string,
    @Body(new ZodValidationPipe(requestWorkflowChangesSchema)) body: RequestWorkflowChangesDto,
  ) {
    return this.legacyEntrypointDisabled('request-spec-changes');
  }

  @Post('plan-item-workflows/:workflowId/request-implementation-plan-changes')
  requestImplementationPlanChanges(
    @Param('workflowId') workflowId: string,
    @Body(new ZodValidationPipe(requestWorkflowChangesSchema)) body: RequestWorkflowChangesDto,
  ) {
    return this.legacyEntrypointDisabled('request-implementation-plan-changes');
  }

  @Post('plan-item-workflows/:workflowId/block')
  block(
    @Param('workflowId') workflowId: string,
    @Body(new ZodValidationPipe(manualDecisionBodySchema)) body: ManualDecisionBodyDto,
  ) {
    return this.legacyEntrypointDisabled('block');
  }

  @Post('plan-item-workflows/:workflowId/recover')
  recover(
    @Param('workflowId') workflowId: string,
    @Body(new ZodValidationPipe(manualDecisionBodySchema)) body: ManualDecisionBodyDto,
  ) {
    return this.legacyEntrypointDisabled('recover');
  }

  @Post('plan-item-workflows/:workflowId/archive')
  archive(
    @Param('workflowId') workflowId: string,
    @Body(new ZodValidationPipe(manualDecisionBodySchema)) body: ManualDecisionBodyDto,
  ) {
    return this.legacyEntrypointDisabled('archive');
  }

  @Post('plan-item-workflows/:workflowId/approve-implementation-plan-and-mark-execution-ready')
  approveImplementationPlanAndMarkExecutionReady(
    @Param('workflowId') workflowId: string,
    @Body(new ZodValidationPipe(approveImplementationPlanAndMarkExecutionReadySchema))
    body: ApproveImplementationPlanAndMarkExecutionReadyDto,
  ) {
    return this.legacyEntrypointDisabled('approve-implementation-plan-and-mark-execution-ready');
  }

  @Post('plan-item-workflows/:workflowId/codex-sessions/:sessionId/fork')
  forkCodexSession(
    @Param('workflowId') workflowId: string,
    @Param('sessionId') sessionId: string,
    @Body(new ZodValidationPipe(forkCodexSessionBodySchema)) body: ForkCodexSessionBodyDto,
  ) {
    return this.legacyEntrypointDisabled('codex-session-fork');
  }

  @Post('plan-item-workflows/:workflowId/codex-sessions/:sessionId/select-active-fork')
  selectActiveCodexSessionFork(
    @Param('workflowId') workflowId: string,
    @Param('sessionId') sessionId: string,
    @Body(new ZodValidationPipe(selectCodexSessionForkBodySchema)) body: SelectCodexSessionForkBodyDto,
  ) {
    return this.legacyEntrypointDisabled('codex-session-select-active-fork');
  }

  @Post('plan-item-workflows/:workflowId/execution/start')
  startExecution(
    @Param('workflowId') workflowId: string,
    @Body(new ZodValidationPipe(workflowActorCommandSchema)) body: WorkflowActorCommandDto,
  ) {
    return this.legacyEntrypointDisabled('execution-start');
  }

  @Post('plan-item-workflows/:workflowId/run-sessions/:runSessionId/input')
  sendRunInput(
    @Param('workflowId') _workflowId: string,
    @Param('runSessionId') _runSessionId: string,
    @Body(new ZodValidationPipe(runInputSchema)) _body: RunInputDto,
  ) {
    return this.legacyEntrypointDisabled('run-session-input');
  }

  @Post('plan-item-workflows/:workflowId/run-sessions/:runSessionId/cancel')
  cancelRun(
    @Param('workflowId') _workflowId: string,
    @Param('runSessionId') _runSessionId: string,
    @Body(new ZodValidationPipe(runControlSchema)) _body: RunControlDto,
  ) {
    return this.legacyEntrypointDisabled('run-session-cancel');
  }

  @Post('plan-item-workflows/:workflowId/run-sessions/:runSessionId/resume')
  resumeRun(
    @Param('workflowId') _workflowId: string,
    @Param('runSessionId') _runSessionId: string,
    @Body(new ZodValidationPipe(runControlSchema)) _body: RunControlDto,
  ) {
    return this.legacyEntrypointDisabled('run-session-resume');
  }

  private legacyEntrypointDisabled(operation: string): never {
    throw new DomainError(
      'workflow_legacy_entrypoint_disabled',
      `workflow_legacy_entrypoint_disabled: ${operation} must use PlanItemWorkflow queued actions`,
    );
  }
}
