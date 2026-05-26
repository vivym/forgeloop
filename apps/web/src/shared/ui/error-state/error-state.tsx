import type { HTMLAttributes, ReactNode } from 'react';

import { Button } from '../button/button';
import { InlineNotice } from '../inline-notice/inline-notice';

export interface ErrorStateProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title: ReactNode;
  description?: ReactNode;
  retryLabel?: ReactNode;
  onRetry?: () => void;
}

export function ErrorState({ description, onRetry, retryLabel = 'Retry', title, ...props }: ErrorStateProps) {
  return (
    <div className="grid gap-2" data-error-state="" {...props}>
      <InlineNotice
        actions={
          onRetry ? (
            <Button onClick={onRetry} type="button" variant="secondary">
              {retryLabel}
            </Button>
          ) : null
        }
        description={description}
        role="alert"
        title={title}
        tone="danger"
      />
    </div>
  );
}
