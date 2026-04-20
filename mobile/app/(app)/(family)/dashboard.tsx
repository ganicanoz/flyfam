import { useState, useEffect, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, Alert, RefreshControl } from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { useSession } from '@/contexts/SessionContext';
import { supabase } from '@/lib/supabase';
import { formatFlightDateTr, getLocalDateString } from '@/lib/dateUtils';
import { formatFamilyFlightTimeRange } from '@/lib/flightDisplayTime';
import { colors, useThemeMode } from '@/theme/colors';
import { fetchMySubscriptionAccess, type SubscriptionAccess } from '@/lib/subscriptionAccess';

type FlightWithCrew = {
  id: string;
  flight_number: string;
  origin_airport: string | null;
  destination_airport: string | null;
  flight_date: string;
  scheduled_departure: string | null;
  scheduled_arrival: string | null;
  actual_departure?: string | null;
  actual_arrival?: string | null;
  updated_at?: string | null;
  crew_profiles: { company_name: string | null } | null;
};

export default function FamilyDashboard() {
  const { t } = useTranslation();
  const { profile, signOut } = useSession();
  const themeMode = useThemeMode();
  void themeMode;
  const [flights, setFlights] = useState<FlightWithCrew[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [access, setAccess] = useState<SubscriptionAccess | null>(null);
  const router = useRouter();

  const fetchFlights = useCallback(async (silent = false) => {
    const userId = profile?.id;
    if (!userId) {
      setLoading(false);
      setRefreshing(false);
      return;
    }
    if (!silent) setLoading(true);
    const [connsRes, accessRes] = await Promise.all([
      supabase
        .from('family_connections')
        .select('crew_id')
        .eq('family_id', userId)
        .eq('status', 'approved'),
      fetchMySubscriptionAccess().catch(() => null),
    ]);
    setAccess(accessRes);

    const crewIds = (connsRes.data ?? []).map((c) => c.crew_id);
    if (crewIds.length === 0) {
      setFlights([]);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    const { data, error } = await supabase
      .from('flights')
      .select(
        'id, flight_number, origin_airport, destination_airport, flight_date, scheduled_departure, scheduled_arrival, actual_departure, actual_arrival, updated_at, crew_profiles(company_name)'
      )
      .in('crew_id', crewIds)
      .gte('flight_date', getLocalDateString())
      .limit(50);

    if (error) {
      console.error(error);
      setFlights([]);
    } else {
      const list = data ?? [];
      const depMs = (f: FlightWithCrew) => {
        const iso = f.actual_departure ?? f.scheduled_departure;
        return iso ? new Date(iso).getTime() : 0;
      };
      list.sort((a, b) => {
        const aMs = depMs(a);
        const bMs = depMs(b);
        if (aMs && bMs) return aMs - bMs;
        if (aMs) return -1;
        if (bMs) return 1;
        return (a.flight_date || '').localeCompare(b.flight_date || '') || a.flight_number.localeCompare(b.flight_number);
      });
      setFlights(list);
    }
    setLoading(false);
    setRefreshing(false);
  }, [profile?.id]);

  useEffect(() => {
    fetchFlights();
  }, [fetchFlights]);

  // Ekran açık ve odaklıyken listeyi belirli aralıklarla otomatik yenile.
  useFocusEffect(
    useCallback(() => {
      if (!profile?.id) return;
      // İlk girişte sessiz bir fetch
      fetchFlights(true);
      const intervalId = setInterval(() => {
        fetchFlights(true);
      }, 60_000); // 60 saniyede bir
      return () => {
        clearInterval(intervalId);
      };
    }, [profile?.id, fetchFlights])
  );

  const formatDate = formatFlightDateTr;

  const crewLabel = (f: FlightWithCrew) =>
    f.crew_profiles?.company_name ?? 'Crew';

  const handleSignOut = () => {
    Alert.alert(t('profile.signOutConfirmTitle'), t('profile.signOutConfirmMessage'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('profile.signOut'),
        style: 'destructive',
        onPress: async () => {
          await signOut();
          router.replace('/(auth)/welcome');
        },
      },
    ]);
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Text style={[styles.title, { color: colors.text }]}>{t('nav.roster')}</Text>
      <Text style={[styles.subtitle, { color: colors.textSecondary }]}>{t('family.dashboardSubtitle')}</Text>

      <TouchableOpacity
        style={[styles.connectButton, { backgroundColor: colors.primary }]}
        onPress={() => router.push('/(app)/(family)/connect')}
      >
        <Text style={styles.connectButtonText}>{t('family.connectToCrew')}</Text>
      </TouchableOpacity>

      {access && !access.has_access ? (
        <View style={[styles.accessBox, { borderColor: colors.border, backgroundColor: colors.surface }]}>
          <Text style={[styles.accessTitle, { color: colors.text }]}>Plan gerekli</Text>
          <Text style={[styles.accessText, { color: colors.textSecondary }]}>
            Davetiniz onayli olsa bile, bagli oldugunuz crew paket secmeden kullanim acilmaz.
          </Text>
        </View>
      ) : null}

      {loading ? (
        <Text style={[styles.empty, { color: colors.textSecondary }]}>{t('common.loading')}</Text>
      ) : flights.length === 0 ? (
        <Text style={[styles.empty, { color: colors.textSecondary }]}>{t('roster.noFlightsFamily')}</Text>
      ) : (
        <FlatList
          data={flights}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                fetchFlights(true);
              }}
              tintColor={colors.primary}
            />
          }
          renderItem={({ item, index }) => (
            <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={styles.dateRow}>
                <View style={styles.dateRowNumber}>
                  <Text style={styles.dateRowNumberText}>{index + 1}</Text>
                </View>
                <Text style={[styles.date, { color: colors.textSecondary }]}>{formatDate(item.flight_date)}</Text>
              </View>
              <Text style={[styles.crew, { color: colors.primary }]}>{crewLabel(item)}</Text>
              <Text style={[styles.route, { color: colors.text }]}>
                {item.flight_number} · {item.origin_airport || '—'} → {item.destination_airport || '—'}
              </Text>
              <Text style={[styles.times, { color: colors.textMuted }]}>
                {formatFamilyFlightTimeRange(
                  item.scheduled_departure,
                  item.scheduled_arrival,
                  profile?.timezone_iana ?? null,
                )}
              </Text>
              {item.updated_at && (
                <Text style={[styles.updatedAt, { color: colors.textMuted }]}>
                  Son güncelleme:{' '}
                  {new Date(item.updated_at).toLocaleString(undefined, {
                    day: '2-digit',
                    month: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </Text>
              )}
            </View>
          )}
        />
      )}

      <TouchableOpacity style={styles.signOut} onPress={handleSignOut}>
        <Text style={[styles.signOutText, { color: colors.textMuted }]}>{t('profile.signOut')}</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.consentHistory}
        onPress={() => router.push('/(app)/consent-history')}
      >
        <Text style={[styles.signOutText, { color: colors.primary }]}>{t('profile.consentHistory')}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    padding: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    marginBottom: 24,
  },
  connectButton: {
    backgroundColor: colors.primary,
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 24,
  },
  connectButtonText: {
    color: colors.white,
    fontWeight: '600',
  },
  list: {
    paddingBottom: 24,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  dateRowNumber: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  dateRowNumberText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  date: {
    color: colors.textSecondary,
    fontSize: 12,
    marginBottom: 4,
  },
  crew: {
    color: colors.primary,
    fontSize: 12,
    marginBottom: 4,
  },
  route: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
  },
  times: {
    color: colors.textMuted,
    fontSize: 14,
    marginTop: 4,
  },
  updatedAt: {
    color: colors.textMuted,
    fontSize: 11,
    fontStyle: 'italic',
    marginTop: 2,
  },
  empty: {
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: 48,
    fontSize: 16,
  },
  signOut: {
    position: 'absolute',
    bottom: 44,
    alignSelf: 'center',
  },
  consentHistory: {
    position: 'absolute',
    bottom: 20,
    alignSelf: 'center',
  },
  signOutText: {
    color: colors.textMuted,
    fontSize: 14,
  },
  accessBox: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
  },
  accessTitle: {
    fontWeight: '700',
    marginBottom: 4,
  },
  accessText: {
    fontSize: 13,
    lineHeight: 18,
  },
});
