import type { PlanItemWorkflowPublicDto, WorkflowArtifactType } from '../../shared/api/types';
import type { BoundarySummaryRevision, DevelopmentPlanItemProjection } from './plan-item-gates';

export type WorkflowRoleLens = 'product' | 'tech_lead' | 'developer' | 'qa';

export type WorkflowStageModel = {
  id: 'brainstorming' | 'spec_doc' | 'implementation_plan_doc' | 'execution_ready';
  label: string;
  status: string;
  nextAction: string;
  emphasized: boolean;
};

export type WorkflowArtifactModel = {
  artifactType: WorkflowArtifactType;
  label: string;
  revisionId?: string | undefined;
  body: string;
  canReview: boolean;
  reviewDisabledReason?: string;
};

export type WorkflowConversationEventModel = {
  id: string;
  title: string;
  body: string;
  createdAt?: string;
  queuedActionId?: string;
  queuedActionLabel?: string;
  queuedActionStatus?: string;
};

export type WorkflowExecutionRunSummaryModel = {
  digestRows: Array<{ label: string; value: string }>;
  runSessionId: string;
  status: string;
  executionPackageVersion?: number;
  finishedAt?: string;
  startedAt?: string;
  updatedAt?: string;
};

export type PlanItemWorkflowWorkspaceModel = {
  artifacts: WorkflowArtifactModel[];
  blockers: string[];
  canEvaluateReadiness: boolean;
  canStartExecution: boolean;
  composerDisabledReason?: string;
  contextPreview: Array<{ label: string; value: string }>;
  conversationEvents: WorkflowConversationEventModel[];
  defaultArtifact?: WorkflowArtifactModel;
  executionRunSummary?: WorkflowExecutionRunSummaryModel;
  readinessDisabledReason?: string;
  readinessState: string;
  roleLens: Array<{ id: WorkflowRoleLens; label: string; selected: boolean }>;
  stages: WorkflowStageModel[];
  workflow: PlanItemWorkflowPublicDto;
};

type WorkflowDocumentProjection = {
  title?: string;
  current_revision_markdown?: string;
  markdown_excerpt?: string;
  content?: string;
  body_markdown?: string;
  markdown?: string;
};

export function toPlanItemWorkflowWorkspaceModel(input: {
  boundaryRevisions: readonly BoundarySummaryRevision[];
  item: DevelopmentPlanItemProjection;
  roleLens: WorkflowRoleLens;
}): PlanItemWorkflowWorkspaceModel {
  const workflow = input.item.plan_item_workflow;
  if (workflow === undefined) {
    throw new Error('Plan Item workflow projection is required for workflow workspace');
  }

  const artifacts = artifactDrawerModel(input.item, workflow, input.boundaryRevisions);
  const composerDisabledReason = hasRunningAction(workflow) ? 'A generation action is already queued or running.' : undefined;
  const defaultArtifact = artifacts.find((artifact) => artifact.revisionId !== undefined) ?? artifacts[0];
  const { execution_run_summary: hiddenRunSummary, ...workflowForUi } = workflow;
  const executionRunSummary = executionRunSummaryModel(hiddenRunSummary);
  const model: PlanItemWorkflowWorkspaceModel = {
    artifacts,
    blockers: workflow.blockers.map((blocker) => blocker.code),
    canEvaluateReadiness: workflow.readiness?.can_evaluate ?? false,
    canStartExecution: workflow.status === 'execution_ready',
    ...(composerDisabledReason === undefined ? {} : { composerDisabledReason }),
    contextPreview: contextPreviewModel(input.item, workflow),
    conversationEvents: conversationEvents(workflow),
    ...(defaultArtifact === undefined ? {} : { defaultArtifact }),
    ...(executionRunSummary === undefined ? {} : { executionRunSummary }),
    ...optionalReadinessDisabledReason(workflow),
    readinessState: workflow.readiness?.state ?? 'not_evaluated',
    roleLens: roleLensModel(input.roleLens),
    stages: timelineStages(input.item, workflow, input.roleLens),
    workflow: workflowForUi,
  };
  assertNoRawRuntimeFieldsForUi(model);
  return model;
}

