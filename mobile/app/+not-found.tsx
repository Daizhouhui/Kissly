import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { CONTINUOUS_CORNER, RADIUS } from '@/src/tokens';
import { AppPressable } from '@/src/ui/app-pressable';
import { useAppTheme } from '@/src/ui/theme';

const Pressable = AppPressable;

export default function NotFoundScreen() {
  const theme = useAppTheme();
  const router = useRouter();
  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg, alignItems: 'center', justifyContent: 'center', padding: 30 }}>
      <View
        style={{
          width: 78,
          height: 78,
          borderRadius: RADIUS.pill,
          backgroundColor: theme.colors.primarySoft,
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 18,
        }}
      >
        <Ionicons name="compass-outline" size={32} color={theme.colors.primary} />
      </View>
      <Text style={{ color: theme.colors.text, fontSize: 20, fontWeight: '800' }}>页面走丢了</Text>
      <Text style={{ color: theme.colors.textSecondary, fontSize: 13, marginTop: 8, textAlign: 'center' }}>
        这个地址不存在，回到首页继续看视频吧。
      </Text>
      <Pressable
        tone="onColor"
        onPress={() => router.replace('/' as any)}
        style={{
          marginTop: 22,
          height: 46,
          paddingHorizontal: 30,
          borderRadius: RADIUS.control,
          ...CONTINUOUS_CORNER,
          backgroundColor: theme.colors.primary,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700' }}>返回首页</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({});
