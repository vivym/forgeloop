import { Outlet, useLocation } from 'react-router';

import { useRuntimeFlags } from '../../shared/context/runtime-flags';
import { AppShell, SidebarNav, Topbar } from '../../shared/layout';

const navItems = [
  { label: 'Workbench', to: '/workbench' },
  { label: 'Pipeline', to: '/pipeline' },
  { label: 'Work Items', to: '/work-items' },
  { label: 'Specs & Plans', to: '/specs' },
  { label: 'Packages', to: '/packages' },
  { label: 'Runs', to: '/runs' },
  { label: 'Reviews', to: '/reviews' },
  { label: 'Releases', to: '/releases' },
];

export default function ProductLayoutRoute() {
  const location = useLocation();
  const runtimeFlags = useRuntimeFlags();
  const items = runtimeFlags.devToolsEnabled ? [...navItems, { label: 'Dev Tools', to: '/dev-tools' }] : navItems;

  return (
    <AppShell
      sidebar={
        <SidebarNav
          title="ForgeLoop"
          items={items.map((item) => ({
            href: item.to,
            label: item.label,
            active: location.pathname === item.to || (item.to !== '/workbench' && location.pathname.startsWith(`${item.to}/`)),
          }))}
        />
      }
      topbar={<Topbar>Product workspace</Topbar>}
    >
      <Outlet />
    </AppShell>
  );
}
