import {
    applyMarkdownPairInsertion,
    applyMarkdownUrlPaste,
    type MarkdownAssistOptions,
    type MarkdownSelection,
    type MarkdownToolbarResult,
} from '@stride/core';

type MarkdownSelectionReplacement = {
    result: MarkdownToolbarResult;
    baseSelection: MarkdownSelection;
};

export type IgnoredNativePairChange = {
    nativeValue: string;
    duplicateNativeValues: string[];
    appliedValue: string;
    selection: MarkdownSelection;
};

export const isRangeSelection = (selection: MarkdownSelection | null | undefined): selection is MarkdownSelection => (
    selection != null && selection.start !== selection.end
);

const replaceSelectionWithText = (value: string, selection: MarkdownSelection, text: string): string => (
    `${value.slice(0, selection.start)}${text}${value.slice(selection.end)}`
);

const createIgnoredNativePairChange = (
    previousValue: string,
    key: string,
    baseSelection: MarkdownSelection,
    result: MarkdownToolbarResult,
): IgnoredNativePairChange => {
    const duplicateNativeValue = replaceSelectionWithText(result.value, result.selection, key);
    const duplicatePairedValue = applyMarkdownPairInsertion(
        result.value,
        duplicateNativeValue,
        result.selection,
    )?.value;
    const duplicateNativeValues = duplicatePairedValue && duplicatePairedValue !== duplicateNativeValue
        ? [duplicateNativeValue, duplicatePairedValue]
        : [duplicateNativeValue];

    return {
        nativeValue: replaceSelectionWithText(previousValue, baseSelection, key),
        duplicateNativeValues,
        appliedValue: result.value,
        selection: result.selection,
    };
};

const getInsertedTextFromChange = (previousValue: string, nextValue: string): string | null => {
    let start = 0;
    while (
        start < previousValue.length
        && start < nextValue.length
        && previousValue[start] === nextValue[start]
    ) {
        start += 1;
    }

    let previousEnd = previousValue.length;
    let nextEnd = nextValue.length;
    while (
        previousEnd > start
        && nextEnd > start
        && previousValue[previousEnd - 1] === nextValue[nextEnd - 1]
    ) {
        previousEnd -= 1;
        nextEnd -= 1;
    }

    const insertedText = nextValue.slice(start, nextEnd);
    return insertedText.length > 0 ? insertedText : null;
};

export const createIgnoredNativePairChangeFromTextChange = (
    previousValue: string,
    nextValue: string,
    baseSelection: MarkdownSelection,
    result: MarkdownToolbarResult,
): IgnoredNativePairChange | null => {
    const insertedText = getInsertedTextFromChange(previousValue, nextValue);
    if (!insertedText) return null;
    return createIgnoredNativePairChange(previousValue, insertedText, baseSelection, result);
};

export const shouldIgnoreNativePairChange = (
    nextValue: string,
    currentValue: string,
    ignoredChange: IgnoredNativePairChange,
): boolean => (
    currentValue === ignoredChange.appliedValue
    && (
        nextValue === ignoredChange.nativeValue
        || ignoredChange.duplicateNativeValues.includes(nextValue)
    )
);

const getSelectionCandidates = (
    primarySelection: MarkdownSelection,
    fallbackSelection?: MarkdownSelection | null,
): MarkdownSelection[] => {
    if (
        !fallbackSelection
        || (
            fallbackSelection.start === primarySelection.start
            && fallbackSelection.end === primarySelection.end
        )
    ) {
        return [primarySelection];
    }
    return [primarySelection, fallbackSelection];
};

const applyWithSelectionCandidates = (
    previousValue: string,
    nextValue: string,
    primarySelection: MarkdownSelection,
    fallbackSelection: MarkdownSelection | null | undefined,
    apply: (
        previousValue: string,
        nextValue: string,
        selection: MarkdownSelection,
    ) => MarkdownToolbarResult | null,
): MarkdownSelectionReplacement | null => {
    for (const selection of getSelectionCandidates(primarySelection, fallbackSelection)) {
        const result = apply(previousValue, nextValue, selection);
        if (result) {
            return {
                result,
                baseSelection: selection,
            };
        }
    }
    return null;
};

export const applyMarkdownUrlPasteWithSelectionFallback = (
    previousValue: string,
    nextValue: string,
    primarySelection: MarkdownSelection,
    fallbackSelection?: MarkdownSelection | null,
    options?: MarkdownAssistOptions,
): MarkdownSelectionReplacement | null => (
    applyWithSelectionCandidates(
        previousValue,
        nextValue,
        primarySelection,
        fallbackSelection,
        (prev, next, selection) => applyMarkdownUrlPaste(prev, next, selection, options),
    )
);

export const applyMarkdownPairInsertionWithSelectionFallback = (
    previousValue: string,
    nextValue: string,
    primarySelection: MarkdownSelection,
    fallbackSelection?: MarkdownSelection | null,
    options?: MarkdownAssistOptions,
): MarkdownSelectionReplacement | null => (
    applyWithSelectionCandidates(
        previousValue,
        nextValue,
        primarySelection,
        fallbackSelection,
        (prev, next, selection) => applyMarkdownPairInsertion(prev, next, selection, options),
    )
);
