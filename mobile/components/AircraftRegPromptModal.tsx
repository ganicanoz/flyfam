import { useEffect, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  StyleSheet,
  Pressable,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { colors } from '../theme/colors';
import { radius, spacing } from '../theme/tokens';
import { normalizeAircraftRegistrationInput } from '../lib/aircraftRegOverride';

type Props = {
  visible: boolean;
  flightLabel?: string | null;
  onCancel: () => void;
  onSubmit: (registration: string) => void;
};

/** One-shot aircraft registration entry for “Where is my plane”. */
export function AircraftRegPromptModal({ visible, flightLabel, onCancel, onSubmit }: Props) {
  const { t } = useTranslation();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setValue('');
      setError(null);
    }
  }, [visible]);

  const submit = () => {
    const reg = normalizeAircraftRegistrationInput(value);
    if (!reg) {
      setError(t('roster.whereIsMyPlaneRegInvalid'));
      return;
    }
    onSubmit(reg);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable style={styles.backdropTap} onPress={onCancel} />
        <View style={[styles.sheet, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.title, { color: colors.text }]}>{t('roster.whereIsMyPlaneRegTitle')}</Text>
          {flightLabel ? (
            <Text style={[styles.sub, { color: colors.textMuted }]}>{flightLabel}</Text>
          ) : null}
          <Text style={[styles.hint, { color: colors.textSecondary }]}>
            {t('roster.whereIsMyPlaneRegHint')}
          </Text>
          <TextInput
            value={value}
            onChangeText={(text) => {
              setValue(text.toUpperCase());
              setError(null);
            }}
            autoCapitalize="characters"
            autoCorrect={false}
            autoFocus
            placeholder={t('roster.whereIsMyPlaneRegPlaceholder')}
            placeholderTextColor={colors.textMuted}
            style={[
              styles.input,
              {
                color: colors.text,
                backgroundColor: colors.inputFill,
                borderColor: error ? colors.error : colors.border,
              },
            ]}
            returnKeyType="done"
            onSubmitEditing={submit}
          />
          {error ? <Text style={[styles.error, { color: colors.error }]}>{error}</Text> : null}
          <View style={styles.row}>
            <Pressable onPress={onCancel} style={styles.btnGhost} accessibilityRole="button">
              <Text style={[styles.btnGhostText, { color: colors.textSecondary }]}>
                {t('common.cancel')}
              </Text>
            </Pressable>
            <Pressable
              onPress={submit}
              style={[styles.btnPrimary, { backgroundColor: colors.primary }]}
              accessibilityRole="button"
            >
              <Text style={[styles.btnPrimaryText, { color: colors.onPrimary }]}>
                {t('roster.whereIsMyPlaneRegSave')}
              </Text>
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
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  backdropTap: { ...StyleSheet.absoluteFillObject },
  sheet: {
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth * 2,
    padding: 18,
    gap: 8,
    zIndex: 1,
  },
  title: { fontSize: 17, fontWeight: '800' },
  sub: { fontSize: 14, fontWeight: '600' },
  hint: { fontSize: 13, lineHeight: 18, marginBottom: 4 },
  input: {
    borderWidth: 1.5,
    borderRadius: radius.button,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: 1,
  },
  error: { fontSize: 12, fontWeight: '600' },
  row: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12, marginTop: 8 },
  btnGhost: { paddingVertical: 10, paddingHorizontal: 12 },
  btnGhostText: { fontSize: 15, fontWeight: '600' },
  btnPrimary: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: radius.button },
  btnPrimaryText: { fontSize: 15, fontWeight: '800' },
});
