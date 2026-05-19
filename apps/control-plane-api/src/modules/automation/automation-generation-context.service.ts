import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { DeliveryRepository } from '@forgeloop/db';
import { DomainError } from '@forgeloop/domain';

import { DELIVERY_REPOSITORY } from '../core/control-plane-tokens';
import type { AutomationGenerationWorkItemContextV1, GenerationContextQueryDto } from './automation.dto';

const claimConflictBody = {
  code: 'automation_action_claim_conflict',
  message: 'Automation action claim is not active.',
};

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

const isAtOrBefore = (left: string, right: string): boolean => Date.parse(left) <= Date.parse(right);

const repoIdFromAutomationScope = (automationScope: string): string | undefined => {
  const [scopeType, , repoId, extra] = automationScope.split(':');
  return scopeType === 'repo' && repoId !== undefined && extra === undefined ? repoId : undefined;
};

@Injectable()
export class AutomationGenerationContextService {
  constructor(@Inject(DELIVERY_REPOSITORY) private readonly repository: DeliveryRepository) {}

  async getSpecDraftContext(
    workItemId: string,
    query: GenerationContextQueryDto,
  ): Promise<AutomationGenerationWorkItemContextV1> {
    const action = await this.getActiveClaim(query.action_run_id, query.claim_token);
    const mismatched =
      action.action_type !== 'ensure_spec_draft' ||
      action.target_object_type !== 'work_item' ||
      action.target_object_id !== workItemId ||
      action.action_input_json.work_item_id !== workItemId;
    if (mismatched) {
      throw new ConflictException(claimConflictBody);
    }

    const workItem = await this.repository.getWorkItem(workItemId);
    if (workItem === undefined) {
      throw new NotFoundException(`WorkItem ${workItemId}`);
    }

    const scopedRepoId = repoIdFromAutomationScope(action.automation_scope);
    const repos = (await this.repository.listProjectRepos(workItem.project_id))
      .filter((repo) => repo.status === 'active' && (scopedRepoId === undefined || repo.repo_id === scopedRepoId))
      .map((repo) => ({
        project_id: repo.project_id,
        repo_id: repo.repo_id,
        default_branch: repo.default_branch,
        policy_status: 'missing' as const,
      }));
    if (scopedRepoId !== undefined && repos.length === 0) {
      throw new ConflictException(claimConflictBody);
    }

    return {
      context_version: 'generation_context.work_item.v1',
      action_run_id: action.id,
      work_item: {
        id: workItem.id,
        project_id: workItem.project_id,
        title: workItem.title,
        goal: workItem.goal,
        success_criteria: workItem.success_criteria,
        risk: workItem.risk,
        priority: workItem.priority,
        kind: workItem.kind,
      },
      repos,
    };
  }

  private async getActiveClaim(actionRunId: string, claimToken: string) {
    try {
      const action = await this.repository.getClaimedAutomationActionRun({ id: actionRunId, claim_token: claimToken });
      if (action.locked_until === undefined || isAtOrBefore(action.locked_until, currentIsoTime())) {
        throw new ConflictException(claimConflictBody);
      }
      return action;
    } catch (error) {
      if (error instanceof DomainError && error.code === 'INVALID_TRANSITION') {
        throw new ConflictException(claimConflictBody);
      }
      throw error;
    }
  }
}
