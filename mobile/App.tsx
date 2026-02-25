import React, { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import * as SplashScreen from 'expo-splash-screen';
import { View, ActivityIndicator, StyleSheet, Text, ImageBackground, Image } from 'react-native';
import { SessionProvider, useSession } from './contexts/SessionContext';
import { colors } from './theme/colors';

import Welcome from './screens/Welcome';
import SignIn from './screens/SignIn';
import SignUp from './screens/SignUp';
import CompleteProfile from './screens/CompleteProfile';
import Roster from './screens/Roster';
import AddFlight from './screens/AddFlight';
import EditFlight from './screens/EditFlight';
import Family from './screens/Family';
import Profile from './screens/Profile';
import Connect from './screens/Connect';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

const screenOptions = {
  headerStyle: { backgroundColor: colors.primary },
  headerTintColor: colors.white,
  headerTitleStyle: { fontWeight: '800', fontSize: 20 },
  // Keep navigation backgrounds transparent so global ImageBackground is visible.
  contentStyle: { backgroundColor: 'transparent' },
};

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        ...screenOptions,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        sceneContainerStyle: { backgroundColor: 'transparent' },
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          borderTopWidth: 1,
          height: 74,
          paddingTop: 10,
          paddingBottom: 10,
        },
        tabBarLabelStyle: { fontSize: 13, fontWeight: '700' },
      }}
    >
      <Tab.Screen
        name="Roster"
        component={Roster}
        options={{
          tabBarLabel: 'Roster',
          tabBarItemStyle: { borderRightColor: colors.border, borderRightWidth: 1 },
          tabBarIcon: ({ color }) => (
            <Image
              source={require('./assets/tab-icon-roster.png')}
              style={{ width: 26, height: 26, tintColor: color }}
              resizeMode="contain"
            />
          ),
          headerShown: true,
          title: 'Roster',
        }}
      />
      <Tab.Screen
        name="Family"
        component={Family}
        options={{
          tabBarLabel: 'Family',
          tabBarItemStyle: { borderRightColor: colors.border, borderRightWidth: 1 },
          tabBarIcon: ({ color }) => (
            <Image
              source={require('./assets/tab-icon-family.png')}
              style={{ width: 26, height: 26, tintColor: color }}
              resizeMode="contain"
            />
          ),
        }}
      />
      <Tab.Screen
        name="Profile"
        component={Profile}
        options={{
          tabBarLabel: 'Profile',
          tabBarItemStyle: { borderRightWidth: 0 },
          tabBarIcon: ({ color }) => (
            <Image
              source={require('./assets/tab-icon-profile.png')}
              style={{ width: 28, height: 28, tintColor: color }}
              resizeMode="contain"
            />
          ),
        }}
      />
    </Tab.Navigator>
  );
}

function RootNavigator() {
  const { session, profile, crewProfile, isLoading } = useSession();

  useEffect(() => {
    if (!isLoading) SplashScreen.hideAsync();
  }, [isLoading]);

  if (isLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!session || !profile) {
    return (
      <Stack.Navigator screenOptions={{ ...screenOptions, headerShown: false }}>
        <Stack.Screen name="Welcome" component={Welcome} />
        <Stack.Screen name="SignIn" component={SignIn} />
        <Stack.Screen name="SignUp" component={SignUp} />
      </Stack.Navigator>
    );
  }

  if (profile.role === 'crew' && !crewProfile) {
    return (
      <Stack.Navigator screenOptions={screenOptions}>
        <Stack.Screen name="CompleteProfile" component={CompleteProfile} options={{ title: 'Complete setup' }} />
      </Stack.Navigator>
    );
  }

  return (
    <Stack.Navigator screenOptions={screenOptions}>
      <Stack.Screen
        name="Main"
        component={MainTabs}
        options={{ headerShown: false }}
      />
      <Stack.Screen name="AddFlight" component={AddFlight} options={{ title: 'Add Flight' }} />
      <Stack.Screen name="EditFlight" component={EditFlight} options={{ title: 'Edit Flight' }} />
      <Stack.Screen name="Connect" component={Connect} options={{ title: 'Invitations' }} />
    </Stack.Navigator>
  );
}

export default function App() {
  const navTheme = {
    ...DefaultTheme,
    colors: {
      ...DefaultTheme.colors,
      background: 'transparent',
      card: 'transparent',
    },
  };
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SessionProvider>
        <StatusBar style="light" backgroundColor={colors.primary} />
        <ImageBackground
          source={require('./assets/aviation-bg-landing.png')}
          style={{ flex: 1 }}
          imageStyle={{
            opacity: 0.20,
            // Move runway/aircraft up so it sits above the tab bar.
            transform: [{ translateY: 10 }],
          }}
          resizeMode="cover"
        >
          <NavigationContainer theme={navTheme as any}>
            <RootNavigator />
          </NavigationContainer>
        </ImageBackground>
      </SessionProvider>
    </GestureHandlerRootView>
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
