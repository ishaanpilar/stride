import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { tFallback } from '@stride/core';

import { useLanguage } from '../../contexts/language-context';
import { useThemeColors } from '@/hooks/use-theme-colors';
import { useAssistant, type AssistantControls } from './use-assistant';
import {
  ChangesCard, ConfirmCard, ConfirmSheet, FALLBACK_SUGGESTIONS, MessageBubble, STARTER_SUGGESTIONS, SuggestionChips,
} from './assistant-parts';

const DISABLED_COPY = {
  disabled: ['assistant.disabled', 'Turn on AI in settings to use the Assistant.'],
  'no-key': ['assistant.noKey', 'Add your AI API key in settings to use the Assistant.'],
  'unsupported-provider': ['assistant.unsupportedProvider', 'This AI provider does not support the Assistant yet. Switch provider in AI settings.'],
} as const;

export type AssistantScreenProps = {
  onClose: () => void;
  onOpenAiSettings: () => void;
  /** Test seam; defaults to the shared app session. */
  controls?: AssistantControls;
};

export function AssistantScreen({ onClose, onOpenAiSettings, controls }: AssistantScreenProps) {
  const { t: rawT, language } = useLanguage();
  const t = useCallback((key: string, fallback: string) => tFallback(rawT, key, fallback), [rawT]);
  const tc = useThemeColors();
  const { session, state, readiness } = useAssistant(controls);
  const { thread, busy } = state;
  const [draft, setDraft] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [dismissedSheet, setDismissedSheet] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  const ready = readiness?.ready === true;
  const sheetPending = useMemo(
    () => thread.pending.find((p) => p.status === 'pending' && p.id !== dismissedSheet) ?? null,
    [thread.pending, dismissedSheet],
  );

  useEffect(() => { scrollRef.current?.scrollToEnd?.({ animated: true }); }, [thread.messages.length, thread.pending.length, busy]);

  const sendText = useCallback((value: string) => {
    const text = value.trim();
    if (!text || busy || !ready) return;
    setNotice(null);
    void session.send(text, language);
  }, [busy, language, ready, session]);

  const submit = useCallback(() => {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    sendText(text);
  }, [draft, sendText]);

  const runUndo = useCallback(async (action: () => Promise<string | null>) => {
    const error = await action();
    setNotice(error ? `${t('assistant.undoFailed', 'Undo failed')}: ${error}` : null);
  }, [t]);

  const awaiting = thread.pending.some((p) => p.status === 'pending');
  const turns = thread.messages;

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: tc.bg }]} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" testID="assistant-close" onPress={onClose} hitSlop={8}>
            <Text style={[styles.link, { color: tc.tint }]}>{t('common.close', 'Close')}</Text>
          </Pressable>
          <Text accessibilityRole="header" style={[styles.title, { color: tc.text }]}>{t('assistant.title', 'Assistant')}</Text>
          <Pressable
            accessibilityRole="button"
            testID="assistant-new-chat"
            disabled={turns.length === 0 && !busy}
            onPress={() => { session.newChat(); setNotice(null); }}
            hitSlop={8}
          >
            <Text style={[styles.link, { color: tc.tint, opacity: turns.length === 0 && !busy ? 0.4 : 1 }]}>{t('assistant.newChat', 'New chat')}</Text>
          </Pressable>
        </View>

        <ScrollView ref={scrollRef} style={styles.flex} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {readiness && !readiness.ready ? (
            <View testID="assistant-disabled" style={[styles.card, { backgroundColor: tc.cardBg, borderColor: tc.border }]}>
              <Text style={{ color: tc.text, fontSize: 15, lineHeight: 21 }}>{t(DISABLED_COPY[readiness.reason][0], DISABLED_COPY[readiness.reason][1])}</Text>
              <Pressable accessibilityRole="button" testID="assistant-open-ai-settings" onPress={onOpenAiSettings} style={[styles.button, { backgroundColor: tc.tint }]}>
                <Text style={[styles.buttonText, { color: tc.onTint }]}>{t('assistant.openAiSettings', 'Open AI settings')}</Text>
              </Pressable>
            </View>
          ) : null}

          {turns.length === 0 && ready ? (
            <View testID="assistant-empty-state" style={[styles.card, { backgroundColor: tc.cardBg, borderColor: tc.border }]}>
              <Text style={[styles.cardTitle, { color: tc.text }]}>{t('assistant.greeting', 'Hi, how can I help?')}</Text>
              <Text style={{ color: tc.secondaryText, fontSize: 14 }}>{t('assistant.greetingHint', 'Ask in plain language, or start with one of these.')}</Text>
              <SuggestionChips suggestions={STARTER_SUGGESTIONS} onPick={sendText} tc={tc} />
            </View>
          ) : null}

          {turns.map((m, index) => {
            const isAssistant = m.role === 'assistant';
            const entries = isAssistant && m.turnId ? thread.changes.filter((c) => c.messageId === m.turnId) : [];
            const pending = isAssistant && m.turnId ? thread.pending.filter((p) => p.messageId === m.turnId) : [];
            const lastOfTurn = isAssistant && turns.filter((x) => x.turnId === m.turnId && x.role === 'assistant').slice(-1)[0]?.id === m.id;
            const chips = isAssistant && index === turns.length - 1 && !busy && !m.isError && !awaiting
              ? (m.suggestions?.length ? m.suggestions : FALLBACK_SUGGESTIONS)
              : [];
            return (
              <View key={m.id} style={styles.turn}>
                <MessageBubble role={m.role} text={m.text} isError={m.isError} tc={tc} />
                {lastOfTurn && entries.length > 0 ? (
                  <ChangesCard
                    entries={entries}
                    tc={tc}
                    t={t}
                    onUndo={(id) => void runUndo(() => session.undoEntry(id))}
                    onUndoAll={() => void runUndo(() => session.undoTurn(m.turnId!))}
                  />
                ) : null}
                {lastOfTurn ? pending.map((p) => (
                  <ConfirmCard key={p.id} pending={p} tc={tc} t={t} onConfirm={(id) => void session.confirm(id)} onReject={session.reject} />
                )) : null}
                {chips.length > 0 ? <SuggestionChips suggestions={chips} onPick={sendText} tc={tc} /> : null}
              </View>
            );
          })}

          {busy ? (
            <View style={styles.busy} testID="assistant-busy" accessibilityRole="progressbar">
              <ActivityIndicator color={tc.tint} />
              <Text style={{ color: tc.secondaryText, fontSize: 14 }}>{t('assistant.working', 'Checking your tasks…')}</Text>
            </View>
          ) : null}
          {notice ? <Text accessibilityRole="alert" style={{ color: tc.danger, fontSize: 13 }}>{notice}</Text> : null}
        </ScrollView>

        <View style={[styles.composer, { borderColor: tc.border, backgroundColor: tc.cardBg }]}>
          <TextInput
            testID="assistant-input"
            value={draft}
            onChangeText={setDraft}
            editable={ready}
            multiline
            placeholder={ready ? t('assistant.placeholder', 'Ask or tell the assistant what to do…') : t('assistant.unavailable', 'Assistant unavailable')}
            placeholderTextColor={tc.secondaryText}
            accessibilityLabel={t('assistant.inputLabel', 'Message the assistant')}
            style={[styles.input, { color: tc.text, backgroundColor: tc.inputBg }]}
          />
          {busy ? (
            <Pressable accessibilityRole="button" testID="assistant-stop" onPress={session.stop} style={[styles.button, { borderColor: tc.border, borderWidth: 1 }]}>
              <Text style={[styles.buttonText, { color: tc.text }]}>{t('assistant.stop', 'Stop')}</Text>
            </Pressable>
          ) : (
            <Pressable
              accessibilityRole="button"
              testID="assistant-send"
              disabled={!ready || !draft.trim()}
              onPress={submit}
              style={[styles.button, { backgroundColor: tc.tint, opacity: !ready || !draft.trim() ? 0.5 : 1 }]}
            >
              <Text style={[styles.buttonText, { color: tc.onTint }]}>{t('assistant.send', 'Send')}</Text>
            </Pressable>
          )}
        </View>
      </KeyboardAvoidingView>

      <ConfirmSheet
        pending={sheetPending}
        tc={tc}
        t={t}
        onConfirm={(id) => void session.confirm(id)}
        onReject={session.reject}
        onDismiss={() => sheetPending && setDismissedSheet(sheetPending.id)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  title: { fontSize: 18, fontWeight: '700' },
  link: { fontSize: 16, fontWeight: '600' },
  content: { padding: 16, gap: 14, flexGrow: 1 },
  turn: { gap: 8 },
  card: { borderRadius: 14, borderWidth: 1, padding: 14, gap: 10 },
  cardTitle: { fontSize: 16, fontWeight: '700' },
  busy: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: 10, borderTopWidth: StyleSheet.hairlineWidth },
  input: { flex: 1, minHeight: 44, maxHeight: 140, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  button: { minHeight: 44, borderRadius: 12, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center' },
  buttonText: { fontSize: 15, fontWeight: '700' },
});
