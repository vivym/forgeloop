import type { ArtifactRef } from '@forgeloop/contracts';

import type { AutomationGenerationWorkItemContextV1, GeneratedSpecDraftV1 } from './types.js';

export const specDraftPromptVersion = 'spec-draft.fake.v1';
export const specDraftOutputSchemaVersion = 'spec_draft.v1';

export type AutomationGenerationMode = 'disabled' | 'fake' | 'app_server';

export interface GeneratedSpecDraftResult {
  generated: unknown;
  generationArtifacts: ArtifactRef[];
}

export interface SpecDraftGenerator {
  readonly mode: AutomationGenerationMode;
  generateSpecDraft(context: AutomationGenerationWorkItemContextV1): Promise<GeneratedSpecDraftResult>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const nonBlank = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

const stringList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => nonBlank(entry));

export const validateGeneratedSpecDraft = (value: unknown): GeneratedSpecDraftV1 => {
  if (!isRecord(value) || value.schema_version !== 'spec_draft.v1') {
    throw new Error('generated_spec_draft_invalid');
  }
  if (
    !nonBlank(value.summary) ||
    !nonBlank(value.content) ||
    !nonBlank(value.background) ||
    !stringList(value.goals) ||
    !stringList(value.scope_in) ||
    !stringList(value.scope_out) ||
    !stringList(value.acceptance_criteria) ||
    !stringList(value.risk_notes) ||
    !nonBlank(value.test_strategy_summary) ||
    (value.structured_document !== undefined && !isRecord(value.structured_document))
  ) {
    throw new Error('generated_spec_draft_invalid');
  }
  return value as unknown as GeneratedSpecDraftV1;
};

export const disabledSpecDraftGenerator: SpecDraftGenerator = {
  mode: 'disabled',
  async generateSpecDraft(): Promise<GeneratedSpecDraftResult> {
    throw new Error('generation_disabled');
  },
};

export const createFakeSpecDraftGenerator = (): SpecDraftGenerator => ({
  mode: 'fake',
  async generateSpecDraft(context) {
    const workItem = context.work_item;
    return {
      generated: {
        schema_version: 'spec_draft.v1',
        summary: `Draft spec for ${workItem.title}`,
        content: [
          `Goal: ${workItem.goal}`,
          `Success criteria: ${workItem.success_criteria.join('; ')}`,
          'Scope: implement only the delivery behavior needed for this work item.',
          'Test strategy: cover command flow and persisted evidence.',
        ].join('\n\n'),
        background: workItem.goal,
        goals: [workItem.goal],
        scope_in: [`Deliver ${workItem.title}`],
        scope_out: ['Release, deploy, and non-delivery workflows'],
        acceptance_criteria: [...workItem.success_criteria],
        risk_notes: workItem.risk === undefined || workItem.risk.trim().length === 0 ? [] : [workItem.risk],
        test_strategy_summary: `Validate ${workItem.title} with API and daemon tests.`,
        structured_document: {
          generated_by: 'fake_spec_draft_generator',
          prompt_version: specDraftPromptVersion,
          output_schema_version: specDraftOutputSchemaVersion,
          work_item_id: workItem.id,
        },
      },
      generationArtifacts: [],
    };
  },
});
