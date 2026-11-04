import { workspaceSessionStorage as AsyncStorage } from '@/lib/workspace-session-storage';


// LEGACY: pre-Stride-rename value, kept so existing stored user data stays readable.
const ADD_ANOTHER_STORAGE_KEY = 'mindwtr:quickCapture:addAnother';

export async function readQuickCaptureAddAnother(): Promise<boolean> {
    try {
        return (await AsyncStorage.getItem(ADD_ANOTHER_STORAGE_KEY)) === 'true';
    } catch {
        return false;
    }
}

export async function writeQuickCaptureAddAnother(enabled: boolean): Promise<void> {
    try {
        if (enabled) {
            await AsyncStorage.setItem(ADD_ANOTHER_STORAGE_KEY, 'true');
        } else {
            await AsyncStorage.removeItem(ADD_ANOTHER_STORAGE_KEY);
        }
    } catch {

    }
}
