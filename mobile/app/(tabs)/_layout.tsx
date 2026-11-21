import { Ionicons } from '@expo/vector-icons';
import { Tabs, router } from 'expo-router';
import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAppStore } from '../../src/core/store';
import { RADIUS } from '../../src/tokens';
import { AppPressable } from '../../src/ui/app-pressable';
import { useAppTheme } from '../../src/ui/theme';

const TAB_ICONS: Record<string, { active: any; inactive: any; label: string }> = {
  index: { active: 'play', inactive: 'play-outline', label: '视频' },
  podcast: { active: 'radio', inactive: 'radio-outline', label: '播客' },
  learning: { active: 'school', inactive: 'school-outline', label: '学习' },
  me: { active: 'person', inactive: 'person-outline', label: '我的' },
};

function TabIcon({ name, focused }: { name: string; focused: boolean }) {
  const theme = useAppTheme();
  const config = TAB_ICONS[name] ?? TAB_ICONS.index;
  return (
    <View style={styles.iconWrap}>
      <Ionicons
        name={focused ? config.active : config.inactive}
        size={20}
        color={focused ? theme.colors.primary : theme.colors.textTertiary}
      />
    </View>
  );
}

export default function TabLayout() {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const hydrated = useAppStore((state) => state.hydrated);
  const defaultTab = useAppStore((state) => state.settings.defaultTab);
  const routedRef = useRef(false);

  useEffect(() => {
    if (!hydrated || routedRef.current) return;
    routedRef.current = true;
    if (defaultTab === 'video') return;
    const timer = setTimeout(() => {
      router.replace(`/(tabs)/${defaultTab}` as any);
    }, 30);
    return () => clearTimeout(timer);
  }, [defaultTab, hydrated]);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: true,
        tabBarHideOnKeyboard: true,
        tabBarActiveTintColor: theme.colors.primary,
        tabBarInactiveTintColor: theme.colors.textTertiary,
        tabBarStyle: {
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: 58 + insets.bottom,
          borderRadius: 0,
          backgroundColor: theme.colors.bgElevated,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: theme.colors.border,
          paddingBottom: insets.bottom,
          paddingTop: 5,
          elevation: 0,
          shadowOpacity: 0,
        },
        tabBarItemStyle: {
          height: 52,
        },
        tabBarLabelStyle: {
          fontSize: 10.5,
          fontWeight: '700',
          letterSpacing: 0.1,
          marginTop: -1,
        },
        tabBarIconStyle: {
          marginTop: 2,
        },
        tabBarButton: (props) => {
          const { children, style, ...rest } = props;
          return (
            <AppPressable
              {...rest}
              feedback="ripple"
              radius={RADIUS.control}
              accessibilityRole="tab"
              style={[style, styles.tabButton]}
            >
              {children}
            </AppPressable>
          );
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: '视频',
          tabBarIcon: ({ focused }: { focused: boolean }) => <TabIcon name="index" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="podcast"
        options={{
          title: '播客',
          tabBarIcon: ({ focused }: { focused: boolean }) => <TabIcon name="podcast" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="learning"
        options={{
          title: '学习',
          tabBarIcon: ({ focused }: { focused: boolean }) => <TabIcon name="learning" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="me"
        options={{
          title: '我的',
          tabBarIcon: ({ focused }: { focused: boolean }) => <TabIcon name="me" focused={focused} />,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabButton: {
    flex: 1,
    borderRadius: RADIUS.control,
    justifyContent: 'center',
  },
  iconWrap: {
    width: 34,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
