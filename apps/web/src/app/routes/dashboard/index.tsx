import { ScaffoldRoute } from '../_scaffold';

export default function DashboardRoute() {
  return (
    <ScaffoldRoute
      notice="Dashboard metrics are loading from project-management read models."
      sectionTitle="Project overview"
      subtitle="Project health, flow, and delivery signals."
      title="Dashboard"
    />
  );
}
