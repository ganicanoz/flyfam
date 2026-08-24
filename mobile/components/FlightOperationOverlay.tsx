import { useEffect, useRef } from 'react';
import { ActivityIndicator, Animated, Modal, Platform, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';

type Props = {
  visible: boolean;
  message: string;
};

const STAGE_W = 216;
const STAGE_H = 96;
/** Bulut grubu sağdan sola; uçak sabit, göreli hız illüzyonu. */
const CLOUD_TRAVEL = STAGE_W + 72;

function CloudCluster({ scale = 1, opacity = 0.92 }: { scale?: number; opacity?: number }) {
  const s = scale;
  return (
    <View style={[cloudStyles.row, { transform: [{ scale: s }] }]}>
      <View style={[cloudStyles.puff, { width: 26 * s, height: 16 * s, borderRadius: 10 * s, opacity }]} />
      <View
        style={[
          cloudStyles.puff,
          {
            width: 34 * s,
            height: 22 * s,
            borderRadius: 12 * s,
            marginLeft: -11 * s,
            opacity: opacity * 0.95,
          },
        ]}
      />
      <View
        style={[
          cloudStyles.puff,
          {
            width: 20 * s,
            height: 14 * s,
            borderRadius: 8 * s,
            marginLeft: -9 * s,
            opacity,
          },
        ]}
      />
    </View>
  );
}

const cloudStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end' },
  puff: { backgroundColor: '#FFFFFF' },
});

/**
 * Tam ekran yarı saydam overlay: uçak sabit, arka planda bulutlar kayar (bulutların içinden gidiyor hissi).
 */
export default function FlightOperationOverlay({ visible, message }: Props) {
  const cNear = useRef(new Animated.Value(0)).current;
  const cMid = useRef(new Animated.Value(0)).current;
  const cFar = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) {
      cNear.setValue(0);
      cMid.setValue(0);
      cFar.setValue(0);
      return;
    }
    const loop = (v: Animated.Value, duration: number, delayMs: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delayMs),
          Animated.timing(v, { toValue: 1, duration, useNativeDriver: true }),
          Animated.timing(v, { toValue: 0, duration: 0, useNativeDriver: true }),
        ]),
      );
    const a = loop(cNear, 2600, 0);
    const b = loop(cMid, 3400, 500);
    const c = loop(cFar, 4200, 200);
    a.start();
    b.start();
    c.start();
    return () => {
      a.stop();
      b.stop();
      c.stop();
    };
  }, [visible, cNear, cMid, cFar]);

  const xNear = cNear.interpolate({ inputRange: [0, 1], outputRange: [CLOUD_TRAVEL * 0.15, -CLOUD_TRAVEL] });
  const xMid = cMid.interpolate({ inputRange: [0, 1], outputRange: [CLOUD_TRAVEL * 0.45, -CLOUD_TRAVEL * 0.92] });
  const xFar = cFar.interpolate({ inputRange: [0, 1], outputRange: [CLOUD_TRAVEL * 0.65, -CLOUD_TRAVEL * 0.78] });

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent>
      <View style={styles.backdrop} pointerEvents="box-none">
        <View style={styles.card}>
          <View style={styles.skyStage}>
            <View style={styles.skyTint} />
            <View style={styles.cloudsSlot} pointerEvents="none">
              <Animated.View style={[styles.cloudLine, styles.cloudFar, { transform: [{ translateX: xFar }] }]}>
                <CloudCluster scale={0.72} opacity={0.55} />
              </Animated.View>
              <Animated.View style={[styles.cloudLine, styles.cloudMid, { transform: [{ translateX: xMid }] }]}>
                <CloudCluster scale={0.88} opacity={0.72} />
              </Animated.View>
              <Animated.View style={[styles.cloudLine, styles.cloudNear, { transform: [{ translateX: xNear }] }]}>
                <CloudCluster scale={1} opacity={0.88} />
              </Animated.View>
            </View>
            <View style={styles.planeLayer} pointerEvents="none">
              <Ionicons name="airplane" size={44} color={colors.primary} />
            </View>
          </View>
          <Text style={styles.message}>{message}</Text>
          <ActivityIndicator style={styles.spinner} size="small" color={colors.primary} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.48)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    paddingVertical: 28,
    paddingHorizontal: 24,
    alignItems: 'center',
    maxWidth: 320,
    width: '100%',
    borderWidth: 1,
    borderColor: colors.border,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.2,
        shadowRadius: 16,
      },
      android: { elevation: 12 },
    }),
  },
  skyStage: {
    width: STAGE_W,
    height: STAGE_H,
    borderRadius: 14,
    overflow: 'hidden',
    alignSelf: 'center',
    backgroundColor: '#B8D9F0',
  },
  skyTint: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(147, 197, 236, 0.35)',
  },
  cloudsSlot: {
    ...StyleSheet.absoluteFillObject,
  },
  cloudLine: {
    position: 'absolute',
    left: 0,
  },
  cloudFar: { top: 18 },
  cloudMid: { top: 38 },
  cloudNear: { top: 52 },
  planeLayer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  message: {
    marginTop: 18,
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    textAlign: 'center',
    lineHeight: 22,
  },
  spinner: { marginTop: 16 },
});
