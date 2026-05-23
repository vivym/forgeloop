import { ScaffoldRoute } from '../_scaffold';

export default function TasksRoute() {
  return (
    <ScaffoldRoute
      notice="Tasks inventory is loading from first-class task read models."
      sectionTitle="Task backlog"
      subtitle="Execution work, evidence packages, runs, and reviews."
      title="Tasks"
    />
  );
}
