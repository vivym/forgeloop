export const zIndex = {
  base: 0,
  sticky: 10,
  overlay: 40,
  drawer: 50,
  modal: 60,
  toast: 70,
} as const;

export type ZIndexToken = keyof typeof zIndex;
