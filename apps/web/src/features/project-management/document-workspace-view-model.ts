type SourceRef = { type?: string | undefined; id?: string | undefined; title?: string | undefined; development_plan_id?: string | undefined };

interface SourcePlanningCoverage {
  development_plan_count: number;
  plan_item_count: number;
  uncovered: boolean;
}

interface DownstreamGateSummary {
  current_gate_counts: Record<string, number>;
  blocker_count: number;
}

interface TypedDocumentProjection {
  affected_modules?: readonly string[] | undefined;
  bug_refs?: readonly SourceRef[] | undefined;
  business_outcome?: string | undefined;
  child_refs?: readonly SourceRef[] | undefined;
  id: string;
  ref?: SourceRef | undefined;
  title?: string | undefined;
  status?: string | undefined;
  priority?: string | undefined;
  risk?: string | undefined;
  driver_actor_id?: string | undefined;
  updated_at?: string | undefined;
  planning_coverage?: SourcePlanningCoverage | undefined;
  downstream_gate_summary?: DownstreamGateSummary | undefined;
  last_meaningful_update_at?: string | undefined;
  next_action?: string | undefined;
  release_refs?: readonly SourceRef[] | undefined;
  relationship_refs?: readonly SourceRef[] | undefined;
  linked_development_plans?: readonly SourceRef[] | undefined;
  linked_plan_items?: readonly SourceRef[] | undefined;
  narrative_markdown?: string | undefined;
  expected_behavior?: string | undefined;
  milestone_intent?: string | undefined;
  observed_behavior?: string | undefined;
  release_coverage?: string | undefined;
  reproduction_steps?: readonly string[] | undefined;
  risk_rationale?: string | undefined;
  severity?: string | undefined;
  validation_strategy?: string | undefined;
}

export type TypedDocumentWorkspaceColumnField =
  | 'affectedModules'
  | 'businessOutcome'
  | 'childBugs'
  | 'childRequirements'
  | 'childTechDebt'
  | 'expectedBehavior'
  | 'fixPlanningCoverage'
  | 'milestoneIntent'
  | 'observedBehavior'
  | 'releaseCoverage'
  | 'remediationPlanningCoverage'
  | 'reproduction'
  | 'riskRationale'
  | 'severity'
  | 'validationStrategy';

export interface TypedDocumentWorkspaceColumn {
  field: TypedDocumentWorkspaceColumnField;
  header: string;
  key: string;
}

export interface TypedDocumentWorkspaceDefinition {
  createLabel: string;
  degradedSummary: string;
  detailNoun: string;
  driverLabel: string;
  emptyTitle: string;
  inspectorLabel: string;
  tableAriaLabel: string;
  typeSpecificColumns: TypedDocumentWorkspaceColumn[];
}

export interface TypedDocumentWorkspaceRow {
  id: string;
  title: string;
  href: string;
  status: string;
  priority: string;
  risk: string;
  driver: string;
  affectedModules?: string | undefined;
  businessOutcome?: string | undefined;
  childBugs?: string | undefined;
  childRequirements?: string | undefined;
  childTechDebt?: string | undefined;
  developmentPlanCoverage: string;
  expectedBehavior?: string | undefined;
  fixPlanningCoverage?: string | undefined;
  milestoneIntent?: string | undefined;
  observedBehavior?: string | undefined;
  planItemCoverage: string;
  planningCoverageState: 'covered' | 'uncovered' | 'unavailable';
  downstreamGateSummary: string;
  nextAction: string;
  lastMeaningfulUpdate: string;
  previewSummary: string;
  releaseCoverage?: string | undefined;
  releaseLinkState: 'linked' | 'unlinked' | 'unavailable';
  relatedObjects: string;
  remediationPlanningCoverage?: string | undefined;
  reproduction?: string | undefined;
  riskRationale?: string | undefined;
  releaseRefs: string;
  roleFilterState: 'driver present' | 'driver missing';
  searchText: string;
  severity?: string | undefined;
  validationStrategy?: string | undefined;
}

type TypedDocumentAdapter = {
  definition: TypedDocumentWorkspaceDefinition;
  row: (source: TypedDocumentProjection, href: string) => TypedDocumentWorkspaceRow;
};

