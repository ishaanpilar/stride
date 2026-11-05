import { useId, useMemo } from 'react';
import { PartyPopper } from 'lucide-react';

import { useLanguage } from '../../contexts/language-context';
import { toReleaseNotesMarkdown } from '../../lib/app-updater';
import { useAppUpdaterStore } from '../../lib/app-updater-store';
import { AssistantMarkdown } from '../views/assistant/AssistantMarkdown';
import { Button } from '../ui/Button';
import { Dialog, DialogBody, DialogFooter, DialogHeader } from '../ui/Dialog';
import { updaterText } from './update-copy';

export function WhatsNewDialog({ blocked = false }: { blocked?: boolean }) {
    const { t } = useLanguage();
    const titleId = useId();
    const whatsNew = useAppUpdaterStore((state) => state.whatsNew);
    const dismissWhatsNew = useAppUpdaterStore((state) => state.dismissWhatsNew);
    const notes = useMemo(() => toReleaseNotesMarkdown(whatsNew?.notes ?? ''), [whatsNew?.notes]);

    if (!whatsNew || blocked) return null;

    return (
        <Dialog
            onClose={dismissWhatsNew}
            labelledBy={titleId}
            overlayClassName="z-[60] px-4"
            panelClassName="max-w-lg max-h-[80vh] rounded-sheet"
        >
            <DialogHeader className="px-5 pt-5 pb-3">
                <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control bg-accent-soft text-accent-text">
                        <PartyPopper className="h-4 w-4" aria-hidden="true" />
                    </div>
                    <h3 id={titleId} className="text-[17px] font-semibold leading-6">
                        {updaterText(t, 'whatsNewTitle', { version: whatsNew.version })}
                    </h3>
                </div>
            </DialogHeader>
            <DialogBody className="flex-1 px-5 pb-2">
                <div data-testid="whats-new-notes" className="rounded-card bg-well p-3 shadow-soft-inset">
                    {notes
                        ? <AssistantMarkdown text={notes} quotedNames="text" className="max-w-none" />
                        : <p className="text-sm text-muted-foreground">{updaterText(t, 'noNotes')}</p>}
                </div>
            </DialogBody>
            <DialogFooter className="flex justify-end px-5 py-4">
                <Button onClick={dismissWhatsNew}>{updaterText(t, 'whatsNewDone')}</Button>
            </DialogFooter>
        </Dialog>
    );
}
