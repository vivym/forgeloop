import { Outlet, useLocation } from 'react-router';

import { useRuntimeFlags } from '../../shared/context/runtime-flags';
import { AppShell, SidebarNav, Topbar } from '../../shared/layout';

const navItems = [
  { label: 'Lanes', to: '/lanes', activeOn: ['/', '/lanes'] },
  { label: 'Pipeline', to: '/pipeline' },
  { label: 'Work Items', to: '/work-items' },
  { label: 'Specs & Plans', to: '/specs', activeOn: ['/specs', '/plans'] },
  { label: 'Packages', to: '/packages' },
  { label: 'Runs', to: '/runs' },
  { label: 'Reviews', to: '/reviews' },
  { label: 'Releases', to: '/releases' },
];

function isNavItemActive(pathname: string, item: { to: string; activeOn?: string[] }) {
  const activeTargets = item.activeOn ?? [item.to];
  return activeTargets.some((target) => pathname === target || pathname.startsWith(`${target}/`));
}

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
            to: item.to,
            label: item.label,
            active: isNavItemActive(location.pathname, item),
          }))}
        />
      }
      topbar={<Topbar>Product workspace</Topbar>}
    >
      <Outlet />
    </AppShell>
  );
}
