import { describe, expect, it } from 'vitest';

import { cockpitViewModel } from '../../apps/web/src/features/cockpit/cockpit-view-model';
import {
  developmentPlanItemViewModel,
  developmentPlanViewModel,
} from '../../apps/web/src/features/development-plans/development-plan-view-model';
import { executionViewModel } from '../../apps/web/src/features/executions/execution-view-model';
import { myWorkQueueViewModel } from '../../apps/web/src/features/my-work/my-work-view-model';
import { sourceObjectListViewModel } from '../../apps/web/src/features/project-management/source-object-view-model';
import { releaseViewModel } from '../../apps/web/src/features/releases/release-view-model';
import { reportViewModel } from '../../apps/web/src/features/reports/report-view-model';
import { specPlanQueueViewModel } from '../../apps/web/src/features/spec-plan/spec-plan-view-model';
import {
  developmentPlan,
  developmentPlanItem,
  execution,
  bugListItem,
  initiativeListItem,
  myWorkQueueResponse,
  productDynamicRouteFixtureManifest,
  projectId,
  release,
  releaseReadinessDetail,
  reportFixtures,
  requirementDetail,
  requirementListItem,
  techDebtListItem,
  workItemKindCockpitFixtures,
} from './fixtures/product-data';
import { defaultProductApiResponses } from './fixtures/product-api-mock';

const specPlanQueueResponse = defaultProductApiResponses[
  `GET /query/specs-execution-plans?project_id=${projectId}`
] as {
  items: Array<Record<string, unknown>>;
  degraded_sources: string[];
};

