import { useNavigate, useParams } from 'react-router';

import { createForgeloopCommandApi } from '../../shared/api/commands';
import { useInitiativeQuery, useInitiativesQuery, useUpdateInitiativeNarrativeMutation } from '../../shared/api/hooks';
import { useActorContext } from '../../shared/context/actor-context';
import { useProjectContext } from '../../shared/context/project-context';
import { Section } from '../../shared/layout';
import { createNarrativeDocument, ObjectCreateForm } from '../project-management/object-forms';
import { ObjectDetailLayout } from '../project-management/object-detail-layout';
import { ObjectList } from '../project-management/object-list';

export function InitiativesRoute() {
  const { projectId } = useProjectContext();
  const query = useInitiativesQuery({ project_id: projectId, limit: 100 });

  return (
    <ObjectList
      createHref="/initiatives/new"
      detailHref={(item) => `/initiatives/${item.id}`}
      emptyMessage="No initiatives match the current filters."
      error={query.error}
      isLoading={query.isLoading}
      items={query.data?.items ?? []}
      planningHref="/development-plans/new"
      subtitle="Strategic work intake and breakdown readiness."
      title="Initiatives"
    />
  );
}

export function InitiativeDetailRoute() {
  const { initiativeId } = useParams();
  const query = useInitiativeQuery(initiativeId);
  const mutation = useUpdateInitiativeNarrativeMutation(initiativeId);

  return (
    <ObjectDetailLayout
      detail={query.data}
      error={query.error}
      isLoading={query.isLoading}
      objectLabel="Initiative"
      onSaveNarrative={async (document) => {
        await mutation.mutateAsync(document);
      }}
      renderSections={(detail) => (
        <Section title="Breakdown">
          <ul className="grid gap-2 text-sm text-text-secondary">
            {detail.child_refs.map((child) => <li key={`${child.type}:${child.id}`}>{`${child.type} ${child.id}`}</li>)}
            {detail.release_refs.map((release) => <li key={release.id}>{`Release ${release.id}`}</li>)}
          </ul>
        </Section>
      )}
    />
  );
}

export function NewInitiativeRoute() {
  const { actorId } = useActorContext();
  const { projectId } = useProjectContext();
  const navigate = useNavigate();

  return (
    <ObjectCreateForm
      cancelHref="/initiatives"
      fields={[
        { label: 'Business outcome', name: 'business_outcome', input: 'textarea', required: true },
        { label: 'Scope', name: 'scope', input: 'textarea', required: true },
        { label: 'Milestone intent', name: 'milestone_intent', input: 'textarea' },
        { label: 'Release intent', name: 'release_intent', input: 'textarea' },
        { label: 'Initiative Driver', name: 'driver_actor_id', input: 'input', defaultValue: actorId, required: true },
      ]}
      narrativeTemplate={'## Initiative narrative\n\nDescribe the coordination context and decision trail.'}
      objectType="initiative"
      onSubmit={async (values) => {
        const scopeLines = splitLines(values.scope);
        const milestoneIntent = emptyToUndefined(values.milestone_intent);
        const releaseIntent = emptyToUndefined(values.release_intent);
        const api = createForgeloopCommandApi();
        const created = await api.createInitiative({
          project_id: projectId,
          title: firstLine(values.business_outcome, 'New initiative'),
          goal: values.business_outcome ?? '',
          success_criteria: scopeLines,
          priority: 'P1',
          risk: 'medium',
          driver_actor_id: values.driver_actor_id ?? actorId,
          intake_context: {
            type: 'initiative',
            business_outcome: values.business_outcome ?? '',
            scope_narrative: values.scope ?? '',
            success_metrics: scopeLines,
            ...(milestoneIntent === undefined ? {} : { milestone_intent: milestoneIntent }),
            ...(releaseIntent === undefined ? {} : { cross_item_coordination_notes: releaseIntent }),
          },
        });
        await api.updateInitiativeNarrative(
          created.id,
          createNarrativeDocument({
            markdown: values.narrative_markdown,
            objectRef: { type: 'initiative', id: created.id, driver_actor_id: created.driver_actor_id },
          }),
        );
        void navigate('/initiatives');
      }}
      subtitle="Capture business context and breakdown intent."
      title="New Initiative"
    />
  );
}

function splitLines(value: string | undefined): string[] {
  return (value ?? '').split('\n').map((line) => line.trim()).filter(Boolean);
}

function firstLine(value: string | undefined, fallback: string): string {
  return splitLines(value)[0] ?? fallback;
}

function emptyToUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
