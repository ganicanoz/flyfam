import type { ReactNode } from 'react';
import { Platform } from 'react-native';
import type { NativeStackNavigationOptions } from '@react-navigation/native-stack';
import { StackScreenBackButton } from '../components/StackScreenBackButton';
import { colors } from '../theme/colors';

/**
 * Sol üst geri — canGoBack false olsa bile göster.
 * Nested tab→stack’te telefonda canGoBack bazen yanlış false gelir;
 * buton gizlenince veya native back ölü kalınca kullanıcı sıkışır.
 */
export function stackBackHeaderLeft(props: {
  canGoBack?: boolean;
  tintColor?: string;
  label?: string;
}): ReactNode {
  void props.canGoBack;
  return <StackScreenBackButton color={props.tintColor ?? colors.onPrimary} />;
}

export function withStackBackButton(options: NativeStackNavigationOptions): NativeStackNavigationOptions {
  const leftContainer = {
    paddingHorizontal: 0,
    paddingLeft: Platform.OS === 'ios' ? 4 : 2,
    paddingRight: 0,
    paddingTop: 0,
    paddingBottom: 0,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  };

  if (options.headerLeft) {
    return {
      ...options,
      headerBackVisible: false,
      headerLeftContainerStyle: {
        ...leftContainer,
        ...(options.headerLeftContainerStyle as object | undefined),
      },
    };
  }
  return {
    ...options,
    headerBackVisible: false,
    headerLeft: stackBackHeaderLeft,
    headerLeftContainerStyle: {
      ...leftContainer,
      ...(options.headerLeftContainerStyle as object | undefined),
    },
  };
}
