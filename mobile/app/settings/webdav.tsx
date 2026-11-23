import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { KOOFIR_WEBDAV_URL } from '../../src/core/defaults';
import { getSecret, setSecret } from '../../src/core/secrets';
import { useAppStore } from '../../src/core/store';
import { syncNow, testWebdav } from '../../src/core/sync';
import { relativeTime } from '../../src/core/utils';
import { CONTINUOUS_CORNER, RADIUS } from '../../src/tokens';
import { appAlert as Alert } from '../../src/ui/app-alert';
import { AppPressable } from '../../src/ui/app-pressable';
import { Card, NavHeader, SectionTitle, SettingSwitch } from '../../src/ui/components';
import { useAppTheme } from '../../src/ui/theme';

const Pressable = AppPressable;

export default function WebdavSettingsScreen() {
  const theme = useAppTheme();
  const settings = useAppStore((state) => state.settings);
  const patchSettings = useAppStore((state) => state.patchSettings);
  const lastSyncAt = useAppStore((state) => state.lastSyncAt);
  const syncState = useAppStore((state) => state.syncState);
  const syncMessage = useAppStore((state) => state.syncMessage);

  const [url, setUrl] = useState(settings.webdav.url || KOOFIR_WEBDAV_URL);
  const [username, setUsername] = useState(settings.webdav.username);
  const [password, setPassword] = useState(settings.webdav.password);
  const [folder, setFolder] = useState(settings.webdav.folder || 'Kissly');
  const [enabled, setEnabled] = useState(settings.webdav.enabled);
  const [testing, setTesting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [passwordLoaded, setPasswordLoaded] = useState(
    Boolean(settings.webdav.password)
  );

  useEffect(() => {
    if (settings.webdav.password) {
      setPasswordLoaded(true);
      return;
    }
    let active = true;
    getSecret('webdavPassword').then((value) => {
      if (!active) return;
      if (value) setPassword(value);
      setPasswordLoaded(true);
    });
    return () => {
      active = false;
    };
  }, [settings.webdav.password]);

  const persist = async () => {
    // Saving before the SecureStore read completes would overwrite the stored
    // password with the empty initial input.
    if (!passwordLoaded) return;
    await setSecret('webdavPassword', password);
    patchSettings({
      webdav: {
        url: url.trim() || KOOFIR_WEBDAV_URL,
        username: username.trim(),
        password,
        folder: folder.trim() || 'Kissly',
        enabled,
      },
    });
  };

  const test = async () => {
    setTesting(true);
    try {
      await testWebdav({
        // Test the same normalized values that "save" would persist, so
        // clearing the field to use the placeholder does not fail the test.
        url: url.trim() || KOOFIR_WEBDAV_URL,
        username: username.trim(),
        password,
        folder: folder.trim() || 'Kissly',
        enabled,
      });
      Alert.alert('连接成功', 'WebDAV 目录可以访问，保存后即可同步。');
    } catch (error) {
      Alert.alert('连接失败', error instanceof Error ? error.message : String(error));
    } finally {
      setTesting(false);
    }
  };

  const runSync = async () => {
    setSyncing(true);
    try {
      await persist();
      const message = await syncNow();
      Alert.alert('同步完成', message);
    } catch (error) {
      Alert.alert('同步失败', error instanceof Error ? error.message : String(error));
    } finally {
      setSyncing(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <NavHeader
        title="WebDAV 同步"
        subtitle="订阅与设置跨设备漫游"
        right={
          <Pressable
            feedback="opacity"
            disabled={!passwordLoaded}
            onPress={async () => {
              try {
                await persist();
                Alert.alert('已保存', 'WebDAV 配置已保存。');
              } catch (error) {
                Alert.alert(
                  '保存失败',
                  error instanceof Error ? error.message : String(error)
                );
              }
            }}
            hitSlop={8}
          >
            <Text
              style={{
                color: theme.colors.primary,
                fontSize: 14,
                fontWeight: '700',
                opacity: passwordLoaded ? 1 : 0.45,
              }}
            >
              保存
            </Text>
          </Pressable>
        }
      />
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 36 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            backgroundColor: theme.colors.primarySoft,
            borderRadius: RADIUS.card,
            ...CONTINUOUS_CORNER,
            padding: 16,
            marginBottom: 16,
          }}
        >
          <View
            style={{
              width: 42,
              height: 42,
              borderRadius: RADIUS.control,
              backgroundColor: theme.colors.primary,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name="cloud-outline" size={21} color="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: theme.colors.text, fontSize: 14.5, fontWeight: '700' }}>
              Koofr 已经填好默认地址
            </Text>
            <Text style={{ color: theme.colors.textSecondary, fontSize: 11.5, lineHeight: 17, marginTop: 3 }}>
              在 Koofr 设置里生成一个应用密码，填到下方即可。
            </Text>
          </View>
        </View>

        <SectionTitle title="连接" />
        <Card style={{ gap: 14 }}>
          <Field
            label="服务器地址"
            value={url}
            onChangeText={setUrl}
            placeholder={KOOFIR_WEBDAV_URL}
            autoCapitalize="none"
          />
          <Field
            label="用户名"
            value={username}
            onChangeText={setUsername}
            placeholder="Koofr 登录邮箱"
            autoCapitalize="none"
          />
          <Field
            label="应用密码"
            value={password}
            onChangeText={setPassword}
            placeholder="不要填网页登录密码"
            secureTextEntry
            autoCapitalize="none"
          />
          <Field
            label="同步文件夹"
            value={folder}
            onChangeText={setFolder}
            placeholder="Kissly"
            autoCapitalize="none"
          />

          <Pressable
            onPress={test}
            disabled={testing || !passwordLoaded}
            style={{
              height: 44,
              borderRadius: RADIUS.control,
              ...CONTINUOUS_CORNER,
              backgroundColor: theme.colors.surfaceAlt,
              alignItems: 'center',
              justifyContent: 'center',
              flexDirection: 'row',
              gap: 8,
              opacity: testing || !passwordLoaded ? 0.6 : 1,
            }}
          >
            {testing ? <ActivityIndicator size="small" color={theme.colors.primary} /> : <Ionicons name="pulse" size={16} color={theme.colors.primary} />}
            <Text style={{ color: theme.colors.text, fontSize: 13, fontWeight: '700' }}>
              {testing ? '正在连接…' : '测试连接'}
            </Text>
          </Pressable>
        </Card>

        <Pressable
          feedback="opacity"
          onPress={() => Linking.openURL('https://app.koofr.net')}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 5,
            marginTop: 10,
            paddingHorizontal: 4,
          }}
        >
          <Ionicons name="open-outline" size={14} color={theme.colors.textTertiary} />
          <Text style={{ color: theme.colors.textTertiary, fontSize: 11.5 }}>打开 Koofr 生成应用密码</Text>
        </Pressable>

        <SectionTitle title="同步行为" />
        <Card style={{ paddingVertical: 4 }}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
              paddingVertical: 13,
            }}
          >
            <View style={{ flex: 1 }}>
              <Text style={{ color: theme.colors.text, fontSize: 14, fontWeight: '600' }}>启用 WebDAV 同步</Text>
              <Text style={{ color: theme.colors.textTertiary, fontSize: 11.5, marginTop: 3 }}>
                启动 App 时自动合并，10 分钟内不重复请求
              </Text>
            </View>
            <SettingSwitch value={enabled} onValueChange={setEnabled} />
          </View>
          <View
            style={{
              borderTopWidth: StyleSheet.hairlineWidth,
              borderTopColor: theme.colors.border,
              paddingVertical: 13,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
            }}
          >
            <View style={{ flex: 1 }}>
              <Text style={{ color: theme.colors.text, fontSize: 13, fontWeight: '600' }}>上次同步</Text>
              <Text style={{ color: theme.colors.textTertiary, fontSize: 11.5, marginTop: 3 }}>
                {lastSyncAt ? relativeTime(lastSyncAt) : '从未同步'}
                {syncState === 'error' && syncMessage ? ` · ${syncMessage}` : ''}
              </Text>
            </View>
            {syncing || syncState === 'syncing' ? (
              <ActivityIndicator color={theme.colors.primary} />
            ) : (
              <Ionicons
                name="checkmark-circle"
                size={20}
                color={syncState === 'error' ? theme.colors.danger : theme.colors.success}
              />
            )}
          </View>
        </Card>

        <Pressable
          tone="onColor"
          onPress={runSync}
          disabled={syncing || !passwordLoaded}
          style={{
            marginTop: 20,
            height: 52,
            borderRadius: RADIUS.control,
            ...CONTINUOUS_CORNER,
            backgroundColor: theme.colors.primary,
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'row',
            gap: 8,
            opacity: syncing || !passwordLoaded ? 0.7 : 1,
          }}
        >
          {syncing ? <ActivityIndicator color="#fff" /> : <Ionicons name="sync" size={18} color="#fff" />}
          <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>
            {syncing ? '正在同步…' : '保存并立即同步'}
          </Text>
        </Pressable>

        <Text style={{ color: theme.colors.textTertiary, fontSize: 11.5, lineHeight: 18, marginTop: 16, paddingHorizontal: 4 }}>
          同步只上传订阅列表和可同步的设置，不包含任何 API Key。密码保存在系统安全存储里。
        </Text>
      </ScrollView>
    </View>
  );
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  secureTextEntry,
  autoCapitalize,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  secureTextEntry?: boolean;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
}) {
  const theme = useAppTheme();
  return (
    <View>
      <Text style={{ color: theme.colors.textSecondary, fontSize: 11.5, fontWeight: '600', marginBottom: 6 }}>
        {label}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.textTertiary}
        secureTextEntry={secureTextEntry}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        style={{
          height: 44,
          borderRadius: RADIUS.control,
          backgroundColor: theme.colors.surfaceAlt,
          paddingHorizontal: 12,
          color: theme.colors.text,
          fontSize: 13,
        }}
      />
    </View>
  );
}
