import React, { useEffect, useMemo, useState } from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';
import {
    AREA_DESCRIPTION_MAX_CHARS,
    normalizeAreaDescription,
    normalizeAreaKeywords,
    tFallback,
    useTaskStore,
    type Person,
} from '@stride/core';

import { useThemeColors } from '@/hooks/use-theme-colors';

type Translate = (key: string) => string;

const fill = (template: string, values: Record<string, string>) =>
    Object.entries(values).reduce((out, [key, value]) => out.split(`{{${key}}}`).join(value), template);

/**
 * Routing context for one area (description, keywords, linked People). Mirrors the desktop
 * AreaContextEditor: every change is normalized by core and saved straight to the synced Area.
 */
export function AreaContextEditor({ areaId, t: rawT }: { areaId: string; t: Translate }) {
    const tc = useThemeColors();
    const t = (key: string, fallback: string) => tFallback(rawT, key, fallback);
    const area = useTaskStore((state) => state.areas.find((entry) => entry.id === areaId && !entry.deletedAt));
    const updateArea = useTaskStore((state) => state.updateArea);
    const addPerson = useTaskStore((state) => state.addPerson);
    const people = useTaskStore((state) => state.people);
    const livePeople = useMemo(() => people.filter((person) => !person.deletedAt), [people]);

    const [description, setDescription] = useState(area?.description ?? '');
    const [keywordDraft, setKeywordDraft] = useState('');
    const [personDraft, setPersonDraft] = useState('');

    useEffect(() => {
        setDescription(area?.description ?? '');
    }, [area?.id, area?.description]);

    if (!area) return null;

    const linked = (area.peopleIds ?? [])
        .map((id) => livePeople.find((person) => person.id === id))
        .filter((person): person is Person => Boolean(person));
    const findPerson = (name: string) => livePeople.find((person) => person.name.trim().toLowerCase() === name.trim().toLowerCase());
    const suggestions = personDraft.trim()
        ? livePeople
            .filter((person) => !(area.peopleIds ?? []).includes(person.id)
                && person.name.toLowerCase().includes(personDraft.trim().toLowerCase()))
            .slice(0, 5)
        : [];

    const commitDescription = () => {
        const next = normalizeAreaDescription(description);
        if ((next ?? '') === (area.description ?? '')) return;
        void updateArea(area.id, { description: next });
    };
    const setKeywords = (next: string[]) => void updateArea(area.id, { keywords: normalizeAreaKeywords(next) });
    const addKeyword = () => {
        const parts = keywordDraft.split(',').map((keyword) => keyword.trim()).filter(Boolean);
        if (!parts.length) return;
        setKeywords([...(area.keywords ?? []), ...parts]);
        setKeywordDraft('');
    };
    const setPeople = (ids: string[]) => void updateArea(area.id, { peopleIds: ids.length ? ids : undefined });
    const linkPerson = async (name: string) => {
        const trimmed = name.trim();
        if (!trimmed) return;
        const person = findPerson(trimmed) ?? await addPerson(trimmed);
        if (person && !(area.peopleIds ?? []).includes(person.id)) setPeople([...(area.peopleIds ?? []), person.id]);
        setPersonDraft('');
    };
    const draftIsNew = Boolean(personDraft.trim()) && !findPerson(personDraft);

    const inputStyle = {
        borderWidth: 1,
        borderRadius: 8,
        paddingHorizontal: 10,
        paddingVertical: 8,
        fontSize: 14,
        borderColor: tc.border,
        backgroundColor: tc.bg,
        color: tc.text,
    } as const;
    const labelStyle = { fontSize: 13, fontWeight: '600', color: tc.secondaryText, marginTop: 12, marginBottom: 4 } as const;
    const chipStyle = {
        flexDirection: 'row',
        alignItems: 'center',
        borderWidth: 1,
        borderRadius: 14,
        paddingLeft: 10,
        paddingRight: 4,
        paddingVertical: 2,
        marginRight: 6,
        marginBottom: 6,
        borderColor: tc.border,
        backgroundColor: tc.cardBg,
    } as const;

    return (
        <View testID="area-context-editor">
            <Text style={{ fontSize: 12, color: tc.secondaryText, marginTop: 12 }}>
                {t('areaContext.aiHint', 'The AI uses this to put tasks in the right area.')}
            </Text>

            <Text style={labelStyle}>{t('areaContext.description', 'Description')}</Text>
            <TextInput
                testID="area-context-description"
                accessibilityLabel={t('areaContext.description', 'Description')}
                value={description}
                onChangeText={setDescription}
                onBlur={commitDescription}
                multiline
                maxLength={AREA_DESCRIPTION_MAX_CHARS}
                placeholder={t('areaContext.descriptionPlaceholder', 'What belongs here: clients, people, products, keywords')}
                placeholderTextColor={tc.secondaryText}
                style={[inputStyle, { minHeight: 72, textAlignVertical: 'top' }]}
            />

            <Text style={labelStyle}>{t('areaContext.keywords', 'Keywords')}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                {(area.keywords ?? []).map((keyword) => (
                    <View key={keyword} style={chipStyle}>
                        <Text style={{ color: tc.text, fontSize: 13 }}>{keyword}</Text>
                        <TouchableOpacity
                            accessibilityRole="button"
                            accessibilityLabel={fill(t('areaContext.removeKeyword', 'Remove keyword {{name}}'), { name: keyword })}
                            hitSlop={8}
                            onPress={() => setKeywords((area.keywords ?? []).filter((entry) => entry !== keyword))}
                            style={{ paddingHorizontal: 6 }}
                        >
                            <Text style={{ color: tc.secondaryText, fontSize: 14 }}>x</Text>
                        </TouchableOpacity>
                    </View>
                ))}
            </View>
            <TextInput
                testID="area-context-keyword-input"
                accessibilityLabel={t('areaContext.keywords', 'Keywords')}
                value={keywordDraft}
                onChangeText={(value) => {
                    if (value.includes(',')) {
                        const parts = value.split(',');
                        const rest = parts.pop() ?? '';
                        const done = parts.map((keyword) => keyword.trim()).filter(Boolean);
                        if (done.length) setKeywords([...(area.keywords ?? []), ...done]);
                        setKeywordDraft(rest);
                        return;
                    }
                    setKeywordDraft(value);
                }}
                onSubmitEditing={addKeyword}
                onBlur={addKeyword}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="done"
                placeholder={t('areaContext.keywordsPlaceholder', 'Add a keyword and press Enter')}
                placeholderTextColor={tc.secondaryText}
                style={inputStyle}
            />

            <Text style={labelStyle}>{t('areaContext.people', 'People')}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                {linked.map((person) => (
                    <View key={person.id} style={chipStyle}>
                        <Text style={{ color: tc.text, fontSize: 13 }}>{person.name}</Text>
                        <TouchableOpacity
                            accessibilityRole="button"
                            accessibilityLabel={fill(t('areaContext.removePerson', 'Remove {{name}}'), { name: person.name })}
                            hitSlop={8}
                            onPress={() => setPeople((area.peopleIds ?? []).filter((id) => id !== person.id))}
                            style={{ paddingHorizontal: 6 }}
                        >
                            <Text style={{ color: tc.secondaryText, fontSize: 14 }}>x</Text>
                        </TouchableOpacity>
                    </View>
                ))}
            </View>
            <TextInput
                testID="area-context-person-input"
                accessibilityLabel={t('areaContext.people', 'People')}
                value={personDraft}
                onChangeText={setPersonDraft}
                onSubmitEditing={() => void linkPerson(personDraft)}
                autoCorrect={false}
                returnKeyType="done"
                placeholder={t('areaContext.peoplePlaceholder', 'Add a person')}
                placeholderTextColor={tc.secondaryText}
                style={inputStyle}
            />
            {suggestions.map((person) => (
                <TouchableOpacity
                    key={person.id}
                    accessibilityRole="button"
                    accessibilityLabel={person.name}
                    onPress={() => void linkPerson(person.name)}
                    style={{ paddingVertical: 8 }}
                >
                    <Text style={{ color: tc.tint, fontSize: 14 }}>{person.name}</Text>
                </TouchableOpacity>
            ))}
            {draftIsNew ? (
                <Text style={{ fontSize: 12, color: tc.secondaryText, marginTop: 4 }}>
                    {fill(t('areaContext.newPerson', 'New person: {{name}}'), { name: personDraft.trim() })}
                </Text>
            ) : null}
        </View>
    );
}
