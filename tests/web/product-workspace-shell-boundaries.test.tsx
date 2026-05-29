// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { bugListItem, developmentPlan, initiativeListItem, requirementListItem, techDebtListItem } from './fixtures/product-data';
import { renderRoute } from './router-test-utils';

const repoRoot = process.cwd();

const shellFile = 'apps/web/src/shared/layout/product-workspace-shells.tsx';
const primitiveFile = 'apps/web/src/shared/layout/workspace-primitives.tsx';
const layoutIndexFile = 'apps/web/src/shared/layout/index.ts';
const productPageFile = 'apps/web/src/shared/layout/product-page/product-page.tsx';
const stateBannerComponent = ['Surface', 'State', 'Indicator'].join('');
const genericOwnerLabel = ['Work', 'Item', 'Owner'].join(' ');
const genericOwnerField = ['owner', 'actor', 'id'].join('_');
const lowPriorityToken = ['p', '0'].join('');
const sampleCopyToken = ['de', 'mo'].join('');

function readRepoFile(path: string) {
  return readFileSync(join(repoRoot, path), 'utf8');
}

describe('product workspace shell boundaries', () => {
  it('declares every page-specific shell marker in the shell module', () => {
    const shellSource = readRepoFile(shellFile);

    expect(shellSource).toContain('data-product-shell="cockpit-command-center"');
    expect(shellSource).toContain('data-product-shell="requirement-workspace"');
    expect(shellSource).toContain('data-product-shell="initiative-workspace"');
    expect(shellSource).toContain('data-product-shell="bug-workspace"');
    expect(shellSource).toContain('data-product-shell="tech-debt-workspace"');
    expect(shellSource).toContain('data-product-shell="development-plan-workspace"');
    expect(shellSource).toContain('data-product-shell="plan-item-gate-workspace"');
  });

  it('keeps shell and primitive modules free of state banners and product business copy', () => {
    const sources = [readRepoFile(shellFile), readRepoFile(primitiveFile)].join('\n');

    expect(sources).not.toContain(stateBannerComponent);
    expect(sources).not.toContain(genericOwnerLabel);
    expect(sources).not.toContain(genericOwnerField);
    expect(sources).not.toMatch(new RegExp(`\\b${lowPriorityToken}\\b`, 'i'));
    expect(sources).not.toMatch(new RegExp(`\\b${sampleCopyToken}\\b`, 'i'));
    expect(sources).not.toMatch(/approved|current state|next action|blocked by/i);
  });

  it('keeps page-specific shell APIs slot-based instead of generic children passthrough', () => {
    const shellSource = readRepoFile(shellFile);

    expect(shellSource).toContain('export interface CockpitCommandCenterProps');
    expect(shellSource).toContain('export interface TypedSourceWorkspaceProps');
    expect(shellSource).toContain('export interface DevelopmentPlanWorkspaceProps');
    expect(shellSource).toContain('export interface PlanItemGateWorkspaceProps');
    expect(shellSource).toContain('attentionQueue: ReactNode');
    expect(shellSource).toContain('table: ReactNode');
    expect(shellSource).toContain('workspace: ReactNode');
    expect(shellSource).not.toContain('export function RequirementWorkspace({ children');
    expect(shellSource).not.toContain('export function PlanItemGateWorkspace({ children');
    expect(shellSource).not.toMatch(/export\s+(interface|type)\s+ProductWorkspaceShellProps\b/);

    const indexSource = readRepoFile(layoutIndexFile);
    expect(indexSource).not.toContain('ProductWorkspaceShellProps');
    expect(shellSource).not.toMatch(/export\s+(?:type\s+)?\{[^}]*\bProductWorkspaceShellProps\b[^}]*\}/s);
  });

  it('exports workspace shells and neutral primitives from the shared layout barrel', () => {
    const indexSource = readRepoFile(layoutIndexFile);

    expect(indexSource).toContain("from './product-workspace-shells'");
    expect(indexSource).toContain("from './workspace-primitives'");
  });

  it('keeps ProductPage reduced to a semantic root instead of page chrome composition', () => {
    const productPageSource = readRepoFile(productPageFile);

    expect(productPageSource).toContain('ariaLabel: string');
    expect(productPageSource).not.toMatch(/\bheading\b/);
    expect(productPageSource).not.toMatch(/\btoolbar\b/);
    expect(productPageSource).not.toContain('<header');
    expect(productPageSource).not.toContain('<h1');
    expect(productPageSource).not.toContain('useId');
  });

  it('does not assert route-level product shell adoption before route migrations', () => {
    const testSource = readRepoFile('tests/web/product-workspace-shell-boundaries.test.tsx');

    expect(testSource).not.toContain(['canonical', 'Product', 'Routes'].join(''));
  });

  it.each([
    ['/requirements', 'requirement-workspace'],
    ['/requirements/new', 'requirement-workspace'],
    [`/requirements/${requirementListItem.id}`, 'requirement-workspace'],
    ['/initiatives', 'initiative-workspace'],
    ['/initiatives/new', 'initiative-workspace'],
    [`/initiatives/${initiativeListItem.id}`, 'initiative-workspace'],
    ['/bugs', 'bug-workspace'],
    ['/bugs/new', 'bug-workspace'],
    [`/bugs/${bugListItem.id}`, 'bug-workspace'],
    ['/tech-debt', 'tech-debt-workspace'],
    ['/tech-debt/new', 'tech-debt-workspace'],
    [`/tech-debt/${techDebtListItem.id}`, 'tech-debt-workspace'],
    ['/development-plans', 'development-plan-workspace'],
    [`/development-plans/${developmentPlan.id}`, 'development-plan-workspace'],
    [`/development-plans/${developmentPlan.id}/items/${developmentPlan.items[0].id}`, 'plan-item-gate-workspace'],
    [`/development-plans/${developmentPlan.id}/items/${developmentPlan.items[0].id}/spec`, 'plan-item-gate-workspace'],
    [`/development-plans/${developmentPlan.id}/items/${developmentPlan.items[0].id}/implementation-plan`, 'plan-item-gate-workspace'],
    [`/development-plans/${developmentPlan.id}/items/${developmentPlan.items[0].id}/execution`, 'plan-item-gate-workspace'],
  ] as const)('renders %s inside the typed product shell %s', async (route, shellMarker) => {
    await renderRoute(route);

    expect(document.querySelector(`[data-product-shell="${shellMarker}"]`)).toBeInstanceOf(HTMLElement);
  });
});
