import { useId } from 'react';
import { Button } from './ui/Button';
import { Dialog, DialogBody, DialogFooter, DialogHeader } from './ui/Dialog';

type CloseBehaviorModalProps = {
    isOpen: boolean;
    title: string;
    description: string;
    rememberLabel: string;
    stayLabel: string;
    quitLabel: string;
    cancelLabel: string;
    remember: boolean;
    onRememberChange: (next: boolean) => void;
    onStay: () => void;
    onQuit: () => void;
    onCancel: () => void;
};

export function CloseBehaviorModal({
    isOpen,
    title,
    description,
    rememberLabel,
    stayLabel,
    quitLabel,
    cancelLabel,
    remember,
    onRememberChange,
    onStay,
    onQuit,
    onCancel,
}: CloseBehaviorModalProps) {
    const titleId = useId();
    if (!isOpen) return null;
    return (
        <Dialog
            onClose={onCancel}
            labelledBy={titleId}


            closeOnBackdrop={false}
            panelClassName="mx-4"
        >
            <DialogHeader className="px-6 pt-5 pb-2">
                <h3 id={titleId} className="text-[17px] font-semibold">{title}</h3>
                <p className="text-sm text-muted-foreground mt-2">{description}</p>
            </DialogHeader>
            <DialogBody className="px-6 py-3">
                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                    <input
                        type="checkbox"
                        checked={remember}
                        onChange={(e) => onRememberChange(e.target.checked)}
                        className="h-4 w-4 accent-primary"
                    />
                    {rememberLabel}
                </label>
            </DialogBody>
            <DialogFooter className="px-6 pb-5 pt-2 flex flex-wrap gap-3 justify-end">
                <Button variant="secondary" onClick={onCancel}>
                    {cancelLabel}
                </Button>
                <Button variant="ghost" onClick={onStay}>
                    {stayLabel}
                </Button>
                <Button variant="destructive" onClick={onQuit}>
                    {quitLabel}
                </Button>
            </DialogFooter>
        </Dialog>
    );
}
