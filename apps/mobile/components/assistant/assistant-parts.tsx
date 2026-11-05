import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import type { ChangeEntry, PendingConfirmation } from '@stride/core';
import type { ThemeColors } from '@/hooks/use-theme-colors';

type Translate = (key: string, fallback: string) => string;

export const STARTER_SUGGESTIONS = ['Plan my day', "What's overdue?", 'Triage my inbox', 'Find duplicates'];
export const FALLBACK_SUGGESTIONS = ['Plan my day', "What's overdue?", 'Find duplicates'];

export function SuggestionChips({ suggestions, onPick, tc }: { suggestions: string[]; onPick: (text: string) => void; tc: ThemeColors }) {
  if (suggestions.length === 0) return null;
  return (
    <View style={styles.chips} testID="assistant-suggestions">
      {suggestions.map((s) => (
        <Pressable
          key={s}
          accessibilityRole="button"
          onPress={() => onPick(s)}
          style={[styles.chip, { backgroundColor: tc.cardBg, borderColor: tc.border }]}
        >
          <Text style={[styles.chipText, { color: tc.tint }]}>{s}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export function MessageBubble({ role, text, isError, tc, children }: {
  role: 'user' | 'assistant';
  text: string;
  isError?: boolean;
  tc: ThemeColors;
  children?: React.ReactNode;
}) {
  const isUser = role === 'user';
  return (
    <View style={[styles.bubbleRow, isUser ? styles.rowEnd : styles.rowStart]}>
      <View
        testID={isUser ? 'assistant-user-message' : 'assistant-reply'}
        style={[
          styles.bubble,
          isUser
            ? { backgroundColor: tc.tint }
            : { backgroundColor: isError ? tc.filterBg : tc.cardBg, borderColor: isError ? tc.danger : tc.border, borderWidth: StyleSheet.hairlineWidth },
        ]}
      >
        <Text selectable style={{ color: isUser ? tc.onTint : isError ? tc.danger : tc.text, fontSize: 15, lineHeight: 21 }}>{children ?? text}</Text>
      </View>
    </View>
  );
}

export function ChangesCard({ entries, onUndo, onUndoAll, tc, t }: {
  entries: ChangeEntry[];
  onUndo: (id: string) => void;
  onUndoAll?: () => void;
  tc: ThemeColors;
  t: Translate;
}) {
  if (entries.length === 0) return null;
  const undoable = entries.filter((e) => !e.undone);
  return (
    <View testID="assistant-changes-card" style={[styles.card, { backgroundColor: tc.cardBg, borderColor: tc.border }]}>
      <View style={styles.cardHeader}>
        <Text style={[styles.cardTitle, { color: tc.secondaryText }]}>{t('assistant.changes', 'Changes')}</Text>
        {undoable.length > 1 && onUndoAll ? (
          <Pressable accessibilityRole="button" testID="assistant-undo-all" onPress={onUndoAll} hitSlop={8}>
            <Text style={[styles.link, { color: tc.tint }]}>{t('assistant.undoAll', 'Undo all')}</Text>
          </Pressable>
        ) : null}
      </View>
      {entries.map((e) => (
        <View key={e.id} testID="assistant-change-row" style={styles.changeRow}>
          <View style={styles.flex}>
            <Text style={[styles.changeLabel, { color: tc.text }, e.undone && styles.struck]}>{e.label}</Text>
            {e.reason ? <Text style={[styles.reason, { color: tc.secondaryText }]}>{t('assistant.why', 'Why')}: {e.reason}</Text> : null}
          </View>
          {e.undone ? (
            <Text style={[styles.reason, { color: tc.secondaryText }]}>{t('assistant.undone', 'Undone')}</Text>
          ) : (
            <Pressable accessibilityRole="button" accessibilityLabel={`${t('assistant.undo', 'Undo')}: ${e.label}`} testID="assistant-undo" onPress={() => onUndo(e.id)} hitSlop={8}>
              <Text style={[styles.link, { color: tc.tint }]}>{t('assistant.undo', 'Undo')}</Text>
            </Pressable>
          )}
        </View>
      ))}
    </View>
  );
}

/** Inline record of a gated action (kept in the thread after the sheet closes). */
export function ConfirmCard({ pending, onConfirm, onReject, tc, t }: {
  pending: PendingConfirmation;
  onConfirm: (id: string) => void;
  onReject: (id: string) => void;
  tc: ThemeColors;
  t: Translate;
}) {
  const isPending = pending.status === 'pending';
  return (
    <View testID="assistant-confirm-card" style={[styles.card, { backgroundColor: tc.cardBg, borderColor: isPending ? tc.warning : tc.border }]}>
      <Text style={[styles.cardTitle, { color: isPending ? tc.warning : tc.secondaryText }]}>
        {isPending ? t('assistant.needsConfirm', 'Needs your confirmation') : pending.status === 'confirmed' ? t('assistant.confirmed', 'Confirmed') : t('assistant.declined', 'Declined')}
      </Text>
      <Text style={[styles.changeLabel, { color: tc.text }]}>{pending.summary}</Text>
      {isPending ? (
        <View style={styles.actions}>
          <Pressable accessibilityRole="button" testID="assistant-card-confirm" onPress={() => onConfirm(pending.id)} style={[styles.button, { backgroundColor: tc.tint }]}>
            <Text style={[styles.buttonText, { color: tc.onTint }]}>{t('assistant.confirm', 'Confirm')}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" testID="assistant-card-decline" onPress={() => onReject(pending.id)} style={[styles.button, { borderColor: tc.border, borderWidth: 1 }]}>
            <Text style={[styles.buttonText, { color: tc.text }]}>{t('assistant.decline', 'Decline')}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

/** Bottom sheet shown whenever the Assistant wants to delete or bulk-change something. Nothing runs until Confirm. */
export function ConfirmSheet({ pending, onConfirm, onReject, onDismiss, tc, t }: {
  pending: PendingConfirmation | null;
  onConfirm: (id: string) => void;
  onReject: (id: string) => void;
  onDismiss: () => void;
  tc: ThemeColors;
  t: Translate;
}) {
  if (!pending) return null;
  const shown = pending.affected.slice(0, 6);
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onDismiss}>
      <View style={styles.sheetRoot} testID="assistant-confirm-sheet">
        <Pressable style={styles.backdrop} onPress={onDismiss} accessibilityRole="button" accessibilityLabel={t('common.close', 'Close')} />
        <View style={[styles.sheet, { backgroundColor: tc.cardBg, borderColor: tc.border }]}>
          <View style={[styles.handle, { backgroundColor: tc.border }]} />
          <Text style={[styles.cardTitle, { color: tc.warning }]}>{t('assistant.needsConfirm', 'Needs your confirmation')}</Text>
          <Text style={[styles.sheetSummary, { color: tc.text }]}>{pending.summary}</Text>
          <Text style={[styles.reason, { color: tc.secondaryText }]}>{pending.reason}. {t('assistant.nothingChanges', 'Nothing changes until you confirm.')}</Text>
          {shown.map((item) => (
            <Text key={item.id} style={[styles.changeLabel, { color: tc.text }]}>{'•'} {item.title}</Text>
          ))}
          {pending.affected.length > shown.length ? (
            <Text style={[styles.reason, { color: tc.secondaryText }]}>{t('assistant.andMore', 'and {{count}} more').replace('{{count}}', String(pending.affected.length - shown.length))}</Text>
          ) : null}
          <View style={styles.actions}>
            <Pressable accessibilityRole="button" testID="assistant-sheet-confirm" onPress={() => onConfirm(pending.id)} style={[styles.button, styles.flex, { backgroundColor: tc.tint }]}>
              <Text style={[styles.buttonText, { color: tc.onTint }]}>{t('assistant.confirm', 'Confirm')}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" testID="assistant-sheet-decline" onPress={() => onReject(pending.id)} style={[styles.button, styles.flex, { borderColor: tc.border, borderWidth: 1 }]}>
              <Text style={[styles.buttonText, { color: tc.text }]}>{t('assistant.decline', 'Decline')}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderRadius: 999, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 7 },
  chipText: { fontSize: 13, fontWeight: '600' },
  bubbleRow: { flexDirection: 'row' },
  rowEnd: { justifyContent: 'flex-end' },
  rowStart: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '88%', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10 },
  card: { borderRadius: 14, borderWidth: 1, padding: 12, gap: 8, alignSelf: 'stretch' },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardTitle: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  link: { fontSize: 14, fontWeight: '600' },
  changeRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  changeLabel: { fontSize: 14, lineHeight: 20 },
  struck: { textDecorationLine: 'line-through', opacity: 0.6 },
  reason: { fontSize: 12, lineHeight: 17 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  button: { minHeight: 44, borderRadius: 12, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center' },
  buttonText: { fontSize: 15, fontWeight: '700' },
  sheetRoot: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, borderBottomWidth: 0, padding: 20, paddingBottom: 32, gap: 10 },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, marginBottom: 6 },
  sheetSummary: { fontSize: 17, fontWeight: '700', lineHeight: 23 },
});
