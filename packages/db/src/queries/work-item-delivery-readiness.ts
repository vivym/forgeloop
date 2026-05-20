import { createHash } from 'node:crypto';

import {
  workItemDeliveryReadinessSchema,
  type DegradedSourceKey,
  type DeliveryBlocker,
  type DeliveryObjectRef,
  type DeliveryOverallState,
  type DeliveryStage,
  type DeliveryStageId,
  type DeliveryStageState,
  type ProductAction,
  type ProductLaneId,
  type ProductObjectType,
} from '@forgeloop/contracts';
import {
  deriveInitiativeAggregationState,
  deriveRequiredArtifactPresence,
  hasCompleteReviewEvidence,
  normalizeIntegrationReadiness,
  normalizeRequiredTestGate,
  type ExecutionPackage,
  type ExecutionPackageDependency,
  type Plan,
  type PlanRevision,
  type Release,
  type ReviewPacket,
  type RunSession,
  type Spec,
  type SpecRevision,
  type WorkItem,
} from '@forgeloop/domain';

import {
  generatePackagesAction,
  generatePlanDraftAction,
  generateSpecDraftAction,
  navigateAction,
  objectTarget,
  runPackageAction,
} from './product-action-builders';
import { laneForWorkItemKind } from './product-lane-types';
import {
  currentApprovedPlanPackages,
  selectWorkItemReviewPacket,
  selectWorkItemRunSession,
} from './work-item-delivery-selection';
import {
  deriveWorkItemPreReleaseReadiness,
  type DecisionLike,
  type ReleaseBlockerLike,
  type ReleaseEvidenceLike,
  type ReleaseTestAcceptanceEvidenceLike,
} from './work-item-release-readiness';

export interface WorkItemDeliveryReadinessInput {
  workItem: WorkItem;
  activeLane?: ProductLaneId;
  currentSpec: Spec | null;
  currentSpecRevision: SpecRevision | null;
  approvedSpecRevision: SpecRevision | null;
  currentPlan: Plan | null;
  currentPlanRevision: PlanRevision | null;
  approvedPlanRevision: PlanRevision | null;
  packages: readonly ExecutionPackage[];
  packageDependencies: readonly ExecutionPackageDependency[];
  runSessions: readonly RunSession[];
  reviewPackets: readonly ReviewPacket[];
  releases: readonly Release[];
  releaseBlockers: readonly ReleaseBlockerLike[];
  releaseTestAcceptance: readonly ReleaseTestAcceptanceEvidenceLike[];
  releaseEvidence: readonly ReleaseEvidenceLike[];
  decisions: readonly DecisionLike[];
  degradedSources?: readonly DegradedSourceKey[];
}

type StageInput = Omit<DeliveryStage, 'label' | 'blockers' | 'evidence_refs' | 'object_refs'> & {
  label?: string;
  blockers?: DeliveryBlocker[];
  object_refs?: DeliveryObjectRef[];
  evidence_refs?: DeliveryObjectRef[];
};

type StageEvaluation = {
  stages: DeliveryStage[];
  currentPackages: ExecutionPackage[];
  selectedRuns: Map<string, RunSession | undefined>;
  selectedReviews: Map<string, ReviewPacket | undefined>;
  qualityPassed: boolean;
  releaseLinked: Release | undefined;
};

const stageOrder: readonly DeliveryStageId[] = [
  'spec',
  'plan',
  'packages',
  'execution',
  'review',
  'integration_readiness',
  'quality_gate',
  'release_readiness',
];

const stageLabels: Record<DeliveryStageId, string> = {
  spec: 'Spec',
  plan: 'Plan',
  packages: 'Packages',
  execution: 'Execution',
  review: 'Review',
  integration_readiness: 'Integration Readiness',
  quality_gate: 'Quality Gate',
  release_readiness: 'Release Readiness',
};

const stageOwners: Record<DeliveryStageId, ProductLaneId> = {
  spec: 'spec-approver',
  plan: 'spec-approver',
  packages: 'execution-owner',
  execution: 'execution-owner',
  review: 'reviewer',
  integration_readiness: 'execution-owner',
  quality_gate: 'qa-test-owner',
  release_readiness: 'release-owner',
};

const downstream: Record<DeliveryStageId, readonly DeliveryStageId[]> = {
  spec: ['plan', 'packages', 'execution', 'review', 'integration_readiness', 'quality_gate', 'release_readiness'],
  plan: ['packages', 'execution', 'review', 'integration_readiness', 'quality_gate', 'release_readiness'],
  packages: ['execution', 'review', 'integration_readiness', 'quality_gate', 'release_readiness'],
  execution: ['review', 'quality_gate', 'release_readiness'],
  review: ['quality_gate', 'release_readiness'],
  integration_readiness: ['quality_gate', 'release_readiness'],
  quality_gate: ['release_readiness'],
  release_readiness: [],
};

