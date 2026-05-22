import type { AriaAttributes } from 'react';

export type AriaInvalidValue = AriaAttributes['aria-invalid'];

export function resolveAriaInvalid(invalid: boolean | undefined, ariaInvalid: AriaInvalidValue) {
  const value = ariaInvalid ?? (invalid ? true : undefined);
  const isInvalid = value === true || value === 'true' || value === 'grammar' || value === 'spelling';

  return { isInvalid, value };
}
