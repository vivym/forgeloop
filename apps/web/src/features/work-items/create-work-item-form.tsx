import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router';
import { z } from 'zod';

import { createForgeloopCommandApi } from '../../shared/api/commands';
import type { CreateWorkItemBody } from '../../shared/api/types';
import { useActorContext } from '../../shared/context/actor-context';
import { useProjectContext } from '../../shared/context/project-context';
import { PageHeader, Section } from '../../shared/layout';
import { Button, Input, Select, Textarea } from '../../shared/ui';

const createWorkItemFormSchema = z.object({
  project_id: z.string().min(1),
  kind: z.enum(['initiative', 'requirement', 'bug', 'tech_debt']),
  title: z.string().min(1),
  goal: z.string().min(1),
  success_criteria: z.array(z.string().min(1)).min(1),
  priority: z.string().min(1),
  risk: z.string().min(1),
  owner_actor_id: z.string().min(1),
  raw_request: z.string().optional(),
});

type CreateWorkItemFormValues = z.infer<typeof createWorkItemFormSchema>;
type CreateWorkItemVisibleFormValues = Omit<CreateWorkItemFormValues, 'project_id' | 'owner_actor_id'>;

const toCommandBody = (values: CreateWorkItemFormValues): CreateWorkItemBody => ({
  project_id: values.project_id,
  kind: values.kind,
  title: values.title,
  goal: values.goal,
  success_criteria: values.success_criteria,
  priority: values.priority,
  risk: values.risk,
  owner_actor_id: values.owner_actor_id,
});

export function CreateWorkItemForm() {
  const navigate = useNavigate();
  const { projectId } = useProjectContext();
  const { actorId } = useActorContext();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const visibleFormSchema = createWorkItemFormSchema.omit({ project_id: true, owner_actor_id: true });
  const form = useForm<CreateWorkItemVisibleFormValues>({
    resolver: zodResolver(visibleFormSchema),
    defaultValues: {
      kind: 'requirement',
      title: '',
      goal: '',
      success_criteria: [''],
      priority: 'P1',
      risk: 'medium',
      raw_request: '',
    },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setSubmitError(null);
    try {
      const payload = createWorkItemFormSchema.parse({
        ...values,
        project_id: projectId,
        owner_actor_id: actorId,
      });
      const created = await createForgeloopCommandApi().createWorkItem(toCommandBody(payload));
      navigate(`/work-items/${encodeURIComponent(created.id)}`);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Could not create the work item.');
    }
  });

  return (
    <>
      <PageHeader subtitle="Capture the owner brief and the validation outcome expected from the work item." title="New Work Item" />
      <Section title="Create work item">
        <form className="stack-form" onSubmit={(event) => void onSubmit(event)}>
          <div className="state-grid" aria-label="Product context">
            <ContextMetric label="Workspace" value="Current project" />
            <ContextMetric label="Owner" value="Signed-in work item owner" />
          </div>
          <div className="form-grid two">
            <label>
              Kind
              <Select
                {...form.register('kind')}
                options={[
                  { label: 'Initiative', value: 'initiative' },
                  { label: 'Requirement', value: 'requirement' },
                  { label: 'Bug', value: 'bug' },
                  { label: 'Tech debt', value: 'tech_debt' },
                ]}
              />
            </label>
            <label>
              Priority
              <Input {...form.register('priority')} invalid={Boolean(form.formState.errors.priority)} />
            </label>
            <label>
              Risk
              <Input {...form.register('risk')} invalid={Boolean(form.formState.errors.risk)} />
            </label>
          </div>
          <label>
            Title
            <Input {...form.register('title')} invalid={Boolean(form.formState.errors.title)} />
          </label>
          <label>
            Goal
            <Textarea {...form.register('goal')} invalid={Boolean(form.formState.errors.goal)} />
          </label>
          <label>
            Success criteria
            <Textarea
              invalid={Boolean(form.formState.errors.success_criteria)}
              onChange={(event) =>
                form.setValue(
                  'success_criteria',
                  event.target.value
                    .split('\n')
                    .map((line) => line.trim())
                    .filter(Boolean),
                  { shouldValidate: true },
                )
              }
              placeholder="One criterion per line"
            />
          </label>
          <label>
            Source request
            <Textarea {...form.register('raw_request')} placeholder="Optional context from the request, email, or ticket." />
          </label>
          {submitError ? <p className="danger-text">{submitError}</p> : null}
          <div className="button-row">
            <Button loading={form.formState.isSubmitting} type="submit" variant="primary">
              Create Work Item
            </Button>
            <Button onClick={() => navigate('/work-items')} variant="ghost">
              Cancel
            </Button>
          </div>
        </form>
      </Section>
    </>
  );
}

function ContextMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
