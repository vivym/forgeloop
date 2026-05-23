import { ScaffoldRoute } from '../_scaffold';

export default function NewTaskRoute() {
  return (
    <ScaffoldRoute
      notice="Task creation will write through first-class task commands."
      sectionTitle="New task"
      subtitle="Capture execution work and task ownership."
      title="New Task"
    />
  );
}
