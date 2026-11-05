import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Check, ChevronDown, ChevronUp, Clock, ThumbsDown, ThumbsUp } from 'lucide-react-native';
import {
  formatFocusCoachMinutes,
  toFocusLocalDate,
  type FocusCoachAction,
  type FocusCoachApi,
  type FocusCoachFeedbackVerdict,
  type FocusUndo,
} from '@stride/core';
import { useThemeTokens } from '../../hooks/use-theme-tokens';
import { SoftChip } from '../soft';
import type { FocusText } from './useFocusText';

export function formatFocusWhen(date: string, time: string | undefined, tr: FocusText, now = new Date()): string {
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const day = date === toFocusLocalDate(now)
    ? tr('focus.when.today', 'today')
    : date === toFocusLocalDate(tomorrow)
      ? tr('focus.when.tomorrow', 'tomorrow')
      : new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  return time ? tr('focus.when.at', '{{day}} at {{time}}').replace('{{day}}', day).replace('{{time}}', time) : day;
}

export function focusActionLabel(action: FocusCoachAction, tr: FocusText): string {
  switch (action.type) {
    case 'set_time_estimate':
      return tr('focus.coach.action.estimate', 'Set estimate to {{time}}').replace('{{time}}', formatFocusCoachMinutes(action.minutes, tr));
    case 'add_followup_task':
      return tr('focus.coach.action.followup', 'Add task: {{title}}').replace('{{title}}', action.title);
    case 'set_waiting_for':
      return action.person
        ? tr('focus.coach.action.waitingFor', 'Waiting for {{person}}').replace('{{person}}', action.person)
        : tr('focus.coach.action.waiting', 'Move to Waiting For');
    case 'schedule':
      return tr('focus.coach.action.schedule', 'Schedule for {{when}}').replace('{{when}}', formatFocusWhen(action.date, action.time, tr));
  }
}

type OfferState = { kind: 'idle' | 'busy' | 'failed' } | { kind: 'done'; undo: FocusUndo };

export function OfferChip({ label, onApply, tr, primary = false, testID }: {
  label: string;
  onApply: () => Promise<FocusUndo | null>;
  tr: FocusText;
  primary?: boolean;
  testID?: string;
}) {
  const { soft } = useThemeTokens();
  const [state, setState] = useState<OfferState>({ kind: 'idle' });
  if (state.kind === 'done') {
    const { undo } = state;
    return (
      <View style={styles.doneLine} accessibilityRole="alert" testID={testID ? `${testID}-done` : undefined}>
        <Check size={14} color={soft.successText} />
        <Text style={[styles.doneText, { color: soft.foreground }]} numberOfLines={1}>{label}</Text>
        <Pressable
          accessibilityRole="button"
          hitSlop={8}
          onPress={async () => { if (await undo.undo()) setState({ kind: 'idle' }); }}
        >
          <Text style={[styles.link, { color: soft.accentText }]}>{tr('common.undo', 'Undo')}</Text>
        </Pressable>
      </View>
    );
  }
  return (
    <SoftChip
      label={state.kind === 'failed' ? tr('focus.coach.failed', 'Could not apply that.') : label}
      accessibilityLabel={label}
      selected={primary}
      tone={state.kind === 'failed' ? 'danger' : 'neutral'}
      testID={testID}
      onPress={state.kind === 'busy' ? undefined : async () => {
        setState({ kind: 'busy' });
        const undo = await onApply();
        setState(undo ? { kind: 'done', undo } : { kind: 'failed' });
      }}
    />
  );
}

function Feedback({ tr, value, onRate, testID }: {
  tr: FocusText;
  value?: FocusCoachFeedbackVerdict;
  onRate: (verdict: FocusCoachFeedbackVerdict) => void;
  testID: string;
}) {
  const { soft } = useThemeTokens();
  const useful = tr('focus.coach.useful', 'Useful');
  const notUseful = tr('focus.coach.notUseful', 'Not useful');
  const nonsense = tr('focus.coach.nonsense', "Doesn't make sense");
  return (
    <View style={styles.feedback} accessibilityRole="toolbar" accessibilityLabel={tr('focus.coach.feedback', 'Feedback')} testID={testID}>
      <Pressable accessibilityRole="button" accessibilityLabel={useful} accessibilityState={{ selected: value === 'useful' }} hitSlop={8} onPress={() => onRate('useful')}>
        <ThumbsUp size={16} color={value === 'useful' ? soft.accent : soft.tertiary} />
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={notUseful} hitSlop={8} onPress={() => onRate('not_useful')}>
        <ThumbsDown size={16} color={soft.tertiary} />
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={nonsense} hitSlop={8} onPress={() => onRate('nonsense')}>
        <Text style={[styles.link, { color: soft.tertiary }]}>{nonsense}</Text>
      </Pressable>
    </View>
  );
}

