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
});
