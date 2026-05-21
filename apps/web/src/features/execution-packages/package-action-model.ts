import type { DeliveryRunReadiness, ExecutionPackage, ReviewPacket } from '../../shared/api/types';

export interface PackageActionState {
  enabled: boolean;
  reason?: string;
}

export interface PackageActions {
  markReady: PackageActionState;
  run: PackageActionState;
  rerun: PackageActionState;
  forceRerun: PackageActionState;
  edit: PackageActionState;
}

export interface BuildPackageActionsInput {
  executionPackage: ExecutionPackage;
  actorId: string;
  readiness?: DeliveryRunReadiness;
  currentReview?: ReviewPacket;
  hasOpenReview: boolean;
  actionPending: boolean;
  forceReason: string;
}

const forceRerunReviewStatuses = new Set<ReviewPacket['status']>(['ready', 'in_review']);
const openReviewStatuses = new Set<ReviewPacket['status']>(['draft', 'ready', 'in_review', 'escalated']);

export function buildPackageActions(input: BuildPackageActionsInput): PackageActions {
  const executionPackage = input.executionPackage;
  const activeRunReason = input.executionPackage.current_run_session_id === undefined
    ? undefined
    : 'A run is already in progress for this package.';
  const loadedOpenReview = input.currentReview !== undefined && isOpenReview(input.currentReview);
  const openReviewReason = input.hasOpenReview || loadedOpenReview
    ? 'The open review must be resolved before rerun.'
    : undefined;
  const runtimeReason = runtimeReadinessReason(input.readiness);
  const markReadyAllowed = executionPackage.phase === 'draft' || executionPackage.gate_state === 'changes_requested';
  const runStateAllowed = executionPackage.phase === 'ready' && executionPackage.gate_state === 'not_submitted';
  const editAllowed =
    executionPackage.current_run_session_id === undefined &&
    (executionPackage.last_run_session_id === undefined || executionPackage.gate_state === 'changes_requested');

  return {
    markReady: firstBlockedState([
      input.actionPending ? 'Package action is already in progress.' : undefined,
      activeRunReason,
      markReadyAllowed ? undefined : 'Mark ready is available only for draft packages or packages with requested changes.',
    ]),
    run: firstBlockedState([
      input.actionPending ? 'Package action is already in progress.' : undefined,
      runtimeReason,
      activeRunReason,
      openReviewReason,
      runStateAllowed ? undefined : 'Run is available only for ready packages that have not been submitted.',
    ]),
    rerun: firstBlockedState([
      input.actionPending ? 'Package action is already in progress.' : undefined,
      runtimeReason,
      activeRunReason,
      openReviewReason,
      runStateAllowed ? undefined : 'Rerun is available only for ready packages that have not been submitted.',
      input.executionPackage.last_run_session_id === undefined
        ? 'Rerun is available after this package has a previous run.'
        : undefined,
    ]),
    forceRerun: forceRerunState(input, runtimeReason, activeRunReason),
    edit: firstBlockedState([
      input.actionPending ? 'Package action is already in progress.' : undefined,
      activeRunReason,
      editAllowed ? undefined : 'Package details can be edited only before execution starts or after changes are requested.',
    ]),
  };
}

function forceRerunState(
  input: BuildPackageActionsInput,
  runtimeReason: string | undefined,
  activeRunReason: string | undefined,
): PackageActionState {
  const executionPackage = input.executionPackage;
  const currentReview = input.currentReview;
  const reason = firstReason([
    input.actionPending ? 'Package action is already in progress.' : undefined,
    runtimeReason,
    activeRunReason,
    executionPackage.last_run_session_id === undefined
      ? 'Force rerun is available after this package has a previous run.'
      : undefined,
    executionPackage.phase === 'review' ? undefined : 'Force rerun is available while the package is in review.',
    executionPackage.resolution === 'none' ? undefined : 'Force rerun requires an unresolved review decision.',
    input.actorId === executionPackage.owner_actor_id ? undefined : 'Only the package owner can force rerun.',
    currentReview === undefined ? 'Force rerun requires a current open ready or in-review Review Packet.' : undefined,
    currentReview === undefined || currentReview.execution_package_id === executionPackage.id
      ? undefined
      : 'The review must belong to this package.',
    currentReview === undefined || currentReview.run_session_id === executionPackage.last_run_session_id
      ? undefined
      : 'The review must match the latest run.',
    currentReview === undefined || forceRerunReviewStatuses.has(currentReview.status)
      ? undefined
      : 'The review must be ready or in review before force rerun.',
    currentReview === undefined || currentReview.decision === 'none'
      ? undefined
      : 'Force rerun requires a review with no recorded decision.',
    input.forceReason.trim().length > 0 ? undefined : 'A governance rationale is required for force rerun.',
  ]);

  return reason === undefined ? { enabled: true } : { enabled: false, reason };
}

function runtimeReadinessReason(readiness: DeliveryRunReadiness | undefined): string | undefined {
  if (readiness === undefined) {
    return 'Checking execution readiness before starting a run.';
  }

  if (readiness.state === 'ready') {
    return undefined;
  }

  return readiness.blockers[0]?.message ?? 'Execution readiness is not available yet.';
}

function isOpenReview(reviewPacket: ReviewPacket): boolean {
  return reviewPacket.decision === 'none' && openReviewStatuses.has(reviewPacket.status);
}

function firstBlockedState(reasons: Array<string | undefined>): PackageActionState {
  const reason = firstReason(reasons);
  return reason === undefined ? { enabled: true } : { enabled: false, reason };
}

function firstReason(reasons: Array<string | undefined>): string | undefined {
  return reasons.find((reason): reason is string => reason !== undefined);
}
