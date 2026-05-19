import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { DeliveryRepository } from '@forgeloop/db';
import { DomainError } from '@forgeloop/domain';

import { DELIVERY_REPOSITORY } from '../core/control-plane-tokens';
import type {
  AutomationGenerationPlanContextV1,
  AutomationGenerationRepoContextV1,
  AutomationGenerationWorkItemContextV1,
  GenerationContextQueryDto,
  PlanGenerationContextQueryDto,
} from './automation.dto';
import { assertNoActiveHolds } from './automation-command-helpers';
import { policyProjectionsByRepoScopeFor } from './policy-projection';

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

const projectIdFromAutomationScope = (automationScope: string): string | undefined => {
  const [scopeType, projectId, , extra] = automationScope.split(':');
  return (scopeType === 'project' || scopeType === 'repo') && projectId !== undefined && extra === undefined
    ? projectId
    : undefined;
};

const isTerminalWorkItem = (workItem: { phase: string; resolution: string; archived_at?: string; deleted_at?: string }): boolean =>
  workItem.phase === 'done' ||
  workItem.phase === 'closed' ||
  workItem.resolution === 'completed' ||
  workItem.archived_at !== undefined ||
  workItem.deleted_at !== undefined;

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
    const repos = await this.repoContextsFor(workItem.project_id, scopedRepoId);
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

  async getPlanDraftContext(
    workItemId: string,
    query: PlanGenerationContextQueryDto,
  ): Promise<AutomationGenerationPlanContextV1> {
    const action = await this.getActiveClaim(query.action_run_id, query.claim_token);
    const mismatched =
      action.action_type !== 'ensure_plan_draft' ||
      action.target_object_type !== 'work_item' ||
      action.target_object_id !== workItemId ||
      action.target_revision_id !== query.spec_revision_id ||
      action.action_input_json.work_item_id !== workItemId ||
      action.action_input_json.spec_revision_id !== query.spec_revision_id;
    if (mismatched) {
      throw new ConflictException(claimConflictBody);
    }

    const workItem = await this.repository.getWorkItem(workItemId);
    if (workItem === undefined) {
      throw new NotFoundException(`WorkItem ${workItemId}`);
    }
    const scopedProjectId = projectIdFromAutomationScope(action.automation_scope);
    if (scopedProjectId !== undefined && workItem.project_id !== scopedProjectId) {
      throw new ConflictException(claimConflictBody);
    }
    if (isTerminalWorkItem(workItem)) {
      throw new ConflictException(claimConflictBody);
    }
    if (workItem.current_spec_id === undefined) {
      throw new ConflictException(claimConflictBody);
    }

    const spec = await this.repository.getSpec(workItem.current_spec_id);
    if (
      spec === undefined ||
      spec.work_item_id !== workItem.id ||
      spec.status !== 'approved' ||
      spec.resolution !== 'approved' ||
      spec.approved_revision_id === undefined ||
      spec.current_revision_id !== spec.approved_revision_id ||
      query.spec_revision_id !== spec.approved_revision_id
    ) {
      throw new ConflictException(claimConflictBody);
    }

    const specRevision = await this.repository.getSpecRevision(query.spec_revision_id);
    if (specRevision === undefined) {
      throw new NotFoundException(`SpecRevision ${query.spec_revision_id}`);
    }
    if (specRevision.spec_id !== spec.id || specRevision.work_item_id !== workItem.id) {
      throw new ConflictException(claimConflictBody);
    }

    const scopedRepoId = repoIdFromAutomationScope(action.automation_scope);
    const repos = await this.repoContextsFor(workItem.project_id, scopedRepoId);
    if (scopedRepoId !== undefined && repos.length === 0) {
      throw new ConflictException(claimConflictBody);
    }

    await assertNoActiveHolds(this.repository, [
      { object_type: 'work_item', object_id: workItem.id },
      { object_type: 'spec_revision', object_id: specRevision.id },
    ]);

    return {
      context_version: 'generation_context.plan.v1',
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
      spec_revision: {
        id: specRevision.id,
        spec_id: specRevision.spec_id,
        summary: specRevision.summary,
        content: specRevision.content,
        background: specRevision.background,
        goals: specRevision.goals,
        scope_in: specRevision.scope_in,
        scope_out: specRevision.scope_out,
        acceptance_criteria: specRevision.acceptance_criteria,
        risk_notes: specRevision.risk_notes,
        test_strategy_summary: specRevision.test_strategy_summary,
        ...(specRevision.structured_document === undefined
          ? {}
          : { structured_document: specRevision.structured_document }),
      },
      repos,
    };
  }

  private async repoContextsFor(projectId: string, scopedRepoId: string | undefined): Promise<AutomationGenerationRepoContextV1[]> {
    const runtimeSnapshot = await this.repository.getRuntimeSnapshotData();
    const policyProjectionsByRepoScope = policyProjectionsByRepoScopeFor(runtimeSnapshot.policy_projection_action_runs);
    return (await this.repository.listProjectRepos(projectId))
      .filter((repo) => repo.status === 'active' && (scopedRepoId === undefined || repo.repo_id === scopedRepoId))
      .map((repo) => {
        const policyProjection = policyProjectionsByRepoScope.get(`repo:${repo.project_id}:${repo.repo_id}`);
        return {
          project_id: repo.project_id,
          repo_id: repo.repo_id,
          default_branch: repo.default_branch,
          policy_status: policyProjection?.policy_status ?? 'missing',
          ...(policyProjection?.policy_digest === undefined ? {} : { policy_digest: policyProjection.policy_digest }),
          ...(policyProjection?.parser_version === undefined ? {} : { parser_version: policyProjection.parser_version }),
        };
      });
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
