import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetItem = vi.hoisted(() => vi.fn());
const mockSetItem = vi.hoisted(() => vi.fn());
const mockRemoveItem = vi.hoisted(() => vi.fn());

vi.mock('@react-native-async-storage/async-storage', () => ({
    default: {
        getItem: mockGetItem,
        setItem: mockSetItem,
        removeItem: mockRemoveItem,
    },
}));

import { readQuickCaptureAddAnother, writeQuickCaptureAddAnother } from './quick-capture-preferences';

describe('quick-capture-preferences', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetItem.mockResolvedValue(null);
    });

    it('round-trips the sticky Add another preference (#819)', async () => {
        expect(await readQuickCaptureAddAnother()).toBe(false);

        await writeQuickCaptureAddAnother(true);
        expect(mockSetItem).toHaveBeenCalledWith('mindwtr:quickCapture:addAnother', 'true');

        mockGetItem.mockResolvedValue('true');
        expect(await readQuickCaptureAddAnother()).toBe(true);

        await writeQuickCaptureAddAnother(false);
        expect(mockRemoveItem).toHaveBeenCalledWith('mindwtr:quickCapture:addAnother');
    });

    it('treats storage failures as preference off', async () => {
        mockGetItem.mockRejectedValue(new Error('unavailable'));
        expect(await readQuickCaptureAddAnother()).toBe(false);
        mockSetItem.mockRejectedValue(new Error('unavailable'));
        await expect(writeQuickCaptureAddAnother(true)).resolves.toBeUndefined();
    });
});
