/** Uygulama ikonu: iOS ve Android aynı 1024 kaynak (adaptive ön plan dahil). */
const APP_ICON_1024 = './assets/icon-final-iOS-Default-1024x1024@1x.png';
/** Native splash: #B4CCFB + app icon + wordmark (~26% genişlik). sync-native-splash.py */
const SPLASH_LOGO_IMAGE = './assets/splash-logo-expo-native.png';
/** Intro poster `highressplash1.mp4.png` üst bölge (gök+bulut) ortalaması — videoyla uyumlu açık gök. */
const SPLASH_BACKGROUND = '#B4CCFB';

export default {
  expo: {
    name: 'FlyFam',
    slug: 'flyfam',
    version: '1.3.0',
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
      buildNumber: '32',
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
      versionCode: 33,
      jsEngine: 'hermes',
      /** Play + adaptive foreground: iOS App Store ikonu ile aynı 1024 kaynak. */
      icon: APP_ICON_1024,
      adaptiveIcon: {
        foregroundImage: APP_ICON_1024,
        backgroundColor: SPLASH_BACKGROUND,
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
      [
        'expo-build-properties',
        {
          android: {
            compileSdkVersion: 36,
            targetSdkVersion: 36,
            buildToolsVersion: '36.0.0',
          },
        },
      ],
      [
        'expo-notifications',
        {
          icon: APP_ICON_1024,
          color: '#0369A1',
          sounds: [],
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
          excludedPackages: ['expo-dev-client', 'expo-updates', 'expo-splash-screen'],
        },
      ],
    ],
    extra: {
      supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
      supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
      iosMonthlyPromoOfferId: process.env.EXPO_PUBLIC_IOS_MONTHLY_PROMO_OFFER_ID,
      iosFamilyAddonProductId: process.env.EXPO_PUBLIC_IOS_FAMILY_ADDON_PRODUCT_ID,
      flightradar24Token: process.env.EXPO_PUBLIC_FLIGHTRADAR24_API_TOKEN,
      airlabsKey: process.env.EXPO_PUBLIC_AIRLABS_API_KEY,
      aerodataboxApiMarketBase: process.env.EXPO_PUBLIC_AERODATABOX_APIMARKET_BASE,
      aerodataboxApiMarketKey: process.env.EXPO_PUBLIC_AERODATABOX_APIMARKET_KEY,
      eas: {
        projectId: process.env.EXPO_PUBLIC_EAS_PROJECT_ID ?? '5c9f4f99-9766-4d38-bfe0-6b1cd6a7e83f',
      },
    },
  },
};