export function timelineStages(
  item: DevelopmentPlanItemProjection,
  workflow: PlanItemWorkflowPublicDto,
  roleLens: WorkflowRoleLens,
): WorkflowStageModel[] {
  const emphasized = (stage: WorkflowStageModel['id']) =>
    (roleLens === 'product' && stage === 'brainstorming') ||
    (roleLens === 'tech_lead' && (stage === 'spec_doc' || stage === 'implementation_plan_doc')) ||
    (roleLens === 'developer' && stage === 'implementation_plan_doc') ||
    (roleLens === 'qa' && stage === 'execution_ready');

  return [
    {
      id: 'brainstorming',
      label: 'Brainstorming',
      status: item.boundary_status ?? workflow.status,
      nextAction: workflow.active_boundary_summary_revision_id === undefined ? 'Continue AI or answer boundary questions' : 'Boundary Summary available',
      emphasized: emphasized('brainstorming'),
    },
    {
      id: 'spec_doc',
      label: 'Spec Doc',
      status: item.spec_status ?? workflow.status,
      nextAction: nextQueuedActionLabel(workflow, ['generate_spec_doc', 'revise_spec_doc']) ?? 'Review Spec Doc revision',
      emphasized: emphasized('spec_doc'),
    },
    {
      id: 'implementation_plan_doc',
      label: 'Implementation Plan Doc',
      status: item.implementation_plan_status ?? workflow.status,
      nextAction: nextQueuedActionLabel(workflow, ['generate_implementation_plan_doc', 'revise_implementation_plan_doc']) ?? 'Review Implementation Plan Doc',
      emphasized: emphasized('implementation_plan_doc'),
    },
    {
      id: 'execution_ready',
      label: 'Execution Ready',
      status: workflow.readiness?.state ?? item.execution_status ?? 'not_evaluated',
      nextAction: 'Evaluate readiness without starting execution',
      emphasized: emphasized('execution_ready'),
    },
  ];
}

export function conversationEvents(workflow: PlanItemWorkflowPublicDto): WorkflowConversationEventModel[] {
  const eventModels = workflow.timeline_events.map((event) => {
    const queuedActionLabelValue = event.queued_action_kind === undefined ? undefined : queuedActionLabel(event.queued_action_kind);
    return optionalConversationEvent({
      id: event.id,
      title: humanize(event.event_type),
      body: event.queued_action_kind === undefined
        ? event.body_markdown ?? event.status ?? 'Recorded'
        : `${queuedActionLabelValue} is ${event.queued_action_status ?? event.status ?? 'queued'}.`,
      createdAt: event.created_at,
      queuedActionId: event.queued_action_id,
      queuedActionLabel: queuedActionLabelValue,
      queuedActionStatus: event.queued_action_status,
    });
  });

  if (eventModels.length > 0) return eventModels;
  return workflow.queued_actions.map((action) => ({
    id: action.id,
    title: 'Queued action',
    body: `${queuedActionLabel(action.kind)} is ${action.status}.`,
    createdAt: action.created_at,
    queuedActionId: action.id,
    queuedActionLabel: queuedActionLabel(action.kind),
    queuedActionStatus: action.status,
  }));
}

