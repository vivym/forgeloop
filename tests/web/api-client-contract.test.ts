import { describe, expect, it, vi } from 'vitest';

import { createForgeloopCommandApi } from '../../apps/web/src/shared/api/commands';
import { createForgeloopQueryApi } from '../../apps/web/src/shared/api/query';
import { queryKeys } from '../../apps/web/src/shared/api/query-keys';
import { productLaneQueryFromSearchParams } from '../../apps/web/src/shared/api/types';
import {
  parseRoleLens,
  roleLensActorFilter,
  roleLensValues,
} from '../../apps/web/src/features/product-surfaces/role-lens';

describe('AI-native web API client contract', () => {
  it('exposes AI-native workflow commands without product Task or direct Spec/Plan commands', () => {
    const commands = createForgeloopCommandApi();
    const query = createForgeloopQueryApi();

    for (const method of [
      'generateDevelopmentPlanDraft',
      'regenerateDevelopmentPlanDraft',
      'linkPlanningInputToDevelopmentPlan',
      'startPlanItemWorkflowBrainstorming',
      'recordWorkflowMessage',
      'runWorkflowQueuedAction',
      'approveWorkflowArtifactRevision',
      'requestWorkflowArtifactChanges',
      'evaluateWorkflowExecutionReadiness',
      'markExecutionReadyForCodeReview',
      'acceptQaHandoff',
    ]) {
      expect(commands, `commands.${method}`).toHaveProperty(method);
    }

    for (const method of [
      'getDashboard',
      'listDevelopmentPlans',
      'getDevelopmentPlanItem',
      'listDocumentReviewQueue',
      'listExecutions',
      'listCodeReviewHandoffs',
      'listQaHandoffs',
    ]) {
      expect(query, `query.${method}`).toHaveProperty(method);
    }

    expect(commands).not.toHaveProperty('createTask');
    expect(commands).not.toHaveProperty('createSpec');
    expect(commands).not.toHaveProperty('createPlan');
    expect(commands).not.toHaveProperty('generateItemSpecDraft');
    expect(commands).not.toHaveProperty('regenerateItemSpecDraft');
    expect(commands).not.toHaveProperty('generateItemImplementationPlanDraft');
    expect(commands).not.toHaveProperty('regenerateItemImplementationPlanDraft');
    expect(commands).not.toHaveProperty('startItemExecution');
    expect(commands).not.toHaveProperty('startBrainstormingSession');
    expect(commands).not.toHaveProperty('answerBrainstormingQuestion');
    expect(commands).not.toHaveProperty('recordBrainstormingDecision');
    expect(commands).not.toHaveProperty('approveBoundary');
  });

  it('strictly parses typed Requirement projections without client-side business fallbacks', async () => {
    const query = createForgeloopQueryApi({
      fetch: async () =>
        new Response(
          JSON.stringify({
            items: [
              {
                id: 'req-missing-projection-fields',
                ref: { type: 'requirement', id: 'req-missing-projection-fields', title: 'Missing projection fields' },
                title: 'Missing projection fields',
                status: 'ready_for_planning',
                priority: 'high',
                risk: 'high',
                driver_actor_id: 'actor-product',
                updated_at: '2026-05-27T08:00:00.000Z',
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    });

    await expect(query.listRequirements({ project_id: 'project-1' })).rejects.toThrow();
  });

  it('maps role lenses onto explicit actor filters without owner fallbacks', () => {
    expect(roleLensValues).toEqual(['all', 'product', 'tech-lead', 'developer', 'reviewer', 'qa', 'release', 'manager']);
    expect(parseRoleLens('developer')).toBe('developer');
    expect(parseRoleLens('unknown')).toBe('all');

    expect(roleLensActorFilter('product', 'actor-product')).toEqual({ driver_actor_id: 'actor-product' });
    expect(roleLensActorFilter('developer', 'actor-dev')).toEqual({ execution_owner_actor_id: 'actor-dev' });
    expect(roleLensActorFilter('reviewer', 'actor-reviewer')).toEqual({ reviewer_actor_id: 'actor-reviewer' });
    expect(roleLensActorFilter('qa', 'actor-qa')).toEqual({ qa_owner_actor_id: 'actor-qa' });
    expect(roleLensActorFilter('release', 'actor-release')).toEqual({ release_owner_actor_id: 'actor-release' });
    expect(roleLensActorFilter('manager', 'actor-manager')).toEqual({});
    expect(roleLensActorFilter('tech-lead', 'actor-tech')).toEqual({ reviewer_actor_id: 'actor-tech' });
    expect(roleLensActorFilter('developer', undefined)).toEqual({});
  });

  it('preserves actor filters in typed document and Development Plan query keys and URLs', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ items: [], degraded_sources: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const query = createForgeloopQueryApi({ baseUrl: 'http://api.local', fetch: fetchMock });

    await query.listRequirements({
      project_id: 'project-1',
      driver_actor_id: 'actor-product',
      execution_owner_actor_id: 'actor-dev',
      reviewer_actor_id: 'actor-reviewer',
      qa_owner_actor_id: 'actor-qa',
      release_owner_actor_id: 'actor-release',
    });
    await query.listDevelopmentPlans({
      project_id: 'project-1',
      driver_actor_id: 'actor-product',
      execution_owner_actor_id: 'actor-dev',
      reviewer_actor_id: 'actor-reviewer',
      qa_owner_actor_id: 'actor-qa',
      release_owner_actor_id: 'actor-release',
    });

    expect(queryKeys.requirements({
      project_id: 'project-1',
      execution_owner_actor_id: 'actor-dev',
      reviewer_actor_id: 'actor-reviewer',
      qa_owner_actor_id: 'actor-qa',
      release_owner_actor_id: 'actor-release',
    })).toEqual([
      'requirements',
      {
        project_id: 'project-1',
        execution_owner_actor_id: 'actor-dev',
        reviewer_actor_id: 'actor-reviewer',
        qa_owner_actor_id: 'actor-qa',
        release_owner_actor_id: 'actor-release',
      },
    ]);
    expect(queryKeys.developmentPlans({
      project_id: 'project-1',
      execution_owner_actor_id: 'actor-dev',
      reviewer_actor_id: 'actor-reviewer',
      qa_owner_actor_id: 'actor-qa',
      release_owner_actor_id: 'actor-release',
    })[1]).toMatchObject({
      execution_owner_actor_id: 'actor-dev',
      reviewer_actor_id: 'actor-reviewer',
      qa_owner_actor_id: 'actor-qa',
      release_owner_actor_id: 'actor-release',
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'http://api.local/query/requirements?project_id=project-1&driver_actor_id=actor-product&execution_owner_actor_id=actor-dev&reviewer_actor_id=actor-reviewer&qa_owner_actor_id=actor-qa&release_owner_actor_id=actor-release',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://api.local/query/development-plans?project_id=project-1&driver_actor_id=actor-product&execution_owner_actor_id=actor-dev&reviewer_actor_id=actor-reviewer&qa_owner_actor_id=actor-qa&release_owner_actor_id=actor-release',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('keeps execution owner filters in Product Lane URL state for Plan Item execution views', () => {
    expect(
      productLaneQueryFromSearchParams(
        'requirements',
        new URLSearchParams('execution_owner_actor_id=actor-dev&driver_actor_id=actor-product'),
        'project-1',
      ),
    ).toMatchObject({
      project_id: 'project-1',
      driver_actor_id: 'actor-product',
      execution_owner_actor_id: 'actor-dev',
    });
  });

  it('returns the queued-action workflow run envelope', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          workflow: { id: 'workflow-1', status: 'spec_review' },
          queued_action: { id: 'action-1', workflow_id: 'workflow-1', status: 'running' },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const commands = createForgeloopCommandApi({ baseUrl: 'http://api.local', fetch: fetchMock });

    await expect(
      commands.runWorkflowQueuedAction('workflow-1', 'action-1', { actor_id: 'actor-tech' }),
    ).resolves.toMatchObject({
      workflow: { id: 'workflow-1', status: 'spec_review' },
      queued_action: { id: 'action-1', workflow_id: 'workflow-1', status: 'running' },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://api.local/plan-item-workflows/workflow-1/actions/action-1/run',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ actor_id: 'actor-tech' }),
        headers: expect.objectContaining({
          'X-Forgeloop-Actor-Id': 'actor-tech',
        }),
      }),
    );
  });
});
