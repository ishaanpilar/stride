import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { AlertTriangle } from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTaskStore, type PersistenceFailure } from '@stride/core';

import { useLanguage } from '@/contexts/language-context';
import { useThemeColors } from '@/hooks/use-theme-colors';

type PersistenceFailureBannerViewProps = {
  failure: PersistenceFailure | null;
  onRetry: () => void;
};

export function PersistenceFailureBannerView({ failure, onRetry }: PersistenceFailureBannerViewProps) {
  const { t } = useLanguage();
  const tc = useThemeColors();
  if (!failure) return null;

  return (
    <SafeAreaView pointerEvents="box-none" edges={['top']} style={styles.host}>
      <View
        accessibilityLiveRegion="assertive"
        accessibilityRole="alert"
        style={[styles.banner, { backgroundColor: tc.cardBg, borderColor: tc.danger }]}
      >
        <AlertTriangle color={tc.danger} size={20} strokeWidth={2.2} />
        <Text style={[styles.message, { color: tc.text }]}>{t('persistence.failureMessage')}</Text>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityState={{ busy: failure.retrying, disabled: failure.retrying }}
          activeOpacity={0.82}
          disabled={failure.retrying}
          onPress={onRetry}
          style={[styles.retryButton, { backgroundColor: tc.tint }, failure.retrying ? styles.disabled : null]}
        >
          {failure.retrying ? <ActivityIndicator color="#ffffff" size="small" /> : null}
          <Text style={styles.retryText}>
            {failure.retrying ? t('persistence.retrying') : t('errorBoundary.retry')}
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

export function PersistenceFailureBanner() {
  const failure = useTaskStore((state) => state.persistenceFailure);
  const retryPersistence = useTaskStore((state) => state.retryPersistence);

  return (
    <PersistenceFailureBannerView
      failure={failure}
      onRetry={() => { void retryPersistence().catch(() => undefined); }}
    />
  );
}

const styles = StyleSheet.create({
  host: {
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 100,
  },
  banner: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    elevation: 8,
    flexDirection: 'row',
    gap: 10,
    marginHorizontal: 12,
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.18,
    shadowRadius: 8,
  },
  message: {
    flex: 1,
    fontSize: 14,
    lineHeight: 19,
  },
  retryButton: {
    alignItems: 'center',
    borderRadius: 8,
    flexDirection: 'row',
    gap: 6,
    minHeight: 40,
    paddingHorizontal: 12,
  },
  retryText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
  disabled: {
    opacity: 0.65,
  },
});
