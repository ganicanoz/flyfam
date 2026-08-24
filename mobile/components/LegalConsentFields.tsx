import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { colors } from '../theme/colors';

type Props = {
  acceptPrivacyNotice: boolean;
  onTogglePrivacyNotice: () => void;
  acceptTermsDisclaimer: boolean;
  onToggleTermsDisclaimer: () => void;
  onOpenPrivacyNotice: () => void;
  onOpenTermsDisclaimer: () => void;
  disabled?: boolean;
};

export function LegalConsentFields({
  acceptPrivacyNotice,
  onTogglePrivacyNotice,
  acceptTermsDisclaimer,
  onToggleTermsDisclaimer,
  onOpenPrivacyNotice,
  onOpenTermsDisclaimer,
  disabled = false,
}: Props) {
  const { t } = useTranslation();

  return (
    <View style={styles.box}>
      <TouchableOpacity style={styles.row} onPress={onTogglePrivacyNotice} disabled={disabled}>
        <View
          style={[
            styles.checkbox,
            { borderColor: colors.border, backgroundColor: colors.surfaceAlt },
            acceptPrivacyNotice && styles.checkboxChecked,
          ]}
        >
          {acceptPrivacyNotice ? <Text style={styles.tick}>✓</Text> : null}
        </View>
        <Text style={[styles.text, { color: colors.text }]}>
          <Text onPress={onOpenPrivacyNotice} style={[styles.link, { color: colors.primary }]}>
            {t('signUp.privacyNoticeLink')}
          </Text>
          {t('signUp.acceptPrivacyAfter')}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.row} onPress={onToggleTermsDisclaimer} disabled={disabled}>
        <View
          style={[
            styles.checkbox,
            { borderColor: colors.border, backgroundColor: colors.surfaceAlt },
            acceptTermsDisclaimer && styles.checkboxChecked,
          ]}
        >
          {acceptTermsDisclaimer ? <Text style={styles.tick}>✓</Text> : null}
        </View>
        <Text style={[styles.text, { color: colors.text }]}>
          <Text onPress={onOpenTermsDisclaimer} style={[styles.link, { color: colors.primary }]}>
            {t('signUp.termsDisclaimerLink')}
          </Text>
          {t('signUp.acceptTermsAfter')}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: 14 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  checkboxChecked: { borderColor: '#22c55e', backgroundColor: '#14532d' },
  tick: { color: '#22c55e', fontSize: 14, fontWeight: '700', lineHeight: 16 },
  text: { flex: 1, fontSize: 13, lineHeight: 18 },
  link: { fontSize: 13, lineHeight: 18, fontWeight: '600', textDecorationLine: 'underline' },
});
