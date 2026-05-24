import { WorkspacePage, type WorkspacePageProps } from '../workspace-page/workspace-page';

export type QueueWorkspaceProps = Omit<WorkspacePageProps, 'layout'>;

export function QueueWorkspace(props: QueueWorkspaceProps) {
  return <WorkspacePage {...props} layout="queue" />;
}