export function artifactDrawerModel(
  item: DevelopmentPlanItemProjection,
  workflow: PlanItemWorkflowPublicDto,
  boundaryRevisions: readonly BoundarySummaryRevision[],
): WorkflowArtifactModel[] {
  const boundary = boundaryRevisions.find((revision) => revision.id === workflow.active_boundary_summary_revision_id) ?? boundaryRevisions[0];
  const specDoc = item.specs?.[0] as WorkflowDocumentProjection | undefined;
  const implementationPlanDoc = item.implementation_plan_docs?.[0] as WorkflowDocumentProjection | undefined;
  return [
    optionalArtifact({
      artifactType: 'boundary_summary',
      label: 'Boundary Summary',
      revisionId: workflow.active_boundary_summary_revision_id,
      body: boundary?.summary_markdown ?? boundary?.summary ?? 'Boundary Summary has not been generated yet.',
      canReview: workflow.status === 'boundary_review' && workflow.active_boundary_summary_revision_id !== undefined,
      reviewDisabledReason: reviewDisabledReason(
        workflow.status === 'boundary_review',
        workflow.active_boundary_summary_revision_id,
        'Boundary Summary review is available only during Boundary Review.',
        'Boundary Summary revision is not available yet.',
      ),
    }),
    optionalArtifact({
      artifactType: 'spec_doc',
      label: 'Spec Doc',
      revisionId: workflow.active_spec_doc_revision_id,
      body: workflowDocumentBody(specDoc, 'Spec Doc has not been generated yet.'),
      canReview: workflow.status === 'spec_review' && workflow.active_spec_doc_revision_id !== undefined,
      reviewDisabledReason: reviewDisabledReason(
        workflow.status === 'spec_review',
        workflow.active_spec_doc_revision_id,
        'Spec Doc review is available only during Spec Review.',
        'Spec Doc revision is not available yet.',
      ),
    }),
    optionalArtifact({
      artifactType: 'implementation_plan_doc',
      label: 'Implementation Plan Doc',
      revisionId: workflow.active_implementation_plan_doc_revision_id,
      body: workflowDocumentBody(implementationPlanDoc, 'Implementation Plan Doc has not been generated yet.'),
      canReview: workflow.status === 'implementation_plan_review' && workflow.active_implementation_plan_doc_revision_id !== undefined,
      reviewDisabledReason: reviewDisabledReason(
        workflow.status === 'implementation_plan_review',
        workflow.active_implementation_plan_doc_revision_id,
        'Implementation Plan Doc review is available only during Implementation Plan Review.',
        'Implementation Plan Doc revision is not available yet.',
      ),
    }),
  ];
}

export function contextPreviewModel(item: DevelopmentPlanItemProjection, workflow: PlanItemWorkflowPublicDto) {
  return [
    { label: 'Source', value: item.source_ref?.title ?? item.source_ref?.id ?? 'Unlinked source' },
    { label: 'Development Plan', value: item.development_plan_ref?.title ?? item.development_plan_ref?.id ?? workflow.development_plan_id },
    { label: 'Plan Item', value: item.title },
    { label: 'Boundary revision', value: workflow.active_boundary_summary_revision_id ?? 'Not approved' },
    { label: 'Spec revision', value: workflow.active_spec_doc_revision_id ?? 'Not approved' },
    { label: 'Implementation Plan revision', value: workflow.active_implementation_plan_doc_revision_id ?? 'Not approved' },
    { label: 'Context digest', value: workflow.context_preview?.digest ?? 'No digest' },
    { label: 'Workflow continuity', value: workflow.session.continuity_state },
  ];
}

export function executionRunSummaryModel(
  summary: PlanItemWorkflowPublicDto['execution_run_summary'],
): WorkflowExecutionRunSummaryModel | undefined {
  if (summary === undefined) return undefined;
  const digestRows = [
    optionalDigestRow('Input capsule digest', summary.input_capsule_digest),
    optionalDigestRow('Workspace bundle digest', summary.workspace_bundle_digest),
    optionalDigestRow('Thread digest', summary.codex_thread_id_digest),
  ].filter((row): row is { label: string; value: string } => row !== undefined);

  return {
    digestRows,
    runSessionId: summary.run_session_id,
    status: summary.status,
    ...(summary.execution_package_version === undefined ? {} : { executionPackageVersion: summary.execution_package_version }),
    ...(summary.finished_at === undefined ? {} : { finishedAt: summary.finished_at }),
    ...(summary.started_at === undefined ? {} : { startedAt: summary.started_at }),
    ...(summary.updated_at === undefined ? {} : { updatedAt: summary.updated_at }),
  };
}

