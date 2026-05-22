import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useNavigate } from 'react-router';
import { z } from 'zod';

import { createWorkItemRequestSchema } from '@forgeloop/contracts';
import { createForgeloopCommandApi } from '../../shared/api/commands';
import type { CreateWorkItemBody, WorkItemKind } from '../../shared/api/types';
import { useActorContext } from '../../shared/context/actor-context';
import { useProjectContext } from '../../shared/context/project-context';
import { InlineActions, Metric, MetricGrid, PageHeader, Section } from '../../shared/layout';
import { Button, Field, InlineNotice, Input, Select } from '../../shared/ui';
import { IntakeFields } from './intake/intake-fields';
import {
  createDefaultIntakeDrafts,
  defaultEmptyIntakeValues,
  defaultRiskByKind,
  deriveGoal,
  deriveSuccessCriteria,
  laneForWorkItemKind,
  normalizeIntakeDraft,
  normalizeList,
  workItemKindLabels,
  type CreateWorkItemVisibleFormValues,
} from './intake/intake-model';

const workItemKindValues = ['requirement', 'bug', 'tech_debt', 'initiative'] as const satisfies readonly WorkItemKind[];

const createWorkItemVisibleFormSchema = z
  .object({
    kind: z.enum(workItemKindValues),
    title: z.string().trim().min(1, 'Title is required.'),
    priority: z.string().trim().min(1, 'Priority is required.'),
    risk: z.string().trim().min(1, 'Risk is required.'),
    intake: z.object({
      requirement: z.object({
        stakeholder_problem: z.string(),
        desired_outcome: z.string(),
        acceptance_criteria: z.string(),
        in_scope: z.string(),
        out_of_scope: z.string(),
        dependencies: z.string(),
        rollout_notes: z.string(),
      }),
      bug: z.object({
        impact_summary: z.string(),
        observed_behavior: z.string(),
        expected_behavior: z.string(),
        reproduction_steps: z.string(),
        affected_environment: z.string(),
        verification_path: z.string(),
        suspected_area: z.string(),
        regression_risk: z.string(),
      }),
      tech_debt: z.object({
        current_pain: z.string(),
        desired_invariant: z.string(),
        affected_modules: z.string(),
        behavior_preservation: z.string(),
        validation_strategy: z.string(),
        migration_constraints: z.string(),
        rollback_notes: z.string(),
      }),
      initiative: z.object({
        business_outcome: z.string(),
        scope_narrative: z.string(),
        success_metrics: z.string(),
        milestone_intent: z.string(),
        child_breakdown_assumptions: z.string(),
        major_risks: z.string(),
        cross_item_coordination_notes: z.string(),
      }),
    }),
  })
  .superRefine((values, ctx) => {
    switch (values.kind) {
      case 'requirement':
        requireText(ctx, ['intake', 'requirement', 'stakeholder_problem'], values.intake.requirement.stakeholder_problem, 'Stakeholder problem');
        requireText(ctx, ['intake', 'requirement', 'desired_outcome'], values.intake.requirement.desired_outcome, 'Desired outcome');
        requireList(ctx, ['intake', 'requirement', 'acceptance_criteria'], values.intake.requirement.acceptance_criteria, 'Acceptance criteria');
        requireList(ctx, ['intake', 'requirement', 'in_scope'], values.intake.requirement.in_scope, 'In scope');
        return;
      case 'bug':
        requireText(ctx, ['intake', 'bug', 'impact_summary'], values.intake.bug.impact_summary, 'Impact summary');
        requireText(ctx, ['intake', 'bug', 'observed_behavior'], values.intake.bug.observed_behavior, 'Observed behavior');
        requireText(ctx, ['intake', 'bug', 'expected_behavior'], values.intake.bug.expected_behavior, 'Expected behavior');
        requireList(ctx, ['intake', 'bug', 'reproduction_steps'], values.intake.bug.reproduction_steps, 'Reproduction steps');
        requireText(ctx, ['intake', 'bug', 'affected_environment'], values.intake.bug.affected_environment, 'Affected environment');
        requireText(ctx, ['intake', 'bug', 'verification_path'], values.intake.bug.verification_path, 'Verification path');
        return;
      case 'tech_debt':
        requireText(ctx, ['intake', 'tech_debt', 'current_pain'], values.intake.tech_debt.current_pain, 'Current pain');
        requireText(ctx, ['intake', 'tech_debt', 'desired_invariant'], values.intake.tech_debt.desired_invariant, 'Desired invariant');
        requireList(ctx, ['intake', 'tech_debt', 'affected_modules'], values.intake.tech_debt.affected_modules, 'Affected modules');
        requireText(ctx, ['intake', 'tech_debt', 'behavior_preservation'], values.intake.tech_debt.behavior_preservation, 'Behavior preservation');
        requireText(ctx, ['intake', 'tech_debt', 'validation_strategy'], values.intake.tech_debt.validation_strategy, 'Validation strategy');
        return;
      case 'initiative':
        requireText(ctx, ['intake', 'initiative', 'business_outcome'], values.intake.initiative.business_outcome, 'Business outcome');
        requireText(ctx, ['intake', 'initiative', 'scope_narrative'], values.intake.initiative.scope_narrative, 'Scope narrative');
        requireList(ctx, ['intake', 'initiative', 'success_metrics'], values.intake.initiative.success_metrics, 'Success metrics');
        return;
      default: {
        const exhaustive: never = values.kind;
        throw new Error(`Unsupported Work Item kind: ${exhaustive}`);
      }
    }
  });

