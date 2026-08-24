import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import { useSession } from '../contexts/SessionContext';
import { supabase } from '../lib/supabase';
import type { UserConsentRow } from '../lib/consents';
import { LEGAL_TEXT_VERSION } from '../lib/legalTexts';
import { colors } from '../theme/colors';

type Props = {
  onOpenPrivacy?: () => void;
  onOpenTerms?: () => void;
};

function consentTypeLabel(type: string, t: (key: string) => string): string {
  if (type === 'privacy_notice') return t('legal.privacyTitle');
  if (type === 'terms_disclaimer') return t('legal.termsTitle');
  if (type === 'marketing_optional') return t('signUp.acceptMarketingOptional');
  return type;
}

function canOpenFullText(type: string): boolean {
  return type === 'privacy_notice' || type === 'terms_disclaimer';
}

export function ConsentHistoryList({ onOpenPrivacy, onOpenTerms }: Props) {
  const { t, i18n } = useTranslation();
  const navigation = useNavigation<any>();
  const { profile } = useSession();
  const [rows, setRows] = useState<UserConsentRow[]>([]);
  const [loading, setLoading] = useState(true);

  const openPrivacy = onOpenPrivacy ?? (() => navigation.navigate('PrivacyNotice'));
  const openTerms = onOpenTerms ?? (() => navigation.navigate('TermsDisclaimer'));

  const openForType = (type: string) => {
    if (type === 'privacy_notice') openPrivacy();
    else if (type === 'terms_disclaimer') openTerms();
  };

  useEffect(() => {
    const run = async () => {
      if (!profile?.id) {
        setLoading(false);
        return;
      }
      const { data } = await supabase
        .from('user_consents')
        .select('id, consent_type, accepted, policy_version, locale, source, accepted_at, created_at')
        .eq('user_id', profile.id)
        .order('accepted_at', { ascending: false })
        .limit(100);
      setRows((data ?? []) as UserConsentRow[]);
      setLoading(false);
    };
    void run();
  }, [profile?.id]);

  const localeTag = i18n.language?.toLowerCase().startsWith('tr') ? 'tr' : 'en';

  return (
    <View style={styles.container}>
      <View style={[styles.documentsBox, { borderColor: colors.border, backgroundColor: colors.surface }]}>
        <Text style={[styles.documentsTitle, { color: colors.text }]}>{t('consent.historyDocuments')}</Text>
        <Text style={[styles.documentsHint, { color: colors.textSecondary }]}>{t('consent.historyDocumentsHint')}</Text>
        <TouchableOpacity onPress={openPrivacy} style={styles.documentLink}>
          <Text style={[styles.documentLinkText, { color: colors.primary }]}>{t('consent.historyOpenPrivacy')}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={openTerms} style={styles.documentLink}>
          <Text style={[styles.documentLinkText, { color: colors.primary }]}>{t('consent.historyOpenTerms')}</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <Text style={[styles.empty, { color: colors.textSecondary }]}>{t('common.loading')}</Text>
      ) : rows.length === 0 ? (
        <Text style={[styles.empty, { color: colors.textSecondary }]}>{t('consent.historyEmpty')}</Text>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
              <Text style={[styles.title, { color: colors.text }]}>{consentTypeLabel(item.consent_type, t)}</Text>
              <Text style={[styles.meta, { color: colors.textSecondary }]}>
                {item.accepted ? t('consent.historyAccepted') : t('consent.historyRejected')} · v{item.policy_version} ·{' '}
                {item.locale ?? localeTag}
              </Text>
              <Text style={[styles.meta, { color: colors.textSecondary }]}>
                {new Date(item.accepted_at).toLocaleString()} · {item.source}
              </Text>
              {item.policy_version !== LEGAL_TEXT_VERSION ? (
                <Text style={[styles.versionNote, { color: colors.textMuted }]}>
                  {t('consent.historyVersionNote', { accepted: item.policy_version, current: LEGAL_TEXT_VERSION })}
                </Text>
              ) : null}
              {canOpenFullText(item.consent_type) ? (
                <TouchableOpacity onPress={() => openForType(item.consent_type)} style={styles.rowLink}>
                  <Text style={[styles.rowLinkText, { color: colors.primary }]}>{t('consent.historyViewFull')}</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  documentsBox: {
    marginBottom: 16,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  documentsTitle: { fontSize: 16, fontWeight: '700', marginBottom: 4 },
  documentsHint: { fontSize: 12, lineHeight: 18, marginBottom: 10 },
  documentLink: { paddingVertical: 6 },
  documentLinkText: { fontSize: 14, fontWeight: '600', textDecorationLine: 'underline' },
  list: { paddingBottom: 20 },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    marginBottom: 10,
  },
  title: { fontSize: 15, fontWeight: '700', marginBottom: 6 },
  meta: { fontSize: 12, lineHeight: 18 },
  versionNote: { fontSize: 11, lineHeight: 16, marginTop: 4, fontStyle: 'italic' },
  rowLink: { marginTop: 10 },
  rowLinkText: { fontSize: 13, fontWeight: '600', textDecorationLine: 'underline' },
  empty: { textAlign: 'center', marginTop: 32 },
});
