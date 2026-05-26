import { Outlet, useLocation } from 'react-router';

import { useActorContext } from '../../shared/context/actor-context';
import { useProjectContext } from '../../shared/context/project-context';
import { useRuntimeFlags } from '../../shared/context/runtime-flags';
import { AppShell, SidebarNav, Topbar } from '../../shared/layout';
import { isProductNavigationItemActive, productNavigationGroups } from '../../shared/navigation/product-navigation';

export default function ProductLayoutRoute() {
  const location = useLocation();
  const { actorId } = useActorContext();
  const { projectId } = useProjectContext();
  const runtimeFlags = useRuntimeFlags();
  const groups = productNavigationGroups({ devToolsEnabled: runtimeFlags.devToolsEnabled });

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
              active: isProductNavigationItemActive(location.pathname, item),
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
