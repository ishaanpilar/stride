import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';
import { buildDailyBriefingInput, isAIMorningBriefingEnabled, shallow, useTaskStore } from '@stride/core';

import { useLanguage } from '@/contexts/language-context';
import { useThemeColors } from '@/hooks/use-theme-colors';

import {
    ensureBriefing,
    isBriefingDismissed,
    readCachedBriefing,
    setBriefingDismissed,
} from './morning-briefing-service';

type BriefingState = Awaited<ReturnType<typeof readCachedBriefing>>;

/**
 * Morning briefing for the Focus tab. With AI configured it shows the (daily cached) AI briefing;
 * otherwise, or when generation fails or times out, it shows a plain summary of today's tasks.
 */
export function MorningBriefingCard() {
    const tc = useThemeColors();
    const { t, language } = useLanguage();
    // English fallbacks keep untranslated keys readable (same resolveText pattern as manage-settings).
    const tr = (key: string, fallback: string) => {
        const value = t(key);
        return value && value !== key ? value : fallback;
    };
    const { tasks, projects, settings } = useTaskStore((state) => ({
        tasks: state.tasks,
        projects: state.projects,
        settings: state.settings,
    }), shallow);
    const aiOn = isAIMorningBriefingEnabled(settings);
    const [briefing, setBriefing] = useState<BriefingState>(null);
    const [loading, setLoading] = useState(false);
    const [failed, setFailed] = useState(false);
    const [dismissed, setDismissed] = useState<boolean | null>(null);

    const run = useCallback(async (force: boolean) => {
        setLoading(true);
        setFailed(false);
        const result = await ensureBriefing({ force, language });
        setBriefing(result);
        setFailed(!result);
        setLoading(false);
    }, [language]);

    useEffect(() => {
        let active = true;
        void isBriefingDismissed().then((value) => { if (active) setDismissed(value); });
        return () => { active = false; };
    }, []);

    useEffect(() => {
        if (!aiOn || dismissed !== false) return;
        void run(false);
    }, [aiOn, dismissed, run]);

    const fallback = useMemo(() => {
        const input = buildDailyBriefingInput(tasks, projects, new Date());
        return { overdue: input.overdue, dueToday: input.dueToday, focus: input.focus };
    }, [tasks, projects]);

    if (dismissed !== false) return null;

    const titleOf = (id: string) => tasks.find((task) => task.id === id && !task.deletedAt)?.title;
    const top = (briefing?.top ?? []).filter((item) => titleOf(item.taskId));
    const plain = [...fallback.overdue, ...fallback.dueToday, ...fallback.focus]
        .filter((task, index, all) => all.findIndex((other) => other.id === task.id) === index)
        .slice(0, 5);
    const heading = briefing?.headline || tr('digest.morningTitle', 'Morning briefing');

    return (
        <View
            testID="morning-briefing-card"
            accessibilityLabel={tr('digest.morningTitle', 'Morning briefing')}
            style={{ borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 12, borderColor: tc.border, backgroundColor: tc.cardBg }}
        >
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text numberOfLines={2} style={{ flex: 1, fontSize: 15, fontWeight: '600', color: tc.text }}>{heading}</Text>
                {aiOn ? (
                    <TouchableOpacity
                        testID="morning-briefing-refresh"
                        accessibilityRole="button"
                        accessibilityLabel={tr('briefing.refresh', 'Refresh')}
                        disabled={loading}
                        hitSlop={8}
                        onPress={() => void run(true)}
                        style={{ paddingHorizontal: 8 }}
                    >
                        {loading ? <ActivityIndicator size="small" color={tc.secondaryText} /> : <Text style={{ color: tc.tint, fontSize: 13 }}>{tr('briefing.refresh', 'Refresh')}</Text>}
                    </TouchableOpacity>
                ) : null}
                <TouchableOpacity
                    testID="morning-briefing-dismiss"
                    accessibilityRole="button"
                    accessibilityLabel={tr('common.dismiss', 'Dismiss')}
                    hitSlop={8}
                    onPress={() => { setDismissed(true); void setBriefingDismissed(true); }}
                    style={{ paddingHorizontal: 8 }}
                >
                    <Text style={{ color: tc.secondaryText, fontSize: 16 }}>x</Text>
                </TouchableOpacity>
            </View>

            {top.length > 0 ? (
                <View style={{ marginTop: 8 }}>
                    {top.map((item, index) => (
                        <Text key={item.taskId} style={{ color: tc.text, fontSize: 14, marginBottom: 4 }}>
                            {`${index + 1}. ${titleOf(item.taskId)}`}
                            {item.why ? <Text style={{ color: tc.secondaryText }}>{` - ${item.why}`}</Text> : null}
                        </Text>
                    ))}
                    {briefing?.suggestion ? (
                        <Text style={{ color: tc.secondaryText, fontSize: 12, fontStyle: 'italic', marginTop: 4 }}>{briefing.suggestion}</Text>
                    ) : null}
                </View>
            ) : (
                <View style={{ marginTop: 8 }}>
                    {failed && aiOn ? (
                        <Text testID="morning-briefing-failed" style={{ color: tc.secondaryText, fontSize: 12, marginBottom: 4 }}>
                            {tr('briefing.unavailable', 'AI briefing unavailable, showing today\'s tasks.')}
                        </Text>
                    ) : null}
                    {plain.length === 0 && !loading ? (
                        <Text style={{ color: tc.secondaryText, fontSize: 14 }}>{tr('briefing.nothingToday', 'Nothing due today.')}</Text>
                    ) : null}
                    {plain.map((task) => (
                        <Text key={task.id} style={{ color: tc.text, fontSize: 14, marginBottom: 4 }}>{`- ${task.title}`}</Text>
                    ))}
                </View>
            )}
        </View>
    );
}
