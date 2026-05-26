export const firstViewportContract = {
  pageFamilyAttribute: 'data-page-family',
  primaryWorkSurfaceAttribute: 'data-primary-work-surface',
  forbiddenAttributes: ['data-first-viewport', 'data-priority-summary', 'data-action-strip'],
  forbiddenTestIds: ['current-state', 'role-responsibility', 'blocker-risk', 'next-action'],
} as const;
