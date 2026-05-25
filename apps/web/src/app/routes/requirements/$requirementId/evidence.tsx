import { useParams } from 'react-router';

import { ObjectEvidenceRoute } from '../../../../features/project-management/object-evidence-route';
import { useRequirementQuery } from '../../../../shared/api/hooks';

export default function RequirementEvidenceRoute() {
  const { requirementId } = useParams();
  const query = useRequirementQuery(requirementId);

  return (
    <ObjectEvidenceRoute
      detail={query.data}
      detailError={query.error}
      detailLoading={query.isLoading}
      evidenceQueryPath={requirementId === undefined ? undefined : `/query/requirements/${encodeURIComponent(requirementId)}/evidence`}
      objectId={requirementId}
      objectLabel="Requirement"
      sourceHref={requirementId === undefined ? undefined : `/requirements/${encodeURIComponent(requirementId)}`}
    />
  );
}
