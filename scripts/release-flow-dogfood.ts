import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  renderReleaseFlowVerificationReport,
  requiredReleaseFlowReportMarkers,
  runDeterministicReleaseFlowDogfood,
} from './dogfood/release-flow-core.js';

const reportPath = resolve(
  process.env.FORGELOOP_RELEASE_FLOW_DOGFOOD_REPORT_PATH ??
    'docs/superpowers/reports/p1-release-risk-radar-verification.md',
);

const writeReport = async (content: string): Promise<void> => {
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, content, 'utf8');
};

export const main = async (): Promise<number> => {
  const markers = await runDeterministicReleaseFlowDogfood();
  const report = renderReleaseFlowVerificationReport(markers);
  await writeReport(report);
  console.log(`Release flow dogfood completed. Report: ${reportPath}`);
  return 0;
};

export { requiredReleaseFlowReportMarkers };

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
