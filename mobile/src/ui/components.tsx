import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { ReactNode, useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  Animated,
  Modal,
  Pressable,
  ScrollView,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CONTINUOUS_CORNER, RADIUS } from '../tokens';
import { AppPressable } from './app-pressable';
import { PRESS_SCALE } from './motion';
import { useAppTheme } from './theme';

export function Screen({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useAppTheme();
  return (
    <View style={[{ flex: 1, backgroundColor: theme.colors.bg }, style]}>
      {children}
    </View>
  );
}

export function Header({
  title,
  subtitle,
  right,
  large = true,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  large?: boolean;
}) {
  const theme = useAppTheme();
  return (
    <View style={styles.header}>
      <View style={{ flex: 1 }}>
        <Text
          style={{
            color: theme.colors.text,
            fontSize: large ? 30 : 20,
            fontWeight: '800',
            letterSpacing: -0.6,
          }}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text
            style={{
              color: theme.colors.textSecondary,
              fontSize: 13,
              marginTop: 4,
              lineHeight: 18,
            }}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right ? <View style={styles.headerRight}>{right}</View> : null}
    </View>
  );
}

export function NavHeader({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
}) {
  const theme = useAppTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingTop: insets.top + 6,
        paddingBottom: 10,
        paddingHorizontal: 14,
        gap: 6,
      }}
    >
      <AppPressable
        onPress={() => router.back()}
        hitSlop={8}
        feedback="ripple"
        radius={RADIUS.pill}
        pressScale={PRESS_SCALE.pill}
        accessibilityLabel="返回"
        style={styles.navBack}
      >
        <Ionicons name="chevron-back" size={23} color={theme.colors.text} />
      </AppPressable>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ color: theme.colors.text, fontSize: 19, fontWeight: '800', letterSpacing: -0.3 }} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={{ color: theme.colors.textTertiary, fontSize: 11, marginTop: 1 }} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
    </View>
  );
}

