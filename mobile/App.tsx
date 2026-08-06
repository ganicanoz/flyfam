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
import * as SplashScreen from 'expo-splash-screen';
import { View, ActivityIndicator, StyleSheet, ImageBackground, Platform } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { SessionProvider, useSession } from './contexts/SessionContext';
import { AdminRosterProvider, useAdminRoster } from './contexts/AdminRosterContext';
import { colors, loadStoredThemeMode, useThemeMode } from './theme/colors';
import { loadStoredFontSizePreset, useFontScaleMultiplier } from './theme/fontScale';

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

function MainTabs() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const mode = useThemeMode();
  void mode;
  const fontScale = useFontScaleMultiplier();
  const headerTitleFont = Math.round(20 * fontScale);
  const tabLabelFont = Math.round(12 * fontScale);
  const floatBottom = Math.max(insets.bottom, 10) + 6;
  const screenOptions = {
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
  };
  return (
    <Tab.Navigator
      screenOptions={{
        ...screenOptions,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        sceneStyle: {
          backgroundColor: 'transparent',
          paddingBottom: 72 + floatBottom,
        },
        tabBarStyle: {
          position: 'absolute',
          left: 14,
          right: 14,
          bottom: floatBottom,
          height: 64,
          borderRadius: 22,
          backgroundColor: colors.surface,
          borderTopWidth: 0,
          borderWidth: 1,
          borderColor: colors.border,
          paddingTop: 6,
          paddingBottom: 8,
          elevation: 12,
          shadowColor: '#0f172a',
          shadowOpacity: 0.18,
          shadowRadius: 16,
          shadowOffset: { width: 0, height: 8 },
        },
        tabBarItemStyle: { borderRightWidth: 0 },
        tabBarLabelStyle: { fontSize: tabLabelFont, fontWeight: '700' },
      }}
    >
      <Tab.Screen
        name="Roster"
        component={RosterTabScreen}
        options={{
          tabBarLabel: t('nav.rosterTab'),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="calendar-outline" size={size ?? 24} color={color} />
          ),
          headerShown: true,
          title: t('nav.roster'),
        }}
      />
      <Tab.Screen
        name="Family"
        component={Family}
        options={{
          headerShown: true,
          title: t('nav.family'),
          tabBarLabel: t('nav.family'),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="people-outline" size={size ?? 24} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="Profile"
        component={Profile}
        options={{
          headerShown: true,
          title: t('nav.profile'),
          tabBarLabel: t('nav.profile'),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="person-outline" size={size ?? 24} color={color} />
          ),
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
            options={withStackBackButton({ title: t('nav.addFlight'), headerBackTitle: t('common.back') })}
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

  return body;
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
    <SafeAreaProvider>
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
            opacity: mode === 'dark' ? 0.14 : 0.2,
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