export const requirementWorkspaceViewModel: TypedDocumentAdapter = createTypedDocumentAdapter({
  createLabel: 'Create Requirement',
  degradedSummary: 'Requirement data is incomplete.',
  detailNoun: 'Requirement',
  driverLabel: 'Requirement Driver',
  emptyTitle: 'No requirements match the current filters.',
  inspectorLabel: 'Requirement inspector',
  tableAriaLabel: 'Requirements workspace',
  typeSpecificColumns: [],
});

export const initiativeWorkspaceViewModel: TypedDocumentAdapter = createTypedDocumentAdapter({
  createLabel: 'Create Initiative',
  degradedSummary: 'Initiative data is incomplete.',
  detailNoun: 'Initiative',
  driverLabel: 'Initiative Driver',
  emptyTitle: 'No initiatives match the current filters.',
  inspectorLabel: 'Initiative inspector',
  tableAriaLabel: 'Initiatives workspace',
  typeSpecificColumns: [
    { key: 'business-outcome', header: 'Business outcome', field: 'businessOutcome' },
    { key: 'milestone-intent', header: 'Milestone intent', field: 'milestoneIntent' },
    { key: 'child-requirements', header: 'Child Requirements', field: 'childRequirements' },
    { key: 'child-bugs', header: 'Child Bugs', field: 'childBugs' },
    { key: 'child-tech-debt', header: 'Child Tech Debt', field: 'childTechDebt' },
    { key: 'release-coverage', header: 'Release coverage', field: 'releaseCoverage' },
  ],
});

export const bugWorkspaceViewModel: TypedDocumentAdapter = createTypedDocumentAdapter({
  createLabel: 'Create Bug',
  degradedSummary: 'Bug data is incomplete.',
  detailNoun: 'Bug',
  driverLabel: 'Bug Driver',
  emptyTitle: 'No bugs match the current filters.',
  inspectorLabel: 'Bug inspector',
  tableAriaLabel: 'Bugs workspace',
  typeSpecificColumns: [
    { key: 'observed-behavior', header: 'Observed behavior', field: 'observedBehavior' },
    { key: 'expected-behavior', header: 'Expected behavior', field: 'expectedBehavior' },
    { key: 'reproduction', header: 'Reproduction', field: 'reproduction' },
    { key: 'severity', header: 'Severity', field: 'severity' },
    { key: 'fix-planning-coverage', header: 'Fix planning coverage', field: 'fixPlanningCoverage' },
  ],
});

export const techDebtWorkspaceViewModel: TypedDocumentAdapter = createTypedDocumentAdapter({
  createLabel: 'Create Tech Debt',
  degradedSummary: 'Tech Debt data is incomplete.',
  detailNoun: 'Tech Debt',
  driverLabel: 'Tech Debt Driver',
  emptyTitle: 'No tech debt items match the current filters.',
  inspectorLabel: 'Tech Debt inspector',
  tableAriaLabel: 'Tech Debt workspace',
  typeSpecificColumns: [
    { key: 'affected-modules', header: 'Affected modules', field: 'affectedModules' },
    { key: 'risk-rationale', header: 'Risk rationale', field: 'riskRationale' },
    { key: 'validation-strategy', header: 'Validation strategy', field: 'validationStrategy' },
    { key: 'remediation-planning-coverage', header: 'Remediation planning coverage', field: 'remediationPlanningCoverage' },
  ],
});

function createTypedDocumentAdapter(definition: TypedDocumentWorkspaceDefinition): TypedDocumentAdapter {
  return {
    definition,
    row: (source, href) => typedDocumentWorkspaceRow(source, href, definition),
  };
}

