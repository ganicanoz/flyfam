import React, { useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { colors } from '../theme/colors';

const CATEGORIES = [
  'standby',
  'off',
  'leave',
  'training',
  'office',
  'meeting',
  'simulator',
  'other',
] as const;

export type SuggestOccupationPayload = {
  code: string;
  label_tr: string;
  label_en: string;
  category: string;
  note: string;
};

type Props = {
  visible: boolean;
  code: string;
  onClose: () => void;
  onSubmit: (payload: SuggestOccupationPayload) => Promise<void>;
};

export function SuggestOccupationModal({ visible, code, onClose, onSubmit }: Props) {
  const { t } = useTranslation();
  const [labelTr, setLabelTr] = useState('');
  const [labelEn, setLabelEn] = useState('');
  const [category, setCategory] = useState<string>('other');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const reset = () => {
    setLabelTr('');
    setLabelEn('');
    setCategory('other');
    setNote('');
    setError('');
    setSaving(false);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleSave = async () => {
    const tr = labelTr.trim();
    if (!tr) {
      setError(t('roster.suggestOccupationLabelRequired'));
      return;
    }
    setSaving(true);
    setError('');
    try {
      await onSubmit({
        code,
        label_tr: tr,
        label_en: labelEn.trim() || tr,
        category,
        note: note.trim(),
      });
      reset();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose}>
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.card}>
          <Text style={styles.title}>{t('roster.suggestOccupationTitle')}</Text>
          <Text style={styles.code}>{code}</Text>
          <Text style={styles.label}>{t('roster.suggestOccupationLabelTr')}</Text>
          <TextInput
            style={styles.input}
            value={labelTr}
            onChangeText={setLabelTr}
            placeholder={t('roster.suggestOccupationLabelTrPh')}
            autoCapitalize="sentences"
          />
          <Text style={styles.label}>{t('roster.suggestOccupationLabelEn')}</Text>
          <TextInput
            style={styles.input}
            value={labelEn}
            onChangeText={setLabelEn}
            placeholder={t('roster.suggestOccupationLabelEnPh')}
            autoCapitalize="sentences"
          />
          <Text style={styles.label}>{t('roster.suggestOccupationCategory')}</Text>
          <View style={styles.cats}>
            {CATEGORIES.map((c) => (
              <Pressable
                key={c}
                onPress={() => setCategory(c)}
                style={[styles.catChip, category === c && styles.catChipOn]}
              >
                <Text style={[styles.catText, category === c && styles.catTextOn]}>{c}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.label}>{t('roster.suggestOccupationNote')}</Text>
          <TextInput
            style={[styles.input, styles.note]}
            value={note}
            onChangeText={setNote}
            placeholder={t('roster.suggestOccupationNotePh')}
            multiline
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <View style={styles.actions}>
            <Pressable style={styles.btnSecondary} onPress={handleClose} disabled={saving}>
              <Text style={styles.btnSecondaryText}>{t('common.cancel')}</Text>
            </Pressable>
            <Pressable style={styles.btnPrimary} onPress={handleSave} disabled={saving}>
              {saving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.btnPrimaryText}>{t('roster.suggestOccupationSave')}</Text>
              )}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.45)',
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    gap: 8,
  },
  title: { fontSize: 17, fontWeight: '800', color: '#0f172a' },
  code: {
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: undefined }),
    fontWeight: '800',
    fontSize: 15,
    color: colors.primary,
    marginBottom: 4,
  },
  label: { fontSize: 12, fontWeight: '700', color: '#64748b', marginTop: 4 },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#cbd5e1',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: '#0f172a',
  },
  note: { minHeight: 64, textAlignVertical: 'top' },
  cats: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  catChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#f1f5f9',
  },
  catChipOn: { backgroundColor: colors.primary },
  catText: { fontSize: 12, fontWeight: '700', color: '#475569' },
  catTextOn: { color: '#fff' },
  error: { color: '#b91c1c', fontSize: 13, fontWeight: '600' },
  actions: { flexDirection: 'row', gap: 10, marginTop: 8 },
  btnSecondary: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
  },
  btnSecondaryText: { fontWeight: '700', color: '#334155' },
  btnPrimary: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: colors.primary,
    alignItems: 'center',
  },
  btnPrimaryText: { fontWeight: '800', color: '#fff' },
});
