import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Image,
  StyleSheet,
  Text,
  View,
  useColorScheme,
  ActivityIndicator,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import Constants from 'expo-constants';
import {
  SPLASH_BG_DARK,
  SPLASH_BG_LIGHT,
  splashIconAsset,
  splashLogoSizePx,
  splashWordmarkAsset,
  splashWordmarkMonoAsset,
} from '../constants/splashBrand';
import { colors } from '../theme/colors';

type Props = {
  /** Session / bootstrap still running */
  busy: boolean;
  /** Called after exit animation finishes (or immediately if already gone) */
  onFinished: () => void;
};

/**
 * JS splash that mirrors LaunchScreen, then scale+fade into the app.
 * Native splash stays until this mounts; then we hide it for a seamless handoff.
 */
export function BrandSplashOverlay({ busy, onFinished }: Props) {
  const { t } = useTranslation();
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  const bg = isDark ? SPLASH_BG_DARK : SPLASH_BG_LIGHT;
  const wordmark = isDark ? splashWordmarkMonoAsset : splashWordmarkAsset;

  const opacity = useRef(new Animated.Value(1)).current;
  const scale = useRef(new Animated.Value(1)).current;
  const iconLift = useRef(new Animated.Value(0)).current;
  const [showSlowHint, setShowSlowHint] = useState(false);
  const finishedRef = useRef(false);
  const [logoW, setLogoW] = useState(120);

  useEffect(() => {
    // Soft entrance: icon sits ~20pt higher than dead-center stack.
    Animated.timing(iconLift, {
      toValue: 1,
      duration: 420,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [iconLift]);

  useEffect(() => {
    if (!busy) return;
    const id = setTimeout(() => setShowSlowHint(true), 1000);
    return () => clearTimeout(id);
  }, [busy]);

  useEffect(() => {
    if (busy || finishedRef.current) return;
    finishedRef.current = true;
    Animated.parallel([
      Animated.timing(scale, {
        toValue: 1.08,
        duration: 380,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 0,
        duration: 420,
        delay: 80,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished) onFinished();
    });
  }, [busy, opacity, scale, onFinished]);

  const liftY = iconLift.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -20],
  });

  const version =
    Constants.expoConfig?.version ??
    Constants.nativeAppVersion ??
    '';

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.root, { backgroundColor: bg, opacity }]}
      onLayout={(e) => setLogoW(splashLogoSizePx(e.nativeEvent.layout.width))}
    >
      <Animated.View
        style={[
          styles.stack,
          {
            transform: [{ translateY: liftY }, { scale }],
          },
        ]}
      >
        <Image
          source={splashIconAsset}
          style={{ width: logoW, height: logoW }}
          resizeMode="contain"
          accessibilityIgnoresInvertColors
        />
        <Image
          source={wordmark}
          style={[styles.wordmark, { width: logoW, height: Math.round(logoW * 0.28) }]}
          resizeMode="contain"
          accessibilityIgnoresInvertColors
        />
        <Text
          style={[
            styles.tagline,
            { color: isDark ? 'rgba(243,246,251,0.55)' : colors.textMuted },
          ]}
        >
          {t('splash.tagline')}
        </Text>
      </Animated.View>

      <View style={styles.footer} pointerEvents="none">
        {showSlowHint && busy ? (
          <View style={styles.slowRow}>
            <ActivityIndicator size="small" color={isDark ? '#9AA8BC' : colors.textMuted} />
            <Text style={[styles.slowText, { color: isDark ? '#9AA8BC' : colors.textMuted }]}>
              {t('common.loading')}
            </Text>
          </View>
        ) : null}
        {version ? (
          <Text style={[styles.version, { color: isDark ? 'rgba(154,168,188,0.55)' : 'rgba(107,114,128,0.55)' }]}>
            v{version}
          </Text>
        ) : null}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 9999,
    elevation: 9999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stack: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    marginBottom: 48,
  },
  wordmark: {
    marginTop: 2,
  },
  tagline: {
    marginTop: 10,
    fontSize: 13,
    fontWeight: '500',
    textAlign: 'center',
    paddingHorizontal: 32,
    maxWidth: 280,
    lineHeight: 18,
  },
  footer: {
    position: 'absolute',
    bottom: 36,
    left: 0,
    right: 0,
    alignItems: 'center',
    gap: 10,
  },
  slowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  slowText: {
    fontSize: 12,
    fontWeight: '600',
  },
  version: {
    fontSize: 11,
    fontWeight: '500',
  },
});
