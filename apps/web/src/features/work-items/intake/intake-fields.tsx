import type { FieldErrors, FieldPath, UseFormRegister } from 'react-hook-form';

import { Input, Textarea } from '../../../shared/ui';
import type { CreateWorkItemVisibleFormValues } from './intake-model';
import type { WorkItemKind } from '../../../shared/api/types';

interface IntakeFieldsProps {
  kind: WorkItemKind;
  register: UseFormRegister<CreateWorkItemVisibleFormValues>;
  errors: FieldErrors<CreateWorkItemVisibleFormValues>;
}

export function IntakeFields({ kind, register, errors }: IntakeFieldsProps) {
  switch (kind) {
    case 'requirement':
      return (
        <div className="stack-form">
          <Field label="Stakeholder problem" name="intake.requirement.stakeholder_problem" register={register} errors={errors} />
          <Field label="Desired outcome" name="intake.requirement.desired_outcome" register={register} errors={errors} />
          <ListField label="Acceptance criteria" name="intake.requirement.acceptance_criteria" register={register} errors={errors} />
          <ListField label="In scope" name="intake.requirement.in_scope" register={register} errors={errors} />
          <ListField label="Out of scope" name="intake.requirement.out_of_scope" register={register} errors={errors} />
          <ListField label="Dependencies" name="intake.requirement.dependencies" register={register} errors={errors} />
          <TextAreaField label="Rollout notes" name="intake.requirement.rollout_notes" register={register} errors={errors} />
        </div>
      );
    case 'bug':
      return (
        <div className="stack-form">
          <Field label="Impact summary" name="intake.bug.impact_summary" register={register} errors={errors} />
          <TextAreaField label="Observed behavior" name="intake.bug.observed_behavior" register={register} errors={errors} />
          <TextAreaField label="Expected behavior" name="intake.bug.expected_behavior" register={register} errors={errors} />
          <ListField label="Reproduction steps" name="intake.bug.reproduction_steps" register={register} errors={errors} />
          <Field label="Affected environment" name="intake.bug.affected_environment" register={register} errors={errors} />
          <TextAreaField label="Verification path" name="intake.bug.verification_path" register={register} errors={errors} />
          <Field label="Suspected area" name="intake.bug.suspected_area" register={register} errors={errors} />
          <TextAreaField label="Regression risk" name="intake.bug.regression_risk" register={register} errors={errors} />
        </div>
      );
    case 'tech_debt':
      return (
        <div className="stack-form">
          <Field label="Current pain" name="intake.tech_debt.current_pain" register={register} errors={errors} />
          <Field label="Desired invariant" name="intake.tech_debt.desired_invariant" register={register} errors={errors} />
          <ListField label="Affected modules" name="intake.tech_debt.affected_modules" register={register} errors={errors} />
          <TextAreaField label="Behavior preservation" name="intake.tech_debt.behavior_preservation" register={register} errors={errors} />
          <TextAreaField label="Validation strategy" name="intake.tech_debt.validation_strategy" register={register} errors={errors} />
          <TextAreaField label="Migration constraints" name="intake.tech_debt.migration_constraints" register={register} errors={errors} />
          <TextAreaField label="Rollback notes" name="intake.tech_debt.rollback_notes" register={register} errors={errors} />
        </div>
      );
    case 'initiative':
      return (
        <div className="stack-form">
          <Field label="Business outcome" name="intake.initiative.business_outcome" register={register} errors={errors} />
          <TextAreaField label="Scope narrative" name="intake.initiative.scope_narrative" register={register} errors={errors} />
          <ListField label="Success metrics" name="intake.initiative.success_metrics" register={register} errors={errors} />
          <TextAreaField label="Milestone intent" name="intake.initiative.milestone_intent" register={register} errors={errors} />
          <TextAreaField
            label="Child breakdown assumptions"
            name="intake.initiative.child_breakdown_assumptions"
            register={register}
            errors={errors}
          />
          <TextAreaField label="Major risks" name="intake.initiative.major_risks" register={register} errors={errors} />
          <TextAreaField
            label="Cross-item coordination notes"
            name="intake.initiative.cross_item_coordination_notes"
            register={register}
            errors={errors}
          />
        </div>
      );
    default: {
      const exhaustive: never = kind;
      throw new Error(`Unsupported Work Item kind: ${exhaustive}`);
    }
  }
}

function Field({
  label,
  name,
  register,
  errors,
}: {
  label: string;
  name: FieldPath<CreateWorkItemVisibleFormValues>;
  register: UseFormRegister<CreateWorkItemVisibleFormValues>;
  errors: FieldErrors<CreateWorkItemVisibleFormValues>;
}) {
  const error = errorForPath(errors, name);
  return (
    <label>
      {label}
      <Input {...register(name)} invalid={Boolean(error)} />
      <FieldError message={error} />
    </label>
  );
}

function TextAreaField({
  label,
  name,
  register,
  errors,
}: {
  label: string;
  name: FieldPath<CreateWorkItemVisibleFormValues>;
  register: UseFormRegister<CreateWorkItemVisibleFormValues>;
  errors: FieldErrors<CreateWorkItemVisibleFormValues>;
}) {
  const error = errorForPath(errors, name);
  return (
    <label>
      {label}
      <Textarea {...register(name)} invalid={Boolean(error)} />
      <FieldError message={error} />
    </label>
  );
}

function ListField(props: {
  label: string;
  name: FieldPath<CreateWorkItemVisibleFormValues>;
  register: UseFormRegister<CreateWorkItemVisibleFormValues>;
  errors: FieldErrors<CreateWorkItemVisibleFormValues>;
}) {
  return <TextAreaField {...props} />;
}

function FieldError({ message }: { message: string | undefined }) {
  return message ? (
    <span className="danger-text" role="alert">
      {message}
    </span>
  ) : null;
}

function errorForPath(errors: FieldErrors<CreateWorkItemVisibleFormValues>, path: string): string | undefined {
  const value = path.split('.').reduce<unknown>((current, key) => {
    if (typeof current !== 'object' || current === null) return undefined;
    return (current as Record<string, unknown>)[key];
  }, errors);

  return typeof value === 'object' && value !== null && 'message' in value && typeof value.message === 'string'
    ? value.message
    : undefined;
}
