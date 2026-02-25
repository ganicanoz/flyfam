import { useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useSession } from '@/contexts/SessionContext';

export default function Index() {
  const { session, profile, crewProfile, isLoading } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;

    SplashScreen.hideAsync();

    if (!session) {
      router.replace('/(auth)/welcome');
      return;
    }

    if (!profile) {
      router.replace('/(auth)/welcome');
      return;
    }

    if (profile.role === 'crew' && !crewProfile) {
      router.replace('/(auth)/complete-profile');
      return;
    }

    if (profile.role === 'crew') {
      router.replace('/(app)/(crew)/roster');
    } else {
      router.replace('/(app)/(family)/dashboard');
    }
  }, [session, profile, crewProfile, isLoading, router]);

  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color="#22c55e" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0a0a0a',
  },
});
