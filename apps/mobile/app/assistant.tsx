import React from 'react';
import { useRouter } from 'expo-router';

import { AssistantScreen } from '../components/assistant/assistant-screen';
import { ThemedAlertHost } from '../components/themed-alert';

export default function AssistantRoute() {
  const router = useRouter();
  return (
    <>
      <AssistantScreen
        onClose={() => (router.canGoBack() ? router.back() : router.replace('/inbox'))}
        onOpenAiSettings={() => router.push({ pathname: '/settings', params: { settingsScreen: 'ai' } } as never)}
      />
      <ThemedAlertHost />
    </>
  );
}
