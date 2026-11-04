import React from 'react';
import { Text } from 'react-native';
import renderer, { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { TaskEditTokenField } from './TaskEditTokenField';

describe('TaskEditTokenField', () => {
    it('uses the theme foreground for a selected quick token', () => {
        const tc = {
            border: '#334155',
            cardBg: '#111827',
            filterBg: '#1f2937',
            inputBg: '#111827',
            onTint: '#102030',
            secondaryText: '#94a3b8',
            text: '#f8fafc',
            tint: '#60a5fa',
        };
        const styles = {
            formGroup: {},
            input: {},
            label: {},
            quickTokenChip: {},
            quickTokenText: {},
            quickTokensRow: {},
            tokenSuggestionItem: {},
            tokenSuggestionItemLast: {},
            tokenSuggestionText: {},
            tokenSuggestionsMenu: {},
        };
        let tree!: renderer.ReactTestRenderer;

        act(() => {
            tree = renderer.create(
                <TaskEditTokenField {...({
                    applyContextSuggestion: vi.fn(),
                    applyTagSuggestion: vi.fn(),
                    commitContextDraft: vi.fn(),
                    commitTagDraft: vi.fn(),
                    contextInputDraft: '',
                    contextTokenSuggestions: [],
                    fieldId: 'contexts',
                    frequentContextSuggestions: ['@home'],
                    frequentTagSuggestions: [],
                    handleInputFocus: vi.fn(),
                    selectedContextTokens: new Set(['@home']),
                    selectedTagTokens: new Set(),
                    setIsContextInputFocused: vi.fn(),
                    setIsTagInputFocused: vi.fn(),
                    styles,
                    t: (key: string) => key,
                    tagInputDraft: '',
                    tagTokenSuggestions: [],
                    tc,
                    toggleQuickContextToken: vi.fn(),
                    toggleQuickTagToken: vi.fn(),
                    updateContextInput: vi.fn(),
                    updateTagInput: vi.fn(),
                } as any)} />
            );
        });

        const selectedToken = tree.root
            .findAllByType(Text)
            .find((node) => node.props.children === '@home');

        expect(selectedToken?.props.style).toEqual(expect.arrayContaining([
            expect.objectContaining({ color: tc.onTint }),
        ]));
    });
});
