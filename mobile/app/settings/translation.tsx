import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { PROVIDER_HINTS, PROVIDER_LABELS } from '../../src/core/defaults';
import { getSecret, setSecret } from '../../src/core/secrets';
import { useAppStore } from '../../src/core/store';
import {
  AutoFreeProviderId,
  AutoPaidProviderId,
  ProviderId,
} from '../../src/core/types';
import { testTranslation } from '../../src/core/translate';
import { UnsupportedSystemLanguageError } from '../../src/core/translate/language';
import {
  isSystemTranslationAvailable,
  prepareSystemLanguagePack,
} from '../../src/core/translate/system';
import { CONTINUOUS_CORNER, RADIUS } from '../../src/tokens';
import { appAlert as Alert } from '../../src/ui/app-alert';
import { AppPressable } from '../../src/ui/app-pressable';
import { Card, NavHeader, SectionTitle, SettingSwitch } from '../../src/ui/components';
import { useAppTheme } from '../../src/ui/theme';

const Pressable = AppPressable;

type Engine = {
  id: ProviderId;
  title: string;
  desc: string;
  icon: any;
  color: string;
  badge?: string;
};

const FREE: Engine[] = [
  {
    id: 'auto',
    title: '自动',
    desc: '已缓存优先 · 免费/付费顺序可调',
    icon: 'flash',
    color: '#7C5CFF',
    badge: '推荐',
  },
  {
    id: 'google',
    title: 'Google',
    desc: '网页免费接口 · 国内需代理',
    icon: 'logo-google',
    color: '#EA4335',
    badge: '免费',
  },
  {
    id: 'system',
    title: '系统内置',
    desc: 'ML Kit 离线翻译 · 首次下载语言包',
    icon: 'phone-portrait-outline',
    color: '#7C5CFF',
    badge: '离线',
  },
  {
    id: 'microsoft',
    title: 'Microsoft',
    desc: 'Edge 免费接口 · 无需 Key',
    icon: 'logo-windows',
    color: '#2563EB',
    badge: '免费',
  },
  {
    id: 'google2',
    title: 'Google 备用',
    desc: '内置公共预设 · 自动链最后兜底，也可手动选择',
    icon: 'logo-google',
    color: '#34A853',
    badge: '备用',
  },
];

const AI: Engine[] = [
  {
    id: 'siliconflow',
    title: 'SiliconFlow',
    desc: '国内直连，可选免费模型',
    icon: 'layers',
    color: '#7C5CFF',
    badge: '免费额度',
  },
  {
    id: 'deepseek',
    title: 'DeepSeek',
    desc: '字幕翻译质量最好，按 token 计费',
    icon: 'sparkles',
    color: '#12B886',
    badge: '推荐',
  },
  {
    id: 'openai',
    title: 'OpenAI 兼容',
    desc: '任意兼容接口，自填 Base URL',
    icon: 'chatbubble-ellipses',
    color: '#111827',
    badge: 'Premium',
  },
];

