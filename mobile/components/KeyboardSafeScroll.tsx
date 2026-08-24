import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
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
 * iOS: KeyboardAvoidingView + automaticallyAdjustKeyboardInsets.
 * Android: adjustResize (manifest) + keyboard height padding.
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
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const onShow = Keyboard.addListener(showEvt, (e) => {
      setKeyboardPad(Math.max(0, e.endCoordinates?.height ?? 0));
    });
    const onHide = Keyboard.addListener(hideEvt, () => setKeyboardPad(0));
    return () => {
      onShow.remove();
      onHide.remove();
    };
  }, []);

  return (
    <KeyboardAvoidingView
      style={[{ flex: 1 }, style]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? headerHeight : 0}
    >
      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[
          {
            flexGrow: 1,
            paddingBottom: bottomOffset + (Platform.OS === 'android' ? keyboardPad : Math.min(keyboardPad * 0.15, 48)),
          },
          contentContainerStyle,
        ]}
        {...scrollProps}
      >
        {children}
      </ScrollView>
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
