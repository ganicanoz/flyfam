import { Alert, type AlertButton } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import i18n from './i18n';

export type AlertWithCopyOptions = {
  /** Panoya yazılacak metin; verilmezse title + message birleştirilir. */
  copyText?: string;
  extraButtons?: AlertButton[];
  cancelable?: boolean;
};

/**
 * Hata / bilgi popup'ına "Hatayı kopyala" ekler (destek & debug için).
 */
export function alertWithCopy(title: string, message: string, options?: AlertWithCopyOptions): void {
  const copyPayload = options?.copyText ?? `${title}\n\n${message}`;
  const buttons: AlertButton[] = [
    ...(options?.extraButtons ?? []),
    {
      text: i18n.t('common.copyError'),
      onPress: () => {
        void Clipboard.setStringAsync(copyPayload)
          .then(() => {
            Alert.alert('', i18n.t('common.copyErrorDone'), [{ text: i18n.t('common.ok') }]);
          })
          .catch(() => {
            Alert.alert(i18n.t('common.error'), i18n.t('common.copyErrorFailed'));
          });
      },
    },
    { text: i18n.t('common.ok') },
  ];
  Alert.alert(title, message, buttons, { cancelable: options?.cancelable ?? true });
}
