import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';

export interface ProjectContextValue {
  projectId: string;
}

export const defaultProjectContext: ProjectContextValue = {
  projectId: 'project-web-product',
};

const ProjectContext = createContext<ProjectContextValue>(defaultProjectContext);

export function ProjectProvider({ children, value }: { children: ReactNode; value?: Partial<ProjectContextValue> | undefined }) {
  return <ProjectContext.Provider value={{ ...defaultProjectContext, ...value }}>{children}</ProjectContext.Provider>;
}

export function useProjectContext() {
  return useContext(ProjectContext);
}
