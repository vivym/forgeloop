import { WorkspacePage, type WorkspacePageProps } from '../workspace-page/workspace-page';

export type ObjectWorkspaceProps = Omit<WorkspacePageProps, 'layout'>;

export function ObjectWorkspace(props: ObjectWorkspaceProps) {
  return <WorkspacePage {...props} layout="object" />;
}
