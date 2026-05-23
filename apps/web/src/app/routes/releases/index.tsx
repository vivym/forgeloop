import { ScaffoldRoute } from '../_scaffold';

export default function ReleasesRoute() {
  return (
    <ScaffoldRoute
      notice="Release inventory is loading from governed release read models."
      sectionTitle="Release inventory"
      subtitle="Release readiness, scope, ownership, and gate state."
      title="Releases"
    />
  );
}
