import { describe, expect, it } from 'vitest';

import { createForgeloopCommandApi } from '../../apps/web/src/shared/api/commands';
import { createForgeloopQueryApi } from '../../apps/web/src/shared/api/query';

describe('AI-native web API client contract', () => {
  it('exposes AI-native command and query methods without product Task or direct Spec/Plan commands', () => {
    const commands = createForgeloopCommandApi();
    const query = createForgeloopQueryApi();

    for (const method of [
      'generateDevelopmentPlanDraft',
      'regenerateDevelopmentPlanDraft',
      'linkSourceObjectToDevelopmentPlan',
      'generateItemSpecDraft',
      'regenerateItemSpecDraft',
      'generateItemExecutionPlanDraft',
      'startItemExecution',
      'markExecutionReadyForCodeReview',
      'acceptQaHandoff',
    ]) {
      expect(commands, `commands.${method}`).toHaveProperty(method);
    }

    for (const method of [
      'getDashboard',
      'listDevelopmentPlans',
      'getDevelopmentPlanItem',
      'listSpecExecutionPlanQueue',
      'listExecutions',
      'listCodeReviewHandoffs',
      'listQaHandoffs',
    ]) {
      expect(query, `query.${method}`).toHaveProperty(method);
    }

    expect(commands).not.toHaveProperty('createTask');
    expect(commands).not.toHaveProperty('createSpec');
    expect(commands).not.toHaveProperty('createPlan');
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
});
