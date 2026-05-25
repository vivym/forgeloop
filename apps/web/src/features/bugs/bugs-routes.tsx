import { useNavigate, useParams } from 'react-router';

import { createForgeloopCommandApi } from '../../shared/api/commands';
import { useBugQuery, useBugsQuery, useUpdateBugNarrativeMutation } from '../../shared/api/hooks';
import { useActorContext } from '../../shared/context/actor-context';
import { useProjectContext } from '../../shared/context/project-context';
import { Section } from '../../shared/layout';
import { createNarrativeDocument, ObjectCreateForm } from '../project-management/object-forms';
import { ObjectDetailLayout } from '../project-management/object-detail-layout';
import { ObjectList } from '../project-management/object-list';

export function BugsRoute() {
  const { projectId } = useProjectContext();
  const query = useBugsQuery({ project_id: projectId, limit: 100 });

  return (
    <ObjectList
      createHref="/bugs/new"
      detailHref={(item) => `/bugs/${item.id}`}
      emptyMessage="No bugs match the current filters."
      error={query.error}
      isLoading={query.isLoading}
      items={query.data?.items ?? []}
      planningHref="/development-plans/new"
      subtitle="Bug triage, repair planning, verification, and regression follow-up."
      title="Bugs"
    />
  );
}

export function BugDetailRoute() {
  const { bugId } = useParams();
  const query = useBugQuery(bugId);
  const mutation = useUpdateBugNarrativeMutation(bugId);

  return (
    <ObjectDetailLayout
      detail={query.data}
      error={query.error}
      isLoading={query.isLoading}
      objectLabel="Bug"
      onSaveNarrative={async (document) => {
        await mutation.mutateAsync(document);
      }}
      renderSections={(detail) => (
        <Section title="Reproduction">
          <div className="grid gap-3 text-sm text-text-secondary">
            <p>{detail.observed_behavior ?? 'Observed behavior not recorded.'}</p>
            <p>{detail.expected_behavior ?? 'Expected behavior not recorded.'}</p>
            <ol className="list-decimal pl-5">
              {detail.reproduction_steps.map((step) => <li key={step}>{step}</li>)}
            </ol>
          </div>
        </Section>
      )}
    />
  );
}

export function NewBugRoute() {
  const { actorId } = useActorContext();
  const { projectId } = useProjectContext();
  const navigate = useNavigate();

  return (
    <ObjectCreateForm
      cancelHref="/bugs"
      fields={[
        { label: 'Observed behavior', name: 'observed_behavior', input: 'textarea', required: true },
        { label: 'Expected behavior', name: 'expected_behavior', input: 'textarea', required: true },
        { label: 'Reproduction steps', name: 'reproduction_steps', input: 'textarea', required: true },
        { label: 'Environment', name: 'environment', input: 'input', required: true },
        { label: 'Severity', name: 'severity', input: 'input', defaultValue: 'high', required: true },
        { label: 'Suspected area', name: 'suspected_area', input: 'input' },
        { label: 'Verification path', name: 'verification_path', input: 'textarea', required: true },
        { label: 'Bug Driver', name: 'driver_actor_id', input: 'input', defaultValue: actorId, required: true },
      ]}
      narrativeTemplate={'## Bug narrative\n\nDescribe impact, diagnosis notes, and verification evidence.'}
      onSubmit={async (values) => {
        const suspectedArea = emptyToUndefined(values.suspected_area);
        const api = createForgeloopCommandApi();
        const created = await api.createBug({
          project_id: projectId,
          title: firstLine(values.observed_behavior, 'New bug'),
          goal: values.expected_behavior ?? '',
          success_criteria: splitLines(values.verification_path),
          priority: 'P0',
          risk: values.severity ?? 'high',
          driver_actor_id: values.driver_actor_id ?? actorId,
          intake_context: {
            type: 'bug',
            impact_summary: values.observed_behavior ?? '',
            observed_behavior: values.observed_behavior ?? '',
            expected_behavior: values.expected_behavior ?? '',
            reproduction_steps: splitLines(values.reproduction_steps),
            affected_environment: values.environment ?? '',
            verification_path: values.verification_path ?? '',
            ...(suspectedArea === undefined ? {} : { suspected_area: suspectedArea }),
          },
        });
        await api.updateBugNarrative(
          created.id,
          createNarrativeDocument({
            markdown: values.narrative_markdown,
            objectRef: { type: 'bug', id: created.id, driver_actor_id: created.driver_actor_id },
          }),
        );
        void navigate('/bugs');
      }}
      subtitle="Capture impact, reproduction, diagnosis, and verification path."
      title="New Bug"
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