export function IconButton({
  name,
  onPress,
  color,
  size = 22,
  bg,
  style,
}: {
  name: any;
  onPress?: () => void;
  color?: string;
  size?: number;
  bg?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useAppTheme();
  return (
    <AppPressable
      onPress={onPress}
      hitSlop={8}
      feedback="ripple"
      radius={RADIUS.pill}
      pressScale={PRESS_SCALE.pill}
      style={[
        styles.iconButton,
        {
          backgroundColor: bg ?? 'transparent',
        },
        style,
      ]}
    >
      <Ionicons name={name} size={size} color={color ?? theme.colors.textSecondary} />
    </AppPressable>
  );
}

export function Card({
  children,
  style,
  onPress,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
}) {
  const theme = useAppTheme();
  const surface = (
    <View
      style={[
        styles.cardSurface,
        {
          backgroundColor: theme.colors.card,
          borderColor: theme.colors.border,
          ...CONTINUOUS_CORNER,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
  if (!onPress) {
    return (
      <View
        style={[
          styles.cardShadow,
          { backgroundColor: theme.colors.card, ...CONTINUOUS_CORNER },
          theme.shadow.card,
        ]}
      >
        {surface}
      </View>
    );
  }
  return (
    <View
      style={[
        styles.cardShadow,
        {
          backgroundColor: theme.colors.card,
          ...CONTINUOUS_CORNER,
        },
        theme.shadow.card,
      ]}
    >
      <AppPressable
        onPress={onPress}
        feedback="ripple"
        radius={RADIUS.card}
        pressScale={PRESS_SCALE.card}
        accessibilityRole="button"
      >
        {surface}
      </AppPressable>
    </View>
  );
}

export function Row({
  icon,
  title,
  subtitle,
  value,
  onPress,
  danger,
  last,
}: {
  icon?: any;
  title: string;
  subtitle?: string;
  value?: string;
  onPress?: () => void;
  danger?: boolean;
  last?: boolean;
}) {
  const theme = useAppTheme();
  const inner = (
    <View
      style={[
        styles.row,
        !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.border },
      ]}
    >
      {icon ? (
        <View style={[styles.rowIcon, { backgroundColor: theme.colors.surfaceAlt }]}>
          <Ionicons name={icon} size={18} color={danger ? theme.colors.danger : theme.colors.primary} />
        </View>
      ) : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          style={{
            color: danger ? theme.colors.danger : theme.colors.text,
            fontSize: 15,
            fontWeight: '600',
          }}
          numberOfLines={1}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text
            style={{ color: theme.colors.textTertiary, fontSize: 12, marginTop: 2, lineHeight: 16 }}
            numberOfLines={1}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text style={{ color: theme.colors.textTertiary, fontSize: 12, marginLeft: 8 }} numberOfLines={1}>
          {value}
        </Text>
      ) : null}
      {onPress ? (
        <Ionicons name="chevron-forward" size={16} color={theme.colors.textTertiary} style={{ marginLeft: 6 }} />
      ) : null}
    </View>
  );
  if (!onPress) return inner;
  return (
    <AppPressable
      onPress={onPress}
      feedback="ripple"
      radius={0}
      pressTint
      accessibilityRole="button"
    >
      {inner}
    </AppPressable>
  );
}

export function PrimaryButton({
  label,
  onPress,
  loading,
  icon,
  disabled,
  style,
}: {
  label: string;
  onPress: () => void;
  loading?: boolean;
  icon?: any;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useAppTheme();
  return (
    <AppPressable
      onPress={onPress}
      disabled={disabled || loading}
      feedback="ripple"
      tone="onColor"
      radius={RADIUS.control}
      pressScale={PRESS_SCALE.control}
      accessibilityRole="button"
      style={[
        styles.primaryButton,
        { opacity: disabled ? 0.45 : 1 },
        style,
      ]}
    >
      <LinearGradient
        colors={[theme.colors.primary, theme.colors.primaryDeep]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{
          height: 52,
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'row',
          gap: 8,
          paddingHorizontal: 20,
        }}
      >
        {loading ? <ActivityIndicator color="#fff" /> : icon ? <Ionicons name={icon} size={18} color="#fff" /> : null}
        <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>{label}</Text>
      </LinearGradient>
    </AppPressable>
  );
}

export function GhostButton({
  label,
  onPress,
  icon,
}: {
  label: string;
  onPress: () => void;
  icon?: any;
}) {
  const theme = useAppTheme();
  return (
    <AppPressable
      onPress={onPress}
      feedback="ripple"
      radius={RADIUS.control}
      pressScale={PRESS_SCALE.control}
      accessibilityRole="button"
      style={[
        styles.ghostButton,
        { backgroundColor: theme.colors.surfaceAlt },
      ]}
    >
      {icon ? <Ionicons name={icon} size={16} color={theme.colors.text} /> : null}
      <Text style={{ color: theme.colors.text, fontSize: 13, fontWeight: '600' }}>{label}</Text>
    </AppPressable>
  );
}

export function Chip({
  label,
  active,
  onPress,
}: {
  label: string;
  active?: boolean;
  onPress?: () => void;
}) {
  const theme = useAppTheme();
  return (
    <AppPressable
      onPress={onPress}
      feedback="ripple"
      radius={RADIUS.control}
      pressScale={PRESS_SCALE.pill}
      accessibilityRole="button"
      style={[
        styles.chip,
        {
          backgroundColor: active ? theme.colors.text : theme.colors.surfaceAlt,
        },
      ]}
    >
      <Text style={{ color: active ? (theme.dark ? '#0F0D14' : '#fff') : theme.colors.textSecondary, fontSize: 12, fontWeight: '600' }}>
        {label}
      </Text>
    </AppPressable>
  );
}

export function SectionTitle({ title, action }: { title: string; action?: ReactNode }) {
  const theme = useAppTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, marginTop: 22 }}>
      <Text style={{ color: theme.colors.textSecondary, fontSize: 12, fontWeight: '700', letterSpacing: 1 }}>
        {title.toUpperCase()}
      </Text>
      {action}
    </View>
  );
}

export function EmptyState({
  icon,
  title,
  desc,
  action,
}: {
  icon: any;
  title: string;
  desc: string;
  action?: ReactNode;
}) {
  const theme = useAppTheme();
  return (
    <View style={{ alignItems: 'center', paddingVertical: 54, paddingHorizontal: 28 }}>
      <View
        style={{
          width: 72,
          height: 72,
          borderRadius: RADIUS.pill,
          backgroundColor: theme.colors.primarySoft,
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 16,
        }}
      >
        <Ionicons name={icon} size={30} color={theme.colors.primary} />
      </View>
      <Text style={{ color: theme.colors.text, fontSize: 17, fontWeight: '700', marginBottom: 6 }}>{title}</Text>
      <Text style={{ color: theme.colors.textSecondary, fontSize: 13, lineHeight: 20, textAlign: 'center', marginBottom: 18 }}>
        {desc}
      </Text>
      {action}
    </View>
  );
}

export function Sheet({
  visible,
  onClose,
  title,
  desc,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  desc?: string;
  children: ReactNode;
}) {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const translateY = useRef(new Animated.Value(40)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.spring(translateY, { toValue: 0, useNativeDriver: true, damping: 18, stiffness: 180 }),
        Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }),
      ]).start();
    }
  }, [visible, opacity, translateY]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(8,6,14,.55)' }} onPress={onClose}>
        <Animated.View
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            transform: [{ translateY }],
            opacity,
          }}
        >
          <Pressable
            style={{
              backgroundColor: theme.colors.surface,
              borderTopLeftRadius: RADIUS.modal,
              borderTopRightRadius: RADIUS.modal,
              ...CONTINUOUS_CORNER,
              paddingTop: 10,
              paddingHorizontal: 20,
              paddingBottom: 20 + insets.bottom,
              maxHeight: '86%',
            }}
            onPress={() => {}}
          >
            <View style={{ alignSelf: 'center', width: 38, height: 4, borderRadius: RADIUS.pill, backgroundColor: theme.colors.border, marginBottom: 14 }} />
            <Text style={{ color: theme.colors.text, fontSize: 19, fontWeight: '800', marginBottom: 4 }}>{title}</Text>
            {desc ? (
              <Text style={{ color: theme.colors.textTertiary, fontSize: 12, lineHeight: 18, marginBottom: 14 }}>{desc}</Text>
            ) : null}
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              {children}
            </ScrollView>
          </Pressable>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

