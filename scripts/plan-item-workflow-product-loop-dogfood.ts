import 'reflect-metadata';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { AppModule } from '../apps/control-plane-api/src/app.module';
import { DELIVERY_REPOSITORY } from '../apps/control-plane-api/src/modules/core/control-plane-tokens';
import { PlanItemWorkflowService } from '../apps/control-plane-api/src/modules/plan-item-workflows/plan-item-workflow.service';
import { getDevelopmentPlanItemProjection } from '../packages/db/src/queries/project-management-queries';
import type { DeliveryRepository } from '../packages/db/src';
import type { PlanItemWorkflowQueuedAction as PlanItemWorkflowPublicQueuedAction } from '../packages/contracts/src';
import type {
  ExecutionPackage,
  ObjectEvent,
  PlanItemWorkflowPublicDto,
  PlanItemWorkflowQueuedAction,
} from '../packages/domain/src';
import { seedDevelopmentPlanItem } from '../tests/helpers/plan-item-workflow-fixtures';

type RouteCall = {
  route: string;
  status: string;
  runtime_call: boolean;
  queued_action_id?: string;
  note?: string;
};

type RunActionResult = {
  workflow: PlanItemWorkflowPublicDto;
  queued_action: PlanItemWorkflowPublicQueuedAction;
};

type NoExecutionStateCreated = {
  run_session_count: number;
  execution_worker_job_count: number;
  workspace_bundle_count: number;
  pr_count: number;
  review_loop_count: number;
};
type ExecutionPackageBoundaryCreated = {
  execution_package_count: number;
  phase: string;
  activity_state: string;
  gate_state: string;
  resolution: string;
  run_session_count: number;
};
type PlanItemProjection = {
  runtime_boundary?: {
    type: string;
    id: string;
    phase: string;
    activity_state: string;
    gate_state: string;
  };
  executions?: unknown[];
  code_review_handoffs?: unknown[];
  qa_handoffs?: unknown[];
};
type PublicExecutionPackageProof = Pick<
  ExecutionPackage,
  'id' | 'phase' | 'activity_state' | 'gate_state' | 'resolution' | 'current_run_session_id' | 'last_run_session_id' | 'current_review_packet_id'
>;

const actorIdPrefix = '60606060';
const routeStartBrainstorming = 'POST /development-plans/:developmentPlanId/items/:itemId/workflow/start-brainstorming';
const routeMessages = 'POST /plan-item-workflows/:workflowId/messages';
const routeRunAction = 'POST /plan-item-workflows/:workflowId/actions/:actionId/run';
const routeApproveArtifact = 'POST /plan-item-workflows/:workflowId/artifacts/:artifactType/revisions/:revisionId/approve';
const routeRequestChanges = 'POST /plan-item-workflows/:workflowId/artifacts/:artifactType/revisions/:revisionId/request-changes';
const routeReadiness = 'POST /plan-item-workflows/:workflowId/execution-readiness/evaluate';

const requiredActionKinds = [
  'continue_brainstorming',
  'continue_brainstorming',
  'generate_boundary_summary',
  'generate_spec_doc',
  'revise_spec_doc',
  'generate_implementation_plan_doc',
  'revise_implementation_plan_doc',
] as const;

const requiredTurnIntents = [
  'continue_brainstorming',
  'continue_brainstorming',
  'draft_boundary_summary',
  'draft_spec_doc',
  'revise_spec_doc',
  'draft_implementation_plan_doc',
  'revise_implementation_plan_doc',
] as const;

const createApp = async (): Promise<INestApplication> => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  await app.init();
  return app;
};

const assertCondition = (condition: unknown, message: string): asserts condition => {
  if (!condition) {
    throw new Error(message);
  }
};

const expectSingleActiveQueuedAction = async (
  repository: DeliveryRepository,
  workflowId: string,
  kind: string,
): Promise<PlanItemWorkflowQueuedAction> => {
  const active = await repository.listActivePlanItemWorkflowQueuedActions(workflowId);
  const action = active.find((candidate) => candidate.kind === kind);
  assertCondition(action !== undefined, `Expected active queued action ${kind}; got ${active.map((candidate) => candidate.kind).join(', ')}`);
  assertCondition(action.status === 'queued', `Expected ${kind} to be queued; got ${action.status}`);
  return action;
};

