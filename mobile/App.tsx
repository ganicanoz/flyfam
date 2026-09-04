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
} from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets, initialWindowMetrics } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { SessionProvider, useSession } from './contexts/SessionContext';
import { AdminRosterProvider, useAdminRoster } from './contexts/AdminRosterContext';
import { colors, loadStoredThemeMode, useThemeMode } from './theme/colors';
import { loadStoredFontSizePreset, useFontScaleMultiplier } from './theme/fontScale';
import {
  getRosterLastSyncedAt,
  subscribeRosterLastSyncedAt,
} from './lib/rosterSyncMeta';
import { formatRelativeSyncedAt } from './lib/relativeTime';

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
import { demoPeersForUser, peerTabBadgeLabel } from './lib/crewPeerDemo';
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

/** Uygulama alt nav — primary.soft pill + etiket. */
const TAB_BAR_HEIGHT = 56;
const TAB_ICON_SIZE = 22;
const ANDROID_NAV_BAR_FALLBACK = 48;
const META_LINE_H = 16;

function tabBarBottomPad(bottomInset: number): number {
  if (bottomInset > 0) return bottomInset;
  if (Platform.OS === 'android') return ANDROID_NAV_BAR_FALLBACK;
  return 0;
}

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
  PeerRoster: { active: 'calendar', inactive: 'calendar-outline' },
  Family: { active: 'people', inactive: 'people-outline' },
  Profile: { active: 'person', inactive: 'person-outline' },
};

function FlyFamTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const { t } = useTranslation();
  const { profile } = useSession();
  const peer = React.useMemo(() => demoPeersForUser(profile?.id)[0] ?? null, [profile?.id]);
  const peerBadge = React.useMemo(
    () => (peer ? peerTabBadgeLabel(peer.name) : null),
    [peer],
  );
  const insets = useSafeAreaInsets();
  const onTabBarHeightChange = React.useContext(BottomTabBarHeightCallbackContext);
  const bottomPad = tabBarBottomPad(insets.bottom);
  const [lastSyncedAt, setLastSyncedAt] = React.useState<number | null>(() => getRosterLastSyncedAt());
  const [nowTick, setNowTick] = React.useState(() => Date.now());

  React.useEffect(() => {
    onTabBarHeightChange?.(TAB_BAR_HEIGHT + META_LINE_H + bottomPad);
  }, [onTabBarHeightChange, bottomPad]);

  React.useEffect(() => subscribeRosterLastSyncedAt(() => setLastSyncedAt(getRosterLastSyncedAt())), []);
  React.useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const metaText = React.useMemo(
    () => formatRelativeSyncedAt(lastSyncedAt, nowTick, t),
    [lastSyncedAt, nowTick, t],
  );

  return (
    <View
      style={[
        tabStyles.wrap,
        {
          paddingBottom: bottomPad,
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
        },
      ]}
    >
      <View style={tabStyles.row}>
        {state.routes.map((route, index) => {
          const focused = state.index === index;
          const { options } = descriptors[route.key];
          const iconSet = TAB_ICONS[route.name] ?? { active: 'ellipse', inactive: 'ellipse-outline' };
          const label =
            route.name === 'Roster'
              ? t('nav.flightsTab')
              : route.name === 'PeerRoster'
                ? peerBadge?.shortName || peer?.name || 'Crew'
                : route.name === 'Family'
                  ? t('nav.family')
                  : t('nav.profile');
          const color = focused ? colors.primary : colors.textMuted;

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

          return (
            <Pressable
              key={route.key}
              accessibilityRole="button"
              accessibilityState={focused ? { selected: true } : {}}
              accessibilityLabel={options.tabBarAccessibilityLabel ?? label}
              onPress={onPress}
              onLongPress={() => navigation.emit({ type: 'tabLongPress', target: route.key })}
              style={tabStyles.item}
            >
              <View style={[tabStyles.pill, focused && { backgroundColor: colors.primaryLight }]}>
                <Ionicons
                  name={focused ? iconSet.active : iconSet.inactive}
                  size={TAB_ICON_SIZE}
                  color={color}
                />
              </View>
              <Text style={[tabStyles.label, { color }]} numberOfLines={1}>
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={[tabStyles.meta, { color: colors.textMuted }]} numberOfLines={1}>
        {metaText}
      </Text>
    </View>
  );
}

const tabStyles = StyleSheet.create({
  wrap: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  row: {
    height: TAB_BAR_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  item: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  pill: {
    minWidth: 48,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  label: {
    fontSize: 11,
    fontWeight: '600',
  },
  meta: {
    textAlign: 'center',
    fontSize: 10,
    fontWeight: '500',
    height: META_LINE_H,
    marginBottom: 2,
  },
});

function MainTabs() {
  const { t } = useTranslation();
  const { profile } = useSession();
  const hasPeerFollow = demoPeersForUser(profile?.id).length > 0;
  const peerName = demoPeersForUser(profile?.id)[0]?.name;
  const insets = useSafeAreaInsets();
  const mode = useThemeMode();
  void mode;
  const fontScale = useFontScaleMultiplier();
  const headerTitleFont = Math.round(20 * fontScale);
  const bottomPad = tabBarBottomPad(insets.bottom);
  const contentBottomPad = TAB_BAR_HEIGHT + META_LINE_H + bottomPad + 8;
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
      tabBar={(props) => <FlyFamTabBar {...props} />}
      safeAreaInsets={{ top: 0, bottom: 0, left: 0, right: 0 }}
      screenOptions={{
        ...screenOptions,
        tabBarShowLabel: false,
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
            title: peerName || 'Crew',
            tabBarAccessibilityLabel: peerName || 'Crew follow',
          }}
        />
      ) : null}
      <Tab.Screen
        name="Family"
        component={Family}
        options={{
          headerShown: true,
          title: t('nav.family'),
          tabBarAccessibilityLabel: t('nav.family'),
        }}
      />
      <Tab.Screen
        name="Profile"
        component={Profile}
        options={{
          headerShown: true,
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
