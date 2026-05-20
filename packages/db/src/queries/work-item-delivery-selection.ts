import type { ExecutionPackage, ReviewPacket, RunSession } from '@forgeloop/domain';

type SelectableExecutionPackage = Pick<
  ExecutionPackage,
  'id' | 'work_item_id' | 'spec_revision_id' | 'plan_revision_id'
> &
  Partial<
    Pick<
      ExecutionPackage,
      | 'archived_at'
      | 'deleted_at'
      | 'current_run_session_id'
      | 'last_run_session_id'
      | 'current_review_packet_id'
    >
  >;

type SelectableRunSession = Pick<RunSession, 'id' | 'created_at' | 'execution_package_id'>;

type SelectableReviewPacket = Pick<ReviewPacket, 'id' | 'run_session_id' | 'updated_at' | 'execution_package_id'>;

export interface CurrentApprovedPlanPackagesInput {
  workItemId: string;
  approvedSpecRevisionId: string;
  approvedPlanRevisionId: string;
}

const belongsToPackage = (
  object: { execution_package_id: string },
  executionPackage: Pick<ExecutionPackage, 'id'>,
): boolean => object.execution_package_id === executionPackage.id;

const compareLatestTimestampThenId = <Item extends { id: string }>(
  left: Item,
  right: Item,
  timestamp: (item: Item) => string,
): number => {
  const timestampComparison = timestamp(right).localeCompare(timestamp(left));

  return timestampComparison === 0 ? left.id.localeCompare(right.id) : timestampComparison;
};

export const currentApprovedPlanPackages = <Package extends SelectableExecutionPackage>(
  packages: readonly Package[],
  input: CurrentApprovedPlanPackagesInput,
): Package[] =>
  packages.filter(
    (item) =>
      item.work_item_id === input.workItemId &&
      item.archived_at === undefined &&
      item.deleted_at === undefined &&
      item.spec_revision_id === input.approvedSpecRevisionId &&
      item.plan_revision_id === input.approvedPlanRevisionId,
  );

export const selectWorkItemRunSession = <Run extends SelectableRunSession>(
  executionPackage: Pick<ExecutionPackage, 'id' | 'current_run_session_id' | 'last_run_session_id'>,
  runs: readonly Run[],
): Run | undefined => {
  const packageRuns = runs.filter((run) => belongsToPackage(run, executionPackage));

  if (executionPackage.current_run_session_id !== undefined) {
    const currentRun = packageRuns.find((run) => run.id === executionPackage.current_run_session_id);
    if (currentRun !== undefined) {
      return currentRun;
    }
  }

  if (executionPackage.last_run_session_id !== undefined) {
    const lastRun = packageRuns.find((run) => run.id === executionPackage.last_run_session_id);
    if (lastRun !== undefined) {
      return lastRun;
    }
  }

  return [...packageRuns].sort((left, right) => compareLatestTimestampThenId(left, right, (run) => run.created_at))[0];
};

export const selectWorkItemReviewPacket = <Review extends SelectableReviewPacket>(
  executionPackage: Pick<ExecutionPackage, 'id' | 'current_review_packet_id'>,
  selectedRun: Pick<RunSession, 'id'> | undefined,
  reviews: readonly Review[],
): Review | undefined => {
  const packageReviews = reviews.filter((review) => belongsToPackage(review, executionPackage));

  if (executionPackage.current_review_packet_id !== undefined) {
    const currentReview = packageReviews.find((review) => review.id === executionPackage.current_review_packet_id);
    if (currentReview !== undefined) {
      return currentReview;
    }
  }

  if (selectedRun !== undefined) {
    const selectedRunReview = [...packageReviews]
      .filter((review) => review.run_session_id === selectedRun.id)
      .sort((left, right) => compareLatestTimestampThenId(left, right, (review) => review.updated_at))[0];

    if (selectedRunReview !== undefined) {
      return selectedRunReview;
    }
  }

  return [...packageReviews].sort((left, right) =>
    compareLatestTimestampThenId(left, right, (review) => review.updated_at),
  )[0];
};
