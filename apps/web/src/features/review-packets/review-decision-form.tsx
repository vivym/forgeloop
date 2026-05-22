import { useState } from 'react';
import type { FormEvent } from 'react';

import type { RequestedChange } from '../../shared/api/types';
import { InlineActions } from '../../shared/layout';
import { Button, Field, InlineNotice, Input, Select, Textarea } from '../../shared/ui';

type DecisionMode = 'approve' | 'request_changes';
type RequestedChangeSeverity = NonNullable<RequestedChange['severity']>;

type RequestedChangeDraft = {
  title: string;
  description: string;
  severity: RequestedChangeSeverity;
};

type ReviewDecisionFormProps = {
  disabled: boolean;
  disabledReason: string | undefined;
  mode: DecisionMode;
  isSubmitting: boolean;
  error?: Error | null;
  onModeChange: (mode: DecisionMode) => void;
  onApprove: (input: { summary: string }) => void;
  onRequestChanges: (input: { summary: string; requested_changes: RequestedChange[] }) => void;
};

const severityOptions = ['minor', 'major', 'critical'] as const satisfies readonly RequestedChangeSeverity[];
const severitySelectOptions = severityOptions.map((severity) => ({ label: severity, value: severity }));

const emptyChange = (): RequestedChangeDraft => ({
  title: '',
  description: '',
  severity: 'major',
});

export function ReviewDecisionForm({
  disabled,
  disabledReason,
  mode,
  isSubmitting,
  error,
  onModeChange,
  onApprove,
  onRequestChanges,
}: ReviewDecisionFormProps) {
  const [approvalSummary, setApprovalSummary] = useState('');
  const [changeSummary, setChangeSummary] = useState('');
  const [changes, setChanges] = useState<RequestedChangeDraft[]>([emptyChange()]);

  const submitApproval = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const summary = approvalSummary.trim();
    if (!summary) return;
    onApprove({ summary });
  };

  const submitRequestedChanges = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const summary = changeSummary.trim();
    const requestedChanges = changes
      .map((change) => ({
        title: change.title.trim(),
        description: change.description.trim(),
        severity: change.severity,
      }))
      .filter((change) => change.title && change.description && change.severity);
    if (!summary || requestedChanges.length === 0) return;
    onRequestChanges({ summary, requested_changes: requestedChanges });
  };

  return (
    <div className="grid gap-3">
      <InlineActions aria-label="Review decision" role="tablist">
        <Button
          aria-selected={mode === 'approve'}
          disabled={disabled || isSubmitting}
          onClick={() => onModeChange('approve')}
          role="tab"
          variant={mode === 'approve' ? 'primary' : 'secondary'}
        >
          Approve
        </Button>
        <Button
          aria-selected={mode === 'request_changes'}
          disabled={disabled || isSubmitting}
          onClick={() => onModeChange('request_changes')}
          role="tab"
          variant={mode === 'request_changes' ? 'primary' : 'secondary'}
        >
          Request changes
        </Button>
      </InlineActions>
      {disabled && disabledReason ? <InlineNotice title={disabledReason} tone="warning" /> : null}
      {error ? <InlineNotice title={error.message} tone="danger" /> : null}
      {mode === 'approve' ? (
        <form className="grid gap-3" onSubmit={submitApproval}>
          <Field label="Approval summary">
            <Textarea
              disabled={disabled || isSubmitting}
              onChange={(event) => setApprovalSummary(event.currentTarget.value)}
              required
              rows={4}
              value={approvalSummary}
            />
          </Field>
          <Button disabled={disabled || !approvalSummary.trim()} loading={isSubmitting} type="submit" variant="primary">
            Submit approval
          </Button>
        </form>
      ) : (
        <form className="grid gap-3" onSubmit={submitRequestedChanges}>
          <Field label="Change request summary">
            <Textarea
              disabled={disabled || isSubmitting}
              onChange={(event) => setChangeSummary(event.currentTarget.value)}
              required
              rows={4}
              value={changeSummary}
            />
          </Field>
          <div className="grid gap-3">
            {changes.map((change, index) => (
              <div className="grid gap-3 rounded-card border border-border bg-surface-muted p-3" key={index}>
                <Field label="Requested change title">
                  <Input
                    disabled={disabled || isSubmitting}
                    onChange={(event) => updateChange(index, { title: event.currentTarget.value })}
                    required
                    value={change.title}
                  />
                </Field>
                <Field label="Requested change description">
                  <Textarea
                    disabled={disabled || isSubmitting}
                    onChange={(event) => updateChange(index, { description: event.currentTarget.value })}
                    required
                    rows={3}
                    value={change.description}
                  />
                </Field>
                <Field label="Requested change severity">
                  <Select
                    disabled={disabled || isSubmitting}
                    onChange={(event) => updateChange(index, { severity: event.currentTarget.value as RequestedChangeSeverity })}
                    options={severitySelectOptions}
                    required
                    value={change.severity}
                  />
                </Field>
                <Button disabled={disabled || isSubmitting || changes.length === 1} onClick={() => removeChange(index)} variant="ghost">
                  Remove requested change
                </Button>
              </div>
            ))}
          </div>
          <Button disabled={disabled || isSubmitting} onClick={() => setChanges((current) => [...current, emptyChange()])} variant="secondary">
            Add requested change
          </Button>
          <Button disabled={disabled || !canSubmitChanges(changeSummary, changes)} loading={isSubmitting} type="submit" variant="primary">
            Submit requested changes
          </Button>
        </form>
      )}
    </div>
  );

  function updateChange(index: number, patch: Partial<RequestedChangeDraft>) {
    setChanges((current) => current.map((change, currentIndex) => (currentIndex === index ? { ...change, ...patch } : change)));
  }

  function removeChange(index: number) {
    setChanges((current) => (current.length <= 1 ? current : current.filter((_, currentIndex) => currentIndex !== index)));
  }
}

function canSubmitChanges(summary: string, changes: RequestedChangeDraft[]) {
  return Boolean(
    summary.trim() &&
      changes.some((change) => change.title.trim() && change.description.trim() && change.severity.trim()),
  );
}
