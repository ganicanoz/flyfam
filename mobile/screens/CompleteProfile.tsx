import { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
  Image,
  Modal,
  Pressable,
  ScrollView,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSession } from '../contexts/SessionContext';
import { supabase } from '../lib/supabase';
import { colors, useThemeMode } from '../theme/colors';
import { radius } from '../theme/tokens';
import { AIRLINES, Airline } from '../constants/airlines';
import { getAirportDisplay } from '../constants/airports';
import KeyboardSafeScroll from '../components/KeyboardSafeScroll';
import { ScreenPageHeader } from '../components/ScreenPageHeader';
import { FormCard, FormSectionTitle } from '../components/FormCard';
import { PrimaryButton } from '../components/PrimaryButton';

export default function CompleteProfile() {
  const { t } = useTranslation();
  const themeMode = useThemeMode();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(), [themeMode]);
  const [selectedAirline, setSelectedAirline] = useState<Airline | null>(null);
  const [icaoEdit, setIcaoEdit] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [homeBaseIata, setHomeBaseIata] = useState('');
  const { profile, refreshProfile } = useSession();
  const isCrew = profile?.role === 'crew';

  const sortedAirlines = useMemo(
    () => [...AIRLINES].sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' })),
    [],
  );

  useEffect(() => {
    if (selectedAirline) setIcaoEdit(selectedAirline.icao);
  }, [selectedAirline]);

  const handleComplete = async () => {
    if (isCrew && !selectedAirline) {
      Alert.alert(t('common.error'), t('completeProfile.errorSelectAirline'));
      return;
    }

    const icao = (icaoEdit || selectedAirline?.icao || '').trim().toUpperCase().slice(0, 12);
    const homeBase = homeBaseIata.trim().toUpperCase().slice(0, 4);
    if (isCrew && !icao) {
      Alert.alert(t('common.error'), 'ICAO code is required');
      return;
    }
    if (isCrew && !homeBase) {
      Alert.alert(t('common.error'), t('completeProfile.errorHomeBaseRequired'));
      return;
    }
    const homeBaseDisplay = getAirportDisplay(homeBase);
    const homeBaseCity = homeBaseDisplay?.city ?? null;

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
          Alert.alert(t('common.error'), error.message);
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
          Alert.alert(t('common.error'), error.message);
          return;
        }
      }
    }
    await refreshProfile();
    setLoading(false);
  };

  if (!profile) return null;

  const footerPad = Math.max(insets.bottom, 10);

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScreenPageHeader
        title={t('completeProfile.title')}
        subtitle={isCrew ? t('completeProfile.subtitleCrew') : t('completeProfile.subtitleFamily')}
        showBack={false}
      />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={8}
      >
        <KeyboardSafeScroll
          style={styles.flex}
          contentContainerStyle={[styles.scroll, { paddingBottom: 100 + footerPad }]}
          bottomOffset={40}
        >
          {isCrew ? (
            <>
              <FormSectionTitle>{t('completeProfile.airline')}</FormSectionTitle>
              <FormCard>
                <TouchableOpacity
                  style={styles.airlineRow}
                  onPress={() => setDropdownOpen(true)}
                  activeOpacity={0.7}
                  disabled={loading}
                >
                  {selectedAirline ? (
                    <View style={styles.airlineSelected}>
                      <Image source={{ uri: selectedAirline.logoUrl }} style={styles.logo} />
                      <Text style={styles.airlineName} numberOfLines={1}>
                        {selectedAirline.name}
                      </Text>
                    </View>
                  ) : (
                    <Text style={styles.placeholder}>{t('completeProfile.selectAirline')}</Text>
                  )}
                  <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                </TouchableOpacity>
                <View style={styles.divider} />
                <View style={styles.row}>
                  <Text style={styles.rowLabel}>{t('editProfile.homeBase')}</Text>
                  <TextInput
                    style={[styles.rowInput, styles.rowInputCode, { backgroundColor: colors.inputFill }]}
                    value={homeBaseIata}
                    onChangeText={(s) => setHomeBaseIata(s.toUpperCase())}
                    placeholder={t('completeProfile.homeBasePlaceholder')}
                    placeholderTextColor={colors.textMuted}
                    autoCapitalize="characters"
                    autoCorrect={false}
                    maxLength={4}
                    editable={!loading}
                  />
                </View>
                <View style={styles.divider} />
                <View style={styles.row}>
                  <Text style={styles.rowLabel}>{t('editProfile.icao')}</Text>
                  <TextInput
                    style={[styles.rowInput, styles.rowInputCode, { backgroundColor: colors.inputFill }]}
                    value={icaoEdit}
                    onChangeText={(s) => setIcaoEdit(s.toUpperCase())}
                    placeholder="PGT, THY, …"
                    placeholderTextColor={colors.textMuted}
                    autoCapitalize="characters"
                    autoCorrect={false}
                    maxLength={12}
                    editable={!loading}
                  />
                </View>
              </FormCard>
              <Text style={styles.helper}>{t('completeProfile.homeBaseExample')}</Text>

              <Modal visible={dropdownOpen} transparent animationType="fade">
                <Pressable style={styles.modalOverlay} onPress={() => setDropdownOpen(false)}>
                  <Pressable style={styles.modalContent} onPress={() => {}}>
                    <Text style={styles.modalTitle}>{t('completeProfile.selectAirlineTitle')}</Text>
                    <ScrollView style={styles.dropdownList}>
                      {sortedAirlines.map((airline) => (
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
                          </View>
                          {selectedAirline?.icao === airline.icao ? (
                            <Ionicons name="checkmark" size={18} color={colors.primary} />
                          ) : null}
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </Pressable>
                </Pressable>
              </Modal>
            </>
          ) : null}
        </KeyboardSafeScroll>

        <View style={[styles.saveBar, { paddingBottom: footerPad, backgroundColor: colors.background }]}>
          <PrimaryButton
            title={t('common.continue')}
            onPress={() => void handleComplete()}
            loading={loading}
          />
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

function createStyles() {
  return StyleSheet.create({
    screen: { flex: 1 },
    flex: { flex: 1 },
    scroll: { paddingHorizontal: 16, paddingTop: 12 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 14,
      paddingVertical: 10,
      minHeight: 52,
    },
    rowLabel: {
      width: 72,
      fontSize: 13,
      fontWeight: '600',
      color: colors.textMuted,
    },
    rowInput: {
      flex: 1,
      fontSize: 16,
      fontWeight: '700',
      color: colors.text,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    rowInputCode: {
      textAlign: 'right',
      letterSpacing: 0.5,
      fontVariant: ['tabular-nums'],
    },
    divider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.border,
      marginLeft: 14,
    },
    helper: {
      marginTop: -4,
      paddingHorizontal: 4,
      fontSize: 12,
      fontWeight: '500',
      color: colors.textMuted,
    },
    airlineRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 14,
      paddingVertical: 12,
      minHeight: 56,
      gap: 8,
    },
    airlineSelected: {
      flexDirection: 'row',
      alignItems: 'center',
      flex: 1,
      minWidth: 0,
      gap: 12,
    },
    airlineName: {
      flex: 1,
      fontSize: 16,
      fontWeight: '700',
      color: colors.text,
    },
    placeholder: { flex: 1, fontSize: 16, color: colors.textMuted, fontWeight: '500' },
    logo: { width: 32, height: 32, borderRadius: 6 },
    modalOverlay: {
      flex: 1,
      backgroundColor: 'rgba(15,27,61,0.45)',
      justifyContent: 'center',
      padding: 24,
    },
    modalContent: {
      borderRadius: radius.card,
      padding: 16,
      maxHeight: 420,
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    modalTitle: {
      fontSize: 17,
      fontWeight: '800',
      marginBottom: 12,
      color: colors.text,
    },
    dropdownList: { maxHeight: 320 },
    dropdownItem: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 12,
      borderRadius: 10,
      marginBottom: 4,
      backgroundColor: colors.background,
    },
    dropdownItemActive: {
      backgroundColor: colors.primaryLight,
      borderWidth: 1,
      borderColor: colors.primary,
    },
    dropdownItemText: { marginLeft: 12, flex: 1 },
    saveBar: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
      paddingHorizontal: 16,
      paddingTop: 10,
    },
  });
}
