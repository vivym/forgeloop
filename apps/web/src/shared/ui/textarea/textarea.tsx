import type { TextareaHTMLAttributes } from 'react';

import { cn } from '../../utils/cn';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export function Textarea({ className, invalid = false, ...props }: TextareaProps) {
  return <textarea aria-invalid={invalid || props['aria-invalid']} className={cn('fl-textarea', className)} {...props} />;
}
