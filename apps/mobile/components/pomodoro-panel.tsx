import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { ChevronDown, ChevronUp, Check, Flame, Maximize2, RotateCcw } from 'lucide-react-native';
import { workspaceSessionStorage as AsyncStorage } from '@/lib/workspace-session-storage';
import {
  type Task,
  formatPomodoroClock,
  getPomodoroFocusSessionsCompletedToday,
  getPomodoroPresetOptions,
  isTaskActionable,
  type PomodoroAutoStartOptions,
  tFallback,
  useTaskStore,
} from '@stride/core';

import { useLanguage } from '../contexts/language-context';
import { useThemeTokens } from '@/hooks/use-theme-tokens';
import { logWarn } from '../lib/app-log';
import { POMODORO_COLLAPSED_STORAGE_KEY } from '../lib/pomodoro-session';
import { mobilePomodoroController, useMobilePomodoroControllerState } from '../lib/pomodoro-controller';
import { useFocusSessionUi } from '../lib/focus-session-store';
import { focusStreakStore, hydrateFocusStorage } from '../lib/focus-storage';
import { FocusRing } from './focus/FocusRing';
import { GradientButton, SoftCard, SoftChip, SoftIconButton } from './soft';
import { openFocusSession, startFocusFromTask } from '../lib/start-focus';