export function CreateWorkItemForm() {
  const navigate = useNavigate();
  const { projectId } = useProjectContext();
  const { actorId } = useActorContext();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const previousKind = useRef<WorkItemKind>('requirement');
  const riskEdited = useRef(false);
  const form = useForm<CreateWorkItemVisibleFormValues>({
    resolver: zodResolver(createWorkItemVisibleFormSchema),
    defaultValues: {
      kind: 'requirement',
      title: '',
      priority: 'P1',
      risk: defaultRiskByKind.requirement,
      intake: createDefaultIntakeDrafts(),
    },
  });
  const kind = useWatch({ control: form.control, name: 'kind' });
  const intake = useWatch({ control: form.control, name: 'intake' });

  useEffect(() => {
    if (kind === previousKind.current) return;

    form.setValue(`intake.${kind}`, { ...defaultEmptyIntakeValues[kind] }, { shouldDirty: false, shouldValidate: false });
    if (!riskEdited.current) {
      form.setValue('risk', defaultRiskByKind[kind], { shouldDirty: false, shouldValidate: true });
    }
    previousKind.current = kind;
  }, [form, kind]);

  const preview = useMemo(() => {
    try {
      const normalized = normalizeIntakeDraft(kind, intake);
      return {
        goal: deriveGoal(kind, normalized),
        successCriteria: deriveSuccessCriteria(kind, normalized),
      };
    } catch {
      return { goal: '', successCriteria: [] };
    }
  }, [intake, kind]);

  const onSubmit = form.handleSubmit(async (values) => {
    setSubmitError(null);
    try {
      const intakeContext = normalizeIntakeDraft(values.kind, values.intake);
      const body: CreateWorkItemBody = createWorkItemRequestSchema.parse({
        project_id: projectId,
        kind: values.kind,
        title: values.title,
        goal: deriveGoal(values.kind, intakeContext),
        success_criteria: deriveSuccessCriteria(values.kind, intakeContext),
        priority: values.priority,
        risk: values.risk,
        driver_actor_id: actorId,
        intake_context: intakeContext,
      });
      const created = await createForgeloopCommandApi().createWorkItem(body);
      navigate(`/work-items/${encodeURIComponent(created.id)}?lane=${laneForWorkItemKind(values.kind)}`);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Could not create the work item.');
    }
  });

  const riskRegistration = form.register('risk', {
    onChange: () => {
      riskEdited.current = true;
    },
  });

  return (
    <>
      <PageHeader subtitle="Capture typed intake context and the expected validation outcome." title="New Work Item" />
      <Section title="Create work item">
        <form className="grid gap-5" onSubmit={(event) => void onSubmit(event)}>
          <div aria-label="Product context">
            <MetricGrid>
              <Metric label="Workspace" value="Current project" />
              <Metric label="Driver" value="Signed-in driver" />
            </MetricGrid>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Kind">
              <Select
                {...form.register('kind')}
                options={workItemKindValues.map((value) => ({ label: workItemKindLabels[value], value }))}
              />
            </Field>
            <Field error={form.formState.errors.priority?.message} label="Priority">
              <Input {...form.register('priority')} invalid={Boolean(form.formState.errors.priority)} />
            </Field>
            <Field error={form.formState.errors.risk?.message} label="Risk">
              <Input {...riskRegistration} invalid={Boolean(form.formState.errors.risk)} />
            </Field>
          </div>
          <Field error={form.formState.errors.title?.message} label="Title">
            <Input {...form.register('title')} invalid={Boolean(form.formState.errors.title)} />
          </Field>
          <IntakeFields kind={kind} register={form.register} errors={form.formState.errors} />
          {preview.goal || preview.successCriteria.length > 0 ? (
            <div aria-label="Derived Work Item brief">
              <MetricGrid>
                <Metric label="Derived goal" value={preview.goal || 'Add intake context'} />
                <Metric
                  label="Derived criteria"
                  value={preview.successCriteria.length > 0 ? preview.successCriteria.join('; ') : 'Add required outcomes'}
                />
              </MetricGrid>
            </div>
          ) : null}
          {submitError ? <InlineNotice title={submitError} tone="danger" /> : null}
          <InlineActions>
            <Button loading={form.formState.isSubmitting} type="submit" variant="primary">
              Create Work Item
            </Button>
            <Button onClick={() => navigate('/work-items')} variant="ghost">
              Cancel
            </Button>
          </InlineActions>
        </form>
      </Section>
    </>
  );
}

function requireText(ctx: z.RefinementCtx, path: (string | number)[], value: string, label: string) {
  if (value.trim().length === 0) {
    ctx.addIssue({ code: 'custom', path, message: `${label} is required.` });
  }
}

function requireList(ctx: z.RefinementCtx, path: (string | number)[], value: string, label: string) {
  if (normalizeList(value).length === 0) {
    ctx.addIssue({ code: 'custom', path, message: `${label} is required.` });
  }
}
