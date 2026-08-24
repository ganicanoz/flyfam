import { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  ScrollView,
  Platform,
  useWindowDimensions,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { fetchMySubscriptionAccess, type SubscriptionAccess } from '../lib/subscriptionAccess';
import { purchaseBaseSubscriptionIos, restorePurchases } from '../lib/iapRestore';
import { isIosMonthlyPromoOfferConfigured } from '../lib/applePromotionalOffer';
import {
  fetchSubscriptionTierDisplayPrices,
  type TierStorePrices,
} from '../lib/iapStorePrices';
import { SUBSCRIPTION_TIERS, type PackageCode, getTierByCode } from '../constants/iapProducts';
import { SubscriptionLegalDisclosure } from '../components/SubscriptionLegalDisclosure';
import { colors, useThemeMode } from '../theme/colors';

function fmtDate(iso: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

function planTitleKey(code: PackageCode): string {
  return `plans.tier.${code}.title`;
}

export default function Plans() {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const themeMode = useThemeMode();
  const { width } = useWindowDimensions();
  const styles = useMemo(() => createPlansStyles(), [themeMode]);
  const [access, setAccess] = useState<SubscriptionAccess | null>(null);
  const [loading, setLoading] = useState(true);
  const [buyingCode, setBuyingCode] = useState<PackageCode | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [storePrices, setStorePrices] = useState<Record<PackageCode, TierStorePrices> | null>(null);

  const gap = 10;
  const horizontalPad = 20;
  const cardWidth = Math.max(148, (width - horizontalPad * 2 - gap) / 2);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [a, prices] = await Promise.all([
        fetchMySubscriptionAccess(),
        fetchSubscriptionTierDisplayPrices().catch(() => null),
      ]);
      setAccess(a);
      if (prices) setStorePrices(prices);
    } catch (err) {
      Alert.alert(t('common.error'), String((err as Error)?.message || err));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useFocusEffect(
    useCallback(() => {
      load();
      return () => {};
    }, [load]),
  );

  const statusKey =
    access?.subscription_status === 'trialing'
      ? 'plans.statusTrialing'
      : access?.subscription_status === 'active'
        ? 'plans.statusActive'
        : access?.subscription_status === 'past_due'
          ? 'plans.statusPastDue'
          : access?.subscription_status === 'canceled'
            ? 'plans.statusCanceled'
            : null;

  const currentCode = (access?.plan_code as PackageCode | null) ?? null;
  const currentTier = getTierByCode(currentCode ?? undefined);
  const isSubActive =
    access?.subscription_status === 'trialing' || access?.subscription_status === 'active';
  const currentPlanLabel =
    currentTier && isSubActive
      ? t(planTitleKey(currentTier.code))
      : access?.plan_title && isSubActive
        ? access.plan_title
        : t('plans.noSubscription');

  const used = access?.used_family_approved ?? 0;
  const max = access?.max_family_members ?? 0;

  const onBuyTier = async (code: PackageCode) => {
    const tier = getTierByCode(code);
    if (!tier) return;
    try {
      setBuyingCode(code);
      if (Platform.OS === 'ios') {
        await purchaseBaseSubscriptionIos(tier.iosMonthlyProductId);
      } else {
        Alert.alert(t('common.error'), t('plans.storeIosOnly'));
        return;
      }
      await load();
      Alert.alert(t('plans.planSavedTitle'), t('plans.planSavedMessage'));
    } catch (err) {
      Alert.alert(t('common.error'), String((err as Error)?.message || err));
    } finally {
      setBuyingCode(null);
    }
  };

  const onRestorePurchases = async () => {
    try {
      setRestoring(true);
      await restorePurchases();
      await load();
      Alert.alert(t('plans.restoreDoneTitle'), t('plans.restoreDoneMessage'));
    } catch (err) {
      Alert.alert(t('plans.restoreErrorTitle'), String((err as Error)?.message || err));
    } finally {
      setRestoring(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{t('plans.title')}</Text>
      <Text style={styles.subtitle}>{t('plans.subtitleTiers')}</Text>

      {loading ? (
        <ActivityIndicator color={colors.primary} />
      ) : (
        <>
          <View style={styles.statusBox}>
            <Text style={styles.statusPlanLine}>
              {t('plans.currentPlan')}: {currentPlanLabel}
              {statusKey ? ` · ${t(statusKey)}` : ''}
            </Text>

            <View style={styles.seatsHero}>
              <Text style={styles.seatsHeroLabel}>{t('plans.connectedFamily')}</Text>
              <Text style={styles.seatsHeroCount}>
                {used}
                <Text style={styles.seatsHeroMax}> / {max}</Text>
              </Text>
              <Text style={styles.seatsHeroHint}>{t('plans.seatsHeroHint')}</Text>
            </View>

            {access?.trial_ends_at ? (
              <Text style={styles.statusMeta}>
                {t('plans.trialEnds')}: {fmtDate(access.trial_ends_at)}
              </Text>
            ) : null}
          </View>

          <Text style={styles.sectionLabel}>{t('plans.choosePackage')}</Text>

          <View style={[styles.grid, { gap }]}>
            {SUBSCRIPTION_TIERS.map((tier) => {
              const selected = isSubActive && currentCode === tier.code;
              const showPromo =
                Platform.OS === 'ios' &&
                tier.code === 'duo' &&
                isIosMonthlyPromoOfferConfigured() &&
                !isSubActive;
              const busy = buyingCode === tier.code;
              const prices = storePrices?.[tier.code] ?? {
                monthly: '—',
                yearly: '—',
                source: 'list' as const,
              };

              return (
                <View
                  key={tier.code}
                  style={[
                    styles.card,
                    { width: cardWidth },
                    selected && styles.cardSelected,
                  ]}
                >
                  <View style={styles.cardHeader}>
                    <Text style={styles.cardTitle} numberOfLines={2}>
                      {t(planTitleKey(tier.code))}
                    </Text>
                  </View>

                  <View style={styles.seatCompose}>
                    <Text style={styles.seatYou}>{t('plans.youLabel')}</Text>
                    <Text style={styles.seatPlus}>+</Text>
                    <Text style={styles.cardSeatCount}>{tier.maxFamilyMembers}</Text>
                  </View>
                  <Text style={styles.cardSeatLabel}>
                    {tier.maxFamilyMembers === 1
                      ? t('plans.familyMemberSingular')
                      : t('plans.familyMembersShort')}
                  </Text>

                  <View style={styles.priceBlock}>
                    <Text style={styles.priceMonthly}>
                      {prices.monthly}
                      <Text style={styles.pricePeriodInline}>{t('plans.perMonth')}</Text>
                    </Text>
                    <Text style={styles.priceYearly}>
                      {prices.yearly}
                      <Text style={styles.pricePeriodInline}>{t('plans.perYear')}</Text>
                    </Text>
                  </View>

                  {selected ? (
                    <View style={styles.activeBadge}>
                      <Text style={styles.activeBadgeText}>{t('plans.currentTierBadge')}</Text>
                    </View>
                  ) : (
                    <TouchableOpacity
                      style={[styles.btn, tier.code === 'duo' ? styles.btnTrial : styles.btnDefault]}
                      onPress={() => onBuyTier(tier.code)}
                      disabled={!!buyingCode}
                    >
                      {busy ? (
                        <ActivityIndicator color="#fff" size="small" />
                      ) : (
                        <Text style={styles.btnText}>
                          {tier.code === 'duo' || showPromo
                            ? t('plans.selectPlanWithTrial')
                            : t('plans.selectPlan')}
                        </Text>
                      )}
                    </TouchableOpacity>
                  )}
                </View>
              );
            })}
          </View>

          <TouchableOpacity
            style={[styles.restoreBtn, restoring && styles.restoreBtnDisabled]}
            onPress={onRestorePurchases}
            disabled={restoring}
          >
            {restoring ? (
              <ActivityIndicator color={colors.primary} size="small" />
            ) : (
              <Text style={styles.restoreBtnText}>{t('plans.restorePurchases')}</Text>
            )}
          </TouchableOpacity>

          <SubscriptionLegalDisclosure
            onOpenPrivacy={() => {
              (navigation as { navigate: (name: string) => void }).navigate('PrivacyNotice');
            }}
            onOpenTerms={() => {
              (navigation as { navigate: (name: string) => void }).navigate('TermsDisclaimer');
            }}
          />
        </>
      )}
    </ScrollView>
  );
}

/** FlyFam uçuş günü pembesi — Plans şerit ve takvim vurgusu. */
const BRAND_PINK = '#E57373';
function createPlansStyles() {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { padding: 20, paddingBottom: 48 },
    title: { fontSize: 22, fontWeight: '700', color: colors.text, marginBottom: 6 },
    subtitle: { fontSize: 14, color: colors.textSecondary, marginBottom: 16, lineHeight: 20 },
    statusBox: {
      backgroundColor: colors.surfaceAlt,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 16,
      marginBottom: 18,
    },
    statusPlanLine: {
      color: colors.textSecondary,
      fontSize: 13,
      fontWeight: '600',
      marginBottom: 12,
    },
    seatsHero: {
      alignItems: 'center',
      paddingVertical: 8,
      backgroundColor: colors.surface,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 12,
    },
    seatsHeroLabel: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.textMuted,
      textTransform: 'uppercase',
      letterSpacing: 0.4,
    },
    seatsHeroCount: {
      marginTop: 4,
      fontSize: 44,
      fontWeight: '800',
      color: colors.accent,
      letterSpacing: -1,
      lineHeight: 50,
    },
    seatsHeroMax: {
      fontSize: 28,
      fontWeight: '600',
      color: colors.textMuted,
    },
    seatsHeroHint: {
      marginTop: 2,
      marginBottom: 4,
      fontSize: 13,
      color: colors.textSecondary,
    },
    statusMeta: {
      marginTop: 10,
      color: colors.textMuted,
      fontSize: 12,
      textAlign: 'center',
    },
    sectionLabel: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.text,
      marginBottom: 12,
    },
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'space-between',
      marginBottom: 8,
    },
    card: {
      backgroundColor: colors.surface,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 12,
      marginBottom: 10,
      minHeight: 220,
      justifyContent: 'flex-start',
      overflow: 'hidden',
      position: 'relative',
    },
    cardSelected: {
      borderColor: colors.primary,
      borderWidth: 2,
      backgroundColor: colors.primaryLight,
    },
    cardHeader: {
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
      paddingBottom: 10,
      marginBottom: 10,
      minHeight: 48,
      justifyContent: 'center',
    },
    cardTitle: {
      fontSize: 18,
      fontWeight: '800',
      color: colors.text,
      lineHeight: 22,
      textAlign: 'center',
      paddingHorizontal: 2,
    },
    seatCompose: {
      marginTop: 4,
      flexDirection: 'row',
      alignItems: 'baseline',
      justifyContent: 'center',
      flexWrap: 'wrap',
      gap: 4,
    },
    seatYou: {
      fontSize: 18,
      fontWeight: '800',
      color: colors.text,
      letterSpacing: -0.3,
    },
    seatPlus: {
      fontSize: 18,
      fontWeight: '700',
      color: colors.textMuted,
    },
    cardSeatCount: {
      fontSize: 40,
      fontWeight: '800',
      color: colors.accent,
      letterSpacing: -1,
      lineHeight: 44,
      textAlign: 'center',
    },
    cardSeatLabel: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.textMuted,
      textAlign: 'center',
      marginBottom: 10,
      marginTop: 2,
    },
    priceBlock: {
      alignItems: 'center',
      marginBottom: 10,
      minHeight: 48,
    },
    priceMonthly: {
      fontSize: 16,
      fontWeight: '800',
      color: colors.text,
      textAlign: 'center',
    },
    priceYearly: {
      marginTop: 4,
      fontSize: 12,
      fontWeight: '600',
      color: colors.textSecondary,
      textAlign: 'center',
    },
    pricePeriodInline: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.textMuted,
    },
    activeBadge: {
      marginTop: 4,
      paddingVertical: 10,
      borderRadius: 10,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.success,
      alignItems: 'center',
    },
    activeBadgeText: {
      color: colors.success,
      fontWeight: '700',
      fontSize: 12,
      textAlign: 'center',
    },
    btn: {
      marginTop: 4,
      paddingVertical: 10,
      borderRadius: 10,
      alignItems: 'center',
    },
    btnDefault: { backgroundColor: colors.primary },
    btnTrial: { backgroundColor: BRAND_PINK },
    btnText: { color: colors.onPrimary, fontWeight: '700', fontSize: 13 },
    restoreBtn: {
      marginTop: 8,
      marginBottom: 8,
      paddingVertical: 12,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
    },
    restoreBtnDisabled: { opacity: 0.6 },
    restoreBtnText: { color: colors.primary, fontWeight: '700' },
  });
}
