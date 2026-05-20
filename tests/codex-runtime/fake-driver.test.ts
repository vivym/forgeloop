import { describe, expect, it } from 'vitest';

import {
  createFakePackageDraftSet,
  createFakePlanDraft,
  createFakeSpecDraft,
  packageDraftsOutputSchemaVersion,
  packageDraftsPromptVersion,
  planDraftOutputSchemaVersion,
  planDraftPromptVersion,
  specDraftOutputSchemaVersion,
  specDraftPromptVersion,
} from '../../packages/codex-runtime/src/fake-driver';
import {
  validateGeneratedPackageDraftSet,
  validateGeneratedPlanDraft,
  validateGeneratedSpecDraft,
} from '../../packages/codex-runtime/src/payloads';

describe('fake Codex generation driver', () => {
  it('createFakeSpecDraft returns expected metadata and a valid Spec draft', () => {
    const result = createFakeSpecDraft({
      work_item: {
        id: 'work-1',
        title: 'Runtime',
        goal: 'Generate drafts',
        success_criteria: ['Spec exists'],
      },
    });

    expect(result).toMatchObject({
      taskKind: 'spec_draft',
      promptVersion: specDraftPromptVersion,
      outputSchemaVersion: specDraftOutputSchemaVersion,
    });
    expect(() => validateGeneratedSpecDraft(result.generated)).not.toThrow();
  });

  it('createFakePlanDraft returns expected metadata and a valid Plan draft', () => {
    const result = createFakePlanDraft({
      work_item: {
        id: 'work-1',
        title: 'Runtime',
        goal: 'Generate drafts',
        success_criteria: ['Plan exists'],
      },
      spec_revision: { id: 'spec-rev-1', risk_notes: ['Keep human gates'] },
    });

    expect(result).toMatchObject({
      taskKind: 'plan_draft',
      promptVersion: planDraftPromptVersion,
      outputSchemaVersion: planDraftOutputSchemaVersion,
    });
    expect(() => validateGeneratedPlanDraft(result.generated)).not.toThrow();
  });

  it('createFakePackageDraftSet returns expected metadata, preserves dependency order, and validates', () => {
    const result = createFakePackageDraftSet({
      generation_key: 'default',
      plan_revision: { id: 'plan-rev-1', dependency_order: ['api', 'tests'] },
      repos: [{ repo_id: 'repo-main' }],
    });

    expect(result).toMatchObject({
      taskKind: 'package_drafts',
      promptVersion: packageDraftsPromptVersion,
      outputSchemaVersion: packageDraftsOutputSchemaVersion,
    });
    expect(result.generated.manifest.dependency_order).toEqual(['api', 'tests']);
    expect(() => validateGeneratedPackageDraftSet(result.generated)).not.toThrow();
  });
});
