import { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  TextInput,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSession } from '@/contexts/SessionContext';
import { supabase } from '@/lib/supabase';
import { AIRLINES, type Airline } from '@/constants/airlines';
import { getAirportDisplay } from '@/constants/airports';

export default function CompleteProfile() {
  const [selectedAirline, setSelectedAirline] = useState<Airline | null>(null);
  const [icaoEdit, setIcaoEdit] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [homeBaseIata, setHomeBaseIata] = useState('');
  const { profile, refreshProfile } = useSession();
  const router = useRouter();

  const isCrew = profile?.role === 'crew';

  useEffect(() => {
    if (selectedAirline) {
      setIcaoEdit(selectedAirline.icao);
    }
  }, [selectedAirline]);

  const handleComplete = async () => {
    if (isCrew && !selectedAirline) {
      Alert.alert('Error', 'Please select your airline from the list');
      return;
    }

    const icao = (icaoEdit || selectedAirline?.icao || '').trim().toUpperCase().slice(0, 12);
    const homeBase = homeBaseIata.trim().toUpperCase().slice(0, 4);
    if (isCrew && !icao) {
      Alert.alert('Error', 'Airline ICAO code is required');
      return;
    }
    if (isCrew && !homeBase) {
      Alert.alert('Error', 'Home base IATA code is required (example: SAW)');
      return;
    }
    const homeBaseCity = getAirportDisplay(homeBase)?.city ?? null;

    setLoading(true);

    if (isCrew && profile?.id) {
      const { data: existing } = await supabase
        .from('crew_profiles')
        .select('id')
        .eq('user_id', profile.id)
        .maybeSingle();

      if (existing?.id) {
        const { error } = await supabase
          .from('crew_profiles')
          .update({
            company_name: selectedAirline!.name,
            airline_icao: icao,
            home_base_iata: homeBase,
            home_base_city: homeBaseCity,
            time_preference: 'local',
          })
          .eq('id', existing.id);
        if (error) {
          setLoading(false);
          Alert.alert('Error', error.message);
          return;
        }
      } else {
        const { error } = await supabase.rpc('create_crew_profile', {
          p_company_name: selectedAirline!.name,
          p_time_preference: 'local',
          p_airline_icao: icao,
          p_home_base_iata: homeBase,
          p_home_base_city: homeBaseCity,
        });
        if (error) {
          setLoading(false);
          Alert.alert('Error', error.message);
          return;
        }
      }
    }

    await refreshProfile();
    setLoading(false);

    if (isCrew) {
      router.replace('/(app)/(crew)/roster');
    } else {
      router.replace('/(app)/(family)/dashboard');
    }
  };

  if (!profile) {
    return null;
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <Text style={styles.title}>Complete setup</Text>
      <Text style={styles.subtitle}>
        {isCrew
          ? 'Select your airline. ICAO code is filled automatically; you can correct it if needed.'
          : "You're all set. Connect to a crew member to get started."}
      </Text>

      {isCrew && (
        <>
          <Text style={styles.label}>Airline</Text>
          <TouchableOpacity
            style={styles.dropdown}
            onPress={() => setDropdownOpen(true)}
            activeOpacity={0.7}
          >
            {selectedAirline ? (
              <View style={styles.dropdownSelected}>
                <Image source={{ uri: selectedAirline.logoUrl }} style={styles.logo} />
                <View style={styles.dropdownText}>
                  <Text style={styles.airlineName}>{selectedAirline.name}</Text>
                  <Text style={styles.airlineIcaoHint}>{selectedAirline.icao}</Text>
                </View>
              </View>
            ) : (
              <Text style={styles.placeholder}>Tap to choose airline…</Text>
            )}
            <Text style={styles.chevron}>▼</Text>
          </TouchableOpacity>

          <Text style={styles.label}>ICAO code (editable)</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. PGT, THY, SXS"
            placeholderTextColor="#71717a"
            value={icaoEdit}
            onChangeText={(t) => setIcaoEdit(t.toUpperCase())}
            autoCapitalize="characters"
            maxLength={12}
            editable={!loading}
          />
          <Text style={styles.label}>Home base IATA</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. SAW, IST, ADB"
            placeholderTextColor="#71717a"
            value={homeBaseIata}
            onChangeText={(t) => setHomeBaseIata(t.toUpperCase())}
            autoCapitalize="characters"
            maxLength={4}
            editable={!loading}
          />

          <Modal visible={dropdownOpen} transparent animationType="fade">
            <Pressable style={styles.modalOverlay} onPress={() => setDropdownOpen(false)}>
              <View style={styles.modalContent}>
                <Text style={styles.modalTitle}>Select airline</Text>
                <ScrollView style={styles.dropdownList} keyboardShouldPersistTaps="handled">
                  {AIRLINES.map((airline) => (
                    <TouchableOpacity
                      key={airline.icao}
                      style={[
                        styles.dropdownItem,
                        selectedAirline?.icao === airline.icao && styles.dropdownItemActive,
                      ]}
                      onPress={() => {
                        setSelectedAirline(airline);
                        setDropdownOpen(false);
                      }}
                    >
                      <Image source={{ uri: airline.logoUrl }} style={styles.logo} />
                      <View style={styles.dropdownItemText}>
                        <Text style={styles.airlineName}>{airline.name}</Text>
                        <Text style={styles.airlineIcaoHint}>{airline.icao}</Text>
                      </View>
                      {selectedAirline?.icao === airline.icao ? (
                        <Text style={styles.check}>✓</Text>
                      ) : null}
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            </Pressable>
          </Modal>
        </>
      )}

      <TouchableOpacity
        style={[styles.button, loading && styles.buttonDisabled]}
        onPress={handleComplete}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>Continue</Text>
        )}
      </TouchableOpacity>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    backgroundColor: '#0a0a0a',
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#fff',
    marginTop: 80,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 16,
    color: '#a1a1aa',
    marginBottom: 24,
  },
  label: {
    fontSize: 14,
    color: '#a1a1aa',
    marginBottom: 8,
  },
  dropdown: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#18181b',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#27272a',
  },
  dropdownSelected: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  dropdownText: { marginLeft: 12, flex: 1 },
  airlineName: { fontSize: 16, fontWeight: '600', color: '#fff' },
  airlineIcaoHint: { fontSize: 12, color: '#71717a', marginTop: 2 },
  placeholder: { fontSize: 16, color: '#71717a', flex: 1 },
  chevron: { fontSize: 10, color: '#71717a' },
  logo: { width: 32, height: 32, borderRadius: 4 },
  input: {
    backgroundColor: '#18181b',
    borderRadius: 12,
    padding: 16,
    color: '#fff',
    fontSize: 16,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: '#27272a',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    padding: 24,
  },
  modalContent: {
    backgroundColor: '#18181b',
    borderRadius: 16,
    padding: 20,
    maxHeight: '80%',
    borderWidth: 1,
    borderColor: '#27272a',
  },
  modalTitle: { fontSize: 18, fontWeight: '600', color: '#fff', marginBottom: 16 },
  dropdownList: { maxHeight: 400 },
  dropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 10,
    marginBottom: 4,
  },
  dropdownItemActive: { backgroundColor: '#27272a' },
  dropdownItemText: { marginLeft: 12, flex: 1 },
  check: { fontSize: 16, color: '#22c55e' },
  button: {
    backgroundColor: '#22c55e',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
