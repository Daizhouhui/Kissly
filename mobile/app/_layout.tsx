import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useAppStore } from '../src/core/store';
import { maybeAutoSync } from '../src/core/sync';
import { AppAlertHost } from '../src/ui/app-alert';
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
    maybeAutoSync().catch(() => {});
  }, [hydrated]);

  return (
    <SafeAreaProvider>
      <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
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
          <Stack.Screen name="settings/about" />
        </Stack>
        <YoutubeLoginProbe enabled={hydrated} />
        <AppAlertHost />
      </View>
    </SafeAreaProvider>
  );
}
