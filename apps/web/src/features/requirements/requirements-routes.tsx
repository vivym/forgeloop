import { useNavigate, useParams } from 'react-router';

import { createForgeloopCommandApi } from '../../shared/api/commands';
import { useRequirementQuery, useRequirementsQuery, useUpdateRequirementNarrativeMutation } from '../../shared/api/hooks';
import { useActorContext } from '../../shared/context/actor-context';
import { useProjectContext } from '../../shared/context/project-context';
import { Section } from '../../shared/layout';
import { createNarrativeDocument, ObjectCreateForm } from '../project-management/object-forms';
import { ObjectDetailLayout } from '../project-management/object-detail-layout';
import { ObjectList } from '../project-management/object-list';

export function RequirementsRoute() {
  const { projectId } = useProjectContext();
  const query = useRequirementsQuery({ project_id: projectId, limit: 100 });

  return (
    <ObjectList
      createHref="/requirements/new"
      detailHref={(item) => `/requirements/${item.id}`}
      emptyMessage="No requirements match the current filters."
      error={query.error}
      isLoading={query.isLoading}
      items={query.data?.items ?? []}
      subtitle="Requirement narratives, specs, plans, and evidence."
      title="Requirements"
    />
  );
}

export function RequirementDetailRoute() {
  const { requirementId } = useParams();
  const query = useRequirementQuery(requirementId);
  const mutation = useUpdateRequirementNarrativeMutation(requirementId);

  return (
    <ObjectDetailLayout
      detail={query.data}
      error={query.error}
      isLoading={query.isLoading}
      objectLabel="Requirement"
      onSaveNarrative={async (document) => {
        await mutation.mutateAsync(document);
      }}
      renderSections={(detail) => (
        <Section title="Planning links">
          <ul className="grid gap-2 text-sm text-text-secondary">
            {detail.spec_ref ? <li>{`Spec ${detail.spec_ref.id}`}</li> : null}
            {detail.plan_ref ? <li>{`Plan ${detail.plan_ref.id}`}</li> : null}
            {detail.task_refs.map((task) => <li key={task.id}>{`Task ${task.id}`}</li>)}
            {detail.bug_refs.map((bug) => <li key={bug.id}>{`Bug ${bug.id}`}</li>)}
          </ul>
        </Section>
      )}
    />
  );
}

export function NewRequirementRoute() {
  const { actorId } = useActorContext();
  const { projectId } = useProjectContext();
  const navigate = useNavigate();

  return (
    <ObjectCreateForm
      cancelHref="/requirements"
      fields={[
        { label: 'Stakeholder problem', name: 'stakeholder_problem', input: 'textarea', required: true },
        { label: 'Desired outcome', name: 'desired_outcome', input: 'textarea', required: true },
        { label: 'Acceptance criteria', name: 'acceptance_criteria', input: 'textarea', required: true },
        { label: 'In scope', name: 'in_scope', input: 'textarea', required: true },
        { label: 'Out of scope', name: 'out_of_scope', input: 'textarea' },
        { label: 'Requirement Driver', name: 'driver_actor_id', input: 'input', defaultValue: actorId, required: true },
      ]}
      narrativeTemplate={'## Requirement context\n\nDescribe the product narrative and evidence expectations.'}
      onSubmit={async (values) => {
        const acceptanceCriteria = splitLines(values.acceptance_criteria);
        const inScope = splitLines(values.in_scope);
        const outOfScope = splitOptionalLines(values.out_of_scope);
        const api = createForgeloopCommandApi();
        const created = await api.createRequirement({
          project_id: projectId,
          title: firstLine(values.stakeholder_problem, 'New requirement'),
          goal: values.desired_outcome ?? '',
          success_criteria: acceptanceCriteria,
          priority: 'P1',
          risk: 'medium',
          driver_actor_id: values.driver_actor_id ?? actorId,
          intake_context: {
            type: 'requirement',
            stakeholder_problem: values.stakeholder_problem ?? '',
            desired_outcome: values.desired_outcome ?? '',
            acceptance_criteria: acceptanceCriteria,
            in_scope: inScope,
            ...(outOfScope === undefined ? {} : { out_of_scope: outOfScope }),
          },
        });
        await api.updateRequirementNarrative(
          created.id,
          createNarrativeDocument({
            markdown: values.narrative_markdown,
            objectRef: { type: 'requirement', id: created.id, driver_actor_id: created.driver_actor_id },
          }),
        );
        void navigate('/requirements');
      }}
      subtitle="Capture a requirement narrative and delivery context."
      title="New Requirement"
    />
  );
}

function splitLines(value: string | undefined): string[] {
  return (value ?? '').split('\n').map((line) => line.trim()).filter(Boolean);
}

function splitOptionalLines(value: string | undefined): string[] | undefined {
  const lines = splitLines(value);
  return lines.length === 0 ? undefined : lines;
}

function firstLine(value: string | undefined, fallback: string): string {
  return splitLines(value)[0] ?? fallback;
}
