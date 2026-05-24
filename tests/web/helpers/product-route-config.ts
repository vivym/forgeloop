interface RouteConfigEntry {
  children?: readonly RouteConfigEntry[];
  index?: boolean;
  path?: string;
}

const canonicalParameterNames = new Map<string, string>([
  ['bugId', 'id'],
  ['developmentPlanId', 'id'],
  ['executionId', 'id'],
  ['initiativeId', 'id'],
  ['releaseId', 'id'],
  ['requirementId', 'id'],
  ['techDebtId', 'id'],
]);

export function flattenProductRouteConfig(routeConfig: readonly RouteConfigEntry[]): string[] {
  const paths: string[] = [];
  for (const route of routeConfig) {
    collectRoutePaths(route, '', paths);
  }
  return paths;
}

export function duplicateProductRoutePaths(paths: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const path of paths) {
    if (seen.has(path)) {
      duplicates.add(path);
      continue;
    }
    seen.add(path);
  }
  return [...duplicates];
}

function collectRoutePaths(route: RouteConfigEntry, parentPath: string, paths: string[]) {
  const ownPath = route.index === true ? parentPath : joinRoutePaths(parentPath, route.path);

  if (route.index === true || route.path !== undefined) {
    paths.push(normalizeRoutePath(ownPath));
  }

  for (const child of route.children ?? []) {
    collectRoutePaths(child, ownPath, paths);
  }
}

function joinRoutePaths(parentPath: string, path: string | undefined): string {
  if (path === undefined) return parentPath;
  if (parentPath.length === 0) return path;
  if (path.length === 0) return parentPath;
  return `${parentPath.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

function normalizeRoutePath(path: string): string {
  return path
    .replace(/^\/+/, '')
    .replace(/:([A-Za-z0-9_]+)/g, (_match, parameterName: string) => `:${canonicalParameterNames.get(parameterName) ?? parameterName}`);
}
