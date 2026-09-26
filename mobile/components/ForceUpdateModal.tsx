import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Linking,
  Platform,
  Modal,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { colors } from '../theme/colors';
import type { AppReleasePolicy } from '../lib/appReleasePolicy';
import { policyBody, policyTitle } from '../lib/appReleasePolicy';

type Props = {
  visible: boolean;
  policy: AppReleasePolicy | null;
};

export function ForceUpdateModal({ visible, policy }: Props) {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const lang = i18n.language ?? 'en';

  const title = policy ? policyTitle(policy, lang) : t('forceUpdate.title');
  const body = policy ? policyBody(policy, lang) : t('forceUpdate.body');
  const iosUrl = policy?.ios_store_url || 'https://apps.apple.com/app/id6759844455';
  const androidUrl =
    policy?.android_store_url || 'https://play.google.com/store/apps/details?id=com.flyfam.app';
  const inviteEmail = policy?.android_invite_email || 'support@flyfamapp.com';

  const openStore = () => {
    const url = Platform.OS === 'ios' ? iosUrl : androidUrl;
    void Linking.openURL(url);
  };

  const openInviteEmail = () => {
    const subject = encodeURIComponent('FlyFam Closed Testing Daveti');
    void Linking.openURL(`mailto:${inviteEmail}?subject=${subject}`);
  };

  return (
    <Modal visible={visible} animationType="fade" presentationStyle="fullScreen" statusBarTranslucent>
      <View
        style={[
          styles.root,
          {
            backgroundColor: colors.background,
            paddingTop: Math.max(insets.top, 24),
            paddingBottom: Math.max(insets.bottom, 24),
          },
        ]}
      >
        <View style={styles.card}>
          <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
          <Text style={[styles.body, { color: colors.textSecondary }]}>{body}</Text>

          <Pressable
            onPress={openStore}
            style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
            accessibilityRole="button"
          >
            <Text style={[styles.primaryBtnText, { color: colors.onPrimary }]}>
              {Platform.OS === 'ios' ? t('forceUpdate.openStoreIos') : t('forceUpdate.openStoreAndroid')}
            </Text>
          </Pressable>

          {Platform.OS === 'android' ? (
            <Pressable
              onPress={openInviteEmail}
              style={styles.secondaryBtn}
              accessibilityRole="button"
            >
              <Text style={[styles.secondaryBtnText, { color: colors.primary }]}>
                {t('forceUpdate.requestInvite')}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  card: {
    borderRadius: 16,
    padding: 24,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 12,
  },
  body: {
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 24,
  },
  primaryBtn: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryBtnText: {
    fontSize: 16,
    fontWeight: '700',
  },
  secondaryBtn: {
    marginTop: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  secondaryBtnText: {
    fontSize: 15,
    fontWeight: '600',
  },
});
