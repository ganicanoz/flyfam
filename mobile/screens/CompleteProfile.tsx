import { useState } from 'react';
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
} from 'react-native';
import { useSession } from '../contexts/SessionContext';
import { supabase } from '../lib/supabase';
import { colors } from '../theme/colors';
import { AIRLINES, Airline } from '../constants/airlines';

export default function CompleteProfile() {
  const [selectedAirline, setSelectedAirline] = useState<Airline | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const { profile, refreshProfile } = useSession();
  const isCrew = profile?.role === 'crew';

  const handleComplete = async () => {
    if (isCrew && !selectedAirline) {
      Alert.alert('Error', 'Please select your airline');
      return;
    }

    setLoading(true);
    if (isCrew) {
      const { error } = await supabase.rpc('create_crew_profile', {
        p_company_name: selectedAirline!.name,
        p_time_preference: 'local',
        p_airline_icao: selectedAirline!.icao,
      });
      if (error) {
        setLoading(false);
        Alert.alert('Error', error.message);
        return;
      }
    }
    await refreshProfile();
    setLoading(false);
  };

  if (!profile) return null;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={[styles.container, { backgroundColor: colors.background }]}
    >
      <Text style={[styles.title, { color: colors.text }]}>Complete setup</Text>
      <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
        {isCrew
          ? 'Select your airline (MVP: Pegasus, Turkish Airlines, SunExpress)'
          : "You're all set. Connect to a crew member to get started."}
      </Text>

      {isCrew && (
        <>
          <Text style={[styles.label, { color: colors.textSecondary }]}>Airline</Text>
          <TouchableOpacity
            style={styles.dropdown}
            onPress={() => setDropdownOpen(true)}
            activeOpacity={0.7}
          >
            {selectedAirline ? (
              <View style={styles.dropdownSelected}>
                <Image source={{ uri: selectedAirline.logoUrl }} style={styles.logo} />
                <View style={styles.dropdownText}>
                  <Text style={[styles.airlineName, { color: colors.text }]}>{selectedAirline.name}</Text>
                  <Text style={[styles.airlineIcao, { color: colors.textMuted }]}>{selectedAirline.icao}</Text>
                </View>
              </View>
            ) : (
              <Text style={[styles.placeholder, { color: colors.textMuted }]}>Select airline...</Text>
            )}
            <Text style={[styles.chevron, { color: colors.textMuted }]}>▼</Text>
          </TouchableOpacity>

          <Modal visible={dropdownOpen} transparent animationType="fade">
            <Pressable style={styles.modalOverlay} onPress={() => setDropdownOpen(false)}>
              <View style={styles.modalContent}>
                <Text style={[styles.modalTitle, { color: colors.text }]}>Select airline</Text>
                <ScrollView style={styles.dropdownList}>
                  {AIRLINES.map((airline) => (
                    <TouchableOpacity
                      key={airline.icao}
                      style={[styles.dropdownItem, selectedAirline?.icao === airline.icao && styles.dropdownItemActive]}
                      onPress={() => {
                        setSelectedAirline(airline);
                        setDropdownOpen(false);
                      }}
                    >
                      <Image source={{ uri: airline.logoUrl }} style={styles.logo} />
                      <View style={styles.dropdownItemText}>
                        <Text style={[styles.airlineName, { color: colors.text }]}>{airline.name}</Text>
                        <Text style={[styles.airlineIcao, { color: colors.textMuted }]}>{airline.icao}</Text>
                      </View>
                      {selectedAirline?.icao === airline.icao && (
                        <Text style={[styles.check, { color: colors.primary }]}>✓</Text>
                      )}
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
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Continue</Text>}
      </TouchableOpacity>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24 },
  title: { fontSize: 28, fontWeight: '700', marginTop: 80, marginBottom: 4 },
  subtitle: { fontSize: 16, marginBottom: 32 },
  label: { fontSize: 14, marginBottom: 8 },
  dropdown: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: colors.border,
  },
  dropdownSelected: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  dropdownText: { marginLeft: 12 },
  airlineName: { fontSize: 16, fontWeight: '600' },
  airlineIcao: { fontSize: 12 },
  placeholder: { fontSize: 16 },
  chevron: { fontSize: 10 },
  logo: { width: 40, height: 40, borderRadius: 4 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 24 },
  modalContent: { backgroundColor: colors.surface, borderRadius: 16, padding: 20, maxHeight: 400 },
  modalTitle: { fontSize: 18, fontWeight: '600', marginBottom: 16 },
  dropdownList: { maxHeight: 280 },
  dropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 10,
    marginBottom: 4,
  },
  dropdownItemActive: { backgroundColor: colors.surfaceAlt },
  dropdownItemText: { marginLeft: 12, flex: 1 },
  check: { fontSize: 16 },
  button: { backgroundColor: colors.primary, padding: 16, borderRadius: 12, alignItems: 'center' },
  buttonDisabled: { opacity: 0.7 },
  buttonText: { color: colors.white, fontSize: 16, fontWeight: '600' },
});
