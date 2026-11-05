import React, { useCallback, useEffect } from 'react';
import { BackHandler } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { FocusStage } from '@/components/focus/FocusStage';
import { useFocusSessionHost } from '@/components/focus/useFocusSessionHost';
import { focusSessionStore, useFocusSessionUi } from '@/lib/focus-session-store';

export default function FocusSessionScreen() {
  const router = useRouter();
  const ui = useFocusSessionUi();
  const host = useFocusSessionHost();

  const leave = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, [router]);

  const minimise = useCallback(() => {
    focusSessionStore.minimise();
    leave();
  }, [leave]);

  useEffect(() => {
    if (!ui.open) leave();
  }, [leave, ui.open]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (host.active) minimise();
      else host.closeFinished();
      return true;
    });
    return () => subscription.remove();
  }, [host, leave, minimise]);

  return (
    <>
      <Stack.Screen options={{ headerShown: false, presentation: 'fullScreenModal', animation: 'slide_from_bottom', gestureEnabled: false }} />
      <FocusStage host={host} onMinimise={minimise} />
    </>
  );
}