export default function TranslationSettingsScreen() {
  const theme = useAppTheme();
  const settings = useAppStore((state) => state.settings);
  const patchSettings = useAppStore((state) => state.patchSettings);
  const [provider, setProvider] = useState<ProviderId>(settings.provider);
  const [deepseekKey, setDeepseekKey] = useState('');
  const [siliconflowKey, setSiliconflowKey] = useState('');
  const [openaiKey, setOpenaiKey] = useState('');
  const [testing, setTesting] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [systemAvailable, setSystemAvailable] = useState(false);
  const [secretsLoaded, setSecretsLoaded] = useState(false);

  useEffect(() => {
    Promise.all([getSecret('deepseek'), getSecret('siliconflow'), getSecret('openai')]).then(
      ([a, b, c]) => {
        setDeepseekKey(a);
        setSiliconflowKey(b);
        setOpenaiKey(c);
        setSecretsLoaded(true);
      }
    );
  }, []);

  useEffect(() => {
    let active = true;
    isSystemTranslationAvailable().then((available) => {
      if (!active) return;
      setSystemAvailable(available);
      if (!available) {
        setProvider((current) => (current === 'system' ? 'auto' : current));
        if (settings.provider === 'system') patchSettings({ provider: 'auto' });
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const selectProvider = (id: ProviderId) => {
    if (id === 'system') {
      Alert.alert(
        '下载语言包？',
        '系统内置翻译在手机上离线进行，需先下载语言包（每种约 30 MB），下载完成后自动启用。',
        [
          { text: '取消', style: 'cancel' },
          {
            text: '下载',
            onPress: async () => {
              setPreparing(true);
              try {
                await prepareSystemLanguagePack(
                  settings.sourceLang,
                  settings.targetLang
                );
                setProvider(id);
                patchSettings({ provider: id });
                Alert.alert('语言包已就绪', '系统内置翻译已启用，可以离线翻译字幕。');
              } catch (error) {
                Alert.alert(
                  error instanceof UnsupportedSystemLanguageError
                    ? '无法启用系统翻译'
                    : '语言包下载失败',
                  error instanceof Error ? error.message : String(error)
                );
              } finally {
                setPreparing(false);
              }
            },
          },
        ]
      );
      return;
    }
    setProvider(id);
    patchSettings({ provider: id });
  };

  const moveFree = (id: AutoFreeProviderId, delta: number) => {
    const order = useAppStore.getState().settings.autoFreeOrder;
    const index = order.indexOf(id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= order.length) return;
    const next = [...order];
    [next[index], next[target]] = [next[target], next[index]];
    patchSettings({ autoFreeOrder: next });
  };

  const movePaid = (id: AutoPaidProviderId, delta: number) => {
    const order = useAppStore.getState().settings.autoPaidOrder;
    const index = order.indexOf(id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= order.length) return;
    const next = [...order];
    [next[index], next[target]] = [next[target], next[index]];
    patchSettings({ autoPaidOrder: next });
  };

  const saveKeys = async () => {
    // Do not write the empty placeholders back over saved keys while the
    // SecureStore reads are still in flight.
    if (!secretsLoaded) return;
    await Promise.all([
      setSecret('deepseek', deepseekKey.trim()),
      setSecret('siliconflow', siliconflowKey.trim()),
      setSecret('openai', openaiKey.trim()),
    ]);
    patchSettings({ provider });
    Alert.alert('已保存', '翻译引擎与密钥已更新。');
  };

  const test = async () => {
    const target =
      provider === 'auto'
        ? (settings.autoFreeOrder[0] ?? 'microsoft')
        : provider;
    setTesting(true);
    try {
      // The test must use the key currently typed in the field, not the one
      // that happened to be saved before the user started editing.
      if (provider === 'deepseek') await setSecret('deepseek', deepseekKey.trim());
      if (provider === 'siliconflow') await setSecret('siliconflow', siliconflowKey.trim());
      if (provider === 'openai') await setSecret('openai', openaiKey.trim());
      const text = await testTranslation(target);
      Alert.alert('连接成功', `返回：${text}`);
    } catch (error) {
      Alert.alert('连接失败', error instanceof Error ? error.message : String(error));
    } finally {
      setTesting(false);
    }
  };

  const renderEngine = (engine: Engine, last: boolean) => {
    const active = provider === engine.id;
    return (
      <Pressable
        key={engine.id}
        feedback="opacity"
        radius={0}
        onPress={() => selectProvider(engine.id)}
        disabled={preparing}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          paddingVertical: 13,
          paddingHorizontal: 14,
          backgroundColor: active ? theme.colors.primarySoft : theme.colors.card,
          borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth,
          borderBottomColor: theme.colors.border,
          opacity: preparing ? 0.85 : 1,
        }}
      >
        <View
          style={{
            width: 38,
            height: 38,
            borderRadius: RADIUS.control,
            backgroundColor: `${engine.color}14`,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {preparing && engine.id === 'system' ? (
            <ActivityIndicator size="small" color={engine.color} />
          ) : (
            <Ionicons name={engine.icon} size={19} color={engine.color} />
          )}
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
            <Text style={{ color: theme.colors.text, fontSize: 15, fontWeight: '700' }}>{engine.title}</Text>
            {engine.badge ? (
              <View
                style={{
                  paddingHorizontal: 6,
                  paddingVertical: 2,
                  borderRadius: RADIUS.badge,
                  backgroundColor: active ? theme.colors.primary : theme.colors.surfaceAlt,
                }}
              >
                <Text
                  style={{
                    color: active ? '#FFFFFF' : theme.colors.textTertiary,
                    fontSize: 9,
                    fontWeight: '700',
                  }}
                >
                  {engine.badge}
                </Text>
              </View>
            ) : null}
          </View>
          <Text style={{ color: theme.colors.textTertiary, fontSize: 11.5, marginTop: 3 }} numberOfLines={1}>
            {engine.desc}
          </Text>
        </View>
        <View
          style={{
            width: 24,
            height: 24,
            borderRadius: RADIUS.pill,
            borderWidth: active ? 0 : 1.5,
            borderColor: theme.colors.borderStrong,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: active ? theme.colors.primary : 'transparent',
          }}
        >
          {active ? <Ionicons name="checkmark" size={14} color="#fff" /> : null}
        </View>
      </Pressable>
    );
  };

  const engineGroup = (engines: Engine[]) => (
    <View
      style={{
        backgroundColor: theme.colors.card,
        borderRadius: RADIUS.card,
        ...CONTINUOUS_CORNER,
        overflow: 'hidden',
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.border,
      }}
    >
      {engines.map((engine, index) => renderEngine(engine, index === engines.length - 1))}
    </View>
  );

  const freeEngines = FREE.filter(
    (engine) => engine.id !== 'system' || systemAvailable
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <NavHeader
        title="翻译引擎"
        subtitle="免费优先，AI 兜底"
        right={
          <Pressable
            onPress={saveKeys}
            disabled={!secretsLoaded}
            hitSlop={8}
            feedback="opacity"
          >
            <Text
              style={{
                color: theme.colors.primary,
                fontSize: 14,
                fontWeight: '700',
                opacity: secretsLoaded ? 1 : 0.45,
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
        <SectionTitle title="免费引擎" />
        {engineGroup(freeEngines)}

        <SectionTitle title="高级引擎" />
        {engineGroup(AI)}

        <Text style={{ color: theme.colors.textTertiary, fontSize: 11.5, lineHeight: 18, marginTop: 10, paddingHorizontal: 4 }}>
          {PROVIDER_HINTS[provider]}
        </Text>

        {provider === 'deepseek' || provider === 'siliconflow' || provider === 'openai' ? (
          <View style={{ marginTop: 18 }}>
            <SectionTitle title="接口配置" />
            <Card style={{ gap: 14 }}>
              {provider === 'openai' ? (
                <>
                  <Field
                    label="Base URL"
                    value={settings.openaiBaseUrl}
                    onChangeText={(value) => patchSettings({ openaiBaseUrl: value })}
                    placeholder="https://api.openai.com/v1"
                    autoCapitalize="none"
                  />
                  <Field
                    label="模型"
                    value={settings.openaiModel}
                    onChangeText={(value) => patchSettings({ openaiModel: value })}
                    placeholder="gpt-4o-mini"
                    autoCapitalize="none"
                  />
                </>
              ) : null}
              {provider === 'deepseek' ? (
                <Field
                  label="模型"
                  value={settings.deepseekModel}
                  onChangeText={(value) => patchSettings({ deepseekModel: value })}
                  placeholder="deepseek-chat"
                  autoCapitalize="none"
                />
              ) : null}
              {provider === 'siliconflow' ? (
                <Field
                  label="模型"
                  value={settings.siliconflowModel}
                  onChangeText={(value) => patchSettings({ siliconflowModel: value })}
                  placeholder="Qwen/Qwen3.5-9B"
                  autoCapitalize="none"
                />
              ) : null}
              <Field
                label="API Key"
                value={
                  provider === 'deepseek' ? deepseekKey : provider === 'siliconflow' ? siliconflowKey : openaiKey
                }
                onChangeText={
                  provider === 'deepseek'
                    ? setDeepseekKey
                    : provider === 'siliconflow'
                      ? setSiliconflowKey
                      : setOpenaiKey
                }
                placeholder="sk-…"
                secureTextEntry
                autoCapitalize="none"
              />
              <Pressable
                onPress={test}
                disabled={testing || !secretsLoaded}
                style={{
                  height: 44,
                  borderRadius: RADIUS.control,
                  ...CONTINUOUS_CORNER,
                  backgroundColor: theme.colors.surfaceAlt,
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexDirection: 'row',
                  gap: 8,
                  opacity: testing || !secretsLoaded ? 0.6 : 1,
                }}
              >
                {testing ? <ActivityIndicator size="small" color={theme.colors.primary} /> : null}
                <Text style={{ color: theme.colors.text, fontSize: 13, fontWeight: '700' }}>
                  {testing ? '正在测试…' : '测试连接'}
                </Text>
              </Pressable>
            </Card>
          </View>
        ) : null}

        {provider === 'auto' || provider === 'microsoft' || provider === 'google' || provider === 'google2' || provider === 'system' ? (
          <Pressable
            onPress={test}
            disabled={testing || !secretsLoaded}
            style={{
              marginTop: 18,
              height: 46,
              borderRadius: RADIUS.control,
              ...CONTINUOUS_CORNER,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: theme.colors.border,
              backgroundColor: theme.colors.card,
              alignItems: 'center',
              justifyContent: 'center',
              flexDirection: 'row',
              gap: 8,
              opacity: testing || !secretsLoaded ? 0.65 : 1,
            }}
          >
            {testing ? <ActivityIndicator size="small" color={theme.colors.primary} /> : <Ionicons name="pulse" size={17} color={theme.colors.primary} />}
            <Text style={{ color: theme.colors.text, fontSize: 13, fontWeight: '700' }}>
              {testing ? '正在测试免费接口…' : '测试当前免费接口'}
            </Text>
          </Pressable>
        ) : null}

        <SectionTitle title="自动模式顺序" />
        <Text
          style={{
            color: theme.colors.textTertiary,
            fontSize: 11.5,
            lineHeight: 18,
            marginTop: -2,
            marginBottom: 10,
            paddingHorizontal: 4,
          }}
        >
          自动模式会先查已缓存字幕；没有缓存时按下面顺序尝试，未填 Key 的引擎自动跳过。用箭头调整优先级。
        </Text>
        <Card style={{ paddingVertical: 6, paddingHorizontal: 10 }}>
          <Text
            style={{
              color: theme.colors.textSecondary,
              fontSize: 12,
              fontWeight: '700',
              paddingVertical: 6,
              paddingHorizontal: 4,
            }}
          >
            免费引擎
          </Text>
          {settings.autoFreeOrder.map((id, index) => (
            <ProviderOrderRow
              key={id}
              label={PROVIDER_LABELS[id] ?? id}
              index={index}
              total={settings.autoFreeOrder.length}
              onUp={() => moveFree(id, -1)}
              onDown={() => moveFree(id, 1)}
              last={index === settings.autoFreeOrder.length - 1}
            />
          ))}
        </Card>
        <Card
          style={{
            paddingVertical: 6,
            paddingHorizontal: 10,
            marginTop: 10,
          }}
        >
          <Text
            style={{
              color: theme.colors.textSecondary,
              fontSize: 12,
              fontWeight: '700',
              paddingVertical: 6,
              paddingHorizontal: 4,
            }}
          >
            付费引擎（仅在“免费失败自动用付费引擎”开启时尝试）
          </Text>
          {settings.autoPaidOrder.map((id, index) => (
            <ProviderOrderRow
              key={id}
              label={PROVIDER_LABELS[id] ?? id}
              index={index}
              total={settings.autoPaidOrder.length}
              onUp={() => movePaid(id, -1)}
              onDown={() => movePaid(id, 1)}
              last={index === settings.autoPaidOrder.length - 1}
            />
          ))}
        </Card>

        <SectionTitle title="翻译策略" />
        <Card style={{ paddingVertical: 4 }}>
          <SettingRow
            title="免费失败自动用付费引擎"
            desc="按上面的付费顺序尝试；未填写 Key 的引擎会跳过"
            value={settings.autoFallbackDeepSeek}
            onChange={(value) => patchSettings({ autoFallbackDeepSeek: value })}
          />
          <SettingRow
            title="翻译视频标题"
            desc="关闭后首页不再翻译标题；开启时按“我的”页选择双语或仅译文"
            value={settings.translateTitles}
            onChange={(value) => patchSettings({ translateTitles: value })}
            last
          />
        </Card>
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

function ProviderOrderRow({
  label,
  index,
  total,
  onUp,
  onDown,
  last,
}: {
  label: string;
  index: number;
  total: number;
  onUp: () => void;
  onDown: () => void;
  last?: boolean;
}) {
  const theme = useAppTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingVertical: 8,
        borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth,
        borderBottomColor: theme.colors.border,
      }}
    >
      <View
        style={{
          width: 22,
          height: 22,
          borderRadius: RADIUS.pill,
          backgroundColor: theme.colors.surfaceAlt,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text
          style={{
            color: theme.colors.textSecondary,
            fontSize: 10,
            fontWeight: '700',
          }}
        >
          {index + 1}
        </Text>
      </View>
      <Text
        numberOfLines={1}
        style={{ flex: 1, color: theme.colors.text, fontSize: 13, fontWeight: '600' }}
      >
        {label}
      </Text>
      <OrderArrow
        direction="up"
        label={`${label} 上移`}
        disabled={index === 0}
        onPress={onUp}
      />
      <OrderArrow
        direction="down"
        label={`${label} 下移`}
        disabled={index === total - 1}
        onPress={onDown}
      />
    </View>
  );
}

function OrderArrow({
  direction,
  label,
  disabled,
  onPress,
}: {
  direction: 'up' | 'down';
  label: string;
  disabled: boolean;
  onPress: () => void;
}) {
  const theme = useAppTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      hitSlop={6}
      feedback="opacity"
      onPress={onPress}
      style={{
        width: 30,
        height: 30,
        borderRadius: RADIUS.control,
        backgroundColor: theme.colors.surfaceAlt,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: disabled ? 0.35 : 1,
      }}
    >
      <Ionicons
        name={direction === 'up' ? 'chevron-up' : 'chevron-down'}
        size={17}
        color={theme.colors.textSecondary}
      />
    </Pressable>
  );
}

function SettingRow({
  title,
  desc,
  value,
  onChange,
  last,
}: {
  title: string;
  desc: string;
  value: boolean;
  onChange: (value: boolean) => void;
  last?: boolean;
}) {
  const theme = useAppTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 13,
        gap: 12,
        borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth,
        borderBottomColor: theme.colors.border,
      }}
    >
      <View style={{ flex: 1 }}>
        <Text style={{ color: theme.colors.text, fontSize: 14, fontWeight: '600' }}>{title}</Text>
        <Text style={{ color: theme.colors.textTertiary, fontSize: 11.5, marginTop: 3 }}>{desc}</Text>
      </View>
      <SettingSwitch value={value} onValueChange={onChange} />
    </View>
  );
}