const degradedStageMap: Record<DegradedSourceKey, readonly DeliveryStageId[]> = {
  work_item: [],
  spec: ['spec', 'plan', 'packages', 'execution', 'review', 'integration_readiness', 'quality_gate', 'release_readiness'],
  spec_revision: ['spec', 'plan', 'packages', 'execution', 'review', 'integration_readiness', 'quality_gate', 'release_readiness'],
  plan: ['plan', 'packages', 'execution', 'review', 'integration_readiness', 'quality_gate', 'release_readiness'],
  plan_revision: ['plan', 'packages', 'execution', 'review', 'integration_readiness', 'quality_gate', 'release_readiness'],
  execution_packages: ['packages', 'execution', 'review', 'integration_readiness', 'quality_gate', 'release_readiness'],
  package_dependencies: ['integration_readiness', 'quality_gate', 'release_readiness'],
  run_sessions: ['execution', 'review', 'quality_gate', 'release_readiness'],
  review_packets: ['review', 'quality_gate', 'release_readiness'],
  integration_readiness: ['integration_readiness', 'quality_gate', 'release_readiness'],
  release_scope: ['release_readiness'],
  release_blockers: ['release_readiness'],
  release_test_acceptance: ['release_readiness'],
  decisions: ['release_readiness'],
};

const hasText = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const objectRef = (
  objectType: ProductObjectType,
  objectId: string,
  href: string,
  title?: string,
): DeliveryObjectRef => ({
  object_type: objectType,
  object_id: objectId,
  href,
  ...(title === undefined ? {} : { title }),
});

const blocker = (
  stageId: DeliveryStageId,
  code: string,
  label: string,
  ownerLane: ProductLaneId = stageOwners[stageId],
  object_ref?: DeliveryObjectRef,
): DeliveryBlocker => ({
  id: `${stageId}-${code}-${object_ref?.object_id ?? 'work-item'}`,
  code,
  label,
  stage_id: stageId,
  owner_lane: ownerLane,
  severity: 'blocking',
  ...(object_ref === undefined ? {} : { object_ref }),
  metadata: { code },
});

const stage = (input: StageInput): DeliveryStage => {
  const { label, ...rest } = input;
  return {
    label: label ?? stageLabels[input.id],
    owner_lane: stageOwners[input.id],
    object_refs: [],
    blockers: [],
    evidence_refs: [],
    ...rest,
  };
};

const stageById = (stages: readonly DeliveryStage[], id: DeliveryStageId): DeliveryStage =>
  stages.find((item) => item.id === id) ?? stage({ id, state: 'missing' });

const isStagePassing = (stage: DeliveryStage): boolean =>
  stage.state === 'ready' || stage.state === 'passed' || stage.state === 'not_applicable';

const hasApprovedCurrentRevision = (artifact: {
  status: string;
  resolution: string;
  current_revision_id?: string;
  approved_revision_id?: string;
}): boolean =>
  artifact.status === 'approved' &&
  artifact.resolution === 'approved' &&
  artifact.approved_revision_id !== undefined &&
  artifact.current_revision_id === artifact.approved_revision_id;

const specIsStrictlyReady = (input: WorkItemDeliveryReadinessInput): boolean =>
  input.currentSpec !== null &&
  hasApprovedCurrentRevision(input.currentSpec) &&
  input.approvedSpecRevision !== null &&
  input.approvedSpecRevision.id === input.currentSpec.approved_revision_id &&
  input.approvedSpecRevision.acceptance_criteria.length > 0 &&
  hasText(input.approvedSpecRevision.test_strategy_summary);

const planIsStrictlyReady = (input: WorkItemDeliveryReadinessInput): boolean =>
  input.currentPlan !== null &&
  hasApprovedCurrentRevision(input.currentPlan) &&
  input.approvedPlanRevision !== null &&
  input.approvedPlanRevision.id === input.currentPlan.approved_revision_id &&
  input.approvedSpecRevision !== null &&
  input.approvedPlanRevision.based_on_spec_revision_id === input.approvedSpecRevision.id &&
  input.approvedPlanRevision.test_matrix.length > 0 &&
  hasText(input.approvedPlanRevision.rollback_notes);

const packageDependencyPackageId = (dependency: ExecutionPackageDependency): string =>
  dependency.package_id ?? (dependency as unknown as { execution_package_id?: string }).execution_package_id ?? '';

const packageHasIntegrationReadiness = (executionPackage: ExecutionPackage): boolean =>
  isRecord(executionPackage.integration_readiness) && Object.keys(executionPackage.integration_readiness).length > 0;

const packageIntegrationSurface = (executionPackage: ExecutionPackage): string =>
  isRecord(executionPackage.integration_readiness) && hasText(executionPackage.integration_readiness.surface)
    ? executionPackage.integration_readiness.surface.toLowerCase()
    : '';

const integrationReadinessBlockerCodes = (value: unknown): { state: 'blocked' | 'failed' | 'running' | 'passed'; codes: string[] } => {
  if (!isRecord(value)) {
    return { state: 'blocked', codes: ['missing_integration_readiness'] };
  }

  const hasDimension =
    ['contract', 'mock_fixture', 'environment', 'dependencies', 'cross_end_validation', 'blockers'].some((key) =>
      Object.hasOwn(value, key),
    );
  if (!hasDimension) {
    const surface = hasText(value.surface) ? value.surface.toLowerCase() : '';
    if (surface.includes('contract') || surface.includes('cross_end') || surface.includes('migration')) {
      return { state: 'blocked', codes: ['missing_contract_readiness'] };
    }
  }

  const normalized = normalizeIntegrationReadiness(value);
  return { state: normalized.state, codes: normalized.blockers };
};

