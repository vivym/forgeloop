import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { App } from '../../apps/web/src/App';

describe('Release Owner surface', () => {
  it('server-renders role workbench controls from the MVP role matrix', () => {
    const html = renderToString(<App />);

    expect(html).toContain('Role Workbench');
    expect(html).toContain('Intake');
    expect(html).toContain('Spec Approver');
    expect(html).toContain('Execution Owner');
    expect(html).toContain('Reviewer');
    expect(html).toContain('QA/Test Owner');
    expect(html).toContain('Manager Health');
    expect(html).toContain('Load role queue');
  });

  it('server-renders compact release controls and backend-derived cockpit sections', () => {
    const html = renderToString(<App />);

    expect(html).toContain('Release Owner');
    expect(html).toContain('release_id');
    expect(html).toContain('project_id');
    expect(html).toContain('Load cockpit');
    expect(html).toContain('Load replay');
    expect(html).toContain('Create release');
    expect(html).toContain('Patch release');
    expect(html).toContain('Scope summary');
    expect(html).toContain('Rollout strategy');
    expect(html).toContain('Rollback plan');
    expect(html).toContain('Observation plan');
    expect(html).toContain('State summary');
    expect(html).toContain('Linked WorkItems');
    expect(html).toContain('ExecutionPackages');
    expect(html).toContain('Link WorkItem');
    expect(html).toContain('Unlink WorkItem');
    expect(html).toContain('Link ExecutionPackage');
    expect(html).toContain('Unlink ExecutionPackage');
    expect(html).toContain('Blockers');
    expect(html).toContain('Checklist');
    expect(html).toContain('Risk summary');
    expect(html).toContain('Evidence/observations');
    expect(html).toContain('Decisions');
    expect(html).toContain('Next actions');
    expect(html).toContain('Submit');
    expect(html).toContain('Override approve');
    expect(html).toContain('Start observing');
    expect(html).toContain('Close release');
    expect(html).toContain('Observation evidence');
  });
});
