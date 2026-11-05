import React, { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Pause, Play } from 'lucide-react-native';
import { formatPomodoroClock, useTaskStore } from '@stride/core';
import { useThemeTokens } from '../../hooks/use-theme-tokens';
import { focusSessionStore, useFocusSessionUi } from '../../lib/focus-session-store';
import { mobilePomodoroController } from '../../lib/pomodoro-controller';
import { openFocusSession } from '../../lib/start-focus';
import { useFocusClock } from './useFocusClock';
import { useFocusText } from './useFocusText';

export function shouldShowFocusMini(input: { open: boolean; presentation: 'full' | 'mini'; hydrating: boolean }): boolean {
  return !input.hydrating && input.open && input.presentation === 'mini';
}

export function FocusMiniBar({ bottomOffset = 0 }: { bottomOffset?: number }) {
  const { soft } = useThemeTokens();
  const tr = useFocusText();
  const ui = useFocusSessionUi();
  const clock = useFocusClock(ui.open);
  const { session, autoStart, remainingSeconds, progress } = clock;
  const { timerState, selectedTaskId, isHydrating } = session;
  const task = useTaskStore((state) => (selectedTaskId ? state.tasks.find((t) => t.id === selectedTaskId) : undefined));

  useEffect(() => {
    if (isHydrating) return;
    if (!timerState.isRunning && ui.dismissed) focusSessionStore.clearDismissed();
    if (timerState.isRunning && selectedTaskId && !ui.open && !ui.dismissed) focusSessionStore.open('mini');
  }, [isHydrating, selectedTaskId, timerState.isRunning, ui.dismissed, ui.open]);

  if (!shouldShowFocusMini({ open: ui.open, presentation: ui.presentation, hydrating: isHydrating })) return null;

  const clockText = formatPomodoroClock(remainingSeconds);
  const label = task?.title ?? tr('pomodoro.timerOnly', 'Timer only');
  const phaseLabel = timerState.phase === 'break' ? tr('pomodoro.phaseBreakShort', 'Break') : null;
  const reopen = () => { void openFocusSession(); };
  const runLabel = timerState.isRunning ? tr('common.pause', 'Pause') : tr('common.start', 'Start');
  const RunIcon = timerState.isRunning ? Pause : Play;

  return (
    <View
      style={[styles.wrap, { bottom: bottomOffset, backgroundColor: soft.surface, borderColor: soft.border, borderRadius: soft.radius.card, ...soft.raised('sm') }]}
      testID="focus-mini"
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${tr('focus.stageLabel', 'Focus session')}: ${label}, ${clockText}`}
        accessibilityHint={tr('focus.mini.open', 'Opens the focus session')}
        onPress={reopen}
        style={styles.main}
      >
        <Text style={[styles.clock, { color: soft.foreground }]} allowFontScaling={false}>{clockText}</Text>
        <View style={styles.text}>
          <Text style={[styles.title, { color: soft.foreground }]} numberOfLines={1}>{label}</Text>
          {phaseLabel ? <Text style={[styles.phase, { color: soft.successText }]}>{phaseLabel}</Text> : null}
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={runLabel}
        hitSlop={6}
        onPress={() => { mobilePomodoroController.toggle(autoStart); }}
        style={[styles.run, { backgroundColor: soft.accentStrong }]}
      >
        <RunIcon size={18} color={soft.accentForeground} fill={soft.accentForeground} />
      </Pressable>
      <View style={[styles.track, { backgroundColor: soft.well }]} pointerEvents="none">
        <View style={[styles.fill, { width: `${Math.round(progress * 100)}%`, backgroundColor: timerState.phase === 'break' ? soft.successFill : soft.accent }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 12, right: 12, minHeight: 56, flexDirection: 'row', alignItems: 'center', paddingLeft: 14, paddingRight: 8, paddingVertical: 8, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden', gap: 10 },
  main: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 },
  clock: { fontSize: 20, fontWeight: '600', fontVariant: ['tabular-nums'] },
  text: { flex: 1 },
  title: { fontSize: 15, fontWeight: '600' },
  phase: { fontSize: 12, fontWeight: '600' },
  run: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  track: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 3 },
  fill: { height: 3 },
});
