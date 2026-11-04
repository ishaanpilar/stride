import {
  requireOptionalNativeModule,
  type NativeModule,
} from 'expo-modules-core';
import { Platform } from 'react-native';

export type StrideSiriActionOperation = 'create' | 'update' | 'delete';
export type StrideSiriActionClearField =
  'description' | 'dueDate' | 'projectId';
export type StrideSiriActionOutcome = 'persisted' | 'rejected';
export type StrideSiriActionRejectionReason =
  'stale' | 'missing' | 'unsupported' | 'invalid' | 'expired' | 'cancelled';

export interface StrideSiriActionFields {
  title?: string;
  description?: string;
  dueDate?: string;
  tags?: string[];
  projectId?: string;
  isFocusedToday?: boolean;
  isCompleted?: boolean;
}

export interface StrideSiriActionRequest {
  version: 1;
  id: string;
  operation: StrideSiriActionOperation;
  targetId?: string;
  expectedToken?: string;
  createdAt: number;
  expiresAt: number;
  fields: StrideSiriActionFields;
  clearFields: StrideSiriActionClearField[];
}

export interface StrideSiriActionResult {
  outcome: StrideSiriActionOutcome;
  reason?: StrideSiriActionRejectionReason;

  task?: string;
}

export interface StrideSiriActionsSubscription {
  remove(): void;
}

interface StrideIosSiriActionsNativeModule extends NativeModule {
  claimPending?: () => Promise<StrideSiriActionRequest[]>;
  acknowledge?: (id: string, resultJSON: string) => Promise<void>;
  publishSnapshot?: (snapshotJSON: string) => Promise<void>;
  setAccessAllowed?: (allowed: boolean) => Promise<void>;
  addListener?: (
    eventName: 'onPendingActionsChanged',
    listener: () => void,
  ) => StrideSiriActionsSubscription;
}

let cachedNativeModule: StrideIosSiriActionsNativeModule | null | undefined;

function getNativeModule(): StrideIosSiriActionsNativeModule | null {
  if (Platform.OS !== 'ios') return null;
  if (cachedNativeModule !== undefined) return cachedNativeModule;
  try {
    cachedNativeModule =
      requireOptionalNativeModule<StrideIosSiriActionsNativeModule>(
        'StrideIosSiriActions',
      ) ?? null;
  } catch {
    cachedNativeModule = null;
  }
  return cachedNativeModule;
}


export async function claimPending(): Promise<StrideSiriActionRequest[]> {
  const nativeModule = getNativeModule();
  const claim = nativeModule?.claimPending;
  if (typeof claim !== 'function') return [];
  return claim.call(nativeModule);
}


export async function acknowledge(
  id: string,
  resultJSON: string,
): Promise<void> {
  if (Platform.OS !== 'ios') return;
  const nativeModule = getNativeModule();
  const acknowledgeRequest = nativeModule?.acknowledge;
  if (typeof acknowledgeRequest !== 'function') {
    throw new Error(
      'StrideIosSiriActions native acknowledge method is unavailable',
    );
  }
  await acknowledgeRequest.call(nativeModule, id, resultJSON);
}


export async function publishSnapshot(snapshotJSON: string): Promise<void> {
  const nativeModule = getNativeModule();
  const publish = nativeModule?.publishSnapshot;
  if (typeof publish !== 'function') return;
  await publish.call(nativeModule, snapshotJSON);
}


export async function setAccessAllowed(allowed: boolean): Promise<void> {
  const nativeModule = getNativeModule();
  const setAllowed = nativeModule?.setAccessAllowed;
  if (typeof setAllowed !== 'function') return;
  await setAllowed.call(nativeModule, allowed);
}


export function subscribePendingActionsChanged(
  listener: () => void,
): StrideSiriActionsSubscription {
  try {
    const nativeModule = getNativeModule();
    if (!nativeModule || typeof nativeModule.addListener !== 'function') {
      return { remove: () => undefined };
    }
    return nativeModule.addListener('onPendingActionsChanged', listener);
  } catch {
    return { remove: () => undefined };
  }
}
