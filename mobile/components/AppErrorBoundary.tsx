import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as Updates from 'expo-updates';
import i18n from '../lib/i18n';
import { colors } from '../theme/colors';
import { reportClientError } from '../lib/errorReporting';

type Props = { children: React.ReactNode };
type State = { hasError: boolean };

/** Root render-error fallback. Kept dependency-light so it still renders when app providers fail. */
export class AppErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    void reportClientError(error, { source: 'boundary', componentStack: info.componentStack });
  }

  private retry = (): void => {
    if (__DEV__) {
      this.setState({ hasError: false });
      return;
    }
    Updates.reloadAsync().catch(() => this.setState({ hasError: false }));
  };

  render(): React.ReactNode {
    if (!this.state.hasError) return this.props.children;
    return (
      <View style={styles.container}>
        <Text style={styles.title}>{i18n.t('errorBoundary.title')}</Text>
        <Text style={styles.body}>{i18n.t('errorBoundary.body')}</Text>
        <TouchableOpacity style={styles.button} onPress={this.retry} accessibilityRole="button">
          <Text style={styles.buttonText}>{i18n.t('errorBoundary.retry')}</Text>
        </TouchableOpacity>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    backgroundColor: colors.background,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
    marginBottom: 8,
  },
  body: {
    fontSize: 15,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: 24,
  },
  button: {
    minHeight: 44,
    paddingHorizontal: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  buttonText: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.onPrimary,
  },
});
