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
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeBottomTabNavigator } from '@bottom-tabs/react-navigation';
import * as SplashScreen from 'expo-splash-screen';
import {
  View,
  ActivityIndicator,
  StyleSheet,
  ImageBackground,
  Platform,
} from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets, initialWindowMetrics } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { SessionProvider, useSession } from './contexts/SessionContext';
import { AdminRosterProvider, useAdminRoster } from './contexts/AdminRosterContext';
import { colors, loadStoredThemeMode, useThemeMode } from './theme/colors';
import { loadStoredFontSizePreset } from './theme/fontScale';
import { demoPeersForUser, peerTabShortLabel, hydrateDismissedPeers, hydrateCrewPeersFromServer, subscribeDismissedPeers, subscribeCrewPeers } from './lib/crewPeerDemo';

import Welcome from './screens/Welcome';
import SignIn from './screens/SignIn';
import SignUp from './screens/SignUp';
import ResetPassword from './screens/ResetPassword';
import CompleteProfile from './screens/CompleteProfile';
import Roster from './screens/Roster';
import AddFlight from './screens/AddFlight';
import EditFlight from './screens/EditFlight';
import EditDuty from './screens/EditDuty';
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
import { BrandSplashOverlay } from './components/BrandSplashOverlay';
import {
  fetchAppReleasePolicy,
  isUpdateRequired,
  type AppReleasePolicy,
} from './lib/appReleasePolicy';
import {
  hydrateOccupationCatalogFromStorage,
  refreshOccupationCatalog,
} from './lib/rosterOccupationCatalog';
import { hydrateLocalOccupationOverrides } from './lib/rosterOccupationLocalOverrides';

/**
 * Platform native tabs (iOS UITabBar / Android Material3).
 * Web keeps JS bottom tabs (no native host).
 */
const NativeTab = createNativeBottomTabNavigator();
const WebTab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

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

const TAB_SF: Record<string, string> = {
  Roster: 'list.bullet',
  PeerRoster: 'calendar',
  Family: 'person.2',
  Profile: 'person',
};

const TAB_ANDROID_ICON: Record<string, number> = {
  Roster: require('./assets/tab-icons/list.png'),
  PeerRoster: require('./assets/tab-icons/calendar.png'),
  Family: require('./assets/tab-icons/people.png'),
  Profile: require('./assets/tab-icons/person.png'),
};

const TAB_WEB_ICONS: Record<
  string,
  { active: React.ComponentProps<typeof Ionicons>['name']; inactive: React.ComponentProps<typeof Ionicons>['name'] }
> = {
  Roster: { active: 'list', inactive: 'list-outline' },
  PeerRoster: { active: 'calendar', inactive: 'calendar-outline' },
  Family: { active: 'people', inactive: 'people-outline' },
  Profile: { active: 'person', inactive: 'person-outline' },
};

function useMainTabMeta() {
  const { t } = useTranslation();
  const { profile } = useSession();
  const [peerTick, setPeerTick] = React.useState(0);
  React.useEffect(() => {
    void hydrateDismissedPeers().then(() => setPeerTick((n) => n + 1));
    return subscribeDismissedPeers(() => setPeerTick((n) => n + 1));
  }, []);
  React.useEffect(() => {
    if (!profile?.id) return;
    void hydrateCrewPeersFromServer(profile.id);
    return subscribeCrewPeers(() => setPeerTick((n) => n + 1));
  }, [profile?.id]);
  const peers = React.useMemo(() => demoPeersForUser(profile?.id), [profile?.id, peerTick]);
  const hasPeerFollow = peers.length > 0;
  const peerName = peers[0]?.name ?? '';
  const peerTabTitle = peerName ? peerTabShortLabel(peerName) : 'Crew';
  const insets = useSafeAreaInsets();
  const mode = useThemeMode();
  const isDark = mode === 'dark';
  const screenOptions = React.useMemo(
    () => ({
      headerStyle: {
        backgroundColor: colors.primary,
        height: 52 + Math.max(insets.top, 0),
      },
      headerStatusBarHeight: Math.max(insets.top, 0),
      headerTintColor: colors.onPrimary,
      headerTitleStyle: { fontWeight: '800' as const, fontSize: 20 },
      headerLeftContainerStyle: { paddingLeft: 8 },
      headerRightContainerStyle: { paddingRight: 8 },
      contentStyle: { backgroundColor: 'transparent' },
    }),
    [insets.top],
  );
  return { t, hasPeerFollow, peerTabTitle, isDark, screenOptions };
}

