import { useNavigate, useParams } from 'react-router';

import { createForgeloopCommandApi } from '../../shared/api/commands';
import { useTechDebtDetailQuery, useTechDebtQuery, useUpdateTechDebtNarrativeMutation } from '../../shared/api/hooks';
import { useActorContext } from '../../shared/context/actor-context';
import { useProjectContext } from '../../shared/context/project-context';
import { Section } from '../../shared/layout';
import { createNarrativeDocument, ObjectCreateForm } from '../project-management/object-forms';
import { ObjectDetailLayout } from '../project-management/object-detail-layout';
import { ObjectList } from '../project-management/object-list';

export function TechDebtRoute() {
  const { projectId } = useProjectContext();
  const query = useTechDebtQuery({ project_id: projectId, limit: 100 });

  return (
    <ObjectList
      createHref="/tech-debt/new"
      detailHref={(item) => `/tech-debt/${item.id}`}
      emptyMessage="No tech debt items match the current filters."
      error={query.error}
      isLoading={query.isLoading}
      items={query.data?.items ?? []}
      planningHref="/development-plans/new"
      subtitle="Debt scoping, refactor planning, risk control, and validation."
      title="Tech Debt"
    />
  );
}

export function TechDebtDetailRoute() {
  const { techDebtId } = useParams();
  const query = useTechDebtDetailQuery(techDebtId);
  const mutation = useUpdateTechDebtNarrativeMutation(techDebtId);

  return (
    <ObjectDetailLayout
      detail={query.data}
      error={query.error}
      isLoading={query.isLoading}
      objectLabel="Tech Debt"
      onSaveNarrative={async (document) => {
        await mutation.mutateAsync(document);
      }}
      renderSections={(detail) => (
        <Section title="Validation context">
          <div className="grid gap-2 text-sm text-text-secondary">
            <p>{detail.validation_strategy ?? 'Validation strategy not recorded.'}</p>
            <p>{`Affected modules: ${detail.affected_modules.join(', ') || 'None recorded'}`}</p>
          </div>
        </Section>
      )}
    />
  );
}

export function NewTechDebtRoute() {
  const { actorId } = useActorContext();
  const { projectId } = useProjectContext();
  const navigate = useNavigate();

  return (
    <ObjectCreateForm
      cancelHref="/tech-debt"
      fields={[
        { label: 'Current pain', name: 'current_pain', input: 'textarea', required: true },
        { label: 'Desired invariant', name: 'desired_invariant', input: 'textarea', required: true },
        { label: 'Affected modules', name: 'affected_modules', input: 'textarea', required: true },
        { label: 'Validation strategy', name: 'validation_strategy', input: 'textarea', required: true },
        { label: 'Release impact', name: 'release_impact', input: 'textarea' },
        { label: 'Tech Debt Driver', name: 'driver_actor_id', input: 'input', defaultValue: actorId, required: true },
      ]}
      narrativeTemplate={'## Refactor narrative\n\nDescribe constraints, behavior preservation, and evidence needs.'}
      onSubmit={async (values) => {
        const rollbackNotes = emptyToUndefined(values.release_impact);
        const api = createForgeloopCommandApi();
        const created = await api.createTechDebt({
          project_id: projectId,
          title: firstLine(values.current_pain, 'New tech debt'),
          goal: values.desired_invariant ?? '',
          success_criteria: splitLines(values.validation_strategy),
          priority: 'P2',
          risk: 'medium',
          driver_actor_id: values.driver_actor_id ?? actorId,
          intake_context: {
            type: 'tech_debt',
            current_pain: values.current_pain ?? '',
            desired_invariant: values.desired_invariant ?? '',
            affected_modules: splitLines(values.affected_modules),
            behavior_preservation: values.desired_invariant ?? '',
            validation_strategy: values.validation_strategy ?? '',
            ...(rollbackNotes === undefined ? {} : { rollback_notes: rollbackNotes }),
          },
        });
        await api.updateTechDebtNarrative(
          created.id,
          createNarrativeDocument({
            markdown: values.narrative_markdown,
            objectRef: { type: 'tech_debt', id: created.id, driver_actor_id: created.driver_actor_id },
          }),
        );
        void navigate('/tech-debt');
      }}
      subtitle="Capture refactor intent and validation boundaries."
      title="New Tech Debt"
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
