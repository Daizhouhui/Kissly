import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import type { AlertButton, AlertOptions } from 'react-native';

import { AppPressable } from './app-pressable';
import { RADIUS } from '../tokens';
import { useAppTheme } from './theme';

type DialogConfig = {
  title: string;
  message?: string;
  buttons: AlertButton[];
};

type Presenter = (config: DialogConfig) => void;

let presenter: Presenter | null = null;

function normalizeButtons(buttons?: AlertButton[]): AlertButton[] {
  if (buttons?.length) return buttons;
  return [{ text: '确定', style: 'default' }];
}

/**
 * Android's native Alert is visually detached from the rest of Kissly.
 * iOS keeps its native alert; Android/web use the rounded card below.
 */
export const appAlert = {
  alert(title: string, message?: string, buttons?: AlertButton[], options?: AlertOptions) {
    if (Platform.OS === 'ios') {
      Alert.alert(title, message, buttons, options);
      return;
    }
    const config = {
      title,
      message,
      buttons: normalizeButtons(buttons),
    };
    if (presenter) {
      presenter(config);
      return;
    }
    Alert.alert(title, message, buttons, options);
  },
};

export function AppAlertHost() {
  const theme = useAppTheme();
  const { width } = useWindowDimensions();
  const [config, setConfig] = useState<DialogConfig | null>(null);

  useEffect(() => {
    presenter = setConfig;
    return () => {
      presenter = null;
    };
  }, []);

  const cancelButton = useMemo(
    () => config?.buttons.find((button) => button.style === 'cancel'),
    [config]
  );

  const close = (button?: AlertButton) => {
    setConfig(null);
    if (button?.onPress) {
      // Let the modal disappear before a navigation/confirmation side effect.
      setTimeout(button.onPress, 0);
    }
  };

  const dismiss = () => {
    if (!config) return;
    if (cancelButton) {
      close(cancelButton);
      return;
    }
    setConfig(null);
  };

  if (!config) return null;

  const destructive = config.buttons.some((button) => button.style === 'destructive');
  const isSingle = config.buttons.length === 1;
  const cardWidth = Math.min(348, width - 48);

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={dismiss}
    >
      <Pressable style={[styles.mask, { backgroundColor: theme.colors.overlay }]} onPress={dismiss}>
        <Pressable
          onPress={() => {}}
          style={[
            styles.card,
            {
              width: cardWidth,
              backgroundColor: theme.colors.card,
              borderColor: theme.colors.border,
            },
            theme.shadow.floating,
          ]}
        >
          <View style={styles.copy}>
            <Text style={[styles.title, { color: theme.colors.text }]}>{config.title}</Text>
            {config.message ? (
              <Text style={[styles.message, { color: theme.colors.textSecondary }]}>
                {config.message}
              </Text>
            ) : null}
          </View>

          <View style={[styles.actions, !isSingle && styles.actionsRow]}>
            {config.buttons.map((button, index) => {
              const isCancel = button.style === 'cancel';
              const isDestructive = button.style === 'destructive';
              const background = isDestructive
                ? theme.dark
                  ? 'rgba(255,123,114,0.14)'
                  : '#FCEBEA'
                : isCancel
                  ? theme.colors.surfaceAlt
                  : theme.colors.primary;
              const foreground = isDestructive
                ? theme.colors.danger
                : isCancel
                  ? theme.colors.textSecondary
                  : theme.dark
                    ? '#0C0D0F'
                    : '#FFFFFF';
              return (
                <AppPressable
                  key={`${button.text ?? 'button'}-${index}`}
                  feedback="ripple"
                  tone={isCancel ? 'surface' : 'onColor'}
                  radius={RADIUS.control}
                  onPress={() => close(button)}
                  style={[
                    styles.button,
                    { backgroundColor: background },
                    !isSingle && styles.buttonInRow,
                  ]}
                  accessibilityLabel={button.text ?? '确定'}
                >
                  <Text
                    style={[
                      styles.buttonLabel,
                      { color: foreground },
                      isDestructive && styles.destructiveLabel,
                    ]}
                  >
                    {button.text ?? '确定'}
                  </Text>
                </AppPressable>
              );
            })}
          </View>

          {config.buttons.length === 1 && destructive ? (
            <Text
              style={{
                color: theme.colors.textTertiary,
                fontSize: 11,
                textAlign: 'center',
                marginTop: 14,
              }}
            >
              此操作无法撤销
            </Text>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  mask: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.54)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: RADIUS.modal,
    borderCurve: 'continuous',
    paddingTop: 24,
    paddingBottom: 18,
    paddingHorizontal: 18,
    overflow: 'hidden',
  },
  copy: { paddingHorizontal: 4, paddingBottom: 20 },
  title: { fontSize: 18, fontWeight: '800', letterSpacing: -0.2 },
  message: { fontSize: 14, lineHeight: 21, marginTop: 8 },
  actions: { gap: 8 },
  actionsRow: { flexDirection: 'row' },
  button: {
    height: 48,
    borderRadius: RADIUS.control,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  buttonInRow: { flex: 1 },
  buttonLabel: { fontSize: 14.5, fontWeight: '800' },
  destructiveLabel: { fontWeight: '800' },
});
