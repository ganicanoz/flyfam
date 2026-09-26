import { forwardRef, useMemo, useState, type ReactNode } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  type KeyboardTypeOptions,
  type StyleProp,
  type ViewStyle,
  type TextInputProps,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, useThemeMode } from '../theme/colors';
import { radius } from '../theme/tokens';

type Props = {
  label?: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  keyboardType?: KeyboardTypeOptions;
  autoCapitalize?: TextInputProps['autoCapitalize'];
  secureTextEntry?: boolean;
  showSecureToggle?: boolean;
  editable?: boolean;
  autoComplete?: TextInputProps['autoComplete'];
  textContentType?: TextInputProps['textContentType'];
  returnKeyType?: TextInputProps['returnKeyType'];
  blurOnSubmit?: boolean;
  onSubmitEditing?: TextInputProps['onSubmitEditing'];
  onFocus?: TextInputProps['onFocus'];
  onBlur?: TextInputProps['onBlur'];
  inputAccessoryViewID?: string;
  enablesReturnKeyAutomatically?: boolean;
  style?: StyleProp<ViewStyle>;
  /** Extra row under the field (e.g. password strength). */
  footer?: ReactNode;
};

/** Borderless gray fill input; blue ring on focus. Optional eye toggle for secure fields. */
export const FormField = forwardRef<TextInput, Props>(function FormField(
  {
    label,
    value,
    onChangeText,
    placeholder,
    keyboardType,
    autoCapitalize = 'none',
    secureTextEntry,
    showSecureToggle,
    editable = true,
    autoComplete,
    textContentType,
    returnKeyType,
    blurOnSubmit,
    onSubmitEditing,
    onFocus,
    onBlur,
    inputAccessoryViewID,
    enablesReturnKeyAutomatically,
    style,
    footer,
  },
  ref,
) {
  const themeMode = useThemeMode();
  const styles = useMemo(() => createStyles(), [themeMode]);
  const [focused, setFocused] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const secure = !!secureTextEntry && !revealed;
  const showToggle = !!(showSecureToggle ?? secureTextEntry);

  return (
    <View style={[styles.wrap, style]}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <View
        style={[
          styles.field,
          { backgroundColor: colors.inputFill },
          focused && styles.fieldFocused,
        ]}
      >
        <TextInput
          ref={ref}
          style={styles.input}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.textMuted}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
          secureTextEntry={secure}
          editable={editable}
          autoComplete={autoComplete}
          textContentType={textContentType}
          returnKeyType={returnKeyType}
          blurOnSubmit={blurOnSubmit}
          onSubmitEditing={onSubmitEditing}
          inputAccessoryViewID={inputAccessoryViewID}
          enablesReturnKeyAutomatically={enablesReturnKeyAutomatically}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
        />
        {showToggle ? (
          <TouchableOpacity
            onPress={() => setRevealed((v) => !v)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={revealed ? 'Hide password' : 'Show password'}
            style={styles.eyeBtn}
          >
            <Ionicons
              name={revealed ? 'eye-off-outline' : 'eye-outline'}
              size={20}
              color={colors.textMuted}
            />
          </TouchableOpacity>
        ) : null}
      </View>
      {footer}
    </View>
  );
});

function createStyles() {
  return StyleSheet.create({
    wrap: { marginBottom: 14 },
    label: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.textSecondary,
      marginBottom: 6,
    },
    field: {
      flexDirection: 'row',
      alignItems: 'center',
      borderRadius: radius.button,
      borderWidth: 1.5,
      borderColor: 'transparent',
      minHeight: 52,
      paddingHorizontal: 14,
    },
    fieldFocused: {
      borderColor: colors.primary,
    },
    input: {
      flex: 1,
      fontSize: 16,
      fontWeight: '500',
      color: colors.text,
      paddingVertical: 14,
    },
    eyeBtn: {
      paddingLeft: 8,
      paddingVertical: 8,
    },
  });
}
