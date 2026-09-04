import './lib/i18n';
import React, { useEffect, useState, useCallback } from 'react';
import { applyStoredLocaleOnStartup } from './lib/i18n';
import { loadAirportDisplayFromSupabase } from './constants/airports';
import { supabase } from './lib/supabase';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { navigationRef } from './navigationRef';
import { AuthEmailLinkListener } from './components/AuthEmailLinkListener';
import { PdfImportLinkingListener } from './components/PdfImportLinkingListener';
import { trackScreenViewThrottled } from './lib/userActivity';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator, type BottomTabBarProps, BottomTabBarHeightCallbackContext } from '@react-navigation/bottom-tabs';
import * as SplashScreen from 'expo-splash-screen';
import {
  View,
  ActivityIndicator,
  StyleSheet,
  ImageBackground,
  Platform,
  Pressable,
  Text,
  Animated,
} from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets, initialWindowMetrics } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';
import { SessionProvider, useSession } from './contexts/SessionContext';
import { AdminRosterProvider, useAdminRoster } from './contexts/AdminRosterContext';
import { colors, loadStoredThemeMode, useThemeMode } from './theme/colors';
import { loadStoredFontSizePreset, useFontScaleMultiplier } from './theme/fontScale';
import { demoPeersForUser, peerInitials, peerTabShortLabel } from './lib/crewPeerDemo';

import Welcome from './screens/Welcome';
import SignIn from './screens/SignIn';
import SignUp from './screens/SignUp';
import ResetPassword from './screens/ResetPassword';
import CompleteProfile from './screens/CompleteProfile';
import Roster from './screens/Roster';
import AddFlight from './screens/AddFlight';
import EditFlight from './screens/EditFlight';
import AdminFlightApiDebug from './screens/AdminFlightApiDebug';
import AdminPanel from './screens/AdminPanel';
import Family from './screens/Family';
import PartnerRoster from './screens/PartnerRoster';
import Profile from './screens/Profile';
import ConsentHistory from './screens/ConsentHistory';
import EditProfile from './screens/EditProfile';
import Connect from './screens/Connect';
import Plans from './screens/Plans';
import Consent from './screens/Consent';
import PrivacyNotice from './screens/PrivacyNotice';
import TermsDisclaimer from './screens/TermsDisclaimer';
import { hasRequiredConsents, flushPendingSignupConsents } from './lib/consents';
import { withStackBackButton } from './lib/stackHeaderOptions';
import { ForceUpdateModal } from './components/ForceUpdateModal';
import {
  fetchAppReleasePolicy,
  isUpdateRequired,
  type AppReleasePolicy,
} from './lib/appReleasePolicy';

/** Instagram floating tab ölçüleri. */
const TAB_BAR_HEIGHT = 62;
const TAB_ICON_SIZE = 20;
const TAB_INDICATOR_W = 52;
const TAB_INDICATOR_H = 48;
const TAB_INDICATOR_RADIUS = 14;
const TAB_SIDE_MARGIN = 28;
const TAB_INNER_PAD_H = 8;

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

function RosterTabScreen() {
  const { adminRosterMode, isAdminUser } = useAdminRoster();
  return (
    <Roster
      showAdminFr24Debug={Boolean(adminRosterMode && isAdminUser)}
      exemptLandedAutoPurge={Boolean(adminRosterMode && isAdminUser)}
    />
  );
}

function PeerRosterTabScreen() {
  const { profile } = useSession();
  const peer = demoPeersForUser(profile?.id)[0] ?? null;
  if (!peer) return null;
  return <Roster peerView={{ peerCrewId: peer.peerCrewId, peerName: peer.name }} />;
}

const TAB_ICONS: Record<
  string,
  { active: React.ComponentProps<typeof Ionicons>['name']; inactive: React.ComponentProps<typeof Ionicons>['name'] }
> = {
  Roster: { active: 'calendar', inactive: 'calendar-outline' },
  Family: { active: 'people', inactive: 'people-outline' },
  Profile: { active: 'person', inactive: 'person-outline' },
};

