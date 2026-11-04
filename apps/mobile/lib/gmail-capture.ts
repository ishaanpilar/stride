import { createGmailCaptureRuntime } from '@stride/core/gmail-capture';
import { gmailCaptureTransport } from './gmail-capture-service';

export const {
    getGmailCaptureConfig, getGmailCaptureLabels, connectGmailCapture, cancelGmailCapture,
    configureGmailCapture, disconnectGmailCapture, getGmailCaptureStatus, subscribeGmailCaptureStatus,
    createGmailCaptureController, registerGmailCaptureController, pollGmailCaptureNow,
} = createGmailCaptureRuntime(gmailCaptureTransport);

export { gmailCaptureErrorTranslation, toGmailCaptureError } from '@stride/core/gmail-capture';
export { clearGmailReceiptsReset, gmailReceiptsWereReset } from './gmail-capture-storage';
export type { GmailCaptureConfig, GmailCaptureLabel, GmailCaptureController } from '@stride/core/gmail-capture';
