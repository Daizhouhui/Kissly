import { ReactNode, useState } from 'react';
import { LayoutChangeEvent, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import Svg, { Path } from 'react-native-svg';

type SquircleProps = {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  /** Higher values make the corners straighter, closer to a rounded rectangle. */
  exponent?: number;
};

function superellipsePath(width: number, height: number, exponent: number, inset: number) {
  const cx = width / 2;
  const cy = height / 2;
  const ax = Math.max(0.5, width / 2 - inset);
  const ay = Math.max(0.5, height / 2 - inset);
  const steps = Math.max(72, Math.min(240, Math.round((width + height) / 3)));
  const points: string[] = [];

  for (let index = 0; index <= steps; index += 1) {
    const angle = (index / steps) * Math.PI * 2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const x =
      cx +
      ax * Math.sign(cos) * Math.pow(Math.abs(cos), 2 / exponent);
    const y =
      cy +
      ay * Math.sign(sin) * Math.pow(Math.abs(sin), 2 / exponent);
    points.push(`${index === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`);
  }

  return `${points.join(' ')} Z`;
}

/**
 * A superellipse surface for iOS/macOS continuous-curvature corners.
 * The path is rendered on both platforms so Android does not fall back to a
 * plain circular corner radius.
 */
export function Squircle({
  children,
  style,
  fill = 'rgba(20, 20, 22, 0.5)',
  stroke,
  strokeWidth = 0,
  exponent = 5,
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
      ? superellipsePath(
          size.width,
          size.height,
          exponent,
          stroke ? strokeWidth / 2 : 0
        )
      : null;

  return (
    <View style={style} onLayout={onLayout}>
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
