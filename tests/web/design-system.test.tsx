// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Section } from '../../apps/web/src/shared/layout';
import { Button, Dialog, DialogClose, Drawer, DrawerClose, Toast, ToastAction, ToastClose, ToastProvider } from '../../apps/web/src/shared/ui';

describe('design system primitives', () => {
  it('renders semantic buttons with stable accessible names', () => {
    render(<Button iconLeading={null}>Create Spec</Button>);
    expect(screen.getByRole('button', { name: 'Create Spec' })).toBeTruthy();
  });

  it('preserves button action context while loading', () => {
    render(<Button loading>Create Spec</Button>);
    expect(screen.getByRole('button', { name: 'Loading Create Spec' })).toBeTruthy();
  });

  it('renders page sections without nested card markup', () => {
    render(<Section title="Release scope">Content</Section>);
    expect(screen.getByRole('heading', { name: 'Release scope' })).toBeTruthy();
    expect(document.querySelector('.panel')).toBeNull();
    expect(document.querySelector('.workbench-grid')).toBeNull();
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
  });
});
