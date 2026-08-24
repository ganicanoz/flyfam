import React, { useState, useEffect } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, Alert, ScrollView } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useSession } from '../contexts/SessionContext';
import { supabase } from '../lib/supabase';
import { formatFlightDateTr, getLocalDateString } from '../lib/dateUtils';
import { formatFamilyFlightTimeRange } from '../lib/flightDisplayTime';
import { colors, useThemeMode } from '../theme/colors';
import { resolveRosterCardVisualKind, rosterCardChrome, rosterCardInk } from '../theme/rosterCardVisual';

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
  flight_status?: string | null;
  roster_entry_kind?: string | null;
  crew_profiles: { company_name: string | null } | null;
};

export default function Dashboard() {
  const { t } = useTranslation();
  const { profile, signOut } = useSession();
  const themeMode = useThemeMode();
  const cardInk = rosterCardInk(themeMode);
  const [flights, setFlights] = useState<FlightWithCrew[]>([]);
  const [invitationCount, setInvitationCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const navigation = useNavigation<any>();

  const fetchInvitationCount = async () => {
    const { count } = await supabase
      .from('crew_invitations')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending');
    setInvitationCount(count ?? 0);
  };

  useFocusEffect(
    React.useCallback(() => {
      fetchInvitationCount();
    }, [])
  );

  useEffect(() => {
    const userId = profile?.id;
    if (!userId) {
      setLoading(false);
      return;
    }
    const fetchFlights = async () => {
      const { data: conns } = await supabase
        .from('family_connections')
        .select('crew_id')
        .eq('family_id', userId)
        .eq('status', 'approved');
      const crewIds = (conns ?? []).map((c) => c.crew_id);
      if (crewIds.length === 0) {
        setFlights([]);
        setLoading(false);
        return;
      }
      const { data, error } = await supabase
        .from('flights')
        .select('id, flight_number, origin_airport, destination_airport, flight_date, scheduled_departure, scheduled_arrival, actual_departure, actual_arrival, flight_status, roster_entry_kind, crew_profiles(company_name)')
        .in('crew_id', crewIds)
        .gte('flight_date', getLocalDateString())
        .order('flight_date', { ascending: true })
        .limit(50);
      if (error) console.error(error);
      else setFlights(data ?? []);
      setLoading(false);
    };
    fetchFlights();
  }, [profile?.id]);

  const formatDate = formatFlightDateTr;
  const crewLabel = (f: FlightWithCrew) => f.crew_profiles?.company_name ?? 'Crew';

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Text style={[styles.subtitle, { color: colors.textSecondary }]}>{t('family.dashboardSubtitle')}</Text>

      {invitationCount > 0 && (
        <TouchableOpacity
          style={[styles.invitationBanner, { backgroundColor: colors.primaryLight, borderColor: colors.primary }]}
          onPress={() => navigation.navigate('Connect')}
        >
          <Text style={[styles.invitationBannerText, { color: colors.text }]}>
            {t('family.invitationsCount', { count: invitationCount })}
          </Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity style={[styles.connectButton, { backgroundColor: colors.primary }]} onPress={() => navigation.navigate('Connect')}>
        <Text style={styles.connectButtonText}>{t('family.viewInvitations')}</Text>
      </TouchableOpacity>

      {loading ? (
        <Text style={[styles.empty, { color: colors.textSecondary }]}>{t('common.loading')}</Text>
      ) : flights.length === 0 ? (
        <Text style={[styles.empty, { color: colors.textSecondary }]}>
          {t('roster.noFlightsFamily')}
        </Text>
      ) : (
        <FlatList
          data={flights}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => {
            const code = (item.flight_number || '').trim().toUpperCase();
            const isStandby =
              code.startsWith('STB') ||
              code === 'HSBY' ||
              code === 'SBY' ||
              /^SB\d?$/.test(code) ||
              code === 'SBX';
            const chrome = rosterCardChrome(
              resolveRosterCardVisualKind({
                rosterEntryKind: item.roster_entry_kind,
                flightStatus: item.flight_status,
                isStandbyDutyCode: isStandby,
              }),
              themeMode,
            );
            return (
            <View style={[styles.card, chrome]}>
              <Text style={[styles.date, { color: cardInk.secondary }]}>{formatDate(item.flight_date)}</Text>
              <Text style={[styles.crew, { color: cardInk.onAccent }]}>{crewLabel(item)}</Text>
              <Text style={[styles.route, { color: cardInk.primary }]}>
                {item.flight_number} · {item.origin_airport || '—'} → {item.destination_airport || '—'}
              </Text>
              <Text style={[styles.times, { color: cardInk.muted }]}>
                {formatFamilyFlightTimeRange(
                  item.scheduled_departure,
                  item.scheduled_arrival,
                  profile?.timezone_iana ?? null,
                )}
              </Text>
            </View>
            );
          }}
        />
      )}

      <TouchableOpacity
        style={styles.signOut}
        onPress={() =>
          Alert.alert(t('profile.signOutConfirmTitle'), t('profile.signOutConfirmMessage'), [
            { text: t('common.cancel'), style: 'cancel' },
            { text: t('profile.signOut'), style: 'destructive', onPress: signOut },
          ])
        }
      >
        <Text style={[styles.signOutText, { color: colors.textMuted }]}>{t('profile.signOut')}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24 },
  subtitle: { fontSize: 14, marginBottom: 16 },
  invitationBanner: {
    backgroundColor: colors.primaryLight,
    padding: 14,
    borderRadius: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  invitationBannerText: { color: colors.text, fontWeight: '600', textAlign: 'center' },
  connectButton: { backgroundColor: colors.primary, padding: 16, borderRadius: 12, alignItems: 'center', marginBottom: 24 },
  connectButtonText: { color: colors.white, fontWeight: '600' },
  list: { paddingBottom: 24 },
  card: {
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  date: { fontSize: 12, marginBottom: 4 },
  crew: { fontSize: 12, marginBottom: 4 },
  route: { fontSize: 16, fontWeight: '600' },
  times: { fontSize: 14, marginTop: 4 },
  empty: { textAlign: 'center', marginTop: 48, fontSize: 16 },
  signOut: { position: 'absolute', bottom: 24, alignSelf: 'center' },
  signOutText: { fontSize: 14 },
});
