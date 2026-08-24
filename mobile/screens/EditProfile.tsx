import { useState, useEffect, useRef, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import { useSession } from '../contexts/SessionContext';
import { supabase } from '../lib/supabase';
import { colors, useThemeMode } from '../theme/colors';
import { AIRLINES, Airline } from '../constants/airlines';
import { matchAirlineByCompanyText } from '../lib/airlineLookup';
import { normalizeCrewAirlineIcaoTypo } from '../lib/pdfRosterImport';
import { changeAppLocale, type Locale } from '../lib/i18n';
import KeyboardSafeScroll from '../components/KeyboardSafeScroll';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';

export default function EditProfile() {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const themeMode = useThemeMode();
  const styles = useMemo(() => createEditProfileStyles(themeMode), [themeMode]);
  const { profile, crewProfile, refreshProfile } = useSession();
  const [fullName, setFullName] = useState(profile?.full_name ?? '');
  const [selectedLocale, setSelectedLocale] = useState<Locale>(profile?.locale ?? 'en');
  const [selectedAirline, setSelectedAirline] = useState<Airline | null>(null);
  const [icaoEdit, setIcaoEdit] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(profile?.avatar_url ?? null);
  const [avatarUploading, setAvatarUploading] = useState(false);

  const isCrew = profile?.role === 'crew';
  const initialLocaleRef = useRef<Locale>((profile?.locale as Locale) ?? 'en');
  const didPersistLocaleRef = useRef(false);

  const sortedAirlines: Airline[] = [...AIRLINES].sort((a, b) =>
    a.name.localeCompare(b.name, 'en', { sensitivity: 'base' })
  );

  useEffect(() => {
    setFullName(profile?.full_name ?? '');
  }, [profile?.full_name]);

  useEffect(() => {
    setSelectedLocale((profile?.locale as Locale) ?? 'en');
    initialLocaleRef.current = ((profile?.locale as Locale) ?? 'en');
    didPersistLocaleRef.current = false;
  }, [profile?.locale]);

  useEffect(() => {
    const unsub = (navigation as any)?.addListener?.('beforeRemove', () => {
      if (!didPersistLocaleRef.current) {
        changeAppLocale(initialLocaleRef.current).catch(() => {});
      }
    });
    return () => {
      if (!didPersistLocaleRef.current) {
        changeAppLocale(initialLocaleRef.current).catch(() => {});
      }
      if (typeof unsub === 'function') unsub();
    };
  }, [navigation]);

  const switchLocaleInstant = async (loc: Locale) => {
    setSelectedLocale(loc);
    await changeAppLocale(loc);
  };

  useEffect(() => {
    const raw = crewProfile?.airline_icao?.trim();
    if (raw) {
      const icao = normalizeCrewAirlineIcaoTypo(raw);
      const a = AIRLINES.find((x) => x.icao.toUpperCase() === icao.toUpperCase());
      setSelectedAirline(a ?? null);
      setIcaoEdit(icao.toUpperCase());
      return;
    }
    if (crewProfile?.company_name) {
      const guess = matchAirlineByCompanyText(crewProfile.company_name);
      setSelectedAirline(guess);
      setIcaoEdit(guess?.icao ?? '');
      return;
    }
    setSelectedAirline(null);
    setIcaoEdit('');
  }, [crewProfile?.airline_icao, crewProfile?.company_name]);

  const handlePickAvatar = async () => {
    if (!profile?.id) return;
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(t('common.error'), 'Fotoğraflara erişim izni verilmedi.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (result.canceled) return;
    const picked = result.assets[0];
    try {
      setAvatarUploading(true);

      // 1) Fotoğrafı sabit boyuta indir (maks 512x640, dikdörtgen oran korunur).
      const manipulated = await ImageManipulator.manipulateAsync(
        picked.uri,
        [{ resize: { width: 512 } }],
        { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG, base64: true }
      );

      if (!manipulated.base64) {
        Alert.alert(t('common.error'), 'Fotoğraf verisi okunamadı. Lütfen tekrar deneyin.');
        return;
      }

      // 2) Küçültülmüş resmi data URL olarak profilde sakla.
      const dataUrl = `data:image/jpeg;base64,${manipulated.base64}`;
      const { error: updateError } = await supabase
        .from('profiles')
        .update({ avatar_url: dataUrl })
        .eq('id', profile.id);
      if (updateError) {
        Alert.alert(t('common.error'), updateError.message);
        return;
      }
      setAvatarUrl(dataUrl);
      await refreshProfile();
    } catch (e: any) {
      Alert.alert(t('common.error'), e?.message ?? 'Fotoğraf yüklenemedi.');
    } finally {
      setAvatarUploading(false);
    }
  };

  const handleSave = async () => {
    if (isCrew && !selectedAirline) {
      Alert.alert(t('common.error'), t('editProfile.errorSelectAirline'));
      return;
    }

    const icao = normalizeCrewAirlineIcaoTypo(
      (icaoEdit || selectedAirline?.icao || '').trim().toUpperCase().slice(0, 12),
    ).slice(0, 12);
    if (isCrew && !icao) {
      Alert.alert(t('common.error'), 'ICAO code is required');
      return;
    }

    setLoading(true);
    const userId = profile?.id;
    if (!userId) {
      setLoading(false);
      return;
    }

    const { error: profileError } = await supabase
      .from('profiles')
      .update({ full_name: fullName.trim() || null, locale: selectedLocale })
      .eq('id', userId);

    if (profileError) {
      setLoading(false);
      Alert.alert(t('common.error'), profileError.message);
      return;
    }

    if (isCrew && crewProfile?.id) {
      const { error: crewError } = await supabase
        .from('crew_profiles')
        .update({
          company_name: selectedAirline!.name,
          airline_icao: icao,
        })
        .eq('user_id', userId);

      if (crewError) {
        setLoading(false);
        Alert.alert(t('common.error'), crewError.message);
        return;
      }
    }

    await changeAppLocale(selectedLocale);
    await refreshProfile();
    setLoading(false);
    didPersistLocaleRef.current = true;
    navigation.goBack();
  };

  if (!profile) return null;

  return (
    <KeyboardSafeScroll style={styles.container} contentContainerStyle={styles.scroll} bottomOffset={40}>
        {/* Avatar pickeri */}
        <View style={styles.avatarSection}>
          {avatarUrl ? (
            <Image source={{ uri: avatarUrl }} style={styles.avatarImage} />
          ) : (
            <View style={styles.avatarFallback}>
              <Text style={styles.avatarInitial}>
                {(profile.full_name || profile.id || '?').trim().charAt(0).toUpperCase()}
              </Text>
            </View>
          )}
          <TouchableOpacity
            style={styles.avatarButton}
            onPress={handlePickAvatar}
            disabled={avatarUploading}
          >
            <Text style={styles.avatarButtonText}>
              {avatarUploading ? t('common.loading') : 'Fotoğrafı Değiştir'}
            </Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.label}>{t('profile.name')}</Text>
        <TextInput
          style={styles.input}
          value={fullName}
          onChangeText={setFullName}
          placeholder={t('editProfile.yourName')}
          placeholderTextColor={colors.textMuted}
          autoCapitalize="words"
        />

        <Text style={styles.label}>{t('editProfile.language')}</Text>
        <View style={styles.roleRow}>
          <TouchableOpacity
            style={[styles.roleButton, selectedLocale === 'en' && styles.roleButtonActive]}
            onPress={() => switchLocaleInstant('en')}
          >
            <Text style={[styles.roleButtonText, selectedLocale === 'en' && styles.roleButtonTextActive]}>
              {t('profile.languageEnglish')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.roleButton, selectedLocale === 'tr' && styles.roleButtonActive]}
            onPress={() => switchLocaleInstant('tr')}
          >
            <Text style={[styles.roleButtonText, selectedLocale === 'tr' && styles.roleButtonTextActive]}>
              {t('profile.languageTurkish')}
            </Text>
          </TouchableOpacity>
        </View>

        {isCrew && (
          <>
            <Text style={styles.label}>{t('editProfile.airline')}</Text>
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
                  </View>
                </View>
              ) : (
                <Text style={styles.placeholder}>{t('editProfile.selectAirline')}</Text>
              )}
              <Text style={styles.chevron}>▼</Text>
            </TouchableOpacity>

            <Text style={[styles.label, { marginTop: 0 }]}>ICAO (auto from airline, editable)</Text>
            <TextInput
              style={styles.input}
              value={icaoEdit}
              onChangeText={(s) => setIcaoEdit(s.toUpperCase())}
              placeholder="PGT, THY, …"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="characters"
              maxLength={12}
            />

            <Modal visible={dropdownOpen} transparent animationType="fade">
              <Pressable style={styles.modalOverlay} onPress={() => setDropdownOpen(false)}>
                <View style={styles.modalContent}>
                  <Text style={styles.modalTitle}>{t('editProfile.selectAirlineTitle')}</Text>
                  <ScrollView style={styles.dropdownList}>
                    {sortedAirlines.map((airline) => (
                      <TouchableOpacity
                        key={airline.icao}
                        style={[styles.dropdownItem, selectedAirline?.icao === airline.icao && styles.dropdownItemActive]}
                        onPress={() => {
                          setSelectedAirline(airline);
                          setIcaoEdit(airline.icao);
                          setDropdownOpen(false);
                        }}
                      >
                        <Image source={{ uri: airline.logoUrl }} style={styles.logo} />
                        <View style={styles.dropdownItemText}>
                          <Text style={styles.airlineName}>{airline.name}</Text>
                        </View>
                        {selectedAirline?.icao === airline.icao && (
                          <Text style={styles.check}>✓</Text>
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
          onPress={handleSave}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color={colors.onPrimary} />
          ) : (
            <Text style={styles.buttonText}>{t('editProfile.save')}</Text>
          )}
        </TouchableOpacity>
    </KeyboardSafeScroll>
  );
}

function createEditProfileStyles(themeMode: 'light' | 'dark') {
  const isDark = themeMode === 'dark';
  // Proxy yerine açık token — StyleSheet’in light’a yapışmasını önler.
  const surface = isDark ? '#1A202A' : '#FFFFFF';
  const surfaceAlt = isDark ? '#242B36' : '#F1F6FF';
  const border = isDark ? '#3A4556' : '#E1EAF5';
  const text = isDark ? '#F2F6FC' : '#0B1220';
  const textSecondary = isDark ? '#C8D4E6' : '#22324C';
  const textMuted = isDark ? '#9AA8BC' : '#6B7A90';
  const primary = isDark ? '#6BB3FF' : '#5AA6FF';
  const primaryLight = isDark ? '#1A2740' : '#EEF6FF';
  const background = isDark ? '#0B0D11' : '#F8F8F9';
  const onPrimary = isDark ? '#0B1220' : '#FFFFFF';

  return StyleSheet.create({
    container: { flex: 1, backgroundColor: background },
    scroll: { padding: 24, paddingBottom: 40 },
    avatarSection: {
      alignItems: 'center',
      marginBottom: 16,
    },
    avatarImage: {
      width: 128,
      height: 160,
      borderRadius: 12,
      marginBottom: 8,
    },
    avatarFallback: {
      width: 128,
      height: 160,
      borderRadius: 12,
      backgroundColor: surfaceAlt,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 8,
      borderWidth: 1,
      borderColor: border,
    },
    avatarInitial: { fontSize: 28, fontWeight: '700', color: primary },
    avatarButton: {
      paddingHorizontal: 16,
      paddingVertical: 8,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: primary,
      backgroundColor: surface,
    },
    avatarButtonText: { fontSize: 14, fontWeight: '600', color: primary },
    label: {
      fontSize: 14,
      fontWeight: '700',
      marginBottom: 8,
      marginTop: 16,
      color: textSecondary,
    },
    labelFirst: { marginTop: 0 },
    roleRow: { flexDirection: 'row', gap: 12, marginBottom: 24 },
    roleButton: {
      flex: 1,
      padding: 16,
      borderRadius: 12,
      backgroundColor: surface,
      borderWidth: 2,
      borderColor: border,
      alignItems: 'center',
    },
    roleButtonActive: { borderColor: primary, backgroundColor: primaryLight },
    roleButtonText: { color: textMuted, fontSize: 16, fontWeight: '600' },
    roleButtonTextActive: { color: primary },
    input: {
      fontSize: 16,
      borderWidth: 1,
      borderRadius: 12,
      padding: 14,
      marginBottom: 8,
      backgroundColor: surfaceAlt,
      color: text,
      borderColor: border,
    },
    dropdown: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: surface,
      borderRadius: 12,
      padding: 16,
      marginBottom: 24,
      borderWidth: 1,
      borderColor: border,
    },
    dropdownSelected: { flexDirection: 'row', alignItems: 'center', flex: 1 },
    dropdownText: { marginLeft: 12, flex: 1 },
    airlineName: { fontSize: 16, fontWeight: '600', color: text },
    airlineIcao: { fontSize: 12, color: textMuted },
    placeholder: { fontSize: 16, color: textMuted },
    chevron: { fontSize: 10, color: textMuted },
    logo: { width: 32, height: 32, borderRadius: 4 },
    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', padding: 24 },
    modalContent: {
      borderRadius: 16,
      padding: 20,
      maxHeight: 400,
      backgroundColor: surface,
      borderWidth: 1,
      borderColor: border,
    },
    modalTitle: { fontSize: 18, fontWeight: '600', marginBottom: 16, color: text },
    dropdownList: { maxHeight: 280 },
    dropdownItem: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 14,
      borderRadius: 10,
      marginBottom: 4,
      backgroundColor: surfaceAlt,
    },
    dropdownItemActive: {
      backgroundColor: primaryLight,
      borderWidth: 1,
      borderColor: primary,
    },
    dropdownItemText: { marginLeft: 12, flex: 1 },
    check: { fontSize: 16, color: primary },
    button: { backgroundColor: primary, padding: 16, borderRadius: 12, alignItems: 'center', marginTop: 16 },
    buttonDisabled: { opacity: 0.7 },
    buttonText: { color: onPrimary, fontSize: 16, fontWeight: '600' },
  });
}
