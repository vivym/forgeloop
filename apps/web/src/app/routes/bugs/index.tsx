import { ScaffoldRoute } from '../_scaffold';

export default function BugsRoute() {
  return (
    <ScaffoldRoute
      notice="Bugs inventory is loading from typed bug read models."
      sectionTitle="Bug backlog"
      subtitle="Bug narratives, triage, task flow, and evidence."
      title="Bugs"
    />
  );
}
