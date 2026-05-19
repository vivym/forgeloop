import { colors } from '../tokens/colors';
import { radius } from '../tokens/radius';
import { shadows } from '../tokens/shadows';
import { spacing } from '../tokens/spacing';
import { typography } from '../tokens/typography';
import { zIndex } from '../tokens/zIndex';

export const tailwindPreset = {
  theme: {
    extend: {
      colors: {
        fl: colors,
      },
      borderRadius: {
        fl: radius,
      },
      boxShadow: {
        fl: shadows,
      },
      fontFamily: {
        sans: typography.fontSans,
        mono: typography.fontMono,
      },
      spacing: {
        fl: spacing,
      },
      zIndex: {
        fl: zIndex,
      },
    },
  },
} as const;
