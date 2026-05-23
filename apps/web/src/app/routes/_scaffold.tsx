import { PageHeader, Section } from '../../shared/layout';
import { InlineNotice } from '../../shared/ui';

interface ScaffoldRouteProps {
  notice: string;
  sectionTitle: string;
  subtitle: string;
  title: string;
}

export function ScaffoldRoute({ notice, sectionTitle, subtitle, title }: ScaffoldRouteProps) {
  return (
    <>
      <PageHeader subtitle={subtitle} title={title} />
      <Section title={sectionTitle}>
        <InlineNotice description="This target route is ready for the project-management read models in the next task." title={notice} tone="info" />
      </Section>
    </>
  );
}
