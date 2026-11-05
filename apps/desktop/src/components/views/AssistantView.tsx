import { AssistantPanel } from './assistant/AssistantPanel';

/** Full-page Assistant view. The chat lives in AssistantPanel, shared with the right-hand dock. */
export function AssistantView({ onOpenAiSettings }: { onOpenAiSettings?: () => void }) {
    return <AssistantPanel variant="page" onOpenAiSettings={onOpenAiSettings} />;
}
