import { ScaffoldRoute } from '../_scaffold';

export default function NewTechDebtRoute() {
  return (
    <ScaffoldRoute
      notice="Tech debt creation will write through typed product commands."
      sectionTitle="New tech debt"
      subtitle="Capture a tech debt narrative and mitigation context."
      title="New Tech Debt"
    />
  );
}
