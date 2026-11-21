import { ReactNode, useState } from 'react';
import { LayoutChangeEvent, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import Svg, { Path } from 'react-native-svg';

type SquircleProps = {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  /** Corner radius. Clamped to half of the shortest side. */
  radius?: number;
  /** Higher values make the corner transition tighter, closer to a rounded rectangle. */
  exponent?: number;
};

function signedPower(value: number, power: number) {
  return Math.sign(value) * Math.pow(Math.abs(value), power);
}

function cornerPoint(
  cx: number,
  cy: number,
  radius: number,
  angle: number,
  exponent: number
) {
  const power = 2 / exponent;
  return [
    cx + radius * signedPower(Math.cos(angle), power),
    cy + radius * signedPower(Math.sin(angle), power),
  ] as const;
}

function squirclePath(
  width: number,
  height: number,
  cornerRadius: number,
  exponent: number,
  inset: number
) {
  const left = inset;
  const top = inset;
  const right = width - inset;
  const bottom = height - inset;
  const r = Math.max(
    0,
    Math.min(cornerRadius, (right - left) / 2, (bottom - top) / 2)
  );
  const n = (value: number) => Number(value.toFixed(2));
  const parts: string[] = [
    `M ${n(left + r)} ${n(top)}`,
    `L ${n(right - r)} ${n(top)}`,
  ];

  const corner = (
    cx: number,
    cy: number,
    startAngle: number,
    endAngle: number
  ) => {
    const segments = 9;
    for (let index = 1; index <= segments; index += 1) {
      const angle = startAngle + ((endAngle - startAngle) * index) / segments;
      const [x, y] = cornerPoint(cx, cy, r, angle, exponent);
      parts.push(`L ${n(x)} ${n(y)}`);
    }
  };

  corner(right - r, top + r, -Math.PI / 2, 0);
  parts.push(`L ${n(right)} ${n(bottom - r)}`);
  corner(right - r, bottom - r, 0, Math.PI / 2);
  parts.push(`L ${n(left + r)} ${n(bottom)}`);
  corner(left + r, bottom - r, Math.PI / 2, Math.PI);
  parts.push(`L ${n(left)} ${n(top + r)}`);
  corner(left + r, top + r, Math.PI, (Math.PI * 3) / 2);
  parts.push('Z');

  return parts.join(' ');
}

/**
 * A superellipse-cornered surface for iOS/macOS continuous-curvature corners.
 * The corners use superellipse arcs, while the edges stay straight, so wide
 * pills and subtitle cards do not turn into lens shapes.
 */
export function Squircle({
  children,
  style,
  fill = 'rgba(20, 20, 22, 0.5)',
  stroke,
  strokeWidth = 0,
  radius = 20,
  exponent = 4,
}: SquircleProps) {
  const [size, setSize] = useState({ width: 0, height: 0 });

  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setSize((current) =>
      current.width === width && current.height === height
        ? current
        : { width, height }
    );
  };

  const path =
    size.width > 0 && size.height > 0
      ? squirclePath(
          size.width,
          size.height,
          radius,
          exponent,
          stroke ? strokeWidth / 2 : 0
        )
      : null;

  return (
    <View style={[style, styles.container]} onLayout={onLayout}>
      {path ? (
        <Svg
          pointerEvents="none"
          style={StyleSheet.absoluteFill}
          width={size.width}
          height={size.height}
          viewBox={`0 0 ${size.width} ${size.height}`}
        >
          <Path
            d={path}
            fill={fill}
            stroke={stroke}
            strokeWidth={strokeWidth}
          />
        </Svg>
      ) : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
  },
});
