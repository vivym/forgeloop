import { proxyActivities } from '@temporalio/workflow';

import type { ExecutePackageRunActivityInput, ExecutePackageRunResult, PackageExecutionActivities } from './activities';

const activities = proxyActivities<PackageExecutionActivities>({
  startToCloseTimeout: '1 hour',
});

export const packageExecutionWorkflow = async (
  input: ExecutePackageRunActivityInput,
): Promise<ExecutePackageRunResult> => activities.executePackageRunActivity(input);
