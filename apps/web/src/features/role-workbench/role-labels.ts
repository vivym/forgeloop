export const productRoles = [
  'Work Item Owner',
  'Spec Approver',
  'Execution Owner',
  'Reviewer',
  'QA / Test Owner',
  'Release Owner',
  'Manager',
] as const;

export type ProductRole = (typeof productRoles)[number];

export const productRoleToWorkbenchId = (role: ProductRole) =>
  ({
    'Work Item Owner': 'intake',
    'Spec Approver': 'spec-approver',
    'Execution Owner': 'execution-owner',
    Reviewer: 'reviewer',
    'QA / Test Owner': 'qa-test-owner',
    'Release Owner': 'release-owner',
    Manager: 'manager-health',
  })[role];