function typedDocumentWorkspaceRow(
  source: TypedDocumentProjection,
  href: string,
  definition: TypedDocumentWorkspaceDefinition,
): TypedDocumentWorkspaceRow {
  const title = source.title ?? source.ref?.title ?? source.id;
  const developmentPlanCoverage = source.planning_coverage === undefined
    ? 'Unavailable'
    : `${source.planning_coverage.development_plan_count} linked`;
  const planItemCoverage = source.planning_coverage === undefined
    ? 'Unavailable'
    : `${source.planning_coverage.plan_item_count} governed`;
  const planningCoverageState = source.planning_coverage === undefined
    ? 'unavailable'
    : source.planning_coverage.uncovered
      ? 'uncovered'
      : 'covered';
  const downstreamGateSummary = formatDownstreamGateSummary(source.downstream_gate_summary);
  const nextAction = source.next_action ?? definition.degradedSummary;
  const lastMeaningfulUpdate = source.last_meaningful_update_at ?? source.updated_at;
  const releaseLinkState = source.release_refs === undefined ? 'unavailable' : source.release_refs.length > 0 ? 'linked' : 'unlinked';
  const roleFilterState = source.driver_actor_id === undefined ? 'driver missing' : 'driver present';
  const typeSpecificFields = typeSpecificRowFields(source);

  return {
    id: source.id,
    title,
    href,
    status: source.status ?? 'Unavailable',
    priority: source.priority ?? 'Unavailable',
    risk: source.risk ?? 'Unavailable',
    driver: source.driver_actor_id ?? 'Unavailable',
    developmentPlanCoverage,
    planItemCoverage,
    planningCoverageState,
    downstreamGateSummary,
    nextAction,
    lastMeaningfulUpdate: lastMeaningfulUpdate === undefined ? 'Unavailable' : `Updated ${lastMeaningfulUpdate}`,
    previewSummary: source.narrative_markdown ?? nextAction,
    relatedObjects: relatedObjectCount(source),
    releaseLinkState,
    releaseRefs: source.release_refs === undefined ? 'Unavailable' : String(source.release_refs.length),
    roleFilterState,
    ...typeSpecificFields,
    searchText: [
      title,
      source.status,
      source.priority,
      source.risk,
      source.driver_actor_id,
      developmentPlanCoverage,
      planItemCoverage,
      downstreamGateSummary,
      nextAction,
      lastMeaningfulUpdate,
      ...Object.values(typeSpecificFields),
    ]
      .filter((value): value is string => typeof value === 'string')
      .join(' ')
      .toLowerCase(),
  };
}

function formatDownstreamGateSummary(summary: DownstreamGateSummary | undefined): string {
  if (summary === undefined) return 'Unavailable';
  const activeGateCount = Object.values(summary.current_gate_counts).reduce((total, count) => total + count, 0);
  const blockerText = summary.blocker_count === 1 ? '1 blocker' : `${summary.blocker_count} blockers`;
  return `${activeGateCount} gates / ${blockerText}`;
}

function typeSpecificRowFields(source: TypedDocumentProjection): Partial<TypedDocumentWorkspaceRow> {
  const planningSummary = source.planning_coverage === undefined
    ? 'Unavailable'
    : `${source.planning_coverage.development_plan_count} linked / ${source.planning_coverage.plan_item_count} governed`;

  return {
    affectedModules: source.affected_modules === undefined ? 'Unavailable' : formatList(source.affected_modules),
    businessOutcome: source.business_outcome ?? 'Unavailable',
    childBugs: String(countRefsByType(source.child_refs, 'bug') + countRefsByType(source.bug_refs, 'bug')),
    childRequirements: String(countRefsByType(source.child_refs, 'requirement')),
    childTechDebt: String(countRefsByType(source.child_refs, 'tech_debt')),
    expectedBehavior: source.expected_behavior ?? 'Unavailable',
    fixPlanningCoverage: planningSummary,
    milestoneIntent: source.milestone_intent ?? 'Unavailable',
    observedBehavior: source.observed_behavior ?? 'Unavailable',
    releaseCoverage: source.release_coverage ?? (source.release_refs === undefined ? 'Unavailable' : `${source.release_refs.length} linked`),
    remediationPlanningCoverage: planningSummary,
    reproduction: source.reproduction_steps === undefined ? 'Unavailable' : formatList(source.reproduction_steps),
    riskRationale: source.risk_rationale ?? 'Unavailable',
    severity: source.severity ?? source.risk ?? 'Unavailable',
    validationStrategy: source.validation_strategy ?? 'Unavailable',
  };
}

function relatedObjectCount(source: TypedDocumentProjection): string {
  const relationshipRefs = source.relationship_refs ?? [];
  const planRefs = source.linked_development_plans ?? [];
  const itemRefs = source.linked_plan_items ?? [];
  if (
    source.relationship_refs === undefined ||
    source.linked_development_plans === undefined ||
    source.linked_plan_items === undefined
  ) {
    return 'Unavailable';
  }
  return String(relationshipRefs.length + planRefs.length + itemRefs.length);
}

function countRefsByType(refs: readonly SourceRef[] | undefined, type: string): number {
  return refs?.filter((ref) => ref.type === type).length ?? 0;
}

function formatList(values: readonly string[]): string {
  return values.length === 0 ? 'Unavailable' : values.join(', ');
}
