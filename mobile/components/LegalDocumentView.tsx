import { LegalTextView, type LegalDocumentKind } from './LegalTextView';

type Props = {
  kind: LegalDocumentKind;
  /** Ignored — title comes from ScreenPageHeader inside LegalTextView. */
  showTitle?: boolean;
  showAccept?: boolean;
  onAccept?: () => void;
  onBack?: () => void;
};

/** Compatibility wrapper for older imports / expo-router screens. */
export function LegalDocumentView({ kind, showAccept, onAccept, onBack }: Props) {
  return (
    <LegalTextView kind={kind} showAccept={showAccept ?? false} onAccept={onAccept} onBack={onBack} />
  );
}

export type { LegalDocumentKind };
