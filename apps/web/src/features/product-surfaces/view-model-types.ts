export type ViewModelSignalState = 'available' | 'unavailable' | 'stale' | 'blocked' | 'ready' | 'pending';

export interface ViewModelMetadata {
  label: string;
  value: string;
  href?: string | undefined;
}

export interface ViewModelGate {
  label: string;
  state: string;
  owner?: string | undefined;
  disabledReason?: string | undefined;
  href?: string | undefined;
}

export interface ViewModelEvidence {
  label: string;
  state: ViewModelSignalState;
  compactText: string;
  href?: string | undefined;
  recoveryHref?: string | undefined;
}

export interface ViewModelAction {
  id: string;
  label: string;
  enabled: boolean;
  disabledReason?: string | undefined;
  href?: string | undefined;
}

export interface FirstViewportViewModel {
  objectLabel: string;
  objectType: string;
  currentState: string;
  nextAction: string;
  disabledReason: string | undefined;
  primaryActorOrRole: string;
  riskSignal: string;
  gateProgress: ViewModelGate[];
  criticalEvidence: ViewModelEvidence[];
  secondaryMetadata: ViewModelMetadata[];
  previewSummary: string;
  timelineSummary: string;
}

export interface ProductPageViewModel extends FirstViewportViewModel {
  actions?: ViewModelAction[] | undefined;
  bulkAction?: ViewModelAction | undefined;
  conclusion?: string | undefined;
  suggestedAction?: ViewModelAction | undefined;
  items?: ViewModelMetadata[] | undefined;
}
