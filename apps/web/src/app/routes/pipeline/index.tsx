import { PageHeader, Section } from '../../../shared/layout';

export default function PipelineRoute() {
  return (
    <>
      <PageHeader title="Pipeline" subtitle="Delivery stages, blockers, and flow health will be summarized here." />
      <Section title="Pipeline overview" description="This skeleton reserves the product pipeline view without adding workflow behavior yet.">
        <p>No pipeline stages are loaded in this skeleton.</p>
      </Section>
    </>
  );
}
