import type { ProductLaneId, WorkItemIntakeContext, WorkItemKind } from '../../../shared/api/types';

export const workItemKindLabels = {
  initiative: 'Initiative',
  requirement: 'Requirement',
  bug: 'Bug',
  tech_debt: 'Tech Debt',
} satisfies Record<WorkItemKind, string>;

export const defaultRiskByKind = {
  initiative: 'medium',
  requirement: 'medium',
  bug: 'high',
  tech_debt: 'medium',
} satisfies Record<WorkItemKind, string>;

export function laneForWorkItemKind(kind: WorkItemKind): ProductLaneId {
  switch (kind) {
    case 'requirement':
      return 'requirements';
    case 'bug':
      return 'bugs';
    case 'tech_debt':
      return 'tech-debt';
    case 'initiative':
      return 'initiatives';
    default: {
      const exhaustive: never = kind;
      throw new Error(`Unsupported Work Item kind: ${exhaustive}`);
    }
  }
}

export interface RequirementIntakeDraft {
  stakeholder_problem: string;
  desired_outcome: string;
  acceptance_criteria: string;
  in_scope: string;
  out_of_scope: string;
  dependencies: string;
  rollout_notes: string;
}

export interface BugIntakeDraft {
  impact_summary: string;
  observed_behavior: string;
  expected_behavior: string;
  reproduction_steps: string;
  affected_environment: string;
  verification_path: string;
  suspected_area: string;
  regression_risk: string;
}

export interface TechDebtIntakeDraft {
  current_pain: string;
  desired_invariant: string;
  affected_modules: string;
  behavior_preservation: string;
  validation_strategy: string;
  migration_constraints: string;
  rollback_notes: string;
}

export interface InitiativeIntakeDraft {
  business_outcome: string;
  scope_narrative: string;
  success_metrics: string;
  milestone_intent: string;
  child_breakdown_assumptions: string;
  major_risks: string;
  cross_item_coordination_notes: string;
}

export interface WorkItemIntakeDrafts {
  requirement: RequirementIntakeDraft;
  bug: BugIntakeDraft;
  tech_debt: TechDebtIntakeDraft;
  initiative: InitiativeIntakeDraft;
}

export interface CreateWorkItemVisibleFormValues {
  kind: WorkItemKind;
  title: string;
  priority: string;
  risk: string;
  intake: WorkItemIntakeDrafts;
}

export const defaultEmptyIntakeValues = {
  requirement: {
    stakeholder_problem: '',
    desired_outcome: '',
    acceptance_criteria: '',
    in_scope: '',
    out_of_scope: '',
    dependencies: '',
    rollout_notes: '',
  },
  bug: {
    impact_summary: '',
    observed_behavior: '',
    expected_behavior: '',
    reproduction_steps: '',
    affected_environment: '',
    verification_path: '',
    suspected_area: '',
    regression_risk: '',
  },
  tech_debt: {
    current_pain: '',
    desired_invariant: '',
    affected_modules: '',
    behavior_preservation: '',
    validation_strategy: '',
    migration_constraints: '',
    rollback_notes: '',
  },
  initiative: {
    business_outcome: '',
    scope_narrative: '',
    success_metrics: '',
    milestone_intent: '',
    child_breakdown_assumptions: '',
    major_risks: '',
    cross_item_coordination_notes: '',
  },
} satisfies WorkItemIntakeDrafts;

export function createDefaultIntakeDrafts(): WorkItemIntakeDrafts {
  return {
    requirement: { ...defaultEmptyIntakeValues.requirement },
    bug: { ...defaultEmptyIntakeValues.bug },
    tech_debt: { ...defaultEmptyIntakeValues.tech_debt },
    initiative: { ...defaultEmptyIntakeValues.initiative },
  };
}

