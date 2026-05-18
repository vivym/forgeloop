import { PageHeader, Section } from '../../../shared/layout';

export default function ReleasesRoute() {
  return (
    <>
      <PageHeader title="Releases" subtitle="Release readiness and governance state will be listed here." />
      <Section title="Release list" description="This skeleton reserves the releases index route.">
        <p>No releases are loaded in this skeleton.</p>
      </Section>
    </>
  );
}