describe('product-grade presentation view models', () => {
  it('projects source objects into first-viewport fields without bypassing Development Plan boundaries', () => {
    expect(sourceObjectListViewModel(requirementDetail)).toMatchObject({
      objectLabel: requirementDetail.title,
      objectType: 'Requirement',
      currentState: expect.any(String),
      nextAction: expect.any(String),
      primaryActorOrRole: expect.any(String),
      riskSignal: expect.any(String),
      gateProgress: expect.any(Array),
      criticalEvidence: expect.any(Array),
      secondaryMetadata: expect.any(Array),
      previewSummary: expect.any(String),
      timelineSummary: expect.any(String),
    });
    expect(sourceObjectListViewModel(requirementDetail).nextAction).toContain('Development Plan');
    expect(sourceObjectListViewModel(requirementDetail).nextAction).not.toContain('Spec');
    expect(sourceObjectListViewModel(requirementDetail).nextAction).not.toContain('Execution Plan');
  });

  it('renders unavailable source evidence truthfully instead of inventing a ready state', () => {
    const viewModel = sourceObjectListViewModel({
      ...requirementDetail,
      attachment_refs: [],
      evidence_refs: [],
      relationship_refs: [],
    });

    expect(viewModel.criticalEvidence).toContainEqual(
      expect.objectContaining({
        label: 'Source evidence',
        state: 'unavailable',
        compactText: 'Evidence readiness unavailable',
      }),
    );
  });

  it('projects cockpit readiness into first-viewport fields', () => {
    expect(cockpitViewModel(workItemKindCockpitFixtures.requirement)).toMatchObject({
      objectLabel: 'Clarify release readiness requirements',
      objectType: 'Requirement',
      currentState: expect.any(String),
      nextAction: expect.any(String),
      primaryActorOrRole: expect.any(String),
      riskSignal: expect.any(String),
      gateProgress: expect.any(Array),
      criticalEvidence: expect.any(Array),
      secondaryMetadata: expect.any(Array),
      previewSummary: expect.any(String),
      timelineSummary: expect.any(String),
    });
  });

  it('does not surface cockpit next actions without explicit enabled metadata as executable', () => {
    const viewModel = cockpitViewModel({
      ...workItemKindCockpitFixtures.requirement,
      delivery_readiness: {
        ...workItemKindCockpitFixtures.requirement.delivery_readiness,
        next_actions: [{ label: 'Run unsafe command without eligibility metadata' }],
      },
    });

    expect(viewModel.nextAction).not.toBe('Run unsafe command without eligibility metadata');
    expect(viewModel.disabledReason).toBe('Next action eligibility unavailable');
  });

  it('projects My Work queues and degrades missing bulk action eligibility', () => {
    const viewModel = myWorkQueueViewModel(myWorkQueueResponse);

    expect(viewModel).toMatchObject({
      objectLabel: 'My Work',
      objectType: 'Role Queue',
      currentState: expect.any(String),
      nextAction: expect.any(String),
      primaryActorOrRole: expect.any(String),
      riskSignal: expect.any(String),
      bulkAction: {
        enabled: false,
        label: 'No shared safe bulk action',
        disabledReason: 'No shared safe bulk action',
      },
    });
  });

  it('does not mark scoped My Work bulk actions executable without a command contract', () => {
    const baseViewModel = myWorkQueueViewModel({
      ...myWorkQueueResponse,
      bulk_action: {
        id: 'bulk-ack-product-risk',
        label: 'Acknowledge selected product risk',
        enabled: true,
        scope_role_ids: ['product'],
        scope_object_types: ['requirement'],
        scope_object_refs: [{ type: 'requirement', id: requirementListItem.id }],
      },
    });
    const viewModel = myWorkQueueViewModel(
      {
        ...myWorkQueueResponse,
        bulk_action: {
          id: 'bulk-ack-product-risk',
          label: 'Acknowledge selected product risk',
          enabled: true,
          scope_role_ids: ['product'],
          scope_object_types: ['requirement'],
          scope_object_refs: [{ type: 'requirement', id: requirementListItem.id }],
        },
      },
      baseViewModel.allRows.filter((row) => row.objectId === requirementListItem.id && row.objectType === 'requirement'),
    );

    expect(viewModel.safeBulkAction).toBeUndefined();
    expect(viewModel.bulkAction).toMatchObject({
      enabled: false,
      disabledReason: 'Bulk action execution command unavailable',
    });
  });

  it('projects Development Plans and Development Plan Items', () => {
    expect(developmentPlanViewModel(developmentPlan)).toMatchObject({
      objectLabel: developmentPlan.title,
      objectType: 'Development Plan',
      currentState: expect.any(String),
      nextAction: expect.any(String),
      primaryActorOrRole: expect.any(String),
      riskSignal: expect.any(String),
    });

    expect(developmentPlanItemViewModel(developmentPlanItem)).toMatchObject({
      objectLabel: developmentPlanItem.title,
      objectType: 'Development Plan Item',
      currentState: expect.any(String),
      nextAction: expect.any(String),
      primaryActorOrRole: expect.any(String),
      riskSignal: expect.any(String),
    });
  });

  it('advances Development Plan Items to release preparation after approved QA handoff', () => {
    const { next_action: _nextAction, ...itemWithoutExplicitNextAction } = developmentPlanItem;

    expect(developmentPlanItemViewModel({
      ...itemWithoutExplicitNextAction,
      execution_status: 'completed',
      qa_handoff_status: 'approved',
      review_status: 'approved',
    }).nextAction).toBe('Prepare release');
  });

  it('projects Spec and Execution Plan governance queues', () => {
    expect(specPlanQueueViewModel(specPlanQueueResponse)).toMatchObject({
      objectLabel: 'Document Reviews',
      objectType: 'Governance Queue',
      currentState: expect.any(String),
      nextAction: expect.any(String),
      primaryActorOrRole: expect.any(String),
      riskSignal: expect.any(String),
      gateProgress: expect.any(Array),
    });
  });

  it('projects Execution evidence and degrades missing PR, diff, and test refs', () => {
    expect(executionViewModel(execution)).toMatchObject({
      objectLabel: developmentPlanItem.title,
      objectType: 'Execution supervision',
      currentState: expect.any(String),
      nextAction: expect.any(String),
      primaryActorOrRole: expect.any(String),
      riskSignal: expect.any(String),
      criticalEvidence: expect.arrayContaining([
        expect.objectContaining({ label: 'PR evidence', state: 'available' }),
        expect.objectContaining({ label: 'Diff evidence', state: 'available' }),
        expect.objectContaining({ label: 'Test evidence', state: 'available' }),
      ]),
    });

    const missingEvidence = executionViewModel({
      ...execution,
      pr_refs: [],
      diff_refs: [],
      test_evidence_refs: [],
    });

    for (const label of ['PR evidence', 'Diff evidence', 'Test evidence']) {
      expect(missingEvidence.criticalEvidence).toContainEqual(
        expect.objectContaining({
          label,
          state: 'unavailable',
          compactText: 'Evidence unavailable',
        }),
      );
    }
  });

  it('projects Release readiness and disables launch or rollback when approvals or rollback details are missing', () => {
    expect(releaseViewModel({ release, readiness: releaseReadinessDetail })).toMatchObject({
      objectLabel: release.title,
      objectType: 'Release',
      currentState: expect.any(String),
      nextAction: expect.any(String),
      primaryActorOrRole: 'Release owner',
      riskSignal: expect.any(String),
      actions: expect.arrayContaining([
        expect.objectContaining({ id: 'launch', enabled: false, disabledReason: expect.any(String) }),
        expect.objectContaining({ id: 'rollback', enabled: true }),
      ]),
    });

    const degradedRelease = releaseViewModel({
      release: { ...release, rollback_plan: undefined },
      readiness: {
        ...releaseReadinessDetail,
        required_review_evidence: [],
        disabled_reasons: [],
      },
    });

    expect(degradedRelease.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'launch',
          enabled: false,
          disabledReason: 'Release approval evidence unavailable',
        }),
        expect.objectContaining({
          id: 'rollback',
          enabled: false,
          disabledReason: 'Rollback details unavailable',
        }),
      ]),
    );
  });

  it('fails release launch closed when partial readiness claims ready without required evidence groups', () => {
    const partialReadyRelease = releaseViewModel({
      release,
      readiness: { ready: true },
    });

    expect(partialReadyRelease.gateProgress).toContainEqual(
      expect.objectContaining({
        label: 'Approval',
        state: 'unavailable',
        disabledReason: 'Release approval evidence unavailable',
      }),
    );
    expect(partialReadyRelease.actions).toContainEqual(
      expect.objectContaining({
        id: 'launch',
        enabled: false,
        disabledReason: 'Release approval evidence unavailable',
      }),
    );
  });

  it('projects Reports and refuses to invent conclusions or suggested actions from insufficient signal', () => {
    expect(reportViewModel(reportFixtures.releaseReadiness)).toMatchObject({
      objectLabel: 'Release Readiness',
      objectType: 'Report',
      currentState: 'Signal available',
      nextAction: 'Review report',
      primaryActorOrRole: expect.any(String),
      riskSignal: expect.any(String),
      conclusion: 'Release readiness signal available',
      suggestedAction: expect.objectContaining({ id: 'review-release-readiness', enabled: true }),
    });
    expect(reportViewModel(reportFixtures.releaseReadiness).suggestedAction?.id).not.toBe('development-plan-throughput');
    expect(reportViewModel(reportFixtures.releaseReadiness).criticalEvidence).toContainEqual(
      expect.objectContaining({
        label: 'Report groups',
        state: 'available',
        compactText: '2 populated group(s)',
      }),
    );

    const insufficientSignal = reportViewModel({
      id: 'release-readiness',
      project_id: projectId,
      generated_at: '2026-05-18T01:05:00.000Z',
      groups: [],
      links: [],
      degraded_sources: ['release-readiness:signal_unavailable'],
    });

    expect(insufficientSignal).toMatchObject({
      conclusion: 'Insufficient signal',
      suggestedAction: undefined,
      nextAction: 'Collect report signal',
    });
  });

  it('keeps the fixture manifest populated for every dynamic product route family', () => {
    expect(productDynamicRouteFixtureManifest).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ family: 'source-document', objectType: 'requirement', objectId: requirementListItem.id }),
        expect.objectContaining({ family: 'source-evidence', objectType: 'requirement', objectId: requirementListItem.id }),
        expect.objectContaining({ family: 'source-evidence', objectType: 'initiative', objectId: initiativeListItem.id }),
        expect.objectContaining({ family: 'source-evidence', objectType: 'bug', objectId: bugListItem.id }),
        expect.objectContaining({ family: 'source-evidence', objectType: 'tech_debt', objectId: techDebtListItem.id }),
        expect.objectContaining({ family: 'planning-table', objectType: 'development_plan' }),
        expect.objectContaining({ family: 'gate-flow', objectType: 'development_plan_item' }),
        expect.objectContaining({ family: 'execution-supervision', objectType: 'execution' }),
        expect.objectContaining({ family: 'release-readiness', objectType: 'release' }),
        expect.objectContaining({ family: 'release-evidence', objectType: 'release' }),
      ]),
    );
  });
});
