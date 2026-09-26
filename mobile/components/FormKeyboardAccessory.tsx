import { InputAccessoryView, Keyboard, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { colors } from '../theme/colors';

/** Shared nativeID for auth/form TextInputs that need an iOS toolbar. */
export const FORM_KEYBOARD_ACCESSORY_ID = 'flyfam.form.keyboardAccessory';

/**
 * iOS keyboard toolbar with a clear Done action so users can dismiss
 * and see the form again. No-op on Android (system back / outside tap).
 */
export function FormKeyboardAccessory() {
  const { t } = useTranslation();
  if (Platform.OS !== 'ios') return null;

  return (
    <InputAccessoryView nativeID={FORM_KEYBOARD_ACCESSORY_ID}>
      <View style={[styles.bar, { backgroundColor: colors.surface, borderTopColor: colors.border }]}>
        <View style={styles.spacer} />
        <TouchableOpacity
          onPress={() => Keyboard.dismiss()}
          hitSlop={{ top: 10, bottom: 10, left: 12, right: 12 }}
          accessibilityRole="button"
          accessibilityLabel={t('common.done')}
        >
          <Text style={[styles.done, { color: colors.primary }]}>{t('common.done')}</Text>
        </TouchableOpacity>
      </View>
    </InputAccessoryView>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  spacer: { flex: 1 },
  done: {
    fontSize: 16,
    fontWeight: '700',
  },
});
