/** Brand splash: #B4CCFB + app icon + FlyFam wordmark (stacked, same width). */
export const SPLASH_SKY_GRADIENT = ['#D8E8FD', '#B4CCFB', '#9BB8F5', '#86A9F0'] as const;

export const splashIconAsset = require('../assets/splash-logo-ios-default-1024.png');
export const splashWordmarkAsset = require('../assets/splash-wordmark.png');
/** Composed native splash (icon + wordmark); regenerate via sync-native-splash.py */
export const splashLogoAsset = require('../assets/splash-logo-expo-native.png');

/** ~26% of screen width, max 130pt — icon and wordmark share this width. */
export const SPLASH_LOGO_WIDTH_FRACTION = 0.26;
export const SPLASH_LOGO_MAX_PT = 130;

export function splashLogoSizePx(screenWidth: number): number {
  return Math.min(SPLASH_LOGO_MAX_PT, Math.round(screenWidth * SPLASH_LOGO_WIDTH_FRACTION));
}
