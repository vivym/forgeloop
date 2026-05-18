import { PageHeader, Section } from '../../../shared/layout';

export default function ReviewsRoute() {
  return (
    <>
      <PageHeader title="Reviews" subtitle="Review packets and decisions will be listed here." />
      <Section title="Review list" description="This skeleton reserves the reviews index route.">
        <p>No reviews are loaded in this skeleton.</p>
      </Section>
    </>
  );
}
