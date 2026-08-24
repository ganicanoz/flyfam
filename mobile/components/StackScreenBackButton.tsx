import { StyleSheet, View } from 'react-native';
import { TouchableOpacity } from 'react-native-gesture-handler';
import { useTranslation } from 'react-i18next';
import { colors } from '../theme/colors';
import { useStackGoBack } from '../lib/useStackGoBack';

type Props = {
  onPress?: () => void;
  color?: string;
};

/** Header sol daire / hit alanı (iOS native chrome ~44). */
const HIT = 44;
/** Chevron kenar uzunluğu (rotate öncesi). */
const ARM = 12;
const STROKE = 2.5;

/**
 * Header geri — Ionicons glifi em-box’ta kayık olduğu için
 * border ile çizilen geometrik “‹” kullanılıyor; daire içinde tam orta.
 */
export function StackScreenBackButton({ onPress, color }: Props) {
  const { t } = useTranslation();
  const goBack = useStackGoBack();
  const tint = color ?? colors.onPrimary;

  return (
    <TouchableOpacity
      onPress={onPress ?? goBack}
      activeOpacity={0.65}
      hitSlop={8}
      style={styles.hit}
      accessibilityRole="button"
      accessibilityLabel={t('common.back')}
    >
      <View style={[styles.chevron, { borderColor: tint }]} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  hit: {
    width: HIT,
    height: HIT,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  /**
   * Sol-alt kenarlı kare → 45° = “‹”.
   * Rotate sonrası: yatayda sağa (marginLeft), dikeyde yukarı (marginTop).
   */
  chevron: {
    width: ARM,
    height: ARM,
    borderLeftWidth: STROKE,
    borderBottomWidth: STROKE,
    backgroundColor: 'transparent',
    transform: [{ rotate: '45deg' }],
    marginLeft: 3,
    marginTop: -4.5,
  },
});