export function normalizeList(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

export function normalizeIntakeDraft(kind: WorkItemKind, raw: WorkItemIntakeDrafts): WorkItemIntakeContext {
  switch (kind) {
    case 'requirement': {
      const draft = raw.requirement;
      return omitEmptyOptional({
        type: 'requirement',
        stakeholder_problem: requiredString(draft.stakeholder_problem),
        desired_outcome: requiredString(draft.desired_outcome),
        acceptance_criteria: normalizeList(draft.acceptance_criteria),
        in_scope: normalizeList(draft.in_scope),
        out_of_scope: optionalList(draft.out_of_scope),
        dependencies: optionalList(draft.dependencies),
        rollout_notes: optionalString(draft.rollout_notes),
      });
    }
    case 'bug': {
      const draft = raw.bug;
      return omitEmptyOptional({
        type: 'bug',
        impact_summary: requiredString(draft.impact_summary),
        observed_behavior: requiredString(draft.observed_behavior),
        expected_behavior: requiredString(draft.expected_behavior),
        reproduction_steps: normalizeList(draft.reproduction_steps),
        affected_environment: requiredString(draft.affected_environment),
        verification_path: requiredString(draft.verification_path),
        suspected_area: optionalString(draft.suspected_area),
        regression_risk: optionalString(draft.regression_risk),
      });
    }
    case 'tech_debt': {
      const draft = raw.tech_debt;
      return omitEmptyOptional({
        type: 'tech_debt',
        current_pain: requiredString(draft.current_pain),
        desired_invariant: requiredString(draft.desired_invariant),
        affected_modules: normalizeList(draft.affected_modules),
        behavior_preservation: requiredString(draft.behavior_preservation),
        validation_strategy: requiredString(draft.validation_strategy),
        migration_constraints: optionalString(draft.migration_constraints),
        rollback_notes: optionalString(draft.rollback_notes),
      });
    }
    case 'initiative': {
      const draft = raw.initiative;
      return omitEmptyOptional({
        type: 'initiative',
        business_outcome: requiredString(draft.business_outcome),
        scope_narrative: requiredString(draft.scope_narrative),
        success_metrics: normalizeList(draft.success_metrics),
        milestone_intent: optionalString(draft.milestone_intent),
        child_breakdown_assumptions: optionalString(draft.child_breakdown_assumptions),
        major_risks: optionalString(draft.major_risks),
        cross_item_coordination_notes: optionalString(draft.cross_item_coordination_notes),
      });
    }
    default: {
      const exhaustive: never = kind;
      throw new Error(`Unsupported Work Item kind: ${exhaustive}`);
    }
  }
}

export function deriveGoal(kind: WorkItemKind, intake: WorkItemIntakeContext): string {
  assertMatchingKind(kind, intake);
  switch (intake.type) {
    case 'requirement':
      return `${intake.stakeholder_problem}; desired outcome: ${intake.desired_outcome}`;
    case 'bug':
      return `${intake.impact_summary}; observed behavior: ${intake.observed_behavior}; expected behavior: ${intake.expected_behavior}`;
    case 'tech_debt':
      return `${intake.current_pain}; desired invariant: ${intake.desired_invariant}`;
    case 'initiative':
      return `${intake.business_outcome}; scope: ${intake.scope_narrative}`;
    default: {
      const exhaustive: never = intake;
      throw new Error(`Unsupported Work Item kind: ${exhaustive}`);
    }
  }
}

export function deriveSuccessCriteria(kind: WorkItemKind, intake: WorkItemIntakeContext): string[] {
  assertMatchingKind(kind, intake);
  switch (intake.type) {
    case 'requirement':
      return intake.acceptance_criteria;
    case 'bug':
      return [intake.expected_behavior, intake.verification_path];
    case 'tech_debt':
      return [intake.desired_invariant, intake.validation_strategy];
    case 'initiative':
      return intake.success_metrics;
    default: {
      const exhaustive: never = intake;
      throw new Error(`Unsupported Work Item kind: ${exhaustive}`);
    }
  }
}

function assertMatchingKind(kind: WorkItemKind, intake: WorkItemIntakeContext) {
  if (kind !== intake.type) {
    throw new Error('intake context type must match Work Item kind');
  }
}

function requiredString(value: string): string {
  return value.trim();
}

function optionalString(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function optionalList(value: string): string[] | undefined {
  const items = normalizeList(value);
  return items.length === 0 ? undefined : items;
}

function omitEmptyOptional<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}