export function roleLensModel(selected: WorkflowRoleLens) {
  return [
    { id: 'product' as const, label: 'Product', selected: selected === 'product' },
    { id: 'tech_lead' as const, label: 'Tech Lead', selected: selected === 'tech_lead' },
    { id: 'developer' as const, label: 'Developer', selected: selected === 'developer' },
    { id: 'qa' as const, label: 'QA', selected: selected === 'qa' },
  ];
}

function optionalDigestRow(label: string, value: string | undefined) {
  return value === undefined ? undefined : { label, value };
}

export function assertNoRawRuntimeFieldsForUi(model: PlanItemWorkflowWorkspaceModel): void {
  const forbiddenKeys = new Set([
    'active_codex_session_id',
    'codex_session_id',
    'codex_session_turn_id',
    'output_capsule_id',
    'input_capsule_id',
    'latest_capsule_id',
    'base_memory_bundle_ref',
    'latest_memory_bundle_ref',
    'input_memory_bundle_ref',
    'output_memory_bundle_ref',
    'memory_bundle_ref',
    'memory_refs',
    'input_environment_manifest_ref',
    'output_environment_manifest_ref',
    'latest_environment_manifest_ref',
    'prompt_transcript',
    'prompt_transcript_ref',
    'local_path',
    'local_artifact_path',
    'execution_package_id',
    'internal_execution_package_id',
    'lease_token',
    'lease_token_hash',
    'worker_id',
    'credential_binding_id',
    'credential_binding_version_id',
    'runtime_profile_id',
    'runtime_profile_revision_id',
  ]);
  const forbiddenKeyPatterns = [/codex_thread_id$/i, /capsule_ref$/i, /artifact_ref$/i, /credential.*metadata/i];
  const forbiddenValuePatterns = [/artifact:\/\//i, /prompt transcript/i, /\/Users\//i, /local artifact path/i];
  for (const violation of rawRuntimeFieldViolations(model, forbiddenKeys, forbiddenKeyPatterns, forbiddenValuePatterns)) {
    throw new Error(`Workflow workspace model contains raw runtime field: ${violation}`);
  }
}

function rawRuntimeFieldViolations(
  value: unknown,
  forbiddenKeys: ReadonlySet<string>,
  forbiddenKeyPatterns: readonly RegExp[],
  forbiddenValuePatterns: readonly RegExp[],
  path = '$',
  seen = new WeakSet<object>(),
): string[] {
  if (typeof value === 'string') {
    const valueMatch = forbiddenValuePatterns.find((pattern) => pattern.test(value));
    return valueMatch === undefined ? [] : [`${path} value ${valueMatch.source}`];
  }
  if (value === null || typeof value !== 'object') {
    return [];
  }
  if (seen.has(value)) {
    return [];
  }
  seen.add(value);
  const violations: string[] = [];
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      violations.push(...rawRuntimeFieldViolations(entry, forbiddenKeys, forbiddenKeyPatterns, forbiddenValuePatterns, `${path}[${index}]`, seen));
    });
    return violations;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const childPath = `${path}.${key}`;
    if (forbiddenKeys.has(key) || forbiddenKeyPatterns.some((pattern) => pattern.test(key))) {
      violations.push(childPath);
    }
    violations.push(...rawRuntimeFieldViolations(child, forbiddenKeys, forbiddenKeyPatterns, forbiddenValuePatterns, childPath, seen));
  }
  return violations;
}

