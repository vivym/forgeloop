import type { LinksFunction } from 'react-router';
import { isRouteErrorResponse, Links, Meta, Outlet, Scripts, ScrollRestoration, useRouteError } from 'react-router';
import { AppProviders } from './providers';
import '../shared/design-system/theme/css-variables.css';

export const links: LinksFunction = () => [];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function Root() {
  return (
    <AppProviders>
      <Outlet />
    </AppProviders>
  );
}

export function HydrateFallback() {
  return <div role="status" aria-label="Loading ForgeLoop">Loading ForgeLoop</div>;
}

export function ErrorBoundary() {
  const error = useRouteError();
  const message = isRouteErrorResponse(error) ? error.statusText : error instanceof Error ? error.message : 'Unexpected error';
  return (
    <main id="main-content">
      <h1>Something went wrong</h1>
      <p>{message}</p>
    </main>
  );
}
