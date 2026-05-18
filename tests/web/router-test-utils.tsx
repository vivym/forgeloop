import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import ProductLayoutRoute from '../../apps/web/src/app/routes/_layout';
import WorkbenchRoute from '../../apps/web/src/app/routes/workbench';

export async function renderRoute(path: string) {
  cleanup();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: <ProductLayoutRoute />,
        children: [
          { index: true, element: <WorkbenchRoute /> },
          { path: 'workbench', element: <WorkbenchRoute /> },
          { path: '*', element: null },
        ],
      },
    ],
    { initialEntries: [path] },
  );

  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return screen;
}
