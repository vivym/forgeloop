import { InlineNotice } from '../../shared/ui';

export type SurfaceState = 'loading' | 'empty' | 'error' | 'stale' | 'blocked' | 'approved' | 'running' | 'resumable';

const stateCopy: Record<SurfaceState, { title: string; description: string; tone: 'info' | 'neutral' | 'danger' | 'warning' | 'success' }> = {
  loading: {
    title: 'Loading state',
    description: 'Content is being loaded and controls keep their layout position.',
    tone: 'info',
  },
  empty: {
    title: 'Empty state',
    description: 'No matching objects exist yet; creation and linking actions remain visible.',
    tone: 'neutral',
  },
  error: {
    title: 'Error state',
    description: 'The surface could not load and exposes a recoverable status message.',
    tone: 'danger',
  },
  stale: {
    title: 'Stale state',
    description: 'Upstream requirements or planning decisions changed after this view was generated.',
    tone: 'warning',
  },
  blocked: {
    title: 'Blocked state',
    description: 'A gate is blocking forward movement and the blocking reason is visible.',
    tone: 'warning',
  },
  approved: {
    title: 'Approved state',
    description: 'The current artifact or gate is approved and can feed the next step.',
    tone: 'success',
  },
  running: {
    title: 'Running state',
    description: 'Execution is active and progress is represented with text, not color alone.',
    tone: 'info',
  },
  resumable: {
    title: 'Resumable state',
    description: 'Interrupted work can continue from the saved execution context.',
    tone: 'warning',
  },
};

export function SurfaceStateIndicator({ label, state }: { label: string; state?: SurfaceState | undefined }) {
  if (state === undefined) return null;
  const copy = stateCopy[state];

  return (
    <InlineNotice
      aria-label={`${label} ${copy.title}`}
      data-testid={`surface-state-${state}`}
      description={copy.description}
      title={`${label}: ${copy.title}`}
      tone={copy.tone}
    />
  );
}

export function stateFromStatus(status: string | undefined): SurfaceState | undefined {
  const normalized = status?.toLowerCase().replaceAll('_', '-');
  if (normalized === undefined) return undefined;
  if (normalized.includes('stale')) return 'stale';
  if (normalized.includes('blocked')) return 'blocked';
  if (normalized.includes('approved') || normalized.includes('accepted')) return 'approved';
  if (normalized.includes('running') || normalized.includes('active')) return 'running';
  if (normalized.includes('resumable') || normalized.includes('interrupted')) return 'resumable';
  return undefined;
}
