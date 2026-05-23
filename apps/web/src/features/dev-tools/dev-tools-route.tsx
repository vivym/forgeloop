import { PageHeader, Section } from '../../shared/layout';
import { Button, Field, Input } from '../../shared/ui';

export function DevToolsRoute() {
  return (
    <>
      <PageHeader title="Dev Tools" subtitle="Raw API and replay diagnostics for local debugging." />
      <Section title="Raw replay" description="Use this area for object-level replay reads and payload inspection.">
        <form className="grid gap-3">
          <Field label="Object ID">
            <Input id="dev-tools-object-id" name="objectId" type="text" />
          </Field>
          <Button type="button" variant="secondary">Load raw replay</Button>
        </form>
      </Section>
      <Section title="API smoke request" description="Send a lightweight request while debugging local API behavior.">
        <Button type="button" variant="secondary">Send API smoke request</Button>
      </Section>
      <Section title="Raw JSON output" description="Debug payloads will be rendered here after a raw operation.">
        <pre aria-label="Raw debug output" className="overflow-auto rounded-card border border-border bg-surface-muted p-4 text-sm text-text-secondary">
          {JSON.stringify({ status: 'idle' }, null, 2)}
        </pre>
      </Section>
    </>
  );
}
