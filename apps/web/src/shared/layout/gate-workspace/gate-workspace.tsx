import { WorkspacePage, type WorkspacePageProps } from '../workspace-page/workspace-page';

export type GateWorkspaceProps = Omit<WorkspacePageProps, 'layout'>;

export function GateWorkspace(props: GateWorkspaceProps) {
  return <WorkspacePage {...props} layout="gate" />;
}
