import { describe, expect, it } from 'vitest';

import {
  createWorkItemRequestSchema,
  patchWorkItemRequestSchema,
  publicWorkItemSchema,
  workItemIntakeContextSchema,
} from '@forgeloop/contracts';

const validRequirementIntake = {
  type: 'requirement',
  stakeholder_problem: 'Stakeholders cannot tell whether checkout is healthy.',
  desired_outcome: 'Checkout health is visible before each release.',
  acceptance_criteria: ['Dashboard shows checkout health'],
  in_scope: ['Checkout status summary'],
} as const;

const validBugIntake = {
  type: 'bug',
  impact_summary: 'Checkout fails',
  observed_behavior: 'Submit returns 500',
  expected_behavior: 'Order is created',
  reproduction_steps: ['Sign in', 'Submit checkout'],
  affected_environment: 'production',
  verification_path: 'Regression test',
} as const;

const validTechDebtIntake = {
  type: 'tech_debt',
  current_pain: 'Checkout orchestration is duplicated.',
  desired_invariant: 'Checkout state transitions have one owner.',
  affected_modules: ['checkout-api'],
  behavior_preservation: 'Existing checkout behavior remains unchanged.',
  validation_strategy: 'Run checkout regression tests.',
} as const;

const validInitiativeIntake = {
  type: 'initiative',
  business_outcome: 'Reduce checkout incident response time.',
  scope_narrative: 'Coordinate observability and recovery improvements.',
  success_metrics: ['Mean time to detect drops below five minutes'],
} as const;

const validRequirementCreate = {
  project_id: 'project-1',
  kind: 'requirement',
  title: 'Checkout health dashboard',
  goal: 'Expose checkout health',
  success_criteria: ['Dashboard is visible'],
  priority: 'P1',
  risk: 'medium',
  driver_actor_id: 'actor-driver',
  intake_context: validRequirementIntake,
} as const;

const validPublicWorkItem = {
  id: 'work-item-1',
  project_id: 'project-1',
  kind: 'bug',
  title: 'Checkout fails',
  goal: 'Fix checkout',
  success_criteria: ['Regression passes'],
  priority: 'P0',
  risk: 'high',
  driver_actor_id: 'actor-driver',
  intake_context: validBugIntake,
  phase: 'triage',
  activity_state: 'idle',
  gate_state: 'none',
  resolution: 'none',
} as const;

describe('Work Item intake contracts', () => {
  it('normalizes trimmed bug intake context fields', () => {
    expect(
      workItemIntakeContextSchema.parse({
        type: 'bug',
        impact_summary: ' Checkout fails ',
        observed_behavior: 'Submit returns 500',
        expected_behavior: 'Order is created',
        reproduction_steps: [' Sign in ', '', 'Submit checkout'],
        affected_environment: 'production',
        verification_path: 'Regression test',
      }),
    ).toMatchObject({
      type: 'bug',
      impact_summary: 'Checkout fails',
      reproduction_steps: ['Sign in', 'Submit checkout'],
    });
  });

  it('parses all intake context variants', () => {
    expect(workItemIntakeContextSchema.parse(validRequirementIntake)).toEqual(validRequirementIntake);
    expect(workItemIntakeContextSchema.parse(validBugIntake)).toEqual(validBugIntake);
    expect(workItemIntakeContextSchema.parse(validTechDebtIntake)).toEqual(validTechDebtIntake);
    expect(workItemIntakeContextSchema.parse(validInitiativeIntake)).toEqual(validInitiativeIntake);
  });

  it('rejects missing required intake fields', () => {
    expect(
      workItemIntakeContextSchema.safeParse({
        ...validRequirementIntake,
        desired_outcome: undefined,
      }).success,
    ).toBe(false);
    expect(
      workItemIntakeContextSchema.safeParse({
        ...validBugIntake,
        affected_environment: undefined,
      }).success,
    ).toBe(false);
  });

  it('rejects required arrays that are empty after trimming', () => {
    expect(
      workItemIntakeContextSchema.safeParse({
        ...validBugIntake,
        reproduction_steps: [' ', ''],
      }).success,
    ).toBe(false);
    expect(
      createWorkItemRequestSchema.safeParse({
        ...validRequirementCreate,
        success_criteria: [' ', ''],
      }).success,
    ).toBe(false);
  });

  it('rejects owner_actor_id on create requests', () => {
    expect(
      createWorkItemRequestSchema.safeParse({
        project_id: 'project-1',
        kind: 'bug',
        title: 'Checkout fails',
        goal: 'Fix checkout',
        success_criteria: ['Regression passes'],
        priority: 'P0',
        risk: 'high',
        driver_actor_id: 'actor-driver',
        owner_actor_id: 'actor-owner',
        intake_context: validBugIntake,
      }).success,
    ).toBe(false);
  });

  it('requires create request kind to match intake context type', () => {
    expect(
      createWorkItemRequestSchema.safeParse({
        ...validRequirementCreate,
        kind: 'bug',
        intake_context: validRequirementIntake,
      }).success,
    ).toBe(false);
  });

  it('normalizes valid create requests', () => {
    expect(
      createWorkItemRequestSchema.parse({
        ...validRequirementCreate,
        title: ' Checkout health dashboard ',
        success_criteria: [' Dashboard is visible ', ''],
      }),
    ).toMatchObject({
      title: 'Checkout health dashboard',
      success_criteria: ['Dashboard is visible'],
    });
  });

  it('accepts driver_actor_id and rejects owner_actor_id on patch requests', () => {
    expect(
      patchWorkItemRequestSchema.safeParse({
        driver_actor_id: 'actor-driver',
      }).success,
    ).toBe(true);
    expect(
      patchWorkItemRequestSchema.safeParse({
        owner_actor_id: 'actor-owner',
      }).success,
    ).toBe(false);
  });

  it('requires patch request kind to match intake context type when both are provided', () => {
    expect(
      patchWorkItemRequestSchema.safeParse({
        kind: 'bug',
        intake_context: validRequirementIntake,
      }).success,
    ).toBe(false);
    expect(
      patchWorkItemRequestSchema.safeParse({
        kind: 'bug',
        intake_context: validBugIntake,
      }).success,
    ).toBe(true);
  });

  it('requires driver_actor_id and intake_context on public Work Items', () => {
    expect(publicWorkItemSchema.safeParse(validPublicWorkItem).success).toBe(true);
    expect(
      publicWorkItemSchema.safeParse({
        ...validPublicWorkItem,
        driver_actor_id: undefined,
      }).success,
    ).toBe(false);
    expect(
      publicWorkItemSchema.safeParse({
        ...validPublicWorkItem,
        intake_context: undefined,
      }).success,
    ).toBe(false);
    expect(
      publicWorkItemSchema.safeParse({
        ...validPublicWorkItem,
        owner_actor_id: 'actor-owner',
      }).success,
    ).toBe(false);
  });
});
