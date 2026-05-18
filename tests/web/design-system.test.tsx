// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Section } from '../../apps/web/src/shared/layout/section/section';
import { Button } from '../../apps/web/src/shared/ui/button/button';

describe('design system primitives', () => {
  it('renders semantic buttons with stable accessible names', () => {
    render(<Button iconLeading={null}>Create Spec</Button>);
    expect(screen.getByRole('button', { name: 'Create Spec' })).toBeTruthy();
  });

  it('renders page sections without nested card markup', () => {
    render(<Section title="Release scope">Content</Section>);
    expect(screen.getByRole('heading', { name: 'Release scope' })).toBeTruthy();
    expect(document.querySelector('.panel')).toBeNull();
    expect(document.querySelector('.workbench-grid')).toBeNull();
  });
});
