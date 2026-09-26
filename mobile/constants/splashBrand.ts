/**
 * Brand splash — matches app chrome (light gray), not sky blue.
 * Native LaunchScreen + JS BrandSplashOverlay share these tokens.
 */
export const SPLASH_BG_LIGHT = '#F0F1F5';
export const SPLASH_BG_DARK = '#0B1220';

/** @deprecated use SPLASH_BG_LIGHT — kept for any leftover sky refs */
export const SPLASH_SKY_GRADIENT = ['#F7F8FB', '#F0F1F5', '#EBEDF2'] as const;

export const splashIconAsset = require('../assets/splash-logo-ios-default-1024.png');
export const splashWordmarkAsset = require('../assets/splash-wordmark.png');
/** White mono wordmark for dark splash / headers */
export const splashWordmarkMonoAsset = require('../assets/splash-wordmark-mono-white.png');
/** Composed native splash (icon + wordmark); regenerate via sync-native-splash.py */
export const splashLogoAsset = require('../assets/splash-logo-expo-native.png');

/** ~26% of screen width, max 130pt — icon and wordmark share this width. */
export const SPLASH_LOGO_WIDTH_FRACTION = 0.26;
export const SPLASH_LOGO_MAX_PT = 130;

export function splashLogoSizePx(screenWidth: number): number {
  return Math.min(SPLASH_LOGO_MAX_PT, Math.round(screenWidth * SPLASH_LOGO_WIDTH_FRACTION));
}
