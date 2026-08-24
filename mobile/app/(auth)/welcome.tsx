import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { changeAppLocale, type Locale } from '@/lib/i18n';

export default function Welcome() {
  const router = useRouter();
  const { t, i18n } = useTranslation();
  const isTr = String(i18n.language ?? '').toLowerCase().startsWith('tr');

  const switchLanguage = () => {
    changeAppLocale((isTr ? 'en' : 'tr') as Locale);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t('welcome.title')}</Text>
      <Text style={styles.subtitle}>{t('welcome.subtitle')}</Text>

      <TouchableOpacity
        style={styles.button}
        onPress={() => router.push('/(auth)/sign-in')}
      >
        <Text style={styles.buttonText}>{t('welcome.signIn')}</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.button, styles.buttonOutline]}
        onPress={() => router.push('/(auth)/sign-up')}
      >
        <Text style={styles.buttonOutlineText}>{t('welcome.signUp')}</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.languageSwitch} onPress={switchLanguage}>
        <Text style={styles.languageSwitchText}>
          {isTr ? t('profile.languageEnglish') : t('profile.languageTurkish')}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    backgroundColor: '#0a0a0a',
  },
  title: {
    fontSize: 36,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#a1a1aa',
    textAlign: 'center',
    marginBottom: 48,
  },
  button: {
    width: '100%',
    padding: 16,
    backgroundColor: '#22c55e',
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 12,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  buttonOutline: {
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderColor: '#3f3f46',
  },
  buttonOutlineText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  languageSwitch: {
    marginTop: 24,
    paddingVertical: 12,
    paddingHorizontal: 20,
  },
  languageSwitchText: {
    color: '#a1a1aa',
    fontSize: 15,
    fontWeight: '600',
  },
});
