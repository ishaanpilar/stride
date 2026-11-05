import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { Check, Coffee } from 'lucide-react-native';
import type { Project, Task } from '@stride/core';
import { useThemeTokens } from '../../hooks/use-theme-tokens';
import { useMotionEnabled } from '../../lib/motion-preference';
import { GradientButton } from '../soft';
import type { FocusText } from './useFocusText';

export type FinishKind = 'session' | 'task';

export interface FocusSummary {
  minutes: number;
  stepsDone: number;
  stepsTotal: number;
  sessionsToday: number;
  streak: number;
}

export function FocusMark({ size = 72 }: { size?: number }) {
  const { soft } = useThemeTokens();
  const motion = useMotionEnabled();
  const scale = useRef(new Animated.Value(motion ? 0.6 : 1)).current;
  useEffect(() => {
    if (!motion) {
      scale.setValue(1);
      return;
    }
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, friction: 6 }).start();
  }, [motion, scale]);
  return (
    <Animated.View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={[styles.mark, { width: size, height: size, borderRadius: size / 2, backgroundColor: soft.accentSoft, transform: [{ scale }] }]}
    >
      <Check size={size * 0.5} color={soft.accent} strokeWidth={3} />
    </Animated.View>
  );
}

export function FocusTaskLine({ task, project }: { task?: Task; project?: Project }) {
  const { soft } = useThemeTokens();
  if (!task) return null;
  return (
    <View style={styles.taskLine}>
      {project?.color ? <View style={[styles.dot, { backgroundColor: project.color }]} /> : null}
      <Text style={[styles.taskText, { color: soft.muted }]} numberOfLines={2}>{task.title}</Text>
    </View>
  );
}

export function statsFor(summary: FocusSummary, tr: FocusText): [string, string][] {
  const stats: [string, string][] = [[tr('focus.minutesFocused', 'Minutes focused'), String(summary.minutes)]];
  if (summary.stepsTotal > 0) stats.push([tr('focus.stepsDone', 'Steps done'), `${summary.stepsDone}/${summary.stepsTotal}`]);
  if (summary.sessionsToday > 0) stats.push([tr('focus.sessionsToday', 'Sessions today'), String(summary.sessionsToday)]);
  if (summary.streak > 1) stats.push([tr('focus.streak', 'Day streak'), String(summary.streak)]);
  return stats;
}

export interface FocusFinishProps {
  kind: FinishKind;
  task?: Task;
  project?: Project;
  sentence: string;
  summary: FocusSummary;
  tr: FocusText;
  onMarkDone: () => void;
  onTakeBreak: () => void;
  onKeepGoing: () => void;
}

export function FocusFinish({ kind, task, project, sentence, summary, tr, onMarkDone, onTakeBreak, onKeepGoing }: FocusFinishProps) {
  const { soft } = useThemeTokens();
  const allStepsDone = summary.stepsTotal > 0 && summary.stepsDone >= summary.stepsTotal;
  const heading = kind === 'task' || allStepsDone
    ? tr('focus.allStepsDone', 'Every step is done')
    : tr('focus.sessionDone', 'Session complete');
  const stats = statsFor(summary, tr);
  const takeBreak = <GradientButton key="break" label={tr('focus.takeBreak', 'Take a break')} icon={<Coffee size={18} color={soft.accentForeground} />} onPress={onTakeBreak} fullWidth />;
  const keepGoing = <GradientButton key="keep" label={tr('focus.keepGoing', 'Keep going')} variant="secondary" onPress={onKeepGoing} fullWidth />;
  const markDone = (variant: 'primary' | 'ghost') => (
    <GradientButton key="done" label={tr('pomodoro.markTaskDone', 'Mark task done')} variant={variant} onPress={onMarkDone} fullWidth />
  );
  const actions = !task
    ? [takeBreak, keepGoing]
    : allStepsDone
      ? [markDone('primary'), <GradientButton key="break2" label={tr('focus.takeBreak', 'Take a break')} variant="secondary" onPress={onTakeBreak} fullWidth />, <GradientButton key="keep2" label={tr('focus.keepGoing', 'Keep going')} variant="ghost" onPress={onKeepGoing} fullWidth />]
      : [takeBreak, keepGoing, markDone('ghost')];

  return (
    <View style={styles.root} testID="focus-summary" accessibilityRole="summary">
      <FocusMark />
      <FocusTaskLine task={task} project={project} />
      <Text style={[styles.heading, { color: soft.foreground }]} accessibilityRole="header">{heading}</Text>
      {sentence ? <Text style={[styles.line, { color: soft.muted }]}>{sentence}</Text> : null}
      <View style={styles.stats}>
        {stats.map(([label, value]) => (
          <View key={label} style={styles.stat}>
            <Text style={[styles.statValue, { color: soft.foreground }]}>{value}</Text>
            <Text style={[styles.statLabel, { color: soft.tertiary }]}>{label}</Text>
          </View>
        ))}
      </View>
      <View style={styles.actions}>{actions}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: 'center', gap: 12, width: '100%' },
  mark: { alignItems: 'center', justifyContent: 'center' },
  taskLine: { flexDirection: 'row', alignItems: 'center', gap: 8, maxWidth: '90%' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  taskText: { fontSize: 15, textAlign: 'center' },
  heading: { fontSize: 26, fontWeight: '700', textAlign: 'center' },
  line: { fontSize: 16, lineHeight: 22, textAlign: 'center' },
  stats: { flexDirection: 'row', justifyContent: 'center', gap: 24, flexWrap: 'wrap', marginTop: 4 },
  stat: { alignItems: 'center', gap: 2 },
  statValue: { fontSize: 22, fontWeight: '700', fontVariant: ['tabular-nums'] },
  statLabel: { fontSize: 12 },
  actions: { alignSelf: 'stretch', gap: 10, marginTop: 12 },
});
