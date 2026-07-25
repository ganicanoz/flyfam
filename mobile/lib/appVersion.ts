import { Platform } from 'react-native';
import Constants from 'expo-constants';

/** Marketing version + native build (iOS CFBundleVersion / Android versionCode). */
export function getAppVersionLabel(): string {
  const version =
    Constants.nativeApplicationVersion?.trim() ||
    Constants.expoConfig?.version?.trim() ||
    '—';
  const build =
    Constants.nativeBuildVersion?.trim() ||
    (Platform.OS === 'ios'
      ? Constants.expoConfig?.ios?.buildNumber?.toString().trim()
      : Constants.expoConfig?.android?.versionCode != null
        ? String(Constants.expoConfig.android.versionCode)
        : '') ||
    '';
  return build ? `${version} (${build})` : version;
}
