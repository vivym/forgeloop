import { ScaffoldRoute } from '../_scaffold';

export default function BoardRoute() {
  return (
    <ScaffoldRoute
      notice="Board cards are loading from project-management read models."
      sectionTitle="Delivery board"
      subtitle="Typed objects arranged by delivery state."
      title="Board"
    />
  );
}
