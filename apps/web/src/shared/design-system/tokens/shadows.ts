export const shadows = {
  none: 'none',
  sm: '0 1px 2px rgb(15 23 42 / 0.06)',
  md: '0 8px 24px rgb(15 23 42 / 0.08)',
  lg: '0 18px 48px rgb(15 23 42 / 0.14)',
  focus: '0 0 0 3px rgb(14 165 233 / 0.28)',
} as const;

export type ShadowToken = keyof typeof shadows;
