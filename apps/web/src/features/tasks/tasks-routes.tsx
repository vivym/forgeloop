import { useNavigate, useParams } from 'react-router';
import type { ObjectRef } from '@forgeloop/contracts';

import { createForgeloopCommandApi } from '../../shared/api/commands';
import { useTaskQuery, useTasksQuery, useUpdateTaskNarrativeMutation } from '../../shared/api/hooks';
import { useActorContext } from '../../shared/context/actor-context';
import { useProjectContext } from '../../shared/context/project-context';
import { Section } from '../../shared/layout';
import { appendNarrativeSection, createNarrativeDocument, ObjectCreateForm } from '../project-management/object-forms';
import { ObjectDetailLayout } from '../project-management/object-detail-layout';
import { ObjectList } from '../project-management/object-list';

export function TasksRoute() {
  const { projectId } = useProjectContext();
  const query = useTasksQuery({ project_id: projectId, limit: 100 });

  return (
    <ObjectList
      createHref="/tasks/new"
      detailHref={(item) => `/tasks/${item.id}`}
      emptyMessage="No tasks match the current filters."
      error={query.error}
      isLoading={query.isLoading}
      items={query.data?.items ?? []}
      subtitle="Execution work, task evidence, runs, and reviews."
      title="Tasks"
    />
  );
}

export function TaskDetailRoute() {
  const { taskId } = useParams();
  const query = useTaskQuery(taskId);
  const mutation = useUpdateTaskNarrativeMutation(taskId);

  return (
    <ObjectDetailLayout
      detail={query.data}
      error={query.error}
      isLoading={query.isLoading}
      objectLabel="Task"
      onSaveNarrative={async (document) => {
        await mutation.mutateAsync(document);
      }}
      renderSections={(detail) => (
        <Section title="Execution checklist">
          <ul className="grid gap-2 text-sm text-text-secondary">
            {detail.acceptance_checklist.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </Section>
      )}
    />
  );
}

export function NewTaskRoute() {
  const { actorId } = useActorContext();
  const { projectId } = useProjectContext();
  const navigate = useNavigate();

  return (
    <ObjectCreateForm
      cancelHref="/tasks"
      fields={[
        { label: 'Execution brief', name: 'execution_brief', input: 'textarea', required: true },
        { label: 'Acceptance checklist', name: 'acceptance_checklist', input: 'textarea', required: true },
        { label: 'Parent context', name: 'parent_context', input: 'input' },
        { label: 'Repo/package readiness context', name: 'readiness_context', input: 'textarea' },
      ]}
      narrativeTemplate={'## Task narrative\n\nDescribe implementation notes, validation evidence, and handoff context.'}
      onSubmit={async (values) => {
        const api = createForgeloopCommandApi();
        const parentRef = parseParentRef(values.parent_context);
        const created = await api.createTask({
          project_id: projectId,
          title: firstLine(values.execution_brief, 'New task'),
          execution_brief: values.execution_brief ?? '',
          acceptance_checklist: splitLines(values.acceptance_checklist),
          ...(parentRef === undefined ? {} : { parent_ref: parentRef }),
          actor_id: actorId,
        });
        await api.updateTaskNarrative(
          created.id,
          createNarrativeDocument({
            markdown: appendNarrativeSection(values.narrative_markdown, 'Repo/package readiness context', values.readiness_context),
            objectRef: { type: 'task', id: created.id },
          }),
        );
        void navigate('/tasks');
      }}
      subtitle="Capture concrete implementation work and validation checklist."
      title="New Task"
    />
  );
}

function splitLines(value: string | undefined): string[] {
  return (value ?? '').split('\n').map((line) => line.trim()).filter(Boolean);
}

function firstLine(value: string | undefined, fallback: string): string {
  return splitLines(value)[0] ?? fallback;
}

function parseParentRef(value: string | undefined): ObjectRef | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  const [type, id] = trimmed.includes(':') ? trimmed.split(':', 2) : ['requirement', trimmed];
  if (!id) return undefined;
  if (type === 'requirement' || type === 'initiative' || type === 'tech_debt' || type === 'bug' || type === 'task') {
    return { type, id };
  }
  return { type: 'requirement' as const, id: trimmed };
}
