import { Outlet, useLocation } from 'react-router';

import { useActorContext } from '../../shared/context/actor-context';
import { useProjectContext } from '../../shared/context/project-context';
import { useRuntimeFlags } from '../../shared/context/runtime-flags';
import { AppShell, SidebarNav, Topbar } from '../../shared/layout';

const navGroups = [
  {
    label: 'Home',
    items: [
      { label: 'Dashboard', to: '/dashboard' },
      { label: 'My Work', to: '/my-work', activeOn: ['/', '/my-work'] },
    ],
  },
  {
    label: 'Discovery',
    items: [
      { label: 'Initiatives', to: '/initiatives' },
      { label: 'Requirements', to: '/requirements' },
      { label: 'Bugs', to: '/bugs' },
      { label: 'Tech Debt', to: '/tech-debt' },
    ],
  },
  {
    label: 'Planning',
    items: [
      { label: 'Development Plans', to: '/development-plans' },
      { label: 'Specs & Execution Plans', to: '/specs-plans' },
    ],
  },
  {
    label: 'Delivery',
    items: [
      { label: 'Board', to: '/board' },
      { label: 'Releases', to: '/releases' },
    ],
  },
  {
    label: 'Intelligence',
    items: [{ label: 'Reports', to: '/reports' }],
  },
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
  const groups = runtimeFlags.devToolsEnabled
    ? [...navGroups, { label: 'Tools', items: [{ label: 'Dev Tools', to: '/dev-tools' }] }]
    : navGroups;

  return (
    <AppShell
      sidebar={
        <SidebarNav
          title="ForgeLoop"
          items={[]}
          groups={groups.map((group) => ({
            label: group.label,
            items: group.items.map((item) => ({
              to: item.to,
              label: item.label,
              active: isNavItemActive(location.pathname, item),
            })),
          }))}
        />
      }
      topbar={<Topbar actorId={actorId} devToolsEnabled={runtimeFlags.devToolsEnabled} projectId={projectId} />}
    >
      <Outlet />
    </AppShell>
  );
}
