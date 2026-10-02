import { useMemo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { colors, useThemeMode } from '../theme/colors';

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
    <View>
      <ConsentRow
        checked={acceptPrivacyNotice}
        onToggle={onTogglePrivacyNotice}
        onOpenLink={onOpenPrivacyNotice}
        linkLabel={t('signUp.privacyNoticeLink')}
        afterLabel={t('signUp.acceptPrivacyAfter')}
        disabled={disabled}
      />
      <View style={[stylesDivider.line, { backgroundColor: colors.border }]} />
      <ConsentRow
        checked={acceptTermsDisclaimer}
        onToggle={onToggleTermsDisclaimer}
        onOpenLink={onOpenTermsDisclaimer}
        linkLabel={t('signUp.termsDisclaimerLink')}
        afterLabel={t('signUp.acceptTermsAfter')}
        disabled={disabled}
      />
    </View>
  );
}

/** Link text must not sit inside a Touchable: nested press responders trigger RN synthetic-event warnings. */
function ConsentRow({
  checked,
  onToggle,
  onOpenLink,
  linkLabel,
  afterLabel,
  disabled,
}: {
  checked: boolean;
  onToggle: () => void;
  onOpenLink: () => void;
  linkLabel: string;
  afterLabel: string;
  disabled: boolean;
}) {
  const themeMode = useThemeMode();
  const styles = useMemo(() => createStyles(), [themeMode]);

  return (
    <View style={styles.row}>
      <Pressable
        onPress={() => onToggle()}
        disabled={disabled}
        hitSlop={10}
        accessibilityRole="checkbox"
        accessibilityState={{ checked, disabled }}
        style={[styles.box, checked && styles.boxChecked]}
      >
        {checked ? <Ionicons name="checkmark" size={16} color={colors.primary} /> : null}
      </Pressable>
      <Text style={styles.text} onPress={disabled ? undefined : () => onToggle()}>
        <Text onPress={() => onOpenLink()} style={styles.link} accessibilityRole="link">
          {linkLabel}
        </Text>
        {afterLabel}
      </Text>
    </View>
  );
}

const stylesDivider = StyleSheet.create({
  line: { height: StyleSheet.hairlineWidth, marginLeft: 36 },
});

function createStyles() {
  return StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 14 },
    box: {
      width: 24,
      height: 24,
      borderRadius: 7,
      borderWidth: 1.5,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 1,
    },
    boxChecked: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
    text: { flex: 1, fontSize: 15, lineHeight: 21, fontWeight: '500', color: colors.text },
    link: { fontWeight: '700', color: colors.primary, textDecorationLine: 'underline' },
  });
}
