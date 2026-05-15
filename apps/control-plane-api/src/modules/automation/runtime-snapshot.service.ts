import { Inject, Injectable } from '@nestjs/common';
import type { AutomationActionRun } from '@forgeloop/domain';
import type { P0Repository } from '@forgeloop/db';

import { P0_REPOSITORY } from '../core/control-plane-tokens';
import type { AutomationRuntimeSnapshotDto } from './automation.dto';
import { toPolicyProjectionDto, toRuntimeSnapshotDto } from './automation.dto';

const normalizeIsoDateTime = (value: string): string => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid ISO timestamp: ${value}`);
  }
  return parsed.toISOString();
};

const currentIsoTime = (): string => {
  const testNow = process.env.NODE_ENV === 'test' ? process.env.FORGELOOP_AUTOMATION_TEST_NOW?.trim() : undefined;
  return testNow === undefined || testNow.length === 0 ? new Date().toISOString() : normalizeIsoDateTime(testNow);
};

const actionObservedAt = (actionRun: AutomationActionRun): string | undefined => actionRun.finished_at ?? actionRun.updated_at;

const policyInput = (
  actionRun: AutomationActionRun,
): { repoId: string; status: string; policyDigest?: string } | undefined => {
  const input = actionRun.action_input_json;
  const repoId = input.repo_id;
  const status = input.policy_status;
  const policyDigest = input.policy_digest;
  if (typeof repoId !== 'string' || typeof status !== 'string') {
    return undefined;
  }
  return {
    repoId,
    status,
    ...(typeof policyDigest === 'string' ? { policyDigest } : {}),
  };
};

const isPriorTo = (candidate: AutomationActionRun, current: AutomationActionRun): boolean => {
  const candidateObservedAt = actionObservedAt(candidate);
  const currentObservedAt = actionObservedAt(current);
  if (candidateObservedAt === undefined || currentObservedAt === undefined) {
    return candidate.id < current.id;
  }
  return Date.parse(candidateObservedAt) < Date.parse(currentObservedAt);
};

@Injectable()
export class RuntimeSnapshotService {
  constructor(@Inject(P0_REPOSITORY) private readonly repository: P0Repository) {}

  async getRuntimeSnapshot(): Promise<AutomationRuntimeSnapshotDto> {
    const data = await this.repository.getRuntimeSnapshotData();
    const policyProjectionsByRepoId = new Map<string, NonNullable<AutomationRuntimeSnapshotDto['repos'][number]['policy_projection']>>();

    for (const actionRun of data.policy_projection_action_runs) {
      const input = policyInput(actionRun);
      if (input === undefined || policyProjectionsByRepoId.has(input.repoId)) {
        continue;
      }
      const lastKnownGood =
        input.status === 'parse_failed' || input.status === 'unsafe_path'
          ? data.policy_projection_action_runs.find((candidate) => {
              const candidateInput = policyInput(candidate);
              return (
                candidateInput?.repoId === input.repoId &&
                candidateInput.status === 'loaded' &&
                candidateInput.policyDigest !== undefined &&
                isPriorTo(candidate, actionRun)
              );
            })
          : undefined;
      const projection = toPolicyProjectionDto(actionRun, lastKnownGood);
      if (projection !== undefined) {
        policyProjectionsByRepoId.set(input.repoId, projection);
      }
    }

    return toRuntimeSnapshotDto({
      generatedAt: currentIsoTime(),
      data,
      policyProjectionsByRepoId,
    });
  }
}
