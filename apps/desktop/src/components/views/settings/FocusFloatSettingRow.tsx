import { setFocusFloatAutoShow, useFocusFloatAutoShow } from '../../../lib/focus-float-preferences';
import { isTauriRuntime } from '../../../lib/runtime';
import { Switch } from '../../ui/Switch';
import { SettingRow } from './SettingRow';

// English only for now, like the rest of Focus mode's strings (no locale keys yet).
const TITLE = 'Show floating timer while a session runs';
const DESCRIPTION = 'When you switch to another app, a small timer stays on top of everything, on every desktop. Close it any time; the timer keeps running.';

/** "Show floating timer while a session runs": a device-local preference (desktop app only). */
export function FocusFloatSettingRow({ onSaved }: { onSaved?: () => void }) {
    const enabled = useFocusFloatAutoShow();
    if (!isTauriRuntime()) return null;
    return (
        <SettingRow padded settingsKey={null} title={TITLE} description={DESCRIPTION}>
            <Switch
                aria-label={TITLE}
                checked={enabled}
                onCheckedChange={() => {
                    setFocusFloatAutoShow(!enabled);
                    onSaved?.();
                }}
            />
        </SettingRow>
    );
}
