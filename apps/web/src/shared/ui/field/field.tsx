import { cloneElement, isValidElement, useId, type HTMLAttributes, type ReactElement, type ReactNode } from 'react';

import { cn } from '../../utils/cn';

interface FieldControlProps {
  'aria-describedby'?: string;
  'aria-invalid'?: boolean | 'false' | 'true';
  id?: string;
}

export interface FieldProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  children: ReactNode;
  error?: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  label: ReactNode;
  required?: boolean;
}

export function Field({ children, className, error, htmlFor, hint, label, required = false, ...props }: FieldProps) {
  const generatedId = useId();
  const childId = isValidElement<FieldControlProps>(children) ? children.props.id : undefined;
  const controlId = htmlFor ?? childId ?? `field-${generatedId}`;
  const hasHint = hasFieldContent(hint);
  const hasError = hasFieldContent(error);
  const hintId = hasHint ? `${controlId}-hint` : undefined;
  const errorId = hasError ? `${controlId}-error` : undefined;
  const describedBy = mergeIds(isValidElement<FieldControlProps>(children) ? children.props['aria-describedby'] : undefined, hintId, errorId);
  const control = isValidElement<FieldControlProps>(children)
    ? cloneElement(children as ReactElement<FieldControlProps>, {
        id: childId ?? controlId,
        ...(describedBy === undefined ? {} : { 'aria-describedby': describedBy }),
        ...(children.props['aria-invalid'] !== undefined || !hasError ? {} : { 'aria-invalid': true }),
      })
    : children;

  return (
    <div className={cn('grid gap-2 text-sm font-semibold text-text-secondary', className)} {...props}>
      <label className="inline-flex min-w-0 items-center gap-1" htmlFor={controlId}>
        <span>{label}</span>
        {required ? <span aria-hidden="true" className="text-danger">*</span> : null}
      </label>
      {hasHint ? <span className="text-sm font-normal text-text-muted" id={hintId}>{hint}</span> : null}
      {control}
      {hasError ? <span className="text-sm font-semibold text-danger" id={errorId} role="alert">{error}</span> : null}
    </div>
  );
}

function hasFieldContent(value: ReactNode) {
  return value !== undefined && value !== null && value !== false && value !== '';
}

function mergeIds(...ids: Array<string | undefined>) {
  const value = ids.filter(Boolean).join(' ');
  return value.length === 0 ? undefined : value;
}
