import type { WorkItemKind } from '@forgeloop/domain';

export interface WorkItemTypeMetadata {
  kind: WorkItemKind;
  label: string;
  description: string;
  required_fields: string[];
  default_priority: string;
  default_risk: string;
  spec_guidance: string;
  plan_guidance: string;
  role_hints: {
    approver?: string;
    execution_owner?: string;
    reviewer?: string;
    qa_owner?: string;
    release_owner?: string;
  };
}

const requiredFields = ['project_id', 'title', 'goal', 'success_criteria', 'priority', 'risk', 'owner_actor_id'];

export const workItemTypeMetadata: WorkItemTypeMetadata[] = [
  {
    kind: 'initiative',
    label: 'Initiative',
    description: 'A larger product or business outcome.',
    required_fields: requiredFields,
    default_priority: 'P1',
    default_risk: 'medium',
    spec_guidance: 'Define outcome, scope, and success criteria.',
    plan_guidance: 'Split into independently verifiable packages.',
    role_hints: {},
  },
  {
    kind: 'requirement',
    label: 'Requirement',
    description: 'A concrete product or engineering requirement.',
    required_fields: requiredFields,
    default_priority: 'P1',
    default_risk: 'medium',
    spec_guidance: 'Make acceptance criteria testable.',
    plan_guidance: 'Map implementation steps to checks.',
    role_hints: {},
  },
  {
    kind: 'bug',
    label: 'Bug',
    description: 'A defect or regression needing diagnosis and fix.',
    required_fields: requiredFields,
    default_priority: 'P0',
    default_risk: 'high',
    spec_guidance: 'Describe impact, reproduction, and expected behavior.',
    plan_guidance: 'Include regression coverage.',
    role_hints: { qa_owner: 'QA/Test Owner should confirm regression coverage.' },
  },
  {
    kind: 'tech_debt',
    label: 'Tech Debt',
    description: 'A maintainability or architecture improvement.',
    required_fields: requiredFields,
    default_priority: 'P2',
    default_risk: 'medium',
    spec_guidance: 'State current cost and desired invariant.',
    plan_guidance: 'Keep migration steps reversible.',
    role_hints: { reviewer: 'Reviewer should focus on behavior preservation.' },
  },
];
