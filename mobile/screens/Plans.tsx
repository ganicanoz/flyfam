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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { fetchMySubscriptionAccess, type SubscriptionAccess } from '../lib/subscriptionAccess';
import { purchaseBaseSubscriptionIos, restorePurchases } from '../lib/iapRestore';
import { isIosMonthlyPromoOfferConfigured } from '../lib/applePromotionalOffer';
import {
  fetchSubscriptionTierDisplayPrices,
  type TierStorePrices,
} from '../lib/iapStorePrices';
import { SUBSCRIPTION_TIERS, type PackageCode, getTierByCode } from '../constants/iapProducts';
import { SubscriptionLegalDisclosure } from '../components/SubscriptionLegalDisclosure';
import { ScreenPageHeader } from '../components/ScreenPageHeader';
import { colors, useThemeMode } from '../theme/colors';
import { radius, shadow } from '../theme/tokens';

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

function yearlySavingsPct(tier: (typeof SUBSCRIPTION_TIERS)[number]): number | null {
  const monthlyYear = tier.listPriceMonthlyTry * 12;
  if (monthlyYear <= 0 || tier.listPriceYearlyTry <= 0) return null;
  const pct = Math.round(((monthlyYear - tier.listPriceYearlyTry) / monthlyYear) * 100);
  return pct > 0 ? pct : null;
}

type BillingPeriod = 'monthly' | 'yearly';

