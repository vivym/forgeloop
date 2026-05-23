import { ScaffoldRoute } from '../_scaffold';

export default function NewBugRoute() {
  return (
    <ScaffoldRoute
      notice="Bug creation will write through typed product commands."
      sectionTitle="New bug"
      subtitle="Capture a bug narrative and triage context."
      title="New Bug"
    />
  );
}
