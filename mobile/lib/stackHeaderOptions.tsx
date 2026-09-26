import type { ReactNode } from 'react';
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
  if (options.headerLeft) {
    return {
      ...options,
      headerBackVisible: false,
    };
  }
  return {
    ...options,
    headerBackVisible: false,
    headerLeft: stackBackHeaderLeft,
  };
}
