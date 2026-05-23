import { ScaffoldRoute } from '../_scaffold';

export default function BugDetailRoute() {
  return (
    <ScaffoldRoute
      notice="Bug detail is loading from typed bug read models."
      sectionTitle="Bug detail"
      subtitle="Narrative, triage state, task flow, and evidence."
      title="Bug"
    />
  );
}
