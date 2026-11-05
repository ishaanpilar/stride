import React from 'react';
import { useRouter } from 'expo-router';

import { AiCaptureScreen } from '../components/ai-capture/ai-capture-screen';
import { ThemedAlertHost } from '../components/themed-alert';

export default function AiCaptureRoute() {
  const router = useRouter();
  return (
    <>
      <AiCaptureScreen
        onClose={() => (router.canGoBack() ? router.back() : router.replace('/inbox'))}
        onOpenAiSettings={() => router.push({ pathname: '/settings', params: { settingsScreen: 'ai' } } as never)}
      />
      <ThemedAlertHost />
    </>
  );
}
