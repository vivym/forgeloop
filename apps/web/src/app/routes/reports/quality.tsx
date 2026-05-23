import { ScaffoldRoute } from '../_scaffold';

export default function QualityReportRoute() {
  return (
    <ScaffoldRoute
      notice="Quality report data is loading from project-management read models."
      sectionTitle="Quality report"
      subtitle="Defect, review, and validation signals."
      title="Quality Report"
    />
  );
}
