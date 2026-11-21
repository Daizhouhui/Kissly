import Svg, { Circle, Line, Path } from 'react-native-svg';

type IconProps = {
  color: string;
  size?: number;
};

/** Two inward diagonal arrows, matching the reference fullscreen exit control. */
export function CollapseIcon({ color, size = 20 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M20 4 L13.8 10.2"
        fill="none"
        stroke={color}
        strokeWidth={1.7}
        strokeLinecap="round"
      />
      <Path
        d="M13.8 5.8 L13.8 10.2 L18.2 10.2"
        fill="none"
        stroke={color}
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M4 20 L10.2 13.8"
        fill="none"
        stroke={color}
        strokeWidth={1.7}
        strokeLinecap="round"
      />
      <Path
        d="M5.8 13.8 L10.2 13.8 L10.2 18.2"
        fill="none"
        stroke={color}
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function SpeedIcon({ color, size = 32 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32">
      <Circle
        cx={16}
        cy={16}
        r={12.4}
        fill="none"
        stroke={color}
        strokeWidth={1.6}
        strokeDasharray="3.2 2.8"
      />
      <Path d="M13.2 11.1 L21.3 16 L13.2 20.9 Z" fill={color} />
    </Svg>
  );
}

type LoopIconProps = IconProps & {
  barColor: string;
};

export function LoopIcon({ color, barColor, size = 26 }: LoopIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 28 28">
      <Path
        d="M14.5 4.5 H8.8 C6.4 4.5 4.5 6.4 4.5 8.8 V19.2 C4.5 21.6 6.4 23.5 8.8 23.5 H11.5"
        fill="none"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
      />
      <Path
        d="M17.5 23.5 H19.2 C21.6 23.5 23.5 21.6 23.5 19.2 V9.2"
        fill="none"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
      />
      <Path
        d="M18 2.9 L21.9 6.8 L18 10.7"
        fill="none"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Line
        x1={13}
        y1={18}
        x2={13}
        y2={24}
        stroke={barColor}
        strokeWidth={2}
        strokeLinecap="round"
      />
      <Line
        x1={17}
        y1={18}
        x2={17}
        y2={24}
        stroke={barColor}
        strokeWidth={2}
        strokeLinecap="round"
      />
    </Svg>
  );
}
