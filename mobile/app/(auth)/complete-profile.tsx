import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSession } from '@/contexts/SessionContext';
import { supabase } from '@/lib/supabase';

export default function CompleteProfile() {
  const [companyName, setCompanyName] = useState('');
  const [loading, setLoading] = useState(false);
  const { profile, refreshProfile } = useSession();
  const router = useRouter();

  const isCrew = profile?.role === 'crew';

  const handleComplete = async () => {
    if (isCrew && !companyName.trim()) {
      Alert.alert('Error', 'Please enter your airline/company');
      return;
    }

    setLoading(true);

    if (isCrew) {
      const { error } = await supabase.rpc('create_crew_profile', {
        p_company_name: companyName.trim(),
        p_time_preference: 'local',
      });

      if (error) {
        setLoading(false);
        Alert.alert('Error', error.message);
        return;
      }
    }

    await refreshProfile();
    setLoading(false);

    if (isCrew) {
      router.replace('/(app)/(crew)/roster');
    } else {
      router.replace('/(app)/(family)/dashboard');
    }
  };

  if (!profile) {
    return null;
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <Text style={styles.title}>Complete setup</Text>
      <Text style={styles.subtitle}>
        {isCrew
          ? "Enter your airline or company (e.g. Pegasus Airlines, AJet)"
          : "You're all set. Connect to a crew member to get started."}
      </Text>

      {isCrew && (
        <TextInput
          style={styles.input}
          placeholder="Airline / Company (e.g. Pegasus, AJet)"
          placeholderTextColor="#71717a"
          value={companyName}
          onChangeText={setCompanyName}
          editable={!loading}
        />
      )}

      <TouchableOpacity
        style={[styles.button, loading && styles.buttonDisabled]}
        onPress={handleComplete}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>Continue</Text>
        )}
      </TouchableOpacity>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    backgroundColor: '#0a0a0a',
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#fff',
    marginTop: 80,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 16,
    color: '#a1a1aa',
    marginBottom: 32,
  },
  input: {
    backgroundColor: '#18181b',
    borderRadius: 12,
    padding: 16,
    color: '#fff',
    fontSize: 16,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: '#27272a',
  },
  button: {
    backgroundColor: '#22c55e',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
