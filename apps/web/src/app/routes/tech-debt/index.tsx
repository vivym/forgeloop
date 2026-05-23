import { ScaffoldRoute } from '../_scaffold';

export default function TechDebtRoute() {
  return (
    <ScaffoldRoute
      notice="Tech debt inventory is loading from typed tech debt read models."
      sectionTitle="Tech debt backlog"
      subtitle="Technical debt narratives, mitigation plans, and evidence."
      title="Tech Debt"
    />
  );
}