const runQueuedAction = async (
  service: PlanItemWorkflowService,
  routeCalls: RouteCall[],
  workflowId: string,
  action: PlanItemWorkflowQueuedAction,
  actorId: string,
  label: string,
): Promise<RunActionResult> => {
  console.log(label);
  const response = await service.runQueuedWorkflowAction(workflowId, action.id, { actor_id: actorId });
  routeCalls.push({
    route: routeRunAction,
    status: response.queued_action.status,
    runtime_call: true,
    queued_action_id: action.id,
  });
  assertCondition(response.queued_action.status === 'succeeded', `${label} did not succeed`);
  assertCondition(response.queued_action.output_capsule_digest !== undefined, `${label} did not emit an output capsule digest`);
  return response as RunActionResult;
};

const approveArtifact = async (
  service: PlanItemWorkflowService,
  routeCalls: RouteCall[],
  workflowId: string,
  artifactType: 'boundary-summary' | 'spec-doc' | 'implementation-plan-doc',
  revisionId: string,
  actorId: string,
  label: string,
): Promise<PlanItemWorkflowPublicDto> => {
  console.log(label);
  const response = await service.approveWorkflowArtifactRevision(workflowId, artifactType, revisionId, {
    actor_id: actorId,
    decision_markdown: `${label}.`,
  });
  routeCalls.push({ route: routeApproveArtifact, status: response.status, runtime_call: false });
  return response as PlanItemWorkflowPublicDto;
};

const requestArtifactChanges = async (
  service: PlanItemWorkflowService,
  routeCalls: RouteCall[],
  workflowId: string,
  artifactType: 'boundary-summary' | 'spec-doc' | 'implementation-plan-doc',
  revisionId: string,
  actorId: string,
  label: string,
): Promise<PlanItemWorkflowPublicDto> => {
  console.log(label);
  const response = await service.requestWorkflowArtifactChanges(workflowId, artifactType, revisionId, {
    actor_id: actorId,
    reason_markdown: `${label}.`,
  });
  routeCalls.push({ route: routeRequestChanges, status: response.status, runtime_call: false });
  return response as PlanItemWorkflowPublicDto;
};

const submitWorkflowMessage = async (
  service: PlanItemWorkflowService,
  routeCalls: RouteCall[],
  workflowId: string,
  actorId: string,
  label: string,
): Promise<PlanItemWorkflowPublicDto> => {
  console.log(label);
  const response = await service.recordWorkflowMessage(workflowId, {
    actor_id: actorId,
    action: 'answer_boundary_question',
    body_markdown: 'Answer: keep Wave 5 scoped to the Plan Item Workflow product loop; execution remains out of scope.',
  });
  routeCalls.push({ route: routeMessages, status: response.status, runtime_call: false });
  return response as PlanItemWorkflowPublicDto;
};

const assertSameWorkflow = (
  workflow: PlanItemWorkflowPublicDto,
  expected: { workflowId: string },
  label: string,
) => {
  assertCondition(workflow.id === expected.workflowId, `${label} returned a different workflow id`);
};

const publicExecutionPackageProof = (executionPackage: ExecutionPackage): PublicExecutionPackageProof => ({
  id: executionPackage.id,
  phase: executionPackage.phase,
  activity_state: executionPackage.activity_state,
  gate_state: executionPackage.gate_state,
  resolution: executionPackage.resolution,
  ...(executionPackage.current_run_session_id === undefined ? {} : { current_run_session_id: executionPackage.current_run_session_id }),
  ...(executionPackage.last_run_session_id === undefined ? {} : { last_run_session_id: executionPackage.last_run_session_id }),
  ...(executionPackage.current_review_packet_id === undefined ? {} : { current_review_packet_id: executionPackage.current_review_packet_id }),
});

