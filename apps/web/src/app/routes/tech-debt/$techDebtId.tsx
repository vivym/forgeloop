import { ScaffoldRoute } from '../_scaffold';

export default function TechDebtDetailRoute() {
  return (
    <ScaffoldRoute
      notice="Tech debt detail is loading from typed tech debt read models."
      sectionTitle="Tech debt detail"
      subtitle="Narrative, mitigation state, task flow, and evidence."
      title="Tech Debt"
    />
  );
}
