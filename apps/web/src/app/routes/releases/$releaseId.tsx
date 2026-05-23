import { ScaffoldRoute } from '../_scaffold';

export default function ReleaseDetailRoute() {
  return (
    <ScaffoldRoute
      notice="Release detail is loading from governed release readiness read models."
      sectionTitle="Release readiness"
      subtitle="Release scope, decisions, evidence, and readiness state."
      title="Release"
    />
  );
}