export function Divider() {
  const theme = useAppTheme();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: theme.colors.border }} />;
}

export function SettingSwitch({
  value,
  onValueChange,
}: {
  value: boolean;
  onValueChange: (value: boolean) => void;
}) {
  const theme = useAppTheme();
  return (
    <AppPressable
      onPress={() => onValueChange(!value)}
      feedback="opacity"
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      style={{
        width: 46,
        height: 28,
        borderRadius: RADIUS.pill,
        backgroundColor: value ? theme.colors.primary : theme.colors.border,
        justifyContent: 'center',
        paddingHorizontal: 3,
      }}
    >
      <View
        style={{
          width: 22,
          height: 22,
          borderRadius: RADIUS.pill,
          backgroundColor: '#fff',
          alignSelf: value ? 'flex-end' : 'flex-start',
          shadowColor: '#000',
          shadowOpacity: 0.18,
          shadowRadius: 4,
          shadowOffset: { width: 0, height: 2 },
        }}
      />
    </AppPressable>
  );
}

export function SelectionCircle({ selected }: { selected: boolean }) {
  const theme = useAppTheme();
  return (
    <View
      style={[
        styles.selectionCircle,
        {
          borderColor: selected ? theme.colors.primary : theme.colors.borderStrong,
          backgroundColor: selected ? theme.colors.primary : 'transparent',
        },
      ]}
    >
      {selected ? <Ionicons name="checkmark" size={14} color="#FFFFFF" /> : null}
    </View>
  );
}