function ReplyInput({ tr, onSend, placeholder }: { tr: FocusText; onSend: (text: string) => void; placeholder: string }) {
  const { soft } = useThemeTokens();
  const [draft, setDraft] = useState('');
  const send = () => {
    if (!draft.trim()) return;
    onSend(draft);
    setDraft('');
  };
  return (
    <View style={[styles.reply, { backgroundColor: soft.well, borderColor: soft.border }]}>
      <TextInput
        value={draft}
        onChangeText={setDraft}
        onSubmitEditing={send}
        returnKeyType="send"
        maxLength={160}
        placeholder={placeholder}
        placeholderTextColor={soft.tertiary}
        accessibilityLabel={tr('focus.coach.reply', 'Reply to the coach')}
        style={[styles.replyInput, { color: soft.foreground }]}
      />
      {draft.trim() ? (
        <Pressable accessibilityRole="button" onPress={send} hitSlop={8}>
          <Text style={[styles.link, { color: soft.accentText }]}>{tr('focus.coach.send', 'Send')}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function FocusCoachCard({ api, tr }: { api: FocusCoachApi; tr: FocusText }) {
  const { soft } = useThemeTokens();
  const { coach, status, exchanges, steps, collapsed } = api;
  if (status === 'idle' || status === 'dismissed') return null;
  const surface = { backgroundColor: soft.surface, borderColor: soft.border, borderRadius: soft.radius.card };
  if (status === 'loading' || !coach) {
    return (
      <View style={[styles.card, surface]} testID="focus-coach" accessibilityRole="progressbar">
        <ActivityIndicator size="small" color={soft.accent} />
        <Text style={[styles.muted, { color: soft.muted }]}>{tr('focus.coach.thinking', 'Sizing this up…')}</Text>
      </View>
    );
  }

  const estimate = coach.estimateMinutes
    ? tr('focus.coach.about', 'About {{time}}').replace('{{time}}', formatFocusCoachMinutes(coach.estimateMinutes, tr))
    : null;
  const lead = coach.approach?.text ?? coach.motivation;
  const toggleLabel = collapsed ? tr('focus.coach.expand', 'Show coach') : tr('focus.coach.collapse', 'Hide coach');
  const showSteps = coach.steps.length > 0 && steps.state !== 'dismissed' && steps.state !== 'leaving';
  const firstAnswer = exchanges[0]?.answer;
  const Chevron = collapsed ? ChevronDown : ChevronUp;

  return (
    <View style={[styles.card, styles.column, surface]} testID="focus-coach" accessibilityLabel={lead}>
      <View style={styles.head}>
        <View style={styles.headText}>
          {estimate ? (
            <View style={styles.estimate} testID="focus-coach-estimate">
              <Clock size={14} color={soft.muted} />
              <Text style={[styles.estimateText, { color: soft.foreground }]}>{estimate}</Text>
              {coach.estimateNote ? <Text style={[styles.muted, { color: soft.muted }]} numberOfLines={1}>{`· ${coach.estimateNote}`}</Text> : null}
            </View>
          ) : null}
          <Text style={[styles.lead, { color: soft.foreground }]} numberOfLines={collapsed ? 1 : undefined} testID="focus-coach-lead">{lead}</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={toggleLabel} accessibilityState={{ expanded: !collapsed }} hitSlop={10} onPress={api.toggleCollapsed}>
          <Chevron size={20} color={soft.muted} />
        </Pressable>
      </View>

      {!collapsed ? (
        <View style={styles.column}>
          {coach.approach ? <Text style={[styles.body, { color: soft.muted }]}>{coach.motivation}</Text> : null}
          {coach.question ? (
            <View style={styles.column}>
              <Text style={[styles.question, { color: soft.foreground }]}>{coach.question.text}</Text>
              {!firstAnswer ? (
                <View style={styles.chips}>
                  {coach.question.options.map((option) => (
                    <SoftChip key={option} label={option} onPress={() => { void api.answer(option); }} />
                  ))}
                </View>
              ) : null}
            </View>
          ) : null}

          {showSteps ? (
            <View style={styles.column} testID="focus-coach-steps">
              {steps.state !== 'added' ? (
                <>
                  <Text style={[styles.label, { color: soft.tertiary }]}>{tr('focus.coach.stepsTitle', 'From what you already have')}</Text>
                  {coach.steps.map((step, index) => (
                    <Text key={step.title} style={[styles.body, { color: soft.foreground }]}>{`${index + 1}. ${step.title}`}</Text>
                  ))}
                </>
              ) : null}
              <View style={styles.rowWrap}>
                {steps.state === 'added' ? (
                  <View style={styles.doneLine}>
                    <Check size={14} color={soft.successText} />
                    <Text style={[styles.doneText, { color: soft.foreground }]}>{tr('focus.coach.added', 'Added to the checklist')}</Text>
                    <Pressable accessibilityRole="button" hitSlop={8} onPress={() => { void api.undoSteps(); }}>
                      <Text style={[styles.link, { color: soft.accentText }]}>{tr('common.undo', 'Undo')}</Text>
                    </Pressable>
                  </View>
                ) : (
                  <SoftChip
                    label={tr('focus.coach.addSteps', 'Add to checklist')}
                    selected
                    onPress={steps.state === 'adding' ? undefined : () => { void api.addSteps(); }}
                  />
                )}
                <Feedback tr={tr} onRate={api.rateSteps} testID="focus-coach-steps-feedback" />
              </View>
            </View>
          ) : null}

          {exchanges.map((exchange) => (
            <View key={exchange.id} style={[styles.column, exchange.leaving && styles.leaving]} testID="focus-coach-turn">
              <Text style={[styles.you, { color: soft.muted }]}>{exchange.answer}</Text>
              {exchange.reply ? (
                <>
                  <Text style={[styles.reply2, { color: soft.foreground }]} testID="focus-coach-reply">{exchange.reply.reply}</Text>
                  <View style={styles.chips}>
                    {exchange.reply.actions.map((action, index) => (
                      <OfferChip
                        key={`${action.type}-${index}`}
                        label={focusActionLabel(action, tr)}
                        tr={tr}
                        testID="focus-coach-action"
                        onApply={() => api.applyAction(action)}
                      />
                    ))}
                  </View>
                  <Feedback tr={tr} value={exchange.feedback} onRate={(verdict) => api.rateReply(exchange.id, verdict)} testID="focus-coach-reply-feedback" />
                </>
              ) : (
                <Text style={[styles.muted, { color: soft.muted }]} accessibilityRole="progressbar">{tr('focus.coach.thinkingShort', 'Thinking…')}</Text>
              )}
            </View>
          ))}

          {api.canReply ? (
            <ReplyInput
              tr={tr}
              onSend={(text) => { void api.answer(text); }}
              placeholder={firstAnswer || !coach.question ? tr('focus.coach.replyMore', 'Anything else on your mind?') : tr('focus.coach.replyPlaceholder', 'Or type a short answer')}
            />
          ) : null}
          <Feedback tr={tr} value={api.coachFeedback} onRate={api.rateCoach} testID="focus-coach-feedback" />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: StyleSheet.hairlineWidth, padding: 14, gap: 10 },
  column: { gap: 10 },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  headText: { flex: 1, gap: 4 },
  estimate: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  estimateText: { fontSize: 13, fontWeight: '600' },
  lead: { fontSize: 16, lineHeight: 22, fontWeight: '500' },
  body: { fontSize: 15, lineHeight: 21 },
  question: { fontSize: 15, fontWeight: '600' },
  label: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase' },
  muted: { fontSize: 13 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  rowWrap: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12 },
  feedback: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  link: { fontSize: 13, fontWeight: '600' },
  doneLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  doneText: { fontSize: 13, flexShrink: 1 },
  you: { fontSize: 14, fontStyle: 'italic' },
  reply2: { fontSize: 15, lineHeight: 21, fontWeight: '500' },
  leaving: { opacity: 0.4 },
  reply: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, paddingHorizontal: 12 },
  replyInput: { flex: 1, minHeight: 44, fontSize: 15 },
});
