import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAppTheme } from '../../src/ui/theme';

const TAB_ICONS: Record<string, { active: any; inactive: any; label: string }> = {
  index: { active: 'compass', inactive: 'compass-outline', label: '发现' },
  learning: { active: 'bookmark', inactive: 'bookmark-outline', label: '学习' },
  me: { active: 'person-circle', inactive: 'person-circle-outline', label: '我的' },
};

function TabIcon({ name, focused }: { name: string; focused: boolean }) {
  const theme = useAppTheme();
  const config = TAB_ICONS[name] ?? TAB_ICONS.index;
  return (
    <View style={styles.iconWrap}>
      <Ionicons
        name={focused ? config.active : config.inactive}
        size={22}
        color={focused ? theme.colors.primary : theme.colors.textTertiary}
      />
    </View>
  );
}

export default function TabLayout() {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();

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
          backgroundColor: theme.dark
            ? 'rgba(14,11,20,0.98)'
            : 'rgba(255,255,255,0.98)',
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
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: '发现',
          tabBarIcon: ({ focused }: { focused: boolean }) => <TabIcon name="index" focused={focused} />,
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
  iconWrap: {
    width: 34,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