/** Instagram tarzı floating glass pill + kayan soft indicator. */
function InstagramGlassTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const { t } = useTranslation();
  const { profile } = useSession();
  const peer = React.useMemo(() => demoPeersForUser(profile?.id)[0] ?? null, [profile?.id]);
  const peerLabel = React.useMemo(
    () => (peer ? peerTabShortLabel(peer.name) : null),
    [peer],
  );
  const peerAvatar = React.useMemo(
    () => (peer ? peerInitials(peer.name) : null),
    [peer],
  );
  const insets = useSafeAreaInsets();
  const mode = useThemeMode();
  const isDark = mode === 'dark';
  const onTabBarHeightChange = React.useContext(BottomTabBarHeightCallbackContext);
  const floatBottom = Math.max(insets.bottom > 0 ? 6 : 10, 6);
  const tabCenters = React.useRef<number[]>(state.routes.map(() => 0));
  const indicatorX = React.useRef(new Animated.Value(0)).current;
  const indicatorReady = React.useRef(false);
  React.useEffect(() => {
    onTabBarHeightChange?.(0);
  }, [onTabBarHeightChange]);

  const animateIndicatorTo = React.useCallback(
    (index: number, instant = false) => {
      const x = tabCenters.current[index];
      if (x == null || Number.isNaN(x)) return;
      if (instant || !indicatorReady.current) {
        indicatorX.setValue(x);
        indicatorReady.current = true;
        return;
      }
      Animated.spring(indicatorX, {
        toValue: x,
        useNativeDriver: true,
        friction: 8,
        tension: 160,
        overshootClamping: false,
      }).start();
    },
    [indicatorX],
  );

  React.useEffect(() => {
    animateIndicatorTo(state.index);
  }, [state.index, animateIndicatorTo]);


  return (
    <View
      pointerEvents="box-none"
      style={[
        igTabStyles.dock,
        {
          bottom: floatBottom,
          left: TAB_SIDE_MARGIN,
          right: TAB_SIDE_MARGIN,
        },
      ]}
    >
      <View
        style={[
          igTabStyles.pillShadow,
          {
            shadowColor: isDark ? '#000' : '#0F172A',
            marginBottom: 4,
          },
        ]}
      >
        <View
          style={[
            igTabStyles.pill,
            {
              height: TAB_BAR_HEIGHT,
              backgroundColor: isDark ? 'rgba(28, 32, 40, 0.88)' : 'rgba(255, 255, 255, 0.94)',
              borderColor: isDark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.06)',
            },
          ]}
        >
          <LinearGradient
            pointerEvents="none"
            colors={
              isDark
                ? ['rgba(255,255,255,0.14)', 'rgba(255,255,255,0.03)', 'rgba(0,0,0,0.22)']
                : ['rgba(255,255,255,0.92)', 'rgba(255,255,255,0.4)', 'rgba(236,242,250,0.5)']
            }
            locations={[0, 0.45, 1]}
            style={StyleSheet.absoluteFillObject}
          />
          <View style={[igTabStyles.row, { paddingHorizontal: TAB_INNER_PAD_H }]}>
            <Animated.View
              pointerEvents="none"
              style={[
                igTabStyles.indicator,
                {
                  width: TAB_INDICATOR_W,
                  height: TAB_INDICATOR_H,
                  borderRadius: TAB_INDICATOR_RADIUS,
                  backgroundColor: isDark ? colors.surfaceAlt : colors.primaryLight,
                  top: (TAB_BAR_HEIGHT - TAB_INDICATOR_H) / 2,
                  transform: [{ translateX: indicatorX }],
                },
              ]}
            />
            {state.routes.map((route, index) => {
              const focused = state.index === index;
              const { options } = descriptors[route.key];
              const iconSet = TAB_ICONS[route.name] ?? { active: 'ellipse', inactive: 'ellipse-outline' };
              const a11y =
                options.tabBarAccessibilityLabel ??
                (route.name === 'Roster'
                  ? t('nav.rosterTab')
                  : route.name === 'PeerRoster'
                    ? peerLabel || peer?.name || t('nav.peerTab')
                    : route.name === 'Family'
                      ? t('nav.family')
                      : t('nav.profile'));
              const color = focused
                ? isDark
                  ? colors.text
                  : colors.primary
                : isDark
                  ? colors.textMuted
                  : colors.textMuted;

              const onPress = () => {
                const event = navigation.emit({
                  type: 'tabPress',
                  target: route.key,
                  canPreventDefault: true,
                });
                if (!focused && !event.defaultPrevented) {
                  navigation.navigate(route.name, route.params);
                }
              };

              const isPeerTab = route.name === 'PeerRoster';

              return (
                <React.Fragment key={route.key}>
                  {index > 0 ? (
                    <View
                      pointerEvents="none"
                      style={[
                        igTabStyles.sep,
                        {
                          backgroundColor: isDark
                            ? 'rgba(255,255,255,0.18)'
                            : 'rgba(15,23,42,0.14)',
                        },
                      ]}
                    />
                  ) : null}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={focused ? { selected: true } : {}}
                    accessibilityLabel={a11y}
                    onPress={onPress}
                    onLongPress={() => {
                      navigation.emit({ type: 'tabLongPress', target: route.key });
                    }}
                    style={igTabStyles.item}
                    onLayout={(e) => {
                      const { x, width } = e.nativeEvent.layout;
                      tabCenters.current[index] = x + width / 2 - TAB_INDICATOR_W / 2;
                      if (index === state.index) {
                        animateIndicatorTo(index, !indicatorReady.current);
                      }
                    }}
                  >
                    {isPeerTab && peerAvatar ? (
                      <View
                        style={[
                          igTabStyles.peerAvatar,
                          {
                            backgroundColor: focused
                              ? isDark
                                ? colors.surfaceAlt
                                : colors.primary
                              : isDark
                                ? colors.border
                                : colors.primaryLight,
                          },
                        ]}
                      >
                        <Text
                          style={{
                            color: focused
                              ? isDark
                                ? colors.text
                                : colors.onPrimary
                              : color,
                            fontSize: 11,
                            fontWeight: '800',
                          }}
                        >
                          {peerAvatar}
                        </Text>
                      </View>
                    ) : (
                      <Ionicons
                        name={focused ? iconSet.active : iconSet.inactive}
                        size={TAB_ICON_SIZE}
                        color={color}
                      />
                    )}
                    <Text
                      style={[igTabStyles.label, { color }]}
                      numberOfLines={1}
                    >
                      {a11y}
                    </Text>
                  </Pressable>
                </React.Fragment>
              );
            })}
          </View>
        </View>
      </View>
    </View>
  );
}

