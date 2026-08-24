import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { privacyNoticeText, termsDisclaimerText } from '../lib/legalTexts';
import { colors } from '../theme/colors';

export type LegalDocumentKind = 'privacy' | 'terms';

type Props = {
  kind: LegalDocumentKind;
  /** When false, rely on navigation header for the title (App.tsx stack). */
  showTitle?: boolean;
};

export function LegalDocumentView({ kind, showTitle = true }: Props) {
  const { i18n, t } = useTranslation();
  const body =
    kind === 'privacy' ? privacyNoticeText(i18n.language ?? 'en') : termsDisclaimerText(i18n.language ?? 'en');
  const title = kind === 'privacy' ? t('legal.privacyTitle') : t('legal.termsTitle');

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        {showTitle ? <Text style={[styles.title, { color: colors.text }]}>{title}</Text> : null}
        <Text style={[styles.body, { color: colors.textSecondary }]}>{body}</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { flex: 1 },
  content: { padding: 20, paddingBottom: 32 },
  title: { fontSize: 22, fontWeight: '700', marginBottom: 12 },
  body: { fontSize: 14, lineHeight: 22 },
});
