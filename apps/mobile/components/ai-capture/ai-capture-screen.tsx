import React, { useCallback } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { tFallback, type MindSweepKind } from '@stride/core';

import { useLanguage } from '../../contexts/language-context';
import { useToast } from '@/contexts/toast-context';
import { useThemeColors } from '@/hooks/use-theme-colors';
import { useAiCapture } from './use-ai-capture';
import type { AiCaptureApi } from './ai-capture-services';

const KIND_LABEL: Record<MindSweepKind, [string, string]> = {
  next: ['quickCapture.kind.next', 'Next action'],
  waiting: ['quickCapture.kind.waiting', 'Waiting for'],
  calendar: ['quickCapture.kind.calendar', 'Calendar'],
  someday: ['quickCapture.kind.someday', 'Someday'],
  reference: ['quickCapture.kind.reference', 'Reference'],
  inbox: ['quickCapture.kind.inbox', 'Inbox'],
};

export type AiCaptureScreenProps = {
  onClose: () => void;
  onOpenAiSettings?: () => void;
  /** Test seam; defaults to the real AI-backed service. */
  api?: AiCaptureApi;
};

export function AiCaptureScreen({ onClose, onOpenAiSettings, api }: AiCaptureScreenProps) {
  const { t: rawT, language } = useLanguage();
  const t = useCallback((key: string, fallback: string) => tFallback(rawT, key, fallback), [rawT]);
  const tc = useThemeColors();
  const { showToast } = useToast();
  const cap = useAiCapture(language, api);
  const { step, rows, proposal, loading } = cap;

  const handleAdd = useCallback(async () => {
    const result = await cap.add();
    if (!result) return;
    showToast({
      tone: 'success',
      message: t('quickCapture.addedCount', 'Added {{count}} items').replace('{{count}}', String(result.taskIds.length)),
      actionLabel: t('common.undo', 'Undo'),
      onAction: async () => { await cap.undo(result); },
    });
  }, [cap, showToast, t]);

  const projectTitle = (ref?: string, name?: string) => name ?? (ref ? proposal?.projects.find((p) => p.ref === ref)?.title : undefined);

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: tc.bg }]} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" testID="ai-capture-close" onPress={onClose} hitSlop={8}>
            <Text style={[styles.link, { color: tc.tint }]}>{step === 'done' ? t('common.done', 'Done') : t('common.cancel', 'Cancel')}</Text>
          </Pressable>
          <Text accessibilityRole="header" style={[styles.title, { color: tc.text }]}>{t('quickCapture.title', 'AI Capture')}</Text>
          <View style={styles.headerSpacer} />
        </View>

        {step === 'capture' ? (
          <View style={[styles.flex, styles.pad]}>
            <Text style={{ color: tc.secondaryText, fontSize: 14, lineHeight: 20 }}>
              {t('quickCapture.hint', 'Dump everything on your mind. AI will turn it into projects and tasks for you to review.')}
            </Text>
            <TextInput
              testID="ai-capture-input"
              value={cap.text}
              onChangeText={cap.setText}
              multiline
              autoFocus
              textAlignVertical="top"
              placeholder={t('quickCapture.placeholder', 'Brain dump…')}
              placeholderTextColor={tc.secondaryText}
              accessibilityLabel={t('quickCapture.inputLabel', 'Brain dump')}
              style={[styles.bigInput, { color: tc.text, backgroundColor: tc.inputBg, borderColor: tc.border }]}
            />
            <Pressable
              accessibilityRole="button"
              testID="ai-capture-organise"
              disabled={!cap.text.trim()}
              onPress={() => void cap.organise()}
              style={[styles.button, { backgroundColor: tc.tint, opacity: cap.text.trim() ? 1 : 0.5 }]}
            >
              <Text style={[styles.buttonText, { color: tc.onTint }]}>{t('quickCapture.organise', 'Organise')}</Text>
            </Pressable>
          </View>
        ) : null}

        {step === 'review' ? (
          <>
            <ScrollView style={styles.flex} contentContainerStyle={styles.pad} keyboardShouldPersistTaps="handled">
              {loading ? (
                <View style={styles.center} testID="ai-capture-loading">
                  <ActivityIndicator color={tc.tint} />
                  <Text style={{ color: tc.secondaryText }}>{t('quickCapture.organising', 'Organising…')}</Text>
                </View>
              ) : (
                <>
                  {proposal?.source === 'fallback' ? (
                    <View testID="ai-capture-fallback" style={[styles.card, { backgroundColor: tc.cardBg, borderColor: tc.border }]}>
                      <Text style={{ color: tc.text, fontSize: 14, lineHeight: 20 }}>
                        {proposal.fallbackReason === 'disabled'
                          ? t('quickCapture.fallbackDisabled', 'AI is not set up, so each line became an Inbox item.')
                          : t('quickCapture.fallbackFailed', 'AI could not organise this, so each line became an Inbox item.')}
                      </Text>
                      {proposal.fallbackReason === 'disabled' && onOpenAiSettings ? (
                        <Pressable accessibilityRole="button" testID="ai-capture-open-ai-settings" onPress={onOpenAiSettings}>
                          <Text style={[styles.link, { color: tc.tint }]}>{t('assistant.openAiSettings', 'Open AI settings')}</Text>
                        </Pressable>
                      ) : null}
                    </View>
                  ) : proposal?.summary ? (
                    <Text style={{ color: tc.secondaryText, fontSize: 14 }}>{proposal.summary}</Text>
                  ) : null}
                  {rows.length === 0 ? (
                    <Text testID="ai-capture-empty" style={{ color: tc.secondaryText }}>{t('quickCapture.nothing', 'Nothing to add.')}</Text>
                  ) : null}
                  {rows.map((row) => {
                    const project = projectTitle(row.projectRef, row.projectName);
                    return (
                      <View key={row.key} testID="ai-capture-row" style={[styles.row, { backgroundColor: tc.cardBg, borderColor: tc.border }]}>
                        <Pressable
                          accessibilityRole="checkbox"
                          accessibilityState={{ checked: row.included }}
                          accessibilityLabel={`${t('quickCapture.include', 'Include')}: ${row.title}`}
                          testID="ai-capture-check"
                          onPress={() => cap.updateRow(row.key, { included: !row.included })}
                          hitSlop={8}
                          style={[styles.check, { borderColor: row.included ? tc.tint : tc.border, backgroundColor: row.included ? tc.tint : 'transparent' }]}
                        >
                          {row.included ? <Text style={{ color: tc.onTint, fontWeight: '800' }}>{'✓'}</Text> : null}
                        </Pressable>
                        <View style={styles.flex}>
                          <TextInput
                            testID="ai-capture-title"
                            value={row.title}
                            onChangeText={(value) => cap.updateRow(row.key, { title: value })}
                            accessibilityLabel={t('quickCapture.taskTitle', 'Task title')}
                            style={[styles.rowTitle, { color: row.included ? tc.text : tc.secondaryText, textDecorationLine: row.included ? 'none' : 'line-through' }]}
                          />
                          <Text style={{ color: tc.secondaryText, fontSize: 12 }}>
                            {[t(KIND_LABEL[row.kind][0], KIND_LABEL[row.kind][1]), project, row.areaName, (row.dueDate ?? row.startTime)?.replace('T', ' ')].filter(Boolean).join(' · ')}
                          </Text>
                        </View>
                      </View>
                    );
                  })}
                </>
              )}
            </ScrollView>
            {!loading ? (
              <View style={[styles.footer, { borderColor: tc.border }]}>
                <Pressable accessibilityRole="button" testID="ai-capture-back" onPress={cap.backToCapture} style={[styles.button, { borderColor: tc.border, borderWidth: 1 }]}>
                  <Text style={[styles.buttonText, { color: tc.text }]}>{t('common.back', 'Back')}</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  testID="ai-capture-add"
                  disabled={cap.included.length === 0 || cap.saving}
                  onPress={() => void handleAdd()}
                  style={[styles.button, styles.flex, { backgroundColor: tc.tint, opacity: cap.included.length === 0 || cap.saving ? 0.5 : 1 }]}
                >
                  <Text style={[styles.buttonText, { color: tc.onTint }]}>
                    {t('quickCapture.addCount', 'Add {{count}}').replace('{{count}}', String(cap.included.length))}
                  </Text>
                </Pressable>
              </View>
            ) : null}
          </>
        ) : null}

        {step === 'done' ? (
          <View style={[styles.flex, styles.pad]} testID="ai-capture-done">
            <Text style={[styles.title, { color: tc.text }]}>
              {cap.undone ? t('quickCapture.undone', 'Undone. Nothing was added.') : t('quickCapture.added', 'Added')}
            </Text>
            {cap.applied && cap.applied.failed.length > 0 ? (
              <Text style={{ color: tc.danger }}>{t('quickCapture.someFailed', '{{count}} could not be added.').replace('{{count}}', String(cap.applied.failed.length))}</Text>
            ) : null}
            {!cap.undone ? (
              <Pressable accessibilityRole="button" testID="ai-capture-undo" onPress={() => void cap.undo()} style={[styles.button, { borderColor: tc.border, borderWidth: 1 }]}>
                <Text style={[styles.buttonText, { color: tc.text }]}>{t('common.undo', 'Undo')}</Text>
              </Pressable>
            ) : null}
            <Pressable accessibilityRole="button" testID="ai-capture-another" onPress={cap.reset} style={[styles.button, { backgroundColor: tc.tint }]}>
              <Text style={[styles.buttonText, { color: tc.onTint }]}>{t('quickCapture.another', 'Capture more')}</Text>
            </Pressable>
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  pad: { padding: 16, gap: 14 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  headerSpacer: { minWidth: 56 },
  title: { fontSize: 18, fontWeight: '700' },
  link: { fontSize: 16, fontWeight: '600' },
  bigInput: { flex: 1, minHeight: 180, borderRadius: 14, borderWidth: 1, padding: 14, fontSize: 17, lineHeight: 24 },
  button: { minHeight: 48, borderRadius: 12, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center' },
  buttonText: { fontSize: 16, fontWeight: '700' },
  center: { alignItems: 'center', gap: 10, paddingVertical: 40 },
  card: { borderRadius: 14, borderWidth: 1, padding: 14, gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 14, borderWidth: 1, padding: 12 },
  check: { width: 26, height: 26, borderRadius: 8, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { fontSize: 16, fontWeight: '600', paddingVertical: 4 },
  footer: { flexDirection: 'row', gap: 10, padding: 12, borderTopWidth: StyleSheet.hairlineWidth },
});
