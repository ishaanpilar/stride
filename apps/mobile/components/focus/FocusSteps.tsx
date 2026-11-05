import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Check, Plus, X } from 'lucide-react-native';
import type { ChecklistItem } from '@stride/core';
import { useThemeTokens } from '../../hooks/use-theme-tokens';
import type { FocusText } from './useFocusText';

export interface FocusStepsProps {
  steps: ChecklistItem[];
  tr: FocusText;
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
  onAdd: (title: string) => void;
}

export function FocusSteps({ steps, tr, onToggle, onRemove, onAdd }: FocusStepsProps) {
  const { soft } = useThemeTokens();
  const [draft, setDraft] = useState('');
  const addLabel = tr('focus.steps.add', 'Add a step');
  const submit = () => {
    if (!draft.trim()) return;
    onAdd(draft);
    setDraft('');
  };
  return (
    <View style={styles.root} testID="focus-steps">
      {steps.map((step) => (
        <View key={step.id} style={styles.row}>
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: step.isCompleted }}
            accessibilityLabel={step.title}
            hitSlop={8}
            onPress={() => onToggle(step.id)}
            style={[styles.box, { borderColor: step.isCompleted ? soft.accent : soft.tertiary, backgroundColor: step.isCompleted ? soft.accent : 'transparent' }]}
          >
            {step.isCompleted ? <Check size={14} color={soft.accentForeground} strokeWidth={3} /> : null}
          </Pressable>
          <Text style={[styles.title, { color: step.isCompleted ? soft.tertiary : soft.foreground }, step.isCompleted && styles.done]}>
            {step.title}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={tr('focus.steps.remove', 'Remove step')}
            hitSlop={10}
            onPress={() => onRemove(step.id)}
          >
            <X size={16} color={soft.tertiary} />
          </Pressable>
        </View>
      ))}
      <View style={[styles.addRow, { borderColor: soft.border }]}>
        <Plus size={16} color={soft.tertiary} />
        <TextInput
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={submit}
          returnKeyType="done"
          maxLength={200}
          placeholder={addLabel}
          placeholderTextColor={soft.tertiary}
          accessibilityLabel={addLabel}
          style={[styles.input, { color: soft.foreground }]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  box: { width: 22, height: 22, borderRadius: 7, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, fontSize: 16, lineHeight: 22 },
  done: { textDecorationLine: 'line-through' },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: 12, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 8 },
  input: { flex: 1, fontSize: 16, minHeight: 36 },
});
