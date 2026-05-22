// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Section } from '../../apps/web/src/shared/layout';
import {
  Button,
  Checkbox,
  Dialog,
  DialogClose,
  Drawer,
  DrawerClose,
  Field,
  InlineNotice,
  Input,
  Select,
  Skeleton,
  Toast,
  ToastAction,
  ToastClose,
  ToastProvider,
  Textarea,
} from '../../apps/web/src/shared/ui';

afterEach(() => {
  cleanup();
});

describe('design system primitives', () => {
  it('renders semantic buttons without legacy styling classes', () => {
    render(<Button iconLeading={null}>Create Spec</Button>);

    const button = screen.getByRole('button', { name: 'Create Spec' });
    expect(button).toBeTruthy();
    expect(button.className).not.toContain('fl-');
  });

  it('preserves button action context while loading and disabled', () => {
    render(<Button loading>Create Spec</Button>);

    const button = screen.getByRole('button', { name: 'Loading Create Spec' });
    expect(button).toBeTruthy();
    expect(button.hasAttribute('disabled')).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
  });

  it('renders inline notices with live-region semantics and names', () => {
    render(
      <>
        <InlineNotice
          aria-live="polite"
          data-testid="readiness-notice"
          description="Runtime checks are still catching up."
          title="Readiness pending"
          tone="warning"
        />
        <InlineNotice aria-label="Custom readiness" role="note" title={<span>Readiness</span>} />
        <InlineNotice description="Release cannot continue." title="Gate blocked" tone="danger" />
      </>,
    );

    const notice = screen.getByRole('status', { name: 'Readiness pending' });
    expect(notice).toBeTruthy();
    expect(notice.getAttribute('aria-live')).toBe('polite');
    expect(notice.getAttribute('data-testid')).toBe('readiness-notice');
    expect(screen.getByRole('note', { name: 'Custom readiness' })).toBeTruthy();
    expect(screen.getByRole('alert', { name: 'Gate blocked' })).toBeTruthy();
    expect(document.body.innerHTML).not.toContain('fl-');
  });

  it('renders fields with label, hint, required marker, and alert errors', () => {
    render(
      <Field error="Title is required" hint="Use the product-facing release name." label="Release title" required>
        <Input id="release-title" invalid />
      </Field>,
    );

    const input = screen.getByLabelText(/Release title/);
    const describedBy = input.getAttribute('aria-describedby') ?? '';
    expect(input).toBeTruthy();
    expect(describedBy).toContain('release-title-hint');
    expect(describedBy).toContain('release-title-error');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText('Use the product-facing release name.')).toBeTruthy();
    expect(screen.getAllByRole('alert').some((alert) => alert.textContent === 'Title is required')).toBe(true);
  });

  it('does not wire empty field hint or error values', () => {
    render(
      <Field error={null} hint="" label="Empty release title">
        <Input id="empty-release-title" />
      </Field>,
    );

    const input = screen.getByLabelText('Empty release title');
    expect(input.getAttribute('aria-describedby')).toBeNull();
    expect(input.getAttribute('aria-invalid')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('marks invalid and disabled inputs semantically without legacy classes', () => {
    render(<Input aria-label="Release owner" disabled invalid />);

    const input = screen.getByLabelText('Release owner');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.hasAttribute('disabled')).toBe(true);
    expect(input.className).not.toContain('fl-');
  });

  it('keeps explicit aria-invalid false out of danger state', () => {
    render(
      <>
        <Input aria-invalid="false" aria-label="Release owner" />
        <Select aria-invalid="false" aria-label="Release type" options={[{ label: 'Feature', value: 'feature' }]} />
        <Textarea aria-invalid="false" aria-label="Release notes" />
        <Checkbox aria-invalid="false" aria-label="Release approved" />
      </>,
    );

    const input = screen.getByLabelText('Release owner');
    const select = screen.getByLabelText('Release type');
    const textarea = screen.getByLabelText('Release notes');
    const checkbox = screen.getByLabelText('Release approved');

    for (const control of [input, select, textarea, checkbox]) {
      expect(control.getAttribute('aria-invalid')).toBe('false');
      expect(control.className).not.toContain('fl-');
    }

    expect(input.className).not.toContain('border-danger');
    expect(select.className).not.toContain('border-danger');
    expect(textarea.className).not.toContain('border-danger');
  });

  it('renders skeleton placeholders as hidden presentation lines', () => {
    const { container } = render(<Skeleton lines={3} />);

    const group = container.firstElementChild;
    expect(group?.getAttribute('aria-hidden')).toBe('true');
    expect(container.querySelectorAll('[data-skeleton-line]').length).toBe(3);
    expect(container.innerHTML).not.toContain('fl-');
  });

  it('renders page sections without nested card markup', () => {
    render(<Section title="Release scope">Content</Section>);

    expect(screen.getByRole('heading', { name: 'Release scope' })).toBeTruthy();
    expect(document.querySelector('.fl-card .fl-card')).toBeNull();
  });

  it('exports dialog close semantics that can dismiss uncontrolled content', () => {
    render(
      <Dialog
        content={<DialogClose label="Close dialog">Close</DialogClose>}
        title="Confirm release"
      >
        <Button>Open dialog</Button>
      </Dialog>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open dialog' }));
    expect(screen.getByRole('dialog', { name: 'Confirm release' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
    expect(screen.queryByRole('dialog', { name: 'Confirm release' })).toBeNull();
  });

  it('exports drawer close semantics that can dismiss uncontrolled content', () => {
    render(
      <Drawer
        content={<DrawerClose label="Close drawer">Close</DrawerClose>}
        title="Release actions"
      >
        <Button>Open drawer</Button>
      </Drawer>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open drawer' }));
    expect(screen.getByRole('dialog', { name: 'Release actions' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Close drawer' }));
    expect(screen.queryByRole('dialog', { name: 'Release actions' })).toBeNull();
  });

  it('exports toast action and close semantics', () => {
    render(
      <ToastProvider>
        <Toast
          action={<ToastAction altText="Undo archive">Undo</ToastAction>}
          close={<ToastClose label="Dismiss notification" />}
          open
          title="Release archived"
        />
      </ToastProvider>,
    );

    expect(screen.getByRole('button', { name: 'Undo archive' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Dismiss notification' })).toBeTruthy();
    expect(document.body.innerHTML).not.toContain('fl-dialog');
    expect(document.body.innerHTML).not.toContain('fl-drawer');
    expect(document.body.innerHTML).not.toContain('fl-toast');
  });
});
