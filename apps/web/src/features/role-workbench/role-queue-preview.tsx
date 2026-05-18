import { Link } from 'react-router';

import { Badge } from '../../shared/ui';
import type { RoleQueueItemViewModel } from './role-workbench-view-model';

export function RoleQueuePreview({ item }: { item: RoleQueueItemViewModel | undefined }) {
  if (item === undefined) {
    return <p className="empty">Select an owned work item to inspect its next action.</p>;
  }

  return (
    <div className="detail-block">
      <div className="entity-summary">
        <strong>{item.title}</strong>
        <span>
          {item.objectType} / {item.kind} / {item.surface}
        </span>
      </div>
      <div className="pill-list">
        <Badge tone="primary">{item.state}</Badge>
        <Badge tone="warning">{item.risk} risk</Badge>
      </div>
      <Link className="fl-button fl-button--primary" to={`/work-items/${encodeURIComponent(item.objectId)}`}>
        {item.nextAction}
      </Link>
    </div>
  );
}
