import { generateUUID } from '@stride/core';
import type { GmailCaptureTransport } from '@stride/core/gmail-capture';
import { createGmailCaptureTransport, type GmailAuthorization } from '@stride/core/gmail-capture-transport';
import { DOMParser } from '@xmldom/xmldom';
import { getGmailReceiptStore } from './gmail-capture-storage';


let transport: GmailCaptureTransport | undefined;
function getTransport(): GmailCaptureTransport {
    if (!transport) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { requireOptionalNativeModule } = require('expo-modules-core') as typeof import('expo-modules-core');
        transport = createGmailCaptureTransport(requireOptionalNativeModule<GmailAuthorization>('StrideGmailAuthorization'),
            getGmailReceiptStore, generateUUID, DOMParser);
    }
    return transport;
}
export const gmailCaptureTransport: GmailCaptureTransport = {
    status: () => getTransport().status(), connect: () => getTransport().connect(), cancel: () => getTransport().cancel(),
    labels: () => getTransport().labels(), configure: (labelId, enabled) => getTransport().configure(labelId, enabled),
    disconnect: () => getTransport().disconnect(), poll: () => getTransport().poll(),
    validate: (batchId) => getTransport().validate(batchId), commit: (batchId) => getTransport().commit(batchId),
};