const assertNoExecutionRuntimeState = async (
  repository: DeliveryRepository,
  developmentPlanId: string,
  itemId: string,
): Promise<{ noExecutionRuntimeStateCreated: NoExecutionStateCreated; executionPackageBoundary: ExecutionPackageBoundaryCreated }> => {
  const projection = await getDevelopmentPlanItemProjection(repository, developmentPlanId, itemId) as PlanItemProjection | undefined;
  assertCondition(projection !== undefined, 'Plan Item public projection is missing');
  const boundary = projection.runtime_boundary;
  assertCondition(boundary !== undefined && boundary.type === 'execution_package', 'Public projection is missing Execution Package boundary');
  assertCondition(boundary.phase === 'draft', `Execution Package boundary phase should be draft; got ${boundary.phase}`);
  assertCondition(boundary.activity_state === 'idle', `Execution Package boundary activity should be idle; got ${boundary.activity_state}`);
  assertCondition(boundary.gate_state === 'not_submitted', `Execution Package boundary gate should be not_submitted; got ${boundary.gate_state}`);

  const executionPackageRecord = await repository.getExecutionPackage(boundary.id);
  assertCondition(executionPackageRecord !== undefined, 'Execution Package boundary record is missing');
  const executionPackage = publicExecutionPackageProof(executionPackageRecord);
  assertCondition(executionPackage.id === boundary.id, 'Public Execution Package proof is not boundary-scoped');
  assertCondition(executionPackage.phase === 'draft', `Execution Package boundary phase should be draft; got ${executionPackage.phase}`);
  assertCondition(executionPackage.activity_state === 'idle', `Execution Package boundary activity should be idle; got ${executionPackage.activity_state}`);
  assertCondition(executionPackage.gate_state === 'not_submitted', `Execution Package boundary gate should be not_submitted; got ${executionPackage.gate_state}`);
  assertCondition(executionPackage.resolution === 'none', `Execution Package boundary resolution should be none; got ${executionPackage.resolution}`);

  const runSessionCount = [executionPackage.current_run_session_id, executionPackage.last_run_session_id].filter(
    (id) => id !== undefined,
  ).length;
  const executionCount = projection.executions?.length ?? 0;
  const codeReviewHandoffCount = projection.code_review_handoffs?.length ?? 0;
  const qaHandoffCount = projection.qa_handoffs?.length ?? 0;
  const reviewLoopCount = (executionPackage.current_review_packet_id === undefined ? 0 : 1) + codeReviewHandoffCount + qaHandoffCount;
  const noExecutionRuntimeStateCreated = {
    run_session_count: runSessionCount,
    execution_worker_job_count: executionCount,
    workspace_bundle_count: executionCount,
    pr_count: codeReviewHandoffCount,
    review_loop_count: reviewLoopCount,
  };
  assertCondition(
    Object.values(noExecutionRuntimeStateCreated).every((count) => count === 0),
    `Wave 5 created execution-side state: ${JSON.stringify(noExecutionRuntimeStateCreated)}`,
  );
  return {
    noExecutionRuntimeStateCreated,
    executionPackageBoundary: {
      execution_package_count: 1,
      phase: executionPackage.phase,
      activity_state: executionPackage.activity_state,
      gate_state: executionPackage.gate_state,
      resolution: executionPackage.resolution,
      run_session_count: noExecutionRuntimeStateCreated.run_session_count,
    },
  };
};

const linkGeneratedImplementationPlanForApproval = async (
  repository: DeliveryRepository,
  input: {
    workflowId: string;
    developmentPlanItemId: string;
    implementationPlanRevisionId: string;
    actorId: string;
  },
): Promise<void> => {
  const revision = await repository.getExecutionPlanRevision(input.implementationPlanRevisionId);
  assertCondition(revision !== undefined, 'Generated Implementation Plan revision is missing');
  const executionPlan = await repository.getExecutionPlan(revision.execution_plan_id);
  assertCondition(executionPlan !== undefined, 'Generated Implementation Plan document is missing');
  assertCondition(executionPlan.workflow_id === input.workflowId, 'Generated Implementation Plan document is not workflow-owned');
  const objectEvent: ObjectEvent = {
    id: `dogfood-link-${revision.id}`,
    object_type: 'development_plan_item',
    object_id: input.developmentPlanItemId,
    event_type: 'item_implementation_plan_draft_generated',
    actor_id: input.actorId,
    metadata: {
      implementation_plan_id: executionPlan.id,
      implementation_plan_revision_id: revision.id,
      workflow_id: input.workflowId,
      source: 'dogfood_real_generated_plan_linkage',
    },
    created_at: new Date().toISOString(),
  };
  await repository.appendObjectEvent(objectEvent);
};