export default function Plans() {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const themeMode = useThemeMode();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const styles = useMemo(() => createPlansStyles(themeMode), [themeMode]);
  const [access, setAccess] = useState<SubscriptionAccess | null>(null);
  const [loading, setLoading] = useState(true);
  const [buyingCode, setBuyingCode] = useState<PackageCode | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [billing, setBilling] = useState<BillingPeriod>('monthly');
  const [storePrices, setStorePrices] = useState<Record<PackageCode, TierStorePrices> | null>(null);

  const gap = 8;
  const horizontalPad = 16;
  const cardWidth = Math.max(140, (width - horizontalPad * 2 - gap) / 2);
  const fieldFill = themeMode === 'dark' ? '#1A2740' : '#F0F1F5';

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
  const isTrialing = access?.subscription_status === 'trialing';
  const currentPlanLabel =
    currentTier && isSubActive
      ? t(planTitleKey(currentTier.code))
      : access?.plan_title && isSubActive
        ? access.plan_title
        : t('plans.noSubscription');

  const used = access?.used_family_approved ?? 0;
  const max = access?.max_family_members ?? 0;
  const remaining = Math.max(0, max - used);
  const seatRatio = max > 0 ? Math.min(1, used / max) : 0;

  const onBuyTier = async (code: PackageCode) => {
    const tier = getTierByCode(code);
    if (!tier) return;
    try {
      setBuyingCode(code);
      if (Platform.OS === 'ios') {
        const productId =
          billing === 'yearly' ? tier.iosYearlyProductId : tier.iosMonthlyProductId;
        await purchaseBaseSubscriptionIos(productId);
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
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScreenPageHeader title={t('nav.plans')} />
      <ScrollView
        style={styles.container}
        contentContainerStyle={[styles.content, { paddingBottom: 40 + Math.max(insets.bottom, 8) }]}
      >
        {loading ? (
          <ActivityIndicator color={colors.primary} />
        ) : (
          <>
            <View style={[styles.statusCard, shadow.card]}>
              <View style={styles.statusBody}>
                <Text style={styles.statusLabel}>{t('plans.currentPlan')}</Text>
                <Text style={styles.statusPlanLine} numberOfLines={1}>
                  {currentPlanLabel}
                  {statusKey ? ` · ${t(statusKey)}` : ''}
                </Text>
                <View style={[styles.seatsBox, { backgroundColor: fieldFill }]}>
                  <Text style={styles.seatsHint}>{t('plans.connectedFollowers')}</Text>
                  <Text style={styles.seatsCount}>
                    <Text style={styles.seatsUsed}>{used}</Text>
                    <Text style={styles.seatsMax}>/{max}</Text>
                  </Text>
                  {max > 0 ? (
                    <View style={styles.seatProgressWrap}>
                      <View style={styles.seatProgressTrack}>
                        <View
                          style={[
                            styles.seatProgressFill,
                            { width: `${Math.round(seatRatio * 1000) / 10}%` },
                          ]}
                        />
                      </View>
                      <Text style={styles.seatProgressLabel}>
                        {t('plans.followersRemaining', { count: remaining })}
                      </Text>
                    </View>
                  ) : null}
                </View>
                {isTrialing && access?.trial_ends_at ? (
                  <Text style={styles.statusMeta}>
                    {t('plans.trialEnds')}: {fmtDate(access.trial_ends_at)}
                  </Text>
                ) : null}
              </View>
            </View>

            <View style={[styles.segment, { backgroundColor: fieldFill }]}>
              <TouchableOpacity
                style={[styles.segmentItem, billing === 'monthly' && styles.segmentItemActive]}
                onPress={() => setBilling('monthly')}
              >
                <Text style={[styles.segmentText, billing === 'monthly' && styles.segmentTextActive]}>
                  {t('plans.billingMonthly')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.segmentItem, billing === 'yearly' && styles.segmentItemActive]}
                onPress={() => setBilling('yearly')}
              >
                <Text style={[styles.segmentText, billing === 'yearly' && styles.segmentTextActive]}>
                  {t('plans.billingYearly')}
                </Text>
              </TouchableOpacity>
            </View>

            <View style={[styles.grid, { gap }]}>
              {SUBSCRIPTION_TIERS.map((tier) => {
                const selected = isSubActive && currentCode === tier.code;
                const showPromo =
                  Platform.OS === 'ios' &&
                  tier.code === 'duo' &&
                  isIosMonthlyPromoOfferConfigured() &&
                  !isSubActive &&
                  billing === 'monthly';
                const busy = buyingCode === tier.code;
                const prices = storePrices?.[tier.code] ?? {
                  monthly: '—',
                  yearly: '—',
                  source: 'list' as const,
                };
                const price = billing === 'yearly' ? prices.yearly : prices.monthly;
                const period = billing === 'yearly' ? t('plans.perYear') : t('plans.perMonth');
                const savePct = billing === 'yearly' ? yearlySavingsPct(tier) : null;
                const isTrialCta = tier.code === 'duo' || showPromo;

                return (
                  <View
                    key={tier.code}
                    style={[styles.card, shadow.card, { width: cardWidth }, selected && styles.cardSelected]}
                  >
                    <View style={styles.cardInner}>
                      <Text style={styles.cardTitle} numberOfLines={2}>
                        {t(planTitleKey(tier.code))}
                      </Text>
                      <Text style={styles.cardSeats} numberOfLines={2}>
                        {t('plans.familySeats', { count: tier.maxFamilyMembers })}
                      </Text>
                      <Text style={styles.priceMain} numberOfLines={1}>
                        {price}
                        <Text style={styles.pricePeriod}>{period}</Text>
                      </Text>
                      {savePct != null ? (
                        <Text style={styles.saveBadge}>{t('plans.savePercent', { pct: savePct })}</Text>
                      ) : (
                        <View style={styles.saveBadgeSpacer} />
                      )}

                      {selected ? (
                        <View style={styles.activeBadge}>
                          <Ionicons name="checkmark" size={14} color={colors.primary} />
                          <Text style={styles.activeBadgeText}>{t('plans.currentTierBadge')}</Text>
                        </View>
                      ) : (
                        <TouchableOpacity
                          style={[styles.btn, isTrialCta ? styles.btnChip : styles.btnFilled]}
                          onPress={() => onBuyTier(tier.code)}
                          disabled={!!buyingCode}
                        >
                          {busy ? (
                            <ActivityIndicator
                              color={isTrialCta ? colors.primary : colors.onPrimary}
                              size="small"
                            />
                          ) : (
                            <Text
                              style={[styles.btnText, isTrialCta && styles.btnChipText]}
                              numberOfLines={1}
                            >
                              {isTrialCta ? t('plans.selectPlanWithTrial') : t('plans.selectPlan')}
                            </Text>
                          )}
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                );
              })}
            </View>

            <SubscriptionLegalDisclosure
              compact
              onOpenPrivacy={() => {
                (navigation as { navigate: (name: string) => void }).navigate('PrivacyNotice');
              }}
              onOpenTerms={() => {
                (navigation as { navigate: (name: string) => void }).navigate('TermsDisclaimer');
              }}
              footer={(
                <TouchableOpacity
                  onPress={onRestorePurchases}
                  disabled={restoring}
                  style={styles.restoreLink}
                >
                  {restoring ? (
                    <ActivityIndicator color={colors.textMuted} size="small" />
                  ) : (
                    <Text style={styles.restoreLinkText}>{t('plans.restorePurchases')}</Text>
                  )}
                </TouchableOpacity>
              )}
            />
          </>
        )}
      </ScrollView>
    </View>
  );
}

function createPlansStyles(themeMode: 'light' | 'dark') {
  void themeMode;
  return StyleSheet.create({
    screen: { flex: 1 },
    container: { flex: 1 },
    content: { paddingHorizontal: 16, paddingTop: 4 },
    statusCard: {
      backgroundColor: colors.surface,
      borderRadius: radius.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      overflow: 'hidden',
      marginBottom: 12,
    },
    statusBody: { padding: 14 },
    statusLabel: {
      color: colors.text,
      fontSize: 13,
      fontWeight: '800',
      marginBottom: 4,
    },
    statusPlanLine: {
      color: colors.textSecondary,
      fontSize: 13,
      fontWeight: '600',
      marginBottom: 10,
    },
    seatsBox: {
      borderRadius: 12,
      padding: 12,
      alignItems: 'center',
    },
    seatsHint: {
      fontSize: 11,
      fontWeight: '700',
      color: colors.textMuted,
      textTransform: 'uppercase',
      letterSpacing: 0.3,
    },
    seatsCount: {
      marginTop: 2,
      fontVariant: ['tabular-nums'],
    },
    seatsUsed: {
      fontSize: 36,
      fontWeight: '800',
      color: colors.primary,
      letterSpacing: -1,
    },
    seatsMax: {
      fontSize: 22,
      fontWeight: '600',
      color: colors.textMuted,
    },
    seatProgressWrap: { alignSelf: 'stretch', marginTop: 8, gap: 4 },
    seatProgressTrack: {
      height: 5,
      borderRadius: 999,
      backgroundColor: colors.border,
      overflow: 'hidden',
    },
    seatProgressFill: {
      height: 5,
      borderRadius: 999,
      backgroundColor: colors.primary,
    },
    seatProgressLabel: {
      fontSize: 11,
      fontWeight: '600',
      color: colors.textMuted,
      textAlign: 'center',
    },
    statusMeta: {
      marginTop: 8,
      color: colors.textMuted,
      fontSize: 11,
      textAlign: 'center',
    },
    segment: {
      flexDirection: 'row',
      borderRadius: 12,
      padding: 3,
      marginBottom: 12,
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
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'space-between',
      marginBottom: 4,
    },
    card: {
      backgroundColor: colors.surface,
      borderRadius: radius.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      overflow: 'hidden',
      marginBottom: 8,
      minHeight: 156,
    },
    cardSelected: {
      borderColor: colors.primary,
      borderWidth: 1.5,
    },
    cardInner: {
      padding: 10,
    },
    cardTitle: {
      fontSize: 13,
      fontWeight: '800',
      color: colors.text,
      lineHeight: 16,
      minHeight: 32,
    },
    cardSeats: {
      marginTop: 4,
      fontSize: 11,
      fontWeight: '600',
      color: colors.textMuted,
      lineHeight: 14,
    },
    priceMain: {
      marginTop: 6,
      fontSize: 18,
      fontWeight: '800',
      color: colors.text,
      fontVariant: ['tabular-nums'],
    },
    pricePeriod: {
      fontSize: 11,
      fontWeight: '600',
      color: colors.textMuted,
    },
    saveBadge: {
      marginTop: 4,
      fontSize: 11,
      fontWeight: '700',
      color: colors.primary,
      minHeight: 16,
    },
    saveBadgeSpacer: { minHeight: 16, marginTop: 4 },
    activeBadge: {
      marginTop: 'auto',
      minHeight: 36,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.primary,
      backgroundColor: colors.primaryLight,
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'row',
      gap: 4,
      paddingHorizontal: 6,
    },
    activeBadgeText: {
      color: colors.primary,
      fontWeight: '700',
      fontSize: 11,
    },
    btn: {
      marginTop: 'auto',
      minHeight: 36,
      borderRadius: radius.pill,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 8,
    },
    btnFilled: { backgroundColor: colors.primary },
    btnChip: {
      backgroundColor: colors.primaryLight,
    },
    btnText: { color: colors.onPrimary, fontWeight: '700', fontSize: 11 },
    btnChipText: { color: colors.primary },
    restoreLink: { marginTop: 6, paddingVertical: 4 },
    restoreLinkText: {
      color: colors.textMuted,
      fontSize: 12,
      fontWeight: '600',
      textDecorationLine: 'underline',
    },
  });
}
