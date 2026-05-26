export interface ProductNavigationItem {
  label: string;
  to: string;
  activeOn?: readonly string[];
}

export interface ProductNavigationGroup {
  label: string;
  items: readonly ProductNavigationItem[];
}

const baseProductNavigationGroups = [
  {
    label: 'Workspace',
    items: [
      { label: 'Cockpit', to: '/cockpit', activeOn: ['/', '/cockpit'] },
      { label: 'My Work', to: '/my-work' },
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
      { label: 'Executions', to: '/executions' },
      { label: 'Releases', to: '/releases' },
    ],
  },
  {
    label: 'Intelligence',
    items: [{ label: 'Reports', to: '/reports' }],
  },
] as const satisfies readonly ProductNavigationGroup[];

const devToolsNavigationGroup = {
  label: 'Tools',
  items: [{ label: 'Dev Tools', to: '/dev-tools' }],
} as const satisfies ProductNavigationGroup;

export function productNavigationGroups({ devToolsEnabled }: { devToolsEnabled: boolean }): readonly ProductNavigationGroup[] {
  return devToolsEnabled ? [...baseProductNavigationGroups, devToolsNavigationGroup] : baseProductNavigationGroups;
}

export function isProductNavigationItemActive(pathname: string, item: ProductNavigationItem): boolean {
  const activeTargets = item.activeOn ?? [item.to];
  return activeTargets.some((target) => pathname === target || (target !== '/' && pathname.startsWith(`${target}/`)));
}