const main = async () => {
  const app = await createApp();
  try {
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    const service = app.get(PlanItemWorkflowService);
    const routeCalls: RouteCall[] = [];
    const seeded = await seedDevelopmentPlanItem(app, { idPrefix: actorIdPrefix });
    const actorId = seeded.ids.actorTech;

    console.log('start Brainstorming');
    const start = await service.startBrainstorming(seeded.plan.id, seeded.item.id, {
      actor_id: actorId,
      reason: 'Start deterministic Plan Item Workflow dogfood.',
    });
    routeCalls.push({ route: routeStartBrainstorming, status: start.status, runtime_call: false });
    assertCondition(start.status === 'brainstorming', 'Start did not enter brainstorming');
    assertCondition(start.queued_actions.length === 1, 'Start did not create exactly one queued continuation action');

    const workflowId = start.id;
    const persistedStart = await repository.getPlanItemWorkflow(workflowId);
    const codexSessionId = persistedStart?.active_codex_session_id;
    assertCondition(codexSessionId !== undefined, 'Persisted workflow is missing its private active CodexSession');
    assertCondition((await repository.listCodexSessionTurns(codexSessionId)).length === 0, 'Start created a runtime turn');
    const expected = { workflowId };

    console.log('message/no runtime call blocked while startup action is queued');
    try {
      await service.recordWorkflowMessage(workflowId, {
        actor_id: actorId,
        action: 'answer_boundary_question',
        body_markdown: 'This message proves the route is non-runtime and conflict-gated while a queued action is pending.',
      });
      throw new Error('message/no runtime call unexpectedly succeeded while startup queued action was active');
    } catch (error) {
      assertCondition(
        error instanceof Error && error.message.includes('workflow_action_already_pending'),
        `message/no runtime call failed with unexpected error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    routeCalls.push({
      route: routeMessages,
      status: 'workflow_action_already_pending',
      runtime_call: false,
      note: 'message route rejected before any runtime turn because startup queued action was active',
    });
    assertCondition((await repository.listCodexSessionTurns(codexSessionId)).length === 0, 'Rejected message created a runtime turn');

    console.log('create queued Brainstorming continuation action');
    const firstContinuation = await expectSingleActiveQueuedAction(repository, workflowId, 'continue_brainstorming');
    const firstContinuationRun = await runQueuedAction(
      service,
      routeCalls,
      workflowId,
      firstContinuation,
      actorId,
      'run Brainstorming continuation',
    );
    assertSameWorkflow(firstContinuationRun.workflow, expected, 'First Brainstorming continuation');

    const turnsAfterInitialContinuation = await repository.listCodexSessionTurns(codexSessionId);
    assertCondition(turnsAfterInitialContinuation.length === 1, 'Initial continuation did not create exactly one runtime turn');
    assertCondition(
      (await repository.listActivePlanItemWorkflowQueuedActions(workflowId)).length === 0,
      'Initial continuation should wait for human boundary input before queuing Boundary Summary generation',
    );

    const boundaryAnswer = await submitWorkflowMessage(
      service,
      routeCalls,
      workflowId,
      actorId,
      'answer Boundary question',
    );
    assertSameWorkflow(boundaryAnswer, expected, 'Boundary answer');

    const secondContinuation = await expectSingleActiveQueuedAction(repository, workflowId, 'continue_brainstorming');
    const secondContinuationRun = await runQueuedAction(
      service,
      routeCalls,
      workflowId,
      secondContinuation,
      actorId,
      'run Brainstorming continuation after Boundary answer',
    );
    assertSameWorkflow(secondContinuationRun.workflow, expected, 'Second Brainstorming continuation');

    console.log('create queued Boundary Summary action');
    const firstBoundaryAction = await expectSingleActiveQueuedAction(repository, workflowId, 'generate_boundary_summary');
    const boundaryRun = await runQueuedAction(service, routeCalls, workflowId, firstBoundaryAction, actorId, 'run Boundary Summary generation');
    assertSameWorkflow(boundaryRun.workflow, expected, 'Boundary Summary generation');
    const firstBoundaryRevisionId = boundaryRun.workflow.active_boundary_summary_revision_id;
    assertCondition(firstBoundaryRevisionId !== undefined, 'Boundary Summary generation did not activate a revision');

    const specQueued = await approveArtifact(
      service,
      routeCalls,
      workflowId,
      'boundary-summary',
      firstBoundaryRevisionId,
      actorId,
      'approve Boundary Summary',
    );
    assertSameWorkflow(specQueued, expected, 'Boundary Summary approval');

    console.log('create queued Spec Doc action');
    const specGeneration = await expectSingleActiveQueuedAction(repository, workflowId, 'generate_spec_doc');
    const specRun = await runQueuedAction(service, routeCalls, workflowId, specGeneration, actorId, 'run Spec Doc generation');
    const firstSpecRevisionId = specRun.workflow.active_spec_doc_revision_id;
    assertCondition(firstSpecRevisionId !== undefined, 'Spec Doc generation did not activate a revision');

    const specRevisionQueued = await requestArtifactChanges(
      service,
      routeCalls,
      workflowId,
      'spec-doc',
      firstSpecRevisionId,
      actorId,
      'request Spec Doc changes',
    );
    assertSameWorkflow(specRevisionQueued, expected, 'Spec Doc request changes');

    const specRevisionAction = await expectSingleActiveQueuedAction(repository, workflowId, 'revise_spec_doc');
    const revisedSpecRun = await runQueuedAction(service, routeCalls, workflowId, specRevisionAction, actorId, 'run Spec Doc revision');
    const revisedSpecRevisionId = revisedSpecRun.workflow.active_spec_doc_revision_id;
    assertCondition(revisedSpecRevisionId !== undefined, 'Spec Doc revision did not activate a revision');
    assertCondition(revisedSpecRevisionId !== firstSpecRevisionId, 'Spec Doc revision reused the old revision id');

    const implementationPlanQueued = await approveArtifact(
      service,
      routeCalls,
      workflowId,
      'spec-doc',
      revisedSpecRevisionId,
      actorId,
      'approve Spec Doc',
    );
    assertSameWorkflow(implementationPlanQueued, expected, 'Spec Doc approval');

    console.log('create queued Implementation Plan Doc action');
    const implementationPlanGeneration = await expectSingleActiveQueuedAction(repository, workflowId, 'generate_implementation_plan_doc');
    const implementationPlanRun = await runQueuedAction(
      service,
      routeCalls,
      workflowId,
      implementationPlanGeneration,
      actorId,
      'run Implementation Plan Doc generation',
    );
    const firstImplementationPlanRevisionId = implementationPlanRun.workflow.active_implementation_plan_doc_revision_id;
    assertCondition(firstImplementationPlanRevisionId !== undefined, 'Implementation Plan generation did not activate a revision');

    const implementationPlanRevisionQueued = await requestArtifactChanges(
      service,
      routeCalls,
      workflowId,
      'implementation-plan-doc',
      firstImplementationPlanRevisionId,
      actorId,
      'request Implementation Plan Doc changes',
    );
    assertSameWorkflow(implementationPlanRevisionQueued, expected, 'Implementation Plan Doc request changes');

    const implementationPlanRevisionAction = await expectSingleActiveQueuedAction(repository, workflowId, 'revise_implementation_plan_doc');
    const revisedImplementationPlanRun = await runQueuedAction(
      service,
      routeCalls,
      workflowId,
      implementationPlanRevisionAction,
      actorId,
      'run Implementation Plan Doc revision',
    );
    const revisedImplementationPlanRevisionId = revisedImplementationPlanRun.workflow.active_implementation_plan_doc_revision_id;
    assertCondition(revisedImplementationPlanRevisionId !== undefined, 'Implementation Plan revision did not activate a revision');
    assertCondition(
      revisedImplementationPlanRevisionId !== firstImplementationPlanRevisionId,
      'Implementation Plan revision reused the old revision id',
    );
    await linkGeneratedImplementationPlanForApproval(repository, {
      workflowId,
      developmentPlanItemId: seeded.item.id,
      implementationPlanRevisionId: revisedImplementationPlanRevisionId,
      actorId,
    });

    const approvedPlan = await approveArtifact(
      service,
      routeCalls,
      workflowId,
      'implementation-plan-doc',
      revisedImplementationPlanRevisionId,
      actorId,
      'approve Implementation Plan Doc',
    );
    assertSameWorkflow(approvedPlan, expected, 'Implementation Plan approval');
    assertCondition(approvedPlan.status === 'implementation_plan_review', 'Implementation Plan approval marked execution ready automatically');
    assertCondition(approvedPlan.readiness?.state === 'not_evaluated', 'Implementation Plan approval did not leave readiness unevaluated');

    console.log('evaluate Execution Ready');
    const readiness = await service.evaluateExecutionReadiness(workflowId, {
      actor_id: actorId,
      rationale_markdown: 'Evaluate deterministic Wave 5 handoff readiness.',
    });
    routeCalls.push({ route: routeReadiness, status: readiness.status, runtime_call: false });
    assertSameWorkflow(readiness, expected, 'Execution readiness');
    assertCondition(readiness.status === 'execution_ready', 'Readiness did not transition to execution_ready');
    assertCondition(readiness.readiness?.state === 'ready', 'Readiness did not report ready');
    assertCondition((readiness.readiness?.blocker_codes ?? []).length === 0, 'Readiness reported blockers');

    const workflow = await repository.getPlanItemWorkflow(workflowId);
    assertCondition(workflow !== undefined, 'Workflow was not persisted');
    const boundaryRevisionId = workflow.active_boundary_summary_revision_id;
    const specRevisionId = workflow.active_spec_doc_revision_id;
    const implementationPlanDocRevisionId = workflow.active_implementation_plan_doc_revision_id;
    assertCondition(boundaryRevisionId !== undefined, 'Workflow missing active Boundary Summary revision');
    assertCondition(specRevisionId !== undefined, 'Workflow missing active Spec Doc revision');
    assertCondition(implementationPlanDocRevisionId !== undefined, 'Workflow missing active Implementation Plan Doc revision');

    const [boundaryRevision, specRevisionRecord, implementationPlanRevisionRecord] = await Promise.all([
      repository.getBoundarySummaryRevisionById(boundaryRevisionId),
      repository.getSpecRevision(specRevisionId),
      repository.getExecutionPlanRevision(implementationPlanDocRevisionId),
    ]);
    assertCondition(boundaryRevision !== undefined, 'Boundary Summary revision was not persisted');
    assertCondition(specRevisionRecord !== undefined, 'Spec Doc revision was not persisted');
    assertCondition(implementationPlanRevisionRecord !== undefined, 'Implementation Plan Doc revision was not persisted');
    for (const [label, revision] of [
      ['Boundary Summary', boundaryRevision],
      ['Spec Doc', specRevisionRecord],
      ['Implementation Plan Doc', implementationPlanRevisionRecord],
    ] as const) {
      assertCondition(revision.workflow_id === workflowId, `${label} revision does not belong to workflow`);
      assertCondition(revision.development_plan_item_id === seeded.item.id, `${label} revision does not belong to Plan Item`);
      assertCondition(revision.codex_session_id === codexSessionId, `${label} revision does not belong to active CodexSession`);
    }

    const queuedActions = await repository.listPlanItemWorkflowQueuedActions(workflowId);
    const turns = await repository.listCodexSessionTurns(codexSessionId);
    assertCondition(turns.length === requiredTurnIntents.length, `Expected ${requiredTurnIntents.length} turns; got ${turns.length}`);
    const turnsById = new Map(turns.map((turn) => [turn.id, turn]));
    const succeededActionsByTurnId = new Map(
      queuedActions
        .filter((action) => action.status === 'succeeded')
        .map((action) => {
          assertCondition(action.codex_session_turn_id !== undefined, `Action ${action.id} is missing its Codex turn id`);
          return [action.codex_session_turn_id, action] as const;
        }),
    );
    assertCondition(succeededActionsByTurnId.size === requiredActionKinds.length, `Expected ${requiredActionKinds.length} succeeded actions`);
    const succeededActions = Array.from(succeededActionsByTurnId.values()).sort(
      (left, right) => (left.output_capsule_sequence ?? 0) - (right.output_capsule_sequence ?? 0),
    );
    const orderedTurns = succeededActions.map((action) => {
      assertCondition(action.codex_session_turn_id !== undefined, `Action ${action.id} is missing its Codex turn id`);
      const turn = turnsById.get(action.codex_session_turn_id);
      assertCondition(turn !== undefined, `Action references missing turn ${action.codex_session_turn_id}`);
      return turn;
    });
    assertCondition(
      orderedTurns.map((turn) => turn.intent).join('|') === requiredTurnIntents.join('|'),
      `Unexpected turn order ${orderedTurns.map((turn) => turn.intent).join('|')}`,
    );
    assertCondition(
      succeededActions.map((action) => action.kind).join('|') === requiredActionKinds.join('|'),
      `Unexpected action order ${succeededActions.map((action) => action.kind).join('|')}`,
    );
    for (const [index, turn] of orderedTurns.entries()) {
      assertCondition(turn.workflow_id === workflowId, `Turn ${turn.id} is not workflow-owned`);
      assertCondition(turn.codex_session_id === codexSessionId, `Turn ${turn.id} is not session-owned`);
      assertCondition(turn.status === 'succeeded', `Turn ${turn.id} did not succeed`);
      const action = succeededActions[index];
      assertCondition(action !== undefined, `Missing action at turn index ${index}`);
      assertCondition(action.codex_session_turn_id === turn.id, `Action ${action.id} did not attach turn ${turn.id}`);
      assertCondition(turn.output_capsule_digest === action.output_capsule_digest, `Action ${action.id} capsule digest differs from turn`);
      if (index === 0) {
        assertCondition(turn.expected_input_capsule_digest === undefined, 'First turn should not expect an input capsule');
      } else {
        assertCondition(
          turn.expected_input_capsule_digest === orderedTurns[index - 1]?.output_capsule_digest,
          `Turn ${turn.id} did not consume the previous output capsule digest`,
        );
      }
    }

    const { noExecutionRuntimeStateCreated, executionPackageBoundary } = await assertNoExecutionRuntimeState(
      repository,
      seeded.plan.id,
      seeded.item.id,
    );
    console.log('one workflow_id');
    console.log('one private CodexSession continuity verified');

    const report = {
      status: 'PASS',
      source: 'real_service_api_repository',
      workflow_id: workflowId,
      session_continuity: {
        same_private_codex_session: true,
        turn_count: orderedTurns.length,
        codex_thread_id_digest: succeededActions[0]?.codex_thread_id_digest,
      },
      route_calls: routeCalls,
      queued_actions: succeededActions.map((action) => ({
        id: action.id,
        kind: action.kind,
        status: action.status,
        expected_input_capsule_digest: action.expected_input_capsule_digest,
        output_capsule_digest: action.output_capsule_digest,
        output_capsule_sequence: action.output_capsule_sequence,
        codex_thread_id_digest: action.codex_thread_id_digest,
      })),
      turns: orderedTurns.map((turn, index) => ({
        intent: turn.intent,
        sequence: index + 1,
        workflow_id: turn.workflow_id,
        status: turn.status,
        expected_input_capsule_digest: turn.expected_input_capsule_digest,
        output_capsule_digest: turn.output_capsule_digest,
      })),
      artifacts: {
        boundary_summary_revision_id: boundaryRevision.id,
        spec_revision_id: specRevisionRecord.id,
        implementation_plan_revision_id: implementationPlanRevisionRecord.id,
        workflow_id: workflowId,
        development_plan_item_id: seeded.item.id,
      },
      readiness: {
        state: readiness.readiness?.state,
        workflow_status: readiness.status,
        blocker_codes: readiness.readiness?.blocker_codes ?? [],
      },
      no_execution_runtime_state_created: noExecutionRuntimeStateCreated,
      execution_package_boundary: executionPackageBoundary,
    };

    console.log(`DOGFOOD_REPORT_JSON:${JSON.stringify(report)}`);
  } finally {
    await app.close();
  }
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
