import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';

export interface ProjectContextValue {
  projectId: string;
}

export const defaultProjectContext: ProjectContextValue = {
  projectId: import.meta.env.VITE_FORGELOOP_PROJECT_ID || 'project-product-architecture-demo',
};

const ProjectContext = createContext<ProjectContextValue>(defaultProjectContext);

export function ProjectProvider({ children, value }: { children: ReactNode; value?: Partial<ProjectContextValue> | undefined }) {
  return <ProjectContext.Provider value={{ ...defaultProjectContext, ...value }}>{children}</ProjectContext.Provider>;
}

export function useProjectContext() {
  return useContext(ProjectContext);
}
