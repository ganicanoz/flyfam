import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  View,
  type ScrollViewProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useHeaderHeight } from '@react-navigation/elements';

type Props = {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  /** Extra space under focused field above keyboard. */
  bottomOffset?: number;
  scrollRef?: RefObject<ScrollView | null>;
} & Omit<ScrollViewProps, 'style' | 'contentContainerStyle' | 'children'>;

/**
 * Form screens: keep the focused TextInput above the keyboard.
 * iOS: yalnız `automaticallyAdjustKeyboardInsets` (KAV+insets birlikte e-posta
 * öneri çubuğunda titreme yapıyordu). Android: klavye yüksekliği padding.
 */
export default function KeyboardSafeScroll({
  children,
  style,
  contentContainerStyle,
  bottomOffset = 32,
  scrollRef: externalRef,
  ...scrollProps
}: Props) {
  const internalRef = useRef<ScrollView>(null);
  const scrollRef = externalRef ?? internalRef;
  const headerHeight = useHeaderHeight();
  const [keyboardPad, setKeyboardPad] = useState(0);

  useEffect(() => {
    if (Platform.OS === 'ios') return;
    const onShow = Keyboard.addListener('keyboardDidShow', (e) => {
      setKeyboardPad(Math.max(0, e.endCoordinates?.height ?? 0));
    });
    const onHide = Keyboard.addListener('keyboardDidHide', () => setKeyboardPad(0));
    return () => {
      onShow.remove();
      onHide.remove();
    };
  }, []);

  const scroll = (
    <ScrollView
      ref={scrollRef}
      style={{ flex: 1 }}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
      // Safe-area + keyboard insets birlikte kaydırma sıçratmasın.
      contentInsetAdjustmentBehavior="never"
      contentContainerStyle={[
        {
          flexGrow: 1,
          paddingBottom: bottomOffset + (Platform.OS === 'android' ? keyboardPad : 0),
        },
        contentContainerStyle,
      ]}
      {...scrollProps}
    >
      {children}
    </ScrollView>
  );

  if (Platform.OS === 'ios') {
    return <View style={[{ flex: 1 }, style]}>{scroll}</View>;
  }

  return (
    <KeyboardAvoidingView
      style={[{ flex: 1 }, style]}
      behavior="padding"
      keyboardVerticalOffset={headerHeight}
    >
      {scroll}
    </KeyboardAvoidingView>
  );
}

/** Call from TextInput onFocus so the field scrolls above the keyboard. */
export function scrollInputIntoView(
  scrollRef: RefObject<ScrollView | null>,
  e: { nativeEvent?: { target?: unknown } } | null | undefined,
  offset = 140,
) {
  const target = e?.nativeEvent?.target;
  if (target == null || !scrollRef.current) return;
  const responder = scrollRef.current as ScrollView & {
    scrollResponderScrollNativeHandleToKeyboard?: (
      nodeHandle: number,
      additionalOffset: number,
      preventNegativeScrollOffset?: boolean,
    ) => void;
  };
  if (typeof responder.scrollResponderScrollNativeHandleToKeyboard === 'function') {
    responder.scrollResponderScrollNativeHandleToKeyboard(target as number, offset, true);
  }
}
