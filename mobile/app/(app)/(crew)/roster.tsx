import { useState, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { useSession } from '@/contexts/SessionContext';
import { supabase } from '@/lib/supabase';
import { formatFlightDateTr, getLocalDateStringPlusDays } from '@/lib/dateUtils';
import { formatCrewFlightTimeRange } from '@/lib/flightDisplayTime';
import { colors } from '@/theme/colors';

/** En eski dün: sadece flight_date >= dün gösterilir. */
const ROSTER_MIN_DAYS_AGO = 1;
/** En geç: bugünden en fazla N gün sonrası (dahil). */
const ROSTER_MAX_DAYS_AHEAD = 30;

type Flight = {
  id: string;
  flight_number: string;
  origin_airport: string | null;
  destination_airport: string | null;
  flight_date: string;
  scheduled_departure: string | null;
  scheduled_arrival: string | null;
  actual_arrival?: string | null;
  flight_status?: string | null;
  updated_at?: string | null;
};

export default function Roster() {
  const { t } = useTranslation();
  const { crewProfile, signOut } = useSession();
  const [flights, setFlights] = useState<Flight[]>([]);
  const [loading, setLoading] = useState(true);
  const [cleanupMessage, setCleanupMessage] = useState<string | null>(null);
  const router = useRouter();

  const fetchFlights = useCallback(async () => {
    if (!crewProfile?.id) return;
    setLoading(true);
    const { data: fcData } = await supabase
      .from('flight_crew')
      .select('flight_id')
      .eq('crew_id', crewProfile.id);
    const flightIds = (fcData ?? []).map((r: { flight_id: string }) => r.flight_id);
    if (flightIds.length === 0) {
      setFlights([]);
      setLoading(false);
      return;
    }
    const { data, error } = await supabase
      .from('flights')
      .select(
        'id, flight_number, origin_airport, destination_airport, flight_date, scheduled_departure, scheduled_arrival, actual_arrival, flight_status, updated_at'
      )
      .in('id', flightIds);

    if (error) {
      console.error(error);
      setFlights([]);
      setLoading(false);
      return;
    }
    const minDate = getLocalDateStringPlusDays(-ROSTER_MIN_DAYS_AGO);
    const maxDate = getLocalDateStringPlusDays(ROSTER_MAX_DAYS_AHEAD);
    let list = (data ?? []).filter((f) => {
      const d = f.flight_date || '';
      return d >= minDate && d <= maxDate;
    });
    const depMs = (f: Flight) => (f.scheduled_departure ? new Date(f.scheduled_departure).getTime() : 0);
    list.sort((a, b) => {
      const aMs = depMs(a);
      const bMs = depMs(b);
      if (aMs && bMs) return aMs - bMs;
      if (aMs) return -1;
      if (bMs) return 1;
      return (a.flight_date || '').localeCompare(b.flight_date || '') || a.flight_number.localeCompare(b.flight_number);
    });
    setFlights(list);
    setLoading(false);
  }, [crewProfile?.id]);

  useFocusEffect(
    useCallback(() => {
      fetchFlights();
      return () => {};
    }, [fetchFlights])
  );

  const formatDate = formatFlightDateTr;

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
    <>
      <Stack.Screen
        options={{
          title: t('nav.roster'),
          headerBackTitle: t('common.back'),
          headerShown: false,
        }}
      />
      <View style={styles.container}>
      <View style={styles.topSection}>
      <View style={styles.header}>
        <Text style={styles.title}>{t('nav.roster')}</Text>
        <Text style={styles.subtitle}>{crewProfile?.company_name ?? t('signUp.crew')}</Text>
        <View style={styles.headerActions}>
          <TouchableOpacity
            style={styles.addButton}
            onPress={() => router.push('/(app)/(crew)/add-flight')}
            accessibilityLabel={t('nav.addFlight')}
          >
            <Text
              style={styles.addButtonText}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.8}
            >
              {t('nav.addFlight')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.menuButton}
            onPress={() => router.push('/(app)/(crew)/family')}
          >
            <Text style={styles.menuButtonText}>{t('nav.family')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.menuButton}
            onPress={() => router.push('/(app)/(crew)/plans')}
          >
            <Text style={styles.menuButtonText}>{t('nav.plans')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.menuButton}
            onPress={() => router.push('/(app)/(crew)/profile')}
          >
            <Text style={styles.menuButtonText}>{t('nav.profile')}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {cleanupMessage ? (
        <View style={styles.cleanupBanner}>
          <Text style={styles.cleanupBannerText}>{cleanupMessage}</Text>
        </View>
      ) : null}

      {loading ? (
        <Text style={styles.empty}>{t('common.loading')}</Text>
      ) : flights.length === 0 ? (
        <Text style={styles.empty}>{t('roster.noFlightsCrew')}</Text>
      ) : (
        <FlatList
          style={styles.listFlex}
          data={flights}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          renderItem={({ item, index }) => (
            <View style={styles.card}>
              <View style={styles.dateRow}>
                <View style={styles.dateRowNumber}>
                  <Text style={styles.dateRowNumberText}>{index + 1}</Text>
                </View>
                <Text style={styles.date}>{formatDate(item.flight_date)}</Text>
              </View>
              <Text style={styles.route}>
                {item.flight_number} · {item.origin_airport || '—'} → {item.destination_airport || '—'}
              </Text>
              <Text style={styles.times}>
                {formatCrewFlightTimeRange(
                  item.scheduled_departure,
                  item.scheduled_arrival,
                  item.origin_airport,
                  item.destination_airport,
                )}
              </Text>
              {item.updated_at && (
                <Text style={styles.updatedAt}>
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
      </View>

      <TouchableOpacity style={styles.signOut} onPress={handleSignOut}>
        <Text style={styles.signOutText}>{t('profile.signOut')}</Text>
      </TouchableOpacity>
    </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 16,
  },
  topSection: {
    flex: 1,
    minHeight: 0,
  },
  header: {
    marginBottom: 24,
  },
  cleanupBanner: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: colors.primary + '20',
    borderRadius: 8,
    marginBottom: 12,
  },
  cleanupBannerText: {
    color: colors.primary,
    fontSize: 14,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.text,
  },
  subtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: 4,
  },
  headerActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 16,
  },
  listFlex: {
    flex: 1,
  },
  addButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
  },
  addButtonText: {
    color: colors.white,
    fontWeight: '700',
    fontSize: 13,
  },
  menuButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  menuButtonText: {
    color: colors.text,
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
    alignSelf: 'center',
    marginTop: 12,
    paddingVertical: 8,
  },
  signOutText: {
    color: colors.textMuted,
    fontSize: 14,
  },
});
