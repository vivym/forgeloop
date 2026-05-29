import { describe, expect, it } from 'vitest';

import { cockpitCommandCenterViewModel, cockpitViewModel } from '../../apps/web/src/features/cockpit/cockpit-view-model';
import {
  developmentPlanItemViewModel,
  developmentPlanWorkspaceViewModel,
  developmentPlanViewModel,
} from '../../apps/web/src/features/development-plans/development-plan-view-model';
import { executionViewModel } from '../../apps/web/src/features/executions/execution-view-model';
import { myWorkQueueViewModel } from '../../apps/web/src/features/my-work/my-work-view-model';
import {
  bugWorkspaceViewModel,
  initiativeWorkspaceViewModel,
  requirementWorkspaceViewModel,
  techDebtWorkspaceViewModel,
} from '../../apps/web/src/features/project-management/source-object-view-model';
import { releaseViewModel } from '../../apps/web/src/features/releases/release-view-model';
import { reportViewModel } from '../../apps/web/src/features/reports/report-view-model';
import { specPlanQueueViewModel } from '../../apps/web/src/features/spec-plan/spec-plan-view-model';
import {
  actorId,
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
  it('projects requirement rows into typed first-viewport fields without bypassing Development Plan boundaries', () => {
    const row = requirementWorkspaceViewModel.row(requirementDetail, `/requirements/${requirementDetail.id}`);

    expect(row).toMatchObject({
      title: requirementDetail.title,
      href: `/requirements/${requirementDetail.id}`,
      status: expect.any(String),
      priority: expect.any(String),
      driver: expect.any(String),
      developmentPlanCoverage: expect.any(String),
      planItemCoverage: expect.any(String),
      downstreamGateSummary: expect.any(String),
      nextAction: expect.any(String),
      previewSummary: expect.any(String),
      searchText: expect.any(String),
    });
    expect(row.nextAction).toContain('Plan Item');
    expect(row.nextAction).not.toContain('Spec');
    expect(row.nextAction).not.toContain('Execution Plan');
  });

  it('renders unavailable typed source relationship metadata truthfully instead of inventing ready coverage', () => {
    const row = requirementWorkspaceViewModel.row({
      ...requirementDetail,
      relationship_refs: [],
      linked_development_plans: undefined,
      linked_plan_items: undefined,
      planning_coverage: undefined,
    });

    expect(row.developmentPlanCoverage).toBe('Unavailable');
    expect(row.planItemCoverage).toBe('Unavailable');
    expect(row.relatedObjects).toBe('Unavailable');
  });

  it('projects initiative-specific row fields for the typed workspace', () => {
    expect(initiativeWorkspaceViewModel.row(initiativeListItem, `/initiatives/${initiativeListItem.id}`)).toMatchObject({
      businessOutcome: initiativeListItem.business_outcome,
      milestoneIntent: 'Unavailable',
      childRequirements: '0',
      childBugs: '0',
      childTechDebt: '0',
      releaseCoverage: '1 linked',
      driver: actorId,
    });
  });

  it('projects bug-specific row fields for the typed workspace', () => {
    expect(bugWorkspaceViewModel.row(bugListItem, `/bugs/${bugListItem.id}`)).toMatchObject({
      observedBehavior: 'Unavailable',
      expectedBehavior: 'Unavailable',
      reproduction: 'Unavailable',
      severity: bugListItem.severity,
      fixPlanningCoverage: '1 linked / 1 governed',
      driver: actorId,
    });
  });

  it('projects tech-debt-specific row fields for the typed workspace', () => {
    expect(techDebtWorkspaceViewModel.row(techDebtListItem, `/tech-debt/${techDebtListItem.id}`)).toMatchObject({
      affectedModules: techDebtListItem.affected_modules.join(', '),
      riskRationale: techDebtListItem.risk_rationale,
      validationStrategy: 'Unavailable',
      remediationPlanningCoverage: '1 linked / 1 governed',
      driver: actorId,
    });
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

  it('projects Cockpit command center attention, role lens, flow, risk, runtime, and real degradation signals', () => {
    const genericReportLabel = (index: number) => ['Report', String(index)].join(' ');
    const genericReportFollowUpLabel = ['Report', 'follow-up'].join(' ');
    const realActions = [
      {
        id: 'close-release-blocker',
        label: 'Close release blocker evidence',
        href: `/development-plans/${developmentPlan.id}/items/dpi-release-risk-closure`,
        typed_ref: { type: 'development_plan_item', id: 'dpi-release-risk-closure', title: 'Close release blocker evidence' },
        kind: 'release_blocker',
        severity: 'critical',
        stage_id: 'release',
        next_action: 'Resolve QA blocker before release readiness clears',
      },
      {
        id: 'requested-review-changes',
        label: 'Requested code-review changes',
        href: `/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`,
        typed_ref: { type: 'development_plan_item', id: developmentPlanItem.id, title: developmentPlanItem.title },
        kind: 'code_review_changes',
        severity: 'high',
        stage_id: 'code_review',
        next_action: 'Address requested code-review changes',
      },
      {
        id: 'qa-release-impact',
        label: 'QA pending release-impacting handoff',
        href: `/development-plans/${developmentPlan.id}/items/dpi-qa-shift-left-strategy`,
        typed_ref: { type: 'requirement', id: 'req-qa-shift-left', title: 'QA shift-left strategy' },
        kind: 'qa_blocker',
        severity: 'high',
        stage_id: 'qa',
        next_action: 'Record QA owner acceptance',
      },
      {
        id: 'missing-spec-approval',
        label: 'Missing Spec approval',
        href: `/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}/spec`,
        typed_ref: { type: 'development_plan_item', id: developmentPlanItem.id, title: developmentPlanItem.title },
        kind: 'missing_spec_approval',
        severity: 'medium',
        stage_id: 'spec',
        next_action: 'Approve Spec revision before execution planning',
      },
      {
        id: 'resume-interrupted-execution',
        label: 'Resume interrupted Codex execution',
        href: '/executions/exec-release-risk-closure-interrupted',
        typed_ref: { type: 'development_plan_item', id: 'dpi-release-risk-closure', title: 'Close release blocker evidence' },
        kind: 'resumable_execution',
        severity: 'medium',
        stage_id: 'execution',
        next_action: 'Resume Codex execution after blocker ownership is clear',
        runtime: { state: 'interrupted', resumable: true, execution_id: 'exec-release-risk-closure-interrupted' },
      },
      {
        id: 'stale-context',
        label: 'Refresh stale delivery context',
        typed_ref: { type: 'initiative', id: 'init-product-workspace', title: 'Product workspace redesign' },
        kind: 'stale_context',
        severity: 'low',
        stage_id: 'boundary',
        next_action: 'Refresh stale cockpit source context',
      },
    ] as const;
    const model = cockpitCommandCenterViewModel({
      project_id: projectId,
      role_lens: {
        selected: 'release_owner_actor_id',
        label: 'Release owner',
        actor_id: 'actor-release',
        available: [
          { id: 'driver_actor_id', label: 'Driver' },
          { id: 'reviewer_actor_id', label: 'Reviewer' },
          { id: 'release_owner_actor_id', label: 'Release owner' },
        ],
      },
      sections: [
        { id: 'flow-health', label: 'Flow Health', value: 6 },
        { id: 'spec', label: 'Spec', value: 2 },
        { id: 'execution-plan', label: 'Execution Plan', value: 1 },
        { id: 'release-confidence', label: 'Release Confidence', value: 1 },
      ],
      next_actions: [
        ...realActions,
        {
          id: 'report-1',
          label: genericReportLabel(1),
          href: '/reports',
          next_action: 'Open generic report',
        },
      ],
      runtime_signals: [
        {
          execution_id: 'exec-release-risk-closure-interrupted',
          href: '/executions/exec-release-risk-closure-interrupted',
          label: 'Resume interrupted Codex execution',
          resumable: true,
          state: 'interrupted',
        },
      ],
      report_links: [
        { id: 'report-2', label: genericReportLabel(2), href: '/reports' },
        { id: 'report-follow-up', label: genericReportFollowUpLabel, href: '/reports/delivery' },
      ],
      degraded_sources: ['dashboard:stale_context'],
    });

    expect(model.attentionItems.length).toBeGreaterThanOrEqual(3);
    expect(model.attentionItems.length).toBeLessThanOrEqual(7);
    expect(model.attentionItems[0]).toMatchObject({
      kind: 'release_blocker',
      typed_ref: expect.objectContaining({ type: expect.stringMatching(/requirement|bug|tech_debt|initiative|development_plan_item/) }),
      next_action: expect.any(String),
      severity: expect.any(String),
    });
    expect(model.attentionItems.map((item) => item.label)).not.toEqual(
      expect.arrayContaining([genericReportLabel(1), genericReportLabel(2), genericReportFollowUpLabel]),
    );
    expect(model.roleLens).toMatchObject({
      selected: 'release_owner_actor_id',
      label: 'Release owner',
      actor_id: 'actor-release',
      available: expect.arrayContaining([expect.objectContaining({ id: 'reviewer_actor_id' })]),
    });
    expect(model.flowStrip).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'spec', count: 2 }),
        expect.objectContaining({ id: 'execution_plan', count: 1 }),
      ]),
    );
    expect(model.riskRail).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'release_blocker' }),
      expect.objectContaining({ kind: 'review_aging' }),
      expect.objectContaining({ kind: 'qa_blocker' }),
      expect.objectContaining({ kind: 'stale_context' }),
    ]));
    expect(model.runtimeSignals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          execution_id: 'exec-release-risk-closure-interrupted',
          state: 'interrupted',
          resumable: true,
        }),
      ]),
    );
    expect(model.degradedStates).toEqual([expect.objectContaining({ source: 'dashboard:stale_context' })]);
    expect(cockpitCommandCenterViewModel({ project_id: projectId, sections: [], next_actions: [], report_links: [], degraded_sources: [] })).toMatchObject({
      attentionItems: [],
      degradedStates: [],
      riskRail: [],
      runtimeSignals: [],
    });
    expect(cockpitCommandCenterViewModel({ project_id: projectId, next_actions: [realActions[0]], degraded_sources: [] }).attentionItems).toHaveLength(1);
    expect(cockpitCommandCenterViewModel({
      project_id: projectId,
      next_actions: [
        { id: 'continue-execution', label: 'Continue execution', href: '/executions/exec-1' },
        { id: 'close-release-blocker', label: 'Close release blocker evidence', href: '/development-plans/dp-1/items/dpi-1' },
        {
          id: 'runtime-without-kind',
          label: 'Runtime payload without structured kind',
          href: '/executions/exec-2',
          runtime: { execution_id: 'exec-2', state: 'interrupted', resumable: true },
        },
        {
          id: 'kind-without-runtime',
          label: 'Structured execution kind without runtime',
          href: '/executions/exec-3',
          kind: 'resumable_execution',
          typed_ref: { type: 'development_plan_item', id: 'dpi-3', title: 'Execution without runtime' },
        },
      ],
      degraded_sources: [],
    })).toMatchObject({
      attentionItems: [],
      riskRail: [],
      runtimeSignals: [],
    });
    expect(cockpitCommandCenterViewModel({
      project_id: projectId,
      next_actions: [
        ...realActions,
        {
          id: 'extra-release-blocker',
          label: 'Extra release blocker',
          typed_ref: { type: 'development_plan_item', id: 'dpi-extra-release-blocker', title: 'Extra release blocker' },
          kind: 'release_blocker',
          severity: 'critical',
          stage_id: 'release',
          next_action: 'Close extra release blocker',
        },
        {
          id: 'extra-review-aging',
          label: 'Extra review aging',
          typed_ref: { type: 'development_plan_item', id: 'dpi-extra-review-aging', title: 'Extra review aging' },
          kind: 'code_review_changes',
          severity: 'high',
          stage_id: 'code_review',
          next_action: 'Close extra review aging',
        },
      ],
      runtime_signals: [
        {
          execution_id: 'exec-runtime-preserved-after-attention-cap',
          href: '/executions/exec-runtime-preserved-after-attention-cap',
          label: 'Runtime preserved after attention cap',
          resumable: true,
          state: 'paused',
        },
        {
          execution_id: 'exec-running-runtime',
          href: '/executions/exec-running-runtime',
          label: 'Running Codex execution',
          resumable: false,
          state: 'running',
        },
      ],
      degraded_sources: [],
    }).runtimeSignals).toEqual(expect.arrayContaining([
      expect.objectContaining({
        execution_id: 'exec-runtime-preserved-after-attention-cap',
        state: 'paused',
        resumable: true,
      }),
      expect.objectContaining({
        execution_id: 'exec-running-runtime',
        state: 'running',
        resumable: false,
      }),
    ]));
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
    expect(developmentPlanWorkspaceViewModel([developmentPlan], developmentPlan.id)).toMatchObject({
      summaryMetrics: expect.arrayContaining([
        expect.objectContaining({ label: 'Total plans', value: '1' }),
        expect.objectContaining({ label: 'Active plans', value: '1' }),
        expect.objectContaining({ label: 'Blocked items', value: '2' }),
        expect.objectContaining({ label: 'Review aging', value: expect.any(String) }),
        expect.objectContaining({ label: 'Execution in progress', value: '1' }),
      ]),
      plans: [
        expect.objectContaining({
          title: developmentPlan.title,
          typedRefs: ['Product workspace clarity and route-backed context'],
          itemCount: 4,
          blockedCount: 2,
          gateDistribution: expect.stringContaining('Spec'),
          actors: expect.objectContaining({
            drivers: expect.arrayContaining([actorId]),
            reviewers: expect.arrayContaining(['actor-reviewer']),
          }),
          nextAction: expect.any(String),
        }),
      ],
      selectedPlan: expect.objectContaining({
        id: developmentPlan.id,
        selectedPlanItem: expect.objectContaining({
          id: developmentPlan.items[0].id,
          typedSourceContext: ['Product workspace clarity and route-backed context'],
          artifacts: expect.arrayContaining([
            expect.objectContaining({ label: 'Spec', href: expect.stringContaining('/spec') }),
            expect.objectContaining({ label: 'Implementation Plan Doc', href: expect.stringContaining('/implementation-plan') }),
            expect.objectContaining({ label: 'Execution', href: expect.stringContaining('/execution') }),
          ]),
        }),
      }),
    });

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

  it('does not count ordinary pending gate progression as blocked Development Plan work', () => {
    const pendingPlan = {
      ...developmentPlan,
      blocked_count: undefined,
      items: [
        {
          ...developmentPlan.items[0],
          boundary_status: 'approved',
          spec_status: 'in_review',
          execution_plan_status: 'missing',
          execution_status: 'not_started',
          review_status: 'missing',
          qa_handoff_status: 'pending',
        },
      ],
    };

    expect(developmentPlanWorkspaceViewModel([pendingPlan], pendingPlan.id)).toMatchObject({
      summaryMetrics: expect.arrayContaining([
        expect.objectContaining({ label: 'Blocked items', value: '0' }),
      ]),
      selectedPlan: expect.objectContaining({
        blockedCount: 0,
      }),
    });

    expect(developmentPlanViewModel(pendingPlan)).toMatchObject({
      riskSignal: 'No blocked item signal',
      secondaryMetadata: expect.arrayContaining([
        expect.objectContaining({ label: 'Blocked', value: '0' }),
      ]),
    });
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

  it('normalizes legacy Spec and Execution Plan queue hrefs to canonical review routes', () => {
    const viewModel = specPlanQueueViewModel({
      degraded_sources: [],
      items: [
        {
          id: 'legacy-spec-href',
          artifact_type: 'spec',
          href: '/development-plans/legacy-plan/items/legacy-item/execution-plan',
        },
        {
          id: 'legacy-execution-plan-href',
          artifact_type: 'execution_plan',
          href: '/development-plans/legacy-plan/items/legacy-item/execution-plan',
        },
        {
          id: 'item-scoped-execution-plan',
          artifact_type: 'execution_plan',
          development_plan_item_ref: {
            id: developmentPlanItem.id,
            development_plan_id: developmentPlan.id,
          },
        },
      ],
    });

    expect(viewModel.rows.map((row) => row.href)).toEqual([
      '/reviews?tab=specs',
      '/reviews?tab=implementation-plans',
      `/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}/implementation-plan`,
    ]);
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
