import { PageHeader, Section } from '../../../shared/layout';

export default function WorkbenchRoute() {
  return (
    <>
      <PageHeader title="Workbench" subtitle="Role-based product work queues will appear here as product routes are implemented." />
      <Section title="Work queue" description="This route is ready for the product workbench surface. Queue data and actions are implemented in later tasks.">
        <p>No workbench items are loaded in this skeleton.</p>
      </Section>
    </>
  );
}
