import { DevToolsRoute as EnabledDevToolsRoute } from '../../../features/dev-tools/dev-tools-route';
import { useRuntimeFlags } from '../../../shared/context/runtime-flags';
import { PageHeader, Section } from '../../../shared/layout';

export default function DevToolsRoute() {
  const runtimeFlags = useRuntimeFlags();

  if (!runtimeFlags.devToolsEnabled) {
    return (
      <>
        <PageHeader title="Dev Tools" subtitle="Raw/debug tools are disabled for this runtime." />
        <Section title="Disabled" description="Set the dev tools flag for local diagnostic routes.">
          <p>Dev Tools are not enabled.</p>
        </Section>
      </>
    );
  }

  return <EnabledDevToolsRoute />;
}
