import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { ArrowLeft, Check, Coffee, Play } from 'lucide-react-native';
import {
  formatFocusCoachMinutes,
  suggestFocusRescheduleSlot,
  type FocusCoachAction,
  type FocusCoachReply,
  type FocusUndo,
  type Project,
  type Task,
} from '@stride/core';
import { useThemeTokens } from '../../hooks/use-theme-tokens';
import { GradientButton, SoftChip } from '../soft';
import { FocusMark, FocusTaskLine, type FocusSummary } from './FocusFinish';
import { OfferChip, focusActionLabel, formatFocusWhen } from './FocusCoachCard';
import type { FocusText } from './useFocusText';

type Stage = 'ask' | 'done' | 'almost' | 'left' | 'blocked' | 'waiting' | 'needInfo' | 'notNow';

export interface FocusCheckInProps {
  task: Task;
  project?: Project;
  summary: FocusSummary;
  sentence: string;
  focusMinutes: number;
  tr: FocusText;
  onDone: () => Promise<FocusUndo | null>;
  onApply: (action: FocusCoachAction) => Promise<FocusUndo | null>;
  onAskCoach: (text: string) => Promise<FocusCoachReply>;
  onStartAnother: () => void;
  onTakeBreak: (afterDone: boolean) => void;
  onClose: () => void;
}

