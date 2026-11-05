import React from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowRight, Minimize2, Pause, Play, Square } from 'lucide-react-native';
import { formatPomodoroClock } from '@stride/core';
import { useThemeTokens } from '../../hooks/use-theme-tokens';
import { GradientButton } from '../soft';
import { FocusCheckIn } from './FocusCheckIn';
import { FocusCoachCard } from './FocusCoachCard';
import { FocusFinish } from './FocusFinish';
import { FocusRing } from './FocusRing';
import { FocusSteps } from './FocusSteps';
import type { FocusSessionHost } from './useFocusSessionHost';

export interface FocusStageProps {
  host: FocusSessionHost;
  onMinimise: () => void;
}

export function FocusStage({ host, onMinimise }: FocusStageProps) {
  const { soft } = useThemeTokens();
  const insets = useSafeAreaInsets();
  const [confirmingEnd, setConfirmingEnd] = React.useState(false);
  const { tr, view, task, project, steps, clock, session } = host;
  const { timerState } = session;
  const isBreak = view === 'break';
  const paused = !timerState.isRunning && (view === 'focus' || view === 'break');
  const done = steps.filter((s) => s.isCompleted).length;
  const total = steps.length;
  const clockText = formatPomodoroClock(clock.remainingSeconds);
  const currentStep = steps.find((s) => !s.isCompleted);
  const glow = isBreak ? soft.tones.success.background : soft.tones.accent.background;

  let sub = '';
  if (view === 'ready') sub = tr('focus.readyBody', 'Ready for another round when you are.');
  else if (paused) sub = tr('pomodoro.paused', 'Paused');
  else if (isBreak) sub = tr('pomodoro.phaseBreakShort', 'Break');

  const runLabel = timerState.isRunning ? tr('common.pause', 'Pause') : tr('common.start', 'Start');
  const RunIcon = timerState.isRunning ? Pause : Play;
  const endLabel = tr('focus.endSession', 'End session');

  const finishing = view === 'finish';

  let controls: React.ReactNode;
  if (confirmingEnd) {
    controls = (
      <View style={styles.confirm} accessibilityRole="alert">
        <Text style={[styles.confirmTitle, { color: soft.foreground }]}>{tr('focus.leaveTitle', 'Leave focus?')}</Text>
        <GradientButton label={tr('focus.stay', 'Stay focused')} onPress={() => setConfirmingEnd(false)} fullWidth />
        <GradientButton label={endLabel} variant="secondary" onPress={host.endSession} fullWidth />
      </View>
    );
  } else if (view === 'ready') {
    controls = (
      <GradientButton label={tr('focus.anotherSession', 'Another session')} icon={<Play size={18} color={soft.accentForeground} />} onPress={host.startNext} fullWidth />
    );
  } else {
    controls = (
      <View style={styles.controlRow}>
        {isBreak ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={tr('focus.skipBreak', 'Skip break')}
            onPress={host.skipBreak}
            style={[styles.roundSmall, { backgroundColor: soft.surface, borderColor: soft.border }]}
          >
            <ArrowRight size={20} color={soft.foreground} />
          </Pressable>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={endLabel}
            onPress={() => setConfirmingEnd(true)}
            style={[styles.roundSmall, { backgroundColor: soft.surface, borderColor: soft.border }]}
          >
            <Square size={18} color={soft.foreground} fill={soft.foreground} />
          </Pressable>
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={runLabel}
          onPress={host.toggleRun}
          style={[styles.roundMain, { backgroundColor: soft.accentStrong }]}
        >
          <RunIcon size={28} color={soft.accentForeground} fill={soft.accentForeground} />
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: soft.background }]} testID="focus-stage" accessibilityViewIsModal>
      <View pointerEvents="none" style={[styles.glow, styles.glowTop, { backgroundColor: glow }]} />
      <View pointerEvents="none" style={[styles.glow, styles.glowBottom, { backgroundColor: glow }]} />
      <View style={[styles.top, { paddingTop: insets.top + 8 }]}>
        <Text style={[styles.topLabel, { color: soft.tertiary }]}>{tr('focus.stageLabel', 'Focus session')}</Text>
        {host.active ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={tr('focus.minimise', 'Minimise')}
            hitSlop={10}
            onPress={onMinimise}
            style={[styles.topButton, { backgroundColor: soft.surface, borderColor: soft.border }]}
            testID="focus-minimise"
          >
            <Minimize2 size={18} color={soft.foreground} />
          </Pressable>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={tr('common.close', 'Close')}
            hitSlop={10}
            onPress={host.closeFinished}
            style={[styles.topButton, { backgroundColor: soft.surface, borderColor: soft.border }]}
          >
            <Text style={[styles.close, { color: soft.foreground }]}>{tr('common.close', 'Close')}</Text>
          </Pressable>
        )}
      </View>

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {finishing && task ? (
            <FocusCheckIn
              task={task}
              project={project}
              summary={host.summary}
              sentence={host.sentence}
              focusMinutes={clock.session.durations.focusMinutes}
              tr={tr}
              onDone={host.markDone}
              onApply={host.applyAction}
              onAskCoach={host.askCoach}
              onStartAnother={host.keepGoing}
              onTakeBreak={host.checkInBreak}
              onClose={host.closeFromCheckIn}
            />
          ) : finishing ? (
            <FocusFinish
              kind={host.finishKind}
              task={task}
              project={project}
              sentence={host.sentence}
              summary={host.summary}
              tr={tr}
              onMarkDone={() => { void host.markDone(); }}
              onTakeBreak={host.takeBreak}
              onKeepGoing={host.keepGoing}
            />
          ) : (
            <>
              <View style={styles.ringWrap} accessibilityRole="timer" accessibilityLabel={tr('focus.timeLeft', '{{time}} remaining').replace('{{time}}', clockText)}>
                <FocusRing progress={view === 'ready' ? 0 : clock.progress} phase={timerState.phase} size={232} stroke={6}>
                  <Text
                    style={[styles.clock, { color: soft.foreground, opacity: paused ? 0.72 : 1 }]}
                    testID="focus-clock"
                    allowFontScaling={false}
                  >
                    {clockText}
                  </Text>
                  {sub ? <Text style={[styles.sub, { color: soft.muted }]} testID="focus-sub">{sub}</Text> : null}
                </FocusRing>
              </View>

              <View style={[styles.card, { backgroundColor: soft.surface, borderColor: soft.border, borderRadius: soft.radius.sheet }]} testID={isBreak ? 'focus-break' : 'focus-card'}>
                {(project || (total > 0 && !isBreak)) ? (
                  <View style={styles.head}>
                    {project?.color ? <View style={[styles.dot, { backgroundColor: project.color }]} /> : null}
                    {project ? <Text style={[styles.headText, { color: soft.muted }]} numberOfLines={1}>{project.title}</Text> : <View style={styles.flex} />}
                    {total > 0 && !isBreak ? (
                      <Text style={[styles.headText, { color: soft.muted }]} testID="focus-count">
                        {tr('focus.stepProgress', 'Step {{current}} of {{total}}').replace('{{current}}', String(Math.min(total, done + 1))).replace('{{total}}', String(total))}
                      </Text>
                    ) : null}
                  </View>
                ) : null}
                {task ? (
                  <Text style={[styles.title, { color: soft.foreground }]} accessibilityRole="header">
                    {isBreak && currentStep
                      ? tr('focus.upNext', 'Up next: {{step}}').replace('{{step}}', currentStep.title)
                      : task.title}
                  </Text>
                ) : (
                  <Text style={[styles.title, styles.quiet, { color: soft.muted }]} testID="focus-timer-only">
                    {isBreak ? host.breakIdea : tr('pomodoro.timerOnly', 'Timer only')}
                  </Text>
                )}
                {task && isBreak ? <Text style={[styles.body, { color: soft.muted }]}>{host.breakIdea}</Text> : null}
                {task && !isBreak ? (
                  <>
                    <FocusCoachCard api={host.coach} tr={tr} />
                    <FocusSteps
                      steps={steps}
                      tr={tr}
                      onToggle={host.stepsApi.toggle}
                      onRemove={host.stepsApi.remove}
                      onAdd={host.stepsApi.add}
                    />
                  </>
                ) : null}
              </View>
              <Text style={[styles.note, { color: soft.muted }]} testID="focus-note" accessibilityLiveRegion="polite">{host.note ?? ' '}</Text>
              {controls}
            </>
          )}
          <Text style={styles.hidden} accessibilityLiveRegion="polite" testID="focus-live">{host.announcement}</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  glow: { position: 'absolute', width: 360, height: 360, borderRadius: 180, opacity: 0.55 },
  glowTop: { top: -140, right: -120 },
  glowBottom: { bottom: -160, left: -140 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 8 },
  topLabel: { fontSize: 13, fontWeight: '600', textTransform: 'uppercase' },
  topButton: { minWidth: 44, height: 44, borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  close: { fontSize: 14, fontWeight: '600' },
  content: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20, gap: 18 },
  ringWrap: { alignItems: 'center' },
  clock: { fontSize: 52, fontWeight: '200', fontVariant: ['tabular-nums'] },
  sub: { fontSize: 14, fontWeight: '500', marginTop: 2 },
  card: { alignSelf: 'stretch', borderWidth: StyleSheet.hairlineWidth, padding: 18, gap: 14 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  headText: { fontSize: 13, flexShrink: 1 },
  title: { fontSize: 22, lineHeight: 28, fontWeight: '700' },
  quiet: { fontWeight: '500', fontSize: 18 },
  body: { fontSize: 16, lineHeight: 22 },
  note: { fontSize: 14, textAlign: 'center', minHeight: 20 },
  controlRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 28 },
  roundMain: { width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center' },
  roundSmall: { width: 52, height: 52, borderRadius: 26, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  confirm: { alignSelf: 'stretch', gap: 10 },
  confirmTitle: { fontSize: 17, fontWeight: '600', textAlign: 'center' },
  hidden: { position: 'absolute', width: 1, height: 1, opacity: 0 },
});