const requiresIntegrationReadiness = (
  workItem: WorkItem,
  packages: readonly ExecutionPackage[],
  packageDependencies: readonly ExecutionPackageDependency[],
): boolean => {
  if (packages.length === 0) {
    return false;
  }
  if (workItem.risk.toLowerCase() === 'high' || packages.length > 1 || packageDependencies.length > 0) {
    return true;
  }
  if (packages.some(packageHasIntegrationReadiness)) {
    return true;
  }
  if (workItem.kind === 'tech_debt') {
    return packages.some((executionPackage) => {
      const surface = packageIntegrationSurface(executionPackage);
      return ['shared', 'contract', 'migration', 'dependency'].some((signal) => surface.includes(signal));
    });
  }
  return false;
};

const selectedRunChecks = (run: RunSession | undefined): Record<string, unknown>[] =>
  run?.check_results.map((check) => ({ ...check })) ?? [];

const selectedReviewMappings = (review: ReviewPacket | undefined): Record<string, unknown>[] =>
  review?.test_mapping?.map((mapping) => ({ ...mapping })) ?? [];

const releaseAcceptanceForGateEvidence = (
  releaseTestAcceptance: readonly ReleaseTestAcceptanceEvidenceLike[],
): Record<string, unknown>[] => releaseTestAcceptance.map((item) => ({ ...item }));

const requiredCheckResult = (
  run: RunSession,
  requiredCheck: ExecutionPackage['required_checks'][number],
): RunSession['check_results'][number] | undefined =>
  run.check_results.find((check) => check.check_id === requiredCheck.check_id);

const requiredCheckBlockers = (executionPackage: ExecutionPackage, run: RunSession | undefined): DeliveryBlocker[] => {
  if (run === undefined) {
    return [blocker('execution', 'missing_selected_run', 'Selected run evidence is missing.', 'execution-owner', objectRef('execution_package', executionPackage.id, `/packages/${executionPackage.id}`))];
  }

  const blockers: DeliveryBlocker[] = [];
  for (const requiredCheck of executionPackage.required_checks.filter((check) => check.blocks_review)) {
    const result = requiredCheckResult(run, requiredCheck);
    if (result === undefined) {
      blockers.push(
        blocker(
          'execution',
          'missing_required_check',
          `Required check ${requiredCheck.display_name} is missing from the selected run.`,
          'execution-owner',
          objectRef('run_session', run.id, `/runs/${run.id}`),
        ),
      );
      continue;
    }
    if (result.status !== 'succeeded') {
      blockers.push(
        blocker(
          'execution',
          'failed_required_check',
          `Required check ${requiredCheck.display_name} did not pass on the selected run.`,
          'execution-owner',
          objectRef('run_session', run.id, `/runs/${run.id}`),
        ),
      );
    }
  }
  return blockers;
};

const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
};

const scopeFingerprint = (
  release: Pick<Release, 'id'>,
  workItem: Pick<WorkItem, 'id'>,
  packages: readonly Pick<ExecutionPackage, 'id'>[],
): string =>
  `work-item-pre-release-scope:v1:sha256:${createHash('sha256')
    .update(
      stableJson({
        release_id: release.id,
        work_item_id: workItem.id,
        execution_package_ids: [...new Set(packages.map((item) => item.id))].sort(),
      }),
    )
    .digest('hex')}`;

const releaseTestAcceptanceWithScope = (
  releases: readonly Release[],
  workItem: WorkItem,
  packages: readonly ExecutionPackage[],
  evidence: readonly ReleaseTestAcceptanceEvidenceLike[],
): ReleaseTestAcceptanceEvidenceLike[] => {
  const releaseIds = new Set(releases.map((release) => release.id));
  const selectedRelease = releases[0];
  if (selectedRelease === undefined) {
    return [...evidence];
  }
  const fingerprint = scopeFingerprint(selectedRelease, workItem, packages);
  return evidence.map((item) =>
    item.scope_fingerprint === undefined && releaseIds.has(item.release_id) ? { ...item, scope_fingerprint: fingerprint } : item,
  );
};

const evaluateSpecStage = (input: WorkItemDeliveryReadinessInput): DeliveryStage => {
  if (input.currentSpec === null) {
    return stage({
      id: 'spec',
      state: 'missing',
      blockers: [blocker('spec', 'missing_spec', 'Work Item does not have a current Spec.')],
    });
  }

  const blockers: DeliveryBlocker[] = [];
  if (!hasApprovedCurrentRevision(input.currentSpec)) {
    blockers.push(blocker('spec', 'spec_not_current_approved_revision', 'Current Spec is not on its approved revision.', 'spec-approver', objectRef('spec', input.currentSpec.id, `/specs/${input.currentSpec.id}`)));
  }
  if (input.approvedSpecRevision === null || input.approvedSpecRevision.id !== input.currentSpec.approved_revision_id) {
    blockers.push(blocker('spec', 'missing_approved_spec_revision', 'Approved Spec revision record is missing or stale.', 'spec-approver', objectRef('spec', input.currentSpec.id, `/specs/${input.currentSpec.id}`)));
  } else {
    if (input.approvedSpecRevision.acceptance_criteria.length === 0) {
      blockers.push(blocker('spec', 'missing_acceptance_criteria', 'Approved Spec revision is missing acceptance criteria.', 'spec-approver', objectRef('spec_revision', input.approvedSpecRevision.id, `/specs/${input.currentSpec.id}`)));
    }
    if (!hasText(input.approvedSpecRevision.test_strategy_summary)) {
      blockers.push(blocker('spec', 'missing_test_strategy', 'Approved Spec revision is missing a test strategy summary.', 'spec-approver', objectRef('spec_revision', input.approvedSpecRevision.id, `/specs/${input.currentSpec.id}`)));
    }
  }

  return stage({
    id: 'spec',
    state: blockers.length === 0 ? 'passed' : 'blocked',
    object_refs: [objectRef('spec', input.currentSpec.id, `/specs/${input.currentSpec.id}`)],
    blockers,
  });
};