export function FocusCheckIn(props: FocusCheckInProps) {
  const { task, project, summary, tr } = props;
  const { soft } = useThemeTokens();
  const [stage, setStage] = useState<Stage>('ask');
  const [doneUndo, setDoneUndo] = useState<FocusUndo | null>(null);
  const [left, setLeft] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [person, setPerson] = useState(task.assignedTo ?? '');
  const [reason, setReason] = useState('');
  const [coachReply, setCoachReply] = useState<FocusCoachReply | 'loading' | null>(null);
  const slot = suggestFocusRescheduleSlot(new Date());
  const when = formatFocusWhen(slot.date, slot.time, tr);
  const schedule: FocusCoachAction = { type: 'schedule', date: slot.date, time: slot.time };

  const stats = [tr('focus.checkin.minutes', '{{count}} min focused').replace('{{count}}', String(summary.minutes))];
  if (summary.sessionsToday > 0) stats.push(tr('focus.checkin.sessions', '{{count}} sessions today').replace('{{count}}', String(summary.sessionsToday)));

  const markDone = async () => {
    setBusy(true);
    const undo = await props.onDone();
    setBusy(false);
    if (!undo) return;
    setDoneUndo(undo);
    setStage('done');
  };
  const undoDone = async () => {
    if (doneUndo && await doneUndo.undo()) {
      setDoneUndo(null);
      setStage('ask');
    }
  };
  const askCoach = async () => {
    const text = reason.trim();
    if (!text) return;
    setCoachReply('loading');
    setCoachReply(await props.onAskCoach(text));
  };

  const heading = (text: string) => <Text style={[styles.heading, { color: soft.foreground }]} accessibilityRole="header">{text}</Text>;
  const input = (value: string, onChange: (v: string) => void, placeholder: string, max: number, onSubmit?: () => void) => (
    <View style={[styles.input, { backgroundColor: soft.well, borderColor: soft.border }]}>
      <TextInput
        value={value}
        onChangeText={onChange}
        onSubmitEditing={onSubmit}
        maxLength={max}
        placeholder={placeholder}
        placeholderTextColor={soft.tertiary}
        accessibilityLabel={placeholder}
        style={[styles.inputText, { color: soft.foreground }]}
      />
    </View>
  );
  const back = (
    <Pressable accessibilityRole="button" hitSlop={10} style={styles.back} onPress={() => { setStage('ask'); setCoachReply(null); }}>
      <ArrowLeft size={16} color={soft.muted} />
      <Text style={[styles.backText, { color: soft.muted }]}>{tr('common.back', 'Back')}</Text>
    </Pressable>
  );
  const takeBreak = (afterDone: boolean, variant: 'primary' | 'secondary' = 'primary') => (
    <GradientButton
      label={tr('focus.takeBreak', 'Take a break')}
      variant={variant}
      icon={<Coffee size={18} color={variant === 'primary' ? soft.accentForeground : soft.foreground} />}
      onPress={() => props.onTakeBreak(afterDone)}
      fullWidth
    />
  );
  const close = <GradientButton label={tr('common.close', 'Close')} variant="secondary" onPress={props.onClose} fullWidth />;
  const leftOptions: [string, number][] = [
    [tr('focus.checkin.left10', '~10 min'), 10],
    [tr('focus.checkin.left25', '~25 min'), 25],
    [tr('focus.checkin.left60', '~1 h'), 60],
    [tr('focus.checkin.leftSession', 'Another session'), props.focusMinutes],
  ];

  let body: React.ReactNode;
  if (stage === 'done') {
    body = (
      <>
        <FocusMark />
        {heading(tr('focus.checkin.doneTitle', 'Done. Nicely handled.'))}
        <Text style={[styles.line, { color: soft.muted }]}>{props.sentence}</Text>
        <View style={styles.doneLine} accessibilityRole="alert">
          <Check size={14} color={soft.successText} />
          <Text style={[styles.doneText, { color: soft.foreground }]}>{tr('focus.checkin.markedDone', 'Marked done')}</Text>
          <Pressable accessibilityRole="button" hitSlop={8} onPress={() => { void undoDone(); }}>
            <Text style={[styles.link, { color: soft.accentText }]}>{tr('common.undo', 'Undo')}</Text>
          </Pressable>
        </View>
        <View style={styles.actions}>{takeBreak(true)}{close}</View>
      </>
    );
  } else if (stage === 'almost') {
    body = (
      <>
        {heading(tr('focus.checkin.howMuchLeft', 'How much is left?'))}
        <View style={styles.chips}>
          {leftOptions.map(([label, minutes]) => (
            <SoftChip key={label} label={label} onPress={() => { setLeft(minutes); setStage('left'); }} />
          ))}
        </View>
        {back}
      </>
    );
  } else if (stage === 'left' && left !== null) {
    body = (
      <>
        {heading(tr('focus.checkin.leftTitle', 'About {{time}} to go').replace('{{time}}', formatFocusCoachMinutes(left, tr)))}
        <View style={styles.chips}>
          <OfferChip
            label={tr('focus.coach.action.estimate', 'Set estimate to {{time}}').replace('{{time}}', formatFocusCoachMinutes(left, tr))}
            tr={tr}
            testID="focus-checkin-estimate"
            onApply={() => props.onApply({ type: 'set_time_estimate', minutes: left })}
          />
          <OfferChip
            label={tr('focus.checkin.scheduleRest', 'Schedule the rest for {{when}}').replace('{{when}}', when)}
            tr={tr}
            testID="focus-checkin-schedule"
            onApply={() => props.onApply(schedule)}
          />
        </View>
        <View style={styles.actions}>
          <GradientButton label={tr('focus.checkin.startAnother', 'Start another session')} icon={<Play size={18} color={soft.accentForeground} />} onPress={props.onStartAnother} fullWidth />
          {takeBreak(false, 'secondary')}
        </View>
        {back}
      </>
    );
  } else if (stage === 'blocked') {
    body = (
      <>
        {heading(tr('focus.checkin.blocking', "What's in the way?"))}
        <View style={styles.chips}>
          <SoftChip label={tr('focus.checkin.waitingOn', 'Waiting on someone')} onPress={() => setStage('waiting')} />
          <SoftChip label={tr('focus.checkin.needInfo', 'Need info')} onPress={() => setStage('needInfo')} />
          <SoftChip label={tr('focus.checkin.notNow', 'Not now')} onPress={() => setStage('notNow')} />
        </View>
        {input(reason, setReason, tr('focus.checkin.typeReason', "Or say what's blocking"), 160, () => { void askCoach(); })}
        {coachReply === 'loading' ? <Text style={[styles.line, { color: soft.muted }]} accessibilityRole="progressbar">{tr('focus.coach.thinkingShort', 'Thinking…')}</Text> : null}
        {coachReply && coachReply !== 'loading' ? (
          <View style={styles.reply} testID="focus-checkin-reply">
            <Text style={[styles.line, { color: soft.foreground }]}>{coachReply.reply}</Text>
            <View style={styles.chips}>
              {coachReply.actions.map((action, index) => (
                <OfferChip key={`${action.type}-${index}`} label={focusActionLabel(action, tr)} tr={tr} onApply={() => props.onApply(action)} />
              ))}
            </View>
          </View>
        ) : null}
        {back}
      </>
    );
  } else if (stage === 'waiting') {
    body = (
      <>
        {heading(tr('focus.checkin.who', 'Who are you waiting on?'))}
        {input(person, setPerson, tr('taskEdit.assignedToPlaceholder', 'Who is this waiting for?'), 40)}
        <OfferChip
          primary
          label={tr('focus.coach.action.waiting', 'Move to Waiting For')}
          tr={tr}
          testID="focus-checkin-waiting"
          onApply={() => props.onApply(person.trim() ? { type: 'set_waiting_for', person: person.trim().slice(0, 40) } : { type: 'set_waiting_for' })}
        />
        <View style={styles.actions}>{close}</View>
        {back}
      </>
    );
  } else if (stage === 'needInfo' || stage === 'notNow') {
    const followup = tr('focus.checkin.followupTitle', 'Get info for: {{title}}').replace('{{title}}', task.title).slice(0, 120);
    body = (
      <>
        {heading(stage === 'needInfo' ? tr('focus.checkin.needInfoTitle', 'Park it until you have the info') : tr('focus.checkin.notNowTitle', 'Fine. Pick it up later.'))}
        <View style={styles.chips}>
          {stage === 'needInfo' ? (
            <OfferChip label={tr('focus.coach.action.followup', 'Add task: {{title}}').replace('{{title}}', followup)} tr={tr} testID="focus-checkin-followup" onApply={() => props.onApply({ type: 'add_followup_task', title: followup })} />
          ) : null}
          <OfferChip label={tr('focus.checkin.reschedule', 'Reschedule to {{when}}').replace('{{when}}', when)} tr={tr} testID="focus-checkin-reschedule" onApply={() => props.onApply(schedule)} />
        </View>
        <View style={styles.actions}>{takeBreak(false)}{close}</View>
        {back}
      </>
    );
  } else {
    body = (
      <>
        {heading(tr('focus.checkin.title', 'Is it done?'))}
        <View style={styles.actions}>
          <GradientButton label={tr('focus.checkin.done', 'Done')} icon={<Check size={18} color={soft.accentForeground} />} disabled={busy} onPress={() => { void markDone(); }} fullWidth />
          <GradientButton label={tr('focus.checkin.almost', 'Almost')} variant="secondary" onPress={() => setStage('almost')} fullWidth />
          <GradientButton label={tr('focus.checkin.notYet', 'Not yet')} variant="secondary" onPress={() => setStage('blocked')} fullWidth />
        </View>
      </>
    );
  }

  return (
    <View style={styles.root} testID="focus-checkin" accessibilityLabel={stage}>
      <FocusTaskLine task={task} project={project} />
      {body}
      <Text style={[styles.stats, { color: soft.tertiary }]} testID="focus-checkin-stats">{stats.join(' · ')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: 'center', gap: 14, width: '100%' },
  heading: { fontSize: 24, fontWeight: '700', textAlign: 'center' },
  line: { fontSize: 16, lineHeight: 22, textAlign: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8 },
  actions: { alignSelf: 'stretch', gap: 10 },
  reply: { gap: 8, alignItems: 'center' },
  back: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  backText: { fontSize: 14 },
  stats: { fontSize: 12, marginTop: 4 },
  input: { alignSelf: 'stretch', borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, paddingHorizontal: 12 },
  inputText: { minHeight: 44, fontSize: 16 },
  doneLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  doneText: { fontSize: 14 },
  link: { fontSize: 14, fontWeight: '600' },
});
