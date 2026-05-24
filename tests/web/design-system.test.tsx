// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  DetailLayout,
  InlineActions,
  MetadataGrid,
  Metric,
  MetricGrid,
  ObjectSummary,
  PillGroup,
  Section,
} from '../../apps/web/src/shared/layout';
import { resolveAriaInvalid } from '../../apps/web/src/shared/ui/form-control-state';
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
  StatusPill,
  Toast,
  ToastAction,
  ToastClose,
  ToastProvider,
  Textarea,
} from '../../apps/web/src/shared/ui';
import { legacyRenderedClassTokens } from './helpers/no-legacy-class-scan';

afterEach(() => {
  cleanup();
});

describe('design system primitives', () => {
  it('renders semantic buttons without legacy styling classes', () => {
    render(<Button iconLeading={null}>Create Spec</Button>);

    const button = screen.getByRole('button', { name: 'Create Spec' });
    expect(button).toBeTruthy();
    expectNoLegacyRenderedClasses();
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
    expectNoLegacyRenderedClasses();
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
    expectNoLegacyRenderedClasses();
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
    }
    expectNoLegacyRenderedClasses();

    expect(resolveAriaInvalid(false, 'false')).toEqual({ isInvalid: false, value: 'false' });
    expect(resolveAriaInvalid(false, 'grammar')).toEqual({ isInvalid: true, value: 'grammar' });
    expect(resolveAriaInvalid(true, undefined)).toEqual({ isInvalid: true, value: true });
  });

  it('renders skeleton placeholders as hidden presentation lines', () => {
    const { container } = render(<Skeleton lines={3} />);

    const group = container.firstElementChild;
    expect(group?.getAttribute('aria-hidden')).toBe('true');
    expect(container.querySelectorAll('[data-skeleton-line]').length).toBe(3);
    expectNoLegacyRenderedClasses();
  });

  it('renders page sections without nested card markup', () => {
    render(<Section title="Release scope">Content</Section>);

    const heading = screen.getByRole('heading', { name: 'Release scope' });
    const section = heading.closest('section');
    expect(section).toBeTruthy();
    expect(section?.querySelector('section')).toBeNull();
    expectNoLegacyRenderedClasses();
  });

  it('keeps detail layout rail inline before content without legacy classes', () => {
    render(
      <DetailLayout actionRail={<aside aria-label="Release actions">Actions</aside>} header={<PageHeaderForTest />}>
        <article aria-label="Release detail">Detail</article>
      </DetailLayout>,
    );

    const rail = screen.getByRole('complementary', { name: 'Release actions' });
    const content = screen.getByRole('article', { name: 'Release detail' });
    expect(rail.compareDocumentPosition(content)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(document.querySelector('[data-detail-layout-rail]')).toBeTruthy();
    expect(document.querySelector('[data-card-in-card="true"]')).toBeNull();
    expectNoLegacyRenderedClasses();
  });

  it('renders status pills with visible text so state is not color-only', () => {
    render(<StatusPill tone="warning">Blocked</StatusPill>);

    expect(screen.getByText('Blocked')).toBeTruthy();
    expect(document.body.textContent).toContain('Blocked');
    expectNoLegacyRenderedClasses();
  });

  it('exports semantic layout primitives without legacy classes', () => {
    render(
      <>
        <MetricGrid>
          <Metric label="Ready packages" value="3" />
        </MetricGrid>
        <MetadataGrid
          items={[
            { label: 'Project', value: 'project-web-product' },
            { label: 'Actor', value: 'actor-owner' },
          ]}
        />
        <ObjectSummary meta={<span>Updated today</span>} subtitle="Release train" title="Product shell" />
        <InlineActions>
          <Button>Approve</Button>
        </InlineActions>
        <PillGroup>
          <span>Ready</span>
        </PillGroup>
      </>,
    );

    expect(screen.getByText('Ready packages').tagName).toBe('DT');
    expect(screen.getByText('3').tagName).toBe('DD');
    expect(screen.getByText('Project').tagName).toBe('DT');
    expect(screen.getByText('project-web-product').tagName).toBe('DD');
    expect(screen.getByRole('heading', { name: 'Product shell' })).toBeTruthy();
    expectNoLegacyRenderedClasses();
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
    expectNoLegacyRenderedClasses();
  });
});

function PageHeaderForTest() {
  return <h1>Release shell</h1>;
}

function expectNoLegacyRenderedClasses() {
  expect(legacyRenderedClassTokens(document.body)).toEqual([]);
}
