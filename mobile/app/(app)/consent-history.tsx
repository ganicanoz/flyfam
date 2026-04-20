import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList } from 'react-native';
import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSession } from '@/contexts/SessionContext';
import { supabase } from '@/lib/supabase';
import type { UserConsentRow } from '@/lib/consents';

const LABELS: Record<string, string> = {
  privacy_notice: 'KVKK / Privacy Notice',
  terms_disclaimer: 'Terms / Disclaimer',
  marketing_optional: 'Marketing (optional)',
};

export default function ConsentHistoryScreen() {
  const { t } = useTranslation();
  const { profile } = useSession();
  const [rows, setRows] = useState<UserConsentRow[]>([]);
  const [loading, setLoading] = useState(true);

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
    run();
  }, [profile?.id]);

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: t('consent.historyTitle') }} />
      {loading ? (
        <Text style={styles.empty}>{t('common.loading')}</Text>
      ) : rows.length === 0 ? (
        <Text style={styles.empty}>{t('consent.historyEmpty')}</Text>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <Text style={styles.title}>{LABELS[item.consent_type] ?? item.consent_type}</Text>
              <Text style={styles.meta}>
                {item.accepted ? 'Accepted' : 'Rejected'} · v{item.policy_version} · {item.locale ?? '—'}
              </Text>
              <Text style={styles.meta}>
                {new Date(item.accepted_at).toLocaleString()} · {item.source}
              </Text>
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a', padding: 16 },
  list: { paddingBottom: 20 },
  card: {
    backgroundColor: '#18181b',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#27272a',
    padding: 12,
    marginBottom: 10,
  },
  title: { color: '#fff', fontSize: 15, fontWeight: '700', marginBottom: 6 },
  meta: { color: '#a1a1aa', fontSize: 12, lineHeight: 18 },
  empty: { color: '#a1a1aa', textAlign: 'center', marginTop: 32 },
});

