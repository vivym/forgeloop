import { Outlet, useLocation } from 'react-router';

import { useActorContext } from '../../shared/context/actor-context';
import { useProjectContext } from '../../shared/context/project-context';
import { useRuntimeFlags } from '../../shared/context/runtime-flags';
import { AppShell, SidebarNav, Topbar } from '../../shared/layout';

const navItems = [
  { label: 'Dashboard', to: '/dashboard' },
  { label: 'My Work', to: '/my-work', activeOn: ['/', '/my-work'] },
  { label: 'Requirements', to: '/requirements', activeOn: ['/requirements', '/initiatives', '/tech-debt'] },
  { label: 'Specs & Plans', to: '/specs-plans' },
  { label: 'Bugs', to: '/bugs' },
  { label: 'Board', to: '/board' },
  { label: 'Releases', to: '/releases' },
  { label: 'Reports', to: '/reports' },
];

function isNavItemActive(pathname: string, item: { to: string; activeOn?: string[] }) {
  const activeTargets = item.activeOn ?? [item.to];
  return activeTargets.some((target) => pathname === target || pathname.startsWith(`${target}/`));
}

export default function ProductLayoutRoute() {
  const location = useLocation();
  const { actorId } = useActorContext();
  const { projectId } = useProjectContext();
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
      topbar={<Topbar actorId={actorId} devToolsEnabled={runtimeFlags.devToolsEnabled} projectId={projectId} />}
    >
      <Outlet />
    </AppShell>
  );
}
