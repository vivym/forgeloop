import { ScaffoldRoute } from '../../../_scaffold';

export default function TaskPackageEvidenceRoute() {
  return (
    <ScaffoldRoute
      notice="Execution package evidence will be task-scoped."
      sectionTitle="Package evidence"
      subtitle="Package evidence attached to this task."
      title="Task Package"
    />
  );
}
