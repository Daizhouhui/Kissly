import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
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
import {
  getSecret,
  setSecret,
  webdavProfileSecretName,
} from '../../src/core/secrets';
import { useAppStore } from '../../src/core/store';
import { syncNow, testWebdav } from '../../src/core/sync';
import { relativeTime } from '../../src/core/utils';
import {
  findMatchingWebdavProfile,
  loadWebdavProfiles,
  newWebdavProfileId,
  saveWebdavProfiles,
  upsertWebdavProfile,
  type WebdavSavedProfile,
} from '../../src/core/webdavProfiles';
import { CONTINUOUS_CORNER, RADIUS } from '../../src/tokens';
import { appAlert as Alert } from '../../src/ui/app-alert';
import { toast } from '../../src/ui/app-toast';
import { AppPressable } from '../../src/ui/app-pressable';
import { Card, NavHeader, SectionTitle, SettingSwitch } from '../../src/ui/components';
import { useAppTheme } from '../../src/ui/theme';

const Pressable = AppPressable;

type WebdavProvider = {
  id: string;
  name: string;
  url: string;
  usernamePlaceholder: string;
  passwordLabel: string;
  passwordPlaceholder: string;
  helpUrl: string;
  helpLabel: string;
  note?: string;
};

const WEBDAV_PROVIDERS: WebdavProvider[] = [
  {
    id: 'jianguoyun',
    name: '坚果云',
    url: 'https://dav.jianguoyun.com/dav/',
    usernamePlaceholder: '坚果云注册邮箱',
    passwordLabel: '应用密码',
    passwordPlaceholder: '第三方应用密码',
    helpUrl: 'https://www.jianguoyun.com/#/safety',
    helpLabel: '打开坚果云生成应用密码',
  },
  {
    id: '123pan',
    name: '123云盘',
    url: 'https://webdav.123pan.cn/webdav',
    usernamePlaceholder: '123云盘账号',
    passwordLabel: '应用密码',
    passwordPlaceholder: '第三方挂载应用密码',
    helpUrl: 'https://www.123pan.com/thirdPartyMount',
    helpLabel: '打开 123 云盘生成挂载密码',
    note: '在「第三方挂载」里生成应用密码，服务器地址保持 /webdav 路径。',
  },
  {
    id: 'ctfile',
    name: '城通网盘',
    url: 'https://webdav.ctfile.com/',
    usernamePlaceholder: '城通网盘账号',
    passwordLabel: '账号密码',
    passwordPlaceholder: '城通网盘登录密码',
    helpUrl: 'https://www.ctfile.com/',
    helpLabel: '打开城通网盘获取 WebDAV 信息',
    note: '城通 WebDAV 条款不支持同步/备份，地址也可能需要补全个人专属路径。',
  },
  {
    id: 'koofr',
    name: 'Koofr',
    url: KOOFIR_WEBDAV_URL,
    usernamePlaceholder: 'Koofr 登录邮箱',
    passwordLabel: '应用密码',
    passwordPlaceholder: '应用专用密码',
    helpUrl: 'https://app.koofr.net',
    helpLabel: '打开 Koofr 生成应用密码',
  },
  {
    id: 'pcloud',
    name: 'pCloud',
    url: 'https://webdav.pcloud.com',
    usernamePlaceholder: 'pCloud 登录邮箱',
    passwordLabel: '账号密码',
    passwordPlaceholder: 'pCloud 登录密码',
    helpUrl: 'https://help.pcloud.com/article/webdav',
    helpLabel: '查看 pCloud WebDAV 设置',
    note: '欧洲区账号请把地址改为 https://ewebdav.pcloud.com。',
  },
  {
    id: 'infinicloud',
    name: 'InfiniCLOUD',
    url: 'https://你的节点.infini-cloud.net/dav/',
    usernamePlaceholder: 'InfiniCLOUD 用户 ID',
    passwordLabel: '应用密码',
    passwordPlaceholder: '外部应用连接密码',
    helpUrl: 'https://infini-cloud.net/en/support_service_aboutwebdav.html',
    helpLabel: '查看 InfiniCLOUD WebDAV 设置',
    note: '每个账号的节点地址不同，请把「你的节点」替换为 My Page 显示的地址。',
  },
];

