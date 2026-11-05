import { setPomodoroKeepGoing, usePomodoroKeepGoing } from '../../../lib/pomodoro-preferences';
import { Switch } from '../../ui/Switch';
import { SettingRow } from './SettingRow';

/** "Keep going when the timer ends": a device-local preference (default on). */
export function PomodoroKeepGoingSettingRow({ title, description, onSaved }: { title: string; description: string; onSaved?: () => void }) {
    const enabled = usePomodoroKeepGoing();
    return (
        <SettingRow padded settingsKey={null} title={title} description={description}>
            <Switch
                aria-label={title}
                checked={enabled}
                onCheckedChange={() => {
                    setPomodoroKeepGoing(!enabled);
                    onSaved?.();
                }}
            />
        </SettingRow>
    );
}
