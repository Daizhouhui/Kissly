import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef } from 'react';
import { AppState, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useAppStore } from '../src/core/store';
import { pruneExpiredCaches } from '../src/core/storage';
import {
  flushProgressNow,
  markProgressDirty,
  maybeAutoSync,
} from '../src/core/sync';
import { AppAlertHost } from '../src/ui/app-alert';
import { ErrorBoundary } from '../src/ui/error-boundary';
import { useAppTheme } from '../src/ui/theme';
import { YoutubeLoginProbe } from '../src/ui/youtube-login-probe';

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const theme = useAppTheme();
  const hydrated = useAppStore((state) => state.hydrated);
  const bootstrapped = useRef(false);

  useEffect(() => {
    if (!hydrated) return;
    SplashScreen.hideAsync().catch(() => {});
    if (bootstrapped.current) return;
    bootstrapped.current = true;
    const day = 24 * 60 * 60 * 1000;
    pruneExpiredCaches([
      { prefix: 'captions:v2:', ttlMs: 30 * day },
      { prefix: 'cues:v3:', ttlMs: 30 * day },
      { prefix: 'cues:v4:', ttlMs: 30 * day },
      { prefix: 'feed:', ttlMs: 10 * 60 * 1000 },
      { prefix: 'video-meta:', ttlMs: 7 * day },
    ]).catch(() => {});
    maybeAutoSync().catch(() => {});
  }, [hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    // Resume points are uploaded on a session boundary, not on every playback
    // tick. The store subscription only marks the state dirty; the sync layer
    // owns the throttle.
    const unsubscribe = useAppStore.subscribe((state, previous) => {
      if (state.history === previous.history) return;
      // A sync replaces the history list itself; treating that as a user edit
      // would schedule a pointless upload right after every sync.
      if (state.syncState === 'syncing') return;
      markProgressDirty();
    });
    const appState = AppState.addEventListener('change', (next) => {
      // A pending timer may never fire once iOS suspends the app.
      if (next === 'background') flushProgressNow().catch(() => {});
    });
    return () => {
      unsubscribe();
      appState.remove();
    };
  }, [hydrated]);

  return (
    <SafeAreaProvider>
      <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
        <ErrorBoundary>
          <StatusBar style={theme.dark ? 'light' : 'dark'} />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: theme.colors.bg },
              animation: 'slide_from_right',
            }}
          >
            <Stack.Screen name="(tabs)" options={{ animation: 'none' }} />
            <Stack.Screen
              name="player"
              options={{ animation: 'fade', gestureEnabled: false }}
            />
            <Stack.Screen name="subscriptions" />
            <Stack.Screen name="favorites" />
            <Stack.Screen name="add-subscription" options={{ animation: 'slide_from_bottom' }} />
            <Stack.Screen name="channel" />
            <Stack.Screen name="settings/translation" />
            <Stack.Screen name="settings/language" />
            <Stack.Screen name="settings/appearance" />
            <Stack.Screen name="settings/webdav" />
            <Stack.Screen name="settings/subtitle" />
            <Stack.Screen name="settings/voice" />
            <Stack.Screen name="settings/export" />
            <Stack.Screen name="settings/more" />
            <Stack.Screen name="settings/about" />
          </Stack>
          <YoutubeLoginProbe enabled={hydrated} />
        </ErrorBoundary>
        <AppAlertHost />
      </View>
    </SafeAreaProvider>
  );
}
