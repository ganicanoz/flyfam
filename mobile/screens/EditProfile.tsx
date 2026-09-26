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
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSession } from '../contexts/SessionContext';
import { supabase } from '../lib/supabase';
import { colors, useThemeMode } from '../theme/colors';
import { radius } from '../theme/tokens';
import { AIRLINES, Airline } from '../constants/airlines';
import { matchAirlineByCompanyText } from '../lib/airlineLookup';
import { normalizeCrewAirlineIcaoTypo } from '../lib/pdfRosterImport';
import { changeAppLocale, type Locale } from '../lib/i18n';
import KeyboardSafeScroll from '../components/KeyboardSafeScroll';
import { ScreenPageHeader } from '../components/ScreenPageHeader';
import { FormCard, FormSectionTitle } from '../components/FormCard';
import { PrimaryButton } from '../components/PrimaryButton';
import { getAirportDisplay } from '../constants/airports';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';

export default function EditProfile() {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const themeMode = useThemeMode();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createEditProfileStyles(themeMode), [themeMode]);
  const { profile, crewProfile, refreshProfile } = useSession();
  const [fullName, setFullName] = useState(profile?.full_name ?? '');
  const [selectedLocale, setSelectedLocale] = useState<Locale>(profile?.locale ?? 'en');
  const [selectedAirline, setSelectedAirline] = useState<Airline | null>(null);
  const [icaoEdit, setIcaoEdit] = useState('');
  const [homeBaseIata, setHomeBaseIata] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(profile?.avatar_url ?? null);
  const [avatarUploading, setAvatarUploading] = useState(false);

  const isCrew = profile?.role === 'crew';
  const initialLocaleRef = useRef<Locale>((profile?.locale as Locale) ?? 'en');
  const didPersistLocaleRef = useRef(false);
  const fieldFill = themeMode === 'dark' ? '#1A2740' : '#F0F1F5';

  const sortedAirlines: Airline[] = [...AIRLINES].sort((a, b) =>
    a.name.localeCompare(b.name, 'en', { sensitivity: 'base' })
  );

  useEffect(() => {
    setFullName(profile?.full_name ?? '');
  }, [profile?.full_name]);

  useEffect(() => {
    setAvatarUrl(profile?.avatar_url ?? null);
  }, [profile?.avatar_url]);

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

  useEffect(() => {
    setHomeBaseIata((crewProfile?.home_base_iata ?? '').trim().toUpperCase());
  }, [crewProfile?.home_base_iata]);

  const initialName = (profile?.full_name ?? '').trim();
  const initialLocale = (profile?.locale as Locale) ?? 'en';
  const initialIcao = normalizeCrewAirlineIcaoTypo(
    (crewProfile?.airline_icao ?? '').trim().toUpperCase(),
  );
  const initialBase = (crewProfile?.home_base_iata ?? '').trim().toUpperCase();

  const isDirty =
    fullName.trim() !== initialName ||
    selectedLocale !== initialLocale ||
    (isCrew &&
      (normalizeCrewAirlineIcaoTypo(icaoEdit.trim().toUpperCase()) !== initialIcao ||
        homeBaseIata.trim().toUpperCase() !== initialBase ||
        (selectedAirline?.icao ?? '').toUpperCase() !==
          (AIRLINES.find((a) => a.icao.toUpperCase() === initialIcao)?.icao ?? initialIcao).toUpperCase()));

  const canSave = isDirty && !loading;

  const metaLine = useMemo(() => {
    if (!isCrew) return null;
    const parts = [
      selectedAirline?.iata || icaoEdit.trim().toUpperCase().slice(0, 3) || null,
      homeBaseIata.trim().toUpperCase() || null,
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(' · ') : null;
  }, [isCrew, selectedAirline?.iata, icaoEdit, homeBaseIata]);

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
      const manipulated = await ImageManipulator.manipulateAsync(
        picked.uri,
        [{ resize: { width: 512 } }],
        { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG, base64: true }
      );
      if (!manipulated.base64) {
        Alert.alert(t('common.error'), 'Fotoğraf verisi okunamadı. Lütfen tekrar deneyin.');
        return;
      }
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
    if (!canSave) return;
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
    const homeBase = homeBaseIata.trim().toUpperCase().slice(0, 4);
    if (isCrew && !homeBase) {
      Alert.alert(t('common.error'), t('completeProfile.errorHomeBaseRequired'));
      return;
    }
    const homeBaseDisplay = getAirportDisplay(homeBase);
    const homeBaseCity = homeBaseDisplay?.city ?? null;

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
          home_base_iata: homeBase,
          home_base_city: homeBaseCity,
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

  const footerPad = Math.max(insets.bottom, 10);
  const displayName = fullName.trim() || t('editProfile.yourName');

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScreenPageHeader title={t('nav.editProfile')} />
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
          <View style={styles.avatarSection}>
            <View style={styles.avatarWrap}>
              {avatarUrl ? (
                <Image source={{ uri: avatarUrl }} style={styles.avatarImage} />
              ) : (
                <View style={[styles.avatarFallback, { backgroundColor: colors.primaryLight }]}>
                  <Text style={[styles.avatarInitial, { color: colors.primary }]}>
                    {(profile.full_name || profile.id || '?').trim().charAt(0).toUpperCase()}
                  </Text>
                </View>
              )}
              <TouchableOpacity
                style={styles.cameraBadge}
                onPress={handlePickAvatar}
                disabled={avatarUploading}
                accessibilityLabel={t('editProfile.changePhoto')}
              >
                {avatarUploading ? (
                  <ActivityIndicator size="small" color={colors.onPrimary} />
                ) : (
                  <Ionicons name="camera" size={16} color={colors.onPrimary} />
                )}
              </TouchableOpacity>
            </View>
            <Text style={styles.displayName} numberOfLines={1}>
              {displayName}
            </Text>
            {metaLine ? <Text style={styles.metaLine}>{metaLine}</Text> : null}
          </View>

          <FormSectionTitle>{t('editProfile.sectionPersonal')}</FormSectionTitle>
          <FormCard>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>{t('profile.name')}</Text>
              <TextInput
                style={[styles.rowInput, { backgroundColor: fieldFill }]}
                value={fullName}
                onChangeText={setFullName}
                placeholder={t('editProfile.yourName')}
                placeholderTextColor={colors.textMuted}
                autoCapitalize="words"
              />
            </View>
            <View style={styles.divider} />
            <View style={styles.rowCol}>
              <Text style={styles.rowLabel}>{t('editProfile.language')}</Text>
              <View style={[styles.segment, { backgroundColor: fieldFill }]}>
                <TouchableOpacity
                  style={[styles.segmentItem, selectedLocale === 'en' && styles.segmentItemActive]}
                  onPress={() => void switchLocaleInstant('en')}
                >
                  <Text
                    style={[styles.segmentText, selectedLocale === 'en' && styles.segmentTextActive]}
                  >
                    {t('profile.languageEnglish')}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.segmentItem, selectedLocale === 'tr' && styles.segmentItemActive]}
                  onPress={() => void switchLocaleInstant('tr')}
                >
                  <Text
                    style={[styles.segmentText, selectedLocale === 'tr' && styles.segmentTextActive]}
                  >
                    {t('profile.languageTurkish')}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </FormCard>

          {isCrew ? (
            <>
              <FormSectionTitle>{t('editProfile.sectionAirline')}</FormSectionTitle>
              <FormCard>
                <TouchableOpacity
                  style={styles.airlineRow}
                  onPress={() => setDropdownOpen(true)}
                  activeOpacity={0.7}
                >
                  {selectedAirline ? (
                    <View style={styles.airlineSelected}>
                      <Image source={{ uri: selectedAirline.logoUrl }} style={styles.logo} />
                      <Text style={styles.airlineName} numberOfLines={1}>
                        {selectedAirline.name}
                      </Text>
                    </View>
                  ) : (
                    <Text style={styles.placeholder}>{t('editProfile.selectAirline')}</Text>
                  )}
                  <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                </TouchableOpacity>
                <View style={styles.divider} />
                <View style={styles.row}>
                  <Text style={styles.rowLabel}>{t('editProfile.homeBase')}</Text>
                  <TextInput
                    style={[styles.rowInput, styles.rowInputCode, { backgroundColor: fieldFill }]}
                    value={homeBaseIata}
                    onChangeText={(s) => setHomeBaseIata(s.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4))}
                    placeholder={t('editProfile.homeBaseHint')}
                    placeholderTextColor={colors.textMuted}
                    autoCapitalize="characters"
                    autoCorrect={false}
                    maxLength={4}
                  />
                </View>
                <View style={styles.divider} />
                <View style={styles.row}>
                  <Text style={styles.rowLabel}>{t('editProfile.icao')}</Text>
                  <TextInput
                    style={[styles.rowInput, styles.rowInputCode, { backgroundColor: fieldFill }]}
                    value={icaoEdit}
                    onChangeText={(s) => setIcaoEdit(s.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4))}
                    placeholder="PGT"
                    placeholderTextColor={colors.textMuted}
                    autoCapitalize="characters"
                    autoCorrect={false}
                    maxLength={4}
                  />
                </View>
              </FormCard>

              <Modal visible={dropdownOpen} transparent animationType="fade">
                <Pressable style={styles.modalOverlay} onPress={() => setDropdownOpen(false)}>
                  <Pressable style={styles.modalContent} onPress={() => {}}>
                    <Text style={styles.modalTitle}>{t('editProfile.selectAirlineTitle')}</Text>
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
                            setIcaoEdit(airline.icao);
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
            title={t('editProfile.save')}
            onPress={() => void handleSave()}
            loading={loading}
            disabled={!canSave}
          />
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