function MainTabs() {
  if (Platform.OS === 'web') {
    return <WebMainTabs />;
  }
  return <NativeMainTabs />;
}

function NativeMainTabs() {
  const { t, hasPeerFollow, peerTabTitle, isDark } = useMainTabMeta();
  return (
    <NativeTab.Navigator
      labeled
      translucent
      hapticFeedbackEnabled
      tabBarActiveTintColor={isDark ? colors.text : colors.primary}
      tabBarInactiveTintColor={colors.textMuted}
      activeIndicatorColor={isDark ? colors.surfaceAlt : colors.primaryLight}
      screenOptions={{
        sceneStyle: { backgroundColor: colors.background },
      }}
    >
      <NativeTab.Screen
        name="Roster"
        component={RosterTabScreen}
        options={{
          title: t('nav.roster'),
          tabBarLabel: t('nav.rosterTab'),
          tabBarIcon: () =>
            Platform.OS === 'ios'
              ? { sfSymbol: TAB_SF.Roster as any }
              : TAB_ANDROID_ICON.Roster,
        }}
      />
      {hasPeerFollow ? (
        <NativeTab.Screen
          name="PeerRoster"
          component={PeerRosterTabScreen}
          options={{
            title: peerTabTitle,
            tabBarLabel: peerTabTitle,
            tabBarIcon: () =>
              Platform.OS === 'ios'
                ? { sfSymbol: TAB_SF.PeerRoster as any }
                : TAB_ANDROID_ICON.PeerRoster,
          }}
        />
      ) : null}
      <NativeTab.Screen
        name="Family"
        component={Family}
        options={{
          title: t('nav.family'),
          tabBarLabel: t('nav.family'),
          tabBarIcon: () =>
            Platform.OS === 'ios'
              ? { sfSymbol: TAB_SF.Family as any }
              : TAB_ANDROID_ICON.Family,
        }}
      />
      <NativeTab.Screen
        name="Profile"
        component={Profile}
        options={{
          title: t('nav.profile'),
          tabBarLabel: t('nav.profile'),
          tabBarIcon: () =>
            Platform.OS === 'ios'
              ? { sfSymbol: TAB_SF.Profile as any }
              : TAB_ANDROID_ICON.Profile,
        }}
      />
    </NativeTab.Navigator>
  );
}

function WebMainTabs() {
  const { t, hasPeerFollow, peerTabTitle, isDark, screenOptions } = useMainTabMeta();
  return (
    <WebTab.Navigator
      screenOptions={({ route }) => ({
        ...screenOptions,
        tabBarShowLabel: true,
        tabBarActiveTintColor: isDark ? colors.text : colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
        },
        sceneStyle: { backgroundColor: colors.background },
        tabBarIcon: ({ focused, color, size }) => {
          const set = TAB_WEB_ICONS[route.name] ?? { active: 'ellipse' as const, inactive: 'ellipse-outline' as const };
          return <Ionicons name={focused ? set.active : set.inactive} size={size} color={color} />;
        },
      })}
    >
      <WebTab.Screen
        name="Roster"
        component={RosterTabScreen}
        options={{
          title: t('nav.roster'),
          tabBarAccessibilityLabel: t('nav.rosterTab'),
          headerShown: false,
        }}
      />
      {hasPeerFollow ? (
        <WebTab.Screen
          name="PeerRoster"
          component={PeerRosterTabScreen}
          options={{
            headerShown: false,
            title: peerTabTitle,
            tabBarAccessibilityLabel: peerTabTitle,
          }}
        />
      ) : null}
      <WebTab.Screen
        name="Family"
        component={Family}
        options={{
          headerShown: false,
          title: t('nav.family'),
          tabBarAccessibilityLabel: t('nav.family'),
        }}
      />
      <WebTab.Screen
        name="Profile"
        component={Profile}
        options={{
          headerShown: false,
          title: t('nav.profile'),
          tabBarAccessibilityLabel: t('nav.profile'),
        }}
      />
    </WebTab.Navigator>
  );
}

