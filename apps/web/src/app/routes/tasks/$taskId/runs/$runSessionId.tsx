import { ScaffoldRoute } from '../../../_scaffold';

export default function TaskRunEvidenceRoute() {
  return (
    <ScaffoldRoute
      notice="Run evidence will be task-scoped."
      sectionTitle="Run evidence"
      subtitle="Run session evidence attached to this task."
      title="Task Run"
    />
  );
}
