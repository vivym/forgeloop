import { ScaffoldRoute } from '../_scaffold';

export default function ReleaseReadinessReportRoute() {
  return (
    <ScaffoldRoute
      notice="Release readiness report data is loading from release evidence read models."
      sectionTitle="Release readiness report"
      subtitle="Readiness evidence, blockers, and gate state."
      title="Release Readiness Report"
    />
  );
}
