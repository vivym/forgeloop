import { describe, expect, it } from 'vitest';

import { requiredReleaseFlowReportMarkers } from '../../scripts/release-flow-dogfood';

describe('release flow dogfood script helpers', () => {
  it('exports the exact required verification report markers', () => {
    expect(requiredReleaseFlowReportMarkers).toEqual([
      'P0 delivery path',
      'Release create/link/submit',
      'Release approval or override approval',
      'Release observing/close',
      'Release cockpit query',
      'Release replay redaction',
      'Release observation backlink projection',
      'Durable local reset',
      'Strict local_codex run',
    ]);
  });
});
