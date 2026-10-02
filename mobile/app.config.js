/** Uygulama ikonu: iOS ve Android aynı 1024 kaynak (adaptive ön plan dahil). */
const APP_ICON_1024 = './assets/icon-final-iOS-Default-1024x1024@1x.png';
/** Native splash: app gray + icon + wordmark (~26% genişlik). sync-native-splash.py */
const SPLASH_LOGO_IMAGE = './assets/splash-logo-expo-native.png';
/** Matches in-app `colors.background` light — no sky-blue flash into roster. */
const SPLASH_BACKGROUND = '#F0F1F5';

export default {
  expo: {
    name: 'FlyFam',
    slug: 'flyfam',
    version: '1.3.0',
    /**
     * EAS Update uyumluluk anahtarı (bare: native dosyalarda da aynı değer — `ios/FlyFam/Supporting/Expo.plist`
     * `EXUpdatesRuntimeVersion`, `android/app/src/main/res/values/strings.xml` `expo_runtime_version`).
     * Native bağımlılık / native kod değişince üçü birlikte artırılmalı; yoksa OTA eski binary'ye uyumsuz JS gönderir.
     */
    runtimeVersion: '1.3.0',
    updates: {
      url: 'https://u.expo.dev/5c9f4f99-9766-4d38-bfe0-6b1cd6a7e83f',
      checkAutomatically: 'ON_LOAD',
      fallbackToCacheTimeout: 0,
    },
    orientation: 'portrait',
    icon: APP_ICON_1024,
    userInterfaceStyle: 'automatic',
    scheme: 'flyfam',
    /** E-posta doğrulama deep link (Supabase redirect). */
    linking: {
      schemes: ['flyfam', 'com.flyfam.app'],
    },
    /** Düz zemin SPLASH_BACKGROUND + ortada SPLASH_LOGO_IMAGE (contain). */
    splash: {
      image: SPLASH_LOGO_IMAGE,
      resizeMode: 'contain',
      backgroundColor: SPLASH_BACKGROUND,
    },
    ios: {
      supportsTablet: true,
      bundleIdentifier: 'com.flyfam.app',
      /** Her App Store / TestFlight yüklemesinde bir öncekinden büyük olmalı (CFBundleVersion). */
      buildNumber: '51',
      jsEngine: 'hermes',
      infoPlist: {
        /** expo-share-extension ana uygulama + uzantı için App Group */
        AppGroup: 'group.com.flyfam.app',
        // CFBundleDocumentTypes tanımlı olduğunda iOS gereksinimi:
        // UIDocumentBrowser kullanılmıyorsa in-place açmayı açık tut.
        LSSupportsOpeningDocumentsInPlace: true,
        CFBundleDocumentTypes: [
          {
            CFBundleTypeName: 'PDF roster',
            CFBundleTypeRole: 'Viewer',
            LSHandlerRank: 'Alternate',
            LSItemContentTypes: ['com.adobe.pdf', 'public.pdf'],
          },
        ],
      },
    },
    android: {
      versionCode: 51,
      jsEngine: 'hermes',
      /** Play + adaptive foreground: iOS App Store ikonu ile aynı 1024 kaynak. */
      icon: APP_ICON_1024,
      adaptiveIcon: {
        foregroundImage: APP_ICON_1024,
        backgroundColor: '#E8F0FE',
      },
      package: 'com.flyfam.app',
      googleServicesFile: './google-services.json',
      intentFilters: [
        {
          action: 'VIEW',
          category: ['BROWSABLE', 'DEFAULT'],
          data: [{ mimeType: 'application/pdf' }],
        },
        {
          action: 'VIEW',
          category: ['BROWSABLE', 'DEFAULT'],
          data: [{ scheme: 'flyfam', host: 'auth', pathPrefix: '/callback' }],
        },
        {
          action: 'VIEW',
          category: ['BROWSABLE', 'DEFAULT'],
          data: [{ scheme: 'com.flyfam.app' }],
        },
      ],
    },
    plugins: [
      'expo-localization',
      'expo-secure-store',
      'react-native-bottom-tabs',
      '@react-native-community/datetimepicker',
      [
        'expo-build-properties',
        {
          android: {
            compileSdkVersion: 36,
            targetSdkVersion: 36,
            buildToolsVersion: '36.0.0',
            newArchEnabled: true,
          },
          ios: {
            newArchEnabled: true,
          },
        },
      ],
      [
        'expo-notifications',
        {
          icon: APP_ICON_1024,
          color: '#0369A1',
          sounds: [
            './assets/sounds/flyfam_took_off.wav',
            './assets/sounds/flyfam_landed.wav',
            './assets/sounds/flyfam_roster_share.wav',
          ],
          defaultChannel: 'default',
        },
      ],
      './plugins/withCopyGoogleServices.js',
      [
        'expo-share-extension',
        {
          activationRules: [{ type: 'file', max: 3 }],
          height: 180,
          backgroundColor: { red: 180, green: 204, blue: 251, alpha: 255 },
          excludedPackages: ['expo-dev-client', 'expo-updates', 'expo-splash-screen', 'expo-eas-client', 'expo-structured-headers'],
        },
      ],
    ],
    extra: {
      supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
      supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
      iosFamilyAddonProductId: process.env.EXPO_PUBLIC_IOS_FAMILY_ADDON_PRODUCT_ID,
      eas: {
        projectId: process.env.EXPO_PUBLIC_EAS_PROJECT_ID ?? '5c9f4f99-9766-4d38-bfe0-6b1cd6a7e83f',
      },
    },
  },
};
