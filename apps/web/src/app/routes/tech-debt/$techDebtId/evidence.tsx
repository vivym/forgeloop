import { useParams } from 'react-router';

import { ObjectEvidenceRoute } from '../../../../features/project-management/object-evidence-route';
import { useTechDebtDetailQuery } from '../../../../shared/api/hooks';

export default function TechDebtEvidenceRoute() {
  const { techDebtId } = useParams();
  const query = useTechDebtDetailQuery(techDebtId);

  return (
    <ObjectEvidenceRoute
      detail={query.data}
      detailError={query.error}
      detailLoading={query.isLoading}
      objectLabel="Tech Debt"
      sourceHref={techDebtId === undefined ? undefined : `/tech-debt/${encodeURIComponent(techDebtId)}`}
    />
  );
}
