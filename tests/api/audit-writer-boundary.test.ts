import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('audit writer boundary', () => {
  it('does not make release depend on review evidence for shared audit writes', () => {
    const releaseService = readFileSync('apps/control-plane-api/src/modules/release/release.service.ts', 'utf8');
    expect(releaseService).toContain('AuditWriterService');
    expect(releaseService).not.toContain('ReviewEvidenceService');
  });

  it('keeps Work Item evidence chain as a public product route', () => {
    const controller = readFileSync('apps/control-plane-api/src/modules/review-evidence/work-item-evidence.controller.ts', 'utf8');
    expect(controller).toContain("@Get('work-items/:workItemId/evidence-chain')");
  });
});
