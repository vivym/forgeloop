import { WorkspacePage, type WorkspacePageProps } from '../workspace-page/workspace-page';

export type PlanningTableWorkspaceProps = Omit<WorkspacePageProps, 'layout'>;

export function PlanningTableWorkspace(props: PlanningTableWorkspaceProps) {
  return <WorkspacePage {...props} layout="planning-table" />;
}
