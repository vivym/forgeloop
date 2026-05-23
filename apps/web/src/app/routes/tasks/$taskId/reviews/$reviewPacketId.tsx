import { ScaffoldRoute } from '../../../_scaffold';

export default function TaskReviewEvidenceRoute() {
  return (
    <ScaffoldRoute
      notice="Review evidence will be task-scoped."
      sectionTitle="Review evidence"
      subtitle="Review packet evidence attached to this task."
      title="Task Review"
    />
  );
}
