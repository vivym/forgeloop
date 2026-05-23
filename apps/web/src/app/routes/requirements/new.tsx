import { ScaffoldRoute } from '../_scaffold';

export default function NewRequirementRoute() {
  return (
    <ScaffoldRoute
      notice="Requirement creation will write through typed product commands."
      sectionTitle="New requirement"
      subtitle="Capture a requirement narrative and delivery context."
      title="New Requirement"
    />
  );
}
