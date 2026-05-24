import { PageHeader, Section } from '../../shared/layout';
import { InlineNotice } from '../../shared/ui';

export default function ProductNotFoundRoute() {
  return (
    <>
      <PageHeader subtitle="This product route is not available." title="Not Found" />
      <Section title="Route unavailable">
        <InlineNotice title="The requested product route was not found." tone="warning" />
      </Section>
    </>
  );
}
