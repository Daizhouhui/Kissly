import { Ionicons } from '@expo/vector-icons';
import { Tabs, router } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAppStore } from '../../src/core/store';
import { RADIUS } from '../../src/tokens';
import { DURATION, EASE_OUT, PRESS_SCALE } from '../../src/ui/motion';
import { useAppTheme } from '../../src/ui/theme';

const TAB_ICONS: Record<string, { active: any; inactive: any; label: string }> = {
  index: { active: 'play', inactive: 'play-outline', label: '视频' },
  podcast: { active: 'radio', inactive: 'radio-outline', label: '播客' },
  learning: { active: 'school', inactive: 'school-outline', label: '学习' },
  me: { active: 'person', inactive: 'person-outline', label: '我的' },
};

/**
 * Two icon layers crossfade instead of swapping glyphs. The active glyph also
 * pops once when it becomes selected — one short spring, no travelling
 * indicator, because tab switches happen dozens of times a day.
 */
function TabIcon({ name, focused }: { name: string; focused: boolean }) {
  const theme = useAppTheme();
  const config = TAB_ICONS[name] ?? TAB_ICONS.index;
  const appear = useSharedValue(focused ? 1 : 0);
  const pop = useSharedValue(1);

  useEffect(() => {
    appear.set(withTiming(focused ? 1 : 0, { duration: 140, easing: EASE_OUT }));
    if (focused) {
      pop.set(PRESS_SCALE.tab);
      pop.set(withSpring(1, { duration: 300, dampingRatio: 0.7 }));
    }
  }, [focused, appear, pop]);

  const activeStyle = useAnimatedStyle(() => ({
    opacity: appear.get(),
    transform: [{ scale: pop.get() }],
  }));
  const idleStyle = useAnimatedStyle(() => ({
    opacity: 1 - appear.get(),
  }));

  return (
    <View style={styles.iconWrap}>
      <Animated.View style={[styles.iconLayer, idleStyle]}>
        <Ionicons name={config.inactive} size={20} color={theme.colors.textTertiary} />
      </Animated.View>
      <Animated.View style={[styles.iconLayer, activeStyle]}>
        <Ionicons name={config.active} size={20} color={theme.colors.primary} />
      </Animated.View>
    </View>
  );
}

function TabButton(props: any) {
  const { children, style, ...rest } = props;
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.get() }],
  }));

  return (
    <Animated.View style={[style, styles.tabButton, animatedStyle]}>
      <Pressable
        {...rest}
        accessibilityRole="tab"
        style={styles.tabHit}
        onPressIn={(event: any) => {
          scale.set(
            withTiming(PRESS_SCALE.tab, {
              duration: DURATION.pressIn,
              easing: EASE_OUT,
            })
          );
          rest.onPressIn?.(event);
        }}
        onPressOut={(event: any) => {
          scale.set(
            withTiming(1, {
              duration: DURATION.pressOut,
              easing: EASE_OUT,
            })
          );
          rest.onPressOut?.(event);
        }}
      >
        {children}
      </Pressable>
    </Animated.View>
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
        tabBarButton: (props) => <TabButton {...props} />,
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
  tabHit: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrap: {
    width: 34,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
