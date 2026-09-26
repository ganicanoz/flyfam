import { Platform } from 'react-native';
import Constants from 'expo-constants';

/** Native build as integer (iOS CFBundleVersion / Android versionCode). */
export function getNativeBuildNumber(): number | null {
  const raw =
    Constants.nativeBuildVersion?.trim() ||
    (Platform.OS === 'ios'
      ? Constants.expoConfig?.ios?.buildNumber?.toString().trim()
      : Constants.expoConfig?.android?.versionCode != null
        ? String(Constants.expoConfig.android.versionCode)
        : '') ||
    '';
  if (!raw) return null;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

/** Marketing version + native build (iOS CFBundleVersion / Android versionCode). */
export function getAppVersionLabel(): string {
  const version =
    Constants.nativeApplicationVersion?.trim() ||
    Constants.expoConfig?.version?.trim() ||
    '—';
  const build = getNativeBuildNumber();
  return build != null ? `${version} (${build})` : version;
}
