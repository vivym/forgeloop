export const radius = {
  none: '0',
  xs: '2px',
  sm: '4px',
  md: '6px',
  card: '8px',
  pill: '999px',
} as const;

export type RadiusToken = keyof typeof radius;
