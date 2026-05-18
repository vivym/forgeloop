export const motion = {
  durationFast: '120ms',
  durationBase: '180ms',
  durationSlow: '260ms',
  easeStandard: 'cubic-bezier(0.2, 0, 0, 1)',
  easeOut: 'cubic-bezier(0, 0, 0.2, 1)',
} as const;

export type MotionToken = keyof typeof motion;
