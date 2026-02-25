export default {
  expo: {
    name: 'FlyFam',
    slug: 'flyfam',
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/icon.png',
    userInterfaceStyle: 'automatic',
    scheme: 'flyfam',
    splash: {
      image: './assets/splash-icon.png',
      resizeMode: 'contain',
      backgroundColor: '#0369A1',
    },
    ios: {
      supportsTablet: true,
      bundleIdentifier: 'com.flyfam.app',
      jsEngine: 'jsc',
    },
    android: {
      jsEngine: 'jsc',
      adaptiveIcon: {
        backgroundColor: '#0369A1',
        foregroundImage: './assets/adaptive-icon.png',
      },
      package: 'com.flyfam.app',
    },
    plugins: [
      'expo-secure-store',
      [
        'expo-notifications',
        {
          icon: './assets/icon.png',
          color: '#0369A1',
          sounds: [],
        },
      ],
    ],
    extra: {
      supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
      supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
      aviationEdgeKey: process.env.EXPO_PUBLIC_AVIATION_EDGE_API_KEY,
      aviationStackKey: process.env.EXPO_PUBLIC_AVIATION_STACK_API_KEY,
      flightradar24Token: process.env.EXPO_PUBLIC_FLIGHTRADAR24_API_TOKEN,
      rapidApiKey: process.env.EXPO_PUBLIC_RAPIDAPI_KEY,
      eas: {
        projectId: process.env.EXPO_PUBLIC_EAS_PROJECT_ID ?? undefined,
      },
    },
  },
};
