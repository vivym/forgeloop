import { useSearchParams } from 'react-router';

import { useWorkbenchQuery } from '../../shared/api/hooks';
import { useProjectContext } from '../../shared/context/project-context';
import { DetailLayout, PageHeader, Section } from '../../shared/layout';
import { ActionRail } from '../../shared/layout';
import { RoleQueuePreview } from './role-queue-preview';
import { RoleQueueTable } from './role-queue-table';
import { RoleSwitcher } from './role-switcher';
import { createRoleWorkbenchViewModel, workItemOwnerRole, workItemOwnerWorkbenchId } from './role-workbench-view-model';

export function RoleWorkbenchRoute() {
  const { projectId: contextProjectId } = useProjectContext();
  const [searchParams] = useSearchParams();
  const projectId = searchParams.get('project_id') ?? contextProjectId;
  const query = useWorkbenchQuery({ role: workItemOwnerWorkbenchId, projectId });
  const viewModel = createRoleWorkbenchViewModel(query.data);
  const isLoading = query.status === 'pending';

  return (
    <DetailLayout
      actionRail={
        <ActionRail title="Next action">
          <RoleQueuePreview item={viewModel.selectedItem} />
        </ActionRail>
      }
      header={
        <PageHeader
          eyebrow="Role workbench"
          subtitle="Prioritized product work by ownership role, object type, kind, surface, risk, and next action."
          title="Workbench"
        />
      }
    >
      <Section
        description={
          isLoading
            ? `Loading product queue for ${workItemOwnerRole}.`
            : `${viewModel.total} product object${viewModel.total === 1 ? '' : 's'} queued for ${workItemOwnerRole}.`
        }
        title={workItemOwnerRole}
      >
        {isLoading ? <p className="empty">Loading workbench queue.</p> : null}
        {query.isError ? <p className="empty">Workbench data is temporarily unavailable.</p> : null}
        {!isLoading && !query.isError ? (
          <>
            <RoleSwitcher activeRole={viewModel.activeRole} />
            <RoleQueueTable items={viewModel.items} />
          </>
        ) : null}
      </Section>
    </DetailLayout>
  );
}
