import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import type { ReactNode } from 'react';

import { ActorProvider, type ActorContextValue } from '../shared/context/actor-context';
import { ProjectProvider, type ProjectContextValue } from '../shared/context/project-context';
import { RuntimeFlagsProvider, type RuntimeFlags } from '../shared/context/runtime-flags';

export interface AppProvidersProps {
  children: ReactNode;
  queryClient?: QueryClient;
  actor?: Partial<ActorContextValue>;
  project?: Partial<ProjectContextValue>;
  runtimeFlags?: Partial<RuntimeFlags>;
}

export function AppProviders({ children, queryClient: queryClientOverride, actor, project, runtimeFlags }: AppProvidersProps) {
  const [queryClient] = useState(() => queryClientOverride ?? createQueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <RuntimeFlagsProvider value={runtimeFlags}>
        <ActorProvider value={actor}>
          <ProjectProvider value={project}>{children}</ProjectProvider>
        </ActorProvider>
      </RuntimeFlagsProvider>
    </QueryClientProvider>
  );
}

function createQueryClient() {
  if (import.meta.env.VITE_FORGELOOP_QUERY_RETRY !== 'false') {
    return new QueryClient();
  }

  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
}