const evaluatePlanStage = (input: WorkItemDeliveryReadinessInput, specStage: DeliveryStage): DeliveryStage => {
  if (input.currentPlan === null) {
    return stage({
      id: 'plan',
      state: isStagePassing(specStage) ? 'missing' : 'blocked',
      blockers: [blocker('plan', 'missing_plan', 'Work Item does not have a current Plan.')],
    });
  }

  const blockers: DeliveryBlocker[] = [];
  if (!hasApprovedCurrentRevision(input.currentPlan)) {
    blockers.push(blocker('plan', 'plan_not_current_approved_revision', 'Current Plan is not on its approved revision.', 'spec-approver', objectRef('plan', input.currentPlan.id, `/plans/${input.currentPlan.id}`)));
  }
  if (input.approvedPlanRevision === null || input.approvedPlanRevision.id !== input.currentPlan.approved_revision_id) {
    blockers.push(blocker('plan', 'missing_approved_plan_revision', 'Approved Plan revision record is missing or stale.', 'spec-approver', objectRef('plan', input.currentPlan.id, `/plans/${input.currentPlan.id}`)));
  } else {
    if (input.approvedSpecRevision === null || input.approvedPlanRevision.based_on_spec_revision_id !== input.approvedSpecRevision.id) {
      blockers.push(blocker('plan', 'stale_plan_spec_revision', 'Approved Plan revision is not based on the approved Spec revision.', 'spec-approver', objectRef('plan_revision', input.approvedPlanRevision.id, `/plans/${input.currentPlan.id}`)));
    }
    if (input.approvedPlanRevision.test_matrix.length === 0) {
      blockers.push(blocker('plan', 'missing_test_matrix', 'Approved Plan revision is missing a test matrix.', 'spec-approver', objectRef('plan_revision', input.approvedPlanRevision.id, `/plans/${input.currentPlan.id}`)));
    }
    if (!hasText(input.approvedPlanRevision.rollback_notes)) {
      blockers.push(blocker('plan', 'missing_rollback_notes', 'Approved Plan revision is missing rollback notes.', 'spec-approver', objectRef('plan_revision', input.approvedPlanRevision.id, `/plans/${input.currentPlan.id}`)));
    }
  }

  return stage({
    id: 'plan',
    state: blockers.length === 0 && isStagePassing(specStage) ? 'passed' : 'blocked',
    object_refs: [objectRef('plan', input.currentPlan.id, `/plans/${input.currentPlan.id}`)],
    blockers,
  });
};

const currentPackagesFor = (input: WorkItemDeliveryReadinessInput): ExecutionPackage[] => {
  if (!specIsStrictlyReady(input) || !planIsStrictlyReady(input)) {
    return [];
  }
  return currentApprovedPlanPackages(input.packages, {
    workItemId: input.workItem.id,
    approvedSpecRevisionId: input.approvedSpecRevision!.id,
    approvedPlanRevisionId: input.approvedPlanRevision!.id,
  });
};

const buildQualityBlockers = (
  input: WorkItemDeliveryReadinessInput,
  currentPackages: readonly ExecutionPackage[],
  selectedRuns: ReadonlyMap<string, RunSession | undefined>,
  selectedReviews: ReadonlyMap<string, ReviewPacket | undefined>,
  priorStages: readonly DeliveryStage[],
): DeliveryBlocker[] => {
  const blockers: DeliveryBlocker[] = [];
  for (const prior of priorStages.filter((item) => ['spec', 'plan', 'packages', 'execution', 'review', 'integration_readiness'].includes(item.id))) {
    if (!isStagePassing(prior)) {
      blockers.push(...prior.blockers);
    }
  }

  for (const executionPackage of currentPackages) {
    const run = selectedRuns.get(executionPackage.id);
    blockers.push(...requiredCheckBlockers(executionPackage, run));

    if (run !== undefined) {
      const artifactPresence = deriveRequiredArtifactPresence(executionPackage, run, {
        reviewPackets: input.reviewPackets,
      });
      for (const artifactKind of artifactPresence.missing_artifact_kinds) {
        blockers.push(
          blocker(
            'quality_gate',
            'missing_required_artifact',
            `Selected run is missing required ${artifactKind} evidence.`,
            'qa-test-owner',
            objectRef('run_session', run.id, `/runs/${run.id}`),
          ),
        );
      }
    }

    for (const requiredGate of executionPackage.required_test_gates ?? []) {
      const result = normalizeRequiredTestGate(requiredGate as Record<string, unknown>, {
        runChecks: selectedRunChecks(run),
        reviewTestMappings: selectedReviewMappings(selectedReviews.get(executionPackage.id)),
        releaseTestAcceptance: releaseAcceptanceForGateEvidence(input.releaseTestAcceptance),
      });
      if (result.state === 'blocked') {
        blockers.push(
          blocker(
            'quality_gate',
            result.blocker ?? 'missing_required_test_gate_evidence',
            result.gate_id === undefined
              ? 'Required test gate cannot be evaluated because its id is missing.'
              : `Required test gate ${result.gate_id} is missing selected-run evidence.`,
            'qa-test-owner',
            objectRef('execution_package', executionPackage.id, `/packages/${executionPackage.id}`),
          ),
        );
      }
    }
  }
  return dedupeBlockers(blockers);
};

