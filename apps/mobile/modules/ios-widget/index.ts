import { requireOptionalNativeModule, type NativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

export interface IosWidgetPendingCompletion {
  id: string;
  taskId: string;
  token: string;
  createdAt: number;
  notBefore: number;
  claimed: boolean;
}

interface StrideIosWidgetNativeModule extends NativeModule {
  claimPendingCompletions?: () => Promise<IosWidgetPendingCompletion[]>;
  acknowledgePendingCompletion?: (id: string) => Promise<void>;
  getNextPendingCompletionAt?: () => Promise<number | null>;
}

const nativeModule = Platform.OS === 'ios'
  ? requireOptionalNativeModule<StrideIosWidgetNativeModule>('StrideIosWidget')
  : null;

function requireLinkedMethod<K extends keyof StrideIosWidgetNativeModule>(
  name: K,
): NonNullable<StrideIosWidgetNativeModule[K]> | null {
  if (Platform.OS !== 'ios' || !nativeModule) return null;
  const method = nativeModule[name];
  if (typeof method !== 'function') {
    throw new Error(`StrideIosWidget native method ${String(name)} is unavailable`);
  }
  return method.bind(nativeModule) as NonNullable<StrideIosWidgetNativeModule[K]>;
}


export async function claimPendingCompletions(): Promise<IosWidgetPendingCompletion[]> {
  const claim = requireLinkedMethod('claimPendingCompletions');
  if (!claim) return [];
  return claim();
}


export async function acknowledgePendingCompletion(id: string): Promise<void> {
  const acknowledge = requireLinkedMethod('acknowledgePendingCompletion');
  if (!acknowledge) return;
  await acknowledge(id);
}


export async function getNextPendingCompletionAt(): Promise<number | null> {
  const getNext = requireLinkedMethod('getNextPendingCompletionAt');
  if (!getNext) return null;
  return getNext();
}
