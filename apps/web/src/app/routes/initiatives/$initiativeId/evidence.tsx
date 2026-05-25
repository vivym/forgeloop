import { useParams } from 'react-router';

import { ObjectEvidenceRoute } from '../../../../features/project-management/object-evidence-route';
import { useInitiativeQuery } from '../../../../shared/api/hooks';

export default function InitiativeEvidenceRoute() {
  const { initiativeId } = useParams();
  const query = useInitiativeQuery(initiativeId);

  return (
    <ObjectEvidenceRoute
      detail={query.data}
      detailError={query.error}
      detailLoading={query.isLoading}
      evidenceQueryPath={initiativeId === undefined ? undefined : `/query/initiatives/${encodeURIComponent(initiativeId)}/evidence`}
      objectId={initiativeId}
      objectLabel="Initiative"
      sourceHref={initiativeId === undefined ? undefined : `/initiatives/${encodeURIComponent(initiativeId)}`}
    />
  );
}