function normalizeServerUrl(value: string) {
  return value.trim().replace(/\/+$/, '');
}

function findProvider(url: string) {
  const normalizedUrl = normalizeServerUrl(url);
  return WEBDAV_PROVIDERS.find((provider) => {
    const baseUrl = normalizeServerUrl(provider.url);
    return (
      normalizedUrl === baseUrl || normalizedUrl.startsWith(`${baseUrl}/`)
    );
  });
}

function profileNameFor(url: string) {
  const provider = findProvider(url);
  if (provider) return provider.name;
  try {
    return new URL(url).hostname.replace(/^www\./, '') || '自定义 WebDAV';
  } catch {
    return '自定义 WebDAV';
  }
}

export default function WebdavSettingsScreen() {
  const theme = useAppTheme();
  const settings = useAppStore((state) => state.settings);
  const hydrated = useAppStore((state) => state.hydrated);
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
  const [profiles, setProfiles] = useState<WebdavSavedProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState('');
  // The form mounts before AsyncStorage rehydration in some cold-start
  // cases, so initialize from defaults and refill once the saved config
  // arrives. Never overwrite text the user is currently editing.
  const formEdited = useRef(false);
  const profilesLoaded = useRef(false);
  const activeProvider = findProvider(url);
  const currentSavedProfile =
    profiles.find((profile) => profile.id === selectedProfileId) ??
    findMatchingWebdavProfile(profiles, { url, username, folder });

  useEffect(() => {
    if (formEdited.current) return;
    setUrl(settings.webdav.url || KOOFIR_WEBDAV_URL);
    setUsername(settings.webdav.username);
    setFolder(settings.webdav.folder || 'Kissly');
    setEnabled(settings.webdav.enabled);
  }, [
    settings.webdav.url,
    settings.webdav.username,
    settings.webdav.folder,
    settings.webdav.enabled,
  ]);

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

  useEffect(() => {
    if (!hydrated || profilesLoaded.current) return;
    profilesLoaded.current = true;
    let active = true;
    (async () => {
      let list = await loadWebdavProfiles();
      const current = useAppStore.getState().settings.webdav;
      let matched = findMatchingWebdavProfile(list, current);
      // Preserve the single configuration from older builds as the first
      // saved profile, including its password in the per-profile secret.
      if (!matched && current.url.trim() && current.username.trim()) {
        const id = newWebdavProfileId();
        const storedPassword = await getSecret('webdavPassword');
        if (storedPassword) {
          await setSecret(webdavProfileSecretName(id), storedPassword);
        }
        matched = {
          id,
          name: profileNameFor(current.url),
          providerId: findProvider(current.url)?.id ?? '',
          url: current.url.trim() || KOOFIR_WEBDAV_URL,
          username: current.username.trim(),
          folder: current.folder.trim() || 'Kissly',
          updatedAt: Date.now(),
        };
        list = upsertWebdavProfile(list, matched);
        await saveWebdavProfiles(list);
      }
      if (!active) return;
      setProfiles(list);
      setSelectedProfileId(matched?.id ?? '');
    })();
    return () => {
      active = false;
    };
  }, [hydrated]);

  const persist = async (enabledOverride?: boolean) => {
    // Saving before the SecureStore read completes would overwrite the stored
    // password with the empty initial input.
    if (!passwordLoaded) return;
    const nextConfig = {
      url: url.trim() || KOOFIR_WEBDAV_URL,
      username: username.trim(),
      folder: folder.trim() || 'Kissly',
      enabled: enabledOverride ?? enabled,
    };
    const existing =
      (selectedProfileId
        ? profiles.find((profile) => profile.id === selectedProfileId)
        : undefined) ?? findMatchingWebdavProfile(profiles, nextConfig);
    const profile: WebdavSavedProfile = {
      id: existing?.id ?? newWebdavProfileId(),
      name: profileNameFor(nextConfig.url),
      providerId: findProvider(nextConfig.url)?.id ?? '',
      url: nextConfig.url,
      username: nextConfig.username,
      folder: nextConfig.folder,
      updatedAt: Date.now(),
    };
    const nextProfiles = upsertWebdavProfile(profiles, profile);
    await setSecret(webdavProfileSecretName(profile.id), password);
    await setSecret('webdavPassword', password);
    await saveWebdavProfiles(nextProfiles);
    setProfiles(nextProfiles);
    setSelectedProfileId(profile.id);
    patchSettings({
      webdav: {
        ...nextConfig,
        password,
      },
    });
    formEdited.current = false;
  };

  const switchProfile = async (profile: WebdavSavedProfile) => {
    const savedPassword = await getSecret(
      webdavProfileSecretName(profile.id)
    );
    const current = useAppStore.getState().settings.webdav;
    // Older builds only had the single global secret. Reuse it only if this
    // is the profile that is already active; never leak it to another account.
    const fallbackPassword = findMatchingWebdavProfile([profile], current)
      ? await getSecret('webdavPassword')
      : '';
    const nextPassword = savedPassword || fallbackPassword;
    await setSecret('webdavPassword', nextPassword);
    setUrl(profile.url);
    setUsername(profile.username);
    setPassword(nextPassword);
    setFolder(profile.folder);
    setSelectedProfileId(profile.id);
    patchSettings({
      webdav: {
        ...current,
        url: profile.url,
        username: profile.username,
        password: nextPassword,
        folder: profile.folder,
      },
    });
    formEdited.current = false;
  };

  const clearSaved = () => {
    if (!currentSavedProfile) return;
    const profile = currentSavedProfile;
    Alert.alert(
      '清空保存？',
      `将删除「${profile.name}」在本机保存的账号和密码，不会删除网盘里的文件。`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: '清空并保存',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              const nextProfiles = profiles.filter(
                (item) => item.id !== profile.id
              );
              await setSecret(webdavProfileSecretName(profile.id), '');
              await setSecret('webdavPassword', '');
              await saveWebdavProfiles(nextProfiles);
              setProfiles(nextProfiles);
              setSelectedProfileId('');
              setUsername('');
              setPassword('');
              setFolder('Kissly');
              setEnabled(false);
              const current = useAppStore.getState().settings.webdav;
              setUrl(current.url);
              patchSettings({
                webdav: {
                  ...current,
                  username: '',
                  password: '',
                  folder: 'Kissly',
                  enabled: false,
                },
              });
              formEdited.current = false;
              toast.success('已清空保存');
            })().catch((error) => {
              toast.error(
                `清空失败：${error instanceof Error ? error.message : String(error)}`
              );
            });
          },
        },
      ]
    );
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
      toast.success('连接成功，WebDAV 目录可以访问');
    } catch (error) {
      toast.error(
        `连接失败：${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      setTesting(false);
    }
  };

  const runSync = async () => {
    if (!passwordLoaded) return;
    if (!url.trim() || !username.trim() || !password) {
      toast.info('配置不完整，请先填写服务器地址、用户名和密码');
      return;
    }
    setSyncing(true);
    try {
      await persist(true);
      setEnabled(true);
      const message = await syncNow();
      toast.success(message);
    } catch (error) {
      toast.error(
        `同步失败：${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      setSyncing(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <NavHeader
        title="WebDAV 同步"
        subtitle="订阅、收藏与进度跨设备漫游"
        right={
          <Pressable
            feedback="opacity"
            disabled={!passwordLoaded}
            onPress={async () => {
              try {
                await persist();
                toast.success('已保存');
              } catch (error) {
                toast.error(
                  `保存失败：${error instanceof Error ? error.message : String(error)}`
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
        <SectionTitle title="新建连接" />
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: 8,
            marginBottom: activeProvider?.note ? 10 : 16,
          }}
        >
          {WEBDAV_PROVIDERS.map((provider) => {
            const selected = activeProvider?.id === provider.id;
            const savedProfiles = profiles.filter(
              (profile) =>
                profile.providerId === provider.id ||
                findProvider(profile.url)?.id === provider.id
            );
            const currentIndex = savedProfiles.findIndex(
              (profile) => profile.id === selectedProfileId
            );
            const nextSavedProfile = savedProfiles.length
              ? currentIndex >= 0
                ? savedProfiles[(currentIndex + 1) % savedProfiles.length]
                : savedProfiles[savedProfiles.length - 1]
              : undefined;
            return (
              <Pressable
                key={provider.id}
                feedback="opacity"
                accessibilityRole="button"
                accessibilityLabel={
                  savedProfiles.length
                    ? `${provider.name}，已保存 ${savedProfiles.length} 个配置`
                    : provider.name
                }
                onPress={() => {
                  if (nextSavedProfile) {
                    void switchProfile(nextSavedProfile).catch((error) => {
                      toast.error(
                        `切换失败：${error instanceof Error ? error.message : String(error)}`
                      );
                    });
                    return;
                  }
                  formEdited.current = true;
                  if (activeProvider?.id !== provider.id) {
                    setSelectedProfileId('');
                    setUsername('');
                    setPassword('');
                  }
                  setUrl(provider.url);
                }}
                style={{
                  height: 36,
                  paddingHorizontal: 13,
                  borderRadius: RADIUS.control,
                  ...CONTINUOUS_CORNER,
                  borderWidth: StyleSheet.hairlineWidth,
                  borderColor: selected
                    ? theme.colors.primary
                    : theme.colors.border,
                  backgroundColor: selected
                    ? theme.colors.primarySoft
                    : theme.colors.surface,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 3,
                  }}
                >
                  <Text
                    style={{
                      color: selected
                        ? theme.colors.primary
                        : theme.colors.textSecondary,
                      fontSize: 12.5,
                      fontWeight: selected ? '700' : '600',
                    }}
                  >
                    {provider.name}
                  </Text>
                  {savedProfiles.length ? (
                    <Ionicons
                      name="checkmark-circle"
                      size={13}
                      color={theme.colors.primary}
                    />
                  ) : null}
                </View>
              </Pressable>
            );
          })}
        </View>
        {activeProvider?.note ? (
          <Text
            style={{
              color: theme.colors.textTertiary,
              fontSize: 11.5,
              lineHeight: 17,
              marginTop: -4,
              marginBottom: 14,
              paddingHorizontal: 4,
            }}
          >
            {activeProvider.note}
          </Text>
        ) : null}

        <SectionTitle
          title="连接"
          action={
            currentSavedProfile ? (
              <Pressable
                feedback="opacity"
                accessibilityRole="button"
                hitSlop={8}
                onPress={clearSaved}
              >
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  <Ionicons
                    name="trash-outline"
                    size={13}
                    color={theme.colors.textTertiary}
                  />
                  <Text
                    style={{
                      color: theme.colors.textTertiary,
                      fontSize: 11.5,
                      fontWeight: '600',
                    }}
                  >
                    清空保存
                  </Text>
                </View>
              </Pressable>
            ) : undefined
          }
        />
        <Card style={{ gap: 14 }}>
          <Field
            label="服务器地址"
            value={url}
            onChangeText={(value) => {
              formEdited.current = true;
              setUrl(value);
            }}
            placeholder={KOOFIR_WEBDAV_URL}
            autoCapitalize="none"
          />
          <Field
            label="用户名"
            value={username}
            onChangeText={(value) => {
              formEdited.current = true;
              setUsername(value);
            }}
            placeholder={activeProvider?.usernamePlaceholder ?? 'WebDAV 用户名'}
            autoCapitalize="none"
          />
          <Field
            label={activeProvider?.passwordLabel ?? '密码'}
            value={password}
            onChangeText={setPassword}
            placeholder={activeProvider?.passwordPlaceholder ?? 'WebDAV 密码'}
            secureTextEntry
            autoCapitalize="none"
          />
          <Field
            label="同步文件夹"
            value={folder}
            onChangeText={(value) => {
              formEdited.current = true;
              setFolder(value);
            }}
            placeholder="Kissly"
            autoCapitalize="none"
          />

          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Pressable
              onPress={test}
              disabled={testing || syncing || !passwordLoaded}
              style={{
                flex: 1,
                height: 44,
                borderRadius: RADIUS.control,
                ...CONTINUOUS_CORNER,
                backgroundColor: theme.colors.surfaceAlt,
                alignItems: 'center',
                justifyContent: 'center',
                flexDirection: 'row',
                gap: 6,
                opacity: testing || syncing || !passwordLoaded ? 0.6 : 1,
              }}
            >
              {testing ? (
                <ActivityIndicator size="small" color={theme.colors.primary} />
              ) : (
                <Ionicons name="pulse" size={16} color={theme.colors.primary} />
              )}
              <Text
                numberOfLines={1}
                style={{ color: theme.colors.text, fontSize: 13, fontWeight: '700' }}
              >
                {testing ? '正在连接…' : '测试连接'}
              </Text>
            </Pressable>

            <Pressable
              tone="onColor"
              onPress={runSync}
              disabled={syncing || testing || !passwordLoaded}
              style={{
                flex: 1.25,
                height: 44,
                borderRadius: RADIUS.control,
                ...CONTINUOUS_CORNER,
                backgroundColor: theme.colors.primary,
                alignItems: 'center',
                justifyContent: 'center',
                flexDirection: 'row',
                gap: 6,
                opacity: syncing || testing || !passwordLoaded ? 0.7 : 1,
              }}
            >
              {syncing ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Ionicons name="sync" size={16} color="#fff" />
              )}
              <Text
                numberOfLines={1}
                style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}
              >
                {syncing ? '正在同步…' : '保存并立即同步'}
              </Text>
            </Pressable>
          </View>
        </Card>

        {activeProvider?.helpUrl ? (
          <Pressable
            feedback="opacity"
            onPress={() => Linking.openURL(activeProvider.helpUrl!)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 5,
              marginTop: 10,
              paddingHorizontal: 4,
            }}
          >
            <Ionicons name="open-outline" size={14} color={theme.colors.textTertiary} />
            <Text style={{ color: theme.colors.textTertiary, fontSize: 11.5 }}>
              {activeProvider.helpLabel}
            </Text>
          </Pressable>
        ) : null}

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
              <Text style={{ color: theme.colors.text, fontSize: 14, fontWeight: '600' }}>启用自动同步</Text>
              <Text style={{ color: theme.colors.textTertiary, fontSize: 11.5, marginTop: 3 }}>
                启动 App 时自动合并，10 分钟内不重复请求；手动同步会自动开启
              </Text>
            </View>
            <SettingSwitch
              value={enabled}
              onValueChange={(value) => {
                formEdited.current = true;
                setEnabled(value);
              }}
            />
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

        <Text style={{ color: theme.colors.textTertiary, fontSize: 11.5, lineHeight: 18, marginTop: 16, paddingHorizontal: 4 }}>
          同步订阅、视频收藏、句子收藏和播放进度。模型、API Key、字幕样式与主题不上传；进度最多每 3 分钟写入一次。密码保存在系统安全存储里。
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
