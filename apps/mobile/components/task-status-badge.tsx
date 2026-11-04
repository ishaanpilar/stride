import React, { useContext, useState } from 'react';
import {
    TouchableOpacity,
    Text,
    StyleSheet,
    ActionSheetIOS,
    Platform,
    ScrollView,
    Modal,
    Pressable
} from 'react-native';
import { tFallback, type TaskStatus } from '@stride/core';
import { useLanguage } from '../contexts/language-context';
import { useStatusColors } from '../hooks/use-status-colors';
import { resolveThemeColors } from '../hooks/use-theme-colors';
import { ThemeContext } from '../contexts/theme-context';

interface TaskStatusBadgeProps {
    status: TaskStatus;
    onUpdate: (status: TaskStatus) => void;
    onBackdatedComplete?: () => void;
}

const QUICK_STATUS_OPTIONS: TaskStatus[] = ['inbox', 'next', 'waiting', 'someday', 'done', 'reference'];

export function TaskStatusBadge({ status, onUpdate, onBackdatedComplete }: TaskStatusBadgeProps) {
    const [modalVisible, setModalVisible] = useState(false);
    const statusColors = useStatusColors();
    const tc = resolveThemeColors(useContext(ThemeContext));
    const colors = statusColors[status];
    const { t } = useLanguage();

    const getStatusLabel = (s: TaskStatus) => t(`status.${s}`);

    const handlePress = () => {
        if (Platform.OS === 'ios') {
            const labels = QUICK_STATUS_OPTIONS.map(s => getStatusLabel(s));
            const cancelIndex = labels.length;
            ActionSheetIOS.showActionSheetWithOptions(
                {
                    options: [...labels, t('common.cancel')],
                    cancelButtonIndex: cancelIndex,
                },
                (buttonIndex) => {
                    if (buttonIndex < QUICK_STATUS_OPTIONS.length) {
                        onUpdate(QUICK_STATUS_OPTIONS[buttonIndex]);
                    }
                }
            );
        } else {
            setModalVisible(true);
        }
    };

    const handleOptionSelect = (selectedStatus: TaskStatus) => {
        onUpdate(selectedStatus);
        setModalVisible(false);
    };

    return (
        <>
            <TouchableOpacity
                onPress={handlePress}
                onLongPress={status === 'done' ? onBackdatedComplete : undefined}
                style={[
                    styles.badge,
                    { backgroundColor: colors.bg, borderColor: colors.border, borderWidth: 1 }
                ]}
                accessibilityRole="button"
                accessibilityLabel={`${tFallback(t, 'taskEdit.statusLabel', 'Status')}: ${getStatusLabel(status)}`}
                accessibilityHint={status === 'done' && onBackdatedComplete
                    ? tFallback(t, 'task.completeBackdateHintMobile', 'Long-press to complete with a different time')
                    : undefined}
            >
                <Text style={[
                    styles.text,
                    { color: colors.text }
                ]}>
                    {getStatusLabel(status)}
                </Text>
            </TouchableOpacity>

            <Modal
                animationType="fade"
                transparent={true}
                visible={modalVisible}
                onRequestClose={() => setModalVisible(false)}
            >
                <Pressable
                    style={styles.modalOverlay}
                    onPress={() => setModalVisible(false)}
                >
                    <Pressable
                        style={[styles.modalContent, { backgroundColor: tc.cardBg }]}
                        onPress={(e) => e.stopPropagation()}
                    >
                        <Text style={[styles.modalTitle, { color: tc.text }]}>{t('taskStatus.changeStatus')}</Text>
                        <ScrollView contentContainerStyle={styles.optionsList}>
                            {QUICK_STATUS_OPTIONS.map((opt) => {
                                const optColors = statusColors[opt];
                                return (
                                    <Pressable
                                        key={opt}
                                        style={[
                                            styles.optionButton,
                                            { backgroundColor: tc.cardBg, borderBottomColor: tc.border },
                                            opt === status && { backgroundColor: tc.filterBg },
                                            { borderLeftColor: optColors.text }
                                        ]}
                                        onPress={() => handleOptionSelect(opt)}
                                    >
                                        <Text style={[
                                            styles.optionText,
                                            { color: tc.secondaryText },
                                            opt === status && [styles.optionTextActive, { color: tc.text }]
                                        ]}>
                                            {getStatusLabel(opt)}
                                        </Text>
                                    </Pressable>
                                );
                            })}
                        </ScrollView>
                        <Pressable
                            style={[styles.cancelButton, { backgroundColor: tc.filterBg }]}
                            onPress={() => setModalVisible(false)}
                        >
                            <Text style={[styles.cancelButtonText, { color: tc.secondaryText }]}>{t('common.cancel')}</Text>
                        </Pressable>
                    </Pressable>
                </Pressable>
            </Modal>
        </>
    );
}

const styles = StyleSheet.create({
    badge: {
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 6,
        alignSelf: 'flex-start',
    },
    text: {
        fontSize: 10,
        fontWeight: '600',
    },
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 20,
    },
    modalContent: {
        borderRadius: 12,
        width: '100%',
        maxWidth: 320,
        maxHeight: '80%',
        padding: 16,
        elevation: 5,
    },
    modalTitle: {
        fontSize: 18,
        fontWeight: '600',
        marginBottom: 16,
        textAlign: 'center',
    },
    optionsList: {
        paddingBottom: 8,
    },
    optionButton: {
        paddingVertical: 12,
        paddingHorizontal: 16,
        borderBottomWidth: 1,
        borderLeftWidth: 4,
        borderLeftColor: 'transparent',
        marginBottom: 4,
        borderRadius: 4,
    },
    optionText: {
        fontSize: 16,
    },
    optionTextActive: {
        fontWeight: '600',
    },
    cancelButton: {
        marginTop: 8,
        paddingVertical: 12,
        alignItems: 'center',
        borderRadius: 8,
    },
    cancelButtonText: {
        fontSize: 16,
        fontWeight: '600',
    },
});
