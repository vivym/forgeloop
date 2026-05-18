import { PageHeader, Section } from '../../shared/layout';

export function DevToolsRoute() {
  return (
    <>
      <PageHeader title="Dev Tools" subtitle="Raw API and replay diagnostics for local debugging." />
      <Section title="Raw replay" description="Use this area for object-level replay reads and payload inspection.">
        <form>
          <label htmlFor="dev-tools-object-id">Object ID</label>
          <input id="dev-tools-object-id" name="objectId" type="text" />
          <button type="button">Load raw replay</button>
        </form>
      </Section>
      <Section title="API smoke request" description="Send a lightweight request while debugging local API behavior.">
        <button type="button">Send API smoke request</button>
      </Section>
      <Section title="Raw JSON output" description="Debug payloads will be rendered here after a raw operation.">
        <pre aria-label="Raw debug output">{JSON.stringify({ status: 'idle' }, null, 2)}</pre>
      </Section>
    </>
  );
}
