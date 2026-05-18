import { PageHeader, Section } from '../../../shared/layout';

export default function PackagesRoute() {
  return (
    <>
      <PageHeader title="Packages" subtitle="Execution package status and readiness will be listed here." />
      <Section title="Package list" description="This skeleton reserves the execution package index route.">
        <p>No packages are loaded in this skeleton.</p>
      </Section>
    </>
  );
}
