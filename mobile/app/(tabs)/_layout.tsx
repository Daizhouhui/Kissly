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
    <View
      style={[
        styles.iconWrap,
        focused && { backgroundColor: theme.colors.primarySoft },
      ]}
    >
      <Ionicons
        name={focused ? config.active : config.inactive}
        size={21}
        color={focused ? theme.colors.primary : theme.colors.textTertiary}
      />
    </View>
  );
}

export default function TabLayout() {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const bottom = insets.bottom > 0 ? insets.bottom + 2 : 12;

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
          left: 16,
          right: 16,
          bottom,
          height: 62,
          borderRadius: 31,
          backgroundColor: theme.dark
            ? 'rgba(17,21,29,0.97)'
            : 'rgba(255,255,255,0.98)',
          borderTopWidth: 1,
          borderWidth: 1,
          borderColor: theme.colors.border,
          paddingBottom: 6,
          paddingTop: 6,
          elevation: 12,
          shadowColor: '#000000',
          shadowOpacity: theme.dark ? 0.45 : 0.12,
          shadowRadius: 18,
          shadowOffset: { width: 0, height: 10 },
        },
        tabBarItemStyle: {
          height: 50,
          borderRadius: 25,
        },
        tabBarLabelStyle: {
          fontSize: 10.5,
          fontWeight: '700',
          letterSpacing: 0.2,
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
    width: 38,
    height: 30,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
