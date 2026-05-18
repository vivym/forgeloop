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
  const form = useForm<CreateWorkItemFormValues>({
    resolver: zodResolver(createWorkItemFormSchema),
    defaultValues: {
      project_id: projectId,
      kind: 'requirement',
      title: '',
      goal: '',
      success_criteria: [''],
      priority: 'P1',
      risk: 'medium',
      owner_actor_id: actorId,
      raw_request: '',
    },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setSubmitError(null);
    try {
      const created = await createForgeloopCommandApi().createWorkItem(toCommandBody(values));
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
          <div className="form-grid two">
            <label>
              Project
              <Input {...form.register('project_id')} invalid={Boolean(form.formState.errors.project_id)} />
            </label>
            <label>
              Owner
              <Input {...form.register('owner_actor_id')} invalid={Boolean(form.formState.errors.owner_actor_id)} />
            </label>
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