export function PomodoroPanel({
  tasks,
  onMarkDone,
}: {
  tasks: Task[];
  onMarkDone: (taskId: string) => void;
}) {
  const { t } = useLanguage();
  const { soft } = useThemeTokens();
  const focusUi = useFocusSessionUi();
  const [streak, setStreak] = useState(0);
  const customDurations = useTaskStore((state) => state.settings.gtd?.pomodoro?.customDurations);
  const linkTaskEnabled = useTaskStore((state) => state.settings.gtd?.pomodoro?.linkTask === true);
  const liveTasks = useTaskStore((state) => state.tasks);
  const actionableTasksById = useMemo(
    () => new Map(liveTasks.filter(isTaskActionable).map((task) => [task.id, task])),
    [liveTasks]
  );
  const autoStartBreaks = useTaskStore((state) => state.settings.gtd?.pomodoro?.autoStartBreaks === true);
  const autoStartFocus = useTaskStore((state) => state.settings.gtd?.pomodoro?.autoStartFocus === true);
  const autoStartOptions = useMemo<PomodoroAutoStartOptions>(
    () => ({ autoStartBreaks, autoStartFocus }),
    [autoStartBreaks, autoStartFocus]
  );
  const pomodoro = useMobilePomodoroControllerState();
  const { durations, timerState, selectedTaskId, lastEvent, sessionHistory } = pomodoro;


  const [collapsed, setCollapsed] = useState(false);
  const isHydratingSession = pomodoro.isHydrating;
  const [isTaskPickerOpen, setIsTaskPickerOpen] = useState(false);

  useEffect(() => {
    void mobilePomodoroController.ensureHydrated(autoStartOptions);
  }, [autoStartOptions]);

  useEffect(() => {
    if (!linkTaskEnabled) {
      setIsTaskPickerOpen(false);
      return;
    }
    if (!selectedTaskId) return;
    if (actionableTasksById.has(selectedTaskId)) return;
    mobilePomodoroController.setSelectedTaskId(undefined, autoStartOptions);
  }, [actionableTasksById, autoStartOptions, linkTaskEnabled, selectedTaskId]);

  const selectedTask = linkTaskEnabled && selectedTaskId ? actionableTasksById.get(selectedTaskId) : undefined;
  const pickerTasks = useMemo(() => tasks.flatMap((task) => {
    const liveTask = actionableTasksById.get(task.id);
    return liveTask ? [liveTask] : [];
  }), [actionableTasksById, tasks]);
  const presetOptions = useMemo(() => getPomodoroPresetOptions(customDurations), [customDurations]);

  const cardTitle = tFallback(t, 'pomodoro.mobileTitle', 'Pomodoro Timer');
  const focusDoneLabel = tFallback(t, 'pomodoro.focusComplete', 'Focus session complete. Take a short break.');
  const breakDoneLabel = tFallback(t, 'pomodoro.breakComplete', 'Break complete. Ready for the next focus session.');
  const phaseLabel = timerState.phase === 'focus'
    ? tFallback(t, 'pomodoro.phaseFocusShort', 'Focus')
    : tFallback(t, 'pomodoro.phaseBreakShort', 'Break');
  const noTaskLabel = tFallback(t, 'pomodoro.noTask', 'No available focus task');
  const loadingLabel = tFallback(t, 'common.loading', 'Loading...');
  const sessionsDoneLabel = tFallback(t, 'pomodoro.sessionsDone', 'Focus sessions completed');
  const pauseLabel = tFallback(t, 'common.pause', 'Pause');
  const startLabel = tFallback(t, 'common.start', 'Start');
  const resetLabel = tFallback(t, 'common.reset', 'Reset');
  const switchLabel = timerState.phase === 'focus'
    ? tFallback(t, 'pomodoro.switchToBreak', 'Switch to Break')
    : tFallback(t, 'pomodoro.switchToFocus', 'Switch to Focus');
  const markDoneLabel = tFallback(t, 'pomodoro.markTaskDone', 'Mark task done');
  const selectedTaskLabel = tFallback(t, 'pomodoro.selectedTask', 'Timer task');
  const timerOnlyLabel = tFallback(t, 'pomodoro.timerOnly', 'Timer only');
  const changeTaskLabel = selectedTask ? tFallback(t, 'common.change', 'Change') : tFallback(t, 'pomodoro.linkTask', 'Link task');
  const runningLabel = tFallback(t, 'pomodoro.running', 'Running');
  const pausedLabel = tFallback(t, 'pomodoro.paused', 'Paused');
  const handleApplyPreset = (focusMinutes: number, breakMinutes: number) => {
    mobilePomodoroController.setDurations({ focusMinutes, breakMinutes }, autoStartOptions);
  };

  useEffect(() => {
    let active = true;
    void AsyncStorage.getItem(POMODORO_COLLAPSED_STORAGE_KEY)
      .then((raw) => {
        if (!active || raw === null) return;
        setCollapsed(raw === 'true');
      })
      .catch((error) => {
        logWarn('Failed to read pomodoro collapse preference', { scope: 'pomodoro', extra: { error: String(error) } });
      });
    return () => {
      active = false;
    };
  }, []);

  const toggleCollapsed = (next: boolean) => {
    setCollapsed(next);
    void AsyncStorage.setItem(POMODORO_COLLAPSED_STORAGE_KEY, String(next)).catch((error) => {
      logWarn('Failed to save pomodoro collapse preference', { scope: 'pomodoro', extra: { error: String(error) } });
    });
  };

  const handleToggleRun = () => {
    mobilePomodoroController.toggle(autoStartOptions);
  };

  const handleReset = () => {
    mobilePomodoroController.reset(autoStartOptions);
  };

  const handleSwitchPhase = () => {
    mobilePomodoroController.switchPhase(autoStartOptions);
  };

  const handleMarkDone = () => {
    if (!selectedTask) return;
    onMarkDone(selectedTask.id);
    mobilePomodoroController.clearLastEvent(autoStartOptions);
  };

  const collapseLabel = tFallback(t, 'pomodoro.collapse', 'Collapse timer');
  const expandLabel = tFallback(t, 'pomodoro.expand', 'Expand timer');
  const openFocusLabel = tFallback(t, 'pomodoro.openFocus', 'Open focus');
  const startFocusLabel = tFallback(t, 'pomodoro.startFocus', 'Start focus');
  const streakLabel = tFallback(t, 'focus.streak', 'Day streak');
  const phaseColor = timerState.phase === 'focus' ? soft.accentText : soft.successText;
  const isRunning = timerState.isRunning;
  const sessionsToday = getPomodoroFocusSessionsCompletedToday(sessionHistory);
  const totalSeconds = Math.max(1, (timerState.phase === 'focus' ? durations.focusMinutes : durations.breakMinutes) * 60);
  const progress = Math.min(1, Math.max(0, 1 - timerState.remainingSeconds / totalSeconds));
  const inProgress = progress > 0 && !isRunning;
  const sessionLive = focusUi.open && (isRunning || timerState.phase === 'focus');

  useEffect(() => {
    void hydrateFocusStorage().then(() => setStreak(focusStreakStore.getFocusStreak()));
  }, [sessionsToday]);

  const openFocus = () => { void openFocusSession(); };

  const startFocusOnTask = () => {
    if (selectedTask) void startFocusFromTask(selectedTask.id, 'focus');
  };

  const collapseToggle = (
    <Pressable
      accessibilityLabel={collapsed ? expandLabel : collapseLabel}
      accessibilityRole="button"
      hitSlop={8}
      onPress={() => toggleCollapsed(!collapsed)}
      style={styles.collapseToggle}
    >
      {collapsed
        ? <ChevronDown size={18} color={soft.muted} />
        : <ChevronUp size={18} color={soft.muted} />}
    </Pressable>
  );

  if (collapsed) {
    return (
      <SoftCard style={styles.card}>
        <View style={styles.collapsedRow}>
          <Text style={[styles.collapsedClock, { color: soft.foreground }]}>
            {formatPomodoroClock(timerState.remainingSeconds)}
          </Text>
          <Text style={[styles.phaseStatusText, { color: phaseColor }]} numberOfLines={1}>
            {`${phaseLabel} · ${isRunning ? runningLabel : pausedLabel}`}
          </Text>
          {isRunning && (
            <View
              accessible={false}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={[styles.collapsedRunningDot, { backgroundColor: phaseColor }]}
            />
          )}
          <View style={styles.collapsedSpacer} />
          {collapseToggle}
        </View>
      </SoftCard>
    );
  }

  return (
    <SoftCard size="lg" style={styles.card}>
      <View style={styles.headerRow}>
        <View style={styles.headerText}>
          <Text style={[styles.title, { color: soft.muted }]}>{cardTitle}</Text>
        </View>
        <View style={styles.phaseStatus}>
          <Text style={[styles.phaseStatusText, { color: phaseColor }]}>
            {phaseLabel}
          </Text>
        </View>
        {collapseToggle}
      </View>

      {isHydratingSession && (
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" color={soft.accent} />
          <Text style={[styles.loadingText, { color: soft.muted }]}>{loadingLabel}</Text>
        </View>
      )}

      <View style={styles.mainRow}>
        <FocusRing progress={progress} phase={timerState.phase} size={116} stroke={5}>
          <Text style={[styles.timerText, { color: soft.foreground }]} allowFontScaling={false} testID="pomodoro-clock">
            {formatPomodoroClock(timerState.remainingSeconds)}
          </Text>
        </FocusRing>

        <View style={styles.sideColumn}>
          {(sessionsToday > 0 || streak > 0) && (
            <View style={styles.sessionsRow} accessibilityLabel={`${sessionsDoneLabel}: ${sessionsToday}`}>
              {Array.from({ length: Math.min(8, sessionsToday) }, (_, index) => (
                <View key={index} style={[styles.sessionDot, { backgroundColor: soft.accent }]} />
              ))}
              {streak > 0 && (
                <View style={styles.streak} accessibilityLabel={`${streakLabel}: ${streak}`}>
                  <Flame size={12} color={soft.muted} />
                  <Text style={[styles.sessionText, { color: soft.muted }]}>{streak}</Text>
                </View>
              )}
            </View>
          )}

          {linkTaskEnabled ? (
            <View style={styles.taskLinkRow}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={selectedTaskLabel}
                onPress={() => setIsTaskPickerOpen(true)}
                style={styles.taskPickerButton}
              >
                <Text style={[styles.taskPickerValue, { color: soft.foreground }]} numberOfLines={3}>
                  {selectedTask?.title ?? timerOnlyLabel}
                </Text>
                <Text style={[styles.taskPickerAction, { color: soft.accentText }]}>{changeTaskLabel}</Text>
              </Pressable>
              {selectedTask && (
                <SoftIconButton
                  icon="checkmark"
                  variant="ghost"
                  size={20}
                  accessibilityLabel={markDoneLabel}
                  onPress={handleMarkDone}
                  disabled={isHydratingSession}
                />
              )}
            </View>
          ) : null}

          <View style={styles.timerActionRow}>
            <GradientButton
              label={isRunning ? pauseLabel : startLabel}
              onPress={handleToggleRun}
              disabled={isHydratingSession}
              style={styles.startButton}
            />
            {(inProgress || isRunning) && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={resetLabel}
                hitSlop={8}
                onPress={handleReset}
                disabled={isHydratingSession}
                style={styles.resetButton}
              >
                <RotateCcw size={18} color={soft.muted} />
              </Pressable>
            )}
          </View>
        </View>
      </View>

      {!isRunning && (
        <View style={styles.presetRow}>
          {presetOptions.map((preset) => {
            const active = durations.focusMinutes === preset.focusMinutes && durations.breakMinutes === preset.breakMinutes;
            return (
              <SoftChip
                key={preset.id}
                label={preset.label}
                selected={active}
                onPress={isHydratingSession ? undefined : () => handleApplyPreset(preset.focusMinutes, preset.breakMinutes)}
              />
            );
          })}
        </View>
      )}

      <View style={styles.linksRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={switchLabel}
          onPress={handleSwitchPhase}
          disabled={isHydratingSession}
          hitSlop={6}
        >
          <Text style={[styles.linkText, { color: soft.muted }]}>{switchLabel}</Text>
        </Pressable>
        {sessionLive ? (
          <Pressable accessibilityRole="button" accessibilityLabel={openFocusLabel} onPress={openFocus} hitSlop={6} style={styles.linkWithIcon}>
            <Maximize2 size={14} color={soft.accentText} />
            <Text style={[styles.linkText, { color: soft.accentText }]}>{openFocusLabel}</Text>
          </Pressable>
        ) : selectedTask ? (
          <Pressable accessibilityRole="button" accessibilityLabel={startFocusLabel} onPress={startFocusOnTask} hitSlop={6} style={styles.linkWithIcon}>
            <Maximize2 size={14} color={soft.accentText} />
            <Text style={[styles.linkText, { color: soft.accentText }]}>{startFocusLabel}</Text>
          </Pressable>
        ) : null}
      </View>

      {lastEvent && (
        <Text style={[styles.eventText, { color: soft.muted }]}>
          {lastEvent === 'focus-finished' ? focusDoneLabel : breakDoneLabel}
        </Text>
      )}

      {linkTaskEnabled && (
        <Modal
          visible={isTaskPickerOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setIsTaskPickerOpen(false)}
        >
          <View style={styles.modalRoot}>
            <Pressable style={[styles.modalScrim, { backgroundColor: soft.foreground }]} onPress={() => setIsTaskPickerOpen(false)} />
            <View style={[styles.taskPickerSheet, { backgroundColor: soft.surface, borderColor: soft.border, borderRadius: soft.radius.sheet }]}>
              <Text style={[styles.taskPickerSheetTitle, { color: soft.foreground }]}>{selectedTaskLabel}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: !selectedTaskId }}
                onPress={() => {
                  mobilePomodoroController.setSelectedTaskId(undefined, autoStartOptions);
                  setIsTaskPickerOpen(false);
                }}
                style={[
                  styles.taskPickerOption,
                  {
                    borderColor: !selectedTaskId ? soft.accent : soft.border,
                    borderWidth: !selectedTaskId ? 2 : 1,
                    backgroundColor: !selectedTaskId ? soft.accentSoft : soft.well,
                  },
                ]}
              >
                <Text style={[styles.taskPickerOptionText, { color: !selectedTaskId ? soft.accentText : soft.foreground }]}>
                  {timerOnlyLabel}
                </Text>
                {!selectedTaskId && <Check size={16} color={soft.accent} strokeWidth={2.5} />}
              </Pressable>
              <FlatList
                data={pickerTasks}
                renderItem={({ item: task }) => {
                  const selected = task.id === selectedTaskId;
                  return (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      onPress={() => {
                        mobilePomodoroController.setSelectedTaskId(task.id, autoStartOptions);
                        setIsTaskPickerOpen(false);
                      }}
                      style={[
                        styles.taskPickerOption,
                        {
                          borderColor: selected ? soft.accent : soft.border,
                          borderWidth: selected ? 2 : 1,
                          backgroundColor: selected ? soft.accentSoft : soft.well,
                        },
                      ]}
                    >
                      <Text
                        style={[styles.taskPickerOptionText, { color: selected ? soft.accentText : soft.foreground }]}
                        numberOfLines={2}
                      >
                        {task.title}
                      </Text>
                      {selected && <Check size={16} color={soft.accent} strokeWidth={2.5} />}
                    </Pressable>
                  );
                }}
                keyExtractor={(task) => task.id}
                style={styles.taskPickerList}
                contentContainerStyle={styles.taskPickerListContent}
                initialNumToRender={12}
                maxToRenderPerBatch={12}
                windowSize={5}
                updateCellsBatchingPeriod={50}
                removeClippedSubviews={false}
                showsVerticalScrollIndicator={false}
                ListEmptyComponent={
                  <Text style={[styles.noTaskText, { color: soft.muted }]}>{noTaskLabel}</Text>
                }
              />
            </View>
          </View>
        </Modal>
      )}
    </SoftCard>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: 12,
    marginBottom: 12,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  collapsedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  collapsedClock: {
    fontSize: 20,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  collapsedRunningDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  collapsedSpacer: {
    flex: 1,
  },
  collapseToggle: {
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  headerText: {
    flex: 1,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  loadingText: {
    fontSize: 12,
    fontWeight: '500',
  },
  title: {
    fontSize: 13,
    fontWeight: '600',
  },
  phaseStatus: {
    paddingTop: 2,
  },
  phaseStatusText: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  mainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  sideColumn: {
    flex: 1,
    minWidth: 0,
    gap: 10,
  },
  timerText: {
    fontSize: 30,
    fontWeight: '300',
    fontVariant: ['tabular-nums'],
  },
  sessionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  sessionDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  streak: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginLeft: 4,
  },
  sessionText: {
    fontSize: 12,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  presetRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  taskLinkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  taskPickerButton: {
    flex: 1,
    minWidth: 0,
    gap: 2,
    minHeight: 44,
    justifyContent: 'center',
  },
  taskPickerValue: {
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '600',
  },
  taskPickerAction: {
    fontSize: 12,
    fontWeight: '700',
  },
  timerActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  startButton: {
    minWidth: 112,
  },
  resetButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  linksRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    flexWrap: 'wrap',
  },
  linkWithIcon: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  linkText: {
    fontSize: 13,
    fontWeight: '600',
  },
  eventText: {
    fontSize: 12,
    fontWeight: '500',
  },
  modalRoot: {
    flex: 1,
    justifyContent: 'center',
    padding: 20,
  },
  modalScrim: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.5,
  },
  taskPickerSheet: {
    borderWidth: 1,
    padding: 12,
    gap: 10,
    maxHeight: '72%',
  },
  taskPickerSheetTitle: {
    fontSize: 16,
    fontWeight: '800',
  },
  taskPickerList: {
    maxHeight: 320,
  },
  taskPickerListContent: {
    gap: 8,
  },
  taskPickerOption: {
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  taskPickerOptionText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
  },
  noTaskText: {
    fontSize: 13,
    fontWeight: '600',
    paddingVertical: 8,
  },
});
