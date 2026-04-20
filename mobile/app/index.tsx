import { useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useSession } from '@/contexts/SessionContext';
import { hasRequiredConsents } from '@/lib/consents';

export default function Index() {
  const { session, profile, crewProfile, isLoading } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;

    let cancelled = false;
    const route = async () => {
      await SplashScreen.hideAsync();

      if (!session) {
        router.replace('/(auth)/welcome');
        return;
      }

      if (!profile) {
        router.replace('/(auth)/welcome');
        return;
      }

      const hasConsents = await hasRequiredConsents(profile.id);
      if (!cancelled && !hasConsents) {
        router.replace('/(auth)/consent');
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
    };
    route();
    return () => {
      cancelled = true;
    };
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