function RootNavigator() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { session, profile, crewProfile, isLoading, needsPasswordUpdate } = useSession();
  const [consentCheck, setConsentCheck] = useState<'unknown' | 'required' | 'ok'>('unknown');
  const [releasePolicy, setReleasePolicy] = useState<AppReleasePolicy | null>(null);
  const [forceUpdateChecked, setForceUpdateChecked] = useState(false);
  const [brandSplashVisible, setBrandSplashVisible] = useState(Platform.OS !== 'web');
  /** Cap splash hang: profile (live or disk cache) is enough to leave splash. */
  const splashBusy = isLoading && !profile;
  const mode = useThemeMode();
  void mode;

  const screenOptions = {
    headerStyle: {
      backgroundColor: colors.primary,
      height: 52 + Math.max(insets.top, 0),
    },
    headerStatusBarHeight: Math.max(insets.top, 0),
    headerTintColor: colors.onPrimary,
    headerTitleStyle: { fontWeight: '800' as const, fontSize: 20 },
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

  // Handoff: JS splash mirrors LaunchScreen → hide native splash once overlay is up.
  useEffect(() => {
    if (Platform.OS === 'web' || !brandSplashVisible) return;
    void SplashScreen.hideAsync();
  }, [brandSplashVisible]);

  useEffect(() => {
    if (isLoading || Platform.OS === 'web') {
      if (!isLoading) setForceUpdateChecked(true);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        await hydrateOccupationCatalogFromStorage();
        await hydrateLocalOccupationOverrides();
        void refreshOccupationCatalog();
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
        <Stack.Screen name="SignIn" component={SignIn} options={{ headerShown: false }} />
        <Stack.Screen name="SignUp" component={SignUp} options={{ headerShown: false }} />
        <Stack.Screen name="PrivacyNotice" component={PrivacyNotice} options={{ headerShown: false }} />
        <Stack.Screen name="TermsDisclaimer" component={TermsDisclaimer} options={{ headerShown: false }} />
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
    // Profil henüz gelmedi — cache de yoksa kısa spinner (splash timeout ile isLoading false olur).
    body = (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  } else if (consentCheck === 'unknown' && session && profile) {
    // Consent check in flight — don't flash Consent/Main.
    body = (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
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
        <Stack.Screen name="PrivacyNotice" component={PrivacyNotice} options={{ headerShown: false }} />
        <Stack.Screen name="TermsDisclaimer" component={TermsDisclaimer} options={{ headerShown: false }} />
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
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="EditFlight"
            component={EditFlight}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="EditDuty"
            component={EditDuty}
            options={{ headerShown: false }}
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
            options={{ headerShown: false }}
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
            options={{ headerShown: false }}
          />
          <Stack.Screen name="PrivacyNotice" component={PrivacyNotice} options={{ headerShown: false }} />
          <Stack.Screen name="TermsDisclaimer" component={TermsDisclaimer} options={{ headerShown: false }} />
        </Stack.Navigator>
      </AdminRosterProvider>
    );
  }

  const blockUpdate = forceUpdateChecked && isUpdateRequired(releasePolicy);

  return (
    <>
      {blockUpdate ? null : body}
      <ForceUpdateModal visible={blockUpdate} policy={releasePolicy} />
      {brandSplashVisible ? (
        <BrandSplashOverlay
          busy={splashBusy}
          onFinished={() => setBrandSplashVisible(false)}
        />
      ) : null}
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
