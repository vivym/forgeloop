const forbiddenClassTokens = [
  /^fl-/,
  /^empty$/,
  /^metric$/,
  /^pill-list$/,
  /^state-grid$/,
  /^form-grid$/,
  /^button-row$/,
  /^danger-text$/,
  /^timeline-list$/,
  /^timeline-entry$/,
  /^artifact-list$/,
  /^detail-block$/,
  /^delivery-action-summary$/,
];

export function legacyRenderedClassTokens(root: ParentNode) {
  return [...root.querySelectorAll<HTMLElement>('[class]')].flatMap((element) =>
    [...element.classList].filter((token) => isForbiddenLegacyClassToken(token)),
  );
}

function isForbiddenLegacyClassToken(token: string) {
  return forbiddenClassTokens.some((forbidden) => forbidden.test((token.split(':').at(-1) ?? token).replace(/^!/, '')));
}
