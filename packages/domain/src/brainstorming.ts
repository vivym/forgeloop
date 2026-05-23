import type {
  BoundarySummary as ContractBoundarySummary,
  BrainstormingDecision,
  BrainstormingSession as ContractBrainstormingSession,
} from '@forgeloop/contracts';
import type { IsoDateTime } from './types.js';

export interface BrainstormingSession extends ContractBrainstormingSession {
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

export interface BoundarySummary extends ContractBoundarySummary {
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

export interface BoundarySummaryRevision {
  id: string;
  boundary_summary_id: string;
  brainstorming_session_id: string;
  development_plan_item_id: string;
  revision_number: number;
  summary_markdown: string;
  decision_snapshot: BrainstormingDecision[];
  decision_count: number;
  approved_by_actor_id?: string;
  approved_at?: IsoDateTime;
  created_at: IsoDateTime;
}
