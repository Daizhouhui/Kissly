import { Component, ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

type Props = { children: ReactNode };
type State = { error: Error | null };

/**
 * Root-level safety net. A render error in the player used to take down the
 * whole screen with no way back; keep the app shell alive and offer a retry.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    console.error('Kissly render error', error, info.componentStack);
  }

  private reset = () => {
    this.setState({ error: null });
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <View style={styles.root}>
        <Text style={styles.title}>页面遇到了一个问题</Text>
        <Text style={styles.body}>
          可以点下面重试。如果一直出现，请把刚才的操作和视频链接反馈给开发者。
        </Text>
        <Text style={styles.detail} numberOfLines={4}>
          {this.state.error.message || String(this.state.error)}
        </Text>
        <Pressable onPress={this.reset} style={styles.button}>
          <Text style={styles.buttonText}>重试</Text>
        </Pressable>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0B0A0F',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 10,
  },
  body: {
    color: '#B8B4C4',
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: 12,
  },
  detail: {
    color: '#817B91',
    fontSize: 11,
    lineHeight: 16,
    textAlign: 'center',
    marginBottom: 22,
  },
  button: {
    minWidth: 120,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#7C5CFC',
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
});