export function ManageBar({
  selectedCount,
  allSelected,
  onToggleAll,
  onDelete,
}: {
  selectedCount: number;
  allSelected: boolean;
  onToggleAll: () => void;
  onDelete: () => void;
}) {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const disabled = selectedCount === 0;
  return (
    <View
      style={[
        styles.manageBar,
        {
          backgroundColor: theme.colors.card,
          borderTopColor: theme.colors.border,
          paddingBottom: Math.max(12, insets.bottom + 6),
        },
      ]}
    >
      <AppPressable
        onPress={onToggleAll}
        hitSlop={8}
        feedback="opacity"
        accessibilityRole="checkbox"
        accessibilityState={{ checked: allSelected }}
        style={styles.manageSelectAll}
      >
        <Ionicons
          name={allSelected ? 'checkmark-circle' : 'ellipse-outline'}
          size={20}
          color={allSelected ? theme.colors.primary : theme.colors.textSecondary}
        />
        <Text
          style={{
            color: allSelected ? theme.colors.primary : theme.colors.textSecondary,
            fontSize: 12.5,
            fontWeight: '700',
          }}
        >
          {allSelected ? '取消全选' : '全选'}
        </Text>
      </AppPressable>
      <View style={{ flex: 1 }} />
      <Text style={{ color: theme.colors.textTertiary, fontSize: 11.5 }}>
        已选 {selectedCount} 项
      </Text>
      <AppPressable
        onPress={onDelete}
        disabled={disabled}
        feedback="ripple"
        tone="onColor"
        radius={RADIUS.control}
        pressScale={PRESS_SCALE.control}
        accessibilityRole="button"
        accessibilityLabel={`删除已选 ${selectedCount} 项`}
        style={[
          styles.manageDelete,
          { backgroundColor: disabled ? theme.colors.surfaceAlt : theme.colors.danger },
        ]}
      >
        <Ionicons
          name="trash-outline"
          size={16}
          color={disabled ? theme.colors.textTertiary : '#FFFFFF'}
        />
        <Text
          style={{
            color: disabled ? theme.colors.textTertiary : '#FFFFFF',
            fontSize: 12.5,
            fontWeight: '800',
          }}
        >
          删除{selectedCount ? ` (${selectedCount})` : ''}
        </Text>
      </AppPressable>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 12,
  },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  navBack: {
    width: 40,
    height: 40,
    borderRadius: RADIUS.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconButton: {
    width: 42,
    height: 42,
    borderRadius: RADIUS.pill,
    ...CONTINUOUS_CORNER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardShadow: {
    borderRadius: RADIUS.card,
  },
  cardSurface: {
    borderRadius: RADIUS.card,
    ...CONTINUOUS_CORNER,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
  },
  primaryButton: {
    borderRadius: RADIUS.control,
  },
  ghostButton: {
    height: 44,
    borderRadius: RADIUS.control,
    ...CONTINUOUS_CORNER,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  chip: {
    paddingHorizontal: 14,
    height: 34,
    borderRadius: RADIUS.control,
    ...CONTINUOUS_CORNER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    gap: 12,
  },
  rowIcon: {
    width: 34,
    height: 34,
    borderRadius: RADIUS.control,
    ...CONTINUOUS_CORNER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectionCircle: {
    width: 22,
    height: 22,
    borderRadius: RADIUS.pill,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  manageBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 30,
    elevation: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingTop: 10,
    paddingHorizontal: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  manageSelectAll: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 42,
  },
  manageDelete: {
    height: 42,
    borderRadius: RADIUS.control,
    ...CONTINUOUS_CORNER,
    paddingHorizontal: 15,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
});