function createEditProfileStyles(themeMode: 'light' | 'dark') {
  void themeMode;
  return StyleSheet.create({
    screen: { flex: 1 },
    flex: { flex: 1 },
    scroll: { paddingHorizontal: 16, paddingTop: 4 },
    avatarSection: {
      alignItems: 'center',
      marginBottom: 20,
      marginTop: 4,
    },
    avatarWrap: {
      width: 96,
      height: 96,
      marginBottom: 10,
    },
    avatarImage: {
      width: 96,
      height: 96,
      borderRadius: 48,
    },
    avatarFallback: {
      width: 96,
      height: 96,
      borderRadius: 48,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    avatarInitial: { fontSize: 36, fontWeight: '800' },
    cameraBadge: {
      position: 'absolute',
      right: 0,
      bottom: 0,
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 2,
      borderColor: colors.surface,
    },
    displayName: {
      fontSize: 20,
      fontWeight: '800',
      color: colors.text,
      textAlign: 'center',
    },
    metaLine: {
      marginTop: 4,
      fontSize: 13,
      fontWeight: '600',
      color: colors.textMuted,
      textAlign: 'center',
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 14,
      paddingVertical: 10,
      minHeight: 52,
    },
    rowCol: {
      paddingHorizontal: 14,
      paddingVertical: 10,
      gap: 8,
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
    segment: {
      flexDirection: 'row',
      borderRadius: 12,
      padding: 3,
    },
    segmentItem: {
      flex: 1,
      minHeight: 36,
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
    },
    segmentItemActive: {
      backgroundColor: colors.primary,
    },
    segmentText: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.textMuted,
    },
    segmentTextActive: {
      color: colors.onPrimary,
      fontWeight: '700',
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