const igTabStyles = StyleSheet.create({
  dock: {
    position: 'absolute',
    zIndex: 100,
    elevation: 100,
  },
  pillShadow: {
    borderRadius: 999,
    shadowOpacity: 0.18,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 14,
  },
  pill: {
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth * 2,
    overflow: 'hidden',
  },
  indicator: {
    position: 'absolute',
    left: 0,
  },
  row: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  item: {
    flex: 1,
    height: '100%',
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingTop: 4,
  },
  label: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.1,
    maxWidth: '100%',
  },
  peerAvatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sep: {
    width: StyleSheet.hairlineWidth * 2,
    height: 28,
    borderRadius: 1,
    alignSelf: 'center',
  },
});

function MainTabs() {
  const { t } = useTranslation();
  const { profile } = useSession();
  const hasPeerFollow = demoPeersForUser(profile?.id).length > 0;
  const peerName = demoPeersForUser(profile?.id)[0]?.name ?? '';
  const peerTabTitle = peerName ? peerTabShortLabel(peerName) : 'Crew';
  const insets = useSafeAreaInsets();
  const mode = useThemeMode();
  const isDark = mode === 'dark';
  const fontScale = useFontScaleMultiplier();
  const headerTitleFont = Math.round(20 * fontScale);
  const floatBottom = Math.max(insets.bottom > 0 ? 6 : 10, 6);
  const contentBottomPad = TAB_BAR_HEIGHT + 12 + floatBottom + 8;
  const screenOptions = React.useMemo(
    () => ({
      headerStyle: {
        backgroundColor: colors.primary,
        height: 52 + Math.max(insets.top, 0),
      },
      headerStatusBarHeight: Math.max(insets.top, 0),
      headerTintColor: colors.onPrimary,
      headerTitleStyle: { fontWeight: '800' as const, fontSize: headerTitleFont },
      headerLeftContainerStyle: { paddingLeft: 8 },
      headerRightContainerStyle: { paddingRight: 8 },
      contentStyle: { backgroundColor: 'transparent' },
    }),
    [insets.top, headerTitleFont],
  );
  return (
    <Tab.Navigator
      tabBar={(props) => <InstagramGlassTabBar {...props} />}
      safeAreaInsets={{ top: 0, bottom: 0, left: 0, right: 0 }}
      screenOptions={{
        ...screenOptions,
        tabBarShowLabel: false,
        tabBarActiveTintColor: isDark ? colors.text : colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: {
          position: 'absolute',
          backgroundColor: 'transparent',
          borderTopWidth: 0,
          elevation: 0,
          height: 0,
        },
        sceneStyle: {
          backgroundColor: colors.background,
          paddingBottom: contentBottomPad,
        },
      }}
    >
      <Tab.Screen
        name="Roster"
        component={RosterTabScreen}
        options={{
          title: t('nav.roster'),
          tabBarAccessibilityLabel: t('nav.rosterTab'),
          headerShown: true,
        }}
      />
      {hasPeerFollow ? (
        <Tab.Screen
          name="PeerRoster"
          component={PeerRosterTabScreen}
          options={{
            headerShown: true,
            title: peerTabTitle,
            tabBarAccessibilityLabel: peerTabTitle,
          }}
        />
      ) : null}
      <Tab.Screen
        name="Family"
        component={Family}
        options={{
          headerShown: false,
          title: t('nav.family'),
          tabBarAccessibilityLabel: t('nav.family'),
        }}
      />
      <Tab.Screen
        name="Profile"
        component={Profile}
        options={{
          headerShown: false,
          title: t('nav.profile'),
          tabBarAccessibilityLabel: t('nav.profile'),
        }}
      />
    </Tab.Navigator>
  );
}

