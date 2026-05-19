export const typography = {
  fontSans: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  fontMono: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
  sizeXs: '0.75rem',
  sizeSm: '0.875rem',
  sizeMd: '1rem',
  sizeLg: '1.125rem',
  sizeXl: '1.25rem',
  size2xl: '1.5rem',
  lineTight: '1.2',
  lineNormal: '1.5',
  lineRelaxed: '1.65',
  weightRegular: '400',
  weightMedium: '500',
  weightSemibold: '600',
  weightBold: '700',
} as const;

export type TypographyToken = keyof typeof typography;
