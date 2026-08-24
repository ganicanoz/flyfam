import { View, Text, TouchableOpacity, StyleSheet, ImageBackground, Image } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import { changeAppLocale, LOCALE_LABELS, type Locale } from '../lib/i18n';

export default function Welcome() {
  const { t, i18n } = useTranslation();
  const navigation = useNavigation<any>();
  const isTr = String(i18n.language ?? '').toLowerCase().startsWith('tr');

  return (
    <ImageBackground
      source={require('../assets/welcome-hero.png')}
      style={styles.background}
      resizeMode="cover"
      imageStyle={styles.backgroundImage}
    >
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.actions}>
            <TouchableOpacity
              style={styles.button}
              onPress={() => navigation.navigate('SignIn')}
            >
              <Text style={styles.buttonText}>{t('welcome.signIn')}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.button, styles.buttonOutline]}
              onPress={() => navigation.navigate('SignUp')}
            >
              <Text style={styles.buttonOutlineText}>{t('welcome.signUp')}</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.languageRow}>
            <TouchableOpacity
              style={[styles.langButton, styles.langButtonTr, isTr && styles.langButtonActive]}
              onPress={() => changeAppLocale('tr')}
            >
              <Text
                style={[styles.langButtonText, styles.langButtonTextTr, isTr && styles.langButtonTextActive]}
                numberOfLines={1}
                adjustsFontSizeToFit
              >
                {LOCALE_LABELS.tr}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.langButton, styles.langButtonEn, !isTr && styles.langButtonActive]}
              onPress={() => changeAppLocale('en')}
            >
              <Text
                style={[styles.langButtonText, styles.langButtonTextEn, !isTr && styles.langButtonTextActive]}
                numberOfLines={1}
                adjustsFontSizeToFit
              >
                {LOCALE_LABELS.en}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
        <View style={styles.bottomIconWrap}>
          <Image
            source={require('../assets/icon-1024.png')}
            style={styles.bottomIcon}
            resizeMode="contain"
            accessibilityLabel="FlyFam icon"
          />
        </View>
      </View>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  background: {
    flex: 1,
  },
  backgroundImage: {
    width: '100%',
    height: '100%',
    alignSelf: 'flex-end', // sağ kenarı sabit tut
  },
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    paddingHorizontal: 24,
    paddingTop: 40,
    paddingBottom: 200,
    backgroundColor: 'rgba(0,0,0,0)',
  },
  card: {
    backgroundColor: 'transparent',
    borderRadius: 0,
    paddingVertical: 16,
    paddingHorizontal: 18,
  },
  actions: {
    marginTop: 0,
  },
  button: {
    width: '100%',
    padding: 16,
    backgroundColor: 'rgba(255,255,255,0.96)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#111111',
    alignItems: 'center',
    marginBottom: 12,
  },
  buttonText: {
    color: '#111111',
    fontSize: 17,
    fontWeight: '700',
    fontFamily: 'SF Pro Rounded',
  },
  buttonOutline: {
    backgroundColor: 'rgba(255,255,255,0.96)',
  },
  buttonOutlineText: {
    color: '#111111',
    fontSize: 17,
    fontWeight: '700',
    fontFamily: 'SF Pro Rounded',
  },
  languageRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    width: '100%',
    marginTop: 12,
  },
  langButton: {
    flex: 1,
    height: 48,
    marginHorizontal: 6,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#111111',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  langButtonTr: {
    backgroundColor: 'rgba(255,255,255,0.96)',
  },
  langButtonEn: {
    backgroundColor: 'rgba(255,255,255,0.96)',
  },
  langButtonActive: {
    borderColor: '#111111',
    borderWidth: 2,
  },
  langButtonText: {
    fontSize: 16,
    fontWeight: '700',
    fontFamily: 'Inter',
    color: '#111111',
  },
  langButtonTextTr: {
    color: '#111111',
  },
  langButtonTextEn: {
    color: '#111111',
  },
  langButtonTextActive: {
    color: '#111111',
    fontWeight: '700',
  },
  bottomIconWrap: {
    position: 'absolute',
    bottom: 40,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  bottomIcon: {
    width: 58,
    height: 58,
    borderRadius: 12,
  },
});