function RootNavigator() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { session, profile, crewProfile, isLoading, needsPasswordUpdate } = useSession();
  const [consentCheck, setConsentCheck] = useState<'unknown' | 'required' | 'ok'>('unknown');
  const [releasePolicy, setReleasePolicy] = useState<AppReleasePolicy | null>(null);
  const [forceUpdateChecked, setForceUpdateChecked] = useState(false);
  const mode = useThemeMode();
  void mode;
  const fontScale = useFontScaleMultiplier();

  const screenOptions = {
    headerStyle: {
      backgroundColor: colors.primary,
      height: 52 + Math.max(insets.top, 0),
    },
    headerStatusBarHeight: Math.max(insets.top, 0),
    headerTintColor: colors.onPrimary,
    headerTitleStyle: { fontWeight: '800' as const, fontSize: Math.round(20 * fontScale) },
    headerBackVisible: true,
    gestureEnabled: true,
    headerLeftContainerStyle: { paddingLeft: 8 },
    headerRightContainerStyle: { paddingRight: 8 },
    // Opaque content on pushed screens: transparent + ImageBackground can break
    // header/back taps and iOS swipe-back on physical devices (OK in simulator).
    contentStyle: { backgroundColor: colors.background },
  };

  useEffect(() => {
    applyStoredLocaleOnStartup();
  }, []);

  useEffect(() => {
    loadStoredThemeMode();
    void loadStoredFontSizePreset();
  }, []);

  useEffect(() => {
    loadAirportDisplayFromSupabase(supabase);
  }, []);

  useEffect(() => {
    if (!isLoading && Platform.OS !== 'web') void SplashScreen.hideAsync();
  }, [isLoading]);

  useEffect(() => {
    if (isLoading || Platform.OS === 'web') {
      if (!isLoading) setForceUpdateChecked(true);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const policy = await fetchAppReleasePolicy();
        if (!cancelled) setReleasePolicy(policy);
      } catch {
        if (!cancelled) setReleasePolicy(null);
      } finally {
        if (!cancelled) setForceUpdateChecked(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isLoading]);

  useEffect(() => {
    let cancelled = false;
    if (!session?.user?.id || !profile?.id) {
      setConsentCheck('unknown');
      return () => {};
    }
    (async () => {
      try {
        await flushPendingSignupConsents({
          userId: profile.id,
          email: session.user.email,
        });
      } catch {
        // ignore stash flush errors; fall through to DB check
      }
      const ok = await hasRequiredConsents(profile.id);
      if (!cancelled) setConsentCheck(ok ? 'ok' : 'required');
    })();
    return () => {
      cancelled = true;
    };
  }, [session?.user?.id, profile?.id, profile]);

  let body: React.ReactNode;
  if (isLoading) {
    body =
      Platform.OS === 'web' ? (
        <View style={styles.loading}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : null;
  } else if (!session) {
    body = (
      <Stack.Navigator screenOptions={screenOptions}>
        <Stack.Screen name="Welcome" component={Welcome} options={{ headerShown: false }} />
        <Stack.Screen
          name="SignIn"
          component={SignIn}
          options={withStackBackButton({ title: t('welcome.signIn'), headerBackTitle: t('common.backToWelcome') })}
        />
        <Stack.Screen
          name="SignUp"
          component={SignUp}
          options={withStackBackButton({ title: t('welcome.signUp'), headerBackTitle: t('common.backToWelcome') })}
        />
        <Stack.Screen
          name="PrivacyNotice"
          component={PrivacyNotice}
          options={withStackBackButton({ title: t('legal.privacyTitle'), headerBackTitle: t('common.back') })}
        />
        <Stack.Screen
          name="TermsDisclaimer"
          component={TermsDisclaimer}
          options={withStackBackButton({ title: t('legal.termsTitle'), headerBackTitle: t('common.back') })}
        />
      </Stack.Navigator>
    );
  } else if (needsPasswordUpdate) {
    body = (
      <Stack.Navigator screenOptions={screenOptions}>
        <Stack.Screen
          name="ResetPassword"
          component={ResetPassword}
          options={{ title: t('resetPassword.title'), headerBackVisible: false }}
        />
      </Stack.Navigator>
    );
  } else if (session && !profile) {
    body =
      Platform.OS === 'web' ? (
        <View style={styles.loading}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : null;
  } else if (profile?.role === 'crew' && !crewProfile) {
    body = (
      <Stack.Navigator screenOptions={screenOptions}>
        <Stack.Screen
          name="CompleteProfile"
          component={CompleteProfile}
          options={{ title: t('nav.completeSetup'), headerBackVisible: false }}
        />
      </Stack.Navigator>
    );
  } else if (consentCheck === 'required') {
    body = (
      <Stack.Navigator screenOptions={screenOptions}>
        <Stack.Screen name="Consent" component={Consent} options={{ title: t('consent.title'), headerBackVisible: false }} />
        <Stack.Screen
          name="PrivacyNotice"
          component={PrivacyNotice}
          options={withStackBackButton({ title: t('legal.privacyTitle'), headerBackTitle: t('common.back') })}
        />
        <Stack.Screen
          name="TermsDisclaimer"
          component={TermsDisclaimer}
          options={withStackBackButton({ title: t('legal.termsTitle'), headerBackTitle: t('common.back') })}
        />
      </Stack.Navigator>
    );
  } else {
    body = (
      <AdminRosterProvider userEmail={session?.user?.email}>
        <Stack.Navigator screenOptions={screenOptions}>
          <Stack.Screen
            name="Main"
            component={MainTabs}
            options={{
              headerShown: false,
              title: t('nav.roster'),
              headerBackTitle: t('common.back'),
              contentStyle: { backgroundColor: 'transparent' },
            }}
          />
          <Stack.Screen
            name="AddFlight"
            component={AddFlight}
            options={({ route }) =>
              withStackBackButton({
                title: (route.params as { replaceStandbyFlightId?: string } | undefined)?.replaceStandbyFlightId
                  ? t('roster.assignFlightsTitle')
                  : t('nav.addFlight'),
                headerBackTitle: t('common.back'),
              })
            }
          />
          <Stack.Screen
            name="EditFlight"
            component={EditFlight}
            options={({ route }) =>
              withStackBackButton({
                title: (route.params as { readOnly?: boolean } | undefined)?.readOnly
                  ? t('editFlight.routePreview')
                  : t('nav.editFlight'),
                headerBackTitle: t('common.back'),
              })
            }
          />
          <Stack.Screen
            name="AdminFlightApiDebug"
            component={AdminFlightApiDebug}
            options={{ title: t('roster.adminModeTitle'), headerBackTitle: t('common.back') }}
          />
          <Stack.Screen
            name="AdminPanel"
            component={AdminPanel}
            options={withStackBackButton({ title: t('roster.adminModeTitle'), headerBackTitle: t('common.back') })}
          />
          <Stack.Screen
            name="ConsentHistory"
            component={ConsentHistory}
            options={withStackBackButton({ title: t('consent.historyTitle'), headerBackTitle: t('common.back') })}
          />
          <Stack.Screen
            name="EditProfile"
            component={EditProfile}
            options={withStackBackButton({ title: t('nav.editProfile'), headerBackTitle: t('common.back') })}
          />
          <Stack.Screen
            name="Connect"
            component={Connect}
            options={withStackBackButton({ title: t('nav.invitations'), headerBackTitle: t('common.back') })}
          />
          <Stack.Screen
            name="PartnerRoster"
            component={PartnerRoster}
            options={withStackBackButton({ title: 'Crew', headerBackTitle: t('common.back') })}
          />
          <Stack.Screen
            name="Plans"
            component={Plans}
            options={withStackBackButton({ title: t('nav.plans'), headerBackTitle: t('common.back') })}
          />
          <Stack.Screen
            name="PrivacyNotice"
            component={PrivacyNotice}
            options={withStackBackButton({ title: t('legal.privacyTitle'), headerBackTitle: t('common.back') })}
          />
          <Stack.Screen
            name="TermsDisclaimer"
            component={TermsDisclaimer}
            options={withStackBackButton({ title: t('legal.termsTitle'), headerBackTitle: t('common.back') })}
          />
        </Stack.Navigator>
      </AdminRosterProvider>
    );
  }

  const blockUpdate = forceUpdateChecked && isUpdateRequired(releasePolicy);

  return (
    <>
      {blockUpdate ? null : body}
      <ForceUpdateModal visible={blockUpdate} policy={releasePolicy} />
    </>
  );
}

export default function App() {
  const [navigationReady, setNavigationReady] = useState(false);
  const onNavigationReady = useCallback(() => setNavigationReady(true), []);
  const mode = useThemeMode();
  const navTheme = {
    ...DefaultTheme,
    colors: {
      ...DefaultTheme.colors,
      background: colors.background,
      card: colors.surface,
      text: colors.text,
      border: colors.border,
      primary: colors.primary,
    },
  };
  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SessionProvider>
          <AuthEmailLinkListener />
          <PdfImportLinkingListener navigationReady={navigationReady} />
          <StatusBar style={mode === 'dark' ? 'light' : 'dark'} backgroundColor={colors.primary} />
        <ImageBackground
          // Eski arka plan: iniş yapan uçağın transparan hali.
          source={require('./assets/aviation-bg-landing.png')}
          style={{ flex: 1 }}
          imageStyle={{
            opacity: mode === 'dark' ? 0.12 : 0.12,
            // Pisti biraz yukarı al ki tab bar ile çakışmasın.
            transform: [{ translateY: 10 }],
          }}
          resizeMode="cover"
        >
          <NavigationContainer
            ref={navigationRef}
            onReady={onNavigationReady}
            onStateChange={() => {
              const route = navigationRef.getCurrentRoute();
              const screen = route?.name;
              if (!screen) return;
              void supabase.auth.getSession().then(({ data }) => {
                const uid = data.session?.user?.id;
                if (uid) void trackScreenViewThrottled(uid, screen);
              });
            }}
            theme={navTheme as any}
          >
            <RootNavigator />
          </NavigationContainer>
        </ImageBackground>
        </SessionProvider>
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
  },
});