export function queuedActionLabel(kind: PlanItemWorkflowPublicDto['queued_actions'][number]['kind']): string {
  switch (kind) {
    case 'continue_brainstorming':
      return 'Brainstorming continuation';
    case 'generate_boundary_summary':
      return 'Boundary Summary generation';
    case 'revise_boundary_summary':
      return 'Boundary Summary revision';
    case 'generate_spec_doc':
      return 'Spec Doc generation';
    case 'revise_spec_doc':
      return 'Spec Doc revision';
    case 'generate_implementation_plan_doc':
      return 'Implementation Plan Doc generation';
    case 'revise_implementation_plan_doc':
      return 'Implementation Plan Doc revision';
    case 'continue_execution':
      return 'Execution continuation';
    case 'respond_to_review':
      return 'Review response';
    case 'request_fix':
      return 'Review fix request';
  }
}

function nextQueuedActionLabel(
  workflow: PlanItemWorkflowPublicDto,
  kinds: Array<PlanItemWorkflowPublicDto['queued_actions'][number]['kind']>,
) {
  const action = workflow.queued_actions.find((candidate) => kinds.includes(candidate.kind));
  return action === undefined ? undefined : queuedActionLabel(action.kind);
}

function hasRunningAction(workflow: PlanItemWorkflowPublicDto) {
  return workflow.queued_actions.some((action) => action.status === 'queued' || action.status === 'running');
}

function workflowDocumentBody(document: WorkflowDocumentProjection | undefined, fallback: string) {
  return document?.current_revision_markdown ?? document?.markdown_excerpt ?? document?.content ?? document?.body_markdown ?? document?.markdown ?? document?.title ?? fallback;
}

function optionalArtifact(input: Omit<WorkflowArtifactModel, 'revisionId' | 'reviewDisabledReason'> & {
  revisionId: string | undefined;
  reviewDisabledReason?: string | undefined;
}): WorkflowArtifactModel {
  return {
    artifactType: input.artifactType,
    label: input.label,
    ...(input.revisionId === undefined ? {} : { revisionId: input.revisionId }),
    body: input.body,
    canReview: input.canReview,
    ...(input.reviewDisabledReason === undefined ? {} : { reviewDisabledReason: input.reviewDisabledReason }),
  };
}

function reviewDisabledReason(stageAllowsReview: boolean, revisionId: string | undefined, stageReason: string, revisionReason: string) {
  if (!stageAllowsReview) return stageReason;
  return revisionId === undefined ? revisionReason : undefined;
}

function optionalReadinessDisabledReason(workflow: PlanItemWorkflowPublicDto): Pick<PlanItemWorkflowWorkspaceModel, 'readinessDisabledReason'> {
  if (workflow.readiness?.can_evaluate === true) return {};
  if (workflow.readiness?.state === 'ready') {
    return { readinessDisabledReason: 'Execution Ready has already been evaluated.' };
  }
  if (workflow.status !== 'implementation_plan_review') {
    return { readinessDisabledReason: 'Execution Ready can be evaluated only during Implementation Plan Review.' };
  }
  return { readinessDisabledReason: 'Execution Ready evaluation is not available yet.' };
}

function optionalConversationEvent(
  input: Omit<WorkflowConversationEventModel, 'createdAt' | 'queuedActionId' | 'queuedActionLabel' | 'queuedActionStatus'> & {
    createdAt: string | undefined;
    queuedActionId: string | undefined;
    queuedActionLabel: string | undefined;
    queuedActionStatus: string | undefined;
  },
): WorkflowConversationEventModel {
  return {
    id: input.id,
    title: input.title,
    body: input.body,
    ...(input.createdAt === undefined ? {} : { createdAt: input.createdAt }),
    ...(input.queuedActionId === undefined ? {} : { queuedActionId: input.queuedActionId }),
    ...(input.queuedActionLabel === undefined ? {} : { queuedActionLabel: input.queuedActionLabel }),
    ...(input.queuedActionStatus === undefined ? {} : { queuedActionStatus: input.queuedActionStatus }),
  };
}

function humanize(value: string) {
  return value.replace(/[._-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}