const packageReadinessBlockers = (currentPackages: readonly ExecutionPackage[]): DeliveryBlocker[] =>
  currentPackages.flatMap((executionPackage) => {
    if (hasText(executionPackage.blocked_reason) || executionPackage.gate_state === 'changes_requested') {
      return [
        blocker(
          'packages',
          'package_blocked',
          executionPackage.blocked_reason ?? 'Execution package is blocked or has requested changes.',
          'execution-owner',
          objectRef('execution_package', executionPackage.id, `/packages/${executionPackage.id}`),
        ),
      ];
    }
    return [];
  });

const dedupeBlockers = (items: readonly DeliveryBlocker[]): DeliveryBlocker[] => {
  const seen = new Set<string>();
  const result: DeliveryBlocker[] = [];
  for (const item of items) {
    const key = `${item.stage_id ?? ''}:${item.code ?? item.id}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(item);
  }
  return result;
};

const applyDegradedSources = (stages: readonly DeliveryStage[], degradedSources: readonly DegradedSourceKey[]): DeliveryStage[] => {
  const degraded = new Set(degradedSources);
  return stages.map((item) => {
    const matching = [...degraded].filter((source) => degradedStageMap[source].includes(item.id));
    if (matching.length === 0) {
      return item;
    }
    const degradedBlockers = matching.map((source) =>
      blocker(item.id, `degraded_${source}`, `Readiness source ${source} is degraded; this stage cannot be trusted.`),
    );
    return {
      ...item,
      state: 'blocked',
      blockers: [...item.blockers, ...degradedBlockers],
    };
  });
};

const selectedLinkedRelease = (
  releases: readonly Release[],
  workItem: WorkItem,
  packages: readonly ExecutionPackage[],
): Release | undefined => {
  const packageIds = new Set(packages.map((item) => item.id));
  if (workItem.current_release_id !== undefined) {
    const linked = releases.find((release) => release.id === workItem.current_release_id);
    if (linked !== undefined) {
      return linked;
    }
  }
  for (const executionPackage of packages) {
    if (executionPackage.current_release_id === undefined) {
      continue;
    }
    const linked = releases.find((release) => release.id === executionPackage.current_release_id);
    if (linked !== undefined) {
      return linked;
    }
  }
  return releases.find(
    (release) =>
      release.work_item_ids.includes(workItem.id) ||
      release.execution_package_ids.some((executionPackageId) => packageIds.has(executionPackageId)),
  );
};

const evaluateStages = (input: WorkItemDeliveryReadinessInput): StageEvaluation => {
  const specStage = evaluateSpecStage(input);
  const planStage = evaluatePlanStage(input, specStage);
  const currentPackages = currentPackagesFor(input);
  const initiativeAggregation = deriveInitiativeAggregationState({
    kind: input.workItem.kind,
    currentPackages,
  });

  const packageBlockers = packageReadinessBlockers(currentPackages);
  const hasDraftPackage = currentPackages.some((executionPackage) => executionPackage.phase === 'draft');
  const packageStage =
    input.degradedSources?.includes('execution_packages') === true
      ? stage({ id: 'packages', state: 'blocked', blockers: [blocker('packages', 'degraded_execution_packages', 'Execution package reads are degraded.')] })
      : input.workItem.kind === 'initiative' && currentPackages.length === 0
        ? stage({
            id: 'packages',
            state: 'not_applicable',
            blockers: [],
            evidence_refs:
              initiativeAggregation.mode === 'unavailable'
                ? [objectRef('work_item', input.workItem.id, `/work-items/${input.workItem.id}`, initiativeAggregation.label)]
                : [],
          })
        : currentPackages.length === 0
          ? stage({ id: 'packages', state: 'missing', blockers: [blocker('packages', 'missing_execution_package', 'No current approved-plan package exists for this Work Item.')] })
          : stage({
              id: 'packages',
              state: !isStagePassing(planStage) || packageBlockers.length > 0 ? 'blocked' : hasDraftPackage ? 'ready' : 'passed',
              object_refs: currentPackages.map((item) => objectRef('execution_package', item.id, `/packages/${item.id}`)),
              blockers: isStagePassing(planStage) ? packageBlockers : [...specStage.blockers, ...planStage.blockers],
            });

  const selectedRuns = new Map<string, RunSession | undefined>();
  const selectedReviews = new Map<string, ReviewPacket | undefined>();
  for (const executionPackage of currentPackages) {
    const run = selectWorkItemRunSession(executionPackage, input.runSessions);
    selectedRuns.set(executionPackage.id, run);
    selectedReviews.set(executionPackage.id, selectWorkItemReviewPacket(executionPackage, run, input.reviewPackets));
  }

  let executionState: DeliveryStageState = 'passed';
  const executionBlockers: DeliveryBlocker[] = [];
  if (packageStage.state === 'not_applicable') {
    executionState = 'not_applicable';
  } else if (!isStagePassing(packageStage)) {
    executionState = 'blocked';
    executionBlockers.push(...packageStage.blockers);
  } else {
    for (const executionPackage of currentPackages) {
      const run = selectedRuns.get(executionPackage.id);
      if (run === undefined) {
        executionState = 'missing';
        executionBlockers.push(...requiredCheckBlockers(executionPackage, run));
        continue;
      }
      if (['queued', 'running', 'waiting_for_input', 'stalled', 'resuming', 'cancel_requested'].includes(run.status)) {
        executionState = executionState === 'blocked' ? executionState : 'running';
      } else if (run.status !== 'succeeded') {
        executionState = 'blocked';
        executionBlockers.push(blocker('execution', 'selected_run_failed', 'Selected run did not succeed.', 'execution-owner', objectRef('run_session', run.id, `/runs/${run.id}`)));
      }
      const checkBlockers = requiredCheckBlockers(executionPackage, run);
      if (checkBlockers.length > 0) {
        executionState = 'blocked';
        executionBlockers.push(...checkBlockers);
      }
    }
  }
  const executionStage = stage({
    id: 'execution',
    state: executionState,
    object_refs: [...selectedRuns.values()].flatMap((run) => (run === undefined ? [] : [objectRef('run_session', run.id, `/runs/${run.id}`)])),
    blockers: executionBlockers,
  });

  let reviewState: DeliveryStageState = 'passed';
  const reviewBlockers: DeliveryBlocker[] = [];
  if (packageStage.state === 'not_applicable') {
    reviewState = 'not_applicable';
  } else if (!isStagePassing(executionStage)) {
    reviewState = 'blocked';
    reviewBlockers.push(...executionStage.blockers);
  } else {
    for (const executionPackage of currentPackages) {
      const run = selectedRuns.get(executionPackage.id);
      const review = selectedReviews.get(executionPackage.id);
      if (run === undefined) {
        reviewState = 'blocked';
        reviewBlockers.push(blocker('review', 'missing_selected_run', 'Review cannot be evaluated without a selected run.', 'reviewer', objectRef('execution_package', executionPackage.id, `/packages/${executionPackage.id}`)));
        continue;
      }
      if (review === undefined) {
        reviewState = 'missing';
        reviewBlockers.push(blocker('review', 'missing_review_packet', 'Selected package is missing a Review Packet.', 'reviewer', objectRef('execution_package', executionPackage.id, `/packages/${executionPackage.id}`)));
        continue;
      }
      const complete = hasCompleteReviewEvidence(review, {
        selectedRunId: run.id,
        packageId: executionPackage.id,
        approvedSpecRevisionId: input.approvedSpecRevision?.id ?? '',
        approvedPlanRevisionId: input.approvedPlanRevision?.id ?? '',
      });
      if (!complete.complete) {
        reviewState = 'blocked';
        reviewBlockers.push(
          ...complete.blockers.map((code) =>
            blocker('review', code, `Review evidence is incomplete: ${code}.`, 'reviewer', objectRef('review_packet', review.id, `/reviews/${review.id}`)),
          ),
        );
      }
    }
  }
  const reviewStage = stage({
    id: 'review',
    state: reviewState,
    object_refs: [...selectedReviews.values()].flatMap((review) => (review === undefined ? [] : [objectRef('review_packet', review.id, `/reviews/${review.id}`)])),
    blockers: reviewBlockers,
  });

  const currentPackageIds = new Set(currentPackages.map((item) => item.id));
  const currentPackageDependencies = input.packageDependencies.filter((dependency) =>
    currentPackageIds.has(packageDependencyPackageId(dependency)),
  );
  const integrationRequired = requiresIntegrationReadiness(input.workItem, currentPackages, currentPackageDependencies);
  let integrationStage: DeliveryStage;
  if (packageStage.state === 'not_applicable' || !integrationRequired) {
    integrationStage = stage({ id: 'integration_readiness', state: 'not_applicable' });
  } else {
    const integrationBlockers: DeliveryBlocker[] = [];
    let hasRunning = false;
    let hasMissingReadiness = false;
    for (const executionPackage of currentPackages) {
      if (!packageHasIntegrationReadiness(executionPackage)) {
        hasMissingReadiness = true;
        integrationBlockers.push(blocker('integration_readiness', 'missing_integration_readiness', 'Required Integration Readiness evidence is missing.', 'execution-owner', objectRef('execution_package', executionPackage.id, `/packages/${executionPackage.id}`)));
        continue;
      }
      const normalized = integrationReadinessBlockerCodes(executionPackage.integration_readiness);
      if (normalized.state === 'running') {
        hasRunning = true;
      }
      if (normalized.state === 'blocked' || normalized.state === 'failed') {
        integrationBlockers.push(
          ...normalized.codes.map((code) =>
            blocker('integration_readiness', code, `Integration Readiness is incomplete: ${code}.`, 'execution-owner', objectRef('execution_package', executionPackage.id, `/packages/${executionPackage.id}`)),
          ),
        );
      }
    }
    integrationStage = stage({
      id: 'integration_readiness',
      state: hasMissingReadiness ? 'missing' : integrationBlockers.length > 0 ? 'blocked' : hasRunning ? 'running' : 'passed',
      object_refs: currentPackages.map((item) => objectRef('execution_package', item.id, `/packages/${item.id}`)),
      blockers: dedupeBlockers(integrationBlockers),
    });
  }

  const preQualityStages = [specStage, planStage, packageStage, executionStage, reviewStage, integrationStage];
  const qualityBlockers = buildQualityBlockers(input, currentPackages, selectedRuns, selectedReviews, preQualityStages);
  const qualityStage =
    packageStage.state === 'not_applicable'
      ? stage({ id: 'quality_gate', state: 'not_applicable' })
      : stage({
          id: 'quality_gate',
          state: qualityBlockers.length === 0 ? 'passed' : 'blocked',
          object_refs: [objectRef('work_item', input.workItem.id, `/work-items/${input.workItem.id}`)],
          blockers: qualityBlockers,
        });

  const releaseLinked = selectedLinkedRelease(input.releases, input.workItem, currentPackages);
  const orderedReleases =
    releaseLinked === undefined
      ? input.releases
      : [releaseLinked, ...input.releases.filter((release) => release.id !== releaseLinked.id)];
  const releaseReadiness = deriveWorkItemPreReleaseReadiness({
    workItem: input.workItem,
    packages: currentPackages,
    releases: orderedReleases,
    releaseBlockers: input.releaseBlockers,
    releaseTestAcceptance: releaseTestAcceptanceWithScope(orderedReleases, input.workItem, currentPackages, input.releaseTestAcceptance),
    releaseEvidence: input.releaseEvidence,
    decisions: input.decisions,
    qualityGatePassed: qualityStage.state === 'passed' || qualityStage.state === 'ready',
    handoffExpected: qualityStage.state === 'passed' || qualityStage.state === 'ready' || releaseLinked !== undefined,
  });
  const releaseStageState =
    qualityStage.state === 'blocked'
      ? 'blocked'
      : releaseReadiness.state === 'ready'
        ? 'ready'
        : releaseReadiness.state === 'not_applicable'
          ? 'not_applicable'
          : releaseReadiness.state;
  const releaseStage =
    packageStage.state === 'not_applicable'
      ? stage({ id: 'release_readiness', state: 'not_applicable' })
      : stage({
          id: 'release_readiness',
          state: releaseStageState,
          object_refs:
            releaseReadiness.release_id === undefined
              ? []
              : [objectRef('release', releaseReadiness.release_id, `/releases/${releaseReadiness.release_id}`)],
          blockers: releaseReadiness.blockers.map((item) =>
            blocker(
              'release_readiness',
              item.code,
              item.message,
              'release-owner',
              item.object_type !== undefined && item.object_id !== undefined
                ? objectRef(item.object_type as ProductObjectType, item.object_id, `/${item.object_type === 'execution_package' ? 'packages' : `${item.object_type}s`}/${item.object_id}`)
                : undefined,
            ),
          ).concat(
            qualityStage.state === 'blocked'
              ? qualityStage.blockers.map((item) => ({
                  ...item,
                  id: `release_readiness-inherited-${item.id}`,
                  stage_id: 'release_readiness' as const,
                  owner_lane: 'release-owner' as const,
                }))
              : [],
          ),
        });

  const stages = applyDegradedSources(
    [specStage, planStage, packageStage, executionStage, reviewStage, integrationStage, qualityStage, releaseStage],
    input.degradedSources ?? [],
  );

  return {
    stages,
    currentPackages,
    selectedRuns,
    selectedReviews,
    qualityPassed: isStagePassing(stageById(stages, 'quality_gate')),
    releaseLinked,
  };
};

const overallState = (stages: readonly DeliveryStage[]): DeliveryOverallState => {
  const requiredStages = stages.filter((item) => item.state !== 'not_applicable');
  if (stageById(stages, 'release_readiness').state === 'ready' && requiredStages.every(isStagePassing)) {
    return 'ready_for_release';
  }
  if (requiredStages.some((item) => item.state === 'blocked' || item.state === 'failed')) {
    return 'blocked';
  }
  if (requiredStages.every((item) => item.state === 'missing')) {
    return 'not_started';
  }
  return 'in_progress';
};

const openWorkItemAction = (laneId: ProductLaneId, workItem: WorkItem): ProductAction =>
  navigateAction({
    id: `open-work-item-${workItem.id}`,
    laneId,
    priority: 'secondary',
    label: 'Open Work Item',
    target: objectTarget('work_item', workItem.id, `/work-items/${workItem.id}`),
  });

const actionForLane = (
  input: WorkItemDeliveryReadinessInput,
  evaluation: StageEvaluation,
  laneId: ProductLaneId,
): ProductAction[] => {
  const firstPackage = evaluation.currentPackages[0];
  const firstRun = firstPackage === undefined ? undefined : evaluation.selectedRuns.get(firstPackage.id);
  const firstReview = firstPackage === undefined ? undefined : evaluation.selectedReviews.get(firstPackage.id);
  const linkedRelease = evaluation.releaseLinked;

  if (laneId === 'manager') {
    return [
      openWorkItemAction(laneId, input.workItem),
      ...(linkedRelease === undefined
        ? []
        : [
            navigateAction({
              id: `open-release-${linkedRelease.id}`,
              laneId,
              priority: 'secondary',
              label: 'Open Release',
              target: objectTarget('release', linkedRelease.id, `/releases/${linkedRelease.id}`),
            }),
          ]),
    ];
  }

  if (laneId === 'spec-approver') {
    const target = input.currentSpec === null
      ? objectTarget('work_item', input.workItem.id, `/work-items/${input.workItem.id}`)
      : objectTarget('spec', input.currentSpec.id, `/specs/${input.currentSpec.id}`);
    return [
      navigateAction({
        id: `open-spec-plan-readiness-${input.workItem.id}`,
        laneId,
        priority: 'primary',
        label: 'Review Spec, Plan, and test strategy',
        target,
      }),
    ];
  }

  if (laneId === 'execution-owner') {
    if (firstPackage !== undefined && firstRun === undefined && firstPackage.phase === 'ready') {
      return [
        runPackageAction({
          id: `run-package-${firstPackage.id}`,
          laneId,
          priority: 'primary',
          label: 'Run package',
          workItemId: input.workItem.id,
          packageId: firstPackage.id,
          target: objectTarget('execution_package', firstPackage.id, `/packages/${firstPackage.id}`),
        }),
      ];
    }
    return [
      navigateAction({
        id: `open-package-readiness-${firstPackage?.id ?? input.workItem.id}`,
        laneId,
        priority: 'primary',
        label: firstRun === undefined ? 'Open Package' : 'Open package run console',
        target:
          firstPackage === undefined
            ? objectTarget('work_item', input.workItem.id, `/work-items/${input.workItem.id}`)
            : objectTarget('execution_package', firstPackage.id, `/packages/${firstPackage.id}`),
      }),
    ];
  }

  if (laneId === 'reviewer') {
    return [
      navigateAction({
        id: `open-review-readiness-${firstReview?.id ?? input.workItem.id}`,
        laneId,
        priority: 'primary',
        label: 'Open Review evidence',
        target:
          firstReview === undefined
            ? objectTarget('work_item', input.workItem.id, `/work-items/${input.workItem.id}`)
            : objectTarget('review_packet', firstReview.id, `/reviews/${firstReview.id}`),
      }),
    ];
  }

  if (laneId === 'qa-test-owner') {
    return [
      navigateAction({
        id: `open-quality-gate-${input.workItem.id}`,
        laneId,
        priority: 'primary',
        label: 'Open Quality Gate and acceptance context',
        target: objectTarget('work_item', input.workItem.id, `/work-items/${input.workItem.id}`),
      }),
    ];
  }

  if (laneId === 'release-owner') {
    return [
      navigateAction({
        id: `open-release-readiness-${linkedRelease?.id ?? input.workItem.id}`,
        laneId,
        priority: 'primary',
        label: linkedRelease === undefined ? 'Open Release inventory' : 'Open Release readiness',
        target:
          linkedRelease === undefined
            ? { kind: 'object', object_type: 'release', object_id: input.workItem.project_id, href: '/releases' }
            : objectTarget('release', linkedRelease.id, `/releases/${linkedRelease.id}`),
      }),
    ];
  }

  const actions: ProductAction[] = [];
  if (input.currentSpec === null) {
    actions.push(openWorkItemAction(laneId, input.workItem));
  } else if (input.currentSpec.current_revision_id === undefined) {
    actions.push(
      generateSpecDraftAction({
        id: `generate-spec-draft-${input.currentSpec.id}`,
        laneId,
        priority: 'primary',
        label: 'Generate Spec draft',
        workItemId: input.workItem.id,
        specId: input.currentSpec.id,
        target: objectTarget('spec', input.currentSpec.id, `/specs/${input.currentSpec.id}`),
      }),
    );
  }

  if (specIsStrictlyReady(input) && input.currentPlan !== null && input.currentPlan.current_revision_id === undefined) {
    actions.push(
      generatePlanDraftAction({
        id: `generate-plan-draft-${input.currentPlan.id}`,
        laneId,
        priority: actions.length === 0 ? 'primary' : 'secondary',
        label: 'Generate Plan draft',
        workItemId: input.workItem.id,
        planId: input.currentPlan.id,
        target: objectTarget('plan', input.currentPlan.id, `/plans/${input.currentPlan.id}`),
      }),
    );
  }

  if (
    input.currentPlan !== null &&
    input.currentPlan.approved_revision_id !== undefined &&
    input.currentPlan.current_revision_id === input.currentPlan.approved_revision_id &&
    input.approvedPlanRevision?.id === input.currentPlan.approved_revision_id &&
    evaluation.currentPackages.length === 0
  ) {
    actions.push(
      generatePackagesAction({
        id: `generate-packages-${input.approvedPlanRevision.id}`,
        laneId,
        priority: actions.length === 0 ? 'primary' : 'secondary',
        label: 'Generate packages',
        workItemId: input.workItem.id,
        planRevisionId: input.approvedPlanRevision.id,
        target: objectTarget('plan_revision', input.approvedPlanRevision.id, `/plans/${input.currentPlan.id}`),
      }),
    );
  }

  if (firstPackage !== undefined) {
    actions.push(
      navigateAction({
        id: `open-package-${firstPackage.id}`,
        laneId,
        priority: actions.length === 0 ? 'primary' : 'secondary',
        label: 'Open Package',
        target: objectTarget('execution_package', firstPackage.id, `/packages/${firstPackage.id}`),
      }),
    );
  }

  if (actions.length === 0) {
    actions.push(openWorkItemAction(laneId, input.workItem));
  }
  return actions;
};

export const deriveWorkItemDeliveryReadiness = (
  input: WorkItemDeliveryReadinessInput,
) => {
  const activeLane = input.activeLane ?? laneForWorkItemKind(input.workItem.kind);
  const evaluation = evaluateStages(input);
  const orderedStages = stageOrder.map((id) => stageById(evaluation.stages, id));
  const blockers = orderedStages.flatMap((item) => item.blockers);

  return workItemDeliveryReadinessSchema.parse({
    work_item_id: input.workItem.id,
    work_item_kind: input.workItem.kind,
    active_lane: activeLane,
    overall_state: overallState(orderedStages),
    stages: orderedStages,
    blockers,
    evidence: [],
    next_actions: actionForLane(input, evaluation, activeLane),
    degraded_sources: [...new Set(input.degradedSources ?? [])],
  });
};
