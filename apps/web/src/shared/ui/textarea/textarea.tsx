import type { TextareaHTMLAttributes } from 'react';

import { resolveAriaInvalid } from '../form-control-state';
import { cn } from '../../utils/cn';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export function Textarea({ className, invalid = false, ...props }: TextareaProps) {
  const ariaInvalid = resolveAriaInvalid(invalid, props['aria-invalid']);

  return (
    <textarea
      aria-invalid={ariaInvalid.value}
      className={cn(
        'min-h-24 w-full resize-y rounded-md border border-border bg-surface px-3 py-3 text-sm text-text-primary transition-colors duration-base ease-standard placeholder:text-text-muted motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-60',
        ariaInvalid.isInvalid ? 'border-danger' : null,
        className,
      )}
      {...props}
    />
  );
}
