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
  Animated,
  Pressable,
  Text,
} from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';
import { SessionProvider, useSession } from './contexts/SessionContext';
import { AdminRosterProvider, useAdminRoster } from './contexts/AdminRosterContext';
import { colors, loadStoredThemeMode, useThemeMode } from './theme/colors';
import { loadStoredFontSizePreset, useFontScaleMultiplier } from './theme/fontScale';
import {
  getRosterLastSyncedAt,
  subscribeRosterLastSyncedAt,
} from './lib/rosterSyncMeta';

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

/** Instagram floating tab ölçüleri (ekran kaydı / screenshot oranları @~390pt). */
const TAB_BAR_HEIGHT = 52;
const TAB_ICON_SIZE = 22;
/** Seçim blob: bar'dan küçük, yuvarlatilmis kare (daire degil), soft gri. */
const TAB_INDICATOR_W = 44;
const TAB_INDICATOR_H = 38;
const TAB_INDICATOR_RADIUS = 11;
/** Daha dar pill → yanlardan küçültülmüş floating bar. */
const TAB_SIDE_MARGIN = 68;
/** Capsule uclarinda ikonlarin kenara yapismamasi. */
const TAB_INNER_PAD_H = 14;

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

const TAB_ICONS: Record<
  string,
  { active: React.ComponentProps<typeof Ionicons>['name']; inactive: React.ComponentProps<typeof Ionicons>['name'] }
> = {
  Roster: { active: 'calendar', inactive: 'calendar-outline' },
  Family: { active: 'people', inactive: 'people-outline' },
  Profile: { active: 'person', inactive: 'person-outline' },
};

/** Instagram tarzı: liquid-glass pill + seçili ikonun arkasında kayan soft blob. */
function InstagramGlassTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const mode = useThemeMode();
  const isDark = mode === 'dark';
  const onTabBarHeightChange = React.useContext(BottomTabBarHeightCallbackContext);
  // Pill + meta: home indicator bölgesindeki boşluğa oturur.
  const metaLineH = 16;
  const floatBottom = Math.max(insets.bottom > 0 ? 6 : 10, 6);
  const tabCenters = React.useRef<number[]>(state.routes.map(() => 0));
  const indicatorX = React.useRef(new Animated.Value(0)).current;
  const indicatorReady = React.useRef(false);
  const [lastSyncedAt, setLastSyncedAt] = React.useState<number | null>(() => getRosterLastSyncedAt());

  React.useEffect(() => {
    onTabBarHeightChange?.(0);
  }, [onTabBarHeightChange]);

  React.useEffect(() => subscribeRosterLastSyncedAt(() => setLastSyncedAt(getRosterLastSyncedAt())), []);

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

  const metaText = React.useMemo(() => {
    if (lastSyncedAt == null) return t('nav.lastUpdatedPending');
    const locale = i18n.language === 'tr' ? 'tr-TR' : 'en-US';
    const when = new Date(lastSyncedAt).toLocaleString(locale, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    return t('nav.lastUpdatedAt', { when });
  }, [lastSyncedAt, i18n.language, t]);

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
      {/* Gölge overflow:hidden ile kesilmesin diye ayrı dış kabuk */}
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
                  backgroundColor: isDark ? 'rgba(255,255,255,0.14)' : '#E2E2E2',
                  top: (TAB_BAR_HEIGHT - TAB_INDICATOR_H) / 2,
                  transform: [{ translateX: indicatorX }],
                },
              ]}
            />
            {state.routes.map((route, index) => {
              const focused = state.index === index;
              const { options } = descriptors[route.key];
              const iconSet = TAB_ICONS[route.name] ?? { active: 'ellipse', inactive: 'ellipse-outline' };
              const color = focused
                ? isDark
                  ? '#F8FAFC'
                  : '#0F172A'
                : isDark
                  ? 'rgba(226,232,240,0.55)'
                  : '#64748B';

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
                    accessibilityLabel={options.tabBarAccessibilityLabel ?? options.title ?? route.name}
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
                    <Ionicons
                      name={focused ? iconSet.active : iconSet.inactive}
                      size={TAB_ICON_SIZE}
                      color={color}
                    />
                  </Pressable>
                </React.Fragment>
              );
            })}
          </View>
        </View>
      </View>
      <Text
        style={[
          igTabStyles.metaLine,
          {
            height: metaLineH,
            color: isDark ? 'rgba(226,232,240,0.45)' : 'rgba(100,116,139,0.75)',
          },
        ]}
        numberOfLines={1}
        pointerEvents="none"
      >
        {metaText}
      </Text>
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
    alignItems: 'center',
    justifyContent: 'center',
  },
  sep: {
    width: StyleSheet.hairlineWidth * 2,
    height: 22,
    borderRadius: 1,
    alignSelf: 'center',
  },
  metaLine: {
    textAlign: 'center',
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.1,
  },
});

function MainTabs() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const mode = useThemeMode();
  const isDark = mode === 'dark';
  const fontScale = useFontScaleMultiplier();
  const headerTitleFont = Math.round(20 * fontScale);
  const floatBottom = Math.max(insets.bottom > 0 ? 6 : 10, 6);
  const contentBottomPad = TAB_BAR_HEIGHT + 4 + 16 + floatBottom + 8;
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
      tabBar={(props) => <InstagramGlassTabBar {...props} />}
      safeAreaInsets={{ top: 0, bottom: 0, left: 0, right: 0 }}
      screenOptions={{
        ...screenOptions,
        tabBarShowLabel: false,
        tabBarActiveTintColor: isDark ? '#F8FAFC' : '#0F172A',
        tabBarInactiveTintColor: isDark ? 'rgba(226,232,240,0.55)' : '#64748B',
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
