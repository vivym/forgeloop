import { useParams } from 'react-router';

import { ObjectEvidenceRoute } from '../../../../features/project-management/object-evidence-route';
import { useBugQuery } from '../../../../shared/api/hooks';

export default function BugEvidenceRoute() {
  const { bugId } = useParams();
  const query = useBugQuery(bugId);

  return (
    <ObjectEvidenceRoute
      detail={query.data}
      detailError={query.error}
      detailLoading={query.isLoading}
      objectLabel="Bug"
      sourceHref={bugId === undefined ? undefined : `/bugs/${encodeURIComponent(bugId)}`}
    />
  );
}
