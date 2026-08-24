import { useCallback } from 'react';
import { useNavigation } from '@react-navigation/native';
import { navigationRef } from '../navigationRef';

type Nav = {
  canGoBack?: () => boolean;
  goBack: () => void;
  getParent?: () => Nav | undefined;
  navigate: (name: string, params?: object) => void;
};

/** Safe stack back: walk parents, then navigationRef, else Main → Profile. */
export function useStackGoBack(fallback?: () => void) {
  const navigation = useNavigation<Nav>();

  return useCallback(() => {
    let nav: Nav | undefined = navigation;
    while (nav) {
      if (nav.canGoBack?.()) {
        nav.goBack();
        return;
      }
      nav = nav.getParent?.();
    }
    if (navigationRef.isReady() && navigationRef.canGoBack()) {
      navigationRef.goBack();
      return;
    }
    if (fallback) {
      fallback();
      return;
    }
    navigation.navigate('Main', { screen: 'Profile' });
  }, [navigation, fallback]);
}
