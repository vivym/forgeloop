import { ProductPage, Section } from '../../shared/layout';
import { EmptyState } from '../../shared/ui';

export function QaRoute() {
  return (
    <ProductPage family="qa-handoff" ariaLabel="QA">
      <h1 className="mb-3 text-xl font-semibold text-text-primary">QA</h1>
      <Section title="QA queue" variant="panel">
        <EmptyState description="QA handoff readiness is tracked from Plan Item execution evidence." title="No QA queue rows." />
      </Section>
    </ProductPage>
  );
}
